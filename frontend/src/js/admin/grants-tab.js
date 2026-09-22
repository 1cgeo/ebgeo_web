// Path: js/admin/grants-tab.js

/**
 * @fileoverview Aba "Concessões" — as concessões de recurso privado do acervo vistas dos DOIS
 * lados: o que esta pessoa concedeu e o que concederam a ela.
 *
 * A TELA DO MEIO QUE FALTAVA. Até 2026-08-24 a única superfície de concessão era o modal de UM
 * recurso (`catalog/resource-share.modal.js`), alcançável a partir do cartão daquele recurso no
 * catálogo. Para revogar alguma coisa era preciso LEMBRAR qual recurso havia sido concedido,
 * achá-lo, abrir o modal e procurar a linha. Sem inventário, some a revisão periódica (a higiene
 * natural de quem distribui acesso com prazo) e some a resposta a "por que Fulano vê isto?" pelo
 * lado de quem concedeu. O credenciado, cujo papel é DEFINIDO por conceder, não tem trilha de
 * auditoria (decisão registrada), então esta aba é o único inventário que ele tem.
 *
 * OS DOIS LADOS EM UMA ABA SÓ, e o lado RECEBIDO é a novidade do produto: nenhuma tela falava com
 * quem recebeu. Quem recebeu com nível `view` nunca viu o chip de prazo, porque ele mora atrás de
 * um botão que só quem CONCEDE alcança, e o prazo é justamente o fato que ninguém adivinha: a
 * morte da concessão mora no predicado do servidor, e no dia seguinte o recurso some do catálogo
 * sem evento e sem aviso. As frases estão em `grant-phrases.js`, folha e testável em node.
 *
 * REVOGAR SÓ SAI DO LADO ESQUERDO, e isso é propriedade da consulta, não um gate desenhado aqui: o
 * servidor aceita revogação de quem concedeu (mais o administrador global), e a lista de
 * `listIssuedGrants` é, por construção, a das linhas que esta pessoa concedeu. É a mesma
 * propriedade que `revokeAvailability` (`catalog/grant-tree.js`) precisa simular linha a linha
 * dentro do modal, onde a lista é do RECURSO e mistura concedentes.
 *
 * A PROPRIEDADE VALE NUMA DIREÇÃO SÓ PARA O ADMINISTRADOR, e a aba passou a ser dele em
 * 2026-08-24. `grants/issued` filtra por `granted_by`, sem ramo de papel: toda linha que ele vê é
 * dele e o botão continua honesto, mas o alcance DELE é maior que a lista, porque o ramo largo de
 * `requireGrantRevoker` é administração do sistema. Subdeclarar autoridade também engana, então a
 * assimetria era dita na tela por uma nota, que SAIU em 2026-09-20 por decisão do dono. Com ela
 * foi embora a última coisa que variava por papel global aqui, e o parâmetro `isAdmin` deixou de
 * ter leitor: a aba passou a ser a mesma para as três audiências que a abrem. Ele continua na
 * assinatura porque `mountAdminPage` o passa às sete abas pelo mesmo caminho, e tirá-lo de UMA
 * seria uma exceção a explicar em dois arquivos.
 *
 * CONCEDER SAI DAQUI TAMBÉM, desde 2026-09-22 (decisão do dono, item 19b, que supera a de
 * 2026-08-24 de "a aba nomeia onde se concede, e o botão não nasce aqui"). "Conceder acesso", no
 * cabeçalho de "Concedidos por mim", escolhe um recurso da lista que o SERVIDOR diz que esta pessoa
 * pode compartilhar (`shareable-resources.js`, sobre o payload de `GET /resource-access/visible`) e
 * abre o MESMO modal do mapa, pelo núcleo sem store (`catalog/resource-share.modal.core.js`). O
 * motivo técnico da decisão antiga continua valendo como restrição, e é o que o núcleo resolve: o
 * motor de sync não entra nesta página, e a re-soma do catálogo que ele fazia depois de revogar é
 * efeito do mapa, injetado lá. Aqui o efeito é reler as duas listas. O POSTO SOME: sem recurso
 * nenhum para compartilhar, o comando não se desenha, e uma frase curta diz por quê.
 *
 * `viaGroup` É VISÍVEL DE PROPÓSITO. É a única transferência de autoridade do sistema que não gera
 * linha própria em `resource_grants`: o acesso vem da membresia, e sai junto com ela. Sem o rótulo,
 * a pessoa procuraria uma concessão que não existe para entender por que perdeu o recurso.
 *
 * Todo texto dinâmico entra por `textContent`: nome de recurso, de pessoa e de grupo são texto
 * livre escrito por outra pessoa.
 */

