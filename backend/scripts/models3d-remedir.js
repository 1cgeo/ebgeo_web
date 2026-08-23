#!/usr/bin/env node
// Path: scripts/models3d-remedir.js
// REMEDE o ponto de navegação e as alturas de modelos JÁ publicados, lendo o `.3dtiles` em
// vez de reconverter. Portado de `scripts/remedir.js` do repositório `ebgeo_3d`.
//
// EXISTE POR CAUSA DE UM DEFEITO REAL. Enquanto o importador só sabia ler o ponto de
// `properties` ou de `boundingVolume.region`, e o DJI Terra não publica nenhum dos dois, o
// ponto entrava à mão no catálogo: o Silo Oreste Ceretta ficou 3.657 m ao sul do lugar
// dele. `envelopeGeodesico` mede a árvore inteira, e reconverter um modelo para consertar
// um metadado custaria horas — os `tileset.json` já gravados são os mesmos.
//
// ELE SÓ ESCREVE MEDIDA. O ajuste que um operador fez pela tela (uma descrição, um
// `maximumScreenSpaceError`) sobrevive, porque o `config` é MESCLADO. O `heightOffset` não
// é tocado: ele é decisão de quem opera, e não medida.
//
// Uso:
//   npm run models3d:remedir -- --dry-run
//   npm run models3d:remedir -- silo_oreste_ceretta
//   npm run models3d:remedir                        # todos
import Database from 'better-sqlite3';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import config from '../src/config.js';
import { query, tx, pgp } from '../src/database/index.js';
import { invalidateAppConfigCache } from '../src/modules/config/config.cache.js';
import {
  LIST_MODELS_3D_COM_PONTO,
  REMEDIR_MODEL_3D,
  REMEDIR_TILESET_3D,
} from '../src/modules/models3d/models3d.queries.js';
import { envelopeGeodesico } from './lib3d/tileset.js';

/** Metros por grau de latitude, para a distância que denuncia o erro. */
const METROS_POR_GRAU = 111320;

/**
 * Mede um modelo pelo arquivo e devolve o envelope, ou null quando ele não fecha.
 * @param {string} dbFilename
 * @returns {Object|null}
 */
export function medirArquivo(dbFilename) {
  const caminho = join(config.models3d.dbDir, dbFilename);
  if (!existsSync(caminho)) return null;
  const db = new Database(caminho, { readonly: true });
  try {
    const docs = new Map();
    for (const r of db.prepare("SELECT key, content FROM media WHERE key LIKE '%.json'").iterate()) {
      docs.set(r.key, JSON.parse(r.content.toString('utf-8')));
    }
    return envelopeGeodesico(docs);
  } finally {
    db.close();
  }
}

/**
 * Distância em metros entre o ponto do catálogo e o medido, ou null quando não há ponto.
 * @param {Object|null} locate @param {Object} envelope
 * @returns {number|null}
 */
export function deslocamento(locate, envelope) {
  const lon = Number(locate?.lon);
  const lat = Number(locate?.lat);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  return Math.round(
    Math.hypot(
      (envelope.lon - lon) * METROS_POR_GRAU * Math.cos((envelope.lat * Math.PI) / 180),
      (envelope.lat - lat) * METROS_POR_GRAU,
    ),
  );
}

/**
 * Grava a medida nas duas tabelas, numa transação só.
 * @param {string} modelId @param {Object} envelope
 * @returns {Promise<void>}
 */
export async function gravarMedida(modelId, envelope) {
  const patch = {
    groundHeight: +envelope.hChao.toFixed(1),
    minHeight: +envelope.hMin.toFixed(1),
    // A altura de CÂMERA, que é o chão mais 500 m: é de onde o "ir para" enquadra.
    locate: { lon: envelope.lon, lat: envelope.lat, height: +(envelope.hChao + 500).toFixed(1) },
  };
  await tx(async (t) => {
    await t.none(REMEDIR_MODEL_3D, {
      modelId,
      groundHeight: envelope.hChao,
      minHeight: envelope.hMin,
    });
    await t.none(REMEDIR_TILESET_3D, { id: modelId, patch: JSON.stringify(patch) });
  });
  invalidateAppConfigCache();
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes('--dry-run');
  const alvos = argv.filter((a) => !a.startsWith('--'));

  const fmt = (v) => (v == null ? '(vazio)' : Number(v).toFixed(6));

  const rodar = async () => {
    const { rows } = await query(LIST_MODELS_3D_COM_PONTO);
    const linhas = alvos.length ? rows.filter((r) => alvos.includes(r.model_id)) : rows;
    const ausentes = alvos.filter((a) => !rows.some((r) => r.model_id === a));
    for (const a of ausentes) console.error(`AUSENTE no catalogo: ${a}`);

    let mudados = 0;
    for (const m of linhas) {
      const envelope = medirArquivo(m.db_filename);
      if (!envelope) {
        console.error(`${m.model_id}: arquivo ausente ou envelope que nao fecha`);
        continue;
      }
      const dist = deslocamento(m.locate, envelope);
      console.log(m.model_id);
      console.log(
        `  catalogo  lon ${fmt(m.locate?.lon)} lat ${fmt(m.locate?.lat)}`
          + ` chao ${fmt(m.ground_height)} base ${fmt(m.min_height)}`,
      );
      console.log(
        `  medido    lon ${envelope.lon.toFixed(6)} lat ${envelope.lat.toFixed(6)}`
          + ` chao ${envelope.hChao.toFixed(1)} base ${envelope.hMin.toFixed(1)}`,
      );
      if (dist != null) console.log(`  ${dist > 50 ? 'DESLOCADO' : 'desloca'} ${dist} m`);
      if (!dryRun) {
        await gravarMedida(m.model_id, envelope);
        mudados += 1;
      }
    }
    console.log(dryRun ? '\ndry-run: nada gravado' : `\n${mudados} modelo(s) remedidos`);
  };

  rodar()
    .then(async () => {
      await Promise.resolve(pgp.end());
      process.exit(0);
    })
    .catch(async (err) => {
      console.error('models3d-remedir falhou:', err?.message || err);
      await Promise.resolve(pgp.end()).catch(() => {});
      process.exit(1);
    });
}
