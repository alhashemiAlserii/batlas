// Sky Crew art direction. Original to Batlas: a soft cartoon airline, not a sim.
// Shared materials get a gentle three-step shade and a warm rim so seats, people
// and the hull read as one picture. Bloom is a real post pass on desktop High
// and turns itself off if the browser cannot keep an extra color target (Safari
// fallback: emissive gauges, window glow and nav lamps still read as lights).
import * as THREE from '../../vendor/three.module.js';

const SOFT_FN = `
vec3 scSoft(vec3 c) {
  float l = max(c.r, max(c.g, c.b));
  float shaped = l * (0.76 + 0.24 * smoothstep(0.06, 0.92, l));
  float bands = floor(shaped * 3.0 + 0.18) / 3.0;
  shaped = mix(shaped, bands, 0.32);
  return c * (shaped / max(l, 0.0001));
}`;
const RIM = `outgoingLight += vec3(1.0, 0.94, 0.84) * pow(1.0 - clamp(dot(normalize(normal), normalize(geometryViewDir)), 0.0, 1.0), 2.45) * 0.15;`;

function styleCompile(shader) {
  let frag = shader.fragmentShader;
  if (frag.includes('scSoft(')) return;
  const std = 'vec3 totalDiffuse = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse;';
  const lambert = 'vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;';
  if (!frag.includes(std) && !frag.includes(lambert)) return;
  frag = frag.replace('#include <common>', `#include <common>\n${SOFT_FN}`);
  if (frag.includes(std)) {
    frag = frag.replace(std, 'vec3 totalDiffuse = scSoft(reflectedLight.directDiffuse + reflectedLight.indirectDiffuse);');
    frag = frag.replace(
      'vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;',
      `vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;\n${RIM}`,
    );
  } else {
    frag = frag.replace(lambert, `vec3 outgoingLight = scSoft(reflectedLight.directDiffuse + reflectedLight.indirectDiffuse) + totalEmissiveRadiance;\n${RIM}`);
  }
  shader.fragmentShader = frag;
}

/** Soft shade + rim. Safe to call more than once. Skips unlit and custom shaders. */
export function stylize(mat) {
  if (!mat || mat.userData?.styled) return mat;
  if (!mat.isMeshStandardMaterial && !mat.isMeshLambertMaterial) return mat;
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = function onBeforeCompile(shader, renderer) {
    if (prev) prev.call(this, shader, renderer);
    styleCompile(shader);
  };
  mat.userData.styled = true;
  return mat;
}

/** Gentle sea chop. The uniform lives on material.userData.uTime. */
export function waveSea(mat) {
  stylize(mat);
  const uTime = { value: 0 };
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = function onBeforeCompile(shader, renderer) {
    prev.call(this, shader, renderer);
    shader.uniforms.uTime = uTime;
    if (!shader.vertexShader.includes('uniform float uTime')) {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed.z += sin(position.x * 0.0028 + uTime) * cos(position.y * 0.0028 + uTime * 0.75) * 2.4;');
    }
  };
  mat.userData.uTime = uTime;
  return mat;
}

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function target(w, h, depth) {
  const rt = new THREE.WebGLRenderTarget(Math.max(1, w | 0), Math.max(1, h | 0), {
    type: THREE.UnsignedByteType,
    format: THREE.RGBAFormat,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: !!depth,
    stencilBuffer: false,
  });
  rt.texture.colorSpace = THREE.SRGBColorSpace;
  return rt;
}

/**
 * Draws the scene, and on High (when bloom is requested) adds a soft glow
 * around lights. If the extra targets cannot be created, render() falls back
 * to a straight draw.
 */
