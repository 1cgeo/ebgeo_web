// Path: js/admin/users-tab.js

/**
 * @fileoverview "Usuários" tab of the admin panel. Lists users and drives the admin
 * CRUD (create / edit / reset password / deactivate+reactivate) against the existing
 * `/api/v1/users` admin routes (requireAdmin server-side). Deactivating a user who
 * owns atlases requires reassigning ownership — the backend returns a conflict and
 * this tab collects the new owner via the user search before retrying.
 *
 * All dynamic text is set via textContent (never innerHTML with user data).
 */

import { apiClient } from '@store/sync/api-client.js';
import { sessionContext } from '@store/sync/session-context.js';
import { showConfirm } from '@modals/confirm.modal.js';
import { showSuccess, showError } from '@utils/toast_service.js';
import config from '@js/config.js';
import { sectionHeader, card, avatar, emptyState, ICON_USERS } from './admin-dom.js';
import { orgLabel, buildDomainOptions } from './org-options.js';

/**
 * O papel global de que o par (papel, OM de produção) é exigido pelo banco.
 * Uma constante em vez do literal espalhado: o valor aparece em quatro decisões desta aba.
 */
const PRODUCER_ROLE = 'producer';

/**
 * O selo do papel GLOBAL na tabela.
 *
 * SÃO QUATRO PAPÉIS E ELES NÃO SÃO UMA ESCADA: nenhum contém o outro, e a tela nunca os
 * ordena por poder. Mapa em vez de ternário porque o eixo deixou de ser binário, e um
 * ternário com quatro valores é a forma que silenciosamente mostra "Usuário" para o papel
 * novo — foi o que já aconteceu uma vez.
 * @type {Object<string, {rotulo: string, variante: string}>}
 */
const ROLE_CHIP = {
    admin: { rotulo: 'Administrador', variante: 'admin' },
    credenciado: { rotulo: 'Credenciado', variante: 'credenciado' },
    producer: { rotulo: 'Produtor', variante: 'producer' },
    user: { rotulo: 'Usuário', variante: 'user' },
};

/**
 * As opções do papel global, na ordem em que a tela as oferece.
 *
 * A ORDEM NÃO É UMA ESCALA e o rótulo diz o que cada um É, para que ninguém escolha um
 * achando que dá outro: o Credenciado LÊ tudo e não escreve nada; o Produtor escreve, mas
 * só nos recursos da OM dele. Nada de `<optgroup>` aqui, que sugeriria contenção.
 */
const ROLE_OPTIONS = [
    { value: 'user', label: 'Usuário' },
    { value: PRODUCER_ROLE, label: 'Produtor (mantém os recursos de uma OM)' },
    { value: 'credenciado', label: 'Credenciado (lê todo recurso privado; não edita nada)' },
    { value: 'admin', label: 'Administrador (sistema)' },
];

/**
 * Builds the "Usuários" tab definition for the admin panel.
 * @returns {import('./admin-panel.js').AdminTab}
 */
export function createUsersTab() {
    const tab = new UsersTab();
    return {
        id: 'users',
        label: 'Usuários',
        testid: 'admin-tab-users',
        icon: ICON_USERS,
        mount: (container) => tab.mount(container),
    };
}

class UsersTab {
    /**
     * @param {HTMLElement} container
     * @returns {Function} cleanup
     */
    mount(container) {
        this._container = container;
        this._alive = true;
        this._includeInactive = false;
        this._searchTimer = null;
        this._users = [];   // set before any search input can fire _applyFilter (avoids a load-window crash)
        this._filter = '';
        this._renderList();
        return () => { this._alive = false; clearTimeout(this._searchTimer); };
    }

    // ----- list -----

