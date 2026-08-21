// Path: src/modules/users/users.schemas.js
import Joi from 'joi';

// Self-service profile edit. Deliberately accepts NEITHER `organization_id` NOR
// `producer_org_id`, e os dois pelo mesmo motivo com pesos diferentes.
//
// O motivo ANTIGO desta recusa era que `organization_id` autorizava leitura de
// projeto 360 privado daquela OM; isso deixou de valer (o eixo de OM no 360 passou
// a ser o escopo de PRODUÇÃO, que só um administrador concede). A recusa continua
// certa e o motivo passou a ser outro: a lotação é o rótulo institucional da pessoa
// e alimenta o gate de liveness (OM desativada barra a conta), então auto-mover-se
// entre tenants continua sendo escrita de identidade, não de perfil.
//
// `producer_org_id` é recusado com muito mais força: ele É autorização. Aceitá-lo
// aqui seria o auto-cadastro de crachá — exatamente o defeito que esta fase existe
// para fechar. Os dois são de administrador (updateUserAdminSchema). Nada disto
// cobre `ng` (nomes), gateado por zona (`ng.fn_user_zone_geoms`), nunca por OM.
export const updateProfileSchema = Joi.object({
  nome: Joi.string().max(255),
  rank_id: Joi.string().uuid().allow(null, ''),
});

export const updatePasswordSchema = Joi.object({
  currentPassword: Joi.string().required(),
  newPassword: Joi.string().required().min(6).max(100),
});

export const searchQuerySchema = Joi.object({
  q: Joi.string().required().min(2).max(100),
});

// ============================================
// Admin schemas
// ============================================

export const listUsersQuerySchema = Joi.object({
  includeInactive: Joi.boolean().default(false),
});

export const createUserAdminSchema = Joi.object({
  username: Joi.string().required().min(3).max(100).pattern(/^[a-zA-Z0-9._-]+$/)
    .messages({
      'string.pattern.base': 'Usuário aceita apenas letras, números, ponto, hífen e sublinhado.',
    }),
  password: Joi.string().required().min(6).max(100),
  nome: Joi.string().required().max(255),
  rank_id: Joi.string().uuid().allow(null, ''),
  organization_id: Joi.string().uuid().allow(null, ''),
  // OS QUATRO PAPEIS GLOBAIS, E ELES NAO SAO UMA ESCADA: nenhum contem o outro, e
  // compara-los por ordem e proibido.
  //   user         — a conta comum.
  //   producer     — MANTEM todo recurso produzido pela OM do `producer_org_id`
  //                  dele (catalogo e 360). Escreve, e so ali.
  //   credenciado  — LE todo recurso privado do sistema e NAO ESCREVE NADA. Nao
  //                  passa em requireAdmin, nao vira dono de atlas, nao edita
  //                  catalogo, nao vira 'admin' em toFrontendRole.
  //   admin        — administracao do sistema.
  // Esta borda e onde o papel NASCE, e por isso ela e a unica que cita os quatro
  // valores; nenhum gate de PODER foi tocado, e e assim que eles tem de continuar.
  // O censo (tests/unit/papel-global-censo.test.js) classifica cada sitio e reprova
  // o que aparecer sem classificacao.
  role: Joi.string().valid('user', 'producer', 'credenciado', 'admin').default('user'),
  // O BICONDICIONAL DA CRIACAO, espelhado do CHECK `users_producer_scope_check`:
  // cracha sem escopo e escopo sem cracha sao os dois estados impossiveis. Cobra-lo
  // aqui e o que faz o erro voltar como 422 com NOME DE CAMPO, em vez do 23514 que
  // o errorHandler traduz num 400 generico ("Value violates a constraint") sem dizer
  // o que fazer. Um produtor produz para UMA OM so; acima disso e admin.
  producer_org_id: Joi.string().uuid().allow(null, '')
    .when('role', {
      is: 'producer',
      then: Joi.string().uuid().required(),
      otherwise: Joi.valid(null, ''),
    })
    .messages({
      'any.required': 'O papel Produtor exige a OM de produção.',
      'any.only': 'A OM de produção só se define para o papel Produtor.',
    }),
  // O EIXO `org_role` SAIU DA BORDA em 2026-08-20 (D7), junto com a coluna. Ele nunca
  // autorizou nada aqui, e no cliente contaminava o eixo POR ATLAS. Uma aba antiga que
  // ainda mande o campo tem ele DESCARTADO pelo `stripUnknown: true` de
  // `VALIDATION_OPTIONS`, e nao recusado: a criacao de conta continua funcionando com o
  // resto do corpo, que e a degradacao certa para uma pagina em cache.
});

