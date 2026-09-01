// Path: src/modules/nomes/tile-regime.js
/**
 * @fileoverview A QUE LINHA DE CATÁLOGO PERTENCE UM CAMINHO SERVIDO SOB O PREFIXO DE
 * TILES — o índice em memória que torna possível gatear o tile POR RECURSO.
 *
 * Irmão de `assets3d-regime.js`, e a diferença entre os dois é o que este cabeçalho
 * precisa deixar claro, porque ela inverte a decisão mais importante dos dois arquivos.
 *
 * ============================================================================
 * O QUE ELE RESOLVE. A cláusula 10.7 pôs a chave de API como credencial validada no
 * nginx, e o `auth_request` que ela produziu responde sobre a CREDENCIAL e nunca sobre a
 * CAMADA: qualquer chave viva alcança o tile de qualquer camada privada. Isso foi medido
 * (`dev/tile-privado/scripts/confere-martin-nginx.sh`) e o dono decidiu fechar em
 * 2026-08-29. Fechar exige o que este arquivo faz: dado o caminho que o nginx repassa,
 * dizer QUAL linha de catálogo o reivindica e se ela é privada.
 * ============================================================================
 *
 * O CAMINHO NÃO REIVINDICADO É RECUSADO, E ISSO INVERTE A REGRA DO IRMÃO. Em
 * `assets3d-regime.js`, um caminho que nenhuma linha reivindica é PÚBLICO, e lá isso é
 * seguro: o Node serve o acervo inteiro e existem arquivos legítimos que o catálogo não
 * descreve. Aqui o endereço é texto livre digitado pelo administrador, e serão centenas
 * de camadas, várias privadas. Um erro de digitação numa linha privada faz o caminho não
 * casar entrada nenhuma, e a regra do irmão o publicaria em silêncio. O preço da
 * inversão é que uma fonte publicada no servidor de tiles sem linha no catálogo deixa de
 * desenhar; esse defeito é VISÍVEL ("cadastrei e não aparece") e o outro é mudo.
 *
 * ESTE MÓDULO NÃO DECIDE A RECUSA: ele devolve `null` para o não reivindicado, e quem lê
 * o `null` como "recusa" é o gate. A separação é o que mantém o índice testável sem
 * Express e sem banco, e o que impede que a decisão de política fique escondida num
 * módulo de resolução de caminho.
 *
 * OS ENDEREÇOS SÃO QUATRO FAMÍLIAS, e a última é a que não se adivinha:
 *   - `data_layers.config.source`      — a fonte da camada;
 *   - `data_layers.config.labelSource` — a SEGUNDA fonte da mesma linha, independente da
 *     primeira. É a armadilha que `docs/wiki/tile-privado.md` nomeia: quem escrever
 *     "reescreve source" fecha uma porta e deixa a irmã aberta;
 *   - `analysis_layers.config.source`  — raster, que NÃO vem do servidor de tiles vetorial
 *     e mesmo assim sai pelo mesmo prefixo (atrás de um prefixo há mais de um servidor);
 *   - `basemaps.config.style.sources.*` — aqui o endereço mora DENTRO do estilo MapLibre,
 *     numa fonte por chave, cada uma com `url` OU `tiles[]`. É preciso descer no objeto
 *     em vez de ler um campo, e é por isso que um basemap privado é o campo mais fácil de
 *     esquecer.
 *
 * `tilesets` FICA DE FORA, de propósito: aquele acervo é servido pelo Node e já tem o seu
 * índice. Uma linha de tileset aqui plantaria uma entrada que só casaria por acidente.
 *
 * O ALVO É SEMPRE UM PREFIXO, nunca um arquivo. Um endereço de tile é ou o documento
 * TileJSON da fonte (`/tiles/rodovias`) ou um template com marcadores
 * (`/tiles/dem/{z}/{x}/{y}.png`), e nos dois casos o que identifica o recurso é o começo
 * do caminho. Daí o corte no primeiro segmento que contenha `{`: o que vem depois é
 * coordenada, não identidade.
 */
import config from '../../config.js';
import { query } from '../../database/index.js';
import { SELECT_LINHAS_DE_CATALOGO } from '../catalog/catalog.tables.js';
import { normalizarRel, ordenarEntradas, acharEntrada } from './caminho-de-recurso.js';
import {
  criarVigiaDeRegime,
  afirmacaoPublicaVencida,
  RegimeVencidoAlemDoTetoError,
} from './regime-vencido.js';

