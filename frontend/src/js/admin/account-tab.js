// Path: js/admin/account-tab.js

/**
 * @fileoverview Aba "Minha conta" — onde o titular lê o próprio registro, edita o que lhe cabe
 * editar, troca a própria senha e pede a troca do próprio e-mail.
 *
 * ELA ERA UM MODAL ATÉ 2026-08-25 (`modals/account-settings.modal.js`, apagado nesta mesma
 * mudança), e virou aba por decisão do chefe. O que ela ganha com isso é ENDEREÇO: a tela tinha
 * duas portas (a barra do topo e o menu do avatar do mapa) e nenhuma URL, então não havia como
 * mandar alguém para ela. Hoje ela é `admin.html?aba=account`, e as duas portas antigas navegam
 * para lá.
 *
 * A ABA VALE PARA AS TRÊS AUDIÊNCIAS da porta (`admin-audience.js`), e é a segunda universal,
 * ao lado de "Concessões". O critério é trivial e é por isso que ele é seguro: quem entrou tem
 * conta. Ela é a ÚLTIMA de cada lista porque a primeira aba é a que o painel abre, e ninguém
 * abre o painel para ler o próprio nome.
 *
 * A CHAVE DE API SAIU DA TELA na mesma data, por decisão do chefe: ela é credencial INTERNA, que
 * o sistema gerencia para a subrequisição do nginx (cláusula 10.7 de `CONSTITUICAO.md`), e o
 * usuário final não a vê nem a gerencia. As rotas do servidor continuam de pé, porque a
 * integração máquina a máquina depende delas; o que saiu foi a superfície de tela.
 *
 * OS TRÊS FATOS EM QUE A TELA SE APOIA, todos medidos contra o servidor:
 *
 *   1. `PUT /users/me` ACEITA DOIS CAMPOS. `updateProfileSchema` é `{ nome, rank_id }` e mais
 *      nada. `organization_id` (a lotação) e `producer_org_id` (o escopo de produção) são
 *      recusados de propósito, e recusados EM SILÊNCIO: o `stripUnknown` os descarta e a rota
 *      responde 200 sem ter mudado nada. Por isso eles aparecem em SÓ LEITURA, com a nota
 *      dizendo quem os muda.
 *
 *   2. `GET /users/me` NÃO CARREGA O PAPEL GLOBAL. A consulta dela (`FIND_USER_BY_ID`,
 *      `backend/src/modules/users/users.queries.js`) seleciona as colunas de perfil mais `email`
 *      e `email_verified`, e NÃO `role` nem `producer_org_id`. Esses dois vêm de `GET /auth/me`,
 *      cuja consulta homônima mora em `backend/src/modules/auth/auth.queries.js`. Daí DUAS
 *      leituras na montagem. Não "simplifique" isto numa chamada só: o papel sumiria da tela.
 *
 *   3. TROCAR A SENHA ENCERRA TAMBÉM ESTA SESSÃO. `updatePassword`
 *      (`backend/src/modules/users/users.service.js`) roda `REVOKE_ALL_USER_TOKENS`, que revoga
 *      a família de refresh E carimba `users.sessions_valid_from`; a rota não devolve par novo de
 *      tokens. O aviso diz "inclusive esta", que é a verdade medida, e é mostrado ANTES do botão.
 *
 * E O E-MAIL É LIDO AQUI E TROCADO EM OUTRO LUGAR: `updateProfileSchema` não o aceita;
 * `PUT /users/me/email` aceita, pede a senha atual e responde com um CONVITE para a caixa nova,
 * nunca com uma conta trocada. Por isso o endereço fica no bloco de só leitura, com o estado de
 * confirmação escrito, e a troca tem seção própria que diz, antes do clique, que nada se move
 * até o link da outra caixa ser aberto.
 *
 * A metade pura (limites, frases, validação) está em `admin/account-model.js`, que tem ZERO
 * imports e é testada em node.
 */

