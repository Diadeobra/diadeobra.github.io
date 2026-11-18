// Cenas 3D do site da Dia de Obra · three.js 0.170.0 (a mesma versão do tour da obra)
//  1. Topo: as fotos das casas flutuando em profundidade; paralaxe pelo mouse ou giroscópio e,
//     com a rolagem, cada foto se afasta numa velocidade própria (camadas). As fotos nunca ficam
//     atrás do texto: a cena mede onde o texto está e usa só a área livre.
//  2. Obras: carrossel em anel, arrastável, com reflexo no chão; gira um pouco ao entrar na tela.
//  3. Como trabalhamos: uma casa minimalista se montando do zero, contínua com a rolagem nos dois
//     sentidos (projeto → pré-obra → obra → entrega), com a câmera em órbita suave.
// Tudo roda no laço único do site (assets/mola.js) e lê o progresso já suavizado da rolagem
// (assets/rolagem.js); dentro do laço não há getBoundingClientRect. Movimento por molas físicas.
// Com prefers-reduced-motion: quadros parados. Leve no celular: cada cena só desenha quando está
// na tela e algo mudou; densidade de pixels até 2 (1,5 em aparelhos modestos); fotos de 600 px no
// topo e no carrossel do celular; carrossel e casa só são criados quando a pessoa chega perto.

import * as THREE from 'three';

// Vêm do site.js em iniciar(): molas, laço único e estado da rolagem.
let Mola;
let MOLAS;
let tarefa;
let acordaGlobal;
let estado;

const { clamp, lerp, smoothstep, degToRad } = THREE.MathUtils;
const VOLTA = Math.PI * 2;
const embrulha = (a) => a - VOLTA * Math.floor((a + Math.PI) / VOLTA); // (-π, π]
const modesto = (navigator.hardwareConcurrency || 8) <= 4 || (navigator.deviceMemory || 8) <= 4;
const DPR = Math.min(window.devicePixelRatio || 1, modesto ? 1.5 : 2);
const CREME = 0xfbf1dc;
const ESCURO = 0x171815;
const VERMELHO = 0xe00000;

/* ───────────── infraestrutura: as cenas rodam dentro do laço único ───────────── */
const cenas = [];
let falhou = () => {};
let ligado = false;
const acordar = () => acordaGlobal?.();

function ligarLaco() {
  if (ligado) return;
  ligado = true;
  tarefa((dt, t) => {
    let segue = false;
    for (const c of cenas) {
      if (!c.visivel || c.perdida) continue;
      let mexe = false;
      try {
        mexe = c.atualizar(dt, t);
        if (mexe || c.sujo) {
          c.renderer.render(c.scene, c.camera);
          c.sujo = false;
        }
      } catch (e) {
        c.perdida = true;
        falhou(c.nome, e);
      }
      if (mexe) segue = true;
    }
    return segue;
  });
}

function criarCena(nome, el, { fov = 35, longe = 100 } = {}) {
  const canvas = el.querySelector('canvas');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: DPR < 2, alpha: true, powerPreference: 'default' });
  renderer.setPixelRatio(DPR);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const c = {
    nome, el, renderer,
    scene: new THREE.Scene(),
    camera: new THREE.PerspectiveCamera(fov, 1, 0.1, longe),
    visivel: false, sujo: true, perdida: false, w: 1, h: 1,
    atualizar: () => false,
    aoMedir: null,
  };
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    c.perdida = true;
    falhou(nome, new Error('contexto WebGL perdido'));
  });
  const medir = () => {
    const r = el.getBoundingClientRect(); // só ao redimensionar
    c.w = Math.max(1, Math.round(r.width));
    c.h = Math.max(1, Math.round(r.height));
    renderer.setSize(c.w, c.h, false);
    c.camera.aspect = c.w / c.h;
    c.camera.updateProjectionMatrix();
    c.aoMedir?.();
    c.sujo = true;
    acordar();
  };
  new ResizeObserver(medir).observe(el);
  medir();
  // pausa a cena fora da tela
  new IntersectionObserver(([e]) => {
    c.visivel = e.isIntersecting;
    if (c.visivel) {
      c.sujo = true;
      acordar();
    }
  }).observe(el);
  cenas.push(c);
  ligarLaco();
  return c;
}

function quandoPerto(el, fn) {
  const io = new IntersectionObserver(([e]) => {
    if (e.isIntersecting) {
      io.disconnect();
      fn();
    }
  }, { rootMargin: '120% 0px' });
  io.observe(el);
}

const texturas = new Map();
function textura(url) {
  if (!texturas.has(url)) {
    const carrega = (tentativa) => new Promise((ok, erro) => {
      new THREE.TextureLoader().load(url, (t) => {
        t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = 4;
        ok(t);
      }, undefined, (e) => {
        if (tentativa < 2) setTimeout(() => carrega(tentativa + 1).then(ok, erro), 500 * (tentativa + 1));
        else erro(e);
      });
    });
    texturas.set(url, carrega(0));
  }
  return texturas.get(url);
}

/* ───────────── foto em painel: cantos arredondados, corte "cover", paralaxe no recorte ───────────── */
const VERT = /* glsl */ `
varying vec2 vUv;
#include <fog_pars_vertex>
void main() {
  vUv = uv;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const FRAG = /* glsl */ `
