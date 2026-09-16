// Path: js/session/pendencias-monitoramento.js

/**
 * @fileoverview UM LEITOR SÓ para a pergunta "há trabalho que este navegador ainda não
 * entregou?", nas duas telas que a fazem: o pulso de presença (que a responde sobre o
 * navegador INTEIRO, para o painel do administrador) e a luz de sync da barra do mapa (que a
 * responde sobre o atlas MONTADO).
 *
 * POR QUE UM SÓ, e por que isto vale um arquivo. As duas telas mediam por conta própria, e as
 * duas mediam coisas diferentes com o mesmo nome: a luz somava os baldes do censo da fila, o
 * pulso contava envelope cru no disco, e nenhum dos dois enxergava a quarentena nem os bytes de
 * figura que nunca subiram. O administrador via um número e o usuário via outro, sobre o mesmo
 * trabalho, e a divergência não tinha como aparecer, porque cada tela estava certa segundo a sua
 * própria conta. Um terceiro leitor teria produzido uma terceira conta (achado F23).
 *
 * O QUE ELE NÃO FAZ, declarado porque a ausência se lê como esquecimento: ele NUNCA monta um
 * escopo, nunca escreve e nunca apaga. `getStoreFor` endereça um banco sem mexer no ponteiro do
 * atlas ativo, e é isso que torna legítimo perguntar sobre atlas que esta aba não abriu. É
 * também por isso que ele só entra em serviço depois do portão de migração
 * (`runLegacyUpgradeGate`, em `ui/migration-recovery.js`): antes dele os bancos podem ainda ser
 * os da versão antiga.
 *
 * A PASSADA DE IDADE É CONDICIONAL, e essa é a única otimização aqui que não se adivinha. O
 * censo (`countByState`) já lê todo envelope do escopo; a idade precisa dos `timestamp`, o que é
 * uma segunda passada sobre a mesma coisa. Ela só acontece quando o censo achou alguma
 * pendência, de modo que o caso comum (navegador em dia) custa UMA passada, menos do que a
 * versão anterior deste arquivo custava sempre.
 *
 * DESCONHECIDO NÃO É ZERO, e é a propriedade que este módulo existe para preservar: leitura que
 * falha não vira contagem, e é a ausência do campo que o pulso manda ao servidor, para que o
 * painel diga "verificação indisponível" em vez de anunciar um navegador em dia.
 */

import {
    readLocalAtlasRegistry,
    getStoreFor,
    getActiveScope,
    remoteScope,
    StoreName,
    StoreScopeKind
} from '@store/atlas-namespace.js';
import { listRemoteAtlases } from '@store/remote-atlas.api.js';
import { OperationQueue, operationBelongsToScope } from '@store/sync/operation-queue.js';
import { listQuarantinedOperations } from '@store/sync/quarantine-registry.js';
import { listarPendenciasDeBlob, BlobUploadState } from '@store/sync/blob-upload-queue.js';
import { configurarPendenciasDePresenca } from '@js/session/presenca.js';

/** Uma varredura de todos os atlas por minuto basta para um pulso de trinta segundos. */
const CACHE_MS = 60000;

/**
 * Acima disto a varredura desiste e devolve DESCONHECIDO.
 *
 * Não é um limite de memória, é um limite de tempo: o pulso roda na thread da interface, e um
 * atlas com mais chaves que isto custaria segundos. Desistir devolvendo desconhecido é a
 * resposta honesta; devolver o que deu tempo de contar seria um número menor que o real com
 * cara de medição.
 */
const TETO_DE_CHAVES = 100000;

/** Um ano em ms: teto do que se relata como idade, contra relógio de máquina errado. */
const IDADE_MAXIMA_MS = 31536000000;

/**
 * O censo de UM escopo endereçado, mais a idade da pendência mais antiga quando há alguma.
 *
 * @param {{kind: string, dbSuffix: string}} scope - Escopo endereçado, montado ou não.
 * @param {number} agora - Instante de referência, para que os atlas de uma varredura compartilhem
 *   a mesma base e as idades sejam comparáveis entre si.
 * @returns {Promise<{pendentes: number, preparadas: number, problemas: number, total: number,
 *   idadePendenteMs: number}|null>} `null` quando o escopo é grande demais para ser medido.
 */
async function lerEscopo(scope, agora) {
    const store = getStoreFor(StoreName.OPERATION_QUEUE, scope);
    const chaves = (await store.keys()).filter(k => typeof k === 'string' && k.startsWith('op_'));
    if (chaves.length > TETO_DE_CHAVES) return null;

    const censo = await new OperationQueue(scope).countByState();
    const total = censo.pendentes + censo.preparadas + censo.problemas;
    if (total === 0) return { ...censo, total, idadePendenteMs: 0 };

    let primeiro = agora;
    for (let i = 0; i < chaves.length; i += 100) {
        const lote = await Promise.all(chaves.slice(i, i + 100).map(k => store.getItem(k)));
        for (const op of lote) {
            if (!op || !operationBelongsToScope(op, scope.dbSuffix)) continue;
            if (Number.isFinite(op.timestamp)) primeiro = Math.min(primeiro, op.timestamp);
        }
    }
    return {
        ...censo,
        total,
        idadePendenteMs: Math.min(IDADE_MAXIMA_MS, Math.max(0, agora - primeiro)),
    };
}

