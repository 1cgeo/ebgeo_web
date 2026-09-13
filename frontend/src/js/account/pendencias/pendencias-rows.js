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
 * O NOME DO MAPA ENTRA INJETADO e o da entidade sai do próprio envelope. O primeiro exige o
 * resolvedor da store (`mapResolver`), que este módulo não pode importar sem deixar de ser
 * testável em node; o segundo está no `data` da tentativa, que é o conteúdo local guardado, e é
 * exatamente o nome que a pessoa deu ao item. Quando nenhum dos dois resolve, o ID aparece, porque
 * um item sem identificação nenhuma é uma linha que a pessoa não consegue casar com nada na tela.
 */

// The queue's own classifier, imported and never copied: it is a zero-import leaf, so it costs
// nothing here, and a second copy of the rule would drift silently in the direction that hurts
// (a class the queue gains would keep its old meaning on this screen).
import { classifyIssue } from '@store/sync/issue-classes.js';
import {
    MOTIVO_DESCONHECIDO,
    PendenciaClasse,
    PendenciaOrigem,
    classeExplicacao,
    classeLabel,
    dataLabel,
    origemLabel,
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
 * O nome que a pessoa deu ao item, lido do conteúdo local da tentativa.
 * @param {Object|null|undefined} operation - Envelope da operação.
 * @returns {string|null}
 */
function nomeDaEntidade(operation) {
    const data = operation?.data;
    if (!data || typeof data !== 'object') return null;
    const candidatos = [data.name, data.nome, data.title, data.titulo, data.properties?.nome];
    for (const candidato of candidatos) {
        if (typeof candidato === 'string' && candidato.trim() !== '') return candidato.trim();
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
 * @param {function(string): (string|null)} entrada.nomeDoMapa - Resolvedor injetado.
 * @returns {Object} A linha.
 */
function linhaDeOperacao({
    operation, result, classe, origem, quandoMs, bloqueadaPor, atlasId, nomeDoMapa,
}) {
    const mapId = operation?.mapId ?? null;
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
        mapa: mapId === null ? null : { id: mapId, nome: nomeDoMapa(mapId) },
        motivo: result ? motivoDoResultado(result) : null,
        unidades: unidadesEmDisputa(result),
        quandoMs,
        quandoLabel: dataLabel(quandoMs),
        bloqueadaPor,
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
        quandoMs,
        quandoLabel: dataLabel(quandoMs),
        bloqueadaPor: null,
        atlasId: registro?.atlasId ?? null,
        operationId: null,
        envelope: registro ?? null,
        resultado: null,
    };
}

/**
 * A lista inteira, a partir do que as três fontes devolveram.
 *
 * @param {Object} leitura
 * @param {boolean} [leitura.falhaDeLeitura] - Alguma das fontes não respondeu.
 * @param {Array<Object>} [leitura.problemas] - Saída de `operationQueue.getProblems()`.
 * @param {Array<Object>} [leitura.quarentena] - Saída de `listQuarantinedOperations()`.
 * @param {Array<Object>} [leitura.uploads] - Saída de `listarPendenciasDeBlob()`.
 * @param {function(string): (string|null)} [leitura.nomeDoMapa] - Resolvedor de nome de mapa.
 * @returns {{estado: string, linhas: Array<Object>, contadores: Object<string, number>,
 *   total: number}}
 */
export function montarPendencias({
    falhaDeLeitura = false,
    problemas = [],
    quarentena = [],
    uploads = [],
    nomeDoMapa = () => null,
} = {}) {
    if (falhaDeLeitura === true) {
        return { estado: PendenciaEstado.FALHA, linhas: [], contadores: {}, total: 0 };
    }

    const resolver = typeof nomeDoMapa === 'function' ? nomeDoMapa : () => null;
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

    // MAIS RECENTE PRIMEIRO, e a linha sem data vai para o fim: ela é a que menos se casa com uma
    // lembrança da pessoa, então não pode ocupar a primeira posição da lista.
    linhas.sort((a, b) => (b.quandoMs ?? 0) - (a.quandoMs ?? 0));

    const contadores = {};
    for (const linha of linhas) {
        contadores[linha.classe] = (contadores[linha.classe] ?? 0) + 1;
    }

    return {
        estado: linhas.length === 0 ? PendenciaEstado.VAZIO : PendenciaEstado.LISTA,
        linhas,
        contadores,
        total: linhas.length,
    };
}
