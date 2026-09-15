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
 *
 * O NOME DO MAPA É A QUARTA LEITURA, e ela é de DISCO por causa de um defeito medido. A tela lia o
 * nome só da tabela em memória (`mapResolver`), que é ZERADA e remontada a cada retrato do
 * servidor: logo depois de um F5 num atlas de servidor existe uma janela em que ela está vazia, e
 * a linha de conflito mostrava «6a54a5f6-8ffb-...» em vez de «Mapa Tático». Agora a memória é só
 * o atalho e o disco é a fonte, com o achado registrado de volta na memória para que a leitura
 * custe uma vez por mapa e por sessão, e não uma a cada batida do painel. A mesma tabela responde
 * as DUAS perguntas sobre mapa desta tela, o nome da linha e a trava do comando, porque enquanto
 * elas perguntavam a fontes diferentes uma podia estar certa e a outra errada ao mesmo tempo.
 */

import { StoreScopeKind, getActiveScope } from '@store/atlas-namespace.js';
import { OperationQueue } from '@store/sync/operation-queue.js';
import { listQuarantinedOperations } from '@store/sync/quarantine-registry.js';
import { listarPendenciasDeBlob } from '@store/sync/blob-upload-queue.js';
import { mapResolver } from '@store/services/map-resolver.service.js';
import { getRepository } from '@store/repositories/index.js';
import { isValidUUID } from '@utils/uuid.js';
import { isMapLocked } from '@store/map.operations.js';
import { mapIdsCitados } from './pendencias-rows.js';

/**
 * Tudo o que as três fontes têm agora, na forma que `montarPendencias` consome.
 *
 * TODAS AS FONTES CAEM JUNTAS numa falha, como no leitor da luz: uma lista parcial ao lado de uma
 * fonte muda é um censo que ninguém tomou, e o painel afirmaria por omissão que a parte não lida
 * está vazia.
 * O NOME DOS MAPAS CITADOS SAI JUNTO, e não depois: quem monta as linhas é função pura, então ela
 * recebe um resolvedor SÍNCRONO, e a única forma de um resolvedor síncrono conhecer o disco é o
 * disco ter sido lido antes. A busca acontece aqui porque este é o módulo que pode ler.
 * @returns {Promise<{falhaDeLeitura: boolean, problemas: Array<Object>,
 *   quarentena: Array<Object>, uploads: Array<Object>,
 *   nomeDoMapa: function(string): (string|null|undefined)}>}
 */
export async function lerPendencias() {
    const vazio = { problemas: [], quarentena: [], uploads: [], nomeDoMapa: () => undefined };
    try {
        const scope = getActiveScope();
        const remoto = scope?.kind === StoreScopeKind.REMOTE;
        const [problemas, quarentena, uploads] = await Promise.all([
            remoto ? new OperationQueue(scope).getProblems() : [],
            listQuarantinedOperations(),
            remoto ? listarPendenciasDeBlob() : [],
        ]);
        const nomes = await lerNomesDeMapa(mapIdsCitados({ problemas, quarentena }));
        return {
            falhaDeLeitura: false,
            problemas,
            quarentena,
            uploads,
            nomeDoMapa: (mapId) => nomes.get(mapId),
        };
    } catch (error) {
        console.warn('[pendencias] não foi possível ler as pendências:', error);
        return { falhaDeLeitura: true, ...vazio };
    }
}

/**
 * O nome de um mapa segundo a MEMÓRIA, ou `undefined` quando ela não sabe.
 *
 * Isto é o atalho, não a fonte: o resolvedor é uma tabela em memória que nasce no boot e é ZERADA
 * e remontada a cada retrato do servidor (`mapResolver.clear()` em `remote-operation-handler.js`),
 * de modo que existe uma janela, logo depois de um F5 num atlas de servidor, em que ele está
 * vazio e o mapa desenhado na tela não tem nome nenhum aqui. Foi essa janela que pôs um UUID na
 * linha de conflito, medida em 2026-09-15. Quem responde de verdade é {@link lerNomesDeMapa}.
 * @param {string} mapId - Id do mapa.
 * @returns {string|undefined}
 */
function nomeNaMemoria(mapId) {
    if (typeof mapId !== 'string' || mapId === '') return undefined;
    return mapResolver.getNameForId(mapId) ?? undefined;
}

