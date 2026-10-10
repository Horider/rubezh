// Runs the page's full pipeline (10 maps × JEV rounds × stress test) headlessly and writes the same
// JSON the page exports, so it opens in the page with «Открыть JSON».
// Usage: OPENROUTER_API_KEY=… node tools/forge-run.js --seed 4242 --difficulty normal [--rounds 2] [--model ~typesafe/jev-latest]
'use strict';
const fs = require('fs');
const path = require('path');
const F = require('../engine.js');
const P = require('../pipeline.js');

const argv = process.argv.slice(2);
const flag = (name, def) => { const i = argv.indexOf('--' + name); return i >= 0 ? argv[i + 1] : def; };
const seed = Number(flag('seed', 4242));
const difficulty = flag('difficulty', 'normal');
const rounds = Number(flag('rounds', 2));
const model = flag('model', '~typesafe/jev-latest');
const apiKey = process.env.OPENROUTER_API_KEY;

async function main() {
  if (!apiKey) throw new Error('Нужна переменная окружения OPENROUTER_API_KEY');
  if (!F.DIFFICULTIES[difficulty]) throw new Error('Сложность: ' + F.DIFFICULTY_KEYS.join(', '));
  const maps = Array.from({ length: 10 }, (_, i) => ({ index: i, map: F.generateMap(seed * 100 + i, i), difficulty, status: 'idle' }));
  const t0 = Date.now();
  await Promise.all(maps.map(rec => P.runMap(rec, {
    rounds, useJev: true, apiKey, model,
    onStatus: status => { rec.status = status; },
    log: (text, kind) => { if (kind === 'jev' || kind === 'err') console.log(`[карта ${rec.index + 1}] ${text}`); }
  })));
  const data = P.exportData(maps, { seed, opponent: model, difficulty });
  const file = path.join(__dirname, '..', 'data', `jev-battle-${seed}-${difficulty}.json`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
  console.log(`\n${((Date.now() - t0) / 1000).toFixed(0)} с → ${path.relative(process.cwd(), file)}`);
  maps.forEach(rec => {
    const worst = Math.max(0, ...rec.final.map(r => r.livesLost));
    const held = rec.final.every(r => r.held);
    console.log(`  ${rec.index + 1}. ${rec.map.layout.padEnd(15)} JEV: ${rec.rounds.map(r => `−${Math.max(0, r.before.livesLost)}→−${Math.max(0, r.after.livesLost)}`).join('  ')}  итог ${held ? 'держит' : 'пала'} (−${worst})  стресс −${Math.max(0, rec.stress.result.livesLost)}`);
  });
}
main().catch(e => { console.error(e.message); process.exit(1); });
