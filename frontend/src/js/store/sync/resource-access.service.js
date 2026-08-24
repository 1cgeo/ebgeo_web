// Path: js/store/sync/resource-access.service.js

/**
 * @fileoverview A soma dos recursos PRIVADOS concedidos, no cliente.
 *
 * `GET /api/config` é o documento PÚBLICO e não varia por chamador — é o que
 * permite memoizá-lo como UM só no servidor, e a razão de o boot poder ser
 * fail-fast nele. O que este usuário ganha por papel global, por concessão pessoal
 * ou por empréstimo do atlas chega por um SEGUNDO endpoint, autenticado, e é
 * somado aqui, no singleton `config`, sem que aquele documento mude de forma.
 *
 * ESTE ARQUIVO NÃO SABE INTERSECTAR. A ordem é D1 — somar primeiro, intersectar
 * depois — e quem intersecta é `atlas-settings.service.js`, que é também onde a
 * soma entra no `_baseline` (senão `revertAtlasSettings` apagaria os concedidos).
 * A função que faz isso é `mergeGrantedIntoBaseline`, e é de propósito que ela
 * more lá e não aqui: mexer no `config` por fora do dono do baseline é exatamente
 * o defeito que a armadilha descreve.
 *
 * BEST-EFFORT POR DESENHO. Uma falha aqui não pode derrubar o login nem a abertura
 * do atlas: o pior caso é o usuário ver só o catálogo público, que é o estado de
 * antes desta fase. Fechar por padrão é a direção certa quando a checagem falha.
 *
 * BEST-EFFORT NÃO É MUDO, e essa é a metade que faltava até 2026-08-24. Engolir o erro é
 * certo para o CAMINHO (login e abertura de atlas não podem cair por causa disto); engolir
 * o FATO não é. Falhada a primeira soma da sessão, `_privados` fica vazio e assim
 * permanece, e para uma conta `credenciado` o catálogo passa a ser byte a byte o de um
 * visitante anônimo, com o papel intacto e sem uma linha na tela. Daí o sinal de saúde
 * (`isResourceAccessDegraded`, `onResourceAccessHealthChanged`) e o reparo explícito
 * (`retryVisibleResources({ force: true })`). O que a tela diz mora em
 * `resource-access-phrases.js`, folha e sem imports.
 */

import { apiClient } from './api-client.js';
import { mergeGrantedIntoBaseline, revertGrantedResources } from './atlas-settings.service.js';
import { ResourceSumOutcome, resourceAccessDegradedAfter } from './resource-access-phrases.js';
import { resetResourceScope, resourceScopeKey, setResourceScope } from './resource-scope.js';
import { sessionContext } from './session-context.js';

/**
 * O escopo da última soma, para não repetir a chamada à toa.
 * `undefined` = nunca somou; `null` = somou sem atlas em foco.
 *
 * NÃO CONFUNDIR com o carimbo de `resource-scope.js`, que é outra coisa e por isso
 * mora noutro lugar: este aqui é o escopo da última soma BEM-SUCEDIDA (só muda se o
 * servidor respondeu); aquele é o escopo DECLARADO, gravado antes da chamada, e serve
 * para invalidar cache — uma soma que falhou não pode deixar o cache anterior legível.
 * @type {string|null|undefined}
 */
let _escopo;

/**
 * O escopo do ÚLTIMO pedido de soma, tenha ele dado certo ou não.
 *
 * Existe para `retryVisibleResources` poder repetir o pedido SEM que quem chama precise
 * saber qual atlas estava em foco. `_escopo` só é escrito no caminho de sucesso, então
 * depois de uma soma que falhou ele não diz nada sobre o que pedir de novo.
 */
let _escopoPedido = null;

