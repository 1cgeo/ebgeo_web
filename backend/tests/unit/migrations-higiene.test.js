// Path: tests/unit/migrations-higiene.test.js
// Item 103 — higiene das migrações: numeração, aditividade forward-only e
// contenção do PostGIS fora do schema do atlas.
//
// Três invariantes do projeto que existiam só em prosa (CLAUDE.md "Migrações" e
// "Geometria do atlas é JSONB … nunca adicione PostGIS ao schema do atlas") e são
// verificáveis por leitura dos .sql, sem banco.
//
// REFUTAÇÃO PARCIAL do relatório: o caso proposto era "nenhum arquivo contém
// DROP TABLE / DROP COLUMN / TRUNCATE / ALTER COLUMN ... TYPE". Contra o HEAD isso
// é FALSO por decisão registrada — `006_catalog_layer_text_id.sql` alarga
// `catalog_layers.id` de UUID para TEXT e refaz a PK, e `007_audit_zone_actions.sql`
// alarga o CHECK de `audit_trail.action`; ambas documentam por que o alargamento é
// seguro. Uma regra literal reprovaria as duas e seria desligada no primeiro uso.
// O invariante REAL, e o que este arquivo prende, é: DDL destrutiva só existe na
// LISTA DE EXCEÇÕES abaixo. Um `DROP COLUMN` novo, num arquivo novo, reprova.
//
// Cada regra devolve a LISTA de violações e afirma que ela é vazia, mais a
// contagem do que foi inspecionado: varredura vazia que passa verde é a família de
// verde-que-não-verifica que já ocorreu neste repositório.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../src/database/migrations');

const FILES = fs.readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();
const SRC = new Map(FILES.map((f) => [f, fs.readFileSync(path.join(DIR, f), 'utf8')]));

/** Linhas de código (comentário `--` e linha em branco fora). */
function linhasDeCodigo(sql) {
  return sql
    .split('\n')
    .map((texto, i) => ({ n: i + 1, texto }))
    .filter(({ texto }) => texto.trim() !== '' && !texto.trim().startsWith('--'));
}

/** Todas as linhas de código de todos os arquivos, com o nome do arquivo. */
function todasAsLinhas(arquivos = FILES) {
  return arquivos.flatMap((f) => linhasDeCodigo(SRC.get(f) ?? '').map((l) => ({ arquivo: f, ...l })));
}

