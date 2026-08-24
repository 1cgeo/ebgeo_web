// Path: js/admin/personnel-tab.js

/**
 * @fileoverview "Pessoal" tab of the admin panel. Manages the two controlled personnel lists the
 * signup/account forms consume (as FK dropdowns):
 *   - Postos / Graduações   → the `ranks` table (/api/v1/ranks)
 *   - Organizações Militares → the `organizations` table (/api/v1/organizations)
 * Simple per-list editor (no JSON). Dynamic text via textContent (never innerHTML with data).
 */

import { apiClient } from '@store/sync/api-client.js';
// Pelo ARQUIVO, como o boot desta página já faz: a lista de OMs e postos que os seletores das
// OUTRAS abas leem é o singleton de `/api/config`, e é ele que precisa ser reidratado aqui.
import { applyRuntimeConfig } from '@store/sync/runtime-config.js';
import { showConfirm } from '@modals/confirm.modal.js';
import { showSuccess, showError } from '@utils/toast_service.js';
import { sectionHeader, card, emptyState, ICON_PERSONNEL, failureState } from './admin-dom.js';
// Módulo folha, zero imports. Ver o `fileoverview` dele: desativar uma OM é o ato mais destrutivo
// do painel e era o que menos falava.
import {
    orgDeactivationWarning, orgDeactivationConfirmLabel, orgDeactivationSummary,
    rankDeactivationWarning, statusLabel,
} from './personnel-phrases.js';

/** The two controlled lists, each backed by its own table/endpoints + field set. */
const SUBCATS = [
    {
        key: 'posto',
        label: 'Postos / Graduações',
        columns: ['Nome', 'Abreviação', 'Ordem', 'Código', 'Status', 'Ações'],
        // O STATUS ENTRA, e o dado sempre esteve aqui: `LIST_RANKS` projeta `is_active` e não o
        // filtra, então a linha desativada continuava na tabela IDÊNTICA à ativa, enquanto sumia
        // dos seletores de cadastro (o `/api/config` filtra). "Excluí e continua aparecendo" era
        // chamado, e a resposta era que nada tinha sido excluído.
        // O CÓDIGO É LIDO E NUNCA ESCRITO, e a tabela passa a dizê-lo em vez de escondê-lo. A
        // coluna existe no banco, `LIST_RANKS` a seleciona e `INSERT_RANK` NÃO a insere (ele
        // insere nome, abreviação e ordem, e apenas RETORNA o código), então todo posto criado por
        // esta aba nasce com código vazio enquanto os da semente têm o seu. Mostrar o vazio é o
        // que torna a assimetria visível para quem mantém a lista.
        cells: (r) => [
            r.nome || '', r.nome_abrev || '', String(r.sort_order ?? ''),
            r.code == null || r.code === '' ? '—' : String(r.code),
            statusLabel(r.is_active),
        ],
        fields: [
            { key: 'nome', label: 'Nome', required: true, value: (r) => r?.nome ?? '' },
            { key: 'nome_abrev', label: 'Abreviação', value: (r) => r?.nome_abrev ?? '' },
            { key: 'sort_order', label: 'Ordem', type: 'number', value: (r, count) => String(r?.sort_order ?? count + 1) },
        ],
        list: () => apiClient.listRanks(),
        create: (v) => apiClient.createRank({ nome: v.nome, nome_abrev: v.nome_abrev || null, sort_order: Number(v.sort_order) || 0 }),
        update: (id, v) => apiClient.updateRank(id, { nome: v.nome, nome_abrev: v.nome_abrev || null, sort_order: Number(v.sort_order) || 0 }),
        remove: (id) => apiClient.deleteRank(id),
        // A VOLTA, que a rota SEMPRE aceitou e a tela nunca ofereceu.
        reactivate: (id) => apiClient.updateRank(id, { is_active: true }),
    },
    {
        key: 'om',
        label: 'Organizações Militares',
        columns: ['Nome', 'Sigla', 'Status', 'Ações'],
        cells: (r) => [r.nome || '', r.sigla || '', statusLabel(r.is_active)],
        fields: [
            { key: 'nome', label: 'Nome', required: true, value: (r) => r?.nome ?? '' },
            { key: 'sigla', label: 'Sigla', value: (r) => r?.sigla ?? '' },
            // O SLUG, SOMENTE LEITURA. Ele é derivado do nome, é IMUTÁVEL nas três camadas (o
            // schema não o declara, o UPDATE não o toca, o cliente não o envia) e não aparecia em
            // lugar nenhum. A colisão dele vira um 409 cuja mensagem NOMEIA um campo que o
            // operador não podia ver nem editar, e a única saída é mudar o nome até o derivado
            // parar de colidir, às cegas.
            {
                key: 'slug', label: 'Identificador (derivado do nome)', readOnly: true,
                value: (r) => r?.slug ?? '',
            },
        ],
        list: () => apiClient.listOrganizations(),
        // slug is immutable + required on create — derived from the name.
        create: (v) => apiClient.createOrganization({ nome: v.nome, sigla: v.sigla || null, slug: slugify(v.nome) }),
        update: (id, v) => apiClient.updateOrganization(id, { nome: v.nome, sigla: v.sigla || null }),
        remove: (id) => apiClient.deleteOrganization(id),
        // `updateOrganizationSchema` declara `is_active` e o UPDATE o aplica por COALESCE desde
        // sempre; a string não aparecia UMA VEZ neste arquivo, então a saída documentada para
        // desfazer o ato mais destrutivo do painel era SQL no banco.
        reactivate: (id) => apiClient.updateOrganization(id, { is_active: true }),
    },
];

