#!/usr/bin/env node
// Path: dev/import-catalogo-3d-legado.mjs
//
// COMPLETA O CATÁLOGO DOS MODELOS 3D ADOTADOS, lendo o `index.db` do serviço antigo
// (`ebgeo_3d`). É o passo que falta entre `models3d:adotar` e a paridade com o que a
// produção serve hoje.
//
// POR QUE ELE EXISTE, e o caso está medido. O `models3d:adotar` reconstrói a linha de
// catálogo a partir do cabeçalho `meta` do próprio `.3dtiles`, de propósito: é o que
// permite readotar um acervo sem banco nenhum. Só que o cabeçalho guarda a PRODUÇÃO
// (token, contagem de tiles, envelope geodésico) e não o CATÁLOGO: o `meta.name` é o
// slug, e descrição, local, palavras-chave, data de captura, miniatura, vídeo e
// `heightOffset` não estão lá. Medido no acervo de 2026-09-16, com os 105 modelos do
// servidor: 105 têm nome amigável, 105 descrição, 105 palavras-chave, 105 local e 6 têm
// `heightOffset` diferente de zero (o `serra_dourada` tem 793). Adotar sem este passo
// publica 105 cartões chamados `13bib`, `4rcb`, `cmdo14bda`, sem miniatura, sem busca por
// palavra-chave, e com seis modelos fora da altura certa.
//
// A ORDEM IMPORTA, e readotar desfaz PARTE do trabalho. Medido em 2026-09-16, readotando o
// `serra_dourada` já enriquecido: o `UPSERT_TILESET_3D` faz `name = EXCLUDED.name` e mescla
// o `config` com o lado do ARQUIVO vencendo, então voltam ao estado do arquivo exatamente
// os dois campos que o cabeçalho TEM, o `name` (para o slug) e o `heightOffset` (para
// zero). Descrição, local, palavras-chave, data e as duas mídias sobrevivem, porque o lado
// novo não traz essas chaves. Rode adotar → enriquecer, e repita o enriquecimento depois de
// qualquer readoção; o script é idempotente e custa segundos.
//
// O QUE ELE NÃO FAZ: não cria linha de catálogo (modelo que não foi adotado é PULADO, e
// dito na saída, porque uma linha sem bytes é um pino que aparece e um clique que 404),
// não move arquivo, não mexe nos dois eixos de acesso (`access_level` e `owner_org_id` são
// decisão de administrador) e não inventa miniatura: a URL só é gravada quando o arquivo
// existe na pasta de assets que você apontar.
//
// Uso:
//   node dev/import-catalogo-3d-legado.mjs --index-db=<caminho>/index.db
//   node dev/import-catalogo-3d-legado.mjs --index-db=... --assets-dir=<caminho>/assets --apply
//
// | Flag | Efeito |
// |---|---|
// | `--index-db=` | o `index.db` do `ebgeo_3d` legado. Obrigatório. Aberto SOMENTE-LEITURA. |
// | `--apply` | executa a escrita. Sem ela é dry-run. |
// | `--assets-dir=` | pasta com `<id>.webp` e `<id>.webm`. Sem ela, miniatura e vídeo não viajam. |
// | `--assets-base=` | prefixo público da miniatura. Default `/api/v1/assets3d`. |
// | `--publicados` | pula os modelos com `published = 0` na origem, em vez de desativá-los. |
// | `--so=a,b,c` | restringe a estes ids (o piloto). |
//
// `DATABASE_URL` (o DESTINO) sai do ambiente ou de `backend/.env`.
//
// Windows: passe os caminhos no formato do Windows (`D:\...`) ou rode pelo PowerShell. No
// Git Bash o MSYS converte um `--assets-base=/api/v1/assets3d` em caminho de disco antes do
// node ver o argumento; este script detecta e aborta, em vez de gravar URLs quebradas.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const BACKEND = resolve(HERE, '..', 'backend');
const requireFromBackend = createRequire(pathToFileURL(resolve(BACKEND, 'package.json')));
const pgp = requireFromBackend('pg-promise')();
const Database = requireFromBackend('better-sqlite3');

// ---------------------------------------------------------------- argumentos
const args = process.argv.slice(2);
const flag = (nome) => args.some((a) => a === `--${nome}`);
const valor = (nome) => {
  const achado = args.find((a) => a.startsWith(`--${nome}=`));
  return achado ? achado.slice(nome.length + 3) : null;
};

const INDEX_DB = valor('index-db');
const ASSETS_DIR = valor('assets-dir');
const ASSETS_BASE = valor('assets-base') || '/api/v1/assets3d';
const APPLY = flag('apply');
const SO_PUBLICADOS = flag('publicados');
const SO = (valor('so') || '').split(',').map((s) => s.trim()).filter(Boolean);

