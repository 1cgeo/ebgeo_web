// Path: js/account/pendencias/pendencias-acoes.js

/**
 * @fileoverview O que a pessoa pode MANDAR FAZER com uma pendência, e a regra de quando cada
 * comando aparece.
 *
 * A AFORDÂNCIA SEGUE A REGRA DA CASA, e ela tem dois lados que não se parecem. Bloqueio por POSTO
 * (o nível neste atlas não permite escrever) é permanente enquanto o papel for o que é, e não há
 * nada que a pessoa possa fazer daquela tela: o comando NÃO é desenhado. Bloqueio por ESTADO
 * (sem conexão, mapa travado) é reversível, e a pessoa pode ser justamente quem o reverte: o
 * comando É desenhado, o clique é RECUSADO e a frase nomeia o estado. A mesma assimetria vale para
 * a FORMA: uma dependência bloqueada não tem "Aceitar o servidor" porque ela não foi recusada por
 * ninguém, e um upload não tem "Reaplicar" porque não existe operação de imagem a recriar.
 * Ver `.claude/rules/architecture.md`, seção UI Architecture.
 *
 * "ACEITAR O SERVIDOR" LEVA OS DEPENDENTES JUNTO, E A PERGUNTA DIZ QUANTOS. A fila é ordenada e o
 * que vem depois de uma operação recusada da mesma entidade não sai enquanto ela estiver lá
 * (`PendingBlockade`, `operation-queue.js`), então descartar só a recusada deixaria os
 * dependentes soltos sobre um estado que nunca existiu. Quem já sabe quem depende de quem é o
 * próprio `getProblems`, que devolve `bloqueadaPor` para cada dependência: as linhas com
 * `bloqueadaPor` igual ao id desta são exatamente as que ela segura, porque aquele campo só muda
 * quando outra operação COM problema aparece.
 *
 * "REAPLICAR" NÃO REESCREVE O DOCUMENTO LOCAL, E ISSO É O LIMITE DESTA ENTREGA. Ela cria uma
 * operação NOVA (id novo, relógio novo) com o conteúdo local guardado na tentativa e com a base
 * que o SERVIDOR informou no recibo de conflito (`conflict.entityVersion`), que é a revisão contra
 * a qual a disputa foi julgada. A tentativa antiga fica onde está, com o problema dela, porque
 * apagá-la aqui perderia o conteúdo se a nova também for recusada. O que ela NÃO faz é reescrever
 * a projeção local: depois de um conflito o motor já fez `resync`, então a tela mostra o
 * documento do servidor, e trazer o conteúdo de volta para a tela exigiria o caminho de escrita de
 * CADA entidade, que é uma segunda cópia do roteador de `remote-operation-handler.js`. Em vez
 * disso, com conexão, ela empurra a fila e pede um `resync` DEPOIS: se o servidor aceitar, a tela
 * volta a mostrar o conteúdo reaplicado pela porta que já existe. Sem conexão, a tela continua
 * mostrando o do servidor até a fila sair, e a frase do toast diz isso em voz alta.
 *
 * AS DEPENDÊNCIAS SÃO INJETADAS porque as três primeiras funções escrevem em disco e chamam o
 * motor de sync: injetá-las é o que permite dirigir cada uma contra uma fila real de
 * `fake-indexeddb` sem subir motor nenhum.
 */

import { operationQueue } from '@store/sync/operation-queue.js';
import { createOperation } from '@store/sync/operation-factory.js';
import { syncEngine } from '@store/sync/sync-engine.js';
import { discardQuarantinedOperation } from '@store/sync/quarantine-registry.js';
import { confirmedVersionInProperties } from '@store/sync/confirmed-version.js';
import { hasDisputeUnits } from '@store/sync/dispute-units.js';
import { checkPermission } from '@store/sync/permission-guard.js';
import { deepClone } from '@utils/deep-utils.js';
import {
    PendenciaAcao,
    PendenciaBloqueio,
    PendenciaClasse,
    PendenciaOrigem,
    acaoDetalhe,
    acaoLabel,
    bloqueioFrase,
} from './pendencias-phrases.js';

