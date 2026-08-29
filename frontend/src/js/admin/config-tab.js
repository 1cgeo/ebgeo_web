// Path: js/admin/config-tab.js

/**
 * @fileoverview "Sistema" tab of the admin panel. Edits the STATIC/ENV parts of the runtime
 * config (app/features/map2d/service URLs) that have no `resources` row, via
 * GET/PUT /config/admin (requireAdmin). Only CHANGED fields are sent, so the stored override
 * document contains exactly what an admin deliberately set (untouched values keep tracking the
 * deploy STATIC/ENV). Config is read at boot, so a "recarregar para aplicar" notice is shown.
 *
 * The 3D-viewer control toggles, the raw "Advanced (JSON)" editor and the "Limpar todos os
 * overrides" button were all removed on 2026-08-29 (owner decision): the curated fields cover what
 * admins actually change. Only CHANGED fields are still sent, so the stored override document holds
 * exactly what an admin set.
 *
 * All dynamic text via textContent (never innerHTML with user data).
 */

import { apiClient } from '@store/sync/api-client.js';
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
        // O AVISO DE "RECARREGUE" É ESTADO DA ABA, e não do formulário que está na tela.
        // Ver `_buildForm`: o salvamento relê o servidor e RECONSTRÓI o formulário, e um
        // aviso que morasse só no nó antigo morria nessa reconstrução. Nasce apagado a cada
        // montagem, porque quem acaba de abrir a aba não salvou nada.
        this._salvou = false;
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
        this._buildForm(data.effective || {});
    }

    /**
     * @private
     * @param {Object} eff - The effective config (used to prefill + diff on save).
     */
    _buildForm(eff) {
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

        heading(form, 'Contas');
        const fSignup = check(form, 'Permitir auto-cadastro (botão "Criar conta")',
            'admin-config-feat-signup', !!eff.features?.self_registration);
        const signupHint = document.createElement('p');
        signupHint.className = 'admin-form__hint';
        signupHint.textContent = 'Desligado, o botão "Criar conta" some e a rota de cadastro recusa (403): '
            + 'só o administrador cria contas. Aplica no próximo carregamento da página, como o resto desta aba.';
        form.appendChild(signupHint);

        heading(form, 'Mapa 2D');
        const minZoom = number(form, 'Zoom mínimo', 'admin-config-map2d-minzoom', eff.map2d?.minZoom);
        const maxZoom = number(form, 'Zoom máximo', 'admin-config-map2d-maxzoom', eff.map2d?.maxZoom);
        const maxPitch = number(form, 'Inclinação máxima', 'admin-config-map2d-maxpitch', eff.map2d?.maxPitch);
        const globe = check(form, 'Projeção globo', 'admin-config-map2d-globe', !!eff.map2d?.globe_projection);

        heading(form, 'Serviços');
        const tileUrl = text(form, 'Servidor de tiles da grade UTM (URL)', 'admin-config-tileurl',
            eff.services?.tileServerUrl ?? '');
        const tileHint = document.createElement('p');
        tileHint.className = 'admin-form__hint';
        tileHint.textContent = 'Base das fontes de vetor da GRADE UTM (as camadas de articulação de '
            + 'cartas). O mapa monta cada fonte como "<esta URL>/grid_<sistema>_<escala>". Vazio '
            + 'desliga a grade (as fontes não resolvem). Não afeta mapas base, dados nem 3D/360.';
        form.appendChild(tileHint);

        const error = document.createElement('div');
        error.className = 'admin-form__error';
        error.dataset.testid = 'admin-config-error';
        error.hidden = true;
        error.setAttribute('role', 'alert');
        form.appendChild(error);

        const notice = document.createElement('p');
        notice.className = 'admin-form__hint';
        notice.dataset.testid = 'admin-config-notice';
        // O AVISO SOBREVIVE À RECONSTRUÇÃO DO FORMULÁRIO, e isso é o conserto de um defeito
        // medido em 2026-08-25. `onSave` fazia, nesta ordem: `notice.hidden = false` e depois
        // `this._render()`. O `_render` relê `GET /config/admin` e chama `_buildForm` de novo,
        // que esvazia o container e monta um `notice` NOVO — e o novo nascia `hidden`. O aviso
        // aparecia por um instante e sumia sozinho quando a releitura voltava, de modo que
        // quem salvava nunca lia "Recarregue a página para aplicar". A configuração só entra
        // em vigor no próximo carregamento (ver o `@fileoverview`), então esta frase é a única
        // coisa na tela que explica por que nada mudou.
        //
        // O toast de sucesso NÃO substitui o aviso: ele some sozinho em poucos segundos e não
        // diz o que fazer. Este parágrafo fica até a próxima ação.
        //
        // POR QUE O ESTADO E NÃO A ORDEM DAS LINHAS: revelar o aviso DEPOIS do `await
        // this._render()` continuaria mexendo num nó que a releitura já tinha descartado.
        // O único lugar de onde o aviso pode reaparecer é a montagem do formulário.
        notice.hidden = !this._salvou;
        notice.textContent = 'Configurações salvas. Recarregue a página para aplicar.';
        form.appendChild(notice);

        const actions = document.createElement('div');
        actions.className = 'admin-form__actions';
        const saveBtn = button('Salvar', 'admin-btn admin-btn--primary', 'admin-config-save');
        actions.appendChild(saveBtn);
        form.appendChild(actions);

        const onSave = async () => {
            error.hidden = true;
            // O AVISO SE APAGA AO COMEÇAR UM SALVAMENTO NOVO, nos dois lugares: no nó que
            // está na tela e no estado que a próxima montagem lê. Só no nó, um salvamento
            // que falhasse deixaria "Configurações salvas" reaparecer na reconstrução.
            this._salvou = false;
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
            diffBool(featDiff, 'self_registration', fSignup.checked, !!eff.features?.self_registration);
            if (Object.keys(featDiff).length) payload.features = featDiff;

            const map2dDiff = {};
            diffNum(map2dDiff, 'minZoom', minZoom, eff.map2d?.minZoom);
            diffNum(map2dDiff, 'maxZoom', maxZoom, eff.map2d?.maxZoom);
            diffNum(map2dDiff, 'maxPitch', maxPitch, eff.map2d?.maxPitch);
            diffBool(map2dDiff, 'globe_projection', globe.checked, !!eff.map2d?.globe_projection);
            if (Object.keys(map2dDiff).length) payload.map2d = map2dDiff;

            if (tileUrl.value.trim() !== (eff.services?.tileServerUrl ?? '')) {
                payload.services = { tileServerUrl: tileUrl.value.trim() };
            }

            if (Object.keys(payload).length === 0) {
                showSuccess('Nenhuma alteração a salvar.');
                return;
            }

            saveBtn.disabled = true;
            try {
                await apiClient.updateConfigOverrides(payload);
                showSuccess('Configurações salvas.');
                // O ESTADO PRIMEIRO, o nó depois: o `_render` logo abaixo monta um formulário
                // novo, e é `this._salvou` que decide se o aviso nasce visível nele. A linha
                // seguinte cobre o caso em que a releitura falha e o formulário atual fica.
                this._salvou = true;
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