    /** @private */
    async _renderList() {
        const c = this._container;
        c.replaceChildren();

        const newBtn = button('+ Novo usuário', 'admin-btn admin-btn--primary', 'admin-users-new',
            () => this._renderForm(null));
        c.appendChild(sectionHeader('Usuários', {
            subtitle: 'Contas, papéis e acesso ao sistema',
            actions: [newBtn],
        }));

        const toolbar = document.createElement('div');
        toolbar.className = 'admin-users__toolbar';

        const search = document.createElement('input');
        search.type = 'search';
        search.className = 'admin-input admin-users__search';
        search.placeholder = 'Buscar por nome ou usuário…';
        search.dataset.testid = 'admin-users-search';
        search.value = this._filter || '';
        search.addEventListener('input', () => { this._filter = search.value; this._applyFilter(); });
        toolbar.appendChild(search);

        const inactiveLabel = document.createElement('label');
        inactiveLabel.className = 'admin-users__inactive-toggle';
        const inactiveCb = document.createElement('input');
        inactiveCb.type = 'checkbox';
        inactiveCb.checked = this._includeInactive;
        inactiveCb.dataset.testid = 'admin-users-include-inactive';
        inactiveCb.addEventListener('change', () => {
            this._includeInactive = inactiveCb.checked;
            this._renderList();
        });
        inactiveLabel.appendChild(inactiveCb);
        inactiveLabel.appendChild(document.createTextNode('Mostrar inativos'));
        toolbar.appendChild(inactiveLabel);

        c.appendChild(toolbar);

        const tableWrap = card({ testid: 'admin-users-table', padded: false });
        tableWrap.classList.add('admin-users__table-wrap');
        const loading = document.createElement('p');
        loading.className = 'admin-users__status';
        loading.textContent = 'Carregando usuários…';
        tableWrap.appendChild(loading);
        c.appendChild(tableWrap);
        this._tableWrap = tableWrap;

        let users;
        try {
            users = await apiClient.listUsers({ includeInactive: this._includeInactive });
        } catch (error) {
            if (!this._alive) return;
            loading.textContent = 'Falha ao carregar usuários.';
            showError(error?.message || 'Falha ao carregar usuários.');
            return;
        }
        if (!this._alive) return;
        this._users = Array.isArray(users) ? users : [];
        this._applyFilter();
    }

    /** @private Re-renders the table from the cached list, applying the search filter. */
    _applyFilter() {
        if (!this._tableWrap) return;
        const q = (this._filter || '').trim().toLowerCase();
        const visible = !q ? this._users : this._users.filter((u) =>
            `${u.nome || ''} ${u.username || ''}`.toLowerCase().includes(q));
        this._renderTable(this._tableWrap, visible);
    }

