// ============================================================
// BOX — geometry builder, math, collision (drawing is Three.js, see render3.js)
// Geometry builder with transforms + smooth primitives, a lit renderer
// with point lights, two shadow maps (one per floor), materials,
// glass and multiply passes, plus collision and line of sight.
// ============================================================

const TAU = Math.PI * 2;
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function lerp(a, b, t) { return a + (b - a) * t; }
function smooth(t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }
function hex(h) {
  const n = parseInt(h.replace('#', ''), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
function shade(c, k) { return [clamp(c[0] * k, 0, 1), clamp(c[1] * k, 0, 1), clamp(c[2] * k, 0, 1)]; }
function mix3(a, b, t) { return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]; }
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Materials — patterns and shading are done in the fragment shader
const MAT = { PLAIN: 0, PLANK: 1, TILE: 2, WOOD: 3, GLOW: 4, CONCRETE: 5, SHIPLAP: 6, BRICK: 7, CARPET: 8, FABRIC: 9,
  CERAMIC: 10, METAL: 11, GLASS: 12, SKIN: 13, HAIR: 14, FUR: 15, SNOW: 16, ASPHALT: 17, LEATHER: 18, GRAIN: 19 };

// ---------- affine transforms: row-major 3x4 ----------
const A = {
  I: () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0],
  T: (x, y, z) => [1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z],
  S: (s) => [s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0],
  Rx: (a) => { const c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, 0, c, -s, 0, 0, s, c, 0]; },
  Ry: (a) => { const c = Math.cos(a), s = Math.sin(a); return [c, 0, s, 0, 0, 1, 0, 0, -s, 0, c, 0]; },
  Rz: (a) => { const c = Math.cos(a), s = Math.sin(a); return [c, -s, 0, 0, s, c, 0, 0, 0, 0, 1, 0]; },
  mul(m, n) {
    const r = new Array(12);
    for (let i = 0; i < 3; i++) {
      const a = m[i * 4], b = m[i * 4 + 1], c = m[i * 4 + 2];
      r[i * 4] = a * n[0] + b * n[4] + c * n[8];
      r[i * 4 + 1] = a * n[1] + b * n[5] + c * n[9];
      r[i * 4 + 2] = a * n[2] + b * n[6] + c * n[10];
      r[i * 4 + 3] = a * n[3] + b * n[7] + c * n[11] + m[i * 4 + 3];
    }
    return r;
  },
  chain(...ms) { let r = ms[0]; for (let i = 1; i < ms.length; i++) r = A.mul(r, ms[i]); return r; },
  p(m, x, y, z) { return [m[0] * x + m[1] * y + m[2] * z + m[3], m[4] * x + m[5] * y + m[6] * z + m[7], m[8] * x + m[9] * y + m[10] * z + m[11]]; },
  v(m, x, y, z) { return [m[0] * x + m[1] * y + m[2] * z, m[4] * x + m[5] * y + m[6] * z, m[8] * x + m[9] * y + m[10] * z]; },
  // rotation that takes +y onto direction d
  alignY(d) {
    const l = Math.hypot(d[0], d[1], d[2]) || 1, y = [d[0] / l, d[1] / l, d[2] / l];
    const ref = Math.abs(y[1]) < 0.95 ? [0, 1, 0] : [1, 0, 0];
    let x = [y[1] * ref[2] - y[2] * ref[1], y[2] * ref[0] - y[0] * ref[2], y[0] * ref[1] - y[1] * ref[0]];
    const xl = Math.hypot(x[0], x[1], x[2]); x = [x[0] / xl, x[1] / xl, x[2] / xl];
    const z = [x[1] * y[2] - x[2] * y[1], x[2] * y[0] - x[0] * y[2], x[0] * y[1] - x[1] * y[0]];
    return [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0];
  },
};

