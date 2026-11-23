// ============================================================
// BOX — Krampus. Story, walk-around, hunt, escape.
// ============================================================
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const canvas = $('view');
  // Phone/tablet mode only when touch is the main input. A touchscreen laptop or a PC browser that merely reports touch
  // support still has a mouse, so it gets the PC controls. If someone does start tapping, we switch to touch then.
  const mq = (q) => { try { return matchMedia(q).matches; } catch (e) { return false; } };
  let isTouch = /[?&]touch=1/.test(location.search) || (/[?&]touch=0/.test(location.search) ? false : (mq('(pointer: coarse)') && !mq('(any-pointer: fine)')) || (!window.matchMedia && 'ontouchstart' in window));
  if (isTouch) document.body.classList.add('touch');
  window.addEventListener('touchstart', () => { if (!isTouch) { isTouch = true; document.body.classList.add('touch'); } }, { passive: true, capture: true });
  // ...and a real mouse moving means this is a PC after all (touchscreen laptops, PC browsers that report touch)
  let mouseMoves = 0;
  window.addEventListener('pointermove', (e) => { if (isTouch && e.pointerType === 'mouse' && (e.movementX || e.movementY) && ++mouseMoves > 3) { isTouch = false; document.body.classList.remove('touch'); } }, { passive: true });
  const debug = /debug/.test(location.search);
  const DIFF = {
    easy:   { label: 'Easy',   rage: 3.7,  behind: 20, spd: 0.78, range: 11, rate: 0.5, grace: 40, map: true, lose: 9,  slips: 3, traps: 2, hunch: 70 },
    normal: { label: 'Normal', rage: 4.0,  behind: 18, spd: 0.9,  range: 13, rate: 0.7, grace: 32, map: false, lose: 11, slips: 2, traps: 3, hunch: 52 },
    hard:   { label: 'Hard',   rage: 4.4,  behind: 15, spd: 1.04, range: 17, rate: 1.1, grace: 22, map: false, lose: 14, slips: 1, traps: 4, hunch: 42 },
  };
  const CLUES = [
    { name: 'mitten', col: '#d0342c', text: 'Leo’s mitten. The crying is easier to hear now.' },
    { name: 'toy train', col: '#2f6fd0', text: 'His toy train. He has to be somewhere upstairs.' },
    { name: 'scarf', col: '#2f9e55', text: null },
  ];
  const EXPLORE_SECS = 600;   // 9:03 → 9:13

  // ---------------- setup ----------------
  let R, LV, WORLD, STATIC;
  try {
    R = new Renderer(canvas, isTouch || /[?&]q=low/.test(location.search) ? { lights: 6, taps: 1, shadowRes: 2048, quality: 'phone' } : { lights: 8, taps: 2, shadowRes: 4096, quality: 'high' });
    LV = buildLevel();
    STATIC = R.upload(LV.geo.array());
    LV.geo = null;
    R.bakeShadows(STATIC, LV.bounds);
    if (R.addModels && LV.models.length) R.addModels(LV.models).catch(() => {});
    WORLD = new World(LV.obbs, LV.width, LV.depth);
  } catch (e) {
    $('fatal').style.display = 'flex'; $('fatal').textContent = 'Sorry — this browser could not start the 3D view. (' + e.message + ')';
    throw e;
  }
  const F1 = LV.F1;
  $('loading').style.display = 'none';

  function surfaceY(x, z, y) {
    let best = -1e9;
    if (z < -0.1 || x > 64.1) return 0;
    for (const s of LV.surfaces) if (x >= s.x0 && x <= s.x1 && z >= s.z0 && z <= s.z1 && s.y <= y + 0.6 && s.y > best) best = s.y;
    for (const r of LV.ramps) if (x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1) {
      const t = clamp(((r.axis === 'x' ? x : z) - r.a0) / (r.a1 - r.a0), 0, 1);
      const h = r.y0 + t * (r.y1 - r.y0);
      if (h <= y + 0.6 && h > best) best = h;
    }
    return best === -1e9 ? y : best;
  }
  const floorOf = (y) => (y > F1 * 0.5 ? 1 : 0);
  function zoneName(x, z, y) {
    const f = floorOf(y);
    for (const r of LV.ramps) if (x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1) return 'Stairs';
    for (const [zf, x0, x1, z0, z1, n] of LV.zones) if (zf === f && x >= x0 && x <= x1 && z >= z0 && z <= z1) return n;
    return f ? 'Upstairs' : 'Downstairs';
  }
  function lightZone(x, z, f) {
    const i = x < 24 ? (z < 14 ? 0 : 1) : x < 40 ? (z < 12 ? 2 : z < 28 ? 3 : 4) : (z < 14 ? 5 : z < 28 ? 6 : 7);
    return i + (f ? 8 : 0);
  }
  const PLACE = { 'Clearance': 'the clearance corner', 'Lighting': 'the lamp department', 'Bedrooms': 'the bedrooms', 'Bath Corner': 'the bath corner', 'Rug Wall': 'the rug wall', 'Upstairs Living Rooms': 'the upstairs living rooms', 'Upstairs Dining': 'the upstairs dining tables', 'Balcony': 'the balcony' };
  const placeName = (x, z, y) => { const n = zoneName(x, z, y); return PLACE[n] || 'the ' + n.toLowerCase(); };
  const turnTo = (a, b, k) => { let d = b - a; while (d > Math.PI) d -= TAU; while (d < -Math.PI) d += TAU; return a + d * Math.min(1, k); };

  // ---------------- walk grid + A* ----------------
  const CELL = 0.5, GW = Math.ceil(LV.width / CELL), GH = Math.ceil(LV.depth / CELL), GN = GW * GH;
  const walk = new Uint8Array(GN * 2), cover = new Uint8Array(GN * 2);
  const id = (f, i, j) => f * GN + j * GW + i;
  const cellOf = (x, z) => [clamp(Math.floor(x / CELL), 0, GW - 1), clamp(Math.floor(z / CELL), 0, GH - 1)];
  const cx = (i) => (i + 0.5) * CELL;
  for (let f = 0; f < 2; f++) {
    const fy = f ? F1 : 0;
    for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) {
      const x = cx(i), z = cx(j);
      if (f === 1 && !LV.surfaces.some((s) => s.y === F1 && x > s.x0 + 0.05 && x < s.x1 - 0.05 && z > s.z0 + 0.05 && z < s.z1 - 0.05)) continue;
      if (LV.ramps.some((r) => x > r.x0 - 0.35 && x < r.x1 + 0.35 && z > r.z0 - 0.35 && z < r.z1 + 0.35)) continue;
      if (WORLD.blocked(x, z, 0.45, fy + 0.36, fy + 2.2)) continue;
      walk[id(f, i, j)] = 1;
    }
  }
  const links = new Map();
  function nearestWalk(f, x, z, maxR = 12, only = null) {
    const [ci, cj] = cellOf(x, z);
    for (let r = 0; r <= maxR; r++) {
      let best = -1, bd = 1e9;
      for (let j = cj - r; j <= cj + r; j++) for (let i = ci - r; i <= ci + r; i++) {
        if (i < 0 || j < 0 || i >= GW || j >= GH) continue;
        if (Math.max(Math.abs(i - ci), Math.abs(j - cj)) !== r) continue;
        const n = id(f, i, j);
        if (walk[n] && (!only || only[n])) { const d = (cx(i) - x) ** 2 + (cx(j) - z) ** 2; if (d < bd) { bd = d; best = n; } }
      }
      if (best >= 0) return best;
    }
    return -1;
  }
  let stairLinks = 0;
  for (const s of LV.stairs) {
    const a = nearestWalk(0, s.bottom[0], s.bottom[1], 3), b = nearestWalk(1, s.top[0], s.top[1], 3);
    if (a < 0 || b < 0) continue;
    const cost = Math.hypot(s.top[0] - s.bottom[0], s.top[1] - s.bottom[1]) + 1;
    if (!links.has(a)) links.set(a, []); if (!links.has(b)) links.set(b, []);
    links.get(a).push([b, cost]); links.get(b).push([a, cost]); stairLinks++;
  }
  const nodePos = (n) => { const f = n >= GN ? 1 : 0, k = n - f * GN; return [cx(k % GW), cx(Math.floor(k / GW)), f]; };
  const reach = new Uint8Array(GN * 2), REACH = [];
  (function flood() {
    const s0 = nearestWalk(0, 32, 4);
    const q = [s0]; reach[s0] = 1;
    while (q.length) {
      const n = q.pop(); REACH.push(n);
      const f = n >= GN ? 1 : 0, k = n - f * GN, i = k % GW, j = Math.floor(k / GW);
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= GW || jj >= GH) continue;
        const m = id(f, ii, jj); if (walk[m] && !reach[m]) { reach[m] = 1; q.push(m); }
      }
      for (const [m] of links.get(n) || []) if (!reach[m]) { reach[m] = 1; q.push(m); }
    }
    for (const n of REACH) {
      const f = n >= GN ? 1 : 0, k = n - f * GN, i = k % GW, j = Math.floor(k / GW);
      let c = 0;
      for (let dj = -3; dj <= 3; dj++) for (let di = -3; di <= 3; di++) {
        const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= GW || jj >= GH) { c++; continue; }
        if (!walk[id(f, ii, jj)]) c++;
      }
      cover[n] = c;
    }
  })();
  const SPOTS = REACH.filter((n) => cover[n] >= 14);
  const rNode = (f, x, z) => nearestWalk(f, x, z, 14, reach);
  const gS = new Float32Array(GN * 2), came = new Int32Array(GN * 2), seenStamp = new Int32Array(GN * 2), closed = new Int32Array(GN * 2);
  let stampA = 1;
  function astar(a, b) {
    if (a < 0 || b < 0) return null;
    stampA++;
    const heap = []; const push = (n, f) => { heap.push([f, n]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
    const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
    const [bx, bz, bf] = nodePos(b);
    const H = (n) => { const [x, z, f] = nodePos(n); const dx = Math.abs(x - bx), dz = Math.abs(z - bz); return Math.max(dx, dz) + 0.414 * Math.min(dx, dz) + (f !== bf ? 4 : 0); };
    seenStamp[a] = stampA; gS[a] = 0; came[a] = -1; push(a, H(a));
    let iters = 0;
    while (heap.length && iters++ < 60000) {
      const [, n] = pop();
      if (closed[n] === stampA) continue; closed[n] = stampA;
      if (n === b) { const out = []; let c = n; while (c >= 0) { out.push(c); c = came[c]; } out.reverse(); return out; }
      const f = n >= GN ? 1 : 0, k = n - f * GN, i = k % GW, j = Math.floor(k / GW);
      const tryN = (m, cost) => { const g = gS[n] + cost; if (seenStamp[m] !== stampA || g < gS[m]) { seenStamp[m] = stampA; gS[m] = g; came[m] = n; push(m, g + H(m)); } };
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= GW || jj >= GH) continue;
        const m = id(f, ii, jj); if (!walk[m] || closed[m] === stampA) continue;
        if (di && dj && (!walk[id(f, i + di, j)] || !walk[id(f, i, j + dj)])) continue;
        tryN(m, (di && dj ? 1.414 : 1) * CELL);
      }
      for (const [m, cost] of links.get(n) || []) if (closed[m] !== stampA) tryN(m, cost);
    }
    return null;
  }
  function lineWalkable(f, x0, z0, x1, z1) {
    const d = Math.hypot(x1 - x0, z1 - z0), n = Math.ceil(d / 0.2);
    for (let k = 0; k <= n; k++) { const t = k / Math.max(1, n), [i, j] = cellOf(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t); if (!walk[id(f, i, j)]) return false; }
    return true;
  }
  function makePath(nodes) {
    if (!nodes) return null;
    const pts = nodes.map(nodePos), out = [pts[0]];
    let i = 0;
    while (i < pts.length - 1) {
      let j = i + 1;
      if (pts[j][2] === pts[i][2]) while (j + 1 < pts.length && pts[j + 1][2] === pts[i][2] && lineWalkable(pts[i][2], pts[i][0], pts[i][1], pts[j + 1][0], pts[j + 1][1])) j++;
      out.push(pts[j]); i = j;
    }
    return out;
  }
  const route = (x0, z0, f0, x1, z1, f1) => makePath(astar(rNode(f0, x0, z0), rNode(f1, x1, z1)));
  // same, for someone who may be standing part-way up the staircase: they finish the stairs first instead of turning back
  const onStairs = (y) => y > 0.12 && y < F1 - 0.12;
  function routeY(x0, z0, y0, x1, z1, f1) {
    if (!onStairs(y0)) return route(x0, z0, floorOf(y0), x1, z1, f1);
    const st = LV.stairs[0], end = f1 === 1 ? st.top : st.bottom, p = route(end[0], end[1], f1, x1, z1, f1);
    return p ? [[x0, z0, floorOf(y0)]].concat(p) : null;
  }
  function upstairsDist() {
    const dist = new Float64Array(GN * 2).fill(1e9), top = LV.stairs[0].top, s0 = rNode(1, top[0], top[1]);
    const heap = [[0, s0]]; dist[s0] = 0;
    const push = (d, n) => { heap.push([d, n]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
    const pop = () => { const t = heap[0], l = heap.pop(); if (heap.length) { heap[0] = l; let i = 0; for (;;) { const a = 2 * i + 1, b = a + 1; let m = i; if (a < heap.length && heap[a][0] < heap[m][0]) m = a; if (b < heap.length && heap[b][0] < heap[m][0]) m = b; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return t; };
    while (heap.length) {
      const [d, n] = pop(); if (d > dist[n]) continue;
      const k = n - GN, i = k % GW, j = Math.floor(k / GW);
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= GW || jj >= GH) continue;
        const m = id(1, ii, jj); if (!walk[m]) continue;
        if (di && dj && (!walk[id(1, i + di, j)] || !walk[id(1, i, j + dj)])) continue;
        const nd = d + (di && dj ? 1.414 : 1) * CELL; if (nd < dist[m]) { dist[m] = nd; push(nd, m); }
      }
    }
    return dist;
  }

  // ---------------- minimap ----------------
  const MAP_S = 2.4;
  const mapImg = [0, 1].map((f) => {
    const c = document.createElement('canvas'); c.width = Math.ceil(LV.width * MAP_S); c.height = Math.ceil(LV.depth * MAP_S);
    const g = c.getContext('2d');
    g.translate(0, c.height); g.scale(MAP_S, -MAP_S);
    g.fillStyle = 'rgba(255,255,255,0.9)'; g.fillRect(0, 0, LV.width, LV.depth);
    if (f === 1) { g.fillStyle = 'rgba(40,40,40,0.3)'; g.fillRect(24, 12, 16, 16); }
    const fy = f ? F1 : 0;
    for (const o of LV.obbs) {
      if (!o.collide || o.y1 <= fy + 0.3 || o.y0 >= fy + 1.8 || o.cz < -0.5 || o.cx > 64.5) continue;
      g.save(); g.translate(o.cx, o.cz); g.transform(o.c, -o.s, o.s, o.c, 0, 0);
      g.fillStyle = o.y1 - Math.max(o.y0, fy) > 2.6 ? '#3a3633' : (o.opaque ? '#a59b8d' : '#cfc7bb');
      g.fillRect(-o.hx, -o.hz, o.hx * 2, o.hz * 2); g.restore();
    }
    g.fillStyle = '#e0a03a'; for (const r of LV.ramps) g.fillRect(r.x0, r.z0, r.x1 - r.x0, r.z1 - r.z0);
    if (f === 0) { g.fillStyle = '#2f9e55'; g.fillRect(30, 0, 4, 0.8); g.fillRect(63.2, 29, 0.8, 2); }
    return c;
  });
  const mm = $('minimap'), mg = mm.getContext('2d');

  // ---------------- state ----------------
  let NOW = 0, lastTime = performance.now(), timeScale = 1;
  const P = { x: 32, y: 0, z: 3, yaw: Math.PI, pitch: 0, vx: 0, vz: 0, crouch: false, ct: 0, run: false, bob: 0 };
  const ZL = new Float32Array(16).fill(1), ZT = new Float32Array(16).fill(1);
  let G = null, K = null;
  let diffKey = 'normal';
  let mode = 'title';        // title | cine | explore | play | pause | end
  let pausedFrom = null;
  const keys = {};
  const touch = { move: null, look: null, mx: 0, mz: 0 };
  let mapOn = true, flick = 1, ambDim = 1;
  const cast = {};
  const mkA = (idn, x, z, yaw, extra) => (cast[idn] = Object.assign({ id: idn, x, y: 0, z, yaw, anim: 'idle', phase: 0, speed: 1.3, path: null, face: {}, gest: null, look: null, visible: false, seed: Math.random() * 9 }, extra || {}));
  for (const idn of ['dad', 'mom', 'you', 'leo', 'dana', 'marcus', 'priya', 'manager']) mkA(idn, 0, 0, 0);
  const KS = 0.84;   // Krampus's size everywhere (1 = about twice Dad's height)
  const KV = { x: 0, y: -50, z: 0, yaw: 0, anim: 'idle', phase: 0, visible: false, sackFull: false, gest: null, look: null, scale: KS };
  const CAR = { x: 70, z: -14, yaw: Math.PI + 0.25, visible: true, lights: false, inside: false };
  const SKY = { broken: false };
  const DISPLAY = { smashed: false };
  const DOORS = { front: 0, side: 0 };
  const PLATE = { visible: false, x: 0, y: 0, z: 0 };
  let storeClock = 8 * 60 + 59;
  let particles = [];

  function getBest(k) { try { return +localStorage.getItem('box-krampus-' + k) || 0; } catch (e) { return 0; } }
  function setBest(k, v) { try { localStorage.setItem('box-krampus-' + k, String(v)); } catch (e) { /* storage blocked */ } }
  const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; };

  // ---------------- input ----------------
  window.addEventListener('keydown', (e) => {
    keys[e.code] = true; if (e.key === 'Shift') keys.Shift = true;
    if (mode === 'play' || mode === 'explore') {
      if (e.code === 'KeyR' && !e.repeat) runToggle = !runToggle;   // R toggles running, for anyone who'd rather not hold Shift
      if (e.code === 'KeyC' || e.code === 'ControlLeft') P.crouch = !P.crouch;
      if (e.code === 'KeyM') mapOn = !mapOn;
      if (e.code === 'KeyE' || e.code === 'Space' || e.code === 'Enter') interact();
      if (e.code === 'Escape' || e.code === 'KeyP') pause();
    } else if (mode === 'pause' && e.code === 'KeyP') resume();
    else if (mode === 'cine' && (e.code === 'Escape' || e.code === 'Enter')) skipScene();
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  });
  let runToggle = false;
  window.addEventListener('keyup', (e) => { keys[e.code] = false; if (e.key === 'Shift') keys.Shift = false; });
  window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; });
  let dragLook = false, hadLock = false;
  const playing = () => mode === 'play' || mode === 'explore';
  const lock = () => { if (!isTouch && canvas.requestPointerLock && document.pointerLockElement !== canvas) { try { const r = canvas.requestPointerLock(); if (r && r.catch) r.catch(() => {}); } catch (e) { /* blocked in some frames */ } } };
  canvas.addEventListener('mousedown', () => { if (!playing()) return; lock(); dragLook = true; });
  window.addEventListener('mouseup', () => { dragLook = false; });
  window.addEventListener('mousemove', (e) => { if (playing() && (document.pointerLockElement === canvas || dragLook)) look(e.movementX || 0, e.movementY || 0, 0.0024); });
  document.addEventListener('pointerlockchange', () => {
    if (document.pointerLockElement !== canvas && playing() && !isTouch && hadLock && !(debug && window.__hold)) pause();
    hadLock = document.pointerLockElement === canvas;
  });
  function look(dx, dy, k) { P.yaw += dx * k; P.pitch = clamp(P.pitch - dy * k, -1.35, 1.35); }
  const stickBase = $('stick'), stickKnob = $('knob');
  canvas.addEventListener('touchstart', (e) => {
    if (!playing()) return;
    for (const t of e.changedTouches) {
      if (t.clientX < window.innerWidth * 0.45 && !touch.move) {
        touch.move = { id: t.identifier, x0: t.clientX, y0: t.clientY };
        stickBase.style.display = 'block'; stickBase.style.left = (t.clientX - 55) + 'px'; stickBase.style.top = (t.clientY - 55) + 'px';
        stickKnob.style.transform = 'translate(0px,0px)';
      } else if (!touch.look) touch.look = { id: t.identifier, x: t.clientX, y: t.clientY };
    }
    e.preventDefault();
  }, { passive: false });
  canvas.addEventListener('touchmove', (e) => {
    for (const t of e.changedTouches) {
      if (touch.move && t.identifier === touch.move.id) {
        let dx = t.clientX - touch.move.x0, dy = t.clientY - touch.move.y0; const d = Math.hypot(dx, dy), m = 50;
        if (d > m) { dx *= m / d; dy *= m / d; }
        touch.mx = dx / m; touch.mz = dy / m; stickKnob.style.transform = `translate(${dx}px,${dy}px)`;
      } else if (touch.look && t.identifier === touch.look.id) {
        look(t.clientX - touch.look.x, t.clientY - touch.look.y, 0.0058); touch.look.x = t.clientX; touch.look.y = t.clientY;
      }
    }
    e.preventDefault();
  }, { passive: false });
  const endTouch = (e) => {
    for (const t of e.changedTouches) {
      if (touch.move && t.identifier === touch.move.id) { touch.move = null; touch.mx = touch.mz = 0; stickBase.style.display = 'none'; }
      if (touch.look && t.identifier === touch.look.id) touch.look = null;
    }
  };
  canvas.addEventListener('touchend', endTouch); canvas.addEventListener('touchcancel', endTouch);
  const press = (el, down, up) => {
    el.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); try { el.setPointerCapture(e.pointerId); } catch (er) {} down(); });
    if (up) for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) el.addEventListener(ev, () => up());
    el.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });   // no double-firing or zoom on phones
  };
  press($('btnCrouch'), () => { P.crouch = !P.crouch; });
  press($('btnRun'), () => { P.run = true; }, () => { P.run = false; });
  press($('btnUse'), () => interact());
  $('btnPause').addEventListener('click', () => pause());
  $('skipBtn').addEventListener('click', () => skipScene());
  $('minimap').addEventListener('click', () => { mapOn = !mapOn; });

  // ---------------- audio ----------------
  let AC = null, master = null, noiseBuf = null, muted = false, musicGain = null;
  function audioInit() {
    if (AC) { if (AC.state === 'suspended') AC.resume(); return; }
    try { AC = new (window.AudioContext || window.webkitAudioContext)(); master = AC.createGain(); master.gain.value = 0.75; master.connect(AC.destination); musicGain = AC.createGain(); musicGain.gain.value = 0; musicGain.connect(master); loadSounds(); } catch (e) { AC = null; }
  }
  // recorded lines (assets/sounds/*.mp3, embedded by the build): the same voice on every device
  const SND = {};
  function loadSounds() {
    for (const [k, uri] of Object.entries(window.BOX_SND || {})) {
      try { const bin = atob(uri.split(',')[1]), u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i); AC.decodeAudioData(u8.buffer, (b) => { SND[k] = b; }, () => {}); } catch (e) { /* falls back to the device voice */ }
    }
  }
  // spoken lines: assets/sounds/v_<hash of "WHO|text">.mp3, made by tools/voices.py
  const vhash = (str) => { let v = 5381; for (let i = 0; i < str.length; i++) v = ((v * 33) ^ str.charCodeAt(i)) >>> 0; return ('0000000' + v.toString(16)).slice(-8); };
  const VOX = new Set();
  function speak(who, text) {
    const buf = SND['v_' + vhash(who + '|' + text)]; if (!AC || muted || !buf) return 0;
    const a = cast[who.toLowerCase()]; let vol = 1, pan = 0;
    if (a && a.visible && mode !== 'cine') { const [v, p] = hear(a.x, a.z, a.y || 0, 16); vol = clamp(0.25 + v * 1.6, 0.25, 1); pan = p; }   // in the store, voices come from where the person is
    const src = AC.createBufferSource(), g = AC.createGain(); src.buffer = buf; g.gain.value = vol * 1.25; src.connect(g); out(g, pan); src.start();
    VOX.add(src); src.onended = () => VOX.delete(src);
    return buf.duration;
  }
  function hush() { for (const s of VOX) { try { s.stop(); } catch (e) {} } VOX.clear(); }
  function playSnd(k, vol) { if (!AC || muted || !SND[k]) return false; const s = AC.createBufferSource(), g = AC.createGain(); s.buffer = SND[k]; g.gain.value = vol; s.connect(g); g.connect(master); s.start(); return true; }
  function out(node, pan) {
    if (pan && AC.createStereoPanner) { const p = AC.createStereoPanner(); p.pan.value = clamp(pan, -1, 1); node.connect(p); p.connect(master); } else node.connect(master);
  }
  function tone(freq, dur, vol = 0.2, type = 'sine', when = 0, slide = 0, pan = 0, dest = null) {
    if (!AC || muted || vol < 0.003) return;
    const t0 = AC.currentTime + when, o = AC.createOscillator(), g = AC.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t0); if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t0 + dur);
    g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(vol, t0 + 0.01); g.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);
    o.connect(g); if (dest) g.connect(dest); else out(g, pan); o.start(t0); o.stop(t0 + dur + 0.05);
  }
  function noise(vol, pan, cut = 900, type = 'lowpass', len = 1) {
    if (!AC || muted || vol < 0.01) return;
    if (!noiseBuf) { noiseBuf = AC.createBuffer(1, AC.sampleRate * 0.5, AC.sampleRate); const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1); }
    const s = AC.createBufferSource(); s.buffer = noiseBuf;
    const f = AC.createBiquadFilter(); f.type = type; f.frequency.value = cut;
    const g = AC.createGain(); const t0 = AC.currentTime; g.gain.setValueAtTime(vol, t0); g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.12 * len);
    s.loop = true; s.connect(f); f.connect(g); out(g, pan); s.start(t0); s.stop(t0 + Math.max(0.5, 0.12 * len + 0.1));
  }
  const thud = (vol, pan, cut = 900) => noise(vol, pan, cut, 'lowpass', 1);
  function jingle(vol, pan, n = 4) { for (let i = 0; i < n; i++) tone(2300 + Math.random() * 2300, 0.16 + Math.random() * 0.25, vol * (0.5 + Math.random() * 0.5), 'sine', i * 0.04 + Math.random() * 0.05, 0, pan); }
  function sob(vol, pan) { tone(540, 0.34, vol, 'triangle', 0, -150, pan); tone(480, 0.4, vol, 'triangle', 0.42, -150, pan); tone(610, 0.14, vol * 0.6, 'sine', 0.92, -90, pan); }
  function giggle(vol, pan) { for (let i = 0; i < 4; i++) tone(780 + i * 40 - (i % 2) * 120, 0.09, vol, 'triangle', i * 0.11, -60, pan); }
  // --- Krampus's voice: a growl under whatever speech voice the device has, pitched as low as it goes
  function growl(vol, len = 1.8) { tone(52, len, vol * 0.5, 'sawtooth', 0, -14); tone(79, len * 0.9, vol * 0.28, 'square', 0.04, -22); noise(vol * 0.45, 0, 240, 'lowpass', len * 7); }
  function breath(vol, pan) { noise(vol, pan, 520, 'bandpass', 9); tone(70, 0.9, vol * 0.25, 'sawtooth', 0, -18, pan); }
  // his five recorded lines (assets/sounds/, made by tools/krampus_voice.py)
  const KLINES = { 'I can hear you': 'hear', 'I’m going to find you': 'k_find', 'Come out, come out, wherever you are': 'k_comeout', 'I can smell you, little one': 'k_smell', 'Your brother is waiting for you': 'k_brother' };
  let kSaidAt = -99;
  function krampusSay(text, vol = 1) {
    if (NOW - kSaidAt < 5) return; kSaidAt = NOW;   // never two lines on top of each other
    showMsg('\u201c' + text + '\u201d', 3.8, 'krampus'); growl(0.4 * vol, 2.4);
    if (KLINES[text] && playSnd(KLINES[text], clamp(vol, 0.3, 1) * 1.5)) return;
    try { if (window.speechSynthesis && !muted) { const u = new SpeechSynthesisUtterance(text); u.pitch = 0.01; u.rate = 0.5; u.volume = clamp(vol, 0.25, 1); speechSynthesis.cancel(); speechSynthesis.speak(u); } } catch (e) { /* no voice on this device: growl + subtitle only */ }
  }
  function scream() { roar(); for (const f of [622, 880, 933, 1244, 1760]) tone(f, 1.3, 0.2, 'sawtooth', 0, -f * 0.45); noise(0.9, 0, 2400, 'highpass', 11); tone(41, 1.6, 0.6, 'sine'); shatter(0.35); }
  function roar() { tone(95, 1.1, 0.5, 'sawtooth', 0, -50); tone(63, 1.3, 0.4, 'square', 0.05, -25); thud(0.6, 0, 400); }
  function shatter(vol = 0.6) { noise(vol, 0, 3500, 'highpass', 4); for (let i = 0; i < 14; i++) tone(2500 + Math.random() * 4000, 0.05 + Math.random() * 0.2, vol * 0.25, 'square', Math.random() * 0.5, -1500); thud(vol, 0, 300); }
  function boxSmash() { for (let i = 0; i < 6; i++) tone(1800 + Math.random() * 2600, 0.08 + Math.random() * 0.12, 0.12, 'square', i * 0.05 + Math.random() * 0.05, -900); thud(0.5, 0, 1800); }
  // ---------------- voices during the hunt ----------------
  // The family is gone, but the store keeps talking: the manager on the speakers, Leo calling out from wherever
  // Krampus hid him, the staff whispering through the glass, Leo again once you've got him.
  const HV = {
    pa: [['MANAGER', 'Attention, shoppers. The store is now closed. Please remain where you are.'], ['MANAGER', 'Attention, shoppers. Lost children may be collected upstairs.'],
      ['MANAGER', 'A team member will be with you shortly. Please do not run in the store.'], ['MANAGER', 'Attention, shoppers. Please stay very, very quiet.']],
    sack: [['LEO', 'Let me go! LET ME GO!'], ['LEO', 'Help me! Somebody help me!']],
    leo: [['LEO', 'Help! I’m up here!'], ['LEO', 'It’s so dark in here…'], ['LEO', 'I want Mom…'], ['LEO', 'Are you still there?'], ['LEO', 'Please hurry. I can hear his bells.']],
    glass: [['MARCUS', 'You should have left when we told you.'], ['DANA', 'Shhh. He’s listening.'], ['PRIYA', 'Thank you for shopping with us.'], ['MANAGER', 'He always finds them.'], ['MARCUS', 'The doors are locked, little one.']],
    rescue: [['LEO', 'I knew you’d find me.']],
    escape: [['LEO', 'He’s coming! Run!'], ['LEO', 'Don’t let go of me!'], ['LEO', 'Faster! He’s right behind us!']],
    fell: [['LEO', 'Wait! Don’t leave me!']],
  };
  let voiceUntil = 0;
  // where: [x, y, z] (heard from there, quieter with distance) or null (right beside you). fx: 'muffled' (inside a pot or a
  // sack), 'pa' (the store speakers: a chime, thin and echoing), or nothing. Returns false when nothing was played.
  function voiceAt(line, where, range = 20, fx = '') {
    const [who, text] = line, buf = SND['v_' + vhash(who + '|' + text)];
    if (!AC || muted || mode !== 'play' || NOW < voiceUntil) return false;
    let vol = 1, pan = 0;
    if (where) { [vol, pan] = hear(where[0], where[2], where[1], range); if (vol < 0.04) return false; vol = clamp(0.2 + vol * 1.3, 0.2, 1); }
    const lag = fx === 'pa' ? 0.9 : 0;
    if (fx === 'pa') { tone(784, 0.7, 0.12, 'sine'); tone(659, 0.9, 0.12, 'sine', 0.35); }   // ding-dong
    if (buf) {
      const src = AC.createBufferSource(), g = AC.createGain(); src.buffer = buf; g.gain.value = vol * (fx === 'muffled' ? 1.6 : fx === 'pa' ? 0.9 : 1.2);
      let node = src;
      if (fx === 'muffled') { const f = AC.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 750; node.connect(f); node = f; }
      if (fx === 'pa') { const f = AC.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1700; f.Q.value = 0.6; node.connect(f); node = f;
        const d = AC.createDelay(1), fb = AC.createGain(); d.delayTime.value = 0.23; fb.gain.value = 0.35; f.connect(d); d.connect(fb); fb.connect(d); d.connect(g); }
      node.connect(g); out(g, pan); src.start(AC.currentTime + lag);
      VOX.add(src); src.onended = () => VOX.delete(src);
    }
    const dur = (buf ? buf.duration : text.length * 0.06) + lag + 0.4; voiceUntil = NOW + dur + 1.5;
    ev('say', who + (fx ? ' (' + fx + ')' : '') + ': ' + text);
    const tag = fx === 'muffled' ? ' <i>(muffled)</i>' : fx === 'pa' ? ' <i>(speakers)</i>' : '';
    $('sub').innerHTML = `<b>${who}${tag}</b><span>${text}</span>`; $('sub').style.opacity = 1; subT = dur;
    return true;
  }
  const pick = (arr) => arr[(Math.random() * arr.length) | 0];
  function huntVoices(dt) {
    if (NOW - kSaidAt < 4) return;                                            // never over the top of Krampus
    const b = G.bro, fd = LV.doors.front;
    G.paT = (G.paT == null ? 2.5 : G.paT) - dt;
    if (G.paT <= 0 && G.phase !== 'escape') { const line = G.paN ? pick(HV.pa.slice(1)) : HV.pa[0]; if (voiceAt(line, null, 0, 'pa')) { G.paN = (G.paN || 0) + 1; G.paT = 70 + Math.random() * 40; } else G.paT = 3; return; }
    if (G.phase === 'grace' && K.carry !== false && KV.sackFull) {             // you can hear him in the sack, upstairs
      G.sackT = (G.sackT == null ? 7 : G.sackT) - dt;
      if (G.sackT <= 0) { G.sackT = 9 + Math.random() * 5; voiceAt(pick(HV.sack), [KV.x, KV.y, KV.z], 90, 'muffled'); }
      return;
    }
    if (b.state === 'hidden' && G.phase === 'hunt') {                          // calling out from inside the pot or hamper
      G.leoT = (G.leoT == null ? 18 : G.leoT) - dt;
      if (G.leoT <= 0) { G.leoT = 24 + Math.random() * 16; if (voiceAt(G.leoN ? pick(HV.leo) : HV.leo[0], [b.x, b.y, b.z], G.leoN ? 18 + 8 * G.clues : 70, 'muffled')) G.leoN = (G.leoN || 0) + 1; else G.leoT = 6; }
    }
    if (G.phase === 'escape' && b.state === 'follow' && !b.down) {
      G.escT = (G.escT == null ? 6 : G.escT) - dt;
      if (G.escT <= 0 && (K.state === 'chase' || K.state === 'rage')) { G.escT = 10 + Math.random() * 6; voiceAt(pick(HV.escape), null); }
    }
    G.glassT = (G.glassT == null ? 12 : G.glassT) - dt;                                           // the staff, through the glass
    if (G.glassT <= 0 && floorOf(P.y) === 0 && Math.hypot(P.x - fd.x, P.z - fd.z) < 7) { const line = pick(HV.glass), a = cast[line[0].toLowerCase()];
      if (a && voiceAt(line, [a.visible ? a.x : fd.x, 0, a.visible ? a.z : fd.z], 14)) G.glassT = 16 + Math.random() * 10; }
  }
  // the store at night: air handling, and wind through the smashed skylight. Only while you're playing.
  const AMB = { on: false, g: null };
  function ambTick() {
    if (!AC) return;
    const want = (mode === 'play' || mode === 'scare') && !muted ? 1 : 0;
    if (want && !AMB.g) {
      const g = AMB.g = AC.createGain(); g.gain.value = 0; g.connect(master);
      const mk = (type, freq, q, vol) => { const s = AC.createBufferSource(); if (!noiseBuf) noise(0.011, 0); s.buffer = noiseBuf; s.loop = true; const f = AC.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q; const v = AC.createGain(); v.gain.value = vol; s.connect(f); f.connect(v); v.connect(g); s.start(); return v; };
      mk('lowpass', 140, 0.7, 0.5);                                              // the building's hum
      const wind = mk('bandpass', 520, 0.8, 0.16), lfo = AC.createOscillator(), lg = AC.createGain(); lfo.frequency.value = 0.09; lg.gain.value = 0.12; lfo.connect(lg); lg.connect(wind.gain); lfo.start();
      AMB.hum = AC.createOscillator(); AMB.hum.frequency.value = 60; const hg = AC.createGain(); hg.gain.value = 0.025; AMB.hum.connect(hg); hg.connect(g); AMB.hum.start();
    }
    if (AMB.g) AMB.g.gain.setTargetAtTime(want * 0.3, AC.currentTime, want ? 1.2 : 0.3);
  }
  // phones pause web audio for calls, notifications and app switches. Start it again on the next touch or key.
  const audioKick = () => { if (AC && AC.state !== 'running' && AC.state !== 'closed') { try { AC.resume(); } catch (e) {} } };
  for (const ev of ['pointerdown', 'touchend', 'keydown']) window.addEventListener(ev, audioKick, true);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) audioKick(); });
  function yelp(vol = 0.3) { tone(880, 0.6, vol, 'sawtooth', 0, 300); tone(1100, 0.5, vol * 0.6, 'triangle', 0.05, 200); }
  function lockClick() { tone(1300, 0.04, 0.2, 'square'); thud(0.35, 0, 1500); tone(700, 0.06, 0.15, 'square', 0.06); }
  // "Jingle Bells" (public domain, 1857) on soft bells; the warp setting bends it down
  const MEL = [[64, 1], [64, 1], [64, 2], [64, 1], [64, 1], [64, 2], [64, 1], [67, 1], [60, 1.5], [62, 0.5], [64, 4], [65, 1], [65, 1], [65, 1.5], [65, 0.5], [65, 1], [64, 1], [64, 1], [64, 0.5], [64, 0.5], [64, 1], [62, 1], [62, 1], [64, 1], [62, 2], [67, 2],
    [64, 1], [64, 1], [64, 2], [64, 1], [64, 1], [64, 2], [64, 1], [67, 1], [60, 1.5], [62, 0.5], [64, 4], [65, 1], [65, 1], [65, 1.5], [65, 0.5], [65, 1], [64, 1], [64, 1], [64, 0.5], [64, 0.5], [67, 1], [67, 1], [65, 1], [62, 1], [60, 4]];
  const music = { on: false, next: 0, i: 0, warp: 1, vol: 0 };
  function musicTick() {
    if (!AC) return;
    musicGain.gain.value = muted || !music.on ? 0 : music.vol;
    if (!music.on) return;
    const spb = 60 / 132 / Math.max(0.35, music.warp);
    while (music.next < AC.currentTime + 0.3) {
      if (music.next < AC.currentTime) music.next = AC.currentTime + 0.02;
      const [n, b] = MEL[music.i % MEL.length], f = 440 * Math.pow(2, (n - 69) / 12) * music.warp, w = music.next - AC.currentTime;
      tone(f, 0.9, 0.5, 'sine', w, 0, 0, musicGain); tone(f * 2, 0.5, 0.18, 'sine', w, 0, 0, musicGain); tone(f * 3.01, 0.25, 0.08, 'sine', w, 0, 0, musicGain);
      if (music.i % 4 === 0) tone(f / 4, 0.6, 0.25, 'triangle', w, 0, 0, musicGain);
      music.next += b * spb; music.i++;
    }
  }
  function hear(x, z, y, range) {
    const d = Math.hypot(x - P.x, z - P.z), fall = floorOf(y) === floorOf(P.y) ? 1 : 0.5;
    const rel = Math.atan2(x - P.x, -(z - P.z)) - P.yaw;
    return [Math.pow(clamp(1 - d / range, 0, 1), 1.5) * fall, Math.sin(rel) * clamp(d / 3, 0, 1)];
  }

  // ---------------- text on screen ----------------
  let msgT = 0, subT = 0, FF = false;
  const EV = []; const ev = (k, t) => { if (debug) { EV.push([+NOW.toFixed(1), mode, k, t]); if (EV.length > 5000) EV.shift(); } };
  function showMsg(t, secs, cls) { ev(cls === 'krampus' ? 'KRAMPUS' : 'msg', t); $('msg').className = cls || ''; msgT = secs; $('msg').textContent = t; $('msg').style.opacity = 1; }
  function say(who, text, dur) {
    dur = dur || Math.max(2.2, text.length * 0.065);
    if (FF) return dur;
    if (text) ev('say', (who || '—') + ': ' + text);
    if (who && text) { const vd = speak(who, text); if (vd) dur = Math.max(dur, vd + 0.35); }
    $('sub').innerHTML = (who ? `<b>${who}</b>` : '') + `<span class="${who ? '' : 'nar'}">${text}</span>`; $('sub').style.opacity = text ? 1 : 0; subT = dur;
    const a = who && cast[who.toLowerCase()]; if (a) a.talkUntil = NOW + dur * 0.85;
    return dur;
  }
  const fmt = (t) => { t = Math.max(0, Math.floor(t)); return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0'); };
  const clockStr = (m) => { const h = Math.floor(m / 60), mi = Math.floor(m % 60); return `${h > 12 ? h - 12 : h}:${String(mi).padStart(2, '0')} PM`; };

  // ---------------- particles ----------------
  function spawn(p) { particles.push(Object.assign({ vx: 0, vy: 0, vz: 0, life: 2, size: 0.05, col: [1, 1, 1], mat: 0, spin: 0, rot: 0, floor: 0, kind: 'cube', g: 9.8 }, p)); return particles[particles.length - 1]; }
  function burstGlass(x, y, z, n, spread, up = 1) { for (let i = 0; i < n; i++) { const px = x + (Math.random() - 0.5) * spread, pz = z + (Math.random() - 0.5) * spread; spawn({ x: px, y, z: pz, vx: (Math.random() - 0.5) * 3, vy: up * Math.random() * 2 - 1, vz: (Math.random() - 0.5) * 3, life: 8 + Math.random() * 6, size: 0.05 + Math.random() * 0.09, col: [0.75, 0.86, 0.95], mat: MAT.GLOW, spin: (Math.random() - 0.5) * 20, kind: 'shard', floor: px > 24 && px < 40 && pz > 12 && pz < 28 ? 0 : (y > F1 ? F1 : 0) }); } }
  function burstOrnaments(x, y, z, n) { const C = PAL.orn.map(hex); for (let i = 0; i < n; i++) { const a = Math.random() * TAU, s = 2 + Math.random() * 5; spawn({ x, y, z, vx: Math.cos(a) * s, vy: 2 + Math.random() * 4, vz: Math.sin(a) * s, life: 10 + Math.random() * 5, size: 0.08 + Math.random() * 0.08, col: C[i % C.length], mat: MAT.CERAMIC, kind: 'orb', floor: 0 }); } }
  function burstPlates(x, y, z, n) { for (let i = 0; i < n; i++) { const a = Math.random() * TAU, s = 1 + Math.random() * 3; spawn({ x, y, z, vx: Math.cos(a) * s, vy: 1 + Math.random() * 3, vz: Math.sin(a) * s, life: 5, size: 0.08 + Math.random() * 0.08, col: [0.95, 0.94, 0.9], mat: MAT.CERAMIC, spin: (Math.random() - 0.5) * 15, kind: 'shard', floor: surfaceY(x, z, y) }); } }
  function stepParticles(dt) {
    for (const p of particles) {
      p.life -= dt;
      if (p.kind === 'snow') { p.x += p.vx * dt + Math.sin(NOW * 1.3 + p.rot) * 0.15 * dt; p.y += p.vy * dt; p.z += p.vz * dt; if (p.y < p.floor) p.life = 0; continue; }
      p.vy -= p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; p.rot += p.spin * dt;
      if (p.y < p.floor + p.size * 0.3) { p.y = p.floor + p.size * 0.3; p.vy *= -0.25; p.vx *= 0.55; p.vz *= 0.55; p.spin *= 0.5; }
    }
    particles = particles.filter((p) => p.life > 0);
    if (particles.length > 1400) particles.splice(0, particles.length - 1400);
  }
  let snowT = 0;
  function snowAround(ex, ez, dt, rate) {
    snowT += dt * rate;
    while (snowT > 1) { snowT -= 1; const x = ex + (Math.random() - 0.5) * 30, z = ez + (Math.random() - 0.5) * 30; if (z > -0.3 && x < 64.3 && !(SKY.broken && Math.hypot(x - 32, z - 20) < 4.2)) continue; spawn({ kind: 'snow', x, y: z > -0.3 && x < 64.3 ? 9.4 : 5 + Math.random() * 3, z, vx: 0.2, vy: -0.8 - Math.random() * 0.5, vz: 0.1, life: 14, size: 0.025 + Math.random() * 0.02, col: [0.8, 0.85, 0.95], mat: MAT.GLOW, rot: Math.random() * 9, floor: 0 }); }
  }

  // ---------------- lights for this frame ----------------
  function pickLights(eye) {
    const c = [];
    for (const l of LV.lights) {
      if (l.off) continue;
      const zl = l.zone < 0 ? 1 : ZL[l.zone] * ambDim, i = l.i * (zl < 0.3 ? 0.06 : zl);
      if (i < 0.03) continue;
      const d = Math.hypot(l.x - eye[0], l.y - eye[1], l.z - eye[2]);
      if (d - l.r > 18) continue;
      c.push({ x: l.x, y: l.y, z: l.z, r: l.r, c: l.c, i, d: d - l.r * 0.35 });
    }
    if (CAR.lights) for (const s of [-1, 1]) { const cs = Math.cos(CAR.yaw), sn = Math.sin(CAR.yaw), lx = s * 0.6, lz = -2.9; c.push({ x: CAR.x + lx * cs + lz * sn, y: 0.9, z: CAR.z - lx * sn + lz * cs, r: 11, c: [1, 0.95, 0.82], i: 1.0, d: 0 }); }
    if (KV.visible && KV._eye) c.push({ x: KV._eye[0], y: KV._eye[1], z: KV._eye[2], r: 1.6, c: [1, 0.55, 0.15], i: 0.6, d: Math.hypot(KV.x - eye[0], KV.z - eye[2]) - 2 });
    c.sort((a, b) => a.d - b.d);
    return c.slice(0, R.NL);
  }

  // ---------------- dynamic props ----------------
  const blobMesh = mesh('blob', (g) => { for (const r of [1, 0.72, 0.45]) g.lathe(0, 0, 0, [[0, 0.001], [r, 0.001]], [0.82, 0.82, 0.84], 0, 18); });
  const cubeMesh = mesh('cube', (g) => g.box(0, -0.5, 0, 1, 1, 1, 0, [1, 1, 1]));
  const orbMesh = mesh('orb', (g) => g.ellipsoid(0, 0, 0, 0.5, 0.5, 0.5, [1, 1, 1], 0, 6, 4));
  const dispMesh = mesh('disp', (g) => {
    const r = mulberry32(9), C = PAL.orn.map(hex);
    for (let t = 0; t < 3; t++) { g.rbox(0, t * 0.42, 0, 2.6 - t * 0.6, 0.42, 1.2 - t * 0.3, 0, hex('#f2f0ea'), MAT.GRAIN, 0.02); for (let i = 0; i < 22 - t * 6; i++) g.sphere((r() - 0.5) * (2.4 - t * 0.6), t * 0.42 + 0.48, (r() - 0.5) * (1.0 - t * 0.3), 0.06 + r() * 0.04, C[(r() * C.length) | 0], MAT.CERAMIC, 8); }
    g.rbox(0, 1.26, 0, 0.3, 0.6, 0.3, 0, hex('#c9a24b'), MAT.METAL, 0.03);
  });
  const dispBroken = mesh('dispB', (g) => {
    const r = mulberry32(11), C = PAL.orn.map(hex);
    g.push(A.Rz(0.35)); g.rbox(0.3, 0, 0, 2.4, 0.3, 1.1, 0, hex('#e6e2d8'), MAT.GRAIN, 0.02); g.pop();
    g.push(A.chain(A.T(-0.6, 0.1, 0.4), A.Ry(0.8), A.Rz(-0.5))); g.rbox(0, 0, 0, 1.5, 0.25, 0.8, 0, hex('#e6e2d8'), MAT.GRAIN, 0.02); g.pop();
    g.push(A.chain(A.T(0.7, 0.15, -0.6), A.Ry(-0.4), A.Rx(0.6))); g.rbox(0, 0, 0, 1.0, 0.2, 0.6, 0, hex('#e6e2d8'), MAT.GRAIN, 0.02); g.pop();
    for (let i = 0; i < 70; i++) { const a = r() * TAU, d = r() * 3.2; g.sphere(Math.cos(a) * d, 0.05, Math.sin(a) * d, 0.04 + r() * 0.04, C[(r() * C.length) | 0], MAT.CERAMIC, 6); }
    for (let i = 0; i < 90; i++) { const a = r() * TAU, d = r() * 4; g.box(Math.cos(a) * d, 0.004, Math.sin(a) * d, 0.04 + r() * 0.12, 0.008, 0.03 + r() * 0.08, r() * 3, hex('#cfe0ea'), MAT.GLOW); }
  });
  const skyRibs = mesh('skyRibs', (g) => { for (let i = 0; i < 8; i++) { g.push(A.Ry(i * TAU / 8)); g.tube([[0, 0.45, 0], [0, 0.38, 1.8], [0, 0.22, 3.2], [0, 0, 4.3]], 0.05, hex('#f2f0ea'), MAT.METAL, 5, false); g.pop(); } });
  const skyBrokenRibs = mesh('skyBroken', (g) => { for (const i of [0, 3, 5]) { g.push(A.Ry(i * TAU / 8)); g.tube([[0, 0, 4.3], [0, 0.2, 3.4], [0.3, -0.6, 2.8]], 0.05, hex('#f2f0ea'), MAT.METAL, 5, false); g.pop(); } });
  const skyGlass = mesh('skyGlass', (g) => g.lathe(0, 0, 0, [[4.3, 0, 1], [3.2, 0.22], [1.6, 0.38], [0, 0.45]], hex('#9fb8c8'), MAT.GLASS, 32));
  const skyShards = mesh('skyShards', (g) => { const r = mulberry32(4); for (let i = 0; i < 28; i++) { const a = i / 28 * TAU + r() * 0.1, w = 0.3 + r() * 0.5; g.push(A.chain(A.Ry(-a), A.T(0, 0.02, 4.0 - r() * 0.3), A.Rx(-0.2 + r() * 0.3))); g.box(0, 0, 0, w, 0.01, 0.3 + r() * 0.7, r() - 0.5, hex('#9fb8c8'), MAT.GLASS); g.pop(); } });

  function drawDoor(buf, abuf, d, open) {
    const W = d.w, M = A.mul(A.T(d.cx, 0, d.cz), A.Ry(d.yaw)), frameC = hex('#8d9399'), glass = hex('#9fb8c8');
    const g = new Geo(), ga = new Geo();
    for (const s of [-1, 1]) {
      const lx = s * (W / 4 + open * W * 0.46), lw = W / 2 - 0.04;
      g.push(A.mul(M, A.T(lx, 0, 0.0)));
      g.box(0, 0, 0, lw, 0.1, 0.06, 0, frameC, MAT.METAL); g.box(0, 3.1, 0, lw, 0.1, 0.06, 0, frameC, MAT.METAL);
      g.box(-lw / 2 + 0.03, 0, 0, 0.06, 3.2, 0.06, 0, frameC, MAT.METAL); g.box(lw / 2 - 0.03, 0, 0, 0.06, 3.2, 0.06, 0, frameC, MAT.METAL);
      g.box(-s * (lw / 2 - 0.12), 0.9, -0.05, 0.035, 1.3, 0.035, 0, hex('#c9ccd0'), MAT.METAL); g.box(-s * (lw / 2 - 0.12), 0.9, 0.05, 0.035, 1.3, 0.035, 0, hex('#c9ccd0'), MAT.METAL);
      g.pop();
      ga.push(A.mul(M, A.T(lx, 0, 0))); ga.box(0, 0.1, 0, lw - 0.1, 3.0, 0.02, 0, glass, MAT.GLASS); ga.pop();
    }
    buf.addGeo(g); abuf.addGeo(ga);
    const o = LV.obbs[d.obb]; if (o) o.off = open > 0.4;
  }
  function drawClock(buf) {
    const c = LV.clock, m = storeClock, g = new Geo();
    for (const [ang, len, w] of [[((m / 60) % 12) / 12 * TAU, 0.17, 0.03], [(m % 60) / 60 * TAU, 0.25, 0.02]]) { g.push(A.chain(A.T(c.x, c.y, c.z), A.Rx(ang))); g.box(-0.01, -0.02, 0, 0.012, len, w, 0, hex('#1a1a1a')); g.pop(); }
    g.sphere(c.x - 0.02, c.y, c.z, 0.018, hex('#9e2f37'), 0, 6);
    buf.addGeo(g);
  }

  // ---------------- actors moving ----------------
  function goA(a, pts, speed = 1.3) { a.path = pts.map((p) => [p[0], p[1]]); a.pi = 0; a.speed = speed; a.arrived = false; a.anim = speed > 2.5 ? 'run' : 'walk'; return () => a.arrived; }
  function goRoute(a, x, z, f, speed = 1.3) { const p = routeY(a.x, a.z, a.y || 0, x, z, f); if (p) return goA(a, p.slice(1).map((q) => [q[0], q[1]]).concat([[x, z]]), speed); return goA(a, [[x, z]], speed); }
  function stepActor(a, dt) {
    if (a.path && a.pi < a.path.length) {
      const [tx, tz] = a.path[a.pi], dx = tx - a.x, dz = tz - a.z, d = Math.hypot(dx, dz);
      if (d < 0.04) { a.pi++; if (a.pi >= a.path.length) { a.path = null; a.arrived = true; a.anim = a.after || 'idle'; a.after = null; } return; }
      const m = Math.min(d, a.speed * dt); a.x += dx / d * m; a.z += dz / d * m;
      a.yaw = turnTo(a.yaw, Math.atan2(dx, -dz), dt * 9);
      a.anim = a.speed > 2.5 ? 'run' : 'walk';
      a.phase += m / (ACT.dims(a.id).legs * (a.anim === 'run' ? 1.5 : 1.25)) * Math.PI;
      a.y = surfaceY(a.x, a.z, a.y);
    } else if (a.faceYaw != null) a.yaw = turnTo(a.yaw, a.faceYaw, dt * 6);
  }
  const gest = (a, name, dur) => { a.gest = { name, t0: NOW, dur }; };
  function placeA(a, x, z, yaw, extra) {
    Object.assign(a, { x, z, yaw, path: null, anim: 'idle', visible: true, gest: null, look: null, faceYaw: null, holdR: null, holdL: null, holdHand: null, face: {}, sitH: null, after: null, arrived: false, noBlink: false, still: false, owl: false, creep: 0, post: null }, extra || {});
    a.y = extra && extra.y != null ? extra.y : surfaceY(x, z, 0);
  }
  function hideAll() { for (const k in cast) cast[k].visible = false; KV.visible = false; }

  // ---------------- camera ----------------
  const cam = { pos: [0, 1.6, 0], look: [0, 1.6, -1], fov: 1.15, shake: 0, shot: null };
  function cut(pos, lookAt, fov = 1.0) { cam.shot = { type: 'fixed', pos, look: lookAt, fov }; }
  function move(p0, l0, p1, l1, dur, fov = 1.0, fov1 = null) { cam.shot = { type: 'move', p0, l0, p1, l1, t0: NOW, dur, fov, fov1: fov1 == null ? fov : fov1 }; }
  function follow(fn, fov = 1.0) { cam.shot = { type: 'follow', fn, fov, cur: null }; }
  function camUpdate(dt) {
    const s = cam.shot; if (!s) return;
    if (s.type === 'fixed') { cam.pos = s.pos.slice(); cam.look = s.look.slice(); cam.fov = s.fov; }
    else if (s.type === 'move') { const u = smooth((NOW - s.t0) / s.dur); for (let i = 0; i < 3; i++) { cam.pos[i] = lerp(s.p0[i], s.p1[i], u); cam.look[i] = lerp(s.l0[i], s.l1[i], u); } cam.fov = lerp(s.fov, s.fov1, u); }
    else if (s.type === 'follow') { const [p, l] = s.fn(); if (!s.cur) s.cur = [p.slice(), l.slice()]; const k = Math.min(1, dt * 3.5); for (let i = 0; i < 3; i++) { s.cur[0][i] = lerp(s.cur[0][i], p[i], k); s.cur[1][i] = lerp(s.cur[1][i], l[i], k); } cam.pos = s.cur[0].slice(); cam.look = s.cur[1].slice(); cam.fov = s.fov; }
    cam.shake = Math.max(0, cam.shake - dt * 1.5);
  }

  // ---------------- cutscene runner (generators) ----------------
  let SC = null;
  function runScene(genFn, done) {
    SC = { main: { g: genFn(), wait: 0, until: null }, par: [], done };
    mode = 'cine'; document.body.classList.add('cine'); $('hud').style.display = 'none'; $('skipBtn').style.display = 'block';
    if (document.pointerLockElement) document.exitPointerLock();
  }
  const par = (genFn) => { SC.par.push({ g: genFn(), wait: 0, until: null }); };
  function stepGen(task, dt) {
    if (task.wait > 0) { task.wait -= dt; if (task.wait > 0) return true; }
    if (task.until) { if (!task.until()) return true; task.until = null; }
    for (let guard = 0; guard < 50; guard++) {
      const r = task.g.next(); if (r.done) return false;
      const v = r.value;
      if (typeof v === 'number') { task.wait = v; return true; }
      if (typeof v === 'function') { if (!v()) { task.until = v; return true; } }
    }
    return true;
  }
  function sceneTick(dt) {
    if (!SC) return;
    const sc = SC;
    const alive = stepGen(sc.main, dt);
    sc.par = sc.par.filter((t) => stepGen(t, dt));
    if (!alive && SC === sc) { SC = null; document.body.classList.remove('cine'); $('skipBtn').style.display = 'none'; $('sub').style.opacity = 0; $('titlecard').style.opacity = 0; if (sc.done) sc.done(); }
  }
  function skipScene() {
    if (!SC || FF) return;
    FF = true; muted = true; hush(); const sc = SC;
    try { for (let i = 0; i < 6000 && SC === sc; i++) { NOW += 0.1; sceneTick(0.1); for (const k in cast) stepActor(cast[k], 0.1); } }
    finally { FF = false; muted = false; } $('fade').style.transition = 'none'; $('fade').style.opacity = 0; timeScale = 1;
  }
  function fadeTo(v, dur) { $('fade').style.transition = FF ? 'none' : `opacity ${dur}s`; $('fade').style.opacity = v; return FF ? 0 : dur; }

  // ---------------- round setup (hunt) ----------------
  function newRound() {
    timers.length = 0;   // nothing left over from a cutscene or the last round
    const D = DIFF[diffKey];
    Object.assign(P, { x: 32, y: 0, z: 3.6, yaw: Math.PI, pitch: 0.05, vx: 0, vz: 0, crouch: false, ct: 0, run: false });
    const up = LV.containers.map((c, i) => i).filter((i) => LV.containers[i].f === 1);
    const broC = up[(Math.random() * up.length) | 0], bc = LV.containers[broC];
    const items = [];
    shuffle(LV.clueSpots.slice()).slice(0, 3).forEach(([f, x, z], i) => { const [nx, nz] = nodePos(rNode(f, x, z)); items.push({ kind: 'clue', n: i, x: nx, z: nz, y: f ? F1 : 0, f, taken: false }); });
    const [kf, kx, kz, kh] = LV.keySpots[(Math.random() * LV.keySpots.length) | 0];
    items.push({ kind: 'keys', x: kx, z: kz, y: (kf ? F1 : 0) + kh, f: kf, taken: false });
    const traps = shuffle(LV.trapSpots.map(([f, x, z, ax, len]) => ({ f, x, z, ax, len, on: false, cool: 0 })));
    for (let i = 0; i < D.traps; i++) traps[i].on = true;
    K = { x: -50, z: -50, y: -50, yaw: 0, state: 'wait', path: null, pi: 0, t: 0, look: 0, step: 0, stuck: 0, lastP: [0, 0], seeing: false, lastSeen: null, searchLeft: 0, repath: 0, spd: 0, sawT: 99, stun: 0 };
    G = { hearCool: 8, peerCool: 25, peerAt: 0, D, phase: 'grace', t: D.grace, time: 0, huntT: 0, clues: 0, keys: false, items, traps, broC, bro: { state: 'hidden', x: bc.x, z: bc.z, y: bc.y }, trail: [], hiding: null, back: null,
      alert: 0, noiseT: 0, hunchT: 30, lightT: 70, cryT: 2, doorT: 7, lingerT: 0, knockCool: 0, tipT: 5, tips: {}, breathT: 0, sightings: 0, hides: 0, slips: D.slips, micStrikes: diffKey === 'easy' ? 2 : diffKey === 'normal' ? 1 : 0, micCool: 0, dead: shuffle([0, 1, 2, 4, 5, 6, 7, 8, 9, 10, 12, 13, 14, 15]), reason: '', extraStun: 0 };
    hideAll();
    const fd = LV.doors.front, sd = LV.doors.side;
    // the staff wait outside, at the glass. More of them come to watch with every clue you find.
    placeA(cast.marcus, fd.x + 0.7, -0.62, Math.PI); placeA(cast.dana, 64.62, sd.z + 0.25, -Math.PI / 2);
    placeA(cast.priya, fd.x - 0.9, -0.62, Math.PI); placeA(cast.manager, fd.x - 0.1, -1.7, Math.PI); cast.priya.visible = cast.manager.visible = false;
    for (const k of STAFF) { const a = cast[k]; setCreep(a, 3); maw(a, 1); a.mawMax = 0.3; a.gest = { name: k === 'manager' ? 'fold' : 'glass', t0: NOW }; }   // at the glass: teeth showing. They open wider the closer you come.
    DOORS.front = DOORS.side = 0; SKY.broken = true; DISPLAY.smashed = true; CAR.visible = true; CAR.lights = false; CAR.inside = false; CAR.x = 36.5; CAR.z = -7.5; CAR.yaw = Math.PI + 0.25;
    for (const l of LV.lights) l.off = false;
    for (let i = 0; i < 16; i++) ZT[i] = Math.min(ZT[i], 0.8);
    music.on = false; timeScale = 1; ambDim = 1;
  }
  const level = () => Math.min(5, G.clues + Math.floor(G.huntT / 100));
  function startHunt() {
    newRound(); mode = 'play'; $('hud').style.display = 'block'; document.body.classList.remove('explore'); lastTime = performance.now(); lock();
    showMsg('It took Leo upstairs. Find him.', 4); jingle(0.3, 0, 8); $('sub').style.opacity = 0; subT = 0;
    $('ears').style.display = 'block';
  }

  // ---------------- interact ----------------
  function nearContainer() {
    let best = -1, bd = 1.5;
    LV.containers.forEach((c, i) => { if (c.f !== floorOf(P.y)) return; const d = Math.hypot(c.x - P.x, c.z - P.z); if (d < bd) { bd = d; best = i; } });
    return best;
  }
  function interact() {
    if (mode === 'explore') return exploreInteract();
    if (mode !== 'play') return;
    if (G.hiding != null) { if (K.state === 'peer') return caught('You moved. He was looking right at you.'); [P.x, P.z] = G.back; G.hiding = null; G.seenHide = false; return; }
    const i = nearContainer(); if (i < 0) return;
    if (G.bro.state === 'hidden' && i === G.broC) return rescue();
    if (G.phase === 'escape') { showMsg('No time to hide. RUN!', 1.5); return; }
    G.seenHide = K.state === 'chase' && (K.seeing || K.sawT < 1.5);
    if (G.seenHide) { K.lastSeen = [LV.containers[i].x, LV.containers[i].z, LV.containers[i].f]; K.repath = 0; showMsg('He saw you climb in! Get out and RUN!', 3); }
    G.hiding = i; G.back = [P.x, P.z]; G.hides++;
    P.x = LV.containers[i].x; P.z = LV.containers[i].z; P.vx = P.vz = 0;
    if (G.bro.state === 'hidden') showMsg('Empty. You climb in.', 1.6);
  }
  function rescue() {
    const L = cast.leo, c = LV.containers[G.broC];
    placeA(L, c.x + 0.6, c.z, P.yaw, { y: P.y, face: { eyes: 'wide', mouth: 'o', brows: 'sad' } });
    G.bro = { state: 'follow', x: L.x, z: L.z, y: L.y }; G.phase = 'escape'; G.trail = []; P.crouch = false;
    G.udist = upstairsDist(); K.path = null; K.lastP = [K.x, K.z]; K.hold = 0;
    K.state = 'rage'; K.stun = 2.4; K.repath = 0;
    for (let i = 0; i < 16; i++) ZT[i] = Math.max(ZT[i], 0.5);
    roar(); boxSmash();
    showMsg(G.keys ? 'RUN — front doors!' : 'RUN — but you still need the keys!', 4); voiceUntil = 0; later(1.2, () => { voiceUntil = 0; voiceAt(HV.rescue[0], null); });
  }

  // ---------------- Krampus (hunt AI) ----------------
  function goTo(x, z, f) { const p = routeY(K.x, K.z, K.y, x, z, f); if (p && p.length) { K.path = p; K.pi = 1; return true; } K.path = null; return false; }
  function pickPatrol() {
    let n = (Math.random() < 0.7 && SPOTS.length) ? SPOTS[(Math.random() * SPOTS.length) | 0] : REACH[(Math.random() * REACH.length) | 0];
    if (G.clues >= 3) for (let i = 0; i < 30 && n < GN; i++) n = REACH[(Math.random() * REACH.length) | 0];   // all three found: he keeps to the upstairs, near his prize
    const [x, z, f] = nodePos(n); K.state = 'patrol';
    if (!goTo(x, z, f)) { K.state = 'look'; K.t = 0.5; K.look = K.yaw; }
  }
  function dropKrampus() {
    let best = null, bd = -1;
    for (let i = 0; i < 40; i++) {
      const n = REACH[(Math.random() * REACH.length) | 0], [x, z, f] = nodePos(n);
      if (f !== 1) continue;
      const bc = LV.containers[G.broC], d = Math.min(Math.hypot(x - P.x, z - P.z) + (floorOf(P.y) !== 1 ? 10 : 0), Math.hypot(x - bc.x, z - bc.z) * 2);
      if (d > bd) { bd = d; best = [x, z]; }
    }
    K.x = best[0]; K.z = best[1]; K.y = F1; K.lastP = [K.x, K.z];
  }
  function canSee() {
    if (G.hiding != null) return 0;
    let range = (G.D.range + 2 * level()) * (ZL[lightZone(P.x, P.z, floorOf(P.y))] < 0.5 ? 0.7 : 1);
    if (K.state === 'chase') range = Math.min(range, G.D.lose);   // outrun him by this much and he loses you
    const ex = K.x, ey = K.y + 2.4 * KS / 1.1, ez = K.z, eye = P.y + EYE(), body = P.y + lerp(0.7, 0.3, P.ct);
    const dx = P.x - ex, dz = P.z - ez, dy = eye - ey, d = Math.hypot(dx, dz, dy * 0.6);
    if (d > range) return 0;
    if (d > 1.8) { const fx = Math.sin(K.yaw), fz = -Math.cos(K.yaw); if ((dx * fx + dz * fz) / Math.max(0.001, Math.hypot(dx, dz)) < Math.cos(55 * Math.PI / 180)) return 0; }
    if (WORLD.clear(ex, ey, ez, P.x, eye + 0.06, P.z) || WORLD.clear(ex, ey, ez, P.x, body, P.z)) return [d, range];
    return 0;
  }
  function investigate(x, z, f, fast) {
    if (K.state === 'chase' || K.state === 'rage' || K.state === 'wait') return;
    K.state = fast ? 'rush' : 'investigate';
    if (!goTo(x + (Math.random() - 0.5) * 2, z + (Math.random() - 0.5) * 2, f)) goTo(x, z, f);
  }
  // ---------- the microphone (optional): he hears the room you are playing in ----------
  // Only loudness is measured, a few times a second; nothing is recorded, stored or sent anywhere.
  const MIC = { on: false, ok: false, err: '', stream: null, an: null, buf: null, outAn: null, outBuf: null, floor: -60, cal: 0, level: 0, hot: 0, db: -100 };
  try { MIC.on = localStorage.getItem('box-mic') === '1'; } catch (e) {}
  async function micStart() {
    if (MIC.ok) return true;
    audioInit(); if (!AC) { MIC.err = 'No audio on this device.'; return false; }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { MIC.err = 'This page can’t use the microphone here. Try the GitHub link in Chrome, Edge or Safari.'; return false; }
    try {
      MIC.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: false } });
      const src = AC.createMediaStreamSource(MIC.stream); MIC.an = AC.createAnalyser(); MIC.an.fftSize = 1024; src.connect(MIC.an); MIC.buf = new Float32Array(MIC.an.fftSize);
      MIC.outAn = AC.createAnalyser(); MIC.outAn.fftSize = 1024; master.connect(MIC.outAn); MIC.outBuf = new Float32Array(MIC.outAn.fftSize);   // the game's own sound, to tell it apart
      MIC.ok = true; MIC.err = ''; MIC.cal = 2.0; return true;
    } catch (e) { MIC.err = /denied|NotAllowed/i.test(String(e && (e.name || e))) ? 'Microphone blocked. Allow it for this site in the browser’s address bar, then try again.' : 'Couldn’t open a microphone (' + (e && e.name || 'error') + ').'; return false; }
  }
  // "I can hear you" when he really did: always said, but never over the top of a line he's still saying
  function sayHeard(vol) { const wait = Math.max(0, kSaidAt + 3.4 - NOW); later(wait, () => { if (mode === 'play') { kSaidAt = -99; krampusSay('I can hear you', vol); } }); }
  function micStop() { if (MIC.stream) for (const t of MIC.stream.getTracks()) t.stop(); MIC.stream = null; MIC.ok = false; MIC.level = 0; }
  const rmsDb = (an, buf) => { an.getFloatTimeDomainData(buf); let s2 = 0; for (let i = 0; i < buf.length; i++) s2 += buf[i] * buf[i]; return 10 * Math.log10(s2 / buf.length + 1e-12); };
  // 0..1: how loud you are right now above your room's normal background
  function micTick(dt) {
    if (window.__micTest != null) { MIC.level = window.__micTest; return MIC.level; }
    if (!MIC.on || !MIC.ok) { MIC.level = 0; return 0; }
    const db = rmsDb(MIC.an, MIC.buf), game = rmsDb(MIC.outAn, MIC.outBuf); MIC.db = db;
    if (MIC.cal > 0) { MIC.cal -= dt; MIC.floor = MIC.cal > 1.6 ? db : Math.min(MIC.floor, db) * 0.7 + db * 0.3; MIC.level = 0; return 0; }   // first two seconds: learn the room
    MIC.floor = db < MIC.floor ? lerp(MIC.floor, db, Math.min(1, dt * 2)) : MIC.floor + Math.min(db - MIC.floor, 6) * dt * 0.03;            // background drifts up slowly, down quickly
    const margin = 11 + Math.max(0, game + 32) * 0.75;   // loud game sound coming through speakers raises the bar (headphones are best)
    const lv = clamp((db - MIC.floor - margin) / 24, 0, 1);
    MIC.level = lv > MIC.level ? lerp(MIC.level, lv, Math.min(1, dt * 14)) : lerp(MIC.level, lv, Math.min(1, dt * 3));
    return MIC.level;
  }
  // he hears your real voice: a whisper carries a few metres, talking across a department, a scream across the floor
  function micHear(dt) {
    const L = micTick(dt); MIC.hot = L > 0.08 ? MIC.hot + dt : 0; G.micCool = (G.micCool || 0) - dt;
    const el = $('mic'); if (el) { el.style.display = MIC.on && (MIC.ok || window.__micTest != null) ? 'flex' : 'none'; $('micFill').style.width = Math.round(L * 100) + '%'; el.classList.toggle('loud', L > 0.08); }
    if (G.phase === 'grace' || MIC.hot < 0.12 || K.state === 'wait') return;
    const f = floorOf(P.y), r = (4 + 30 * L) * (floorOf(K.y) === f ? 1 : 0.45), dK = Math.hypot(K.x - P.x, K.z - P.z);
    if (dK > r || K.state === 'rage') return;
    if (K.state === 'peer') {   // he is right there, staring in
      if (G.micStrikes > 0 && G.micCool <= 0) { G.micStrikes--; G.micCool = 2.5; kSaidAt = -99; krampusSay('I can hear you', 1); K.peerDur += 8; FEAR = 1; cam.shake = 0.4; showMsg('He heard that. Not a sound.', 2.4, 'tip'); }
      else if (G.micCool <= 0) caught('He heard you breathing.');
      return;
    }
    if (G.micCool > 0) return;
    G.micCool = 4; G.micHeard = (G.micHeard || 0) + 1;
    if (G.hiding != null) { const c = LV.containers[G.hiding]; sayHeard(clamp(1.3 - dK / 20, 0.35, 1)); if (goTo(c.x, c.z, c.f)) K.state = 'peerwalk'; G.peerCool = 0; }
    else if (K.state !== 'chase') { sayHeard(clamp(1.3 - dK / 20, 0.35, 1)); investigate(P.x, P.z, f, L > 0.4); }
  }

  function hearNoise(x, z, f, radius) { let r = floorOf(K.y) === f ? radius : radius * 0.45; if (K.state === 'look' && K.listen) r *= 1.7; /* standing dead still, bells silent, listening */ if (Math.hypot(K.x - x, K.z - z) < r) { investigate(x, z, f, false); if (radius >= 10 && Math.hypot(K.x - x, K.z - z) < 20 && NOW - (G.heardSaid || -99) > 25) { G.heardSaid = NOW; krampusSay('I can hear you', clamp(1.3 - Math.hypot(K.x - x, K.z - z) / 20, 0.35, 1)); } } }
  // While you hide: he says "I can hear you", and sometimes walks over, bends down and stares into the
  // opening for about half a minute. Hold still and he leaves. Climb out and he has you.
  function startPeer(c) { K.state = 'peer'; K.path = null; K.peerT = 0; K.peerDur = 27 + Math.random() * 6; K.breathT = 0.5; KV.gest = { name: 'peer', t0: NOW }; G.peerLook = 2.4; G.peerCool = 80; showMsg('Don\u2019t move.', 2.6); }
  function hideTick(dt, dP, sameFloor) {
    const c = G.hiding != null ? LV.containers[G.hiding] : null;
    G.hearCool -= dt; G.peerCool -= dt; if (K.state !== 'peer') PEEK = Math.max(0, PEEK - dt * 1.5);
    if (K.state === 'peerwalk') {
      if (!c) { K.state = 'search'; K.t = 1.5; K.look = K.yaw; K.searchLeft = 1; K.lastSeen = [K.x, K.z, floorOf(K.y)]; return false; }
      if (sameFloor && (Math.hypot(c.x - K.x, c.z - K.z) < 1.5 || !K.path || K.pi >= K.path.length)) { if (Math.hypot(c.x - K.x, c.z - K.z) < 3) startPeer(c); else pickPatrol(); }
      return false;
    }
    if (K.state === 'peer') {
      if (!c) { caught('You moved. He was looking right at you.'); return true; }
      K.peerT += dt; K.spd = 0; PEEK = Math.min(1, PEEK + dt * 1.2);
      // settle one step back from the rim, facing it
      const dx = K.x - c.x, dz = K.z - c.z, d = Math.hypot(dx, dz) || 1, k = Math.min(1, dt * 2);
      K.x += (c.x + dx / d * 1.3 - K.x) * k; K.z += (c.z + dz / d * 1.3 - K.z) * k;
      K.yaw = turnTo(K.yaw, Math.atan2(c.x - K.x, -(c.z - K.z)), dt * 4);
      K.breathT -= dt; if (K.breathT <= 0) { K.breathT = 2.1 + Math.random() * 0.8; breath(0.3, 0); }
      if (G.peerLook > 0 && KV._eye) { G.peerLook -= dt; const e = KV._eye, ey = P.y + EYE(); P.yaw = turnTo(P.yaw, Math.atan2(e[0] - P.x, -(e[2] - P.z)), dt * 2.5); P.pitch = lerp(P.pitch, clamp(Math.atan2(e[1] - ey, Math.hypot(e[0] - P.x, e[2] - P.z)), -1.3, 1.3), Math.min(1, dt * 3)); }
      if (K.peerT > 9 && !K.peerSaid) { K.peerSaid = true; krampusSay('I can smell you, little one', 1); }
      if (K.peerT > K.peerDur) { KV.gest = null; K.peerSaid = false; K.state = 'look'; K.t = 2.6; K.look = K.yaw + 2.4; G.alert = 0; showMsg('He’s leaving. Wait for the bells to fade.', 3, 'tip'); }
      // the stare was staged for his old size, so he swells as he bends over the opening (all you can see is the face)
      Object.assign(KV, { x: K.x, y: K.y, z: K.z, yaw: K.yaw, visible: true, anim: 'idle', scale: lerp(KS, 1.1, smooth(K.peerT / 0.8)), sackFull: false, look: null });
      return true;
    }
    if (c && sameFloor && K.state !== 'chase' && K.state !== 'rush') {
      if (dP < 13 && G.hearCool <= 0 && NOW - kSaidAt > 8) {
        G.hearCool = 40 + Math.random() * 20; krampusSay('I can smell you, little one', clamp(1.25 - dP / 13, 0.3, 1));
        if (G.peerCool <= 0 && Math.random() < 0.7) G.peerAt = NOW + 2.5;
      }
      if (G.peerAt && NOW > G.peerAt) { G.peerAt = 0; if (goTo(c.x, c.z, c.f)) K.state = 'peerwalk'; }
    } else if (!c) G.peerAt = 0;
    return false;
  }
  let smashT = 0;
  function updateKrampus(dt) {
    const D = G.D, mult = D.spd * (1 + 0.04 * Math.min(4, level()));
    if (K.state === 'wait') {
      // while you get your bearings he crosses the upstairs with the sack, heading for wherever he will hide Leo
      const el = D.grace - G.t;
      if (el > 2 && G.t > 5) {
        if (!K.carry) { const bc = LV.containers[G.broC]; K.carry = route(31, 30.5, 1, bc.x, bc.z, 1) || [[31, 30.5, 1]]; K.ci = 1; K.x = 31; K.z = 30.5; K.y = F1; K.step = 0; }
        const bc = LV.containers[G.broC], left = Math.hypot(bc.x - K.x, bc.z - K.z);
        if (left > 3.2 && K.ci < K.carry.length) {
          const [tx, tz] = K.carry[K.ci], dx = tx - K.x, dz = tz - K.z, d = Math.hypot(dx, dz), m = Math.min(d, 2.5 * dt);
          if (d < 0.1) K.ci++; else { K.x += dx / d * m; K.z += dz / d * m; K.yaw = turnTo(K.yaw, Math.atan2(dx, -dz), dt * 6); }
          const before = K.step; K.step += 2.5 * dt * 0.62;
          if (Math.floor(before) !== Math.floor(K.step)) { const [v, pan] = hear(K.x, K.z, F1, 34); jingle(v * 0.45, pan, 4); thud(v * 0.45, pan, 300); if (Math.random() < 0.5) sob(v * 0.35, pan); }
          Object.assign(KV, { x: K.x, y: F1, z: K.z, yaw: K.yaw, visible: true, scale: KS, anim: 'walk', phase: K.step * Math.PI * 1.6, sackFull: true, look: null, gest: null });
          return;
        }
      }
      KV.visible = false; return;
    }
    // The finale never moves him: he starts from wherever he really is. He roars and tears the place apart until you
    // have a head start toward the stairs (so running past him while he rages is safe), then he comes.
    if (K.state === 'rage' && K.hold != null) {
      K.hold += dt; const fd = LV.doors.front;
      const lead = floorOf(K.y) === 1 && floorOf(P.y) === 1 ? G.udist[rNode(1, K.x, K.z)] - G.udist[rNode(1, P.x, P.z)]
        : floorOf(K.y) === 1 ? 99 : Math.hypot(K.x - fd.x, K.z - fd.z) - Math.hypot(P.x - fd.x, P.z - fd.z) - (floorOf(P.y) === 1 ? 30 : 0);
      if ((K.hold > 2.4 && lead >= G.D.behind) || K.hold > 11) K.hold = null; else K.stun = Math.max(K.stun, 0.2);
      if (K.hold != null && Math.random() < dt * 1.5) { burstPlates(K.x + (Math.random() - 0.5) * 2, K.y + 1.2, K.z + (Math.random() - 0.5) * 2, 8); const [v] = hear(K.x, K.z, K.y, 30); if (v > 0.02) boxSmash(); KV.gest = { name: 'roar', t0: NOW, dur: 1.4 }; }
    }
    if (K.stun > 0) { K.stun -= dt; K.spd = 0; Object.assign(KV, { x: K.x, y: K.y, z: K.z, yaw: K.yaw, visible: true, anim: 'idle' }); if (!KV.gest) KV.gest = { name: 'roar', t0: NOW, dur: 1.4 }; return; }
    const sameFloor = Math.abs(K.y - P.y) < 1, dP = Math.hypot(P.x - K.x, P.z - K.z);
    if (K.state === 'rage') {
      K.repath -= dt;
      if (K.repath <= 0) { K.repath = 0.35; const b = G.bro, tb = Math.hypot(b.x - K.x, b.z - K.z) < dP; goTo(tb ? b.x : P.x, tb ? b.z : P.z, floorOf(tb ? b.y : P.y)); }
      if (sameFloor && dP < 1.3) return caught('Krampus caught you at the last second.');
      if (Math.abs(K.y - G.bro.y) < 1 && Math.hypot(G.bro.x - K.x, G.bro.z - K.z) < 0.95) return caught('Krampus snatched Leo back.');
      smashT -= dt; if (smashT <= 0) { smashT = 0.5 + Math.random() * 0.6; if (Math.random() < 0.5) { burstPlates(K.x + (Math.random() - 0.5) * 1.5, K.y + 1.2, K.z + (Math.random() - 0.5) * 1.5, 8); const [v] = hear(K.x, K.z, K.y, 30); if (v > 0.02) boxSmash(); } }
    } else {
      if (hideTick(dt, dP, sameFloor)) return;
      const s = canSee();
      K.seeing = !!s; K.sawT = K.seeing ? 0 : K.sawT + dt;
      if (s) {
        const [d, range] = s;
        let r = d < 2.4 ? 5 : 0.2 + 2.2 * Math.pow(1 - d / range, 1.8);   // slow to notice you far away, quick up close
        if (P.ct > 0.5 && d > 3) r *= 0.5;
        if (Math.hypot(P.vx, P.vz) > 0.5) r *= 1.25;
        G.alert = Math.min(1, G.alert + r * D.rate * dt);
        K.lastSeen = [P.x, P.z, floorOf(P.y)];
        if (G.alert >= 1 && K.state !== 'chase') { K.state = 'chase'; K.repath = 0; G.sightings++; roar(); showMsg('HE SEES YOU!', 1.5); KV.gest = { name: 'roar', t0: NOW, dur: 1.0 }; }
        else if (K.state !== 'chase' && G.alert > 0.45 && K.state !== 'rush') investigate(P.x, P.z, floorOf(P.y), true);
      } else if (K.state !== 'chase') G.alert = Math.max(0, G.alert - 0.14 * dt);
      if (K.state === 'chase') {
        if (K.seeing && sameFloor && dP < 1.35) {
          if (G.slips > 0) {   // he gets a fistful of coat, and you tear free: once (twice on Easy, never on Hard)
            G.slips--; K.stun = 2.8; KV.gest = { name: 'roar', t0: NOW, dur: 1.6 }; roar(); thud(0.7, 0, 500); FEAR = 1; cam.shake = 0.6; G.alert = 1;
            try { if (navigator.vibrate) navigator.vibrate(120); } catch (e) {}
            showMsg(G.slips > 0 ? 'He got your coat. You tore free! RUN!' : 'He got your coat. You tore free! He won’t miss again. RUN!', 3.2); K.state = 'chase';
            return;
          }
          return caught('Krampus caught you.');
        }
        if (G.seenHide && G.hiding != null && sameFloor && dP < 1.9) return caught('He watched you climb into the ' + LV.containers[G.hiding].type + '.');
        K.repath -= dt;
        if (K.repath <= 0) { K.repath = 0.4; goTo(K.lastSeen[0], K.lastSeen[1], K.lastSeen[2]); }
        if (!K.seeing && (!K.path || K.pi >= K.path.length)) { G.seenHide = false; later(0.8, () => { if (mode === 'play' && K.state !== 'chase') krampusSay('I’m going to find you', clamp(1.3 - Math.hypot(K.x - P.x, K.z - P.z) / 24, 0.4, 1)); }); K.state = 'search'; K.t = 2.2; K.look = K.yaw; K.searchLeft = 2 + Math.min(2, G.clues); G.alert = 0.6; if (msgT <= 0.3) showMsg(G.hiding != null ? 'He lost you. Stay still.' : 'He lost you. Hide before he looks around.', 2.6, 'tip'); }
      } else if (K.state === 'look' || K.state === 'search') {
        K.t -= dt; K.yaw = K.look + Math.sin((2.2 - K.t) * 1.9) * 1.2;
        if (K.t <= 0) {
          if (K.state === 'search' && K.searchLeft > 0 && K.lastSeen) {
            K.searchLeft--; const [lx, lz, lf] = K.lastSeen, a = Math.random() * TAU, rr = 2 + Math.random() * 5;
            if (goTo(lx + Math.cos(a) * rr, lz + Math.sin(a) * rr, lf)) K.state = 'searchwalk'; else K.t = 1;
          } else pickPatrol();
        }
      }
      // close behind you and unseen: you hear him breathe
      G.breathT -= dt;
      if (G.breathT <= 0 && sameFloor && dP < 6.5 && K.state !== 'chase' && G.hiding == null && !inView(K.x, K.y, K.z, 1.1)) { G.breathT = 3.2 + Math.random() * 2; const [v, pan] = hear(K.x, K.z, K.y, 9); breath(0.12 + v * 0.3, pan); }
      G.hunchT -= dt;
      if (G.hunchT <= 0) {
        G.hunchT = G.D.hunch - 6 * level();
        if (K.state === 'patrol' || K.state === 'look') { const a = Math.random() * TAU, r = 5 + Math.random() * 7; K.state = 'patrol'; if (!goTo(P.x + Math.cos(a) * r, P.z + Math.sin(a) * r, floorOf(P.y))) pickPatrol(); }
      }
    }
    const moving = K.path && K.pi < K.path.length && K.state !== 'look' && K.state !== 'search';
    if (moving) {
      const base = { peerwalk: 1.35, chase: 3.9, rush: 3.2, investigate: 2.7, searchwalk: 2.4, patrol: 1.75 }[K.state] || 1.75;
      const spd = K.state === 'rage' ? D.rage * (K.y > 0.15 && K.y < F1 - 0.15 ? 0.5 : 1) : base * mult;   // he is too big for the staircase
      let left = spd * dt;
      while (left > 0 && K.pi < K.path.length) {
        const [tx, tz] = K.path[K.pi], ddx = tx - K.x, ddz = tz - K.z, dist = Math.hypot(ddx, ddz);
        if (dist < 0.05) { K.pi++; continue; }
        const m = Math.min(left, dist); K.x += (ddx / dist) * m; K.z += (ddz / dist) * m; left -= m;
        if (!(K.state === 'chase' && K.seeing)) K.yaw = turnTo(K.yaw, Math.atan2(ddx, -ddz), dt * 7);
        if (dist <= m + 1e-4) K.pi++;
      }
      K.y = surfaceY(K.x, K.z, K.y); K.spd = spd;
      const before = K.step; K.step += spd * dt * 0.62;
      if (Math.floor(before) !== Math.floor(K.step)) {
        const [v, pan] = hear(K.x, K.z, K.y, 30);
        if (K.state === 'rage') thud(v * 1.2 + 0.05, pan, 350); else { jingle(v * 0.5, pan, K.state === 'chase' ? 6 : 4); thud(v * 0.5, pan, 300); }
      }
      K.stuck += dt;
      if (K.stuck > 2.5) { if (Math.hypot(K.x - K.lastP[0], K.z - K.lastP[1]) < 0.6) { if (K.state === 'chase' || K.state === 'rage') K.repath = 0; else pickPatrol(); } K.stuck = 0; K.lastP = [K.x, K.z]; }
      if (K.pi >= K.path.length) {
        if (K.state === 'patrol') { K.state = 'look'; K.listen = Math.random() < 0.28; K.t = K.listen ? 5 + Math.random() * 3 : 1.2 + Math.random() * 1.6; K.look = K.yaw; }
        else if (K.state === 'investigate' || K.state === 'rush') { K.state = 'search'; K.t = 2.2; K.look = K.yaw; K.searchLeft = 1; K.lastSeen = [K.x, K.z, floorOf(K.y)]; }
        else if (K.state === 'searchwalk') { K.state = 'search'; K.t = 2; K.look = K.yaw; }
      }
    } else K.spd = 0;
    if ((K.state === 'chase' || K.state === 'rage') && dP < 3.4 && sameFloor && (!KV.gest || KV.gest.name !== 'lunge')) KV.gest = { name: 'lunge', t0: NOW, dur: 1.2 };
    if ((K.state === 'chase' && K.seeing) || (K.state === 'rage' && dP < 6)) K.yaw = turnTo(K.yaw, Math.atan2(P.x - K.x, -(P.z - K.z)), dt * 8);
    Object.assign(KV, { x: K.x, y: K.y, z: K.z, yaw: K.yaw, visible: true, scale: KS, anim: K.spd > 3 ? 'run' : K.spd > 0 ? 'walk' : 'idle', phase: K.step * Math.PI * 1.6, sackFull: false, look: K.state === 'chase' || K.state === 'rage' ? [P.x, P.y + 1, P.z] : null });
  }

  // ---------------- player ----------------
  let PEEK = 0; // 0..1: eyes lifted to the opening of the hiding place while he stares in
  const EYE = () => (G && G.hiding != null && (mode === 'play' || mode === 'scare') ? 0.72 + 0.2 * PEEK : lerp(1.3, 0.68, P.ct));
  function movePlayer(dt) {
    let fwd = 0, str = 0;
    if (keys.KeyW || keys.ArrowUp) fwd += 1; if (keys.KeyS || keys.ArrowDown) fwd -= 1;
    if (keys.KeyD || keys.ArrowRight) str += 1; if (keys.KeyA || keys.ArrowLeft) str -= 1;
    if (touch.move) { fwd = -touch.mz; str = touch.mx; }
    const mag = Math.hypot(fwd, str); if (mag > 1) { fwd /= mag; str /= mag; }
    const running = (keys.ShiftLeft || keys.ShiftRight || keys.Shift || P.run || runToggle) && !P.crouch;
    if (runToggle && P.crouch) runToggle = false;
    const sp = P.crouch ? 1.6 : running ? 5.0 : 2.8;
    const sy = Math.sin(P.yaw), cy = Math.cos(P.yaw);
    const wx = (sy * fwd + cy * str) * sp, wz = (-cy * fwd + sy * str) * sp, k = Math.min(1, dt * 12);
    P.vx += (wx - P.vx) * k; P.vz += (wz - P.vz) * k;
    P.ct += ((P.crouch ? 1 : 0) - P.ct) * Math.min(1, dt * 10);
    let nx = P.x + P.vx * dt, nz = P.z + P.vz * dt;
    [nx, nz] = WORLD.collide(nx, nz, P.y, lerp(1.35, 0.75, P.ct), 0.25, 0.32);
    nx = clamp(nx, 0.3, 63.7); nz = clamp(nz, 0.3, 39.7);
    P.y = surfaceY(nx, nz, P.y); P.x = nx; P.z = nz;
    const spd = Math.hypot(P.vx, P.vz); P.bob += spd * dt * 2.6;
    return { spd, running };
  }
  function updatePlayer(dt) {
    if (G.hiding != null) { P.vx = P.vz = 0; return; }
    const { spd, running } = movePlayer(dt);
    if (G.phase === 'hunt') { G.noiseT -= dt; if (spd > 0.6 && G.noiseT <= 0) { G.noiseT = 0.35; hearNoise(P.x, P.z, floorOf(P.y), running && spd > 4 ? 14 : P.crouch ? 0 : 3.6); } }
    for (const it of G.items) {
      if (it.taken || it.f !== floorOf(P.y) || Math.hypot(it.x - P.x, it.z - P.z) > (it.kind === 'keys' ? 1.7 : 1.0)) continue;
      it.taken = true;
      if (it.kind === 'keys') { G.keys = true; jingle(0.25, 0, 3); showMsg('The store keys! These open the front doors.', 3.5); }
      else {
        const c = CLUES[G.clues]; G.clues++; tone(660, 0.2, 0.2, 'triangle'); tone(880, 0.3, 0.2, 'triangle', 0.12);
        const bc = LV.containers[G.broC];
        showMsg(c.text || ('His scarf. The crying is coming from ' + placeName(bc.x, bc.z, bc.y) + '.'), 4.5);
        if (G.clues === 1 || G.clues === 3) later(3.5, () => { if (mode === 'play') krampusSay('Your brother is waiting for you', clamp(1.2 - Math.hypot(K.x - P.x, K.z - P.z) / 30, 0.45, 1)); });
        killLights(3); let add = G.D.map ? 1 : 2; for (const t of G.traps) if (!t.on && add > 0) { t.on = true; add--; }
      }
    }
    for (const t of G.traps) {
      if (t.cool > 0) t.cool -= dt;
      if (!t.on || t.cool > 0 || t.f !== floorOf(P.y) || P.ct > 0.6) continue;
      const along = t.ax === 'x' ? P.x - t.x : P.z - t.z, across = t.ax === 'x' ? P.z - t.z : P.x - t.x;
      if (Math.abs(along) < t.len / 2 && Math.abs(across) < 0.35) { t.cool = 6; jingle(0.5, 0, 9); jingle(0.4, 0, 6); if (G.phase === 'hunt') { showMsg('A bell trap! He heard that.', 2.5); investigate(t.x, t.z, t.f, true); if (NOW - (G.heardSaid || -99) > 15) { G.heardSaid = NOW; later(1.6, () => { if (mode === 'play') krampusSay('I can hear you', 0.8); }); } } }
    }
    G.doorT -= dt;
    const fd = LV.doors.front, sd = LV.doors.side;
    if (floorOf(P.y) === 0 && Math.hypot(P.x - fd.x, P.z - fd.z) < 1.9) {
      if (G.phase === 'escape' && G.keys) return win();
      if (G.doorT <= 0) { G.doorT = 5; thud(0.3, 0, 700); gest(cast.marcus, 'shake', 1.5); showMsg(G.phase === 'escape' ? 'LOCKED! You need the store keys!' : G.keys ? 'You are not leaving without Leo.' : 'Locked. Outside, he shakes his head. Then smiles.', 3.5); }
    } else if (floorOf(P.y) === 0 && Math.hypot(P.x - sd.x, P.z - sd.z) < 1.7 && G.doorT <= 0) { G.doorT = 5; thud(0.3, 0, 700); gest(cast.dana, 'shake', 1.5); showMsg('This door is locked too. She just smiles.', 3.5); }
  }
  function updateBrother(dt) {
    const b = G.bro, L = cast.leo;
    if (b.state !== 'follow') { G.cryT -= dt; if (G.cryT <= 0 && G.phase !== 'grace') { G.cryT = 2.3 + Math.random() * 1.2; const [v, pan] = hear(b.x, b.z, b.y, 14 + 6 * G.clues); sob(v * 0.6, pan); } return; }
    // once, at the bottom of the stairs, he goes down. He gets up when you come back for him.
    b.maxY = Math.max(b.maxY || 0, b.y);
    if (!b.tripped && b.maxY > 2 && b.y < 0.02 && G.phase === 'escape') {
      b.tripped = true; b.down = 0.001; yelp(0.2); thud(0.4, 0, 500); L.anim = 'crouch'; L.face = { eyes: 'closed', mouth: 'open', brows: 'sad' };
      showMsg('Leo fell! Go back for him!', 2.6); later(0.5, () => sob(0.5, 0)); later(1.1, () => { voiceUntil = 0; voiceAt(HV.fell[0], [b.x, b.y, b.z], 30); });
    }
    if (b.down) {
      b.down += dt; Object.assign(L, { x: b.x, y: b.y, z: b.z, visible: true, anim: 'crouch' });
      const dl = Math.hypot(P.x - b.x, P.z - b.z);
      if ((b.down > 0.9 && dl < 1.7) || b.down > 3.6) { const helped = dl < 1.7; b.down = null; G.trail = [[P.x, P.z, P.y]]; L.face = { eyes: 'wide', mouth: 'o', brows: 'sad' }; showMsg(helped ? 'You’ve got him. RUN!' : 'He’s up. RUN!', 1.6); tone(660, 0.12, 0.15, 'triangle'); }
      return;
    }
    const tr = G.trail, last = tr[tr.length - 1];
    if (!last || Math.hypot(P.x - last[0], P.z - last[1]) > 0.4) tr.push([P.x, P.z, P.y]);
    let left = 5.8 * dt, moved = 0;
    while (left > 0 && tr.length > 1) {
      const [tx, tz] = tr[0], dx = tx - b.x, dz = tz - b.z, d = Math.hypot(dx, dz);
      if (d < 0.15) { tr.shift(); continue; }
      const m = Math.min(left, d); b.x += dx / d * m; b.z += dz / d * m; left -= m; moved += m;
      L.yaw = turnTo(L.yaw, Math.atan2(dx, -dz), dt * 10);
    }
    b.y = surfaceY(b.x, b.z, b.y);
    Object.assign(L, { x: b.x, y: b.y, z: b.z, visible: true, anim: moved > 0.01 ? 'run' : 'idle' }); L.phase += moved / (ACT.dims('leo').legs * 1.5) * Math.PI;
  }
  function killLights(n) { let did = false; for (let i = 0; i < n && G.dead.length; i++) { ZT[G.dead.pop()] = 0.12; did = true; } if (did) { thud(0.5, 0, 300); tone(140, 0.25, 0.2, 'square', 0, -80); } }

  // ---------------- the staff get stranger ----------------
  // 0 tired retail · 1 the smile comes back · 2 it stays, and they stop blinking · 3 heads follow you further than heads should
  const STAFF = ['dana', 'marcus', 'priya', 'manager'];
  const CREEP = [{ face: {} }, { face: { mouth: 'smile' } }, { face: { mouth: 'smile', eyes: 'wide' }, noBlink: true, still: true }, { face: { mouth: 'wide', eyes: 'stare' }, noBlink: true, still: true, owl: true }];
  // the smile that opens: starts closed and takes `secs` to gape (drawWorld works out how far open it is)
  function maw(a, secs = 4, hold = 0) { a.face = { mouth: 'maw', eyes: 'stare', open: 0 }; a.noBlink = true; a.mawT0 = NOW + hold; a.mawDur = secs; }
  function setCreep(a, n) { const c = CREEP[n]; a.creep = n; a.face = Object.assign({}, c.face); a.noBlink = !!c.noBlink; a.still = !!c.still; a.owl = !!c.owl; }
  // can the player see this point right now? (in front of them, and nothing in the way)
  function inView(x, y, z, half = 1.0) {
    const dx = x - P.x, dz = z - P.z, d = Math.hypot(dx, dz); if (d < 0.6) return true;
    if (d > 45 || (dx * Math.sin(P.yaw) - dz * Math.cos(P.yaw)) / d < Math.cos(half)) return false;
    return WORLD.clear(P.x, P.y + 1.25, P.z, x, y + 1.5, z);
  }
  const eyeOfP = () => [P.x, P.y + 1.25, P.z];
  // a spot on the player's floor, a little way off, with a clear line to them — out of view if we can manage it
  function watchSpot(minD, maxD, wantHidden) {
    const f = floorOf(P.y); let best = null, bs = -1e9;
    for (let i = 0; i < 90; i++) {
      const n = REACH[(Math.random() * REACH.length) | 0], [x, z, nf] = nodePos(n); if (nf !== f) continue;
      const d = Math.hypot(x - P.x, z - P.z); if (d < minD || d > maxD) continue;
      if (cover[n] > 22 || LV.ramps.some((r) => x > r.x0 - 1 && x < r.x1 + 1 && z > r.z0 - 1 && z < r.z1 + 1)) continue;
      if (!WORLD.clear(P.x, P.y + 1.25, P.z, x, (f ? F1 : 0) + 1.5, z)) continue;
      const seen = inView(x, f ? F1 : 0, z); if (wantHidden && seen) continue;
      const sc = -Math.abs(d - (minD + maxD) / 2) + Math.random() * 2; if (sc > bs) { bs = sc; best = [x, z, f]; }
    }
    return best;
  }
  function hum(a, vol) { // a slow, low Jingle Bells, one note at a time
    a.humI = (a.humI || 0) + 1; const [n] = MEL[a.humI % MEL.length], [v, pan] = hear(a.x, a.z, a.y || 0, 11);
    if (v > 0.02) { tone(440 * Math.pow(2, (n - 69 - 12) / 12) * 0.985, 0.75, v * vol, 'sine', 0, -3, pan); tone(440 * Math.pow(2, (n - 69 - 12) / 12) * 1.5, 0.5, v * vol * 0.12, 'sine', 0, 0, pan); }
  }

  // ---------------- the walk-around with Leo ----------------
  let EX = null;
  const timers = [];
  const later = (sec, fn) => timers.push({ t: NOW + sec, fn });
  function runTimers() { for (let i = timers.length - 1; i >= 0; i--) if (NOW >= timers[i].t) { const f = timers[i].fn; timers.splice(i, 1); f(); } }
  function startExplore() {
    hideAll(); timers.length = 0;
    Object.assign(P, { x: 30.8, y: 0, z: 9.2, yaw: Math.PI * 0.95, pitch: 0, vx: 0, vz: 0, crouch: false, ct: 0 });
    for (let i = 0; i < 16; i++) ZL[i] = ZT[i] = 1;
    G = null; K = null;
    EX = { t: 0, leo: { mode: 'follow', repath: 0, path: null, pi: 0, said: new Set(), hideIdx: -1, gigT: 0, hideT: 0, count: 0 }, events: new Set(), stage: 'explore', barkT: 8, hs: 0, found: 0, act: 0, stalkT: 0, humT: 0, seenT: 0, fast: false };
    const L = cast.leo; placeA(L, P.x + 0.6, P.z + 0.3, P.yaw, { holdHand: 0, face: { mouth: 'smile' } });
    placeA(cast.dad, 46, 3.85, Math.PI, { anim: 'sit', sitH: 0.5 });
    placeA(cast.marcus, 48.6, 7.4, -0.6, { gest: { name: 'cross', t0: 0 } });
    placeA(cast.mom, 34.3, 33.3, -Math.PI / 2, { holdR: 'plate', gest: { name: 'hold2', t0: 0 } });
    placeA(cast.priya, 36.4, 31.2, -1.2, { gest: { name: 'cross', t0: 0 } });
    placeA(cast.dana, 30.8, 2.2, Math.PI, { holdR: 'keys', gest: { name: 'cross', t0: 0 } });
    placeA(cast.manager, 27.2, 9.2, Math.PI * 0.85, {});
    storeClock = 9 * 60 + 3; DOORS.front = 0; DOORS.side = 0; SKY.broken = false; DISPLAY.smashed = false; CAR.x = 36.5; CAR.z = -7.5; CAR.yaw = Math.PI + 0.25; CAR.lights = false; CAR.visible = true; CAR.inside = false;
    for (const l of LV.lights) l.off = false;
    mode = 'explore'; document.body.classList.add('explore'); $('hud').style.display = 'block'; $('ears').style.display = 'none'; lastTime = performance.now(); lock();
    music.on = true; music.vol = 0.05; music.warp = 1; ambDim = 1;
    showMsg('Show Leo around the store', 3.5);
    say('LEO', 'Hold my hand! Don’t let go! I want to see EVERYTHING.', 3);
  }
  const LIST = [['the big tree', 0], ['the beds', 1], ['the giant pots', 2], ['the rug wall', 3], ['the lamps', 4]];   // index into LV.leoSpots
  const listDone = () => LIST.filter(([, i]) => EX.leo.said.has(LV.leoSpots[i][4])).length;
  const SOFAS = [[46, 3.85, Math.PI], [53.2, 3.85, Math.PI], [49.5, 11.85, 0], [58, 11.85, 0], [60, 3.85, Math.PI]];
  const MOMSPOTS = [[34.3, 33.3, -Math.PI / 2], [36.9, 35.2, Math.PI / 2], [29.1, 33.4, -Math.PI / 2], [56, 38.5, 0], [42, 31.4, 0], [34.3, 35.5, -Math.PI / 2]];
  const POSTS = { dana: [30.8, 2.2, Math.PI], manager: [27.2, 9.2, Math.PI * 0.85], marcus: [41.4, 9.4, -0.6], priya: [36.4, 31.2, -1.2] };
  const ACT_AT = [0, 150, 285, 410];   // seconds into the walk-around when each act starts
  function npcSchedule(dt) {
    const e = EX, t = e.t;
    const once = (k, cond, fn) => { if (!e.events.has(k) && cond) { e.events.add(k); fn(); } };
    const near = (a, r) => a.visible && Math.hypot(a.x - P.x, a.z - P.z) < r && floorOf(a.y) === floorOf(P.y);
    const dad = cast.dad, mar = cast.marcus, mom = cast.mom, pri = cast.priya, man = cast.manager, dan = cast.dana;
    const live = () => EX === e && e.stage === 'explore';
    if (e.stage === 'explore') {
      const act = t >= ACT_AT[3] ? 3 : t >= ACT_AT[2] ? 2 : t >= ACT_AT[1] ? 1 : 0;
      if (act !== e.act) { e.act = act; e.stalkT = 4; }
      // each of them changes while you are not looking at them
      for (const k of STAFF) { const a = cast[k]; if ((a.creep || 0) < act && (Math.hypot(a.x - P.x, a.z - P.z) > 14 || !inView(a.x, a.y || 0, a.z))) { setCreep(a, act); if (act >= 1 && !a.path) { a.gest = { name: 'fold', t0: NOW }; a.holdR = k === 'dana' ? 'keys' : null; } } }
      // Dad tries every sofa and Mom moves every plate, start to finish. They never notice a thing.
      if (!dad.path && t > (e.dadNext || 50)) {
        e.dadI = ((e.dadI || 0) + 1) % SOFAS.length; const [sx, sz, sy] = SOFAS[e.dadI];
        dad.anim = 'idle'; dad.sitH = null; goRoute(dad, sx, sz + (sy ? 1.0 : -1.0), 0); dad.path.push([sx, sz]); dad.after = 'sit'; dad.faceYaw = sy; dad.sitH = 0.5;
        e.dadNext = t + 55 + Math.random() * 30;
        const prev = SOFAS[(e.dadI + SOFAS.length - 1) % SOFAS.length];
        if (act === 0) later(2.5, () => { if (live() && e.act === 0) { goRoute(mar, prev[0] + 0.2, prev[1] + (prev[2] ? 1.2 : -1.2), 0, 1.1); later(5, () => { if (e.act === 0) gest(mar, 'fluff', 3); }); } });
      }
      if (!mom.path && t > (e.momNext || 35)) {
        e.momI = ((e.momI || 0) + 1) % MOMSPOTS.length; const [mx, mz, my] = MOMSPOTS[e.momI];
        goRoute(mom, mx, mz, 0); mom.faceYaw = my; mom.gest = null; mom.holdR = null; mom.browsing = true;
        e.momNext = t + 40 + Math.random() * 25;
        if (act === 0) later(3.5, () => { if (live() && e.act === 0) { goRoute(pri, mx + 1.6, mz - 1.2, 0, 1.0); later(6, () => { if (e.act === 0) gest(pri, 'sigh', 2.5); }); } });
      }
      if (mom.arrived && mom.browsing) { mom.browsing = false; mom.holdR = Math.random() < 0.6 ? 'plate' : 'pillow'; gest(mom, mom.holdR === 'plate' ? 'hold2' : 'hold', 8); }
      // ---- act 1 on: they stop tidying up after your parents and start watching you ----
      const gathered = e.events.has('gather');
      if (act >= 1 && !gathered) {
        once('posts', true, () => { for (const k of ['marcus', 'priya']) { const [x, z, y] = POSTS[k]; goRoute(cast[k], x, z, 0, 1.0); cast[k].faceYaw = y; cast[k].gest = { name: 'fold', t0: NOW }; } man.gest = { name: 'fold', t0: NOW }; });
        for (const k of STAFF) { const a = cast[k]; if (a.path) { a.look = null; continue; } const d = Math.hypot(a.x - P.x, a.z - P.z); a.look = d < (act >= 2 ? 40 : 14) && (act >= 3 || floorOf(a.y) === floorOf(P.y)) ? eyeOfP() : null; }
      }
      // ---- act 2 on: one of them is always somewhere you can see, a little closer each time you look away ----
      if (act >= 2 && !gathered) {
        e.stalkT -= dt;
        const st = pri, f = floorOf(P.y), fy = f ? F1 : 0;
        const vis = st.visible && floorOf(st.y) === f && inView(st.x, st.y, st.z, 0.9), dS = Math.hypot(st.x - P.x, st.z - P.z);
        if (vis) { e.seenT += dt; e.unseenT = 0; } else e.unseenT = (e.unseenT || 0) + dt;
        if (e.leo.mode === 'hidden' && e.leo.hideIdx >= 0 && !e.leo.pointed) {
          const c = LV.containers[e.leo.hideIdx], px = c.x + (c.x > 6 ? -1.0 : 1.0), pz = c.z + 0.35;
          if (c.f === f && !inView(px, c.y, pz) && Math.hypot(px - P.x, pz - P.z) > 5) {
            st.path = null; st.x = px; st.z = pz; st.y = c.y; st.yaw = st.faceYaw = Math.atan2(c.x - px, -(c.z - pz)); st.anim = 'idle'; st.gest = { name: 'point', t0: NOW }; st.look = eyeOfP(); e.leo.pointed = true; e.stalkT = 30;
          }
        } else if (e.stalkT <= 0 && !vis && e.unseenT > 1.2 && e.leo.mode !== 'counting') {
          const wasSeen = e.seenT > 0.8, lim = act >= 3 ? [5, 9] : [9, 15];
          const spot = watchSpot(wasSeen ? Math.max(lim[0], Math.min(dS - 3, lim[1] - 3)) : lim[0] + 2, wasSeen ? Math.max(lim[0] + 2, Math.min(dS, lim[1])) : lim[1], true);
          if (spot) {
            st.path = null; st.x = spot[0]; st.z = spot[1]; st.y = fy; st.yaw = Math.atan2(P.x - st.x, -(P.z - st.z)); st.faceYaw = st.yaw; st.anim = 'idle'; st.gest = { name: act >= 3 ? 'tiltHead' : 'fold', t0: NOW }; st.look = eyeOfP();
            e.stalkT = (act >= 3 ? 9 : 16) + Math.random() * 8; e.seenT = 0; e.moves = (e.moves || 0) + 1;
            if (e.moves === 2) later(2.5, () => { if (live() && subT <= 0) say('LEO', 'That lady was over THERE a second ago.', 3); });
          } else e.stalkT = 2;
        }
        // Marcus waits wherever the stairs will bring you out
        if (!mar.path && e.leo.mode !== 'counting') { const want = f ? [27.6, 28.9, 0] : [27.4, 10.6, F1]; if ((Math.abs(mar.x - want[0]) > 0.5 || Math.abs((mar.y || 0) - want[2]) > 1) && !inView(mar.x, mar.y || 0, mar.z) && !inView(want[0], want[2], want[1])) { mar.x = want[0]; mar.z = want[1]; mar.y = want[2]; mar.yaw = mar.faceYaw = Math.atan2(25.2 - mar.x, -((f ? 26.5 : 11.5) - mar.z)); mar.gest = { name: 'fold', t0: NOW }; } }
        if (dS < 3.2 && floorOf(st.y) === f) once('help' + act, subT <= 0, () => say('PRIYA', act >= 3 ? 'You can stay as long as you like.' : 'Can I help you find something?', 3));
      }
      if (act >= 3) {
        e.humT -= dt; if (e.humT <= 0) { e.humT = 0.62; for (const k of STAFF) hum(cast[k], 0.2); }
        music.warp = lerp(music.warp, 0.86, dt * 0.2); ambDim = lerp(ambDim, 0.8, dt * 0.2);
        if (Math.random() < dt * 0.25) man.look = [32, 9, 20];
      } else if (act === 2) { music.warp = lerp(music.warp, 0.955, dt * 0.2); ambDim = lerp(ambDim, 0.9, dt * 0.2); }
      // ---- things people say when you walk by ----
      e.barkT -= dt;
      if (e.barkT <= 0) {
        const lines = [];
        if (near(dad, 6)) lines.push(['DAD', 'Ooh. Feel this one. Performance velvet.'], ['DAD', 'Hey! Do you guys have this in the back?'], ['DAD', 'Five more minutes, buddy.'], ['DAD', 'Everyone here is SO nice.']);
        if (near(mom, 6)) lines.push(['MOM', 'We’re just browsing!'], ['MOM', 'Hmm. I wonder if this comes in sage.'], ['MOM', 'Stay where I can see you two.'], ['MOM', 'Such friendly staff tonight.']);
        const B = [
          { manager: ['Lovely night for it.', 'We close at nine. Sharp.'], dana: ['(sigh)', 'We’re closed. Just so you know.'], priya: ['(muttering) It goes on the OTHER shelf…'], marcus: ['It’s nine-oh-six.', '(under his breath) Performance velvet.'] },
          { manager: ['Take your time.', 'No rush. None at all.'], dana: ['Hi again!', 'Still here! Wonderful.'], priya: ['Finding everything okay?'], marcus: ['Take all the time you need.'] },
          { manager: ['We love it when families stay.', 'It’s nearly time.'], dana: ['The doors are locked. For your safety.', 'Hi again. Hi again.'], priya: ['Such a small one. He would fit anywhere.'], marcus: ['Don’t go far, now.'] },
          { manager: ['He likes it when they stay late.', 'Listen. Do you hear them yet?'], dana: ['Nobody leaves early.', 'Hi again.'], priya: ['He would fit in a sack.'], marcus: ['Not long now.'] },
        ][act];
        for (const k of STAFF) if (near(cast[k], 5) && !cast[k].path) for (const l of B[k]) lines.push([k.toUpperCase(), l]);
        if (lines.length && subT <= 0) { const [w, l] = lines[(Math.random() * lines.length) | 0]; say(w, l, 2.8); e.barkT = (act >= 2 ? 9 : 14) + Math.random() * 9; } else e.barkT = 3;
      }
      once('lamp', t > 100 && act === 0 && near(dad, 16) && dad.anim === 'sit', () => {
        const lamp = LV.lights.filter((l) => l.zone === lightZone(dad.x, dad.z, 0) && l.r > 3 && l.r < 3.5 && Math.hypot(l.x - dad.x, l.z - dad.z) < 3.5)[0];
        goRoute(mar, dad.x + 1.6, dad.z + (dad.faceYaw ? 1.1 : -1.1), 0, 1.2); mar.face = { eyes: 'narrow' };
        later(4, () => { if (lamp) lamp.off = true; tone(900, 0.03, 0.15, 'square'); gest(mar, 'reach', 0.8); });
        later(5.2, () => say('DAD', 'Oh, it’s so cozy in here now.', 3));
        later(9, () => { if (!mar.creep) mar.face = {}; });
      });
      // Leo notices before you do
      const leoSay = (k, cond, line, dur) => once(k, cond && subT <= 0 && e.leo.mode === 'follow', () => say('LEO', line, dur || 3));
      leoSay('n1', act >= 1 && t > ACT_AT[1] + 25 && STAFF.some((k) => near(cast[k], 9)), 'Why is everybody smiling now? They were grumpy before.');
      leoSay('n2', act >= 2 && t > ACT_AT[2] + 20 && STAFF.some((k) => near(cast[k], 12) && inView(cast[k].x, cast[k].y || 0, cast[k].z)), 'He hasn’t blinked. I’ve been counting.');
      leoSay('n3', act >= 3 && t > ACT_AT[3] + 12, 'They’re all humming the same song.');
      leoSay('n4', act >= 3 && t > ACT_AT[3] + 45, 'I don’t like it here anymore.');
      once('dim', t > 505, () => { const e2 = e; let n = 0; const fl = () => { if (EX !== e2 || mode !== 'explore') return; ambDim = n % 2 ? 0.8 : 0.3; if (n++ < 7) later(0.07 + Math.random() * 0.1, fl); else { ambDim = 0.72; thud(0.3, 0, 250); } }; fl(); later(1.6, () => { if (EX === e2 && subT <= 0) say('LEO', 'Why did the lights do that?', 2.6); }); });
      leoSay('n5', t > 552, 'Where are they all going? They’re all walking the same way.');
      leoSay('n6', t > 575, 'It’s too quiet. Hold my hand tighter.');
      if (act === 0 && Math.random() < dt * 0.05) gest(man, 'lookUp', 2.5);
    }
    once('bells1', t > 470, () => { jingle(0.05, -0.8, 3); later(0.9, () => say('LEO', 'Did you hear bells?', 2.4)); });
    once('gather', t > 545, () => gatherGroup(false));
    once('hungry', t > EXPLORE_SECS, () => {
      e.stage = 'return'; if (!e.events.has('gather')) { e.events.add('gather'); gatherGroup(false); }
      if (e.leo.mode === 'hidden' || e.leo.mode === 'counting') popLeo(true);
      say('LEO', 'I want Mom. Can we go find Mom?', 3);
      later(3.6, () => { if (EX !== e) return; e.leo.mode = 'lead'; say('LEO', floorOf(P.y) === 0 ? 'Wait. I can see everything from up top! Come on!' : 'I can see the big tree from the railing! Come on!', 3); showMsg('Follow Leo to the balcony railing', 4); });
    });
  }
  const GROUP = { manager: [32.5, 12.9, Math.PI], dad: [31.8, 14.4, 0], mom: [33.2, 14.4, 0], dana: [30.6, 13.5, 1.0], marcus: [34.4, 13.6, -1.0], priya: [32.5, 15.8, Math.PI] };
  function gatherGroup(instant) {
    for (const [k, [x, z, y]] of Object.entries(GROUP)) {
      const a = cast[k]; a.gest = null; a.holdR = null; a.holdL = null; a.after = null; a.browsing = false; a.look = null;
      if (instant) placeA(a, x, z, y); else { a.sitH = null; a.anim = 'idle'; goRoute(a, x, z, 0, STAFF.includes(k) ? 2.0 : 1.4); a.faceYaw = y; }
      if (STAFF.includes(k)) { setCreep(a, 3); a.gest = { name: 'fold', t0: NOW }; }
    }
  }
  function leoUpdate(dt) {
    const L = cast.leo, s = EX.leo;
    if (s.mode === 'counting' || s.mode === 'hidden') {
      if (s.mode === 'hidden') { s.gigT -= dt; s.hideT += dt; if (s.gigT <= 0) { s.gigT = 2.6 + Math.random() * 1.5; const c = LV.containers[s.hideIdx], [v, pan] = hear(c.x, c.z, c.y, 22); giggle(0.05 + v * 0.35, pan); }
        const c = LV.containers[s.hideIdx];
        if (s.hideT > 18 && !s.hint1) { s.hint1 = true; showMsg('The giggling is coming from ' + placeName(c.x, c.z, c.y) + (c.f !== floorOf(P.y) ? (c.f ? ' — upstairs.' : ' — downstairs.') : '.'), 4, 'tip'); }
        if (s.hideT > 36 && !s.hint2) { s.hint2 = true; say('LEO', 'Psst! I’m in the ' + c.type + '! Over here!', 3); }   // and his hiding place shows on the map
        if (s.hideT > 75) popLeo(false); }
      return;
    }
    const sy = Math.sin(P.yaw), cy = Math.cos(P.yaw);
    let tx = P.x + cy * 0.55, tz = P.z + sy * 0.55, tf = floorOf(P.y);
    if (s.mode === 'lead') { tx = 40.9; tz = 16.4; tf = 1; if (floorOf(L.y) === 1 && Math.hypot(L.x - tx, L.z - tz) < 1.5) { L.anim = 'idle'; L.yaw = -Math.PI / 2; L.holdHand = null; L.face = { mouth: 'smile' }; if (Math.random() < dt * 0.4) gest(L, 'wave', 1.5); return; } }
    else if (WORLD.blocked(tx, tz, 0.2, P.y + 0.2, P.y + 1)) { tx = P.x - sy * 0.6; tz = P.z + cy * 0.6; }
    const d = Math.hypot(tx - L.x, tz - L.z) + (floorOf(L.y) !== tf ? 6 : 0);
    s.repath -= dt;
    if (d > 2.2 || floorOf(L.y) !== tf) {
      if (s.repath <= 0 || !s.path) { s.repath = 0.6; const p = routeY(L.x, L.z, L.y || 0, tx, tz, tf); s.path = p ? p.slice(1) : null; s.pi = 0; }
      if (s.path && s.pi < s.path.length) {
        const [px, pz] = s.path[s.pi], dx = px - L.x, dz = pz - L.z, dd = Math.hypot(dx, dz);
        const sp = s.mode === 'lead' ? 3.4 : Math.min(5.2, 1.5 + d * 1.2);
        if (dd < 0.15) s.pi++; else { const m = Math.min(dd, sp * dt); L.x += dx / dd * m; L.z += dz / dd * m; L.yaw = turnTo(L.yaw, Math.atan2(dx, -dz), dt * 10); L.phase += m / (ACT.dims('leo').legs * (sp > 2.6 ? 1.5 : 1.2)) * Math.PI; L.anim = sp > 2.6 ? 'run' : 'walk'; }
      }
      if (d > 14 && s.mode !== 'lead') { L.x = P.x - sy * 1; L.z = P.z + cy * 1; L.y = P.y; }
    } else {
      s.path = null;
      const dx = tx - L.x, dz = tz - L.z, dd = Math.hypot(dx, dz);
      if (dd > 0.08) { const sp = Math.min(5.5, 1 + dd * 4), m = Math.min(dd, sp * dt); let nx = L.x + dx / dd * m, nz = L.z + dz / dd * m; [nx, nz] = WORLD.collide(nx, nz, L.y, 1.0, 0.18, 0.32); L.phase += Math.hypot(nx - L.x, nz - L.z) / (ACT.dims('leo').legs * 1.2) * Math.PI; L.x = nx; L.z = nz; L.anim = sp > 3 ? 'run' : 'walk'; L.yaw = turnTo(L.yaw, Math.atan2(dx, -dz), dt * 8); }
      else { L.anim = 'idle'; L.yaw = turnTo(L.yaw, P.yaw, dt * 4); }
    }
    L.y = surfaceY(L.x, L.z, L.y);
    L.holdHand = s.mode !== 'lead' && Math.hypot(L.x - P.x, L.z - P.z) < 1.0 ? 0 : null;
    if (EX.stage === 'explore') for (const [f, x, z, r, line] of LV.leoSpots) if (!s.said.has(line) && floorOf(P.y) === f && Math.hypot(P.x - x, P.z - z) < r && subT <= 0) { s.said.add(line); say('LEO', line, 2.8); break; }
    if (EX.stage === 'explore' && s.mode === 'follow' && listDone() >= LIST.length && subT <= 0 && (EX.hs === 0 || (EX.hs === 1 && EX.found >= 1 && EX.t > ACT_AT[2] + 20))) startHideSeek();
  }
  function startHideSeek() {
    const s = EX.leo; EX.hs++;
    const f = floorOf(P.y), cands = LV.containers.map((c, i) => [c, i]).filter(([c]) => c.f === f).sort((a, b) => Math.hypot(a[0].x - P.x, a[0].z - P.z) - Math.hypot(b[0].x - P.x, b[0].z - P.z));
    if (!cands.length) { EX.hs--; return; }
    const pickI = cands[Math.min(cands.length - 1, 1 + ((Math.random() * Math.min(4, cands.length - 1)) | 0))][1];
    say('LEO', EX.hs === 1 ? 'I saw everything! Now hide-and-seek! You count. No peeking!' : 'One more game! You count. No peeking!', 3);
    s.mode = 'counting'; s.count = 10; s.hideIdx = pickI; cast.leo.holdHand = null;
    const tick = () => {
      if (!EX || EX.leo !== s || s.mode !== 'counting') { $('peek').style.opacity = 0; return; }
      if (s.count <= 0) { $('peek').style.opacity = 0; $('peekN').textContent = ''; s.mode = 'hidden'; s.gigT = 1; s.hideT = 0; cast.leo.visible = false; showMsg('Find Leo — listen for the giggling', 3.5); return; }
      $('peek').style.opacity = 1; $('peekN').textContent = s.count; tone(520 + (10 - s.count) * 30, 0.1, 0.08, 'sine'); s.count--; later(0.9, tick);
    };
    later(1.6, tick);
  }
  function popLeo(found) {
    const s = EX.leo, c = LV.containers[s.hideIdx], L = cast.leo;
    if (!c) { s.mode = 'follow'; return; }
    placeA(L, c.x + 0.7, c.z, 0, { y: c.y, face: { mouth: 'smile' } }); L.yaw = Math.atan2(P.x - L.x, -(P.z - L.z));
    s.mode = 'follow'; s.hideIdx = -1; giggle(0.3, 0); $('peek').style.opacity = 0; EX.found++; s.hint1 = s.hint2 = false;   // a finished round always counts, whoever won
    if (found && s.pointed) { say('LEO', 'How did you find me so fast?!', 2.4); const e = EX; later(2.6, () => { if (EX === e) say('', 'She was pointing at it. She is still pointing at it.', 3.4); }); }
    else say('LEO', found ? (EX.hs === 1 ? 'You found me! Again! Again!' : 'Okay okay, you’re good at this.') : 'I win! You didn’t even look in the pots!', 2.8);
    s.pointed = false;
  }
  function exploreInteract() {
    const s = EX.leo;
    if (s.mode === 'hidden') { const c = LV.containers[s.hideIdx]; if (c && c.f === floorOf(P.y) && Math.hypot(c.x - P.x, c.z - P.z) < 2.3) return popLeo(true); if (nearContainer() >= 0) showMsg('Not in here.', 1.2); }
  }
  function updateExplore(dt) {
    // once Leo has seen everything on his list and played a round, the evening moves along faster
    if (EX.stage === 'explore' && !EX.fast && EX.t > 120 && EX.t < 500 && listDone() >= LIST.length && EX.found >= 1) { EX.fast = true; showMsg('Leo has seen it all. It’s getting late.', 3.5); }
    EX.t += dt * (EX.fast && EX.t < 540 && EX.leo.mode === 'follow' ? 3 : 1); storeClock = 9 * 60 + 3 + Math.min(EX.t, EXPLORE_SECS + 60) / 60;
    runTimers();
    if (EX.leo.mode !== 'counting') movePlayer(dt); else { P.vx = P.vz = 0; }
    npcSchedule(dt); leoUpdate(dt);
    for (const k in cast) if (k !== 'leo') stepActor(cast[k], dt);
    if (EX.stage === 'return' && floorOf(P.y) === 1 && P.x > 39.6 && P.x < 43 && P.z > 12.5 && P.z < 24 && !EX.balcony) { EX.balcony = true; runScene(sceneBalcony, afterBalcony); return; }
    if (EX.stage === 'down' && P.y < 1.6 && P.z > 19 && P.x < 28) { EX.stage = 'crash'; runScene(sceneCrash, () => runScene(sceneDoors, startHunt)); return; }
    updateHUD(dt);
  }
  function afterBalcony() {
    mode = 'explore'; $('hud').style.display = 'block'; EX.stage = 'down'; EX.leo.mode = 'follow'; lastTime = performance.now(); lock();
    const L = cast.leo; placeA(L, P.x + 0.5, P.z + 0.3, P.yaw, { y: P.y, holdHand: 0, face: { eyes: 'wide', brows: 'sad' } });
    C.you.visible = false;
    showMsg('Go downstairs to Mom and Dad', 4);
  }

  // ---------------- HUD ----------------
  function updateHUD(dt) {
    if (msgT > 0) { msgT -= dt; if (msgT <= 0) $('msg').style.opacity = 0; }
    const ph = $('phase');
    if (mode !== 'explore' && !G) return;
    if (mode === 'explore') {
      ph.textContent = EX.stage === 'explore' ? 'EXPLORE WITH LEO' : EX.stage === 'return' ? 'GO FIND MOM' : 'GO DOWNSTAIRS';
      ph.className = 'hide'; $('timer').textContent = clockStr(storeClock);
      $('list').style.display = EX.stage === 'explore' ? 'block' : 'none';
      if (EX.stage === 'explore') $('list').innerHTML = '<b>Leo wants to see</b>' + LIST.map(([n, i]) => `<span class="${EX.leo.said.has(LV.leoSpots[i][4]) ? 'ok' : ''}">${n}</span>`).join('') + `<span class="${EX.found >= 1 ? 'ok' : ''}">play hide-and-seek</span>`;
      const s = EX.leo; $('obj').innerHTML = s.mode === 'hidden' ? 'Leo is hiding. Listen for the giggling.' : s.mode === 'counting' ? 'Counting…' : s.mode === 'lead' ? 'Follow Leo upstairs' : cast.leo.holdHand === 0 ? 'Holding Leo’s hand' : 'Leo is with you';
      $('alert').style.opacity = 0; $('vignette').style.opacity = 0; $('hidefx').style.opacity = 0;
    } else {
      $('list').style.display = 'none';
      ph.textContent = G.phase === 'grace' ? 'IT IS HIDING LEO' : G.phase === 'hunt' ? 'FIND LEO' : 'RUN TO THE FRONT DOORS';
      ph.className = G.phase === 'escape' ? 'run' : G.phase === 'grace' ? 'hide' : 'seek';
      $('timer').textContent = G.phase === 'grace' ? fmt(G.t + 1) : fmt(G.time);
      $('obj').innerHTML = `Leo’s things <b>${G.clues}/3</b> · Keys <b>${G.keys ? '✓' : '✗'}</b> · Leo <b>${G.bro.state === 'follow' ? 'with you' : 'missing'}</b>`;
      { const bc = LV.containers[G.broC];
        $('goal').textContent = G.phase === 'escape' ? (G.keys ? 'Front doors. Don’t let go of Leo.' : 'Keys first — behind a register — then the front doors!')
          : G.clues >= 3 ? 'He’s in ' + placeName(bc.x, bc.z, bc.y) + (G.keys ? '. Check the pots and hampers.' : '. Grab the keys from a register too.')
          : G.clues >= 1 ? 'Find the rest of Leo’s things. Follow the crying.' : 'Find Leo’s things. Listen for the crying.'; }
      const a = G.phase === 'escape' ? 1 : G.alert;
      $('alertFill').style.width = Math.round(a * 100) + '%'; $('alert').style.opacity = a > 0.02 ? 1 : 0.25;
      $('vignette').style.opacity = G.phase === 'escape' ? 0.35 : clamp(a * 1.1, 0, 0.85);
      $('hidefx').style.opacity = G.hiding != null ? 1 : 0; $('hidefx').classList.toggle('peer', K.state === 'peer'); document.body.classList.toggle('stare', K.state === 'peer');
    }
    $('where').textContent = (floorOf(P.y) ? 'Upstairs · ' : 'Downstairs · ') + zoneName(P.x, P.z, P.y);
    $('stance').textContent = G && G.hiding != null && mode === 'play' ? 'Hiding' : P.crouch ? 'Crouched' : (P.run || keys.ShiftLeft || keys.ShiftRight || keys.Shift || runToggle) ? 'Running' : 'Standing';
    $('btnCrouch').classList.toggle('on', P.crouch);
    let prompt = '';
    if (mode === 'play') { if (G.hiding != null) prompt = 'Climb out'; else { const c = nearContainer(); if (c >= 0) prompt = LV.containers[c].type === 'pot' ? 'Look in / hide in the pot' : 'Look in / hide in the hamper'; } }
    else if (mode === 'explore' && EX.leo.mode === 'hidden') { const c = nearContainer(), h = LV.containers[EX.leo.hideIdx]; if (c >= 0 || (h && h.f === floorOf(P.y) && Math.hypot(h.x - P.x, h.z - P.z) < 2.3)) prompt = 'Look inside'; }
    $('prompt').style.display = prompt ? 'block' : 'none'; $('promptText').textContent = prompt;
    $('btnUse').style.display = prompt && isTouch ? 'block' : 'none'; $('btnUse').textContent = mode === 'play' && G.hiding != null ? 'Out' : mode === 'play' ? 'Hide' : 'Look';
    mm.style.display = mapOn ? 'block' : 'none';
    if (mapOn) {
      const f = floorOf(P.y), Wd = mm.width, H = mm.height, s = Wd / 34;
      mg.clearRect(0, 0, Wd, H); mg.save();
      mg.translate(Wd / 2, H / 2); mg.scale(s / MAP_S, s / MAP_S); mg.translate(-P.x * MAP_S, -(LV.depth - P.z) * MAP_S);
      mg.globalAlpha = 0.9; mg.drawImage(mapImg[f], 0, 0); mg.globalAlpha = 1;
      const sx = (x) => x * MAP_S, sz = (z) => (LV.depth - z) * MAP_S;
      if (mode === 'play' && G.D.map) for (const it of G.items) if (!it.taken && it.f === f) { mg.fillStyle = it.kind === 'keys' ? '#e0a03a' : '#3aa0e0'; mg.beginPath(); mg.arc(sx(it.x), sz(it.z), 3.5, 0, TAU); mg.fill(); }
      if (mode === 'play' && (G.D.map || debug) && KV.visible && floorOf(K.y) === f) { mg.fillStyle = '#7a1010'; mg.beginPath(); mg.arc(sx(K.x), sz(K.z), 4, 0, TAU); mg.fill(); }
      if (mode === 'explore' && EX.stage === 'return' && f === 1) { mg.fillStyle = '#e0a03a'; mg.beginPath(); mg.arc(sx(40.9), sz(16.4), 5, 0, TAU); mg.fill(); }
      if (mode === 'explore' && EX.stage === 'explore') for (const [, i] of LIST) { const [lf, lx, lz, , line] = LV.leoSpots[i]; if (lf === f && !EX.leo.said.has(line)) { mg.strokeStyle = '#e0a03a'; mg.lineWidth = 2; mg.beginPath(); mg.arc(sx(lx), sz(lz), 5, 0, TAU); mg.stroke(); } }
      if (mode === 'explore' && EX.leo.mode === 'hidden' && EX.leo.hint2) { const c = LV.containers[EX.leo.hideIdx]; if (c && c.f === f) { mg.strokeStyle = '#e0a03a'; mg.lineWidth = 2.5; mg.beginPath(); mg.arc(sx(c.x), sz(c.z), 6, 0, TAU); mg.stroke(); } }
      if (mode === 'explore') for (const k of ['mom', 'dad']) { const a = cast[k]; if (a.visible && floorOf(a.y) === f) { mg.fillStyle = '#2f6fd0'; mg.beginPath(); mg.arc(sx(a.x), sz(a.z), 3, 0, TAU); mg.fill(); } }
      if (debug && mode === 'play') { const c = LV.containers[G.broC]; mg.fillStyle = '#18a0ff'; mg.beginPath(); mg.arc(sx(c.x), sz(c.z), 3, 0, TAU); mg.fill(); }
      mg.translate(sx(P.x), sz(P.z)); mg.rotate(Math.PI - P.yaw);
      mg.fillStyle = '#d4402c'; mg.beginPath(); mg.moveTo(0, -6); mg.lineTo(4, 4); mg.lineTo(-4, 4); mg.closePath(); mg.fill();
      mg.restore();
      mg.fillStyle = 'rgba(20,20,20,0.75)'; mg.font = 'bold 11px system-ui, sans-serif'; mg.fillText(f ? 'UPSTAIRS' : 'DOWNSTAIRS', 6, 14);
    }
  }

  // ============================================================
  // CUTSCENES  (full script: docs/script.md)
  // ============================================================
  const C = cast;
  const head = (a) => [a.x, (a.y || 0) + ACT.dims(a.id).H * 0.92, a.z];
  function* sceneOpening() {
    hideAll(); SKY.broken = false; DISPLAY.smashed = false; DOORS.front = 0; DOORS.side = 0; storeClock = 8 * 60 + 59;
    for (let i = 0; i < 16; i++) ZL[i] = ZT[i] = 1;
    for (const l of LV.lights) l.off = false;
    music.on = true; music.vol = 0.0; music.warp = 1;
    CAR.x = 66; CAR.z = -15.5; CAR.yaw = Math.PI / 2; CAR.lights = true; CAR.visible = true; CAR.inside = false;
    placeA(C.dana, 31, 1.9, 0, { holdR: 'keys', gest: { name: 'lock', t0: 0 } });
    placeA(C.marcus, 24.5, 7.4, Math.PI * 0.8); placeA(C.priya, 21.6, 7.0, Math.PI * 0.7, { gest: { name: 'cross', t0: 0 } }); placeA(C.manager, 27, 9.5, Math.PI * 0.85);
    fadeTo(1, 0); yield 0.2; fadeTo(0, 2.5);
    cut([18, 3.2, -24], [32, 3.4, -2], 0.95);
    say('', '8:59 PM. Snowing.', 3.5);
    par(function* () {
      const path = [[52, -15.5], [42, -13], [37.5, -9.5], [36.5, -7.5]];
      for (let i = 0; i < path.length;) { const [tx, tz] = path[i], dx = tx - CAR.x, dz = tz - CAR.z, d = Math.hypot(dx, dz); if (d < 0.2) { i++; continue; } const sp = i === path.length - 1 ? 2.5 : 7, m = Math.min(d, sp * 0.02); CAR.x += dx / d * m; CAR.z += dz / d * m; CAR.yaw = turnTo(CAR.yaw, Math.atan2(-dx, -dz), 0.08); yield 0.02; }
      CAR.yaw = Math.PI + 0.25;
    });
    move([18, 3.2, -24], [32, 3.4, -2], [24, 2.4, -17], [35, 1.5, -7], 6.5, 0.95, 0.85);
    yield 6.8;
    placeA(C.dad, 37.9, -7.8, 0); placeA(C.mom, 35.1, -6.6, 0); placeA(C.you, 35.3, -8.6, 0.2); placeA(C.leo, 36.0, -9.0, 0.1, { face: { mouth: 'smile' }, holdHand: 0 });
    CAR.lights = false; thud(0.3, 0.2, 600); thud(0.3, -0.2, 600);
    cut([33.2, 1.5, -13.5], [35.5, 1.2, -6], 0.9);
    goA(C.dad, [[36.4, -5.2], [33, -2.4]], 1.25); goA(C.mom, [[34.8, -4.6], [32.0, -2.5]], 1.25);
    goA(C.you, [[35.0, -6.0], [32.3, -3.6]], 1.3); goA(C.leo, [[35.8, -6.4], [33.1, -3.9]], 1.35);
    yield 2.2;
    follow(() => { const m = [(C.dad.x + C.mom.x) / 2, 0, (C.dad.z + C.mom.z) / 2]; return [[m[0] + 2.6, 1.7, m[2] - 4.2], [m[0], 1.3, m[2] + 1]]; }, 0.9);
    yield () => C.dad.arrived && C.mom.arrived;
    C.dad.faceYaw = 0.2; gest(C.dad, 'watch', 4.4); yield 0.8;
    { const d = C.dad, fx = Math.sin(d.yaw), fz = -Math.cos(d.yaw); cut([d.x + fx * 1.15 - fz * 0.45, 1.62, d.z + fz * 1.15 + fx * 0.45], [d.x, 1.42, d.z], 0.6); }
    yield say('DAD', 'Huh. One minute till they close.', 2.8);
    cut([31.6, 1.65, -4.6], [32.6, 1.55, -2.4], 0.7); C.mom.look = head(C.dad); C.dad.look = head(C.mom);
    yield say('MOM', 'Perfect. Good time to pop into Box. Five minutes, tops.', 3.4);
    gest(C.dad, 'nod', 1);
    yield say('DAD', 'In and out.', 1.8);
    C.leo.look = head(C.you); C.you.look = head(C.leo); C.you.face = { eyes: 'narrow', mouth: 'frown' }; C.leo.face = { mouth: 'smile', brows: 'up' };
    cut([34.5, 1.18, -4.45], [32.5, 1.08, -3.68], 0.62);
    yield say('', 'You and Leo exchange a look. It is never five minutes.', 3.4);
    for (const k of ['dad', 'mom', 'you', 'leo']) C[k].look = null;
    par(function* () { for (let i = 0; i < 40; i++) { DOORS.front = Math.min(1, DOORS.front + 0.04); yield 0.02; } });
    music.vol = 0.05;
    goA(C.dad, [[32.2, 0], [33.6, 3.6]], 1.25); goA(C.mom, [[31.6, 0], [32.0, 4.2]], 1.25); goA(C.you, [[32.0, -0.5], [31.3, 4.6]], 1.25); goA(C.leo, [[32.6, -0.6], [32.3, 4.9]], 1.3);
    follow(() => [[C.mom.x - 0.6, 1.7, C.mom.z - 3.2], [C.mom.x + 0.3, 1.4, C.mom.z + 3]], 0.95);
    yield 2.4;
    cut([29.4, 1.55, 6.6], [32.0, 1.4, 1.6], 0.8);
    C.dana.face = { mouth: 'smile', brows: 'up' };
    yield () => C.dad.arrived;
    C.dana.gest = null; C.dana.look = head(C.dad);
    par(function* () { for (let i = 0; i < 40; i++) { DOORS.front = Math.max(0, DOORS.front - 0.03); yield 0.02; } });
    C.marcus.face = { eyes: 'narrow', mouth: 'frown' }; gest(C.marcus, 'sigh', 3); C.priya.face = { eyes: 'narrow', brows: 'angry' };
    yield say('DANA', 'Hi folks! Just so you know, we close in one minute.', 3.2);
    gest(C.dad, 'talk', 1.6); C.dad.look = head(C.dana);
    yield say('DAD', 'Oh, we’ll be quick.', 1.8);
    cut([30.5, 1.62, 3.15], [31.0, 1.58, 1.9], 0.5);
    yield 0.9; C.dana.face = { mouth: 'smile', eyes: 'narrow', brows: 'angry' };
    yield say('', 'Her smile stays on. Her eyes do not.', 2.6);
    yield fadeTo(1, 0.6);
    for (const k of ['you', 'leo', 'mom', 'dana', 'priya', 'manager']) C[k].visible = false;
    placeA(C.dad, 46, 3.85, Math.PI, { anim: 'sit', sitH: 0.5 });
    placeA(C.marcus, 49.6, 8.2, 0); goA(C.marcus, [[47.4, 6.1]], 1.1);
    storeClock = 9 * 60;
    cut([43.6, 1.45, 7.4], [47.0, 0.95, 4.9], 0.85); fadeTo(0, 0.6);
    yield () => C.marcus.arrived; C.marcus.look = head(C.dad); C.marcus.faceYaw = -0.5;
    gest(C.dad, 'talk', 8); C.dad.look = head(C.marcus);
    yield say('DAD', 'So, could I get this one in a custom fabric?', 2.8);
    yield say('MARCUS', '…Yes. Online, or at the—', 2.2);
    yield say('DAD', 'What are my options in, like, a performance velvet? And what’s the lead time? Ballpark.', 4.2);
    C.marcus.look = [LV.clock.x, LV.clock.y, LV.clock.z]; C.marcus.face = { eyes: 'narrow' };
    { const h = head(C.marcus), dx = LV.clock.x - h[0], dz = LV.clock.z - h[2], dl = Math.hypot(dx, dz), ux = dx / dl, uz = dz / dl;
      move([h[0] + ux * 1.6 - uz * 0.5, h[1] + 0.05, h[2] + uz * 1.6 + ux * 0.5], h, [h[0] + ux * 1.0 - uz * 0.3, h[1] + 0.02, h[2] + uz * 1.0 + ux * 0.3], h, 2.2, 0.6, 0.5); }
    yield 2.4;
    cut([62.2, 2.6, 8.8], [63.8, 2.6, 8.8], 0.5);
    yield say('', '9:00.', 1.8);
    yield fadeTo(1, 0.5);
    C.dad.visible = false; C.marcus.visible = false;
    placeA(C.mom, 34.25, 33.2, -Math.PI / 2, { holdR: 'plate', gest: { name: 'hold2', t0: NOW } });
    placeA(C.priya, 37.6, 30.0, 0);
    cut([36.4, 1.5, 31.4], [34.0, 1.05, 34.4], 0.85); fadeTo(0, 0.5);
    yield say('', 'Mom picks up a plate and studies the bottom.', 2.6);
    goA(C.mom, [[34.25, 35.4]], 0.9); yield () => C.mom.arrived; C.mom.faceYaw = -Math.PI / 2;
    gest(C.mom, 'reach', 1.0); yield 0.7;
    C.mom.holdR = null; Object.assign(PLATE, { visible: true, x: 33.42, y: 0.98, z: 35.4 }); thud(0.15, 0, 3000);
    yield 0.5; goA(C.mom, [[36.4, 36.6], [36.4, 38.2]], 0.9);
    say('', 'On a completely different shelf.', 2.2);
    goA(C.priya, [[35.4, 32.4], [34.3, 35.2]], 1.2); C.priya.face = { eyes: 'narrow', brows: 'angry', mouth: 'frown' };
    yield () => C.priya.arrived; C.priya.faceYaw = -Math.PI / 2; gest(C.priya, 'sigh', 2.2);
    yield say('PRIYA', '(sigh)', 1.6);
    gest(C.priya, 'reach', 0.8); yield 0.5; PLATE.visible = false; C.priya.holdR = 'plate';
    goA(C.priya, [[34.3, 33.2]], 1.0); yield () => C.priya.arrived; C.priya.faceYaw = -Math.PI / 2; gest(C.priya, 'reach', 0.8); yield 0.5; C.priya.holdR = null;
    C.mom.faceYaw = Math.PI / 2; yield 0.4; C.mom.holdR = 'plate'; gest(C.mom, 'hold2', 4); C.priya.look = head(C.mom);
    yield say('', 'Mom picks up another plate.', 2.4);
    yield fadeTo(1, 0.5);
    C.mom.visible = false;
    { const fc = (x, z) => Math.atan2(23.3 - x, -(7.4 - z)); placeA(C.dana, 22.35, 7.85, fc(22.35, 7.85)); placeA(C.marcus, 23.3, 6.75, fc(23.3, 6.75)); placeA(C.priya, 24.25, 7.85, fc(24.25, 7.85)); }
    gest(C.dana, 'whisper', 30); gest(C.priya, 'whisper', 30); gest(C.marcus, 'cross', 30);
    for (const k of ['dana', 'marcus', 'priya']) { C[k].look = [23.3, 1.5, 7.4]; C[k].face = { eyes: 'narrow', brows: 'angry' }; }
    placeA(C.dad, 34.8, 6.8, -Math.PI / 2 - 0.2, { holdR: 'pillow' });
    cut([23.6, 1.6, 10.3], [23.3, 1.4, 7.4], 0.8); fadeTo(0, 0.5);
    yield say('PRIYA', 'What are they still doing here?', 2.4);
    yield say('MARCUS', 'He asked about performance velvet.', 2.4);
    yield say('PRIYA', 'Does she know we close at nine?', 2.3);
    C.dana.gest = null; yield 0.4;
    yield say('DANA', '…She knows.', 2.0);
    for (const k of ['dana', 'marcus', 'priya']) C[k].look = head(C.dad);
    move([23.6, 1.6, 10.3], [23.3, 1.4, 7.4], [21.4, 1.7, 9.6], [30.0, 1.3, 7.0], 1.6, 0.8, 0.75);
    gest(C.dad, 'wavePillow', 4);
    yield 0.5;
    yield say('DAD', 'Hey! Do you guys have this in the back?', 2.8);
    for (const k of ['dana', 'marcus', 'priya']) { C[k].face = { eyes: 'closed', brows: 'angry', mouth: 'frown' }; C[k].gest = null; }
    cut([23.4, 1.6, 9.5], [23.3, 1.5, 7.4], 0.65);
    yield say('', 'All three close their eyes at the same time.', 2.8);
    yield fadeTo(1, 0.8);
    hideAll();
    yield say('', 'Mom and Dad will be a while.', 2.4);
    fadeTo(0, 0.8);
  }
  function* sceneBalcony() {
    placeA(C.you, 40.6, 15.4, -Math.PI / 2, { y: F1 }); placeA(C.leo, 40.6, 16.3, -Math.PI / 2, { y: F1, holdHand: 0 });
    C.you.visible = false;
    gatherGroup(true);
    for (const k of Object.keys(GROUP)) C[k].look = k === 'manager' ? head(C.dad) : head(C.manager);
    C.mom.face = { brows: 'sad' }; C.dad.face = { brows: 'up' };
    for (const k of STAFF) { setCreep(C[k], 2); C[k].gest = { name: 'fold', t0: NOW }; }
    music.vol = 0.04; ambDim = 0.85;
    const POV = [40.45, F1 + 1.32, 15.5];
    cut(POV, [32.5, 1.4, 14.2], 0.7);
    yield say('', 'Voices below. Every employee is standing around Mom and Dad. All of them are smiling.', 3.8);
    move(POV, [32.5, 1.4, 14.2], [40.3, F1 + 1.28, 15.4], [32.5, 1.5, 14.0], 6, 0.7, 0.42);
    gest(C.dad, 'talk', 3);
    yield say('DAD', 'We’re just browsing, we’ll be out of your hair in—', 3);
    yield say('MANAGER', 'We told you not to stay too late.', 2.8);
    gest(C.mom, 'shrug', 2.5);
    yield say('MOM', 'It’s been, what, ten minutes?', 2.4);
    cut([32.5, 1.62, 14.5], [32.5, 1.72, 12.9], 0.6);
    C.manager.look = [32, 9, 20]; gest(C.manager, 'lookUp', 6);
    yield 1.0;
    yield say('MANAGER', 'You don’t want to be here after it’s too late.', 3.2);
    par(function* () { for (let i = 0; i < 60; i++) { music.warp = lerp(music.warp, 0.5, 0.06); yield 0.05; } });
    cut(POV, [32.5, 1.4, 14.2], 0.6);
    par(function* () { for (let i = 0; i < 14; i++) { ambDim = Math.random() < 0.5 ? 0.35 : 0.85; yield 0.08 + Math.random() * 0.12; } ambDim = 0.8; });
    yield 1.6; jingle(0.08, 0.6, 4); yield 1.2; jingle(0.1, 0.5, 5);
    C.leo.face = { eyes: 'wide', mouth: 'o' }; C.leo.look = [32, 9, 20];
    cut([39.25, F1 + 0.5, 16.75], [40.6, F1 + 0.98, 16.3], 0.62);    // low, between the rail cables
    yield say('LEO', '…What was that?', 2.0);
    // every head comes up at once
    for (const k of STAFF) { setCreep(C[k], 3); C[k].gest = { name: 'fold', t0: NOW }; C[k].look = POV; }
    C.leo.look = head(C.manager);
    tone(98, 2.4, 0.16, 'sine', 0, -18); tone(147, 2.4, 0.07, 'sine', 0, -20);
    { const over = [39.8, F1 + 1.22, 15.2]; for (const k of STAFF) C[k].look = over; move(over, [32.5, 1.3, 14.3], [39.7, F1 + 1.2, 15.15], [32.5, 1.4, 14.3], 5.2, 0.4, 0.3); }   // leaning out over the rail
    yield say('', 'Every one of them looks up. Straight at you.', 3.0);
    C.leo.face = { eyes: 'wide', mouth: 'o', brows: 'sad' };
    yield say('LEO', '(whisper) They can see us.', 2.2);
    Object.assign(P, { x: 40.8, y: F1, z: 15.4, yaw: -Math.PI / 2, pitch: -0.2 });
  }
  function* sceneCrash() {
    music.warp = 0.5; music.vol = 0.025;
    placeA(C.you, 25.5, 27.3, 0.5); placeA(C.leo, 26.2, 27.6, 0.5, { holdHand: 0 });
    gatherGroup(true);
    for (const k of Object.keys(GROUP)) C[k].look = head(C.you);
    cut([24.3, 1.75, 30.2], [30.0, 1.4, 19.0], 0.95);
    yield 0.6;
    for (const k of STAFF) { setCreep(C[k], 3); C[k].gest = { name: 'fold', t0: NOW }; C[k].look = head(C.you); }
    gest(C.mom, 'wave', 1.5); C.mom.face = { mouth: 'smile' };
    yield say('MOM', 'There you are! Come on, we’re—', 1.6);
    C.manager.look = [32, 9, 20]; for (const k of ['dana', 'marcus', 'priya']) C[k].look = [32, 9, 20];
    yield say('MANAGER', 'Here he is.', 1.3);
    SKY.broken = true; shatter(0.8); cam.shake = 0.8;
    burstGlass(32, 8.8, 20, 160, 7, -1);
    par(function* () { for (let i = 0; i < 10; i++) { ambDim = Math.random() < 0.5 ? 0.3 : 1; yield 0.06; } ambDim = 1; });
    // he comes down facing your parents, with his back to you
    const toParents = Math.atan2(32.5 - 29.5, -(14.4 - 21.5)), toKids = Math.atan2(25.8 - 29.5, -(27.4 - 21.5));
    Object.assign(KV, { x: 29.5, y: 9.5, z: 21.5, yaw: toParents, visible: true, anim: 'leap', gest: null, sackFull: false, look: null, sack: false });
    move([24.3, 1.75, 30.2], [30.0, 1.4, 19.0], [24.0, 1.6, 30.6], [29.5, 3.5, 21.5], 0.8, 0.95, 1.05);
    for (let i = 0; i < 12; i++) { KV.y = Math.max(0, 9.5 - 9.8 * Math.pow((i + 1) / 12, 2)); yield 0.04; }
    KV.y = 0; KV.anim = 'land'; DISPLAY.smashed = true; burstOrnaments(29.5, 1, 21.5, 90); boxSmash(); thud(0.9, 0, 200); cam.shake = 1.2;
    C.you.face = { eyes: 'wide', mouth: 'o', brows: 'up' }; C.leo.face = { eyes: 'wide', mouth: 'o', brows: 'up' };
    // your parents turn to face it and stagger back; Dad puts an arm out in front of Mom. The staff do not move.
    for (const [k, bx, bz] of [['dad', 31.9, 13.5], ['mom', 33.3, 13.3]]) {
      const a = C[k]; a.face = { eyes: 'wide', mouth: 'open', brows: 'up' }; a.look = [29.5, 2.1, 21.5];
      a.yaw = a.faceYaw = Math.atan2(29.5 - a.x, -(21.5 - a.z)); goA(a, [[bx, bz]], 0.9); a.faceYaw = a.yaw;
    }
    goA(C.priya, [[34.7, 16.3]], 1.4); C.priya.faceYaw = Math.atan2(29.5 - 34.7, -(21.5 - 16.3));
    for (const k of STAFF) { C[k].look = null; C[k].gest = { name: 'bow', t0: NOW }; }   // heads down, hands folded
    yield 0.5;
    // wide, from the balcony: the tree, the thing in the broken display, your parents, the bowing staff
    cut([39.8, 6.0, 24.5], [29.6, 1.0, 20.2], 0.95);
    KV.anim = 'idle'; KV.gest = { name: 'rise', t0: NOW, dur: 2.6 };
    yield 1.4; jingle(0.25, 0, 3); yield 1.2;
    // over its shoulder: your parents' faces
    move([28.5, 4.0, 25.9], [32.4, 1.3, 14.2], [28.9, 3.75, 25.0], [32.4, 1.35, 14.2], 1.8, 0.38, 0.33);   // down over its horns at your parents, pushing in
    KV.gest = { name: 'roar', t0: NOW, dur: 1.8 }; roar();
    gest(C.mom, 'scream', 2.6); gest(C.dad, 'shield', 2.8); yelp(0.18);
    yield 1.6;
    cut([31.65, 1.72, 17.5], [32.55, 1.56, 14.1], 0.5);
    yield say('DAD', 'What— what is that?!', 2.0);
    yield say('', 'Mom screams. The staff fold their hands and bow their heads.', 3.0);
    // then, slowly, it turns around
    cut([27.2, 1.15, 25.4], [29.5, 2.0, 21.5], 0.9);
    KV.sack = true; jingle(0.2, 0, 3);
    { const y0 = KV.yaw; let d = toKids - y0; d = Math.atan2(Math.sin(d), Math.cos(d)); KV.anim = 'walk';
      for (let i = 0; i < 30; i++) { KV.yaw = y0 + d * smooth((i + 1) / 30); KV.phase += 0.12; yield 0.05; } KV.anim = 'idle'; }
    KV.gest = null;
    KV.look = head(C.you);
    cut([27.2, 2.0, 24.7], [29.5, 2.3, 21.5], 0.7);
    yield 1.8;
    KV.look = head(C.leo); KV.gest = { name: 'tilt', t0: NOW, dur: 2 };
    yield 1.2;
    C.leo.look = [29.5, 2.3, 21.5];
    { const L = C.leo, fx = Math.sin(L.yaw), fz = -Math.cos(L.yaw); cut([L.x + fx * 0.95, 1.0, L.z + fz * 0.95], [L.x, 0.95, L.z], 0.6); }
    yield say('LEO', '(whisper) …Is he part of the store?', 2.4);
    cut([29.9, 1.6, 29.7], [26.7, 1.2, 26.1], 1.0);
    KV.look = null; KV.anim = 'run';
    { const sx = KV.x, sz = KV.z, ex = C.leo.x + 0.6, ez = C.leo.z - 0.9; for (let i = 0; i < 10; i++) { const u = (i + 1) / 10; KV.x = lerp(sx, ex, u); KV.z = lerp(sz, ez, u); KV.phase += 0.6; yield 0.04; } }
    KV.anim = 'idle'; KV.gest = { name: 'grab', t0: NOW, dur: 0.8 }; roar(); yelp(0.25);
    yield 0.35; C.leo.visible = false; C.you.holdHand = null; KV.sackFull = true; cam.shake = 0.6;
    yield 0.6;
    KV.anim = 'crouch'; KV.yaw = Math.atan2(31 - KV.x, -(30 - KV.z)); yield 0.45;
    KV.anim = 'leap'; jingle(0.3, 0, 6);
    follow(() => [[33.2, 1.3, 23.9], [KV.x, KV.y + 1.6, KV.z]], 1.05);
    { const sx = KV.x, sz = KV.z; for (let i = 0; i < 20; i++) { const u = (i + 1) / 20; KV.x = lerp(sx, 31, u); KV.z = lerp(sz, 30.5, u); KV.y = F1 * u + 4.2 * Math.sin(u * Math.PI); yield 0.04; } }
    KV.y = F1; KV.anim = 'land'; thud(0.6, 0.3, 300); yield 0.5;
    KV.anim = 'walk'; KV.yaw = -Math.PI / 2 - 0.4;
    for (let i = 0; i < 30; i++) { KV.x -= 0.09; KV.z += 0.05; KV.phase += 0.25; if (i % 4 === 0) jingle(0.25 * (1 - i / 30), 0.4, 4); yield 0.04; }
    KV.visible = false;
  }
  function* sceneDoors() {
    C.you.face = { eyes: 'wide', mouth: 'open', brows: 'sad' };
    cut([31.5, 1.6, 10.8], [32.5, 1.5, 14.5], 0.9);
    C.dad.face = { eyes: 'wide', mouth: 'open', brows: 'up' }; gest(C.dad, 'scream', 1.5);
    for (const k of STAFF) { C[k].gest = { name: 'fold', t0: NOW }; C[k].look = null; }
    yield say('DAD', 'THE KIDS! Somebody—', 1.4);
    // nobody panics. Two of them take a parent by the arm each and walk them to the side door.
    const exitPath = (x, z, o) => [[x + 1.5, z - 0.6 + o], [42.2, 13.8 + o], [42.6 + o, 28.9], [62.4, 29.4 + o * 0.5], [63.8, 30.0], [66.4, 30.2], [68.5, 27.5 + o], [71, 24]];
    par(function* () { for (let i = 0; i < 30; i++) { DOORS.side = Math.min(1, DOORS.side + 0.04); yield 0.03; } });
    const off = { dad: 0, marcus: 0.75, mom: -0.2, priya: -0.95, dana: 0.3, manager: -0.5 };
    for (const k of ['dad', 'mom', 'manager', 'marcus', 'priya', 'dana']) { C[k].look = null; goA(C[k], exitPath(C.dad.x, C.dad.z, off[k]), k === 'dana' ? 5.0 : k === 'manager' ? 3.4 : 3.9); }
    for (const k of ['marcus', 'priya']) C[k].gest = { name: 'usher', t0: NOW };
    C.mom.face = { eyes: 'wide', mouth: 'open', brows: 'sad' };
    cut([36.6, 1.5, 12.2], [34.2, 1.45, 14.3], 0.8);
    yield say('MARCUS', 'This way, sir. We’re closed.', 2.2);
    follow(() => [[C.mom.x - 3.2, 2.0, C.mom.z - 2.0], [C.mom.x, 1.3, C.mom.z]], 1.0);
    yield 0.6;
    C.mom.look = [25, 1.2, 27]; gest(C.mom, 'scream', 2);
    yield say('MOM', 'NO— LEO! Let GO of me!', 2.0);
    yield say('PRIYA', 'Thank you for shopping with us.', 2.2);
    C.mom.look = null;
    { let w = 0; yield () => (w += 1) > 900 || C.mom.x > 64.4; }
    placeA(C.you, 54, 29.2, Math.PI / 2, { face: { eyes: 'wide', mouth: 'open' } }); goA(C.you, [[62.6, 29.6]], 4.2);
    follow(() => [[C.you.x - 3.0, 1.7, C.you.z - 1.2], [C.you.x + 2, 1.3, C.you.z]], 1.0);
    yield () => C.you.arrived;
    par(function* () { for (let i = 0; i < 25; i++) { DOORS.side = Math.max(0, DOORS.side - 0.05); yield 0.02; } });
    placeA(C.dana, 64.75, 30.52, -Math.PI / 2, { holdR: 'keys' }); C.dana.look = head(C.you);
    yield 0.4; gest(C.dana, 'lock', 1.0); lockClick(); yield 1.0;
    cut([62.3, 1.55, 30.42], [64.75, 1.55, 30.52], 0.6);
    gest(C.dana, 'shake', 1.8); yield 2.0;
    move([62.6, 1.6, 30.45], [64.75, 1.55, 30.52], [63.25, 1.6, 30.5], [64.75, 1.57, 30.52], 3.0, 0.45, 0.33);
    maw(C.dana, 4.2, 1.0); C.dana.mawMax = 1; yield 1.6; C.dana.gest = { name: 'tiltHead', t0: NOW }; tone(180, 3.6, 0.12, 'sine', 0, -70); tone(92, 3.6, 0.1, 'sine', 0.4, -20);
    yield 4.2;
    placeA(C.you, 32.75, 1.5, 0, { face: { eyes: 'wide', mouth: 'open' } });
    placeA(C.marcus, 33.0, -0.7, Math.PI, { holdR: 'keys' }); C.marcus.look = head(C.you); DOORS.front = 0;
    cut([31.2, 1.7, 4.4], [32.3, 1.4, -0.6], 0.8);
    gest(C.marcus, 'lock', 1.0); lockClick(); yield 1.2;
    gest(C.marcus, 'shake', 1.6); yield 1.4;
    cut([33.05, 1.72, 0.75], [33.0, 1.74, -0.7], 0.5);
    maw(C.marcus, 3.8, 0.5); C.marcus.mawMax = 1; yield 1.0; C.marcus.gest = { name: 'tiltHead', t0: NOW }; tone(160, 3.4, 0.12, 'sine', 0, -65); tone(86, 3.4, 0.1, 'sine', 0.4, -18);
    yield 4.0;
    goA(C.marcus, [[30.5, -6], [27, -16]], 1.1); C.marcus.look = null;
    placeA(C.dana, 40, -2.5, -Math.PI / 2); goA(C.dana, [[33.5, -7], [29, -17]], 1.1);
    cut([32.0, 1.6, 2.2], [32.2, 1.2, -6], 0.9);
    yield 3.2;
    jingle(0.2, 0.3, 6); yield 1; sob(0.1, 0.2); yield 1;
    cut([32, 1.6, 6], [32.6, 2.4, 18], 1.0); music.on = false;
    for (const z of [5, 6, 7, 13, 14, 15, 0, 1, 2, 8, 9, 10, 12, 4]) { ZT[z] = 0.12; ZL[z] = 0.12; thud(0.3, 0, 250); yield 0.35; }
    ZL[3] = ZT[3] = 0.35; ZL[11] = ZT[11] = 0.35;
    $('titlecard').style.opacity = 1; yield FF ? 0 : 3; $('titlecard').style.opacity = 0;
    hideAll();
  }
  function* sceneEnding() {
    hideAll(); music.on = false;
    placeA(C.you, 32.1, 1.6, 0, { face: { eyes: 'wide', mouth: 'open' } }); placeA(C.leo, 32.6, 2.6, 0, { face: { eyes: 'wide', mouth: 'open' } });
    Object.assign(KV, { x: 32.3, y: 0, z: 4.6, yaw: 0, visible: true, anim: 'run', sackFull: false, gest: null, look: null });
    goA(C.you, [[32, -3], [34.6, -6.0]], 4.6); goA(C.leo, [[32.5, -2.6], [35.2, -6.2]], 4.4);
    cut([30.6, 0.7, -3.6], [32.2, 1.4, 1.5], 0.95);
    timeScale = 0.28; DOORS.front = 0;
    par(function* () { for (let i = 0; i < 10; i++) { DOORS.front = Math.min(1, DOORS.front + 0.12); yield 0.02; } });
    burstGlass(32, 1.6, 0, 120, 3.5, 1); shatter(0.7); cam.shake = 0.3;
    par(function* () { for (let i = 0; i < 60; i++) { KV.z = Math.max(0.8, KV.z - 0.12); KV.phase += 0.3; yield 0.016; } KV.anim = 'idle'; KV.gest = { name: 'grab', t0: NOW, dur: 1.2 }; });
    yield 2.6;
    timeScale = 1;
    CAR.x = 36.5; CAR.z = -7.5; CAR.yaw = Math.PI + 0.25; CAR.lights = true; CAR.visible = true;
    placeA(C.mom, 35.0, -5.6, Math.PI * 0.85, { face: { mouth: 'open', eyes: 'wide' } }); placeA(C.dad, 37.9, -7.4, Math.PI * 0.9, { face: { mouth: 'open', eyes: 'wide' } });
    gest(C.mom, 'wave', 3); gest(C.dad, 'wave', 3);
    placeA(C.dana, 30.6, -1.5, Math.PI + 0.2, ); maw(C.dana, 0.1); C.dana.mawMax = 1; C.dana.look = head(C.you);
    KV.x = 32; KV.z = 0.6; KV.yaw = Math.PI; KV.anim = 'idle'; KV.gest = null; KV.look = head(C.dana);
    cut([35.8, 1.4, -11.5], [33.5, 1.2, -3], 0.95);
    yield say('MOM', 'OVER HERE! RUN!', 1.8);
    yield 0.6;
    cut([28.4, 1.5, -3.6], [31.5, 1.6, -0.6], 0.9);
    yield 0.6;
    KV.gest = { name: 'grab', t0: NOW, dur: 1.5 }; roar(); C.dana.face = { mouth: 'open', eyes: 'wide', brows: 'up' };
    yield 0.4;
    yield say('DANA', 'We’re CLOSED—', 1.2);
    for (let i = 0; i < 12; i++) { C.dana.x = lerp(30.6, 32, i / 12); C.dana.z = lerp(-1.5, 1.4, i / 12); KV.z = lerp(0.6, 3.5, i / 12); yield 0.03; }
    C.dana.visible = false; KV.visible = false;
    par(function* () { for (let i = 0; i < 20; i++) { DOORS.front = Math.max(0, DOORS.front - 0.06); yield 0.02; } });
    yield 0.8; jingle(0.2, 0, 8); yield 0.4; jingle(0.15, 0, 6);
    yield 1.0;
    // the rest of the staff, lined up in the snow, watching the car
    { const row = [['marcus', 27.4], ['manager', 28.6], ['priya', 29.8]];
      for (const [k, x] of row) { placeA(C[k], x, -2.3, 0); setCreep(C[k], 3); maw(C[k], 3.5, 0.6); C[k].mawMax = 0.8; C[k].gest = { name: 'fold', t0: NOW }; C[k].look = [CAR.x, 1.3, CAR.z]; }
      C.manager.gest = { name: 'wave', t0: NOW };
      move([32.6, 1.5, -6.6], [28.6, 1.45, -2.3], [31.6, 1.5, -5.6], [28.6, 1.5, -2.3], 4, 0.7, 0.55); }
    yield say('', 'The others haven’t moved. They’re still smiling. One of them waves.', 3.6);
    yield 0.4;
    yield fadeTo(1, 0.8);
    for (const k in C) C[k].visible = false;
    CAR.visible = false; CAR.inside = true; CAR.lights = false;
    const cxz = (lx, lz) => [CAR.x + lx * Math.cos(CAR.yaw) + lz * Math.sin(CAR.yaw), CAR.z - lx * Math.sin(CAR.yaw) + lz * Math.cos(CAR.yaw)];
    const seat = (k, lx, lz, extra) => { const [x, z] = cxz(lx, lz); placeA(C[k], x, z, CAR.yaw + Math.PI, Object.assign({ anim: 'sit', sitH: 0.62, y: 0 }, extra)); };
    seat('leo', -0.38, 1.0, { face: { brows: 'sad' } }); seat('you', 0.38, 1.0); seat('dad', -0.4, 0); seat('mom', 0.4, 0);
    { const p = cxz(0.32, 0.95), l = cxz(-0.35, 0.65); cut([p[0], 1.25, p[1]], [l[0], 0.85, l[1]], 0.9); }
    fadeTo(0, 0.8);
    par(function* () { while (CAR.inside) { for (let i = 0; i < 3; i++) { const [x, z] = cxz((Math.random() < 0.5 ? -1 : 1) * (1.2 + Math.random()), -3 - Math.random() * 3); const p = spawn({ kind: 'snow', x, y: 0.6 + Math.random() * 1.6, z, vx: 0, vy: -0.2, vz: 0, life: 1.4, size: 0.03, col: [0.85, 0.9, 1], mat: MAT.GLOW, floor: -1 }); const dir = cxz(0, 9); p.vx = (dir[0] - CAR.x) * 1.4; p.vz = (dir[1] - CAR.z) * 1.4; } yield 0.03; } });
    yield 1.4;
    yield say('DAD', '…We’ll order the sofa online.', 2.8);
    yield say('MOM', 'David.', 1.6);
    gest(C.leo, 'hold', 8);
    yield say('', 'Leo is holding his fist closed. You nudge him. He opens his hand.', 3.4);
    C.leo.holdR = 'bell';
    { const h = ACT.handPos(C.leo, 1) || head(C.leo); cut([h[0] + 0.25, h[1] + 0.3, h[2] + 0.3], h, 0.4); }
    yield say('', 'A tiny brass bell.', 2.2);
    yield 0.6; jingle(0.35, 0, 2); yield 1.4;
    yield fadeTo(1, 1.2);
    say('', '', 0.1);
    jingle(0.05, 0.6, 3); yield 1.6;
    CAR.inside = false; CAR.visible = true;
  }

  // ---------------- flow ----------------
  function showOnly(idShown) { for (const s of ['title', 'pause', 'end']) $(s).style.display = s === idShown ? 'flex' : 'none'; }
  function startStory() { audioInit(); showOnly(null); runScene(sceneOpening, startExplore); }
  function* sceneQuickIntro() {
    hideAll(); for (let i = 0; i < 16; i++) { ZL[i] = ZT[i] = 1; }
    SKY.broken = true; DISPLAY.smashed = true;
    cut([32, 1.6, 6], [32.6, 2.4, 18], 1.0); fadeTo(0, 0);
    yield say('', 'It took Leo upstairs. The doors are locked.', 3);
    for (const z of [5, 6, 7, 13, 14, 15, 0, 1, 2, 8, 9, 10, 12, 4]) { ZT[z] = 0.12; }
    ZT[3] = 0.35; ZT[11] = 0.35; yield 1;
  }
  function startJump() { audioInit(); showOnly(null); runScene(sceneQuickIntro, startHunt); }
  function pause() { if (!playing()) return; pausedFrom = mode; mode = 'pause'; showOnly('pause'); $('skipAhead').style.display = pausedFrom === 'explore' && EX && EX.stage === 'explore' ? 'inline-block' : 'none'; if (document.pointerLockElement) document.exitPointerLock(); }
  function resume() { mode = pausedFrom || 'play'; showOnly(null); lastTime = performance.now(); lock(); }
  function toTitle() { hush(); $('ears').style.display = 'none'; mode = 'title'; SC = null; timers.length = 0; document.body.classList.remove('cine', 'explore', 'stare'); $('fade').style.opacity = 0; showOnly('title'); $('hud').style.display = 'none'; $('skipBtn').style.display = 'none'; refreshBest(); if (document.pointerLockElement) document.exitPointerLock(); music.on = false; hideAll(); timeScale = 1; }
  function caught(reason) {
    if (mode !== 'play') return;
    // jumpscare first: he is suddenly right there, and the camera is dragged up to his face
    mode = 'scare'; G.reason = reason; SCARE = { t: 0, from: [P.x, P.y + EYE(), P.z], yaw: P.yaw, pitch: P.pitch };
    // he is only ever where he walked to. If he is not within arm's reach (he took Leo, not you), skip the face-to-face and end the round.
    if (!(Math.hypot(K.x - P.x, K.z - P.z) < 2.6 && Math.abs(K.y - P.y) < 1)) { scream(); roar(); FEAR = 1; $('hud').style.display = 'none'; $('msg').style.opacity = 0; return endCaught(); }
    K.yaw = Math.atan2(P.x - K.x, -(P.z - K.z));
    Object.assign(KV, { x: K.x, y: K.y, z: K.z, yaw: K.yaw, visible: true, anim: 'idle', scale: 1.1, look: null, gest: { name: 'scare', t0: NOW } });   // face-to-face close-up, staged at his old size
    scream(); FEAR = 1; $('hud').style.display = 'none'; $('msg').style.opacity = 0;
    try { if (navigator.vibrate) navigator.vibrate([60, 30, 220]); } catch (e) {}
  }
  let SCARE = null;
  function endCaught() {
    const reason = G.reason; mode = 'end'; KV.gest = null;
    $('endTitle').textContent = 'INTO THE SACK'; $('endTitle').className = 'lose';
    const tip = /breathing/.test(reason) ? 'With the microphone on, he hears your room. When he bends over your hiding place, keep completely quiet.'
      : /climb into/.test(reason) ? 'Get out of his sight before you hide. If he watches you climb in, he pulls you out.'
      : /You moved/.test(reason) ? 'When he bends down and stares, stay put. He leaves after about half a minute.'
      : /Leo back/.test(reason) ? 'Leo falls at the bottom of the stairs. Turn around and go back for him straight away.'
      : /last second/.test(reason) ? (G.keys ? 'Sprint the whole way and take the big staircase. He is slow on the stairs.' : 'Pick up the keys from a register before you open Leo’s hiding place.')
      : 'Walking is quiet, running is loud. Crouch behind furniture when you hear the bells getting louder.';
    $('endText').innerHTML = `${reason}<br>You lasted ${fmt(G.time)} and found ${G.clues} of 3 of Leo’s things.<br><span class="tipline">${tip}</span>`;
    showOnly('end'); $('hud').style.display = 'none'; if (document.pointerLockElement) document.exitPointerLock();
  }
  function win() {
    if (mode !== 'play') return;
    KV.scale = KS; FEAR = 0;
    const t = Math.floor(G.time), prev = getBest(diffKey), best = !prev || t < prev;
    if (best) setBest(diffKey, t);
    $('hud').style.display = 'none';
    runScene(sceneEnding, () => {
      mode = 'end'; $('fade').style.transition = 'none'; $('fade').style.opacity = 0;
      $('endTitle').textContent = 'YOU GOT LEO OUT'; $('endTitle').className = 'win';
      $('endText').innerHTML = `Escaped in <b>${fmt(t)}</b> on ${G.D.label}${best ? ' — new best!' : ''}<br>He spotted you ${G.sightings} time${G.sightings === 1 ? '' : 's'}. You hid ${G.hides} time${G.hides === 1 ? '' : 's'}.`;
      showOnly('end');
    });
  }
  function refreshBest() { $('best').textContent = 'Best escapes — ' + ['easy', 'normal', 'hard'].map((k) => `${DIFF[k].label}: ${getBest(k) ? fmt(getBest(k)) : '—'}`).join(' · '); }
  document.querySelectorAll('[data-diff]').forEach((b) => b.addEventListener('click', () => { diffKey = b.dataset.diff; document.querySelectorAll('[data-diff]').forEach((x) => x.classList.toggle('sel', x === b)); }));
  function micLabel() { const t = 'Microphone: ' + (MIC.on ? 'ON — he can hear your room' : 'off'); $('micBtn').textContent = t; $('micBtn2').textContent = t; $('micBtn').classList.toggle('sel', MIC.on); $('micNote').textContent = MIC.err || (MIC.on ? (MIC.ok ? 'Listening. Headphones work best. Stay quiet while you hide.' : 'Your browser will ask to use the microphone.') : 'Optional: let Krampus hear you talk, laugh or scream in real life.'); }
  async function micToggle() {
    MIC.on = !MIC.on; MIC.err = '';
    if (MIC.on) { $('micBtn').textContent = $('micBtn2').textContent = 'Microphone: asking…'; $('micNote').textContent = 'Allow the microphone in the box your browser shows.'; }
    if (MIC.on && !(await micStart())) MIC.on = false; else if (!MIC.on) micStop();
    try { localStorage.setItem('box-mic', MIC.on ? '1' : '0'); } catch (e) {}
    micLabel();
  }
  $('micBtn').addEventListener('click', micToggle); $('micBtn2').addEventListener('click', micToggle);
  micLabel();
  for (const id of ['play', 'jump', 'again']) $(id).addEventListener('click', () => { if (MIC.on && !MIC.ok) micStart().then((ok) => { if (!ok) MIC.on = false; micLabel(); }); });   // switched on last time: reconnect
  $('play').addEventListener('click', startStory);
  $('jump').addEventListener('click', startJump);
  $('again').addEventListener('click', startJump);
  $('menu').addEventListener('click', toTitle);
  $('resume').addEventListener('click', resume);
  $('quit').addEventListener('click', toTitle);
  $('skipAhead').addEventListener('click', () => { if (EX) { EX.t = Math.max(EX.t, EXPLORE_SECS - 2); gatherGroup(true); for (const k of ['gather', 'bells1', 'n1', 'n2', 'n3', 'n4', 'n5', 'n6', 'dim', 'posts']) EX.events.add(k); EX.hs = 2; if (EX.leo.mode !== 'follow') popLeo(true); resume(); } });

  // ---------------- drawing ----------------
  const BUF = new DynBuf(), ABUF = new DynBuf(1 << 14), MBUF = new DynBuf(1 << 14);
  const camInfo = { eye: [0, 0, 0], yaw: 0, pitch: 0, fov: 1.15 };
  function blob(x, y, z, r) { MBUF.emit(blobMesh, A.chain(A.T(x, y + 0.012, z), A.S(r))); }
  function drawWorld(t) {
    BUF.reset(); ABUF.reset(); MBUF.reset();
    for (const k in cast) {
      const a = cast[k]; if (!a.visible) continue;
      const talking = a.talkUntil && a.talkUntil > NOW && (!a.face.mouth || a.face.mouth === 'neutral' || a.face.mouth === 'smile');
      if (a.face.mouth === 'maw') a.face.open = smooth(clamp((NOW - a.mawT0) / a.mawDur, 0, 1)) * (a.mawMax || 1);
      const keep = a.face; if (talking) a.face = Object.assign({}, a.face, { mouth: Math.sin(NOW * 16 + a.seed) > 0 ? 'o' : 'neutral' });
      ACT.drawPerson(BUF, a, t); a.face = keep;
      if (a.anim !== 'sit') blob(a.x, a.y || 0, a.z, ACT.dims(a.id).H * 0.17);
    }
    if (KV.visible) { ACT.drawKrampus(BUF, KV, t); blob(KV.x, Math.max(0, surfaceY(KV.x, KV.z, KV.y + 0.1)), KV.z, 0.8); }
    if (CAR.visible) { BUF.emit(ACT.carMesh(), A.mul(A.T(CAR.x, 0, CAR.z), A.Ry(CAR.yaw))); blob(CAR.x, 0, CAR.z, 2.3); }
    if (CAR.inside) BUF.emit(ACT.carInteriorMesh(), A.mul(A.T(CAR.x, 0, CAR.z), A.Ry(CAR.yaw)));
    drawDoor(BUF, ABUF, LV.doors.front, DOORS.front); drawDoor(BUF, ABUF, LV.doors.side, DOORS.side);
    drawClock(BUF);
    const SK = LV.skylight, skM = A.T(SK.x, SK.y - 0.05, SK.z);
    if (!SKY.broken) { BUF.emit(skyRibs, skM); ABUF.emit(skyGlass, skM); } else { BUF.emit(skyBrokenRibs, skM); ABUF.emit(skyShards, skM); }
    const cd = LV.crashDisplay; BUF.emit(DISPLAY.smashed ? dispBroken : dispMesh, A.mul(A.T(cd.x, 0, cd.z), A.Ry(cd.yaw)));
    if (PLATE.visible) BUF.emit(ACT.propMesh('plate'), A.T(PLATE.x, PLATE.y, PLATE.z));
    if (G && mode === 'play') {
      const g = new Geo();
      for (const it of G.items) {
        if (it.taken) continue;
        const bob = Math.sin(t * 3 + it.x) * 0.05;
        if (it.kind === 'keys') BUF.emit(ACT.propMesh('keys'), A.chain(A.T(it.x, it.y + 0.08 + bob * 0.3, it.z), A.Ry(t)));
        else {
          const col = hex(CLUES[it.n].col);
          if (it.n === 0) { g.ellipsoid(it.x, it.y + 0.05, it.z, 0.08, 0.045, 0.11, col, MAT.FABRIC, 8, 5); g.ellipsoid(it.x + 0.05, it.y + 0.05, it.z - 0.05, 0.03, 0.03, 0.05, col, MAT.FABRIC, 6, 4); }
          else if (it.n === 1) BUF.emit(ACT.propMesh('train'), A.chain(A.T(it.x, it.y + 0.06, it.z), A.Ry(0.7), A.S(2)));
          else g.tube([[it.x - 0.3, it.y + 0.03, it.z], [it.x, it.y + 0.06, it.z + 0.15], [it.x + 0.3, it.y + 0.03, it.z - 0.05]], 0.045, col, MAT.FABRIC, 6);
          g.sphere(it.x, it.y + 0.55 + bob, it.z, 0.04, hex('#fff1b8'), MAT.GLOW, 6);
        }
      }
      for (const tr of G.traps) {
        if (!tr.on) continue;
        const y = tr.f ? F1 : 0, ax = tr.ax === 'x', shake = tr.cool > 4.5 ? Math.sin(t * 40) * 0.04 : 0;
        for (const q of [-1, 1]) g.cyl(tr.x + (ax ? q * tr.len / 2 : 0), y, tr.z + (ax ? 0 : q * tr.len / 2), 0.035, 0.95, hex('#3a2a22'), MAT.GRAIN, 6);
        g.tube([[tr.x - (ax ? tr.len / 2 : 0), y + 0.9, tr.z - (ax ? 0 : tr.len / 2)], [tr.x, y + 0.84, tr.z], [tr.x + (ax ? tr.len / 2 : 0), y + 0.9, tr.z + (ax ? 0 : tr.len / 2)]], 0.008, hex('#8a1f24'), 0, 4, false);
        for (let i = 0; i < 5; i++) { const o = (i - 2) * tr.len / 5.5; g.push(A.T(tr.x + (ax ? o : 0), y + 0.74 + shake * (i % 2 ? 1 : -1), tr.z + (ax ? 0 : o))); g.lathe(0, 0, 0, [[0.05, 0, 1], [0.04, 0.02], [0.03, 0.07], [0.006, 0.09], [0, 0.09]], hex('#d6b24a'), MAT.METAL, 8); g.pop(); }
      }
      BUF.addGeo(g);
    }
    for (const p of particles) {
      const M = A.chain(A.T(p.x, p.y, p.z), A.Ry(p.rot), A.Rx(p.rot * 0.7), A.S(p.size));
      const m = p.kind === 'orb' ? orbMesh : cubeMesh, start = BUF.n;
      BUF.emit(m, p.kind === 'shard' ? A.mul(M, [1, 0, 0, 0, 0, 0.15, 0, 0, 0, 0, 0.7, 0]) : M, p.col);
      for (let o = start; o < BUF.n; o += 10) BUF.a[o + 9] = p.mat;
    }
    if (mode === 'explore' && cast.leo.holdHand === 0 && cast.leo._B && cast.leo.visible) {
      const hp = ACT.handPos(cast.leo, 0), e = camInfo.eye, sy = Math.sin(camInfo.yaw), cy = Math.cos(camInfo.yaw);
      const sh = [e[0] + cy * 0.2 + sy * 0.05, e[1] - 0.32, e[2] + sy * 0.2 - cy * 0.05];
      if (hp && Math.hypot(hp[0] - sh[0], hp[2] - sh[2]) < 1.0) {
        const g = new Geo(), mid = [(sh[0] + hp[0]) / 2 + sy * 0.05, (sh[1] + hp[1]) / 2 - 0.08, (sh[2] + hp[2]) / 2 - cy * 0.05];
        g.tube([sh, mid, hp], [0.06, 0.055, 0.045], hex('#2f6fa8'), MAT.FABRIC, 8, true);
        g.sphere(hp[0], hp[1], hp[2], 0.045, hex('#e9c4a4'), MAT.SKIN, 8);
        BUF.addGeo(g);
      }
    }
  }

  // ---------------- main loop ----------------
  let DBGCAM = null; // test hook: free camera
  let FEAR = 0; // 0..1 screen dread (desaturate, vignette, grain) — set by the Krampus code
  let titleCam = 0, fpsT = 0, fpsN = 0, fps = 60;
  const MENU_Z = new Float32Array(16).fill(0.7);
  function frame(nowMs) {
    if (debug && window.__hold) { lastTime = nowMs; window.__held = (window.__held || 0) + 1; requestAnimationFrame(frame); return; } // test tools drive the clock themselves
    const dt = Math.min(0.05, (nowMs - lastTime) / 1000); lastTime = nowMs;
    fpsT += dt; fpsN++; if (fpsT > 1) { fps = fpsN / fpsT; fpsT = 0; fpsN = 0; }
    R.resize(isTouch ? 1.0 : 1.35);
    const sdt = dt * timeScale;
    if (mode !== 'pause' && mode !== 'title' && mode !== 'end') NOW += sdt;
    try {
      if (mode === 'cine') { sceneTick(sdt); for (const k in cast) stepActor(cast[k], sdt); camUpdate(sdt); runTimers(); }
      else if (mode === 'explore') updateExplore(dt);
      else if (mode === 'play') tick(dt);
      else if (mode === 'scare') { SCARE.t += dt; FEAR = 1; if (SCARE.t > 1.8) endCaught(); }
    } catch (e) { if (!frame.warned) { frame.warned = true; console.error(e); } }
    if (mode !== 'play' && mode !== 'scare') FEAR += (0 - FEAR) * Math.min(1, dt * 2);
    if (mode !== 'pause') { stepParticles(sdt); for (let i = 0; i < 16; i++) ZL[i] += (ZT[i] - ZL[i]) * Math.min(1, dt * 5); flick = Math.random() < 0.3 ? 0.35 + Math.random() * 0.65 : lerp(flick, 1, 0.3); }
    if (subT > 0) { subT -= dt; if (subT <= 0) $('sub').style.opacity = 0; }
    musicTick(); ambTick();
    let ex, ey, ez, yaw, pitch, fov = 1.15, roll = 0;
    const cine = mode === 'cine' || (mode === 'pause' && pausedFrom === 'cine');
    if (mode === 'title') {
      titleCam += dt * 0.05;
      ex = 32 + Math.cos(titleCam) * 11; ez = 20 + Math.sin(titleCam) * 7; ey = 7.3; yaw = Math.atan2(32 - ex, -(20 - ez)); pitch = -0.36;
    } else if (cine) {
      [ex, ey, ez] = cam.pos; const l = cam.look; yaw = Math.atan2(l[0] - ex, -(l[2] - ez)); pitch = Math.atan2(l[1] - ey, Math.hypot(l[0] - ex, l[2] - ez)); fov = cam.fov;
      if (cam.shake > 0) { ex += (Math.random() - 0.5) * cam.shake * 0.1; ey += (Math.random() - 0.5) * cam.shake * 0.1; roll = (Math.random() - 0.5) * cam.shake * 0.02; }
    } else if (mode === 'scare' || (mode === 'pause' && pausedFrom === 'scare')) {
      // dragged to his face
      const e = KV._eye || [K.x, K.y + 2.2, K.z], hx = P.x - K.x, hz = P.z - K.z, hd = Math.hypot(hx, hz) || 1;
      const u = smooth(SCARE.t / 0.14), sk = 0.05 * (1 - Math.min(1, SCARE.t / 1.8) * 0.5);
      const tx = e[0] + hx / hd * 0.62, ty = e[1] - 0.11, tz = e[2] + hz / hd * 0.62;
      ex = lerp(SCARE.from[0], tx, u) + (Math.random() - 0.5) * sk; ey = lerp(SCARE.from[1], ty, u) + (Math.random() - 0.5) * sk; ez = lerp(SCARE.from[2], tz, u) + (Math.random() - 0.5) * sk;
      yaw = Math.atan2(e[0] - ex, -(e[2] - ez)); pitch = Math.atan2(e[1] - 0.12 - ey, Math.hypot(e[0] - ex, e[2] - ez)); roll = (Math.random() - 0.5) * 0.09; fov = lerp(1.25, 1.12, u);
    } else {
      ex = P.x; ez = P.z; ey = P.y + EYE() + (G && G.hiding != null && mode === 'play' ? 0 : Math.sin(P.bob) * 0.025); yaw = P.yaw; pitch = P.pitch;
    }
    if (DBGCAM) { [ex, ey, ez] = DBGCAM.pos; const l = DBGCAM.look; yaw = Math.atan2(l[0] - ex, -(l[2] - ez)); pitch = Math.atan2(l[1] - ey, Math.hypot(l[0] - ex, l[2] - ez)); roll = 0; fov = DBGCAM.fov || 1.0; }
    Object.assign(camInfo, { eye: [ex, ey, ez], yaw, pitch, fov });
    if (mode !== 'pause') snowAround(ex, ez, dt, cine || ez < -0.2 || ex > 64.2 ? 60 : 20);
    const proj = perspective(fov, canvas.width / Math.max(1, canvas.height), 0.04, 170);
    const view = viewFPS(ex, ey, ez, yaw, pitch, roll), vp = mul4(proj, view);
    drawWorld(NOW);
    R.begin({ vp, view, fov, fear: FEAR, focus: cine && cam.look ? Math.hypot(cam.look[0] - ex, cam.look[1] - ey, cam.look[2] - ez) : 0, eye: [ex, ey, ez], zones: mode === 'title' ? MENU_Z : ZL, k: KV.visible && mode === 'play' ? [KV.x, KV.y + 1.5, KV.z, flick] : [0, -99, 0, 1], alarm: G && mode === 'play' && G.phase === 'escape' ? 1 : 0, time: NOW, lights: mode === 'scare' ? [{ x: ex, y: ey + 0.25, z: ez, r: 4, c: [1, 0.42, 0.3], i: 1.5 }].concat(pickLights([ex, ey, ez])) : mode === 'play' && K && K.state === 'peer' && KV._eye ? [{ x: (KV._eye[0] + ex) / 2, y: ey + 0.15, z: (KV._eye[2] + ez) / 2, r: 2.6, c: [0.75, 0.6, 0.55], i: 0.55 }].concat(pickLights([ex, ey, ez])) : pickLights([ex, ey, ez]), amb: ambDim, expo: 1.3 });
    R.draw(STATIC);
    R.drawDynamic(BUF.view());
    R.drawDynamic(MBUF.view(), 'mul');
    R.drawDynamic(ABUF.view(), 'alpha');
    R.end();
    if (debug) { $('fps').textContent = fps.toFixed(0) + ' fps'; window.__frames = (window.__frames || 0) + 1; }
    requestAnimationFrame(frame);
  }
  function tick(dt) {
    G.time += dt;
    runTimers();   // delayed lines and sounds during the hunt (Leo's sob on the stairs, his lines)
    updatePlayer(dt); if (mode !== 'play') return;
    if (G.phase === 'grace') {
      G.t -= dt;
      if (G.t <= 0) { G.phase = 'hunt'; if (!K.carry) dropKrampus(); pickPatrol(); jingle(0.35, 0, 8); showMsg('Listen for the bells. Follow the crying.', 4); }
    } else if (G.phase === 'hunt') {
      G.huntT += dt; G.lightT -= dt; if (G.lightT <= 0) { G.lightT = 70; killLights(1); }
      G.tauntT = (G.tauntT == null ? 35 : G.tauntT) - dt;
      const dK = Math.hypot(K.x - P.x, K.z - P.z), sameF = Math.abs(K.y - P.y) < 1;
      if (G.tauntT <= 0 && (K.state === 'patrol' || K.state === 'look') && G.hiding == null) { G.tauntT = 45 + Math.random() * 30; krampusSay('Come out, come out, wherever you are', clamp(1.2 - dK / 30, 0.3, 1) * (sameF ? 1 : 0.6)); }
      if (sameF && dK < 7 && P.crouch && G.hiding == null && !K.seeing && K.state !== 'chase' && NOW - (G.smellSaid || -99) > 30) { G.smellSaid = NOW; krampusSay('I can smell you, little one', 0.9); }
    }
    huntVoices(dt);
    if (G.phase !== 'escape') micHear(dt); if (mode !== 'play') return;
    updateKrampus(dt); if (mode !== 'play') return;
    updateBrother(dt);
    { // dread: the picture drains and closes in as he gets near; heartbeat with it
      const near = KV.visible && Math.abs(K.y - P.y) < 1 ? clamp(1 - Math.hypot(P.x - K.x, P.z - K.z) / 10, 0, 1) : 0;
      const tgt = K.state === 'peer' ? 1 : K.state === 'chase' || K.state === 'rage' ? Math.max(0.6, near) : near * 0.7;
      FEAR += (tgt - FEAR) * Math.min(1, dt * 1.6);
      G.heartT = (G.heartT || 0) - dt;
      if (FEAR > 0.25 && G.heartT <= 0) { G.heartT = lerp(1.05, 0.42, FEAR); tone(58, 0.13, 0.32 * FEAR, 'sine', 0, -20); tone(50, 0.16, 0.26 * FEAR, 'sine', 0.14, -18); }
    }
    staffOutside(dt);
    hints(dt);
    updateHUD(dt); drawEars();
  }

  // ---------------- the staff outside ----------------
  function staffOutside(dt) {
    const fd = LV.doors.front, sd = LV.doors.side;
    cast.priya.visible = cast.priya.visible || G.clues >= 1; cast.manager.visible = cast.manager.visible || G.clues >= 2;
    for (const k of STAFF) { const a = cast[k]; if (!a.visible) continue; a.look = [P.x, P.y + 1.2, P.z]; a.mawMax = lerp(a.mawMax || 0.3, floorOf(P.y) === 0 ? clamp(1.15 - Math.hypot(a.x - P.x, a.z - P.z) / 9, 0.3, 1) : 0.3, Math.min(1, dt * 0.5)); const g = a.gest; if (!g || (g.dur && NOW - g.t0 > g.dur)) a.gest = { name: k === 'manager' ? 'fold' : 'glass', t0: NOW }; }
    // stand around near a door and they rap on the glass to tell him where you are
    G.knockCool -= dt;
    const nearF = Math.hypot(P.x - fd.x, P.z - fd.z) < 7.5, nearS = Math.hypot(P.x - sd.x, P.z - sd.z) < 6.5;
    if (G.phase === 'hunt' && floorOf(P.y) === 0 && G.hiding == null && (nearF || nearS)) G.lingerT += dt; else G.lingerT = Math.max(0, G.lingerT - dt * 2);
    if (G.lingerT > 3.2 && G.knockCool <= 0 && K.state !== 'chase' && K.state !== 'wait') {
      G.knockCool = 14; G.lingerT = 0;
      const a = nearS && !nearF ? cast.dana : cast.marcus, [v, pan] = hear(a.x, a.z, 0, 16);
      a.gest = { name: 'knock', t0: NOW, dur: 1.4 };
      for (let i = 0; i < 4; i++) { tone(1500, 0.035, 0.25 * (v + 0.25), 'square', i * 0.22, -500, pan); tone(310, 0.06, 0.2 * (v + 0.25), 'triangle', i * 0.22, -80, pan); }
      showMsg(G.tips.knock ? 'They’re knocking again.' : 'They’re knocking on the glass. They’re telling him where you are.', 3.2); G.tips.knock = true;
      investigate(P.x, P.z, 0, false);
    }
  }
  // one-time pointers, shown the first time each thing matters
  function hints(dt) {
    G.tipT -= dt; if (G.tipT > 0 || msgT > 0.4) return;
    const tip = (k, text, secs = 4.5) => { if (G.tips[k]) return false; G.tips[k] = true; showMsg(text, secs, 'tip'); G.tipT = 6; return true; };
    const sameFloor = K && Math.abs(K.y - P.y) < 1, dP = K ? Math.hypot(P.x - K.x, P.z - K.z) : 99;
    if (G.phase === 'grace' && G.t < DIFF[diffKey].grace - 12 && tip('start', 'Look for Leo’s things. They glow. Each one makes his crying easier to follow.')) return;
    if (G.phase === 'hunt' && K.state !== 'wait' && sameFloor && dP < 15 && G.hiding == null && tip('close', isTouch ? 'He’s close. Crouch behind something, or climb into a pot or hamper (Hide).' : 'He’s close. Crouch (C) behind something, or climb into a pot or hamper (E).')) return;
    if (G.phase === 'hunt' && G.hiding == null) for (const t of G.traps) if (t.on && t.f === floorOf(P.y) && Math.hypot(t.x - P.x, t.z - P.z) < 4.5 && tip('trap', 'Bells on a string. Crouch to slip under them.')) return;
    if (G.phase === 'hunt' && G.clues >= 1 && !G.keys && G.time > 75 && tip('keys', 'You’ll need the store keys to get out. There’s a ring behind every register.')) return;
    if (G.phase === 'hunt' && G.clues >= 3 && tip('pots', 'Follow the crying. Look inside the pots and hampers.')) return;
  }
  // which way a sound is coming from, drawn at the edge of the screen (crying always; bells on Easy and on phones)
  function drawEars() {
    const set = (el, on, x, z, y, col, glyph) => {
      if (!on) { el.style.opacity = 0; return; }
      const [v] = hear(x, z, y, 60), rel = Math.atan2(x - P.x, -(z - P.z)) - P.yaw, fl = floorOf(y) - floorOf(P.y);
      el.style.left = (50 + Math.sin(rel) * 43) + '%'; el.style.top = (50 - Math.cos(rel) * 40) + '%';
      el.textContent = glyph + (fl > 0 ? ' ▲' : fl < 0 ? ' ▼' : ''); el.style.color = col; el.style.opacity = col === '#ff6a55' ? clamp(0.25 + v * 1.6, 0, 1) : 0.85;
    };
    const b = G.bro, cryR = 14 + 6 * G.clues, cd = Math.hypot(b.x - P.x, b.z - P.z);
    set($('earCry'), mode === 'play' && b.state !== 'follow' && G.phase !== 'grace' && cd < cryR * (floorOf(b.y) === floorOf(P.y) ? 1 : 0.6) && G.hiding == null, b.x, b.z, b.y, '#9fd0ff', '◦ crying');
    set($('earBell'), mode === 'play' && (G.D.map || isTouch) && KV.visible && K.spd > 0 && K.state !== 'rage' && Math.hypot(K.x - P.x, K.z - P.z) < 26, K.x, K.z, K.y, '#ff6a55', '◦ bells');
  }

  // ---------------- test hooks ----------------
  window.__box = {
    R, get P() { return P; }, get G() { return G; }, get K() { return K; }, get mode() { return mode; }, get EX() { return EX; }, get NOW() { return NOW; }, LV, ZL, ZT, cast, KV, CAR, cam,
    log: () => EV.splice(0), MIC, get audio() { return { muted, FF, state: AC ? AC.state : 'none' }; },
    stats: () => ({ walk: walk.reduce((a, b) => a + b, 0), reach: REACH.length, spots: SPOTS.length, links: stairLinks, verts: STATIC.count, obbs: LV.obbs.length, lights: LV.lights.length }),
    start: (d) => { if (d) diffKey = d; showOnly(null); startHunt(); },
    explore: () => { showOnly(null); startExplore(); },
    scene: (name, then) => { showOnly(null); const m = { opening: sceneOpening, balcony: sceneBalcony, crash: sceneCrash, doors: sceneDoors, ending: sceneEnding }; if (name === 'ending' && !G) newRound(); if (name === 'balcony' && !EX) startExplore(); runScene(m[name], then === 'hunt' ? startHunt : then === 'explore' ? startExplore : () => { mode = 'end'; }); },
    sceneTime: (sec) => { for (let i = 0; i < sec * 30 && SC; i++) { NOW += 1 / 30 * timeScale; sceneTick(1 / 30 * timeScale); for (const k in cast) stepActor(cast[k], 1 / 30 * timeScale); camUpdate(1 / 30); stepParticles(1 / 30 * timeScale); runTimers(); } },
    skip: () => skipScene(),
    tick: (dt, n) => { for (let i = 0; i < n && mode === 'play'; i++) { NOW += dt; subT = Math.max(0, subT - dt); tick(dt); } },
    exploreTick: (dt, n) => { for (let i = 0; i < n && mode === 'explore'; i++) { NOW += dt; subT = Math.max(0, subT - dt); updateExplore(dt); } },
    setP: (x, y, z, yaw, pitch, crouch) => { Object.assign(P, { x, y, z, yaw, pitch: pitch || 0 }); if (crouch != null) { P.crouch = crouch; P.ct = crouch ? 1 : 0; } },
    interact, zoneName, killLights, mapImg,
    // test hooks for the scares: hide in the nearest pot/hamper and bring him over; or get caught on the spot
    peer: () => { G.phase = 'hunt'; const i = nearContainer(); if (i < 0) return false; if (G.hiding == null) { G.hiding = i; G.back = [P.x, P.z]; P.x = LV.containers[i].x; P.z = LV.containers[i].z; } const c = LV.containers[i]; K.x = c.x + 1.1; K.z = c.z + 0.3; K.y = P.y; K.stun = 0; startPeer(c); return true; },
    view: (pos, look, fov) => { DBGCAM = pos ? { pos, look, fov } : null; },
    scare: () => { G.phase = 'hunt'; K.x = P.x + Math.sin(P.yaw) * 1.15; K.z = P.z - Math.cos(P.yaw) * 1.15; K.y = P.y; caught('Test.'); }, kstate: () => K && K.state, fear: () => FEAR,
    container: (i) => LV.containers[i], tickN: (n, dt = 1 / 30) => { for (let i = 0; i < n && mode === 'play'; i++) { NOW += dt; tick(dt); } },
    reachable: (f, x, z) => { const n = rNode(f, x, z); if (n < 0) return 99; const [nx, nz] = nodePos(n); return Math.hypot(nx - x, nz - z); },
    path: (x0, z0, f0, x1, z1, f1) => { const p = route(x0, z0, f0, x1, z1, f1); return p ? p.length : null; },
    route, key: (c, v) => { keys[c] = v; }, upDist: () => upstairsDist(), node: (f, x, z) => rNode(f, x, z), GN,
  };
  refreshBest();
  requestAnimationFrame(frame);
})();
