// Path: tests/unit/erro-preserva-causa.test.js
// O DIAGNÓSTICO QUE MENTIA. `lerPiramides` (src/modules/streetview360/sv360.pyramid.js)
// traduzia QUALQUER erro não-`AppError` num `BadRequestError` com o texto «tiles.db is
// not a valid SQLite file», e jogava o original fora. Só que o que falha ao abrir um
// bundle de dezenas de GB quase nunca é o formato: `EBUSY` (outro processo segurando o
// arquivo), `EACCES` (permissão), `SQLITE_CANTOPEN_ISDIR` (o caminho é uma pasta),
// `EMFILE` e disco cheio caem todos naquele mesmo `catch`. O operador lia «arquivo
// inválido» e ia procurar corrupção onde havia bloqueio, e não havia no servidor uma
// única linha que dissesse o contrário. O próprio arquivo já descrevia essa doença num
// comentário sem curar o caso geral.
//
// O CONSERTO É DE CASA, NÃO DOS DOIS SÍTIOS. `AppError` e as SETE subclasses passaram a
// aceitar um `options` OPCIONAL no fim e a repassá-lo ao `super`, de onde o `Error` do
// node lê `cause`. Consertar só o `sv360.pyramid.js` deixaria o próximo tradutor de erro
// de driver perdendo a causa de novo, e ninguém notaria: erro traduzido não fica
// vermelho em lugar nenhum.
//
// O QUE FOI MEDIDO NO PINO 8.21 INSTALADO (pino-std-serializers 6.2.2, `lib/err.js` mais
// `lib/err-helpers.js`), porque é isso que decide se a mudança é segura:
//   - `new Error(m, { cause })` instala `cause` NÃO-enumerável (é o que a spec manda,
//     `CreateNonEnumerableDataPropertyOrThrow`), então `Object.keys` e `for...in` a
//     pulam;
//   - o serializer DOBRA a causa em DUAS STRINGS: `messageWithCauses` produz
//     «externa: interna» e `stackWithCauses` acrescenta «\ncaused by: <pilha interna>»;
//   - e ele NUNCA copia a causa como CAMPO: o laço de propriedades a pula por nome
//     (`key !== 'cause'`), de modo que nem a forma enumerável (`err.cause = x`, por
//     atribuição) é copiada.
//
// A CONSEQUÊNCIA PARA O VAZAMENTO, que é a razão de este arquivo existir: os campos com
// valor que o driver do PostgreSQL pendura num erro (`detail`, que numa violação de
// CHECK imprime a LINHA inteira e para `users` inclui o `password_hash`; `where`;
// `query`, com a credencial já substituída dentro do texto; `params`) NÃO chegam à linha
// de log quando aquele erro é uma CAUSA. Eles ficam AUSENTES, e não elididos:
// `elidirCamposDoPg` (src/utils/logger.js) desce por `Object.keys` procurando valores
// com cara de erro, e ali não há nada por onde descer. Só a `message` e a `stack` da
// causa viajam, e nenhuma das duas carrega dado de linha.
//
// Por isso os dois casos de vazamento aqui são um PAR, e o par é o que os torna
// honestos: o primeiro afirma que o segredo não sai pela porta nova (`cause`), e o
// segundo afirma que a elisão CONTINUA discriminando pela porta velha (um erro do pg
// pendurado num campo enumerável qualquer, que o serializer copia inteiro). Sem o
// segundo, o primeiro passaria verde com a elisão inteira apagada, que é a cobertura
// vazia que a constituição desta casa persegue por escrito.
//
// A asserção é sobre o OBJETO QUE O CÓDIGO MONTA, nunca sobre a saída do pino: sob
// NODE_ENV=test o logger está em nível `silent`, então um teste que espiasse o stream
// passaria verde com o defeito intacto.
//
// CONTROLE NEGATIVO (2026-09-01), MEDIDO revertendo uma peça de cada vez e restaurando
// entre uma e outra:
//   - `super(message, options)` de volta a `super(message)` em `AppError`, a ÚNICA linha
//     que carrega o encaminhamento: 7 vermelhos de 24, e o primeiro diz «esperado: a
//     mensagem serializada nomeia a causa, veio "tiles.db is not a valid SQLite file"».
//     Repare que ele derruba os casos de `lerPiramides` JUNTO, que é a prova de que a
//     capacidade é da base e não dos dois sítios.
//   - `{ cause: err }` fora dos DOIS `throw` de `sv360.pyramid.js`, com a base intacta:
//     2 vermelhos, só os de `lerPiramides`, «o EACCES/ISDIR do construtor tem de
//     sobreviver» e «o SQLITE_NOTADB do primeiro statement tem de sobreviver».
//   - `elidirCamposDoPg` fora do `errSerializer` (`src/utils/logger.js`, restaurado byte
//     a byte depois): 1 vermelho, «a presença do DETAIL é dita, o conteúdo não», e é só
//     o da porta VELHA. O caso da causa segue VERDE, e é exatamente isso que se queria
//     saber: o caminho novo não depende da elisão para não vazar, e os dois casos medem
//     mesmo coisas diferentes.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { errSerializer } from '../../src/utils/logger.js';
import { errorHandler } from '../../src/middleware/error-handler.js';
import { sv360ErrorHandler } from '../../src/modules/streetview360/sv360-error.js';
import { lerPiramides } from '../../src/modules/streetview360/sv360.pyramid.js';
import {
  AppError, NotFoundError, ForbiddenError, UnauthorizedError,
  ConflictError, ValidationError, BadRequestError, ServiceUnavailableError,
} from '../../src/utils/errors.js';

