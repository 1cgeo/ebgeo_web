#!/usr/bin/env node
// Path: dev/import-config-catalog.mjs

/**
 * Importa o `config.js` do deploy legado (branch `main`, o arquivo estático que o
 * frontend carregava antes do backend) para as tabelas de catálogo do backend novo:
 * `basemaps`, `analysis_layers`, `data_layers`, `tilesets` e, opcionalmente, o
 * documento de override em `config_settings.app_config`.
 *
 * POR QUE ESCREVE DIRETO NO BANCO, e não pela API admin: são ~110 itens, e o CRUD
 * REST exige token de admin e uma chamada por item. O preço disso é que o memo do
 * `/api/config` (config.cache.js) NÃO é invalidado por esta escrita — ela é
 * exatamente o "UPDATE manual no banco" que o TTL de 30 s existe para cobrir. Ou
 * seja: a mudança aparece em no máximo `CONFIG_CACHE_TTL_MS` (default 30000), ou
 * imediatamente se o backend for reiniciado.
 *
 * MUTA O BANCO: por padrão roda em DRY-RUN e só imprime o que faria. Escrever exige
 * `--apply` explícito.
 *
 * Uso:
 *   node dev/import-config-catalog.mjs <caminho/para/config.js> [opções]
 *
 * Opções:
 *   --apply                   Executa a escrita (sem isso é dry-run).
 *   --assets3d-base=<prefixo> Reescreve o `url` de cada tileset para este prefixo
 *                             (ex.: /api/v1/assets3d). Sem isso o `url` vai verbatim.
 *   --strip-prefix=<prefixo>  O que remover do `url` antes de aplicar o de cima
 *                             (default: /catalogo/modelos_catalogo/3d).
 *   --no-overrides            Não escreve `config_settings.app_config`.
 *   --deactivate-missing      Marca `active = false` nas linhas que existem no banco
 *                             e não existem no config de origem (soft-delete, o mesmo
 *                             que o DELETE do painel admin faz).
 *
 * O DATABASE_URL sai do ambiente; se não estiver setado, é lido de `backend/.env`.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');
const BACKEND = resolve(REPO, 'backend');
const PUBLIC_DIR = resolve(REPO, 'frontend', 'public');

// pg-promise vive em backend/node_modules; resolver a partir do package.json do
// backend torna o script independente do cwd de quem o chama.
const requireFromBackend = createRequire(pathToFileURL(resolve(BACKEND, 'package.json')));
const pgPromise = requireFromBackend('pg-promise');

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);
const positional = argv.filter((a) => !a.startsWith('--'));
const hasFlag = (name) => argv.includes(`--${name}`);
const getOpt = (name, fallback) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit === undefined ? fallback : hit.slice(name.length + 3);
};

const SOURCE = positional[0];
const APPLY = hasFlag('apply');
const WRITE_OVERRIDES = !hasFlag('no-overrides');
const DEACTIVATE_MISSING = hasFlag('deactivate-missing');
const ASSETS3D_BASE = getOpt('assets3d-base', '');
const STRIP_PREFIX = getOpt('strip-prefix', '/catalogo/modelos_catalogo/3d');

// O Git Bash do Windows converte todo argumento que PARECE caminho POSIX em caminho
// Windows antes do node vê-lo: `--assets3d-base=/api/v1/assets3d` chega como
// `C:/Program Files/Git/api/v1/assets3d`. A reescrita rodaria inteira, sem erro, e
// gravaria 98 urls quebradas. Barato de detectar, caro de descobrir depois.
for (const [name, value] of [['assets3d-base', ASSETS3D_BASE], ['strip-prefix', STRIP_PREFIX]]) {
  if (value && !value.startsWith('/') && !/^https?:/.test(value)) {
    console.error(`--${name} precisa começar com "/" ou "http", e veio "${value}".`);
    console.error('No Git Bash isso é conversão de caminho do MSYS: use o PowerShell, ou prefixe MSYS_NO_PATHCONV=1.');
    process.exit(1);
  }
}

if (!SOURCE) {
  console.error(`Uso: node dev/import-config-catalog.mjs <caminho/para/config.js> [--apply] [--assets3d-base=/api/v1/assets3d]
                 [--strip-prefix=/catalogo/modelos_catalogo/3d] [--no-overrides] [--deactivate-missing]`);
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
// Transformações config.js -> linhas de catálogo
// ---------------------------------------------------------------------------

/**
 * Uma linha de catálogo. `config` é o JSONB servido verbatim pelo /api/config
 * (`config.service.js` faz `{ id, name, ...config }`), então TUDO que não é `id`
 * nem `name` precisa estar dentro dele — inclusive `description`, que na coluna
 * homônima existe só para o painel admin e nunca chega ao payload público.
 * @typedef {{ id: string, name: string, description: string|null, config: Object, sort_order: number }} CatalogRow
 */