export const updateUserAdminSchema = Joi.object({
  username: Joi.string().min(3).max(100).pattern(/^[a-zA-Z0-9._-]+$/)
    .messages({
      'string.pattern.base': 'Usuário aceita apenas letras, números, ponto, hífen e sublinhado.',
    }),
  nome: Joi.string().max(255),
  rank_id: Joi.string().uuid().allow(null, ''),
  organization_id: Joi.string().uuid().allow(null, ''),
  role: Joi.string().valid('user', 'producer', 'credenciado', 'admin'),
  // AQUI O BICONDICIONAL NAO CABE NO JOI, e a diferenca com a criacao e real, nao
  // descuido: uma edicao e PARCIAL, entao o par (papel, escopo) que vale e a MISTURA
  // do corpo com a linha existente, e o Joi so enxerga o corpo. Um `when('role')`
  // aqui recusaria trocar a OM de um produtor sem reenviar o papel, e nao veria o
  // caso que mais quebra (rebaixar sem limpar o escopo). Quem cobra o bicondicional
  // e `users.service.js`, sobre o estado efetivo, com 400 legivel.
  producer_org_id: Joi.string().uuid().allow(null, ''),
  // `is_active` CONTINUA BOOLEANO AQUI, E A GUARDA NAO E DE SCHEMA: quem recusa a
  // desativacao por este PUT e `users.service.js`, com 409, e a recusa e sobre a
  // TRANSICAO (ativo -> inativo), nao sobre o valor. A distincao e o que mantem
  // funcionando os dois casos legitimos que um `valid(true)` quebraria: reativar por PUT,
  // e reenviar `false` ao editar o nome de quem JA esta inativo (a tela manda o checkbox
  // desmarcado junto). Os quatro casos estao em
  // `tests/integration/user-deactivate-via-put.repro.test.js`, com controle negativo.
  // Consequencia para D8(b): a poda de `deleteUser` nao e contornavel por aqui, porque
  // por aqui nao se desativa ninguem. Desde 2026-08-21 este PUT tem poda PROPRIA, por
  // outro fato: `role` e `producer_org_id` acima sao os dois fundamentos de concessao de
  // RAIZ, e perder um deles derruba o que a pessoa concedeu (`fundamentoDeRaizPerdido` em
  // `users.service.js`, com origem `USER_DEMOTION` na trilha).
  is_active: Joi.boolean(),
  // Admin approval of a pending e-mail account (and the no-SMTP fallback path): flipping this true
  // unblocks login for an account that was created with an unverified e-mail.
  email_verified: Joi.boolean(),
  // O eixo `org_role` saiu daqui em 2026-08-20 (D7). Historia curta, porque explica por
  // que ele nunca deveria ter existido: ate 2026-07-19 nenhum caminho de codigo dos dois
  // pacotes ESCREVIA a coluna, entao todo usuario ficava no default e o gate de escrita
  // do 360 que a lia nunca passava; quando ela ganhou escritor, o gate ja tinha migrado
  // para o escopo de producao, e o unico efeito que sobrou foi o cliente promover a
  // Dono/Administrador de atlas quem tivesse esses valores.
});

export const resetPasswordSchema = Joi.object({
  newPassword: Joi.string().required().min(6).max(100),
});

export const userIdParamsSchema = Joi.object({
  userId: Joi.string().uuid().required(),
});

export const deleteUserQuerySchema = Joi.object({
  transferTo: Joi.string().uuid(),
});
