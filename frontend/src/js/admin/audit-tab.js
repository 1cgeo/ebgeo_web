// Path: js/admin/audit-tab.js

/**
 * @fileoverview Aba "Auditoria" — a trilha de atos do servidor (`audit_trail`), lida por
 * `GET /api/v1/audit`.
 *
 * DUAS AUDIÊNCIAS, UMA TELA. O administrador global lê a trilha inteira e ganha UMA coluna
 * e UM filtro a mais (a OM do acervo); o PRODUTOR lê a trilha da OM dele e não vê nem a
 * coluna nem o filtro — porque para ele a resposta inteira já é de uma OM só, e oferecer o
 * filtro seria oferecer um controle sem efeito. Quem decide não é esta tela: o servidor
 * manda `administra` na resposta e a tela OBEDECE, em vez de deduzir o papel da sessão. O
 * credenciado não chega aqui (`admin-audience.js` não lhe dá a aba, e o gate do servidor
 * lhe daria 403).
 *
 * O REQUISITO PRINCIPAL É NÃO VIRAR DUMP, e ele governa quatro decisões:
 *
 *   1. **O padrão é 7 dias**, não "tudo". Abrir a trilha inteira de um sistema com meses
 *      de uso entrega uma parede de texto onde nada se acha.
 *   2. **Agrupamento por DIA**, com cabeçalho pegajoso. Cinquenta carimbos de data
 *      idênticos não se leem; "Hoje" e uma hora se leem.
 *   3. **Uma FRASE por linha** (`audit-phrases.js`), em vez de cinco colunas de código em
 *      maiúsculas. O código cru só aparece quando a ação não tem frase — de propósito,
 *      para que uma ação nova sem tradução seja visível em vez de virar "Desconhecido".
 *   4. **O `details` fica atrás de um botão.** Ele é o dado bruto, e dado bruto na linha
 *      é o que transforma a lista num log. Dentro da gaveta o DE-PARA vem primeiro e em
 *      frases (`linhasDoDePara`), com o regime dito por extenso: desde 2026-08-21 a trilha
 *      grava o que mudou em três regimes, e uma impressão de doze hexadecimais sem a
 *      palavra "impressão" ao lado lê-se como um valor gravado.
 *
 * A DATA DE CORTE É DECLARADA, e isso não é adorno: o eixo de OM foi retroagido por um
 * backfill que atribuiu a história antiga à OM ATUAL do recurso — a única aproximação de
 * todo o desenho. Sem a frase, a primeira investigação séria trataria dado aproximado
 * como dado gravado.
 *
 * Imports DIRETOS dos arquivos, nunca dos barrels `@utils`/`@modals`: `admin.html` boota
 * sem a store, e o barrel a arrasta pelo caminho transitivo.
 */

import { apiClient } from '@store/sync/api-client.js';
import { showError } from '@utils/toast_service.js';
import {
    setupCleanup,
    addScopedDomListener,
    clearScopedListeners,
    cleanup,
} from '@utils/event-cleanup.js';
import config from '@js/config.js';
import { sectionHeader, card, avatar, emptyState, ICON_AUDIT } from './admin-dom.js';
import { buildDomainOptions } from './org-options.js';
import {
    acoesPorFamilia,
    agruparPorDia,
    alvoDoEvento,
    familiaDeAcao,
    fraseDoEvento,
    horaDoEvento,
    linhasDeDetalhe,
    linhasDoDePara,
    nomeDaOm,
    nomeDoAlvo,
    nomeDoAtor,
    rotuloDeAcao,
    rotuloDeAlvo,
    rotuloDeFamilia,
    rotuloDoDia,
} from './audit-phrases.js';

/** Quantas linhas por página. O servidor aceita até 200; 50 é o padrão dele e desta tela. */
const POR_PAGINA = 50;

/** Os atalhos de período, em dias. `null` é "tudo", e ele existe mas não é o padrão. */
const PERIODOS = [
    { dias: 7, rotulo: '7 dias' },
    { dias: 30, rotulo: '30 dias' },
    { dias: 90, rotulo: '90 dias' },
    { dias: null, rotulo: 'Tudo' },
];

