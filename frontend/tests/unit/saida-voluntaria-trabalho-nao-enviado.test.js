// Path: tests/unit/saida-voluntaria-trabalho-nao-enviado.test.js

/**
 * @fileoverview A saída da conta com trabalho que o servidor nunca recebeu.
 *
 * O DEFEITO QUE ESTE ARQUIVO PRENDE, medido antes de existir: clicar "Sair" chamava
 * `_handleLogout()` sem argumento; lá dentro a contagem da fila era literalmente
 * `involuntary ? await countPendingOperations() : 0`, e `shouldPreserveLocalWork` devolvia falso
 * de saída para todo caminho voluntário. O ramo que rodava anunciava a desmontagem, esvaziava o
 * atlas montado e destruía os namespaces remotos, e a destruição de namespace alcança a fila de
 * saída por desenho. A fila ia embora em silêncio.
 *
 * A PERGUNTA SAIU, E ISSO É DECISÃO DO DONO (2026-08-23). A primeira correção abria um diálogo de
 * três saídas; o dono a recusou com o argumento que decide o desenho: o sincronismo ocorre sempre,
 * logo a fila só tem conteúdo quando algo NÃO CONSEGUIU subir, nunca porque alguém escolheu não
 * subir. Não há vontade a respeitar, e oferecer a escolha apresentaria como decisão um estado que
 * ninguém decidiu. Os casos que exercitavam o diálogo saíram junto com ele: teste que sobrevive ao
 * último consumidor de produção não é cobertura, é camuflagem, e é ele que mantém o detector de
 * código morto convencido de que o símbolo está vivo.
 *
 * O QUE ESTE VERDE PROVARIA SE O CÓDIGO ESTIVESSE ERRADO. Cada caso tem controle negativo no
 * mesmo bloco, porque as duas metades da regra falham para lados opostos e uma sozinha não
 * distingue nada:
 *
 *   - "fila vazia não resgata" fica verde num guarda que NUNCA resgata, então todo caso que exige
 *     silêncio anda ao lado de um que exige o resgate;
 *   - "o trabalho foi preservado" tem dois caminhos até o mesmo `preserved: false` (a fila vazia e
 *     o resgate que falhou), que são fatos opostos, então os casos exigem também o `outcome`, que
 *     é o que viaja na URL;
 *   - "o resgate falhou" fica verde num código que nunca marca LOCAL, então o caso da falha exige
 *     que `markStoreLocal` NÃO tenha sido chamado E que o mesmo cenário sem a quebra chame.
 *
 * O ambiente é node: os módulos sob teste são folha (as frases não têm import nenhum) ou têm
 * dependências de store dubladas aqui, arquivo a arquivo.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
    ExitOutcome,
    toPendingCount,
    pendingOpsLabel,
    exitPreservedSummary,
    exitPreserveFailedNotice,
} from '@js/session/unsynced-work-phrases.js';

// ============================================================================
// Os dublês. Cada um é um ARQUIVO, nunca um barrel: é a mesma regra que faz o módulo sob teste
// ser importável de uma página que não boota a store.
//
// NÃO HÁ DUBLÊ DE MODAL, e a ausência é asserida mais abaixo: com a pergunta fora, o módulo
// deixou de importar `@modals/confirm.modal.js`, o que é a metade estrutural da decisão.
// ============================================================================

const origem = vi.hoisted(() => ({
    markStoreLocal: vi.fn(async () => {}),
    loadStoreOrigin: vi.fn(async () => ({ kind: 'remote', atlasId: null })),
}));
vi.mock('@store/store-origin.js', () => ({
    markStoreLocal: origem.markStoreLocal,
    loadStoreOrigin: origem.loadStoreOrigin,
    StoreOriginKind: Object.freeze({ LOCAL: 'local', REMOTE: 'remote' }),
}));

const local = vi.hoisted(() => ({ adoptRemoteAtlasAsLocal: vi.fn(async () => {}) }));
vi.mock('@store/local-atlas.api.js', () => ({
    adoptRemoteAtlasAsLocal: local.adoptRemoteAtlasAsLocal,
}));

const ns = vi.hoisted(() => ({
    registro: [],
    /** Os bancos de fila, por sufixo de escopo: { sufixo: Map<chave, op> }. */
    filas: new Map(),
    /** Todo escopo que `getStoreFor` recebeu, para provar QUAL banco foi lido. */
    lidos: [],
    /** IndexedDB indisponível: a leitura da fila lança em vez de responder. */
    leituraQuebrada: false,
}));
vi.mock('@store/atlas-namespace.js', () => ({
    remoteScope: (atlasId) => ({ kind: 'remote', atlasId, dbSuffix: `remote-${atlasId}` }),
    readLocalAtlasRegistry: async () => ns.registro,
    StoreName: Object.freeze({ OPERATION_QUEUE: 'operationQueue' }),
    getStoreFor: (storeId, scope) => {
        ns.lidos.push({ storeId, dbSuffix: scope.dbSuffix });
        const banco = ns.filas.get(scope.dbSuffix) ?? new Map();
        return {
            keys: async () => {
                if (ns.leituraQuebrada) throw new Error('IndexedDB indisponível');
                return [...banco.keys()];
            },
            getItem: async (k) => (banco.has(k) ? banco.get(k) : null),
        };
    },
}));

