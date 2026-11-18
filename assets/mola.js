// Mola física e o laço único de animação do site da Dia de Obra.
//
// Mola: rigidez e amortecimento vêm de response/dampingFraction, como o .spring() da Apple
//   rigidez = (2π / response)²   ·   amortecimento = 4π · dampingFraction / response   (massa 1)
// Integra em passos de 1/240 s e guarda posição e velocidade: trocar o alvo no meio do caminho
// continua do ponto e da velocidade atuais (interrompível). Nada aqui usa duração fixa.
//
// Laço único: um só requestAnimationFrame para o site todo (rolagem, efeitos, 3D e botões).
// Cada parte registra uma "tarefa" (fn(dt, t) → true enquanto quer o próximo quadro); o laço
// para sozinho quando nada se mexe e acorda com acorda() (rolagem, ponteiro, redimensionar).
// Script comum (não módulo), carregado antes dos outros.

window.DiaDeObraMola = (() => {
  'use strict';

  const MOLAS = {
    toque: { response: 0.3, dampingFraction: 0.7 },     // botões sólidos: afundam e voltam
    estica: { response: 0.38, dampingFraction: 0.55 },  // botões de vidro: esticam e balançam ao voltar
    posicao: { response: 0.4, dampingFraction: 0.8 },   // foto ampliada, brilho do vidro
    rolagem: { response: 0.42, dampingFraction: 1 },    // rolagem suave da roda do mouse
    derivado: { response: 0.26, dampingFraction: 1 },   // valores que seguem a rolagem
    carrossel: { response: 0.55, dampingFraction: 0.82 },
    peca: { response: 0.32, dampingFraction: 1 },       // peças da casa (seguem a rolagem nos dois sentidos)
    linha: { response: 0.5, dampingFraction: 1 },
    camera: { response: 0.7, dampingFraction: 1 },
    entrada: { response: 1.1, dampingFraction: 0.84 },  // fotos do topo chegando
  };

  class Mola {
    constructor(valor = 0, p = MOLAS.posicao, eps = 1e-3) {
      this.x = valor;
      this.v = 0;
      this.alvo = valor;
      this.eps = eps;
      this.ajusta(p);
    }
    ajusta({ response, dampingFraction }) {
      this.k = (2 * Math.PI / response) ** 2;
      this.c = (4 * Math.PI * dampingFraction) / response;
      return this;
    }
    // avança dt segundos; devolve true enquanto ainda se mexe
    passo(dt) {
      if (this.parada) return false;
      const passo = Math.min(dt, 1 / 10); // em aparelho lento a mola segue no tempo real (até 10 quadros/s)
      const n = Math.max(1, Math.ceil(passo * 240));
      const h = passo / n;
      for (let i = 0; i < n; i++) {
        const a = -this.k * (this.x - this.alvo) - this.c * this.v;
        this.v += a * h;
        this.x += this.v * h;
      }
      if (Math.abs(this.v) < this.eps && Math.abs(this.x - this.alvo) < this.eps) {
        this.x = this.alvo;
        this.v = 0;
      }
      return !this.parada;
    }
    get parada() {
      return this.v === 0 && this.x === this.alvo;
    }
    // vai direto (prefers-reduced-motion ou estado inicial)
    pula(valor) {
      this.x = this.alvo = valor;
      this.v = 0;
    }
  }

  // ── laço único ──
  const tarefas = new Set(); // rolagem, efeitos e 3D, na ordem em que se registram
  const ativas = new Set();  // molas de interface (anima)
  let raf = 0;
  let ultimo = 0;
  const medidor = { quadros: 0, desde: 0 }; // contador de quadros (para medir fps nos testes)

  function laco(ms) {
    raf = 0;
    const t = ms / 1000;
    const dt = ultimo ? Math.min(t - ultimo, 0.1) : 1 / 60;
    ultimo = t;
    medidor.quadros++;
    let segue = false;
    for (const f of tarefas) {
      try {
        if (f(dt, t)) segue = true;
      } catch (e) {
        tarefas.delete(f);
        console.warn('[Dia de Obra] tarefa de animação desligada:', e);
      }
    }
    for (const item of ativas) {
      let mexe = false;
      for (const m of item.molas) if (m.passo(dt)) mexe = true;
      item.desenha();
      if (!mexe) {
        ativas.delete(item);
        item.fim?.();
      } else segue = true;
    }
    if (segue) raf = requestAnimationFrame(laco);
    else ultimo = 0;
  }
  function acorda() {
    if (!raf && !document.hidden) raf = requestAnimationFrame(laco);
  }
  document.addEventListener('visibilitychange', () => {
    ultimo = 0;
    acorda();
  });
  // tarefa(fn): fn(dt, t) roda a cada quadro; devolve true enquanto quer continuar. Retorna o "desligar".
  function tarefa(fn) {
    tarefas.add(fn);
    acorda();
    return () => tarefas.delete(fn);
  }
  // anima({ molas: [m1, m2], desenha() {}, fim() {} }): desenha a cada quadro até as molas pararem.
  // Use sempre o mesmo objeto para a mesma peça (o Set evita rodar a mesma mola duas vezes).
  function anima(item) {
    ativas.add(item);
    acorda();
  }
  function cancela(item) {
    ativas.delete(item);
  }

  return { Mola, MOLAS, anima, cancela, tarefa, acorda, medidor };
})();
