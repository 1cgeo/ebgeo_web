// Path: tests/unit/models3d-cabecalho.test.js
// A REGRA DE ADOÇÃO de um `.3dtiles`, sem banco e sem arquivo: o que o cabeçalho precisa
// trazer, o que ele vira na linha de produção e o que ele vira no `config` do catálogo.
//
// As duas recusas são o motivo de esta regra ser função pura: adotar um arquivo cujo
// cabeçalho diz outro id publica o conteúdo de um modelo sob a URL de outro, e adotar um
// cuja contagem não bate publica uma conversão interrompida no meio (que carrega em tela
// com buracos, sem erro nenhum).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  validarCabecalho,
  linhaDeProducao,
  configDeCatalogo,
  CAMPOS_OBRIGATORIOS,
} from '../../src/modules/models3d/models3d.header.js';

const META_OK = Object.freeze({
  id: 'ponte_quatis',
  name: 'Ponte General Osório (Quatis)',
  buildToken: 'mt4b2d00',
  builtAt: '2026-08-22T11:41:27.325Z',
  tileCount: '7501',
  jsonCount: '312',
  geometry: 'draco',
  texture: 'ktx2-etc1s',
  textureQuality: '200',
  sourceBytes: '3345678901',
  source: 'Agisoft Metashape',
  lon: '-44.286984',
  lat: '-22.400374',
  groundHeight: '343.2',
  minHeight: '339.5',
});

const cab = (meta = META_OK, tiles = 7501) => ({ meta: { ...meta }, tilesNoArquivo: tiles });

describe('models3d — quando um arquivo pode ser adotado', () => {
  it('aceita o cabeçalho completo cuja contagem bate', () => {
    assert.deepEqual(validarCabecalho(cab(), 'ponte_quatis'), { ok: true });
  });

  it('recusa, nomeando o campo, quando falta qualquer obrigatório', () => {
    // Sem esta asserção o laço abaixo passaria verde com a lista vazia.
    assert.equal(CAMPOS_OBRIGATORIOS.length, 4);
    for (const campo of CAMPOS_OBRIGATORIOS) {
      const meta = { ...META_OK };
      delete meta[campo];
      const v = validarCabecalho(cab(meta), 'ponte_quatis');
      assert.equal(v.ok, false, `faltando ${campo} deveria recusar`);
      assert.match(v.motivo, new RegExp(campo));
    }
  });

  it('recusa quando o id do cabeçalho não é o do arquivo', () => {
    // Arquivo renomeado à mão. Adotar pelo nome poria o conteúdo de um modelo sob o id
    // de outro, e o id é a URL pública, a chave da allowlist por atlas e a referência
    // que um briefing salvo guarda.
    const v = validarCabecalho(cab(), 'ponte-quatis');
    assert.equal(v.ok, false);
    assert.match(v.motivo, /ponte_quatis/);
  });

  it('recusa quando a contagem do cabeçalho não bate com a do arquivo', () => {
    const v = validarCabecalho(cab(META_OK, 7400), 'ponte_quatis');
    assert.equal(v.ok, false);
    assert.match(v.motivo, /7501.*7400/);
  });

  it('recusa cabeçalho vazio sem estourar', () => {
    const v = validarCabecalho({ meta: {}, tilesNoArquivo: 0 }, 'x');
    assert.equal(v.ok, false);
  });
});

describe('models3d — o cabeçalho vira linha de produção', () => {
  it('traz o token, as contagens e as duas medidas como número', () => {
    const linha = linhaDeProducao(cab(), 'ponte_quatis.3dtiles', 308559872);
    assert.equal(linha.modelId, 'ponte_quatis');
    assert.equal(linha.dbFilename, 'ponte_quatis.3dtiles');
    assert.equal(linha.buildToken, 'mt4b2d00');
    assert.equal(linha.tileCount, 7501);
    assert.equal(linha.totalBytes, 308559872);
    assert.equal(linha.groundHeight, 343.2);
    assert.equal(linha.minHeight, 339.5);
    assert.equal(linha.textureQuality, 200);
  });

  it('a contagem vem do ARQUIVO, não do cabeçalho', () => {
    // Os dois já foram conferidos pela validação; usar o do arquivo é o que mantém a
    // coluna igual ao que existe, e não ao que alguém prometeu.
    const linha = linhaDeProducao(cab(META_OK, 7501), 'ponte_quatis.3dtiles', 1);
    assert.equal(linha.tileCount, 7501);
  });

  it('campo ausente vira null, e não NaN nem string vazia', () => {
    const meta = { ...META_OK };
    delete meta.groundHeight;
    delete meta.minHeight;
    delete meta.sourceBytes;
    const linha = linhaDeProducao({ meta, tilesNoArquivo: 10 }, 'x.3dtiles', 2);
    assert.equal(linha.groundHeight, null);
    assert.equal(linha.minHeight, null);
    assert.equal(linha.sourceBytes, null);
  });

  it('usa os padrões do formato quando o cabeçalho é antigo', () => {
    const linha = linhaDeProducao({ meta: { id: 'x' }, tilesNoArquivo: 1 }, 'x.3dtiles', 1);
    assert.equal(linha.tilesVersion, '1.1');
    assert.equal(linha.geometryCodec, 'draco');
    assert.equal(linha.textureCodec, 'ktx2-etc1s');
    assert.equal(linha.modelType, '3dtiles');
  });
});

