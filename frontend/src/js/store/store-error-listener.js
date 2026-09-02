// Path: js/store/store-error-listener.js

/**
 * @module store/store-error-listener
 * @description Subscribes to store error events and shows user-facing feedback.
 * Initialized once during app startup via initStoreEvents().
 *
 * Uses showInChannel to prevent toast stacking on rapid failures
 * (e.g. IndexedDB quota exceeded during batch operations).
 */

import { StoreErrorEvents } from './store-errors.js';
import { denialNotice } from './denial-phrases.js';
import { sessionContext } from './sync/session-context.js';
import { overwriteNotice } from './sync/overwrite-notice.js';
import { presenceStore } from '../presence/presence-store.js';
import { EventTypes } from '../events/event_types.js';
import { showInChannel } from '../utilities/toast_service.js';
import { relatarErro } from '@js/session/erro-telemetria.js';
import { OrigemDeErro } from '@js/session/origens-de-erro.js';

/** Minimum interval between "blocked" toasts (ms) */
const BLOCKED_DEBOUNCE_MS = 3000;

/**
 * Block reasons that mean "the map is locked" (vs an insufficient-role / read-only block). The store
 * ops emit `map_locked` (current map) and `target_map_locked` (a move into a locked destination map);
 * every other reason is a permission string from the permission-guard.
 */
const LOCK_REASONS = new Set(['map_locked', 'target_map_locked']);

/** Last toast time PER KIND, so a lock toast doesn't debounce-swallow a differing read-only one. */
const _lastBlockedToastAt = { lock: 0, denied: 0, explicit: 0 };

/**
 * Registers error event listeners on the EventBus.
 * @param {import('../events/event_bus.js').EventBus} eventBus
 */
