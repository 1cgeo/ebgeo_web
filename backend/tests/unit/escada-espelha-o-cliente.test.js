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
//
// A TERCEIRA CÓPIA, E O FURO QUE ELA ABRIA. O trecho que numera a escada e conta a grade
// existia TRÊS vezes, byte a byte: em `escadaGravada` dos dois lados e, no cliente,
// também dentro de `montarEscada`. Este arquivo só amarra `escadaGravada`, então editar a
// cópia de `montarEscada` não deixava nada vermelho — medido. O conserto foi eliminar a
// terceira: no cliente as duas funções chamam agora a mesma `numerarEscada`, então o que
// este guarda cobre passou a ser o que o gerador de escada do cliente também usa.
//
// A COBERTURA NÃO É SIMÉTRICA, e o segundo describe é onde ela deixa de ser. O servidor
// tem `gradeDoNivel`, que decide o 404 ANTES de abrir o SQLite, e o cliente não tem par
// para ela: quem não pede tile nenhum não precisa de predicado de faixa. Dar um par ao
// cliente criaria uma quarta cópia sem consumidor, que derivaria sozinha. Então a
// paridade aqui se mede pelo que as duas pontas PRECISAM concordar: a faixa que o
// servidor aceita tem de ser exatamente a que o cliente pede.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  escadaGravada as doServidor,
  gradeDoNivel,
} from '../../src/modules/streetview360/sv360.escada.js';
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

/**
 * O descritor que a rota do tile monta, a partir dos argumentos de um caso.
 * @param {number[]} args - `[width, height, tileSize, razao, maxLevel]`.
 * @returns {{width:number,height:number,tileSize:number,razao:number,maxLevel:number}}
 */
function descritorDe([width, height, tileSize, razao, maxLevel]) {
  return { width, height, tileSize, razao, maxLevel };
}

describe('a faixa que o servidor aceita é a que o cliente pede', () => {
  // POR QUE ESTE DESCRIBE EXISTE. `gradeDoNivel` é o predicado que responde 404 antes de
  // tocar o disco, e ele não tem par no cliente. Se ele apertar mais que a escada do
  // cliente, o cliente pede um tile gravado e leva 404: buraco na tela, log limpo. Se
  // afrouxar, um nível fora da escada custa uma leitura de disco por pedido. A asserção é
  // ABSOLUTA nos dois sentidos: contra a grade do cliente e contra o número esperado.

  for (const caso of CASOS) {
    it(`${caso.nome}: a grade de cada nível bate com a do cliente`, () => {
      const descritor = descritorDe(caso.args);
      const cliente = doCliente(...caso.args);

      // Sem esta linha, um `esperado` vazio faria o laço abaixo não asserir nada.
      assert.equal(cliente.length, caso.esperado.length);

      for (const nivel of caso.esperado) {
        const grade = gradeDoNivel(descritor, nivel.level);
        assert.deepEqual(
          grade,
          { colunas: nivel.cols, linhas: nivel.rows },
          `nível ${nivel.level} diverge do número esperado`
        );
        assert.deepEqual(
          grade,
          { colunas: cliente[nivel.level].cols, linhas: cliente[nivel.level].rows },
          `nível ${nivel.level}: o servidor aceita faixa diferente da que o cliente pede`
        );
      }
    });

    it(`${caso.nome}: o primeiro nível ACIMA da escada é 404`, () => {
      // O LIMITE `level > maxLevel`, medido no caso concreto e não no genérico. O cliente
      // nunca pede este nível, porque a escada dele acaba antes; o servidor tem de
      // recusá-lo mesmo assim, senão um varredor compra leitura de disco de graça.
      const descritor = descritorDe(caso.args);
      const acima = caso.esperado.length;
      assert.equal(doCliente(...caso.args)[acima], undefined, 'a escada do cliente acaba aqui');
      assert.equal(gradeDoNivel(descritor, acima), null);
    });
  }

  it('null é "não existe", nunca uma grade vazia', () => {
    // A DISTINÇÃO QUE O CONTROLLER CONSOME. Ele faz `if (!grade || x >= grade.colunas)`:
    // uma grade de zero colunas passaria pelo primeiro teste e barraria no segundo, o que
    // por acaso dá o mesmo 404 hoje — e deixaria de dar no dia em que a checagem mudasse.
    // Então o contrato se assere aqui: fora da escada é `null` literal, e dentro dela
    // nenhum nível tem zero coluna ou zero linha.
    const descritor = { width: 1024, height: 512, tileSize: 512, razao: 2, maxLevel: 1 };
    assert.equal(gradeDoNivel(descritor, 2), null);
    assert.equal(gradeDoNivel(descritor, 99), null);

    for (const caso of CASOS) {
      // O TAMANHO ANTES DO LAÇO, pela mesma razão do meta-teste de `CASOS.length`: um
      // `esperado` vazio faria este bloco não asserir NADA e ficar verde. A regra
      // `ebgeo-tests/no-unasserted-loop-assert` reprova o laço sem esta linha.
      assert.ok(caso.esperado.length > 0, `${caso.nome}: caso sem nível a conferir`);
      for (const nivel of caso.esperado) {
        const grade = gradeDoNivel(descritorDe(caso.args), nivel.level);
        assert.ok(grade.colunas >= 1 && grade.linhas >= 1, `${caso.nome}: nível sem tile`);
      }
    }
  });

  it('dimensão não positiva é null, e zero é um número perfeitamente finito', () => {
    // O LIMITE `!(width > 0)`, e a razão de ele ser `> 0` e não `Number.isFinite`: zero
    // passa em qualquer teste de finitude e produziria uma grade de zero colunas, um
    // nível que o descritor anuncia e que não tem tile nenhum. O CHECK da migração
    // `007_sv360.sql` impede isso no banco; esta guarda vale para o descritor
    // que chegar por outro caminho.
    const descritor = { width: 1024, height: 512, tileSize: 512, razao: 2, maxLevel: 1 };
    for (const campo of ['width', 'height', 'tileSize']) {
      for (const ruim of [0, -1, NaN, undefined, null]) {
        assert.equal(
          gradeDoNivel({ ...descritor, [campo]: ruim }, 0),
          null,
          `${campo} = ${String(ruim)} deveria ser null`
        );
      }
    }
  });

  it('descritor ausente ou nível não inteiro é null, e não exceção', () => {
    // Este predicado roda no caminho de uma rota pública: uma exceção aqui vira 500 onde
    // a resposta certa é 404.
    const descritor = { width: 1024, height: 512, tileSize: 512, razao: 2, maxLevel: 1 };
    assert.equal(gradeDoNivel(null, 0), null);
    assert.equal(gradeDoNivel(undefined, 0), null);
    assert.equal(gradeDoNivel(descritor, -1), null);
    assert.equal(gradeDoNivel(descritor, 1.5), null);
    assert.equal(gradeDoNivel(descritor, NaN), null);
    assert.equal(gradeDoNivel(descritor, '0'), null, 'string não é nível: o controller converte antes');
  });
});
