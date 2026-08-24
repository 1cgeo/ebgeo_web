// Path: js/admin/grants-tab.js

/**
 * @fileoverview Aba "Concessões" — as concessões de recurso privado do acervo vistas dos DOIS
 * lados: o que esta pessoa concedeu e o que concederam a ela.
 *
 * A TELA DO MEIO QUE FALTAVA. Até 2026-08-24 a única superfície de concessão era o modal de UM
 * recurso (`catalog/resource-share.modal.js`), alcançável a partir do cartão daquele recurso no
 * catálogo. Para revogar alguma coisa era preciso LEMBRAR qual recurso havia sido concedido,
 * achá-lo, abrir o modal e procurar a linha. Sem inventário, some a revisão periódica (a higiene
 * natural de quem distribui acesso com prazo) e some a resposta a "por que Fulano vê isto?" pelo
 * lado de quem concedeu. O credenciado, cujo papel é DEFINIDO por conceder, não tem trilha de
 * auditoria (decisão registrada), então esta aba é o único inventário que ele tem.
 *
 * OS DOIS LADOS EM UMA ABA SÓ, e o lado RECEBIDO é a novidade do produto: nenhuma tela falava com
 * quem recebeu. Quem recebeu com nível `view` nunca viu o chip de prazo, porque ele mora atrás de
 * um botão que só quem CONCEDE alcança, e o prazo é justamente o fato que ninguém adivinha: a
 * morte da concessão mora no predicado do servidor, e no dia seguinte o recurso some do catálogo
 * sem evento e sem aviso. As frases estão em `grant-phrases.js`, folha e testável em node.
 *
 * REVOGAR SÓ SAI DO LADO ESQUERDO, e isso é propriedade da consulta, não um gate desenhado aqui: o
 * servidor aceita revogação de quem concedeu (mais o administrador global), e a lista de
 * `listIssuedGrants` é, por construção, a das linhas que esta pessoa concedeu. É a mesma
 * propriedade que `revokeAvailability` (`catalog/grant-tree.js`) precisa simular linha a linha
 * dentro do modal, onde a lista é do RECURSO e mistura concedentes.
 *
 * A PROPRIEDADE VALE NUMA DIREÇÃO SÓ PARA O ADMINISTRADOR, e a aba passou a ser dele em
 * 2026-08-24. `grants/issued` filtra por `granted_by`, sem ramo de papel: toda linha que ele vê é
 * dele e o botão continua honesto, mas o alcance DELE é maior que a lista, porque o ramo largo de
 * `requireGrantRevoker` é administração do sistema. Subdeclarar autoridade também engana, então a
 * assimetria é dita na tela por `issuedReachNotice`, que é a única coisa aqui a variar por papel
 * global. O perfil chega por PARÂMETRO, de `mountAdminPage`: esta aba não lê `sessionContext`, e
 * é o que a mantém montável num teste sem sessão.
 *
 * `viaGroup` É VISÍVEL DE PROPÓSITO. É a única transferência de autoridade do sistema que não gera
 * linha própria em `resource_grants`: o acesso vem da membresia, e sai junto com ela. Sem o rótulo,
 * a pessoa procuraria uma concessão que não existe para entender por que perdeu o recurso.
 *
 * Todo texto dinâmico entra por `textContent`: nome de recurso, de pessoa e de grupo são texto
 * livre escrito por outra pessoa.
 */