/**
 * Tipo de entidade → a chave de `GuardAction` que o gate de escrita dela consulta.
 *
 * Ela reproduz o agrupamento de `permission-guard.js` e não o inventa: os seis sub-tipos de mapa,
 * a camada de catálogo e as entidades de 3D e 360 respondem à mesma autoridade do documento do
 * mapa no servidor, que é o que aquele arquivo declara por extenso. Tipo que não esteja aqui cai
 * em `UPDATE_MAP`, que também é EDIT: o ramo padrão erra para o lado de perguntar, nunca para o de
 * conceder.
 */
const GUARDA_POR_TIPO = Object.freeze({
    feature: 'UPDATE_FEATURE',
    layer: 'UPDATE_LAYER',
    group: 'UPDATE_GROUP',
    comment: 'UPDATE_COMMENT',
    briefing: 'UPDATE_BRIEFING',
    slide: 'UPDATE_BRIEFING',
    setting: 'UPDATE_ATLAS_SETTINGS',
});

/**
 * Se esta entidade tem contrato de mutação, que é o que faz uma base declarada valer alguma coisa.
 *
 * Sem contrato (`groupFeature` e `setting`), a operação nova não declararia base nenhuma e o
 * "reaplicar" seria um reenvio cego: o servidor a aplicaria por ordem de chegada, que é o
 * comportamento que o conflito existe para evitar.
 * @param {string} entityType - Tipo de entidade do sync.
 * @returns {boolean}
 */
export function temContratoDeMutacao(entityType) {
    return entityType === 'feature' || hasDisputeUnits(entityType);
}

/**
 * Se dá para reaplicar ESTA tentativa, olhando só a forma dela.
 *
 * Três exigências, e nenhuma é sobre o estado do mundo: ser uma disputa (uma recusa de política
 * não muda de desfecho por ser reenviada), estar na fila do atlas montado (a quarentena preservada
 * pode ser de um atlas que nem está aberto) e ser uma ATUALIZAÇÃO com conteúdo e com a revisão que
 * o servidor informou. Create e delete não têm patch por contrato, então não há base a declarar.
 * @param {Object} linha - Modelo de linha.
 * @returns {boolean}
 */
export function podeReaplicar(linha) {
    if (linha?.classe !== PendenciaClasse.CONFLITO) return false;
    if (linha?.origem !== PendenciaOrigem.FILA) return false;
    const envelope = linha.envelope;
    if (!envelope?.data || envelope.operationType !== 'update') return false;
    if (!temContratoDeMutacao(envelope.entityType)) return false;
    return Number.isSafeInteger(linha.resultado?.conflict?.entityVersion);
}

/**
 * Os comandos que UMA linha desenha, cada um com o bloqueio de estado que o espera.
 *
 * @param {Object} linha - Modelo de linha.
 * @param {Object} contexto
 * @param {boolean} contexto.online - Se há conexão com o servidor agora.
 * @param {function(string): boolean} [contexto.mapaTravado] - Se o mapa daquela linha está travado.
 * @param {function(string): {allowed: boolean, required?: string}} [contexto.permissao] - O gate de
 *   posto, por chave de `GuardAction`. Injetável para teste.
 * @returns {Array<{acao: string, label: string, detalhe: string, bloqueio: string|null,
 *   recusa: string|null}>}
 */