// ---------- geometry builder ----------
// Vertex: x y z  nx ny nz  r g b  material   (10 floats)
// Box rotation convention: local (lx, lz) about a center with angle `yaw`
// goes to world  x = cx + lx*cos + lz*sin,  z = cz - lx*sin + lz*cos  (== A.Ry)
class Geo {
  // packed=true writes 20-byte vertices straight into an ArrayBuffer (used for the big static scene)
  constructor(packed = false) {
    this.packed = packed; this.count = 0; this.M = null; this.stack = [];
    this.cap = packed ? 1 << 16 : 1 << 12; this._alloc(this.cap);
  }
  _alloc(cap) {
    if (this.packed) { const ab = new ArrayBuffer(cap * 20); if (this.ab) new Uint8Array(ab).set(new Uint8Array(this.ab, 0, this.count * 20)); this.ab = ab; this.f = new Float32Array(ab); this.i8 = new Int8Array(ab); this.u8 = new Uint8Array(ab); }
    else { const f = new Float32Array(cap * 10); if (this.f) f.set(this.f.subarray(0, this.count * 10)); this.f = f; }
    this.cap = cap;
  }
  get data() { return this.f.subarray(0, this.count * 10); }
  push(m) { this.stack.push(this.M); this.M = this.M ? A.mul(this.M, m) : m; }
  pop() { this.M = this.stack.pop(); }
  _v(x, y, z, nx, ny, nz, c, m) {
    const M = this.M;
    if (M) {
      const X = M[0] * x + M[1] * y + M[2] * z + M[3], Y = M[4] * x + M[5] * y + M[6] * z + M[7], Z = M[8] * x + M[9] * y + M[10] * z + M[11];
      const NX = M[0] * nx + M[1] * ny + M[2] * nz, NY = M[4] * nx + M[5] * ny + M[6] * nz, NZ = M[8] * nx + M[9] * ny + M[10] * nz;
      x = X; y = Y; z = Z; nx = NX; ny = NY; nz = NZ;
    }
    if (this.count >= this.cap) this._alloc(this.cap * 2);
    if (this.packed) {
      const o = this.count * 20, f = this.f, q = o >> 2; f[q] = x; f[q + 1] = y; f[q + 2] = z;
      const l = Math.hypot(nx, ny, nz) || 1;
      this.i8[o + 12] = Math.round(nx / l * 127); this.i8[o + 13] = Math.round(ny / l * 127); this.i8[o + 14] = Math.round(nz / l * 127);
      const u = this.u8; u[o + 16] = c[0] * 255 + 0.5; u[o + 17] = c[1] * 255 + 0.5; u[o + 18] = c[2] * 255 + 0.5; u[o + 19] = m;
    } else {
      const o = this.count * 10, f = this.f;
      f[o] = x; f[o + 1] = y; f[o + 2] = z; f[o + 3] = nx; f[o + 4] = ny; f[o + 5] = nz; f[o + 6] = c[0]; f[o + 7] = c[1]; f[o + 8] = c[2]; f[o + 9] = m;
    }
    this.count++;
  }
  _quad(a, b, c, d, n, col, m) {
    this._v(...a, ...n, col, m); this._v(...b, ...n, col, m); this._v(...c, ...n, col, m);
    this._v(...a, ...n, col, m); this._v(...c, ...n, col, m); this._v(...d, ...n, col, m);
  }
  // quad with per-vertex normals; winding picked from the normals so callers needn't care
  _quadS(p0, p1, p2, p3, n0, n1, n2, n3, col, m) {
    const ax = p2[0] - p0[0], ay = p2[1] - p0[1], az = p2[2] - p0[2], bx = p3[0] - p1[0], by = p3[1] - p1[1], bz = p3[2] - p1[2];
    const cx = ay * bz - az * by, cy = az * bx - ax * bz, cz = ax * by - ay * bx;
    const s = cx * (n0[0] + n1[0] + n2[0] + n3[0]) + cy * (n0[1] + n1[1] + n2[1] + n3[1]) + cz * (n0[2] + n1[2] + n2[2] + n3[2]);
    if (s < 0) { let t = p1; p1 = p3; p3 = t; t = n1; n1 = n3; n3 = t; }
    this._v(...p0, ...n0, col, m); this._v(...p1, ...n1, col, m); this._v(...p2, ...n2, col, m);
    this._v(...p0, ...n0, col, m); this._v(...p2, ...n2, col, m); this._v(...p3, ...n3, col, m);
  }
  // box: center x, bottom y, center z, size, yaw
  box(cx, y0, cz, sx, sy, sz, yaw, col, mat = 0, top = null) {
    const c = Math.cos(yaw || 0), s = Math.sin(yaw || 0);
    const hx = sx / 2, hz = sz / 2, y1 = y0 + sy;
    const P = (lx, y, lz) => [cx + lx * c + lz * s, y, cz - lx * s + lz * c];
    const N = (lx, ly, lz) => [lx * c + lz * s, ly, -lx * s + lz * c];
    const p000 = P(-hx, y0, -hz), p100 = P(hx, y0, -hz), p110 = P(hx, y1, -hz), p010 = P(-hx, y1, -hz);
    const p001 = P(-hx, y0, hz), p101 = P(hx, y0, hz), p111 = P(hx, y1, hz), p011 = P(-hx, y1, hz);
    const side = col, tc = top || col;
    this._quad(p001, p101, p111, p011, N(0, 0, 1), side, mat);
    this._quad(p100, p000, p010, p110, N(0, 0, -1), side, mat);
    this._quad(p101, p100, p110, p111, N(1, 0, 0), side, mat);
    this._quad(p000, p001, p011, p010, N(-1, 0, 0), side, mat);
    this._quad(p011, p111, p110, p010, [0, 1, 0], tc, mat);
    this._quad(p000, p100, p101, p001, [0, -1, 0], shade(side, 0.8), mat);
  }
  // rounded box with smooth edges
  rbox(cx, y0, cz, sx, sy, sz, yaw, col, mat = 0, r = 0.05) {
    const h = [sx / 2, sy / 2, sz / 2];
    r = Math.min(r, h[0] * 0.98, h[1] * 0.98, h[2] * 0.98);
    const core = [h[0] - r, h[1] - r, h[2] - r];
    const g = (i) => [-h[i], -core[i], core[i], h[i]];
    this.push(A.mul(A.T(cx, y0 + h[1], cz), A.Ry(yaw || 0)));
    const pt = (x, y, z) => {
      const q = [clamp(x, -core[0], core[0]), clamp(y, -core[1], core[1]), clamp(z, -core[2], core[2])];
      let d = [x - q[0], y - q[1], z - q[2]]; const l = Math.hypot(d[0], d[1], d[2]) || 1; d = [d[0] / l, d[1] / l, d[2] / l];
      return [[q[0] + d[0] * r, q[1] + d[1] * r, q[2] + d[2] * r], d];
    };
    for (let ax = 0; ax < 3; ax++) for (const sgn of [-1, 1]) {
      const u = (ax + 1) % 3, v = (ax + 2) % 3, gu = g(u), gv = g(v);
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
        const P = [];
        for (const [a, b] of [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]]) { const c = [0, 0, 0]; c[ax] = sgn * h[ax]; c[u] = gu[a]; c[v] = gv[b]; P.push(pt(c[0], c[1], c[2])); }
        this._quadS(P[0][0], P[1][0], P[2][0], P[3][0], P[0][1], P[1][1], P[2][1], P[3][1], col, mat);
      }
    }
    this.pop();
  }
  // cylinder (axis 'y' default; (cx,y0,cz) is the bottom center)
  cyl(cx, y0, cz, r, h, col, mat = 0, seg = 12, axis = 'y', rTop = null) {
    if (typeof axis === 'number') { rTop = axis; axis = 'y'; }
    const rt = rTop == null ? r : rTop;
    if (axis === 'x') { this.push(A.mul(A.T(cx - h / 2, y0, cz), A.Rz(-Math.PI / 2))); this.cyl(0, 0, 0, r, h, col, mat, seg, 'y', rt); this.pop(); return; }
    if (axis === 'z') { this.push(A.mul(A.T(cx, y0, cz - h / 2), A.Rx(Math.PI / 2))); this.cyl(0, 0, 0, r, h, col, mat, seg, 'y', rt); this.pop(); return; }
    this.lathe(cx, y0, cz, [[0, 0, 1], [r, 0, 1], [rt, h, 1], [0, h, 1]], col, mat, seg);
  }
  sphere(cx, cy, cz, r, col, mat = 0, seg = 10) { this.ellipsoid(cx, cy, cz, r, r, r, col, mat, seg, Math.max(4, seg >> 1)); }
  ellipsoid(cx, cy, cz, rx, ry, rz, col, mat = 0, seg = 12, rings = 8, keep = null) {
    const P = (t, a) => { const ct = Math.cos(t); return [Math.cos(a) * ct, Math.sin(t), Math.sin(a) * ct]; };
    for (let i = 0; i < rings; i++) {
      const t0 = -Math.PI / 2 + Math.PI * i / rings, t1 = -Math.PI / 2 + Math.PI * (i + 1) / rings;
      for (let j = 0; j < seg; j++) {
        const a0 = TAU * j / seg, a1 = TAU * (j + 1) / seg;
        const u = [P(t0, a0), P(t0, a1), P(t1, a1), P(t1, a0)];
        if (keep) { const c = P((t0 + t1) / 2, (a0 + a1) / 2); if (!keep(c[0], c[1], c[2])) continue; }
        const pos = u.map((q) => [cx + q[0] * rx, cy + q[1] * ry, cz + q[2] * rz]);
        const nor = u.map((q) => { const n = [q[0] / rx, q[1] / ry, q[2] / rz], l = Math.hypot(n[0], n[1], n[2]) || 1; return [n[0] / l, n[1] / l, n[2] / l]; });
        this._quadS(pos[0], pos[1], pos[2], pos[3], nor[0], nor[1], nor[2], nor[3], col, mat);
      }
    }
  }
  // parametric surface fn(u,v) -> [x,y,z], u,v in [0,1]; normals by finite differences
  param(fn, segU, segV, col, mat = 0) {
    const e = 1e-3, N = (u, v) => {
      const a = fn(Math.min(1, u + e), v), b = fn(Math.max(0, u - e), v), c = fn(u, Math.min(1, v + e)), d = fn(u, Math.max(0, v - e));
      const du = [a[0] - b[0], a[1] - b[1], a[2] - b[2]], dv = [c[0] - d[0], c[1] - d[1], c[2] - d[2]];
      const n = [du[1] * dv[2] - du[2] * dv[1], du[2] * dv[0] - du[0] * dv[2], du[0] * dv[1] - du[1] * dv[0]], l = Math.hypot(...n) || 1;
      return [n[0] / l, n[1] / l, n[2] / l];
    };
    const C0 = [0, 0, 0]; for (let i = 0; i < 6; i++) for (let j = 1; j < 6; j++) { const p = fn(i / 6, j / 6); C0[0] += p[0] / 30; C0[1] += p[1] / 30; C0[2] += p[2] / 30; }
    for (let i = 0; i < segU; i++) for (let j = 0; j < segV; j++) {
      const q = [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]].map(([a, b]) => [a / segU, b / segV]);
      const P = q.map(([u, v]) => fn(u, v));
      const n = q.map(([u, v], k) => {
        const uu = clamp(u, 0.002, 0.998), vv = clamp(v, 0.004, 0.996), nn = N(uu, vv), pk = P[k];
        // normals must point away from the middle of the shape, or the surface is drawn inside-out (and you see through its near side)
        return (pk[0] - C0[0]) * nn[0] + (pk[1] - C0[1]) * nn[1] + (pk[2] - C0[2]) * nn[2] < 0 ? [-nn[0], -nn[1], -nn[2]] : nn;
      });
      // keep normals pointing out from the centroid
      const c = fn(0.5, 0.5), m = [(P[0][0] + P[2][0]) / 2, (P[0][1] + P[2][1]) / 2, (P[0][2] + P[2][2]) / 2];
      void c; void m;
      this._quadS(P[0], P[1], P[2], P[3], n[0], n[1], n[2], n[3], col, mat);
    }
  }
  // surface of revolution around y; prof = [[r, y, sharp?], ...] from bottom to top along the outside
  lathe(cx, y0, cz, prof, col, mat = 0, seg = 16) {
    const n = prof.length, segN = [];
    for (let i = 0; i < n - 1; i++) {
      const dr = prof[i + 1][0] - prof[i][0], dy = prof[i + 1][1] - prof[i][1], l = Math.hypot(dr, dy) || 1;
      segN.push([dy / l, -dr / l]);
    }
    const ptN = prof.map((p, i) => {
      const a = segN[Math.max(0, i - 1)], b = segN[Math.min(segN.length - 1, i)];
      const x = a[0] + b[0], y = a[1] + b[1], l = Math.hypot(x, y) || 1; return [x / l, y / l];
    });
    for (let i = 0; i < n - 1; i++) {
      const r0 = prof[i][0], r1 = prof[i + 1][0];
      if (r0 < 1e-5 && r1 < 1e-5) continue;
      const n0 = prof[i][2] ? segN[i] : ptN[i], n1 = prof[i + 1][2] ? segN[i] : ptN[i + 1];
      for (let j = 0; j < seg; j++) {
        const a0 = TAU * j / seg, a1 = TAU * (j + 1) / seg;
        const P = (r, y, a) => [cx + r * Math.cos(a), y0 + y, cz + r * Math.sin(a)];
        const N = (nn, a) => [nn[0] * Math.cos(a), nn[1], nn[0] * Math.sin(a)];
        this._quadS(P(r0, prof[i][1], a0), P(r0, prof[i][1], a1), P(r1, prof[i + 1][1], a1), P(r1, prof[i + 1][1], a0),
          N(n0, a0), N(n0, a1), N(n1, a1), N(n1, a0), col, mat);
      }
    }
  }
  // tube through points with radii (number or array)
  tube(pts, rad, col, mat = 0, seg = 8, caps = true) {
    const n = pts.length, R = (i) => (typeof rad === 'number' ? rad : rad[i]);
    const T = pts.map((p, i) => { const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)]; const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], l = Math.hypot(...d) || 1; return [d[0] / l, d[1] / l, d[2] / l]; });
    const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const norm = (v) => { const l = Math.hypot(...v) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
    let N = norm(cross(T[0], Math.abs(T[0][1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]));
    const rings = [];
    for (let i = 0; i < n; i++) {
      if (i) { const b = cross(T[i - 1], T[i]); if (Math.hypot(...b) > 1e-6) { const B = norm(b), ang = Math.acos(clamp(T[i - 1][0] * T[i][0] + T[i - 1][1] * T[i][1] + T[i - 1][2] * T[i][2], -1, 1)); const c = Math.cos(ang), s = Math.sin(ang), kv = cross(B, N), d = B[0] * N[0] + B[1] * N[1] + B[2] * N[2]; N = norm([N[0] * c + kv[0] * s + B[0] * d * (1 - c), N[1] * c + kv[1] * s + B[1] * d * (1 - c), N[2] * c + kv[2] * s + B[2] * d * (1 - c)]); } }
      const Bn = cross(T[i], N), ring = [];
      for (let j = 0; j < seg; j++) { const a = TAU * j / seg, c = Math.cos(a), s = Math.sin(a); const nn = [N[0] * c + Bn[0] * s, N[1] * c + Bn[1] * s, N[2] * c + Bn[2] * s]; ring.push([[pts[i][0] + nn[0] * R(i), pts[i][1] + nn[1] * R(i), pts[i][2] + nn[2] * R(i)], nn]); }
      rings.push(ring);
    }
    for (let i = 0; i < n - 1; i++) for (let j = 0; j < seg; j++) {
      const a = rings[i][j], b = rings[i][(j + 1) % seg], c = rings[i + 1][(j + 1) % seg], d = rings[i + 1][j];
      this._quadS(a[0], b[0], c[0], d[0], a[1], b[1], c[1], d[1], col, mat);
    }
    if (caps) for (const [i, sg] of [[0, -1], [n - 1, 1]]) {
      if (R(i) < 1e-4) continue;
      const tn = [T[i][0] * sg, T[i][1] * sg, T[i][2] * sg], c = pts[i];
      for (let j = 0; j < seg; j++) { const a = rings[i][j][0], b = rings[i][(j + 1) % seg][0]; this._quadS(c, a, b, c, tn, tn, tn, tn, col, mat); }
    }
  }
  // torus lying in the xz plane
  torus(cx, cy, cz, R, r, col, mat = 0, seg = 14, seg2 = 6) {
    for (let i = 0; i < seg; i++) for (let j = 0; j < seg2; j++) {
      const P = (a, b) => { const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b); return [[cx + (R + r * cb) * ca, cy + r * sb, cz + (R + r * cb) * sa], [cb * ca, sb, cb * sa]]; };
      const a0 = TAU * i / seg, a1 = TAU * (i + 1) / seg, b0 = TAU * j / seg2, b1 = TAU * (j + 1) / seg2;
      const q = [P(a0, b0), P(a1, b0), P(a1, b1), P(a0, b1)];
      this._quadS(q[0][0], q[1][0], q[2][0], q[3][0], q[0][1], q[1][1], q[2][1], q[3][1], col, mat);
    }
  }
  // capsule from origin straight down to y=-len
  capsule(len, r0, r1, col, mat = 0, seg = 10) {
    const pr = [];
    for (let i = 0; i <= 3; i++) { const a = -Math.PI / 2 + (Math.PI / 2) * i / 3; pr.push([Math.cos(a) * r1, -len + Math.sin(a) * r1]); }
    for (let i = 0; i <= 3; i++) { const a = (Math.PI / 2) * i / 3; pr.push([Math.cos(a) * r0, Math.sin(a) * r0]); }
    pr[0][0] = 0; pr[pr.length - 1][0] = 0;
    this.lathe(0, 0, 0, pr, col, mat, seg);
  }
  array() { return this.packed ? new Uint8Array(this.ab, 0, this.count * 20) : this.f.slice(0, this.count * 10); }
}

