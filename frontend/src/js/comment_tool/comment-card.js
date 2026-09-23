// Path: js/comment_tool/comment-card.js

/**
 * @fileoverview O CARTÃO DE COMENTÁRIO, e as regras dele, num lugar só.
 *
 * POR QUE ELE EXISTE. O comentário espacial nasceu no mapa 2D e o cartão morava dentro do overlay
 * do MapLibre (`comment-overlay.js`), misturado com o pino, o popup e a fonte de dados. O dono
 * pediu em 2026-09-17 o mesmo sistema no 360 e no 3D, "com as mesmas regras e funcionalidades" — e
 * "as mesmas" só é verificável se for O MESMO código: três cópias do cartão divergem no dia em que
 * uma delas mudar, que é o mecanismo que este repositório já pagou para aprender (o gesto de
 * copiar, hoje mesmo, e a soma de pendências em 2026-09-15).
 *
 * O QUE MORA AQUI: o desenho do cartão (thread e compose), a entrada de cada comentário/resposta, o
 * compositor, o tempo relativo, a assinatura de autoria e OS DOIS GATES (quem pode comentar, quem
 * pode modificar ESTE comentário). As escritas são chamadas daqui mesmo, e não devolvidas em
 * callback, porque a regra de quem resolve, reabre, responde e exclui é a mesma nas três
 * superfícies: devolvê-las ao chamador seria devolver a regra junto.
 *
 * O QUE NÃO MORA AQUI: o PINO e o posicionamento. O mapa 2D ancora por coordenada num popup do
 * MapLibre, o 360 desenha no canvas do panorama e o 3D numa entidade do Cesium — três mecanismos
 * sem nada em comum. Cada superfície monta o cartão e decide onde ele aparece.
 *
 * A SUPERFÍCIE É UM CAMPO DO COMENTÁRIO, e não uma coleção nova: `surface` mais a âncora que aquela
 * superfície usa (a foto e a direção no 360; o modelo e o ponto no 3D). Assim o painel de
 * comentários, o sync, o guarda de permissão e o documento lateral continuam sendo um só. O
 * precedente é o cursor de presença, que ganhou `surface` em 2026-09-16 pela mesma razão.
 *
 * RESOLVING CLOSES THE CARD, and only the person's OWN gesture does (owner's request, 2026-09-22:
 * "ao resolver comentário fechar a tela do comentário"). The rule lives here, in the one Resolver
 * button the four surfaces share, and it has three edges:
 *  - the card closes only AFTER the store accepted the write (`fechaAoResolver`): a refusal by role
 *    or by the logout barrier keeps the card open, and the refusal reaches the person through the
 *    store-error listener exactly as before;
 *  - "Reabrir" never closes: reopening is how the reply box comes back, so closing would take away
 *    the very thing the person asked for;
 *  - a PEER's resolution never closes it. The surfaces redraw the open card in the resolved,
 *    read-only state instead (title, note, and "Reabrir" for whoever may modify), because a card
 *    that vanishes under the reader's eyes explains nothing. Each surface also keeps
 *    the card untouched while it holds unsent text (`escrevendoNoCartao`), and if that text is
 *    sent to a thread resolved in the meantime, the refused reply keeps the draft and says why.
 *
 * `aoFechar` IS THEREFORE CALLED LATE, after an await, and each surface scopes it to the thread
 * the card was built for: by then the person may have opened another thread, and closing that one
 * would be exactly the surprise the rule avoids.
 */

import { addReply, resolveComment, removeComment, updateComment } from '@store';
import { isRemoteStoreSync } from '@store/store-origin.js';
import { sessionContext } from '@store/sync/session-context.js';
import { checkPermission, GuardAction } from '@store/sync/permission-guard.js';
import { getInitials, getPresenceColor } from '@js/presence/presence-colors.js';
import { showError, showWarning } from '@utils/toast_service.js';

/** Shown when a reply was refused because its thread was resolved or deleted meanwhile. */
export const AVISO_RESPOSTA_RECUSADA =
    'Não foi possível responder: este comentário foi resolvido ou excluído. Seu texto foi mantido.';

