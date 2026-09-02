// Path: scripts/diag/mapa-de-fonte.js
/**
 * @fileoverview Um decodificador de source map v3, escrito à mão, para `npm run diag -- pilha`.
 *
 * POR QUE SEM DEPENDÊNCIA. A biblioteca `source-map` resolveria isto, e foi recusada de
 * propósito: este pacote é o servidor de produção de uma rede fechada, e a peça que se está
 * comprando roda EXCLUSIVAMENTE num comando de diagnóstico que um humano dispara à mão.
 * Uma dependência nova entra no `npm ci` do deploy, no `npm audit` e na superfície do
 * processo que atende sync e `GET /api/config`, para servir um caminho que nenhuma
 * requisição alcança. O algoritmo inteiro é o VLQ base64 abaixo mais uma busca binária: são
 * setenta linhas de código e nenhuma delas é ambígua na especificação.
 *
 * ZERO IMPORTS, e isso é contrato pelo mesmo motivo de `origens-de-erro.js`: o teste o
 * carrega em node puro, sem `DATABASE_URL` e sem `JWT_SECRET`.
 *
 * ─── A CONVENÇÃO DE BASE, que é onde se erra por um ───
 *
 * O arquivo `.map` é 0-BASED nas duas coordenadas, nas duas pontas (linha e coluna, gerada e
 * original). Um rastro de pilha de navegador é 1-BASED nas duas (`core-Ab12.js:1:23456`
 * quer dizer primeira linha, coluna 23456 contada a partir de um). As duas convenções são
 * incompatíveis e nada no formato avisa qual está em uso, então esta é a fronteira onde a
 * tradução acontece, escrita por extenso:
 *
 *   ENTRADA de `resolver`:  `linha` 1-BASED, `coluna` 0-BASED.
 *   SAÍDA de `resolver`:    `linha` 1-BASED, `coluna` 0-BASED.
 *
 * Ou seja, a linha é a que o navegador imprime e a coluna é a do navegador MENOS UM. A
 * conversão da coluna NÃO acontece aqui, e sim em quem lê o texto da pilha
 * (`colunaDeQuadro`, em `scripts/diag/pilha.js`), porque só lá se sabe que o número veio de
 * um rastro de V8. Uma coluna errada por um não levanta erro nenhum: ela devolve o segmento
 * anterior quando cai exatamente na fronteira de um, e o resultado é um nome de função
 * plausível e errado, que é o pior desfecho que este comando pode ter.
 */

/** O alfabeto base64 na ordem canônica; o índice é o valor de 6 bits. */
const ALFABETO = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** `char -> valor`, montado uma vez para não pagar `indexOf` por caractere. */
const VALOR_DO_CARACTERE = new Map(
  Array.from(ALFABETO, (c, i) => [c, i])
);

/** O bit de continuação do VLQ (o sexto), e a máscara dos cinco de dado. */
const CONTINUACAO = 0b100000;
const DADO = 0b011111;

/**
 * O maior deslocamento que um numero VLQ pode pedir aqui.
 *
 * Sete grupos de cinco bits cobrem 35 bits, que é o bastante para qualquer coluna gerada de
 * bundle real e para o bit de sinal em cima dela. Passar disso não é número grande, é
 * `mappings` corrompido, e continuar somando produziria em silêncio um valor que não está
 * escrito no arquivo.
 */
const DESLOCAMENTO_MAXIMO = 30;

