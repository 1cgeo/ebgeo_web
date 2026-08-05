// Path: js/admin/personnel-tab.js

/**
 * @fileoverview "Pessoal" tab of the admin panel. Manages the two controlled personnel lists the
 * signup/account forms consume (as FK dropdowns):
 *   - Postos / Graduações   → the `ranks` table (/api/v1/ranks)
 *   - Organizações Militares → the `organizations` table (/api/v1/organizations)
 * Simple per-list editor (no JSON). Dynamic text via textContent (never innerHTML with data).
 */

import { apiClient } from '@store/sync/api-client.js';
import { showConfirm } from '@modals/confirm.modal.js';
import { showSuccess, showError } from '@utils/toast_service.js';
import { sectionHeader, card, ICON_PERSONNEL } from './admin-dom.js';

/** The two controlled lists, each backed by its own table/endpoints + field set. */
const SUBCATS = [
    {
        key: 'posto',
        label: 'Postos / Graduações',
        columns: ['Nome', 'Abreviação', 'Ordem', 'Ações'],
        cells: (r) => [r.nome || '', r.nome_abrev || '', String(r.sort_order ?? '')],
        fields: [
            { key: 'nome', label: 'Nome', required: true, value: (r) => r?.nome ?? '' },
            { key: 'nome_abrev', label: 'Abreviação', value: (r) => r?.nome_abrev ?? '' },
            { key: 'sort_order', label: 'Ordem', type: 'number', value: (r, count) => String(r?.sort_order ?? count + 1) },
        ],
        list: () => apiClient.listRanks(),
        create: (v) => apiClient.createRank({ nome: v.nome, nome_abrev: v.nome_abrev || null, sort_order: Number(v.sort_order) || 0 }),
        update: (id, v) => apiClient.updateRank(id, { nome: v.nome, nome_abrev: v.nome_abrev || null, sort_order: Number(v.sort_order) || 0 }),
        remove: (id) => apiClient.deleteRank(id),
    },
    {
        key: 'om',
        label: 'Organizações Militares',
        columns: ['Nome', 'Sigla', 'Ações'],
        cells: (r) => [r.nome || '', r.sigla || ''],
        fields: [
            { key: 'nome', label: 'Nome', required: true, value: (r) => r?.nome ?? '' },
            { key: 'sigla', label: 'Sigla', value: (r) => r?.sigla ?? '' },
        ],
        list: () => apiClient.listOrganizations(),
        // slug is immutable + required on create — derived from the name.
        create: (v) => apiClient.createOrganization({ nome: v.nome, sigla: v.sigla || null, slug: slugify(v.nome) }),
        update: (id, v) => apiClient.updateOrganization(id, { nome: v.nome, sigla: v.sigla || null }),
        remove: (id) => apiClient.deleteOrganization(id),
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
            loading.textContent = 'Falha ao carregar a lista.';
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
            const empty = document.createElement('p');
            empty.className = 'admin-users__status';
            empty.textContent = 'Nenhum item nesta lista.';
            wrap.appendChild(empty);
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
            actions.appendChild(button('Excluir', 'admin-btn admin-btn--danger', 'admin-personnel-delete',
                () => this._delete(r)));
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
            inputs[f.key] = textField(form, f.label, `admin-personnel-${f.key}`, f.value(item, count), f.type || 'text');
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
            for (const f of sub.fields) vals[f.key] = inputs[f.key].value.trim();
            const required = sub.fields.find((f) => f.required && !vals[f.key]);
            if (required) { showFormError(error, `Informe: ${required.label}.`); return; }

            saveBtn.disabled = true;
            try {
                if (isEdit) await sub.update(item.id, vals);
                else await sub.create(vals);
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

    /** @private */
    async _delete(item) {
        const ok = await showConfirm(`Excluir "${item.nome || ''}" da lista?`,
            { destructive: true, confirmText: 'Excluir' });
        if (!ok) return;
        try {
            await this._sub().remove(item.id);
            showSuccess('Item excluído.');
            if (this._alive) this._renderList();
        } catch (err) {
            showError(err?.message || 'Falha ao excluir o item.');
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
