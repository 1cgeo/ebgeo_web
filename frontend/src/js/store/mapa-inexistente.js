// Path: js/store/mapa-inexistente.js

/**
 * @fileoverview A LEITURA QUE PRECEDE UMA ESCRITA, e a recusa quando o mapa não existe (D2).
 *
 * ================= O DEFEITO =================================================
 *
 * `getMapDataCompat` (`store/repositories/index.js`) responde a um mapa AUSENTE com
 * `getEmptyMapData()`: um documento completo, com todos os baldes de feição, e `id: null`. Nada
 * nele diz "não existe". Quem lê, muta e grava de volta cai em `LocalRepository.saveMap`, cujo
 * `_resolveMapKey` devolve o PRÓPRIO NOME quando não acha registro nenhum: nasce um mapa com a
 * CHAVE e o `id` iguais ao nome. É o mapa FANTASMA.
 *
 * Em atlas de SERVIDOR o prejuízo é duplo e calado: a op sai com contexto de mapa que não é UUID,
 * o anti-vazamento a descarta antes do envio, e o gesto é aceito na tela e jogado fora. Medido em
 * 2026-09-21 no caminho do rename remoto: uma feição desenhada depois de um par renomear o mapa ia
 * parar num registro sob o nome VELHO, de onde a op nunca saiu da fila.
 *
 * ================= A FRONTEIRA LOCAL/REMOTO, E POR QUE ELA É ASSIM ===========
 *
 * A recusa vale SÓ em atlas de SERVIDOR, que é a mesma fronteira do modelo
 * (`refusesMissingRemoteMap` em `store/map.operations.js` e a guarda gêmea de `editCatalogLayers`
 * em `store/catalog.operations.js`). Quatro razões, e nenhuma é timidez:
 *
 *   1. EM ATLAS LOCAL UM MAPA CHAVEADO POR NOME É LEGÍTIMO POR DESENHO. Com sync desligado
 *      `addMap` grava o documento sob o NOME (`mintMapDocument` só usa a chave UUID quando
 *      `isOperationLoggingEnabled()`), então `_resolveMapKey` devolvendo o nome é o caminho
 *      NORMAL e não a falha. Recusar ali seria recusar a metade local do produto.
 *   2. O DOCUMENTO FABRICADO É A REDE DE SEGURANÇA DO BOOT LOCAL. `mapaDeEmergencia`
 *      (`store/repository.js`) pode devolver `DEFAULT_MAP_NAME` sem que `seedBlankDefaultMap`
 *      tenha rodado, quando a leitura das chaves falhou. Nesse estado tudo já está quebrado, e o
 *      documento fabricado é o que deixa a pessoa continuar desenhando em vez de encarar um mapa
 *      que recusa todo clique sem saída nenhuma.
 *   3. O PREJUÍZO QUE A RECUSA EVITA É ESPECÍFICO DO SERVIDOR: a op descartada pelo anti-vazamento
 *      e o registro que nenhum snapshot reconhece. No atlas local a escrita PERSISTE, e o pior
 *      caso é um cartão a mais na aba Mapas, visível e apagável.
 *   4. ANÔNIMO É A MAIOR PARTE DO PRODUTO. Mudar o comportamento do atlas local mexe no `.ebgeo`,
 *      na migração e no visitante deslogado de uma vez só, por um defeito que ali não acontece.
 *
 * A PERGUNTA É FEITA AO ESCOPO ATIVO (`getActiveScope()`), e não ao marcador de origem
 * (`isRemoteStoreSync`, `store/store-origin.js`). Os dois respondem quase sempre a mesma coisa e
 * NÃO são a mesma pergunta: o marcador fala pela INSTALAÇÃO (é o que a guarda de boot deslogado
 * consulta) e o escopo fala por ESTA ABA, que é onde a escrita vai parar. `tx.scope` de
 * `store/store-transaction.js` é literalmente `getActiveScope()`, então esta é a mesma fronteira
 * que o modelo já usa, sem precisar de uma transação aberta para ser perguntada.
 *
 * ================= AS TRÊS PORTAS, E POR QUE SÃO TRÊS =======================
 *
 * Escrita de GESTO recusa FALANDO; escrita DERIVADA pula CALADA. A assimetria foi medida em
 * 2026-09-21: abrir um atlas e trocar de mapa já grava contagem de cores e ponteiro de mapa
 * corrente sem que ninguém tenha editado nada, e um aviso nesses caminhos apareceria a cada troca
 * de mapa, dizendo que algo falhou quando nada falhou. Um aviso que aparece quando não devia treina
 * a ignorar o aviso, e o que se perde é justamente o do gesto.
 *
 * A TERCEIRA PORTA É SÓ A PERGUNTA (`mapExistsForGesture`), e ela existe porque metade dos gestos
 * do produto NÃO edita o documento do mapa. Marcador 3D, medição, viewshed, posição de câmera
 * salva, orientação e marcador 360 escrevem os STORES LATERAIS (`cesium3d_<chave>`,
 * `streetview360_<chave>`), que `LocalRepository._resolveMapKey` chaveia pelo mesmo nome não
 * resolvido: o registro fica ÓRFÃO, sem cartão nenhum na aba Mapas que denuncie a existência dele,
 * e a op que o gesto enfileira sai com contexto de mapa que não é UUID e morre no anti-vazamento.
 * É o MESMO prejuízo (gesto aceito e jogado fora em silêncio) por outro caminho, e a diferença
 * "não aparece cartão fantasma" só o torna mais difícil de achar, não menor.
 *
 * Devolver a eles o documento do mapa seria pior que inútil: eles não o leem, e `getExistingMapData`
 * traz o documento INTEIRO (todas as feições desenhadas) para responder uma pergunta de sim ou não.
 * Daí a pergunta em separado, e daí a ORDEM INVERTIDA dentro dela (escopo primeiro, disco depois):
 * em atlas local a resposta é sempre `true`, então perguntar ao escopo antes poupa uma leitura
 * completa do documento a cada marcador colocado.
 */

