// ============================================================
// BOX — people, Krampus, and props that move.
// Each body part is a cached mesh in its bone's local space; every frame
// we pose a skeleton and copy the parts through their bone matrices.
// Models face local -z. Joint angles: Rx>0 swings a limb forward.
// ============================================================

const CHARS = {
  dad: { h: 1.82, bulk: 1.12, skin: '#e3b897', hair: ['short', '#4a3526'], beard: '#4a3526', glasses: true, top: ['puffer', '#2d3f5e'], pants: '#b9a684', shoes: '#4a3325', watch: true },
  mom: { h: 1.68, fem: true, skin: '#f0caa8', hair: ['bun', '#2b1d14'], top: ['coat', '#b98a5a'], scarf: '#8a2f3b', pants: '#2e3a52', shoes: '#2a2420', boots: true, purse: '#6b3a2a', lips: '#b0545a' },
  you: { h: 1.42, kid: 0.45, skin: '#e9c4a4', hair: ['short', '#5a3a22'], top: ['puffer', '#2f6fa8'], pants: '#3a3f48', shoes: '#e8e8e8' },
  leo: { h: 1.1, kid: 1, skin: '#f2cfae', hair: ['beanie', '#7a5230'], hat: '#2f9e55', top: ['puffer', '#c9342c'], scarf: '#2f9e55', mittens: '#d0342c', pants: '#32456b', shoes: '#3a2a1e', boots: true },
  dana: { h: 1.66, fem: true, skin: '#d9b596', hair: ['ponytail', '#3b2a20'], top: ['shirt', '#ece8de'], apron: '#2f2f31', pants: '#26272b', shoes: '#1d1d1f', tag: true, lips: '#9a4a4a' },
  marcus: { h: 1.88, bulk: 1.05, skin: '#8d5e3f', hair: ['buzz', '#141010'], top: ['shirt', '#5b6b7d'], apron: '#2f2f31', pants: '#2b2c30', shoes: '#1d1d1f', tag: true },
  priya: { h: 1.62, fem: true, skin: '#b88462', hair: ['braid', '#15100d'], glasses: true, top: ['shirt', '#8e4a52'], apron: '#2f2f31', pants: '#2b2c30', shoes: '#1d1d1f', tag: true, lips: '#8a3e44' },
  manager: { h: 1.78, bulk: 1.02, skin: '#e8c4a2', hair: ['short', '#9a9a98'], top: ['sweater', '#3a4a3e'], tie: '#7a1f2b', pants: '#3a3a3c', shoes: '#1d1d1f', lanyard: true, glasses: true },
};

