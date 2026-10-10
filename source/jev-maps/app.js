/* JEV Map Forge — app: settings, the JEV ↔ defence rounds for each map, cards, replay and export. */
(function () {
  'use strict';
  const F = window.Forge, R = window.ForgeRender, P = window.ForgePipeline;
  const $ = id => document.getElementById(id);
  const MAP_COUNT = 10;
  const STORE = 'jev-forge-settings';
  const ENEMY_COLOR = Object.fromEntries(Object.entries(R.ENEMY_LOOK).map(([k, v]) => [k, v.fill]));

  // ---------- settings ----------
  const settings = Object.assign(
    { apiKey: '', remember: false, model: '~typesafe/jev-latest', difficulty: 'normal', rounds: 2, parallel: 2, useJev: true, seed: 1 + Math.floor(Math.random() * 99999) },
    readStore()
  );
  function readStore() { try { return JSON.parse(localStorage.getItem(STORE)) || {}; } catch { return {}; } }
  function writeStore() {
    try {
      const copy = { ...settings };
      if (!copy.remember) delete copy.apiKey;
      localStorage.setItem(STORE, JSON.stringify(copy));
    } catch { /* storage unavailable: settings just won't persist */ }
  }

  const state = { maps: [], selected: 0, running: false, ctrl: null, overlays: { focus: true, routes: false, coverage: false }, replay: null, speed: 2 };

  // ---------- log ----------
  function log(text, kind = '', mapIndex = null) {
    const li = document.createElement('li');
    li.className = kind;
    const time = document.createElement('time');
    time.textContent = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    li.append(time, (mapIndex != null ? `[карта ${mapIndex + 1}] ` : '') + text);
    const ol = $('log');
    ol.prepend(li);
    while (ol.children.length > 200) ol.lastChild.remove();
  }

  // ---------- records ----------
  function makeRecords(seed) {
    return Array.from({ length: MAP_COUNT }, (_, i) => ({
      index: i, map: F.generateMap(seed * 100 + i, i), difficulty: settings.difficulty, defense: null,
      status: 'idle', statusText: 'ждёт боя', rounds: [], stress: null, final: null
    }));
  }
  function resetRecord(rec) {
    Object.assign(rec, { difficulty: settings.difficulty, defense: null, status: 'idle', statusText: 'ждёт боя', rounds: [], stress: null, final: null });
  }
  const livesOf = rec => F.DIFFICULTIES[rec.difficulty || 'normal'].lives;

  // ---------- one map (rounds live in pipeline.js) ----------
  function runMap(rec, signal) {
    return P.runMap(rec, {
      rounds: settings.rounds, useJev: settings.useJev, apiKey: settings.apiKey, model: settings.model, signal,
      onStatus: (status, text) => {
        rec.status = status; rec.statusText = text;
        updateCard(rec);
        if (state.selected === rec.index) renderInfo();
      },
      onUpdate: () => refreshViewer(rec),
      log: (text, kind) => log(text, kind, rec.index)
    });
  }

  async function runAll() {
    if (state.running) return;
    if (settings.useJev && !settings.apiKey.trim()) {
      log('Нужен ключ OpenRouter, чтобы атаковал JEV. Или снимите галочку «атакует JEV».', 'err');
      $('apiKey').focus();
      return;
    }
    state.running = true;
    state.ctrl = new AbortController();
    const signal = state.ctrl.signal;
    syncButtons();
    state.maps.forEach(resetRecord);
    renderCards(); renderInfo();
    log(`старт: ${MAP_COUNT} карт, сложность «${F.DIFFICULTIES[settings.difficulty].name}», ${settings.rounds} раунд(а), противник — ${settings.useJev ? settings.model : 'локальный'}`);
    const queue = [...state.maps];
    const worker = async () => {
      while (queue.length && !signal.aborted) {
        const rec = queue.shift();
        try { await runMap(rec, signal); }
        catch (e) {
          if (e.status === 401 || e.status === 402) {
            // A bad key or an empty balance fails every map the same way: stop the whole run.
            log(e.status === 401 ? `OpenRouter не принял ключ (${e.message}). Проверьте ключ.` : `На счёте OpenRouter не хватает средств (${e.message}).`, 'err');
            state.ctrl.abort();
          }
          rec.status = 'error'; rec.statusText = signal.aborted ? 'остановлено' : e.message;
          if (!signal.aborted) log('ошибка: ' + e.message, 'err', rec.index);
          updateCard(rec);
        }
        updateProgress();
      }
    };
    await Promise.all(Array.from({ length: Math.min(settings.parallel, MAP_COUNT) }, worker));
    state.running = false;
    state.maps.filter(r => r.status === 'busy' || r.status === 'idle').forEach(r => { r.status = 'idle'; r.statusText = signal.aborted ? 'остановлено' : r.statusText; updateCard(r); });
    log(signal.aborted ? 'остановлено' : 'все карты готовы', signal.aborted ? 'err' : 'ok');
    syncButtons(); updateProgress(); renderInfo();
  }

  // ---------- cards ----------
  function worstLoss(rec) {
    const all = rec.final || [];
    return all.length ? Math.max(0, ...all.map(r => r.livesLost)) : null;
  }
  function mixHtml(defense) {
    if (!defense) return '';
    return '<span class="mix">' + F.TOWER_TYPES.map(tp => {
      const n = defense.filter(t => t.type === tp).length;
      return n ? `<span title="${F.TOWERS[tp].name}"><i style="background:${F.TOWERS[tp].color}"></i>${n}</span>` : '';
    }).join('') + '</span>';
  }

  function renderCards() {
    const box = $('cards');
    box.innerHTML = '';
    state.maps.forEach(rec => {
      const card = document.createElement('button');
      card.className = 'card'; card.type = 'button';
      card.dataset.index = rec.index;
      card.innerHTML = `<canvas width="336" height="196"></canvas><div class="card-head"><b></b><span class="status"></span></div><div class="card-foot"></div>`;
      card.addEventListener('click', () => select(rec.index));
      box.append(card);
      rec.card = card;
      updateCard(rec, true);
    });
  }

  function updateCard(rec, redraw) {
    const card = rec.card;
    if (!card) return;
    card.classList.toggle('sel', state.selected === rec.index);
    card.querySelector('b').textContent = `${rec.index + 1}. ${rec.map.layout}`;
    const st = card.querySelector('.status');
    st.className = 'status ' + rec.status; st.textContent = rec.statusText; st.title = rec.statusText;
    const loss = worstLoss(rec);
    const focus = Math.round(Math.min(...rec.map.roads.map(r => r.stats.focusShare)) * 100);
    card.querySelector('.card-foot').innerHTML = `<span>${F.DIFFICULTIES[rec.difficulty].name} · ${rec.map.roads.length} дор. · центр ≥${focus}%</span>` +
      (loss != null ? `<span class="${loss ? 'lives-bad' : 'lives-ok'}" title="Худший итог финальной защиты против планов JEV">${loss ? '−' + loss + ' ❤' + (rec.final.some(r => r.held === false) ? ' пала' : '') : 'держит'}</span>` : mixHtml(rec.defense));
    if (redraw || rec.cardDefense !== rec.defense) {
      rec.cardDefense = rec.defense;
      const cv = card.querySelector('canvas');
      R.drawStatic(cv.getContext('2d'), rec.map, rec.defense, 14, { labels: false });
    }
  }

  function updateProgress() {
    const done = state.maps.filter(r => r.status === 'done').length;
    $('progressBar').style.width = (done / MAP_COUNT * 100) + '%';
    const busy = state.maps.filter(r => r.status === 'busy').length;
    $('progressText').textContent = state.running ? `готово ${done} из ${MAP_COUNT}, в работе ${busy}` : done ? `готово ${done} из ${MAP_COUNT}` : 'карты построены, башни ещё не расставлены';
  }

  function syncButtons() {
    $('runBtn').disabled = state.running;
    $('runBtn').textContent = settings.useJev ? 'Запустить битву с JEV' : 'Запустить битву (локально)';
    $('stopBtn').hidden = !state.running;
    $('regenBtn').disabled = state.running;
    $('difficulty').disabled = state.running;
    $('importLabel').classList.toggle('disabled', state.running);
    $('exportBtn').disabled = state.running || !state.maps.some(r => r.status === 'done');
  }

  // ---------- viewer ----------
  const stage = $('stage');
  const sctx = stage.getContext('2d');
  const VIEW_T = 40;
  let staticLayer = null, staticKey = '';

  function selected() { return state.maps[state.selected]; }

  function select(i) {
    state.selected = i;
    state.maps.forEach(r => r.card && r.card.classList.toggle('sel', r.index === i));
    buildAttackOptions();
    resetReplay();
    renderInfo();
  }

  function refreshViewer(rec) {
    if (rec.card) updateCard(rec);
    if (state.selected !== rec.index) return;
    const prevValue = $('attackSelect').value;
    buildAttackOptions(prevValue);
    if (!state.replay || !state.replay.playing) resetReplay();
    renderInfo();
  }

  function attacksOf(rec) {
    const list = rec.rounds.map((rd, i) => ({
      key: 'r' + i, plan: rd.plan,
      label: `Раунд ${i + 1}: ${rd.source === 'jev' ? 'JEV' : 'локальный противник'} — ${rd.strategy.slice(0, 60)}${rd.strategy.length > 60 ? '…' : ''}`
    }));
    if (rec.stress) list.push({ key: 'stress', plan: rec.stress.plan, label: `Стресс-тест: ${rec.stress.strategy}` });
    return list;
  }

  function buildAttackOptions(keep) {
    const rec = selected(), sel = $('attackSelect');
    const list = attacksOf(rec);
    sel.innerHTML = '';
    if (!list.length) {
      sel.append(new Option('Атак ещё не было — запустите битву', ''));
      sel.disabled = true;
      return;
    }
    sel.disabled = false;
    list.forEach(a => sel.append(new Option(a.label, a.key)));
    sel.value = keep && list.some(a => a.key === keep) ? keep : list[0].key;
  }

  function currentAttack() {
    const rec = selected();
    return attacksOf(rec).find(a => a.key === $('attackSelect').value) || null;
  }

  function sizeStage() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(F.COLS * VIEW_T * dpr), h = Math.round(F.ROWS * VIEW_T * dpr);
    if (stage.width !== w || stage.height !== h) { stage.width = w; stage.height = h; staticKey = ''; }
    return dpr;
  }

  function ensureStatic() {
    const rec = selected();
    const dpr = sizeStage();
    const key = [rec.index, rec.map.seed, JSON.stringify(rec.defense), state.overlays.focus, state.overlays.routes, state.overlays.coverage, stage.width].join('|');
    if (key === staticKey && staticLayer) return;
    staticLayer = staticLayer || document.createElement('canvas');
    staticLayer.width = stage.width; staticLayer.height = stage.height;
    const c = staticLayer.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    R.drawStatic(c, rec.map, rec.defense, VIEW_T, state.overlays);
    staticKey = key;
  }

  function draw() {
    ensureStatic();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    sctx.setTransform(1, 0, 0, 1, 0, 0);
    sctx.drawImage(staticLayer, 0, 0);
    const rp = state.replay;
    if (rp) {
      sctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      R.drawBattle(sctx, rp.battle, VIEW_T);
    }
    updateHud();
  }

  function resetReplay() {
    const rec = selected(), atk = currentAttack();
    state.replay = rec.defense && atk ? { battle: new F.Battle(rec.map, rec.defense, atk.plan, { fx: true, lives: livesOf(rec) }), playing: false, acc: 0, last: 0 } : null;
    $('playBtn').textContent = '▶';
    $('playBtn').disabled = $('restartBtn').disabled = !state.replay;
    draw();
  }

  function updateHud() {
    const hud = $('hud'), rp = state.replay;
    if (!rp) { hud.hidden = true; return; }
    const b = rp.battle;
    hud.hidden = false;
    const lives = Math.max(0, b.lives);
    hud.innerHTML = `<span>⏱ ${b.time.toFixed(0)} с</span><span>Волна ${Math.max(1, b.wave)}/${F.RULES.waves}</span>` +
      `<span style="color:${lives < b.startLives ? '#ff8b7d' : '#a9e590'}">❤ ${lives}/${b.startLives}</span>` +
      `<span>☠ ${b.stats.killed}</span><span>⇥ прорвались ${b.stats.leakedCount}</span>` +
      (b.done ? `<span style="color:#f6d27a">${b.lives > 0 ? 'защита выстояла' : 'защита пала'}</span>` : '');
  }

  function loop(now) {
    const rp = state.replay;
    if (rp && rp.playing) {
      const dt = Math.min(.1, (now - (rp.last || now)) / 1000);
      rp.last = now;
      rp.acc += dt * state.speed;
      let guard = 0;
      while (rp.acc >= F.RULES.dt && !rp.battle.done && guard++ < 400) { rp.battle.step(); rp.acc -= F.RULES.dt; }
      if (rp.battle.done) { rp.playing = false; $('playBtn').textContent = '▶'; }
      draw();
    }
    requestAnimationFrame(loop);
  }

  // ---------- info panels ----------
  function unitChips(groups) {
    return groups.map(g => `<span class="unit" title="${F.ENEMIES[g.type].name}${g.delay ? ', задержка ' + g.delay + ' с' : ''}"><i style="background:${ENEMY_COLOR[g.type]}"></i>${g.count}× ${F.ENEMIES[g.type].name}<sub>→${F.ROAD_LETTERS[g.road]}</sub></span>`).join('');
  }
  function planHtml(plan, rec) {
    return '<div class="waves">' + plan.waves.map((w, i) => {
      const cost = w.groups.reduce((a, g) => a + g.count * F.ENEMIES[g.type].cost, 0);
      return `<div class="wave"><b>волна ${i + 1}<br><small class="muted">${cost}/${F.waveBudget(rec.index, i, rec.difficulty)}</small></b>${w.groups.length ? unitChips(w.groups) : '<span class="muted">пусто</span>'}</div>`;
    }).join('') + '</div>';
  }
  const lossHtml = r => {
    const l = Math.max(0, r.livesLost);
    return `<span class="${r.held === false ? 'lives-bad' : l ? 'lives-bad' : 'lives-ok'}">−${l} ❤${r.held === false ? ' · пала' : ''}</span> <span class="muted small">(прорвалось ${r.leakedCount}/${r.spawned})</span>`;
  };
  const probTxt = v => (v == null ? '' : Math.round(v * 100) + '%');
  // JEV's per-wave picks with the probability it gave each one.
  function picksHtml(picks) {
    if (!picks) return '';
    return '<div class="picks">' + picks.map(p => `<span class="muted">волна ${p.wave}</span><span>${p.armyName} <span class="prob">${probTxt(p.armyProb)}</span> → <span class="road">${p.road === 'ALL' ? 'все дороги' : 'дорога ' + p.road}</span> <span class="prob">${probTxt(p.roadProb)}</span></span><span class="prob" title="уверенность JEV">увер. ${probTxt(p.armyConfidence)}</span>`).join('') + '</div>';
  }
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function renderInfo() {
    const rec = selected();
    if (!rec) return;
    const m = rec.map;
    $('mapTitle').textContent = `Карта ${rec.index + 1} · ${m.layout}`;
    $('mapSub').textContent = `сид ${m.seed} · ${F.DIFFICULTIES[rec.difficulty].name}: ${livesOf(rec)} жизней · ${m.roads.length} дороги · ${rec.statusText}`;

    const metrics = m.roads.map(r => `<div class="metric"><small>Дорога ${r.letter}: ${F.SIDE_RU[r.entry.side]} → ${F.SIDE_RU[r.exit.side]}</small><b>${Math.round(r.stats.focusShare * 100)}%</b> <span class="muted small">пути в центре · ${r.path.len.toFixed(0)} кл. · до центра ${r.stats.centerDist.toFixed(1)}</span></div>`);
    const loss = worstLoss(rec);
    if (loss != null) metrics.push(`<div class="metric"><small>Финальная защита против JEV</small><b class="${loss ? 'lives-bad' : 'lives-ok'}">${loss ? '−' + loss + ' ❤ в худшем раунде' : 'держит все атаки'}</b></div>`);
    if (rec.stress) metrics.push(`<div class="metric"><small>Стресс-тест (лучшая контратака перебором)</small><b class="${rec.stress.result.livesLost > 0 ? 'lives-bad' : 'lives-ok'}">−${Math.max(0, rec.stress.result.livesLost)} ❤${rec.stress.result.held === false ? ' · защита пала' : ''}</b></div>`);
    $('metrics').innerHTML = metrics.join('');

    // Rounds
    const col = $('rounds-col');
    if (!rec.rounds.length) {
      col.innerHTML = `<div class="block"><h3>Раунды против JEV</h3><p class="empty">${rec.status === 'busy' ? esc(rec.statusText) + '…' : 'Боёв ещё не было. Нажмите «Запустить битву» — JEV увидит карту и башни, составит 5 волн, а защита перестроится по итогам.'}</p></div>`;
    } else {
      col.innerHTML = rec.rounds.map((rd, i) => `
        <div class="block">
          <h3>Раунд ${i + 1} · ${rd.source === 'jev' ? 'JEV' : 'локальный противник'} <small>${rd.model ? esc(rd.model) + (rd.requested && rd.requested !== rd.model ? ' (запрошено ' + esc(rd.requested) + ')' : '') : ''}${rd.latency ? ' · ' + (rd.latency / 1000).toFixed(1) + ' с' : ''}</small></h3>
          ${rd.error ? `<div class="note err">JEV не ответил планом: ${esc(rd.error)}. Этот раунд сыграл локальный противник.</div>` : ''}
          ${rd.picks ? picksHtml(rd.picks) : `<div class="quote">${esc(rd.strategy || '—')}${rd.taunt ? `<em>«${esc(rd.taunt)}»</em>` : ''}</div>`}
          ${planHtml(rd.plan, rec)}
          ${rd.notes && rd.notes.length ? `<div class="note">Поправлено: ${esc(rd.notes.join('; '))}</div>` : ''}
          <div class="outcome">против прежней защиты ${lossHtml(rd.before)} <span class="arrow">→</span> после перестройки ${lossHtml(rd.after)}
            <button class="watch" data-attack="r${i}">▶ смотреть</button></div>
          ${rd.prompt ? `<details class="prompt"><summary>Что видел JEV</summary><pre>${esc(rd.prompt)}</pre></details>` : ''}
        </div>`).join('') + (rec.stress ? `
        <div class="block">
          <h3>Стресс-тест <small>локальный перебор 5 тактик × все дороги</small></h3>
          <div class="quote">${esc(rec.stress.strategy)}</div>
          ${planHtml(rec.stress.plan, rec)}
          <div class="outcome">итог против финальной защиты ${lossHtml(rec.stress.result)} <button class="watch" data-attack="stress">▶ смотреть</button></div>
        </div>` : '');
      col.querySelectorAll('.watch').forEach(b => b.addEventListener('click', () => {
        $('attackSelect').value = b.dataset.attack;
        resetReplay(); togglePlay(true);
        $('stage').scrollIntoView({ behavior: 'smooth', block: 'center' });
      }));
    }

    // Towers
    const tcol = $('towers-col');
    if (!rec.defense) {
      tcol.innerHTML = `<div class="block"><h3>8 башен</h3><p class="empty">Площадки размечены вдоль дорог у центра; типы башен появятся после боя.</p></div>`;
      return;
    }
    const atk = currentAttack();
    const res = atk ? F.simulate(m, rec.defense, atk.plan, { lives: livesOf(rec) }) : null;
    const maxDmg = res ? Math.max(1, ...res.towers.map(t => t.damage)) : 1;
    const exp = F.exposure(m, rec.defense);
    tcol.innerHTML = `<div class="block"><h3>8 башен <small>${res ? 'вклад в бою: ' + esc(atk.label.split(':')[0]) : ''}</small></h3>
      <table><thead><tr><th>#</th><th>Башня</th><th>Клетка</th><th>Дороги в зоне</th>${res ? '<th class="num">Урон</th><th class="num">Убийств</th>' : ''}</tr></thead><tbody>
      ${rec.defense.map((t, i) => {
        const roads = m.roads.filter((_, r) => exp[r][i] > 0).map(r => r.letter).join(', ') || '—';
        const tr = res && res.towers[i];
        return `<tr><td>${i + 1}</td><td><span class="unit"><i style="background:${F.TOWERS[t.type].color}"></i>${F.TOWERS[t.type].name}</span></td><td class="muted">${t.x}, ${t.y}</td><td>${roads}</td>` +
          (tr ? `<td class="num">${tr.damage}<div class="bar"><div style="width:${tr.damage / maxDmg * 100}%;background:${F.TOWERS[t.type].color}"></div></div></td><td class="num">${tr.kills}</td>` : '') + '</tr>';
      }).join('')}
      </tbody></table></div>`;
  }

  // ---------- export ----------
  function download(name, blob) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  function exportJson() {
    const data = P.exportData(state.maps, { seed: settings.seed, opponent: settings.useJev ? settings.model : 'local', difficulty: settings.difficulty });
    download(`jev-maps-${settings.seed}-${settings.difficulty}.json`, new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  }

  async function importJson(file) {
    try {
      const data = JSON.parse(await file.text());
      state.maps = P.importData(data);
      if (data.seed) { settings.seed = data.seed; $('seed').value = data.seed; }
      if (data.difficulty && F.DIFFICULTIES[data.difficulty]) { settings.difficulty = data.difficulty; $('difficulty').value = data.difficulty; }
      renderCards();
      select(0);
      updateProgress(); syncButtons();
      log(`открыт файл ${file.name}: ${state.maps.length} карт, противник — ${data.opponent || '?'}`, 'ok');
    } catch (e) {
      log('не удалось открыть файл: ' + e.message, 'err');
    }
  }

  function exportPng() {
    const rec = selected();
    const c = document.createElement('canvas');
    c.width = F.COLS * 64; c.height = F.ROWS * 64;
    R.drawStatic(c.getContext('2d'), rec.map, rec.defense, 64, { routes: state.overlays.routes, focus: state.overlays.focus, coverage: state.overlays.coverage });
    c.toBlob(b => download(`jev-map-${rec.index + 1}-${rec.map.seed}.png`, b), 'image/png');
  }

  // ---------- controls ----------
  function togglePlay(force) {
    const rp = state.replay;
    if (!rp) return;
    if (rp.battle.done) { resetReplay(); return togglePlay(true); }
    rp.playing = force != null ? force : !rp.playing;
    rp.last = 0;
    $('playBtn').textContent = rp.playing ? '❚❚' : '▶';
  }

  function newSet(seed) {
    settings.seed = seed; $('seed').value = seed; writeStore();
    state.maps = makeRecords(seed);
    renderCards();
    select(Math.min(state.selected, MAP_COUNT - 1));
    updateProgress(); syncButtons();
    log(`построено ${MAP_COUNT} карт, сид ${seed}`);
  }

  function legend() {
    $('towerLegend').innerHTML = '';
    F.TOWER_TYPES.forEach(tp => {
      const li = document.createElement('li');
      const cv = document.createElement('canvas'); cv.width = 52; cv.height = 52;
      const c = cv.getContext('2d'); c.scale(2, 2);
      R.towerIcon(c, tp, 13, 20, 24);
      const t = F.TOWERS[tp];
      li.append(cv);
      li.insertAdjacentHTML('beforeend', `<div><b>${t.name}</b> — ${t.role}<small>урон ${t.dmg}${t.magic ? ' магией' : ''}, ${t.rate}/с, радиус ${t.range}${t.splash ? ', по площади' : ''}</small></div>`);
      $('towerLegend').append(li);
    });
    $('enemyLegend').innerHTML = F.ENEMY_TYPES.map(tp => {
      const e = F.ENEMIES[tp];
      return `<li><span class="dot" style="background:${ENEMY_COLOR[tp]}"></span><div><b>${e.name}</b> — ${e.note}<small>❤ ${e.hp}, броня ${Math.round(e.armor * 100)}%, скорость ${e.speed}, цена ${e.cost}</small></div></li>`;
    }).join('');
  }

  function bind() {
    $('apiKey').value = settings.apiKey || '';
    $('remember').checked = !!settings.remember;
    $('model').value = settings.model;
    $('difficulty').innerHTML = F.DIFFICULTY_KEYS.map(k => `<option value="${k}">${F.DIFFICULTIES[k].name} — ${F.DIFFICULTIES[k].lives} жизней, армия ×${F.DIFFICULTIES[k].budget}</option>`).join('');
    $('difficulty').value = settings.difficulty;
    $('useJev').checked = !!settings.useJev;
    $('rounds').value = String(settings.rounds);
    $('parallel').value = String(settings.parallel);
    $('seed').value = settings.seed;

    $('apiKey').addEventListener('input', e => { settings.apiKey = e.target.value.trim(); writeStore(); });
    $('remember').addEventListener('change', e => { settings.remember = e.target.checked; writeStore(); });
    $('model').addEventListener('change', e => { settings.model = e.target.value; writeStore(); });
    $('useJev').addEventListener('change', e => { settings.useJev = e.target.checked; writeStore(); syncButtons(); });
    $('difficulty').addEventListener('change', e => {
      settings.difficulty = e.target.value; writeStore();
      if (!state.running) { state.maps.forEach(resetRecord); renderCards(); select(state.selected); updateProgress(); syncButtons(); }
    });
    $('importFile').addEventListener('change', e => { if (e.target.files[0]) importJson(e.target.files[0]); e.target.value = ''; });
    $('rounds').addEventListener('change', e => { settings.rounds = +e.target.value; writeStore(); });
    $('parallel').addEventListener('change', e => { settings.parallel = +e.target.value; writeStore(); });
    $('seed').addEventListener('change', e => {
      const v = Math.max(1, Math.min(999999, Math.floor(+e.target.value) || 1));
      if (!state.running) newSet(v);
    });
    $('regenBtn').addEventListener('click', () => newSet(1 + Math.floor(Math.random() * 99999)));
    $('runBtn').addEventListener('click', runAll);
    $('stopBtn').addEventListener('click', () => state.ctrl && state.ctrl.abort());
    $('exportBtn').addEventListener('click', exportJson);
    $('pngBtn').addEventListener('click', exportPng);
    $('playBtn').addEventListener('click', () => togglePlay());
    $('restartBtn').addEventListener('click', () => { resetReplay(); togglePlay(true); });
    $('attackSelect').addEventListener('change', () => { resetReplay(); renderInfo(); });
    $('speedBtns').addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b) return;
      state.speed = +b.dataset.speed;
      $('speedBtns').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
    });
    [['ovFocus', 'focus'], ['ovRoutes', 'routes'], ['ovCoverage', 'coverage']].forEach(([id, k]) => {
      $(id).checked = state.overlays[k];
      $(id).addEventListener('change', e => { state.overlays[k] = e.target.checked; draw(); });
    });
    window.addEventListener('resize', () => draw());
    document.addEventListener('keydown', e => {
      if (e.target.closest('input, select, textarea')) return;
      if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
      else if (e.key === 'ArrowRight') select((state.selected + 1) % MAP_COUNT);
      else if (e.key === 'ArrowLeft') select((state.selected + MAP_COUNT - 1) % MAP_COUNT);
    });
  }

  bind();
  legend();
  newSet(settings.seed);
  requestAnimationFrame(loop);
})();
