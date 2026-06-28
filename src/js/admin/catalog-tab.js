// Path: js/admin/catalog-tab.js

/**
 * @fileoverview "Catálogo" tab of the admin panel. Manages catalog METADATA only — never the files
 * themselves (3D model bytes, 360 bundles, thumbnails/videos are populated out-of-band; the metadata
 * just references their paths). Resource categories (tileset/data_layer/analysis_layer/basemap) go
 * through the existing /api/v1/resources admin CRUD; the `config` (rich, MapLibre-expression-heavy)
 * is edited as JSON. 360 projects are managed via the sv360 admin routes (list/enable/disable/delete)
 * — the bundle upload is out-of-band.
 *
 * Dynamic text via textContent; JSON is parsed/validated before save (never innerHTML with data).
 */

import { apiClient } from '@store/sync/api-client.js';
import { showConfirm } from '@modals/index.js';
import { showSuccess, showError } from '@utils';
import { validateMapLibreStyle } from '@utils/maplibre-style-validate.js';
import { validateImageFile, readFileAsDataURL, compressImage } from '@utils/image_utils.js';
import { sectionHeader, card, ICON_CATALOG } from './admin-dom.js';

/** Where a thumbnail data URL is stored in each category's `config` (mirrors the deploy shapes). */
const THUMB_KEY = {
    tileset: 'previewThumbnail',
    data_layer: 'thumbnail',
    analysis_layer: 'thumbnail',
    basemap: 'image',
};

/** Reject an embedded thumbnail whose data URL exceeds this — keeps /api/config from bloating even if
 * compression silently no-ops (returns the original) on a decode failure. A 420px WebP is ~10-40 KB. */
const MAX_THUMBNAIL_DATAURL = 256 * 1024;

/** UI categories. `sv360` is special (sv360 admin routes); the rest are `resources` categories. */
const CATEGORIES = [
    { key: 'tileset', label: '3D (modelos)' },
    { key: 'data_layer', label: 'Dados' },
    { key: 'analysis_layer', label: 'Análises' },
    { key: 'basemap', label: 'Basemaps' },
    { key: 'sv360', label: '360', is360: true },
];

/** Starter `config` templates per category — mirror the real deploy config shapes (config.js). */
const TEMPLATES = {
    tileset: {
        url: '/catalogo/modelos_catalogo/3d/EXEMPLO/tileset.json',
        heightOffset: 0,
        description: '',
        keywords: [],
        data_captura: '',
        local: '',
        previewVideo: '',
        previewThumbnail: '',
        locate: { lon: 0, lat: 0, height: 1000 },
    },
    data_layer: {
        source: { type: 'vector', url: '/cms/martin/EXEMPLO' },
        sourceLayer: '',
        minzoom: 5,
        maxzoom: 17,
        thumbnail: '',
        style: { border: { color: '#E74C3C', width: 2, opacity: 1 } },
    },
    analysis_layer: {
        source: { type: 'raster', tiles: ['/cms/martin/EXEMPLO/{z}/{x}/{y}'], tileSize: 256, minzoom: 12, maxzoom: 12 },
        bounds: [-55, -29, -54, -28],
        thumbnail: '',
        opacity: 0.5,
    },
    basemap: {
        enabled: true,
        image: './images/layers/EXEMPLO-thumb.webp',
        priority: 1,
    },
};

/**
 * Builds the "Catálogo" tab definition for the admin panel.
 * @returns {import('./admin-panel.js').AdminTab}
 */
export function createCatalogTab() {
    const tab = new CatalogTab();
    return {
        id: 'catalog',
        label: 'Catálogo',
        testid: 'admin-tab-catalog',
        icon: ICON_CATALOG,
        mount: (container) => tab.mount(container),
    };
}

class CatalogTab {
    /**
     * @param {HTMLElement} container
     * @returns {Function} cleanup
     */
    mount(container) {
        this._container = container;
        this._alive = true;
        this._category = CATEGORIES[0].key;
        this._build();
        return () => { this._alive = false; };
    }

    /** @private Builds the persistent sub-nav + a content area, then renders the first category. */
    _build() {
        const c = this._container;
        c.replaceChildren();
        c.appendChild(sectionHeader('Catálogo', {
            subtitle: 'Recursos globais — 3D, 360, dados, análises e basemaps (metadados)',
        }));

        const nav = document.createElement('nav');
        nav.className = 'admin-catalog__nav';
        this._navButtons = new Map();
        for (const cat of CATEGORIES) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'admin-catalog__nav-btn';
            btn.dataset.testid = `admin-cat-${cat.key}`;
            btn.textContent = cat.label;
            btn.addEventListener('click', () => this._selectCategory(cat.key));
            this._navButtons.set(cat.key, btn);
            nav.appendChild(btn);
        }
        c.appendChild(nav);

