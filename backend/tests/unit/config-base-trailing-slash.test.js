// Path: tests/unit/config-base-trailing-slash.test.js
//
// A BARRA FINAL DE UMA BASE, E POR QUE ELA SÓ APARECE DEPOIS DO DEPLOY.
//
// Todo consumidor destas duas bases concatena um caminho que JÁ começa com `/`:
// o cliente do 360 monta `${serviceUrl}/photos/${id}/...` (frontend
// `street_view_tool/streetview-api.service.js`) e o backend monta
// `${sv360ServiceUrl}/tiles/{z}/{x}/{y}.pbf` (config.service.js). Uma base
// digitada com barra no fim produz `//`, e servidor nenhum concorda sobre o que
// fazer com isso: uns servem, outros respondem 404. O defeito nasce em quem
// DIGITA a variável de ambiente, nunca em quem escreve o código, então ele
// atravessa a suíte inteira e aparece só no deploy, na rota que o operador não
// abriu enquanto testava.
//
// O monorepo tem DUAS portas de entrada para esse valor, e cobrir só uma é
// cobertura vazia:
//   1. a variável de ambiente (`SV360_SERVICE_URL`, `ASSETS_3D_BASE_URL`),
//      limpa por `optionalBase` em `src/config.js`;
//   2. o override "Avançado (JSON)" do Painel do Administrador, que aceita
//      `streetView360` como objeto livre (`config.admin.schemas.js`) e VENCE o
//      valor da env no `deepMerge`. Limpá-lo exige normalizar DEPOIS do merge.
// Este arquivo cobre a porta 1. A porta 2 é exercida em
// `tests/integration/config-admin.test.js`.
//
// O precedente no outro pacote é `normalizeBase`
// (frontend/src/js/first_person_3d_tool/scene-config.service.js), que existe
// pela mesma razão e cujo comentário ainda cita o símbolo antigo do monolito.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

let importCounter = 0;

/**
 * Imports a FRESH copy of src/config.js with `vars` applied to the env.
 * @param {Record<string,string|undefined>} vars
 * @returns {Promise<object>} the module's default export
 */
async function importConfigWith(vars = {}) {
  const saved = {};
  for (const k of Object.keys(vars)) saved[k] = process.env[k];
  try {
    for (const [k, v] of Object.entries(vars)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    const mod = await import(`../../src/config.js?basetrail=${++importCounter}`);
    return mod.default;
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

// Cada base, com a env var que a alimenta e o caminho até o valor no config.
const BASES = Object.freeze([
  { env: 'SV360_SERVICE_URL', read: (c) => c.appConfig.sv360ServiceUrl, limpo: '/api/v1/sv360' },
  { env: 'ASSETS_3D_BASE_URL', read: (c) => c.assets3d.baseUrl, limpo: '/api/v1/assets3d' },
]);

describe('base de serviço: barra final', () => {
  // As duas bases precisam estar na varredura: um BASES vazio faria o laço abaixo
  // não asserir nada e o arquivo passaria verde sem verificar uma linha.
  assert.equal(BASES.length, 2, 'as duas bases de serviço precisam estar cobertas');

  for (const base of BASES) {
    it(`${base.env}: uma barra no fim é removida`, async () => {
      const cfg = await importConfigWith({ [base.env]: `${base.limpo}/` });
      assert.equal(base.read(cfg), base.limpo);
    });

    it(`${base.env}: barras repetidas no fim são removidas`, async () => {
      const cfg = await importConfigWith({ [base.env]: `${base.limpo}///` });
      assert.equal(base.read(cfg), base.limpo);
    });

    it(`${base.env}: base absoluta de outra origem também é limpa`, async () => {
      const cfg = await importConfigWith({ [base.env]: 'https://sv360.example.mil.br/api/' });
      assert.equal(base.read(cfg), 'https://sv360.example.mil.br/api');
    });

    it(`${base.env}: valor já limpo passa intacto`, async () => {
      const cfg = await importConfigWith({ [base.env]: base.limpo });
      assert.equal(base.read(cfg), base.limpo);
    });

    it(`${base.env}: o default embutido não tem barra final`, async () => {
      const cfg = await importConfigWith({ [base.env]: undefined });
      assert.equal(base.read(cfg), base.limpo);
    });

    // A barra INTERNA não é o alvo: só a final some. Sem esta asserção, uma
    // implementação que apagasse toda barra passaria nas de cima.
    it(`${base.env}: barras internas do caminho sobrevivem`, async () => {
      const cfg = await importConfigWith({ [base.env]: '/api/v1/sv360/interno/' });
      assert.equal(base.read(cfg), '/api/v1/sv360/interno');
    });
  }

  // O ponto do exercício: a concatenação que o consumidor real faz. Sem esta
  // asserção o teste mede uma string e não o defeito que motivou o arquivo.
  it('a URL concatenada não carrega barra dupla', async () => {
    const cfg = await importConfigWith({ SV360_SERVICE_URL: '/api/v1/sv360/' });
    const url = `${cfg.appConfig.sv360ServiceUrl}/photos/abc/tiles.json`;
    assert.equal(url, '/api/v1/sv360/photos/abc/tiles.json');
    assert.ok(!url.includes('//'), `barra dupla em ${url}`);
  });
});
