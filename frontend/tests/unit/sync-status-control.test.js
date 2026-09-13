// Path: tests/unit/sync-status-control.test.js

/**
 * @fileoverview A LUZ COLETA OS SETE SINAIS, e o verde dela exige os sete (achado F14).
 *
 * `sync-status-pendencias.test.js` cobra a DECISÃO (a função pura). Este arquivo cobra a COLETA,
 * que é a outra metade e a que de fato regrediu: até 2026-09-13 o controle lia só o censo da fila
 * (`countByState`) e somava os três números num só, então três pendências inteiras nunca chegavam
 * à decisão e o atributo pintado era verde com elas de pé:
 *
 *   - a quarentena global, que sobrevive ao fim de uma sessão à espera de decisão;
 *   - as pendências de upload de figura, que não têm operação incremental nenhuma;
 *   - a recuperação em curso, que reescreve os bancos por baixo da leitura.
 *
 * ELE MEDE O QUE VAI PARA O DOM, e não o retorno de um método: o que a pessoa lê é
 * `data-work`/`data-tone` no crachá, então é isso que se afirma. O documento é um duplo mínimo, no
 * molde de `aviso-de-camada-que-nao-carrega.test.js`, porque o ambiente é node e não há jsdom.
 *
 * A IDENTIDADE DO ESCOPO É ASSERIDA, e não é zelo: `storeWritesPaused` consulta um `WeakMap`
 * chaveado por OBJETO, e `remoteScope()` devolve objeto novo a cada chamada. Passar um escopo
 * recém-construído em vez do ativo devolveria `false` para sempre, em silêncio, e a luz voltaria a
 * ficar verde durante a recuperação sem que nada acusasse.
 *
 * CONTROLE NEGATIVO, conferido em 2026-09-13 restaurando a coleta antiga (só `countByState`, com
 * os três números somados em `pending`, sem quarentena, sem blobs e sem recuperação): 6 casos
 * reprovados aqui, e os três primeiros pela razão exata do achado, saindo `enviado`/`ok`.
 */

import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Estado que os duplos leem, e que cada caso arruma
// ---------------------------------------------------------------------------

const ESCOPO_ATIVO = { kind: 'remote', atlasId: 'a1', dbSuffix: 'remote__a1' };

const cenario = {
    autenticado: true,
    remoto: true,
    conexao: 'online',
    censo: { pendentes: 0, preparadas: 0, problemas: 0 },
    censoErro: null,
    quarentena: [],
    blobs: [],
    blobsErro: null,
    pausado: false,
    /** Os escopos que o controle passou a `storeWritesPaused`, para conferir a IDENTIDADE. */
    escoposConsultados: [],
    /** Quantas vezes o MÓDULO do painel foi avaliado: é assim que o pré-carregamento se mede. */
    cargasDoPainel: 0,
    /** Quando verdadeiro, a carga do módulo do painel falha, como sem rede. */
    painelFalha: false,
    /** Quantas vezes o painel chegou a ser aberto. */
    aberturas: 0,
    /** As frases que o controle mandou para a tela. */
    avisos: [],
};

vi.mock('@store/services.js', () => ({
    getEventBus: () => ({ on() {}, off() {}, subscribe() { return () => {}; } }),
}));

vi.mock('@store/sync/connection-state.js', () => ({
    connectionState: { getState: () => cenario.conexao },
    ConnectionStates: Object.freeze({
        ONLINE: 'online', CONNECTING: 'connecting', RECONNECTING: 'reconnecting', OFFLINE: 'offline',
    }),
}));

vi.mock('@store/sync/session-context.js', () => ({
    sessionContext: { isAuthenticated: () => cenario.autenticado },
}));

vi.mock('@store/store-origin.js', () => ({ isRemoteStoreSync: () => cenario.remoto }));