        this._content = document.createElement('div');
        this._content.className = 'admin-catalog__content';
        c.appendChild(this._content);

        this._selectCategory(this._category);
    }

    /** @private */
    _selectCategory(key) {
        this._category = key;
        for (const [k, btn] of this._navButtons) {
            btn.classList.toggle('admin-catalog__nav-btn--active', k === key);
        }
        if (key === 'sv360') this._render360List();
        else this._renderResourceList(key);
    }

    // ----- resources list -----

    /** @private */
    async _renderResourceList(category) {
        const c = this._content;
        c.replaceChildren();

        const toolbar = document.createElement('div');
        toolbar.className = 'admin-users__toolbar';
        const label = CATEGORIES.find((x) => x.key === category)?.label ?? category;
        toolbar.appendChild(button(`Novo — ${label}`, 'admin-btn admin-btn--primary', 'admin-catalog-new',
            () => this._renderResourceForm(category, null)));
        c.appendChild(toolbar);

        const wrap = card({ testid: 'admin-catalog-list', padded: false });
        wrap.classList.add('admin-users__table-wrap');
        const loading = document.createElement('p');
        loading.className = 'admin-users__status';
        loading.textContent = 'Carregando…';
        wrap.appendChild(loading);
        c.appendChild(wrap);

        let items;
        try {
            items = await apiClient.listResources(category);
        } catch (error) {
            if (!this._alive) return;
            loading.textContent = 'Falha ao carregar o catálogo.';
            showError(error?.message || 'Falha ao carregar o catálogo.');
            return;
        }
        if (!this._alive) return;
        this._renderResourceTable(wrap, category, Array.isArray(items) ? items : []);
    }

    /** @private */
    _renderResourceTable(wrap, category, items) {
        wrap.replaceChildren();
        if (items.length === 0) {
            const empty = document.createElement('p');
            empty.className = 'admin-users__status';
            empty.textContent = 'Nenhum item nesta categoria.';
            wrap.appendChild(empty);
            return;
        }
        const table = document.createElement('table');
        table.className = 'admin-users__table';
        const thead = document.createElement('thead');
        const hrow = document.createElement('tr');
        for (const h of ['ID', 'Nome', 'Ordem', 'Ações']) {
            const th = document.createElement('th');
            th.textContent = h;
            hrow.appendChild(th);
        }
        thead.appendChild(hrow);
        table.appendChild(thead);

        const tbody = document.createElement('tbody');
        for (const r of items) {
            const tr = document.createElement('tr');
            tr.dataset.testid = 'admin-catalog-row';
            tr.dataset.resourceId = r.id;
            tr.appendChild(cell(r.id || ''));
            tr.appendChild(cell(r.name || ''));
            tr.appendChild(cell(String(r.sort_order ?? '')));
            const actions = document.createElement('td');
            actions.className = 'admin-users__actions';
            actions.appendChild(button('Editar', 'admin-btn admin-btn--ghost', 'admin-catalog-edit',
                () => this._renderResourceForm(category, r)));
            actions.appendChild(button('Excluir', 'admin-btn admin-btn--danger', 'admin-catalog-delete',
                () => this._deleteResource(r)));
            tr.appendChild(actions);
            tbody.appendChild(tr);
        }
        table.appendChild(tbody);
        wrap.appendChild(table);
    }

    // ----- resources form (metadata + JSON config) -----

    /** @private */
    _renderResourceForm(category, resource) {
        const isEdit = !!resource;
        const c = this._content;
        c.replaceChildren();

        const form = document.createElement('form');
        form.className = 'admin-form admin-form--wide';
        form.dataset.testid = 'admin-catalog-form';

        const heading = document.createElement('h3');
        heading.className = 'admin-form__heading';
        heading.textContent = isEdit ? `Editar: ${resource.name || resource.id}` : 'Novo item';
        form.appendChild(heading);

        const error = document.createElement('div');
        error.className = 'admin-form__error';
        error.dataset.testid = 'admin-catalog-error';
        error.hidden = true;
        error.setAttribute('role', 'alert');

        const idInput = textField(form, 'ID (único)', 'admin-catalog-id', resource?.id ?? '');
        if (isEdit) { idInput.disabled = true; }
        const nameInput = textField(form, 'Nome', 'admin-catalog-name', resource?.name ?? '');
        const descInput = textField(form, 'Descrição', 'admin-catalog-desc', resource?.description ?? '');
        const sortInput = textField(form, 'Ordem', 'admin-catalog-sort', String(resource?.sort_order ?? 0), 'number');

        // Thumbnail upload (all categories): picked file → downscaled → embedded as a base64 data URL
        // in config (config is anonymous-readable, no out-of-band serving needed). `pendingThumbnail`
        // stays null until a new file is chosen, so a save that only edited the JSON keeps its value.
        const thumbKey = THUMB_KEY[category];
        let pendingThumbnail = null; // a freshly picked thumbnail (data URL)
        let removeThumbnail = false; // explicit "remove the stored thumbnail"
        if (thumbKey) {
            const field = document.createElement('div');
            field.className = 'admin-form__field';
            const lab = document.createElement('label');
            lab.textContent = 'Miniatura (thumbnail)';
            field.appendChild(lab);

            const thumb = document.createElement('div');
            thumb.className = 'admin-thumb';
            const preview = document.createElement('img');
            preview.className = 'admin-thumb__preview';
            preview.alt = '';
            const current = resource?.config?.[thumbKey];
            if (current && typeof current === 'string') preview.src = current;
            else thumb.dataset.empty = 'true';
            thumb.appendChild(preview);

            const fileInput = document.createElement('input');
            fileInput.type = 'file';
            fileInput.accept = 'image/png,image/jpeg,image/webp';
            fileInput.dataset.testid = 'admin-catalog-thumbnail';
            fileInput.className = 'admin-thumb__input';
            fileInput.addEventListener('change', async () => {
                const file = fileInput.files?.[0];
                if (!file) return;
                const v = validateImageFile(file);
                if (!v.valid) { showFormError(error, v.reason); fileInput.value = ''; return; }
                try {
                    const raw = await readFileAsDataURL(file);
                    // WebP keeps transparency (JPEG would flatten it to black) and stays small.
                    const out = await compressImage(raw, { maxDimension: 420, quality: 0.82, mimeType: 'image/webp' });
                    if (out.length > MAX_THUMBNAIL_DATAURL) {
                        showFormError(error, 'Imagem muito grande mesmo após reduzir. Use uma miniatura menor.');
                        fileInput.value = '';
                        return;
                    }
                    pendingThumbnail = out;
                    removeThumbnail = false;
                    preview.src = pendingThumbnail;
                    delete thumb.dataset.empty;
                    error.hidden = true;
                } catch {
                    showFormError(error, 'Não foi possível processar a imagem.');
                }
            });
            thumb.appendChild(fileInput);

            const controls = document.createElement('div');
            controls.className = 'admin-thumb__controls';
            const removeBtn = button('Remover', 'admin-btn admin-btn--ghost admin-btn--sm', 'admin-catalog-thumbnail-remove', () => {
                removeThumbnail = true;
                pendingThumbnail = null;
                fileInput.value = '';
                preview.removeAttribute('src');
                thumb.dataset.empty = 'true';
            });
            controls.appendChild(removeBtn);

            const hint = document.createElement('p');
            hint.className = 'admin-form__hint';
            hint.textContent = 'JPEG, PNG ou WebP — reduzida (WebP) e embutida no catálogo.';
            field.append(thumb, controls, hint);
            form.appendChild(field);
        }

        // Preview VIDEO is 3D-only and out-of-band (large) — referenced by URL, not uploaded.
        let videoInput = null;
        if (category === 'tileset') {
            videoInput = textField(form, 'Vídeo de preview (URL, opcional)', 'admin-catalog-video',
                resource?.config?.previewVideo ?? '');
        }

        // Basemaps: expose the two config keys that actually drive the base-layer selector as
        // first-class controls (instead of only the raw JSON below) — `enabled` (whether it shows
        // up at all) and `priority` (its order). Merged back into config on save.
        let enabledInput = null;
        let priorityInput = null;
        if (category === 'basemap') {
            enabledInput = checkboxField(form, 'Habilitado (aparece no seletor de mapa base)',
                'admin-catalog-enabled', resource?.config?.enabled !== false);
            priorityInput = textField(form, 'Prioridade (ordem no seletor)', 'admin-catalog-priority',
                String(resource?.config?.priority ?? resource?.sort_order ?? 0), 'number');
        }

        const configValue = JSON.stringify(resource?.config ?? TEMPLATES[category] ?? {}, null, 2);
        const configInput = jsonField(form, 'Avançado — configuração (JSON)', 'admin-catalog-config', configValue);

        form.appendChild(error);

        const actions = document.createElement('div');
        actions.className = 'admin-form__actions';
        actions.appendChild(button('Cancelar', 'admin-btn admin-btn--ghost', 'admin-catalog-cancel',
            () => this._selectCategory(category)));
        const saveBtn = button(isEdit ? 'Salvar' : 'Criar', 'admin-btn admin-btn--primary', 'admin-catalog-save', null);
        actions.appendChild(saveBtn);
        form.appendChild(actions);

        const onSave = async () => {
            error.hidden = true;
            const id = idInput.value.trim();
            const name = nameInput.value.trim();
            if (!isEdit && !id) { showFormError(error, 'Informe um ID.'); return; }
            if (!name) { showFormError(error, 'Informe um nome.'); return; }

            let config;
            try {
                config = JSON.parse(configInput.value);
            } catch (err) {
                showFormError(error, `JSON inválido: ${err.message}`);
                return;
            }

            // A basemap may carry a MapLibre `style` override — validate it before saving so a
            // malformed style can never reach (and brick) the map.
            if (category === 'basemap' && config && config.style !== undefined) {
                const v = validateMapLibreStyle(config.style);
                if (!v.ok) {
                    showFormError(error, `Estilo MapLibre inválido: ${v.errors.join(' ')}`);
                    return;
                }
            }

            // Merge the media fields onto the parsed config. A freshly-picked thumbnail wins; an
            // explicit "Remover" deletes it; an untouched field keeps the JSON value. The video URL is
            // set when provided and DELETED when the field is cleared (so removal isn't a no-op).
            if (config && typeof config === 'object') {
                if (thumbKey) {
                    if (removeThumbnail) delete config[thumbKey];
                    else if (pendingThumbnail) config[thumbKey] = pendingThumbnail;
                }
                if (videoInput) {
                    const vid = videoInput.value.trim();
                    if (vid) config.previewVideo = vid;
                    else delete config.previewVideo;
                }
                if (enabledInput) {
                    config.enabled = enabledInput.checked;
                    const pr = Number(priorityInput.value.trim());
                    config.priority = Number.isFinite(pr) ? pr : (config.priority ?? 0);
                }
            }

            const sort = Number(sortInput.value.trim());
            const payload = {
                name,
                description: descInput.value.trim(),
                config,
                sort_order: Number.isFinite(sort) ? sort : 0,
            };
            saveBtn.disabled = true;
            try {
                if (isEdit) {
                    await apiClient.updateResource(resource.id, payload);
                    showSuccess('Item atualizado.');
                } else {
                    await apiClient.createResource({ id, category, ...payload });
                    showSuccess('Item criado.');
                }
                if (this._alive) this._selectCategory(category);
            } catch (err) {
                showFormError(error, err?.message || 'Falha ao salvar o item.');
                saveBtn.disabled = false;
            }
        };
        saveBtn.addEventListener('click', onSave);

        c.appendChild(form);
    }

    /** @private */
    async _deleteResource(resource) {
        const ok = await showConfirm(`Excluir "${resource.name || resource.id}" do catálogo?`,
            { destructive: true, confirmText: 'Excluir' });
        if (!ok) return;
        try {
            await apiClient.deleteResource(resource.id);
            showSuccess('Item excluído.');
            if (this._alive) this._selectCategory(this._category);
        } catch (err) {
            showError(err?.message || 'Falha ao excluir o item.');
        }
    }

    // ----- 360 projects (metadata only) -----

    /** @private */
    async _render360List() {
        const c = this._content;
        c.replaceChildren();

        const note = document.createElement('p');
        note.className = 'admin-form__hint';
        note.textContent = 'O envio do bundle 360° é feito fora do painel; aqui você gerencia os metadados (status/exclusão).';
        c.appendChild(note);

        const wrap = card({ testid: 'admin-360-list', padded: false });
        wrap.classList.add('admin-users__table-wrap');
        const loading = document.createElement('p');
        loading.className = 'admin-users__status';
        loading.textContent = 'Carregando projetos 360°…';
        wrap.appendChild(loading);
        c.appendChild(wrap);

        let projects;
        try {
            projects = await apiClient.listSv360Projects();
        } catch (error) {
            if (!this._alive) return;
            loading.textContent = 'Falha ao carregar os projetos 360°.';
            showError(error?.message || 'Falha ao carregar os projetos 360°.');
            return;
        }
        if (!this._alive) return;
        const list = Array.isArray(projects) ? projects : (projects?.projects ?? []);
        this._render360Table(wrap, list);
    }

    /** @private */
    _render360Table(wrap, projects) {
        wrap.replaceChildren();
        if (projects.length === 0) {
            const empty = document.createElement('p');
            empty.className = 'admin-users__status';
            empty.textContent = 'Nenhum projeto 360°.';
            wrap.appendChild(empty);
            return;
        }
        const table = document.createElement('table');
        table.className = 'admin-users__table';
        const thead = document.createElement('thead');
        const hrow = document.createElement('tr');
        for (const h of ['Nome', 'Slug', 'Fotos', 'Status', 'Ações']) {
            const th = document.createElement('th');
            th.textContent = h;
            hrow.appendChild(th);
        }
        thead.appendChild(hrow);
        table.appendChild(thead);

        const tbody = document.createElement('tbody');
        for (const p of projects) {
            const slug = p.slug ?? p.name;
            const enabled = (p.status ?? p.state) === 'enabled';
            const tr = document.createElement('tr');
            tr.dataset.testid = 'admin-360-row';
            tr.dataset.slug = slug;
            tr.appendChild(cell(p.name || ''));
            tr.appendChild(cell(slug || ''));
            tr.appendChild(cell(String(p.photo_count ?? p.photoCount ?? '')));

            const statusCell = document.createElement('td');
            const badge = document.createElement('span');
            badge.className = `admin-users__badge admin-users__badge--${enabled ? 'active' : 'inactive'}`;
            badge.textContent = enabled ? 'Ativo' : 'Inativo';
            statusCell.appendChild(badge);
            tr.appendChild(statusCell);

            const actions = document.createElement('td');
            actions.className = 'admin-users__actions';
            actions.appendChild(button(enabled ? 'Desativar' : 'Ativar', 'admin-btn admin-btn--ghost', 'admin-360-toggle',
                () => this._toggle360(slug, enabled ? 'disabled' : 'enabled')));
            actions.appendChild(button('Excluir', 'admin-btn admin-btn--danger', 'admin-360-delete',
                () => this._delete360(p)));
            tr.appendChild(actions);
            tbody.appendChild(tr);
        }
        table.appendChild(tbody);
        wrap.appendChild(table);
    }

    /** @private */
    async _toggle360(slug, status) {
        try {
            await apiClient.setSv360ProjectStatus(slug, status);
            showSuccess('Status atualizado.');
            if (this._alive) this._render360List();
        } catch (err) {
            showError(err?.message || 'Falha ao atualizar o status.');
        }
    }

    /** @private */
    async _delete360(project) {
        const slug = project.slug ?? project.name;
        const ok = await showConfirm(`Excluir o projeto 360° "${project.name || slug}"?`,
            { destructive: true, confirmText: 'Excluir' });
        if (!ok) return;
        try {
            await apiClient.deleteSv360Project(slug);
            showSuccess('Projeto 360° excluído.');
            if (this._alive) this._render360List();
        } catch (err) {
            showError(err?.message || 'Falha ao excluir o projeto.');
        }
    }
}

// ===== small DOM builders (shared shape with users-tab) =====

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

function checkboxField(form, label, testid, checked) {
    const field = document.createElement('div');
    field.className = 'admin-form__field admin-form__field--checkbox';
    const lab = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.id = testid;
    input.dataset.testid = testid;
    input.checked = !!checked;
    lab.appendChild(input);
    lab.appendChild(document.createTextNode(` ${label}`));
    field.appendChild(lab);
    form.appendChild(field);
    return input;
}

function jsonField(form, label, testid, value) {
    const field = document.createElement('div');
    field.className = 'admin-form__field';
    const lab = document.createElement('label');
    lab.textContent = label;
    lab.setAttribute('for', testid);
    field.appendChild(lab);
    const ta = document.createElement('textarea');
    ta.id = testid;
    ta.dataset.testid = testid;
    ta.className = 'admin-form__json';
    ta.rows = 16;
    ta.spellcheck = false;
    ta.value = value;
    field.appendChild(ta);
    form.appendChild(field);
    return ta;
}

function showFormError(el, msg) {
    el.textContent = msg;
    el.hidden = false;
}
