// Path: js/admin/catalog-tab.js

/**
 * @fileoverview "Catálogo" tab of the admin panel. Manages catalog METADATA only — never the files
 * themselves (3D model bytes, 360 bundles, thumbnails/videos are populated out-of-band; the metadata
 * just references their paths). Resource categories (tileset/data_layer/analysis_layer/basemap) each
 * have their OWN table and CRUD route, resolved by `_catalogEndpoint` — there is no single
 * /api/v1/resources route, and this fileoverview claimed there was until 2026-07-25, in the very
 * file that maps per type. Confie no `_catalogEndpoint`, não nesta prosa. The `config` (rich,
 * MapLibre-expression-heavy) is edited as JSON. 360 projects are managed via the sv360 admin routes (list/enable/disable/delete)
 * — the bundle upload is out-of-band.
 *
 * Dynamic text via textContent; JSON is parsed/validated before save (never innerHTML with data).
 */

import { apiClient } from '@store/sync/api-client.js';
import { sessionContext } from '@store/sync/session-context.js';
import { showConfirm } from '@modals/confirm.modal.js';
// Import DIRETO do arquivo, nunca pelo barrel `@modals`: esta página boota sem a store, e
// o barrel de modais a arrasta de volta pelo caminho transitivo.
import { showPrompt } from '@modals/prompt.modal.js';
import { showSuccess, showError } from '@utils/toast_service.js';
import { validateMapLibreStyle } from '@utils/maplibre-style-validate.js';
import { validateImageFile, readFileAsDataURL, compressImage } from '@utils/image_utils.js';
import { sectionHeader, card, ICON_CATALOG } from './admin-dom.js';
import { orgLabel } from './org-options.js';
// Two LEAF modules, imported one by one and never through the `@catalog` barrel: this page boots
// without the store, and the barrel re-exports `catalog.service.js`, which reaches it.
import { CAMPO_FORMA_3D, FORMAS_3D, Forma3D, derivarForma3d } from '@catalog/forma-3d.js';
import { FORMA_3D_LABELS } from '@catalog/catalog.constants.js';

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

/**
 * OS TRÊS EIXOS DESTA ABA, que a tela mistura com facilidade e o texto separa de propósito.
 * Nenhum deles é o outro, e nenhum implica o outro:
 *
 *   1. VISIBILIDADE (`access_level`): Público ou Privado. Privado tira o item do catálogo
 *      público e o entrega só a quem tem papel global, concessão, empréstimo de atlas ou é
 *      da OM produtora. Quem o move é quem MANTÉM o item (`canProduceFor`, espelho do
 *      `requireResourceMaintainer` do servidor): o administrador em qualquer OM, o produtor
 *      na dele. Esta linha dizia "só o administrador" até 2026-08-20.
 *   2. STATUS (`active`, e no 360 `status`): Ativo ou Inativo. É ocultação/soft-delete, vale
 *      para TODO MUNDO, e um item pode ser Ativo e Privado ao mesmo tempo.
 *   3. OM DONA (`owner_org_id`, `organization_id` no 360): quem MANTÉM o item. Decide quem
 *      edita, e mais nada — não esconde nem revela item nenhum.
 *
 * A frase que a tela precisa repetir: privado não é inativo, e OM dona não é privacidade.
 */

/**
 * Categoria da tela -> tipo do eixo de ACESSO A RECURSO (`resource_grants.resource_type`).
 *
 * `basemap` ENTROU NA MIGRAÇÃO 021, e o parágrafo que morava aqui dizia o contrário
 * por uma premissa falsa: que `basemaps.access_level` existia só por paridade de
 * schema e que nenhuma consulta a lia. Ela era lida desde a 017 —
 * `listCatalog('basemaps')` sem principal aplica `access_level = 'public'`, e é
 * por ali que `/api/config` se monta. O que faltava era o outro sentido: sem tipo
 * de concessão, um basemap privado sumia para todo mundo e não havia como
 * devolvê-lo a quem tem direito.
 *
 * A superfície do basemap é o SELETOR DE CAMADA BASE, não este catálogo: o que o
 * seletor mostra é `config.basemaps`, somado do payload aditivo por
 * `mergeGrantedIntoBaseline`.
 *
 * O EIXO DE ACESSO CONTINUA SENDO OUTRO QUE O DE PRODUÇÃO: as quatro tabelas têm OM
 * dona, e ter OM dona nunca escondeu nem revelou item nenhum.
 */
