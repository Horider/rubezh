// Balance bench: replays JEV's recorded decisions under candidate numbers, without new API calls.
// For every recorded map it rebuilds the defence from scratch with the candidate stats, replays
// JEV's round-1 and round-2 picks (plans are rebuilt from picks, so budgets and costs follow the
// candidate), runs the brute-force local counter, and probes each enemy type alone.
// Usage: node tools/tune.js data/battles-base.jsonl [params.json] [--procs 20] [--limit N]
// params.json is a deep patch, e.g. {"TOWERS":{"archer":{"dmg":26}},"DIFFICULTIES":{"hard":{"budget":1.4}}}
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const F = require('../engine.js');
const { load, planFromPicks } = require('./analyze.js');

function merge(target, patch) {
  for (const [k, v] of Object.entries(patch || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && target[k] && typeof target[k] === 'object') merge(target[k], v);
    else target[k] = v;
  }
}
function applyParams(params) {
  ['TOWERS', 'ENEMIES', 'DIFFICULTIES', 'RULES'].forEach(k => params && params[k] && merge(F[k], params[k]));
}

// Groups recorded battles by map so both rounds replay against the same evolving defence.
function jobsFrom(records) {
  const jobs = new Map();
  records.filter(r => !r.error).forEach(r => {
    if (!jobs.has(r.job)) jobs.set(r.job, { job: r.job, seed: r.seed, mapIndex: r.mapIndex, difficulty: r.difficulty, rounds: [] });
    jobs.get(r.job).rounds[r.round - 1] = r.picks;
  });
  return [...jobs.values()];
}

async function evalJob(job) {
  const { difficulty, mapIndex } = job;
  const lives = F.DIFFICULTIES[difficulty].lives;
  const map = F.generateMap(job.seed, mapIndex);
  let defense = F.initialDefense(map);
  const warm = F.localEnemy(map, defense, mapIndex, difficulty);
  const plans = [warm.plan];
  defense = (await F.optimizeDefense(map, plans, defense, { maxIters: 5, seed: mapIndex + 7 })).defense;
  const out = { difficulty, rounds: [], probes: {}, build: {}, damage: {} };

  // Pure-type probes on the round-1 defence: whole budget in one enemy type, best road.
  for (const type of F.ENEMY_TYPES) {
    let worst = 0;
    for (const road of [...map.roads.map(r => r.id), 'split']) {
      worst = Math.max(worst, F.simulate(map, defense, F.archetypePlan(map, mapIndex, { [type]: 1 }, road, difficulty), { lives }).livesLost);
    }
    out.probes[type] = worst;
  }
  // All-round probe (normal and hard maps): a defence optimised against every enemy type at once.
  // In a balanced game no single type should still tear through it much harder than the others.
  if (difficulty === 'normal' || difficulty === 'hard') {
    const pure = F.ENEMY_TYPES.map(type => F.archetypePlan(map, mapIndex, { [type]: 1 }, 'split', difficulty));
    const robust = (await F.optimizeDefense(map, pure, F.initialDefense(map), { maxIters: 4, seed: mapIndex + 7 })).defense;
    out.robust = {}; out.robustBuild = {};
    robust.forEach(t => { out.robustBuild[t.type] = (out.robustBuild[t.type] || 0) + 1; });
    for (const type of F.ENEMY_TYPES) {
      let worst = 0;
      for (const road of [...map.roads.map(r => r.id), 'split']) {
        worst = Math.max(worst, F.simulate(map, robust, F.archetypePlan(map, mapIndex, { [type]: 1 }, road, difficulty), { lives }).livesLost);
      }
      out.robust[type] = worst;
    }
  }
  const local = F.simulate(map, defense, F.localEnemy(map, defense, mapIndex, difficulty).plan, { lives });
  out.local = { lost: Math.max(0, local.livesLost), held: local.held };

  for (let i = 0; i < job.rounds.length; i++) {
    if (!job.rounds[i]) continue;
    const plan = planFromPicks({ picks: job.rounds[i], mapIndex, difficulty }, map);
    const res = F.simulate(map, defense, plan, { lives });
    out.rounds.push({ round: i + 1, lost: Math.max(0, res.livesLost), held: res.held });
    res.towers.forEach(t => { out.damage[t.type] = (out.damage[t.type] || 0) + t.damage; });
    defense.forEach(t => { out.build[t.type] = (out.build[t.type] || 0) + 1; });
    plans.push(plan);
    if (i + 1 < job.rounds.length) defense = (await F.optimizeDefense(map, plans, defense, { maxIters: 6, seed: mapIndex + 7 })).defense;
  }
  return out;
}

