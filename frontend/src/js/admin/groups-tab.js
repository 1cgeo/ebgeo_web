// Path: js/admin/groups-tab.js

/**
 * @fileoverview Aba "Grupos" — os grupos de acesso que recebem concessão sobre recurso privado
 * do catálogo (basemap, camada de dados, camada de análise, modelo 3D, panorama 360). Um grupo
 * é um saco de pessoas; conceder ao grupo concede a todo mundo que está dentro, e é essa a razão
 * de ele existir: a alternativa é conceder uma a uma e revogar uma a uma.
 *
 * A ABA É DE TODO MUNDO, desde 2026-08-20, e é "OS MEUS GRUPOS". O grupo deixou de ser mobília
 * do papel global e virou entidade de usuário, com dono: qualquer sessão autenticada cria um e
 * administra os seus. O administrador do sistema vê todos, pelo ramo curinga do predicado do
 * servidor. Nada nesta UI é a fronteira: quem gateia é `fn_can_administer_group`, no banco.
 *
 * DUAS SEÇÕES, E ELAS RESPONDEM PERGUNTAS DIFERENTES (decisão do dono, D6):
 *
 *   1. **Meus grupos** — gestão inteira: roster, contagens, criar, renomear, apagar.
 *   2. **Grupos de que participo** — nome e DONO, e nada mais. Ela existe porque a listagem
 *      acima é recortada por posse: sem a segunda seção, quem foi posto num grupo por outra
 *      pessoa não veria em tela nenhuma um mecanismo que decide o acesso dele a recurso
 *      privado. O ROSTER não sai por ali, e as contagens também não: quantos recursos o grupo
 *      recebeu diria a ele o TAMANHO de um acervo que ele não pode enumerar.
 *
 * As duas telas que não são óbvias são APAGAR e TIRAR ALGUÉM. As duas revogam: apagar derruba
 * tudo o que o grupo concedia, tirar alguém derruba o que ELE repassou a partir do grupo. Por
 * isso a confirmação nomeia o alcance antes do clique (`group-phrases.js`) e o toast depois
 * reporta o número do SERVIDOR, e não o da listagem: a listagem só conhece as concessões
 * diretas, e a poda alcança a subárvore.
 *
 * Todo texto dinâmico entra por `textContent`: nome do grupo, descrição, nome do dono e nome
 * dos membros são texto livre escrito por outra pessoa.
 */

import { apiClient } from '@store/sync/api-client.js';
import { sessionContext } from '@store/sync/session-context.js';
import { showConfirm } from '@modals/confirm.modal.js';
import { showSuccess, showError } from '@utils/toast_service.js';
// From the FILES, never from the `@utils` / `@modals` barrels: this page does not load the
// store, and the barrels reach it transitively.
import {
    setupCleanup,
    addScopedDomListener,
    clearScopedListeners,
    trackTimer,
    cleanup,
} from '@utils/event-cleanup.js';
import { sectionHeader, card, avatar, emptyState, ICON_GROUPS, failureState } from './admin-dom.js';
import {
    toCount,
    groupReach,
    groupDeletionWarning,
    groupDeletionSummary,
    memberRemovalWarning,
    memberRemovalSummary,
    memberAdditionSummary,
    groupTableColumns,
    groupOwnerLabel,
    memberDisplayName,
    memberAddedByLabel,
    memberAdmissionTitle,
    LEAVE_AVAILABILITY,
    leaveGroupAvailability,
    leaveGroupWarning,
    leaveGroupSummary,
    groupOwnerCannotLeaveNotice,
    groupOwnerCannotLeaveShort,
    // A MESMA frase do modal de recurso, e não uma segunda escrita aqui: a aba dizia "Falha ao
    // carregar os grupos de que você participa", que soa igual a "você não participa de nenhum".
    groupsLoadFailureNotice,
    leaveAvailabilityUnknownNotice,
    participatingReachUnknownNotice,
} from './group-phrases.js';

/** The user search waits this long after the last keystroke before hitting the backend. */
const SEARCH_DEBOUNCE_MS = 250;
/** The backend's own minimum for `/users/search`; below it the request is pointless. */
const SEARCH_MIN_CHARS = 2;

/**
 * Builds the "Grupos" tab definition for the admin panel.
 * @returns {import('./admin-panel.js').AdminTab}
 */
export function createGroupsTab() {
    const tab = new GroupsTab();
    return {
        id: 'groups',
        label: 'Grupos',
        testid: 'admin-tab-groups',
        icon: ICON_GROUPS,
        mount: (container) => tab.mount(container),
    };
}

class GroupsTab {
    /**
     * @param {HTMLElement} container
     * @returns {Function} cleanup
     */
    mount(container) {
        this._container = container;
        this._alive = true;
        this._groups = [];
        this._members = [];
        this._searchTimer = null;
        setupCleanup(this);
        this._renderList();
        return () => {
            this._alive = false;
            clearTimeout(this._searchTimer);
            this._searchTimer = null;
            cleanup(this);
        };
    }

