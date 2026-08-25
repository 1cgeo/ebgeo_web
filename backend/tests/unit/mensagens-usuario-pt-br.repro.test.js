// Path: tests/unit/mensagens-usuario-pt-br.repro.test.js
//
// REPRODUÇÃO: as TABELAS de mensagem do backend escreviam em inglês, e o texto
// chegava inteiro à tela. O gatilho foi o 409 de chave duplicada, que o usuário
// lia como 'Resource already exists'.
//
// Este arquivo prende só as TABELAS e os TRADUTORES de erro, nunca os 146 textos
// escritos caso a caso nos serviços. A fronteira é deliberada: a tabela é a fonte
// única que serve todo `throw` sem argumento, então traduzi-la move o produto
// inteiro com quatro arquivos.
//
// O QUE ESTE ARQUIVO NÃO MEDE: `logger.*`, `console.*`, comentário e JSDoc. Pela
// regra da casa (CLAUDE.md, "Idioma"), esses três continuam em inglês de
// propósito, porque são a superfície de quem depura, não de quem usa.
//
// Cada caso afirma o TEXTO EXATO. Um caso que só perguntasse "tem acento?" passaria
// verde com a frase errada, e a frase é o produto aqui.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { errorHandler } from '../../src/middleware/error-handler.js';
import { sv360ErrorHandler } from '../../src/modules/streetview360/sv360-error.js';
import { safeErrorMessage } from '../../src/utils/safe-error-message.js';
import {
  ForbiddenError,
  UnauthorizedError,
  ConflictError,
  ValidationError,
  BadRequestError,
  ServiceUnavailableError,
} from '../../src/utils/errors.js';

function mockReq() {
  return { method: 'GET', url: '/test', user: { id: 'u1' } };
}

function mockRes() {
  let _status = null;
  let _json = null;
  return {
    status(code) { _status = code; return this; },
    json(body) { _json = body; return this; },
    get statusCode() { return _status; },
    get body() { return _json; },
  };
}

/** Erro no formato que o pg-promise entrega: SQLSTATE em `code`, texto do driver. */
function pgError(code, message = 'driver text') {
  const err = new Error(message);
  err.code = code;
  return err;
}

/**
 * O texto que as DUAS tabelas de SQLSTATE devem produzir. A igualdade entre elas é
 * contrato declarado no cabeçalho de `safe-error-message.js` ("Same failure, same
 * words"): a mesma falha de banco não pode ter uma frase no REST e outra no
 * WebSocket. Até hoje nada reprovava a divergência.
 */
const TEXTO_POR_SQLSTATE = Object.freeze({
  '22003': 'Valor numérico fora do intervalo permitido.',
  '22P02': 'Valor mal formado (identificador ou tipo inválido).',
  '23502': 'Preencha todos os campos obrigatórios.',
  '23503': 'O registro referenciado não existe ou ainda está em uso.',
  '23505': 'Já existe um registro com esses dados. Altere e tente de novo.',
  '23514': 'Um valor não atende a uma regra do sistema.',
});

