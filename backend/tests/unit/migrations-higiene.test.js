// Path: tests/unit/migrations-higiene.test.js
// Item 103 — higiene das migrações: numeração, aditividade forward-only e
// contenção do PostGIS fora do schema do atlas.
//
// Três invariantes do projeto que existiam só em prosa (CLAUDE.md "Migrações" e
// "Geometria do atlas é JSONB … nunca adicione PostGIS ao schema do atlas") e são
// verificáveis por leitura dos .sql, sem banco.
//
// A LISTA DE EXCEÇÕES DESTRUTIVAS ESTÁ VAZIA, POR CONSTRUÇÃO. As migrações são baselines
// por domínio escritas no ESTADO FINAL do schema: nada é criado para ser derrubado depois,
// então não sobra `DROP` nenhum. As entradas que esta lista já teve (o `catalog_layers.id`
// UUID -> TEXT, os CHECK que caíam para alargar, o `DROP TABLE streetview_markers`)
// desapareceram porque o tipo, o CHECK e a ausência da tabela nascem prontos.
//
// Ela já esvaziou duas vezes, e uma vez voltou a ter linha: uma migração forward-only
// alargou dois CHECK de `audit_trail`, e alargar CHECK em Postgres não tem forma aditiva.
// Hoje esse alargamento nasce dentro da própria baseline. Uma linha de volta aqui significa
// uma de duas coisas, e vale investigar qual: ou uma migração NOVA e legítima (aí a linha é
// o ato explícito que a convenção exige), ou uma baseline que voltou a evoluir por degraus
// dentro de si mesma.
//
// O PREÇO QUE A LISTA VAZIA TINHA, e que continua valendo para cada padrão sem
// exceção correspondente: `assert.equal(achados.length, EXCECOES.length)` vira
// `0 === 0` e não discrimina mais nada — exatamente a "cobertura vazia passa
// verde" que a constituição nomeia. Por isso existe o teste 'controle negativo',
// que roda OS MESMOS padrões contra um texto SQL que os contém e exige que os cinco
// sejam detectados. Sem ele, este arquivo passaria verde com a regex quebrada.
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

// DDL destrutiva DELIBERADA, com o arquivo onde mora. Acrescentar uma linha aqui é
// o ato explícito que a convenção exige; esquecer de acrescentar reprova o teste.
//
// QUANDO ELA VOLTAR A TER LINHA, escreva o `trecho` como o STATEMENT INTEIRO e nunca como
// o prefixo comum: dois `ALTER TABLE x DROP CONSTRAINT ...` começam iguais, e um prefixo
// compartilhado faria os dois casarem a MESMA entrada — a contagem acusaria "DDL a mais" e
// a lista deixaria de discriminar qual foi autorizada.
const EXCECOES_DESTRUTIVAS = [];

const PADROES_DESTRUTIVOS = [
  /\bDROP\s+TABLE\b/i,
  /\bDROP\s+COLUMN\b/i,
  /\bTRUNCATE\b/i,
  /\bALTER\s+COLUMN\s+\w+\s+TYPE\b/i,
  /\bDROP\s+CONSTRAINT\b/i,
];

// Os dois arquivos ESPACIAIS, por nome. Tudo que não é um deles é núcleo, e o
// invariante do PostGIS é cobrado sobre o COMPLEMENTO: até a consolidação o teste
// listava três arquivos de núcleo à mão, então um `GEOMETRY(` numa baseline nova
// passava despercebido. Denylist ao invés de allowlist fecha esse buraco.
const ESPACIAIS = { '006_ng.sql': 'ng', '007_sv360.sql': 'sv360' };
const NUCLEO = FILES.filter((f) => !(f in ESPACIAIS));

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

    const naoDocumentadas = achados
      .filter((a) => !EXCECOES_DESTRUTIVAS.some((e) => e.arquivo === a.arquivo && a.texto.startsWith(e.trecho)))
      .map((a) => `${a.arquivo}:${a.n} ${a.texto}`);
    assert.deepEqual(naoDocumentadas, [], 'DDL destrutiva não documentada');

    // A contagem só fecha se toda exceção declarada AINDA existe no disco: uma linha
    // que sobrevive ao arquivo que a justificava é convenção apodrecendo em silêncio.
    assert.equal(
      achados.length,
      EXCECOES_DESTRUTIVAS.length,
      `exceção declarada sem DDL correspondente, ou DDL a mais: ${JSON.stringify(achados)}`
    );
  });

  it('controle negativo: os padrões destrutivos PEGAM o SQL que os contém', () => {
    // Com `EXCECOES_DESTRUTIVAS` vazia, o teste acima é `0 === 0` sobre uma varredura
    // que não achou nada, e um verde desses é indistinguível de uma regex quebrada.
    // Este caso roda OS MESMOS `PADROES_DESTRUTIVOS` contra um texto que os contém,
    // um a um, e exige que cada um seja detectado.
    const AMOSTRAS = [
      'DROP TABLE streetview_markers;',
      'ALTER TABLE maps DROP COLUMN catalog_layers;',
      'TRUNCATE features;',
      'ALTER TABLE audit_trail ALTER COLUMN target_id TYPE TEXT USING target_id::text;',
      'ALTER TABLE users DROP CONSTRAINT users_role_check;',
    ];
    assert.equal(AMOSTRAS.length, PADROES_DESTRUTIVOS.length,
      'uma amostra por padrão: acrescentar padrão sem amostra deixa o padrão sem prova');

    const naoPegos = PADROES_DESTRUTIVOS
      .map((re, i) => ({ i, re, pego: AMOSTRAS.some((a) => re.test(a)) }))
      .filter((r) => !r.pego)
      .map((r) => `padrão ${r.i}: ${r.re}`);
    assert.deepEqual(naoPegos, [], 'padrão destrutivo que não pega nem a própria amostra');

    // E o inverso: linha inofensiva não pode disparar padrão nenhum, senão a lista
    // vazia só sobrevive porque ninguém acrescenta migração.
    const INOFENSIVAS = [
      'CREATE TABLE atlas (id UUID PRIMARY KEY DEFAULT gen_random_uuid());',
      'CREATE INDEX idx_atlas_owner ON atlas(owner_id);',
      'ALTER TABLE ng.edificacoes ALTER COLUMN access_level SET STATISTICS 1000;',
    ];
    const falsosPositivos = INOFENSIVAS
      .filter((l) => PADROES_DESTRUTIVOS.some((re) => re.test(l)));
    assert.deepEqual(falsosPositivos, [], 'padrão destrutivo disparando em DDL aditiva');
  });

  it('TODA baseline que não seja uma das duas espaciais fica sem PostGIS e sem schema', () => {
    const ausentes = Object.keys(ESPACIAIS).filter((f) => !SRC.has(f));
    assert.deepEqual(ausentes, [], 'migração espacial ausente do disco');
    assert.ok(NUCLEO.length >= 5, `esperava >= 5 baselines de núcleo, achei ${NUCLEO.length}`);

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

  it('as duas espaciais declaram seu schema e criam TODA tabela qualificada nele', () => {
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