import { apiClient } from '@store/sync/api-client.js';
import { showConfirm } from '@modals/confirm.modal.js';
import { showSuccess } from '@utils/toast_service.js';
// Do ARQUIVO, nunca dos barrels `@utils` / `@modals`: esta página não carrega a store, e os
// barrels a alcançam transitivamente.
import {
    setupCleanup,
    addScopedDomListener,
    clearScopedListeners,
    cleanup,
} from '@utils/event-cleanup.js';
import config from '@js/config.js';
// Import DIRETO por arquivo: `ui/role-labels.js` tem ZERO imports, e é essa propriedade que
// permite usá-lo daqui sem arrastar nada para `admin.html`, que boota sem a store.
import { globalRoleBadge, getGlobalRoleDescription } from '@js/ui/role-labels.js';
// Também zero imports, pela mesma razão.
import { emailRecoveryEnabled } from '@modals/password-recovery.model.js';
import { ICON_ACCOUNT } from './admin-dom.js';
import {
    ADMIN_ONLY_FIELDS_NOTE,
    EMAIL_CHANGE_PASSWORD_NOTE,
    EMAIL_CHANGE_SENT_TEXT,
    EMAIL_CHANGE_WARNING,
    EMAIL_RESEND_FAILED,
    EMAIL_RESEND_LABEL,
    EMAIL_RESEND_SENT,
    EMAIL_UNVERIFIED_HINT,
    MAX_EMAIL_LENGTH,
    MAX_NAME_LENGTH,
    PASSWORD_RULE_TEXT,
    PASSWORD_SESSION_WARNING,
    accountErrorMessage,
    emailPresentation,
    profilePatch,
    validateEmailChangeForm,
    validatePasswordForm,
    validateProfileDraft,
} from './account-model.js';

/** Escopo dos listeners do corpo, que é redesenhado inteiro a cada mudança de estado. */
const LISTENER_SCOPE = 'account-tab-body';

/**
 * Monta a definição da aba "Minha conta" para o painel.
 * @returns {import('./admin-panel.js').AdminTab}
 */
export function createAccountTab() {
    const tab = new AccountTab();
    return {
        id: 'account',
        label: 'Minha conta',
        testid: 'admin-tab-account',
        icon: ICON_ACCOUNT,
        mount: (container) => tab.mount(container),
    };
}

/**
 * @private Cria um elemento com classe e texto opcionais.
 * @param {string} tag
 * @param {string} [className]
 * @param {string} [text]
 * @returns {HTMLElement}
 */
function el(tag, className = '', text = '') {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
}

/**
 * @private A lista ativa de postos servida por `GET /api/config`, como opções de `<select>`.
 *
 * A lista vem do singleton de config (já hidratado quando o painel monta) em vez de `GET /ranks`,
 * que seria uma segunda ida à rede pelas mesmas linhas. `listPostos`
 * (`backend/src/modules/config/config.service.js`) já filtra `is_active = true` e ordena por
 * `sort_order`.
 * @returns {Array<{ value: string, label: string }>}
 */
function rankOptions() {
    const list = Array.isArray(config?.postos) ? config.postos : [];
    return list
        .filter((item) => item && item.id && item.name)
        .map((item) => ({ value: String(item.id), label: String(item.name) }));
}

/**
 * @private O nome de exibição de uma OM, pelo id, a partir do singleton de config.
 *
 * Devolve string vazia quando o id não está na lista, o que acontece com OM DESATIVADA
 * (`listOrganizacoesMilitares` serve só as ativas). Quem chama diz isso em palavras, em vez de
 * imprimir um uuid cru sobre o qual a pessoa não pode agir.
 * @param {*} orgId
 * @returns {string}
 */
function organizationName(orgId) {
    if (!orgId) return '';
    const list = Array.isArray(config?.organizacoesMilitares) ? config.organizacoesMilitares : [];
    const found = list.find((item) => item && String(item.id) === String(orgId));
    return found?.name ? String(found.name) : '';
}

class AccountTab {
    /**
     * @param {HTMLElement} container
     * @returns {Function} cleanup
     */
    mount(container) {
        this._container = container;
        this._alive = true;
        setupCleanup(this);

        /** @type {Object|null} O perfil como `GET /users/me` o devolveu por último. */
        this._profile = null;
        /** @type {Object|null} O documento de identidade de `GET /auth/me` (papel + escopo). */
        this._identity = null;
        this._loading = true;
        this._loadError = '';
        this._saving = false;
        this._profileError = '';

        this._changingEmail = false;
        this._emailError = '';
        this._emailDone = '';

        this._changingPassword = false;
        this._passwordError = '';
        this._passwordDone = '';

        this._render();
        this._load();

        return () => {
            this._alive = false;
            clearScopedListeners(this, LISTENER_SCOPE);
            cleanup(this);
        };
    }

    // ===== DADOS =====

