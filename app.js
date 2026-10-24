'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const canvas = $('preview');
  const ctx = canvas.getContext('2d');
  const sizes = { landscape: [1800, 1200], square: [1600, 1600], portrait: [1200, 1800], wide: [1920, 1080] };
  const freshPanel = () => ({ asset: null, zoom: 1, x: .5, y: .5, effect: 'none', strength: .6 });
  let state = { photoCount: 2, rowSplit: .45, readingDirection: 'ltr', showNumbers: true, showFlow: true, backgroundStyle: 'solid', backgroundSecond: '#b5a1ee', gradientDirection: 'diagonal', patternSize: 36, layout: 'horizontal', aspect: 'landscape', split: .5, gap: 8, border: 12, background: '#ffffff', panels: Array.from({ length: 4 }, freshPanel), objects: [] };
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
  const dimension = () => sizes[state.aspect];

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
    $('canvasHint').textContent = count === 0 ? `画像を${state.photoCount}枚選んでください` : activeTab === 'decor' ? '矢印・文字は指で動かせます' : '画像を指で移動・2本指で拡大';
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
    $('gridLayout').hidden = state.photoCount !== 4;
    $('threeLayouts').hidden = state.photoCount !== 3;
    const story = state.photoCount === 3 && ['top-one','top-two'].includes(state.layout);
    $('storyControls').hidden = !story;
    $('rowSplit').value = Math.round(state.rowSplit * 100);
    $('rowSplitValue').textContent = Math.round(state.rowSplit*100) + ' : ' + (100-Math.round(state.rowSplit*100));
    $('readingDirection').value = state.readingDirection;
    $('showNumbers').checked = state.showNumbers; $('showFlow').checked = state.showFlow;
    $('reorderPhoto').value = activePhoto;
    $('moveBefore').disabled = activePhoto === 0; $('moveAfter').disabled = activePhoto >= 2;
    const right = state.readingDirection === 'rtl';
    $('readingHint').textContent = state.layout === 'top-one' ? (right ? '①上 → ②右下 → ③左下' : '①上 → ②左下 → ③右下') : (right ? '①右上 → ②左上 → ③下' : '①左上 → ②右上 → ③下');
    $('splitControls').hidden = state.photoCount !== 2;
    $('equalHint').hidden = state.photoCount === 2 || story;
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
    $('resetCrop').disabled = !p.asset;
    document.querySelectorAll('[data-nudge]').forEach(btn => btn.disabled = !p.asset);
    $('overlayCount').textContent = `${state.objects.length} / 12`;
    $('addArrow').disabled = $('addText').disabled = state.objects.length >= 12;
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
      opt.textContent = `${i + 1}. ${item.type === 'arrow' ? '矢印' : item.text || '文字'}`;
      return opt;
    }));
    select.value = o.id;
    $('textField').hidden = o.type !== 'text';
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
    if (state.photoCount === 3 && ['top-one','top-two'].includes(state.layout)) {
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
  function geometry(p, r) {
    const img = assets.get(p.asset);
    if (!img) return null;
    const scale = Math.max(r.w / img.width, r.h / img.height) * p.zoom;
    const w = img.width * scale, h = img.height * scale;
    return { img, w, h, overflowX: Math.max(0, w - r.w), overflowY: Math.max(0, h - r.h), x: r.x - Math.max(0, w - r.w) * p.x, y: r.y - Math.max(0, h - r.h) * p.y };
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
  function objectMetrics(c, o) {
    const [w, h] = dimension(), short = Math.min(w, h);
    if (o.type === 'arrow') return { w: short * o.size * 2, h: short * o.size * .65 };
    const fontSize = short * o.size * .38;
    c.font = `800 ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
    return { w: Math.max(fontSize, c.measureText(o.text || ' ').width), h: fontSize * 1.35, fontSize };
  }
  function renderObject(c, o, editor) {
    const [w, h] = dimension(); c.save();
    const m = objectMetrics(c, o);
    c.translate(w * o.x, h * o.y); c.rotate(o.angle * Math.PI / 180);
    c.fillStyle = o.color; c.strokeStyle = '#fff'; c.lineJoin = 'round'; c.lineCap = 'round';
    if (o.type === 'arrow') {
      const shaft = m.h * .24, head = m.w * .26;
      c.beginPath(); c.moveTo(-m.w / 2, -shaft / 2); c.lineTo(m.w / 2 - head, -shaft / 2); c.lineTo(m.w / 2 - head, -m.h / 2); c.lineTo(m.w / 2, 0); c.lineTo(m.w / 2 - head, m.h / 2); c.lineTo(m.w / 2 - head, shaft / 2); c.lineTo(-m.w / 2, shaft / 2); c.closePath();
      c.lineWidth = Math.max(3, m.h * .065); c.stroke(); c.fill();
    } else {
      c.textAlign = 'center'; c.textBaseline = 'middle'; c.lineWidth = Math.max(3, m.fontSize * .09); c.strokeText(o.text, 0, 0); c.fillText(o.text, 0, 0);
    }
    if (editor && activeTab === 'decor' && o.id === selectedObject) {
      c.strokeStyle = '#7254df'; c.lineWidth = Math.min(w, h) * .0025; c.setLineDash([10, 6]); c.strokeRect(-m.w / 2 - 9, -m.h / 2 - 9, m.w + 18, m.h + 18);
    }
    c.restore();
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
    state.objects.forEach(o => renderObject(c, o, editor)); renderStory(c); c.restore();
  }

  function renderStory(c) {
    if(state.photoCount!==3 || !['top-one','top-two'].includes(state.layout))return;
    const [w,h]=dimension(), unit=Math.min(w,h)/1200, rs=rects();
    c.save();
    if(state.showFlow) {
      for(let i=0;i<2;i++) {
        const from=rs[i],to=rs[i+1], sameRow=Math.abs(from.y-to.y)<1;
        let mx,my,dx,dy;
        if(sameRow) {dx=to.x>from.x?1:-1;dy=0;mx=dx>0?(from.x+from.w+to.x)/2:(to.x+to.w+from.x)/2;my=from.y+from.h/2;}
        else {dx=0;dy=1;mx=state.layout==='top-one'?to.x+to.w/2:from.x+from.w/2;my=(from.y+from.h+to.y)/2;}
        const half=(state.gap/2+25)*unit, head=13*unit;
        c.beginPath();c.moveTo(mx-dx*half,my-dy*half);c.lineTo(mx+dx*half,my+dy*half);
        c.moveTo(mx+dx*half-dx*head-dy*head*.7,my+dy*half-dy*head+dx*head*.7);c.lineTo(mx+dx*half,my+dy*half);c.lineTo(mx+dx*half-dx*head+dy*head*.7,my+dy*half-dy*head-dx*head*.7);
        c.lineCap='round';c.lineJoin='round';c.strokeStyle='#ffffff';c.lineWidth=13*unit;c.stroke();c.strokeStyle='#252635';c.lineWidth=6*unit;c.stroke();
      }
    }
    if(state.showNumbers) rs.forEach((r,i)=>{
      const radius=24*unit, margin=14*unit;
      const x=state.readingDirection==='rtl'?r.x+r.w-margin-radius:r.x+margin+radius,y=r.y+margin+radius;
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
  }
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
    if(state.photoCount===3 && previous!==3) state.layout='top-one';
    if(state.photoCount!==3 && ['top-one','top-two'].includes(state.layout)) state.layout='horizontal';
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
    if (state.objects.length >= 12) { toast('矢印・文字は合計12個まで追加できます'); return; }
    action(() => {
      const o = { id: 'o' + nextId++, type, x: .5, y: .5, size: type === 'arrow' ? .25 : .16, angle: type === 'arrow' ? -35 : 0, color: type === 'arrow' ? '#ee5545' : '#252635', text: type === 'text' ? 'ここに文字' : '' };
      state.objects.push(o); selectedObject = o.id;
    });
    if (type === 'text') { $('textContent').focus(); $('textContent').select(); }
  }
  $('addArrow').addEventListener('click', () => addObject('arrow'));
  $('addText').addEventListener('click', () => addObject('text'));
  $('overlaySelect').addEventListener('change', () => { finishEdit(); selectedObject = $('overlaySelect').value; update(); });
  bindControl('textContent', value => { if (object()) object().text = value.slice(0, 40); });
  bindControl('objectSize', value => { if (object()) object().size = Number(value) / 100; });
  bindControl('objectAngle', value => { if (object()) object().angle = Number(value); });
  bindControl('objectX', value => { if (object()) object().x = Number(value) / 100; });
  bindControl('objectY', value => { if (object()) object().y = Number(value) / 100; });
  bindControl('objectColor', value => { if (object()) object().color = value; });
  $('deleteObject').addEventListener('click', () => action(() => { state.objects = state.objects.filter(o => o.id !== selectedObject); selectedObject = null; }));

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
    if (gesture.type === 'object') gesture.origin = copy(object());
    if (pts.length >= 2 && gesture.type === 'photo') {
      gesture.distance = Math.max(1, Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y));
      gesture.mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
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
      o.x = clamp(gesture.origin.x + (pts[0].x - gesture.start.x) / w, 0, 1);
      o.y = clamp(gesture.origin.y + (pts[0].y - gesture.start.y) / h, 0, 1);
    } else {
      const p = state.panels[gesture.index], r = rects()[gesture.index];
      if (pts.length === 2) {
        const distance = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
        p.zoom = clamp(gesture.panel.zoom * distance / gesture.distance, 1, 4);
        const g = geometry(p, r), mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
        p.x = g.overflowX > 0 ? clamp((r.x + gesture.focal.x * g.w - mid.x) / g.overflowX, 0, 1) : .5;
        p.y = g.overflowY > 0 ? clamp((r.y + gesture.focal.y * g.h - mid.y) / g.overflowY, 0, 1) : .5;
      } else {
        const g = geometry(p, r);
        p.x = g.overflowX > 0 ? clamp(gesture.panel.x - (pts[0].x - gesture.start.x) / g.overflowX, 0, 1) : .5;
        p.y = g.overflowY > 0 ? clamp(gesture.panel.y - (pts[0].y - gesture.start.y) / g.overflowY, 0, 1) : .5;
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
    } catch (error) { toast('画像を作成できませんでした。ほかのアプリを閉じて、もう一度お試しください。'); }
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
})();
