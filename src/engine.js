// ============================================================
// BOX — tiny WebGL engine (no libraries)
// Geometry builder, renderer, colliders, line-of-sight
// ============================================================

// ---------- small helpers ----------
const TAU = Math.PI * 2;
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function lerp(a, b, t) { return a + (b - a) * t; }
function hex(h) {
  const n = parseInt(h.replace('#', ''), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
function shade(c, k) { return [clamp(c[0] * k, 0, 1), clamp(c[1] * k, 0, 1), clamp(c[2] * k, 0, 1)]; }
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Materials (patterns are drawn in the fragment shader from world position)
const MAT = { PLAIN: 0, PLANK: 1, TILE: 2, WOOD: 3, GLOW: 4, CONCRETE: 5, SHIPLAP: 6, BRICK: 7, CARPET: 8 };

// ---------- geometry builder ----------
// Rotation convention (used everywhere): a local point (lx, lz) around a center
// with angle `yaw` goes to world  x = cx + lx*cos + lz*sin,  z = cz - lx*sin + lz*cos
class Geo {
  constructor() { this.data = []; this.count = 0; }
  _v(x, y, z, nx, ny, nz, c, m) {
    this.data.push(x, y, z, nx, ny, nz, c[0], c[1], c[2], m);
    this.count++;
  }
  _quad(a, b, c, d, n, col, m) {
    this._v(...a, ...n, col, m); this._v(...b, ...n, col, m); this._v(...c, ...n, col, m);
    this._v(...a, ...n, col, m); this._v(...c, ...n, col, m); this._v(...d, ...n, col, m);
  }
  // box: center x, bottom y, center z, size (sx, sy, sz), yaw
  box(cx, y0, cz, sx, sy, sz, yaw, col, mat = 0, top = null) {
    const c = Math.cos(yaw || 0), s = Math.sin(yaw || 0);
    const hx = sx / 2, hz = sz / 2, y1 = y0 + sy;
    const P = (lx, y, lz) => [cx + lx * c + lz * s, y, cz - lx * s + lz * c];
    const N = (lx, ly, lz) => [lx * c + lz * s, ly, -lx * s + lz * c];
    const p000 = P(-hx, y0, -hz), p100 = P(hx, y0, -hz), p110 = P(hx, y1, -hz), p010 = P(-hx, y1, -hz);
    const p001 = P(-hx, y0, hz), p101 = P(hx, y0, hz), p111 = P(hx, y1, hz), p011 = P(-hx, y1, hz);
    const side = col, tc = top || col;
    this._quad(p001, p101, p111, p011, N(0, 0, 1), side, mat);   // +z
    this._quad(p100, p000, p010, p110, N(0, 0, -1), side, mat);  // -z
    this._quad(p101, p100, p110, p111, N(1, 0, 0), side, mat);   // +x
    this._quad(p000, p001, p011, p010, N(-1, 0, 0), side, mat);  // -x
    this._quad(p011, p111, p110, p010, [0, 1, 0], tc, mat);      // top
    this._quad(p000, p100, p101, p001, [0, -1, 0], shade(side, 0.8), mat); // bottom
  }
  // cylinder along an axis ('y' default). For 'y': (cx, y0, cz) is bottom center.
  // For 'x'/'z': (cx, y0, cz) is the center, h is length.
  cyl(cx, y0, cz, r, h, col, mat = 0, seg = 12, axis = 'y', rTop = null) {
    if (typeof axis === 'number') { rTop = axis; axis = 'y'; }
    const rt = rTop == null ? r : rTop;
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * TAU, a1 = ((i + 1) / seg) * TAU;
      const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
      const map = (u, v, w) => { // u,w radial; v along axis
        if (axis === 'y') return [cx + u, y0 + v, cz + w];
        if (axis === 'x') return [cx + v - h / 2, y0 + u, cz - w];
        return [cx + u, y0 - w, cz + v - h / 2];
      };
      const mapN = (u, v, w) => {
        if (axis === 'y') return [u, v, w];
        if (axis === 'x') return [v, u, -w];
        return [u, -w, v];
      };
      const b0 = map(c0 * r, 0, s0 * r), b1 = map(c1 * r, 0, s1 * r);
      const t0 = map(c0 * rt, h, s0 * rt), t1 = map(c1 * rt, h, s1 * rt);
      const cm = Math.cos((a0 + a1) / 2), sm = Math.sin((a0 + a1) / 2);
      const slope = (r - rt) / h;
      const nl = Math.hypot(1, slope);
      this._quad(b1, b0, t0, t1, mapN(cm / nl, slope / nl, sm / nl), col, mat);
      // caps
      const cb = map(0, 0, 0), ct = map(0, h, 0);
      this._v(...cb, ...mapN(0, -1, 0), shade(col, 0.8), mat); this._v(...b0, ...mapN(0, -1, 0), shade(col, 0.8), mat); this._v(...b1, ...mapN(0, -1, 0), shade(col, 0.8), mat);
      if (rt > 0.001) { this._v(...ct, ...mapN(0, 1, 0), col, mat); this._v(...t1, ...mapN(0, 1, 0), col, mat); this._v(...t0, ...mapN(0, 1, 0), col, mat); }
    }
  }
  sphere(cx, cy, cz, r, col, mat = 0, seg = 10) {
    const rings = Math.max(4, seg >> 1);
    for (let i = 0; i < rings; i++) {
      const p0 = (i / rings) * Math.PI - Math.PI / 2, p1 = ((i + 1) / rings) * Math.PI - Math.PI / 2;
      for (let j = 0; j < seg; j++) {
        const a0 = (j / seg) * TAU, a1 = ((j + 1) / seg) * TAU;
        const pt = (p, a) => [Math.cos(p) * Math.cos(a), Math.sin(p), Math.cos(p) * Math.sin(a)];
        const q = [pt(p0, a0), pt(p0, a1), pt(p1, a1), pt(p1, a0)];
        const ord = [0, 2, 1, 0, 3, 2];
        for (const k of ord) {
          const n = q[k];
          this._v(cx + n[0] * r, cy + n[1] * r, cz + n[2] * r, n[0], n[1], n[2], col, mat);
        }
      }
    }
  }
  array() { return new Float32Array(this.data); }
}

// ---------- matrices ----------
function perspective(fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
  return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
}
function mul4(a, b) {
  const o = new Float32Array(16);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
    let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + j] * b[i * 4 + k];
    o[i * 4 + j] = s;
  }
  return o;
}
// first-person view: yaw 0 looks toward -z, positive yaw turns right
function viewFPS(ex, ey, ez, yaw, pitch) {
  const cp = Math.cos(pitch), sp = Math.sin(pitch), cy = Math.cos(yaw), sy = Math.sin(yaw);
  const fx = sy * cp, fy = sp, fz = -cy * cp;      // forward
  const rx = cy, ry = 0, rz = sy;                   // right
  const ux = ry * fz - rz * fy, uy = rz * fx - rx * fz, uz = rx * fy - ry * fx; // up = right x fwd
  return new Float32Array([
    rx, ux, -fx, 0,
    ry, uy, -fy, 0,
    rz, uz, -fz, 0,
    -(rx * ex + ry * ey + rz * ez), -(ux * ex + uy * ey + uz * ez), (fx * ex + fy * ey + fz * ez), 1,
  ]);
}