if (!INDEX_DB) {
  console.error('Falta --index-db=<caminho do index.db do ebgeo_3d>.');
  process.exit(1);
}
if (!existsSync(INDEX_DB)) {
  console.error(`index.db não encontrado: ${INDEX_DB}`);
  process.exit(1);
}
// O MSYS do Git Bash converte um argumento que PARECE caminho POSIX. Sem esta guarda o
// script gravaria 105 URLs começando em `C:/Program Files/Git/...`.
if (/^[A-Za-z]:[\\/]/.test(ASSETS_BASE)) {
  console.error(`--assets-base virou caminho de disco (${ASSETS_BASE}): o MSYS do Git Bash o converteu.`);
  console.error('Rode pelo PowerShell, ou prefixe com MSYS_NO_PATHCONV=1.');
  process.exit(1);
}

// ---------------------------------------------------------------- destino
function databaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const envPath = resolve(BACKEND, '.env');
  if (existsSync(envPath)) {
    for (const linha of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      if (linha.startsWith('DATABASE_URL=')) return linha.slice('DATABASE_URL='.length).trim();
    }
  }
  console.error('DATABASE_URL ausente no ambiente e em backend/.env.');
  process.exit(1);
}

// ---------------------------------------------------------------- leitura da origem
/**
 * Lê o catálogo do serviço antigo. SOMENTE-LEITURA: o arquivo pode estar servindo agora.
 * @param {string} caminho - caminho do index.db
 * @returns {Array<Object>} as linhas de `models`
 */
function lerOrigem(caminho) {
  const db = new Database(caminho, { readonly: true, fileMustExist: true });
  try {
    return db.prepare('SELECT * FROM models ORDER BY id').all();
  } finally {
    db.close();
  }
}

/**
 * As palavras-chave viajam serializadas na origem, e uma origem malformada não pode
 * derrubar a carga inteira: linha ilegível vira lista vazia e entra no relatório.
 * @param {string|null} bruto - o JSON da coluna `keywords`
 * @param {string} id - o modelo, para a mensagem
 * @param {Array<string>} avisos - acumulador
 * @returns {Array<string>|null}
 */
function lerKeywords(bruto, id, avisos) {
  if (!bruto) return null;
  try {
    const v = JSON.parse(bruto);
    if (Array.isArray(v) && v.length) return v.map(String);
    return null;
  } catch {
    avisos.push(`${id}: keywords ilegível, ignorada (${String(bruto).slice(0, 40)})`);
    return null;
  }
}

/**
 * Monta o pedaço de `config` que a origem tem e o cabeçalho do `.3dtiles` não tem.
 *
 * A MINIATURA SÓ ENTRA COM O ARQUIVO NA MÃO. A origem guarda `preview_thumb` nulo nos 105
 * modelos medidos e o serviço antigo deriva `/assets/<id>.webp` por convenção; derivar sem
 * conferir gravaria 105 URLs que respondem 404 e um cartão com imagem quebrada, que é pior
 * que o desenho genérico do catálogo.
 * @param {Object} m - a linha de `models`
 * @param {Array<string>} avisos - acumulador
 * @returns {{config: Object, ativo: boolean}}
 */
function montarConfig(m, avisos) {
  const config = {};
  if (m.description) config.description = m.description;
  if (m.local) config.local = m.local;
  const kw = lerKeywords(m.keywords, m.id, avisos);
  if (kw) config.keywords = kw;
  if (m.captured_at) config.data_captura = m.captured_at;
  // heightOffset zero é o default do cabeçalho: gravá-lo de novo não muda nada, e omiti-lo
  // deixa o valor que a adoção já pôs. O que importa são os que NÃO são zero.
  if (Number(m.height_offset)) config.heightOffset = Number(m.height_offset);
  if (m.max_sse != null) config.maximumScreenSpaceError = Number(m.max_sse);

  // GLB: a pose é o registro inteiro, e meia pose põe o modelo no lugar errado sem erro.
  if (m.model_type === 'glb') {
    if (m.position_lon != null && m.position_lat != null) {
      config.position = { lon: Number(m.position_lon), lat: Number(m.position_lat) };
    } else {
      avisos.push(`${m.id}: model_type=glb sem position_lon/lat na origem`);
    }
    if (m.rot_heading != null || m.rot_pitch != null || m.rot_roll != null) {
      config.rotation = {
        heading: Number(m.rot_heading || 0),
        pitch: Number(m.rot_pitch || 0),
        roll: Number(m.rot_roll || 0),
      };
    }
    if (m.scale != null) config.scale = Number(m.scale);
  }

  if (ASSETS_DIR) {
    for (const [chave, ext] of [['previewThumbnail', 'webp'], ['previewVideo', 'webm']]) {
      const arquivo = join(ASSETS_DIR, `${m.id}.${ext}`);
      if (existsSync(arquivo)) config[chave] = `${ASSETS_BASE.replace(/\/+$/, '')}/${m.id}.${ext}`;
    }
  }

  return { config, ativo: m.published !== 0 };
}