import { apiClient } from '@store/sync/api-client.js';
import { militaryPersonLabel } from '@utils/person-label.js';
import { showConfirm } from '@modals/confirm.modal.js';
import { showSuccess, showError } from '@utils/toast_service.js';
import { serverMessageOr } from '@utils/request-failure.js';
// O campo que escolhe o recurso a conceder, o MESMO componente das listas de OM de Usuários: lista
// controlada, filtro por digitação, e o valor é a chave, nunca o texto digitado.
import { createSearchableSelect } from '@ui/searchable-select.js';
// A lista do que se pode compartilhar, decidida sobre o payload do SERVIDOR (folha, zero imports).
import { shareableKey, shareableResources } from './shareable-resources.js';
// Do ARQUIVO, nunca dos barrels `@utils` / `@modals`: esta página não carrega a store, e os
// barrels a alcançam transitivamente.
import {
    setupCleanup,
    addScopedDomListener,
    clearScopedListeners,
    cleanup,
} from '@utils/event-cleanup.js';
import { sectionHeader, card, emptyState, failureState, ICON_GRANTS } from './admin-dom.js';
// A ESCADA DE PRAZO E A ARITMÉTICA DA EXTENSÃO SÃO COMPARTILHADAS com o modal de recurso, que é a
// outra tela que estende concessão. `grant-tree.js` tem UM import desde 2026-09-20, e ele é uma
// folha de zero imports (`@utils/person-label.js`, o compositor do rótulo militar), então trazê-lo
// para cá continua não arrastando a store para `admin.html`, que boota sem ela.
import {
    extensionDeadline,
    extensionOutcome,
    extensionSummary,
    GRANT_TERM_DEFAULT_DAYS,
    GRANT_TERMS,
} from '@js/catalog/grant-tree.js';
import {
    expiryChip,
    grantLevelLabel,
    grantLevelDescription,
    grantPickerLabel,
    granteeGroupNotice,
    granteeLabel,
    grantorLabel,
    isGroupGrant,
    issuedEmptyHint,
    issuedEmptyNotice,
    issuedExtensionHint,
    issuedExtensionTermLabel,
    issuedFailureNotice,
    issuedRevocationSummary,
    issuedRevocationWarning,
    receivedEmptyHint,
    receivedEmptyNotice,
    receivedExpiryNotice,
    receivedFailureNotice,
    receivedNotRevocableNotice,
    resourceDisplayName,
    resourceIdentityTitle,
    resourceTypeLabel,
    shareableEmptyNotice,
    shareableFailureNotice,
    shortDate,
    viaGroupLabel,
    viaGroupNotice,
} from './grant-phrases.js';

/**
 * Builds the "Concessões" tab definition for the admin panel.
 * @param {{isAdmin?: boolean}} [principal] - O papel GLOBAL de quem abriu o painel, já lido por
 *   `mountAdminPage`. NADA nesta aba varia por ele desde 2026-09-20: o que variava era uma nota,
 *   e ela saiu. Gate nenhum morou aqui em tempo algum, porque o gate é do servidor.
 * @returns {import('./admin-panel.js').AdminTab}
 */
export function createGrantsTab({ isAdmin = false } = {}) {
    const tab = new GrantsTab({ isAdmin });
    return {
        id: 'grants',
        label: 'Concessões',
        testid: 'admin-tab-grants',
        icon: ICON_GRANTS,
        mount: (container) => tab.mount(container),
    };
}

class GrantsTab {
    /**
     * @param {{isAdmin?: boolean}} [principal]
     */
    constructor({ isAdmin = false } = {}) {
        // GUARDADO SEM LEITOR, de propósito: a nota que dependia dele saiu, e o campo fica
        // como o ponto de amarração de qualquer coisa que volte a variar por papel. Ver o
        // `@fileoverview`.
        this._isAdmin = isAdmin === true;
    }

    /**
     * @param {HTMLElement} container
     * @returns {Function} cleanup
     */
    mount(container) {
        this._container = container;
        this._alive = true;
        // O PRAZO ESCOLHIDO SOBREVIVE ao re-render da seção (cada ato relê as duas listas), e é
        // por isso que ele mora aqui e não no seletor: quem renova cinco linhas por 30 dias
        // escolheria 30 cinco vezes se o estado voltasse ao padrão a cada clique.
        this._dias = GRANT_TERM_DEFAULT_DAYS;
        this._busy = false;
        /** @type {number} Cada `_render` leva um número; a resposta de um render superado não desenha. */
        this._renderSeq = 0;
        /** @type {import('@ui/searchable-select.js').SearchableSelect|null} O campo de escolha aberto. */
        this._picker = null;
        setupCleanup(this);
        this._render();
        return () => {
            this._alive = false;
            this._destroyPicker();
            cleanup(this);
        };
    }