// ---------- renderer ----------
const VS = `
attribute vec3 aP; attribute vec3 aN; attribute vec3 aC; attribute float aM;
uniform mat4 uVP;
varying vec3 vP; varying vec3 vN; varying vec3 vC; varying float vM;
void main(){ vP=aP; vN=aN; vC=aC; vM=aM; gl_Position=uVP*vec4(aP,1.0); }`;
const FS = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec3 vP; varying vec3 vN; varying vec3 vC; varying float vM;
uniform vec3 uEye; uniform float uAlert;
float h1(float n){ return fract(sin(n)*43758.5453); }
void main(){
  vec3 c=vC; float m=floor(vM+0.5); vec3 n=normalize(vN); vec3 p=vP;
  if(m==4.0){ gl_FragColor=vec4(c,1.0); return; }
  if(m==1.0){ float f=fract(p.z/0.19); if(abs(n.y)<0.5) f=fract(p.y/0.19); c*= (f<0.07?0.84:1.0); }
  else if(m==2.0){ vec2 g=fract(p.xz/0.61); c*= (min(g.x,g.y)<0.03?0.8:1.0); }
  else if(m==3.0){
    if(n.y>0.5){
      float b=floor(p.x/0.12); float off=h1(b)*3.0; float seg=floor((p.z+off)/1.9);
      c*= 0.84+0.24*h1(b*1.7+seg*13.1);
      if(fract(p.x/0.12)<0.06 || fract((p.z+off)/1.9)<0.01) c*=0.76;
    } else { c*= 0.92+0.1*h1(floor((p.x+p.z)*6.0)); }
  }
  else if(m==5.0){ vec2 g=fract(p.xz/3.0); c*=0.95+0.06*h1(floor(p.x*3.0)+floor(p.z*3.0)*57.0); if(min(g.x,g.y)<0.004) c*=0.78; }
  else if(m==6.0){ float s=fract((abs(n.x)>0.5?p.z:p.x)/0.21); c*= s<0.05?0.86:1.0; }
  else if(m==7.0){ float row=floor(p.y/0.085); float u=(abs(n.x)>0.5?p.z:p.x)/0.21+mod(row,2.0)*0.5;
    if(fract(p.y/0.085)<0.14||fract(u)<0.06) c=vec3(0.78,0.74,0.68); else c*=0.85+0.25*h1(floor(u)+row*7.0); }
  else if(m==8.0){ c*=0.9+0.12*h1(floor(p.x*20.0)+floor(p.z*20.0)*91.0); }
  float l1=max(dot(n,normalize(vec3(0.35,0.85,0.25))),0.0);
  float l2=max(dot(n,normalize(vec3(-0.55,0.35,-0.6))),0.0);
  float l3=max(dot(n,normalize(vec3(0.6,0.2,-0.5))),0.0);
  vec3 lit=c*(0.40+0.36*l1+0.16*l2+0.10*l3)*vec3(1.06,1.0,0.92);
  float d=length(p-uEye); float fog=clamp((d-22.0)/80.0,0.0,0.55);
  lit=mix(lit, vec3(0.13,0.11,0.10), fog);
  lit=mix(lit, vec3(0.6,0.05,0.05), uAlert*0.18);
  gl_FragColor=vec4(lit,1.0);
}`;

class Renderer {
  constructor(canvas) {
    const gl = canvas.getContext('webgl', { antialias: true, alpha: false }) || canvas.getContext('experimental-webgl');
    if (!gl) throw new Error('WebGL is not available on this device/browser.');
    this.gl = gl; this.canvas = canvas;
    const sh = (type, src) => {
      const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const pr = gl.createProgram();
    gl.attachShader(pr, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(pr);
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(pr));
    this.pr = pr;
    this.loc = {
      aP: gl.getAttribLocation(pr, 'aP'), aN: gl.getAttribLocation(pr, 'aN'),
      aC: gl.getAttribLocation(pr, 'aC'), aM: gl.getAttribLocation(pr, 'aM'),
      uVP: gl.getUniformLocation(pr, 'uVP'), uEye: gl.getUniformLocation(pr, 'uEye'), uAlert: gl.getUniformLocation(pr, 'uAlert'),
    };
    gl.enable(gl.DEPTH_TEST); gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK);
    this.dyn = gl.createBuffer();
  }
  upload(arr) {
    const gl = this.gl, b = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, arr, gl.STATIC_DRAW);
    return { buf: b, count: arr.length / 10 };
  }
  resize(scaleCap) {
    const dpr = Math.min(window.devicePixelRatio || 1, scaleCap || 1.5);
    const w = Math.floor(this.canvas.clientWidth * dpr), h = Math.floor(this.canvas.clientHeight * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
  }
  begin(vp, eye, alert) {
    const gl = this.gl;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0.1, 0.09, 0.08, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.pr);
    gl.uniformMatrix4fv(this.loc.uVP, false, vp);
    gl.uniform3f(this.loc.uEye, eye[0], eye[1], eye[2]);
    gl.uniform1f(this.loc.uAlert, alert || 0);
  }
  _bind(buf) {
    const gl = this.gl, L = this.loc, st = 40;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.enableVertexAttribArray(L.aP); gl.vertexAttribPointer(L.aP, 3, gl.FLOAT, false, st, 0);
    gl.enableVertexAttribArray(L.aN); gl.vertexAttribPointer(L.aN, 3, gl.FLOAT, false, st, 12);
    gl.enableVertexAttribArray(L.aC); gl.vertexAttribPointer(L.aC, 3, gl.FLOAT, false, st, 24);
    gl.enableVertexAttribArray(L.aM); gl.vertexAttribPointer(L.aM, 1, gl.FLOAT, false, st, 36);
  }
  draw(obj) { this._bind(obj.buf); this.gl.drawArrays(this.gl.TRIANGLES, 0, obj.count); }
  drawDynamic(arr) {
    if (!arr.length) return;
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.dyn); gl.bufferData(gl.ARRAY_BUFFER, arr, gl.DYNAMIC_DRAW);
    this._bind(this.dyn); gl.drawArrays(gl.TRIANGLES, 0, arr.length / 10);
  }
}

// ---------- colliders ----------
// Every solid thing is an oriented box: {cx, cz, hx, hz, c, s, y0, y1, opaque, collide}
function makeOBB(cx, cz, hx, hz, yaw, y0, y1, opaque = true, collide = true) {
  return { cx, cz, hx, hz, c: Math.cos(yaw || 0), s: Math.sin(yaw || 0), y0, y1, opaque, collide, r: Math.hypot(hx, hz) };
}
function toLocal(o, x, z) { const dx = x - o.cx, dz = z - o.cz; return [dx * o.c - dz * o.s, dx * o.s + dz * o.c]; }
function toWorldVec(o, lx, lz) { return [lx * o.c + lz * o.s, -lx * o.s + lz * o.c]; }

// Bucket grid so collision and sight checks only look at nearby boxes
class Buckets {
  constructor(w, h, size) { this.size = size; this.w = Math.ceil(w / size); this.h = Math.ceil(h / size); this.cells = []; for (let i = 0; i < this.w * this.h; i++) this.cells.push([]); this.stamp = 1; this.mark = null; }
  add(o, idx) {
    const r = o.r, s = this.size;
    const i0 = clamp(Math.floor((o.cx - r) / s), 0, this.w - 1), i1 = clamp(Math.floor((o.cx + r) / s), 0, this.w - 1);
    const j0 = clamp(Math.floor((o.cz - r) / s), 0, this.h - 1), j1 = clamp(Math.floor((o.cz + r) / s), 0, this.h - 1);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) this.cells[j * this.w + i].push(idx);
  }
  query(x0, z0, x1, z1, out) {
    const s = this.size; this.stamp++;
    const i0 = clamp(Math.floor(Math.min(x0, x1) / s), 0, this.w - 1), i1 = clamp(Math.floor(Math.max(x0, x1) / s), 0, this.w - 1);
    const j0 = clamp(Math.floor(Math.min(z0, z1) / s), 0, this.h - 1), j1 = clamp(Math.floor(Math.max(z0, z1) / s), 0, this.h - 1);
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
    this.b = new Buckets(width, depth, 3);
    this.b.mark = new Int32Array(obbs.length);
    obbs.forEach((o, i) => this.b.add(o, i));
    this.tmp = [];
  }
  // push a circle (radius r, body from y to y+h) out of solid boxes; returns new [x, z]
  collide(x, z, y, h, r, step) {
    for (let it = 0; it < 3; it++) {
      const list = this.b.query(x - r - 0.1, z - r - 0.1, x + r + 0.1, z + r + 0.1, this.tmp);
      let moved = false;
      for (const k of list) {
        const o = this.obbs[k];
        if (!o.collide) continue;
        if (o.y1 <= y + step || o.y0 >= y + h) continue;
        const [lx, lz] = toLocal(o, x, z);
        const qx = clamp(lx, -o.hx, o.hx), qz = clamp(lz, -o.hz, o.hz);
        let dx = lx - qx, dz = lz - qz; let d = Math.hypot(dx, dz);
        if (d >= r) continue;
        let px, pz;
        if (d < 1e-6) { // center inside the box: push out along the shallow side
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
  // is the straight line between two 3D points free of opaque boxes?
  clear(ax, ay, az, bx, by, bz) {
    const list = this.b.query(ax, az, bx, bz, this.tmp);
    for (const k of list) {
      const o = this.obbs[k];
      if (!o.opaque) continue;
      const [alx, alz] = toLocal(o, ax, az), [blx, blz] = toLocal(o, bx, bz);
      let t0 = 0, t1 = 1;
      const ax3 = [alx, ay, alz], d3 = [blx - alx, by - ay, blz - alz];
      const mn = [-o.hx, o.y0, -o.hz], mx = [o.hx, o.y1, o.hz];
      let hit = true;
      for (let a = 0; a < 3; a++) {
        if (Math.abs(d3[a]) < 1e-9) { if (ax3[a] < mn[a] || ax3[a] > mx[a]) { hit = false; break; } }
        else {
          let ta = (mn[a] - ax3[a]) / d3[a], tb = (mx[a] - ax3[a]) / d3[a];
          if (ta > tb) { const t = ta; ta = tb; tb = t; }
          t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
          if (t0 > t1) { hit = false; break; }
        }
      }
      if (hit) return false;
    }
    return true;
  }
  // does a circle at (x,z) touch anything solid in the y-range? (used for the walk grid)
  blocked(x, z, r, y0, y1) {
    const list = this.b.query(x - r, z - r, x + r, z + r, this.tmp);
    for (const k of list) {
      const o = this.obbs[k];
      if (!o.collide || o.y1 <= y0 || o.y0 >= y1) continue;
      const [lx, lz] = toLocal(o, x, z);
      const qx = clamp(lx, -o.hx, o.hx), qz = clamp(lz, -o.hz, o.hz);
      if (Math.hypot(lx - qx, lz - qz) < r) return true;
    }
    return false;
  }
}
