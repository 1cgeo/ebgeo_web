// NEGATIVE CONTROL (negative half) for require-path-comment, and the one that
// matters most: this file is OUTSIDE `src/js/` and has no path comment. It must
// stay silent. `frontend/tests/` holds ~100 such files, and 118 files outside
// `src/js/` declare a path that is not their package-relative one; a rule that
// fired here would report over a hundred violations on day one and be turned
// off by the next developer.

export function foraDeEscopo() {
    return 'fora de escopo';
}