const veto = vi.hoisted(() => ({
    retainRemoteAtlasForRescue: vi.fn(async () => true),
    releaseRemoteAtlasRescueVeto: vi.fn(),
    since: 0,
}));
vi.mock('@store/remote-atlas.api.js', () => ({
    retainRemoteAtlasForRescue: veto.retainRemoteAtlasForRescue,
    releaseRemoteAtlasRescueVeto: veto.releaseRemoteAtlasRescueVeto,
    remoteAtlasRescueVetoSince: () => veto.since,
}));

const fila = vi.hoisted(() => ({ count: vi.fn(async () => 0) }));
vi.mock('@store/sync/operation-queue.js', () => ({
    operationQueue: { count: fila.count },
    // O predicado REAL da fila, reimplementado aqui só porque o módulo inteiro está dublado: a
    // regra é "op sem carimbo conta para todo escopo; com carimbo, só para o dela".
    operationBelongsToScope: (op, sufixo) => {
        if (sufixo === null) return true;
        const nascida = op?.scopeSuffix;
        if (nascida === null || nascida === undefined) return true;
        return nascida === sufixo;
    },
}));

const ATLAS = '11111111-1111-4111-8111-111111111111';
const SUFIXO = `remote-${ATLAS}`;

/**
 * Semeia N operações no banco de fila do atlas de servidor.
 * @param {number} quantas
 * @param {string} [sufixo] - Carimbo de escopo da op (o de OUTRO atlas não deve ser contado).
 */
function semearFila(quantas, sufixo = SUFIXO) {
    const banco = ns.filas.get(SUFIXO) ?? new Map();
    for (let i = 0; i < quantas; i += 1) {
        banco.set(`op_${1000 + i}_id-${sufixo}-${i}`, { id: `id-${i}`, scopeSuffix: sufixo });
    }
    ns.filas.set(SUFIXO, banco);
}

/** @returns {Promise<Object>} O módulo de saída, recarregado com os dublês zerados. */
async function carregarSaida() {
    return import('@js/session/unsynced-work-exit.js');
}

/** @returns {Promise<string>} O texto-fonte de um arquivo do app, para asserção estrutural. */
async function fonteDe(caminhoRelativo) {
    const { readFileSync } = await import('node:fs');
    return readFileSync(new URL(caminhoRelativo, import.meta.url), 'utf-8');
}

beforeEach(() => {
    vi.clearAllMocks();
    origem.loadStoreOrigin.mockResolvedValue({ kind: 'remote', atlasId: ATLAS });
    local.adoptRemoteAtlasAsLocal.mockResolvedValue(undefined);
    veto.retainRemoteAtlasForRescue.mockResolvedValue(true);
    veto.since = 0;
    ns.registro = [];
    ns.filas = new Map();
    ns.lidos = [];
    ns.leituraQuebrada = false;
    fila.count.mockResolvedValue(0);
});

