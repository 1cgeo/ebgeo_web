// Path: tests/unit/ambiente-do-navegador-check.test.js
/**
 * @fileoverview The browser environment vocabulary lives TWICE on this side: the leaf
 * `src/modules/uso/ambiente-do-navegador.js`, from which both anonymous routes build their Joi,
 * and three CHECK constraints in `src/database/migrations/014_ambiente_do_navegador.sql`. The
 * other side of the mirror (client leaf against this leaf) is
 * `frontend/tests/unit/ambiente-do-navegador-espelha-backend.test.js`.
 *
 * The migration is read from DISK, so this runs without PostgreSQL; the case that exercises the
 * CHECK for real (a direct INSERT) is in `tests/integration/ambiente-do-navegador.test.js`.
 *
 * NEGATIVE CONTROLS (checked by reverting): adding a value only to the leaf or only to one CHECK
 * turns the equality case red and names the list; reordering one side does too (the comparison
 * is by list, not by set); importing anything in the leaf turns the leaf case red; and
 * `resumoDoAmbiente` printing a field the client did not send turns its absolute case red.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  FAMILIAS_DE_NAVEGADOR,
  FAMILIAS_DE_SO,
  TIPOS_DE_DISPOSITIVO,
  VERSOES_DE_WEBGL,
  TETOS_DE_AMBIENTE,
  FORMAS_DE_AMBIENTE,
  CAMPOS_DE_AMBIENTE,
  ehPotenciaDeDois,
  resumoDoAmbiente,
} from '../../src/modules/uso/ambiente-do-navegador.js';
import { erroDeClienteSchema } from '../../src/modules/diag/diag.schemas.js';
import { eventosDeUsoSchema } from '../../src/modules/uso/uso.schemas.js';

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MIGRACAO = fs.readFileSync(
  path.join(RAIZ, 'src/database/migrations/014_ambiente_do_navegador.sql'), 'utf8'
);
const MODULO = fs.readFileSync(path.join(RAIZ, 'src/modules/uso/ambiente-do-navegador.js'), 'utf8');

/** The literals of the CHECK named `nome`, in order. */
function valoresDoCheck(nome, abre) {
  const bloco = MIGRACAO.match(new RegExp(`${nome} CHECK \\(\\s*${abre}([^\\])]*)[\\])]`));
  assert.ok(bloco, `the CHECK ${nome} must exist in the migration, in the expected form`);
  const literais = bloco[1].match(/'[^']+'/g);
  assert.ok(literais, 'the CHECK must enumerate values; otherwise the comparison would be empty');
  return literais.map((l) => l.slice(1, -1));
}

describe('Browser environment: the leaf and the CHECK constraints say the SAME thing', () => {
  it('the lists are exactly the expected ones, written by hand (absolute control)', () => {
    // Without this, the cases below compare two copies with each other and pass with both wrong.
    assert.deepEqual([...FAMILIAS_DE_NAVEGADOR], ['chrome', 'firefox', 'edge', 'safari', 'opera', 'outro']);
    assert.deepEqual([...FAMILIAS_DE_SO], ['windows', 'macos', 'linux', 'chromeos', 'android', 'ios', 'outro']);
    assert.deepEqual([...TIPOS_DE_DISPOSITIVO], ['desktop', 'movel', 'tablet']);
    assert.deepEqual([...VERSOES_DE_WEBGL], ['webgl2', 'webgl', 'nenhum']);
    for (const lista of [FAMILIAS_DE_NAVEGADOR, FAMILIAS_DE_SO, TIPOS_DE_DISPOSITIVO, VERSOES_DE_WEBGL,
      TETOS_DE_AMBIENTE, FORMAS_DE_AMBIENTE]) {
      assert.equal(Object.isFrozen(lista), true);
    }
  });

  it('the three CHECK constraints enumerate the leaf, in the same order', () => {
    const doDefeito = valoresDoCheck('defeitos_navegadores_check', 'navegadores <@ ARRAY\\[');
    const daSessao = valoresDoCheck('uso_sessoes_navegador_check', 'navegador IS NULL OR navegador IN \\(');
    const doSistema = valoresDoCheck('uso_sessoes_so_check', 'so IS NULL OR so IN \\(');
    assert.equal(doDefeito.length, 6, `expected six, found ${doDefeito.length}`);
    assert.deepEqual(doDefeito, [...FAMILIAS_DE_NAVEGADOR]);
    assert.deepEqual(daSessao, [...FAMILIAS_DE_NAVEGADOR]);
    assert.equal(doSistema.length, 7);
    assert.deepEqual(doSistema, [...FAMILIAS_DE_SO]);
  });

  it('the normalization UPDATE before the CHECK uses the same list (twice)', () => {
    // It runs before the constraint closes the column; a value missing there would be rewritten
    // to 'outro' in a database with data, or leave a row that makes the ADD CONSTRAINT fail.
    const lista = FAMILIAS_DE_NAVEGADOR.map((v) => `'${v}'`).join(', ');
    const vezes = MIGRACAO.split(`IN (${lista})`).length - 1;
    assert.equal(vezes, 3, 'the UPDATE (two) and the session CHECK (one) must repeat the leaf list');
  });

  it('the leaf is a LEAF: zero imports', () => {
    assert.equal(/^\s*import\s/m.test(MODULO), false, 'an import would drag config into three lists');
  });
});

