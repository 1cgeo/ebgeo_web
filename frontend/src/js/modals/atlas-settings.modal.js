// Path: js/modals/atlas-settings.modal.js

/**
 * @fileoverview As configurações DO PROJETO, num lugar só: como o mapa se parece (exagero
 * vertical, projeção), o que ele oferece (3D, 360, dados, análise), quais mapas base e quais
 * itens do catálogo.
 *
 * ELE ABRE EM QUALQUER ATLAS, e é a diferença que reorganizou o arquivo. Antes ele era exclusivo
 * do atlas de servidor com papel de Gestor, vivia escondido no menu da conta, e a única
 * configuração que um usuário local alcançava (o exagero) morava num segundo modal, com outro
 * título e outro visual. Duas telas de "Configurações" era uma a mais.
 *
 * O QUE APARECE DEPENDE DO QUE PODE SER SALVO, e não do que é bonito mostrar:
 *
 * - **Aparência** aparece SEMPRE. Ela viaja como operação de sync (`atlas-appearance.service.js`),
 *   que é o único caminho que existe num atlas local e que num remoto é gateado por `write` — a
 *   mesma régua de desenhar, porque escolher exagero não redistribui recurso nenhum.
 * - **Recursos, Mapas base e Catálogo** exigem atlas de SERVIDOR e papel de Gestor, porque o
 *   backend exige `manage` no `PATCH /settings` e porque a restrição por atlas só tem efeito
 *   sobre um `config` que o servidor hidratou. Mostrá-las a quem não pode salvá-las seria
 *   oferecer um formulário que responde 403.
 *
 * A aparência é aplicada AO VIVO enquanto se mexe (um exagero que só aparece depois de salvar é
 * impossível de ajustar) e revertida ao cancelar. O resto só existe depois do Salvar.
 *
 * Exporta {@link showAtlasSettingsModal}.
 */

import { ModalBase } from './modal.base.js';
import { addScopedDomListener, clearScopedListeners } from '@utils/event-cleanup.js';
import { escapeHtml } from '@utils/html-escape.js';
import { apiClient } from '@store/sync/api-client.js';
import { showError, showSuccess } from '@utils/toast_service.js';
import config from '@js/config.js';
import { getControl } from '@store';
import { getDeployDataLayers, getDeployAnalysisLayers, getDeployTilesets } from '@store/sync/atlas-settings.service.js';
import {
    readAtlasAppearance,
    saveAtlasAppearance,
    setGlobeChoice,
    currentGlobeProjection,
    MIN_EXAGGERATION,
    MAX_EXAGGERATION,
} from '@store/atlas-appearance.service.js';
import { CatalogService } from '@catalog/catalog.service.js';
import { createCatalogFilters, updateFilterCounts } from '@catalog/components/catalog-filters.js';
import { createCatalogHeader } from '@catalog/components/catalog-header.js';
import { createCatalogGrid } from '@catalog/components/catalog-grid.js';
import { CATALOG_TYPE_CONFIG, CATALOG_ITEM_TYPES, CATALOG_MODAL_FILTERS, DEFAULT_THUMBNAILS } from '@catalog/catalog.constants.js';

/* Ícones estáticos (sem dado de usuário — seguro injetar). */
const ICON_3D = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></svg>';
const ICON_360 = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a13 13 0 0 1 0 18 13 13 0 0 1 0-18z"/></svg>';
const ICON_TERRAIN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m3 20 6-10 4 6 3-4 5 8z"/></svg>';
const ICON_BASEMAP = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 4-6 2v14l6-2 6 2 6-2V4l-6 2-6-2z"/><path d="M9 4v14M15 6v14"/></svg>';
const ICON_DATA = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m12 2 9 5-9 5-9-5 9-5z"/><path d="m3 12 9 5 9-5"/><path d="m3 17 9 5 9-5"/></svg>';
const ICON_ANALYSIS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3v18h18"/><path d="m7 14 4-4 3 3 5-6"/></svg>';
const ICON_LOOK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a13 13 0 0 1 0 18 13 13 0 0 1 0-18z"/></svg>';
const ICON_GRID = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>';