// OS DUPLOS SÃO AS FOLHAS, e não o leitor: `lerPendenciasDoEscopoAtivo` roda de verdade aqui,
// porque a composição das três fontes numa contagem só é justamente o que este lote moveu para
// dentro dele. Dublar o leitor mediria o controle chamando uma função que não existe mais assim.
vi.mock('@store/sync/operation-queue.js', () => ({
    operationBelongsToScope: () => true,
    OperationQueue: class {
        async countByState() {
            if (cenario.censoErro) throw cenario.censoErro;
            return cenario.censo;
        }
    },
}));

vi.mock('@store/sync/quarantine-registry.js', () => ({
    listQuarantinedOperations: async () => cenario.quarentena,
}));

vi.mock('@store/remote-atlas.api.js', () => ({ listRemoteAtlases: async () => [] }));

vi.mock('@js/session/presenca.js', () => ({ configurarPendenciasDePresenca() {} }));

vi.mock('@store/sync/blob-upload-queue.js', () => ({
    BlobUploadState: Object.freeze({
        PENDENTE: 'pendente', CONFIRMADO: 'confirmado', RECUSADO: 'recusado',
    }),
    listarPendenciasDeBlob: async () => {
        if (cenario.blobsErro) throw cenario.blobsErro;
        return cenario.blobs;
    },
}));

vi.mock('@store/write-coordinator.js', () => ({
    storeWritesPaused: (scope) => {
        cenario.escoposConsultados.push(scope);
        return cenario.pausado;
    },
}));

vi.mock('@store/atlas-namespace.js', () => ({
    getActiveScope: () => ESCOPO_ATIVO,
    getStoreFor: () => ({ keys: async () => [], getItem: async () => null }),
    readLocalAtlasRegistry: async () => [],
    remoteScope: (atlasId) => ({ kind: 'remote', atlasId, dbSuffix: `remote__${atlasId}` }),
    StoreName: Object.freeze({ OPERATION_QUEUE: 'operation_queue' }),
    StoreScopeKind: Object.freeze({ LOCAL: 'local', REMOTE: 'remote' }),
}));

vi.mock('@store/sync/resource-access.service.js', () => ({
    isResourceAccessDegraded: () => false,
    onResourceAccessHealthChanged: () => () => {},
    retryVisibleResources: async () => true,
}));

// O PAINEL É DUBLADO PARA A SUÍTE INTEIRA, e este duplo é MUDO de propósito: os casos que pintam
// âmbar disparam o pré-carregamento, e sem ele cada um deles puxaria o painel de verdade (com a
// store atrás) só para nunca abri-lo. O duplo que CONTA as cargas é registrado caso a caso, mais
// abaixo, porque a fábrica hasteada é avaliada uma vez só.
vi.mock('../../src/js/account/pendencias/pendencias-panel.js', () => ({
    abrirPainelDePendencias: () => {},
}));

vi.mock('@utils/toast_service.js', () => ({
    showToast: (m) => cenario.avisos.push(m),
    showSuccess: (m) => cenario.avisos.push(m),
    showError: (m) => cenario.avisos.push(m),
    showWarning: (m) => cenario.avisos.push(m),
    showInChannel: (m) => cenario.avisos.push(m),
}));

// O laço de limpeza não é o assunto aqui, e o real precisa de um barramento de verdade.
vi.mock('@utils/event-cleanup.js', () => ({
    setupCleanup() {},
    subscribe() {},
    addDomListener() {},
    trackTimer() {},
    cleanup() {},
    removeElement() {},
}));

// ---------------------------------------------------------------------------
// Documento mínimo
// ---------------------------------------------------------------------------

/** Só o que `onAdd` e `_render` tocam. */
function makeElement(tagName) {
    const el = {
        tagName,
        className: '',
        textContent: '',
        type: '',
        hidden: false,
        dataset: {},
        attributes: {},
        children: [],
        setAttribute(name, value) { el.attributes[name] = value; },
        getAttribute(name) { return el.attributes[name]; },
        appendChild(child) { el.children.push(child); return child; },
        append(...kids) { for (const kid of kids) el.appendChild(kid); },
        addEventListener() {},
        removeEventListener() {},
    };
    return el;
}

