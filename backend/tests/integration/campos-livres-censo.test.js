// Path: tests/integration/campos-livres-censo.test.js
//
// F14 — O CENSO DA ENTRADA, gêmeo do censo de saídas da F13.
//
// A F13 fechou a saída por ESTRUTURA (um estrangulamento por onde tudo passa) mais um CENSO que
// reprova saída nova não classificada. A F14 fecha a entrada da mesma forma, e sem este arquivo a
// metade estrutural estaria faltando: uma coluna `jsonb` nova nasceria aceitando grafo arbitrário e
// nada ficaria vermelho. Uma borda é tão boa quanto o guarda que impede a próxima de nascer aberta.
//
// O QUE ELE COBRA. Toda coluna `jsonb` do schema `public` precisa estar classificada abaixo, com
// UM regime e um motivo. Colunas novas reprovam com o nome delas na mensagem; classificações que
// apontam para coluna inexistente também reprovam, senão o inventário envelheceria para o outro
// lado (o defeito clássico de lista escrita à mão).
//
// OS REGIMES, e a diferença entre eles é um argumento medido, não um gosto:
//   CLOSED    — a forma foi lida nos ESCRITORES e é escalar. `free-field.schemas.js` guarda só o
//               que casa; o resto é descartado.
//   SCRUBBED  — é domínio do produto e não se enumera. Só a definição de recurso sai, em qualquer
//               profundidade.
//   DERIVED   — espelho das colunas acima (o log de operações), sem borda própria: o que entra
//               nele já passou pelo esquema de op.
//   NOT_CLIENT— não é escrito por carga de cliente de atlas. Cada um traz QUEM escreve, porque
//               "não é do cliente" é exatamente o tipo de afirmação que envelhece.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';

/** coluna -> [regime, motivo]. `motivo` é cobrado como texto não vazio, para não virar tabela muda. */
const CENSO = {
  // ---- CLOSED --------------------------------------------------------------
  'maps.grid_style': ['CLOSED', '{format, visible} — grid.control.js é o único escritor'],
  'maps.temporal_config': ['CLOSED', '{ativo, modo, unidade, inicio, fim, origem}, todos escalares'],
  'layers.style': ['CLOSED', 'sem escritor no frontend (o typedef Layer não tem o campo)'],
  'groups.style': ['CLOSED', 'idem layers.style'],
  'briefings.settings': ['CLOSED', '{panelPosition, panelWidth, panelBackgroundColor}'],
  'slides.position': ['CLOSED', '{longitude, latitude, zoom, altitude}'],
  'slides.orientation': ['CLOSED', '{bearing, pitch, heading, lon, lat, fov}'],
  'slides.temporal_cursor': ['CLOSED', 'número (epoch ms) ou null'],
  'comments.data': ['CLOSED', 'comment.operations.js escreve só escalares; `text` é texto livre (teto)'],
  // AS TRÊS JSONB QUE NÃO SÃO DO ATLAS E MESMO ASSIM VÊM DE UM CLIENTE: telemetria de erro do
  // navegador, escrita por rota REST própria e ANÔNIMA, não por op de sync. A tabela se chamava
  // `client_errors` até `018_defeitos_e_ocorrencias.sql`.
  'defeitos.contexto': ['CLOSED',
    'forma fechada campo a campo no Joi de src/modules/diag/diag.schemas.js: cinco chaves '
    + 'ESCALARES (atlasKind, conexao, causa, camada, status), com unknown(false), que ali RECUSA '
    + 'a chave extra com 422 em vez de descartá-la. Escritor único: POST /diag/erro-cliente '
    + '(017_erro_cliente_identidade.sql). NÃO passa por free-field.schemas.js, e não deve passar: '
    + 'aquele guarda carga de ATLAS que chega por op de sync, e esta coluna não é carga de atlas.'],
  'defeito_ocorrencias.contexto': ['CLOSED',
    'a MESMA coluna da linha acima, copiada para a ocorrência pelo mesmo escritor e validada '
    + 'pelo mesmo Joi: o defeito guarda o contexto do relato mais recente, e a ocorrência guarda '
    + 'o daquele avistamento. Dois destinos, uma borda só (gravarDefeitoComOcorrencia, '
    + 'src/modules/diag/defeitos.service.js).'],
  'defeito_ocorrencias.migalhas': ['CLOSED',
    'ARRAY de até 30 itens, cada um um objeto de três chaves ESCALARES (t inteiro, tipo até 20 '
    + 'caracteres, texto até 120), com unknown(false) NO ITEM, que ali RECUSA a chave extra com '
    + '422 em vez de descartá-la (o mesmo efeito medido do contexto). O teto é DUPLO, itens e '
    + 'tamanho de cada campo, porque sem o de itens um cliente com defeito mandaria a sessão '
    + 'inteira. Escritor único: POST /diag/erro-cliente. O caminho do SERVIDOR '
    + '(defeitos-de-servidor.js) nunca escreve esta coluna: não há navegador para deixar rastro.'],

  // ---- SCRUBBED ------------------------------------------------------------
  'maps.analysis_layers': ['SCRUBBED', 'domínio de grade, com valor aninhado em contrato (los_result_*, {grid:{...}})'],
  'catalog_layers.data': ['SCRUBBED', 'chaves abertas por contrato (sourceId, nome); `name`/`config` do topo são o teto'],
  'features.geometry': ['SCRUBBED', 'GeoJSON de 21 tipos'],
  'features.properties': ['SCRUBBED', '~90 chaves medidas, dependentes do tipo de feição'],
  'cesium3d_data.data': ['SCRUBBED', 'domínio 3D, 28 chaves medidas'],
  'streetview360_data.data': ['SCRUBBED', 'domínio 360, 18 chaves medidas'],
  'atlas.settings': ['SCRUBBED', 'allowlist de CHAVE já existe em sync.service.js; o VALOR é varrido'],

  // ---- DERIVED -------------------------------------------------------------
  'operations.data': ['DERIVED', 'espelho da carga da op, que já passou por sync.schemas.js'],
  'operations.changes': ['DERIVED', 'idem operations.data'],

  // ---- NOT_CLIENT ----------------------------------------------------------
  'audit_trail.details': ['NOT_CLIENT', 'escrito por createAudit, no servidor'],
  'config_settings.value': ['NOT_CLIENT', 'escrito por administrador, pela rota de configuração'],
  'basemaps.config': ['NOT_CLIENT', 'catálogo: escrito por admin/produtor, e É a definição'],
  'data_layers.config': ['NOT_CLIENT', 'idem basemaps.config'],
  'analysis_layers.config': ['NOT_CLIENT', 'idem basemaps.config'],
  'tilesets.config': ['NOT_CLIENT', 'idem basemaps.config'],

  // FORA DO SCHEMA `public`. Ate 2026-08-19 a varredura olhava so `public`, entao estas duas
  // eram INVISIVEIS para o censo. Nenhuma e escrita por carga de cliente do atlas hoje, logo
  // nada vazava; o censo existe para que a PROXIMA coluna nao possa nascer aberta, e ele nao
  // pode fazer isso em dois dos tres schemas se nao os enxergar.
  'sv360.project_floors.plan_coords': ['NOT_CLIENT', 'ingestao de projeto 360: escrito pelo servidor a partir do bundle'],
};

