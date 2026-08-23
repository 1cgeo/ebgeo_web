// Path: eslint-rules/require-path-comment.js
// Every file under `frontend/src/js/` must open with `// Path: js/<...>.js`.
// The constitution has demanded it for as long as the repo exists and adds
// "nunca remova" — which is exactly the kind of requirement that prose cannot
// enforce, because prose is only checked when somebody happens to read it.
//
// The failure mode is real and recent. When the ebgeo_360 calibration app was
// ported in as the fourth page (0d796805), ELEVEN files of `js/calibration/`
// landed with their `/**` block as line 1 and no path comment at all. Nobody
// noticed until an audit went looking, weeks later (fixed in d9d0d49b and the
// commits that followed). Nothing was broken, nothing was red: a whole folder
// silently opted out of the convention, and every file copied from it would
// have inherited the omission.
//
// The rule also compares the DECLARED path against the real one, because a
// wrong path comment is worse than a missing one: a missing header is visibly
// absent, while a stale one (file moved, header copy-pasted from the sibling it
// was cloned from) asserts a location that is not its own, and it survives
// every grep for the convention. Presence alone would have declared such a file
// compliant.
//
// SCOPE — deliberately narrow, because a false positive here costs more than a
// false negative: `--max-warnings 0` means one bad report turns the whole lint
// red, and the cheapest way out for the next developer is to switch the rule
// off. What is checked and what is not:
//
//   - Checked: `.js` files whose real path contains `src/js/`. That is the only
//     tree where the convention is unambiguous ("relativo ao `src/` do pacote",
//     so the expected value always starts with `js/`). EVERY file under that
//     tree complies today, so the rule reports ZERO violations and exists purely
//     to keep the next `calibration/` from happening. The count is deliberately
//     not written here: an absolute nobody re-measures becomes a lie, and the
//     property that survives is "zero violations", which `npm run lint` re-proves
//     on every run.
//   - NOT checked: `frontend/tests/**`, config files at the package root, and
//     `frontend/eslint-rules/**`. They do carry path comments, but relative to
//     the PACKAGE root, and inconsistently: 118 of the 263 files outside
//     `src/js/` declare a path that is not their package-relative one (the
//     whole `tests/e2e-ui/` folder writes `e2e-ui/x.spec.js`). Guessing a base
//     directory for them would produce a hundred reports on a convention that
//     was never agreed, which is precisely how a rule gets disabled.
//   - NOT checked: `.mjs`/`.cjs`, `node_modules/`, `dist/`, and vendored code
//     under `src/vendor/` (outside `src/js/`, so it never matches).
//   - NOT interpreted: anything after the path on line 1. The format is fixed,
//     so `// Path: js/a.js (movido)` is reported as a wrong path rather than
//     silently accepted. Only surrounding spaces and a leading `./` are
//     tolerated.
//
// Both cases are auto-fixable, because both fixes are mechanical: insert the
// line (BEFORE whatever comment already opens the file — the calibration files
// each opened with a `/**` block that must survive), or rewrite the declared
// path with the real one. The third case, a header that exists but sits below
// another comment, is reported WITHOUT a fix: inserting would leave the file
// with two path lines, and moving text around is not what an autofix should do
// unasked. There are zero such files today.

const SRC_JS_MARKER = '/src/js/';

// Line 1 shape. `\r` is tolerated so a CRLF checkout is not reported as broken.
const HEADER_RE = /^\/\/ Path:[ \t]*(.*?)[ \t\r]*$/;

// How far down to look for a header that exists but sits on the wrong line.
const MISPLACED_LOOKAHEAD = 10;

/**
 * Expected header value for a file, or null when the file is out of scope.
 *
 * @param {string} filename Absolute path as ESLint reports it.
 * @returns {string|null} e.g. `js/calibration/viewer.js`
 */
