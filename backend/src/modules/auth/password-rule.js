// Path: src/modules/auth/password-rule.js
import Joi from 'joi';

/**
 * The ONE rule for a password that is being SET, shared by every schema that creates or
 * replaces a password: self-registration, recovery by e-mail, the user's own change, the
 * administrator's create and the administrator's reset.
 *
 * The 72-byte cap is bcrypt's, not a policy: the algorithm silently ignores everything past
 * the 72nd byte, so without the cap two different passwords that only diverge after it hash
 * to the same value, and the product would accept a long password advertising a strength it
 * does not have. The count is in UTF-8 BYTES, not characters, which is where the rule bites in
 * a Portuguese product: an accented letter costs two, so the message must say "bytes".
 *
 * Until 2026-09-19 this rule lived only in `auth.schemas.js` and the three password fields of
 * `users.schemas.js` kept a bare `.max(100)`, so an administrator could create an account with
 * a 100-character password of which bcrypt read the first 72. Guard:
 * `tests/unit/senha-teto-de-bytes-em-todo-schema.test.js`.
 *
 * Login deliberately does NOT use this rule (see the comment above `loginSchema`).
 */
export const PASSWORD_MAX_BYTES = 72;

export const PASSWORD_BYTES_MESSAGE =
  'A senha deve ter no máximo 72 bytes em UTF-8; caracteres acentuados ocupam mais de um byte.';

export const newPassword = Joi.string().required().min(6).max(100).custom((value, helpers) =>
  Buffer.byteLength(value, 'utf8') > PASSWORD_MAX_BYTES ? helpers.error('password.bytes') : value
).messages({ 'password.bytes': PASSWORD_BYTES_MESSAGE });