    /**
     * @private A aba inteira. As DUAS chamadas vão juntas e cada uma falha por conta própria: são
     * duas rotas, e uma rede ruim que derrube a segunda não pode esconder a primeira.
     */
    async _render() {
        // O NÚMERO DO RENDER, porque agora há quem peça render de fora: o modal de compartilhar
        // avisa a cada escrita (`onAccessChanged`), sem esperar, e duas releituras em voo
        // terminariam fora de ordem, a mais velha desenhando por cima da mais nova.
        const meu = ++this._renderSeq;
        clearScopedListeners(this, 'view');
        this._destroyPicker();
        const c = this._container;
        c.replaceChildren();

        c.appendChild(sectionHeader('Concessões', {
            subtitle: 'Os acessos a recursos privados do acervo que você concedeu e que concederam '
                + 'a você',
        }));

        // DUAS NOTAS SAÍRAM DAQUI EM 2026-09-20, por decisão do dono, e o que elas diziam
        // fica registrado aqui porque continua VERDADE do servidor, só deixou de ser dito na
        // tela. A primeira avisava que esta aba lista CONCESSÃO, uma a uma, e que acesso por
        // papel global, por recurso público ou por empréstimo de atlas não tem linha em
        // `resource_grants`. A segunda dizia a assimetria do administrador: `grants/issued`
        // filtra por `granted_by`, sem ramo de papel, enquanto o gate de revogação do servidor
        // (`requireGrantRevoker`) tem um ramo largo de administração do sistema, de modo que
        // ele revoga também o que não originou. Nenhuma linha da lista fica desonesta por
        // isso; o que a lista faz é SUBDECLARAR o alcance dele. A outra superfície de
        // concessão continua sendo o cartão do recurso, no catálogo.

        const concedidos = document.createElement('section');
        concedidos.className = 'admin-grants__section';
        concedidos.dataset.testid = 'admin-grants-issued';
        c.appendChild(concedidos);

        const recebidos = document.createElement('section');
        recebidos.className = 'admin-grants__section';
        recebidos.dataset.testid = 'admin-grants-received';
        c.appendChild(recebidos);

        this._renderLoading(concedidos, 'Concedidos por mim', 'Carregando as concessões que você fez…');
        this._renderLoading(recebidos, 'Recebidos por mim', 'Carregando os acessos concedidos a você…');

        // AS DUAS CHAMADAS PASSAM POR `settle`, e não vão cruas para o `allSettled`. O motivo é
        // estreito e vale um comentário: `Promise.allSettled` só protege de promessa REJEITADA, e o
        // array de argumentos é avaliado antes dele. Um erro SÍNCRONO ali (o caso concreto é o
        // método não existir no cliente HTTP, numa implantação em que a rota ainda não chegou)
        // escapa por cima do `allSettled`, sai de `_render` como rejeição não tratada, e a aba fica
        // no "Carregando…" para sempre. Com o embrulho, esse caso cai na tela de FALHA, que tem
        // botão de tentar de novo.
        //
        // A TERCEIRA É A LISTA DO QUE SE PODE COMPARTILHAR, e ela é o payload aditivo SEM atlas em
        // foco: é ele que diz, recurso a recurso, o que o gate de repasse aceita
        // (`shareable-resources.js`). Falhar nela não esconde as outras duas, e não se lê como
        // "você não pode compartilhar nada": ver `_grantCommand`.
        const [emitidas, recebidas, visiveis] = await Promise.allSettled([
            settle(() => apiClient.listIssuedGrants()),
            settle(() => apiClient.listReceivedGrants()),
            settle(() => apiClient.getVisibleResources(null)),
        ]);
        if (!this._alive || meu !== this._renderSeq) return;

        this._renderIssued(concedidos, emitidas, visiveis);
        this._renderReceived(recebidos, recebidas);
    }

    /**
     * @private O terceiro estado de tela, distinto do vazio e da falha.
     * @param {HTMLElement} host @param {string} titulo @param {string} texto
     */
    _renderLoading(host, titulo, texto) {
        host.replaceChildren();
        host.appendChild(sectionHeader(titulo));
        const wrap = card({ padded: false });
        const p = document.createElement('p');
        p.className = 'admin-users__status';
        p.textContent = texto;
        wrap.appendChild(p);
        host.appendChild(wrap);
    }

    /**
     * @private As linhas de um payload `{ grants: [...] }`.
     *
     * Aceita também o array nu: o contrato acordado é o envelope, e um servidor que devolva a lista
     * crua não pode virar "nenhuma concessão", que é a leitura errada mais cara desta tela.
     * @param {*} payload
     * @returns {Array<Object>}
     */
    static _rows(payload) {
        const linhas = Array.isArray(payload) ? payload
            : (Array.isArray(payload?.grants) ? payload.grants : []);
        return linhas.map(GrantsTab._comRotuloMilitar);
    }