/** Chaves de `settings.features` expostas no modal. */
const FEATURE_FIELDS = [
    { key: 'map_3d', label: 'Mapa 3D', icon: ICON_3D, hint: 'Modelos e navegação em três dimensões' },
    { key: 'panoramic_images', label: 'Imagens panorâmicas (360°)', icon: ICON_360, hint: 'Fotos esféricas navegáveis' },
    { key: 'terrain_3d', label: 'Terreno 3D', icon: ICON_TERRAIN, hint: 'Relevo com altimetria' },
    { key: 'data_layers', label: 'Dados', icon: ICON_DATA, hint: 'Camadas de dados do catálogo' },
    { key: 'analysis_layers', label: 'Análise', icon: ICON_ANALYSIS, hint: 'Camadas de análise do catálogo' },
];

/** As duas respostas da projeção. Globo é o padrão: um atlas sem escolha nasce redondo. */
const PROJECTION_CHOICES = [
    { id: 'globo', label: 'Globo', value: true },
    { id: 'plano', label: 'Plano', value: false },
];

/**
 * Modal de configurações do projeto.
 * @extends ModalBase
 */
export class AtlasSettingsModal extends ModalBase {
    /**
     * @param {string|null} atlasId - UUID do atlas de servidor, ou null num atlas local.
     * @param {Object} [options]
     * @param {string} [options.atlasName] - Nome exibido no cabeçalho.
     * @param {boolean} [options.canManage] - Se o usuário pode salvar as restrições do projeto.
     *   O backend reimpõe `manage` de qualquer forma; isto só decide o que a tela oferece.
     */
    constructor(atlasId, { atlasName, canManage = false } = {}) {
        super({
            id: 'atlas-settings-modal',
            title: atlasName ? `Configurações de ${atlasName}` : 'Configurações do projeto',
            destroyOnHide: true,
        });
        this._atlasId = atlasId || null;
        /** Restrições de projeto só existem num atlas de servidor que este usuário administra. */
        this._canRestrict = !!this._atlasId && !!canManage;
        this._settings = null;
        this._appearance = null;
        /** O valor de partida, para o Cancelar poder desfazer o que foi aplicado ao vivo. */
        this._appearanceBaseline = null;
        this._busy = false;
        this._section = 'aparencia';
    }

    /** @returns {HTMLElement} */
    render() {
        const overlay = super.render();
        this._overlay.dataset.testid = 'atlas-settings-modal';
        this.getBody().innerHTML = '<div class="sharing__state" data-testid="atlas-settings-loading">Carregando…</div>';
        document.body.appendChild(overlay);
        this._load();
        return overlay;
    }

    /**
     * @private Lê o que existe e desenha.
     *
     * `destroyOnHide` faz o Escape durante a requisição derrubar o DOM, e `getBody()` passa a
     * devolver undefined — daí a checagem nos dois ramos. NÃO guarde em `this._isOpen`: `_load()`
     * é disparado por `render()`, ANTES de `show()`.
     */
    async _load() {
        try {
            this._appearance = await readAtlasAppearance();
            this._appearanceBaseline = { ...this._appearance };
            // As restrições só existem no servidor; num atlas local não há o que buscar, e um
            // GET com atlasId null responderia 404 e mostraria "não foi possível carregar" para
            // uma tela que está inteira funcionando.
            this._settings = this._canRestrict
                ? ((await apiClient.getAtlasSettings(this._atlasId)) || {})
                : {};
            if (!this.getBody()) return;
            this._renderBody();
        } catch {
            const body = this.getBody();
            if (!body) return;
            body.innerHTML =
                '<div class="sharing__state sharing__state--error" data-testid="atlas-settings-error">Não foi possível carregar as configurações.</div>';
        }
    }

