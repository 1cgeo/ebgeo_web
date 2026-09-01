// Path: tests/unit/regime-teto-indices.test.js
//
// O LADO DE DENTRO DA FRONTEIRA: com o índice VENCIDO mas ainda dentro do teto, os dois
// índices continuam servindo exatamente o que serviam. Esta é a resiliência que a queda
// para o `ultimoBom` comprou, e quebrá-la é a regressão CARA desta mudança: transformaria
// uma piscada de banco de dois segundos, ou um deploy, em falha de mapa para todo mundo.
//
// O IRMÃO DESTE ARQUIVO É `regime-teto-estourado.test.js`, que mede o outro lado (além do
// teto, recusa com 503). Os dois precisam existir porque nenhum dos dois sozinho distingue
// um teto correto de um teto ausente: sem este, "teto de zero" passaria verde; sem aquele,
// "sem teto nenhum" passaria verde. A aritmética exata da fronteira está no terceiro,
// `regime-vencido-teto.test.js`.
//
// POR QUE ELES SÃO DOIS ARQUIVOS, e não dois blocos. O teto é lido de `config`, que é
// congelado na avaliação do módulo, então o valor é fixo por PROCESSO; o runner do node dá
// um processo por arquivo de teste, e é isso que permite a cada um escolher o seu regime
// antes do primeiro `import`.
//
// COMO ESTE ARQUIVO QUEBRA O BANCO SEM TER BANCO. `query()` (`src/database/index.js`)
// delega a `db.any`, e `db` é exportado: é a mesma costura que `tests/helpers/
// query-counter.js` usa para contar consultas. Trocando `db.any` por uma função nossa,
// primeiro construímos um índice a partir de linhas fabricadas e depois fazemos a
// reconstrução falhar, que é a sequência real de um incidente. Nenhuma conexão é aberta em
// momento nenhum, e o que roda é o código do deploy, não uma cópia dele.
//
// AS QUATRO PROPRIEDADES, e o que cada uma estaria escondendo se passasse por acaso:
//
//   1. o índice FRESCO não é afetado por nada disto. Se ele fosse, o caminho quente do
//      produto responderia 503 com o banco de pé;
//   2. o índice VENCIDO dentro do teto continua servindo o PÚBLICO. Um teto baixo demais
//      (ou uma comparação invertida) apareceria aqui, e só aqui;
//   3. o ramo PRIVADO não muda em nenhum dos dois regimes. O teto não pode fechar o gate
//      que continua funcionando: quem decide o privado é `fn_can_see_resource`, no banco, a
//      cada decisão, e não este índice;
//   4. as duas INVERSÕES entre os índices continuam de pé: caminho não reivindicado é
//      recusa no de tiles (`reivindicado: false`, que o gate lê como 401) e é entrega no de
//      3D (`privado: false`). É essa diferença que faz o teto alcançar UMA resposta lá e
//      DUAS aqui.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

const BASE_TILES = 'http://mapas.exemplo.mil.br/tiles';

let db;
let regimeDoTile;
let invalidarRegimeDeTile;
let regimeDoCaminho;
let invalidarRegimeDeAssets3d;
let staleMaxMs;

/** Uma linha de catálogo no formato que `SELECT_LINHAS_DE_CATALOGO` devolve. */
function linha(tipo, id, access_level, cfg) {
  return { tipo, id, access_level, config: cfg };
}

const LINHAS = [
  linha('data_layer', 'rodovias', 'public', { source: { url: `${BASE_TILES}/rodovias`, type: 'vector' } }),
  linha('data_layer', 'ordem-de-batalha', 'private', { source: { url: `${BASE_TILES}/obat`, type: 'vector' } }),
  linha('tileset', 'modelo-publico', 'public', { url: '/api/v1/assets3d/modelos/publico/tileset.json' }),
  linha('tileset', 'modelo-secreto', 'private', { url: '/api/v1/assets3d/modelos/secreto/tileset.json' }),
];

/** O `db.any` do momento. Trocado em cada fase do incidente. */
let responder = async () => LINHAS;
let originalAny;

before(async () => {
  process.env.TILE_SERVER_URL = BASE_TILES;
  // Sem `REGIME_STALE_MAX_MS`: este arquivo roda com o PADRÃO, que é o que o deploy usa.
  delete process.env.REGIME_STALE_MAX_MS;

  const database = await import('../../src/database/index.js');
  db = database.db;
  originalAny = db.any;
  db.any = (...args) => responder(...args);

  const config = (await import('../../src/config.js')).default;
  staleMaxMs = config.regimeIndex.staleMaxMs;

  ({ regimeDoTile, invalidarRegimeDeTile } = await import('../../src/modules/nomes/tile-regime.js'));
  ({ regimeDoCaminho, invalidarRegimeDeAssets3d } = await import('../../src/modules/nomes/assets3d-regime.js'));
});

after(() => {
  if (db) db.any = originalAny;
});

