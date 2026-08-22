#!/usr/bin/env node
// Path: scripts/sv360-folder-import.js
// Converte o ACERVO 360 LEGADO EM PASTA (IMG/*.jpg + METADATA/*.json) no par de
// arquivos SQLite que `sv360-import.js` consome: `index.db` (o inventário) e
// `{slug}.db` (os pixels). Não fala com o Postgres: a ingestão continua sendo do
// importador, que é quem tem o `mergeProject` compartilhado com o upload do admin.
//
// POR QUE ESTE SCRIPT EXISTE. O `sv360-import.js` recebe o `index.db` do
// `ebgeo_360`, e o acervo que sobra de antes daquele sistema é uma PASTA: uma foto
// equirretangular por arquivo e um JSON irmão com `camera` (id/lon/lat/ele/heading)
// e `targets` (as ligações de navegação). Sem esta ponte, aquele acervo não tem
// caminho nenhum para dentro do produto, e foi medido: 657 fotos paradas.
//
// O FORMATO DE SAÍDA É O "COM BLOB", e a escolha é deliberada. `validateImagesDb`
// (`src/modules/streetview360/sv360.ingest.js`) aceita dois: com `full_webp`/
// `preview_webp` na tabela `images`, ou sem eles mais um `{slug}_tiles.db` cuja
// pirâmide cubra toda foto viva. O segundo é o normal do acervo moderno e exige
// gerar a pirâmide; o primeiro é o histórico, continua aceito, e é o que uma pasta
// de JPGs alcança sem inventar níveis de tile que ninguém pediu.
//
// A CONVERSÃO É CACHEADA EM DISCO, E ISSO NÃO É CONFORTO. Converter 657 fotos custa
// ~20 min (medido: 1,76 s por `full` e 0,1 s por `preview`, em 5760x2880), e o passo
// seguinte (montar o SQLite e passar pelo `mergeProject`) é o que erra na primeira
// tentativa. Sem cache, cada erro de um campo do manifesto custaria a conversão
// inteira de novo. Com cache, custa segundos.
//
// O QUE ELE NÃO FAZ, dito por extenso:
//   - Não gera pirâmide de tiles. Quem quiser o formato moderno converte depois.
//   - Não cria organização: o `index.db` sai SEM a tabela `organizations`, e o
//     importador trata isso como dump antigo e joga o projeto na organização
//     padrão. Uma tabela com slug inventado mandaria o projeto para uma OM errada.
//   - Não lê andar nem faixa de coleta: o acervo em pasta não os declara. As
//     tabelas saem vazias (e não ausentes), porque vazio é um fato e ausente é
//     uma exceção que o leitor precisa tratar.
//   - Não deduz calibração. `mesh_rotation_*`, `camera_height`, `distance_scale` e
//     `marker_scale` saem nos DEFAULTS do schema, que é o estado "não calibrado".
//
// DISTÂNCIA E AZIMUTE SÃO CALCULADOS, não copiados: o JSON legado só traz as
// coordenadas de cada alvo. São geometria pura sobre WGS84 (haversine + azimute
// inicial), e entram porque o visualizador ordena a fila de uma direção pela
// distância — sem ela, alvos na mesma direção empilham em ordem arbitrária.
//
// Uso:
//   node scripts/sv360-folder-import.js <pastaLegada> <pastaSaida> [opções]
//     --slug=<slug>     identificador do projeto (default: nome da pasta legada)
//     --nome=<texto>    nome exibido (default: o slug)
//     --jobs=<n>        conversões simultâneas (default: 4)
//     --limite=<n>      converte só as N primeiras fotos (depuração)
//     --qualidade=<n>   qualidade do WebP `full` (default: 82)
//
// Depois:
//   npm run sv360:import -- <pastaSaida>/index.db <pastaSaida> ./data/sv360