const REGIMES = new Set(['CLOSED', 'SCRUBBED', 'DERIVED', 'NOT_CLIENT']);

describe('F14 — censo dos campos JSONB: coluna nova não nasce sem regime', () => {
  let db;

  before(async () => {
    const env = await setupTestEnv();
    db = env.db;
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  it('o inventário é bem formado: regime válido e motivo escrito em cada linha', () => {
    const entradas = Object.entries(CENSO);
    assert.ok(entradas.length >= 20, 'o inventário precisa ter conteúdo, senão nada abaixo discrimina');
    for (const [coluna, [regime, motivo]] of entradas) {
      assert.ok(REGIMES.has(regime), `${coluna}: regime desconhecido (${regime})`);
      assert.ok(typeof motivo === 'string' && motivo.length > 10, `${coluna}: o motivo precisa estar escrito`);
    }
  });

  it('toda coluna `jsonb` do schema do atlas está classificada, e toda classificação existe', async () => {
    const { rows } = await db.query(`
      SELECT table_schema, table_name, column_name
      FROM information_schema.columns
      WHERE table_schema IN ('public', 'ng', 'sv360') AND data_type = 'jsonb'
      ORDER BY table_schema, table_name, column_name
    `);
    // A chave fica SEM prefixo no `public` (as 25 entradas nasceram assim) e COM prefixo de schema
    // fora dele, para que `sv360.project_floors` e `ng.zone_permissions` nunca colidam com um homonimo
    // de `public` que alguem venha a criar.
    const reais = rows.map((r) => (r.table_schema === 'public'
      ? `${r.table_name}.${r.column_name}`
      : `${r.table_schema}.${r.table_name}.${r.column_name}`));
    // PISO: sem ele, um `information_schema` que respondesse vazio deixaria os dois conjuntos
    // iguais e o caso verde sobre nada.
    assert.ok(reais.length >= 22, `a varredura precisa achar as colunas (achou ${reais.length})`);

    const declaradas = new Set(Object.keys(CENSO));
    const novas = reais.filter((c) => !declaradas.has(c));
    assert.deepEqual(
      novas, [],
      `coluna JSONB sem regime declarado em tests/integration/campos-livres-censo.test.js: ${novas.join(', ')}. `
      + 'Escolha CLOSED (forma lida nos escritores) ou SCRUBBED (domínio), ligue-a em '
      + 'src/modules/sync/free-field.schemas.js, e escreva o motivo.',
    );

    const sumidas = [...declaradas].filter((c) => !reais.includes(c));
    assert.deepEqual(sumidas, [], `classificação apontando para coluna que não existe mais: ${sumidas.join(', ')}`);
  });
});
