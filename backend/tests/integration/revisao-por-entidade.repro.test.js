// Path: tests/integration/revisao-por-entidade.repro.test.js
//
// CAUSA RAIZ (F8, passo 2 do bloco B5). A verificação de base observada existia e funcionava, e
// alcançava UMA entidade. O gate em `pushOperations` era literal:
//
//   if (rawOp.protocolVersion === 2 && op.target === 'feature') { ... }
//
// Logo `map`, `layer`, `group`, `comment`, `briefing`, `slide`, `catalog_layer`, `cesium3d` e
// `streetview360` não tinham como perceber que a linha que estavam escrevendo já havia mudado:
// LWW por ordem de chegada não era política ali, era a AUSÊNCIA de política, e o ack dizia
// `applied`. Duas pessoas renomeando o mesmo mapa a partir da mesma versão produziam um vencedor
// silencioso; e pior, uma que renomeava e outra que apenas panorâmica o mapa também disputavam,
// porque sem unidade de disputa declarada não há como dizer que os dois gestos são independentes.
//
// CONTROLE NEGATIVO, medido em 2026-09-13 desligando a moldura (o ramo de `prepareEntityMutation`
// em `pushOperations`): dos 20 casos, 14 ficam VERMELHOS e 6 seguem verdes. Os 6 verdes são
// exatamente os que descrevem o que NÃO deve mudar, e é por isso que eles existem: os três
// estruturais (que leem tabelas, não comportamento), os dois contrastes de op SEM base, e o update
// com base sobre túmulo de mapa, que segue recusado porque `tombstoneConflict` (passo 1 do B5) já
// respondia por ele. Os 14 vermelhos são as recusas que não existiam.
//
// SEGUNDO CONTROLE NEGATIVO, sobre a estreitada da escrita: fixando `slideClaimsTarget` e
// `claimsText` em `true` (isto é, mantendo a moldura e ignorando `_unitScope`), ficam vermelhos
// EXATAMENTE 2 casos, o do comentário e o do slide, e os outros 18 seguem verdes. É a medida de
// que a estreitada é o que torna a tabela de unidades verdadeira, e de que ela não faz mais nada.
//
// O CONSERTO é `entity-conflicts.js`: a moldura que a feição já era uma instância de (ler a linha,
// resolver a base declarada, ler a fronteira por unidade em `sync_entity_fields` com o
// `entity_type` real, recusar NOMEANDO as unidades disputadas, gravar a fronteira nova), com a
// tabela de unidades por alvo como DADO. O gate deixou de ser por alvo e passou a ser "a op
// DECLARA uma base", de modo que o cliente de hoje (que só declara base para feição) não muda de
// comportamento em nada, e o dia em que ele declarar base para mapa a verificação liga sozinha.
//
// DUAS COISAS QUE ESTE ARQUIVO MEDE E QUE NÃO SE LEEM NA TABELA DE UNIDADES:
//
//   1. O REGIME COM BASE ESTREITA A ESCRITA ÀS UNIDADES QUE ELA DECLARA. Sem isso a tabela seria
//      mentira em dois pontos: o update de `comment` escreve o `data` INTEIRO (então um
//      `{ status: 'resolved' }` que jura não tocar o texto apagaria o texto) e o update de `slide`
//      atribui `map_id` sempre, via `resolveSlideMapId` (então uma edição de título apagaria a
//      referência de mapa do slide, e teria de se declarar disputando `alvo`, o que faria todo par
//      de edições de slide conflitar). As duas passaram a ler `op._unitScope`, que só existe em op
//      com base declarada.
//   2. ENTIDADE DE UMA UNIDADE SÓ NÃO GUARDA FRONTEIRA. `catalog_layer`, `cesium3d` e
//      `streetview360` têm o documento como unidade única, e nesse caso "alguma unidade passou da
//      sua base" é aritmeticamente igual a "a versão da linha passou da sua base". A fronteira
//      seria uma segunda cópia de `version`. Isso também resolve o `catalog_layer`, cujo id é TEXT
//      enquanto `sync_entity_fields.entity_id` é UUID (`004_sync.sql`): a entidade que NÃO PODERIA
//      ter linha de fronteira é exatamente a que não precisa de nenhuma.
//
// O CASO DE CONTRASTE (op SEM base continua LWW) está aqui de propósito e não é enfeite: ele é o
// que prende o contrato com o cliente ATUAL. Se alguém "completar" a moldura recusando toda op sem
// base, ele fica vermelho antes de o produto parar de sincronizar.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import {
  createUser, createAtlas, createMap, createLayer, createGroup,
  createBriefing, createSlide, createStreetview360Data, loginUser,
} from '../helpers/fixtures.js';
import { DISPUTE_UNITS, MAP_SCOPED_TABLES, DOCUMENTO } from '../../src/modules/sync/entity-conflicts.js';
import {
  UPDATE_FIELDS, MAP_UPDATE_FIELDS, MAP_SUBTYPE_FIELDS, TARGET_TABLE_MAP,
} from '../../src/modules/sync/sync.service.js';

