#!/usr/bin/env python3
"""Bake the cast's bodies from MakeHuman data (CC0) into assets/humans.bin.

For each character: shape the base mesh with MakeHuman's macro targets (gender, age, muscle, weight), fit a clothes
proxy and shoes, tint them to the character's colours (texture AO keeps the seams and folds), puff winter coats, drop the
head (the game draws its own expressive heads), collapse MakeHuman's 163-bone skin weights onto the game's 16 joints,
simplify, and pack positions / normals / colours / 3 bone weights / triangles plus the joint positions the game's rig is
fitted to.  A second, lighter mesh is packed for distance.

  python3 tools/humans.py /path/to/makehuman-data            (the makehuman-js/makehuman-data checkout)
"""
import json, os, struct, sys
import numpy as np
from PIL import Image
from scipy.spatial import cKDTree
import fast_simplification as fs

sys.path.insert(0, os.path.dirname(__file__))
from mh_lib import MH, Proxy, uv_islands

ROOT = sys.argv[1] if len(sys.argv) > 1 else '/home/claude/ext/mhdata'
OUT = os.path.join(os.path.dirname(__file__), '..', 'assets', 'humans.bin')

MAT = {'SKIN': 1, 'FABRIC': 2, 'LEATHER': 3}   # filled from engine.js below
eng = open(os.path.join(os.path.dirname(__file__), '..', 'src', 'engine.js')).read()
import re
for k in list(MAT):
    m = re.search(r'\b' + k + r'\s*:\s*(\d+)', eng); MAT[k] = int(m.group(1))

# gender 0 female .. 1 male; age 0.1875 = 11 years, 0.5 = 25, 1 = 90
CAST = {
    'dad':     dict(g=1, age=0.56, w=0.66, m=0.5, race=(0.0, 0.0, 1.0), h=1.82, suit='male_casualsuit05', shoes='shoes01', top='#2d3f5e', inner='#5c2f2a', bottom='#b9a684', shoe='#4a3325', puff=0.02),
    'mom':     dict(g=0, age=0.52, w=0.5, m=0.45, race=(0.0, 0.0, 1.0), h=1.68, suit='male_casualsuit01', shoes='shoes03', top='#b98a5a', bottom='#2e3a52', shoe='#2a2420', puff=0.008, boots=True),
    'you':     dict(g=1, age=0.2, w=0.5, m=0.5, race=(0.0, 0.1, 0.9), h=1.42, suit='male_casualsuit02', shoes='shoes05', top='#2f6fa8', bottom='#3a3f48', shoe='#e8e8e8', puff=0.022),
    'leo':     dict(g=1, age=0.13, w=0.55, m=0.5, race=(0.0, 0.0, 1.0), h=1.1, suit='male_casualsuit02', shoes='shoes03', top='#c9342c', bottom='#32456b', shoe='#3a2a1e', puff=0.022, boots=True, mittens='#d0342c'),
    'dana':    dict(g=0, age=0.46, w=0.48, m=0.5, race=(0.0, 0.0, 1.0), h=1.66, suit='female_casualsuit01', shoes='shoes03', top='#ece8de', bottom='#26272b', shoe='#1d1d1f'),
    'marcus':  dict(g=1, age=0.48, w=0.56, m=0.68, race=(0.85, 0.0, 0.15), h=1.88, suit='male_casualsuit01', shoes='shoes03', top='#5b6b7d', bottom='#2b2c30', shoe='#1d1d1f'),
    'priya':   dict(g=0, age=0.44, w=0.45, m=0.5, race=(0.25, 0.25, 0.5), h=1.62, suit='female_casualsuit01', shoes='shoes03', top='#8e4a52', bottom='#2b2c30', shoe='#1d1d1f'),
    'manager': dict(g=1, age=0.7, w=0.62, m=0.45, race=(0.0, 0.0, 1.0), h=1.78, suit='male_casualsuit01', shoes='shoes03', top='#3a4a3e', bottom='#3a3a3c', shoe='#1d1d1f', puff=0.004),
}
# skin tones come from the game's CHARS table so faces and hands match
act = open(os.path.join(os.path.dirname(__file__), '..', 'src', 'actors.js')).read()
for k in CAST:
    m = re.search(r"\b" + k + r":\s*\{[^\n]*?skin:\s*'(#[0-9a-f]{6})'", act); CAST[k]['skin'] = m.group(1)

