// Path: tests/unit/regime-teto-estourado.test.js
//
// O LADO DE FORA DA FRONTEIRA: passado o teto, um índice vencido perde o direito de dizer
// "sirva isto sem credencial", e o desfecho é 503. É a janela que esta mudança fecha:
// antes dela, um recurso recém-marcado PRIVADO seguia saindo como público, e com
// `Cache-Control: public, immutable`, por tempo indeterminado, enquanto o banco estivesse
// fora.
//
// ESTE ARQUIVO RODA COM `REGIME_STALE_MAX_MS=0`, e o porquê é mecânico: o teto é lido de
// `config`, congelado na avaliação do módulo, portanto fixo por PROCESSO. O runner do node
// dá um processo por arquivo, então o regime se escolhe antes do primeiro `import`. Zero é
// o valor extremo LEGÍTIMO da faixa (o regime mais estrito), não um valor inventado para o
// teste: quem prova que a fronteira cai no lugar certo para um teto qualquer é a aritmética
// em `regime-vencido-teto.test.js`, e quem prova que o teto padrão NÃO recusa é
// `regime-teto-indices.test.js`. Os três juntos é que distinguem um teto de cinco minutos
// de um teto de zero e de teto nenhum.
//
// O QUE ESTE ARQUIVO PRENDE, e é a metade de ACESSO da mudança:
//
//   1. além do teto, a resposta que ENTREGA bytes vira 503 nos dois índices. Sem isto a
//      janela continua aberta e nada fica vermelho;
//   2. o ramo PRIVADO atravessa o teto INTACTO, e é isso que faz o teto não derrubar o
//      produto: ele não depende deste índice para dizer não, pergunta ao banco a cada
//      decisão. Um teto que fechasse o privado junto seria um teto que derruba o gate que
//      ainda funciona;
//   3. no índice de TILES o caminho não reivindicado continua sendo 401, e não 503: ali o
//      índice velho já está sendo lido na direção fechada, e não há afirmação a limitar;
//   4. no índice de 3D o caminho não reivindicado É alcançado pelo teto, porque lá ele é
//      SERVIDO. Esta é a consequência mais cara da mudança e está asserida de propósito, em
//      vez de descoberta em produção: com o banco fora além do teto, aquela rota responde
//      503 para o acervo 3D inteiro, e não só para as linhas públicas do catálogo;
//   5. o índice FRESCO não é tocado nem com o teto em zero. Se fosse, o produto inteiro
//      responderia 503 com o banco de pé.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

const BASE_TILES = 'http://mapas.exemplo.mil.br/tiles';

let db;
let regimeDoTile;
let invalidarRegimeDeTile;
let regimeDoCaminho;
let invalidarRegimeDeAssets3d;
let requireTileAccess;
let TILE_ACCESS_DENIAL;
let gateDeAsset3d;
let invalidarAcessoDeAssets3d;
let RegimeVencidoAlemDoTetoError;

function linha(tipo, id, access_level, cfg) {
  return { tipo, id, access_level, config: cfg };
}

const LINHAS = [
  linha('data_layer', 'rodovias', 'public', { source: { url: `${BASE_TILES}/rodovias`, type: 'vector' } }),
  linha('data_layer', 'ordem-de-batalha', 'private', { source: { url: `${BASE_TILES}/obat`, type: 'vector' } }),
  linha('tileset', 'modelo-publico', 'public', { url: '/api/v1/assets3d/modelos/publico/tileset.json' }),
  linha('tileset', 'modelo-secreto', 'private', { url: '/api/v1/assets3d/modelos/secreto/tileset.json' }),
];

const ERRO_DE_BANCO = () => {
  const erro = new Error('connect ECONNREFUSED 127.0.0.1:5432');
  erro.code = 'ECONNREFUSED';
  return erro;
};

let responder = async () => LINHAS;
/** A resposta do predicado de recurso privado (`fn_can_see_resource`), quando alguém a pede. */
let responderPredicado = async () => ({ ok: true });
let originalAny;
let originalOne;

before(async () => {
  process.env.TILE_SERVER_URL = BASE_TILES;
  process.env.REGIME_STALE_MAX_MS = '0';

  const database = await import('../../src/database/index.js');
  db = database.db;
  originalAny = db.any;
  originalOne = db.one;
  db.any = (...args) => responder(...args);
  db.one = (...args) => responderPredicado(...args);

  const config = (await import('../../src/config.js')).default;
  assert.equal(config.regimeIndex.staleMaxMs, 0, 'o regime deste arquivo tem de estar valendo');

  ({ regimeDoTile, invalidarRegimeDeTile } = await import('../../src/modules/nomes/tile-regime.js'));
  ({ regimeDoCaminho, invalidarRegimeDeAssets3d } = await import('../../src/modules/nomes/assets3d-regime.js'));
  ({ requireTileAccess, TILE_ACCESS_DENIAL } = await import('../../src/modules/auth/tile-access.js'));
  ({ gateDeAsset3d, invalidarAcessoDeAssets3d } = await import('../../src/modules/nomes/assets3d-acesso.js'));
  ({ RegimeVencidoAlemDoTetoError } = await import('../../src/modules/nomes/regime-vencido.js'));
});

