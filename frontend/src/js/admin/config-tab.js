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
 * The "Aviso de servidor secundário" section (2026-09-04) is the one field group here whose
 * effect is a BLOCKING SCREEN every user meets at map boot. Its server default is off, so this
 * tab is the normal way it gets turned on; see the comment on the section for the merge path.
 *
 * All dynamic text via textContent (never innerHTML with user data).
 */

import { apiClient } from '@store/sync/api-client.js';
import { showSuccess, showError } from '@utils/toast_service.js';
import { sectionHeader, ICON_CONFIG, failureState } from './admin-dom.js';
import { serverMessageOr } from '@utils/request-failure.js';

/**
 * Placeholder for the primary-server field: the address the BACKEND ships as the default of
 * `URL_SERVIDOR_PRINCIPAL`. It is a hint, never a value: the field is prefilled from the
 * effective config, so this text only shows on an install whose config carries no address, and
 * an empty field is never sent (see `onSave`). Keeping it in step with `backend/src/config.js`
 * is the point: an admin who ticks the notice on and leaves the address blank has to be able to
 * see which server the deploy already points at.
 */
const URL_PRINCIPAL_EXEMPLO = 'https://ebgeo.dsg.eb.mil.br';

/** Schemes the primary-server address may use. Mirrors `ui/secondary-server-notice.js`. */
const PROTOCOLOS_ACEITOS = new Set(['http:', 'https:']);

/**
 * Whether a non-empty address is one the notice will actually draw a button for.
 *
 * THE SAME TEST THE CLIENT RUNS, on purpose. `urlDoServidorPrincipal`
 * (`frontend/src/js/ui/secondary-server-notice.js`) drops the button for anything that is not
 * http(s), SILENTLY, which is right there and wrong here: an admin who typed
 * `ebgeo.dsg.eb.mil.br` without a scheme would save a 200, see the value echoed back in the
 * form and get a notice with no way out, with nothing anywhere saying why. The server's Joi
 * (`.uri()`) is looser than the client's reader, so this is not a duplicate of it.
 * @param {string} texto - Trimmed field value (never empty here).
 * @returns {boolean}
 */
