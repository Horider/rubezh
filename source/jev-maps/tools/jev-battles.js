// Runs real JEV battles headlessly and appends one JSON line per battle.
// Usage (key only via env, never written to disk):
//   OPENROUTER_API_KEY=… node tools/jev-battles.js --tag base --battles 500 --shards 12
// Each map plays two rounds: JEV vs the warm-up defence, then JEV (knowing round 1) vs the defence
// rebuilt against it. Every battle also records the brute-force local counter on the same defence.
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const F = require('../engine.js');
const Jev = require('../jev-client.js');

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => {
  if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]);
  return acc;
}, []));
const TAG = args.tag || 'base';
const BATTLES = Number(args.battles) || 500;
const SHARDS = Number(args.shards) || 1;
const SEED = Number(args.seed) || 9000;
const MODEL = args.model || '~typesafe/jev-latest';
const OUT_DIR = path.join(__dirname, '..', 'data');
const apiKey = process.env.OPENROUTER_API_KEY;

// Same battle list in every shard: difficulties × maps, two rounds per map, trimmed to exactly BATTLES.
function schedule() {
  const perDiff = Math.ceil(BATTLES / F.DIFFICULTY_KEYS.length);
  const jobs = [];
  F.DIFFICULTY_KEYS.forEach((difficulty, di) => {
    let left = perDiff;
    for (let m = 0; left > 0; m++) {
      const rounds = Math.min(2, left);
      jobs.push({ id: `${difficulty}-${m}`, difficulty, seed: SEED + di * 1000 + m, mapIndex: m % 10, rounds });
      left -= rounds;
    }
  });
  return jobs;
}

const compact = r => ({
  livesLost: r.livesLost, held: r.held, leaked: r.leaked, leakedCount: r.leakedCount, spawned: r.spawned, killed: r.killed,
  leakedHp: r.leakedHp, totalHp: r.totalHp, towers: r.towers.map(t => [t.type, t.damage, t.kills])
});

async function runJob(job, out) {
  const { difficulty, mapIndex } = job;
  const lives = F.DIFFICULTIES[difficulty].lives;
  const map = F.generateMap(job.seed, mapIndex);
  let defense = F.initialDefense(map);
  const warm = F.localEnemy(map, defense, mapIndex, difficulty);
  const plans = [warm.plan];
  defense = (await F.optimizeDefense(map, plans, defense, { maxIters: 5, seed: mapIndex + 7 })).defense;
  const history = [];
  for (let round = 1; round <= job.rounds; round++) {
    const payload = F.buildJevDecision(map, defense, mapIndex, history, difficulty);
    const t0 = Date.now();
    let reply;
    try { reply = await Jev.decide(apiKey, MODEL, payload); } catch (e) {
      out.write(JSON.stringify({ job: job.id, round, difficulty, error: e.message }) + '\n');
      if (e.status === 401 || e.status === 402) throw e;
      continue;
    }
    const ms = Date.now() - t0;
    const { plan, picks, strategy, notes } = F.decisionToPlan(reply.answers, map, mapIndex, difficulty);
    const res = F.simulate(map, defense, plan, { lives });
    const local = F.localEnemy(map, defense, mapIndex, difficulty);
    const localRes = F.simulate(map, defense, local.plan, { lives });
    out.write(JSON.stringify({
      job: job.id, round, difficulty, seed: job.seed, mapIndex, layout: map.layout, roads: map.roads.length,
      defense, picks, strategy, notes, result: compact(res),
      local: { strategy: local.strategy, livesLost: localRes.livesLost, held: localRes.held },
      model: reply.model, cost: reply.usage && reply.usage.cost, ms
    }) + '\n');
    history.push({ plan, result: res });
    plans.push(plan);
    defense = (await F.optimizeDefense(map, plans, defense, { maxIters: 6, seed: mapIndex + 7 })).defense;
  }
}

async function worker(shard) {
  const jobs = schedule().filter((_, i) => i % SHARDS === shard);
  const file = path.join(OUT_DIR, `battles-${TAG}.shard${shard}.jsonl`);
  // Resumable: keep maps whose every round is recorded, replay half-finished maps from round 1.
  const done = new Set();
  if (fs.existsSync(file)) {
    const recs = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
    const rounds = {};
    recs.filter(r => !r.error).forEach(r => { rounds[r.job] = (rounds[r.job] || 0) + 1; });
    jobs.forEach(j => { if (rounds[j.id] === j.rounds) done.add(j.id); });
    fs.writeFileSync(file, recs.filter(r => done.has(r.job) && !r.error).map(r => JSON.stringify(r) + '\n').join(''));
  }
  const out = fs.createWriteStream(file, { flags: 'a' });
  for (const job of jobs) {
    if (done.has(job.id)) continue;
    await runJob(job, out);
    process.stdout.write('.');
  }
  out.end();
}

async function main() {
  if (!apiKey) { console.error('Нужна переменная окружения OPENROUTER_API_KEY'); process.exit(1); }
  fs.mkdirSync(OUT_DIR, { recursive: true });
  if (args.shard !== undefined) return worker(Number(args.shard));
  // Parent: one child process per shard so the CPU-heavy optimiser runs in parallel.
  const t0 = Date.now();
  const total = schedule().reduce((a, j) => a + j.rounds, 0);
  console.log(`${TAG}: ${total} боёв, ${schedule().length} карт, ${SHARDS} потоков, модель ${MODEL}`);
  await Promise.all(Array.from({ length: SHARDS }, (_, k) => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [__filename, ...process.argv.slice(2), '--shard', String(k)], { stdio: ['ignore', 'inherit', 'inherit'], env: process.env });
    child.on('exit', code => (code ? reject(new Error(`поток ${k} завершился с кодом ${code}`)) : resolve()));
  })));
  const lines = [];
  for (let k = 0; k < SHARDS; k++) {
    const f = path.join(OUT_DIR, `battles-${TAG}.shard${k}.jsonl`);
    if (fs.existsSync(f)) lines.push(...fs.readFileSync(f, 'utf8').split('\n').filter(Boolean));
  }
  fs.writeFileSync(path.join(OUT_DIR, `battles-${TAG}.jsonl`), lines.join('\n') + '\n');
  for (let k = 0; k < SHARDS; k++) fs.rmSync(path.join(OUT_DIR, `battles-${TAG}.shard${k}.jsonl`), { force: true });
  const ok = lines.map(l => JSON.parse(l)).filter(r => !r.error);
  console.log(`\nготово за ${((Date.now() - t0) / 1000).toFixed(0)} с: ${ok.length} боёв, ошибок ${lines.length - ok.length}, стоимость $${ok.reduce((a, r) => a + (r.cost || 0), 0).toFixed(4)}`);
}

main().catch(e => { console.error(e.message); process.exit(1); });
