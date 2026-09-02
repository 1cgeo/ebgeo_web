// Path: tests/unit/diag-cli-mapa-de-fonte.test.js
//
// O decodificador de source map de `npm run diag -- pilha` (`scripts/diag/mapa-de-fonte.js`),
// que existe para que o comando NÃO ganhe uma dependência (ver o cabeçalho daquele arquivo).
//
// A FIXTURE É ESCRITA À MÃO, e é o ponto inteiro deste arquivo. O `mappings` abaixo é uma
// STRING LITERAL, montada caractere a caractere a partir das regras do formato, com as
// respostas calculadas fora do código que está sendo testado. A alternativa natural (gerar o
// `mappings` com o meu próprio codificador e conferir que o meu decodificador o lê de volta)
// é cobertura vazia da pior espécie: ela passa verde com as DUAS metades erradas do mesmo
// jeito, e é exatamente assim que um erro de convenção de base sobrevive.
//
// O codificador do fim do arquivo existe, mas para outra pergunta: ele alimenta a propriedade
// de ida e volta sobre o VLQ, que é onde o sinal no bit menos significativo e o bit de
// continuação se escondem. Ele nunca produz a fixture.
//
// CONTROLE NEGATIVO (conferido revertendo cada um):
//   - zerar `fonte`/`linhaOriginal`/`colunaOriginal`/`nome` a cada `;` (o erro clássico: só a
//     coluna gerada reinicia) e cai o caso da segunda linha gerada;
//   - trocar a busca por igualdade exata em vez de "maior menor ou igual" e caem os três
//     casos de coluna no MEIO de um segmento, que são a maioria de uma pilha real;
//   - devolver o segmento anterior quando o achado tem um campo só e cai o caso do trecho sem
//     origem, que é onde se inventa uma fonte;
//   - tirar o `magnitude !== 0` do sinal e o `-0` volta a escapar do decodificador;
//   - somar 1 à coluna original na saída (ou não somar 1 à linha) e caem todos os casos com
//     número absoluto, que é a razão de eles serem absolutos.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  decodificarVlq, decodificarMappings, indiceDoSegmento, resolver,
} from '../../scripts/diag/mapa-de-fonte.js';

/**
 * A fixture, com a conta de cada segmento escrita ao lado.
 *
 * Linha gerada 1: `AAAAA,UAIE,oBCKIC,oB`
 *   AAAAA  -> [0,0,0,0,0]      col 0,  fonte 0 (alfa), linha 0, col 0, nome 0 (iniciar)
 *   UAIE   -> [10,0,4,2]       col 10, fonte 0 (alfa), linha 4, col 2, sem nome
 *   oBCKIC -> [20,1,5,4,1]     col 30, fonte 1 (beta), linha 9, col 6, nome 1 (parar)
 *   oB     -> [20]             col 50, SEM origem (um campo só)
 * Linha gerada 2: `IAGND`
 *   IAGND  -> [4,0,3,-6,-1]    col 4,  fonte 1 (beta), linha 12, col 0, nome 0 (iniciar)
 * Linha gerada 3: vazia (o `;` final).
 *
 * As conversões usadas, todas de cabeça e conferíveis: n>=0 vira n<<1, n<0 vira (-n<<1)|1, e
 * o resultado é escrito em base64 de cinco bits com o sexto ligado enquanto houver mais.
 * 0->A, 1->C, 2->E, 3->G, 4->I, 5->K, 10->U, 20->'oB', -1->D, -6->N.
 */
const MAPA = Object.freeze({
  version: 3,
  file: 'core-Ab12Cd34.js',
  sources: ['../../src/js/alfa.js', '../../src/js/beta.js'],
  names: ['iniciar', 'parar'],
  mappings: 'AAAAA,UAIE,oBCKIC,oB;IAGND;',
});