// ---------------------------------------------------------------- escrita
const UPSERT = `
  UPDATE tilesets SET
    name        = $<name>,
    description = COALESCE($<description>, description),
    config      = config || $<config>::jsonb,
    active      = $<ativo>,
    updated_at  = NOW()
  WHERE id = $<id>
`;

async function main() {
  const origem = lerOrigem(INDEX_DB);
  const db = pgp(databaseUrl());
  const alvo = new URL(databaseUrl());

  console.log(`\norigem : ${INDEX_DB} (${origem.length} modelo(s))`);
  console.log(`destino: ${alvo.pathname.slice(1)} em ${alvo.hostname}:${alvo.port || 5432}`);
  console.log(`modo   : ${APPLY ? 'APPLY (escreve)' : 'DRY-RUN (nada é escrito)'}`
    + `${ASSETS_DIR ? ` | assets=${ASSETS_DIR}` : ' | SEM assets (miniatura e vídeo não viajam)'}`
    + `${SO.length ? ` | só ${SO.join(',')}` : ''}\n`);

  const adotados = new Map(
    (await db.any('SELECT t.id, t.name FROM tilesets t JOIN a3d.models m ON m.model_id = t.id'))
      .map((r) => [r.id, r])
  );

  const avisos = [];
  const aEscrever = [];
  const naoAdotados = [];
  const pulados = [];

  for (const m of origem) {
    if (SO.length && !SO.includes(m.id)) continue;
    if (SO_PUBLICADOS && m.published === 0) { pulados.push(m.id); continue; }
    if (!adotados.has(m.id)) { naoAdotados.push(m.id); continue; }
    const { config, ativo } = montarConfig(m, avisos);
    aEscrever.push({
      id: m.id,
      name: m.name || m.id,
      description: m.description || null,
      config: JSON.stringify(config),
      ativo,
      _campos: Object.keys(config),
    });
  }

  console.log('--- a completar ---');
  for (const r of aEscrever.slice(0, 8)) {
    console.log(`  ${r.id.padEnd(28)} ${String(r.name).slice(0, 40).padEnd(42)} ${r._campos.join(',')}`);
  }
  if (aEscrever.length > 8) console.log(`  … e mais ${aEscrever.length - 8}.`);

  const comThumb = aEscrever.filter((r) => r._campos.includes('previewThumbnail')).length;
  const comVideo = aEscrever.filter((r) => r._campos.includes('previewVideo')).length;
  const comOffset = aEscrever.filter((r) => r._campos.includes('heightOffset')).length;
  console.log(`\n  ${aEscrever.length} modelo(s) casado(s) com o catálogo adotado`);
  console.log(`  miniatura ${comThumb}, vídeo ${comVideo}, heightOffset não-zero ${comOffset}`);
  if (naoAdotados.length) {
    console.log(`\n  ${naoAdotados.length} na origem e NÃO adotado(s) aqui (pulados, sem bytes no destino):`);
    console.log(`    ${naoAdotados.slice(0, 12).join(', ')}${naoAdotados.length > 12 ? ', …' : ''}`);
  }
  if (pulados.length) console.log(`\n  ${pulados.length} despublicado(s) na origem, pulado(s) por --publicados.`);
  if (avisos.length) {
    console.log('\n--- avisos ---');
    for (const a of avisos.slice(0, 12)) console.log(`  ! ${a}`);
  }

  if (!APPLY) {
    console.log('\nDry-run: nada foi escrito. Repita com --apply.\n');
    await db.$pool.end();
    return;
  }

  let escritos = 0;
  await db.tx(async (t) => {
    for (const r of aEscrever) {
      const res = await t.result(UPSERT, r);
      escritos += res.rowCount;
    }
  });
  console.log(`\n--- escrito ---\n  ${escritos} linha(s) de catálogo completada(s)`);
  console.log('\nO memo do /api/config expira em até CONFIG_CACHE_TTL_MS (ou reinicie o backend).\n');
  await db.$pool.end();
}

main().catch((e) => {
  console.error(`Falhou: ${e.message}`);
  process.exit(1);
});
