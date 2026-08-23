// Path: tests/unit/models3d-service.test.js
// The pure half of serving a converted 3D model: how a path becomes (model, key), what
// a key's content type is, and what its ETag is. No database, no file, no app.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parsePedidoDeModelo,
  computeTileETag,
  tipoDe,
  ehDocumento,
  PREFIXO_MODELO,
  normalizeKey,
} from '../../src/modules/models3d/models3d.service.js';

describe('models3d — endereçamento do pedido', () => {
  it('separa modelo e chave sob o prefixo reservado', () => {
    assert.deepEqual(parsePedidoDeModelo('m/ponte_quatis/tileset.json'), {
      id: 'ponte_quatis',
      chave: 'tileset.json',
    });
    assert.deepEqual(parsePedidoDeModelo('m/silo-tex512/Data/d000/c00.glb'), {
      id: 'silo-tex512',
      chave: 'Data/d000/c00.glb',
    });
  });

  it('devolve null para todo caminho que NÃO é de modelo', () => {
    // Estes três são o acervo que já existia na rota, e a camada nova não pode
    // capturá-los: PCL/ é a árvore crua do store plano, primeira-pessoa/ é a cena.
    assert.equal(parsePedidoDeModelo('PCL/Data/a.b3dm'), null);
    assert.equal(parsePedidoDeModelo('primeira-pessoa/museu-1cgeo/cena.sog'), null);
    assert.equal(parsePedidoDeModelo('models/x.glb'), null);
    // Prefixo sem modelo, e modelo sem chave: nenhum dos dois endereça bytes.
    assert.equal(parsePedidoDeModelo('m/'), null);
    assert.equal(parsePedidoDeModelo('m/ponte_quatis'), null);
  });

  it('recusa um id de modelo que não é um slug', () => {
    // O id vira `path.basename` do db_filename mais adiante, mas a recusa acontece
    // aqui: um id com barra ou espaço nunca chega a virar caminho.
    assert.equal(parsePedidoDeModelo('m/../etc/passwd'), null);
    assert.equal(parsePedidoDeModelo('m/a b/tileset.json'), null);
  });

  it('reconhece o pedido mas recusa a chave, para 400 em vez de cair no store plano', () => {
    // A distinção importa: um caminho que NOMEIA um modelo pertence a esta camada, e
    // deixá-lo cair para o store plano devolveria 404 pelo motivo errado.
    assert.deepEqual(parsePedidoDeModelo('m/quatis/../fora.glb'), { id: 'quatis', chave: null });
  });

  it('o prefixo é o que a URL do catálogo publica', () => {
    assert.equal(PREFIXO_MODELO, 'm/');
  });
});

describe('models3d — higiene de chave', () => {
  it('normaliza barra invertida e barra inicial', () => {
    assert.equal(normalizeKey('/Data\\d000\\c00.glb'), 'Data/d000/c00.glb');
  });

  it('recusa vazio, NUL e travessia', () => {
    assert.equal(normalizeKey(''), null);
    assert.equal(normalizeKey('a/\u0000b'), null);
    assert.equal(normalizeKey('a/../b.glb'), null);
    assert.equal(normalizeKey('./b.glb'), null);
  });

  it('NÃO decodifica de novo: o percento literal sobrevive', () => {
    // Express já decodificou o curinga. Um segundo decode acha escape malformado em
    // "Data/100%.glb" e 400 num arquivo que existe.
    assert.equal(normalizeKey('Data/100%.glb'), 'Data/100%.glb');
  });
});

describe('models3d — tipo e regime do conteúdo', () => {
  it('dá o tipo IANA ao glb e ao ktx2', () => {
    assert.equal(tipoDe('Data/c00.glb'), 'model/gltf-binary');
    assert.equal(tipoDe('Data/t.ktx2'), 'image/ktx2');
    assert.match(tipoDe('tileset.json'), /^application\/json/);
  });

  it('cai em octet-stream para o desconhecido e para chave sem extensão', () => {
    assert.equal(tipoDe('Data/c00.xyz'), 'application/octet-stream');
    assert.equal(tipoDe('semextensao'), 'application/octet-stream');
  });

  it('só o .json é documento, e é ele que não pode ser immutable', () => {
    assert.equal(ehDocumento('tileset.json'), true);
    assert.equal(ehDocumento('Data/d000/tileset.JSON'), true);
    assert.equal(ehDocumento('Data/c00.glb'), false);
  });
});

describe('models3d — ETag sem ler o BLOB', () => {
  it('muda com o token de geração, que é o ponto', () => {
    const antes = computeTileETag('quatis', 'Data/c00.glb', 'mt4b2d00');
    const depois = computeTileETag('quatis', 'Data/c00.glb', 'zz9x1a02');
    assert.notEqual(antes, depois);
  });

  it('muda com a chave e com o modelo', () => {
    const token = 'mt4b2d00';
    assert.notEqual(
      computeTileETag('quatis', 'Data/c00.glb', token),
      computeTileETag('quatis', 'Data/c01.glb', token),
    );
    assert.notEqual(
      computeTileETag('quatis', 'Data/c00.glb', token),
      computeTileETag('silo', 'Data/c00.glb', token),
    );
  });

  it('é estável e vem entre aspas, como o cabeçalho exige', () => {
    const etag = computeTileETag('quatis', 'Data/c00.glb', 'mt4b2d00');
    assert.equal(etag, computeTileETag('quatis', 'Data/c00.glb', 'mt4b2d00'));
    assert.match(etag, /^"quatis-[0-9a-f]{8}-mt4b2d00"$/);
  });
});
