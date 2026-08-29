// Path: tests/unit/tile-regime-indice.test.js
//
// O ÍNDICE QUE DIZ A QUE LINHA DE CATÁLOGO PERTENCE UM CAMINHO DE TILE, testado sem banco
// e sem Express: `montarIndiceDeTile` é função pura sobre linhas, e `acharEntrada` é o
// casador REAL, chamado por `_internos` em vez de reimplementado aqui. Reimplementar o
// casador no teste é o arranjo em que ele e a própria verificação divergem na mesma
// edição, e o irmão (`assets3d-regime-indice.test.js`) carrega essa lição no cabeçalho.
//
// O QUE ESTE ARQUIVO PRECISA PROVAR, e cada bloco existe para uma das decisões de
// 2026-08-29 registradas n`docs/wiki/tile-privado.md`:
//
//   - endereço de TERCEIRO não entra no índice (decisão 1: só pode ser público);
//   - caminho NÃO REIVINDICADO se distingue do reivindicado (decisão 4: o gate o recusa,
//     invertendo a regra do irmão);
//   - na COLISÃO, a linha privada vence (senão cadastrar uma linha pública homônima
//     abriria qualquer fonte, e o cadastro de catálogo viraria escalação de acesso);
//   - `labelSource` entra, porque é a segunda fonte da mesma linha e é a armadilha que a
//     pendência nomeia;
//   - o basemap entra pelas fontes DENTRO do estilo, nas duas formas (`url` e `tiles[]`);
//   - `tilesets` fica de fora, porque tem índice próprio.
//
// A BASE PÚBLICA É DEFINIDA ANTES DO IMPORT, e não depois: `config` é congelado na
// avaliação do módulo, então definir a variável de ambiente depois do `import` deixaria a
// base vazia e TODOS os casos passariam por vacuidade — o índice ficaria vazio e nada
// casaria. O último caso deste arquivo é justamente a prova de que a base vazia produz
// índice vazio, e ele só é honesto porque os anteriores rodaram com base preenchida.

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

const BASE = 'http://mapas.exemplo.mil.br/tiles';

let montarIndiceDeTile;
let acharEntrada;
let relDeEndereco;
let prefixoDaFonte;

before(async () => {
  process.env.TILE_SERVER_URL = BASE;
  const mod = await import('../../src/modules/nomes/tile-regime.js');
  ({ montarIndiceDeTile, acharEntrada, relDeEndereco, prefixoDaFonte } = mod._internos);
});

/** Uma linha de catálogo, no formato que `SELECT_LINHAS_DE_CATALOGO` devolve. */
function linha(tipo, id, access_level, config) {
  return { tipo, id, access_level, config };
}
function fonteVetor(url) {
  return { source: { url, type: 'vector' } };
}

describe('tile-regime: o endereço vira caminho', () => {
  it('aceita a absoluta sob a base configurada', () => {
    assert.equal(relDeEndereco(`${BASE}/rodovias`), 'rodovias');
    assert.equal(relDeEndereco(`${BASE}/dem/{z}/{x}/{y}.png`), 'dem/{z}/{x}/{y}.png');
  });

  it('aceita a relativa, com e sem o caminho da base', () => {
    assert.equal(relDeEndereco('/tiles/rodovias'), 'rodovias');
    assert.equal(relDeEndereco('/rodovias'), 'rodovias');
  });

  it('RECUSA a absoluta de outra origem — decisão 1', () => {
    // A regra de produto é "URL de terceiro só pode ser pública". Aqui ela aparece como
    // ausência de entrada: sem entrada, o gate não tem o que decidir sobre um servidor
    // que não é nosso.
    assert.equal(relDeEndereco('https://tiles.exemplo.gov.br/dados/malha'), null);
    assert.equal(relDeEndereco('//outro.host/tiles/rodovias'), null);
    assert.equal(relDeEndereco('http://mapas.exemplo.mil.br.evil.com/tiles/x'), null);
  });

  it('recusa o vazio, o não-texto e a própria base', () => {
    assert.equal(relDeEndereco(''), null);
    assert.equal(relDeEndereco(null), null);
    assert.equal(relDeEndereco(42), null);
    assert.equal(relDeEndereco(BASE), null);
  });
});