    /**
     * @private Lê os DOIS documentos: o perfil editável e a identidade (papel + escopo).
     *
     * São rotas separadas com colunas diferentes; ver o `fileoverview`. `Promise.all` porque
     * nenhuma depende da outra, e a falha de qualquer uma é UMA falha da tela: mostrar meio
     * registro seria pior que dizer que a leitura falhou.
     */
    async _load() {
        this._loading = true;
        this._loadError = '';
        this._render();
        try {
            const [profile, identity] = await Promise.all([
                apiClient.getMyProfile(),
                apiClient.getMe(),
            ]);
            if (!this._alive) return;
            this._profile = profile || null;
            this._identity = identity || null;
            this._loading = false;
        } catch (error) {
            if (!this._alive) return;
            this._loading = false;
            this._loadError = accountErrorMessage(
                error,
                'Não foi possível ler os seus dados agora.'
            );
        }
        this._render();
    }

    /**
     * @private Salva a edição de perfil, mandando só o que mudou.
     */
    async _saveProfile() {
        if (!this._alive || this._saving) return;
        const root = this._container;

        const draft = {
            nome: root.querySelector('[data-field="nome"]')?.value ?? '',
            rank_id: root.querySelector('[data-field="rank"]')?.value ?? '',
        };

        const check = validateProfileDraft(draft);
        if (!check.valid) {
            this._profileError = check.message;
            this._render();
            return;
        }

        const patch = profilePatch(this._profile || {}, draft);
        if (!patch) {
            this._profileError = 'Nada mudou nos seus dados.';
            this._render();
            return;
        }

        this._saving = true;
        this._profileError = '';
        this._render();
        try {
            const updated = await apiClient.updateMyProfile(patch);
            if (!this._alive) return;
            this._profile = updated || this._profile;
            this._saving = false;
            this._render();
            showSuccess('Os seus dados foram atualizados.');
        } catch (error) {
            if (!this._alive) return;
            this._saving = false;
            this._profileError = accountErrorMessage(
                error,
                'Não foi possível salvar os seus dados.'
            );
            this._render();
        }
    }

    /**
     * @private Pede ao servidor que mude o e-mail da conta para outro endereço.
     *
     * NADA É RELIDO NO SUCESSO, e isso não é descuido: a conta continua com o endereço velho,
     * porque a rota só cunha um convite. Reler o perfil aqui redesenharia exatamente a mesma
     * linha e sugeriria que alguma coisa aconteceu.
     */
    async _changeEmail() {
        if (!this._alive || this._changingEmail) return;
        const root = this._container;

        const form = {
            email: root.querySelector('[data-field="email-novo"]')?.value ?? '',
            currentPassword: root.querySelector('[data-field="email-senha"]')?.value ?? '',
            currentEmail: this._profile?.email ?? '',
        };

        const check = validateEmailChangeForm(form);
        if (!check.valid) {
            this._emailError = check.message;
            this._emailDone = '';
            this._render();
            return;
        }

        this._changingEmail = true;
        this._emailError = '';
        this._emailDone = '';
        this._render();
        try {
            await apiClient.requestEmailChange(form.email, form.currentPassword);
            if (!this._alive) return;
            this._changingEmail = false;
            this._emailDone = EMAIL_CHANGE_SENT_TEXT;
            this._render();
            showSuccess('Pedido registrado. Confirme pelo link enviado ao endereço novo.');
        } catch (error) {
            if (!this._alive) return;
            this._changingEmail = false;
            this._emailError = accountErrorMessage(
                error,
                'Não foi possível pedir a troca de e-mail.'
            );
            this._render();
        }
    }

