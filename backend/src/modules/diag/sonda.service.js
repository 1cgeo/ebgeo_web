// Path: src/modules/diag/sonda.service.js
/**
 * @fileoverview O LEITOR DO JSONL DA SONDA DE DISPONIBILIDADE, que é a única fonte do resumo que
 * NÃO é escrita por este processo.
 *
 * POR QUE ELA EXISTE, e por que o bloco de disponibilidade precisava dela. A queda que o resumo
 * já contava é a vista pelo CLIENTE (`origem: 'indisponivel'`), e ela chega ENFILEIRADA: o
 * navegador não consegue relatar enquanto o servidor está fora, então o relato só sobe na próxima
 * carga bem-sucedida. Uma queda em curso, portanto, não aparece; e uma queda de madrugada, sem
 * ninguém com o produto aberto, não aparece nunca. A sonda bate em `GET /api/v1/health` de fora,
 * num relógio próprio, e grava uma linha por batida: é a única testemunha de uma queda que o
 * próprio servidor, estando fora, não teria como registrar. Ela existia desde antes deste lote e
 * não estava agendada nem lida por ninguém (achado F23).
 *
 * A PREMISSA DELA VIAJA JUNTO, E É A METADE QUE IMPORTA. O que ela mede depende de ONDE ela roda:
 * na mesma máquina do servidor, ela cai junto com ele, e a evidência da queda passa a ser a
 * AUSÊNCIA de linhas e não uma linha com `disponivel: false`. Por isso o bloco publica a contagem
 * de medições ao lado da de indisponíveis: quem lê precisa poder comparar quantas batidas
 * esperava com quantas apareceram. Publicar só a taxa de indisponibilidade seria a mentira exata
 * que este arquivo existe para não contar.
 *
 * SEM SONDA NÃO É ZERO QUEDA, e é o único desfecho que este leitor precisa acertar: diretório
 * ausente, nenhum arquivo, ou nenhuma linha na janela devolvem `null`, e `montarResumo` vira isso
 * numa frase que diz "sem sonda". Devolver `{ indisponiveis: 0 }` a partir de arquivo nenhum
 * seria anunciar disponibilidade perfeita com base em medição nenhuma.
 *
 * O LEITOR NÃO TEM ANEL, ao contrário do de log, e a razão é a ordem de grandeza: a sonda bate a
 * cada trinta segundos, então um dia inteiro são cerca de 2880 linhas curtas, contra as centenas
 * de milhares que um dia de log pode ter. O teto aqui é o número de ARQUIVOS abertos, que é o
 * mesmo teto de dias da janela.
 */

import { readdir, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

/** Um dia em ms. */
const DIA_MS = 86400000;

/** Teto de arquivos abertos numa leitura, igual ao da janela de log. */
const MAX_ARQUIVOS = 7;

/**
 * Os nomes de arquivo da janela, do mais antigo para o mais novo.
 *
 * O NOME CARREGA A DATA (`<prefixo>-YYYY-MM-DD.jsonl`), e o prefixo é escolhido por quem agenda a
 * sonda: por isso o casamento é pelo SUFIXO de data e não por um prefixo fixo. Duas sondas
 * gravando no mesmo diretório (dois pontos de observação) somam, que é o comportamento certo.
 * @param {string[]} nomes - Conteúdo do diretório.
 * @param {number} inicio - Epoch ms do começo da janela.
 * @param {number} fim - Epoch ms do fim.
 * @returns {string[]}
 */
export function arquivosDaJanela(nomes, inicio, fim) {
  const dias = new Set();
  // UM DIA A MAIS PARA TRÁS: o arquivo é nomeado pela data UTC e a janela é um instante, então a
  // primeira linha da janela pode morar no arquivo do dia anterior em qualquer fuso a leste.
  for (let t = inicio - DIA_MS; t <= fim + DIA_MS; t += DIA_MS) {
    dias.add(new Date(t).toISOString().slice(0, 10));
  }
  dias.add(new Date(fim).toISOString().slice(0, 10));
  return nomes
    .filter((nome) => {
      const casou = /-(\d{4}-\d{2}-\d{2})\.jsonl$/.exec(nome);
      return casou !== null && dias.has(casou[1]);
    })
    .sort()
    .slice(-MAX_ARQUIVOS);
}

/**
 * Resume uma lista de batidas JÁ recortada pela janela e ORDENADA por `time`.
 *
 * `maiorSequencia` É CONTAGEM DE BATIDAS SEGUIDAS, e não duração, e a escolha é deliberada. A
 * duração de uma queda entre a primeira e a última batida falha é ZERO quando só uma batida
 * falhou, o que se lê como "não houve queda" sobre a evidência de que houve. O intervalo entre
 * batidas é decisão de quem agenda e este arquivo não o conhece, então ele publica o que mediu (o
 * número de batidas seguidas) e deixa a conversão para quem sabe o período.
 * @param {Array<{time: number, disponivel: boolean}>} batidas
 * @returns {{medicoes: number, indisponiveis: number, maiorSequencia: number, ultimaEm: number,
 *   ultimaDisponivel: boolean}}
 */
export function resumirBatidas(batidas) {
  let indisponiveis = 0;
  let maiorSequencia = 0;
  let sequencia = 0;
  for (const batida of batidas) {
    if (batida.disponivel === true) {
      sequencia = 0;
      continue;
    }
    indisponiveis += 1;
    sequencia += 1;
    if (sequencia > maiorSequencia) maiorSequencia = sequencia;
  }
  const ultima = batidas[batidas.length - 1];
  return {
    medicoes: batidas.length,
    indisponiveis,
    maiorSequencia,
    ultimaEm: ultima.time,
    ultimaDisponivel: ultima.disponivel === true,
  };
}

/**
 * Lê o que a sonda registrou na janela.
 *
 * @param {Object} p
 * @param {string} p.diretorio - Onde os `.jsonl` da sonda moram.
 * @param {number} p.inicio - Epoch ms do começo da janela.
 * @param {number} p.fim - Epoch ms do fim.
 * @returns {Promise<Object|null>} `null` quando NÃO HÁ SONDA a ler (diretório ausente, sem
 *   arquivo na janela, ou sem uma linha sequer): os três são o mesmo fato para quem lê, e nenhum
 *   deles é zero queda.
 */
export async function lerSonda({ diretorio, inicio, fim }) {
  const dir = resolve(diretorio);
  let nomes;
  try {
    nomes = await readdir(dir);
  } catch {
    // Diretório ausente é o estado normal de quem não agendou a sonda, e não um erro a propagar:
    // o resumo inteiro morreria por causa de uma fonte opcional.
    return null;
  }

  const arquivos = arquivosDaJanela(nomes, inicio, fim);
  if (arquivos.length === 0) return null;

  const batidas = [];
  for (const nome of arquivos) {
    let bruto;
    try {
      bruto = await readFile(join(dir, nome), 'utf8');
    } catch { continue; }
    for (const linha of bruto.split('\n')) {
      if (linha.length === 0) continue;
      let reg;
      try { reg = JSON.parse(linha); } catch { continue; }
      // SEM `time` A LINHA NÃO ENTRA, ao contrário do log, e a diferença é que aqui o `time` é o
      // sujeito: uma batida sem instante não pode ser posta em sequência, e sequência é a única
      // coisa que este resumo calcula.
      if (typeof reg?.time !== 'number' || reg.time < inicio || reg.time > fim) continue;
      batidas.push(reg);
    }
  }
  if (batidas.length === 0) return null;

  batidas.sort((a, b) => a.time - b.time);
  return { diretorio: dir, arquivos: arquivos.length, ...resumirBatidas(batidas) };
}