const ACT = (() => {
  const H = (h) => hex(h);
  // ---------- body measurements ----------
  const DIMS = {};
  function dims(id) {
    if (DIMS[id]) return DIMS[id];
    const c = CHARS[id], Hh = c.h, k = c.kid || 0, b = c.bulk || 1, fem = c.fem ? 0.92 : 1;
    const headRy = Hh / lerp(7.3, 5.0, k) / 2;
    const d = {
      H: Hh, k, headRy, headRx: headRy * 0.8, headRz: headRy * 0.92,
      neck: Hh * 0.035, footH: Hh * 0.04,
      legs: Hh * lerp(0.52, 0.45, k),
      shW: Hh * lerp(0.1, 0.1, k) * fem * Math.sqrt(b), upper: Hh * 0.17, fore: Hh * 0.15, hand: Hh * 0.055,
      hipW: Hh * 0.052 * (c.fem ? 1.12 : 1), armR: Hh * 0.025 * b, legR: Hh * 0.035 * b, rz: Hh * 0.062 * b, b,
    };
    d.thigh = d.shin = (d.legs - d.footH) / 2;
    const torso = Hh - d.legs - d.neck - headRy * 2;
    d.spine = torso * 0.36; d.chest = torso * 0.64;
    return (DIMS[id] = d);
  }

  // a smooth closed shape through elliptical cross-sections: rings = [[y, halfWidth, halfDepth, zOffset], ...] bottom to top
  function loft(g, rings, col, mat, seg = 16) {
    const n = rings.length - 1;
    const at = (v) => {
      const f = clamp(v, 0, 1) * n, i = Math.min(n - 1, Math.floor(f)), t = f - i, k = t * t * (3 - 2 * t), a = rings[i], b = rings[i + 1];
      return [lerp(a[0], b[0], t), lerp(a[1], b[1], k), lerp(a[2], b[2], k), lerp(a[3] || 0, b[3] || 0, k)];
    };
    g.param((u, v) => {
      const cap = 0.06, e = v < cap ? Math.sin((v / cap) * Math.PI / 2) : v > 1 - cap ? Math.sin(((1 - v) / cap) * Math.PI / 2) : 1;   // rounded ends
      const [y, w, dp, zo] = at((v - cap * 0) ), ph = u * TAU;
      return [Math.cos(ph) * w * e, y, zo + Math.sin(ph) * dp * e];
    }, seg, n * 4, col, mat);
  }

  // ---------- part meshes ----------
  function personPart(id, part, extra = '') {
    return mesh(`p:${id}:${part}:${extra}`, (g) => {
      const c = CHARS[id], d = dims(id), skin = H(c.skin), top = H(c.top[1]), pants = H(c.pants), shoes = H(c.shoes);
      const puff = c.top[0] === 'puffer', coat = c.top[0] === 'coat', fab = MAT.FABRIC;
      const sleeve = puff ? 1.45 : coat ? 1.25 : 1.12;
      if (part === 'pelvis') {
        loft(g, [[-d.spine * 0.5, d.hipW * 1.2, d.rz * 0.6], [-d.spine * 0.2, d.hipW * 2.2, d.rz * 0.95, d.rz * 0.06], [d.spine * 0.25, d.hipW * (c.fem ? 2.3 : 2.2), d.rz * 0.98, d.rz * 0.05], [d.spine * 0.7, d.hipW * (c.fem ? 1.9 : 2.05), d.rz * 0.8], [d.spine * 0.92, d.hipW * 1.5, d.rz * 0.55]], pants, fab);
        if (!puff && !coat) g.push(A.S(1, 1, d.rz * 0.84 / (d.hipW * 2.0))); g.torus(0, d.spine * 0.62, 0, d.hipW * (c.fem ? 1.96 : 2.1), d.H * 0.008, H('#1c1a19'), MAT.LEATHER, 18, 5); g.pop();   // belt
        if (puff) g.ellipsoid(0, d.spine * 0.55, 0, d.shW * 1.0, d.spine * 0.32, d.rz * 1.25, shade(top, 0.95), fab, 14, 6);
        if (coat) g.lathe(0, -d.thigh * 0.85, 0, [[d.hipW * 3.0, 0, 1], [d.hipW * 2.6, d.thigh * 0.6], [d.hipW * 2.35, d.thigh * 0.85 + d.spine * 0.5], [d.hipW * 2.2, d.thigh * 0.85 + d.spine * 0.95, 1]], top, fab, 16);
        if (c.apron) { g.rbox(0, -d.thigh * 0.65, -d.rz * 0.92, d.hipW * 3.6, d.thigh * 0.65 + d.spine * 0.6, 0.02, 0, H(c.apron), fab, 0.01); g.rbox(-d.hipW * 1.1, -d.thigh * 0.15, -d.rz * 0.95 - 0.012, d.hipW * 1.2, d.thigh * 0.25, 0.012, 0, shade(H(c.apron), 1.2), fab, 0.005); }
        if (c.purse) { g.rbox(-d.shW * 1.25, -d.spine * 0.25, 0.02, 0.07, d.H * 0.13, d.H * 0.16, 0, H(c.purse), MAT.LEATHER, 0.02); }
      } else if (part === 'chest') {
        const cw = d.shW * 0.95, ch = d.chest;
        if (puff) {
          g.ellipsoid(0, ch * 0.22, 0, d.hipW * 2.2 * 1.15, ch * 0.34, d.rz * 1.2, top, fab, 14, 8);
          g.ellipsoid(0, ch * 0.6, 0, cw * 1.15, ch * 0.42, d.rz * 1.25, top, fab, 16, 10);
          for (const s of [-1, 1]) g.ellipsoid(s * d.shW, ch * 0.86, 0, d.armR * 1.45 * sleeve, d.armR * 1.3 * sleeve, d.armR * 1.4 * sleeve, top, fab, 10, 6);
        } else {
          // a torso with a waist, a rib cage, shoulders that slope into the neck, and a little belly or bust
          const k = coat ? 1.1 : 1, fem = !!c.fem;
          loft(g, [[-ch * 0.22, d.hipW * (fem ? 1.95 : 2.1) * k, d.rz * 0.88 * k], [-ch * 0.02, d.hipW * (fem ? 1.85 : 2.08) * k, d.rz * 0.88 * k], [ch * 0.18, d.shW * (fem ? 0.7 : 0.84) * k, d.rz * (fem ? 0.8 : 0.92) * k, -d.rz * (fem ? 0 : 0.06)],
            [ch * 0.5, d.shW * (fem ? 0.84 : 0.98) * k, d.rz * (fem ? 1.0 : 1.02) * k, -d.rz * (fem ? 0.16 : 0.04)], [ch * 0.74, d.shW * 1.04 * k, d.rz * 0.95 * k, -d.rz * (fem ? 0.06 : 0)],
            [ch * 0.9, d.shW * 1.02 * k, d.rz * 0.8 * k, d.rz * 0.06], [ch * 0.985, d.shW * 0.72 * k, d.rz * 0.62 * k, d.rz * 0.06], [ch * 1.05, d.H * 0.04, d.H * 0.04, d.rz * 0.03]], top, fab, 18);
          for (const s of [-1, 1]) g.ellipsoid(s * d.shW, ch * 0.85, 0, d.armR * 1.3 * sleeve, d.armR * 1.15 * sleeve, d.armR * 1.25 * sleeve, top, fab, 10, 6);
          if (c.top[0] === 'shirt') { for (let i = 0; i < 5; i++) g.sphere(0, ch * (0.14 + i * 0.16), -d.rz * (0.95 + (i === 2 || i === 3 ? 0.07 : 0)) * 1.0 - 0.004, d.H * 0.0035, H('#d9d5cc'), MAT.CERAMIC, 5);   // buttons
            for (const s of [-1, 1]) { g.push(A.chain(A.T(s * d.H * 0.022, ch * 0.985, -d.H * 0.04), A.Rz(s * 0.5), A.Rx(-0.5))); g.rbox(0, 0, 0, d.H * 0.035, d.H * 0.02, 0.006, 0, shade(top, 1.1), fab, 0.003); g.pop(); } }   // collar points
        }
        if (puff) for (let i = 0; i < 4; i++) g.ellipsoid(0, ch * (0.12 + i * 0.22), 0, cw * (1.05 + (i === 1 || i === 2 ? 0.1 : 0)), ch * 0.08, d.rz * 1.3, shade(top, 1.06), fab, 16, 6);
        if (puff) g.lathe(0, ch * 0.95, 0, [[d.H * 0.055, 0, 1], [d.H * 0.06, ch * 0.12], [d.H * 0.052, ch * 0.16, 1]], shade(top, 0.9), fab, 14);
        if (coat) { g.ellipsoid(0, ch * 0.96, 0.0, d.H * 0.07, ch * 0.08, d.H * 0.06, shade(top, 0.92), fab, 12, 6); for (let i = 0; i < 3; i++) g.sphere(d.shW * 0.25, ch * (0.2 + i * 0.22), -d.rz * 1.0, d.H * 0.008, H('#3a2a20'), 0, 6); }
        if (c.top[0] === 'shirt' || c.top[0] === 'sweater') { g.ellipsoid(0, ch * 0.95, -0.005, d.H * 0.045, ch * 0.07, d.H * 0.045, c.top[0] === 'sweater' ? H('#f2f0ea') : shade(top, 1.08), fab, 10, 5); }
        if (c.tie) { g.rbox(0, ch * 0.25, -d.rz * 1.0, d.H * 0.025, ch * 0.65, 0.01, 0, H(c.tie), fab, 0.004); }
        if (c.lanyard) { g.tube([[-d.H * 0.04, ch * 0.98, -d.rz * 0.6], [-d.H * 0.05, ch * 0.6, -d.rz * 1.05], [0, ch * 0.42, -d.rz * 1.08], [d.H * 0.05, ch * 0.6, -d.rz * 1.05], [d.H * 0.04, ch * 0.98, -d.rz * 0.6]], 0.006, H('#7a1f2b'), fab, 4, false); g.rbox(0, ch * 0.3, -d.rz * 1.1, 0.06, 0.09, 0.008, 0, H('#f2f0ea'), 0, 0.004); }
        if (c.apron) {
          const ap = H(c.apron);
          g.rbox(0, ch * 0.05, -d.rz * 1.0, d.shW * 1.15, ch * 0.75, 0.018, 0, ap, fab, 0.008);
          for (const s of [-1, 1]) g.tube([[s * d.shW * 0.5, ch * 0.78, -d.rz * 1.02], [s * d.shW * 0.42, ch * 1.02, -d.rz * 0.3], [s * d.shW * 0.4, ch * 0.9, d.rz * 0.7]], 0.008, ap, fab, 4, false);
          if (c.tag) { g.rbox(-d.shW * 0.4, ch * 0.62, -d.rz * 1.04, 0.07, 0.025, 0.006, 0, H('#f6f5f1'), MAT.CERAMIC, 0.003); g.box(-d.shW * 0.4, ch * 0.628, -d.rz * 1.044, 0.05, 0.006, 0.002, 0, H('#2b2b2b')); }
        }
        if (c.purse) g.tube([[-d.shW * 0.9, ch * 0.95, 0], [-d.shW * 0.2, ch * 0.5, -d.rz * 1.05], [d.shW * 0.6, ch * 0.05, -d.rz * 0.6]], 0.008, H(c.purse), MAT.LEATHER, 4, false);
      } else if (part === 'neck') {
        g.lathe(0, -0.02, 0, [[d.H * (c.fem ? 0.031 : 0.036), 0, 1], [d.H * (c.fem ? 0.027 : 0.032), d.neck * 0.6 + 0.02], [d.H * (c.fem ? 0.028 : 0.033), d.neck + 0.05, 1]], skin, MAT.SKIN, 12);
        if (!c.fem && !d.k) g.ellipsoid(0, d.neck * 0.45, -d.H * 0.028, d.H * 0.008, d.H * 0.011, d.H * 0.008, shade(skin, 0.97), MAT.SKIN, 6, 4);
        if (c.scarf) {
          const sc = H(c.scarf);
          g.torus(0, d.neck * 0.25, 0, d.H * 0.04, d.H * 0.022, sc, fab, 14, 6);
          g.tube([[d.H * 0.02, d.neck * 0.1, -d.H * 0.05], [d.H * 0.04, -d.chest * 0.25, -d.rz * (d.k ? 1.5 : 1.35)], [d.H * 0.045, -d.chest * 0.42, -d.rz * (d.k ? 1.55 : 1.4)]], [d.H * 0.02, d.H * 0.02, d.H * 0.016], sc, fab, 6, true);
        }
      } else if (part === 'head') {
        const [eyes, brows, mouth] = extra.split(',');
        const rx = d.headRx, ry = d.headRy, rz = d.headRz, cy = ry * 0.95;
        // a skull rather than an egg: wide cranium, flat temples, cheekbones, a jaw that narrows to a chin
        const kid = d.k > 0.5, fem = !!c.fem;
        g.param((u, v) => {
          const th = -Math.PI / 2 + v * Math.PI, ph = u * TAU, y = Math.sin(th), cc = Math.cos(th);
          let x = Math.cos(ph) * cc, z = Math.sin(ph) * cc;
          const low = y < 0 ? y * y : 0, front = z < 0 ? -z : 0;
          x *= 1 - (kid ? 0.2 : fem ? 0.36 : 0.3) * low; z *= 1 - 0.1 * low;
          if (z < 0) z *= 1 + 0.07 * low;                                             // chin forward
          x *= 1 - 0.07 * front * (1 - Math.abs(y));                                  // face narrower than the skull behind it
          const cheek = Math.exp(-(((y + 0.12) / 0.26) ** 2)) * Math.exp(-(((Math.abs(x) - 0.62) / 0.3) ** 2)) * front;
          z -= 0.05 * cheek; x *= 1 + 0.04 * cheek;                                   // cheekbones
          const sock = Math.exp(-(((y - 0.13) / 0.11) ** 2)) * Math.exp(-(((Math.abs(x) - 0.4) / 0.2) ** 2)) * front;
          z += 0.09 * sock;                                                           // eye sockets set in
          const brow = Math.exp(-(((y - 0.3) / 0.09) ** 2)) * front * (1 - x * x);
          z -= (fem || kid ? 0.015 : 0.035) * brow;                                   // brow ridge
          return [x * rx, cy + y * ry * (y < 0 ? 1.06 : 1), z * rz];
        }, 26, 18, skin, MAT.SKIN);
        // ears
        for (const s of [-1, 1]) { g.ellipsoid(s * rx * 0.97, cy + ry * 0.02, rz * 0.08, rx * 0.07, ry * 0.19, rz * 0.12, shade(skin, 0.96), MAT.SKIN, 8, 6); g.ellipsoid(s * rx * 1.0, cy + ry * 0.02, rz * 0.06, rx * 0.03, ry * 0.11, rz * 0.06, shade(skin, 0.78), MAT.SKIN, 6, 4); }
        // nose: bridge, tip, wings, nostrils
        const nk = kid ? 0.7 : 1, ny = cy - ry * 0.16, nz = -rz * (0.98 + 0.13 * nk);
        g.tube([[0, cy + ry * 0.2, -rz * 0.92], [0, cy + ry * 0.02, -rz * (0.97 + 0.05 * nk)], [0, ny + ry * 0.03, nz + rz * 0.02]], [rx * 0.055, rx * 0.065, rx * 0.085], shade(skin, 1.01), MAT.SKIN, 8);
        g.ellipsoid(0, ny, nz + rz * 0.03, rx * 0.095 * nk, ry * 0.075, rz * 0.09, shade(skin, 1.02), MAT.SKIN, 8, 6);
        for (const s of [-1, 1]) { g.ellipsoid(s * rx * 0.1 * nk, ny - ry * 0.015, -rz * 0.96, rx * 0.065, ry * 0.055, rz * 0.07, skin, MAT.SKIN, 6, 4); g.ellipsoid(s * rx * 0.055 * nk, ny - ry * 0.058, nz + rz * 0.06, rx * 0.028, ry * 0.014, rz * 0.03, H('#3a211c'), 0, 5, 3); }
        const ey = cy + ry * 0.12, ez = -rz * 0.83, ex = rx * 0.37;
        const dark = H('#1a1210'), white = H('#eeeae3');
        const irisCol = H({ dad: '#4a6a7a', mom: '#5a4028', you: '#5a4028', leo: '#5a4028', dana: '#3f5a42', marcus: '#2e1e14', priya: '#2e1e14', manager: '#6f8494' }[id] || '#3a2a1e');
        for (const s of [-1, 1]) {
          if (eyes === 'closed') { g.ellipsoid(s * ex, ey, ez - rz * 0.01, rx * 0.18, ry * 0.05, rz * 0.07, skin, MAT.SKIN, 8, 4); g.rbox(s * ex, ey - ry * 0.035, ez - rz * 0.075, rx * 0.3, 0.0035, 0.004, 0, dark, 0, 0.0015); }
          else {
            // stare: lids pulled right back, the whole iris showing, lit from nowhere
            const stare = eyes === 'stare', wide = eyes === 'wide', nar = eyes === 'narrow';
            const ew = rx * (kid ? 0.19 : 0.165) * (stare ? 1.25 : 1), eh = ry * (kid ? 0.085 : 0.066) * (stare ? 1.75 : wide ? 1.4 : 1), ir = eh * (stare ? 0.48 : 0.92);
            g.ellipsoid(s * ex, ey, ez, ew, eh, rz * 0.085, stare ? H('#8d8b85') : white, stare ? MAT.GLOW : MAT.CERAMIC, 12, 7);
            g.ellipsoid(s * ex, ey - (stare || wide ? 0 : eh * 0.08), ez - rz * 0.062, ir, ir, rz * 0.035, irisCol, MAT.CERAMIC, 10, 6);
            g.ellipsoid(s * ex, ey - (stare || wide ? 0 : eh * 0.08), ez - rz * 0.085, ir * 0.45, ir * 0.45, rz * 0.02, dark, MAT.CERAMIC, 8, 5);
            if (!stare) g.sphere(s * ex + ir * 0.35, ey + ir * 0.3, ez - rz * 0.1, d.H * 0.0016, white, MAT.GLOW, 4);
            if (!stare) {
              // upper lid, lash line, lower lid
              const drop = nar ? 0.2 : wide ? 1.25 : 0.72;
              g.ellipsoid(s * ex, ey + eh * drop, ez - rz * 0.012, ew * 1.12, eh * 0.62, rz * 0.095, skin, MAT.SKIN, 10, 5);
              g.rbox(s * ex, ey + eh * (drop - 0.5), ez - rz * 0.092, ew * 1.9, fem ? 0.0038 : 0.0026, 0.004, 0, dark, 0, 0.0012);
              g.ellipsoid(s * ex, ey - eh * (nar ? 0.75 : 1.02), ez - rz * 0.005, ew * 1.05, eh * 0.4, rz * 0.085, shade(skin, 0.97), MAT.SKIN, 8, 4);
            }
          }
          const by = ey + ry * (brows === 'up' ? 0.28 : 0.2), tilt = brows === 'angry' ? 0.38 : brows === 'sad' ? -0.32 : 0;
          g.push(A.chain(A.T(s * ex, by, ez - 0.006), A.Rz(-s * tilt)));
          { const bc = H(c.hair[1] === '#9a9a98' ? '#7a7a78' : c.hair[1]), th = d.H * (fem || kid ? 0.0045 : 0.007); for (let i = -2; i <= 2; i++) { const u = i / 2; g.rbox(u * rx * 0.17, -0.004 - u * u * ry * 0.035 + (s * u > 0 ? -ry * 0.02 * Math.abs(u) : 0), -rz * 0.035 + u * u * rz * 0.03, rx * 0.1, th * (1 - 0.3 * Math.abs(u)), d.H * 0.006, 0, bc, MAT.HAIR, 0.002); } }
          g.pop();
        }
        const my = cy - ry * 0.42, mz = -rz * 0.86, sk = H(c.skin), lip = c.lips ? H(c.lips).map((v, i) => lerp(sk[i], v, 0.7)) : [sk[0] * 0.8, sk[1] * 0.62, sk[2] * 0.6];
        if (mouth === 'smile' || mouth === 'frown') {
          const sg = mouth === 'smile' ? 1 : -1;
          for (let i = -4; i <= 4; i++) { const u = i / 4, w = 1 - u * u * 0.75; g.rbox(u * rx * 0.27, my + sg * u * u * ry * 0.075 + d.H * 0.0028 * w, mz - (1 - u * u) * 0.005, rx * 0.085, d.H * 0.003 * w + 0.0008, d.H * 0.006, 0, shade(lip, 0.9), 0, 0.0015); g.rbox(u * rx * 0.25, my + sg * u * u * ry * 0.075 - d.H * 0.0026 * w, mz - (1 - u * u) * 0.006, rx * 0.08, d.H * 0.0036 * w + 0.0008, d.H * 0.007, 0, lip, 0, 0.002); }
        } else if (mouth === 'wide') {
          // a closed smile that goes a little too far up the cheeks
          for (let i = -6; i <= 6; i++) { const u = i / 6; g.rbox(u * rx * 0.5, my + u * u * ry * 0.2, mz - (1 - u * u) * 0.006 + Math.abs(u) * 0.004, rx * 0.095, d.H * 0.0065, d.H * 0.006, 0, lip, 0, 0.002); }
          for (const sd of [-1, 1]) g.ellipsoid(sd * rx * 0.5, my + ry * 0.17, mz + 0.008, rx * 0.15, ry * 0.11, rz * 0.08, shade(skin, 1.02), MAT.SKIN, 8, 5);
        } else if (mouth.startsWith('maw')) {
          // The smile that opens. Closed: lips stretched too far up the cheeks. Then the lips part, slowly, on two rows of
          // needle teeth, and keep going further than a jaw should.
          const o = (+mouth.slice(3) || 0) / 12, gap = ry * (0.03 + 0.44 * o), W = rx * (0.46 + 0.07 * o), lipD = shade(lip, 0.8);
          const curve = (u) => u * u * ry * 0.22;                       // corners pulled up
          const zc = (u) => mz - 0.012 + u * u * rz * 0.2;              // and wrapped back round the face
          if (o > 0.02) for (let i = -6; i <= 6; i++) {                  // the dark inside
            const u = i / 6, hgt = gap * (1 - u * u * 0.75);
            g.rbox(u * W, my + curve(u) - hgt * 0.5 + ry * 0.02, zc(u) + 0.006, W / 5.4, hgt + 0.003, 0.012, 0, H('#1a0506'), 0, 0.002);
          }
          for (let i = -6; i <= 6; i++) {                                // lips: upper stays, lower drops
            const u = i / 6, hgt = gap * (1 - u * u * 0.75);
            g.rbox(u * W, my + curve(u) + ry * 0.03, zc(u), W / 4.3, d.H * 0.0055, d.H * 0.007, 0, lipD, 0, 0.002);
            g.rbox(u * W, my + curve(u) - hgt + ry * 0.01, zc(u), W / 4.3, d.H * 0.0055, d.H * 0.007, 0, lipD, 0, 0.002);
          }
          if (o > 0.08) for (let i = -5; i <= 5; i++) {                  // needle teeth, top and bottom, uneven
            const u = i / 5.6, hgt = gap * (1 - u * u * 0.75), L = Math.min(hgt * 0.62, ry * (0.16 + 0.07 * ((i * 7 + 14) % 3))), r0 = W / 13;
            g.push(A.chain(A.T(u * W, my + curve(u) + ry * 0.02, zc(u) - 0.003), A.Rx(Math.PI))); g.lathe(0, 0, 0, [[r0, 0], [r0 * 0.55, L * 0.55], [0, L]], H('#f1ecdf'), MAT.CERAMIC, 5); g.pop();
            const u2 = (i + 0.5) / 5.6; if (Math.abs(u2) > 0.95) continue; const h2 = gap * (1 - u2 * u2 * 0.75), L2 = Math.min(h2 * 0.5, ry * (0.13 + 0.06 * ((i * 5 + 11) % 3)));
            g.push(A.T(u2 * W, my + curve(u2) - h2 + ry * 0.02, zc(u2) - 0.003)); g.lathe(0, 0, 0, [[r0, 0], [r0 * 0.55, L2 * 0.55], [0, L2]], H('#e6dfcf'), MAT.CERAMIC, 5); g.pop();
          }
          if (o > 0.5) g.ellipsoid(0, my - gap * 0.55, mz + 0.004, W * 0.45, gap * 0.22, rz * 0.03, H('#5e1218'), 0, 8, 5);   // tongue, deep in
          for (const sd of [-1, 1]) g.ellipsoid(sd * W * 1.0, my + ry * 0.2, zc(1) + 0.02, rx * 0.13, ry * 0.1, rz * 0.07, shade(skin, 1.02), MAT.SKIN, 8, 5);
        } else if (mouth === 'grin') {
          // wide, wrong smile: dark mouth, teeth, corners pulled up
          for (let i = -5; i <= 5; i++) {
            const u = i / 5, yy = my + u * u * ry * 0.16, zz = mz - (1 - u * u) * 0.012;
            g.rbox(u * rx * 0.46, yy - ry * 0.05 * (1 - u * u), zz, rx * 0.1, ry * 0.1 * (1 - u * u) + 0.004, 0.01, 0, H('#2a0d0d'), 0, 0.002);
            if (Math.abs(i) < 5) g.rbox(u * rx * 0.44, yy - 0.002, zz - 0.006, rx * 0.075, ry * 0.045 * (1 - u * u * 0.7), 0.006, 0, H('#efe9dc'), MAT.CERAMIC, 0.002);
          }
          for (const s of [-1, 1]) g.ellipsoid(s * rx * 0.48, my + ry * 0.12, mz + 0.01, rx * 0.16, ry * 0.12, rz * 0.08, shade(skin, 1.02), MAT.SKIN, 8, 5);
        } else if (mouth === 'open') g.ellipsoid(0, my - ry * 0.02, mz, rx * 0.2, ry * 0.13, rz * 0.06, H('#2a0d0d'), 0, 10, 6);
        else if (mouth === 'o') g.ellipsoid(0, my, mz, rx * 0.09, ry * 0.08, rz * 0.05, H('#2a0d0d'), 0, 8, 5);
        else for (let i = -4; i <= 4; i++) { const u = i / 4, w = 1 - u * u * 0.8; g.rbox(u * rx * 0.24, my + d.H * 0.0028 * w, mz - (1 - u * u) * 0.005, rx * 0.075, d.H * 0.003 * w + 0.0008, d.H * 0.006, 0, shade(lip, 0.9), 0, 0.0015); g.rbox(u * rx * 0.22, my - d.H * 0.0026 * w, mz - (1 - u * u) * 0.006, rx * 0.07, d.H * 0.0036 * w + 0.0008, d.H * 0.007, 0, lip, 0, 0.002); }
        // hair
        const hc = H(c.hair[1]), st = c.hair[0];
        if (st === 'short' || st === 'bun' || st === 'ponytail' || st === 'braid') {
          const s = st === 'short' ? 1.07 : 1.06;
          g.ellipsoid(0, cy + ry * 0.04, rz * 0.02, rx * s, ry * s, rz * s, hc, MAT.HAIR, 16, 10, (x, y, z) => y > (z < -0.25 ? 0.5 - 0.22 * Math.abs(x) : 0.18) || (z > 0.15 && y > -0.55) || (Math.abs(x) > 0.75 && y > -0.1 && z > -0.3));
          if (st === 'bun') g.ellipsoid(0, cy + ry * 0.75, rz * 0.65, rx * 0.42, ry * 0.36, rz * 0.4, hc, MAT.HAIR, 10, 6);
          if (st === 'ponytail') g.tube([[0, cy + ry * 0.55, rz * 0.9], [0, cy + ry * 0.1, rz * 1.25], [0, cy - ry * 0.8, rz * 1.2], [0, cy - ry * 1.5, rz * 1.0]], [rx * 0.25, rx * 0.22, rx * 0.17, rx * 0.06], hc, MAT.HAIR, 8);
          if (st === 'braid') for (let i = 0; i < 8; i++) g.ellipsoid(0, cy - ry * 0.1 - i * ry * 0.25, rz * (1.08 - i * 0.02), rx * (0.17 - i * 0.008), ry * 0.15, rz * 0.13, hc, MAT.HAIR, 8, 5);
        } else if (st === 'buzz') {
          g.ellipsoid(0, cy + ry * 0.02, 0, rx * 1.025, ry * 1.025, rz * 1.025, hc, MAT.HAIR, 16, 10, (x, y, z) => y > (z < -0.25 ? 0.56 - 0.18 * Math.abs(x) : 0.3) || (z > 0.3 && y > -0.35) || (Math.abs(x) > 0.85 && y > 0.05 && z > -0.2));
        } else if (st === 'beanie') {
          const bc = H(c.hat);
          g.ellipsoid(0, cy + ry * 0.12, rz * 0.02, rx * 1.12, ry * 1.08, rz * 1.12, bc, fab, 16, 10, (x, y, z) => y > 0.18);
          g.torus(0, cy + ry * 0.28, 0.0, rx * 1.05, ry * 0.12, shade(bc, 0.85), fab, 18, 6);
          g.sphere(0, cy + ry * 1.18, 0, rx * 0.32, H('#f2f0ea'), fab, 10);
          g.ellipsoid(0, cy + ry * 0.05, rz * 0.2, rx * 1.05, ry * 0.5, rz * 1.0, hc, MAT.HAIR, 12, 6, (x, y, z) => z > 0.35 && y < 0.4);
        }
        if (c.beard) g.ellipsoid(0, cy - ry * 0.32, -rz * 0.06, rx * 0.86, ry * 0.66, rz * 0.9, H(c.beard), MAT.HAIR, 14, 8, (x, y, z) => y < -0.12 && z < 0.4 && !(y > -0.5 && Math.abs(x) < 0.25 && z < -0.6));
        if (c.glasses) {
          const gc = H('#2a2a2c');
          for (const s of [-1, 1]) { g.push(A.chain(A.T(s * ex, ey, ez - rz * 0.12), A.Rx(Math.PI / 2))); g.torus(0, 0, 0, rx * 0.22, d.H * 0.004, gc, MAT.METAL, 14, 4); g.pop(); g.box(s * rx * 0.8, ey - 0.003, ez + rz * 0.35, d.H * 0.004, d.H * 0.004, rz * 0.9, 0, gc, MAT.METAL); }
          g.box(0, ey + ry * 0.02, ez - rz * 0.12, rx * 0.3, d.H * 0.004, d.H * 0.004, 0, gc, MAT.METAL);
        }
      } else if (part === 'upper') {
        g.capsule(d.upper, d.armR * 1.2 * sleeve, d.armR * 1.05 * sleeve, top, fab, 10);
      } else if (part === 'fore') {
        g.capsule(d.fore, d.armR * 1.05 * sleeve, d.armR * 0.9 * (puff ? 1.3 : sleeve), top, fab, 10);
        if (puff) g.torus(0, -d.fore * 0.92, 0, d.armR * 1.05, d.armR * 0.35, shade(top, 0.85), fab, 12, 5);
        if (c.watch && extra === 'L') { g.torus(0, -d.fore * 0.88, 0, d.armR * 0.95, d.H * 0.006, H('#2a2a2c'), MAT.LEATHER, 12, 4); g.push(A.chain(A.T(d.armR * 0.95, -d.fore * 0.88, 0), A.Rz(-Math.PI / 2))); g.cyl(0, -0.004, 0, d.H * 0.011, 0.008, H('#d7d9db'), MAT.METAL, 12); g.pop(); }
      } else if (part === 'hand') {
        const hc = c.mittens ? H(c.mittens) : skin, m = c.mittens ? fab : MAT.SKIN;
        if (c.mittens) {
          g.ellipsoid(0, -d.hand * 0.45, 0, d.hand * 0.42 * 1.15, d.hand * 0.55, d.hand * 0.22 * 1.4, hc, m, 10, 6);
          g.ellipsoid(extra === 'R' ? -d.hand * 0.32 : d.hand * 0.32, -d.hand * 0.28, -d.hand * 0.12, d.hand * 0.13, d.hand * 0.3, d.hand * 0.12, hc, m, 6, 4);
        } else {
          // a palm, four fingers with a slight curl, and a thumb
          const HL = d.hand * 1.55, sd = extra === 'R' ? -1 : 1, pw = HL * 0.26;
          g.ellipsoid(0, -HL * 0.02, 0, d.armR * 0.72, HL * 0.1, d.armR * 0.6, hc, m, 8, 5);                                    // wrist
          g.ellipsoid(0, -HL * 0.27, 0, pw, HL * 0.27, HL * 0.085, hc, m, 10, 6);                                               // palm
          for (let i = 0; i < 4; i++) {
            const x = (-0.75 + i * 0.5) * pw * sd, L = HL * (0.4 - Math.abs(i - 1.3) * 0.045), r = HL * 0.042;
            g.tube([[x, -HL * 0.46, 0], [x * 1.04, -HL * 0.46 - L * 0.5, -HL * 0.035], [x * 1.05, -HL * 0.46 - L, -HL * 0.11]], [r, r * 0.92, r * 0.72], hc, m, 6);
          }
          g.tube([[sd * pw * 0.85, -HL * 0.16, -HL * 0.02], [sd * pw * 1.35, -HL * 0.33, -HL * 0.07], [sd * pw * 1.4, -HL * 0.5, -HL * 0.12]], [HL * 0.055, HL * 0.048, HL * 0.036], hc, m, 6);
        }
      } else if (part === 'thigh') {
        g.capsule(d.thigh, d.legR * (c.fem ? 1.42 : 1.4), d.legR * 1.0, pants, fab, 12);
        g.ellipsoid(0, -d.thigh * 0.98, -d.legR * 0.25, d.legR * 0.8, d.legR * 0.9, d.legR * 0.75, pants, fab, 8, 5);   // knee
      } else if (part === 'shin') {
        const sc = c.boots ? shoes : pants;
        if (c.boots) { g.capsule(d.shin * 0.55, d.legR * 0.85, d.legR * 0.7, pants, fab, 10); g.push(A.T(0, -d.shin * 0.45, 0)); g.capsule(d.shin * 0.55, d.legR * 0.95, d.legR * 0.75, sc, MAT.LEATHER, 10); g.pop(); }
        else { g.capsule(d.shin, d.legR * 0.96, d.legR * 0.7, sc, fab, 10); g.ellipsoid(0, -d.shin * 0.3, d.legR * 0.28, d.legR * 0.82, d.shin * 0.3, d.legR * 0.8, sc, fab, 8, 6); }   // calf
      } else if (part === 'foot') {
        const L = d.H * 0.15;
        g.rbox(0, -d.footH, -L * 0.25, d.legR * 1.6, d.footH * 1.15, L, 0, shoes, MAT.LEATHER, d.footH * 0.45);
        g.ellipsoid(0, -d.footH * 0.35, -L * 0.52, d.legR * 0.8, d.footH * 0.6, L * 0.24, shoes, MAT.LEATHER, 8, 5);   // toe cap
        g.box(0, -d.footH, -L * 0.25, d.legR * 1.62, d.footH * 0.25, L * 1.01, 0, shade(shoes, id === 'you' ? 0.9 : 0.7), MAT.LEATHER);
      }
    });
  }

  // held props
  function propMesh(name) {
    return mesh('prop:' + name, (g) => {
      if (name === 'plate') { g.lathe(0, 0, 0, [[0, 0], [0.07, 0, 1], [0.13, 0.015], [0.135, 0.022, 1], [0.12, 0.02, 1], [0.07, 0.01], [0, 0.01]], H('#f2f0ea'), MAT.CERAMIC, 18); }
      else if (name === 'pillow') g.rbox(0, -0.21, 0, 0.45, 0.42, 0.14, 0, H('#c9b8a3'), MAT.FABRIC, 0.08);
      else if (name === 'keys') { g.torus(0, 0, 0, 0.025, 0.004, H('#c9ccd0'), MAT.METAL, 10, 4); for (let i = 0; i < 4; i++) g.box(Math.cos(i) * 0.03, -0.04, Math.sin(i) * 0.01, 0.012, 0.06, 0.003, i * 0.4, H(i % 2 ? '#c9a24b' : '#c9ccd0'), MAT.METAL); }
      else if (name === 'train') { g.rbox(0, -0.03, -0.04, 0.06, 0.05, 0.14, 0, H('#2f6fd0'), MAT.CERAMIC, 0.01); g.rbox(0, 0.02, 0.0, 0.06, 0.05, 0.06, 0, H('#2f6fd0'), MAT.CERAMIC, 0.01); g.cyl(0, 0.02, -0.08, 0.012, 0.03, H('#2a2a2c'), 0, 8); for (const s of [-1, 1]) for (const z of [-0.08, 0.0]) { g.push(A.chain(A.T(s * 0.032, -0.03, z), A.Rz(Math.PI / 2))); g.cyl(0, -0.006, 0, 0.018, 0.012, H('#d0342c'), 0, 10); g.pop(); } }
      else if (name === 'bell') { g.lathe(0, 0, 0, [[0.03, 0, 1], [0.025, 0.01], [0.018, 0.03], [0.014, 0.045], [0.004, 0.05], [0, 0.05]], H('#d6b24a'), MAT.METAL, 12); g.sphere(0, -0.004, 0, 0.007, H('#8a6a2a'), MAT.METAL, 6); }
    });
  }

  // ---------- skeleton ----------
  function zeroPose() {
    return { bob: 0, sitH: null, pelvisX: 0, lean: 0, twist: 0, side: 0, neckX: 0, headY: 0, headX: 0, headZ: 0,
      shX: [0, 0], shY: [0, 0], shZ: [0.06, 0.06], el: [0.12, 0.12], wr: [0, 0], hipX: [0, 0], hipZ: [0, 0], kn: [0.04, 0.04], an: [0, 0] };
  }
  // fill pose from actor state
  function pose(a, t) {
    const P = zeroPose(), ph = a.phase || 0;
    const kid = dims(a.id).k;
    if (a.anim === 'walk' || a.anim === 'run') {
      const run = a.anim === 'run', Ah = run ? 0.72 : 0.42, Aa = run ? 0.75 : 0.32;
      for (const [i, s] of [[0, Math.PI], [1, 0]]) {
        const p = ph + s;
        P.hipX[i] = Ah * Math.sin(p);
        P.kn[i] = (run ? 1.5 : 0.75) * Math.max(0, Math.sin(p - 1.2)) + 0.08;
        P.an[i] = -0.25 * Math.sin(p) + (run ? 0.2 : 0);
        P.shX[i] = -Aa * Math.sin(p);
        P.el[i] = run ? 1.35 : 0.25 + 0.15 * Math.max(0, -Math.sin(p));
      }
      P.bob = -Math.abs(Math.cos(ph)) * (run ? 0.06 : 0.025) + (run ? 0.0 : 0.01);
      P.lean = run ? 0.22 : 0.05; P.twist = 0.08 * Math.sin(ph) * (run ? 1.5 : 1); P.headY = -P.twist * 0.8;
      if (kid > 0.8 && !run) { P.bob += 0.02 * Math.abs(Math.sin(ph * 2)); }
    } else if (a.anim === 'sit') {
      P.sitH = a.sitH || 0.46; P.hipX = [1.45, 1.45]; P.kn = [1.45, 1.45]; P.an = [0.05, 0.05]; P.lean = -0.12;
      P.shX = [0.35, 0.35]; P.el = [0.9, 0.9]; P.shZ = [0.25, 0.25];
    } else if (a.anim === 'crouch') {
      P.hipX = [1.3, 1.1]; P.kn = [2.1, 2.0]; P.an = [0.7, 0.8]; P.lean = 0.45; P.bob = -dims(a.id).legs * 0.42; P.shX = [0.9, 0.9]; P.el = [1.0, 1.0];
    } else {
      const br = a.still ? 0 : Math.sin(t * 1.7 + (a.seed || 0));
      P.lean = 0.015 * br; P.shZ = [0.08, 0.08]; P.el = [0.14, 0.16]; P.headX = 0.02 * br;
      P.hipX = [0.02, -0.02]; P.hipZ = [0.02, 0.02];
    }
    // look at a point
    if (a.look) {
      const dx = a.look[0] - a.x, dz = a.look[2] - a.z, want = Math.atan2(dx, -dz);
      let d = want - a.yaw; while (d > Math.PI) d -= TAU; while (d < -Math.PI) d += TAU;
      const owl = a.owl ? 1.45 : 1.1;   // owl: the head turns right to the shoulder and holds there, and the body does not follow. Never further: from behind you see hair, not a face.
      d = clamp(d, -1.6, 1.6);
      const hd = Math.hypot(dx, dz), dy = a.look[1] - ((a.y || 0) + dims(a.id).H * 0.93);
      const hy = clamp(d, -owl, owl); P.headY = -hy; if (!a.owl) P.twist -= clamp(d - hy, -0.6, 0.6);   // the rig turns with Ry(-yaw), so a turn toward +yaw is a negative head angle
      P.headX = clamp(-Math.atan2(dy, hd) * 0.8, -0.6, 0.6);
    }
    // gestures (blended)
    const gs = a.gest;
    if (gs) {
      const age = t - gs.t0, w = gs.dur ? smooth(Math.min(age / 0.3, (gs.dur - age) / 0.3, 1)) : smooth(age / 0.3);
      if (!gs.dur || age < gs.dur) gesture(P, gs.name, w, t, age);
    }
    if (a.holdHand != null) { const i = a.holdHand; P.shX[i] = lerp(P.shX[i], 0.25, 0.8); P.shZ[i] = 0.32; P.el[i] = 0.25; }
    if (a.tweak) a.tweak(P, t);
    return P;
  }
  function gesture(P, name, w, t, age) {
    const set = (k, i, v) => { if (i == null) P[k] = lerp(P[k], v, w); else P[k][i] = lerp(P[k][i], v, w); };
    switch (name) {
      case 'watch': set('shX', 0, 1.25); set('shY', 0, -0.9); set('shZ', 0, 0.1); set('el', 0, 1.75); set('headX', null, 0.42); set('headY', null, -0.3); break;
      case 'wave': set('shX', 1, 0.35); set('shZ', 1, 2.5 + 0.25 * Math.sin(t * 9)); set('el', 1, 0.6); break;
      case 'wavePillow': set('shX', 1, 2.7); set('shZ', 1, 0.3 + 0.3 * Math.sin(t * 7)); set('el', 1, 0.3); set('shX', 0, 2.5); set('shZ', 0, 0.3 + 0.3 * Math.sin(t * 7 + 1)); set('el', 0, 0.3); break;
      case 'point': set('shX', 1, 1.45); set('shZ', 1, 0.1); set('el', 1, 0.05); break;
      case 'cross': for (const i of [0, 1]) { set('shX', i, 0.55); set('shY', i, i ? 0.55 : -0.55); set('shZ', i, 0.18); set('el', i, 1.95); } break;
      case 'hips': for (const i of [0, 1]) { set('shX', i, -0.15); set('shZ', i, 0.55); set('shY', i, i ? -0.9 : 0.9); set('el', i, 1.5); } break;
      case 'hold': set('shX', 1, 0.45); set('el', 1, 1.05); set('shZ', 1, 0.08); break;
      case 'hold2': for (const i of [0, 1]) { set('shX', i, 0.4); set('el', i, 1.1); set('shZ', i, 0.05); set('shY', i, i ? 0.25 : -0.25); } set('headX', null, 0.3); break;
      case 'reach': set('shX', 1, 1.2); set('el', 1, 0.25); set('shZ', 1, 0.05); set('lean', null, 0.12); break;
      case 'reachHigh': set('shX', 1, 2.0); set('el', 1, 0.3); break;
      case 'lock': set('shX', 1, 1.35); set('el', 1, 0.5); set('wr', 1, 0.6 * Math.sin(age * 6)); set('shY', 1, -0.3); break;
      case 'shake': set('headY', null, 0.42 * Math.sin(age * 6)); break;
      case 'nod': set('headX', null, 0.2 + 0.2 * Math.sin(age * 8)); break;
      case 'shrug': for (const i of [0, 1]) { set('shX', i, 0.25); set('shZ', i, 0.35); set('el', i, 1.3); set('shY', i, i ? -0.6 : 0.6); } set('headZ', null, 0.2); break;
      case 'scream': for (const i of [0, 1]) { set('shX', i, 2.6); set('shZ', i, 0.35); set('el', i, 0.4); } set('headX', null, -0.2); break;
      case 'push': for (const i of [0, 1]) { set('shX', i, 1.4); set('el', i, 0.2); set('shZ', i, 0.08); } set('lean', null, 0.2); break;
      case 'whisper': set('lean', null, 0.18); set('headX', null, 0.15); set('shX', 1, 1.2); set('shY', 1, -0.5); set('el', 1, 2.1); break;
      case 'armsOut': for (const i of [0, 1]) { set('shX', i, 0.7); set('shZ', i, 0.9); set('el', i, 0.3); } break;
      case 'talk': set('shX', 1, 0.5 + 0.15 * Math.sin(t * 3)); set('el', 1, 1.2 + 0.2 * Math.sin(t * 4)); set('shZ', 1, 0.2); set('headZ', null, 0.06 * Math.sin(t * 2)); break;
      case 'sigh': set('lean', null, 0.1); set('headX', null, -0.25 + 0.4 * smooth(age / 1.2)); for (const i of [0, 1]) set('shZ', i, 0.02); break;
      case 'grab': set('shX', 1, 1.55); set('el', 1, 0.2); set('lean', null, 0.3); break;
      case 'lookUp': set('headX', null, -0.75); set('neckX', null, -0.2); break;
      case 'fluff': set('lean', null, 0.5); for (const i of [0, 1]) { set('shX', i, 1.0 + 0.2 * Math.sin(t * 9 + i)); set('el', i, 0.4); } break;
      case 'hand': set('shX', 1, 0.25); set('shZ', 1, 0.35); set('el', 1, 0.2); break;
      case 'fold': for (const i of [0, 1]) { set('shX', i, 0.38); set('shY', i, i ? 0.5 : -0.5); set('shZ', i, 0.04); set('el', i, 0.75); } break;
      case 'tiltHead': set('headZ', null, 0.42); break;
      case 'bow': set('headX', null, 0.75); set('lean', null, 0.1); for (const i of [0, 1]) { set('shX', i, 0.38); set('shY', i, i ? 0.5 : -0.5); set('el', i, 0.75); } break;
      case 'glass': for (const i of [0, 1]) { set('shX', i, 1.75); set('shZ', i, 0.5); set('el', i, 0.55); } set('lean', null, 0.16); set('headZ', null, 0.22); break;
      case 'knock': set('shX', 1, 1.55); set('shZ', 1, 0.15); set('el', 1, 1.0 + 0.5 * Math.max(0, Math.sin(age * 14))); break;
      case 'clap': for (const i of [0, 1]) { set('shX', i, 0.95); set('shY', i, i ? 0.62 + 0.14 * Math.sin(age * 5) : -0.62 - 0.14 * Math.sin(age * 5)); set('el', i, 1.25); } break;
      case 'usher': set('shX', 1, 1.2); set('shZ', 1, 0.7); set('el', 1, 0.15); break;
      case 'finger': set('shX', 1, 0.85); set('shY', 1, -0.75); set('el', 1, 2.35); set('headZ', null, 0.12); break;
    }
  }
  // world matrices for all bones
  function rig(a, P) {
    const d = dims(a.id), s = a.scale || 1, B = {};
    const root = A.chain(A.T(a.x, a.y || 0, a.z), A.Ry(-a.yaw), A.S(s));
    const hipY = P.sitH != null ? P.sitH : d.legs + P.bob;
    B.pelvis = A.chain(root, A.T(0, hipY, 0), A.Ry(P.twist * 0.4), A.Rx(P.pelvisX));
    B.chest = A.chain(B.pelvis, A.T(0, d.spine, 0), A.Rx(P.lean), A.Ry(P.twist * 0.6), A.Rz(P.side));
    B.neck = A.chain(B.chest, A.T(0, d.chest, 0), A.Rx(P.neckX - P.lean * 0.6));
    B.head = A.chain(B.neck, A.T(0, d.neck, 0), A.Ry(P.headY), A.Rx(P.headX), A.Rz(P.headZ));
    for (const [i, sd] of [[0, -1], [1, 1]]) {
      const sh = A.chain(B.chest, A.T(sd * d.shW, d.chest * 0.86, 0), A.Ry(P.shY[i]), A.Rx(P.shX[i]), A.Rz(sd * P.shZ[i]));
      const el = A.chain(sh, A.T(0, -d.upper, 0), A.Rx(P.el[i]));
      const wr = A.chain(el, A.T(0, -d.fore, 0), A.Rx(P.wr[i]));
      const hp = A.chain(B.pelvis, A.T(sd * d.hipW, 0, 0), A.Rx(P.hipX[i]), A.Rz(sd * P.hipZ[i]));
      const kn = A.chain(hp, A.T(0, -d.thigh, 0), A.Rx(-P.kn[i]));
      const an = A.chain(kn, A.T(0, -d.shin, 0), A.Rx(P.an[i] + P.kn[i] - P.hipX[i] * (P.sitH != null ? 1 : 0.5)));
      B['sh' + i] = sh; B['el' + i] = el; B['wr' + i] = wr; B['hp' + i] = hp; B['kn' + i] = kn; B['an' + i] = an;
    }
    return B;
  }
  function blink(a, t) {
    const per = 3.7 + ((a.seed || 0) % 1.3);
    return ((t + (a.seed || 0)) % per) < 0.12;
  }
  function drawPerson(buf, a, t) {
    if (a.visible === false) return;
    const P = pose(a, t), B = rig(a, P), id = a.id;
    const f = a.face || {};
    const eyes = (f.eyes === 'closed' || (f.eyes !== 'narrow' && f.eyes !== 'stare' && !a.noBlink && blink(a, t))) ? 'closed' : (f.eyes || 'open');
    buf.emit(personPart(id, 'pelvis'), B.pelvis);
    buf.emit(personPart(id, 'chest'), B.chest);
    buf.emit(personPart(id, 'neck'), B.neck);
    // 'maw': the mouth opens slowly from a closed smile (f.open goes 0..1; twelve steps, each cached)
    const mouth = f.mouth === 'maw' ? 'maw' + Math.round(clamp(f.open == null ? 1 : f.open, 0, 1) * 12) : (f.mouth || 'neutral');
    buf.emit(personPart(id, 'head', `${eyes},${f.brows || 'flat'},${mouth}`), B.head);
    for (const i of [0, 1]) {
      const sd = i ? 'R' : 'L';
      buf.emit(personPart(id, 'upper'), B['sh' + i]);
      buf.emit(personPart(id, 'fore', sd), B['el' + i]);
      buf.emit(personPart(id, 'hand', sd), B['wr' + i]);
      buf.emit(personPart(id, 'thigh'), B['hp' + i]);
      buf.emit(personPart(id, 'shin'), B['kn' + i]);
      buf.emit(personPart(id, 'foot'), B['an' + i]);
    }
    const d = dims(id);
    for (const [k, i] of [['R', 1], ['L', 0]]) {
      const item = a['hold' + k];
      if (item) buf.emit(propMesh(item), A.chain(B['wr' + i], A.T(0, -d.hand * 0.6, -d.hand * 0.25), item === 'plate' ? A.Rx(Math.PI / 2) : A.I()));
    }
    a._B = B;
  }
  // world position of a hand (for holding hands)
  function handPos(a, i) { const B = a._B; if (!B) return null; const d = dims(a.id); return A.p(B['wr' + i], 0, -d.hand * 0.5, 0); }

  // ---------- Krampus ----------
  const KC = { fur: '#2a1e17', fur2: '#3b2a1f', skin: '#2b1916', horn: '#cdbf9f', hornTip: '#5e5038', eye: '#ffae1f', tongue: '#a8222e', teeth: '#e8e2d0', chain: '#7d8288', bell: '#d6b24a', sack: '#8a6a46', hoof: '#151110' };
  const KD = { hip: 1.62, spine: 0.45, chest: 0.9, neck: 0.3, shW: 0.46, upper: 0.86, fore: 0.92, hand: 0.3, thigh: 0.68, shin: 0.66, meta: 0.44, hipW: 0.22 };
  function tufts(g, n, cx, cy, cz, rx, ry, rz, len, seed, keep) {
    const r = mulberry32(seed);
    for (let i = 0; i < n; i++) {
      const u = r() * TAU, v = r() * 2 - 1, c = Math.sqrt(1 - v * v);
      const nx = Math.cos(u) * c, ny = v, nz = Math.sin(u) * c;
      if (keep && !keep(nx, ny, nz)) continue;
      const px = cx + nx * rx, py = cy + ny * ry, pz = cz + nz * rz;
      const dir = [nx * 0.6, ny * 0.3 - 0.75, nz * 0.6];
      g.push(A.mul(A.T(px, py, pz), A.alignY([-dir[0], -dir[1], -dir[2]])));
      const L = len * (0.6 + r() * 0.7);
      g.ellipsoid(0, -L * 0.5, 0, L * 0.11, L * 0.58, L * 0.07, shade(H(r() < 0.5 ? KC.fur : KC.fur2), 0.7 + r() * 0.6), MAT.FUR, 5, 4);
      g.pop();
    }
  }
  function horn(g, side) {
    const pts = [], rad = [];
    for (let i = 0; i <= 16; i++) {
      const t = i / 16, a = t * 2.6;
      pts.push([side * (0.08 + 0.4 * t + 0.16 * Math.sin(a)), 0.2 + 0.78 * Math.sin(Math.min(a, 1.9)) - 0.4 * Math.max(0, t - 0.6), 0.02 + 0.62 * (1 - Math.cos(a)) * 0.6]);
      rad.push(0.09 * (1 - t) + 0.006);
    }
    g.tube(pts, rad, H(KC.horn), MAT.CERAMIC, 8);
    for (let i = 2; i < 14; i += 2) { const p = pts[i]; g.push(A.T(p[0], p[1], p[2])); g.sphere(0, 0, 0, rad[i] * 1.08, shade(H(KC.horn), 0.85), MAT.CERAMIC, 6); g.pop(); }
    g.push(A.T(...pts[16])); g.sphere(0, 0, 0, 0.012, H(KC.hornTip), MAT.CERAMIC, 6); g.pop();
  }
  function kPart(part, extra = '') {
    return mesh('k:' + part + ':' + extra, (g) => {
      const fur = H(KC.fur), skin = H(KC.skin);
      if (part === 'pelvis') {
        g.ellipsoid(0, 0.08, 0, 0.36, 0.3, 0.3, fur, MAT.FUR, 14, 8);
        tufts(g, 50, 0, 0.0, 0, 0.36, 0.28, 0.3, 0.3, 11);
        // chain belt + bells
        const pts = []; for (let i = 0; i <= 18; i++) { const a = i / 18 * TAU; pts.push([Math.sin(a) * 0.39, 0.22 + 0.04 * Math.sin(a * 2), -Math.cos(a) * 0.33]); }
        for (let i = 0; i < 18; i++) { const p = pts[i], q = pts[i + 1]; g.push(A.mul(A.T(p[0], p[1], p[2]), A.alignY([q[0] - p[0], q[1] - p[1], q[2] - p[2]]))); g.push(i % 2 ? A.Rz(Math.PI / 2) : A.I()); g.push(A.Rx(Math.PI / 2)); g.torus(0, 0, 0, 0.035, 0.01, H(KC.chain), MAT.METAL, 8, 4); g.pop(); g.pop(); g.pop(); }
        for (let i = 0; i < 5; i++) { const a = -0.9 + i * 0.45; g.push(A.T(Math.sin(a) * 0.4, 0.1, -Math.cos(a) * 0.34)); g.lathe(0, -0.1, 0, [[0.07, 0, 1], [0.06, 0.02], [0.045, 0.07], [0.035, 0.1], [0.008, 0.115], [0, 0.115]], H(KC.bell), MAT.METAL, 12); g.sphere(0, -0.105, 0, 0.018, H('#7a5a20'), MAT.METAL, 6); g.cyl(0, 0.01, 0, 0.004, 0.11, H(KC.chain), MAT.METAL, 4); g.pop(); }
        g.lathe(0, -0.3, 0, [[0.42, 0, 1], [0.38, 0.25], [0.36, 0.42, 1]], shade(fur, 1.1), MAT.FUR, 16);
      } else if (part === 'chest') {
        g.ellipsoid(0, 0.4, 0, 0.42, 0.55, 0.32, fur, MAT.FUR, 16, 10);
        g.ellipsoid(0, 0.8, 0.05, 0.5, 0.3, 0.36, shade(fur, 1.1), MAT.FUR, 16, 8);
        tufts(g, 120, 0, 0.45, 0, 0.42, 0.55, 0.32, 0.36, 22);
        tufts(g, 60, 0, 0.85, 0.05, 0.5, 0.28, 0.36, 0.42, 33, (x, y) => y > -0.2);
        g.ellipsoid(0, 0.35, -0.24, 0.26, 0.3, 0.1, shade(skin, 1.05), MAT.SKIN, 12, 8);
        // diagonal chain across the chest
        const pts = []; for (let i = 0; i <= 20; i++) { const t = i / 20; pts.push([lerp(-0.42, 0.38, t), lerp(0.95, 0.05, t), -0.33 - 0.06 * Math.sin(t * Math.PI)]); }
        for (let i = 0; i < 20; i++) { const p = pts[i], q = pts[i + 1]; g.push(A.mul(A.T(p[0], p[1], p[2]), A.alignY([q[0] - p[0], q[1] - p[1], q[2] - p[2]]))); g.push(i % 2 ? A.Ry(Math.PI / 2) : A.I()); g.push(A.Rx(Math.PI / 2)); g.torus(0, 0, 0, 0.04, 0.011, H(KC.chain), MAT.METAL, 8, 4); g.pop(); g.pop(); g.pop(); }
        g.tube([[0.35, 0.95, -0.12], [0.45, 0.6, 0.25], [0.3, 0.2, 0.42]], 0.03, H('#5a4530'), MAT.LEATHER, 6, false);
        // ribs showing through the hide, and a row of bone spines down the back
        for (let i = 0; i < 4; i++) for (const sd of [-1, 1]) g.tube([[sd * 0.04, 0.5 - i * 0.09, -0.335], [sd * 0.16, 0.47 - i * 0.09, -0.31], [sd * 0.26, 0.43 - i * 0.09, -0.22]], [0.016, 0.014, 0.008], H('#6b5348'), MAT.SKIN, 5);
        for (let i = 0; i < 7; i++) { const y = 0.98 - i * 0.14, L = 0.2 - Math.abs(i - 2) * 0.022; g.push(A.chain(A.T(0, y, 0.3 + 0.05 * Math.sin(i * 0.6)), A.Rx(1.15))); g.lathe(0, 0, 0, [[0.035, 0], [0.022, L * 0.5], [0, L]], H(KC.horn), MAT.CERAMIC, 6); g.pop(); }
      } else if (part === 'neck') {
        g.capsule(0.34, 0.2, 0.24, H(KC.fur), MAT.FUR, 12);
        g.push(A.T(0, 0.05, 0)); tufts(g, 40, 0, -0.15, 0, 0.22, 0.2, 0.22, 0.3, 44); g.pop();
      } else if (part === 'head') {
        g.push(A.S(1.25));
        g.ellipsoid(0, 0.12, 0.02, 0.17, 0.19, 0.2, skin, MAT.SKIN, 16, 10);
        g.ellipsoid(0, 0.06, -0.2, 0.115, 0.09, 0.17, skin, MAT.SKIN, 14, 8);
        g.ellipsoid(0, 0.08, -0.34, 0.06, 0.045, 0.04, H('#1a0f0d'), MAT.SKIN, 8, 5);
        g.ellipsoid(0, 0.2, -0.1, 0.16, 0.06, 0.12, shade(skin, 0.8), MAT.SKIN, 12, 6);
        for (const s of [-1, 1]) {
          g.ellipsoid(s * 0.078, 0.14, -0.135, 0.062, 0.046, 0.04, H('#050202'), 0, 10, 6);            // sunken socket
          g.ellipsoid(s * 0.078, 0.138, -0.162, 0.05, 0.036, 0.014, H('#ff2600'), MAT.GLOW, 10, 6);  // ember eye
          g.ellipsoid(s * 0.078, 0.138, -0.172, 0.013, 0.013, 0.004, H('#ffb040'), MAT.GLOW, 6, 4);
          g.ellipsoid(s * 0.078, 0.138, -0.176, 0.004, 0.017, 0.003, H('#100000'), 0, 6, 4);          // slit pupil
          g.ellipsoid(s * 0.085, 0.185, -0.15, 0.07, 0.022, 0.05, shade(skin, 0.55), MAT.SKIN, 8, 5);   // heavy brow
          g.ellipsoid(s * 0.1, 0.06, -0.12, 0.03, 0.05, 0.06, shade(skin, 0.5), MAT.SKIN, 8, 5);       // hollow cheek
          g.push(A.chain(A.T(s * 0.16, 0.16, 0.05), A.Rz(-s * 1.2), A.Rx(-0.3))); g.lathe(0, 0, 0, [[0, 0], [0.05, 0.02], [0.035, 0.12], [0, 0.2]], shade(skin, 0.9), MAT.SKIN, 8); g.pop();
          horn(g, s);
        }
        for (let i = -5; i <= 5; i++) { if (!i) continue; const fang = Math.abs(i) === 2 || Math.abs(i) === 4, L = fang ? 0.12 : 0.045 + 0.02 * ((i * 7) % 3); g.push(A.chain(A.T(i * 0.02, 0.0, -0.31 + Math.abs(i) * 0.016), A.Rx(Math.PI), A.Rz(i * 0.03))); g.lathe(0, 0, 0, [[0.011, 0], [0.008, L * 0.5], [0, L]], shade(H(KC.teeth), 0.8 + 0.2 * ((i * 5) % 2)), MAT.CERAMIC, 6); g.pop(); }
        g.push(A.T(0, -0.04, -0.12)); tufts(g, 26, 0, -0.06, -0.02, 0.1, 0.06, 0.1, 0.2, 55, (x, y) => y < 0.1); g.pop();
        tufts(g, 30, 0, 0.22, 0.12, 0.16, 0.12, 0.16, 0.18, 66, (x, y, z) => z > -0.1 && y > -0.2);
        g.pop();
      } else if (part === 'jaw') {
        g.push(A.S(1.25));
        g.ellipsoid(0, -0.03, -0.12, 0.1, 0.045, 0.14, H(KC.skin), MAT.SKIN, 12, 6);
        for (let i = -5; i <= 5; i++) { if (!i) continue; const fang = Math.abs(i) === 3, L = fang ? 0.1 : 0.035 + 0.015 * ((i * 5) % 3); g.push(A.chain(A.T(i * 0.019, -0.005, -0.225 + Math.abs(i) * 0.016), A.Rz(-i * 0.04))); g.lathe(0, 0, 0, [[0.01, 0], [0.007, L * 0.5], [0, L]], shade(H(KC.teeth), 0.75 + 0.25 * ((i * 3) % 2)), MAT.CERAMIC, 6); g.pop(); }
        g.ellipsoid(0, -0.0, -0.13, 0.07, 0.02, 0.1, H('#2a0a0c'), 0, 10, 5);
        g.pop();
      } else if (part === 'upper') {
        g.capsule(KD.upper, 0.15, 0.11, H(KC.fur), MAT.FUR, 12);
        tufts(g, 34, 0, -KD.upper * 0.45, 0, 0.14, KD.upper * 0.5, 0.13, 0.26, 77 + (extra === 'R' ? 1 : 0));
      } else if (part === 'fore') {
        g.capsule(KD.fore, 0.1, 0.07, H(KC.skin), MAT.SKIN, 10);
        tufts(g, 14, 0, -KD.fore * 0.25, 0, 0.1, KD.fore * 0.25, 0.1, 0.18, 88, (x, y) => y > -0.3);
      } else if (part === 'hand') {
        g.ellipsoid(0, -0.08, 0, 0.09, 0.1, 0.05, H(KC.skin), MAT.SKIN, 10, 6);
        for (let i = 0; i < 4; i++) {
          const x = -0.06 + i * 0.04, L = 0.2 - Math.abs(i - 1.5) * 0.02;
          const pts = [[x, -0.14, 0], [x * 1.1, -0.14 - L * 0.5, -0.025], [x * 1.15, -0.14 - L, -0.07]];
          g.tube(pts, [0.019, 0.016, 0.012], H(KC.skin), MAT.SKIN, 6);
          g.push(A.mul(A.T(...pts[2]), A.alignY([0, -0.6, -0.8]))); g.lathe(0, 0, 0, [[0.016, 0], [0.011, 0.12], [0, 0.3]], H('#120d0a'), MAT.CERAMIC, 6); g.pop();
        }
        g.tube([[0.07, -0.08, -0.02], [0.11, -0.13, -0.06], [0.12, -0.18, -0.09]], [0.02, 0.016, 0.012], H(KC.skin), MAT.SKIN, 6);
      } else if (part === 'thigh') {
        g.capsule(KD.thigh, 0.19, 0.13, H(KC.fur), MAT.FUR, 12);
        tufts(g, 46, 0, -KD.thigh * 0.45, 0, 0.18, KD.thigh * 0.5, 0.18, 0.32, 99 + (extra === 'R' ? 1 : 0));
      } else if (part === 'shin') {
        g.capsule(KD.shin, 0.12, 0.07, H(KC.fur), MAT.FUR, 10);
        tufts(g, 26, 0, -KD.shin * 0.4, 0, 0.11, KD.shin * 0.45, 0.11, 0.24, 111 + (extra === 'R' ? 1 : 0));
      } else if (part === 'meta') {
        g.capsule(KD.meta, 0.06, 0.05, H(KC.skin), MAT.SKIN, 8);
        g.lathe(0, -KD.meta - 0.07, -0.03, [[0, 0], [0.085, 0, 1], [0.08, 0.07], [0.05, 0.09, 1], [0, 0.09]], H(KC.hoof), MAT.CERAMIC, 10);
        g.box(0, -KD.meta - 0.072, -0.08, 0.012, 0.08, 0.1, 0, H('#000000'));
      } else if (part === 'sack') {
        const r = mulberry32(5), sk = H(KC.sack);
        g.ellipsoid(0, -0.35, 0, 0.4, 0.5, 0.34, sk, MAT.FABRIC, 14, 9);
        for (let i = 0; i < 9; i++) g.ellipsoid((r() - 0.5) * 0.5, -0.35 + (r() - 0.5) * 0.6, (r() - 0.5) * 0.4, 0.18, 0.2, 0.16, shade(sk, 0.9 + r() * 0.2), MAT.FABRIC, 8, 5);
        g.lathe(0, 0.05, 0, [[0.14, 0, 1], [0.08, 0.1], [0.12, 0.2, 1], [0, 0.2]], shade(sk, 0.9), MAT.FABRIC, 10);
        g.torus(0, 0.12, 0, 0.09, 0.02, H('#5a4530'), MAT.FABRIC, 10, 4);
        if (extra === 'full') g.ellipsoid(0.12, -0.3, -0.18, 0.2, 0.22, 0.18, shade(sk, 1.05), MAT.FABRIC, 10, 6);
      }
    });
  }
  function kPose(k, t) {
    const P = { roll: 0, hip: KD.hip, pelvisX: 0.08, lean: 0.2, twist: 0, neckX: -0.15, headY: 0, headX: 0.12, headZ: 0, jaw: 0.08,
      shX: [0.12, 0.12], shY: [0, 0], shZ: [0.22, 0.22], el: [0.35, 0.35], wr: [0.25, 0.25],
      hipX: [0.35, 0.35], kn: [1.1, 1.1], an: [0.75, 0.75], sackRot: 0 };
    const ph = k.phase || 0, an = k.anim || 'idle';
    const br = Math.sin(t * 1.3);
    // He never stands like a person. He goes hunched, head low and forward, lurching onto one side with every other
    // step, both arms hanging so low the claws nearly drag. With a child in the sack, one fist holds the rope.
    // (angles: a positive Rx swings a hanging limb forward and tips an upright one back, so a forward hunch is a negative lean)
    const carry = () => { if (!k.sackFull) return; P.shX[1] = 0.15 - P.lean * 0.6; P.shY[1] = -0.4; P.shZ[1] = 0.05; P.el[1] = 1.55; P.wr[1] = 0.3; };   // fist at the collarbone, on the rope
    if (an === 'walk' || an === 'run') {
      const run = an === 'run';
      for (const [i, o] of [[0, Math.PI], [1, 0]]) {
        const p = ph + o;
        P.hipX[i] = (run ? 0.55 : 0.5) + (run ? 0.8 : 0.5) * Math.sin(p);
        P.kn[i] = (run ? 1.25 : 1.3) + (run ? 0.75 : 0.45) * Math.max(0, Math.sin(p - 1.0));
        P.an[i] = 0.8 + 0.3 * Math.sin(p + 0.6);
      }
      const lurch = Math.max(0, Math.sin(ph));                                  // drops onto the left leg
      P.hip = KD.hip - (run ? 0.2 : 0.16) - Math.abs(Math.cos(ph)) * (run ? 0.12 : 0.05) - lurch * (run ? 0.05 : 0.11);
      P.roll = (run ? 0.1 : 0.17) * Math.sin(ph); P.twist = (run ? 0.2 : 0.16) * Math.sin(ph);
      P.lean = run ? -0.95 : -0.62; P.neckX = run ? 0.5 : 0.3; P.headX = run ? 0.35 : 0.18;
      P.headY = run ? 0 : 0.45 * Math.sin(t * 0.8) + 0.1 * Math.sin(t * 2.9);  // searching, side to side
      P.headZ = run ? 0.1 * Math.sin(ph) : 0.16 * Math.sin(t * 1.3) + (Math.sin(t * 0.37) > 0.93 ? 0.35 : 0);   // and now and then it snaps over
      P.jaw = run ? 0.5 : 0.12 + 0.06 * Math.sin(t * 1.7);
      // the long arm: hangs and sways when he prowls, rakes the air when he runs
      for (const [i, sg] of [[0, 1], [1, -1]]) {
        P.shX[i] = run ? 0.45 + sg * 0.4 * Math.sin(ph) : 0.5 - sg * 0.2 * Math.sin(ph);
        P.shZ[i] = run ? 0.5 : 0.3 + i * 0.1; P.el[i] = run ? 0.55 : 0.2 + i * 0.25 + 0.1 * Math.sin(ph + i); P.wr[i] = run ? 0.75 : 0.55;
      }
      carry();
      P.sackRot = (run ? 0.22 : 0.14) * Math.sin(ph * 2);
    } else if (an === 'crouch') {
      P.hip = 0.95; P.hipX = [1.1, 0.95]; P.kn = [2.1, 2.0]; P.an = [1.2, 1.3]; P.lean = 0.9; P.neckX = -1.1; P.shX = [1.0, 1.1]; P.el = [0.6, 0.7]; P.shZ = [0.4, 0.4];
    } else if (an === 'leap') {
      P.hip = KD.hip + 0.1; P.hipX = [-0.2, 0.9]; P.kn = [0.3, 1.6]; P.an = [0.2, 0.9]; P.lean = 0.2; P.neckX = -0.3; P.shX = [2.4, 2.6]; P.shZ = [0.3, 0.3]; P.el = [0.3, 0.3];
    } else if (an === 'land') {
      P.hip = 1.0; P.hipX = [1.0, 1.2]; P.kn = [2.0, 2.1]; P.an = [1.2, 1.3]; P.lean = 0.95; P.neckX = -1.2; P.shX = [0.9, 0.7]; P.shZ = [1.1, 1.1]; P.el = [0.3, 0.3];
    } else if (k.gest && (k.gest.name === 'peer' || k.gest.name === 'scare')) {
      P.lean += 0.03 * br; P.shX = [0.12 + 0.05 * br, 0.12 - 0.05 * br];   // the two close-ups were staged from this upright stance
    } else {
      // standing: hunched, breathing, head sweeping, claws flexing
      P.hip = KD.hip - 0.14; P.hipX = [0.5, 0.42]; P.kn = [1.32, 1.24]; P.lean = -0.5 - 0.04 * br; P.neckX = 0.25; P.headX = 0.15;
      P.headY = 0.55 * Math.sin(t * 0.55); P.headZ = 0.14 * Math.sin(t * 0.9) + (Math.sin(t * 0.31) > 0.94 ? 0.38 : 0);
      P.shX = [0.42 + 0.05 * br, 0.4 - 0.04 * br]; P.shZ = [0.36, 0.42]; P.el = [0.25, 0.5]; P.wr = [0.45 + 0.25 * Math.sin(t * 2.1), 0.5 + 0.2 * Math.sin(t * 1.6 + 1)];
      carry();
    }
    if (k.look) {
      const dx = k.look[0] - k.x, dz = k.look[2] - k.z; let d = Math.atan2(dx, -dz) - k.yaw; while (d > Math.PI) d -= TAU; while (d < -Math.PI) d += TAU;
      P.headY = clamp(d, -1.0, 1.0); P.headZ *= 0.4; P.twist += clamp(d - P.headY, -0.5, 0.5);
      const dy = k.look[1] - (k.y + 2.6); P.headX += clamp(-Math.atan2(dy, Math.hypot(dx, dz)) * 0.7, -0.5, 0.6);
    }
    const gs = k.gest;
    if (gs) {
      const age = t - gs.t0, w = gs.dur ? smooth(Math.min(age / 0.2, (gs.dur - age) / 0.25, 1)) : smooth(age / 0.2);
      if (!gs.dur || age < gs.dur) {
        const set = (key, i, v) => { if (i == null) P[key] = lerp(P[key], v, w); else P[key][i] = lerp(P[key][i], v, w); };
        if (gs.name === 'roar') { set('jaw', null, 0.75); set('neckX', null, -1.1); set('headX', null, -0.35); for (const i of [0, 1]) { set('shZ', i, 0.95); set('shX', i, 0.8); set('el', i, 0.6); } }
        if (gs.name === 'swipe') { const u = clamp(age / 0.35, 0, 1); set('shX', 1, lerp(-0.6, 1.9, u)); set('shZ', 1, lerp(0.9, 0.1, u)); set('el', 1, 0.25); set('twist', null, lerp(0.5, -0.5, u)); }
        if (gs.name === 'grab') { set('shX', 1, 1.9); set('shZ', 1, 0.15); set('el', 1, 0.3); set('lean', null, -0.8); set('jaw', null, 0.4); }
        if (gs.name === 'rise') { const u = smooth(age / (gs.dur || 2.5)); set('hip', null, lerp(0.95, KD.hip, u)); for (const i of [0, 1]) { set('hipX', i, lerp(1.1, 0.35, u)); set('kn', i, lerp(2.1, 1.1, u)); set('an', i, lerp(1.25, 0.75, u)); } set('lean', null, lerp(0.95, 0.2, u)); set('neckX', null, lerp(-1.2, -0.15, u)); }
        if (gs.name === 'tilt') { set('headZ', null, 0.35); }
        if (gs.name === 'lunge') { set('shX', 0, 2.3); set('shZ', 0, 0.15); set('el', 0, 0.25); set('wr', 0, 0.2); set('jaw', null, 0.75); }   // the long arm, only when he is nearly on you
        // bent double over a hiding place, hands on the rim, face in the opening
        if (gs.name === 'peer') { set('hip', null, 0.82); set('lean', null, -1.15 + 0.04 * Math.sin(t * 0.9)); set('neckX', null, -0.2); set('headX', null, -0.5 + 0.06 * Math.sin(t * 0.5)); set('headY', null, 0.25 * Math.sin(t * 0.21)); set('jaw', null, 0.2 + 0.14 * Math.sin(t * 0.7)); set('headZ', null, 0.4 * Math.sin(t * 0.33)); for (const i of [0, 1]) { set('hipX', i, 1.25); set('kn', i, 2.2); set('an', i, 1.25); set('shX', i, 1.0); set('el', i, 0.5); set('shZ', i, 0.4); } }
        // the catch: hunched to your height, arms wide, jaw unhinged
        if (gs.name === 'scare') { const sh = Math.sin(t * 47) * 0.04; set('hip', null, 1.25); set('lean', null, 0.75); set('neckX', null, -0.75 + sh); set('headX', null, 0.0); set('headZ', null, sh * 2); set('jaw', null, 0.82 + sh * 2); for (const i of [0, 1]) { set('hipX', i, 0.8); set('kn', i, 1.6); set('an', i, 1.0); set('shX', i, 1.5); set('shZ', i, 1.0); set('el', i, 0.7); } }
      }
    }
    P.jaw += 0.03 * Math.sin(t * 2.3);
    return P;
  }
  function drawKrampus(buf, k, t) {
    if (k.visible === false) return;
    const P = kPose(k, t), s = k.scale || 1;
    const root = A.chain(A.T(k.x, k.y, k.z), A.Ry(-k.yaw), A.S(s));
    const pel = A.chain(root, A.T(0, P.hip, 0), A.Ry(P.twist * 0.4), A.Rx(P.pelvisX));
    const ch = A.chain(pel, A.T(0, KD.spine, 0), A.Rz(P.roll || 0), A.Rx(P.lean), A.Ry(P.twist * 0.6));
    const nk = A.chain(ch, A.T(0, KD.chest * 0.92, -0.08), A.Rx(P.neckX));
    const hd = A.chain(nk, A.T(0, KD.neck, -0.02), A.Ry(P.headY), A.Rx(P.headX), A.Rz(P.headZ));
    buf.emit(kPart('pelvis'), pel); buf.emit(kPart('chest'), ch); buf.emit(kPart('neck'), nk); buf.emit(kPart('head'), hd);
    const jw = A.chain(hd, A.T(0, 0.0, -0.075), A.Rx(P.jaw)); buf.emit(kPart('jaw'), jw);
    // the tongue hangs and sways
    const tg = new Geo(); const pts = [], rad = [];
    for (let i = 0; i <= 8; i++) { const u = i / 8, sw = Math.sin(t * 3 + u * 3) * 0.06 * u; pts.push([sw, -0.01 - u * (0.42 + 0.25 * P.jaw), -0.25 - 0.12 * Math.sin(u * 2.2) - 0.08 * u]); rad.push(0.04 * (1 - u * 0.6)); }
    tg.tube(pts, rad, hex(KC.tongue), MAT.SKIN, 7); buf.emit(tg.data, A.chain(jw, A.T(0, -0.01, -0.25), A.Rx(-P.jaw * 0.85), A.T(0, 0.01, 0.25))); // hangs with gravity, not with the jaw
    for (const [i, sd] of [[0, -1], [1, 1]]) {
      const S = i ? 'R' : 'L';
      const sh = A.chain(ch, A.T(sd * KD.shW, KD.chest * 0.85, 0), A.Ry(P.shY[i]), A.Rx(P.shX[i]), A.Rz(sd * P.shZ[i]));
      const el = A.chain(sh, A.T(0, -KD.upper, 0), A.Rx(P.el[i]));
      const wr = A.chain(el, A.T(0, -KD.fore, 0), A.Rx(P.wr[i]));
      buf.emit(kPart('upper', S), sh); buf.emit(kPart('fore', S), el); buf.emit(kPart('hand', S), wr);
      const hp = A.chain(pel, A.T(sd * KD.hipW, -0.05, 0), A.Rx(P.hipX[i]), A.Rz(sd * 0.08));
      const kn = A.chain(hp, A.T(0, -KD.thigh, 0), A.Rx(-P.kn[i]));
      const ak = A.chain(kn, A.T(0, -KD.shin, 0), A.Rx(P.an[i]));
      buf.emit(kPart('thigh', S), hp); buf.emit(kPart('shin', S), kn); buf.emit(kPart('meta'), ak);
      if (i === 1) k._hand = A.p(wr, 0, -0.15, -0.05);
    }
    if (k.sack !== false) {
      const full = !!k.sackFull, wig = full ? Math.sin(t * 9) * 0.06 + Math.sin(t * 5.3) * 0.05 : 0;
      buf.emit(kPart('sack', full ? 'full' : ''), A.chain(ch, A.T(0.3, 0.98, 0.4), A.Rx(0.5 + P.sackRot + wig), A.Rz(-0.3 + wig)));
    }
    k._eye = A.p(hd, 0, 0.17, -0.25);
  }

  // ---------- the family car ----------
  function carMesh() {
    return mesh('car', (g) => {
      const body = hex('#5d6f7c'), glass = hex('#1a2433'), dark = hex('#1d1f22');
      g.rbox(0, 0.32, 0, 1.9, 0.75, 4.8, 0, body, MAT.METAL, 0.18);
      g.rbox(0, 1.0, 0.35, 1.72, 0.72, 3.0, 0, body, MAT.METAL, 0.2);
      for (const s of [-1, 1]) g.box(s * 0.862, 1.07, 0.35, 0.02, 0.52, 2.7, 0, glass, MAT.CERAMIC);
      g.push(A.chain(A.T(0, 1.06, -1.12), A.Rx(-0.55))); g.box(0, 0, 0, 1.6, 0.62, 0.02, 0, glass, MAT.CERAMIC); g.pop();
      g.push(A.chain(A.T(0, 1.06, 1.82), A.Rx(0.35))); g.box(0, 0, 0, 1.6, 0.58, 0.02, 0, glass, MAT.CERAMIC); g.pop();
      for (const z of [-0.2, 0.95]) for (const s of [-1, 1]) g.box(s * 0.87, 0.45, z, 0.01, 0.9, 0.012, 0, shade(body, 0.6));
      for (const s of [-1, 1]) for (const z of [-1.55, 1.55]) { g.cyl(s * 0.82, 0.36, z, 0.36, 0.26, dark, MAT.LEATHER, 16, 'x'); g.cyl(s * 0.84, 0.36, z, 0.2, 0.24, hex('#9aa0a6'), MAT.METAL, 10, 'x'); }
      for (const s of [-1, 1]) { g.rbox(s * 0.62, 0.68, -2.39, 0.42, 0.14, 0.04, 0, hex('#fff6dc'), MAT.GLOW, 0.03); g.rbox(s * 0.66, 0.78, 2.39, 0.32, 0.12, 0.04, 0, hex('#c01a1a'), MAT.GLOW, 0.03); g.rbox(s * 0.98, 1.0, -0.95, 0.12, 0.1, 0.18, 0, body, MAT.METAL, 0.04); }
      g.rbox(0, 0.42, -2.4, 1.0, 0.12, 0.05, 0, dark, MAT.METAL, 0.02);
      g.ellipsoid(0, 1.74, 0.35, 0.85, 0.06, 1.4, hex('#e8edf4'), MAT.SNOW, 12, 4);
      g.ellipsoid(0, 1.08, -1.9, 0.8, 0.05, 0.4, hex('#e8edf4'), MAT.SNOW, 10, 4);
    });
  }
  function carInteriorMesh() {
    return mesh('carIn', (g) => {
      const seat = hex('#2b2d30'), trim = hex('#3a3c40');
      for (const z of [0, 1.0]) { g.rbox(0, 0.35, z, 1.5, 0.22, 0.6, 0, seat, MAT.FABRIC, 0.06); g.rbox(0, 0.55, z + 0.32, 1.5, 0.65, 0.16, 0, seat, MAT.FABRIC, 0.06); }
      g.rbox(0, 0.6, -1.0, 1.6, 0.35, 0.5, 0, trim, MAT.LEATHER, 0.08);
      g.rbox(0, 1.55, 0.2, 1.7, 0.04, 3.0, 0, hex('#4a4c50'), MAT.FABRIC, 0.01);
      for (const s of [-1, 1]) { g.box(s * 0.84, 0.2, 0.2, 0.04, 0.75, 3.0, 0, trim); g.box(s * 0.84, 0.95, -0.25, 0.05, 0.6, 0.12, 0, trim); g.box(s * 0.84, 0.95, 0.75, 0.05, 0.6, 0.12, 0, trim); }
      g.cyl(-0.4, 0.82, -0.8, 0.17, 0.03, hex('#1d1f22'), MAT.LEATHER, 16, 'z');
    });
  }

  return { CHARS, dims, drawPerson, drawKrampus, handPos, carMesh, carInteriorMesh, propMesh, KD };
})();
