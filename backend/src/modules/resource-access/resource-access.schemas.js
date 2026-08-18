// Path: src/modules/resource-access/resource-access.schemas.js
import Joi from 'joi';
import { RESOURCE_TYPES } from './resource-access.types.js';

/** `:type/:id` — o tipo é validado na BORDA porque ele escolhe nome de tabela. */
export const resourceParamsSchema = Joi.object({
  type: Joi.string().valid(...RESOURCE_TYPES).required(),
  id: Joi.string().min(1).max(255).required(),
});

export const visibilitySchema = Joi.object({
  accessLevel: Joi.string().valid('public', 'private').required(),
});

/** O teto de prazo de uma concessão, em milissegundos (o mesmo do CHECK da tabela). */
const PRAZO_MAXIMO_MS = 365 * 24 * 60 * 60 * 1000;

/**
 * O corpo de uma concessão.
 *
 * `grantLevel` é obrigatório e sem default: o default silencioso seria `view`, e
 * um cliente que erre o nome do campo passaria a conceder o nível MENOR sem
 * ninguém perceber — o erro barulhento aqui custa um 422 e devolve a intenção
 * para quem a tem.
 *
 * `expiresAt` é OPCIONAL e ausente significa um ano, que é o default da coluna.
 * A borda cobra o teto para que o pedido absurdo volte como 422 com nome de campo,
 * e não como o 400 genérico em que o `CHECK` da tabela se traduz. Ela NÃO cobra o
 * prazo do pai: esse teto depende de uma linha do banco e é aplicado no INSERT,
 * onde não há janela entre a leitura e a escrita.
 */
export const grantSchema = Joi.object({
  granteeId: Joi.string().uuid().required(),
  grantLevel: Joi.string().valid('view', 'view_share').required(),
  expiresAt: Joi.date().iso().greater('now')
    .custom((value, helpers) => (
      value.getTime() > Date.now() + PRAZO_MAXIMO_MS ? helpers.error('any.invalid') : value
    ))
    .messages({ 'any.invalid': 'O prazo de uma concessão não pode passar de um ano.' }),
});

/** `:grantId` da rota de revogação. */
export const grantIdParamsSchema = Joi.object({
  grantId: Joi.string().uuid().required(),
});

/**
 * O `?atlasId=` do payload aditivo. OPCIONAL de propósito: "sem atlas em foco" é
 * o estado de quem acabou de entrar, e um 400 ali transformaria o login numa
 * falha. Quando presente precisa ser UUID, porque vai para um cast `::uuid`.
 */
export const visibleQuerySchema = Joi.object({
  atlasId: Joi.string().uuid().optional(),
});