import { readdirSync, readFileSync, mkdirSync, existsSync, statSync, rmSync } from 'node:fs';
import { join, basename, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import Database from 'better-sqlite3';

const execFileAsync = promisify(execFile);

/** Largura do `preview`, em pixels. O visualizador o usa como textura de espera. */
const LARGURA_PREVIEW = 1024;
/** Qualidade do `preview`. Ele é descartável: o `full` chega logo atrás. */
const QUALIDADE_PREVIEW = 75;

/**
 * NAMESPACE deste conversor, fixo e arbitrário por desenho.
 *
 * O id de foto que o `sv360` guarda é um UUID v5 DETERMINÍSTICO (o comentário de
 * `sv360.ingest.js` sobre o 409 depende disso), e não o nome do arquivo: a rota
 * `GET /photos/:uuid/image` valida o parâmetro como GUID e recusa qualquer outra coisa
 * com 422. Medido: a primeira versão deste script gravou o nome como id, as 657 fotos
 * entraram no Postgres e NENHUMA imagem saía pela API.
 *
 * O valor é arbitrário porque o acervo em pasta não traz namespace nenhum; o que ele
 * precisa ser é ESTÁVEL, para que reimportar a mesma pasta produza os mesmos ids e o
 * `mergeProject` se comporte como idempotente.
 */
const NAMESPACE = '6ba7b811-9dad-11d1-80b4-00c04fd430c8';

/**
 * UUID v5 (SHA-1) de `nome` dentro de `namespace`. Escrito aqui, e não trazido de um
 * pacote, porque o backend não depende de nenhuma biblioteca de UUID e acrescentar uma
 * ao lockfile por 15 linhas de norma pública seria caro pelo motivo errado.
 * @param {string} namespace - UUID canônico.
 * @param {string} nome
 * @returns {string} UUID v5 canônico.
 */
export function uuidV5(namespace, nome) {
  const hex = namespace.replace(/-/g, '');
  const ns = Buffer.from(hex, 'hex');
  const h = createHash('sha1').update(ns).update(Buffer.from(nome, 'utf8')).digest();
  const b = Buffer.from(h.subarray(0, 16));
  b[6] = (b[6] & 0x0f) | 0x50; // versão 5
  b[8] = (b[8] & 0x3f) | 0x80; // variante RFC 4122
  const s = b.toString('hex');
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}

/**
 * Distância em metros entre dois pontos WGS84 (haversine).
 * @param {{lat: number, lon: number}} a
 * @param {{lat: number, lon: number}} b
 * @returns {number}
 */
export function distanciaEmMetros(a, b) {
  const R = 6371000;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/**
 * Azimute INICIAL de `a` para `b`, em graus [0, 360).
 * @param {{lat: number, lon: number}} a
 * @param {{lat: number, lon: number}} b
 * @returns {number}
 */
export function azimuteEmGraus(a, b) {
  const rad = Math.PI / 180;
  const y = Math.sin((b.lon - a.lon) * rad) * Math.cos(b.lat * rad);
  const x =
    Math.cos(a.lat * rad) * Math.sin(b.lat * rad) -
    Math.sin(a.lat * rad) * Math.cos(b.lat * rad) * Math.cos((b.lon - a.lon) * rad);
  return ((Math.atan2(y, x) / rad) + 360) % 360;
}

/**
 * Lê a pasta METADATA e devolve as fotos e as ligações que ela declara.
 *
 * O ID DA FOTO É O `camera.id`, e não o nome do arquivo: é ele que os `targets`
 * dos vizinhos citam, então usar o nome quebraria toda ligação cujo arquivo tenha
 * sido renomeado alguma vez.
 *
 * ALVO QUE APONTA PARA FOTO AUSENTE É DESCARTADO AQUI, com contagem. O acervo tem
 * ligações para fotos de outras campanhas (medido: `MULTICAPTURA_6430_*` citada por
 * `MULTICAPTURA_5820_*`), e o importador as filtraria de qualquer jeito; descartar
 * aqui é o que permite CONTAR quantas eram.
 * @param {string} pastaMeta
 * @param {number|null} limite
 * @returns {{fotos: Array, ligacoes: Array, alvosOrfaos: number}}
 */
export function lerMetadados(pastaMeta, slug, limite = null) {
  const arquivos = readdirSync(pastaMeta).filter((n) => n.toLowerCase().endsWith('.json')).sort();
  const usados = limite ? arquivos.slice(0, limite) : arquivos;

  const fotos = [];
  const brutos = [];
  for (const nome of usados) {
    const dado = JSON.parse(readFileSync(join(pastaMeta, nome), 'utf8'));
    const c = dado.camera ?? {};
    if (!c.id || !Number.isFinite(c.lat) || !Number.isFinite(c.lon)) continue;
    // O NOME É A CHAVE DO ACERVO; O ID É A CHAVE DO PRODUTO. As ligações do JSON citam
    // o nome, e o cache de conversão é endereçado por ele (trocar a regra de id não pode
    // obrigar a reconverter 825 MB); o `id` é o UUID v5 que o schema e as rotas exigem.
    fotos.push({
      id: uuidV5(NAMESPACE, `${slug}/${c.id}`),
      nome: String(c.id),
      arquivoImagem: `${c.img ?? c.id}.jpg`,
      lat: c.lat,
      lon: c.lon,
      ele: Number.isFinite(c.ele) ? c.ele : null,
      heading: Number.isFinite(c.heading) ? c.heading : 0,
    });
    brutos.push({ origem: String(c.id), alvos: Array.isArray(dado.targets) ? dado.targets : [] });
  }

  const porNome = new Map(fotos.map((f) => [f.nome, f]));
  const ligacoes = [];
  let alvosOrfaos = 0;
  for (const { origem, alvos } of brutos) {
    const a = porNome.get(origem);
    for (const t of alvos) {
      const destino = String(t.id ?? t.img ?? '');
      const b = porNome.get(destino);
      if (!b) { alvosOrfaos++; continue; }
      ligacoes.push({
        source_id: a.id,
        target_id: b.id,
        distance_m: distanciaEmMetros(a, b),
        bearing_deg: azimuteEmGraus(a, b),
        is_next: t.next === true ? 1 : 0,
        is_original: 1,
        hidden: 0,
      });
    }
  }
  return { fotos, ligacoes, alvosOrfaos };
}

/**
 * Converte uma foto em `full` + `preview`, pulando o que já existe no cache.
 * @param {{entrada: string, full: string, preview: string, qualidade: number}} alvo
 * @returns {Promise<void>}
 */
async function converterUma({ entrada, full, preview, qualidade }) {
  if (!existsSync(full)) {
    await execFileAsync('ffmpeg', ['-y', '-loglevel', 'error', '-i', entrada,
      '-c:v', 'libwebp', '-quality', String(qualidade), full]);
  }
  if (!existsSync(preview)) {
    await execFileAsync('ffmpeg', ['-y', '-loglevel', 'error', '-i', entrada,
      '-vf', `scale=${LARGURA_PREVIEW}:-1`, '-c:v', 'libwebp',
      '-quality', String(QUALIDADE_PREVIEW), preview]);
  }
}

/**
 * Converte todas as fotos, com no máximo `jobs` conversões ao mesmo tempo.
 * @param {Array} fotos
 * @param {{pastaImg: string, cache: string, jobs: number, qualidade: number, logger: Console}} opcoes
 * @returns {Promise<void>}
 */
async function converterTodas(fotos, { pastaImg, cache, jobs, qualidade, logger }) {
  let proxima = 0;
  let feitas = 0;
  const trabalhador = async () => {
    for (;;) {
      const i = proxima++;
      if (i >= fotos.length) return;
      const f = fotos[i];
      await converterUma({
        entrada: join(pastaImg, f.arquivoImagem),
        full: join(cache, `${f.nome}.full.webp`),
        preview: join(cache, `${f.nome}.prev.webp`),
        qualidade,
      });
      feitas++;
      if (feitas % 25 === 0 || feitas === fotos.length) {
        logger.log(`[sv360-folder] convertidas ${feitas}/${fotos.length}`);
      }
    }
  };
  await Promise.all(Array.from({ length: jobs }, trabalhador));
}

/**
 * Escreve `{slug}.db` com os bytes do cache e devolve o tamanho de cada foto.
 *
 * OS TAMANHOS SAEM DAQUI, não de um `statSync` posterior: `validateImagesDb` compara
 * o `length()` do BLOB gravado com o `full_size_bytes` do manifesto, e medir o
 * arquivo em vez do blob é o tipo de divergência que só aparece na ingestão.
 * @param {string} destino
 * @param {Array} fotos
 * @param {string} cache
 * @returns {Map<string, {full: number, preview: number}>}
 */
export function escreverBanco(destino, fotos, cache) {
  if (existsSync(destino)) rmSync(destino);
  const db = new Database(destino);
  const tamanhos = new Map();
  try {
    db.pragma('journal_mode = WAL');
    db.exec('CREATE TABLE images (photo_id TEXT PRIMARY KEY, full_webp BLOB, preview_webp BLOB)');
    const ins = db.prepare('INSERT INTO images (photo_id, full_webp, preview_webp) VALUES (?, ?, ?)');
    const tx = db.transaction(() => {
      for (const f of fotos) {
        const full = readFileSync(join(cache, `${f.nome}.full.webp`));
        const preview = readFileSync(join(cache, `${f.nome}.prev.webp`));
        ins.run(f.id, full, preview);
        tamanhos.set(f.id, { full: full.length, preview: preview.length });
      }
    });
    tx();
  } finally {
    db.close();
  }
  return tamanhos;
}

/**
 * Escreve o `index.db` no schema legado que `sv360-import.js` lê.
 *
 * AS TABELAS OPCIONAIS SAEM VAZIAS, NÃO AUSENTES (`project_floors`,
 * `project_tracks`, `deleted_photos`): o importador tolera a ausência com
 * `try/catch`, mas um catch que engole erro de leitura não distingue "não existe"
 * de "existe e quebrou". Vazio responde a pergunta sem gastar o catch.
 * @param {string} destino
 * @param {{slug: string, nome: string, fotos: Array, ligacoes: Array, tamanhos: Map, dbFilename: string}} dados
 * @returns {void}
 */
export function escreverIndice(destino, { slug, nome, fotos, ligacoes, tamanhos, dbFilename }) {
  if (existsSync(destino)) rmSync(destino);
  const db = new Database(destino);
  try {
    db.exec(`
      CREATE TABLE projects (
        id INTEGER PRIMARY KEY, slug TEXT NOT NULL, name TEXT NOT NULL,
        center_lat REAL, center_long REAL, entry_photo_id TEXT,
        capture_date TEXT, db_filename TEXT NOT NULL, status TEXT DEFAULT 'enabled'
      );
      CREATE TABLE photos (
        id TEXT PRIMARY KEY, project_id INTEGER NOT NULL, original_name TEXT NOT NULL,
        display_name TEXT, sequence_number INTEGER NOT NULL,
        lat REAL NOT NULL, lon REAL NOT NULL, ele REAL,
        heading REAL DEFAULT 0, camera_height REAL DEFAULT 0,
        mesh_rotation_x REAL DEFAULT 0, mesh_rotation_y REAL DEFAULT 0, mesh_rotation_z REAL DEFAULT 0,
        distance_scale REAL DEFAULT 1, marker_scale REAL DEFAULT 1,
        floor_level INTEGER DEFAULT 0, floor_label TEXT,
        full_size_bytes INTEGER DEFAULT 0, preview_size_bytes INTEGER DEFAULT 0,
        calibration_reviewed INTEGER DEFAULT 0
      );
      CREATE TABLE targets (
        source_id TEXT NOT NULL, target_id TEXT NOT NULL,
        distance_m REAL, bearing_deg REAL,
        is_next INTEGER DEFAULT 0, is_original INTEGER DEFAULT 1,
        override_bearing REAL, override_distance REAL, override_height REAL,
        hidden INTEGER DEFAULT 0
      );
      CREATE TABLE project_floors (project_id INTEGER, level INTEGER, label TEXT, plan_coords TEXT);
      CREATE TABLE project_tracks (project_id INTEGER, coords TEXT, source TEXT);
      CREATE TABLE deleted_photos (photo_id TEXT, deleted_at TEXT);
    `);

    const centroLat = fotos.reduce((s, f) => s + f.lat, 0) / fotos.length;
    const centroLon = fotos.reduce((s, f) => s + f.lon, 0) / fotos.length;
    db.prepare(`INSERT INTO projects (id, slug, name, center_lat, center_long, entry_photo_id, db_filename)
                VALUES (1, ?, ?, ?, ?, ?, ?)`)
      .run(slug, nome, centroLat, centroLon, fotos[0].id, dbFilename);

    const insFoto = db.prepare(`INSERT INTO photos
      (id, project_id, original_name, sequence_number, lat, lon, ele, heading,
       full_size_bytes, preview_size_bytes)
      VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const insAlvo = db.prepare(`INSERT INTO targets
      (source_id, target_id, distance_m, bearing_deg, is_next, is_original, hidden)
      VALUES (?, ?, ?, ?, ?, ?, ?)`);

    const tx = db.transaction(() => {
      fotos.forEach((f, i) => {
        const t = tamanhos.get(f.id);
        insFoto.run(f.id, f.arquivoImagem, i + 1, f.lat, f.lon, f.ele, f.heading, t.full, t.preview);
      });
      for (const l of ligacoes) {
        insAlvo.run(l.source_id, l.target_id, l.distance_m, l.bearing_deg, l.is_next, l.is_original, l.hidden);
      }
    });
    tx();
  } finally {
    db.close();
  }
}

/**
 * Converte a pasta legada e escreve os dois SQLite.
 * @param {string} pastaLegada
 * @param {string} pastaSaida
 * @param {{slug?: string, nome?: string, jobs?: number, limite?: number|null, qualidade?: number, logger?: Console}} [opcoes]
 * @returns {Promise<{slug: string, indexDb: string, imagesDb: string, fotos: number, ligacoes: number, alvosOrfaos: number}>}
 */
export async function converterPasta(pastaLegada, pastaSaida, opcoes = {}) {
  const {
    slug = basename(resolve(pastaLegada)).replace(/^_+/, ''),
    nome = null,
    jobs = 4,
    limite = null,
    qualidade = 82,
    logger = console,
  } = opcoes;

  const pastaImg = join(pastaLegada, 'IMG');
  const pastaMeta = join(pastaLegada, 'METADATA');
  if (!existsSync(pastaImg) || !existsSync(pastaMeta)) {
    throw new Error(`sv360-folder-import: ${pastaLegada} nao tem IMG/ e METADATA/`);
  }

  const { fotos, ligacoes, alvosOrfaos } = lerMetadados(pastaMeta, slug, limite);
  if (fotos.length === 0) throw new Error('sv360-folder-import: nenhuma foto valida em METADATA/');
  logger.log(`[sv360-folder] ${fotos.length} fotos, ${ligacoes.length} ligacoes, ${alvosOrfaos} alvos orfaos descartados`);

  const cache = join(pastaSaida, '_webp');
  mkdirSync(cache, { recursive: true });
  await converterTodas(fotos, { pastaImg, cache, jobs, qualidade, logger });

  const dbFilename = `${slug}.db`;
  const imagesDb = join(pastaSaida, dbFilename);
  const tamanhos = escreverBanco(imagesDb, fotos, cache);
  logger.log(`[sv360-folder] ${dbFilename}: ${(statSync(imagesDb).size / 1e6).toFixed(1)} MB`);

  const indexDb = join(pastaSaida, 'index.db');
  escreverIndice(indexDb, { slug, nome: nome ?? slug, fotos, ligacoes, tamanhos, dbFilename });

  return { slug, indexDb, imagesDb, fotos: fotos.length, ligacoes: ligacoes.length, alvosOrfaos };
}

// CLI só quando executado diretamente (o padrão de `assets3d-import.js`): importar
// este arquivo para testar as funções puras não pode disparar uma conversão.
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const args = process.argv.slice(2);
  const posicionais = args.filter((a) => !a.startsWith('--'));
  const opcao = (nome, padrao) => {
    const achado = args.find((a) => a.startsWith(`--${nome}=`));
    return achado ? achado.slice(nome.length + 3) : padrao;
  };

  if (posicionais.length < 2) {
    console.error('Uso: node scripts/sv360-folder-import.js <pastaLegada> <pastaSaida> [--slug=] [--nome=] [--jobs=] [--limite=] [--qualidade=]');
    process.exit(1);
  }

  const [pastaLegada, pastaSaida] = posicionais;
  mkdirSync(pastaSaida, { recursive: true });

  const limiteBruto = opcao('limite', null);
  const resultado = await converterPasta(pastaLegada, pastaSaida, {
    slug: opcao('slug', undefined),
    nome: opcao('nome', null),
    jobs: Number(opcao('jobs', 4)),
    limite: limiteBruto === null ? null : Number(limiteBruto),
    qualidade: Number(opcao('qualidade', 82)),
  });

  console.log('');
  console.log(`Pronto: ${resultado.fotos} fotos e ${resultado.ligacoes} ligacoes em ${resultado.slug}.`);
  console.log('Agora ingira com:');
  console.log(`  npm run sv360:import -- "${resultado.indexDb}" "${pastaSaida}" ./data/sv360`);
}