import { apiClient } from '@store/sync/api-client.js';
import { showConfirm } from '@modals/confirm.modal.js';
import { showSuccess, showError } from '@utils/toast_service.js';
// Do ARQUIVO, nunca dos barrels `@utils` / `@modals`: esta página não carrega a store, e os
// barrels a alcançam transitivamente.
import {
    setupCleanup,
    addScopedDomListener,
    clearScopedListeners,
    cleanup,
} from '@utils/event-cleanup.js';
import { sectionHeader, card, emptyState, failureState, ICON_GRANTS } from './admin-dom.js';
// A ESCADA DE PRAZO E A ARITMÉTICA DA EXTENSÃO SÃO COMPARTILHADAS com o modal de recurso, que é a
// outra tela que estende concessão. `grant-tree.js` tem ZERO imports por contrato, então trazê-lo
// para cá não arrasta a store para `admin.html`, que boota sem ela.
import {
    extensionDeadline,
    extensionOutcome,
    extensionSummary,
    GRANT_TERM_DEFAULT_DAYS,
    GRANT_TERMS,
} from '@js/catalog/grant-tree.js';
import {
    expiryChip,
    grantLevelLabel,
    grantLevelDescription,
    granteeGroupNotice,
    granteeLabel,
    grantorLabel,
    grantsScopeNotice,
    isGroupGrant,
    issuedEmptyHint,
    issuedEmptyNotice,
    issuedExtensionHint,
    issuedExtensionTermLabel,
    issuedFailureNotice,
    issuedReachNotice,
    issuedRevocationSummary,
    issuedRevocationWarning,
    receivedEmptyHint,
    receivedEmptyNotice,
    receivedExpiryNotice,
    receivedFailureNotice,
    receivedNotRevocableNotice,
    resourceDisplayName,
    resourceIdentityTitle,
    resourceTypeLabel,
    shortDate,
    viaGroupLabel,
    viaGroupNotice,
} from './grant-phrases.js';

/**
 * Builds the "Concessões" tab definition for the admin panel.
 * @param {{isAdmin?: boolean}} [principal] - O papel GLOBAL de quem abriu o painel, já lido por
 *   `mountAdminPage`. Só o administrador do sistema muda alguma coisa aqui, e o que ele muda é
 *   UMA frase (ver `issuedReachNotice`); nada de gate, que é do servidor.
 * @returns {import('./admin-panel.js').AdminTab}
 */
export function createGrantsTab({ isAdmin = false } = {}) {
    const tab = new GrantsTab({ isAdmin });
    return {
        id: 'grants',
        label: 'Concessões',
        testid: 'admin-tab-grants',
        icon: ICON_GRANTS,
        mount: (container) => tab.mount(container),
    };
}

class GrantsTab {
    /**
     * @param {{isAdmin?: boolean}} [principal]
     */
    constructor({ isAdmin = false } = {}) {
        this._isAdmin = isAdmin === true;
    }

    /**
     * @param {HTMLElement} container
     * @returns {Function} cleanup
     */
    mount(container) {
        this._container = container;
        this._alive = true;
        // O PRAZO ESCOLHIDO SOBREVIVE ao re-render da seção (cada ato relê as duas listas), e é
        // por isso que ele mora aqui e não no seletor: quem renova cinco linhas por 30 dias
        // escolheria 30 cinco vezes se o estado voltasse ao padrão a cada clique.
        this._dias = GRANT_TERM_DEFAULT_DAYS;
        this._busy = false;
        setupCleanup(this);
        this._render();
        return () => {
            this._alive = false;
            cleanup(this);
        };
    }