/** As tabelas cujos endereços saem pelo prefixo de tiles. `tilesets` não é uma delas. */
const TIPOS_DE_TILE = Object.freeze(['data_layer', 'analysis_layer', 'basemap']);

/**
 * Os campos de `config` que endereçam uma fonte, por nome.
 *
 * Lista NOMEADA e não varredura do objeto, pela mesma razão que `assets3d-regime.js` dá:
 * varrer tudo o que parece URL plantaria entradas a partir de campo de metadado
 * (`description`, `attribution`) e faria o índice reivindicar caminhos que ninguém serve.
 */
const CAMPOS_DE_FONTE = Object.freeze(['source', 'labelSource']);

/** Backstop: o mecanismo é a invalidação na escrita, e isto limita um caminho não fiado. */
const TTL_MS = 60_000;

/** @type {{ promise: Promise<Array>, expiresAt: number }|null} */
let entrada = null;
/** @type {Array|null} O último índice que CONSTRUIU, para que uma falha de banco não feche tudo. */
let ultimoBom = null;
/**
 * Quem torna ESCRITA a queda para o `ultimoBom`, que era muda. Uma linha na entrada em
 * regime vencido e uma na volta, nunca uma por consulta: o porquê da forma e do nível está
 * no cabeçalho de `regime-vencido.js`, e este arquivo não decide nada disso.
 */
const vigia = criarVigiaDeRegime('tile');

/**
 * Descarta o índice, para que o próximo pedido o reconstrua.
 *
 * Pendurado em `invalidateAppConfigCache()`, como o do irmão: toda escrita de catálogo e
 * de visibilidade já o chama. NÃO limpa `ultimoBom`, que é o recurso para a reconstrução
 * que FALHA.
 */
export function invalidarRegimeDeTile() {
  entrada = null;
}

/**
 * A base pública do servidor de tiles, sem barra final, ou `''` quando não configurada.
 *
 * ELA É A MESMA QUE O FRONTEND RECEBE, e essa igualdade é o ponto: `appConfig.tileServerUrl`
 * é o valor que `GET /api/config` serve ao cliente para montar os endereços de tile. Ler
 * outra variável aqui faria a base que INDEXA divergir da base que o cliente PEDE, e o
 * sintoma seria um índice que não casa nada — ou seja, com a decisão 4, recusa de tudo.
 *
 * SEM ELA O ÍNDICE FICA VAZIO, e isso é deliberado: um índice vazio faz todo caminho ser
 * "não reivindicado", e o gate recusa tudo. É a direção fechada, e ela é preferível ao
 * oposto (uma base adivinhada casaria endereços por acidente). O operador que esquecer de
 * configurar descobre no primeiro tile, não num vazamento.
 *
 * O CAMINHO DA PROPRIEDADE JÁ ESTEVE ERRADO AQUI (`config.tileServerUrl`, que não existe:
 * ela mora sob `appConfig`), e o defeito é da classe que não se anuncia — `undefined ?? ''`
 * devolve a base vazia, o índice sai vazio e o gate recusa TUDO, com a aparência de uma
 * decisão deliberada. Quem o pegou foi o teste unitário do índice, não o boot.
 */
function basePublica() {
  return String(config.appConfig?.tileServerUrl ?? '').trim().replace(/\/+$/, '');
}

/**
 * Um endereço do catálogo como caminho no MESMO vocabulário do que o nginx repassa, ou
 * `null` quando ele não é servido por este host.
 *
 * TRÊS FORMAS SÃO ACEITAS, e a terceira é a que o irmão recusa:
 *   - relativa sob a base (`/tiles/rodovias`);
 *   - absoluta que comece pela base configurada (`http://host/tiles/rodovias`);
 *   - a própria base, que resolve para vazio e portanto é descartada.
 *
 * ABSOLUTA DE OUTRA ORIGEM DEVOLVE `null`, e essa é a metade que a decisão do dono
 * transforma em regra de produto: URL de terceiro só pode ser PÚBLICA, porque não há gate
 * possível sobre servidor alheio. Aqui isso aparece como ausência de entrada; o guarda que
 * recusa marcá-la privada é escrita de catálogo e mora noutro lugar.
 *
 * @param {*} bruto
 * @returns {string|null}
 */