/**
 * Decodifica um segmento VLQ base64 inteiro na lista de números que ele carrega.
 *
 * O SINAL É O BIT MENOS SIGNIFICATIVO do valor montado, não um caractere à parte, e essa é a
 * única parte contraintuitiva do formato: `-1` e `1` diferem só nele. Daí a divisão por dois
 * depois do teste de paridade, e não uma divisão com `Math.abs`.
 *
 * TODA A ARITMÉTICA É EM PONTO FLUTUANTE, e nenhuma linha usa `<<`, `>>` ou `&` sobre o
 * ACUMULADO. Os operadores de bit do JavaScript truncam para 32 bits COM SINAL, então o
 * primeiro campo que passasse de `2 ** 30` sairia daqui NEGATIVO, sem erro nenhum, e um
 * delta negativo plausível é exatamente a classe de defeito que este arquivo existe para
 * não ter. Segmento que peça mais de sete grupos de cinco bits é recusado em voz alta
 * (`DESLOCAMENTO_MAXIMO`), porque ali não é número grande, é arquivo corrompido.
 *
 * `-0` É UM VALOR REPRESENTÁVEL AQUI (`u === 1`), e ele é normalizado para `0`: um delta de
 * menos zero é zero, e deixar `-0` escapar faria uma comparação `Object.is` em teste
 * reprovar por uma diferença que não existe no domínio.
 *
 * Caractere fora do alfabeto LANÇA em vez de ser pulado. Um `.map` truncado ou servido como
 * HTML de erro cai aqui, e pular o lixo produziria um mapeamento silenciosamente deslocado,
 * ou seja, uma pilha plausível e errada.
 *
 * @param {string} texto - um segmento (o trecho entre duas vírgulas do campo `mappings`)
 * @returns {number[]} os campos do segmento, já com sinal
 */
export function decodificarVlq(texto) {
  const numeros = [];
  let acumulado = 0;
  let deslocamento = 0;
  let iniciado = false;

  const bruto = String(texto);
  for (let i = 0; i < bruto.length; i += 1) {
    const valor = VALOR_DO_CARACTERE.get(bruto[i]);
    if (valor === undefined) {
      // A POSIÇÃO, NUNCA O CARACTERE. O `.map` chega de um diretório que o operador aponta,
      // e o endereço que levou até ele veio de uma pilha escrita por uma rota ANÔNIMA:
      // ecoar um byte do arquivo na mensagem de erro é um canal de leitura, ainda que
      // estreito. O índice basta para achar o defeito com um editor.
      throw new Error(`caractere fora do alfabeto base64 no mappings, na posição ${i}`);
    }
    iniciado = true;
    // MULTIPLICAÇÃO, NUNCA `<<`, e a razão é que `<<` opera em 32 bits COM SINAL: a partir
    // do bit 31 ele devolve número NEGATIVO, calado, então um `2 ** 30` legítimo
    // decodificaria como um valor negativo plausível. Pela mesma razão o sinal é lido com
    // resto e divisão, e não com `& 1` e `>> 1`, que são os mesmos 32 bits.
    acumulado += (valor & DADO) * 2 ** deslocamento;
    if (valor & CONTINUACAO) {
      deslocamento += 5;
      if (deslocamento > DESLOCAMENTO_MAXIMO) {
        throw new Error('número VLQ longo demais no mappings: o arquivo está corrompido');
      }
      continue;
    }
    const negativo = acumulado % 2 === 1;
    const magnitude = Math.floor(acumulado / 2);
    numeros.push(negativo && magnitude !== 0 ? -magnitude : magnitude);
    acumulado = 0;
    deslocamento = 0;
    iniciado = false;
  }

  if (iniciado) throw new Error('mappings termina no meio de um número VLQ (bit de continuação pendente)');
  return numeros;
}

/**
 * Decodifica o campo `mappings` inteiro em linhas de segmentos com valores ABSOLUTOS.
 *
 * O QUE O FORMATO GUARDA SÃO DELTAS, e o estado deles NÃO é uniforme: a coluna gerada zera a
 * cada `;` (cada linha do arquivo gerado recomeça do zero), enquanto índice de fonte, linha
 * original, coluna original e índice de nome ACUMULAM através das linhas. Zerar os quatro
 * junto com a coluna é o erro clássico, e ele não quebra nada: produz um mapa que resolve
 * para o começo do arquivo em toda parte.
 *
 * SEGMENTO DE UM CAMPO SÓ É LEGÍTIMO e significa "aqui começa código sem origem conhecida"
 * (o preâmbulo de um bundler, um trecho injetado). Ele entra na lista com `fonte: null`,
 * porque ele PARTICIPA da busca: uma posição que caia nele não pertence ao segmento anterior,
 * e devolvê-lo como se pertencesse inventaria uma origem.
 *
 * @param {string} mappings
 * @returns {Array<Array<{colunaGerada: number, indiceDaFonte: number|null,
 *   linhaOriginal: number|null, colunaOriginal: number|null, indiceDoNome: number|null}>>}
 */
