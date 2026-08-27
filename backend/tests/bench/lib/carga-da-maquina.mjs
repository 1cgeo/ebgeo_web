// Path: tests/bench/lib/carga-da-maquina.mjs
//
// QUANTO DA MAQUINA NAO ERA O EXPERIMENTO. A terceira guarda de instrumento desta pasta.
//
// AS DUAS PRIMEIRAS JA EXISTEM, e cada uma nasceu de uma tabela que mentiu. A sonda do laco vigia
// o SERVIDOR. O histograma de cada trabalhador vigia o DRIVER. Nenhuma das duas enxerga o que mais
// invalida uma medida numa maquina de trabalho: o navegador com quarenta abas, o indexador, a
// reuniao aberta noutra janela.
//
// O CASO QUE MOTIVOU ESTE ARQUIVO, e o tamanho do estrago. Cinco linhas de base foram colhidas com
// a maquina ocupada e tiveram de ser jogadas fora. Repetidas com a maquina livre, o mesmo E10
// saiu de 303 sockets derrubados para ZERO no degrau de mil sockets, e o E8 saiu de 39 segundos de
// ack mediano para 281 milissegundos. Duas conclusoes do diagnostico eram artefato de ambiente.
//
// COMO ELE MEDE. `os.cpus()` devolve o tempo acumulado de cada nucleo. A diferenca entre duas
// leituras da a ocupacao REAL da maquina na janela, sem depender de contador de processo nenhum.
// Do total se descontam as tres parcelas que SAO o experimento: o servidor, os drivers e o
// Postgres. O que sobra e trabalho alheio.
//
// AS DUAS CORRECOES QUE A PRIMEIRA VERSAO NAO TINHA, e as duas foram medidas:
//
//   O POSTGRES E PARTE DO EXPERIMENTO. Sem desconta-lo, o proprio sucesso da bancada inflava o
//   alarme: o degrau de dois mil sockets do E10 marcou 1,73 nucleo "alheio" numa maquina
//   comprovadamente limpa, e quase todo aquele trabalho era o banco fazendo o que a bancada pediu.
//
//   TODA MAQUINA TEM UM PISO. Este Windows parado, sem nada rodando, consome 0,61 nucleo com
//   servico, indexador e barra de tarefas. Comparar o residuo contra ZERO acusa "sujo" numa
//   maquina limpa, que foi exatamente o que as primeiras rodadas com esta sonda fizeram. O piso e
//   medido no comeco de cada rodada, nunca assumido.

import os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

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
 * CPU acumulada de TODOS os processos do Postgres, em milissegundos.
 *
 * Devolve `null` quando nao consegue ler, e o chamador entao DIZ que nao descontou, em vez de
 * fingir um zero. Um desconto que falha em silencio e pior que desconto nenhum: ele vira um numero
 * confiante e errado.
 */
async function cpuDoPostgresMs() {
  try {
    if (process.platform === 'win32') {
      // `Get-Process | Measure-Object CPU` NAO SERVE, e o modo de falha dele e o pior possivel.
      // O Postgres roda como servico, sob outra conta, e `TotalProcessorTime` volta NULO para
      // quem nao esta elevado. `Measure-Object` soma nulos como ZERO, entao a bancada recebia um
      // desconto de zero com cara de medida boa: dez processos vivos, 120 s de CPU acumulada, e a
      // sonda relatando "postgres 0". `Win32_Process` expoe `KernelModeTime` e `UserModeTime` em
      // unidades de 100 ns, e os le sem elevacao.
      const { stdout } = await execFileAsync('powershell', [
        '-NoProfile', '-Command',
        "$p = @(Get-CimInstance Win32_Process -Filter \"Name='postgres.exe'\"); "
        + 'if ($p.Count -eq 0) { "0 0" } else { '
        + '$k = ($p | Measure-Object KernelModeTime -Sum).Sum; '
        + '$u = ($p | Measure-Object UserModeTime -Sum).Sum; '
        + '"$($p.Count) $((($k + $u) / 10000))" }',
      ]);
      const [quantos, ms] = String(stdout).trim().split(/\s+/).map(Number);
      if (!Number.isFinite(quantos) || !Number.isFinite(ms)) return null;
      // Processo vivo com CPU zerada significa que NAO deu para ler, nunca que ele nao trabalhou.
      if (quantos > 0 && ms === 0) return null;
      return ms;
    }
    const { stdout } = await execFileAsync('sh', ['-c', 'ps -eo comm=,time= | grep -i postgres']);
    let ms = 0;
    for (const linha of String(stdout).trim().split('\n')) {
      const t = linha.trim().split(/\s+/).pop();
      const partes = String(t).split(':').map(Number);
      if (partes.some((n) => !Number.isFinite(n))) continue;
      const seg = partes.length === 3
        ? partes[0] * 3600 + partes[1] * 60 + partes[2]
        : partes[0] * 60 + partes[1];
      ms += seg * 1000;
    }
    return ms;
  } catch {
    return null;
  }
}

