// Path: js/modals/atlas-switch.modal.js

/**
 * @fileoverview A PORTA DA TROCA AO VIVO DE ATLAS: o gesto que faltava para `switchAtlas`.
 *
 * O QUE ELA COMPRA, e o numero e medido, nao deduzido. `account/open-atlas.service.js` ganhou
 * `switchAtlas`, que troca de atlas SEM recarregar a pagina. Ate aqui nenhum gesto a acionava:
 * escolher outro atlas saia da pagina do mapa para `atlas.html` e voltava por `./?atlas=<uuid>`,
 * o que sao DUAS navegacoes e DOIS boots. A bancada
 * `tests/e2e-ui/troca-viva-de-atlas-medida.spec.js` compara as duas formas na mesma rodada e com
 * o mesmo criterio de chegada. Este arquivo e o que transforma a economia medida em economia
 * entregue, porque ele poe a troca ao vivo debaixo do clique que a pessoa ja dava.
 *
 * ============================ POR QUE ELA MORA EM `modals/` ===================================
 *
 * O lugar obvio seria `src/js/projects/`, junto do resto da escolha de atlas, e ele esta
 * proibido por um guarda: `tests/unit/paginas-sem-mapa-nao-arrastam-a-store.test.js` varre TODO
 * arquivo daquela pasta como raiz, inclusive os que `atlas.html` nunca importa, e a lista de
 * dependencias externas permitidas ali e FECHADA. Um arquivo novo em `projects/` que importasse
 * `open-atlas.service.js` deixaria o guarda vermelho, e o guarda esta certo: aquela pasta e o
 * corpo de uma pagina que boota sem a store. IMPORTAR de `projects/` continua livre, e e o que
 * este arquivo faz.
 *
 * ============================ POR QUE O IMPORT DELA E DINAMICO ================================
 *
 * `tests/e2e-ui/desempenho-do-boot-do-mapa.spec.js` mede o payload ansioso do boot do mapa contra
 * um teto (476 modulos contra 500, 38 456 561 bytes contra 40 400 000). Sao 24 modulos de folga.
 * Esta porta alcanca a store, o motor de sincronismo, o cliente HTTP e `atlas-drive.js`, o que
 * comeria a folga inteira se `account.control.js` a importasse estaticamente. Por isso o import
 * dela e `await import()`, dentro do manipulador do clique: os imports ESTATICOS abaixo so sao
 * resolvidos quando alguem abre a porta, e nao no boot. Nao troque nenhum dos dois por um import
 * estatico sem remedir o boot.
 *
 * ============================ OS TESTIDS SAO PROPRIOS, E ISSO E LOAD-BEARING ==================
 *
 * NUNCA `project-picker-modal` nem `project-picker-item`. Esses pertencem ao Drive de
 * `atlas.html`, e `tests/e2e-ui/helpers/collab-helpers.js` usa `project-picker-modal` como PROVA
 * de que o login chegou naquela pagina. Reciclar o nome faria a prova casar com esta porta, que
 * vive na pagina do mapa, e o harness passaria a afirmar uma navegacao que nao aconteceu. Os
 * nomes daqui sao `atlas-switch-*`.
 *
 * ============================ O QUE ELA NAO E ================================================
 *
 * NAO E UM SEGUNDO DRIVE. A classe `AtlasDrive` tem 1337 linhas, arrasta 1044 linhas de CSS que
 * o mapa nao importa e crava os testids proibidos acima. O que esta porta reusa e a peca limpa:
 * `LocalAtlasSection`, que nao toca rede nem store e recebe todo comportamento por callback.
 *
 * NAO E ONDE SE ADMINISTRA ATLAS. Renomear, duplicar, excluir e criar continuam em `atlas.html`,
 * e os itens do menu do cartao local LEVAM para la. A porta responde uma pergunta so, que e "em
 * qual atlas eu quero estar agora", e a resposta dela e a troca ao vivo.
 *
 * NAO PEDE `GET /atlas/overview`. O rodape de participantes e as capas do Drive sairiam de uma
 * segunda requisicao, e o cartao desta porta nao os desenha. Ela usa `apiClient.listAtlas()`, que
 * a propria pagina do mapa ja chama em quatro lugares.
 *
 * ============================ OS CINCO DESFECHOS =============================================
 *
 * A parte dificil desta porta nao e desenhar a lista, e sim o que ela FAZ com o que `switchAtlas`
 * devolve. A decisao inteira mora em {@link atlasSwitchOutcome}, que e pura e testada em node
 * (`tests/unit/porta-de-troca-de-atlas.test.js`); o cabecalho dela e onde os cinco estao escritos
 * um a um, com a razao de cada um.
 */