const SENHA_HASH = '$2b$12$KIXQ0kUuNaoDeveVazarNuncaJamais';
const API_KEY = 'ebgeo_live_7f3c9a1b2d4e5f60718293a4';

/** Um erro com a forma que o driver do pg entrega, sem precisar do banco. */
function erroDoPgFalso(campos) {
  return Object.assign(new Error('erro de banco'), campos);
}

/** Os cinco campos com valor que o pg pendura, todos carregando segredo. */
function erroDoPgComDadoDeLinha() {
  return erroDoPgFalso({
    code: '23514',
    constraint: 'users_producer_scope_check',
    table: 'users',
    detail: `Failing row contains (7, fulano, ${SENHA_HASH}, producer, null).`,
    where: `PL/pgSQL function fn_x('${API_KEY}') line 3`,
    query: `INSERT INTO users (password_hash) VALUES ('${SENHA_HASH}')`,
    params: [SENHA_HASH],
    internalQuery: `SELECT 1 FROM users WHERE api_key = '${API_KEY}'`,
  });
}

function mockReq() {
  return { method: 'GET', url: '/test', originalUrl: '/test', user: { id: 'u1' } };
}

function mockRes() {
  let _status = null;
  let _json = null;
  return {
    headersSent: false,
    status(code) { _status = code; return this; },
    json(body) { _json = body; return this; },
    get statusCode() { return _status; },
    get body() { return _json; },
  };
}

/** Um diretório temporário próprio por caso, para os dois desfechos do better-sqlite3. */
function pastaTemp() {
  return mkdtempSync(join(tmpdir(), 'sv360-causa-'));
}

describe('a causa chega ao objeto que vai para o log', () => {
  it('a mensagem do log nomeia a causa, e sem ela não nomeava', () => {
    const bloqueio = Object.assign(new Error("EBUSY: resource busy or locked, open 'x_tiles.db'"), {
      code: 'EBUSY',
    });
    const comCausa = errSerializer(
      new BadRequestError('tiles.db is not a valid SQLite file', { cause: bloqueio })
    );
    assert.ok(
      comCausa.message.includes('EBUSY'),
      `esperado: a mensagem serializada nomeia a causa, veio ${JSON.stringify(comCausa.message)}`
    );

    // Discriminador: é a causa que põe o texto ali, não o acaso.
    const semCausa = errSerializer(new BadRequestError('tiles.db is not a valid SQLite file'));
    assert.ok(!semCausa.message.includes('EBUSY'), 'sem causa a mensagem não podia nomear nada');
    assert.equal(semCausa.message, 'tiles.db is not a valid SQLite file');
  });

  it('a pilha da causa viaja junto, marcada como tal', () => {
    const raiz = new Error('SQLITE_NOTADB: file is not a database');
    const saida = errSerializer(new BadRequestError('tiles.db is not a valid SQLite file', { cause: raiz }));
    assert.ok(saida.stack.includes('caused by:'), 'o pino 8.21 dobra a pilha da causa com este marcador');
    assert.ok(saida.stack.includes('SQLITE_NOTADB'), 'e a pilha dobrada tem de nomear a raiz');
  });

  it('o tipo e o status do erro traduzido continuam sendo os dele, não os da causa', () => {
    // Um conserto que simplesmente relançasse o original passaria nos dois casos acima
    // e devolveria 500 ao cliente para o que é 400.
    const err = new BadRequestError('tiles.db is not a valid SQLite file', {
      cause: new RangeError('outra coisa'),
    });
    const saida = errSerializer(err);
    assert.equal(saida.type, 'BadRequestError');
    assert.equal(saida.statusCode, 400);
    assert.equal(saida.code, 'BAD_REQUEST');
  });
});