    /**
     * @private A aba inteira. As DUAS chamadas vão juntas e cada uma falha por conta própria: são
     * duas rotas, e uma rede ruim que derrube a segunda não pode esconder a primeira.
     */
    async _render() {
        clearScopedListeners(this, 'view');
        const c = this._container;
        c.replaceChildren();

        c.appendChild(sectionHeader('Concessões', {
            subtitle: 'Os acessos a recursos privados do acervo que você concedeu e que concederam '
                + 'a você',
        }));

        const escopo = document.createElement('p');
        escopo.className = 'admin-grants__scope';
        escopo.dataset.testid = 'admin-grants-scope';
        escopo.textContent = grantsScopeNotice();
        c.appendChild(escopo);

        // ACIMA DAS DUAS SEÇÕES, e não dentro de "Concedidos por mim": a assimetria que ela
        // descreve vale para os dois lados (o administrador também revoga o que aparece em
        // "Recebidos por mim", pelo cartão do recurso). String vazia para todo mundo que não
        // administra o sistema, e aí não nasce parágrafo nenhum.
        const alcance = issuedReachNotice({ isAdmin: this._isAdmin });
        if (alcance) {
            const p = document.createElement('p');
            p.className = 'admin-grants__reach';
            p.dataset.testid = 'admin-grants-reach';
            p.textContent = alcance;
            c.appendChild(p);
        }

        const concedidos = document.createElement('section');
        concedidos.className = 'admin-grants__section';
        concedidos.dataset.testid = 'admin-grants-issued';
        c.appendChild(concedidos);

        const recebidos = document.createElement('section');
        recebidos.className = 'admin-grants__section';
        recebidos.dataset.testid = 'admin-grants-received';
        c.appendChild(recebidos);

        this._renderLoading(concedidos, 'Concedidos por mim', 'Carregando as concessões que você fez…');
        this._renderLoading(recebidos, 'Recebidos por mim', 'Carregando os acessos concedidos a você…');

        // AS DUAS CHAMADAS PASSAM POR `settle`, e não vão cruas para o `allSettled`. O motivo é
        // estreito e vale um comentário: `Promise.allSettled` só protege de promessa REJEITADA, e o
        // array de argumentos é avaliado antes dele. Um erro SÍNCRONO ali (o caso concreto é o
        // método não existir no cliente HTTP, numa implantação em que a rota ainda não chegou)
        // escapa por cima do `allSettled`, sai de `_render` como rejeição não tratada, e a aba fica
        // no "Carregando…" para sempre. Com o embrulho, esse caso cai na tela de FALHA, que tem
        // botão de tentar de novo.
        const [emitidas, recebidas] = await Promise.allSettled([
            settle(() => apiClient.listIssuedGrants()),
            settle(() => apiClient.listReceivedGrants()),
        ]);
        if (!this._alive) return;

        this._renderIssued(concedidos, emitidas);
        this._renderReceived(recebidos, recebidas);
    }

    /**
     * @private O terceiro estado de tela, distinto do vazio e da falha.
     * @param {HTMLElement} host @param {string} titulo @param {string} texto
     */
    _renderLoading(host, titulo, texto) {
        host.replaceChildren();
        host.appendChild(sectionHeader(titulo));
        const wrap = card({ padded: false });
        const p = document.createElement('p');
        p.className = 'admin-users__status';
        p.textContent = texto;
        wrap.appendChild(p);
        host.appendChild(wrap);
    }

    /**
     * @private As linhas de um payload `{ grants: [...] }`.
     *
     * Aceita também o array nu: o contrato acordado é o envelope, e um servidor que devolva a lista
     * crua não pode virar "nenhuma concessão", que é a leitura errada mais cara desta tela.
     * @param {*} payload
     * @returns {Array<Object>}
     */
    static _rows(payload) {
        if (Array.isArray(payload)) return payload;
        return Array.isArray(payload?.grants) ? payload.grants : [];
    }

