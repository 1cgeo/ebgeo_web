// Path: src/modules/nomes/nomes.service.js
// Read-only gazetteer service (schema ng, PostGIS). No CRDT/broadcast/JSONB.
import { tx } from '../../database/index.js';
import * as Q from './nomes.queries.js';

/** Limiar de similaridade da busca. Era literal no predicado da SQL. */
const SIMILARITY_THRESHOLD = 0.25;

export async function busca({ q, lat, lon, zoom }) {
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
    return t.any(Q.BUSCA, [q, lat, lon, zoom ?? null]);
  }); // [{ nome, tipo, municipio, estado, longitude, latitude, score }]
}
