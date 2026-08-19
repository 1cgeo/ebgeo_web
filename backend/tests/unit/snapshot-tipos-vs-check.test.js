// Path: tests/unit/snapshot-tipos-vs-check.test.js
//
// AS DUAS LISTAS DE TIPO DE FEICAO PRECISAM CONCORDAR.
//
// O CHECK `valid_feature_type` (migracao 003_atlas.sql) decide o que PODE ser
// gravado. O mapa `typeToCollection` (sync.service.js) decide o que aparece no
// snapshot que todo cliente le. Sao listas independentes, escritas em linguagens
// diferentes, e nada as amarrava.
//
// O MODO DE FALHA, que e assimetrico e por isso perigoso:
//
//   tipo no CHECK e AUSENTE do mapa  -> a feicao e gravada e fica INVISIVEL para
//     todos os clientes, sem erro em lugar nenhum. O autor ve o que desenhou
//     (esta no IndexedDB dele), ninguem mais ve, e o servidor jura que recebeu.
//   tipo no mapa e ausente do CHECK  -> inofensivo hoje (a escrita e barrada
//     antes), mas e sinal de mapa desatualizado, entao tambem falha aqui.
//
// Isto nao e hipotese. Este repositorio ja teve TRES listas de tipo de feicao
// divergindo entre si no frontend, e a auditoria de 2026-08-14 achou uma quarta
// (`FEATURE_SOURCES`) onde um tipo esquecido simplesmente nao aparecia na aba de
// camadas. A lista aqui e a quinta, e e a unica cuja divergencia produz dado
// gravado que ninguem consegue ler.
//
// O teste le as DUAS FONTES REAIS (o SQL da migracao e o codigo do servico) em
// vez de manter uma terceira copia, que so daria mais um lugar para divergir.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Tipos aceitos pelo CHECK da tabela `features`, lidos da migracao.
 *
 * @returns {string[]}
 */
function tiposDoCheck() {
    const sql = readFileSync(join(RAIZ, 'src/database/migrations/003_atlas.sql'), 'utf8');
    const i = sql.indexOf('CONSTRAINT valid_feature_type CHECK (feature_type IN (');
    assert.notEqual(i, -1, 'o CHECK valid_feature_type sumiu da baseline de atlas');
    const bloco = sql.slice(i, sql.indexOf('))', i));
    return [...bloco.matchAll(/'([a-z_]+)'/g)].map(m => m[1]);
}

/**
 * Chaves do mapa `typeToCollection` do servico de sync, lidas do fonte.
 *
 * @returns {string[]}
 */
function tiposDoSnapshot() {
    const js = readFileSync(join(RAIZ, 'src/modules/sync/sync.service.js'), 'utf8');
    const i = js.indexOf('const typeToCollection = {');
    assert.notEqual(i, -1, 'o mapa typeToCollection sumiu do sync.service');
    const bloco = js.slice(i, js.indexOf('};', i));
    return [...bloco.matchAll(/^\s*([a-z_]+):\s*'/gm)].map(m => m[1]);
}

describe('tipos de feicao: CHECK do banco contra o mapa do snapshot', () => {
    it('as duas listas foram encontradas e nao estao vazias', () => {
        // Ancora anti-vacuidade: se qualquer uma das duas extracoes deixar de
        // casar (renomearam a constraint, mudaram a forma do objeto), as
        // comparacoes abaixo passariam comparando vazio com vazio.
        const check = tiposDoCheck();
        const snap = tiposDoSnapshot();
        assert.ok(check.length >= 20, `o CHECK devolveu so ${check.length} tipos`);
        assert.ok(snap.length >= 20, `o mapa devolveu so ${snap.length} tipos`);
    });

    it('todo tipo gravavel tem balde no snapshot', () => {
        const check = tiposDoCheck();
        const snap = new Set(tiposDoSnapshot());
        const invisiveis = check.filter(t => !snap.has(t));
        assert.deepEqual(invisiveis, [],
            'tipos que o banco ACEITA e o snapshot NAO entrega: a feicao seria '
            + 'gravada e ficaria invisivel para todo cliente, sem erro nenhum');
    });

    it('todo balde do snapshot corresponde a um tipo gravavel', () => {
        const check = new Set(tiposDoCheck());
        const snap = tiposDoSnapshot();
        const orfaos = snap.filter(t => !check.has(t));
        assert.deepEqual(orfaos, [],
            'baldes para tipo que o banco nao aceita: mapa desatualizado');
    });

    it('nenhum tipo do CHECK esta duplicado', () => {
        const check = tiposDoCheck();
        assert.equal(new Set(check).size, check.length);
    });
});
