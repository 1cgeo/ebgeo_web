// Path: tests/bench/lib/linha-de-base.mjs
//
// GRAVAR E COMPARAR LINHA DE BASE. O que transforma "acho que melhorou" em um numero.
//
// POR QUE ISTO E PRE-REQUISITO, E NAO BUROCRACIA. Os numeros do diagnostico foram colhidos ao
// longo de uma investigacao, com o instrumento sendo consertado no meio dela. Eles servem para
// DIAGNOSTICAR. Nao servem de referencia para medir melhoria, porque nao foram todos produzidos
// pelo mesmo instrumento. Comparar contra numero lembrado, ou contra numero de outra versao da
// bancada, e o jeito de aprovar uma mudanca que nao mudou nada.
//
// A BANDA DE RUIDO E MEDIDA, NAO ARBITRADA. Duas rodadas do MESMO codigo nao dao o mesmo numero.
// Antes de acreditar em qualquer melhora, a mesma bancada roda duas vezes sem mudanca nenhuma, e o
// espalhamento observado vira a banda. Uma variacao dentro dela nao e resultado, e a tabela diz
// isso com todas as letras em vez de deixar o leitor decidir sozinho.
//
// A DIRECAO DE CADA COLUNA IMPORTA. Uma queda de 30% em `ops/s` e uma regressao; a mesma queda em
// `ackP95` e o objetivo. Sem essa tabela de direcao, um comparador imprime porcentagens e deixa a
// interpretacao para quem esta torcendo.
//
// Uso:
//   node tests/bench/sala-limite.bench.mjs --gravar-base
//   node tests/bench/sala-limite.bench.mjs --comparar tests/bench/baselines/2026-08-26/sala-limite.json

import fs from 'fs';
import path from 'path';
import { tabela, round } from './metricas.mjs';

/** Colunas em que MENOS e melhor. Casadas por prefixo, para pegar `ackP50`, `entregaP99` etc. */
const MENOS_E_MELHOR = [
  'p50', 'p95', 'p99', 'max', 'ackP', 'entregaP', 'lacoP', 'lacoMax', 'driverP', 'cpuPct',
  'usoLacoPct', 'rssMB', 'perdaCursorPct', 'perdaEntrega', 'derrubados', 'fechados', 'erros',
  'semVeredito', 'aRetentar', '503', 'lockPico', 'conexPico', 'pgConex', 'pgLock',
  'convDivergentes', 'recusados',
];

/** Colunas em que MAIS e melhor. */
const MAIS_E_MELHOR = [
  'ops/s', 'lotes/s', 'cursorRec/s', 'ok', 'conectados', 'acked', 'convConferidos',
];

function direcao(coluna) {
  if (MAIS_E_MELHOR.some((c) => coluna === c)) return 'mais';
  if (MENOS_E_MELHOR.some((c) => coluna.startsWith(c))) return 'menos';
  return null; // neutra: eixo do degrau, demanda, contagem de entrada
}

/** `--nome valor` do argv, ou null. */
function argTexto(nome) {
  const i = process.argv.indexOf(`--${nome}`);
  return i === -1 ? null : process.argv[i + 1];
}

/** Nome do cenario deduzido do arquivo que esta rodando. Evita repetir a string em cada bancada. */
export function cenarioAtual() {
  return path.basename(process.argv[1] || 'desconhecido').replace(/\.bench\.mjs$/, '');
}

/**
 * Grava a linha de base, se `--gravar-base` estiver presente.
 *
 * O caminho padrao carrega a DATA no diretorio de proposito: uma linha de base sem data e uma
 * afirmacao sobre "o sistema", quando na verdade e uma afirmacao sobre o sistema naquele dia,
 * naquela maquina, naquele commit.
 *
 * @param {Object} opts
 * @param {Array<Object>} opts.linhas - As linhas da tabela do relatorio.
 * @param {Object} opts.cabecalho - O cabecalho da rodada (maquina, commit, configuracao).
 * @param {string} [opts.chave='degrau'] - Coluna que identifica a linha entre rodadas.
 * @param {string} [opts.data] - Sobrescreve a data do diretorio. Sem isso, o chamador passa a sua.
 */
export function gravarBase({ linhas, cabecalho, chave = 'degrau', data, sufixo = '' }) {
  if (!process.argv.includes('--gravar-base')) return null;
  const cenario = cenarioAtual() + (sufixo ? `-${sufixo}` : '');
  // A data vem do relogio da maquina e vai para o DIRETORIO. Linha de base sem data e uma
  // afirmacao sobre "o sistema", quando e uma afirmacao sobre aquele dia, maquina e commit.
  const dia = data ?? new Date().toISOString().slice(0, 10);
  const dir = path.join('tests', 'bench', 'baselines', dia);
  fs.mkdirSync(dir, { recursive: true });
  const caminho = path.join(dir, `${cenario}.json`);
  fs.writeFileSync(caminho, JSON.stringify({ cenario, cabecalho, chave, linhas }, null, 2));
  console.log(`\n  Linha de base gravada em ${caminho}`);
  return caminho;
}

