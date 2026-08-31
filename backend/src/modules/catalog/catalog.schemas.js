// Path: src/modules/catalog/catalog.schemas.js
import Joi from 'joi';
import { CAMPO_FORMA_3D, FORMAS_3D } from './forma-3d.js';

// O CONFIG CONTINUA LIVRE, COM UMA CHAVE VIGIADA.
//
// `.unknown(true)` NAO e frouxidao herdada: o shape de cada `config` varia por tabela (estilo
// MapLibre de basemap, `source`/`sourceLayer` de camada de dados, `locate`/`url` de tileset) e
// nunca teve validacao, por decisao registrada na wiki. Apertar o objeto inteiro agora quebraria
// as quatro categorias de uma vez.
//
// O QUE MUDA E UMA CHAVE SO: `forma3d` e uma ENUMERACAO FECHADA, e um valor fora dos quatro
// morre aqui, em 422, em vez de virar linha gravada que nenhum visualizador sabe desenhar. Esta e
// a metade que a taxonomia por exclusao nao tinha: enquanto a forma era "nao e glb e nao e
// firstPerson", nao havia borda nenhuma onde um valor errado pudesse ser recusado.
//
// A CHAVE E OPCIONAL DE PROPOSITO, e a razao tem prazo: linha antiga (e linha escrita por cliente
// que precede o eixo) chega sem ela, e o cliente a deriva. Torna-la `.required()` e o ato que
// aposenta a derivacao de compatibilidade -- ver o cabecalho de `frontend/src/js/catalog/forma-3d.js`,
// que nomeia as duas condicoes.
// A SEGUNDA CHAVE VIGIADA: `previewVideo`, o endereço do vídeo de prévia.
//
// Ela existia desde sempre em `tilesets` e passou livre porque `config` é livre. O que
// muda em 2026-08-21 é o ALCANCE: o campo deixa de ser só do 3D e passa a valer também
// para camada de dados, camada de análise e projeto 360 (este último em coluna, porque
// `sv360.projects` não tem `config`). Basemap fica de fora: ele é o único dos cinco tipos
// que não vira cartão de catálogo, então não haveria onde LER o valor. A regra é a cláusula
// 2.4 da constituição, e desde 2026-08-23 ela é IMPOSTA aqui.
//
// ATÉ 2026-08-23 A EXCLUSÃO NÃO EXISTIA NO SERVIDOR, e esta prosa apontava para o lugar
// errado: dizia que o motivo estava "escrito por extenso no comentário de
// `sv360.projects.preview_video`", e aquele comentário diz apenas que a coluna espelha
// `config.previewVideo` das tabelas de catálogo, sem excetuar o basemap. Nenhuma migração
// restringe a chave (o `config` é JSONB livre nas quatro tabelas), e este mesmo schema era
// UM SÓ para as quatro: `POST /api/v1/basemaps` com `config.previewVideo` era aceito e
// gravado. O que segurava a norma era o formulário do painel, que não oferece o campo.
// Achado por uma revisão da constituição contra as migrações; ver a cláusula 2.4.
//
// O NOME É `previewVideo` E NÃO UM NOME NOVO: é a chave que o visualizador 3D, o
// `scene-config.service` e o índice de `assets3d-regime.js` já leem. Um `videoUrl` ao
// lado criaria dois vocabulários para a mesma coisa, que é exatamente como um eixo se
// perde — e o eixo do 3D já pagou essa conta uma vez (`forma3d` acima).
//
// DUAS BORDAS, E AS DUAS SÃO SOBRE TAMANHO E TRANSPORTE, não sobre conteúdo:
//
//   - `max(2048)`: é ENDEREÇO, e endereço tem tamanho de endereço. ELE, e só ele, é o teto
//     do que cabe em `config`.
//   - RECUSA DE `data:`: mídia EMBUTIDA, de qualquer tamanho. Esta linha já disse que sem
//     ela "um data URL de dez megabytes entra em `config`", e isso era falso: o `max(2048)`
//     da mesma cadeia barra o gigante com ou sem ela. O que ela impede é o data URL
//     PEQUENO, e o motivo é o destino do valor — `config` sai INTEIRO no `GET /api/config`,
//     o documento memoizado que TODO chamador anônimo recebe no boot, e o vídeo mora fora
//     de banda, servido pelo mesmo prefixo dos tilesets. Uma justificativa que mede o risco
//     errado sobrevive à guarda que ela explica.
//
// A REGRA É INSENSÍVEL A CAIXA E A ESPAÇO À ESQUERDA, e as duas metades foram medidas
// contra o Joi real: esquema de URI é case-insensitive (RFC 3986) e o parser de HTML apara
// o espaço à esquerda de um atributo, então `DATA:` e `␠data:` viravam data URL de verdade
// num `<video src>` enquanto o padrão era `/^(?!data:)/`. O `.trim()` fecha a segunda metade
// no valor GRAVADO (um `'   '` vira `''`, que é como o painel remove o vídeo) e o `/i` a
// primeira.
//
// `.allow('', null)` porque esvaziar o campo é como o painel REMOVE o vídeo, e o
// `configSchema` continua `.unknown(true)`: nenhuma outra chave foi fechada aqui.
const PREVIEW_VIDEO_MAX = 2048;
const previewVideoSchema = Joi.string()
  .trim()
  .max(PREVIEW_VIDEO_MAX)
  .pattern(/^(?!\s*data:)/i)
  .allow('', null)
  .messages({
    'string.pattern.base': 'O vídeo de prévia é um endereço, não um arquivo embutido (data URL).',
  });