/**
 * O número do último pedido de soma, monotônico.
 *
 * OS DOIS DISPAROS POR FRAME SAEM SEM `await` (`sync-engine.js` os larga com `.then()`),
 * então a guarda de `isOnline()` que eles carregam roda ANTES da chamada e não diz nada
 * sobre o instante em que a resposta VOLTA. Nessa janela cabem duas coisas ruins: um
 * logout, e a resposta velha de um pedido anterior. Sem este número, quem aterrissava
 * por último vencia — a resposta de antes da revogação sobrescrevia a de depois, e a
 * resposta que voltava pós-logout re-somava os privados num catálogo já anônimo.
 *
 * É A MESMA DOUTRINA DO CARIMBO DE ESCOPO (`resource-scope.js`): comparar NA VOLTA, em
 * vez de sair cancelando na saída. Cancelar exige que todo caminho de saída se lembre do
 * voo em curso; comparar na volta falha FECHADO para o caminho de que ninguém se lembrou.
 * Um número, e não o carimbo de escopo, porque dois pedidos do MESMO escopo também se
 * superam e teriam carimbos idênticos.
 * @type {number}
 */
let _pedido = 0;

/**
 * Quantas vezes a soma foi APAGADA (`clearVisibleResources`), monotônico.
 *
 * SEGUNDO contador, e não uma reutilização do primeiro, porque `_pedido` não sabe responder
 * a pergunta que decide o aviso de tela. Ele é incrementado pelas DUAS coisas (um pedido
 * novo e uma limpeza), então na volta `meuPedido !== _pedido` prova apenas "não sou mais o
 * atual" e junta num desfecho só a corrida entre pedidos e o fim da sessão. Com este número
 * ao lado, a comparação na volta distingue os dois, que é o que permite ao `false` de
 * `refreshVisibleResources` deixar de ser uma resposta ambígua. Ver `ResourceSumOutcome`.
 * @type {number}
 */
let _limpezas = 0;

/**
 * O sinal de saúde: a ÚLTIMA soma PEDIDA falhou por não alcançar o servidor.
 *
 * NÃO É "nunca somei", e a diferença é a razão de ele existir separado de `_escopo`. Aquele
 * responde "há soma de pé?" e é `undefined` tanto antes da primeira quanto depois de um
 * logout, dois estados em que não há nada a avisar. Este só sobe no desfecho `FAILED`, e só
 * desce quando uma soma POUSA (ou quando a sessão acaba). É o que o aviso da barra lê.
 * @type {boolean}
 */
let _degradado = false;

/**
 * O desfecho da última soma que terminou. Diagnóstico e teste.
 * @type {string|null}
 */
let _ultimoDesfecho = null;

/**
 * Quem quer saber quando o sinal de saúde VIRA.
 *
 * OBSERVADOR PRÓPRIO, E NÃO O BARRAMENTO DE EVENTOS, por duas razões. A primeira é de
 * dependência: este módulo é alcançado por `atlas.html` e pelo boot, e `EventTypes` traria
 * `@events` junto para caminhos que hoje não o carregam. A segunda é de honestidade do
 * contrato: só se notifica na VIRADA, então um assinante nunca é acordado por uma sequência
 * de somas boas, e um aviso que ninguém precisa nunca é repintado.
 * @type {Set<function(boolean): void>}
 */
const _ouvintesDeSaude = new Set();

/**
 * @private Publica a virada do sinal de saúde, se houve virada.
 * @param {boolean} anterior
 */
function anunciarSaude(anterior) {
    if (anterior === _degradado) return;
    for (const ouvinte of Array.from(_ouvintesDeSaude)) {
        try {
            ouvinte(_degradado);
        } catch {
            // Um assinante que estoura não pode derrubar os outros nem o caminho de login.
        }
    }
}

/**
 * Os cinco grupos do payload aditivo, na ordem em que o servidor os nomeia
 * (`PAYLOAD_KEY_BY_TYPE`, no backend).
 *
 * `basemaps` entrou junto com o quinto tipo de recurso. Repare que ali o grupo é um
 * ARRAY, como os outros quatro, enquanto `config.basemaps` é um OBJETO indexado por
 * id: quem reprojeta de uma forma para a outra é `mergeGrantedIntoBaseline`, e não
 * este arquivo, que só indexa ids.
 */
