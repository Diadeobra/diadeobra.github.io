// Liquid Glass do site da Dia de Obra (exceção do site institucional no CLAUDE.md, 18/11/2026).
//
// A base do vidro é CSS e roda em todos os navegadores (classe .lg no index.html): desfoque com
// saturação, tinta translúcida, borda de 1 px em degradê, brilho especular interno e sombra macia.
// Este script soma:
//  1. Refração nas bordas, só no Chromium com mouse (no Safari, no Firefox e no celular fica a base):
//     um filtro SVG com feDisplacementMap no backdrop-filter. O mapa de deslocamento é desenhado
//     aqui, no tamanho e no raio de cada elemento, com perfil de vidro abaulado (squircle): a
//     distorção fica perto da borda e o centro fica limpo. Botões e barras ganham leve aberração
//     cromática (vermelho e azul deslocados alguns px). O filtro só fica ligado com o elemento na tela.
//  2. Brilho especular que segue o ponteiro, e o botão de vidro que estica no toque e volta com mola.
// Com "reduzir transparência": vidro sólido (CSS) e a refração não liga. Com "reduzir movimento":
// sem esticar e sem mola. Nenhuma biblioteca.

(() => {
  'use strict';
  const { Mola, MOLAS, anima } = window.DiaDeObraMola;
  const mm = (q) => matchMedia(q).matches;
  const semTransp = mm('(prefers-reduced-transparency: reduce)');
  const calmo = mm('(prefers-reduced-motion: reduce)');
  const vidros = [...document.querySelectorAll('.lg')];
  if (!vidros.length) return;

  /* ───────────── 1. refração (Chromium + mouse) ───────────── */
  const chromium = !!navigator.userAgentData?.brands?.some((b) => /Chromium/.test(b.brand));
  const refrata = chromium && !semTransp && mm('(hover: hover) and (pointer: fine)') && CSS.supports('backdrop-filter', 'url(#lg)');
  if (refrata) document.documentElement.classList.add('lg-refrata');

  const NS = 'http://www.w3.org/2000/svg';
  let defs = null;
  let n = 0;
  const filtros = new WeakMap(); // elemento → { id, w, h, r, filtro }

  function prepararDefs() {
    if (defs) return defs;
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('width', '0');
    svg.setAttribute('height', '0');
    svg.setAttribute('aria-hidden', 'true');
    svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
    defs = document.createElementNS(NS, 'defs');
    svg.appendChild(defs);
    document.body.appendChild(svg);
    return defs;
  }

  // Mapa de deslocamento: R e G guardam o quanto puxar cada ponto (128 = nada). Perto da borda o
  // fundo é puxado para dentro, como numa lente abaulada; o centro fica parado.
  function mapa(w, h, r, borda) {
    const red = w * h > 70000 ? 2 : 1; // mapas grandes em meia resolução (o filtro estica)
    const W = Math.max(2, Math.round(w / red));
    const H = Math.max(2, Math.round(h / red));
    const R = r / red;
    const B = borda / red;
    const cv = document.createElement('canvas');
    cv.width = W;
    cv.height = H;
    const g = cv.getContext('2d');
    const img = g.createImageData(W, H);
    const d = img.data;
    const mx = W / 2 - R;
    const my = H / 2 - R;
    for (let y = 0; y < H; y++) {
      const py = y + 0.5 - H / 2;
      for (let x = 0; x < W; x++) {
        const px = x + 0.5 - W / 2;
        const qx = Math.abs(px) - mx;
        const qy = Math.abs(py) - my;
        const ox = Math.max(qx, 0);
        const oy = Math.max(qy, 0);
        const fora = Math.hypot(ox, oy);
        const sd = fora + Math.min(Math.max(qx, qy), 0) - R; // distância assinada (negativa dentro)
        const t = Math.min(1, Math.max(0, -sd / B));          // 0 na borda, 1 no fim do chanfro
        let nx = 0;
        let ny = 0;
        if (qx > 0 && qy > 0 && fora > 0) { nx = ox / fora; ny = oy / fora; }
        else if (qx > qy) nx = 1;
        else ny = 1;
        nx *= px < 0 ? -1 : 1;
        ny *= py < 0 ? -1 : 1;
        // inclinação de uma superfície squircle h(t) = (1 − (1 − t)⁴)^¼: muito forte junto da borda
        const u = 1 - t;
        const m = t >= 1 ? 0 : Math.min(1, (u * u * u) / Math.pow(Math.max(1e-4, 1 - u * u * u * u), 0.75) / 2.2);
        const i = (y * W + x) * 4;
        d[i] = 128 - nx * m * 127;
        d[i + 1] = 128 - ny * m * 127;
        d[i + 2] = 128;
        d[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    return cv.toDataURL('image/png');
  }

  function montarFiltro(el) {
    const w = Math.round(el.offsetWidth);
    const h = Math.round(el.offsetHeight);
    if (w < 8 || h < 8) return null;
    const cs = getComputedStyle(el);
    const r = Math.min(parseFloat(cs.borderTopLeftRadius) || 0, w / 2, h / 2);
    const atual = filtros.get(el);
    if (atual && atual.w === w && atual.h === h && Math.abs(atual.r - r) < 0.5) return atual;
    const curto = Math.min(w, h);
    const borda = Math.max(8, Math.min(24, Math.max(r, 12), curto * 0.45));
    const desloc = Math.max(5, Math.min(14, curto * 0.28)); // px que a borda puxa, no máximo
    const desfoque = parseFloat(cs.getPropertyValue('--lg-desfoque')) || 14;
    const sat = parseFloat(cs.getPropertyValue('--lg-sat')) || 1.75;
    const cromatico = curto <= 120; // botões e barras: aberração leve; cartões grandes: só a refração
    const id = atual ? atual.id : `lg-${++n}`;
    const url = mapa(w, h, r, borda);
    const S = (desloc * 2).toFixed(2);
    const desloca = (escala, saida) => `<feDisplacementMap in="borrado" in2="mapa" scale="${escala}" xChannelSelector="R" yChannelSelector="G" result="${saida}"/>`;
    const canais = cromatico
      ? desloca((desloc * 2.3).toFixed(2), 'dr') + '<feColorMatrix in="dr" type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="r"/>'
        + desloca(S, 'dg') + '<feColorMatrix in="dg" type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0" result="g"/>'
        + desloca((desloc * 1.7).toFixed(2), 'db') + '<feColorMatrix in="db" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" result="b"/>'
        + '<feBlend in="r" in2="g" mode="screen" result="rg"/><feBlend in="rg" in2="b" mode="screen" result="d"/>'
      : desloca(S, 'd');
    const filtro = atual?.filtro || document.createElementNS(NS, 'filter');
    filtro.setAttribute('id', id);
    filtro.setAttribute('x', '0');
    filtro.setAttribute('y', '0');
    filtro.setAttribute('width', String(w));
    filtro.setAttribute('height', String(h));
    filtro.setAttribute('filterUnits', 'userSpaceOnUse');
    filtro.setAttribute('primitiveUnits', 'userSpaceOnUse');
    filtro.setAttribute('color-interpolation-filters', 'sRGB');
    filtro.innerHTML = `<feGaussianBlur in="SourceGraphic" stdDeviation="${desfoque}" edgeMode="duplicate" result="borrado"/>`
      + `<feImage href="${url}" x="0" y="0" width="${w}" height="${h}" preserveAspectRatio="none" result="mapa"/>`
      + canais
      + `<feColorMatrix in="d" type="saturate" values="${sat}"/>`;
    if (!atual) prepararDefs().appendChild(filtro);
    const reg = { id, w, h, r, filtro };
    filtros.set(el, reg);
    return reg;
  }

  if (refrata) {
    const visiveis = new Set();
    const ligar = (el) => {
      const reg = montarFiltro(el);
      if (reg) el.style.backdropFilter = `url(#${reg.id})`;
    };
    const desligar = (el) => { el.style.backdropFilter = ''; };
    const io = new IntersectionObserver((entradas) => {
      for (const e of entradas) {
        if (e.isIntersecting) { visiveis.add(e.target); ligar(e.target); }
        else { visiveis.delete(e.target); desligar(e.target); }
      }
    }, { rootMargin: '120px 0px' });
    let pendente = 0;
    const ro = new ResizeObserver((entradas) => {
      for (const e of entradas) if (visiveis.has(e.target)) pendente = 1;
      if (pendente === 1) {
        pendente = 2;
        requestAnimationFrame(() => {
          pendente = 0;
          for (const el of visiveis) ligar(el);
        });
      }
    });
    for (const el of vidros) {
      io.observe(el);
      ro.observe(el);
    }
  }

  /* ───────────── 2. brilho que segue o ponteiro + botão que estica ───────────── */
  if (semTransp) return;
  for (const el of vidros) {
    const botao = el.matches('a, button');
    const lx = new Mola(50, MOLAS.posicao, 0.05);
    const ly = new Mola(0, MOLAS.posicao, 0.05);
    const luz = new Mola(0, MOLAS.linha, 1e-3);
    const sx = new Mola(1, MOLAS.estica, 1e-4);
    const sy = new Mola(1, MOLAS.estica, 1e-4);
    const item = {
      molas: [lx, ly, luz, sx, sy],
      desenha() {
        el.style.setProperty('--lx', `${lx.x.toFixed(1)}%`);
        el.style.setProperty('--ly', `${ly.x.toFixed(1)}%`);
        el.style.setProperty('--lg-luz-a', (0.26 * luz.x).toFixed(3)); // alfa do brilho (sem calc() dentro de rgba)
        if (botao) el.style.scale = sx.x === 1 && sy.x === 1 ? '' : `${sx.x.toFixed(4)} ${sy.x.toFixed(4)}`;
      },
    };
    const vai = () => {
      if (calmo) {
        for (const m of item.molas) m.pula(m.alvo);
        item.desenha();
      } else anima(item);
    };
    const mira = (e) => {
      const r = el.getBoundingClientRect(); // só no evento do ponteiro, nunca no laço
      lx.alvo = ((e.clientX - r.left) / Math.max(1, r.width)) * 100;
      ly.alvo = ((e.clientY - r.top) / Math.max(1, r.height)) * 100;
    };
    el.addEventListener('pointerenter', (e) => {
      mira(e);
      lx.pula(lx.alvo);
      ly.pula(ly.alvo);
      if (e.pointerType === 'mouse') luz.alvo = 1;
      vai();
    });
    el.addEventListener('pointermove', (e) => {
      mira(e);
      vai();
    });
    el.addEventListener('pointerleave', () => {
      luz.alvo = 0;
      sx.alvo = sy.alvo = 1;
      vai();
    });
    if (!botao) continue;
    el.addEventListener('pointerdown', (e) => {
      mira(e);
      luz.alvo = 1.6;
      if (!calmo) { sx.alvo = 1.04; sy.alvo = 0.975; } // estica na largura e achata um pouco
      vai();
    });
    for (const tipo of ['pointerup', 'pointercancel']) {
      el.addEventListener(tipo, (e) => {
        luz.alvo = e.pointerType === 'mouse' ? 1 : 0;
        sx.alvo = sy.alvo = 1;
        vai();
      });
    }
  }
})();
