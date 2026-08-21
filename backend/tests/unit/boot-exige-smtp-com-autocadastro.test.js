// Path: tests/unit/boot-exige-smtp-com-autocadastro.test.js
//
// EM PRODUÇÃO COM AUTO-CADASTRO LIGADO, SUBIR SEM RELAY É ERRO DE CONFIGURAÇÃO.
//
// PISO, medido no código anterior a esta mudança: `validateEnvVariables()` com
// `NODE_ENV=production`, `DATABASE_URL`, `JWT_SECRET` de 32+, `CORS_ORIGIN` canônica e
// SEM `SMTP_HOST` NÃO lançava nada. Subia, e depois criava contas que ninguém conseguia
// ativar — `deliver()` degrada para `logger.error`, silenciosamente. Verificação
// obrigatória sem canal de entrega é exatamente a classe "checagem que não checa": o
// cadastro responde 201, o usuário espera um e-mail que não existe, e nada em lugar
// nenhum fica vermelho.
//
// AS TRÊS DISCRIMINAÇÕES, e são elas que impedem o conserto de virar um estrago:
//   1. `ALLOW_SELF_REGISTRATION=false` no mesmo cenário de produção NÃO lança. Sem isso
//      toda instalação fechada que nunca precisou de relay pararia de bootar.
//   2. `NODE_ENV=development` sem SMTP NÃO lança. É o modo em que o mailer loga o link
//      de propósito, e é o modo em que a suíte inteira roda: se este caso ficasse
//      vermelho, o `npm test` inteiro pararia de bootar.
//   3. Um erro que já existia (`CORS_ORIGIN` ausente em produção) continua sendo
//      reportado no MESMO array. Prova que os erros novos foram ACRESCENTADOS ao
//      acumulador, e não que ele foi curto-circuitado por um return prematuro.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateEnvVariables } from '../../src/config.js';

const CHAVES = [
  'NODE_ENV', 'DATABASE_URL', 'JWT_SECRET', 'CORS_ORIGIN',
  'ALLOW_SELF_REGISTRATION', 'SMTP_HOST', 'APP_BASE_URL',
];

/** Um cenário de produção completo, ao qual cada caso remove ou acrescenta uma peça. */
const PRODUCAO_OK = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://u:p@localhost:5432/x',
  JWT_SECRET: 'a'.repeat(48),
  CORS_ORIGIN: 'https://ebgeo.example.mil',
  ALLOW_SELF_REGISTRATION: 'true',
  SMTP_HOST: 'smtp.example.mil',
  APP_BASE_URL: 'https://ebgeo.example.mil',
};

/**
 * Runs `validateEnvVariables()` under an env built from PRODUCAO_OK plus `over`, where a
 * value of `undefined` DELETES the variable. Restores everything afterwards.
 * @param {Object} over
 * @returns {Error|null} The thrown error, or null when it validated clean.
 */
function validarCom(over) {
  const salvos = Object.fromEntries(CHAVES.map((k) => [k, process.env[k]]));
  const alvo = { ...PRODUCAO_OK, ...over };
  try {
    for (const k of CHAVES) {
      if (alvo[k] === undefined) delete process.env[k];
      else process.env[k] = alvo[k];
    }
    validateEnvVariables();
    return null;
  } catch (err) {
    return err;
  } finally {
    for (const k of CHAVES) {
      if (salvos[k] === undefined) delete process.env[k];
      else process.env[k] = salvos[k];
    }
  }
}

describe('boot — auto-cadastro em produção exige canal de entrega', () => {
  it('guarda: o cenário de produção COMPLETO valida limpo', () => {
    // Sem esta linha, todo `assert.ok(err)` abaixo passaria idêntico se o cenário base
    // estivesse quebrado por outro motivo qualquer.
    assert.equal(validarCom({}), null, 'o cenário base não pode ter erro nenhum');
  });

  it('produção + auto-cadastro + SEM SMTP_HOST → lança, nomeando SMTP_HOST', () => {
    const err = validarCom({ SMTP_HOST: undefined });
    assert.ok(err, 'tem de lançar');
    assert.match(err.message, /SMTP_HOST/);
    assert.doesNotMatch(err.message, /APP_BASE_URL/, 'e só sobre o que falta');
  });

  it('produção + auto-cadastro + SEM APP_BASE_URL → lança, nomeando APP_BASE_URL', () => {
    const err = validarCom({ APP_BASE_URL: undefined });
    assert.ok(err, 'tem de lançar');
    assert.match(err.message, /APP_BASE_URL/);
    assert.doesNotMatch(err.message, /SMTP_HOST/);
  });

  it('faltando os DOIS, a mensagem ÚNICA traz os dois (o acumulador não para no primeiro)', () => {
    const err = validarCom({ SMTP_HOST: undefined, APP_BASE_URL: undefined });
    assert.ok(err);
    assert.match(err.message, /SMTP_HOST/);
    assert.match(err.message, /APP_BASE_URL/);
  });

  it('DISCRIMINAÇÃO 1 — com o auto-cadastro DESLIGADO, o mesmo cenário sobe', () => {
    assert.equal(
      validarCom({ ALLOW_SELF_REGISTRATION: 'false', SMTP_HOST: undefined, APP_BASE_URL: undefined }),
      null,
      'a exigência é condicional: rede fechada sem relay não pode parar de bootar'
    );
  });

  it('DISCRIMINAÇÃO 2 — fora de produção, sem SMTP e com auto-cadastro ligado, sobe', () => {
    // É o modo da suíte inteira. Um vermelho aqui derrubaria todo o resto.
    assert.equal(
      validarCom({
        NODE_ENV: 'development', SMTP_HOST: undefined, APP_BASE_URL: undefined,
        CORS_ORIGIN: undefined, JWT_SECRET: 'curto',
      }),
      null,
      'nada disso é exigido fora de produção'
    );
  });

  it('DISCRIMINAÇÃO 3 — um erro PRÉ-EXISTENTE continua no mesmo array', () => {
    // `CORS_ORIGIN` ausente em produção já era erro antes desta mudança. Se ele sumir da
    // mensagem, os erros novos foram postos num caminho que curto-circuita o acumulador.
    const err = validarCom({ CORS_ORIGIN: undefined, SMTP_HOST: undefined });
    assert.ok(err);
    assert.match(err.message, /CORS_ORIGIN/);
    assert.match(err.message, /SMTP_HOST/);
  });

  it('DISCRIMINAÇÃO 4 — override irreconhecível cai no default de produção, que é DESLIGADO', () => {
    // A exigência segue `resolveAllowSelfRegistration`, não uma leitura solta da env. Com
    // um override que o parser não reconhece, produção cai no default (desligado) e nada
    // é exigido — o que também prende, de graça, o fato de esta onda NÃO ter invertido o
    // default (a inversão é decisão de implantação, à parte).
    assert.equal(
      validarCom({ ALLOW_SELF_REGISTRATION: 'lixo', SMTP_HOST: undefined, APP_BASE_URL: undefined }),
      null,
      'produção sem override reconhecível continua com o auto-cadastro fechado'
    );
    assert.equal(
      validarCom({ ALLOW_SELF_REGISTRATION: undefined, SMTP_HOST: undefined, APP_BASE_URL: undefined }),
      null,
      'e sem override nenhum, idem'
    );
  });
});
