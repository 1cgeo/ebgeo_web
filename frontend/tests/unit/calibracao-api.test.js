import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { apiClient, configureApiClient } from '../../src/js/store/sync/api-client.js';
import config from '../../src/js/config.js';
import * as api from '../../src/js/calibration/api.js';
import { CalibrationAuthError } from '../../src/js/calibration/api.js';

/**
 * Contrato de rede da CALIBRACAO 360 (`js/calibration/api.js`).
 *
 * A app veio do ebgeo_360, onde ela fala com `/api/v1` e NAO TEM AUTENTICACAO NENHUMA. Aqui o
 * prefixo e `/api/v1/sv360`, as rotas de alvo carregam a foto de origem no caminho, e toda escrita
 * exige token — so o papel `admin` calibra. Cada caso abaixo trava uma dessas tres mudancas, e
 * cada um REPROVA o cliente da origem: rodado contra ele, falha.
 *
 * As leituras usam o `fetch` global (elas precisam de AbortSignal e no-cache), entao sao dubladas
 * em `globalThis.fetch`. As escritas passam pelo `apiClient`, cujo `fetch` e injetavel.
 */

/** Resposta ao feitio do que o `_request` do apiClient sabe ler. */
function resp(status, body) {
    return {
        ok: status >= 200 && status < 300,
        status,
        text: async () => (body === undefined ? '' : JSON.stringify(body)),
    };
}

/** Resposta ao feitio do que as LEITURAS deste cliente leem (`.json()`). */
function jsonResp(status, body) {
    return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => body,
    };
}

const BASE = '/api/v1/sv360';
const PHOTO = '6a0ab98b-81d0-453a-b2c8-582c1d65a67a';
const TARGET = '7b902715-4340-44f8-8d40-637866c45a2f';

let fetchDoCliente;
let fetchGlobal;
let fetchOriginal;
let baseUrlOriginal;

beforeEach(() => {
    baseUrlOriginal = apiClient.baseUrl;
    fetchDoCliente = vi.fn(async () => resp(200, { ok: true }));
    configureApiClient({ baseUrl: '/api/v1', fetch: fetchDoCliente });
    apiClient.setTokens({ accessToken: 'tok-admin' });

    fetchOriginal = globalThis.fetch;
    fetchGlobal = vi.fn(async () => jsonResp(200, {}));
    globalThis.fetch = fetchGlobal;

    // O prefixo real chega pelo `GET /api/config`; nos testes ele e posto a mao.
    config.streetView360 = { serviceUrl: BASE };
    api.setWriteAuthHandlers({});
});

afterEach(() => {
    globalThis.fetch = fetchOriginal;
    apiClient.clearTokens();
    configureApiClient({ baseUrl: baseUrlOriginal });
    config.streetView360 = {};
});

/** Caminho (sem a base do apiClient) da ultima escrita. */
function ultimaEscrita() {
    const [url, opts] = fetchDoCliente.mock.calls.at(-1);
    return { url, method: opts.method, body: opts.body ? JSON.parse(opts.body) : undefined, headers: opts.headers };
}

describe('calibracao/api — prefixo do modulo 360', () => {
    // REPROVA `const BASE = '/api/v1'` da origem: la a leitura ia para /api/v1/projects.
    it('a leitura de projetos vai para /api/v1/sv360/projects', async () => {
        fetchGlobal.mockResolvedValueOnce(jsonResp(200, []));

        await api.fetchProjects();

        expect(fetchGlobal.mock.calls[0][0]).toBe(`${BASE}/projects`);
    });

    // REPROVA o prefixo fixo: aqui ele vem do config, entao acompanha o backend sem recompilar.
    it('a URL da imagem segue o serviceUrl do config', () => {
        config.streetView360 = { serviceUrl: 'http://outro.host/api/v1/sv360' };

        expect(api.getPhotoImageUrl(PHOTO, 'preview'))
            .toBe(`http://outro.host/api/v1/sv360/photos/${PHOTO}/image?quality=preview`);
    });

    // REPROVA `/api/v1/photos/:uuid`: a escrita da rotacao ia para o prefixo sem /sv360.
    it('a escrita de mesh_rotation_y vai para /sv360/photos/:uuid/calibration', async () => {
        await api.saveCalibration(PHOTO, 175.6);

        const { url, method, body } = ultimaEscrita();
        expect(url).toBe(`/api/v1/sv360/photos/${PHOTO}/calibration`);
        expect(method).toBe('PUT');
        expect(body).toEqual({ mesh_rotation_y: 175.6 });
    });
});