export function createPresenter(renderer, { bloom = false } = {}) {
  const state = { enabled: false, failed: false };
  if (!bloom) {
    return { get enabled() { return false; }, resize() {}, render(scene, camera) { renderer.render(scene, camera); } };
  }
  const quadScene = new THREE.Scene();
  const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const geo = new THREE.PlaneGeometry(2, 2);
  const brightMat = new THREE.ShaderMaterial({
    depthTest: false, depthWrite: false, toneMapped: false,
    uniforms: { tDiffuse: { value: null }, threshold: { value: 0.72 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: `varying vec2 vUv; uniform sampler2D tDiffuse; uniform float threshold;
      void main(){ vec4 c = texture2D(tDiffuse, vUv); float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
        gl_FragColor = vec4(c.rgb * smoothstep(threshold, threshold + 0.35, l), 1.0); }`,
  });
  const blurMat = new THREE.ShaderMaterial({
    depthTest: false, depthWrite: false, toneMapped: false,
    uniforms: { tDiffuse: { value: null }, dir: { value: new THREE.Vector2(1, 0) }, px: { value: new THREE.Vector2(1, 1) } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: `varying vec2 vUv; uniform sampler2D tDiffuse; uniform vec2 dir; uniform vec2 px;
      void main(){ vec2 o = dir * px; vec4 c = texture2D(tDiffuse, vUv) * 0.227;
        c += texture2D(tDiffuse, vUv + o * 1.4) * 0.194; c += texture2D(tDiffuse, vUv - o * 1.4) * 0.194;
        c += texture2D(tDiffuse, vUv + o * 3.2) * 0.122; c += texture2D(tDiffuse, vUv - o * 3.2) * 0.122;
        c += texture2D(tDiffuse, vUv + o * 5.5) * 0.07; c += texture2D(tDiffuse, vUv - o * 5.5) * 0.07;
        gl_FragColor = c; }`,
  });
  const compMat = new THREE.ShaderMaterial({
    depthTest: false, depthWrite: false, toneMapped: false,
    uniforms: { tScene: { value: null }, tBloom: { value: null }, strength: { value: 0.28 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: `varying vec2 vUv; uniform sampler2D tScene; uniform sampler2D tBloom; uniform float strength;
      void main(){ vec4 s = texture2D(tScene, vUv); vec4 b = texture2D(tBloom, vUv);
        gl_FragColor = vec4(s.rgb + b.rgb * strength, 1.0); }`,
  });
  const mesh = new THREE.Mesh(geo, brightMat);
  quadScene.add(mesh);
  let sceneRT = null, smallA = null, smallB = null;
  function resize() {
    const w = renderer.domElement.width || 2, h = renderer.domElement.height || 2;
    sceneRT?.dispose(); smallA?.dispose(); smallB?.dispose();
    try {
      sceneRT = target(w, h, true);
      smallA = target(Math.max(2, w >> 2), Math.max(2, h >> 2), false);
      smallB = target(Math.max(2, w >> 2), Math.max(2, h >> 2), false);
      blurMat.uniforms.px.value.set(1 / smallA.width, 1 / smallA.height);
      state.enabled = true;
    } catch (err) {
      console.warn('Sky Crew bloom unavailable', err);
      state.enabled = false; state.failed = true;
    }
  }
  resize();
  function pass(mat, src, dst) {
    mesh.material = mat;
    if (mat === brightMat) mat.uniforms.tDiffuse.value = src;
    else if (mat === blurMat) mat.uniforms.tDiffuse.value = src;
    renderer.setRenderTarget(dst);
    renderer.render(quadScene, quadCam);
  }
  return {
    get enabled() { return state.enabled && !state.failed; },
    resize,
    render(scene, camera) {
      if (!state.enabled || state.failed || !sceneRT) { renderer.setRenderTarget(null); renderer.render(scene, camera); return; }
      try {
        renderer.setRenderTarget(sceneRT);
        renderer.render(scene, camera);
        pass(brightMat, sceneRT.texture, smallA);
        blurMat.uniforms.dir.value.set(1, 0);
        pass(blurMat, smallA.texture, smallB);
        blurMat.uniforms.dir.value.set(0, 1);
        pass(blurMat, smallB.texture, smallA);
        compMat.uniforms.tScene.value = sceneRT.texture;
        compMat.uniforms.tBloom.value = smallA.texture;
        mesh.material = compMat;
        renderer.setRenderTarget(null);
        renderer.render(quadScene, quadCam);
      } catch (err) {
        console.warn('Sky Crew bloom disabled after a failed pass', err);
        state.failed = true; state.enabled = false;
        renderer.setRenderTarget(null);
        renderer.render(scene, camera);
      }
    },
  };
}

const FEATHER = [0xfff8ee, 0xf3e2c4, 0xd8c2a0, 0xffffff];

/**
 * Cabin and weather effects parented to the aircraft (and one lightning bolt
 * in the world). Low quality keeps the windscreen crack, the fire cones and
 * one puddle, and skips the particle pools.
 */
export function createFlightFx({ plane, camera, scene, quality, gearH }) {
  const particles = quality !== 'low';
  const group = new THREE.Group();
  group.name = 'flightFx';
  plane.add(group);

  const shadowTex = canvasTex(128, 128, (g, w, h) => {
    const grd = g.createRadialGradient(w / 2, h / 2, w * 0.08, w / 2, h / 2, w * 0.48);
    grd.addColorStop(0, 'rgba(20,28,40,0.42)'); grd.addColorStop(1, 'rgba(20,28,40,0)');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
  });
  const contact = new THREE.Mesh(new THREE.PlaneGeometry(18, 42), new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }));
  contact.rotation.x = -Math.PI / 2;
  contact.position.set(0, -gearH + 0.1, -1);
  contact.renderOrder = 1;
  plane.add(contact);

  const rainTex = canvasTex(64, 256, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.strokeStyle = 'rgba(230,242,255,0.55)'; g.lineWidth = 2;
    for (let i = 0; i < 28; i++) {
      const x = (i * 17) % w, y = (i * 37) % h;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x - 3, y + 28 + (i % 4) * 8); g.stroke();
    }
  });
  rainTex.wrapS = rainTex.wrapT = THREE.RepeatWrapping;
  const rainMat = new THREE.MeshBasicMaterial({ map: rainTex, transparent: true, opacity: 0.45, depthWrite: false, depthTest: false });
  const rainGlass = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 1.05), rainMat);
  rainGlass.position.set(0, 0.02, -0.62); rainGlass.renderOrder = 20; rainGlass.visible = false;
  camera.add(rainGlass);

  const crackTex = canvasTex(256, 256, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = 2;
    const cx = w * 0.58, cy = h * 0.42;
    function branch(x, y, a, len, n) {
      if (n <= 0 || len < 8) return;
      const x2 = x + Math.cos(a) * len, y2 = y + Math.sin(a) * len;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x2, y2); g.stroke();
      branch(x2, y2, a - 0.5, len * 0.62, n - 1);
      branch(x2, y2, a + 0.7, len * 0.55, n - 1);
    }
    branch(cx, cy, -0.4, 70, 4); branch(cx, cy, 2.2, 60, 4); branch(cx, cy, 1.1, 50, 3);
    g.fillStyle = 'rgba(255,255,255,0.35)';
    for (let i = 0; i < 12; i++) { g.beginPath(); g.ellipse(cx + (i - 6) * 6, cy - 20 - i * 3, 2, 6, -0.4, 0, Math.PI * 2); g.fill(); }
  });
  const crackMat = new THREE.MeshBasicMaterial({ map: crackTex, transparent: true, opacity: 0, depthWrite: false, depthTest: false });
  const crack = new THREE.Mesh(new THREE.PlaneGeometry(1.35, 0.85), crackMat);
  crack.position.set(0.05, 0.04, -0.6); crack.renderOrder = 21; crack.visible = false;
  camera.add(crack);

  const spill = new THREE.Group();
  const puddleMat = new THREE.MeshStandardMaterial({ color: 0xc68642, roughness: 0.25, metalness: 0.05, transparent: true, opacity: 0.78, depthWrite: false });
  stylize(puddleMat);
  for (const [x, z, sx] of [[0.15, -10.2, 1.4], [-0.25, 1.2, 1.8], [0.35, 4.6, 1.3], [-0.15, 7.4, 1.6]]) {
    const m = new THREE.Mesh(new THREE.CircleGeometry(0.32, 14), puddleMat);
    m.rotation.x = -Math.PI / 2; m.position.set(x, 0.025, z); m.scale.set(sx, 1, 0.7); spill.add(m);
  }
  if (particles) {
    const cupMat = stylize(new THREE.MeshStandardMaterial({ color: 0xf4f7fb, roughness: 0.4, metalness: 0.05 }));
    const juice = stylize(new THREE.MeshStandardMaterial({ color: 0xe25b4a, roughness: 0.35, metalness: 0.02 }));
    for (const z of [2.4, 6.1]) {
      const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.04, 0.12, 8), cupMat);
      cup.position.set(z % 2 ? 0.45 : -0.4, 0.05, z); cup.rotation.z = 1.2; spill.add(cup);
      const blob = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), juice);
      blob.scale.set(1.4, 0.35, 1); blob.position.set(cup.position.x, 0.03, z + 0.12); spill.add(blob);
    }
  }
  spill.visible = false;
  plane.add(spill);

  const smokeMat = [];
  const smoke = new THREE.Group();
  smoke.position.set(1.55, 1.35, 10.2);
  for (let i = 0; i < (particles ? 5 : 2); i++) {
    const mat = new THREE.MeshBasicMaterial({ color: i % 2 ? 0x4a403c : 0x6a625c, transparent: true, opacity: 0, depthWrite: false });
    smokeMat.push(mat);
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 6), mat);
    m.userData.i = i; smoke.add(m);
  }
  plane.add(smoke);

  const sparks = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ color: 0xffd27a, size: 0.06, transparent: true, depthWrite: false }));
  const sparkN = particles ? 36 : 0;
  const sparkA = new Float32Array(Math.max(3, sparkN * 3));
  sparks.geometry.setAttribute('position', new THREE.BufferAttribute(sparkA, 3));
  sparks.position.set(6.6, -1.5, -1.2); sparks.visible = false; sparks.frustumCulled = false;
  if (sparkN) plane.add(sparks);

  function makePool(n, geo, matFn) {
    const items = [];
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(geo, matFn(i));
      m.visible = false; m.userData.life = 0; m.frustumCulled = false;
      plane.add(m); items.push(m);
    }
    return items;
  }
  const featherGeo = new THREE.PlaneGeometry(0.16, 0.05);
  const feathers = particles ? makePool(20, featherGeo, (i) => new THREE.MeshBasicMaterial({ color: FEATHER[i % FEATHER.length], side: THREE.DoubleSide, transparent: true, depthWrite: false })) : [];
  const confGeo = new THREE.PlaneGeometry(0.08, 0.14);
  const CONF = [0x19d3c5, 0x0a1f5c, 0xf5c542, 0xff5a6e, 0xf7f4ee];
  const confetti = particles ? makePool(48, confGeo, (i) => new THREE.MeshBasicMaterial({ color: CONF[i % CONF.length], side: THREE.DoubleSide, transparent: true, depthWrite: false })) : [];

  const boltMat = new THREE.LineBasicMaterial({ color: 0xf4f8ff });
  boltMat.toneMapped = false;
  const bolt = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, -1, 0)]), boltMat);
  bolt.visible = false; bolt.frustumCulled = false; scene.add(bolt);

  let crackAmt = 0, birdCool = 8, struck = false;
  const tmp = new THREE.Vector3();

  function launch(list, origin, spread, life, speed) {
    for (const m of list) {
      if (m.userData.life > 0) continue;
      m.visible = true; m.userData.life = life * (0.6 + Math.random() * 0.5);
      m.position.set(origin[0] + (Math.random() - 0.5) * spread, origin[1] + Math.random() * 0.3, origin[2] + (Math.random() - 0.5) * spread);
      m.userData.v = new THREE.Vector3((Math.random() - 0.5) * speed, Math.random() * speed * 0.8, (Math.random() - 0.5) * speed);
      m.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
      return true;
    }
    return false;
  }
  function bird() {
    crackAmt = 1; struck = true; birdCool = 45;
    crack.visible = true;
    for (let i = 0; i < feathers.length; i++) launch(feathers, [-0.2, 1.7, -15.6], 0.4, 2.4, 3.5);
  }
  function celebrate() {
    for (let i = 0; i < confetti.length; i++) launch(confetti, [0, 2.15, 1], 1.2, 2.8, 2.2);
  }
  function stepList(list, dt, grav) {
    for (const m of list) {
      if (m.userData.life <= 0) continue;
      m.userData.life -= dt;
      if (m.userData.life <= 0) { m.visible = false; continue; }
      m.userData.v.y -= grav * dt;
      m.position.addScaledVector(m.userData.v, dt);
      m.rotation.x += dt * 4; m.rotation.z += dt * 3;
      if (m.material) m.material.opacity = Math.min(1, m.userData.life);
    }
  }

  return {
    get crack() { return crackAmt; },
    bird, celebrate,
    update(dt, s) {
      struck = false;
      contact.visible = !!s.onGround;
      const cockpitView = camera.position.z < -12.2 && Math.abs(camera.position.x) < 2.3 && camera.position.y > 0.4 && camera.position.y < 2.4;
      rainGlass.visible = !!(s.wet && cockpitView);
      if (rainGlass.visible) rainTex.offset.y = (rainTex.offset.y + dt * 1.6) % 1;
      rainMat.opacity = 0.55;
      if (s.storm && s.flying && particles) {
        birdCool -= dt;
        if (birdCool <= 0 && Math.random() < dt * 0.08) bird();
      }
      crackAmt = Math.max(0, crackAmt - dt * 0.07);
      crackMat.opacity = cockpitView ? crackAmt * 0.9 : 0;
      crack.visible = crackMat.opacity > 0.02;
      spill.visible = !!s.spill;
      smoke.visible = !!s.fire;
      if (s.fire) {
        const now = performance.now() / 1000;
        smoke.children.forEach((m, i) => {
          const t = (now * 0.55 + i * 0.33) % 1.5;
          m.position.set((i - 2) * 0.08, t * 1.3, (i % 2) * 0.06);
          m.scale.setScalar(0.35 + t * 1.1);
          m.material.opacity = 0.5 * (1 - t / 1.5);
        });
      }
      sparks.visible = !!(s.warn && sparkN);
      if (sparks.visible) {
        for (let i = 0; i < sparkN; i++) {
          sparkA[i * 3] = (Math.random() - 0.5) * 0.8;
          sparkA[i * 3 + 1] = Math.random() * 0.7;
          sparkA[i * 3 + 2] = (Math.random() - 0.5) * 0.5;
        }
        sparks.geometry.attributes.position.needsUpdate = true;
      }
      stepList(feathers, dt, 1.2);
      stepList(confetti, dt, 2.4);
      if (s.flash) {
        if (!bolt.visible) {
          const pts = [];
          plane.getWorldPosition(tmp);
          let x = tmp.x + (Math.random() - 0.5) * 120, y = tmp.y + 180 + Math.random() * 80, z = tmp.z - 40 - Math.random() * 80;
          for (let i = 0; i < 7; i++) { pts.push(new THREE.Vector3(x, y, z)); x += (Math.random() - 0.5) * 28; y -= 28 + Math.random() * 18; z += (Math.random() - 0.5) * 16; }
          bolt.geometry.dispose();
          bolt.geometry = new THREE.BufferGeometry().setFromPoints(pts);
          bolt.visible = true;
        }
      } else bolt.visible = false;
      return { bird: struck };
    },
  };
}
