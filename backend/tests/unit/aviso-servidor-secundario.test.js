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
// looks correct on the happy path (`'true'` works) and lies on the inputs nobody types in a
// test. Two cases discriminate a strict parse from a coerced one, and both are pinned below:
// `'false'`, which a coerced parse would read as ON in the deployment that wrote it to stay
// dark, and `'sim'`, which is neither literal and must not light anything.
//
// THE DEFAULT IS OFF SINCE 2026-09-04, inverting the decision of the day before. The old
// default (ON) obliged every deployment and every developer checkout to turn the notice off,
// and both e2e harnesses spawned the backend with the variable set to 'false' for no other
// reason. Now a checkout is silent, this variable is the door for an install with nobody to
// click, and the ADMINISTRATOR is the one who lights the notice, from the "Sistema" tab of the
// admin panel: the override document wins over this value on the merge, without a restart.
// That override half is measured in the integration file; here only the env parse lives.

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
  it('ausente vale DESLIGADO: o checkout nasce calado', () => {
    // Decisão do chefe (2026-09-04), que inverte a da véspera: quem não configura nada não
    // tem tela nenhuma. Quem quer o aviso pede por ele, pela variável ou pela aba Sistema.
    assert.equal(resolveAvisoServidorSecundario(undefined), false);
  });

  it('vazio vale o mesmo que ausente, que é desligado', () => {
    // `optional()` (src/config.js) lê env vazia como não-configurada em todo o resto do
    // arquivo, e um `.env` copiado do exemplo carrega valores vazios por construção. Com o
    // padrão desligado os dois caem na mesma resposta, e a assimetria que a versão anterior
    // desta regra precisava explicar deixou de existir.
    assert.equal(resolveAvisoServidorSecundario(''), false);
  });

  it("'true' liga e 'false' desliga", () => {
    assert.equal(resolveAvisoServidorSecundario('true'), true);
    assert.equal(resolveAvisoServidorSecundario('false'), false);
  });

  it("O CASO QUE DISCRIMINA: 'false' vale FALSE, e não o `true` da coerção", () => {
    // `Boolean('false')` é `true`. Com o padrão DESLIGADO, uma coerção por veracidade
    // acenderia a tela justamente na implantação que escreveu `false` para mantê-la apagada,
    // que é o pior desfecho desta chave. É o caso que separa o parse estrito do coerente.
    assert.equal(resolveAvisoServidorSecundario('false'), false);
  });

  it("O SEGUNDO QUE DISCRIMINA: 'sim' vale FALSE, porque não é 'true'", () => {
    // O irmão do de cima pelo outro lado: um valor que não é nenhum dos dois literais.
    // `Boolean('sim')` é `true`, e o parse estrito diz não.
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

  it('sem env, config.appConfig traz o padrão desligado e a URL do 7 CTA', async () => {
    // A URL continua com default mesmo com o aviso apagado, e é de propósito: ela é o
    // destino que o administrador não precisa digitar quando ligar a tela pelo painel.
    const cfg = await importConfigWith();
    assert.equal(cfg.appConfig.avisoServidorSecundario, false);
    assert.equal(cfg.appConfig.urlServidorPrincipal, 'https://ebgeo.dsg.eb.mil.br');
  });

  it("AVISO_SERVIDOR_SECUNDARIO='true' liga a chave servida", async () => {
    // O caminho da implantação SEM administrador para clicar: a variável continua sendo a
    // porta, só deixou de ser a porta que já vem aberta.
    const cfg = await importConfigWith({ AVISO_SERVIDOR_SECUNDARIO: 'true' });
    assert.equal(cfg.appConfig.avisoServidorSecundario, true);
  });

  it("AVISO_SERVIDOR_SECUNDARIO='false' mantém a chave servida desligada", async () => {
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
