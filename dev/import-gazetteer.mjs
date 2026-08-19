#!/usr/bin/env node
// Path: dev/import-gazetteer.mjs

/**
 * Absorve o gazetteer do banco ANTIGO (o `servico_nomes_geograficos`, schema `ng`)
 * para este backend: `ng.nomes_geograficos` e o ACERVO 3D.
 *
 * O ACERVO 3D MUDOU DE DESTINO. A origem guarda o catálogo de modelos em
 * `ng.catalogo_3d`, e essa tabela NÃO EXISTE mais aqui: era um segundo catálogo de
 * modelo 3D, sem consumidor no frontend e com um eixo de permissão próprio que
 * nenhuma rota escrevia. O catálogo que sobrevive é `public.tilesets`, o que
 * `GET /api/config` serve e o visualizador resolve. Este script converte a FORMA da
 * linha na passagem (ver `transformarCatalogo3d`); o acervo continua carregável.
 *
 * POR QUE NÃO É UM `pg_restore` DO DUMP: o dump do serviço antigo carrega o DDL dele,
 * que NÃO é o desta migração 004. Restaurá-lo por cima recriaria as tabelas sem
 * `access_level`, sem as tabelas de zona/permissão, e com a função de `tipo_peso`
 * antiga (um CASE de igualdade contra nomes SEM acento, que no vocabulário real,
 * acentuado e com travessão `–`, joga 38% das linhas no piso 0.1). Aqui viaja só o
 * DADO; o schema e as regras são as do backend novo.
 *
 * O QUE NÃO VIAJA, e por quê:
 *   - `tipo_peso`: é derivado. O trigger `trg_calcular_tipo_peso` recalcula no INSERT,
 *     e a função do backend não é a do banco de origem. Medido no backup de
 *     2026-07-23: 2.016 linhas da origem tinham `tipo_peso` divergente da própria
 *     função que deveria tê-lo gerado (959 rios gravados como 0.1). É valor obsoleto.
 *   - `cluster_id`: nenhum trigger o calcula. Sai de `ng.refresh_busca()`, que este
 *     script roda ao final. Sem esse passo a desduplicação da busca degrada em SILÊNCIO.
 *   - `id`: a origem usa `uuid_generate_v4()` e o destino `gen_random_uuid()`. Nada
 *     referencia esses ids (o gazetteer não tem FK de entrada), então deixamos o
 *     destino gerar — evita depender da extensão `uuid-ossp` no banco novo.
 *   - `search_vector` do catálogo 3D: a coluna não existe no destino. A busca de
 *     `tilesets` é por nome/id na aplicação, não full-text no banco.
 *   - `type` como coluna: `tilesets` não tem uma. Ele vira o DISCRIMINADOR dentro de
 *     `config` (ver `transformarCatalogo3d`).
 *
 * MUTA O BANCO: por padrão roda em DRY-RUN e só imprime o que faria. Escrever exige
 * `--apply` explícito.
 *
 * Uso:
 *   node dev/import-gazetteer.mjs --source=<postgres-url-da-origem> [opções]
 *
 * Opções:
 *   --apply                Executa a escrita (sem isso é dry-run).
 *   --dedup                Descarta linhas idênticas em (nome, tipo, município, estado,
 *                          geom). No backup de 2026-07-23 são 29.544 de 81.964 (36%).
 *                          Ver "Sobre a dedup e o cluster_id" abaixo.
 *   --truncate             TRUNCATE nas tabelas de destino antes de inserir. Sem isso a
 *                          carga é ADITIVA e uma segunda execução duplica tudo.
 *   --access-level=<v>     `public` (default) ou `private`. A origem não tem a coluna;
 *                          é uma decisão de visibilidade que o destino exige.
 *   --skip=<t1,t2>         Tabelas a pular: nomes, catalogo3d.
 *                          (`catalogo3d` continua sendo o nome da ORIGEM; o destino
 *                          dele é `public.tilesets`.)
 *   --batch=<n>            Linhas por INSERT (default 2000).
 *
 * `DATABASE_URL` (o DESTINO) sai do ambiente; se ausente, é lido de `backend/.env`.
 *
 * ## Sobre a dedup e o `cluster_id`
 *
 * A chave da dedup inclui `geom`, então ela só colapsa linhas na MESMA coordenada:
 * duas ocorrências distintas do mesmo nome no mesmo município continuam duas linhas, e
 * o par (nome, município, cluster) que a busca usa não se perde. Isso foi medido, não
 * deduzido — carga completa e carga deduplicada, ambas com `refresh_busca()` rodado:
 *
 *   - localidades distintas (nome, tipo, município, estado, geom): 0 perdidas, 0 inventadas
 *   - grupos da chave de desduplicação da busca (nome, tipo, cluster_id): 44.815 nos dois
 *   - a ESTRUTURA de clusters (o conjunto de grupos {nome, tipo, pontos}): idêntica, 0 / 0
 *
 * O que MUDA é a NUMERAÇÃO: `ST_ClusterDBSCAN` numera por ordem de linha, então tirar
 * linhas renumera os ids dentro da partição (nome, tipo). Isso não é efeito da dedup e
 * sim de qualquer mudança no conjunto de linhas — com a tabela intacta, `refresh_busca()`
 * rodado duas vezes não altera um único `cluster_id` (medido). `cluster_id` é RÓTULO,
 * não identidade: nada fora do schema `ng` o persiste, e a busca só o usa dentro da
 * mesma query que o lê. Se um dia algo passar a guardá-lo, esta premissa cai.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');
const BACKEND = resolve(REPO, 'backend');

// pg-promise vive em backend/node_modules; resolver a partir do package.json do
// backend torna o script independente do cwd de quem o chama.
const requireFromBackend = createRequire(pathToFileURL(resolve(BACKEND, 'package.json')));
const pgPromise = requireFromBackend('pg-promise');

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);
const hasFlag = (name) => argv.includes(`--${name}`);
const getOpt = (name, fallback) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit === undefined ? fallback : hit.slice(name.length + 3);
};

const SOURCE_URL = getOpt('source', '');
const APPLY = hasFlag('apply');
const DEDUP = hasFlag('dedup');
const TRUNCATE = hasFlag('truncate');
const ACCESS_LEVEL = getOpt('access-level', 'public');
const BATCH = Number(getOpt('batch', '2000'));
const SKIP = new Set(
  getOpt('skip', '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
);

if (!SOURCE_URL) {
  console.error(`Uso: node dev/import-gazetteer.mjs --source=<postgres-url> [--apply] [--dedup]
                 [--truncate] [--access-level=public|private] [--skip=nomes,catalogo3d] [--batch=2000]`);
  process.exit(1);
}
if (!['public', 'private'].includes(ACCESS_LEVEL)) {
  console.error(`--access-level precisa ser "public" ou "private", e veio "${ACCESS_LEVEL}".`);
  process.exit(1);
}
if (!Number.isInteger(BATCH) || BATCH < 1) {
  console.error(`--batch precisa ser inteiro >= 1, e veio "${BATCH}".`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Ambiente
// ---------------------------------------------------------------------------

/** Preenche do backend/.env apenas as chaves ausentes do ambiente. */
function loadBackendEnv() {
  const envPath = resolve(BACKEND, '.env');
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    const [, key, raw] = m;
    if (process.env[key] !== undefined) continue;
    process.env[key] = raw.replace(/^["']|["']$/g, '');
  }
}

// ---------------------------------------------------------------------------
// Tabelas
// ---------------------------------------------------------------------------

/**
 * Uma tabela do gazetteer.
 * `colunas` são as colunas de DADO, na ordem em que viajam (sem geom, sem access_level).
 * `srid` é o do destino e é conferido contra a origem antes de qualquer escrita: nomes
 * é 4674 (SIRGAS 2000) e edificações é 4326, divergência deliberada da migração 004.
 * `colunasDestino` e `transformar` so existem para a tabela cuja FORMA muda na
 * passagem (o acervo 3D): `transformar` recebe as linhas da origem e devolve linhas
 * ja no shape do destino, e `colunasDestino` sao as colunas que essas linhas trazem.
 * `onConflict` e o sufixo do INSERT, para o destino que ja pode ter linhas curadas.
 * @typedef {{ chave: string, origem: string, destino: string, colunas: string[],
 *             srid: number|null, tipoGeom: string|null, ordem: string,
 *             colunasDestino?: string[], transformar?: Function, onConflict?: string,
 *             loteProibido?: boolean }} Tabela
 */

/** @type {Tabela[]} */
const TABELAS = [
  {
    chave: 'nomes',
    origem: 'ng.nomes_geograficos',
    destino: 'ng.nomes_geograficos',
    colunas: ['nome', 'municipio', 'estado', 'tipo'],
    srid: 4674,
    tipoGeom: 'Point',
    ordem: 'nome, tipo, municipio, estado, geom',
  },
  {
    chave: 'catalogo3d',
    origem: 'ng.catalogo_3d',
    // O DESTINO E `public.tilesets`, e nao uma tabela homonima no `ng`: aquele
    // catalogo saiu do sistema (era o segundo, sem consumidor). Ver o cabecalho.
    destino: 'public.tilesets',
    // `tilesets` TEM `access_level` e o gazetteer nao tem mais (o eixo de acesso do
    // `ng` saiu em 2026-08-19, junto com as zonas: busca de toponimo nao tem
    // restricao). Por isso a coluna e propriedade da TABELA, nao do processo.
    temAccessLevel: true,
    // Sem geometria: o catalogo 3D da origem guarda lon/lat como numeric solto.
    colunas: [
      'name', 'description', 'municipio', 'estado', 'thumbnail', 'palavras_chave', 'url',
      'lon', 'lat', 'height', 'heading', 'pitch', 'roll', 'type', 'heightoffset',
      'maximumscreenspaceerror', 'data_criacao', 'style',
    ],
    colunasDestino: ['id', 'name', 'description', 'config'],
    transformar: transformarCatalogo3d,
    // `tilesets` e catalogo CURADO por administrador, nao alvo de ETL exclusivo:
    // um id que ja existe e do curador e vence. Ver `transformarCatalogo3d`.
    onConflict: 'ON CONFLICT (id) DO NOTHING',
    // `config` e jsonb e viaja como texto; o caminho em lote castaria o array
    // inteiro e e mais facil de errar do que uma linha por vez num catalogo desta
    // ordem de grandeza (centenas de modelos, nao dezenas de milhares de nomes).
    loteProibido: true,
    srid: null,
    tipoGeom: null,
    ordem: 'name, url',
  },
];

/**
 * O vocabulario de `type` da ORIGEM. `tilesets` nao tem coluna `type` nem CHECK, mas
 * a linha com tipo fora deste conjunto continua sendo RECUSADA: o tipo e o que decide
 * qual carregador o visualizador usa, e um valor que este script nao sabe traduzir
 * viraria um item de catalogo que abre errado. Recusar e contado e nomeado na saida.
 */
const TIPOS_3D_VALIDOS = new Set(['Tiles 3D', 'Modelos 3D', 'Nuvem de Pontos']);

// ---------------------------------------------------------------------------
// A conversao de forma: ng.catalogo_3d (origem) -> public.tilesets (destino)
// ---------------------------------------------------------------------------

/**
 * `tilesets.id` e VARCHAR(100) PRIMARY KEY e NAO tem default: e um slug, e a origem
 * nao tem um. Este e o gerador -- decomposicao NFD para tirar acento, minusculas, e
 * tudo que nao e alfanumerico vira hifen.
 * @param {string} nome
 * @returns {string}
 */
function slugDeNome(nome) {
  const base = String(nome ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90);
  return base || 'modelo';
}

/**
 * Converte a linha do catalogo da origem na linha de `tilesets`.
 *
 * O MAPEAMENTO, e onde cada campo cai:
 *   name                      -> coluna `name`
 *   description               -> coluna `description` E `config.description`
 *   thumbnail, url, style     -> dentro de `config`
 *   heightoffset, maximumscreenspaceerror -> `config.heightOffset` / `...Error`
 *   lon, lat, height          -> `config.locate`, que e a forma que o catalogo ja usa
 *   heading, pitch, roll      -> `config.orientation`
 *   municipio + estado        -> `config.local`
 *   palavras_chave (text[])   -> `config.keywords`
 *   data_criacao              -> `config.data_captura`, em ISO (YYYY-MM-DD). O campo e
 *                                texto livre e o cliente le os dois formatos (parseCatalogDate
 *                                aceita DD/MM/YYYY e ISO), entao ISO aqui nao quebra ordenacao.
 *
 * O DISCRIMINADOR DE TIPO. `tilesets` distingue modelo de tileset por
 * `config.type === 'glb'`: presente = modelo isolado, ausente = 3D Tiles.
 *   'Modelos 3D'      -> config.type = 'glb'
 *   'Tiles 3D'        -> sem `type` (tileset)
 *   'Nuvem de Pontos' -> sem `type` (tileset)
 *
 * A NUVEM DE PONTOS FICA SEM ROTULO PROPRIO, e isto e um buraco DECLARADO, nao um
 * descuido: `.pnts` e um formato DE 3D Tiles, entao o carregador de tileset e o certo
 * para ela e nada quebra; o que se perde e a capacidade de dizer na tela que aquele
 * item e uma nuvem, e de filtrar por isso. Declarar a taxonomia de tipo do catalogo e
 * trabalho de outra fase, e inventa-la aqui criaria um valor que nenhum leitor conhece.
 *
 * @param {object[]} linhas linhas da origem
 * @param {Set<string>} idsExistentes ids que o destino ja tem, para nao colidir
 * @returns {object[]} linhas no shape de `tilesets`
 */
function transformarCatalogo3d(linhas, idsExistentes) {
  const usados = new Set(idsExistentes);
  return linhas.map((l) => {
    let id = slugDeNome(l.name);
    if (usados.has(id)) {
      let n = 2;
      while (usados.has(`${id}-${n}`)) n += 1;
      id = `${id}-${n}`;
    }
    usados.add(id);

    const local = [l.municipio, l.estado].filter(Boolean).join(', ') || null;
    const config = {
      url: l.url ?? null,
      description: l.description ?? null,
      thumbnail: l.thumbnail ?? null,
      local,
      keywords: Array.isArray(l.palavras_chave) && l.palavras_chave.length ? l.palavras_chave : null,
      data_captura:
        l.data_criacao instanceof Date
          ? l.data_criacao.toISOString().slice(0, 10)
          : (l.data_criacao ?? null),
      heightOffset: l.heightoffset ?? null,
      maximumScreenSpaceError: l.maximumscreenspaceerror ?? null,
      locate:
        l.lon != null && l.lat != null
          ? { lon: Number(l.lon), lat: Number(l.lat), height: l.height == null ? null : Number(l.height) }
          : null,
      orientation:
        l.heading != null || l.pitch != null || l.roll != null
          ? {
              heading: l.heading == null ? null : Number(l.heading),
              pitch: l.pitch == null ? null : Number(l.pitch),
              roll: l.roll == null ? null : Number(l.roll),
            }
          : null,
      style: l.style ?? null,
    };
    // 'Modelos 3D' e o unico que carrega discriminador; os outros dois sao tileset.
    if (l.type === 'Modelos 3D') config.type = 'glb';

    // Chave nula nao carrega informacao e polui o documento que o /config serve.
    for (const [k, v] of Object.entries(config)) if (v === null) delete config[k];

    return { id, name: l.name, description: l.description ?? null, config: JSON.stringify(config) };
  });
}

// ---------------------------------------------------------------------------
// Leitura da origem
// ---------------------------------------------------------------------------

/** As colunas que a tabela REALMENTE tem na origem (o banco antigo varia). */
async function colunasDaOrigem(db, qualificado) {
  const [schema, tabela] = qualificado.split('.');
  const rows = await db.any(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = $1 AND table_name = $2`,
    [schema, tabela]
  );
  return new Set(rows.map((r) => r.column_name));
}

/**
 * SELECT da origem. A geometria sai como EWKB (bytea) e não como texto: WKT arredonda,
 * e um gazetteer inteiro reescrito com coordenada arredondada é um erro que nenhum
 * teste acusa e que aparece como ponto deslocado no mapa.
 */
function selectDaOrigem(tabela, presentes) {
  const cols = tabela.colunas.filter((c) => presentes.has(c));
  const projecao = [...cols];
  if (tabela.tipoGeom) projecao.push('ST_AsEWKB(geom) AS geom');
  const distinct = DEDUP ? `DISTINCT ON (${tabela.ordem}) ` : '';
  const orderBy = DEDUP ? ` ORDER BY ${tabela.ordem}` : '';
  const filtro = tabela.tipoGeom ? ' WHERE geom IS NOT NULL' : '';
  return {
    cols,
    sql: `SELECT ${distinct}${projecao.join(', ')} FROM ${tabela.origem}${filtro}${orderBy}`,
  };
}

// ---------------------------------------------------------------------------
// Escrita no destino
// ---------------------------------------------------------------------------

/**
 * INSERT em lote via `unnest` de arrays paralelos: uma ida ao banco por lote, com
 * todos os valores parametrizados.
 *
 * Só serve para colunas ESCALARES. Uma coluna que já é array no destino
 * (`catalogo_3d.palavras_chave` é `text[]`) precisaria de um array de arrays, e o
 * Postgres não tem array 2D ragged — `$n::text[][]` não expressa "uma lista de
 * listas de tamanhos diferentes". Quem decide entre os dois caminhos é `usaLote()`.
 */
function insertEmLote(tabela, cols, tiposPg, linhas) {
  const params = cols.map((c) => linhas.map((l) => l[c]));
  const unnestArgs = cols.map((c, i) => `$${i + 1}::${tiposPg[c]}[]`);
  const alias = cols.join(', ');

  let projecao = cols.map((c) => `u.${c}`).join(', ');
  let destinoCols = cols.join(', ');

  if (tabela.tipoGeom) {
    params.push(linhas.map((l) => l.geom));
    unnestArgs.push(`$${params.length}::bytea[]`);
    projecao += `, ST_GeomFromEWKB(u.geom)::geometry(${tabela.tipoGeom},${tabela.srid})`;
    destinoCols += ', geom';
  }

  let colsFinais = destinoCols;
  let projFinal = projecao;
  if (tabela.temAccessLevel) {
    params.push(ACCESS_LEVEL);
    colsFinais += ', access_level';
    projFinal += `, $${params.length}`;
  }

  const unnestCols = tabela.tipoGeom ? `${alias}, geom` : alias;
  return {
    sql: `INSERT INTO ${tabela.destino} (${colsFinais})
          SELECT ${projFinal}
            FROM unnest(${unnestArgs.join(', ')}) AS u(${unnestCols})
          ${tabela.onConflict ?? ''}`,
    params,
  };
}

/** Uma linha por INSERT: o caminho para tabelas com coluna de array. */
function insertLinhaALinha(tabela, cols, linha) {
  const params = cols.map((c) => linha[c]);
  const placeholders = cols.map((_, i) => `$${i + 1}`);
  let destinoCols = cols.join(', ');

  if (tabela.tipoGeom) {
    params.push(linha.geom);
    placeholders.push(`ST_GeomFromEWKB($${params.length})::geometry(${tabela.tipoGeom},${tabela.srid})`);
    destinoCols += ', geom';
  }
  if (tabela.temAccessLevel) {
    params.push(ACCESS_LEVEL);
    placeholders.push(`$${params.length}`);
    destinoCols += ', access_level';
  }

  return {
    sql: `INSERT INTO ${tabela.destino} (${destinoCols}) `
       + `VALUES (${placeholders.join(', ')}) ${tabela.onConflict ?? ''}`,
    params,
  };
}

/** O caminho em lote exige colunas escalares. Ver `insertEmLote`. */
function usaLote(tabela, cols, tiposPg) {
  if (tabela.loteProibido) return false;
  return cols.every((c) => !tiposPg[c].endsWith('[]'));
}

/** Tipo Postgres de cada coluna do DESTINO, para o cast do unnest. */
async function tiposDoDestino(db, tabela, cols) {
  const [schema, nome] = tabela.destino.split('.');
  const rows = await db.any(
    `SELECT column_name, format_type(a.atttypid, NULL) AS tipo
       FROM information_schema.columns c
       JOIN pg_attribute a
         ON a.attrelid = to_regclass($1)::oid AND a.attname = c.column_name
      WHERE c.table_schema = $2 AND c.table_name = $3`,
    [tabela.destino, schema, nome]
  );
  const mapa = Object.fromEntries(rows.map((r) => [r.column_name, r.tipo]));
  const faltando = cols.filter((c) => !mapa[c]);
  if (faltando.length) {
    throw new Error(`${tabela.destino} não tem as colunas: ${faltando.join(', ')}`);
  }
  return mapa;
}

// ---------------------------------------------------------------------------
// Execução
// ---------------------------------------------------------------------------

async function main() {
  loadBackendEnv();
  const TARGET_URL = process.env.DATABASE_URL;
  if (!TARGET_URL) {
    console.error('DATABASE_URL (o destino) não está no ambiente nem em backend/.env.');
    process.exit(1);
  }

  const pgp = pgPromise();
  const origem = pgp(SOURCE_URL);
  const destino = pgp(TARGET_URL);

  const alvo = new URL(TARGET_URL.replace(/^postgres(ql)?:/, 'http:'));
  console.log(`origem : ${SOURCE_URL.replace(/:[^:@/]*@/, ':***@')}`);
  console.log(`destino: ${alvo.pathname.slice(1)} em ${alvo.host}`);
  console.log(`modo   : ${APPLY ? 'APPLY (escreve)' : 'DRY-RUN'}${DEDUP ? ' | dedup' : ''}` +
              `${TRUNCATE ? ' | truncate' : ''} | access_level=${ACCESS_LEVEL}\n`);

  try {
    // Guarda: o destino tem MESMO o schema da migração 004? Sem isto, um destino
    // errado (ou não-migrado) só falharia lá na frente, com metade da carga feita.
    // A guarda mirava a coluna access_level do gazetteer, que saiu em 2026-08-19
    // junto com o eixo de acesso do ng. Mira agora a TABELA que ficou: um destino
    // nao-migrado continua falhando ANTES de escrever metade da carga.
    const temDestino = await destino.oneOrNone(
      `SELECT 1 FROM information_schema.tables
        WHERE table_schema='ng' AND table_name='nomes_geograficos'`
    );
    if (!temDestino) {
      throw new Error('destino sem ng.nomes_geograficos — rode `npm run db:migrate` antes.');
    }

    const planejadas = TABELAS.filter((t) => !SKIP.has(t.chave));
    let escreveu = false;

    for (const tabela of planejadas) {
      const presentesOrigem = await colunasDaOrigem(origem, tabela.origem);
      if (presentesOrigem.size === 0) {
        console.log(`- ${tabela.chave}: ${tabela.origem} não existe na origem, pulando.`);
        continue;
      }

      // SRID divergente entre origem e destino significa reprojeção silenciosa: o
      // INSERT casta para geometry(T,SRID) e o Postgres RECUSA um SRID diferente,
      // então isto vira erro de qualquer jeito — mas aqui vira erro ANTES de escrever.
      if (tabela.srid) {
        const srid = await origem.oneOrNone(
          `SELECT DISTINCT ST_SRID(geom) AS srid FROM ${tabela.origem} WHERE geom IS NOT NULL LIMIT 1`
        );
        if (srid && Number(srid.srid) !== tabela.srid) {
          throw new Error(
            `${tabela.origem} está em SRID ${srid.srid} e o destino exige ${tabela.srid}. ` +
            'Reprojete na origem antes de importar.'
          );
        }
      }

      const { cols, sql } = selectDaOrigem(tabela, presentesOrigem);
      const ignoradas = tabela.colunas.filter((c) => !presentesOrigem.has(c));
      let linhas = await origem.any(sql);

      // Tipo fora do vocabulario conhecido some aqui, contado e nomeado: ele decide
      // qual carregador o visualizador usa, e traduzir no chute produz item que abre
      // errado. Ver TIPOS_3D_VALIDOS.
      let recusadas = 0;
      if (tabela.chave === 'catalogo3d') {
        const antes = linhas.length;
        linhas = linhas.filter((l) => l.type == null || TIPOS_3D_VALIDOS.has(l.type));
        recusadas = antes - linhas.length;
      }

      const totalOrigem = Number(
        (await origem.one(`SELECT count(*)::int AS n FROM ${tabela.origem}`)).n
      );
      const jaNoDestino = Number(
        (await destino.one(`SELECT count(*)::int AS n FROM ${tabela.destino}`)).n
      );

      // A FORMA muda aqui, e so para a tabela que declara `transformar`. Ela recebe
      // os ids que o destino ja tem para nao inventar colisao: `tilesets.id` e um
      // slug gerado a partir do nome, e nomes se repetem.
      let colsDestino = cols;
      if (tabela.transformar) {
        const existentes = new Set(
          (await destino.any(`SELECT id FROM ${tabela.destino}`)).map((r) => r.id)
        );
        linhas = tabela.transformar(linhas, existentes);
        colsDestino = tabela.colunasDestino;
      }

      console.log(`- ${tabela.chave}: origem ${totalOrigem} → a inserir ${linhas.length}` +
                  `${DEDUP ? ` (dedup descartou ${totalOrigem - linhas.length - recusadas})` : ''}` +
                  ` | destino tem ${jaNoDestino}`);
      if (ignoradas.length) console.log(`    colunas ausentes na origem: ${ignoradas.join(', ')}`);
      if (recusadas) console.log(`    ${recusadas} recusadas pelo CHECK de type (fora de ${[...TIPOS_3D_VALIDOS].join(' / ')})`);
      if (jaNoDestino > 0 && !TRUNCATE && APPLY && !tabela.onConflict) {
        console.log('    AVISO: destino não-vazio e sem --truncate; a carga é aditiva e vai duplicar.');
      }
      if (jaNoDestino > 0 && TRUNCATE && APPLY && tabela.onConflict) {
        console.log(`    NOTA: --truncate NÃO se aplica a ${tabela.destino} (catálogo curado); `
                  + 'id que já existe é preservado.');
      }
      if (!APPLY || linhas.length === 0) continue;

      const tiposPg = await tiposDoDestino(destino, tabela, colsDestino);
      const emLote = usaLote(tabela, colsDestino, tiposPg);
      await destino.tx(async (t) => {
        // `--truncate` NAO alcanca um destino com `onConflict`: `tilesets` e catalogo
        // curado por administrador e tem outros escritores, entao esvazia-lo por causa
        // de uma flag de import de gazetteer apagaria trabalho que este script nao fez.
        // Ali a colisao e resolvida por `ON CONFLICT (id) DO NOTHING`.
        if (TRUNCATE && !tabela.onConflict) await t.none(`TRUNCATE ${tabela.destino}`);
        if (emLote) {
          for (let i = 0; i < linhas.length; i += BATCH) {
            const lote = linhas.slice(i, i + BATCH);
            const { sql: ins, params } = insertEmLote(tabela, colsDestino, tiposPg, lote);
            await t.none(ins, params);
          }
        } else {
          for (const linha of linhas) {
            const { sql: ins, params } = insertLinhaALinha(tabela, colsDestino, linha);
            await t.none(ins, params);
          }
        }
      });
      escreveu = true;
      console.log(`    inseridas ${linhas.length}${emLote ? '' : ' (linha a linha: coluna de array)'}.`);
    }

    if (APPLY && escreveu) {
      // O passo pós-carga que degrada em silêncio se esquecido: `cluster_id` não tem
      // trigger nenhum, é `refresh_busca()` a única fonte dele. Ver docs/wiki/gazetteer-nomes-geograficos.md.
      console.log('\nrodando ng.refresh_busca() (DBSCAN + re-fire do tipo_peso)...');
      // `any`, não `none`: é um SELECT de função e devolve uma linha (void). Com
      // `none` o pg-promise lança "No return data was expected" DEPOIS da carga já
      // ter sido commitada — o script morre exatamente entre inserir e clusterizar.
      await destino.any('SELECT ng.refresh_busca()');
      await destino.none('ANALYZE ng.nomes_geograficos');

      const v = await destino.one(`
        SELECT (SELECT count(*)::int FROM ng.nomes_geograficos) AS nomes,
               (SELECT count(*)::int FROM public.tilesets)      AS tilesets,
               (SELECT count(DISTINCT cluster_id)::int FROM ng.nomes_geograficos) AS clusters,
               (SELECT count(*)::int FROM ng.nomes_geograficos WHERE cluster_id IS NULL) AS sem_cluster,
               (SELECT round(avg(tipo_peso)::numeric,3) FROM ng.nomes_geograficos) AS peso_medio`);
      console.log(`\nnomes=${v.nomes} tilesets=${v.tilesets} ` +
                  `clusters=${v.clusters} sem_cluster=${v.sem_cluster} peso_medio=${v.peso_medio}`);
      if (v.nomes > 0 && v.sem_cluster > 0) {
        console.log('AVISO: há linhas sem cluster_id — refresh_busca() não cobriu tudo.');
      }
    } else if (!APPLY) {
      console.log('\nDRY-RUN: nada foi escrito. Repita com --apply.');
    }
  } finally {
    await pgp.end();
  }
}

main().catch((err) => {
  console.error(`\nfalhou: ${err.message}`);
  process.exit(1);
});