    /**
     * @private
     * @returns {string[]} Mapas base habilitados no DEPLOY. A restrição por atlas só RESTRINGE
     * (nunca reabilita o que o deploy desligou), então listar um mapa base desligado seria
     * oferecer um interruptor que não acende nada.
     */
    _allBasemapIds() {
        if (!config.basemaps) return [];
        return Object.entries(config.basemaps)
            .filter(([, cfg]) => cfg && cfg.enabled !== false)
            .map(([id]) => id);
    }

    /** @private As seções que este atlas e este usuário realmente têm. */
    _sections() {
        const sections = [{ id: 'aparencia', label: 'Aparência', icon: ICON_LOOK }];
        if (this._canRestrict) {
            sections.push({ id: 'recursos', label: 'Recursos', icon: ICON_3D });
            sections.push({ id: 'basemaps', label: 'Mapas base', icon: ICON_BASEMAP });
            sections.push({ id: 'catalogo', label: 'Catálogo', icon: ICON_GRID });
        }
        return sections;
    }

    /** @private */
    _renderBody() {
        const body = this.getBody();
        if (!body) return;
        clearScopedListeners(this, 'body');

        const sections = this._sections();
        const nav = sections.map((s) => `
            <button type="button" class="atlas-config__nav-item${s.id === this._section ? ' atlas-config__nav-item--active' : ''}"
                    data-section="${s.id}" role="tab" aria-selected="${s.id === this._section}"
                    data-testid="atlas-settings-nav-${s.id}">
                <span class="atlas-config__nav-icon">${s.icon}</span>
                <span>${escapeHtml(s.label)}</span>
            </button>
        `).join('');

        body.innerHTML = `
            <div class="atlas-config${sections.length === 1 ? ' atlas-config--single' : ''}">
                <nav class="atlas-config__nav" role="tablist" aria-label="Seções de configuração">${nav}</nav>
                <div class="atlas-config__content">
                    ${this._appearancePane()}
                    ${this._canRestrict ? this._featuresPane() : ''}
                    ${this._canRestrict ? this._basemapsPane() : ''}
                    ${this._canRestrict ? '<div class="atlas-config__pane atlas-config__pane--catalog" data-pane="catalogo" hidden></div>' : ''}
                </div>
            </div>
            <div class="atlas-config__actions">
                <span class="atlas-config__scope" data-testid="atlas-settings-scope">${
    this._canRestrict
        ? 'Vale para todos os participantes deste projeto.'
        : 'Vale para este projeto, neste computador e para quem o compartilha.'
}</span>
                <button type="button" class="atlas-config__btn-cancel" data-action="cancel">Cancelar</button>
                <button type="button" class="prompt-modal-btn prompt-modal-btn-confirm"
                        data-action="save" data-testid="atlas-settings-save">Salvar</button>
            </div>
        `;

        this._catalogReady = this._canRestrict ? this._initCatalogTab() : Promise.resolve();
        body.querySelectorAll('[data-section]').forEach((btn) => {
            addScopedDomListener(this, 'body', btn, 'click', () => this._switchSection(btn.dataset.section));
        });
        this._wireAppearance(body);

        const save = body.querySelector('[data-action="save"]');
        if (save) addScopedDomListener(this, 'body', save, 'click', () => this._handleSave());
        const cancel = body.querySelector('[data-action="cancel"]');
        if (cancel) addScopedDomListener(this, 'body', cancel, 'click', () => this._handleCancel());
        this._switchSection(this._section);
    }

