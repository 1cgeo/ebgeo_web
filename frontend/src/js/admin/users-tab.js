// Path: js/admin/users-tab.js

/**
 * @fileoverview "Usuários" tab of the admin panel. Lists users and drives the admin
 * CRUD (create / edit / reset password / deactivate+reactivate) against the existing
 * `/api/v1/users` admin routes (requireAdmin server-side). Deactivating a user who
 * owns atlases requires reassigning ownership — the backend returns a conflict and
 * this tab collects the new owner via the user search before retrying.
 *
 * UMA EDIÇÃO DESTA ABA É DESTRUTIVA, e não parece: trocar o papel global ou a OM produtora
 * revoga TODA concessão viva que a pessoa deu. O aviso antes e o relato depois vivem em
 * `producer-scope-phrases.js`, que é onde está escrito por que a prévia não é um endpoint
 * e onde o espelho da regra do servidor é declarado.
 *
 * All dynamic text is set via textContent (never innerHTML with user data).
 */

import { apiClient } from '@store/sync/api-client.js';
import { sessionContext } from '@store/sync/session-context.js';
import { showConfirm } from '@modals/confirm.modal.js';
import { showSuccess, showError } from '@utils/toast_service.js';
import config from '@js/config.js';
import { sectionHeader, card, avatar, emptyState, ICON_USERS, failureState } from './admin-dom.js';
import { orgLabel, buildDomainOptions } from './org-options.js';
import {
    verdictOfChange,
    producerScopeChangeTitle,
    producerScopeChangeWarning,
    producerScopeChangeConfirmLabel,
    producerScopeChangeSummary,
} from './producer-scope-phrases.js';
// Módulo folha, zero imports, como o irmão acima. Ver o `fileoverview` dele: a desativação
// poda um SUPERCONJUNTO do que a troca de papel poda, e era a que menos falava.
import {
    deactivationWarning, deactivationConfirmLabel, deactivationSummary, reactivationNotice,
} from './user-deactivation-phrases.js';
import { GLOBAL_ROLE_LABELS } from '@ui/role-labels.js';

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
 * novo, e foi o que já aconteceu uma vez.
 *
 * DERIVADO, nunca escrito à mão: o rótulo pt-BR de cada papel nasce em `@ui/role-labels.js`,
 * que é a fonte única desde que o próprio usuário passou a ver o seu papel no menu da conta e
 * na barra superior. Enquanto as duas listas eram literais gêmeos, "as duas telas chamam a
 * mesma pessoa por dois nomes" era um estado alcançável, prendido só por teste; agora é
 * impossível por construção. A `variante` continua daqui porque é nome de classe CSS desta
 * aba, e ela coincide com a chave do papel por escolha do CSS, não por acaso do rótulo.
 * @type {Object<string, {rotulo: string, variante: string}>}
 */
