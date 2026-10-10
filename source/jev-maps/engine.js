/* JEV Map Forge — engine.
 * Map generation (every road is forced through the centre of the screen), a deterministic
 * battle simulation, a hill-climbing defence optimiser, a local fallback enemy and the
 * text/JSON contract used to talk to JEV. No DOM here: the same file runs in the browser
 * (window.Forge) and in Node (require) for balance tests. Coordinates are in tiles:
 * tile (x, y) spans [x, x+1] × [y, y+1], so its centre is (x + .5, y + .5). */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Forge = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  const COLS = 24, ROWS = 14;
  const CENTER = { x: COLS / 2, y: ROWS / 2 };
  // "Where the player's eyes are": roads must spend a good share of their length inside this ellipse.
  const FOCUS = { rx: 5.6, ry: 3.6 };
  const RULES = {
    waves: 5, lives: 20, waveGap: 18, dt: 1 / 20, slots: 8,
    minCenterDist: 1.6,   // every road must pass this close to the exact centre…
    minFocusShare: 0.3,   // …and keep this share of its length inside FOCUS
    minGap: 2.4           // tiles between two stretches of road (room for a tower between them)
  };

  const TOWERS = {
    archer:    { name: 'Лучник',  role: 'одиночная цель',          range: 3.3, rate: 1.8,  dmg: 22, magic: false, flight: .25, homing: true,  color: '#5c9a3a' },
    alchemist: { name: 'Алхимик', role: 'ослабление и замедление', range: 2.8, rate: .8,   dmg: 10, magic: false, flight: .45, splash: 1.1, slow: .45, slowDur: 2.2, weaken: .55, weakenDur: 3.5, color: '#9b5bd0' },
    mage:      { name: 'Маг',     role: 'пробивание брони',        range: 3.0, rate: .7,   dmg: 56, magic: true,  flight: .3,  homing: true,  color: '#3f86e0' },
    bomb:      { name: 'Бомбы',   role: 'массовый удар',           range: 3.0, rate: .45,  dmg: 32, magic: false, flight: .7,  splash: 1.2, color: '#e0862f' }
  };
  const TOWER_TYPES = Object.keys(TOWERS);
  // Damage taken by a weakened enemy is multiplied by this, and its armour by (1 − alchemist.weaken).
  const WEAKEN_DAMAGE = 1.15;

  const ENEMIES = {
    grunt:  { name: 'Пехотинец', hp: 100, speed: 1.45, armor: .15, cost: 2,  leak: 1, gap: .7,  note: 'базовая пехота' },
    runner: { name: 'Волк',      hp: 85,  speed: 2.5,  armor: 0,   cost: 2,  leak: 1, gap: .55, note: 'очень быстрый' },
    swarm:  { name: 'Гоблин',    hp: 64,  speed: 1.9,  armor: 0,   cost: 1,  leak: 1, gap: .35, note: 'дешёвый, идёт толпой' },
    knight: { name: 'Рыцарь',    hp: 200, speed: 1.05, armor: .55, cost: 7,  leak: 2, gap: 1.1, note: 'тяжёлая броня' },
    ogre:   { name: 'Огр',       hp: 510, speed: .8,   armor: .2,  cost: 16, leak: 3, gap: 2.2, note: 'огромный запас здоровья' }
  };
  const ENEMY_TYPES = Object.keys(ENEMIES);

  // Difficulty scales the attacker's budget and the defender's lives; the numbers come from balance runs (tools/).
  const DIFFICULTIES = {
    easy:      { name: 'Лёгкая',  budget: 1.05, lives: 25 },
    normal:    { name: 'Обычная', budget: 1.42, lives: 20 },
    hard:      { name: 'Сложная', budget: 1.65, lives: 15 },
    nightmare: { name: 'Кошмар',  budget: 1.95, lives: 10 }
  };
  const DIFFICULTY_KEYS = Object.keys(DIFFICULTIES);
  const diffOf = d => DIFFICULTIES[d] || DIFFICULTIES.normal;

  const waveBudget = (mapIndex, wave, difficulty) => Math.round((26 + 12 * wave) * (1 + 0.05 * mapIndex) * diffOf(difficulty).budget);

  // ---------- helpers ----------
  function makeRng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const tick = () => new Promise(resolve => setTimeout(resolve, 0));
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const key = (x, y) => y * COLS + x;
  const inside = (x, y) => x >= 0 && y >= 0 && x < COLS && y < ROWS;
  const inFocus = (x, y) => {
    const dx = (x - CENTER.x) / FOCUS.rx, dy = (y - CENTER.y) / FOCUS.ry;
    return dx * dx + dy * dy <= 1;
  };
  const ROAD_LETTERS = 'ABC';
  const SIDE_RU = { top: 'сверху', bottom: 'снизу', left: 'слева', right: 'справа' };

  // ---------- map generation ----------
  // Kingdom Rush style: one or two roads, each a smooth curve through a handful of control points.
  // Points are in tiles; the first and last points sit just outside the field (the gates).
  // A second road either merges into road A at A's control point `merge`, or splits off it at `split`.
  const LAYOUTS = [
    { name: 'Змейка',    roads: [{ pts: [[-1.2, 2.5], [4, 2.5], [8, 3.2], [10.5, 5.5], [12, 7], [13.5, 8.5], [16, 10.8], [20, 11.5], [25.2, 11.5]] }] },
    { name: 'Слияние',   roads: [{ pts: [[5, -1.2], [5, 3], [8, 5.8], [12, 7.4], [14.5, 9.5], [18, 10.8], [25.2, 10.8]] },
                                 { pts: [[16, -1.2], [16, 2.5], [14.5, 4.8]], merge: 3 }] },
    { name: 'Долина',    roads: [{ pts: [[5, -1.2], [5, 3.5], [7, 8], [10.5, 9], [13, 7], [16, 5], [19.5, 5.5], [25.2, 6]] }] },
    { name: 'Развилка',  roads: [{ pts: [[12, -1.2], [12, 3.5], [12, 7], [9, 9.6], [5.5, 9.8], [3.5, 7.5], [-1.2, 6]] },
                                 { split: 2, pts: [[15, 9.6], [18.5, 9.8], [20.5, 7.5], [25.2, 6]] }] },
    // Horseshoe: in along one arm, U-turn, back along the other; towers between the arms hit both passes.
    { name: 'Подкова',   jitter: [.6, 0], roads: [{ pts: [[-1.2, 5.45], [4, 5.45], [10, 5.45], [15, 5.45], [16.1, 5.9], [16.55, 7], [16.1, 8.1], [15, 8.55], [10, 8.55], [4, 8.55], [-1.2, 8.55]] }] },
    { name: 'Клещи',     roads: [{ pts: [[-1.2, 3], [4, 3], [8, 4.6], [12, 7], [16, 7.4], [20, 6.5], [25.2, 6.5]] },
                                 { pts: [[-1.2, 11], [4, 11], [8, 9.4]], merge: 3 }] },
    { name: 'Два фланга', jitter: [1.4, .3], roads: [{ pts: [[-1.2, 3.2], [5, 3.2], [9, 4.9], [12, 5.65], [15, 4.9], [19, 3.2], [25.2, 3.2]] },
                                                    { pts: [[-1.2, 10.8], [5, 10.8], [9, 9.1], [12, 8.35], [15, 9.1], [19, 10.8], [25.2, 10.8]] }] }
  ];
  const PER_SEG = 16;

  const sideOf = p => (p.x < 0 ? 'left' : p.x > COLS ? 'right' : p.y < 0 ? 'top' : p.y > ROWS ? 'bottom' : null);
  const edgeTile = p => {
    const side = sideOf(p);
    return {
      x: side === 'left' ? 0 : side === 'right' ? COLS - 1 : clamp(Math.floor(p.x), 0, COLS - 1),
      y: side === 'top' ? 0 : side === 'bottom' ? ROWS - 1 : clamp(Math.floor(p.y), 0, ROWS - 1), side
    };
  };

  // Mirrors the layout, then nudges every point; a gate and the point after it move together
  // along the edge and snap to a tile centre so the road enters straight through its gate.
  function shapeControls(raw, rng, flipX, flipY, [jx, jy] = [1.8, 1.2]) {
    const pts = raw.map(([x, y]) => ({ x: flipX ? COLS - x : x, y: flipY ? ROWS - y : y }));
    const n = pts.length;
    const outside = i => sideOf(pts[i]) !== null;
    const shiftPair = (a, b) => {
      const side = sideOf(pts[a]);
      const along = side === 'top' || side === 'bottom' ? 'x' : 'y';
      const max = along === 'x' ? COLS : ROWS;
      const v = clamp(pts[a][along] + (rng() - .5) * 3, 2.5, max - 2.5);
      pts[a][along] = pts[b][along] = Math.floor(v) + .5;
    };
    for (let i = 0; i < n; i++) {
      if (outside(i) || (i === 1 && outside(0)) || (i === n - 2 && outside(n - 1))) continue;
      pts[i].x += (rng() - .5) * jx; pts[i].y += (rng() - .5) * jy;
    }
    if (outside(0)) shiftPair(0, 1);
    if (outside(n - 1)) shiftPair(n - 1, n - 2);
    return pts;
  }

  // Centripetal Catmull-Rom: passes through every control point without the cusps and overshoots
  // the uniform version makes when neighbouring segments differ a lot in length.
  function catmull(ctrl) {
    const n = ctrl.length;
    const ext = (a, b) => ({ x: 2 * a.x - b.x, y: 2 * a.y - b.y });
    const P = [ext(ctrl[0], ctrl[1]), ...ctrl, ext(ctrl[n - 1], ctrl[n - 2])];
    const lerp = (a, b, ta, tb, t) => {
      const span = tb - ta || 1e-6;
      return { x: (a.x * (tb - t) + b.x * (t - ta)) / span, y: (a.y * (tb - t) + b.y * (t - ta)) / span };
    };
    const knot = (a, b) => Math.max(Math.sqrt(Math.hypot(b.x - a.x, b.y - a.y)), 1e-4);
    const out = [];
    for (let i = 1; i < P.length - 2; i++) {
      const [p0, p1, p2, p3] = [P[i - 1], P[i], P[i + 1], P[i + 2]];
      const t0 = 0, t1 = t0 + knot(p0, p1), t2 = t1 + knot(p1, p2), t3 = t2 + knot(p2, p3);
      for (let k = 0; k < PER_SEG; k++) {
        const t = t1 + (t2 - t1) * k / PER_SEG;
        const a1 = lerp(p0, p1, t0, t1, t), a2 = lerp(p1, p2, t1, t2, t), a3 = lerp(p2, p3, t2, t3, t);
        const b1 = lerp(a1, a2, t0, t2, t), b2 = lerp(a2, a3, t1, t3, t);
        out.push(lerp(b1, b2, t1, t2, t));
      }
    }
    out.push({ ...ctrl[n - 1] });
    return out;
  }
  function withLengths(pts) {
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
    return { pts, cum, len: cum[cum.length - 1] };
  }
  const indexAt = (path, s) => { let i = 0; while (i < path.cum.length - 1 && path.cum[i] < s) i++; return i; };

  function posAt(path, s, hint = 0) {
    const { pts, cum } = path;
    let i = Math.min(hint, pts.length - 2);
    while (i < pts.length - 2 && cum[i + 1] < s) i++;
    while (i > 0 && cum[i] > s) i--;
    const span = cum[i + 1] - cum[i] || 1, f = clamp((s - cum[i]) / span, 0, 1);
    return { x: pts[i].x + (pts[i + 1].x - pts[i].x) * f, y: pts[i].y + (pts[i + 1].y - pts[i].y) * f, seg: i };
  }
  function samplePath(path, step = .5) {
    const out = [];
    let hint = 0;
    for (let s = 0; s <= path.len; s += step) {
      const p = posAt(path, s, hint); hint = p.seg;
      out.push({ x: p.x, y: p.y, s, onMap: p.x > 0 && p.y > 0 && p.x < COLS && p.y < ROWS, focus: inFocus(p.x, p.y) });
    }
    return out;
  }
  // Tiles under the centre line, in travel order.
  function tilesOf(path) {
    const seen = new Set(), tiles = [];
    let hint = 0;
    for (let s = 0; s <= path.len; s += .2) {
      const p = posAt(path, s, hint); hint = p.seg;
      const x = Math.floor(p.x), y = Math.floor(p.y);
      if (!inside(x, y) || seen.has(key(x, y))) continue;
      seen.add(key(x, y)); tiles.push({ x, y });
    }
    return tiles;
  }

  function buildRoads(layout, rng) {
    const flipX = rng() < .5, flipY = rng() < .5;
    const roads = [];
    layout.roads.forEach((spec, id) => {
      const own = shapeControls(spec.pts, rng, flipX, flipY, layout.jitter);
      let pts, join = null;
      if (spec.merge != null || spec.split != null) {
        const A = roads[0], k = (spec.merge != null ? spec.merge : spec.split) * PER_SEG;
        if (spec.merge != null) {
          // Approach the join along A's own direction so the two roads blend instead of meeting at a corner.
          const next = A.path.pts[indexAt(A.path, A.path.cum[k] + 1.5)];
          const curve = catmull([...own, A.path.pts[k], next]);
          pts = [...curve.slice(0, own.length * PER_SEG), ...A.path.pts.slice(k)];
          join = { kind: 'merge', at: own.length * PER_SEG };
        } else {
          const prev = A.path.pts[indexAt(A.path, A.path.cum[k] - 1.5)];
          const curve = catmull([prev, A.path.pts[k], ...own]);
          pts = [...A.path.pts.slice(0, k), ...curve.slice(PER_SEG)];
          join = { kind: 'split', at: k };
        }
        join.aS = A.path.cum[k];
      } else {
        pts = catmull(own);
      }
      const path = withLengths(pts);
      if (join) join.s = path.cum[join.at];
      const entry = edgeTile(pts[0]), exit = edgeTile(pts[pts.length - 1]);
      const samples = samplePath(path);
      const onMap = samples.filter(s => s.onMap);
      const stats = {
        focusShare: onMap.filter(s => s.focus).length / onMap.length,
        centerDist: Math.min(...onMap.map(s => Math.hypot(s.x - CENTER.x, s.y - CENTER.y))),
        length: path.len, onMapLength: onMap.length * .5
      };
      const tiles = tilesOf(path);
      stats.tiles = tiles.length;
      roads.push({ id, letter: ROAD_LETTERS[id], entry, exit, tiles, path, samples, stats, join });
    });
    const uniq = list => list.filter((g, i) => list.findIndex(h => h.x === g.x && h.y === g.y) === i);
    return { layout: layout.name, roads, entries: uniq(roads.map(r => r.entry)), exits: uniq(roads.map(r => r.exit)), flipX, flipY };
  }

  function validateMap(map) {
    const problems = [];
    const nearJoin = (r, s) => r.join && Math.abs(s - r.join.s) < 2;
    for (const r of map.roads) {
      if (r.stats.centerDist > RULES.minCenterDist) problems.push(`${r.letter}: далеко от центра`);
      if (r.stats.focusShare < RULES.minFocusShare) problems.push(`${r.letter}: мало пути в центре`);
      if (r.stats.onMapLength < 22) problems.push(`${r.letter}: слишком короткая`);
      const S = r.samples;
      for (let i = 1; i < S.length - 1; i++) {
        const s = S[i];
        // Stay off the border except where the road runs into its gate.
        if (s.onMap && s.s > 3 && s.s < r.path.len - 3 && (s.x < 1 || s.y < 1 || s.x > COLS - 1 || s.y > ROWS - 1)) { problems.push(`${r.letter}: жмётся к краю`); break; }
        // Gentle bends only: at most ~31° of turn per half tile (curve radius ≥ ~0.9 tile).
        const a1 = Math.atan2(s.y - S[i - 1].y, s.x - S[i - 1].x), a2 = Math.atan2(S[i + 1].y - s.y, S[i + 1].x - s.x);
        const turn = Math.abs(Math.atan2(Math.sin(a2 - a1), Math.cos(a2 - a1)));
        if (turn > .55 && !nearJoin(r, s.s)) { problems.push(`${r.letter}: резкий поворот`); break; }
      }
      // A road never folds back next to itself.
      outer: for (let i = 0; i < S.length; i++) for (let j = i + 10; j < S.length; j++) {
        if (S[i].onMap && S[j].onMap && Math.hypot(S[i].x - S[j].x, S[i].y - S[j].y) < RULES.minGap) { problems.push(`${r.letter}: петля`); break outer; }
      }
    }
    // Two roads keep a gap for towers, except where one merges into or splits off the other.
    if (map.roads.length === 2) {
      const [A, B] = map.roads;
      const shared = s => B.join && (B.join.kind === 'merge' ? s >= B.join.s - 3.5 : s <= B.join.s + 3.5);
      outer2: for (const a of A.samples) for (const b of B.samples) {
        if (!a.onMap || !b.onMap || shared(b.s)) continue;
        if (B.join && Math.abs(a.s - B.join.aS) < 3.5) continue;
        if (Math.hypot(a.x - b.x, a.y - b.y) < RULES.minGap) { problems.push('дороги слишком близко'); break outer2; }
      }
    }
    return problems;
  }

  // Pad spots on a half-tile grid beside a road (pad edge clear of the road, still close enough to matter),
  // away from gates; the half step lets pads sit inside bends and between two passes, as in Kingdom Rush.
  // A pad at (x, y) is centred on (x + .5, y + .5).
  function computeCandidates(map) {
    const roadGrid = new Uint8Array(COLS * ROWS);
    map.roads.forEach(r => r.tiles.forEach(t => { roadGrid[key(t.x, t.y)] |= 1 << r.id; }));
    map.roadGrid = roadGrid;
    const gates = [...map.entries, ...map.exits];
    const allPts = map.roads.flatMap(r => r.path.pts);
    const out = [];
    for (let y = 1; y <= ROWS - 2; y += .5) for (let x = 1; x <= COLS - 2; x += .5) {
      const cx = x + .5, cy = y + .5;
      let dmin = Infinity;
      for (const p of allPts) dmin = Math.min(dmin, Math.hypot(p.x - cx, p.y - cy));
      if (dmin < 1.15 || dmin > 2.2) continue;
      if (gates.some(g => Math.max(Math.abs(g.x - x), Math.abs(g.y - y)) <= 2)) continue;
      const cover = [];
      map.roads.forEach(r => r.samples.forEach((s, i) => {
        if (s.onMap && (s.x - cx) ** 2 + (s.y - cy) ** 2 <= 9) cover.push([r.id, i]);
      }));
      out.push({ x, y, d: dmin < 1.7 ? 1 : 2, cover, focus: inFocus(cx, cy) });
    }
    return out;
  }

  const spaced = (slots, x, y, skip = -1) => slots.every((s, i) => i === skip || Math.max(Math.abs(s.x - x), Math.abs(s.y - y)) >= 2);

  // Greedy start: each pick prefers road stretches nobody covers yet, weighted towards the centre.
  function pickSlots(map, rng) {
    const counts = map.roads.map(r => new Float32Array(r.samples.length));
    const chosen = [];
    while (chosen.length < RULES.slots) {
      let best = null, bestScore = -1;
      for (const c of map.candidates) {
        if (!spaced(chosen, c.x, c.y)) continue;
        let score = 0;
        for (const [r, i] of c.cover) score += (map.roads[r].samples[i].focus ? 1.6 : 1) / (1 + 1.5 * counts[r][i]);
        score = (score + (c.focus ? 2 : 0)) * (c.d === 1 ? 1 : .9) + rng() * .5;
        if (score > bestScore) { bestScore = score; best = c; }
      }
      if (!best) return null;
      chosen.push(best);
      for (const [r, i] of best.cover) counts[r][i]++;
    }
    return chosen.map(c => ({ x: c.x, y: c.y }));
  }

  // Builds up to `pool` valid variants of the map's layout and keeps the most central one.
  // A rare seed can't fit its layout; then the next layout is tried rather than failing the map.
  function generateMap(seed, mapIndex, pool = 6) {
    const lastProblems = [];
    for (let shift = 0; shift < LAYOUTS.length; shift++) {
      const layout = LAYOUTS[(mapIndex + (seed % LAYOUTS.length) + shift) % LAYOUTS.length];
      const map = generateWithLayout(seed, mapIndex, layout, pool, lastProblems);
      if (map) return map;
    }
    throw new Error('Не удалось построить карту: ' + lastProblems.join(', '));
  }

  function generateWithLayout(seed, mapIndex, layout, pool, lastProblems) {
    let best = null, valid = 0;
    for (let attempt = 0; attempt < 200 && valid < pool; attempt++) {
      const rng = makeRng(seed * 7919 + attempt * 104729 + 17);
      const map = buildRoads(layout, rng);
      const problems = validateMap(map);
      if (problems.length) { lastProblems.splice(0, lastProblems.length, ...problems); continue; }
      map.candidates = computeCandidates(map);
      const slots = pickSlots(map, rng);
      if (!slots) continue;
      valid++;
      map.quality = map.roads.reduce((a, r) => a + r.stats.focusShare, 0) / map.roads.length;
      if (!best || map.quality > best.quality) best = Object.assign(map, { seed, attempt, index: mapIndex, slots, decorSeed: seed * 31 + mapIndex });
    }
    return best;
  }

  // ---------- battle ----------
  function buildSpawns(plan) {
    const spawns = [];
    plan.waves.forEach((wave, w) => wave.groups.forEach(g => {
      for (let k = 0; k < g.count; k++) spawns.push({ t: w * RULES.waveGap + (g.delay || 0) + k * ENEMIES[g.type].gap, type: g.type, road: g.road, wave: w });
    }));
    return spawns.sort((a, b) => a.t - b.t);
  }

  class Battle {
    constructor(map, defense, plan, { fx = false, lives = RULES.lives } = {}) {
      this.map = map; this.fx = fx;
      this.time = 0; this.startLives = lives; this.lives = lives;
      this.towers = defense.map((t, i) => ({ id: i, x: t.x + .5, y: t.y + .5, type: t.type, s: TOWERS[t.type], cd: .15 * i % .6, damage: 0, kills: 0, shots: 0, angle: 0 }));
      this.spawns = buildSpawns(plan);
      this.spawnIdx = 0; this.nextId = 1;
      this.enemies = []; this.projectiles = []; this.effects = [];
      this.stats = { spawned: 0, killed: 0, leaked: {}, leakedCount: 0, leakedHp: 0, totalHp: 0, killProgress: 0 };
      this.wave = 0;
    }
    get done() { return this.spawnIdx >= this.spawns.length && !this.enemies.length && !this.projectiles.length; }

    spawn(sp) {
      const e = ENEMIES[sp.type], path = this.map.roads[sp.road].path;
      const p = posAt(path, 0);
      this.enemies.push({ id: this.nextId++, type: sp.type, road: sp.road, s: 0, seg: 0, x: p.x, y: p.y, hp: e.hp, maxHp: e.hp, armor: e.armor, speed: e.speed, slowUntil: -1, slowAmt: 0, weakUntil: -1, dead: false });
      this.stats.spawned++; this.stats.totalHp += e.hp;
      this.wave = Math.max(this.wave, sp.wave + 1);
    }

    pickTarget(tw) {
      const r2 = tw.s.range * tw.s.range, t = this.time;
      let best = null, bestLeft = Infinity, pref = null, prefLeft = Infinity;
      for (const e of this.enemies) {
        if (e.dead) continue;
        const dx = e.x - tw.x, dy = e.y - tw.y;
        if (dx * dx + dy * dy > r2) continue;
        const left = this.map.roads[e.road].path.len - e.s;
        if (left < bestLeft) { bestLeft = left; best = e; }
        const preferred = tw.type === 'alchemist' ? e.weakUntil < t + .3 : tw.type === 'mage' ? e.armor >= .3 : false;
        if (preferred && left < prefLeft) { prefLeft = left; pref = e; }
      }
      return pref || best;
    }

    hurt(e, dmg, tw) {
      if (e.dead) return;
      const weak = e.weakUntil > this.time;
      const armor = tw.s.magic ? 0 : e.armor * (weak ? 1 - TOWERS.alchemist.weaken : 1);
      const amount = Math.min(e.hp, dmg * (weak ? WEAKEN_DAMAGE : 1) * (1 - armor));
      e.hp -= amount; tw.damage += amount;
      if (e.hp <= 1e-6) {
        e.dead = true; tw.kills++;
        this.stats.killed++;
        this.stats.killProgress += e.s / this.map.roads[e.road].path.len;
        if (this.fx) this.effects.push({ kind: 'death', x: e.x, y: e.y, t: this.time, life: .5, type: e.type });
      }
    }

    impact(p) {
      const tw = this.towers[p.tower];
      if (p.homing) {
        if (p.target && !p.target.dead) this.hurt(p.target, tw.s.dmg, tw);
        return;
      }
      const r2 = tw.s.splash * tw.s.splash;
      for (const e of this.enemies) {
        if (e.dead || (e.x - p.tx) ** 2 + (e.y - p.ty) ** 2 > r2) continue;
        this.hurt(e, tw.s.dmg, tw);
        if (tw.s.slow) {
          e.slowUntil = this.time + tw.s.slowDur; e.slowAmt = tw.s.slow;
          e.weakUntil = this.time + tw.s.weakenDur;
        }
      }
      if (this.fx) this.effects.push({ kind: tw.type === 'bomb' ? 'boom' : 'splash', x: p.tx, y: p.ty, r: tw.s.splash, t: this.time, life: tw.type === 'bomb' ? .45 : .6 });
    }

    step() {
      const dt = RULES.dt;
      this.time += dt;
      const t = this.time;
      while (this.spawnIdx < this.spawns.length && this.spawns[this.spawnIdx].t <= t) this.spawn(this.spawns[this.spawnIdx++]);

      for (const e of this.enemies) {
        if (e.dead) continue;
        const path = this.map.roads[e.road].path;
        e.s += e.speed * (e.slowUntil > t ? 1 - e.slowAmt : 1) * dt;
        if (e.s >= path.len) {
          const info = ENEMIES[e.type];
          e.dead = true; e.leaked = true;
          this.lives -= info.leak;
          this.stats.leakedCount++; this.stats.leakedHp += e.hp;
          this.stats.leaked[e.type] = (this.stats.leaked[e.type] || 0) + 1;
          if (this.fx) this.effects.push({ kind: 'leak', x: e.x, y: e.y, t, life: .8 });
          continue;
        }
        const p = posAt(path, e.s, e.seg);
        e.x = p.x; e.y = p.y; e.seg = p.seg;
      }

      for (const tw of this.towers) {
        tw.cd -= dt;
        if (tw.cd > 0) continue;
        const target = this.pickTarget(tw);
        if (!target) { tw.cd = 0; continue; }
        tw.cd = 1 / tw.s.rate; tw.shots++;
        tw.angle = Math.atan2(target.y - tw.y, target.x - tw.x);
        const proj = { tower: tw.id, type: tw.type, homing: !!tw.s.homing, target, x: tw.x, y: tw.y - .35, sx: tw.x, sy: tw.y - .35, t: tw.s.flight, flight: tw.s.flight };
        if (proj.homing) { proj.tx = target.x; proj.ty = target.y; }
        else {
          // Lobbed shots aim a little ahead of the target, but fast enemies can still outrun the blast.
          const lead = target.speed * (target.slowUntil > t ? 1 - target.slowAmt : 1) * tw.s.flight * .6;
          const aim = posAt(this.map.roads[target.road].path, target.s + lead, target.seg);
          proj.tx = aim.x; proj.ty = aim.y;
        }
        this.projectiles.push(proj);
      }

      for (const p of this.projectiles) {
        p.t -= dt;
        if (p.homing && p.target && !p.target.dead) { p.tx = p.target.x; p.ty = p.target.y; }
        const f = 1 - Math.max(p.t, 0) / p.flight;
        p.x = p.sx + (p.tx - p.sx) * f; p.y = p.sy + (p.ty - p.sy) * f;
        p.arc = p.homing ? 0 : Math.sin(f * Math.PI) * .9;
        if (p.t <= 0) { this.impact(p); p.done = true; }
      }
      this.projectiles = this.projectiles.filter(p => !p.done);
      this.enemies = this.enemies.filter(e => !e.dead);
      if (this.fx) this.effects = this.effects.filter(fx => t - fx.t < fx.life);
    }

    result() {
      const s = this.stats;
      return {
        livesLost: this.startLives - this.lives, held: this.lives > 0,
        leaked: { ...s.leaked }, leakedCount: s.leakedCount, leakedHp: Math.round(s.leakedHp), totalHp: s.totalHp,
        spawned: s.spawned, killed: s.killed,
        meanKillProgress: s.killed ? s.killProgress / s.killed : 0,
        towers: this.towers.map(t => ({ type: t.type, damage: Math.round(t.damage), kills: t.kills, shots: t.shots })),
        duration: Math.round(this.time)
      };
    }
  }

  function simulate(map, defense, plan, opts) {
    const b = new Battle(map, defense, plan, opts);
    const limit = RULES.waves * RULES.waveGap + 150;
    while (!b.done && b.time < limit) b.step();
    return b.result();
  }
  // Lower is better for the defender: lives first, then how much HP got through, then how far enemies got.
  const scoreResult = r => r.livesLost * 100 + (r.totalHp ? r.leakedHp / r.totalHp : 0) * 40 + r.meanKillProgress * 10;

  // ---------- defence ----------
  function initialDefense(map) {
    const order = ['bomb', 'mage', 'archer', 'alchemist', 'archer', 'mage', 'bomb', 'archer'];
    const ranked = map.slots.map(s => {
      const c = map.candidates.find(c => c.x === s.x && c.y === s.y);
      const roads = new Set(c ? c.cover.map(([r]) => r) : []);
      return { ...s, weight: (c ? c.cover.length : 0) * (1 + .5 * (roads.size - 1)) };
    }).sort((a, b) => b.weight - a.weight);
    return ranked.map((s, i) => ({ x: s.x, y: s.y, type: order[i % order.length] }));
  }

  const hasAllTypes = def => TOWER_TYPES.every(tp => def.some(s => s.type === tp));

  async function optimizeDefense(map, plans, start, opts = {}) {
    const { maxIters = 6, relocations = 12, swaps = 12, requireAll = true, seed = 1, onProgress, signal } = opts;
    const rng = makeRng(seed);
    const evaluate = def => {
      const scores = plans.map(p => scoreResult(simulate(map, def, p)));
      return Math.max(...scores) + .25 * scores.reduce((a, b) => a + b, 0) / scores.length;
    };
    let cur = start.map(s => ({ ...s })), curScore = evaluate(cur), evals = 1;
    for (let it = 0; it < maxIters; it++) {
      const moves = [];
      cur.forEach((s, i) => TOWER_TYPES.forEach(tp => { if (tp !== s.type) moves.push(def => { def[i].type = tp; }); }));
      for (let k = 0; k < swaps; k++) {
        const i = Math.floor(rng() * cur.length), j = Math.floor(rng() * cur.length);
        if (cur[i].type !== cur[j].type) moves.push(def => { [def[i].type, def[j].type] = [def[j].type, def[i].type]; });
      }
      for (let k = 0; k < relocations; k++) {
        const i = Math.floor(rng() * cur.length);
        const pool = map.candidates.filter(c => Math.max(Math.abs(c.x - cur[i].x), Math.abs(c.y - cur[i].y)) <= 3 && spaced(cur, c.x, c.y, i));
        if (!pool.length) continue;
        const c = pool[Math.floor(rng() * pool.length)];
        moves.push(def => { def[i].x = c.x; def[i].y = c.y; });
      }
      let best = null, bestScore = curScore - 1e-6;
      for (const move of moves) {
        const def = cur.map(s => ({ ...s }));
        move(def);
        if (requireAll && !hasAllTypes(def)) continue;
        const sc = evaluate(def);
        if (sc < bestScore) { bestScore = sc; best = def; }
        if (++evals % 8 === 0) {
          await tick();
          if (signal && signal.aborted) throw new Error('Отменено');
        }
      }
      onProgress && onProgress({ iteration: it + 1, score: best ? bestScore : curScore, evals });
      if (!best) break;
      cur = best; curScore = bestScore;
    }
    return { defense: cur, score: curScore, evals };
  }

  // ---------- attack plans ----------
  // Army compositions: the local enemy searches them, and JEV picks one per wave.
  const ARCHETYPES = [
    { key: 'rush',     name: 'Волчий рывок',    mix: { runner: .6, grunt: .4 },           desc: 'волки и пехота: скорость, лёгкая броня' },
    { key: 'swarm',    name: 'Гоблинский рой',  mix: { swarm: .8, grunt: .2 },            desc: 'толпа дешёвых гоблинов: числом' },
    { key: 'armor',    name: 'Железный кулак',  mix: { knight: .7, grunt: .3 },           desc: 'рыцари в тяжёлой броне с пехотой' },
    { key: 'siege',    name: 'Огры на таран',   mix: { ogre: .6, knight: .2, swarm: .2 }, desc: 'огры с прикрытием: огромный запас здоровья' },
    { key: 'mixed',    name: 'Смешанный строй', mix: { grunt: .25, runner: .2, knight: .3, swarm: .25 }, desc: 'всех понемногу' },
    { key: 'knights',  name: 'Рыцарский клин',  mix: { knight: 1 },                       desc: 'только рыцари: максимум брони' },
    { key: 'ogres',    name: 'Стадо огров',     mix: { ogre: 1 },                         desc: 'только огры, сдача — гоблинами' },
    { key: 'wolves',   name: 'Стая',            mix: { runner: 1 },                       desc: 'только волки: максимум скорости' },
    { key: 'horde',    name: 'Орда',            mix: { swarm: .5, runner: .5 },           desc: 'гоблины и волки: числом и скоростью' },
    { key: 'fortress', name: 'Живая крепость',  mix: { knight: .5, ogre: .5 },            desc: 'рыцари и огры: броня плюс здоровье' }
  ];

  function fillBudget(budget, mix) {
    const groups = [];
    let left = budget;
    for (const [type, share] of Object.entries(mix)) {
      const n = Math.floor(budget * share / ENEMIES[type].cost);
      if (n > 0) { groups.push({ type, count: n }); left -= n * ENEMIES[type].cost; }
    }
    if (left > 0) {
      const sw = groups.find(g => g.type === 'swarm');
      if (sw) sw.count += left; else groups.push({ type: 'swarm', count: left });
    }
    return groups;
  }

  // One wave on one road ('split' sends each group down a different road at once).
  function waveGroups(map, budget, mix, road) {
    return fillBudget(budget, mix).map((g, k) => ({
      ...g, road: road === 'split' ? k % map.roads.length : road, delay: road === 'split' ? 0 : k * 1.5
    }));
  }

  function archetypePlan(map, mapIndex, mix, road, difficulty) {
    return { waves: Array.from({ length: RULES.waves }, (_, w) => ({ groups: waveGroups(map, waveBudget(mapIndex, w, difficulty), mix, road) })) };
  }

  // Fallback opponent: tries every archetype on every road (and split) and keeps the one that hurts most.
  function localEnemy(map, defense, mapIndex, difficulty) {
    let best = null;
    const roadsToTry = [...map.roads.map(r => r.id), 'split'];
    for (const arch of ARCHETYPES) for (const road of roadsToTry) {
      const plan = archetypePlan(map, mapIndex, arch.mix, road, difficulty);
      const res = simulate(map, defense, plan);
      const sc = scoreResult(res);
      if (!best || sc > best.score) best = { plan, score: sc, result: res, strategy: `${arch.name} — ${road === 'split' ? 'по всем дорогам сразу' : 'по дороге ' + ROAD_LETTERS[road]}` };
    }
    return best;
  }

  function planCost(plan) {
    return plan.waves.map(w => w.groups.reduce((a, g) => a + g.count * ENEMIES[g.type].cost, 0));
  }

  const TYPE_ALIASES = {
    grunt: ['grunt', 'пехотинец', 'пехота', 'infantry', 'soldier', 'footman'],
    runner: ['runner', 'волк', 'wolf', 'волки', 'wolves', 'fast'],
    swarm: ['swarm', 'гоблин', 'goblin', 'гоблины', 'goblins'],
    knight: ['knight', 'рыцарь', 'рыцари', 'knights', 'armored', 'armoured'],
    ogre: ['ogre', 'огр', 'огры', 'ogres', 'brute']
  };
  function normType(v) {
    const s = String(v || '').trim().toLowerCase();
    return ENEMY_TYPES.find(tp => TYPE_ALIASES[tp].includes(s)) || null;
  }
  function normRoad(v, n) {
    if (typeof v === 'string' && /^[a-c]$/i.test(v.trim())) return clamp(ROAD_LETTERS.indexOf(v.trim().toUpperCase()), 0, n - 1);
    const i = Math.floor(Number(v));
    return Number.isFinite(i) ? clamp(i, 0, n - 1) : 0;
  }

  // Turns whatever JEV sent into a legal plan; over-budget waves are trimmed, cheapest-to-lose units first.
  function sanitizePlan(raw, map, mapIndex, difficulty) {
    const notes = [];
    const src = raw && Array.isArray(raw.waves) ? raw.waves : [];
    if (src.length !== RULES.waves) notes.push(`волн прислано: ${src.length}, нужно ${RULES.waves}`);
    const waves = [];
    for (let w = 0; w < RULES.waves; w++) {
      const rawGroups = Array.isArray(src[w]) ? src[w] : (src[w] && Array.isArray(src[w].groups) ? src[w].groups : []);
      const groups = rawGroups.map(g => ({
        type: normType(g && g.type), count: Math.max(0, Math.floor(Number(g && g.count) || 0)),
        road: normRoad(g && g.road, map.roads.length), delay: clamp(Number(g && g.delay) || 0, 0, 12)
      })).filter(g => g.type && g.count > 0).slice(0, 8);
      const budget = waveBudget(mapIndex, w, difficulty);
      let cost = groups.reduce((a, g) => a + g.count * ENEMIES[g.type].cost, 0);
      if (cost > budget) {
        notes.push(`волна ${w + 1}: ${cost} > бюджета ${budget}, урезано`);
        while (cost > budget) {
          const g = groups.reduce((m, g) => (g.count > 0 && (!m || g.count * ENEMIES[g.type].cost > m.count * ENEMIES[m.type].cost) ? g : m), null);
          g.count--; cost -= ENEMIES[g.type].cost;
        }
      }
      waves.push({ groups: groups.filter(g => g.count > 0) });
    }
    return { plan: { waves }, notes };
  }

  // ---------- JEV contract ----------
  const PLAN_SCHEMA = {
    type: 'object', additionalProperties: false,
    required: ['strategy', 'taunt', 'waves'],
    properties: {
      strategy: { type: 'string', description: 'Замысел атаки, 1–3 предложения по-русски' },
      taunt: { type: 'string', description: 'Короткая угроза защитнику' },
      waves: {
        type: 'array', minItems: RULES.waves, maxItems: RULES.waves,
        items: {
          type: 'object', additionalProperties: false, required: ['groups'],
          properties: {
            groups: {
              type: 'array', minItems: 1, maxItems: 8,
              items: {
                type: 'object', additionalProperties: false, required: ['type', 'count', 'road', 'delay'],
                properties: {
                  type: { type: 'string', enum: ENEMY_TYPES },
                  count: { type: 'integer', minimum: 1 },
                  road: { type: 'integer', minimum: 0, maximum: 2 },
                  delay: { type: 'number', minimum: 0, maximum: 12 }
                }
              }
            }
          }
        }
      }
    }
  };

  function asciiMap(map, defense) {
    const rows = [];
    for (let y = 0; y < ROWS; y++) {
      let line = '';
      for (let x = 0; x < COLS; x++) {
        const slot = defense.findIndex(s => Math.floor(s.x + .5) === x && Math.floor(s.y + .5) === y);
        const mask = map.roadGrid[key(x, y)];
        if (slot >= 0) line += String(slot + 1);
        else if (mask) line += (mask & (mask - 1)) ? '+' : ROAD_LETTERS[Math.log2(mask)];
        else line += '.';
      }
      rows.push(line);
    }
    return rows.join('\n');
  }

  // How many tiles of each road every tower can shoot at.
  function exposure(map, defense) {
    return map.roads.map(r => defense.map(t => {
      const cx = t.x + .5, cy = t.y + .5, r2 = TOWERS[t.type].range ** 2;
      return r.samples.filter(s => s.onMap && (s.x - cx) ** 2 + (s.y - cy) ** 2 <= r2).length * .5;
    }));
  }

  function summarizePlan(plan) {
    return plan.waves.map((w, i) => `волна ${i + 1}: ` + (w.groups.length ? w.groups.map(g => `${g.count}×${g.type}→${ROAD_LETTERS[g.road]}`).join(', ') : 'пусто')).join('; ');
  }

  function describeBattlefield(map, defense, mapIndex, history, difficulty) {
    const exp = exposure(map, defense);
    const roadLines = map.roads.map((r, i) => {
      const byType = {};
      defense.forEach((t, j) => { if (exp[i][j] > 0) byType[t.type] = (byType[t.type] || 0) + exp[i][j]; });
      const towers = defense.map((t, j) => exp[i][j] > 0 ? `#${j + 1} ${t.type} ${exp[i][j].toFixed(1)} кл.` : null).filter(Boolean).join(', ') || 'нет';
      return `Дорога ${i} (${r.letter} на схеме): вход ${SIDE_RU[r.entry.side]} → выход ${SIDE_RU[r.exit.side]}, длина ${r.path.len.toFixed(1)} кл., в центральной зоне ${Math.round(r.stats.focusShare * 100)}% пути. ` +
        `Под обстрелом: ${towers}. Сумма по типам: ${TOWER_TYPES.map(tp => `${tp} ${(byType[tp] || 0).toFixed(1)}`).join(', ')}.`;
    });
    const budgets = Array.from({ length: RULES.waves }, (_, w) => waveBudget(mapIndex, w, difficulty));
    const lives = diffOf(difficulty).lives;
    const towerLines = TOWER_TYPES.map(tp => {
      const t = TOWERS[tp];
      return `- ${tp} (${t.name}, ${t.role}): дальность ${t.range}, ${t.rate} выстр/с, урон ${t.dmg}` +
        (t.magic ? ', магия — игнорирует броню' : ', физический — режется бронёй') +
        (t.splash ? `, по площади радиус ${t.splash}` : ', одна цель') +
        (t.slow ? `, замедляет на ${t.slow * 100}% на ${t.slowDur} с и снижает броню на ${t.weaken * 100}% (+15% урона) на ${t.weakenDur} с` : '') +
        (tp === 'bomb' ? ', снаряд летит 0.7 с — быстрые цели часто успевают уйти из взрыва' : '');
    });
    const enemyLines = ENEMY_TYPES.map(tp => {
      const e = ENEMIES[tp];
      return `- ${tp} (${e.name}): здоровье ${e.hp}, скорость ${e.speed} кл/с, броня ${Math.round(e.armor * 100)}%, цена ${e.cost}, отнимает жизней при прорыве: ${e.leak}, интервал в колонне ${e.gap} с — ${e.note}`;
    });
    const hist = history.map((h, i) => `Раунд ${i + 1}: твой план — ${summarizePlan(h.plan)}. Против той защиты прорвалось ${h.result.leakedCount} из ${h.result.spawned} (−${h.result.livesLost} жизней), ` +
      `прорвались: ${Object.entries(h.result.leaked).map(([k, v]) => `${k} ×${v}`).join(', ') || 'никто'}. После этого защитник перестроил башни.`);

    return [
      `Сложность: ${diffOf(difficulty).name}. Карта ${mapIndex + 1} «${map.layout}», поле ${COLS}×${ROWS}. Схема (A/B/C — дороги, + — общий участок, 1–8 — башни, . — трава):`,
      asciiMap(map, defense),
      '',
      'Башни защитника:',
      defense.map((t, j) => `#${j + 1}: ${t.type} (${TOWERS[t.type].name}) в клетке x=${t.x}, y=${t.y}`).join('\n'),
      '',
      'Дороги:', ...roadLines,
      '',
      'Характеристики башен:', ...towerLines,
      '',
      'Твои юниты:', ...enemyLines,
      '',
      `Правила: у защитника ${lives} жизней; защита проиграла, если жизни кончились. ${RULES.waves} волн, волна k стартует в момент ${RULES.waveGap}·(k−1) с. ` +
      `Бюджет волн: ${budgets.join(', ')} (неистраченное сгорает, превышение будет урезано). Юниты в группе выходят колонной.`,
      hist.length ? '\nИстория:\n' + hist.join('\n') : ''
    ].join('\n');
  }

  const JEV_ROLE = 'Ты — JEV, командующий армией вторжения в tower defense. Ты играешь ЗА ВРАГА: твоя задача — провести к выходам как можно больше юнитов и отнять у защитника максимум жизней. ' +
    'Ищи слабые места защиты: дороги с малым обстрелом, нехватку магов против брони, нехватку бомб против толпы, нехватку алхимиков и лучников против быстрых.';

  // Chat models (jev-router) write the whole plan as JSON.
  function buildJevMessages(map, defense, mapIndex, history, difficulty) {
    const user = describeBattlefield(map, defense, mapIndex, history, difficulty) + '\n\n' +
      'Группа = отряд одного типа на одну дорогу; delay — задержка старта группы от начала волны (0–12 с).\n' +
      'Формат ответа: {"strategy": "…", "taunt": "…", "waves": [{"groups": [{"type": "knight", "count": 4, "road": 0, "delay": 0}]}, … ровно 5 волн]}. road — номер дороги (0, 1, 2).';
    return [{ role: 'system', content: JEV_ROLE + ' Отвечай ТОЛЬКО JSON-объектом по схеме, без пояснений вокруг.' }, { role: 'user', content: user }];
  }

  // JEV itself is a decisions model: for every wave it picks an army from ARCHETYPES and a road.
  function buildJevDecision(map, defense, mapIndex, history, difficulty) {
    const army = Object.fromEntries(ARCHETYPES.map(a => [a.key, `${a.name}: ${a.desc}`]));
    const roads = Object.fromEntries(map.roads.map(r => [r.letter, `всю волну по дороге ${r.letter} (вход ${SIDE_RU[r.entry.side]})`]));
    roads.ALL = 'разделить волну между всеми дорогами';
    const questions = {};
    for (let w = 1; w <= RULES.waves; w++) {
      questions[`army_${w}`] = { type: 'choice', instructions: `Каким составом атаковать в волне ${w}, чтобы прорваться через эту защиту?`, criteria: army };
      questions[`road_${w}`] = { type: 'choice', instructions: `По какой дороге вести волну ${w}?`, criteria: roads };
    }
    return { state: JEV_ROLE + '\n\n' + describeBattlefield(map, defense, mapIndex, history, difficulty), questions };
  }

  // Turns JEV's answers into a plan; each wave spends its whole budget on the chosen army.
  function decisionToPlan(answers, map, mapIndex, difficulty) {
    const waves = [], picks = [], notes = [];
    for (let w = 1; w <= RULES.waves; w++) {
      const a = answers && answers[`army_${w}`], r = answers && answers[`road_${w}`];
      let arch = a && ARCHETYPES.find(x => x.key === a.choice);
      if (!arch) { arch = ARCHETYPES[4]; notes.push(`волна ${w}: нет выбора армии, взят смешанный строй`); }
      let road = r && r.choice === 'ALL' ? 'split' : r ? ROAD_LETTERS.indexOf(r.choice) : -1;
      if (road !== 'split' && (road < 0 || road >= map.roads.length)) { road = 'split'; notes.push(`волна ${w}: нет выбора дороги, волна разделена`); }
      waves.push({ groups: waveGroups(map, waveBudget(mapIndex, w - 1, difficulty), arch.mix, road) });
      picks.push({
        wave: w, army: arch.key, armyName: arch.name, road: road === 'split' ? 'ALL' : ROAD_LETTERS[road],
        armyConfidence: a ? a.confidence : null, armyProb: a && a.probabilities ? a.probabilities[arch.key] : null,
        roadConfidence: r ? r.confidence : null, roadProb: r && r.probabilities ? r.probabilities[r.choice] : null
      });
    }
    const strategy = picks.map(p => `в${p.wave}: ${p.armyName} → ${p.road === 'ALL' ? 'все дороги' : p.road}`).join('; ');
    return { plan: { waves }, picks, strategy, notes };
  }

  function parseJevReply(text) {
    if (!text) throw new Error('пустой ответ');
    const cleaned = String(text).replace(/```(?:json)?/gi, '');
    const start = cleaned.indexOf('{'), end = cleaned.lastIndexOf('}');
    if (start < 0 || end <= start) throw new Error('в ответе нет JSON');
    return JSON.parse(cleaned.slice(start, end + 1));
  }

  return {
    COLS, ROWS, CENTER, FOCUS, RULES, TOWERS, TOWER_TYPES, ENEMIES, ENEMY_TYPES, LAYOUTS, ARCHETYPES, ROAD_LETTERS, SIDE_RU, PLAN_SCHEMA,
    DIFFICULTIES, DIFFICULTY_KEYS, makeRng, inFocus, waveBudget, generateMap, buildRoads, validateMap, Battle, simulate, scoreResult, initialDefense, optimizeDefense,
    localEnemy, archetypePlan, sanitizePlan, planCost, summarizePlan, describeBattlefield, buildJevMessages, buildJevDecision, decisionToPlan,
    parseJevReply, exposure, asciiMap, posAt, tick
  };
});
