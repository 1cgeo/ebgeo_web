// Path: tests/unit/sv360-escada.test.js
//
// A ESCADA DA PIRÂMIDE, e por que ela se LÊ do banco em vez de se deduzir.
//
// A regra de parada da escada morava só no código, na origem, e mudá-la reinterpretou em
// silêncio todo o acervo já escrito: 98.854 das 99.035 fotos passaram a ser lidas com uma
// escada diferente da que as produziu. O sintoma não é erro, é tile faltando. Por isso
// `max_level` e `razao` são colunas (migração `012_sv360_piramide.sql`) e por isso `escadaGravada` os RECEBE.
//
// ESTE ARQUIVO EXISTE PORQUE O TESTE DE INTEGRAÇÃO NÃO ALCANÇA A RAZÃO. Medido, não
// suposto: em `sv360-piramide-tiles.test.js` o fixture é 1024x512 com tile 512, e trocar
// a razão de 2 para 3 não muda uma única grade, porque `ceil` achata a diferença nesses
// números — o controle negativo daquele arquivo voltou ZERO vermelhos. Um teste que não
// consegue enxergar o parâmetro errado não está cobrindo o parâmetro. Aqui os números são
// escolhidos para DISCRIMINAR.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { escadaGravada, gradeDoNivel, RAZAO_PADRAO } from '../../src/modules/streetview360/sv360.escada.js';

describe('escadaGravada: a escada sai do que foi gravado', () => {
  it('max_level decide QUANTOS níveis, e o nível 0 é o mais grosso', () => {
    const escada = escadaGravada(1024, 512, 512, 2, 2);
    assert.equal(escada.length, 3, 'max_level 2 são três níveis: 0, 1 e 2');
    assert.deepEqual(escada.map((n) => n.level), [0, 1, 2]);
    // O nativo é o ÚLTIMO, e é o que tem as dimensões originais.
    assert.equal(escada[2].width, 1024);
    assert.equal(escada[2].height, 512);
    assert.equal(escada[0].width, 256, '1024 / 2 / 2');
    assert.equal(escada[0].height, 128);
  });

  it('max_level 0 é uma escada de um degrau só, e ela é válida', () => {
    // Estado normal: a origem desce a pirâmide "até um tile", então uma foto pequena
    // legitimamente tem um nível só. Tratar isso como erro recusaria acervo bom.
    const escada = escadaGravada(400, 200, 512, 2, 0);
    assert.equal(escada.length, 1);
    assert.deepEqual(escada[0], { level: 0, width: 400, height: 200, cols: 1, rows: 1 });
  });

  // O CASO QUE O TESTE DE INTEGRAÇÃO NÃO ENXERGA. Com 4096 de largura e tile 512, a razão
  // muda a CONTAGEM DE COLUNAS do nível intermediário, que é o que decide se o cliente
  // pede um tile que existe ou um que nunca foi gravado.
  it('a RAZÃO muda a grade, e é por isso que ela é coluna e não constante', () => {
    const comDois = escadaGravada(4096, 2048, 512, 2, 1);
    const comTres = escadaGravada(4096, 2048, 512, 3, 1);

    assert.equal(comDois[0].width, 2048);
    assert.equal(comDois[0].cols, 4);

    assert.equal(comTres[0].width, 1365, '4096 / 3, arredondado');
    assert.equal(comTres[0].cols, 3);

    // A asserção que resume o defeito da origem: mesma foto, mesmo max_level, escadas
    // diferentes. Quem reconstruir com a razão errada pede a coluna 3 de um nível que só
    // tem 3 colunas (índices 0..2) e recebe 404.
    assert.notDeepEqual(comDois[0], comTres[0]);
  });

  it('razão ausente ou degenerada cai no padrão em vez de produzir escada impossível', () => {
    // `razao` chegou depois, por ALTER TABLE, então banco antigo pode trazer null. Razão
    // <= 1 não desce a escada nunca: seria laço infinito ou níveis idênticos.
    for (const ruim of [undefined, null, NaN, 0, 1, -2, 'dois']) {
      const escada = escadaGravada(1024, 512, 512, ruim, 1);
      const esperada = escadaGravada(1024, 512, 512, RAZAO_PADRAO, 1);
      assert.deepEqual(escada, esperada, `razao ${String(ruim)} deveria cair no padrão`);
    }
  });

  it('nenhum nível encolhe abaixo de 1 pixel', () => {
    // Com max_level alto e imagem pequena, a divisão sucessiva chegaria a 0 e a grade
    // viraria 0 colunas — um nível que existe no descritor e não tem tile nenhum.
    const escada = escadaGravada(4, 2, 512, 2, 8);
    assert.equal(escada.length, 9, 'max_level 8 são nove níveis; sem esta linha o laço abaixo pode não asserir nada');
    for (const n of escada) {
      assert.ok(n.width >= 1, `nível ${n.level} com largura ${n.width}`);
      assert.ok(n.height >= 1, `nível ${n.level} com altura ${n.height}`);
      assert.ok(n.cols >= 1 && n.rows >= 1, `nível ${n.level} sem tile`);
    }
  });

  it('a grade é o teto da divisão, não o piso: sobra de pixel ainda é um tile', () => {
    // 1025 pixels em tiles de 512 são TRÊS tiles, e o terceiro carrega um pixel. Piso
    // aqui perderia a última coluna da imagem, faixa que só aparece na borda da tela.
    const escada = escadaGravada(1025, 513, 512, 2, 0);
    assert.equal(escada[0].cols, 3);
    assert.equal(escada[0].rows, 2);
  });
});

describe('gradeDoNivel: a conferência que precede o disco', () => {
  const descritor = { width: 1024, height: 512, tileSize: 512, razao: 2, maxLevel: 1 };

  it('devolve a grade de cada nível existente', () => {
    assert.deepEqual(gradeDoNivel(descritor, 0), { colunas: 1, linhas: 1 });
    assert.deepEqual(gradeDoNivel(descritor, 1), { colunas: 2, linhas: 1 });
  });

  it('nível acima de max_level é null, e null significa 404', () => {
    // A distinção entre `null` e grade vazia é o contrato com o controller: `null` é
    // "este nível não existe", nunca "existe e está vazio".
    assert.equal(gradeDoNivel(descritor, 2), null);
    assert.equal(gradeDoNivel(descritor, 99), null);
  });

  it('entrada degenerada é null em vez de exceção', () => {
    // Este predicado roda antes de qualquer leitura, no caminho de uma rota pública:
    // uma exceção aqui vira 500 onde a resposta certa é 404.
    assert.equal(gradeDoNivel(null, 0), null);
    assert.equal(gradeDoNivel(undefined, 0), null);
    assert.equal(gradeDoNivel(descritor, -1), null);
    assert.equal(gradeDoNivel(descritor, 1.5), null);
    assert.equal(gradeDoNivel(descritor, NaN), null);
    assert.equal(gradeDoNivel(descritor, '0'), null, 'string não é nível: o controller converte antes');
  });

  it('descritor sem dimensão utilizável é null', () => {
    assert.equal(gradeDoNivel({ ...descritor, width: 0 }, 0), null);
    assert.equal(gradeDoNivel({ ...descritor, tileSize: 0 }, 0), null);
    assert.equal(gradeDoNivel({ ...descritor, height: NaN }, 0), null);
  });
});
