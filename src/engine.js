// ============================================================
// BOX — small WebGL engine (no libraries)
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
    for (let i = 0; i < segU; i++) for (let j = 0; j < segV; j++) {
      const q = [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]].map(([a, b]) => [a / segU, b / segV]);
      const P = q.map(([u, v]) => fn(u, v));
      const n = q.map(([u, v]) => { const uu = clamp(u, 0.002, 0.998), vv = clamp(v, 0.004, 0.996); return N(uu, vv); });
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
const KEY_DIR = (() => { const v = [0.28, 1.0, 0.36], l = Math.hypot(...v); return [v[0] / l, v[1] / l, v[2] / l]; })();
const VS = `
attribute vec3 aP; attribute vec3 aN; attribute vec3 aC; attribute float aM;
uniform mat4 uVP;
varying vec3 vP; varying vec3 vN; varying vec3 vC; varying float vM;
void main(){ vP=aP; vN=aN; vC=aC; vM=aM; gl_Position=uVP*vec4(aP,1.0); }`;
const FS = (NL, TAPS) => `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
#define NL ${NL}
varying vec3 vP; varying vec3 vN; varying vec3 vC; varying float vM;
uniform vec3 uEye; uniform float uL[16]; uniform vec4 uK; uniform float uAlarm; uniform float uTime;
uniform vec4 uLP[NL]; uniform vec4 uLC[NL];
uniform sampler2D uSh0; uniform sampler2D uSh1; uniform mat4 uSM0; uniform mat4 uSM1; uniform float uShOn; uniform float uShTex;
uniform float uMode; uniform float uFade; uniform vec2 uRes; uniform float uAmb; uniform float uExpo; uniform float uOutAmb;
const vec3 KEY = vec3(${KEY_DIR.map((v) => v.toFixed(5)).join(',')});
float h1(float n){ return fract(sin(n)*43758.5453); }
float h3(vec3 p){ return fract(sin(dot(p, vec3(127.1,311.7,74.7)))*43758.5453); }
float vn(vec3 p){ vec3 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(mix(h3(i),h3(i+vec3(1,0,0)),f.x),mix(h3(i+vec3(0,1,0)),h3(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(h3(i+vec3(0,0,1)),h3(i+vec3(1,0,1)),f.x),mix(h3(i+vec3(0,1,1)),h3(i+vec3(1,1,1)),f.x),f.y),f.z); }
float unpack(vec4 c){ return dot(c, vec4(1.0, 1.0/255.0, 1.0/65025.0, 1.0/16581375.0)); }
float pcf0(vec3 s){ float r=0.0; for(int i=-${TAPS};i<=${TAPS};i++) for(int j=-${TAPS};j<=${TAPS};j++){ r += (s.z-0.002 <= unpack(texture2D(uSh0, s.xy+vec2(float(i),float(j))*uShTex))) ? 1.0 : 0.0; } return r/float((2*${TAPS}+1)*(2*${TAPS}+1)); }
float pcf1(vec3 s){ float r=0.0; for(int i=-${TAPS};i<=${TAPS};i++) for(int j=-${TAPS};j<=${TAPS};j++){ r += (s.z-0.002 <= unpack(texture2D(uSh1, s.xy+vec2(float(i),float(j))*uShTex))) ? 1.0 : 0.0; } return r/float((2*${TAPS}+1)*(2*${TAPS}+1)); }
float shadowAt(vec3 p, vec3 n){
  if(uShOn < 0.5) return 1.0;
  vec3 q = p + n*0.05;
  if(q.y < 4.3){ vec4 l=uSM0*vec4(q,1.0); vec3 s=l.xyz*0.5+0.5; if(s.x<0.0||s.x>1.0||s.y<0.0||s.y>1.0) return 1.0; return pcf0(s); }
  vec4 l=uSM1*vec4(q,1.0); vec3 s=l.xyz*0.5+0.5; if(s.x<0.0||s.x>1.0||s.y<0.0||s.y>1.0) return 1.0; return pcf1(s);
}
float zl(vec3 p){
  float i = p.x<24.0 ? (p.z<14.0?0.0:1.0) : (p.x<40.0 ? (p.z<12.0?2.0:(p.z<28.0?3.0:4.0)) : (p.z<14.0?5.0:(p.z<28.0?6.0:7.0)));
  if(p.y>4.45) i+=8.0;
  float L=1.0;
  for(int k=0;k<16;k++){ if(float(k)==i) L=uL[k]; }
  float d=distance(p,uK.xyz); if(d<11.0) L*=mix(uK.w,1.0,d/11.0);
  return L;
}
void main(){
  vec3 c=vC; float m=floor(vM+0.5); vec3 p=vP; vec3 n=normalize(vN);
  if(!gl_FrontFacing) n=-n;
  if(uMode > 1.5){ gl_FragColor=vec4(c,1.0); return; }
  vec3 V = normalize(uEye-p);
  float outside = (p.z < -0.14 || p.x > 64.14 || p.x < -0.14 || p.z > 40.14 || p.y > 9.31) ? 1.0 : 0.0;
  float gloss=0.0;
  if(m==1.0){ float f=fract(p.z/0.19); if(abs(n.y)<0.5) f=fract(p.y/0.19); c*= (f<0.07?0.82:1.0)*(0.95+0.08*vn(p*vec3(0.5,8.0,8.0))); }
  else if(m==2.0){ vec2 g=fract(p.xz/0.61); vec2 cell=floor(p.xz/0.61); c*= (min(g.x,g.y)<0.025?0.78:0.95+0.06*h1(cell.x*13.0+cell.y*71.0)); gloss=0.45; }
  else if(m==3.0){
    if(n.y>0.5){ float b=floor(p.x/0.12); float off=h1(b)*3.0; float seg=floor((p.z+off)/1.9);
      c*= 0.84+0.24*h1(b*1.7+seg*13.1); c*= 0.92+0.12*vn(vec3(p.x*30.0, 0.0, p.z*2.0));
      if(fract(p.x/0.12)<0.05 || fract((p.z+off)/1.9)<0.008) c*=0.72; gloss=0.35;
    } else { c*= 0.92+0.1*h1(floor((p.x+p.z)*6.0)); }
  }
  else if(m==5.0){ c*=0.9+0.12*vn(p*2.0)+0.05*vn(p*13.0); vec2 g=fract(p.xz/3.0); if(min(g.x,g.y)<0.004) c*=0.8; }
  else if(m==6.0){ float s=fract((abs(n.x)>0.5?p.z:p.x)/0.21); c*= s<0.05?0.84:1.0; }
  else if(m==7.0){ float row=floor(p.y/0.085); float u=(abs(n.x)>0.5?p.z:p.x)/0.21+mod(row,2.0)*0.5;
    if(fract(p.y/0.085)<0.14||fract(u)<0.06) c=vec3(0.72,0.69,0.64); else c*=0.82+0.3*h1(floor(u)+row*7.0); }
  else if(m==8.0){ c*=0.86+0.2*vn(p*vec3(40.0,40.0,40.0)); }
  else if(m==9.0){ c*=0.9+0.12*vn(p*90.0); c+= pow(1.0-max(dot(n,V),0.0),3.0)*0.10; }
  else if(m==10.0){ gloss=0.75; }
  else if(m==11.0){ gloss=0.9; c*=0.85; }
  else if(m==12.0){ gloss=1.0; }
  else if(m==13.0){ gloss=0.18; }
  else if(m==14.0){ c*=0.8+0.35*vn(p*vec3(160.0,20.0,160.0)); gloss=0.3; }
  else if(m==15.0){ c*=0.6+0.6*vn(p*vec3(55.0,9.0,55.0)); }
  else if(m==16.0){ c*=0.93+0.08*vn(p*3.0); if(h3(floor(p*60.0))>0.996) c+=vec3(0.6); }
  else if(m==17.0){ float sn=smoothstep(0.42,0.62,vn(vec3(p.x*0.5,0.0,p.z*0.5))+0.2*vn(p*4.0)); c=mix(c*(0.85+0.2*vn(p*6.0)), vec3(0.82,0.86,0.92), sn); }
  else if(m==18.0){ gloss=0.4; c*=0.9+0.1*vn(p*40.0); }
  else if(m==19.0){ float g=sin(dot(p,vec3(8.0,1.5,6.5))*5.0 + vn(p*vec3(3.0,14.0,3.0))*7.0); c*=0.9+0.09*g; gloss=0.22; }
  vec3 col;
  float L=1.0;
  if(m==4.0){
    float lit = outside>0.5 ? 1.0 : mix(0.2, 1.0, zl(p));
    col = c*1.25*lit;
  } else {
    if(outside>0.5){
      vec3 amb = mix(vec3(0.05,0.06,0.09), vec3(0.17,0.21,0.32), n.y*0.5+0.5)*uOutAmb;
      col = c*amb;
    } else {
      L = zl(p)*uAmb;
      float sh = shadowAt(p, n);
      float kd = max(dot(n,KEY),0.0);
      vec3 amb = mix(vec3(0.22,0.20,0.19), vec3(0.50,0.48,0.44), n.y*0.5+0.5);
      if(m==13.0) kd = kd*0.8+0.2;
      vec3 lit = amb*0.85 + vec3(0.66,0.61,0.53)*kd*mix(0.3,1.0,sh);
      vec3 dark = vec3(0.05,0.06,0.09) + vec3(0.06,0.07,0.11)*(n.y*0.5+0.5);
      col = c*mix(dark, lit, L);
      if(gloss>0.0){ float sp=pow(max(dot(n,normalize(KEY+V)),0.0), 20.0+gloss*70.0); col += vec3(0.9,0.85,0.75)*sp*gloss*0.5*sh*L; }
    }
    for(int i=0;i<NL;i++){
      vec3 d=uLP[i].xyz-p; float dist=length(d); float att=clamp(1.0-dist/uLP[i].w,0.0,1.0); att*=att;
      if(att>0.0){ vec3 l=d/max(dist,0.001); float df=max(dot(n,l),0.0); if(m==13.0||m==15.0) df=df*0.75+0.25*max(dot(n,l)+0.5,0.0);
        col += c*uLC[i].rgb*(uLC[i].a*att*df);
        if(gloss>0.0){ float sp=pow(max(dot(n,normalize(l+V)),0.0), 24.0+gloss*80.0); col += uLC[i].rgb*(uLC[i].a*att*sp*gloss*0.8); } }
    }
    float rim = pow(1.0-max(dot(n,V),0.0),4.0);
    if(m==13.0) col += c*rim*0.12;
  }
  float pulse=uAlarm*(0.12+0.38*(0.5+0.5*sin(uTime*7.0)));
  if(outside<0.5) col=mix(col, col*vec3(1.7,0.35,0.3)+vec3(0.05,0.0,0.0), pulse);
  float d=length(p-uEye);
  if(outside>0.5){ float fog=clamp((d-6.0)/70.0,0.0,0.85); col=mix(col, vec3(0.07,0.09,0.14), fog); }
  else { float fog=clamp((d-16.0)/60.0,0.0,0.6); col=mix(col, vec3(0.04,0.04,0.05), fog); }
  col *= uExpo;
  col = (col*(2.51*col+0.03))/(col*(2.43*col+0.59)+0.14);
  vec2 uv=gl_FragCoord.xy/uRes-0.5;
  col *= 1.0-dot(uv,uv)*0.6;
  col *= 1.0-uFade;
  float a=1.0;
  if(m==12.0){ a=0.16+0.5*pow(1.0-max(dot(n,V),0.0),2.5); col+=vec3(0.06,0.08,0.1); }
  gl_FragColor=vec4(col, a);
}`;
const SVS = `attribute vec3 aP; attribute float aM; uniform mat4 uLVP; varying float vY; varying float vM;
void main(){ vY=aP.y; vM=aM; gl_Position=uLVP*vec4(aP,1.0); }`;
const SFS = `precision highp float; varying float vY; varying float vM; uniform vec2 uYR;
vec4 pk(float d){ vec4 e=fract(d*vec4(1.0,255.0,65025.0,16581375.0)); e-=e.yzww*vec4(1.0/255.0,1.0/255.0,1.0/255.0,0.0); return e; }
void main(){ float m=floor(vM+0.5); if(vY<uYR.x||vY>uYR.y||m==4.0||m==12.0) discard; gl_FragColor=pk(gl_FragCoord.z); }`;

