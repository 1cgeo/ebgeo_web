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
  // ENTRADA E SAIDA DO SISTEMA FICAM DE FORA POR PADRAO, e este e o parametro que as
  // traz de volta. `LOGIN` e a unica acao da trilha emitida por um ato ROTINEIRO (uma
  // linha por sessao iniciada, por pessoa, por dia), e `LOGOUT` o acompanha; as outras
  // ~40 acoes do CHECK sao atos de administracao ou de producao. Sem o recorte, a
  // primeira pagina de qualquer investigacao vinha tomada por elas.
  //
  // O DEFAULT E `false` E NAO `undefined`: assim o servico recebe um booleano em vez de
  // decidir sozinho o que ausencia significa, e o predicado nao depende de coalescencia
  // no meio do caminho.
  includeAccess: Joi.boolean().default(false),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(200).default(50),
});
