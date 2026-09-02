// Path: scripts/diag/pilha.js
/**
 * @fileoverview A parte de `npm run diag -- pilha` que não é banco nem impressão: ler o
 * texto de um rastro minificado, achar o diretório da release e casar cada quadro com o seu
 * `.map`.
 *
 * A PEÇA CENTRAL É UMA RECUSA. `defeitos.stack_bruta` é a pilha da PRIMEIRA vez em que o
 * defeito foi visto, e o cabeçalho de `UPSERT_DEFEITO` explica por que ela é fixada ali:
 * ela só significa alguma coisa lida contra o bundle que a produziu, que é
 * `primeira_release`. Resolver os mesmos endereços contra o `.map` de OUTRA build não falha,
 * e é isso que a torna perigosa: os arquivos têm os mesmos nomes, o `mappings` tem
 * segmentos nas mesmas linhas, e a saída é uma lista de funções e linhas do repositório com
 * cara de resposta. Uma pilha plausível e errada custa mais que pilha nenhuma, porque manda
 * ler o arquivo errado com confiança. Daí `localizarReleaseDeMapas` casar por IGUALDADE do
 * campo `release` de `release.json` e o comando sair com código 2 quando não acha.
 *
 * ZERO IMPORTS DO `src/`: só `node:fs` e `node:path`. O comando de diagnóstico não pode
 * exigir `DATABASE_URL` para ler arquivo, e este módulo é justamente a metade dele que roda
 * sem banco.
 */

import fs from 'node:fs';
import path from 'node:path';

/**
 * Um quadro de pilha, nas formas que V8 e os navegadores escrevem.
 *
 * As três formas que aparecem no campo, e todas caem nesta regex:
 *   `    at nome (https://host/assets/core-Ab12.js:1:23456)`
 *   `    at https://host/assets/core-Ab12.js:1:23456`
 *   `nome@https://host/assets/core-Ab12.js:1:23456`            (Firefox)
 *
 * O ENDEREÇO É `.+?` E NÃO `[^:]+`, e a diferença é o Windows: um caminho `C:\x\y.js` tem
 * dois-pontos no meio, e uma classe negada os cortaria no drive. A âncora que segura tudo é
 * o `:(\d+):(\d+)` no FIM, que é a única parte da linha cuja forma é garantida.
 */
const QUADRO = /^\s*(?:at\s+)?(?:(.+?)\s+\()?(?:(.+?)@)?(.+?):(\d+):(\d+)\)?\s*$/;

/**
 * Quebra o texto de um rastro em quadros, preservando a linha crua de cada um.
 *
 * A LINHA CRUA VAI JUNTO SEMPRE, inclusive nas que não casam (a primeira, que é a mensagem
 * do erro, e as linhas de anotação que alguns navegadores intercalam). É a mesma decisão do
 * `--filtro` de `diag.js`: o que se imprime quando não há resolução é o texto que EXISTE, e
 * não uma reconstrução dele.
 *
 * @param {string} texto - o conteúdo de `defeitos.stack_bruta`
 * @returns {Array<{bruta: string, url: string|null, arquivo: string|null,
 *   linha: number|null, coluna: number|null, funcao: string|null}>}
 */
export function analisarPilha(texto) {
  const linhas = String(texto ?? '').split(/\r?\n/);
  return linhas
    .filter((l, i) => l.trim() !== '' || i === 0)
    .map((bruta) => {
      const m = QUADRO.exec(bruta);
      if (!m) return { bruta, url: null, arquivo: null, linha: null, coluna: null, funcao: null };
      const [, funcaoAntes, funcaoArroba, url, linha, coluna] = m;
      return {
        bruta,
        url,
        arquivo: nomeDoArquivo(url),
        linha: parseInt(linha, 10),
        coluna: parseInt(coluna, 10),
        funcao: funcaoAntes || funcaoArroba || null,
      };
    });
}

/**
 * O nome do arquivo dentro de um endereço, sem query e sem fragmento.
 *
 * `?t=` e `#` entram por HMR do Vite e por deep-link, e um deles no nome faria o `.map`
 * procurado ser `core-Ab12.js?t=17...map`, que não existe em disco. O corte é feito ANTES da
 * última barra de propósito: `?` pode conter barra.
 *
 * @param {string} url
 * @returns {string|null}
 */
