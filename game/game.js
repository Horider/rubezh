(() => {
  'use strict';

  const W = 1672, H = 941, MAX_WAVES = 10, TOWER_LIFT = 2;
  // The shield at the entrance: the next wave waits behind it. After the first wave it breaks
  // by itself NEXT_WAVE_DELAY seconds after the previous wave has fully marched out; breaking
  // it sooner pays up to EARLY_BONUS_MAX gold, scaled by the time left.
  const NEXT_WAVE_DELAY = 6, EARLY_BONUS_MAX = 20, SHIELD_POS = {x:835,y:62};
  // Wave n has size.base + n·size.perWave enemies; their HP and speed grow by hpGrowth and
  // speedGrowth per wave, they come out every gap seconds (shrinking per wave down to gapMin),
  // and the wave pays reward.base + n·reward.perWave once its last enemy is gone.
  const WAVE = {
    size:{base:8,perWave:2}, hpGrowth:.11, speedGrowth:.035,
    gap:.88, gapPerWave:.035, gapMin:.46, reward:{base:38,perWave:9}
  };
  // shieldAt: share of the current wave that must be gone (killed or escaped) before the next shield rises.
  // focus: how hard JEV, the enemy commander, may lean a wave towards one flank (0 even, 1 most).
  const DIFFICULTIES = {
    easy:{gold:500,lives:30,hp:.85,shieldAt:1,focus:.35},
    normal:{gold:400,lives:20,hp:1,shieldAt:.8,focus:.65},
    hard:{gold:360,lives:10,hp:1.05,shieldAt:.6,focus:.7}
  };
  // 16 × 18 pixel shield: O outline, G rim, Y rim highlight, B body, W emblem.
  const SHIELD_PIXELS = [
    '...OOOOOOOOOO...','.OOGGGGGGGGGGOO.','OGGYYYYYYYYYYGGO','OGYBBBBBBBBBBYGO','OGYBBBBBBBBBBYGO',
    'OGYBBBBWWBBBBYGO','OGYBBBWWWWBBBYGO','OGYBBWWWWWWBBYGO','OGYBBBBWWBBBBYGO','OGYBBBBWWBBBBYGO',
    '.OGYBBBWWBBBYGO.','.OGYBBBBBBBBYGO.','..OGYBBBBBBYGO..','...OGYBBBBYGO...','....OGYBBYGO....',
    '.....OGYYGO.....','......OGGO......','.......OO.......'
  ];
  const SHIELD_COLORS = {
    enemy:['#a63a2c','#7a2a20','#efe3c4'],easy:['#4f8a3c','#3a6a2c','#efe3c4'],
    normal:['#a63a2c','#7a2a20','#efe3c4'],hard:['#3e3d48','#2a2931','#d0574a']
  };
  // Drawn as two halves so the wave shield can crack apart down the middle.
  function pixelShield([light,dark,emblem]){
    const half=(lo,hi)=>{let out='';SHIELD_PIXELS.forEach((row,y)=>{for(let x=lo;x<hi;x++){
      const c=row[x];if(c==='.')continue;
      const fill={O:'#2a1a0e',G:'#b8863f',Y:'#f3d98f',B:x<8?light:dark,W:emblem}[c];
      out+=`<rect x="${x}" y="${y}" width="1" height="1" fill="${fill}"/>`;}});return out;};
    return `<g class="shield-half left">${half(0,8)}</g><g class="shield-half right">${half(8,16)}</g>`;
  }
  // Window centres in the original 1254 × 1254 tower sprites.
  const towerWindows = [null,
    {left:{x:500,y:640},right:{x:780,y:640}},
    {left:{x:500,y:620},right:{x:780,y:620}},
    {left:{x:500,y:620},right:{x:780,y:620}},
    {left:{x:500,y:630},right:{x:780,y:630}},
    {left:{x:500,y:630},right:{x:780,y:630}}
  ];
  const canvas = document.getElementById('gameCanvas');
  const ctx = canvas.getContext('2d');
  const el = Object.fromEntries(['gold','lives','wave','waveShield','pauseButton','speedButton','restartButton','toast','stageMessage','menu','menuResume','jevStatus','jevKey','jevModel','jevSave','jevForget'].map(id => [id, document.getElementById(id)]));
  const pads = [
    {x:730,y:238},{x:944,y:234},{x:342,y:412},{x:1324,y:421},
    {x:123,y:540},{x:1546,y:540},{x:157,y:740},{x:1523,y:740}
  ].map((pad, id) => ({...pad,id,level:0,cooldown:0,invested:0}));
  // Stone ring of each pad as painted on the map: centre and visible width.
  // Our banners at the two exits (left and right), five frames each, drawn 1:1 at their map spot.
  const FLAG_FPS = 6;
  const flagSets = [{name:'flags-left',x:17,y:554},{name:'flags-right',x:1603,y:554}]
    .map(set => ({...set,frames:[1,2,3,4,5].map(i => loadImage('map-anim/' + set.name + '/frame-0' + i + '.png'))}));
  // Birch crown (13 on the notes map) sways slowly, five frames, drawn 1:1.
  const BIRCH_FPS = 5;
  const birches = [{name:'birch-13',x:511,y:1}].map(tree => ({...tree,frames:[1,2,3,4,5].map(i => loadImage('map-anim/' + tree.name + '/frame-0' + i + '.png'))}));
  // Stone arch (23 on the notes map): glowing doorway and fireflies, five opaque frames, drawn 1:1.
  const ARCH_FPS = 6;
  const arches = [{name:'arch-23',x:1169,y:661}]
    .map(arch => ({...arch,frames:[1,2,3,4,5].map(i => loadImage('map-anim/' + arch.name + '/frame-0' + i + '.png'))}));
  const padRings = [
    {x:729.5,y:238.5,w:96},{x:943.5,y:234,w:96},{x:342.5,y:413.5,w:98},{x:1325,y:423.5,w:97},
    {x:123,y:539.5,w:99},{x:1545.5,y:540.5,w:98},{x:157.5,y:740,w:100},{x:1520,y:740.5,w:99}
  ];
  // Hover frames are 673 × 541; the ring inside is 652 px wide, centred at (336, 285.5).
  const PAD_FRAME = {w:673,h:541,ringW:652,cx:336,cy:285.5,fps:5};
  const padFrames = [1,2,3,4,5].map(i => loadImage('map-anim/pad-hover/frame-0' + i + '.png'));
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const portraitPhone = window.matchMedia('(pointer:coarse) and (orientation:portrait) and (max-width:820px)');
  // Every waterfall plays the same five frames. #1 is drawn whole at its own spot;
  // the others use only the lower falling sheet of the frame (src), stretched over their own water.
  const waterfallFrames = [1,2,3,4,5].map(i => loadImage('map-anim/waterfall-01/frame-0' + i + '.png'));
  const WATERFALL_FPS = 10, WATERFALL_SHEET = [6,54,56,76];
  const waterfalls = [
    {x:109,y:0,w:81,h:130,src:[0,0,81,130]},
    {x:1461.1,y:-1.4,w:26.7,h:54.3},{x:1494,y:112.8,w:56,h:84.4},{x:1526,y:280.3,w:42.7,h:62.7},
    {x:96.1,y:407.2,w:40,h:67.6},{x:687.8,y:429.9,w:30.7,h:42.2},{x:1083.4,y:523.3,w:36,h:63.9},
    {x:754.9,y:696.9,w:72,h:79.6}
  ];
  const paths = [
    // Corners follow the rounded road (quadratic curves, radius 55 px).
    [{x:835,y:-35},{x:835,y:278},{x:833.5,y:294.8},{x:828.9,y:308.6},{x:821.2,y:319.2},{x:810.6,y:326.9},{x:796.8,y:331.5},{x:780,y:333},{x:287,y:333},{x:270.2,y:334.5},{x:256.4,y:339.1},{x:245.8,y:346.8},{x:238.1,y:357.4},{x:233.5,y:371.2},{x:232,y:388},{x:232,y:591},{x:230.5,y:607.8},{x:225.9,y:621.6},{x:218.2,y:632.2},{x:207.6,y:639.9},{x:193.8,y:644.5},{x:177,y:646},{x:-40,y:646}],
    [{x:835,y:-35},{x:835,y:278},{x:836.5,y:294.8},{x:841.1,y:308.6},{x:848.8,y:319.2},{x:859.4,y:326.9},{x:873.2,y:331.5},{x:890,y:333},{x:1385,y:333},{x:1401.8,y:334.5},{x:1415.6,y:339.1},{x:1426.2,y:346.8},{x:1433.9,y:357.4},{x:1438.5,y:371.2},{x:1440,y:388},{x:1440,y:591},{x:1441.5,y:607.8},{x:1446.1,y:621.6},{x:1453.8,y:632.2},{x:1464.4,y:639.9},{x:1478.2,y:644.5},{x:1495,y:646},{x:1712,y:646}]
  ];
  // Each flank's own road after the fork, sampled on the visible map, for judging its defence.
  const FORK = 7, FLANKS = ['left','right'];
  const flankRoads = paths.map(path => {
    const points = [];
    for (let i = FORK; i < path.length - 1; i++) {
      const a = path[i], b = path[i + 1], length = Math.hypot(b.x - a.x, b.y - a.y);
      for (let d = 0; d < length; d += 8) {
        const x = a.x + (b.x - a.x) * d / length, y = a.y + (b.y - a.y) * d / length;
        if (x >= 0 && x <= W) points.push({x, y});
      }
    }
    return points;
  });
  const towerData = [null,
    {name:'Соломенная',damage:21,range:188,rate:.88,cost:90},
    {name:'Деревянная',damage:34,range:211,rate:.78,cost:90},
    {name:'Каменная',damage:53,range:233,rate:.68,cost:140},
    {name:'Укреплённая',damage:78,range:258,rate:.58,cost:210},
    {name:'Сланцевая',damage:112,range:286,rate:.48,cost:300}
  ];
  // Mage tower: slower, heavier magic bolts that also splash enemies standing next to the target.
  // Art: first mage stage uses the repaired straw tower; stages 2–5 use drawings 1,2,3,5.
  const mageData = [null,
    {name:'Соломенная',damage:30,range:172,rate:1.45,cost:100,splash:44},
    {name:'Замшелая',damage:48,range:192,rate:1.33,cost:110,splash:52},
    {name:'Чародейская',damage:74,range:212,rate:1.22,cost:160,splash:60},
    {name:'Сланцевая',damage:108,range:232,rate:1.1,cost:230,splash:68},
    {name:'Кристальная',damage:160,range:252,rate:1.0,cost:320,splash:78}
  ];
  const SPLASH_SHARE = .5;   // neighbours inside the splash take half the bolt's damage
  const TOWERS = {
    archer:{levels:towerData,title:'башня',note:'Два лучника бьют врага, ближайшего к выходу.',
      dir:'towers/archers/'},
    mage:{levels:mageData,title:'башня мага',note:'Чародей бьёт врага у выхода, взрыв задевает соседей.',
      dir:'towers/mage/',
      // Upper balcony arches of the round tower, in its 1254 × 1254 drawing.
      windows:{left:{x:512,y:690},right:{x:742,y:690}}}
  };
  function stats(p,level=p.level){return TOWERS[p.type].levels[level];}
  const enemyData = [null,
    {name:'Воин',hp:75,speed:66,reward:14,size:61},
    {name:'Латник',hp:145,speed:59,reward:22,size:65},
    {name:'Гвардеец',hp:265,speed:55,reward:32,size:69},
    {name:'Чемпион',hp:430,speed:51,reward:47,size:73}
  ];
  const map = new Image(); map.src = 'maps/forest-pass.png';
  // Towers are drawn without their painted cloth; the waving pennant is drawn over the pole.
  const towerImages = Object.fromEntries(Object.entries(TOWERS).map(([type,t]) => [type,t.levels.map((item,i) => i ? loadImage(t.dir + (type==='archer' ? `level-${i}.png` : `level-${i}/tower.png`)) : null)]));
  const PENNANT_FPS = 8;
  // One pennant per tower level, each a visible upgrade (mended cloth, gold trim, emblem, royal finish).
  const pennantFrames = towerData.map((item,level) => level ? [1,2,3,4,5].map(i => loadImage('towers/archers/pennant/level-' + level + '/frame-0' + i + '.png')) : null);
  // Mage art has four layers: base, upper room, roof, and the top crystal.
  // The crystal shimmers in five frames while the banner stays still.
  const MAGE_ANIM_FPS = 6, MAGE_LIFT = 4;   // mage tower sits 4 px higher on its pad than the archer tower
  const mageModules = mageData.map((item,level) => {
    if(!level)return null;
    const root=`towers/mage/level-${level}/`;
    return {
      base:loadImage(root+'base.png'),
      upper:loadImage(root+'upper.png'),
      roof:loadImage(root+'roof.png'),
      crystals:[1,2,3,4,5].map(i=>loadImage(root+`crystal-0${i}.png`)),
      charge:[1,2,3,4,5].map(i=>loadImage(root+`charge-0${i}.png`))
    };
  });
  const mageComposites=mageData.map(()=>Array(5).fill(null));
  const mageChargeComposites=mageData.map(()=>Array(5).fill(null));
  const enemyImages = enemyData.map((item,i) => i ? loadImage('enemies/warrior-level-' + i + '.png') : null);
  const magicOrbFrames=Array.from({length:10},(_,i)=>loadImage(`effects/magic-orb/frame-${String(i+1).padStart(2,'0')}.png`));
  const magicGroundFrames=Array.from({length:10},(_,i)=>loadImage(`effects/magic-ground/frame-${String(i+1).padStart(2,'0')}.png`));
  const buildMenu=document.getElementById('buildMenu');
  const chooseArcher=document.getElementById('chooseArcher'),chooseMage=document.getElementById('chooseMage');
  const buildChoices=[[chooseArcher,'archer','archerCost'],[chooseMage,'mage','mageCost']];
  const towerMenu=document.getElementById('towerMenu');
  const upgradeOption=document.getElementById('upgradeOption'),sellOption=document.getElementById('sellOption');
  let menuPad=null,previewLevel=0,previewType='archer',towerMenuPad=null,upgradeArmed=false;
  function loadImage(src){const image=new Image();image.src=src;return image;}

  let gold, lives, wave, selected, enemies, projectiles, effects, shieldUp, shieldTimer, aliveByWave, spawnRemaining, spawnTimer, spawnNumber, paused, speed, ended, hovered, hoverStarted, lastTime, toastTimer, enemyId;
  let waveSize=0,leaks=[0,0],spawnQueue=[],jevPending=false,jevToken=0,difficultyKey='normal',difficulty=DIFFICULTIES.normal,inMenu=true,gameStarted=false;
  function reset(){
    gold=difficulty.gold;lives=difficulty.lives;wave=0;selected=null;enemies=[];projectiles=[];effects=[];
    shieldUp=true;shieldTimer=0;aliveByWave={};spawnRemaining=0;spawnTimer=0;spawnNumber=0;paused=false;speed=1;ended=false;hovered=null;hoverStarted=0;lastTime=performance.now();enemyId=0;
    pads.forEach(p=>{p.level=0;p.type='archer';p.cooldown=0;p.charge=0;p.invested=0;});
    leaks=[0,0];spawnQueue=[];jevPending=false;jevToken++;
    el.stageMessage.hidden=true;updateUI();
  }
  function openMenu(){
    inMenu=true;selected=null;el.menu.hidden=false;
    el.menuResume.hidden=!gameStarted||ended;
    let last='normal';try{last=localStorage.getItem('td-difficulty')||last;}catch(error){}
    for(const banner of el.menu.querySelectorAll('.banner'))banner.classList.toggle('last',banner.dataset.difficulty===last);
    renderJevSettings();
    updateUI();
    (el.menu.querySelector('.banner.last')||el.menu.querySelector('.banner')).focus();
  }
  function closeMenu(){inMenu=false;el.menu.hidden=true;lastTime=performance.now();updateUI();canvas.focus({preventScroll:true});}
  function startGame(key){
    difficulty=DIFFICULTIES[key];difficultyKey=key;gameStarted=true;
    try{localStorage.setItem('td-difficulty',key);}catch(error){}
    reset();closeMenu();
  }
  function toast(message){el.toast.textContent=message;el.toast.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.toast.classList.remove('show'),2400);}
  function updateUI(){
    el.gold.textContent=gold;el.lives.textContent=lives;el.wave.textContent=`${wave} / ${MAX_WAVES}`;
    el.pauseButton.textContent=paused?'▶':'Ⅱ';el.pauseButton.setAttribute('aria-label',paused?'Продолжить':'Пауза');el.speedButton.textContent=speed+'×';
    updateShield();
    canvas.parentElement.classList.toggle('in-menu',inMenu);
    updateBuildMenu();
    updateTowerMenu();
  }
  function updateBuildMenu(){
    buildMenu.hidden=selected===null||pads[selected].level>0||ended;
    if(buildMenu.hidden){menuPad=null;return;}
    if(menuPad!==selected){menuPad=selected;setPlaque(null);}
    for(const [button,type,costId] of buildChoices){
      const cost=TOWERS[type].levels[1].cost;
      button.classList.toggle('poor',gold<cost);
      document.getElementById(costId).textContent=cost;
    }
    positionBuildMenu();
  }
  function sellValue(p){return Math.floor(p.invested*.6);}
  function updateTowerMenu(){
    towerMenu.hidden=selected===null||!pads[selected].level||ended;
    if(towerMenu.hidden){towerMenuPad=null;upgradeArmed=false;return;}
    const p=pads[selected],next=stats(p,p.level+1);
    if(towerMenuPad!==selected)upgradeArmed=false;
    if(next)upgradeOption.removeAttribute('aria-disabled');else upgradeOption.setAttribute('aria-disabled','true');
    upgradeOption.classList.toggle('poor',!!next&&gold<next.cost);
    upgradeOption.classList.toggle('armed',upgradeArmed);
    upgradeOption.setAttribute('aria-pressed',String(upgradeArmed));
    upgradeOption.setAttribute('aria-label',next?(upgradeArmed?`Подтвердить улучшение до уровня ${p.level+1} за ${next.cost} золота`:`Показать улучшение до уровня ${p.level+1} за ${next.cost} золота`):'Высший уровень');
    document.getElementById('upgradeCost').hidden=!next;
    if(next)document.getElementById('upgradeCost').textContent=next.cost;
    document.getElementById('sellValue').textContent=sellValue(p);
    sellOption.setAttribute('aria-label',`Продать башню за ${sellValue(p)} золота`);
    // Keep the hovered medallion's text after an upgrade; reset only when another tower is opened.
    if(towerMenuPad!==selected){towerMenuPad=selected;setTowerInfo(null);}
    else setTowerInfo(upgradeArmed?upgradeOption:towerMenu.querySelector('.build-option:hover'));
    positionRing(towerMenu,p.x,p.y-52);
  }
  function setTowerInfo(option){
    const p=pads[selected],info=stats(p),next=stats(p,p.level+1);previewType=p.type;
    // Hovering the upgrade previews the next level: its range on the map and its numbers in the card.
    previewLevel=option===upgradeOption&&next?p.level+1:0;
    const shown=previewLevel?next:info,diff=(a,b)=>a===b?String(a):`${a} → ${b}`;
    const rate=t=>(1/t.rate).toFixed(1);
    document.getElementById('towerInfoName').textContent=shown.name+' '+TOWERS[p.type].title;
    document.getElementById('towerInfoLevel').textContent=(previewLevel||p.level)+' / 5';
    document.getElementById('statDamage').textContent=diff(info.damage,shown.damage);
    document.getElementById('statRange').textContent=diff(info.range,shown.range);
    document.getElementById('statRate').textContent=diff(rate(info),rate(shown));
    // Mage towers also show the blast area (radius on the map, like range).
    document.getElementById('statSplashBox').hidden=!info.splash;
    if(info.splash)document.getElementById('statSplash').textContent=diff(info.splash,shown.splash);
    const note=document.getElementById('towerInfoNote');
    note.textContent=option===upgradeOption?(!next?'Высший уровень, улучшать некуда.':gold<next.cost?`Не хватает ${next.cost-gold} ◆ для улучшения.`:upgradeArmed?'Нажмите значок улучшения ещё раз для покупки.':`Предпросмотр: улучшение за ${next.cost} ◆`)
      :option===sellOption?`Продать за ${sellValue(p)} ◆`:TOWERS[p.type].note;
    towerMenu.classList.toggle('previewing',!!previewLevel);
  }
  function setPlaque(option){
    const name=document.getElementById('buildPlaqueName'),note=document.getElementById('buildPlaqueNote');
    // Hovering an open tower previews the range its first level would cover here.
    const type=option&&option.dataset.type;
    previewLevel=type?1:0;if(type)previewType=type;
    if(!option){name.textContent='Выберите башню';note.textContent='Площадка '+(selected+1);return;}
    name.textContent=option.dataset.name;
    const cost=type&&TOWERS[type].levels[1].cost;
    note.textContent=!type?'Откроется позже':gold<cost?'Нужно ещё '+(cost-gold)+' ◆':cost+' ◆';
  }
  function positionBuildMenu(){
    if(!buildMenu.hidden&&selected!==null)positionRing(buildMenu,pads[selected].x,pads[selected].y);
    if(!towerMenu.hidden&&selected!==null)positionRing(towerMenu,pads[selected].x,pads[selected].y-52);
  }
  function positionRing(menu,cx,cy){
    // The portrait fallback uses a tray; landscape keeps the radial selector on the map.
    if(window.matchMedia('(max-width:680px) and (orientation:portrait)').matches){
      menu.style.removeProperty('left');menu.style.removeProperty('top');
      menu.classList.remove('plaque-above');
      if(menu===towerMenu){
        const card=document.getElementById('towerInfo');
        card.style.removeProperty('margin-left');card.style.removeProperty('top');card.style.removeProperty('bottom');
      }
      return;
    }
    const width=canvas.clientWidth;
    const viewport=window.visualViewport,zoom=viewport?.scale||1;
    const viewLeft=viewport?.offsetLeft||0,viewTop=viewport?.offsetTop||0;
    const viewRight=viewLeft+(viewport?.width||window.innerWidth);
    const viewBottom=viewTop+(viewport?.height||window.innerHeight);
    // Undo browser pinch zoom on the controls while keeping their origin on the map.
    menu.style.setProperty('--ui-scale',String(1/zoom));
    // Ring size follows the canvas so it never swallows neighbouring pads.
    const size=Math.max(42,Math.min(60,width*.042));
    let r=Math.max(52,Math.min(80,width*.05));
    const x=cx/W*width,y=cy/H*canvas.clientHeight;
    const rect=canvas.getBoundingClientRect(),landscape=window.matchMedia('(orientation:landscape)').matches;
    const anchorX=landscape?rect.left+x:canvas.offsetLeft+x;
    const anchorY=landscape?rect.top+y:canvas.offsetTop+y;
    if(menu===towerMenu&&landscape)r=Math.max(18,Math.min(r,(anchorX-viewLeft)*zoom-size/2-8,(viewRight-anchorX)*zoom-size/2-8,(anchorY-viewTop)*zoom-8,(viewBottom-anchorY)*zoom-8));
    const reach=r+size/2+6;
    menu.style.setProperty('--size',size+'px');menu.style.setProperty('--r',r+'px');
    menu.style.left=anchorX+'px';
    menu.style.top=anchorY+'px';
    if(menu===buildMenu){
      const d=r*.71,rowGap=size+10;
      const plaque=menu.querySelector('.build-plaque'),plaqueHeight=plaque.offsetHeight;
      const preferBelow=cy<300||anchorY-(reach+16)/zoom<viewTop;
      const neededBelow=d+(preferBelow?rowGap:0)+size/2+14+plaqueHeight;
      const bottomEdge=anchorY+neededBelow/zoom>viewBottom;
      const topEdge=preferBelow&&!bottomEdge;
      menu.classList.toggle('edge-top',topEdge);
      menu.classList.toggle('edge-bottom',!topEdge&&bottomEdge);
      menu.style.setProperty('--left-d',-d+'px');menu.style.setProperty('--right-d',d+'px');
      menu.style.setProperty('--top-d',(topEdge?d:bottomEdge?-d-rowGap:-d)+'px');
      menu.style.setProperty('--bottom-d',(topEdge?d+rowGap:bottomEdge?-d:d)+'px');
      menu.style.setProperty('--plaque-offset',(d+rowGap+size/2+14)+'px');
      if(bottomEdge&&!topEdge)menu.style.setProperty('--r',Math.max(16,Math.min(r,(viewBottom-anchorY)*zoom-8))+'px');
      menu.classList.toggle('plaque-above',!topEdge&&bottomEdge);
      const pw=plaque.offsetWidth;
      const plaqueShift=Math.max(viewLeft+8/zoom+pw/(2*zoom)-anchorX,Math.min(viewRight-8/zoom-pw/(2*zoom)-anchorX,0));
      plaque.style.marginLeft=plaqueShift*zoom+'px';
      return;
    }
    // Keep the two action buttons centered on the tower; only the info card changes side.
    const card=document.getElementById('towerInfo'),cw=card.offsetWidth,ch=card.offsetHeight;
    const right=anchorX+(reach+12)/zoom,left=anchorX-(reach+12+cw)/zoom;
    const cardLeft=right+cw/zoom<=viewRight-8/zoom?right:left>=viewLeft+8/zoom?left:Math.max(viewLeft+8/zoom,Math.min(viewRight-(cw+8)/zoom,right));
    const cardTop=Math.max(viewTop+8/zoom,Math.min(viewBottom-(ch+8)/zoom,anchorY-ch/(2*zoom)));
    card.style.left=(cardLeft-anchorX)*zoom+'px';card.style.top=(cardTop-anchorY)*zoom+'px';
    card.style.bottom='auto';card.style.marginLeft='0';
  }
  function buildTower(p,type=p.type){
    if(ended||p.level>=5)return;
    if(!p.level)p.type=type;
    const next=stats(p,p.level+1);if(gold<next.cost){toast('Недостаточно золота');return;}
    gold-=next.cost;p.invested+=next.cost;p.level++;p.cooldown=.2;
    effects.push({x:p.x,y:p.y-33,life:.55,max:.55,type:'build'});
    if(p.level>1)toast(`Башня улучшена до ${p.level} уровня`);
    updateUI();
  }
  function sellTower(p){if(!p.level||ended)return;gold+=Math.floor(p.invested*.6);p.level=0;p.invested=0;p.cooldown=0;toast('Башня продана');updateUI();}
  function earlyBonus(){return wave>0&&shieldTimer>0?Math.max(1,Math.round(shieldTimer/NEXT_WAVE_DELAY*EARLY_BONUS_MAX)):0;}
  function startWave(){
    if(!shieldUp||ended||paused||wave>=MAX_WAVES)return;
    const bonus=earlyBonus();
    if(bonus){gold+=bonus;effects.push({x:SHIELD_POS.x,y:SHIELD_POS.y+40,life:.9,max:.9,type:'coin',value:bonus});}
    shieldUp=false;shieldTimer=0;breakShield();
    wave++;spawnNumber=0;spawnRemaining=WAVE.size.base+wave*WAVE.size.perWave;waveSize=spawnRemaining;spawnTimer=.3;aliveByWave[wave]=0;
    toast(bonus?`Волна ${wave} вызвана раньше: +${bonus} ◆`:`Волна ${wave} началась`);updateUI();
    planWave();
  }
  // What JEV sees before a wave: the wave itself and, per flank, the firepower covering it,
  // how much of its road is under fire and how many enemies broke through there lately.
  function jevFacts(){
    const levels=Array.from({length:waveSize},(_,i)=>chooseEnemyLevel(i));
    const sides=flankRoads.map((road,side)=>{
      let firepower=0,towers=0;const covered=new Set();
      for(const p of pads){
        if(!p.level)continue;
        const info=stats(p);let hits=0;
        road.forEach((point,i)=>{if(Math.hypot(point.x-p.x,point.y-(p.y-42))<=info.range){hits++;covered.add(i);}});
        if(hits){towers++;firepower+=info.damage/info.rate*hits/road.length;}
      }
      return {name:FLANKS[side],firepower:Math.round(firepower),coverage:Math.round(covered.size/road.length*100)/100,towers,leaks:Math.round(leaks[side]*10)/10};
    });
    const composition={};for(const level of levels)composition[enemyData[level].name]=(composition[enemyData[level].name]||0)+1;
    return {wave,waves:MAX_WAVES,waveSize,difficulty:difficultyKey,focus:difficulty.focus,composition,sides};
  }
  function planWave(){
    leaks=leaks.map(n=>n*.5);
    const facts=jevFacts(),token=++jevToken;
    if(!window.Jev){applyPlan({left:Math.ceil(waveSize/2),right:Math.floor(waveSize/2),heavy:'left',line:''});return;}
    if(!Jev.hasModel()){applyPlan(Jev.heuristic(facts));return;}
    // The model answers asynchronously; enemies wait at the gate until the order arrives.
    jevPending=true;
    Jev.plan(facts).then(plan=>{if(token===jevToken)applyPlan(plan);});
  }
  // Heavy enemies take the heavy flank first; the rest fill each flank up to JEV's numbers.
  function applyPlan(plan){
    const levels=Array.from({length:waveSize},(_,i)=>chooseEnemyLevel(i));
    const heavySide=plan.heavy==='right'?1:0,quota=[plan.left,plan.right];
    const order=levels.map((level,i)=>i).sort((a,b)=>levels[b]-levels[a]||a-b);
    const sides=new Array(waveSize);
    for(const i of order){const side=quota[heavySide]>0?heavySide:1-heavySide;sides[i]=side;quota[side]--;}
    spawnQueue=levels.map((level,i)=>({level,side:sides[i]}));
    jevPending=false;
  }
  function renderJevSettings(){
    if(!window.Jev)return;
    const current=Jev.settings();
    el.jevStatus.textContent=Jev.status();
    el.jevKey.value='';el.jevKey.placeholder=current.key?'Ключ сохранён':'sk-or-…';
    el.jevModel.value=current.model;el.jevForget.hidden=!current.key;
  }
  function breakShield(){
    const shield=el.waveShield;shield.classList.remove('breaking','timed');void shield.offsetWidth;shield.classList.add('breaking');
  }
  function updateShield(){
    const shield=el.waveShield,visible=shieldUp&&!ended&&!inMenu&&wave<MAX_WAVES;
    shield.classList.toggle('raised',visible);shield.disabled=!visible||paused;
    if(!visible)return;
    shield.classList.remove('breaking');
    const timed=wave>0;
    shield.classList.toggle('timed',timed);
    document.getElementById('shieldTitle').textContent='Волна '+(wave+1);
    document.getElementById('shieldNote').textContent=timed?`+${earlyBonus()} ◆ за ранний вызов`:'Разбейте щит';
    shield.style.setProperty('--left',timed?Math.max(0,shieldTimer/NEXT_WAVE_DELAY):1);
    shield.setAttribute('aria-label',timed?`Вызвать волну ${wave+1} сейчас и получить ${earlyBonus()} золота`:'Разбить щит и начать первую волну');
  }
  function chooseEnemyLevel(index){
    const highest=Math.min(4,1+Math.floor((wave-1)/2));
    if(highest===1)return 1;
    return index%5===4?highest:Math.max(1,highest-1);
  }
  function spawnEnemy(){
    const order=spawnQueue[spawnNumber]||{level:chooseEnemyLevel(spawnNumber),side:spawnNumber%2};
    const level=order.level, info=enemyData[level], side=order.side;
    const hp=Math.round(info.hp*(1+(wave-1)*WAVE.hpGrowth)*difficulty.hp);
    aliveByWave[wave]++;
    enemies.push({id:++enemyId,wave,level,side,x:835,y:-35,segment:0,hp,maxHp:hp,speed:info.speed*(1+(wave-1)*WAVE.speedGrowth),reward:info.reward,progress:0,anim:Math.random()*5,hit:0,dead:false});
    spawnNumber++;spawnRemaining--;
  }
  function moveEnemy(e,dt){
    const path=paths[e.side];let remaining=e.speed*dt;
    while(remaining>0&&e.segment<path.length-1){
      const to=path[e.segment+1],dx=to.x-e.x,dy=to.y-e.y,dist=Math.hypot(dx,dy);
      if(dist<=remaining){e.x=to.x;e.y=to.y;e.segment++;e.progress+=dist;remaining-=dist;}
      else{e.x+=dx/dist*remaining;e.y+=dy/dist*remaining;e.progress+=remaining;remaining=0;}
    }
    if(e.segment>=path.length-1){e.dead=true;aliveByWave[e.wave]--;leaks[e.side]++;lives=Math.max(0,lives-1);effects.push({x:Math.max(25,Math.min(W-25,e.x)),y:e.y,life:.7,max:.7,type:'escape'});updateUI();if(lives<=0)finish(false);}
    e.anim+=dt*(e.segment===0?6:8);e.hit=Math.max(0,e.hit-dt);
  }
  function windowPosition(p,side){
    const anchor=(TOWERS[p.type].windows||towerWindows[p.level])[side],scale=154/1254;
    return {x:p.x-77+anchor.x*scale,y:p.y-120-TOWER_LIFT-(p.type==='mage'?MAGE_LIFT:0)+anchor.y*scale};
  }
  function fireTower(p){
    const info=stats(p);let target=null;
    for(const e of enemies){
      if(e.dead||Math.hypot(e.x-p.x,e.y-(p.y-42))>info.range)continue;
      if(!target||e.progress>target.progress)target=e;
    }
    if(!target)return false;
    const side=target.x<p.x?'left':'right',origin=windowPosition(p,side);
    if(p.type==='mage'){
      const chargeTime=.35;
      const start={x:p.x,y:p.y-120-TOWER_LIFT-MAGE_LIFT+8};
      p.charge=chargeTime;
      projectiles.push({...start,target,damage:info.damage,splash:info.splash,kind:'magic',speed:470,life:1.6,charge:chargeTime,trail:[]});
    }else{
      projectiles.push({...origin,target,damage:info.damage,speed:700,life:1.1});
      effects.push({...origin,life:.14,max:.14,type:'shot'});
    }
    return true;
  }
  function hurt(e,amount){
    if(e.dead)return;
    e.hp-=amount;e.hit=.13;
    if(e.hp<=0){e.dead=true;aliveByWave[e.wave]--;gold+=e.reward;effects.push({x:e.x,y:e.y-40,life:.7,max:.7,type:'coin',value:e.reward});updateUI();}
  }
  function update(dt){
    if(ended||paused||inMenu||portraitPhone.matches)return;
    if(!shieldUp&&wave>0&&wave<MAX_WAVES&&!spawnRemaining&&(waveSize-(aliveByWave[wave]||0))/waveSize>=difficulty.shieldAt){
      shieldUp=true;shieldTimer=NEXT_WAVE_DELAY;updateUI();
    }
    if(shieldUp&&wave>0){shieldTimer-=dt;if(shieldTimer<=0)startWave();else updateShield();}
    if(spawnRemaining>0&&!jevPending){spawnTimer-=dt;while(spawnTimer<=0&&spawnRemaining>0){spawnEnemy();spawnTimer+=Math.max(WAVE.gapMin,WAVE.gap-wave*WAVE.gapPerWave);}}
    for(const e of enemies)if(!e.dead)moveEnemy(e,dt);
    if(ended)return;
    enemies=enemies.filter(e=>!e.dead);
    for(const p of pads){if(!p.level)continue;p.charge=Math.max(0,(p.charge||0)-dt);p.cooldown-=dt;if(p.cooldown<=0&&fireTower(p))p.cooldown=stats(p).rate;}
    for(const arrow of projectiles){
      arrow.life-=dt;if(arrow.life<=0||arrow.target.dead)continue;
      if(arrow.charge>0){
        arrow.charge=Math.max(0,arrow.charge-dt);
        if(!arrow.charge)effects.push({x:arrow.x,y:arrow.y,life:.18,max:.18,type:'cast'});
        continue;
      }
      const target=arrow.target,tx=target.x,ty=target.y-27,dx=tx-arrow.x,dy=ty-arrow.y,dist=Math.hypot(dx,dy),step=arrow.speed*dt;
      if(dist<=step+12){
        arrow.life=0;hurt(target,arrow.damage);
        if(arrow.splash){
          effects.push({x:tx,y:ty,life:.42,max:.42,type:'blast',radius:arrow.splash,follow:target});
          for(const e of enemies)if(e!==target&&!e.dead&&Math.hypot(e.x-target.x,e.y-target.y)<=arrow.splash)hurt(e,Math.round(arrow.damage*SPLASH_SHARE));
        }else effects.push({x:tx,y:ty,life:.26,max:.26,type:'hit'});
      }
      else{arrow.x+=dx/dist*step;arrow.y+=dy/dist*step;if(arrow.trail){arrow.trail.push({x:arrow.x,y:arrow.y});if(arrow.trail.length>7)arrow.trail.shift();}}
    }
    enemies=enemies.filter(e=>!e.dead);projectiles=projectiles.filter(a=>a.life>0&&!a.target.dead);
    for(const fx of effects){
      fx.life-=dt;
      // A blast rides along with the enemy it hit, so a running target never leaves it behind.
      if(fx.follow&&!fx.follow.dead){fx.x=fx.follow.x;fx.y=fx.follow.y-27;}
    }
    effects=effects.filter(fx=>fx.life>0);
    // Waves can overlap now, so each one pays its reward when its own last enemy is gone.
    for(const w of Object.keys(aliveByWave).map(Number)){
      if(aliveByWave[w]>0||(w===wave&&spawnRemaining>0))continue;
      delete aliveByWave[w];const bonus=WAVE.reward.base+w*WAVE.reward.perWave;gold+=bonus;toast(`Волна ${w} отражена! Награда: ${bonus} ◆`);updateUI();
    }
    if(wave>=MAX_WAVES&&spawnRemaining===0&&enemies.length===0)finish(true);
  }
  function finish(won){ended=true;el.stageMessage.hidden=false;el.stageMessage.innerHTML=`<h2>${won?'Перевал защищён!':'Оборона пала'}</h2><p>${won?'Вы отбили все десять волн.':'Враги прорвались через перевал.'}</p><button id="overlayRestart" class="primary-button" type="button">Играть ещё раз</button>`;document.getElementById('overlayRestart').addEventListener('click',openMenu);updateUI();}
  function draw(){
    ctx.clearRect(0,0,W,H);
    if(map.complete&&map.naturalWidth)ctx.drawImage(map,0,0,W,H);else{ctx.fillStyle='#244c40';ctx.fillRect(0,0,W,H);}
    drawWaterfalls();
    drawFlags();
    drawArches();
    drawBirches();
    // Range is shown for a clicked built tower, or previewed (dashed) while hovering a tower in the build menu.
    const active=selected!==null&&pads[selected].level>0?selected:null;
    if(active!==null){
      drawRange(pads[active],stats(pads[active]).range,false);
      if(previewLevel>pads[active].level&&!towerMenu.hidden)drawRange(pads[active],stats(pads[active],previewLevel).range,true);
    }else if(previewLevel&&!buildMenu.hidden)drawRange(pads[selected],TOWERS[previewType].levels[previewLevel].range,true);
    for(const p of pads){
      if(!p.level&&(p.id===hovered||p.id===selected)&&!ended)drawPadHover(p);
      if(p.level){
        ctx.fillStyle='rgba(0,0,0,.35)';ctx.beginPath();ctx.ellipse(p.x,p.y+23-TOWER_LIFT,45,15,0,0,Math.PI*2);ctx.fill();
        if(p.type==='mage')drawMageTower(p);
        else{
          const image=towerImages.archer[p.level];if(image.complete&&image.naturalWidth)ctx.drawImage(image,p.x-77,p.y-120-TOWER_LIFT,154,154);
          drawPennant(p);
        }
      }
    }
    for(const e of enemies)drawEnemy(e);
    for(const arrow of projectiles)if(!arrow.charge)drawArrow(arrow);
    for(const fx of effects)drawEffect(fx);
    if(paused&&!ended){ctx.fillStyle='rgba(5,28,28,.50)';ctx.fillRect(0,0,W,H);ctx.fillStyle='#fff0bf';ctx.font='bold 58px Georgia';ctx.textAlign='center';ctx.fillText('Пауза',W/2,H/2);ctx.textAlign='left';}
  }
  function drawWaterfalls(){
    if(reducedMotion.matches)return;
    const tick=Math.floor(performance.now()/1000*WATERFALL_FPS);
    waterfalls.forEach((fall,i)=>{
      // Neighbouring waterfalls start on different frames so they do not pulse in unison.
      const image=waterfallFrames[(tick+i*2)%waterfallFrames.length];if(!image.complete||!image.naturalWidth)return;
      const [sx,sy,sw,sh]=fall.src||WATERFALL_SHEET;
      ctx.drawImage(image,sx,sy,sw,sh,fall.x,fall.y,fall.w,fall.h);
    });
  }
  function drawFlags(){
    if(reducedMotion.matches)return;
    const tick=Math.floor(performance.now()/1000*FLAG_FPS);
    flagSets.forEach((set,i)=>{
      const image=set.frames[(tick+i*2)%set.frames.length];
      if(image.complete&&image.naturalWidth)ctx.drawImage(image,set.x,set.y);
    });
  }
  function drawArches(){
    if(reducedMotion.matches)return;
    const tick=Math.floor(performance.now()/1000*ARCH_FPS);
    arches.forEach((arch,i)=>{
      const image=arch.frames[(tick+i*2)%arch.frames.length];
      if(image.complete&&image.naturalWidth)ctx.drawImage(image,arch.x,arch.y);
    });
  }
  function drawBirches(){
    if(reducedMotion.matches)return;
    const tick=Math.floor(performance.now()/1000*BIRCH_FPS);
    birches.forEach((tree,i)=>{
      const image=tree.frames[(tick+i*3)%tree.frames.length];
      if(image.complete&&image.naturalWidth)ctx.drawImage(image,tree.x,tree.y);
    });
  }
  function drawPennant(p){
    // Same 1254 px canvas as the tower image, so it shares its rectangle; towers wave out of step.
    const frames=pennantFrames[p.level];
    const frame=reducedMotion.matches?0:(Math.floor(performance.now()/1000*PENNANT_FPS)+p.id*2)%frames.length;
    const image=frames[frame];
    if(image.complete&&image.naturalWidth)ctx.drawImage(image,p.x-77,p.y-120-TOWER_LIFT,154,154);
  }
  function drawMageTower(p){
    const parts=mageModules[p.level],x=p.x-77,y=p.y-120-TOWER_LIFT-MAGE_LIFT;
    const charging=p.charge>0&&parts.charge;
    const frame=charging?Math.min(4,Math.floor((1-p.charge/.35)*5)):
      (reducedMotion.matches?0:(Math.floor(performance.now()/1000*MAGE_ANIM_FPS)+p.id*2)%5);
    const cache=charging?mageChargeComposites[p.level]:mageComposites[p.level];
    let image=cache[frame];
    if(!image){
      const layers=[parts.base,parts.upper,parts.roof,charging?parts.charge[frame]:parts.crystals[frame]];
      if(layers.some(layer=>!layer.complete||!layer.naturalWidth)){
        const fallback=towerImages.mage[p.level];
        if(fallback.complete&&fallback.naturalWidth)ctx.drawImage(fallback,x,y,154,154);
        return;
      }
      image=document.createElement('canvas');image.width=1254;image.height=1254;
      const layerContext=image.getContext('2d');
      for(const layer of layers)layerContext.drawImage(layer,0,0);
      cache[frame]=image;
    }
    ctx.drawImage(image,x,y,154,154);
    drawMageGlow(p,x,y);
  }
  function drawMageGlow(p,x,y){
    const phase=reducedMotion.matches?0:performance.now()/1000*2.8+p.id*.8;
    const pulse=.5+.5*Math.sin(phase),scale=154/1254;
    const glow=(cx,cy,r,color,alpha)=>{
      const gradient=ctx.createRadialGradient(cx,cy,0,cx,cy,r);
      gradient.addColorStop(0,`rgba(${color},${alpha})`);
      gradient.addColorStop(1,`rgba(${color},0)`);
      ctx.fillStyle=gradient;ctx.fillRect(cx-r,cy-r,r*2,r*2);
    };
    ctx.save();ctx.globalCompositeOperation='screen';
    const windowColor=p.level<=3?'255,190,95':'192,104,255';
    for(const sx of [512,742])glow(x+sx*scale,y+690*scale,9,windowColor,.13+.13*pulse);
    if(p.level>1){
      const crystalY={2:85,3:83,4:109,5:121}[p.level];
      const crystalColor=p.level<=3?'255,178,70':'199,94,255';
      glow(p.x,y+crystalY*scale,10+p.level*1.5,crystalColor,.16+.23*pulse);
      if(p.level>=4){
        const drift=reducedMotion.matches?0:Math.sin(phase*.7);
        glow(p.x-8+drift*3,y+crystalY*scale-7,4,'255,230,255',.18+.18*pulse);
        glow(p.x+9-drift*2,y+crystalY*scale+4,3,'225,146,255',.14+.16*(1-pulse));
      }
    }
    ctx.restore();
  }
  function drawPadHover(p){
    const elapsed=(performance.now()-hoverStarted)/1000;
    const frame=reducedMotion.matches?0:Math.floor(elapsed*PAD_FRAME.fps)%padFrames.length;
    const image=padFrames[frame];if(!image.complete||!image.naturalWidth)return;
    const ring=padRings[p.id],scale=ring.w/PAD_FRAME.ringW;
    ctx.save();ctx.imageSmoothingQuality='high';
    ctx.drawImage(image,ring.x-PAD_FRAME.cx*scale,ring.y-PAD_FRAME.cy*scale,PAD_FRAME.w*scale,PAD_FRAME.h*scale);
    ctx.restore();
  }
  function drawRange(p,range,preview){
    const cy=p.y-42;
    ctx.fillStyle='rgba(107,195,227,.13)';
    ctx.beginPath();ctx.moveTo(p.x,cy);ctx.arc(p.x,cy,range,Math.PI/2,Math.PI*1.5);ctx.closePath();ctx.fill();
    ctx.fillStyle='rgba(241,199,106,.13)';
    ctx.beginPath();ctx.moveTo(p.x,cy);ctx.arc(p.x,cy,range,-Math.PI/2,Math.PI/2);ctx.closePath();ctx.fill();
    ctx.strokeStyle='rgba(255,229,151,.62)';ctx.lineWidth=2;
    if(preview)ctx.setLineDash([12,9]);
    ctx.beginPath();ctx.arc(p.x,cy,range,0,Math.PI*2);ctx.stroke();
    ctx.setLineDash([]);
  }
  function drawEnemy(e){
    const data=enemyData[e.level],image=enemyImages[e.level],size=data.size;
    ctx.fillStyle='rgba(10,25,21,.4)';ctx.beginPath();ctx.ellipse(e.x,e.y+3,size*.34,9,0,0,Math.PI*2);ctx.fill();
    if(image.complete&&image.naturalWidth){
      const frame=Math.floor(e.anim)%5,cellW=image.naturalWidth/5,cellH=image.naturalHeight/3;
      ctx.save();ctx.translate(e.x,e.y);if(e.segment===1&&e.side===0)ctx.scale(-1,1);
      if(e.hit>0){ctx.filter='brightness(1.6)';}
      ctx.drawImage(image,frame*cellW,cellH,cellW,cellH,-size/2,-size+6,size,size);
      ctx.restore();
    }else{ctx.fillStyle='#913d31';ctx.beginPath();ctx.arc(e.x,e.y-25,20,0,Math.PI*2);ctx.fill();}
    const barW=size*.72,barX=e.x-barW/2,barY=e.y-size+4;
    ctx.fillStyle='#172a25';ctx.fillRect(barX-1,barY-1,barW+2,6);
    ctx.fillStyle=e.hp/e.maxHp>.5?'#8fce75':e.hp/e.maxHp>.25?'#e6b562':'#e67965';ctx.fillRect(barX,barY,barW*Math.max(0,e.hp/e.maxHp),4);
  }
  function drawArrow(a){
    if(a.kind==='magic'){drawBolt(a);return;}
    const angle=Math.atan2(a.target.y-27-a.y,a.target.x-a.x);ctx.save();ctx.translate(a.x,a.y);ctx.rotate(angle);ctx.strokeStyle='#4a3320';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(-12,0);ctx.lineTo(7,0);ctx.stroke();ctx.fillStyle='#f7df9a';ctx.beginPath();ctx.moveTo(13,0);ctx.lineTo(4,-4);ctx.lineTo(4,4);ctx.closePath();ctx.fill();ctx.restore();
  }
  function drawBolt(a){
    ctx.save();
    a.trail.forEach((t,i)=>{const k=(i+1)/a.trail.length;ctx.globalAlpha=k*.45;ctx.fillStyle='#b673ff';ctx.beginPath();ctx.arc(t.x,t.y,2+k*4,0,Math.PI*2);ctx.fill();});
    ctx.globalAlpha=1;
    const sprite=magicOrbFrames[5];
    if(sprite.complete&&sprite.naturalWidth){
      ctx.translate(a.x,a.y);
      ctx.rotate(Math.atan2(a.target.y-27-a.y,a.target.x-a.x));
      ctx.imageSmoothingEnabled=false;
      ctx.drawImage(sprite,-25,-25,50,50);
    }else{
      const glow=ctx.createRadialGradient(a.x,a.y,0,a.x,a.y,13);
      glow.addColorStop(0,'#fff4ff');glow.addColorStop(.35,'#d59bff');glow.addColorStop(1,'rgba(140,60,230,0)');
      ctx.fillStyle=glow;ctx.beginPath();ctx.arc(a.x,a.y,13,0,Math.PI*2);ctx.fill();
    }
    ctx.restore();
  }
  function drawEffect(fx){
    const t=fx.life/fx.max;ctx.save();ctx.globalAlpha=Math.min(1,t*1.7);
    if(fx.type==='coin'){ctx.font='bold 21px Trebuchet MS';ctx.textAlign='center';ctx.fillStyle='#ffe087';ctx.strokeStyle='#2d3428';ctx.lineWidth=3;ctx.strokeText('+'+fx.value,fx.x,fx.y-(1-t)*30);ctx.fillText('+'+fx.value,fx.x,fx.y-(1-t)*30);}
    else if(fx.type==='build'){ctx.strokeStyle='#f9e6a4';ctx.lineWidth=5*t;ctx.beginPath();ctx.arc(fx.x,fx.y,(1-t)*72,0,Math.PI*2);ctx.stroke();}
    else if(fx.type==='blast'){
      const frame=Math.min(9,Math.floor((1-t)*10)),ground=magicGroundFrames[frame],orb=magicOrbFrames[Math.min(9,6+Math.floor((1-t)*4))];
      if(ground.complete&&ground.naturalWidth){
        // The impact point of a ground frame is at (120, 147) of 240 × 192; pin it to the enemy's feet
        // (fx.y is the body centre, 27 px above them), whatever the blast size.
        const w=fx.radius*2.35,h=w*.8,feetY=fx.y+27;
        ctx.imageSmoothingEnabled=false;
        ctx.drawImage(ground,fx.x-w*120/240,feetY-h*147/192,w,h);
        if(orb.complete&&orb.naturalWidth)ctx.drawImage(orb,fx.x-29,fx.y-29,58,58);
      }else{
        const r=fx.radius*(1-t*.55);
        ctx.fillStyle='rgba(176,104,255,'+(.28*t)+')';ctx.beginPath();ctx.ellipse(fx.x,fx.y+14,r,r*.55,0,0,Math.PI*2);ctx.fill();
        ctx.strokeStyle='#e2b8ff';ctx.lineWidth=3*t;ctx.beginPath();ctx.ellipse(fx.x,fx.y+14,r,r*.55,0,0,Math.PI*2);ctx.stroke();
      }
    }
    else if(fx.type==='cast'){
      const sprite=magicOrbFrames[Math.min(4,Math.floor((1-t)*5))];
      if(sprite.complete&&sprite.naturalWidth){ctx.imageSmoothingEnabled=false;ctx.drawImage(sprite,fx.x-25,fx.y-25,50,50);}
      else{ctx.fillStyle='#d8a6ff';ctx.beginPath();ctx.arc(fx.x,fx.y,9*t,0,Math.PI*2);ctx.fill();}
    }
    else if(fx.type==='escape'){ctx.fillStyle='#e77a69';ctx.font='bold 25px Trebuchet MS';ctx.textAlign='center';ctx.fillText('−1 ♥',fx.x,fx.y-(1-t)*25);}
    else{ctx.fillStyle=fx.type==='hit'?'#fff2bc':'#ffdd93';ctx.beginPath();ctx.arc(fx.x,fx.y,fx.type==='hit'?(1-t)*15+3:7*t,0,Math.PI*2);ctx.fill();}
    ctx.restore();
  }
  function loop(now){let dt=Math.min((now-lastTime)/1000,.05);lastTime=now;update(dt*speed);draw();requestAnimationFrame(loop);}
  function canvasPoint(event){const rect=canvas.getBoundingClientRect();return{x:(event.clientX-rect.left)*W/rect.width,y:(event.clientY-rect.top)*H/rect.height};}
  function padAt(point){
    // The painted pads shrink to about 24 px on a portrait phone. Keep them
    // selectable with a finger while choosing the nearest pad in close pairs.
    const touchRadius=window.matchMedia('(pointer:coarse)').matches?24*W/canvas.clientWidth:60;
    let found=null,best=Math.max(60,touchRadius);
    for(const p of pads){
      // A built tower is also clickable by its body, not just the stone pad under it.
      const onTower=p.level&&Math.abs(point.x-p.x)<48&&point.y>p.y-118&&point.y<p.y+25;
      const d=onTower?0:Math.hypot(p.x-point.x,p.y-point.y);
      if(d<best){found=p.id;best=d;}
    }
    return found;
  }
  canvas.addEventListener('pointermove',event=>{const pad=padAt(canvasPoint(event));if(pad!==hovered){hovered=pad;hoverStarted=performance.now();canvas.style.cursor=pad===null?'default':'pointer';}});
  canvas.addEventListener('pointerleave',()=>{hovered=null;canvas.style.cursor='default';});
  canvas.addEventListener('click',event=>{selected=padAt(canvasPoint(event));updateUI();});
  for(const [button,type] of buildChoices)button.addEventListener('click',()=>{if(selected!==null&&!pads[selected].level)buildTower(pads[selected],type);});
  upgradeOption.addEventListener('click',()=>{
    const p=pads[selected];if(!p||!p.level||p.level>=5)return;
    if(!upgradeArmed){
      if(gold>=stats(p,p.level+1).cost){upgradeArmed=true;updateTowerMenu();}
      setTowerInfo(upgradeOption);
      return;
    }
    upgradeArmed=false;buildTower(p);
    if(!towerMenu.hidden)setTowerInfo(null);
  });
  sellOption.addEventListener('click',()=>{const p=pads[selected];if(p&&p.level){sellTower(p);selected=null;updateUI();}});
  for(const button of document.querySelectorAll('.selection-close'))button.addEventListener('click',()=>{selected=null;updateUI();canvas.focus({preventScroll:true});});
  document.addEventListener('pointerdown',event=>{
    const open=!buildMenu.hidden||!towerMenu.hidden,inside=buildMenu.contains(event.target)||towerMenu.contains(event.target);
    if(open&&event.target!==canvas&&!inside){selected=null;updateUI();}
  });
  for(const [menu,set] of [[buildMenu,setPlaque],[towerMenu,setTowerInfo]])for(const option of menu.querySelectorAll('.build-option')){
    for(const type of ['pointerenter','focus'])option.addEventListener(type,()=>set(option));
    for(const type of ['pointerleave','blur'])option.addEventListener(type,()=>{if(!menu.hidden)set(menu===towerMenu&&upgradeArmed?upgradeOption:null);});
  }
  window.addEventListener('resize',positionBuildMenu);
  window.visualViewport?.addEventListener('resize',positionBuildMenu);
  window.visualViewport?.addEventListener('scroll',positionBuildMenu);
  el.waveShield.addEventListener('click',startWave);
  el.pauseButton.addEventListener('click',()=>{if(ended)return;paused=!paused;updateUI();});
  el.speedButton.addEventListener('click',()=>{speed=speed===1?2:1;updateUI();});
  el.restartButton.addEventListener('click',openMenu);
  el.menuResume.addEventListener('click',closeMenu);
  el.jevSave.addEventListener('click',()=>{
    const key=el.jevKey.value.trim()||Jev.settings().key;
    Jev.save({key,model:el.jevModel.value.trim()});renderJevSettings();
  });
  el.jevForget.addEventListener('click',()=>{Jev.save({key:'',model:el.jevModel.value.trim()});renderJevSettings();});
  for(const banner of el.menu.querySelectorAll('.banner')){
    banner.querySelector('.banner-shield').innerHTML=pixelShield(SHIELD_COLORS[banner.dataset.difficulty]);
    banner.addEventListener('click',()=>startGame(banner.dataset.difficulty));
  }
  el.waveShield.querySelector('.shield-art').innerHTML=pixelShield(SHIELD_COLORS.enemy);
  document.addEventListener('keydown',event=>{
    if(inMenu){
      if(event.target instanceof HTMLInputElement)return;
      if(/^Digit[1-3]$/.test(event.code))startGame(['easy','normal','hard'][Number(event.code.slice(-1))-1]);
      else if(event.code==='Escape'&&!el.menuResume.hidden)closeMenu();
      return;
    }
    if(event.code==='Space'){event.preventDefault();if(!ended){paused=!paused;updateUI();}}
    else if(/^Digit[1-8]$/.test(event.code)){selected=Number(event.code.slice(-1))-1;updateUI();}
    else if(event.code==='Enter'&&!event.repeat&&document.activeElement?.tagName!=='BUTTON')startWave();
    else if(event.code==='Escape'){selected=null;updateUI();}
  });
  reset();openMenu();requestAnimationFrame(loop);
})();