    /**
     * @private
     * @param {HTMLElement} wrap
     * @param {Array<Object>} users
     */
    _renderTable(wrap, users) {
        wrap.replaceChildren();
        if (users.length === 0) {
            wrap.appendChild(emptyState(
                this._filter ? 'Nenhum usuário corresponde à busca.' : 'Nenhum usuário.',
                this._filter ? undefined : { hint: 'Crie o primeiro com "Novo usuário".' },
            ));
            return;
        }

        const table = document.createElement('table');
        table.className = 'admin-users__table';

        const thead = document.createElement('thead');
        const hrow = document.createElement('tr');
        // "Lotação" e "OM produtora" são DUAS COLUNAS porque são dois fatos diferentes, e
        // confundi-los é o defeito que esta fase fecha: a lotação é auto-declarada no
        // auto-cadastro e não autoriza mais nada; a OM produtora é concedida por um
        // administrador e É a autorização.
        for (const h of ['Usuário', 'Papel', 'Lotação', 'OM produtora', 'Status', '']) {
            const th = document.createElement('th');
            th.textContent = h;
            if (h === 'Lotação') th.title = 'Lotação declarada pelo usuário. Não dá acesso a nada.';
            if (h === 'OM produtora') th.title = 'A OM cujos recursos este usuário mantém (só para o papel Produtor).';
            hrow.appendChild(th);
        }
        thead.appendChild(hrow);
        table.appendChild(thead);

        const tbody = document.createElement('tbody');
        const myId = sessionContext.userId;
        for (const u of users) {
            const tr = document.createElement('tr');
            tr.dataset.testid = 'admin-users-row';
            tr.dataset.userId = u.id;

            // Identity: avatar + name + @handle (the username text the e2e matches lives here).
            const idTd = document.createElement('td');
            const identity = document.createElement('div');
            identity.className = 'admin-users__identity';
            identity.appendChild(avatar(u.nome || u.username, u.id || u.username));
            const text = document.createElement('div');
            text.className = 'admin-users__identity-text';
            const nm = document.createElement('span');
            nm.className = 'admin-users__name';
            nm.textContent = u.nome || '—';
            const handle = document.createElement('span');
            handle.className = 'admin-users__handle';
            handle.textContent = `@${u.username || ''}`;
            text.append(nm, handle);
            identity.appendChild(text);
            idTd.appendChild(identity);
            tr.appendChild(idTd);

            const roleTd = document.createElement('td');
            const roleChip = document.createElement('span');
            roleChip.className = `admin-chip admin-chip--${ROLE_CHIP[u.role]?.variante ?? 'user'}`;
            roleChip.textContent = ROLE_CHIP[u.role]?.rotulo ?? 'Usuário';
            roleTd.appendChild(roleChip);
            tr.appendChild(roleTd);

            const lotacao = cell(u.organizacao_militar || '—');
            lotacao.title = 'Lotação declarada pelo usuário. Não dá acesso a nada.';
            tr.appendChild(lotacao);

            // O nome vem resolvido quando o backend o manda; senão, do catálogo de OMs do
            // `/api/config`, que é a mesma lista que preenche o seletor do formulário.
            tr.appendChild(cell(u.producer_org_nome || orgLabel(u.producer_org_id)));

            const statusCell = document.createElement('td');
            const badge = document.createElement('span');
            badge.className = `admin-users__badge admin-users__badge--${u.is_active ? 'active' : 'inactive'}`;
            badge.textContent = u.is_active ? 'Ativo' : 'Inativo';
            statusCell.appendChild(badge);
            // A registered-but-unverified e-mail account is blocked from login until approved.
            if (u.email && u.email_verified === false) {
                const pending = document.createElement('span');
                pending.className = 'admin-users__badge admin-users__badge--pending';
                pending.textContent = 'Pendente';
                statusCell.appendChild(pending);
            }
            tr.appendChild(statusCell);

            const actions = document.createElement('td');
            actions.className = 'admin-users__actions';
            actions.appendChild(button('Editar', 'admin-btn admin-btn--ghost admin-btn--sm', 'admin-user-edit',
                () => this._renderForm(u)));
            actions.appendChild(button('Senha', 'admin-btn admin-btn--ghost admin-btn--sm', 'admin-user-password',
                () => this._renderPasswordForm(u)));
            if (u.is_active) {
                const deBtn = button('Desativar', 'admin-btn admin-btn--danger admin-btn--sm', 'admin-user-deactivate',
                    () => this._deactivate(u));
                if (u.id === myId) {
                    deBtn.disabled = true;
                    deBtn.title = 'Você não pode desativar a própria conta';
                }
                actions.appendChild(deBtn);
            } else {
                actions.appendChild(button('Reativar', 'admin-btn admin-btn--ghost admin-btn--sm', 'admin-user-reactivate',
                    () => this._reactivate(u)));
            }
            tr.appendChild(actions);
            tbody.appendChild(tr);
        }
        table.appendChild(tbody);
        wrap.appendChild(table);
    }

    // ----- create / edit form -----

