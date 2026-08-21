// Path: src/modules/audit/audit.schemas.js
import Joi from 'joi';

export const listAuditSchema = Joi.object({
  action: Joi.string().max(50),
  actorId: Joi.string().uuid(),
  targetType: Joi.string().max(20),
  // `string`, nunca `uuid`: `audit_trail.target_id` é TEXT porque o alvo é heterogêneo
  // (slug de catálogo, UUID de projeto 360, a chave `app_config`), e um `.uuid()` aqui
  // recusaria justamente os alvos que a coluna larga passou a permitir.
  targetId: Joi.string().max(255),
  // A OM ALVO existe para o ADMINISTRADOR estreitar a busca. Para o produtor ela é
  // IGNORADA no serviço, que impõe a OM dele: o recorte é do servidor, e declarar a
  // chave aqui não a torna um parâmetro de autorização.
  targetOrgId: Joi.string().uuid(),
  // O PERÍODO É MEIO-ABERTO (`>= from`, `< to`), e é o que faz a tela abrir em sete
  // dias em vez de despejar a trilha inteira. `Joi.date().iso()` normaliza a string
  // para `Date`, que o driver manda como timestamptz.
  from: Joi.date().iso(),
  to: Joi.date().iso(),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(200).default(50),
});