uniform sampler2D map;
uniform vec4 uvRect;   // corte "cover": escala (xy) e deslocamento (zw)
uniform float zoom;    // aproxima a foto para sobrar margem para a paralaxe
uniform vec2 paralaxe; // -1 a 1: desloca a foto dentro do recorte
uniform vec2 tam;
uniform float raio;
uniform float opacidade;
uniform vec3 corVeu;
uniform float veu;
uniform float reflexo;
varying vec2 vUv;
#include <fog_pars_fragment>
float caixa(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}
void main() {
  vec2 p = (vUv - 0.5) * tam;
  float d = caixa(p, tam * 0.5, raio);
  float aa = max(fwidth(d), 1e-4);
  float a = 1.0 - smoothstep(-aa, aa, d);
  vec2 centro = uvRect.zw + uvRect.xy * 0.5;
  vec2 uv = centro + (vUv - 0.5) * uvRect.xy / zoom + paralaxe * uvRect.xy * (1.0 - 1.0 / zoom) * 0.5;
  vec3 cor = texture2D(map, uv).rgb;
  cor = mix(cor, corVeu, veu);
  float alfa = a * opacidade;
  if (reflexo > 0.0) alfa *= reflexo * pow(1.0 - vUv.y, 2.4);
  gl_FragColor = vec4(cor, alfa);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

function materialFoto(tex, asp, { foco = [0.5, 0.5], raio = 0.035, neblina = true, reflexo = 0, zoom = 1.12 } = {}) {
  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
    uvRect: { value: new THREE.Vector4(1, 1, 0, 0) },
    zoom: { value: zoom },
    paralaxe: { value: new THREE.Vector2(0, 0) },
    tam: { value: new THREE.Vector2(asp, 1) },
    raio: { value: raio },
    opacidade: { value: 1 },
    corVeu: { value: new THREE.Color(0xffffff) },
    veu: { value: 0 },
    reflexo: { value: reflexo },
  }]);
  uniforms.map = { value: tex }; // fora do merge, para não clonar a textura
  const ai = tex.image.width / tex.image.height;
  let sx = 1;
  let sy = 1;
  if (ai > asp) sx = asp / ai;
  else sy = ai / asp;
  uniforms.uvRect.value.set(sx, sy, (1 - sx) * foco[0], (1 - sy) * (1 - foco[1]));
  return new THREE.ShaderMaterial({
    uniforms, vertexShader: VERT, fragmentShader: FRAG,
    transparent: true, fog: neblina, depthWrite: !reflexo,
  });
}

function texturaSombra() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.shadowColor = 'rgba(40,0,0,1)';
  g.shadowBlur = 20;
  g.shadowOffsetX = 1000;
  g.fillStyle = '#000';
  g.beginPath();
  g.roundRect(24 - 1000, 24, 80, 80, 6);
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/* ═════════════ 1. TOPO: fotos flutuando em profundidade ═════════════ */
// Cada foto: [a, b, z, s, giroY, giroZ, velocidade]. a e b vão de 0 a 1 dentro da área livre
// (fora do texto); s é a altura da foto como fração da altura dessa área; velocidade é o quanto a
// foto sobe com a rolagem (camadas). "lado" = tela deitada (texto à esquerda), "baixo" = tela em pé.
const HERO = {
  lado: [
    [0.34, 0.47, 0.0, 0.52, -0.16, 0.015, 1.0],
    [0.80, 0.83, 1.4, 0.24, -0.24, -0.02, 1.5],
    [0.86, 0.22, -2.5, 0.36, -0.28, 0.025, 0.7],
    [0.13, 0.86, -1.5, 0.25, -0.08, -0.03, 1.25],
    [0.55, 0.08, -7.0, 0.24, 0.06, 0.02, 0.45],
    [1.02, 0.55, -5.0, 0.38, -0.34, 0.0, 0.6],
    [0.45, 0.97, -10.0, 0.22, 0.12, -0.02, 0.35],
  ],
  baixo: [
    [0.50, 0.52, 0.0, 0.62, -0.10, 0.015, 1.0],
    [0.22, 0.88, 1.0, 0.25, 0.16, -0.02, 1.5],
    [0.84, 0.28, -2.0, 0.50, -0.25, 0.02, 0.7],
    [0.17, 0.32, -2.6, 0.48, 0.22, -0.025, 0.75],
    [0.81, 0.86, -1.2, 0.35, -0.20, 0.02, 1.25],
    [0.40, 0.16, -12.0, 0.30, 0.05, 0.0, 0.4],
    [0.65, 0.95, -14.0, 0.30, -0.10, 0.0, 0.35],
  ],
};

