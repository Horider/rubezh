/* JEV Map Forge — one map's JEV ↔ defence rounds, shared by the page (window.ForgePipeline)
 * and tools/forge-run.js, plus the JSON export/import of a finished set. */
(function (root, factory) {
  const node = typeof module === 'object' && module.exports;
  const api = factory(node ? require('./engine.js') : root.Forge, node ? require('./jev-client.js') : root.JevClient);
  if (node) module.exports = api;
  else root.ForgePipeline = api;
})(typeof self !== 'undefined' ? self : globalThis, function (F, Jev) {
  'use strict';
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

  function localAttack(map, defense, index, difficulty) {
    const best = F.localEnemy(map, defense, index, difficulty);
    return { source: 'local', model: null, strategy: best.strategy, taunt: '', plan: best.plan, notes: [] };
  }

  // One JEV turn. Decision models pick an army and a road per wave; chat models write a JSON plan.
  // A bad key or empty balance is rethrown (every map would fail the same way); anything else
  // falls back to the local enemy for this round, with the error kept on the round.
  async function jevAttack({ map, index, defense, history, difficulty, apiKey, model, signal, log = () => {} }) {
    const t0 = now();
    const decision = Jev.isDecisionModel(model);
    const payload = decision ? F.buildJevDecision(map, defense, index, history, difficulty) : null;
    const messages = decision ? null : F.buildJevMessages(map, defense, index, history, difficulty);
    const prompt = decision ? payload.state : messages[1].content;
    try {
      let out;
      if (decision) {
        const reply = await Jev.decide(apiKey, model, payload, signal);
        const d = F.decisionToPlan(reply.answers, map, index, difficulty);
        out = { source: 'jev', model: reply.model, strategy: d.strategy, taunt: '', picks: d.picks, plan: d.plan, notes: d.notes, usage: reply.usage };
      } else {
        const reply = await Jev.chatPlan(apiKey, model, messages, F.PLAN_SCHEMA, F.parseJevReply, signal);
        const { plan, notes } = F.sanitizePlan(reply.parsed, map, index, difficulty);
        if (!plan.waves.some(w => w.groups.length)) throw new Jev.ApiError('в плане нет ни одного отряда', 200);
        out = { source: 'jev', model: reply.model, strategy: String(reply.parsed.strategy || ''), taunt: String(reply.parsed.taunt || ''), plan, notes, usage: reply.usage };
      }
      out.latency = Math.round(now() - t0);
      out.prompt = prompt;
      const cost = out.usage && out.usage.cost != null ? ` · $${Number(out.usage.cost).toFixed(5)}` : '';
      log(`JEV (${out.model}) за ${(out.latency / 1000).toFixed(1)} с${cost}: ${out.strategy}`, 'jev');
      out.notes.forEach(n => log('план поправлен: ' + n, ''));
      return out;
    } catch (e) {
      if (signal && signal.aborted) throw e;
      if (e.status === 401 || e.status === 402) throw e;
      log(`JEV не дал план: ${e.message}. Раунд сыграет локальный противник.`, 'err');
      return { ...localAttack(map, defense, index, difficulty), error: e.message, prompt };
    }
  }

  // rec: { index, map, difficulty } — filled in place with defense, rounds, stress and final results.
  async function runMap(rec, { rounds = 2, useJev = true, apiKey, model, signal, onStatus = () => {}, onUpdate = () => {}, log = () => {} }) {
    const { map, index, difficulty } = rec;
    const lives = F.DIFFICULTIES[difficulty].lives;
    const optimize = async (plans, from, label, maxIters) => (await F.optimizeDefense(map, plans, from, {
      maxIters, seed: index + 7, signal, onProgress: p => onStatus('busy', `${label} · шаг ${p.iteration}`)
    })).defense;

    Object.assign(rec, { defense: null, rounds: [], stress: null, final: null });
    onStatus('busy', 'расстановка башен');
    let defense = F.initialDefense(map);
    // Warm-up against the local enemy so JEV meets a sensible defence, not a random one.
    const plans = [F.localEnemy(map, defense, index, difficulty).plan];
    defense = await optimize(plans, defense, 'первичная защита', 5);
    rec.defense = defense;
    onUpdate();

    const history = [];
    for (let r = 0; r < rounds; r++) {
      onStatus('busy', useJev ? `JEV планирует атаку · раунд ${r + 1}` : `противник ищет брешь · раунд ${r + 1}`);
      const attack = useJev
        ? await jevAttack({ map, index, defense, history, difficulty, apiKey, model, signal, log })
        : localAttack(map, defense, index, difficulty);
      const before = F.simulate(map, defense, attack.plan, { lives });
      history.push({ plan: attack.plan, result: before });
      plans.push(attack.plan);
      const defenseBefore = defense;
      defense = await optimize(plans, defense, `защита отвечает · раунд ${r + 1}`, 6);
      const after = F.simulate(map, defense, attack.plan, { lives });
      rec.rounds.push({ ...attack, before, after, defenseBefore, defenseAfter: defense });
      rec.defense = defense;
      log(`раунд ${r + 1}: −${Math.max(0, before.livesLost)} ❤ против старой защиты → −${Math.max(0, after.livesLost)} ❤ после перестройки`, after.livesLost <= 0 ? 'ok' : '');
      onUpdate();
    }

    // Hardening: brute-force the strongest counter, fold it in, and report the next counter honestly.
    onStatus('busy', 'стресс-тест');
    plans.push(F.localEnemy(map, defense, index, difficulty).plan);
    defense = await optimize(plans, defense, 'закалка защиты', 4);
    const s2 = F.localEnemy(map, defense, index, difficulty);
    rec.defense = defense;
    rec.stress = { strategy: s2.strategy, plan: s2.plan, result: F.simulate(map, defense, s2.plan, { lives }) };
    rec.final = rec.rounds.map(rd => F.simulate(map, defense, rd.plan, { lives }));
    onStatus('done', 'готово');
    onUpdate();
  }

  const slimResult = r => r && { ...r, towers: r.towers };

  function exportData(maps, meta) {
    return {
      generator: 'JEV Map Forge', version: 2, createdAt: new Date().toISOString(), ...meta,
      grid: { cols: F.COLS, rows: F.ROWS }, focusZone: { center: F.CENTER, ...F.FOCUS },
      rules: F.RULES, difficulties: F.DIFFICULTIES, towers: F.TOWERS, enemies: F.ENEMIES,
      maps: maps.map(rec => ({
        index: rec.index + 1, mapSeed: rec.map.seed, layout: rec.map.layout, difficulty: rec.difficulty, status: rec.status,
        roads: rec.map.roads.map(r => ({
          letter: r.letter, entry: { x: r.entry.x, y: r.entry.y, side: r.entry.side }, exit: { x: r.exit.x, y: r.exit.y, side: r.exit.side },
          tiles: r.tiles.map(t => [t.x, t.y]), length: +r.path.len.toFixed(2), focusShare: +r.stats.focusShare.toFixed(3), minDistToCenter: +r.stats.centerDist.toFixed(2)
        })),
        towers: (rec.defense || []).map((t, i) => ({ slot: i + 1, x: t.x, y: t.y, type: t.type })),
        ascii: F.asciiMap(rec.map, rec.defense || rec.map.slots),
        rounds: rec.rounds.map((rd, i) => ({
          round: i + 1, source: rd.source, model: rd.model, error: rd.error || null, strategy: rd.strategy, taunt: rd.taunt, picks: rd.picks || null,
          plan: rd.plan, notes: rd.notes, latency: rd.latency || null, usage: rd.usage || null, prompt: rd.prompt || null,
          before: slimResult(rd.before), after: slimResult(rd.after), defenseBefore: rd.defenseBefore, defenseAfter: rd.defenseAfter,
          livesLostVsFinal: rec.final ? rec.final[i].livesLost : null
        })),
        stress: rec.stress ? { strategy: rec.stress.strategy, plan: rec.stress.plan, result: slimResult(rec.stress.result) } : null,
        final: rec.final ? rec.final.map(slimResult) : null
      }))
    };
  }

  // Maps are rebuilt from their seeds, so a file restores every road, pad and replay exactly.
  function importData(data) {
    if (!data || !Array.isArray(data.maps)) throw new Error('это не файл Кузницы карт');
    return data.maps.map(m => {
      const index = m.index - 1;
      const map = F.generateMap(m.mapSeed, index);
      return {
        index, map, difficulty: m.difficulty || 'normal',
        defense: m.towers && m.towers.length ? m.towers.map(t => ({ x: t.x, y: t.y, type: t.type })) : null,
        status: m.status || (m.final ? 'done' : 'idle'), statusText: m.final ? 'готово' : 'ждёт боя',
        rounds: (m.rounds || []).map(r => ({ ...r, notes: r.notes || [] })),
        stress: m.stress, final: m.final
      };
    });
  }

  return { runMap, jevAttack, localAttack, exportData, importData };
});