export function nomeDoArquivo(url) {
  if (typeof url !== 'string' || url === '') return null;
  const semQuery = url.split('#')[0].split('?')[0];
  const partes = semQuery.split(/[/\\]/);
  return partes[partes.length - 1] || null;
}

/**
 * A COLUNA DO RESOLVEDOR a partir da coluna que o navegador imprimiu.
 *
 * V8 e os demais motores escrevem a coluna 1-BASED no texto do rastro; o source map é
 * 0-BASED. A tradução mora aqui, num único ponto nomeado, e não espalhada por um `- 1` no
 * meio de uma expressão: ela é invisível no resultado (erra por um caractere, cai no
 * segmento vizinho e devolve outro nome de função, sem erro nenhum), e a única defesa contra
 * isso é ela ter nome e teste.
 *
 * O piso em zero cobre o rastro que traz coluna 0 (alguns motores emitem, e nenhuma coluna
 * negativa existe).
 *
 * @param {number} colunaDoTexto
 * @returns {number}
 */
export function colunaDeQuadro(colunaDoTexto) {
  return Math.max(0, colunaDoTexto - 1);
}

/**
 * Um caminho candidato cai DENTRO do diretorio da release?
 *
 * ESTA É A GUARDA DE TRAVESSIA, e ela não é defensiva: `defeitos.stack_bruta` é texto livre
 * que chega pela ÚNICA rota anônima deste servidor (`POST /diag/erro-cliente`), então os
 * endereços de dentro dela são escolhidos por quem relata. Um quadro como
 * `https://h/assets/../../../../etc/passwd:1:1` produzia, por `path.join`, um caminho FORA
 * de `--mapas`, e dali saíam dois vazamentos: o `fs.existsSync` vira oráculo de existência
 * de arquivo, e o `JSON.parse` que falha punha o começo do conteúdo na mensagem de erro.
 *
 * A COMPARAÇÃO É POR FRONTEIRA DE CAMINHO, nunca `startsWith` cru sobre a string: sem o
 * separador, uma release em `/r/1` aceitaria `/r/10` e `/r/1-antigo` como se fossem ela. É
 * o mesmo argumento de `credencialDeTile` no cliente, e o mesmo modo de falha.
 *
 * @param {string} candidato
 * @param {string} raizResolvida - ja passada por `path.resolve`
 * @returns {boolean}
 */
function dentroDaRaiz(candidato, raizResolvida) {
  const alvo = path.resolve(candidato);
  return alvo === raizResolvida || alvo.startsWith(raizResolvida + path.sep);
}

/**
 * O caminho do `.map` de um quadro dentro de um diretório de release, em ordem de tentativa.
 *
 * SÃO DOIS CANDIDATOS, E O PRIMEIRO É O CAMINHO DO ENDEREÇO. Um `dist/` publicado preserva
 * a estrutura (`/assets/core-Ab12.js` mora em `<dist>/assets/core-Ab12.js`), então o
 * pathname do endereço é a resposta certa, e a única que continua certa se algum dia
 * houver mais de um diretório de saída. O segundo candidato existe para o deploy com
 * `base` diferente de `/` (o `/cms/` comentado no `vite.config.js`), onde o pathname
 * carrega um prefixo que o disco não tem: ali só o nome do arquivo sobrevive, e `assets/`
 * é onde ele está.
 *
 * OS DOIS PASSAM POR `dentroDaRaiz`, o segundo inclusive, ainda que `nomeDoArquivo` já
 * tire as barras: uma guarda que confia no saneamento do vizinho é uma guarda que some no
 * dia em que o vizinho mudar. Candidato que sair da release é DESCARTADO em silêncio,
 * porque ele não é um erro do operador, é um endereço que nunca poderia ser resolvido.
 *
 * @param {string} url - o endereço do quadro
 * @param {string} diretorio - o diretório da release (o que contém `release.json`)
 * @returns {string[]} caminhos a tentar, em ordem
 */
export function caminhosDoMapa(url, diretorio) {
  const candidatos = [];
  const arquivo = nomeDoArquivo(url);
  const semQuery = String(url ?? '').split('#')[0].split('?')[0];

  const barra = semQuery.indexOf('://');
  const depoisDoHost = barra === -1 ? semQuery : semQuery.slice(barra + 3).replace(/^[^/]*/, '');
  const relativo = depoisDoHost.replace(/^[/]+/, '');
  if (relativo) candidatos.push(path.join(diretorio, `${relativo}.map`));
  if (arquivo) candidatos.push(path.join(diretorio, 'assets', `${arquivo}.map`));

  const raiz = path.resolve(diretorio);
  return [...new Set(candidatos)].filter((c) => dentroDaRaiz(c, raiz));
}

