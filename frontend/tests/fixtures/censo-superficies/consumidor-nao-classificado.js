// Path: tests/fixtures/censo-superficies/consumidor-nao-classificado.js
//
// FIXTURE DO CONTROLE NEGATIVO de `tests/unit/superficies-de-recurso-censo.test.js`.
//
// Ela não é alcançada por `git ls-files src/js` e ninguém a importa: existe para que o
// censo possa ser apontado, num caso do próprio arquivo, a um consumidor de catálogo que
// ninguém classificou — e reprovar. Sem ela, "o censo pega consumidor novo" seria uma
// afirmação do guarda sobre o guarda, e um censo cuja varredura deixasse de casar
// qualquer coisa passaria todos os outros casos verdes comparando vazio com vazio.

import config from '../../../src/js/config.js';

export function listarTilesetsSemClassificacao() {
    return config.tilesets ?? [];
}