    /**
     * @private O que EU concedi, com o botão de revogar.
     * @param {HTMLElement} host @param {PromiseSettledResult<*>} resultado
     */
    _renderIssued(host, resultado) {
        host.replaceChildren();
        host.appendChild(sectionHeader('Concedidos por mim', {
            subtitle: 'O que você entregou, a quem, com que prazo. Revogar sai daqui.',
        }));

        const wrap = card({ testid: 'admin-grants-issued-table', padded: false });
        host.appendChild(wrap);

        if (resultado.status === 'rejected') {
            wrap.appendChild(failureState(issuedFailureNotice(), {
                onRetry: () => { if (this._alive) this._render(); },
            }));
            return;
        }

        const linhas = GrantsTab._rows(resultado.value);
        if (linhas.length === 0) {
            wrap.appendChild(emptyState(issuedEmptyNotice(), { hint: issuedEmptyHint() }));
            return;
        }

        // O SELETOR DE PRAZO VEM ANTES DA TABELA e é UM para a seção, como no modal de recurso:
        // renovar linha a linha com um seletor por linha encheria a coluna de ações de controle e
        // faria a revisão periódica (que é o ponto desta aba) custar um clique a mais por linha. E
        // ele só existe quando há linha, porque um seletor acima de uma tabela vazia não comanda
        // nada.
        host.insertBefore(this._termPicker(), wrap);

        const { table, tbody } = buildTable(
            ['Recurso', 'Para quem', 'Nível', 'Concedido em', 'Vencimento', ''],
        );
        for (const grant of linhas) {
            const tr = document.createElement('tr');
            tr.dataset.testid = 'admin-grants-issued-row';
            tr.dataset.grantId = String(grant?.id ?? '');

            tr.appendChild(this._resourceCell(grant));
            tr.appendChild(this._granteeCell(grant));
            tr.appendChild(levelCell(grant?.level));
            tr.appendChild(cell(shortDate(grant?.createdAt) || '—'));
            tr.appendChild(expiryCell(grant?.expiresAt, 'issued'));

            const acoes = document.createElement('td');
            acoes.className = 'admin-users__actions';
            // RENOVAR ANTES DE REVOGAR, e a ordem não é estética: o ato aditivo não pode ficar
            // depois do destrutivo na varredura do olho, senão a linha inteira se lê como uma
            // linha de risco. Mesma razão pela qual `.resource-share__extend` é neutro e discreto
            // no modal, ao lado do botão que não se desfaz.
            const renovar = this._button('Renovar', 'admin-btn admin-btn--sm',
                'admin-grant-extend', () => this._extend(grant));
            renovar.title = issuedExtensionHint();
            acoes.appendChild(renovar);
            acoes.appendChild(this._button('Revogar', 'admin-btn admin-btn--danger admin-btn--sm',
                'admin-grant-revoke', () => this._revoke(grant)));
            tr.appendChild(acoes);

            tbody.appendChild(tr);
        }
        wrap.appendChild(table);
    }

    /**
     * @private O que concederam a MIM. O prazo é o ponto deste lado (ver `receivedExpiryNotice`).
     * @param {HTMLElement} host @param {PromiseSettledResult<*>} resultado
     */
    _renderReceived(host, resultado) {
        host.replaceChildren();
        host.appendChild(sectionHeader('Recebidos por mim', {
            subtitle: 'O que outras pessoas abriram para você, e até quando',
        }));

        const wrap = card({ testid: 'admin-grants-received-table', padded: false });

        if (resultado.status === 'rejected') {
            host.appendChild(wrap);
            wrap.appendChild(failureState(receivedFailureNotice(), {
                onRetry: () => { if (this._alive) this._render(); },
            }));
            return;
        }

        const linhas = GrantsTab._rows(resultado.value);
        if (linhas.length === 0) {
            host.appendChild(wrap);
            wrap.appendChild(emptyState(receivedEmptyNotice(), { hint: receivedEmptyHint() }));
            return;
        }

        // A nota do prazo entra ANTES do cartão e só quando há linha para ela explicar: numa seção
        // vazia ela descreveria uma coluna que não existe na tela. Mesma regra da ressalva de
        // escopo em "Grupos de que participo".
        const nota = document.createElement('p');
        nota.className = 'admin-grants__expiry-notice';
        nota.dataset.testid = 'admin-grants-expiry-notice';
        nota.textContent = receivedExpiryNotice();
        host.appendChild(nota);
        host.appendChild(wrap);

        const { table, tbody } = buildTable(
            ['Recurso', 'De quem', 'Nível', 'Desde', 'Vencimento', ''],
        );
        for (const grant of linhas) {
            const tr = document.createElement('tr');
            tr.dataset.testid = 'admin-grants-received-row';
            tr.dataset.grantId = String(grant?.id ?? '');
            tr.dataset.viaGroup = grant?.viaGroup ? 'true' : 'false';

            tr.appendChild(this._resourceCell(grant));
            tr.appendChild(grantorCell(grant));
            tr.appendChild(levelCell(grant?.level));
            tr.appendChild(cell(shortDate(grant?.createdAt) || '—'));
            tr.appendChild(expiryCell(grant?.expiresAt, 'received'));

            // O lugar do botão que não existe deste lado. Espaço vazio se lê como tela quebrada, e
            // a pergunta de quem olha esta lista é justamente "posso me livrar disto?".
            const acoes = document.createElement('td');
            acoes.className = 'admin-users__actions';
            const recusa = document.createElement('span');
            recusa.className = 'admin-grants__not-revocable';
            recusa.dataset.testid = 'admin-grant-not-revocable';
            recusa.textContent = 'Só quem concedeu remove';
            recusa.title = receivedNotRevocableNotice();
            acoes.appendChild(recusa);
            tr.appendChild(acoes);

            tbody.appendChild(tr);
        }
        wrap.appendChild(table);
    }

