/* Site da Dia de Obra · início, Como funciona e Quem somos · 18/11/2026
 *
 * ── FOTOS DAS CASAS ──────────────────────────────────────────────────────────────
 * Esta lista é o único lugar para trocar, tirar ou reordenar casas (topo, carrossel,
 * cartões e foto ampliada saem todos daqui, nas três páginas).
 *  - fotos: nomes-base em assets/casas/, sem o tamanho. A primeira é a capa.
 *    Os arquivos -600, -900 e -1800 saem de
 *    ../2026-11-18_site-dia-de-obra_montagem/prepara-fotos.py, que lê
 *    recebidos/2026-11-18_site-casas/ e usa a pasta melhoradas/ quando a foto existe lá.
 *    Para trocar uma foto: ponha a nova em melhoradas/ com o mesmo nome e rode o script.
 *  - situacao: 'construida' ou 'projeto'. Com confirmar: true o selo fica escondido no ar
 *    (data-pendente) até o Fábio confirmar; aí é só trocar para confirmar: false.
 *  - tipo: 'Térrea', 'Sobrado' ou '' (sem selo).
 *  - foco: ponto que fica no centro quando a foto é cortada (x da esquerda, y do topo; 0 a 1).
 * ──────────────────────────────────────────────────────────────────────────────── */
const CASAS = [
  { fotos: ['casa-6'], titulo: 'Sobrado com beiral de madeira', tipo: 'Sobrado', situacao: 'construida', confirmar: true, foco: [0.5, 0.55] },
  { fotos: ['casa-1'], titulo: 'Térrea ao entardecer', tipo: 'Térrea', situacao: 'projeto', confirmar: true, foco: [0.56, 0.5] },
  { fotos: ['casa-3'], titulo: 'Sobrado com pedra e ripado', tipo: 'Sobrado', situacao: 'construida', confirmar: true, foco: [0.5, 0.42] },
  { fotos: ['casa-8'], titulo: 'Casa com oliveira', tipo: '', situacao: 'construida', confirmar: true, foco: [0.5, 0.55] },
  { fotos: ['casa-7'], titulo: 'Térrea com coqueiro', tipo: 'Térrea', situacao: 'projeto', confirmar: true, foco: [0.5, 0.55] },
  { fotos: ['casa-5'], titulo: 'Térrea branca com garagem dupla', tipo: 'Térrea', situacao: 'construida', confirmar: true, foco: [0.5, 0.45] },
  { fotos: ['casa-4'], titulo: 'Térrea com porta de madeira', tipo: 'Térrea', situacao: 'construida', confirmar: true, foco: [0.5, 0.48] },
];

(() => {
'use strict';
// Script comum (não módulo): funciona até abrindo o arquivo direto no navegador (file://);
// nesse caso o 3D não carrega e a página mostra a versão parada. Cada parte só liga se existir
// na página (o mesmo script serve às três).
const AQUI = document.currentScript.src;
const { Mola, MOLAS, anima, tarefa, acorda } = window.DiaDeObraMola;
const R = window.DiaDeObraRolagem; // rolagem suave, cor de fundo e efeitos que seguem a rolagem
const BASE = new URL('casas/', AQUI).href;
const foto = (nome, tam) => `${BASE}${nome}-${tam}.jpg`;
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const calmo = matchMedia('(prefers-reduced-motion: reduce)').matches;
const raiz = document.documentElement;
const SITUACAO = { construida: 'Construída', projeto: 'Em projeto' };
const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const doisDigitos = (n) => String(n).padStart(2, '0');

function chips(casa) {
  let h = casa.tipo ? `<span class="chip">${esc(casa.tipo)}</span>` : '';
  if (casa.situacao) {
    const pend = casa.confirmar ? ' data-pendente="situação da obra"' : '';
    h += `<span class="chip ${casa.situacao}"${pend}>${SITUACAO[casa.situacao]}</span>`;
  }
  return h;
}

/* ── Obras (só na página inicial): miniaturas no modo 3D, grade sem 3D ── */
const obras = $('#obras');
let atual = 0;
let carrossel = null; // controle do carrossel 3D (quando existir)
let pendenteIr = null;
function legenda(i) {
  if (!obras) return;
  const casa = CASAS[i];
  $('.contador', obras).innerHTML = `<b>${doisDigitos(i + 1)}</b> / ${doisDigitos(CASAS.length)}`;
  $('.legenda h3', obras).textContent = casa.titulo;
  $('.legenda .chips', obras).innerHTML = chips(casa);
  $$('.cartao', obras).forEach((b, k) => b.setAttribute('aria-current', String(k === i)));
}
function selecionar(i, deOnde) {
  atual = (i + CASAS.length) % CASAS.length;
  legenda(atual);
  if (deOnde !== 'carrossel') {
    if (carrossel) carrossel.ir(atual);
    else pendenteIr = atual;
  }
}
if (obras) {
  const lista = $('.lista', obras);
  lista.innerHTML = CASAS.map((casa, i) => `
    <li><button class="cartao" type="button" data-i="${i}" aria-current="${i === 0}">
      <img src="${foto(casa.fotos[0], 600)}" alt="" loading="lazy" decoding="async">
      <span class="cartao-txt"><strong>${esc(casa.titulo)}</strong><span class="chips">${chips(casa)}</span></span>
    </button></li>`).join('');
  legenda(0);
  lista.addEventListener('click', (e) => {
    const b = e.target.closest('.cartao');
    if (!b) return;
    const i = Number(b.dataset.i);
    if (obras.dataset.modo === 'grade') abrir(i);
    else selecionar(i);
  });
  $('.seta.ant', obras).addEventListener('click', () => selecionar(atual - 1));
  $('.seta.prox', obras).addEventListener('click', () => selecionar(atual + 1));
  $('.ver-fotos', obras).addEventListener('click', () => abrir(atual));
  $('.carrossel', obras).addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') { e.preventDefault(); selecionar(atual - 1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); selecionar(atual + 1); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); abrir(atual); }
  });
  if (calmo) obras.dataset.modo = 'grade'; // reduzir movimento: sem carrossel girando
}