describe('a causa não é uma porta de vazamento', () => {
  it('um erro do pg com dado de linha na CAUSA não leva o segredo ao log', () => {
    const pg = erroDoPgComDadoDeLinha();
    // Guardas de não-vacuidade: o erro cru TEM de carregar os dois segredos, senão o
    // caso mediria a ausência da fixture em vez da elisão.
    const bruto = JSON.stringify({ d: pg.detail, w: pg.where, q: pg.query, p: pg.params });
    assert.ok(bruto.includes(SENHA_HASH), 'fixture: o erro cru de fato carrega o hash');
    assert.ok(bruto.includes(API_KEY), 'fixture: e a chave de API');

    const saida = JSON.stringify(
      errSerializer(new BadRequestError('tiles.db is not a valid SQLite file', { cause: pg }))
    );
    assert.ok(!saida.includes(SENHA_HASH), `o hash de senha chegou ao log: ${saida}`);
    assert.ok(!saida.includes('KIXQ0kUu'), 'nem um pedaço dele');
    assert.ok(!saida.includes(API_KEY), `a chave de API chegou ao log: ${saida}`);
    assert.ok(!saida.includes('Failing row contains'), 'o DETAIL despeja a linha inteira');
    assert.ok(!saida.includes('ebgeo_live'), 'nem o prefixo da chave');
  });

  it('a elisão CONTINUA discriminando pela porta velha, o campo enumerável', () => {
    // O par do caso acima. Lá o segredo não sai porque o pino não copia a causa; aqui
    // ele SAI copiado (o serializer desce em toda propriedade enumerável com cara de
    // erro) e quem o barra é `elidirCamposDoPg`. Sem este caso, o de cima passaria verde
    // com a elisão inteira apagada.
    const externo = Object.assign(new Error('falhou a transação'), {
      original: erroDoPgComDadoDeLinha(),
    });
    assert.ok(
      JSON.stringify(externo.original.detail).includes(SENHA_HASH),
      'fixture: o erro aninhado de fato carrega o hash'
    );

    const saida = errSerializer(externo);
    assert.equal(saida.original.detail, '[REDACTED]', 'a presença do DETAIL é dita, o conteúdo não');
    assert.equal(saida.original.where, '[REDACTED]');
    assert.equal(saida.original.params, undefined, '`params` é apagado, não elidido');
    assert.ok(!JSON.stringify(saida).includes(SENHA_HASH), `o hash chegou ao log: ${JSON.stringify(saida)}`);
    // O que sobra ainda diagnostica: um conserto que apagasse o aninhado inteiro
    // passaria nas linhas acima e deixaria o log sem SQLSTATE nem constraint.
    assert.equal(saida.original.code, '23514');
    assert.equal(saida.original.constraint, 'users_producer_scope_check');
  });

  it('nem por atribuição: `err.cause = pgErr` também não copia os campos do driver', () => {
    // `cause` por atribuição é ENUMERÁVEL, ao contrário da forma do construtor, e mesmo
    // assim o serializer a pula por NOME. É o que garante que a porta seja uma só.
    const err = new BadRequestError('tiles.db is not a valid SQLite file');
    err.cause = erroDoPgComDadoDeLinha();
    assert.equal(
      Object.getOwnPropertyDescriptor(err, 'cause').enumerable, true,
      'fixture: a forma por atribuição é mesmo enumerável'
    );
    const saida = JSON.stringify(errSerializer(err));
    assert.ok(!saida.includes(SENHA_HASH), `o hash chegou ao log: ${saida}`);
    assert.ok(!saida.includes(API_KEY), 'nem a chave de API');
  });
});