describe('tile-regime: o prefixo identifica a fonte', () => {
  it('corta no primeiro segmento com marcador', () => {
    assert.equal(prefixoDaFonte('dem/{z}/{x}/{y}.png'), 'dem');
    assert.equal(prefixoDaFonte('carta/restrita/{z}/{x}/{y}.png'), 'carta/restrita');
  });

  it('sem marcador, o prefixo é o caminho inteiro (o documento TileJSON)', () => {
    assert.equal(prefixoDaFonte('rodovias'), 'rodovias');
  });

  it('um caminho que é só marcador não identifica fonte nenhuma', () => {
    assert.equal(prefixoDaFonte('{z}/{x}/{y}.png'), null);
  });
});

describe('tile-regime: o índice', () => {
  it('casa o TileJSON e os tiles da MESMA fonte na mesma entrada', () => {
    const indice = montarIndiceDeTile([
      linha('data_layer', 't-hidrografia', 'public', fonteVetor(`${BASE}/hidrografia`)),
    ]);
    // O documento e o tile são o mesmo recurso; um gate que casasse só o primeiro
    // recusaria o documento e liberaria os bytes, que é o pior dos dois desfechos.
    assert.equal(acharEntrada(indice, 'hidrografia')?.resourceId, 't-hidrografia');
    assert.equal(acharEntrada(indice, 'hidrografia/10/385/577')?.resourceId, 't-hidrografia');
  });

  it('distingue o caminho NÃO REIVINDICADO — decisão 4', () => {
    const indice = montarIndiceDeTile([
      linha('data_layer', 't-hidrografia', 'public', fonteVetor(`${BASE}/hidrografia`)),
    ]);
    // `null` aqui é o que o gate lê como RECUSA, invertendo a regra do irmão. O índice
    // não decide isso; ele só precisa saber dizer que não conhece.
    assert.equal(acharEntrada(indice, 'fonte_orfa'), null);
    assert.equal(acharEntrada(indice, 'helipotros'), null);
    // E não pode casar por ser PREFIXO de outro nome: `hidro` não é `hidrografia`.
    assert.equal(acharEntrada(indice, 'hidro'), null);
    assert.equal(acharEntrada(indice, 'hidrografia_2'), null);
  });

  it('carrega o regime e a identidade da linha privada', () => {
    const indice = montarIndiceDeTile([
      linha('data_layer', 't-areas', 'private', fonteVetor(`${BASE}/areas_treinamento`)),
    ]);
    const achada = acharEntrada(indice, 'areas_treinamento/10/385/577');
    assert.equal(achada.privado, true);
    assert.equal(achada.tipo, 'data_layer');
    assert.equal(achada.resourceId, 't-areas');
  });

  it('na COLISÃO, a linha PRIVADA vence', () => {
    // Duas linhas para a mesma fonte. Se a pública vencesse, bastaria cadastrar uma linha
    // pública homônima para abrir qualquer fonte privada.
    const indice = montarIndiceDeTile([
      linha('data_layer', 't-dutos-publico', 'public', fonteVetor(`${BASE}/dutos`)),
      linha('data_layer', 't-dutos-privado', 'private', fonteVetor(`${BASE}/dutos`)),
    ]);
    const achada = acharEntrada(indice, 'dutos');
    assert.equal(achada.privado, true);
    assert.equal(achada.resourceId, 't-dutos-privado');
  });

  it('a colisão vence nas DUAS ordens de entrada', () => {
    // Sem esta asserção, o caso acima passaria por acidente de ordenação da entrada.
    const indice = montarIndiceDeTile([
      linha('data_layer', 't-dutos-privado', 'private', fonteVetor(`${BASE}/dutos`)),
      linha('data_layer', 't-dutos-publico', 'public', fonteVetor(`${BASE}/dutos`)),
    ]);
    assert.equal(acharEntrada(indice, 'dutos').privado, true);
  });

  it('o `labelSource` entra, e é uma entrada PRÓPRIA', () => {
    // A armadilha nomeada na pendência: quem fechar só `source` deixa a irmã aberta.
    const indice = montarIndiceDeTile([
      linha('data_layer', 't-curvas', 'private', {
        source: { url: `${BASE}/curvas_nivel`, type: 'vector' },
        labelSource: { url: `${BASE}/pontos_cotados`, type: 'vector' },
      }),
    ]);
    assert.equal(acharEntrada(indice, 'curvas_nivel')?.privado, true);
    assert.equal(acharEntrada(indice, 'pontos_cotados')?.privado, true);
    assert.equal(acharEntrada(indice, 'pontos_cotados')?.resourceId, 't-curvas');
  });

  it('a análise raster entra pelo template de `source.url`', () => {
    const indice = montarIndiceDeTile([
      linha('analysis_layer', 't-relevo', 'private', {
        source: { url: `${BASE}/dem-restrito/{z}/{x}/{y}.png`, type: 'raster-dem' },
      }),
    ]);
    assert.equal(acharEntrada(indice, 'dem-restrito/10/385/577.png')?.privado, true);
  });

  it('o basemap entra pelas fontes DENTRO do estilo, nas duas formas', () => {
    // `tiles[]` e `url` são as duas formas que uma fonte MapLibre usa, e o estilo pode
    // carregar N fontes. Ler um campo em vez de descer no objeto perderia todas.
    const indice = montarIndiceDeTile([
      linha('basemap', 't-carta', 'private', {
        style: {
          version: 8,
          sources: {
            carta: { type: 'raster', tiles: [`${BASE}/carta-restrita/{z}/{x}/{y}.png`] },
            rotulos: { type: 'vector', url: `${BASE}/rotulos-restritos` },
          },
        },
      }),
    ]);
    assert.equal(acharEntrada(indice, 'carta-restrita/3/4/5.png')?.privado, true);
    assert.equal(acharEntrada(indice, 'rotulos-restritos')?.privado, true);
  });

  it('`tilesets` fica de fora: aquele acervo tem índice próprio', () => {
    const indice = montarIndiceDeTile([
      linha('tileset', 'PCL', 'private', { url: '/api/v1/assets3d/PCL/tileset.json' }),
    ]);
    assert.deepEqual(indice, []);
  });

  it('endereço de terceiro não vira entrada, mesmo em linha privada', () => {
    const indice = montarIndiceDeTile([
      linha('data_layer', 't-terceiro', 'private', fonteVetor('https://tiles.exemplo.gov.br/dados/malha')),
    ]);
    assert.deepEqual(indice, []);
  });

  it('a MAIS ESPECÍFICA vence quando uma fonte mora sob a outra', () => {
    const indice = montarIndiceDeTile([
      linha('data_layer', 't-raiz', 'public', fonteVetor(`${BASE}/carta`)),
      linha('data_layer', 't-filha', 'private', fonteVetor(`${BASE}/carta/restrita`)),
    ]);
    assert.equal(acharEntrada(indice, 'carta/restrita/1/2/3')?.resourceId, 't-filha');
    assert.equal(acharEntrada(indice, 'carta/aberta/1/2/3')?.resourceId, 't-raiz');
  });

  it('linha sem endereço nenhum não planta entrada', () => {
    const indice = montarIndiceDeTile([
      linha('data_layer', 't-vazia', 'private', {}),
      linha('analysis_layer', 't-sem-config', 'private', null),
    ]);
    assert.deepEqual(indice, []);
  });
});