    /**
     * @private
     * @param {Object|null} user - null for create, the user for edit.
     */
    _renderForm(user) {
        const isEdit = !!user;
        const c = this._container;
        c.replaceChildren();

        const form = document.createElement('form');
        form.className = 'admin-form';
        form.dataset.testid = 'admin-user-form';

        const heading = document.createElement('h3');
        heading.className = 'admin-form__heading';
        heading.textContent = isEdit ? `Editar usuário: ${user.username}` : 'Novo usuário';
        form.appendChild(heading);

        const nome = textField(form, 'Nome completo', 'admin-userform-nome', user?.nome || '');
        const username = textField(form, 'Usuário', 'admin-userform-username', user?.username || '');
        const password = isEdit ? null
            : textField(form, 'Senha', 'admin-userform-password', '', 'password');
        const posto = selectField(form, 'Posto/Graduação', 'admin-userform-posto',
            buildDomainOptions(config.postos, user?.rank_id, user?.posto_graduacao), user?.rank_id || '');
        const om = selectField(form, 'Organização Militar (lotação)', 'admin-userform-om',
            buildDomainOptions(config.organizacoesMilitares, user?.organization_id, user?.organizacao_militar), user?.organization_id || '');
        form.appendChild(hint('Lotação: rótulo institucional da pessoa, declarado por ela no '
            + 'auto-cadastro. NÃO autoriza nada — quem autoriza é o par Papel + OM produtora abaixo.'));

        // OS QUATRO PAPÉIS GLOBAIS. Ver ROLE_OPTIONS: não são uma escada, e o rótulo de cada
        // um diz o que ele é para que ninguém escolha um achando que está dando outro.
        const role = selectField(form, 'Papel', 'admin-userform-role', ROLE_OPTIONS,
            user?.role || 'user');

        // A OM DE PRODUÇÃO, que só existe para o papel Produtor. O par (papel, escopo) é um
        // BICONDICIONAL no banco: crachá sem escopo e escopo sem crachá são os dois estados
        // impossíveis, e o servidor recusa os dois. O campo desaparece fora do papel Produtor
        // porque um seletor cinza sem explicação vira chamado de suporte.
        const producerOm = selectField(form, 'OM produtora', 'admin-userform-producer-org',
            buildDomainOptions(config.organizacoesMilitares, user?.producer_org_id, user?.producer_org_nome,
                '— escolha a OM'),
            user?.producer_org_id || '');
        const producerField = producerOm.closest('.admin-form__field');
        const producerHint = hint('Um produtor mantém TODOS os recursos de UMA OM (catálogo e 360) '
            + 'e nada fora dela. Acima disso, use Administrador.');
        form.appendChild(producerHint);
        const syncProducerField = () => {
            const ehProdutor = role.value === PRODUCER_ROLE;
            if (producerField) producerField.hidden = !ehProdutor;
            producerHint.hidden = !ehProdutor;
            producerOm.disabled = !ehProdutor || role.disabled;
            if (!ehProdutor) producerOm.value = '';
        };
        role.addEventListener('change', syncProducerField);

        // Papel DENTRO da OM, distinto do papel global acima. Ele já NÃO autoriza a escrita de
        // projeto 360 — isso passou para o eixo de produção (`producer_org_id`) — mas continua
        // sendo a origem do papel POR ATLAS na hidratação da sessão (`org_role || 'viewer'`),
        // então apagá-lo rebaixaria todo mundo a Visualizador. Os rótulos deixaram de prometer
        // edição: prometer o que o servidor recusa é pior que não oferecer.
        const orgRole = selectField(form, 'Papel na OM (hierarquia interna)', 'admin-userform-orgrole',
            [
                { value: 'viewer', label: 'Visualizador' },
                { value: 'editor', label: 'Editor' },
                { value: 'admin', label: 'Administrador da OM' },
                { value: 'owner', label: 'Responsável pela OM' },
            ],
            user?.org_role || 'viewer');

        let active = null;
        let emailVerified = null;
        if (isEdit) {
            active = checkboxField(form, 'Ativo', 'admin-userform-active', user.is_active !== false);
            // Deactivation is NOT a plain edit: it must transfer owned atlases and end the user's
            // sessions, so the backend rejects an active→inactive PUT with a conflict. Unchecking
            // here could only ever fail — the control stays read-only while the user is active and
            // is offered only for the reactivation transition.
            if (user.is_active !== false) {
                active.disabled = true;
                const activeHint = document.createElement('p');
                activeHint.className = 'admin-form__hint';
                activeHint.textContent = 'Para desativar, use o botão "Desativar" na lista — ele transfere os atlas do usuário e encerra as sessões dele.';
                form.appendChild(activeHint);
            }
            // Admin approval of a pending e-mail account (the no-SMTP fallback path).
            if (user.email) {
                emailVerified = checkboxField(form, 'E-mail verificado (aprovar acesso)',
                    'admin-userform-emailverified', user.email_verified !== false);
            }
        }

        // Self-guard: an admin must NOT demote or deactivate their OWN account via this form (the
        // disabled "Desativar" button is otherwise trivially bypassed here → last-admin lockout).
        const isSelf = isEdit && user.id === sessionContext.userId;
        if (isSelf) {
            role.disabled = true;
            if (active) active.disabled = true;
            form.appendChild(hint('Você não pode alterar o próprio papel, a própria OM produtora ou o próprio status.'));
        }
        // DEPOIS da auto-guarda, de propósito: ela pode ter travado o papel, e o escopo de
        // produção segue o papel — deixá-lo editável enquanto o papel está travado ofereceria
        // ao administrador mudar a própria autorização pela porta ao lado.
        syncProducerField();

        const error = document.createElement('div');
        error.className = 'admin-form__error';
        error.dataset.testid = 'admin-userform-error';
        error.hidden = true;
        error.setAttribute('role', 'alert');
        form.appendChild(error);

        const actions = document.createElement('div');
        actions.className = 'admin-form__actions';
        const cancelBtn = button('Cancelar', 'admin-btn admin-btn--ghost', 'admin-userform-cancel',
            () => this._renderList());
        const saveBtn = button(isEdit ? 'Salvar' : 'Criar', 'admin-btn admin-btn--primary',
            'admin-userform-save', null);
        saveBtn.type = 'submit';
        actions.appendChild(cancelBtn);
        actions.appendChild(saveBtn);
        form.appendChild(actions);

        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            error.hidden = true;
            const ehProdutor = role.value === PRODUCER_ROLE;
            const payload = {
                nome: nome.value.trim(),
                username: username.value.trim(),
                rank_id: posto.value,
                organization_id: om.value,
                role: role.value,
                org_role: orgRole.value,
                // O PAR VIAJA SEMPRE COERENTE, e o `null` do rebaixamento é tão obrigatório
                // quanto o id da promoção: deixar o escopo pendurado ao trocar o papel viola o
                // bicondicional do banco e reprova o PUT inteiro, não só o campo.
                producer_org_id: ehProdutor ? producerOm.value : null,
            };
            if (!payload.nome || !payload.username) {
                showFormError(error, 'Preencha nome e usuário.');
                return;
            }
            // Cobrado aqui para que o erro chegue com o nome do campo em pt-BR. Sem isto, o
            // usuário recebe o 400 do CHECK do banco, que fala de constraint e não diz o que fazer.
            if (ehProdutor && !payload.producer_org_id) {
                showFormError(error, 'Escolha a OM que este produtor mantém.');
                return;
            }
            saveBtn.disabled = true;
            try {
                if (isEdit) {
                    // Only the inactive→active transition travels: the backend refuses the reverse
                    // one, and resending `false` for an already-inactive user is a no-op edit.
                    if (user.is_active === false && active.checked) payload.is_active = true;
                    if (emailVerified) payload.email_verified = emailVerified.checked;
                    await apiClient.updateUser(user.id, payload);
                    showSuccess('Usuário atualizado.');
                } else {
                    payload.password = password.value;
                    if (!payload.password) {
                        showFormError(error, 'Informe uma senha.');
                        saveBtn.disabled = false;
                        return;
                    }
                    await apiClient.createUser(payload);
                    showSuccess('Usuário criado.');
                }
                if (this._alive) this._renderList();
            } catch (err) {
                showFormError(error, err?.message || 'Falha ao salvar o usuário.');
                saveBtn.disabled = false;
            }
        });

        c.appendChild(form);
    }

    // ----- reset password -----

    /**
     * @private
     * @param {Object} user
     */
    _renderPasswordForm(user) {
        const c = this._container;
        c.replaceChildren();

        const form = document.createElement('form');
        form.className = 'admin-form';
        form.dataset.testid = 'admin-password-form';

        const heading = document.createElement('h3');
        heading.className = 'admin-form__heading';
        heading.textContent = `Redefinir senha: ${user.username}`;
        form.appendChild(heading);

        const pw = textField(form, 'Nova senha', 'admin-pwform-new', '', 'password');
        const pwConfirm = textField(form, 'Confirmar nova senha', 'admin-pwform-confirm', '', 'password');

        const error = document.createElement('div');
        error.className = 'admin-form__error';
        error.dataset.testid = 'admin-pwform-error';
        error.hidden = true;
        error.setAttribute('role', 'alert');
        form.appendChild(error);

        const actions = document.createElement('div');
        actions.className = 'admin-form__actions';
        actions.appendChild(button('Cancelar', 'admin-btn admin-btn--ghost', 'admin-pwform-cancel',
            () => this._renderList()));
        const saveBtn = button('Redefinir', 'admin-btn admin-btn--primary', 'admin-pwform-save', null);
        saveBtn.type = 'submit';
        actions.appendChild(saveBtn);
        form.appendChild(actions);

        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            error.hidden = true;
            if (!pw.value) {
                showFormError(error, 'Informe a nova senha.');
                return;
            }
            if (pw.value !== pwConfirm.value) {
                showFormError(error, 'As senhas não coincidem.');
                return;
            }
            saveBtn.disabled = true;
            try {
                await apiClient.resetUserPassword(user.id, pw.value);
                showSuccess('Senha redefinida.');
                if (this._alive) this._renderList();
            } catch (err) {
                showFormError(error, err?.message || 'Falha ao redefinir a senha.');
                saveBtn.disabled = false;
            }
        });

        c.appendChild(form);
    }

    // ----- deactivate / reactivate -----

    /**
     * @private
     * @param {Object} user
     */
    async _deactivate(user) {
        const ok = await showConfirm(
            `Desativar o usuário "${user.username}"? Ele não poderá mais entrar.`,
            { destructive: true, confirmText: 'Desativar' }
        );
        if (!ok) return;
        try {
            await apiClient.deactivateUser(user.id);
            showSuccess('Usuário desativado.');
            if (this._alive) this._renderList();
        } catch (err) {
            // Owns atlases → backend conflict (409). Collect a new owner and retry.
            if (err?.status === 409 || err?.code === 'CONFLICT') {
                this._renderTransfer(user);
                return;
            }
            showError(err?.message || 'Falha ao desativar o usuário.');
        }
    }

    /**
     * @private
     * @param {Object} user
     */
    async _reactivate(user) {
        try {
            await apiClient.reactivateUser(user.id);
            showSuccess('Usuário reativado.');
            if (this._alive) this._renderList();
        } catch (err) {
            showError(err?.message || 'Falha ao reativar o usuário.');
        }
    }

    /**
     * Transfer-ownership step shown when deactivation is blocked because the user owns atlases.
     * @private
     * @param {Object} user
     */
    _renderTransfer(user) {
        const c = this._container;
        c.replaceChildren();

        const wrap = document.createElement('div');
        wrap.className = 'admin-form';
        wrap.dataset.testid = 'admin-transfer-form';

        const heading = document.createElement('h3');
        heading.className = 'admin-form__heading';
        heading.textContent = `Transferir atlas de "${user.username}" antes de desativar`;
        wrap.appendChild(heading);

        const hint = document.createElement('p');
        hint.className = 'admin-form__hint';
        hint.textContent = 'Este usuário é dono de um ou mais atlas. Escolha quem assumirá a propriedade.';
        wrap.appendChild(hint);

        const search = textField(wrap, 'Buscar novo dono (nome ou usuário)', 'admin-transfer-search', '');
        const results = document.createElement('div');
        results.className = 'admin-transfer__results';
        results.dataset.testid = 'admin-transfer-results';
        wrap.appendChild(results);

        let selectedId = null;
        const error = document.createElement('div');
        error.className = 'admin-form__error';
        error.hidden = true;
        wrap.appendChild(error);

        const actions = document.createElement('div');
        actions.className = 'admin-form__actions';
        actions.appendChild(button('Cancelar', 'admin-btn admin-btn--ghost', 'admin-transfer-cancel',
            () => this._renderList()));
        const confirmBtn = button('Transferir e desativar', 'admin-btn admin-btn--danger',
            'admin-transfer-confirm', async () => {
                if (!selectedId) {
                    showFormError(error, 'Selecione o novo dono.');
                    return;
                }
                confirmBtn.disabled = true;
                try {
                    await apiClient.deactivateUser(user.id, { transferTo: selectedId });
                    showSuccess('Atlas transferido e usuário desativado.');
                    if (this._alive) this._renderList();
                } catch (err) {
                    showFormError(error, err?.message || 'Falha ao transferir/desativar.');
                    confirmBtn.disabled = false;
                }
            });
        actions.appendChild(confirmBtn);
        wrap.appendChild(actions);

        // The debounce timer is tracked on the instance so the tab's mount cleanup can clear it (a
        // stray fire post-teardown would issue an authenticated search after the panel is gone).
        search.addEventListener('input', () => {
            clearTimeout(this._searchTimer);
            const q = search.value.trim();
            if (q.length < 2) { results.replaceChildren(); return; }
            this._searchTimer = setTimeout(async () => {
                let found;
                try {
                    found = await apiClient.searchUsers(q);
                } catch {
                    return;
                }
                if (!this._alive) return;
                results.replaceChildren();
                for (const candidate of (found || [])) {
                    if (candidate.id === user.id) continue; // can't transfer to the same user
                    const row = document.createElement('label');
                    row.className = 'admin-transfer__option';
                    const radio = document.createElement('input');
                    radio.type = 'radio';
                    radio.name = 'admin-transfer-target';
                    radio.value = candidate.id;
                    radio.addEventListener('change', () => { selectedId = candidate.id; });
                    row.appendChild(radio);
                    const text = document.createElement('span');
                    text.textContent = `${candidate.nome} (${candidate.username})`;
                    row.appendChild(text);
                    results.appendChild(row);
                }
            }, 250);
        });

        c.appendChild(wrap);
    }
}