function urlDeServidorValida(texto) {
    let url;
    try {
        url = new URL(texto);
    } catch {
        return false;
    }
    return PROTOCOLOS_ACEITOS.has(url.protocol) && Boolean(url.hostname);
}

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
            showError(serverMessageOr(error, 'Falha ao carregar as configurações.'));
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
            subtitle: 'Configurações globais, aplicadas no próximo carregamento da página',
        }));

        const form = document.createElement('form');
        form.className = 'admin-form admin-form--wide';
        form.dataset.testid = 'admin-config-form';

        heading(form, 'Aplicação');
        const appTitle = text(form, 'Título', 'admin-config-app-title', eff.app?.title ?? '');
        const appTutorial = text(form, 'URL do tutorial', 'admin-config-app-tutorial', eff.app?.tutorialUrl ?? '');

        // O AVISO DE SERVIDOR SECUNDÁRIO, e ele é a única seção desta aba cujo efeito é uma tela
        // que se abre sozinha para TODO mundo. O padrão do servidor é DESLIGADO desde
        // 2026-09-04 (decisão do chefe; antes nascia ligado e toda implantação tinha de
        // desligá-lo), e é daqui que o administrador o liga, sem reiniciar o processo: o
        // override de `app` vence sobre o env na fusão de `config.service.js` e a escrita
        // derruba o memo de `/api/config`.
        //
        // AS DUAS CHAVES SÃO DO BLOCO `app`, e por isso viajam no MESMO `appDiff` do título e da
        // URL do tutorial, logo acima. O cabeçalho é separado porque o assunto é: quem procura
        // "como tiro esse aviso da tela" procura pelo nome dele, não por "Aplicação".
        heading(form, 'Aviso de servidor secundário');
        const avisoLigado = check(form, 'Mostrar o aviso de servidor secundário ao abrir o mapa',
            'admin-config-aviso-secundario', !!eff.app?.avisoServidorSecundario);
        const avisoUrl = text(form, 'URL do servidor principal', 'admin-config-url-principal',
            eff.app?.urlServidorPrincipal ?? '', { placeholder: URL_PRINCIPAL_EXEMPLO });
        const avisoHint = document.createElement('p');
        avisoHint.className = 'admin-form__hint';
        avisoHint.textContent = 'Ligado, o aviso aparece para todos a cada abertura do mapa e '
            + 'recomenda o servidor principal; o botão dele leva ao endereço acima (em branco, só '
            + 'aparece "Continuar neste servidor"). Vale no próximo carregamento da página.';
        form.appendChild(avisoHint);

        // A BASE DO LINK PÚBLICO (dono, 2026-09-20). Também é do bloco `app`, e ganha cabeçalho
        // próprio pela mesma razão do aviso: quem procura "por que o link sai com esse endereço"
        // procura por compartilhamento, não por "Aplicação". O SERVIDOR compõe o endereço
        // (`publicUrl` em `GET /atlas/:id/sharing`), então a troca vale para todo atlas já
        // publicado na próxima vez que alguém abrir a tela de compartilhar: o token não muda.
        heading(form, 'Link público de compartilhamento');
        const linkBase = text(form, 'Endereço base do link público', 'admin-config-url-link-publico',
            eff.app?.urlBaseLinkPublico ?? '', { placeholder: URL_PRINCIPAL_EXEMPLO });
        const linkHint = document.createElement('p');
        linkHint.className = 'admin-form__hint';
        linkHint.textContent = 'O link público de um atlas é este endereço seguido do código do '
            + 'atlas. Use o endereço pelo qual quem recebe o link acessa o EBGeo, que pode ser '
            + 'diferente do deste servidor. A troca vale também para os atlas já publicados.';
        form.appendChild(linkHint);

        heading(form, 'Funcionalidades');
        const fMap3d = check(form, 'Mapa 3D', 'admin-config-feat-map3d', !!eff.features?.map_3d);
        const fPan = check(form, 'Imagens panorâmicas (360°)', 'admin-config-feat-pan', !!eff.features?.imagens_panoramicas);
        const fGrid = check(form, 'Grade (UTM)', 'admin-config-feat-grid', !!eff.features?.grid);
        const fSearch = check(form, 'Busca por API', 'admin-config-feat-search', !!eff.features?.apisearch);
        // O PAINEL DE METEOROLOGIA nasce ligado (dono, 2026-09-23), e o aviso ao lado diz o preço:
        // é o NAVEGADOR de cada pessoa que consulta a fonte, e a consulta leva uma região e uma data.
        const fMeteo = check(form, 'Meteorologia (previsão no menu de contexto do mapa)',
            'admin-config-feat-meteorologia', !!eff.features?.meteorologia);
        const meteoHint = document.createElement('p');
        meteoHint.className = 'admin-form__hint';
        meteoHint.textContent = 'Ligado, o navegador de quem abrir o painel consulta a fonte da '
            + 'previsão (em Serviços) com o ponto arredondado a cerca de 11 km e a data; a fonte vê '
            + 'também o endereço do EBGeo e a saída da rede. Com a fonte pública, essa consulta sai '
            + 'para fora da rede. Vale no próximo carregamento da página.';
        form.appendChild(meteoHint);

        heading(form, 'Contas');
        const fSignup = check(form, 'Permitir auto-cadastro (botão "Criar conta")',
            'admin-config-feat-signup', !!eff.features?.self_registration);
        const signupHint = document.createElement('p');
        signupHint.className = 'admin-form__hint';
        signupHint.textContent = 'Desligado, o botão "Criar conta" some e só o administrador cria '
            + 'contas. Vale no próximo carregamento da página.';
        form.appendChild(signupHint);

        // Os mapas base que esta aba oferece nos seus DOIS seletores (o mapa base inicial, logo
        // abaixo, e o do mini-mapa do 360). A lista sai dos mapas base HABILITADOS do catálogo,
        // na ordem de prioridade, que é a mesma que o seletor principal mostra. Oferecer um
        // desabilitado seria oferecer uma escolha que o cliente não consegue desenhar.
        const basesDisponiveis = Object.entries(eff.basemaps ?? {})
            .filter(([, b]) => b?.enabled !== false)
            .sort((a, b) => (a[1]?.priority ?? 0) - (b[1]?.priority ?? 0))
            .map(([id, b]) => ({ value: id, label: b?.name ? `${b.name} (${id})` : id }));

        heading(form, 'Mapa 2D');
        // O MAPA BASE INICIAL (pedido do dono, 2026-09-23): era a constante `DEFAULT_LAYER` do
        // cliente, e hoje é `map2d.defaultBasemap`. O servidor recusa com 422 um id que não seja
        // mapa base público do catálogo, e a lista abaixo é exatamente essa.
        const baseInicial = selectOne(
            form, 'Mapa base inicial', 'admin-config-map2d-default-basemap',
            basesDisponiveis, eff.map2d?.defaultBasemap ?? '',
        );
        const baseInicialHint = document.createElement('p');
        baseInicialHint.className = 'admin-form__hint';
        baseInicialHint.textContent = 'Todo mapa novo nasce com este mapa base, e é nele que o EBGeo '
            + 'abre pela primeira vez. Um mapa que já existe continua abrindo no mapa base dele.';
        form.appendChild(baseInicialHint);
        // A FAIXA DE ZOOM NÃO É EDITÁVEL AQUI desde 2026-08-31 (decisão do dono): a da aplicação
        // é fixa em [2, 21] e o servidor recusa o override das duas com 422. Quem aperta é o MAPA
        // BASE, na aba Catálogo, linha a linha, e lá o produtor da OM dona também alcança.
        //
        // A LINHA DE AJUDA FICA, e não é enfeite: sem ela, "sumiu o campo de zoom" vira chamado.
        const zoomHint = document.createElement('p');
        zoomHint.className = 'admin-form__hint';
        zoomHint.textContent = `A aplicação vai de ${eff.map2d?.minZoom ?? 2} a ${eff.map2d?.maxZoom ?? 21}, `
            + 'e isso é fixo. Para limitar o zoom de um mapa base específico, use os campos '
            + '"Zoom mínimo" e "Zoom máximo" dele na aba Catálogo.';
        form.appendChild(zoomHint);
        const maxPitch = number(form, 'Inclinação máxima', 'admin-config-map2d-maxpitch', eff.map2d?.maxPitch);
        // A PROJEÇÃO NÃO É DAQUI, e a caixa "Projeção globo" SAIU em 2026-09-22 (decisão do
        // dono). Desde 2026-08-16 quem decide é o ATLAS, na barra "Globo / Plano" das
        // configurações dele, com globo como padrão; a caixa ficou um mês gravando e servindo uma
        // chave que o mapa não lia, e desmarcá-la não mudava nada. O servidor recusa a chave e a
        // poda do documento gravado (`config.admin.schemas.js`, `config.service.js`).
        // O SOMBREAMENTO DO RELEVO é escolha do administrador, e o padrão do servidor é
        // desligado. Sem este campo a única forma de ligá-lo era o editor "Avançado (JSON)",
        // que não confere tipo nenhum e onde um `"sim"` deixava a camada desligada em
        // silêncio.
        const sombreamento = check(form, 'Sombreamento do relevo', 'admin-config-map2d-hillshade',
            !!eff.map2d?.hillshade?.enabled);
        const sombreamentoHint = document.createElement('p');
        sombreamentoHint.className = 'admin-form__hint';
        sombreamentoHint.textContent = 'Desenha o relevo sombreado sobre o modelo digital de elevação, '
            + 'junto com o terreno. Aplica no próximo carregamento da página, como o resto desta aba.';
        form.appendChild(sombreamentoHint);

        heading(form, 'Visualizador 360');
        // SÓ O MAPA BASE, e não uma faixa de zoom própria (decisão do dono, 2026-08-31): o
        // zoom do mini-mapa vem da linha de catálogo do mapa base escolhido, que é o único
        // lugar do produto onde zoom se configura. A lista é `basesDisponiveis`, a mesma do
        // mapa base inicial, montada antes da seção Mapa 2D.
        const miniMapa = selectOne(
            form, 'Mapa base do mini-mapa do 360', 'admin-config-sv360-minimapa',
            basesDisponiveis, eff.streetView360?.miniMapBasemap ?? '',
        );
        const miniHint = document.createElement('p');
        miniHint.className = 'admin-form__hint';
        miniHint.textContent = 'O mini-mapa herda a faixa de zoom do mapa base escolhido, '
            + 'configurada na aba Catálogo. Vale no próximo carregamento da página.';
        form.appendChild(miniHint);

        heading(form, 'Serviços');
        const tileUrl = text(form, 'Servidor de tiles da grade UTM (URL)', 'admin-config-tileurl',
            eff.services?.tileServerUrl ?? '');
        const tileHint = document.createElement('p');
        tileHint.className = 'admin-form__hint';
        tileHint.textContent = 'Endereço base das camadas da grade UTM (articulação de cartas). '
            + 'Cada camada é lida em "<esta URL>/grid_<sistema>_<escala>". Em branco, a grade fica '
            + 'desligada. Não afeta mapas base, dados nem 3D/360.';
        form.appendChild(tileHint);

        const meteoUrl = text(form, 'Fonte da previsão meteorológica (URL)', 'admin-config-meteorologia-url',
            eff.services?.meteorologiaUrl ?? '', { placeholder: 'https://api.open-meteo.com' });
        const meteoUrlHint = document.createElement('p');
        meteoUrlHint.className = 'admin-form__hint';
        meteoUrlHint.textContent = 'Raiz de uma API Open-Meteo, a pública ou uma instalada na rede. '
            + 'Uma instalada na rede não deixa a região consultada sair dela. Em branco, o painel de '
            + 'meteorologia fica desligado.';
        form.appendChild(meteoUrlHint);

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
            diffBool(appDiff, 'avisoServidorSecundario', avisoLigado.checked, !!eff.app?.avisoServidorSecundario);
            // A URL DO SERVIDOR PRINCIPAL segue a regra do título e não a da URL do tutorial:
            // `urlServidorPrincipal` é `Joi.string().uri()` SEM `.allow('')`, então mandar vazio
            // reprovaria o salvamento INTEIRO da aba em 422, e não só este campo. Limpar o
            // endereço, portanto, não se faz daqui; o que se faz é trocá-lo.
            const urlVal = avisoUrl.value.trim();
            if (urlVal && urlVal !== (eff.app?.urlServidorPrincipal ?? '')) {
                // A CHECAGEM É SOBRE O QUE VAI SER ENVIADO, nunca sobre o campo inteiro: um
                // valor esquisito que já esteja no config efetivo (veio do env, que não passa
                // por Joi nenhum) travaria o salvamento de todas as OUTRAS seções desta aba.
                if (!urlDeServidorValida(urlVal)) {
                    const recusa = 'A URL do servidor principal precisa ser um endereço http:// ou '
                        + 'https:// completo.';
                    error.textContent = recusa;
                    error.hidden = false;
                    showError(recusa);
                    return;
                }
                appDiff.urlServidorPrincipal = urlVal;
            }
            // A BASE DO LINK PÚBLICO segue a MESMA regra, pelas mesmas duas razões: o schema não
            // aceita vazio, e a checagem é sobre o que vai ser enviado.
            const linkVal = linkBase.value.trim();
            if (linkVal && linkVal !== (eff.app?.urlBaseLinkPublico ?? '')) {
                if (!urlDeServidorValida(linkVal)) {
                    const recusa = 'O endereço base do link público precisa ser um endereço http:// ou '
                        + 'https:// completo.';
                    error.textContent = recusa;
                    error.hidden = false;
                    showError(recusa);
                    return;
                }
                appDiff.urlBaseLinkPublico = linkVal;
            }
            if (Object.keys(appDiff).length) payload.app = appDiff;

            const featDiff = {};
            diffBool(featDiff, 'map_3d', fMap3d.checked, !!eff.features?.map_3d);
            diffBool(featDiff, 'imagens_panoramicas', fPan.checked, !!eff.features?.imagens_panoramicas);
            diffBool(featDiff, 'grid', fGrid.checked, !!eff.features?.grid);
            diffBool(featDiff, 'apisearch', fSearch.checked, !!eff.features?.apisearch);
            diffBool(featDiff, 'meteorologia', fMeteo.checked, !!eff.features?.meteorologia);
            diffBool(featDiff, 'self_registration', fSignup.checked, !!eff.features?.self_registration);
            if (Object.keys(featDiff).length) payload.features = featDiff;

            const map2dDiff = {};
            // Sem `minZoom`/`maxZoom`: o servidor os recusa com 422, então mandá-los reprovaria
            // o salvamento INTEIRO da aba, e não só a parte do zoom.
            diffNum(map2dDiff, 'maxPitch', maxPitch, eff.map2d?.maxPitch);
            // Sem `globe_projection` pela mesma razão: a chave saiu em 2026-09-22 e o servidor a
            // recusa com 422, então mandá-la reprovaria a aba inteira.
            // ANINHADO, e por isso fora do `diffBool`: o override guarda só `enabled`, e o
            // `deepMerge` do servidor devolve o resto do bloco (nome, camada, tinta) do
            // estático. Mandar o bloco inteiro daqui congelaria a tinta na versão que a tela
            // leu.
            if (sombreamento.checked !== !!eff.map2d?.hillshade?.enabled) {
                map2dDiff.hillshade = { enabled: sombreamento.checked };
            }
            // NUNCA VAZIO: o servidor recusa `''` (um mapa sempre tem base), e um seletor sem
            // opção nenhuma, num catálogo vazio, reprovaria o salvamento INTEIRO da aba.
            if (baseInicial.value && baseInicial.value !== (eff.map2d?.defaultBasemap ?? '')) {
                map2dDiff.defaultBasemap = baseInicial.value;
            }
            if (Object.keys(map2dDiff).length) payload.map2d = map2dDiff;

            if (miniMapa.value !== (eff.streetView360?.miniMapBasemap ?? '')) {
                payload.streetView360 = { miniMapBasemap: miniMapa.value };
            }

            const servicesDiff = {};
            if (tileUrl.value.trim() !== (eff.services?.tileServerUrl ?? '')) {
                servicesDiff.tileServerUrl = tileUrl.value.trim();
            }
            const meteoVal = meteoUrl.value.trim();
            if (meteoVal !== (eff.services?.meteorologiaUrl ?? '')) {
                // Vazio é aceito (desliga o painel); o resto precisa ser http(s) completo, que é
                // o que o servidor recusaria com 422, levando junto o salvamento da aba inteira.
                if (meteoVal && !urlDeServidorValida(meteoVal)) {
                    const recusa = 'A fonte da previsão meteorológica precisa ser um endereço http:// '
                        + 'ou https:// completo.';
                    error.textContent = recusa;
                    error.hidden = false;
                    showError(recusa);
                    return;
                }
                servicesDiff.meteorologiaUrl = meteoVal;
            }
            if (Object.keys(servicesDiff).length) payload.services = servicesDiff;

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
                error.textContent = serverMessageOr(err, 'Falha ao salvar as configurações.');
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