const documentoOriginal = globalThis.document;
globalThis.document = { createElement: makeElement, addEventListener() {}, hidden: false };
afterAll(() => {
    if (documentoOriginal === undefined) delete globalThis.document;
    else globalThis.document = documentoOriginal;
});

const { SyncStatusControl } = await import('../../src/js/account/sync-status.control.js');

/**
 * Monta o controle, faz UMA leitura e devolve o que foi pintado.
 * @returns {Promise<{work: string, tone: string, label: string, title: string}>}
 */
async function pintar() {
    const control = new SyncStatusControl();
    const container = control.onAdd({});
    await control._readQueue();
    return {
        work: container.getAttribute('data-work'),
        tone: container.getAttribute('data-tone'),
        label: container.children
            .find((c) => c.getAttribute('data-testid') === 'sync-status-label')?.textContent,
        title: container.getAttribute('title'),
    };
}

beforeEach(() => {
    Object.assign(cenario, {
        autenticado: true,
        remoto: true,
        conexao: 'online',
        censo: { pendentes: 0, preparadas: 0, problemas: 0 },
        censoErro: null,
        quarentena: [],
        blobs: [],
        blobsErro: null,
        pausado: false,
        escoposConsultados: [],
        cargasDoPainel: 0,
        painelFalha: false,
        aberturas: 0,
        avisos: [],
    });
});

describe('o crachá pinta o que coletou', () => {
    it('CONTROLE DE VÁCUO: sem pendência nenhuma, conectado, o atributo é verde', async () => {
        // Sem este caso todo "não é verde" abaixo passaria com um controle que nunca pinta verde.
        const pintado = await pintar();
        expect(pintado.work).toBe('enviado');
        expect(pintado.tone).toBe('ok');
        expect(pintado.label).toBe('Tudo enviado');
    });

    it('QUARENTENA com a fila em zero NÃO fica verde', async () => {
        // A regressão por extenso: até este lote o controle não lia este registro, e a fila em zero
        // pintava verde sobre trabalho guardado esperando decisão da pessoa.
        cenario.quarentena = [{ atlasId: 'a1' }, { atlasId: 'a1' }];
        const pintado = await pintar();
        expect(pintado.work).toBe('conflito');
        expect(pintado.tone).toBe('warn');
        expect(pintado.title).toContain('2 alterações');
    });

    it('UPLOAD DE FIGURA pendente com a fila em zero NÃO fica verde', async () => {
        cenario.blobs = [
            { estado: 'pendente' },
            { estado: 'confirmado' },
        ];
        const pintado = await pintar();
        expect(pintado.work).toBe('upload-pendente');
        // Confirmado não conta: contá-lo deixaria a luz âmbar para sempre depois da primeira
        // figura, e aviso permanente é aviso que se aprende a ignorar.
        expect(pintado.label).toBe('Imagens: 1');
    });

    it('upload RECUSADO em definitivo entra na contagem e sobe o tom para alarme', async () => {
        cenario.blobs = [{ estado: 'recusado' }, { estado: 'pendente' }];
        const pintado = await pintar();
        expect(pintado.work).toBe('upload-pendente');
        expect(pintado.tone).toBe('warn');
        expect(pintado.label).toBe('Imagens: 2');
    });

    it('RECUPERAÇÃO em curso com a fila em zero NÃO fica verde', async () => {
        cenario.pausado = true;
        const pintado = await pintar();
        expect(pintado.work).toBe('recuperando');
        expect(pintado.tone).toBe('busy');
    });

    it('RECUSA na fila sai como recusa, e não como envio em curso', async () => {
        // Antes deste lote os três números do censo eram SOMADOS num só, então uma recusa saía
        // como "Enviando 1…", isto é, prometendo progresso que não existe.
        cenario.censo = { pendentes: 0, preparadas: 0, problemas: 1 };
        const pintado = await pintar();
        expect(pintado.work).toBe('recusa');
        expect(pintado.label).toBe('Recusas: 1');
    });

    it('preparada conta como trabalho à espera, e não como problema', async () => {
        cenario.censo = { pendentes: 1, preparadas: 2, problemas: 0 };
        const pintado = await pintar();
        expect(pintado.work).toBe('enviando');
        expect(pintado.title).toContain('3 alterações');
    });
});