    /**
     * @private A célula do recurso: nome, tipo, e o id no `title` (dois recursos podem ter o mesmo
     * nome de exibição, e só o id os separa).
     * @param {Object} grant
     * @returns {HTMLTableCellElement}
     */
    _resourceCell(grant) {
        const td = document.createElement('td');
        const box = document.createElement('div');
        box.className = 'admin-users__identity-text';
        const nome = document.createElement('span');
        nome.className = 'admin-users__name';
        nome.textContent = resourceDisplayName(grant);
        nome.title = resourceIdentityTitle(grant);
        const tipo = document.createElement('span');
        tipo.className = 'admin-users__handle';
        tipo.textContent = resourceTypeLabel(grant?.resourceType);
        box.append(nome, tipo);
        td.appendChild(box);
        return td;
    }

    /**
     * @private A célula do beneficiário. O COLETIVO ganha rótulo e o individual não, e é o
     * contraste que faz o rótulo informar.
     * @param {Object} grant
     * @returns {HTMLTableCellElement}
     */
    _granteeCell(grant) {
        const td = document.createElement('td');
        const box = document.createElement('div');
        box.className = 'admin-users__identity-text';
        const nome = document.createElement('span');
        nome.className = 'admin-users__name';
        nome.textContent = granteeLabel(grant);
        box.appendChild(nome);
        if (isGroupGrant(grant)) {
            const selo = document.createElement('span');
            selo.className = 'admin-chip admin-chip--group admin-grants__kind';
            selo.dataset.testid = 'admin-grant-grantee-group';
            selo.textContent = 'Grupo';
            selo.title = granteeGroupNotice(grant);
            box.appendChild(selo);
        }
        td.appendChild(box);
        return td;
    }

