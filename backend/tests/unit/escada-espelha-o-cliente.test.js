// Path: tests/unit/escada-espelha-o-cliente.test.js
//
// A MESMA CONTA EXISTE NOS DOIS PACOTES, E ELAS PRECISAM CONCORDAR.
//
// A escada da pirâmide é calculada duas vezes neste repositório, de propósito:
//   - `backend/src/modules/streetview360/sv360.escada.js`, para o servidor conferir a
//     faixa de um pedido ANTES de tocar o disco;
//   - `frontend/src/js/street_view_tool/pyramid-math.js`, para o cliente saber quais
//     tiles pedir.
//
// A duplicação é o preço de os dois pacotes serem independentes: o backend não importa
// do `frontend/` em runtime, e o cliente não pode arrastar código de servidor. Este
// arquivo é o único lugar onde as duas cópias se encontram, e ele é de TESTE, não de
// produção.
//
// O QUE ACONTECE SE ELAS DIVERGIREM: o cliente pede a coluna 3 de um nível que, na conta
// do servidor, só tem 3 colunas (índices 0..2). O servidor responde 404, o carregador
// anota no log e segue, e a tela mostra a foto com um buraco. Nenhum teste de nenhum dos
// dois lados fica vermelho, porque cada um está certo consigo mesmo. É a mesma classe do
// par de projetores 360/calibração, que já tem guarda pelo mesmo motivo
// (`frontend/tests/unit/calibracao-espelha-marcador-andar.test.js`).
//
// DUAS ASSERÇÕES POR CASO, e a segunda é o que separa este arquivo de um espelho inútil:
// comparar as duas cópias entre si passaria feliz se as DUAS estivessem erradas do mesmo
// jeito — que é o desfecho provável, já que a segunda foi escrita copiando a primeira.
// Por isso cada caso também carrega o número ABSOLUTO esperado, calculado à mão.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { escadaGravada as doServidor } from '../../src/modules/streetview360/sv360.escada.js';
import { escadaGravada as doCliente } from '../../../frontend/src/js/street_view_tool/pyramid-math.js';

/**
 * Casos escolhidos para DISCRIMINAR, não para ilustrar: cada um muda alguma decisão da
 * conta (número de níveis, razão, arredondamento, teto da divisão).
 * @type {Array<{nome: string, args: number[], esperado: Array<Object>}>}
 */
const CASOS = [
  {
    nome: 'dois níveis, razão 2, divisão exata',
    args: [1024, 512, 512, 2, 1],
    esperado: [
      { level: 0, width: 512, height: 256, cols: 1, rows: 1 },
      { level: 1, width: 1024, height: 512, cols: 2, rows: 1 },
    ],
  },
  {
    nome: 'três níveis, razão 2',
    args: [4096, 2048, 512, 2, 2],
    esperado: [
      { level: 0, width: 1024, height: 512, cols: 2, rows: 1 },
      { level: 1, width: 2048, height: 1024, cols: 4, rows: 2 },
      { level: 2, width: 4096, height: 2048, cols: 8, rows: 4 },
    ],
  },
  {
    // O caso que separa razão 2 de razão 3, e o motivo de `razao` ser coluna gravada.
    nome: 'razão 3 produz OUTRA grade com os mesmos width/height/max_level',
    args: [4096, 2048, 512, 3, 1],
    esperado: [
      { level: 0, width: 1365, height: 683, cols: 3, rows: 2 },
      { level: 1, width: 4096, height: 2048, cols: 8, rows: 4 },
    ],
  },
  {
    nome: 'um nível só (a pirâmide desce até um tile)',
    args: [400, 200, 512, 2, 0],
    esperado: [{ level: 0, width: 400, height: 200, cols: 1, rows: 1 }],
  },
  {
    // Teto, não piso: 1025 pixels em tiles de 512 são TRÊS tiles.
    nome: 'sobra de pixel ainda é um tile',
    args: [1025, 513, 512, 2, 0],
    esperado: [{ level: 0, width: 1025, height: 513, cols: 3, rows: 2 }],
  },
  {
    nome: 'razão inválida cai no padrão nos DOIS lados',
    args: [1024, 512, 512, 0, 1],
    esperado: [
      { level: 0, width: 512, height: 256, cols: 1, rows: 1 },
      { level: 1, width: 1024, height: 512, cols: 2, rows: 1 },
    ],
  },
];

describe('a escada do servidor espelha a do cliente', () => {
  it('os casos cobrem as decisões da conta, e não são um punhado ilustrativo', () => {
    // Sem esta linha, um CASOS esvaziado por acidente faria o laço abaixo não asserir
    // nada e o arquivo passaria verde sem comparar uma conta sequer.
    assert.equal(CASOS.length, 6);
  });

  for (const caso of CASOS) {
    it(`${caso.nome}: as duas cópias concordam, e concordam com o número certo`, () => {
      const servidor = doServidor(...caso.args);
      const cliente = doCliente(...caso.args);

      // 1. As duas cópias entre si. Pega a divergência, que é o defeito que este
      //    arquivo existe para impedir.
      assert.deepEqual(servidor, cliente, 'servidor e cliente divergiram');

      // 2. E o valor ABSOLUTO. Pega o caso em que as duas erraram igual, que é o
      //    desfecho provável de a segunda ter nascido copiando a primeira.
      assert.deepEqual(servidor, caso.esperado, 'o servidor diverge do número esperado');
      assert.deepEqual(cliente, caso.esperado, 'o cliente diverge do número esperado');
    });
  }
});
