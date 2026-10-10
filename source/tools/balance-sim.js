// Balance test: plays game.js headlessly with simulated players of varying skill.
// Usage: node tools/balance-sim.js [players per difficulty, default 100]
// As a module: require('./balance-sim').run(players, overrides) to try numbers without editing game.js.
// The real game code runs inside a VM with a no-op DOM, so every rule (waves, shield,
// rewards, tower stats) comes straight from game.js; only the player's decisions live here.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const PLAYERS = Number(process.argv[2]) || 100;
const DT = 1 / 30;
const source = fs.readFileSync(path.join(__dirname, '..', '..', 'game', 'game.js'), 'utf8');
// JEV, the enemy commander, plays its built-in tactic here: no key, so nothing goes to the network.
const jevSource = fs.readFileSync(path.join(__dirname, '..', '..', 'game', 'jev.js'), 'utf8');

// Anything the game touches in the DOM is this inert stub: callable, assignable, iterable, empty.
function stub() {
  const target = function () {};
  const proxy = new Proxy(target, {
    get(t, key) {
      if (key === Symbol.toPrimitive) return hint => (hint === 'number' ? 0 : '');
      if (key === Symbol.iterator) return function* () {};
      if (key === 'then') return undefined;
      return proxy;
    },
    set() { return true; },
    apply() { return proxy; },
    construct() { return proxy; }
  });
  return proxy;
}

// Expose the closure's state to the harness; the game file itself stays untouched.
const hook = `
  globalThis.__td = {
    pads, towerData, enemyData, WAVE, DIFFICULTIES, buildTower, startWave, startGame, update,
    get state() { return {gold, lives, wave, ended, shieldUp, shieldTimer, spawnRemaining, enemies, spawnQueue}; }
  };
})();`;
const instrumented = source.replace(/\}\)\(\);\s*$/, hook);
if (instrumented === source) throw new Error('Could not find the closing })(); in game.js');

// Deep-merge overrides such as {towerData:{1:{cost:100}}, WAVE:{hpGrowth:.2}} into the live tables.
function merge(target, patch) {
  for (const [key, value] of Object.entries(patch)) {
    if (value && typeof value === 'object' && target[key] && typeof target[key] === 'object') merge(target[key], value);
    else target[key] = value;
  }
}

function loadGame(overrides) {
  const dom = stub();
  const context = {
    document: dom, Image: dom, performance: { now: () => 0 },
    requestAnimationFrame: () => 0, setTimeout: () => 0, clearTimeout: () => {},
    matchMedia: dom, addEventListener: dom,
    Math, Object, Number, String, Array, JSON, Symbol, Promise, Proxy, Infinity, NaN
  };
  context.window = context; context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(jevSource, context);
  vm.runInContext(instrumented, context);
  const td = context.__td;
  if (overrides) for (const table of ['towerData', 'enemyData', 'WAVE', 'DIFFICULTIES']) if (overrides[table]) merge(td[table], overrides[table]);
  return td;
}