    /**
     * @private A button whose click listener belongs to the current view's scope.
     * @param {string} label @param {string} className @param {string} testid @param {Function} onClick
     * @returns {HTMLButtonElement}
     */
    _button(label, className, testid, onClick) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = className;
        btn.dataset.testid = testid;
        btn.textContent = label;
        addScopedDomListener(this, 'view', btn, 'click', onClick);
        return btn;
    }

    /**
     * @private O seletor de prazo da seção "Concedidos por mim", UM para a seção inteira.
     *
     * A ESCADA VEM DE `catalog/grant-tree.js` (`GRANT_TERMS`), e não é escrita aqui. Ela era um
     * `const` privado do modal de recurso até 2026-08-24; duas cópias fariam "90 dias" valer
     * prazos diferentes em duas telas do mesmo produto, e a divergência só apareceria para quem
     * comparasse as duas, que é ninguém.
     *
     * Aquele arquivo tem ZERO imports por contrato, então importá-lo daqui não arrasta a store
     * para `admin.html`, que boota sem ela.
     * @returns {HTMLElement}
     */
    _termPicker() {
        const box = document.createElement('div');
        box.className = 'admin-grants__term';

        const id = 'admin-grants-term-select';
        const label = document.createElement('label');
        label.className = 'admin-grants__term-label';
        label.htmlFor = id;
        label.textContent = issuedExtensionTermLabel();
        box.appendChild(label);

        const select = document.createElement('select');
        select.id = id;
        select.className = 'admin-input admin-input--sm';
        select.dataset.testid = 'admin-grants-term';
        for (const p of GRANT_TERMS) {
            const opt = document.createElement('option');
            opt.value = String(p.dias);
            opt.textContent = p.label;
            if (p.dias === this._dias) opt.selected = true;
            select.appendChild(opt);
        }
        addScopedDomListener(this, 'view', select, 'change', () => {
            this._dias = Number(select.value) || GRANT_TERM_DEFAULT_DAYS;
        });
        box.appendChild(select);
        return box;
    }

    /**
     * @private Renova o prazo de uma concessão que esta pessoa fez.
     *
     * LÊ O EFETIVO, NUNCA O PEDIDO, e é a metade do conserto que se perde numa reescrita
     * desatenta. O servidor apara por DOIS tetos (o de quem concedeu, e um ano contado do
     * NASCIMENTO da linha), então pedir 180 dias e receber 20 é desfecho normal, não erro. Um
     * botão que pedisse 180, recebesse 20 e anunciasse 180 seria pior que não existir: ele
     * ensinaria a pessoa a confiar num prazo que já venceu. `extensionOutcome` compara pedido,
     * efetivo e anterior, e `extensionSummary` nomeia o efetivo nos três desfechos, inclusive
     * naquele em que o clique não mudou nada (200 com o prazo atual, quando a linha já está no
     * teto do pai).
     *
     * SEM CONFIRMAÇÃO PRÉVIA, ao contrário do irmão `_revoke`: renovar é aditivo e reversível
     * (revogar continua ali ao lado), e confirmar tudo treina a confirmar sem ler, que é o que
     * torna a confirmação do ato destrutivo inútil.
     * @param {Object} grant
     */
    async _extend(grant) {
        if (this._busy || !grant?.id) return;
        const pedido = extensionDeadline(this._dias);
        if (!pedido) {
            showError('Escolha um prazo antes de renovar.');
            return;
        }
        this._busy = true;
        try {
            const resposta = await apiClient.extendResourceGrant(grant.id, pedido);
            // `expiresAt` é o contrato acordado; `expires_at` é o nome da COLUNA, aceito aqui
            // porque uma rota que devolva a linha crua não é caso para descobrir por toast mudo.
            const efetivo = resposta?.expiresAt ?? resposta?.expires_at ?? null;
            const desfecho = extensionOutcome({
                pedido,
                efetivo,
                anterior: grant?.expiresAt ?? grant?.expires_at ?? null,
            });
            showSuccess(extensionSummary(desfecho, shortDate(efetivo)));
        } catch (error) {
            showError(error?.message || 'Não foi possível renovar o prazo.');
        } finally {
            this._busy = false;
        }
        // RELIDA TAMBÉM NO ERRO, pela mesma razão de `_revoke`: a causa mais provável de falha
        // aqui é a linha ter morrido noutra sessão, e deixá-la na tela oferece o mesmo erro de novo.
        if (this._alive) this._render();
    }

    /**
     * @private Revoga uma concessão que esta pessoa fez.
     *
     * O AVISO É QUALITATIVO e o TOAST é numérico, que é a divisão da casa: a tela não conhece a
     * subárvore pendurada nesta linha (ela é de recursos diferentes e não carrega árvore nenhuma),
     * e quem a conhece é a poda do servidor. Ver `issuedRevocationWarning`.
     *
     * A LISTA É RELIDA TAMBÉM NO ERRO, e não só no sucesso: a causa mais provável de uma falha aqui
     * é a linha ter morrido noutra sessão (revogada, ou vencida entre o desenho e o clique), e
     * deixar a linha morta na tela com o botão de novo é oferecer o mesmo erro outra vez.
     * @param {Object} grant
     */
    async _revoke(grant) {
        const ok = await showConfirm(`Revogar o acesso a "${resourceDisplayName(grant)}"?`, {
            message: issuedRevocationWarning(grant),
            destructive: true,
            confirmText: 'Revogar',
            cancelText: 'Manter',
        });
        if (!ok) return;
        try {
            const resposta = await apiClient.revokeResourceGrant(grant?.id);
            showSuccess(issuedRevocationSummary(resposta));
        } catch (error) {
            showError(error?.message || 'Não foi possível remover o acesso.');
        }
        if (this._alive) this._render();
    }
}