after(() => {
  if (db) {
    db.any = originalAny;
    db.one = originalOne;
  }
  delete process.env.REGIME_STALE_MAX_MS;
});

/** Constrói os dois índices a partir das linhas boas. */
async function construir() {
  responder = async () => LINHAS;
  invalidarRegimeDeTile();
  invalidarRegimeDeAssets3d();
  await regimeDoTile('rodovias');
  await regimeDoCaminho('modelos/publico/tileset.json');
}

/** Constrói e então derruba o banco: os dois índices ficam vencidos, além do teto zero. */
async function entrarEmRegimeVencido() {
  await construir();
  responder = async () => { throw ERRO_DE_BANCO(); };
  invalidarRegimeDeTile();
  invalidarRegimeDeAssets3d();
}

/** Um par (req, res) de mentira, e um `next` que guarda o que recebeu. */
function pedidoDeTile(uri, user) {
  const gravado = { status: null, cabecalhos: {}, erro: undefined, seguiu: false };
  const req = { get: (nome) => (nome.toLowerCase() === 'x-original-uri' ? uri : undefined), user, query: {} };
  const res = {
    setHeader: (k, v) => { gravado.cabecalhos[k] = v; },
    status: (c) => { gravado.status = c; return res; },
    end: () => { gravado.terminou = true; },
  };
  const next = (erro) => { gravado.erro = erro; gravado.seguiu = true; };
  return { req, res, next, gravado };
}

function pedidoDeAsset(rel, user) {
  const gravado = { erro: undefined, seguiu: false };
  const req = { params: { 0: rel }, user, query: {} };
  const res = {};
  const next = (erro) => { gravado.erro = erro; gravado.seguiu = true; };
  return { req, res, next, gravado };
}

/** Espera o gate assíncrono do 3D, que resolve fora do `await` do chamador. */
async function assentar() {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
}

describe('além do teto: o índice recusa a AFIRMAÇÃO pública', () => {
  before(entrarEmRegimeVencido);

  it('tile: a resposta pública vira erro, e o erro nomeia índice, idade e teto', async () => {
    // O controle negativo desta linha é o arquivo irmão: com o teto padrão, esta MESMA
    // chamada devolve a linha pública.
    await assert.rejects(
      () => regimeDoTile('rodovias'),
      (erro) => {
        assert.ok(erro instanceof RegimeVencidoAlemDoTetoError, `veio ${erro?.name}`);
        assert.equal(erro.indice, 'tile');
        assert.equal(erro.teto, 0);
        assert.ok(Number.isFinite(erro.vencidoHaMs));
        return true;
      },
    );
  });

  it('tile: o ramo PRIVADO atravessa o teto intacto', async () => {
    // A propriedade que separa "fechar a janela" de "derrubar o produto": este ramo não
    // depende do índice para dizer não, e o gate segue perguntando ao banco.
    assert.deepEqual(await regimeDoTile('obat/10/1/2.pbf'), {
      reivindicado: true, privado: true, tipo: 'data_layer', resourceId: 'ordem-de-batalha',
    });
  });

  it('tile: o caminho NÃO REIVINDICADO continua sendo recusa, não erro', async () => {
    // Ali o índice velho já é lido na direção fechada (401), então não há afirmação a
    // limitar, e transformá-lo em 503 trocaria uma negação correta por um erro.
    assert.deepEqual(await regimeDoTile('inexistente/0/0/0.pbf'), {
      reivindicado: false, privado: false,
    });
  });

  it('assets3d: o público vira erro', async () => {
    await assert.rejects(
      () => regimeDoCaminho('modelos/publico/tile.b3dm'),
      (erro) => erro instanceof RegimeVencidoAlemDoTetoError && erro.indice === 'assets3d',
    );
  });

  it('assets3d: o NÃO CATALOGADO também vira erro, e essa é a inversão que custa caro', async () => {
    // Aqui o não reivindicado é SERVIDO, então ele é uma afirmação pública como qualquer
    // outra. A consequência está asserida para que ela seja uma decisão e não uma surpresa:
    // além do teto, esta rota fecha para o acervo 3D inteiro.
    await assert.rejects(
      () => regimeDoCaminho('cenas/caminhavel/meta.json'),
      (erro) => erro instanceof RegimeVencidoAlemDoTetoError,
    );
  });

  it('assets3d: o ramo PRIVADO atravessa o teto intacto', async () => {
    assert.deepEqual(await regimeDoCaminho('modelos/secreto/tile.b3dm'), {
      privado: true, tipo: 'tileset', resourceId: 'modelo-secreto',
    });
  });
});

