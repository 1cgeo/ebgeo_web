// Path: tests/fixtures/censo-permissao-de-atlas/gate-nao-classificado.js
//
// FIXTURE DO CONTROLE NEGATIVO de `tests/unit/permissao-de-atlas-censo.test.js`.
//
// Ela não é alcançada por `git ls-files src/js` e ninguém a importa: existe para que o
// censo possa ser apontado, num caso do próprio arquivo, a um gate por permissão de atlas
// que ninguém classificou, e reprovar. Sem ela, "o censo pega gate novo" seria uma
// afirmação do guarda sobre o guarda, e um censo cuja varredura deixasse de casar qualquer
// coisa passaria todos os outros casos verdes comparando vazio com vazio.
//
// A PRIMEIRA função é a forma PROIBIDA na sua versão canônica: a lista fechada que exclui
// `manage` em silêncio, exatamente o defeito que já embarcou duas vezes neste repositório.
// A SEGUNDA é a forma que só o censo pega, e não a regra de lista fechada: um literal só,
// sem disjunção nenhuma, num gate que deveria comparar posto.

/** A lista fechada canônica: `manage` está ACIMA de `write` e some daqui sem erro. */
export function podeEditarErrado(permission) {
    return permission === 'write' || permission === 'owner';
}

/** Literal solto num gate: passa pela regra de lista fechada e é pego pela classificação. */
export function podeGerirErrado(permission) {
    return permission === 'manage';
}