const ACCESS_TYPE_BY_CATEGORY = Object.freeze({
    basemap: 'basemap',
    tileset: 'tileset',
    data_layer: 'data_layer',
    analysis_layer: 'analysis_layer',
    sv360: 'sv360_project',
});

/** As duas respostas do eixo de acesso, na ordem em que a tela as oferece. */
const ACCESS_LEVELS = [
    { value: 'public', label: 'Público (qualquer pessoa vê)' },
    { value: 'private', label: 'Privado (só quem recebeu acesso)' },
];

/** UI categories. `sv360` is special (sv360 admin routes); the rest are `resources` categories. */
const CATEGORIES = [
    { key: 'tileset', label: '3D (modelos)' },
    { key: 'data_layer', label: 'Dados' },
    { key: 'analysis_layer', label: 'Análises' },
    { key: 'basemap', label: 'Basemaps' },
    { key: 'sv360', label: '360', is360: true },
];

/**
 * As quatro formas de 3D, na ordem em que o formulário as oferece.
 *
 * A lista NÃO é escrita aqui: ela vem de `FORMAS_3D`, para que uma forma nova apareça na tela
 * sem que ninguém precise lembrar desta aba. O rótulo é o mesmo que o cartão do catálogo mostra,
 * pela mesma razão — dois vocabulários para a mesma coisa é como o eixo se perde de novo.
 */
const FORMA_3D_OPTIONS = FORMAS_3D.map((valor) => ({ value: valor, label: FORMA_3D_LABELS[valor] }));

/**
 * As categorias cujo formulário monta o campo de VÍDEO DE PRÉVIA.
 *
 * `sv360` fica de fora desta lista porque não tem formulário: o 360 é administrado pela
 * TABELA (`_render360Table`), e o vídeo dele é uma ação de linha, por rota própria.
 * `basemap` fica de fora por decisão de produto: sem cartão de catálogo, não há onde ler.
 */
const CATEGORIAS_COM_VIDEO = Object.freeze(['tileset', 'data_layer', 'analysis_layer']);