/**
 * Mede o PISO da maquina: quanto ela consome com o experimento ainda parado.
 *
 * Chamado uma vez por rodada, antes de o servidor subir. Custa os segundos que recebe e paga por
 * si so na primeira vez que evita descartar uma medida boa.
 */
export async function medirPisoDaMaquina(ms = 3000) {
  const inicio = somaDosNucleos();
  await new Promise((r) => setTimeout(r, ms));
  const fim = somaDosNucleos();
  const ocupado = fim.ocupado - inicio.ocupado;
  const total = fim.total - inicio.total;
  const nucleos = os.cpus().length;
  const pct = total > 0 ? ocupado / total : 0;
  return Math.round(pct * nucleos * 100) / 100;
}

/**
 * Comeca a medir a janela. Chame `parar()` no fim dela.
 *
 * Nao ha amostragem periodica de proposito: os contadores sao cumulativos, entao duas leituras
 * bastam e custam zero durante a janela. Amostrar no meio so acrescentaria trabalho ao processo
 * que esta tentando nao atrapalhar a medida.
 */
export async function medirCargaDaMaquina() {
  const inicio = somaDosNucleos();
  const pg0 = await cpuDoPostgresMs();
  const t0 = Date.now();

  return {
    /**
     * @param {Object} [gastos] - CPU conhecida do experimento, em milissegundos.
     * @param {number} [gastos.servidorMs] - user + system do processo servidor.
     * @param {number} [gastos.driversMs] - user + system somados de todos os drivers.
     */
    async parar({ servidorMs = 0, driversMs = 0 } = {}) {
      const fim = somaDosNucleos();
      const pg1 = await cpuDoPostgresMs();
      const postgresMs = pg0 != null && pg1 != null ? Math.max(0, pg1 - pg0) : null;

      const ocupado = fim.ocupado - inicio.ocupado;
      const total = fim.total - inicio.total;
      const janelaMs = Date.now() - t0;
      const nucleos = os.cpus().length;

      const ocupacaoPct = total > 0 ? (100 * ocupado) / total : 0;
      // Em "nucleos equivalentes", que e a unidade que se compara com o `cpuPct` do servidor.
      const nucleosOcupados = (ocupacaoPct / 100) * nucleos;
      const nucleosDoExperimento = janelaMs > 0
        ? (servidorMs + driversMs + (postgresMs ?? 0)) / janelaMs
        : 0;
      const nucleosAlheios = Math.max(0, nucleosOcupados - nucleosDoExperimento);

      return {
        nucleos,
        janelaMs,
        ocupacaoDaMaquinaPct: Math.round(ocupacaoPct * 10) / 10,
        nucleosOcupados: Math.round(nucleosOcupados * 100) / 100,
        nucleosDoExperimento: Math.round(nucleosDoExperimento * 100) / 100,
        nucleosDoPostgres: postgresMs != null && janelaMs > 0
          ? Math.round((postgresMs / janelaMs) * 100) / 100
          : null,
        descontouPostgres: postgresMs != null,
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
 * servidor e monothread e o que ele disputa e UM nucleo, nunca a media.
 *
 * @param {Object} carga - De `medirCargaDaMaquina().parar()`.
 * @param {number} [piso=0] - De `medirPisoDaMaquina()`, medido antes da rodada.
 */
export function saudeDoAmbiente(carga, piso = 0) {
  const alheios = Math.round(Math.max(0, (carga?.nucleosAlheios ?? 0) - piso) * 100) / 100;
  const nota = carga?.descontouPostgres === false
    ? ' (NAO foi possivel descontar o Postgres, entao este numero e um teto)'
    : '';
  const contexto = `${alheios} nucleos alheios${nota}, `
    + `de ${carga?.nucleos ?? '?'} | piso medido ${piso} | `
    + `postgres ${carga?.nucleosDoPostgres ?? 'nao medido'}`;

  if (alheios >= 2) {
    return {
      ok: false,
      nivel: 'MAQUINA OCUPADA',
      alheios,
      texto: `MAQUINA OCUPADA: ${contexto}. `
        + 'Feche o que estiver rodando e meca de novo. Estes numeros nao comparam com nada.',
    };
  }
  if (alheios >= 1) {
    return {
      ok: true,
      nivel: 'AMBIENTE SUJO',
      alheios,
      texto: `Ambiente sujo: ${contexto}. `
        + 'A cauda de latencia carrega disputa de CPU alheia; leia p50 e desconfie de p95 e p99.',
    };
  }
  return {
    ok: true,
    nivel: 'AMBIENTE LIMPO',
    alheios,
    texto: `Ambiente limpo: ${contexto}.`,
  };
}