// ============================================================================
// 1. A aritmética da decisão
// ============================================================================

describe('a contagem pendente, e o que é desconhecido', () => {
    // A direção do erro importa: contagem que não se pôde medir tem que se comportar como "há
    // trabalho", senão a saída destrói com base numa medição que acabou de quebrar.
    it('desconhecido NÃO é zero, e as quatro coerções que valem 0 caem no desconhecido', () => {
        // `null`, `''`, `[]` e `false` são os quatro que `Number()` transforma em 0, ou seja, as
        // quatro maneiras de dizer "não sei" que uma coerção crua leria como "fila vazia".
        for (const ruim of [NaN, undefined, null, Infinity, -1, 'muitas', {}, '', [], false]) {
            expect(Number.isNaN(toPendingCount(ruim)), `entrada ${String(ruim)}`).toBe(true);
        }
        // CONTROLE NEGATIVO: o zero de verdade continua sendo zero, senão o laço acima estaria
        // provado por uma função que chama tudo de desconhecido.
        expect(toPendingCount(0)).toBe(0);
        expect(toPendingCount('12')).toBe(12);
        expect(toPendingCount(3.7)).toBe(3);
    });
});

// ============================================================================
// 2. O texto, que é onde o número precisa aparecer
// ============================================================================

describe('as frases carregam a QUANTIDADE', () => {
    it('singular e plural, e contagens diferentes produzem textos diferentes', () => {
        expect(pendingOpsLabel(1)).toBe('1 operação');
        expect(pendingOpsLabel(47)).toBe('47 operações');
        // CONTROLE NEGATIVO: uma frase fixa ("você tem trabalho não enviado") passaria em qualquer
        // asserção escrita sem número, e é o texto sem número que este arquivo existe para impedir.
        expect(pendingOpsLabel(47)).not.toBe(pendingOpsLabel(1));
    });

    it('desconhecido não inventa número, e não diz zero', () => {
        expect(pendingOpsLabel(NaN)).toBe('um número desconhecido de operações');
        // CONTROLE NEGATIVO: a frase de desconhecido não pode conter "0", que é a leitura errada
        // que a ausência de medição induz.
        expect(pendingOpsLabel(NaN)).not.toMatch(/\b0\b/);
    });

    it('o aviso de preservação FALHA não promete resgate, e distingue as duas falhas', () => {
        const comVeto = exitPreserveFailedNotice({ retained: true });
        const semVeto = exitPreserveFailedNotice({ retained: false });

        expect(comVeto).toContain('NÃO foi possível guardar');
        expect(semVeto).toContain('NÃO foi possível guardar');
        expect(comVeto).toContain('tempo limitado');
        expect(semVeto).toContain('Não feche esta aba');
        // CONTROLE NEGATIVO: uma frase fixa para os dois casos estaria errada num deles.
        expect(comVeto).not.toBe(semVeto);
        // E nenhuma das duas pode se parecer com a frase de sucesso.
        expect(comVeto).not.toContain('ficou neste computador');
        expect(semVeto).not.toContain('ficou neste computador');
        expect(exitPreservedSummary('Operação Alfa')).toContain('ficou neste computador');
        expect(exitPreservedSummary('Operação Alfa')).toContain('Operação Alfa');
    });
});

// ============================================================================
// 3. A fiação: quem resgata, quando, e o que o chamador fica sabendo
// ============================================================================

