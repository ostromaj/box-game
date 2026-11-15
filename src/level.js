// ============================================================
// BOX — the store, plus the parking lot outside.
// Invented layout (not a copy of any real store). Meters; x west→east
// (0..64), z south→north (0..40). Outside is z<0 (front) and x>64 (side).
// Ground floor y=0, upstairs y=4.5, roof y=9.
// ============================================================

const F1 = 4.5;

const COL = {
  wall: hex('#ece9e2'), ship: hex('#f2f0ea'), trim: hex('#ffffff'),
  concrete: hex('#b7a98f'), hardwood: hex('#cf9f68'), upWood: hex('#d8b48a'), tile: hex('#ebeae5'),
  ceil: hex('#f3f0ea'), ceilWood: hex('#d9bf98'),
  woodLight: hex('#d7b88f'), woodMid: hex('#a87a4c'), woodDark: hex('#4f3526'), black: hex('#232325'),
  steel: hex('#b9bec4'), white: hex('#f6f5f1'), cream: hex('#e4dccd'), navy: hex('#34405a'),
  tan: hex('#c49a6c'), sage: hex('#8f9a7d'), olive: hex('#6f7556'), rust: hex('#a35d45'),
  red: hex('#9e2f37'), green: hex('#2f5a35'), brick: hex('#8d4b3b'), glassNight: hex('#0e1522'),
  metal: hex('#8f959b'), marble: hex('#ebe8e3'), stone: hex('#d6cfc4'), warm: hex('#ffe2a8'), bulb: hex('#fff3d6'),
  snow: hex('#e8edf4'), asphalt: hex('#3a3c42'), soil: hex('#2a1f17'),
};
const PAL = {
  mixed: ['#f2f0ea', '#e4ddd0', '#c9c4bb', '#8a9aa8', '#5d7a8c', '#a35d45', '#2b2b2b', '#d8c3a0', '#7d8f72', '#b9a27f'],
  plates: ['#f7f6f2', '#ecebe6', '#dcd9d2', '#9fb3b0', '#7f8d99', '#3b3f45', '#c9d3cf'],
  glass: ['#dfe8ea', '#e8eef0', '#cfdcdf', '#f2f5f6', '#c8d8d2'],
  pillows: ['#e8e1d6', '#c9b8a3', '#8e9a86', '#5b6b7d', '#b07d62', '#d9cfc0', '#4a4a48', '#a8a29a', '#6e5a4a'],
  appl: ['#2a2a2c', '#b9bec4', '#d7d9db', '#7a7f86', '#e9e6df', '#3d5a4e', '#9b2f2f', '#40464d'],
  cook: ['#3a5a8a', '#7aa3a0', '#e8e0d0', '#b9bec4', '#2a2a2c', '#c8553d', '#6d8b74', '#efe9dc'],
  gifts: ['#a8323a', '#2f5a3f', '#f2f0ea', '#c9a24b', '#2b2b2b', '#7a1f2b', '#d9d2c4'],
  boxes: ['#b8925f', '#c49e6b', '#a8834f', '#d1b07c'],
  vases: ['#efebe3', '#e2dbcf', '#cfc6b8', '#8b8f8c', '#5e615f', '#c9b9a0', '#9a6b4f'],
  orn: ['#b3262f', '#e8e2d6', '#c9a24b', '#1f3b6b', '#2f5a3f', '#d9d2c4', '#7a1f2b'],
};

