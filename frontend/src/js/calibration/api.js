// Path: js/calibration/api.js

/**
 * @module calibration/api
 * @description Cliente HTTP da calibracao 360.
 *
 * Portado de `public/calibration/js/api.js` do ebgeo_360, com tres diferencas de fundo:
 *
 * 1. PREFIXO. La era `/api/v1`, servido pelo proprio Fastify da app. Aqui e
 *    `config.streetView360.serviceUrl` (`/api/v1/sv360`), que vem do `GET /api/config` e por isso
 *    acompanha o backend sem recompilar a pagina.
 * 2. ROTAS DE ALVO. La `POST /targets` e `/targets/:sourceId/:targetId/...`; aqui a foto de origem
 *    e um segmento de caminho: `POST /photos/:uuid/targets` e `/photos/:uuid/targets/:targetId`.
 * 3. CREDENCIAL. A origem NAO tem autenticacao nenhuma: ela escreve direto, sem token. Aqui toda
 *    escrita passa por `auth` estrito no backend, e a decisao do chefe e que so o papel `admin`
 *    calibra.
 *
 * DIVISAO DELIBERADA ENTRE LEITURA E ESCRITA:
 * - As ESCRITAS delegam ao `apiClient`, que e o unico lugar do cliente que renova o token ANTES de
 *   usa-lo e que refaz a requisicao uma vez depois de um 401. Reimplementar isso aqui seria uma
 *   segunda copia da regra de sessao, que e como ela passa a divergir.
 * - As LEITURAS ficam aqui, com `fetch` proprio, porque precisam de `AbortSignal` e de
 *   `cache: 'no-cache'`, que `_request` nao oferece. Elas levam o token mesmo assim
 *   (`apiClient.authHeader()`): as rotas de leitura sao `flexibleAuth`, e sem credencial um
 *   projeto DESABILITADO simplesmente nao aparece.
 */

import config from '@js/config.js';
import { apiClient, ApiError } from '@store/sync/api-client.js';

/**
 * Prefixo do modulo 360 no backend. O `/api/config` sobrescreve isto no boot, entao a pagina
 * segue o backend sem recompilar. Exportado porque o painel abre o JSON cru da foto numa aba.
 * @returns {string} Ex.: '/api/v1/sv360'
 */
export function sv360Base() {
    return config.streetView360?.serviceUrl || '/api/v1/sv360';
}

/** Atalho interno para `sv360Base()`. */
const base = sv360Base;

/** Timeout padrao (ms) para todas as leituras do cliente de calibracao. */
const DEFAULT_TIMEOUT_MS = 30000;

// ============================================================================
// ERROS DE AUTORIZACAO
// ============================================================================

/**
 * Falha de escrita que o operador precisa entender, e nao so ver passar num toast.
 *
 * `status` 401 significa sessao morta (o token expirou e o refresh tambem falhou); 403 significa
 * sessao viva SEM o papel `admin`. A origem nunca precisou destes dois casos, porque escrevia sem
 * credencial nenhuma.
 */
export class CalibrationAuthError extends Error {
    /**
     * @param {string} message - Texto ja pronto para o operador.
     * @param {number} status - 401 ou 403.
     */
    constructor(message, status) {
        super(message);
        this.name = 'CalibrationAuthError';
        this.status = status;
    }
}

/** @type {{ onUnauthorized: Function|null, onForbidden: Function|null }} */
const authHandlers = { onUnauthorized: null, onForbidden: null };

/**
 * Registra o que a pagina faz quando uma escrita e recusada por credencial.
 *
 * Sem isto um 403 vira um toast que some em segundos, e o operador segue calibrando contra um
 * backend que descarta tudo — o modo de falha que o porte tinha de eliminar.
 * @param {Object} handlers
 * @param {Function} [handlers.onUnauthorized] - Chamado uma vez por 401 (sessao encerrada).
 * @param {Function} [handlers.onForbidden] - Chamado uma vez por 403 (papel insuficiente).
 */
export function setWriteAuthHandlers({ onUnauthorized = null, onForbidden = null } = {}) {
    authHandlers.onUnauthorized = onUnauthorized;
    authHandlers.onForbidden = onForbidden;
}

const MSG_401 = 'Sua sessao expirou. Entre de novo para continuar calibrando.';
const MSG_403 = 'Voce nao tem o papel de admin: a calibracao nao aceita a sua escrita.';

/**
 * Executa uma escrita e traduz a recusa por credencial numa falha que se explica.
 *
 * Qualquer outro erro sai com a MESMA forma que a origem produzia (`... (HTTP nnn): texto`),
 * porque `app.js` e `calibration-panel.js` interpolam `err.message` direto no toast.
 * @param {() => Promise<*>} fn - A chamada ao apiClient.
 * @param {string} what - O que estava sendo gravado, para a mensagem de erro.
 * @returns {Promise<*>} O corpo da resposta.
 */
