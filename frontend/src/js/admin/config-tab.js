// Path: js/admin/config-tab.js

/**
 * @fileoverview "Sistema" tab of the admin panel. Edits the STATIC/ENV parts of the runtime
 * config (app/features/map2d/map3d viewer/service URLs) that have no `resources` row, via
 * GET/PUT /config/admin (requireAdmin). Only CHANGED fields are sent, so the stored override
 * document contains exactly what an admin deliberately set (untouched values keep tracking the
 * deploy STATIC/ENV). Config is read at boot, so a "recarregar para aplicar" notice is shown.
 *
 * All dynamic text via textContent (never innerHTML with user data).
 */

import { apiClient } from '@store/sync/api-client.js';
import { showConfirm } from '@modals/confirm.modal.js';
import { showSuccess, showError } from '@utils/toast_service.js';
import { sectionHeader, ICON_CONFIG, failureState } from './admin-dom.js';

/**
 * Builds the "Sistema" tab definition for the admin panel.
 * @returns {import('./admin-panel.js').AdminTab}
 */
export function createConfigTab() {
    const tab = new ConfigTab();
    return {
        id: 'config',
        label: 'Sistema',
        testid: 'admin-tab-config',
        icon: ICON_CONFIG,
        mount: (container) => tab.mount(container),
    };
}

class ConfigTab {
    /**
     * @param {HTMLElement} container
     * @returns {Function} cleanup
     */
    mount(container) {
        this._container = container;
        this._alive = true;
        this._render();
        return () => { this._alive = false; };
    }

    /** @private */
    async _render() {
        const c = this._container;
        c.replaceChildren();
        const loading = document.createElement('p');
        loading.className = 'admin-users__status';
        loading.textContent = 'Carregando configurações…';
        c.appendChild(loading);

        let data;
        try {
            data = await apiClient.getConfigAdmin();
        } catch (error) {
            if (!this._alive) return;
            // A SAÍDA que faltava. Ver `failureState` em `admin-dom.js`: falha de carregamento era
            // beco sem saída nas seis abas, e o único caminho era recarregar a página.
            loading.replaceChildren(failureState('Falha ao carregar as configurações.', {
                onRetry: () => { if (this._alive) this._render(); },
            }));
            showError(error?.message || 'Falha ao carregar as configurações.');
            return;
        }
        if (!this._alive) return;
        this._buildForm(data.effective || {}, data.overrides || {});
    }