describe('a coleta falha FECHADA', () => {
    it('censo ilegível apaga TODOS os números, e nenhum deles vira zero', async () => {
        cenario.censoErro = new Error('IndexedDB fora');
        cenario.quarentena = [{ atlasId: 'a1' }];
        const pintado = await pintar();
        // Não pode sair 'conflito' a partir de uma leitura que a mesma `Promise.all` abortou: ali o
        // número da quarentena nunca foi atribuído, e usar o valor anterior seria censo inventado.
        expect(pintado.work).toBe('desconhecido');
        expect(pintado.tone).toBe('unknown');
    });

    it('pendência de blob ilegível também apaga tudo', async () => {
        cenario.blobsErro = new Error('imagens fora');
        const pintado = await pintar();
        expect(pintado.work).toBe('desconhecido');
    });

    it('antes da primeira leitura o crachá diz que está verificando', async () => {
        const control = new SyncStatusControl();
        const container = control.onAdd({});
        expect(container.getAttribute('data-work')).toBe('verificando');
    });
});

describe('a recuperação é perguntada pelo escopo ATIVO', () => {
    it('o objeto passado é o mesmo que `getActiveScope` devolve, por identidade', async () => {
        await pintar();
        expect(cenario.escoposConsultados.length).toBeGreaterThan(0);
        for (const scope of cenario.escoposConsultados) expect(scope).toBe(ESCOPO_ATIVO);
    });
});

describe('atlas local e visitante', () => {
    it('atlas local não lê a fila e continua neutro', async () => {
        cenario.remoto = false;
        cenario.quarentena = [{ atlasId: 'a1' }];
        const pintado = await pintar();
        expect(pintado.work).toBe('local');
        expect(pintado.tone).toBe('idle');
    });

    it('visitante anônimo esconde o crachá inteiro', async () => {
        cenario.autenticado = false;
        const control = new SyncStatusControl();
        const container = control.onAdd({});
        expect(container.hidden).toBe(true);
    });
});

/**
 * O PAINEL VIAJA PELA REDE, e o clique acontece justamente quando ela caiu.
 *
 * A captura de B5d mediu isto: sem rede o `import()` do clique não traz o módulo, e o `catch` só
 * escrevia no console, então o crachá que diz "Recusas: 1" abria NADA. As duas metades do conserto
 * são medidas aqui, e a segunda é a que sobra quando a primeira não deu tempo.
 *
 * A CARGA É CONTADA PELA FÁBRICA DO DUPLO, e cada caso reinicia o registro de módulos: sem isso o
 * módulo carregado por um caso ficaria em cache e o caso seguinte mediria uma carga que não houve.
 *
 * CONTROLE NEGATIVO, conferido em 2026-09-13 removendo a chamada a `_precarregarPainel` de
 * `_render` e devolvendo o `catch` mudo a `_abrirPendencias`: reprovam os três casos que afirmam
 * carga e aviso (o de vácuo, que exige ZERO carga no verde, continua verde, que é o papel dele).
 */