import { StoreScopeKind, getActiveScope } from './atlas-namespace.js';
import { getExistingMapData, getMapDataCompat } from './repositories/index.js';
import { emitStoreError, StoreErrorEvents } from './store-errors.js';

/**
 * O motivo carregado por `STORE_OPERATION_BLOCKED` quando o mapa alvo não existe. É um ESTADO,
 * como `map_locked`, e não uma capacidade: a frase dele mora em `store/denial-phrases.js`.
 * @type {string}
 */
export const MAP_MISSING_REASON = 'map_missing';

/**
 * Whether a missing map must refuse the write instead of being fabricated.
 * @returns {boolean} True in a SERVER atlas, where a name-keyed map is never legitimate.
 * @private
 */
function mapMustExist() {
    return getActiveScope()?.kind === StoreScopeKind.REMOTE;
}

/**
 * Resolves the map document a write is about to mutate, with no fabrication in a server atlas.
 *
 * O SEGUNDO `await` DO RAMO LOCAL É DELIBERADO. Ele relê pelo caminho tolerante em vez de montar
 * o documento vazio aqui, e o que isso compra é equivalência EXATA com o comportamento de hoje:
 * quem fabrica continua sendo `getMapDataCompat`, então as duas metades não podem divergir na
 * forma do documento. O custo é uma segunda ida ao disco num caminho que já é um erro (mapa
 * ausente em atlas local), que é raro por construção: o `Principal` do boot é semeado no disco.
 *
 * @param {string} mapNameOrId - Map name or id the write targets
 * @returns {Promise<Object|null>} The document to mutate, or null when the write must not happen
 * @private
 */
async function resolveMapDocument(mapNameOrId) {
    const existing = await getExistingMapData(mapNameOrId);
    if (existing) return existing;
    return mapMustExist() ? null : getMapDataCompat(mapNameOrId);
}

/**
 * Announces the refusal. ONE emitter for the two gesture doors, so the payload of a 3D marker and
 * the payload of a drawn feature cannot drift apart: `store-error-listener.js` keys the sentence on
 * `reason` and the diagnostics read `operation`, and a second copy is how one of them loses a field.
 *
 * RECUSA É `return`, NUNCA `throw`: é a linha do meio da tabela de `store/store-errors.js` (falha
 * ESPERADA), a mesma forma que o gate de papel e o de trava já usam nos mesmos arquivos. Um
 * `throw` aqui atravessaria `withMapDocument`/`withSideDocument` e `runTransaction` até a tela,
 * onde ele se lê como defeito do produto e não como recusa.
 *
 * @param {string} operation - Operation name, as the other gates report it
 * @param {string} mapNameOrId - The map the gesture aimed at, for diagnostics only
 * @returns {void}
 * @private
 */