/** Os tipos de alvo oferecidos no filtro, na ordem em que a tela os agrupa. */
const TIPOS_DE_ALVO = [
    'USER', 'ORG', 'ATLAS', 'ACCESS_GROUP',
    'BASEMAP', 'DATA_LAYER', 'ANALYSIS_LAYER', 'TILESET', 'SV360_PROJECT', 'CONFIG',
];

/**
 * Builds the "Auditoria" tab definition for the admin panel.
 * @returns {import('./admin-panel.js').AdminTab}
 */
export function createAuditTab() {
    const tab = new AuditTab();
    return {
        id: 'audit',
        label: 'Auditoria',
        testid: 'admin-tab-audit',
        icon: ICON_AUDIT,
        mount: (container) => tab.mount(container),
    };
}

class AuditTab {
    /**
     * @param {HTMLElement} container
     * @returns {Function} cleanup
     */
    mount(container) {
        this._container = container;
        this._alive = true;
        // NÃO HÁ FILTRO POR ATOR nesta primeira versão, e a ausência é declarada: a rota
        // aceita `actorId`, mas resolver um nome em UUID exige `GET /users/search`, e a
        // tela é do produtor também. Um campo que pedisse UUID cru seria um controle que
        // ninguém usa. O caminho até "o que fulano fez" continua sendo filtrar por ação e
        // ler a coluna do ator.
        this._filtros = { action: '', targetType: '', targetId: '', targetOrgId: '' };
        this._dias = 7;
        this._page = 1;
        // NASCE FECHADO: enquanto a primeira resposta não chega, a tela assume que NÃO
        // administra. Um `true` provisório desenharia a coluna de OM e o filtro dela para
        // um produtor, por uma fração de segundo, e depois os tiraria.
        this._administra = false;
        setupCleanup(this);
        this._render();
        return () => {
            this._alive = false;
            cleanup(this);
        };
    }

    /** @private Começa uma vista: solta os listeners da anterior e esvazia o container. */
    _beginView() {
        clearScopedListeners(this, 'view');
        this._container.replaceChildren();
        return this._container;
    }

    /**
     * @private Os parâmetros da consulta, já com o período resolvido.
     *
     * O PERÍODO É MEIO-ABERTO no servidor (`>= from`, `< to`), e aqui só o `from` é
     * calculado: "os últimos N dias" não tem fim.
     * @returns {Object}
     */
    _params() {
        const p = { page: this._page, limit: POR_PAGINA, ...this._filtros };
        if (this._dias) {
            const desde = new Date(Date.now() - this._dias * 86400000);
            p.from = desde.toISOString();
        }
        // O filtro de OM é do administrador. Mandá-lo como produtor não faria mal (o
        // servidor o ignora), mas a tela não deve pedir o que não pode: um parâmetro que
        // o servidor descarta é uma afordância que mente.
        if (!this._administra) delete p.targetOrgId;
        return p;
    }

    /**
     * @private Monta o esqueleto da vista (cabeçalho + barra + cartão da lista).
     * @returns {HTMLElement} O cartão que hospeda a lista.
     */
    _esqueleto() {
        const c = this._beginView();
        c.appendChild(sectionHeader('Auditoria', {
            subtitle: 'O que foi feito no servidor: quem, quando, sobre o quê',
        }));
        c.appendChild(this._toolbar());
        const wrap = card({ testid: 'admin-audit-list', padded: false });
        wrap.className += ' admin-audit';
        c.appendChild(wrap);
        return wrap;
    }