const GRUPOS = Object.freeze(['basemaps', 'tilesets', 'dataLayers', 'analysisLayers', 'views360']);

/** @returns {Object<string, Set<string>>} Um mapa de conjuntos vazios, um por grupo. */
function conjuntosVazios() {
    return Object.fromEntries(GRUPOS.map((g) => [g, new Set()]));
}

/**
 * Os ids PRIVADOS que o servidor entregou na última soma, por grupo.
 *
 * É a única resposta que o cliente tem para "este item do catálogo é privado?", e
 * ela é EXATA por construção: o payload aditivo devolve só o privado, então um id
 * que veio por ele é privado, e um que não veio é público (ou invisível, que dá no
 * mesmo para quem desenha o cartão). Não há campo `access_level` nos itens de
 * `config`, e não deveria haver: aquele documento é o público.
 * @type {Object<string, Set<string>>}
 */
let _privados = conjuntosVazios();

/**
 * Os ids que este usuário pode REPASSAR (concessão viva de `view_share`), por grupo.
 * Papel global fica de FORA daqui de propósito — quem tem acesso global concede de
 * raiz, e quem sabe disso é `sessionContext`.
 * @type {Object<string, Set<string>>}
 */
let _repassaveis = conjuntosVazios();

/**
 * POR QUE este usuário enxerga o recurso privado, uma resposta só por id.
 *
 * O SERVIDOR JÁ RESOLVE A PRECEDÊNCIA (`papel > concessao > emprestimo`) e manda UMA
 * palavra por id: o cliente não recombina nada, só lê. A propriedade que a tela usa é a
 * última da escada: só `emprestimo` some sozinha ao trocar de atlas, porque é a única
 * amarrada ao atlas em foco. As outras duas seguem a pessoa.
 * @enum {string}
 */
export const RESOURCE_ORIGIN = Object.freeze({
    /** Papel global (administrador, credenciado): alcança o acervo de raiz. */
    PAPEL: 'papel',
    /** Concessão pessoal viva, direta ou por grupo de acesso. */
    CONCESSAO: 'concessao',
    /** Empréstimo do atlas em foco. Cai sozinho ao sair dele. */
    EMPRESTIMO: 'emprestimo',
});

/** @type {ReadonlySet<string>} O vocabulário fechado que o índice aceita. */
const ORIGENS_CONHECIDAS = new Set(Object.values(RESOURCE_ORIGIN));

/**
 * A procedência de cada id privado, por grupo.
 *
 * `Map` e não `Set` porque aqui a resposta é um VALOR e não uma pertinência, e um id ausente
 * precisa ser distinguível de um id presente com procedência que este build não reconhece:
 * os dois viram `null` na leitura, de propósito (ver `resourceAccessOrigin`).
 * @type {Object<string, Map<string, string>>}
 */
let _origens = Object.fromEntries(GRUPOS.map((g) => [g, new Map()]));

/** @private Reconstrói os três índices a partir do payload que acabou de chegar. */
function indexarPayload(payload) {
    _privados = conjuntosVazios();
    _repassaveis = conjuntosVazios();
    _origens = Object.fromEntries(GRUPOS.map((g) => [g, new Map()]));
    for (const grupo of GRUPOS) {
        for (const item of (Array.isArray(payload?.[grupo]) ? payload[grupo] : [])) {
            if (item?.id != null) _privados[grupo].add(String(item.id));
        }
        for (const id of (Array.isArray(payload?.shareable?.[grupo]) ? payload.shareable[grupo] : [])) {
            _repassaveis[grupo].add(String(id));
        }
        // O SERVIDOR ANTIGO NÃO MANDA `origins`, e o laço precisa sobreviver a isso sem
        // uma linha de tratamento no chamador: sem a chave, o mapa fica vazio e todo
        // `resourceAccessOrigin` responde `null`, que é o valor que os consumidores já
        // tratam como "não sei" e para o qual eles degradam à frase genérica.
        const origens = payload?.origins?.[grupo];
        if (!origens || typeof origens !== 'object') continue;
        for (const [id, origem] of Object.entries(origens)) {
            // VALOR DESCONHECIDO FICA DE FORA, e não entra cru. Uma palavra que este build
            // não conhece chegaria à tela como rótulo sem tradução; virar `null` a manda
            // para a frase genérica, que é o degrau que já existe e já está escrito.
            if (ORIGENS_CONHECIDAS.has(origem)) _origens[grupo].set(String(id), origem);
        }
    }
}

