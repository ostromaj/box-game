// ============================================================
// BOX — Three.js drawing layer.
// Same small interface the old WebGL renderer had (upload / bakeShadows / begin / draw / drawDynamic)
// plus end(), so game logic, level builders and actors are untouched.
// Everything is one patched MeshStandardMaterial: vertex colour + a material id per vertex pick
// PBR values, photo textures (wood, tile, brick) or procedural detail with bump.
// Bundled by tools/build.py (esbuild) into one IIFE that defines window.Renderer.
// ============================================================
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { BokehPass } from 'three/examples/jsm/postprocessing/BokehPass.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

const KEY = new THREE.Vector3(0.28, 1.0, 0.36).normalize();

const PARS_V = /* glsl */`
attribute float aM;
varying float vM; varying vec3 vWP; varying vec3 vWN;
`;
const PARS_F = /* glsl */`
varying float vM; varying vec3 vWP; varying vec3 vWN;
uniform float uL[16]; uniform vec4 uK; uniform float uAlarm; uniform float uTime; uniform float uAmb; uniform float uOutAmb;
uniform sampler2D uSh0; uniform sampler2D uSh1; uniform mat4 uSM; uniform float uShOn; uniform float uShTex;
uniform sampler2D tWoodC; uniform sampler2D tWoodN; uniform sampler2D tWoodR;
uniform sampler2D tTileC; uniform sampler2D tTileN; uniform sampler2D tBrickC; uniform sampler2D tBrickN;
uniform vec3 uKeyDir;
float bxRough; float bxMetal; vec3 bxN; float bxOutside; float bxL; float bxSh;
float h1(float n){ return fract(sin(n)*43758.5453); }
float h3(vec3 p){ return fract(sin(dot(p, vec3(127.1,311.7,74.7)))*43758.5453); }
float vn(vec3 p){ vec3 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(mix(h3(i),h3(i+vec3(1,0,0)),f.x),mix(h3(i+vec3(0,1,0)),h3(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(h3(i+vec3(0,0,1)),h3(i+vec3(1,0,1)),f.x),mix(h3(i+vec3(0,1,1)),h3(i+vec3(1,1,1)),f.x),f.y),f.z); }
float fbm(vec3 p){ return 0.55*vn(p)+0.3*vn(p*2.07)+0.15*vn(p*4.3); }
float shTap(sampler2D t, vec3 s){
  float r=0.0;
  for(int i=-SH_TAPS;i<=SH_TAPS;i++) for(int j=-SH_TAPS;j<=SH_TAPS;j++){
    r += (s.z-0.0016 <= texture2D(t, s.xy+vec2(float(i),float(j))*uShTex).r) ? 1.0 : 0.0; }
  return r/float((2*SH_TAPS+1)*(2*SH_TAPS+1));
}
float shadowAt(vec3 p, vec3 n){
  if(uShOn < 0.5) return 1.0;
  vec3 q = p + n*0.05;
  vec4 l = uSM*vec4(q,1.0); vec3 s = l.xyz*0.5+0.5;
  if(s.x<0.0||s.x>1.0||s.y<0.0||s.y>1.0) return 1.0;
  return q.y < 4.3 ? shTap(uSh0, s) : shTap(uSh1, s);
}
float zl(vec3 p){
  float i = p.x<24.0 ? (p.z<14.0?0.0:1.0) : (p.x<40.0 ? (p.z<12.0?2.0:(p.z<28.0?3.0:4.0)) : (p.z<14.0?5.0:(p.z<28.0?6.0:7.0)));
  if(p.y>4.45) i+=8.0;
  float L=1.0;
  for(int k=0;k<16;k++){ if(float(k)==i) L=uL[k]; }
  float d=distance(p,uK.xyz); if(d<11.0) L*=mix(uK.w,1.0,d/11.0);
  return L;
}
// bump from a procedural height (world space)
vec3 bumpH(vec3 n, float h, float s){
  vec3 dpx=dFdx(vWP), dpy=dFdy(vWP); float hx=dFdx(h), hy=dFdy(h);
  vec3 r1=cross(dpy,n), r2=cross(n,dpx); float det=dot(dpx,r1);
  return normalize(abs(det)*n - sign(det)*s*(hx*r1+hy*r2));
}
`;
// runs right after the vertex colour is applied: decides albedo / roughness / metalness / world normal
const SURFACE_F = /* glsl */`
#include <color_fragment>
{
  float m = floor(vM+0.5); vec3 p = vWP; vec3 n = normalize(vWN);
  if(!gl_FrontFacing) n = -n;
  vec3 c = pow(max(diffuseColor.rgb, 0.0), vec3(2.2));
  bxRough = 0.72; bxMetal = 0.0; bxN = n;
  bxOutside = (p.z < -0.14 || p.x > 64.14 || p.x < -0.14 || p.z > 40.14 || p.y > 9.31) ? 1.0 : 0.0;
  // dominant-axis planar mapping
  vec3 an = abs(n); vec2 uv; vec3 T; vec3 B;
  if(an.y>an.x && an.y>an.z){ uv=p.xz; T=vec3(1,0,0); B=vec3(0,0,1); }
  else if(an.x>an.z){ uv=p.zy; T=vec3(0,0,1); B=vec3(0,1,0); }
  else { uv=p.xy; T=vec3(1,0,0); B=vec3(0,1,0); }
  vec2 gx=dFdx(uv), gy=dFdy(uv);
  if(m==1.0){ // painted planks
    float f=fract(p.z/0.19); if(abs(n.y)<0.5) f=fract(p.y/0.19);
    c*= (f<0.06?0.6:1.0)*(0.9+0.16*vn(p*vec3(0.5,8.0,8.0))); bxRough=0.62;
    bxN=bumpH(n, smoothstep(0.0,0.06,f), 0.004);
  } else if(m==2.0){ // floor tile
    vec2 u=uv/5.4; vec3 t=textureGrad(tTileC,u,gx/5.4,gy/5.4).rgb; c*=pow(t,vec3(2.2))/0.643;
    vec3 tn=textureGrad(tTileN,u,gx/5.4,gy/5.4).xyz*2.0-1.0; bxN=normalize(n+ (T*tn.x - B*tn.y)*0.9);
    bxRough=0.22;
  } else if(m==3.0 || m==19.0){ // wood: floor boards and furniture grain share the photo texture
    float sc = m==3.0 ? (n.y>0.5 ? 1.5 : 0.7) : 0.45;
    vec2 u=uv.yx/sc; vec2 ax=gx.yx/sc, ay=gy.yx/sc;
    vec3 t=pow(textureGrad(tWoodC,u,ax,ay).rgb, vec3(2.2));
    float lum=dot(t, vec3(0.3,0.5,0.2))/0.073;
    c*= mix(vec3(1.0), clamp(t/vec3(0.137,0.061,0.016),0.0,2.2), m==3.0 && n.y>0.5 ? 0.3 : 0.12)*mix(1.0, clamp(lum,0.35,1.6), m==3.0 && n.y>0.5 ? 0.42 : 0.16);
    vec3 tn=textureGrad(tWoodN,u,ax,ay).xyz*2.0-1.0; bxN=normalize(n+(B*tn.x - T*tn.y)*(m==3.0?1.0:0.5));
    float r=textureGrad(tWoodR,u,ax,ay).g;
    bxRough = m==3.0 ? (n.y>0.5 ? mix(0.18,0.5,r) : 0.55) : mix(0.3,0.55,r);
  } else if(m==5.0){ // concrete
    float h=fbm(p*2.0)+0.35*vn(p*13.0)+0.2*vn(p*47.0); c*=0.72+0.3*h; vec2 g=fract(p.xz/3.0); if(min(g.x,g.y)<0.004) c*=0.6;
    bxRough=0.88; bxN=bumpH(n,h,0.012);
  } else if(m==6.0){ // shiplap
    float s=fract((abs(n.x)>0.5?p.z:p.x)/0.21); c*= (s<0.04?0.55:1.0)*(0.94+0.08*vn(p*vec3(9.0,1.0,9.0)));
    bxRough=0.6; bxN=bumpH(n, smoothstep(0.0,0.05,s), 0.004);
  } else if(m==7.0){ // brick
    vec2 u=uv/1.9; vec3 t=pow(textureGrad(tBrickC,u,gx/1.9,gy/1.9).rgb, vec3(2.2));
    c = mix(c, c*t/vec3(0.491,0.256,0.158), 0.85)*0.9;
    vec3 tn=textureGrad(tBrickN,u,gx/1.9,gy/1.9).xyz*2.0-1.0; bxN=normalize(n+(T*tn.x + B*tn.y)*1.4);
    bxRough=0.9;
  } else if(m==8.0){ // carpet
    float h=vn(p*140.0)*0.6+vn(p*37.0)*0.4; c*=0.7+0.5*h; bxRough=1.0; bxN=bumpH(n,h,0.004);
  } else if(m==9.0){ // upholstery weave
    vec2 w=uv*700.0; float wf=clamp(1.0-length(p-cameraPosition)/3.5,0.0,1.0); float h=0.5+0.25*sin(w.x)*sin(w.y)*wf+0.25*vn(p*90.0);
    c*=0.86+0.24*h; c+= c*pow(1.0-max(dot(n,normalize(cameraPosition-p)),0.0),3.0)*0.6;
    bxRough=0.95; bxN=bumpH(n,h,0.0016);
  } else if(m==10.0){ bxRough=0.12; } // glazed ceramic
  else if(m==11.0){ bxRough=0.28; bxMetal=1.0; bxN=bumpH(n, vn(p*vec3(300.0,6.0,300.0)), 0.0006); }
  else if(m==12.0){ bxRough=0.04; c=mix(c, vec3(0.75,0.85,0.9), 0.5); }
  else if(m==13.0){ c*=0.94+0.1*vn(p*70.0); bxRough=0.5; bxN=bumpH(n, vn(p*220.0), 0.0005); } // skin
  else if(m==14.0){ float h=vn(p*vec3(160.0,20.0,160.0)); c*=0.7+0.5*h; bxRough=0.42; bxN=bumpH(n,h,0.002); } // hair
  else if(m==15.0){ float h=vn(p*vec3(55.0,9.0,55.0))*0.7+vn(p*150.0)*0.3; c*=0.45+0.8*h; bxRough=1.0; bxN=bumpH(n,h,0.006); } // fur
  else if(m==16.0){ float h=fbm(p*3.0); c*=0.9+0.12*h; if(h3(floor(p*60.0))>0.996) c+=vec3(0.8); bxRough=0.7; bxN=bumpH(n,h,0.03); } // snow
  else if(m==17.0){ // asphalt with drifted snow
    float sn=smoothstep(0.42,0.62,vn(vec3(p.x*0.5,0.0,p.z*0.5))+0.2*vn(p*4.0)); float h=vn(p*30.0);
    c=mix(c*(0.6+0.5*h), vec3(0.78,0.83,0.9), sn); bxRough=mix(0.55,0.75,sn); bxN=bumpH(n,h*(1.0-sn)+sn*fbm(p*2.0)*4.0,0.004);
  } else if(m==18.0){ float h=vn(p*60.0)*0.6+vn(p*170.0)*0.4; c*=0.85+0.2*h; bxRough=0.38; bxN=bumpH(n,h,0.0012); } // leather
  else if(m==20.0){ // Krampus hide: cracked, dry, matte
    float h=vn(p*48.0)*0.55+vn(p*140.0)*0.3+vn(p*9.0)*0.15; float cr=smoothstep(0.0,0.05,abs(vn(p*17.0)-0.5));
    c*=(0.7+0.45*h)*mix(0.45,1.0,cr); bxRough=0.86; bxN=bumpH(n,h*0.7+cr*0.3,0.0035);
  } else if(m==21.0){ // horn: ridged and dry
    float h=vn(p*vec3(90.0,25.0,90.0))*0.6+vn(p*220.0)*0.4; c*=0.75+0.4*h; bxRough=0.6; bxN=bumpH(n,h,0.0025);
  }
  else { c*=0.96+0.06*vn(p*24.0); }
  bxL = bxOutside>0.5 ? 1.0 : zl(p)*uAmb;
  bxSh = bxOutside>0.5 ? 1.0 : shadowAt(p, n);
  if(m==4.0){ // emissive: lamps, tree lights, signs, snowflakes
    float lit = bxOutside>0.5 ? 1.0 : mix(0.12, 1.0, zl(p));
    totalEmissiveRadiance += c*lit*GLOW_K; c=vec3(0.0); bxRough=1.0;
  }
  diffuseColor.rgb = c;
  #ifdef BX_GLASS
  diffuseColor.a = m==12.0 ? 0.14+0.6*pow(1.0-abs(dot(n,normalize(cameraPosition-p))),2.5) : 1.0;
  #endif
}
`;
// our own store lighting: zone-dimmed hemisphere + key light with the baked floor shadow maps
const LIGHT_F = /* glsl */`
{
  vec3 wn = bxN; float ny = wn.y*0.5+0.5;
  vec3 hemi;
  if(bxOutside>0.5) hemi = mix(vec3(0.018,0.024,0.045), vec3(0.07,0.095,0.17), ny)*uOutAmb;
  else hemi = mix(vec3(0.009,0.011,0.018)+vec3(0.012,0.015,0.026)*ny, mix(vec3(0.075,0.068,0.06), vec3(0.26,0.24,0.21), ny), bxL);   // brighter all round; dark zones stay dark but readable
  irradiance += hemi*PI;
  float envK = bxOutside>0.5 ? 0.1*uOutAmb : mix(0.03, 0.55, bxL);
  iblIrradiance *= envK*0.35; radiance *= envK;
  if(bxOutside<0.5){
    IncidentLight kl; kl.direction = normalize(mat3(viewMatrix)*uKeyDir);
    kl.color = vec3(1.0,0.88,0.72)*(0.62*PI*bxL*mix(0.08,1.0,bxSh)); kl.visible = true;
    RE_Direct(kl, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight);
  }
}
#include <lights_fragment_end>
`;
const FINAL_F = /* glsl */`
{
  float pulse=uAlarm*(0.12+0.38*(0.5+0.5*sin(uTime*7.0)));
  if(bxOutside<0.5) outgoingLight=mix(outgoingLight, outgoingLight*vec3(2.2,0.22,0.18)+vec3(0.012,0.0,0.0), pulse);
  float d=length(vWP-cameraPosition);
  if(bxOutside>0.5){ float fog=clamp((d-6.0)/70.0,0.0,0.85); outgoingLight=mix(outgoingLight, vec3(0.006,0.009,0.02), fog); }
  else { float fog=1.0-exp(-max(d-10.0,0.0)*0.012); outgoingLight=mix(outgoingLight, vec3(0.003,0.003,0.004), fog*0.7); }
}
#include <opaque_fragment>
`;

