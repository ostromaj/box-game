// ============================================================
// BOX — the store. Two sales floors (layout shuffled on purpose; no back rooms).
// Units are meters. x runs west→east (0..64), z runs south→north (0..40).
// Ground floor y=0, upstairs y=4.5. Layout is simplified on purpose.
// ============================================================

const F1 = 4.5; // upstairs floor height

const COL = {
  wall: hex('#eceae4'), ship: hex('#f2f0ea'), backWall: hex('#e4e2dc'), trim: hex('#ffffff'),
  concrete: hex('#bba98a'), hardwood: hex('#cf9f68'), upWood: hex('#d8b48a'), tile: hex('#ebeae5'),
  vinyl: hex('#d8d0c0'), carpetGreen: hex('#4f625e'), ceil: hex('#f3f0ea'), ceilWood: hex('#d9bf98'),
  woodLight: hex('#dcc19a'), woodMid: hex('#b98a5a'), woodDark: hex('#5a3d2b'), black: hex('#242426'),
  steel: hex('#b9bec4'), white: hex('#f6f5f1'), cream: hex('#e6dfd2'), navy: hex('#2f3b55'),
  tan: hex('#c49a6c'), sage: hex('#8f9a7d'), olive: hex('#6f7556'), rust: hex('#a35d45'),
  red: hex('#9e2f37'), green: hex('#2f5a35'), brick: hex('#8d4b3b'), glassNight: hex('#121a27'),
  glassLow: hex('#1b2536'), card: hex('#b8925f'), metal: hex('#8f959b'), locker: hex('#9aa7a1'),
  marble: hex('#e9e6e1'), stone: hex('#d6cfc4'), warm: hex('#ffe2a8'), bulb: hex('#fff3d6'),
};

const PAL = {
  mixed: ['#f2f0ea', '#e4ddd0', '#c9c4bb', '#8a9aa8', '#5d7a8c', '#a35d45', '#2b2b2b', '#d8c3a0', '#7d8f72', '#b9a27f'],
  plates: ['#f7f6f2', '#ecebe6', '#dcd9d2', '#9fb3b0', '#7f8d99', '#3b3f45', '#c9d3cf'],
  glass: ['#dfe6e8', '#e8eef0', '#cfd9dc', '#f2f5f6', '#d5dee0'],
  pillows: ['#e8e1d6', '#c9b8a3', '#8e9a86', '#5b6b7d', '#b07d62', '#d9cfc0', '#4a4a48', '#a8a29a', '#6e5a4a'],
  appl: ['#2a2a2c', '#b9bec4', '#d7d9db', '#7a7f86', '#e9e6df', '#3d5a4e', '#9b2f2f', '#40464d'],
  cook: ['#3a5a8a', '#7aa3a0', '#e8e0d0', '#b9bec4', '#2a2a2c', '#c8553d', '#6d8b74', '#efe9dc'],
  gifts: ['#a8323a', '#2f5a3f', '#f2f0ea', '#c9a24b', '#2b2b2b', '#7a1f2b', '#d9d2c4'],
  boxes: ['#b8925f', '#c49e6b', '#a8834f', '#d1b07c', '#e8e4dc'],
  vases: ['#efebe3', '#e2dbcf', '#cfc6b8', '#8b8f8c', '#5e615f', '#c9b9a0'],
};