/**
 * As três superfícies onde um comentário pode nascer.
 *
 * `'2d'` é o padrão de LEITURA para todo comentário criado antes deste campo existir: eles são do
 * mapa e não têm o campo, então quem filtra por superfície precisa tratar a ausência como 2D, e não
 * descartá-la. `superficieDe` abaixo é o único lugar que faz essa conta.
 */
export const SUPERFICIE = Object.freeze({
    MAPA: '2d',
    FOTO_360: '360',
    MODELO_3D: '3d',
    PRIMEIRA_PESSOA: 'fp',
});

/**
 * A superfície de um comentário, com o passado incluído.
 * @param {Object} comentario
 * @returns {string} Uma das `SUPERFICIE`.
 */
export function superficieDe(comentario) {
    return comentario?.surface ?? SUPERFICIE.MAPA;
}

/**
 * Se o comentário pertence à superfície e ao escopo pedidos.
 *
 * O ESCOPO É O QUE SEPARA DUAS FOTOS, e sem ele o 360 desenharia na foto A o comentário feito na
 * foto B: `surface` sozinho diz o TIPO de superfície, nunca QUAL. No 2D não há escopo (o mapa já é
 * o documento), e é por isso que ele é opcional.
 *
 * @param {Object} comentario
 * @param {string} surface - Uma das `SUPERFICIE`.
 * @param {string|null} [escopo] - `photoName` no 360, `tilesetId` no 3D.
 * @returns {boolean}
 */
export function ehDaSuperficie(comentario, surface, escopo = null) {
    if (superficieDe(comentario) !== surface) return false;
    if (escopo === null) return true;
    if (surface === SUPERFICIE.FOTO_360) return comentario?.photoName === escopo;
    if (surface === SUPERFICIE.MODELO_3D || surface === SUPERFICIE.PRIMEIRA_PESSOA) return comentario?.tilesetId === escopo;
    return true;
}

/** Rótulo de tempo relativo em pt-BR (compacto). */
export function tempoRelativo(ts) {
    if (!ts) return '';
    const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
    if (s < 60) return 'agora';
    const m = Math.floor(s / 60);
    if (m < 60) return `há ${m} min`;
    const h = Math.floor(m / 60);
    if (h < 24) return `há ${h} h`;
    const d = Math.floor(h / 24);
    return `há ${d} d`;
}

/** A assinatura de autoria da sessão atual, para um comentário ou resposta novos. */
export function autoriaAtual() {
    const name = sessionContext.username || '';
    const id = sessionContext.userId || '';
    return {
        authorId: id || null,
        authorInitials: getInitials(name),
        authorColor: getPresenceColor(String(id || name)),
    };
}

/**
 * Se a sessão pode criar comentário agora.
 *
 * As três condições são as do 2D, sem desconto: comentar exige um atlas de SERVIDOR (o comentário
 * precisa de destinatário), uma sessão (precisa de AUTOR) e a capacidade no atlas. O Comentarista
 * passa aqui, que é a única coisa que ele sabe fazer, e é por isso que esta função nunca pode
 * passar a consultar o gate de EDIÇÃO.
 * @returns {boolean}
 */
export function podeComentar() {
    return isRemoteStoreSync()
        && sessionContext.isAuthenticated()
        && checkPermission(GuardAction.CREATE_COMMENT).allowed;
}

/**
 * Se a sessão pode resolver, reabrir ou excluir ESTE comentário: o Editor age sobre qualquer um, o
 * Comentarista só sobre os próprios. É o mesmo portão que o servidor aplica pela coluna `author_id`.
 * @param {Object} comentario
 * @returns {boolean}
 */
export function podeModificar(comentario) {
    if (!podeComentar()) return false;
    if (sessionContext.canPerformAction('canEdit')) return true;
    return !!comentario?.authorId && comentario.authorId === sessionContext.userId;
}

/** Editing text is reserved to its author, independently of atlas administration. */
export function podeEditar(comentario) {
    return podeComentar() && !!comentario?.authorId && comentario.authorId === sessionContext.userId;
}

/**
 * Whether a click on the resolution toggle closes the card.
 *
 * Only a RESOLUTION that the store ACCEPTED closes it. `aceito` must be exactly `true`, which is
 * what `resolveComment` returns once the write is persisted: `false` is a refusal (role, author
 * check) and `undefined` a thread that no longer exists, and neither may make the card vanish.
 * Reopening never closes, accepted or not.
 *
 * @param {{resolvendo:boolean, aceito:*}} desfecho - `resolvendo` is true for "Resolver", false
 *   for "Reabrir"; `aceito` is what the store returned.
 * @returns {boolean}
 */