function buildLevel() {
  let G = new Geo(true);
  const obbs = [], lights = [];
  // Downloaded models (assets/models/*.glb, embedded by tools/build.py as window.BOX_GLB). When one is there, the
  // hand-built piece is built into a throwaway buffer (so the random layout and colliders stay identical) and
  // the renderer draws the model in its place.
  const HAVE = (typeof window !== 'undefined' && window.BOX_GLB) || {}, models = [];
  let CUR = { x: 0, y: 0, z: 0, yaw: 0 };
  const lin = (c, k = 1) => [Math.pow(c[0], 2.2) * k, Math.pow(c[1], 2.2) * k, Math.pow(c[2], 2.2) * k];
  function model(key, o, fn) {
    if (!HAVE[key]) return fn();
    const c = Math.cos(CUR.yaw), s = Math.sin(CUR.yaw), lx = o.lx || 0, lz = o.lz || 0;
    models.push(Object.assign({ key, x: CUR.x + lx * c + lz * s, y: CUR.y + (o.ly || 0), z: CUR.z - lx * s + lz * c, yaw: CUR.yaw }, o));
    const keep = G; G = new Geo(true); try { fn(); } finally { G = keep; }
  }
  const rnd = mulberry32(20261114);
  const R = (a, b) => a + (b - a) * rnd();
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const pc = (arr) => hex(pick(arr));
  const W = 64, D = 40, Y = F1, ROOF = 9;
  const light = (x, y, z, col, r, i) => lights.push({ x, y, z, c: typeof col === 'string' ? hex(col) : col, r, i, out: z < -0.2 || x > 64.2 });

  // ---------- primitives ----------
  function solid(cx, y0, cz, sx, sy, sz, yaw, col, mat = 0, o = {}) {
    if (o.round) G.rbox(cx, y0, cz, sx, sy, sz, yaw, col, mat, o.round); else G.box(cx, y0, cz, sx, sy, sz, yaw, col, mat, o.top || null);
    if (o.collide !== false || o.opaque !== false) obbs.push(makeOBB(cx, cz, sx / 2, sz / 2, yaw, y0, y0 + sy, o.opaque !== false, o.collide !== false));
  }
  function wall(x1, z1, x2, z2, y0, y1, col = COL.wall, mat = MAT.PLAIN, thick = 0.3, o = {}) {
    const len = Math.hypot(x2 - x1, z2 - z1), yaw = Math.atan2(-(z2 - z1), x2 - x1);
    solid((x1 + x2) / 2, y0, (z1 + z2) / 2, len + (o.noExtend ? 0 : thick), y1 - y0, thick, yaw, col, mat, o);
  }
  // draw in a local frame: front of furniture faces local +z
  function place(x, y, z, yaw, fn) {
    yaw = yaw || 0;
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const h = {
      w: (lx, lz) => [x + lx * c + lz * s, z - lx * s + lz * c],
      hit(lx, lz, sx, sz, y0, y1, opaque = true, collide = true, lyaw = 0) { const [wx, wz] = h.w(lx, lz); obbs.push(makeOBB(wx, wz, sx / 2, sz / 2, yaw + lyaw, y + y0, y + y1, opaque, collide)); },
      light(lx, ly, lz, col, r, i) { const [wx, wz] = h.w(lx, lz); light(wx, y + ly, wz, col, r, i); },
    };
    const was = CUR; CUR = { x, y, z, yaw };
    G.push(A.mul(A.T(x, y, z), A.Ry(yaw)));
    fn(h);
    G.pop(); CUR = was;
  }
  const rot = (lx, ly, lz, yaw, pitch, roll, fn) => { G.push(A.chain(A.T(lx, ly, lz), A.Ry(yaw || 0), A.Rx(pitch || 0), A.Rz(roll || 0))); fn(); G.pop(); };

  // ---------- small things on shelves ----------
  function vase(x, y, z, h, col) {
    const k = rnd(), r = h * R(0.22, 0.34);
    const prof = k < 0.33 ? [[0, 0], [r * 0.7, 0, 1], [r, h * 0.35], [r * 0.9, h * 0.7], [r * 0.45, h * 0.88], [r * 0.5, h, 1], [r * 0.38, h, 1], [r * 0.3, h * 0.6]]
      : k < 0.66 ? [[0, 0], [r * 0.8, 0, 1], [r, h * 0.2], [r * 0.95, h * 0.8], [r * 0.85, h, 1], [r * 0.7, h, 1], [r * 0.6, h * 0.5]]
        : [[0, 0], [r * 0.5, 0, 1], [r, h * 0.55], [r * 0.6, h * 0.92], [r * 0.32, h, 1], [r * 0.25, h * 0.8]];
    G.lathe(x, y, z, prof, col, MAT.CERAMIC, 8);
  }
  function items(x0, x1, y, lz, depth, style, hMax) {
    let x = x0 + R(0, 0.06);
    while (x < x1 - 0.12) {
      let w = R(0.22, 0.42), col;
      const d = depth * R(0.6, 0.9);
      if (style === 'plates') {
        w = R(0.24, 0.3); const r = w / 2, h = R(0.06, Math.min(0.2, hMax)); col = pc(PAL.plates);
        if (rnd() < 0.7) G.lathe(x + r, y, lz, [[0, 0], [r * 0.62, 0, 1], [r, h * 0.3], [r, h, 1], [r * 0.82, h, 1], [r * 0.6, h * 0.92], [0, h * 0.92]], col, MAT.CERAMIC, 8);
        else G.lathe(x + r, y, lz, [[0, 0], [r * 0.45, 0, 1], [r * 0.85, h * 0.6], [r, h, 1], [r * 0.9, h, 1], [r * 0.7, h * 0.55], [r * 0.4, h * 0.2], [0, h * 0.2]], col, MAT.CERAMIC, 8);
      } else if (style === 'glass') {
        w = R(0.1, 0.16); const r = w / 2; col = pc(PAL.glass);
        for (let k = 0; k < 1; k++) {
          const zz = lz;
          if (rnd() < 0.5) G.lathe(x + r, y, zz, [[0, 0], [r * 0.85, 0, 1], [r, Math.min(0.14, hMax), 1], [r * 0.9, Math.min(0.14, hMax), 1], [r * 0.75, 0.02]], col, MAT.CERAMIC, 8);
          else { const H = Math.min(0.22, hMax); G.lathe(x + r, y, zz, [[0, 0], [r * 0.7, 0, 1], [r * 0.7, 0.008, 1], [0.008, 0.02], [0.008, H * 0.45], [r * 0.85, H * 0.6], [r, H, 1], [r * 0.9, H, 1], [r * 0.6, H * 0.62]], col, MAT.CERAMIC, 8); }
        }
      } else if (style === 'pillows') {
        w = R(0.38, 0.5); const h = R(0.3, Math.min(0.46, hMax)); col = pc(PAL.pillows);
        rot(x + w / 2, y + h / 2, lz, R(-0.15, 0.15), R(-0.15, 0.05), 0, () => G.rbox(0, -h / 2, 0, w, h, d * 0.55, 0, col, MAT.FABRIC, 0.09));
      } else if (style === 'appl') {
        w = R(0.28, 0.42); const h = R(0.26, Math.min(0.46, hMax)); col = pc(PAL.appl); const k = rnd();
        if (k < 0.35) { G.lathe(x + w / 2, y, lz, [[0, 0], [w * 0.38, 0, 1], [w * 0.42, h * 0.1], [w * 0.36, h * 0.85], [w * 0.2, h, 1], [0, h]], col, MAT.METAL, 8); G.tube([[x + w * 0.85, y + h * 0.75, lz], [x + w * 1.02, y + h * 0.6, lz], [x + w * 0.88, y + h * 0.2, lz]], 0.012, COL.black, 0, 5); }
        else if (k < 0.65) { G.rbox(x + w / 2, y, lz, w, h * 0.7, d * 0.7, 0, col, MAT.METAL, 0.04); for (const q of [-0.12, 0.12]) G.box(x + w / 2, y + h * 0.69, lz + q * d, w * 0.7, 0.01, 0.025, 0, COL.black); }
        else { G.rbox(x + w / 2, y, lz, w, h, d * 0.75, 0, col, MAT.METAL, 0.03); G.box(x + w / 2, y + h * 0.3, lz + d * 0.38, w * 0.5, h * 0.35, 0.02, 0, COL.black); G.cyl(x + w / 2, y + h * 0.05, lz + d * 0.2, w * 0.18, h * 0.22, COL.steel, MAT.METAL, 8); }
      } else if (style === 'cook') {
        w = R(0.26, 0.4); const r = w / 2, h = R(0.1, Math.min(0.24, hMax)); col = pc(PAL.cook);
        G.lathe(x + r, y, lz, [[0, 0], [r * 0.9, 0, 1], [r, h * 0.15], [r, h, 1], [r * 0.96, h, 1], [r * 0.96, h * 0.9]], col, MAT.CERAMIC, 8);
        G.lathe(x + r, y + h, lz, [[r * 0.97, 0, 1], [r * 0.7, 0.03], [0.03, 0.05], [0.03, 0.07, 1], [0, 0.07]], col, MAT.CERAMIC, 8);
        for (const q of [-1, 1]) G.box(x + r + q * r * 1.05, y + h * 0.75, lz, 0.05, 0.025, 0.07, 0, col);
      } else if (style === 'gifts') {
        const h = R(0.1, Math.min(0.3, hMax)); col = pc(PAL.gifts); const rib = rnd() < 0.5 ? hex('#d6b24a') : COL.white;
        G.box(x + w / 2, y, lz, w, h, d, 0, col); G.box(x + w / 2, y, lz, 0.025, h + 0.003, d + 0.004, 0, rib); G.box(x + w / 2, y, lz, w + 0.004, h + 0.003, 0.025, 0, rib);
        G.ellipsoid(x + w / 2 - 0.03, y + h + 0.02, lz, 0.035, 0.02, 0.02, rib, 0, 6, 4); G.ellipsoid(x + w / 2 + 0.03, y + h + 0.02, lz, 0.035, 0.02, 0.02, rib, 0, 6, 4);
      } else if (style === 'boxes') {
        const h = R(0.25, Math.min(0.5, hMax)); w = R(0.35, 0.6); col = pc(PAL.boxes);
        G.box(x + w / 2, y, lz, w, h, d * 0.9, 0, col); G.box(x + w / 2, y + h - 0.004, lz, w + 0.002, 0.006, 0.05, 0, shade(col, 1.15));
      } else if (style === 'vases') {
        w = R(0.16, 0.3); vase(x + w / 2, y, lz, R(0.15, Math.min(0.42, hMax)), pc(PAL.vases));
      } else {
        const k = rnd(); col = pc(PAL.mixed);
        if (k < 0.35) { w = R(0.16, 0.28); vase(x + w / 2, y, lz, R(0.15, Math.min(0.36, hMax)), col); }
        else if (k < 0.55) { w = R(0.24, 0.34); const r = w / 2; G.lathe(x + r, y, lz, [[0, 0], [r * 0.45, 0, 1], [r * 0.9, r * 0.45], [r, r * 0.55, 1], [r * 0.9, r * 0.55, 1], [0, r * 0.2]], col, MAT.CERAMIC, 8); }
        else if (k < 0.75) { w = R(0.1, 0.16); G.cyl(x + w / 2, y, lz, w * 0.4, R(0.1, Math.min(0.22, hMax)), COL.cream, 0, 8); }
        else { w = R(0.16, 0.28); let xx = x; for (let i = 0; i < 4; i++) { const t = R(0.03, 0.05); G.box(xx + t / 2, y, lz, t, R(0.18, Math.min(0.26, hMax)), d * 0.8, 0, pc(['#5b6b7d', '#a35d45', '#2b2b2b', '#d9cfc0', '#7d8f72'])); xx += t + 0.003; } }
      }
      x += w + R(0.03, 0.12);
    }
  }
  function shelfWall(x, y, z, yaw, len, style = 'mixed', h = 2.2, depth = 0.42, back = COL.woodLight) {
    place(x, y, z, yaw, (H) => {
      G.box(0, 0, -depth / 2 + 0.03, len, h, 0.06, 0, back, MAT.SHIPLAP);
      for (const q of [-1, 1]) G.box(q * (len / 2 - 0.03), 0, 0, 0.06, h, depth, 0, shade(back, 0.95), MAT.GRAIN);
      G.box(0, h, 0, len + 0.06, 0.06, depth + 0.04, 0, shade(back, 0.92), MAT.GRAIN);
      G.box(0, 0, 0.01, len, 0.1, depth - 0.02, 0, COL.black);
      const n = Math.max(3, Math.floor(h / 0.42));
      for (let i = 0; i < n; i++) {
        const sy = 0.12 + i * ((h - 0.25) / (n - 1));
        G.box(0, sy - 0.03, 0.02, len - 0.12, 0.03, depth - 0.04, 0, COL.white);
        if (i < n - 1) items(-len / 2 + 0.1, len / 2 - 0.1, sy, 0.02, depth - 0.1, style, (h - 0.25) / (n - 1) - 0.06);
      }
      H.hit(0, 0, len, depth, 0, h);
    });
  }
  function gondola(x, y, z, yaw, len, style = 'mixed', h = 1.45, depth = 1.0) {
    place(x, y, z, yaw, (H) => {
      G.box(0, 0, 0, len, 0.12, depth, 0, COL.black);
      G.box(0, 0, 0, len - 0.02, h, 0.08, 0, COL.woodLight, MAT.SHIPLAP);
      for (const q of [-1, 1]) G.rbox(q * (len / 2 - 0.03), 0, 0, 0.06, h, depth, 0, COL.woodLight, MAT.GRAIN, 0.02);
      const n = 3;
      for (let i = 0; i < n; i++) {
        const sy = 0.14 + i * ((h - 0.2) / n);
        for (const side of [-1, 1]) {
          G.box(0, sy - 0.03, side * depth / 4, len - 0.12, 0.03, depth / 2 - 0.08, 0, COL.white);
          items(-len / 2 + 0.1, len / 2 - 0.1, sy, side * depth / 4, depth / 2 - 0.12, style, (h - 0.2) / n - 0.06);
        }
      }
      H.hit(0, 0, len, depth, 0, h);
    });
  }
  function displayTable(x, y, z, yaw, w, d, h = 0.85, col = COL.white, style = 'mixed', twoTier = true) {
    place(x, y, z, yaw, (H) => {
      G.rbox(0, h - 0.05, 0, w, 0.05, d, 0, col, MAT.GRAIN, 0.015);
      for (const ex of [-1, 1]) G.box(ex * (w / 2 - 0.05), 0, 0, 0.08, h - 0.05, d - 0.02, 0, col, MAT.GRAIN);
      if (twoTier) { G.box(0, 0.18, 0, w - 0.1, 0.035, d - 0.06, 0, col, MAT.GRAIN); items(-w / 2 + 0.15, w / 2 - 0.15, 0.215, 0, d - 0.2, style, 0.3); }
      items(-w / 2 + 0.1, w / 2 - 0.1, h, -d / 4, d / 2 - 0.1, style, 0.35);
      items(-w / 2 + 0.1, w / 2 - 0.1, h, d / 4, d / 2 - 0.1, style, 0.35);
      H.hit(0, 0, w, d, 0, h);
    });
  }
  function rug(x, y, z, w, d, yaw, col) {
    G.box(x, y + 0.002, z, w, 0.014, d, yaw, col, MAT.CARPET);
    place(x, y, z, yaw, () => { for (const q of [-1, 1]) G.box(0, 0.003, q * (d / 2 - 0.12), w - 0.24, 0.0145, 0.05, 0, shade(col, 0.82), MAT.CARPET); });
  }
  function legs(w, d, h, col, inset = 0.08, r = 0.025, taper = 0.7) {
    for (const ex of [-1, 1]) for (const ez of [-1, 1]) G.cyl(ex * (w / 2 - inset), 0, ez * (d / 2 - inset), r * taper, h, col, MAT.GRAIN, 8, r);
  }
  function sofa(x, y, z, yaw, w, col, pillow) {
    place(x, y, z, yaw, (H) => {
      const d = 0.98, fab = MAT.FABRIC;
      legs(w - 0.1, d - 0.1, 0.12, COL.woodDark, 0.06, 0.03);
      G.rbox(0, 0.12, 0.02, w - 0.04, 0.24, d - 0.06, 0, shade(col, 0.95), fab, 0.06);
      const n = w > 2.2 ? 3 : 2, cw = (w - 0.44) / n;
      for (let i = 0; i < n; i++) {
        const cx = -w / 2 + 0.22 + cw * (i + 0.5);
        G.rbox(cx, 0.34, 0.1, cw - 0.02, 0.15, d - 0.3, 0, col, fab, 0.07);
        rot(cx, 0.4, -d / 2 + 0.22, 0, -0.18, 0, () => G.rbox(0, 0, 0, cw - 0.03, 0.5, 0.2, 0, shade(col, 1.03), fab, 0.08));
      }
      G.rbox(0, 0.3, -d / 2 + 0.1, w - 0.04, 0.55, 0.2, 0, shade(col, 0.93), fab, 0.06);
      for (const s of [-1, 1]) G.rbox(s * (w / 2 - 0.11), 0.2, 0.01, 0.22, 0.42, d - 0.02, 0, shade(col, 0.97), fab, 0.08);
      const pcol = pillow || pc(PAL.pillows), pcol2 = pc(PAL.pillows);
      for (const [s, c2] of [[-1, pcol], [1, pcol2]]) rot(s * (w / 2 - 0.42), 0.68, -d / 2 + 0.36, s * 0.2, -0.25, s * 0.12, () => G.rbox(0, -0.2, 0, 0.42, 0.4, 0.13, 0, c2, fab, 0.07));
      if (rnd() < 0.5) { const tc = pc(['#d9cfc0', '#8a7360', '#e8e1d6', '#4a4a48']); G.rbox(w / 2 - 0.12, 0.62, 0.05, 0.3, 0.035, 0.7, 0, tc, fab, 0.015); G.rbox(w / 2 + 0.01, 0.3, 0.05, 0.035, 0.34, 0.7, 0, tc, fab, 0.015); }
      H.hit(0, 0, w, d, 0, 0.88);
    });
  }
  function chaise(x, y, z, yaw, col) {
    place(x, y, z, yaw, (H) => {
      legs(0.9, 1.5, 0.12, COL.woodDark, 0.06, 0.03);
      G.rbox(0, 0.12, 0, 0.98, 0.24, 1.6, 0, shade(col, 0.95), MAT.FABRIC, 0.06);
      G.rbox(0, 0.34, 0.05, 0.9, 0.15, 1.5, 0, col, MAT.FABRIC, 0.07);
      G.rbox(0.39, 0.2, 0, 0.2, 0.42, 1.6, 0, shade(col, 0.97), MAT.FABRIC, 0.08);
      H.hit(0, 0, 1.0, 1.6, 0, 0.62);
    });
  }
  function chair(x, y, z, yaw, col, upholstered) {
    place(x, y, z, yaw, (H) => {
      const wood = upholstered ? COL.woodDark : col;
      model(upholstered ? 'dining_chair_02' : 'painted_wooden_chair_01', upholstered ? { w: 0.47, h: 0.98, d: 0.6, lz: -0.02, tint: lin(col, 3.2).map((v) => 0.45 + v) } : { w: 0.46, h: 0.94, d: 0.52, tint: lin(col, 1.15) }, () => {
      for (const ex of [-0.19, 0.19]) for (const ez of [-0.19, 0.19]) G.cyl(ex, 0, ez, 0.016, 0.45, wood, MAT.GRAIN, 6, 0.022);
      if (upholstered) {
        G.rbox(0, 0.42, 0.01, 0.48, 0.08, 0.47, 0, col, MAT.FABRIC, 0.035);
        rot(0, 0.48, -0.21, 0, -0.1, 0, () => G.rbox(0, 0, 0, 0.46, 0.46, 0.07, 0, col, MAT.FABRIC, 0.03));
      } else {
        G.rbox(0, 0.42, 0, 0.46, 0.035, 0.44, 0, col, MAT.GRAIN, 0.012);
        for (const ex of [-0.19, 0.19]) G.cyl(ex, 0.45, -0.2, 0.016, 0.42, col, MAT.GRAIN, 6);
        for (const yy of [0.62, 0.78]) G.rbox(0, yy, -0.2, 0.42, 0.06, 0.025, 0, col, MAT.GRAIN, 0.01);
      }
      });
      H.hit(0, 0, 0.46, 0.46, 0, 0.92, false);
    });
  }
  function swivel(x, y, z, yaw, col) {
    place(x, y, z, yaw, (H) => {
      model(models.length % 2 ? 'modern_arm_chair_01' : 'mid_century_lounge_chair', { h: models.length % 2 ? 0.9 : 0.98 }, () => {
      G.lathe(0, 0, 0, [[0, 0], [0.26, 0, 1], [0.24, 0.08, 1], [0, 0.08]], COL.woodDark, MAT.GRAIN, 14);
      G.lathe(0, 0.08, 0, [[0, 0], [0.36, 0, 1], [0.44, 0.15], [0.44, 0.62], [0.4, 0.7, 1], [0.32, 0.7, 1], [0.32, 0.3], [0, 0.3]], col, MAT.FABRIC, 18);
      G.lathe(0, 0.38, 0.03, [[0, 0], [0.31, 0, 1], [0.32, 0.06], [0.28, 0.12, 1], [0, 0.12]], shade(col, 1.04), MAT.FABRIC, 16);
      });
      H.hit(0, 0, 0.88, 0.88, 0, 0.8);
    });
  }
  function roundTable(x, y, z, r, h, top, base, style) {
    place(x, y, z, 0, (H) => {
      model(r < 0.3 ? 'side_table_01' : '-', { w: 0.52, h, d: 0.46 }, () => {
      G.lathe(0, 0, 0, [[0, 0], [r * 0.5, 0, 1], [r * 0.5, 0.04], [r * 0.22, 0.12], [r * 0.18, h * 0.5], [r * 0.24, h - 0.06], [0, h - 0.06]], base, MAT.GRAIN, 16);
      G.lathe(0, h - 0.06, 0, [[0, 0], [r * 0.97, 0, 1], [r, 0.02], [r, 0.04], [r * 0.97, 0.06, 1], [0, 0.06]], top, MAT.GRAIN, 24);
      });
      if (style) items(-r * 0.6, r * 0.6, h, 0, r * 0.6, style, 0.3);
      H.hit(0, 0, r * 1.6, r * 1.6, 0, h);
    });
  }
  function floorLamp(x, y, z) {
    place(x, y, z, 0, (H) => {
      G.lathe(0, 0, 0, [[0, 0], [0.17, 0, 1], [0.16, 0.035], [0.03, 0.06], [0, 0.06]], COL.black, MAT.METAL, 14);
      G.cyl(0, 0.05, 0, 0.012, 1.3, COL.black, MAT.METAL, 6);
      G.lathe(0, 1.28, 0, [[0.24, 0, 1], [0.12, 0.3, 1], [0.115, 0.3, 1], [0.235, 0.0, 1]], COL.warm, MAT.FABRIC, 16);
      G.cyl(0, 1.3, 0, 0.21, 0.01, COL.bulb, MAT.GLOW, 14);
      H.hit(0, 0, 0.3, 0.3, 0, 1.6, false);
      H.light(0, 1.25, 0, '#ffd9a0', 4.5, 0.55);
    });
  }
  function tableLamp(x, yTop, z, col) {
    G.lathe(x, yTop, z, [[0, 0], [0.09, 0, 1], [0.12, 0.12], [0.08, 0.26], [0.03, 0.3, 1], [0, 0.3]], col || pc(PAL.vases), MAT.CERAMIC, 12);
    G.lathe(x, yTop + 0.28, z, [[0.2, 0, 1], [0.13, 0.22, 1], [0.125, 0.22, 1], [0.195, 0.0, 1]], COL.warm, MAT.FABRIC, 14);
    G.cyl(x, yTop + 0.3, z, 0.17, 0.01, COL.bulb, MAT.GLOW, 12);
    light(x, yTop + 0.3, z, '#ffd9a0', 3.2, 0.45);
  }
  function leafCluster(x, y, z, n, size, col) {
    for (let i = 0; i < n; i++) {
      const a = R(0, TAU), t = R(0.1, 1.2), len = size * R(0.6, 1.0);
      rot(x, y, z, a, -t, 0, () => { G.tube([[0, 0, 0], [0, len * 0.6, -len * 0.15], [0, len, -len * 0.45]], 0.006, shade(col, 0.7), 0, 4, false); G.ellipsoid(0, len * 0.75, -len * 0.32, len * 0.16, len * 0.3, len * 0.05, shade(col, R(0.8, 1.25)), 0, 6, 4); });
    }
  }
  function plant(x, y, z, h = 1.6) {
    const was = CUR; CUR = { x, y, z, yaw: (x * 7.3 + z * 3.1) % TAU };
    model(h > 1.6 ? 'potted_plant_01' : 'potted_plant_02', { h: h > 1.6 ? h : Math.min(h, 1.25) }, () => {
    G.lathe(x, y, z, [[0, 0], [0.2, 0, 1], [0.27, 0.42], [0.29, 0.45, 1], [0.25, 0.45, 1], [0, 0.42]], hex('#d9d2c4'), MAT.CERAMIC, 14);
    if (h > 1.4) {
      G.tube([[x, y + 0.4, z], [x + 0.05, y + h * 0.5, z - 0.03], [x - 0.04, y + h * 0.8, z + 0.03]], [0.04, 0.03, 0.02], hex('#5a4532'), MAT.GRAIN, 6);
      for (let i = 0; i < 6; i++) leafCluster(x + R(-0.25, 0.25), y + h * R(0.55, 0.95), z + R(-0.25, 0.25), 9, 0.32, COL.green);
    } else leafCluster(x, y + 0.42, z, 26, 0.6, COL.green);
    });
    CUR = was;
    obbs.push(makeOBB(x, z, 0.3, 0.3, 0, y, y + h, false, true));
  }
  function livingSet(x, y, z, yaw, sofaCol, chairCol, rugCol, sect) {
    const c = Math.cos(yaw), s = Math.sin(yaw), w = (lx, lz) => [x + lx * c + lz * s, z - lx * s + lz * c];
    rug(x, y, z, 4.4, 3.6, yaw, rugCol);
    const [sx, sz] = w(0, -1.15); sofa(sx, y, sz, yaw, 2.5, sofaCol);
    if (sect) { const [cx, cz] = w(-1.75, -0.45); chaise(cx, y, cz, yaw, sofaCol); }
    for (const q of [-1, 1]) { const [cx, cz] = w(q * 0.85, 1.3); swivel(cx, y, cz, yaw + Math.PI, chairCol); }
    const [tx, tz] = w(0, 0.1);
    place(tx, y, tz, yaw, (H) => {
      const drum = rnd() < 0.5;
      model(drum ? 'coffee_table_round_01' : 'modern_coffee_table_01', drum ? { w: 1.06, h: 0.4, d: 1.06 } : { w: 1.2, h: 0.4, d: 0.62, turn: Math.PI / 2 }, () => {
      if (drum) { G.lathe(0, 0, 0, [[0, 0], [0.5, 0, 1], [0.52, 0.06], [0.5, 0.38], [0.53, 0.4, 1], [0, 0.4]], COL.stone, MAT.CERAMIC, 24); }
      else { G.rbox(0, 0.32, 0, 1.2, 0.07, 0.65, 0, COL.woodMid, MAT.GRAIN, 0.02); legs(1.2, 0.65, 0.32, COL.woodDark, 0.07, 0.028); }
      });
      vase(0.15, 0.4, 0.05, 0.28, pc(PAL.vases)); G.box(-0.25, 0.4, -0.05, 0.3, 0.05, 0.22, 0.2, pc(['#5b6b7d', '#a35d45', '#2b2b2b']));
      H.hit(0, 0, 1.0, 0.8, 0, 0.42);
    });
    const [lx, lz] = w(sect ? 1.75 : 1.65, -1.15); roundTable(lx, y, lz, 0.25, 0.55, COL.woodMid, COL.woodMid); tableLamp(lx, y + 0.55, lz);
  }
  function diningSet(x, y, z, yaw, w, d, top, chairCol, rugCol, upholstered) {
    const c = Math.cos(yaw), s = Math.sin(yaw), wl = (lx, lz) => [x + lx * c + lz * s, z - lx * s + lz * c];
    if (rugCol) rug(x, y, z, w + 2.0, d + 2.0, yaw, rugCol);
    place(x, y, z, yaw, (H) => {
      G.rbox(0, 0.72, 0, w, 0.05, d, 0, top, top === COL.marble ? MAT.CERAMIC : MAT.GRAIN, 0.02);
      if (rnd() < 0.5) legs(w, d, 0.72, shade(top, 0.8), 0.12, 0.04, 0.75);
      else for (const ex of [-1, 1]) { G.rbox(ex * (w / 2 - 0.3), 0, 0, 0.08, 0.72, d * 0.7, 0, shade(top, 0.8), MAT.GRAIN, 0.02); G.rbox(ex * (w / 2 - 0.3), 0, 0, 0.12, 0.05, d * 0.8, 0, shade(top, 0.75), MAT.GRAIN, 0.02); }
      H.hit(0, 0, w, d, 0.68, 0.77); H.hit(0, 0, w - 0.1, d - 0.1, 0, 0.77, false, true);
      vase(0, 0.77, 0, 0.3, pc(PAL.vases));
      leafCluster(0, 1.0, 0, 10, 0.3, COL.green);
      for (const q of [-0.5, 0.5]) { G.cyl(q * w * 0.5, 0.77, 0, 0.025, 0.04, COL.metal, MAT.METAL, 8); G.cyl(q * w * 0.5, 0.81, 0, 0.018, 0.2, COL.cream, 0, 8); }
    });
    const n = Math.max(1, Math.floor(w / 0.75));
    for (let i = 0; i < n; i++) {
      const lx = -w / 2 + (w / n) * (i + 0.5);
      for (const q of [-1, 1]) { const [cx, cz] = wl(lx, q * (d / 2 + 0.33)); chair(cx, y, cz, yaw + (q > 0 ? Math.PI : 0), chairCol, upholstered); }
    }
  }
  function bed(x, y, z, yaw, duvet) {
    place(x, y, z, yaw, (H) => {
      const w = 1.65, l = 2.15;
      G.rbox(0, 0.06, 0, w + 0.06, 0.26, l + 0.04, 0, COL.woodMid, MAT.GRAIN, 0.02);
      legs(w, l, 0.08, COL.woodDark, 0.1, 0.03);
      G.rbox(0, 0.3, 0.02, w - 0.04, 0.26, l - 0.06, 0, COL.white, MAT.FABRIC, 0.07);
      G.rbox(0, 0.48, 0.22, w + 0.04, 0.12, l - 0.42, 0, duvet, MAT.FABRIC, 0.06);
      G.rbox(0, 0.42, 0.24, w + 0.1, 0.16, l - 0.5, 0, shade(duvet, 0.96), MAT.FABRIC, 0.05);
      G.rbox(0, 0.58, l / 2 - 0.35, w + 0.06, 0.07, 0.5, 0, shade(duvet, 0.72), MAT.FABRIC, 0.03);
      for (const q of [-1, 1]) { rot(q * 0.38, 0.58, -l / 2 + 0.26, 0, -0.35, 0, () => G.rbox(0, 0, 0, 0.7, 0.22, 0.38, 0, COL.white, MAT.FABRIC, 0.09)); rot(q * 0.3, 0.6, -l / 2 + 0.5, 0, -0.2, 0, () => G.rbox(0, 0, 0, 0.5, 0.2, 0.14, 0, shade(duvet, 1.15), MAT.FABRIC, 0.06)); }
      const n = 6; for (let i = 0; i < n; i++) G.rbox(-w / 2 - 0.02 + (w + 0.1) * (i + 0.5) / n, 0.1, -l / 2 - 0.06, (w + 0.1) / n - 0.015, 1.25, 0.12, 0, shade(COL.cream, 0.97), MAT.FABRIC, 0.05);
      H.hit(0, 0, w, l, 0, 0.64); H.hit(0, -l / 2 - 0.06, w + 0.1, 0.12, 0, 1.35);
      for (const q of [-1, 1]) {
        G.rbox(q * (w / 2 + 0.38), 0, -l / 2 + 0.25, 0.5, 0.55, 0.42, 0, COL.woodMid, MAT.GRAIN, 0.02);
        G.box(q * (w / 2 + 0.38), 0.3, -l / 2 + 0.465, 0.4, 0.01, 0.01, 0, COL.woodDark);
        H.hit(q * (w / 2 + 0.38), -l / 2 + 0.25, 0.5, 0.42, 0, 0.55);
      }
    });
    const c = Math.cos(yaw), s = Math.sin(yaw);
    for (const q of [-1, 1]) { const lx = q * (1.65 / 2 + 0.38), lz = -2.15 / 2 + 0.25; tableLamp(x + lx * c + lz * s, y + 0.55, z - lx * s + lz * c); }
  }
  function counter(x, y, z, yaw, w, d, h = 1.05, screens = 1) {
    place(x, y, z, yaw, (H) => {
      G.box(0, 0.1, 0, w, h - 0.14, d, 0, COL.woodLight, MAT.GRAIN);
      const np = Math.round(w / 0.5);
      for (let i = 0; i < np; i++) G.box(-w / 2 + (i + 0.5) * w / np, 0.12, d / 2 + 0.005, 0.012, h - 0.2, 0.01, 0, shade(COL.woodLight, 0.85));
      G.box(0, 0, 0, w - 0.06, 0.1, d - 0.06, 0, COL.black);
      G.rbox(0, h - 0.045, 0, w + 0.08, 0.045, d + 0.08, 0, COL.marble, MAT.CERAMIC, 0.015);
      for (let i = 0; i < screens; i++) {
        const lx = -w / 2 + (w / screens) * (i + 0.5);
        G.cyl(lx, h, -0.12, 0.08, 0.02, COL.black, MAT.METAL, 10); G.box(lx, h, -0.12, 0.04, 0.24, 0.04, 0, COL.black, MAT.METAL);
        rot(lx, h + 0.32, -0.1, Math.PI, 0.25, 0, () => { G.rbox(0, -0.14, 0, 0.42, 0.28, 0.035, 0, COL.black, MAT.METAL, 0.012); G.box(0, -0.125, -0.019, 0.38, 0.24, 0.004, 0, hex('#3f6ea8'), MAT.GLOW); });
        G.rbox(lx + 0.3, h, 0.1, 0.08, 0.04, 0.14, 0.2, COL.black, MAT.METAL, 0.01);
        H.light(lx, h + 0.35, 0.1, '#8fb4ff', 1.6, 0.25);
      }
      H.hit(0, 0, w, d, 0, h);
    });
  }
  function column(x, z, y0, y1) {
    G.lathe(x, y0, z, [[0, 0], [0.48, 0, 1], [0.48, 0.12, 1], [0.4, 0.16, 1], [0.38, 0.2], [0.38, y1 - y0], [0, y1 - y0]], COL.white, 0, 20);
    if (y1 > F1) G.lathe(x, F1, z, [[0.45, 0, 1], [0.45, 0.1, 1], [0.38, 0.14, 1]], COL.white, 0, 20);
    obbs.push(makeOBB(x, z, 0.38, 0.38, 0, y0, y1));
  }
  function tree(x, y, z, h, r) {
    G.lathe(x, y, z, [[0, 0], [r * 0.95, 0, 1], [r * 0.98, 0.03], [r * 0.9, 0.06, 1], [0, 0.06]], COL.red, MAT.FABRIC, 24);
    G.lathe(x, y, z, [[0, 0], [0.35, 0, 1], [0.32, 0.45, 1], [0, 0.45]], hex('#9a7b55'), MAT.FABRIC, 14);
    G.cyl(x, y, z, 0.08, h * 0.3, COL.woodDark, MAT.GRAIN, 8);
    const tiers = Math.round(4 + h);
    for (let i = 0; i < tiers; i++) {
      const t0 = 0.12 + (i / tiers) * 0.8, rr = r * (1 - i / tiers) + 0.12, hh = h * 0.24;
      const prof = [[0, 0], [rr * 0.6, hh * 0.05], [rr, hh * 0.15], [rr * 0.82, hh * 0.3], [rr * 0.55, hh * 0.6], [rr * 0.08, hh], [0, hh]];
      G.lathe(x, y + h * t0, z, prof, shade(COL.green, 0.85 + i * 0.03), MAT.FUR, 18);
      for (let k = 0; k < 10 + rr * 10; k++) {
        const a = R(0, TAU), rad = rr * R(0.85, 1.02);
        rot(x + Math.cos(a) * rad * 0.9, y + h * t0 + hh * R(0.08, 0.2), z + Math.sin(a) * rad * 0.9, -a + Math.PI / 2, 0.5, 0, () => G.ellipsoid(0, 0, -0.1, 0.12, 0.05, 0.22, shade(COL.green, R(0.8, 1.1)), MAT.FUR, 5, 3));
      }
    }
    const gp = []; for (let t = 0; t <= 1; t += 0.02) { const a = t * TAU * 4, rr = r * (1 - (0.15 + t * 0.75)) + 0.15; gp.push([x + Math.cos(a) * rr, y + h * (0.15 + t * 0.75), z + Math.sin(a) * rr]); }
    G.tube(gp, 0.025, hex('#c9a24b'), MAT.METAL, 5, false);
    for (let i = 0; i < Math.round(h * 16); i++) {
      const t = R(0.15, 0.9), a = R(0, TAU), rr = r * (1 - t) * 0.98 + 0.12;
      G.sphere(x + Math.cos(a) * rr, y + h * t, z + Math.sin(a) * rr, R(0.05, 0.09) * (h > 3 ? 1.3 : 1), pc(PAL.orn), MAT.CERAMIC, 6);
    }
    for (let i = 0; i < Math.round(h * 40); i++) {
      const t = R(0.12, 0.95), a = R(0, TAU), rr = r * (1 - t) * 1.0 + 0.13;
      G.ellipsoid(x + Math.cos(a) * rr, y + h * t, z + Math.sin(a) * rr, 0.028, 0.028, 0.028, COL.bulb, MAT.GLOW, 4, 2);
    }
    G.push(A.T(x, y + h + 0.12, z));
    for (let i = 0; i < 5; i++) rot(0, 0, 0, 0, 0, i * TAU / 5, () => G.ellipsoid(0, 0.12, 0, 0.05, 0.14, 0.04, hex('#f0cf5a'), MAT.GLOW, 6, 4));
    G.pop();
    obbs.push(makeOBB(x, z, r * 0.75, r * 0.75, 0, y, y + h));
    light(x, y + h * 0.5, z, '#ffcf8a', h > 4 ? 9 : 4.5, h > 4 ? 0.9 : 0.5);
  }
  function barrel(x, y, z) {
    G.lathe(x, y, z, [[0, 0.02], [0.27, 0.02, 1], [0.31, 0.3], [0.27, 0.6, 1], [0, 0.6]], COL.woodMid, MAT.GRAIN, 16);
    for (const yy of [0.1, 0.5]) G.torus(x, y + yy, z, 0.29, 0.012, COL.black, MAT.METAL, 16, 4);
    for (let i = 0; i < 7; i++) G.cyl(x + R(-0.15, 0.15), y + 0.5, z + R(-0.15, 0.15), 0.03, R(0.35, 0.55), COL.woodLight, MAT.GRAIN, 6);
    obbs.push(makeOBB(x, z, 0.3, 0.3, 0, y, y + 0.7, false));
  }
  function mixer(x, yTop, z, col) {
    G.rbox(x, yTop, z, 0.22, 0.05, 0.32, 0, col, MAT.METAL, 0.02);
    G.rbox(x, yTop, z - 0.12, 0.14, 0.36, 0.1, 0, col, MAT.METAL, 0.04);
    G.rbox(x, yTop + 0.3, z - 0.02, 0.16, 0.13, 0.36, 0, col, MAT.METAL, 0.06);
    G.lathe(x, yTop + 0.05, z + 0.05, [[0, 0], [0.07, 0, 1], [0.12, 0.12], [0.12, 0.17, 1], [0.11, 0.17, 1], [0.06, 0.03]], COL.steel, MAT.METAL, 14);
  }
  function boxPile(x, y, z, n, spread = 1.2) {
    for (let i = 0; i < n; i++) {
      const w = R(0.5, 1.2), d = R(0.4, 1.0), h = R(0.4, 1.4), bx = x + R(-spread, spread), bz = z + R(-spread, spread), yaw = R(-0.2, 0.2);
      solid(bx, y, bz, w, h, d, yaw, pc(PAL.boxes), 0);
    }
  }
  function pendant(x, yCeil, z, yBulb, r = 0.18) {
    G.cyl(x, yBulb + r, z, 0.006, yCeil - yBulb - r, COL.black, 0, 4);
    G.lathe(x, yBulb - 0.02, z, [[r * 1.2, 0, 1], [r * 1.15, r * 0.5], [r * 0.5, r * 1.05], [0.02, r * 1.2, 1], [0, r * 1.2]], COL.white, MAT.CERAMIC, 16);
    G.cyl(x, yBulb - 0.025, z, r * 1.1, 0.01, COL.bulb, MAT.GLOW, 14);
    light(x, yBulb - 0.2, z, '#ffdcaa', 6, 0.6);
  }
  function wovenPendant(x, yCeil, z, yC, r) {
    G.cyl(x, yC + r * 0.8, z, 0.006, yCeil - yC - r * 0.8, COL.black, 0, 4);
    G.lathe(x, yC - r * 0.3, z, [[r * 1.1, 0, 1], [r * 1.0, r * 0.4], [r * 0.5, r * 0.9], [0.04, r, 1], [0, r]], hex('#a46a3c'), MAT.FABRIC, 20);
    G.cyl(x, yC - r * 0.31, z, r * 0.9, 0.01, COL.warm, MAT.GLOW, 14);
    light(x, yC - 0.4, z, '#ffcf8a', 6, 0.65);
  }
  function art(x, y, z, yaw, w, h) {
    place(x, y, z, yaw, () => {
      G.box(0, 0, 0, w + 0.08, h + 0.08, 0.05, 0, COL.woodLight, MAT.GRAIN);
      G.box(0, 0.04, 0.026, w, h, 0.01, 0, pc(['#c9c2b6', '#8a8f8c', '#3d4040', '#b7a58d', '#e0dbd2', '#6f7d86']));
      for (let i = 0; i < 3; i++) G.ellipsoid(R(-w / 3, w / 3), h * R(0.3, 0.7), 0.033, w * R(0.08, 0.25), h * R(0.06, 0.2), 0.003, pc(['#2b2b2b', '#f2f0ea', '#a35d45', '#5b6b7d', '#d6b24a']), 0, 10, 4);
    });
  }
  function exitSign(x, y, z, yaw) {
    place(x, y, z, yaw, () => { G.rbox(0, 0, 0, 0.38, 0.18, 0.06, 0, COL.white, 0, 0.01); G.box(0, 0.045, 0.031, 0.28, 0.09, 0.005, 0, hex('#ff3a2e'), MAT.GLOW); });
  }
  const containers = [];
  function pot(x, y, z) {
    const col = pc(['#d9d2c4', '#b7ab98', '#8b8f8c', '#c9b9a0', '#6f6a62']);
    G.lathe(x, y, z, [[0, 0], [0.36, 0, 1], [0.5, 0.55], [0.56, 0.9], [0.6, 0.95, 1], [0.6, 0.98, 1], [0.52, 0.98, 1], [0.48, 0.88]], col, MAT.CERAMIC, 20);
    G.cyl(x, y + 0.86, z, 0.48, 0.01, hex('#14100c'), 0, 16);
    obbs.push(makeOBB(x, z, 0.55, 0.55, 0, y, y + 0.98));
    containers.push({ x, z, y, f: y > 1 ? 1 : 0, type: 'pot' });
  }
  function hamper(x, y, z) {
    const col = pc(['#c8a777', '#b8925f', '#a98556']);
    G.lathe(x, y, z, [[0, 0], [0.4, 0, 1], [0.44, 0.1], [0.48, 0.82], [0.5, 0.86, 1]], col, MAT.FABRIC, 18);
    for (let b = 0.1; b < 0.85; b += 0.075) G.torus(x, y + b, z, 0.42 + b * 0.075, 0.012, shade(col, 0.82), MAT.FABRIC, 18, 4);
    G.torus(x, y + 0.86, z, 0.49, 0.03, shade(col, 0.72), MAT.FABRIC, 18, 6);
    G.cyl(x, y + 0.78, z, 0.46, 0.01, hex('#1a140e'), 0, 16);
    for (const q of [-1, 1]) G.tube([[x + q * 0.49, y + 0.72, z - 0.1], [x + q * 0.56, y + 0.8, z], [x + q * 0.49, y + 0.72, z + 0.1]], 0.014, shade(col, 0.7), MAT.FABRIC, 5, false);
    obbs.push(makeOBB(x, z, 0.48, 0.48, 0, y, y + 0.9));
    containers.push({ x, z, y, f: y > 1 ? 1 : 0, type: 'hamper' });
  }
  function windows(x1, z1, x2, z2, nIn, y0, y1, width, spacing, start = 1.5, outGlow = false) {
    const len = Math.hypot(x2 - x1, z2 - z1), dx = (x2 - x1) / len, dz = (z2 - z1) / len, yaw = Math.atan2(-dz, dx);
    for (let t = start + width / 2; t <= len - width / 2 - 0.5; t += spacing) {
      const cx = x1 + dx * t + nIn[0] * 0.16, cz = z1 + dz * t + nIn[1] * 0.16;
      G.box(cx, y0, cz, width, y1 - y0, 0.02, yaw, COL.glassNight, MAT.GLOW);
      const ox = nIn[0] * 0.03, oz = nIn[1] * 0.03;
      G.box(cx + ox, y0 - 0.08, cz + oz, width + 0.2, 0.08, 0.1, yaw, COL.trim);
      G.box(cx + ox, y1, cz + oz, width + 0.16, 0.08, 0.06, yaw, COL.trim);
      for (const q of [-0.5, -1 / 6, 1 / 6, 0.5]) G.box(cx + ox + dx * q * width, y0, cz + oz + dz * q * width, 0.05, y1 - y0, 0.05, yaw, COL.trim);
      for (const f of [1 / 3, 2 / 3]) G.box(cx + ox, y0 + (y1 - y0) * f, cz + oz, width, 0.04, 0.05, yaw, COL.trim);
      if (outGlow) {
        const ex = x1 + dx * t - nIn[0] * 0.17, ez = z1 + dz * t - nIn[1] * 0.17;
        G.box(ex, y0, ez, width, y1 - y0, 0.02, yaw, hex('#f4c98c'), MAT.GLOW);
        for (const q of [-1 / 6, 1 / 6]) G.box(ex - nIn[0] * 0.01 + dx * q * width, y0, ez - nIn[1] * 0.01 + dz * q * width, 0.05, y1 - y0, 0.04, yaw, hex('#5a4a3a'));
        for (const f of [1 / 3, 2 / 3]) G.box(ex - nIn[0] * 0.01, y0 + (y1 - y0) * f, ez - nIn[1] * 0.01, width, 0.04, 0.04, yaw, hex('#5a4a3a'));
      }
    }
  }
  function trackLights(x0, x1, z0, z1, y, hole = null, dz = 3.3, dx = 2.3) {
    for (let z = z0 + dz / 2; z < z1; z += dz) {
      const inHole = hole && z > hole[2] && z < hole[3];
      const runs = inHole ? [[x0, hole[0]], [hole[1], x1]] : [[x0, x1]];
      for (const [a, b] of runs) G.box((a + b) / 2, y - 0.04, z, b - a - 0.6, 0.04, 0.05, 0, COL.white);
      for (let x = x0 + 1; x < x1 - 0.6; x += dx) {
        if (inHole && x > hole[0] - 0.3 && x < hole[1] + 0.3) continue;
        G.box(x, y - 0.08, z, 0.03, 0.06, 0.03, 0, COL.white);
        rot(x, y - 0.1, z, ((x * 7.3) % 1) * TAU, 0.5, 0, () => { G.box(0, -0.16, 0, 0.1, 0.15, 0.1, 0, COL.white, MAT.METAL); G.box(0, -0.165, 0, 0.08, 0.006, 0.08, 0, COL.bulb, MAT.GLOW); });
      }
    }
  }
  function doorway(cx, cz, yaw, w) {
    let info;
    place(cx, 0, cz, yaw, (H) => {
      for (const q of [-1, 1]) { G.box(q * (w / 2 + 0.4), 0, 0, 0.8, 4.0, 0.8, 0, COL.brick, MAT.BRICK); H.hit(q * (w / 2 + 0.4), 0, 0.8, 0.8, 0, 4.0); G.box(q * (w / 2 + 0.4), 4.0, 0, 0.9, 0.12, 0.9, 0, COL.trim); }
      G.box(0, 3.3, 0, w + 1.6, ROOF - 3.3, 0.3, 0, COL.wall); H.hit(0, 0, w + 1.6, 0.3, 3.3, ROOF);
      G.box(0, 3.2, 0, w + 0.1, 0.12, 0.16, 0, COL.steel, MAT.METAL);
      G.box(0, 3.32, -0.25, w + 1.8, 0.1, 1.2, 0, COL.black, MAT.METAL);
      H.hit(0, 0, w, 0.16, 0, 3.3, false, true);
      G.box(0, 0.002, 1.3, w + 0.4, 0.014, 1.6, 0, hex('#2c2c2e'), MAT.CARPET);
      G.box(0, 0.002, -1.3, w + 0.4, 0.014, 1.6, 0, hex('#2c2c2e'), MAT.CARPET);
      H.light(0, 2.6, -1.4, '#ffd9a0', 7, 0.7);
      const [ex, ez] = H.w(0, 0.3); exitSign(ex, 3.45, ez, yaw);
      const [ix, iz] = H.w(0, 1.1), [ox, oz] = H.w(0.6, -1.0);
      info = { x: ix, z: iz, ex: ox, ez: oz, cx, cz, yaw, w, obb: obbs.length - 1 };
    });
    // index of the door-glass collider (pushed before the light)
    info.obb = obbs.findIndex((o) => Math.abs(o.cx - cx) < 0.01 && Math.abs(o.cz - cz) < 0.01 && o.y1 === 3.3 && !o.opaque);
    return info;
  }

  // ---- floors / slabs / roof with a round skylight ----
  G.box(W / 2, -0.1, D / 2, W, 0.1, D, 0, COL.concrete, MAT.CONCRETE);
  G.box(11, -0.08, 27, 22, 0.083, 26, 0, COL.hardwood, MAT.WOOD);
  G.box(32, -0.08, 34.5, 16, 0.083, 11, 0, COL.tile, MAT.TILE);
  const slabs = [[0, 64, 0, 12], [0, 24, 12, 28], [40, 64, 12, 28], [0, 64, 28, 40]];
  for (const [x0, x1, z0, z1] of slabs) {
    G.box((x0 + x1) / 2, F1 - 0.05, (z0 + z1) / 2, x1 - x0, 0.05, z1 - z0, 0, COL.upWood, MAT.WOOD);
    G.box((x0 + x1) / 2, F1 - 0.4, (z0 + z1) / 2, x1 - x0, 0.35, z1 - z0, 0, COL.ceilWood, MAT.PLANK);
    obbs.push(makeOBB((x0 + x1) / 2, (z0 + z1) / 2, (x1 - x0) / 2, (z1 - z0) / 2, 0, F1 - 0.4, F1, true, false));
  }
  const SK = { x: 32, z: 20, r: 4.3, y: ROOF };
  for (const [x0, x1, z0, z1] of [[0, 64, 0, 15.4], [0, 64, 24.6, 40], [0, 27.4, 15.4, 24.6], [36.6, 64, 15.4, 24.6]])
    G.box((x0 + x1) / 2, ROOF, (z0 + z1) / 2, x1 - x0, 0.3, z1 - z0, 0, COL.ceil, MAT.PLANK);
  G.lathe(SK.x, ROOF - 0.03, SK.z, [[SK.r, 0, 1], [6.7, 0, 1], [6.7, 0.06, 1], [SK.r, 0.06, 1], [SK.r, 0, 1]], COL.ceil, 0, 40);
  G.lathe(SK.x, ROOF - 0.12, SK.z, [[SK.r + 0.12, 0, 1], [SK.r, 0, 1], [SK.r, 0.75, 1], [SK.r + 0.12, 0.75, 1]], COL.trim, 0, 40);
  G.box(SK.x, ROOF + 2.2, SK.z, 14, 0.1, 14, 0, hex('#0a1020'), MAT.GLOW);
  for (let i = 0; i < 40; i++) G.box(SK.x + R(-5, 5), ROOF + 2.19, SK.z + R(-5, 5), 0.03, 0.005, 0.03, 0, hex('#dfe6ff'), MAT.GLOW);
  trackLights(0.5, 63.5, 0, 40, F1 - 0.4, [24, 40, 12, 28]);
  trackLights(0.5, 63.5, 0, 40, ROOF, [26.5, 37.5, 14.5, 25.5]);

  // ---- outer walls ----
  wall(0, 0, 29.2, 0, 0, ROOF, COL.wall);
  wall(34.8, 0, 64, 0, 0, ROOF, COL.wall);
  wall(0, 40, 64, 40, 0, ROOF, COL.ship, MAT.SHIPLAP);
  wall(0, 0, 0, 40, 0, ROOF, COL.wall);
  wall(64, 0, 64, 28.2, 0, ROOF, COL.wall);
  wall(64, 31.8, 64, 40, 0, ROOF, COL.wall);
  const frontDoor = doorway(32, 0, 0, 4);
  const sideDoor = doorway(64, 30, -Math.PI / 2, 2);
  windows(0, 0, 29, 0, [0, 1], 0.9, 3.6, 2.2, 4.6, 1.2, true);
  windows(35, 0, 64, 0, [0, 1], 0.9, 3.6, 2.2, 4.6, 1.6, true);
  windows(0, 0, 64, 0, [0, 1], 5.4, 8.2, 2.2, 4.6, 1.2, true);
  windows(0, 0, 0, 40, [1, 0], 5.4, 8.2, 1.8, 4.4, 1.5);
  windows(64, 0, 64, 28, [-1, 0], 0.9, 3.6, 1.8, 4.4, 1.5, true);
  windows(64, 0, 64, 40, [-1, 0], 5.4, 8.2, 1.8, 4.4, 1.5, true);
  windows(0, 40, 64, 40, [0, -1], 5.6, 8.2, 1.8, 7.5, 16);
  for (const [cx, cz] of [[23.6, 11.6], [40.4, 11.6], [23.6, 28.4], [40.4, 28.4], [12, 8], [12, 20], [12, 32], [52, 8], [52, 20], [52, 30]]) column(cx, cz, 0, ROOF);

  // ---- elevator (doors stay shut) ----
  solid(46, 0, 33.5, 4, ROOF, 3.6, 0, COL.ship, MAT.SHIPLAP);
  for (const fy of [0, F1]) {
    G.box(46, fy, 31.66, 1.6, 2.45, 0.06, 0, COL.steel, MAT.METAL);
    G.box(46, fy, 31.63, 1.4, 2.3, 0.04, 0, shade(COL.steel, 1.1), MAT.METAL);
    G.box(46, fy, 31.6, 0.02, 2.3, 0.02, 0, COL.black);
    G.rbox(47.1, fy + 1.05, 31.64, 0.1, 0.22, 0.03, 0, COL.steel, MAT.METAL, 0.01);
    G.sphere(47.1, fy + 1.12, 31.62, 0.015, hex('#ffb35a'), MAT.GLOW, 6);
  }

  // ---- the big staircase (climbs toward the front) ----
  const S1 = { x0: 24.2, x1: 26.2, zBot: 26, zTop: 12 };
  { const n = 15, dz = (S1.zBot - S1.zTop) / n;
    for (let k = 0; k < n; k++) {
      const zc = S1.zBot - (k + 0.5) * dz, top = (k + 0.5) * 0.3;
      G.box(25.2, Math.max(0, top - 0.35), zc, 2.0, Math.min(top, 0.3), dz, 0, COL.white);
      G.rbox(25.2, top - 0.05, zc + 0.02, 2.0, 0.06, dz + 0.06, 0, COL.woodLight, MAT.WOOD, 0.015);
    }
    for (let q = 0; q < 4; q++) {
      const za = S1.zBot - q * 3.5, zb = za - 3.5, yTop = ((S1.zBot - zb) / 14) * F1 + 1.0;
      for (const xx of [S1.x0 - 0.07, S1.x1 + 0.07]) {
        solid(xx, 0, (za + zb) / 2, 0.12, yTop - 0.9, 3.5, 0, COL.white);
        solid(xx, yTop - 0.9, (za + zb) / 2, 0.06, 0.9, 3.5, 0, COL.trim, 0, { opaque: false });
        G.box(xx, yTop - 0.05, (za + zb) / 2, 0.1, 0.06, 3.5, 0, COL.woodLight, MAT.GRAIN);
      }
    }
    solid(25.2, 0, 11.95, 2.3, F1 - 0.4, 0.2, 0, COL.white);
  }

  // =========================================================
  // GROUND FLOOR
  // =========================================================
  tree(33, 0, 20, 6.2, 1.9);
  place(36.5, 0, 15.2, 0.2, (H) => {
    G.rbox(0, 0, 0, 2.6, 0.95, 1.2, 0, COL.white, MAT.GRAIN, 0.02);
    for (let i = 0; i < 26; i++) G.sphere(R(-1.1, 1.1), 1.0, R(-0.45, 0.45), R(0.06, 0.1), pc(PAL.orn), MAT.CERAMIC, 8);
    G.rbox(0, 0.95, -0.45, 2.6, 0.9, 0.12, 0, COL.white, MAT.GRAIN, 0.02);
    for (let i = 0; i < 12; i++) { const ox = -1.1 + i * 0.2; G.cyl(ox, 1.7 - (i % 3) * 0.04, -0.38, 0.003, 0.15 + (i % 3) * 0.04, COL.steel, 0, 3); G.sphere(ox, 1.7 - (i % 3) * 0.04, -0.38, 0.05, pc(PAL.orn), MAT.CERAMIC, 8); }
    H.hit(0, 0, 2.6, 1.2, 0, 1.9);
  });
  obbs.push(makeOBB(29.5, 21.5, 1.3, 0.6, 0.5, 0, 1.4));
  displayTable(29.5, 0, 15, 0, 2.4, 1.0, 0.86, COL.white, 'gifts');
  displayTable(37.5, 0, 25, 0, 2.4, 1.0, 0.86, COL.white, 'vases');
  for (let i = 0; i < 5; i++) pendant(28.5 + i * 2, ROOF, 13.2, 6.4 + (i % 2) * 0.3, 0.2);

  counter(25.5, 0, 5, 0, 3.0, 1.0, 1.05, 2);
  counter(20.5, 0, 5, 0, 3.0, 1.0, 1.05, 2);
  shelfWall(23, 0, 3.4, Math.PI, 7.6, 'mixed', 1.5, 0.4, COL.woodLight);
  gondola(7, 0, 4, 0, 4.2, 'gifts', 1.5);
  gondola(7, 0, 9.5, 0, 4.2, 'gifts', 1.5);
  gondola(16, 0, 10, 0, 4, 'vases', 1.5);
  shelfWall(0.55, 0, 7, Math.PI / 2, 10, 'vases', 2.2, 0.42, COL.woodLight);
  tree(3, 0, 12.3, 2.6, 0.85);
  plant(28.6, 0, 1.2, 1.8); plant(35.4, 0, 1.2, 1.8);
  displayTable(37.5, 0, 7.5, 0, 2.4, 1.1, 0.9, COL.woodLight, 'gifts');

  shelfWall(0.55, 0, 20.5, Math.PI / 2, 10, 'cook', 2.4, 0.45, COL.woodLight);
  shelfWall(0.55, 0, 33, Math.PI / 2, 12, 'appl', 2.4, 0.45, COL.woodLight);
  shelfWall(11.5, 0, 39.45, Math.PI, 17, 'cook', 2.4, 0.45, COL.woodLight);
  counter(11, 0, 17, 0, 7, 1.2, 1.05, 3);
  for (const tx of [7, 15.5]) place(tx, 0, 24, 0, (H) => {
    G.rbox(0, 0, 0, 3.4, 0.92, 0.9, 0, COL.woodLight, MAT.GRAIN, 0.02);
    G.box(0, 0.25, 0, 3.3, 0.03, 0.8, 0, COL.white);
    items(-1.6, 1.6, 0.28, 0, 0.7, 'cook', 0.3);
    for (let i = 0; i < 5; i++) mixer(-1.3 + i * 0.65, 0.92, 0, pc(['#2b2b2b', '#e9e6df', '#8aa4b8', '#3d5a4e', '#9b2f2f', '#d7d9db']));
    H.hit(0, 0, 3.4, 0.9, 0, 0.92);
  });
  place(11, 0, 30, 0, (H) => {
    G.rbox(0, 0, 0, 2.4, 0.86, 1.1, 0, COL.black, MAT.GRAIN, 0.02); G.rbox(0, 0.86, 0, 2.5, 0.06, 1.2, 0, COL.marble, MAT.CERAMIC, 0.015);
    items(-1.1, 1.1, 0.92, 0, 0.9, 'cook', 0.3); H.hit(0, 0, 2.5, 1.2, 0, 0.92);
  });
  gondola(19.5, 0, 21, Math.PI / 2, 5, 'cook', 1.6);
  gondola(5, 0, 35, 0, 4.2, 'appl', 1.6);
  gondola(17, 0, 35, 0, 4.2, 'cook', 1.6);
  gondola(20.5, 0, 30, Math.PI / 2, 4, 'appl', 1.6);
  barrel(3, 0, 27); barrel(14, 0, 27.5); barrel(8.5, 0, 31.5);
  for (const [px, pz] of [[7, 24], [15.5, 24]]) pendant(px, F1 - 0.4, pz, 2.7, 0.22);

  shelfWall(33, 0, 39.45, Math.PI, 17, 'glass', 2.4, 0.42, COL.white);
  gondola(28, 0, 34, Math.PI / 2, 4.6, 'glass', 1.5);
  gondola(33, 0, 34, Math.PI / 2, 4.6, 'plates', 1.5);
  gondola(38, 0, 34, Math.PI / 2, 4.6, 'plates', 1.5);
  roundTable(42, 0, 30.2, 0.75, 0.76, hex('#6b4a33'), hex('#6b4a33'), 'plates');
  pendant(33, F1 - 0.4, 31, 2.8, 0.22);

  diningSet(46, 0, 17.5, 0, 2.4, 1.0, COL.woodLight, COL.woodMid, hex('#9b9488'), false);
  diningSet(55, 0, 17, 0, 2.6, 1.0, COL.marble, COL.olive, COL.red, true);
  diningSet(60, 0, 23.5, Math.PI / 2, 2.2, 1.0, COL.woodDark, COL.woodLight, null, false);
  diningSet(46.5, 0, 24.5, 0, 2.2, 1.0, COL.woodMid, COL.cream, null, true);
  diningSet(53.5, 0, 25, 0, 2.0, 1.0, COL.woodLight, COL.black, hex('#b9b2a5'), false);
  for (const [px, pz] of [[46, 17.5], [55, 17]]) wovenPendant(px, F1 - 0.4, pz, 3.0, 0.38);

  livingSet(46, 0, 4.8, 0, COL.cream, COL.tan, hex('#cfc6b7'), true);
  livingSet(53.2, 0, 4.8, 0, COL.navy, COL.cream, hex('#8a8e8c'), false);
  livingSet(60, 0, 4.8, 0, COL.tan, COL.cream, hex('#d8cfbf'), false);
  livingSet(49.5, 0, 10.9, Math.PI, COL.sage, COL.cream, hex('#c2b8a6'), false);
  livingSet(58, 0, 10.9, Math.PI, COL.cream, COL.rust, hex('#b9b2a5'), true);
  livingSet(56, 0, 35.4, Math.PI, COL.cream, COL.navy, hex('#cfc6b7'), false);
  shelfWall(56, 0, 39.45, Math.PI, 12, 'pillows', 2.1, 0.45, COL.white);
  floorLamp(50.5, 0, 37.5); floorLamp(62.4, 0, 14);
  pot(62.3, 0, 26.6); hamper(22.2, 0, 37.6); pot(42.2, 0, 37.8); pot(1.6, 0, 14.6);
  art(63.8, 1.4, 4.2, -Math.PI / 2, 1.2, 1.4); art(63.8, 1.4, 13.2, -Math.PI / 2, 1.2, 1.4);

  // =========================================================
  // UPSTAIRS
  // =========================================================
  function rail(x1, z1, x2, z2) {
    const len = Math.hypot(x2 - x1, z2 - z1), yaw = Math.atan2(-(z2 - z1), x2 - x1);
    const cx = (x1 + x2) / 2, cz = (z1 + z2) / 2;
    G.rbox(cx, Y + 1.0, cz, len, 0.06, 0.09, yaw, COL.woodLight, MAT.GRAIN, 0.02);
    for (let k = 1; k <= 7; k++) G.box(cx, Y + k * 0.13, cz, len, 0.012, 0.012, yaw, COL.steel, MAT.METAL);
    const n = Math.ceil(len / 1.6);
    for (let i = 0; i <= n; i++) G.box(x1 + (x2 - x1) * i / n, Y, z1 + (z2 - z1) * i / n, 0.05, 1.0, 0.05, 0, COL.trim, MAT.METAL);
    G.box(cx, Y - 0.4, cz, len, 0.4, 0.12, yaw, COL.white);
    obbs.push(makeOBB(cx, cz, len / 2, 0.06, yaw, Y - 0.4, Y + 1.05, false, true));
  }
  rail(26.4, 12, 40, 12); rail(40, 12, 40, 28); rail(24, 28, 40, 28); rail(24, 12.3, 24, 28);

  livingSet(5, Y, 4.8, 0, COL.cream, COL.cream, hex('#d8cfbf'), true);
  livingSet(12.4, Y, 4.8, 0, COL.tan, COL.cream, hex('#cfc6b7'), false);
  livingSet(19.5, Y, 4.8, 0, COL.cream, COL.sage, hex('#bdb5a7'), false);
  livingSet(8, Y, 10.9, Math.PI, COL.navy, COL.cream, hex('#a9a69f'), false);
  livingSet(17.5, Y, 10.9, Math.PI, COL.cream, COL.tan, hex('#d0c7b8'), true);
  livingSet(17, Y, 17.5, Math.PI / 2, COL.olive, COL.cream, hex('#bdb5a7'), false);
  livingSet(17.5, Y, 24.4, 0, hex('#d9c7a8'), COL.cream, hex('#cfc6b7'), false);
  for (let i = 0; i < 8; i++) { const c = pc(['#8a3b35', '#3c4a57', '#b7a58d', '#6f7556', '#c9c2b6', '#5a3d2b', '#a35d45']); G.box(0.22, Y + 0.5, 14.8 + i * 1.65, 0.05, 2.7, 1.5, 0, c, MAT.CARPET); G.box(0.25, Y + 0.6, 14.8 + i * 1.65, 0.01, 2.5, 1.3, 0, shade(c, 0.75), MAT.CARPET); G.cyl(0.3, Y + 3.25, 14.8 + i * 1.65, 0.025, 1.55, COL.black, MAT.METAL, 6, 'z'); }
  for (let i = 0; i < 17; i++) G.cyl(5, Y, 16 + i * 0.5, 0.21, 2.2 + (i % 3) * 0.12, pc(['#8a3b35', '#3c4a57', '#b7a58d', '#6f7556', '#c9c2b6', '#a35d45', '#d8cfbf']), MAT.CARPET, 10);
  obbs.push(makeOBB(5, 20, 0.26, 4.3, 0, Y, Y + 2.2));
  rug(9, Y, 20, 4, 6, 0, hex('#8a3b35')); rug(9.3, Y + 0.014, 20.4, 3, 4.5, 0.15, hex('#3c4a57'));
  pot(1.7, Y, 26.3); hamper(2.4, Y, 13.4);

  shelfWall(6.5, Y, 39.45, Math.PI, 11, 'pillows', 2.3, 0.45, COL.white);
  shelfWall(0.55, Y, 34.2, Math.PI / 2, 8, 'vases', 2.3, 0.42, COL.white);
  pot(3, Y, 31.2); pot(5.6, Y, 33.6); hamper(8.6, Y, 31.6); hamper(10.8, Y, 34.8); pot(12.6, Y, 37.6); hamper(3, Y, 37.3); pot(7.6, Y, 36.8);
  plant(13.8, Y, 31, 1.7); plant(1.6, Y, 29.4, 1.5);
  gondola(11.5, Y, 29.4, 0, 3.6, 'pillows', 1.4);

  for (const [bx, col] of [[19.5, hex('#d9d4c9')], [25.5, hex('#8e9a86')], [31.5, hex('#5b6b7d')], [37.5, hex('#c9b8a3')]]) bed(bx, Y, 38.35, Math.PI, col);
  rug(28.5, Y, 35.4, 22, 3.2, 0, hex('#d6cfc2'));

  for (const [sx, sz] of [[49.6, 30.6], [62, 30.2]]) { G.box(sx, Y, sz, 0.05, 1.5, 0.05, 0, COL.black); G.box(sx, Y + 1.1, sz, 0.9, 0.5, 0.04, 0, COL.red); G.box(sx, Y + 1.25, sz + 0.025, 0.6, 0.12, 0.005, 0, COL.white); }
  sofa(54.5, Y, 32.6, 0.35, 2.2, COL.tan);
  gondola(58, Y, 38.6, 0, 5, 'mixed', 1.5);
  displayTable(51, Y, 35.2, Math.PI / 2, 2.4, 1.0, 0.85, COL.white, 'mixed');
  boxPile(61, Y, 35.6, 4, 0.9);
  swivel(57.5, Y, 34.6, 2.2, COL.rust); chair(50, Y, 38.6, 0.4, COL.woodDark, false); chair(50.9, Y, 38.9, -0.3, COL.woodDark, false);
  hamper(52.4, Y, 38.6); pot(56.3, Y, 36.4); hamper(62.2, Y, 32.6);

  for (const cx of [45.5, 51, 57]) for (const cz of [15.5, 20, 24.5]) {
    solid(cx, Y, cz, 1.9, 0.8, 0.5, 0, COL.woodMid, MAT.GRAIN, { round: 0.02 });
    tableLamp(cx - 0.5, Y + 0.8, cz); tableLamp(cx + 0.5, Y + 0.8, cz, COL.white);
  }
  for (const [lx, lz] of [[48.3, 17.8], [54, 22.3], [60.5, 17], [60.5, 25]]) floorLamp(lx, Y, lz);
  shelfWall(63.45, Y, 20, -Math.PI / 2, 12, 'vases', 2.3, 0.42, COL.white);
  for (let i = 0; i < 5; i++) pendant(45 + i * 3.6, ROOF, 20 + (i % 2) * 2, 7.2 + (i % 3) * 0.3, 0.2);
  for (let i = 0; i < 6; i++) {
    const sx = 41.4, sz = 13.4 + i * 2.5;
    G.lathe(sx, Y, sz, [[0, 0], [0.18, 0, 1], [0.17, 0.03, 1], [0.025, 0.05], [0.025, 0.66], [0, 0.66]], COL.black, MAT.METAL, 10);
    G.torus(sx, Y + 0.3, sz, 0.15, 0.01, COL.black, MAT.METAL, 12, 4);
    G.lathe(sx, Y + 0.66, sz, [[0, 0], [0.2, 0, 1], [0.22, 0.04], [0.2, 0.08, 1], [0, 0.08]], pc(['#c49a6c', '#ece6da', '#2b2b2b', '#a87b4f']), MAT.LEATHER, 14);
    obbs.push(makeOBB(sx, sz, 0.22, 0.22, 0, Y, Y + 1.0, false));
  }

  diningSet(31, Y, 4.6, 0, 2.6, 1.0, COL.woodLight, COL.black, hex('#9b9488'), false);
  diningSet(38.5, Y, 5.2, 0, 2.2, 1.0, COL.woodMid, COL.cream, null, true);
  diningSet(34.5, Y, 9.6, 0, 2.0, 1.0, COL.woodDark, COL.woodLight, null, false);
  counter(45.5, Y, 9.8, Math.PI, 4.2, 0.9, 1.05, 2);
  place(47, Y, 4.2, 0, (H) => {
    G.rbox(0, 0.72, 0, 5.2, 0.06, 1.1, 0, COL.woodLight, MAT.GRAIN, 0.015);
    for (const ex of [-2.5, 2.5]) G.rbox(ex, 0, 0, 0.12, 0.72, 1.0, 0, COL.woodLight, MAT.GRAIN, 0.015);
    for (const ex of [-1.6, 0, 1.6]) { G.cyl(ex, 0.78, -0.3, 0.07, 0.02, COL.steel, MAT.METAL, 10); G.box(ex, 0.78, -0.3, 0.03, 0.18, 0.03, 0, COL.steel, MAT.METAL); G.rbox(ex, 0.92, -0.32, 0.62, 0.4, 0.03, 0, COL.steel, MAT.METAL, 0.01); G.box(ex, 0.95, -0.3, 0.56, 0.32, 0.005, 0, hex('#202428'), MAT.GLOW); G.rbox(ex, 0.78, 0.0, 0.4, 0.015, 0.13, 0, COL.white, 0, 0.005); }
    H.hit(0, 0, 5.2, 1.1, 0.68, 0.78); H.hit(0, 0, 5.1, 1.0, 0, 0.78, false);
  });
  for (const ex of [-1.6, 0, 1.6]) chair(47 + ex, Y, 5.05, Math.PI, COL.woodLight, true);
  livingSet(56, Y, 4.8, 0, COL.cream, COL.tan, hex('#d8cfbf'), true);
  livingSet(58.5, Y, 10.6, Math.PI, COL.sage, COL.cream, hex('#bdb5a7'), false);
  tree(42.6, Y, 30, 2.6, 0.8); tree(22.4, Y, 29.6, 2.6, 0.8);
  for (const [px, pz] of [[12.4, 7.5], [31, 4.6], [56, 8]]) wovenPendant(px, ROOF, pz, 7.6, 0.45);
  art(0.2, Y + 1.4, 4.4, Math.PI / 2, 1.2, 1.5); art(0.2, Y + 1.4, 8.8, Math.PI / 2, 1.0, 1.2);
  // wall clock (hands drawn each frame), east wall
  G.push(A.chain(A.T(63.82, 2.6, 8.8), A.Rz(Math.PI / 2)));
  G.lathe(0, 0, 0, [[0, 0], [0.36, 0, 1], [0.37, 0.03], [0.35, 0.07, 1], [0.31, 0.07, 1], [0.31, 0.05, 1], [0, 0.05]], COL.black, MAT.METAL, 28);
  G.cyl(0, 0.045, 0, 0.31, 0.012, COL.white, 0, 28);
  for (let i = 0; i < 12; i++) { const a = i * TAU / 12; G.box(Math.cos(a) * 0.26, 0.055, Math.sin(a) * 0.26, i % 3 ? 0.02 : 0.05, 0.006, 0.02, -a, COL.black); }
  G.pop();

  // =========================================================
  // OUTSIDE
  // =========================================================
  G.box(32, -0.12, -22.6, 140, 0.12, 45, 0, COL.snow, MAT.SNOW);
  G.box(86, -0.12, 20, 44, 0.12, 40.3, 0, COL.snow, MAT.SNOW);
  G.box(32, -0.05, -14, 60, 0.05, 20, 0, COL.asphalt, MAT.ASPHALT);
  G.box(70, -0.05, 18, 8, 0.05, 44, 0, COL.asphalt, MAT.ASPHALT);
  G.box(32, -0.03, -2, 66, 0.035, 3.7, 0, hex('#c8ccd2'), MAT.CONCRETE);
  G.box(66, -0.03, 18, 3.7, 0.035, 44, 0, hex('#c8ccd2'), MAT.CONCRETE);
  for (let x = 6; x < 60; x += 3) { G.box(x, -0.014, -10, 0.1, 0.006, 5, 0, hex('#cfd3d8'), MAT.SNOW); G.box(x, -0.014, -19, 0.1, 0.006, 5, 0, hex('#cfd3d8'), MAT.SNOW); }
  for (let i = 0; i < 30; i++) G.ellipsoid(R(-6, 72), -0.1, R(-34, -27), R(1.2, 3), R(0.4, 0.9), R(0.8, 2), COL.snow, MAT.SNOW, 10, 5);
  for (let i = 0; i < 16; i++) G.ellipsoid(R(76, 82), -0.1, R(-30, 40), R(0.8, 2), R(0.4, 0.9), R(1, 3), COL.snow, MAT.SNOW, 10, 5);
  for (let i = 0; i < 60; i++) { const tx = R(-30, 100), tz = R(-44, -36), th = R(5, 11); G.lathe(tx, -0.1, tz, [[0, 0], [th * 0.28, th * 0.15], [th * 0.18, th * 0.45], [th * 0.12, th * 0.6], [0.05, th], [0, th]], shade(hex('#1b2a24'), R(0.7, 1.1)), MAT.FUR, 8); }
  for (let i = 0; i < 20; i++) { const tz = R(-40, 44), th = R(5, 10); G.lathe(R(92, 104), -0.1, tz, [[0, 0], [th * 0.28, th * 0.15], [th * 0.18, th * 0.45], [0.05, th], [0, th]], shade(hex('#1b2a24'), R(0.7, 1.1)), MAT.FUR, 8); }
  for (const [lx, lz] of [[18, -16], [46, -16], [32, -28], [74, 8], [74, 32]]) {
    G.lathe(lx, -0.05, lz, [[0, 0], [0.25, 0, 1], [0.25, 0.5, 1], [0.08, 0.6], [0.07, 6.2], [0, 6.2]], hex('#4a4e55'), MAT.METAL, 10);
    G.rbox(lx, 6.1, lz, 0.9, 0.18, 0.4, 0, hex('#4a4e55'), MAT.METAL, 0.04);
    G.box(lx, 6.08, lz, 0.75, 0.02, 0.28, 0, hex('#ffd59a'), MAT.GLOW);
    G.ellipsoid(lx, 6.3, lz, 0.5, 0.06, 0.25, COL.snow, MAT.SNOW, 8, 4);
    light(lx, 5.6, lz, '#ffc27a', 15, 1.1);
  }
  light(32, 2.8, -2.2, '#ffd9a0', 7, 0.8); light(66.2, 2.8, 30, '#ffd9a0', 6, 0.7);
  for (const lx of [8, 20, 44, 56]) light(lx, 2.2, -1.6, '#ffd9a0', 5, 0.45);
  for (const lz of [6, 16, 24]) light(65.8, 2.2, lz, '#ffd9a0', 5, 0.4);
  // brick base band along the facades, broken at the two doorways
  for (const [x0, x1] of [[-0.2, 29.2], [34.8, 64.2]]) G.box((x0 + x1) / 2, 0, -0.17, x1 - x0, 0.9, 0.06, 0, COL.brick, MAT.BRICK);
  for (const [z0, z1] of [[-0.2, 28.2], [31.8, 40.2]]) G.box(64.17, 0, (z0 + z1) / 2, 0.06, 0.9, z1 - z0, 0, COL.brick, MAT.BRICK);
  G.box(32, ROOF, -0.2, 64.6, 0.45, 0.4, 0, COL.trim); G.box(64.2, ROOF, 20, 0.4, 0.45, 40.6, 0, COL.trim);
  G.box(32, ROOF + 0.3, 7.6, 64.4, 0.1, 15.6, 0, COL.snow, MAT.SNOW); G.box(32, ROOF + 0.3, 32.3, 64.4, 0.1, 15.6, 0, COL.snow, MAT.SNOW);
  G.rbox(32, 4.5, -0.32, 9, 2.2, 0.2, 0, hex('#2a2a2c'), MAT.METAL, 0.05);
  const SIGN = hex('#fff1d0');
  const bar = (x0, y0, x1, y1) => { const cx = 32 + (x0 + x1) / 2, cy = 4.85 + (y0 + y1) / 2, len = Math.hypot(x1 - x0, y1 - y0); G.push(A.chain(A.T(cx, cy, -0.45), A.Rz(Math.atan2(y1 - y0, x1 - x0)))); G.box(0, -0.08, 0, len + 0.16, 0.16, 0.08, 0, SIGN, MAT.GLOW); G.pop(); };
  // read from the parking lot, +x is on the viewer's left: B (left), O, X (right)
  bar(3.1, 0, 3.1, 1.5); bar(3.1, 1.5, 2.35, 1.5); bar(2.35, 1.5, 2.15, 1.3); bar(2.15, 1.3, 2.15, 0.95); bar(2.15, 0.95, 2.35, 0.75); bar(3.1, 0.75, 2.35, 0.75);
  bar(2.35, 0.75, 2.05, 0.55); bar(2.05, 0.55, 2.05, 0.2); bar(2.05, 0.2, 2.3, 0); bar(3.1, 0, 2.3, 0);
  bar(-0.55, 0.2, -0.55, 1.3); bar(0.55, 0.2, 0.55, 1.3); bar(-0.35, 1.5, 0.35, 1.5); bar(-0.35, 0, 0.35, 0); bar(0.55, 1.3, 0.35, 1.5); bar(-0.55, 1.3, -0.35, 1.5); bar(0.55, 0.2, 0.35, 0); bar(-0.55, 0.2, -0.35, 0);
  bar(-2.0, 0, -3.2, 1.5); bar(-2.0, 1.5, -3.2, 0);
  light(32, 5.6, -2.5, '#fff1d0', 6, 0.5);

  // ---- data ----
  const surfaces = [{ x0: 0, x1: W, z0: 0, z1: D, y: 0 }];
  for (const [x0, x1, z0, z1] of slabs) surfaces.push({ x0, x1, z0, z1, y: F1 });
  const ramps = [{ x0: S1.x0, x1: S1.x1, z0: S1.zTop, z1: S1.zBot, axis: 'z', a0: S1.zBot, a1: S1.zTop, y0: 0, y1: F1 }];
  const stairs = [{ bottom: [25.2, 26.8], top: [25.2, 11.3], name: 'Stairs' }];
  const rect = [[0, 0], [W, 0], [W, D], [0, D]];
  const zones = [
    [1, 0, 15, 28, 40, 'Bath Corner'], [1, 15, 44, 28, 40, 'Bedrooms'], [1, 44, 64, 28, 40, 'Clearance'],
    [1, 0, 24, 12, 28, 'Rug Wall'], [1, 0, 24, 0, 12, 'Upstairs Living Rooms'], [1, 24, 40, 12, 28, 'Balcony'],
    [1, 24, 52, 0, 12, 'Upstairs Dining'], [1, 52, 64, 0, 12, 'Upstairs Living Rooms'], [1, 40, 64, 12, 28, 'Lighting'],
    [0, 0, 24, 14, 40, 'Kitchen'], [0, 0, 28, 0, 14, 'Registers'], [0, 28, 40, 0, 12, 'Front Doors'],
    [0, 24, 40, 12, 28, 'Atrium'], [0, 24, 44, 28, 40, 'Glassware'], [0, 40, 64, 0, 14, 'Living Rooms'],
    [0, 40, 64, 14, 28, 'Dining Tables'], [0, 44, 64, 28, 40, 'Side Door'],
  ];
  for (const l of lights) {
    const f = !l.out && l.y > F1 - 0.05 ? 1 : 0; l.f = f;
    l.zone = l.out ? -1 : ((l.x < 24 ? (l.z < 14 ? 0 : 1) : l.x < 40 ? (l.z < 12 ? 2 : l.z < 28 ? 3 : 4) : (l.z < 14 ? 5 : l.z < 28 ? 6 : 7)) + (f ? 8 : 0));
  }
  return {
    geo: G, models, obbs, lights, surfaces, ramps, stairs, polys: [rect, rect], zones, F1, width: W, depth: D, containers,
    doors: { front: frontDoor, side: sideDoor }, skylight: SK,
    crashDisplay: { x: 29.5, z: 21.5, yaw: 0.5 },
    clock: { x: 63.77, y: 2.6, z: 8.8 },
    bounds: [-2, 66, -0.2, 9.4, -2, 42],
    clueSpots: [[0, 10, 26.5], [0, 57, 8], [0, 50, 21], [0, 31, 36.8], [0, 12, 7], [0, 61, 37.6], [0, 4, 37.4],
      [1, 28, 8.5], [1, 50, 13.6], [1, 60.5, 27], [1, 13, 27], [1, 22.5, 34.5], [1, 43, 37.5], [1, 9, 8]],
    keySpots: [[0, 11, 17, 1.08], [0, 25.5, 5, 1.08], [1, 45.5, 9.8, 1.08]],
    trapSpots: [[0, 31, 11, 'z', 2.6], [0, 41.3, 20, 'x', 2.4], [0, 33, 29, 'z', 2.4], [0, 25.2, 27.4, 'x', 2.0], [0, 44, 13.2, 'z', 2.4], [0, 22.8, 14, 'z', 2.6],
      [1, 25.2, 10.7, 'x', 2.0], [1, 41.6, 29.2, 'z', 2.2], [1, 15, 29.2, 'z', 2.2], [1, 49.4, 31.2, 'x', 2.4], [1, 22.4, 20, 'x', 2.6], [1, 42.4, 11.2, 'z', 2.2], [1, 30, 29.6, 'z', 2.2]],
    playerSpawn: [32, 0, 3.2, 0],
    leoSpots: [
      [0, 33, 20, 4.5, 'It’s SO big. Do you think it’s real?'],
      [1, 28.5, 37, 6, 'This one’s mine. I live here now.'],
      [1, 6, 34, 5, 'These pots are big enough to fit a whole kid!'],
      [1, 5, 20, 4, 'Rugs! Rugs! Rugs!'],
      [1, 51, 20, 5, 'Can we get a lamp shaped like a mushroom?'],
      [0, 10, 24, 4, 'Mom has a mixer like that. She never uses it.'],
      [0, 33, 34, 4.5, 'Don’t touch anything. Dad says.'],
      [1, 56, 34, 5, 'Everything here has a red tag. Is it broken?'],
      [1, 41.4, 18, 3, 'Spin the stools! Spin them!'],
      [0, 52, 6, 5, 'This couch is squishy. Dad’s gonna sit on all of them.'],
    ],
  };
}
