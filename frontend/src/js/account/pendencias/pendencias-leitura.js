// Path: js/account/pendencias/pendencias-leitura.js

/**
 * @fileoverview As três leituras que o painel de pendências faz, e as duas coisas que elas NÃO
 * conseguem afirmar.
 *
 * SÃO TRÊS FONTES E NÃO UMA, pelas mesmas razões que a luz de sync tem cinco números
 * (`@js/session/pendencias-monitoramento.js`): a fila de saída do atlas montado guarda o que o
 * servidor recusou e o que está parado atrás disso; o registro global de quarentena guarda o que
 * uma sessão anterior pôs de lado e que sobreviveu ao logout; a fila de bytes de figura não tem
 * operação nenhuma, porque não existe op incremental de imagem, e por isso nunca aparece na fila.
 *
 * A QUARENTENA É LIDA MESMO EM ATLAS LOCAL, e as outras duas não. O registro é global por
 * construção (é o único lugar que nenhum expurgo de atlas alcança), então quem entrou na conta e
 * está num atlas local continua tendo trabalho guardado à espera de decisão, e esconder isso ali
 * seria esconder justamente a metade que sobrevive a tudo. A fila e os bytes são do escopo
 * montado: num atlas local não há para onde enviar, e perguntar custaria leitura de IndexedDB para
 * responder a uma pergunta que ninguém fez.
 *
 * O QUE ESTA LEITURA NÃO CONSEGUE AFIRMAR, declarado porque a ausência é indistinguível de
 * esquecimento. `listarPendenciasDeBlob` engole o próprio erro e devolve lista vazia
 * (`blob-upload-queue.js`), então uma falha de leitura da fila de figuras chega aqui como "não há
 * figura esperando", e este módulo não tem como distinguir as duas. As outras duas fontes
 * propagam, e é por isso que a falha delas vira `falhaDeLeitura` em vez de zero. Fechar esse
 * buraco é mudança no leitor de blobs, que pertence a outro dono.
 */

import { StoreScopeKind, getActiveScope } from '@store/atlas-namespace.js';
import { OperationQueue } from '@store/sync/operation-queue.js';
import { listQuarantinedOperations } from '@store/sync/quarantine-registry.js';
import { listarPendenciasDeBlob } from '@store/sync/blob-upload-queue.js';
import { mapResolver } from '@store/services/map-resolver.service.js';
import { isMapLocked } from '@store/map.operations.js';

/**
 * Tudo o que as três fontes têm agora, na forma que `montarPendencias` consome.
 *
 * TODAS AS FONTES CAEM JUNTAS numa falha, como no leitor da luz: uma lista parcial ao lado de uma
 * fonte muda é um censo que ninguém tomou, e o painel afirmaria por omissão que a parte não lida
 * está vazia.
 * @returns {Promise<{falhaDeLeitura: boolean, problemas: Array<Object>,
 *   quarentena: Array<Object>, uploads: Array<Object>}>}
 */
export async function lerPendencias() {
    const vazio = { problemas: [], quarentena: [], uploads: [] };
    try {
        const scope = getActiveScope();
        const remoto = scope?.kind === StoreScopeKind.REMOTE;
        const [problemas, quarentena, uploads] = await Promise.all([
            remoto ? new OperationQueue(scope).getProblems() : [],
            listQuarantinedOperations(),
            remoto ? listarPendenciasDeBlob() : [],
        ]);
        return { falhaDeLeitura: false, problemas, quarentena, uploads };
    } catch (error) {
        console.warn('[pendencias] não foi possível ler as pendências:', error);
        return { falhaDeLeitura: true, ...vazio };
    }
}

/**
 * O nome de um mapa, ou `null`.
 *
 * O resolvedor conhece os mapas do atlas MONTADO, então uma operação de quarentena preservada de
 * outro atlas resolve para `null` e a linha mostra o id. Isso é o desfecho correto: inventar um
 * nome a partir do mapa homônimo do atlas atual seria pior que mostrar o id.
 * @param {string} mapId - Id do mapa.
 * @returns {string|null}
 */
export function nomeDoMapa(mapId) {
    if (typeof mapId !== 'string' || mapId === '') return null;
    return mapResolver.getNameForId(mapId) ?? null;
}

/**
 * Quais dos mapas citados pelas linhas estão travados AGORA.
 *
 * PERGUNTA ASSÍNCRONA, DE PROPÓSITO. O conjunto em memória (`memoryStore.lockedMaps`) só é
 * completo em atlas de SERVIDOR e responde "destravado" para um mapa travado em atlas local, e
 * uma pendência é justamente sobre um mapa que pode não ser o corrente. `isMapLocked` lê o app
 * setting do disco, que é a resposta certa para outro mapa (ver `.claude/rules/architecture.md`,
 * seção Data Model).
 *
 * A trava é lida por NOME, como todo escritor dela; um mapa cujo nome não resolve é perguntado
 * pelo id, que é o que a chave de app setting terá se o mapa nunca foi registrado no resolvedor.
 * Uma leitura que falhe conta como DESTRAVADO: recusar o clique por causa de uma leitura que não
 * respondeu seria inventar um estado, e o servidor recusa a escrita de qualquer forma.
 * @param {Iterable<string>} mapIds - Ids de mapa citados pelas linhas.
 * @returns {Promise<Set<string>>} Os ids travados.
 */
export async function lerMapasTravados(mapIds) {
    const travados = new Set();
    for (const mapId of new Set(mapIds)) {
        if (typeof mapId !== 'string' || mapId === '') continue;
        try {
            if (await isMapLocked(nomeDoMapa(mapId) ?? mapId)) travados.add(mapId);
        } catch (error) {
            console.warn('[pendencias] não foi possível ler a trava de um mapa:', error);
        }
    }
    return travados;
}