export function acoesDaLinha(linha, {
    online = false,
    mapaTravado = () => false,
    permissao = checkPermission,
} = {}) {
    const acoes = [];
    const push = (acao, bloqueio = null) => acoes.push({
        acao,
        label: acaoLabel(acao),
        detalhe: acaoDetalhe(acao),
        bloqueio,
        recusa: bloqueio ? bloqueioFrase(bloqueio) : null,
    });

    // EXPORTAR SEMPRE, e sem bloqueio nenhum: é a única ação que não muda nada e a única saída
    // para quem vai descartar. Escondê-la em qualquer ramo é o que faz "descartar" virar perda.
    push(PendenciaAcao.EXPORTAR);

    if (linha.classe === PendenciaClasse.UPLOAD_PENDENTE
        || linha.classe === PendenciaClasse.UPLOAD_RECUSADO) {
        // Uma figura não tem operação a descartar nem a reenviar por esta tela: a retomada é
        // automática na reconexão (`retomarBlobsPendentes`). A recusa de uma foto anexa sai
        // sozinha quando nenhuma entidade a cita mais (`recusasDeFotoSemCitacao`, desde
        // 2026-09-26); o "Descartar" para a foto ainda citada espera decisão do dono.
        return acoes;
    }

    if (linha.origem === PendenciaOrigem.QUARENTENA) {
        // O namespace de origem pode nem existir mais, então não há fila onde aceitar nem base
        // contra a qual reaplicar. O que resta é guardar ou esquecer.
        push(PendenciaAcao.DESCARTAR);
        return acoes;
    }

    if (linha.classe === PendenciaClasse.DEPENDENCIA) {
        // Ela não foi recusada: sai sozinha quando a da frente sair. Um "aceitar o servidor" aqui
        // descartaria trabalho que o servidor aceitaria.
        return acoes;
    }

    if (linha.classe === PendenciaClasse.REVISAO) {
        push(PendenciaAcao.DESCARTAR);
        return acoes;
    }

    push(PendenciaAcao.ACEITAR, online === true ? null : PendenciaBloqueio.OFFLINE);

    if (podeReaplicar(linha)) {
        const chave = GUARDA_POR_TIPO[linha.envelope.entityType] ?? 'UPDATE_MAP';
        // O POSTO SOME: sem nível para escrever, o comando não é desenhado, porque não há nada que
        // a pessoa possa fazer desta tela para mudar isso.
        if (permissao(chave)?.allowed === true) {
            const travado = linha.mapa?.id ? mapaTravado(linha.mapa.id) === true : false;
            push(PendenciaAcao.REAPLICAR, travado ? PendenciaBloqueio.MAPA_TRAVADO : null);
        }
    }
    return acoes;
}

/**
 * As tentativas que somem junto com esta, ela inclusive.
 *
 * NUMA PARTE RECUSADA O GRUPO É A PARTE INTEIRA, pela culpada. O servidor recusou a culpada e as
 * irmãs como uma coisa só (`batchFailedOperationId`, lido por `pendencias-rows.js` em
 * `recusadaJuntoCom`), e decidir uma sem as outras deixava 199 linhas para 199 cliques, cada uma
 * segurando as que vêm atrás. A culpada, qualquer irmã, e o que está parado atrás de qualquer uma
 * delas saem juntos, com a linha clicada primeiro.
 * @param {Object} linha - A linha alvo.
 * @param {Array<Object>} linhas - Todas as linhas do modelo.
 * @returns {string[]} Ids de operação.
 */
export function idsQueSaemJunto(linha, linhas = []) {
    const alvo = linha?.operationId;
    if (!alvo) return [];
    const mesmaOrigem = (outra) => outra.origem === linha.origem && (outra.atlasId ?? null) === (linha.atlasId ?? null);
    const culpada = linha.recusadaJuntoCom?.operationId
        ?? (linhas.some((outra) => mesmaOrigem(outra) && outra.recusadaJuntoCom?.operationId === alvo) ? alvo : null);

    const grupo = new Set([alvo]);
    if (culpada) {
        for (const outra of linhas) {
            if (!outra.operationId || !mesmaOrigem(outra)) continue;
            if (outra.operationId === culpada || outra.recusadaJuntoCom?.operationId === culpada) {
                grupo.add(outra.operationId);
            }
        }
    }
    // As recusas iguais da mesma ação (`mesmaAcao`, montado em `pendencias-rows.js`): sem lote,
    // não há culpada, e o grupo é a ação com o motivo.
    if (linha.mesmaAcao?.chave) {
        for (const outra of linhas) {
            if (outra.operationId && mesmaOrigem(outra) && outra.mesmaAcao?.chave === linha.mesmaAcao.chave) {
                grupo.add(outra.operationId);
            }
        }
    }
    const dependentes = linhas
        .filter((outra) => outra.operationId && !grupo.has(outra.operationId) && grupo.has(outra.bloqueadaPor))
        .map((outra) => outra.operationId);
    return [...grupo, ...dependentes];
}

