// Path: tests/unit/diag-fusao-de-sessao.test.js
// A SESSÃO SOBREVIVE À FUSÃO, e o EXEMPLO do grupo continua sem ela. São as duas metades
// da mesma decisão, e elas puxam para lados opostos de propósito.
//
// O QUE ESTÁ EM JOGO. Uma requisição falha escreve DUAS linhas e `fundirPorRequisicao`
// (`src/utils/diag-consulta.js`) fica com a que carrega `err`. O `sessaoId` é escrito pela
// OUTRA (a do `request-logger`), então sem uma regra explícita ele seria descartado em todo
// erro de rota — exatamente o que já aconteceu com o `ip`, e a correção de lá é o modelo
// desta. Do outro lado, o `exemplo` que a rota publica é a ocorrência MAIS RECENTE do
// grupo: uma sessão ali se leria como "foi esta aba" sobre um grupo de mil.
//
// CONTROLE NEGATIVO (o que fica vermelho ao reverter cada peça):
//  - tirar o mapa `sessoes` de `fundirPorRequisicao`: o caso do log antigo (linha de erro
//    SEM eco) perde a sessão, e é o caso de todo arquivo escrito antes do eco existir;
//  - fazer a cópia sobrescrever: o caso das duas sessões diferentes no mesmo `reqId` passa
//    a devolver a da linha de requisição por cima da que o errorHandler ecoou;
//  - clonar sempre em vez de devolver o registro intacto: o caso da identidade fica
//    vermelho, e `criarAgrupadorDeErros` compara REFERÊNCIA para desempatar exemplo;
//  - acrescentar `sessaoId` ao recorte de `mapearGrupo`: o caso do exemplo fica vermelho.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fundirPorRequisicao, agruparErros } from '../../src/utils/diag-consulta.js';
import { mapearGrupo } from '../../src/modules/diag/diag.service.js';

const SESSAO = '3f2a1b4c-5d6e-4f7a-8b9c-0d1e2f3a4b5c';
const OUTRA = '9a8b7c6d-5e4f-4a3b-2c1d-0e9f8a7b6c5d';

/** A linha do `errorHandler`: carrega `err`, e é a que a fusão mantém. */
const linhaDeErro = (reqId, over = {}) => ({
  level: 50, time: 1000, reqId, method: 'POST', url: '/api/v1/atlas/x/sync',
  msg: 'Request error',
  err: { type: 'ValidationError', message: 'op inválida', stack: 'ValidationError: op inválida\n at aqui' },
  ...over,
});

/** A linha do `request-logger`: carrega `statusCode`, `duration`, `ip` e `sessaoId`. */
const linhaDeRequisicao = (reqId, over = {}) => ({
  level: 40, time: 1001, reqId, method: 'POST', url: '/api/v1/atlas/x/sync',
  statusCode: 400, duration: 12, ip: '203.0.113.9', msg: 'request error',
  ...over,
});