/**
 * Busca os recursos privados visíveis e os SOMA ao baseline do `config`.
 *
 * Chamar com um `atlasId` diferente RE-SOMA do zero (a soma anterior é desfeita
 * pela própria `mergeGrantedIntoBaseline`), porque sair de um atlas que empresta
 * e entrar noutro que não empresta precisa tirar o que o primeiro deu.
 *
 * O BOOLEANO CONTINUA SENDO O CONTRATO com os chamadores, que só perguntam "aterrissou?"
 * (`sync-engine.js` decide por ele se emite `ATLAS_SETTINGS_CHANGED`). O desfecho DETALHADO
 * sai por fora, em `lastResourceSumOutcome()` e no sinal de saúde, porque acoplar a decisão
 * de UI ao valor de retorno obrigaria os cinco chamadores a aprender o vocabulário novo para
 * continuar fazendo o que já faziam.
 *
 * @param {string|null} [atlasId] - O atlas em foco, ou null.
 * @returns {Promise<boolean>} `true` se a soma aterrissou (desfecho `APPLIED`). O `false`
 *   cobre os outros TRÊS desfechos, e só UM deles é falha: ver {@link ResourceSumOutcome}.
 */
export async function refreshVisibleResources(atlasId = null) {
    const anterior = _degradado;
    const desfecho = await somar(atlasId);
    _ultimoDesfecho = desfecho;
    _degradado = resourceAccessDegradedAfter(anterior, desfecho);
    anunciarSaude(anterior);
    return desfecho === ResourceSumOutcome.APPLIED;
}

/**
 * @private A soma em si, devolvendo o DESFECHO em vez de um booleano.
 *
 * A comparação continua sendo NA VOLTA, e agora são duas, na ordem que importa: primeiro a
 * limpeza (a sessão acabou debaixo deste voo, e isso vence qualquer outra leitura), depois o
 * número de pedido (alguém mais novo pediu). O `catch` faz as MESMAS duas perguntas antes de
 * chamar a rejeição de falha: uma requisição que já tinha sido superada, ou que falhou
 * porque o logout derrubou a sessão no meio, não é um defeito a relatar para o usuário, e
 * relatar isso acenderia o aviso em todo logout.
 * @param {string|null} atlasId
 * @returns {Promise<string>} Um valor de {@link ResourceSumOutcome}.
 */
