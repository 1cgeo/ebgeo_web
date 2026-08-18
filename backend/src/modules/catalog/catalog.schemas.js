// Path: src/modules/catalog/catalog.schemas.js
import Joi from 'joi';

export const createSchema = Joi.object({
  id: Joi.string().max(100).required(),
  name: Joi.string().max(255).required(),
  description: Joi.string().allow('', null),
  config: Joi.object().default({}),
  sort_order: Joi.number().integer().default(0),
});

export const updateSchema = Joi.object({
  name: Joi.string().max(255),
  description: Joi.string().allow('', null),
  config: Joi.object(),
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
