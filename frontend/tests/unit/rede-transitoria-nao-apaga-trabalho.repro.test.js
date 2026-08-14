import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * Regressão da cadeia mais cara da auditoria: um soluço de rede apagava o trabalho local.
 *
 * Causa-raiz (três elos): (1) `ApiClient.refresh()` tratava QUALQUER falha como sessão morta;
 * (2) `handleSessionLost` → `_handleLogout` chamava `clearAllDataStore()` (que limpa também a
 * fila de operações) sem olhar se havia trabalho pendente; (3) o flush falhava em silêncio, então
 * o usuário seguia editando contra um servidor que não recebia nada. Estes testes prendem as
 * defesas em profundidade do lado do cliente (elos 2 e 3 + o boot e o upload de imagem).
 *
 * O elo (1) mora em `api-client.js`, fora do escopo deste arquivo.
 */

// O toast é DOM puro; o ambiente de teste é node, então o módulo inteiro é dublê.
vi.mock('@utils/toast_service.js', () => ({
    showToast: vi.fn(),
    showSuccess: vi.fn(),
    showError: vi.fn(),
    showWarning: vi.fn(),
    showInChannel: vi.fn(),
}));

// O laço de flush só roda quando ONLINE e com fila não vazia — as duas condições são fixadas
// aqui para que o teste meça o tratamento do ERRO, não o portão de entrada.
vi.mock('../../src/js/store/sync/connection-state.js', () => ({
    connectionState: { isOnline: () => true },
}));
vi.mock('../../src/js/store/sync/operation-queue.js', () => ({
    operationQueue: { count: vi.fn(async () => 3) },
}));

import { showWarning } from '@utils/toast_service.js';
import {
    classifyFlushFailure,
    nextFlushAlertState,
    startAutoFlush,
    stopAutoFlush,
    FLUSH_ALERT_THRESHOLD,
} from '../../src/js/store/sync/sync-flush.js';
import { shouldPreserveLocalWork } from '../../src/js/account/account.control.js';
import { sharingErrorMessage } from '../../src/js/modals/sharing.modal.js';
import {
    uploadImageBlob,
    setImageSyncAtlas,
    imageUploadFailureNotice,
} from '../../src/js/store/sync/image-sync.js';
import { apiClient } from '../../src/js/store/sync/api-client.js';

/** @returns {Error} An ApiError-shaped error (the client stamps `status`). */
function apiError(status, message = 'boom') {
    return Object.assign(new Error(message), { status });
}

beforeEach(() => {
    vi.clearAllMocks();
});

