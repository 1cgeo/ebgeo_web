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
import { sectionHeader, card, avatar, emptyState, ICON_GROUPS } from './admin-dom.js';
import {
    toCount,
    groupReach,
    groupDeletionWarning,
    groupDeletionSummary,
    memberRemovalWarning,
    memberRemovalSummary,
    groupOwnerLabel,
    memberDisplayName,
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
        c.appendChild(sectionHeader('Meus grupos', {
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
            loading.textContent = 'Falha ao carregar os grupos.';
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
     * @private A segunda seção: os grupos de que a pessoa PARTICIPA, com o dono e nada mais.
     *
     * O que NÃO tem aqui é a metade que importa: sem roster, sem contagem e sem botão. Quem
     * participa vê QUE participa e DE QUEM é o grupo (é a quem pedir entrada ou saída); quem
     * mais está dentro continua sendo informação de quem administra.
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
            const falha = document.createElement('p');
            falha.className = 'admin-users__status';
            falha.textContent = 'Falha ao carregar os grupos de que você participa.';
            wrap.appendChild(falha);
            return;
        }

        const outros = grupos.filter((g) => !jaListados.has(String(g?.id)));
        if (outros.length === 0) {
            wrap.appendChild(emptyState('Você não participa de nenhum grupo de outra pessoa.', {
                hint: 'Quem põe alguém num grupo é o dono dele.',
            }));
            return;
        }

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

            // Nome e dono, e NADA MAIS. A descrição foi renderizada aqui por uma revisão e
            // saiu em 2026-08-21: o servidor deixou de mandá-la, e o motivo é o mesmo que
            // mantém o roster e as contagens de fora — a decisão enumera o que o participante
            // vê, e o fileoverview desta aba já o dizia enquanto o código fazia o contrário.
            list.appendChild(item);
        }
        wrap.appendChild(list);
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

        const thead = document.createElement('thead');
        const hrow = document.createElement('tr');
        // "Dono" e não "Criado por": quem criou é história, quem manda é autoridade, e as duas
        // podem divergir. A coluna existe para o ADMINISTRADOR, o único que vê grupo alheio —
        // e sem ela a lista dele mostraria N grupos homônimos de gente diferente, porque a
        // unicidade de nome passou a ser POR DONO.
        // "Atlas" é o SEGUNDO eixo de alcance do grupo (D2, 2026-08-21). Enquanto só
        // "Recursos" existia, a tela mostrava metade do que a exclusão derruba.
        for (const h of ['Grupo', 'Membros', 'Recursos', 'Atlas', 'Dono', '']) {
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
            tr.appendChild(cell(group.owner_nome || group.owner_username || 'Sem dono definido'));

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
     * @private
     * @param {Object} group
     */
    async _delete(group) {
        const ok = await showConfirm(`Apagar o grupo "${group.name || ''}"?`, {
            message: groupDeletionWarning(group),
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
            loading.textContent = 'Falha ao carregar os membros.';
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
        for (const h of ['Pessoa', 'Posto/Graduação', 'Entrou em', '']) {
            const th = document.createElement('th');
            th.textContent = h;
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
            tr.appendChild(cell(formatDate(member.added_at)));

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
            // The route is idempotent, so "already there" is a success with `added: false` — saying
            // "adicionada" there would claim a change that did not happen.
            showSuccess(result?.added === false
                ? `${memberDisplayName(user)} já estava no grupo.`
                : `${memberDisplayName(user)} entrou no grupo.`);
            if (this._alive) this._renderMembers(group);
        } catch (error) {
            showError(error?.message || 'Falha ao adicionar a pessoa ao grupo.');
        }
    }

    /**
     * @private
     * @param {Object} group @param {Object} member
     */
    async _removeMember(group, member) {
        const ok = await showConfirm(
            `Tirar ${memberDisplayName(member)} do grupo "${group.name || ''}"?`,
            {
                message: memberRemovalWarning(group),
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