/** Starter `config` templates per category — mirror the real deploy config shapes (config.js). */
const TEMPLATES = {
    tileset: {
        [CAMPO_FORMA_3D]: Forma3D.TILES3D,
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
        previewVideo: '',
        style: { border: { color: '#E74C3C', width: 2, opacity: 1 } },
    },
    analysis_layer: {
        source: { type: 'raster', tiles: ['/cms/martin/EXEMPLO/{z}/{x}/{y}'], tileSize: 256, minzoom: 12, maxzoom: 12 },
        bounds: [-55, -29, -54, -28],
        thumbnail: '',
        previewVideo: '',
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

        // A legenda dos três eixos fica NA TELA, e não só no código: eles se parecem o
        // bastante para que "desativei e continua aparecendo para a OM" vire chamado.
        const legenda = document.createElement('p');
        legenda.className = 'admin-form__hint admin-catalog__legend';
        legenda.textContent = sessionContext.isAdmin()
            ? 'Três eixos independentes: Acesso (Público/Privado) diz QUEM VÊ; Status (Ativo/Inativo) '
              + 'diz se o item aparece para alguém; OM dona diz QUEM MANTÉM. Um item pode ser Ativo e Privado.'
            : 'Você mantém os recursos da sua OM: Acesso (Público/Privado), Status (Ativo/Inativo) e os '
              + 'metadados são seus. A OM dona é definida na criação e só o administrador a muda.';
        c.appendChild(legenda);

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
        const temAcesso = !!ACCESS_TYPE_BY_CATEGORY[category];
        const table = document.createElement('table');
        table.className = 'admin-users__table';
        const thead = document.createElement('thead');
        const hrow = document.createElement('tr');
        // A coluna "OM dona" entra para TODA categoria (as quatro tabelas têm a coluna): sem
        // ela o produtor não distingue o que mantém do que apenas enxerga, já que a listagem
        // traz também o acervo público das outras OMs.
        const cabecalhos = temAcesso
            ? ['ID', 'Nome', 'Ordem', 'OM dona', 'Acesso', 'Ações']
            : ['ID', 'Nome', 'Ordem', 'OM dona', 'Ações'];
        for (const h of cabecalhos) {
            const th = document.createElement('th');
            th.textContent = h;
            if (h === 'OM dona') th.title = 'Quem mantém o recurso. Não é o eixo de acesso.';
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
            tr.appendChild(ownerOrgCell(r.owner_org_id));
            if (temAcesso) tr.appendChild(accessCell(r.access_level));
            const actions = document.createElement('td');
            actions.className = 'admin-users__actions';
            // O GATE REAL É O DO SERVIDOR (`fn_can_produce_resource` dentro do WHERE de cada
            // escrita, que devolve 404 para linha de outra OM). Aqui só não se oferece o botão
            // que o servidor recusaria — inclusive o do acervo institucional (`owner_org_id`
            // nulo), que é de administrador.
            if (sessionContext.canProduceFor(r.owner_org_id)) {
                actions.appendChild(button('Editar', 'admin-btn admin-btn--ghost', 'admin-catalog-edit',
                    () => this._renderResourceForm(category, r)));
                actions.appendChild(button('Excluir', 'admin-btn admin-btn--danger', 'admin-catalog-delete',
                    () => this._deleteResource(r)));
            } else {
                const nota = document.createElement('span');
                nota.className = 'admin-users__status';
                nota.textContent = 'Mantido por outra OM';
                actions.appendChild(nota);
            }
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

        // EIXO 3 — A OM DONA, SÓ DE LEITURA, e a razão de não haver seletor aqui é do
        // servidor: `owner_org_id` nunca é lido do corpo da requisição, nem para
        // administrador. Na criação ele é CARIMBADO com o escopo de produção de quem cria
        // (nulo para administrador = acervo institucional), e nenhuma das três escritas o põe
        // no SET. Oferecer um seletor seria um controle que não grava em lugar nenhum — o
        // defeito clássico de um campo que parece autorizar e não autoriza.
        const ownerOrgId = isEdit
            ? (resource?.owner_org_id ?? null)
            : (sessionContext.isAdmin() ? null : sessionContext.producerOrgId);
        const ownerField = readOnlyField(form, 'OM dona', 'admin-catalog-owner-org',
            ownerOrgId ? orgLabel(ownerOrgId) : 'Institucional (nenhuma OM)');
        ownerField.title = 'A OM que mantém este recurso.';
        form.appendChild(hintParagraph(isEdit
            ? 'A OM dona é definida na criação e não muda por esta tela. Transferir um recurso '
              + 'entre OMs é ato de administrador, fora do painel.'
            : (sessionContext.isAdmin()
                ? 'Criado por um administrador, o item nasce institucional (sem OM dona) e só o '
                  + 'administrador o mantém. Para que uma OM o mantenha, quem cria é o produtor dela.'
                : 'O servidor carimba a sua OM como dona deste item. Ela não vem deste formulário.')));

        // EIXO 1 — O ACESSO É UMA SEGUNDA ESCRITA, e por isso não entra no `payload`
        // abaixo: ele mora numa rota própria (`PATCH /resource-access/:type/:id/
        // visibility`), que invalida o memo do `/api/config`.
        //
        // QUEM MARCA PÚBLICO/PRIVADO É QUEM MANTÉM, desde 2026-08-20: o gate do servidor
        // virou `requireResourceMaintainer` (administrador em qualquer OM, produtor na OM
        // dele), e este `canProduceFor` é o espelho EXATO dele — o mesmo predicado que já
        // decide os botões Editar e Excluir nesta tela, e não um segundo critério. Marcar
        // privado continua não sendo compartilhar: quem tem concessão repassa acesso, e não
        // decide que o recurso deixou de ser público para todo mundo.
        //
        // Na CRIAÇÃO, `ownerOrgId` já é o escopo de produção de quem cria (nulo para
        // administrador), e `canProduceFor` resolve os dois pelo curto-circuito de `isAdmin()`.
        const accessType = ACCESS_TYPE_BY_CATEGORY[category];
        const accessBefore = resource?.access_level ?? 'public';
        const accessInput = (accessType && sessionContext.canProduceFor(ownerOrgId))
            ? selectField(form, 'Acesso (visibilidade)', 'admin-catalog-access', ACCESS_LEVELS, accessBefore)
            : null;
        if (accessInput) {
            form.appendChild(hintParagraph('Privado tira o item do catálogo público. Ele continua visível '
                + 'para administradores, credenciados, produtores da OM dona, quem recebeu concessão e quem '
                + 'abrir um atlas que o empreste. Isto NÃO é o Status: um item pode ser Ativo e Privado.'));
        }

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

        // A FORMA DO 3D é campo de primeira classe, e não uma linha do JSON avançado, porque ela
        // decide qual visualizador desenha o item: errar aqui produz um modelo que abre vazio,
        // sem erro. O valor inicial passa por `derivarForma3d`, então a linha antiga que só tem
        // os discriminadores legados (`type: 'glb'`, `viewer: 'firstPerson'`) já abre com a
        // forma certa selecionada, e salvar a declara.
        //
        // A NUVEM DE PONTOS SÓ SE MARCA AQUI. A migração que retro-preencheu o campo não a
        // adivinha (no banco ela é indistinguível de um tileset comum), então este `<select>` é
        // o único caminho para dizer que aquele item é uma nuvem — uma a uma, à mão.
        let forma3dInput = null;
        if (category === 'tileset') {
            forma3dInput = selectField(form, 'Forma do modelo 3D', 'admin-catalog-forma3d',
                FORMA_3D_OPTIONS, derivarForma3d(resource?.config));
            form.appendChild(hintParagraph('Tiles 3D e Nuvem de pontos usam o mesmo carregador; '
                + 'a distinção é o que a tela mostra e o que se pode filtrar. Cena indoor abre no '
                + 'visualizador em primeira pessoa, não no Cesium.'));
        }

        // O VÍDEO DE PRÉVIA DEIXOU DE SER SÓ DO 3D (2026-08-21). Ele vale para TILESET,
        // CAMADA DE DADOS e CAMADA DE ANÁLISE — as três guardam o valor em `config`, onde a
        // chave `previewVideo` passou a ser DECLARADA na borda do servidor. O projeto 360
        // também o tem, mas por outra porta (coluna + rota própria), na tabela abaixo.
        //
        // O BASEMAP NÃO ENTRA, e é decisão registrada: ele é o único dos cinco tipos que não
        // aparece como cartão de catálogo — a superfície dele é o seletor de camada base,
        // uma lista compacta sem lugar para uma afordância de mídia. Oferecer o campo aqui
        // seria pedir uma URL que nada mostraria.
        //
        // A mídia é fora de banda e referenciada por URL, nunca enviada: é vídeo.
        let videoInput = null;
        if (CATEGORIAS_COM_VIDEO.includes(category)) {
            videoInput = textField(form, 'Vídeo de prévia (URL, opcional)', 'admin-catalog-video',
                resource?.config?.previewVideo ?? '');
            form.appendChild(hintParagraph('O vídeo abre num botão "Prévia" no cartão do '
                + 'catálogo. Endereço apenas (o arquivo mora fora do banco); esvaziar o campo '
                + 'remove a prévia.'));
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
                // A forma vem do `<select>` e VENCE o que estiver no JSON avançado, como a
                // miniatura recém-escolhida vence a chave digitada: o controle dedicado é o que
                // a pessoa acabou de operar.
                if (forma3dInput) config[CAMPO_FORMA_3D] = forma3dInput.value;
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
                    await apiClient.updateResource(category, resource.id, payload);
                } else {
                    await apiClient.createResource(category, { id, ...payload });
                }
            } catch (err) {
                showFormError(error, err?.message || 'Falha ao salvar o item.');
                saveBtn.disabled = false;
                return;
            }

            // A visibilidade vai DEPOIS e numa chamada própria, e o erro dela é
            // relatado à parte de propósito: o item já foi gravado quando ela falha,
            // e um "falha ao salvar" genérico faria o administrador salvar de novo
            // achando que perdeu tudo. Só chama quando o valor MUDOU — um PATCH a
            // cada gravação invalidaria o memo do /api/config sem motivo.
            const accessAfter = accessInput ? accessInput.value : accessBefore;
            if (accessType && accessAfter !== accessBefore) {
                try {
                    await apiClient.setResourceVisibility(accessType, isEdit ? resource.id : id, accessAfter);
                } catch (err) {
                    showError(err?.message || 'O item foi salvo, mas a visibilidade não pôde ser alterada.');
                    if (this._alive) this._selectCategory(category);
                    return;
                }
            }

            showSuccess(isEdit ? 'Item atualizado.' : 'Item criado.');
            if (this._alive) this._selectCategory(category);
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
            await apiClient.deleteResource(this._category, resource.id);
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
        // The OM column is not decoration: a slug is unique per organization, not globally, so two
        // rows of different OMs are otherwise indistinguishable here.
        //
        // "Status" e "Acesso" são DOIS EIXOS, e a tabela os separa por isso: `disabled`
        // oculta o projeto de todo mundo fora da OM dona (é o soft-delete do 360),
        // enquanto `private` restringe só quem está de FORA — a OM dona continua vendo
        // (D6). Um projeto pode ser Ativo e Privado ao mesmo tempo, que é o caso novo.
        for (const h of ['Nome', 'Slug', 'OM', 'Fotos', 'Status', 'Acesso', 'Ações']) {
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
            tr.appendChild(cell(orgLabel(p.organization_id ?? p.organizationId)));
            tr.appendChild(cell(String(p.photo_count ?? p.photoCount ?? '')));

            const statusCell = document.createElement('td');
            const badge = document.createElement('span');
            badge.className = `admin-users__badge admin-users__badge--${enabled ? 'active' : 'inactive'}`;
            badge.textContent = enabled ? 'Ativo' : 'Inativo';
            statusCell.appendChild(badge);
            tr.appendChild(statusCell);

            const privado = (p.access_level ?? 'public') === 'private';
            tr.appendChild(accessCell(p.access_level));

            const actions = document.createElement('td');
            actions.className = 'admin-users__actions';
            // `organization_id` JÁ É a OM dona do projeto 360 (não existe uma segunda coluna
            // para o eixo de produção aqui), então é ela que responde `canProduceFor`.
            const mantem = sessionContext.canProduceFor(p.organization_id ?? p.organizationId);
            // OS TRÊS BOTÕES SÃO DE QUEM MANTÉM, e o de ACESSO entrou aqui em 2026-08-20:
            // marcar público/privado deixou de ser `requireAdmin` e virou
            // `requireResourceMaintainer`, do qual `canProduceFor` é o espelho. Um `if`
            // separado para o acesso seria a mesma pergunta feita por dois critérios.
            if (mantem) {
                actions.appendChild(button(enabled ? 'Desativar' : 'Ativar', 'admin-btn admin-btn--ghost', 'admin-360-toggle',
                    () => this._toggle360(p, enabled ? 'disabled' : 'enabled')));
                actions.appendChild(button(privado ? 'Tornar público' : 'Tornar privado', 'admin-btn admin-btn--ghost',
                    'admin-360-access', () => this._toggle360Access(p, privado ? 'public' : 'private')));
                // O VÍDEO DE PRÉVIA DO 360 É AÇÃO DE LINHA, e não campo de formulário: esta
                // categoria não tem formulário nenhum (o bundle entra fora do painel), então
                // a única superfície de escrita que existe é a tabela. O rótulo diz o ESTADO
                // ("Vídeo" / "Trocar vídeo"), que é o que evita abrir o prompt só para
                // descobrir se já há um.
                actions.appendChild(button(
                    (p.preview_video ?? p.previewVideo) ? 'Trocar vídeo' : 'Vídeo',
                    'admin-btn admin-btn--ghost', 'admin-360-video',
                    () => this._edit360Video(p),
                ));
                actions.appendChild(button('Excluir', 'admin-btn admin-btn--danger', 'admin-360-delete',
                    () => this._delete360(p)));
            } else {
                const nota = document.createElement('span');
                nota.className = 'admin-users__status';
                nota.textContent = 'Mantido por outra OM';
                actions.appendChild(nota);
            }
            tr.appendChild(actions);
            tbody.appendChild(tr);
        }
        table.appendChild(tbody);
        wrap.appendChild(table);
    }

    /**
     * @private
     * @param {Object} project - the listed row (carries `organization_id`, which disambiguates a
     *   slug that exists in more than one organization for a global admin).
     * @param {string} status
     */
    async _toggle360(project, status) {
        const slug = project.slug ?? project.name;
        try {
            await apiClient.setSv360ProjectStatus(slug, status, {
                orgId: project.organization_id ?? project.organizationId,
            });
            showSuccess('Status atualizado.');
            if (this._alive) this._render360List();
        } catch (err) {
            // The backend message here is developer English ("Ambiguous slug ..."), so it stays in
            // the console and the screen gets fixed pt-BR microcopy.
            console.warn('[catalog-tab] falha ao alterar o status do projeto 360:', err);
            showError('Não foi possível atualizar o status do projeto 360°.');
        }
    }

    /**
     * @private Alterna o eixo de ACESSO do projeto 360, que não é o de status.
     *
     * A rota é a mesma dos outros três tipos (`/resource-access/:type/:id/visibility`)
     * e a chave é o UUID do projeto, não o slug: o slug é único por OM, não
     * globalmente, e o eixo de acesso é resolvido por id.
     * @param {Object} project
     * @param {'public'|'private'} accessLevel
     */
    async _toggle360Access(project, accessLevel) {
        try {
            await apiClient.setResourceVisibility('sv360_project', project.id, accessLevel);
            showSuccess(accessLevel === 'private' ? 'Projeto 360° agora é privado.' : 'Projeto 360° agora é público.');
            if (this._alive) this._render360List();
        } catch (err) {
            console.warn('[catalog-tab] falha ao alterar a visibilidade do projeto 360:', err);
            showError('Não foi possível alterar a visibilidade do projeto 360°.');
        }
    }

    /**
     * @private Grava o VÍDEO DE PRÉVIA do projeto 360.
     *
     * A rota é PRÓPRIA (`PATCH /sv360/admin/projects/:slug`), e não a de visibilidade nem a
     * de status: `sv360.projects` guarda o vídeo em COLUNA porque não tem `config` JSONB
     * como as quatro tabelas de catálogo.
     *
     * O `null` do prompt (Esc, ou "Cancelar") é ABANDONO e não escreve nada; a string vazia
     * é REMOÇÃO e escreve. Confundir os dois faria "cancelar" apagar o vídeo.
     * @param {Object} project
     */
    async _edit360Video(project) {
        const slug = project.slug ?? project.name;
        const atual = project.preview_video ?? project.previewVideo ?? '';
        const valor = await showPrompt(
            `Vídeo de prévia de "${project.name || slug}" (URL; deixe em branco para remover)`,
            atual,
        );
        if (valor === null) return;
        try {
            await apiClient.updateSv360ProjectMetadata(slug, { previewVideo: valor.trim() }, {
                orgId: project.organization_id ?? project.organizationId,
            });
            showSuccess(valor.trim() ? 'Vídeo de prévia atualizado.' : 'Vídeo de prévia removido.');
            if (this._alive) this._render360List();
        } catch (err) {
            console.warn('[catalog-tab] falha ao gravar o vídeo de prévia do projeto 360:', err);
            showError('Não foi possível gravar o vídeo de prévia do projeto 360°.');
        }
    }

    /** @private */
    async _delete360(project) {
        const slug = project.slug ?? project.name;
        const ok = await showConfirm(`Excluir o projeto 360° "${project.name || slug}"?`,
            { destructive: true, confirmText: 'Excluir' });
        if (!ok) return;
        try {
            await apiClient.deleteSv360Project(slug, {
                orgId: project.organization_id ?? project.organizationId,
            });
            showSuccess('Projeto 360° excluído.');
            if (this._alive) this._render360List();
        } catch (err) {
            console.warn('[catalog-tab] falha ao excluir o projeto 360:', err);
            showError('Não foi possível excluir o projeto 360°.');
        }
    }
}