async function write(fn, what) {
    try {
        return await fn();
    } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
            authHandlers.onUnauthorized?.();
            throw new CalibrationAuthError(MSG_401, 401);
        }
        if (error instanceof ApiError && error.status === 403) {
            authHandlers.onForbidden?.();
            throw new CalibrationAuthError(MSG_403, 403);
        }
        if (error instanceof ApiError) {
            throw new Error(`${what} (HTTP ${error.status}): ${error.message}`);
        }
        throw error;
    }
}

// ============================================================================
// LEITURAS
// ============================================================================

/**
 * Combina um AbortSignal externo (opcional) com um timeout, retornando um
 * AbortSignal unico e uma funcao de limpeza do timer.
 *
 * Permite cancelar requisicoes obsoletas (signal do chamador) e tambem
 * evita promessas penduradas indefinidamente se a rede travar (timeout).
 *
 * @param {AbortSignal} [externalSignal] - Signal opcional do chamador
 * @param {number} [timeoutMs=DEFAULT_TIMEOUT_MS] - Timeout em milissegundos
 * @returns {{ signal: AbortSignal, cleanup: () => void }}
 */
function withTimeout(externalSignal, timeoutMs = DEFAULT_TIMEOUT_MS) {
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    if (!externalSignal) {
        return { signal: timeoutSignal, cleanup: () => {} };
    }
    // Aborta se qualquer um (chamador ou timeout) abortar.
    if (typeof AbortSignal.any === 'function') {
        return { signal: AbortSignal.any([externalSignal, timeoutSignal]), cleanup: () => {} };
    }
    // Fallback para browsers sem AbortSignal.any: encadeia manualmente.
    const controller = new AbortController();
    const onAbort = () => controller.abort(externalSignal.aborted ? externalSignal.reason : timeoutSignal.reason);
    if (externalSignal.aborted || timeoutSignal.aborted) {
        onAbort();
    } else {
        externalSignal.addEventListener('abort', onAbort, { once: true });
        timeoutSignal.addEventListener('abort', onAbort, { once: true });
    }
    const cleanup = () => {
        externalSignal.removeEventListener('abort', onAbort);
        timeoutSignal.removeEventListener('abort', onAbort);
    };
    return { signal: controller.signal, cleanup };
}

/**
 * Faz uma leitura JSON no modulo 360, com credencial quando houver sessao.
 * @param {string} path - Caminho relativo ao prefixo do modulo (ex.: '/projects').
 * @param {Object} [options]
 * @param {AbortSignal} [options.signal] - Cancelamento do chamador.
 * @param {string} [options.what] - Rotulo do recurso, usado na mensagem de erro.
 * @returns {Promise<*>} Corpo ja parseado.
 */
async function read(path, { signal, what = path } = {}) {
    const { signal: reqSignal, cleanup } = withTimeout(signal);
    try {
        const headers = await apiClient.authHeader();
        const response = await fetch(`${base()}${path}`, {
            cache: 'no-cache',
            headers,
            signal: reqSignal,
        });
        if (!response.ok) {
            throw new Error(`Failed to fetch ${what} (HTTP ${response.status})`);
        }
        return await response.json();
    } finally {
        cleanup();
    }
}

/**
 * Fetches all projects from the service.
 *
 * A resposta daqui e um ARRAY puro; a da origem era `{ projects: [...] }`. Aceita as duas formas
 * porque `normalizeProjects` do visualizador ja tinha de faze-lo, e uma so das duas quebraria em
 * silencio (lista vazia, sem erro).
 * @param {{ signal?: AbortSignal }} [options] - Opcoes de cancelamento
 * @returns {Promise<Array>} Array of project objects
 */
export async function fetchProjects({ signal } = {}) {
    const data = await read('/projects', { signal, what: 'projects' });
    return Array.isArray(data) ? data : (data?.projects ?? []);
}

/**
 * Fetches metadata for a photo by UUID.
 * @param {string} photoId - Photo UUID
 * @param {{ signal?: AbortSignal }} [options] - Opcoes de cancelamento
 * @returns {Promise<Object>} Metadata with camera and targets
 */
export async function fetchPhotoMetadata(photoId, { signal } = {}) {
    const { signal: reqSignal, cleanup } = withTimeout(signal);
    try {
        const headers = await apiClient.authHeader();
        const response = await fetch(`${base()}/photos/${encodeURIComponent(photoId)}?include_hidden=true`, {
            cache: 'no-cache',
            headers,
            signal: reqSignal,
        });
        if (!response.ok) {
            throw new Error(`Photo not found: ${photoId} (HTTP ${response.status})`);
        }
        return await response.json();
    } finally {
        cleanup();
    }
}