describe('mapa-de-fonte: VLQ base64', () => {
  it('decodifica os números da fixture, com sinal e com continuação', () => {
    assert.deepEqual(decodificarVlq('AAAAA'), [0, 0, 0, 0, 0]);
    assert.deepEqual(decodificarVlq('UAIE'), [10, 0, 4, 2]);
    assert.deepEqual(decodificarVlq('oBCKIC'), [20, 1, 5, 4, 1]);
    assert.deepEqual(decodificarVlq('IAGND'), [4, 0, 3, -6, -1]);
  });

  it('o sinal é o bit MENOS significativo, não um caractere à parte', () => {
    // `C` e `D` são valores base64 vizinhos (2 e 3) e significam 1 e -1: é o par que quebra
    // qualquer decodificador que tente ler o sinal em outro lugar.
    assert.deepEqual(decodificarVlq('C'), [1]);
    assert.deepEqual(decodificarVlq('D'), [-1]);
  });

  it('`-0` é representável no formato e sai como `0`, não como `-0`', () => {
    // `B` é o valor 1, ou seja, magnitude zero com o bit de sinal ligado. Deixar `-0`
    // escapar faz uma comparação estrita reprovar por uma diferença que não existe no
    // domínio de um delta.
    const [zero] = decodificarVlq('B');
    assert.equal(Object.is(zero, -0), false);
    assert.equal(zero, 0);
  });

  it('decodifica ALÉM dos 32 bits com sinal, que é onde `<<` mente calado', () => {
    // `2 ** 31` cabe num source map legítimo (uma coluna gerada gigante, um delta grande) e
    // é o primeiro valor em que `(v & 31) << deslocamento` estoura o inteiro COM SINAL do
    // JavaScript e devolve um NEGATIVO. Nada lança: o mapa passa a apontar para uma linha
    // anterior, plausível e errada. Os números abaixo são absolutos de propósito.
    assert.deepEqual(decodificarVlq(codificarVlq(2 ** 31)), [2 ** 31]);
    assert.deepEqual(decodificarVlq(codificarVlq(-(2 ** 31))), [-(2 ** 31)]);
    assert.deepEqual(decodificarVlq(codificarVlq(2 ** 30)), [2 ** 30]);
    // E o sinal continua vindo do bit menos significativo lá em cima, não de `& 1` sobre um
    // valor truncado: `2 ** 31` positivo e negativo diferem só nele.
    assert.notEqual(codificarVlq(2 ** 31), codificarVlq(-(2 ** 31)));
  });

  it('RECUSA o número longo demais em vez de somar um valor que não está no arquivo', () => {
    // Oito grupos de cinco bits não são número grande, são `mappings` corrompido. Continuar
    // somando produziria um valor que ninguém escreveu, e a pilha sairia deslocada.
    const longo = 'ggggggggB';
    assert.throws(() => decodificarVlq(longo), /longo demais/);
  });

  it('recusa caractere fora do alfabeto em vez de pular o lixo', () => {
    // Pular produziria um mapeamento deslocado em silêncio, que é uma pilha plausível e
    // errada. Um `.map` truncado ou uma página de erro servida no lugar dele cai aqui.
    assert.throws(() => decodificarVlq('AA*AA'), /fora do alfabeto/);

    // E ela NÃO cita o byte lido, só a posição. O `.map` é apontado pelo operador e o
    // endereço que levou até ele veio de uma pilha escrita por uma rota anônima: um byte do
    // arquivo dentro da mensagem de erro é um canal de leitura, estreito mas real.
    assert.throws(() => decodificarVlq('AA*AA'), (err) => {
      assert.equal(err.message.includes('*'), false, `a mensagem ecoou o byte: ${err.message}`);
      assert.match(err.message, /posição 2/);
      return true;
    });
  });

  it('recusa um número que termina com o bit de continuação pendente', () => {
    assert.throws(() => decodificarVlq('g'), /continuação pendente/);
  });

  it('ida e volta do meu próprio codificador, sobre uma faixa que cobre os dois sinais', () => {
    // Esta é a única parte do arquivo em que o codificador aparece, e ele NÃO produz a
    // fixture: aqui a pergunta é só se o decodificador é inverso de uma implementação
    // independente das regras, incluindo os valores que cruzam a fronteira de cinco bits
    // (16 é o primeiro que precisa de dois caracteres) e os negativos.
    const valores = [
      0, 1, -1, 2, -2, 15, 16, -16, 17, 31, 32, -32, 511, 512, -512, 1023, 65535, -65535,
      1 << 20, -(1 << 20), 23456, -23456,
    ];
    assert.equal(valores.length, 22);
    for (const v of valores) {
      assert.deepEqual(decodificarVlq(codificarVlq(v)), [v], `ida e volta de ${v}`);
    }
    // E em SEGMENTO, com vários números colados, que é a forma em que eles aparecem de fato.
    const segmento = valores.map(codificarVlq).join('');
    assert.deepEqual(decodificarVlq(segmento), valores);
  });
});

