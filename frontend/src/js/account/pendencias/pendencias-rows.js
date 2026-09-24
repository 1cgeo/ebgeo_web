// Path: js/account/pendencias/pendencias-rows.js

/**
 * @fileoverview As TRÊS leituras viram UMA lista de linhas, como função pura.
 *
 * POR QUE ISTO NÃO MORA NO PAINEL. A decisão do que cada linha diz é aritmética mais tradução:
 * qual classe, qual nome, qual motivo, quais unidades em disputa, quem bloqueia quem, e o que
 * ainda não pode ser afirmado. Nada disso precisa de DOM, e enquanto morar dentro de um construtor
 * de elementos só se verifica abrindo a tela, que é a camada que roda FORA do `npm test`.
 *
 * AS TRÊS FONTES NÃO TÊM A MESMA FORMA E NÃO PODEM SER UNIFICADAS NA ORIGEM. `getProblems`
 * devolve envelope de operação mais o ack guardado; `listQuarantinedOperations` devolve a mesma
 * coisa carimbada com o atlas de onde veio e com a data em que foi preservada; a fila de bytes de
 * figura não tem operação nenhuma, porque não existe op incremental de imagem. O que esta função
 * produz é o denominador comum: quem, onde, por quê, quando.
 *
 * A FALHA DE LEITURA É UM ESTADO, NUNCA UMA LISTA VAZIA, e essa é a única regra deste arquivo que
 * não é tradução. Lista vazia é uma AFIRMAÇÃO ("não há nada guardado"), e é a partir dela que a
 * pessoa decide sair da conta e perder o trabalho. Uma leitura que falhou não autoriza essa
 * afirmação, então `estado` tem três valores e não dois.
 *
 * O NOME DO MAPA ENTRA INJETADO e o da entidade sai do próprio envelope. O primeiro exige uma
 * leitura de disco (`pendencias-leitura.js`), que este módulo não pode fazer sem deixar de ser
 * testável em node; o segundo está no `data` da tentativa, que é o conteúdo local guardado, e é
 * exatamente o nome que a pessoa deu ao item. Quando o nome do ITEM não resolve, o id dele
 * aparece, porque uma linha sem identificação nenhuma é uma linha que a pessoa não casa com nada.
 *
 * O RESOLVEDOR DE MAPA TEM TRÊS RESPOSTAS, E DUAS DELAS SÃO VAZIAS POR MOTIVOS OPOSTOS: um nome
 * (texto), `null` para "o atlas montado foi lido e não tem este mapa" e `undefined` para "não deu
 * para saber". A distinção não é preciosismo, é o que separa dizer à pessoa que o mapa foi
 * removido de INVENTAR essa afirmação a partir de uma leitura que falhou. É a mesma regra do
 * `estado` desta função, em que lista vazia e falha de leitura também não se confundem, e é por
 * isso que o resolvedor padrão daqui é `() => undefined` e não `() => null`.
 */

// The queue's own classifier, imported and never copied: it is a zero-import leaf, so it costs
// nothing here, and a second copy of the rule would drift silently in the direction that hurts
// (a class the queue gains would keep its old meaning on this screen).
import { classifyIssue } from '@store/sync/issue-classes.js';
// Folha de zero imports, como as frases: a comparação é aritmética pura e roda em node.
import { compararFeicao } from './comparacao-de-conflito.js';
import {
    MOTIVO_DESCONHECIDO,
    PendenciaClasse,
    PendenciaOrigem,
    classeExplicacao,
    classeLabel,
    dataLabel,
    descricaoDoItem,
    origemLabel,
    paradaAtrasFrase,
    recusadaJuntoFrase,
    tipoDeEntidadeLabel,
    unidadeLabel,
} from './pendencias-phrases.js';

/** Estados possíveis da lista inteira. */
export const PendenciaEstado = Object.freeze({
    LISTA: 'lista',
    VAZIO: 'vazio',
    FALHA: 'falha',
});

/**
 * A ponte entre o vocabulário da FILA (`IssueClass`) e o desta tela.
 *
 * Ela existe num lugar só de propósito: os dois vocabulários têm três valores em comum e um
 * desencontro (a fila não conhece upload), e espelhar um no outro obrigaria a inventar valores
 * mortos de um dos lados. Uma classe que a fila ganhe depois deste build cai em RECUSA, que é o
 * ramo conservador: ela aparece, com o motivo cru do servidor, em vez de sumir da lista.
 * @param {string} classeDaFila - Valor de `IssueClass`.
 * @returns {string} Valor de `PendenciaClasse`.
 */