async function somar(atlasId) {
    const escopo = atlasId ?? null;
    _escopoPedido = escopo;
    const meuPedido = ++_pedido;
    const minhaLimpeza = _limpezas;
    // O CARIMBO DE ESCOPO VAI ANTES DA CHAMADA, e a ordem é o ponto: quem guarda
    // resposta em cache (a lista de projetos do 360, hoje) compara o carimbo na
    // LEITURA, então o instante em que o escopo passa a ser outro é o instante em que
    // o chamador disse que mudou, não o em que o servidor respondeu. Carimbar depois
    // deixaria a lista do atlas anterior legível durante a chamada, e legível para
    // sempre se ela falhasse.
    setResourceScope(resourceScopeKey(sessionContext.userId, escopo));
    try {
        const payload = await apiClient.getVisibleResources(escopo);
        // SUPERADO: alguém pediu depois de mim, ou a soma foi apagada enquanto eu voava.
        // Aterrissar aqui reescreveria o `config` com um retrato do passado. Sair ANTES
        // de `mergeGrantedIntoBaseline` é o ponto: ela é síncrona e auto-inversa, então
        // depois dela o estrago já está no baseline e no array vivo.
        if (_limpezas !== minhaLimpeza) return ResourceSumOutcome.CLEARED;
        if (meuPedido !== _pedido) return ResourceSumOutcome.SUPERSEDED;
        mergeGrantedIntoBaseline(payload);
        indexarPayload(payload);
        _escopo = escopo;
        return ResourceSumOutcome.APPLIED;
    } catch {
        // Sem alcance ao servidor, ou sem sessão: fica só o público. Não propaga —
        // o chamador é o caminho de login e de abertura de atlas. Mas as duas perguntas
        // da corrida vêm ANTES de chamar isto de falha: o 401 que o logout produz no meio
        // do voo é o fim normal da sessão, não uma avaria para relatar.
        if (_limpezas !== minhaLimpeza) return ResourceSumOutcome.CLEARED;
        if (meuPedido !== _pedido) return ResourceSumOutcome.SUPERSEDED;
        return ResourceSumOutcome.FAILED;
    }
}

/**
 * UMA tentativa de refazer a soma que falhou, com o mesmo escopo do último pedido.
 *
 * POR QUE ELA EXISTE, e o defeito que ela fecha é de DISPONIBILIDADE, não de sigilo.
 * `refreshVisibleResources` é best-effort e engole o próprio erro; `disconnect`
 * (`sync-engine.js`) apaga a soma e dispara a re-soma SEM `await` e com o erro descartado.
 * Entre as duas — ou para sempre, se a re-soma falhar por rede — um usuário CONECTADO
 * ficava com `_escopo === undefined`, e a poda de saída recusava exportar e salvar como
 * local com uma mensagem que manda reconectar quem já está conectado. Não havia nova
 * tentativa em lugar nenhum: a única consequência do erro era o `.catch(() => {})`.
 *
 * NÃO É UM LAÇO DE RETENTATIVA: uma tentativa, e o chamador decide o que fazer com o
 * `false`. Também não é um caminho de sigilo — a direção da falha continua fecha-fechado,
 * porque sem soma a poda recusa rodar.
 *
 * O CURTO-CIRCUITO DA PRIMEIRA LINHA É CERTO PARA UM CHAMADOR E ERRADO PARA O OUTRO, e é
 * por isso que existe a bandeira em vez de uma função irmã. `_escopo` guarda o escopo da
 * última soma BEM-SUCEDIDA, então ele continua de pé depois de uma soma POSTERIOR que
 * falhou (a troca de atlas é o caso comum): perguntar "já somei alguma vez?" responde SIM
 * num estado em que o índice está desatualizado ou vazio.
 *
 *   - Sem `force` (a poda de saída, `resource-reference.resolver.js`): a pergunta é "há
 *     soma de pé para eu poder podar?", e uma soma antiga responde isso. Pedir de novo ali
 *     seria um round-trip por exportação.
 *   - Com `force` (o aviso da barra, e qualquer gesto explícito de reparo): a pergunta é
 *     "refaça o último pedido", e o curto-circuito transformaria o botão em um botão que
 *     não faz nada, exatamente no caso em que a pessoa mais precisa dele.
 *
 * @param {Object} [opcoes]
 * @param {boolean} [opcoes.force=false] - Ignora o curto-circuito e repete o pedido.
 * @returns {Promise<boolean>} `true` se a soma está de pé (já estava, ou acabou de pousar).
 */
export async function retryVisibleResources({ force = false } = {}) {
    if (!force && _escopo !== undefined) return true;
    if (!sessionContext.isAuthenticated()) return false;
    return refreshVisibleResources(_escopoPedido);
}