export function fechaAoResolver({ resolvendo, aceito } = {}) {
    return resolvendo === true && aceito === true;
}

/**
 * Whether the person has unsent text inside this card (a reply draft or an in-place edit).
 *
 * The test is the TEXT, not the focus. The first-person surface focuses the reply box every time
 * it draws a thread, so "focus is inside the card" was true while nobody was writing; and it was
 * also true right after a click on Resolver or Reabrir, because the button keeps the focus, which
 * froze the card in the state from before the click.
 *
 * @param {HTMLElement|null|undefined} cartao
 * @returns {boolean}
 */
export function escrevendoNoCartao(cartao) {
    const caixas = cartao?.querySelectorAll?.('textarea') ?? [];
    return Array.from(caixas).some((caixa) => typeof caixa?.value === 'string' && caixa.value.trim().length > 0);
}

/**
 * O compositor: uma caixa de texto com enviar e (opcionalmente) cancelar.
 *
 * Seguro por construção: o texto entra por `value` de `textarea` e sai por `textContent`, nunca por
 * `innerHTML`.
 *
 * @param {{placeholder:string, submitLabel:string, testid:string, compact?:boolean,
 *   onSubmit:(texto:string)=>any, onCancel?:()=>void}} opcoes
 * @returns {HTMLElement}
 */
export function montarCompositor(opcoes) {
    const wrap = document.createElement('div');
    wrap.className = opcoes.compact ? 'comment-composer comment-composer--compact' : 'comment-composer';

    const textarea = document.createElement('textarea');
    textarea.className = 'comment-composer__input';
    textarea.placeholder = opcoes.placeholder;
    textarea.rows = opcoes.compact ? 1 : 2;
    textarea.dataset.testid = `${opcoes.testid}-input`;
    wrap.appendChild(textarea);

    const actions = document.createElement('div');
    actions.className = 'comment-composer__actions';

    if (opcoes.onCancel) {
        const cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.className = 'comment-composer__btn comment-composer__btn--ghost';
        cancel.textContent = 'Cancelar';
        cancel.addEventListener('click', () => opcoes.onCancel());
        actions.appendChild(cancel);
    }

    const submit = document.createElement('button');
    submit.type = 'button';
    submit.className = 'comment-composer__btn comment-composer__btn--primary';
    submit.dataset.testid = `${opcoes.testid}-submit`;
    submit.textContent = opcoes.submitLabel;
    submit.disabled = true;
    let sending = false;
    textarea.addEventListener('input', () => { submit.disabled = sending || textarea.value.trim().length === 0; });
    submit.addEventListener('click', async () => {
        const texto = textarea.value.trim();
        if (!texto || sending) return;
        sending = true;
        textarea.readOnly = true;
        submit.disabled = true;
        try {
            const result = await opcoes.onSubmit(texto);
            if (result !== false) {
                textarea.value = '';
                try {
                    await opcoes.onSaved?.();
                } catch (error) {
                    console.error('Could not refresh the saved comment:', error);
                    showWarning('Comentário salvo. Feche e abra a conversa para atualizar a visualização.');
                }
            }
        } catch (error) {
            console.error('Could not save comment:', error);
            showError('Não foi possível salvar o comentário. Seu texto foi mantido; tente novamente.');
        } finally {
            sending = false;
            textarea.readOnly = false;
            submit.disabled = !textarea.value.trim();
        }
    });
    actions.appendChild(submit);

    wrap.appendChild(actions);
    return wrap;
}

/**
 * Troca o texto da entrada por um editor, e devolve ao normal quando termina.
 *
 * O EDITOR NASCE COM O TEXTO ATUAL e devolve o foco a ele, porque editar e' quase sempre
 * corrigir: quem clica em "Editar" quer o que escreveu na tela, nao uma caixa vazia.
 * @private
 */