/**
 * Builds the "Pessoal" tab definition for the admin panel.
 * @returns {import('./admin-panel.js').AdminTab}
 */
export function createPersonnelTab() {
    const tab = new PersonnelTab();
    return {
        id: 'personnel',
        label: 'Pessoal',
        testid: 'admin-tab-personnel',
        icon: ICON_PERSONNEL,
        mount: (container) => tab.mount(container),
    };
}

class PersonnelTab {
    /**
     * @param {HTMLElement} container
     * @returns {Function} cleanup
     */
    mount(container) {
        this._container = container;
        this._alive = true;
        this._subKey = SUBCATS[0].key;
        this._build();
        return () => { this._alive = false; };
    }

    /** @private @returns {Object} The active sub-category descriptor. */
    _sub() {
        return SUBCATS.find((s) => s.key === this._subKey) ?? SUBCATS[0];
    }

    /** @private Builds the persistent sub-nav + a content area, then renders the first list. */
    _build() {
        const c = this._container;
        c.replaceChildren();
        c.appendChild(sectionHeader('Pessoal', {
            subtitle: 'Listas controladas usadas no cadastro — postos/graduações e organizações militares',
        }));

        const nav = document.createElement('nav');
        nav.className = 'admin-catalog__nav';
        this._navButtons = new Map();
        for (const sub of SUBCATS) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'admin-catalog__nav-btn';
            btn.dataset.testid = `admin-personnel-${sub.key}`;
            btn.textContent = sub.label;
            btn.addEventListener('click', () => this._select(sub.key));
            this._navButtons.set(sub.key, btn);
            nav.appendChild(btn);
        }
        c.appendChild(nav);

        this._content = document.createElement('div');
        this._content.className = 'admin-catalog__content';
        c.appendChild(this._content);