describe('preserveUnsyncedWorkOnLostSession', () => {
    it('ZERO operações: não resgata nada, e o desfecho é "nada"', async () => {
        const saida = await carregarSaida();
        semearFila(0);

        const r = await saida.preserveUnsyncedWorkOnLostSession({ atlasId: ATLAS, atlasName: 'Alfa' });

        expect(local.adoptRemoteAtlasAsLocal).not.toHaveBeenCalled();
        expect(r.preserved).toBe(false);
        expect(r.outcome).toBe(ExitOutcome.NADA);
        expect(r.message).toBe(null);

        // CONTROLE NEGATIVO, no mesmo caso: com UMA operação o mesmo caminho resgata. Sem esta
        // metade, "não resgatou" é indistinguível de um guarda que nunca resgata, que é
        // exatamente o estado anterior do código no caminho voluntário.
        ns.registro = [{ dbSuffix: SUFIXO }];
        semearFila(1);
        const r2 = await saida.preserveUnsyncedWorkOnLostSession({ atlasId: ATLAS });
        expect(local.adoptRemoteAtlasAsLocal).toHaveBeenCalledTimes(1);
        expect(r2.outcome).toBe(ExitOutcome.GUARDADO);
    });

    // A CONTAGEM LÊ O BANCO DO ATLAS, E NÃO MONTA NADA. Montar é o que `activateScope` faz, e ele
    // tem quatro donos autorizados (`tests/unit/portao-de-montagem.test.js`) dos quais este módulo
    // não é um: a primeira versão apontava a fábrica para o atlas e o portão reprovou.
    it('a contagem endereça o banco de fila DAQUELE atlas, e ignora op de outro escopo', async () => {
        const saida = await carregarSaida();
        ns.registro = [{ dbSuffix: SUFIXO }];
        semearFila(2);                       // do próprio atlas
        semearFila(5, 'remote-outro-atlas'); // carimbadas para outro escopo, no mesmo banco

        const r = await saida.preserveUnsyncedWorkOnLostSession({ atlasId: ATLAS });

        expect(r.pendingOps).toBe(2);
        expect(ns.lidos.map(l => l.dbSuffix)).toContain(SUFIXO);
        expect(ns.lidos.every(l => l.storeId === 'operationQueue')).toBe(true);
        // CONTROLE NEGATIVO: sem o filtro de escopo a contagem seria 7, e sem leitura nenhuma
        // seria 0. Os dois defeitos produzem números diferentes deste.
        expect(r.pendingOps).not.toBe(7);
        expect(r.pendingOps).not.toBe(0);
    });

    // O ESPELHO DO PREFIXO. `operation-queue.js` não exporta `KEY_PREFIX`, então a contagem por
    // atlas nomeado carrega uma cópia. Um desalinhamento faz TODA contagem voltar 0, que é
    // exatamente a resposta que autoriza a destruição sem resgate: a direção perigosa.
    it('o prefixo de chave da fila continua sendo o que a fila escreve', async () => {
        const filaFonte = await fonteDe('../../src/js/store/sync/operation-queue.js');
        const saidaFonte = await fonteDe('../../src/js/session/unsynced-work-exit.js');

        const daFila = filaFonte.match(/const KEY_PREFIX = '([^']+)'/);
        const daSaida = saidaFonte.match(/const QUEUE_KEY_PREFIX = '([^']+)'/);
        // Cobertura vazia: uma regex que não casa deixaria a comparação abaixo comparar dois
        // `undefined` e passar verde com os dois lados ausentes.
        expect(daFila?.[1]).toBeTruthy();
        expect(daSaida?.[1]).toBeTruthy();
        expect(daSaida[1]).toBe(daFila[1]);
    });

    it('SUCESSO: adota o namespace, marca LOCAL, solta o veto e relata o resgate', async () => {
        const saida = await carregarSaida();
        semearFila(5);
        // A releitura DO DISCO é o que separa "não lançou" de "ficou gravado".
        ns.registro = [{ dbSuffix: SUFIXO }];

        const r = await saida.preserveUnsyncedWorkOnLostSession({
            atlasId: ATLAS, atlasName: 'Operação Alfa',
        });

        expect(local.adoptRemoteAtlasAsLocal).toHaveBeenCalledWith(ATLAS, 'Operação Alfa');
        expect(origem.markStoreLocal).toHaveBeenCalledTimes(1);
        expect(veto.releaseRemoteAtlasRescueVeto).toHaveBeenCalledWith(ATLAS);
        expect(r.preserved).toBe(true);
        expect(r.outcome).toBe(ExitOutcome.GUARDADO);
        expect(r.message).toContain('Operação Alfa');
    });

    // O CASO QUE MAIS IMPORTA. Ele tem DOIS caminhos até o falso, e os dois têm que terminar
    // igual, senão o que se prova é só o mais fácil de acertar.
    it.each([
        ['a adoção lança', () => { local.adoptRemoteAtlasAsLocal.mockRejectedValue(new Error('QuotaExceeded')); }],
        ['a releitura do disco não acha o slot', () => { ns.registro = []; }],
    ])('FALHA (%s): não marca LOCAL, veta a destruição e não promete resgate', async (_nome, quebrar) => {
        const saida = await carregarSaida();
        semearFila(9);
        ns.registro = [{ dbSuffix: SUFIXO }];
        vi.spyOn(console, 'error').mockImplementation(() => {});
        quebrar();

        const r = await saida.preserveUnsyncedWorkOnLostSession({
            atlasId: ATLAS, atlasName: 'Operação Alfa',
        });

        expect(r.preserved).toBe(false);
        // O DESFECHO SEPARA ESTA FALHA DA FILA VAZIA, que também chega com `preserved: false` e é
        // o fato oposto. É este valor que viaja na URL até o mapa.
        expect(r.outcome).toBe(ExitOutcome.FALHOU);
        // NÃO MARCAR LOCAL é a metade que impede a pior combinação possível: marcador dizendo
        // LOCAL sobre um namespace que nenhum atlas local reivindica, que a varredura seguinte
        // apaga enquanto o usuário lê que o trabalho ficou salvo.
        expect(origem.markStoreLocal).not.toHaveBeenCalled();
        expect(veto.retainRemoteAtlasForRescue).toHaveBeenCalledWith(ATLAS);
        expect(r.message).toContain('NÃO foi possível guardar');
        expect(r.message).not.toContain('ficou neste computador');
        // CONTROLE NEGATIVO: o mesmo cenário SEM a quebra chega ao estado oposto em todos os
        // pontos, o que prova que o vermelho acima vem da falha e não do arranjo do teste.
        vi.clearAllMocks();
        local.adoptRemoteAtlasAsLocal.mockResolvedValue(undefined);
        ns.registro = [{ dbSuffix: SUFIXO }];
        const ok = await saida.preserveUnsyncedWorkOnLostSession({ atlasId: ATLAS });
        expect(ok.preserved).toBe(true);
        expect(ok.outcome).toBe(ExitOutcome.GUARDADO);
        expect(origem.markStoreLocal).toHaveBeenCalledTimes(1);
    });

    it('a falha SEM veto gravado manda não fechar a aba; COM veto, não manda', async () => {
        const saida = await carregarSaida();
        semearFila(2);
        ns.registro = [];
        vi.spyOn(console, 'error').mockImplementation(() => {});

        veto.since = 0;
        const sem = await saida.preserveUnsyncedWorkOnLostSession({ atlasId: ATLAS });
        veto.since = Date.now();
        const com = await saida.preserveUnsyncedWorkOnLostSession({ atlasId: ATLAS });

        expect(sem.message).toContain('Não feche esta aba');
        expect(com.message).toContain('tempo limitado');
        expect(com.message).not.toBe(sem.message);
    });

    it('sem atlas de servidor montado não há o que perder', async () => {
        const saida = await carregarSaida();
        origem.loadStoreOrigin.mockResolvedValue({ kind: 'local', atlasId: null });
        semearFila(12);   // haveria fila, mas nenhum atlas de servidor está montado

        const r = await saida.preserveUnsyncedWorkOnLostSession();

        expect(local.adoptRemoteAtlasAsLocal).not.toHaveBeenCalled();
        expect(r.atlasId).toBe(null);
        expect(r.outcome).toBe(ExitOutcome.NADA);
        // CONTROLE NEGATIVO: com a origem REMOTA o mesmo caminho, sem argumento nenhum, encontra
        // o atlas pelo marcador de origem e resgata.
        ns.registro = [{ dbSuffix: SUFIXO }];
        origem.loadStoreOrigin.mockResolvedValue({ kind: 'remote', atlasId: ATLAS });
        const r2 = await saida.preserveUnsyncedWorkOnLostSession();
        expect(r2.atlasId).toBe(ATLAS);
        expect(local.adoptRemoteAtlasAsLocal).toHaveBeenCalledTimes(1);
    });

    it('a contagem que quebra vira desconhecida e RESGATA, em vez de destruir calada', async () => {
        const saida = await carregarSaida();
        ns.leituraQuebrada = true;
        ns.registro = [{ dbSuffix: SUFIXO }];
        vi.spyOn(console, 'warn').mockImplementation(() => {});

        const r = await saida.preserveUnsyncedWorkOnLostSession({ atlasId: ATLAS });

        expect(Number.isNaN(r.pendingOps)).toBe(true);
        expect(local.adoptRemoteAtlasAsLocal).toHaveBeenCalledTimes(1);
        expect(r.preserved).toBe(true);
        expect(r.outcome).toBe(ExitOutcome.GUARDADO);
    });
});