    /** @private Busca e redesenha. */
    async _render() {
        const wrap = this._esqueleto();
        const carregando = document.createElement('p');
        carregando.className = 'admin-users__status';
        carregando.textContent = 'Carregando a trilha…';
        wrap.appendChild(carregando);

        let resposta;
        try {
            resposta = await apiClient.listAudit(this._params());
        } catch (err) {
            if (!this._alive) return;
            carregando.textContent = 'Falha ao carregar a trilha de auditoria.';
            showError(err?.message || 'Falha ao carregar a trilha de auditoria.');
            return;
        }
        if (!this._alive) return;

        const administravaAntes = this._administra;
        this._administra = resposta?.administra === true;
        // O ESCOPO SÓ SE DESCOBRE NA PRIMEIRA RESPOSTA, então a barra de filtros precisa
        // ser redesenhada UMA vez quando ele muda. Redesenhar sempre piscaria a tela a
        // cada busca; nunca redesenhar deixaria o administrador sem os filtros dele.
        //
        // E A REDESENHA REAPROVEITA A RESPOSTA que já chegou, em vez de chamar `_render()`
        // de novo: a resposta NÃO depende de `administra` (o recorte é do servidor, não da
        // tela), então a segunda consulta seria idêntica à primeira — uma requisição a
        // mais e um segundo "Carregando…" em TODA montagem de administrador.
        this._renderLista(administravaAntes === this._administra ? wrap : this._esqueleto(),
            resposta);
    }

    /** @private A barra de filtros. */
    _toolbar() {
        const barra = document.createElement('div');
        barra.className = 'admin-audit__toolbar';
        barra.dataset.testid = 'admin-audit-toolbar';

        // --- período ---------------------------------------------------------
        const periodo = document.createElement('div');
        periodo.className = 'admin-audit__periodo';
        for (const opt of PERIODOS) {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'admin-btn admin-btn--sm'
                + (this._dias === opt.dias ? ' admin-btn--primary' : ' admin-btn--ghost');
            b.textContent = opt.rotulo;
            b.dataset.testid = `admin-audit-periodo-${opt.dias ?? 'tudo'}`;
            addScopedDomListener(this, 'view', b, 'click', () => {
                this._dias = opt.dias;
                this._page = 1;
                this._render();
            });
            periodo.appendChild(b);
        }
        barra.appendChild(periodo);

        // --- ação, agrupada por família --------------------------------------
        const acao = this._select('admin-audit-acao', 'Ação', (v) => {
            this._filtros.action = v;
            this._page = 1;
            this._render();
        });
        acao.control.appendChild(this._option('', 'Todas as ações'));
        for (const grupo of acoesPorFamilia()) {
            const og = document.createElement('optgroup');
            og.label = rotuloDeFamilia(grupo.familia);
            for (const a of grupo.acoes) og.appendChild(this._option(a.valor, a.rotulo));
            acao.control.appendChild(og);
        }
        acao.control.value = this._filtros.action;
        barra.appendChild(acao.wrap);

        // --- tipo de alvo -----------------------------------------------------
        const tipo = this._select('admin-audit-tipo', 'Tipo de alvo', (v) => {
            this._filtros.targetType = v;
            this._page = 1;
            this._render();
        });
        tipo.control.appendChild(this._option('', 'Todos os tipos'));
        for (const t of TIPOS_DE_ALVO) tipo.control.appendChild(this._option(t, rotuloDeAlvo(t)));
        tipo.control.value = this._filtros.targetType;
        barra.appendChild(tipo.wrap);

        // --- alvo exato -------------------------------------------------------
        const alvo = this._campo('admin-audit-alvo', 'Alvo (id exato)', this._filtros.targetId,
            (v) => {
                this._filtros.targetId = v;
                this._page = 1;
                this._render();
            });
        barra.appendChild(alvo);

        // --- OM alvo: SÓ o administrador -------------------------------------
        if (this._administra) {
            const om = this._select('admin-audit-om', 'OM do acervo', (v) => {
                this._filtros.targetOrgId = v;
                this._page = 1;
                this._render();
            });
            // A RESOLUÇÃO id → nome MORA EM `org-options.js`, e não aqui: o `@fileoverview`
            // daquele arquivo conta que ele nasceu porque a mesma resolução tinha ido parar
            // em DUAS abas, já divergentes. Uma terceira cópia perderia de graça o caso que
            // ele trata e esta tela precisa: a OM DESATIVADA some de
            // `config.organizacoesMilitares`, e é justamente o estado que dispara
            // investigação — `buildDomainOptions` a mantém endereçável, rotulada "(atual)".
            for (const opt of buildDomainOptions(
                config.organizacoesMilitares,
                this._filtros.targetOrgId,
                undefined,
                'Todas as OM',
            )) {
                om.control.appendChild(this._option(opt.value, opt.label));
            }
            om.control.value = this._filtros.targetOrgId;
            barra.appendChild(om.wrap);
        }

        // O AVISO DO BACKFILL. Ele fica na barra e não num rodapé porque é uma
        // ressalva sobre o que a lista SIGNIFICA, e ressalva que aparece depois da
        // conclusão chega tarde.
        const nota = document.createElement('p');
        nota.className = 'admin-audit__nota';
        nota.textContent = 'A OM de cada linha é a OM dona do recurso na época do ato. '
            + 'Para atos anteriores à criação deste eixo, ela foi deduzida da OM atual do '
            + 'recurso, e o que já havia sido destruído ficou sem OM.';
        barra.appendChild(nota);

        return barra;
    }