/* ── Foto ampliada: <dialog> nativo; entra e sai por mola ── */
const dlg = $('.ampliada');
let abrir = () => {};
if (dlg) {
  const caixa = $('.amp-caixa', dlg);
  const imgAmp = $('.amp-foto img', dlg);
  let ampCasa = 0;
  let ampFoto = 0;
  const mEsc = new Mola(0.94, MOLAS.posicao, 1e-4);
  const mOp = new Mola(0, MOLAS.posicao, 1e-3);
  const itemAmp = {
    molas: [mEsc, mOp],
    desenha() {
      caixa.style.scale = mEsc.x;
      caixa.style.opacity = Math.max(0, Math.min(1, mOp.x));
    },
    fim: null,
  };
  const mostrarAmp = () => {
    const casa = CASAS[ampCasa];
    const nome = casa.fotos[ampFoto];
    imgAmp.src = foto(nome, 900);
    imgAmp.srcset = `${foto(nome, 900)} 900w, ${foto(nome, 1800)} 1800w`;
    imgAmp.sizes = '(max-width: 760px) 100vw, 80vw';
    imgAmp.alt = casa.fotos.length > 1 ? `${casa.titulo}, foto ${ampFoto + 1} de ${casa.fotos.length}` : casa.titulo;
    $('#amp-titulo').textContent = casa.titulo;
    $('.chips', dlg).innerHTML = chips(casa);
    $('.amp-fotos', dlg).innerHTML = casa.fotos.length > 1
      ? casa.fotos.map((n, k) => `<button type="button" data-k="${k}" aria-label="Foto ${k + 1}" aria-current="${k === ampFoto}"><img src="${foto(n, 600)}" alt=""></button>`).join('')
      : '';
  };
  abrir = (i, k = 0) => {
    ampCasa = (i + CASAS.length) % CASAS.length;
    ampFoto = k;
    mostrarAmp();
    if (!dlg.open) dlg.showModal();
    itemAmp.fim = null;
    if (calmo) { mEsc.pula(1); mOp.pula(1); itemAmp.desenha(); return; }
    mEsc.alvo = 1;
    mOp.alvo = 1;
    anima(itemAmp);
  };
  const fechar = () => {
    if (!dlg.open) return;
    const fecha = () => { dlg.close(); mEsc.pula(0.94); mOp.pula(0); itemAmp.desenha(); };
    if (calmo) { fecha(); return; }
    mEsc.alvo = 0.96;
    mOp.alvo = 0;
    itemAmp.fim = fecha;
    anima(itemAmp);
  };
  const trocarCasa = (d) => {
    ampCasa = (ampCasa + d + CASAS.length) % CASAS.length;
    ampFoto = 0;
    mostrarAmp();
    selecionar(ampCasa); // o carrossel acompanha por trás
    if (!calmo) { mEsc.x = 0.985; anima(itemAmp); }
  };
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); fechar(); });
  dlg.addEventListener('click', (e) => {
    if (e.target === dlg || e.target === caixa || e.target.classList.contains('amp-foto')) fechar();
  });
  $('.amp-fechar', dlg).addEventListener('click', fechar);
  $('.amp-ant', dlg).addEventListener('click', () => trocarCasa(-1));
  $('.amp-prox', dlg).addEventListener('click', () => trocarCasa(1));
  $('.amp-fotos', dlg).addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b) { ampFoto = Number(b.dataset.k); mostrarAmp(); }
  });
  dlg.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') trocarCasa(-1);
    else if (e.key === 'ArrowRight') trocarCasa(1);
  });
  let toqueAmp = null; // deslizar o dedo para o lado troca de casa
  dlg.addEventListener('pointerdown', (e) => { if (e.pointerType !== 'mouse') toqueAmp = { x: e.clientX, y: e.clientY }; });
  dlg.addEventListener('pointerup', (e) => {
    if (!toqueAmp) return;
    const dx = e.clientX - toqueAmp.x;
    const dy = e.clientY - toqueAmp.y;
    toqueAmp = null;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) trocarCasa(dx < 0 ? 1 : -1);
  });
}