    /**
     * @private Starts a new view: drops the previous view's listeners and its pending search,
     * then empties the container. Listeners are scoped because the three views replace each
     * other many times inside a single mount, and an unscoped bucket would only be emptied
     * when the tab is left.
     * @returns {HTMLElement}
     */
    _beginView() {
        clearScopedListeners(this, 'view');
        clearScopedListeners(this, 'results');
        clearTimeout(this._searchTimer);
        this._searchTimer = null;
        this._container.replaceChildren();
        return this._container;
    }

    /**
     * @private A button whose click listener belongs to the current view's scope.
     * @param {string} label @param {string} className @param {string} testid @param {?Function} onClick
     * @param {string} [scope]
     * @returns {HTMLButtonElement}
     */
    _button(label, className, testid, onClick, scope = 'view') {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = className;
        btn.dataset.testid = testid;
        btn.textContent = label;
        if (onClick) addScopedDomListener(this, scope, btn, 'click', onClick);
        return btn;
    }

    // ----- list -----

    /** @private */
    async _renderList() {
        const c = this._beginView();

        const newBtn = this._button('+ Novo grupo', 'admin-btn admin-btn--primary', 'admin-groups-new',
            () => this._renderForm(null));
        // O TÍTULO SEGUE QUEM OLHA. `fn_can_administer_group` tem um ramo curinga para o
        // administrador global, então a consulta devolve TODO grupo do sistema para ele: chamar
        // aquilo de "Meus grupos" faz o administrador acreditar que criou grupos que não criou, e
        // a coluna "Dono" ao lado (que existe só para ele) contradiz o título logo acima.
        c.appendChild(sectionHeader(sessionContext.isAdmin() ? 'Grupos de acesso' : 'Meus grupos', {
            subtitle: 'Conjuntos de pessoas que recebem acesso a recursos privados do catálogo',
            actions: [newBtn],
        }));

        const wrap = card({ testid: 'admin-groups-table', padded: false });
        const loading = document.createElement('p');
        loading.className = 'admin-users__status';
        loading.textContent = 'Carregando grupos…';
        wrap.appendChild(loading);
        c.appendChild(wrap);

        const participo = document.createElement('section');
        participo.className = 'admin-groups__participating';
        participo.dataset.testid = 'admin-groups-participating';
        c.appendChild(participo);

        // AS DUAS CHAMADAS VÃO JUNTAS e cada uma falha por conta própria: são duas rotas, e uma
        // rede ruim que derrube a segunda não pode esconder a primeira, que é a seção de gestão.
        const [meus, membro] = await Promise.allSettled([
            apiClient.listAccessGroups(),
            apiClient.listAccessGroupsParticipating(),
        ]);
        if (!this._alive) return;

        if (meus.status === 'rejected') {
            // A SAÍDA que faltava. Ver `failureState` em `admin-dom.js`: falha de carregamento era
            // beco sem saída nas seis abas, e o único caminho era recarregar a página.
            loading.replaceChildren(failureState('Falha ao carregar os grupos.', {
                onRetry: () => { if (this._alive) this._renderList(); },
            }));
            showError(meus.reason?.message || 'Falha ao carregar os grupos.');
        } else {
            this._groups = Array.isArray(meus.value) ? meus.value : [];
            this._renderTable(wrap);
        }

        this._renderParticipating(participo, {
            grupos: membro.status === 'fulfilled' && Array.isArray(membro.value) ? membro.value : null,
            // Só se esconde o que a OUTRA seção comprovadamente mostrou. Com a listagem de
            // gestão em falha o conjunto é vazio de propósito: esconder por uma lista que não
            // chegou apagaria da tela o único grupo que a pessoa ainda podia ver.
            jaListados: meus.status === 'fulfilled'
                ? new Set(this._groups.map((g) => String(g.id)))
                : new Set(),
        });
    }

