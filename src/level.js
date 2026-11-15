// ============================================================
// BOX — the store. Two sales floors plus back rooms.
// Units are meters. x runs west→east (0..70), z runs south→north (0..48).
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

  // ---- floors / slabs / ceilings ----
  G.box(35, -0.1, 24, 70, 0.1, 48, 0, COL.concrete, MAT.CONCRETE);
  G.box(52, -0.08, 24, 20, 0.083, 16, 0, COL.hardwood, MAT.WOOD);            // kitchen hardwood
  G.box(57, -0.08, 8, 10, 0.083, 16, 0, COL.tile, MAT.TILE);                 // glassware tile
  G.box(38, -0.08, 40, 28, 0.083, 16, 0, COL.vinyl, MAT.TILE);               // back of house
  G.box(66, -0.08, 6, 8, 0.083, 12, 0, hex('#3b3633'), MAT.CONCRETE);        // closed café
  rug(27.5, 0, 4.5, 6, 3.5, 0, hex('#c9c3b8'));

  const slabs = [[0, 62, 0, 8], [0, 24, 8, 24], [40, 62, 8, 24], [0, 62, 24, 32], [28, 52, 32, 48], [24, 28, 32, 34], [24, 28, 43, 48]];
  for (const [x0, x1, z0, z1] of slabs) {
    const back = z0 >= 32;
    G.box((x0 + x1) / 2, F1 - 0.05, (z0 + z1) / 2, x1 - x0, 0.05, z1 - z0, 0, back ? hex('#cfc8bb') : COL.upWood, back ? MAT.TILE : MAT.WOOD);
    G.box((x0 + x1) / 2, F1 - 0.4, (z0 + z1) / 2, x1 - x0, 0.35, z1 - z0, 0, back ? hex('#e8e6e1') : COL.ceilWood, back ? MAT.TILE : MAT.PLANK);
    obbs.push(makeOBB((x0 + x1) / 2, (z0 + z1) / 2, (x1 - x0) / 2, (z1 - z0) / 2, 0, F1 - 0.4, F1, true, false));
  }
  G.box(31, 9, 16, 62, 0.3, 32, 0, COL.ceil, MAT.PLANK);          // upstairs ceiling
  G.box(38, 7.5, 40, 28, 0.2, 16, 0, hex('#e8e6e1'), MAT.TILE);    // back office drop ceiling
  G.box(66, 4.4, 16, 8, 0.2, 32, 0, COL.ceilWood, MAT.PLANK);     // single-story entrance/café
  G.box(60, 4.4, 36, 16, 0.2, 8, 0, COL.ceilWood, MAT.PLANK);     // coffee corner
  trackLights(0.5, 61.5, 0, 32, F1 - 0.4, [24, 40, 8, 24]);
  trackLights(62.2, 69.8, 12, 32, 4.4);
  trackLights(52.2, 67.8, 32, 40, 4.4);
  trackLights(0.5, 61.5, 0, 32, 9);
  panelLights(28, 52, 32, 48, F1 - 0.4);
  panelLights(28, 52, 32, 48, 7.5);

  // ---- exterior walls ----
  wall(0, 0, 62, 0, 0, 9, COL.wall);
  wall(62, 0, 70, 0, 0, 4.5, COL.wall);
  wall(70, 0, 70, 32, 0, 4.5, COL.wall);
  wall(62, 0, 62, 32, F1, 9, COL.wall);
  wall(68, 32, 70, 32, 0, 4.5, COL.wall);
  wall(68, 32, 68, 40, 0, 4.5, COL.wall);
  wall(52, 40, 68, 40, 0, 4.5, COL.wall);
  wall(52, 32, 52, 48, 0, 9, COL.backWall);
  wall(52, 32, 62, 32, F1, 9, COL.wall);
  wall(24, 48, 52, 48, 0, 9, COL.backWall);
  wall(24, 32, 24, 48, 0, 9, COL.backWall);
  wall(0, 14, 24, 32, 0, 9, COL.ship, MAT.SHIPLAP);
  wall(0, 0, 0, 14, 0, 9, COL.ship, MAT.SHIPLAP);
  windows(0, 0, 62, 0, [0, 1], 0.9, 3.6, 2.2, 4.4, 1.0);
  windows(0, 0, 62, 0, [0, 1], 5.4, 8.2, 2.2, 4.4, 1.0);
  windows(0, 14, 24, 32, [0.6, -0.8], 5.4, 8.2, 1.8, 4.0, 2.0);
  windows(0, 14, 24, 32, [0.6, -0.8], 0.9, 3.6, 1.8, 6.0, 4.0);
  windows(0, 0, 0, 14, [1, 0], 5.4, 8.2, 1.8, 4.5, 1.5);
  windows(70, 0, 70, 12, [-1, 0], 0.9, 3.4, 1.8, 5, 2.5);
  windows(70, 25, 70, 32, [-1, 0], 0.9, 3.4, 1.8, 4, 1.2);
  windows(62, 0, 62, 32, [-1, 0], 5.4, 8.2, 1.8, 4.6, 1.5);
  windows(52, 40, 68, 40, [0, -1], 1.2, 3.4, 1.4, 20, 6.5);
  windows(52, 32, 62, 32, [0, -1], 5.4, 8.2, 1.8, 4.6, 1.0);

  // main entrance (east wall): glass doors between brick pillars — locked for the game
  for (const zz of [19.6, 24.4]) solid(69.6, 0, zz, 0.8, 4.0, 0.8, 0, COL.brick, MAT.BRICK);
  G.box(69.82, 0, 22, 0.04, 3.2, 4.0, 0, COL.glassNight, MAT.GLOW);
  for (const zz of [20.05, 21.9, 22.1, 23.95]) G.box(69.78, 0, zz, 0.06, 3.2, 0.08, 0, COL.steel);
  G.box(69.78, 3.2, 22, 0.08, 0.1, 4.0, 0, COL.steel);
  for (const zz of [21.75, 22.25]) G.box(69.72, 0.9, zz, 0.04, 1.4, 0.04, 0, COL.steel);
  rug(68.6, 0, 22, 1.6, 4.2, 0, hex('#2c2c2e'));
  exitSign(69.75, 3.6, 22, -Math.PI / 2);

  // ---- closed café (behind a rolling grille) ----
  wall(62, 12, 70, 12, 0, 4.4, COL.wall);
  wall(62, 0, 62, 3, 0, 4.4, COL.wall, 0, 0.3, { noExtend: true });
  wall(62, 9, 62, 12, 0, 4.4, COL.wall, 0, 0.3, { noExtend: true });
  for (let zz = 3.05; zz < 9; zz += 0.16) G.box(62, 0, zz, 0.04, 3.2, 0.03, 0, COL.trim);
  for (let y = 0.2; y < 3.2; y += 0.42) G.box(62, y, 6, 0.05, 0.03, 6, 0, COL.trim);
  wall(62, 3, 62, 9, 0, 3.3, COL.trim, 0, 0.1, { noExtend: true, opaque: false });
  G.box(62, 3.2, 6, 0.3, 1.2, 6, 0, COL.wall);
  counter(67.5, 0, 7.5, Math.PI / 2, 5, 1.0, 1.05, 0);
  for (const [tx, tz] of [[64, 2.5], [64, 5.5], [66, 3]]) roundTable(tx, 0, tz, 0.4, 0.75, COL.white, COL.white);
  G.box(69.8, 2.0, 7.5, 0.05, 0.9, 3, 0, hex('#5a1e1e'), MAT.GLOW);

  // ---- columns (both floors) ----
  for (const [cx, cz] of [[24, 8], [40, 8], [24, 24], [40, 24], [12, 10], [14, 22], [50, 10], [56, 16.5], [48, 30]]) column(cx, cz, 0, 9);

  // ---- elevator (both floors, doors closed) ----
  solid(26, 0, 29.5, 4, 9, 4, 0, COL.ship, MAT.SHIPLAP);
  for (const fy of [0, F1]) {
    G.box(26, fy, 27.47, 1.4, 2.3, 0.06, 0, COL.white);
    G.box(26, fy, 27.43, 0.02, 2.3, 0.02, 0, shade(COL.white, 0.8));
    G.box(27.1, fy + 1.1, 27.45, 0.08, 0.2, 0.03, 0, COL.steel);
  }

  // =========================================================
  // GROUND FLOOR
  // =========================================================
  // ---- atrium staircase (rises east, x 28 → 40) ----
  const S1 = { x0: 28, x1: 40, z0: 21.5, z1: 23.5 };
  for (let k = 0; k < 15; k++) {
    const xa = S1.x0 + k * 0.8, top = (k + 0.5) * 0.3;
    G.box(xa + 0.4, 0, 22.5, 0.8, top - 0.05, 2.0, 0, COL.white);
    G.box(xa + 0.4, top - 0.05, 22.5, 0.84, 0.06, 2.0, 0, COL.woodLight, MAT.WOOD);
  }
  for (let q = 0; q < 4; q++) {
    const xa = S1.x0 + q * 3, xb = xa + 3, yTop = ((xb - S1.x0) / 12) * F1 + 1.0;
    for (const zz of [S1.z0 - 0.06, S1.z1 + 0.06]) {
      solid((xa + xb) / 2, 0, zz, 3, yTop - 0.9, 0.12, 0, COL.white);
      solid((xa + xb) / 2, yTop - 0.9, zz, 3, 0.9, 0.06, 0, COL.trim, 0, { opaque: false });
      G.box((xa + xb) / 2, yTop - 0.05, zz, 3, 0.06, 0.1, 0, COL.trim);
    }
  }
  solid(40, 0, 22.5, 0.2, F1 - 0.4, 2.2, 0, COL.white);

  // ---- atrium (under the opening) ----
  tree(32, 0, 15, 6.2, 1.9);
  displayTable(27, 0, 11, 0, 2.6, 1.0, 0.86, COL.white, 'gifts');
  displayTable(37, 0, 11, 0, 2.6, 1.0, 0.86, COL.white, 'gifts');
  displayTable(27, 0, 18.5, 0, 2.6, 1.0, 0.86, COL.white, 'vases');
  displayTable(37, 0, 18.5, 0, 2.6, 1.0, 0.86, COL.white, 'gifts');
  for (let i = 0; i < 5; i++) pendant(28 + i * 2, 9, 21, 6.4 + (i % 2) * 0.3, 0.2);
  pendant(31, 9, 9.5, 6.8, 0.25); pendant(33, 9, 9.5, 6.5, 0.22);

  // ---- front center: dining displays ----
  diningSet(27.5, 0, 4.5, 0, 3.2, 1.0, COL.woodLight, COL.woodMid, null, false);
  diningSet(35, 0, 4.5, 0, 2.2, 1.1, COL.marble, COL.olive, COL.red, true);
  for (const [px, pz] of [[26.5, 4.5], [28.5, 4.5]]) wovenPendant(px, F1 - 0.4, pz, 3.0, 0.38);
  counter(38.6, 0, 1.2, 0, 2.2, 0.55, 0.9, 0);

  // ---- west: living rooms along the windows ----
  livingSet(5, 0, 5, 0, COL.cream, COL.tan, hex('#cfc6b7'), true);
  livingSet(12.5, 0, 5, 0, COL.navy, COL.cream, hex('#8a8e8c'), false);
  livingSet(19.6, 0, 5, 0, COL.tan, COL.cream, hex('#d8cfbf'), false);
  livingSet(7, 0, 11.2, Math.PI, COL.sage, COL.cream, hex('#c2b8a6'), false);
  livingSet(18, 0, 11, Math.PI, COL.cream, COL.rust, hex('#b9b2a5'), true);
  diningSet(10, 0, 17.3, 0, 2.4, 1.0, COL.woodMid, COL.black, hex('#9b9488'), false);
  diningSet(18.5, 0, 22.5, 0, 2.4, 1.0, COL.woodLight, COL.cream, null, true);
  diningSet(20.5, 0, 17.3, 0, 2.0, 1.0, COL.woodDark, COL.woodLight, null, false);
  // pillows + throws shelving along the angled wall
  for (let t = 4; t < 26; t += 5.2) {
    const x = 0 + 0.8 * t + 0.6 * 0.4, z = 14 + 0.6 * t - 0.8 * 0.4;
    shelfWall(x, 0, z, Math.atan2(-0.6, 0.8) + Math.PI, 4.4, 'pillows', 2.1, 0.45, COL.white);
  }
  for (const [lx, lz] of [[3, 13.2], [14.5, 14.5], [22.5, 14.2]]) floorLamp(lx, 0, lz);
  // hearth display by the elevator
  solid(32.5, 0, 31.35, 3.2, 2.6, 0.6, 0, COL.stone, MAT.BRICK);
  G.box(32.5, 0.25, 31.0, 1.4, 0.9, 0.05, 0, hex('#2a1a12'));
  G.box(32.5, 0.3, 30.99, 1.1, 0.4, 0.04, 0, hex('#ff8a3a'), MAT.GLOW);
  G.box(32.5, 1.6, 31.0, 3.4, 0.1, 0.75, 0, COL.woodMid);
  livingSet(32.5, 0, 27.9, Math.PI, COL.cream, COL.navy, hex('#cfc6b7'), false);
  diningSet(37.7, 0, 27.3, Math.PI / 2, 2.0, 1.0, COL.woodMid, COL.cream, null, true);
  tree(22.6, 0, 26, 2.4, 0.8);

  // ---- ornament shop (front, east of center) ----
  for (const ox of [42.5, 46]) {
    const F = frame(ox, 3.6, 0);
    F.box(0, 0, 0, 2.6, 1.0, 1.2, COL.white);
    for (let i = 0; i < 18; i++) F.sphere(R(-1.1, 1.1), 1.08, R(-0.45, 0.45), 0.09, pc(['#b3262f', '#e8e2d6', '#c9a24b', '#1f3b6b', '#2f5a3f', '#f2f0ea']), 0, 6);
    F.box(0, 1.0, -0.5, 2.6, 1.0, 0.06, COL.white);
    F.box(-0.6, 2.0, -0.5, 1.5, 0.06, 0.07, COL.white, 0, { yaw: 0.6 });
    F.box(0.6, 2.0, -0.5, 1.5, 0.06, 0.07, COL.white, 0, { yaw: -0.6 });
    for (let i = 0; i < 9; i++) F.box(-1.1 + i * 0.27, 1.25 + R(0, 0.5), -0.44, 0.06, 0.24, 0.04, pc(PAL.gifts));
    F.hit(0, 0, 2.6, 1.2, 0, 2.0);
  }
  tree(49.6, 0, 6, 3.4, 1.15);
  displayTable(43, 0, 8.6, 0, 2.4, 1.1, 0.95, COL.white, 'gifts');
  gondola(46.7, 0, 11.5, 0, 3.6, 'gifts', 1.5);
  pendant(44, F1 - 0.4, 6, 2.9, 0.22); pendant(45, F1 - 0.4, 6.4, 3.1, 0.18);

  // ---- glassware / dinnerware (tile area) ----
  shelfWall(57, 0, 0.55, 0, 9, 'plates', 2.2, 0.42, COL.woodLight);
  gondola(54.6, 0, 6.2, Math.PI / 2, 4.5, 'glass', 1.5);
  gondola(58.2, 0, 6.2, Math.PI / 2, 4.5, 'plates', 1.5);
  roundTable(56.3, 0, 10.6, 0.75, 0.76, hex('#6b4a33'), hex('#6b4a33'), 'plates');
  pendant(56.3, F1 - 0.4, 10.6, 2.6, 0.22);

  // ---- front registers ----
  counter(54.3, 0, 14, 0, 3.0, 1.0, 1.05, 2);
  counter(58.6, 0, 14, 0, 3.0, 1.0, 1.05, 2);
  shelfWall(56.5, 0, 15.25, Math.PI, 7, 'mixed', 1.6, 0.4, COL.woodLight);

  // ---- entrance zone ----
  displayTable(65.5, 0, 22, Math.PI / 2, 2.6, 1.2, 0.9, COL.woodLight, 'gifts');
  for (let i = 0; i < 4; i++) G.box(68.9, i * 0.12, 18.6, 0.5, 0.11, 0.38, 0, COL.metal);
  obbs.push(makeOBB(68.9, 18.6, 0.25, 0.2, 0, 0, 0.5, false));
  gondola(65.5, 0, 27.5, 0, 3.6, 'mixed', 1.4);
  displayTable(65.5, 0, 16, 0, 2.4, 1.0, 0.9, COL.white, 'vases');
  plant(68.8, 0, 26.5, 1.8);
  plant(68.8, 0, 13.5, 1.8);

  // ---- kitchen (hardwood) ----
  shelfWall(47.5, 0, 31.6, Math.PI, 9.6, 'cook', 2.4, 0.45, COL.woodLight);
  counter(48, 0, 25.6, 0, 8, 1.2, 1.05, 3);
  solid(52.6, 0, 25.6, 0.9, 2.0, 0.5, 0, COL.black);
  for (let i = 0; i < 6; i++) G.box(52.6 + R(-0.3, 0.3), 0.5 + i * 0.25, 25.86, 0.25, 0.18, 0.03, 0, pc(PAL.appl));
  for (const tx of [46.5, 51.5]) {
    const F = frame(tx, 19.6, 0);
    F.box(0, 0, 0, 3.4, 0.92, 0.9, COL.woodLight);
    F.box(0, 0.25, 0, 3.3, 0.03, 0.8, COL.white);
    items(F, -1.6, 1.6, 0.28, 0, 0.7, 'cook', 0.3);
    for (let i = 0; i < 5; i++) mixer(F.w(-1.3 + i * 0.65, 0)[0], 0.92, F.w(-1.3 + i * 0.65, 0)[1], pc(['#2b2b2b', '#e9e6df', '#8aa4b8', '#3d5a4e', '#9b2f2f', '#d7d9db']));
    F.hit(0, 0, 3.4, 0.9, 0, 0.92);
  }
  { // marble island with black base
    const F = frame(57.8, 21.8, 0);
    F.box(0, 0, 0, 2.4, 0.86, 1.1, COL.black);
    F.box(0, 0.86, 0, 2.5, 0.06, 1.2, COL.marble);
    items(F, -1.1, 1.1, 0.92, 0, 0.9, 'cook', 0.3);
    F.hit(0, 0, 2.5, 1.2, 0, 0.92);
  }
  barrel(55.2, 0, 19.6); barrel(55.7, 0, 20.3); barrel(59.6, 0, 23.4);
  gondola(56.5, 0, 28.6, 0, 4.6, 'cook', 1.6);
  gondola(43.3, 0, 21.5, Math.PI / 2, 5, 'cook', 1.6);
  for (const [px, pz] of [[46, 19.6], [51.5, 19.6]]) pendant(px, F1 - 0.4, pz, 2.6, 0.22, hex('#fbf6ea'));
  solid(60.6, 0, 18.2, 0.8, 1.0, 0.8, 0, COL.white); solid(61.0, 0, 19.3, 0.6, 1.25, 0.6, 0, COL.white);
  G.box(60.6, 1.0, 18.2, 0.35, 0.4, 0.3, 0, COL.steel);
  // employee doors (left open) to the back room
  door(41.5, 0, 31.85, Math.PI, 2.0, 2.4, COL.white, true, 1.1);
  exitSign(41.5, 2.7, 31.8, Math.PI);

  // ---- coffee & electrics corner (single story) ----
  wall(52, 32, 53, 32, 0, 4.4, COL.wall, 0, 0.3, { noExtend: true });
  wall(67, 32, 68, 32, 0, 4.4, COL.wall, 0, 0.3, { noExtend: true });
  G.box(60, 3.6, 32, 16, 0.8, 0.3, 0, COL.wall);
  shelfWall(55.5, 0, 39.6, Math.PI, 6.5, 'appl', 2.3, 0.45, COL.woodLight);
  shelfWall(64.7, 0, 39.6, Math.PI, 6, 'appl', 2.3, 0.45, COL.woodLight);
  shelfWall(52.4, 0, 35.8, Math.PI / 2, 6.8, 'appl', 2.3, 0.45, COL.woodLight);
  shelfWall(67.6, 0, 35.8, -Math.PI / 2, 6.6, 'appl', 2.0, 0.42, COL.white);
  for (const [px, pz, s] of [[58.5, 35.2, 1.0], [61.5, 35.6, 0.9]]) {
    solid(px, 0, pz, 1.0 * s, 1.05, 0.8 * s, 0, COL.white);
    G.box(px, 1.05, pz, 0.45, 0.42, 0.38, 0, COL.steel);
  }
  { const F = frame(64.2, 34.6, 0); F.box(0, 0, 0, 2.2, 0.9, 1.0, COL.woodLight, 0, { hit: true }); items(F, -1, 1, 0.9, 0, 0.8, 'appl', 0.4); }
  barrel(56, 0, 37.5); barrel(63, 0, 37.8);
  for (const [px, pz] of [[58, 36], [62, 36]]) pendant(px, 4.4, pz, 2.7, 0.2);
  solid(57.5, 0, 33.4, 0.6, 1.6, 0.6, 0, hex('#7a1f2b'));

  // =========================================================
  // BACK OF HOUSE (ground)
  // =========================================================
  wall(24, 32, 40.5, 32, 0, F1 - 0.4, COL.backWall, 0, 0.3, { noExtend: true });
  wall(42.5, 32, 52, 32, 0, F1 - 0.4, COL.backWall, 0, 0.3, { noExtend: true });
  // employee stairs (rise north, z 34 → 43)
  const S2 = { x0: 24.2, x1: 27.8, z0: 34, z1: 43 };
  for (let k = 0; k < 15; k++) {
    const za = S2.z0 + k * 0.6, top = (k + 0.5) * 0.3;
    G.box(26, 0, za + 0.3, 3.6, top - 0.04, 0.6, 0, hex('#8e9399'));
    G.box(26, top - 0.04, za + 0.3, 3.6, 0.05, 0.64, 0, hex('#2a2a2c'));
  }
  wall(28, 34, 28, 48, 0, F1 - 0.4, COL.backWall, 0, 0.3, { noExtend: true });
  wall(28, 32, 28, 43, F1, 7.5, COL.backWall, 0, 0.3, { noExtend: true });
  wall(24, 43, 28, 43, 0, F1 - 0.45, COL.backWall, 0, 0.2, { noExtend: true });
  wall(24, 34, 28, 34, F1, F1 + 1.05, COL.trim, 0, 0.08, { noExtend: true, opaque: false });
  G.box(27.75, 1.0, 38.5, 0.06, 0.06, 9.5, Math.atan2(0, 1), COL.trim);
  { // sloped handrail along the stair
    const len = Math.hypot(9, F1), ang = Math.atan2(F1, 9);
    const steps = 18;
    for (let i = 0; i < steps; i++) { const t = (i + 0.5) / steps; G.box(27.7, 0.95 + t * F1, 34 + t * 9, 0.06, 0.05, len / steps + 0.02, 0, COL.trim); }
    void ang;
  }
  // stockroom shelving
  for (const sz of [34.4, 36.6, 38.8]) metalShelf(34.2, 0, sz, 0, 9);
  metalShelf(40.6, 0, 36.6, Math.PI / 2, 4.6);
  // lockers + carts area
  { const F = frame(51.6, 35.5, -Math.PI / 2); for (let i = 0; i < 8; i++) { F.box(-2 + i * 0.5 + 0.25, 0, 0, 0.48, 1.9, 0.5, COL.locker); F.box(-2 + i * 0.5 + 0.25, 0.9, 0.26, 0.04, 0.12, 0.02, COL.steel); } F.hit(0, 0, 4, 0.5, 0, 1.9); }
  for (const [cx, cz] of [[45.5, 34.2], [48.2, 37.5]]) {
    const F = frame(cx, cz, R(-0.3, 0.3));
    for (const y of [0.15, 0.85, 1.55]) F.box(0, y, 0, 1.2, 0.03, 0.55, COL.steel);
    for (const ex of [-0.58, 0.58]) for (const ez of [-0.25, 0.25]) F.box(ex, 0, ez, 0.03, 1.6, 0.03, COL.steel);
    items(F, -0.55, 0.55, 0.88, 0, 0.45, 'boxes', 0.5);
    F.hit(0, 0, 1.2, 0.55, 0, 1.6, false);
  }
  { const F = frame(44.3, 38.6, 0); F.box(0, 0, 0, 1.6, 0.9, 0.7, COL.white, 0, { hit: true }); F.box(0, 0.9, 0, 1.7, 0.04, 0.75, COL.woodLight); }
  // warehouse
  for (const [cx, cz] of [[36, 44], [44, 44]]) { solid(cx, 0, cz, 0.35, F1 - 0.4, 0.35, 0, COL.white); }
  boxPile(31.5, 0, 45.5, 6, 1.4); boxPile(40.5, 0, 42, 5, 1.2); boxPile(48.5, 0, 45.5, 6, 1.4); boxPile(47.5, 0, 41.5, 3, 0.8);
  { // sale-floor furniture waiting in the back
    sofa(34.5, 0, 41.6, 0.3, 2.2, COL.cream);
    roundTable(37.2, 0, 46.2, 0.5, 0.76, COL.white, COL.white);
    chair(38.2, 0, 46.4, -1.2, COL.black, false);
  }
  G.box(38.5, 0.05, 47.8, 4.2, 3.4, 0.08, 0, hex('#8c9196'));
  for (let y = 0.15; y < 3.4; y += 0.14) G.box(38.5, y, 47.74, 4.2, 0.03, 0.02, 0, hex('#767b80'));
  door(44.8, 0, 47.85, Math.PI, 1.0, 2.2, hex('#3b4a57'));
  exitSign(44.8, 2.5, 47.75, Math.PI);
  for (const dz of [42.5, 46.5]) G.cyl(38, 3.5, dz, 0.35, 27, hex('#e6e3dc'), 0, 12, 'x');
  G.cyl(30, 3.85, 40, 0.12, 16, COL.black, 0, 8, 'z');

  // =========================================================
  // UPSTAIRS (y = 4.5)
  // =========================================================
  const Y = F1;
  // atrium cable rail (gap where the stairs arrive at x=40, z 21.5-23.5)
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
  rail(24, 8, 40, 8); rail(24, 8, 24, 24); rail(24, 24, 40, 24); rail(40, 8, 40, 21.4); rail(40, 23.6, 40, 24);

  // living rooms (west, along windows)
  livingSet(5, Y, 4.8, 0, COL.cream, COL.cream, hex('#d8cfbf'), true);
  livingSet(12.5, Y, 4.8, 0, COL.tan, COL.cream, hex('#cfc6b7'), false);
  livingSet(19.6, Y, 4.8, 0, COL.cream, COL.sage, hex('#bdb5a7'), false);
  livingSet(7.5, Y, 11, Math.PI, COL.navy, COL.cream, hex('#a9a69f'), false);
  livingSet(18.5, Y, 11.4, Math.PI, COL.cream, COL.tan, hex('#d0c7b8'), true);
  // dining + bar stools
  diningSet(11, Y, 17.6, 0, 2.6, 1.0, COL.woodLight, COL.black, hex('#9b9488'), false);
  diningSet(18, Y, 22.4, 0, 2.2, 1.0, COL.woodMid, COL.cream, null, true);
  for (let i = 0; i < 6; i++) {
    const sx = 41.4, sz = 10.2 + i * 1.6;
    G.cyl(sx, Y, sz, 0.18, 0.04, COL.black, 0, 8);
    G.cyl(sx, Y, sz, 0.03, 0.7, COL.black, 0, 6);
    G.box(sx, Y + 0.7, sz, 0.42, 0.08, 0.42, 0, pc(['#c49a6c', '#ece6da', '#2b2b2b', '#a87b4f']));
    G.box(sx + 0.18, Y + 0.78, sz, 0.06, 0.3, 0.42, 0, COL.woodMid);
    obbs.push(makeOBB(sx, sz, 0.22, 0.22, 0, Y, Y + 1.1, false));
  }
  // lamps & consoles along the atrium west edge
  for (const cz of [11, 15, 19]) {
    solid(21.6, Y, cz, 0.5, 0.8, 1.8, 0, COL.woodMid);
    tableLamp(21.6, Y + 0.8, cz - 0.5); tableLamp(21.6, Y + 0.8, cz + 0.45, COL.white);
  }
  // east showroom
  livingSet(46, Y, 4.8, 0, COL.cream, COL.tan, hex('#d8cfbf'), true);
  livingSet(53.5, Y, 4.8, 0, hex('#d9c7a8'), COL.cream, hex('#cfc6b7'), false);
  livingSet(58.6, Y, 11.5, -Math.PI / 2, COL.cream, COL.cream, hex('#cfc6b7'), false);
  livingSet(46.5, Y, 12.2, Math.PI, COL.olive, COL.cream, hex('#bdb5a7'), false);
  diningSet(46.5, Y, 19.6, 0, 3.0, 1.0, COL.woodLight, COL.black, hex('#9e968a'), false);
  diningSet(53.6, Y, 20.3, 0, 2.2, 1.1, COL.woodMid, COL.cream, null, true);
  shelfWall(61.6, Y, 20.5, -Math.PI / 2, 8, 'pillows', 2.4, 0.45, COL.white);
  // bedroom zone along the north wall
  for (const [bx, col] of [[50.2, hex('#d9d4c9')], [55.4, hex('#8e9a86')], [59.8, hex('#5b6b7d')]]) bed(bx, Y, 30.3, Math.PI, col);
  rug(55, Y, 28.6, 13, 4.5, 0, hex('#d6cfc2'));
  // design desk + fabric wall near the elevator
  { const F = frame(33.5, 28.4, 0);
    F.box(0, Y + 0.72, 0, 5.2, 0.06, 1.1, COL.woodLight);
    for (const ex of [-2.5, 2.5]) F.box(ex, Y, 0, 0.12, 0.72, 1.0, COL.woodLight);
    for (const ex of [-1.6, 0, 1.6]) { F.box(ex, Y + 0.78, -0.3, 0.12, 0.1, 0.12, COL.steel); F.box(ex, Y + 0.88, -0.32, 0.62, 0.42, 0.03, COL.steel); F.box(ex, Y + 0.93, -0.30, 0.56, 0.32, 0.01, hex('#202428'), MAT.GLOW); }
    F.hit(0, 0, 5.2, 1.1, Y + 0.68, Y + 0.78); F.hit(0, 0, 5.1, 1.0, Y, Y + 0.78, false);
    for (const ex of [-1.6, 0, 1.6]) { const [cx, cz] = F.w(ex, 0.85); chair(cx, Y, cz, Math.PI, COL.woodLight, true); }
  }
  { const F = frame(34.5, 31.75, Math.PI);
    for (let i = 0; i < 26; i++) F.box(-3.2 + i * 0.25, Y + 0.6, 0, 0.22, R(1.2, 1.6), 0.05, pc(['#a8b0b5', '#6d7b86', '#d9d4c9', '#3c4a57', '#8e9a86', '#c9b8a3', '#f0ece4']));
    F.hit(0, 0, 6.6, 0.15, Y, Y + 2.3); }
  tree(23.0, Y, 26.1, 2.6, 0.8); tree(41.2, Y, 26.2, 2.6, 0.8);
  // upstairs register by the windows
  counter(12.5, Y, 13.7, Math.PI, 4.2, 0.9, 1.05, 2);
  for (let i = 0; i < 4; i++) art(2 + i * 4.4 + 2.2, Y + 1.4, 0.2, 0, 1.0, 1.3);
  art(61.8, Y + 1.5, 6, -Math.PI / 2, 1.4, 1.8);
  for (const [px, pz] of [[12.5, 7.5], [46, 8], [53.5, 8]]) wovenPendant(px, 9, pz, 7.6, 0.45);
  // doorway to the back hallway (upstairs), restrooms sign area
  wall(24, 32, 44, 32, Y, 9, COL.ship, MAT.SHIPLAP, 0.3, { noExtend: true });
  wall(46, 32, 52, 32, Y, 9, COL.ship, MAT.SHIPLAP, 0.3, { noExtend: true });
  G.box(45, Y + 2.6, 32, 2.0, 9 - Y - 2.6, 0.3, 0, COL.ship, MAT.SHIPLAP);
  exitSign(45, Y + 2.75, 31.82, Math.PI);

  // =========================================================
  // BACK OF HOUSE (upstairs): break room, coat room, hallway
  // =========================================================
  wall(44, 32, 44, 43.5, Y, 7.5, COL.backWall, 0, 0.2, { noExtend: true });
  wall(46, 32, 46, 37, Y, 7.5, COL.backWall, 0, 0.2, { noExtend: true });
  wall(46, 38.5, 46, 43.5, Y, 7.5, COL.backWall, 0, 0.2, { noExtend: true });
  wall(28, 43.5, 36, 43.5, Y, 7.5, COL.backWall, 0, 0.2, { noExtend: true });
  wall(37.5, 43.5, 44, 43.5, Y, 7.5, COL.backWall, 0, 0.2, { noExtend: true });
  wall(46, 43.5, 52, 43.5, Y, 7.5, COL.backWall, 0, 0.2, { noExtend: true });
  G.box(46, Y + 2.2, 37.75, 0.2, 7.5 - Y - 2.2, 1.5, 0, COL.backWall);
  G.box(36.75, Y + 2.2, 43.5, 1.5, 7.5 - Y - 2.2, 0.2, 0, COL.backWall);
  // break room
  { const carpet = hex('#3f5450');
    G.box(36, Y + 0.001, 37.75, 15.8, 0.01, 11.3, 0, carpet, MAT.CARPET);
    for (const [tx, tz] of [[31.5, 35.5], [31.5, 39], [36.5, 35.5], [36.5, 39], [41, 37]]) {
      const F = frame(tx, tz, R(-0.15, 0.15));
      F.box(0, Y + 0.72, 0, 1.8, 0.04, 0.75, hex('#2a2a2c'));
      F.box(0, Y, 0, 0.06, 0.72, 0.06, COL.steel); F.box(0, Y, 0, 0.9, 0.04, 0.5, COL.steel);
      F.hit(0, 0, 1.8, 0.75, Y + 0.68, Y + 0.76); F.hit(0, 0, 1.0, 0.6, Y, Y + 0.76, false);
      for (const s of [-1, 1]) { const [cx, cz] = F.w(R(-0.4, 0.4), s * 0.75); chair(cx, Y, cz, (s > 0 ? Math.PI : 0) + R(-0.4, 0.4), hex('#3a3a3c'), true); }
    }
    solid(29.0, Y, 42.4, 1.6, 0.95, 0.8, 0, COL.woodLight);
    G.box(28.7, Y + 0.95, 42.4, 0.6, 0.35, 0.45, 0, COL.black);
    solid(30.4, Y, 42.6, 0.9, 1.9, 0.75, 0, COL.white);
    exitSign(31, Y + 2.6, 32.15, 0);
  }
  // coat room
  { G.box(49, Y + 1.7, 43.1, 5.2, 0.04, 0.5, 0, COL.steel);
    for (let i = 0; i < 16; i++) G.box(46.8 + i * 0.3, Y + 0.85, 43.0, 0.24, 0.85, R(0.35, 0.5), 0, pc(['#1f2329', '#2f3b55', '#3a3a3c', '#4b5a3e', '#6b2c2c', '#262626']));
    obbs.push(makeOBB(49, 43.0, 2.6, 0.3, 0, Y, Y + 1.8));
    const F = frame(51.6, 37.5, -Math.PI / 2);
    for (let i = 0; i < 9; i++) F.box(-2.25 + i * 0.5 + 0.25, Y, 0, 0.48, 1.9, 0.5, COL.locker);
    F.hit(0, 0, 4.5, 0.5, Y, Y + 1.9);
    solid(48.6, Y, 36, 1.8, 0.45, 0.45, 0, COL.woodLight);
  }
  // hallway: restrooms + office doors
  for (const dx of [31.5, 34.5]) door(dx, Y, 47.85, Math.PI, 0.95, 2.2, COL.white);
  for (const dx of [41, 49]) door(dx, Y, 47.85, Math.PI, 0.95, 2.2, hex('#d9d6cf'));
  for (const dx of [32, 40, 48]) { G.box(dx, Y + 1.2, 43.62, 1.2, 0.9, 0.03, 0, COL.woodLight); G.box(dx, Y + 1.25, 43.64, 1.05, 0.8, 0.01, 0, hex('#c9b38d')); }
  { const F = frame(39, 46.2, 0); for (const y of [0.15, 0.6, 1.0]) F.box(0, Y + y, 0, 1.0, 0.04, 0.5, COL.black); F.hit(0, 0, 1.0, 0.5, Y, Y + 1.05, false); }

  // =========================================================
  // walkable surfaces, stairs, zones
  // =========================================================
  const surfaces = [{ x0: 0, x1: 70, z0: 0, z1: 48, y: 0 }];
  for (const [x0, x1, z0, z1] of slabs) surfaces.push({ x0, x1, z0, z1, y: F1 });
  const ramps = [
    { x0: S1.x0, x1: S1.x1, z0: S1.z0, z1: S1.z1, axis: 'x', a0: S1.x0, a1: S1.x1, y0: 0, y1: F1 },
    { x0: S2.x0, x1: S2.x1, z0: S2.z0, z1: S2.z1, axis: 'z', a0: S2.z0, a1: S2.z1, y0: 0, y1: F1 },
  ];
  const stairs = [
    { bottom: [27.4, 22.5], top: [40.6, 22.5], name: 'Atrium stairs' },
    { bottom: [26, 33.4], top: [26, 43.6], name: 'Employee stairs' },
  ];
  const polys = [
    [[0, 0], [70, 0], [70, 32], [68, 32], [68, 40], [52, 40], [52, 48], [24, 48], [24, 32], [0, 14]],
    [[0, 0], [62, 0], [62, 32], [52, 32], [52, 48], [24, 48], [24, 32], [0, 14]],
  ];
  const zones = [
    [1, 28, 52, 32, 43.5, 'Break Room'], [1, 46, 52, 32, 43.5, 'Coat Room'], [1, 24, 52, 43.5, 48, 'Back Hallway'],
    [1, 44, 46, 32, 43.5, 'Back Hallway'], [1, 24, 28, 32, 48, 'Back Stairs'],
    [1, 24, 40, 24, 32, 'Design Desk'], [1, 42, 62, 24, 32, 'Bedrooms'], [1, 24, 40, 0, 24, 'Balcony'],
    [1, 0, 24, 0, 13, 'Upstairs Living Rooms'], [1, 0, 24, 13, 32, 'Upstairs Dining'], [1, 40, 62, 0, 24, 'Upstairs Showroom'],
    [0, 24, 28, 32, 48, 'Back Stairs'], [0, 28, 40, 32, 40, 'Stockroom'], [0, 24, 52, 40, 48, 'Warehouse'], [0, 40, 52, 32, 40, 'Back Room'],
    [0, 52, 68, 32, 40, 'Coffee Corner'], [0, 62, 70, 12, 32, 'Entrance'], [0, 40, 62, 16, 32, 'Kitchen'],
    [0, 52, 62, 12, 16, 'Front Registers'], [0, 52, 62, 0, 12, 'Glassware'], [0, 40, 52, 0, 16, 'Ornament Shop'],
    [0, 24, 40, 8, 24, 'Atrium'], [0, 24, 40, 0, 8, 'Front Dining'], [0, 24, 40, 24, 32, 'Hearth'],
    [0, 0, 24, 0, 14, 'Living Rooms'], [0, 0, 24, 14, 32, 'Dining Gallery'],
  ];
  return {
    geo: G, obbs, surfaces, ramps, stairs, polys, zones, F1,
    width: 70, depth: 48,
    playerSpawn: [44.5, 0, 14.5, -Math.PI / 2],
    seekerSpawns: [[68.2, 20.8], [68.2, 22], [68.2, 23.2], [67.4, 21.4], [67.4, 22.6]],
  };
}
