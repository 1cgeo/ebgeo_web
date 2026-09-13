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
// `onStateChanged` e `ConnectionStates` entraram no dublê quando `image-sync.js` passou a instalar
// nesse singleton o gatilho de retomada da fila de blobs: um dublê que omite o que o sujeito chama
// reprova por TypeError, e o vermelho aponta para o dublê em vez do código.
vi.mock('../../src/js/store/sync/connection-state.js', () => ({
    connectionState: { isOnline: () => true, onStateChanged: vi.fn(() => () => {}) },
    ConnectionStates: Object.freeze({
        OFFLINE: 'offline', CONNECTING: 'connecting', ONLINE: 'online', RECONNECTING: 'reconnecting',
    }),
}));
vi.mock('../../src/js/store/sync/operation-queue.js', () => ({
    operationQueue: { count: vi.fn(async () => 3) },
}));

// A FILA DURÁVEL DE BLOBS É DUBLADA AQUI, e o recorte é deliberado: este arquivo mede o que
// `image-sync.js` DIZ ao usuário em cada desfecho, não o transporte. O mecanismo da fila (registro
// antes do envio, retomada com a mesma identidade, recusa definitiva) é medido contra IndexedDB de
// verdade em `tests/integration/blob-upload-queue.test.js`.
const filaDeBlobs = {
    enfileirarBlob: vi.fn(),
    retomarBlobsPendentes: vi.fn(async () => ({ tentadas: 0, confirmadas: 0, pendentes: 0, recusadas: 0 })),
    esquecerPendenciasEmMemoria: vi.fn(),
};
vi.mock('../../src/js/store/sync/blob-upload-queue.js', () => ({
    enfileirarBlob: (...args) => filaDeBlobs.enfileirarBlob(...args),
    retomarBlobsPendentes: (...args) => filaDeBlobs.retomarBlobsPendentes(...args),
    esquecerPendenciasEmMemoria: (...args) => filaDeBlobs.esquecerPendenciasEmMemoria(...args),
    blobUploadPending: () => false,
    BlobUploadState: Object.freeze({
        PENDENTE: 'pendente', CONFIRMADO: 'confirmado', RECUSADO: 'recusado',
    }),
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
} from '../../src/js/store/sync/image-sync.js';
import { CausaDeFalha, fraseDeFalhaDeBlob } from '../../src/js/store/sync/blob-upload-phrases.js';

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
        beforeEach(() => { vi.useFakeTimers(); vi.spyOn(Math, 'random').mockReturnValue(0.5); });
        afterEach(() => {
            stopAutoFlush();
            vi.useRealTimers();
            vi.restoreAllMocks();
        });

        it('três ciclos consecutivos falhando avisam UMA vez, e o quarto não repete', async () => {
            const engine = { flush: vi.fn().mockRejectedValue(apiError(403)) };
            startAutoFlush(engine, { intervalMs: 1000 });

            await vi.advanceTimersByTimeAsync(0);      // flush imediato do start
            await vi.advanceTimersByTimeAsync(2000);   // retry de 1500 ms, próximo tick
            expect(showWarning).not.toHaveBeenCalled();

            await vi.advanceTimersByTimeAsync(3000);   // ciclo 3 → cruza o limiar
            expect(showWarning).toHaveBeenCalledTimes(1);
            expect(showWarning.mock.calls[0][0]).toContain('não estão sendo salvas');

            await vi.advanceTimersByTimeAsync(6000);   // ciclo 4, com espera exponencial
            expect(engine.flush.mock.calls.length).toBe(4);
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
            await vi.advanceTimersByTimeAsync(6000); // 2 falhas, 1 sucesso, 1 falha
            expect(engine.flush).toHaveBeenCalledTimes(4);
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

    it('sem atlas conectado não enfileira e NÃO avisa (o atlas local não sobe nada)', async () => {
        setImageSyncAtlas(null);
        const r = await uploadImageBlob(new Blob(['x']), 'img-a');
        expect(r).toEqual({ confirmado: false, registrado: false, estado: null });
        expect(filaDeBlobs.enfileirarBlob).not.toHaveBeenCalled();
        expect(showWarning).not.toHaveBeenCalled();
    });

    it('com atlas conectado e envio pendente avisa uma vez, e a frase promete a retomada', async () => {
        setImageSyncAtlas('atlas-1');
        const frase = fraseDeFalhaDeBlob({ causa: CausaDeFalha.REDE });
        filaDeBlobs.enfileirarBlob.mockResolvedValue({
            registrado: true, confirmado: false, estado: 'pendente', motivo: frase,
        });
        const r = await uploadImageBlob(new Blob(['x']), 'img-a');
        expect(r).toEqual({ confirmado: false, registrado: true, estado: 'pendente' });
        // O ID VIAJA PARA A FILA, e é o do chamador: é isso que faz a retentativa cair sob a mesma
        // referência em vez de cunhar um terceiro id.
        expect(filaDeBlobs.enfileirarBlob).toHaveBeenCalledWith(
            expect.objectContaining({ imageId: 'img-a', atlasId: 'atlas-1' })
        );
        expect(showWarning).toHaveBeenCalledTimes(1);
        // A FRASE DO VEREDICTO CHEGA INTACTA, e é este `toBe` que prende o achado: enquanto o aviso
        // era recomposto aqui, a frase que a fila havia escrito era descartada em silêncio.
        expect(showWarning.mock.calls[0][0]).toBe(frase);
        expect(showWarning.mock.calls[0][0]).toContain('retomado');
    });

    it('recusa definitiva avisa com OUTRA frase: ela não promete retomada nenhuma', async () => {
        setImageSyncAtlas('atlas-1');
        const frase = fraseDeFalhaDeBlob({
            causa: CausaDeFalha.RECUSA, motivo: 'Invalid file type: image/gif',
        });
        filaDeBlobs.enfileirarBlob.mockResolvedValue({
            registrado: true, confirmado: false, estado: 'recusado', motivo: frase,
        });
        await uploadImageBlob(new Blob(['x']), 'img-a');
        expect(showWarning).toHaveBeenCalledTimes(1);
        expect(showWarning.mock.calls[0][0]).toContain('recusou');
        expect(showWarning.mock.calls[0][0]).not.toContain('retomado');
        // As palavras do SERVIDOR também chegam: são a única coisa que diz o que mudar na figura.
        expect(showWarning.mock.calls[0][0]).toContain('Invalid file type: image/gif');
    });

    it('envio confirmado não avisa nada', async () => {
        setImageSyncAtlas('atlas-1');
        filaDeBlobs.enfileirarBlob.mockResolvedValue({
            registrado: true, confirmado: true, estado: 'confirmado', motivo: '',
        });
        const r = await uploadImageBlob(new Blob(['x']), 'img-a');
        expect(r).toEqual({ confirmado: true, registrado: true, estado: 'confirmado' });
        expect(showWarning).not.toHaveBeenCalled();
    });

    it('conectar e desconectar são os dois gatilhos de retomada, e só o primeiro tenta enviar', async () => {
        setImageSyncAtlas('atlas-1');
        expect(filaDeBlobs.retomarBlobsPendentes).toHaveBeenCalledWith('atlas-1');
        setImageSyncAtlas(null);
        // Desmontado o escopo, o espelho em memória tem de cair: um id retido sem pendência legível
        // travaria a fila de saída sem nada capaz de liberá-la.
        expect(filaDeBlobs.esquecerPendenciasEmMemoria).toHaveBeenCalled();
        expect(filaDeBlobs.retomarBlobsPendentes).toHaveBeenCalledTimes(1);
    });

    it('permissão (403) e tamanho (413) CHEGAM à tela, cada uma com a sua frase', async () => {
        // O ACHADO DE P4, em duas linhas. O aviso era recomposto aqui a partir de
        // `{ message: resultado.motivo }`, e a função que o compunha só olhava `status`: os ramos de
        // 403 e de 413 eram inalcançáveis por este caminho, e o que a pessoa via era sempre a frase
        // genérica. Agora a causa viaja no veredicto e a frase dela é a que sobe.
        setImageSyncAtlas('atlas-1');
        const casos = [
            [fraseDeFalhaDeBlob({ causa: CausaDeFalha.PERMISSAO }), /permissão/i],
            [fraseDeFalhaDeBlob({ causa: CausaDeFalha.ARQUIVO, status: 413 }), /grande demais/i],
        ];
        for (const [frase, esperado] of casos) {
            showWarning.mockClear();
            filaDeBlobs.enfileirarBlob.mockResolvedValue({
                registrado: true, confirmado: false, estado: 'recusado', motivo: frase,
            });
            await uploadImageBlob(new Blob(['x']), 'img-a');
            expect(showWarning).toHaveBeenCalledTimes(1);
            expect(showWarning.mock.calls[0][0]).toMatch(esperado);
        }
        // E as duas não são a mesma frase: uma se resolve pedindo acesso, a outra trocando a figura.
        expect(casos[0][0]).not.toBe(casos[1][0]);
    });

    it('borda: veredicto SEM frase ainda avisa, e a frase de reserva é a de rede', async () => {
        // Alcançável de verdade: `assentar` devolve o registro intocado quando o disco recusa
        // gravar o desfecho, e ali `ultimoErro` ainda é nulo. A pendência existe e será retomada,
        // então a frase de reserva é a que promete retomada.
        setImageSyncAtlas('atlas-1');
        for (const vazio of ['', null, undefined]) {
            showWarning.mockClear();
            filaDeBlobs.enfileirarBlob.mockResolvedValue({
                registrado: true, confirmado: false, estado: 'pendente', motivo: vazio,
            });
            await uploadImageBlob(new Blob(['x']), 'img-a');
            expect(showWarning).toHaveBeenCalledTimes(1);
            const msg = showWarning.mock.calls[0][0];
            expect(typeof msg).toBe('string');
            expect(msg.length).toBeGreaterThan(0);
            expect(msg).toMatch(/retomado sozinho/i);
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