    /** @private A seção que todo atlas tem. */
    _appearancePane() {
        const exaggeration = this._appearance.terrainExaggeration;
        // `!== false` e não uma busca pelo valor: um atlas que nunca escolheu (null/ausente) é
        // globo, e a barra precisa mostrar globo marcado em vez de nenhuma opção acesa.
        const choiceId = this._appearance.globeProjection === false ? 'plano' : 'globo';
        const options = PROJECTION_CHOICES.map((c) => `
            <button type="button" class="atlas-config__segment${c.id === choiceId ? ' atlas-config__segment--active' : ''}"
                    data-projection="${c.id}" data-testid="atlas-settings-projection-${c.id}"
                    aria-pressed="${c.id === choiceId}">${escapeHtml(c.label)}</button>
        `).join('');

        return `
            <div class="atlas-config__pane" data-pane="aparencia">
                <section class="atlas-config__section">
                    <div class="atlas-config__section-head">
                        <h3 class="atlas-config__section-title">Exagero vertical</h3>
                        <p class="atlas-config__section-desc">Multiplica a altura do relevo no terreno 3D. Não muda nenhuma medida, só o desenho.</p>
                    </div>
                    <div class="atlas-config__slider-row">
                        <span class="atlas-config__slider-bound">${MIN_EXAGGERATION}x</span>
                        <input type="range" class="atlas-config__slider" data-testid="atlas-settings-exaggeration"
                               min="${MIN_EXAGGERATION}" max="${MAX_EXAGGERATION}" step="0.1" value="${exaggeration}">
                        <span class="atlas-config__slider-bound">${MAX_EXAGGERATION}x</span>
                        <output class="atlas-config__slider-value" data-testid="atlas-settings-exaggeration-value">${exaggeration.toFixed(1)}x</output>
                    </div>
                </section>
                <section class="atlas-config__section">
                    <div class="atlas-config__section-head">
                        <h3 class="atlas-config__section-title">Projeção do mapa 2D</h3>
                        <p class="atlas-config__section-desc">O globo mostra a curvatura da Terra; o plano é a projeção tradicional. Todo projeto começa como globo.</p>
                    </div>
                    <div class="atlas-config__segmented" role="group" aria-label="Projeção do mapa">${options}</div>
                    <p class="atlas-config__note">Ao ligar o terreno 3D o mapa vira plano de qualquer forma: globo e relevo não convivem.</p>
                </section>
            </div>
        `;
    }

    /** @private */
    _featuresPane() {
        const features = this._settings.features || {};
        const rows = FEATURE_FIELDS.map((f) => `
            <li class="atlas-config__item">
                <span class="atlas-config__item-icon">${f.icon}</span>
                <span class="atlas-config__item-text">
                    <span class="atlas-config__item-label">${escapeHtml(f.label)}</span>
                    <span class="atlas-config__item-hint">${escapeHtml(f.hint)}</span>
                </span>
                <label class="atlas-config__switch">
                    <input type="checkbox" data-feature="${escapeHtml(f.key)}"${features[f.key] !== false ? ' checked' : ''}>
                    <span class="atlas-config__switch-track"></span>
                </label>
            </li>
        `).join('');
        return `
            <div class="atlas-config__pane" data-pane="recursos" hidden>
                <section class="atlas-config__section">
                    <div class="atlas-config__section-head">
                        <h3 class="atlas-config__section-title">Recursos disponíveis</h3>
                        <p class="atlas-config__section-desc">Desligue uma categoria inteira para quem abrir este projeto. Nada aqui liga o que o sistema já desabilitou.</p>
                    </div>
                    <ul class="atlas-config__list">${rows}</ul>
                </section>
            </div>
        `;
    }

