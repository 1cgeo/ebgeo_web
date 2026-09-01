// Path: src/utils/elidir-sql.js
/**
 * @fileoverview Elides the VALUES out of an already-formatted SQL statement, keeping
 * the SHAPE (command, tables, columns, operators) readable.
 *
 * WHY THIS EXISTS. `pgFormatting` is left at pg-promise's default (`false`), which is
 * not a detail: in that regime the library does the formatting itself
 * (`node_modules/pg-promise/lib/query.js`, the `formatQuery` branch), so by the time
 * the `query` and `error` events fire, the `$1`/`$2` placeholders are GONE and the
 * text carries the literal values. `err.query` is stamped with that same text. So the
 * SQL string reaching a log line is not a template, it is the statement WITH the
 * credentials inside: the api_key of `FIND_USER_BY_API_KEY`, the refresh-token hash of
 * `FIND_REFRESH_TOKEN_ANY`, the bcrypt `password_hash` of every user write. pino's
 * `redact` matches by FIELD NAME and the field here is called `query`, so nothing in
 * the logger could ever have seen it.
 *
 * Turning `pgFormatting` ON would remove the values from the text, and is NOT the fix:
 * the codebase depends on pg-promise's own formatting engine (named parameters
 * `$<name>` across `modules/models3d/models3d.queries.js`, the `:csv` modifier in
 * `modules/atlas/atlas.service.js`, `pgp.helpers.ColumnSet`/`insert`). Changing it to
 * repair a logging problem would break live queries.
 *
 * WHAT IT DOES. A lexical scan, not a parser. Single-quoted literals become `'?'`,
 * numeric literals become `?`, dollar-quoted blocks become `$?$`. Identifiers,
 * keywords, punctuation and comments are preserved, because THEY are the diagnostic
 * value: knowing that the statement was an `UPDATE users SET password_hash = '?'` is
 * everything one needs, and the value is exactly what one must not have.
 *
 * WHAT IT DELIBERATELY DOES NOT GUARANTEE (an honest reach beats a complete-sounding
 * one, because the next reader will trust whatever this paragraph claims):
 *
 * - It is NOT a SQL parser and its output is NOT guaranteed to be valid or re-runnable
 *   SQL. It is a redaction of a diagnostic string.
 * - A value that reaches SQL as an IDENTIFIER survives. Bare words and double-quoted
 *   identifiers (`"whatever"`) are kept verbatim, on the assumption enforced elsewhere
 *   that dynamic identifiers come from a column whitelist and never from input.
 * - A value that is an unquoted keyword survives: `true`, `false`, `null`, `DEFAULT`
 *   are indistinguishable from syntax here, and are kept.
 * - The preserved SHAPE still discloses schema (table and column names) and the
 *   command's structure. That is intentional; it is not a confidentiality boundary
 *   against someone who may read the logs at all.
 * - It says nothing about the `params` array of a pg-promise error, nor about the
 *   driver's `detail`/`where`/`internalQuery` fields. Those carry values through a
 *   different door and are handled in `utils/logger.js`.
 * - Only PostgreSQL lexical forms are handled (`''` doubling, `E'\'` backslash
 *   escapes, `B`/`X`/`N`/`U&` prefixes, `$tag$` quoting, nested block comments).
 *   Another dialect's quoting (MySQL backticks, `\"` inside plain literals) is not
 *   modeled.
 * - An UNTERMINATED literal is elided to the end of the string. That fails closed (it
 *   redacts more than needed), and it means a malformed statement can come back as
 *   little more than a marker.
 * - Comment bodies are preserved verbatim. Values never land inside a comment (the
 *   formatter quotes them), but a comment written by hand is echoed as written.
 *
 * Zero imports on purpose: this runs inside the logging path of the database layer,
 * and it must be exercisable in plain node with no config, no logger and no pool.
 */

/** Replaces the contents of any quoted literal. */
export const MARCADOR_TEXTO = "'?'";
/** Replaces a numeric literal. */
export const MARCADOR_NUMERO = '?';
/** Replaces a dollar-quoted block, tag included. */
export const MARCADOR_CIFRAO = '$?$';
/** Ceiling applied AFTER elision, so it never decides what is secret. */
export const TETO_PADRAO = 1000;
/** Appended when the ceiling cut the text, so a reader knows the tail is missing. */
export const SUFIXO_TRUNCADO = '...[truncado]';

const INICIO_IDENT = /[A-Za-z_]/;
const CORPO_IDENT = /[A-Za-z0-9_]/;
const DIGITO = /[0-9]/;
// The four literal prefixes that are a single identifier-looking letter. `U&` is not,
// and is matched apart, because `&` is not an identifier character.
const PREFIXO_DE_LITERAL = /^[ENBXenbx]$/;

/**
 * Consumes a single-quoted literal starting at `i` (which must point at the quote).
 *
 * `''` doubling continues the SAME literal, which is the trap: stopping at the first
 * closing quote would leak the tail of a value containing an apostrophe as if it were
 * SQL. A backslash escapes the next character only in the `E'...'` form.
 *
 * @param {string} s
 * @param {number} i - index of the opening quote.
 * @param {boolean} escapaComBarra - true for `E'...'`.
 * @returns {number} index just past the literal (or `s.length` if unterminated).
 */
function fimDoLiteral(s, i, escapaComBarra) {
  let j = i + 1;
  while (j < s.length) {
    const c = s[j];
    if (escapaComBarra && c === '\\') {
      j += 2;
      continue;
    }
    if (c === "'") {
      if (s[j + 1] === "'") {
        j += 2;
        continue;
      }
      return j + 1;
    }
    j += 1;
  }
  return s.length;
}

