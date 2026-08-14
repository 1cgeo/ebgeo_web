// Path: js/nested/wrong-header.js
// NEGATIVE CONTROL (positive half) for require-path-comment: the header is
// present and well formed, but it points at `js/nested/`, where this file does
// not live. This is the case presence-only checking would call compliant.
//
// EXPECT: require-path-comment

export function cabecalhoQueMente() {
    return 'o comentário afirma um lugar que não é o dele';
}