    /** @private Um `<option>`. */
    _option(valor, rotulo) {
        const o = document.createElement('option');
        o.value = valor;
        o.textContent = rotulo;
        return o;
    }

    /** @private Um `<select>` rotulado, com o listener no escopo da vista. */
    _select(testid, rotulo, onChange) {
        const wrap = document.createElement('label');
        wrap.className = 'admin-audit__filtro';
        const span = document.createElement('span');
        span.className = 'admin-audit__filtro-rotulo';
        span.textContent = rotulo;
        const control = document.createElement('select');
        control.className = 'admin-audit__select';
        control.dataset.testid = testid;
        addScopedDomListener(this, 'view', control, 'change', () => onChange(control.value));
        wrap.append(span, control);
        return { wrap, control };
    }

    /** @private Um campo de texto que aplica no Enter (nunca a cada tecla: é uma consulta). */
    _campo(testid, rotulo, valor, onAplicar) {
        const wrap = document.createElement('label');
        wrap.className = 'admin-audit__filtro';
        const span = document.createElement('span');
        span.className = 'admin-audit__filtro-rotulo';
        span.textContent = rotulo;
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'admin-audit__input';
        input.dataset.testid = testid;
        input.value = valor || '';
        input.placeholder = 'Enter para filtrar';
        addScopedDomListener(this, 'view', input, 'keydown', (e) => {
            if (e.key === 'Enter') onAplicar(input.value.trim());
        });
        wrap.append(span, input);
        return wrap;
    }

    /**
     * @private A lista, agrupada por dia.
     * @param {HTMLElement} host
     * @param {Object} resposta
     */
    _renderLista(host, resposta) {
        host.replaceChildren();
        const linhas = Array.isArray(resposta?.data) ? resposta.data : [];

        if (linhas.length === 0) {
            host.appendChild(emptyState('Nenhum evento no período.', {
                hint: 'Amplie o período ou limpe os filtros. Lista vazia aqui significa '
                    + '"nada casou o filtro", nunca "nada aconteceu".',
            }));
            host.appendChild(this._rodape(resposta));
            return;
        }

        for (const grupo of agruparPorDia(linhas)) {
            const sec = document.createElement('section');
            sec.className = 'admin-audit__day';
            sec.dataset.testid = 'admin-audit-day';

            const cab = document.createElement('h4');
            cab.className = 'admin-audit__day-header';
            cab.textContent = rotuloDoDia(grupo.dia);
            sec.appendChild(cab);

            for (const linha of grupo.linhas) sec.appendChild(this._linha(linha));
            host.appendChild(sec);
        }
        host.appendChild(this._rodape(resposta));
    }

