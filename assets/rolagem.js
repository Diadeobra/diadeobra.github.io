// Rolagem do site da Dia de Obra: tudo acompanha a rolagem, de forma contínua ("scrubbed").
//
// 1. Rolagem suave: no computador (mouse ou trackpad), a roda vira o alvo de uma mola e a página
//    rola até ele com inércia leve. Âncoras usam a mesma mola. Teclado, barra de rolagem e Tab
//    continuam nativos: quando a página rola sozinha, a mola larga e segue o valor real.
//    No celular (toque) a rolagem é a nativa; só os valores derivados passam pela mola.
// 2. Efeitos: o progresso de cada parte (topo, obras, casa, textos e cartões) sai da posição da
//    rolagem já suavizada, e é aplicado só em transform e opacity. As medidas são feitas ao carregar
//    e ao redimensionar; o laço nunca lê getBoundingClientRect.
// 3. prefers-reduced-motion: sem rolagem suave e sem efeitos; tudo parado no lugar.
// Script comum (não módulo), carregado depois do mola.js.

window.DiaDeObraRolagem = (() => {
  'use strict';
  const { Mola, MOLAS, tarefa, acorda } = window.DiaDeObraMola;
  const calmo = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const raiz = document.documentElement;
  const limita = (v, a, b) => Math.max(a, Math.min(b, v));
  const suaviza = (x) => x * x * (3 - 2 * x);
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];

  // valores lidos pelas cenas 3D a cada quadro
  const estado = { y: scrollY, vh: innerHeight, heroP: 0, obrasP: 0, processoP: -1, movel: false };

  /* ───────────── cor de fundo contínua ─────────────
     Cada seção só declara a sua cor (data-fundo). O fundo é um só (o do html) e, na faixa entre
     duas seções, passa de uma cor para a outra na proporção da rolagem, pela mola. O texto das seções
     (variáveis --tinta, --tinta-2 e --acento) escolhe a cor de maior contraste com o fundo daquele
     instante, então fica AA o tempo todo, inclusive no meio da passagem. */
  const PALETA = { vermelho: [224, 0, 0], creme: [251, 241, 220], escuro: [23, 24, 21] };
  const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const luminancia = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  function corDoFundo(y) {
    const f = M.fundos;
    if (!f || !f.length) return null;
    const sonda = y + M.vh * 0.5;          // o meio da tela decide a cor
    const faixa = M.vh * 0.32;             // largura da passagem entre duas seções
    for (let k = 1; k < f.length; k++) {
      const d = sonda - f[k].top;
      if (Math.abs(d) < faixa) {
        const t = suaviza(limita((d + faixa) / (2 * faixa), 0, 1));
        return f[k - 1].cor.map((c, i) => c + (f[k].cor[i] - c) * t);
      }
    }
    let atual = f[0].cor;
    for (const s of f) if (sonda >= s.top) atual = s.cor;
    return atual;
  }
  const fundoR = new Mola(224, MOLAS.derivado, 0.2);
  const fundoG = new Mola(0, MOLAS.derivado, 0.2);
  const fundoB = new Mola(0, MOLAS.derivado, 0.2);
  let modoTexto = '';
  function pintarFundo(rgb) {
    const [r, g, b] = rgb.map((c) => Math.round(c));
    raiz.style.backgroundColor = `rgb(${r},${g},${b})`;
    const L = luminancia([r, g, b]);
    // creme no escuro; creme-claro no vermelho; branco/preto puros na passagem (contraste ≥ 4,58)
    const modo = L > 0.45 ? 'claro' : L >= 0.179 ? 'preto' : L > 0.16 ? 'branco' : L > 0.03 ? 'vermelho' : 'escuro';
    if (modo === modoTexto) return;
    modoTexto = modo;
    const T = {
      claro: ['#171815', 'rgba(23,24,21,.76)', '#C00000'],
      preto: ['#000', '#000', '#000'],
      branco: ['#fff', '#fff', '#fff'],
      vermelho: ['#FFF7E8', '#FFF7E8', '#FFF7E8'],
      escuro: ['#FBF1DC', 'rgba(251,241,220,.82)', '#FF8A7E'],
    }[modo];
    raiz.style.setProperty('--tinta', T[0]);
    raiz.style.setProperty('--tinta-2', T[1]);
    raiz.style.setProperty('--acento', T[2]);
  }
  function guardarFundo() {
    try { sessionStorage.setItem('dob-fundo', raiz.style.backgroundColor); } catch (e) { /* sem armazenamento: tudo bem */ }
  }
  addEventListener('pagehide', guardarFundo);

  /* ───────────── medidas (fora do laço) ───────────── */
  const M = { vh: innerHeight, max: 0, hero: null, carrossel: null, etapas: [], revela: [], linha: 0.62 };
  function topoDoc(el) {
    let y = 0;
    for (let e = el; e; e = e.offsetParent) y += e.offsetTop;
    return y;
  }
  function medir() {
    M.vh = innerHeight;
    M.max = Math.max(0, raiz.scrollHeight - innerHeight);
    const hero = $('.hero');
    M.hero = hero ? { top: topoDoc(hero), h: hero.offsetHeight } : null;
    const car = $('.carrossel');
    M.carrossel = car ? { top: topoDoc(car), h: car.offsetHeight } : null;
    estado.movel = matchMedia('(max-width: 860px), (max-aspect-ratio: 9/10)').matches;
    M.linha = estado.movel ? 0.78 : 0.55; // linha de leitura das etapas (fração da altura da tela)
    // cada etapa fica "no meio" (k + 0,5) quando o centro do cartão passa pela linha de leitura
    M.etapas = $$('.etapa').map((el) => ({ el, centro: topoDoc(el) + el.offsetHeight / 2 }));
    M.fundos = $$('[data-fundo]').map((el) => ({ top: topoDoc(el), cor: PALETA[el.dataset.fundo] || PALETA.escuro })).sort((a, b) => a.top - b.top);
    for (const r of M.revela) {
      r.top = topoDoc(r.el);
      r.h = r.el.offsetHeight;
      // rolagem em que o elemento começa e termina de entrar; perto do fim da página, termina
      // no máximo da rolagem (senão o rodapé nunca apareceria inteiro)
      r.fim = Math.min(r.top - M.vh * (0.64 - r.atraso), M.max);
      r.ini = Math.min(r.fim - 1, r.top - M.vh * (0.94 - r.atraso));
    }
    estado.vh = M.vh;
    acorda();
  }

  /* ───────────── elementos que entram com a rolagem ───────────── */
  // data-revela="" (sobe 34 px e aparece), data-revela="etapa" (também some ao sair por cima),
  // data-atraso="0.05" (fração da tela; escalona cartões vizinhos)
  function registrarRevelar() {
    M.revela = $$('[data-revela]').map((el) => ({
      el,
      tipo: el.dataset.revela,
      atraso: Number(el.dataset.atraso || 0),
      top: 0,
      h: 0,
      ultimo: -1,
    }));
  }

  /* ───────────── rolagem suave (computador) ───────────── */
  const suave = !calmo && matchMedia('(hover: hover) and (pointer: fine)').matches;
  const roda = new Mola(scrollY, MOLAS.rolagem, 0.25);
  let rodando = false; // a página está sendo rolada pela mola
  let escrito = scrollY;

  function soltar() {
    rodando = false;
    roda.pula(scrollY);
  }
  if (suave) {
    addEventListener('wheel', (e) => {
      if (e.ctrlKey || e.defaultPrevented) return;              // zoom, ou o carrossel já usou o gesto
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;      // gesto para o lado
      if (document.querySelector('dialog[open]')) return;       // foto ampliada aberta
      e.preventDefault();
      const fator = e.deltaMode === 1 ? 32 : e.deltaMode === 2 ? M.vh * 0.9 : 1;
      if (!rodando) roda.pula(scrollY);
      roda.alvo = limita(roda.alvo + e.deltaY * fator, 0, M.max);
      rodando = true;
      acorda();
    }, { passive: false });
  }
  // teclado, barra de rolagem, Tab ou âncora nativa: a mola larga e segue o valor real
  addEventListener('scroll', () => {
    if (rodando && Math.abs(scrollY - escrito) > 3) soltar();
    acorda();
  }, { passive: true });
  addEventListener('touchstart', () => { if (rodando) soltar(); }, { passive: true });
  addEventListener('keydown', (e) => {
    if (rodando && ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ', 'Spacebar'].includes(e.key)) soltar();
  });

  // rola até um elemento (âncoras): a mesma mola da roda; com "reduzir movimento", salto direto
  function irPara(el) {
    const y = limita(el.getBoundingClientRect().top + scrollY, 0, M.max);
    if (calmo) {
      window.scrollTo(0, y);
      return;
    }
    if (!rodando) roda.pula(scrollY);
    roda.alvo = y;
    rodando = true;
    acorda();
  }

  /* ───────────── laço: rolagem, valores derivados e efeitos ───────────── */
  const ys = new Mola(scrollY, suave ? { response: 0.16, dampingFraction: 1 } : MOLAS.derivado, 0.05);
  const heroTexto = $('.hero-texto');
  // a opacidade vai em cada peça, não no bloco: opacidade num "pai" cortaria o vidro dos botões
  // (vira raiz do fundo do backdrop-filter); o deslocamento vai no bloco inteiro
  const heroCamadas = heroTexto ? [...heroTexto.children].flatMap((c) => (c.classList.contains('acoes') ? [...c.children] : [c])) : [];
  let ultimoHero = -1;

  function aplicar(y) {
    const vh = M.vh;
    // topo: o título sobe e some aos poucos; as fotos 3D usam heroP
    if (M.hero) {
      const p = limita(y / Math.max(1, M.hero.h), 0, 1);
      estado.heroP = p;
      const pt = limita(y / Math.max(1, M.hero.h * 0.7), 0, 1);
      if (heroTexto && Math.abs(pt - ultimoHero) > 0.0005) {
        ultimoHero = pt;
        heroTexto.style.transform = pt ? `translate3d(0, ${(-pt * 90).toFixed(2)}px, 0)` : '';
        const op = pt ? limita(1 - (pt * 1.3 - 0.08), 0, 1).toFixed(3) : '';
        for (const c of heroCamadas) c.style.opacity = op;
      }
    }
    // obras: 0 quando o carrossel aparece embaixo, 1 quando chega ao alto da tela
    if (M.carrossel) estado.obrasP = limita((y + vh - M.carrossel.top) / (vh * 0.85), 0, 1);
    // casa: a linha de leitura percorre os cartões das etapas (0 a 4, contínuo)
    const et = M.etapas;
    if (et.length > 1) {
      const linha = y + vh * M.linha;
      const n = et.length;
      let p;
      if (linha < et[0].centro) p = 0.5 + (linha - et[0].centro) / (et[1].centro - et[0].centro);
      else if (linha >= et[n - 1].centro) p = n - 0.5 + (linha - et[n - 1].centro) / (et[n - 1].centro - et[n - 2].centro);
      else {
        let k = 0;
        while (k < n - 2 && linha >= et[k + 1].centro) k++;
        p = k + 0.5 + (linha - et[k].centro) / (et[k + 1].centro - et[k].centro);
      }
      estado.processoP = limita(p, -1, n);
    }
    // textos e cartões: sobem e aparecem na proporção da posição (nunca por gatilho)
    for (const r of M.revela) {
      let v = limita((y - r.ini) / (r.fim - r.ini), 0, 1);
      if (r.tipo === 'etapa') v = Math.min(v, limita((r.top + r.h - y - 0.04 * vh) / (0.24 * vh), 0, 1));
      if (Math.abs(v - r.ultimo) < 0.0008) continue;
      r.ultimo = v;
      const e = suaviza(v);
      r.el.style.transform = e < 1 ? `translate3d(0, ${((1 - e) * 34).toFixed(2)}px, 0)` : '';
      r.el.style.opacity = e < 1 ? e.toFixed(3) : '';
    }
    estado.y = y;
  }

  if (!calmo) {
    tarefa((dt) => {
      let mexe = false;
      if (rodando) {
        roda.passo(dt);
        escrito = roda.x;
        window.scrollTo(0, roda.x);
        if (roda.parada) rodando = false;
        mexe = true;
      }
      ys.alvo = rodando ? roda.x : scrollY;
      if (ys.passo(dt)) mexe = true;
      aplicar(ys.x);
      const cor = corDoFundo(ys.x);
      if (cor) {
        fundoR.alvo = cor[0];
        fundoG.alvo = cor[1];
        fundoB.alvo = cor[2];
        if (fundoR.passo(dt)) mexe = true;
        if (fundoG.passo(dt)) mexe = true;
        if (fundoB.passo(dt)) mexe = true;
        pintarFundo([fundoR.x, fundoG.x, fundoB.x]);
      }
      return mexe;
    });
  } else {
    // parado: os valores e o fundo seguem a rolagem direto, sem mola e sem efeito visual
    addEventListener('scroll', () => {
      estado.y = scrollY;
      const cor = corDoFundo(scrollY);
      if (cor) pintarFundo(cor);
    }, { passive: true });
  }

  /* ───────────── início ───────────── */
  function iniciar() {
    registrarRevelar();
    medir();
    ys.pula(scrollY);
    // fundo: começa da cor em que a página anterior estava (continuidade entre páginas) ou já na certa
    const alvo = corDoFundo(scrollY);
    if (alvo) {
      const m = /rgb\((\d+),\s*(\d+),\s*(\d+)/.exec(raiz.style.backgroundColor || '');
      const ini = m && !calmo ? m.slice(1, 4).map(Number) : alvo;
      fundoR.pula(ini[0]);
      fundoG.pula(ini[1]);
      fundoB.pula(ini[2]);
      pintarFundo(ini);
    }
    // os efeitos só são aplicados dentro do laço: se a animação não rodar (aba escondida,
    // navegador sem requestAnimationFrame), nada fica escondido
    acorda();
  }
  addEventListener('resize', medir, { passive: true });
  new ResizeObserver(() => medir()).observe(document.body);
  document.fonts?.ready.then(medir);
  addEventListener('load', medir);

  return { estado, irPara, medir, iniciar, registrarRevelar, calmo };
})();