export function registerStoreErrorListeners(eventBus) {
    // OS DOIS EVENTOS DE ERRO RELATAM; O DE BLOQUEIO NÃO, e a assimetria é a linha entre defeito e
    // decisão. `STORE_PERSIST_ERROR` e `STORE_SYNC_ERROR` são coisas quebrando (IndexedDB recusando
    // escrita, fila de saída falhando em série), e são exatamente o tipo de falha que a pessoa vê
    // como um toast e ninguém mais fica sabendo. `STORE_OPERATION_BLOCKED` é o produto RECUSANDO de
    // propósito (mapa travado, papel insuficiente): relatá-lo encheria o teto de vinte envios com
    // o funcionamento normal do gate, e as recusas legítimas superam em muito as falhas reais.
    //
    // A `causa` É O NOME DO EVENTO, e não a frase do toast: a frase é escrita para gente, muda
    // quando alguém a melhora, e agrupar por ela faria uma revisão de texto virar um grupo novo.
    eventBus.on(StoreErrorEvents.STORE_PERSIST_ERROR, (payload) => {
        showInChannel(
            'store-persist-error',
            'Erro ao salvar dados. Verifique o armazenamento do navegador.',
            'error',
            { duration: 5000 }
        );
        console.error('[Store] Persistence error:', payload);
        relatarErro(payload?.error ?? payload, {
            origem: OrigemDeErro.STORE,
            contexto: { causa: 'STORE_PERSIST_ERROR' },
        });
    });

    eventBus.on(StoreErrorEvents.STORE_SYNC_ERROR, (payload) => {
        if (payload.consecutiveFailures >= 3) {
            showInChannel(
                'store-sync-error',
                'Erro na fila de sincronização. Algumas alterações podem não ser sincronizadas.',
                'warning',
                { duration: 4000 }
            );
        }
        // FORA DO `if`, de propósito: o limiar de três existe para não incomodar a pessoa com uma
        // falha passageira, e a primeira falha é justamente a que descreve a causa. O dedupe por
        // assinatura já garante que uma fila que falha em laço vire um relato só.
        relatarErro(payload?.error ?? payload, {
            origem: OrigemDeErro.STORE,
            contexto: { causa: 'STORE_SYNC_ERROR' },
        });
    });

    eventBus.on(StoreErrorEvents.STORE_OPERATION_BLOCKED, (payload) => {
        // Distinguish the two block kinds the store ops carry (previously both showed the lock
        // message): a locked map vs insufficient role on a remote atlas (a Visualizador) — the latter
        // must read as read-only access.
        // A block that ships its OWN message wins: the two canned texts below describe the
        // map-lock and the read-only role, and showing either of them for an unrelated
        // refusal (a local-atlas cap, say) would be actively misleading.
        const explicit = typeof payload?.message === 'string' && payload.message.length > 0;
        const isLock = LOCK_REASONS.has(payload?.reason);
        const kind = explicit ? 'explicit' : (isLock ? 'lock' : 'denied');

        // "AINDA NÃO SEI" NÃO SE ANUNCIA, e este é o único lugar que precisa saber disso.
        //
        // O DEFEITO, medido em 2026-08-25: o DONO de um atlas dava F5, ou entrava no atlas que
        // acabara de enviar, e lia "Seu nível neste atlas não permite editar". A cadeia era
        // toda legítima e mesmo assim mentia. A sessão hidrata com o papel POR ATLAS semeado em
        // Visualizador (D7, `sessionUserInfoFromMe`); o marcador de origem já diz REMOTO, porque
        // ele é durável e sobrevive ao recarregamento; e a primeira coisa que o boot faz é
        // escrever — `switchMap` → `switchLayer` → `setBaseLayer`
        // (`baselayers/base-layer.control.js`), que consulta o guarda e emite este evento com
        // `required: 'canEdit'`. O papel real chega um instante depois, no payload `connected`
        // do WebSocket, e conserta tudo menos a frase, que já foi dita.
        //
        // A PERGUNTA É FEITA À SESSÃO, e não ao payload, de propósito: são mais de vinte sítios
        // que emitem este evento, e uma operação nova que esquecesse de repassar o campo
        // devolveria o defeito calada. A sessão é a mesma que o guarda consultou, e `emit` é
        // síncrono, então é o mesmo instante.
        //
        // SÓ O RAMO `denied` CALA. O cadeado não depende de papel nenhum, e uma recusa com
        // mensagem própria fala de outra coisa: calar qualquer um dos dois trocaria este defeito
        // por outro. E calar não é conceder — a escrita continua recusada pelo guarda.
        //
        // A SESSÃO OFFLINE FICA DE FORA, e a exclusão é medida, não zelo. Offline o papel por
        // atlas nunca é resolvido (não há atlas), mas o guarda também nunca recusa por papel:
        // as recusas que sobram ali falam de outra coisa, e a única viva é a do comentário sem
        // autor (`comment.operations.js`, `reason: 'not-authenticated'`). Sem esta metade, o
        // anônimo que tentasse comentar não receberia aviso nenhum — o defeito trocado por
        // outro, no caminho vizinho.
        const janelaDeHidratacao = !sessionContext.isOffline() && !sessionContext.isAtlasRoleResolved();
        if (kind === 'denied' && janelaDeHidratacao) return;

        const now = Date.now();
        if (now - _lastBlockedToastAt[kind] < BLOCKED_DEBOUNCE_MS) return;
        _lastBlockedToastAt[kind] = now;

        // A ROLE REFUSAL NOW QUOTES THE CAPABILITY THE GATE CONSULTED. The single sentence that
        // stood here ("Acesso somente leitura, você não pode editar este projeto") was true for a
        // Visualizador and false for every level above them: an Editor refused `canDeleteMap` was
        // told they could not edit a project they had just been editing. `denialNotice` keys on
        // `payload.required`, the `PermissionAction` flag `checkPermission` actually refused on,
        // and falls back to a sentence that asserts no specific limitation.
        let text;
        if (explicit) {
            text = payload.message;
        } else if (isLock) {
            text = 'Mapa bloqueado. Desbloqueie para editar.';
        } else {
            text = denialNotice(payload?.required);
        }

        showInChannel('store-blocked', text, 'warning', { duration: 2500 });
    });

    // O ATROPELO: um colega escreveu depois desta pessoa, na entidade que ela acabou de editar.
    //
    // AQUI, E NÃO NO HANDLER DE OP REMOTA, porque resolver o nome (presença) e desenhar o toast
    // de lá arrastava o grafo do store para um módulo que várias suítes carregam com mock
    // estreito. `remote-operation-handler.js` decide QUANDO (ele é quem sabe da janela de edição
    // local); este ponto decide COMO SE DIZ.
    //
    // SEM NOME NÃO HÁ AVISO (`overwriteNotice` devolve null): a presença pode não conhecer o
    // autor (entrou e saiu, ou o roster ainda não chegou), e um "alguém alterou isto" gasta a
    // atenção da pessoa sem dar o que a faria agir, que é falar com o colega.
    //
    // Canal próprio: uma rajada de ops do mesmo colega vira um aviso, não uma pilha.
    eventBus.on(EventTypes.REMOTE_EDIT_OVERWRITTEN, (payload) => {
        const autor = presenceStore.getUsers()
            .find((u) => String(u?.userId) === String(payload?.authorUserId));
        const frase = overwriteNotice(autor?.userName ?? autor?.nome ?? null);
        if (frase) showInChannel('remote-overwrite', frase, 'info', { duration: 6000 });
    });
}
