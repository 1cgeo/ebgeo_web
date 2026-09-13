// Path: src/modules/sync/structural-marker.js
//
// O MARCADOR DAS EXCEÇÕES REST: a linha em `operations` que uma escrita estrutural feita FORA do
// log deixa para trás, para que o par que estava offline convirja e para que a versão do atlas
// pare de afirmar que nada aconteceu.
//
// O PROBLEMA, medido primeiro no merge e depois nas outras três. Merge, duplicação de mapa, clone
// e importação são as quatro escritas de entidade que NÃO passam pelo sync (são operações de
// entidade INTEIRA, cujo efeito não se expressa como sequência de ops). Elas movem ou criam
// linhas em massa, e nenhuma op descreve o que fizeram. O par CONECTADO aprende pelo broadcast
// efêmero da rota (`maps_merged`, `map_duplicated`), que alcança quem tem socket naquele
// instante. O par que estava OFFLINE reconecta com `sync_request {lastVersion: N}`; como nada
// tinha sido escrito em `operations`, `atlas.current_version` continuava em N (o gatilho
// `trg_update_atlas_version` só dispara no INSERT), o pull incremental respondia
// `{operations: []}` e o cliente concluía que estava em dia. Só um F5 (pull da versão 0)
// consertava. O merge fechou isso em 2026-07; a duplicação, o clone e a importação ficaram
// abertos até 2026-09-13.
//
// AS DUAS COLUNAS DIZEM O MESMO NOME DESDE 2026-09-13, E ELAS JÁ DIVERGIRAM DE PROPÓSITO.
// `entity_type` sempre guardou o nome HONESTO do ato (`map_duplicate`, `atlas_clone`,
// `atlas_import`), que é o que uma consulta de diagnóstico e a leitura do log precisam ver;
// `client_entity_type`, que é o que `toFrontendOperation` publica como `entityType`, guardava
// `map_merge` para os quatro, porque aquela era a única palavra que a versão anterior do cliente
// reconhecia como "mudança estrutural por REST, tire um snapshot". A ponte existia para que o
// marcador não chegasse como tipo desconhecido, que o cliente avisa uma vez e descarta: a versão
// avançaria e a convergência não aconteceria, que é metade do defeito de novo.
//
// A PONTE CAIU PELA DECISÃO D6 (2026-09-13, `docs/decisions/decisions-2026.md`): a linha
// `integracao_backend` nunca foi implantada e a primeira implantação é instalação nova, então não
// existe cliente anterior em campo para proteger. O cliente desta árvore conhece os quatro nomes
// (`STRUCTURAL_RESYNC_OPS`, em `frontend/src/js/store/sync/structural-markers.js`), e publicar o
// nome honesto é o que permite ao par distinguir os quatro atos sem abrir o payload.
//
// O QUE A SIMETRIA NÃO AUTORIZA: apagar a distinção entre as duas colunas. Elas continuam
// separadas porque o que o LOG guarda e o que o FIO publica são decisões diferentes (o 3D/360
// usa a mesma separação para traduzir tipo genérico em específico), e um marcador novo que
// precise de tradução volta a divergir sem mudar nada aqui.
//
// O QUE O MARCADOR NÃO É: uma op aplicável. Nenhum dos quatro nomes está em `APPLIABLE_TARGETS`,
// então um cliente que EMPURRE um deles é recusado por operação antes do log, como qualquer tipo
// que este servidor não conhece.
import { randomUUID } from 'crypto';
import { INSERT_OPERATION } from './sync.queries.js';

/**
 * Os quatro atos estruturais que escrevem fora do log. Desde a decisão D6 estes nomes SÃO o
 * contrato de fio: cada marcador é publicado pelo seu.
 */
export const STRUCTURAL_MARKER = Object.freeze({
  MAP_MERGE: 'map_merge',
  MAP_DUPLICATE: 'map_duplicate',
  ATLAS_CLONE: 'atlas_clone',
  ATLAS_IMPORT: 'atlas_import',
});

