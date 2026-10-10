/* JEV Map Forge — canvas drawing in the look of the reference: bright grass, sandy roads,
 * forest border, stone gates at the entries, banners at the exits, round tower pads. */
(function () {
  'use strict';
  const F = window.Forge;

  const C = {
    grass: '#7dbb45', grassLight: 'rgba(255,255,190,.07)', grassDark: 'rgba(30,80,10,.09)', tuft: '#5e9c33',
    roadShade: 'rgba(55,95,25,.35)', roadEdge: '#bf8d48', road: '#e5c07a', roadMid: '#efd497', pebble: '#c9a160',
    crownDark: '#2f6a28', crown: '#3f8a33', crownLight: '#63ae45', trunk: '#6b4423',
    stone: '#9aa0a6', stoneDark: '#5f656c', stoneLight: '#c4c9cd',
    pad: '#d8b26c', padRing: '#8a6a3c', route: '#7d1020', focus: 'rgba(255,255,255,.75)'
  };

  // ---------- static layer ----------
  function drawStatic(ctx, map, defense, T, opts = {}) {
    const W = F.COLS * T, H = F.ROWS * T;
    const rng = F.makeRng(map.decorSeed || 1);
    ctx.save();
    // Border trees and road ends reach past the field; keep them inside it when the map is drawn into a larger sheet.
    ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip();
    ctx.fillStyle = C.grass;
    ctx.fillRect(0, 0, W, H);
    for (let i = 0; i < 150; i++) {
      ctx.fillStyle = i % 2 ? C.grassLight : C.grassDark;
      ctx.beginPath();
      ctx.ellipse(rng() * W, rng() * H, (.6 + rng() * 1.6) * T, (.4 + rng() * 1.1) * T, rng() * 3, 0, 7);
      ctx.fill();
    }
    const roadAt = (x, y) => x >= 0 && y >= 0 && x < F.COLS && y < F.ROWS && map.roadGrid[y * F.COLS + x];
    const nearRoad = (x, y, r) => {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (roadAt(x + dx, y + dy)) return true;
      return false;
    };
    const slotTiles = defense ? defense : map.slots;
    const nearSlot = (x, y, r) => slotTiles.some(s => Math.max(Math.abs(s.x - x), Math.abs(s.y - y)) <= r);

    ctx.strokeStyle = C.tuft; ctx.lineWidth = Math.max(1, T / 22); ctx.lineCap = 'round';
    for (let i = 0; i < 320; i++) {
      const x = rng() * W, y = rng() * H;
      if (roadAt((x / T) | 0, (y / T) | 0)) continue;
      const s = T * (.08 + rng() * .06);
      ctx.beginPath();
      ctx.moveTo(x - s, y - s); ctx.lineTo(x, y); ctx.lineTo(x + s * .3, y - s * 1.3); ctx.moveTo(x, y); ctx.lineTo(x + s, y - s * .8);
      ctx.stroke();
    }
    // Flowers
    for (let i = 0; i < 60; i++) {
      const x = rng() * W, y = rng() * H;
      if (roadAt((x / T) | 0, (y / T) | 0)) continue;
      ctx.fillStyle = ['#fff6d0', '#ffd94a', '#f59ab8'][i % 3];
      ctx.beginPath(); ctx.arc(x, y, T * .05, 0, 7); ctx.fill();
    }

    // Roads: soft shade, then edge, body and lighter centre for all roads together so merges blend.
    const strokeRoads = (color, width) => {
      ctx.strokeStyle = color; ctx.lineWidth = width * T; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      for (const r of map.roads) {
        ctx.beginPath();
        r.path.pts.forEach((p, i) => (i ? ctx.lineTo(p.x * T, p.y * T) : ctx.moveTo(p.x * T, p.y * T)));
        ctx.stroke();
      }
    };
    strokeRoads(C.roadShade, 1.12);
    strokeRoads(C.roadEdge, .94);
    strokeRoads(C.road, .78);
    strokeRoads(C.roadMid, .38);
    ctx.fillStyle = C.pebble;
    for (const r of map.roads) for (let i = 0; i < r.samples.length; i += 3) {
      const s = r.samples[i];
      if (rng() < .5) continue;
      ctx.beginPath();
      ctx.ellipse((s.x + (rng() - .5) * .6) * T, (s.y + (rng() - .5) * .6) * T, T * .045, T * .03, 0, 0, 7);
      ctx.fill();
    }

    // Trees and rocks: forest along the border, scattered clumps far from roads and pads.
    const props = [];
    for (let y = -1; y <= F.ROWS; y++) for (let x = -1; x <= F.COLS; x++) {
      const border = x <= 0 || y <= 0 || x >= F.COLS - 1 || y >= F.ROWS - 1;
      if (nearRoad(x, y, 1) || nearSlot(x, y, 1)) continue;
      const far = !nearRoad(x, y, 2);
      if (border ? rng() < .85 : far && rng() < .22) props.push({ kind: 'tree', x: x + .5 + (rng() - .5) * .5, y: y + .5 + (rng() - .5) * .5, s: .75 + rng() * .45 });
      else if (!border && rng() < .05) props.push({ kind: 'rock', x: x + .5, y: y + .5, s: .5 + rng() * .4 });
      else if (!border && far && rng() < .08) props.push({ kind: 'bush', x: x + .5, y: y + .5, s: .5 + rng() * .3 });
    }
    props.sort((a, b) => a.y - b.y).forEach(p => (p.kind === 'tree' ? tree : p.kind === 'rock' ? rock : bush)(ctx, p.x * T, p.y * T, p.s * T, rng));

    map.entries.forEach(e => gate(ctx, e, T));
    map.exits.forEach(e => exitBanner(ctx, e, T));

    if (opts.focus) {
      ctx.setLineDash([T * .3, T * .2]);
      ctx.strokeStyle = C.focus; ctx.lineWidth = Math.max(1.5, T * .06);
      ctx.beginPath();
      ctx.ellipse(F.CENTER.x * T, F.CENTER.y * T, F.FOCUS.rx * T, F.FOCUS.ry * T, 0, 0, 7);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(255,255,255,.08)'; ctx.fill();
      if (T >= 24) {
        ctx.font = `600 ${T * .32}px Rubik, system-ui, sans-serif`; ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(255,255,255,.9)';
        ctx.fillText('зона взгляда', F.CENTER.x * T, (F.CENTER.y - F.FOCUS.ry) * T - T * .15);
      }
    }
    if (opts.routes) drawRoutes(ctx, map, T);

    if (defense) {
      if (opts.coverage) defense.forEach(t => {
        ctx.fillStyle = hexA(F.TOWERS[t.type].color, .12); ctx.strokeStyle = hexA(F.TOWERS[t.type].color, .5);
        ctx.lineWidth = Math.max(1, T * .04);
        ctx.beginPath(); ctx.arc((t.x + .5) * T, (t.y + .5) * T, F.TOWERS[t.type].range * T, 0, 7); ctx.fill(); ctx.stroke();
      });
      defense.map((t, i) => ({ ...t, i })).sort((a, b) => a.y - b.y).forEach(t => drawTower(ctx, t, T, t.i + 1, opts.labels !== false));
    } else {
      map.slots.forEach((s, i) => emptyPad(ctx, (s.x + .5) * T, (s.y + .5) * T, T, i + 1, opts.labels !== false));
    }
    ctx.restore();
  }

  function hexA(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
  }

  function tree(ctx, x, y, s, rng) {
    ctx.fillStyle = 'rgba(20,50,10,.28)';
    ctx.beginPath(); ctx.ellipse(x + s * .08, y + s * .32, s * .5, s * .2, 0, 0, 7); ctx.fill();
    ctx.fillStyle = C.trunk; ctx.fillRect(x - s * .06, y + s * .05, s * .12, s * .28);
    const blobs = [[0, -.12, .42], [-.22, .02, .3], [.22, .02, .3], [0, -.36, .28]];
    ctx.fillStyle = C.crownDark;
    blobs.forEach(([dx, dy, r]) => { ctx.beginPath(); ctx.arc(x + dx * s, y + dy * s, r * s, 0, 7); ctx.fill(); });
    ctx.fillStyle = C.crown;
    blobs.forEach(([dx, dy, r]) => { ctx.beginPath(); ctx.arc(x + dx * s - s * .03, y + dy * s - s * .05, r * s * .82, 0, 7); ctx.fill(); });
    ctx.fillStyle = C.crownLight;
    ctx.beginPath(); ctx.arc(x - s * .1, y - s * .3, s * .14, 0, 7); ctx.fill();
    if (rng() < .3) { ctx.beginPath(); ctx.arc(x + s * .16, y - s * .08, s * .08, 0, 7); ctx.fill(); }
  }
  function bush(ctx, x, y, s) {
    ctx.fillStyle = 'rgba(20,50,10,.25)';
    ctx.beginPath(); ctx.ellipse(x, y + s * .22, s * .45, s * .15, 0, 0, 7); ctx.fill();
    ctx.fillStyle = C.crown;
    [[-.18, 0, .24], [.18, 0, .24], [0, -.12, .26]].forEach(([dx, dy, r]) => { ctx.beginPath(); ctx.arc(x + dx * s, y + dy * s, r * s, 0, 7); ctx.fill(); });
    ctx.fillStyle = C.crownLight;
    ctx.beginPath(); ctx.arc(x - s * .05, y - s * .2, s * .09, 0, 7); ctx.fill();
  }
  function rock(ctx, x, y, s) {
    ctx.fillStyle = 'rgba(20,40,10,.25)';
    ctx.beginPath(); ctx.ellipse(x, y + s * .18, s * .4, s * .13, 0, 0, 7); ctx.fill();
    ctx.fillStyle = C.stoneDark;
    ctx.beginPath(); ctx.ellipse(x, y, s * .36, s * .26, 0, 0, 7); ctx.fill();
    ctx.fillStyle = C.stone;
    ctx.beginPath(); ctx.ellipse(x - s * .04, y - s * .05, s * .3, s * .2, 0, 0, 7); ctx.fill();
    ctx.fillStyle = C.stoneLight;
    ctx.beginPath(); ctx.ellipse(x - s * .1, y - s * .1, s * .12, s * .07, -.4, 0, 7); ctx.fill();
  }

  const SIDE_ANGLE = { top: 0, right: Math.PI / 2, bottom: Math.PI, left: -Math.PI / 2 };
  // Stone arch straddling the road where it enters, drawn for the top edge and rotated for the others.
  function gate(ctx, e, T) {
    const cx = e.side === 'left' ? 0 : e.side === 'right' ? F.COLS * T : (e.x + .5) * T;
    const cy = e.side === 'top' ? 0 : e.side === 'bottom' ? F.ROWS * T : (e.y + .5) * T;
    ctx.save();
    ctx.translate(cx, cy); ctx.rotate(SIDE_ANGLE[e.side]);
    const w = T * 1.5, h = T * .95;
    ctx.fillStyle = 'rgba(0,0,0,.25)';
    ctx.beginPath(); ctx.ellipse(0, h * .95, w * .6, T * .18, 0, 0, 7); ctx.fill();
    ctx.fillStyle = C.stoneDark;
    ctx.beginPath();
    ctx.moveTo(-w / 2, h); ctx.lineTo(-w / 2, h * .25); ctx.quadraticCurveTo(0, -h * .45, w / 2, h * .25); ctx.lineTo(w / 2, h);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = C.stone;
    ctx.beginPath();
    ctx.moveTo(-w / 2 + T * .08, h - T * .06); ctx.lineTo(-w / 2 + T * .08, h * .28); ctx.quadraticCurveTo(0, -h * .35, w / 2 - T * .08, h * .28); ctx.lineTo(w / 2 - T * .08, h - T * .06);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#2a2f36';
    ctx.beginPath();
    ctx.moveTo(-w * .27, h); ctx.lineTo(-w * .27, h * .45); ctx.quadraticCurveTo(0, h * .02, w * .27, h * .45); ctx.lineTo(w * .27, h);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(160,90,255,.35)';
    ctx.fillRect(-w * .22, h * .5, w * .44, h * .5);
    ctx.fillStyle = C.stoneLight;
    for (let i = -2; i <= 2; i++) ctx.fillRect(i * w * .18 - T * .05, -h * .02 + Math.abs(i) * h * .08, T * .1, T * .07);
    ctx.restore();
    // Red entry arrow like in the reference sketch.
    ctx.save();
    ctx.translate(cx, cy); ctx.rotate(SIDE_ANGLE[e.side]);
    ctx.fillStyle = 'rgba(160,20,35,.85)'; ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.lineWidth = Math.max(1, T * .04);
    const y0 = h * 1.15, a = T * .28;
    ctx.beginPath();
    ctx.moveTo(-a * .45, y0); ctx.lineTo(a * .45, y0); ctx.lineTo(a * .45, y0 + a * .8); ctx.lineTo(a, y0 + a * .8);
    ctx.lineTo(0, y0 + a * 1.6); ctx.lineTo(-a, y0 + a * .8); ctx.lineTo(-a * .45, y0 + a * .8); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.restore();
  }

  // Two blue shields on poles either side of the road where it leaves the map.
  function exitBanner(ctx, e, T) {
    const cx = (e.x + .5) * T, cy = (e.y + .5) * T;
    const perp = e.side === 'left' || e.side === 'right' ? [0, 1] : [1, 0];
    [-1, 1].forEach(sg => {
      const x = cx + perp[0] * sg * T * .95, y = cy + perp[1] * sg * T * .95;
      ctx.fillStyle = 'rgba(0,0,0,.25)';
      ctx.beginPath(); ctx.ellipse(x, y + T * .32, T * .22, T * .08, 0, 0, 7); ctx.fill();
      ctx.fillStyle = '#6b4423'; ctx.fillRect(x - T * .03, y - T * .2, T * .06, T * .52);
      ctx.fillStyle = '#2f6fb8'; ctx.strokeStyle = '#d8e6f5'; ctx.lineWidth = Math.max(1, T * .04);
      ctx.beginPath();
      ctx.moveTo(x - T * .2, y - T * .42); ctx.lineTo(x + T * .2, y - T * .42); ctx.lineTo(x + T * .2, y - T * .12);
      ctx.quadraticCurveTo(x + T * .18, y + T * .06, x, y + T * .12); ctx.quadraticCurveTo(x - T * .18, y + T * .06, x - T * .2, y - T * .12);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#f2d36b';
      ctx.beginPath(); ctx.arc(x, y - T * .2, T * .06, 0, 7); ctx.fill();
    });
  }

  function drawRoutes(ctx, map, T) {
    map.roads.forEach((r, k) => {
      const off = (k - (map.roads.length - 1) / 2) * .12;
      const pts = r.path.pts.filter((_, i) => i % 3 === 0 || i === r.path.pts.length - 1);
      ctx.strokeStyle = 'rgba(125,16,32,.9)'; ctx.lineWidth = T * .14; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.beginPath();
      pts.forEach((p, i) => (i ? ctx.lineTo((p.x + off) * T, (p.y + off) * T) : ctx.moveTo((p.x + off) * T, (p.y + off) * T)));
      ctx.stroke();
      const n = pts.length, a = pts[n - 3] || pts[0], b = pts[n - 1];
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      ctx.save();
      ctx.translate((b.x + off) * T, (b.y + off) * T); ctx.rotate(ang);
      ctx.fillStyle = 'rgba(125,16,32,.95)';
      ctx.beginPath(); ctx.moveTo(T * .1, 0); ctx.lineTo(-T * .4, -T * .3); ctx.lineTo(-T * .4, T * .3); ctx.closePath(); ctx.fill();
      ctx.restore();
      const label = r.samples[Math.floor(r.samples.length * .5)];
      if (T >= 24) {
        ctx.fillStyle = 'rgba(125,16,32,.95)';
        ctx.beginPath(); ctx.arc(label.x * T, label.y * T, T * .26, 0, 7); ctx.fill();
        ctx.fillStyle = '#fff'; ctx.font = `700 ${T * .3}px Rubik, system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(r.letter, label.x * T, label.y * T + 1);
      }
    });
  }

  function padBase(ctx, x, y, T) {
    ctx.fillStyle = 'rgba(40,30,10,.3)';
    ctx.beginPath(); ctx.ellipse(x, y + T * .22, T * .5, T * .22, 0, 0, 7); ctx.fill();
    ctx.fillStyle = C.padRing;
    ctx.beginPath(); ctx.ellipse(x, y + T * .12, T * .48, T * .32, 0, 0, 7); ctx.fill();
    ctx.fillStyle = C.pad;
    ctx.beginPath(); ctx.ellipse(x, y + T * .1, T * .41, T * .26, 0, 0, 7); ctx.fill();
  }
  function label(ctx, x, y, T, n) {
    if (T < 20) return;
    ctx.fillStyle = 'rgba(25,20,10,.82)';
    ctx.beginPath(); ctx.arc(x + T * .38, y - T * .38, T * .17, 0, 7); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = `700 ${T * .22}px Rubik, system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(String(n), x + T * .38, y - T * .37);
  }
  function emptyPad(ctx, x, y, T, n, withLabel) {
    padBase(ctx, x, y, T);
    ctx.fillStyle = '#7a5530'; ctx.fillRect(x - T * .03, y - T * .3, T * .06, T * .38);
    ctx.fillStyle = '#efe3c4'; ctx.strokeStyle = '#7a5530'; ctx.lineWidth = Math.max(1, T * .03);
    ctx.fillRect(x - T * .17, y - T * .36, T * .34, T * .2); ctx.strokeRect(x - T * .17, y - T * .36, T * .34, T * .2);
    if (withLabel) label(ctx, x, y, T, n);
  }

  function drawTower(ctx, t, T, n, withLabel) {
    const x = (t.x + .5) * T, y = (t.y + .5) * T;
    padBase(ctx, x, y, T);
    towerIcon(ctx, t.type, x, y, T);
    if (withLabel) label(ctx, x, y, T, n);
  }

  // Small procedural tower sprites, one silhouette per role.
  function towerIcon(ctx, type, x, y, T) {
    const s = T;
    ctx.lineWidth = Math.max(1, s * .035); ctx.strokeStyle = 'rgba(30,20,10,.85)';
    const poly = (pts, fill) => { ctx.fillStyle = fill; ctx.beginPath(); pts.forEach(([px, py], i) => (i ? ctx.lineTo(x + px * s, y + py * s) : ctx.moveTo(x + px * s, y + py * s))); ctx.closePath(); ctx.fill(); ctx.stroke(); };
    if (type === 'archer') {
      poly([[-.22, .12], [.22, .12], [.18, -.28], [-.18, -.28]], '#9a6a3a');
      ctx.strokeStyle = 'rgba(60,35,15,.6)';
      ctx.beginPath(); ctx.moveTo(x - s * .2, y - s * .05); ctx.lineTo(x + s * .2, y - s * .05); ctx.stroke();
      ctx.strokeStyle = 'rgba(30,20,10,.85)';
      poly([[-.3, -.26], [.3, -.26], [0, -.58]], '#4f8a3c');
      ctx.fillStyle = '#2a1a0e'; ctx.fillRect(x - s * .05, y - s * .2, s * .1, s * .1);
      ctx.fillStyle = '#d9473a'; ctx.fillRect(x, y - s * .74, s * .16, s * .09);
      ctx.fillStyle = '#5a3b1f'; ctx.fillRect(x - s * .015, y - s * .74, s * .03, s * .18);
    } else if (type === 'alchemist') {
      poly([[-.25, .12], [.25, .12], [.22, -.18], [-.22, -.18]], '#c9b48a');
      ctx.fillStyle = '#9b5bd0';
      ctx.beginPath(); ctx.arc(x, y - s * .18, s * .25, Math.PI, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
      poly([[-.06, -.42], [.06, -.42], [.13, -.56], [-.13, -.56]], '#7be06a');
      ctx.fillStyle = '#b8f7a8';
      [[-.1, -.66, .04], [.06, -.72, .05], [-.02, -.8, .03]].forEach(([dx, dy, r]) => { ctx.beginPath(); ctx.arc(x + dx * s, y + dy * s, r * s, 0, 7); ctx.fill(); });
      ctx.fillStyle = '#2a1a0e'; ctx.fillRect(x - s * .05, y - s * .06, s * .1, s * .16);
    } else if (type === 'mage') {
      poly([[-.17, .12], [.17, .12], [.12, -.32], [-.12, -.32]], '#cfd2de');
      poly([[-.22, -.3], [.22, -.3], [0, -.78]], '#3f6fd0');
      const g = ctx.createRadialGradient(x, y - s * .82, 0, x, y - s * .82, s * .2);
      g.addColorStop(0, 'rgba(200,235,255,1)'); g.addColorStop(1, 'rgba(120,180,255,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y - s * .82, s * .2, 0, 7); ctx.fill();
      ctx.fillStyle = '#e8f4ff'; ctx.beginPath(); ctx.arc(x, y - s * .82, s * .06, 0, 7); ctx.fill();
      ctx.fillStyle = '#6fb1ff'; ctx.fillRect(x - s * .04, y - s * .16, s * .08, s * .12);
    } else if (type === 'bomb') {
      poly([[-.3, .12], [.3, .12], [.26, -.14], [-.26, -.14]], '#8f8a80');
      ctx.fillStyle = '#6d685f'; ctx.fillRect(x - s * .26, y - s * .2, s * .12, s * .08); ctx.fillRect(x + s * .14, y - s * .2, s * .12, s * .08);
      ctx.save(); ctx.translate(x, y - s * .2); ctx.rotate(-.6);
      ctx.fillStyle = '#2b2b30'; ctx.fillRect(-s * .1, -s * .38, s * .2, s * .4); ctx.strokeRect(-s * .1, -s * .38, s * .2, s * .4);
      ctx.fillStyle = '#4a4a52'; ctx.fillRect(-s * .12, -s * .42, s * .24, s * .07);
      ctx.restore();
      ctx.fillStyle = '#1f1f24'; ctx.beginPath(); ctx.arc(x + s * .2, y - s * .02, s * .08, 0, 7); ctx.fill();
      ctx.fillStyle = '#ffb347'; ctx.beginPath(); ctx.arc(x + s * .26, y - s * .1, s * .04, 0, 7); ctx.fill();
    }
  }

  // ---------- dynamic layer ----------
  const ENEMY_LOOK = {
    grunt:  { r: .22, fill: '#b5533c', edge: '#5a2418' },
    runner: { r: .2,  fill: '#8f8f99', edge: '#3d3d44' },
    swarm:  { r: .14, fill: '#6aa84f', edge: '#284a1c' },
    knight: { r: .25, fill: '#a9b6c8', edge: '#38404c' },
    ogre:   { r: .36, fill: '#7d8a3a', edge: '#363d15' }
  };

  function drawBattle(ctx, battle, T) {
    const t = battle.time;
    for (const e of [...battle.enemies].sort((a, b) => a.y - b.y)) {
      const look = ENEMY_LOOK[e.type], x = e.x * T, y = e.y * T, r = look.r * T;
      ctx.fillStyle = 'rgba(0,0,0,.25)';
      ctx.beginPath(); ctx.ellipse(x, y + r * .8, r, r * .4, 0, 0, 7); ctx.fill();
      if (e.slowUntil > t) {
        ctx.strokeStyle = 'rgba(170,100,255,.9)'; ctx.lineWidth = T * .06;
        ctx.beginPath(); ctx.arc(x, y, r + T * .06, 0, 7); ctx.stroke();
      }
      ctx.fillStyle = look.fill; ctx.strokeStyle = look.edge; ctx.lineWidth = Math.max(1, T * .04);
      if (e.type === 'runner') {
        const p = F.posAt(battle.map.roads[e.road].path, e.s + .2, e.seg);
        const ang = Math.atan2(p.y - e.y, p.x - e.x);
        ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
        ctx.beginPath(); ctx.ellipse(0, 0, r * 1.35, r * .8, 0, 0, 7); ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(r * 1.1, -r * .5); ctx.lineTo(r * 1.5, -r * .9); ctx.lineTo(r * 1.4, -r * .3); ctx.fill();
        ctx.restore();
      } else {
        ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill(); ctx.stroke();
      }
      if (e.type === 'knight') {
        ctx.fillStyle = '#3f5f8f';
        ctx.beginPath(); ctx.moveTo(x - r * .9, y - r * .3); ctx.lineTo(x - r * .3, y - r * .3); ctx.lineTo(x - r * .3, y + r * .2); ctx.lineTo(x - r * .6, y + r * .55); ctx.lineTo(x - r * .9, y + r * .2); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#2b3038'; ctx.fillRect(x - r * .35, y - r * .25, r * .7, r * .14);
      } else if (e.type === 'grunt') {
        ctx.fillStyle = '#6d6d72'; ctx.beginPath(); ctx.arc(x, y - r * .15, r * .7, Math.PI, 0); ctx.fill();
      } else if (e.type === 'ogre') {
        ctx.fillStyle = '#f2e6c8';
        ctx.beginPath(); ctx.moveTo(x - r * .4, y + r * .2); ctx.lineTo(x - r * .3, y - r * .1); ctx.lineTo(x - r * .2, y + r * .2); ctx.fill();
        ctx.beginPath(); ctx.moveTo(x + r * .4, y + r * .2); ctx.lineTo(x + r * .3, y - r * .1); ctx.lineTo(x + r * .2, y + r * .2); ctx.fill();
        ctx.fillStyle = '#1b1b10';
        ctx.beginPath(); ctx.arc(x - r * .3, y - r * .35, r * .1, 0, 7); ctx.arc(x + r * .3, y - r * .35, r * .1, 0, 7); ctx.fill();
      } else if (e.type === 'swarm') {
        ctx.fillStyle = '#1b2a12';
        ctx.beginPath(); ctx.arc(x - r * .35, y - r * .2, r * .17, 0, 7); ctx.arc(x + r * .35, y - r * .2, r * .17, 0, 7); ctx.fill();
      }
      if (e.weakUntil > t) {
        ctx.fillStyle = '#9cf27e';
        for (let k = 0; k < 3; k++) {
          const a = t * 3 + k * 2.1;
          ctx.beginPath(); ctx.arc(x + Math.cos(a) * r * .9, y - r * .9 + Math.sin(a * 1.3) * r * .3, T * .04, 0, 7); ctx.fill();
        }
      }
      if (e.hp < e.maxHp) {
        const w = Math.max(r * 2, T * .4), bx = x - w / 2, by = y - r - T * .18;
        ctx.fillStyle = 'rgba(0,0,0,.7)'; ctx.fillRect(bx - 1, by - 1, w + 2, T * .08 + 2);
        ctx.fillStyle = e.hp / e.maxHp > .5 ? '#6fd65a' : e.hp / e.maxHp > .25 ? '#f2c94c' : '#e5533d';
        ctx.fillRect(bx, by, w * e.hp / e.maxHp, T * .08);
      }
    }

    for (const p of battle.projectiles) {
      const x = p.x * T, y = (p.y - (p.arc || 0)) * T;
      if (p.type === 'archer') {
        const ang = Math.atan2(p.ty - p.sy, p.tx - p.sx);
        ctx.strokeStyle = '#4a2f17'; ctx.lineWidth = Math.max(1.5, T * .05);
        ctx.beginPath(); ctx.moveTo(x - Math.cos(ang) * T * .25, y - Math.sin(ang) * T * .25); ctx.lineTo(x, y); ctx.stroke();
      } else if (p.type === 'mage') {
        const g = ctx.createRadialGradient(x, y, 0, x, y, T * .22);
        g.addColorStop(0, 'rgba(225,245,255,1)'); g.addColorStop(.4, 'rgba(110,170,255,.9)'); g.addColorStop(1, 'rgba(80,120,255,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, T * .22, 0, 7); ctx.fill();
      } else if (p.type === 'alchemist') {
        ctx.fillStyle = '#b06cf0'; ctx.strokeStyle = '#3c1f5c'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(x, y, T * .09, 0, 7); ctx.fill(); ctx.stroke();
      } else {
        ctx.fillStyle = '#1d1d22';
        ctx.beginPath(); ctx.arc(x, y, T * .12, 0, 7); ctx.fill();
        ctx.fillStyle = '#ffb347'; ctx.beginPath(); ctx.arc(x + T * .07, y - T * .08, T * .04, 0, 7); ctx.fill();
      }
    }

    for (const fx of battle.effects) {
      const k = (t - fx.t) / fx.life, x = fx.x * T, y = fx.y * T;
      if (fx.kind === 'boom') {
        ctx.fillStyle = `rgba(255,170,60,${.55 * (1 - k)})`;
        ctx.beginPath(); ctx.arc(x, y, fx.r * T * (.4 + .6 * k), 0, 7); ctx.fill();
        ctx.strokeStyle = `rgba(120,60,20,${.7 * (1 - k)})`; ctx.lineWidth = T * .06; ctx.stroke();
      } else if (fx.kind === 'splash') {
        ctx.fillStyle = `rgba(160,90,240,${.35 * (1 - k)})`;
        ctx.beginPath(); ctx.arc(x, y, fx.r * T * (.5 + .5 * k), 0, 7); ctx.fill();
      } else if (fx.kind === 'death') {
        ctx.fillStyle = `rgba(255,255,255,${.6 * (1 - k)})`;
        ctx.beginPath(); ctx.arc(x, y - k * T * .4, T * (.15 + .2 * k), 0, 7); ctx.fill();
      } else if (fx.kind === 'leak') {
        ctx.strokeStyle = `rgba(230,40,40,${1 - k})`; ctx.lineWidth = T * .1;
        ctx.beginPath(); ctx.arc(x, y, T * (.3 + k * .9), 0, 7); ctx.stroke();
      }
    }
  }

  window.ForgeRender = { drawStatic, drawBattle, towerIcon, ENEMY_LOOK };
})();
