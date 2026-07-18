// Path: js/search/gazetteer-url.js

/**
 * @fileoverview Resolve a URL de busca do gazetteer.
 *
 * A busca de topônimos É este backend (`GET /nomes/busca`), não um serviço
 * externo. Antes existia um `SEARCH_API_URL` configurável, cujo default apontava
 * para `http://localhost:3001/busca` — um serviço que nunca existiu: o fetch dava
 * ERR_CONNECTION_REFUSED e, como os dois call sites toleram erro, a busca
 * simplesmente nunca retornava nada, em silêncio.
 *
 * A rota é derivada da MESMA base que o resto da API usa, então funciona no dev
 * (proxy `/api` do Vite), em produção (mesma origem) e no E2E (que injeta
 * `__EBGEO_BACKEND_URL__` apontando para o backend descartável).
 *
 * Ligar/desligar a busca continua sendo `config.features.apisearch`.
 */

import { resolveBackendBaseUrl } from '@store/sync/runtime-config.js';

/**
 * @returns {string} URL da busca de nomes geográficos (sem query string).
 */
export function gazetteerSearchUrl() {
    return `${resolveBackendBaseUrl()}/nomes/busca`;
}
