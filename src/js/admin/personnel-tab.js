// Path: js/admin/personnel-tab.js

/**
 * @fileoverview "Pessoal" tab of the admin panel. Manages the two controlled personnel lists that
 * the signup/account forms consume as dropdowns:
 *   - Postos / Graduações  (resources category 'posto'; abbreviation kept in config.abrev)
 *   - Organizações Militares (resources category 'organizacao_militar')
 * Both go through the existing /api/v1/resources admin CRUD. A simple per-list editor (no JSON,
 * no thumbnails) — name + (postos only) abbreviation + display order. The id is auto-slugged on
 * create and immutable on edit.
 *
 * Dynamic text via textContent (never innerHTML with data).
 */

import { apiClient } from '@store/sync/api-client.js';
import { showConfirm } from '@modals/index.js';
import { showSuccess, showError } from '@utils';
import { sectionHeader, card, ICON_PERSONNEL } from './admin-dom.js';

/** The two controlled lists, each backed by a `resources` category. */
const SUBCATS = [
    { key: 'posto', label: 'Postos / Graduações', category: 'posto', hasAbrev: true, idPrefix: 'posto', singular: 'posto/graduação' },
    { key: 'om', label: 'Organizações Militares', category: 'organizacao_militar', hasAbrev: false, idPrefix: 'om', singular: 'organização militar' },
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
            items = await apiClient.listResources(sub.category);
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
        const headers = sub.hasAbrev ? ['Nome', 'Abreviação', 'Ordem', 'Ações'] : ['Nome', 'Ordem', 'Ações'];
        const table = document.createElement('table');
        table.className = 'admin-users__table';
        const thead = document.createElement('thead');
        const hrow = document.createElement('tr');
        for (const h of headers) {
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
            tr.dataset.resourceId = r.id;
            tr.appendChild(cell(r.name || ''));
            if (sub.hasAbrev) tr.appendChild(cell(r.config?.abrev || ''));
            tr.appendChild(cell(String(r.sort_order ?? '')));
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
    _renderForm(resource) {
        const sub = this._sub();
        const isEdit = !!resource;
        const c = this._content;
        c.replaceChildren();

        const form = document.createElement('form');
        form.className = 'admin-form';
        form.dataset.testid = 'admin-personnel-form';

        const heading = document.createElement('h3');
        heading.className = 'admin-form__heading';
        heading.textContent = isEdit ? `Editar: ${resource.name || resource.id}` : `Novo — ${sub.label}`;
        form.appendChild(heading);

        const error = document.createElement('div');
        error.className = 'admin-form__error';
        error.dataset.testid = 'admin-personnel-error';
        error.hidden = true;
        error.setAttribute('role', 'alert');

        const nameInput = textField(form, 'Nome', 'admin-personnel-name', resource?.name ?? '');
        const abrevInput = sub.hasAbrev
            ? textField(form, 'Abreviação', 'admin-personnel-abrev', resource?.config?.abrev ?? '')
            : null;
        const nextOrder = isEdit ? (resource.sort_order ?? 0) : ((this._items?.length ?? 0) + 1);
        const sortInput = textField(form, 'Ordem', 'admin-personnel-sort', String(nextOrder), 'number');

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
            const name = nameInput.value.trim();
            if (!name) { showFormError(error, 'Informe um nome.'); return; }
            const abrev = abrevInput ? abrevInput.value.trim() : '';
            const sort = Number(sortInput.value.trim());
            const config = sub.hasAbrev ? { abrev } : {};

            saveBtn.disabled = true;
            try {
                if (isEdit) {
                    await apiClient.updateResource(resource.id, {
                        name,
                        config,
                        sort_order: Number.isFinite(sort) ? sort : 0,
                    });
                    showSuccess('Item atualizado.');
                } else {
                    const id = `${sub.idPrefix}-${slugify(name)}`;
                    await apiClient.createResource({
                        id,
                        category: sub.category,
                        name,
                        config,
                        sort_order: Number.isFinite(sort) ? sort : 0,
                    });
                    showSuccess('Item criado.');
                }
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
    async _delete(resource) {
        const ok = await showConfirm(`Excluir "${resource.name || resource.id}" da lista?`,
            { destructive: true, confirmText: 'Excluir' });
        if (!ok) return;
        try {
            await apiClient.deleteResource(resource.id);
            showSuccess('Item excluído.');
            if (this._alive) this._renderList();
        } catch (err) {
            showError(err?.message || 'Falha ao excluir o item.');
        }
    }
}

// ===== helpers =====

/** Accent-stripped, lowercased, hyphenated slug (for the auto-generated resource id). */
function slugify(value) {
    return String(value)
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40) || 'item';
}

// ===== small DOM builders (shared shape with catalog-tab / users-tab) =====

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