function text(form, label, testid, value, opts) {
    return field(form, label, testid, 'text', value, opts);
}

function number(form, label, testid, value) {
    return field(form, label, testid, 'number', value ?? '');
}

/**
 * @param {HTMLElement} form
 * @param {string} label
 * @param {string} testid - Serves as `id`, `for` and `data-testid`.
 * @param {string} type
 * @param {string|number} value
 * @param {{ placeholder?: string }} [opts] - `placeholder` is a HINT and never a value: an
 *   empty field stays empty on save, as every diff in `onSave` compares the VALUE.
 * @returns {HTMLInputElement}
 */
function field(form, label, testid, type, value, { placeholder } = {}) {
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
    if (placeholder) input.placeholder = placeholder;
    wrap.appendChild(input);
    form.appendChild(wrap);
    return input;
}

/**
 * Um `<select>` de opções `{value, label}`, com o valor corrente pré-selecionado.
 *
 * O VALOR CORRENTE ENTRA NA LISTA MESMO QUE NÃO ESTEJA NELA, e essa é a razão de a função não
 * ser três linhas: se o mapa base configurado tiver sido apagado ou desabilitado no catálogo,
 * um `<select>` que só oferecesse os vivos mostraria OUTRO item selecionado, e salvar qualquer
 * coisa na aba trocaria a configuração em silêncio. A opção órfã aparece nomeada como
 * indisponível, e quem mudar mudará de propósito.
 */
function selectOne(form, label, testid, options, value) {
    const wrap = document.createElement('div');
    wrap.className = 'admin-form__field';
    const lab = document.createElement('label');
    lab.textContent = label;
    lab.setAttribute('for', testid);
    wrap.appendChild(lab);
    const sel = document.createElement('select');
    sel.id = testid;
    sel.dataset.testid = testid;
    const lista = options.some((o) => o.value === value) || !value
        ? options
        : [...options, { value, label: `${value} (indisponível)` }];
    for (const opt of lista) {
        const el = document.createElement('option');
        el.value = opt.value;
        el.textContent = opt.label;
        el.selected = opt.value === value;
        sel.appendChild(el);
    }
    wrap.appendChild(sel);
    form.appendChild(wrap);
    return sel;
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

