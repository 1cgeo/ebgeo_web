// Path: src/modules/nomes/nomes.service.js
// Read-only gazetteer service (schema ng, PostGIS). No CRDT/broadcast/JSONB.
import { query } from '../../database/index.js';
import * as Q from './nomes.queries.js';

export async function busca({ q, lat, lon, zoom, userId }) {
  const { rows } = await query(Q.BUSCA, [q, lat, lon, zoom ?? null, userId ?? null]);
  return rows; // [{ nome, tipo, municipio, estado, longitude, latitude, score }]
}

export async function feicoes({ lat, lon, z, userId }) {
  const { rows } = await query(Q.FEICOES, [lon, lat, z, userId ?? null]); // $1=lon,$2=lat,$3=z,$4=userId
  return rows[0] ?? null;
}

export async function catalogo3d({ q, page, nr_records, userId }) {
  const offset = (page - 1) * nr_records;
  const qv = q || null;
  const uid = userId ?? null;
  const [data, cnt] = await Promise.all([
    query(Q.CATALOGO_SELECT, [qv, nr_records, offset, uid]),
    query(Q.CATALOGO_COUNT, [qv, uid]),
  ]);
  return { total: cnt.rows[0].total, page, nr_records, data: data.rows };
}
