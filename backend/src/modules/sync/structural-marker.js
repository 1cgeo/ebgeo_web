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
// DUAS COLUNAS, DUAS AUDIÊNCIAS, E A INVERSÃO É DELIBERADA. `entity_type` guarda o nome HONESTO
// do ato (`map_duplicate`, `atlas_clone`, `atlas_import`), que é o que uma consulta de
// diagnóstico e a leitura do log precisam ver. `client_entity_type` guarda
// `MARCADOR_DE_RESYNC_DO_CLIENTE`, e é ele que `toFrontendOperation` publica como `entityType`,
// porque o cliente reconhece UMA palavra como "mudança estrutural por REST, tire um snapshot"
// (`STRUCTURAL_RESYNC_OPS`, em `frontend/src/js/store/sync/sync-engine.js`, hoje um conjunto de
// um elemento). Sem essa ponte o marcador chegaria ao cliente atual como tipo desconhecido, que
// ele apenas avisa uma vez e descarta: a versão avançaria e a convergência não aconteceria, que
// é metade do defeito de novo. Quando o cliente aprender os três nomes (metade dele do bloco
// B6), esta linha vira o nome honesto nos dois lados, num commit dos dois pacotes.
//
// O QUE O MARCADOR NÃO É: uma op aplicável. Nenhum dos quatro nomes está em `APPLIABLE_TARGETS`,
// então um cliente que EMPURRE um deles é recusado por operação antes do log, como qualquer tipo
// que este servidor não conhece.
import { randomUUID } from 'crypto';
import { INSERT_OPERATION } from './sync.queries.js';

/**
 * Os quatro atos estruturais que escrevem fora do log. Contrato compartilhado com o frontend
 * pela palavra abaixo, não por estes nomes.
 */
export const STRUCTURAL_MARKER = Object.freeze({
  MAP_MERGE: 'map_merge',
  MAP_DUPLICATE: 'map_duplicate',
  ATLAS_CLONE: 'atlas_clone',
  ATLAS_IMPORT: 'atlas_import',
});

/**
 * A palavra que o CLIENTE entende como "tire um snapshot". Ela é o `client_entity_type` dos
 * quatro marcadores, e é a única coisa deste arquivo que é contrato de fio.
 */
export const MARCADOR_DE_RESYNC_DO_CLIENTE = STRUCTURAL_MARKER.MAP_MERGE;

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
 * @param {Object} [params.data] - O resumo do que foi escrito fora do log. Sem conteúdo de
 *   usuário e sem nome de recurso: contagens e identificadores.
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
    MARCADOR_DE_RESYNC_DO_CLIENTE,
    entityId,
    // `batch_id`: nulo. O marcador nasce no servidor, sem gesto de cliente por trás, e a
    // atomicidade dele é a da transação do ato que ele descreve.
    null,
  ]);
}