    /** @private */
    _basemapsPane() {
        const allowed = Array.isArray(this._settings.basemaps) ? this._settings.basemaps : [];
        const noRestriction = allowed.length === 0;
        const rows = this._allBasemapIds().map((id) => {
            const name = config.basemaps[id]?.name || id;
            const checked = noRestriction || allowed.includes(id);
            return `
                <li class="atlas-config__item">
                    <span class="atlas-config__item-icon">${ICON_BASEMAP}</span>
                    <span class="atlas-config__item-text">
                        <span class="atlas-config__item-label">${escapeHtml(name)}</span>
                    </span>
                    <label class="atlas-config__switch">
                        <input type="checkbox" data-basemap="${escapeHtml(id)}"${checked ? ' checked' : ''}>
                        <span class="atlas-config__switch-track"></span>
                    </label>
                </li>
            `;
        }).join('');
        return `
            <div class="atlas-config__pane" data-pane="basemaps" hidden>
                <section class="atlas-config__section">
                    <div class="atlas-config__section-head">
                        <h3 class="atlas-config__section-title">Mapas base</h3>
                        <p class="atlas-config__section-desc">Desmarque para restringir. Tudo marcado significa sem restrição.</p>
                    </div>
                    <ul class="atlas-config__list">${rows}</ul>
                </section>
            </div>
        `;
    }

    /** @private Liga o slider e o seletor de projeção, ambos com efeito imediato no mapa. */
    _wireAppearance(body) {
        const slider = body.querySelector('[data-testid="atlas-settings-exaggeration"]');
        const output = body.querySelector('[data-testid="atlas-settings-exaggeration-value"]');
        if (slider) {
            addScopedDomListener(this, 'body', slider, 'input', () => {
                const value = parseFloat(slider.value);
                if (!Number.isFinite(value)) return;
                this._appearance.terrainExaggeration = value;
                output.textContent = `${value.toFixed(1)}x`;
                getControl('TerrainControl')?.setExaggeration?.(value);
            });
        }
        body.querySelectorAll('[data-projection]').forEach((btn) => {
            addScopedDomListener(this, 'body', btn, 'click', () => {
                const choice = PROJECTION_CHOICES.find((c) => c.id === btn.dataset.projection);
                if (!choice) return;
                this._appearance.globeProjection = choice.value;
                body.querySelectorAll('[data-projection]').forEach((b) => {
                    const active = b === btn;
                    b.classList.toggle('atlas-config__segment--active', active);
                    b.setAttribute('aria-pressed', String(active));
                });
                this._applyProjection(choice.value);
            });
        });
    }

    /**
     * @private Aplica a projeção no mapa vivo.
     *
     * NÃO MEXE NO MAPA COM TERRENO LIGADO: globo e relevo são incompatíveis (MapLibre #4792), e
     * o próprio `TerrainControl` restaura a projeção ao desligar o relevo. Forçar o globo aqui
     * apagaria o terreno que o usuário está vendo.
     */
    _applyProjection(choice) {
        setGlobeChoice(choice);
        const map = globalThis.__ebgeoMap;
        if (!map?.setProjection) return;
        if (getControl('TerrainControl')?._wasTerrainActive) return;
        map.setProjection({ type: currentGlobeProjection() ? 'globe' : 'mercator' });
        map.setSky(undefined);
    }

    /** @private Troca a seção visível. */
    _switchSection(section) {
        const body = this.getBody();
        if (!body) return;
        this._section = section;
        body.querySelectorAll('[data-section]').forEach((b) => {
            const active = b.dataset.section === section;
            b.classList.toggle('atlas-config__nav-item--active', active);
            b.setAttribute('aria-selected', active ? 'true' : 'false');
        });
        body.querySelectorAll('[data-pane]').forEach((p) => {
            p.hidden = p.dataset.pane !== section;
        });
    }

