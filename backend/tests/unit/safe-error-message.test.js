// Path: tests/unit/safe-error-message.test.js
//
// Achados 107/108/109 — as três saídas em que `err.message` cru chegava ao cliente
// (socket de colaboração, `failed[]` do upload em lote de imagens, `failed[]` da
// calibração 360 em lote). Este arquivo prende a UNIDADE; as duas metades do
// contrato (o cliente não recebe o texto do driver E o erro cru chega ao logger)
// são provadas de ponta a ponta em:
//   tests/ws/collab-error-leak.repro.test.js
//   tests/integration/images-bulk-error-leak.repro.test.js
//   tests/integration/sv360-batch-error-leak.repro.test.js
//
// A pergunta que cada caso responde: se `safeErrorMessage` voltasse a devolver
// `err.message`, o que este verde estaria provando? Por isso nenhum caso se contenta
// com "é uma string": cada um afirma o texto exato E que o texto cru NÃO aparece.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { safeErrorMessage } from '../../src/utils/safe-error-message.js';
import {
  NotFoundError,
  ForbiddenError,
  ServiceUnavailableError,
} from '../../src/utils/errors.js';

/** Erro no formato que o pg-promise entrega: SQLSTATE em `code`, texto do driver. */
function pgError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

/** Erro no formato que o fs entrega: errno textual em `code`, caminho no texto. */
function fsError(code, message) {
  const err = new Error(message);
  err.code = code;
  err.errno = -1;
  return err;
}

describe('safeErrorMessage — texto do driver nunca atravessa a borda (107/108/109)', () => {
  it('devolve intacta a mensagem de um AppError (foi escrita para o usuário)', () => {
    assert.equal(safeErrorMessage(new NotFoundError('Photo')), 'Photo not found');
    assert.equal(
      safeErrorMessage(new ForbiddenError('Você não tem permissão para esta ação.')),
      'Você não tem permissão para esta ação.'
    );
    // O 503 do push de sync ocupado: texto pt-BR acionável, que mascarar destruiria.
    assert.equal(
      safeErrorMessage(new ServiceUnavailableError('Servidor ocupado. Tente novamente.')),
      'Servidor ocupado. Tente novamente.'
    );
  });

  it('mapeia o unique_violation para texto fixo e some com o nome da constraint', () => {
    const raw = 'duplicate key value violates unique constraint "images_pkey"';
    const out = safeErrorMessage(pgError('23505', raw), 'Unknown error');
    assert.equal(out, 'Já existe um registro com esses dados. Altere e tente de novo.');
    assert.doesNotMatch(out, /pkey|constraint|violates/i, 'nada do texto do driver');
  });

  it('mapeia FK, NOT NULL, CHECK, cast e overflow para os mesmos textos do errorHandler', () => {
    assert.equal(
      safeErrorMessage(pgError('23503', 'violates foreign key constraint "slides_map_id_fkey"')),
      'O registro referenciado não existe ou ainda está em uso.'
    );
    assert.equal(
      safeErrorMessage(pgError('23502', 'null value in column "atlas_id" violates not-null')),
      'Preencha todos os campos obrigatórios.'
    );
    assert.equal(
      safeErrorMessage(pgError('23514', 'new row violates check constraint "valid_feature_type"')),
      'Um valor não atende a uma regra do sistema.'
    );
    assert.equal(
      safeErrorMessage(pgError('22P02', 'invalid input syntax for type uuid: "nao-e-uuid"')),
      'Valor mal formado (identificador ou tipo inválido).'
    );
    assert.equal(
      safeErrorMessage(pgError('22003', 'value "9999999999" is out of range for type integer')),
      'Valor numérico fora do intervalo permitido.'
    );
    assert.equal(
      safeErrorMessage(pgError('22001', 'value too long for type character varying(255)')),
      'Valor longo demais para o campo.'
    );
  });

  it('some com o CAMINHO ABSOLUTO do servidor num erro de fs (o dado mais sensível do conjunto)', () => {
    const raw = "EACCES: permission denied, open 'C:\\\\srv\\\\ebgeo\\\\uploads\\\\images\\\\a\\\\b.png'";
    const out = safeErrorMessage(fsError('EACCES', raw), 'Unknown error');
    assert.equal(out, 'Unknown error');
    assert.doesNotMatch(out, /[/\\]/, 'nenhum separador de caminho na saída');
    assert.doesNotMatch(out, /uploads|EACCES/i);
  });

  it('EPERM (cinco maiúsculas, a armadilha de "parece um SQLSTATE") cai no fallback', () => {
    // A classificação é por PERTENCIMENTO ao mapa, não por formato: `/^[0-9A-Z]{5}$/`
    // casaria EPERM, EBUSY, EROFS, EPIPE e EBADF, e um errno de fs sairia rotulado
    // como violação de dado. Nenhum deles vaza, mas o texto mentiria sobre a causa.
    const out = safeErrorMessage(fsError('EPERM', "EPERM: operation not permitted, open '/srv/x'"));
    assert.equal(out, 'A operação falhou.');
  });

  it('um SQLSTATE não mapeado cai no fallback, sem revelar que houve erro de SQL', () => {
    const out = safeErrorMessage(pgError('42P01', 'relation "operations" does not exist'), 'A sincronização falhou.');
    assert.equal(out, 'A sincronização falhou.');
    assert.doesNotMatch(out, /operations|relation|exist/i);
  });

  it('só `isOperational === true` libera a passagem: truthy qualquer não basta', () => {
    // Um erro de terceiro que por acaso carregue a propriedade não pode virar
    // passe-livre para o próprio texto.
    const impostor = new Error('violates unique constraint "users_pkey"');
    impostor.isOperational = 'yes';
    assert.equal(safeErrorMessage(impostor), 'A operação falhou.');

    const naoOperacional = new Error('relation "atlas" does not exist');
    naoOperacional.isOperational = false;
    assert.equal(safeErrorMessage(naoOperacional), 'A operação falhou.');
  });

  it('AppError sem texto útil cai no fallback em vez de devolver string vazia', () => {
    const vazio = new Error('');
    vazio.isOperational = true;
    assert.equal(safeErrorMessage(vazio, 'Update failed'), 'Update failed');
  });

  it('entradas degeneradas (null/undefined/string/number) devolvem o fallback', () => {
    assert.equal(safeErrorMessage(null, 'Unknown error'), 'Unknown error');
    assert.equal(safeErrorMessage(undefined, 'Unknown error'), 'Unknown error');
    assert.equal(safeErrorMessage('violates constraint "x_pkey"', 'Unknown error'), 'Unknown error');
    assert.equal(safeErrorMessage(42, 'Unknown error'), 'Unknown error');
  });

  it('o fallback default não é vazio nem revela nada', () => {
    assert.equal(safeErrorMessage(new Error('boom')), 'A operação falhou.');
  });

  it('não muta o erro recebido (o logger ainda precisa dele inteiro)', () => {
    const err = pgError('23505', 'duplicate key value violates unique constraint "images_pkey"');
    safeErrorMessage(err);
    assert.equal(err.message, 'duplicate key value violates unique constraint "images_pkey"');
    assert.equal(err.code, '23505');
  });
});