/**
 * Reads a dollar-quoted opener at `i` and returns its tag, or null when `i` is not one
 * (`$1`, or a lone `$`). The tag may be empty (`$$`).
 *
 * @param {string} s
 * @param {number} i
 * @returns {string|null}
 */
function tagDeCifrao(s, i) {
  if (s[i] !== '$') return null;
  let j = i + 1;
  if (j < s.length && INICIO_IDENT.test(s[j])) {
    j += 1;
    while (j < s.length && CORPO_IDENT.test(s[j])) j += 1;
  }
  return s[j] === '$' ? s.slice(i + 1, j) : null;
}

/**
 * Skips a block comment starting at `i`, honouring PostgreSQL's NESTING.
 *
 * @param {string} s
 * @param {number} i
 * @returns {number} index just past the comment.
 */
function fimDoComentarioEmBloco(s, i) {
  let profundidade = 0;
  let j = i;
  while (j < s.length) {
    if (s[j] === '/' && s[j + 1] === '*') {
      profundidade += 1;
      j += 2;
      continue;
    }
    if (s[j] === '*' && s[j + 1] === '/') {
      profundidade -= 1;
      j += 2;
      if (profundidade === 0) return j;
      continue;
    }
    j += 1;
  }
  return s.length;
}

/**
 * Elides the values of an already-formatted SQL statement.
 *
 * @param {unknown} texto - the SQL as pg-promise handed it over. Non-strings are
 *   coerced, because `e.query` is only a string by convention.
 * @param {{teto?: number}} [opcoes] - `teto`: maximum length of the result, markers
 *   included. Non-finite or negative falls back to the default.
 * @returns {string} the statement with values replaced by markers.
 */
export function elidirSql(texto, opcoes = {}) {
  const s = typeof texto === 'string' ? texto : String(texto ?? '');
  const tetoBruto = opcoes.teto;
  const teto = Number.isFinite(tetoBruto) && tetoBruto >= 0 ? tetoBruto : TETO_PADRAO;

  let out = '';
  let i = 0;

  while (i < s.length) {
    const c = s[i];

    if (c === '-' && s[i + 1] === '-') {
      const fim = s.indexOf('\n', i);
      const ate = fim === -1 ? s.length : fim;
      out += s.slice(i, ate);
      i = ate;
      continue;
    }

    if (c === '/' && s[i + 1] === '*') {
      const fim = fimDoComentarioEmBloco(s, i);
      out += s.slice(i, fim);
      i = fim;
      continue;
    }

    // Double-quoted IDENTIFIER: preserved, but it still has to be consumed as a unit,
    // otherwise an apostrophe inside it ("d'agua") would open a literal and swallow
    // the rest of the statement.
    if (c === '"') {
      let j = i + 1;
      while (j < s.length) {
        if (s[j] === '"') {
          if (s[j + 1] === '"') { j += 2; continue; }
          j += 1;
          break;
        }
        j += 1;
      }
      out += s.slice(i, j);
      i = j;
      continue;
    }

    if (c === "'") {
      i = fimDoLiteral(s, i, false);
      out += MARCADOR_TEXTO;
      continue;
    }

    if (c === '$') {
      const tag = tagDeCifrao(s, i);
      if (tag !== null) {
        const abre = `$${tag}$`;
        const fim = s.indexOf(abre, i + abre.length);
        i = fim === -1 ? s.length : fim + abre.length;
        out += MARCADOR_CIFRAO;
        continue;
      }
      // `$1` is a PLACEHOLDER, not a value: it survives formatting only on the paths
      // where formatting threw, and there it is the most useful thing in the string.
      if (DIGITO.test(s[i + 1] ?? '')) {
        let j = i + 1;
        while (j < s.length && DIGITO.test(s[j])) j += 1;
        out += s.slice(i, j);
        i = j;
        continue;
      }
      out += c;
      i += 1;
      continue;
    }

    if (c === 'U' || c === 'u') {
      if (s[i + 1] === '&' && s[i + 2] === "'") {
        i = fimDoLiteral(s, i + 2, false);
        out += MARCADOR_TEXTO;
        continue;
      }
    }

    if (INICIO_IDENT.test(c)) {
      let j = i;
      while (j < s.length && CORPO_IDENT.test(s[j])) j += 1;
      const palavra = s.slice(i, j);
      // A one-letter run glued to a quote is a literal PREFIX, never an identifier.
      // Reading it as an identifier would leave the quote to be scanned on its own,
      // which is harmless, but reading `E'...\''` without the backslash rule is not.
      if (PREFIXO_DE_LITERAL.test(palavra) && s[j] === "'") {
        i = fimDoLiteral(s, j, palavra === 'E' || palavra === 'e');
        out += MARCADOR_TEXTO;
        continue;
      }
      out += palavra;
      i = j;
      continue;
    }

    // A number is only reachable here when it does NOT continue an identifier: the
    // branch above already swallowed `sv360`, `md5` and `column_2`.
    if (DIGITO.test(c) || (c === '.' && DIGITO.test(s[i + 1] ?? ''))) {
      let j = i;
      while (j < s.length && (DIGITO.test(s[j]) || s[j] === '.')) j += 1;
      if ((s[j] === 'e' || s[j] === 'E') && j + 1 < s.length) {
        let k = j + 1;
        if (s[k] === '+' || s[k] === '-') k += 1;
        if (DIGITO.test(s[k] ?? '')) {
          while (k < s.length && DIGITO.test(s[k])) k += 1;
          j = k;
        }
      }
      out += MARCADOR_NUMERO;
      i = j;
      continue;
    }

    out += c;
    i += 1;
  }

  if (out.length > teto) {
    return out.slice(0, teto) + SUFIXO_TRUNCADO;
  }
  return out;
}