describe('o corpo da resposta ao cliente não mudou', () => {
  it('handler global: o corpo com causa é IDÊNTICO ao corpo sem causa', () => {
    const semRes = mockRes();
    errorHandler(new BadRequestError('tiles.db is not a valid SQLite file'), mockReq(), semRes, () => {});

    const comRes = mockRes();
    errorHandler(
      new BadRequestError('tiles.db is not a valid SQLite file', { cause: erroDoPgComDadoDeLinha() }),
      mockReq(), comRes, () => {}
    );

    assert.equal(comRes.statusCode, semRes.statusCode);
    assert.deepEqual(comRes.body, semRes.body);
    assert.deepEqual(comRes.body, {
      error: { code: 'BAD_REQUEST', message: 'tiles.db is not a valid SQLite file' },
    });
    assert.ok(!JSON.stringify(comRes.body).includes(SENHA_HASH), 'a causa não pode vazar no corpo');
  });

  it('envelope PLANO do sv360: mesmo corpo, e a mensagem segue sendo só a nossa', () => {
    // Contrato congelado do 360: `{ error: 'texto' }`, e o texto sai de `err.message`.
    // Se a causa vazasse para `message` (é o que o pino faz ao SERIALIZAR, e é por isso
    // que este caso existe), o cliente passaria a receber o texto do driver.
    const semRes = mockRes();
    sv360ErrorHandler(new BadRequestError('tiles.db is not a valid SQLite file'), mockReq(), semRes, () => {});

    const comRes = mockRes();
    sv360ErrorHandler(
      new BadRequestError('tiles.db is not a valid SQLite file', {
        cause: new Error("EACCES: permission denied, open 'x_tiles.db'"),
      }),
      mockReq(), comRes, () => {}
    );

    assert.equal(comRes.statusCode, 400);
    assert.deepEqual(comRes.body, semRes.body);
    assert.deepEqual(comRes.body, { error: 'tiles.db is not a valid SQLite file' });
    assert.ok(!comRes.body.error.includes('EACCES'), 'a causa é do log, nunca do cliente');
  });

  it('`err.message` do próprio objeto não é reescrito pela dobra do pino', () => {
    // A dobra é do SERIALIZER, não do erro: `messageWithCauses` monta uma string nova.
    // Se um dia ela mutasse o erro, o corpo da resposta mudaria junto, porque os dois
    // handlers acima leem `err.message`.
    const err = new BadRequestError('tiles.db is not a valid SQLite file', { cause: new Error('EBUSY') });
    assert.ok(errSerializer(err).message.includes('EBUSY'), 'fixture: o serializer de fato dobrou');
    assert.equal(err.message, 'tiles.db is not a valid SQLite file');
  });
});

describe('as sete subclasses continuam funcionando SEM o parâmetro novo', () => {
  // O parâmetro é opcional e há centenas de chamadores existentes: nada pode mudar para
  // quem não o passa. `cause` não pode nem existir como propriedade, senão a saída do
  // serializer ganharia um «: undefined» na mensagem de todo erro desta casa.
  const naFormaAntiga = [
    ['AppError', () => new AppError('test', 500, 'TEST_ERROR'), 500, 'TEST_ERROR', 'test'],
    ['NotFoundError', () => new NotFoundError('Atlas'), 404, 'NOT_FOUND', 'Atlas not found'],
    ['NotFoundError (default)', () => new NotFoundError(), 404, 'NOT_FOUND', 'Resource not found'],
    ['ForbiddenError', () => new ForbiddenError(), 403, 'FORBIDDEN', 'Você não tem permissão para esta ação.'],
    ['UnauthorizedError', () => new UnauthorizedError(), 401, 'UNAUTHORIZED', 'Faça login para continuar.'],
    ['ConflictError', () => new ConflictError('Duplicate'), 409, 'CONFLICT', 'Duplicate'],
    ['ValidationError', () => new ValidationError(), 422, 'VALIDATION_ERROR', 'Falha na validação'],
    ['BadRequestError', () => new BadRequestError(), 400, 'BAD_REQUEST', 'Requisição inválida.'],
    ['ServiceUnavailableError', () => new ServiceUnavailableError(), 503, 'SERVICE_UNAVAILABLE',
      'Serviço temporariamente indisponível. Tente novamente em instantes.'],
  ];

  for (const [nome, fabrica, status, code, message] of naFormaAntiga) {
    it(`${nome} sem o parâmetro: status, code, message e NENHUMA causa`, () => {
      const err = fabrica();
      assert.equal(err.statusCode, status);
      assert.equal(err.code, code);
      assert.equal(err.message, message);
      assert.equal(err.isOperational, true);
      assert.ok(err instanceof AppError);
      assert.ok(err instanceof Error);
      assert.equal(Object.hasOwn(err, 'cause'), false, 'sem opções, `cause` não pode nascer');
      assert.equal(errSerializer(err).message, message, 'e a mensagem serializada não ganha sufixo');
    });
  }

  it('`ValidationError` mantém `details` no SEGUNDO argumento', () => {
    // A ordem é contrato: `details` vai para o corpo da resposta. Se `options` tivesse
    // tomado esse lugar, todo `new ValidationError(msg, details)` viraria uma causa.
    const details = [{ field: 'name', message: 'required' }];
    const err = new ValidationError('Bad data', details);
    assert.deepEqual(err.details, details);
    assert.equal(Object.hasOwn(err, 'cause'), false);

    const comCausa = new ValidationError('Bad data', details, { cause: new Error('raiz') });
    assert.deepEqual(comCausa.details, details, 'a causa não pode deslocar os details');
    assert.equal(comCausa.cause.message, 'raiz');
  });

  it('as sete subclasses ENCAMINHAM a causa quando ela é passada', () => {
    const raiz = new Error('raiz');
    const comCausa = [
      new NotFoundError('Atlas', { cause: raiz }),
      new ForbiddenError('x', { cause: raiz }),
      new UnauthorizedError('x', { cause: raiz }),
      new ConflictError('x', { cause: raiz }),
      new ValidationError('x', null, { cause: raiz }),
      new BadRequestError('x', { cause: raiz }),
      new ServiceUnavailableError('x', { cause: raiz }),
    ];
    assert.equal(comCausa.length, 7, 'são SETE subclasses, e todas encaminham');
    for (const err of comCausa) {
      assert.equal(err.cause, raiz, `${err.constructor.name} não encaminhou a causa`);
      assert.equal(
        Object.getOwnPropertyDescriptor(err, 'cause').enumerable, false,
        `${err.constructor.name}: a causa do construtor tem de nascer não-enumerável`
      );
    }
  });
});