    /**
     * @private Rewrites the two person names of a row in the military form, "Cap Silva".
     *
     * THE SAME GRANT READ "Cap Andrade" in the resource dialog and "Maria Clara de Andrade" here,
     * because this tab rendered the single string the server sends. The server now also sends the
     * pieces (war name, abbreviated rank) and the label is built by the ONE composer every other
     * screen uses, here in the funnel both lists go through, so the row, the confirm dialog and
     * the toast all name the person the same way. A GROUP keeps its own name.
     * @param {Object} grant
     * @returns {Object} A copy with `granteeName` and `grantorName` recomposed
     */
    static _comRotuloMilitar(grant) {
        if (!grant || typeof grant !== 'object') return grant;
        const saida = { ...grant };
        if (grant.granteeKind !== 'group' && (grant.granteeNomeGuerra || grant.granteePostoGraduacao)) {
            saida.granteeName = militaryPersonLabel({
                nome: grant.granteeName,
                nome_guerra: grant.granteeNomeGuerra,
                posto_graduacao: grant.granteePostoGraduacao,
            }).label;
        }
        if (grant.grantorNomeGuerra || grant.grantorPostoGraduacao) {
            saida.grantorName = militaryPersonLabel({
                nome: grant.grantorName,
                nome_guerra: grant.grantorNomeGuerra,
                posto_graduacao: grant.grantorPostoGraduacao,
            }).label;
        }
        return saida;
    }

    /**
     * @private O que EU concedi, com o comando de conceder e os botões de renovar e revogar.
     * @param {HTMLElement} host
     * @param {PromiseSettledResult<*>} resultado - `grants/issued`.
     * @param {PromiseSettledResult<*>} visiveis - o payload aditivo, de onde sai o que se pode
     *   compartilhar.
     */
    _renderIssued(host, resultado, visiveis) {
        host.replaceChildren();
        const comando = this._grantCommand(visiveis);
        host.appendChild(sectionHeader('Concedidos por mim', {
            subtitle: 'O que você concedeu, a quem e até quando. Para revogar, use o botão da linha.',
            actions: comando.actions,
        }));
        if (comando.nota) host.appendChild(comando.nota);

        // A VAGA DA ESCOLHA DE RECURSO, entre o cabeçalho e a tabela, vazia até o clique.
        const vaga = document.createElement('div');
        vaga.dataset.testid = 'admin-grants-picker-slot';
        vaga.hidden = true;
        host.appendChild(vaga);
        this._pickerSlot = vaga;

        const wrap = card({ testid: 'admin-grants-issued-table', padded: false });
        host.appendChild(wrap);

        if (resultado.status === 'rejected') {
            wrap.appendChild(failureState(issuedFailureNotice(), {
                onRetry: () => { if (this._alive) this._render(); },
            }));
            return;
        }

        const linhas = GrantsTab._rows(resultado.value);
        if (linhas.length === 0) {
            wrap.appendChild(emptyState(issuedEmptyNotice(), {
                hint: issuedEmptyHint(comando.podeConceder),
            }));
            return;
        }

        // O SELETOR DE PRAZO VEM ANTES DA TABELA e é UM para a seção, como no modal de recurso:
        // renovar linha a linha com um seletor por linha encheria a coluna de ações de controle e
        // faria a revisão periódica (que é o ponto desta aba) custar um clique a mais por linha. E
        // ele só existe quando há linha, porque um seletor acima de uma tabela vazia não comanda
        // nada.
        host.insertBefore(this._termPicker(), wrap);

        const { table, tbody } = buildTable(
            ['Recurso', 'Para quem', 'Nível', 'Concedido em', 'Vencimento', ''],
        );
        for (const grant of linhas) {
            const tr = document.createElement('tr');
            tr.dataset.testid = 'admin-grants-issued-row';
            tr.dataset.grantId = String(grant?.id ?? '');

            tr.appendChild(this._resourceCell(grant));
            tr.appendChild(this._granteeCell(grant));
            tr.appendChild(levelCell(grant?.level));
            tr.appendChild(cell(shortDate(grant?.createdAt) || '—'));
            tr.appendChild(expiryCell(grant?.expiresAt, 'issued'));

            const acoes = document.createElement('td');
            acoes.className = 'admin-users__actions';
            // RENOVAR ANTES DE REVOGAR, e a ordem não é estética: o ato aditivo não pode ficar
            // depois do destrutivo na varredura do olho, senão a linha inteira se lê como uma
            // linha de risco. Mesma razão pela qual `.resource-share__extend` é neutro e discreto
            // no modal, ao lado do botão que não se desfaz.
            const renovar = this._button('Renovar', 'admin-btn admin-btn--sm',
                'admin-grant-extend', () => this._extend(grant));
            renovar.title = issuedExtensionHint();
            acoes.appendChild(renovar);
            acoes.appendChild(this._button('Revogar', 'admin-btn admin-btn--danger admin-btn--sm',
                'admin-grant-revoke', () => this._revoke(grant)));
            tr.appendChild(acoes);

            tbody.appendChild(tr);
        }
        wrap.appendChild(table);
    }