/**
 * Returns the URL for a photo image at a given quality.
 * Does not perform a fetch -- just builds the URL string.
 * @param {string} photoId - Photo UUID
 * @param {'full'|'preview'} [quality='full'] - Image quality variant
 * @returns {string} Image URL
 */
export function getPhotoImageUrl(photoId, quality = 'full') {
    return `${base()}/photos/${encodeURIComponent(photoId)}/image?quality=${quality}`;
}

/**
 * Fetches the photo list for a project (calibration workflow).
 * @param {string} slug - Project slug
 * @param {{ signal?: AbortSignal }} [options] - Opcoes de cancelamento
 * @returns {Promise<{photos: Array, reviewStats: {total: number, reviewed: number}}>}
 */
export async function fetchProjectPhotos(slug, { signal } = {}) {
    return read(`/projects/${encodeURIComponent(slug)}/photos`, {
        signal,
        what: `photos for project ${slug}`,
    });
}

/**
 * Fetches review counters for every project in one request.
 *
 * O seletor de projetos so desenha barras de progresso, e buscar a lista de
 * fotos de cada projeto para isso trazia o acervo inteiro (~11 MB de JSON).
 * @param {{ signal?: AbortSignal }} [options] - Opcoes de cancelamento
 * @returns {Promise<Record<string, {total: number, reviewed: number}>>} Stats por slug
 */
export async function fetchAllReviewStats({ signal } = {}) {
    const data = await read('/projects/review-stats', { signal, what: 'review stats' });
    return data.stats || {};
}

/**
 * Fetches the capture runs (faixas de coleta) of a project, with progress.
 *
 * LISTA VAZIA E A RESPOSTA NORMAL, e hoje e a UNICA: `sv360.capture_runs` esta vazia no acervo
 * inteiro, porque nada deriva faixas ainda. A interface trata isso como "projeto sem faixa" —
 * o mesmo modo que a origem ja previa para projeto nao derivado — e nao como erro.
 * @param {string} slug - Project slug
 * @param {{ signal?: AbortSignal }} [options] - Opcoes de cancelamento
 * @returns {Promise<Array>} Faixas ordenadas por ordinal
 */
export async function fetchProjectRuns(slug, { signal } = {}) {
    const data = await read(`/projects/${encodeURIComponent(slug)}/runs`, {
        signal,
        what: `runs for project ${slug}`,
    });
    return data.runs || [];
}

/**
 * Fetches the floors of a project, top to bottom.
 * Lista vazia significa projeto SEM andar declarado, e a interface nao mostra
 * seletor nenhum: e assim que os projetos externos seguem intactos.
 * @param {string} slug - Project slug
 * @param {{ signal?: AbortSignal }} [options] - Opcoes de cancelamento
 * @returns {Promise<Array>} Andares com level, label e photoCount
 */
export async function fetchProjectFloors(slug, { signal } = {}) {
    const data = await read(`/projects/${encodeURIComponent(slug)}/floors`, {
        signal,
        what: `floors for project ${slug}`,
    });
    return data.floors || [];
}

/**
 * Fetches everything the calibration map mode draws for one project:
 * photos with position, review state and the three angles, plus the capture
 * track as arrays of coordinates.
 * @param {string} slug - Project slug
 * @param {{ signal?: AbortSignal }} [options] - Opcoes de cancelamento
 * @returns {Promise<{slug: string, photos: Array, track: Array, bounds: Array<number>, reviewStats: {total: number, reviewed: number}}>}
 */
export async function fetchProjectMap(slug, { signal } = {}) {
    return read(`/projects/${encodeURIComponent(slug)}/map`, {
        signal,
        what: `map for project ${slug}`,
    });
}

/**
 * Fetches nearby unconnected photos for a given photo.
 * @param {string} photoId - Photo UUID
 * @param {number} [radius=100] - Search radius in meters
 * @param {{ signal?: AbortSignal, floor?: string|number }} [options] - Opcoes.
 *   `floor` ausente mantem o andar da foto de origem, que e o padrao seguro.
 *   `'all'` busca em todos os andares, para ligar escada e vomitorio.
 * @returns {Promise<{photos: Array}>} Nearby photos with distance and bearing
 */
export async function fetchNearbyPhotos(photoId, radius = 100, { signal, floor } = {}) {
    const qFloor = floor === undefined || floor === null
        ? '' : `&floor=${encodeURIComponent(floor)}`;
    return read(`/photos/${encodeURIComponent(photoId)}/nearby?radius=${radius}${qFloor}`, {
        signal,
        what: `nearby photos for ${photoId}`,
    });
}

// ============================================================================
// ESCRITAS (todas exigem token; so o papel `admin` calibra)
// ============================================================================

/**
 * Saves the mesh_rotation_y calibration value for a photo.
 * @param {string} photoId - Photo UUID
 * @param {number} meshRotationY - New mesh_rotation_y value in degrees
 * @returns {Promise<Object>} Server response
 */