function rng(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// How much of the road each pad covers at each range, weighted by traffic: the shared trunk
// carries every enemy, each flank the share JEV sends down it (half each by default).
const ROADS = [
  [{x:835,y:0},{x:835,y:333},{x:232,y:333},{x:232,y:646},{x:0,y:646}],
  [{x:835,y:0},{x:835,y:333},{x:1440,y:333},{x:1440,y:646},{x:1672,y:646}]
];
const samples = [];
ROADS.forEach((road, side) => { for (let i = 0; i < road.length - 1; i++) {
  const a = road[i], b = road[i + 1], len = Math.hypot(b.x - a.x, b.y - a.y);
  for (let d = 0; d < len; d += 6) samples.push({x: a.x + (b.x - a.x) * d / len, y: a.y + (b.y - a.y) * d / len, side, trunk: i === 0});
} });
function coverage(pad, range, shares = [.5, .5]) {
  let sum = 0;
  for (const s of samples) if (Math.hypot(s.x - pad.x, s.y - (pad.y - 42)) <= range) sum += s.trunk ? .5 : shares[s.side];
  return sum;
}

function playGame(key, skill, seed, overrides) {
  const td = loadGame(overrides), random = rng(seed);
  const gauss = () => Math.sqrt(-2 * Math.log(random() + 1e-9)) * Math.cos(2 * Math.PI * random());
  // A weaker player reacts slower and misjudges which spots and upgrades matter.
  // and sometimes simply forgets to spend for a while.
  const think = .4 + (1 - skill) * 5;
  const misjudge = pad => Math.exp(gauss() * (1 - skill) * 2);
  const padTaste = td.pads.map(misjudge);
  const upgradeTaste = .5 + random();
  const boldness = random();
  const dps = level => td.towerData[level].damage / td.towerData[level].rate;
  // JEV's order is not shown, so players judge by the enemies already marching down each flank;
  // the more skilled reinforce the busier one.
  const shares = () => {
    const marching = td.state.enemies.filter(e => e.segment >= 7);
    if (!marching.length) return [.5, .5];
    const left = marching.filter(e => e.side === 0).length / marching.length;
    const leaning = .5 + (left - .5) * skill;
    return [leaning, 1 - leaning];
  };
  let flankShares = [.5, .5];
  const value = (pad, level) => level ? coverage(pad, td.towerData[level].range, flankShares) * dps(level) : 0;

  function spend() {
    flankShares = shares();
    for (;;) {
      const {gold} = td.state;
      let best = null, bestScore = 0;
      for (const pad of td.pads) {
        if (pad.level >= 5) continue;
        const cost = td.towerData[pad.level + 1].cost;
        if (cost > gold) continue;
        const gain = (value(pad, pad.level + 1) - value(pad, pad.level)) / cost;
        const score = gain * padTaste[pad.id] * (pad.level ? upgradeTaste : 1) * Math.exp(gauss() * (1 - skill));
        if (score > bestScore) { best = pad; bestScore = score; }
      }
      if (!best || td.state.ended) return;
      const before = best.level;
      td.buildTower(best);
      if (best.level === before) return;
    }
  }

  td.startGame(key);
  spend();
  td.startWave();
  let time = 0, nextThink = 0, livesAtCall = td.state.lives;
  while (!td.state.ended && time < 3600) {
    td.update(DT); time += DT;
    if (time < nextThink) continue;
    nextThink = time + think;
    if (random() > (1 - skill) * .5) spend();
    const s = td.state;
    // Bold players break the shield early when the road is quiet and nothing leaked lately.
    if (s.shieldUp && s.shieldTimer > 0 && s.enemies.length <= 2 + boldness * 6 && s.lives === livesAtCall && random() < boldness * (.3 + skill)) {
      td.startWave();
    }
    if (!s.shieldUp) livesAtCall = s.lives;
  }
  const s = td.state;
  const levels = td.pads.map(p => p.level);
  return {
    won: s.lives > 0 && s.wave >= 10, lives: s.lives, wave: s.wave, gold: s.gold,
    towers: levels.filter(Boolean).length, maxed: levels.filter(l => l === 5).length
  };
}

const pct = n => (n * 100).toFixed(0).padStart(3) + '%';
const avg = (list, f) => list.length ? list.reduce((a, x) => a + f(x), 0) / list.length : 0;

function run(players = PLAYERS, overrides = null) {
  const result = {};
  for (const key of ['easy', 'normal', 'hard']) {
    const games = [];
    for (let i = 0; i < players; i++) {
      const skill = (i + .5) / players;
      games.push({skill, ...playGame(key, skill, 1000 + i, overrides)});
    }
    const third = k => games.filter(g => Math.floor(g.skill * 3) === k);
    const winRate = list => avg(list, g => g.won ? 1 : 0);
    const wins = games.filter(g => g.won), losses = games.filter(g => !g.won);
    const startLives = loadGame(overrides).DIFFICULTIES[key].lives;
    result[key] = {
      win: winRate(games), weak: winRate(third(0)), mid: winRate(third(1)), strong: winRate(third(2)),
      livesLeft: avg(wins, g => g.lives / startLives), gold: avg(games, g => g.gold),
      towers: avg(games, g => g.towers), maxed: avg(games, g => g.maxed),
      lostAt: losses.length ? avg(losses, g => g.wave) : null
    };
  }
  return result;
}

function print(result, players = PLAYERS) {
  console.log(`${players} players per difficulty, skill spread evenly from novice to expert
`);
  console.log('difficulty  win   weak  mid   strong  lives left  gold left  towers  maxed  lost at wave');
  for (const [key, r] of Object.entries(result)) {
    console.log(
      key.padEnd(10), pct(r.win), ' ', pct(r.weak), pct(r.mid), ' ', pct(r.strong),
      '  ', (r.livesLeft * 100).toFixed(0).padStart(5) + '%', '   ', r.gold.toFixed(0).padStart(6),
      '   ', r.towers.toFixed(1).padStart(4), '  ', r.maxed.toFixed(1).padStart(4), '  ', r.lostAt === null ? '-' : r.lostAt.toFixed(1)
    );
  }
}

module.exports = {run, print};
if (require.main === module) print(run());