/** Põe os dois índices em regime VENCIDO: um build bom, depois um que falha. */
async function entrarEmRegimeVencido() {
  responder = async () => LINHAS;
  invalidarRegimeDeTile();
  invalidarRegimeDeAssets3d();
  await regimeDoTile('rodovias');
  await regimeDoCaminho('modelos/publico/tileset.json');

  responder = async () => {
    const erro = new Error('connect ECONNREFUSED 127.0.0.1:5432');
    erro.code = 'ECONNREFUSED';
    throw erro;
  };
  invalidarRegimeDeTile();
  invalidarRegimeDeAssets3d();
}

/** Volta os dois ao regime NORMAL. */
async function voltarAoNormal() {
  responder = async () => LINHAS;
  invalidarRegimeDeTile();
  invalidarRegimeDeAssets3d();
  await regimeDoTile('rodovias');
  await regimeDoCaminho('modelos/publico/tileset.json');
}

describe('teto do regime vencido: o padrão é folgado o bastante para uma piscada', () => {
  it('cinco minutos, contra um TTL de índice de 60 s', () => {
    // O número não é gosto: é cinco vezes o ciclo de reconstrução do próprio índice. Um
    // teto abaixo do TTL faria o produto recusar entre duas reconstruções normais.
    assert.equal(staleMaxMs, 300_000);
    assert.ok(staleMaxMs >= 60_000 * 5, 'o teto tem de dar folga sobre o TTL do índice');
  });
});

describe('índice FRESCO: o teto não toca em nada', () => {
  before(voltarAoNormal);

  it('tile: a linha pública sai, a privada é identificada, o não reivindicado é recusa', async () => {
    assert.deepEqual(await regimeDoTile('rodovias'), {
      reivindicado: true, privado: false, tipo: 'data_layer', resourceId: 'rodovias',
    });
    assert.deepEqual(await regimeDoTile('obat/10/1/2.pbf'), {
      reivindicado: true, privado: true, tipo: 'data_layer', resourceId: 'ordem-de-batalha',
    });
    assert.deepEqual(await regimeDoTile('inexistente/0/0/0.pbf'), {
      reivindicado: false, privado: false,
    });
  });

  it('assets3d: o público sai, o privado é identificado, o não catalogado sai', async () => {
    assert.deepEqual(await regimeDoCaminho('modelos/publico/tile.b3dm'), {
      privado: false, tipo: 'tileset', resourceId: 'modelo-publico',
    });
    assert.deepEqual(await regimeDoCaminho('modelos/secreto/tile.b3dm'), {
      privado: true, tipo: 'tileset', resourceId: 'modelo-secreto',
    });
    // A inversão declarada: o que nenhuma linha reivindica é PÚBLICO aqui.
    assert.deepEqual(await regimeDoCaminho('cenas/caminhavel/meta.json'), { privado: false });
  });
});

describe('índice VENCIDO, DENTRO do teto: serve exatamente como antes', () => {
  before(entrarEmRegimeVencido);
  after(voltarAoNormal);

  it('tile: a resposta PÚBLICA continua saindo do último índice bom', async () => {
    // A resiliência que a queda comprou. Se este caso virasse 503, uma piscada de banco de
    // dois segundos derrubaria o mapa de todo mundo.
    assert.deepEqual(await regimeDoTile('rodovias'), {
      reivindicado: true, privado: false, tipo: 'data_layer', resourceId: 'rodovias',
    });
  });

  it('tile: o ramo PRIVADO não muda, e o não reivindicado segue sendo recusa', async () => {
    assert.deepEqual(await regimeDoTile('obat/10/1/2.pbf'), {
      reivindicado: true, privado: true, tipo: 'data_layer', resourceId: 'ordem-de-batalha',
    });
    assert.deepEqual(await regimeDoTile('inexistente/0/0/0.pbf'), {
      reivindicado: false, privado: false,
    });
  });

  it('assets3d: público, privado e não catalogado, os três como antes', async () => {
    assert.deepEqual(await regimeDoCaminho('modelos/publico/tile.b3dm'), {
      privado: false, tipo: 'tileset', resourceId: 'modelo-publico',
    });
    assert.deepEqual(await regimeDoCaminho('modelos/secreto/tile.b3dm'), {
      privado: true, tipo: 'tileset', resourceId: 'modelo-secreto',
    });
    assert.deepEqual(await regimeDoCaminho('cenas/caminhavel/meta.json'), { privado: false });
  });

  it('a rajada não muda o desfecho: mil consultas, mil respostas iguais', async () => {
    // O índice é consultado uma vez por tile. Se o teto fosse avaliado contra um relógio
    // que a própria consulta reinicia, ou se a queda re-carimbasse a idade, este bloco
    // ficaria verde e o teto NUNCA fecharia em produção.
    let publicas = 0;
    for (let i = 0; i < 1000; i += 1) {
      const r = await regimeDoTile(`rodovias/12/${i}/1.pbf`);
      if (r.reivindicado && !r.privado) publicas += 1;
    }
    assert.equal(publicas, 1000);
  });

  it('a RECUPERAÇÃO volta o regime ao normal', async () => {
    // Sem este caso, um teto que ficasse permanentemente vencido depois do primeiro
    // incidente passaria todos os anteriores.
    await voltarAoNormal();
    assert.deepEqual(await regimeDoTile('rodovias'), {
      reivindicado: true, privado: false, tipo: 'data_layer', resourceId: 'rodovias',
    });
    await entrarEmRegimeVencido();
  });
});