describe('calibracao/api — rotas de alvo', () => {
    // REPROVA `POST /targets` com `{ source_id, target_id }`: aqui a origem e segmento de caminho.
    it('criar alvo e POST /photos/:uuid/targets com { target_id }', async () => {
        await api.createTarget(PHOTO, TARGET);

        const { url, method, body } = ultimaEscrita();
        expect(url).toBe(`/api/v1/sv360/photos/${PHOTO}/targets`);
        expect(method).toBe('POST');
        expect(body).toEqual({ target_id: TARGET });
        expect(body.source_id).toBeUndefined();
    });

    // REPROVA `PUT /targets/:sourceId/:targetId/visibility`.
    it('visibilidade do alvo e PUT /photos/:uuid/targets/:targetId/visibility', async () => {
        await api.saveTargetVisibility(PHOTO, TARGET, true);

        const { url, method, body } = ultimaEscrita();
        expect(url).toBe(`/api/v1/sv360/photos/${PHOTO}/targets/${TARGET}/visibility`);
        expect(method).toBe('PUT');
        expect(body).toEqual({ hidden: true });
    });

    // REPROVA `DELETE /targets/:sourceId/:targetId`.
    it('remover alvo e DELETE /photos/:uuid/targets/:targetId', async () => {
        await api.deleteTargetConnection(PHOTO, TARGET);

        const { url, method } = ultimaEscrita();
        expect(url).toBe(`/api/v1/sv360/photos/${PHOTO}/targets/${TARGET}`);
        expect(method).toBe('DELETE');
    });
});

describe('calibracao/api — corpos que este backend exige', () => {
    // REPROVA o `{ reviewed }` da origem: o reviewedBodySchema daqui recusa chave desconhecida,
    // entao o nome antigo devolveria 422 em vez de gravar.
    it('marcar revisada envia { calibration_reviewed }, nao { reviewed }', async () => {
        await api.setPhotoReviewed(PHOTO, true);

        const { url, body } = ultimaEscrita();
        expect(url).toBe(`/api/v1/sv360/photos/${PHOTO}/reviewed`);
        expect(body).toEqual({ calibration_reviewed: true });
        expect(body).not.toHaveProperty('reviewed');
    });

    // REPROVA a leitura `data.projects`: esta rota devolve ARRAY puro, e o acesso antigo
    // resultaria em `undefined` — lista vazia, sem erro nenhum.
    it('fetchProjects aceita o array puro que esta rota devolve', async () => {
        fetchGlobal.mockResolvedValueOnce(jsonResp(200, [{ slug: 'museu_cms' }]));

        await expect(api.fetchProjects()).resolves.toEqual([{ slug: 'museu_cms' }]);
    });

    // `sv360.capture_runs` esta vazia no acervo inteiro: "sem faixa" e a resposta normal de HOJE
    // para todo projeto, e nao pode virar erro.
    it('projeto sem faixa devolve lista vazia, e nao erro', async () => {
        fetchGlobal.mockResolvedValueOnce(jsonResp(200, { runs: [] }));

        await expect(api.fetchProjectRuns('museu_cms')).resolves.toEqual([]);
    });

    // REPROVA o `return response.json()` da origem: aqui as duas exclusoes respondem 204 SEM
    // CORPO, e desembrulhar um corpo vazio faz a exclusao bem-sucedida parecer erro.
    it('excluir foto e excluir alvo aceitam o 204 sem corpo', async () => {
        fetchDoCliente.mockResolvedValue(resp(204));

        await expect(api.deletePhoto(PHOTO)).resolves.toBeNull();
        await expect(api.deleteTargetConnection(PHOTO, TARGET)).resolves.toBeNull();
    });
});