const SEM_BASE = 'Esta edição não possui uma versão-base confirmada.';
const DISPUTADOS = 'Os mesmos campos foram alterados no servidor.';
const EXCLUIDO = 'O item foi excluido no servidor.';
const ALTERADO_ANTES_DA_EXCLUSAO = 'O item foi alterado após a versão que você pretende excluir.';

describe('F8 — base observada e revisão por ENTIDADE, não só por feição', () => {
  let app, db, token, atlas, userId;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    const owner = await createUser(db, { username: 'revisao_owner' });
    userId = owner.id;
    token = await loginUser(app, owner.username, owner.password);
    atlas = await createAtlas(db, owner.id, { name: 'Revisao por entidade' });
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  const push = (operations) =>
    supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/sync`)
      .set('Authorization', `Bearer ${token}`)
      .send({ operations })
      .expect(200);

  const envelope = (extra) => ({
    protocolVersion: 2,
    id: randomUUID(),
    timestamp: Date.now(),
    clientId: 'c-revisao',
    ...extra,
  });

  /** Pushes ONE operation and returns its ack. */
  const uma = async (extra) => (await push([envelope(extra)])).body.data.acks[0];

  /** The one assertion shape for "applied, and it says which version it committed". */
  const aplicada = (ack, esperada, contexto) => {
    assert.equal(ack.rejected, undefined, `${contexto}: não foi recusada (motivo: ${ack.reason})`);
    assert.equal(ack.status, 'applied', `${contexto}: status applied`);
    assert.equal(ack.entityVersion, esperada,
      `${contexto}: o ack devolve a versão que a entidade COMMITOU, que é a base da próxima edição`);
  };

  /** The one assertion shape for "refused as a conflict, naming the units in dispute". */
  const conflito = (ack, motivo, unidades, contexto) => {
    assert.equal(ack.rejected, true, `${contexto}: foi recusada (motivo recebido: ${ack.reason})`);
    assert.equal(ack.status, 'conflict', `${contexto}: pelo canal de conflito, não pelo de política`);
    assert.equal(ack.reason, motivo, `${contexto}: com a frase do vocabulário compartilhado`);
    assert.deepEqual(ack.conflict.fields, unidades, `${contexto}: NOMEANDO a unidade disputada`);
    assert.ok(Number.isInteger(ack.conflict.entityVersion),
      `${contexto}: e carregando a versão que uma nova tentativa precisa`);
  };

  const versaoDe = async (tabela, id) => {
    const { rows } = await db.query(`SELECT version FROM ${tabela} WHERE id = $1`, [id]);
    assert.equal(rows.length, 1, `a linha de ${tabela} existe (uma só)`);
    return Number(rows[0].version);
  };

  const linha = async (tabela, id) => {
    const { rows } = await db.query(`SELECT * FROM ${tabela} WHERE id = $1`, [id]);
    assert.equal(rows.length, 1, `a linha de ${tabela} existe (uma só)`);
    return rows[0];
  };

  // ==========================================================================
  // ESTRUTURAL — a tabela de unidades cobre toda coluna que uma escrita alcança
  // ==========================================================================

  it('ESTRUTURAL: toda coluna escrevível de uma entidade com unidades pertence a exatamente UMA unidade', () => {
    // ESTE É O CASO QUE IMPEDE A FALHA ABERTA. Uma coluna sem unidade é escrita sem NUNCA ser
    // comparada com a fronteira, que é a sobrescrita silenciosa que a moldura existe para fechar;
    // `unitsForColumns` responde `'*'` para coluna desconhecida (falha FECHADA, disputa tudo), mas
    // um `'*'` permanente transformaria toda edição daquela entidade em conflito. Quem precisa
    // ficar vermelho é este caso, no commit em que a coluna nova nasce.
    const porAlvo = {
      map: MAP_UPDATE_FIELDS,
      layer: UPDATE_FIELDS.layer,
      group: UPDATE_FIELDS.group,
      briefing: UPDATE_FIELDS.briefing,
      slide: UPDATE_FIELDS.slide,
      // `comment` e `catalog_layer` não passam por `buildDynamicUpdate`: as colunas que os
      // statements deles escrevem estão nomeadas à mão em `declaredUpdateColumns`.
      comment: [{ column: 'data' }, { column: 'status' }],
    };
    const semUnidade = [];
    const emDuas = [];
    for (const [alvo, campos] of Object.entries(porAlvo)) {
      const spec = DISPUTE_UNITS[alvo];
      assert.ok(spec && !spec.wholeDocument, `${alvo} tem unidades declaradas`);
      for (const { column } of campos) {
        const donas = spec.units.filter((u) => u.columns.includes(column));
        if (donas.length === 0) semUnidade.push(`${alvo}.${column}`);
        if (donas.length > 1) emDuas.push(`${alvo}.${column}`);
      }
    }
    assert.deepEqual(semUnidade, [],
      'coluna escrevível FORA da tabela de unidades: ela seria escrita sem comparação nenhuma');
    assert.deepEqual(emDuas, [],
      'coluna em duas unidades: a recusa nomearia duas coisas para uma escrita só');
    // Controle absoluto: a varredura acima passaria verde sobre uma tabela vazia.
    const total = Object.values(porAlvo).reduce((n, campos) => n + campos.length, 0);
    // 43 desde 2026-09-20: as duas colunas da VISTA do slide (`base_layer` e `temporal_enabled`),
    // que entraram na unidade `camera`, porque sao o que o slide mostra junto com a posicao.
    assert.equal(total, 43,
      'a varredura cobriu as 43 colunas escrevíveis das seis entidades com unidades '
      + '(mapa 13, camada 6, grupo 5, briefing 4, slide 13, comentário 2)');
  });

  it('ESTRUTURAL: as colunas de sub-tipo de mapa são um subconjunto das do mapa, e caem em unidades', () => {
    const doMapa = new Set(MAP_UPDATE_FIELDS.map((f) => f.column));
    const fora = [];
    for (const [subtipo, campos] of Object.entries(MAP_SUBTYPE_FIELDS)) {
      for (const { column } of campos) {
        if (!doMapa.has(column)) fora.push(`${subtipo}.${column}`);
      }
    }
    assert.deepEqual(fora, [],
      'coluna de sub-tipo que o update de mapa inteiro não conhece: a unidade dela seria indecidível');
    assert.equal(Object.keys(MAP_SUBTYPE_FIELDS).length, 5, 'os cinco sub-tipos foram varridos');
  });

  it('ESTRUTURAL: a cópia de tabelas de `entity-conflicts` não divergiu de `TARGET_TABLE_MAP`', () => {
    // A moldura escreve os quatro nomes de tabela em vez de importar `TARGET_TABLE_MAP`, para não
    // depender do serviço que ela serve. A cópia é barata; a DIVERGÊNCIA silenciosa não seria:
    // um nome errado devolve zero linhas e se lê exatamente como "não existe tal linha".
    const pares = Object.entries(MAP_SCOPED_TABLES);
    assert.equal(pares.length, 4, 'as quatro tabelas escopadas por mapa (senão o laço abaixo é vácuo)');
    for (const [alvo, tabela] of pares) {
      assert.equal(TARGET_TABLE_MAP[alvo], tabela, `${alvo} nomeia a mesma tabela nos dois lugares`);
    }
  });

  // ==========================================================================
  // MAPA — nome contra posição, com a posição chegando pelo sub-tipo
  // ==========================================================================

  it('MAPA: nome e posição são unidades diferentes e convergem; o segundo nome da mesma base é conflito', async () => {
    const map = await createMap(db, atlas.id, { name: 'Original' });
    const base = await versaoDe('maps', map.id);

    aplicada(await uma({
      type: 'update', target: 'map', targetId: map.id, baseVersion: base,
      changes: { name: 'Renomeado por A' },
    }), base + 1, 'A renomeia');

    // A POSIÇÃO CHEGA PELO SUB-TIPO, que endereça o mapa por `mapId` e não por `targetId`: é o
    // caminho que o cliente real usa, e o que obriga `revisionKeyOf` a fazer a mesma divisão que
    // `buildUpdateQuery`. Errar isso gravaria a fronteira sob um id que ninguém consulta.
    aplicada(await uma({
      operationType: 'update', entityType: 'mapPosition', entityId: map.id, mapId: map.id,
      baseVersion: base,
      data: { center_lat: -22.9, center_long: -43.2, zoom: 12, bearing: 0, pitch: 0 },
    }), base + 2, 'B panoramiza da MESMA base');

    const depois = await linha('maps', map.id);
    assert.equal(depois.name, 'Renomeado por A', 'o nome de A sobreviveu à escrita de B');
    assert.equal(Number(depois.zoom), 12, 'e a posição de B entrou');

    conflito(await uma({
      type: 'update', target: 'map', targetId: map.id, baseVersion: base,
      changes: { name: 'Renomeado por C' },
    }), DISPUTADOS, ['nome'], 'C renomeia da base velha');

    assert.equal((await linha('maps', map.id)).name, 'Renomeado por A',
      'e o nome de A continua lá: nada foi sobrescrito em silêncio');
  });

  it('MAPA: base que não existe é conflito, e a recusa não é sobre campo nenhum', async () => {
    const map = await createMap(db, atlas.id, { name: 'Base impossivel' });
    const ack = await uma({
      type: 'update', target: 'map', targetId: map.id, baseVersion: 99,
      changes: { name: 'Do futuro' },
    });
    conflito(ack, SEM_BASE, [], 'base 99 sobre versão 1');
    assert.equal((await linha('maps', map.id)).name, 'Base impossivel', 'e nada foi escrito');
  });

  it('MAPA: op SEM base continua LWW por chegada (o regime de degradação)', async () => {
    // ESTE CASO DEIXOU DE SER UM CONTRASTE COM O CLIENTE em 2026-09-13 (B5, item 2): desde então o
    // mapa DECLARA base nos seus sítios de escrita (`frontend/src/js/store/map-revision.js`, com
    // censo em `frontend/tests/unit/mapa-declara-base-censo.test.js`). O que ele mede agora é o
    // regime de DEGRADAÇÃO, que segue sendo caminho normal e não erro: atlas local, documento cuja
    // revisão de servidor o cliente não consegue provar, build anterior ao campo. Se ele ficar
    // vermelho, a moldura passou a EXIGIR base, e aí para de sincronizar todo mapa cujo documento
    // não carrega revisão nenhuma.
    const map = await createMap(db, atlas.id, { name: 'Sem base' });
    const base = await versaoDe('maps', map.id);

    const primeiro = await uma({ type: 'update', target: 'map', targetId: map.id, changes: { name: 'Primeiro' } });
    assert.equal(primeiro.rejected, undefined, 'a primeira op sem base é aplicada');
    assert.equal(primeiro.entityVersion, undefined,
      'e NÃO ganha `entityVersion`: sem base não há revisão, e prometer uma seria convidar o '
      + 'cliente a usá-la como se houvesse');

    const segundo = await uma({ type: 'update', target: 'map', targetId: map.id, changes: { name: 'Segundo' } });
    assert.equal(segundo.rejected, undefined, 'e a segunda também, mesmo partindo da mesma leitura');

    const depois = await linha('maps', map.id);
    assert.equal(depois.name, 'Segundo', 'quem chegou depois venceu, como antes');
    assert.equal(Number(depois.version), base + 2, 'e as duas escritas contaram');
  });

  it('MAPA: delete com base velha é recusado, porque excluir reivindica a entidade inteira', async () => {
    const map = await createMap(db, atlas.id, { name: 'Excluir tarde' });
    const base = await versaoDe('maps', map.id);
    aplicada(await uma({
      type: 'update', target: 'map', targetId: map.id, baseVersion: base, changes: { name: 'Mexido' },
    }), base + 1, 'alguém edita');

    conflito(await uma({ type: 'delete', target: 'map', targetId: map.id, baseVersion: base }),
      ALTERADO_ANTES_DA_EXCLUSAO, ['*'], 'delete da base anterior');
    assert.equal((await linha('maps', map.id)).deleted_at, null, 'o mapa continua vivo');

    aplicada(await uma({ type: 'delete', target: 'map', targetId: map.id, baseVersion: base + 1 }),
      base + 2, 'delete rebaseado');
    assert.ok((await linha('maps', map.id)).deleted_at, 'e agora ele foi');
  });

  it('MAPA: update com base sobre linha já excluída é recusado pela frase do túmulo', async () => {
    const map = await createMap(db, atlas.id, { name: 'Tumulo com base' });
    const base = await versaoDe('maps', map.id);
    await uma({ type: 'delete', target: 'map', targetId: map.id, baseVersion: base });

    conflito(await uma({
      type: 'update', target: 'map', targetId: map.id, baseVersion: base, changes: { name: 'Tarde' },
    }), EXCLUIDO, ['*'], 'update sobre túmulo');
  });

  // ==========================================================================
  // CAMADA e GRUPO — o par de entidades de mapa com as mesmas unidades
  // ==========================================================================

  it('CAMADA: nome e opacidade convergem; o segundo nome da mesma base é conflito', async () => {
    const map = await createMap(db, atlas.id, { name: 'Mapa da camada' });
    const layer = await createLayer(db, map.id, { name: 'Camada original' });
    const base = await versaoDe('layers', layer.id);

    aplicada(await uma({
      type: 'update', target: 'layer', targetId: layer.id, mapId: map.id, baseVersion: base,
      changes: { name: 'Camada de A' },
    }), base + 1, 'A renomeia');
    aplicada(await uma({
      type: 'update', target: 'layer', targetId: layer.id, mapId: map.id, baseVersion: base,
      changes: { opacity: 0.25 },
    }), base + 2, 'B muda a opacidade da MESMA base');

    const depois = await linha('layers', layer.id);
    assert.equal(depois.name, 'Camada de A', 'o nome de A sobreviveu');
    assert.equal(Number(depois.opacity), 0.25, 'e a opacidade de B entrou');

    conflito(await uma({
      type: 'update', target: 'layer', targetId: layer.id, mapId: map.id, baseVersion: base,
      changes: { name: 'Camada de C' },
    }), DISPUTADOS, ['nome'], 'C renomeia da base velha');
    assert.equal((await linha('layers', layer.id)).name, 'Camada de A', 'nada sobrescrito');
  });

  it('CAMADA: o alias `order` é comparado como a unidade `ordem`, e não como coluna nenhuma', async () => {
    // O CLIENTE MANDA `order`; A COLUNA É `sort_order`. `declaredUpdateColumns` resolve o alias com
    // o MESMO normalizador do statement, porque um alias comparado como "nenhuma coluna" seria
    // escrito sem disputa alguma — a sobrescrita silenciosa entrando pela porta do apelido.
    const map = await createMap(db, atlas.id, { name: 'Mapa da ordem' });
    const layer = await createLayer(db, map.id, { sort_order: 0 });
    const base = await versaoDe('layers', layer.id);

    aplicada(await uma({
      type: 'update', target: 'layer', targetId: layer.id, mapId: map.id, baseVersion: base,
      changes: { order: 7 },
    }), base + 1, 'A reordena pelo alias');
    assert.equal(Number((await linha('layers', layer.id)).sort_order), 7, 'a coluna recebeu o valor');

    conflito(await uma({
      type: 'update', target: 'layer', targetId: layer.id, mapId: map.id, baseVersion: base,
      changes: { order: 9 },
    }), DISPUTADOS, ['ordem'], 'B reordena da mesma base');
    assert.equal(Number((await linha('layers', layer.id)).sort_order), 7, 'e a ordem de A ficou');
  });

  it('GRUPO: nome e visibilidade convergem; o segundo nome da mesma base é conflito', async () => {
    const map = await createMap(db, atlas.id, { name: 'Mapa do grupo' });
    const group = await createGroup(db, map.id, { name: 'Grupo original' });
    const base = await versaoDe('groups', group.id);

    aplicada(await uma({
      type: 'update', target: 'group', targetId: group.id, mapId: map.id, baseVersion: base,
      changes: { name: 'Grupo de A' },
    }), base + 1, 'A renomeia');
    aplicada(await uma({
      type: 'update', target: 'group', targetId: group.id, mapId: map.id, baseVersion: base,
      changes: { visible: false },
    }), base + 2, 'B esconde da MESMA base');

    const depois = await linha('groups', group.id);
    assert.equal(depois.name, 'Grupo de A', 'o nome de A sobreviveu');
    assert.equal(depois.visible, false, 'e a visibilidade de B entrou');

    conflito(await uma({
      type: 'update', target: 'group', targetId: group.id, mapId: map.id, baseVersion: base,
      changes: { name: 'Grupo de C' },
    }), DISPUTADOS, ['nome'], 'C renomeia da base velha');
  });

  // ==========================================================================
  // COMENTÁRIO — a unidade que obrigou a estreitar a ESCRITA
  // ==========================================================================

  const criarComentario = async (mapId) => {
    const id = randomUUID();
    await db.query(
      `INSERT INTO comments (id, atlas_id, map_id, author_id, lng, lat, data)
       VALUES ($1, $2, $3, $4, -43.2, -22.9, $5::jsonb)`,
      [id, atlas.id, mapId, userId, JSON.stringify({ texto: 'Texto original' })],
    );
    return id;
  };

  it('COMENTÁRIO: resolver e editar o texto são unidades diferentes, e resolver NÃO apaga o texto', async () => {
    // AQUI A TABELA DE UNIDADES SERIA MENTIRA SEM A ESTREITADA DA ESCRITA. O statement grava
    // `data` inteiro; um `{ status: 'resolved' }` que declara só a unidade `resolvido` gravaria
    // `data = {"status":"resolved"}` e apagaria o texto que acabou de ser declarado independente.
    const map = await createMap(db, atlas.id, { name: 'Mapa do comentario' });
    const id = await criarComentario(map.id);
    const base = await versaoDe('comments', id);

    aplicada(await uma({
      type: 'update', target: 'comment', targetId: id, mapId: map.id, baseVersion: base,
      changes: { texto: 'Texto de A' },
    }), base + 1, 'A edita o texto');
    aplicada(await uma({
      type: 'update', target: 'comment', targetId: id, mapId: map.id, baseVersion: base,
      changes: { status: 'resolved' },
    }), base + 2, 'B resolve a partir da MESMA base');

    const depois = await linha('comments', id);
    assert.equal(depois.status, 'resolved', 'a thread foi resolvida');
    assert.equal(depois.data.texto, 'Texto de A',
      'e o texto de A sobreviveu: a escrita foi estreitada à unidade que B declarou');

    conflito(await uma({
      type: 'update', target: 'comment', targetId: id, mapId: map.id, baseVersion: base,
      changes: { texto: 'Texto de C' },
    }), DISPUTADOS, ['texto'], 'C edita o texto da base velha');
    assert.equal((await linha('comments', id)).data.texto, 'Texto de A', 'nada sobrescrito');
  });

  it('COMENTÁRIO: SEM base, o update continua gravando `data` inteiro (contraste)', async () => {
    // A estreitada é do REGIME, não do statement: quem não declara base escreve como sempre
    // escreveu. Se este caso ficar vermelho, a mudança escapou para o cliente atual.
    const map = await createMap(db, atlas.id, { name: 'Comentario sem base' });
    const id = await criarComentario(map.id);

    await uma({
      type: 'update', target: 'comment', targetId: id, mapId: map.id,
      changes: { status: 'resolved' },
    });
    const depois = await linha('comments', id);
    assert.equal(depois.status, 'resolved', 'resolveu');
    assert.equal(depois.data.texto, undefined,
      'e o `data` foi substituído inteiro, como antes da moldura');
  });

  // ==========================================================================
  // BRIEFING e SLIDE
  // ==========================================================================

  it('BRIEFING: nome e settings convergem; o segundo nome da mesma base é conflito', async () => {
    const briefing = await createBriefing(db, atlas.id, { name: 'Briefing original' });
    const base = await versaoDe('briefings', briefing.id);

    aplicada(await uma({
      type: 'update', target: 'briefing', targetId: briefing.id, baseVersion: base,
      changes: { name: 'Briefing de A' },
    }), base + 1, 'A renomeia');
    aplicada(await uma({
      type: 'update', target: 'briefing', targetId: briefing.id, baseVersion: base,
      changes: { settings: { panelWidth: 500 } },
    }), base + 2, 'B muda settings da MESMA base');

    const depois = await linha('briefings', briefing.id);
    assert.equal(depois.name, 'Briefing de A', 'o nome de A sobreviveu');
    assert.equal(depois.settings.panelWidth, 500, 'e os settings de B entraram');

    conflito(await uma({
      type: 'update', target: 'briefing', targetId: briefing.id, baseVersion: base,
      changes: { name: 'Briefing de C' },
    }), DISPUTADOS, ['nome'], 'C renomeia da base velha');
  });

  it('SLIDE: título e conteúdo convergem, e o título NÃO apaga a referência de mapa', async () => {
    // A SEGUNDA ESTREITADA. `applyOperation` atribui `op.changes.map_id` em TODO update de slide
    // (via `resolveSlideMapId`, que devolve null quando não há nada a resolver). Sem a estreitada,
    // uma edição de título apagaria o `map_id` do slide e, pior, teria de se declarar disputando a
    // unidade `alvo` — o que faria todo par de edições de slide conflitar.
    const map = await createMap(db, atlas.id, { name: 'Mapa do slide' });
    const briefing = await createBriefing(db, atlas.id, { name: 'Briefing dos slides' });
    const slide = await createSlide(db, briefing.id, { title: 'Slide original', map_id: map.id });
    const base = await versaoDe('slides', slide.id);

    aplicada(await uma({
      operationType: 'update', entityType: 'slide', entityId: slide.id, mapId: briefing.id,
      baseVersion: base, changes: { title: 'Slide de A' },
    }), base + 1, 'A muda o título');
    assert.equal((await linha('slides', slide.id)).map_id, map.id,
      'e a referência de mapa continua lá: a escrita não saiu da unidade `titulo`');

    aplicada(await uma({
      operationType: 'update', entityType: 'slide', entityId: slide.id, mapId: briefing.id,
      baseVersion: base, changes: { content: 'Conteudo de B' },
    }), base + 2, 'B muda o conteúdo da MESMA base');

    const depois = await linha('slides', slide.id);
    assert.equal(depois.title, 'Slide de A', 'o título de A sobreviveu');
    assert.equal(depois.content, 'Conteudo de B', 'e o conteúdo de B entrou');

    conflito(await uma({
      operationType: 'update', entityType: 'slide', entityId: slide.id, mapId: briefing.id,
      baseVersion: base, changes: { title: 'Slide de C' },
    }), DISPUTADOS, ['titulo'], 'C muda o título da base velha');
  });

  // ==========================================================================
  // AS TRÊS DE DOCUMENTO INTEIRO — uma unidade só, e nenhuma linha de fronteira
  // ==========================================================================

  /**
   * O arranjo das três de documento inteiro é o mesmo: A com a base corrente entra, B com a MESMA
   * base é conflito nomeando `documento`, e B REBASEADO entra. O terceiro passo é o controle
   * absoluto: sem ele, "B foi recusado" não distingue a base velha de uma entidade que parou de
   * aceitar update nenhum.
   */
  const documentoInteiro = async ({ nome, tabela, id, mapId, escrita, leitura }) => {
    const base = await versaoDe(tabela, id);
    aplicada(await uma(escrita('A', base)), base + 1, `${nome}: A escreve`);
    assert.equal(await leitura(), 'A', `${nome}: a escrita de A entrou`);

    conflito(await uma(escrita('B', base)), DISPUTADOS, [DOCUMENTO], `${nome}: B da mesma base`);
    assert.equal(await leitura(), 'A', `${nome}: e a de A continua lá`);
    assert.equal(await versaoDe(tabela, id), base + 1, `${nome}: a versão não andou na recusa`);

    aplicada(await uma(escrita('B', base + 1)), base + 2, `${nome}: B rebaseado`);
    assert.equal(await leitura(), 'B', `${nome}: agora a escrita de B entrou`);
    assert.ok(mapId, `${nome}: o caso foi montado num mapa deste atlas`);
  };

  it('CAMADA DE CATÁLOGO: o documento é uma unidade só, e ela não guarda fronteira (id é TEXT)', async () => {
    const map = await createMap(db, atlas.id, { name: 'Mapa do catalogo' });
    const id = 'camada-local-de-teste';
    await db.query(
      `INSERT INTO catalog_layers (id, map_id, data) VALUES ($1, $2, $3::jsonb)`,
      [id, map.id, JSON.stringify({ nome: 'original' })],
    );
    await documentoInteiro({
      nome: 'catalog_layer', tabela: 'catalog_layers', id, mapId: map.id,
      escrita: (quem, baseVersion) => ({
        operationType: 'update', entityType: 'catalogLayer', entityId: id, mapId: map.id,
        baseVersion, changes: { nome: quem },
      }),
      leitura: async () => (await linha('catalog_layers', id)).data.nome,
    });
    // E A PROVA DE QUE NÃO HÁ FRONTEIRA: o id é TEXT e a coluna de `sync_entity_fields` é UUID, de
    // modo que uma linha ali seria impossível de gravar. A ausência é a decisão, não um esquecimento.
    const { rows } = await db.query(
      `SELECT count(*)::int AS n FROM sync_entity_fields WHERE atlas_id = $1 AND entity_type = 'catalog_layer'`,
      [atlas.id],
    );
    assert.equal(rows[0].n, 0, 'nenhuma linha de fronteira para camada de catálogo');
  });

  it('3D: o documento é uma unidade só, e a base velha é recusada', async () => {
    const map = await createMap(db, atlas.id, { name: 'Mapa do 3D' });
    const id = randomUUID();
    // `tileset_id: null` de propósito: uma medição não referencia recurso de catálogo, então este
    // caso mede a revisão e não o gate de visibilidade.
    await uma({
      type: 'create', target: 'cesium3d', targetId: id, mapId: map.id,
      data: { data_type: 'measurement', tileset_id: null, data: { autor: 'original' } },
    });
    await documentoInteiro({
      nome: 'cesium3d', tabela: 'cesium3d_data', id, mapId: map.id,
      escrita: (quem, baseVersion) => ({
        type: 'update', target: 'cesium3d', targetId: id, mapId: map.id,
        baseVersion, changes: { data: { autor: quem } },
      }),
      leitura: async () => (await linha('cesium3d_data', id)).data.autor,
    });
  });

  it('360: o documento é uma unidade só, e a base velha é recusada', async () => {
    const map = await createMap(db, atlas.id, { name: 'Mapa do 360' });
    const row = await createStreetview360Data(db, map.id, { data: { autor: 'original' } });
    await documentoInteiro({
      nome: 'streetview360', tabela: 'streetview360_data', id: row.id, mapId: map.id,
      escrita: (quem, baseVersion) => ({
        type: 'update', target: 'streetview360', targetId: row.id, mapId: map.id,
        baseVersion, changes: { data: { autor: quem } },
      }),
      leitura: async () => (await linha('streetview360_data', row.id)).data.autor,
    });
  });

  // ==========================================================================
  // A FRONTEIRA DURÁVEL — o que a torna diferente do log de operações
  // ==========================================================================

  it('a fronteira é gravada por unidade, com o `entity_type` real da entidade', async () => {
    // Se o `entity_type` fosse fixo em `'feature'` (o literal que havia antes da moldura), a
    // fronteira de um mapa colidiria com a de uma feição de MESMO id, e a de duas entidades
    // diferentes se sobrescreveriam. A chave primária é (atlas, entity_type, entity_id).
    const map = await createMap(db, atlas.id, { name: 'Fronteira' });
    const base = await versaoDe('maps', map.id);
    await uma({
      type: 'update', target: 'map', targetId: map.id, baseVersion: base,
      changes: { name: 'Com fronteira' },
    });

    const { rows } = await db.query(
      `SELECT entity_type, entity_version, field_versions FROM sync_entity_fields
       WHERE atlas_id = $1 AND entity_id = $2`, [atlas.id, map.id],
    );
    assert.equal(rows.length, 1, 'uma linha de fronteira para este mapa');
    assert.equal(rows[0].entity_type, 'map', 'gravada sob o tipo REAL da entidade');
    assert.equal(Number(rows[0].entity_version), base + 1, 'na versão que a entidade commitou');
    assert.deepEqual(rows[0].field_versions, { '*': base, nome: base + 1 },
      'com a unidade escrita na versão nova e o resto na base anterior');
  });

  it('a fronteira é DESCARTADA quando a versão da linha andou fora do sync', async () => {
    // A DEGRADAÇÃO É A PROPRIEDADE DE SEGURANÇA, não um remendo para dado ausente: uma versão
    // alcançada por import REST, merge ou migração deixa uma fronteira que descreve um estado que
    // ninguém reconstrói, e herdá-la entregaria a um cliente atrasado uma base que ele nunca
    // observou. Conservador aqui é `{'*': versão corrente}`, que recusa toda base abaixo dela.
    const map = await createMap(db, atlas.id, { name: 'Fora do sync' });
    const base = await versaoDe('maps', map.id);
    await uma({
      type: 'update', target: 'map', targetId: map.id, baseVersion: base, changes: { name: 'Pelo sync' },
    });
    // Uma escrita que NÃO passa pelo sync: a fronteira fica descrevendo a versão anterior.
    await db.query('UPDATE maps SET notes_title = $2, version = version + 1 WHERE id = $1',
      [map.id, 'Por fora']);
    const atual = await versaoDe('maps', map.id);

    conflito(await uma({
      type: 'update', target: 'map', targetId: map.id, baseVersion: base + 1,
      changes: { notes_title: 'Pelo sync de novo' },
    }), DISPUTADOS, ['notas'], 'a base que a fronteira velha teria abonado');

    aplicada(await uma({
      type: 'update', target: 'map', targetId: map.id, baseVersion: atual,
      changes: { notes_title: 'Pelo sync de novo' },
    }), atual + 1, 'e a base corrente entra');
  });
});