    /**
     * @private Troca a senha, depois de uma confirmação que nomeia a consequência.
     */
    async _changePassword() {
        if (!this._alive || this._changingPassword) return;
        const root = this._container;

        const form = {
            currentPassword: root.querySelector('[data-field="senha-atual"]')?.value ?? '',
            newPassword: root.querySelector('[data-field="senha-nova"]')?.value ?? '',
            confirmPassword: root.querySelector('[data-field="senha-confirma"]')?.value ?? '',
        };

        const check = validatePasswordForm(form);
        if (!check.valid) {
            this._passwordError = check.message;
            this._passwordDone = '';
            this._render();
            return;
        }

        const confirmed = await showConfirm('Trocar a senha e encerrar as sessões?', {
            message: PASSWORD_SESSION_WARNING,
            confirmText: 'Trocar a senha',
            cancelText: 'Cancelar',
            destructive: true,
        });
        if (!confirmed || !this._alive) return;

        this._changingPassword = true;
        this._passwordError = '';
        this._passwordDone = '';
        this._render();
        try {
            await apiClient.updateMyPassword(form.currentPassword, form.newPassword);
            if (!this._alive) return;
            this._changingPassword = false;
            this._passwordDone = 'Senha trocada. Todas as sessões desta conta foram encerradas, '
                + 'inclusive esta: entre de novo com a senha nova.';
            this._render();
            showSuccess('Senha trocada. Entre de novo com a senha nova.');
        } catch (error) {
            if (!this._alive) return;
            this._changingPassword = false;
            this._passwordError = accountErrorMessage(
                error,
                'Não foi possível trocar a senha.'
            );
            this._render();
        }
    }

    // ===== DESENHO =====

    /**
     * @private Redesenha o corpo inteiro a partir do estado.
     */
    _render() {
        if (!this._alive || !this._container) return;
        clearScopedListeners(this, LISTENER_SCOPE);
        this._container.replaceChildren();

        const root = el('div', 'account-settings');
        root.dataset.testid = 'admin-account';
        root.appendChild(this._renderProfileSection());
        // A seção de e-mail vem ANTES da de senha porque ela é o canal de recuperação da senha:
        // quem não consegue entrar lê esta tela de cima para baixo, e o endereço é o que precisa
        // acertar primeiro.
        //
        // SÓ ONDE O SERVIDOR CONSEGUE ENTREGAR. `PUT /users/me/email` é montada sob
        // `canDeliverAccountMail()`, como as rotas de recuperação, e oferecer a seção onde ela não
        // existe entregaria um 404 depois de a pessoa digitar o endereço novo e a senha atual.
        //
        // A BANDEIRA TEM NOME MAIS ESTREITO QUE O SIGNIFICADO: `features.password_reset_email` É o
        // predicado de entrega (`canDeliverAccountMail()` em `config.service.js`), e não uma
        // decisão só sobre senha. Ela é reusada aqui de propósito, para o fato não passar a viver
        // em dois lugares; no dia em que o servidor gatear as duas coisas por predicados
        // diferentes, este ponto precisa de bandeira própria.
        if (emailRecoveryEnabled(config)) {
            root.appendChild(this._renderEmailSection());
        }
        root.appendChild(this._renderPasswordSection());
        this._container.appendChild(root);
    }

    /**
     * @private Cabeçalho de seção.
     *
     * DELIBERADAMENTE NÃO É `sectionHeader` de `admin-dom.js`: as três seções desta aba são um
     * FORMULÁRIO empilhado com o seu próprio bloco BEM (`account-settings__*`, em
     * `css/account-settings.css`), e não cartões de listagem. Misturar as duas famílias deixaria
     * metade da tela com a tipografia de uma e metade com a da outra.
     * @param {string} titulo
     * @param {string} descricao
     * @returns {HTMLElement}
     */
    _sectionHeader(titulo, descricao) {
        const wrap = el('div', 'account-settings__section-header');
        wrap.appendChild(el('h3', 'account-settings__section-title', titulo));
        if (descricao) {
            wrap.appendChild(el('p', 'account-settings__section-hint', descricao));
        }
        return wrap;
    }

    /**
     * @private Uma linha "rótulo: valor" de só leitura.
     * @param {string} rotulo
     * @param {string} valor
     * @param {string} [nota]
     * @returns {HTMLElement}
     */
    _readonlyRow(rotulo, valor, nota = '') {
        const row = el('div', 'account-settings__readonly-row');
        row.appendChild(el('span', 'account-settings__readonly-label', rotulo));
        row.appendChild(el('span', 'account-settings__readonly-value', valor));
        if (nota) {
            row.appendChild(el('span', 'account-settings__readonly-note', nota));
        }
        return row;
    }

    /**
     * @private Um campo de texto ou de senha, com rótulo.
     * @param {{ field: string, label: string, type?: string, value?: string,
     *   autocomplete?: string, maxLength?: number }} spec
     * @returns {HTMLElement}
     */
    _inputField(spec) {
        const field = el('div', 'account-settings__field');
        const id = `account-settings-${spec.field}`;
        const label = el('label', 'account-settings__label', spec.label);
        label.setAttribute('for', id);
        field.appendChild(label);

        const input = document.createElement('input');
        input.className = 'account-settings__input';
        input.id = id;
        input.type = spec.type || 'text';
        input.value = spec.value || '';
        input.dataset.field = spec.field;
        input.dataset.testid = id;
        if (spec.autocomplete) input.autocomplete = spec.autocomplete;
        if (spec.maxLength) input.maxLength = spec.maxLength;
        field.appendChild(input);
        return field;
    }