// growable float buffer for per-frame geometry
class DynBuf {
  constructor(n = 1 << 18) { this.a = new Float32Array(n); this.n = 0; }
  reset() { this.n = 0; }
  ensure(k) { if (this.n + k > this.a.length) { let s = this.a.length * 2; while (s < this.n + k) s *= 2; const b = new Float32Array(s); b.set(this.a.subarray(0, this.n)); this.a = b; } }
  // copy a cached mesh through transform M (rotation may include uniform scale)
  emit(mesh, M, tint) {
    this.ensure(mesh.length); const a = this.a; let o = this.n;
    const m0 = M[0], m1 = M[1], m2 = M[2], m3 = M[3], m4 = M[4], m5 = M[5], m6 = M[6], m7 = M[7], m8 = M[8], m9 = M[9], m10 = M[10], m11 = M[11];
    for (let i = 0; i < mesh.length; i += 10) {
      const x = mesh[i], y = mesh[i + 1], z = mesh[i + 2], nx = mesh[i + 3], ny = mesh[i + 4], nz = mesh[i + 5];
      a[o] = m0 * x + m1 * y + m2 * z + m3; a[o + 1] = m4 * x + m5 * y + m6 * z + m7; a[o + 2] = m8 * x + m9 * y + m10 * z + m11;
      a[o + 3] = m0 * nx + m1 * ny + m2 * nz; a[o + 4] = m4 * nx + m5 * ny + m6 * nz; a[o + 5] = m8 * nx + m9 * ny + m10 * nz;
      if (tint) { a[o + 6] = mesh[i + 6] * tint[0]; a[o + 7] = mesh[i + 7] * tint[1]; a[o + 8] = mesh[i + 8] * tint[2]; }
      else { a[o + 6] = mesh[i + 6]; a[o + 7] = mesh[i + 7]; a[o + 8] = mesh[i + 8]; }
      a[o + 9] = mesh[i + 9]; o += 10;
    }
    this.n = o;
  }
  addGeo(g) { const d = g.data; this.ensure(d.length); this.a.set(d, this.n); this.n += d.length; }
  view() { return this.a.subarray(0, this.n); }
}
const MESH = new Map();
function mesh(key, fn) { let m = MESH.get(key); if (!m) { const g = new Geo(); fn(g); m = g.array(); MESH.set(key, m); } return m; }

