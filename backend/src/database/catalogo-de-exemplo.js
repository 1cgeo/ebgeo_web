// Path: src/database/catalogo-de-exemplo.js
/**
 * @fileoverview As quatro camadas de EXEMPLO do catálogo, para os testes e o desenvolvimento.
 *
 * Elas moravam na base do catálogo (`src/database/migrations/005_catalogo.sql`) e saíram de toda
 * instalação por `src/database/migrations/018_catalogo_sem_exemplos.sql` (decisão do dono de
 * 2026-09-26): o endereço delas é http://localhost/tiles/..., que em produção nunca carrega. Os
 * testes que exercitam o catálogo (config, poda do clone, painel de camadas, exportação com fonte
 * que falha) e a máquina de desenvolvimento continuam precisando delas, e é aqui que elas voltam:
 * por quem sobe um banco de TESTE ou roda o `db:seed`, nunca por migração.
 *
 * As linhas são as da base, iguais campo a campo, para que os testes que as liam continuem medindo
 * o mesmo sujeito. Idempotente: reativa a linha que a migração desativou.
 */

import pgPromise from 'pg-promise';

/** As quatro linhas, na forma da base. */
export const CATALOGO_DE_EXEMPLO = Object.freeze({
  analysis_layers: Object.freeze([
    {
      id: 'declividade', name: 'Declividade', sort_order: 2,
      config: {
        description: 'Mapa de declividade do terreno',
        source: { type: 'raster-dem', url: 'http://localhost/tiles/dem/{z}/{x}/{y}.png' },
        bounds: [-45, -23, -44, -22],
        paint: { 'raster-opacity': 0.7 },
      },
    },
    {
      id: 'hipsometria', name: 'Hipsometria', sort_order: 3,
      config: {
        description: 'Mapa hipsométrico (altimetria) do terreno',
        source: { type: 'raster-dem', url: 'http://localhost/tiles/dem/{z}/{x}/{y}.png' },
        bounds: [-45, -23, -44, -22],
        paint: { 'raster-opacity': 0.6 },
      },
    },
  ]),
  data_layers: Object.freeze([
    {
      id: 'rodovias-federais', name: 'Rodovias Federais', sort_order: 1,
      config: {
        description: 'Malha rodoviária federal',
        source: { type: 'vector', url: 'http://localhost/tiles/rodovias' },
        sourceLayer: 'rodovias', minzoom: 4, maxzoom: 18,
        style: { border: { color: '#E74C3C', width: 2, opacity: 1 } },
      },
    },
    {
      id: 'limites-municipais', name: 'Limites Municipais', sort_order: 2,
      config: {
        description: 'Divisão político-administrativa municipal',
        source: { type: 'vector', url: 'http://localhost/tiles/municipios' },
        sourceLayer: 'municipios', minzoom: 4, maxzoom: 14,
        style: { border: { color: '#6b7280', width: 1, opacity: 0.8 } },
      },
    },
  ]),
});

/**
 * Semeia (ou reativa) as quatro camadas de exemplo.
 * @param {string|Object} alvo - Uma URL de conexão, ou um banco do pg-promise já aberto (`db`/`t`).
 * @returns {Promise<void>}
 */
export async function semearCatalogoDeExemplo(alvo) {
  const aberto = typeof alvo === 'string' ? null : alvo;
  const pgp = aberto ? null : pgPromise();
  const db = aberto ?? pgp(alvo);
  try {
    for (const [tabela, linhas] of Object.entries(CATALOGO_DE_EXEMPLO)) {
      for (const linha of linhas) {
        // Nome de tabela da lista fechada acima, nunca de entrada: o SQL é montado com ele.
        await db.none(
          `INSERT INTO ${tabela} (id, name, sort_order, config, active)
           VALUES ($1, $2, $3, $4::jsonb, true)
           ON CONFLICT (id) DO UPDATE
             SET name = EXCLUDED.name, sort_order = EXCLUDED.sort_order,
                 config = EXCLUDED.config, active = true, updated_at = NOW()`,
          [linha.id, linha.name, linha.sort_order, JSON.stringify(linha.config)]
        );
      }
    }
  } finally {
    if (pgp) await pgp.end();
  }
}