    /**
     * @private O que concederam a MIM. O prazo é o ponto deste lado (ver `receivedExpiryNotice`).
     * @param {HTMLElement} host @param {PromiseSettledResult<*>} resultado
     */
    _renderReceived(host, resultado) {
        host.replaceChildren();
        host.appendChild(sectionHeader('Recebidos por mim', {
            subtitle: 'O que outras pessoas abriram para você, e até quando',
        }));

        const wrap = card({ testid: 'admin-grants-received-table', padded: false });

        if (resultado.status === 'rejected') {
            host.appendChild(wrap);
            wrap.appendChild(failureState(receivedFailureNotice(), {
                onRetry: () => { if (this._alive) this._render(); },
            }));
            return;
        }

        const linhas = GrantsTab._rows(resultado.value);
        if (linhas.length === 0) {
            host.appendChild(wrap);
            wrap.appendChild(emptyState(receivedEmptyNotice(), { hint: receivedEmptyHint() }));
            return;
        }

        // A nota do prazo entra ANTES do cartão e só quando há linha para ela explicar: numa seção
        // vazia ela descreveria uma coluna que não existe na tela. Mesma regra da ressalva de
        // escopo em "Grupos de que participo".
        const nota = document.createElement('p');
        nota.className = 'admin-grants__expiry-notice';
        nota.dataset.testid = 'admin-grants-expiry-notice';
        nota.textContent = receivedExpiryNotice();
        host.appendChild(nota);
        host.appendChild(wrap);

        const { table, tbody } = buildTable(
            ['Recurso', 'De quem', 'Nível', 'Desde', 'Vencimento', ''],
        );
        for (const grant of linhas) {
            const tr = document.createElement('tr');
            tr.dataset.testid = 'admin-grants-received-row';
            tr.dataset.grantId = String(grant?.id ?? '');
            tr.dataset.viaGroup = grant?.viaGroup ? 'true' : 'false';

            tr.appendChild(this._resourceCell(grant));
            tr.appendChild(grantorCell(grant));
            tr.appendChild(levelCell(grant?.level));
            tr.appendChild(cell(shortDate(grant?.createdAt) || '—'));
            tr.appendChild(expiryCell(grant?.expiresAt, 'received'));

            // O lugar do botão que não existe deste lado. Espaço vazio se lê como tela quebrada, e
            // a pergunta de quem olha esta lista é justamente "posso me livrar disto?".
            const acoes = document.createElement('td');
            acoes.className = 'admin-users__actions';
            const recusa = document.createElement('span');
            recusa.className = 'admin-grants__not-revocable';
            recusa.dataset.testid = 'admin-grant-not-revocable';
            recusa.textContent = 'Só quem concedeu remove';
            recusa.title = receivedNotRevocableNotice();
            acoes.appendChild(recusa);
            tr.appendChild(acoes);

            tbody.appendChild(tr);
        }
        wrap.appendChild(table);
    }

    /**
     * @private A célula do recurso: nome, tipo, e o id no `title` (dois recursos podem ter o mesmo
     * nome de exibição, e só o id os separa).
     * @param {Object} grant
     * @returns {HTMLTableCellElement}
     */
    _resourceCell(grant) {
        const td = document.createElement('td');
        const box = document.createElement('div');
        box.className = 'admin-users__identity-text';
        const nome = document.createElement('span');
        nome.className = 'admin-users__name';
        nome.textContent = resourceDisplayName(grant);
        nome.title = resourceIdentityTitle(grant);
        const tipo = document.createElement('span');
        tipo.className = 'admin-users__handle';
        tipo.textContent = resourceTypeLabel(grant?.resourceType);
        box.append(nome, tipo);
        td.appendChild(box);
        return td;
    }

    /**
     * @private A célula do beneficiário. O COLETIVO ganha rótulo e o individual não, e é o
     * contraste que faz o rótulo informar.
     * @param {Object} grant
     * @returns {HTMLTableCellElement}
     */
    _granteeCell(grant) {
        const td = document.createElement('td');
        const box = document.createElement('div');
        box.className = 'admin-users__identity-text';
        const nome = document.createElement('span');
        nome.className = 'admin-users__name';
        nome.textContent = granteeLabel(grant);
        box.appendChild(nome);
        if (isGroupGrant(grant)) {
            const selo = document.createElement('span');
            selo.className = 'admin-chip admin-chip--group admin-grants__kind';
            selo.dataset.testid = 'admin-grant-grantee-group';
            selo.textContent = 'Grupo';
            selo.title = granteeGroupNotice(grant);
            box.appendChild(selo);
        }
        td.appendChild(box);
        return td;
    }

