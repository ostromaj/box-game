"""Readers for the MakeHuman data (makehuman-js/makehuman-data, CC0 since MakeHuman's 2020 relicensing).

Only parses JSON and a raw int16 matrix; nothing from the data folder is executed.
"""
import json, os
import numpy as np

class MH:
    def __init__(self, root):
        self.root = root
        b = json.load(open(os.path.join(root, 'public/data/models/human_full_size.json')))
        self.V = np.array(b['vertices'], dtype=np.float64).reshape(-1, 3)
        self.nv = len(self.V)
        self.mats = [m['DbgName'] for m in b['materials']]
        self.faces, self.fmat = decode_faces(b['faces'], len(b['uvs']) if b.get('uvs') else 0)
        self.bone_names = [x['name'] for x in b['bones']]
        si = np.array(b['skinIndices'], dtype=np.int32).reshape(-1, 4)
        sw = np.array(b['skinWeights'], dtype=np.float64).reshape(-1, 4)
        self.skin_i, self.skin_w = si, sw
        rig = json.load(open(os.path.join(root, 'src/json/rigs/default.json')))
        self.joints = rig['joints']           # name -> list of vertex indices; the joint sits at their mean
        tl = json.load(open(os.path.join(root, 'src/json/targets/target-list.json')))['targets']
        self.target_names = sorted(tl.keys())
        self.T = np.memmap(os.path.join(root, 'public/data/targets/targets.bin'), dtype=np.int16, mode='r',
                           shape=(len(self.target_names), self.nv * 3))
        self.tindex = {n: i for i, n in enumerate(self.target_names)}

    def target(self, name):
        return np.asarray(self.T[self.tindex['data/targets/' + name + '.target']], dtype=np.float64).reshape(-1, 3) * 1e-3

    def morph(self, gender=0.5, age=0.5, muscle=0.5, weight=0.5, race=(1/3, 1/3, 1/3), extra=()):
        """MakeHuman's macro modifiers: each target is weighted by the product of its gender/age/muscle/weight factors."""
        G = {'female': 1 - gender, 'male': gender}
        if age < 0.5:
            young = max(0.0, (age - 0.1875) * 3.2); baby = max(0.0, 1 - age * 5.333)
            A = {'baby': baby, 'child': max(0.0, min(1.0, 5.333 * age) - young), 'young': young, 'old': 0.0}
        else:
            old = max(0.0, age * 2 - 1); A = {'baby': 0.0, 'child': 0.0, 'young': 1 - old, 'old': old}
        def tri(v, lo, mid, hi):
            a = max(0.0, 1 - v * 2); c = max(0.0, v * 2 - 1); return {lo: a, mid: 1 - a - c, hi: c}
        M = tri(muscle, 'minmuscle', 'averagemuscle', 'maxmuscle')
        W = tri(weight, 'minweight', 'averageweight', 'maxweight')
        R = dict(zip(['african', 'asian', 'caucasian'], race))
        V = self.V.copy()
        for r, rw in R.items():
            for g, gw in G.items():
                for a, aw in A.items():
                    w = rw * gw * aw
                    if w > 1e-4: V += w * self.target(f'macrodetails/{r}-{g}-{a}')
        for g, gw in G.items():
            for a, aw in A.items():
                for m, mw in M.items():
                    for wn, ww in W.items():
                        w = gw * aw * mw * ww
                        if w > 1e-4: V += w * self.target(f'macrodetails/universal-{g}-{a}-{m}-{wn}')
        for name, w in extra:
            V += w * self.target(name)
        return V

    def joint(self, V, name):
        return V[self.joints[name]].mean(0)


def decode_faces(F, n_uv_layers):
    """three.js JSON format 3 face list -> (triangles, material index per triangle)."""
    tris, mats = [], []
    i, n = 0, len(F)
    while i < n:
        t = F[i]; i += 1
        quad = t & 1; has_mat = t & 2; face_uv = t & 4; fv_uv = t & 8; face_n = t & 16; fv_n = t & 32; face_c = t & 64; fv_c = t & 128
        nvx = 4 if quad else 3
        vs = F[i:i + nvx]; i += nvx
        m = 0
        if has_mat: m = F[i]; i += 1
        if face_uv: i += n_uv_layers
        if fv_uv: i += nvx * n_uv_layers
        if face_n: i += 1
        if fv_n: i += nvx
        if face_c: i += 1
        if fv_c: i += nvx
        if quad: tris += [(vs[0], vs[1], vs[2]), (vs[0], vs[2], vs[3])]; mats += [m, m]
        else: tris.append(tuple(vs)); mats.append(m)
    return np.array(tris, dtype=np.int32), np.array(mats, dtype=np.int32)


def decode_faces_uv(F, n_uv_layers):
    """Like decode_faces, also returning the per-corner uv indices (first layer) for each triangle."""
    tris, uvt = [], []
    i, n = 0, len(F)
    while i < n:
        t = F[i]; i += 1
        quad = t & 1; nvx = 4 if quad else 3
        vs = F[i:i + nvx]; i += nvx
        if t & 2: i += 1
        if t & 4: i += n_uv_layers
        us = None
        if t & 8: us = F[i:i + nvx]; i += nvx * n_uv_layers
        if t & 16: i += 1
        if t & 32: i += nvx
        if t & 64: i += 1
        if t & 128: i += nvx
        us = us or [0] * nvx
        if quad: tris += [(vs[0], vs[1], vs[2]), (vs[0], vs[2], vs[3])]; uvt += [(us[0], us[1], us[2]), (us[0], us[2], us[3])]
        else: tris.append(tuple(vs)); uvt.append(tuple(us))
    return np.array(tris, dtype=np.int32), np.array(uvt, dtype=np.int32)


class Proxy:
    """A clothes proxy: every vertex rides on a triangle of the body (three refs, barycentric weights, an offset)."""
    def __init__(self, root, name):
        d = json.load(open(os.path.join(root, f'public/data/proxies/clothes/{name}/{name}.json')))
        self.name = name
        self.ref = np.array(d['ref_vIdxs'], dtype=np.int64)
        self.w = np.array(d['weights'], dtype=np.float64)
        self.off = np.array(d['offsets'], dtype=np.float64)
        self.V0 = np.array(d['vertices'], dtype=np.float64).reshape(-1, 3)
        uvl = d['uvs'][0] if d.get('uvs') else []
        self.uv = np.array(uvl, dtype=np.float64).reshape(-1, 2)
        self.tris, self.uvt = decode_faces_uv(d['faces'], 1 if uvl else 0)
        self.delete = np.array(d['metadata'].get('deleteVerts') or [], dtype=bool)
        mat = d['materials'][0]
        self.diffuse = mat.get('mapDiffuse'); self.ao = mat.get('mapAO') or mat.get('mapLight')
        self.dir = os.path.join(root, f'public/data/proxies/clothes/{name}')
        self.license = d['metadata'].get('license')

    def fit(self, V, off_scale=1.0):
        return (V[self.ref] * self.w[:, :, None]).sum(1) + self.off * off_scale


def uv_islands(p):
    """Label each triangle by its connected island in uv space (garment panels)."""
    from scipy.sparse import coo_matrix
    from scipy.sparse.csgraph import connected_components
    U = p.uvt; n = len(p.uv)
    e = np.concatenate([U[:, [0, 1]], U[:, [1, 2]], U[:, [2, 0]]])
    A = coo_matrix((np.ones(len(e)), (e[:, 0], e[:, 1])), shape=(n, n))
    k, lab = connected_components(A, directed=False)
    return lab[U[:, 0]]
