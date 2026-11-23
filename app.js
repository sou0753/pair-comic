'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const canvas = $('preview');
  const ctx = canvas.getContext('2d');
  const sizes = { landscape: [1800, 1200], square: [1600, 1600], portrait: [1200, 1800], wide: [1920, 1080] };
  const freshPanel = () => ({ asset: null, zoom: 1, x: .5, y: .5, effect: 'none', strength: .6 });
  let state = { photoCount: 2, rowSplit: .5, mainWidth: .5, readingDirection: 'ltr', showNumbers: true, showFlow: true, backgroundStyle: 'solid', backgroundSecond: '#b5a1ee', gradientDirection: 'diagonal', patternSize: 36, layout: 'horizontal', aspect: 'landscape', split: .5, gap: 8, border: 12, background: '#ffffff', panels: Array.from({ length: 4 }, freshPanel), objects: [] };
  let activePhoto = 0, activeTab = 'layout', selectedObject = null;
  let undoStack = [], redoStack = [], editBefore = null, gestureBefore = null;
  let savedUrl = null, savedBlob = null, savedFile = null, loading = 0, exporting = false;
  let nextId = 1, toastTimer, raf = 0;
  const assets = new Map(), pointers = new Map(), loadSequence = [0, 0, 0, 0];
  let gesture = null;
  const copy = value => JSON.parse(JSON.stringify(value));
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const changed = (a, b) => JSON.stringify(a) !== JSON.stringify(b);
  const object = () => state.objects.find(item => item.id === selectedObject);
  const dimension = () => state.photoCount === 1 && state.aspect === 'square' ? [1024,1024] : state.photoCount === 1 && state.aspect === 'portrait' ? [832,1216] : sizes[state.aspect];

  function toast(message) {
    $('toast').textContent = message;
    $('toast').classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => $('toast').classList.remove('visible'), 4200);
  }
  function pruneAssets() {
    const used = new Set([state, ...undoStack, ...redoStack].flatMap(s => s.panels.map(p => p.asset)).filter(Boolean));
    for (const id of assets.keys()) if (!used.has(id)) assets.delete(id);
  }
  function remember(before) {
    if (!before || !changed(before, state)) return;
    undoStack.push(before);
    if (undoStack.length > 30) undoStack.shift();
    redoStack = [];
    // Bound retained image memory when many different photos are imported.
    while (undoStack.length && new Set([state, ...undoStack].flatMap(s => s.panels.map(p => p.asset)).filter(Boolean)).size > 6) undoStack.shift();
    pruneAssets();
  }
  function finishEdit() { if (editBefore) { remember(editBefore); editBefore = null; sync(); } }
  function action(fn) { finishEdit(); const before = copy(state); fn(); remember(before); update(); }
  function update() { sync(); requestDraw(); }
  function requestDraw() { if (!raf) raf = requestAnimationFrame(() => { raf = 0; drawPreview(); }); }
  function setTab(tab) {
    finishEdit(); activeTab = tab;
    document.querySelectorAll('[data-tab]').forEach(btn => {
      const active = btn.dataset.tab === tab;
      btn.setAttribute('aria-selected', active);
      btn.tabIndex = active ? 0 : -1;
      $('panel-' + btn.dataset.tab).hidden = !active;
    });
    update();
  }
  function selectPhoto(index) { finishEdit(); activePhoto = index; update(); }
  function sync() {
    activePhoto = Math.min(activePhoto, state.photoCount - 1);
    const p = state.panels[activePhoto], o = object();
    $('undo').disabled = !undoStack.length;
    $('redo').disabled = !redoStack.length;
    activePhoto = Math.min(activePhoto, state.photoCount - 1);
    const count = state.panels.slice(0, state.photoCount).filter(p => p.asset).length;
    $('export').disabled = count < state.photoCount || loading > 0 || exporting;
    $('export').textContent = exporting ? '作成中…' : '画像を保存 ↗';
    $('saveSummary').textContent = loading ? '画像を読み込み中…' : count === state.photoCount ? `${state.photoCount}枚の画像、準備OK。` : `あと${state.photoCount - count}枚、画像を選びましょう`;
    $('sizeLabel').textContent = dimension().join(' × ');
    $('squareOption').textContent = state.photoCount === 1 ? '正方形 1024 × 1024' : '正方形 1 : 1';
    $('portraitOption').textContent = state.photoCount === 1 ? '縦長 832 × 1216' : '縦長 2 : 3';
    $('canvasHint').textContent = count === 0 ? `画像を${state.photoCount}枚選んでください` : activeTab === 'decor' ? '装飾を1本指で移動・2本指で拡大／縮小' : '画像を1本指で移動・2本指で拡大／縮小';
    canvas.classList.toggle('portrait', state.aspect === 'portrait');
    canvas.classList.toggle('square', state.aspect === 'square');
    state.panels.forEach((panel, i) => {
      const btn = $('upload' + i);
      btn.hidden = i >= state.photoCount;
      btn.classList.toggle('active', i === activePhoto && count > 0);
      btn.querySelector('strong').textContent = panel.asset ? '画像を変更' : '画像を選ぶ';
      btn.querySelector('small').textContent = panel.asset ? '選択済み · タップで変更' : `${i + 1}枚目のシーン`;
      btn.querySelector('.plus').textContent = panel.asset ? '✓' : '＋';
    });
    document.querySelectorAll('[data-layout]').forEach(btn => { const active = btn.dataset.layout === state.layout; btn.classList.toggle('selected', active); btn.setAttribute('aria-pressed', active); });
    document.querySelectorAll('[data-photo]').forEach(btn => { btn.hidden = Number(btn.dataset.photo) >= state.photoCount; btn.setAttribute('aria-pressed', Number(btn.dataset.photo) === activePhoto); });
    document.querySelectorAll('[data-count]').forEach(btn => btn.setAttribute('aria-pressed', Number(btn.dataset.count) === state.photoCount));
    $('basicLayouts').hidden = state.photoCount === 1; $('swap').hidden = state.photoCount === 1; $('gap').disabled = state.photoCount === 1;
    $('gridLayout').hidden = state.photoCount !== 4;
    $('threeLayouts').hidden = state.photoCount !== 3;
    const side = state.photoCount === 3 && ['right-main','left-main'].includes(state.layout);
    const story = state.photoCount === 3 && ['top-one','top-two','right-main','left-main'].includes(state.layout);
    $('storyControls').hidden = !story;
    $('mainWidthControl').hidden = !side; $('topReading').hidden = side;
    $('mainWidth').value = Math.round(state.mainWidth*100); $('mainWidthValue').textContent = Math.round(state.mainWidth*100)+'%';
    document.querySelector('label[for="rowSplit"]').textContent = side ? '小さい2コマの高さ' : '上段・下段の高さ';
    $('rowSplit').value = Math.round(state.rowSplit * 100);
    $('rowSplitValue').textContent = Math.round(state.rowSplit*100) + ' : ' + (100-Math.round(state.rowSplit*100));
    $('readingDirection').value = state.readingDirection;
    $('showNumbers').checked = state.showNumbers; $('showFlow').checked = state.showFlow;
    $('reorderPhoto').value = activePhoto;
    $('moveBefore').disabled = activePhoto === 0; $('moveAfter').disabled = activePhoto >= 2;
    const right = state.readingDirection === 'rtl';
    $('readingHint').textContent = state.layout === 'top-one' ? (right ? '①上 → ②右下 → ③左下' : '①上 → ②左下 → ③右下') : (right ? '①右上 → ②左上 → ③下' : '①左上 → ②右上 → ③下');
    if(side) $('readingHint').textContent = state.layout==='right-main' ? '①右の大枠 → ②左上 → ③左下' : '①左の大枠 → ②右上 → ③右下';
    $('splitControls').hidden = state.photoCount !== 2;
    $('equalHint').hidden = state.photoCount <= 2 || story;
    $('swap').textContent = state.photoCount === 2 ? '画像を入れ替え ⇄' : '順番をずらす ↻';
    $('backgroundOptions').hidden = state.backgroundStyle === 'solid';
    $('gradientOptions').hidden = state.backgroundStyle !== 'gradient';
    $('patternOptions').hidden = !['dots', 'stripes'].includes(state.backgroundStyle);
    document.querySelectorAll('[data-background]').forEach(btn => btn.setAttribute('aria-pressed', btn.dataset.background === state.background));
    for (const [id, value] of Object.entries({ backgroundStyle: state.backgroundStyle, backgroundSecond: state.backgroundSecond, gradientDirection: state.gradientDirection, patternSize: state.patternSize, aspect: state.aspect, split: Math.round(state.split * 100), gap: state.gap, border: state.border, background: state.background, zoom: Math.round(p.zoom * 100), effect: p.effect, effectStrength: Math.round(p.strength * 100) })) $(id).value = value;
    $('splitValue').textContent = `${Math.round(state.split * 100)} : ${100 - Math.round(state.split * 100)}`;
    $('gapValue').textContent = state.gap;
    $('borderValue').textContent = state.border;
    $('zoomValue').textContent = `${Math.round(p.zoom * 100)}%`;
    $('effectValue').textContent = `${Math.round(p.strength * 100)}%`;
    $('zoom').disabled = !p.asset;
    $('resetCrop').disabled = !p.asset; $('fitPhoto').disabled = !p.asset; $('zoom').min = Math.min(1, minimumZoom(p, rects()[activePhoto]) * 100);
    document.querySelectorAll('[data-nudge]').forEach(btn => btn.disabled = !p.asset);
    $('overlayCount').textContent = `${state.objects.length} / 12`;
    ['addArrow','addText','addBubble','addSound','addStamp'].forEach(id=>$(id).disabled=state.objects.length>=12);
    if (!o && state.objects.length) { selectedObject = state.objects[state.objects.length - 1].id; }
    syncObject();
  }
  function syncObject() {
    const o = object();
    $('overlayEditor').hidden = !o;
    if (!o) return;
    const select = $('overlaySelect');
    // Use textContent for user-entered text; never interpret it as markup.
    select.replaceChildren(...state.objects.map((item, i) => {
      const opt = document.createElement('option'); opt.value = item.id;
      opt.textContent = `${i + 1}. ${item.type==='bubble' ? ((item.group?'連結・':'')+'吹き出し '+(item.text||'').replace(/\n/g,' ').slice(0,12)) : ({arrow:'矢印',stamp:'スタンプ',sound:'効果音文字'})[item.type] || item.text || '文字'}`;
      return opt;
    }));
    select.value = o.id;
    const isText=['text','sound','bubble'].includes(o.type);
    $('textField').hidden = !isText; $('fontControls').hidden=!isText;
    $('bubbleControls').hidden=o.type!=='bubble'; $('stampControls').hidden=o.type!=='stamp';
    $('outlineControls').hidden=!['text','sound','stamp'].includes(o.type);
    $('objectFont').value=o.font||'system';
    $('fontStatus').textContent=fontStates.get(o.font)==='loading'?'フォントを読み込み中…':fontStates.get(o.font)==='failed'?'フォントを取得できません。接続中に選び直してください。':'';
    $('stampSymbol').value=o.symbol||'star'; $('bubbleShape').value=o.shape||'oval'; $('bubbleTail').value=o.tail||'bottom';
    $('bubbleFill').value=o.fill||'#ffffff'; $('bubbleBorder').value=o.borderColor||'#252635';
    $('roughnessControl').hidden=o.shape!=='organic';
    $('bubbleOpacity').value=Math.round((o.fillOpacity??.6)*100);$('bubbleOpacityValue').textContent=Math.round((o.fillOpacity??.6)*100)+'%';
    $('bubbleLineWidth').value=o.borderWidth??2;$('bubbleLineValue').textContent=o.borderWidth??2;
    $('bubbleRoughness').value=Math.round((o.roughness??.04)*100);
    $('bubbleWriting').value=o.writing||'horizontal';$('bubbleHalo').checked=o.textHalo!==false;
    $('moveLinked').checked=o.moveTogether!==false;
    const partnerControl=$('bubblePartner'),previousPartner=partnerControl.value;
    const candidates=state.objects.filter(item=>item.type==='bubble'&&item.id!==o.id&&!item.group);
    partnerControl.replaceChildren(...candidates.map(item=>{const option=document.createElement('option');option.value=item.id;option.textContent=(state.objects.indexOf(item)+1)+'. '+(item.text||'吹き出し').slice(0,16);return option;}));
    if(candidates.some(item=>item.id===previousPartner))partnerControl.value=previousPartner;else if(candidates.length)partnerControl.value=candidates[0].id;
    partnerControl.disabled=!!o.group||!candidates.length;
    $('joinBubbles').disabled=!!o.group||!candidates.length;$('unlinkBubbles').hidden=!o.group;$('moveLinkedLabel').hidden=!o.group;
    $('bubbleLinkHint').textContent=o.group?'連結中。背景色・濃さ・輪郭線は2つ共通、文章と文字設定は個別です。':candidates.length?'相手を下に配置し、収まるよう調整します。接合部分の線は消えます。':'吹き出しをもう1つ追加すると連結できます。';
    $('bubblePadding').value=Math.round((o.padding??.03)*100); $('bubblePaddingValue').textContent=Math.round((o.padding??.03)*100)+'%';
    $('bubbleRatio').value=Math.round((o.ratio||.65)*100); $('bubbleTextSize').value=Math.round((o.textScale||.04)*1000);
    $('outlineColor').value=o.outlineColor||'#ffffff'; $('outlineWidth').value=Math.round((o.outline??.09)*100);
    if (document.activeElement !== $('textContent')) $('textContent').value = o.text || '';
    $('objectSize').value = Math.round(o.size * 100);
    $('objectAngle').value = Math.round(o.angle);
    $('objectX').value = Math.round(o.x * 100); $('objectY').value = Math.round(o.y * 100);
    $('objectColor').value = o.color;
    $('objectSizeValue').textContent = Math.round(o.size * 100);
    $('objectAngleValue').textContent = `${Math.round(o.angle)}°`;
  }
  function rects() {
    const [w, h] = dimension(), unit = Math.min(w, h) / 1200;
    const b = state.border * unit, g = state.gap * unit, iw = w - b * 2, ih = h - b * 2;
    if(state.photoCount===1) return [{x:b,y:b,w:iw,h:ih}];
    if(state.photoCount===3 && ['right-main','left-main'].includes(state.layout)) {
      const mainW=(iw-g)*state.mainWidth,smallW=iw-g-mainW,topH=(ih-g)*state.rowSplit;
      const right=state.layout==='right-main',mainX=right?b+smallW+g:b,smallX=right?b:b+mainW+g;
      return [{x:mainX,y:b,w:mainW,h:ih},{x:smallX,y:b,w:smallW,h:topH},{x:smallX,y:b+topH+g,w:smallW,h:ih-g-topH}];
    }
    if (state.photoCount === 3 && ['top-one','top-two','right-main','left-main'].includes(state.layout)) {
      const topH = (ih-g)*state.rowSplit, bottomH = ih-g-topH, halfW=(iw-g)/2;
      const fullTop={x:b,y:b,w:iw,h:topH}, fullBottom={x:b,y:b+topH+g,w:iw,h:bottomH};
      const pairY=state.layout==='top-one'?fullBottom.y:b, pairH=state.layout==='top-one'?bottomH:topH;
      const pair=[{x:b,y:pairY,w:halfW,h:pairH},{x:b+halfW+g,y:pairY,w:halfW,h:pairH}];
      if(state.readingDirection==='rtl') pair.reverse();
      return state.layout==='top-one' ? [fullTop,...pair] : [...pair,fullBottom];
    }
    if (state.layout === 'grid' && state.photoCount === 4) {
      const rw = (iw-g)/2, rh = (ih-g)/2;
      return Array.from({length:4}, (_,i)=>({x:b+(i%2)*(rw+g), y:b+Math.floor(i/2)*(rh+g), w:rw, h:rh}));
    }
    if (state.photoCount > 2) {
      const horizontal = state.layout === 'horizontal', n = state.photoCount;
      const step = ((horizontal ? iw : ih) - g*(n-1))/n;
      return Array.from({length:n}, (_,i)=>({x:b+(horizontal ? i*(step+g):0), y:b+(horizontal ? 0:i*(step+g)), w:horizontal ? step:iw, h:horizontal ? ih:step}));
    }
    if (state.layout === 'horizontal') { const first = (iw - g) * state.split; return [{ x: b, y: b, w: first, h: ih }, { x: b + first + g, y: b, w: iw - g - first, h: ih }]; }
    const first = (ih - g) * state.split; return [{ x: b, y: b, w: iw, h: first }, { x: b, y: b + first + g, w: iw, h: ih - g - first }];
  }
  function minimumZoom(p, r) {
    const img=assets.get(p.asset);
    return img ? Math.min(.01, Math.min(r.w/img.width,r.h/img.height)/Math.max(r.w/img.width,r.h/img.height)) : .01;
  }
  function geometry(p, r) {
    const img = assets.get(p.asset);
    if (!img) return null;
    const scale = Math.max(r.w / img.width, r.h / img.height) * p.zoom;
    const w = img.width * scale, h = img.height * scale;
    return { img, w, h, overflowX: w-r.w, overflowY: h-r.h, x: r.x-(w-r.w)*p.x, y: r.y-(h-r.h)*p.y };
  }
  function placeholder(c, r, index) {
    const gradient = c.createLinearGradient(r.x, r.y, r.x + r.w, r.y + r.h);
    gradient.addColorStop(0, index ? '#e3e8e1' : '#e9e3f4'); gradient.addColorStop(1, index ? '#eef0e8' : '#f3eef8');
    c.fillStyle = gradient; c.fillRect(r.x, r.y, r.w, r.h);
    const unit = Math.min(r.w, r.h);
    c.fillStyle = index ? '#c2cabb' : '#c4b6e1'; c.beginPath(); c.arc(r.x + r.w * .73, r.y + r.h * .26, unit * .08, 0, Math.PI * 2); c.fill();
    c.globalAlpha = .23; c.beginPath(); c.moveTo(r.x, r.y + r.h); c.lineTo(r.x + r.w * .35, r.y + r.h * .48); c.lineTo(r.x + r.w * .62, r.y + r.h * .73); c.lineTo(r.x + r.w * .81, r.y + r.h * .58); c.lineTo(r.x + r.w, r.y + r.h * .83); c.lineTo(r.x + r.w, r.y + r.h); c.closePath(); c.fill(); c.globalAlpha = 1;
    c.fillStyle = index ? '#809078' : '#947bbd'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.font = `700 ${unit * .13}px -apple-system, sans-serif`; c.fillText(`0${index + 1}`, r.x + r.w / 2, r.y + r.h * .42);
    c.font = `500 ${unit * .043}px -apple-system, sans-serif`; c.fillText('ここに、あなたの画像を。', r.x + r.w / 2, r.y + r.h * .56);
  }
  function comicEffect(c, r, panel) {
    if (panel.effect === 'none') return;
    c.save(); c.globalAlpha = panel.strength; c.strokeStyle = '#171820'; c.fillStyle = '#171820';
    const short = Math.min(r.w, r.h), cx = r.x + r.w / 2, cy = r.y + r.h / 2;
    if (panel.effect === 'focus') {
      for (let i = 0; i < 66; i++) {
        const angle = i * Math.PI * 2 / 66, spread = .0035 + (i % 4) * .001;
        const inner = short * (.23 + ((i * 17) % 13) / 80), outer = Math.hypot(r.w, r.h);
        c.beginPath(); c.moveTo(cx + Math.cos(angle) * inner, cy + Math.sin(angle) * inner);
        c.lineTo(cx + Math.cos(angle - spread) * outer, cy + Math.sin(angle - spread) * outer);
        c.lineTo(cx + Math.cos(angle + spread) * outer, cy + Math.sin(angle + spread) * outer); c.closePath(); c.fill();
      }
    } else if (panel.effect === 'speed') {
      for (let i = 0; i < 40; i++) {
        const y = r.y + r.h * ((i * 23 % 41) / 41), len = r.w * (.13 + (i % 6) * .05), left = i % 2 === 0;
        c.lineWidth = short * (.0014 + (i % 3) * .0012); c.beginPath();
        const x = left ? r.x : r.x + r.w; c.moveTo(x, y); c.lineTo(x + (left ? len : -len), y - len * .12); c.stroke();
      }
    } else if (panel.effect === 'sparkle') {
      const points = [[.15,.18,.07],[.79,.15,.05],[.86,.64,.07],[.18,.79,.045],[.64,.86,.04],[.08,.48,.024],[.6,.11,.025],[.93,.38,.03]];
      points.forEach(([x, y, size]) => {
        const px = r.x + r.w * x, py = r.y + r.h * y, s = short * size;
        c.beginPath(); c.moveTo(px, py - s); c.quadraticCurveTo(px + s * .2, py - s * .2, px + s * .65, py); c.quadraticCurveTo(px + s * .2, py + s * .2, px, py + s); c.quadraticCurveTo(px - s * .2, py + s * .2, px - s * .65, py); c.quadraticCurveTo(px - s * .2, py - s * .2, px, py - s); c.closePath();
        c.strokeStyle = '#463626'; c.lineWidth = short * .003; c.stroke(); c.fillStyle = '#fff4a6'; c.fill();
      });
    }
    c.restore();
  }
  const FONT_DEFS = {
    zen: { family: 'PairZen', file: 'ZenKakuGothicNew-Regular.ttf' },
    maru: { family: 'PairMaru', file: 'ZenMaruGothic-Regular.ttf' },
    yomogi: { family: 'PairYomogi', file: 'Yomogi-Regular.ttf' },
    kiwi: { family: 'PairKiwi', file: 'KiwiMaru-Regular.ttf' }
  };
  const fontLoads = new Map(), fontStates = new Map();
  function ensureFont(key) {
    const def = FONT_DEFS[key];
    if (!def) return Promise.resolve();
    if (fontLoads.has(key)) return fontLoads.get(key);
    fontStates.set(key, 'loading');
    const load = new FontFace(def.family, `url("./${def.file}")`).load().then(face => {
      document.fonts.add(face); fontStates.set(key, 'ready'); requestDraw();
    }).catch(error => { fontStates.set(key, 'failed'); fontLoads.delete(key); throw error; });
    fontLoads.set(key, load); return load;
  }
  function fontSpec(o, px) {
    const def = FONT_DEFS[o.font];
    return `${def ? 400 : 800} ${px}px ${def ? '"' + def.family + '", ' : ''}-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
  }
  function wrapBubble(c, text, maxWidth) {
    const lines=[];
    for(const paragraph of text.split('\n')) {
      let line='';
      for(const char of Array.from(paragraph)) {
        if(line && c.measureText(line+char).width>maxWidth) {lines.push(line);line=char;} else line+=char;
      }
      lines.push(line);
    }
    return lines;
  }
  function objectMetrics(c, o) {
    const [w,h]=dimension(), short=Math.min(w,h);
    if(o.type==='arrow')return {w:short*o.size*2,h:short*o.size*.65};
    if(o.type==='stamp')return {w:short*o.size,h:short*o.size};
    if(o.type==='bubble') {
      const bw=short*o.size*2,bh=bw*(o.ratio||.65),tail=o.tail==='none'?0:Math.min(bw,bh)*.28;
      const rough=o.shape==='organic'?(o.roughness??.04):0;
      const layout=bubbleTextLayout(c,o,bw,bh);
      return {w:bw*(1+rough*1.6)+(['left','right'].includes(o.tail)?tail*2:0),h:bh*(1+rough*1.6)+(['top','bottom'].includes(o.tail)?tail*2:0),bw,bh,tail,...layout};
    }
    const fontSize=short*o.size*.38;
    c.font=fontSpec(o,fontSize);
    const lines=(o.text||' ').split('\n');
    return {w:Math.max(fontSize,...lines.map(line=>c.measureText(line).width)),h:fontSize*1.35*lines.length,fontSize,lines};
  }
  function bubblePath(c,o,m) {
    const n=64,rx=m.bw/2,ry=m.bh/2;
    const tipIndex={right:0,bottom:16,left:32,top:48}[o.tail];
    c.beginPath();
    // Start away from the tail so the closed outline also works for right tails.
    for(let j=4;j<=68;j++) {
      const i=j%n,angle=i*Math.PI*2/n;
      let x,y;
      if(o.shape==='organic') {
        const seed=Array.from(o.id||'bubble').reduce((sum,char)=>sum+char.charCodeAt(0),0)*.37;
        const power=.63,rough=o.roughness??.04;
        const jitter=1+rough*(Math.sin(angle*3+seed)*.65+Math.cos(angle*5-seed)*.35);
        x=rx*Math.sign(Math.cos(angle))*Math.pow(Math.abs(Math.cos(angle)),power)*jitter;
        y=ry*Math.sign(Math.sin(angle))*Math.pow(Math.abs(Math.sin(angle)),power)*(1+rough*Math.sin(angle*3-seed)*.8);
      } else if(o.shape==='round') {const power=2/5;x=rx*Math.sign(Math.cos(angle))*Math.pow(Math.abs(Math.cos(angle)),power);y=ry*Math.sign(Math.sin(angle))*Math.pow(Math.abs(Math.sin(angle)),power);}
      else {const radius=o.shape==='burst' && i%2 ? .83:1;x=rx*Math.cos(angle)*radius;y=ry*Math.sin(angle)*radius;}
      if(tipIndex!==undefined && i===tipIndex) {x=(rx+m.tail)*Math.cos(angle);y=(ry+m.tail)*Math.sin(angle);}
      if(j===4)c.moveTo(x,y);else c.lineTo(x,y);
    }
    c.closePath();
  }
  function stampPath(c,o,m) {
    const r=m.w/2;c.beginPath();
    if(o.symbol==='heart') {
      c.moveTo(0,r*.85);c.bezierCurveTo(-r*1.8,-r*.2,-r*.65,-r*1.45,0,-r*.55);c.bezierCurveTo(r*.65,-r*1.45,r*1.8,-r*.2,0,r*.85);
    } else if(o.symbol==='music') {
      c.ellipse(-r*.35,r*.55,r*.32,r*.22,-.3,0,Math.PI*2);c.rect(-r*.11,-r*.8,r*.15,r*1.36);c.moveTo(r*.02,-r*.8);c.bezierCurveTo(r*.7,-r*.65,r*.85,-r*.15,r*.37,r*.08);c.bezierCurveTo(r*.65,-r*.3,r*.3,-r*.4,r*.02,-r*.45);
    } else if(o.symbol==='bang') {
      c.moveTo(-r*.18,-r*.85);c.lineTo(r*.18,-r*.85);c.lineTo(r*.11,r*.28);c.lineTo(-r*.11,r*.28);c.closePath();c.moveTo(r*.18,r*.65);c.arc(0,r*.65,r*.18,0,Math.PI*2);
    } else {
      for(let i=0;i<10;i++){const a=-Math.PI/2+i*Math.PI/5,rr=i%2?r*.43:r;if(i===0)c.moveTo(Math.cos(a)*rr,Math.sin(a)*rr);else c.lineTo(Math.cos(a)*rr,Math.sin(a)*rr);}c.closePath();
    }
  }
  function renderObject(c,o,editor) {
    const [w,h]=dimension();c.save();const m=objectMetrics(c,o);
    c.translate(w*o.x,h*o.y);c.rotate(o.angle*Math.PI/180);
    c.fillStyle=o.color;c.strokeStyle=o.outlineColor||'#ffffff';c.lineJoin='round';c.lineCap='round';
    if(o.type==='arrow') {
      const shaft=m.h*.24,head=m.w*.26;
      c.beginPath();c.moveTo(-m.w/2,-shaft/2);c.lineTo(m.w/2-head,-shaft/2);c.lineTo(m.w/2-head,-m.h/2);c.lineTo(m.w/2,0);c.lineTo(m.w/2-head,m.h/2);c.lineTo(m.w/2-head,shaft/2);c.lineTo(-m.w/2,shaft/2);c.closePath();c.lineWidth=Math.max(3,m.h*.065);c.stroke();c.fill();
    } else if(o.type==='stamp') {
      stampPath(c,o,m);c.lineWidth=Math.max(2,m.w*(o.outline??.06));if(o.outline!==0)c.stroke();c.fill();
    } else if(o.type==='bubble') {
      bubblePath(c,o,m);c.fillStyle=o.fill||'#e2e2e2';c.strokeStyle=o.borderColor||'#111111';c.lineWidth=(o.borderWidth??2)*Math.min(w,h)/1200;
      c.save();c.globalAlpha=o.fillOpacity??.6;c.fill();c.restore();c.stroke();
      drawBubbleText(c,o,m);
    } else {
      c.font=fontSpec(o,m.fontSize);c.textAlign='center';c.textBaseline='middle';c.lineWidth=Math.max(1,m.fontSize*(o.outline??.09));
      m.lines.forEach((line,i)=>{const y=(i-(m.lines.length-1)/2)*m.fontSize*1.35;if(o.outline!==0)c.strokeText(line,0,y);c.fillText(line,0,y);});
    }
    if(editor&&activeTab==='decor'&&o.id===selectedObject) {c.strokeStyle='#7254df';c.lineWidth=Math.min(w,h)*.0025;c.setLineDash([10,6]);c.strokeRect(-m.w/2-9,-m.h/2-9,m.w+18,m.h+18);}
    c.restore();
  }

  function bubbleTextLayout(c,o,bw,bh) {
    const short=Math.min(...dimension()), padding=clamp(o.padding??.03,0,.25);
    let fontSize=short*(o.textScale||.04),lines=[],columns=[];
    const vertical=o.writing==='vertical', maxW=bw*(1-2*padding),maxH=bh*(1-2*padding);
    const paragraphs=(o.text||'').normalize('NFC').split('\n'),preserveBreaks=paragraphs.length>1;
    // Test against the actual curved outline at identity coordinates. This keeps
    // lettering inside the shape while using the available area near its edges.
    c.save();c.resetTransform();bubblePath(c,{...o,tail:'none'},{bw,bh,tail:0});
    const insideBox=(x,y,width,height)=>{
      const inset=(o.borderWidth??2)*short/2400;
      for(const dx of [-width/2,0,width/2])for(const dy of [-height/2,0,height/2]) {
        const px=x+dx,py=y+dy;
        if(!c.isPointInPath(px+Math.sign(px)*inset,py+Math.sign(py)*inset))return false;
      }
      return true;
    };
    for(let attempt=0;attempt<160;attempt++) {
      c.font=fontSpec(o,fontSize);
      let fits=false;
      if(vertical) {
        columns=[];const perColumn=Math.max(1,Math.floor(maxH/(fontSize*1.12)));
        for(const paragraph of paragraphs) {
          const chars=Array.from(paragraph);
          if(!chars.length)columns.push([]);
          else if(preserveBreaks)columns.push(chars);
          else for(let i=0;i<chars.length;i+=perColumn)columns.push(chars.slice(i,i+perColumn));
        }
        const rows=Math.max(0,...columns.map(col=>col.length));
        fits=columns.length*fontSize*1.35<=maxW && rows*fontSize*1.12<=maxH;
        if(fits)fits=columns.every((col,i)=>col.every((char,j)=>{
          let x=((columns.length-1)/2-i)*fontSize*1.35,y=(j-(rows-1)/2)*fontSize*1.12;
          if('、。，．'.includes(char)){x+=fontSize*.27;y-=fontSize*.27;}
          if('ぁぃぅぇぉゃゅょっァィゥェォャュョッヵヶ'.includes(char)){x+=fontSize*.1;y-=fontSize*.1;}
          return insideBox(x,y,fontSize*1.15,fontSize*1.15);
        }));
      } else {
        lines=preserveBreaks?paragraphs:wrapBubble(c,paragraphs[0],maxW);
        fits=lines.length*fontSize*1.35<=maxH && lines.every(line=>c.measureText(line).width<=maxW);
        if(fits)fits=lines.every((line,i)=>insideBox(0,(i-(lines.length-1)/2)*fontSize*1.35,c.measureText(line).width+fontSize*.15,fontSize*1.15));
      }
      if(fits)break;
      fontSize*=.96;
    }
    c.restore();
    return {fontSize,lines,columns,vertical};
  }
  function drawBubbleText(c,o,m) {
    c.save();c.globalAlpha=1;c.font=fontSpec(o,m.fontSize);c.fillStyle=o.color||'#111111';
    c.strokeStyle='#ffffff';c.lineWidth=Math.max(1,m.fontSize*.15);c.lineJoin='round';c.textAlign='center';c.textBaseline='middle';
    const glyph=(text,x,y,turn=0)=>{c.save();c.translate(x,y);if(turn)c.rotate(turn);if(o.textHalo!==false)c.strokeText(text,0,0);c.fillText(text,0,0);c.restore();};
    if(m.vertical) {
      const step=m.fontSize*1.12,cols=m.columns,rows=Math.max(0,...cols.map(col=>col.length));
      cols.forEach((col,i)=>{
        const x=((cols.length-1)/2-i)*m.fontSize*1.35;
        col.forEach((char,j)=>{
          let gx=x,gy=(j-(rows-1)/2)*step,turn=0;
          if('、。，．'.includes(char)){gx+=m.fontSize*.27;gy-=m.fontSize*.27;}
          if('ー―—…‥()（）「」『』【】［］｛｝〈〉《》'.includes(char))turn=Math.PI/2;
          if('ぁぃぅぇぉゃゅょっァィゥェォャュョッヵヶ'.includes(char)){gx+=m.fontSize*.1;gy-=m.fontSize*.1;}
          glyph(char,gx,gy,turn);
        });
      });
    } else m.lines.forEach((line,i)=>glyph(line,0,(i-(m.lines.length-1)/2)*m.fontSize*1.35));
    c.restore();
  }
  function bubbleStyle(o,key,value) {
    if(!o)return;
    const members=o.group?state.objects.filter(item=>item.type==='bubble'&&item.group===o.group):[o];
    members.forEach(item=>{item[key]=value;});
  }
  function bubbleMembers(o) {return o&&o.group?state.objects.filter(item=>item.type==='bubble'&&item.group===o.group):o?[o]:[];}
  function bubbleBounds(c,items) {
    const [w,h]=dimension();let left=Infinity,top=Infinity,right=-Infinity,bottom=-Infinity;
    items.forEach(o=>{const m=objectMetrics(c,o),a=o.angle*Math.PI/180;
      const rx=(Math.abs(Math.cos(a))*m.w+Math.abs(Math.sin(a))*m.h)/2,ry=(Math.abs(Math.sin(a))*m.w+Math.abs(Math.cos(a))*m.h)/2;
      left=Math.min(left,o.x*w-rx);right=Math.max(right,o.x*w+rx);top=Math.min(top,o.y*h-ry);bottom=Math.max(bottom,o.y*h+ry);
    });return {left,top,right,bottom};
  }
  function linkBubbles(targetId) {
    const first=object(),second=state.objects.find(item=>item.id===targetId);
    if(!first||!second||first===second||first.type!=='bubble'||second.type!=='bubble'||first.group||second.group)return;
    action(()=>{
      const [w,h]=dimension();
      first.group=second.group='g'+nextId++;
      ['fill','fillOpacity','borderColor','borderWidth','moveTogether'].forEach(key=>{second[key]=first[key];});
      second.angle=first.angle;
      const m1=objectMetrics(ctx,first),m2=objectMetrics(ctx,second),a=first.angle*Math.PI/180;
      const distance=(m1.bh+m2.bh)/2-Math.min(m1.bh,m2.bh)*.12;
      second.x=first.x-Math.sin(a)*distance/w;second.y=first.y+Math.cos(a)*distance/h;
      const members=[first,second],b=bubbleBounds(ctx,members),scale=Math.min(1,(w-40)/(b.right-b.left),(h-40)/(b.bottom-b.top));
      if(scale<1) {second.x=first.x+(second.x-first.x)*scale;second.y=first.y+(second.y-first.y)*scale;members.forEach(o=>o.size*=scale);}
      const fit=bubbleBounds(ctx,members);
      const dx=fit.left<20?20-fit.left:fit.right>w-20?w-20-fit.right:0;
      const dy=fit.top<20?20-fit.top:fit.bottom>h-20?h-20-fit.bottom:0;
      members.forEach(o=>{o.x+=dx/w;o.y+=dy/h;});
    });
    toast('相手を下に配置して連結しました。文章はそれぞれ編集できます。');
  }
  function unlinkBubble(o) {if(o&&o.group){const group=o.group;state.objects.forEach(item=>{if(item.group===group)delete item.group;});}}
  function moveDecoration(o,x,y,origins=null) {
    if(!o)return;
    const members=o.type==='bubble'&&o.group&&o.moveTogether!==false?bubbleMembers(o):[o];
    const baselines=origins||members.map(item=>({id:item.id,x:item.x,y:item.y}));
    const base=baselines.find(item=>item.id===o.id)||o;
    let dx=x-base.x,dy=y-base.y;
    dx=clamp(dx,-Math.min(...baselines.map(item=>item.x)),1-Math.max(...baselines.map(item=>item.x)));
    dy=clamp(dy,-Math.min(...baselines.map(item=>item.y)),1-Math.max(...baselines.map(item=>item.y)));
    members.forEach(item=>{const start=baselines.find(v=>v.id===item.id)||item;item.x=start.x+dx;item.y=start.y+dy;});
  }
  let unionMask=null,unionLayer=null;
  function renderBubbleGroup(c,items,editor) {
    const [w,h]=dimension(),style=items[0],b=bubbleBounds(c,items),stroke=(style.borderWidth??2)*Math.min(w,h)/1200;
    const pad=stroke+3,left=Math.max(-pad,Math.floor(b.left-pad)),top=Math.max(-pad,Math.floor(b.top-pad));
    const right=Math.min(w+pad,Math.ceil(b.right+pad)),bottom=Math.min(h+pad,Math.ceil(b.bottom+pad));
    if(right<=left||bottom<=top)return;
    const transform=c.getTransform(),scale=Math.max(.1,Math.min(1,Math.hypot(transform.a,transform.b)));
    const pw=Math.ceil((right-left)*scale),ph=Math.ceil((bottom-top)*scale);
    if(!unionMask){unionMask=document.createElement('canvas');unionLayer=document.createElement('canvas');}
    unionMask.width=unionLayer.width=pw;unionMask.height=unionLayer.height=ph;
    const mask=unionMask.getContext('2d'),layer=unionLayer.getContext('2d');
    mask.setTransform(scale,0,0,scale,-left*scale,-top*scale);mask.fillStyle='#ffffff';
    const metrics=items.map(o=>objectMetrics(c,o));
    // A round neck connects separated bodies. The same mask owns all overlaps.
    for(let i=1;i<items.length;i++) {
      mask.lineCap='round';mask.strokeStyle='#ffffff';mask.lineWidth=Math.min(metrics[i-1].bw,metrics[i-1].bh,metrics[i].bw,metrics[i].bh)*.18;
      mask.beginPath();mask.moveTo(items[i-1].x*w,items[i-1].y*h);mask.lineTo(items[i].x*w,items[i].y*h);mask.stroke();
    }
    items.forEach((o,i)=>{mask.save();mask.translate(o.x*w,o.y*h);mask.rotate(o.angle*Math.PI/180);bubblePath(mask,o,metrics[i]);mask.fill();mask.restore();});
    layer.drawImage(unionMask,0,0);layer.globalCompositeOperation='source-in';layer.fillStyle=style.fill||'#e2e2e2';layer.fillRect(0,0,pw,ph);
    c.save();c.globalAlpha=style.fillOpacity??.6;c.drawImage(unionLayer,left,top,pw/scale,ph/scale);c.restore();
    // Morphological outer ring: union(dilated mask) minus union mask. No internal seam.
    layer.globalCompositeOperation='source-over';layer.clearRect(0,0,pw,ph);
    const radius=Math.max(.5,stroke*scale);
    for(let i=0;i<16;i++){const angle=i*Math.PI/8;layer.drawImage(unionMask,Math.cos(angle)*radius,Math.sin(angle)*radius);}
    layer.globalCompositeOperation='destination-out';layer.drawImage(unionMask,0,0);
    layer.globalCompositeOperation='source-in';layer.fillStyle=style.borderColor||'#111111';layer.fillRect(0,0,pw,ph);
    c.drawImage(unionLayer,left,top,pw/scale,ph/scale);
    items.forEach((o,i)=>{
      c.save();c.translate(o.x*w,o.y*h);c.rotate(o.angle*Math.PI/180);drawBubbleText(c,o,metrics[i]);
      if(editor&&activeTab==='decor'&&o.id===selectedObject){c.strokeStyle='#7254df';c.lineWidth=Math.min(w,h)*.0025;c.setLineDash([10,6]);const m=metrics[i];c.strokeRect(-m.w/2-9,-m.h/2-9,m.w+18,m.h+18);}
      c.restore();
    });
  }

  function renderBackground(c, w, h) {
    c.save(); c.fillStyle = state.background; c.fillRect(0,0,w,h);
    if (state.backgroundStyle === 'gradient') {
      const d = state.gradientDirection;
      const gradient = c.createLinearGradient(0,0,d === 'vertical' ? 0:w,d === 'horizontal' ? 0:h);
      gradient.addColorStop(0,state.background); gradient.addColorStop(1,state.backgroundSecond);
      c.fillStyle = gradient; c.fillRect(0,0,w,h);
    } else if (state.backgroundStyle === 'dots' || state.backgroundStyle === 'stripes') {
      const spacing = state.patternSize * Math.min(w,h) / 1200;
      c.fillStyle = state.backgroundSecond; c.strokeStyle = state.backgroundSecond;
      if (state.backgroundStyle === 'dots') {
        for (let row=0,y=spacing/2;y<h+spacing;y+=spacing,row++) for(let x=spacing/2+(row%2)*spacing/2;x<w+spacing;x+=spacing) {
          c.beginPath(); c.arc(x,y,spacing*.15,0,Math.PI*2); c.fill();
        }
      } else {
        c.lineWidth = spacing*.35;
        for(let x=-h;x<w+h;x+=spacing) {c.beginPath();c.moveTo(x,0);c.lineTo(x+h,h);c.stroke();}
      }
    }
    c.restore();
  }
  function render(c, width, height, editor = false) {
    const [w, h] = dimension(); c.save(); c.setTransform(width / w, 0, 0, height / h, 0, 0); c.clearRect(0, 0, w, h);
    renderBackground(c, w, h);
    c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high';
    rects().forEach((r, i) => {
      c.save(); c.beginPath(); c.rect(r.x, r.y, r.w, r.h); c.clip();
      const p = state.panels[i], g = geometry(p, r);
      if (g) c.drawImage(g.img, g.x, g.y, g.w, g.h); else if (editor) placeholder(c, r, i);
      if (g) comicEffect(c, r, p);
      c.restore();
      if (editor && activeTab === 'crop' && activePhoto === i && g) {
        c.save(); c.strokeStyle = '#7254df'; c.lineWidth = Math.min(w, h) * .004; c.strokeRect(r.x + c.lineWidth / 2, r.y + c.lineWidth / 2, r.w - c.lineWidth, r.h - c.lineWidth); c.restore();
      }
    });
    const drawnGroups=new Set();
    state.objects.forEach(o=>{
      if(o.type==='bubble'&&o.group&&bubbleMembers(o).length>1){if(!drawnGroups.has(o.group)){drawnGroups.add(o.group);renderBubbleGroup(c,bubbleMembers(o),editor);}}
      else renderObject(c,o,editor);
    });renderStory(c);c.restore();
  }

  function renderStory(c) {
    if(state.photoCount!==3 || !['top-one','top-two','right-main','left-main'].includes(state.layout))return;
    const [w,h]=dimension(), unit=Math.min(w,h)/1200, rs=rects();
    c.save();
    if(state.showFlow) {
      for(let i=0;i<2;i++) {
        const from=rs[i],to=rs[i+1], side=['right-main','left-main'].includes(state.layout), sameRow=Math.abs(from.y-to.y)<1;
        let mx,my,dx,dy;
        if(sameRow) {dx=to.x>from.x?1:-1;dy=0;mx=dx>0?(from.x+from.w+to.x)/2:(to.x+to.w+from.x)/2;my=side?to.y+to.h/2:from.y+from.h/2;}
        else {dx=0;dy=1;mx=state.layout==='top-one'?to.x+to.w/2:from.x+from.w/2;my=(from.y+from.h+to.y)/2;}
        const half=(state.gap/2+25)*unit, head=13*unit;
        c.beginPath();c.moveTo(mx-dx*half,my-dy*half);c.lineTo(mx+dx*half,my+dy*half);
        c.moveTo(mx+dx*half-dx*head-dy*head*.7,my+dy*half-dy*head+dx*head*.7);c.lineTo(mx+dx*half,my+dy*half);c.lineTo(mx+dx*half-dx*head+dy*head*.7,my+dy*half-dy*head-dx*head*.7);
        c.lineCap='round';c.lineJoin='round';c.strokeStyle='#ffffff';c.lineWidth=13*unit;c.stroke();c.strokeStyle='#252635';c.lineWidth=6*unit;c.stroke();
      }
    }
    if(state.showNumbers) rs.forEach((r,i)=>{
      const radius=24*unit, margin=14*unit;
      const x=(state.layout==='right-main'||(!['right-main','left-main'].includes(state.layout)&&state.readingDirection==='rtl'))?r.x+r.w-margin-radius:r.x+margin+radius,y=r.y+margin+radius;
      c.beginPath();c.arc(x,y,radius,0,Math.PI*2);c.fillStyle='#ffffff';c.fill();c.lineWidth=2.5*unit;c.strokeStyle='#252635';c.stroke();
      c.fillStyle='#252635';c.font='800 '+(27*unit)+'px -apple-system, sans-serif';c.textAlign='center';c.textBaseline='middle';c.fillText(String(i+1),x,y+unit);
    });
    c.restore();
  }
  function drawPreview() {
    const [w, h] = dimension(), scale = Math.min(1, 1100 / Math.max(w, h));
    const pw = Math.round(w * scale), ph = Math.round(h * scale);
    if (canvas.width !== pw || canvas.height !== ph) { canvas.width = pw; canvas.height = ph; }
    render(ctx, pw, ph, true);
    updateFloatingPreview();
  }
  let floatingCollapsed=false, floatingRaf=0;
  function updateFloatingPreview() {
    const box=canvas.getBoundingClientRect(), viewport=window.visualViewport;
    const above=box.bottom <= (viewport?.offsetTop||0)+8;
    const panel=$('floatingPreview'), mini=$('miniPreview');
    panel.hidden=!above;
    if(!above)return;
    panel.style.top='calc('+((viewport?.offsetTop||0)+8)+'px + env(safe-area-inset-top))';
    mini.style.maxHeight=Math.max(60,Math.min(210,(viewport?.height||window.innerHeight||700)*.26))+'px';
    $('miniPreviewBody').hidden=floatingCollapsed;
    $('toggleMiniPreview').textContent=floatingCollapsed?'プレビューを開く':'折りたたむ';
    $('toggleMiniPreview').setAttribute('aria-expanded',String(!floatingCollapsed));
    $('miniSize').textContent=dimension().join(' × ');
    if(floatingCollapsed)return;
    const scale=Math.min(1,420/Math.max(canvas.width,canvas.height));
    const mw=Math.max(1,Math.round(canvas.width*scale)),mh=Math.max(1,Math.round(canvas.height*scale));
    if(mini.width!==mw||mini.height!==mh){mini.width=mw;mini.height=mh;}
    const mc=mini.getContext('2d');mc.clearRect(0,0,mw,mh);mc.drawImage(canvas,0,0,mw,mh);
  }
  function requestFloatingPreview() {
    if(!floatingRaf)floatingRaf=requestAnimationFrame(()=>{floatingRaf=0;updateFloatingPreview();});
  }
  $('toggleMiniPreview').addEventListener('click',()=>{floatingCollapsed=!floatingCollapsed;updateFloatingPreview();});
  $('returnToPreview').addEventListener('click',()=>canvas.scrollIntoView({block:'center',behavior:'auto'}));
  window.addEventListener('scroll',requestFloatingPreview,{passive:true});
  window.addEventListener('resize',requestFloatingPreview,{passive:true});
  if(window.visualViewport){window.visualViewport.addEventListener('resize',requestFloatingPreview,{passive:true});window.visualViewport.addEventListener('scroll',requestFloatingPreview,{passive:true});}
  if(typeof ResizeObserver!=='undefined')new ResizeObserver(requestFloatingPreview).observe(canvas);
  function bindControl(id, apply) {
    const el = $(id);
    el.addEventListener('input', () => { if (!editBefore) editBefore = copy(state); apply(el.value); update(); });
    el.addEventListener('change', finishEdit);
    el.addEventListener('blur', finishEdit);
  }
  document.querySelectorAll('[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => setTab(btn.dataset.tab));
    btn.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault(); const tabs = ['layout','crop','decor']; const i = tabs.indexOf(activeTab);
      const index = event.key === 'Home' ? 0 : event.key === 'End' ? 2 : (i + (event.key === 'ArrowRight' ? 1 : 2)) % 3;
      setTab(tabs[index]); $('tab-' + tabs[index]).focus();
    });
  });
  document.querySelectorAll('[data-layout]').forEach(btn => btn.addEventListener('click', () => action(() => { state.layout = btn.dataset.layout; })));
  document.querySelectorAll('[data-photo]').forEach(btn => btn.addEventListener('click', () => selectPhoto(Number(btn.dataset.photo))));
  document.querySelectorAll('[data-background]').forEach(btn => btn.addEventListener('click', () => action(() => { state.background = btn.dataset.background; })));
  $('swap').addEventListener('click', () => action(() => { const visible = state.panels.splice(0, state.photoCount); visible.unshift(visible.pop()); state.panels.unshift(...visible); activePhoto = (activePhoto + 1) % state.photoCount; }));
  $('aspect').addEventListener('change', () => action(() => { state.aspect = $('aspect').value; }));
  document.querySelectorAll('[data-count]').forEach(btn => btn.addEventListener('click', () => action(() => {
    const previous = state.photoCount;
    state.photoCount = Number(btn.dataset.count);
    if(state.photoCount===3 && previous!==3) state.layout='right-main';
    if(state.photoCount!==3 && ['top-one','top-two','right-main','left-main'].includes(state.layout)) state.layout='horizontal';
    if(state.photoCount !== 4 && state.layout === 'grid') state.layout = 'horizontal';
    activePhoto = Math.min(activePhoto, state.photoCount-1);
  })));
  $('backgroundStyle').addEventListener('change', () => action(() => { state.backgroundStyle = $('backgroundStyle').value; }));
  $('gradientDirection').addEventListener('change', () => action(() => { state.gradientDirection = $('gradientDirection').value; }));
  bindControl('backgroundSecond', value => { state.backgroundSecond = value; });
  bindControl('patternSize', value => { state.patternSize = Number(value); });
  bindControl('rowSplit', value=>{state.rowSplit=Number(value)/100;});
  $('readingDirection').addEventListener('change',()=>action(()=>{state.readingDirection=$('readingDirection').value;}));
  ['showNumbers','showFlow'].forEach(id=>$(id).addEventListener('change',()=>action(()=>{state[id]=$(id).checked;})));
  $('noMargins').addEventListener('click',()=>action(()=>{state.gap=0;state.border=0;}));
  $('reorderPhoto').addEventListener('change',()=>selectPhoto(Number($('reorderPhoto').value)));
  function movePhoto(step) {
    const next=activePhoto+step;
    if(next<0||next>=state.photoCount)return;
    action(()=>{[state.panels[activePhoto],state.panels[next]]=[state.panels[next],state.panels[activePhoto]];activePhoto=next;});
  }
  $('moveBefore').addEventListener('click',()=>movePhoto(-1));
  $('moveAfter').addEventListener('click',()=>movePhoto(1));
  bindControl('split', value => { state.split = Number(value) / 100; });
  bindControl('gap', value => { state.gap = Number(value); });
  bindControl('border', value => { state.border = Number(value); });
  bindControl('background', value => { state.background = value; });
  bindControl('zoom', value => { state.panels[activePhoto].zoom = Number(value) / 100; });
  bindControl('effectStrength', value => { state.panels[activePhoto].strength = Number(value) / 100; });
  $('effect').addEventListener('change', () => action(() => { state.panels[activePhoto].effect = $('effect').value; }));
  $('fitPhoto').addEventListener('click', () => action(() => {
    const p=state.panels[activePhoto],r=rects()[activePhoto],img=assets.get(p.asset); if(!img)return;
    Object.assign(p,{zoom:Math.min(r.w/img.width,r.h/img.height)/Math.max(r.w/img.width,r.h/img.height),x:.5,y:.5});
  }));
  $('resetCrop').addEventListener('click', () => action(() => Object.assign(state.panels[activePhoto], { zoom: 1, x: .5, y: .5 })));
  document.querySelectorAll('[data-nudge]').forEach(btn => btn.addEventListener('click', () => action(() => {
    const p = state.panels[activePhoto], dir = btn.dataset.nudge;
    if (dir === 'left' || dir === 'right') p.x = clamp(p.x + (dir === 'left' ? .05 : -.05), 0, 1);
    else p.y = clamp(p.y + (dir === 'up' ? .05 : -.05), 0, 1);
  })));
  function travelHistory(from, to) {
    finishEdit(); if (!from.length || loading) return;
    to.push(copy(state)); state = from.pop(); selectedObject = null; pruneAssets(); update();
  }
  $('undo').addEventListener('click', () => travelHistory(undoStack, redoStack));
  $('redo').addEventListener('click', () => travelHistory(redoStack, undoStack));
  document.addEventListener('keydown', event => {
    if (event.target.matches('input,select,textarea') || $('saveDialog').open) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); if (event.shiftKey) travelHistory(redoStack, undoStack); else travelHistory(undoStack, redoStack); }
  });
  function addObject(type) {
    if (state.objects.length >= 12) { toast('飾りは合計12個まで追加できます'); return; }
    action(() => {
      const o = { id: 'o' + nextId++, type, x: .5, y: .5, size: type === 'arrow' ? .25 : .16, angle: type === 'arrow' ? -35 : 0, color: type === 'arrow' ? '#ee5545' : '#252635', text: type === 'text' ? 'ここに文字' : '' };
      Object.assign(o,{font:'system',outlineColor:'#ffffff',outline:.09});
      if(type==='bubble')Object.assign(o,{size:.2,text:'ここにセリフ',font:'zen',shape:'organic',tail:'none',ratio:1.2,textScale:.04,fill:'#e2e2e2',fillOpacity:.6,borderColor:'#111111',borderWidth:2,roughness:.04,writing:'vertical',padding:.03,textHalo:true,color:'#111111',moveTogether:true});
      if(type==='sound')Object.assign(o,{size:.23,text:'ドン！',font:'zen',color:'#ed493e',angle:-12,outline:.16});
      if(type==='stamp')Object.assign(o,{size:.2,symbol:'star',color:'#f5bf34',outline:.06});
      state.objects.push(o); selectedObject = o.id;
    });
    if (['text','bubble','sound'].includes(type)) { $('textContent').focus(); $('textContent').select(); }
    const o=object(); if(o&&FONT_DEFS[o.font])ensureFont(o.font).then(update).catch(()=>update());
  }
  $('addArrow').addEventListener('click', () => addObject('arrow'));
  $('addText').addEventListener('click', () => addObject('text'));
  $('addBubble').addEventListener('click',()=>addObject('bubble'));
  $('addSound').addEventListener('click',()=>addObject('sound'));
  $('addStamp').addEventListener('click',()=>addObject('stamp'));
  bindControl('mainWidth',v=>{state.mainWidth=Number(v)/100;});
  $('flipSide').addEventListener('click',()=>action(()=>{state.layout=state.layout==='right-main'?'left-main':'right-main';}));
  const objectSelects={objectFont:'font',stampSymbol:'symbol',bubbleShape:'shape',bubbleTail:'tail',bubbleWriting:'writing'};
  for(const [id,key] of Object.entries(objectSelects))$(id).addEventListener('change',()=>{
    const value=$(id).value;action(()=>{if(object())object()[key]=value;});
    if(key==='font')ensureFont(value).then(update).catch(()=>{toast('フォントを読み込めませんでした。接続中に再度お試しください。');update();});
  });
  bindControl('bubbleFill',v=>bubbleStyle(object(),'fill',v));
  bindControl('bubbleBorder',v=>bubbleStyle(object(),'borderColor',v));
  bindControl('bubbleOpacity',v=>bubbleStyle(object(),'fillOpacity',Number(v)/100));
  bindControl('bubbleLineWidth',v=>bubbleStyle(object(),'borderWidth',Number(v)));
  bindControl('bubbleRoughness',v=>{if(object())object().roughness=Number(v)/100;});
  $('bubbleHalo').addEventListener('change',()=>{const checked=$('bubbleHalo').checked;action(()=>{if(object())object().textHalo=checked;});});
  $('moveLinked').addEventListener('change',()=>{const checked=$('moveLinked').checked;action(()=>bubbleStyle(object(),'moveTogether',checked));});
  $('joinBubbles').addEventListener('click',()=>linkBubbles($('bubblePartner').value));
  $('unlinkBubbles').addEventListener('click',()=>action(()=>unlinkBubble(object())));
  bindControl('outlineColor',v=>{if(object())object().outlineColor=v;});
  bindControl('outlineWidth',v=>{if(object())object().outline=Number(v)/100;});
  bindControl('bubbleRatio',v=>{if(object())object().ratio=Number(v)/100;});
  bindControl('bubblePadding',v=>{if(object())object().padding=clamp(Number(v)/100,0,.25);});
  bindControl('bubbleTextSize',v=>{if(object())object().textScale=Number(v)/1000;});
  $('overlaySelect').addEventListener('change', () => { finishEdit(); selectedObject = $('overlaySelect').value; update(); });
  bindControl('textContent', value => { if (object()) object().text = value.slice(0, 80); });
  bindControl('objectSize', value => { if (object()) object().size = Number(value) / 100; });
  bindControl('objectAngle', value => { if (object()) object().angle = Number(value); });
  bindControl('objectX', value => { if(object())moveDecoration(object(),Number(value)/100,object().y); });
  bindControl('objectY', value => { if(object())moveDecoration(object(),object().x,Number(value)/100); });
  bindControl('objectColor', value => { if (object()) object().color = value; });
  $('deleteObject').addEventListener('click', () => action(() => { unlinkBubble(object()); state.objects = state.objects.filter(o => o.id !== selectedObject); selectedObject = null; }));

  async function loadPhoto(file, index) {
    if (!file) return;
    if (file.size > 50 * 1024 * 1024) { toast('画像は50MB以下のファイルを選んでください'); return; }
    if (file.type && !file.type.startsWith('image/')) { toast('画像ファイルを選んでください'); return; }
    const sequence = ++loadSequence[index], url = URL.createObjectURL(file);
    loading++; update();
    try {
      const img = new Image();
      await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; img.src = url; });
      if (sequence !== loadSequence[index]) return;
      if (!img.naturalWidth || !img.naturalHeight) throw new Error('Empty image');
      const ratio = Math.min(1, 2560 / Math.max(img.naturalWidth, img.naturalHeight));
      const normalized = document.createElement('canvas'); normalized.width = Math.max(1, Math.round(img.naturalWidth * ratio)); normalized.height = Math.max(1, Math.round(img.naturalHeight * ratio));
      const nc = normalized.getContext('2d'); if (!nc) throw new Error('Canvas unavailable');
      nc.drawImage(img, 0, 0, normalized.width, normalized.height);
      const id = 'image' + nextId++;
      action(() => { assets.set(id, normalized); state.panels[index] = { ...freshPanel(), asset: id }; activePhoto = index; });
      toast(`画像${index + 1}を読み込みました`);
    } catch (error) { toast('この画像を読み込めませんでした。JPEG・PNG、またはスクリーンショットをお試しください。'); }
    finally { URL.revokeObjectURL(url); loading--; update(); }
  }
  [0, 1, 2, 3].forEach(index => {
    $('upload' + index).addEventListener('click', () => { finishEdit(); $('file' + index).click(); });
    $('file' + index).addEventListener('change', event => { const file = event.target.files[0]; event.target.value = ''; loadPhoto(file, index); });
  });

  function point(event) {
    const bounds = canvas.getBoundingClientRect(), [w, h] = dimension();
    return { x: (event.clientX - bounds.left) / bounds.width * w, y: (event.clientY - bounds.top) / bounds.height * h };
  }
  function hitObject(pt) {
    const [w, h] = dimension();
    return [...state.objects].reverse().find(o => {
      const a = -o.angle * Math.PI / 180, dx = pt.x - w * o.x, dy = pt.y - h * o.y;
      const x = dx * Math.cos(a) - dy * Math.sin(a), y = dx * Math.sin(a) + dy * Math.cos(a);
      const m = objectMetrics(ctx, o), pad = Math.min(w, h) * .025;
      return Math.abs(x) <= m.w / 2 + pad && Math.abs(y) <= m.h / 2 + pad;
    });
  }
  function startGestureBaseline() {
    if (!gesture) return;
    const pts = [...pointers.values()], p = state.panels[gesture.index];
    gesture.start = pts[0]; gesture.panel = copy(p);
    if (gesture.type === 'object') {gesture.origin=copy(object());gesture.groupOrigins=(object().group&&object().moveTogether!==false?bubbleMembers(object()):[object()]).map(item=>({id:item.id,x:item.x,y:item.y,size:item.size,textScale:item.textScale}));}
    if (pts.length >= 2) {
      gesture.distance = Math.max(1, Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y));
      gesture.mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
      if (gesture.type !== 'photo') return;
      const r = rects()[gesture.index], g = geometry(p, r);
      gesture.focal = { x: (gesture.mid.x - g.x) / g.w, y: (gesture.mid.y - g.y) / g.h };
    }
  }
  canvas.addEventListener('pointerdown', event => {
    if (loading || (event.pointerType === 'mouse' && event.button !== 0)) return;
    event.preventDefault(); const pt = point(event);
    if (pointers.size >= 2) return;
    pointers.set(event.pointerId, pt); canvas.setPointerCapture(event.pointerId);
    if (pointers.size === 1) {
      finishEdit(); gestureBefore = copy(state);
      const hit = activeTab === 'decor' && hitObject(pt);
      if (hit) { selectedObject = hit.id; gesture = { type: 'object', index: activePhoto }; }
      else {
        const index = rects().findIndex(r => pt.x >= r.x && pt.x <= r.x + r.w && pt.y >= r.y && pt.y <= r.y + r.h);
        if (index === -1) { gesture = null; return; }
        activePhoto = index;
        if (activeTab === 'decor') { gesture = null; update(); return; }
        if (!state.panels[index].asset) { gesture = null; update(); return; }
        setTab('crop'); gesture = { type: 'photo', index };
      }
    }
    startGestureBaseline(); update();
  });
  canvas.addEventListener('pointermove', event => {
    if (!pointers.has(event.pointerId)) return;
    event.preventDefault(); pointers.set(event.pointerId, point(event)); if (!gesture) return;
    const pts = [...pointers.values()], [w, h] = dimension();
    if (gesture.type === 'object') {
      const o = object(); if (!o) return;
      if(pts.length===2) {
        const distance=Math.hypot(pts[1].x-pts[0].x,pts[1].y-pts[0].y);
        const origins=gesture.groupOrigins;
        const low=Math.max(...origins.map(b=>Math.max(.05/b.size,b.textScale?.015/b.textScale:0)));
        const high=Math.min(...origins.map(b=>Math.min(.6/b.size,b.textScale?.08/b.textScale:Infinity)));
        const factor=clamp(distance/gesture.distance,low,high);
        const mid={x:(pts[0].x+pts[1].x)/2,y:(pts[0].y+pts[1].y)/2};
        const positions=origins.map(b=>({x:(mid.x+(b.x*w-gesture.mid.x)*factor)/w,y:(mid.y+(b.y*h-gesture.mid.y)*factor)/h}));
        const dx=Math.max(0,-Math.min(...positions.map(p=>p.x)))+Math.min(0,1-Math.max(...positions.map(p=>p.x)));
        const dy=Math.max(0,-Math.min(...positions.map(p=>p.y)))+Math.min(0,1-Math.max(...positions.map(p=>p.y)));
        origins.forEach((b,i)=>{const item=state.objects.find(v=>v.id===b.id);if(!item)return;item.size=b.size*factor;item.x=positions[i].x+dx;item.y=positions[i].y+dy;if(b.textScale)item.textScale=b.textScale*factor;});
      } else moveDecoration(o,gesture.origin.x+(pts[0].x-gesture.start.x)/w,gesture.origin.y+(pts[0].y-gesture.start.y)/h,gesture.groupOrigins);
    } else {
      const p = state.panels[gesture.index], r = rects()[gesture.index];
      if (pts.length === 2) {
        const distance = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
        p.zoom = clamp(gesture.panel.zoom * distance / gesture.distance, minimumZoom(p,r), 4);
        const g = geometry(p, r), mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
        p.x = Math.abs(g.overflowX) > .001 ? clamp((r.x + gesture.focal.x * g.w - mid.x) / g.overflowX, 0, 1) : .5;
        p.y = Math.abs(g.overflowY) > .001 ? clamp((r.y + gesture.focal.y * g.h - mid.y) / g.overflowY, 0, 1) : .5;
      } else {
        const g = geometry(p, r);
        p.x = Math.abs(g.overflowX) > .001 ? clamp(gesture.panel.x - (pts[0].x - gesture.start.x) / g.overflowX, 0, 1) : .5;
        p.y = Math.abs(g.overflowY) > .001 ? clamp(gesture.panel.y - (pts[0].y - gesture.start.y) / g.overflowY, 0, 1) : .5;
      }
    }
    update();
  });
  function endPointer(event) {
    if (!pointers.has(event.pointerId)) return;
    pointers.delete(event.pointerId);
    if (pointers.size) { startGestureBaseline(); return; }
    remember(gestureBefore); gestureBefore = null; gesture = null; update();
  }
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
  canvas.addEventListener('lostpointercapture', endPointer);

  $('export').addEventListener('click', async () => {
    finishEdit(); if (state.panels.slice(0, state.photoCount).some(p => !p.asset) || loading || exporting) return;
    exporting = true; sync();
    try {
      await Promise.all(state.objects.filter(o=>['text','sound','bubble'].includes(o.type)).map(o=>ensureFont(o.font)));
      const out = document.createElement('canvas'); [out.width, out.height] = dimension();
      render(out.getContext('2d'), out.width, out.height, false);
      const blob = await new Promise((resolve, reject) => out.toBlob(value => value ? resolve(value) : reject(new Error('Export failed')), 'image/png'));
      if (savedUrl) URL.revokeObjectURL(savedUrl);
      savedBlob = blob; savedUrl = URL.createObjectURL(blob);
      const d = new Date(), pad = value => String(value).padStart(2, '0');
      const filename = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_pair-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.png`;
      savedFile = new File([blob], filename, { type: 'image/png' });
      $('savedImage').src = savedUrl; $('download').href = savedUrl; $('download').download = filename;
      const shareable = !!(navigator.share && navigator.canShare && navigator.canShare({ files: [savedFile] }));
      $('share').hidden = !shareable;
      $('shareNote').textContent = shareable ? '写真への保存は、共有メニュー内で完了してください。' : '画像を長押しして保存するか、PNGをダウンロードしてください。';
      $('saveDialog').showModal();
    } catch (error) { toast('画像を作成できませんでした。フォントの読み込み状態や空きメモリを確認して、もう一度お試しください。'); }
    finally { exporting = false; sync(); }
  });
  $('share').addEventListener('click', async () => {
    if (!savedFile) return;
    try { await navigator.share({ files: [savedFile] }); }
    catch (error) { if (error.name !== 'AbortError') { $('shareNote').textContent = '共有できませんでした。画像を長押しするか、PNGをダウンロードしてください。'; } }
  });
  $('closeSave').addEventListener('click', () => $('saveDialog').close());
  $('saveDialog').addEventListener('click', event => { if (event.target === $('saveDialog')) { const r = $('saveDialog').getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) $('saveDialog').close(); } });
  window.addEventListener('beforeunload', event => { if (state.panels.some(p => p.asset)) { event.preventDefault(); event.returnValue = ''; } });
  async function setupOffline() {
    if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
    try {
      await navigator.serviceWorker.register('./service-worker.js', { updateViaCache: 'none' });
      await navigator.serviceWorker.ready;
    } catch (error) { console.warn('Offline setup unavailable'); }
  }
  window.addEventListener('resize', requestDraw);
  update(); setupOffline();
  Promise.allSettled(Object.keys(FONT_DEFS).map(ensureFont)).then(update);
})();