describe('além do teto: o desfecho no gate é 503, e só na resposta pública', () => {
  before(entrarEmRegimeVencido);

  it('tile-access responde 503 no caminho público', async () => {
    const { req, res, next, gravado } = pedidoDeTile('/tiles/rodovias');
    await requireTileAccess(req, res, next);

    assert.ok(gravado.seguiu, 'o gate delegou ao errorHandler em vez de responder sozinho');
    assert.equal(gravado.erro?.statusCode, 503, `veio ${gravado.erro?.statusCode}`);
    assert.equal(gravado.status, null, 'nenhum 200 e nenhum 401 foram escritos');
  });

  it('tile-access continua respondendo 401 no privado sem credencial, e não 503', async () => {
    // Se o teto fechasse o ramo privado junto, este caso viraria 503 e o gate teria parado
    // de distinguir "não posso decidir" de "você não tem credencial".
    const { req, res, next, gravado } = pedidoDeTile('/tiles/obat/10/1/2.pbf');
    await requireTileAccess(req, res, next);

    assert.equal(gravado.erro, undefined, 'nada foi delegado ao errorHandler');
    assert.equal(gravado.status, 401);
    assert.equal(gravado.cabecalhos['X-EBGeo-Tile-Denial'], TILE_ACCESS_DENIAL.SEM_CREDENCIAL);
  });

  it('tile-access continua respondendo 401 no não reivindicado', async () => {
    const { req, res, next, gravado } = pedidoDeTile('/tiles/inexistente/0/0/0.pbf');
    await requireTileAccess(req, res, next);

    assert.equal(gravado.erro, undefined);
    assert.equal(gravado.status, 401);
    assert.equal(
      gravado.cabecalhos['X-EBGeo-Tile-Denial'],
      TILE_ACCESS_DENIAL.CAMINHO_NAO_REIVINDICADO,
    );
  });

  it('o gate do 3D responde 503 no caminho público', async () => {
    const { req, res, next, gravado } = pedidoDeAsset('modelos/publico/tile.b3dm');
    gateDeAsset3d(req, res, next);
    await assentar();

    assert.ok(gravado.seguiu, 'o gate concluiu');
    assert.equal(gravado.erro?.statusCode, 503, `veio ${gravado.erro?.statusCode}`);
  });

  it('o gate do 3D continua decidindo o PRIVADO pelo banco, e libera quando o predicado libera', async () => {
    // O par positivo do bloco acima: passado o teto, o privado não vira 503, vai ao
    // predicado. Sem este caso, "tudo 503" passaria pelo bloco anterior.
    invalidarAcessoDeAssets3d();
    responderPredicado = async () => ({ ok: true });
    const liberado = pedidoDeAsset('modelos/secreto/tile.b3dm');
    gateDeAsset3d(liberado.req, liberado.res, liberado.next);
    await assentar();

    assert.ok(liberado.gravado.seguiu);
    assert.equal(liberado.gravado.erro, undefined, 'o predicado liberou: segue sem erro');
    assert.equal(liberado.req.assetPrivado, true);

    // E o NEGATIVO da mesma linha: quando o predicado recusa, 404, nunca 503.
    invalidarAcessoDeAssets3d();
    responderPredicado = async () => ({ ok: false });
    const negado = pedidoDeAsset('modelos/secreto/tile.b3dm');
    gateDeAsset3d(negado.req, negado.res, negado.next);
    await assentar();

    assert.equal(negado.gravado.erro?.statusCode, 404, `veio ${negado.gravado.erro?.statusCode}`);
  });
});

describe('teto zero: o índice FRESCO segue intocado', () => {
  before(construir);

  it('nem o tile nem o 3D recusam quando o índice é o vigente', async () => {
    // O teto mais estrito que a configuração aceita não pode custar NADA com o banco de pé:
    // ele limita a idade da afirmação, não a afirmação.
    assert.deepEqual(await regimeDoTile('rodovias'), {
      reivindicado: true, privado: false, tipo: 'data_layer', resourceId: 'rodovias',
    });
    assert.deepEqual(await regimeDoCaminho('cenas/caminhavel/meta.json'), { privado: false });

    const { req, res, next, gravado } = pedidoDeTile('/tiles/rodovias');
    await requireTileAccess(req, res, next);
    assert.equal(gravado.status, 200);
    assert.equal(gravado.erro, undefined);
  });
});
