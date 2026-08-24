// Path: src/modules/auth/auth.schemas.js
import Joi from 'joi';

/**
 * LOGIN DELIBERATELY HAS NO PASSWORD LENGTH RULE, unlike every schema below.
 *
 * A minimum is a REGISTRATION policy: it decides which passwords may be created. Enforcing it
 * again at login only decides which passwords may be TYPED, and that is wrong three ways.
 * It locks out any account whose password predates the rule (admin-created, seeded, migrated).
 * It answers a short guess with a 422 naming the policy while a long guess gets a flat 401,
 * so the response shape leaks the rule to anyone unauthenticated. And it misleads the real
 * user: someone who mistypes a short password is told the password is too short, which reads
 * as "your account needs a longer password" rather than "that is not your password".
 *
 * `required()` stays: an absent password is a malformed request, not a failed login.
 */
export const loginSchema = Joi.object({
  username: Joi.string().required().max(100),
  password: Joi.string().required().max(100),
});

export const refreshSchema = Joi.object({
  refreshToken: Joi.string().required(),
});

export const logoutSchema = Joi.object({
  refreshToken: Joi.string().required(),
});

export const registerSchema = Joi.object({
  username: Joi.string().required().min(3).max(100).pattern(/^[a-zA-Z0-9._-]+$/)
    .messages({
      'string.pattern.base': 'Usuário aceita apenas letras, números, ponto, hífen e sublinhado.',
    }),
  password: Joi.string().required().min(6).max(100),
  nome: Joi.string().required().max(255),
  // REQUIRED. Self-registration creates the account pending; it is activated only by the
  // `?verify=` link. Making the field mandatory is what makes confirmation mandatory,
  // without a single new gate: `login()` already refuses `user.email && !user.email_verified`,
  // and that condition now always holds on this path. While the field was optional, two
  // HTTP calls produced an immediately usable account that nobody could contact, revoke by
  // mailbox ownership, or correlate.
  //
  // `POST /api/v1/users` (the administrative path) has NO email field and keeps creating
  // e-mail-less accounts that log in right away. That is the legitimate case, and it is
  // what the login gate must stay conditional for.
  //
  // NO `.messages()` here, and that is the convention, not an omission: `any.required` and
  // `string.email` are both in the central table of `utils/validation-messages.js`, which
  // renders from `detail.type` and only falls back to Joi's own sentence for a rule it does
  // NOT map. A schema-level override of a mapped rule is dead text — it never reaches the
  // 422 body. (Measured: with the override in place the wire answered "Informe e-mail.",
  // the central rendering.) Only `string.pattern.base` belongs in a schema, per the
  // fileoverview of that file.
  email: Joi.string().email().max(255).required(),
  // FKs: posto (ranks) + OM (organizations). Empty string is normalized to null in the service.
  rank_id: Joi.string().uuid().allow(null, ''),
  organization_id: Joi.string().uuid().allow(null, ''),
});

export const verifyEmailSchema = Joi.object({
  token: Joi.string().uuid().required(),
});

// ACEITA ENDEREÇO **OU** NOME DE USUÁRIO, e o segundo existe por um beco medido: quem se cadastrou
// e não confirmou não loga, não redefine a senha (a consulta de recuperação só acha endereço
// CONFIRMADO, de propósito) e só tinha um botão de reenvio, no diálogo pós-cadastro, que sumia ao
// primeiro clique. A saída natural é oferecer o reenvio ao lado do erro de login, e ali a tela tem
// o USUÁRIO, nunca o endereço.
//
// Não abre enumeração: a rota responde o mesmo 200 nos dois casos, como já fazia, e o e-mail sai
// para o endereço registrado da conta, nunca para um digitado por quem pede. Some-se a isso que a
// recusa `EMAIL_NOT_VERIFIED` do login só acontece DEPOIS de a senha conferir, então quem chega
// nesse botão já provou ser o dono.
// `xor` E NÃO `or`: exatamente um dos dois. Com `or`, um pedido carregando os dois campos ficava
// decidido por uma precedência implícita no serviço, e um teste que mandasse os dois mediria essa
// precedência em vez da propriedade. Estado ambíguo que a validação pode recusar não deve chegar
// ao serviço.
export const resendVerificationSchema = Joi.object({
  email: Joi.string().email().max(255),
  username: Joi.string().max(150),
}).xor('email', 'username');

/** Step one of the recovery: the address to mail a code to. Answers the same 200 either way. */
export const forgotPasswordSchema = Joi.object({
  email: Joi.string().email().max(255).required(),
});

/**
 * Step two: the code from the e-mail plus the new password.
 *
 * THE LENGTH RULE BELONGS HERE, unlike on `loginSchema`, and the distinction is the one that
 * file's fileoverview draws: this route CREATES a password, so the registration policy applies.
 * The bounds mirror `updatePasswordSchema` and `resetPasswordSchema`
 * (`src/modules/users/users.schemas.js`); the three are the same policy stated at the three
 * places a password can be written.
 *
 * `token` is `uuid()` because the token IS the primary key of `email_verification_tokens`, which
 * is a `UUID DEFAULT gen_random_uuid()`. Refusing a malformed code at the border keeps a typed
 * code from reaching the database as `22P02`, which surfaces as a 400 that says nothing.
 */
export const resetPasswordWithTokenSchema = Joi.object({
  token: Joi.string().uuid().required(),
  newPassword: Joi.string().required().min(6).max(100),
});
