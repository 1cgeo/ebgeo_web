// Path: tests/unit/sv360-capture-date-fuso.test.js
// The capture instant of a 360 photo must carry its own zone, at BOTH doors.
//
// sv360.photos.capture_date is TIMESTAMPTZ, i.e. an INSTANT. A zoneless ISO
// string is not one: `new Date('2025-03-17T09:58:14')` resolves it in the Node
// process TZ (which is what Joi's `isoDate()` coercion used to do here), and a
// bare string handed to TIMESTAMPTZ resolves it in the Postgres session TimeZone.
// Either way the SAME bundle produces a DIFFERENT instant depending on the host,
// with no error on any host — the silent drift `scripts/sv360-survey-clock.js`
// was written to keep out of the ETL, and the failure ebgeo_360 e2fb591 had to
// chase through a solar fit.
//
// What each assertion here would catch if the guard were reverted to
// `Joi.string().isoDate()`:
//   - the "rejects" cases would all PASS validation (the defect itself);
//   - the "verbatim" cases would come back rewritten to `...Z` by a `new Date()`
//     round trip, i.e. an instant computed with an ambient zone.
//
// Pure logic: no Postgres, no filesystem, no HTTP.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { validateManifest } from '../../src/modules/streetview360/sv360.ingest.js';
import { captureInstantOrNull } from '../../src/modules/streetview360/sv360.merge.js';
import { ValidationError } from '../../src/utils/errors.js';

const P1 = '2b1e6b4e-5f8a-5c3d-9a1b-0f2e3d4c5b6a';
const P2 = '3c2f7c5f-6a9b-5d4e-8b2c-1a3f4e5d6c7b';

function photo(id, seq, over = {}) {
  return {
    id,
    original_name: `${seq}.jpg`,
    sequence_number: seq,
    lat: -30.03,
    lon: -51.23,
    full_size_bytes: 1000,
    preview_size_bytes: 100,
    ...over,
  };
}

function manifestWith(captureDate) {
  return {
    project: { slug: 'proj-teste', name: 'Projeto Teste' },
    photos: [photo(P1, 1, { capture_date: captureDate }), photo(P2, 2)],
  };
}

// The one instant every case in this file is about: 09:58:14 local in a UTC-3
// survey == 12:58:14Z. Hard-coded so an assertion cannot agree with the code by
// recomputing it the same wrong way.
const EPOCH = Date.UTC(2025, 2, 17, 12, 58, 14);

describe('sv360 capture_date — a porta do manifesto exige fuso explícito', () => {
  it('aceita offset explícito e guarda a string VERBATIM (sem passar por new Date)', () => {
    const ok = validateManifest(manifestWith('2025-03-17T09:58:14-03:00'));
    assert.equal(ok.photos[0].capture_date, '2025-03-17T09:58:14-03:00');
    assert.equal(Date.parse(ok.photos[0].capture_date), EPOCH);
  });

  it('aceita a forma Z e também a guarda verbatim', () => {
    const ok = validateManifest(manifestWith('2025-03-17T12:58:14Z'));
    assert.equal(ok.photos[0].capture_date, '2025-03-17T12:58:14Z');
    assert.equal(Date.parse(ok.photos[0].capture_date), EPOCH);
  });

  it('aceita offset sem os dois-pontos, com fração e sem segundos', () => {
    // Todas são ISO 8601 com fuso; recusá-las rejeitaria bundle correto.
    for (const v of ['2025-03-17T09:58:14-0300', '2025-03-17T12:58:14.123Z', '2025-03-17T12:58Z']) {
      const ok = validateManifest(manifestWith(v));
      assert.equal(ok.photos[0].capture_date, v, `deveria aceitar ${v}`);
    }
  });

  it('aceita ausência e null — foto sem hora conhecida é o caso normal do corpus', () => {
    const semCampo = validateManifest(manifestWith(undefined));
    assert.equal(semCampo.photos[0].capture_date, undefined);
    const nulo = validateManifest(manifestWith(null));
    assert.equal(nulo.photos[0].capture_date, null);
  });

  it('rejeita ISO ingênuo com 422 dizendo que falta o fuso e mostrando o formato', () => {
    assert.throws(
      () => validateManifest(manifestWith('2025-03-17T09:58:14')),
      (err) => {
        assert.ok(err instanceof ValidationError, 'é bundle malformado: 422, não 500 do Postgres');
        assert.equal(err.statusCode, 422);
        assert.match(err.message, /sem fuso horário/);
        assert.match(err.message, /2025-03-17T09:58:14-03:00/);
        assert.match(err.message, /capture_date/);
        return true;
      }
    );
  });

  it('rejeita data pura (sem hora e sem fuso), que o new Date leria como meia-noite UTC', () => {
    assert.throws(() => validateManifest(manifestWith('2025-03-17')), /sem fuso horário/);
  });

  it('rejeita string irreconhecível pela mensagem de FORMATO, não pela de fuso', () => {
    // Diagnóstico errado manda o operador procurar o defeito no lugar errado.
    assert.throws(
      () => validateManifest(manifestWith('17/03/2025 09:58')),
      (err) => {
        assert.match(err.message, /formato não reconhecido/);
        assert.doesNotMatch(err.message, /sem fuso horário/);
        return true;
      }
    );
  });

  it('rejeita data impossível mesmo com fuso: o regex sozinho aceitaria mês 13', () => {
    assert.throws(() => validateManifest(manifestWith('2025-13-45T09:58:14Z')), ValidationError);
  });
});

