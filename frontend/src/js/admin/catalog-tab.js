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
import { sectionHeader, card, emptyState, ICON_CATALOG, failureState } from './admin-dom.js';
import { orgLabel } from './org-options.js';
// Two LEAF modules, imported one by one and never through the `@catalog` barrel: this page boots
// without the store, and the barrel re-exports `catalog.service.js`, which reaches it.
import { CAMPO_FORMA_3D, FORMAS_3D, Forma3D, derivarForma3d } from '@catalog/forma-3d.js';
import { FORMA_3D_LABELS } from '@catalog/catalog.constants.js';
// Terceiro módulo FOLHA do catálogo, pela mesma razão dos dois de cima: as frases do eixo de
// acesso são compartilhadas com o modal de configurações do atlas, e o barrel arrastaria a store.
import { visibilityChangeWarning, visibilityChangeSummary } from '@catalog/visibility-phrases.js';
import { setupCleanup, cleanup } from '@utils/event-cleanup.js';
// Modulo folha, zero imports, como as demais familias de frase desta pagina.
import {
    catalogDeletionWarning, projectStatusChangeWarning, projectDeletionWarning,
} from './catalog-delete-phrases.js';

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
        // A CONVENCAO DA CASA, e esta era a UNICA das tres abas do produtor fora dela: `audit-tab`
        // e `groups-tab` registram em `@utils/event-cleanup.js` e liberam na desmontagem, e aqui
        // o "cleanup" era so baixar uma bandeira. Na pratica os ouvintes morriam por
        // `replaceChildren()`, que funciona por acidente do desenho e nao por contrato: o dia em
        // que um ouvinte for pendurado fora do container desmontado (em `document`, em `window`,
        // num timer) ele sobrevive, e esta e a aba em que o produtor passa mais tempo.
        setupCleanup(this);
        this._build();
        return () => {
            this._alive = false;
            cleanup(this);
        };
    }

    /** @private Builds the persistent sub-nav + a content area, then renders the first category. */
    _build() {
        const c = this._container;
        c.replaceChildren();
        // A PORTA DE CRIAR MORA NO CABEÇALHO, e não numa faixa solta acima da tabela.
        //
        // ELA ERA UM BOTÃO ÓRFÃO numa `admin-users__toolbar` de um item só, logo abaixo da
        // sub-nav, e ali não se lia como ação primária: parecia mais um filtro. A aba Usuários
        // já resolvia isso desde sempre (`users-tab.js`, "+ Novo usuário" em `actions`), e a
        // divergência era só destas duas abas. O `+` é a mesma convenção de lá, e é o que
        // distingue "criar" de "abrir" à primeira vista.
        //
        // O RÓTULO E O `testid` MUDAM COM A CATEGORIA, porque o botão é um só e o alvo dele não:
        // as quatro categorias de catálogo abrem formulário, e o 360 abre o envio de bundle, que
        // é outra rota e outro nome. `_selectCategory` os reescreve.
        this._newBtn = button('', 'admin-btn admin-btn--primary', 'admin-catalog-new',
            () => this._acionarCriacao());
        c.appendChild(sectionHeader('Catálogo', {
            subtitle: 'Recursos globais — 3D, 360, dados, análises e basemaps (metadados)',
            actions: [this._newBtn],
        }));

        // A legenda dos três eixos fica NA TELA, e não só no código: eles se parecem o
        // bastante para que "desativei e continua aparecendo para a OM" vire chamado.
        const legenda = document.createElement('p');
        legenda.className = 'admin-form__hint admin-catalog__legend';
        legenda.textContent = sessionContext.isAdmin()
            ? 'Três eixos independentes: Acesso (Público/Privado) diz QUEM VÊ; Status (Ativo/Inativo) '
              + 'diz se o item aparece para alguém; OM dona diz QUEM MANTÉM. Um item pode ser Ativo e Privado.'
            // NAO PROMETE MAIS O EIXO STATUS PARA AS QUATRO CATEGORIAS, porque ele nao existe
            // ali: os schemas de escrita nao aceitam `active`, a listagem filtra `active = true`,
            // e os UNICOS caminhos que escrevem a coluna sao `deleteCatalogItem` (para false) e o
            // ramo de RESSURREICAO de `createCatalogItem` (para true). Ou seja, o eixo existe no
            // banco e nao tem controle na tela: a legenda dizia que era dele algo que ele nao
            // consegue mexer, e o operador ia procurar um botao que nunca existiu.
            //
            // Decisao do dono, 2026-08-24: a legenda muda, o eixo nao nasce. So o 360 o tem.
            : 'Você mantém os recursos da sua OM: o Acesso (Público/Privado) e os metadados são '
              + 'seus. A OM dona é definida na criação e só o administrador a muda. O eixo '
              + 'Status (Ativo/Inativo) existe apenas nos projetos 360.';
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
        this._ajustarBotaoDeCriar(key);
        if (key === 'sv360') this._render360List();
        else this._renderResourceList(key);
    }

    /**
     * Reescreve rótulo e `testid` do botão primário para a categoria da vez.
     *
     * O `testid` MUDA DE VERDADE, e não é descuido: `admin-catalog-new` e `admin-360-upload` são
     * dois alvos que specs já miram, e são duas AÇÕES distintas (abrir formulário contra abrir
     * envio de bundle). Fundi-los num nome só quebraria os specs e apagaria a diferença; mantê-los
     * como dois botões desenhados ao mesmo tempo mostraria uma porta que a categoria da vez não
     * tem. Um botão que troca de identidade é o que descreve o que a tela faz.
     * @private
     * @param {string} key
     */
    _ajustarBotaoDeCriar(key) {
        if (!this._newBtn) return;
        if (key === 'sv360') {
            this._newBtn.textContent = '+ Enviar bundle 360°';
            this._newBtn.dataset.testid = 'admin-360-upload';
            return;
        }
        const label = CATEGORIES.find((x) => x.key === key)?.label ?? key;
        this._newBtn.textContent = `+ Novo — ${label}`;
        this._newBtn.dataset.testid = 'admin-catalog-new';
    }

    /** @private O clique do botão primário, despachado pela categoria viva. */
    _acionarCriacao() {
        if (this._category === 'sv360') this._render360Upload();
        else this._renderResourceForm(this._category, null);
    }

    // ----- resources list -----

    /** @private */
    async _renderResourceList(category) {
        const c = this._content;
        c.replaceChildren();

        // O REGIME DE ESCOPO MUDA ENTRE AS SUB-ABAS, e nada dizia isso. Estas quatro vêm de
        // `listCatalog`, recortada por ACESSO: o acervo público inteiro mais o privado dele, com a
        // maioria das linhas trazendo "Mantido por outra OM" no lugar dos botões. A sub-aba 360 vem
        // de `LIST_PROJECTS_ADMIN`, recortada por PRODUÇÃO: só a OM dele.
        //
        // A consequência prática é que "Nenhum item nesta categoria" significa coisas diferentes
        // nas duas, e sem a nota a pessoa lê a lista longa daqui como "tudo isto é meu".
        // A NOTA SAI PARA OS DOIS PÚBLICOS, com o texto de cada um. A primeira versão desta nota
        // era gateada por `!isAdmin()`, e o efeito é o que o achado M3 descreve: o administrador,
        // que tem a lista mais larga possível, era o único sem legenda dizendo qual é o recorte.
        const escopo = document.createElement('p');
        escopo.className = 'admin-form__hint';
        escopo.dataset.testid = 'admin-catalog-scope-note';
        escopo.textContent = sessionContext.isAdmin()
            ? 'Você vê e edita o acervo de todas as OM, e também o institucional (sem OM dona), '
              + 'porque administra o sistema. A coluna "OM dona" diz quem mantém cada linha.'
            : 'Esta lista traz o acervo público de todas as OM mais o que é seu. '
              + 'Você só edita as linhas da sua OM; nas demais, o lugar dos botões diz quem '
              + 'mantém. A sub-aba 360 é diferente: lá aparecem apenas os seus projetos.';
        c.appendChild(escopo);

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
            // A SAÍDA que faltava. Ver `failureState` em `admin-dom.js`: falha de carregamento era
            // beco sem saída nas seis abas, e o único caminho era recarregar a página.
            loading.replaceChildren(failureState('Falha ao carregar o catálogo.', {
                onRetry: () => { if (this._alive) this._selectCategory(category); },
            }));
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
            // `emptyState` E NAO paragrafo cru, como as outras quatro abas ja faziam: o
            // helper traz a DICA do proximo passo, e vazio sem proximo passo e beco.
            wrap.appendChild(emptyState('Nenhum item nesta categoria.', {
                hint: 'Use o botao "+ Novo" no topo da secao para criar o primeiro.',
            }));
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
                // ACAO DE LINHA PARA A VISIBILIDADE, como o 360 ja tinha. Antes, mudar SO o acesso
                // obrigava a abrir o formulario, cujo `onSave` reescreve nome, descricao, ordem,
                // `config` inteiro, miniatura e video: um ato de um eixo custava a reescrita do
                // item todo, e qualquer JSON avancado mal colado ia junto. Agora o eixo estreito
                // tem porta estreita, e o formulario continua servindo a edicao de fato.
                if (temAcesso) {
                    const privado = r.access_level === 'private';
                    actions.appendChild(button(
                        privado ? 'Tornar público' : 'Tornar privado',
                        'admin-btn admin-btn--ghost',
                        'admin-catalog-access',
                        () => this._toggleResourceAccess(category, r, privado ? 'public' : 'private'),
                    ));
                }
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
        const categoriaRotulo = CATEGORIES.find((x) => x.key === category)?.label ?? category;

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
            // NÃO PROMETE MAIS A TRANSFERÊNCIA, porque ela não existe em rota nenhuma. O texto
            // anterior mandava procurar uma capacidade não implementada: `CAMPOS_EDITAVEIS` do
            // serviço de catálogo tem quatro chaves e `owner_org_id` não é uma delas, o UPDATE
            // não a toca, e o ramo de ressurreição a deixa de fora DE PROPÓSITO, com o motivo
            // escrito lá. O 360 tampouco transfere. Decisão do dono, 2026-08-24: a promessa sai
            // do texto em vez de a rota nascer.
            ? 'A OM dona é definida na criação e não muda depois, nem por esta tela nem por outra. '
              + 'Para mover um recurso de OM, crie-o de novo na OM certa e exclua este.'
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
            // ONDE SE CONCEDE, dito aqui porque é aqui que a pergunta nasce. Privatizar e conceder
            // são os dois lados do mesmo ato e vivem em telas opostas do aplicativo: este
            // formulário privatiza, e `showResourceShareModal` (o único caminho de concessão) tem
            // dois chamadores, os dois DENTRO do mapa. Quem acabou de tornar um item privado ficava
            // sem saber a quem dar acesso, e a tela não dizia que existia outro lugar.
            //
            // Decisão do dono, 2026-08-24: a aba NOMEIA onde se concede, e o botão não nasce aqui.
            // Um segundo modal de concessão nesta página seria uma segunda implementação da mesma
            // regra, e o motor de sync que o primeiro carrega não cabe numa página sem store.
            form.appendChild(hintParagraph('Tornar privado não dá acesso a ninguém. Para conceder, '
                + 'abra o catálogo no mapa e use "Compartilhar" no cartão do recurso.'));
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

            // Bandeira do descarte da chave legada, lida no toast de sucesso mais abaixo.
            let podouVideoLegado = false;

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
                } else if (config.previewVideo !== undefined) {
                    // A CHAVE LEGADA E PODADA AQUI, e sem isto a linha ficava INEDITAVEL. O campo
                    // de video so e montado para as categorias de `CATEGORIAS_COM_VIDEO`, e
                    // `basemap` esta fora dela por decisao de produto (sem cartao de catalogo, nao
                    // ha onde ler o video). So que o textarea avancado devolve o `config` INTEIRO
                    // de volta, entao um basemap gravado com `previewVideo` antes de 2026-08-23
                    // reenviava a chave, e `configSchemaSemPreviewVideo` responde 422 em QUALQUER
                    // edicao, inclusive uma que so mude o nome. Nao ha poda no servidor nem
                    // migracao: a linha so se conserta apagando a chave a mao do JSON, e nada na
                    // tela dizia isso.
                    //
                    // Silenciosa de proposito? Nao: a linha abaixo avisa. Apagar dado de alguem
                    // sem dizer e como o proximo defeito nasce.
                    delete config.previewVideo;
                    podouVideoLegado = true;
                }
                if (enabledInput) {
                    config.enabled = enabledInput.checked;
                    const pr = Number(priorityInput.value.trim());
                    config.priority = Number.isFinite(pr) ? pr : (config.priority ?? 0);
                }
            }

            // A CONFIRMAÇÃO DA PRIVATIZAÇÃO VEM ANTES DE QUALQUER ESCRITA, e não junto do
            // PATCH lá embaixo: perguntar depois de gravar deixaria a pessoa respondendo
            // sobre um ato já consumado pela metade. Só o sentido DESTRUTIVO pergunta, e
            // quem decide isso é `visibilityChangeWarning` devolvendo null (ver aquele
            // arquivo): tornar público não tira nada de ninguém.
            //
            // O "Cancelar" NÃO aborta a gravação inteira: ele devolve o `<select>` ao valor
            // de partida e o resto do formulário salva normalmente. Abortar tudo faria o
            // recuo numa das escritas descartar em silêncio a edição de nome, descrição e
            // JSON que a pessoa acabou de fazer, e o controle revertido é visível na tela.
            let accessAfter = accessInput ? accessInput.value : accessBefore;
            if (accessType && accessAfter !== accessBefore) {
                const aviso = visibilityChangeWarning(accessAfter, { nome: name, tipoRotulo: categoriaRotulo });
                if (aviso) {
                    const ok = await showConfirm(`Tornar "${name}" privado?`, {
                        message: aviso,
                        destructive: true,
                        confirmText: 'Tornar privado',
                        // "MANTER PÚBLICO" E NÃO "MANTER COMO ESTÁ". O botão cancela SÓ a mudança de
                    // visibilidade: o salvamento do item continua, de propósito (o comentário
                    // acima explica por quê), e o `<select>` volta ao valor de partida. O rótulo
                    // vago prometia cancelar o gesto inteiro, então quem clicava nele esperando
                    // abortar a edição salvava assim mesmo. É o mesmo rótulo que
                    // `_toggleResourceAccess` e `_toggle360Access` já usam, pela mesma razão.
                    cancelText: 'Manter público',
                    });
                    if (!ok) {
                        accessInput.value = accessBefore;
                        accessAfter = accessBefore;
                    }
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
            let resposta = null;
            try {
                if (isEdit) {
                    resposta = await apiClient.updateResource(category, resource.id, payload);
                } else {
                    resposta = await apiClient.createResource(category, { id, ...payload });
                }
            } catch (err) {
                // A PRIVATIZACAO CONFIRMADA NAO ACONTECEU, e a tela precisa parar de exibi-la.
                // A ordem aqui e confirmar, gravar o item, e so entao chamar a visibilidade; se a
                // primeira escrita falha, a privatizacao recem-confirmada nunca roda. Falhar
                // fechado e a direcao certa, e ficava um <select> mostrando "private" sobre um
                // servidor que continua publico.
                //
                // A assimetria era gritante: o CANCELAMENTO ja revertia o <select> (logo acima),
                // e o erro de gravacao nao revertia nada. Dois caminhos para o mesmo estado, um
                // cuidado e um esquecido.
                if (accessInput && accessAfter !== accessBefore) {
                    accessInput.value = accessBefore;
                    accessAfter = accessBefore;
                }
                showFormError(error, err?.message
                    || 'Falha ao salvar o item. A mudança de visibilidade também não foi aplicada.');
                saveBtn.disabled = false;
                return;
            }

            // A visibilidade vai DEPOIS e numa chamada própria, e o erro dela é
            // relatado à parte de propósito: o item já foi gravado quando ela falha,
            // e um "falha ao salvar" genérico faria o administrador salvar de novo
            // achando que perdeu tudo. Só chama quando o valor MUDOU (`accessAfter` já
            // foi resolvido acima, e o recuo da confirmação o igualou ao de partida):
            // um PATCH a cada gravação invalidaria o memo do /api/config sem motivo.
            if (accessType && accessAfter !== accessBefore) {
                try {
                    await apiClient.setResourceVisibility(accessType, isEdit ? resource.id : id, accessAfter);
                } catch (err) {
                    showError(err?.message || 'O item foi salvo, mas a visibilidade não pôde ser alterada.');
                    if (this._alive) this._selectCategory(category);
                    return;
                }
            }

            // O TOAST RELATA O EFEITO. "Item atualizado." é verdade e é pouco quando a
            // gravação acabou de tirar o item do catálogo de outras pessoas: o eixo que
            // mudou o que os OUTROS veem é o que precisa aparecer na frase.
            // "ITEM CRIADO." ERA MENTIRA NUM CASO. Criar com um id que existe INATIVO cai no ramo
            // de ressurreicao de `createCatalogItem`, que SOBRESCREVE a linha antiga por inteiro e
            // devolve `resurrected: true`. O cliente descartava a resposta e dizia "Item criado.",
            // entao quem reaproveitou um id sem saber acabava de reescrever o recurso de outra
            // pessoa acreditando ter criado o seu.
            const base = isEdit
                ? 'Item atualizado.'
                : (resposta?.resurrected === true
                    ? 'Item recriado: já existia um com este id, desativado, e ele foi sobrescrito.'
                    : 'Item criado.');
            const partes = [base];
            if (accessAfter !== accessBefore) {
                partes.push(visibilityChangeSummary({ nome: name, accessLevel: accessAfter }));
            }
            // DIZ O QUE FOI DESCARTADO. O campo nao vale para mapa base e o servidor o recusa;
            // apagar sem falar deixaria a pessoa procurando um video que ela mesma gravou.
            if (podouVideoLegado) {
                partes.push('O campo de vídeo de prévia foi descartado: ele não vale para mapa base.');
            }
            showSuccess(partes.join(' '));
            if (this._alive) this._selectCategory(category);
        };
        saveBtn.addEventListener('click', onSave);

        c.appendChild(form);
    }

    /**
     * O formulario de envio de um bundle 360.
     *
     * QUATRO ARQUIVOS, e a obrigatoriedade nao e a que o nome sugere: `manifest` e `imagesDb` sao
     * exigidos pelo controlador; `tilesDb` e OPCIONAL no contrato e obrigatorio na pratica para
     * acervo so-tiles, porque sem ele `validateImagesDb` recusa o bundle (nao sobra fonte de
     * pixel nenhuma). A tela diz isso em vez de deixar a pessoa descobrir por 400.
     *
     * A OM NAO E PERGUNTADA, de proposito: `resolveUploadOrgId` a IMPOE a partir do escopo de
     * producao lido do banco, e recusa com 403 um manifesto apontando para outra. Oferecer um
     * campo aqui seria desenhar uma escolha que o servidor ignora.
     * @private
     * @returns {void}
     */
    _render360Upload() {
        const c = this._content;
        c.replaceChildren();

        const form = card({ testid: 'admin-360-upload-form' });
        const titulo = document.createElement('h3');
        titulo.className = 'admin-form__title';
        titulo.textContent = 'Enviar bundle 360°';
        form.appendChild(titulo);

        const dica = document.createElement('p');
        dica.className = 'admin-form__hint';
        dica.textContent = 'O projeto é criado com a OM para a qual você produz, e o manifesto não '
            + 'pode apontar para outra. Um bundle com o mesmo identificador SUBSTITUI o projeto '
            + 'existente, junto com a calibração já feita nele.';
        form.appendChild(dica);

        const error = document.createElement('p');
        error.className = 'admin-form__error';
        error.hidden = true;

        const campos = [
            { id: 'manifest', rotulo: 'Manifesto (obrigatório)', accept: '.json,application/json' },
            { id: 'imagesDb', rotulo: 'Banco de imagens (obrigatório)', accept: '.db,.sqlite' },
            { id: 'tilesDb', rotulo: 'Banco de tiles', accept: '.db,.sqlite' },
            { id: 'thumbnail', rotulo: 'Miniatura', accept: 'image/png,image/jpeg,image/webp' },
        ];
        const inputs = {};
        for (const campo of campos) {
            const linha = document.createElement('div');
            linha.className = 'admin-form__field';
            const label = document.createElement('label');
            label.className = 'admin-form__label';
            label.htmlFor = `admin-360-up-${campo.id}`;
            label.textContent = campo.rotulo;
            const input = document.createElement('input');
            input.type = 'file';
            input.id = `admin-360-up-${campo.id}`;
            input.accept = campo.accept;
            input.dataset.testid = `admin-360-up-${campo.id}`;
            inputs[campo.id] = input;
            linha.append(label, input);
            form.appendChild(linha);
        }

        const acoes = document.createElement('div');
        acoes.className = 'admin-form__actions';
        const enviar = button('Enviar', 'admin-btn admin-btn--primary', 'admin-360-up-submit', async () => {
            const manifest = inputs.manifest.files?.[0];
            const imagesDb = inputs.imagesDb.files?.[0];
            // RECUSA NA ENTRADA os dois obrigatórios, em vez de deixar o 400 do servidor
            // explicar: o envio é grande, e descobrir no fim que faltava um campo custa a espera
            // inteira.
            if (!manifest || !imagesDb) {
                showFormError(error, 'Manifesto e banco de imagens são obrigatórios.');
                return;
            }
            enviar.disabled = true;
            enviar.textContent = 'Enviando…';
            try {
                const criado = await apiClient.uploadSv360Bundle({
                    manifest,
                    imagesDb,
                    tilesDb: inputs.tilesDb.files?.[0] ?? null,
                    thumbnail: inputs.thumbnail.files?.[0] ?? null,
                });
                showSuccess(`Projeto 360° "${criado?.name || criado?.slug || ''}" enviado.`);
                if (this._alive) this._render360List();
            } catch (err) {
                showFormError(error, err?.message || 'Não foi possível enviar o bundle.');
                enviar.disabled = false;
                enviar.textContent = 'Enviar';
            }
        });
        acoes.appendChild(enviar);
        acoes.appendChild(button('Cancelar', 'admin-btn admin-btn--ghost', 'admin-360-up-cancel',
            () => this._render360List()));
        form.appendChild(acoes);
        form.appendChild(error);
        c.appendChild(form);
    }

    /**
     * Muda SO a visibilidade de um item de catalogo, sem reescrever o resto.
     *
     * Espelha `_toggle360Access` de proposito, inclusive na assimetria da pergunta: so o sentido
     * destrutivo confirma (`visibilityChangeWarning` devolve nulo no sentido aditivo), porque
     * perguntar sempre treina o operador a confirmar sem ler.
     * @private
     * @param {string} category - A categoria da aba, que decide o tipo de recurso.
     * @param {Object} resource - A linha listada.
     * @param {string} accessLevel - `public` ou `private`.
     * @returns {Promise<void>}
     */
    async _toggleResourceAccess(category, resource, accessLevel) {
        const tipo = ACCESS_TYPE_BY_CATEGORY[category];
        if (!tipo) return;
        const nome = resource.name || resource.id;
        const aviso = visibilityChangeWarning(accessLevel, {
            nome,
            tipoRotulo: CATEGORIES.find((x) => x.key === category)?.label ?? 'Recurso',
        });
        if (aviso) {
            const ok = await showConfirm(`Tornar "${nome}" privado?`, {
                message: aviso,
                destructive: true,
                confirmText: 'Tornar privado',
                cancelText: 'Manter público',
            });
            if (!ok) return;
        }
        try {
            await apiClient.setResourceVisibility(tipo, resource.id, accessLevel);
            showSuccess(visibilityChangeSummary({ nome, accessLevel }));
            if (this._alive) this._selectCategory(category);
        } catch (err) {
            console.warn('[catalog-tab] falha ao alterar a visibilidade do item:', err);
            showError('Não foi possível alterar a visibilidade deste item.');
        }
    }

    /** @private */
    async _deleteResource(resource) {
        // SEM `message` ISTO NAO DESENHAVA CORPO NENHUM (`ConfirmModal` so o monta quando a
        // mensagem existe), entao o ato mais destrutivo da aba perguntava menos que a
        // privatizacao ao lado, que traz um paragrafo inteiro.
        // O NÚMERO É BUSCADO ANTES DE PERGUNTAR, e a falha da leitura não impede a pergunta: a
        // frase degrada para a versão sem quantidade, que continua verdadeira. Ver o cabeçalho de
        // `catalog-delete-phrases.js`.
        let referencias = null;
        try {
            const r = await apiClient.countResourceReferences(this._category, resource.id);
            referencias = Number(r?.atlasCount);
        } catch (err) {
            console.warn('[catalog-tab] contagem de referências indisponível:', err);
        }
        const ok = await showConfirm(`Excluir "${resource.name || resource.id}" do catálogo?`, {
            message: catalogDeletionWarning({
                nome: resource.name, id: resource.id, atlasCount: referencias,
            }),
            destructive: true,
            confirmText: 'Excluir',
        });
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

        // A PORTA DO ENVIO mora no cabecalho da secao desde 2026-08-25, e nao mais numa faixa
        // solta aqui. `POST /sv360/admin/projects/upload` e autenticada, aceita o produtor e IMPOE
        // a OM dele, e mesmo assim tinha zero chamadores no cliente: o unico caminho de ingestao
        // era shell no servidor, e esta propria aba anunciava isso como se fosse desenho. Decisao
        // do dono, 2026-08-24: a tela do 360 nasce (a rota ja existia); a ingestao 3D continua
        // sendo operacao de servidor, e a clausula 2.4 passa a dize-lo.
        const note = document.createElement('p');
        note.className = 'admin-form__hint';
        // ANUNCIA AS CINCO ACOES, e nao duas. A nota falava em "status/exclusao" enquanto a
        // linha oferece ativar/desativar, publico/privado, calibrar, video e excluir: as nao
        // anunciadas incluem justamente as que mudam quem VE o projeto.
        note.textContent = 'Aqui você gerencia os metadados do projeto 360: status (Ativo/Inativo), '
            + 'acesso (Público/Privado), calibração das fotos, vídeo de prévia e exclusão. '
            + 'O envio do bundle é feito pelo botão no topo da seção.';
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
            // A SAÍDA que faltava. Ver `failureState` em `admin-dom.js`: falha de carregamento era
            // beco sem saída nas seis abas, e o único caminho era recarregar a página.
            loading.replaceChildren(failureState('Falha ao carregar os projetos 360°.', {
                onRetry: () => { if (this._alive) this._render360List(); },
            }));
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
            wrap.appendChild(emptyState('Nenhum projeto 360.', {
                hint: 'Use "+ Enviar bundle 360" no topo da secao para ingerir o primeiro.',
            }));
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
            // OS CINCO BOTÕES SÃO DE QUEM MANTÉM, e o de ACESSO entrou aqui em 2026-08-20:
            // marcar público/privado deixou de ser `requireAdmin` e virou
            // `requireResourceMaintainer`, do qual `canProduceFor` é o espelho. Um `if`
            // separado para o acesso seria a mesma pergunta feita por dois critérios.
            // CALIBRAR entrou em 2026-08-25 pelo mesmo gate, e por um motivo de endereço: o
            // estúdio era um botão global da barra do topo, que levava ao seletor e mandava
            // escolher de novo o projeto que a pessoa já tinha na tela.
            if (mantem) {
                actions.appendChild(button(enabled ? 'Desativar' : 'Ativar', 'admin-btn admin-btn--ghost', 'admin-360-toggle',
                    () => this._toggle360(p, enabled ? 'disabled' : 'enabled')));
                actions.appendChild(button(privado ? 'Tornar público' : 'Tornar privado', 'admin-btn admin-btn--ghost',
                    'admin-360-access', () => this._toggle360Access(p, privado ? 'public' : 'private')));
                actions.appendChild(button('Calibrar', 'admin-btn admin-btn--ghost', 'admin-360-calibrar',
                    () => this._calibrar360(p)));
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
                // RAMO MORTO, mantido de proposito e agora dito em voz alta. `LIST_PROJECTS_ADMIN`
                // ja filtra por `fn_can_produce_resource` no WHERE, e `canProduceFor` no cliente
                // devolve verdadeiro para toda linha que o servidor deixou passar, entao este
                // else nao e alcancavel HOJE. A copia gemea em `_renderResourceTable` E
                // alcancavel, porque aquela listagem filtra por ACESSO e traz o publico de outras
                // OMs: sao dois ramos identicos, um vivo e um morto.
                //
                // Fica porque, no dia em que esta rota passar a listar mais do que ele produz,
                // este ramo e a diferenca entre um botao que 404 e um texto que explica. Apagar
                // ramo morto que e a rede de outro e economia que se paga com bug.
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
        // PERGUNTA SO NO SENTIDO DESTRUTIVO, como `_toggle360Access` ao lado: `disabled` esconde o
        // projeto de todo mundo fora da OM dona, o que e MAIS amplo que privatizar, e este botao
        // era o unico dos quatro da linha que nao perguntava nada. Reativar nao tira de ninguem.
        const aviso = projectStatusChangeWarning({ nome: project.name, para: status });
        if (aviso) {
            const ok = await showConfirm(`Desativar "${project.name || slug}"?`, {
                message: aviso,
                destructive: true,
                confirmText: 'Desativar',
            });
            if (!ok) {
                // Redesenha: o botao da linha reflete o estado, e sair sem redesenhar deixaria a
                // tela coerente por acidente e nao por construcao.
                if (this._alive) this._render360List();
                return;
            }
        }
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
     *
     * PERGUNTA SÓ NO SENTIDO DESTRUTIVO, e quem decide o ramo é `visibilityChangeWarning`,
     * que devolve null no aditivo. Esta tela já confirmava a EXCLUSÃO e não confirmava a
     * privatização, que também retira o projeto do catálogo de quem não tem acesso próprio:
     * a inconsistência era interna a este arquivo.
     * @param {Object} project
     * @param {'public'|'private'} accessLevel
     */
    async _toggle360Access(project, accessLevel) {
        const nome = project.name || project.slug || project.id;
        const aviso = visibilityChangeWarning(accessLevel, { nome, tipoRotulo: 'Projeto 360°' });
        if (aviso) {
            const ok = await showConfirm(`Tornar "${nome}" privado?`, {
                message: aviso,
                destructive: true,
                confirmText: 'Tornar privado',
                cancelText: 'Manter público',
            });
            if (!ok) return;
        }
        try {
            await apiClient.setResourceVisibility('sv360_project', project.id, accessLevel);
            showSuccess(visibilityChangeSummary({ nome, accessLevel }));
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
    /**
     * Abre o estúdio de calibração 360 na FOTO DE ENTRADA do projeto desta linha.
     *
     * O CONTRATO DA URL É UMA CHAVE SÓ. `calibration/app.js` lê `?photo=` e nada mais: não existe
     * `?projeto=` nem `?slug=`. Passar a foto de entrada basta, porque `startCalibration` busca os
     * metadados dela e carrega o contexto do projeto sozinho. Sem o parâmetro, a página cai no
     * seletor de projetos, que é exatamente o desvio que este botão veio eliminar.
     *
     * `entry_photo_id` É ANULÁVEL (`007_sv360.sql:45`): é referência lógica, e a foto pode não
     * existir na ingestão. Daí o desvio para a URL sem parâmetro, que ainda leva ao estúdio.
     *
     * NAVEGAÇÃO, NÃO ESCRITA. Por isso não há `showConfirm`, `showSuccess` nem guarda de `_alive`:
     * a página inteira vai embora. O gate da página de destino (`isAdmin() || isProducer()`) é
     * satisfeito por construção, porque este botão só existe dentro de `if (mantem)`.
     * @private
     * @param {Object} project - A linha crua de `GET /sv360/admin/projects`.
     */
    _calibrar360(project) {
        const entrada = project.entry_photo_id ?? project.entryPhotoId ?? null;
        window.location.assign(entrada
            ? `./calibracao.html?photo=${encodeURIComponent(entrada)}`
            : './calibracao.html');
    }

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
        const ok = await showConfirm(`Excluir o projeto 360° "${project.name || slug}"?`, {
            message: projectDeletionWarning({
                nome: project.name,
                fotos: Number(project.photo_count ?? project.photoCount ?? NaN),
            }),
            destructive: true,
            confirmText: 'Excluir',
        });
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
