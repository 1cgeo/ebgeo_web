// Path: src/modules/access-groups/access-groups.schemas.js
import Joi from 'joi';

/** O teto de `access_groups.name` (VARCHAR(100)). */
const NOME_MAX = 100;

/**
 * Criar um grupo.
 *
 * `name` faz `trim` na borda porque a unicidade do banco é sobre `LOWER(name)` e NÃO
 * sobre o nome aparado: sem isto, "Estado-Maior" e "Estado-Maior " são dois grupos
 * distintos para o índice e o MESMO grupo para quem lê a tela — a duplicata que o
 * índice único existe para impedir entraria pela porta do espaço em branco.
 */
export const createGroupSchema = Joi.object({
  name: Joi.string().trim().min(2).max(NOME_MAX)
    .required(),
  description: Joi.string().trim().max(2000).allow(null, ''),
});

/**
 * Renomear e/ou reescrever a descrição.
 *
 * `min(1)` de chaves: um PATCH vazio não é erro de digitação inofensivo, é uma
 * escrita que audita uma mudança que não aconteceu. Recusar na borda mantém a trilha
 * honesta.
 *
 * `description` aceita `null` e string vazia porque LIMPAR a descrição é um pedido
 * legítimo, e é distinto de "não mexer" (que é a ausência da chave). O serviço
 * carrega essa distinção até o SQL.
 */
export const updateGroupSchema = Joi.object({
  name: Joi.string().trim().min(2).max(NOME_MAX),
  description: Joi.string().trim().max(2000).allow(null, ''),
}).min(1);

/** `:groupId` das rotas de grupo. */
export const groupIdParamsSchema = Joi.object({
  groupId: Joi.string().uuid().required(),
});

/** `:groupId/:userId` da remoção de membro. */
export const memberParamsSchema = Joi.object({
  groupId: Joi.string().uuid().required(),
  userId: Joi.string().uuid().required(),
});

/** O corpo de "pôr alguém no grupo". */
export const addMemberSchema = Joi.object({
  userId: Joi.string().uuid().required(),
});
