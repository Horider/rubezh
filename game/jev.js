// JEV, the enemy commander. Before every wave the game hands it a summary of the battlefield
// and JEV decides how many enemies march down each flank and where the heavy ones go.
// With an OpenRouter key saved in the menu it asks the Jev decisions model; without a key, or
// when the model does not answer in time, it falls back to its built-in tactic so a wave never stalls.
(() => {
  'use strict';

  const API_URL = 'https://openrouter.ai/api/alpha/decisions';
  const DEFAULT_MODEL = '~typesafe/jev-latest';
  const TIMEOUT_MS = 4500;
  const LINES = {
    left: ['Левый фланг дрожит. Туда и ударим.', 'Слева тонко — там и порвём.', 'Все на левую тропу!'],
    right: ['Правый фланг пустует. Вперёд!', 'Справа слабо — давите там.', 'Все на правую тропу!'],
    even: ['Идём обеими тропами. Посмотрим, кто дрогнет.', 'Ровным строем, на оба выхода.']
  };
  // Jev answers questions with probabilities rather than text: which flank to hit,
  // where the heavy units go and how hard to commit to the chosen flank.
  const QUESTIONS = {
    attack_flank: {
      type: 'choice',
      instructions: 'You command the enemy army. Which flank should most of this wave attack to break through?',
      criteria: {
        left: 'The left flank has the weaker defence: less firepower, less road under fire, or recent breakthroughs.',
        right: 'The right flank has the weaker defence: less firepower, less road under fire, or recent breakthroughs.'
      }
    },
    heavy_flank: {
      type: 'choice',
      instructions: 'Which flank should the heaviest units take so they are most likely to survive and reach the exit?',
      criteria: {left: 'Send the heavy units down the left flank.', right: 'Send the heavy units down the right flank.'}
    },
    commitment: {
      type: 'score',
      instructions: 'How much of the wave should be concentrated on the chosen flank?',
      criteria: [
        'Split the wave evenly; the defences are balanced.',
        'Lean a moderate majority towards the weaker flank.',
        'Pour almost everything into the weaker flank.'
      ]
    }
  };
  const GAME = 'Tower defense. Enemies leave the gate at the top; the road forks into a left and a right flank, each with its own exit. ' +
    'Per flank: firepower is tower damage per second over that road, coverage is the share of the road under fire, recentLeaks counts enemies that broke through there lately.';

  let lastError = '';

  function settings() {
    try {
      return {key: localStorage.getItem('td-jev-key') || '', model: localStorage.getItem('td-jev-model') || DEFAULT_MODEL};
    } catch (error) {
      return {key: '', model: DEFAULT_MODEL};
    }
  }

  function save({key, model}) {
    try {
      if (key) localStorage.setItem('td-jev-key', key); else localStorage.removeItem('td-jev-key');
      localStorage.setItem('td-jev-model', model || DEFAULT_MODEL);
    } catch (error) {}
    lastError = '';
  }

  // Turn any left share into a plan the difficulty allows: focus caps how far JEV may lean
  // to one flank, so even the boldest answer cannot pour the whole wave down one road.
  function shape(facts, leftShare, heavy) {
    const cap = .5 + .4 * facts.focus;
    const share = Math.min(cap, Math.max(1 - cap, leftShare));
    const left = Math.round(facts.waveSize * share);
    const side = Math.abs(share - .5) < .06 ? 'even' : share > .5 ? 'left' : 'right';
    const pool = LINES[side];
    return {left, right: facts.waveSize - left, heavy, line: pool[facts.wave % pool.length]};
  }

  // Built-in tactic: lean towards the flank with less firepower and recent leaks.
  function heuristic(facts) {
    const weakness = facts.sides.map(side => (1 + side.leaks * .6) / (side.firepower + 40));
    const raw = weakness[0] / (weakness[0] + weakness[1]);
    const share = .5 + (raw - .5) * (.6 + facts.focus);
    return {...shape(facts, share, raw >= .5 ? 'left' : 'right'), source: 'tactic'};
  }

  async function ask(facts, {key, model}) {
    const [left, right] = facts.sides;
    const state = {
      game: GAME, wave: facts.wave, waves: facts.waves, waveSize: facts.waveSize, composition: facts.composition,
      left: {firepower: left.firepower, coverage: left.coverage, towers: left.towers, recentLeaks: left.leaks},
      right: {firepower: right.firepower, coverage: right.coverage, towers: right.towers, recentLeaks: right.leaks}
    };
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);
    try {
      const response = await fetch(API_URL, {
        method: 'POST',
        signal: abort.signal,
        headers: {'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json', 'X-Title': 'Lesnoy Rubezh'},
        body: JSON.stringify({model, state, questions: QUESTIONS})
      });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const answers = (await response.json()).answers || {};
      const leftChance = answers.attack_flank?.probabilities?.left;
      if (typeof leftChance !== 'number') throw new Error('ответ без плана');
      // commitment 0…2 turns the flank preference into how far the split leans.
      const commitment = Math.min(2, Math.max(0, Number(answers.commitment?.score) || 1)) / 2;
      const share = .5 + (leftChance - .5) * (.3 + .7 * commitment);
      const heavy = answers.heavy_flank?.choice === 'right' ? 'right' : 'left';
      return {...shape(facts, share, heavy), source: 'model'};
    } catch (error) {
      throw new Error(error.name === 'AbortError' ? 'нет ответа за ' + TIMEOUT_MS / 1000 + ' с' : error.message);
    } finally {
      clearTimeout(timer);
    }
  }

  async function plan(facts) {
    const current = settings();
    if (current.key) {
      try {
        const result = await ask(facts, current);
        lastError = '';
        return result;
      } catch (error) {
        lastError = error.message;
      }
    }
    return heuristic(facts);
  }

  function status() {
    const {key, model} = settings();
    if (!key) return 'встроенная тактика';
    return lastError ? `модель не ответила (${lastError}), играет встроенная тактика` : 'модель ' + model;
  }

  window.Jev = {plan, heuristic, settings, save, status, hasModel: () => Boolean(settings().key), DEFAULT_MODEL};
})();