export function classeDeProblema(classeDaFila) {
    switch (classeDaFila) {
        case 'conflito': return PendenciaClasse.CONFLITO;
        case 'dependencia': return PendenciaClasse.DEPENDENCIA;
        case 'revisao': return PendenciaClasse.REVISAO;
        default: return PendenciaClasse.RECUSA;
    }
}

/**
 * O mapa que uma tentativa cita, lido num lugar só.
 *
 * Existe como função, e não como leitura solta, porque QUEM LÊ O DISCO precisa saber de antemão
 * quais mapas as linhas vão citar (`mapIdsCitados`), e as duas leituras têm de sair do mesmo
 * campo: o dia em que elas divergirem, a tabela de nomes será montada para um conjunto de mapas e
 * consultada para outro, e o sintoma será o id na tela outra vez.
 * @param {Object|null|undefined} operation - Envelope da operação.
 * @returns {string|null}
 */
function mapIdDaOperacao(operation) {
    const mapId = operation?.mapId;
    return typeof mapId === 'string' && mapId !== '' ? mapId : null;
}

/**
 * Os mapas que esta leitura vai citar, para que os nomes deles sejam buscados ANTES das linhas.
 *
 * Os registros de figura ficam de fora porque não carregam operação nenhuma, logo não citam mapa.
 * @param {Object} [leitura] - O que `lerPendencias` devolveu.
 * @param {Array<Object>} [leitura.problemas] - Saída de `operationQueue.getProblems()`.
 * @param {Array<Object>} [leitura.quarentena] - Saída de `listQuarantinedOperations()`.
 * @returns {string[]} Ids de mapa, sem repetição.
 */
export function mapIdsCitados({ problemas = [], quarentena = [] } = {}) {
    const ids = new Set();
    for (const entrada of [...problemas, ...quarentena]) {
        const mapId = mapIdDaOperacao(entrada?.operation);
        if (mapId) ids.add(mapId);
    }
    return [...ids];
}

/**
 * O nome que a pessoa deu ao item, lido do conteúdo local da tentativa.
 * @param {Object|null|undefined} operation - Envelope da operação.
 * @returns {string|null}
 */
function nomeDaEntidade(operation) {
    // Uma EXCLUSÃO não tem conteúdo (`data` nulo): o nome está no que foi excluído. Sem isto, as
    // mil linhas de uma exclusão em massa recusada mostravam mil ids.
    for (const data of [operation?.data, operation?.previousData]) {
        if (!data || typeof data !== 'object') continue;
        const candidatos = [data.name, data.nome, data.title, data.titulo, data.properties?.nome];
        for (const candidato of candidatos) {
            if (typeof candidato === 'string' && candidato.trim() !== '') return candidato.trim();
        }
    }
    return null;
}

/**
 * As unidades em disputa que o ack nomeia, traduzidas.
 *
 * Vem SÓ do objeto `conflict`: uma recusa de política não disputa unidade nenhuma, e derivar
 * unidades do `patch` da operação aqui mostraria o que a pessoa MEXEU, não o que o servidor
 * recusou, que são conjuntos diferentes e cuja diferença é justamente a informação útil.
 * @param {Object|null|undefined} result - O ack guardado.
 * @returns {Array<{unidade: string, label: string}>}
 */
function unidadesEmDisputa(result) {
    const fields = result?.conflict?.fields;
    if (!Array.isArray(fields)) return [];
    return fields
        .filter((campo) => typeof campo === 'string' && campo !== '')
        .map((campo) => ({ unidade: campo, label: unidadeLabel(campo) }));
}

/**
 * A comparação entre a cópia local e a do servidor, quando existem as duas metades.
 *
 * SÓ FEIÇÃO, e a restrição é de conteúdo e não de esforço: para as outras entidades o que difere já
 * está dito na lista de unidades em disputa, que é a linguagem do próprio servidor. A feição é a
 * única cujo conteúdo é geometria, e "a unidade `geometry` está em disputa" não diz se o item andou
 * meio metro ou meio quilômetro.
 *
 * O `serverData` VEM DO RECIBO DE CONFLITO, isto é, da linha VIVA lida pelo servidor
 * (`canonicalFeature`, `backend/src/modules/sync/feature-conflicts.js`), nunca do payload que este
 * cliente enviou: um par cujas duas metades viessem da mesma origem concordaria por construção.
 * @param {Object|null|undefined} operation - O envelope guardado.
 * @param {Object|null|undefined} result - O ack guardado.
 * @returns {Object|null}
 */