/**
 * O sinal que o aviso de tela lê: a ÚLTIMA soma PEDIDA falhou por não alcançar o servidor.
 *
 * NÃO CONFUNDIR COM "não há soma de pé" (`_grantedScope() === undefined`), que é verdade
 * também no boot anônimo e logo depois de um logout, dois estados em que ninguém perdeu
 * nada. Corrida perdida e sessão encerrada no meio do voo não sobem este sinal.
 * @returns {boolean}
 */
export function isResourceAccessDegraded() {
    return _degradado;
}

/**
 * O desfecho da última soma que terminou, ou `null` se nenhuma terminou nesta sessão.
 * Diagnóstico e teste; a tela lê {@link isResourceAccessDegraded}.
 * @returns {string|null} Um valor de {@link ResourceSumOutcome}.
 */
export function lastResourceSumOutcome() {
    return _ultimoDesfecho;
}

/**
 * Assina a VIRADA do sinal de saúde (só a virada, nunca cada soma).
 *
 * @param {function(boolean): void} ouvinte - Recebe o novo valor de {@link isResourceAccessDegraded}.
 * @returns {function(): void} Cancela a assinatura. Chamar duas vezes é inócuo.
 */
export function onResourceAccessHealthChanged(ouvinte) {
    if (typeof ouvinte !== 'function') return () => {};
    _ouvintesDeSaude.add(ouvinte);
    return () => { _ouvintesDeSaude.delete(ouvinte); };
}

/**
 * Desfaz a soma (logout, desconexão, volta ao store local).
 * @returns {void}
 */
export function clearVisibleResources() {
    // O MESMO número que invalida um pedido superado invalida o voo em curso: apagar a
    // soma e deixar uma resposta a caminho é como o privado voltava ao catálogo depois
    // do logout. `logoutAndDisconnect` já desliga a re-soma que ELE dispara
    // (`resumeGranted: false`), mas não tem como cancelar a que um frame disparou.
    _pedido += 1;
    // O SEGUNDO CONTADOR SOBE AQUI, e é o que dá ao voo em curso um desfecho `CLEARED` em
    // vez de `SUPERSEDED`: as duas coisas incrementam `_pedido`, e só esta incrementa este.
    _limpezas += 1;
    revertGrantedResources();
    indexarPayload(null);
    _escopo = undefined;
    // O AVISO SOME COM A SESSÃO. Sair da conta não é o momento de dizer a alguém que o
    // acervo privado dele não carregou: não há mais acervo privado a carregar, e o botão de
    // reparo recusaria (`retryVisibleResources` exige sessão). Um aviso que sobrevive ao
    // fato que o motivou é como se aprende a ignorar avisos.
    const anterior = _degradado;
    _degradado = false;
    _ultimoDesfecho = null;
    anunciarSaude(anterior);
    // O MESMO CICLO DE VIDA, e não um paralelo: o que sai daqui é a soma no `config`,
    // e o que sai do carimbo é a permissão de reusar qualquer resposta decidida sob a
    // sessão anterior. Esquecer a segunda deixaria o cache de projetos do 360 (que
    // este arquivo não conhece, e não deve conhecer) servindo o emprestado depois do
    // logout.
    resetResourceScope();
}

/**
 * Se este item do catálogo é um recurso PRIVADO que o servidor entregou a este
 * usuário (por papel global, por concessão pessoal ou por empréstimo do atlas).
 *
 * @param {string} grupo - Um de `basemaps`, `tilesets`, `dataLayers`, `analysisLayers`, `views360`.
 * @param {string} id - O id CRU do recurso (o do catálogo, não o prefixado do cartão).
 * @returns {boolean}
 */
export function isPrivateResource(grupo, id) {
    if (!grupo || id == null) return false;
    return _privados[grupo]?.has(String(id)) === true;
}