// ===== small DOM builders (shared shape with users-tab) =====

function cell(textValue) {
    const td = document.createElement('td');
    td.textContent = textValue;
    return td;
}

/**
 * A célula do eixo de acesso. Ausência de valor lê-se como PÚBLICO, que é o default
 * da coluna e o comportamento de toda linha que existia antes do eixo.
 * @param {string} [accessLevel]
 * @returns {HTMLElement}
 */
function accessCell(accessLevel) {
    const td = document.createElement('td');
    const privado = accessLevel === 'private';
    const chip = document.createElement('span');
    chip.className = `admin-chip admin-chip--${privado ? 'private' : 'public'}`;
    chip.dataset.testid = 'admin-catalog-access-chip';
    chip.textContent = privado ? 'Privado' : 'Público';
    td.appendChild(chip);
    return td;
}

/**
 * A célula da OM DONA. Sem OM é acervo INSTITUCIONAL, e a palavra importa: um travessão
 * ali se lê como "faltou preencher", quando o estado é legítimo e significa "de ninguém
 * em particular, mantido pelo administrador".
 * @param {string} [ownerOrgId]
 * @returns {HTMLElement}
 */
function ownerOrgCell(ownerOrgId) {
    const td = document.createElement('td');
    td.dataset.testid = 'admin-catalog-owner-org-cell';
    td.textContent = ownerOrgId ? orgLabel(ownerOrgId) : 'Institucional';
    if (!ownerOrgId) td.title = 'Sem OM produtora: acervo institucional, mantido pelo administrador.';
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

/**
 * Um parágrafo de ajuda do formulário (devolvido, não anexado: o chamador decide a posição).
 * @param {string} texto
 * @returns {HTMLParagraphElement}
 */
function hintParagraph(texto) {
    const p = document.createElement('p');
    p.className = 'admin-form__hint';
    p.textContent = texto;
    return p;
}

/**
 * Um campo de LEITURA: rótulo + valor, sem controle nenhum.
 *
 * Não é um `<input disabled>`, e a diferença importa: um input cinza promete que existe uma
 * forma de habilitá-lo, e aqui não existe — este valor não vem deste formulário nem em
 * nenhum papel.
 * @param {HTMLElement} form
 * @param {string} label
 * @param {string} testid
 * @param {string} value
 * @returns {HTMLElement} O campo, para o chamador anotar um `title`.
 */
function readOnlyField(form, label, testid, value) {
    const field = document.createElement('div');
    field.className = 'admin-form__field admin-form__field--readonly';
    const lab = document.createElement('label');
    lab.textContent = label;
    lab.setAttribute('for', testid);
    field.appendChild(lab);
    const out = document.createElement('output');
    out.id = testid;
    out.dataset.testid = testid;
    out.className = 'admin-form__readonly-value';
    out.textContent = value;
    field.appendChild(out);
    form.appendChild(field);
    return field;
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

/**
 * Um <select> de opções fixas (mesma forma do helper da aba de usuários).
 * @param {HTMLElement} form
 * @param {string} label
 * @param {string} testid
 * @param {Array<{value: string, label: string}>} options
 * @param {string} value
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
        if (opt.value === value) o.selected = true;
        select.appendChild(o);
    }
    field.appendChild(select);
    form.appendChild(field);
    return select;
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