// ============================================================================
// 4. O SÍTIO DE CHAMADA, que é a metade que costuma faltar
//
// Um guarda correto e NÃO LIGADO tem exatamente o mesmo verde de um guarda ligado, e foi
// literalmente esse o defeito: `preserveUnsyncedWorkAsLocal` existia, era testada e estava
// pendurada só no caminho involuntário. A asserção é sobre o TEXTO do controle porque o botão vive
// dentro de um `IControl` do MapLibre, que não instancia em node; o precedente é
// `tests/integration/tab-lock-atlas-integration.test.js`, que lê o corpo de `_handleLogout` pelo
// mesmo motivo. O alcance é honesto: prova que a fiação existe, nunca que ela se comporta.
// ============================================================================

describe('o clique em "Sair" passa pelo guarda', () => {
    it('o botão liga no gesto, e o gesto consulta a fila antes de desmontar', async () => {
        const fonte = await fonteDe('../../src/js/account/account.control.js');

        expect(fonte).toContain("this._logoutBtn, 'click', () => this._handleLogoutGesture()");
        // CONTROLE NEGATIVO: a ligação ANTIGA, que era o defeito, não pode ter sobrado em lugar
        // nenhum. Sem esta linha, um segundo `addDomListener` esquecido passaria despercebido.
        expect(fonte).not.toContain("'click', () => this._handleLogout()");

        const inicio = fonte.indexOf('async _handleLogoutGesture(');
        expect(inicio).toBeGreaterThan(0);
        const corpo = fonte.slice(inicio, fonte.indexOf('\n    /**', inicio));

        // O GESTO RESGATA E INFORMA, E NÃO PERGUNTA. A primeira versão desta correção abria um
        // diálogo de três saídas, e o dono do produto a recusou com o argumento que decide o
        // desenho: o sincronismo ocorre sempre, logo a fila só tem conteúdo quando algo NÃO
        // CONSEGUIU subir, nunca porque alguém escolheu não subir. Não há vontade a respeitar, e
        // oferecer a escolha apresentaria como decisão um estado que ninguém decidiu.
        expect(corpo).toContain('countPendingOperations');
        expect(corpo).toContain('shouldPreserveLocalWork');
        expect(corpo).toContain('preserveUnsyncedWorkAsLocal');

        // CONTROLE NEGATIVO da decisão: o diálogo não pode voltar por descuido. Se ele voltar de
        // propósito, esta linha é o lugar de registrar a inversão, e não de apagá-la em silêncio.
        expect(corpo).not.toContain('askAboutUnsyncedWork');
        expect(corpo).not.toContain('EXIT_CHOICE');

        // E o resultado do resgate CHEGA ao usuário nos dois ramos, que é o que sobra da correção
        // quando a pergunta sai: guardar calado seria a mesma perda de informação do defeito.
        expect(corpo).toContain('exitPreservedSummary');
        expect(corpo).toContain('exitPreserveFailedNotice');
    });

    // A PODA, ASSERIDA ESTRUTURALMENTE. O `npm run knip` NÃO acha símbolo morto cujo teste órfão
    // ainda existe, então a única rede contra a volta do diálogo é esta: os símbolos que o
    // compunham não podem reaparecer em `src/`, e o módulo de saída não pode voltar a importar o
    // sistema de modais (ele é alcançado por duas páginas que não bootam modal nenhum).
    it('os símbolos do diálogo não voltaram, e a saída não importa modal', async () => {
        const saidaFonte = await fonteDe('../../src/js/session/unsynced-work-exit.js');
        const frasesFonte = await fonteDe('../../src/js/session/unsynced-work-phrases.js');
        const juntos = `${saidaFonte}\n${frasesFonte}`;

        for (const morto of [
            'guardUnsyncedWorkOnExit',
            'askAboutUnsyncedWork',
            'exitChoices',
            'exitQuestionTitle',
            'exitQuestionMessage',
            'exitDiscardSummary',
            'shouldAskBeforeExit',
        ]) {
            // A menção em prosa é permitida e desejada (o fileoverview explica a decisão), então o
            // que se proíbe é a DEFINIÇÃO e a CHAMADA, não a palavra.
            expect(juntos, morto).not.toMatch(new RegExp(`(function|const)\\s+${morto}\\b`));
            expect(juntos, morto).not.toMatch(new RegExp(`\\b${morto}\\s*\\(`));
        }
        // A ASSERÇÃO É SOBRE O IMPORT, NÃO SOBRE A PALAVRA, e a distinção custou um vermelho: o
        // `fileoverview` cita `@modals/confirm.modal.js` por extenso para explicar por que ele
        // saiu, então proibir a string proibiria a própria explicação. O que não pode voltar é a
        // linha de import e a chamada.
        expect(saidaFonte).not.toMatch(/^\s*import[^\n]*confirm\.modal/m);
        expect(saidaFonte).not.toMatch(/\bshowChoice\s*\(/);

        // CONTROLE NEGATIVO: as mesmas três formas de regra, aplicadas ao que está VIVO, têm que
        // casar. Sem isto, o verde acima viria de regexes que não encontram nada em lugar nenhum.
        expect(juntos).toMatch(/(function|const)\s+preserveUnsyncedWorkAsLocal\b/);
        expect(juntos).toMatch(/\bpreserveUnsyncedWorkAsLocal\s*\(/);
        expect(saidaFonte).toMatch(/^\s*import[^\n]*store-origin/m);
        expect(saidaFonte).toMatch(/\bmarkStoreLocal\s*\(/);
    });
});

// ============================================================================
// 5. A decisão de preservar, agora com o eixo do gesto
// ============================================================================

describe('shouldPreserveLocalWork com escolha do usuário', () => {
    it('o caminho do clique preserva, mesmo sendo saída voluntária', async () => {
        const { shouldPreserveLocalWork } = await carregarSaida();

        expect(shouldPreserveLocalWork({ involuntary: false, pendingOps: 7, chosePreserve: true }))
            .toBe(true);
        // CONTROLE NEGATIVO: sem a marca do gesto, a saída voluntária continua descartando, que é
        // o contrato antigo e o que os testes de `_handleLogout` já afirmam.
        expect(shouldPreserveLocalWork({ involuntary: false, pendingOps: 7 })).toBe(false);
        expect(shouldPreserveLocalWork({ involuntary: false, pendingOps: 0, chosePreserve: false }))
            .toBe(false);
        // E o eixo involuntário não foi alterado pela adição.
        expect(shouldPreserveLocalWork({ involuntary: true, pendingOps: 1 })).toBe(true);
        expect(shouldPreserveLocalWork({ involuntary: true, pendingOps: 0 })).toBe(false);
        expect(shouldPreserveLocalWork({ involuntary: true, pendingOps: NaN })).toBe(true);
    });
});