/**
 * Se este usuário pode CONCEDER acesso a este recurso.
 *
 * DUAS ORIGENS, e a soma delas é a regra inteira: papel global (quem tem acesso
 * global concede de raiz, sem concessão nenhuma) OU uma concessão viva de
 * `view_share`. Quem só tem `view` recebe `false`, e é o que tira a ação
 * "Compartilhar" do cartão em vez de oferecê-la para o servidor recusar.
 *
 * ESTA FUNÇÃO ESPELHA O SERVIDOR, e `hasGlobalDataAccess()` inclui o CREDENCIADO de
 * propósito: conceder e revogar no eixo de RECURSO é o que ele mantém (decisão D1 de
 * 2026-08-20, que lhe tirou o eixo de GRUPO e não este). O gate do servidor é o mesmo
 * (`requireResourceShare`, `fn_has_global_data_access`), então esconder o botão dele
 * aqui divergiria do que a API entrega. Este é o ÚNICO consumidor de
 * `hasGlobalDataAccess()` que restou no cliente, e ele é a razão de o método continuar
 * vivo: a audiência da página de administração deixou de perguntá-lo.
 *
 * O PRODUTOR ENTRA PELO `shareable`, E NÃO POR PAPEL: desde 2026-08-20 ele concede de
 * RAIZ o que a OM dele produz, e quem responde isso é o SERVIDOR — o id do recurso
 * produzido passou a chegar dentro de `shareable` (`LIST_SHAREABLE_OF_ACTOR`), que este
 * índice já consome. Não há linha nova aqui, e é esse o desenho: o cliente continua sem
 * saber de qual OM é cada item do payload aditivo, então perguntar por papel produziria
 * uma segunda resposta, mais pobre, para a mesma pergunta.
 *
 * ISTO É SÓ PARA A INTERFACE DECIDIR O QUE MOSTRAR. Quem decide o que ENTREGAR é
 * o servidor: `requireResourceShare` protege a rota e `grantResource` reafirma a
 * regra no serviço. Um erro aqui esconde um botão; nunca abre nada.
 *
 * @param {string} grupo
 * @param {string} id
 * @returns {boolean}
 */
export function canShareResource(grupo, id) {
    if (!grupo || id == null) return false;
    if (sessionContext.hasGlobalDataAccess()) return true;
    return _repassaveis[grupo]?.has(String(id)) === true;
}

/**
 * POR QUE este usuário enxerga este recurso privado: papel global, concessão pessoal ou
 * empréstimo do atlas em foco.
 *
 * `null` É UM ESTADO LEGÍTIMO, e não uma linha pela metade. Ele cobre o recurso público (que
 * não tem procedência a explicar), o servidor antigo que ainda não manda `origins`, a soma
 * que falhou e a procedência que este build não reconhece. Os quatro devem produzir a MESMA
 * coisa na tela: a frase genérica de hoje, sem selo. Consumidor que trate `null` como um
 * quinto rótulo está inventando informação que o cliente não tem.
 *
 * A PROPRIEDADE QUE A TELA USA: só `emprestimo` some sozinha ao trocar de atlas. Papel e
 * concessão seguem a pessoa, então um selo de empréstimo é o único que pede a ressalva
 * "enquanto você estiver neste atlas".
 *
 * ISTO É SÓ PARA A INTERFACE EXPLICAR. Quem decide o que ENTREGAR continua sendo o servidor.
 *
 * @param {string} grupo - Um de `basemaps`, `tilesets`, `dataLayers`, `analysisLayers`, `views360`.
 * @param {string} id - O id CRU do recurso (o do catálogo, não o prefixado do cartão).
 * @returns {string|null} Um valor de {@link RESOURCE_ORIGIN}, ou `null` quando não se sabe.
 */
export function resourceAccessOrigin(grupo, id) {
    if (!grupo || id == null) return null;
    return _origens[grupo]?.get(String(id)) ?? null;
}

/** O escopo da última soma bem-sucedida. Só para teste e diagnóstico. @returns {string|null|undefined} */
export function _grantedScope() {
    return _escopo;
}
