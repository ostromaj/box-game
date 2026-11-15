// ============================================================
// BOX — Krampus. Game logic.
// You're a kid locked in the store. Krampus took your little brother
// upstairs. Find him by ear, get the keys, and run.
// ============================================================
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const canvas = $('view');
  const DIFF = {
    easy:   { label: 'Easy',   spd: 0.88, range: 13, rate: 0.7, grace: 35, map: true },
    normal: { label: 'Normal', spd: 1.0,  range: 16, rate: 1.0, grace: 28, map: false },
    hard:   { label: 'Hard',   spd: 1.08, range: 19, rate: 1.3, grace: 20, map: false },
  };
  const CLUES = [
    { name: 'mitten', col: '#d0342c', text: 'His mitten. The crying is easier to hear now.' },
    { name: 'toy train', col: '#2f6fd0', text: 'His toy train. He has to be somewhere upstairs.' },
    { name: 'scarf', col: '#2f9e55', text: null },
  ];

  // ---------------- level + engine setup ----------------
  let R, LV, WORLD, STATIC;
  try {
    R = new Renderer(canvas);
    LV = buildLevel();
    STATIC = R.upload(LV.geo.array());
    WORLD = new World(LV.obbs, LV.width, LV.depth);
  } catch (e) {
    $('fatal').style.display = 'flex'; $('fatal').textContent = 'Sorry — this browser could not start the 3D view. (' + e.message + ')';
    throw e;
  }
  const F1 = LV.F1;

  function surfaceY(x, z, y) {
    let best = -1e9;
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
  // must match zl() in the shader
  function lightZone(x, z, f) {
    const i = x < 24 ? (z < 14 ? 0 : 1) : x < 40 ? (z < 12 ? 2 : z < 28 ? 3 : 4) : (z < 14 ? 5 : z < 28 ? 6 : 7);
    return i + (f ? 8 : 0);
  }
  function inPoly(poly, x, z) {
    let ins = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, zi] = poly[i], [xj, zj] = poly[j];
      if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) ins = !ins;
    }
    return ins;
  }

  // ---------------- walk grid for Krampus ----------------
  const CELL = 0.5, GW = Math.ceil(LV.width / CELL), GH = Math.ceil(LV.depth / CELL), GN = GW * GH;
  const walk = new Uint8Array(GN * 2);
  const cover = new Uint8Array(GN * 2);
  const id = (f, i, j) => f * GN + j * GW + i;
  const cellOf = (x, z) => [clamp(Math.floor(x / CELL), 0, GW - 1), clamp(Math.floor(z / CELL), 0, GH - 1)];
  const cx = (i) => (i + 0.5) * CELL;
  for (let f = 0; f < 2; f++) {
    const fy = f ? F1 : 0;
    for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) {
      const x = cx(i), z = cx(j);
      if (!inPoly(LV.polys[f], x, z)) continue;
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
    if (a < 0 || b < 0) { console.warn('stair link missing', s.name); continue; }
    const cost = Math.hypot(s.top[0] - s.bottom[0], s.top[1] - s.bottom[1]) + 1;
    if (!links.has(a)) links.set(a, []); if (!links.has(b)) links.set(b, []);
    links.get(a).push([b, cost]); links.get(b).push([a, cost]); stairLinks++;
  }
  const nodePos = (n) => { const f = n >= GN ? 1 : 0, k = n - f * GN; return [cx(k % GW), cx(Math.floor(k / GW)), f]; };
  const reach = new Uint8Array(GN * 2);
  const REACH = [];
  (function flood() {
    const s0 = nearestWalk(0, LV.playerSpawn[0], LV.playerSpawn[2]);
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
      const tryN = (m, cost) => {
        const g = gS[n] + cost;
        if (seenStamp[m] !== stampA || g < gS[m]) { seenStamp[m] = stampA; gS[m] = g; came[m] = n; push(m, g + H(m)); }
      };
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
    for (let k = 0; k <= n; k++) {
      const t = k / Math.max(1, n), [i, j] = cellOf(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t);
      if (!walk[id(f, i, j)]) return false;
    }
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
      if (!o.collide || o.y1 <= fy + 0.3 || o.y0 >= fy + 1.8) continue;
      g.save(); g.translate(o.cx, o.cz); g.transform(o.c, -o.s, o.s, o.c, 0, 0);
      const tall = o.y1 - Math.max(o.y0, fy) > 2.6;
      g.fillStyle = tall ? '#3a3633' : (o.opaque ? '#a59b8d' : '#cfc7bb');
      g.fillRect(-o.hx, -o.hz, o.hx * 2, o.hz * 2); g.restore();
    }
    g.fillStyle = '#e0a03a';
    for (const r of LV.ramps) g.fillRect(r.x0, r.z0, r.x1 - r.x0, r.z1 - r.z0);
    if (f === 0) { g.fillStyle = '#2f9e55'; g.fillRect(30, 0, 4, 0.8); g.fillRect(63.2, 29, 0.8, 2); }
    return c;
  });
  const mm = $('minimap'), mg = mm.getContext('2d');

  // ---------------- state ----------------
  const P = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, vx: 0, vz: 0, crouch: false, ct: 0, run: false, bob: 0 };
  const ZL = new Float32Array(16).fill(1);      // current light level per zone
  const ZT = new Float32Array(16).fill(1);      // target light level per zone
  let G = null, K = null;
  let diffKey = 'normal';
  let mode = 'title';      // title | intro | play | pause | end
  const keys = {};
  const touch = { move: null, look: null, mx: 0, mz: 0 };
  let mapOn = true, lastTime = performance.now(), flick = 1;
  const debug = /debug/.test(location.search);
  const EYE = () => (G && G.hiding != null ? 0.72 : lerp(1.15, 0.6, P.ct));

  function getBest(k) { try { return +localStorage.getItem('box-krampus-' + k) || 0; } catch (e) { return 0; } }
  function setBest(k, v) { try { localStorage.setItem('box-krampus-' + k, String(v)); } catch (e) { /* storage blocked */ } }
  const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; };

  function newRound() {
    const D = DIFF[diffKey];
    const [px, py, pz, pyaw] = LV.playerSpawn;
    Object.assign(P, { x: px, y: py, z: pz, yaw: pyaw, pitch: 0.12, vx: 0, vz: 0, crouch: false, ct: 0, run: false });
    ZL.fill(1); ZT.fill(1);
    const up = LV.containers.map((c, i) => i).filter((i) => LV.containers[i].f === 1);
    const broC = up[(Math.random() * up.length) | 0], bc = LV.containers[broC];
    // clues + keys
    const items = [];
    shuffle(LV.clueSpots.slice()).slice(0, 3).forEach(([f, x, z], i) => {
      const [nx, nz] = nodePos(rNode(f, x, z));
      items.push({ kind: 'clue', n: i, x: nx, z: nz, y: f ? F1 : 0, f, taken: false });
    });
    const [kf, kx, kz, kh] = LV.keySpots[(Math.random() * LV.keySpots.length) | 0];
    items.push({ kind: 'keys', x: kx, z: kz, y: (kf ? F1 : 0) + kh, f: kf, taken: false });
    const traps = shuffle(LV.trapSpots.map(([f, x, z, ax, len]) => ({ f, x, z, ax, len, on: false, cool: 0 })));
    for (let i = 0; i < 4; i++) traps[i].on = true;
    const [sx, sz] = nodePos(rNode(1, bc.x, bc.z));
    K = { x: sx, z: sz, y: F1, yaw: 0, state: 'wait', path: null, pi: 0, t: 0, look: 0, step: 0, stuck: 0, lastP: [sx, sz], seeing: false, lastSeen: null, searchLeft: 0, repath: 0, target: null, spd: 0, see: 0, sawT: 99, stun: 0, mark: '' };
    G = { D, phase: 'grace', t: D.grace, time: 0, huntT: 0, clues: 0, keys: false, items, traps, broC, bro: { state: 'hidden', x: bc.x, z: bc.z, y: bc.y }, trail: [], hiding: null, back: null,
      alert: 0, noiseT: 0, msgT: 0, level: 0, hunchT: 30, lightT: 70, cryT: 2, doorT: 0, dead: shuffle([0, 1, 2, 4, 5, 6, 7, 8, 9, 10, 12, 13, 14, 15]), reason: '' };
    showMsg('He took your brother upstairs.', 4);
  }
  const level = () => Math.min(5, G.clues + Math.floor(G.huntT / 100));

  // ---------------- input ----------------
  window.addEventListener('keydown', (e) => {
    keys[e.code] = true;
    if (mode === 'play') {
      if (e.code === 'KeyC' || e.code === 'ControlLeft') P.crouch = !P.crouch;
      if (e.code === 'KeyM') mapOn = !mapOn;
      if (e.code === 'KeyE' || e.code === 'Space' || e.code === 'Enter') interact();
      if (e.code === 'Escape' || e.code === 'KeyP') pause();
    } else if (mode === 'pause' && e.code === 'KeyP') resume();
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  });
  window.addEventListener('keyup', (e) => { keys[e.code] = false; });
  window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; });
  const isTouch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
  if (isTouch) document.body.classList.add('touch');
  let dragLook = false, hadLock = false;
  const lock = () => { if (!isTouch && canvas.requestPointerLock && document.pointerLockElement !== canvas) { try { const r = canvas.requestPointerLock(); if (r && r.catch) r.catch(() => {}); } catch (e) { /* blocked in some frames */ } } };
  canvas.addEventListener('mousedown', () => { if (mode !== 'play') return; lock(); dragLook = true; });
  window.addEventListener('mouseup', () => { dragLook = false; });
  window.addEventListener('mousemove', (e) => { if (mode === 'play' && (document.pointerLockElement === canvas || dragLook)) look(e.movementX || 0, e.movementY || 0, 0.0024); });
  document.addEventListener('pointerlockchange', () => {
    if (document.pointerLockElement !== canvas && mode === 'play' && !isTouch && hadLock) pause();
    hadLock = document.pointerLockElement === canvas;
  });
  function look(dx, dy, k) { P.yaw += dx * k; P.pitch = clamp(P.pitch - dy * k, -1.35, 1.35); }
  const stickBase = $('stick'), stickKnob = $('knob');
  canvas.addEventListener('touchstart', (e) => {
    if (mode !== 'play') return;
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
        touch.mx = dx / m; touch.mz = dy / m;
        stickKnob.style.transform = `translate(${dx}px,${dy}px)`;
      } else if (touch.look && t.identifier === touch.look.id) {
        look(t.clientX - touch.look.x, t.clientY - touch.look.y, 0.0058);
        touch.look.x = t.clientX; touch.look.y = t.clientY;
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
  $('btnCrouch').addEventListener('touchstart', (e) => { P.crouch = !P.crouch; e.preventDefault(); }, { passive: false });
  $('btnRun').addEventListener('touchstart', (e) => { P.run = true; e.preventDefault(); }, { passive: false });
  $('btnRun').addEventListener('touchend', (e) => { P.run = false; e.preventDefault(); }, { passive: false });
  $('btnUse').addEventListener('touchstart', (e) => { interact(); e.preventDefault(); }, { passive: false });
  $('btnUse').addEventListener('click', () => { if (!isTouch) interact(); });
  $('btnPause').addEventListener('click', () => pause());
  $('minimap').addEventListener('click', () => { mapOn = !mapOn; });

  // ---------------- audio ----------------
  let AC = null, master = null, noiseBuf = null;
  function audioInit() {
    if (AC) { if (AC.state === 'suspended') AC.resume(); return; }
    try { AC = new (window.AudioContext || window.webkitAudioContext)(); master = AC.createGain(); master.gain.value = 0.7; master.connect(AC.destination); } catch (e) { AC = null; }
  }
  function out(node, pan) {
    if (pan && AC.createStereoPanner) { const p = AC.createStereoPanner(); p.pan.value = clamp(pan, -1, 1); node.connect(p); p.connect(master); } else node.connect(master);
  }
  function tone(freq, dur, vol = 0.2, type = 'sine', when = 0, slide = 0, pan = 0) {
    if (!AC || vol < 0.003) return;
    const t0 = AC.currentTime + when, o = AC.createOscillator(), g = AC.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t0); if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t0 + dur);
    g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(vol, t0 + 0.01); g.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);
    o.connect(g); out(g, pan); o.start(t0); o.stop(t0 + dur + 0.05);
  }
  function thud(vol, pan, cut = 900) {
    if (!AC || vol < 0.01) return;
    if (!noiseBuf) { noiseBuf = AC.createBuffer(1, AC.sampleRate * 0.12, AC.sampleRate); const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 3); }
    const s = AC.createBufferSource(); s.buffer = noiseBuf;
    const f = AC.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = cut;
    const g = AC.createGain(); g.gain.value = vol;
    s.connect(f); f.connect(g); out(g, pan); s.start();
  }
  function jingle(vol, pan, n = 4) {
    for (let i = 0; i < n; i++) tone(2300 + Math.random() * 2300, 0.16 + Math.random() * 0.25, vol * (0.5 + Math.random() * 0.5), 'sine', i * 0.04 + Math.random() * 0.05, 0, pan);
  }
  function sob(vol, pan) {
    tone(540, 0.34, vol, 'triangle', 0, -150, pan); tone(480, 0.4, vol, 'triangle', 0.42, -150, pan); tone(610, 0.14, vol * 0.6, 'sine', 0.92, -90, pan);
  }
  function roar() { tone(95, 1.1, 0.5, 'sawtooth', 0, -50); tone(63, 1.3, 0.4, 'square', 0.05, -25); thud(0.6, 0, 400); }
  // where a sound at (x,z,y) sits relative to the player: [loudness 0..1, pan]
  function hear(x, z, y, range) {
    const d = Math.hypot(x - P.x, z - P.z);
    const fall = floorOf(y) === floorOf(P.y) ? 1 : 0.5;
    const rel = Math.atan2(x - P.x, -(z - P.z)) - P.yaw;
    return [Math.pow(clamp(1 - d / range, 0, 1), 1.5) * fall, Math.sin(rel) * clamp(d / 3, 0, 1)];
  }

  // ---------------- HUD ----------------
  function showMsg(t, secs) { G.msgT = secs; $('msg').textContent = t; $('msg').style.opacity = 1; }
  function fmt(t) { t = Math.max(0, Math.floor(t)); return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0'); }
  function nearContainer() {
    let best = -1, bd = 1.5;
    LV.containers.forEach((c, i) => { if (c.f !== floorOf(P.y)) return; const d = Math.hypot(c.x - P.x, c.z - P.z); if (d < bd) { bd = d; best = i; } });
    return best;
  }
  function updateHUD(dt) {
    if (G.msgT > 0) { G.msgT -= dt; if (G.msgT <= 0) $('msg').style.opacity = 0; }
    const ph = $('phase');
    ph.textContent = G.phase === 'grace' ? 'HE IS HIDING YOUR BROTHER' : G.phase === 'hunt' ? 'FIND YOUR BROTHER' : 'RUN TO THE FRONT DOORS';
    ph.className = G.phase === 'escape' ? 'run' : G.phase === 'grace' ? 'hide' : 'seek';
    $('timer').textContent = G.phase === 'grace' ? fmt(G.t + 1) : fmt(G.time);
    $('where').textContent = (floorOf(P.y) ? 'Upstairs · ' : 'Downstairs · ') + zoneName(P.x, P.z, P.y);
    $('obj').innerHTML = `Clues <b>${G.clues}/3</b> · Keys <b>${G.keys ? '✓' : '✗'}</b> · Brother <b>${G.bro.state === 'follow' ? 'with you' : 'missing'}</b>`;
    const a = G.phase === 'escape' ? 1 : G.alert;
    $('alertFill').style.width = Math.round(a * 100) + '%';
    $('alert').style.opacity = a > 0.02 ? 1 : 0.25;
    $('vignette').style.opacity = G.phase === 'escape' ? 0.35 : clamp(a * 1.1, 0, 0.85);
    $('hidefx').style.opacity = G.hiding != null ? 1 : 0;
    $('stance').textContent = G.hiding != null ? 'Hiding' : P.crouch ? 'Crouched' : (P.run || keys.ShiftLeft || keys.ShiftRight) ? 'Running' : 'Standing';
    $('btnCrouch').classList.toggle('on', P.crouch);
    let prompt = '';
    if (G.hiding != null) prompt = 'Climb out';
    else { const c = nearContainer(); if (c >= 0) prompt = LV.containers[c].type === 'pot' ? 'Look in / hide in the pot' : 'Look in / hide in the hamper'; }
    $('prompt').style.display = prompt ? 'block' : 'none';
    $('promptText').textContent = prompt;
    $('btnUse').style.display = prompt && isTouch ? 'block' : 'none';
    $('btnUse').textContent = G.hiding != null ? 'Out' : 'Hide';
    mm.style.display = mapOn ? 'block' : 'none';
    if (mapOn) {
      const f = floorOf(P.y), Wd = mm.width, H = mm.height, s = Wd / 34;
      mg.clearRect(0, 0, Wd, H);
      mg.save();
      mg.translate(Wd / 2, H / 2); mg.scale(s / MAP_S, s / MAP_S);
      mg.translate(-P.x * MAP_S, -(LV.depth - P.z) * MAP_S);
      mg.globalAlpha = 0.9; mg.drawImage(mapImg[f], 0, 0); mg.globalAlpha = 1;
      const sx = (x) => x * MAP_S, sz = (z) => (LV.depth - z) * MAP_S;
      if ((G.D.map || debug) && floorOf(K.y) === f) { mg.fillStyle = '#7a1010'; mg.beginPath(); mg.arc(sx(K.x), sz(K.z), 4, 0, TAU); mg.fill(); }
      if (debug) { const c = LV.containers[G.broC]; mg.fillStyle = '#18a0ff'; mg.beginPath(); mg.arc(sx(c.x), sz(c.z), 3, 0, TAU); mg.fill(); for (const it of G.items) if (!it.taken && it.f === f) { mg.fillStyle = it.kind === 'keys' ? '#d6b24a' : '#d040d0'; mg.fillRect(sx(it.x) - 2, sz(it.z) - 2, 4, 4); } }
      mg.translate(sx(P.x), sz(P.z)); mg.rotate(Math.PI - P.yaw);
      mg.fillStyle = '#d4402c'; mg.beginPath(); mg.moveTo(0, -6); mg.lineTo(4, 4); mg.lineTo(-4, 4); mg.closePath(); mg.fill();
      mg.restore();
      mg.fillStyle = 'rgba(20,20,20,0.75)'; mg.font = 'bold 11px system-ui, sans-serif'; mg.fillText(f ? 'UPSTAIRS' : 'DOWNSTAIRS', 6, 14);
    }
  }

  // ---------------- lights ----------------
  function killLights(n) {
    let did = false;
    for (let i = 0; i < n && G.dead.length; i++) { ZT[G.dead.pop()] = 0.12; did = true; }
    if (did) { thud(0.5, 0, 300); tone(140, 0.25, 0.2, 'square', 0, -80); }
  }
  function updateLights(dt) {
    for (let i = 0; i < 16; i++) ZL[i] += (ZT[i] - ZL[i]) * Math.min(1, dt * 5);
    flick = Math.random() < 0.3 ? 0.35 + Math.random() * 0.65 : lerp(flick, 1, 0.3);
  }

  // ---------------- interact: hide / rescue ----------------
  function interact() {
    if (mode !== 'play') return;
    if (G.hiding != null) { [P.x, P.z] = G.back; G.hiding = null; return; }
    const i = nearContainer(); if (i < 0) return;
    if (G.bro.state === 'hidden' && i === G.broC) return rescue();
    if (G.phase === 'escape') { showMsg('No time to hide. RUN!', 1.5); return; }
    if (K.state === 'chase' && (K.seeing || K.sawT < 1.5)) return caught('He watched you climb into the ' + LV.containers[i].type + '.');
    G.hiding = i; G.back = [P.x, P.z];
    P.x = LV.containers[i].x; P.z = LV.containers[i].z; P.vx = P.vz = 0;
    if (G.bro.state === 'hidden') showMsg('Empty. You climb in.', 1.6);
  }
  function rescue() {
    G.bro.state = 'follow'; G.phase = 'escape'; G.trail = []; P.crouch = false;
    K.state = 'rage'; K.stun = 3.2; K.repath = 0; K.mark = '!';
    for (let i = 0; i < 16; i++) ZT[i] = Math.max(ZT[i], 0.5);
    roar();
    showMsg(G.keys ? 'You found him! RUN — front doors!' : 'You found him! RUN — but you still need the keys!', 4);
  }

  // ---------------- Krampus ----------------
  function goTo(x, z, f) {
    const p = makePath(astar(rNode(floorOf(K.y), K.x, K.z), rNode(f, x, z)));
    if (p && p.length) { K.path = p; K.pi = 1; return true; }
    K.path = null; return false;
  }
  function pickPatrol() {
    const n = (Math.random() < 0.7 && SPOTS.length) ? SPOTS[(Math.random() * SPOTS.length) | 0] : REACH[(Math.random() * REACH.length) | 0];
    const [x, z, f] = nodePos(n);
    K.state = 'patrol'; K.mark = '';
    if (!goTo(x, z, f)) { K.state = 'look'; K.t = 0.5; K.look = K.yaw; }
  }
  function canSee() {
    if (G.hiding != null) return 0;
    const range = (G.D.range + 2 * level()) * (ZL[lightZone(P.x, P.z, floorOf(P.y))] < 0.5 ? 0.7 : 1);
    const ex = K.x, ey = K.y + 2.3, ez = K.z;
    const eye = P.y + EYE(), body = P.y + lerp(0.7, 0.3, P.ct);
    const dx = P.x - ex, dz = P.z - ez, dy = eye - ey;
    const d = Math.hypot(dx, dz, dy * 0.6);
    if (d > range) return 0;
    if (d > 1.8) {
      const fx = Math.sin(K.yaw), fz = -Math.cos(K.yaw);
      if ((dx * fx + dz * fz) / Math.max(0.001, Math.hypot(dx, dz)) < Math.cos(55 * Math.PI / 180)) return 0;
    }
    if (WORLD.clear(ex, ey, ez, P.x, eye + 0.06, P.z) || WORLD.clear(ex, ey, ez, P.x, body, P.z)) return [d, range];
    return 0;
  }
  function investigate(x, z, f, fast) {
    if (K.state === 'chase' || K.state === 'rage' || K.state === 'wait') return;
    K.state = fast ? 'rush' : 'investigate'; K.mark = '?';
    if (!goTo(x + (Math.random() - 0.5) * 2, z + (Math.random() - 0.5) * 2, f)) goTo(x, z, f);
  }
  function hearNoise(x, z, f, radius) {
    const r = floorOf(K.y) === f ? radius : radius * 0.45;
    if (Math.hypot(K.x - x, K.z - z) < r) investigate(x, z, f, false);
  }
  function updateKrampus(dt) {
    const D = G.D, mult = D.spd * (1 + 0.05 * Math.min(4, level()));
    if (K.state === 'wait') { K.yaw += dt * 0.6; return; }
    if (K.stun > 0) { K.stun -= dt; K.spd = 0; return; }
    const sameFloor = Math.abs(K.y - P.y) < 1;
    const dP = Math.hypot(P.x - K.x, P.z - K.z);
    if (K.state === 'rage') {
      K.repath -= dt;
      if (K.repath <= 0) { K.repath = 0.35; const b = G.bro; const tb = Math.hypot(b.x - K.x, b.z - K.z) < dP; goTo(tb ? b.x : P.x, tb ? b.z : P.z, floorOf(tb ? b.y : P.y)); }
      if (sameFloor && dP < 1.3) return caught('Krampus caught you at the last second.');
      if (Math.abs(K.y - G.bro.y) < 1 && Math.hypot(G.bro.x - K.x, G.bro.z - K.z) < 1.15) return caught('Krampus snatched your brother back.');
    } else {
      const s = canSee();
      K.seeing = !!s; K.sawT = K.seeing ? 0 : K.sawT + dt;
      if (s) {
        const [d, range] = s;
        let r = d < 2.4 ? 5 : 0.6 + 2.4 * (1 - d / range);
        if (P.ct > 0.5 && d > 3) r *= 0.5;
        if (Math.hypot(P.vx, P.vz) > 0.5) r *= 1.25;
        G.alert = Math.min(1, G.alert + r * D.rate * dt);
        K.lastSeen = [P.x, P.z, floorOf(P.y)];
        if (G.alert >= 1 && K.state !== 'chase') { K.state = 'chase'; K.repath = 0; K.mark = '!'; roar(); showMsg('HE SEES YOU!', 1.5); }
        else if (K.state !== 'chase') { K.mark = '?'; if (G.alert > 0.45 && K.state !== 'rush') investigate(P.x, P.z, floorOf(P.y), true); }
      } else if (K.state !== 'chase') G.alert = Math.max(0, G.alert - 0.14 * dt);
      if (K.state === 'chase') {
        if (K.seeing && sameFloor && dP < 1.35) return caught('Krampus caught you.');
        K.repath -= dt;
        if (K.repath <= 0) { K.repath = 0.4; goTo(K.lastSeen[0], K.lastSeen[1], K.lastSeen[2]); }
        if (!K.seeing && (!K.path || K.pi >= K.path.length)) { K.state = 'search'; K.t = 2.2; K.look = K.yaw; K.searchLeft = 2 + Math.min(2, G.clues); K.mark = '?'; G.alert = 0.6; }
      } else if (K.state === 'look' || K.state === 'search') {
        K.t -= dt; K.yaw = K.look + Math.sin((2.2 - K.t) * 1.9) * 1.2;
        if (K.t <= 0) {
          if (K.state === 'search' && K.searchLeft > 0 && K.lastSeen) {
            K.searchLeft--; const [lx, lz, lf] = K.lastSeen, a = Math.random() * TAU, rr = 2 + Math.random() * 5;
            if (goTo(lx + Math.cos(a) * rr, lz + Math.sin(a) * rr, lf)) K.state = 'searchwalk'; else K.t = 1;
          } else pickPatrol();
        }
      }
      // every so often he drifts toward wherever you are
      G.hunchT -= dt;
      if (G.hunchT <= 0) {
        G.hunchT = 42 - 6 * level();
        if (K.state === 'patrol' || K.state === 'look') {
          const a = Math.random() * TAU, r = 5 + Math.random() * 7;
          K.state = 'patrol'; if (!goTo(P.x + Math.cos(a) * r, P.z + Math.sin(a) * r, floorOf(P.y))) pickPatrol();
        }
      }
    }
    // walk the path
    const moving = K.path && K.pi < K.path.length && K.state !== 'look' && K.state !== 'search';
    if (moving) {
      const base = { chase: 4.1, rage: 4.5, rush: 3.3, investigate: 2.7, searchwalk: 2.4, patrol: 1.75 }[K.state] || 1.75;
      const spd = base * (K.state === 'rage' ? D.spd : mult);
      let left = spd * dt;
      while (left > 0 && K.pi < K.path.length) {
        const [tx, tz] = K.path[K.pi], ddx = tx - K.x, ddz = tz - K.z, dist = Math.hypot(ddx, ddz);
        if (dist < 0.05) { K.pi++; continue; }
        const m = Math.min(left, dist); K.x += (ddx / dist) * m; K.z += (ddz / dist) * m; left -= m;
        let dy = Math.atan2(ddx, -ddz) - K.yaw; while (dy > Math.PI) dy -= TAU; while (dy < -Math.PI) dy += TAU;
        if (!(K.state === 'chase' && K.seeing)) K.yaw += dy * Math.min(1, dt * 7);
        if (dist <= m + 1e-4) K.pi++;
      }
      K.y = surfaceY(K.x, K.z, K.y); K.spd = spd;
      const before = K.step; K.step += spd * dt * 0.62;
      if (Math.floor(before) !== Math.floor(K.step)) {
        const [v, pan] = hear(K.x, K.z, K.y, 30);
        if (K.state === 'rage') thud(v * 1.2 + 0.05, pan, 350);      // the bells go silent at the end
        else { jingle(v * 0.5, pan, K.state === 'chase' ? 6 : 4); thud(v * 0.5, pan, 300); }
      }
      K.stuck += dt;
      if (K.stuck > 2.5) { if (Math.hypot(K.x - K.lastP[0], K.z - K.lastP[1]) < 0.6) { if (K.state === 'chase' || K.state === 'rage') K.repath = 0; else pickPatrol(); } K.stuck = 0; K.lastP = [K.x, K.z]; }
      if (K.pi >= K.path.length) {
        if (K.state === 'patrol') { K.state = 'look'; K.t = 1.2 + Math.random() * 1.6; K.look = K.yaw; }
        else if (K.state === 'investigate' || K.state === 'rush') { K.state = 'search'; K.t = 2.2; K.look = K.yaw; K.searchLeft = 1; K.lastSeen = [K.x, K.z, floorOf(K.y)]; K.mark = '?'; }
        else if (K.state === 'searchwalk') { K.state = 'search'; K.t = 2; K.look = K.yaw; }
      }
    } else K.spd = 0;
    if ((K.state === 'chase' && K.seeing) || (K.state === 'rage' && dP < 6)) {
      let dy = Math.atan2(P.x - K.x, -(P.z - K.z)) - K.yaw; while (dy > Math.PI) dy -= TAU; while (dy < -Math.PI) dy += TAU; K.yaw += dy * Math.min(1, dt * 8);
    }
  }

  // ---------------- player, brother, pickups, traps ----------------
  function updatePlayer(dt) {
    if (G.hiding != null) { P.vx = P.vz = 0; return; }
    let fwd = 0, str = 0;
    if (keys.KeyW || keys.ArrowUp) fwd += 1; if (keys.KeyS || keys.ArrowDown) fwd -= 1;
    if (keys.KeyD || keys.ArrowRight) str += 1; if (keys.KeyA || keys.ArrowLeft) str -= 1;
    if (touch.move) { fwd = -touch.mz; str = touch.mx; }
    const mag = Math.hypot(fwd, str); if (mag > 1) { fwd /= mag; str /= mag; }
    const running = (keys.ShiftLeft || keys.ShiftRight || P.run) && !P.crouch;
    const sp = P.crouch ? 1.6 : running ? 5.0 : 2.8;
    const sy = Math.sin(P.yaw), cy = Math.cos(P.yaw);
    const wx = (sy * fwd + cy * str) * sp, wz = (-cy * fwd + sy * str) * sp;
    const k = Math.min(1, dt * 12);
    P.vx += (wx - P.vx) * k; P.vz += (wz - P.vz) * k;
    P.ct += ((P.crouch ? 1 : 0) - P.ct) * Math.min(1, dt * 10);
    let nx = P.x + P.vx * dt, nz = P.z + P.vz * dt;
    [nx, nz] = WORLD.collide(nx, nz, P.y, lerp(1.3, 0.7, P.ct), 0.25, 0.32);
    P.y = surfaceY(nx, nz, P.y); P.x = nx; P.z = nz;
    const spd = Math.hypot(P.vx, P.vz);
    P.bob += spd * dt * 2.6;
    if (G.phase === 'hunt') {
      G.noiseT -= dt;
      if (spd > 0.6 && G.noiseT <= 0) { G.noiseT = 0.35; hearNoise(P.x, P.z, floorOf(P.y), running && spd > 4 ? 14 : P.crouch ? 0 : 3.6); }
    }
    // pickups
    for (const it of G.items) {
      if (it.taken || it.f !== floorOf(P.y) || Math.hypot(it.x - P.x, it.z - P.z) > (it.kind === 'keys' ? 1.7 : 1.0)) continue;
      it.taken = true;
      if (it.kind === 'keys') { G.keys = true; jingle(0.25, 0, 3); showMsg('The store keys! These open the front doors.', 3.5); }
      else {
        const c = CLUES[G.clues]; G.clues++;
        tone(660, 0.2, 0.2, 'triangle'); tone(880, 0.3, 0.2, 'triangle', 0.12);
        const bc = LV.containers[G.broC];
        showMsg(c.text || ('His scarf. The crying is coming from the ' + zoneName(bc.x, bc.z, bc.y) + '.'), 4.5);
        killLights(3);
        let add = 2; for (const t of G.traps) if (!t.on && add > 0) { t.on = true; add--; }
      }
    }
    // bell traps: duck under them
    for (const t of G.traps) {
      if (t.cool > 0) t.cool -= dt;
      if (!t.on || t.cool > 0 || t.f !== floorOf(P.y) || P.ct > 0.6) continue;
      const along = t.ax === 'x' ? P.x - t.x : P.z - t.z, across = t.ax === 'x' ? P.z - t.z : P.x - t.x;
      if (Math.abs(along) < t.len / 2 && Math.abs(across) < 0.35) {
        t.cool = 6; jingle(0.5, 0, 9); jingle(0.4, 0, 6);
        if (G.phase === 'hunt') { showMsg('A bell trap! He heard that.', 2.5); investigate(t.x, t.z, t.f, true); }
      }
    }
    // doors
    G.doorT -= dt;
    const fd = LV.doors.front, sd = LV.doors.side;
    if (floorOf(P.y) === 0 && Math.hypot(P.x - fd.x, P.z - fd.z) < 1.9) {
      if (G.phase === 'escape' && G.keys) return win();
      if (G.doorT <= 0) { G.doorT = 5; thud(0.3, 0, 700); showMsg(G.phase === 'escape' ? 'LOCKED! You need the store keys!' : G.keys ? 'You are not leaving without your brother.' : 'Locked. Outside, an employee shakes their head. Then smiles.', 3.5); }
    } else if (floorOf(P.y) === 0 && Math.hypot(P.x - sd.x, P.z - sd.z) < 1.7 && G.doorT <= 0) {
      G.doorT = 5; thud(0.3, 0, 700); showMsg('This door is chained. The employee outside just smiles.', 3.5);
    }
  }
  function updateBrother(dt) {
    const b = G.bro;
    if (b.state !== 'follow') {
      // muffled crying from wherever he is stuffed
      G.cryT -= dt;
      if (G.cryT <= 0 && G.phase !== 'grace') { G.cryT = 2.3 + Math.random() * 1.2; const [v, pan] = hear(b.x, b.z, b.y, 8 + 5 * G.clues); sob(v * 0.5, pan); }
      return;
    }
    const tr = G.trail, last = tr[tr.length - 1];
    if (!last || Math.hypot(P.x - last[0], P.z - last[1]) > 0.4) tr.push([P.x, P.z, P.y]);
    let left = 5.4 * dt;
    while (left > 0 && tr.length > 2) {
      const [tx, tz] = tr[0], dx = tx - b.x, dz = tz - b.z, d = Math.hypot(dx, dz);
      if (d < 0.15) { tr.shift(); continue; }
      const m = Math.min(left, d); b.x += dx / d * m; b.z += dz / d * m; left -= m;
    }
    b.y = surfaceY(b.x, b.z, b.y);
  }

  // ---------------- drawing the things that move ----------------
  const HC = {}, hx = (h) => HC[h] || (HC[h] = hex(h));
  function figure(g, x, y, z, yaw, s, c, walkPhase, moving) {
    const fx = Math.sin(yaw), fz = -Math.cos(yaw), rx = Math.cos(yaw), rz = Math.sin(yaw);
    const L = (lx, lz) => [x + (rx * lx - fx * lz) * s, z + (rz * lx - fz * lz) * s];
    const by = -yaw, sw = moving ? Math.sin(walkPhase * Math.PI) * 0.45 : 0;
    const B = (lx, ly, lz, sx, sy, sz, col, mat) => { const [wx, wz] = L(lx, lz); g.box(wx, y + ly * s, wz, sx * s, sy * s, sz * s, by, col, mat || 0); };
    for (const q of [-1, 1]) { B(q * 0.11, 0, -Math.sin(sw * q) * 0.25, 0.15, 0.85, 0.17, c.pants); B(q * 0.11, 0, -Math.sin(sw * q) * 0.36 - 0.05, 0.17, 0.09, 0.28, c.shoe); }
    B(0, 0.85, 0, 0.46, 0.62, 0.26, c.shirt);
    if (c.apron) B(0, 0.8, -0.135, 0.4, 0.62, 0.02, c.apron);
    for (const q of [-1, 1]) { B(q * 0.3, 0.85, Math.sin(sw * q) * 0.14, 0.12, 0.6, 0.13, c.shirt); B(q * 0.3, 0.75, Math.sin(sw * q) * 0.22, 0.1, 0.12, 0.1, c.skin); }
    B(0, 1.47, 0, 0.13, 0.08, 0.13, c.skin); B(0, 1.53, 0, 0.3, 0.3, 0.3, c.skin);
    B(0, 1.78, 0, 0.32, 0.1, 0.32, c.hair); B(0, 1.6, 0.06, 0.32, 0.2, 0.22, c.hair);
    for (const q of [-1, 1]) B(q * 0.07, 1.66, -0.152, 0.05, 0.05, 0.01, hx('#111111'));
    if (c.smile) { B(0, 1.57, -0.153, 0.17, 0.035, 0.01, hx('#f4f4f4'), MAT.GLOW); for (const q of [-1, 1]) B(q * 0.1, 1.6, -0.153, 0.035, 0.035, 0.01, hx('#f4f4f4'), MAT.GLOW); }
    return B;
  }
  const KC = { pants: hex('#17110f'), shoe: hex('#0a0808'), shirt: hex('#241a15'), skin: hex('#3a2a22'), hair: hex('#15100d') };
  const BRO = { pants: hex('#32456b'), shoe: hex('#222222'), shirt: hex('#c9342c'), skin: hex('#e9c4a4'), hair: hex('#6b4a2a') };
  const EMP = { pants: hex('#2b2d33'), shoe: hex('#1d1d1f'), shirt: hex('#e8e6e0'), skin: hex('#d9b596'), hair: hex('#2a1d16'), apron: hex('#3a3a3c'), smile: true };
  function drawDynamic(t) {
    const g = new Geo();
    // Krampus: a huge horned shape with a sack and chains
    { const s = 1.5, B = figure(g, K.x, K.y, K.z, K.yaw, s, KC, K.step, K.spd > 0);
      const horn = hx('#cfc3a8'), eye = hx('#ffb020');
      for (const q of [-1, 1]) { B(q * 0.13, 1.86, 0.02, 0.07, 0.2, 0.07, horn); B(q * 0.2, 2.02, 0.06, 0.07, 0.18, 0.07, horn); B(q * 0.26, 2.16, 0.02, 0.06, 0.16, 0.06, horn); B(q * 0.07, 1.665, -0.156, 0.06, 0.045, 0.01, eye, MAT.GLOW); }
      B(0, 1.42, -0.17, 0.08, 0.2, 0.03, hx('#b3202a'));
      B(0, 1.5, -0.16, 0.2, 0.05, 0.02, hx('#e8e2d0'));
      B(0.06, 0.8, 0.26, 0.5, 0.75, 0.34, hx('#6b4a2e')); B(0.06, 1.5, 0.24, 0.3, 0.14, 0.24, hx('#59391f'));
      for (let i = 0; i < 4; i++) B(-0.2 + i * 0.13, 0.78 - (i % 2) * 0.05, -0.15, 0.06, 0.06, 0.03, hx('#8f959b'));
      for (let i = 0; i < 3; i++) B(-0.14 + i * 0.14, 1.36, -0.14, 0.05, 0.05, 0.05, hx('#d6b24a'), MAT.GLOW);
    }
    if (G.bro.state === 'follow') figure(g, G.bro.x, G.bro.y, G.bro.z, Math.atan2(P.x - G.bro.x, -(P.z - G.bro.z)), 0.6, BRO, t * 5, true);
    // the employees outside, always watching
    for (const d of [LV.doors.front, LV.doors.side]) figure(g, d.ex, 0, d.ez, Math.atan2(P.x - d.ex, -(P.z - d.ez)), 1, EMP, 0, false);
    // clues and keys
    for (const it of G.items) {
      if (it.taken) continue;
      const bob = Math.sin(t * 3 + it.x) * 0.05, col = it.kind === 'keys' ? hx('#e8c14e') : hx(CLUES[it.n].col);
      if (it.kind === 'keys') { g.box(it.x, it.y + 0.03 + bob * 0.3, it.z, 0.16, 0.03, 0.16, t, col, MAT.GLOW); g.box(it.x + 0.1, it.y + 0.03, it.z, 0.2, 0.02, 0.04, 0.4, col, MAT.GLOW); }
      else { g.box(it.x, it.y + 0.05, it.z, 0.2, 0.09, 0.28, 0.6 + it.n, col); g.box(it.x, it.y + 0.55 + bob, it.z, 0.07, 0.07, 0.07, t * 2, hx('#fff1b8'), MAT.GLOW); }
    }
    // bell traps
    for (const tr of G.traps) {
      if (!tr.on) continue;
      const y = tr.f ? F1 : 0, ax = tr.ax === 'x', shake = tr.cool > 4.5 ? Math.sin(t * 40) * 0.04 : 0;
      for (const q of [-1, 1]) g.box(tr.x + (ax ? q * tr.len / 2 : 0), y, tr.z + (ax ? 0 : q * tr.len / 2), 0.07, 0.95, 0.07, 0, hx('#3a2a22'));
      g.box(tr.x, y + 0.88, tr.z, ax ? tr.len : 0.02, 0.02, ax ? 0.02 : tr.len, 0, hx('#8a1f24'));
      for (let i = 0; i < 5; i++) { const o = (i - 2) * tr.len / 5.5; g.box(tr.x + (ax ? o : 0), y + 0.76 + shake * (i % 2 ? 1 : -1), tr.z + (ax ? 0 : o), 0.09, 0.11, 0.09, 0, hx('#e8c14e'), MAT.GLOW); }
    }
    return g.array();
  }

  // ---------------- flow ----------------
  function showOnly(idShown) {
    for (const s of ['title', 'intro', 'pause', 'end']) $(s).style.display = s === idShown ? 'flex' : 'none';
  }
  function toIntro() { audioInit(); mode = 'intro'; showOnly('intro'); }
  function startGame() {
    audioInit(); newRound(); mode = 'play'; showOnly(null); $('hud').style.display = 'block'; lastTime = performance.now(); lock();
    roar(); jingle(0.3, 0, 8);
  }
  function pause() { if (mode !== 'play') return; mode = 'pause'; showOnly('pause'); if (document.pointerLockElement) document.exitPointerLock(); }
  function resume() { mode = 'play'; showOnly(null); lastTime = performance.now(); lock(); }
  function toTitle() { mode = 'title'; showOnly('title'); $('hud').style.display = 'none'; refreshBest(); if (document.pointerLockElement) document.exitPointerLock(); }
  function caught(reason) {
    if (mode !== 'play') return;
    mode = 'end'; G.reason = reason; roar();
    $('endTitle').textContent = 'INTO THE SACK'; $('endTitle').className = 'lose';
    $('endText').innerHTML = `${reason}<br>You lasted ${fmt(G.time)} and found ${G.clues} of 3 clues.`;
    showOnly('end'); if (document.pointerLockElement) document.exitPointerLock();
  }
  function win() {
    if (mode !== 'play') return;
    mode = 'end';
    [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.3, 0.18, 'triangle', i * 0.12));
    const t = Math.floor(G.time), prev = getBest(diffKey);
    if (!prev || t < prev) setBest(diffKey, t);
    $('endTitle').textContent = 'YOU GOT HIM OUT'; $('endTitle').className = 'win';
    $('endText').innerHTML = `The doors fly open. Snow. Headlights. Your parents are screaming your names.<br>Behind you, something drags a smiling employee back inside.<br><br>In the car, your brother opens his hand. A tiny bell. It jingles.<br><br><b>${fmt(t)}</b> on ${G.D.label}${!prev || t < prev ? ' — new best!' : ''}`;
    showOnly('end'); if (document.pointerLockElement) document.exitPointerLock();
    setTimeout(() => jingle(0.3, 0, 3), 2600);
  }
  function refreshBest() {
    $('best').textContent = 'Best escapes — ' + ['easy', 'normal', 'hard'].map((k) => `${DIFF[k].label}: ${getBest(k) ? fmt(getBest(k)) : '—'}`).join(' · ');
  }
  document.querySelectorAll('[data-diff]').forEach((b) => b.addEventListener('click', () => {
    diffKey = b.dataset.diff;
    document.querySelectorAll('[data-diff]').forEach((x) => x.classList.toggle('sel', x === b));
  }));
  $('play').addEventListener('click', toIntro);
  $('go').addEventListener('click', startGame);
  $('again').addEventListener('click', startGame);
  $('menu').addEventListener('click', toTitle);
  $('resume').addEventListener('click', resume);
  $('quit').addEventListener('click', toTitle);

  // ---------------- main loop ----------------
  let titleCam = 0;
  const MENU_L = new Float32Array(16).fill(0.55);
  function frame(now) {
    const dt = Math.min(0.05, (now - lastTime) / 1000); lastTime = now;
    R.resize(isTouch ? 1.25 : 1.5);
    if (mode === 'play') tick(dt);
    let ex, ey, ez, yaw, pitch;
    const menu = mode === 'title' || mode === 'intro';
    if (menu) {
      titleCam += dt * 0.06;
      ex = 32 + Math.cos(titleCam) * 11; ez = 20 + Math.sin(titleCam) * 7; ey = 7.3;
      yaw = Math.atan2(32 - ex, -(20 - ez)); pitch = -0.36;
    } else {
      ex = P.x; ez = P.z; ey = P.y + EYE() + (G.hiding != null ? 0 : Math.sin(P.bob) * 0.025);
      yaw = P.yaw; pitch = P.pitch;
    }
    const proj = perspective(1.2, canvas.width / Math.max(1, canvas.height), 0.05, 140);
    const vp = mul4(proj, viewFPS(ex, ey, ez, yaw, pitch));
    R.begin(vp, [ex, ey, ez], menu ? { lights: MENU_L, k: [0, -99, 0, 1], alarm: 0, time: now / 1000 }
      : { lights: ZL, k: [K.x, K.y + 1.5, K.z, flick], alarm: G.phase === 'escape' ? 1 : 0, time: now / 1000 });
    R.draw(STATIC);
    if (G && !menu) R.drawDynamic(drawDynamic(now / 1000));
    requestAnimationFrame(frame);
  }
  function tick(dt) {
    G.time += dt;
    updatePlayer(dt); if (mode !== 'play') return;
    if (G.phase === 'grace') {
      G.t -= dt;
      if (G.t <= 0) { G.phase = 'hunt'; pickPatrol(); jingle(0.35, 0, 8); showMsg('Listen for the bells. Follow the crying.', 4); for (let i = 0; i < 16; i++) ZT[i] = Math.min(ZT[i], 0.8); }
    } else if (G.phase === 'hunt') {
      G.huntT += dt; G.lightT -= dt;
      if (G.lightT <= 0) { G.lightT = 70; killLights(1); }
    }
    updateKrampus(dt); if (mode !== 'play') return;
    updateBrother(dt);
    updateLights(dt);
    updateHUD(dt);
  }

  window.__box = {
    get P() { return P; }, get G() { return G; }, get K() { return K; }, get mode() { return mode; }, LV, ZL, ZT,
    stats: () => ({ walk: walk.reduce((a, b) => a + b, 0), reach: REACH.length, spots: SPOTS.length, links: stairLinks, verts: LV.geo.count, obbs: LV.obbs.length }),
    start: (d) => { if (d) diffKey = d; startGame(); },
    tick: (dt, n) => { for (let i = 0; i < n && mode === 'play'; i++) tick(dt); },
    setP: (x, y, z, yaw, pitch, crouch) => { Object.assign(P, { x, y, z, yaw, pitch: pitch || 0 }); if (crouch != null) { P.crouch = crouch; P.ct = crouch ? 1 : 0; } },
    interact, zoneName, killLights, mapImg,
    reachable: (f, x, z) => { const n = rNode(f, x, z); if (n < 0) return 99; const [nx, nz] = nodePos(n); return Math.hypot(nx - x, nz - z); },
    path: (x0, z0, f0, x1, z1, f1) => { const p = makePath(astar(rNode(f0, x0, z0), rNode(f1, x1, z1))); return p ? p.length : null; },
  };
  refreshBest();
  requestAnimationFrame(frame);
})();
