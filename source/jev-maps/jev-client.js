/* JEV Map Forge — OpenRouter client shared by the page (window.JevClient) and the Node tools.
 * ~typesafe/jev-latest is a decisions model: it only answers through /api/alpha/decisions,
 * picking among the options we give it. Chat models (typesafe/jev-router) go through
 * /chat/completions and write a JSON plan instead. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.JevClient = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';
  const DECISIONS_URL = 'https://openrouter.ai/api/alpha/decisions';
  const CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions';
  const DECISION_MODELS = ['~typesafe/jev-latest'];
  const isDecisionModel = model => DECISION_MODELS.includes(model) || /^typesafe\/jev-\d/.test(model);

  class ApiError extends Error {
    constructor(message, status) { super(message); this.status = status; }
  }
  const sleep = (ms, signal) => new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    if (signal) signal.addEventListener('abort', () => { clearTimeout(t); reject(new ApiError('Отменено', 0)); }, { once: true });
  });

  async function post(url, apiKey, body, signal) {
    const res = await fetch(url, {
      method: 'POST', signal,
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'X-Title': 'JEV Map Forge' },
      body: JSON.stringify(body)
    });
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch { /* non-JSON error page */ }
    if (!res.ok || (data && data.error)) {
      const msg = (data && data.error && (data.error.message || JSON.stringify(data.error))) || text.slice(0, 200) || res.statusText;
      throw new ApiError(`${res.status} ${msg}`, res.status);
    }
    return data;
  }

  // Rate limits and provider hiccups are retried with backoff; auth, balance and bad requests are not.
  async function withRetry(fn, signal, retries = 4) {
    for (let attempt = 0; ; attempt++) {
      try { return await fn(); } catch (e) {
        const retriable = e.status === 429 || e.status >= 500 || e.name === 'TypeError';
        if (!retriable || attempt >= retries || (signal && signal.aborted)) throw e;
        await sleep(1000 * 2 ** attempt + Math.random() * 500, signal);
      }
    }
  }

  async function decide(apiKey, model, payload, signal) {
    const data = await withRetry(() => post(DECISIONS_URL, apiKey, { model, ...payload }, signal), signal);
    if (!data || !data.answers) throw new ApiError('в ответе JEV нет answers', 200);
    return { answers: data.answers, model: data.model || model, usage: data.usage || null, id: data.id };
  }

  // Strict JSON schema first; if the routed model rejects it, plain JSON mode, then no format at all.
  async function chatPlan(apiKey, model, messages, schema, parse, signal) {
    const formats = [{ type: 'json_schema', json_schema: { name: 'attack_plan', strict: true, schema } }, { type: 'json_object' }, null];
    let lastErr = null;
    for (const format of formats) {
      const body = { model, messages, temperature: .7, max_tokens: 3000 };
      if (format) body.response_format = format;
      let data;
      try { data = await withRetry(() => post(CHAT_URL, apiKey, body, signal), signal); } catch (e) {
        if (e.status === 400 && format) { lastErr = e; continue; }
        throw e;
      }
      const message = (data.choices && data.choices[0] && data.choices[0].message) || {};
      let content = message.content;
      if (Array.isArray(content)) content = content.map(p => p.text || '').join('');
      if (!content && message.tool_calls && message.tool_calls.length) content = message.tool_calls[0].function && message.tool_calls[0].function.arguments;
      try { return { parsed: parse(content), model: data.model || model, usage: data.usage || null }; } catch (e) {
        lastErr = new ApiError('ответ не похож на JSON-план: ' + e.message, 200);
      }
    }
    throw lastErr;
  }

  return { decide, chatPlan, isDecisionModel, ApiError, DECISIONS_URL, CHAT_URL };
});