    /**
     * @private
     * @param {Object} eff - The effective config (used to prefill + diff on save).
     * @param {Object} overrides - The current stored override document (prefills the advanced editor).
     */
    _buildForm(eff, overrides) {
        const c = this._container;
        c.replaceChildren();
        c.appendChild(sectionHeader('Sistema', {
            subtitle: 'Configurações globais — aplicadas no próximo carregamento da página',
        }));

        const form = document.createElement('form');
        form.className = 'admin-form admin-form--wide';
        form.dataset.testid = 'admin-config-form';

        heading(form, 'Aplicação');
        const appTitle = text(form, 'Título', 'admin-config-app-title', eff.app?.title ?? '');
        const appTutorial = text(form, 'URL do tutorial', 'admin-config-app-tutorial', eff.app?.tutorialUrl ?? '');

        heading(form, 'Funcionalidades');
        const fMap3d = check(form, 'Mapa 3D', 'admin-config-feat-map3d', !!eff.features?.map_3d);
        const fPan = check(form, 'Imagens panorâmicas (360°)', 'admin-config-feat-pan', !!eff.features?.imagens_panoramicas);
        const fGrid = check(form, 'Grade (UTM)', 'admin-config-feat-grid', !!eff.features?.grid);
        const fSearch = check(form, 'Busca por API', 'admin-config-feat-search', !!eff.features?.apisearch);

        heading(form, 'Mapa 2D');
        const minZoom = number(form, 'Zoom mínimo', 'admin-config-map2d-minzoom', eff.map2d?.minZoom);
        const maxZoom = number(form, 'Zoom máximo', 'admin-config-map2d-maxzoom', eff.map2d?.maxZoom);
        const maxPitch = number(form, 'Inclinação máxima', 'admin-config-map2d-maxpitch', eff.map2d?.maxPitch);
        const globe = check(form, 'Projeção globo', 'admin-config-map2d-globe', !!eff.map2d?.globe_projection);

        const viewer = eff.map3d?.viewer || {};
        const viewerInputs = {};
        const viewerKeys = Object.keys(viewer);
        if (viewerKeys.length) {
            heading(form, 'Mapa 3D — controles do viewer');
            for (const k of viewerKeys) {
                viewerInputs[k] = check(form, k, `admin-config-map3d-${k}`, !!viewer[k]);
            }
        }

        heading(form, 'Serviços');
        const tileUrl = text(form, 'Tile server (URL)', 'admin-config-tileurl', eff.services?.tileServerUrl ?? '');

        heading(form, 'Avançado (JSON)');
        const advHint = document.createElement('p');
        advHint.className = 'admin-form__hint';
        advHint.textContent = 'Sobrescreve QUALQUER chave do config (ex.: map2d.terrainSource/hillshade/bounds, '
            + 'map3d.initialCamera/providers/bounds, streetView360, analysisLayers.enabled). Mesclado sobre o '
            + 'padrão; os campos acima têm precedência. Salvar MESCLA (não remove chaves): para remover, use '
            + '"Limpar todos os overrides". Catálogo (basemaps/camadas/3D) é gerenciado na aba Catálogo.';
        form.appendChild(advHint);
        const advInput = jsonField(form, 'Overrides avançados (JSON)', 'admin-config-advanced',
            JSON.stringify(overrides ?? {}, null, 2));

        const clearBtn = button('Limpar todos os overrides', 'admin-btn admin-btn--danger', 'admin-config-clear');
        clearBtn.addEventListener('click', async () => {
            // A CONTAGEM VEM DO QUE JÁ ESTÁ NA TELA. O textarea ao lado carrega o documento inteiro
        // de overrides, então o número de seções que este botão apaga é conhecido no instante do
        // clique. "Limpar TODOS" sem dizer quantos são é o pedido de confirmação mais vago do
        // painel, e ele é irreversível.
        const secoes = Object.keys(overrides ?? {});
        const quantas = secoes.length === 0
            ? 'Não há nenhum override gravado: nada muda.'
            : `Isto apaga ${secoes.length} ${secoes.length === 1 ? 'seção' : 'seções'} de `
              + `override (${secoes.join(', ')}) e devolve a configuração ao padrão do deploy.`;
        const ok = await showConfirm('Limpar TODOS os overrides do sistema?', {
                message: quantas,
                destructive: true,
                confirmText: 'Limpar tudo',
            });
            if (!ok) return;
            try {
                await apiClient.clearConfigOverrides();
                showSuccess('Overrides limpos. Recarregue para aplicar.');
                if (this._alive) this._render();
            } catch (err) {
                showError(err?.message || 'Falha ao limpar os overrides.');
            }
        });
        form.appendChild(clearBtn);

        const error = document.createElement('div');
        error.className = 'admin-form__error';
        error.dataset.testid = 'admin-config-error';
        error.hidden = true;
        error.setAttribute('role', 'alert');
        form.appendChild(error);

        const notice = document.createElement('p');
        notice.className = 'admin-form__hint';
        notice.dataset.testid = 'admin-config-notice';
        notice.hidden = true;
        notice.textContent = 'Configurações salvas. Recarregue a página para aplicar.';
        form.appendChild(notice);

        const actions = document.createElement('div');
        actions.className = 'admin-form__actions';
        const saveBtn = button('Salvar', 'admin-btn admin-btn--primary', 'admin-config-save');
        actions.appendChild(saveBtn);
        form.appendChild(actions);

        const onSave = async () => {
            error.hidden = true;
            notice.hidden = true;

            const payload = {};
            // app — title can't be cleared to empty (schema), so only include a non-empty change.
            const appDiff = {};
            const titleVal = appTitle.value.trim();
            if (titleVal && titleVal !== (eff.app?.title ?? '')) appDiff.title = titleVal;
            if (appTutorial.value.trim() !== (eff.app?.tutorialUrl ?? '')) appDiff.tutorialUrl = appTutorial.value.trim();
            if (Object.keys(appDiff).length) payload.app = appDiff;

            const featDiff = {};
            diffBool(featDiff, 'map_3d', fMap3d.checked, !!eff.features?.map_3d);
            diffBool(featDiff, 'imagens_panoramicas', fPan.checked, !!eff.features?.imagens_panoramicas);
            diffBool(featDiff, 'grid', fGrid.checked, !!eff.features?.grid);
            diffBool(featDiff, 'apisearch', fSearch.checked, !!eff.features?.apisearch);
            if (Object.keys(featDiff).length) payload.features = featDiff;

            const map2dDiff = {};
            diffNum(map2dDiff, 'minZoom', minZoom, eff.map2d?.minZoom);
            diffNum(map2dDiff, 'maxZoom', maxZoom, eff.map2d?.maxZoom);
            diffNum(map2dDiff, 'maxPitch', maxPitch, eff.map2d?.maxPitch);
            diffBool(map2dDiff, 'globe_projection', globe.checked, !!eff.map2d?.globe_projection);
            if (Object.keys(map2dDiff).length) payload.map2d = map2dDiff;

            const viewerDiff = {};
            for (const [k, inp] of Object.entries(viewerInputs)) {
                diffBool(viewerDiff, k, inp.checked, !!viewer[k]);
            }
            if (Object.keys(viewerDiff).length) payload.map3d = { viewer: viewerDiff };

            if (tileUrl.value.trim() !== (eff.services?.tileServerUrl ?? '')) {
                payload.services = { tileServerUrl: tileUrl.value.trim() };
            }

            // Advanced raw overrides (any config path). The curated payload above wins on conflict.
            let advanced = {};
            const advText = advInput.value.trim();
            if (advText) {
                try {
                    advanced = JSON.parse(advText);
                } catch (err) {
                    error.textContent = `JSON avançado inválido: ${err.message}`;
                    error.hidden = false;
                    return;
                }
                if (advanced === null || typeof advanced !== 'object' || Array.isArray(advanced)) {
                    error.textContent = 'O JSON avançado deve ser um objeto.';
                    error.hidden = false;
                    return;
                }
            }
            const merged = deepMerge(advanced, payload);

            if (Object.keys(merged).length === 0) {
                showSuccess('Nenhuma alteração a salvar.');
                return;
            }

            saveBtn.disabled = true;
            try {
                await apiClient.updateConfigOverrides(merged);
                showSuccess('Configurações salvas.');
                notice.hidden = false;
                // RELÊ DEPOIS DE SALVAR, como o botão de limpar ao lado já fazia. O formulário fechava sobre
                // o `eff` da montagem e comparava TODO diff contra ele, então um segundo salvamento na mesma
                // sessão media a diferença contra o estado ANTERIOR ao primeiro: o que já tinha sido gravado
                // era reenviado, e o que tinha sido revertido no servidor não aparecia. A tela também não
                // mostrava o que o servidor de fato aceitou.
                if (this._alive) this._render();
            } catch (err) {
                error.textContent = err?.message || 'Falha ao salvar as configurações.';
                error.hidden = false;
            } finally {
                saveBtn.disabled = false;
            }
        };

        saveBtn.addEventListener('click', onSave);
        // Enter inside a field submits the form; handle it without a native navigation.
        form.addEventListener('submit', (e) => { e.preventDefault(); onSave(); });

        c.appendChild(form);
    }
}