/**
 * O caminho de fonte como um humano deste repositório o procura.
 *
 * O `sources` de um mapa do Vite é relativo ao `dist/assets/`, então ele chega como
 * `../../src/js/index.js`. Imprimir isso obrigaria quem lê a contar os `..` para descobrir
 * de qual pacote se trata; imprimir um caminho absoluto seria pior, porque ele seria o
 * caminho da MÁQUINA QUE COMPILOU, que pode não ser esta.
 *
 * A REGRA É COSMÉTICA E ESTÁ DECLARADA: tira os `./` e `../` da frente e, se o que sobra
 * começa em `src/`, prefixa `frontend/`, que é onde o `src/` de um bundle de navegador mora
 * neste monorepo. É um palpite, e por isso o valor CRU do mapa continua indo inteiro para a
 * saída `--json` (campo `fonteBruta`): a saída legível é para o olho, e a de máquina é a que
 * não pode ter palpite dentro.
 *
 * @param {string} fonte - a entrada de `sources` como o mapa a declara
 * @returns {string}
 */
export function fonteLegivel(fonte) {
  if (typeof fonte !== 'string' || fonte === '') return '';
  const normalizado = fonte.replace(/\\/g, '/');
  const semPontos = normalizado.replace(/^(?:\.\.?\/)+/, '');
  return semPontos.startsWith('src/') ? `frontend/${semPontos}` : semPontos;
}

/**
 * Lê o `release.json` de um diretório, ou `null` se ele não existe nem é legível.
 *
 * NÃO LANÇA, e o motivo não é conveniência: esta função é chamada em varredura sobre tudo o
 * que estiver dentro de `--mapas`, e ali um diretório sem `release.json` é o caso NORMAL
 * (um `logs/`, um `.git/`, um release antigo cujo build não tinha o plugin). Lançar faria a
 * varredura morrer no primeiro vizinho não relacionado.
 *
 * @param {string} diretorio
 * @returns {{release: string, version?: string, hash?: string, builtAt?: string}|null}
 */
export function lerReleaseJson(diretorio) {
  try {
    const bruto = fs.readFileSync(path.join(diretorio, 'release.json'), 'utf8');
    const lido = JSON.parse(bruto);
    return lido && typeof lido.release === 'string' ? lido : null;
  } catch {
    return null;
  }
}

/**
 * Acha, sob `--mapas`, o diretório cujo `release.json` declara EXATAMENTE a release pedida.
 *
 * DOIS FORMATOS DE `--mapas`, e os dois são o que um operador digita de verdade: o
 * diretório de UMA build (um `dist/`, ou um diretório de release publicado) e o diretório
 * QUE CONTÉM as builds (a pasta de releases do deploy). O primeiro é testado direto; o
 * segundo, um nível abaixo. Descer mais que um nível foi recusado: além de varrer
 * `node_modules` de qualquer coisa que estivesse ali, um casamento em profundidade
 * arbitrária tornaria imprevisível QUAL build respondeu.
 *
 * AS CANDIDATAS VOLTAM JUNTO MESMO NO FRACASSO, e é a metade útil da resposta negativa:
 * "não achei `1.0.0+ab12cd`" sozinho manda o operador conferir se digitou o caminho errado,
 * enquanto "não achei, e o que há aqui é `1.0.0+ff90aa` e `1.0.0+7c31de`" já diz que o
 * caminho está certo e a build é que foi podada.
 *
 * @param {string} raiz - o valor de `--mapas`
 * @param {string} release - `defeitos.primeira_release`
 * @returns {{diretorio: string|null, candidatas: Array<{diretorio: string, release: string}>}}
 */