/** @returns {CatalogRow[]} */
function mapBasemaps(source) {
  return Object.entries(source.basemaps || {}).map(([id, entry], i) => {
    const { name, ...rest } = entry;
    return {
      id,
      name: name || id,
      description: null,
      config: rest,
      sort_order: Number.isFinite(rest.priority) ? rest.priority : i + 1,
    };
  });
}

/** @returns {CatalogRow[]} */
function mapLayers(list) {
  return (list || []).map((layer, i) => {
    const { id, name, ...rest } = layer;
    return {
      id,
      name: name || id,
      description: rest.description ?? null,
      config: rest,
      sort_order: i + 1,
    };
  });
}

/**
 * Reescreve o `url` do modelo 3D para o prefixo de assets do backend novo.
 * Sem `--assets3d-base` devolve o url intacto.
 */
function rewriteAssetUrl(url) {
  if (!ASSETS3D_BASE || typeof url !== 'string') return url;
  const tail = url.startsWith(STRIP_PREFIX) ? url.slice(STRIP_PREFIX.length) : url;
  return `${ASSETS3D_BASE.replace(/\/$/, '')}/${tail.replace(/^\//, '')}`;
}

/** @returns {CatalogRow[]} */
function mapTilesets(source) {
  return (source.tilesets || []).map((tileset, i) => {
    const { id, name, ...rest } = tileset;
    return {
      id,
      name: name || id,
      description: rest.description ?? null,
      config: { ...rest, url: rewriteAssetUrl(rest.url) },
      sort_order: i + 1,
    };
  });
}

/**
 * Monta o documento parcial de override (as seções do /api/config que NÃO vêm de
 * tabela). Fica de fora, deliberadamente:
 *  - `services`, `map2d.terrainSource/hillshadeSource`, `map3d.providers`: são URLs
 *    de deploy e o backend as resolve por env (TILE_SERVER_URL, TERRAIN_URL, …).
 *    Gravá-las aqui congelaria no banco um endereço que o env existe para trocar.
 *  - `search.apiUrl`: o gazetteer é o próprio backend (GET /nomes/busca).
 *  - `streetView360`: o shape mudou de propósito (MVT servido por este backend).
 */
function buildOverrides(source) {
  const { bounds, minZoom, maxZoom, maxPitch, globe_projection, sourceTileLodParams, hillshade } = source.map2d || {};
  return {
    app: { ...(source.app || {}) },
    features: { ...(source.features || {}) },
    map2d: {
      ...(bounds !== undefined && { bounds }),
      ...(minZoom !== undefined && { minZoom }),
      ...(maxZoom !== undefined && { maxZoom }),
      ...(maxPitch !== undefined && { maxPitch }),
      ...(globe_projection !== undefined && { globe_projection }),
      ...(sourceTileLodParams !== undefined && { sourceTileLodParams }),
      ...(hillshade !== undefined && { hillshade }),
    },
  };
}

/** Deep-merge no mesmo formato do `config.service.js` (override vence; array e escalar substituem). */
function deepMerge(base, override) {
  if (override === null || typeof override !== 'object' || Array.isArray(override)) {
    return override === undefined ? base : override;
  }
  const out = base && typeof base === 'object' && !Array.isArray(base) ? { ...base } : {};
  for (const [k, v] of Object.entries(override)) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) ? deepMerge(out[k], v) : v;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Verificação prévia (o que entraria quebrado)
// ---------------------------------------------------------------------------

/**
 * Acusa item que o backend aceitaria gravar mas que não funciona do outro lado.
 * O caso silencioso é o primeiro: `listAnalysisLayers` FILTRA camada sem `bounds`
 * de 4 posições, então ela some do /api/config sem erro nenhum.
 * @returns {string[]}
 */