    /**
     * @private Um botão que carrega a ação da seção.
     * @param {{ label: string, variant?: string, disabled?: boolean, testid?: string,
     *   onClick: () => void }} spec
     * @returns {HTMLElement}
     */
    _actionButton(spec) {
        const button = el(
            'button',
            `account-settings__btn account-settings__btn--${spec.variant || 'primary'}`,
            spec.label,
        );
        button.type = 'button';
        if (spec.testid) button.dataset.testid = spec.testid;
        if (spec.disabled) button.disabled = true;
        else addScopedDomListener(this, LISTENER_SCOPE, button, 'click', spec.onClick);
        return button;
    }

    /**
     * @private Uma caixa de aviso. É caixa, e não frase no fluxo, porque ela tem de ser VISTA
     * antes do clique e não lida por cima.
     * @param {string} texto
     * @returns {HTMLElement}
     */
    _warningBox(texto) {
        const box = el('div', 'account-settings__warning');
        box.setAttribute('role', 'note');
        box.appendChild(el('span', 'account-settings__warning-mark', '!'));
        box.appendChild(el('p', 'account-settings__warning-text', texto));
        return box;
    }

    /**
     * @private Uma mensagem de falha em linha. Falha NUNCA se parece com lista vazia: ela tem
     * classe própria, cor própria e `role="alert"`.
     * @param {string} texto
     * @returns {HTMLElement}
     */
    _errorBox(texto) {
        const box = el('div', 'account-settings__state account-settings__state--error', texto);
        box.setAttribute('role', 'alert');
        return box;
    }

    /**
     * @private "Meus dados": o que a pessoa pode editar, mais o que só um administrador muda.
     * @returns {HTMLElement}
     */
    _renderProfileSection() {
        const section = el('section', 'account-settings__section');
        section.dataset.section = 'perfil';
        section.appendChild(this._sectionHeader(
            'Meus dados',
            'O que esta conta guarda sobre você, e o que você mesmo pode mudar.'
        ));

        if (this._loading) {
            section.appendChild(el(
                'div',
                'account-settings__state account-settings__state--loading',
                'Carregando os seus dados...'
            ));
            return section;
        }

        if (this._loadError) {
            section.appendChild(this._errorBox(this._loadError));
            section.appendChild(this._actionButton({
                label: 'Tentar de novo',
                variant: 'ghost',
                testid: 'account-settings-retry',
                onClick: () => this._load(),
            }));
            return section;
        }

        const profile = this._profile || {};
        const identity = this._identity || {};

        const readonly = el('div', 'account-settings__readonly');
        readonly.appendChild(this._readonlyRow('Usuário', profile.username || 'não informado'));

        const badge = globalRoleBadge(identity.role, {
            orgName: organizationName(identity.producer_org_id),
        });
        if (badge) {
            readonly.appendChild(this._readonlyRow(
                'Papel no sistema',
                badge.label,
                getGlobalRoleDescription(identity.role)
            ));
        } else {
            readonly.appendChild(this._readonlyRow(
                'Papel no sistema',
                'não informado pelo servidor'
            ));
        }

        // O ENDEREÇO E O ESTADO DELE, no bloco de só leitura e não no formulário abaixo, porque
        // ele não é editável AQUI: ele se move por `PUT /users/me/email`, que pede a senha e
        // reverifica. O estado é escrito por extenso em vez de insinuado por uma cor, e "não
        // confirmado" é exatamente o fato que era invisível para a única pessoa capaz de ver o
        // erro de digitação.
        const email = emailPresentation(profile);
        readonly.appendChild(this._readonlyRow(
            'E-mail',
            email.state === 'absent' ? email.status : `${email.address} (${email.status})`,
            email.state === 'unverified' ? EMAIL_UNVERIFIED_HINT : ''
        ));

        // O BOTÃO QUE A FRASE ACIMA PEDIA AO ADMINISTRADOR. A rota é anônima e está sempre
        // montada, então o caminho pelo administrador era trabalho de duas pessoas onde havia um
        // clique. Só aparece no estado `unverified`: nos outros dois não há nada a reenviar.
        if (email.state === 'unverified') {
            const resend = el('button', 'account-settings__link');
            resend.type = 'button';
            resend.dataset.testid = 'account-email-resend';
            resend.textContent = EMAIL_RESEND_LABEL;
            const outcome = el('p', 'account-settings__section-hint', '');
            outcome.hidden = true;
            addScopedDomListener(this, LISTENER_SCOPE, resend, 'click', async () => {
                resend.disabled = true;
                try {
                    await apiClient.resendVerification({ email: email.address });
                    outcome.textContent = EMAIL_RESEND_SENT;
                } catch {
                    outcome.textContent = EMAIL_RESEND_FAILED;
                } finally {
                    outcome.hidden = false;
                    resend.disabled = false;
                }
            });
            readonly.appendChild(resend);
            readonly.appendChild(outcome);
        }

        readonly.appendChild(this._readonlyRow(
            'Lotação',
            profile.organizacao_militar || 'não informada'
        ));

        if (identity.producer_org_id) {
            const nome = organizationName(identity.producer_org_id);
            readonly.appendChild(this._readonlyRow(
                'OM de produção',
                nome || 'OM fora da lista de ativas',
                'É a OM cujos itens de catálogo e projetos 360 você mantém.'
            ));
        }

        section.appendChild(readonly);
        section.appendChild(el('p', 'account-settings__section-hint', ADMIN_ONLY_FIELDS_NOTE));

        const form = el('div', 'account-settings__form');
        form.appendChild(this._inputField({
            field: 'nome',
            label: 'Nome completo',
            value: profile.nome || '',
            autocomplete: 'name',
            maxLength: MAX_NAME_LENGTH,
        }));
        form.appendChild(this._renderRankField(profile));
        section.appendChild(form);

        if (this._profileError) {
            section.appendChild(this._errorBox(this._profileError));
        }

        const actions = el('div', 'account-settings__actions');
        actions.appendChild(this._actionButton({
            label: this._saving ? 'Salvando...' : 'Salvar alterações',
            disabled: this._saving,
            testid: 'account-settings-save-profile',
            onClick: () => this._saveProfile(),
        }));
        section.appendChild(actions);

        return section;
    }