import { ModalBase } from './modal.base.js';
// De `projects/`, e por arquivo. `LocalAtlasSection` e a peca livre de store daquele arquivo:
// ela nao toca rede nem store, e recebe todo comportamento por callback.
//
// `createServerInvite` DO MESMO ARQUIVO FOI RECUSADA, e o motivo esta medido, nao suposto: o
// botao dela usa `.atlas-drive__btn--primary`, cuja folha (`atlas-drive.css`) a pagina do mapa
// nao importa e esta porta nao vai importar, entao ele chegaria aqui sem estilo nenhum. Ela
// tambem traz o testid `server-invite` e o `projects-login`, que sao de `atlas.html`, e um
// segundo `<h2>` "No servidor" ao lado do titulo que esta secao ja escreve. O convite daqui e
// tres linhas, e nao paga nenhuma dessas tres contas.
import { LocalAtlasSection } from '@js/projects/atlas-drive.js';
import { switchAtlas } from '@js/account/open-atlas.service.js';
// A PERGUNTA "esta aba perdeu a arbitragem", e ela e o desempate dos desfechos b, c e d.
// Ver `atlasSwitchOutcome`.
import { isTabLockBlocked } from '@utils/tab-lock.js';
import { apiClient } from '@store/sync/api-client.js';
import { syncEngine } from '@store/sync/sync-engine.js';
import {
    getCurrentLocalAtlasId,
    listLocalAtlases,
    MAX_LOCAL_ATLASES,
} from '@store/local-atlas.api.js';
// A UNICA implementacao da escada de cinco degraus do servidor. Nunca uma tabela local.
import { getPermissionLabel } from '@js/projects/permission-levels.js';
import { showError } from '@utils/toast_service.js';
import {
    addDomListener,
    addScopedDomListener,
    clearScopedListeners,
} from '@utils/event-cleanup.js';