/**
 * As linhas que "Exportar" leva a partir de uma linha: o grupo inteiro quando ela é de uma parte
 * recusada, a própria linha no resto.
 *
 * É O MESMO GRUPO QUE "ACEITAR O SERVIDOR" DESCARTA ({@link idsQueSaemJunto}), porque as duas ações
 * são as que a frase do grupo promete que valem para todos, e a pergunta de aceitar manda exportar
 * antes: exportar uma e descartar seiscentas perderia as outras quinhentas e noventa e nove.
 * @param {Object} linha - A linha alvo.
 * @param {Array<Object>} linhas - Todas as linhas do modelo.
 * @returns {Array<Object>}
 */
export function linhasParaExportar(linha, linhas = []) {
    const doGrupo = Boolean(linha?.recusadaJuntoCom) || linha?.levouJunto > 0 || Boolean(linha?.mesmaAcao);
    if (!doGrupo) return [linha];
    const ids = new Set(idsQueSaemJunto(linha, linhas));
    return linhas.filter((outra) => ids.has(outra.operationId));
}

/**
 * O documento JSON de exportação das tentativas escolhidas.
 *
 * Ele carrega o ENVELOPE inteiro e o resultado do servidor, não um resumo: quem exporta está
 * guardando conteúdo que vai sumir, e um resumo bonito perderia justamente o `data`, que é o
 * trabalho da pessoa. `deepClone` porque o modelo continua vivo na tela depois disto.
 * @param {Array<Object>} linhas - Linhas a exportar.
 * @param {number} [agora] - Injetável para teste.
 * @returns {Object} O documento.
 */
export function conteudoDeExportacao(linhas, agora = Date.now()) {
    return {
        formato: 'ebgeo-pendencias',
        versao: 1,
        exportadoEm: new Date(agora).toISOString(),
        tentativas: (linhas ?? []).map((linha) => ({
            classe: linha.classe,
            origem: linha.origem,
            atlasId: linha.atlasId ?? null,
            entidade: {
                tipo: linha.entidade?.tipo ?? null,
                id: linha.entidade?.id ?? null,
                nome: linha.entidade?.nome ?? null,
            },
            mapa: linha.mapa ? { id: linha.mapa.id, nome: linha.mapa.nome ?? null } : null,
            motivo: linha.motivo ?? null,
            unidades: (linha.unidades ?? []).map((unidade) => unidade.unidade),
            quandoMs: linha.quandoMs ?? null,
            envelope: linha.envelope ? deepClone(linha.envelope) : null,
            resultado: linha.resultado ? deepClone(linha.resultado) : null,
        })),
    };
}

/**
 * Descarta a tentativa e o que estava parado atrás dela, e pede o estado atual ao servidor.
 *
 * @param {Object} linha - A linha alvo.
 * @param {Array<Object>} linhas - Todas as linhas, para achar os dependentes.
 * @param {Object} [deps]
 * @param {Object} [deps.queue] - A fila de saída.
 * @param {Object} [deps.engine] - O motor de sync, para o `resync`.
 * @returns {Promise<{removidas: number, ressincronizou: boolean}>}
 */
export async function aceitarOServidor(linha, linhas, { queue = operationQueue, engine = syncEngine } = {}) {
    const ids = idsQueSaemJunto(linha, linhas);
    if (ids.length === 0) return { removidas: 0, ressincronizou: false };

    const removidas = await queue.dequeue(ids);
    // O RESYNC É O QUE FECHA A AÇÃO, e não um enfeite: a projeção local ainda é a que o servidor
    // recusou, e sem buscar o estado atual a tela continuaria mostrando o conteúdo cuja tentativa
    // a pessoa acabou de descartar. Ele é best-effort porque a remoção já aconteceu e é durável:
    // falhar aqui custa uma tela desatualizada até o próximo pull, não a decisão.
    let ressincronizou = false;
    try {
        await engine.resync();
        ressincronizou = true;
    } catch (error) {
        console.warn('[pendencias] o resync depois de aceitar o servidor falhou:', error);
    }
    return { removidas, ressincronizou };
}