    /**
     * @private O campo de posto: um `select` quando a lista controlada chegou, um aviso simples
     * quando não chegou. Lista vazia e config que falhou NÃO são a mesma coisa, então o aviso diz
     * que a lista está indisponível em vez de desenhar um seletor vazio.
     * @param {Object} profile
     * @returns {HTMLElement}
     */
    _renderRankField(profile) {
        const field = el('div', 'account-settings__field');
        const id = 'account-settings-rank';
        const label = el('label', 'account-settings__label', 'Posto ou graduação');
        label.setAttribute('for', id);
        field.appendChild(label);

        const options = rankOptions();
        if (options.length === 0) {
            field.appendChild(el(
                'p',
                'account-settings__field-note',
                'A lista de postos não veio do servidor, então este campo não pode ser editado agora.'
            ));
            field.appendChild(el(
                'p',
                'account-settings__field-note',
                `Valor atual: ${profile.posto_graduacao || 'não informado'}.`
            ));
            return field;
        }

        const select = document.createElement('select');
        select.className = 'account-settings__input';
        select.id = id;
        select.dataset.field = 'rank';
        select.dataset.testid = id;

        const vazio = document.createElement('option');
        vazio.value = '';
        vazio.textContent = 'Não informado';
        select.appendChild(vazio);

        const atualId = profile.rank_id ? String(profile.rank_id) : '';
        let encontrou = false;
        for (const option of options) {
            const node = document.createElement('option');
            node.value = option.value;
            node.textContent = option.label;
            if (option.value === atualId) {
                node.selected = true;
                encontrou = true;
            }
            select.appendChild(node);
        }
        // O posto do registro pode estar DESATIVADO, e `config.postos` só serve as linhas ativas.
        // Sem este ramo o seletor mostraria "Não informado" em silêncio, e um salvamento limparia
        // um valor que a pessoa nunca tocou.
        if (atualId && !encontrou) {
            const node = document.createElement('option');
            node.value = atualId;
            node.textContent = `${profile.posto_graduacao || 'Posto atual'} (fora de uso)`;
            node.selected = true;
            select.appendChild(node);
        }

        field.appendChild(select);
        return field;
    }