describe('lerPiramides: os DOIS caminhos de recusa preservam o original', () => {
  it('o construtor que não abre (ISDIR/EACCES/EBUSY) sobrevive como causa', () => {
    // O caso que motivou tudo: o caminho existe, então o guard de `existsSync` passa, e
    // o `new Database` falha por uma razão que NADA tem a ver com formato.
    const base = pastaTemp();
    const alvo = join(base, 'na-verdade-uma-pasta');
    mkdirSync(alvo);

    let capturado = null;
    try { lerPiramides(alvo, ['foto-1']); } catch (err) { capturado = err; }

    assert.ok(capturado instanceof BadRequestError, 'segue sendo 400, e não 500');
    assert.equal(capturado.message, 'tiles.db is not a valid SQLite file', 'o texto do cliente não muda');
    assert.ok(capturado.cause, 'o EACCES/ISDIR do construtor tem de sobreviver');
    assert.equal(capturado.cause.code, 'SQLITE_CANTOPEN_ISDIR', 'e sobreviver com o código do driver');
    assert.ok(
      errSerializer(capturado).message.includes('unable to open database file'),
      'a linha de log tem de dizer que era ABERTURA, não formato'
    );
  });

  it('o arquivo que não é SQLite sobrevive como causa, pelo catch do bloco', () => {
    // Aqui o construtor PASSA (`sqlite3_open` não lê o cabeçalho) e o SQLITE_NOTADB só
    // aparece no primeiro statement, que é o outro sítio traduzido.
    const base = pastaTemp();
    const alvo = join(base, 'lixo_tiles.db');
    writeFileSync(alvo, Buffer.from(`isto nao e um sqlite ${'x'.repeat(200)}`));

    let capturado = null;
    try { lerPiramides(alvo, ['foto-1']); } catch (err) { capturado = err; }

    assert.ok(capturado instanceof BadRequestError);
    assert.equal(capturado.message, 'tiles.db is not a valid SQLite file');
    assert.ok(capturado.cause, 'o SQLITE_NOTADB do primeiro statement tem de sobreviver');
    assert.equal(capturado.cause.code, 'SQLITE_NOTADB');
    assert.ok(errSerializer(capturado).message.includes('file is not a database'));
  });

  it('o `BadRequestError` nomeado do próprio arquivo passa INTACTO, sem virar causa de si', () => {
    // Discriminador do `if (err instanceof AppError) throw err`: um SQLite legítimo sem
    // a tabela recebe a mensagem específica, e não a genérica com causa.
    const base = pastaTemp();
    const alvo = join(base, 'vazio_tiles.db');
    writeFileSync(alvo, Buffer.alloc(0));

    let capturado = null;
    try { lerPiramides(alvo, ['foto-1']); } catch (err) { capturado = err; }

    assert.ok(capturado instanceof BadRequestError);
    assert.equal(capturado.message, 'tiles.db has no `tile_pyramids` table');
    assert.equal(Object.hasOwn(capturado, 'cause'), false, 'erro nosso não ganha causa de enfeite');
  });

  it('o caminho feliz não lança: ausência de arquivo continua sendo mapa vazio', () => {
    // Guarda de não-vacuidade dos três casos acima: se `lerPiramides` lançasse sempre,
    // eles passariam sem provar nada sobre a tradução.
    assert.equal(lerPiramides(null, ['foto-1']).size, 0);
    assert.equal(lerPiramides(join(pastaTemp(), 'nao-existe.db'), ['foto-1']).size, 0);
  });
});
