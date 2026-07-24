// Path: src/modules/nomes/nomes.service.js
// Read-only gazetteer service (schema ng, PostGIS). No CRDT/broadcast/JSONB.
import { query, tx } from '../../database/index.js';
import * as Q from './nomes.queries.js';

/** Limiar de similaridade da busca. Era literal no predicado da SQL. */
const SIMILARITY_THRESHOLD = 0.25;

export async function busca({ q, lat, lon, zoom, userId }) {
  // A transação existe SÓ pelo SET LOCAL. O predicado da BUSCA usa o operador de
  // similaridade do pg_trgm para alcançar o índice GIN, e esse operador lê o
  // limiar de `pg_trgm.similarity_threshold`, cujo default é 0.3 — enquanto o
  // predicado antigo comparava contra 0.25 explicitamente. Sem fixar aqui, a
  // troca do predicado teria apertado a busca em silêncio, descartando os
  // resultados entre 0.25 e 0.3.
  //
  // SET LOCAL (e não SET) para que o valor morra com a transação e não vaze para
  // a próxima query que pegar a mesma conexão do pool.
  return tx(async (t) => {
    await t.none('SET LOCAL pg_trgm.similarity_threshold = $1', [SIMILARITY_THRESHOLD]);
    return t.any(Q.BUSCA, [q, lat, lon, zoom ?? null, userId ?? null]);
  }); // [{ nome, tipo, municipio, estado, longitude, latitude, score }]
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
