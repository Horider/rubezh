// Summarises a battles-*.jsonl file: hold rate per difficulty, JEV vs brute force, which armies and
// enemies pay off, and how much each tower type contributes.
// Usage: node tools/analyze.js data/battles-base.jsonl
// As a module: require('./analyze').summarize(records) returns the same numbers as an object.
'use strict';
const fs = require('fs');
const F = require('../engine.js');

const mean = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const pct = x => (x * 100).toFixed(0) + '%';
const lost = r => Math.max(0, r.livesLost);

function load(file) {
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
}

// Rebuilds the exact plan JEV played from its recorded picks.
function planFromPicks(rec, map) {
  const answers = {};
  rec.picks.forEach(p => { answers[`army_${p.wave}`] = { choice: p.army }; answers[`road_${p.wave}`] = { choice: p.road }; });
  return F.decisionToPlan(answers, map, rec.mapIndex, rec.difficulty).plan;
}

function summarize(records) {
  const ok = records.filter(r => !r.error);
  const byDiff = {};
  for (const d of F.DIFFICULTY_KEYS) {
    const rs = ok.filter(r => r.difficulty === d);
    if (!rs.length) continue;
    byDiff[d] = {
      n: rs.length,
      hold: mean(rs.map(r => (r.result.held ? 1 : 0))),
      lost: mean(rs.map(r => lost(r.result))),
      leakFree: mean(rs.map(r => (r.result.leakedCount === 0 ? 1 : 0))),
      round1Hold: mean(rs.filter(r => r.round === 1).map(r => (r.result.held ? 1 : 0))),
      round2Hold: mean(rs.filter(r => r.round === 2).map(r => (r.result.held ? 1 : 0))),
      localHold: mean(rs.map(r => (r.local.held ? 1 : 0))),
      localLost: mean(rs.map(r => lost(r.local)))
    };
  }

  // Armies: how often JEV picked each one, and how the battles it dominated ended.
  const armies = {};
  F.ARCHETYPES.forEach(a => { armies[a.key] = { name: a.name, waves: 0, battles: [], }; });
  const roadsAll = { single: 0, all: 0 };
  ok.forEach(r => {
    const counts = {};
    r.picks.forEach(p => { armies[p.army].waves++; counts[p.army] = (counts[p.army] || 0) + 1; (p.road === 'ALL' ? roadsAll.all++ : roadsAll.single++); });
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
    armies[top].battles.push(lost(r.result));
  });

  // Enemy types: budget spent vs lives taken.
  const enemies = {};
  F.ENEMY_TYPES.forEach(t => { enemies[t] = { spent: 0, sent: 0, leaked: 0, lives: 0 }; });
  const maps = new Map();
  ok.forEach(r => {
    const k = r.seed + ':' + r.mapIndex;
    if (!maps.has(k)) maps.set(k, F.generateMap(r.seed, r.mapIndex));
    const plan = planFromPicks(r, maps.get(k));
    plan.waves.forEach(w => w.groups.forEach(g => { enemies[g.type].spent += g.count * F.ENEMIES[g.type].cost; enemies[g.type].sent += g.count; }));
    Object.entries(r.result.leaked).forEach(([t, n]) => { enemies[t].leaked += n; enemies[t].lives += n * F.ENEMIES[t].leak; });
  });

  // Towers: share of all damage and kills, and how often the optimiser chose each type.
  const towers = {};
  F.TOWER_TYPES.forEach(t => { towers[t] = { damage: 0, kills: 0, built: 0, idle: 0 }; });
  ok.forEach(r => {
    r.defense.forEach(d => { towers[d.type].built++; });
    r.result.towers.forEach(([type, dmg, kills]) => { towers[type].damage += dmg; towers[type].kills += kills; if (!dmg) towers[type].idle++; });
  });
  const dmgTotal = Object.values(towers).reduce((a, t) => a + t.damage, 0) || 1;
  const builtTotal = Object.values(towers).reduce((a, t) => a + t.built, 0) || 1;
  F.TOWER_TYPES.forEach(t => {
    towers[t].dmgShare = towers[t].damage / dmgTotal;
    towers[t].builtShare = towers[t].built / builtTotal;
    towers[t].dmgPerTower = towers[t].built ? towers[t].damage / towers[t].built : 0;
  });

  return {
    battles: ok.length, errors: records.length - ok.length, cost: ok.reduce((a, r) => a + (r.cost || 0), 0),
    models: [...new Set(ok.map(r => r.model))], byDiff, armies, roadsAll, enemies, towers,
    jevVsLocal: { jevLost: mean(ok.map(r => lost(r.result))), localLost: mean(ok.map(r => lost(r.local))), jevBetter: mean(ok.map(r => (lost(r.result) > lost(r.local) ? 1 : 0))) }
  };
}

function print(s) {
  const out = [];
  out.push(`Боёв: ${s.battles} (ошибок ${s.errors}), модель: ${s.models.join(', ')}, стоимость $${s.cost.toFixed(4)}`);
  out.push('\nСложность    боёв  удержано  без прорывов  −жизней  раунд1  раунд2 | перебор: удержано −жизней');
  for (const [d, v] of Object.entries(s.byDiff)) {
    out.push(`${F.DIFFICULTIES[d].name.padEnd(11)} ${String(v.n).padStart(5)} ${pct(v.hold).padStart(9)} ${pct(v.leakFree).padStart(13)} ${v.lost.toFixed(2).padStart(8)} ${pct(v.round1Hold).padStart(7)} ${pct(v.round2Hold).padStart(7)} | ${pct(v.localHold).padStart(16)} ${v.localLost.toFixed(2).padStart(7)}`);
  }
  out.push(`\nJEV в среднем −${s.jevVsLocal.jevLost.toFixed(2)} ❤, перебор −${s.jevVsLocal.localLost.toFixed(2)} ❤; JEV сильнее перебора в ${pct(s.jevVsLocal.jevBetter)} боёв`);
  out.push(`Дороги: одна дорога ${s.roadsAll.single} волн, все сразу ${s.roadsAll.all} волн`);
  out.push('\nАрмия JEV          волн  боёв-лидер  −жизней в них');
  for (const a of Object.values(s.armies)) out.push(`${a.name.padEnd(18)} ${String(a.waves).padStart(5)} ${String(a.battles.length).padStart(11)} ${mean(a.battles).toFixed(2).padStart(14)}`);
  out.push('\nВраг        отправлено  бюджет  прорвалось  жизней  жизней/100 бюджета');
  for (const [t, e] of Object.entries(s.enemies)) out.push(`${F.ENEMIES[t].name.padEnd(11)} ${String(e.sent).padStart(10)} ${String(e.spent).padStart(7)} ${String(e.leaked).padStart(11)} ${String(e.lives).padStart(7)} ${(e.spent ? e.lives / e.spent * 100 : 0).toFixed(2).padStart(19)}`);
  out.push('\nБашня     построено  доля урона  урон/башню  убийств  без урона');
  for (const [t, v] of Object.entries(s.towers)) out.push(`${F.TOWERS[t].name.padEnd(9)} ${pct(v.builtShare).padStart(9)} ${pct(v.dmgShare).padStart(11)} ${Math.round(v.dmgPerTower).toString().padStart(11)} ${String(v.kills).padStart(8)} ${String(v.idle).padStart(10)}`);
  return out.join('\n');
}

if (require.main === module) {
  const file = process.argv[2] || 'data/battles-base.jsonl';
  console.log(print(summarize(load(file))));
}
module.exports = { load, summarize, print, planFromPicks };