    /**
     * @private A segunda seção: os grupos de que a pessoa PARTICIPA, com o dono e a SAÍDA.
     *
     * O QUE NÃO SAI POR AQUI continua sendo o roster e as contagens: quem participa vê QUE
     * participa e DE QUEM é o grupo (é a quem pedir entrada), e quem mais está dentro é
     * informação de quem administra (cláusula 4.5). A seção diz isso em voz alta
     * (`participatingReachUnknownNotice`) em vez de deixar a ausência do número se ler como
     * zero.
     *
     * O QUE PASSOU A SAIR, em 2026-08-23, é o BOTÃO (cláusula 4.7). Antes disto a seção era
     * inteiramente informativa, e a única remoção existente passava por `requireGroupAuthority`,
     * que responde 404 ao próprio membro: participar era um estado do qual não havia saída pela
     * interface. O botão é gateado por `leaveGroupAvailability`, e não aparece para o dono,
     * porque o servidor lhe responde 409 e oferecer o que o servidor recusa é pior que não
     * oferecer nada.
     *
     * O que a seção 1 já mostrou sai daqui, e o caso que motiva o filtro é o do administrador:
     * ele vê TODOS os grupos na seção de gestão, e sem o filtro veria de novo, sem gestão
     * nenhuma, aqueles de que também é membro.
     *
     * @param {HTMLElement} host
     * @param {{grupos: Array|null, jaListados: Set<string>}} params
     */
    _renderParticipating(host, { grupos, jaListados }) {
        host.replaceChildren();
        host.appendChild(sectionHeader('Grupos de que participo', {
            subtitle: 'Grupos de outras pessoas que decidem o seu acesso a recursos privados',
        }));

        const wrap = card({ testid: 'admin-groups-participating-table', padded: false });
        host.appendChild(wrap);

        if (grupos === null) {
            // A SAÍDA QUE FALTAVA TAMBÉM AQUI. `_renderList` e `_renderMembers` ganharam
            // `failureState` no lote anterior e esta seção não: continuava um `<p>` com a mesma
            // classe e o mesmo cinza do "Carregando…" logo acima, sem `role="alert"` e sem botão.
            // Falha indistinguível de espera é a pior das três telas de estado, porque a pessoa
            // fica esperando um carregamento que já terminou.
            wrap.appendChild(failureState(groupsLoadFailureNotice(), {
                onRetry: () => { if (this._alive) this._renderList(); },
            }));
            return;
        }

        const outros = grupos.filter((g) => !jaListados.has(String(g?.id)));
        if (outros.length === 0) {
            wrap.appendChild(emptyState('Você não participa de nenhum grupo de outra pessoa.', {
                hint: 'Quem põe alguém num grupo é o dono dele.',
            }));
            return;
        }

        // A ressalva de escopo entra ANTES do cartão e só quando há linha para ela explicar:
        // numa seção vazia ela descreveria colunas que não existem na tela.
        const escopo = document.createElement('p');
        escopo.className = 'admin-groups__participating-scope';
        escopo.dataset.testid = 'admin-groups-participating-note';
        escopo.textContent = participatingReachUnknownNotice();
        host.insertBefore(escopo, wrap);

        // Lido UMA vez para a seção inteira: é o mesmo espectador em todas as linhas, e uma
        // leitura por linha só multiplicaria a chance de as linhas discordarem entre si.
        const viewerId = sessionContext.userId;

        const list = document.createElement('ul');
        list.className = 'admin-groups__participating-list';
        for (const group of outros) {
            const item = document.createElement('li');
            item.className = 'admin-groups__participating-item';
            item.dataset.testid = 'admin-groups-participating-row';
            item.dataset.groupId = group.id;

            const identity = document.createElement('div');
            identity.className = 'admin-users__identity';
            identity.appendChild(avatar(group.name || '?', group.id || group.name));
            const text = document.createElement('div');
            text.className = 'admin-users__identity-text';
            const nameEl = document.createElement('span');
            nameEl.className = 'admin-users__name';
            nameEl.textContent = group.name || '—';
            const ownerEl = document.createElement('span');
            ownerEl.className = 'admin-users__handle';
            ownerEl.textContent = groupOwnerLabel(group);
            text.append(nameEl, ownerEl);
            identity.appendChild(text);
            item.appendChild(identity);

            // Nome e dono como TEXTO, e nada mais. A descrição foi renderizada aqui por uma
            // revisão e saiu em 2026-08-21: o servidor deixou de mandá-la, e o motivo é o mesmo
            // que mantém o roster e as contagens de fora. O que entrou depois foi AÇÃO, não
            // informação de terceiro: sair é direito de quem entrou.
            const acoes = document.createElement('div');
            acoes.className = 'admin-groups__participating-actions';
            const saida = leaveGroupAvailability(group, viewerId);
            if (saida === LEAVE_AVAILABILITY.PODE) {
                acoes.appendChild(this._button('Sair do grupo',
                    'admin-btn admin-btn--danger admin-btn--sm', 'admin-group-leave',
                    () => this._leave(group)));
            } else if (saida === LEAVE_AVAILABILITY.DONO) {
                // Espaço vazio se lê como tela quebrada; a nota diz por que não há botão, e o
                // `title` carrega os dois caminhos que o servidor nomeia na recusa.
                //
                // O TEXTO VISÍVEL PASSOU A CARREGAR A SAÍDA em 2026-08-24. Era só "Você é o dono",
                // com a explicação inteira no `title` — e `title` não existe no toque nem para quem
                // navega por teclado, então a recusa era visível e o motivo não. A frase curta é a
                // metade ACIONÁVEL (o que fazer), porque das duas é a única que a pessoa pode usar.
                acoes.appendChild(this._leaveBlockedNote(
                    'admin-group-leave-blocked',
                    groupOwnerCannotLeaveShort(),
                    groupOwnerCannotLeaveNotice(),
                ));
            } else {
                // O TERCEIRO RAMO, que ficava VAZIO. `leaveGroupAvailability` tem três desfechos e
                // esta seção desenhava dois: sem sessão lida a div de ações não recebia nada, e
                // espaço vazio se lê como tela quebrada — a mesma lição que o ramo do dono acima já
                // tinha aprendido. Não afirma posse que ninguém mediu e não oferece o ato.
                acoes.appendChild(this._leaveBlockedNote(
                    'admin-group-leave-unknown',
                    'Saída indisponível agora',
                    leaveAvailabilityUnknownNotice(),
                ));
            }
            item.appendChild(acoes);

            list.appendChild(item);
        }
        wrap.appendChild(list);
    }

