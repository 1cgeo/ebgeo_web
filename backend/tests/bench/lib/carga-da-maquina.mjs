// Path: tests/bench/lib/carga-da-maquina.mjs
//
// QUANTO DA MAQUINA NAO ERA O EXPERIMENTO. A terceira guarda de instrumento desta pasta.
//
// AS DUAS PRIMEIRAS JA EXISTEM, e cada uma nasceu de uma tabela que mentiu. A sonda do laco vigia
// o SERVIDOR. O histograma de cada trabalhador vigia o DRIVER. Nenhuma das duas enxerga o que mais
// invalida uma medida numa maquina de trabalho: o navegador com quarenta abas, o indexador, a
// reuniao aberta noutra janela.
//
// O CASO QUE MOTIVOU ESTE ARQUIVO. A linha de base do E8 saiu com 95,9% de perda de cursor na sala
// de cem, contra 85,6% na rodada do diagnostico, e a sala de DUAS pessoas saltou de 9,1% para
// 65,1% de perda, com o backend identico entre as duas medidas. As duas leituras nao podem estar
// ambas descrevendo o sistema. Ou o cenario tem variancia enorme, ou a maquina estava ocupada com
// outra coisa. A bancada nao tinha como distinguir, e "nao tinha como distinguir" e o defeito.
//
// COMO ELE MEDE. `os.cpus()` devolve o tempo acumulado de cada nucleo, repartido em user, sys,
// nice, irq e idle. A diferenca entre duas leituras da a ocupacao REAL da maquina na janela, sem
// depender de contador de processo nenhum. Subtraindo o que o servidor e os drivers gastaram
// (medido por `process.cpuUsage()` em cada um), o que sobra e trabalho ALHEIO ao experimento.
//
// O RESIDUO E UM PISO, NAO UMA CONTA EXATA. Sobra nele o custo do proprio Postgres, que e parte
// legitima do experimento e roda em processo separado. Por isso o limiar de alarme e generoso: ele
// existe para pegar "tinha um build rodando junto", nao para auditar milissegundos.

import os from 'os';

function somaDosNucleos() {
  let ocupado = 0;
  let total = 0;
  for (const nucleo of os.cpus()) {
    const t = nucleo.times;
    const soma = t.user + t.nice + t.sys + t.irq + t.idle;
    ocupado += soma - t.idle;
    total += soma;
  }
  return { ocupado, total };
}

/**
 * Comeca a medir. Chame `parar()` no fim da janela.
 *
 * Nao ha amostragem periodica de proposito: os contadores da libuv sao cumulativos, entao duas
 * leituras bastam e custam zero durante a janela. Amostrar no meio so acrescentaria trabalho ao
 * processo que esta tentando nao atrapalhar a medida.
 */
export function medirCargaDaMaquina() {
  const inicio = somaDosNucleos();
  const t0 = Date.now();

  return {
    /**
     * @param {Object} [gastos] - CPU conhecida do experimento, em milissegundos.
     * @param {number} [gastos.servidorMs] - user + system do processo servidor.
     * @param {number} [gastos.driversMs] - user + system somados de todos os trabalhadores.
     */
    parar({ servidorMs = 0, driversMs = 0 } = {}) {
      const fim = somaDosNucleos();
      const ocupado = fim.ocupado - inicio.ocupado;
      const total = fim.total - inicio.total;
      const janelaMs = Date.now() - t0;
      const nucleos = os.cpus().length;

      const ocupacaoPct = total > 0 ? (100 * ocupado) / total : 0;
      // Em "nucleos equivalentes", que e a unidade que se compara com o `cpuPct` do servidor.
      const nucleosOcupados = (ocupacaoPct / 100) * nucleos;
      const nucleosDoExperimento = janelaMs > 0
        ? (servidorMs + driversMs) / janelaMs
        : 0;
      const nucleosAlheios = Math.max(0, nucleosOcupados - nucleosDoExperimento);

      return {
        nucleos,
        janelaMs,
        ocupacaoDaMaquinaPct: Math.round(ocupacaoPct * 10) / 10,
        nucleosOcupados: Math.round(nucleosOcupados * 100) / 100,
        nucleosDoExperimento: Math.round(nucleosDoExperimento * 100) / 100,
        nucleosAlheios: Math.round(nucleosAlheios * 100) / 100,
      };
    },
  };
}

/**
 * Veredito sobre o AMBIENTE, no mesmo molde do veredito sobre o driver.
 *
 * O limiar e em nucleos absolutos, nao em porcentagem da maquina, e a razao e pratica: meio nucleo
 * de trabalho alheio atrapalha do mesmo jeito numa maquina de quatro e numa de vinte, porque o
 * servidor e monothread e o que ele disputa e um nucleo, nao a media.
 */
export function saudeDoAmbiente(carga) {
  const alheios = carga?.nucleosAlheios ?? 0;
  if (alheios >= 2) {
    return {
      ok: false,
      nivel: 'MAQUINA OCUPADA',
      texto: `MAQUINA OCUPADA: ${alheios} nucleos gastos FORA do experimento `
        + `(${carga.ocupacaoDaMaquinaPct}% de ${carga.nucleos} nucleos no total). `
        + 'Feche o que estiver rodando e meca de novo. Estes numeros nao comparam com nada.',
    };
  }
  if (alheios >= 0.75) {
    return {
      ok: true,
      nivel: 'AMBIENTE SUJO',
      texto: `Ambiente sujo: ${alheios} nucleos fora do experimento. `
        + 'A cauda de latencia carrega disputa de CPU alheia; desconfie de p95 e p99.',
    };
  }
  return {
    ok: true,
    nivel: 'AMBIENTE LIMPO',
    texto: `Ambiente limpo: ${alheios} nucleos fora do experimento, `
      + `de ${carga?.nucleos ?? '?'} disponiveis.`,
  };
}
