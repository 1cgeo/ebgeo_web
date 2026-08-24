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
 * O BENEFICIÁRIO É UMA PESSOA **OU** UM GRUPO, e o `xor` do Joi ESPELHA o `CHECK
 * (num_nonnulls(grantee_id, grantee_group_id) = 1)` da tabela. Espelhar é o ponto: sem
 * esta linha o pedido malformado atravessaria a borda e morreria no banco como 23514,
 * que o tratador traduz num 400 genérico sem nome de campo — o chamador receberia
 * "violação de restrição" para um erro que é, literalmente, "escolha um dos dois".
 * Com o `xor`, os DOIS casos errados (nenhum e ambos) voltam 422 nomeando os campos.
 *
 * As duas cópias da regra são deliberadas e não redundância a podar: a do banco é a
 * que GARANTE (INSERT cru existe, e os testes de função escrevem direto na tabela), e
 * a da borda é a que EXPLICA.
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
  granteeId: Joi.string().uuid(),
  granteeGroupId: Joi.string().uuid(),
  grantLevel: Joi.string().valid('view', 'view_share').required(),
  expiresAt: Joi.date().iso().greater('now')
    .custom((value, helpers) => (
      value.getTime() > Date.now() + PRAZO_MAXIMO_MS ? helpers.error('any.invalid') : value
    ))
    .messages({ 'any.invalid': 'O prazo de uma concessão não pode passar de um ano.' }),
})
  .xor('granteeId', 'granteeGroupId')
  .messages({
    'object.xor': 'Informe granteeId OU granteeGroupId, nunca os dois.',
    'object.missing': 'Informe granteeId ou granteeGroupId.',
  });

/** `:grantId` da rota de revogação e da de extensão de prazo. */
export const grantIdParamsSchema = Joi.object({
  grantId: Joi.string().uuid().required(),
});

/**
 * O corpo de uma EXTENSÃO de prazo.
 *
 * `expiresAt` é OBRIGATÓRIO aqui, ao contrário do POST: ausente, o único significado
 * possível seria "renove pelo default", e um default silencioso numa rota cujo produto É
 * a data escolhida devolveria um prazo que ninguém pediu.
 *
 * O TETO DA BORDA É O MESMO DO POST (um ano a contar de agora) e continua sendo apenas
 * SANIDADE, não a regra: o teto que vale é o `LEAST` do próprio UPDATE, e ele é mais
 * ESTREITO que este — o orçamento da linha conta de `created_at`, não de agora. Ou seja,
 * passar por aqui não promete que a data pedida será a data guardada, e é por isso que a
 * resposta devolve o valor efetivo.
 */
export const extendGrantSchema = Joi.object({
  expiresAt: Joi.date().iso().greater('now')
    .custom((value, helpers) => (
      value.getTime() > Date.now() + PRAZO_MAXIMO_MS ? helpers.error('any.invalid') : value
    ))
    .messages({ 'any.invalid': 'O prazo de uma concessão não pode passar de um ano.' })
    .required(),
});

/**
 * O `?atlasId=` do payload aditivo. OPCIONAL de propósito: "sem atlas em foco" é
 * o estado de quem acabou de entrar, e um 400 ali transformaria o login numa
 * falha. Quando presente precisa ser UUID, porque vai para um cast `::uuid`.
 */
export const visibleQuerySchema = Joi.object({
  atlasId: Joi.string().uuid().optional(),
});