describe('mapa-de-fonte: decodificarMappings', () => {
  it('a coluna gerada REINICIA a cada linha e os outros quatro ACUMULAM', () => {
    const linhas = decodificarMappings(MAPA.mappings);
    assert.equal(linhas.length, 3);
    assert.equal(linhas[0].length, 4);
    assert.equal(linhas[1].length, 1);
    assert.equal(linhas[2].length, 0);

    assert.deepEqual(linhas[0].map((s) => s.colunaGerada), [0, 10, 30, 50]);
    // A segunda linha gerada recomeça do zero na coluna (4, e não 54)...
    assert.equal(linhas[1][0].colunaGerada, 4);
    // ...enquanto fonte, linha e nome continuam de onde a primeira parou: o segmento carrega
    // fonte 1 sem repetir o `+1`, linha 12 (9 + 3) e nome 0 (1 - 1).
    assert.deepEqual(linhas[1][0], {
      colunaGerada: 4, indiceDaFonte: 1, linhaOriginal: 12, colunaOriginal: 0, indiceDoNome: 0,
    });
  });

  it('segmento de UM campo entra na lista, com origem nula', () => {
    const linhas = decodificarMappings(MAPA.mappings);
    assert.deepEqual(linhas[0][3], {
      colunaGerada: 50, indiceDaFonte: null, linhaOriginal: null, colunaOriginal: null, indiceDoNome: null,
    });
  });

  it('recusa segmento com número de campos que a especificação não admite', () => {
    // Dois campos (`AA`) não existem no formato; aceitar produziria valores acumulados fora
    // de lugar em todos os segmentos seguintes da mesma linha.
    assert.throws(() => decodificarMappings('AA'), /admite 1, 4 ou 5/);
  });
});

describe('mapa-de-fonte: indiceDoSegmento (o maior menor ou igual)', () => {
  const segmentos = [{ colunaGerada: 0 }, { colunaGerada: 10 }, { colunaGerada: 30 }, { colunaGerada: 50 }];

  it('acha o segmento que COMEÇA em cada coluna exata', () => {
    assert.equal(indiceDoSegmento(segmentos, 0), 0);
    assert.equal(indiceDoSegmento(segmentos, 10), 1);
    assert.equal(indiceDoSegmento(segmentos, 30), 2);
    assert.equal(indiceDoSegmento(segmentos, 50), 3);
  });

  it('no MEIO de um segmento devolve o segmento que o contém, não o seguinte', () => {
    assert.equal(indiceDoSegmento(segmentos, 1), 0);
    assert.equal(indiceDoSegmento(segmentos, 9), 0);
    assert.equal(indiceDoSegmento(segmentos, 29), 1);
    assert.equal(indiceDoSegmento(segmentos, 999_999), 3);
  });

  it('coluna anterior a TODOS devolve -1, e não o primeiro', () => {
    assert.equal(indiceDoSegmento([{ colunaGerada: 4 }], 0), -1);
    assert.equal(indiceDoSegmento([], 0), -1);
  });
});