export function relDeEndereco(bruto) {
  if (typeof bruto !== 'string' || !bruto.trim()) return null;
  const s = bruto.trim();
  const base = basePublica();
  if (!base) return null;

  let resto;
  if (s.startsWith(`${base}/`)) {
    resto = s.slice(base.length);
  } else if (!s.includes('://') && !s.startsWith('//')) {
    // Relativa: aceita com ou sem o caminho da base, para o caso de a base ser um caminho
    // (`/tiles`) e o cadastro tê-lo omitido.
    const caminhoDaBase = base.replace(/^https?:\/\/[^/]+/, '');
    resto = caminhoDaBase && s.startsWith(`${caminhoDaBase}/`) ? s.slice(caminhoDaBase.length) : s;
  } else {
    return null; // Outra origem.
  }

  const rel = normalizarRel(resto);
  return rel === '' || rel === '.' ? null : rel;
}

/**
 * O prefixo que IDENTIFICA a fonte dentro de um endereço.
 *
 * Corta no primeiro segmento que contenha `{`, porque dali em diante o caminho é
 * coordenada de tile e não identidade de recurso: `dem/{z}/{x}/{y}.png` identifica `dem`.
 * Um endereço sem marcador nenhum (o documento TileJSON, `rodovias`) é o prefixo inteiro.
 *
 * @param {string} rel - Caminho já normalizado.
 * @returns {string|null}
 */
export function prefixoDaFonte(rel) {
  const segmentos = rel.split('/');
  const corte = segmentos.findIndex((seg) => seg.includes('{'));
  const uteis = corte === -1 ? segmentos : segmentos.slice(0, corte);
  const prefixo = uteis.join('/').replace(/\/+$/, '');
  return prefixo === '' ? null : prefixo;
}

/**
 * Todos os endereços que uma linha de catálogo declara, já como prefixos.
 *
 * @param {{tipo: string, config: object}} linha
 * @returns {string[]}
 */
function enderecosDaLinha(linha) {
  const cfg = linha.config && typeof linha.config === 'object' ? linha.config : {};
  const brutos = [];

  for (const campo of CAMPOS_DE_FONTE) {
    const fonte = cfg[campo];
    if (fonte && typeof fonte === 'object') {
      if (typeof fonte.url === 'string') brutos.push(fonte.url);
      if (Array.isArray(fonte.tiles)) brutos.push(...fonte.tiles.filter((t) => typeof t === 'string'));
    }
  }

  // O basemap: as fontes moram DENTRO do estilo, uma por chave.
  const fontesDoEstilo = cfg.style && typeof cfg.style === 'object' ? cfg.style.sources : null;
  if (fontesDoEstilo && typeof fontesDoEstilo === 'object') {
    for (const fonte of Object.values(fontesDoEstilo)) {
      if (!fonte || typeof fonte !== 'object') continue;
      if (typeof fonte.url === 'string') brutos.push(fonte.url);
      if (Array.isArray(fonte.tiles)) brutos.push(...fonte.tiles.filter((t) => typeof t === 'string'));
    }
  }

  const prefixos = [];
  for (const bruto of brutos) {
    const rel = relDeEndereco(bruto);
    if (!rel) continue;
    const prefixo = prefixoDaFonte(rel);
    if (prefixo) prefixos.push(prefixo);
  }
  return prefixos;
}

/**
 * A lista plana de entradas, mais específica primeiro e PRIVADA primeiro no empate.
 *
 * O desempate é o que fecha a porta da colisão: duas linhas reivindicando a mesma fonte,
 * uma pública e outra privada, é erro de cadastro, e a leitura segura de um erro é a
 * restritiva. Sem ele bastaria cadastrar uma linha pública homônima para abrir qualquer
 * fonte, o que faria do cadastro de catálogo um caminho de escalação de acesso.
 *
 * @param {Array<{tipo: string, id: string, access_level: string, config: object}>} linhas
 * @returns {Array}
 */