/**
 * O NÚMERO DO QUE ESTÁ A CAMINHO, definido num lugar só porque DUAS telas o mostram.
 *
 * A luz da barra escreve "Enviando N…" e o painel de pendências escreve "N alterações a caminho",
 * e enquanto cada uma somava os próprios baldes as duas podiam divergir sem que nada acusasse: é a
 * mesma família do achado F23, e foi assim que o painel chegou a dizer "Nenhuma pendência" com a
 * fila cheia (2026-09-15). Aqui a soma é UMA.
 *
 * `problemas` fica FORA: o que o servidor recusou não está a caminho de lugar nenhum, e é
 * justamente o que o painel lista como linha.
 *
 * DEVOLVE `null` E NUNCA ZERO quando o censo não é um censo, pela regra da casa: só o zero MEDIDO
 * autoriza as duas telas a dizerem que o servidor já tem tudo.
 * @param {{pendentes: number, preparadas: number}|null|undefined} censo - Saída de
 *   `countByState()`, ou de {@link lerPendenciasDoEscopoAtivo}, que a repete.
 * @returns {number|null}
 */
export function aCaminhoDoCenso(censo) {
    const partes = [censo?.pendentes, censo?.preparadas];
    if (!partes.every((n) => Number.isFinite(n) && n >= 0)) return null;
    return Math.trunc(partes[0]) + Math.trunc(partes[1]);
}

/**
 * TUDO o que o atlas MONTADO ainda não entregou, para a luz de sync da barra do mapa.
 *
 * São quatro fontes e não uma, e cada uma das três últimas era invisível com a fila em zero:
 * o censo da fila (trabalho comum, trabalho preso atrás de uma projeção e trabalho recusado), a
 * quarentena global (o que uma sessão anterior pôs de lado à espera de decisão, e que sobrevive
 * ao logout de propósito) e as pendências de upload de figura, que não têm operação incremental
 * nenhuma e por isso nunca aparecem na fila.
 *
 * ELE PROPAGA A FALHA em vez de devolver zeros: quem chama decide o que dizer, e a luz diz "sem
 * confirmação". Um `catch` aqui devolvendo zero seria o verde de volta.
 *
 * @returns {Promise<{pendentes: number, preparadas: number, problemas: number, quarentena: number,
 *   uploads: number, uploadsRecusados: number}|null>} `null` num atlas local ou sem escopo, onde
 *   não existe servidor de destino e a pergunta não se aplica.
 */
export async function lerPendenciasDoEscopoAtivo() {
    const scope = getActiveScope();
    if (scope?.kind !== StoreScopeKind.REMOTE) return null;

    const [censo, quarentena, blobs] = await Promise.all([
        new OperationQueue(scope).countByState(),
        listQuarantinedOperations(),
        listarPendenciasDeBlob(),
    ]);
    // ABERTA é pendente ou recusada em definitivo. A confirmada não conta, senão a luz ficaria
    // âmbar para sempre depois da primeira figura, e aviso permanente é aviso que se ignora.
    const abertas = blobs.filter(registro =>
        registro?.estado === BlobUploadState.PENDENTE
        || registro?.estado === BlobUploadState.RECUSADO);
    return {
        pendentes: censo.pendentes,
        preparadas: censo.preparadas,
        problemas: censo.problemas,
        quarentena: quarentena.length,
        uploads: abertas.length,
        uploadsRecusados: abertas
            .filter(registro => registro.estado === BlobUploadState.RECUSADO).length,
    };
}

/**
 * O TOTAL deste navegador, somado sobre todo atlas de servidor registrado, para o pulso de
 * presença.
 *
 * O RECORTE É "de servidor e ainda não descartado": atlas local não tem para onde enviar, e um
 * namespace já marcado para descarte é dívida que a pessoa aceitou perder. Um atlas cujo sufixo
 * aparece TAMBÉM no registro local é um resgate (`adoptRemoteAtlasAsLocal` move a reivindicação
 * entre registros sem mover um byte), e por isso é o registro local que decide: ele deixou de
 * ser dívida com o servidor.
 *
 * @param {number} [agora] - Injetável para teste.
 * @returns {Promise<{pendentes: number, idadePendenteMs: number}|{}>} O objeto VAZIO é o
 *   desconhecido, e é ele que faz o painel dizer "verificação indisponível" em vez de zero.
 */
export async function lerPendenciasDoNavegador(agora = Date.now()) {
    const locais = new Set((await readLocalAtlasRegistry()).map(e => e.dbSuffix));
    const remotos = (await listRemoteAtlases())
        .filter(e => !locais.has(e.dbSuffix) && !e.discardRequested);

    let pendentes = 0;
    let idadePendenteMs = 0;
    for (const atlas of remotos) {
        const medido = await lerEscopo(remoteScope(atlas.atlasId), agora);
        if (medido === null) return {};
        pendentes += medido.total;
        idadePendenteMs = Math.max(idadePendenteMs, medido.idadePendenteMs);
    }
    return { pendentes, idadePendenteMs: pendentes ? idadePendenteMs : 0 };
}

/**
 * Liga o leitor ao pulso de presença. Só depois do portão de migração, e nunca antes.
 *
 * O CACHE É DO INSTALADOR e não do leitor, porque quem precisa dele é o pulso (que bate a cada
 * trinta segundos sobre uma varredura de todos os atlas) e não a luz (que pergunta sobre um
 * atlas só e precisa da resposta de agora).
 * @returns {void}
 */
export function instalarMonitoramentoDePendencias() {
    let ultima = 0;
    let resultado = {};
    configurarPendenciasDePresenca(async () => {
        if (Date.now() - ultima < CACHE_MS) return resultado;
        ultima = Date.now();
        resultado = {};
        try {
            resultado = await lerPendenciasDoNavegador();
        } catch { /* Unknown is deliberately not zero. */ }
        return resultado;
    });
}