    /**
     * @private A button whose click listener belongs to the current view's scope.
     * @param {string} label @param {string} className @param {string} testid @param {Function} onClick
     * @returns {HTMLButtonElement}
     */
    _button(label, className, testid, onClick) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = className;
        btn.dataset.testid = testid;
        btn.textContent = label;
        addScopedDomListener(this, 'view', btn, 'click', onClick);
        return btn;
    }

    /**
     * @private O comando "Conceder acesso", decidido pela lista que o SERVIDOR mandou.
     *
     * TRÊS DESFECHOS, e os dois sem botão dizem coisas diferentes. Com recurso para compartilhar,
     * o botão nasce no cabeçalho da seção. Sem nenhum, o POSTO SOME (é bloqueio que a pessoa não
     * reverte desta tela) e uma frase curta ocupa o lugar dele, para a ausência não se ler como
     * tela quebrada. Com a leitura FALHADA não se afirma nem uma coisa nem outra: a frase diz que
     * não carregou e oferece tentar de novo, porque "você não pode compartilhar nada" dito depois
     * de um erro de rede seria falso com cara de estado.
     *
     * @param {PromiseSettledResult<*>} visiveis
     * @returns {{actions: HTMLElement[], nota: HTMLElement|null, podeConceder: boolean}}
     */
    _grantCommand(visiveis) {
        if (visiveis?.status !== 'fulfilled') {
            const nota = document.createElement('p');
            nota.className = 'admin-grants__share-note';
            nota.dataset.testid = 'admin-grants-shareable-failed';
            const texto = document.createElement('span');
            texto.textContent = shareableFailureNotice();
            nota.appendChild(texto);
            nota.appendChild(this._button('Tentar de novo', 'admin-btn admin-btn--ghost admin-btn--sm',
                'admin-grants-shareable-retry', () => { if (this._alive) this._render(); }));
            return { actions: [], nota, podeConceder: false };
        }
        const lista = shareableResources(visiveis.value);
        if (lista.length === 0) {
            const nota = document.createElement('p');
            nota.className = 'admin-grants__share-note';
            nota.dataset.testid = 'admin-grants-no-shareable';
            nota.textContent = shareableEmptyNotice();
            return { actions: [], nota, podeConceder: false };
        }
        const botao = this._button('Conceder acesso', 'admin-btn admin-btn--primary',
            'admin-grants-grant', () => this._togglePicker(lista));
        return { actions: [botao], nota: null, podeConceder: true };
    }

    /**
     * @private Abre (ou fecha) a escolha do recurso a conceder.
     *
     * A ESCOLHA ABRE O MODAL, sem um segundo botão: o combo só confirma uma linha da lista
     * controlada (texto digitado não vale nada até se escolher uma), então escolher é o gesto
     * inteiro, e um "Continuar" depois dele seria um clique que não decide nada. O modal é o do
     * mapa, pelo núcleo sem store, e quem escolhe pessoa ou grupo, nível e prazo é ele.
     * @param {Array<import('./shareable-resources.js').ShareableResource>} lista
     */
    _togglePicker(lista) {
        const vaga = this._pickerSlot;
        if (!vaga) return;
        if (this._picker) {
            this._destroyPicker();
            vaga.replaceChildren();
            vaga.hidden = true;
            return;
        }
        const porChave = new Map(lista.map((r) => [shareableKey(r), r]));
        const combo = createSearchableSelect({
            id: 'admin-grants-resource',
            label: grantPickerLabel(),
            testid: 'admin-grants-resource',
            // O TIPO VAI NA SIGLA: ele aparece ao lado do nome na lista e também casa a busca, de
            // modo que digitar "360" ou "modelo" filtra pelo tipo.
            items: lista.map((r) => ({
                value: shareableKey(r),
                label: r.name,
                sigla: resourceTypeLabel(r.resourceType),
            })),
            placeholder: 'Digite o nome do recurso…',
            emptyText: 'Nenhum recurso encontrado',
            fieldClass: 'admin-form__field admin-grants__picker-field',
        });

        const box = card({ testid: 'admin-grants-picker' });
        box.classList.add('admin-grants__picker');
        box.appendChild(combo.element);
        box.appendChild(this._button('Cancelar', 'admin-btn admin-btn--ghost',
            'admin-grants-picker-cancel', () => this._togglePicker(lista)));
        const dica = document.createElement('p');
        dica.className = 'admin-grants__picker-hint';
        dica.textContent = 'Depois de escolher, defina a pessoa ou o grupo, o nível e o prazo.';
        box.appendChild(dica);

        vaga.replaceChildren(box);
        vaga.hidden = false;
        combo.mount();
        this._picker = combo;
        addScopedDomListener(this, 'view', combo.input, 'ebgeo:select', (event) => {
            const recurso = porChave.get(event?.detail?.value);
            if (recurso) this._openShare(recurso);
        });
        combo.input.focus();
    }

    /** @private Tira o combo do documento (a lista dele é um portal em `document.body`). */
    _destroyPicker() {
        if (!this._picker) return;
        this._picker.destroy();
        this._picker = null;
    }

    /**
     * @private Abre o modal de compartilhar sobre o recurso escolhido.
     *
     * POR `import()`, e não estático: o modal só é baixado por quem clica, e a aba é aberta por
     * todas as audiências do painel. O núcleo não alcança a store (`compartilhar-sem-a-store`).
     *
     * O EFEITO INJETADO É RELER AS DUAS LISTAS, sem esperar: o modal avisa a cada escrita que deu
     * certo, e a tabela embaixo dele passa a mostrar a concessão nova (ou a revogada some) sem
     * fechar nada. `_render` é quem descarta a releitura superada.
     * @param {import('./shareable-resources.js').ShareableResource} recurso
     */
    async _openShare(recurso) {
        let abrir;
        try {
            ({ openResourceShareModal: abrir } = await import('@js/catalog/resource-share.modal.core.js'));
        } catch (error) {
            console.warn('[admin] share modal failed to load:', error);
            showError('Não foi possível abrir o compartilhamento. Recarregue a página.');
            return;
        }
        if (!this._alive) return;
        abrir({
            resourceType: recurso.resourceType,
            resourceId: recurso.resourceId,
            resourceName: recurso.name,
            onAccessChanged: () => { if (this._alive) this._render(); },
        });
    }

    /**
     * @private O seletor de prazo da seção "Concedidos por mim", UM para a seção inteira.
     *
     * A ESCADA VEM DE `catalog/grant-tree.js` (`GRANT_TERMS`), e não é escrita aqui. Ela era um
     * `const` privado do modal de recurso até 2026-08-24; duas cópias fariam "90 dias" valer
     * prazos diferentes em duas telas do mesmo produto, e a divergência só apareceria para quem
     * comparasse as duas, que é ninguém.
     *
     * Aquele arquivo tem ZERO imports por contrato, então importá-lo daqui não arrasta a store
     * para `admin.html`, que boota sem ela.
     * @returns {HTMLElement}
     */
    _termPicker() {
        const box = document.createElement('div');
        box.className = 'admin-grants__term';

        const id = 'admin-grants-term-select';
        const label = document.createElement('label');
        label.className = 'admin-grants__term-label';
        label.htmlFor = id;
        label.textContent = issuedExtensionTermLabel();
        box.appendChild(label);

        const select = document.createElement('select');
        select.id = id;
        select.className = 'admin-input admin-input--sm';
        select.dataset.testid = 'admin-grants-term';
        for (const p of GRANT_TERMS) {
            const opt = document.createElement('option');
            opt.value = String(p.dias);
            opt.textContent = p.label;
            if (p.dias === this._dias) opt.selected = true;
            select.appendChild(opt);
        }
        addScopedDomListener(this, 'view', select, 'change', () => {
            this._dias = Number(select.value) || GRANT_TERM_DEFAULT_DAYS;
        });
        box.appendChild(select);
        return box;
    }

    /**
     * @private Renova o prazo de uma concessão que esta pessoa fez.
     *
     * LÊ O EFETIVO, NUNCA O PEDIDO, e é a metade do conserto que se perde numa reescrita
     * desatenta. O servidor apara por DOIS tetos (o de quem concedeu, e um ano contado do
     * NASCIMENTO da linha), então pedir 180 dias e receber 20 é desfecho normal, não erro. Um
     * botão que pedisse 180, recebesse 20 e anunciasse 180 seria pior que não existir: ele
     * ensinaria a pessoa a confiar num prazo que já venceu. `extensionOutcome` compara pedido,
     * efetivo e anterior, e `extensionSummary` nomeia o efetivo nos três desfechos, inclusive
     * naquele em que o clique não mudou nada (200 com o prazo atual, quando a linha já está no
     * teto do pai).
     *
     * SEM CONFIRMAÇÃO PRÉVIA, ao contrário do irmão `_revoke`: renovar é aditivo e reversível
     * (revogar continua ali ao lado), e confirmar tudo treina a confirmar sem ler, que é o que
     * torna a confirmação do ato destrutivo inútil.
     * @param {Object} grant
     */
    async _extend(grant) {
        if (this._busy || !grant?.id) return;
        const pedido = extensionDeadline(this._dias);
        if (!pedido) {
            showError('Escolha um prazo antes de renovar.');
            return;
        }
        this._busy = true;
        try {
            const resposta = await apiClient.extendResourceGrant(grant.id, pedido);
            // `expiresAt` é o contrato acordado; `expires_at` é o nome da COLUNA, aceito aqui
            // porque uma rota que devolva a linha crua não é caso para descobrir por toast mudo.
            const efetivo = resposta?.expiresAt ?? resposta?.expires_at ?? null;
            const desfecho = extensionOutcome({
                pedido,
                efetivo,
                anterior: grant?.expiresAt ?? grant?.expires_at ?? null,
            });
            showSuccess(extensionSummary(desfecho, shortDate(efetivo)));
        } catch (error) {
            showError(serverMessageOr(error, 'Não foi possível renovar o prazo. Tente de novo.'));
        } finally {
            this._busy = false;
        }
        // RELIDA TAMBÉM NO ERRO, pela mesma razão de `_revoke`: a causa mais provável de falha
        // aqui é a linha ter morrido noutra sessão, e deixá-la na tela oferece o mesmo erro de novo.
        if (this._alive) this._render();
    }

    /**
     * @private Revoga uma concessão que esta pessoa fez.
     *
     * O AVISO É QUALITATIVO e o TOAST é numérico, que é a divisão da casa: a tela não conhece a
     * subárvore pendurada nesta linha (ela é de recursos diferentes e não carrega árvore nenhuma),
     * e quem a conhece é a poda do servidor. Ver `issuedRevocationWarning`.
     *
     * A LISTA É RELIDA TAMBÉM NO ERRO, e não só no sucesso: a causa mais provável de uma falha aqui
     * é a linha ter morrido noutra sessão (revogada, ou vencida entre o desenho e o clique), e
     * deixar a linha morta na tela com o botão de novo é oferecer o mesmo erro outra vez.
     * @param {Object} grant
     */
    async _revoke(grant) {
        const ok = await showConfirm(`Revogar o acesso a "${resourceDisplayName(grant)}"?`, {
            message: issuedRevocationWarning(grant),
            destructive: true,
            confirmText: 'Revogar',
            cancelText: 'Manter',
        });
        if (!ok) return;
        try {
            const resposta = await apiClient.revokeResourceGrant(grant?.id);
            showSuccess(issuedRevocationSummary(resposta));
        } catch (error) {
            showError(serverMessageOr(error, 'Não foi possível remover o acesso. Tente de novo.'));
        }
        if (this._alive) this._render();
    }
}