export function decodificarMappings(mappings) {
  const linhas = [];
  let fonte = 0;
  let linhaOriginal = 0;
  let colunaOriginal = 0;
  let nome = 0;

  for (const textoDaLinha of String(mappings).split(';')) {
    const segmentos = [];
    let colunaGerada = 0;
    for (const textoDoSegmento of textoDaLinha.split(',')) {
      if (textoDoSegmento === '') continue;
      const campos = decodificarVlq(textoDoSegmento);
      if (campos.length !== 1 && campos.length !== 4 && campos.length !== 5) {
        throw new Error(`segmento com ${campos.length} campo(s); a especificação admite 1, 4 ou 5`);
      }
      colunaGerada += campos[0];
      if (campos.length === 1) {
        segmentos.push({
          colunaGerada, indiceDaFonte: null, linhaOriginal: null, colunaOriginal: null, indiceDoNome: null,
        });
        continue;
      }
      fonte += campos[1];
      linhaOriginal += campos[2];
      colunaOriginal += campos[3];
      if (campos.length === 5) nome += campos[4];
      segmentos.push({
        colunaGerada,
        indiceDaFonte: fonte,
        linhaOriginal,
        colunaOriginal,
        indiceDoNome: campos.length === 5 ? nome : null,
      });
    }
    linhas.push(segmentos);
  }
  return linhas;
}

/**
 * O decodificado de cada mapa, guardado pelo OBJETO do mapa.
 *
 * `pilha` resolve dezenas de quadros contra o mesmo `.map` de alguns MB, e decodificar o
 * `mappings` a cada quadro é o único custo desta peça que importa. `WeakMap` e não `Map`
 * porque a chave é o objeto do JSON já parseado: quando ele sai de escopo, o decodificado
 * sai junto, sem ninguém lembrar de limpar nada.
 */
const decodificadoPorMapa = new WeakMap();

/**
 * Valida a forma do mapa e devolve as linhas decodificadas, memoizadas.
 *
 * A VALIDAÇÃO LANÇA, e não devolve nulo, porque os dois desfechos são diferentes e o
 * comando os imprime diferente: "não achei o `.map`" é rotina (nem todo bundle publica um),
 * e "achei um arquivo que não é um source map" é o disco mentindo. Confundir os dois faria
 * um `.map` corrompido se ler como ausente, que é o estado em que ninguém investiga.
 *
 * SOURCE MAP INDEXADO (com `sections`) É RECUSADO POR NOME, e não ignorado: ele é um formato
 * legítimo da mesma versão 3, sem `mappings` na raiz, e um decodificador que caísse no ramo
 * de erro genérico mandaria o operador procurar corrupção onde há só um formato não
 * suportado. O Vite não emite indexados nesta configuração; se um dia emitir, esta é a
 * mensagem que diz o que aconteceu.
 *
 * @param {Object} mapa - o JSON do `.map` já parseado
 * @returns {ReturnType<typeof decodificarMappings>}
 */
function linhasDoMapa(mapa) {
  const guardado = decodificadoPorMapa.get(mapa);
  if (guardado) return guardado;

  if (!mapa || typeof mapa !== 'object') throw new Error('source map ausente ou não é um objeto');
  if (Array.isArray(mapa.sections)) {
    throw new Error('source map INDEXADO (campo `sections`): formato não suportado por este decodificador');
  }
  // O VALOR DE `version` NÃO ENTRA NA MENSAGEM, pela regra que vale para todo campo lido
  // deste arquivo: ele é conteúdo, e a saída deste comando acaba colada em relatório. Dizer
  // que a versão não é 3 já manda olhar a linha certa.
  if (mapa.version !== 3) throw new Error('source map de versão diferente de 3, que é a única suportada');
  if (typeof mapa.mappings !== 'string') throw new Error('source map sem o campo `mappings` como texto');
  if (!Array.isArray(mapa.sources)) throw new Error('source map sem o campo `sources` como lista');

  const linhas = decodificarMappings(mapa.mappings);
  decodificadoPorMapa.set(mapa, linhas);
  return linhas;
}