    /** @private Monta itens em forma de CatalogItem para os conjuntos COMPLETOS do deploy. */
    async _buildCatalogItems() {
        const T = CATALOG_ITEM_TYPES;
        const items = [];
        for (const t of getDeployTilesets()) {
            items.push({ id: `3d-${t.id}`, type: T.MODEL_3D, name: t.name, description: t.description || null,
                thumbnail: t.previewThumbnail || DEFAULT_THUMBNAILS[T.MODEL_3D], originalData: t });
        }
        // As vistas 360 vêm do cache de preflight do sv360 (módulo lazy) — nunca filtradas pelo overlay.
        try {
            const { getCachedProjects } = await import('@js/street_view_tool/streetview-api.service.js');
            const serviceUrl = config.streetView360?.serviceUrl || '';
            for (const p of (getCachedProjects() || [])) {
                items.push({ id: `360-${p.id}`, type: T.PANORAMIC_360, name: p.name, description: p.description || null,
                    thumbnail: p.previewThumbnail ? `${serviceUrl}${p.previewThumbnail}` : DEFAULT_THUMBNAILS[T.PANORAMIC_360],
                    originalData: p });
            }
        } catch { /* sv360 indisponível — sem itens 360 */ }
        for (const l of getDeployDataLayers()) {
            items.push({ id: `data-${l.id}`, type: T.DATA_LAYER, name: l.name, description: l.description || null,
                thumbnail: l.thumbnail || DEFAULT_THUMBNAILS[T.DATA_LAYER], originalData: l });
        }
        for (const l of getDeployAnalysisLayers()) {
            items.push({ id: `analysis-${l.id}`, type: T.ANALYSIS_LAYER, name: l.name, description: l.description || null,
                thumbnail: l.thumbnail || DEFAULT_THUMBNAILS[T.ANALYSIS_LAYER], originalData: l });
        }
        return items;
    }

    /** @private Semeia o conjunto permitido: allowlist VAZIA de uma categoria = categoria inteira. */
    _seedCatalogAllowed() {
        const set = new Set();
        const seed = (saved, type) => {
            const ids = this._catalogItems.filter((i) => i.type === type).map((i) => i.originalData.id);
            const allow = Array.isArray(saved) ? saved : [];
            (allow.length === 0 ? ids : allow).forEach((id) => set.add(id));
        };
        seed(this._settings.available_3d_models, CATALOG_ITEM_TYPES.MODEL_3D);
        seed(this._settings.available_360_views, CATALOG_ITEM_TYPES.PANORAMIC_360);
        seed(this._settings.available_data_layers, CATALOG_ITEM_TYPES.DATA_LAYER);
        seed(this._settings.available_analysis_layers, CATALOG_ITEM_TYPES.ANALYSIS_LAYER);
        return set;
    }

    /**
     * @private Compõe o painel do Catálogo (filtros + busca + grade selecionável + ações em lote).
     * Nunca rejeita: em qualquer falha `_catalogItems`/`_catalogAllowed` caem para vazio, de modo
     * que a promessa `_catalogReady` que o `_handleSave` espera sempre resolve.
     */
    async _initCatalogTab() {
        try {
            this._catalogItems = await this._buildCatalogItems();
        } catch {
            this._catalogItems = [];
        }
        if (!Array.isArray(this._catalogItems)) this._catalogItems = [];
        try {
            this._catalogAllowed = this._seedCatalogAllowed();
        } catch {
            this._catalogAllowed = new Set();
        }
        if (!(this._catalogAllowed instanceof Set)) this._catalogAllowed = new Set();
        this._catalogFiltersActive = new Set();
        this._catalogSearch = '';

        try {
            const pane = this.getBody().querySelector('[data-pane="catalogo"]');
            const layout = document.createElement('div');
            layout.className = 'catalog-layout';

            this._catalogFiltersEl = createCatalogFilters({
                types: CATALOG_TYPE_CONFIG,
                activeFilters: this._catalogFiltersActive,
                onFilterChange: (type, active) => {
                    if (active) this._catalogFiltersActive.add(type); else this._catalogFiltersActive.delete(type);
                    this._renderCatalogGrid();
                },
            });
            layout.appendChild(this._catalogFiltersEl);

            const main = document.createElement('div');
            main.className = 'catalog-main';
            main.appendChild(createCatalogHeader({ onSearch: (q) => { this._catalogSearch = q; this._renderCatalogGrid(); } }));
            main.appendChild(this._catalogBulkBar());
            this._catalogGridWrap = document.createElement('div');
            this._catalogGridWrap.className = 'catalog-grid-wrapper';
            main.appendChild(this._catalogGridWrap);
            layout.appendChild(main);
            pane.appendChild(layout);

            updateFilterCounts(this._catalogFiltersEl, this._catalogCounts());
            this._renderCatalogGrid();
        } catch { /* painel indisponível — Salvar ainda funciona a partir do conjunto semeado */ }
    }