describe('sync-flush: falha de envio deixa de ser silenciosa', () => {
    it('classifica 403 (permissão), 401 (sessão) e rede com mensagens DIFERENTES', () => {
        expect(classifyFlushFailure(apiError(403)).kind).toBe('permission');
        expect(classifyFlushFailure(apiError(401)).kind).toBe('session');
        expect(classifyFlushFailure(new TypeError('Failed to fetch')).kind).toBe('network');
        // Não são a mesma frase: uma se resolve pedindo permissão, a outra esperando.
        expect(classifyFlushFailure(apiError(403)).message)
            .not.toBe(classifyFlushFailure(apiError(500)).message);
    });

    it('trata 429/5xx/timeout como transitórios (rede), nunca como permissão', () => {
        for (const status of [429, 500, 502, 503, 504]) {
            expect(classifyFlushFailure(apiError(status)).kind).toBe('network');
        }
        expect(classifyFlushFailure({ name: 'AbortError' }).kind).toBe('network');
    });

    it('borda: erro nulo/sem status ainda produz mensagem de rede (nunca undefined)', () => {
        for (const bad of [null, undefined, {}, 'string', 0]) {
            const out = classifyFlushFailure(bad);
            expect(out.kind).toBe('network');
            expect(typeof out.message).toBe('string');
            expect(out.message.length).toBeGreaterThan(0);
        }
        // `statusCode` (forma alternativa usada em outros pontos do app) também é lido.
        expect(classifyFlushFailure({ statusCode: 403 }).kind).toBe('permission');
    });

    it('avisa SÓ ao cruzar o limiar, e uma única vez', () => {
        let state = { failures: 0, notifiedKind: null };
        const seen = [];
        for (let i = 0; i < 6; i++) {
            const next = nextFlushAlertState(state, apiError(503));
            state = { failures: next.failures, notifiedKind: next.notifiedKind };
            seen.push(next.message);
        }
        // Limiar 3: os dois primeiros ciclos são silêncio; o terceiro fala; o resto cala.
        expect(FLUSH_ALERT_THRESHOLD).toBe(3);
        expect(seen[0]).toBeNull();
        expect(seen[1]).toBeNull();
        expect(seen[2]).toBeTruthy();
        expect(seen.slice(3)).toEqual([null, null, null]);
        expect(state.failures).toBe(6);
    });

    it('uma mudança de motivo re-arma o aviso (403 depois de rede é notícia nova)', () => {
        let state = { failures: 0, notifiedKind: null };
        for (let i = 0; i < 3; i++) {
            const next = nextFlushAlertState(state, apiError(503));
            state = { failures: next.failures, notifiedKind: next.notifiedKind };
        }
        expect(state.notifiedKind).toBe('network');
        const escalated = nextFlushAlertState(state, apiError(403));
        expect(escalated.message).toContain('gestor');
        expect(escalated.notifiedKind).toBe('permission');
    });

    it('borda: estado anterior ausente/corrompido conta como zero falhas', () => {
        expect(nextFlushAlertState(null, apiError(500)).failures).toBe(1);
        expect(nextFlushAlertState(undefined, apiError(500)).failures).toBe(1);
        expect(nextFlushAlertState({ failures: NaN }, apiError(500)).failures).toBe(1);
        expect(nextFlushAlertState({ failures: 2 }, apiError(500), 3).message).toBeTruthy();
    });

    describe('no laço real (timers determinísticos)', () => {
        beforeEach(() => { vi.useFakeTimers(); });
        afterEach(() => {
            stopAutoFlush();
            vi.useRealTimers();
        });

        it('três ciclos consecutivos falhando avisam UMA vez, e o quarto não repete', async () => {
            const engine = { flush: vi.fn().mockRejectedValue(apiError(403)) };
            startAutoFlush(engine, { intervalMs: 1000 });

            await vi.advanceTimersByTimeAsync(0);      // flush imediato do start
            await vi.advanceTimersByTimeAsync(1000);   // ciclo 2
            expect(showWarning).not.toHaveBeenCalled();

            await vi.advanceTimersByTimeAsync(1000);   // ciclo 3 → cruza o limiar
            expect(showWarning).toHaveBeenCalledTimes(1);
            expect(showWarning.mock.calls[0][0]).toContain('não estão sendo salvas');

            await vi.advanceTimersByTimeAsync(3000);   // ciclos 4..6
            expect(engine.flush.mock.calls.length).toBeGreaterThanOrEqual(6);
            expect(showWarning).toHaveBeenCalledTimes(1); // sem repetição a cada 1,5 s
        });

        it('um flush bem-sucedido no meio zera a contagem (falha isolada é silêncio)', async () => {
            const engine = {
                flush: vi.fn()
                    .mockRejectedValueOnce(apiError(500))
                    .mockRejectedValueOnce(apiError(500))
                    .mockResolvedValueOnce({ pushed: 3 })
                    .mockRejectedValue(apiError(500)),
            };
            startAutoFlush(engine, { intervalMs: 1000 });
            await vi.advanceTimersByTimeAsync(0);
            await vi.advanceTimersByTimeAsync(3000); // 2 falhas, 1 sucesso, 1 falha
            expect(showWarning).not.toHaveBeenCalled();
        });
    });
});

describe('sessão perdida involuntariamente: o dado local sobrevive', () => {
    it('logout CLICADO continua limpando tudo (a decisão foi do usuário)', () => {
        expect(shouldPreserveLocalWork({ involuntary: false, pendingOps: 7 })).toBe(false);
        expect(shouldPreserveLocalWork({ involuntary: false, pendingOps: 0 })).toBe(false);
    });

    it('sessão perdida COM fila pendente preserva o dado', () => {
        expect(shouldPreserveLocalWork({ involuntary: true, pendingOps: 1 })).toBe(true);
        expect(shouldPreserveLocalWork({ involuntary: true, pendingOps: 999 })).toBe(true);
    });

    it('sessão perdida com fila VAZIA limpa (nada a perder)', () => {
        expect(shouldPreserveLocalWork({ involuntary: true, pendingOps: 0 })).toBe(false);
    });

    it('borda: contagem desconhecida (NaN/undefined/negativa) preserva — nunca apaga na dúvida', () => {
        expect(shouldPreserveLocalWork({ involuntary: true, pendingOps: NaN })).toBe(true);
        expect(shouldPreserveLocalWork({ involuntary: true, pendingOps: undefined })).toBe(false); // default 0
        expect(shouldPreserveLocalWork({ involuntary: true, pendingOps: Infinity })).toBe(true);
        expect(shouldPreserveLocalWork({ involuntary: true })).toBe(false);
        expect(shouldPreserveLocalWork({})).toBe(false);
        expect(shouldPreserveLocalWork()).toBe(false);
    });
});