BONES = ['pelvis', 'chest', 'neck', 'head', 'sh0', 'el0', 'wr0', 'sh1', 'el1', 'wr1', 'hp0', 'kn0', 'an0', 'hp1', 'kn1', 'an1']
BI = {b: i for i, b in enumerate(BONES)}

def collapse(name):
    base = name.replace('____head', '')
    side = '0' if base.endswith('.L') else '1' if base.endswith('.R') else ''
    b = base.split('.')[0]
    if b in ('root', 'spine05', 'spine04') or b.startswith('pelvis'): return 'pelvis'
    if b in ('spine03', 'spine02', 'spine01') or b.startswith(('breast', 'clavicle', 'shoulder')): return 'chest'
    if b.startswith('neck'): return 'neck'
    if b.startswith('upperarm'): return 'sh' + side
    if b.startswith('lowerarm'): return 'el' + side
    if b.startswith(('wrist', 'finger', 'metacarpal')): return 'wr' + side
    if b.startswith('upperleg'): return 'hp' + side
    if b.startswith('lowerleg'): return 'kn' + side
    if b.startswith(('foot', 'toe')): return 'an' + side
    return 'head'   # head and every face bone

def hexc(h): return np.array([int(h[i:i + 2], 16) for i in (1, 3, 5)], dtype=np.float64) / 255.0

def vnormals(V, T):
    n = np.cross(V[T[:, 1]] - V[T[:, 0]], V[T[:, 2]] - V[T[:, 0]])
    N = np.zeros_like(V)
    for k in range(3): np.add.at(N, T[:, k], n)
    return N / (np.linalg.norm(N, axis=1, keepdims=True) + 1e-12)

def sample(img, uv):
    a = np.asarray(img, dtype=np.float64) / 255.0; h, w = a.shape[:2]
    x = np.clip((uv[:, 0] % 1.0) * (w - 1), 0, w - 1).astype(int); y = np.clip((1 - uv[:, 1] % 1.0) * (h - 1), 0, h - 1).astype(int)
    return a[y, x]

mh = MH(ROOT)
W16 = np.zeros((mh.nv, 16))
for k in range(4):
    for bi, bn in enumerate(mh.bone_names):
        sel = mh.skin_i[:, k] == bi
        if sel.any(): W16[sel, BI[collapse(bn)]] += mh.skin_w[sel, k]
W16 /= W16.sum(1, keepdims=True) + 1e-12
body_tris = mh.faces[mh.fmat == 0]
PROX = {}
def proxy(name):
    if name not in PROX:
        p = Proxy(ROOT, name); p.isl = uv_islands(p)
        from scipy.sparse import coo_matrix
        from scipy.sparse.csgraph import connected_components
        T = p.tris; nv = len(p.V0); e = np.concatenate([T[:, [0, 1]], T[:, [1, 2]], T[:, [2, 0]]])
        _, p.comp = connected_components(coo_matrix((np.ones(len(e)), (e[:, 0], e[:, 1])), shape=(nv, nv)), directed=False)
        p.uvv = np.zeros((nv, 2)); p.uvv[p.tris.ravel()] = p.uv[p.uvt.ravel()]
        p.dimg = Image.open(os.path.join(p.dir, p.diffuse)).convert('RGB') if p.diffuse else None
        p.aimg = Image.open(os.path.join(p.dir, p.ao)).convert('L') if p.ao else None
        PROX[name] = p
    return PROX[name]

def simplify(V, T, keep):
    if len(T) <= keep: return V, T
    V2, T2 = fs.simplify(V.astype(np.float32), T.astype(np.int32), target_reduction=1 - keep / len(T), agg=6)
    return V2.astype(np.float64), T2.astype(np.int64)

