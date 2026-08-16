// Path: src/utils/validation-messages.js

/**
 * @fileoverview pt-BR rendering of Joi validation failures, applied at the EDGE.
 *
 * Every 422 the API emits carries `details: [{ field, message }]`, and the web client folds
 * those messages verbatim into the text it shows the user (`buildApiErrorMessage`,
 * `frontend/src/js/store/sync/api-client.js`). Joi writes in English, so a Brazilian user
 * typing a short password read `"password" length must be at least 6 characters long` —
 * the app's own strings are pt-BR everywhere else.
 *
 * WHY HERE AND NOT IN THE SCHEMAS. Joi accepts per-rule `.messages({...})`, but that spreads
 * the translation across 18 `.schemas.js` files and makes the NEXT schema ship in English by
 * default. Translating from `detail.type` (`string.min`, `any.required`, …) in the error
 * handler is one table that covers every schema written so far and every schema written next.
 *
 * TWO TABLES, TWO DIFFERENT CONTRACTS:
 *
 *   - RULES are CLOSED. Joi's rule keys are a finite vocabulary, and the ones this API can
 *     actually produce were read off the schemas. An unknown key degrades to Joi's own English
 *     sentence — wrong language, never a missing message.
 *   - FIELDS are OPEN, on purpose. The API validates ~200 distinct field names, and almost all
 *     of them belong to sync envelopes and ingestion payloads that no human ever types. Only
 *     the fields of a real FORM are translated; anything else keeps its wire name, which is
 *     what a developer reading a 422 wants anyway. Do not grow this into a dictionary of all
 *     field names: a table nobody can keep complete is a table that lies.
 *
 * THE ONE RULE THAT IS NOT HERE IS `string.pattern.base`, and its absence is the contract.
 * A regex has no generic translation worth reading: "contém caracteres não permitidos" is
 * strictly worse than naming which characters ARE allowed, and only the schema knows that.
 * So a pattern's message belongs to its schema, written in pt-BR there — which also means a
 * `.pattern()` added WITHOUT `.messages()` ships an English Joi sentence. That is what
 * `tests/unit/validation-messages.test.js` refuses.
 */

/** Field names that reach a human through a form. Everything else keeps its wire name. */
const FIELD_LABELS = Object.freeze({
  username: 'usuário',
  password: 'senha',
  currentPassword: 'senha atual',
  newPassword: 'nova senha',
  nome: 'nome',
  email: 'e-mail',
  name: 'nome',
  title: 'título',
  description: 'descrição',
  q: 'busca',
  search: 'busca',
  permission: 'permissão',
  role: 'papel',
  org_role: 'papel na organização',
  rank_id: 'posto/graduação',
  organization_id: 'organização militar',
  token: 'token',
  slug: 'identificador',
  sigla: 'sigla',
  label: 'rótulo',
});

/**
 * Renders one Joi failure in pt-BR.
 *
 * Each entry receives THREE arguments, and the split between the first and the third is the
 * point: `f` is the field label for mid-sentence use, `ctx` is Joi's own `context` (quoting
 * its `limit`/`valids` is what makes a message actionable instead of merely translated), and
 * `head` is the same label prepared to OPEN a sentence. `head` is capitalized only for a
 * field the table knows, because capitalizing an untranslated wire name disfigures it
 * (`lamportTimestamp` → `LamportTimestamp`), and a name is not ours to restyle.
 */