function comparacaoDaLinha(operation, result) {
    if (operation?.entityType !== 'feature') return null;
    return compararFeicao(operation.data, result?.conflict?.serverData ?? null);
}

/**
 * A frase do servidor, ou a declaração de que ele não deu nenhuma.
 * @param {Object|null|undefined} result - O ack guardado.
 * @returns {string}
 */
function motivoDoResultado(result) {
    const bruto = result?.reason ?? result?.message ?? result?.error;
    if (typeof bruto === 'string' && bruto.trim() !== '') return bruto.trim();
    return MOTIVO_DESCONHECIDO;
}

/**
 * Uma linha a partir de um envelope de operação, seja ele da fila ou da quarentena.
 * @param {Object} entrada
 * @param {Object} entrada.operation - O envelope.
 * @param {Object|null} entrada.result - O ack guardado, quando há.
 * @param {string} entrada.classe - Valor de {@link PendenciaClasse}.
 * @param {string} entrada.origem - Valor de `PendenciaOrigem`.
 * @param {number|null} entrada.quandoMs - Data a mostrar.
 * @param {string|null} entrada.bloqueadaPor - Id da operação da frente.
 * @param {string|null} entrada.atlasId - Atlas de origem, quando é de quarentena.
 * @param {function(string): (string|null|undefined)} entrada.nomeDoMapa - Resolvedor injetado, com
 *   as três respostas do cabeçalho: nome, `null` para ausente e `undefined` para desconhecido.
 * @returns {Object} A linha.
 */
function linhaDeOperacao({
    operation, result, classe, origem, quandoMs, bloqueadaPor, atlasId, nomeDoMapa,
}) {
    const mapId = mapIdDaOperacao(operation);
    const comparacao = comparacaoDaLinha(operation, result);
    const respostaDoMapa = mapId === null ? undefined : nomeDoMapa(mapId);
    const nomeResolvido = typeof respostaDoMapa === 'string' && respostaDoMapa.trim() !== ''
        ? respostaDoMapa.trim()
        : null;
    return {
        chave: `${origem}:${operation?.id ?? ''}`,
        origem,
        origemLabel: origemLabel(origem),
        classe,
        classeLabel: classeLabel(classe),
        classeExplicacao: classeExplicacao(classe),
        entidade: {
            tipo: operation?.entityType ?? null,
            tipoLabel: tipoDeEntidadeLabel(operation?.entityType),
            id: operation?.entityId ?? null,
            nome: nomeDaEntidade(operation),
        },
        operacao: operation?.operationType ?? null,
        mapa: mapId === null ? null : {
            id: mapId,
            nome: nomeResolvido,
            // `ausente` só é verdadeiro quando a leitura RESPONDEU que este mapa não está mais no
            // atlas montado. Leitura que falhou devolve `undefined` e cai aqui como falso, de modo
            // que a linha mostra o id em vez de afirmar uma remoção que ninguém viu.
            ausente: respostaDoMapa === null,
        },
        motivo: result ? motivoDoResultado(result) : null,
        unidades: unidadesEmDisputa(result),
        comparacao,
        // A AUSÊNCIA É UM ESTADO, e ela precisa ser dizível: um conflito de feição sem
        // `serverData` (servidor mais antigo que esta tela, id numa forma que a consulta não sabe
        // endereçar) não tem o outro lado do par, e desenhar só a metade local com cara de
        // comparação seria mostrar a cópia da pessoa duas vezes.
        comparacaoIndisponivel: comparacao === null
            && operation?.entityType === 'feature'
            && classe === PendenciaClasse.CONFLITO,
        quandoMs,
        quandoLabel: dataLabel(quandoMs),
        bloqueadaPor,
        // Preenchidos por `agruparRecusadasJunto`, que precisa da lista inteira para nomear a
        // OUTRA linha (a culpada, a da frente).
        bloqueio: null,
        recusadaJuntoCom: null,
        levouJunto: 0,
        mesmaAcao: null,
        atlasId,
        operationId: operation?.id ?? null,
        envelope: operation ?? null,
        resultado: result ?? null,
    };
}