describe('calibracao/api — credencial (obra nova: a origem nao tem nenhuma)', () => {
    // REPROVA o `fetch(url)` cru da origem: sem Authorization, um projeto DESABILITADO some da
    // lista do operador sem erro nenhum.
    it('a leitura leva o Bearer quando ha sessao', async () => {
        fetchGlobal.mockResolvedValueOnce(jsonResp(200, { photos: [] }));

        await api.fetchProjectPhotos('museu_cms');

        const [, init] = fetchGlobal.mock.calls[0];
        expect(init.headers.Authorization).toBe('Bearer tok-admin');
        expect(init.cache).toBe('no-cache');
    });

    // Sem sessao a leitura segue anonima: as rotas de leitura sao flexibleAuth, e o acervo
    // habilitado e publico.
    it('sem sessao a leitura sai sem Authorization', async () => {
        apiClient.clearTokens();
        fetchGlobal.mockResolvedValueOnce(jsonResp(200, { floors: [] }));

        await api.fetchProjectFloors('museu_cms');

        const [, init] = fetchGlobal.mock.calls[0];
        expect(init.headers.Authorization).toBeUndefined();
    });

    // REPROVA a escrita sem credencial da origem.
    it('a escrita leva o Bearer', async () => {
        await api.saveMeshRotationX(PHOTO, 2.5);

        expect(ultimaEscrita().headers.Authorization).toBe('Bearer tok-admin');
    });
});

describe('calibracao/api — 401 e 403, que a origem nunca precisou ter', () => {
    // REPROVA a falha muda: um 403 tem de DIZER ao operador que falta o papel, e avisar a pagina.
    it('403 vira CalibrationAuthError que nomeia o papel, e chama onForbidden', async () => {
        const onForbidden = vi.fn();
        api.setWriteAuthHandlers({ onForbidden });
        fetchDoCliente.mockResolvedValue(resp(403, { error: 'Forbidden' }));

        const erro = await api.saveCalibration(PHOTO, 180).catch(e => e);

        expect(erro).toBeInstanceOf(CalibrationAuthError);
        expect(erro.status).toBe(403);
        expect(erro.message).toContain('admin');
        expect(onForbidden).toHaveBeenCalledTimes(1);
    });

    // REPROVA o mesmo silencio no 401: sessao morta tem de devolver a pagina a quem a montou.
    it('401 sem refresh vira CalibrationAuthError e chama onUnauthorized', async () => {
        const onUnauthorized = vi.fn();
        api.setWriteAuthHandlers({ onUnauthorized });
        fetchDoCliente.mockResolvedValue(resp(401, { error: 'Unauthorized' }));

        const erro = await api.setPhotoReviewed(PHOTO, true).catch(e => e);

        expect(erro).toBeInstanceOf(CalibrationAuthError);
        expect(erro.status).toBe(401);
        expect(onUnauthorized).toHaveBeenCalledTimes(1);
    });

    // O envelope do sv360 e PLANO (`{ error: 'texto' }`), e nao `{ error: { message } }`. Sem
    // desembrulhar o texto, o operador leria so "HTTP 422" para um valor fora de faixa.
    it('erro comum preserva o texto do envelope plano do sv360', async () => {
        fetchDoCliente.mockResolvedValue(resp(422, { error: 'mesh_rotation_x must be <= 30' }));

        const erro = await api.batchUpdateProject('museu_cms', { mesh_rotation_x: 99 }).catch(e => e);

        expect(erro).not.toBeInstanceOf(CalibrationAuthError);
        expect(erro.message).toContain('mesh_rotation_x must be <= 30');
        expect(erro.message).toContain('422');
    });

    // Um 401 numa escrita nao pode virar sucesso silencioso: quem chamou tem de ver a rejeicao.
    it('a escrita recusada rejeita, e nao resolve', async () => {
        fetchDoCliente.mockResolvedValue(resp(403, { error: 'Forbidden' }));

        await expect(api.resetProjectReviewed('museu_cms')).rejects.toThrow(CalibrationAuthError);
    });
});