describe('mapa-de-fonte: resolver', () => {
  it('a posição exata do primeiro segmento, com nome', () => {
    assert.deepEqual(resolver(MAPA, { linha: 1, coluna: 0 }), {
      fonte: '../../src/js/alfa.js', linha: 1, coluna: 0, nome: 'iniciar',
    });
  });

  it('uma posição no MEIO do primeiro segmento cai nele, e não no seguinte', () => {
    assert.deepEqual(resolver(MAPA, { linha: 1, coluna: 5 }), {
      fonte: '../../src/js/alfa.js', linha: 1, coluna: 0, nome: 'iniciar',
    });
  });

  it('segmento de quatro campos resolve com `nome` nulo, e não com o nome anterior', () => {
    // A linha 5 é `linhaOriginal` 4 mais um: é aqui que a convenção de base aparece em
    // número absoluto, e um `+1` a mais ou a menos derruba este caso.
    assert.deepEqual(resolver(MAPA, { linha: 1, coluna: 10 }), {
      fonte: '../../src/js/alfa.js', linha: 5, coluna: 2, nome: null,
    });
    assert.deepEqual(resolver(MAPA, { linha: 1, coluna: 29 }), {
      fonte: '../../src/js/alfa.js', linha: 5, coluna: 2, nome: null,
    });
  });

  it('troca de fonte e de nome no terceiro segmento', () => {
    assert.deepEqual(resolver(MAPA, { linha: 1, coluna: 31 }), {
      fonte: '../../src/js/beta.js', linha: 10, coluna: 6, nome: 'parar',
    });
  });

  it('trecho SEM origem (segmento de um campo) devolve null, e não a fonte do vizinho', () => {
    // Este é o caso em que se inventa uma origem: o segmento anterior tem fonte, e "aproveitar"
    // devolveria `beta.js:10:6` para um preâmbulo de bundler.
    assert.equal(resolver(MAPA, { linha: 1, coluna: 50 }), null);
    assert.equal(resolver(MAPA, { linha: 1, coluna: 9_999 }), null);
  });

  it('a segunda linha gerada resolve com o estado ACUMULADO da primeira', () => {
    assert.deepEqual(resolver(MAPA, { linha: 2, coluna: 4 }), {
      fonte: '../../src/js/beta.js', linha: 13, coluna: 0, nome: 'iniciar',
    });
  });

  it('as TRÊS causas de não resolver devolvem null', () => {
    // Coluna anterior ao primeiro segmento da linha...
    assert.equal(resolver(MAPA, { linha: 2, coluna: 0 }), null);
    // ...linha sem segmento nenhum...
    assert.equal(resolver(MAPA, { linha: 3, coluna: 0 }), null);
    // ...e linha fora do mapa.
    assert.equal(resolver(MAPA, { linha: 9, coluna: 0 }), null);
  });

  it('posição malformada devolve null em vez de lançar', () => {
    assert.equal(resolver(MAPA, { linha: 0, coluna: 0 }), null);
    assert.equal(resolver(MAPA, { linha: 1, coluna: -1 }), null);
    assert.equal(resolver(MAPA, { linha: 1.5, coluna: 0 }), null);
    assert.equal(resolver(MAPA, { linha: NaN, coluna: 0 }), null);
    assert.equal(resolver(MAPA, { linha: 1, coluna: NaN }), null);
  });

  it('`sourceRoot` é concatenado quando existe, sem duplicar a barra', () => {
    const comRaiz = { ...MAPA, sourceRoot: 'https://ebgeo/fonte/' };
    assert.equal(resolver(comRaiz, { linha: 1, coluna: 0 }).fonte, 'https://ebgeo/fonte/../../src/js/alfa.js');
  });

  it('mapa INDEXADO é recusado POR NOME, e não como corrupção genérica', () => {
    // `sections` é um formato legítimo da mesma versão 3. Um erro genérico mandaria o
    // operador procurar arquivo corrompido onde há formato não suportado.
    assert.throws(
      () => resolver({ version: 3, sections: [] }, { linha: 1, coluna: 0 }),
      /INDEXADO/
    );
  });

  it('recusa mapa de outra versão, sem mappings e sem sources, SEM citar o conteúdo', () => {
    // A mensagem diz que a versão não é 3 e não diz QUAL é: `version` é um campo lido do
    // arquivo, e a saída deste comando acaba colada em relatório.
    assert.throws(
      () => resolver({ version: '<script>', mappings: '', sources: [] }, { linha: 1, coluna: 0 }),
      (err) => {
        assert.equal(err.message.includes('<script>'), false, `ecoou o conteúdo: ${err.message}`);
        assert.match(err.message, /versão diferente de 3/);
        return true;
      }
    );
    assert.throws(() => resolver({ version: 2, mappings: '', sources: [] }, { linha: 1, coluna: 0 }), /versão diferente de 3/);
    assert.throws(() => resolver({ version: 3, sources: [] }, { linha: 1, coluna: 0 }), /`mappings`/);
    assert.throws(() => resolver({ version: 3, mappings: '' }, { linha: 1, coluna: 0 }), /`sources`/);
  });

  it('o mesmo mapa resolvido duas vezes devolve o mesmo resultado (o cache não corrompe)', () => {
    // `resolver` memoiza o decodificado por objeto de mapa; um cache que guardasse estado
    // mutável (os acumuladores, por exemplo) daria respostas diferentes na segunda chamada.
    const primeira = resolver(MAPA, { linha: 1, coluna: 31 });
    const segunda = resolver(MAPA, { linha: 1, coluna: 31 });
    assert.deepEqual(segunda, primeira);
    assert.deepEqual(resolver(MAPA, { linha: 2, coluna: 4 }), {
      fonte: '../../src/js/beta.js', linha: 13, coluna: 0, nome: 'iniciar',
    });
  });
});

/**
 * Um codificador VLQ base64 MÍNIMO, que existe só para a propriedade de ida e volta.
 *
 * Ele mora no teste, e não no código, porque o produto não codifica source map nenhum: ele só
 * lê. Código de produção escrito para servir a um teste é a forma mais cara de cobertura
 * vazia, porque ele passa a ter de ser mantido sem ter usuário.
 */
function codificarVlq(numero) {
  const ALFABETO = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  // Aritmética de ponto flutuante, pela mesma razão do decodificador: `<< 1` sobre `2 ** 31`
  // devolveria um negativo, e o teste que existe para pegar esse defeito o teria dos dois
  // lados, casando erro com erro e passando verde.
  let valor = numero < 0 ? (-numero) * 2 + 1 : numero * 2;
  let texto = '';
  do {
    let pedaco = valor % 32;
    valor = Math.floor(valor / 32);
    if (valor > 0) pedaco += 32;
    texto += ALFABETO[pedaco];
  } while (valor > 0);
  return texto;
}