describe('image-sync: offline é silêncio, upload falhado com atlas conectado avisa', () => {
    afterEach(() => {
        setImageSyncAtlas(null);
        vi.restoreAllMocks();
    });

    it('sem atlas conectado devolve null e NÃO avisa (o id local é a resposta certa)', async () => {
        setImageSyncAtlas(null);
        const spy = vi.spyOn(apiClient, 'uploadImage');
        expect(await uploadImageBlob(new Blob(['x']), 'a.png')).toBeNull();
        expect(spy).not.toHaveBeenCalled();
        expect(showWarning).not.toHaveBeenCalled();
    });

    it('com atlas conectado e upload falhando devolve null E avisa uma vez', async () => {
        setImageSyncAtlas('atlas-1');
        vi.spyOn(apiClient, 'uploadImage').mockRejectedValue(apiError(500));
        expect(await uploadImageBlob(new Blob(['x']), 'a.png')).toBeNull();
        expect(showWarning).toHaveBeenCalledTimes(1);
        expect(showWarning.mock.calls[0][0]).toContain('apenas para você');
    });

    it('upload bem-sucedido não avisa nada', async () => {
        setImageSyncAtlas('atlas-1');
        vi.spyOn(apiClient, 'uploadImage').mockResolvedValue({ id: 'img-1' });
        expect(await uploadImageBlob(new Blob(['x']), 'a.png')).toEqual({ id: 'img-1' });
        expect(showWarning).not.toHaveBeenCalled();
    });

    it('a mensagem distingue permissão (403) e tamanho (413) do caso geral', () => {
        expect(imageUploadFailureNotice(apiError(403))).toContain('permissão');
        expect(imageUploadFailureNotice(apiError(413))).toContain('grande demais');
        expect(imageUploadFailureNotice(apiError(500))).not.toContain('permissão');
    });

    it('borda: erro nulo/sem status ainda produz uma frase útil', () => {
        for (const bad of [null, undefined, {}, new Error('x')]) {
            const msg = imageUploadFailureNotice(bad);
            expect(typeof msg).toBe('string');
            expect(msg).toContain('apenas para você');
        }
    });
});

describe('sharing.modal: a recusa do servidor chega ao gestor', () => {
    it('prefere a mensagem do envelope quando existe', () => {
        expect(sharingErrorMessage(apiError(403, 'Você não é mais gestor deste projeto.'), 'genérica'))
            .toBe('Você não é mais gestor deste projeto.');
    });

    it('cai na frase genérica quando não há mensagem', () => {
        expect(sharingErrorMessage(null, 'genérica')).toBe('genérica');
        expect(sharingErrorMessage(undefined, 'genérica')).toBe('genérica');
        expect(sharingErrorMessage({}, 'genérica')).toBe('genérica');
        expect(sharingErrorMessage({ message: '   ' }, 'genérica')).toBe('genérica');
        expect(sharingErrorMessage({ message: 42 }, 'genérica')).toBe('genérica');
    });

    it('borda: o placeholder "HTTP <status>" do cliente NÃO é texto de usuário', () => {
        expect(sharingErrorMessage({ message: 'HTTP 404' }, 'genérica')).toBe('genérica');
        expect(sharingErrorMessage({ message: 'HTTP 500' }, 'genérica')).toBe('genérica');
        // Uma mensagem real que apenas MENCIONA HTTP continua passando.
        expect(sharingErrorMessage({ message: 'HTTP 404: dono não pode ser removido' }, 'g'))
            .toBe('HTTP 404: dono não pode ser removido');
    });
});