/**
 * Uma linha a partir de um registro de bytes de figura.
 * @param {Object} registro - Registro de `blob-upload-queue.js`.
 * @returns {Object} A linha.
 */
function linhaDeUpload(registro) {
    const recusado = registro?.estado === 'recusado';
    const classe = recusado ? PendenciaClasse.UPLOAD_RECUSADO : PendenciaClasse.UPLOAD_PENDENTE;
    const quandoMs = registro?.atualizadoEm ?? registro?.criadoEm ?? null;
    return {
        chave: `${PendenciaOrigem.UPLOAD}:${registro?.tentativaId ?? registro?.imageId ?? ''}`,
        origem: PendenciaOrigem.UPLOAD,
        origemLabel: origemLabel(PendenciaOrigem.UPLOAD),
        classe,
        classeLabel: classeLabel(classe),
        classeExplicacao: classeExplicacao(classe),
        entidade: {
            tipo: 'imagem',
            tipoLabel: tipoDeEntidadeLabel('imagem'),
            id: registro?.imageId ?? null,
            nome: null,
        },
        operacao: null,
        mapa: null,
        motivo: typeof registro?.ultimoErro === 'string' && registro.ultimoErro !== ''
            ? registro.ultimoErro
            : null,
        unidades: [],
        // Bytes de figura não têm operação, logo não têm conflito nem par a comparar.
        comparacao: null,
        comparacaoIndisponivel: false,
        quandoMs,
        quandoLabel: dataLabel(quandoMs),
        bloqueadaPor: null,
        bloqueio: null,
        recusadaJuntoCom: null,
        levouJunto: 0,
        mesmaAcao: null,
        atlasId: registro?.atlasId ?? null,
        operationId: null,
        envelope: registro ?? null,
        resultado: null,
    };
}

/**
 * AS PARTES RECUSADAS: a irmã fala por ela mesma, e a culpada conta quantas levou junto.
 *
 * O servidor aplica ou recusa uma parte de uma ação inteira, e devolve TODAS as operações dela com
 * o motivo da que falhou e com `batchFailedOperationId` nomeando essa culpada (`recusarLoteInteiro`,
 * `backend/src/modules/sync/sync.service.js`). Mostrado em cada irmã, aquele motivo era falso:
 * medido em 2026-09-24, uma feição apagada pelo colega no meio de 1000 estilos pôs 199 linhas
 * "O item foi excluido no servidor." no painel, sobre feições que ninguém excluiu. A irmã vira
 * `PendenciaClasse.JUNTO` e o motivo dela nomeia a culpada; a culpada guarda o dela.
 *
 * O grupo é por ORIGEM e por atlas, porque a mesma operação pode estar na fila e numa quarentena
 * de outro atlas, e uma não decide a outra. Muta as linhas; devolve o que o resumo conta.
 * @param {Array<Object>} linhas - As linhas já montadas.
 * @returns {{recusadas: number, culpadas: number, paradas: number}}
 */
function agruparRecusadasJunto(linhas) {
    const chave = (linha, id) => `${linha.origem}|${linha.atlasId ?? ''}|${id}`;
    const porOperacao = new Map();
    for (const linha of linhas) {
        if (linha.operationId) porOperacao.set(chave(linha, linha.operationId), linha);
    }

    const culpadas = new Set();
    const noGrupo = new Set();
    let recusadas = 0;
    for (const linha of linhas) {
        const culpadaId = linha.resultado?.batchFailedOperationId;
        if (typeof culpadaId !== 'string' || culpadaId === '' || culpadaId === linha.operationId) continue;
        const culpada = porOperacao.get(chave(linha, culpadaId)) ?? null;
        const descricao = culpada ? descricaoDoItem(culpada.entidade, culpada.mapa) : null;
        linha.classe = PendenciaClasse.JUNTO;
        linha.classeLabel = classeLabel(PendenciaClasse.JUNTO);
        linha.classeExplicacao = classeExplicacao(PendenciaClasse.JUNTO);
        linha.recusadaJuntoCom = { operationId: culpadaId, descricao };
        linha.motivo = recusadaJuntoFrase(descricao);
        // As unidades e a comparação de um conflito são DA CULPADA: na irmã elas não existem.
        linha.unidades = [];
        if (culpada) culpada.levouJunto += 1;
        culpadas.add(chave(linha, culpadaId));
        noGrupo.add(chave(linha, culpadaId));
        noGrupo.add(chave(linha, linha.operationId));
        recusadas += 1;
    }

    let paradas = 0;
    for (const linha of linhas) {
        if (!linha.bloqueadaPor) continue;
        const frente = porOperacao.get(chave(linha, linha.bloqueadaPor)) ?? null;
        linha.bloqueio = paradaAtrasFrase(
            frente ? descricaoDoItem(frente.entidade, frente.mapa) : null,
            linha.bloqueadaPor,
        );
        if (noGrupo.has(chave(linha, linha.bloqueadaPor))) paradas += 1;
    }
    return { recusadas, culpadas: culpadas.size, paradas };
}