/**
 * Os nomes que o fio publica, e é por eles que o cliente decide tirar um snapshot. Espelho do
 * `STRUCTURAL_RESYNC_OPS` do frontend (`frontend/src/js/store/sync/structural-markers.js`),
 * preso por `frontend/tests/unit/marcador-estrutural-espelha-backend.test.js`: nome novo entra
 * nos dois pacotes no mesmo commit, senão o par recebe um tipo que ignora em silêncio.
 */
export const MARCADORES_PUBLICADOS = Object.freeze(Object.values(STRUCTURAL_MARKER));

/**
 * Grava o marcador na MESMA transação do ato que ele descreve.
 *
 * `client_id` é NOT NULL e identifica a origem de uma op. Não há cliente por trás de uma rota
 * REST, então cada ato leva uma sentinela de servidor, que também é o que permite ao par
 * reconhecer que o marcador não é eco dele mesmo.
 *
 * @param {Object} t - Contexto de transação (pg-promise).
 * @param {Object} params
 * @param {string} params.atlasId - O atlas onde a versão precisa avançar.
 * @param {string} params.kind - Um valor de {@link STRUCTURAL_MARKER}.
 * @param {string} params.entityId - O alvo do ato (mapa novo, atlas novo), UUID: a coluna é
 *   `entity_id UUID NOT NULL`.
 * @param {string|null} [params.mapId] - O mapa, quando o ato é de mapa.
 * @param {string|null} [params.userId] - Quem pediu, para a auditoria do log.
 * @param {Object} [params.data] - O resumo do que foi escrito fora do log.
 *
 *   A REGRA NÃO É "SEM CONTEÚDO DE USUÁRIO", e esta linha dizia isso enquanto um dos quatro
 *   chamadores já a contrariava: o marcador da DUPLICAÇÃO carrega os REGISTROS de camada do mapa
 *   novo (nome, estilo, ordem), porque `ensureMapLayers` as cria fora do log e sem eles o par não
 *   tem como materializá-las. Nome de camada é conteúdo de usuário, escrito por quem edita.
 *
 *   A regra que de fato vale, e que é a que se pode conferir: o payload não pode conter NADA além
 *   do que um leitor DESTE atlas já recebe no snapshot. É por isso que os três outros marcadores
 *   levam só contagens e identificadores (não precisam de mais), e é o que o leitor tem de checar
 *   ao acrescentar um campo, porque `GET /sync/:version` é gateado em `read` e entrega o log de
 *   operações inteiro a qualquer participante. Definição de recurso de catálogo continua FORA em
 *   qualquer caso: ela é a única coisa aqui cuja visibilidade varia por chamador dentro do mesmo
 *   atlas, e quem a poda na saída é outro mecanismo (`resource-payload.prune.js`).
 * @returns {Promise<Object|null>} A linha inserida (`RETURNING *`), ou null na colisão de op_id.
 */
export async function recordStructuralMarker(t, {
  atlasId, kind, entityId, mapId = null, userId = null, data = {},
}) {
  // oneOrNone, e não none: INSERT_OPERATION traz `RETURNING *` (mais um ON CONFLICT DO NOTHING
  // que pode não devolver linha), e o `none` do pg-promise rejeita assim que uma linha volta.
  return t.oneOrNone(INSERT_OPERATION, [
    atlasId,
    'update',
    kind,
    entityId,
    mapId,
    null,
    JSON.stringify({ kind, ...data }),
    Date.now(),
    `server-${kind}`,
    userId,
    randomUUID(),
    null,
    // `client_entity_type`: o NOME DO ATO, desde a decisão D6. Até 2026-09-13 era `map_merge`
    // para os quatro, para não entregar tipo desconhecido a um cliente anterior.
    kind,
    entityId,
    // `batch_id`: nulo. O marcador nasce no servidor, sem gesto de cliente por trás, e a
    // atomicidade dele é a da transação do ato que ele descreve.
    null,
  ]);
}