function criarHero(cfg, casas, foto, calmo) {
  const c = criarCena('hero', cfg.el, { fov: 35, longe: 80 });
  const { scene, camera } = c;
  const CAM_Z = 10;
  camera.position.set(0, 0, CAM_Z);
  scene.fog = new THREE.Fog(0xa50000, 11, 30);
  const geo = new THREE.PlaneGeometry(1, 1);
  const sombraTex = texturaSombra();
  const paineis = [];
  const malhas = [];
  const camX = new Mola(0, MOLAS.camera, 1e-4);
  const camY = new Mola(0, MOLAS.camera, 1e-4);
  let regiao = null;
  let sobre = -1;

  // Área livre para as fotos (px no canvas), medida fora do laço: ao redimensionar e quando as
  // fontes chegam. Usa offset* (sem transform), então o texto subindo na rolagem não atrapalha.
  function medirTexto() {
    const t = cfg.texto;
    let direita = 0;
    let baixo = 0;
    for (const f of t.children) {
      direita = Math.max(direita, t.offsetLeft + f.offsetLeft + f.offsetWidth);
      baixo = Math.max(baixo, t.offsetTop + f.offsetTop + f.offsetHeight);
    }
    const empilhado = matchMedia('(max-aspect-ratio: 11/10)').matches; // o mesmo corte do CSS
    regiao = empilhado
      ? { modo: 'baixo', x0: 0, y0: baixo + 28, x1: c.w, y1: c.h }
      : { modo: 'lado', x0: direita + 64, y0: 80, x1: c.w * 1.03, y1: c.h - 8 };
  }
  function posicionar() {
    medirTexto();
    const tabela = regiao.modo === 'baixo' ? HERO.baixo : HERO.lado;
    camera.fov = regiao.modo === 'baixo' ? 44 : 35;
    camera.updateProjectionMatrix();
    const tg = Math.tan(degToRad(camera.fov / 2));
    const RW = Math.max(1, regiao.x1 - regiao.x0);
    const RH = Math.max(1, regiao.y1 - regiao.y0);
    for (const p of paineis) {
      const [a, b, z, s, ry, rz, vel] = tabela[p.i % tabela.length];
      const meiaA = tg * (CAM_Z - z);
      const meiaL = meiaA * camera.aspect;
      const alt = s * RH;
      const larg = alt * p.asp;
      let cx = regiao.x0 + a * RW;
      let cy = regiao.y0 + b * RH;
      if (regiao.modo === 'lado') cx = Math.max(cx, regiao.x0 + larg / 2); // nunca entra no texto
      else cy = Math.max(cy, regiao.y0 + alt / 2);
      p.base = { x: ((cx / c.w) * 2 - 1) * meiaL, y: (1 - (cy / c.h) * 2) * meiaA, z, h: (alt / c.h) * 2 * meiaA };
      p.ry = ry;
      p.rz = rz;
      p.vel = vel;
    }
    c.sujo = true;
  }
  c.aoMedir = () => { if (paineis.length) posicionar(); };
  new ResizeObserver(() => { if (paineis.length) { posicionar(); acordar(); } }).observe(cfg.texto);
  document.fonts?.ready.then(() => { if (paineis.length) { posicionar(); acordar(); } });

  casas.forEach((casa, i) => {
    textura(foto(casa.fotos[0], 600)).then((tex) => {
      const asp = clamp(tex.image.width / tex.image.height, 0.68, 1.35);
      const mat = materialFoto(tex, asp, { foco: casa.foco, raio: 0.04 });
      const malha = new THREE.Mesh(geo, mat);
      malha.scale.set(asp, 1, 1);
      malha.userData.i = i;
      const sombra = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: sombraTex, transparent: true, opacity: 0, depthWrite: false }));
      sombra.scale.set(asp * 1.62, 1.62, 1);
      sombra.position.set(0.035, -0.07, -0.03);
      const grupo = new THREE.Group();
      grupo.add(sombra, malha);
      scene.add(grupo);
      const p = { i, asp, grupo, malha, sombra, mat, entra: new Mola(0, MOLAS.entrada, 1e-3), ergue: new Mola(0, MOLAS.toque, 1e-3), base: null, ry: 0, rz: 0, vel: 1 };
      paineis.push(p);
      malhas.push(malha);
      posicionar();
      if (calmo) p.entra.pula(1);
      else setTimeout(() => { p.entra.alvo = 1; acordar(); }, 120 + i * 110);
      acordar();
    }).catch((e) => console.warn('[Dia de Obra] foto não carregou no topo', e));
  });

  c.atualizar = (dt, t) => {
    let mexe = !calmo; // a flutuação mantém o topo vivo enquanto ele aparece
    if (camX.passo(dt)) mexe = true;
    if (camY.passo(dt)) mexe = true;
    const r = calmo ? 0 : estado.heroP; // já suavizado pela mola da rolagem
    for (const p of paineis) {
      p.entra.passo(dt);
      p.ergue.passo(dt);
      const e = p.entra.x;
      const b = p.base;
      const f = calmo ? 0 : Math.sin(t * 0.55 + p.i * 1.9);
      // camadas: cada foto sobe e se aproxima ou se afasta na sua velocidade
      p.grupo.position.set(b.x, b.y + f * 0.045 * b.h + r * p.vel * 2.4, b.z - (1 - e) * 16 + p.ergue.x * 0.45 + r * (p.vel - 0.8) * 3);
      p.grupo.scale.setScalar(b.h * (1 + p.ergue.x * 0.035));
      p.grupo.rotation.set(0, p.ry + (1 - e) * 0.5, p.rz + (calmo ? 0 : Math.sin(t * 0.4 + p.i) * 0.012));
      const o = clamp(e * 1.25, 0, 1);
      p.mat.uniforms.opacidade.value = o;
      p.mat.uniforms.paralaxe.value.set(0, (r * 2 - 1) * 0.9); // a foto desliza dentro do recorte
      p.sombra.material.opacity = 0.42 * o;
    }
    camera.position.set(camX.x * 0.5, camY.x * 0.3 - r * 0.6, CAM_Z - r * 3.5);
    camera.lookAt(camX.x * 0.15, camY.x * 0.1 - r * 0.45, 0);
    return mexe;
  };

  if (calmo) return; // quadro parado: sem paralaxe e sem passar o mouse

  // paralaxe pelo mouse + foto que "levanta" sob o cursor (o raio só roda no evento do ponteiro)
  const raio = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const tocada = (x, y) => {
    const r = cfg.el.getBoundingClientRect();
    ndc.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
    raio.setFromCamera(ndc, camera);
    const hit = raio.intersectObjects(malhas.filter((m) => m.material.uniforms.opacidade.value > 0.6))[0];
    return hit ? hit.object.userData.i : -1;
  };
  addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse' || !c.visivel) return;
    camX.alvo = (e.clientX / innerWidth) * 2 - 1;
    camY.alvo = -((e.clientY / innerHeight) * 2 - 1);
    const i = tocada(e.clientX, e.clientY);
    if (i !== sobre) {
      sobre = i;
      for (const p of paineis) p.ergue.alvo = p.i === i ? 1 : 0;
      cfg.el.style.cursor = i >= 0 ? 'pointer' : '';
    }
    acordar();
  }, { passive: true });
  // giroscópio: só onde não precisa pedir permissão (no iPhone exigiria um aviso do sistema)
  if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission !== 'function' && matchMedia('(pointer: coarse)').matches) {
    addEventListener('deviceorientation', (e) => {
      if (e.gamma == null || !c.visivel) return;
      camX.alvo = clamp(e.gamma / 22, -1, 1);
      camY.alvo = clamp((e.beta - 50) / -22, -1, 1);
      acordar();
    });
  }
  // tocar numa foto leva à casa no carrossel
  let inicio = null;
  cfg.el.addEventListener('pointerdown', (e) => { inicio = { x: e.clientX, y: e.clientY }; });
  cfg.el.addEventListener('pointerup', (e) => {
    if (!inicio || Math.hypot(e.clientX - inicio.x, e.clientY - inicio.y) > 8) return;
    inicio = null;
    const i = tocada(e.clientX, e.clientY);
    if (i >= 0) cfg.aoEscolher(i);
  });
}