    /**
     * @private A nota que OCUPA O LUGAR do botão "Sair", nos dois ramos em que ele não existe.
     *
     * Uma fábrica só para os dois porque a forma é a mesma (texto curto visível + frase inteira no
     * `title`) e o que muda é o vocabulário, que mora em `group-phrases.js`. Duas cópias divergiriam
     * no estilo, e foi exatamente assim que um dos ramos ficou sem nota nenhuma.
     * @param {string} testid @param {string} visivel @param {string} completa
     * @returns {HTMLElement}
     */
    _leaveBlockedNote(testid, visivel, completa) {
        const nota = document.createElement('span');
        nota.className = 'admin-groups__leave-blocked';
        nota.dataset.testid = testid;
        nota.textContent = visivel;
        nota.title = completa;
        return nota;
    }

    /**
     * @private
     * @param {HTMLElement} wrap
     */
    _renderTable(wrap) {
        wrap.replaceChildren();
        if (this._groups.length === 0) {
            wrap.appendChild(emptyState('Nenhum grupo de acesso.', {
                hint: 'Crie o primeiro com "Novo grupo" e conceda o recurso a ele, não a cada pessoa.',
            }));
            return;
        }

        const table = document.createElement('table');
        table.className = 'admin-users__table';

        // A COLUNA "Dono" É RECORTADA POR AUDIÊNCIA desde 2026-08-24, e o comentário que morava
        // aqui já dizia por quê sem tirar a consequência: ela existe para o ADMINISTRADOR, o único
        // que vê grupo alheio (sem ela a lista dele mostraria N grupos homônimos de gente
        // diferente, porque a unicidade de nome passou a ser POR DONO). Para todo mundo mais a
        // listagem é recortada por posse, então a coluna respondia "eu" em toda linha. Quem decide
        // é `groupTableColumns`, função pura, para que o recorte seja testável em node.
        // ("Dono" e não "Criado por": quem criou é história, quem manda é autoridade, e as duas
        // podem divergir. E "Atlas" é o SEGUNDO eixo de alcance do grupo, D2 de 2026-08-21:
        // enquanto só "Recursos" existia, a tela mostrava metade do que a exclusão derruba.)
        const mostraDono = sessionContext.isAdmin();
        const thead = document.createElement('thead');
        const hrow = document.createElement('tr');
        for (const h of groupTableColumns({ isAdmin: mostraDono })) {
            const th = document.createElement('th');
            th.textContent = h;
            if (h === 'Recursos') th.title = 'Recursos privados a que este grupo dá acesso.';
            if (h === 'Atlas') th.title = 'Atlas compartilhados com este grupo.';
            if (h === 'Dono') th.title = 'Quem administra este grupo.';
            hrow.appendChild(th);
        }
        thead.appendChild(hrow);
        table.appendChild(thead);

        const tbody = document.createElement('tbody');
        for (const group of this._groups) {
            const tr = document.createElement('tr');
            tr.dataset.testid = 'admin-groups-row';
            tr.dataset.groupId = group.id;

            const idTd = document.createElement('td');
            const identity = document.createElement('div');
            identity.className = 'admin-users__identity';
            identity.appendChild(avatar(group.name || '?', group.id || group.name));
            const text = document.createElement('div');
            text.className = 'admin-users__identity-text';
            const nameEl = document.createElement('span');
            nameEl.className = 'admin-users__name';
            nameEl.textContent = group.name || '—';
            const descEl = document.createElement('span');
            descEl.className = 'admin-users__handle';
            descEl.textContent = group.description || 'Sem descrição';
            text.append(nameEl, descEl);
            identity.appendChild(text);
            idTd.appendChild(identity);
            tr.appendChild(idTd);

            tr.appendChild(cell(String(toCount(group.member_count))));
            tr.appendChild(cell(String(toCount(group.grant_count))));
            tr.appendChild(cell(String(toCount(group.atlas_share_count))));
            // A célula segue o cabeçalho: as duas contagens têm de casar, e é por isso que a
            // decisão é lida uma vez só, acima, em vez de reavaliada aqui dentro do laço.
            if (mostraDono) {
                tr.appendChild(cell(group.owner_nome || group.owner_username || 'Sem dono definido'));
            }

            const actions = document.createElement('td');
            actions.className = 'admin-users__actions';
            actions.appendChild(this._button('Membros', 'admin-btn admin-btn--ghost admin-btn--sm',
                'admin-group-members', () => this._renderMembers(group)));
            actions.appendChild(this._button('Editar', 'admin-btn admin-btn--ghost admin-btn--sm',
                'admin-group-edit', () => this._renderForm(group)));
            actions.appendChild(this._button('Apagar', 'admin-btn admin-btn--danger admin-btn--sm',
                'admin-group-delete', () => this._delete(group)));
            tr.appendChild(actions);

            tbody.appendChild(tr);
        }
        table.appendChild(tbody);
        wrap.appendChild(table);
    }

    // ----- create / edit -----