// ---------- 4x4 matrices (column-major, for GL) ----------
function perspective(fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
  return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
}
function ortho(l, r, b, t, n, f) {
  return new Float32Array([2 / (r - l), 0, 0, 0, 0, 2 / (t - b), 0, 0, 0, 0, -2 / (f - n), 0, -(r + l) / (r - l), -(t + b) / (t - b), -(f + n) / (f - n), 1]);
}
function mul4(a, b) {
  const o = new Float32Array(16);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
    let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + j] * b[i * 4 + k];
    o[i * 4 + j] = s;
  }
  return o;
}
function lookAt(e, t, up) {
  let zx = e[0] - t[0], zy = e[1] - t[1], zz = e[2] - t[2]; let l = Math.hypot(zx, zy, zz); zx /= l; zy /= l; zz /= l;
  let xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx; l = Math.hypot(xx, xy, xz); xx /= l; xy /= l; xz /= l;
  const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
  return new Float32Array([xx, yx, zx, 0, xy, yy, zy, 0, xz, yz, zz, 0, -(xx * e[0] + xy * e[1] + xz * e[2]), -(yx * e[0] + yy * e[1] + yz * e[2]), -(zx * e[0] + zy * e[1] + zz * e[2]), 1]);
}
// first-person view: yaw 0 looks toward -z, positive yaw turns right
function viewFPS(ex, ey, ez, yaw, pitch, roll = 0) {
  const cp = Math.cos(pitch), sp = Math.sin(pitch), cy = Math.cos(yaw), sy = Math.sin(yaw);
  const f = [sy * cp, sp, -cy * cp];
  let r = [cy, 0, sy];
  let u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
  if (roll) { const c = Math.cos(roll), s = Math.sin(roll); const r2 = [r[0] * c + u[0] * s, r[1] * c + u[1] * s, r[2] * c + u[2] * s]; u = [u[0] * c - r[0] * s, u[1] * c - r[1] * s, u[2] * c - r[2] * s]; r = r2; }
  return new Float32Array([
    r[0], u[0], -f[0], 0, r[1], u[1], -f[1], 0, r[2], u[2], -f[2], 0,
    -(r[0] * ex + r[1] * ey + r[2] * ez), -(u[0] * ex + u[1] * ey + u[2] * ez), (f[0] * ex + f[1] * ey + f[2] * ez), 1,
  ]);
}