describe('o painel é buscado antes do clique, e a falha do clique fala', () => {
    /**
     * A classe recarregada, com o painel dublado DE NOVO.
     *
     * `doMock` E NÃO `vi.mock`: a fábrica hasteada é avaliada uma vez e o resultado dela fica no
     * registro de duplos, que `resetModules` não limpa, então um caso que carregasse o painel com
     * sucesso deixaria todos os seguintes incapazes de encenar a falha. Registrar de novo a cada
     * caso é o que torna a carga contável e a falha encenável.
     * @returns {Promise<Function>}
     */
    async function classeNova() {
        vi.resetModules();
        vi.doMock('../../src/js/account/pendencias/pendencias-panel.js', () => {
            cenario.cargasDoPainel += 1;
            if (cenario.painelFalha) {
                throw new Error('Failed to fetch dynamically imported module: pendencias-panel.js');
            }
            return { abrirPainelDePendencias: () => { cenario.aberturas += 1; } };
        });
        const modulo = await import('../../src/js/account/sync-status.control.js');
        return modulo.SyncStatusControl;
    }

    /** Deixa a carga do painel, que é assíncrona por natureza, chegar ao fim. */
    const assentar = () => new Promise((resolve) => { setTimeout(resolve, 0); });

    /** Monta, faz uma leitura e devolve o controle já pintado. */
    async function montado() {
        const Classe = await classeNova();
        const control = new Classe();
        control.onAdd({});
        await control._readQueue();
        await assentar();
        return control;
    }

    it('CONTROLE DE VÁCUO: com tudo enviado o módulo NÃO é baixado', async () => {
        // Sem este caso, um pré-carregamento incondicional passaria em todos os outros e o peso do
        // boot cresceria para quem nunca vai abrir o painel.
        await montado();
        expect(cenario.cargasDoPainel).toBe(0);
    });

    it('assim que a luz sai do verde, o módulo é baixado sem clique nenhum', async () => {
        cenario.censo = { pendentes: 0, preparadas: 0, problemas: 1 };
        const control = await montado();
        expect(cenario.cargasDoPainel).toBe(1);

        // E o clique não baixa de novo: a promessa é o cache.
        await control._abrirPendencias();
        expect(cenario.cargasDoPainel).toBe(1);
        expect(cenario.aberturas).toBe(1);
    });

    it('sem rede, o clique AVISA em vez de não fazer nada', async () => {
        cenario.painelFalha = true;
        cenario.conexao = 'offline';
        cenario.censo = { pendentes: 1, preparadas: 0, problemas: 0 };
        const control = await montado();

        await control._abrirPendencias();
        expect(cenario.aberturas).toBe(0);
        expect(cenario.avisos).toHaveLength(1);
        expect(cenario.avisos[0]).toMatch(/Sem conexão/);
        // A FRASE NOMEIA O ESTADO e o desfecho, senão ela é só um erro genérico.
        expect(cenario.avisos[0]).toMatch(/quando a rede voltar/i);
    });

    it('com rede de pé, a mesma falha diz outra coisa, porque o desfecho é outro', async () => {
        cenario.painelFalha = true;
        cenario.censo = { pendentes: 1, preparadas: 0, problemas: 0 };
        const control = await montado();

        await control._abrirPendencias();
        expect(cenario.avisos[0]).toMatch(/Tente de novo/);
        expect(cenario.avisos[0]).not.toMatch(/Sem conexão/);
    });

    it('a falha offline não se cristaliza: voltar a ONLINE reabre a tentativa', async () => {
        cenario.painelFalha = true;
        cenario.conexao = 'offline';
        cenario.censo = { pendentes: 1, preparadas: 0, problemas: 0 };
        const control = await montado();
        const depoisDaPrimeira = cenario.cargasDoPainel;

        // A batida periódica não insiste enquanto está offline: seria um download por 3 s que não
        // pode dar certo.
        await control._readQueue();
        await assentar();
        expect(cenario.cargasDoPainel).toBe(depoisDaPrimeira);

        cenario.painelFalha = false;
        cenario.conexao = 'online';
        control._onSignal();
        await control._readQueue();
        await assentar();
        expect(cenario.cargasDoPainel).toBe(depoisDaPrimeira + 1);
    });
});