/* ── Menu do celular: painel de vidro que abre e fecha por mola ── */
const botaoMenu = $('.topo-menu');
const menu = $('#menu-movel');
if (botaoMenu && menu) {
  const mA = new Mola(0, MOLAS.toque, 1e-3);
  const itemMenu = {
    molas: [mA],
    desenha() {
      menu.style.opacity = Math.max(0, Math.min(1, mA.x)).toFixed(3);
      menu.style.scale = (0.94 + 0.06 * mA.x).toFixed(4);
    },
    fim: null,
  };
  const abrirMenu = (sim) => {
    botaoMenu.setAttribute('aria-expanded', String(sim));
    if (sim) menu.hidden = false;
    itemMenu.fim = sim ? null : () => { menu.hidden = true; };
    mA.alvo = sim ? 1 : 0;
    if (calmo) { mA.pula(mA.alvo); itemMenu.desenha(); itemMenu.fim?.(); return; }
    anima(itemMenu);
  };
  botaoMenu.addEventListener('click', () => abrirMenu(menu.hidden || mA.alvo === 0));
  menu.addEventListener('click', (e) => { if (e.target.closest('a')) abrirMenu(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !menu.hidden) { abrirMenu(false); botaoMenu.focus(); } });
}

/* ── Âncoras da mesma página: rolam pela mesma mola da rolagem suave ── */
const rolarPara = (el) => R.irPara(el);
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[href^="#"]');
  if (!a || e.defaultPrevented) return;
  const id = a.getAttribute('href').slice(1);
  const alvo = id && document.getElementById(id);
  if (!alvo) return;
  e.preventDefault();
  rolarPara(alvo);
  history.replaceState(null, '', `#${id}`);
  if (!alvo.hasAttribute('tabindex')) alvo.setAttribute('tabindex', '-1');
  alvo.focus({ preventScroll: true });
});

/* ── Passagem entre páginas ──
   Com View Transitions entre documentos (Chrome, Safari 18.2+), quem faz é o CSS. Sem suporte,
   a página some por mola (curta) e a próxima já abre na mesma cor de fundo (nada de tela branca). */
const temVT = 'onpagereveal' in window && CSS.supports('selector(::view-transition)');
document.addEventListener('click', (e) => {
  if (temVT || calmo || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const a = e.target.closest('a[href]');
  if (!a || a.target === '_blank' || a.hasAttribute('download')) return;
  const url = new URL(a.href, location.href);
  if (url.origin !== location.origin || (url.pathname === location.pathname && url.hash)) return;
  e.preventDefault();
  try { sessionStorage.setItem('dob-fundo', raiz.style.backgroundColor); } catch (er) { /* tudo bem */ }
  const conteudo = [$('main'), $('.rodape')].filter(Boolean);
  const mS = new Mola(1, { response: 0.22, dampingFraction: 1 }, 0.02);
  mS.alvo = 0;
  anima({ molas: [mS], desenha() { for (const el of conteudo) el.style.opacity = Math.max(0, mS.x).toFixed(3); }, fim() { location.href = url.href; } });
});

/* ── Título da página: entra com mola (as palavras sobem e aparecem uma depois da outra) ── */
const titulo = $('[data-entra]');
if (titulo && !calmo) {
  const partes = [...titulo.children];
  const molas = partes.map(() => new Mola(0, { response: 0.6, dampingFraction: 0.86 }, 1e-3));
  for (const p of partes) { p.style.display = 'block'; p.style.opacity = '0'; p.style.translate = '0 0.35em'; }
  raiz.classList.remove('entrando');
  const item = {
    molas,
    desenha() {
      partes.forEach((p, i) => {
        const v = molas[i].x;
        p.style.opacity = v >= 1 ? '' : Math.max(0, Math.min(1, v * 1.4)).toFixed(3);
        p.style.translate = v >= 1 ? '' : `0 ${((1 - v) * 0.35).toFixed(3)}em`;
      });
    },
  };
  partes.forEach((p, i) => setTimeout(() => { molas[i].alvo = 1; anima(item); }, 60 + i * 70));
} else {
  raiz.classList.remove('entrando');
}

/* ── Toque nos botões sólidos: afunda e volta pela mola (os de vidro esticam: assets/vidro.js) ── */
for (const el of $$('[data-toque]:not(.lg)')) {
  if (calmo) break;
  const m = new Mola(1, MOLAS.toque, 1e-4);
  const item = { molas: [m], desenha() { el.style.scale = m.x === 1 ? '' : m.x; } };
  const vai = (v) => { m.alvo = v; anima(item); };
  el.addEventListener('pointerdown', () => vai(0.95));
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) el.addEventListener(ev, () => vai(1));
}