class Renderer {
  constructor(canvas, opt = {}) {
    const gl = canvas.getContext('webgl', { antialias: true, alpha: false }) || canvas.getContext('experimental-webgl');
    if (!gl) throw new Error('WebGL is not available on this device/browser.');
    this.gl = gl; this.canvas = canvas; this.NL = opt.lights || 8;
    const prog = (vs, fs) => {
      const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
      const p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
      return p;
    };
    this.pr = prog(VS, FS(this.NL, opt.taps == null ? 1 : opt.taps));
    const U = (p, n) => gl.getUniformLocation(p, n);
    this.loc = {};
    for (const n of ['uVP', 'uEye', 'uK', 'uAlarm', 'uTime', 'uSh0', 'uSh1', 'uSM0', 'uSM1', 'uShOn', 'uShTex', 'uMode', 'uFade', 'uRes', 'uAmb', 'uExpo', 'uOutAmb']) this.loc[n] = U(this.pr, n);
    this.loc.uL = U(this.pr, 'uL[0]'); this.loc.uLP = U(this.pr, 'uLP[0]'); this.loc.uLC = U(this.pr, 'uLC[0]');
    this.attr = { aP: gl.getAttribLocation(this.pr, 'aP'), aN: gl.getAttribLocation(this.pr, 'aN'), aC: gl.getAttribLocation(this.pr, 'aC'), aM: gl.getAttribLocation(this.pr, 'aM') };
    this.spr = prog(SVS, SFS);
    this.sloc = { uLVP: U(this.spr, 'uLVP'), uYR: U(this.spr, 'uYR'), aP: gl.getAttribLocation(this.spr, 'aP'), aM: gl.getAttribLocation(this.spr, 'aM') };
    gl.enable(gl.DEPTH_TEST); gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK);
    this.dyn = gl.createBuffer();
    this.shadowRes = opt.shadowRes || 2048;
    this.sh = null; this.shOn = 0;
    this.lp = new Float32Array(this.NL * 4); this.lc = new Float32Array(this.NL * 4);
  }
  // static geometry is packed to 20 bytes/vertex: xyz float, normal int8x3, rgb uint8x3, material uint8
  upload(arr) {
    if (arr instanceof Uint8Array) { const gl = this.gl, b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, arr, gl.STATIC_DRAW); return { buf: b, count: arr.length / 20, packed: true }; }
    const gl = this.gl, b = gl.createBuffer(), n = arr.length / 10;
    const ab = new ArrayBuffer(n * 20), f = new Float32Array(ab), i8 = new Int8Array(ab), u8 = new Uint8Array(ab);
    for (let v = 0; v < n; v++) {
      const s = v * 10, o = v * 20;
      f[o / 4] = arr[s]; f[o / 4 + 1] = arr[s + 1]; f[o / 4 + 2] = arr[s + 2];
      let nx = arr[s + 3], ny = arr[s + 4], nz = arr[s + 5]; const l = Math.hypot(nx, ny, nz) || 1;
      i8[o + 12] = Math.round(nx / l * 127); i8[o + 13] = Math.round(ny / l * 127); i8[o + 14] = Math.round(nz / l * 127);
      u8[o + 16] = Math.round(clamp(arr[s + 6], 0, 1) * 255); u8[o + 17] = Math.round(clamp(arr[s + 7], 0, 1) * 255); u8[o + 18] = Math.round(clamp(arr[s + 8], 0, 1) * 255); u8[o + 19] = arr[s + 9];
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, ab, gl.STATIC_DRAW);
    return { buf: b, count: n, packed: true };
  }
  resize(scaleCap) {
    const dpr = Math.min(window.devicePixelRatio || 1, scaleCap || 1.5);
    const w = Math.floor(this.canvas.clientWidth * dpr), h = Math.floor(this.canvas.clientHeight * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
  }
  // bake both floor shadow maps from the static scene
  bakeShadows(obj, bounds) {
    const gl = this.gl, S = this.shadowRes;
    const c = [(bounds[0] + bounds[1]) / 2, (bounds[2] + bounds[3]) / 2, (bounds[4] + bounds[5]) / 2];
    const eye = [c[0] + KEY_DIR[0] * 40, c[1] + KEY_DIR[1] * 40, c[2] + KEY_DIR[2] * 40];
    const V = lookAt(eye, c, [0, 0, -1]);
    let mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
    for (const x of [bounds[0], bounds[1]]) for (const y of [bounds[2], bounds[3]]) for (const z of [bounds[4], bounds[5]]) {
      const v = [V[0] * x + V[4] * y + V[8] * z + V[12], V[1] * x + V[5] * y + V[9] * z + V[13], V[2] * x + V[6] * y + V[10] * z + V[14]];
      for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], v[k]); mx[k] = Math.max(mx[k], v[k]); }
    }
    const P = ortho(mn[0], mx[0], mn[1], mx[1], -mx[2] - 1, -mn[2] + 1);
    this.LVP = mul4(P, V);
    this.sh = [];
    for (const yr of [[0.005, 4.0], [4.52, 8.9]]) {
      const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, S, S, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      const rb = gl.createRenderbuffer(); gl.bindRenderbuffer(gl.RENDERBUFFER, rb); gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, S, S);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, rb);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) { gl.bindFramebuffer(gl.FRAMEBUFFER, null); this.sh = null; return false; }
      gl.viewport(0, 0, S, S); gl.clearColor(1, 1, 1, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.useProgram(this.spr); gl.disable(gl.CULL_FACE);
      gl.uniformMatrix4fv(this.sloc.uLVP, false, this.LVP); gl.uniform2f(this.sloc.uYR, yr[0], yr[1]);
      gl.bindBuffer(gl.ARRAY_BUFFER, obj.buf);
      for (let i = 0; i < 8; i++) gl.disableVertexAttribArray(i);
      if (obj.packed) { gl.enableVertexAttribArray(this.sloc.aP); gl.vertexAttribPointer(this.sloc.aP, 3, gl.FLOAT, false, 20, 0); gl.enableVertexAttribArray(this.sloc.aM); gl.vertexAttribPointer(this.sloc.aM, 1, gl.UNSIGNED_BYTE, false, 20, 19); }
      else { gl.enableVertexAttribArray(this.sloc.aP); gl.vertexAttribPointer(this.sloc.aP, 3, gl.FLOAT, false, 40, 0); gl.enableVertexAttribArray(this.sloc.aM); gl.vertexAttribPointer(this.sloc.aM, 1, gl.FLOAT, false, 40, 36); }
      gl.drawArrays(gl.TRIANGLES, 0, obj.count);
      gl.enable(gl.CULL_FACE);
      this.sh.push(tex);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.shOn = 1;
    return true;
  }
  // o: {vp, eye, zones(16), k[4], alarm, time, lights[{x,y,z,r,c,i}], fade, amb, expo, outAmb}
  begin(o) {
    const gl = this.gl, L = this.loc;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0.03, 0.035, 0.06, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.pr);
    for (let i = 0; i < 8; i++) gl.disableVertexAttribArray(i);
    gl.uniformMatrix4fv(L.uVP, false, o.vp);
    gl.uniform3f(L.uEye, o.eye[0], o.eye[1], o.eye[2]);
    gl.uniform1fv(L.uL, o.zones);
    gl.uniform4f(L.uK, o.k[0], o.k[1], o.k[2], o.k[3]);
    gl.uniform1f(L.uAlarm, o.alarm || 0); gl.uniform1f(L.uTime, o.time || 0);
    gl.uniform1f(L.uFade, o.fade || 0); gl.uniform2f(L.uRes, this.canvas.width, this.canvas.height);
    gl.uniform1f(L.uAmb, o.amb == null ? 1 : o.amb); gl.uniform1f(L.uExpo, o.expo || 1.3); gl.uniform1f(L.uOutAmb, o.outAmb == null ? 1 : o.outAmb);
    this.lp.fill(0); this.lc.fill(0);
    const ls = o.lights || [];
    for (let i = 0; i < Math.min(this.NL, ls.length); i++) {
      const l = ls[i]; this.lp.set([l.x, l.y, l.z, l.r], i * 4); this.lc.set([l.c[0], l.c[1], l.c[2], l.i], i * 4);
    }
    for (let i = ls.length; i < this.NL; i++) this.lp[i * 4 + 3] = 0.001;
    gl.uniform4fv(L.uLP, this.lp); gl.uniform4fv(L.uLC, this.lc);
    gl.uniform1f(L.uShOn, this.sh && o.shadows !== false ? 1 : 0);
    if (this.sh) {
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.sh[0]); gl.uniform1i(L.uSh0, 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.sh[1]); gl.uniform1i(L.uSh1, 1);
      gl.uniformMatrix4fv(L.uSM0, false, this.LVP); gl.uniformMatrix4fv(L.uSM1, false, this.LVP);
      gl.uniform1f(L.uShTex, 1.0 / this.shadowRes);
    }
    gl.uniform1f(L.uMode, 0);
  }
  _bind(buf, packed) {
    const gl = this.gl, L = this.attr, st = 40;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    if (packed) {
      gl.enableVertexAttribArray(L.aP); gl.vertexAttribPointer(L.aP, 3, gl.FLOAT, false, 20, 0);
      gl.enableVertexAttribArray(L.aN); gl.vertexAttribPointer(L.aN, 3, gl.BYTE, true, 20, 12);
      gl.enableVertexAttribArray(L.aC); gl.vertexAttribPointer(L.aC, 3, gl.UNSIGNED_BYTE, true, 20, 16);
      gl.enableVertexAttribArray(L.aM); gl.vertexAttribPointer(L.aM, 1, gl.UNSIGNED_BYTE, false, 20, 19);
      return;
    }
    gl.enableVertexAttribArray(L.aP); gl.vertexAttribPointer(L.aP, 3, gl.FLOAT, false, st, 0);
    gl.enableVertexAttribArray(L.aN); gl.vertexAttribPointer(L.aN, 3, gl.FLOAT, false, st, 12);
    gl.enableVertexAttribArray(L.aC); gl.vertexAttribPointer(L.aC, 3, gl.FLOAT, false, st, 24);
    gl.enableVertexAttribArray(L.aM); gl.vertexAttribPointer(L.aM, 1, gl.FLOAT, false, st, 36);
  }
  draw(obj) { this._bind(obj.buf, obj.packed); this.gl.drawArrays(this.gl.TRIANGLES, 0, obj.count); }
  // mode: 'opaque' | 'alpha' (glass, sorted roughly by caller) | 'mul' (blob shadows)
  drawDynamic(arr, mode = 'opaque') {
    if (!arr || !arr.length) return;
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.dyn); gl.bufferData(gl.ARRAY_BUFFER, arr, gl.DYNAMIC_DRAW);
    this._bind(this.dyn);
    if (mode === 'alpha') { gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false); gl.disable(gl.CULL_FACE); }
    if (mode === 'mul') { gl.enable(gl.BLEND); gl.blendFunc(gl.DST_COLOR, gl.ZERO); gl.depthMask(false); gl.uniform1f(this.loc.uMode, 2); gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(-2, -2); }
    gl.drawArrays(gl.TRIANGLES, 0, arr.length / 10);
    if (mode !== 'opaque') { gl.disable(gl.BLEND); gl.depthMask(true); gl.enable(gl.CULL_FACE); gl.uniform1f(this.loc.uMode, 0); gl.disable(gl.POLYGON_OFFSET_FILL); }
  }
}

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