    /**
     * @private Uma linha: hora, ator, chip da ação, alvo e (só admin) a OM.
     * @param {Object} linha
     * @returns {HTMLElement}
     */
    _linha(linha) {
        const item = document.createElement('div');
        item.className = 'admin-audit__row';
        item.dataset.testid = 'admin-audit-row';

        const hora = document.createElement('span');
        hora.className = 'admin-audit__time';
        hora.textContent = horaDoEvento(linha.created_at);
        // O instante completo fica no `title`: a hora curta é para ler, o carimbo inteiro
        // é para citar num relatório.
        hora.title = String(linha.created_at ?? '');
        item.appendChild(hora);

        item.appendChild(avatar(nomeDoAtor(linha), linha.actor_id || linha.actor_username));

        const corpo = document.createElement('div');
        corpo.className = 'admin-audit__body';

        const chip = document.createElement('span');
        chip.className = `admin-chip admin-audit__chip admin-audit__chip--${familiaDeAcao(linha.action)}`;
        chip.textContent = rotuloDeAcao(linha.action);
        corpo.appendChild(chip);

        const frase = document.createElement('span');
        frase.className = 'admin-audit__frase';
        // O CHIP AO LADO JÁ É O RÓTULO DA AÇÃO, então a linha visível traz só ator e alvo:
        // com `fraseDoEvento` aqui, "Item de catálogo alterado" aparecia duas vezes na
        // mesma linha. A frase INTEIRA continua existindo no `title`, que é onde ela é útil
        // (ler o evento sem o chip ao lado, e copiar para um relatório).
        frase.textContent = alvoDoEvento(linha);
        // O id do alvo NÃO entra no texto (slug e UUID o tornam ilegível) e não pode
        // sumir: ele é a chave de "tudo que já foi feito com esta coisa".
        frase.title = `${fraseDoEvento(linha)} · ${nomeDoAlvo(linha)} · ${linha.target_id ?? ''}`;
        corpo.appendChild(frase);

        item.appendChild(corpo);

        if (this._administra) {
            const om = document.createElement('span');
            om.className = 'admin-audit__om';
            om.textContent = nomeDaOm(linha);
            om.title = linha.target_org_nome || 'Sem OM dona (conta, atlas, configuração '
                + 'ou acervo institucional)';
            item.appendChild(om);
        }

        // OS DETALHES ATRÁS DE UM BOTÃO: é o que separa esta tela de um log.
        const detalhes = linha.details;
        if (detalhes && typeof detalhes === 'object' && Object.keys(detalhes).length > 0) {
            const gaveta = document.createElement('div');
            gaveta.className = 'admin-audit__details';
            gaveta.hidden = true;
            gaveta.appendChild(this._detalhes(detalhes));

            const botao = document.createElement('button');
            botao.type = 'button';
            botao.className = 'admin-btn admin-btn--sm admin-btn--ghost';
            botao.dataset.testid = 'admin-audit-details';
            botao.textContent = 'Detalhes';
            botao.setAttribute('aria-expanded', 'false');
            addScopedDomListener(this, 'view', botao, 'click', () => {
                gaveta.hidden = !gaveta.hidden;
                botao.setAttribute('aria-expanded', String(!gaveta.hidden));
            });
            item.appendChild(botao);
            corpo.appendChild(gaveta);
        }

        return item;
    }