function expectedPathFor(filename) {
    if (typeof filename !== 'string' || !filename.endsWith('.js')) return null;

    const normalized = filename.replace(/\\/g, '/');
    if (normalized.includes('/node_modules/') || normalized.includes('/dist/')) return null;

    // lastIndexOf, so a checkout nested under another `src/js` still resolves
    // against the innermost package.
    const index = normalized.lastIndexOf(SRC_JS_MARKER);
    if (index === -1) return null;

    return `js/${normalized.slice(index + SRC_JS_MARKER.length)}`;
}

export default {
    meta: {
        type: 'problem',
        docs: {
            description:
                'exige `// Path: js/...` na primeira linha de todo arquivo de src/js/, batendo com o caminho real',
        },
        fixable: 'code',
        schema: [],
        messages: {
            missing:
                'Falta o comentário de caminho na primeira linha. Acrescente `// Path: {{expected}}` como linha 1, antes de qualquer outro comentário (a correção automática do ESLint faz isso: `--fix`).',
            wrong:
                'O comentário de caminho diz `{{declared}}`, mas o arquivo está em `{{expected}}`. Caminho errado engana mais que caminho ausente: corrija a linha 1 para `// Path: {{expected}}` (ou rode `--fix`).',
            misplaced:
                'O comentário de caminho existe, mas não na primeira linha (está na linha {{found}}). Mova-o para a linha 1, com o valor `// Path: {{expected}}`. Aqui não há correção automática, para não deixar duas linhas de caminho no arquivo.',
        },
    },
    create(context) {
        const filename = context.filename ?? context.getFilename();
        const expected = expectedPathFor(filename);
        if (expected === null) return {};

        return {
            Program() {
                const sourceCode = context.sourceCode;
                const lines = sourceCode.lines;
                const text = sourceCode.text;

                // A shebang is not a comment for our purposes: the path line
                // goes right below it, never above.
                const hasShebang = (lines[0] ?? '').startsWith('#!');
                const headerIndex = hasShebang ? 1 : 0;
                const headerLine = lines[headerIndex] ?? '';
                const eol = text.includes('\r\n') ? '\r\n' : '\n';

                const match = HEADER_RE.exec(headerLine);

                if (match === null) {
                    // A header sitting below another comment is still a
                    // violation (the convention says line 1), but inserting a
                    // second one would leave the file with two path lines, so
                    // this branch reports without fixing.
                    const misplacedAt = lines
                        .slice(0, MISPLACED_LOOKAHEAD)
                        .findIndex((line, index) => index !== headerIndex && HEADER_RE.test(line));
                    if (misplacedAt !== -1) {
                        context.report({
                            loc: { line: misplacedAt + 1, column: 0 },
                            messageId: 'misplaced',
                            data: { expected, found: String(misplacedAt + 1) },
                        });
                        return;
                    }

                    context.report({
                        loc: { line: headerIndex + 1, column: 0 },
                        messageId: 'missing',
                        data: { expected },
                        fix(fixer) {
                            if (!hasShebang) {
                                return fixer.insertTextBeforeRange([0, 0], `// Path: ${expected}${eol}`);
                            }
                            const firstBreak = text.indexOf('\n');
                            if (firstBreak === -1) {
                                // Shebang and nothing else: open a new line.
                                return fixer.insertTextAfterRange(
                                    [text.length, text.length],
                                    `${eol}// Path: ${expected}`
                                );
                            }
                            const insertAt = firstBreak + 1;
                            return fixer.insertTextAfterRange(
                                [insertAt, insertAt],
                                `// Path: ${expected}${eol}`
                            );
                        },
                    });
                    return;
                }

                const declared = match[1].replace(/^\.\//, '');
                if (declared === expected) return;

                const lineStart = sourceCode.getIndexFromLoc({ line: headerIndex + 1, column: 0 });
                context.report({
                    loc: { line: headerIndex + 1, column: 0 },
                    messageId: 'wrong',
                    data: { declared: match[1], expected },
                    fix(fixer) {
                        return fixer.replaceTextRange(
                            [lineStart, lineStart + headerLine.length],
                            `// Path: ${expected}`
                        );
                    },
                });
            },
        };
    },
};
