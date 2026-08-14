// Path: js/nested/deep-file.js
// NEGATIVE CONTROL (negative half): a nested file, to prove the expected value
// is computed from the whole path below `src/`, not just the basename. A rule
// that compared only file names would accept `wrong-header.js` next door.

export function aninhado() {
    return 'aninhado';
}