function loadTex(key, srgb) {
  const t = new THREE.Texture(); const img = new Image();
  img.onload = () => { t.image = img; t.needsUpdate = true; };
  img.src = (window.BOX_TEX || {})[key] || '';
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; t.colorSpace = THREE.NoColorSpace; // sampled raw, converted in the shader
  t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true;
  return t;
}

class Renderer {
  constructor(canvas, opt = {}) {
    this.canvas = canvas; this.NL = opt.lights || 8; this.q = opt.quality || 'high';
    const r = this.r = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance' });
    r.setPixelRatio(1); r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.22;
    r.outputColorSpace = THREE.SRGBColorSpace; r.shadowMap.enabled = false;
    this.gl = r.getContext();
    const scene = this.scene = new THREE.Scene(); scene.background = new THREE.Color(0x020308);
    if ((window.BOX_TEX || {}).sky) { // Poly Haven night sky behind the parking lot
      const sky = new THREE.Texture(), img = new Image();
      img.onload = () => { sky.image = img; sky.mapping = THREE.EquirectangularReflectionMapping; sky.colorSpace = THREE.SRGBColorSpace; sky.needsUpdate = true; scene.background = sky; scene.backgroundIntensity = 0.05; scene.backgroundRotation.y = 2.2; };
      img.src = window.BOX_TEX.sky;
    }
    const pm = new THREE.PMREMGenerator(r); scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture; pm.dispose();
    this.cam = new THREE.PerspectiveCamera(60, 1, 0.04, 170);
    this.lights = [];
    for (let i = 0; i < this.NL; i++) { const l = new THREE.PointLight(0xffffff, 0, 1, 0); scene.add(l); this.lights.push(l); }
    this.shadowRes = opt.shadowRes || 2048;
    this.U = {
      uL: { value: new Float32Array(16).fill(1) }, uK: { value: new THREE.Vector4(0, -99, 0, 1) }, uAlarm: { value: 0 }, uTime: { value: 0 },
      uAmb: { value: 1 }, uOutAmb: { value: 1 }, uSh0: { value: null }, uSh1: { value: null }, uSM: { value: new THREE.Matrix4() },
      uShOn: { value: 0 }, uShTex: { value: 1 / this.shadowRes }, uKeyDir: { value: KEY.clone() },
      tWoodC: { value: loadTex('wood_c') }, tWoodN: { value: loadTex('wood_n') }, tWoodR: { value: loadTex('wood_r') },
      tTileC: { value: loadTex('tile_c') }, tTileN: { value: loadTex('tile_n') }, tBrickC: { value: loadTex('brick_c') }, tBrickN: { value: loadTex('brick_n') },
    };
    const taps = opt.taps == null ? 1 : opt.taps;
    const mk = (glass) => {
      const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0, transparent: glass, depthWrite: !glass, side: glass ? THREE.DoubleSide : THREE.FrontSide });
      m.defines = { SH_TAPS: taps, GLOW_K: '2.1' }; if (glass) m.defines.BX_GLASS = 1;
      m.onBeforeCompile = (s) => {
        Object.assign(s.uniforms, this.U);
        s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\n' + PARS_V)
          .replace('#include <begin_vertex>', '#include <begin_vertex>\nvM = aM; vWP = position; vWN = normal;');
        s.fragmentShader = s.fragmentShader.replace('#include <common>', '#include <common>\n' + PARS_F)
          .replace('#include <color_fragment>', SURFACE_F)
          .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = bxRough;')
          .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = bxMetal;')
          .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = normalize(mat3(viewMatrix)*bxN);')
          .replace('#include <lights_fragment_end>', LIGHT_F)
          .replace('#include <opaque_fragment>', FINAL_F);
      };
      return m;
    };
    this.mat = mk(false); this.glassMat = mk(true);
    this.mulMat = new THREE.MeshBasicMaterial({ vertexColors: true, blending: THREE.CustomBlending, blendSrc: THREE.DstColorFactor, blendDst: THREE.ZeroFactor, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, toneMapped: false, transparent: true });
    this.dyn = { opaque: this._dynMesh(this.mat, 1 << 18, 1), mul: this._dynMesh(this.mulMat, 1 << 14, 2), alpha: this._dynMesh(this.glassMat, 1 << 15, 3) };

    // post-processing
    const comp = this.comp = new EffectComposer(r);
    comp.addPass(new RenderPass(scene, this.cam));
    if (this.q === 'high') {
      try { this.ao = new GTAOPass(scene, this.cam, 4, 4); this.ao.blendIntensity = 0.9; this.ao.updateGtaoMaterial({ radius: 0.5, distanceExponent: 1.4, thickness: 1.2, scale: 1.1, samples: 12 }); comp.addPass(this.ao); } catch (e) { this.ao = null; }
      this.dof = new BokehPass(scene, this.cam, { focus: 6, aperture: 0.0008, maxblur: 0.006 }); this.dof.enabled = false; comp.addPass(this.dof);
    }
    this.bloom = new UnrealBloomPass(new THREE.Vector2(4, 4), this.q === 'high' ? 0.26 : 0.2, 0.5, 1.25); comp.addPass(this.bloom);
    comp.addPass(new OutputPass());
    this.grade = new ShaderPass({
      uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uFade: { value: 0 }, uGrain: { value: this.q === 'high' ? 0.055 : 0.035 }, uFear: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,0.0,1.0); }',
      fragmentShader: /* glsl */`uniform sampler2D tDiffuse; uniform float uTime; uniform float uFade; uniform float uGrain; uniform float uFear; varying vec2 vUv;
        float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))+uTime*3.7)*43758.5453); }
        void main(){ vec2 d=vUv-0.5; float r2=dot(d,d);
          float ca=0.0015+uFear*0.006;
          vec3 c=vec3(texture2D(tDiffuse, vUv+d*ca*r2*4.0).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv-d*ca*r2*4.0).b);
          c=mix(c, c*vec3(0.94,0.98,1.06), 0.5);                 // slightly cold grade
          c=mix(vec3(dot(c,vec3(0.3,0.59,0.11))), c, 1.0-uFear*0.45);
          c*=1.0-r2*(1.05+uFear*0.9);
          c+=(h(gl_FragCoord.xy)-0.5)*uGrain*(1.0+uFear*2.0);
          gl_FragColor=vec4(c*(1.0-uFade),1.0); }`,
    });
    comp.addPass(this.grade);
    this.o = null;
  }
  _dynMesh(mat, cap, order) {
    const geo = new THREE.BufferGeometry(); const d = { geo, cap: 0, ib: null };
    const mesh = new THREE.Mesh(geo, mat); mesh.frustumCulled = false; mesh.renderOrder = order; mesh.visible = false; this.scene.add(mesh);
    d.mesh = mesh; this._dynAlloc(d, cap); return d;
  }
  _dynAlloc(d, floats) {
    d.cap = floats; d.ib = new THREE.InterleavedBuffer(new Float32Array(floats), 10); d.ib.setUsage(THREE.DynamicDrawUsage);
    const g = d.geo; g.dispose(); d.geo = d.mesh.geometry = new THREE.BufferGeometry();
    d.geo.setAttribute('position', new THREE.InterleavedBufferAttribute(d.ib, 3, 0));
    d.geo.setAttribute('normal', new THREE.InterleavedBufferAttribute(d.ib, 3, 3));
    d.geo.setAttribute('color', new THREE.InterleavedBufferAttribute(d.ib, 3, 6));
    d.geo.setAttribute('aM', new THREE.InterleavedBufferAttribute(d.ib, 1, 9));
    d.geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(32, 4, 20), 300);
  }
  // static scene: packed 20-byte vertices (xyz float, normal int8x3, rgb uint8x3, material uint8) or 10-float vertices
  upload(arr) {
    let n, pos, nor, col, mat;
    if (arr instanceof Uint8Array) {
      n = arr.length / 20; pos = new Float32Array(n * 3); nor = new Int8Array(n * 3); col = new Uint8Array(n * 3); mat = new Uint8Array(n);
      const f = new Float32Array(arr.buffer, arr.byteOffset, n * 5), i8 = new Int8Array(arr.buffer, arr.byteOffset, n * 20);
      for (let v = 0; v < n; v++) {
        const o = v * 20; pos[v * 3] = f[v * 5]; pos[v * 3 + 1] = f[v * 5 + 1]; pos[v * 3 + 2] = f[v * 5 + 2];
        nor[v * 3] = i8[o + 12]; nor[v * 3 + 1] = i8[o + 13]; nor[v * 3 + 2] = i8[o + 14];
        col[v * 3] = arr[o + 16]; col[v * 3 + 1] = arr[o + 17]; col[v * 3 + 2] = arr[o + 18]; mat[v] = arr[o + 19];
      }
    } else {
      n = arr.length / 10; pos = new Float32Array(n * 3); nor = new Int8Array(n * 3); col = new Uint8Array(n * 3); mat = new Uint8Array(n);
      for (let v = 0; v < n; v++) {
        const s = v * 10; pos[v * 3] = arr[s]; pos[v * 3 + 1] = arr[s + 1]; pos[v * 3 + 2] = arr[s + 2];
        const l = Math.hypot(arr[s + 3], arr[s + 4], arr[s + 5]) || 1;
        for (let k = 0; k < 3; k++) { nor[v * 3 + k] = Math.round(arr[s + 3 + k] / l * 127); col[v * 3 + k] = Math.max(0, Math.min(255, Math.round(arr[s + 6 + k] * 255))); }
        mat[v] = arr[s + 9];
      }
    }
    // glass triangles go to their own blended mesh
    const tri = n / 3; let ng = 0; for (let t = 0; t < tri; t++) if (mat[t * 3] === 12) ng++;
    const build = (want, count) => {
      const P = new Float32Array(count * 9), N = new Int8Array(count * 9), C = new Uint8Array(count * 9), M = new Uint8Array(count * 3); let k = 0;
      for (let t = 0; t < tri; t++) { if ((mat[t * 3] === 12) !== want) continue; P.set(pos.subarray(t * 9, t * 9 + 9), k * 9); N.set(nor.subarray(t * 9, t * 9 + 9), k * 9); C.set(col.subarray(t * 9, t * 9 + 9), k * 9); M.set(mat.subarray(t * 3, t * 3 + 3), k * 3); k++; }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.BufferAttribute(N, 3, true));
      g.setAttribute('color', new THREE.BufferAttribute(C, 3, true)); g.setAttribute('aM', new THREE.BufferAttribute(M, 1));
      return g;
    };
    const mesh = new THREE.Mesh(build(false, tri - ng), this.mat); mesh.frustumCulled = false; mesh.visible = false; this.scene.add(mesh);
    let glass = null;
    if (ng) { glass = new THREE.Mesh(build(true, ng), this.glassMat); glass.frustumCulled = false; glass.renderOrder = 2.5; glass.visible = false; this.scene.add(glass); }
    return { count: n, mesh, glass, packed: true };
  }
  // ---- downloaded models (GLB, embedded in the page as window.BOX_GLB) ----
  // slots: [{key, x, y, z, yaw, w, h, d, turn, tint}] from level.js. Each model is fitted to the footprint of the
  // hand-built piece it replaces and drawn instanced, with the store's own lighting patched into its material.
  _modelMat(src) {
    const m = src.clone(); m.defines = Object.assign({}, m.defines, { SH_TAPS: 1, GLOW_K: '2.1' }); m.envMapIntensity = 1;
    m.onBeforeCompile = (s) => {
      Object.assign(s.uniforms, this.U);
      s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nvarying float vM; varying vec3 vWP; varying vec3 vWN;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\n{ vec4 bw = vec4(transformed, 1.0);\n#ifdef USE_INSTANCING\nbw = instanceMatrix * bw;\n#endif\nvWP = (modelMatrix * bw).xyz; vM = 0.0; vWN = vec3(0.0, 1.0, 0.0); }');
      s.fragmentShader = s.fragmentShader.replace('#include <common>', '#include <common>\n' + PARS_F)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
          bxN = normalize((vec4(normal, 0.0) * viewMatrix).xyz);
          bxOutside = (vWP.z < -0.14 || vWP.x > 64.14 || vWP.x < -0.14 || vWP.z > 40.14 || vWP.y > 9.31) ? 1.0 : 0.0;
          bxL = bxOutside > 0.5 ? 1.0 : zl(vWP) * uAmb; bxSh = bxOutside > 0.5 ? 1.0 : shadowAt(vWP, bxN);`)
        .replace('#include <lights_fragment_end>', LIGHT_F)
        .replace('#include <opaque_fragment>', FINAL_F);
    };
    return m;
  }
  async addModels(slots) {
    const src = window.BOX_GLB || {}, by = {};
    for (const s of slots || []) if (src[s.key]) (by[s.key] = by[s.key] || []).push(s);
    const loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder);
    this.models = this.models || [];
    await Promise.all(Object.keys(by).map(async (key) => {
      try {
        const bin = Uint8Array.from(atob(src[key]), (c) => c.charCodeAt(0)).buffer;
        const g = await new Promise((res, rej) => loader.parse(bin, '', res, rej));
        g.scene.updateMatrixWorld(true);
        const bb = new THREE.Box3().setFromObject(g.scene), size = bb.getSize(new THREE.Vector3()), ctr = bb.getCenter(new THREE.Vector3());
        const list = by[key];
        const T = new THREE.Matrix4(), Rm = new THREE.Matrix4(), S = new THREE.Matrix4(), C = new THREE.Matrix4(), M = new THREE.Matrix4(), col = new THREE.Color();
        g.scene.traverse((o) => {
          if (!o.isMesh) return;
          const im = new THREE.InstancedMesh(o.geometry, this._modelMat(o.material), list.length);
          list.forEach((s, i) => {
            const turned = Math.abs(Math.sin(s.turn || 0)) > 0.5, bx = turned ? size.z : size.x, bz = turned ? size.x : size.z;
            let sx, sy, sz;
            if (s.w && s.d) { sx = s.w / bx; sz = s.d / bz; sy = s.h ? s.h / size.y : (sx + sz) / 2; } else { sx = sy = sz = s.h / size.y; }
            T.makeTranslation(s.x, s.y, s.z); Rm.makeRotationY(s.yaw || 0); S.makeScale(sx, sy, sz);
            M.copy(T).multiply(Rm).multiply(S).multiply(C.makeRotationY(s.turn || 0)).multiply(C.makeTranslation(-ctr.x, -bb.min.y, -ctr.z)).multiply(o.matrixWorld);
            im.setMatrixAt(i, M);
            const t = s.tint || [1, 1, 1]; im.setColorAt(i, col.setRGB(t[0], t[1], t[2]));
          });
          im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true;
          im.frustumCulled = false; im.visible = false; this.scene.add(im); this.models.push(im);
        });
      } catch (e) { console.warn('model failed: ' + key, e); }
    }));
    if (this._bake) this.bakeShadows(this._bake[0], this._bake[1]);
    return this.models.length;
  }
  resize(scaleCap) {
    const dpr = Math.min(window.devicePixelRatio || 1, scaleCap || 1.5);
    const w = Math.max(2, Math.floor(this.canvas.clientWidth * dpr)), h = Math.max(2, Math.floor(this.canvas.clientHeight * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) { this.r.setSize(w, h, false); this.comp.setSize(w, h); }
  }
  // two depth maps along the key light, one per floor (so the upstairs slab doesn't black out downstairs)
  bakeShadows(obj, bounds) {
    this._bake = [obj, bounds];
    const S = this.shadowRes, c = new THREE.Vector3((bounds[0] + bounds[1]) / 2, (bounds[2] + bounds[3]) / 2, (bounds[4] + bounds[5]) / 2);
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
    cam.position.copy(c).addScaledVector(KEY, 40); cam.up.set(0, 0, -1); cam.lookAt(c); cam.updateMatrixWorld();
    const mn = new THREE.Vector3(1e9, 1e9, 1e9), mx = new THREE.Vector3(-1e9, -1e9, -1e9), v = new THREE.Vector3();
    for (const x of [bounds[0], bounds[1]]) for (const y of [bounds[2], bounds[3]]) for (const z of [bounds[4], bounds[5]]) { v.set(x, y, z).applyMatrix4(cam.matrixWorldInverse); mn.min(v); mx.max(v); }
    cam.left = mn.x; cam.right = mx.x; cam.bottom = mn.y; cam.top = mx.y; cam.near = -mx.z - 1; cam.far = -mn.z + 1; cam.updateProjectionMatrix();
    this.U.uSM.value.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    const dm = new THREE.ShaderMaterial({
      uniforms: { uYR: { value: new THREE.Vector2() } }, side: THREE.DoubleSide,
      vertexShader: 'attribute float aM; varying float vY; varying float vM; void main(){ vY=position.y; vM=aM; gl_Position=projectionMatrix*viewMatrix*vec4(position,1.0); }',
      fragmentShader: 'varying float vY; varying float vM; uniform vec2 uYR; void main(){ float m=floor(vM+0.5); if(vY<uYR.x||vY>uYR.y||m==4.0||m==12.0) discard; gl_FragColor=vec4(1.0); }',
    });
    const sc = new THREE.Scene(); const m = new THREE.Mesh(obj.mesh.geometry, dm); m.frustumCulled = false; sc.add(m);
    const dmI = new THREE.ShaderMaterial({
      uniforms: dm.uniforms, side: THREE.DoubleSide,
      vertexShader: 'varying float vY; void main(){ vec4 w=vec4(position,1.0);\n#ifdef USE_INSTANCING\nw=instanceMatrix*w;\n#endif\nw=modelMatrix*w; vY=w.y; gl_Position=projectionMatrix*viewMatrix*w; }',
      fragmentShader: 'varying float vY; uniform vec2 uYR; void main(){ if(vY<uYR.x||vY>uYR.y) discard; gl_FragColor=vec4(1.0); }',
    });
    for (const im of this.models || []) { if (im.material.alphaTest > 0 || im.material.transparent) continue; const c = new THREE.InstancedMesh(im.geometry, dmI, im.count); c.instanceMatrix = im.instanceMatrix; c.frustumCulled = false; sc.add(c); }
    const names = ['uSh0', 'uSh1'], ranges = [[0.005, 4.0], [4.52, 8.9]];
    for (let i = 0; i < 2; i++) {
      if (this.U[names[i]].value) this.U[names[i]].value.dispose();
      const rt = new THREE.WebGLRenderTarget(S, S, { depthBuffer: true });
      rt.depthTexture = new THREE.DepthTexture(S, S, THREE.UnsignedIntType); rt.depthTexture.minFilter = rt.depthTexture.magFilter = THREE.NearestFilter;
      dm.uniforms.uYR.value.set(ranges[i][0], ranges[i][1]);
      this.r.setRenderTarget(rt); this.r.clear(); this.r.render(sc, cam);
      this.U[names[i]].value = rt.depthTexture;
    }
    this.r.setRenderTarget(null); this.U.uShOn.value = 1; dm.dispose(); dmI.dispose();
    return true;
  }
  // o: {proj?, view, fov, eye, zones(16), k[4], alarm, time, lights[{x,y,z,r,c,i}], fade, amb, expo, outAmb, focus, fear}
  begin(o) {
    this.o = o; const U = this.U;
    U.uL.value.set(o.zones); U.uK.value.set(o.k[0], o.k[1], o.k[2], o.k[3]); U.uAlarm.value = o.alarm || 0; U.uTime.value = o.time || 0;
    U.uAmb.value = o.amb == null ? 1 : o.amb; U.uOutAmb.value = o.outAmb == null ? 1 : o.outAmb; U.uShOn.value = U.uSh0.value && o.shadows !== false ? 1 : 0;
    const ls = o.lights || [];
    for (let i = 0; i < this.NL; i++) {
      const L = this.lights[i], l = ls[i];
      if (l) { L.position.set(l.x, l.y, l.z); L.color.setRGB(Math.pow(l.c[0], 2.2), Math.pow(l.c[1], 2.2), Math.pow(l.c[2], 2.2)); L.intensity = l.i * 0.95; L.distance = l.r; L.decay = 0.8; } else L.intensity = 0;
    }
    const cam = this.cam; cam.fov = (o.fov || 1.15) * 180 / Math.PI; cam.aspect = this.canvas.width / Math.max(1, this.canvas.height); cam.updateProjectionMatrix();
    cam.matrix.fromArray(o.view).invert(); cam.matrix.decompose(cam.position, cam.quaternion, cam.scale);
    this.r.toneMappingExposure = (o.expo || 1.3) * 0.72;
    this.grade.uniforms.uTime.value = o.time || 0; this.grade.uniforms.uFade.value = o.fade || 0; this.grade.uniforms.uFear.value = o.fear || 0;
    if (this.dof) { this.dof.enabled = o.focus > 0; if (o.focus > 0) { this.dof.uniforms.focus.value = o.focus; this.dof.uniforms.aspect.value = cam.aspect; } }
    for (const k in this.dyn) this.dyn[k].mesh.visible = false;
    if (this._static) { this._static.mesh.visible = false; if (this._static.glass) this._static.glass.visible = false; }
    for (const im of this.models || []) im.visible = false;
  }
  draw(obj) { this._static = obj; obj.mesh.visible = true; if (obj.glass) obj.glass.visible = true; for (const im of this.models || []) im.visible = true; }
  drawDynamic(arr, mode = 'opaque') {
    const d = this.dyn[mode]; if (!arr || !arr.length) { d.mesh.visible = false; return; }
    if (arr.length > d.cap) { let c = d.cap; while (c < arr.length) c *= 2; this._dynAlloc(d, c); }
    d.ib.array.set(arr); d.ib.clearUpdateRanges(); d.ib.addUpdateRange(0, arr.length); d.ib.needsUpdate = true;
    d.geo.setDrawRange(0, arr.length / 10); d.mesh.visible = true;
  }
  end() { this.comp.render(); }
}
window.Renderer = Renderer;