describe('models3d — o cabeçalho vira config de catálogo', () => {
  const BASE = '/api/v1/assets3d';

  it('aponta o tileset.json e declara a forma', () => {
    const c = configDeCatalogo(cab(), { baseUrl: BASE, forma3d: 'tiles3d' });
    assert.equal(c.url, '/api/v1/assets3d/m/ponte_quatis/tileset.json');
    assert.equal(c.forma3d, 'tiles3d');
  });

  it('aponta o PRÓPRIO arquivo quando é um GLB isolado', () => {
    // O cliente abre um GLB por `Model.fromGltfAsync`, que não resolve árvore nenhuma.
    const meta = { ...META_OK, modelType: 'glb', positionLon: '-44.44', positionLat: '-22.45' };
    const c = configDeCatalogo(cab(meta), { baseUrl: BASE, forma3d: 'glb' });
    assert.equal(c.url, '/api/v1/assets3d/m/ponte_quatis/model.glb');
    assert.deepEqual(c.position, { lon: -44.44, lat: -22.45 });
  });

  it('o GLB carrega plantio, rotação e escala, e o heightOffset é a ALTURA', () => {
    // Num objeto único não há envelope para medir: `heightOffset` deixa de ser ajuste e
    // passa a ser onde o modelo é plantado. Confundir as duas leituras põe o modelo no
    // chão errado, e nada avisa.
    const meta = {
      ...META_OK,
      modelType: 'glb',
      positionLon: '-44.447668',
      positionLat: '-22.454757',
      height: '50',
      rotHeading: '180',
      rotPitch: '0',
      scale: '2',
    };
    const c = configDeCatalogo(cab(meta), { baseUrl: BASE, forma3d: 'glb' });
    assert.equal(c.heightOffset, 50);
    assert.deepEqual(c.rotation, { heading: 180 });
    assert.equal(c.scale, 2);
    // E a câmera do "ir para" fica 300 m acima do plantio, não os 500 m da árvore: um
    // objeto único visto de 500 m é um ponto na tela.
    assert.equal(c.locate.height, 350);
  });

  it('escala 1 e rotação zerada NÃO se publicam', () => {
    // São os valores default do cliente, e emiti-los convidaria a mexer neles.
    const meta = { ...META_OK, modelType: 'glb', height: '0', scale: '1', rotHeading: '0' };
    const c = configDeCatalogo(cab(meta), { baseUrl: BASE, forma3d: 'glb' });
    assert.equal(c.scale, undefined);
    assert.equal(c.rotation, undefined);
    assert.equal(c.heightOffset, 0);
  });

  it('publica heightOffset 0, e nunca a medida negada', () => {
    // Com o terreno no ar o ajuste é 0. Um valor que não seja 0 nem `-minHeight`
    // denuncia ajuste no olho, e é o que enterra modelo.
    const c = configDeCatalogo(cab(), { baseUrl: BASE, forma3d: 'tiles3d' });
    assert.equal(c.heightOffset, 0);
    assert.equal(c.groundHeight, 343.2);
    assert.equal(c.minHeight, 339.5);
  });

  it('o `locate` leva a altura de CÂMERA, que é o chão mais 500 m', () => {
    const c = configDeCatalogo(cab(), { baseUrl: BASE, forma3d: 'tiles3d' });
    assert.deepEqual(c.locate, { lon: -44.286984, lat: -22.400374, height: 843.2 });
  });

  it('omite o `locate` quando o modelo não tem ponto medido', () => {
    const meta = { ...META_OK };
    delete meta.lon;
    delete meta.lat;
    const c = configDeCatalogo(cab(meta), { baseUrl: BASE, forma3d: 'tiles3d' });
    assert.equal(c.locate, undefined);
  });

  it('keywords ilegível não impede a adoção', () => {
    const c = configDeCatalogo(cab({ ...META_OK, keywords: '{isto nao e json' }), {
      baseUrl: BASE,
      forma3d: 'tiles3d',
    });
    assert.equal(c.keywords, undefined);
    assert.equal(c.url, '/api/v1/assets3d/m/ponte_quatis/tileset.json');
  });
});