export function localizarReleaseDeMapas(raiz, release) {
  const candidatas = [];

  const aqui = lerReleaseJson(raiz);
  if (aqui) {
    candidatas.push({ diretorio: raiz, release: aqui.release });
    if (aqui.release === release) return { diretorio: raiz, candidatas };
  }

  let entradas;
  try {
    entradas = fs.readdirSync(raiz, { withFileTypes: true });
  } catch {
    return { diretorio: null, candidatas };
  }

  let achado = null;
  for (const entrada of entradas) {
    if (!entrada.isDirectory() && !entrada.isSymbolicLink()) continue;
    const filho = path.join(raiz, entrada.name);
    const lido = lerReleaseJson(filho);
    if (!lido) continue;
    candidatas.push({ diretorio: filho, release: lido.release });
    // NÃO retorna no primeiro casamento: a varredura inteira é o que permite listar as
    // candidatas na mensagem de fracasso, e o custo é ler um JSON de quatro campos por
    // diretório.
    if (lido.release === release && achado === null) achado = filho;
  }

  return { diretorio: achado, candidatas };
}

/** O que se diz de um `.map` que existe e não é legível. Ver o `catch` de `mapaDe`. */
const MAPA_ILEGIVEL = 'não é um source map válido (JSON ilegível)';

/**
 * Resolve todos os quadros de um rastro contra os `.map` de um diretório de release.
 *
 * O CACHE DE MAPA É POR ARQUIVO e guarda TAMBÉM o fracasso (`null`): uma pilha real repete o
 * mesmo chunk em quase todo quadro, e sem guardar o fracasso um bundle sem `.map` publicado
 * faria uma tentativa de leitura de disco por quadro para receber o mesmo ENOENT.
 *
 * O MOTIVO DE CADA QUADRO NÃO RESOLVIDO É NOMEADO, e os três não são a mesma coisa:
 * `sem-quadro` é linha que não é quadro (a mensagem do erro no topo), `sem-mapa` é `.map`
 * que não está no disco ou não é um source map, e `sem-segmento` é mapa lido com sucesso no
 * qual aquela posição não cai em segmento nenhum. Colapsá-los num `[sem mapa]` único faria
 * um mapa corrompido ler como ausente, que é o estado em que ninguém investiga.
 *
 * @param {Array<ReturnType<typeof analisarPilha>[number]>} quadros
 * @param {string} diretorio
 * @returns {Array<Object>} os quadros com `resolvido`, `fonte`, `fonteBruta`, `nome`, `motivo`
 */
export function resolverQuadros(quadros, diretorio, resolvedor) {
  const cache = new Map();


  const mapaDe = (url) => {
    if (cache.has(url)) return cache.get(url);
    let resultado = { mapa: null, motivo: 'sem-mapa', caminho: null, erro: null };
    for (const caminho of caminhosDoMapa(url, diretorio)) {
      if (!fs.existsSync(caminho)) continue;
      try {
        resultado = { mapa: JSON.parse(fs.readFileSync(caminho, 'utf8')), motivo: null, caminho, erro: null };
      } catch {
        // A MENSAGEM DO `JSON.parse` NÃO SAI DAQUI, e a razão é que ela CITA o conteúdo:
        // um `.map` que na verdade é uma página de erro vira
        // `Unexpected token '<', "<html>404..."`, ou seja, o começo do arquivo dentro da
        // saída do comando. O caminho já diz o que precisa ser olhado, e abrir o arquivo
        // é decisão do operador, não efeito colateral do diagnóstico.
        resultado = { mapa: null, motivo: 'sem-mapa', caminho, erro: MAPA_ILEGIVEL };
      }
      break;
    }
    cache.set(url, resultado);
    return resultado;
  };

  return quadros.map((quadro) => {
    if (quadro.url === null) {
      return { ...quadro, resolvido: false, motivo: 'sem-quadro' };
    }
    const { mapa, caminho, erro } = mapaDe(quadro.url);
    if (!mapa) {
      return { ...quadro, resolvido: false, motivo: 'sem-mapa', mapa: caminho, erroDoMapa: erro };
    }
    let posicao;
    try {
      posicao = resolvedor(mapa, { linha: quadro.linha, coluna: colunaDeQuadro(quadro.coluna) });
    } catch (err) {
      return { ...quadro, resolvido: false, motivo: 'sem-mapa', mapa: caminho, erroDoMapa: err.message };
    }
    if (!posicao) {
      return { ...quadro, resolvido: false, motivo: 'sem-segmento', mapa: caminho };
    }
    return {
      ...quadro,
      resolvido: true,
      motivo: null,
      mapa: caminho,
      fonteBruta: posicao.fonte,
      fonte: fonteLegivel(posicao.fonte),
      linhaOriginal: posicao.linha,
      colunaOriginal: posicao.coluna,
      nome: posicao.nome,
    };
  });
}