/**
 * O segmento que cobre uma coluna gerada: o MAIOR cuja coluna seja MENOR OU IGUAL à pedida.
 *
 * É a "greatest lower bound", e ela é o coração da resolução: os segmentos marcam onde cada
 * trecho de origem COMEÇA, então uma posição no meio de um trecho não casa segmento nenhum
 * por igualdade. Buscar igualdade exata devolveria `null` para a esmagadora maioria dos
 * quadros de uma pilha real, porque a coluna de uma chamada quase nunca é a primeira coluna
 * do trecho que a contém.
 *
 * A busca é BINÁRIA porque uma linha de bundle minificado tem dezenas de milhares de
 * segmentos e uma pilha tem dezenas de quadros. A lista já vem ordenada por construção (o
 * `mappings` é escrito em ordem crescente de coluna gerada dentro de cada linha), e essa é a
 * premissa que a busca binária usa.
 *
 * @param {Array<{colunaGerada: number}>} segmentos
 * @param {number} coluna
 * @returns {number} o índice do segmento, ou -1 se a coluna é anterior a todos
 */
export function indiceDoSegmento(segmentos, coluna) {
  let baixo = 0;
  let alto = segmentos.length - 1;
  let achado = -1;
  while (baixo <= alto) {
    const meio = (baixo + alto) >> 1;
    if (segmentos[meio].colunaGerada <= coluna) {
      achado = meio;
      baixo = meio + 1;
    } else {
      alto = meio - 1;
    }
  }
  return achado;
}

/**
 * A posição ORIGINAL de uma posição gerada, ou `null` quando o mapa não a cobre.
 *
 * `null` TEM TRÊS CAUSAS e o chamador não precisa distingui-las, porque a resposta é a mesma
 * (mostrar o quadro cru): a linha gerada está fora do mapa, a linha não tem segmento nenhum,
 * ou a coluna é anterior ao primeiro segmento da linha. O que ele NÃO pode fazer é cair no
 * segmento vizinho para "aproveitar", que é como se inventa uma origem.
 *
 * Ver a convenção de base no cabeçalho do arquivo: `linha` entra e sai 1-BASED, `coluna`
 * entra e sai 0-BASED.
 *
 * @param {Object} mapa - o JSON do `.map` já parseado
 * @param {{linha: number, coluna: number}} posicao - na saída do bundler
 * @returns {{fonte: string, linha: number, coluna: number, nome: string|null}|null}
 */
export function resolver(mapa, { linha, coluna }) {
  if (!Number.isInteger(linha) || linha < 1) return null;
  if (!Number.isInteger(coluna) || coluna < 0) return null;

  const linhas = linhasDoMapa(mapa);
  const segmentos = linhas[linha - 1];
  if (!segmentos || segmentos.length === 0) return null;

  const indice = indiceDoSegmento(segmentos, coluna);
  if (indice < 0) return null;

  const segmento = segmentos[indice];
  if (segmento.indiceDaFonte === null) return null;

  const fonte = mapa.sources[segmento.indiceDaFonte];
  if (typeof fonte !== 'string') return null;

  const nomes = Array.isArray(mapa.names) ? mapa.names : [];
  const nome = segmento.indiceDoNome === null ? null : (nomes[segmento.indiceDoNome] ?? null);

  return {
    // `sourceRoot` é opcional e a esmagadora maioria dos bundles não o emite; quando ele
    // existe a especificação manda concatenar, e ignorá-lo produziria um caminho relativo
    // ao lugar errado. A junção é a ingênua de propósito: normalizar `..` aqui inventaria um
    // caminho de disco a partir de um campo que é só um prefixo de texto.
    fonte: mapa.sourceRoot ? `${String(mapa.sourceRoot).replace(/\/$/, '')}/${fonte}` : fonte,
    linha: segmento.linhaOriginal + 1,
    coluna: segmento.colunaOriginal,
    nome,
  };
}