    /**
     * @private
     * @param {Object|null} group - null to create, the group to rename/redescribe.
     */
    _renderForm(group) {
        const isEdit = !!group;
        const c = this._beginView();

        const form = document.createElement('form');
        form.className = 'admin-form';
        form.dataset.testid = 'admin-group-form';

        const heading = document.createElement('h3');
        heading.className = 'admin-form__heading';
        heading.textContent = isEdit ? `Editar grupo: ${group.name || ''}` : 'Novo grupo';
        form.appendChild(heading);

        const nameInput = textField(form, 'Nome', 'admin-groupform-name', group?.name || '');
        const descInput = textareaField(form, 'Descrição (opcional)', 'admin-groupform-description',
            group?.description || '');

        const hint = document.createElement('p');
        hint.className = 'admin-form__hint';
        hint.textContent = 'A descrição diz a quem o grupo se destina. Quem for conceder um recurso '
            + 'escolhe o grupo por ela.';
        form.appendChild(hint);

        const error = document.createElement('div');
        error.className = 'admin-form__error';
        error.dataset.testid = 'admin-groupform-error';
        error.hidden = true;
        error.setAttribute('role', 'alert');
        form.appendChild(error);

        const actions = document.createElement('div');
        actions.className = 'admin-form__actions';
        actions.appendChild(this._button('Cancelar', 'admin-btn admin-btn--ghost', 'admin-groupform-cancel',
            () => this._renderList()));
        const saveBtn = this._button(isEdit ? 'Salvar' : 'Criar', 'admin-btn admin-btn--primary',
            'admin-groupform-save', null);
        saveBtn.type = 'submit';
        actions.appendChild(saveBtn);
        form.appendChild(actions);

        addScopedDomListener(this, 'view', form, 'submit', async (e) => {
            e.preventDefault();
            error.hidden = true;
            const name = nameInput.value.trim();
            const description = descInput.value.trim();
            if (!name) {
                showFormError(error, 'Informe o nome do grupo.');
                return;
            }
            saveBtn.disabled = true;
            try {
                // A duplicate name comes back as a readable 409 from the server, which owns the
                // uniqueness. Checking it here against the cached listing would race and would
                // still have to handle the 409, so there is only one check and it is the server's.
                if (isEdit) {
                    await apiClient.updateAccessGroup(group.id, { name, description: description || null });
                    showSuccess('Grupo atualizado.');
                } else {
                    await apiClient.createAccessGroup({ name, description: description || null });
                    showSuccess('Grupo criado.');
                }
                if (this._alive) this._renderList();
            } catch (err) {
                showFormError(error, err?.message || 'Falha ao salvar o grupo.');
                saveBtn.disabled = false;
            }
        });

        c.appendChild(form);
    }

    /**
     * @private OS NÚMEROS DO AVISO, RELIDOS DO SERVIDOR.
     *
     * As contagens da listagem são uma FOTO tirada quando a aba montou, e entre ela e o clique
     * alguém pode ter concedido um recurso ao grupo ou compartilhado outro atlas com ele.
     * Avisar sobre um ato irreversível com número velho é a forma de verificação fantasma que
     * cabe numa confirmação: a frase é precisa, e está errada.
     *
     * A releitura é a LISTAGEM inteira, e não uma rota de alcance: não existe
     * `GET /access-groups/:id` no servidor, e inventá-la aqui seria mudar o backend por causa
     * de uma frase. Uma requisição por clique em "Apagar" não é tempestade.
     *
     * FALHAR AQUI NÃO CANCELA O ATO: quem quer apagar continua podendo, com a ressalva de que
     * o número pode estar defasado. O grupo que sumiu da listagem cai no mesmo ramo, porque
     * "não achei" é exatamente tão desconhecido quanto "não consegui perguntar".
     * @param {Object} group
     * @returns {Promise<{group: Object, stale: boolean}>}
     */
    async _reachForWarning(group) {
        try {
            const lista = await apiClient.listAccessGroups();
            const fresco = (Array.isArray(lista) ? lista : [])
                .find((g) => String(g?.id) === String(group?.id));
            return fresco ? { group: fresco, stale: false } : { group, stale: true };
        } catch {
            return { group, stale: true };
        }
    }

    /**
     * @private
     * @param {Object} group
     */
    async _delete(group) {
        const { group: alvo, stale } = await this._reachForWarning(group);
        if (!this._alive) return;
        const ok = await showConfirm(`Apagar o grupo "${group.name || ''}"?`, {
            message: groupDeletionWarning(alvo, { countsStale: stale }),
            destructive: true,
            confirmText: 'Apagar',
            cancelText: 'Manter',
        });
        if (!ok) return;
        try {
            const result = await apiClient.deleteAccessGroup(group.id);
            showSuccess(groupDeletionSummary({ ...result, name: result?.name || group.name }));
            if (this._alive) this._renderList();
        } catch (err) {
            showError(err?.message || 'Falha ao apagar o grupo.');
            // A LISTA É RELIDA NO ERRO, e este é o caso que motivou a regra: um 404 aqui significa
            // que o grupo já não existe (apagado noutra sessão, ou noutra aba), e a tela ficava
            // mostrando a linha com os três botões, todos condenados a falhar de novo.
            if (this._alive) this._renderList();
        }
    }