/* ═════════════ 2. OBRAS: carrossel em anel ═════════════ */
async function criarCarrossel(cfg, casas, foto, calmo) {
  const palco = cfg.el.querySelector('.palco');
  const c = criarCena('carrossel', palco, { fov: 30, longe: 60 });
  const { scene, camera } = c;
  const tam = innerWidth < 700 ? 600 : 900;
  const texs = await Promise.all(casas.map((k) => textura(foto(k.fotos[0], tam))));
  const H = 1;
  const FOLGA = 0.24;
  const n = casas.length;
  const larg = texs.map((t) => H * clamp(t.image.width / t.image.height, 0.68, 1.35));
  const R = Math.max(1.1, (larg.reduce((a, b) => a + b, 0) + n * FOLGA) / VOLTA);
  const alfa = larg.map((w) => 2 * Math.asin(Math.min(1, w / (2 * R))));
  const sobra = (VOLTA - alfa.reduce((a, b) => a + b, 0)) / n;
  const ang = [];
  for (let i = 0, a = 0; i < n; i++) {
    if (i) a += alfa[i - 1] / 2 + sobra + alfa[i] / 2;
    ang.push(a);
  }
  const anel = new THREE.Group();
  scene.add(anel);
  const geo = new THREE.PlaneGeometry(1, 1);
  const fundo = new THREE.Color(CREME);
  const itens = casas.map((casa, i) => {
    const asp = larg[i] / H;
    const mat = materialFoto(texs[i], asp, { foco: casa.foco, raio: 0.03, neblina: false });
    const ref = materialFoto(texs[i], asp, { foco: casa.foco, raio: 0.03, neblina: false, reflexo: 0.2 });
    mat.uniforms.corVeu.value.copy(fundo);
    ref.uniforms.corVeu.value.copy(fundo);
    const quadro = new THREE.Mesh(geo, mat);
    quadro.scale.set(larg[i], H, 1);
    quadro.position.z = R;
    quadro.userData.i = i;
    const reflexo = new THREE.Mesh(geo, ref);
    reflexo.scale.set(larg[i], -H, 1);
    reflexo.position.set(0, -H - 0.025, R);
    const piv = new THREE.Group();
    piv.rotation.y = ang[i];
    piv.add(quadro, reflexo);
    anel.add(piv);
    return { i, mat, ref, quadro, ang: ang[i], w: larg[i] };
  });
  const quadros = itens.map((it) => it.quadro);

  const th = new Mola(0, MOLAS.carrossel, 1e-4);
  const dist = new Mola(0, { response: 0.6, dampingFraction: 0.9 }, 1e-3);
  const indice = (a) => {
    let m = 0;
    let md = Infinity;
    for (const it of itens) {
      const d = Math.abs(embrulha(a - it.ang));
      if (d < md) { md = d; m = it.i; }
    }
    return m;
  };
  const maisPerto = (a) => a - embrulha(a - itens[indice(a)].ang);
  const alvoPara = (i) => th.alvo + embrulha(itens[i].ang - th.alvo);
  const distPara = (i) => {
    const tg = Math.tan(degToRad(camera.fov / 2));
    const largura = c.w < 700 ? 0.64 : 0.76; // no celular, as vizinhas aparecem nas bordas
    return Math.max((H / 0.7) / (2 * tg), (itens[i].w / largura) / (2 * tg * camera.aspect));
  };
  const radPorPx = () => ((2 * dist.x * Math.tan(degToRad(camera.fov / 2))) / c.h) / R;
  let atual = -1;
  let arrasto = null;
  let entradaAnt = -1;

  c.aoMedir = () => {
    // a legenda de vidro cobre a parte de baixo: a cena sobe 7% (deslocamento de lente, sem distorcer)
    camera.setViewOffset(c.w, c.h, 0, Math.round(c.h * 0.07), c.w, c.h);
    dist.alvo = distPara(Math.max(0, atual));
    if (dist.x === 0) dist.pula(dist.alvo);
  };
  c.aoMedir();

  c.atualizar = (dt) => {
    let mexe = th.passo(dt);
    const i = indice(th.x);
    if (i !== atual) {
      atual = i;
      dist.alvo = distPara(i);
      cfg.aoMudar(i);
    }
    if (dist.passo(dt)) mexe = true;
    // ao entrar na seção, o anel ainda está girado e chega ao lugar junto com a rolagem
    const entrada = calmo ? 1 : estado.obrasP;
    if (Math.abs(entrada - entradaAnt) > 1e-4) { entradaAnt = entrada; mexe = true; }
    const giro = (1 - entrada) * 0.85;
    anel.rotation.y = -(th.x + giro);
    const desliza = (0.5 - entrada) * 1.2;
    for (const it of itens) {
      const v = smoothstep(Math.abs(embrulha(th.x + giro - it.ang)), 0.35, 2.2) * 0.72;
      it.mat.uniforms.veu.value = v;
      it.ref.uniforms.veu.value = v;
      it.mat.uniforms.paralaxe.value.set(0, desliza);
      it.ref.uniforms.paralaxe.value.set(0, desliza);
    }
    camera.position.set(0, 0.1, R + dist.x);
    camera.lookAt(0, -0.14, R);
    return mexe;
  };

  // arrastar: o anel segue o dedo; ao soltar, a mola parte da velocidade do gesto
  const raio = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const tocado = (x, y) => {
    const r = palco.getBoundingClientRect();
    ndc.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
    scene.updateMatrixWorld();
    raio.setFromCamera(ndc, camera);
    const hit = raio.intersectObjects(quadros)[0];
    return hit ? hit.object.userData.i : -1;
  };
  palco.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    arrasto = { id: e.pointerId, x0: e.clientX, y0: e.clientY, th0: th.x, ativo: false, amostras: [[e.timeStamp, e.clientX]] };
  });
  palco.addEventListener('pointermove', (e) => {
    if (!arrasto || e.pointerId !== arrasto.id) {
      if (e.pointerType === 'mouse') palco.classList.toggle('sobre-foto', tocado(e.clientX, e.clientY) >= 0);
      return;
    }
    const dx = e.clientX - arrasto.x0;
    const dy = e.clientY - arrasto.y0;
    if (!arrasto.ativo) {
      if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy) * 1.2) {
        arrasto.ativo = true;
        palco.setPointerCapture(e.pointerId);
        palco.classList.add('arrastando');
      } else {
        if (Math.abs(dy) > 12) arrasto = null; // gesto vertical: é rolagem da página
        return;
      }
    }
    const a = arrasto.th0 - dx * radPorPx();
    th.x = th.alvo = a;
    th.v = 0;
    arrasto.amostras.push([e.timeStamp, e.clientX]);
    if (arrasto.amostras.length > 6) arrasto.amostras.shift();
    c.sujo = true;
    acordar();
  });
  const soltar = (e, cancelado) => {
    if (!arrasto || e.pointerId !== arrasto.id) return;
    const g = arrasto;
    arrasto = null;
    palco.classList.remove('arrastando');
    if (g.ativo) {
      const [t0, x0] = g.amostras[0];
      const [t1, x1] = g.amostras[g.amostras.length - 1];
      const vpx = t1 > t0 ? (x1 - x0) / ((t1 - t0) / 1000) : 0;
      const v = clamp(-vpx * radPorPx(), -8, 8);
      th.v = v;
      th.alvo = maisPerto(th.x + v * 0.12); // o impulso leva no máximo cerca de uma casa a mais
    } else if (!cancelado) {
      const i = tocado(e.clientX, e.clientY);
      if (i === atual) cfg.aoAbrir(i);
      else if (i >= 0) th.alvo = alvoPara(i);
    }
    acordar();
  };
  palco.addEventListener('pointerup', (e) => soltar(e, false));
  palco.addEventListener('pointercancel', (e) => soltar(e, true));
  // trackpad deslizando para o lado (a rolagem vertical continua sendo da página)
  let espera = 0;
  palco.addEventListener('wheel', (e) => {
    if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
    e.preventDefault();
    th.x = th.alvo = th.x + e.deltaX * radPorPx();
    th.v = 0;
    clearTimeout(espera);
    espera = setTimeout(() => { th.alvo = maisPerto(th.x); acordar(); }, 140);
    c.sujo = true;
    acordar();
  }, { passive: false });

  cfg.aoPronto({
    ir(i, imediato) {
      const a = alvoPara(i);
      if (imediato) th.pula(a);
      else th.alvo = a;
      c.sujo = true;
      acordar();
    },
  });
}

