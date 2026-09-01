// Path: tests/unit/pilha-so-em-5xx.test.js
/**
 * @fileoverview A pilha sai da linha de erro 4xx e fica na 5xx.
 *
 * POR QUE ISTO EXISTE. Medido sobre os `.jsonl` reais desta instalação em 2026-09-01: uma
 * linha de erro custava ~1665 bytes contra ~242 de uma linha de requisição normal, 79% dos
 * bytes de erro eram PILHA, e os três arquivos inteiros continham OITO pilhas distintas. Um
 * `NotFoundError` do roteador emite a MESMA pilha de 1,4 kB para qualquer URL: ela descreve
 * o caminho do handler, não o caso.
 *
 * AS ASSERÇÕES SÃO SOBRE O OBJETO QUE O CÓDIGO MONTA (`requestErrorLogPayload`), nunca sobre
 * a saída do pino: sob `NODE_ENV=test` o logger está em `silent`, então um teste que
 * espionasse a saída passaria verde com o defeito intacto. Mesmo desenho de
 * `limiterDenialPayload` e de `queryLogPayload`.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { requestErrorLogPayload } from '../../src/middleware/error-handler.js';
import { errSerializer } from '../../src/utils/logger.js';
import { NotFoundError, ValidationError, ServiceUnavailableError } from '../../src/utils/errors.js';
import { assinaturaDeErro } from '../../src/utils/diag-consulta.js';

function req(extra = {}) {
  return {
    id: 'req-1',
    method: 'GET',
    originalUrl: '/api/v1/atlas/9dd6d2e4-e090-47ce-b0b1-706fd982d1a2?api_key=segredo',
    user: { id: 'u1' },
    ...extra,
  };
}

describe('a pilha sai do 4xx e fica no 5xx', () => {
  it('4xx: a linha NÃO carrega pilha', () => {
    const linha = requestErrorLogPayload(new NotFoundError('Atlas'), req());

    assert.equal(linha.statusRegistrado, 404);
    assert.equal(linha.nivel, 'warn');
    assert.ok(!('stack' in linha.campos.err), 'um 4xx não pode carregar pilha');
  });

  it('5xx: a linha CARREGA a pilha, e ela é a do erro', () => {
    const erro = new ServiceUnavailableError('Banco fora');
    const linha = requestErrorLogPayload(erro, req());

    assert.equal(linha.statusRegistrado, 503);
    assert.equal(linha.nivel, 'error');
    assert.equal(typeof linha.campos.err.stack, 'string');
    assert.ok(linha.campos.err.stack.length > 0, 'pilha vazia não é pilha');
    assert.match(linha.campos.err.stack, /ServiceUnavailableError|Banco fora/);
  });

  it('erro sem statusCode conta como 5xx e mantém a pilha', () => {
    // O defeito de programação (um TypeError vindo de um service) é o caso em que a pilha é
    // a única coisa que responde "onde".
    const linha = requestErrorLogPayload(new TypeError('x is not a function'), req());

    assert.equal(linha.statusRegistrado, 500);
    assert.equal(linha.nivel, 'error');
    assert.equal(typeof linha.campos.err.stack, 'string');
  });

  it('Joi (422) é 4xx: sem pilha, e os `details` ficam', () => {
    // `details` é o que diz QUAL campo reprovou, e é ele (não a pilha) que diagnostica o
    // 400/422 em laço que originou esta camada.
    const joi = Object.assign(new Error('falhou'), {
      isJoi: true,
      details: [{
        message: 'nome é obrigatório',
        path: ['body', 'nome'],
        type: 'any.required',
        context: { key: 'nome', label: 'nome', value: 'SEGREDO' },
      }],
    });
    const linha = requestErrorLogPayload(joi, req());

    assert.equal(linha.statusRegistrado, 422);
    assert.equal(linha.nivel, 'warn');
    assert.ok(!('stack' in linha.campos.err), 'um 422 não pode carregar pilha');
    assert.equal(linha.campos.err.details.length, 1);
    assert.equal(linha.campos.err.details[0].context.key, 'nome');
    assert.ok(!('value' in linha.campos.err.details[0].context), 'o valor rejeitado continua fora');
  });

  it('o que sobra num 4xx é o que o diagnóstico exige', () => {
    // Tipo, mensagem, código, status, reqId, método e a rota redigida. Nenhum destes é a
    // pilha, e é esta lista que torna a troca honesta.
    const linha = requestErrorLogPayload(new ValidationError('Campo inválido'), req());
    const { err, reqId, method, url, userId } = linha.campos;

    assert.equal(err.type, 'ValidationError');
    assert.equal(err.message, 'Campo inválido');
    assert.equal(err.code, 'VALIDATION_ERROR');
    assert.equal(err.statusCode, 422);
    assert.equal(reqId, 'req-1');
    assert.equal(method, 'GET');
    assert.equal(userId, 'u1');
    assert.match(url, /^\/api\/v1\/atlas\//);
    assert.doesNotMatch(url, /segredo/, 'a URL continua redigida');
  });

  it('sem pilha, a ASSINATURA do relatório não muda', () => {
    // `assinaturaDeErro` agrupa por rota + tipo + mensagem + status, e nenhum desses termos
    // é a pilha. Este caso é o controle: tirar a pilha não pode reagrupar nada.
    const linha = requestErrorLogPayload(new NotFoundError('Atlas'), req());
    const semPilha = { ...linha.campos, statusCode: 404 };
    const comPilha = {
      ...semPilha,
      err: { ...linha.campos.err, stack: 'Error: Atlas not found\n    at algum-lugar' },
    };

    assert.equal(assinaturaDeErro(semPilha), assinaturaDeErro(comPilha));
    assert.match(assinaturaDeErro(semPilha), /NotFoundError/);
    assert.match(assinaturaDeErro(semPilha), /\[404\]$/);
  });

  it('a linha 4xx sem pilha continua sendo um registro de erro para o relatório', () => {
    // `ehErro` admite pela PRESENÇA de `err`, e é o que impede a economia de esconder o 4xx
    // do `npm run diag -- erros`.
    const linha = requestErrorLogPayload(new NotFoundError('Atlas'), req());
    assert.ok(linha.campos.err, 'o campo `err` precisa continuar existindo');
    assert.equal(typeof linha.campos.err.type, 'string');
  });

  it('a linha 4xx NÃO carrega `statusCode` no topo', () => {
    // Deliberado, e pelo mesmo motivo de `limiterDenialPayload`: `resumirStatus` conta uma
    // requisição por registro que traga `statusCode`, então um aqui contaria a requisição
    // falha DUAS vezes em `npm run diag -- status`. O status já viaja em `err.statusCode`.
    const linha = requestErrorLogPayload(new NotFoundError('Atlas'), req());
    assert.ok(!('statusCode' in linha.campos), 'statusCode no topo dobraria a contagem por faixa');
  });

  it('a economia é a que foi medida, e ela é grande', () => {
    // Números de controle ABSOLUTOS, contra a forma real de um 404. Sem eles, "menor"
    // passaria verde para uma economia de dez bytes.
    const erro = new NotFoundError('Route');
    const campos = requestErrorLogPayload(erro, req()).campos;
    const antes = { ...campos, err: errSerializer(erro) };

    const bytes = (o) => Buffer.byteLength(JSON.stringify(o));
    assert.ok(bytes(antes) > 700, `a linha com pilha precisa ser grande (foi ${bytes(antes)})`);
    assert.ok(bytes(campos) < 400, `a linha sem pilha precisa ser pequena (foi ${bytes(campos)})`);
    assert.ok(bytes(campos) * 2 < bytes(antes), 'a economia precisa ser de mais da metade');
  });
  it('o que não é Error não quebra o caminho: `next(`boom`)` é legal no Express', () => {
    // O serializer do pino devolve a string crua (`isErrorLike` pede uma `message`), e
    // marcá-la ou apagar campo dela levantaria um TypeError DENTRO do caminho de log de um
    // erro, que é o pior lugar possível para uma segunda exceção.
    const linha = requestErrorLogPayload('boom', req());

    assert.equal(linha.statusRegistrado, 500);
    assert.equal(linha.nivel, 'error');
    assert.equal(linha.campos.err, 'boom');
    assert.equal(errSerializer('boom'), 'boom');
  });
});

describe('errSerializer não se deixa serializar duas vezes', () => {
  it('a segunda passada devolve o objeto intacto', () => {
    // O pino aplica o serializer ao campo `err` SEMPRE, e o `error-handler` agora entrega um
    // objeto já serializado. Sem a marca, `isErrorLike` (que pergunta só por `message`)
    // aceitaria o objeto simples, e `type` seria recalculado como o nome do construtor de um
    // objeto simples, colapsando toda assinatura do relatório numa só. Medido antes da marca.
    const uma = errSerializer(new NotFoundError('Atlas'));
    const duas = errSerializer(uma);

    assert.equal(duas.type, 'NotFoundError');
    assert.equal(duas.code, 'NOT_FOUND');
    assert.equal(duas, uma, 'a segunda passada devolve a MESMA referência');
  });

  it('a marca não vaza para a linha de log', () => {
    const serializado = errSerializer(new NotFoundError('Atlas'));
    assert.ok(!JSON.stringify(serializado).includes('serializado'), 'a marca é símbolo, não campo');
    assert.equal(Object.keys(serializado).includes('raw'), false);
  });

  it('um objeto já serializado E sem pilha também não é re-serializado', () => {
    // É exatamente o que o pino recebe num 4xx, e é o caso em que a re-serialização
    // INVENTARIA uma pilha nova além de estragar o `type`.
    const semPilha = errSerializer(new NotFoundError('Atlas'));
    delete semPilha.stack;
    const depois = errSerializer(semPilha);

    assert.equal(depois.type, 'NotFoundError');
    assert.ok(!('stack' in depois), 'a re-serialização não pode ressuscitar a pilha');
  });
});