    /**
     * @private "Trocar o e-mail": um convite para outra caixa, não uma escrita na conta.
     *
     * A seção só é desenhada depois de o perfil ser LIDO, porque o formulário precisa do endereço
     * atual para recusar uma troca inócua sem ida à rede, e porque quem não consegue ver o próprio
     * e-mail não tem o que fazer com a oferta de um novo.
     * @returns {HTMLElement}
     */
    _renderEmailSection() {
        const section = el('section', 'account-settings__section');
        section.dataset.section = 'email';
        section.appendChild(this._sectionHeader(
            'Trocar o e-mail',
            'O endereço para onde vão a confirmação da conta e a recuperação de senha.'
        ));

        if (this._loading || this._loadError) {
            // Nada a dizer ainda, e nada a oferecer: a seção de perfil acima já relata o
            // carregamento e a falha, e repetir qualquer um dos dois aqui seria ruído.
            return section;
        }

        const atual = emailPresentation(this._profile || {});
        section.appendChild(this._readonlyRow(
            'E-mail atual',
            atual.state === 'absent' ? atual.status : `${atual.address} (${atual.status})`
        ));
        section.appendChild(this._warningBox(EMAIL_CHANGE_WARNING));

        const form = el('div', 'account-settings__form');
        form.appendChild(this._inputField({
            field: 'email-novo',
            label: 'Novo e-mail',
            type: 'email',
            autocomplete: 'email',
            maxLength: MAX_EMAIL_LENGTH,
        }));
        form.appendChild(this._inputField({
            field: 'email-senha',
            label: 'Senha atual',
            type: 'password',
            autocomplete: 'current-password',
        }));
        section.appendChild(form);
        section.appendChild(el('p', 'account-settings__section-hint', EMAIL_CHANGE_PASSWORD_NOTE));

        if (this._emailError) {
            section.appendChild(this._errorBox(this._emailError));
        }
        if (this._emailDone) {
            const ok = el('div', 'account-settings__state account-settings__state--done', this._emailDone);
            ok.setAttribute('role', 'status');
            section.appendChild(ok);
        }

        const actions = el('div', 'account-settings__actions');
        actions.appendChild(this._actionButton({
            label: this._changingEmail ? 'Enviando...' : 'Enviar confirmação',
            disabled: this._changingEmail,
            testid: 'account-settings-change-email',
            onClick: () => this._changeEmail(),
        }));
        section.appendChild(actions);

        return section;
    }

    /**
     * @private "Trocar a senha": a regra antes da tentativa, o custo antes do clique.
     * @returns {HTMLElement}
     */
    _renderPasswordSection() {
        const section = el('section', 'account-settings__section');
        section.dataset.section = 'senha';
        section.appendChild(this._sectionHeader(
            'Trocar a senha',
            'Você precisa da senha atual para definir uma nova.'
        ));

        section.appendChild(el('p', 'account-settings__section-hint', PASSWORD_RULE_TEXT));
        section.appendChild(this._warningBox(PASSWORD_SESSION_WARNING));

        const form = el('div', 'account-settings__form');
        form.appendChild(this._inputField({
            field: 'senha-atual',
            label: 'Senha atual',
            type: 'password',
            autocomplete: 'current-password',
        }));
        form.appendChild(this._inputField({
            field: 'senha-nova',
            label: 'Nova senha',
            type: 'password',
            autocomplete: 'new-password',
            maxLength: 100,
        }));
        form.appendChild(this._inputField({
            field: 'senha-confirma',
            label: 'Confirmar a nova senha',
            type: 'password',
            autocomplete: 'new-password',
            maxLength: 100,
        }));
        section.appendChild(form);

        if (this._passwordError) {
            section.appendChild(this._errorBox(this._passwordError));
        }
        if (this._passwordDone) {
            const ok = el('div', 'account-settings__state account-settings__state--done', this._passwordDone);
            ok.setAttribute('role', 'status');
            section.appendChild(ok);
        }

        const actions = el('div', 'account-settings__actions');
        actions.appendChild(this._actionButton({
            label: this._changingPassword ? 'Trocando...' : 'Trocar a senha',
            variant: 'danger',
            disabled: this._changingPassword,
            testid: 'account-settings-change-password',
            onClick: () => this._changePassword(),
        }));
        section.appendChild(actions);

        return section;
    }
}