// DDL destrutiva DELIBERADA, com o arquivo onde mora. Adicionar uma linha aqui é
// o ato explícito que a convenção exige; esquecer de adicionar reprova o teste.
const EXCECOES_DESTRUTIVAS = [
  { arquivo: '006_catalog_layer_text_id.sql', trecho: 'ALTER TABLE catalog_layers ALTER COLUMN id TYPE TEXT' },
  { arquivo: '006_catalog_layer_text_id.sql', trecho: 'ALTER TABLE catalog_layers DROP CONSTRAINT catalog_layers_pkey' },
  { arquivo: '007_audit_zone_actions.sql', trecho: 'ALTER TABLE audit_trail DROP CONSTRAINT audit_trail_action_check' },
  // ALARGAR um CHECK é compatível para trás — todo valor aceito antes continua
  // aceito — mas Postgres não tem `ALTER CONSTRAINT` para expressão de CHECK, então
  // o constraint precisa cair e voltar. Mesmo alargamento de 007, e o custo é esta
  // linha: sem ela a suíte fica vermelha com uma mensagem sobre "DDL destrutiva não
  // documentada", que não parece ter relação nenhuma com permissões.
  { arquivo: '018_papeis_globais.sql', trecho: 'ALTER TABLE users DROP CONSTRAINT users_role_check' },
  // 020 dispara TRÊS padrões ao mesmo tempo: dois CHECK que precisam cair para
  // alargar (mesmo caso de 007) e o `target_id` UUID -> TEXT, que é o mesmo
  // alargamento de 006 pelo mesmo motivo — o id do domínio nunca foi UUID (slug
  // de catálogo, chave textual de config). Nenhuma das três perde linha nem
  // invalida consulta; `idx_audit_target` é reconstruído pelo próprio ALTER.
  { arquivo: '020_auditoria_alvo_e_acoes.sql', trecho: 'ALTER TABLE audit_trail DROP CONSTRAINT audit_trail_action_check' },
  { arquivo: '020_auditoria_alvo_e_acoes.sql', trecho: 'ALTER TABLE audit_trail DROP CONSTRAINT audit_trail_target_type_check' },
  { arquivo: '020_auditoria_alvo_e_acoes.sql', trecho: 'ALTER TABLE audit_trail ALTER COLUMN target_id TYPE TEXT' },
  // 021 dispara três: um `DROP TABLE` de verdade e dois CHECK que caem para alargar.
  //
  // O `DROP TABLE` é o ÚNICO desta lista que apaga dados, e por isso é o único que
  // precisa de mais do que "alargar é compatível para trás" como justificativa.
  // `streetview_markers` nasceu de `LIKE basemaps INCLUDING ALL` em 003 e nunca teve
  // consumidor: não alimentava `GET /api/config`, nenhum código do frontend chamava a
  // rota dela, nenhum seed a populava, e as únicas escritas que já existiram foram de
  // teste. O que ela custava era ambiguidade — existe um ARQUIVO homônimo no frontend
  // (`street_view_tool/streetview_markers.js`) que é a camada VIVA de marcadores do
  // 360 e lê de `sv360.projects`.
  //
  // Os dois CHECK caem para receber `basemap` como quinto tipo de recurso: mesmo
  // alargamento de 007/018/020, e todo valor aceito antes continua aceito.
  { arquivo: '021_catalogo_quatro_tabelas.sql', trecho: 'DROP TABLE streetview_markers' },
  { arquivo: '021_catalogo_quatro_tabelas.sql', trecho: 'ALTER TABLE resource_grants DROP CONSTRAINT resource_grants_resource_type_check' },
  { arquivo: '021_catalogo_quatro_tabelas.sql', trecho: 'ALTER TABLE atlas_resources DROP CONSTRAINT atlas_resources_resource_type_check' },
  // 022 apaga uma COLUNA com dado dentro, e é a segunda desta lista (junto com o
  // `DROP TABLE` da 021) que precisa de mais do que "alargar é compatível para
  // trás" como justificativa.
  //
  // A justificativa é a materialização que vem ANTES dela no mesmo arquivo: cada
  // item do array legado vira linha da tabela dedicada `catalog_layers`, com a
  // linha viva vencendo por id. Nenhuma camada de catálogo se perde; o que se
  // perde é a SEGUNDA cópia dela, que não tinha leitor e servia a definição de
  // recurso privado por três rotas que não passam pela reidratação do snapshot.
  { arquivo: '022_camada_de_catalogo_sem_coluna_legada.sql', trecho: 'ALTER TABLE maps DROP COLUMN catalog_layers' },
];

const PADROES_DESTRUTIVOS = [
  /\bDROP\s+TABLE\b/i,
  /\bDROP\s+COLUMN\b/i,
  /\bTRUNCATE\b/i,
  /\bALTER\s+COLUMN\s+\w+\s+TYPE\b/i,
  /\bDROP\s+CONSTRAINT\b/i,
];

const NUCLEO = ['001_core.sql', '002_atlas.sql', '003_sync.sql'];
const ESPACIAIS = { '004_ng.sql': 'ng', '005_sv360.sql': 'sv360' };