    /**
     * @private As ações em lote do catálogo.
     *
     * ELAS OPERAM SOBRE O QUE ESTÁ NA TELA, e é o que as torna úteis num catálogo de centenas de
     * itens: filtre por "Modelos 3D", busque "ponte", desligue os doze de uma vez. Um "desabilitar
     * todos" que ignorasse o filtro seria um botão que ninguém usa duas vezes, porque a primeira
     * apaga uma escolha que levou minutos. O rótulo diz quantos itens serão afetados, sempre.
     */
    _catalogBulkBar() {
        const bar = document.createElement('div');
        bar.className = 'atlas-config__bulk';

        const label = document.createElement('span');
        label.className = 'atlas-config__bulk-label';
        label.dataset.testid = 'atlas-settings-bulk-label';
        this._catalogBulkLabel = label;
        bar.appendChild(label);

        const makeBtn = (text, testid, enable) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'atlas-config__bulk-btn';
            btn.dataset.testid = testid;
            btn.textContent = text;
            addScopedDomListener(this, 'body', btn, 'click', () => this._bulkToggleVisible(enable));
            return btn;
        };
        bar.appendChild(makeBtn('Habilitar visíveis', 'atlas-settings-enable-all', true));
        bar.appendChild(makeBtn('Desabilitar visíveis', 'atlas-settings-disable-all', false));
        return bar;
    }

    /**
     * @private Liga ou desliga TODOS os itens que a filtragem atual mostra.
     * @param {boolean} enable
     */
    _bulkToggleVisible(enable) {
        for (const item of this._visibleCatalogItems()) {
            if (enable) this._catalogAllowed.add(item.originalData.id);
            else this._catalogAllowed.delete(item.originalData.id);
        }
        this._renderCatalogGrid();
    }

    /** @private A lista que a grade está mostrando agora (filtro de tipo + busca). */
    _visibleCatalogItems() {
        let items = this._catalogItems;
        if (this._catalogFiltersActive.size > 0) {
            items = items.filter((i) => this._catalogFiltersActive.has(i.type));
        }
        if (this._catalogSearch) {
            items = CatalogService.searchItems(this._catalogSearch, items);
        }
        return items;
    }

    /** @private @returns {Object} contagem de itens por tipo de filtro. */
    _catalogCounts() {
        const counts = {};
        for (const type of CATALOG_MODAL_FILTERS) {
            counts[type] = this._catalogItems.filter((i) => i.type === type).length;
        }
        return counts;
    }

    /** @private Redesenha a grade honrando filtros + busca; cada cartão é um interruptor. */
    _renderCatalogGrid() {
        const items = this._visibleCatalogItems();
        if (this._catalogBulkLabel) {
            const on = items.filter((i) => this._catalogAllowed.has(i.originalData.id)).length;
            this._catalogBulkLabel.textContent = items.length === 0
                ? 'Nenhum item nesta filtragem'
                : `${on} de ${items.length} habilitado(s) nesta filtragem`;
        }
        this._catalogGridWrap.innerHTML = '';
        this._catalogGridWrap.appendChild(createCatalogGrid({
            items,
            selectable: true,
            allowedIds: this._catalogAllowed,
            onToggle: (item, checked) => {
                if (checked) this._catalogAllowed.add(item.originalData.id);
                else this._catalogAllowed.delete(item.originalData.id);
                // O rótulo do lote conta o que está na tela: sem isto ele mentiria a cada clique.
                this._renderCatalogGrid();
            },
        }));
    }

    /**
     * @private Cancelar: desfaz o que foi aplicado ao vivo.
     *
     * Só a aparência precisa disso, porque só ela tem efeito antes do Salvar. Sem a reversão, o
     * botão "Cancelar" deixaria o mapa exatamente como o usuário acabou de mexer, o que é a
     * definição de não cancelar.
     */
    _handleCancel() {
        const base = this._appearanceBaseline;
        if (base) {
            getControl('TerrainControl')?.setExaggeration?.(base.terrainExaggeration);
            this._applyProjection(base.globeProjection);
        }
        this.hide();
    }

    /** @private Coleta o formulário, grava e fecha. */
    async _handleSave() {
        if (this._busy) return;
        this._busy = true;
        // Corpo inteiro guardado para `_busy` SEMPRE voltar — um throw antes da chamada de rede
        // (estado do catálogo ainda não montado) travaria o modal para sempre.
        try {
            await this._catalogReady;
            const body = this.getBody();
            if (!body) return;

            // A aparência é de todo atlas, e vai primeiro: num atlas local ela é a única coisa a
            // salvar, e num remoto ela não depende do 403 que a outra chamada pode levar.
            await saveAtlasAppearance({
                terrainExaggeration: this._appearance.terrainExaggeration,
                globeProjection: this._appearance.globeProjection,
            });

            if (!this._canRestrict) {
                showSuccess('Configurações salvas.');
                this.hide();
                return;
            }

            const features = {};
            for (const f of FEATURE_FIELDS) {
                features[f.key] = !!body.querySelector(`[data-feature="${f.key}"]`)?.checked;
            }

            const allIds = this._allBasemapIds();
            const checked = allIds.filter((id) => body.querySelector(`[data-basemap="${CSS.escape(id)}"]`)?.checked);
            // Vazio OU seleção completa significam "sem restrição" ([]); um subconjunto é a allowlist.
            const basemaps = (checked.length === 0 || checked.length === allIds.length) ? [] : checked;
            const collapse = (type) => {
                const ids = this._catalogItems.filter((i) => i.type === type).map((i) => i.originalData.id);
                const allowed = ids.filter((id) => this._catalogAllowed.has(id));
                return (allowed.length === 0 || allowed.length === ids.length) ? [] : allowed;
            };

            try {
                await apiClient.updateAtlasSettings(this._atlasId, {
                    features,
                    basemaps,
                    available_3d_models: collapse(CATALOG_ITEM_TYPES.MODEL_3D),
                    available_360_views: collapse(CATALOG_ITEM_TYPES.PANORAMIC_360),
                    available_data_layers: collapse(CATALOG_ITEM_TYPES.DATA_LAYER),
                    available_analysis_layers: collapse(CATALOG_ITEM_TYPES.ANALYSIS_LAYER),
                });
                showSuccess('Configurações salvas.');
                this.hide();
            } catch {
                showError('Não foi possível salvar as configurações do projeto.');
            }
        } finally {
            this._busy = false;
        }
    }

    /** Fecha o modal, liberando os listeners com escopo antes. */
    hide() {
        clearScopedListeners(this, 'body');
        super.hide();
    }
}

/**
 * Abre as configurações do projeto montado.
 *
 * @param {string|null} atlasId - UUID do atlas de servidor, ou null num atlas local.
 * @param {Object} [options]
 * @param {string} [options.atlasName]
 * @param {boolean} [options.canManage] - Se as restrições de projeto devem ser oferecidas. O
 *   backend reimpõe `manage` na gravação de qualquer forma.
 * @returns {AtlasSettingsModal}
 */
export function showAtlasSettingsModal(atlasId, options = {}) {
    const modal = new AtlasSettingsModal(atlasId, options);
    modal.render();
    modal.show();
    return modal;
}