/**
 * Os nomes dos mapas citados, lidos do DISCO quando a memória não sabe.
 *
 * TRÊS RESPOSTAS, e as duas vazias significam coisas opostas (ver o cabeçalho de
 * `pendencias-rows.js`): texto é o nome, `null` é "o atlas montado não tem este mapa" e a AUSÊNCIA
 * da chave é "não deu para saber". Por isso todo caminho de dúvida aqui apenas NÃO ESCREVE no mapa
 * de saída: uma leitura que falhou, ou que pode estar olhando para o disco no meio de uma troca,
 * não pode virar a afirmação de que o mapa foi removido.
 *
 * A LISTA DE CHAVES VEM ANTES DOS DOCUMENTOS, e é ela que autoriza a afirmação de ausência. Ler o
 * documento por chave e tratar o vazio como "não existe" produz uma MENTIRA medida em 2026-09-15:
 * o retrato do servidor prepara os bancos de dado sob uma geração e só grava o ponteiro dela no
 * fim, então logo depois de um F5 existe uma janela em que a fila (que não é por geração) já
 * responde e os mapas ainda não; nessa janela a tela dizia "num mapa removido" sobre um mapa que
 * estava desenhado atrás dela. Lista de chaves VAZIA é essa janela, e ali nada é afirmado.
 *
 * E a ausência só é afirmada quando TODA chave é um UUID, que é a forma do atlas de servidor.
 * Havendo chave que não é UUID (mapa guardado sob o NOME, forma legada), um documento pode existir
 * sob outra chave com o id dentro, e achá-lo exigiria a varredura completa de `getMap`, que lê
 * todos os documentos a cada batida de 3 s do painel. O preço da recusa é mostrar o id, que é o
 * que a tela já fazia.
 *
 * O ACHADO É REGISTRADO NA MEMÓRIA, que é o que mantém o custo em uma leitura por mapa e por
 * sessão, e não uma a cada batida. Não é invenção daqui: `local.repository.js` faz o mesmo na
 * varredura lenta dele, com o mesmo motivo escrito ao lado.
 * @param {string[]} mapIds - Ids de mapa citados pelas linhas.
 * @returns {Promise<Map<string, string|null>>} O que se soube de cada um.
 */
async function lerNomesDeMapa(mapIds) {
    const nomes = new Map();
    const desconhecidos = [];
    for (const mapId of mapIds) {
        const daMemoria = nomeNaMemoria(mapId);
        if (daMemoria) nomes.set(mapId, daMemoria);
        else desconhecidos.push(mapId);
    }
    if (desconhecidos.length === 0) return nomes;

    let chaves;
    try {
        chaves = await getRepository().getAllMapIds();
    } catch (error) {
        console.warn('[pendencias] não foi possível listar os mapas do atlas:', error);
        return nomes;
    }
    if (!Array.isArray(chaves) || chaves.length === 0) return nomes;

    const conhecidas = new Set(chaves);
    const todasSaoUuid = chaves.every((chave) => isValidUUID(chave));
    for (const mapId of desconhecidos) {
        if (!conhecidas.has(mapId)) {
            if (todasSaoUuid) nomes.set(mapId, null);
            continue;
        }
        try {
            const documento = await getRepository().getMapById(mapId);
            const nome = typeof documento?.name === 'string' && documento.name.trim() !== ''
                ? documento.name.trim()
                : null;
            if (!nome) continue;
            nomes.set(mapId, nome);
            mapResolver.registerMap(nome, mapId);
        } catch (error) {
            console.warn('[pendencias] não foi possível ler o nome de um mapa:', error);
        }
    }
    return nomes;
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
 * A TRAVA É LIDA POR NOME, como todo escritor dela, e é por isso que o resolvedor CHEGA DE FORA:
 * ele é o mesmo que nomeou os mapas das linhas, já com o disco lido. Enquanto esta função
 * perguntava sozinha à memória, ela herdava a mesma janela de resolvedor frio que punha o UUID na
 * tela, e aqui o preço é outro: a chave de app setting consultada é `mapLocked_<uuid>`, que não
 * existe, então um mapa TRAVADO responderia destravado e o comando seria desenhado clicável.
 * Um mapa cujo nome não resolve continua sendo perguntado pelo id, que é o que a chave terá se o
 * mapa nunca foi registrado. Uma leitura que falhe conta como DESTRAVADO: recusar o clique por
 * causa de uma leitura que não respondeu seria inventar um estado, e o servidor recusa a escrita
 * de qualquer forma.
 * @param {Iterable<string>} mapIds - Ids de mapa citados pelas linhas.
 * @param {function(string): (string|null|undefined)} [nomeDoMapa] - O resolvedor da leitura.
 * @returns {Promise<Set<string>>} Os ids travados.
 */
export async function lerMapasTravados(mapIds, nomeDoMapa = nomeNaMemoria) {
    const travados = new Set();
    const resolver = typeof nomeDoMapa === 'function' ? nomeDoMapa : nomeNaMemoria;
    for (const mapId of new Set(mapIds)) {
        if (typeof mapId !== 'string' || mapId === '') continue;
        try {
            if (await isMapLocked(resolver(mapId) || mapId)) travados.add(mapId);
        } catch (error) {
            console.warn('[pendencias] não foi possível ler a trava de um mapa:', error);
        }
    }
    return travados;
}