def build(cid, c):
    V = mh.morph(gender=c['g'], age=c['age'], muscle=c['m'], weight=c['w'], race=c['race'])
    J = lambda n: mh.joint(V, n)
    top_y = V[body_tris.ravel(), 1].max()
    suit, shoes = proxy(c['suit']), proxy(c['shoes'])
    base_h = mh.V[body_tris.ravel(), 1].max() - mh.V[body_tris.ravel(), 1].min()
    osc = (top_y - V[body_tris.ravel(), 1].min()) / base_h
    s_est = c['h'] / (top_y - V[body_tris.ravel(), 1].min())   # mesh units -> metres, near enough for padding sizes
    parts = []   # (V, T, W16, colour per vertex, material per vertex)
    # --- clothes
    skin_col = hexc(c['skin'])
    for p, kind in ((suit, 'suit'), (shoes, 'shoes')):
        P = p.fit(V, osc)
        Wp = (W16[p.ref] * np.clip(p.w, 0, None)[:, :, None]).sum(1); Wp /= Wp.sum(1, keepdims=True) + 1e-12
        ao = sample(p.aimg, p.uvv) if p.aimg is not None else None
        dif = sample(p.dimg, p.uvv) if p.dimg is not None else None
        lum = dif @ np.array([0.3, 0.55, 0.15]) if dif is not None else np.ones(len(P))
        if kind == 'suit':
            # label each vertex: trousers (texture islands below the waist), the inner shirt under an open jacket, or the top
            isl_y = {i: p.V0[p.tris[p.isl == i]].reshape(-1, 3)[:, 1].mean() for i in np.unique(p.isl)}
            vy = np.zeros(len(P)); vy[p.tris[:, 0]] = [isl_y[i] for i in p.isl]; vy[p.tris[:, 1]] = [isl_y[i] for i in p.isl]; vy[p.tris[:, 2]] = [isl_y[i] for i in p.isl]
            bottom = vy < 0.5
            sizes = np.bincount(p.comp)
            inner = np.zeros(len(P), bool)
            if c['suit'] == 'male_casualsuit05': inner = p.comp == np.argsort(-sizes)[2]
            col = np.where(bottom[:, None], hexc(c['bottom']), np.where(inner[:, None], hexc(c.get('inner', c['top'])), hexc(c['top'])))
            mat = np.full(len(P), MAT['FABRIC'])
            sh = 0.62 + 0.38 * (ao if ao is not None else 1.0)
            if c['suit'] == 'male_casualsuit05':   # keep the jacket's own pockets, seams and zip (its texture is plain, no logo)
                det = np.clip(lum / np.median(lum[~bottom]), 0.8, 1.15); sh = sh * np.where(bottom, 1.0, det)
            col = col * sh[:, None]
            if c.get('boots'):
                ank = (J('foot.L____head')[1] + J('foot.R____head')[1]) / 2; knee = (J('lowerleg01.L____head')[1] + J('lowerleg01.R____head')[1]) / 2
                boot = bottom & (P[:, 1] < ank + 0.42 * (knee - ank))
                col[boot] = hexc(c['shoe']) * sh[boot, None]; mat[boot] = MAT['LEATHER']
                P[boot] += vnormals(P, p.tris)[boot] * (0.008 / s_est)   # a boot shaft over the trouser leg
            puff = c.get('puff', 0) / s_est; per = 0.11 / s_est   # padding and baffle spacing, metres -> mesh units
            if puff:
                N = vnormals(P, p.tris); up = ~bottom
                quilt = 0.7 + 0.6 * np.abs(np.sin(P[:, 1] / per * np.pi)) if c['puff'] > 0.012 else 1.0
                P[up] += N[up] * (puff * quilt if np.ndim(quilt) == 0 else puff * quilt[up, None])
                if c['puff'] > 0.012: col[up] *= (0.86 + 0.18 * np.abs(np.sin(P[up, 1] / per * np.pi)))[:, None]   # the baffles catch the light, the stitch lines go dark
        else:
            sock = p.comp != np.argsort(-np.bincount(p.comp))[0]
            sock &= p.comp != np.argsort(-np.bincount(p.comp))[1]
            d2 = np.clip(lum / np.median(lum), 0.7, 1.2) if dif is not None else 1.0
            col = np.where(sock[:, None], np.array([0.16, 0.16, 0.18]), hexc(c['shoe']) * (d2[:, None] if np.ndim(d2) else 1.0))
            mat = np.where(sock, MAT['FABRIC'], MAT['LEATHER'])
        parts.append([P, p.tris.astype(np.int64), Wp, col, mat])
    # --- skin: what the clothes leave showing, minus the head
    dele = suit.delete | shoes.delete
    headw = W16[:, BI['head']]
    keepv = ~dele & (headw < 0.85)   # keep the neck right up under the jaw; the game's head sits over it
    bt = body_tris[keepv[body_tris].all(1)]
    used = np.unique(bt); remap = -np.ones(mh.nv, dtype=np.int64); remap[used] = np.arange(len(used))
    Vb = V[used]; Tb = remap[bt]; Wb = W16[used]
    colb = np.tile(skin_col, (len(used), 1)); matb = np.full(len(used), MAT['SKIN'])
    if c.get('mittens'):
        mt = (Wb[:, BI['wr0']] + Wb[:, BI['wr1']]) > 0.5; colb[mt] = hexc(c['mittens']); matb[mt] = MAT['FABRIC']
        Vb[mt] += vnormals(Vb, Tb)[mt] * (0.006 / s_est)
    parts.insert(0, [Vb, Tb, Wb, colb, matb])
    # --- into game space: metres, facing -z, feet on the floor, scaled to the character's height (its own head included)
    ground = min(p[0][:, 1].min() for p in parts)
    s = c['h'] / ((top_y - ground) * 0.1) * 0.1
    def tr(P): Q = (P - [0, ground, 0]) * s; Q[:, 0] *= -1; Q[:, 2] *= -1; return Q
    for p in parts: p[0] = tr(p[0])
    jn = {
        'hp0': 'upperleg01.L____head', 'hp1': 'upperleg01.R____head', 'kn0': 'lowerleg01.L____head', 'kn1': 'lowerleg01.R____head',
        'an0': 'foot.L____head', 'an1': 'foot.R____head', 'toe0': 'toe3-1.L____head', 'toe1': 'toe3-1.R____head',
        'chest': 'spine03____head', 'neck': 'neck01____head', 'head': 'head____head',
        'sh0': 'upperarm01.L____head', 'sh1': 'upperarm01.R____head', 'el0': 'lowerarm01.L____head', 'el1': 'lowerarm01.R____head',
        'wr0': 'wrist.L____head', 'wr1': 'wrist.R____head', 'tip0': 'finger3-3.L____tail', 'tip1': 'finger3-3.R____tail',
    }
    joints = {k: tr(J(v)[None])[0] for k, v in jn.items()}
    joints['pelvis'] = (joints['hp0'] + joints['hp1']) / 2
    joints['top'] = tr(np.array([[0, top_y, 0]]))[0]
    hv = np.unique(body_tris.ravel()); hv = hv[W16[hv, BI['head']] > 0.8]; hc = V[hv].mean(0)
    joints['headc'] = tr(hc[None])[0]
    joints['chin'] = tr(np.array([[0, V[hv[V[hv, 2] > hc[2] + 0.3], 1].min(), hc[2]]]))[0]
    # --- simplify each part, carry attributes over from the nearest original vertex
    def pack(budget):
        Vs, Ts, Ws, Cs, Ms, off = [], [], [], [], [], 0
        total = sum(len(p[1]) for p in parts)
        for (P, T, Wp, col, mat) in parts:
            keep = max(60, int(budget * len(T) / total))
            # weld duplicate positions (uv seams) first so the simplifier sees one surface
            q = np.round(P / 1e-5).astype(np.int64); _, first, inv = np.unique(q, axis=0, return_index=True, return_inverse=True)
            inv = inv.ravel(); T2 = inv[T]; T2 = T2[(T2[:, 0] != T2[:, 1]) & (T2[:, 1] != T2[:, 2]) & (T2[:, 0] != T2[:, 2])]
            Vw = P[first]
            V2, T3 = simplify(Vw, T2, keep)
            _, nn = cKDTree(P).query(V2)
            Vs.append(V2); Ts.append(T3 + off); Ws.append(Wp[nn]); Cs.append(col[nn]); Ms.append(mat[nn]); off += len(V2)
        V = np.concatenate(Vs); T = np.concatenate(Ts); Wv = np.concatenate(Ws); C = np.concatenate(Cs); M = np.concatenate(Ms)
        # face the right way: the triangle normal should agree with "away from the bone it hangs on"
        N = vnormals(V, T)
        return V, T, Wv, C, M, N
    meshes = [pack(9000), pack(2600)]
    # --- a torso profile (front / back / half width at heights above the floor) for aprons, ties and lanyards
    Vall = np.concatenate([p[0] for p in parts]); Wall = np.concatenate([p[2] for p in parts])
    trunk = (Wall[:, [BI['pelvis'], BI['chest'], BI['neck']]].sum(1) > 0.6)
    ys = np.arange(joints['pelvis'][1] - 0.4, joints['neck'][1] + 0.08, 0.02)
    prof = []
    for y in ys:
        b = trunk & (np.abs(Vall[:, 1] - y) < 0.015)
        mid = b & (np.abs(Vall[:, 0]) < 0.035)
        prof.append([float(Vall[mid, 2].min()) if mid.any() else 0.0, float(Vall[mid, 2].max()) if mid.any() else 0.0, float(np.abs(Vall[b, 0]).max()) if b.any() else 0.0])
    return meshes, joints, dict(y0=float(ys[0]), dy=0.02, p=prof)