    /**
     * @private SAIR DO GRUPO POR CONTA PRÓPRIA (cláusula 4.7).
     *
     * NÃO HÁ RELEITURA AQUI, ao contrário de `_delete`, e a assimetria é medida e não descuido:
     * `_reachForWarning` relê a listagem de GESTÃO para refrescar números que o aviso cita, e
     * este aviso não cita número nenhum, porque a listagem que serve esta seção
     * (`LIST_GROUPS_OF_MEMBER`) não traz contagem. Uma requisição a mais que não muda uma
     * palavra da frase é custo sem produto.
     *
     * O 409 do dono chega como erro com a mensagem do SERVIDOR, que nomeia apagar o grupo ou
     * transferir a posse. Ele não deveria acontecer (o botão nem aparece para o dono), e por
     * isso mesmo o `catch` não o reescreve: se acontecer, a explicação certa é a de quem
     * recusou.
     * @param {Object} group
     */
    async _leave(group) {
        const ok = await showConfirm(`Sair do grupo "${group.name || ''}"?`, {
            message: leaveGroupWarning(group),
            destructive: true,
            confirmText: 'Sair do grupo',
            cancelText: 'Continuar no grupo',
        });
        if (!ok) return;
        try {
            const result = await apiClient.leaveGroup(group.id);
            // `removed` e `grantsAffected` são do servidor, e o primeiro é o que distingue o ato
            // realizado da resposta idempotente (grupo inexistente, ou já não participo).
            showSuccess(leaveGroupSummary({ ...result, name: group.name || '' }));
            if (this._alive) this._renderList();
        } catch (error) {
            showError(error?.message || 'Falha ao sair do grupo.');
            // Mesma regra de `_delete`: o grupo pode ter deixado de existir entre o desenho e o
            // clique, e a linha morta com o botão "Sair" é o mesmo erro esperando repetição.
            if (this._alive) this._renderList();
        }
    }

    // ----- members -----

    /**
     * @private
     * @param {Object} group
     */
    async _renderMembers(group) {
        const c = this._beginView();
        // Dropped BEFORE the fetch: it is what the search uses to know who is already in, and the
        // previous group's roster answering that question would offer to add someone twice.
        this._members = [];

        const backBtn = this._button('← Voltar aos grupos', 'admin-btn admin-btn--ghost',
            'admin-groups-back', () => this._renderList());
        c.appendChild(sectionHeader(`Membros de ${group.name || ''}`, { actions: [backBtn] }));

        // The reach line is built here instead of as the header's subtitle because it is
        // REWRITTEN after every add/remove, and the header builder does not hand its subtitle back.
        const reach = document.createElement('p');
        reach.className = 'admin-section__subtitle';
        reach.dataset.testid = 'admin-group-reach';
        reach.textContent = groupReach(group);
        c.appendChild(reach);

        c.appendChild(this._buildMemberSearch(group));

        const wrap = card({ testid: 'admin-group-members-table', padded: false });
        const loading = document.createElement('p');
        loading.className = 'admin-users__status';
        loading.textContent = 'Carregando membros…';
        wrap.appendChild(loading);
        c.appendChild(wrap);

        let members;
        try {
            members = await apiClient.listAccessGroupMembers(group.id);
        } catch (error) {
            if (!this._alive) return;
            // A SAÍDA que faltava. Ver `failureState` em `admin-dom.js`: falha de carregamento era
            // beco sem saída nas seis abas, e o único caminho era recarregar a página.
            loading.replaceChildren(failureState('Falha ao carregar os membros.', {
                onRetry: () => { if (this._alive) this._renderList(); },
            }));
            showError(error?.message || 'Falha ao carregar os membros.');
            return;
        }
        if (!this._alive) return;
        this._members = Array.isArray(members) ? members : [];
        // The listing's counter is a snapshot from before this screen; the roster just loaded is
        // the current truth, so the reach line follows it.
        group.member_count = this._members.length;
        reach.textContent = groupReach(group);
        this._renderMembersTable(wrap, group);
    }

    /**
     * @private The "add someone" card: a debounced search over `/users/search` plus its results.
     * @param {Object} group
     * @returns {HTMLElement}
     */
    _buildMemberSearch(group) {
        const box = card({ testid: 'admin-group-add-member' });

        const label = document.createElement('label');
        label.className = 'admin-groups__search-label';
        label.setAttribute('for', 'admin-group-search');
        label.textContent = 'Adicionar pessoa ao grupo';
        box.appendChild(label);

        const search = document.createElement('input');
        search.type = 'search';
        search.id = 'admin-group-search';
        search.className = 'admin-input admin-groups__search';
        search.dataset.testid = 'admin-group-search';
        search.placeholder = 'Buscar por nome, usuário ou posto…';
        box.appendChild(search);

        const results = document.createElement('div');
        results.className = 'admin-transfer__results';
        results.dataset.testid = 'admin-group-search-results';
        box.appendChild(results);

        addScopedDomListener(this, 'view', search, 'input', () => {
            clearTimeout(this._searchTimer);
            const q = search.value.trim();
            if (q.length < SEARCH_MIN_CHARS) {
                clearScopedListeners(this, 'results');
                results.replaceChildren();
                return;
            }
            // Tracked so the tab's cleanup clears it: a stray fire after teardown would issue an
            // authenticated search for a panel that no longer exists.
            this._searchTimer = setTimeout(() => this._runSearch(q, results, group), SEARCH_DEBOUNCE_MS);
            trackTimer(this, this._searchTimer, 'timeout');
        });

        return box;
    }

