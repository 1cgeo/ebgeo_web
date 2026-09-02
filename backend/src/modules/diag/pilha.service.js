// Path: src/modules/diag/pilha.service.js
/**
 * @fileoverview A desminificação de pilha: ler o texto de um rastro minificado, achar o
 * diretório da release e casar cada quadro com o seu `.map`. Sem banco e sem impressão.
 *
 * DUAS PORTAS, UMA VERDADE. Isto morava em `scripts/diag/pilha.js` e era só do comando; desde
 * 2026-09-02 ele serve TAMBÉM `GET /api/v1/diag/defeitos/:id/pilha`, porque o caso comum
 * passou a ser um agente com credencial de administrador operando de FORA do host, que não
 * tem os `.map` na máquina dele. Uma segunda implementação da resolução faria a rota e o
 * comando divergirem no dia em que um dos dois fosse consertado, e a divergência aqui é a
 * pior possível: as duas devolveriam nomes de função, uma delas errados.
 *
 * ZERO IMPORTS DO RESTO DO `src/`: só `node:fs`, `node:path` e o decodificador folha
 * (`src/utils/mapa-de-fonte.js`). Nada de `config.js` nem do pool, pela mesma razão de
 * `diag.service.js`: quem chama daqui de dentro (o comando) precisa rodar sem
 * `DATABASE_URL`, e quem sabe onde os mapas moram é o controller.
 *
 * ─── O CUSTO, MEDIDO, E AS DUAS DECISÕES QUE ELE PAGA ───
 *
 * Um chunk grande custa da ordem de 48 ms e 22 MB para ser decodificado, e isso decide duas
 * coisas nesta peça.
 *
 * A PRIMEIRA: a LEITURA é assíncrona (`fs.promises`), e não `readFileSync`. A resolução já é
 * sequencial por quadro (um `.map` de cada vez, com cache por arquivo), então nada se ganha em
 * paralelismo; o que se ganha é não parar o laço de eventos do processo que atende sync e
 * `GET /api/config` durante a leitura de um arquivo de vários MB. No comando isso não importa
 * (ele é um processo só, que sai depois); na rota importa, e as duas portas compartilham este
 * arquivo.
 *
 * A SEGUNDA: o `mappings` é decodificado INTEIRO, e isso é escolha e não descuido. A
 * alternativa (decodificar sob demanda a linha gerada de cada quadro) parece barata e não é:
 * o formato guarda DELTAS que acumulam ATRAVÉS das linhas (índice de fonte, linha original,
 * coluna original e nome), então para saber o estado na linha N é preciso ter percorrido as N
 * anteriores de qualquer jeito. Decodificação preguiçosa aqui seria a mesma varredura com um
 * índice a mais para manter, e o modo de falha dela é o pior desta família: um estado
 * acumulado errado devolve uma origem PLAUSÍVEL e errada. O custo é pago uma vez por `.map`
 * por requisição (`WeakMap` em `mapa-de-fonte.js`, chaveado pelo objeto do JSON), e uma pilha
 * real repete o mesmo chunk em quase todo quadro.
 *
 * ─── A CERCA É `path.resolve`, NÃO `realpath` ───
 *
 * `dentroDaRaiz` compara caminhos RESOLVIDOS textualmente, então um SYMLINK dentro do
 * diretório da release aponta para fora da cerca sem que ela veja: o alvo é `<release>/x`, o
 * conteúdo é de outro lugar. Isso não é descuido, e vale dizer por que a decisão é essa: o
 * deploy desta casa publica por TROCA DE SYMLINK ([[deploy-backend]]), então `realpath` no
 * diretório da release é o caso NORMAL e não a exceção, e comparar caminhos reais exigiria
 * resolver a raiz também, com o resultado mudando no meio de um deploy. O que sustenta a
 * escolha é o alcance do estrago: o que se lê de um `.map` nunca é ECOADO (`quadroPublico` é
 * allowlist e a mensagem de erro do `JSON.parse` é substituída por constante), então um
 * symlink apontado para fora rende, no máximo, um oráculo de "isto é um source map válido".
 * Quem controla o conteúdo de `EBGEO_MAPAS_DIR` é o deploy, não quem relata o erro.
 *
 * A PEÇA CENTRAL É UMA RECUSA. `defeitos.stack_bruta` é a pilha da PRIMEIRA vez em que o
 * defeito foi visto, e o cabeçalho de `UPSERT_DEFEITO` explica por que ela é fixada ali:
 * ela só significa alguma coisa lida contra o bundle que a produziu, que é
 * `primeira_release`. Resolver os mesmos endereços contra o `.map` de OUTRA build não falha,
 * e é isso que a torna perigosa: os arquivos têm os mesmos nomes, o `mappings` tem
 * segmentos nas mesmas linhas, e a saída é uma lista de funções e linhas do repositório com
 * cara de resposta. Uma pilha plausível e errada custa mais que pilha nenhuma, porque manda
 * ler o arquivo errado com confiança. Daí `localizarReleaseDeMapas` casar por IGUALDADE do
 * campo `release` de `release.json` e o comando sair com código 2 quando não acha. A rota
 * traduz a mesma recusa em `disponivel: false` com o motivo nomeando a release.
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { resolver as resolverPosicao } from '../../utils/mapa-de-fonte.js';

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
 * @returns {Promise<{release: string, version?: string, hash?: string, builtAt?: string}|null>}
 */