function editarNoLugar(corpo, paragrafo, entrada, aoAtualizar) {
    const editor = montarCompositor({
        placeholder: 'Edite o comentário…',
        submitLabel: 'Salvar',
        testid: 'comment-edit',
        compact: true,
        onSaved: aoAtualizar,
        onCancel: () => { editor.replaceWith(paragrafo); },
        onSubmit: async (texto) => {
            if (!podeEditar(entrada)) return false;
            const saved = await updateComment({ id: entrada.id, text: texto });
            if (!saved) return false;
            paragrafo.textContent = texto;
            editor.replaceWith(paragrafo);
            return true;
        },
    });
    const caixa = editor.querySelector('.comment-composer__input');
    if (caixa) caixa.value = entrada.text || '';
    // O botão de salvar nasce desabilitado (o compositor só o libera ao digitar), e aqui já há
    // texto: sem isto, salvar uma edição exigiria mexer no texto antes.
    const salvar = editor.querySelector('.comment-composer__btn--primary');
    if (salvar) salvar.disabled = !(entrada.text || '').trim();

    paragrafo.replaceWith(editor);
    caixa?.focus();
    return editor;
}

/** Uma linha de comentário ou resposta: avatar, tempo e texto. */
export function montarEntrada(entrada, ehRaiz, aoAtualizar) {
    const row = document.createElement('div');
    row.className = ehRaiz ? 'comment-entry comment-entry--root' : 'comment-entry';

    const avatar = document.createElement('span');
    avatar.className = 'comment-entry__avatar';
    avatar.textContent = entrada.authorInitials || '?';
    avatar.style.backgroundColor = entrada.authorColor || getPresenceColor(String(entrada.authorId || ''));
    row.appendChild(avatar);

    const body = document.createElement('div');
    body.className = 'comment-entry__body';

    const meta = document.createElement('div');
    meta.className = 'comment-entry__meta';
    const time = document.createElement('span');
    time.className = 'comment-entry__time';
    time.textContent = tempoRelativo(entrada.createdAt);
    meta.appendChild(time);
    body.appendChild(meta);

    const text = document.createElement('p');
    text.className = 'comment-entry__text';
    text.textContent = entrada.text || '';
    body.appendChild(text);

    // Roots and replies have independent authors; moderation never grants text editing.
    if (podeEditar(entrada)) {
        const editar = document.createElement('button');
        editar.type = 'button';
        editar.className = 'comment-entry__edit';
        editar.dataset.testid = 'comment-edit-open';
        editar.textContent = 'Editar';
        editar.addEventListener('click', () => editarNoLugar(body, text, entrada, aoAtualizar));
        meta.appendChild(editar);
    }

    row.appendChild(body);
    return row;
}

/** @private O cabeçalho da thread: título e as ações de quem pode modificar. */
function montarCabecalho(raiz, aoFechar) {
    const header = document.createElement('div');
    header.className = 'comment-card__header';

    const title = document.createElement('span');
    title.className = 'comment-card__title';
    title.textContent = raiz.status === 'resolved' ? 'Comentário resolvido' : 'Comentário';
    header.appendChild(title);

    const actions = document.createElement('div');
    actions.className = 'comment-card__actions';

    if (podeModificar(raiz)) {
        const resolvendo = raiz.status !== 'resolved';
        const resolveBtn = document.createElement('button');
        resolveBtn.type = 'button';
        resolveBtn.className = 'comment-card__action';
        resolveBtn.dataset.testid = 'comment-resolve';
        resolveBtn.textContent = resolvendo ? 'Resolver' : 'Reabrir';
        // A second click while the first write is in flight would log a second, identical op.
        let emVoo = false;
        resolveBtn.addEventListener('click', async () => {
            if (emVoo) return;
            emVoo = true;
            let aceito;
            try {
                aceito = await resolveComment(raiz.id, resolvendo);
            } catch (error) {
                // The transaction already announced it (STORE_OPERATION_BLOCKED for the logout
                // barrier, STORE_PERSIST_ERROR for IndexedDB) and the store-error listener showed
                // the toast; a second one here would say the same thing twice. The card stays.
                console.error('Could not change the comment resolution:', error);
            } finally {
                emVoo = false;
            }
            if (fechaAoResolver({ resolvendo, aceito })) aoFechar?.();
        });
        actions.appendChild(resolveBtn);

        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'comment-card__action comment-card__action--danger';
        delBtn.dataset.testid = 'comment-delete';
        delBtn.textContent = 'Excluir';
        delBtn.addEventListener('click', async () => { aoFechar?.(); await removeComment(raiz.id); });
        actions.appendChild(delBtn);
    }

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'comment-card__close';
    closeBtn.setAttribute('aria-label', 'Fechar');
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', () => aoFechar?.());
    actions.appendChild(closeBtn);

    header.appendChild(actions);
    return header;
}

