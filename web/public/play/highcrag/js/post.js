// Highcrag — post-processing: HDR render target -> bloom -> filmic tone map + colour grade -> screen.
// Self-contained (no three.js addons needed): full-screen triangle passes with small ShaderMaterials.
import * as THREE from '../../vendor/three.module.js';

const VERT = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

function fullscreen(material) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
  const m = new THREE.Mesh(g, material);
  m.frustumCulled = false;
  return m;
}

const rt = (w, h, samples = 0) => new THREE.WebGLRenderTarget(Math.max(1, w), Math.max(1, h), {
  type: THREE.HalfFloatType, samples, depthBuffer: samples >= 0, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
});

export class Post {
  constructor(renderer, { samples = 0, bloomScale = 0.5 } = {}) {
    this.renderer = renderer;
    this.bloomScale = bloomScale;
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.scene = new THREE.Scene();
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    this.main = rt(size.x, size.y, samples);
    this.a1 = rt(1, 1); this.b1 = rt(1, 1);
    this.a2 = rt(1, 1); this.b2 = rt(1, 1);

    this.bright = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null }, threshold: { value: 0.85 } },
      vertexShader: VERT,
      fragmentShader: `uniform sampler2D tDiffuse; uniform float threshold; varying vec2 vUv;
        void main(){
          vec3 c = texture2D(tDiffuse, vUv).rgb;
          float l = max(c.r, max(c.g, c.b));
          float k = smoothstep(threshold, threshold + 0.6, l);
          gl_FragColor = vec4(min(c * k, vec3(12.0)), 1.0);
        }`,
      depthTest: false, depthWrite: false,
    });
    this.blur = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null }, dir: { value: new THREE.Vector2() } },
      vertexShader: VERT,
      fragmentShader: `uniform sampler2D tDiffuse; uniform vec2 dir; varying vec2 vUv;
        void main(){
          vec3 c = texture2D(tDiffuse, vUv).rgb * 0.227027;
          c += texture2D(tDiffuse, vUv + dir * 1.3846153846).rgb * 0.3162162162;
          c += texture2D(tDiffuse, vUv - dir * 1.3846153846).rgb * 0.3162162162;
          c += texture2D(tDiffuse, vUv + dir * 3.2307692308).rgb * 0.0702702703;
          c += texture2D(tDiffuse, vUv - dir * 3.2307692308).rgb * 0.0702702703;
          gl_FragColor = vec4(c, 1.0);
        }`,
      depthTest: false, depthWrite: false,
    });
    this.final = new THREE.ShaderMaterial({
      uniforms: {
        tScene: { value: null }, tBloom1: { value: null }, tBloom2: { value: null },
        exposure: { value: 1.05 }, bloom: { value: 0.55 }, saturation: { value: 1.1 }, contrast: { value: 1.06 },
        warmth: { value: new THREE.Vector3(1.03, 1.0, 0.95) }, vignette: { value: 0.32 }, time: { value: 0 }, grain: { value: 0.025 },
      },
      vertexShader: VERT,
      fragmentShader: `uniform sampler2D tScene; uniform sampler2D tBloom1; uniform sampler2D tBloom2;
        uniform float exposure; uniform float bloom; uniform float saturation; uniform float contrast;
        uniform vec3 warmth; uniform float vignette; uniform float time; uniform float grain; varying vec2 vUv;
        vec3 aces(vec3 x){ return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
        vec3 toSRGB(vec3 c){ return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c)); }
        float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
        void main(){
          vec3 c = texture2D(tScene, vUv).rgb;
          c += (texture2D(tBloom1, vUv).rgb * 0.55 + texture2D(tBloom2, vUv).rgb * 0.9) * bloom;
          c = aces(c * exposure);
          float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
          c = mix(vec3(l), c, saturation);
          c = clamp((c - 0.5) * contrast + 0.5, 0.0, 1.0) * warmth;
          vec2 d = vUv - 0.5;
          c *= 1.0 - vignette * smoothstep(0.35, 0.85, length(d * vec2(1.0, 0.85)) * 1.35);
          vec3 s = toSRGB(clamp(c, 0.0, 1.0));
          s += (hash(vUv * 1024.0 + time) - 0.5) * grain;
          gl_FragColor = vec4(s, 1.0);
        }`,
      depthTest: false, depthWrite: false, toneMapped: false,
    });
    this.quad = fullscreen(this.bright);
    this.scene.add(this.quad);
    this.setSize();
  }

  setSize() {
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.main.setSize(size.x, size.y);
    const w1 = Math.round(size.x * this.bloomScale), h1 = Math.round(size.y * this.bloomScale);
    this.a1.setSize(w1, h1); this.b1.setSize(w1, h1);
    this.a2.setSize(Math.round(w1 / 2), Math.round(h1 / 2)); this.b2.setSize(Math.round(w1 / 2), Math.round(h1 / 2));
  }

  pass(material, target) {
    this.quad.material = material;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.scene, this.cam);
  }

  blurInto(src, tmp, dst, spread) {
    this.blur.uniforms.tDiffuse.value = src.texture;
    this.blur.uniforms.dir.value.set(spread / src.width, 0);
    this.pass(this.blur, tmp);
    this.blur.uniforms.tDiffuse.value = tmp.texture;
    this.blur.uniforms.dir.value.set(0, spread / src.height);
    this.pass(this.blur, dst);
  }

  render(scene, camera, time) {
    const r = this.renderer;
    r.setRenderTarget(this.main);
    r.render(scene, camera);
    // Bright pass, then two blur levels (half and quarter of the bloom resolution).
    this.bright.uniforms.tDiffuse.value = this.main.texture;
    this.pass(this.bright, this.a1);
    this.blurInto(this.a1, this.b1, this.a1, 1.0);
    this.blur.uniforms.tDiffuse.value = this.a1.texture;
    this.blur.uniforms.dir.value.set(0, 0);
    this.pass(this.blur, this.a2);
    this.blurInto(this.a2, this.b2, this.a2, 1.6);
    const f = this.final.uniforms;
    f.tScene.value = this.main.texture;
    f.tBloom1.value = this.a1.texture;
    f.tBloom2.value = this.a2.texture;
    f.time.value = time % 100;
    this.pass(this.final, null);
  }
}
