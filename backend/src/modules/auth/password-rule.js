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
 * a Portuguese product: an accented letter costs two. The message names NO number (since
 * 2026-09-22, as the recovery screen's `PASSWORD_HEAVY_TEXT` already did): the cap bites at a
 * different character count for every password, so "72" would announce a limit the person just
 * disproved by typing fewer characters than that. The frontend mirrors the sentence
 * (`PASSWORD_BYTES_TEXT`, `frontend/tests/unit/conta-regra-de-senha-espelha-servidor.test.js`).
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
  'Senha longa demais. Use uma senha mais curta.';

export const newPassword = Joi.string().required().min(6).max(100).custom((value, helpers) =>
  Buffer.byteLength(value, 'utf8') > PASSWORD_MAX_BYTES ? helpers.error('password.bytes') : value
).messages({ 'password.bytes': PASSWORD_BYTES_MESSAGE });