const ROLE_CHIP = Object.freeze(
    Object.fromEntries(
        Object.entries(GLOBAL_ROLE_LABELS).map(([papel, rotulo]) => [
            papel,
            { rotulo, variante: papel },
        ])
    )
);

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
            // A SAÍDA que faltava. Ver `failureState` em `admin-dom.js`: falha de carregamento era
            // beco sem saída nas seis abas, e o único caminho era recarregar a página.
            loading.replaceChildren(failureState('Falha ao carregar usuários.', {
                onRetry: () => { if (this._alive) this._renderList(); },
            }));
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
                // O ENDEREÇO, que até agora era lido só como PREDICADO. O administrador aprovava
                // um e-mail que a tabela não lhe mostrava em lugar nenhum: `u.email` chegava na
                // listagem e a única coisa que se fazia com ele era decidir se o selo aparece.
                // Aprovar às cegas é o que a cláusula 10.6 depende para não ser aprovada errada.
                pending.title = `E-mail aguardando confirmação: ${u.email}`;
                statusCell.appendChild(pending);
            }
            tr.appendChild(statusCell);

            const actions = document.createElement('td');
            actions.className = 'admin-users__actions';
            actions.appendChild(button('Editar', 'admin-btn admin-btn--ghost admin-btn--sm', 'admin-user-edit',
                () => this._renderForm(u)));
            actions.appendChild(button('Senha', 'admin-btn admin-btn--ghost admin-btn--sm', 'admin-user-password',
                () => this._renderPasswordForm(u)));
            // APROVAR NA LINHA, e não escondido no fim do formulário de edição. A conta pendente é
            // a única que o desbloqueio da cláusula 10.6 alcança, e até agora aprová-la exigia
            // abrir Editar, rolar até o fim e marcar uma caixa que só é montada quando a conta já
            // tem endereço. A ação aparece SÓ na linha pendente, que é o que a torna uma ação e
            // não mais um campo.
            if (u.email && u.email_verified === false) {
                actions.appendChild(button('Aprovar', 'admin-btn admin-btn--ghost admin-btn--sm',
                    'admin-user-approve', () => this._approve(u)));
            }
            // REVOGAR A CHAVE DE OUTRA PESSOA. A rota existe desde sempre
            // (`POST /users/:userId/api-key/rotate`, com `requireAdmin`) e o método do cliente
            // também (`apiClient.rotateUserApiKey`), com ZERO chamadores: a única forma de cortar
            // uma chave comprometida alheia era SQL no banco. Rotacionar É revogar: a chave antiga
            // deixa de autenticar no instante em que a nova é gravada.
            actions.appendChild(button('Revogar chave', 'admin-btn admin-btn--ghost admin-btn--sm',
                'admin-user-revoke-key', () => this._revokeApiKey(u)));
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
        // O CAMPO QUE FALTAVA, e a falta tinha efeito exato: a tela oferecia APROVAR o endereço
        // (a caixa "E-mail verificado", abaixo) e não oferecia CORRIGI-LO, então diante de um
        // cadastro com o endereço errado a única ação disponível era declarar verdadeiro o que
        // estava errado. A capacidade já existia na API desde 2026-08-20
        // (`updateUserAdminSchema` aceita `email`, e `resolveAdminEmail` derruba a confirmação
        // quando o endereço muda); o que não existia era a porta.
        //
        // Só na EDIÇÃO: `POST /users` não tem campo de e-mail, e a conta que ele cria entra
        // logando na hora, de propósito.
        const email = isEdit
            ? textField(form, 'E-mail', 'admin-userform-email', user?.email || '', 'email')
            : null;
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

        // O CAMPO "Papel na OM (hierarquia interna)" SAIU daqui em 2026-08-20 (D7), com o eixo
        // inteiro. Ele já não autorizava nada no servidor (a escrita de projeto 360 tinha
        // passado para o eixo de produção acima), e o efeito que restava era o pior possível:
        // o valor escolhido aqui virava o papel POR ATLAS na hidratação da sessão, então
        // marcar "Administrador da OM" desenhava a interface de Administrador de atlas para
        // quem não tinha permissão em atlas nenhum. Formulário que promete o que o servidor
        // recusa é pior que campo ausente. Não reintroduza este seletor: o que autoriza está
        // acima, no par Papel + OM produtora.

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
                    // SÓ VIAJA SE MUDOU. Reenviar o mesmo endereço faria `resolveAdminEmail`
                    // tratar a edição como troca e derrubar a confirmação de uma conta que
                    // ninguém quis mexer: salvar o posto apagaria o e-mail verificado.
                    const emailDigitado = email ? email.value.trim() : '';
                    if (email && emailDigitado !== (user.email || '')) {
                        payload.email = emailDigitado;
                    }
                    if (emailVerified) payload.email_verified = emailVerified.checked;

                    // ESTE SALVAMENTO PODE DESTRUIR ACESSO, e até 2026-08-23 a tela não dizia
                    // nada. Trocar o papel global, ou a OM produtora, apaga o FUNDAMENTO das
                    // concessões que a pessoa deu, e o servidor revoga TODAS elas com a
                    // subárvore (`fundamentoDeRaizPerdido` + `podarPorRaizes`, origem
                    // `USER_DEMOTION`). O gesto que mais surpreende é o segundo: a poda dispara
                    // na simples desigualdade `omAntes !== omDepois`, então corrigir um erro de
                    // digitação na OM de um produtor derrubava tudo o que ele havia concedido.
                    //
                    // O NÚMERO VEM DA LISTAGEM (`live_grant_count`), como o do irmão que apaga
                    // um grupo vem de `grant_count`. Ele é um retrato e pode ter envelhecido;
                    // quem diz o que de fato caiu é a resposta do PUT, logo abaixo.
                    const motivo = verdictOfChange(user, payload);
                    if (motivo) {
                        const ok = await showConfirm(
                            producerScopeChangeTitle({ motivo, username: user.username }),
                            {
                                message: producerScopeChangeWarning({
                                    motivo, liveGrants: user.live_grant_count,
                                }),
                                destructive: true,
                                confirmText: producerScopeChangeConfirmLabel(user.live_grant_count),
                                cancelText: 'Manter',
                            },
                        );
                        if (!ok) {
                            saveBtn.disabled = false;
                            return;
                        }
                    }

                    // O TOAST RELATA O EFEITO MEDIDO. `grantsAffected`/`grantsReparented` vêm no
                    // mesmo objeto da linha atualizada e valem zero quando nada foi podado, e é
                    // aí que a frase volta a ser o "Usuário atualizado." de sempre.
                    const result = await apiClient.updateUser(user.id, payload);
                    showSuccess(producerScopeChangeSummary(result));
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
        // O AVISO USA O NÚMERO QUE A LISTAGEM JÁ TROUXE. `live_grant_count` vem por linha nas duas
        // consultas de usuário, e este arquivo já o lia — mas SÓ no ramo da troca de papel, que
        // poda um subconjunto do que este ato poda. O campo estava aqui o tempo todo.
        const ok = await showConfirm(`Desativar "${user.username}"?`, {
            message: deactivationWarning({
                username: user.username,
                liveGrants: user.live_grant_count,
                // A tela ainda não sabe se ele tem atlas: o servidor responde 409 e o fluxo cai em
                // `_renderTransfer`. Aqui a frase fala só do que é certo.
                hasAtlas: false,
            }),
            destructive: true,
            confirmText: deactivationConfirmLabel(user.live_grant_count),
        });
        if (!ok) return;
        try {
            // O RETORNO DEIXOU DE SER DESCARTADO. Ele carrega `atlasTransferred`,
            // `grantsRevoked` e `grantsReparented`, e até agora os três só eram legíveis DEPOIS,
            // na aba de Auditoria, que é onde ninguém está no momento do ato.
            const resultado = await apiClient.deactivateUser(user.id);
            showSuccess(deactivationSummary(resultado));
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
     * Aprova o e-mail de uma conta pendente, direto da linha.
     *
     * O ENDEREÇO VAI NA CONFIRMAÇÃO, e é o ponto inteiro desta ação: aprovar é declarar VERDADEIRO
     * um endereço que ninguém confirmou, então a única coisa que separa a aprovação certa da
     * errada é o administrador LER o endereço antes. A tela oferecia aprovar e não oferecia ler.
     * @private
     * @param {Object} user
     * @returns {Promise<void>}
     */
    async _approve(user) {
        const ok = await showConfirm(`Aprovar o acesso de "${user.username}"?`, {
            message: `Isto declara confirmado o endereço ${user.email} sem que a pessoa tenha `
                + 'clicado no link de confirmação, e libera a entrada dela. Se o endereço estiver '
                + 'errado, corrija-o em Editar antes de aprovar: aprovar o endereço errado entrega '
                + 'a conta a quem controla aquela caixa.',
            confirmText: 'Aprovar',
        });
        if (!ok) return;
        try {
            await apiClient.updateUser(user.id, { email_verified: true });
            showSuccess('Acesso aprovado.');
            if (this._alive) this._renderList();
        } catch (err) {
            showError(err?.message || 'Falha ao aprovar o acesso.');
        }
    }

    /**
     * Rotaciona (e portanto revoga) a chave de API de outra pessoa.
     *
     * NÃO MOSTRA A CHAVE NOVA, e a omissão é a decisão: quem revoga uma chave comprometida está
     * cortando acesso, não emitindo credencial para si. A chave nova pertence ao dono da conta, e
     * ele a lê em "Minha conta", onde a revelação já tem o cuidado todo (uma vez só, com guarda ao
     * fechar sem copiar). Mostrá-la aqui entregaria ao administrador uma credencial alheia viva.
     * @private
     * @param {Object} user
     * @returns {Promise<void>}
     */
    async _revokeApiKey(user) {
        const ok = await showConfirm(`Revogar a chave de API de "${user.username}"?`, {
            message: 'A chave atual deixa de autenticar imediatamente, e toda integração que a '
                + 'use para de funcionar. Uma chave nova é gerada no lugar, e só a própria pessoa '
                + 'consegue lê-la, em "Minha conta". Isto não se desfaz: a chave antiga não volta.',
            destructive: true,
            confirmText: 'Revogar',
        });
        if (!ok) return;
        try {
            await apiClient.rotateUserApiKey(user.id);
            showSuccess('Chave de API revogada. A pessoa precisa pegar a nova em "Minha conta".');
        } catch (err) {
            showError(err?.message || 'Falha ao revogar a chave de API.');
        }
    }

    /**
     * @private
     * @param {Object} user
     */
    async _reactivate(user) {
        // PERGUNTA, e a pergunta é sobre o que a reativação NÃO faz. O botão nasce no mesmo lugar
        // em que estava "Desativar", e essa simetria visual afirma uma simetria de efeito que não
        // existe: `reactivateUser` é uma consulta mais uma linha de trilha, então as concessões
        // podadas continuam revogadas e as sessões continuam mortas. Sem esta tela, quem reativa
        // conclui que desfez o ato e descobre o contrário pela reclamação de terceiros.
        const ok = await showConfirm(`Reativar "${user.username}"?`, {
            message: reactivationNotice(),
            confirmText: 'Reativar',
        });
        if (!ok) return;
        try {
            await apiClient.reactivateUser(user.id);
            showSuccess('Usuário reativado. As concessões derrubadas não voltaram.');
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
                    // A SEGUNDA SAÍDA, que descartava o retorno pela mesma razão que a primeira.
                    const resultado = await apiClient.deactivateUser(user.id, { transferTo: selectedId });
                    showSuccess(deactivationSummary(resultado));
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