// ===== diff helpers =====

function diffBool(target, key, current, original) {
    if (current !== original) target[key] = current;
}

function diffNum(target, key, input, original) {
    const v = numVal(input);
    if (v !== undefined && v !== original) target[key] = v;
}

function numVal(input) {
    const v = input.value.trim();
    if (v === '') return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
}

// ===== small DOM builders =====

function heading(form, label) {
    const h = document.createElement('h3');
    h.className = 'admin-form__heading';
    h.textContent = label;
    form.appendChild(h);
}

function text(form, label, testid, value) {
    return field(form, label, testid, 'text', value);
}

function number(form, label, testid, value) {
    return field(form, label, testid, 'number', value ?? '');
}

function field(form, label, testid, type, value) {
    const wrap = document.createElement('div');
    wrap.className = 'admin-form__field';
    const lab = document.createElement('label');
    lab.textContent = label;
    lab.setAttribute('for', testid);
    wrap.appendChild(lab);
    const input = document.createElement('input');
    input.type = type;
    input.id = testid;
    input.dataset.testid = testid;
    input.value = value;
    wrap.appendChild(input);
    form.appendChild(wrap);
    return input;
}

function check(form, label, testid, checked) {
    const wrap = document.createElement('label');
    wrap.className = 'admin-form__field admin-form__field--checkbox';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.id = testid;
    input.dataset.testid = testid;
    input.checked = checked;
    wrap.appendChild(input);
    wrap.appendChild(document.createTextNode(label));
    form.appendChild(wrap);
    return input;
}

function button(label, className, testid) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = className;
    btn.dataset.testid = testid;
    btn.textContent = label;
    return btn;
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
    ta.rows = 10;
    ta.spellcheck = false;
    ta.value = value;
    field.appendChild(ta);
    form.appendChild(field);
    return ta;
}

/** Deep-merges `override` onto `base` (override wins; objects merge; arrays/scalars replace). */
function deepMerge(base, override) {
    if (override === null || typeof override !== 'object' || Array.isArray(override)) {
        return override === undefined ? base : override;
    }
    const out = base && typeof base === 'object' && !Array.isArray(base) ? { ...base } : {};
    for (const [k, v] of Object.entries(override)) {
        out[k] = v && typeof v === 'object' && !Array.isArray(v) ? deepMerge(out[k], v) : v;
    }
    return out;
}
