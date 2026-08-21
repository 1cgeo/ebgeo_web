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
 */

import { apiClient } from './api-client.js';
import { mergeGrantedIntoBaseline, revertGrantedResources } from './atlas-settings.service.js';
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

/** @private Reconstrói os dois índices a partir do payload que acabou de chegar. */
function indexarPayload(payload) {
    _privados = conjuntosVazios();
    _repassaveis = conjuntosVazios();
    for (const grupo of GRUPOS) {
        for (const item of (Array.isArray(payload?.[grupo]) ? payload[grupo] : [])) {
            if (item?.id != null) _privados[grupo].add(String(item.id));
        }
        for (const id of (Array.isArray(payload?.shareable?.[grupo]) ? payload.shareable[grupo] : [])) {
            _repassaveis[grupo].add(String(id));
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
 * @param {string|null} [atlasId] - O atlas em foco, ou null.
 * @returns {Promise<boolean>} true se a soma aconteceu. `false` cobre TRÊS casos que o
 *   chamador trata igual (não emitir aviso de UI): servidor inalcançável, soma apagada
 *   no meio do voo, e pedido superado por outro mais novo.
 */
export async function refreshVisibleResources(atlasId = null) {
    const escopo = atlasId ?? null;
    _escopoPedido = escopo;
    const meuPedido = ++_pedido;
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
        if (meuPedido !== _pedido) return false;
        mergeGrantedIntoBaseline(payload);
        indexarPayload(payload);
        _escopo = escopo;
        return true;
    } catch {
        // Sem alcance ao servidor, ou sem sessão: fica só o público. Não propaga —
        // o chamador é o caminho de login e de abertura de atlas.
        return false;
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
 * @returns {Promise<boolean>} `true` se a soma está de pé (já estava, ou acabou de pousar).
 */
export async function retryVisibleResources() {
    if (_escopo !== undefined) return true;
    if (!sessionContext.isAuthenticated()) return false;
    return refreshVisibleResources(_escopoPedido);
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
    revertGrantedResources();
    indexarPayload(null);
    _escopo = undefined;
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

/** O escopo da última soma bem-sucedida. Só para teste e diagnóstico. @returns {string|null|undefined} */
export function _grantedScope() {
    return _escopo;
}