/**
 * AS RECUSAS IGUAIS DA MESMA AÇÃO viram um grupo: mesma origem, mesmo atlas, mesmo `traceId` (que
 * `runTransaction` cunha por transação) e o mesmo motivo.
 *
 * Sem lote não há `batchFailedOperationId`: as operações de excluir e estilizar em massa saem
 * independentes (decisão do dono de 2026-09-24), e um mapa travado ou um papel rebaixado no meio de
 * 1000 exclusões devolvia 1000 linhas e pedia 1000 cliques (achado da revisão). Só RECUSA entra, e só
 * da fila: um conflito é de cada feição, e a quarentena não tem "Aceitar o servidor". Muta as
 * linhas; devolve os grupos para o resumo, o maior primeiro.
 * @param {Array<Object>} linhas - As linhas já montadas.
 * @returns {Array<{total: number, motivo: string}>}
 */
function agruparMesmaAcao(linhas) {
    const grupos = new Map();
    for (const linha of linhas) {
        const traceId = linha.envelope?.traceId;
        if (linha.classe !== PendenciaClasse.RECUSA || linha.origem !== PendenciaOrigem.FILA) continue;
        if (typeof traceId !== 'string' || traceId === '' || typeof linha.motivo !== 'string') continue;
        const chave = `${linha.atlasId ?? ''}|${traceId}|${linha.motivo}`;
        if (!grupos.has(chave)) grupos.set(chave, []);
        grupos.get(chave).push(linha);
    }
    const resumo = [];
    for (const [chave, membros] of grupos) {
        if (membros.length < 2) continue;
        for (const linha of membros) linha.mesmaAcao = { chave, total: membros.length };
        resumo.push({ total: membros.length, motivo: membros[0].motivo });
    }
    return resumo.sort((a, b) => b.total - a.total);
}

/**
 * A contagem do que está a caminho, ou `null` quando ela NÃO é uma contagem.
 *
 * `null` é o produto principal e não o caso degenerado, pela mesma razão de `toPendingCount` em
 * `sync-phrases.js`: é ele que impede um `NaN` de escorregar para o ramo do zero e virar a
 * afirmação "nenhuma pendência", que é a frase a partir da qual alguém decide sair da conta.
 * Repare que `x ?? 0` NÃO serviria, porque não guarda `NaN`.
 * @param {*} valor - O que o leitor devolveu.
 * @returns {number|null}
 */
function contagemOuNula(valor) {
    if (!Number.isFinite(valor) || valor < 0) return null;
    return Math.trunc(valor);
}

/**
 * A lista inteira, a partir do que as fontes devolveram.
 *
 * A QUARTA LEITURA NÃO VIRA LINHA, E MESMO ASSIM VEM (2026-09-15). As três fontes de linha guardam
 * o que EXIGE DECISÃO; o que está a caminho não exige nenhuma e por isso não é linha (não há ação a
 * oferecer sobre uma alteração que sai sozinha). Mas o crachá que abre este painel CONTA esse
 * número, e enquanto ele não chegava aqui as duas telas liam a mesma fila e diziam coisas opostas:
 * "Enviando 2…" no crachá, "Nenhuma pendência" no painel. O número entra no modelo, sem linha, e a
 * frase dele mora em `pendencias-phrases.js`.
 *
 * @param {Object} leitura
 * @param {boolean} [leitura.falhaDeLeitura] - Alguma das fontes não respondeu.
 * @param {Array<Object>} [leitura.problemas] - Saída de `operationQueue.getProblems()`.
 * @param {Array<Object>} [leitura.quarentena] - Saída de `listQuarantinedOperations()`.
 * @param {Array<Object>} [leitura.uploads] - Saída de `listarPendenciasDeBlob()`.
 * @param {number|null} [leitura.aCaminho] - `pendentes + preparadas` do censo da fila, isto é, o
 *   MESMO número que o crachá mostra. `null` quando não há fila de saída no escopo (atlas local) ou
 *   quando o que chegou não é uma contagem, e nesse caso nada é afirmado sobre envio.
 * @param {function(string): (string|null|undefined)} [leitura.nomeDoMapa] - Resolvedor de nome de
 *   mapa. Sem ele, NADA é afirmado sobre mapa nenhum: o padrão é `undefined` (desconhecido) e
 *   nunca `null`, que diria a toda linha que o mapa dela foi removido.
 * @returns {{estado: string, linhas: Array<Object>, contadores: Object<string, number>,
 *   juntos: {recusadas: number, culpadas: number, paradas: number},
 *   mesmaAcao: Array<{total: number, motivo: string}>, total: number,
 *   aCaminho: number|null}}
 */