        this._select(this._subKey);
    }

    /** @private */
    _select(key) {
        this._subKey = key;
        for (const [k, btn] of this._navButtons) {
            btn.classList.toggle('admin-catalog__nav-btn--active', k === key);
        }
        this._renderList();
    }

    // ----- list -----

    /** @private */
    async _renderList() {
        const sub = this._sub();
        const c = this._content;
        c.replaceChildren();

        const toolbar = document.createElement('div');
        toolbar.className = 'admin-users__toolbar';
        toolbar.appendChild(button(`Novo — ${sub.label}`, 'admin-btn admin-btn--primary', 'admin-personnel-new',
            () => this._renderForm(null)));
        c.appendChild(toolbar);

        const wrap = card({ testid: 'admin-personnel-list', padded: false });
        wrap.classList.add('admin-users__table-wrap');
        const loading = document.createElement('p');
        loading.className = 'admin-users__status';
        loading.textContent = 'Carregando…';
        wrap.appendChild(loading);
        c.appendChild(wrap);

        let items;
        try {
            items = await sub.list();
        } catch (error) {
            if (!this._alive) return;
            // A SAÍDA que faltava. Ver `failureState` em `admin-dom.js`: falha de carregamento era
            // beco sem saída nas seis abas, e o único caminho era recarregar a página.
            loading.replaceChildren(failureState('Falha ao carregar a lista.', {
                onRetry: () => { if (this._alive) this._renderList(); },
            }));
            showError(error?.message || 'Falha ao carregar a lista.');
            return;
        }
        if (!this._alive) return;
        this._items = Array.isArray(items) ? items : [];
        this._renderTable(wrap, this._items);
    }

    /** @private */
    _renderTable(wrap, items) {
        const sub = this._sub();
        wrap.replaceChildren();
        if (items.length === 0) {
            // `emptyState` E NÃO UM PARÁGRAFO CRU, como Usuários, Grupos e Auditoria já fazem: o
            // helper traz a DICA do que fazer agora, e era exatamente ela que faltava nas duas
            // abas que montavam o vazio à mão. Lista vazia sem próximo passo é beco.
            wrap.appendChild(emptyState('Nenhum item nesta lista.', {
                hint: 'Use "Novo" acima para criar o primeiro.',
            }));
            return;
        }
        const table = document.createElement('table');
        table.className = 'admin-users__table';
        const thead = document.createElement('thead');
        const hrow = document.createElement('tr');
        for (const h of sub.columns) {
            const th = document.createElement('th');
            th.textContent = h;
            hrow.appendChild(th);
        }
        thead.appendChild(hrow);
        table.appendChild(thead);

        const tbody = document.createElement('tbody');
        for (const r of items) {
            const tr = document.createElement('tr');
            tr.dataset.testid = 'admin-personnel-row';
            tr.dataset.itemId = r.id;
            for (const cellText of sub.cells(r)) tr.appendChild(cell(cellText));
            const actions = document.createElement('td');
            actions.className = 'admin-users__actions';
            actions.appendChild(button('Editar', 'admin-btn admin-btn--ghost', 'admin-personnel-edit',
                () => this._renderForm(r)));
            if (r.is_active === false) {
                actions.appendChild(button('Reativar', 'admin-btn admin-btn--ghost', 'admin-personnel-reactivate',
                    () => this._reactivate(r)));
            } else {
                // "DESATIVAR" E NÃO "EXCLUIR": a linha continua no banco, continua nesta tabela e
                // volta com um clique. Chamar de exclusão o que é desativação faz a pessoa hesitar
                // no ato reversível e não hesitar no que trava contas.
                actions.appendChild(button('Desativar', 'admin-btn admin-btn--danger', 'admin-personnel-delete',
                    () => this._delete(r)));
            }
            tr.appendChild(actions);
            tbody.appendChild(tr);
        }
        table.appendChild(tbody);
        wrap.appendChild(table);
    }

    // ----- form -----

    /** @private */
    _renderForm(item) {
        const sub = this._sub();
        const isEdit = !!item;
        const c = this._content;
        c.replaceChildren();

        const form = document.createElement('form');
        form.className = 'admin-form';
        form.dataset.testid = 'admin-personnel-form';

        const heading = document.createElement('h3');
        heading.className = 'admin-form__heading';
        heading.textContent = isEdit ? `Editar: ${item.nome || ''}` : `Novo — ${sub.label}`;
        form.appendChild(heading);

        const error = document.createElement('div');
        error.className = 'admin-form__error';
        error.dataset.testid = 'admin-personnel-error';
        error.hidden = true;
        error.setAttribute('role', 'alert');

        const inputs = {};
        const count = this._items?.length ?? 0;
        for (const f of sub.fields) {
            const campo = textField(form, f.label, `admin-personnel-${f.key}`, f.value(item, count), f.type || 'text');
            // SOMENTE LEITURA É EXIBIÇÃO, não campo. O slug é derivado e imutável nas três
            // camadas; mostrá-lo editável prometeria uma escrita que nem o schema declara.
            if (f.readOnly) {
                campo.readOnly = true;
                campo.title = 'Derivado do nome na criação, e imutável depois.';
            }
            inputs[f.key] = campo;
        }

        form.appendChild(error);

        const actions = document.createElement('div');
        actions.className = 'admin-form__actions';
        actions.appendChild(button('Cancelar', 'admin-btn admin-btn--ghost', 'admin-personnel-cancel',
            () => this._renderList()));
        const saveBtn = button(isEdit ? 'Salvar' : 'Criar', 'admin-btn admin-btn--primary', 'admin-personnel-save', null);
        actions.appendChild(saveBtn);
        form.appendChild(actions);

        const onSave = async () => {
            error.hidden = true;
            const vals = {};
            for (const f of sub.fields) {
                if (f.readOnly) continue;
                vals[f.key] = inputs[f.key].value.trim();
            }
            const required = sub.fields.find((f) => f.required && !vals[f.key]);
            if (required) { showFormError(error, `Informe: ${required.label}.`); return; }

            saveBtn.disabled = true;
            try {
                if (isEdit) await sub.update(item.id, vals);
                else await sub.create(vals);
                // Ver `_reidratarConfig`: sem isto, a OM recém-criada não aparece no seletor da
                // aba Usuários nem no filtro da Auditoria até a página ser recarregada.
                await this._reidratarConfig();
                showSuccess(isEdit ? 'Item atualizado.' : 'Item criado.');
                if (this._alive) this._renderList();
            } catch (err) {
                showFormError(error, err?.message || 'Falha ao salvar o item.');
                saveBtn.disabled = false;
            }
        };
        saveBtn.addEventListener('click', onSave);

        c.appendChild(form);
    }

    /**
     * Desativa uma linha das duas listas controladas.
     *
     * PARA A OM, ESTE É O ATO MAIS DESTRUTIVO DO PAINEL, e a confirmação precisa dizê-lo. Ver o
     * `fileoverview` de `personnel-phrases.js`: o gate de OM inativa roda ANTES da adoção do papel
     * no middleware, então quem desativa a própria lotação não alcança nem a tela que desfaria o
     * ato. O servidor recusa esse caso com 409; isto aqui é a primeira linha, não a única.
     * @private
     * @param {Object} item
     * @returns {Promise<void>}
     */
    async _delete(item) {
        const ehOm = this._subKey === 'om';
        // A CONTAGEM É OPCIONAL. Ela vem de uma leitura à parte e uma leitura pode falhar; quando
        // falha, a confirmação degrada para a versão sem número em vez de sumir, porque o que a
        // pessoa precisa saber (o que este ato faz) não depende de quantos são.
        let contagens = null;
        if (ehOm) {
            try {
                contagens = await apiClient.getOrganizationImpact(item.id);
            } catch (err) {
                console.warn('[personnel-tab] impacto da OM indisponível:', err);
            }
        }

        const ok = await showConfirm(
            ehOm ? `Desativar "${item.nome || ''}"?` : `Desativar "${item.nome || ''}"?`,
            {
                message: ehOm
                    ? orgDeactivationWarning({
                        nome: item.nome,
                        contagens,
                        ehMinhaLotacao: contagens?.requesterIsMember === true,
                    })
                    : rankDeactivationWarning(item.nome),
                destructive: true,
                confirmText: ehOm ? orgDeactivationConfirmLabel(contagens) : 'Desativar',
            },
        );
        if (!ok) return;
        try {
            await this._sub().remove(item.id);
            await this._reidratarConfig();
            showSuccess(ehOm
                ? orgDeactivationSummary(item.nome, contagens)
                : 'Posto desativado. Ele saiu dos seletores de cadastro.');
            if (this._alive) this._renderList();
        } catch (err) {
            showError(err?.message || 'Falha ao desativar o item.');
        }
    }

    /**
     * Reativa uma linha desativada.
     *
     * Não pergunta: reativar não tira nada de ninguém, e perguntar no sentido aditivo treina a
     * pessoa a confirmar sem ler, que é o argumento que `visibilityChangeWarning` já carrega.
     * @private
     * @param {Object} item
     * @returns {Promise<void>}
     */
    /**
     * Reidrata o documento de configuração depois de uma escrita nestas listas.
     *
     * POR QUE PRECISA. Estas duas listas alimentam os `<select>` de posto e de OM do formulário de
     * USUÁRIOS e o filtro de OM da AUDITORIA, e todos eles leem `config.organizacoesMilitares` /
     * `config.postos`, que é o singleton hidratado UMA vez no boot da página. O servidor invalida
     * o cache dele a cada escrita daqui (`invalidateAppConfigCache`), mas invalidar o cache do
     * SERVIDOR não reidrata o do cliente: criar uma OM e ir cadastrar alguém nela, na mesma
     * sessão, não a encontrava no seletor, e a única saída era recarregar a página.
     *
     * Best-effort de propósito: se a releitura falhar, a escrita que acabou de acontecer continua
     * valendo, e o pior caso é o seletor da outra aba ficar velho como estava antes.
     * @private
     * @returns {Promise<void>}
     */
    async _reidratarConfig() {
        try {
            await applyRuntimeConfig({ apiClient });
        } catch (err) {
            console.warn('[personnel-tab] configuração não pôde ser reidratada:', err);
        }
    }

    async _reactivate(item) {
        try {
            await this._sub().reactivate(item.id);
            await this._reidratarConfig();
            showSuccess('Reativado.');
            if (this._alive) this._renderList();
        } catch (err) {
            showError(err?.message || 'Falha ao reativar o item.');
        }
    }
}

// ===== helpers =====

/** Accent-stripped, lowercased, hyphenated slug (for the immutable organization slug). */
function slugify(value) {
    return String(value)
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 90) || 'om';
}

function cell(textValue) {
    const td = document.createElement('td');
    td.textContent = textValue;
    return td;
}

function button(label, className, testid, onClick) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = className;
    btn.dataset.testid = testid;
    btn.textContent = label;
    if (onClick) btn.addEventListener('click', onClick);
    return btn;
}

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

function showFormError(el, msg) {
    el.textContent = msg;
    el.hidden = false;
}