function collectWarnings({ basemaps, analysisLayers, dataLayers, tilesets }) {
  const warnings = [];

  for (const r of analysisLayers) {
    const b = r.config.bounds;
    if (!Array.isArray(b) || b.length !== 4) {
      warnings.push(`analysis_layers/${r.id}: sem bounds [w,s,e,n] válido — o /api/config a FILTRA em silêncio.`);
    }
    if (!r.config.source) warnings.push(`analysis_layers/${r.id}: sem 'source'.`);
  }
  for (const r of dataLayers) {
    if (!r.config.source) warnings.push(`data_layers/${r.id}: sem 'source'.`);
    if (!r.config.sourceLayer) warnings.push(`data_layers/${r.id}: sem 'sourceLayer'.`);
  }
  for (const r of tilesets) {
    if (!r.config.url) warnings.push(`tilesets/${r.id}: sem 'url'.`);
    if (!r.config.locate) warnings.push(`tilesets/${r.id}: sem 'locate' (o botão de voar até o modelo não funciona).`);
  }
  for (const r of basemaps) {
    if (r.config.priority === undefined) {
      warnings.push(`basemaps/${r.id}: sem 'priority' — getEnabledBasemaps ordena por ela.`);
    }
  }
  return warnings;
}

/**
 * Confere os caminhos de mídia. Miniatura e vídeo NÃO viajam pelo banco: o config só
 * guarda o caminho, e o arquivo é servido de fora (ou embutido como data URL pelo
 * painel admin). Um caminho que não existe vira 404 silencioso no catálogo.
 *
 * As duas famílias de caminho têm donos diferentes e não podem ser conferidas do
 * mesmo jeito: `./algo` é RELATIVO ao bundle, então mora em `frontend/public/` e dá
 * para verificar aqui; `/algo` é ABSOLUTO, servido pelo host do deploy (nginx), e
 * este repositório não tem como saber se existe. Tratá-las juntas produzia uma
 * lista de 200 "ausentes" em que 195 eram falso positivo.
 * @returns {{ missing: string[], checked: number, external: number }}
 */