// A TERCEIRA CHAVE VIGIADA, e ela é SÓ DO MAPA BASE: a faixa de zoom (decisão do dono,
// 2026-08-31).
//
// O ZOOM PASSOU A TER UM NÍVEL CONFIGURÁVEL SÓ, e é este. A aplicação é FIXA em [2, 21]
// (`config.static.js`, `MAP2D_BASE`, e `config.admin.schemas.js` recusa o override das duas),
// e o atlas não tem zoom nenhum (existiu como contrato reservado e foi removido). O mapa base
// APERTA dentro da faixa da aplicação e nunca a afrouxa, e é por isso que o teto aqui é 21 e o
// piso é 2: um valor fora disso não teria onde ser honrado, porque a câmera não sai da faixa
// fixa. Quem edita é o administrador ou o produtor da OM dona da linha, pelo gate que já
// existia (`requireCatalogProducer` mais o `fn_can_produce_resource` do `WHERE` da escrita).
//
// AS DUAS SÃO OPCIONAIS, e a omissão é VALOR, não lacuna: mapa base sem elas vale [2, 21], que
// é a faixa inteira. Torná-las obrigatórias quebraria o `PUT` de toda linha já gravada.
//
// `.custom()` E NÃO DUAS BORDAS SOLTAS, porque `minzoom > maxzoom` é a única falha que
// nenhuma das duas chaves vê sozinha, e é a que produz o pior estado: o MapLibre recebe
// `setMinZoom` acima do `setMaxZoom` e a câmera fica presa onde nenhum tile desenha. Sem
// `.messages()`, pela convenção da casa: a tradução é feita no EDGE
// (`utils/validation-messages.js`) e um texto escrito aqui seria descartado.
//
// A CHAVE É MINÚSCULA (`minzoom`/`maxzoom`) porque é o nome que a casa já usa: o `config` de
// `data_layers` (seed em `005_catalogo.sql`), o formulário do painel e a lista de campos
// auditáveis de `utils/audit-diff.js`. Um `minZoom` camelCase ao lado criaria dois
// vocabulários para a mesma coisa, que é como um eixo se perde.
//
// SÓ O MAPA BASE GANHA A RÉGUA. `data_layers` tem `minzoom`/`maxzoom` no `config` desde o
// seed, mas ali eles são da FONTE vetorial (a partir de que zoom o tile existe), não da
// câmera, e apertá-los em [2, 21] recusaria configuração legítima de tile server.
const ZOOM_PISO = 2;
const ZOOM_TETO = 21;
const zoomDeMapaBase = Joi.number().min(ZOOM_PISO).max(ZOOM_TETO);

/** Recusa `minzoom > maxzoom` no `config` do mapa base. */
const ordemDoZoom = (value, helpers) => {
  const { minzoom, maxzoom } = value || {};
  if (minzoom != null && maxzoom != null && minzoom > maxzoom) {
    return helpers.error('any.custom', {
      error: new Error('config.minzoom não pode ser maior que config.maxzoom'),
    });
  }
  return value;
};

const configSchema = Joi.object({
  [CAMPO_FORMA_3D]: Joi.string().valid(...FORMAS_3D),
  previewVideo: previewVideoSchema,
}).unknown(true);