/**
 * Roda `fn` de modo que TODA falha vire uma promessa rejeitada, inclusive a síncrona.
 * @param {Function} fn
 * @returns {Promise<*>}
 */
async function settle(fn) {
    return fn();
}

// ===== small DOM builders =====

/**
 * A table with its header row already built.
 * @param {string[]} headers
 * @returns {{table: HTMLTableElement, tbody: HTMLTableSectionElement}}
 */
function buildTable(headers) {
    const table = document.createElement('table');
    table.className = 'admin-users__table';
    const thead = document.createElement('thead');
    const hrow = document.createElement('tr');
    for (const h of headers) {
        const th = document.createElement('th');
        th.textContent = h;
        if (h === 'Vencimento') th.title = 'Depois desta data o acesso deixa de valer sozinho.';
        hrow.appendChild(th);
    }
    thead.appendChild(hrow);
    table.appendChild(thead);
    const tbody = document.createElement('tbody');
    table.appendChild(tbody);
    return { table, tbody };
}

/** @param {string} text @returns {HTMLTableCellElement} */
function cell(text) {
    const td = document.createElement('td');
    td.textContent = text;
    return td;
}

/**
 * A célula do nível, como chip com a frase que o explica no `title`.
 * @param {*} level
 * @returns {HTMLTableCellElement}
 */