// ===== small DOM builders =====

/**
 * Um parágrafo de ajuda do formulário. Devolvido em vez de anexado, para que o chamador
 * decida a posição (e possa escondê-lo junto com o campo que ele explica).
 * @param {string} text
 * @returns {HTMLParagraphElement}
 */
function hint(text) {
    const p = document.createElement('p');
    p.className = 'admin-form__hint';
    p.textContent = text;
    return p;
}

/** @param {string} text @returns {HTMLTableCellElement} */
function cell(text) {
    const td = document.createElement('td');
    td.textContent = text;
    return td;
}

/**
 * @param {string} label @param {string} className @param {string} testid
 * @param {?Function} onClick @returns {HTMLButtonElement}
 */
function button(label, className, testid, onClick) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = className;
    btn.dataset.testid = testid;
    btn.textContent = label;
    if (onClick) btn.addEventListener('click', onClick);
    return btn;
}

/**
 * Adds a labelled text input to a form.
 * @returns {HTMLInputElement}
 */
function textField(form, label, testid, value, type = 'text') {
    const field = document.createElement('div');
    field.className = 'admin-form__field';
    const lab = document.createElement('label');
    lab.textContent = label;
    lab.setAttribute('for', testid);
    field.appendChild(lab);
    const input = document.createElement('input');
    input.type = type;
    input.id = testid;
    input.dataset.testid = testid;
    input.value = value;
    field.appendChild(input);
    form.appendChild(field);
    return input;
}

/**
 * Adds a labelled select to a form.
 * @returns {HTMLSelectElement}
 */
function selectField(form, label, testid, options, value) {
    const field = document.createElement('div');
    field.className = 'admin-form__field';
    const lab = document.createElement('label');
    lab.textContent = label;
    lab.setAttribute('for', testid);
    field.appendChild(lab);
    const select = document.createElement('select');
    select.id = testid;
    select.dataset.testid = testid;
    for (const opt of options) {
        const o = document.createElement('option');
        o.value = opt.value;
        o.textContent = opt.label;
        select.appendChild(o);
    }
    select.value = value;
    field.appendChild(select);
    form.appendChild(field);
    return select;
}

/**
 * Adds a labelled checkbox to a form.
 * @returns {HTMLInputElement}
 */
function checkboxField(form, label, testid, checked) {
    const field = document.createElement('label');
    field.className = 'admin-form__field admin-form__field--checkbox';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.id = testid;
    input.dataset.testid = testid;
    input.checked = checked;
    field.appendChild(input);
    field.appendChild(document.createTextNode(label));
    form.appendChild(field);
    return input;
}

/** @param {HTMLElement} el @param {string} msg */
function showFormError(el, msg) {
    el.textContent = msg;
    el.hidden = false;
}