function checkMediaPaths(rows) {
  const keys = ['image', 'thumbnail', 'previewThumbnail', 'previewVideo'];
  const missing = new Set();
  let checked = 0;
  let external = 0;
  for (const r of rows) {
    for (const k of keys) {
      const p = r.config[k];
      if (typeof p !== 'string' || !p || /^(https?:|data:)/.test(p)) continue;
      if (p.startsWith('/')) { external++; continue; }
      checked++;
      if (!existsSync(resolve(PUBLIC_DIR, p.replace(/^\.\//, '')))) missing.add(p);
    }
  }
  return { missing: [...missing], checked, external };
}

// ---------------------------------------------------------------------------
// Escrita
// ---------------------------------------------------------------------------

const UPSERT = (table) => `
  INSERT INTO ${table} (id, name, description, config, sort_order, active)
  VALUES ($1, $2, $3, $4::jsonb, $5, true)
  ON CONFLICT (id) DO UPDATE SET
    name        = EXCLUDED.name,
    description = EXCLUDED.description,
    config      = EXCLUDED.config,
    sort_order  = EXCLUDED.sort_order,
    active      = true,
    updated_at  = NOW()
  RETURNING (xmax = 0) AS inserted`;

const DEACTIVATE = (table) => `
  UPDATE ${table} SET active = false, updated_at = NOW()
  WHERE active = true AND id <> ALL($1::text[])
  RETURNING id`;

/** Grava um conjunto numa tabela e devolve o placar. */
async function upsertTable(t, table, rows) {
  let inserted = 0;
  let updated = 0;
  for (const r of rows) {
    const res = await t.one(UPSERT(table), [
      r.id, r.name, r.description, JSON.stringify(r.config), r.sort_order,
    ]);
    if (res.inserted) inserted++; else updated++;
  }
  let deactivated = [];
  if (DEACTIVATE_MISSING) {
    deactivated = (await t.any(DEACTIVATE(table), [rows.map((r) => r.id)])).map((x) => x.id);
  }
  return { inserted, updated, deactivated };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const sourcePath = resolve(process.cwd(), SOURCE);
  if (!existsSync(sourcePath)) throw new Error(`config.js não encontrado: ${sourcePath}`);
  const source = (await import(pathToFileURL(sourcePath).href)).default;
  if (!source || typeof source !== 'object') throw new Error('O arquivo não exporta um objeto default.');

  const sets = {
    basemaps: mapBasemaps(source),
    analysis_layers: mapLayers(source.analysisLayers?.layers),
    data_layers: mapLayers(source.dataLayers?.layers),
    tilesets: mapTilesets(source),
  };
  const overrides = buildOverrides(source);

  console.log(`\nOrigem: ${sourcePath}`);
  console.log(`Modo:   ${APPLY ? 'APPLY (escreve no banco)' : 'DRY-RUN (nada é escrito)'}`);
  if (ASSETS3D_BASE) {
    const sample = source.tilesets?.[0];
    console.log(`URL 3D: ${sample?.url} -> ${rewriteAssetUrl(sample?.url)}`);
  }

  console.log('\n--- A importar ---');
  for (const [table, rows] of Object.entries(sets)) {
    const sample = rows.slice(0, 4).map((r) => r.id).join(', ');
    console.log(`  ${table.padEnd(16)} ${String(rows.length).padStart(3)}  [${sample}${rows.length > 4 ? ', …' : ''}]`);
  }
  console.log(`  ${'config_settings'.padEnd(16)} ${WRITE_OVERRIDES ? 'app_config: ' + Object.keys(overrides).join(', ') : '(pulado)'}`);

  const allRows = Object.values(sets).flat();
  const warnings = collectWarnings({
    basemaps: sets.basemaps,
    analysisLayers: sets.analysis_layers,
    dataLayers: sets.data_layers,
    tilesets: sets.tilesets,
  });
  if (warnings.length) {
    console.log(`\n--- Avisos de contrato (${warnings.length}) ---`);
    for (const w of warnings.slice(0, 20)) console.log(`  ! ${w}`);
    if (warnings.length > 20) console.log(`  … e mais ${warnings.length - 20}.`);
  }

  const media = checkMediaPaths(allRows);
  if (media.missing.length) {
    console.log(`\n--- Mídia relativa ausente em frontend/public (${media.missing.length} de ${media.checked}) ---`);
    for (const p of media.missing.slice(0, 12)) console.log(`  ? ${p}`);
    if (media.missing.length > 12) console.log(`  … e mais ${media.missing.length - 12}.`);
    console.log('  (o config guarda só o caminho; suba o arquivo, ou embuta a miniatura pelo painel admin)');
  }
  if (media.external) {
    console.log(`\n  ${media.external} caminho(s) de mídia ABSOLUTO(s) (/…) — servidos pelo host do deploy, não verificáveis daqui.`);
  }

  if (!APPLY) {
    console.log('\nDry-run concluído. Repita com --apply para escrever.\n');
    return;
  }

  loadBackendEnv();
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL ausente (nem no ambiente nem em backend/.env).');

  const pgp = pgPromise();
  const db = pgp(process.env.DATABASE_URL);
  try {
    const results = await db.tx(async (t) => {
      const out = {};
      for (const [table, rows] of Object.entries(sets)) {
        out[table] = await upsertTable(t, table, rows);
      }
      if (WRITE_OVERRIDES) {
        const current = await t.oneOrNone("SELECT value FROM config_settings WHERE key = 'app_config'");
        const merged = deepMerge(current?.value ?? {}, overrides);
        const m2 = merged.map2d || {};
        if (m2.minZoom != null && m2.maxZoom != null && m2.minZoom > m2.maxZoom) {
          throw new Error(`map2d.minZoom (${m2.minZoom}) > maxZoom (${m2.maxZoom}): o app não boota com isso.`);
        }
        await t.none(
          `INSERT INTO config_settings (key, value, updated_at) VALUES ('app_config', $1::jsonb, NOW())
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
          [JSON.stringify(merged)],
        );
        out.config_settings = merged;
      }
      return out;
    });

    console.log('\n--- Escrito ---');
    for (const [table, r] of Object.entries(results)) {
      if (table === 'config_settings') {
        console.log(`  config_settings  app_config atualizado (${Object.keys(r).join(', ')})`);
        continue;
      }
      const extra = r.deactivated.length ? `, ${r.deactivated.length} desativado(s): ${r.deactivated.join(', ')}` : '';
      console.log(`  ${table.padEnd(16)} ${r.inserted} novo(s), ${r.updated} atualizado(s)${extra}`);
    }
    const ttl = process.env.CONFIG_CACHE_TTL_MS || '30000';
    console.log(`\nOK. O memo do /api/config expira em até ${ttl} ms (ou reinicie o backend para ver agora).\n`);
  } finally {
    await pgp.end();
  }
}

main().catch((err) => {
  console.error(`\nFalhou: ${err.message}\n`);
  process.exit(1);
});
