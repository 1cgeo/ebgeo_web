// Path: tests/unit/comentario-gate-por-posto.test.js
//
// O gate de autoria do comentário espacial (`applyCommentOp`, `src/modules/sync/sync.service.js`)
// era uma LISTA FECHADA transcrita à mão:
//
//   const isEditor = permission === 'write' || permission === 'manage' || permission === 'owner';
//
// no MESMO arquivo que importa `PERMISSION_LEVELS` e o usa certo dez funções acima
// (`operationDenialReason`). Ela estava correta para os cinco níveis de hoje, e é essa a
// armadilha: um nível novo acima de `write` sairia do gate em silêncio, sem erro, sem
// teste vermelho, exatamente como a constituição descreve nas duas vezes em que a mesma
// forma já causou bug real neste monorepo.
//
// `tests/integration/comments-manage-tier.test.js` mede o COMPORTAMENTO contra o Postgres,
// tabelado nos cinco níveis, e continua sendo o guarda que vale. Este arquivo mede outra
// coisa, que aquele não pode medir: a FORMA da expressão. Um dia em que a escada ganhe um
// degrau, o teste de integração fica vermelho porque a tabela dele é asserida exata; este
// aqui fica vermelho antes, e diz por quê.
//
// POR QUE ELE NÃO SE AUTOCONFIRMA: a tabela de verdade abaixo não avalia uma CÓPIA da
// expressão escrita aqui. Ela lê a linha do arquivo de produção, exige que o lado direito
// seja exatamente a expressão esperada e avalia ESSE texto. Uma cópia local passaria verde
// com a produção arbitrariamente errada, que é a definição de cobertura vazia.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PERMISSION_LEVELS } from '../../src/middleware/permissions.js';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const CAMINHO_SYNC = join(RAIZ, 'src/modules/sync/sync.service.js');
const FONTE = readFileSync(CAMINHO_SYNC, 'utf8');

/** O lado direito que o gate deve ter, letra por letra. */
const EXPRESSAO = 'PERMISSION_LEVELS[permission] >= PERMISSION_LEVELS.write';

/**
 * A escada inteira, cada nível com o que ele PODE fazer a um comentário alheio.
 * Números absolutos, escritos à mão a partir de `PERMISSION_LEVELS` e da regra declarada
 * ("editor e acima"), nunca derivados da expressão sob teste.
 */
const POSTOS = [
  { permission: 'read', nivel: 1, editor: false },
  { permission: 'comment', nivel: 2, editor: false },
  { permission: 'write', nivel: 3, editor: true },
  { permission: 'manage', nivel: 4, editor: true },
  { permission: 'owner', nivel: 5, editor: true },
];

/** A lista fechada que existia antes, preservada aqui como referência de equivalência. */
const listaFechadaAntiga = (permission) =>
  permission === 'write' || permission === 'manage' || permission === 'owner';

/** @returns {string} o lado direito da atribuição de `isEditor`, sem `;`. */
function ladoDireitoDoGate() {
  const linhas = FONTE.split('\n').filter((l) => /^\s*const isEditor\s*=/.test(l));
  assert.equal(
    linhas.length,
    1,
    `esperava exatamente UMA atribuição de isEditor em ${CAMINHO_SYNC}, achei ${linhas.length}`,
  );
  return linhas[0].replace(/^\s*const isEditor\s*=\s*/, '').replace(/;\s*$/, '');
}

describe('gate de autoria do comentário espacial: posto, não lista fechada', () => {
  it('a escada tem os cinco níveis nos postos que esta tabela assume', () => {
    // Se a escada mudar de forma, a tabela abaixo deixa de significar o que promete.
    assert.deepEqual(Object.keys(PERMISSION_LEVELS), ['read', 'comment', 'write', 'manage', 'owner']);
    for (const { permission, nivel } of POSTOS) {
      assert.equal(PERMISSION_LEVELS[permission], nivel, `posto de ${permission}`);
    }
  });

  it('o gate de produção compara POSTO com a escada importada', () => {
    const direito = ladoDireitoDoGate();
    assert.equal(
      direito,
      EXPRESSAO,
      'o gate de autoria do comentário voltou a não ser uma comparação de posto contra'
        + ` PERMISSION_LEVELS. Achei: ${direito}`,
    );
    assert.ok(
      !/permission\s*===/.test(direito),
      `lista fechada de novo no gate de comentário: ${direito}`,
    );
  });

  it('a expressão DE PRODUÇÃO dá o resultado certo nos cinco níveis, um a um', () => {
    // `new Function` avalia o texto lido do arquivo de produção, não uma cópia local:
    // é o que impede este teste de passar verde com o gate arbitrariamente errado.
    const gate = new Function('PERMISSION_LEVELS', 'permission', `return ${ladoDireitoDoGate()};`);

    assert.equal(POSTOS.length, 5, 'a tabela precisa cobrir a escada inteira');
    for (const { permission, editor } of POSTOS) {
      const obtido = gate(PERMISSION_LEVELS, permission);
      // Absoluto: o valor esperado é o da regra, não o da outra implementação.
      assert.equal(obtido, editor, `${permission}: esperava isEditor=${editor}`);
      // E equivalente: a troca preservou o comportamento dos cinco níveis de hoje.
      assert.equal(
        obtido,
        listaFechadaAntiga(permission),
        `${permission}: a forma nova divergiu da lista fechada que ela substituiu`,
      );
      // O valor vai para o SQL como parâmetro booleano; `undefined` ali é 22P02 na cara.
      assert.equal(typeof obtido, 'boolean', `${permission}: o gate precisa render booleano`);
    }
  });

  it('nível desconhecido ou ausente fecha o gate, em vez de o abrir', () => {
    // `PERMISSION_LEVELS['managee']` é undefined e toda comparação com undefined é false,
    // então a comparação de posto falha FECHADA. É a mesma armadilha que
    // `requireAtlasPermission` transforma em erro de boot; aqui o efeito seguro basta.
    const gate = new Function('PERMISSION_LEVELS', 'permission', `return ${ladoDireitoDoGate()};`);
    for (const ruim of [undefined, null, '', 'managee', 'ADMIN', 'write ', 0, {}]) {
      assert.equal(gate(PERMISSION_LEVELS, ruim), false, `nível inválido abriu o gate: ${String(ruim)}`);
      assert.equal(typeof gate(PERMISSION_LEVELS, ruim), 'boolean');
    }
  });
});