describe('sv360 captureInstantOrNull — o último guarda, antes do TIMESTAMPTZ', () => {
  // mergeProject também é chamado pelo ETL (scripts/sv360-import.js), que NUNCA
  // passa pelo Joi: sem esta cópia da regra, o CLI escreveria o valor ingênuo.
  it('devolve verbatim o que tem fuso, e null para ausente/null/vazio', () => {
    assert.equal(captureInstantOrNull('2025-03-17T09:58:14-03:00', P1), '2025-03-17T09:58:14-03:00');
    assert.equal(captureInstantOrNull(undefined, P1), null);
    assert.equal(captureInstantOrNull(null, P1), null);
    assert.equal(captureInstantOrNull('   ', P1), null);
  });

  it('lança 422 nomeando a foto quando o instante não tem fuso', () => {
    assert.throws(
      () => captureInstantOrNull('2025-03-17T09:58:14', P1),
      (err) => {
        assert.ok(err instanceof ValidationError);
        assert.equal(err.statusCode, 422);
        assert.match(err.message, /sem fuso horário/);
        assert.ok(err.message.includes(P1), 'a mensagem precisa dizer QUAL foto');
        return true;
      }
    );
  });

  it('lança pela mensagem de formato quando o valor nem ISO é (inclusive não-string)', () => {
    assert.throws(() => captureInstantOrNull(1742212694, P1), /formato não reconhecido/);
    assert.throws(() => captureInstantOrNull('ontem de manhã', P1), /formato não reconhecido/);
  });
});

describe('sv360 capture_date — o mesmo manifesto em dois fusos de processo', () => {
  // O defeito original só aparece comparando DUAS máquinas, então a prova roda em
  // dois processos filhos com TZ diferente. Uma execução só é indistinguível do
  // caso em que o fuso do host por acaso era o certo.
  const raiz = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');
  const modulo = pathToFileURL(path.join(raiz, 'src/modules/streetview360/sv360.ingest.js')).href;

  function rodarSobTZ(tz, valor) {
    const code = `
      import { validateManifest } from ${JSON.stringify(modulo)};
      const m = ${JSON.stringify(manifestWith('__VALOR__')).replace('"__VALOR__"', JSON.stringify(valor))};
      try {
        const ok = validateManifest(m);
        console.log(JSON.stringify({ aceito: true, valor: ok.photos[0].capture_date }));
      } catch (e) {
        console.log(JSON.stringify({ aceito: false, msg: e.message }));
      }
    `;
    const out = execFileSync(process.execPath, ['--input-type=module', '-e', code], {
      env: { ...process.env, TZ: tz },
      encoding: 'utf8',
      cwd: raiz,
    });
    return JSON.parse(out.trim().split('\n').pop());
  }

  it('o valor com fuso produz o MESMO instante em UTC e em UTC+14', () => {
    const a = rodarSobTZ('UTC', '2025-03-17T09:58:14-03:00');
    const b = rodarSobTZ('Pacific/Kiritimati', '2025-03-17T09:58:14-03:00');
    assert.equal(a.aceito, true);
    assert.equal(b.aceito, true);
    assert.equal(a.valor, b.valor);
    assert.equal(Date.parse(a.valor), EPOCH);
    assert.equal(Date.parse(b.valor), EPOCH);
  });

  it('o valor sem fuso é recusado nos dois fusos, em vez de virar dois instantes', () => {
    const a = rodarSobTZ('UTC', '2025-03-17T09:58:14');
    const b = rodarSobTZ('Pacific/Kiritimati', '2025-03-17T09:58:14');
    assert.equal(a.aceito, false, 'aceito sob TZ=UTC');
    assert.equal(b.aceito, false, 'aceito sob TZ=Pacific/Kiritimati');
    assert.match(a.msg, /sem fuso horário/);
    assert.match(b.msg, /sem fuso horário/);
  });
});