    /**
     * @private
     * @param {string} q @param {HTMLElement} results @param {Object} group
     */
    async _runSearch(q, results, group) {
        let found;
        try {
            found = await apiClient.searchUsers(q);
        } catch (error) {
            if (this._alive) showError(error?.message || 'Falha ao buscar pessoas.');
            return;
        }
        if (!this._alive) return;

        clearScopedListeners(this, 'results');
        results.replaceChildren();

        const already = new Set(this._members.map((m) => String(m.id)));
        const candidates = (found || []).filter((u) => !already.has(String(u.id)));
        if (candidates.length === 0) {
            const none = document.createElement('p');
            none.className = 'admin-users__status';
            none.dataset.testid = 'admin-group-search-empty';
            none.textContent = (found || []).length === 0
                ? 'Ninguém encontrado com esse termo.'
                : 'Todas as pessoas encontradas já estão no grupo.';
            results.appendChild(none);
            return;
        }

        for (const candidate of candidates) {
            const row = document.createElement('div');
            row.className = 'admin-transfer__option admin-groups__candidate';
            row.dataset.testid = 'admin-group-candidate';

            const text = document.createElement('span');
            text.textContent = `${memberDisplayName(candidate)} (@${candidate.username || ''})`;
            row.appendChild(text);

            row.appendChild(this._button('Adicionar', 'admin-btn admin-btn--ghost admin-btn--sm',
                'admin-group-member-add', () => this._addMember(group, candidate), 'results'));
            results.appendChild(row);
        }
    }

    /**
     * @private
     * @param {HTMLElement} wrap @param {Object} group
     */
    _renderMembersTable(wrap, group) {
        wrap.replaceChildren();
        if (this._members.length === 0) {
            wrap.appendChild(emptyState('Nenhuma pessoa neste grupo.', {
                hint: 'Um grupo vazio não dá acesso a ninguém, mesmo com recursos concedidos a ele.',
            }));
            return;
        }

        const table = document.createElement('table');
        table.className = 'admin-users__table';

        const thead = document.createElement('thead');
        const hrow = document.createElement('tr');
        // "Adicionado por" entrou em 2026-08-23. O servidor mandava `added_by` e
        // `added_by_username` desde sempre (`LIST_MEMBERS`) e a tela não os lia: quem pôs a
        // pessoa num grupo que decide acesso a recurso privado chegava pela rede e morria sem
        // leitor. É a informação que responde "por que este nome está aqui".
        for (const h of ['Pessoa', 'Posto/Graduação', 'Entrou em', 'Adicionado por', '']) {
            const th = document.createElement('th');
            th.textContent = h;
            if (h === 'Adicionado por') th.title = 'Quem pôs esta pessoa no grupo.';
            hrow.appendChild(th);
        }
        thead.appendChild(hrow);
        table.appendChild(thead);

        const tbody = document.createElement('tbody');
        for (const member of this._members) {
            const tr = document.createElement('tr');
            tr.dataset.testid = 'admin-group-member-row';
            tr.dataset.userId = member.id;

            const idTd = document.createElement('td');
            const identity = document.createElement('div');
            identity.className = 'admin-users__identity';
            identity.appendChild(avatar(member.nome || member.username, member.id || member.username));
            const text = document.createElement('div');
            text.className = 'admin-users__identity-text';
            const nameEl = document.createElement('span');
            nameEl.className = 'admin-users__name';
            nameEl.textContent = member.nome || '—';
            const handle = document.createElement('span');
            handle.className = 'admin-users__handle';
            handle.textContent = `@${member.username || ''}`;
            text.append(nameEl, handle);
            identity.appendChild(text);
            idTd.appendChild(identity);
            tr.appendChild(idTd);

            tr.appendChild(cell(member.posto_graduacao || '—'));
            const quando = formatDate(member.added_at);
            tr.appendChild(cell(quando));
            // O `title` carrega a frase inteira (quem E quando) porque a célula sozinha diz
            // só o arroba, e as duas ausências possíveis ("não registrado" e "conta removida")
            // precisam de contexto para não parecerem a mesma coisa.
            const autoria = cell(memberAddedByLabel(member));
            autoria.className = 'admin-groups__added-by';
            autoria.title = memberAdmissionTitle(member, quando);
            tr.appendChild(autoria);

            const actions = document.createElement('td');
            actions.className = 'admin-users__actions';
            actions.appendChild(this._button('Remover', 'admin-btn admin-btn--danger admin-btn--sm',
                'admin-group-member-remove', () => this._removeMember(group, member)));
            tr.appendChild(actions);

            tbody.appendChild(tr);
        }
        table.appendChild(tbody);
        wrap.appendChild(table);
    }