describe('Higiene das migrações (item 103)', () => {
  it('guarda: há migrações suficientes e nenhuma vazia', () => {
    assert.ok(FILES.length >= 5, `esperava >= 5 migrações, achei ${FILES.length}`);
    const vazias = FILES.filter((f) => (SRC.get(f) ?? '').trim() === '');
    assert.deepEqual(vazias, [], 'migração vazia');
    const linhas = todasAsLinhas();
    assert.ok(linhas.length >= 400, `esperava >= 400 linhas de DDL, achei ${linhas.length}`);
  });

  it('todo arquivo casa NNN_nome.sql, os números são únicos e sort() == ordem numérica', () => {
    assert.ok(FILES.length >= 5);
    const foraDoPadrao = FILES.filter((f) => !/^\d{3}_[a-z0-9_-]+\.sql$/.test(f));
    assert.deepEqual(foraDoPadrao, [], 'nome de migração fora do padrão NNN_nome.sql');

    const nums = FILES.map((f) => Number(f.slice(0, 3)));
    assert.equal(nums.length, FILES.length);
    assert.equal(new Set(nums).size, nums.length, `numeração duplicada: ${nums.join(',')}`);

    // migrate.js aplica na ordem de files.sort(); ela precisa coincidir com a
    // ordem numérica, senão um futuro `10_x.sql` rodaria antes de `002_`.
    assert.deepEqual(nums, [...nums].sort((a, b) => a - b), 'a ordem alfabética divergiu da numérica');
  });

  it('nenhuma migração usa uuid_generate_v4 e toda PK UUID com DEFAULT usa gen_random_uuid()', () => {
    assert.ok(FILES.length >= 5);
    const legado = FILES.filter((f) => /uuid_generate_v4/i.test(SRC.get(f)));
    assert.deepEqual(legado, [], 'uuid_generate_v4 é proibido; a convenção é gen_random_uuid()');

    const pks = todasAsLinhas().filter(({ texto }) =>
      /\bUUID\b[^,]*PRIMARY\s+KEY[^,]*DEFAULT/i.test(texto)
    );
    assert.ok(pks.length >= 10, `esperava inspecionar >= 10 PKs UUID, inspecionei ${pks.length}`);

    const erradas = pks
      .filter(({ texto }) => !/gen_random_uuid\(\)/i.test(texto))
      .map(({ arquivo, n, texto }) => `${arquivo}:${n} ${texto.trim()}`);
    assert.deepEqual(erradas, [], 'PK UUID com DEFAULT que não usa gen_random_uuid()');
  });

  it('DDL destrutiva só existe na lista de exceções deliberadas', () => {
    const linhas = todasAsLinhas();
    assert.ok(linhas.length >= 400);

    const achados = linhas
      .filter(({ texto }) => PADROES_DESTRUTIVOS.some((re) => re.test(texto)))
      .map(({ arquivo, n, texto }) => ({ arquivo, n, texto: texto.trim() }));

    // Guarda de discriminação: se este conjunto ficasse vazio, comparar com a lista
    // de exceções não provaria nada — o teste tem de saber quantas conhece.
    assert.equal(
      achados.length,
      EXCECOES_DESTRUTIVAS.length,
      `DDL destrutiva encontrada: ${JSON.stringify(achados)}`
    );

    const naoDocumentadas = achados
      .filter((a) => !EXCECOES_DESTRUTIVAS.some((e) => e.arquivo === a.arquivo && a.texto.startsWith(e.trecho)))
      .map((a) => `${a.arquivo}:${a.n} ${a.texto}`);
    assert.deepEqual(naoDocumentadas, [], 'DDL destrutiva não documentada');
  });

  it('001/002/003 (core + atlas + sync) não tocam PostGIS nem criam schema', () => {
    const ausentes = NUCLEO.filter((f) => !SRC.has(f));
    assert.deepEqual(ausentes, [], 'migração de núcleo ausente');

    const linhas = todasAsLinhas(NUCLEO);
    assert.ok(linhas.length >= 200, `esperava >= 200 linhas de núcleo, inspecionei ${linhas.length}`);

    const proibidos = [
      { nome: 'postgis', re: /postgis/i },
      { nome: 'GEOMETRY(', re: /\bGEOMETRY\s*\(/i },
      { nome: 'GEOGRAPHY(', re: /\bGEOGRAPHY\s*\(/i },
      // ST_ como PREFIXO de identificador, case-sensitive: `last_heartbeat`
      // contém "st_" e não é função PostGIS.
      { nome: 'ST_*', re: /\bST_[A-Za-z]/ },
      { nome: 'CREATE SCHEMA', re: /CREATE\s+SCHEMA/i },
    ];
    const violacoes = linhas
      .filter(({ texto }) => proibidos.some((p) => p.re.test(texto)))
      .map(({ arquivo, n, texto }) => `${arquivo}:${n} ${texto.trim()}`);
    assert.deepEqual(violacoes, [], 'o domínio do atlas precisa continuar JSONB puro, sem PostGIS');
  });

  it('004/005 declaram seu schema e criam TODA tabela qualificada nele', () => {
    const nomes = Object.keys(ESPACIAIS);
    const ausentes = nomes.filter((f) => !SRC.has(f));
    assert.deepEqual(ausentes, [], 'migração espacial ausente');

    const semSchema = nomes.filter(
      (f) => !new RegExp(`CREATE\\s+SCHEMA\\s+IF\\s+NOT\\s+EXISTS\\s+${ESPACIAIS[f]}\\b`, 'i').test(SRC.get(f))
    );
    assert.deepEqual(semSchema, [], 'migração espacial sem CREATE SCHEMA IF NOT EXISTS');

    const tabelas = todasAsLinhas(nomes)
      .map((l) => ({ ...l, m: l.texto.match(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([A-Za-z0-9_.]+)/i) }))
      .filter((l) => l.m !== null);
    assert.ok(tabelas.length >= 8, `esperava >= 8 CREATE TABLE espaciais, inspecionei ${tabelas.length}`);

    const foraDoSchema = tabelas
      .filter((l) => !l.m[1].toLowerCase().startsWith(`${ESPACIAIS[l.arquivo]}.`))
      .map((l) => `${l.arquivo}:${l.n} ${l.m[1]}`);
    assert.deepEqual(foraDoSchema, [], 'tabela PostGIS caiu fora do seu schema');
  });
});