function levelCell(level) {
    const td = document.createElement('td');
    const chip = document.createElement('span');
    chip.className = 'admin-chip admin-chip--user';
    chip.dataset.testid = 'admin-grant-level';
    chip.textContent = grantLevelLabel(level) || '—';
    const frase = grantLevelDescription(level);
    if (frase) chip.title = frase;
    td.appendChild(chip);
    return td;
}

/**
 * A célula do prazo. O ESTADO vira classe, e não só texto: a linha vencida e a que vence em três
 * dias pedem tratamentos visuais diferentes, e é o que o dado ganha ao ser um valor.
 * @param {*} expiresAt
 * @param {'issued'|'received'} perspective
 * @returns {HTMLTableCellElement}
 */
function expiryCell(expiresAt, perspective) {
    const td = document.createElement('td');
    const chip = expiryChip(expiresAt, { perspective });
    const el = document.createElement('span');
    el.className = `admin-grants__expiry admin-grants__expiry--${chip.state}`;
    el.dataset.testid = 'admin-grant-expiry';
    el.dataset.expiryState = chip.state;
    el.textContent = chip.label;
    el.title = chip.title;
    td.appendChild(el);
    return td;
}

/**
 * A célula de quem concedeu, com o caminho de GRUPO quando é o caso.
 *
 * `viaGroup` é a única transferência de autoridade sem linha própria em `resource_grants`, e o
 * rótulo é o único lugar em que a pessoa descobre que perde o acesso ao sair do grupo.
 * @param {Object} grant
 * @returns {HTMLTableCellElement}
 */
function grantorCell(grant) {
    const td = document.createElement('td');
    const box = document.createElement('div');
    box.className = 'admin-users__identity-text';
    const nome = document.createElement('span');
    nome.className = 'admin-users__name';
    nome.textContent = grantorLabel(grant);
    box.appendChild(nome);
    const viaGroupLabelText = grant?.viaGroup ? viaGroupText(grant.viaGroup) : null;
    if (viaGroupLabelText) {
        const via = document.createElement('span');
        via.className = 'admin-grants__via-group';
        via.dataset.testid = 'admin-grant-via-group';
        via.textContent = viaGroupLabelText.label;
        via.title = viaGroupLabelText.title;
        box.appendChild(via);
    }
    td.appendChild(box);
    return td;
}

/**
 * O par (rótulo, explicação) do caminho de grupo. Separado para manter `grantorCell` legível; a
 * decisão de vocabulário mora em `grant-phrases.js`.
 * @param {{id?: string, name?: string}} viaGroup
 * @returns {{label: string, title: string}|null}
 */
function viaGroupText(viaGroup) {
    const label = viaGroupLabel(viaGroup);
    return label ? { label, title: viaGroupNotice(viaGroup) } : null;
}