def q16(a, lim): return np.clip(np.round(a / lim * 32767), -32767, 32767).astype('<i2')

meta, blob = {}, bytearray()
def put(arr):
    global blob
    while len(blob) % 4: blob.append(0)
    o = len(blob); blob += arr.tobytes(); return o
for cid, c in CAST.items():
    meshes, joints, prof = build(cid, c)
    ms = []
    for (V, T, Wv, C, M, N) in meshes:
        top = np.argsort(-Wv, axis=1)[:, :3]; tw = np.take_along_axis(Wv, top, 1); tw /= tw.sum(1, keepdims=True)
        wq = np.round(tw * 255).astype(np.int32); wq[:, 0] += 255 - wq.sum(1)
        ms.append(dict(nv=len(V), nt=len(T),
            pos=put(q16(V, 4.0)), nrm=put(np.clip(np.round(N * 127), -127, 127).astype('i1')),
            col=put(np.concatenate([np.clip(np.round(C * 255), 0, 255), M[:, None]], 1).astype('u1')),
            bi=put(top.astype('u1')), bw=put(wq.astype('u1')),
            idx=put(T.astype('<u2' if len(V) < 65536 else '<u4'))))
    meta[cid] = dict(m=ms, j={k: [round(float(x), 4) for x in v] for k, v in joints.items()}, prof=prof)
    print(cid, [(m['nv'], m['nt']) for m in ms], 'h', round(joints['top'][1], 3), 'pelvis', [round(x, 3) for x in joints['pelvis']])
head = json.dumps(dict(bones=BONES, posScale=4.0, cast=meta), separators=(',', ':')).encode()
head += b' ' * ((4 - len(head) % 4) % 4)
with open(OUT, 'wb') as f:
    f.write(struct.pack('<I', len(head))); f.write(head); f.write(bytes(blob))
print('wrote', OUT, os.path.getsize(OUT) // 1024, 'KB')