/* ═════════════ 3. COMO TRABALHAMOS: a casa se montando do zero ═════════════ */
function criarProcesso(cfg, calmo, logoUrl) {
  const c = criarCena('processo', cfg.el, { fov: 30, longe: 240 });
  const { scene, camera } = c;
  scene.fog = new THREE.Fog(ESCURO, 42, 110);
  scene.add(new THREE.HemisphereLight(0xfff6e8, 0x2b2621, 2.0));
  const sol = new THREE.DirectionalLight(0xfff2de, 2.6);
  sol.position.set(-6, 12, 16);
  scene.add(sol);
  const preenche = new THREE.DirectionalLight(0xe8eeff, 0.6);
  preenche.position.set(12, 5, 3);
  scene.add(preenche);

  const L = (cor, extra = {}) => new THREE.MeshLambertMaterial({ color: cor, ...extra });
  const mat = {
    lote: new THREE.MeshBasicMaterial({ color: 0x201f1b, transparent: true, opacity: 0, depthWrite: false }),
    parede: L(0xf2eadd),
    concreto: L(0xbab3a7),
    radier: L(0x8e887d),
    pilar: L(0xa59f93),
    madeira: L(0x9d5b2c),
    porta: L(0x6e3b1d),
    vidro: L(0x1f262c, { emissive: 0xffb45c, emissiveIntensity: 0 }),
    spot: L(0x3a3833, { emissive: 0xffd9a0, emissiveIntensity: 0 }),
    grama: L(0x4d6b3a),
    copa: L(0x5c7c44, { flatShading: true }),
    arbusto: L(0x4f7340, { flatShading: true }),
    tronco: L(0x6a4d33),
    piso: L(0x8f8a82),
    calcada: L(0xbdb6aa),
    estaca: L(0xd9d0c0),
    poste: L(0x4a433b),
    placaLado: L(VERMELHO),
    bandeira: new THREE.MeshBasicMaterial({ color: VERMELHO, side: THREE.DoubleSide }),
  };

  // Peças: cada uma aparece numa janela do progresso (0 a 4) e o valor é contínuo, nos dois
  // sentidos (rolar para cima desmonta). A mola só suaviza o caminho; não há degrau entre etapas.
  const pecas = [];
  const apagar = new Mola(1, MOLAS.linha, 1e-3); // traços do projeto somem na entrega
  function peca(obj, limiar, modo, extra = {}) {
    const p = {
      obj, limiar, modo,
      ate: extra.ate ?? Infinity,
      jan: extra.jan ?? (modo === 'traco' || modo === 'linha' ? 0.16 : modo === 'luz' ? 0.2 : 0.12),
      max: extra.max ?? 1,
      total: extra.total ?? 1,
      projeto: extra.projeto ?? false,
      base: obj.position.clone(),
      mola: new Mola(0, modo === 'traco' || modo === 'linha' ? MOLAS.linha : MOLAS.peca, 1e-3),
    };
    pecas.push(p);
    aplicar(p);
    return p;
  }
  function aplicar(p) {
    const a = p.mola.x;
    const o = p.obj;
    switch (p.modo) {
      case 'sobe': o.scale.y = Math.max(a, 1e-3); o.visible = a > 0.002; break;
      case 'cai': o.position.y = p.base.y + (1 - a) * 6; o.visible = a > 0.002; break;
      case 'brota': o.scale.setScalar(Math.max(a, 1e-3)); o.visible = a > 0.002; break;
      case 'emerge': o.position.y = p.base.y - (1 - a) * 0.7; o.visible = a > 0.002; break;
      case 'linha': o.material.opacity = a * p.max; o.visible = a > 0.002; break;
      case 'traco':
        o.material.dashSize = Math.max(a, 0) * p.total;
        o.material.opacity = p.max * (p.projeto ? apagar.x : 1);
        o.visible = a > 0.002 && o.material.opacity > 0.002;
        break;
      case 'luz': o.material.emissiveIntensity = Math.max(a, 0) * p.max; break;
    }
  }
  const alvoDe = (q, p) => {
    const entra = clamp((p - q.limiar) / q.jan, 0, 1);
    const sai = q.ate === Infinity ? 1 : 1 - clamp((p - q.ate) / q.jan, 0, 1);
    return entra * sai;
  };
  function caixa(w, h, d, m, x, y, z) { // base apoiada em y
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate(0, h / 2, 0);
    const malha = new THREE.Mesh(g, m);
    malha.position.set(x, y, z);
    scene.add(malha);
    return malha;
  }
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const retangulo = (x0, z0, x1, z1, y = 0.012) => [V(x0, y, z0), V(x1, y, z0), V(x1, y, z0), V(x1, y, z1), V(x1, y, z1), V(x0, y, z1), V(x0, y, z1), V(x0, y, z0)];
  const arestas = (w, h, d, x, y, z) => {
    const g = new THREE.EdgesGeometry(new THREE.BoxGeometry(w, h, d));
    g.translate(x, y + h / 2, z);
    const a = g.getAttribute('position');
    const pts = [];
    for (let i = 0; i < a.count; i++) pts.push(V(a.getX(i), a.getY(i), a.getZ(i)));
    return pts;
  };
  function traco(pontos, limiar, extra = {}) {
    const g = new THREE.BufferGeometry().setFromPoints(pontos);
    const m = new THREE.LineDashedMaterial({ color: CREME, dashSize: 0, gapSize: 1e4, transparent: true, opacity: 0, depthWrite: false });
    const linha = new THREE.LineSegments(g, m);
    linha.computeLineDistances();
    const d = g.getAttribute('lineDistance');
    scene.add(linha);
    return peca(linha, limiar, 'traco', { max: 0.8, projeto: true, ...extra, total: d.getX(d.count - 1) || 1 });
  }

  // ── terreno (frente da casa em +z, lote de 18 × 18 m) ──
  const lote = new THREE.Mesh(new THREE.PlaneGeometry(18, 18), mat.lote);
  lote.rotation.x = -Math.PI / 2;
  scene.add(lote);
  const grade = new THREE.GridHelper(18, 18, CREME, CREME);
  grade.material.transparent = true;
  grade.material.opacity = 0;
  grade.material.depthWrite = false;
  grade.position.y = 0.006;
  scene.add(grade);

  // ── 01 · Projeto: lote, planta e arestas desenhadas ──
  peca(lote, 0.0, 'linha', { max: 1 });
  peca(grade, 0.02, 'linha', { max: 0.13 });
  traco(retangulo(-9, -9, 9, 9), 0.06, { max: 0.5, projeto: false });
  traco([...retangulo(-1.2, -6.2, 6.4, 2.6), ...retangulo(-6.4, -3.2, -1.2, 4.0)], 0.12);
  traco([V(2.6, 0.012, -6.2), V(2.6, 0.012, -0.8), V(-1.2, 0.012, -2.4), V(2.6, 0.012, -2.4), V(2.6, 0.012, -0.8), V(6.4, 0.012, -0.8),
    V(1.5, 0.012, 2.6), V(1.5, 0.012, 3.4), V(3.0, 0.012, 2.6), V(6.0, 0.012, 2.6)], 0.26, { max: 0.65 });
  traco(arestas(7.6, 3.0, 8.8, 2.6, 0.25, -1.8), 0.4, { max: 0.6 });
  traco([...arestas(5.3, 0.3, 7.4, -3.85, 3.25, 0.4), ...arestas(0.3, 3.0, 0.3, -6.25, 0.25, 3.85), ...arestas(0.3, 3.0, 0.3, -1.35, 0.25, 3.85)], 0.54, { max: 0.6 });
  traco([...arestas(8.0, 0.8, 9.2, 2.6, 3.25, -1.8), ...arestas(3.6, 1.3, 4.0, 2.6, 3.5, -2.6)], 0.68, { max: 0.6 });

  // ── 02 · Pré-obra: gabarito com bandeirinhas, placa da obra e radier ──
  const cantos = [[-7.4, -7.2], [7.4, -7.2], [7.4, 5.0], [-7.4, 5.0]];
  cantos.forEach(([x, z], k) => {
    const g = new THREE.Group();
    const estaca = caixa(0.09, 0.85, 0.09, mat.estaca, 0, 0, 0);
    const bandeira = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.22), mat.bandeira);
    bandeira.position.set(0.2, 0.73, 0);
    g.add(estaca, bandeira);
    g.position.set(x, 0, z);
    scene.add(g);
    peca(g, 1.02 + k * 0.05, 'brota', { ate: 2.4 });
  });
  traco([V(-7.4, 0.62, -7.2), V(7.4, 0.62, -7.2), V(7.4, 0.62, -7.2), V(7.4, 0.62, 5.0), V(7.4, 0.62, 5.0), V(-7.4, 0.62, 5.0), V(-7.4, 0.62, 5.0), V(-7.4, 0.62, -7.2)], 1.2, { max: 0.9, ate: 2.4, projeto: false });

  const placa = new THREE.Group();
  for (const x of [-1.15, 1.15]) placa.add(caixa(0.1, 2.75, 0.1, mat.poste, x, 0, -0.06));
  const faceMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const quadroPlaca = new THREE.Mesh(new THREE.BoxGeometry(2.8, 1.4, 0.06), [mat.placaLado, mat.placaLado, mat.placaLado, mat.placaLado, faceMat, mat.placaLado]);
  quadroPlaca.position.y = 2.05;
  placa.add(quadroPlaca);
  placa.position.set(-6.9, 0, 7.7);
  placa.rotation.y = 0.32;
  scene.add(placa);
  peca(placa, 1.32, 'sobe', { ate: 3.6 });
  // placa: logo oficial v2 (slogan novo) em creme sobre o vermelho, pintado no navegador
  const imgLogo = new Image();
  imgLogo.onload = () => {
    const cv = document.createElement('canvas');
    cv.width = 1024;
    cv.height = 512;
    const g = cv.getContext('2d');
    g.fillStyle = '#E00000';
    g.fillRect(0, 0, 1024, 512);
    const l = document.createElement('canvas');
    l.width = imgLogo.width;
    l.height = imgLogo.height;
    const lg = l.getContext('2d');
    lg.drawImage(imgLogo, 0, 0);
    lg.globalCompositeOperation = 'source-in';
    lg.fillStyle = '#FBF1DC';
    lg.fillRect(0, 0, l.width, l.height);
    const w = 860;
    const h = (w * imgLogo.height) / imgLogo.width;
    g.drawImage(l, (1024 - w) / 2, (512 - h) / 2, w, h);
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    faceMat.map = t;
    faceMat.needsUpdate = true;
    c.sujo = true;
    acordar();
  };
  imgLogo.src = logoUrl;

  peca(caixa(13.2, 0.25, 10.6, mat.radier, 0, 0, -1.1), 1.55, 'emerge');

  // ── 03 · Obra: pilares, paredes, lajes, platibanda ──
  const pilares = [[-1.05, -6.05], [6.25, -6.05], [-1.05, 2.45], [6.25, 2.45], [2.6, 2.45], [2.6, -6.05], [-6.25, 3.85], [-6.25, -3.05], [-1.35, 3.85]];
  pilares.forEach(([x, z], k) => peca(caixa(0.3, 3.0, 0.3, mat.pilar, x, 0.25, z), 2.02 + k * 0.03, 'sobe'));
  peca(caixa(7.6, 3.0, 8.8, mat.parede, 2.6, 0.25, -1.8), 2.32, 'sobe', { jan: 0.2 });
  const lajeGaragem = caixa(5.3, 0.3, 7.4, mat.concreto, -3.85, 3.25, 0.4);
  peca(lajeGaragem, 2.55, 'cai', { jan: 0.16 });
  peca(caixa(8.0, 0.25, 9.2, mat.concreto, 2.6, 3.25, -1.8), 2.64, 'cai', { jan: 0.16 });
  peca(caixa(3.6, 1.3, 4.0, mat.parede, 2.6, 3.5, -2.6), 2.76, 'sobe');
  [[8.0, 0.15, 2.6, 2.725], [8.0, 0.15, 2.6, -6.325], [0.15, 9.2, -1.325, -1.8], [0.15, 9.2, 6.525, -1.8]].forEach(([w, d, x, z], k) => {
    peca(caixa(w, 0.55, d, mat.parede, x, 3.5, z), 2.84 + k * 0.03, 'sobe');
  });

  // ── 04 · Entrega: ripado, porta, vidro, jardim e luzes acesas ──
  for (let k = 0; k < 12; k++) peca(caixa(0.1, 2.85, 0.1, mat.madeira, -0.95 + k * 0.2, 0.25, 2.66), 3.0 + k * 0.02, 'sobe');
  peca(caixa(1.0, 2.4, 0.08, mat.porta, 2.0, 0.25, 2.64), 3.24, 'sobe');
  const vidro = caixa(3.0, 2.1, 0.06, mat.vidro, 4.5, 0.85, 2.63);
  peca(vidro, 3.27, 'sobe');
  peca(caixa(5.2, 0.05, 4.8, mat.piso, -3.8, 0, 6.6), 3.3, 'sobe');
  peca(caixa(10.0, 0.04, 4.8, mat.grama, 3.8, 0, 6.6), 3.33, 'sobe');
  peca(caixa(18.0, 0.07, 1.6, mat.calcada, 0, 0, 9.8), 3.36, 'sobe');
  const arvore = new THREE.Group();
  arvore.add(new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.15, 1.8, 7).translate(0, 0.9, 0), mat.tronco));
  arvore.add(new THREE.Mesh(new THREE.IcosahedronGeometry(1.15, 0).translate(0, 2.55, 0), mat.copa));
  arvore.position.set(6.9, 0, 6.6);
  scene.add(arvore);
  peca(arvore, 3.4, 'brota', { jan: 0.16 });
  [[3.4, 3.35, 0.42], [4.35, 3.45, 0.5], [5.3, 3.35, 0.4], [6.15, 3.5, 0.46], [-0.2, 3.3, 0.36]].forEach(([x, z, r], k) => {
    const a = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 0), mat.arbusto);
    a.position.set(x, 0.25 + r * 0.7, z);
    scene.add(a);
    peca(a, 3.43 + k * 0.025, 'brota');
  });
  peca(vidro, 3.5, 'luz', { max: 0.95 });
  for (const z of [-1.6, 0.4, 2.4]) {
    const s = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.03, 12), mat.spot);
    s.position.set(0, -0.015, z - 0.4);
    lajeGaragem.add(s); // os spots descem junto com a laje da garagem
    peca(s, 3.55, 'luz', { max: 1.2 });
  }

  // ── câmera: órbita suave com a rolagem; começa do alto (planta) e desce enquanto a casa sobe ──
  const pCam = new Mola(0, MOLAS.camera, 1e-3);
  const px = new Mola(0, MOLAS.camera, 1e-4);
  const py = new Mola(0, MOLAS.camera, 1e-4);
  const alvoCam = new THREE.Vector3();
  function posicionarCamera() {
    const movel = estado?.movel ?? c.w / c.h < 0.9;
    // a casa fica fora dos cartões: à esquerda (58% da largura) no computador, em cima (56%) no celular
    const fx = movel ? 1 : 0.58;
    const fy = movel ? 0.56 : 1;
    camera.setViewOffset(c.w, c.h, movel ? 0 : Math.round(c.w * (1 - fx) / 2), movel ? Math.round(c.h * (1 - fy) / 2) : 0, c.w, c.h);
    const s = smoothstep(pCam.x, 0, 4);
    const s1 = smoothstep(pCam.x, 0, 3.4);
    const pol = degToRad(lerp(36, 64, s1) + py.x * 2.5);
    const az = degToRad(lerp(48, -8, s) + px.x * 4); // órbita contínua de 56° do projeto à entrega
    const meiaV = degToRad(camera.fov / 2);
    const meiaVef = Math.atan(Math.tan(meiaV) * fy);
    const meiaHef = Math.atan(Math.tan(meiaV) * camera.aspect * fx);
    const r = lerp(12.6, 9.6, s1) / Math.sin(Math.min(meiaVef, meiaHef));
    // a neblina acompanha a distância: de perto ou de longe (celular), a casa fica com o mesmo brilho
    scene.fog.near = r * 1.05;
    scene.fog.far = r * 2.6;
    alvoCam.set(0, lerp(0, 1.5, s1), lerp(0.2, -0.7, s1));
    camera.position.set(alvoCam.x + r * Math.sin(pol) * Math.sin(az), alvoCam.y + r * Math.cos(pol), alvoCam.z + r * Math.sin(pol) * Math.cos(az));
    camera.lookAt(alvoCam);
  }

  // ── planilha 3D (página Como funciona): uma barra por etapa, na frente do lote. A barra clara é o
  //    teto que a planilha deu para a etapa; a vermelha é o executado, que cresce com a obra e nunca
  //    passa do teto. Quando a casa fica pronta, as barras afundam: a planilha virou a casa.
  const barras = [];
  if (cfg.barras) {
    const tetoMat = new THREE.MeshLambertMaterial({ color: CREME, transparent: true, opacity: 0.38, depthWrite: false });
    const feitoMat = L(VERMELHO);
    [1.2, 2.4, 2.0, 1.5, 1.7, 2.6].forEach((alt, k) => {
      const g = new THREE.Group();
      g.position.set(-5.5 + k * 2.2, 0, 6.4);
      const teto = new THREE.Mesh(new THREE.BoxGeometry(1.3, alt, 1.0).translate(0, alt / 2, 0), tetoMat);
      const feito = new THREE.Mesh(new THREE.BoxGeometry(1.18, alt * 0.995, 0.88).translate(0, alt * 0.995 / 2, 0), feitoMat);
      feito.scale.y = 1e-3;
      g.add(teto, feito);
      scene.add(g);
      barras.push({ g, feito, k, mostra: new Mola(0, MOLAS.peca, 1e-3), enche: new Mola(0, MOLAS.peca, 1e-3) });
    });
  }
  // mapa cartão → montagem: "q" é o cartão (0 a n, contínuo), "p" é a montagem da casa (0 a 4)
  const mapa = cfg.mapa;
  const montagem = (q) => {
    if (!mapa) return q;
    if (q <= mapa[0][0]) return mapa[0][1] + (q - mapa[0][0]) * (mapa[1][1] - mapa[0][1]) / (mapa[1][0] - mapa[0][0]);
    for (let i = 1; i < mapa.length; i++) {
      if (q <= mapa[i][0]) {
        const [q0, p0] = mapa[i - 1];
        const [q1, p1] = mapa[i];
        return p0 + ((q - q0) / (q1 - q0)) * (p1 - p0);
      }
    }
    return mapa[mapa.length - 1][1];
  };
  function definirBarras(q, imediato) {
    for (const b of barras) {
      const mostra = clamp((q - 2.9) / 0.5, 0, 1) * (1 - clamp((q - 6.95) / 0.45, 0, 1));
      const enche = clamp((q - 5.9 - b.k * 0.22) / 0.4, 0, 1);
      if (imediato) { b.mostra.pula(mostra); b.enche.pula(enche); }
      else { b.mostra.alvo = mostra; b.enche.alvo = enche; }
    }
  }

  let pAnt = NaN;
  function definirProgresso(p, imediato) {
    for (const q of pecas) {
      const alvo = alvoDe(q, p);
      if (imediato) q.mola.pula(alvo);
      else q.mola.alvo = alvo;
    }
    const ap = 1 - clamp((p - 3.15) / 0.3, 0, 1);
    if (imediato) { apagar.pula(ap); pCam.pula(clamp(p, 0, 4)); }
    else { apagar.alvo = ap; pCam.alvo = clamp(p, 0, 4); }
  }

  c.aoMedir = () => posicionarCamera();
  c.atualizar = (dt) => {
    let mexe = false;
    if (!calmo) {
      const q = estado.processoP; // já suavizado pela rolagem
      if (q !== pAnt) {
        pAnt = q;
        definirProgresso(montagem(q), false);
        definirBarras(q, false);
        mexe = true;
      }
    }
    for (const b of barras) {
      if (b.mostra.passo(dt)) mexe = true;
      if (b.enche.passo(dt)) mexe = true;
      const s = Math.max(b.mostra.x, 1e-3);
      b.g.scale.set(1, s, 1);
      b.g.visible = b.mostra.x > 0.03;
      b.feito.scale.y = Math.max(b.enche.x, 1e-3);
      b.feito.visible = b.enche.x > 0.004;
    }
    if (apagar.passo(dt)) mexe = true;
    for (const q of pecas) {
      if (q.mola.passo(dt)) mexe = true;
      aplicar(q);
    }
    if (pCam.passo(dt)) mexe = true;
    if (px.passo(dt)) mexe = true;
    if (py.passo(dt)) mexe = true;
    posicionarCamera();
    return mexe;
  };

  if (calmo) {
    definirProgresso(4, true); // casa pronta, parada
    for (const q of pecas) aplicar(q);
    posicionarCamera();
    return;
  }
  definirProgresso(montagem(estado.processoP), true);
  definirBarras(estado.processoP, true);
  for (const q of pecas) aplicar(q);
  posicionarCamera();
  // paralaxe pelo mouse sobre a seção (posição do ponteiro na janela, sem medir nada)
  cfg.el.closest('section').addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse' || !c.visivel) return;
    px.alvo = clamp((e.clientX / innerWidth) * 2 - 1, -1, 1);
    py.alvo = clamp((e.clientY / innerHeight) * 2 - 1, -1, 1);
    acordar();
  }, { passive: true });
}

/* ───────────── entrada ───────────── */
export function iniciar(op) {
  ({ Mola, MOLAS, tarefa, estado } = op);
  acordaGlobal = op.acorda;
  falhou = op.aoFalhar || falhou;
  if (op.hero) {
    try {
      criarHero(op.hero, op.casas, op.foto, op.calmo);
    } catch (e) {
      falhou('hero', e);
    }
  }
  if (op.carrossel) {
    quandoPerto(op.carrossel.el, () => {
      criarCarrossel(op.carrossel, op.casas, op.foto, op.calmo).catch((e) => falhou('carrossel', e));
    });
  }
  if (op.processo) quandoPerto(op.processo.el, () => {
    try {
      criarProcesso(op.processo, op.calmo, op.logo);
    } catch (e) {
      falhou('processo', e);
    }
  });
}