export function montarPendencias({
    falhaDeLeitura = false,
    problemas = [],
    quarentena = [],
    uploads = [],
    aCaminho = null,
    nomeDoMapa = () => undefined,
} = {}) {
    if (falhaDeLeitura === true) {
        // NADA É AFIRMADO NUMA FALHA, o número a caminho inclusive: as fontes caem juntas no leitor,
        // então um número sobrevivente aqui seria o censo de uma leitura que não aconteceu.
        return {
            estado: PendenciaEstado.FALHA, linhas: [], contadores: {}, total: 0, aCaminho: null,
            juntos: { recusadas: 0, culpadas: 0, paradas: 0 },
            mesmaAcao: [],
        };
    }

    const resolver = typeof nomeDoMapa === 'function' ? nomeDoMapa : () => undefined;
    const linhas = [];

    for (const problema of problemas) {
        if (!problema?.operation) continue;
        linhas.push(linhaDeOperacao({
            operation: problema.operation,
            result: problema.result ?? null,
            classe: classeDeProblema(problema.classe),
            origem: PendenciaOrigem.FILA,
            quandoMs: problema.recordedAt ?? problema.operation.timestamp ?? null,
            bloqueadaPor: problema.bloqueadaPor ?? null,
            atlasId: problema.operation.atlasId ?? null,
            nomeDoMapa: resolver,
        }));
    }

    for (const entrada of quarentena) {
        if (!entrada?.operation) continue;
        // A CLASSE DA QUARENTENA NÃO É "quarentena", e essa é a leitura que se faz errado. O
        // registro global preserva o ack ORIGINAL, então uma disputa preservada continua sendo uma
        // disputa: o que a preservação muda é ONDE ela está guardada, e isso viaja em `origem`.
        linhas.push(linhaDeOperacao({
            operation: entrada.operation,
            result: entrada.issue ?? null,
            classe: classeDeProblema(classifyIssue(entrada.issue)),
            origem: PendenciaOrigem.QUARENTENA,
            quandoMs: entrada.recordedAt ?? entrada.savedAt ?? null,
            bloqueadaPor: null,
            atlasId: entrada.atlasId ?? null,
            nomeDoMapa: resolver,
        }));
    }

    for (const registro of uploads) {
        if (!registro || registro.estado === 'confirmado') continue;
        linhas.push(linhaDeUpload(registro));
    }

    // ANTES da contagem, porque ele muda a classe das irmãs de uma parte recusada.
    const juntos = agruparRecusadasJunto(linhas);
    const mesmaAcao = agruparMesmaAcao(linhas);

    // MAIS RECENTE PRIMEIRO, e a linha sem data vai para o fim: ela é a que menos se casa com uma
    // lembrança da pessoa, então não pode ocupar a primeira posição da lista.
    linhas.sort((a, b) => (b.quandoMs ?? 0) - (a.quandoMs ?? 0));

    const contadores = {};
    for (const linha of linhas) {
        contadores[linha.classe] = (contadores[linha.classe] ?? 0) + 1;
    }

    return {
        // VAZIO É SOBRE A LISTA, e a lista é o que exige decisão: ele significa "nada a decidir",
        // nunca "nada esperando envio". Quem desenha a frase desse estado precisa de `aCaminho`.
        estado: linhas.length === 0 ? PendenciaEstado.VAZIO : PendenciaEstado.LISTA,
        linhas,
        contadores,
        juntos,
        mesmaAcao,
        total: linhas.length,
        aCaminho: contagemOuNula(aCaminho),
    };
}