export async function saveCalibration(photoId, meshRotationY) {
    return write(
        () => apiClient.setSv360Calibration(photoId, meshRotationY),
        `Failed to save calibration for ${photoId}`
    );
}

/**
 * Saves the mesh_rotation_x calibration value for a photo.
 * @param {string} photoId - Photo UUID
 * @param {number} meshRotationX - New mesh_rotation_x value in degrees
 * @returns {Promise<Object>} Server response
 */
export async function saveMeshRotationX(photoId, meshRotationX) {
    return write(
        () => apiClient.setSv360RotationX(photoId, meshRotationX),
        `Failed to save mesh_rotation_x for ${photoId}`
    );
}

/**
 * Saves the mesh_rotation_z calibration value for a photo.
 * @param {string} photoId - Photo UUID
 * @param {number} meshRotationZ - New mesh_rotation_z value in degrees
 * @returns {Promise<Object>} Server response
 */
export async function saveMeshRotationZ(photoId, meshRotationZ) {
    return write(
        () => apiClient.setSv360RotationZ(photoId, meshRotationZ),
        `Failed to save mesh_rotation_z for ${photoId}`
    );
}

/**
 * Marks a photo as reviewed or unreviewed.
 * @param {string} photoId - Photo UUID
 * @param {boolean} reviewed - Whether the photo is reviewed
 * @returns {Promise<Object>} Server response
 */
export async function setPhotoReviewed(photoId, reviewed) {
    return write(
        () => apiClient.setSv360Reviewed(photoId, reviewed),
        `Failed to set reviewed for ${photoId}`
    );
}

/**
 * Saves the visibility (hidden) state of a target.
 * @param {string} sourceId - Source photo UUID
 * @param {string} targetId - Target photo UUID
 * @param {boolean} hidden - Whether the target should be hidden
 * @returns {Promise<Object>} Server response
 */
export async function saveTargetVisibility(sourceId, targetId, hidden) {
    return write(
        () => apiClient.setSv360TargetVisibility(sourceId, targetId, hidden),
        `Failed to set visibility ${sourceId} -> ${targetId}`
    );
}

/**
 * Creates a new target connection between two photos.
 * @param {string} sourceId - Source photo UUID
 * @param {string} targetId - Target photo UUID
 * @returns {Promise<Object>} Server response with the created target
 */
export async function createTarget(sourceId, targetId) {
    return write(
        () => apiClient.createSv360Target(sourceId, targetId),
        `Failed to create target ${sourceId} -> ${targetId}`
    );
}

/**
 * Deletes a manually-created target connection.
 * @param {string} sourceId - Source photo UUID
 * @param {string} targetId - Target photo UUID
 * @returns {Promise<Object>} Server response
 */
export async function deleteTargetConnection(sourceId, targetId) {
    return write(
        () => apiClient.deleteSv360Target(sourceId, targetId),
        `Failed to delete target ${sourceId} -> ${targetId}`
    );
}

/**
 * Soft-deletes a photo (removes from navigation, keeps data for recovery).
 *
 * DEVOLVE `null`, NAO UM OBJETO. Esta rota responde 204 sem corpo; a da origem devolvia
 * `{ deletedPhotoId, projectSlug, newPhotoCount }`. Quem chama tem de tirar o slug do proprio
 * estado, e nao da resposta.
 * @param {string} photoId - Photo UUID
 * @returns {Promise<null>} Sem corpo (HTTP 204).
 */
export async function deletePhoto(photoId) {
    return write(
        () => apiClient.deleteSv360Photo(photoId),
        `Failed to delete photo ${photoId}`
    );
}

/**
 * Batch updates calibration fields for all photos in a project.
 * @param {string} slug - Project slug
 * @param {Object} values - Subconjunto de mesh_rotation_y/x/z
 * @returns {Promise<Object>} Server response with update counts
 */
export async function batchUpdateProject(slug, values) {
    return write(
        () => apiClient.batchSv360Project(slug, values),
        `Failed to batch update project ${slug}`
    );
}

/**
 * Resets all photos in a project to unreviewed.
 * @param {string} slug - Project slug
 * @returns {Promise<Object>} Server response with photosReset count
 */
export async function resetProjectReviewed(slug) {
    return write(
        () => apiClient.resetSv360ProjectReviewed(slug),
        `Failed to reset reviewed for project ${slug}`
    );
}

/**
 * Applies calibration defaults to every photo of one capture run.
 * @param {string} runId - Run UUID
 * @param {Object} values - Campos mesh_rotation_y/x/z a aplicar
 * @returns {Promise<Object>} Server response with update counts
 */
export async function batchUpdateRun(runId, values) {
    return write(
        () => apiClient.batchSv360Run(runId, values),
        `Failed to batch update run ${runId}`
    );
}