    /**
     * @private
     * @param {Object} group @param {Object} user
     */
    async _addMember(group, user) {
        try {
            const result = await apiClient.addAccessGroupMember(group.id, user.id);
            // O TOAST RELATA O ALCANCE desde 2026-08-24, e a razão está no `fileoverview` de
            // `memberAdditionSummary`: pôr alguém num grupo que já recebeu sete recursos privados é
            // conceder sete acessos de uma vez, sem gate de repasse e sem linha nova em
            // `resource_grants`. Este era o único ato do ciclo que não relatava nada, com a
            // contagem visível na coluna ao lado e ausente da frase. A rota continua idempotente, e
            // `added: false` cai no ramo que não anuncia mudança nenhuma.
            showSuccess(memberAdditionSummary(
                { name: memberDisplayName(user), added: result?.added },
                group,
            ));
            if (this._alive) this._renderMembers(group);
        } catch (error) {
            showError(error?.message || 'Falha ao adicionar a pessoa ao grupo.');
            // SEM RE-RENDERIZAR AQUI, ao contrário dos três atos irmãos, e a assimetria é medida: a
            // linha que pode estar morta neste caminho é um RESULTADO DE BUSCA, e redesenhar a tela
            // apagaria o termo que a pessoa digitou junto com ele. O roster em si não mudou.
        }
    }

    /**
     * @private
     * @param {Object} group @param {Object} member
     */
    async _removeMember(group, member) {
        // A RELEITURA VALE PARA OS DOIS ATOS IRREVERSÍVEIS, e até 2026-08-24 só `_delete` a fazia.
        // Aqui o número era ainda MAIS velho que lá: `grant_count` e `atlas_share_count` vêm do
        // fechamento de `_renderTable`, isto é, do instante em que a ABA montou (só `member_count`
        // é refrescado, ao abrir este roster), e entre aquele instante e este clique alguém pode ter
        // concedido um recurso ao grupo. Falhar a releitura NÃO cancela o ato: o aviso sai com a
        // ressalva de números defasados, que é a diferença entre um número velho e um número velho
        // apresentado como fresco.
        const { group: alvo, stale } = await this._reachForWarning(group);
        if (!this._alive) return;
        const ok = await showConfirm(
            `Tirar ${memberDisplayName(member)} do grupo "${group.name || ''}"?`,
            {
                message: memberRemovalWarning(alvo, { countsStale: stale }),
                destructive: true,
                confirmText: 'Remover',
            },
        );
        if (!ok) return;
        try {
            const result = await apiClient.removeAccessGroupMember(group.id, member.id);
            // O número é o do SERVIDOR (a poda inteira), pelo mesmo motivo da exclusão do grupo:
            // a tela não conhece a subárvore que o membro alimentou a partir deste grupo.
            showSuccess(memberRemovalSummary({
                name: memberDisplayName(member),
                grantsAffected: result?.grantsAffected,
            }));
            if (this._alive) this._renderMembers(group);
        } catch (error) {
            showError(error?.message || 'Falha ao remover a pessoa do grupo.');
            // O ROSTER É RELIDO NO ERRO TAMBÉM. A causa mais provável de uma falha aqui é a linha
            // já não existir (a pessoa saiu do grupo, ou outra sessão a removeu), e deixar a linha
            // morta na tela com o mesmo botão é oferecer o mesmo erro de novo.
            if (this._alive) this._renderMembers(group);
        }
    }
}

// ===== small DOM builders =====

/** @param {string} text @returns {HTMLTableCellElement} */
function cell(text) {
    const td = document.createElement('td');
    td.textContent = text;
    return td;
}

/**
 * A timestamp as a pt-BR date, or a dash when it is absent or unparseable.
 * @param {string|null|undefined} value
 * @returns {string}
 */
function formatDate(value) {
    if (!value) return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString('pt-BR');
}

/**
 * Adds a labelled text input to a form.
 * @returns {HTMLInputElement}
 */
function textField(form, label, testid, value) {
    const field = document.createElement('div');
    field.className = 'admin-form__field';
    const lab = document.createElement('label');
    lab.textContent = label;
    lab.setAttribute('for', testid);
    field.appendChild(lab);
    const input = document.createElement('input');
    input.type = 'text';
    input.id = testid;
    input.dataset.testid = testid;
    input.value = value;
    field.appendChild(input);
    form.appendChild(field);
    return input;
}

/**
 * Adds a labelled multi-line field to a form.
 * @returns {HTMLTextAreaElement}
 */
function textareaField(form, label, testid, value) {
    const field = document.createElement('div');
    field.className = 'admin-form__field';
    const lab = document.createElement('label');
    lab.textContent = label;
    lab.setAttribute('for', testid);
    field.appendChild(lab);
    const area = document.createElement('textarea');
    area.id = testid;
    area.dataset.testid = testid;
    area.rows = 3;
    area.value = value;
    field.appendChild(area);
    form.appendChild(field);
    return area;
}

/** @param {HTMLElement} el @param {string} msg */
function showFormError(el, msg) {
    el.textContent = msg;
    el.hidden = false;
}