/**
 * Esquece uma tentativa, sem pedir nada ao servidor.
 * @param {Object} linha - A linha alvo.
 * @param {Array<Object>} linhas - Todas as linhas, para achar os dependentes.
 * @param {Object} [deps]
 * @param {Object} [deps.queue] - A fila de saída.
 * @param {function(string, string): Promise<boolean>} [deps.esquecerQuarentena]
 * @returns {Promise<{removidas: number}>}
 */
export async function descartarTentativa(linha, linhas, {
    queue = operationQueue,
    esquecerQuarentena = discardQuarantinedOperation,
} = {}) {
    if (linha?.origem === PendenciaOrigem.QUARENTENA) {
        const foi = await esquecerQuarentena(linha.atlasId, linha.operationId);
        return { removidas: foi ? 1 : 0 };
    }
    const ids = idsQueSaemJunto(linha, linhas);
    if (ids.length === 0) return { removidas: 0 };
    return { removidas: await queue.dequeue(ids) };
}

/**
 * A base observada que a operação NOVA declara: o que o cliente tinha lido, recarimbado com a
 * revisão que o servidor informou ao recusar.
 *
 * É essa recarimbagem que faz a reaplicação valer alguma coisa. O `previousData` guardado descreve
 * o conteúdo que a pessoa viu; o `confirmedVersion` dele é a base VELHA, a que já perdeu. Trocar
 * só a revisão preserva o patch (as unidades que a pessoa de fato mexeu, calculadas contra o que
 * ela via) e declara a base contra a qual a disputa foi julgada, que é a mais nova que este
 * cliente pode PROVAR conhecer.
 * @param {Object} envelope - O envelope da tentativa.
 * @param {number} entityVersion - A revisão do recibo de conflito.
 * @returns {Object} O documento de base, clonado.
 */
export function baseReobservada(envelope, entityVersion) {
    const base = deepClone(envelope.previousData ?? {});
    if (confirmedVersionInProperties(envelope.entityType)) {
        base.properties = { ...(base.properties ?? {}), confirmedVersion: entityVersion };
        return base;
    }
    base.confirmedVersion = entityVersion;
    return base;
}

/**
 * Cria uma operação NOVA com o conteúdo local da tentativa e a base que o servidor informou.
 *
 * A ANTIGA FICA ONDE ESTÁ, com o problema dela. Removê-la aqui apagaria o conteúdo caso a nova
 * também seja recusada, e a fila já não a envia (o registro de problema a faz ser pulada), então
 * ela não atrapalha o envio da nova.
 * @param {Object} linha - A linha alvo, que precisa passar por {@link podeReaplicar}.
 * @param {Object} [deps]
 * @param {Object} [deps.queue] - A fila de saída.
 * @param {Function} [deps.criar] - A fábrica de operações.
 * @param {Object} [deps.engine] - O motor de sync.
 * @param {boolean} [deps.online] - Se há conexão agora.
 * @returns {Promise<{operacao: Object, enviou: boolean}>}
 */
export async function reaplicarComNovaBase(linha, {
    queue = operationQueue,
    criar = createOperation,
    engine = syncEngine,
    online = false,
} = {}) {
    if (!podeReaplicar(linha)) {
        throw new Error('Esta pendência não pode ser reaplicada.');
    }
    const envelope = linha.envelope;
    const base = baseReobservada(envelope, linha.resultado.conflict.entityVersion);
    const operacao = criar(
        envelope.entityType,
        envelope.operationType,
        envelope.entityId,
        envelope.mapId,
        deepClone(envelope.data),
        base,
    );
    await queue.enqueue(operacao);

    if (online !== true) return { operacao, enviou: false };
    try {
        await engine.flush();
        // O RESYNC VEM DEPOIS DO FLUSH, e é o que traz a reaplicação de volta para a tela: a
        // projeção local é a do servidor desde o `resync` que o conflito disparou, e a op de saída
        // não repinta nada por si. Best-effort: a operação já está na fila e é durável.
        await engine.resync();
        return { operacao, enviou: true };
    } catch (error) {
        console.warn('[pendencias] a reaplicação foi enfileirada, mas o envio falhou:', error);
        return { operacao, enviou: false };
    }
}
