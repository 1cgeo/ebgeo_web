// Path: eslint-rules/index.js
// Local ESLint plugin: the house conventions that were prose until 2026-08-14.
//
// WHY THIS EXISTS. The constitution lists conventions that "must always happen"
// (the path comment on line 1, EventTypes instead of a string literal, deepClone
// instead of the JSON idiom, no CSS written inside JS, never innerHTML with user
// data). All of them were enforced by reading, and the audit of 2026-08-14 found
// real defects in every one of those categories, including a stored XSS that
// travelled between users through sync.
//
// The backend had already proved the other way round, with its own rules plus a
// probe. This is the same shape for the web package: a rule that a linter can
// fail is a rule; a rule in prose is a hope.
//
// EVERY RULE HERE WAS MEASURED against the existing 601 files before being
// written, because a rule that flags hundreds of sites is a rule someone will
// switch off, and `--max-warnings 0` makes "warning" and "error" the same thing
// here. What each rule deliberately does NOT catch is written at the top of its
// own file, which matters more than what it catches.
import requirePathComment from './require-path-comment.js';
import noEventStringLiteral from './no-event-string-literal.js';
import noJsonClone from './no-json-clone.js';
import noInlineStyleAssignment from './no-inline-style-assignment.js';
import noUnescapedInnerhtml from './no-unescaped-innerhtml.js';
import noMaplibreGlobal from './no-maplibre-global.js';

export default {
    meta: { name: 'ebgeo', version: '1.0.0' },
    rules: {
        'require-path-comment': requirePathComment,
        'no-event-string-literal': noEventStringLiteral,
        'no-json-clone': noJsonClone,
        'no-inline-style-assignment': noInlineStyleAssignment,
        'no-unescaped-innerhtml': noUnescapedInnerhtml,
        'no-maplibre-global': noMaplibreGlobal,
    },
};