describe('Browser environment: the two routes validate with the leaf', () => {
  const RELATO = { assinatura: 'x', mensagem: 'y' };

  it('the keys of `ambienteSchema` are EXACTLY `CAMPOS_DE_AMBIENTE`, in order', () => {
    // A field in the Joi and not in the list (or the reverse) is how the client and the route
    // drift apart: the frontend mirror compares the client with this list, and this case pins
    // the list to the Joi. Together, a field on one side only turns one of the two red.
    const chaves = Object.keys(erroDeClienteSchema.describe().keys.ambiente.keys);
    assert.equal(chaves.length, 26, `expected twenty-six fields, found ${chaves.length}`);
    assert.deepEqual(chaves, [...CAMPOS_DE_AMBIENTE]);
    assert.equal(Object.isFrozen(CAMPOS_DE_AMBIENTE), true);
    assert.equal(new Set(CAMPOS_DE_AMBIENTE).size, CAMPOS_DE_AMBIENTE.length, 'no repeated field');
  });

  it('the quota travels only as a power of two', () => {
    const ok = (armazenamentoCotaMb) => erroDeClienteSchema
      .validate({ ...RELATO, ambiente: { armazenamentoCotaMb } }).error === undefined;
    for (const v of [1, 256, 8192, 2 ** 29]) assert.equal(ok(v), true, `${v} must pass`);
    for (const v of [0, 6144, 3, 2.5, -8]) assert.equal(ok(v), false, `${v} must be refused`);
    assert.equal(ehPotenciaDeDois(1024), true);
    assert.equal(ehPotenciaDeDois(1000), false);
    assert.equal(ehPotenciaDeDois(null), false);
  });

  it('the report accepts every value of each vocabulary, and nothing outside it', () => {
    const casos = [
      ['navegador', FAMILIAS_DE_NAVEGADOR], ['so', FAMILIAS_DE_SO],
      ['dispositivo', TIPOS_DE_DISPOSITIVO], ['webgl', VERSOES_DE_WEBGL],
    ];
    assert.equal(casos.length, 4);
    for (const [campo, lista] of casos) {
      assert.ok(lista.length >= 3, `${campo}: a loop over an empty list would assert nothing`);
      for (const valor of lista) {
        const { error } = erroDeClienteSchema.validate({ ...RELATO, ambiente: { [campo]: valor } });
        assert.equal(error, undefined, `${campo}=${valor} must pass`);
      }
      const { error } = erroDeClienteSchema.validate({ ...RELATO, ambiente: { [campo]: 'inventado' } });
      assert.ok(error, `${campo}=inventado must be refused`);
    }
  });

  it('the limits come from the leaf: one past the ceiling is refused, the ceiling passes', () => {
    const T = TETOS_DE_AMBIENTE;
    const ok = (ambiente) => erroDeClienteSchema.validate({ ...RELATO, ambiente }).error === undefined;
    assert.equal(ok({ telaLargura: T.pixels }), true);
    assert.equal(ok({ telaLargura: T.pixels + 1 }), false);
    assert.equal(ok({ gpu: 'a'.repeat(T.gpu) }), true);
    assert.equal(ok({ gpu: 'a'.repeat(T.gpu + 1) }), false);
    assert.equal(ok({ fuso: 'America/Sao_Paulo' }), true);
    assert.equal(ok({ fuso: 'America/São_Paulo' }), false);
    assert.equal(ok({ idioma: 'pt-BR' }), true);
    assert.equal(ok({ idioma: 'português' }), false);
  });

  it('the usage batch accepts the family, the major version and the system, and only those', () => {
    const lote = { sessaoId: '5b1c1a7e-1f2b-4c3d-8e9f-0a1b2c3d4e5f', pagina: 'mapa', inicio: 1, ultimoSinal: 2, eventos: [] };
    const ok = (extra) => eventosDeUsoSchema.validate({ ...lote, ...extra }).error === undefined;
    assert.equal(ok({ navegador: 'firefox', navegadorVersao: 143, so: 'windows' }), true);
    assert.equal(ok({ navegador: 'Firefox' }), false, 'the family is lowercase, as the client sends it');
    assert.equal(ok({ navegadorVersao: TETOS_DE_AMBIENTE.versaoPrincipal + 1 }), false);
    assert.equal(ok({ so: 'windows 11' }), false);
  });
});

describe('resumoDoAmbiente: one line for the terminal, only what was declared', () => {
  it('prints the declared fields and invents nothing', () => {
    const linha = resumoDoAmbiente({
      navegador: 'firefox', navegadorVersao: '143.0', so: 'windows', soVersao: '10.0',
      dispositivo: 'desktop', toque: 0, telaLargura: 1920, telaAltura: 1080, escala: 1.25,
      idioma: 'pt-BR', fuso: 'America/Sao_Paulo', nucleos: 8, webgl: 'webgl2',
      gpu: 'Mesa Intel UHD', online: true, cookies: false,
    });
    assert.equal(linha, 'firefox 143.0 | windows 10.0 | desktop toque=0 | tela 1920x1080@1.25 | '
      + 'pt-BR America/Sao_Paulo | 8 nucleos | webgl2 "Mesa Intel UHD" | online=sim cookies=nao');
    // "Windows 11" is a READING of a Client Hints number, and it belongs to the admin tab.
    assert.equal(resumoDoAmbiente({ so: 'windows', soVersaoCh: '15.0.0' }), 'windows 15.0.0 (dicas)');
  });

  it('nothing, null and a non-object say nothing', () => {
    assert.equal(resumoDoAmbiente(null), '');
    assert.equal(resumoDoAmbiente({}), '');
    assert.equal(resumoDoAmbiente([]), '');
    assert.equal(resumoDoAmbiente('firefox'), '');
  });
});