/**
 * Compara com uma linha de base, se `--comparar <arquivo>` estiver presente.
 *
 * A COMPARACAO E POR LINHA E POR COLUNA, nunca por um numero resumo. Uma mudanca que melhora a
 * sala de 400 e piora a de 10 nao pode aparecer como "melhorou 12%".
 *
 * @param {Object} opts
 * @param {Array<Object>} opts.linhas
 * @param {number} [opts.bandaPct=10] - Abaixo disso a variacao e declarada ruido, nao resultado.
 * @returns {{ ok: boolean, regressoes: Array }|null}
 */
export function compararComBase({ linhas, bandaPct = 10 }) {
  const caminho = argTexto('comparar');
  if (!caminho) return null;
  if (!fs.existsSync(caminho)) {
    console.log(`\n  AVISO: linha de base nao encontrada em ${caminho}. Nada a comparar.`);
    return null;
  }

  const base = JSON.parse(fs.readFileSync(caminho, 'utf8'));
  const chave = base.chave ?? 'degrau';
  const porChave = new Map(base.linhas.map((l) => [String(l[chave]), l]));

  console.log(`\n  COMPARACAO COM ${caminho}`);
  if (base.cabecalho?.commit && base.cabecalho.commit !== 'desconhecido') {
    console.log(`  Base colhida no commit ${base.cabecalho.commit}, `
      + `${base.cabecalho.cpus} CPUs, pool ${base.cabecalho.poolMax}.`);
  }

  const deltas = [];
  const regressoes = [];
  const melhorias = [];

  for (const agora of linhas) {
    const antes = porChave.get(String(agora[chave]));
    if (!antes) {
      deltas.push({ [chave]: agora[chave], coluna: '(linha nova)', antes: '-', depois: '-', variacao: '-', leitura: 'SEM BASE' });
      continue;
    }
    for (const coluna of Object.keys(agora)) {
      const dir = direcao(coluna);
      if (!dir) continue;
      const a = Number(antes[coluna]);
      const d = Number(agora[coluna]);
      if (!Number.isFinite(a) || !Number.isFinite(d)) continue;

      // Variacao relativa. Com base zero nao existe porcentagem, e a diferenca absoluta e o que
      // informa: sair de 0 para 27 sockets derrubados e o resultado, nao "infinito por cento".
      const varPct = a === 0 ? null : round(((d - a) / Math.abs(a)) * 100, 1);
      const melhorou = dir === 'menos' ? d < a : d > a;
      const dentroDaBanda = varPct !== null && Math.abs(varPct) < bandaPct;

      let leitura;
      if (a === d) leitura = 'igual';
      else if (dentroDaBanda) leitura = 'ruido';
      else if (melhorou) { leitura = 'MELHOROU'; melhorias.push({ ...agora, coluna }); }
      else { leitura = 'PIOROU'; regressoes.push({ chave: agora[chave], coluna, antes: a, depois: d }); }

      if (leitura === 'igual' || leitura === 'ruido') continue;
      deltas.push({
        [chave]: agora[chave],
        coluna,
        antes: a,
        depois: d,
        variacao: varPct === null ? `${d - a} absoluto` : `${varPct > 0 ? '+' : ''}${varPct}%`,
        leitura,
      });
    }
  }

  if (deltas.length === 0) {
    console.log(`  Nada fora da banda de ${bandaPct}%. A rodada e indistinguivel da base.`);
    return { ok: true, regressoes: [] };
  }

  tabela(deltas, [chave, 'coluna', 'antes', 'depois', 'variacao', 'leitura']);
  console.log(`\n  ${melhorias.length} melhoras e ${regressoes.length} regressoes fora da `
    + `banda de ${bandaPct}%. Variacao dentro da banda foi omitida.`);
  if (regressoes.length > 0) {
    console.log('  ATENCAO: regressao e resultado tanto quanto melhora. Nao publique so metade.');
  }
  return { ok: regressoes.length === 0, regressoes };
}

/** Faz as duas coisas, na ordem certa, com uma chamada so. */
export function baseDaRodada({
  linhas, cabecalho, chave = 'degrau', data, sufixo = '', bandaPct = 10,
}) {
  gravarBase({ linhas, cabecalho, chave, data, sufixo });
  return compararComBase({ linhas, bandaPct });
}