export async function lerReleaseJson(diretorio) {
  try {
    const bruto = await fsp.readFile(path.join(diretorio, 'release.json'), 'utf8');
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
 * @returns {Promise<{diretorio: string|null,
 *   candidatas: Array<{diretorio: string, release: string}>}>}
 */
export async function localizarReleaseDeMapas(raiz, release) {
  const candidatas = [];

  const aqui = await lerReleaseJson(raiz);
  if (aqui) {
    candidatas.push({ diretorio: raiz, release: aqui.release });
    if (aqui.release === release) return { diretorio: raiz, candidatas };
  }

  let entradas;
  try {
    entradas = await fsp.readdir(raiz, { withFileTypes: true });
  } catch {
    return { diretorio: null, candidatas };
  }

  let achado = null;
  for (const entrada of entradas) {
    if (!entrada.isDirectory() && !entrada.isSymbolicLink()) continue;
    const filho = path.join(raiz, entrada.name);
    // A VARREDURA É SEQUENCIAL de propósito: ela abre um `release.json` de quatro campos por
    // diretório, e um `Promise.all` sobre ela trocaria uma latência que já é desprezível por
    // uma rajada de descritores num diretório com muitas builds.
    const lido = await lerReleaseJson(filho);
    if (!lido) continue;
    candidatas.push({ diretorio: filho, release: lido.release });
    // NÃO retorna no primeiro casamento: a varredura inteira é o que permite listar as
    // candidatas na mensagem de fracasso, e o custo é ler um JSON de quatro campos por
    // diretório.
    if (lido.release === release && achado === null) achado = filho;
  }

  return { diretorio: achado, candidatas };
}

/** O que se diz de um `.map` que existe e não é JSON válido. Ver o `catch` de `mapaDe`. */
const MAPA_ILEGIVEL = 'não é um source map válido (JSON ilegível)';

/**
 * O que se diz do `.map` que o disco recusou a ENTREGAR, que é outra coisa.
 *
 * Permissão, volume desmontado, entrada de diretório corrompida: o arquivo está declarado no
 * endereço e não pôde ser lido. Colapsar isto em "não é um source map válido" mandaria alguém
 * investigar o BUILD quando o problema é o host. Nem esta frase nem a irmã citam o `err`
 * original, pela mesma regra do `JSON.parse`: o que sai é o veredito e o caminho.
 */
const MAPA_ILEGIVEL_LEITURA = 'não pôde ser lido do disco';

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
 * O RESOLVEDOR É INJETÁVEL e tem DEFAULT, e os dois lados importam: o comando o passa
 * explicitamente (foi assim que ele nasceu, e o teste dele o dirige assim), e a rota usa o
 * default. Sem o default, o caminho novo teria de repetir o import do decodificador e
 * poderia, um dia, repetir com OUTRO.
 *
 * @param {Array<ReturnType<typeof analisarPilha>[number]>} quadros
 * @param {string} diretorio
 * @param {Function} [resolvedor] - `resolver` de `src/utils/mapa-de-fonte.js`
 * @returns {Promise<Array<Object>>} os quadros com `resolvido`, `fonte`, `fonteBruta`, `nome`,
 *   `motivo`
 */
export async function resolverQuadros(quadros, diretorio, resolvedor = resolverPosicao) {
  const cache = new Map();

  const mapaDe = async (url) => {
    if (cache.has(url)) return cache.get(url);
    let resultado = { mapa: null, motivo: 'sem-mapa', caminho: null, erro: null };
    for (const caminho of caminhosDoMapa(url, diretorio)) {
      let bruto;
      try {
        // UMA SÓ IDA AO DISCO POR CANDIDATO: o `existsSync` que morava aqui era um `stat` a
        // mais para responder o que o próprio `readFile` responde, e ainda abria a janela em
        // que o arquivo some entre as duas chamadas.
        bruto = await fsp.readFile(caminho, 'utf8');
      } catch (err) {
        // NÃO ESTAR LÁ É O CASO NORMAL (são dois candidatos por endereço e no máximo um
        // existe); não PODER ler é outra coisa, e ela precisa ser dita, senão uma permissão
        // errada no diretório da release se lê como build publicada sem source map.
        if (err.code === 'ENOENT') continue;
        resultado = { mapa: null, motivo: 'sem-mapa', caminho, erro: MAPA_ILEGIVEL_LEITURA };
        break;
      }
      try {
        resultado = { mapa: JSON.parse(bruto), motivo: null, caminho, erro: null };
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

  // UM LAÇO E NÃO UM `map` COM `Promise.all`: a resolução é sequencial por quadro de propósito,
  // e o cache por arquivo é o que a torna barata (uma pilha real repete o mesmo chunk em quase
  // todo quadro). Em paralelo, N quadros do mesmo chunk perderiam o cache e leriam o mesmo
  // arquivo N vezes antes de qualquer um deles gravar.
  const saida = [];
  for (const quadro of quadros) {
    if (quadro.url === null) {
      saida.push({ ...quadro, resolvido: false, motivo: 'sem-quadro' });
      continue;
    }
    const { mapa, caminho, erro } = await mapaDe(quadro.url);
    if (!mapa) {
      saida.push({ ...quadro, resolvido: false, motivo: 'sem-mapa', mapa: caminho, erroDoMapa: erro });
      continue;
    }
    let posicao;
    try {
      posicao = resolvedor(mapa, { linha: quadro.linha, coluna: colunaDeQuadro(quadro.coluna) });
    } catch (err) {
      saida.push({ ...quadro, resolvido: false, motivo: 'sem-mapa', mapa: caminho, erroDoMapa: err.message });
      continue;
    }
    if (!posicao) {
      saida.push({ ...quadro, resolvido: false, motivo: 'sem-segmento', mapa: caminho });
      continue;
    }
    saida.push({
      ...quadro,
      resolvido: true,
      motivo: null,
      mapa: caminho,
      fonteBruta: posicao.fonte,
      fonte: fonteLegivel(posicao.fonte),
      linhaOriginal: posicao.linha,
      colunaOriginal: posicao.coluna,
      nome: posicao.nome,
    });
  }
  return saida;
}

/**
 * Os motivos pelos quais a desminificação NÃO acontece, um por causa.
 *
 * ELES SÃO CÓDIGO E NÃO FRASE, e a distinção é o que faz o consumidor conseguir agir: quem lê
 * esta rota é um agente, e "não deu" não separa "o servidor não foi configurado" de "a build
 * foi podada" de "o relato não trouxe o dado". Cada valor tem uma providência diferente, e
 * duas delas nem são no mesmo lugar (uma é do operador do host, outra é de quem relatou).
 */
export const MOTIVO_SEM_PILHA = Object.freeze({
  SEM_DIRETORIO: 'sem-diretorio-de-mapas',
  SEM_PILHA_BRUTA: 'sem-pilha-bruta',
  SEM_RELEASE: 'sem-release-do-primeiro-avistamento',
  RELEASE_NAO_ENCONTRADA: 'release-nao-encontrada',
});

/** As frases dos quatro. Uma tabela, e não um `switch`, para que faltar um seja visível. */
const EXPLICACAO = Object.freeze({
  [MOTIVO_SEM_PILHA.SEM_DIRETORIO]:
    'Este servidor não tem EBGEO_MAPAS_DIR apontando para um diretório de releases legível, '
    + 'então não há `.map` para ler. É configuração do host, e o valor não é publicado aqui.',
  [MOTIVO_SEM_PILHA.SEM_PILHA_BRUTA]:
    'O defeito não tem pilha crua: ela só é gravada quando o relato do cliente a traz, e fica '
    + 'fixada no PRIMEIRO avistamento.',
  [MOTIVO_SEM_PILHA.SEM_RELEASE]:
    'O defeito não tem a release do primeiro avistamento, e a pilha crua só pode ser lida '
    + 'contra o bundle que a produziu. Sem esse campo não há como saber qual foi.',
  [MOTIVO_SEM_PILHA.RELEASE_NAO_ENCONTRADA]:
    'Nenhuma build sob EBGEO_MAPAS_DIR declara esta release. NADA foi resolvido, de propósito: '
    + 'contra outra build a resolução NÃO falha, ela devolve funções e linhas plausíveis e '
    + 'ERRADAS, que é pior que pilha nenhuma.',
});

/**
 * O QUADRO COMO A ROTA O PUBLICA, que é MENOS do que `resolverQuadros` produz.
 *
 * TRÊS CAMPOS FICAM DE FORA, e cada um por uma razão própria: `mapa` é um caminho ABSOLUTO do
 * sistema de arquivos do host, `erroDoMapa` só existe para acompanhar aquele caminho, e
 * `fonteBruta` é o `sources` cru do mapa (relativo ao `dist/assets/` da máquina que compilou).
 * Nenhum dos três ajuda quem está do outro lado da rede, e o primeiro é topologia do host
 * saindo por uma resposta cuja entrada (`stack_bruta`) veio de uma rota ANÔNIMA.
 *
 * `coluna` É 0-BASED, como o `--json` do comando (`colunaOriginal`) e como o próprio formato
 * de source map. A saída HUMANA do comando imprime 1-based, para casar com o que um editor
 * abre; as duas dizem a mesma posição, e é por isso que a base fica escrita aqui.
 *
 * `motivo` SÓ NASCE QUANDO O QUADRO NÃO RESOLVEU. Escrevê-lo sempre (com `null` no sucesso)
 * pareceria mais uniforme e diria menos: o consumidor teria de comparar com `null` em vez de
 * perguntar pela presença, e um `motivo: null` ao lado de `fonte: null` se lê como resolução
 * que deu certo e não achou nada.
 *
 * @param {Object} q - um quadro de `resolverQuadros`
 * @returns {{original: string, fonte: string|null, linha: number|null, coluna: number|null,
 *   nome: string|null, motivo?: string}}
 */
function quadroPublico(q) {
  const saida = {
    original: q.bruta,
    fonte: q.resolvido ? q.fonte : null,
    linha: q.resolvido ? q.linhaOriginal : null,
    coluna: q.resolvido ? q.colunaOriginal : null,
    nome: q.resolvido ? q.nome : null,
  };
  if (!q.resolvido) saida.motivo = q.motivo;
  return saida;
}

/** Um desfecho negativo, com a causa em código e a frase ao lado. */
function indisponivel(motivo, release = null) {
  return { disponivel: false, motivo, explicacao: EXPLICACAO[motivo], release };
}

/**
 * A PILHA DE UM DEFEITO, desminificada do lado do servidor.
 *
 * É a metade de `npm run diag -- pilha` que a rota reusa, e a diferença entre as duas portas
 * é só o diretório: o comando recebe `--mapas` de quem digitou, e a rota lê `EBGEO_MAPAS_DIR`
 * do servidor. Um `?mapas=` seria um leitor de arquivo arbitrário do host atrás de um gate de
 * administrador, que é exatamente o que `diag.controller.js` recusa para o diretório de log.
 *
 * O DESFECHO É TERNÁRIO E NUNCA LANÇA, pela mesma regra do `resumo`: a rota responde 200 com
 * `disponivel: false` e um motivo em CÓDIGO sempre que a resolução não pode acontecer. Um 500
 * aqui diria que o diagnóstico quebrou, quando o que houve foi o servidor não ter os mapas, ou
 * o relato não ter trazido a pilha. Quem sai com 404 é só o defeito inexistente, e isso é do
 * controller.
 *
 * A RECUSA POR RELEASE É A PEÇA CENTRAL, não o caso de erro (ver o cabeçalho). A lista de
 * builds encontradas, que o comando imprime junto da recusa para separar "digitei o caminho
 * errado" de "a build foi podada", NÃO sai por aqui: do outro lado da rede não existe caminho
 * digitado para estar errado, e enumerar o que há no disco do host é a única metade daquela
 * mensagem que é topologia do servidor.
 *
 * @param {Object} opts
 * @param {Object} opts.defeito - o item de `obterDefeito`
 * @param {string|null|undefined} opts.mapasDir - `config.mapasDir`
 * @returns {Promise<Object>}
 */
export async function resolverPilhaDeDefeito({ defeito, mapasDir }) {
  if (!defeito.stackBruta) return indisponivel(MOTIVO_SEM_PILHA.SEM_PILHA_BRUTA);
  if (!defeito.primeiraRelease) return indisponivel(MOTIVO_SEM_PILHA.SEM_RELEASE);
  // O DIRETÓRIO É CONFERIDO DEPOIS DOS DOIS CAMPOS, e a ordem é a que erra menos: um defeito
  // sem pilha crua continua sem pilha crua com os mapas no lugar, e dizer "falta configurar o
  // servidor" nesse caso manda mexer no host por nada.
  if (!mapasDir || !fs.existsSync(mapasDir)) {
    return indisponivel(MOTIVO_SEM_PILHA.SEM_DIRETORIO, defeito.primeiraRelease);
  }

  const { diretorio } = await localizarReleaseDeMapas(mapasDir, defeito.primeiraRelease);
  if (!diretorio) {
    return indisponivel(MOTIVO_SEM_PILHA.RELEASE_NAO_ENCONTRADA, defeito.primeiraRelease);
  }

  return {
    disponivel: true,
    release: defeito.primeiraRelease,
    quadros: (await resolverQuadros(analisarPilha(defeito.stackBruta), diretorio)).map(quadroPublico),
  };
}