export function recusarMapaInexistente(operation, mapNameOrId) {
    emitStoreError(StoreErrorEvents.STORE_OPERATION_BLOCKED, {
        operation,
        reason: MAP_MISSING_REASON,
        mapName: mapNameOrId,
        timestamp: Date.now()
    });
}

/**
 * O DOCUMENTO DE UM GESTO: recusa nomeando o estado quando o mapa não existe.
 *
 * A ordem do molde vale e não muda: PAPEL e TRAVA são perguntados ANTES, pelo chamador, porque um
 * gesto merece UMA recusa e a primeira razão verdadeira é a que a pessoa precisa ler. Esta é a
 * terceira pergunta, e ela só acontece depois de as duas anteriores terem passado.
 *
 * @param {string} mapNameOrId - Map name or id the gesture targets
 * @param {string} operation - Operation name, as the other gates report it
 * @returns {Promise<Object|null>} The document to mutate, or null once the refusal was announced
 */
export async function mapDocumentForGesture(mapNameOrId, operation) {
    const documento = await resolveMapDocument(mapNameOrId);
    if (documento) return documento;

    recusarMapaInexistente(operation, mapNameOrId);
    return null;
}

/**
 * A PERGUNTA SOZINHA, para o gesto que escreve um store LATERAL e não o documento do mapa.
 *
 * Quem a usa são os dois funis de 3D e 360 (`editCesium3d` e `editStreetview360`), que leem e
 * gravam `cesium3d_<chave>` / `streetview360_<chave>`. O mapa alvo continua sendo o dono lógico do
 * que eles escrevem: em atlas de SERVIDOR, um lateral gravado para um mapa que o store de MAPAS
 * não tem é registro órfão, e a op que viaja com ele carrega um contexto que não é UUID e é
 * descartada antes do envio.
 *
 * A ORDEM É INVERTIDA em relação a `resolveMapDocument`, e é a única diferença de fundo entre as
 * duas: aqui o escopo é perguntado ANTES do disco, porque em atlas local a resposta é sempre
 * verdadeira e `getExistingMapData` traz o documento INTEIRO do mapa, com todas as feições
 * desenhadas, para responder um sim ou não. Ler isso a cada marcador colocado num atlas local
 * seria pagar o preço da guarda onde ela não vale nada.
 *
 * A ORDEM DOS ARGUMENTOS É A DA IRMÃ (mapa primeiro, operação depois) e não a do esboço que pediu
 * esta função. As duas são lidas lado a lado, os dois argumentos são `string`, e uma troca de
 * ordem entre irmãs não lança: ela grava o nome da operação como nome de mapa e some.
 *
 * @param {string} mapNameOrId - Map name or id the gesture targets
 * @param {string} operation - Operation name, as the other gates report it
 * @returns {Promise<boolean>} True when the write may proceed; false once the refusal was announced
 */
export async function mapExistsForGesture(mapNameOrId, operation) {
    if (!mapMustExist()) return true;
    if (await getExistingMapData(mapNameOrId)) return true;

    recusarMapaInexistente(operation, mapNameOrId);
    return false;
}

/**
 * O DOCUMENTO DE UMA ESCRITA DERIVADA: some em silêncio quando o mapa não existe.
 *
 * Derivada é o que não responde a um gesto: o PNG regenerado de um símbolo, a contagem de cores, o
 * ponteiro do mapa corrente, a persistência adiada de camada. Ninguém apertou nada, então não há
 * quem avisar, e avisar mesmo assim é o ruído descrito no cabeçalho deste arquivo.
 *
 * @param {string} mapNameOrId - Map name or id the derived write targets
 * @returns {Promise<Object|null>} The document to mutate, or null to skip the write
 */
export async function mapDocumentForDerivedWrite(mapNameOrId) {
    return resolveMapDocument(mapNameOrId);
}