describe('fundirPorRequisicao — a sessão atravessa', () => {
  it('log ANTIGO (erro sem eco): a sessão vem da linha de requisição', () => {
    const saida = fundirPorRequisicao([
      linhaDeErro('r1'),
      linhaDeRequisicao('r1', { sessaoId: SESSAO }),
    ]);
    assert.equal(saida.length, 1, 'as duas linhas viram uma');
    assert.equal(saida[0].sessaoId, SESSAO);
    assert.equal(saida[0].statusCode, 400, 'o status continua atravessando');
    assert.equal(saida[0].err.type, 'ValidationError', 'o registro mantido é o rico');
  });

  it('log NOVO (erro com eco): a sessão do registro rico é a que fica', () => {
    // O `errorHandler` ecoa `sessaoId`, então o caminho comum não depende da cópia. Se as
    // duas divergirem, vence a do registro que sobrevive: uma regra só, e a mais próxima
    // do erro.
    const saida = fundirPorRequisicao([
      linhaDeErro('r1', { sessaoId: SESSAO }),
      linhaDeRequisicao('r1', { sessaoId: OUTRA }),
    ]);
    assert.equal(saida.length, 1);
    assert.equal(saida[0].sessaoId, SESSAO);
  });

  it('sem sessão em lugar nenhum, a chave não é inventada', () => {
    const saida = fundirPorRequisicao([linhaDeErro('r1'), linhaDeRequisicao('r1')]);
    assert.equal(saida.length, 1);
    assert.equal(Object.hasOwn(saida[0], 'sessaoId'), false);
  });

  it('duas requisições de ABAS diferentes não trocam de sessão', () => {
    const saida = fundirPorRequisicao([
      linhaDeErro('r1'),
      linhaDeRequisicao('r1', { sessaoId: SESSAO }),
      linhaDeErro('r2'),
      linhaDeRequisicao('r2', { sessaoId: OUTRA }),
    ]);
    assert.equal(saida.length, 2);
    assert.equal(saida[0].sessaoId, SESSAO);
    assert.equal(saida[1].sessaoId, OUTRA);
  });

  it('registro sem par sai INTACTO, pela mesma referência', () => {
    // A identidade não é detalhe: `criarAgrupadorDeErros` desempata o `exemplo` comparando
    // referências, e clonar por precaução mudaria o desempate sem nada ficar vermelho.
    const solto = { level: 50, time: 1, reqId: 'r9', err: { type: 'Error', message: 'x' } };
    const saida = fundirPorRequisicao([solto]);
    assert.equal(saida.length, 1);
    assert.equal(saida[0], solto, 'mesma referência, sem cópia');
  });

  it('linha SEM reqId passa intacta, sessão ou não', () => {
    const sweep = { level: 50, time: 2, msg: 'sweep do ws', sessaoId: SESSAO };
    const saida = fundirPorRequisicao([sweep]);
    assert.deepEqual(saida, [sweep]);
  });

  it('sessão que não é string não vira campo', () => {
    // O log é lido de disco: uma linha corrompida (ou de outro produtor) pode trazer
    // qualquer coisa nesse nome, e ela não pode virar o `sessaoId` de um grupo.
    const invalidas = [42, null, '', {}, ['x']];
    assert.equal(invalidas.length, 5);
    for (const valor of invalidas) {
      const saida = fundirPorRequisicao([
        linhaDeErro('r1'),
        linhaDeRequisicao('r1', { sessaoId: valor }),
      ]);
      assert.equal(saida.length, 1, `entrada ${JSON.stringify(valor)}`);
      assert.equal(Object.hasOwn(saida[0], 'sessaoId'), false, `entrada ${JSON.stringify(valor)}`);
    }
  });
});

describe('mapearGrupo — o exemplo NÃO carrega a sessão', () => {
  it('o recorte publica url, method, statusCode e stack, e nada mais', () => {
    const grupos = agruparErros([
      linhaDeErro('r1', { sessaoId: SESSAO }),
      linhaDeRequisicao('r1', { sessaoId: SESSAO }),
    ]);
    assert.equal(grupos.length, 1);

    const g = mapearGrupo(grupos[0]);
    assert.deepEqual(Object.keys(g.exemplo).sort(), ['method', 'stack', 'statusCode', 'url']);
    assert.equal(Object.hasOwn(g.exemplo, 'sessaoId'), false, 'um exemplo não distingue uma aba de trezentas');
    assert.equal(Object.hasOwn(g.exemplo, 'ip'), false, 'a mesma regra do endereço, de onde esta veio');
    assert.equal(g.exemplo.statusCode, 400, 'o que o recorte publica continua lá');
    assert.equal(g.total, 1);
  });

  it('o grupo em si também não publica sessão: quem tem campo próprio é o endereço', () => {
    // Declarado em voz alta porque a simetria seria a expectativa natural: `enderecos` tem
    // agregação por grupo e a sessão não tem. Acrescentá-la é decisão de produto, não
    // limpeza, e enquanto não for tomada o campo simplesmente não existe.
    const grupos = agruparErros([
      linhaDeErro('r1', { sessaoId: SESSAO }),
      linhaDeRequisicao('r1', { sessaoId: SESSAO }),
    ]);
    const g = mapearGrupo(grupos[0]);
    assert.equal(Object.hasOwn(g, 'sessaoId'), false);
    assert.equal(Object.hasOwn(g, 'sessoes'), false);
    assert.equal(g.enderecos.distintos, 1, 'o endereço, esse sim, é agregado');
  });
});