/** Icones estaticos, sem dado nenhum interpolado. */
const ICONS = {
    folder: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`,
};

/**
 * O que a porta faz consigo mesma depois de uma troca.
 *
 * Dois valores, porque so existem duas respostas: sair da frente, ou continuar na tela para a
 * pessoa escolher outra coisa.
 */
export const AtlasSwitchDoor = Object.freeze({
    /** Fecha a porta. O desfecho ja esta dito em outro lugar, ou a tela ja mudou. */
    CLOSE: 'close',
    /** Fica aberta. A pessoa recusou a troca de proposito e continua escolhendo. */
    STAY: 'stay',
});

/**
 * O QUE A PORTA FAZ COM O QUE `switchAtlas` DEVOLVEU, e o que ela DIZ. Pura.
 *
 * A regra que atravessa os cinco desfechos e uma so: **a porta nunca repete uma noticia que
 * outra camada ja deu**. Um toast atras de uma sobreposicao, ou depois de um dialogo, e a mesma
 * frase dita duas vezes, e duas frases sobre um evento so ensinam a pessoa a nao ler nenhuma.
 *
 * ---------------------------------------------------------------------------------------------
 * a) JA E O ATLAS MONTADO (`ok: true, changed: false`). Fecha, calada. Um toast de sucesso aqui
 *    afirmaria um trabalho que nao houve. E a guarda de no-op de `switchAtlas` nao e otimizacao:
 *    re-reivindicar carimba um `claimedAt` novo e manda esta aba para o fim da fila do tab-lock,
 *    entregando o proprio atlas a quem esperava atras dela.
 *
 * b) A ABA IRMA GANHOU A ARBITRAGEM. A sobreposicao do tab-lock JA esta na tela, e o "Usar aqui"
 *    dela e o caminho adiante. A porta so sai da frente, sem dizer nada.
 *
 * c) A ABA IRMA NUNCA RESPONDEU (a testemunha recusou). `open-atlas.service.js` ja disse a frase
 *    de `OCCUPIED_MESSAGE`, que nomeia a situacao e diz que nada foi apagado. A porta nao a
 *    repete.
 *
 * d) O TRABALHO RESGATADO SERIA DESCARTADO e a pessoa CANCELOU. O dialogo de dois botoes ja
 *    aconteceu e a pessoa escolheu nao abrir. Este e o UNICO desfecho em que a porta fica aberta:
 *    nada mudou na tela, e fecha-la obrigaria a reabrir para escolher outro atlas.
 *
 * e) FALHA DE REDE OU PERMISSAO. `switchAtlas` LANCA por contrato, entao este desfecho nao chega
 *    aqui: ele e do `catch` do chamador, com {@link atlasSwitchFailureNotice}.
 * ---------------------------------------------------------------------------------------------
 *
 * O DESEMPATE E UM FATO, NAO UM PALPITE, e foi ele que fechou o unico buraco deste desenho. Os
 * desfechos b, c e d chegam aqui INDISTINGUIVEIS no ramo remoto: `switchAtlas` achata os tres em
 * `{ ok: false, changed: false, reason: 'refused' }` (ver o `return` do ramo `remote`), porque
 * `openRemoteAtlas` devolve um booleano so. Entao a porta pergunta ao tab-lock se ESTA ABA esta
 * bloqueada, que e a diferenca observavel entre b (perdeu a ordem, sobreposicao na tela) e os
 * outros dois (nada mudou). Sem essa leitura, ou a porta ficaria por cima da sobreposicao, ou
 * fecharia por cima de um cancelamento deliberado.
 *
 * O ramo LOCAL nomeia a recusa (`'peer'`, `'witness'`, `'not-found'`), entao ali o desempate nem
 * e preciso. Ele e aceito mesmo assim, porque um nome que chega e melhor que um nome deduzido.
 *
 * @param {{ok?: boolean, changed?: boolean, reason?: string}} result - O que `switchAtlas` devolveu.
 * @param {{blocked?: boolean, atlasName?: string}} [contexto] - `blocked` e `isTabLockBlocked()`.
 * @returns {{door: string, notice: {tone: string, message: string}|null}}
 */
export function atlasSwitchOutcome(result, { blocked = false, atlasName = '' } = {}) {
    const fechar = { door: AtlasSwitchDoor.CLOSE, notice: null };

    // (a) e a troca que deu certo. As duas fecham caladas, e pela mesma razao: quem conta o
    // desfecho e a tela, que passou a desenhar outro atlas, ou o proprio no-op, que nao mudou nada.
    if (result?.ok === true) return fechar;

    const reason = typeof result?.reason === 'string' ? result.reason : '';

    // O slot local sumiu do registro entre o desenho da lista e o clique. E o unico desfecho em
    // que ninguem mais falou, entao a frase e daqui.
    if (reason === 'not-found') {
        return {
            door: AtlasSwitchDoor.CLOSE,
            notice: { tone: 'error', message: localAtlasGoneNotice(atlasName) },
        };
    }

    // (b) pelo nome, no ramo local: a aba perdeu a ordem e a sobreposicao esta na tela.
    if (reason === 'peer') return fechar;
    // (c) pelo nome, no ramo local: a testemunha recusou e o servico ja disse a frase.
    if (reason === 'witness') return fechar;

    // (b), (c) ou (d) achatados pelo ramo remoto. O tab-lock desempata.
    if (reason === 'refused') {
        return blocked ? fechar : { door: AtlasSwitchDoor.STAY, notice: null };
    }

    // Uma recusa que este build nao sabe nomear fecha calada. Falar sem saber o que houve seria
    // inventar a noticia, e a alternativa (ficar aberta em silencio) e uma porta que nao responde
    // ao clique.
    return fechar;
}

/**
 * A FRASE DA FALHA DE REDE OU DE PERMISSAO, que e o desfecho (e) e nao existia em lugar nenhum.
 *
 * ELA DESCREVE UM ESTADO, E NAO UM ERRO. `openRemoteAtlas` ja desmontou o atlas anterior quando
 * o `connect` falha: ele reverte a origem para LOCAL e retrata a reivindicacao, de proposito, para
 * que um F5 nao insista num atlas morto. O resultado e uma aba SEM atlas de servidor, no atlas
 * local deste navegador, com o mapa anterior desmontado. Um toast que dissesse so "falha ao abrir"
 * deixaria a pessoa olhando essa tela sem entender por que ela mudou.
 *
 * O QUE ELA AFIRMA SOBRE DADO, e por que pode afirmar. Nada foi apagado no servidor, porque o
 * atlas anterior continua la. Nada foi apagado neste computador, porque desde 2026-08-16 cada
 * atlas tem seu proprio namespace e o wipe da abertura cai no do atlas de DESTINO, nunca no slot
 * local. Ver a abertura de `open-atlas.service.js`.
 *
 * Pura.
 * @param {string} atlasName - Nome do atlas que se tentou abrir. Vazio e aceito.
 * @returns {string}
 */
export function atlasSwitchFailureNotice(atlasName = '') {
    const nome = String(atlasName ?? '').trim();
    const alvo = nome ? `"${nome}"` : 'o atlas';
    return `Nao foi possivel abrir ${alvo}. Esta aba ficou sem atlas de servidor. `
        + 'O mapa anterior saiu da tela e a aba voltou para o atlas local deste navegador. '
        + 'Nada foi apagado, nem no servidor nem neste computador. '
        + 'Abra "Seus atlas" e escolha de novo.';
}

/**
 * A frase do slot local que sumiu do registro. Pura.
 * @param {string} atlasName
 * @returns {string}
 */
export function localAtlasGoneNotice(atlasName = '') {
    const nome = String(atlasName ?? '').trim();
    const alvo = nome ? `"${nome}"` : 'Este atlas local';
    return `${alvo} nao esta mais guardado neste navegador. `
        + 'A lista que voce viu estava velha. Abra "Seus atlas" de novo.';
}

/**
 * O relogio relativo do cartao de servidor ("ha 3 dias"). Pura.
 *
 * UMA COPIA PEQUENA E DELIBERADA. `atlas-drive.js` tem `formatRelativeTime`, que faz o mesmo, e
 * ela NAO E EXPORTADA. Promove-la exigiria editar `src/js/projects/`, que esta fora do alcance
 * desta mudanca, e um `import` que nao existe nao se inventa. A copia e menor que a original de
 * proposito, porque o cartao desta porta so precisa da data e nunca do segundo.
 *
 * @param {string|number|Date|null|undefined} value - Data em qualquer forma que `Date` aceite.
 * @returns {string} Vazia quando a data nao se le.
 */
export function atlasSwitchWhenLabel(value) {
    if (value === null || value === undefined || value === '') return '';
    const then = new Date(value).getTime();
    if (!Number.isFinite(then)) return '';
    const fmt = new Intl.RelativeTimeFormat('pt-BR', { numeric: 'auto' });
    const diffSec = Math.round((then - Date.now()) / 1000);
    const abs = Math.abs(diffSec);
    if (abs < 60) return fmt.format(diffSec, 'second');
    if (abs < 3600) return fmt.format(Math.round(diffSec / 60), 'minute');
    if (abs < 86400) return fmt.format(Math.round(diffSec / 3600), 'hour');
    if (abs < 86400 * 30) return fmt.format(Math.round(diffSec / 86400), 'day');
    return new Date(then).toLocaleDateString('pt-BR', {
        day: '2-digit', month: '2-digit', year: 'numeric',
    });
}

/**
 * Tira acento e caixa de um termo, para a busca casar "Sao" com "São". Pura.
 * @param {*} value
 * @returns {string}
 */
function fold(value) {
    return String(value ?? '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim();
}

/**
 * A LISTA QUE A GRADE DE SERVIDOR DESENHA: filtrada pelo termo, mais recente primeiro. Pura.
 *
 * A ORDEM E A DA ABA "Recentes" DO DRIVE, e nao a que o servidor mandou. Quem abre esta porta
 * quase sempre quer voltar ao atlas em que estava ontem, e uma ordem estavel por `updated_at`
 * poe esse atlas no alto sem que ninguem precise procurar.
 *
 * A BUSCA IGNORA ACENTO, porque quem digita rapido nao acentua, e uma lista que nao acha
 * "sao paulo" ensina a pessoa a nao usar a busca.
 *
 * @param {Array<Object>} atlases - Registros de `apiClient.listAtlas()`.
 * @param {{query?: string}} [options]
 * @returns {Array<Object>} Array novo a cada chamada.
 */
export function atlasSwitchList(atlases, { query = '' } = {}) {
    const lista = Array.isArray(atlases) ? atlases.filter(Boolean) : [];
    const termo = fold(query);
    const filtrada = termo ? lista.filter((a) => fold(a?.name).includes(termo)) : lista;
    return [...filtrada].sort(
        (a, b) => new Date(b?.updated_at ?? 0) - new Date(a?.updated_at ?? 0)
    );
}

/** Os tres estados da metade de servidor. A do meio e a que faltaria numa versao ingenua. */
const ServerState = Object.freeze({
    LOADING: 'loading',
    READY: 'ready',
    FAILED: 'failed',
});

/**
 * A porta de troca de atlas.
 * @extends ModalBase
 */
export class AtlasSwitchModal extends ModalBase {
    /**
     * @param {Object} [options]
     * @param {boolean} [options.signedIn] - Se ha sessao. Sem ela a metade de servidor vira o
     *   convite a entrar, e a metade local continua inteira: um atlas local nao precisa de conta.
     * @param {Function} [options.onRequestLogin] - Abre o login. Sem ele o convite nao e desenhado,
     *   pela mesma regra de afordancia da casa: comando sem nada atras e botao morto.
     * @param {Function} [options.onManage] - Leva para `atlas.html`, que e onde se renomeia,
     *   duplica, cria e exclui atlas local.
     */
    constructor({ signedIn = false, onRequestLogin = null, onManage = null } = {}) {
        super({
            id: 'atlas-switch-modal',
            title: 'Seus atlas',
            icon: ICONS.folder,
            destroyOnHide: true,
        });
        this._signedIn = signedIn === true;
        this._onRequestLogin = typeof onRequestLogin === 'function' ? onRequestLogin : null;
        this._onManage = typeof onManage === 'function' ? onManage : null;

        this._atlases = [];
        this._serverState = ServerState.LOADING;
        this._query = '';
        /** Uma troca de cada vez: dois cliques em dois cartoes seriam dois pipelines de abertura. */
        this._busy = false;

        this._gridEl = null;
        this._statusEl = null;
        this._localHostEl = null;
        this._local = null;
        // SEM UM SEGUNDO `setupCleanup(this)` AQUI, de proposito: ele ZERA as listas de limpeza, e
        // o construtor de `ModalBase` ja o chamou uma linha acima. Repeti-lo e inofensivo hoje
        // (nenhum ouvinte foi registrado ainda) e seria a forma exata de perder os ouvintes da
        // base no dia em que ela registrar algum no proprio construtor.
    }

    /** @override Acrescenta o testid e a classe de largura ao esqueleto de `ModalBase`. */
    render() {
        const overlay = super.render();
        overlay.dataset.testid = 'atlas-switch-modal';
        this.getContainer()?.classList.add('atlas-switch-container');
        this._buildBody();
        document.body.appendChild(overlay);
        return overlay;
    }

    /** @private O corpo: a metade de servidor em cima, a metade local embaixo. */
    _buildBody() {
        const body = this.getBody();
        if (!body) return;

        const raiz = document.createElement('div');
        raiz.className = 'atlas-switch';

        // A LINHA DE ESTADO FICA NO TOPO E ANTES DA LISTA, porque ela existe para a espera: a
        // troca ao vivo leva perto de dois segundos, e uma porta que nao dissesse nada nesse
        // intervalo pareceria ter engolido o clique.
        this._statusEl = document.createElement('p');
        this._statusEl.className = 'atlas-switch__status';
        this._statusEl.dataset.testid = 'atlas-switch-status';
        this._statusEl.setAttribute('role', 'status');
        this._statusEl.hidden = true;
        raiz.appendChild(this._statusEl);

        raiz.appendChild(this._buildServerSection());

        this._localHostEl = document.createElement('div');
        this._localHostEl.className = 'atlas-switch__local';
        raiz.appendChild(this._localHostEl);

        body.appendChild(raiz);

        this._mountLocal();
        if (this._signedIn) this._loadServer();
    }

    /** @private A metade de servidor, cabecalho mais grade. */
    _buildServerSection() {
        const secao = document.createElement('section');
        secao.className = 'atlas-switch__server';

        const header = document.createElement('header');
        header.className = 'atlas-switch__header';

        const titulo = document.createElement('h3');
        titulo.className = 'atlas-switch__title';
        titulo.textContent = 'No servidor';
        header.appendChild(titulo);

        if (this._signedIn) {
            const busca = document.createElement('input');
            busca.type = 'search';
            busca.className = 'atlas-switch__search';
            busca.placeholder = 'Filtrar pelo nome';
            busca.setAttribute('aria-label', 'Filtrar atlas do servidor pelo nome');
            addDomListener(this, busca, 'input', () => {
                this._query = busca.value;
                this._paintServer();
            });
            header.appendChild(busca);
        }

        secao.appendChild(header);

        const grade = document.createElement('div');
        grade.className = 'atlas-switch__grid';
        grade.setAttribute('role', 'list');
        grade.setAttribute('aria-label', 'Atlas no servidor');
        secao.appendChild(grade);
        this._gridEl = grade;

        this._paintServer();
        return secao;
    }

    /**
     * @private Le a lista do servidor.
     *
     * `listAtlas()` E NAO `getAtlasOverview()`. A primeira e a que a propria pagina do mapa ja
     * chama em quatro lugares, e traz o que o cartao daqui desenha: id, nome, `user_permission`
     * e `updated_at`. A segunda traria capas, participantes e presenca, que esta porta nao
     * desenha, ao preco de uma segunda requisicao.
     */
    async _loadServer() {
        this._serverState = ServerState.LOADING;
        this._paintServer();
        try {
            const lista = await apiClient.listAtlas();
            this._atlases = Array.isArray(lista) ? lista : [];
            this._serverState = ServerState.READY;
        } catch (error) {
            console.warn('[atlas-switch] listAtlas falhou:', error);
            // O TERCEIRO ESTADO, e nao a lista vazia. Uma consulta que falhou desenhada como
            // grade vazia afirma, sem ressalva, que a pessoa nao tem atlas nenhum no servidor.
            this._serverState = ServerState.FAILED;
        }
        this._paintServer();
    }

    /** @private Redesenha a grade de servidor a partir do estado atual. */
    _paintServer() {
        if (!this._gridEl) return;
        clearScopedListeners(this, 'server-cards');
        this._gridEl.replaceChildren();

        // SEM SESSAO A METADE DE SERVIDOR VIRA UM CONVITE, e nao uma grade vazia nem uma grade
        // desabilitada. A porta e alcancavel deslogado: "Seus atlas" aparece na aba Mapas no
        // estado `local-anon` (ver `sidebar/tabs/atlas-actions.js`), e a metade LOCAL continua
        // inteira, porque um atlas deste navegador nunca precisou de conta.
        if (!this._signedIn) {
            const convite = this._tile(
                'atlas-switch-invite',
                'Entre para abrir os atlas do servidor e colaborar com sua equipe. '
                + 'Os atlas deste computador continuam funcionando sem conta.'
            );
            // SEM O CALLBACK, SEM O BOTAO. Um "Entrar" com nada atras e um botao morto, e o
            // clique e o que descobriria isso.
            if (this._onRequestLogin) {
                const entrar = document.createElement('button');
                entrar.type = 'button';
                entrar.className = 'atlas-switch__retry';
                entrar.textContent = 'Entrar';
                addScopedDomListener(this, 'server-cards', entrar, 'click', () => {
                    this.hide();
                    this._onRequestLogin();
                });
                convite.appendChild(entrar);
            }
            this._gridEl.appendChild(convite);
            return;
        }
        if (this._serverState === ServerState.LOADING) {
            this._gridEl.appendChild(this._tile('atlas-switch-loading', 'Lendo seus atlas...'));
            return;
        }
        if (this._serverState === ServerState.FAILED) {
            const falha = this._tile(
                'atlas-switch-load-error',
                'Nao foi possivel ler seus atlas do servidor. Eles continuam la; o que falhou foi '
                + 'esta leitura.'
            );
            falha.setAttribute('role', 'alert');
            const retry = document.createElement('button');
            retry.type = 'button';
            retry.className = 'atlas-switch__retry';
            retry.textContent = 'Tentar de novo';
            addScopedDomListener(this, 'server-cards', retry, 'click', () => this._loadServer());
            falha.appendChild(retry);
            this._gridEl.appendChild(falha);
            return;
        }

        const visiveis = atlasSwitchList(this._atlases, { query: this._query });
        if (visiveis.length === 0) {
            const vazio = this._query.trim()
                ? 'Nenhum atlas do servidor casa com esse termo.'
                : 'Voce ainda nao participa de nenhum atlas no servidor.';
            this._gridEl.appendChild(this._tile('atlas-switch-empty', vazio));
            return;
        }
        for (const atlas of visiveis) this._gridEl.appendChild(this._card(atlas));
    }

    /** @private Um aviso ocupando a grade inteira. */
    _tile(testid, texto) {
        const tile = document.createElement('div');
        tile.className = 'atlas-switch__tile';
        tile.dataset.testid = testid;
        const p = document.createElement('p');
        p.className = 'atlas-switch__tile-text';
        p.textContent = texto;
        tile.appendChild(p);
        return tile;
    }

    /** @private Um atlas de servidor. */
    _card(atlas) {
        const id = String(atlas?.id ?? '');
        const nome = String(atlas?.name ?? '');
        const atual = id !== '' && id === syncEngine.atlasId;

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `atlas-switch__card${atual ? ' atlas-switch__card--current' : ''}`;
        btn.dataset.testid = 'atlas-switch-item';
        btn.dataset.atlasId = id;
        btn.dataset.atlasKind = 'remote';
        btn.setAttribute('role', 'listitem');
        if (atual) btn.setAttribute('aria-current', 'true');

        const linhaNome = document.createElement('span');
        linhaNome.className = 'atlas-switch__name';
        linhaNome.textContent = nome;
        btn.appendChild(linhaNome);

        const meta = document.createElement('span');
        meta.className = 'atlas-switch__meta';
        const quando = atlasSwitchWhenLabel(atlas?.updated_at);
        meta.textContent = quando ? `alterado ${quando}` : '';
        btn.appendChild(meta);

        const tags = document.createElement('span');
        tags.className = 'atlas-switch__tags';
        const origem = document.createElement('span');
        origem.className = 'atlas-switch__chip';
        origem.textContent = 'Servidor';
        tags.appendChild(origem);
        // O NIVEL VEM DA ESCADA DO SERVIDOR, nunca de uma lista fechada escrita aqui:
        // `user_permission` tem cinco valores, e `perm === 'write' || perm === 'owner'` ja
        // excluiu `manage` em silencio duas vezes neste repositorio.
        const nivel = getPermissionLabel(atlas?.user_permission);
        if (nivel) {
            const selo = document.createElement('span');
            selo.className = 'atlas-switch__chip atlas-switch__chip--level';
            selo.textContent = nivel;
            tags.appendChild(selo);
        }
        if (atual) {
            const agora = document.createElement('span');
            agora.className = 'atlas-switch__chip atlas-switch__chip--current';
            agora.textContent = 'Atual';
            tags.appendChild(agora);
        }
        btn.appendChild(tags);

        addScopedDomListener(this, 'server-cards', btn, 'click', () => {
            this._switchTo({ kind: 'remote', atlasId: id }, nome);
        });
        return btn;
    }

    /**
     * @private Monta a secao "Neste computador", reusando a peca de `atlas-drive.js`.
     *
     * OS CALLBACKS DE ADMINISTRACAO LEVAM PARA `atlas.html`, E ISSO E DELIBERADO. `LocalAtlasSection`
     * desenha "Renomear", "Duplicar" e "Excluir" sempre, e esta porta nao pode desliga-los sem
     * editar `projects/`. Fazer a porta chamar a API de atlas local criaria um SEGUNDO dono do
     * registro local, ao lado de `projects-page.js`. Entao os tres levam para a pagina que ja e
     * dona deles. Nenhum deles e botao morto: cada um chega onde a acao acontece.
     *
     * "Enviar ao servidor" e "Abrir arquivo .ebgeo" ficam de FORA, porque omitir o callback e o
     * que apaga o item (ver o construtor de `LocalAtlasSection`). Enviar o atlas local ja tem
     * gesto proprio no menu da conta, e abrir um `.ebgeo` e trabalho da pagina de atlas.
     */
    _mountLocal() {
        if (!this._localHostEl) return;
        const gerir = () => { this.hide(); this._onManage?.(); };
        this._local = new LocalAtlasSection({
            atlases: this._readLocal(),
            currentId: this._safeCurrentLocalId(),
            max: MAX_LOCAL_ATLASES,
            onOpen: (atlas) => this._switchTo(
                { kind: 'local', atlasId: String(atlas?.id ?? '') },
                String(atlas?.name ?? '')
            ),
            onCreate: gerir,
            onRename: gerir,
            onDuplicate: gerir,
            onDelete: gerir,
            onRetry: () => this._reloadLocal(),
        });
        this._local.mount(this._localHostEl);
    }

    /**
     * @private O registro local, ou `null` quando ele nao pode ser lido.
     *
     * `listLocalAtlases()` LANCA antes de `initLocalAtlases()`, e o `null` e o terceiro estado
     * que `LocalAtlasSection` ja sabe desenhar. Devolver `[]` aqui afirmaria que a pessoa nao tem
     * atlas local nenhum, que e a mentira que aquele terceiro estado existe para impedir.
     */
    _readLocal() {
        try {
            return listLocalAtlases();
        } catch (error) {
            console.warn('[atlas-switch] registro local ilegivel:', error);
            return null;
        }
    }

    /** @private O id corrente, que e o unico leitor local que nao lanca antes do boot da store. */
    _safeCurrentLocalId() {
        try {
            return getCurrentLocalAtlasId();
        } catch {
            return null;
        }
    }

    /**
     * @private Reescreve a lista local na secao.
     *
     * Ela tem um segundo efeito de que a porta depende: `setAtlases` zera o `_busy` interno da
     * secao. `LocalAtlasSection._open` o levanta e nunca o baixa sozinho, porque na pagina de
     * atlas abrir NAVEGA. Aqui a pagina fica, entao quem baixa e esta chamada.
     */
    _reloadLocal() {
        this._local?.setAtlases(this._readLocal(), this._safeCurrentLocalId());
    }

    /**
     * @private O CLIQUE NUM CARTAO: a troca ao vivo, e o que a porta faz com o desfecho.
     *
     * O `try/catch` NAO E DEFENSIVO, ele e o desfecho (e). `switchAtlas` LANCA um erro de conexao
     * ou de permissao por contrato, e sem este `catch` a pessoa ficaria olhando um dialogo que
     * nao fez nada, sobre um mapa que sumiu.
     *
     * @param {{kind: string, atlasId: string}} destination
     * @param {string} atlasName - So para a frase de falha.
     */
    async _switchTo(destination, atlasName) {
        if (this._busy) return;
        if (!destination.atlasId) return;
        this._busy = true;
        this._paintBusy(atlasName);

        let outcome;
        try {
            const result = await switchAtlas(destination);
            outcome = atlasSwitchOutcome(result, { blocked: isTabLockBlocked(), atlasName });
        } catch (error) {
            console.error('[atlas-switch] a troca de atlas falhou:', error);
            outcome = {
                door: AtlasSwitchDoor.CLOSE,
                notice: { tone: 'error', message: atlasSwitchFailureNotice(atlasName) },
            };
        }

        this._busy = false;
        this._paintIdle();
        if (outcome.notice) showError(outcome.notice.message);
        if (outcome.door === AtlasSwitchDoor.CLOSE) {
            this.hide();
            return;
        }
        // A porta continua na tela, entao a secao local precisa voltar a aceitar cliques e a
        // grade de servidor precisa refletir onde a aba esta agora.
        this._reloadLocal();
        this._paintServer();
    }

    /** @private Trava a porta enquanto a troca corre, e diz o que ela esta fazendo. */
    _paintBusy(atlasName) {
        const nome = String(atlasName ?? '').trim();
        if (this._statusEl) {
            this._statusEl.hidden = false;
            this._statusEl.textContent = nome ? `Abrindo "${nome}"...` : 'Abrindo o atlas...';
        }
        this.getContainer()?.setAttribute('data-busy', 'true');
    }

    /** @private */
    _paintIdle() {
        if (this._statusEl) {
            this._statusEl.hidden = true;
            this._statusEl.textContent = '';
        }
        this.getContainer()?.removeAttribute('data-busy');
    }

    /** @override Desmonta a secao local antes de o esqueleto se destruir. */
    hide() {
        if (!this.isOpen()) return;
        clearScopedListeners(this, 'server-cards');
        this._local?.destroy();
        this._local = null;
        super.hide();
    }

    /** @override A secao local tem ciclo de vida proprio e nao esta nas listas de `ModalBase`. */
    destroy() {
        this._local?.destroy();
        this._local = null;
        clearScopedListeners(this, 'server-cards');
        super.destroy();
    }
}

/**
 * Abre a porta de troca de atlas.
 * @param {Object} [options] - Ver o construtor de {@link AtlasSwitchModal}.
 * @returns {AtlasSwitchModal}
 */
export function showAtlasSwitchModal(options = {}) {
    const modal = new AtlasSwitchModal(options);
    modal.render();
    modal.show();
    return modal;
}