// ---------- renderer ----------
// The drawing layer lives in src/render3.js (Three.js). It defines window.Renderer.

// ---------- colliders ----------
// Every solid thing is an oriented box: {cx, cz, hx, hz, c, s, y0, y1, opaque, collide}
function makeOBB(cx, cz, hx, hz, yaw, y0, y1, opaque = true, collide = true) {
  return { cx, cz, hx, hz, c: Math.cos(yaw || 0), s: Math.sin(yaw || 0), y0, y1, opaque, collide, r: Math.hypot(hx, hz) };
}
function toLocal(o, x, z) { const dx = x - o.cx, dz = z - o.cz; return [dx * o.c - dz * o.s, dx * o.s + dz * o.c]; }
function toWorldVec(o, lx, lz) { return [lx * o.c + lz * o.s, -lx * o.s + lz * o.c]; }

class Buckets {
  constructor(x0, z0, w, h, size) { this.x0 = x0; this.z0 = z0; this.size = size; this.w = Math.ceil(w / size); this.h = Math.ceil(h / size); this.cells = []; for (let i = 0; i < this.w * this.h; i++) this.cells.push([]); this.stamp = 1; this.mark = null; }
  add(o, idx) {
    const r = o.r, s = this.size;
    const i0 = clamp(Math.floor((o.cx - r - this.x0) / s), 0, this.w - 1), i1 = clamp(Math.floor((o.cx + r - this.x0) / s), 0, this.w - 1);
    const j0 = clamp(Math.floor((o.cz - r - this.z0) / s), 0, this.h - 1), j1 = clamp(Math.floor((o.cz + r - this.z0) / s), 0, this.h - 1);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) this.cells[j * this.w + i].push(idx);
  }
  query(x0, z0, x1, z1, out) {
    const s = this.size; this.stamp++;
    const i0 = clamp(Math.floor((Math.min(x0, x1) - this.x0) / s), 0, this.w - 1), i1 = clamp(Math.floor((Math.max(x0, x1) - this.x0) / s), 0, this.w - 1);
    const j0 = clamp(Math.floor((Math.min(z0, z1) - this.z0) / s), 0, this.h - 1), j1 = clamp(Math.floor((Math.max(z0, z1) - this.z0) / s), 0, this.h - 1);
    out.length = 0;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      for (const k of this.cells[j * this.w + i]) { if (this.mark[k] !== this.stamp) { this.mark[k] = this.stamp; out.push(k); } }
    }
    return out;
  }
}

