// ============================================================
// BOX — hide & seek after closing. Game logic.
// ============================================================
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const canvas = $('view');
  const DIFF = {
    easy:   { label: 'Easy',   seekers: 2, speed: 0.85, range: 16, fov: 100, rate: 0.75, survive: 120, hide: 30, map: true, hunch: 0 },
    normal: { label: 'Normal', seekers: 3, speed: 1.0,  range: 20, fov: 110, rate: 1.0,  survive: 150, hide: 30, map: false, hunch: 32 },
    hard:   { label: 'Hard',   seekers: 4, speed: 1.12, range: 24, fov: 120, rate: 1.3,  survive: 180, hide: 25, map: false, hunch: 22 },
  };
  const SEEKERS = [
    { name: 'Red', shirt: '#b8333a', hair: '#2a1d16', skin: '#c99b7a' },
    { name: 'Blue', shirt: '#2f5d9e', hair: '#5a3a22', skin: '#e2b896' },
    { name: 'Gold', shirt: '#c9962b', hair: '#111111', skin: '#8d5e3f' },
    { name: 'Green', shirt: '#3c7a4a', hair: '#b88a4a', skin: '#f0c9a8' },
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
    for (const r of LV.ramps) if (x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1) return r.axis === 'x' ? 'Atrium Stairs' : 'Back Stairs';
    for (const [zf, x0, x1, z0, z1, n] of LV.zones) if (zf === f && x >= x0 && x <= x1 && z >= z0 && z <= z1) return n;
    return f ? 'Upstairs' : 'Sales Floor';
  }
  function inPoly(poly, x, z) {
    let ins = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, zi] = poly[i], [xj, zj] = poly[j];
      if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) ins = !ins;
    }
    return ins;
  }

  // ---------------- walk grid for the seekers ----------------
  const CELL = 0.5, GW = Math.ceil(LV.width / CELL), GH = Math.ceil(LV.depth / CELL), GN = GW * GH;
  const walk = new Uint8Array(GN * 2);
  const cover = new Uint8Array(GN * 2);
  const id = (f, i, j) => f * GN + j * GW + i;
  const cellOf = (x, z) => [clamp(Math.floor(x / CELL), 0, GW - 1), clamp(Math.floor(z / CELL), 0, GH - 1)];
  const cx = (i) => (i + 0.5) * CELL;
  (function buildGrid() {
    for (let f = 0; f < 2; f++) {
      const fy = f ? F1 : 0;
      for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) {
        const x = cx(i), z = cx(j);
        if (!inPoly(LV.polys[f], x, z)) continue;
        if (f === 1 && !LV.surfaces.some((s) => s.y === F1 && x > s.x0 + 0.05 && x < s.x1 - 0.05 && z > s.z0 + 0.05 && z < s.z1 - 0.05)) continue;
        if (LV.ramps.some((r) => x > r.x0 - 0.35 && x < r.x1 + 0.35 && z > r.z0 - 0.35 && z < r.z1 + 0.35)) continue;
        if (WORLD.blocked(x, z, 0.4, fy + 0.36, fy + 1.7)) continue;
        walk[id(f, i, j)] = 1;
      }
    }
  })();
  // stair links between floors
  const links = new Map();
  function nearestWalk(f, x, z, maxR = 10) {
    const [ci, cj] = cellOf(x, z);
    for (let r = 0; r <= maxR; r++) {
      let best = -1, bd = 1e9;
      for (let j = cj - r; j <= cj + r; j++) for (let i = ci - r; i <= ci + r; i++) {
        if (i < 0 || j < 0 || i >= GW || j >= GH) continue;
        if (Math.max(Math.abs(i - ci), Math.abs(j - cj)) !== r) continue;
        const n = id(f, i, j);
        if (walk[n]) { const d = (cx(i) - x) ** 2 + (cx(j) - z) ** 2; if (d < bd) { bd = d; best = n; } }
      }
      if (best >= 0) return best;
    }
    return -1;
  }
  const STAIR_NODES = [];
  for (const s of LV.stairs) {
    const a = nearestWalk(0, s.bottom[0], s.bottom[1], 3), b = nearestWalk(1, s.top[0], s.top[1], 3);
    if (a < 0 || b < 0) { console.warn('stair link missing', s.name); continue; }
    const cost = Math.hypot(s.top[0] - s.bottom[0], s.top[1] - s.bottom[1]) + 1;
    if (!links.has(a)) links.set(a, []); if (!links.has(b)) links.set(b, []);
    links.get(a).push([b, cost]); links.get(b).push([a, cost]);
    STAIR_NODES.push([a, b]);
  }
  const nodePos = (n) => { const f = n >= GN ? 1 : 0, k = n - f * GN; return [cx(k % GW), cx(Math.floor(k / GW)), f]; };
  // reachable area (flood from the entrance)
  const reach = new Uint8Array(GN * 2);
  const REACH = [];
  (function flood() {
    const s0 = nearestWalk(0, LV.seekerSpawns[0][0], LV.seekerSpawns[0][1]);
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
    // "cover" = how much stuff is around a cell (good hiding spots attract seekers)
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

  // A* with a binary heap
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
      if (n === b) {
        const out = []; let c = n; while (c >= 0) { out.push(c); c = came[c]; } out.reverse(); return out;
      }
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
    const pts = nodes.map(nodePos);
    const out = [pts[0]];
    let i = 0;
    while (i < pts.length - 1) {
      let j = i + 1;
      if (pts[j][2] === pts[i][2]) {
        while (j + 1 < pts.length && pts[j + 1][2] === pts[i][2] && lineWalkable(pts[i][2], pts[i][0], pts[i][1], pts[j + 1][0], pts[j + 1][1])) j++;
      }
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
    g.fillStyle = 'rgba(255,255,255,0.9)'; g.beginPath(); LV.polys[f].forEach(([x, z], i) => (i ? g.lineTo(x, z) : g.moveTo(x, z))); g.closePath(); g.fill();
    if (f === 1) { g.fillStyle = 'rgba(40,40,40,0.25)'; g.fillRect(24, 8, 16, 16); g.fillRect(24.2, 34, 3.6, 9); }
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
    return c;
  });
  const mm = $('minimap'), mg = mm.getContext('2d');

  // ---------------- state ----------------
  const P = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, vx: 0, vz: 0, crouch: false, ct: 0, run: false, bob: 0 };
  let G = null;            // current round
  let diffKey = 'normal';
  let mode = 'title';      // title | play | pause | end
  const keys = {};
  const touch = { move: null, look: null, mx: 0, mz: 0 };
  let mapOn = true;
  let lastTime = performance.now();
  const debug = /debug/.test(location.search);

  function bestKey(k) { return 'box-best-' + k; }
  function getBest(k) { try { return +localStorage.getItem(bestKey(k)) || 0; } catch (e) { return 0; } }
  function setBest(k, v) { try { localStorage.setItem(bestKey(k), String(v)); } catch (e) { /* storage blocked */ } }

  function newRound() {
    const D = DIFF[diffKey];
    const [px, py, pz, pyaw] = LV.playerSpawn;
    Object.assign(P, { x: px, y: py, z: pz, yaw: pyaw, pitch: 0, vx: 0, vz: 0, crouch: false, ct: 0, run: false });
    const seekers = [];
    for (let k = 0; k < D.seekers; k++) {
      const [sx, sz] = LV.seekerSpawns[k];
      seekers.push({ ...SEEKERS[k], x: sx, z: sz, y: 0, yaw: Math.PI / 2, state: 'count', path: null, pi: 0, t: 0, look: 0, mark: '', step: 0, stuck: 0, lastP: [sx, sz], seeing: false, lastSeen: null, searchLeft: 0, repath: 0, target: null, spd: 0, see: 0 });
    }
    G = { D, phase: 'hide', t: D.hide, survive: D.survive, seekers, alert: 0, noiseT: 0, msg: '', msgT: 0, elapsed: 0, caughtBy: null, beepT: 0, heartT: 0, hunchT: D.hunch || 0 };
    showMsg('Hide! They are counting…', 3);
  }

  // ---------------- input ----------------
  window.addEventListener('keydown', (e) => {
    keys[e.code] = true;
    if (mode === 'play') {
      if (e.code === 'KeyC' || e.code === 'ControlLeft') P.crouch = !P.crouch;
      if (e.code === 'KeyM') mapOn = !mapOn;
      if (e.code === 'Escape' || e.code === 'KeyP') pause();
    } else if (mode === 'pause' && (e.code === 'KeyP')) resume();
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  });
  window.addEventListener('keyup', (e) => { keys[e.code] = false; });
  window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; });
  let dragLook = false;
  canvas.addEventListener('mousedown', (e) => {
    if (mode !== 'play') return;
    if (!isTouch && canvas.requestPointerLock && document.pointerLockElement !== canvas) {
      try { const r = canvas.requestPointerLock(); if (r && r.catch) r.catch(() => {}); } catch (err) { /* blocked in some frames */ }
    }
    dragLook = true;
  });
  window.addEventListener('mouseup', () => { dragLook = false; });
  window.addEventListener('mousemove', (e) => {
    if (mode !== 'play') return;
    if (document.pointerLockElement === canvas || dragLook) look(e.movementX || 0, e.movementY || 0, 0.0024);
  });
  document.addEventListener('pointerlockchange', () => {
    if (document.pointerLockElement !== canvas && mode === 'play' && !isTouch && hadLock) pause();
    hadLock = document.pointerLockElement === canvas;
  });
  let hadLock = false;
  function look(dx, dy, k) { P.yaw += dx * k; P.pitch = clamp(P.pitch - dy * k, -1.35, 1.35); }

  const isTouch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
  if (isTouch) document.body.classList.add('touch');
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
  $('btnPause').addEventListener('click', () => pause());
  $('minimap').addEventListener('click', () => { mapOn = !mapOn; });

  // ---------------- audio ----------------
  let AC = null, master = null;
  function audioInit() {
    if (AC) { if (AC.state === 'suspended') AC.resume(); return; }
    try { AC = new (window.AudioContext || window.webkitAudioContext)(); master = AC.createGain(); master.gain.value = 0.6; master.connect(AC.destination); } catch (e) { AC = null; }
  }
  function tone(freq, dur, vol = 0.2, type = 'sine', when = 0, slide = 0) {
    if (!AC) return;
    const t0 = AC.currentTime + when, o = AC.createOscillator(), g = AC.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t0); if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t0 + dur);
    g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(vol, t0 + 0.01); g.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);
    o.connect(g); g.connect(master); o.start(t0); o.stop(t0 + dur + 0.05);
  }
  let noiseBuf = null;
  function step(vol, pan) {
    if (!AC || vol < 0.01) return;
    if (!noiseBuf) { noiseBuf = AC.createBuffer(1, AC.sampleRate * 0.08, AC.sampleRate); const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 3); }
    const s = AC.createBufferSource(); s.buffer = noiseBuf;
    const f = AC.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 900;
    const g = AC.createGain(); g.gain.value = vol;
    s.connect(f); f.connect(g);
    if (AC.createStereoPanner) { const p = AC.createStereoPanner(); p.pan.value = clamp(pan, -1, 1); g.connect(p); p.connect(master); } else g.connect(master);
    s.start();
  }

  // ---------------- HUD ----------------
  function showMsg(t, secs) { G.msg = t; G.msgT = secs; $('msg').textContent = t; $('msg').style.opacity = 1; }
  function fmt(t) { t = Math.max(0, Math.ceil(t)); return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0'); }
  function updateHUD(dt) {
    if (G.msgT > 0) { G.msgT -= dt; if (G.msgT <= 0) $('msg').style.opacity = 0; }
    $('phase').textContent = G.phase === 'hide' ? 'HIDE' : 'STAY HIDDEN';
    $('timer').textContent = G.phase === 'hide' ? fmt(G.t) : fmt(G.survive);
    $('phase').className = G.phase === 'hide' ? 'hide' : 'seek';
    $('where').textContent = (floorOf(P.y) ? 'Upstairs · ' : 'Downstairs · ') + zoneName(P.x, P.z, P.y);
    $('alertFill').style.width = Math.round(G.alert * 100) + '%';
    $('alert').style.opacity = G.alert > 0.02 ? 1 : 0.25;
    $('vignette').style.opacity = clamp(G.alert * 1.2, 0, 0.9);
    $('stance').textContent = P.crouch ? 'Crouched' : (P.run ? 'Running' : 'Standing');
    $('btnCrouch').classList.toggle('on', P.crouch);
    // minimap
    mm.style.display = mapOn ? 'block' : 'none';
    if (mapOn) {
      const f = floorOf(P.y), W = mm.width, H = mm.height, vw = 34, vh = vw * H / W;
      mg.clearRect(0, 0, W, H);
      mg.save();
      const s = W / vw;
      mg.translate(W / 2, H / 2); mg.scale(s / MAP_S, s / MAP_S);
      mg.translate(-P.x * MAP_S, -(LV.depth - P.z) * MAP_S);
      mg.globalAlpha = 0.92; mg.drawImage(mapImg[f], 0, 0); mg.globalAlpha = 1;
      const sx = (x) => x * MAP_S, sz = (z) => (LV.depth - z) * MAP_S;
      if (G.D.map || debug) for (const k of G.seekers) if (floorOf(k.y) === f) {
        mg.fillStyle = k.shirt; mg.beginPath(); mg.arc(sx(k.x), sz(k.z), 3.2, 0, TAU); mg.fill();
      }
      mg.translate(sx(P.x), sz(P.z)); mg.rotate(Math.PI - P.yaw);
      mg.fillStyle = '#d4402c'; mg.beginPath(); mg.moveTo(0, -6); mg.lineTo(4, 4); mg.lineTo(-4, 4); mg.closePath(); mg.fill();
      mg.restore();
      mg.fillStyle = 'rgba(20,20,20,0.75)'; mg.font = 'bold 11px system-ui, sans-serif'; mg.fillText(f ? 'UPSTAIRS' : 'DOWNSTAIRS', 6, 14);
    }
  }

  // ---------------- seekers ----------------
  function seekerFloorNode(k) { return nearestWalk(floorOf(k.y), k.x, k.z); }
  function goTo(k, x, z, f) {
    const a = seekerFloorNode(k), b = nearestWalk(f, x, z);
    const p = makePath(astar(a, b));
    if (p && p.length) { k.path = p; k.pi = 1; return true; }
    k.path = null; return false;
  }
  function pickPatrol(k) {
    const others = G.seekers.filter((o) => o !== k && o.target).map((o) => o.target);
    let best = null, bs = -1;
    for (let c = 0; c < 6; c++) {
      const n = (Math.random() < 0.75 && SPOTS.length) ? SPOTS[(Math.random() * SPOTS.length) | 0] : REACH[(Math.random() * REACH.length) | 0];
      const [x, z, f] = nodePos(n);
      let sc = Math.random() * 6 + Math.min(18, Math.hypot(x - k.x, z - k.z)) * 0.3;
      for (const t of others) sc += Math.min(20, Math.hypot(t[0] - x, t[1] - z) + (t[2] !== f ? 12 : 0)) * 0.5;
      if (sc > bs) { bs = sc; best = [x, z, f]; }
    }
    k.target = best; k.state = 'patrol'; k.mark = '';
    if (!goTo(k, best[0], best[1], best[2])) { k.state = 'look'; k.t = 0.5; }
  }
  function canSee(k) {
    const D = G.D;
    const ex = k.x, ey = k.y + 1.62, ez = k.z;
    const eye = P.y + lerp(1.6, 0.62, P.ct), body = P.y + lerp(1.0, 0.38, P.ct);
    const dx = P.x - ex, dz = P.z - ez, dy = eye - ey;
    const d = Math.hypot(dx, dz, dy * 0.6);
    if (d > D.range) return 0;
    if (d > 1.7) {
      const fx = Math.sin(k.yaw), fz = -Math.cos(k.yaw);
      const cos = (dx * fx + dz * fz) / Math.max(0.001, Math.hypot(dx, dz));
      if (cos < Math.cos((D.fov / 2) * Math.PI / 180)) return 0;
    }
    if (WORLD.clear(ex, ey, ez, P.x, eye + 0.08, P.z) || WORLD.clear(ex, ey, ez, P.x, body, P.z)) return d;
    return 0;
  }
  function hearNoise(x, z, f, radius) {
    for (const k of G.seekers) {
      if (k.state === 'chase' || k.state === 'count') continue;
      const r = floorOf(k.y) === f ? radius : radius * 0.45;
      if (Math.hypot(k.x - x, k.z - z) < r) {
        k.state = 'investigate'; k.mark = '?';
        const jx = x + (Math.random() - 0.5) * 3, jz = z + (Math.random() - 0.5) * 3;
        if (!goTo(k, jx, jz, f)) goTo(k, x, z, f);
      }
    }
  }
  function updateSeekers(dt) {
    const D = G.D;
    let rate = 0, top = null, topR = 0;
    for (const k of G.seekers) {
      if (G.phase === 'hide') { k.state = 'count'; continue; }
      if (k.state === 'count') pickPatrol(k);
      const d = canSee(k);
      k.seeing = d > 0;
      if (k.seeing) {
        let r = d < 2.2 ? 4.5 : 0.55 + 2.3 * (1 - d / D.range);
        if (P.ct > 0.5 && d > 3) r *= 0.5;
        if (Math.hypot(P.vx, P.vz) > 0.5) r *= 1.25;
        r *= D.rate; rate += r; if (r > topR) { topR = r; top = k; }
        k.see += dt;
        if (k.see > 0.25 || G.alert > 0.35) {
          if (k.state !== 'chase') { k.state = 'chase'; k.repath = 0; }
          k.lastSeen = [P.x, P.z, floorOf(P.y)]; k.mark = '!';
        } else if (k.state !== 'chase') k.mark = '?';
      } else k.see = 0;

      // brain
      if (k.state === 'chase') {
        k.repath -= dt;
        if (k.repath <= 0) { k.repath = 0.45; goTo(k, k.lastSeen[0], k.lastSeen[1], k.lastSeen[2]); }
        if (!k.seeing && (!k.path || k.pi >= k.path.length)) { k.state = 'search'; k.t = 2.2; k.look = k.yaw; k.searchLeft = 2; k.mark = '?'; }
      } else if (k.state === 'look' || k.state === 'search') {
        k.t -= dt; k.yaw = k.look + Math.sin((2.2 - k.t) * 1.9) * 1.15;
        if (k.t <= 0) {
          if (k.state === 'search' && k.searchLeft > 0 && k.lastSeen) {
            k.searchLeft--; const [lx, lz, lf] = k.lastSeen;
            const a = Math.random() * TAU, rr = 2 + Math.random() * 5;
            if (goTo(k, lx + Math.cos(a) * rr, lz + Math.sin(a) * rr, lf)) k.state = 'searchwalk'; else k.t = 1;
          } else pickPatrol(k);
        }
      }
      // movement along the path
      const moving = k.path && k.pi < k.path.length && k.state !== 'look' && k.state !== 'search';
      if (moving) {
        const spd = (k.state === 'chase' ? 3.7 : k.state === 'investigate' ? 2.7 : k.state === 'searchwalk' ? 2.3 : 1.9) * D.speed;
        let left = spd * dt;
        while (left > 0 && k.pi < k.path.length) {
          const [tx, tz] = k.path[k.pi];
          const ddx = tx - k.x, ddz = tz - k.z, dist = Math.hypot(ddx, ddz);
          if (dist < 0.05) { k.pi++; continue; }
          const m = Math.min(left, dist); k.x += (ddx / dist) * m; k.z += (ddz / dist) * m; left -= m;
          const want = Math.atan2(ddx, -ddz);
          let dy = want - k.yaw; while (dy > Math.PI) dy -= TAU; while (dy < -Math.PI) dy += TAU;
          if (!(k.state === 'chase' && k.seeing)) k.yaw += dy * Math.min(1, dt * 7);
          if (dist <= m + 1e-4) k.pi++;
        }
        k.y = surfaceY(k.x, k.z, k.y);
        k.spd = spd;
        // footsteps
        const before = k.step; k.step += spd * dt * 0.9;
        if (Math.floor(before) !== Math.floor(k.step)) {
          const dd = Math.hypot(k.x - P.x, k.z - P.z) + Math.abs(k.y - P.y) * 2;
          const rel = Math.atan2(k.x - P.x, -(k.z - P.z)) - P.yaw;
          step(Math.pow(clamp(1 - dd / 20, 0, 1), 1.6) * 0.55, Math.sin(rel));
        }
        // stuck check
        k.stuck += dt;
        if (k.stuck > 2.5) { if (Math.hypot(k.x - k.lastP[0], k.z - k.lastP[1]) < 0.6) { if (k.state === 'chase') k.repath = 0; else pickPatrol(k); } k.stuck = 0; k.lastP = [k.x, k.z]; }
        if (k.pi >= k.path.length) {
          if (k.state === 'patrol') { k.state = 'look'; k.t = 1.2 + Math.random() * 1.6; k.look = k.yaw; }
          else if (k.state === 'investigate') { k.state = 'look'; k.t = 2.2; k.look = k.yaw; k.mark = '?'; }
          else if (k.state === 'searchwalk') { k.state = 'search'; k.t = 2; k.look = k.yaw; }
        }
      } else k.spd = 0;
      if (k.state === 'chase' && k.seeing) {
        const want = Math.atan2(P.x - k.x, -(P.z - k.z));
        let dy = want - k.yaw; while (dy > Math.PI) dy -= TAU; while (dy < -Math.PI) dy += TAU; k.yaw += dy * Math.min(1, dt * 8);
      }
      if (k.state === 'patrol' || k.state === 'look') { if (k.mark === '?' && k.state === 'patrol') k.mark = ''; }
    }
    // keep seekers apart
    for (let a = 0; a < G.seekers.length; a++) for (let b = a + 1; b < G.seekers.length; b++) {
      const A = G.seekers[a], B = G.seekers[b];
      if (Math.abs(A.y - B.y) > 1) continue;
      const dx = B.x - A.x, dz = B.z - A.z, d = Math.hypot(dx, dz);
      if (d > 0 && d < 0.7) { const p = (0.7 - d) / 2 / d; A.x -= dx * p; A.z -= dz * p; B.x += dx * p; B.z += dz * p; }
    }
    // a "hunch": now and then one patrolling seeker wanders toward your general area
    if (G.phase !== 'hide' && G.D.hunch) {
      G.hunchT -= dt;
      if (G.hunchT <= 0) {
        G.hunchT = G.D.hunch;
        const free = G.seekers.filter((k) => k.state === 'patrol' || k.state === 'look');
        if (free.length) {
          const k = free[(Math.random() * free.length) | 0], a = Math.random() * TAU, r = 4 + Math.random() * 7;
          k.state = 'patrol'; k.mark = ''; k.target = [P.x + Math.cos(a) * r, P.z + Math.sin(a) * r, floorOf(P.y)];
          if (!goTo(k, k.target[0], k.target[1], k.target[2])) pickPatrol(k);
        }
      }
    }
    if (G.phase !== 'hide') {
      if (rate > 0) G.alert = Math.min(1, G.alert + rate * dt);
      else G.alert = Math.max(0, G.alert - 0.3 * dt);
      if (G.alert >= 1) caught(top || G.seekers[0]);
    }
  }

  // ---------------- player ----------------
  function updatePlayer(dt) {
    let fwd = 0, str = 0;
    if (keys.KeyW || keys.ArrowUp) fwd += 1; if (keys.KeyS || keys.ArrowDown) fwd -= 1;
    if (keys.KeyD || keys.ArrowRight) str += 1; if (keys.KeyA || keys.ArrowLeft) str -= 1;
    if (keys.KeyQ) look(-260 * dt, 0, 0.01); if (keys.KeyE) look(260 * dt, 0, 0.01);
    if (touch.move) { fwd = -touch.mz; str = touch.mx; }
    const mag = Math.hypot(fwd, str); if (mag > 1) { fwd /= mag; str /= mag; }
    const running = (keys.ShiftLeft || keys.ShiftRight || P.run) && !P.crouch;
    const sp = P.crouch ? 1.7 : running ? 5.3 : 3.2;
    const sy = Math.sin(P.yaw), cy = Math.cos(P.yaw);
    const wx = (sy * fwd + cy * str) * sp, wz = (-cy * fwd + sy * str) * sp;
    const k = Math.min(1, dt * 12);
    P.vx += (wx - P.vx) * k; P.vz += (wz - P.vz) * k;
    P.ct += ((P.crouch ? 1 : 0) - P.ct) * Math.min(1, dt * 10);
    const bodyH = lerp(1.75, 0.92, P.ct);
    let nx = P.x + P.vx * dt, nz = P.z + P.vz * dt;
    [nx, nz] = WORLD.collide(nx, nz, P.y, bodyH, 0.3, 0.35);
    const ny = surfaceY(nx, nz, P.y);
    P.x = nx; P.z = nz; P.y = ny;
    const spd = Math.hypot(P.vx, P.vz);
    P.bob += spd * dt * 2.2;
    // standing up is blocked if something is overhead
    if (!P.crouch && P.ct > 0.05) { /* nothing low overhead in this store */ }
    // noise
    if (G.phase !== 'hide') {
      G.noiseT -= dt;
      if (spd > 0.6 && G.noiseT <= 0) {
        G.noiseT = 0.35;
        const r = running && spd > 4 ? 13 : P.crouch ? 1.4 : 4.5;
        hearNoise(P.x, P.z, floorOf(P.y), r);
      }
    }
    // seekers bump you
    for (const s of G.seekers) {
      if (Math.abs(s.y - P.y) > 1) continue;
      const dx = P.x - s.x, dz = P.z - s.z, d = Math.hypot(dx, dz);
      if (d > 0 && d < 0.6) { P.x += (dx / d) * (0.6 - d); P.z += (dz / d) * (0.6 - d); }
    }
  }

  // ---------------- seeker drawing ----------------
  const shirtC = {}, hx = (h) => shirtC[h] || (shirtC[h] = hex(h));
  function drawSeekers(t) {
    const g = new Geo();
    for (const k of G.seekers) {
      // local: +x right, -z forward (seeker faces -z local == its yaw)
      const P2 = (lx, lz) => { // rotate so local -z points along facing (sin yaw, -cos yaw)
        const fx = Math.sin(k.yaw), fz = -Math.cos(k.yaw), rx = Math.cos(k.yaw), rz = Math.sin(k.yaw);
        return [k.x + rx * lx - fx * lz, k.z + rz * lx - fz * lz];
      };
      const yaw = -k.yaw;
      const sw = k.spd > 0 ? Math.sin(k.step * Math.PI) * 0.45 : 0;
      const y = k.y;
      const pants = hx('#2b2d33'), shirt = hx(k.shirt), skin = hx(k.skin), hair = hx(k.hair), apron = hx('#3a3a3c');
      // legs
      for (const side of [-1, 1]) {
        const a = sw * side, [lx, lz] = P2(side * 0.11, -Math.sin(a) * 0.25);
        g.box(lx, y, lz, 0.15, 0.85, 0.17, yaw, pants);
        const [fx2, fz2] = P2(side * 0.11, -Math.sin(a) * 0.38 - 0.05);
        g.box(fx2, y, fz2, 0.16, 0.08, 0.28, yaw, hx('#1d1d1f'));
      }
      // body
      let [bx, bz] = P2(0, 0);
      g.box(bx, y + 0.85, bz, 0.46, 0.62, 0.26, yaw, shirt);
      [bx, bz] = P2(0, -0.135);
      g.box(bx, y + 0.8, bz, 0.4, 0.62, 0.02, yaw, apron);
      // arms
      const counting = k.state === 'count';
      for (const side of [-1, 1]) {
        if (counting) {
          const [ax, az] = P2(side * 0.2, -0.18); g.box(ax, y + 1.25, az, 0.12, 0.12, 0.42, yaw, shirt);
          const [hx2, hz2] = P2(side * 0.06, -0.33); g.box(hx2, y + 1.55, hz2, 0.12, 0.14, 0.08, yaw, skin);
        } else {
          const a = -sw * side * 0.8, [ax, az] = P2(side * 0.3, -Math.sin(a) * 0.15);
          g.box(ax, y + 0.85, az, 0.12, 0.6, 0.13, yaw, shirt);
          const [hx2, hz2] = P2(side * 0.3, -Math.sin(a) * 0.25);
          g.box(hx2, y + 0.75, hz2, 0.1, 0.12, 0.1, yaw, skin);
        }
      }
      // head
      [bx, bz] = P2(0, 0);
      g.box(bx, y + 1.47, bz, 0.13, 0.08, 0.13, yaw, skin);
      g.box(bx, y + 1.53, bz, 0.3, 0.3, 0.3, yaw, skin);
      g.box(bx, y + 1.78, bz, 0.32, 0.1, 0.32, yaw, hair);
      [bx, bz] = P2(0, 0.06); g.box(bx, y + 1.6, bz, 0.32, 0.2, 0.22, yaw, hair);
      for (const side of [-1, 1]) { const [ex, ez] = P2(side * 0.07, -0.152); g.box(ex, y + 1.66, ez, 0.05, 0.05, 0.01, yaw, hx('#111111')); }
      // marker above head
      if (k.mark) {
        const col = k.mark === '!' ? hx('#ff4a2e') : hx('#ffd23a');
        const bobY = y + 2.15 + Math.sin(t * 6) * 0.04;
        if (k.mark === '!') { g.box(k.x, bobY + 0.14, k.z, 0.09, 0.3, 0.09, 0, col, MAT.GLOW); g.box(k.x, bobY, k.z, 0.09, 0.09, 0.09, 0, col, MAT.GLOW); }
        else { g.box(k.x, bobY + 0.34, k.z, 0.22, 0.07, 0.07, 0, col, MAT.GLOW); g.box(k.x + 0.11, bobY + 0.22, k.z, 0.07, 0.17, 0.07, 0, col, MAT.GLOW); g.box(k.x, bobY + 0.14, k.z, 0.07, 0.1, 0.07, 0, col, MAT.GLOW); g.box(k.x, bobY, k.z, 0.07, 0.07, 0.07, 0, col, MAT.GLOW); }
      }
    }
    return g.array();
  }

  // ---------------- flow ----------------
  function startGame() {
    audioInit();
    newRound();
    mode = 'play';
    $('title').style.display = 'none'; $('end').style.display = 'none'; $('pause').style.display = 'none';
    $('hud').style.display = 'block';
    if (!isTouch) { try { const r = canvas.requestPointerLock && canvas.requestPointerLock(); if (r && r.catch) r.catch(() => {}); } catch (e) { /* ignore */ } }
  }
  function pause() {
    if (mode !== 'play') return;
    mode = 'pause'; $('pause').style.display = 'flex';
    if (document.pointerLockElement) document.exitPointerLock();
  }
  function resume() {
    mode = 'play'; $('pause').style.display = 'none'; lastTime = performance.now();
    if (!isTouch) { try { const r = canvas.requestPointerLock && canvas.requestPointerLock(); if (r && r.catch) r.catch(() => {}); } catch (e) { /* ignore */ } }
  }
  function toTitle() {
    mode = 'title'; $('pause').style.display = 'none'; $('end').style.display = 'none'; $('hud').style.display = 'none';
    $('title').style.display = 'flex'; refreshBest();
    if (document.pointerLockElement) document.exitPointerLock();
  }
  function caught(k) {
    if (mode !== 'play') return;
    mode = 'end'; G.caughtBy = k;
    tone(220, 0.5, 0.25, 'sawtooth', 0, -120); tone(110, 0.8, 0.2, 'square', 0.15, -40);
    const survived = G.D.survive - G.survive;
    $('endTitle').textContent = 'FOUND!';
    $('endTitle').className = 'lose';
    $('endText').innerHTML = `<b>${k.name}</b> found you in the <b>${zoneName(P.x, P.z, P.y)}</b>${floorOf(P.y) ? ' (upstairs)' : ''}.<br>You lasted ${fmt(survived)} of ${fmt(G.D.survive)}.`;
    $('end').style.display = 'flex';
    if (document.pointerLockElement) document.exitPointerLock();
  }
  function win() {
    mode = 'end';
    [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.3, 0.18, 'triangle', i * 0.12));
    const prev = getBest(diffKey); const wins = prev + 1; setBest(diffKey, wins);
    $('endTitle').textContent = 'YOU STAYED HIDDEN!';
    $('endTitle').className = 'win';
    $('endText').innerHTML = `Nobody found you in the <b>${zoneName(P.x, P.z, P.y)}</b>${floorOf(P.y) ? ' (upstairs)' : ''}.<br>${G.D.label} wins so far: <b>${wins}</b>`;
    $('end').style.display = 'flex';
    if (document.pointerLockElement) document.exitPointerLock();
  }
  function refreshBest() {
    $('best').textContent = ['easy', 'normal', 'hard'].map((k) => `${DIFF[k].label}: ${getBest(k)} win${getBest(k) === 1 ? '' : 's'}`).join(' · ');
  }
  document.querySelectorAll('[data-diff]').forEach((b) => b.addEventListener('click', () => {
    diffKey = b.dataset.diff;
    document.querySelectorAll('[data-diff]').forEach((x) => x.classList.toggle('sel', x === b));
  }));
  $('play').addEventListener('click', startGame);
  $('again').addEventListener('click', startGame);
  $('menu').addEventListener('click', toTitle);
  $('resume').addEventListener('click', resume);
  $('quit').addEventListener('click', toTitle);

  // ---------------- main loop ----------------
  let titleCam = 0;
  function frame(now) {
    const dt = Math.min(0.05, (now - lastTime) / 1000); lastTime = now;
    R.resize(isTouch ? 1.25 : 1.5);
    let ex, ey, ez, yaw, pitch;
    if (mode === 'play') tick(dt);
    if (mode === 'title') {
      titleCam += dt * 0.06;
      ex = 32 + Math.cos(titleCam) * 13; ez = 16 + Math.sin(titleCam) * 9; ey = 7.2;
      yaw = Math.atan2(32 - ex, -(16 - ez)); pitch = -0.32;
    } else {
      ex = P.x; ez = P.z; ey = P.y + lerp(1.6, 0.62, P.ct) + Math.sin(P.bob) * 0.03 * (1 - P.ct * 0.5);
      yaw = P.yaw; pitch = P.pitch;
    }
    const proj = perspective(1.2, canvas.width / Math.max(1, canvas.height), 0.05, 140);
    const vp = mul4(proj, viewFPS(ex, ey, ez, yaw, pitch));
    R.begin(vp, [ex, ey, ez], mode === 'title' ? 0 : (G ? G.alert : 0));
    R.draw(STATIC);
    if (G && mode !== 'title') R.drawDynamic(drawSeekers(now / 1000));
    requestAnimationFrame(frame);
  }
  function tick(dt) {
    G.elapsed += dt;
    updatePlayer(dt);
    if (G.phase === 'hide') {
      G.t -= dt;
      if (G.t <= 5 && Math.ceil(G.t) !== Math.ceil(G.t + dt)) { tone(880, 0.12, 0.15, 'square'); showMsg(String(Math.ceil(G.t)), 0.9); }
      if (G.t <= 0) { G.phase = 'seek'; tone(440, 0.4, 0.2, 'square'); tone(660, 0.5, 0.2, 'square', 0.15); showMsg('Ready or not, here we come!', 2.5); }
    } else {
      G.survive -= dt;
      if (G.survive <= 0) { win(); return; }
    }
    updateSeekers(dt);
    if (mode !== 'play') return;
    if (G.alert > 0.25) { G.heartT -= dt; if (G.heartT <= 0) { G.heartT = lerp(0.9, 0.35, G.alert); tone(70, 0.14, 0.35 * G.alert, 'sine', 0, -20); tone(60, 0.14, 0.25 * G.alert, 'sine', 0.12, -20); } }
    updateHUD(dt);
  }

  // debug/test hooks
  window.__box = {
    get P() { return P; }, get G() { return G; }, get mode() { return mode; }, LV, walkCount: () => walk.reduce((a, b) => a + b, 0), reach: () => REACH.length,
    spots: () => SPOTS.length, links: () => STAIR_NODES.length, start: (d) => { if (d) diffKey = d; startGame(); },
    tick: (dt, n) => { for (let i = 0; i < n && mode === 'play'; i++) tick(dt); },
    setP: (x, y, z, yaw, pitch, crouch) => { Object.assign(P, { x, y, z, yaw, pitch: pitch || 0 }); if (crouch != null) { P.crouch = crouch; P.ct = crouch ? 1 : 0; } },
    zoneName, astarTest: (x0, z0, f0, x1, z1, f1) => { const p = makePath(astar(nearestWalk(f0, x0, z0), nearestWalk(f1, x1, z1))); return p; },
    mapImg,
  };
  refreshBest();
  requestAnimationFrame(frame);
})();