    /**
     * @private O `details` campo a campo, em DUAS seções.
     *
     * TUDO POR `textContent`, inclusive as chaves: `details` é escrito pelo servidor, mas
     * carrega nome de grupo e de recurso digitados por outra pessoa.
     *
     * A PRIMEIRA SEÇÃO É O DE-PARA, e ela é o motivo desta gaveta existir. Desde
     * 2026-08-21 `CATALOG_UPDATE` grava o que mudou em três regimes (valor literal para
     * uma allowlist de campos pequenos, IMPRESSÃO para endereço e mídia, nome-só para o
     * resto), e ler `mudou`/`outros` como JSON cru desperdiçaria a informação que eles
     * carregam. Quem decide a frase de cada regime é `linhasDoDePara`, módulo puro.
     *
     * A REGRA ANTIGA ("`details` nunca carrega valor de campo") virou o PISO e não sumiu:
     * o que não está classificado continua entrando só pelo nome. Esta tela mostra o que
     * chegar, então quem afrouxar a classificação do servidor precisa voltar aqui.
     *
     * A SEGUNDA SEÇÃO é o resto do `details` (`table`, `slug`, `resurrected`, `self`…), com
     * as chaves do de-para retiradas para não repetir o que a primeira já disse. `fields`
     * entra nessa retirada SÓ quando há frases (a decisão é `chavesJaDitasPeloDePara`, no
     * módulo puro): numa linha antiga, sem de-para, ela é a única informação de campo que
     * existe.
     *
     * ELA DEIXOU DE SER CHAVE/VALOR CRU em 2026-08-23, e o defeito que isso fecha era
     * concreto: `origem: USER_DEMOTION` saía em inglês e em maiúsculas num painel em
     * português, exatamente onde o leitor precisava entender por que uma concessão que
     * ninguém revogou aparecia revogada. Quem decide a frase é `linhasDeDetalhe`, no
     * módulo puro, e ele devolve DUAS bandeiras: o que não tem verbete continua
     * aparecendo, e aparece com a classe de CÓDIGO. Esconder é pior que mostrar; mostrar
     * um enum com cara de frase é pior que mostrá-lo como código.
     * @param {Object} detalhes
     * @returns {HTMLElement}
     */
    _detalhes(detalhes) {
        const dl = document.createElement('dl');
        dl.className = 'admin-audit__details-list';

        const frases = linhasDoDePara(detalhes);
        for (const { campo, texto } of frases) {
            const dt = document.createElement('dt');
            dt.className = 'admin-audit__details-campo';
            dt.textContent = campo;
            const dd = document.createElement('dd');
            dd.className = 'admin-audit__details-depara';
            dd.textContent = texto;
            dl.append(dt, dd);
        }

        for (const linha of linhasDeDetalhe(detalhes)) {
            const dt = document.createElement('dt');
            dt.textContent = linha.chave;
            if (linha.chaveEhCodigo) dt.classList.add('admin-audit__details-codigo');
            const dd = document.createElement('dd');
            dd.textContent = linha.texto;
            if (linha.textoEhCodigo) dd.classList.add('admin-audit__details-codigo');
            dl.append(dt, dd);
        }
        return dl;
    }

    /**
     * @private O rodapé: total, página e os dois botões.
     * @param {Object} resposta
     * @returns {HTMLElement}
     */
    _rodape(resposta) {
        const total = Number(resposta?.total ?? 0);
        const limite = Number(resposta?.limit ?? POR_PAGINA) || POR_PAGINA;
        const pagina = Number(resposta?.page ?? 1) || 1;
        const paginas = Math.max(1, Math.ceil(total / limite));

        const rodape = document.createElement('div');
        rodape.className = 'admin-audit__pager';
        rodape.dataset.testid = 'admin-audit-pager';

        const resumo = document.createElement('span');
        resumo.className = 'admin-audit__pager-resumo';
        resumo.textContent = `${total} ${total === 1 ? 'evento' : 'eventos'}`
            + ` · página ${pagina} de ${paginas}`;
        rodape.appendChild(resumo);

        const botao = (rotulo, testid, destino, ativo) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'admin-btn admin-btn--sm admin-btn--ghost';
            b.dataset.testid = testid;
            b.textContent = rotulo;
            b.disabled = !ativo;
            if (ativo) {
                addScopedDomListener(this, 'view', b, 'click', () => {
                    this._page = destino;
                    this._render();
                });
            }
            return b;
        };
        rodape.appendChild(botao('Anterior', 'admin-audit-prev', pagina - 1, pagina > 1));
        rodape.appendChild(botao('Próxima', 'admin-audit-next', pagina + 1, pagina < paginas));
        return rodape;
    }
}