function buildLevel() {
  const G = new Geo();
  const obbs = [];
  const rnd = mulberry32(20261114);
  const R = (a, b) => a + (b - a) * rnd();
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const pc = (arr) => hex(pick(arr));

  // ---------- primitives ----------
  function solid(cx, y0, cz, sx, sy, sz, yaw, col, mat = 0, o = {}) {
    G.box(cx, y0, cz, sx, sy, sz, yaw, col, mat, o.top || null);
    if (o.collide !== false || o.opaque !== false)
      obbs.push(makeOBB(cx, cz, sx / 2, sz / 2, yaw, y0, y0 + sy, o.opaque !== false, o.collide !== false));
  }
  function wall(x1, z1, x2, z2, y0, y1, col = COL.wall, mat = MAT.PLAIN, thick = 0.3, o = {}) {
    const len = Math.hypot(x2 - x1, z2 - z1), yaw = Math.atan2(-(z2 - z1), x2 - x1);
    solid((x1 + x2) / 2, y0, (z1 + z2) / 2, len + (o.noExtend ? 0 : thick), y1 - y0, thick, yaw, col, mat, o);
  }
  function frame(cx, cz, yaw) {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const w = (lx, lz) => [cx + lx * c + lz * s, cz - lx * s + lz * c];
    return {
      w,
      box(lx, y0, lz, sx, sy, sz, col, mat = 0, o = {}) {
        const [x, z] = w(lx, lz), yy = yaw + (o.yaw || 0);
        G.box(x, y0, z, sx, sy, sz, yy, col, mat, o.top || null);
        if (o.hit) obbs.push(makeOBB(x, z, sx / 2, sz / 2, yy, y0, y0 + sy, o.opaque !== false, true));
      },
      cyl(lx, y0, lz, r, h, col, mat = 0, seg = 12, rTop = null) { const [x, z] = w(lx, lz); G.cyl(x, y0, z, r, h, col, mat, seg, 'y', rTop); },
      sphere(lx, y, lz, r, col, mat = 0, seg = 10) { const [x, z] = w(lx, lz); G.sphere(x, y, z, r, col, mat, seg); },
      hit(lx, lz, sx, sz, y0, y1, opaque = true, collide = true, lyaw = 0) {
        const [x, z] = w(lx, lz); obbs.push(makeOBB(x, z, sx / 2, sz / 2, yaw + lyaw, y0, y1, opaque, collide));
      },
    };
  }

  // ---------- small furniture ----------
  function items(F, x0, x1, y, lz, depth, style, hMax) {
    let x = x0 + R(0, 0.08);
    while (x < x1 - 0.12) {
      let w, h, d = depth * R(0.6, 0.9), col;
      switch (style) {
        case 'plates': w = R(0.22, 0.32); h = R(0.08, Math.min(0.24, hMax)); col = pc(PAL.plates); break;
        case 'glass': w = R(0.25, 0.45); h = R(0.12, Math.min(0.3, hMax)); col = pc(PAL.glass); break;
        case 'pillows': w = R(0.4, 0.55); h = R(0.25, Math.min(0.45, hMax)); col = pc(PAL.pillows); d = depth * 0.8; break;
        case 'appl': w = R(0.3, 0.5); h = R(0.3, Math.min(0.48, hMax)); col = pc(PAL.appl); break;
        case 'cook': w = R(0.28, 0.45); h = R(0.12, Math.min(0.3, hMax)); col = pc(PAL.cook); break;
        case 'gifts': w = R(0.2, 0.4); h = R(0.1, Math.min(0.32, hMax)); col = pc(PAL.gifts); break;
        case 'boxes': w = R(0.35, 0.6); h = R(0.25, Math.min(0.5, hMax)); col = pc(PAL.boxes); d = depth * 0.9; break;
        case 'vases': w = R(0.2, 0.35); h = R(0.2, Math.min(0.42, hMax)); col = pc(PAL.vases); break;
        default: w = R(0.22, 0.42); h = R(0.1, Math.min(0.32, hMax)); col = pc(PAL.mixed);
      }
      if (x + w > x1) break;
      if (style === 'vases' || style === 'glass') F.cyl(x + w / 2, y, lz, w / 2.2, h, col, 0, 8, style === 'vases' ? w / 3.5 : null);
      else F.box(x + w / 2, y, lz, w, h, d, col);
      x += w + R(0.03, 0.14);
    }
  }
  // wall of shelves; front faces +z in its own frame
  function shelfWall(x, y, z, yaw, len, style = 'mixed', h = 2.2, depth = 0.42, back = COL.woodLight) {
    const F = frame(x, z, yaw);
    F.box(0, y, -depth / 2 + 0.03, len, h, 0.06, back, MAT.SHIPLAP);
    F.box(-len / 2 + 0.03, y, 0, 0.06, h, depth, shade(back, 0.95));
    F.box(len / 2 - 0.03, y, 0, 0.06, h, depth, shade(back, 0.95));
    const n = Math.max(3, Math.floor(h / 0.42));
    for (let i = 0; i < n; i++) {
      const sy = y + 0.12 + i * ((h - 0.25) / (n - 1));
      F.box(0, sy - 0.03, 0.02, len - 0.12, 0.03, depth - 0.04, COL.white);
      if (i < n - 1) items(F, -len / 2 + 0.1, len / 2 - 0.1, sy, 0.02, depth - 0.1, style, (h - 0.25) / (n - 1) - 0.06);
    }
    F.hit(0, 0, len, depth, y, y + h);
  }
  // double-sided island shelf
  function gondola(x, y, z, yaw, len, style = 'mixed', h = 1.45, depth = 1.0) {
    const F = frame(x, z, yaw);
    F.box(0, y, 0, len, 0.12, depth, COL.black);
    F.box(0, y, 0, len - 0.02, h, 0.08, COL.woodLight, MAT.SHIPLAP);
    F.box(-len / 2 + 0.03, y, 0, 0.06, h, depth, COL.woodLight);
    F.box(len / 2 - 0.03, y, 0, 0.06, h, depth, COL.woodLight);
    const n = 3;
    for (let i = 0; i < n; i++) {
      const sy = y + 0.14 + i * ((h - 0.2) / n);
      for (const side of [-1, 1]) {
        F.box(0, sy - 0.03, side * depth / 4, len - 0.12, 0.03, depth / 2 - 0.08, COL.white);
        items(F, -len / 2 + 0.1, len / 2 - 0.1, sy, side * depth / 4, depth / 2 - 0.12, style, (h - 0.2) / n - 0.06);
      }
    }
    F.hit(0, 0, len, depth, y, y + h);
  }
  function metalShelf(x, y, z, yaw, len, h = 2.5, depth = 0.6) {
    const F = frame(x, z, yaw);
    for (const ex of [-len / 2 + 0.03, len / 2 - 0.03]) for (const ez of [-depth / 2 + 0.03, depth / 2 - 0.03]) F.box(ex, y, ez, 0.05, h, 0.05, COL.metal);
    const n = 5;
    for (let i = 0; i < n; i++) {
      const sy = y + 0.12 + i * ((h - 0.2) / (n - 1));
      F.box(0, sy - 0.03, 0, len, 0.03, depth, COL.woodLight);
      if (i < n - 1) items(F, -len / 2 + 0.06, len / 2 - 0.06, sy, 0, depth - 0.06, rnd() < 0.7 ? 'boxes' : 'appl', (h - 0.2) / (n - 1) - 0.06);
    }
    F.hit(0, 0, len, depth, y, y + h);
  }
  function displayTable(x, y, z, yaw, w, d, h = 0.85, col = COL.white, style = 'mixed', twoTier = true) {
    const F = frame(x, z, yaw);
    F.box(0, y + h - 0.05, 0, w, 0.05, d, col);
    for (const ex of [-1, 1]) F.box(ex * (w / 2 - 0.04), y, 0, 0.08, h - 0.05, d, col);
    if (twoTier) { F.box(0, y + 0.18, 0, w - 0.1, 0.04, d - 0.06, col); items(F, -w / 2 + 0.15, w / 2 - 0.15, y + 0.22, 0, d - 0.2, style, 0.3); }
    items(F, -w / 2 + 0.1, w / 2 - 0.1, y + h, -d / 4, d / 2 - 0.1, style, 0.35);
    items(F, -w / 2 + 0.1, w / 2 - 0.1, y + h, d / 4, d / 2 - 0.1, style, 0.35);
    F.hit(0, 0, w, d, y, y + h);
  }
  function rug(x, y, z, w, d, yaw, col) { G.box(x, y + 0.002, z, w, 0.012, d, yaw, col, MAT.CARPET); }
  function sofa(x, y, z, yaw, w, col, pillow) {
    const F = frame(x, z, yaw), d = 0.95;
    F.box(0, y, 0, w - 0.1, 0.12, d - 0.1, COL.woodDark);
    F.box(0, y + 0.12, 0.05, w - 0.36, 0.3, d - 0.1, col);
    const n = w > 2.2 ? 3 : 2, cw = (w - 0.42) / n;
    for (let i = 0; i < n; i++) F.box(-w / 2 + 0.21 + cw * (i + 0.5), y + 0.42, 0.08, cw - 0.03, 0.1, d - 0.32, shade(col, 1.05));
    F.box(0, y + 0.12, -d / 2 + 0.13, w, 0.76, 0.26, shade(col, 0.94));
    for (const s of [-1, 1]) F.box(s * (w / 2 - 0.1), y + 0.12, 0, 0.2, 0.5, d, shade(col, 0.97));
    const pcol = pillow || pc(PAL.pillows);
    F.box(-(w / 2 - 0.5), y + 0.5, -d / 2 + 0.33, 0.42, 0.38, 0.13, pcol, 0, { yaw: 0.15 });
    F.box(w / 2 - 0.5, y + 0.5, -d / 2 + 0.33, 0.42, 0.38, 0.13, pcol, 0, { yaw: -0.15 });
    F.hit(0, 0, w, d, y, y + 0.88);
  }
  function chaise(x, y, z, yaw, col) { // extra sectional piece, front faces +z
    const F = frame(x, z, yaw);
    F.box(0, y, 0, 0.9, 0.12, 1.5, COL.woodDark);
    F.box(0, y + 0.12, 0, 0.98, 0.3, 1.6, col);
    F.box(0, y + 0.42, 0.05, 0.9, 0.1, 1.45, shade(col, 1.05));
    F.box(0.39, y + 0.12, 0, 0.2, 0.5, 1.6, shade(col, 0.97));
    F.hit(0, 0, 1.0, 1.6, y, y + 0.62);
  }
  function chair(x, y, z, yaw, col, upholstered) {
    const F = frame(x, z, yaw);
    for (const ex of [-0.19, 0.19]) for (const ez of [-0.19, 0.19]) F.box(ex, y, ez, 0.04, 0.44, 0.04, upholstered ? COL.woodDark : col);
    F.box(0, y + 0.44, 0, 0.46, upholstered ? 0.08 : 0.04, 0.46, col);
    F.box(0, y + 0.48, -0.21, 0.46, upholstered ? 0.45 : 0.36, 0.05, col);
    F.hit(0, 0, 0.46, 0.46, y, y + 0.92, false);
  }
  function swivel(x, y, z, yaw, col) {
    const F = frame(x, z, yaw);
    F.cyl(0, y, 0, 0.3, 0.1, COL.woodDark, 0, 10);
    F.cyl(0, y + 0.1, 0, 0.42, 0.34, col, 0, 14);
    F.box(0, y + 0.42, -0.24, 0.8, 0.36, 0.3, shade(col, 0.95));
    for (const s of [-1, 1]) F.box(s * 0.33, y + 0.42, -0.02, 0.18, 0.22, 0.6, shade(col, 0.95));
    F.hit(0, 0, 0.88, 0.88, y, y + 0.8);
  }
  function roundTable(x, y, z, r, h, top, base, style) {
    const F = frame(x, z, 0);
    F.cyl(0, y, 0, r * 0.42, h - 0.05, base, 0, 14, r * 0.3);
    F.cyl(0, y + h - 0.05, 0, r, 0.05, top, 0, 18);
    if (style) items(F, -r * 0.6, r * 0.6, y + h, 0, r * 0.6, style, 0.3);
    F.hit(0, 0, r * 1.6, r * 1.6, y, y + h);
  }
  function floorLamp(x, y, z) {
    G.cyl(x, y, z, 0.16, 0.04, COL.black, 0, 8);
    G.cyl(x, y, z, 0.02, 1.45, COL.black, 0, 6);
    G.cyl(x, y + 1.3, z, 0.26, 0.32, COL.warm, MAT.GLOW, 12, 0.12);
    obbs.push(makeOBB(x, z, 0.15, 0.15, 0, y, y + 1.6, false, true));
  }
  function tableLamp(x, yTop, z, col) {
    G.cyl(x, yTop, z, 0.09, 0.32, col || pc(PAL.vases), 0, 8, 0.05);
    G.cyl(x, yTop + 0.3, z, 0.2, 0.22, COL.warm, MAT.GLOW, 10, 0.1);
  }
  function plant(x, y, z, h = 1.6) {
    G.cyl(x, y, z, 0.25, 0.45, hex('#d9d2c4'), 0, 10, 0.2);
    for (let i = 0; i < 4; i++) G.sphere(x + R(-0.25, 0.25), y + 0.6 + i * (h - 0.6) / 4, z + R(-0.25, 0.25), R(0.25, 0.38), shade(COL.green, R(0.9, 1.3)), 0, 7);
    obbs.push(makeOBB(x, z, 0.3, 0.3, 0, y, y + h, false, true));
  }
  function livingSet(x, y, z, yaw, sofaCol, chairCol, rugCol, sect) {
    const F = frame(x, z, yaw);
    rug(x, y, z, 4.4, 3.6, yaw, rugCol);
    const [sx, sz] = F.w(0, -1.15); sofa(sx, y, sz, yaw, 2.5, sofaCol);
    if (sect) { const [cx, cz] = F.w(-1.75, -0.45); chaise(cx, y, cz, yaw, sofaCol); }
    for (const s of [-1, 1]) { const [cx, cz] = F.w(s * 0.85, 1.3); swivel(cx, y, cz, yaw + Math.PI, chairCol); }
    const [tx, tz] = F.w(0, 0.1); roundTable(tx, y, tz, 0.5, 0.4, COL.stone, COL.stone, 'vases');
    const [lx, lz] = F.w(sect ? 1.75 : 1.65, -1.15); roundTable(lx, y, lz, 0.25, 0.55, COL.woodMid, COL.woodMid); tableLamp(lx, y + 0.55, lz);
  }
  function diningSet(x, y, z, yaw, w, d, top, chairCol, rugCol, upholstered) {
    const F = frame(x, z, yaw);
    if (rugCol) rug(x, y, z, w + 2.0, d + 2.0, yaw, rugCol);
    F.box(0, y + 0.72, 0, w, 0.05, d, top);
    for (const ex of [-1, 1]) for (const ez of [-1, 1]) F.box(ex * (w / 2 - 0.1), y, ez * (d / 2 - 0.1), 0.09, 0.72, 0.09, shade(top, 0.8));
    F.hit(0, 0, w, d, y + 0.68, y + 0.77);
    F.hit(0, 0, w - 0.1, d - 0.1, y, y + 0.77, false, true); // legs: solid but see-through
    const n = Math.max(1, Math.floor(w / 0.75));
    for (let i = 0; i < n; i++) {
      const lx = -w / 2 + (w / n) * (i + 0.5);
      for (const s of [-1, 1]) { const [cx, cz] = F.w(lx, s * (d / 2 + 0.33)); chair(cx, y, cz, yaw + (s > 0 ? Math.PI : 0), chairCol, upholstered); }
    }
    const [vx, vz] = F.w(0, 0); G.cyl(vx, y + 0.77, vz, 0.12, 0.3, pc(PAL.vases), 0, 8, 0.07);
    for (let i = 0; i < 4; i++) G.sphere(vx + R(-0.15, 0.15), y + 1.1 + R(0, 0.2), vz + R(-0.15, 0.15), 0.12, shade(COL.green, R(0.9, 1.3)), 0, 6);
  }
  function bed(x, y, z, yaw, duvet) { // head at -z
    const F = frame(x, z, yaw), w = 1.65, l = 2.15;
    F.box(0, y, 0, w, 0.32, l, COL.woodMid);
    F.box(0, y + 0.32, 0.03, w - 0.08, 0.24, l - 0.1, COL.white);
    F.box(0, y + 0.56, 0.25, w - 0.04, 0.06, l - 0.55, duvet);
    F.box(0, y + 0.58, l / 2 - 0.35, w, 0.08, 0.5, shade(duvet, 0.8));
    for (const s of [-1, 1]) F.box(s * 0.38, y + 0.56, -l / 2 + 0.3, 0.68, 0.16, 0.38, COL.white);
    F.box(0, y, -l / 2 - 0.04, w + 0.1, 1.3, 0.1, shade(COL.cream, 0.95));
    F.hit(0, 0, w, l, y, y + 0.64);
    F.hit(0, -l / 2 - 0.04, w + 0.1, 0.1, y, y + 1.3);
    for (const s of [-1, 1]) {
      const [nx, nz] = F.w(s * (w / 2 + 0.35), -l / 2 + 0.25);
      solid(nx, y, nz, 0.5, 0.55, 0.42, yaw, COL.woodMid);
      tableLamp(nx, y + 0.55, nz);
    }
  }
  function counter(x, y, z, yaw, w, d, h = 1.05, screens = 1) {
    const F = frame(x, z, yaw);
    F.box(0, y, 0, w, h - 0.04, d, COL.woodLight, 0);
    F.box(0, y + h - 0.04, 0, w + 0.06, 0.04, d + 0.06, COL.white);
    F.box(0, y, d / 2 - 0.02, w - 0.04, 0.1, 0.06, COL.black);
    for (let i = 0; i < screens; i++) {
      const lx = -w / 2 + (w / screens) * (i + 0.5);
      F.box(lx, y + h, -0.1, 0.06, 0.25, 0.06, COL.black);
      F.box(lx, y + h + 0.2, -0.08, 0.38, 0.26, 0.04, COL.black);
      F.box(lx, y + h + 0.22, -0.055, 0.33, 0.21, 0.01, hex('#3f6ea8'), MAT.GLOW, { yaw: 0 });
    }
    F.hit(0, 0, w, d, y, y + h);
  }
  function column(x, z, y0, y1) {
    G.cyl(x, y0, z, 0.38, y1 - y0, COL.white, 0, 16);
    obbs.push(makeOBB(x, z, 0.36, 0.36, 0, y0, y1));
  }
  function tree(x, y, z, h, r) {
    G.cyl(x, y, z, r * 0.9, 0.04, COL.red, 0, 16);
    G.cyl(x, y, z, 0.1, h * 0.25, COL.woodDark, 0, 6);
    const tiers = 4;
    for (let i = 0; i < tiers; i++) {
      const t0 = 0.15 + i * 0.2, rr = r * (1 - i * 0.2);
      G.cyl(x, y + h * t0, z, rr, h * 0.38, shade(COL.green, 0.9 + i * 0.07), 0, 14, rr * 0.25);
    }
    for (let i = 0; i < Math.round(h * 26); i++) {
      const t = R(0.18, 0.95), a = R(0, TAU), rr = r * (1 - t) * 1.05 + 0.04;
      const glow = rnd() < 0.6;
      G.box(x + Math.cos(a) * rr, y + h * t, z + Math.sin(a) * rr, 0.06, 0.06, 0.06, 0, glow ? COL.bulb : pc(PAL.gifts), glow ? MAT.GLOW : 0);
    }
    G.box(x, y + h, z, 0.25, 0.25, 0.04, 0, hex('#d6b24a'), MAT.GLOW);
    obbs.push(makeOBB(x, z, r * 0.75, r * 0.75, 0, y, y + h));
  }
  function barrel(x, y, z) {
    G.cyl(x, y, z, 0.3, 0.6, COL.woodMid, 0, 12);
    G.cyl(x, y + 0.15, z, 0.31, 0.05, COL.woodDark, 0, 12);
    G.cyl(x, y + 0.45, z, 0.31, 0.05, COL.woodDark, 0, 12);
    for (let i = 0; i < 6; i++) G.cyl(x + R(-0.15, 0.15), y + 0.5, z + R(-0.15, 0.15), 0.035, R(0.35, 0.5), COL.woodLight, 0, 6);
    obbs.push(makeOBB(x, z, 0.3, 0.3, 0, y, y + 0.7, false));
  }
  function mixer(x, yTop, z, col) {
    G.box(x, yTop, z, 0.22, 0.05, 0.32, 0, col);
    G.box(x, yTop, z - 0.12, 0.14, 0.38, 0.1, 0, col);
    G.box(x, yTop + 0.3, z - 0.02, 0.16, 0.13, 0.36, 0, col);
    G.cyl(x, yTop + 0.05, z + 0.05, 0.11, 0.17, COL.steel, 0, 10, 0.13);
  }
  function boxPile(x, y, z, n, spread = 1.2) {
    for (let i = 0; i < n; i++) {
      const w = R(0.5, 1.2), d = R(0.4, 1.0), h = R(0.4, 1.4), bx = x + R(-spread, spread), bz = z + R(-spread, spread), yaw = R(-0.2, 0.2);
      const wrapped = rnd() < 0.25;
      solid(bx, y, bz, w, h, d, yaw, wrapped ? hex('#dfe3e6') : pc(PAL.boxes), 0);
      if (rnd() < 0.4) solid(bx + R(-0.1, 0.1), y + h, bz + R(-0.1, 0.1), w * 0.8, R(0.3, 0.7), d * 0.8, yaw + R(-0.2, 0.2), pc(PAL.boxes));
    }
  }
  function pendant(x, yCeil, z, yBulb, r = 0.18, col = COL.bulb) {
    G.cyl(x, yBulb, z, 0.008, yCeil - yBulb, COL.black, 0, 4);
    G.sphere(x, yBulb, z, r, col, MAT.GLOW, 10);
  }
  function wovenPendant(x, yCeil, z, yC, r) {
    G.cyl(x, yC + r * 0.8, z, 0.008, yCeil - yC - r * 0.8, COL.black, 0, 4);
    G.sphere(x, yC, z, r, hex('#b0723f'), 0, 12);
    G.sphere(x, yC - r * 0.2, z, r * 0.4, COL.warm, MAT.GLOW, 8);
  }
  function art(x, y, z, yaw, w, h) {
    const F = frame(x, z, yaw);
    F.box(0, y, 0, w + 0.08, h + 0.08, 0.04, COL.woodLight);
    F.box(0, y + 0.04, 0.025, w, h, 0.01, pc(['#c9c2b6', '#8a8f8c', '#3d4040', '#b7a58d', '#e0dbd2', '#6f7d86']));
    F.box(R(-w / 4, w / 4), y + h * R(0.3, 0.6), 0.032, w * R(0.2, 0.5), h * R(0.15, 0.4), 0.005, pc(['#2b2b2b', '#f2f0ea', '#a35d45', '#5b6b7d']));
  }
  function door(x, y, z, yaw, w, h, col = COL.white, louver = false, open = 0) {
    const F = frame(x, z, yaw);
    F.box(0, y, 0, w + 0.16, h + 0.08, 0.32, COL.trim);
    if (open) {
      for (const s of [-1, 1]) {
        const [hx, hz] = F.w(s * w / 2, 0.17);
        const a = yaw + s * open;
        const leaf = frame(hx, hz, a);
        leaf.box(-s * w / 4, y, w / 4 * 0 + 0.03, w / 2 - 0.02, h, 0.05, col, 0);
        if (louver) for (let i = 0; i < 14; i++) leaf.box(-s * w / 4, y + 0.3 + i * 0.13, 0.06, w / 2 - 0.2, 0.03, 0.02, shade(col, 0.88));
      }
    } else {
      F.box(0, y, 0.17, w, h, 0.04, col);
      if (louver) for (let i = 0; i < 14; i++) for (const s of [-1, 1]) F.box(s * w / 4, y + 0.3 + i * 0.13, 0.195, w / 2 - 0.2, 0.03, 0.02, shade(col, 0.88));
      F.box(0, y, 0.19, 0.01, h, 0.01, shade(col, 0.8));
      F.box(w / 4 * (w > 1.2 ? 0.2 : 1.4), y + 1.0, 0.2, 0.12, 0.03, 0.04, COL.steel);
    }
  }
  function exitSign(x, y, z, yaw) {
    const F = frame(x, z, yaw);
    F.box(0, y, 0, 0.36, 0.16, 0.06, COL.white);
    F.box(0, y + 0.04, 0.035, 0.26, 0.08, 0.01, hex('#ff3a2e'), MAT.GLOW);
  }

  // ---------- architecture ----------
  // windows along a wall segment; nIn = inward normal
  function windows(x1, z1, x2, z2, nIn, y0, y1, width, spacing, start = 1.5) {
    const len = Math.hypot(x2 - x1, z2 - z1), dx = (x2 - x1) / len, dz = (z2 - z1) / len, yaw = Math.atan2(-dz, dx);
    for (let t = start + width / 2; t <= len - width / 2 - 0.5; t += spacing) {
      const cx = x1 + dx * t + nIn[0] * 0.17, cz = z1 + dz * t + nIn[1] * 0.17;
      G.box(cx, y0, cz, width, (y1 - y0) * 0.55, 0.03, yaw, COL.glassLow, MAT.GLOW);
      G.box(cx, y0 + (y1 - y0) * 0.55, cz, width, (y1 - y0) * 0.45, 0.03, yaw, COL.glassNight, MAT.GLOW);
      const ox = nIn[0] * 0.03, oz = nIn[1] * 0.03;
      G.box(cx + ox, y0 - 0.06, cz + oz, width + 0.16, 0.08, 0.06, yaw, COL.trim);
      G.box(cx + ox, y1, cz + oz, width + 0.16, 0.08, 0.06, yaw, COL.trim);
      for (const s of [-0.5, -1 / 6, 1 / 6, 0.5]) G.box(cx + ox + dx * s * width, y0, cz + oz + dz * s * width, 0.05, y1 - y0, 0.05, yaw, COL.trim);
      for (const f of [1 / 3, 2 / 3]) G.box(cx + ox, y0 + (y1 - y0) * f, cz + oz, width, 0.04, 0.05, yaw, COL.trim);
      if (rnd() < 0.3) G.box(cx - nIn[0] * 0.02 + dx * R(-width / 3, width / 3), y0 + (y1 - y0) * R(0.2, 0.5), cz - nIn[1] * 0.02, 0.07, 0.07, 0.01, yaw, COL.warm, MAT.GLOW);
    }
  }
  function trackLights(x0, x1, z0, z1, y, hole = null, dz = 3.2, dx = 2.2) {
    for (let z = z0 + dz / 2; z < z1; z += dz) {
      const inHole = hole && z > hole[2] && z < hole[3];
      const runs = inHole ? [[x0, hole[0]], [hole[1], x1]] : [[x0, x1]];
      for (const [a, b] of runs) G.box((a + b) / 2, y - 0.04, z, b - a - 0.6, 0.04, 0.05, 0, COL.white);
      for (let x = x0 + 1; x < x1 - 0.6; x += dx) {
        if (inHole && x > hole[0] - 0.3 && x < hole[1] + 0.3) continue;
        G.box(x, y - 0.2, z, 0.1, 0.16, 0.1, 0, COL.white);
        G.box(x, y - 0.22, z, 0.08, 0.02, 0.08, 0, COL.bulb, MAT.GLOW);
      }
    }
  }
  function panelLights(x0, x1, z0, z1, y) {
    for (let z = z0 + 2; z < z1 - 1; z += 4) for (let x = x0 + 2; x < x1 - 1; x += 4) G.box(x, y - 0.02, z, 1.2, 0.02, 0.6, 0, hex('#f4f7f8'), MAT.GLOW);
  }

  // =========================================================
  // LAYOUT v2 — an invented arrangement. It keeps the feel (two floors,
  // open atrium, big staircase, round skylight) but departments, doors,
  // stairs and elevator are all in different places from any real store.
  // =========================================================
  const W = 64, D = 40, Y = F1, ROOF = 9;
  const containers = [];
  function pot(x, y, z) {
    const col = pc(['#d9d2c4', '#b7ab98', '#8b8f8c', '#c9b9a0', '#6f6a62']);
    G.cyl(x, y, z, 0.4, 0.95, col, 0, 14, 0.6);
    G.cyl(x, y + 0.9, z, 0.53, 0.03, hex('#241d18'), 0, 14);
    obbs.push(makeOBB(x, z, 0.55, 0.55, 0, y, y + 0.95));
    containers.push({ x, z, y, f: y > 1 ? 1 : 0, type: 'pot' });
  }
  function hamper(x, y, z) {
    const col = pc(['#c8a777', '#b8925f', '#a98556']);
    G.cyl(x, y, z, 0.46, 0.85, col, 0, 12);
    for (const b of [0.2, 0.45, 0.7]) G.cyl(x, y + b, z, 0.47, 0.04, shade(col, 0.8), 0, 12);
    G.cyl(x, y + 0.85, z, 0.49, 0.07, shade(col, 0.7), 0, 12);
    obbs.push(makeOBB(x, z, 0.48, 0.48, 0, y, y + 0.92));
    containers.push({ x, z, y, f: y > 1 ? 1 : 0, type: 'hamper' });
  }
  function windows(x1, z1, x2, z2, nIn, y0, y1, width, spacing, start = 1.5) {
    const len = Math.hypot(x2 - x1, z2 - z1), dx = (x2 - x1) / len, dz = (z2 - z1) / len, yaw = Math.atan2(-dz, dx);
    for (let t = start + width / 2; t <= len - width / 2 - 0.5; t += spacing) {
      const cx = x1 + dx * t + nIn[0] * 0.17, cz = z1 + dz * t + nIn[1] * 0.17;
      G.box(cx, y0, cz, width, y1 - y0, 0.03, yaw, COL.glassNight, MAT.GLOW);
      const ox = nIn[0] * 0.03, oz = nIn[1] * 0.03;
      G.box(cx + ox, y0 - 0.06, cz + oz, width + 0.16, 0.08, 0.06, yaw, COL.trim);
      G.box(cx + ox, y1, cz + oz, width + 0.16, 0.08, 0.06, yaw, COL.trim);
      for (const q of [-0.5, -1 / 6, 1 / 6, 0.5]) G.box(cx + ox + dx * q * width, y0, cz + oz + dz * q * width, 0.05, y1 - y0, 0.05, yaw, COL.trim);
      for (const f of [1 / 3, 2 / 3]) G.box(cx + ox, y0 + (y1 - y0) * f, cz + oz, width, 0.04, 0.05, yaw, COL.trim);
    }
  }
  function trackLights(x0, x1, z0, z1, y, hole = null, dz = 3.3, dx = 2.3) {
    for (let z = z0 + dz / 2; z < z1; z += dz) {
      const inHole = hole && z > hole[2] && z < hole[3];
      const runs = inHole ? [[x0, hole[0]], [hole[1], x1]] : [[x0, x1]];
      for (const [a, b] of runs) G.box((a + b) / 2, y - 0.04, z, b - a - 0.6, 0.04, 0.05, 0, COL.white);
      for (let x = x0 + 1; x < x1 - 0.6; x += dx) {
        if (inHole && x > hole[0] - 0.3 && x < hole[1] + 0.3) continue;
        G.box(x, y - 0.2, z, 0.1, 0.16, 0.1, 0, COL.white);
        G.box(x, y - 0.22, z, 0.08, 0.02, 0.08, 0, COL.bulb, MAT.GLOW);
      }
    }
  }
  function doorway(cx, cz, yaw, w) { // local +z points into the store
    const F = frame(cx, cz, yaw), dark = hex('#0b101c'), snow = hex('#c9d2dc');
    for (const q of [-1, 1]) F.box(q * (w / 2 + 0.4), 0, 0, 0.8, 4.0, 0.8, COL.brick, MAT.BRICK, { hit: true });
    F.box(0, 3.3, 0, w + 1.6, ROOF - 3.3, 0.3, COL.wall, 0, { hit: true });
    for (const lx of [-w / 2 + 0.04, -0.04, 0.04, w / 2 - 0.04]) F.box(lx, 0, 0, 0.07, 3.3, 0.09, COL.steel);
    F.box(0, 3.2, 0, w, 0.1, 0.1, COL.steel);
    for (const q of [-1, 1]) F.box(q * 0.22, 0.9, 0.07, 0.04, 1.3, 0.04, COL.steel);
    F.hit(0, 0, w, 0.16, 0, 3.3, false, true);
    F.box(0, -0.1, -1.8, w + 0.4, 0.1, 3.4, snow);
    F.box(0, 0, -3.5, w + 0.8, 4, 0.2, dark, MAT.GLOW);
    for (const q of [-1, 1]) F.box(q * (w / 2 + 0.1), 0, -2.0, 0.2, 4, 3.0, dark, MAT.GLOW);
    F.box(0, 3.4, -2.0, w + 0.8, 0.2, 3.2, dark, MAT.GLOW);
    for (let i = 0; i < 14; i++) F.box(R(-w / 2, w / 2), R(0.3, 3.0), R(-3.2, -1.2), 0.04, 0.04, 0.04, hex('#e8eef5'), MAT.GLOW);
    { const [ex, ez] = F.w(0, 0.3); exitSign(ex, 3.45, ez, yaw); }
    { const [mx, mz] = F.w(0, 1.3); G.box(mx, 0.002, mz, w + 0.4, 0.012, 1.6, yaw, hex('#2c2c2e'), MAT.CARPET); }
    const [ex, ez] = F.w(0.6, -1.0), [ix, iz] = F.w(0, 1.1);
    return { x: ix, z: iz, ex, ez };
  }

  // ---- floors / slabs / roof ----
  G.box(W / 2, -0.1, D / 2, W, 0.1, D, 0, COL.concrete, MAT.CONCRETE);
  G.box(11, -0.08, 27, 22, 0.083, 26, 0, COL.hardwood, MAT.WOOD);
  G.box(32, -0.08, 34.5, 16, 0.083, 11, 0, COL.tile, MAT.TILE);
  const slabs = [[0, 64, 0, 12], [0, 24, 12, 28], [40, 64, 12, 28], [0, 64, 28, 40]];
  for (const [x0, x1, z0, z1] of slabs) {
    G.box((x0 + x1) / 2, F1 - 0.05, (z0 + z1) / 2, x1 - x0, 0.05, z1 - z0, 0, COL.upWood, MAT.WOOD);
    G.box((x0 + x1) / 2, F1 - 0.4, (z0 + z1) / 2, x1 - x0, 0.35, z1 - z0, 0, COL.ceilWood, MAT.PLANK);
    obbs.push(makeOBB((x0 + x1) / 2, (z0 + z1) / 2, (x1 - x0) / 2, (z1 - z0) / 2, 0, F1 - 0.4, F1, true, false));
  }
  G.box(W / 2, ROOF, D / 2, W, 0.3, D, 0, COL.ceil, MAT.PLANK);
  // round skylight over the atrium — smashed
  G.cyl(32, ROOF - 0.04, 20, 4.6, 0.04, COL.trim, 0, 28);
  G.cyl(32, ROOF - 0.07, 20, 4.2, 0.04, hex('#16223a'), MAT.GLOW, 28);
  for (let i = 0; i < 4; i++) G.box(32, ROOF - 0.1, 20, 8.4, 0.04, 0.07, i * Math.PI / 4, COL.trim);
  G.cyl(32.4, ROOF - 0.13, 19.6, 2.3, 0.04, hex('#04060c'), MAT.GLOW, 7);
  trackLights(0.5, 63.5, 0, 40, F1 - 0.4, [24, 40, 12, 28]);
  trackLights(0.5, 63.5, 0, 40, ROOF, [26.5, 37.5, 14.5, 25.5]);

  // ---- outer walls, doors ----
  wall(0, 0, 29.2, 0, 0, ROOF, COL.wall);
  wall(34.8, 0, 64, 0, 0, ROOF, COL.wall);
  wall(0, 40, 64, 40, 0, ROOF, COL.ship, MAT.SHIPLAP);
  wall(0, 0, 0, 40, 0, ROOF, COL.wall);
  wall(64, 0, 64, 28.2, 0, ROOF, COL.wall);
  wall(64, 31.8, 64, 40, 0, ROOF, COL.wall);
  const frontDoor = doorway(32, 0, 0, 4);
  const sideDoor = doorway(64, 30, -Math.PI / 2, 2);
  windows(0, 0, 29, 0, [0, 1], 0.9, 3.6, 2.2, 4.6, 1.2);
  windows(35, 0, 64, 0, [0, 1], 0.9, 3.6, 2.2, 4.6, 1.6);
  windows(0, 0, 64, 0, [0, 1], 5.4, 8.2, 2.2, 4.6, 1.2);
  windows(0, 0, 0, 40, [1, 0], 5.4, 8.2, 1.8, 4.4, 1.5);
  windows(64, 0, 64, 28, [-1, 0], 0.9, 3.6, 1.8, 4.4, 1.5);
  windows(64, 0, 64, 40, [-1, 0], 5.4, 8.2, 1.8, 4.4, 1.5);
  windows(0, 40, 64, 40, [0, -1], 5.6, 8.2, 1.8, 7.5, 16);

  for (const [cx, cz] of [[23.6, 11.6], [40.4, 11.6], [23.6, 28.4], [40.4, 28.4], [12, 8], [12, 20], [12, 32], [52, 8], [52, 20], [52, 30]]) column(cx, cz, 0, ROOF);

  // ---- elevator (doors stay shut) ----
  solid(46, 0, 33.5, 4, ROOF, 3.6, 0, COL.ship, MAT.SHIPLAP);
  for (const fy of [0, F1]) {
    G.box(46, fy, 31.67, 1.4, 2.3, 0.06, 0, COL.white);
    G.box(46, fy, 31.63, 0.02, 2.3, 0.02, 0, shade(COL.white, 0.8));
    G.box(47.1, fy + 1.1, 31.65, 0.08, 0.2, 0.03, 0, COL.steel);
  }

  // ---- the big staircase (west side of the atrium, climbs toward the front) ----
  const S1 = { x0: 24.2, x1: 26.2, zBot: 26, zTop: 12 };
  { const n = 15, dz = (S1.zBot - S1.zTop) / n;
    for (let k = 0; k < n; k++) {
      const zc = S1.zBot - (k + 0.5) * dz, top = (k + 0.5) * 0.3;
      G.box(25.2, 0, zc, 2.0, top - 0.05, dz, 0, COL.white);
      G.box(25.2, top - 0.05, zc, 2.0, 0.06, dz + 0.04, 0, COL.woodLight, MAT.WOOD);
    }
    for (let q = 0; q < 4; q++) {
      const za = S1.zBot - q * 3.5, zb = za - 3.5, yTop = ((S1.zBot - zb) / 14) * F1 + 1.0;
      for (const xx of [S1.x0 - 0.07, S1.x1 + 0.07]) {
        solid(xx, 0, (za + zb) / 2, 0.12, yTop - 0.9, 3.5, 0, COL.white);
        solid(xx, yTop - 0.9, (za + zb) / 2, 0.06, 0.9, 3.5, 0, COL.trim, 0, { opaque: false });
        G.box(xx, yTop - 0.05, (za + zb) / 2, 0.1, 0.06, 3.5, 0, COL.trim);
      }
    }
    solid(25.2, 0, 11.95, 2.3, F1 - 0.4, 0.2, 0, COL.white);
  }

  // =========================================================
  // GROUND FLOOR
  // =========================================================
  // atrium: tree, ornament shop (where he came down)
  tree(33, 0, 20, 6.2, 1.9);
  { const F = frame(36.5, 15.2, 0.2);
    F.box(0, 0, 0, 2.6, 1.0, 1.2, COL.white);
    for (let i = 0; i < 18; i++) F.sphere(R(-1.1, 1.1), 1.08, R(-0.45, 0.45), 0.09, pc(['#b3262f', '#e8e2d6', '#c9a24b', '#1f3b6b', '#2f5a3f']), 0, 6);
    F.box(0, 1.0, -0.5, 2.6, 1.0, 0.06, COL.white);
    F.hit(0, 0, 2.6, 1.2, 0, 2.0); }
  { // the smashed one
    solid(30.2, 0, 23.3, 2.6, 0.5, 1.2, 0.5, COL.white);
    G.box(31.2, 0.5, 23.0, 2.4, 0.06, 1.0, 0.9, COL.white);
    for (let i = 0; i < 46; i++) { const a = R(0, TAU), r = R(0.3, 4.2); G.sphere(31 + Math.cos(a) * r, 0.07, 22.5 + Math.sin(a) * r * 0.8, R(0.05, 0.09), pc(['#b3262f', '#e8e2d6', '#c9a24b', '#1f3b6b', '#2f5a3f', '#dfe8ee']), 0, 5); }
    for (let i = 0; i < 40; i++) { const a = R(0, TAU), r = R(0.2, 5); G.box(32 + Math.cos(a) * r, 0.005, 20.5 + Math.sin(a) * r, R(0.08, 0.3), 0.012, R(0.05, 0.2), R(0, 3), hex('#cfe0ea'), MAT.GLOW); }
  }
  displayTable(29.5, 0, 15, 0, 2.4, 1.0, 0.86, COL.white, 'gifts');
  displayTable(37.5, 0, 25, 0, 2.4, 1.0, 0.86, COL.white, 'vases');
  for (let i = 0; i < 5; i++) pendant(28.5 + i * 2, ROOF, 13.2, 6.4 + (i % 2) * 0.3, 0.2);

  // front: registers and gifts (west of the doors)
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

  // west: kitchen department
  shelfWall(0.55, 0, 20.5, Math.PI / 2, 10, 'cook', 2.4, 0.45, COL.woodLight);
  shelfWall(0.55, 0, 33, Math.PI / 2, 12, 'appl', 2.4, 0.45, COL.woodLight);
  shelfWall(11.5, 0, 39.45, Math.PI, 17, 'cook', 2.4, 0.45, COL.woodLight);
  counter(11, 0, 17, 0, 7, 1.2, 1.05, 3);
  for (const tx of [7, 15.5]) {
    const F = frame(tx, 24, 0);
    F.box(0, 0, 0, 3.4, 0.92, 0.9, COL.woodLight);
    F.box(0, 0.25, 0, 3.3, 0.03, 0.8, COL.white);
    for (let i = 0; i < 5; i++) { const [mx, mz] = F.w(-1.3 + i * 0.65, 0); mixer(mx, 0.92, mz, pc(['#2b2b2b', '#e9e6df', '#8aa4b8', '#3d5a4e', '#9b2f2f', '#d7d9db'])); }
    F.hit(0, 0, 3.4, 0.9, 0, 0.92);
  }
  { const F = frame(11, 30, 0);
    F.box(0, 0, 0, 2.4, 0.86, 1.1, COL.black); F.box(0, 0.86, 0, 2.5, 0.06, 1.2, COL.marble);
    items(F, -1.1, 1.1, 0.92, 0, 0.9, 'cook', 0.3); F.hit(0, 0, 2.5, 1.2, 0, 0.92); }
  gondola(19.5, 0, 21, Math.PI / 2, 5, 'cook', 1.6);
  gondola(5, 0, 35, 0, 4.2, 'appl', 1.6);
  gondola(17, 0, 35, 0, 4.2, 'cook', 1.6);
  gondola(20.5, 0, 30, Math.PI / 2, 4, 'appl', 1.6);
  barrel(3, 0, 27); barrel(14, 0, 27.5); barrel(8.5, 0, 31.5);
  for (const [px, pz] of [[7, 24], [15.5, 24]]) pendant(px, F1 - 0.4, pz, 2.7, 0.22, hex('#fbf6ea'));

  // north: glassware and dinnerware
  shelfWall(33, 0, 39.45, Math.PI, 17, 'glass', 2.4, 0.42, COL.white);
  gondola(28, 0, 34, Math.PI / 2, 4.6, 'glass', 1.5);
  gondola(33, 0, 34, Math.PI / 2, 4.6, 'plates', 1.5);
  gondola(38, 0, 34, Math.PI / 2, 4.6, 'plates', 1.5);
  roundTable(42, 0, 30.2, 0.75, 0.76, hex('#6b4a33'), hex('#6b4a33'), 'plates');

  // east: dining tables
  diningSet(46, 0, 17.5, 0, 2.4, 1.0, COL.woodLight, COL.woodMid, hex('#9b9488'), false);
  diningSet(55, 0, 17, 0, 2.6, 1.0, COL.marble, COL.olive, COL.red, true);
  diningSet(60, 0, 23.5, Math.PI / 2, 2.2, 1.0, COL.woodDark, COL.woodLight, null, false);
  diningSet(46.5, 0, 24.5, 0, 2.2, 1.0, COL.woodMid, COL.cream, null, true);
  diningSet(53.5, 0, 25, 0, 2.0, 1.0, COL.woodLight, COL.black, hex('#b9b2a5'), false);
  for (const [px, pz] of [[46, 17.5], [55, 17]]) wovenPendant(px, F1 - 0.4, pz, 3.0, 0.38);

  // south-east and north-east: the downstairs furniture corner
  livingSet(46, 0, 4.8, 0, COL.cream, COL.tan, hex('#cfc6b7'), true);
  livingSet(53.2, 0, 4.8, 0, COL.navy, COL.cream, hex('#8a8e8c'), false);
  livingSet(60, 0, 4.8, 0, COL.tan, COL.cream, hex('#d8cfbf'), false);
  livingSet(49.5, 0, 10.9, Math.PI, COL.sage, COL.cream, hex('#c2b8a6'), false);
  livingSet(58, 0, 10.9, Math.PI, COL.cream, COL.rust, hex('#b9b2a5'), true);
  livingSet(56, 0, 35.4, Math.PI, COL.cream, COL.navy, hex('#cfc6b7'), false);
  shelfWall(56, 0, 39.45, Math.PI, 12, 'pillows', 2.1, 0.45, COL.white);
  floorLamp(50.5, 0, 37.5); floorLamp(62.4, 0, 14);
  pot(62.3, 0, 26.6); hamper(22.2, 0, 37.6); pot(42.2, 0, 37.8); pot(1.6, 0, 14.6);

  // =========================================================
  // UPSTAIRS
  // =========================================================
  function rail(x1, z1, x2, z2) {
    const len = Math.hypot(x2 - x1, z2 - z1), yaw = Math.atan2(-(z2 - z1), x2 - x1);
    const cx = (x1 + x2) / 2, cz = (z1 + z2) / 2;
    G.box(cx, Y + 1.0, cz, len, 0.06, 0.08, yaw, COL.trim);
    for (let k = 1; k <= 7; k++) G.box(cx, Y + k * 0.13, cz, len, 0.015, 0.015, yaw, COL.trim);
    const n = Math.ceil(len / 1.6);
    for (let i = 0; i <= n; i++) G.box(x1 + (x2 - x1) * i / n, Y, z1 + (z2 - z1) * i / n, 0.06, 1.0, 0.06, 0, COL.trim);
    G.box(cx, Y - 0.4, cz, len, 0.4, 0.12, yaw, COL.white);
    obbs.push(makeOBB(cx, cz, len / 2, 0.06, yaw, Y - 0.4, Y + 1.05, false, true));
  }
  rail(26.4, 12, 40, 12); rail(40, 12, 40, 28); rail(24, 28, 40, 28); rail(24, 12.3, 24, 28);

  // west: living rooms
  livingSet(5, Y, 4.8, 0, COL.cream, COL.cream, hex('#d8cfbf'), true);
  livingSet(12.4, Y, 4.8, 0, COL.tan, COL.cream, hex('#cfc6b7'), false);
  livingSet(19.5, Y, 4.8, 0, COL.cream, COL.sage, hex('#bdb5a7'), false);
  livingSet(8, Y, 10.9, Math.PI, COL.navy, COL.cream, hex('#a9a69f'), false);
  livingSet(17.5, Y, 10.9, Math.PI, COL.cream, COL.tan, hex('#d0c7b8'), true);
  livingSet(17, Y, 17.5, Math.PI / 2, COL.olive, COL.cream, hex('#bdb5a7'), false);
  livingSet(17.5, Y, 24.4, 0, hex('#d9c7a8'), COL.cream, hex('#cfc6b7'), false);
  // the rug wall
  for (let i = 0; i < 8; i++) G.box(0.22, Y + 0.5, 14.8 + i * 1.65, 0.06, 2.7, 1.5, 0, pc(['#8a3b35', '#3c4a57', '#b7a58d', '#6f7556', '#c9c2b6', '#5a3d2b', '#a35d45']), MAT.CARPET);
  for (let i = 0; i < 17; i++) G.cyl(5, Y, 16 + i * 0.5, 0.21, 2.2 + (i % 3) * 0.12, pc(['#8a3b35', '#3c4a57', '#b7a58d', '#6f7556', '#c9c2b6', '#a35d45', '#d8cfbf']), MAT.CARPET, 8);
  obbs.push(makeOBB(5, 20, 0.26, 4.3, 0, Y, Y + 2.2));
  rug(9, Y, 20, 4, 6, 0, hex('#8a3b35')); rug(9.3, Y + 0.012, 20.4, 3, 4.5, 0.15, hex('#3c4a57'));
  pot(1.7, Y, 26.3); hamper(2.4, Y, 13.4);

  // north-west: bath corner — towels, big planters, hampers
  shelfWall(6.5, Y, 39.45, Math.PI, 11, 'pillows', 2.3, 0.45, COL.white);
  shelfWall(0.55, Y, 34.2, Math.PI / 2, 8, 'vases', 2.3, 0.42, COL.white);
  pot(3, Y, 31.2); pot(5.6, Y, 33.6); hamper(8.6, Y, 31.6); hamper(10.8, Y, 34.8); pot(12.6, Y, 37.6); hamper(3, Y, 37.3); pot(7.6, Y, 36.8);
  plant(13.8, Y, 31, 1.7); plant(1.6, Y, 29.4, 1.5);
  gondola(11.5, Y, 29.4, 0, 3.6, 'pillows', 1.4);

  // north: beds
  for (const [bx, col] of [[19.5, hex('#d9d4c9')], [25.5, hex('#8e9a86')], [31.5, hex('#5b6b7d')], [37.5, hex('#c9b8a3')]]) bed(bx, Y, 38.35, Math.PI, col);
  rug(28.5, Y, 35.4, 22, 3.2, 0, hex('#d6cfc2'));

  // north-east: clearance, tucked behind the elevator
  for (const [sx, sz] of [[49.6, 30.6], [62, 30.2]]) { G.box(sx, Y, sz, 0.05, 1.5, 0.05, 0, COL.black); G.box(sx, Y + 1.1, sz, 0.9, 0.5, 0.04, 0, COL.red); }
  sofa(54.5, Y, 32.6, 0.35, 2.2, COL.tan);
  gondola(58, Y, 38.6, 0, 5, 'mixed', 1.5);
  displayTable(51, Y, 35.2, Math.PI / 2, 2.4, 1.0, 0.85, COL.white, 'mixed');
  boxPile(61, Y, 35.6, 4, 0.9);
  swivel(57.5, Y, 34.6, 2.2, COL.rust); chair(50, Y, 38.6, 0.4, COL.woodDark, false); chair(50.9, Y, 38.9, -0.3, COL.woodDark, false);
  hamper(52.4, Y, 38.6); pot(56.3, Y, 36.4); hamper(62.2, Y, 32.6);

  // east: lighting
  for (const cx of [45.5, 51, 57]) for (const cz of [15.5, 20, 24.5]) {
    solid(cx, Y, cz, 1.9, 0.8, 0.5, 0, COL.woodMid);
    tableLamp(cx - 0.5, Y + 0.8, cz); tableLamp(cx + 0.5, Y + 0.8, cz, COL.white);
  }
  for (const [lx, lz] of [[48.3, 17.8], [54, 22.3], [60.5, 17], [60.5, 25]]) floorLamp(lx, Y, lz);
  shelfWall(63.45, Y, 20, -Math.PI / 2, 12, 'vases', 2.3, 0.42, COL.white);
  for (let i = 0; i < 5; i++) pendant(45 + i * 3.6, ROOF, 20 + (i % 2) * 2, 7.2 + (i % 3) * 0.3, 0.2);
  for (let i = 0; i < 6; i++) {
    const sx = 41.4, sz = 13.4 + i * 2.5;
    G.cyl(sx, Y, sz, 0.18, 0.04, COL.black, 0, 8); G.cyl(sx, Y, sz, 0.03, 0.7, COL.black, 0, 6);
    G.box(sx, Y + 0.7, sz, 0.42, 0.08, 0.42, 0, pc(['#c49a6c', '#ece6da', '#2b2b2b', '#a87b4f']));
    obbs.push(makeOBB(sx, sz, 0.22, 0.22, 0, Y, Y + 1.0, false));
  }

  // south: dining, design desk, register
  diningSet(31, Y, 4.6, 0, 2.6, 1.0, COL.woodLight, COL.black, hex('#9b9488'), false);
  diningSet(38.5, Y, 5.2, 0, 2.2, 1.0, COL.woodMid, COL.cream, null, true);
  diningSet(34.5, Y, 9.6, 0, 2.0, 1.0, COL.woodDark, COL.woodLight, null, false);
  counter(45.5, Y, 9.8, Math.PI, 4.2, 0.9, 1.05, 2);
  { const F = frame(47, 4.2, 0);
    F.box(0, Y + 0.72, 0, 5.2, 0.06, 1.1, COL.woodLight);
    for (const ex of [-2.5, 2.5]) F.box(ex, Y, 0, 0.12, 0.72, 1.0, COL.woodLight);
    for (const ex of [-1.6, 0, 1.6]) { F.box(ex, Y + 0.78, -0.3, 0.12, 0.1, 0.12, COL.steel); F.box(ex, Y + 0.88, -0.32, 0.62, 0.42, 0.03, COL.steel); F.box(ex, Y + 0.93, -0.30, 0.56, 0.32, 0.01, hex('#202428'), MAT.GLOW); }
    F.hit(0, 0, 5.2, 1.1, Y + 0.68, Y + 0.78); F.hit(0, 0, 5.1, 1.0, Y, Y + 0.78, false);
    for (const ex of [-1.6, 0, 1.6]) { const [cx, cz] = F.w(ex, 0.85); chair(cx, Y, cz, Math.PI, COL.woodLight, true); } }
  livingSet(56, Y, 4.8, 0, COL.cream, COL.tan, hex('#d8cfbf'), true);
  livingSet(58.5, Y, 10.6, Math.PI, COL.sage, COL.cream, hex('#bdb5a7'), false);
  tree(42.6, Y, 30, 2.6, 0.8); tree(22.4, Y, 29.6, 2.6, 0.8);
  for (const [px, pz] of [[12.4, 7.5], [31, 4.6], [56, 8]]) wovenPendant(px, ROOF, pz, 7.6, 0.45);

  // =========================================================
  // game data
  // =========================================================
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
  return {
    geo: G, obbs, surfaces, ramps, stairs, polys: [rect, rect], zones, F1, width: W, depth: D, containers,
    doors: { front: frontDoor, side: sideDoor },
    clueSpots: [[0, 10, 26.5], [0, 57, 8], [0, 50, 21], [0, 31, 36.8], [0, 12, 7], [0, 61, 37.6], [0, 4, 37.4],
      [1, 28, 8.5], [1, 50, 13.6], [1, 60.5, 27], [1, 13, 27], [1, 22.5, 34.5], [1, 43, 37.5], [1, 9, 8]],
    keySpots: [[0, 11, 17, 1.08], [0, 25.5, 5, 1.08], [1, 45.5, 9.8, 1.08]],
    trapSpots: [[0, 31, 11, 'z', 2.6], [0, 41.3, 20, 'x', 2.4], [0, 33, 29, 'z', 2.4], [0, 25.2, 27.4, 'x', 2.0], [0, 44, 13.2, 'z', 2.4], [0, 22.8, 14, 'z', 2.6],
      [1, 25.2, 10.7, 'x', 2.0], [1, 41.6, 29.2, 'z', 2.2], [1, 15, 29.2, 'z', 2.2], [1, 49.4, 31.2, 'x', 2.4], [1, 22.4, 20, 'x', 2.6], [1, 42.4, 11.2, 'z', 2.2], [1, 30, 29.6, 'z', 2.2]],
    playerSpawn: [36, 0, 27, 0.35],
  };
}