/**
 * O `config` DO MAPA BASE: vídeo de prévia RECUSADO, faixa de zoom ACEITA e vigiada.
 *
 * As duas diferenças moram no mesmo schema porque são a mesma pergunta (o que o mapa base
 * tem de diferente das outras três tabelas de catálogo), e porque `schemasDeEscrita` já
 * escolhe este objeto por tabela.
 *
 * `forbidden()` e não omissão: `configSchema` é `.unknown(true)`, então tirar a chave da
 * lista a deixaria passar como qualquer outra desconhecida. O que se quer aqui é a recusa
 * NOMEADA — 422 dizendo o que é, em vez de gravar um campo que nada lê.
 */
const configSchemaSemPreviewVideo = Joi.object({
  [CAMPO_FORMA_3D]: Joi.string().valid(...FORMAS_3D),
  minzoom: zoomDeMapaBase,
  maxzoom: zoomDeMapaBase,
  // SEM `.messages()` AQUI, e a ausência é a convenção da casa, não esquecimento: a
  // tradução das falhas de validação é feita no EDGE, por tipo de erro
  // (`utils/validation-messages.js`), e uma mensagem escrita no schema seria descartada
  // ali — código que promete um texto que nunca sai. O chamador recebe 422 nomeando o
  // campo (`config.previewVideo` não é aceito aqui), e o PORQUÊ vive na cláusula 2.4 da
  // constituição e no comentário do topo deste arquivo.
  previewVideo: Joi.any().forbidden(),
}).unknown(true).custom(ordemDoZoom, 'minzoom<=maxzoom');

/** A tabela cujo `config` recusa o vídeo de prévia. Uma só, e a constituição diz qual. */
const TABELA_SEM_PREVIEW_VIDEO = 'basemaps';

export const createSchema = Joi.object({
  id: Joi.string().max(100).required(),
  name: Joi.string().max(255).required(),
  description: Joi.string().allow('', null),
  config: configSchema.default({}),
  sort_order: Joi.number().integer().default(0),
});

export const updateSchema = Joi.object({
  name: Joi.string().max(255),
  description: Joi.string().allow('', null),
  config: configSchema,
  sort_order: Joi.number().integer(),
}).min(1);

export const idParamsSchema = Joi.object({
  id: Joi.string().max(100).required(),
});

/**
 * O corpo da transferência de OM dona (`PATCH /:id/owner-org`, só administrador).
 *
 * `owner_org_id` é a ÚNICA chave, e `null` é valor de primeira classe: devolver a linha ao
 * acervo institucional é um destino legítimo, não um campo esquecido. Por isso `.required()`
 * sobre um valor que aceita null, e não `.allow(null)` sozinho numa chave opcional: o corpo
 * precisa DIZER a nova OM, mesmo quando ela é nenhuma.
 */
export const ownerOrgSchema = Joi.object({
  owner_org_id: Joi.string().guid({ version: 'uuidv4' }).allow(null).required(),
});

/**
 * Os schemas de ESCRITA daquela tabela.
 *
 * A fábrica existe porque a diferença entre as quatro tabelas de catálogo é UMA: o mapa
 * base não tem vídeo de prévia (cláusula 2.4 da constituição). Um schema por tabela
 * escrito à mão seria quatro cópias para uma diferença; um schema só, que era o que havia,
 * deixava a regra sem imposição nenhuma no servidor.
 *
 * @param {string} table - uma das quatro tabelas de catálogo
 * @returns {{create: Joi.ObjectSchema, update: Joi.ObjectSchema}}
 */
export function schemasDeEscrita(table) {
  if (table !== TABELA_SEM_PREVIEW_VIDEO) return { create: createSchema, update: updateSchema };
  return {
    create: createSchema.keys({ config: configSchemaSemPreviewVideo.default({}) }),
    update: updateSchema.keys({ config: configSchemaSemPreviewVideo }),
  };
}

// ?atlasId= nas duas rotas de LEITURA — o atlas em foco, para o braco de EMPRESTIMO do
// predicado de acesso. Declarado (e nao deixado passar de largada) para que um valor
// malformado morra em 422 na borda, antes do cast `::uuid` la dentro. `.unknown(true)`
// porque estas rotas sempre aceitaram query livre e apertar isso agora seria mudanca de
// contrato sem pedido.
export const atlasScopeQuerySchema = Joi.object({
  atlasId: Joi.string().trim().guid(),
}).unknown(true);
