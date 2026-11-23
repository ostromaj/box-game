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
  mannequin: { h: 1.8, skin: '#e7e3dc', hair: ['none', '#e7e3dc'], top: ['plain', '#e3dfd7'], pants: '#e3dfd7', shoes: '#dcd8d0', faceless: true },
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
      legs: Hh * lerp(0.485, 0.44, k),
      shW: Hh * lerp(0.098, 0.1, k) * fem * Math.sqrt(b), upper: Hh * 0.172, fore: Hh * 0.145, hand: Hh * 0.055,
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

  // a band that sits on the body's real oval at height y: belts, ribbing, apron ties
  function band(g, y, W, D, zo, r, col, mat) { const P2 = []; for (let i = 0; i <= 32; i++) { const a = i / 32 * TAU; P2.push([Math.cos(a) * W, y, zo + Math.sin(a) * D]); } g.tube(P2, r, col, mat, 5, false); }
  // ---------- part meshes ----------
  const FACE_BINS = new Map();
  function personPart(id, part, extra = '') {
    return mesh(`p:${id}:${part}:${extra}`, (g) => {
      const c = CHARS[id], d = dims(id), skin = H(c.skin), top = H(c.top[1]), pants = H(c.pants), shoes = H(c.shoes);
      const puff = c.top[0] === 'puffer', coat = c.top[0] === 'coat', fab = MAT.FABRIC;
      const sleeve = puff ? 1.45 : coat ? 1.25 : 1.12;
      if (part === 'pelvis') {
        loft(g, [[-d.spine * 0.5, d.hipW * 1.2, d.rz * 0.6], [-d.spine * 0.2, d.hipW * 2.2, d.rz * 0.95, d.rz * 0.06], [d.spine * 0.25, d.hipW * (c.fem ? 2.3 : 2.2), d.rz * 0.98, d.rz * 0.05], [d.spine * 0.7, d.hipW * (c.fem ? 1.9 : 2.05), d.rz * 0.8], [d.spine * 0.92, d.hipW * 1.5, d.rz * 0.55]], pants, fab);
        if (!puff && !coat && !c.apron && !c.faceless) { band(g, d.spine * 0.62, d.hipW * (c.fem ? 2.18 : 2.13), d.rz * 0.86, 0, d.H * 0.011, H('#1c1a19'), MAT.LEATHER); g.rbox(0, d.spine * 0.62 - d.H * 0.011, -d.rz * 0.86, d.H * 0.026, d.H * 0.022, 0.008, 0, H('#b9bcc0'), MAT.METAL, 0.003); }   // belt and buckle
        if (puff) g.ellipsoid(0, d.spine * 0.55, 0, d.shW * 1.0, d.spine * 0.32, d.rz * 1.25, shade(top, 0.95), fab, 14, 6);
        if (coat) { const cw = d.hipW * (c.fem ? 1.85 : 2.08) * 1.1; g.push(A.S(1, 1, d.rz * 1.12 / cw)); g.lathe(0, -d.thigh * 0.75, 0, [[cw * 1.12, 0, 1], [cw * 1.07, d.thigh * 0.4], [cw * 1.0, d.thigh * 0.75 + d.spine * 0.4], [cw * 0.97, d.thigh * 0.75 + d.spine * 0.95, 1]], top, fab, 20); g.pop(); }
        if (c.apron) {
          const ap = H(c.apron), W = d.hipW * 2.2, D = d.rz * 1.02, hgt = d.thigh * 0.7 + d.spine * 0.75, y0 = -d.thigh * 0.7;
          g.param((u, v) => { const a = (u * 2 - 1) * 1.18, fl = 1 + 0.07 * (1 - v), fold = 0.006 * Math.sin(u * 9 * Math.PI) * (1 - v); return [Math.sin(a) * W * fl, y0 - hgt / 2 + v * hgt, -Math.cos(a) * (D * fl + fold)]; }, 16, 6, ap, fab);   // one cloth sheet round the front, soft folds at the hem
          band(g, d.spine * 0.7, d.hipW * (c.fem ? 2.14 : 2.08), d.rz * 0.88, 0, d.H * 0.006, shade(ap, 0.8), fab);                                  // waist tie, all the way round
          for (const sd of [-1, 1]) g.tube([[sd * 0.01, d.spine * 0.7, D * 1.0], [sd * d.hipW * 0.9, d.spine * 0.45, D * 1.08], [sd * d.hipW * 0.7, d.spine * 0.05, D * 1.1]], 0.006, shade(ap, 0.8), fab, 4, false);   // the bow's tails
          g.rbox(-d.hipW * 0.9, -d.thigh * 0.2, -D - 0.008, d.hipW * 1.5, d.thigh * 0.3, 0.008, 0, shade(ap, 1.25), fab, 0.004);
          g.cyl(-d.hipW * 1.3, -d.thigh * 0.2 + d.thigh * 0.24, -D - 0.014, 0.004, d.thigh * 0.12, H('#d9d5cc'), MAT.CERAMIC, 5);
        }
        if (!c.apron && !coat && !puff) for (const sd of [-1, 1]) g.tube([[sd * d.hipW * 1.2, d.spine * 0.5, -d.rz * 0.88], [sd * d.hipW * 1.9, d.spine * 0.3, -d.rz * 0.72], [sd * d.hipW * 2.2, d.spine * 0.0, -d.rz * 0.4]], 0.003, shade(pants, 0.6), fab, 4, false);
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
          for (const s of [-1, 1]) g.ellipsoid(s * d.shW * 0.96, ch * 0.83, 0, d.armR * 1.12 * sleeve, d.armR * 1.0 * sleeve, d.armR * 1.12 * sleeve, top, fab, 10, 6);
          if (c.top[0] === 'shirt') { for (let i = 0; i < 5; i++) g.sphere(0, ch * (0.14 + i * 0.16), -d.rz * (0.95 + (i === 2 || i === 3 ? 0.07 : 0)) * 1.0 - 0.004, d.H * 0.0035, H('#d9d5cc'), MAT.CERAMIC, 5);   // buttons
            for (const s of [-1, 1]) { g.push(A.chain(A.T(s * d.H * 0.022, ch * 0.985, -d.H * 0.04), A.Rz(s * 0.5), A.Rx(-0.5))); g.rbox(0, 0, 0, d.H * 0.035, d.H * 0.02, 0.006, 0, shade(top, 1.1), fab, 0.003); g.pop(); } }   // collar points
        }
        if (puff) for (let i = 0; i < 4; i++) g.ellipsoid(0, ch * (0.12 + i * 0.22), 0, cw * (1.05 + (i === 1 || i === 2 ? 0.1 : 0)), ch * 0.08, d.rz * 1.3, shade(top, 1.06), fab, 16, 6);
        if (puff) { g.rbox(0, ch * 0.02, -d.rz * 1.3, d.H * 0.008, ch * 0.96, 0.008, 0, shade(top, 0.55), MAT.METAL, 0.003); g.rbox(0, ch * 0.78, -d.rz * 1.3 - 0.006, d.H * 0.012, d.H * 0.02, 0.006, 0, H('#c9ccd0'), MAT.METAL, 0.003); }
        if (puff) g.lathe(0, ch * 0.95, 0, [[d.H * 0.055, 0, 1], [d.H * 0.06, ch * 0.12], [d.H * 0.052, ch * 0.16, 1]], shade(top, 0.9), fab, 14);
        if (coat) { for (const sd of [-1, 1]) { g.push(A.chain(A.T(sd * d.shW * 0.34, ch * 0.62, -d.rz * 1.2), A.Rz(sd * 0.32))); g.rbox(0, 0, 0, d.shW * 0.42, ch * 0.42, 0.012, 0, shade(top, 0.86), fab, 0.006); g.pop(); }
          band(g, ch * 0.02, d.hipW * (c.fem ? 1.85 : 2.08) * 1.1 + d.H * 0.004, d.rz * 0.88 * 1.1 + d.H * 0.004, 0, d.H * 0.011, shade(top, 0.7), fab); g.rbox(0, ch * 0.02 - d.H * 0.012, -d.rz * 1.06, d.H * 0.03, d.H * 0.024, 0.008, 0, H('#c9a24b'), MAT.METAL, 0.003);
          g.ellipsoid(0, ch * 0.96, 0.0, d.H * 0.07, ch * 0.08, d.H * 0.06, shade(top, 0.92), fab, 12, 6); for (let i = 0; i < 3; i++) g.sphere(d.shW * 0.25, ch * (0.2 + i * 0.22), -d.rz * 1.0, d.H * 0.008, H('#3a2a20'), 0, 6); }
        if (c.top[0] === 'shirt' || c.top[0] === 'sweater') { g.ellipsoid(0, ch * 0.95, -0.005, d.H * 0.045, ch * 0.07, d.H * 0.045, c.top[0] === 'sweater' ? H('#f2f0ea') : shade(top, 1.08), fab, 10, 5); }
        if (c.top[0] === 'sweater') { for (let i = 0; i < 3; i++) band(g, -ch * 0.18 + i * d.H * 0.009, d.hipW * 2.1 + d.H * 0.003, d.rz * 0.88 + d.H * 0.003, 0, d.H * 0.005, shade(top, 0.82), fab); }
        if (c.tie) { g.rbox(0, ch * 0.25, -d.rz * 1.0, d.H * 0.025, ch * 0.65, 0.01, 0, H(c.tie), fab, 0.004); }
        if (c.lanyard) { g.tube([[-d.H * 0.04, ch * 0.98, -d.rz * 0.6], [-d.H * 0.05, ch * 0.6, -d.rz * 1.05], [0, ch * 0.42, -d.rz * 1.08], [d.H * 0.05, ch * 0.6, -d.rz * 1.05], [d.H * 0.04, ch * 0.98, -d.rz * 0.6]], 0.006, H('#7a1f2b'), fab, 4, false); g.rbox(0, ch * 0.3, -d.rz * 1.1, 0.06, 0.09, 0.008, 0, H('#f2f0ea'), 0, 0.004); }
        if (c.apron) {
          const ap = H(c.apron);
          // the bib: tapers from the waist to the chest and lies on the body, with a strap round the neck
          const fz = (t) => -d.rz * (c.fem ? lerp(0.98, 1.2, Math.sin(clamp(t, 0, 1) * Math.PI) ** 1.5) * (t > 0.75 ? lerp(1, 0.86, (t - 0.75) * 4) : 1) : lerp(1.02, 1.1, Math.sin(clamp(t, 0, 1) * Math.PI))) - 0.006;
          g.param((u, v) => { const w = lerp(d.hipW * 3.3, d.shW * 1.0, smooth(Math.min(1, v * 1.25))) / 2, x = (u * 2 - 1) * w; return [x, ch * (-0.2 + v * 1.0), fz(v) + d.rz * 0.28 * (x / (d.hipW * 1.8)) ** 2]; }, 10, 14, ap, fab);   // the bib, one smooth sheet curving round the body
          g.rbox(0, ch * 0.79, fz(0.99) - 0.002, d.shW * 1.02, ch * 0.03, 0.012, 0, shade(ap, 1.2), fab, 0.004);
          for (const s of [-1, 1]) g.tube([[s * d.shW * 0.46, ch * 0.78, fz(0.95)], [s * d.shW * 0.36, ch * 0.98, -d.rz * 0.5], [s * d.H * 0.03, ch * 1.03, d.rz * 0.35], [0, ch * 1.02, d.rz * 0.5]], 0.007, ap, fab, 4, false);
          if (c.tag) { g.rbox(-d.shW * 0.36, ch * 0.56, fz(0.75) - 0.01, 0.07, 0.025, 0.006, 0, H('#f6f5f1'), MAT.CERAMIC, 0.003); g.box(-d.shW * 0.36, ch * 0.568, fz(0.75) - 0.014, 0.05, 0.006, 0.002, 0, H('#2b2b2b')); }
        }
        if (c.purse) g.tube([[-d.shW * 0.9, ch * 0.95, 0], [-d.shW * 0.2, ch * 0.5, -d.rz * 1.05], [d.shW * 0.6, ch * 0.05, -d.rz * 0.6]], 0.008, H(c.purse), MAT.LEATHER, 4, false);
      } else if (part === 'neck') {
        g.lathe(0, -0.02, 0, [[d.H * (c.fem ? 0.03 : 0.035), 0, 1], [d.H * (c.fem ? 0.024 : 0.029), d.neck * 0.6 + 0.02], [d.H * (c.fem ? 0.024 : 0.029), d.neck + 0.05, 1]], skin, MAT.SKIN, 12);
        if (!c.fem && !d.k) g.ellipsoid(0, d.neck * 0.45, -d.H * 0.028, d.H * 0.008, d.H * 0.011, d.H * 0.008, shade(skin, 0.97), MAT.SKIN, 6, 4);
        if (c.scarf) {
          const sc = H(c.scarf);
          g.torus(0, d.neck * 0.25, 0, d.H * 0.04, d.H * 0.022, sc, fab, 14, 6);
          g.tube([[d.H * 0.02, d.neck * 0.1, -d.H * 0.05], [d.H * 0.04, -d.chest * 0.25, -d.rz * (d.k ? 1.5 : 1.35)], [d.H * 0.045, -d.chest * 0.42, -d.rz * (d.k ? 1.55 : 1.4)]], [d.H * 0.02, d.H * 0.02, d.H * 0.016], sc, fab, 6, true);
        }
      } else if (part === 'head') {
        const [eyes, brows, mouth] = extra.split(',');
        const rx = d.headRx * 0.96, ry = d.headRy, rz = d.headRz, cy = ry * 0.95;
        const kid = d.k > 0.5, fem = !!c.fem, J = kid ? 0.2 : fem ? 0.4 : 0.32;
        // A head, not a balloon: a squarer, flatter face in front, a skull that goes back further than it goes forward,
        // cheekbones, deep-set eyes under a brow, a mouth area that comes forward a little, and a jaw that narrows to a chin.
        const headN = (u, v) => {
          const th = -Math.PI / 2 + v * Math.PI, ph = u * TAU, y = Math.sin(th), cc = Math.cos(th);
          let cx = Math.cos(ph), cz = Math.sin(ph);
          if (cz < 0) { cx = Math.sign(cx) * Math.pow(Math.abs(cx), 0.82); cz = -Math.pow(-cz, 0.82); }        // flatter face, defined sides
          let x = cx * cc, z = cz * cc;
          const low = y < 0 ? -y : 0, front = z < 0 ? -z : 0;
          const s1 = smooth(clamp(low / 0.5, 0, 1)), s2 = smooth(clamp((low - 0.42) / 0.58, 0, 1));
          x *= 1 - 0.05 * s1 - J * s2;                                                    // cheeks, then the jaw
          if (z > 0) z *= (1 + 0.1 * (1 - low)) * (1 - 0.25 * s2);                         // the back of the skull; the jaw tucks in toward the neck
          const g2 = (a, w) => Math.exp(-((a / w) ** 2));
          z -= 0.09 * g2(y + 0.86, 0.14) * g2(x, 0.32) * front;                              // chin
          z -= 0.04 * g2(y + 0.45, 0.22) * g2(x, 0.45) * front;                             // mouth area
          const cheek = g2(y + 0.06, 0.2) * g2(Math.abs(x) - 0.6, 0.25) * front; z -= 0.045 * cheek; x *= 1 + 0.03 * cheek;
          z += 0.13 * g2(y - 0.12, 0.12) * g2(Math.abs(x) - 0.42, 0.19) * front;           // eye sockets
          z -= (fem || kid ? 0.02 : 0.045) * g2(y - 0.3, 0.09) * front * (1 - x * x);      // brow ridge
          x *= 1 - 0.05 * g2(y - 0.35, 0.25) * g2(Math.abs(x) - 0.95, 0.15);               // temples
          if (y > 0.35 && z < 0) z *= 1 - 0.12 * (y - 0.35);                                // forehead sloping back
          return [x, y, z];
        };
        const headFn = (u, v) => { const [x, y, z] = headN(u, v); return [x * rx, cy + y * ry * (y < 0 ? 1.1 : 1), z * rz]; };
        g.param(headFn, 30, 22, skin, MAT.SKIN);
        if (c.faceless) return;   // a mannequin: smooth, blank, nothing where a face should be
        // where the face's surface is, so eyes, brows, nose and lips sit on it instead of floating in front of it
        const NB = 56, X0 = -rx * 1.1, X1 = rx * 1.1, Y0 = cy - ry * 1.15, Y1 = cy + ry * 1.05, fresh = !FACE_BINS.has(id), bins = fresh ? new Float32Array(NB * NB).fill(1e9) : FACE_BINS.get(id);   // the same face for every expression: work it out once
        if (fresh) FACE_BINS.set(id, bins);
        if (fresh) for (let i = 0; i <= 200; i++) for (let j = 0; j <= 120; j++) { const p = headFn(i / 200, j / 120); if (p[2] > 0) continue; const bx = Math.round((p[0] - X0) / (X1 - X0) * (NB - 1)), by = Math.round((p[1] - Y0) / (Y1 - Y0) * (NB - 1)), k = by * NB + bx; if (p[2] < bins[k]) bins[k] = p[2]; }
        const fz = (x, y) => { const fx = (x - X0) / (X1 - X0) * (NB - 1), fy = (y - Y0) / (Y1 - Y0) * (NB - 1); let best = -rz, bd = 1e9;
          for (let A2 = -2; A2 <= 2; A2++) for (let B2 = -2; B2 <= 2; B2++) { const X = Math.round(fx) + A2, Y = Math.round(fy) + B2; if (X < 0 || Y < 0 || X >= NB || Y >= NB) continue; const z = bins[Y * NB + X]; if (z > 1e8) continue; const dd = (X - fx) ** 2 + (Y - fy) ** 2; if (dd < bd) { bd = dd; best = z; } } return best; };
        const on = (x, y, lift = 0.0015) => [x, y, fz(x, y) - lift];
        // ears
        for (const s of [-1, 1]) { g.ellipsoid(s * rx * 0.95, cy + ry * 0.0, rz * 0.1, rx * 0.07, ry * 0.2, rz * 0.13, shade(skin, 0.96), MAT.SKIN, 8, 6); g.ellipsoid(s * rx * 0.99, cy + ry * 0.0, rz * 0.08, rx * 0.03, ry * 0.12, rz * 0.07, shade(skin, 0.78), MAT.SKIN, 6, 4); }
        // nose: bridge, tip, wings, nostrils
        const nk = kid ? 0.7 : 1, ny = cy - ry * 0.2, nbz = fz(0, ny), ntz = nbz - rz * 0.16 * nk;
        g.tube([on(0, cy + ry * 0.2, -0.001), [0, cy + ry * 0.02, fz(0, cy + ry * 0.02) - rz * 0.06 * nk], [0, ny + ry * 0.05, ntz + rz * 0.03]], [rx * 0.06, rx * 0.065, rx * 0.085], shade(skin, 1.01), MAT.SKIN, 8);
        g.ellipsoid(0, ny + ry * 0.01, ntz + rz * 0.05, rx * 0.1 * nk, ry * 0.075, rz * 0.08, shade(skin, 1.02), MAT.SKIN, 8, 6);
        for (const s of [-1, 1]) { g.ellipsoid(s * rx * 0.11 * nk, ny - ry * 0.01, nbz - rz * 0.05, rx * 0.07, ry * 0.06, rz * 0.07, skin, MAT.SKIN, 6, 4); g.ellipsoid(s * rx * 0.055 * nk, ny - ry * 0.055, ntz + rz * 0.075, rx * 0.03, ry * 0.015, rz * 0.03, H('#3a211c'), 0, 5, 3); }
        const ex = rx * 0.4, ey = cy + ry * 0.12, ez = fz(ex, ey) + rz * 0.045;
        const dark = H('#1a1210'), white = H('#eeeae3');
        const irisCol = H({ dad: '#4a6a7a', mom: '#5a4028', you: '#5a4028', leo: '#5a4028', dana: '#3f5a42', marcus: '#2e1e14', priya: '#2e1e14', manager: '#6f8494' }[id] || '#3a2a1e');
        const creepy = mouth === 'wide' || mouth.startsWith('maw');
        for (const s of [-1, 1]) {
          if (eyes === 'closed') { g.ellipsoid(s * ex, ey, ez - rz * 0.01, rx * 0.17, ry * 0.055, rz * 0.075, skin, MAT.SKIN, 8, 4); g.tube([on(s * ex - rx * 0.15, ey - ry * 0.02, 0.0), on(s * ex, ey - ry * 0.045, 0.0), on(s * ex + rx * 0.15, ey - ry * 0.02, 0.0)].map((p) => [p[0], p[1], Math.min(p[2], ez - rz * 0.08)]), 0.0014, dark, 0, 4, false); }
          else {
            // stare: lids pulled right back, the whole iris showing, the pupil a pinprick
            const stare = eyes === 'stare', wide = eyes === 'wide', nar = eyes === 'narrow';
            const ew = rx * (kid ? 0.18 : 0.155) * (stare ? 1.2 : 1), eh = ry * (kid ? 0.085 : 0.066) * (stare ? 2.0 : wide ? 1.4 : 1), ir = eh * (stare ? 0.36 : 0.92);
            if (stare) g.ellipsoid(s * ex, ey, ez + rz * 0.01, ew * 1.45, eh * 1.45, rz * 0.08, shade(skin, 0.62), MAT.SKIN, 12, 6);   // sunk in shadow
            g.ellipsoid(s * ex, ey, ez, ew, eh, rz * 0.085, stare ? H('#d8d4cb') : white, MAT.CERAMIC, 12, 7);
            g.ellipsoid(s * ex, ey - (stare || wide ? 0 : eh * 0.08), ez - rz * 0.062, ir, ir, rz * 0.035, irisCol, MAT.CERAMIC, 10, 6);
            g.ellipsoid(s * ex, ey - (stare || wide ? 0 : eh * 0.08), ez - rz * 0.085, ir * (stare ? 0.22 : 0.45), ir * (stare ? 0.22 : 0.45), rz * 0.02, dark, MAT.CERAMIC, 8, 5);
            if (!stare) g.sphere(s * ex + ir * 0.35, ey + ir * 0.3, ez - rz * 0.1, d.H * 0.0016, white, MAT.GLOW, 4);
            if (stare) { g.tube([[s * ex - ew, ey, ez - rz * 0.02], [s * ex, ey + eh * 1.08, ez - rz * 0.05], [s * ex + ew, ey, ez - rz * 0.02]], 0.0018, shade(skin, 0.6), 0, 5, false);   // the lid, pulled all the way back
              g.tube([[s * ex - ew, ey - eh * 0.2, ez - rz * 0.02], [s * ex, ey - eh * 1.05, ez - rz * 0.05], [s * ex + ew, ey - eh * 0.2, ez - rz * 0.02]], 0.0016, H('#8a4a44'), 0, 5, false); }   // red rim underneath
            else {
              const drop = nar ? 0.2 : wide ? 1.25 : 0.72;
              g.ellipsoid(s * ex, ey + eh * drop, ez - rz * 0.012, ew * 1.12, eh * 0.62, rz * 0.095, skin, MAT.SKIN, 10, 5);
              g.tube([[s * ex - ew * 1.05, ey + eh * (drop - 0.45), ez - rz * 0.06], [s * ex, ey + eh * (drop - 0.05), ez - rz * 0.1], [s * ex + ew * 1.05, ey + eh * (drop - 0.45), ez - rz * 0.06]], fem ? 0.0019 : 0.0013, dark, 0, 4, false);   // lash line
              g.ellipsoid(s * ex, ey - eh * (nar ? 0.75 : 1.02), ez - rz * 0.005, ew * 1.05, eh * 0.4, rz * 0.085, shade(skin, 0.97), MAT.SKIN, 8, 4);
            }
          }
          // brows: a tapered stroke lying on the brow ridge
          const by = ey + ry * (brows === 'up' ? 0.28 : 0.2), tilt = brows === 'angry' ? 0.07 : brows === 'sad' ? -0.06 : 0, bth = d.H * (fem || kid ? 0.0032 : 0.0048);
          const bc = H(c.hair[1] === '#9a9a98' ? '#7a7a78' : c.hair[1]), bp = [], br = [];
          for (let i = 0; i <= 6; i++) { const t = i / 6, x = s * (ex - rx * 0.17 + t * rx * 0.36), y = by + Math.sin(t * Math.PI) * ry * 0.035 - (1 - t) * ry * tilt * 1.2 + t * ry * tilt * 0.3; bp.push(on(x, y, 0.0022)); br.push(bth * (0.75 + 0.35 * Math.sin(Math.min(1, t * 1.6) * Math.PI / 2)) * (1 - 0.6 * t * t)); }
          g.tube(bp, br, bc, MAT.HAIR, 5, true);
        }
        // the mouth
        const my = cy - ry * 0.47, sk = H(c.skin), lip = c.lips ? H(c.lips).map((v, i) => lerp(sk[i], v, 0.7)) : [sk[0] * 0.82, sk[1] * 0.64, sk[2] * 0.62];
        const pale = lip.map((v, i) => lerp(v, sk[i] * 0.86, 0.55));   // the smiles go bloodless
        const lipLine = (Wd, yf, rf, lift, col, mat) => { const P2 = [], R2 = []; for (let i = 0; i <= 12; i++) { const u = -1 + i / 6; P2.push(on(u * Wd, yf(u), lift)); R2.push(rf(u)); } g.tube(P2, R2, col, mat, 6, true); };
        if (mouth === 'smile' || mouth === 'frown' || mouth === 'neutral' || mouth === 'grin') {
          const sg = mouth === 'smile' || mouth === 'grin' ? 1 : mouth === 'frown' ? -1 : 0, W = rx * (mouth === 'neutral' ? 0.25 : 0.28), cv = sg * ry * 0.07;
          lipLine(W, (u) => my + cv * u * u, (u) => 0.0009, 0.0006, H('#3a1a18'), 0);
          lipLine(W * 0.96, (u) => my + cv * u * u + d.H * 0.0028 * (1 - u * u) - d.H * 0.0012 * Math.exp(-((u / 0.15) ** 2)), (u) => d.H * 0.0026 * (1 - u * u * 0.8) + 0.0006, 0.0012, shade(lip, 0.9), MAT.SKIN);
          lipLine(W * 0.9, (u) => my + cv * u * u - d.H * 0.0032 * (1 - u * u), (u) => d.H * 0.0034 * (1 - u * u * 0.85) + 0.0006, 0.0012, lip, MAT.SKIN);
        } else if (mouth === 'wide') {
          // The wrong smile: lips pressed thin and pulled far too wide and too high, past where cheeks should stop them.
          // Deep creases from the nose, the cheeks bunched up under eyes that aren't smiling at all.
          const W = rx * 0.62, cv = ry * 0.24;
          const gp = ry * 0.075;                                                                           // lips held apart on clenched teeth
          g.param((uu, vv) => { const u = -0.97 + 1.94 * uu, x = u * W, y = my + cv * u * u + gp * (0.5 - vv) * (1 - u * u); return [x, y, fz(x, y) + 0.004]; }, 16, 3, H('#140405'), 0);
          for (let i = 0; i < 16; i++) { const u = -0.86 + i * 1.72 / 15, x = u * W, k = 1 - u * u, th = gp * k * 0.5, tw = W / 17;
            if (th < 0.0015) continue;
            for (const sgn of [1, -1]) { const y = my + cv * u * u + sgn * th * 0.5, p = on(x, y, 0.0003); g.ellipsoid(p[0], p[1], p[2] + 0.001, tw * 0.46, th * 0.5, 0.004, H(sgn > 0 ? '#f1ebdd' : '#e4dbc6'), MAT.CERAMIC, 6, 4); } }
          lipLine(W, (u) => my + cv * u * u, (u) => 0.0006, 0.0, H('#2a1010'), 0);
          lipLine(W * 0.97, (u) => my + cv * u * u + ry * 0.0375 * (1 - u * u) + d.H * 0.0012 * (1 - u * u), (u) => d.H * 0.0014 * (1 - u * u * 0.7) + 0.0006, 0.0012, shade(pale, 0.9), MAT.SKIN);
          lipLine(W * 0.94, (u) => my + cv * u * u - ry * 0.0375 * (1 - u * u) - d.H * 0.0014 * (1 - u * u), (u) => d.H * 0.0018 * (1 - u * u * 0.7) + 0.0006, 0.0012, pale, MAT.SKIN);
          for (const sd of [-1, 1]) {
            g.tube([on(sd * rx * 0.15, ny - ry * 0.02, 0.0004), on(sd * rx * 0.34, my + ry * 0.08, 0.0004), on(sd * W * 1.0, my + cv + ry * 0.02, 0.0004), on(sd * W * 1.08, my + cv * 1.15, 0.0004)], [0.0014, 0.0024, 0.0018, 0.0006], shade(skin, 0.72), MAT.SKIN, 5, true);   // crease
            // (no bunched cheeks: the smile doesn't reach anything else in the face)
            g.ellipsoid(sd * W * 1.02, my + cv * 1.02, fz(sd * W, my + cv) - 0.0005, rx * 0.025, ry * 0.02, rz * 0.012, H('#3a1a18'), 0, 5, 3);   // the corner, dug in
          }
        } else if (mouth.startsWith('maw')) {
          // The smile that opens. Closed: lips stretched thin, far too wide and high. Then they part, slowly, on rows of
          // needle teeth, the corners never coming apart, and it keeps going further than a jaw should.
          const o = (+mouth.slice(3) || 0) / 12, W = rx * (0.6 + 0.1 * o), cv = ry * (0.24 + 0.05 * o), gap = ry * (0.02 + 0.55 * o);
          const Uy = (u) => my + cv * u * u + ry * 0.012, Ly = (u) => Uy(u) - gap * Math.pow(Math.max(0, 1 - u * u), 0.7);
          if (o > 0.02) {
            g.param((uu, vv) => { const u = -0.98 + 1.96 * uu, x = u * W, y = lerp(Uy(u), Ly(u), vv); return [x, y, fz(x, y) + Math.sin(Math.PI * vv) * rz * 0.3 * (1 - u * u) + 0.0015]; }, 18, 6, H('#120304'), 0);   // the dark inside
            lipLine(W * 0.97, (u) => Uy(u) - 0.002, (u) => 0.003 * (1 - u * u * 0.6), -0.003, H('#4a0c12'), 0);   // gums
            lipLine(W * 0.97, (u) => Ly(u) + 0.002, (u) => 0.003 * (1 - u * u * 0.6), -0.003, H('#4a0c12'), 0);
          }
          if (o > 0.04) {
            const grow = Math.min(1, (o - 0.04) * 4);
            for (let i = 0; i < 17; i++) {                                   // needle teeth, top and bottom, uneven, leaning in
              const u = -0.9 + i * 1.8 / 16, hgt = Uy(u) - Ly(u), L = grow * Math.min(hgt * 0.62, ry * (0.14 + 0.08 * ((i * 7 + 3) % 4) / 3)), r0 = W / 21;
              if (L > 0.002) { const p0 = on(u * W, Uy(u) - 0.001, 0.0005); g.push(A.chain(A.T(p0[0], p0[1], p0[2]), A.Rx(Math.PI - 0.08))); g.lathe(0, 0, 0, [[r0, 0], [r0 * 0.5, L * 0.5], [0, L]], H((i * 5) % 3 ? '#f6f2e6' : '#e6dcc4'), MAT.CERAMIC, 6); g.pop(); }
              const u2 = u + 0.9 / 16; if (Math.abs(u2) > 0.88) continue;
              const h2 = Uy(u2) - Ly(u2), L2 = grow * Math.min(h2 * 0.5, ry * (0.1 + 0.06 * ((i * 5 + 1) % 4) / 3));
              if (L2 > 0.002) { const p1 = on(u2 * W, Ly(u2) + 0.001, 0.0005); g.push(A.chain(A.T(p1[0], p1[1], p1[2]), A.Rx(0.08))); g.lathe(0, 0, 0, [[r0, 0], [r0 * 0.5, L2 * 0.5], [0, L2]], H('#ebe3cf'), MAT.CERAMIC, 6); g.pop(); }
            }
          }
          if (o > 0.5) g.ellipsoid(0, (Uy(0) + Ly(0)) / 2 - gap * 0.15, fz(0, my) + rz * 0.22, W * 0.4, gap * 0.2, rz * 0.06, H('#5e1218'), 0, 8, 5);   // tongue, far back
          lipLine(W, (u) => Uy(u) + d.H * 0.0012 * (1 - u * u), (u) => d.H * 0.0016 * (1 - u * u * 0.6) + 0.0006, 0.0012, shade(pale, 0.9), MAT.SKIN);   // lips stretched thin
          lipLine(W, (u) => Ly(u) - d.H * 0.0012 * (1 - u * u), (u) => d.H * 0.0018 * (1 - u * u * 0.6) + 0.0006, 0.0012, pale, MAT.SKIN);
          for (const sd of [-1, 1]) {
            g.tube([on(sd * rx * 0.15, ny - ry * 0.02, 0.0004), on(sd * rx * 0.36, my + ry * 0.08, 0.0004), on(sd * W, Uy(1) + ry * 0.02, 0.0004)], [0.0014, 0.0024, 0.0012], shade(skin, 0.72), MAT.SKIN, 5, true);   // crease
            // (no bunched cheeks: the smile doesn't reach anything else in the face)
            if (o > 0.35) g.tube([on(sd * W, Uy(1), 0.0006), on(sd * W * 1.12, Uy(1) + ry * 0.05 * o, 0.0006), on(sd * W * (1.12 + 0.16 * o), Uy(1) + ry * 0.1 * o, 0.0006)], [0.0016, 0.0012, 0.0005], H('#2a0a0c'), 0, 4, true);   // the corners keep going, splitting toward the ears
          }
        } else if (mouth === 'open') g.ellipsoid(0, my - ry * 0.03, fz(0, my) + rz * 0.03, rx * 0.2, ry * 0.12, rz * 0.06, H('#2a0d0d'), 0, 10, 6);
        else if (mouth === 'o') g.ellipsoid(0, my, fz(0, my) + rz * 0.02, rx * 0.09, ry * 0.08, rz * 0.05, H('#2a0d0d'), 0, 8, 5);
        // hair: the scalp's own shape pushed out a little above a hairline, tucked under the skin below it (a clean edge, no gaps)
        const hc = H(c.hair[1]), st = c.hair[0];
        const hairShell = (thick, hl, col, mat, cond) => g.param((u, v) => {
          const n = headN(u, v), [x, y, z] = n, f = Math.max(0, -z), b = Math.max(0, z), m = smooth(clamp((y - hl(x, z, f, b)) / 0.22, 0, 1)) * (cond ? cond(x, y, z) : 1);
          const t = lerp(-0.025, thick(x, y, z), Math.pow(m, 0.6)), p = headFn(u, v), q = [p[0], p[1] - cy, p[2]], L = Math.hypot(...q) || 1, k = 1 + t * ry / L;
          return [q[0] * k, cy + q[1] * k, q[2] * k];
        }, 48, 34, col, mat);
        const hlStd = (x, z, f, b) => 0.1 + 0.5 * f - 0.16 * Math.abs(x) * f - 0.68 * b + 0.06 * f * Math.max(0, -x) - 0.04 * f * Math.max(0, x);   // a hairline that comes back at the temples, parted on one side
        if (st === 'short' || st === 'bun' || st === 'ponytail' || st === 'braid') {
          hairShell((x, y, z) => (st === 'short' ? 0.022 + 0.07 * smooth(clamp(y * 1.6, 0, 1)) + 0.03 * Math.max(0, -z) * Math.max(0, y) * (1 + 0.6 * x) : 0.03 + 0.03 * Math.max(0, y)), st === 'short' ? hlStd : (x, z, f, b) => hlStd(x, z, f, b) - 0.04 * f, hc, MAT.HAIR);
          if (st === 'bun') g.ellipsoid(0, cy + ry * 0.75, rz * 0.7, rx * 0.42, ry * 0.36, rz * 0.4, hc, MAT.HAIR, 10, 6);
          if (st === 'ponytail') g.tube([[0, cy + ry * 0.55, rz * 0.95], [0, cy + ry * 0.1, rz * 1.3], [0, cy - ry * 0.8, rz * 1.22], [0, cy - ry * 1.5, rz * 1.0]], [rx * 0.25, rx * 0.22, rx * 0.17, rx * 0.06], hc, MAT.HAIR, 8);
          if (st === 'braid') for (let i = 0; i < 8; i++) g.ellipsoid(0, cy - ry * 0.1 - i * ry * 0.25, rz * (1.12 - i * 0.02), rx * (0.17 - i * 0.008), ry * 0.15, rz * 0.13, hc, MAT.HAIR, 8, 5);
        } else if (st === 'buzz') {
          hairShell(() => 0.022, (x, z, f, b) => hlStd(x, z, f, b) + 0.05 * f, hc, MAT.HAIR);
        } else if (st === 'beanie') {
          const bc = H(c.hat);
          hairShell(() => 0.04, (x, z, f, b) => -0.45 - 0.2 * f + 0.25 * b * 0, hc, MAT.HAIR, (x, y, z) => smooth(clamp(z * 3 + 0.4, 0, 1)));   // hair sticking out round the back
          g.ellipsoid(0, cy + ry * 0.12, rz * 0.02, rx * 1.1, ry * 1.08, rz * 1.12, bc, fab, 16, 10, (x, y, z) => y > 0.18);
          g.torus(0, cy + ry * 0.28, 0.0, rx * 1.03, ry * 0.12, shade(bc, 0.85), fab, 18, 6);
          g.sphere(0, cy + ry * 1.18, 0, rx * 0.32, H('#f2f0ea'), fab, 10);
        }
        if (c.beard) hairShell((x, y, z) => 0.022 + 0.018 * Math.max(0, -y - 0.6), (x, z, f, b) => -99, H(c.beard), MAT.HAIR, (x, y, z) => {
          const g2 = (a, w) => Math.exp(-((a / w) ** 2)); const below = smooth(clamp((-0.3 - y + 0.12 * Math.max(0, -z) * (1 - Math.abs(x))) / 0.1, 0, 1)), backOK = smooth(clamp((0.25 - z) / 0.12, 0, 1));   // jaw and chin, a moustache, no higher than the cheeks
          const lipsHole = g2(x, 0.3) * g2(y + 0.47, 0.09) * Math.max(0, -z); return below * backOK * (1 - smooth(clamp(lipsHole * 2.2, 0, 1)));
        });
        if (c.glasses) {
          const gc = H('#2a2a2c'), gz = ez - rz * 0.16;
          for (const s of [-1, 1]) { g.push(A.chain(A.T(s * ex, ey, gz), A.Rx(Math.PI / 2))); g.torus(0, 0, 0, rx * 0.21, d.H * 0.0035, gc, MAT.METAL, 16, 4); g.pop(); g.tube([[s * (ex + rx * 0.21), ey, gz], [s * rx * 0.93, ey + 0.002, fz(s * rx * 0.8, ey) + rz * 0.1], [s * rx * 0.97, ey - 0.004, rz * 0.2]], d.H * 0.0025, gc, MAT.METAL, 4, false); }
          g.tube([[-ex + rx * 0.21, ey + ry * 0.02, gz], [0, ey + ry * 0.05, gz - 0.002], [ex - rx * 0.21, ey + ry * 0.02, gz]], d.H * 0.0028, gc, MAT.METAL, 4, false);
        }
      } else if (part === 'upper') {
        { const r = d.armR * sleeve, L = d.upper; g.lathe(0, -L, 0, [[0, -0.04 * L], [r * 0.7, -0.02 * L], [r * 0.95, 0.06 * L], [r * 1.0, 0.3 * L], [r * 1.16, 0.62 * L], [r * 1.26, 0.85 * L], [r * 1.18, 0.98 * L], [r * 0.8, 1.06 * L], [0, 1.1 * L]], top, fab, 12); }   // deltoid, bicep, a slimmer elbow
      } else if (part === 'fore') {
        { const r = d.armR * sleeve, L = d.fore, cuff = puff ? 1.3 : 1; g.lathe(0, -L, 0, [[0, -0.03 * L], [r * 0.72 * cuff, -0.01 * L], [r * 0.76 * cuff, 0.12 * L], [r * 0.9, 0.45 * L], [r * 1.08, 0.78 * L], [r * 1.04, 0.96 * L], [r * 0.75, 1.04 * L], [0, 1.07 * L]], top, fab, 12); }   // thick near the elbow, narrow at the wrist
        if (puff) g.torus(0, -d.fore * 0.92, 0, d.armR * 1.05, d.armR * 0.35, shade(top, 0.85), fab, 12, 5);
        else if (c.top[0] === 'shirt') { g.cyl(0, -d.fore * 1.0, 0, d.armR * 1.08, d.fore * 0.13, shade(top, 1.12), fab, 10); g.sphere(d.armR * 1.08, -d.fore * 0.94, 0, d.H * 0.003, H('#d9d5cc'), MAT.CERAMIC, 4); }
        else if (c.top[0] === 'sweater') for (let i = 0; i < 3; i++) g.torus(0, -d.fore * (0.9 + i * 0.035), 0, d.armR * 1.0, d.armR * 0.2, shade(top, 0.82), fab, 10, 4);
        else g.torus(0, -d.fore * 0.95, 0, d.armR * 1.12, d.armR * 0.22, shade(top, 0.85), fab, 10, 4);
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
        { const R = d.legR * (c.fem ? 1.55 : 1.5), L = d.thigh; g.lathe(0, -L, 0, [[0, -0.05 * L], [R * 0.62, -0.03 * L], [R * 0.76, 0.06 * L], [R * 0.8, 0.25 * L], [R * 0.9, 0.55 * L], [R * 1.0, 0.82 * L], [R * 0.98, 0.98 * L], [R * 0.7, 1.06 * L], [0, 1.1 * L]], pants, fab, 14); }   // full at the top, tapering to the knee
        g.rbox(0, -d.thigh * 0.95, -d.legR * 1.3, 0.004, d.thigh * 0.8, 0.004, 0, shade(pants, 1.25), fab, 0.002);   // crease
        g.ellipsoid(0, -d.thigh * 0.99, -d.legR * 0.12, d.legR * 1.17, d.legR * 0.9, d.legR * 1.14, pants, fab, 10, 6);   // knee
      } else if (part === 'shin') {
        const sc = c.boots ? shoes : pants;
        if (c.boots) { g.capsule(d.shin * 0.55, d.legR * 0.85, d.legR * 0.7, pants, fab, 10); g.push(A.T(0, -d.shin * 0.45, 0)); g.capsule(d.shin * 0.55, d.legR * 0.95, d.legR * 0.75, sc, MAT.LEATHER, 10); g.pop(); }
        else { { const R = d.legR, L = d.shin, kid = d.k > 0.5; g.lathe(0, -L, 0, [[0, -0.03 * L], [R * 1.0, -0.01 * L], [R * 1.02, 0.1 * L], [R * (kid ? 0.95 : 1.05), 0.4 * L], [R * (kid ? 1.12 : 1.14), 0.72 * L], [R * 1.16, 0.92 * L], [R * 0.85, 1.04 * L], [0, 1.08 * L]], sc, fab, 12); } g.torus(0, -d.shin * 0.97, 0, d.legR * 1.1, d.legR * 0.13, shade(sc, 0.8), fab, 12, 4); g.rbox(0, -d.shin * 0.95, -d.legR * 1.16, 0.004, d.shin * 0.9, 0.004, 0, shade(sc, 1.25), fab, 0.002); }   // straight leg, hem, crease
      } else if (part === 'foot') {
        const L = d.H * 0.15;
        g.param((u, v) => { const a = u * TAU, y = v, zz = -L * 0.72 + v * 0, w = d.legR * (0.62 + 0.2 * Math.sin(Math.PI * Math.min(1, v * 1.3))), len = v; // a sole-to-heel loft: wide at the ball of the foot, round at the toe and heel
          const t = -Math.cos(Math.PI * v), z = -L * 0.25 + t * L * 0.5, half = Math.sqrt(Math.max(0, 1 - t * t)), ww = d.legR * (0.72 + 0.12 * Math.max(0, -t)) * (0.25 + 0.75 * half), hh = d.footH * (0.95 + 0.25 * Math.max(0, t)) * (0.3 + 0.7 * half);
          return [Math.cos(a) * ww, -d.footH * 0.55 + Math.max(-0.45, Math.sin(a)) * hh, z]; }, 14, 12, shoes, MAT.LEATHER);
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
      const sw = ((a.seed || 0) * 7) % 2 < 1 ? 1 : -1;   // which leg takes the weight
      P.lean = -0.03 + 0.015 * br; P.pelvisX = 0.05; P.neckX = 0.1; P.headX = -0.06 + 0.02 * br; P.side = 0.025 * sw;
      P.shX = [0.06, 0.03]; P.shZ = [0.13, 0.12]; P.el = [0.3, 0.36]; P.wr = [0.12, 0.18];
      P.hipX = sw > 0 ? [0.04, -0.07] : [-0.07, 0.04]; P.hipZ = sw > 0 ? [0.0, 0.06] : [0.06, 0.0]; P.kn = sw > 0 ? [0.04, 0.16] : [0.16, 0.04]; P.an = sw > 0 ? [0, 0.08] : [0.08, 0];
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
      case 'shield': set('shX', 0, 1.35); set('shZ', 0, 0.75); set('el', 0, 0.15); set('lean', null, -0.08); set('shX', 1, 0.6); set('el', 1, 1.1); break;   // left arm thrown out across the person beside him
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
    { const dd = dims(id); a._head = A.p(B.head, 0, dd.headRy * 0.95, 0); }   // for cameras and tests
    for (const i of [0, 1]) {
      const sd = i ? 'R' : 'L';
      buf.emit(personPart(id, 'hand', sd), B['wr' + i]);
      buf.emit(personPart(id, 'foot'), B['an' + i]);
    }
    drawLimbs(buf, a, B);
    const d = dims(id);
    for (const [k, i] of [['R', 1], ['L', 0]]) {
      const item = a['hold' + k];
      if (item) buf.emit(propMesh(item), A.chain(B['wr' + i], A.T(0, -d.hand * 0.6, -d.hand * 0.25), item === 'plate' ? A.Rx(Math.PI / 2) : A.I()));
    }
    a._B = B;
  }
  // Arms and legs as ONE smooth limb each, rebuilt every frame through the real joints: it comes out from inside the
  // torso, swells over the shoulder or thigh, slims into the elbow or knee, bends round it on a curve (no seam, no
  // ball joint), fills out over the forearm or calf and narrows to the wrist or ankle.
  function limb(g, P0, P1, P2, ext, prof, col, mat, cuff) {
    const sub = (u, v) => [u[0] - v[0], u[1] - v[1], u[2] - v[2]], L3 = (u, v, t) => [lerp(u[0], v[0], t), lerp(u[1], v[1], t), lerp(u[2], v[2], t)];
    const up = sub(P0, P1), ul = Math.hypot(...up) || 1, start = [P0[0] + up[0] / ul * ext, P0[1] + up[1] / ul * ext, P0[2] + up[2] / ul * ext];
    const pts = [], rad = [], add = (p, k) => { pts.push(p); rad.push(prof(k)); };
    for (const t of [0, 0.5]) add(L3(start, P0, t), -1 + t * 2 * 0.999);                     // inside the body -> the root
    for (const t of [0.15, 0.35, 0.55, 0.72]) add(L3(P0, P1, t), t);                          // upper segment
    const q0 = L3(P0, P1, 0.84), q1 = L3(P1, P2, 0.16);
    for (const t of [0, 0.33, 0.66, 1]) { const a2 = L3(q0, P1, t), b2 = L3(P1, q1, t); add(L3(a2, b2, t), t < 0.5 ? 0.84 + t * 0.32 : 1 + (t - 0.5) * 0.32); }   // round the joint
    for (const t of [0.3, 0.5, 0.7, 0.86, 1]) add(L3(P1, P2, t), 1 + t);                      // lower segment
    if (cuff) { const n = pts.length; g.tube(pts.slice(0, n - 1), rad.slice(0, n - 1), col, mat, 12, true); g.tube([L3(P1, P2, 0.84), L3(P1, P2, 1.0)], [prof(1.84) * 1.06, prof(2) * 1.08], cuff, mat, 12, true); }
    else g.tube(pts, rad, col, mat, 12, true);
  }
  function drawLimbs(buf, a, B) {
    const id = a.id, c = CHARS[id], d = dims(id), s = a.scale || 1, g = new Geo();
    const top = H(c.top[1]), pants = H(c.pants), shoes = H(c.shoes), puff = c.top[0] === 'puffer', coat = c.top[0] === 'coat', fab = MAT.FABRIC;
    const sleeve = (puff ? 1.45 : coat ? 1.25 : 1.12) * s, ar = d.armR * sleeve, lr = d.legR * s, kid = d.k > 0.5;
    const cuffC = c.top[0] === 'shirt' ? shade(top, 1.12) : shade(top, 0.85);
    // radius along the limb: k = -1..0 inside the body, 0..1 upper segment, 1..2 lower segment
    const arm = (k) => ar * (k < 0 ? 1.05 : k < 1 ? lerp(1.22, 0.9, k) + 0.14 * Math.exp(-(((k - 0.62) / 0.2) ** 2)) : lerp(1.0, 0.74, (k - 1) ** 0.8) + 0.06 * Math.exp(-(((k - 1.3) / 0.25) ** 2)));
    const leg = (k) => lr * (k < 0 ? 1.5 : k < 1 ? lerp(c.fem ? 1.6 : 1.55, 1.05, k ** 1.2) : (kid ? lerp(1.02, 0.82, k - 1) + 0.12 * Math.exp(-(((k - 1.32) / 0.22) ** 2)) : lerp(1.06, 0.96, k - 1) + 0.06 * Math.exp(-(((k - 1.3) / 0.25) ** 2))));
    for (const i of [0, 1]) {
      const sh = A.p(B['sh' + i], 0, 0, 0), el = A.p(B['el' + i], 0, 0, 0), wr = A.p(B['wr' + i], 0, 0, 0);
      limb(g, sh, el, wr, ar * 0.9, arm, top, fab, puff ? shade(top, 0.85) : cuffC);
      const hp = A.p(B['hp' + i], 0, 0, 0), kn = A.p(B['kn' + i], 0, 0, 0), an = A.p(B['an' + i], 0, 0, 0);
      if (c.boots) { limb(g, hp, kn, an, lr * 1.3, leg, pants, fab, null); const bt = [lerp(kn[0], an[0], 0.42), lerp(kn[1], an[1], 0.42), lerp(kn[2], an[2], 0.42)]; g.tube([bt, an], [lr * 1.12, lr * 0.98], shoes, MAT.LEATHER, 12, true); }
      else limb(g, hp, kn, an, lr * 1.3, leg, pants, fab, shade(pants, 0.82));
    }
    buf.emit(g.data, A.I());
  }
  // world position of a hand (for holding hands)
  function handPos(a, i) { const B = a._B; if (!B) return null; const d = dims(a.id); return A.p(B['wr' + i], 0, -d.hand * 0.5, 0); }

  // ---------- Krampus ----------
  const KC = { fur: '#1e1612', fur2: '#2f241c', skin: '#2b1916', horn: '#cdbf9f', hornTip: '#5e5038', eye: '#ffae1f', tongue: '#6e1019', teeth: '#e8e2d0', chain: '#7d8288', bell: '#d6b24a', sack: '#8a6a46', hoof: '#151110' };
  // Put a hoof at (fwd, up) relative to the ground under the hip, with the cannon bone at angle `meta` (from straight
  // down, + = forward). Solves thigh and shin (knee forward), so feet plant instead of swinging through the air.
  function legIK(P, i, fwd, up, meta) {
    const L1 = KD.thigh, L2 = KD.shin, L3 = KD.meta, hj = P.hip - 0.05;
    const ax = fwd - L3 * Math.sin(meta), ay = hj - (up + L3 * Math.cos(meta));                 // ankle, measured down from the hip
    let d = Math.hypot(ax, ay); const dm = (L1 + L2) * 0.995; const sc = d > dm ? dm / d : d < 0.35 ? 0.35 / d : 1;
    const x = ax * sc, y = ay * sc; d = Math.hypot(x, y);
    const a0 = Math.atan2(x, y), al = Math.acos(clamp((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), -1, 1));
    const th = a0 + al, kx = L1 * Math.sin(th), ky = L1 * Math.cos(th), sh = Math.atan2(x - kx, y - ky);
    P.hipX[i] = th - P.pelvisX; P.kn[i] = th - sh; P.an[i] = meta - sh;
  }
  const KD = { hip: 1.62, spine: 0.45, chest: 0.9, neck: 0.3, shW: 0.46, upper: 0.86, fore: 0.92, hand: 0.3, thigh: 0.68, shin: 0.66, meta: 0.44, hipW: 0.22 };
  function tufts(g, n, cx, cy, cz, rx, ry, rz, len, seed, keep) {
    const r = mulberry32(seed);
    for (let i = 0; i < n; i++) {
      const u = r() * TAU, v = r() * 2 - 1, c = Math.sqrt(1 - v * v);
      const nx = Math.cos(u) * c, ny = v, nz = Math.sin(u) * c;
      if (keep && !keep(nx, ny, nz)) continue;
      const px = cx + nx * rx, py = cy + ny * ry, pz = cz + nz * rz;
      const dir = [nx * 0.42, ny * 0.2 - 0.9, nz * 0.42];
      g.push(A.mul(A.T(px, py, pz), A.alignY([-dir[0], -dir[1], -dir[2]])));
      const L = len * (0.6 + r() * 0.7);
      g.ellipsoid(0, -L * 0.5, 0, L * 0.085, L * 0.6, L * 0.055, shade(H(r() < 0.5 ? KC.fur : KC.fur2), 0.7 + r() * 0.6), MAT.FUR, 5, 4);
      g.pop();
    }
  }
  // ridged horns: up out of the skull, sweeping back and flaring out, dark at the root and bone at the tip
  function horn(g, side) {
    const N = 40, pts = [], rad = [];
    for (let i = 0; i <= N; i++) {
      const t = i / N, a = t * 1.55, r = 0.44;
      pts.push([side * (0.085 + 0.24 * t + 0.16 * t * t * t), 0.29 + r * Math.sin(a) * (1 - 0.15 * t), -0.03 + r * (1 - Math.cos(a)) * 0.95 - 0.06 * Math.sin(t * Math.PI)]);
      rad.push((0.062 * Math.pow(1 - t, 0.85) + 0.004) * (1 + (t < 0.8 ? 0.13 * Math.max(0, Math.sin(t * 55)) : 0)));
    }
    const cols = ['#1d140c', '#2f2418', '#4f4231', '#857559'];
    for (let k = 0; k < 4; k++) { const i0 = Math.max(0, k * 10 - 1), i1 = Math.min(N, k * 10 + 11); g.tube(pts.slice(i0, i1 + 1), rad.slice(i0, i1 + 1).map((r) => r * (1 + 0.012 * k)), H(cols[k]), MAT.HORN, 9, k === 0 || k === 3); }
  }
  // the skull: long and narrow like a goat's, deep under the brow, the muzzle dropping to a snarl
  function lerpKeys(K, v, i) { for (let j = 0; j < K.length - 1; j++) if (v <= K[j + 1][0]) { const u = smooth((v - K[j][0]) / (K[j + 1][0] - K[j][0])); return lerp(K[j][i], K[j + 1][i], u); } return K[K.length - 1][i]; }
  //            v     w     up    down   cy
  const SKULL = [[0, 0.02, 0.02, 0.02, 0.17], [0.07, 0.11, 0.12, 0.09, 0.17], [0.24, 0.16, 0.165, 0.12, 0.175], [0.4, 0.145, 0.14, 0.1, 0.17],
    [0.52, 0.112, 0.095, 0.07, 0.155], [0.74, 0.088, 0.075, 0.045, 0.125], [0.92, 0.078, 0.062, 0.038, 0.11], [1, 0.02, 0.015, 0.012, 0.105]];
  const skullZ = (v) => lerp(0.2, -0.42, v);
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
        g.ellipsoid(0, 0.88, 0.2, 0.46, 0.3, 0.3, shade(fur, 0.95), MAT.FUR, 14, 8);                                   // hunched hump over the shoulders
        tufts(g, 90, 0, 0.95, 0.18, 0.46, 0.28, 0.3, 0.55, 34, (x, y, z) => y > -0.3 && z > -0.5);                    // long ragged mane
        g.ellipsoid(0, 0.35, -0.24, 0.26, 0.3, 0.1, shade(skin, 1.05), MAT.HIDE, 12, 8);
        // diagonal chain across the chest
        const pts = []; for (let i = 0; i <= 20; i++) { const t = i / 20; pts.push([lerp(-0.42, 0.38, t), lerp(0.95, 0.05, t), -0.33 - 0.06 * Math.sin(t * Math.PI)]); }
        for (let i = 0; i < 20; i++) { const p = pts[i], q = pts[i + 1]; g.push(A.mul(A.T(p[0], p[1], p[2]), A.alignY([q[0] - p[0], q[1] - p[1], q[2] - p[2]]))); g.push(i % 2 ? A.Ry(Math.PI / 2) : A.I()); g.push(A.Rx(Math.PI / 2)); g.torus(0, 0, 0, 0.04, 0.011, H(KC.chain), MAT.METAL, 8, 4); g.pop(); g.pop(); g.pop(); }
        g.tube([[0.35, 0.95, -0.12], [0.45, 0.6, 0.25], [0.3, 0.2, 0.42]], 0.03, H('#5a4530'), MAT.LEATHER, 6, false);
        // ribs showing through the hide, and a row of bone spines down the back
        for (let i = 0; i < 4; i++) for (const sd of [-1, 1]) g.tube([[sd * 0.04, 0.5 - i * 0.09, -0.335], [sd * 0.16, 0.47 - i * 0.09, -0.31], [sd * 0.26, 0.43 - i * 0.09, -0.22]], [0.016, 0.014, 0.008], H('#6b5348'), MAT.HIDE, 5);
        for (let i = 0; i < 7; i++) { const y = 0.98 - i * 0.14, L = 0.2 - Math.abs(i - 2) * 0.022; g.push(A.chain(A.T(0, y, 0.3 + 0.05 * Math.sin(i * 0.6)), A.Rx(1.15))); g.lathe(0, 0, 0, [[0.035, 0], [0.022, L * 0.5], [0, L]], H(KC.horn), MAT.CERAMIC, 6); g.pop(); }
      } else if (part === 'neck') {
        g.capsule(0.34, 0.2, 0.24, H(KC.fur), MAT.FUR, 12);
        g.push(A.T(0, 0.05, 0)); tufts(g, 40, 0, -0.15, 0, 0.22, 0.2, 0.22, 0.3, 44); g.pop();
      } else if (part === 'head') {
        g.param((u, v) => {
          const w = lerpKeys(SKULL, v, 1), up = lerpKeys(SKULL, v, 2), dn = lerpKeys(SKULL, v, 3), cy = lerpKeys(SKULL, v, 4), a = u * TAU, c = Math.cos(a), sn = Math.sin(a);
          const cheek = Math.exp(-Math.pow((v - 0.6) / 0.08, 2)) * 0.22 * Math.max(0, -sn + 0.3);   // hollow under the cheekbone
          const x = w * Math.sign(c) * Math.pow(Math.abs(c), 0.8) * (1 - cheek), y = cy + (sn > 0 ? up : dn) * Math.sign(sn) * Math.pow(Math.abs(sn), 0.85);
          return [x, y - 0.03 * Math.exp(-Math.pow((v - 0.47) / 0.06, 2)) * Math.max(0, sn) * (1 - Math.abs(c)), skullZ(v)];   // a dip at the bridge between the eyes
        }, 22, 30, skin, MAT.HIDE);
        for (const s of [-1, 1]) {
          // a brow that overhangs and slants down to the middle, so he always looks furious
          g.push(A.chain(A.T(s * 0.07, 0.244, -0.14), A.Rz(s * 0.45), A.Ry(-s * 0.3))); g.ellipsoid(0, 0, 0, 0.085, 0.02, 0.048, shade(skin, 0.75), MAT.HIDE, 10, 6); g.pop();
          g.push(A.chain(A.T(s * 0.062, 0.205, -0.15), A.Ry(s * 0.35), A.Rz(s * 0.3))); g.ellipsoid(0, 0, 0, 0.04, 0.028, 0.02, H('#030101'), 0, 10, 6); g.pop();        // deep socket
          g.push(A.chain(A.T(s * 0.068, 0.204, -0.166), A.Ry(s * 0.35), A.Rz(s * 0.34))); g.ellipsoid(0, 0, 0, 0.038, 0.014, 0.01, H('#ff2a08'), MAT.GLOW, 12, 6);    // narrow ember eye, slanted
          g.ellipsoid(0, 0.001, -0.006, 0.024, 0.008, 0.007, H('#ffe08a'), MAT.GLOW, 8, 4); g.ellipsoid(0, 0, -0.011, 0.0035, 0.013, 0.003, H('#080000'), 0, 6, 4); g.pop();
          g.push(A.chain(A.T(s * 0.095, 0.168, -0.13), A.Rz(-s * 0.5))); g.ellipsoid(0, 0, 0, 0.038, 0.014, 0.05, shade(skin, 1.15), MAT.HIDE, 8, 5); g.pop();   // cheekbone
          g.push(A.chain(A.T(s * 0.15, 0.27, 0.06), A.Rz(-s * 1.5), A.Rx(0.6))); g.lathe(0, 0, 0, [[0, 0], [0.045, 0.03], [0.04, 0.12], [0.018, 0.22], [0, 0.27]], shade(skin, 0.85), MAT.HIDE, 8); g.pop();   // long ear, laid back
          horn(g, s);
          // the snarl: lip pulled up off the teeth, gum showing
          g.tube([[s * 0.03, 0.078, -0.405], [s * 0.065, 0.08, -0.35], [s * 0.084, 0.09, -0.27], [s * 0.098, 0.1, -0.18], [s * 0.11, 0.11, -0.12]], [0.012, 0.015, 0.017, 0.014, 0.008], H('#3a0c10'), MAT.HIDE, 6);
          g.push(A.chain(A.T(s * 0.022, 0.112, -0.435), A.Rz(s * 0.5))); g.ellipsoid(0, 0, 0, 0.008, 0.016, 0.008, H('#050101'), 0, 6, 4); g.pop();   // flared nostril
          for (let k = 0; k < 3; k++) g.tube([[s * 0.005, 0.19 - k * 0.012, -0.24 - k * 0.04], [s * 0.045, 0.18 - k * 0.013, -0.235 - k * 0.04], [s * 0.078, 0.15 - k * 0.012, -0.225 - k * 0.04]], 0.008, shade(skin, 0.6), MAT.HIDE, 5);   // wrinkles over the nose
        }
        g.ellipsoid(0, 0.112, -0.405, 0.038, 0.018, 0.024, H('#160a09'), MAT.HIDE, 10, 6);                               // flat, cracked nose
        for (let i = 0; i < 9; i++) for (const s of [-1, 1]) {                                                        // upper teeth, two hooked fangs
          const z = -0.39 + i * 0.032, fang = i === 1, L = fang ? 0.09 : 0.03 + 0.018 * ((i * 7) % 3), x = s * (0.034 + 0.065 * (i / 8) + 0.012);
          g.push(A.chain(A.T(x, 0.08 + i * 0.004, z), A.Rx(Math.PI + (fang ? -0.15 : 0)), A.Rz(s * 0.08))); g.lathe(0, 0, 0, [[0.011, 0], [0.008, L * 0.5], [0, L]], shade(H(KC.teeth), 0.7 + 0.3 * ((i * 5) % 2)), MAT.CERAMIC, 6); g.pop();
        }
        tufts(g, 40, 0, 0.22, 0.12, 0.15, 0.12, 0.13, 0.26, 66, (x, y, z) => z > -0.2 && y > -0.3);                    // mane behind the horns
      } else if (part === 'jaw') {
        // long lower jaw, hinged under the eyes
        g.param((u, v) => { const a = u * TAU, c = Math.cos(a), sn = Math.sin(a), w = 0.08 - 0.025 * v, d = 0.05 - 0.015 * v, e = Math.sin(Math.min(1, v / 0.08) * Math.PI / 2) * Math.sqrt(Math.max(0, 1 - Math.pow(Math.max(0, (v - 0.88) / 0.12), 2)));
          return [w * e * Math.sign(c) * Math.pow(Math.abs(c), 0.8), (sn < 0 ? d : 0.008) * e * Math.sign(sn) * Math.pow(Math.abs(sn), 0.85) - 0.012, lerp(0.02, -0.33, v)]; }, 14, 18, H(KC.skin), MAT.HIDE);
        g.ellipsoid(0, -0.002, -0.16, 0.048, 0.006, 0.14, H('#2a0508'), 0, 10, 5);                                     // the wet dark inside
        for (let i = 0; i < 8; i++) for (const s of [-1, 1]) {
          const z = -0.31 + i * 0.034, fang = i === 0, L = fang ? 0.055 : 0.026 + 0.014 * ((i * 5) % 3), x = s * (0.03 + 0.036 * (i / 7));
          g.push(A.chain(A.T(x, -0.004, z), A.Rz(-s * 0.06))); g.lathe(0, 0, 0, [[0.01, 0], [0.007, L * 0.5], [0, L]], shade(H(KC.teeth), 0.68 + 0.3 * ((i * 3) % 2)), MAT.CERAMIC, 6); g.pop();
        }
        tufts(g, 22, 0, -0.05, 0.0, 0.06, 0.03, 0.08, 0.22, 57, (x, y) => y < 0.2);                                  // matted beard off the jaw
      } else if (part === 'upper') {
        g.capsule(KD.upper, 0.17, 0.12, H(KC.fur), MAT.FUR, 12);
        tufts(g, 44, 0, -KD.upper * 0.45, 0, 0.16, KD.upper * 0.5, 0.15, 0.34, 77 + (extra === 'R' ? 1 : 0));
      } else if (part === 'fore') {
        g.capsule(KD.fore, 0.115, 0.075, H(KC.skin), MAT.HIDE, 10);
        g.tube([[0.03, -0.1, -0.06], [0.05, -KD.fore * 0.5, -0.07], [0.02, -KD.fore * 0.85, -0.05]], [0.022, 0.03, 0.018], shade(H(KC.skin), 1.1), MAT.HIDE, 6);   // tendon
        tufts(g, 14, 0, -KD.fore * 0.25, 0, 0.1, KD.fore * 0.25, 0.1, 0.18, 88, (x, y) => y > -0.3);
      } else if (part === 'hand') {
        g.ellipsoid(0, -0.08, 0, 0.09, 0.1, 0.05, H(KC.skin), MAT.HIDE, 10, 6);
        for (let i = 0; i < 4; i++) {
          const x = -0.06 + i * 0.04, L = 0.2 - Math.abs(i - 1.5) * 0.02;
          const pts = [[x, -0.14, 0], [x * 1.1, -0.14 - L * 0.5, -0.025], [x * 1.15, -0.14 - L, -0.07]];
          g.tube(pts, [0.019, 0.016, 0.012], H(KC.skin), MAT.HIDE, 6);
          g.push(A.mul(A.T(...pts[2]), A.alignY([0, -0.6, -0.8]))); g.lathe(0, 0, 0, [[0.016, 0], [0.011, 0.12], [0, 0.3]], H('#120d0a'), MAT.CERAMIC, 6); g.pop();
        }
        g.tube([[0.07, -0.08, -0.02], [0.11, -0.13, -0.06], [0.12, -0.18, -0.09]], [0.02, 0.016, 0.012], H(KC.skin), MAT.HIDE, 6);
      } else if (part === 'thigh') {
        g.capsule(KD.thigh, 0.19, 0.13, H(KC.fur), MAT.FUR, 12);
        tufts(g, 46, 0, -KD.thigh * 0.45, 0, 0.18, KD.thigh * 0.5, 0.18, 0.32, 99 + (extra === 'R' ? 1 : 0));
      } else if (part === 'shin') {
        g.capsule(KD.shin, 0.13, 0.085, H(KC.fur), MAT.FUR, 10);
        tufts(g, 34, 0, -KD.shin * 0.4, 0, 0.12, KD.shin * 0.45, 0.12, 0.32, 111 + (extra === 'R' ? 1 : 0));
      } else if (part === 'meta') {
        g.capsule(KD.meta, 0.06, 0.05, H(KC.skin), MAT.HIDE, 8);
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
    if (an === 'run') {
      // A charge, not a jog: low and heavy, a bound with a moment off the ground between strides, hooves planted
      // and pushed back under him at the speed he is moving, arms pumping and raking forward, head up and locked on.
      const C = 2.016 / (k.scale || 1), beta = 0.36, sweep = C * beta, fo = 0.12;
      const U = [0, Math.PI].map((o) => (((ph + o) / TAU) % 1 + 1) % 1);   // per leg: 0..beta on the ground, then in the air
      let comp = 0; for (const u of U) if (u < beta) comp = Math.max(comp, Math.sin(Math.PI * u / beta));
      P.hip = 1.3 - 0.1 * comp + 0.07 * (1 - comp);                             // sinks onto each stride, lifts between them
      for (const i of [0, 1]) {
        const u = U[i];
        if (u < beta) {
          const q = u / beta;
          legIK(P, i, fo + sweep * (0.5 - q), 0, lerp(0.32, -0.15, q));                       // planted, rolling onto the toe
        } else {
          const q = (u - beta) / (1 - beta), e = q * q * (3 - 2 * q);
          legIK(P, i, fo + sweep * (e - 0.5) + 0.12 * Math.sin(Math.PI * q), 0.5 * Math.pow(Math.sin(Math.PI * Math.pow(q, 0.75)), 1.2), lerp(-0.7, 0.32, Math.pow(q, 1.5)));   // knee up, hoof tucked, reaching forward
        }
      }
      P.lean = -0.72 - 0.08 * Math.sin(ph * 2 + 0.6); P.roll = 0.06 * Math.sin(ph);
      P.twist = -0.3 * Math.sin(ph);                                            // shoulders against the hips
      P.neckX = 0.42 + 0.05 * Math.sin(ph * 2); P.headX = 0.42 - 0.06 * Math.sin(ph * 2 + 0.6); P.headY = 0; P.headZ = 0.05 * Math.sin(ph);
      P.jaw = 0.55 + 0.1 * Math.sin(ph * 2);
      for (const [i, sg] of [[0, -1], [1, 1]]) {                                // each arm opposite its leg
        const w = Math.sin(ph + (i ? Math.PI : 0)) * sg * -1;
        P.shX[i] = 0.9 + 0.42 * w; P.shZ[i] = 0.34 + 0.06 * w; P.el[i] = 0.55 + 0.55 * Math.max(0, w) + 0.35 * Math.max(0, -w); P.wr[i] = 0.75 + 0.35 * Math.max(0, w);   // claws hooked, raking low (0.72 = hanging straight down from the hunched chest)
      }
      carry();
      P.sackRot = 0.25 * Math.sin(ph * 2);
    } else if (an === 'walk') {
      const run = false;
      for (const [i, o] of [[0, Math.PI], [1, 0]]) {
        const p = ph + o;
        P.hipX[i] = (run ? 0.55 : 0.5) + (run ? 0.8 : 0.5) * Math.sin(p);
        P.kn[i] = (run ? 1.25 : 1.3) + (run ? 0.75 : 0.45) * Math.max(0, Math.sin(p - 1.0));
        P.an[i] = 0.8 + 0.3 * Math.sin(p + 0.6);
      }
      const lurch = Math.max(0, Math.sin(ph));                                  // drops onto the left leg
      P.hip = KD.hip - (run ? 0.2 : 0.16) - Math.abs(Math.cos(ph)) * (run ? 0.12 : 0.05) - lurch * (run ? 0.05 : 0.11);
      P.roll = (run ? 0.1 : 0.17) * Math.sin(ph); P.twist = (run ? 0.2 : 0.16) * Math.sin(ph);
      P.lean = run ? -0.95 : -0.62; P.neckX = run ? 0.5 : 0.3; P.headX = run ? 0.35 : 0.34;
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
      P.hip = KD.hip - 0.14; P.hipX = [0.5, 0.42]; P.kn = [1.32, 1.24]; P.lean = -0.5 - 0.04 * br; P.neckX = 0.25; P.headX = 0.32;
      P.headY = 0.55 * Math.sin(t * 0.55); P.headZ = 0.14 * Math.sin(t * 0.9) + (Math.sin(t * 0.31) > 0.94 ? 0.38 : 0);
      P.shX = [0.48 + 0.05 * br, 0.44 - 0.04 * br]; P.shZ = [0.2, 0.26]; P.el = [0.25, 0.5]; P.wr = [0.45 + 0.25 * Math.sin(t * 2.1), 0.5 + 0.2 * Math.sin(t * 1.6 + 1)];
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
        if (gs.name === 'peer') {
          // Bent over the opening. After he settles, a loop: the slow head-tilt of something listening, a twitch now and
          // then, his tongue dragged across his teeth, a low laugh that shakes his jaw and shoulders, then he leans closer
          // and sniffs, and licks again. (game.js plays the sounds on the same clock: K.peerT == t - gs.t0.)
          const te = t - gs.t0, cyc = te < 2.4 ? -1 : (te - 2.4) % 22;
          const win = (a, b, r = 0.6) => cyc < 0 ? 0 : smooth(clamp((cyc - a) / r, 0, 1)) * (1 - smooth(clamp((cyc - b) / r, 0, 1)));
          const lick = Math.max(win(3.2, 6.0), win(17.2, 19.8)), laugh = win(9.6, 14.0, 0.3), close = win(14.6, 19.5, 1.2);
          const twitch = cyc >= 0 && (cyc % 5.3) < 0.16 ? Math.sign(Math.sin(te * 3.7)) : 0;
          set('hip', null, 0.82); set('lean', null, -1.15 - 0.06 * close + 0.04 * Math.sin(t * 0.9)); set('neckX', null, -0.2 - 0.08 * close);
          set('headX', null, -0.62 + 0.05 * Math.sin(t * 0.5) + laugh * 0.08 * Math.sin(te * 15));
          set('headY', null, 0.18 * Math.sin(t * 0.21));
          set('headZ', null, 0.3 * Math.sin(te * 0.42) + twitch * 0.25);
          set('jaw', null, laugh > 0.02 ? 0.3 + laugh * 0.34 * Math.abs(Math.sin(te * 9)) : 0.2 + 0.14 * Math.sin(t * 0.7) + 0.28 * lick);
          for (const i of [0, 1]) { set('hipX', i, 1.25); set('kn', i, 2.2); set('an', i, 1.25); set('shX', i, 1.0 + laugh * 0.09 * Math.sin(te * 9 + i * 2)); set('el', i, 0.5); set('shZ', i, 0.4); }
          k._lick = lick > 0.02 ? { a: lick, s: Math.sin(te * 2.3) } : null;
        }
        // the catch: hunched to your height, arms wide, jaw unhinged
        if (gs.name === 'scare') { const sh = Math.sin(t * 47) * 0.04; set('hip', null, 1.25); set('lean', null, 0.75); set('neckX', null, -0.75 + sh); set('headX', null, 0.38); set('headZ', null, sh * 2); set('jaw', null, 0.82 + sh * 2); for (const i of [0, 1]) { set('hipX', i, 0.8); set('kn', i, 1.6); set('an', i, 1.0); set('shX', i, 1.5); set('shZ', i, 1.0); set('el', i, 0.7); } }
      }
    }
    P.jaw += 0.12 + 0.03 * Math.sin(t * 2.3);
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
    const jw = A.chain(hd, A.T(0, 0.065, -0.1), A.Rx(P.jaw * 0.75)); buf.emit(kPart('jaw'), jw);
    // the tongue hangs and sways
    const tg = new Geo(); const pts = [], rad = [];
    const lk = k.gest && k.gest.name === 'peer' && k._lick;   // licking: out over the front teeth and dragged slowly side to side
    for (let i = 0; i <= 8; i++) { const u = i / 8, sw = Math.sin(t * 3 + u * 3) * 0.06 * u; const sc = k.gest && k.gest.name === 'scare';
      let p = [sw + 0.03 * u, -0.01 - u * (0.3 + 0.2 * P.jaw) * (sc ? 0.35 : 1), -0.26 - 0.1 * Math.sin(u * 2.2) - 0.06 * u];
      if (lk) { const q = [lk.s * 0.1 * Math.pow(u, 1.4), -0.01 + 0.035 * u + 0.03 * Math.sin(u * Math.PI), -0.26 - u * (0.12 - 0.05 * Math.abs(lk.s))]; p = p.map((v, j) => lerp(v, q[j], lk.a)); }
      pts.push(p); rad.push(0.026 * (1 - u * 0.7) * (lk ? 1 - 0.15 * lk.a : 1)); }
    tg.tube(pts, rad, hex(KC.tongue), MAT.HIDE, 7); buf.emit(tg.data, A.chain(jw, A.T(0, -0.01, -0.26), A.Rx(-P.jaw * 0.65), A.T(0, 0.01, 0.26))); // hangs with gravity, not with the jaw
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
    k._eye = A.p(hd, 0, 0.205, -0.2);
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