describe('mensagens de usuário em pt-BR — as tabelas e os tradutores de erro', () => {
  it('os padrões da família AppError falam português', () => {
    assert.equal(new ForbiddenError().message, 'Você não tem permissão para esta ação.');
    assert.equal(new UnauthorizedError().message, 'Faça login para continuar.');
    assert.equal(
      new ConflictError().message,
      'Conflito com o estado atual. Recarregue a página e tente de novo.'
    );
    assert.equal(new ValidationError().message, 'Falha na validação');
    assert.equal(new BadRequestError().message, 'Requisição inválida.');
    assert.equal(
      new ServiceUnavailableError().message,
      'Serviço temporariamente indisponível. Tente novamente em instantes.'
    );
  });

  it('o padrão do 422 é a MESMA constante que o ramo Joi do errorHandler já usava', () => {
    // O ramo `err.isJoi` (error-handler.js) escreve 'Falha na validação' desde a
    // tradução das mensagens de campo. O padrão de `ValidationError` ficou para trás
    // em inglês, então a mesma tela dizia uma coisa ou outra conforme o caminho.
    const res = mockRes();
    errorHandler({ isJoi: true, details: [] }, mockReq(), res, () => {});
    assert.equal(res.body.error.message, new ValidationError().message);
  });

  it('o errorHandler traduz cada SQLSTATE que o usuário pode provocar', () => {
    assert.equal(Object.entries(TEXTO_POR_SQLSTATE).length, 6, 'tabela vazia = verde vazio');
    for (const [sqlstate, esperado] of Object.entries(TEXTO_POR_SQLSTATE)) {
      const res = mockRes();
      errorHandler(pgError(sqlstate), mockReq(), res, () => {});
      assert.equal(res.body.error.message, esperado, `SQLSTATE ${sqlstate}`);
    }
  });

  it('o safeErrorMessage (WebSocket e failed[]) usa as MESMAS palavras do errorHandler', () => {
    assert.equal(Object.entries(TEXTO_POR_SQLSTATE).length, 6, 'tabela vazia = verde vazio');
    for (const [sqlstate, esperado] of Object.entries(TEXTO_POR_SQLSTATE)) {
      assert.equal(safeErrorMessage(pgError(sqlstate)), esperado, `SQLSTATE ${sqlstate}`);
    }
    // 22001 só existe no caminho 360/imagens, então não tem par no errorHandler.
    assert.equal(safeErrorMessage(pgError('22001')), 'Valor longo demais para o campo.');
  });

  it('os fallbacks genéricos falam português', () => {
    assert.equal(safeErrorMessage(new Error('boom')), 'A operação falhou.');

    // 500 desconhecido, com `config.isDev` falso sob NODE_ENV=test.
    const res500 = mockRes();
    errorHandler(new Error('secret internal failure'), mockReq(), res500, () => {});
    assert.equal(res500.body.error.message, 'Algo deu errado. Tente novamente.');

    // 4xx de terceiro sem `expose`: mascarado, e agora em português.
    const res403 = mockRes();
    errorHandler(Object.assign(new Error('/var/secret'), { statusCode: 403 }), mockReq(), res403, () => {});
    assert.equal(res403.body.error.message, 'Requisição inválida.');
  });

  it('o tradutor do 360 (envelope plano) fala português nas mesmas falhas', () => {
    const joi = mockRes();
    sv360ErrorHandler({ isJoi: true, details: [] }, mockReq(), joi, () => {});
    assert.equal(joi.body.error, 'Falha na validação');

    const dup = mockRes();
    sv360ErrorHandler(pgError('23505'), mockReq(), dup, () => {});
    assert.equal(dup.body.error, TEXTO_POR_SQLSTATE['23505']);

    const fk = mockRes();
    sv360ErrorHandler(pgError('23503'), mockReq(), fk, () => {});
    assert.equal(fk.body.error, TEXTO_POR_SQLSTATE['23503']);

    const boom = mockRes();
    sv360ErrorHandler(new Error('stack interno'), mockReq(), boom, () => {});
    assert.equal(boom.body.error, 'Erro interno do servidor.');
  });

  it('traduzir não pode revelar constraint, coluna nem caminho de servidor', () => {
    // A razão de ser de `safe-error-message.js`. Uma tradução que passasse a
    // encaminhar `err.message` ficaria em português E vazaria o texto do driver.
    const cru = 'duplicate key value violates unique constraint "images_pkey"';
    const saida = safeErrorMessage(pgError('23505', cru));
    assert.doesNotMatch(saida, /pkey|constraint|violates|duplicate/i);

    const fs = Object.assign(new Error("EACCES: open 'C:\\srv\\ebgeo\\uploads\\a.png'"), { code: 'EACCES' });
    const saidaFs = safeErrorMessage(fs);
    assert.doesNotMatch(saidaFs, /[/\\]/, 'nenhum separador de caminho');
    assert.doesNotMatch(saidaFs, /uploads|EACCES/i);
  });

  it('o campo `code` NÃO é traduzido: é identificador de máquina', () => {
    // Traduzir `code` quebraria todo cliente que ramifica por ele. O contrato é
    // "só `message` é humano", e este caso é o que reprova quem esquecer.
    const res = mockRes();
    errorHandler(pgError('23505'), mockReq(), res, () => {});
    assert.equal(res.body.error.code, 'CONFLICT');

    assert.equal(new UnauthorizedError().code, 'UNAUTHORIZED');
    assert.equal(new ValidationError().code, 'VALIDATION_ERROR');
    assert.equal(new BadRequestError().code, 'BAD_REQUEST');
    assert.equal(new ForbiddenError().code, 'FORBIDDEN');
    assert.equal(new ConflictError().code, 'CONFLICT');
    assert.equal(new ServiceUnavailableError().code, 'SERVICE_UNAVAILABLE');
  });

  // -------------------------------------------------------------------------
  // Guarda mecânico. Sem ele, a próxima entrada de tabela nasce em inglês e nada
  // reclama. Lê o FONTE dos quatro arquivos e reprova palavra-marcador inglesa
  // dentro de literal de string, ignorando comentário (que a casa manda manter
  // em inglês) e ignorando `code`/SQLSTATE.
  // -------------------------------------------------------------------------
  const ARQUIVOS_DE_TABELA = [
    '../../src/utils/errors.js',
    '../../src/utils/safe-error-message.js',
    '../../src/middleware/error-handler.js',
    '../../src/modules/streetview360/sv360-error.js',
    // `auth.js` ENTROU EM 2026-08-25, e o motivo e a licao mais cara desta varredura: traduzir
    // a TABELA nao traduz quem passa o texto como ARGUMENTO EXPLICITO, porque o argumento vence
    // o padrao. Tres irmaos ja tinham sido pegos assim; este escapou, e ele e o mais atingido do
    // produto inteiro. Medido no servidor vivo: `GET /atlas` sem token respondia "Missing or
    // invalid authorization header" DEPOIS de a tabela estar em portugues.
    //
    // O guarda so cobre a tabela enquanto ninguem sobrescreve o padrao. Todo arquivo que
    // constroi `AppError` com frase propria precisa entrar nesta lista, ou a cobertura vira
    // teatro.
    '../../src/middleware/auth.js',
  ];

  /** Remove comentário de linha e de bloco, para não medir a prosa do desenvolvedor. */
  function semComentarios(fonte) {
    return fonte.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
  }

  /** Literais de string de uma linha, aspas simples ou duplas. */
  function literais(fonte) {
    return [...fonte.matchAll(/'([^'\\\n]*(?:\\.[^'\\\n]*)*)'|"([^"\\\n]*(?:\\.[^"\\\n]*)*)"/g)]
      .map((m) => m[1] ?? m[2])
      .filter(Boolean);
  }

  // Marcadores que não existem em português e não aparecem em identificador do
  // domínio. Lista curta de propósito: pega frase, não pega nome técnico.
  const MARCADOR_INGLES = /\b(not found|already exists|failed|required|invalid|too long|out of range|violates|went wrong|unavailable|permissions|denied|missing|unknown error)\b/i;

  it('GUARDA: nenhum literal de mensagem nos arquivos vigiados está em inglês', () => {
    const achados = [];
    for (const rel of ARQUIVOS_DE_TABELA) {
      const caminho = fileURLToPath(new URL(rel, import.meta.url));
      const fonte = semComentarios(readFileSync(caminho, 'utf8'));
      for (const lit of literais(fonte)) {
        // `code` de máquina e SQLSTATE são identificadores, nunca texto de tela.
        if (/^[A-Z0-9_]+$/.test(lit)) continue;
        if (/^[0-9A-Z]{5}$/.test(lit)) continue;
        if (MARCADOR_INGLES.test(lit)) achados.push(`${rel}: ${lit}`);
      }
    }
    assert.deepEqual(achados, [], `mensagem de usuário em inglês:\n${achados.join('\n')}`);
  });
});