/**
 * Roda `fn` de modo que TODA falha vire uma promessa rejeitada, inclusive a síncrona.
 * @param {Function} fn
 * @returns {Promise<*>}
 */
async function settle(fn) {
    return fn();
}

// ===== small DOM builders =====

/**
 * A table with its header row already built.
 * @param {string[]} headers
 * @returns {{table: HTMLTableElement, tbody: HTMLTableSectionElement}}
 */
function buildTable(headers) {
    const table = document.createElement('table');
    table.className = 'admin-users__table';
    const thead = document.createElement('thead');
    const hrow = document.createElement('tr');
    for (const h of headers) {
        const th = document.createElement('th');
        th.textContent = h;
        if (h === 'Vencimento') th.title = 'Depois desta data o acesso deixa de valer sozinho.';
        hrow.appendChild(th);
    }
    thead.appendChild(hrow);
    table.appendChild(thead);
    const tbody = document.createElement('tbody');
    table.appendChild(tbody);
    return { table, tbody };
}

/** @param {string} text @returns {HTMLTableCellElement} */
function cell(text) {
    const td = document.createElement('td');
    td.textContent = text;
    return td;
}

/**
 * A célula do nível, como chip com a frase que o explica no `title`.
 * @param {*} level
 * @returns {HTMLTableCellElement}
 */
function levelCell(level) {
    const td = document.createElement('td');
    const chip = document.createElement('span');
    chip.className = 'admin-chip admin-chip--user';
    chip.dataset.testid = 'admin-grant-level';
    chip.textContent = grantLevelLabel(level) || '—';
    const frase = grantLevelDescription(level);
    if (frase) chip.title = frase;
    td.appendChild(chip);
    return td;
}

/**
 * A célula do prazo. O ESTADO vira classe, e não só texto: a linha vencida e a que vence em três
 * dias pedem tratamentos visuais diferentes, e é o que o dado ganha ao ser um valor.
 * @param {*} expiresAt
 * @param {'issued'|'received'} perspective
 * @returns {HTMLTableCellElement}
 */
function expiryCell(expiresAt, perspective) {
    const td = document.createElement('td');
    const chip = expiryChip(expiresAt, { perspective });
    const el = document.createElement('span');
    el.className = `admin-grants__expiry admin-grants__expiry--${chip.state}`;
    el.dataset.testid = 'admin-grant-expiry';
    el.dataset.expiryState = chip.state;
    el.textContent = chip.label;
    el.title = chip.title;
    td.appendChild(el);
    return td;
}

/**
 * A célula de quem concedeu, com o caminho de GRUPO quando é o caso.
 *
 * `viaGroup` é a única transferência de autoridade sem linha própria em `resource_grants`, e o
 * rótulo é o único lugar em que a pessoa descobre que perde o acesso ao sair do grupo.
 * @param {Object} grant
 * @returns {HTMLTableCellElement}
 */
function grantorCell(grant) {
    const td = document.createElement('td');
    const box = document.createElement('div');
    box.className = 'admin-users__identity-text';
    const nome = document.createElement('span');
    nome.className = 'admin-users__name';
    nome.textContent = grantorLabel(grant);
    box.appendChild(nome);
    const viaGroupLabelText = grant?.viaGroup ? viaGroupText(grant.viaGroup) : null;
    if (viaGroupLabelText) {
        const via = document.createElement('span');
        via.className = 'admin-grants__via-group';
        via.dataset.testid = 'admin-grant-via-group';
        via.textContent = viaGroupLabelText.label;
        via.title = viaGroupLabelText.title;
        box.appendChild(via);
    }
    td.appendChild(box);
    return td;
}

/**
 * O par (rótulo, explicação) do caminho de grupo. Separado para manter `grantorCell` legível; a
 * decisão de vocabulário mora em `grant-phrases.js`.
 * @param {{id?: string, name?: string}} viaGroup
 * @returns {{label: string, title: string}|null}
 */
function viaGroupText(viaGroup) {
    const label = viaGroupLabel(viaGroup);
    return label ? { label, title: viaGroupNotice(viaGroup) } : null;
}