/* ── Planilha do cartão "etapa por etapa": o vermelho (executado) cresce com a rolagem até o teto ── */
const acompanha = $('.planilha[data-acompanha]');
if (acompanha) {
  const barras = $$('.planilha-barra', acompanha);
  const etapasEl = $$('.etapa');
  const idx = etapasEl.findIndex((el) => el.contains(acompanha));
  let ant = -1;
  const pinta = (q) => {
    barras.forEach((b, k) => {
      const v = Math.max(0, Math.min(1, (q - (idx - 0.6) - k * 0.22) / 0.5));
      b.style.setProperty('--feito', v.toFixed(3));
    });
  };
  if (calmo) pinta(idx + 2);
  else {
    tarefa(() => {
      const q = R.estado.processoP;
      if (Math.abs(q - ant) > 1e-4) { ant = q; pinta(q); }
      return false;
    });
  }
}

/* ── Sem 3D: colagem parada no topo, grade de cartões e etapas em coluna ── */
function sem3d(onde = 'tudo') {
  if ((onde === 'tudo' || onde === 'hero') && $('.hero-colagem')) {
    raiz.classList.add('sem-3d-hero');
    const colagem = $('.hero-colagem');
    if (!colagem.childElementCount) {
      colagem.innerHTML = [0, 1, 4].map((i) => `<img src="${foto(CASAS[i % CASAS.length].fotos[0], 600)}" alt="">`).join('');
    }
  }
  if (onde === 'tudo') raiz.classList.add('sem-3d');
  if ((onde === 'tudo' || onde === 'carrossel') && obras) obras.dataset.modo = 'grade';
  if (onde === 'processo') $('.processo')?.classList.add('sem-3d');
  R.medir(); // a página mudou de altura
}

/* ── 3D (three.js): só se o aparelho tiver WebGL 2 e a página tiver alguma cena ── */
const avisoFalha = (onde, erro) => { console.warn(`[Dia de Obra] 3D desligado (${onde}):`, erro); sem3d(onde); };
const heroEl = $('.hero-3d');
const carrosselEl = $('.carrossel');
const processoEl = $('.processo-3d');
if (heroEl || carrosselEl || processoEl) {
  if (!('WebGL2RenderingContext' in window)) {
    sem3d();
  } else {
    const mapa = processoEl?.dataset.mapa?.split(',').map((par) => par.split(':').map(Number));
    import(new URL('cenas-3d.js', AQUI).href)
      .then((m) => m.iniciar({
        casas: CASAS,
        foto,
        calmo,
        logo: new URL('logo-dia-de-obra-v2.png', AQUI).href,
        Mola,
        MOLAS,
        tarefa,
        acorda,
        estado: R.estado, // progresso de cada parte, já suavizado (assets/rolagem.js)
        hero: heroEl ? { el: heroEl, texto: $('.hero-texto'), aoEscolher(i) { if (obras) { selecionar(i); rolarPara(obras); } else location.href = './#obras'; } } : null,
        carrossel: carrosselEl && !calmo ? {
          el: carrosselEl,
          aoMudar(i) { selecionar(i, 'carrossel'); },
          aoAbrir(i) { abrir(i); },
          aoPronto(ctrl) { carrossel = ctrl; if (pendenteIr != null) { ctrl.ir(pendenteIr, true); pendenteIr = null; } },
        } : null,
        processo: processoEl ? { el: processoEl, mapa, barras: processoEl.hasAttribute('data-barras') } : null,
        aoFalhar: avisoFalha,
      }))
      .catch((erro) => avisoFalha('tudo', erro));
  }
}

// rolagem: mede a página já montada e liga a cor de fundo e os efeitos que acompanham a rolagem
R.iniciar();

/* Para o Gerente: lista do que ainda falta confirmar (abra o console do navegador). */
console.info('[Dia de Obra] pendentes:', $$('[data-pendente]').map((el) => el.dataset.pendente));
})();
