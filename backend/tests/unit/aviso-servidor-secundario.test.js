// Path: tests/unit/aviso-servidor-secundario.test.js
//
// THE ENV PARSE OF THE SECONDARY-SERVER NOTICE, and the wiring from env into
// `config.appConfig`. The payload half (GET /api/config carries the two keys, they survive
// the memo, an admin override wins over them) is
// `tests/integration/config-aviso-servidor-secundario.test.js`; neither half subsumes the
// other, because `config.js` reads `process.env` in the MODULE BODY and freezes the result,
// so an integration test cannot vary the environment of the app it already booted.
//
// WHY THE PARSE DESERVES ITS OWN FILE. The value decides which screen a user meets at boot,
// and it is a BOOLEAN carried by a STRING channel, which is the shape that produces silent
// wrong answers: `Boolean('false')` is `true`, and every truthy-coercion bug in this class
// looks correct on the happy path (`'true'` works) and lies on exactly one input. The
// discriminating case is therefore NOT `'true'`/`'false'`: it is a value that is neither,
// like `'sim'`, because that is the only input on which a strict parse and a truthy one
// disagree while the default still reads as "on".
//
// THE ASYMMETRY IS DELIBERATE and is pinned below: absent (and empty, which `optional()`
// already treats as absent everywhere else in `config.js`) means "nobody configured this",
// so the shipped default applies and the notice is ON; anything PRESENT is read strictly,
// because the only reason to set the variable at all is to turn the notice OFF.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveAvisoServidorSecundario } from '../../src/config.js';

let importCounter = 0;

/**
 * Imports a FRESH copy of src/config.js with `vars` applied, then restores the environment.
 * Same idiom as `tests/unit/config-defaults.test.js`: config.js reads process.env in the
 * module body, so a cache-busting query string is the only way to measure another value.
 * @param {Record<string,string|undefined>} vars - env to apply (undefined deletes the key)
 * @returns {Promise<object>} the module's default export
 */
async function importConfigWith(vars = {}) {
  const chaves = ['AVISO_SERVIDOR_SECUNDARIO', 'URL_SERVIDOR_PRINCIPAL', ...Object.keys(vars)];
  const salvo = {};
  for (const k of chaves) salvo[k] = process.env[k];
  try {
    for (const k of ['AVISO_SERVIDOR_SECUNDARIO', 'URL_SERVIDOR_PRINCIPAL']) delete process.env[k];
    for (const [k, v] of Object.entries(vars)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    const mod = await import(`../../src/config.js?aviso=${++importCounter}`);
    return mod.default;
  } finally {
    for (const [k, v] of Object.entries(salvo)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

describe('AVISO_SERVIDOR_SECUNDARIO, o parse', () => {
  it('ausente vale LIGADO: o checkout nasce anunciando o servidor secundário', () => {
    // Decisão do chefe (2026-09-03): quem não configura nada está no secundário, porque o
    // secundário é quem não precisa fazer nada. É o principal que desliga.
    assert.equal(resolveAvisoServidorSecundario(undefined), true);
  });

  it('vazio conta como ausente, e não como desligado', () => {
    // `optional()` (src/config.js) lê env vazia como não-configurada em todo o resto do
    // arquivo, e um `.env` copiado do exemplo carrega valores vazios por construção. Uma
    // regra em que `VAR=` significasse o OPOSTO do padrão só apareceria em produção.
    assert.equal(resolveAvisoServidorSecundario(''), true);
  });

  it("'true' liga e 'false' desliga", () => {
    assert.equal(resolveAvisoServidorSecundario('true'), true);
    assert.equal(resolveAvisoServidorSecundario('false'), false);
  });

  it("O CASO QUE DISCRIMINA: 'sim' vale FALSE, porque não é 'true'", () => {
    // Este é o único caso que separa um parse estrito de uma coerção por veracidade.
    // `Boolean('sim')` é `true`, e com o padrão LIGADO um parse por veracidade passaria
    // verde em todo o resto deste arquivo: 'sim' seria lido como ligado, que é o mesmo
    // resultado do padrão. Só aqui os dois discordam.
    assert.equal(resolveAvisoServidorSecundario('sim'), false);
  });

  it('nenhum outro valor liga: 1, yes, TRUE e True valem false', () => {
    // A leitura é sensível a maiúscula de propósito, como a de ALLOW_SELF_REGISTRATION:
    // um conjunto de sinônimos é um conjunto que cresce, e ele nunca cobre o próximo.
    for (const bruto of ['1', 'yes', 'TRUE', 'True', ' true', 'true ', '0', 'nao']) {
      assert.equal(
        resolveAvisoServidorSecundario(bruto), false,
        `'${bruto}' não é o literal 'true' e não pode ligar o aviso`,
      );
    }
  });
});

describe('AVISO_SERVIDOR_SECUNDARIO, a fiação até config.appConfig', () => {
  // O parse acima é uma função pura, e uma função pura correta que ninguém chamou não
  // configura nada. Estes casos provam que o valor do ambiente ATRAVESSA até a chave que o
  // payload de /api/config lê.

  it('sem env, config.appConfig traz o padrão ligado e a URL do 7 CTA', async () => {
    const cfg = await importConfigWith();
    assert.equal(cfg.appConfig.avisoServidorSecundario, true);
    assert.equal(cfg.appConfig.urlServidorPrincipal, 'https://ebgeo.dsg.eb.mil.br');
  });

  it("AVISO_SERVIDOR_SECUNDARIO='false' desliga a chave servida", async () => {
    const cfg = await importConfigWith({ AVISO_SERVIDOR_SECUNDARIO: 'false' });
    assert.equal(cfg.appConfig.avisoServidorSecundario, false);
  });

  it("AVISO_SERVIDOR_SECUNDARIO='sim' também desliga (a coerção não acontece aqui)", async () => {
    const cfg = await importConfigWith({ AVISO_SERVIDOR_SECUNDARIO: 'sim' });
    assert.equal(
      cfg.appConfig.avisoServidorSecundario, false,
      'a chave servida é o resultado do parse estrito, não do valor cru',
    );
  });

  it('URL_SERVIDOR_PRINCIPAL substitui o destino do botão', async () => {
    const cfg = await importConfigWith({ URL_SERVIDOR_PRINCIPAL: 'https://ebgeo.exemplo.mil.br' });
    assert.equal(cfg.appConfig.urlServidorPrincipal, 'https://ebgeo.exemplo.mil.br');
  });

  it('a chave servida é BOOLEANA, nunca a string do ambiente', async () => {
    // O cliente decide a tela por `=== true` (é o contrato herdado do `main`), então uma
    // string 'true' no payload manteria o aviso DESLIGADO no servidor secundário, que é o
    // pior desfecho possível desta chave.
    const cfg = await importConfigWith({ AVISO_SERVIDOR_SECUNDARIO: 'true' });
    assert.equal(typeof cfg.appConfig.avisoServidorSecundario, 'boolean');
    assert.equal(cfg.appConfig.avisoServidorSecundario, true);
  });
});