const RULE_MESSAGES = Object.freeze({
  'any.required': (f) => `Informe ${f}.`,
  'any.empty': (f) => `Informe ${f}.`,
  'string.empty': (f) => `Informe ${f}.`,
  'string.base': (f) => `O campo ${f} deve ser texto.`,
  'string.min': (f, c, head) => `${head} deve ter ao menos ${c.limit} caracteres.`,
  'string.max': (f, c, head) => `${head} deve ter no máximo ${c.limit} caracteres.`,
  'string.length': (f, c, head) => `${head} deve ter exatamente ${c.limit} caracteres.`,
  'string.email': (f, c, head) => `${head} não é um endereço de e-mail válido.`,
  'string.uri': (f, c, head) => `${head} não é uma URL válida.`,
  'string.guid': (f, c, head) => `${head} não é um identificador válido.`,
  'string.isoDate': (f, c, head) => `${head} não é uma data válida.`,
  'any.only': (f, c, head) => `${head} deve ser ${listOr(c.valids)}.`,
  'any.unknown': (f) => `O campo ${f} não é aceito aqui.`,
  'object.unknown': (f) => `O campo ${f} não é aceito aqui.`,
  'object.base': (f) => `O campo ${f} deve ser um objeto.`,
  'number.base': (f, c, head) => `${head} deve ser um número.`,
  'number.integer': (f, c, head) => `${head} deve ser um número inteiro.`,
  'number.positive': (f, c, head) => `${head} deve ser maior que zero.`,
  'number.min': (f, c, head) => `${head} deve ser no mínimo ${c.limit}.`,
  'number.max': (f, c, head) => `${head} deve ser no máximo ${c.limit}.`,
  'boolean.base': (f, c, head) => `${head} deve ser verdadeiro ou falso.`,
  'array.base': (f) => `O campo ${f} deve ser uma lista.`,
  'array.min': (f, c) => `Informe ao menos ${c.limit} item(ns) em ${f}.`,
  'array.max': (f, c, head) => `${head} aceita no máximo ${c.limit} item(ns).`,
  'array.length': (f, c, head) => `${head} deve ter exatamente ${c.limit} item(ns).`,
  'date.base': (f, c, head) => `${head} não é uma data válida.`,
  'alternatives.match': (f, c, head) => `${head} não está num formato aceito.`,
});

/** Uppercases the first letter without touching the rest (accents included). */
function cap(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Renders an allowed-values list as `"a", "b" ou "c"`, skipping Joi's `null` placeholder. */
function listOr(valids) {
  const values = (Array.isArray(valids) ? valids : [])
    .filter((v) => v !== null && v !== '')
    .map((v) => `"${v}"`);
  if (values.length === 0) return 'um valor aceito';
  if (values.length === 1) return values[0];
  return `${values.slice(0, -1).join(', ')} ou ${values[values.length - 1]}`;
}

/**
 * Human label for a validated path. The LAST segment is what names the field for a user
 * (`body.password` → senha); the untranslated fallback is the segment itself.
 * @param {Array<string|number>} path - Joi's `detail.path`.
 * @returns {{label: string, known: boolean}} `known` is false for a bare wire name, which is
 *   what stops the caller from capitalizing something it did not write.
 */
function labelFor(path) {
  const segments = Array.isArray(path) ? path : [];
  const last = segments.filter((s) => typeof s === 'string').pop();
  if (!last) return { label: 'o valor enviado', known: true };
  const label = FIELD_LABELS[last];
  return label ? { label, known: true } : { label: last, known: false };
}

/**
 * Translates one Joi detail into a pt-BR sentence.
 * @param {{type?: string, path?: Array, context?: Object, message?: string}} detail
 * @returns {string} The pt-BR sentence, or Joi's own message when the rule is not mapped.
 */
export function translateJoiDetail(detail) {
  const render = RULE_MESSAGES[detail?.type];
  if (!render) return detail?.message || 'Valor inválido.';
  const { label, known } = labelFor(detail.path);
  return render(label, detail.context || {}, known ? cap(label) : label);
}

/**
 * Maps a Joi error's details into the `{ field, message }` shape the 422 envelope carries.
 * `field` stays the WIRE path (`password`, `body.name`): it is a machine key that clients and
 * tests match on, and translating it would break them. Only `message` is for humans.
 * @param {Array<Object>} details - `err.details` from Joi.
 * @returns {Array<{field: string, message: string}>}
 */
export function toValidationDetails(details) {
  return (Array.isArray(details) ? details : []).map((d) => ({
    field: (d.path || []).join('.'),
    message: translateJoiDetail(d),
  }));
}