function report(results) {
  const mean = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  const pct = x => (x * 100).toFixed(0) + '%';
  const lines = ['Сложность   JEV: удержано  −жизней | перебор: удержано  −жизней'];
  const summary = { byDiff: {}, probes: {}, build: {}, damage: {} };
  for (const d of F.DIFFICULTY_KEYS) {
    const rs = results.filter(r => r.difficulty === d);
    if (!rs.length) continue;
    const rounds = rs.flatMap(r => r.rounds);
    const v = { hold: mean(rounds.map(r => (r.held ? 1 : 0))), lost: mean(rounds.map(r => r.lost)), localHold: mean(rs.map(r => (r.local.held ? 1 : 0))), localLost: mean(rs.map(r => r.local.lost)) };
    summary.byDiff[d] = v;
    lines.push(`${F.DIFFICULTIES[d].name.padEnd(10)} ${pct(v.hold).padStart(14)} ${v.lost.toFixed(2).padStart(8)} | ${pct(v.localHold).padStart(17)} ${v.localLost.toFixed(2).padStart(8)}`);
  }
  lines.push('\nВраг в одиночку (весь бюджет, лучшая дорога): −жизней в среднем');
  for (const t of F.ENEMY_TYPES) {
    summary.probes[t] = mean(results.map(r => Math.max(0, r.probes[t])));
    lines.push(`  ${F.ENEMIES[t].name.padEnd(10)} ${summary.probes[t].toFixed(2)}`);
  }
  const rob = results.filter(r => r.robust);
  if (rob.length) {
    summary.robust = {}; summary.robustBuild = {};
    const rbTot = rob.reduce((a, r) => a + Object.values(r.robustBuild).reduce((x, y) => x + y, 0), 0);
    lines.push('\nУниверсальная защита (против всех типов сразу), обычная+сложная: −жизней от типа / доля башен');
    for (const t of F.ENEMY_TYPES) {
      summary.robust[t] = mean(rob.map(r => Math.max(0, r.robust[t])));
      lines.push(`  ${F.ENEMIES[t].name.padEnd(10)} ${summary.robust[t].toFixed(2)}`);
    }
    lines.push('  ' + F.TOWER_TYPES.map(t => { summary.robustBuild[t] = rob.reduce((a, r) => a + (r.robustBuild[t] || 0), 0) / rbTot; return `${F.TOWERS[t].name} ${pct(summary.robustBuild[t])}`; }).join(' · '));
  }
  const bTot = results.reduce((a, r) => a + Object.values(r.build).reduce((x, y) => x + y, 0), 0) || 1;
  const dTot = results.reduce((a, r) => a + Object.values(r.damage).reduce((x, y) => x + y, 0), 0) || 1;
  lines.push('\nБашня     построено  доля урона');
  for (const t of F.TOWER_TYPES) {
    summary.build[t] = results.reduce((a, r) => a + (r.build[t] || 0), 0) / bTot;
    summary.damage[t] = results.reduce((a, r) => a + (r.damage[t] || 0), 0) / dTot;
    lines.push(`  ${F.TOWERS[t].name.padEnd(8)} ${pct(summary.build[t]).padStart(9)} ${pct(summary.damage[t]).padStart(11)}`);
  }
  return { text: lines.join('\n'), summary };
}

async function main() {
  const argv = process.argv.slice(2);
  const flag = (name, def) => { const i = argv.indexOf('--' + name); return i >= 0 ? argv[i + 1] : def; };
  const positional = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--')));
  const [file, paramsFile] = positional;
  const params = paramsFile ? JSON.parse(fs.readFileSync(paramsFile, 'utf8')) : {};
  applyParams(params);
  let jobs = jobsFrom(load(file));
  const limit = Number(flag('limit', 0));
  if (limit) jobs = F.DIFFICULTY_KEYS.flatMap(d => jobs.filter(j => j.difficulty === d).slice(0, Math.ceil(limit / 4)));

  if (flag('worker') !== undefined) {
    const [k, n] = flag('worker').split('/').map(Number);
    const mine = jobs.filter((_, i) => i % n === k);
    const res = [];
    for (const j of mine) res.push(await evalJob(j));
    process.stdout.write(JSON.stringify(res));
    return;
  }
  const procs = Number(flag('procs', 20));
  const t0 = Date.now();
  const parts = await Promise.all(Array.from({ length: procs }, (_, k) => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [__filename, ...argv, '--worker', `${k}/${procs}`], { stdio: ['ignore', 'pipe', 'inherit'] });
    let buf = '';
    child.stdout.on('data', d => { buf += d; });
    child.on('exit', code => (code ? reject(new Error('worker ' + k)) : resolve(JSON.parse(buf || '[]'))));
  })));
  const { text, summary } = report(parts.flat());
  console.log(`${jobs.length} карт, ${((Date.now() - t0) / 1000).toFixed(0)} с${paramsFile ? ', параметры ' + path.basename(paramsFile) : ''}\n` + text);
  const outFile = flag('out');
  if (outFile) fs.writeFileSync(outFile, JSON.stringify(summary, null, 2));
}

if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
module.exports = { applyParams, jobsFrom, evalJob, report };
