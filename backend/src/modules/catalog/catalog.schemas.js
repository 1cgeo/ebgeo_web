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
const configSchema = Joi.object({
  [CAMPO_FORMA_3D]: Joi.string().valid(...FORMAS_3D),
}).unknown(true);

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

// ?atlasId= nas duas rotas de LEITURA — o atlas em foco, para o braco de EMPRESTIMO do
// predicado de acesso. Declarado (e nao deixado passar de largada) para que um valor
// malformado morra em 422 na borda, antes do cast `::uuid` la dentro. `.unknown(true)`
// porque estas rotas sempre aceitaram query livre e apertar isso agora seria mudanca de
// contrato sem pedido.
export const atlasScopeQuerySchema = Joi.object({
  atlasId: Joi.string().trim().guid(),
}).unknown(true);