export function montarIndiceDeTile(linhas) {
  const entradas = [];
  for (const linha of linhas) {
    if (!TIPOS_DE_TILE.includes(linha.tipo)) continue;
    const recurso = {
      privado: linha.access_level === 'private',
      tipo: linha.tipo,
      resourceId: linha.id,
    };
    for (const alvo of enderecosDaLinha(linha)) {
      // `arquivo: false` sempre: um endereço de tile identifica um PREFIXO, e os tiles
      // dele penduram z/x/y abaixo. Ver o cabeçalho.
      entradas.push({ alvo, arquivo: false, ...recurso });
    }
  }
  return ordenarEntradas(entradas);
}

/** @returns {Promise<Array>} O índice, construído no máximo uma vez por invalidação. */
function lerIndice() {
  const agora = Date.now();
  if (entrada && entrada.expiresAt > agora) return entrada.promise;

  const promise = query(SELECT_LINHAS_DE_CATALOGO, []).then(({ rows }) => {
    const indice = montarIndiceDeTile(rows);
    ultimoBom = indice;
    // DEPOIS de publicar: é isto que carimba a idade do último bom, e é o que escreve a
    // linha de volta ao normal quando estávamos vencidos.
    vigia.anotarConstrucao();
    return indice;
  });

  entrada = { promise, expiresAt: agora + TTL_MS };
  promise.catch(() => {
    // Reconstrução que falha não fica memoizada, senão uma falha de banco de um segundo
    // decidiria o regime pelo minuto seguinte.
    entrada = null;
  });
  return promise;
}

/**
 * O regime de um caminho servido sob o prefixo de tiles.
 *
 * O TETO ALCANÇA UMA RESPOSTA SÓ, E É A PÚBLICA. Passado o prazo de
 * `afirmacaoPublicaVencida`, um índice vencido perde o direito de dizer "esta fonte é
 * pública, sirva sem credencial", que é a única afirmação daqui que ENTREGA bytes. As outras
 * duas seguem intactas de propósito: o caminho NÃO REIVINDICADO já é 401 pela decisão 4, ou
 * seja, o índice velho já está sendo lido na direção fechada e não há nada a limitar; e a
 * linha PRIVADA não é decidida por este índice, que só diz o tipo e o id: quem decide é
 * `fn_can_see_resource`, no banco, a cada decisão. Fechar o privado junto seria derrubar o
 * gate que continua funcionando, e passar o teto derrubaria o produto inteiro em vez de
 * derrubar a afirmação sem lastro.
 *
 * @param {string} caminho - O caminho que o nginx repassou, sem o prefixo.
 * @returns {Promise<{reivindicado: boolean, privado: boolean, tipo?: string, resourceId?: string}>}
 * @throws Se o índice não puder ser construído E não houver cópia anterior, ou se a resposta
 *   PÚBLICA viesse de um índice vencido além do teto. O chamador responde 503 nos dois
 *   casos: servir vazaria e recusar derrubaria o acervo público inteiro, então nenhum dos
 *   dois é respondido em silêncio.
 */
export async function regimeDoTile(caminho) {
  let indice;
  /** @type {number|null} `null` = o índice desta resposta é o vigente. */
  let vencidoHaMs = null;
  try {
    indice = await lerIndice();
  } catch (erro) {
    if (!ultimoBom) throw erro;
    // Depois do relançamento, de propósito: aquele ramo responde 503 e é alto por si; este
    // é o que servia estado velho em silêncio.
    vigia.anotarQueda(erro);
    vencidoHaMs = vigia.vencidoHaMs();
    indice = ultimoBom;
  }
  const achada = acharEntrada(indice, caminho);
  if (!achada) return { reivindicado: false, privado: false };
  // Sem linha de log: a transição para o regime vencido JÁ foi registrada uma vez, com a
  // idade, e o índice é consultado uma vez por tile. Uma linha por recusa poria o
  // amplificador de log no caminho mais quente do sistema, que é o defeito que
  // `regime-vencido.js` inteiro existe para não cometer.
  if (!achada.privado && afirmacaoPublicaVencida(vencidoHaMs)) {
    throw new RegimeVencidoAlemDoTetoError('tile', vencidoHaMs, config.regimeIndex.staleMaxMs);
  }
  return {
    reivindicado: true,
    privado: achada.privado,
    tipo: achada.tipo,
    resourceId: achada.resourceId,
  };
}

/** Exposto para o teste chamar o casador real, em vez de reimplementá-lo. */
export const _internos = Object.freeze({ montarIndiceDeTile, relDeEndereco, prefixoDaFonte, acharEntrada });