class World {
  constructor(obbs, width, depth) {
    this.obbs = obbs;
    this.b = new Buckets(-30, -40, width + 70, depth + 80, 3);
    this.b.mark = new Int32Array(obbs.length);
    obbs.forEach((o, i) => this.b.add(o, i));
    this.tmp = [];
  }
  collide(x, z, y, h, r, step) {
    for (let it = 0; it < 3; it++) {
      const list = this.b.query(x - r - 0.1, z - r - 0.1, x + r + 0.1, z + r + 0.1, this.tmp);
      let moved = false;
      for (const k of list) {
        const o = this.obbs[k];
        if (!o.collide || o.off) continue;
        if (o.y1 <= y + step || o.y0 >= y + h) continue;
        const [lx, lz] = toLocal(o, x, z);
        const qx = clamp(lx, -o.hx, o.hx), qz = clamp(lz, -o.hz, o.hz);
        const dx = lx - qx, dz = lz - qz; const d = Math.hypot(dx, dz);
        if (d >= r) continue;
        let px, pz;
        if (d < 1e-6) {
          const ex = o.hx - Math.abs(lx), ez = o.hz - Math.abs(lz);
          if (ex < ez) { px = Math.sign(lx || 1) * (ex + r); pz = 0; } else { px = 0; pz = Math.sign(lz || 1) * (ez + r); }
        } else { const k2 = (r - d) / d; px = dx * k2; pz = dz * k2; }
        const [wx, wz] = toWorldVec(o, px, pz);
        x += wx; z += wz; moved = true;
      }
      if (!moved) break;
    }
    return [x, z];
  }
  clear(ax, ay, az, bx, by, bz) {
    const list = this.b.query(ax, az, bx, bz, this.tmp);
    for (const k of list) {
      const o = this.obbs[k];
      if (!o.opaque || o.off) continue;
      const [alx, alz] = toLocal(o, ax, az), [blx, blz] = toLocal(o, bx, bz);
      let t0 = 0, t1 = 1;
      const a3 = [alx, ay, alz], d3 = [blx - alx, by - ay, blz - alz];
      const mn = [-o.hx, o.y0, -o.hz], mx = [o.hx, o.y1, o.hz];
      let hit = true;
      for (let a = 0; a < 3; a++) {
        if (Math.abs(d3[a]) < 1e-9) { if (a3[a] < mn[a] || a3[a] > mx[a]) { hit = false; break; } }
        else {
          let ta = (mn[a] - a3[a]) / d3[a], tb = (mx[a] - a3[a]) / d3[a];
          if (ta > tb) { const t = ta; ta = tb; tb = t; }
          t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
          if (t0 > t1) { hit = false; break; }
        }
      }
      if (hit) return false;
    }
    return true;
  }
  blocked(x, z, r, y0, y1) {
    const list = this.b.query(x - r, z - r, x + r, z + r, this.tmp);
    for (const k of list) {
      const o = this.obbs[k];
      if (!o.collide || o.off || o.y1 <= y0 || o.y0 >= y1) continue;
      const [lx, lz] = toLocal(o, x, z);
      const qx = clamp(lx, -o.hx, o.hx), qz = clamp(lz, -o.hz, o.hz);
      if (Math.hypot(lx - qx, lz - qz) < r) return true;
    }
    return false;
  }
}