/**
 * O cartão de uma conversa: raiz, respostas e (se couber) a caixa de responder.
 *
 * O COMENTÁRIO RESOLVIDO É SÓ LEITURA, nas três superfícies: ele sai do desenho e só é alcançável
 * pelo painel, e reabrir é o que devolve a caixa de resposta. Sem essa regra aqui, cada superfície
 * decidiria sozinha o que "resolvido" significa.
 *
 * `aoFechar` runs for the close button, before a delete, and after the person's own resolution was
 * accepted. The last one comes after an await, so the surface must scope it to THIS thread (see the
 * file overview).
 *
 * @param {{raiz:Object, respostas:Object[], aoFechar:()=>void}} opcoes
 * @returns {HTMLElement}
 */
export function montarCartaoDeThread({ raiz, respostas = [], aoFechar, aoAtualizar }) {
    const card = document.createElement('div');
    card.className = 'comment-card comment-card--thread';
    card.dataset.testid = 'comment-thread';
    card.dataset.resolved = raiz.status === 'resolved' ? 'true' : 'false';

    card.appendChild(montarCabecalho(raiz, aoFechar));
    card.appendChild(montarEntrada(raiz, true, aoAtualizar));

    if (respostas.length) {
        const list = document.createElement('div');
        list.className = 'comment-card__replies';
        for (const r of respostas) list.appendChild(montarEntrada(r, false, aoAtualizar));
        card.appendChild(list);
    }

    if (raiz.status === 'resolved') {
        const note = document.createElement('p');
        note.className = 'comment-card__note';
        note.dataset.testid = 'comment-resolved-note';
        note.textContent = podeModificar(raiz)
            ? 'Comentário resolvido. Reabra para responder.'
            : 'Comentário resolvido.';
        card.appendChild(note);
    } else if (podeComentar()) {
        card.appendChild(montarCompositor({
            placeholder: 'Responder…',
            submitLabel: 'Responder',
            testid: 'comment-reply',
            onSaved: aoAtualizar,
            compact: true,
            onSubmit: async (texto) => {
                const resposta = await addReply(raiz.id, { text: texto, ...autoriaAtual() });
                if (resposta) return true;
                // `addReply` refuses in two ways and returns nothing in both. The permission guard
                // speaks for itself (the store-error listener shows it); the parent check does not:
                // a thread a peer resolved or deleted while the person was typing came back empty,
                // and the composer cleared the text as if it had been sent. Keep it, and say why.
                if (podeComentar()) showWarning(AVISO_RESPOSTA_RECUSADA);
                return false;
            },
        }));
    }

    return card;
}

/**
 * O cartão de escrever um comentário novo.
 *
 * Quem grava é o CHAMADOR, e esta é a única regra que não mora aqui: a âncora é o que distingue as
 * três superfícies (coordenada no 2D, foto e direção no 360, ponto do modelo no 3D), e ela é
 * montada por quem sabe onde o gesto aconteceu. A autoria vai junto, pronta.
 *
 * @param {{aoCancelar:()=>void, aoEnviar:(texto:string)=>any}} opcoes
 * @returns {HTMLElement}
 */
export function montarCartaoDeCompose({ aoCancelar, aoEnviar }) {
    const card = document.createElement('div');
    card.className = 'comment-card comment-card--compose';
    card.dataset.testid = 'comment-compose';

    card.appendChild(montarCompositor({
        placeholder: 'Escreva um comentário…',
        submitLabel: 'Comentar',
        testid: 'comment-compose',
        onCancel: aoCancelar,
        onSubmit: aoEnviar,
    }));

    return card;
}

/**
 * As respostas de uma raiz, em ordem de criação.
 * @param {Object<string,Object>} colecao - O mapa id -> comentário.
 * @param {string} raizId
 * @returns {Object[]}
 */
export function respostasDe(colecao, raizId) {
    return Object.values(colecao || {})
        .filter((c) => c && c.parentId === raizId)
        .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
}
