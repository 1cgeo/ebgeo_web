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
    /** Se a soma de recursos privados falhou: é o que faz nascer o aviso do acervo. */
    degradado: false,
    /** Quantas vezes o reparo do acervo privado foi pedido. */
    reparos: 0,
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
    isResourceAccessDegraded: () => cenario.degradado,
    onResourceAccessHealthChanged: () => () => {},
    retryVisibleResources: async () => {
        cenario.reparos += 1;
        return true;
    },
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

// O laço de limpeza não é o assunto aqui, e o real precisa de um barramento de verdade. O que o
// duplo NÃO pode jogar fora é o ouvinte de DOM: os dois alvos de clique do crachá (o comando, que
// abre o painel, e o aviso do acervo, que repara) são justamente o assunto do último bloco, e um
// `addDomListener` vazio mediria um crachá sem gesto nenhum.
vi.mock('@utils/event-cleanup.js', () => ({
    setupCleanup() {},
    subscribe() {},
    addDomListener(_dono, el, tipo, fn) {
        el.__ouvintes ??= [];
        el.__ouvintes.push({ tipo, fn });
    },
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

/**
 * Acha um descendente por `data-testid`, em profundidade.
 *
 * A BUSCA É RECURSIVA DESDE 2026-09-13, e não é conveniência: o crachá deixou de ser um elemento
 * só. O comando (ponto + rótulo) e o aviso do acervo privado são IRMÃOS dentro do container, e uma
 * busca de um nível só voltaria a achar o rótulo hoje e nada amanhã.
 * @param {Object} raiz
 * @param {string} testid
 * @returns {Object|undefined}
 */
function acharPorTestid(raiz, testid) {
    if (!raiz) return undefined;
    if (raiz.getAttribute?.('data-testid') === testid) return raiz;
    for (const filho of raiz.children ?? []) {
        const achado = acharPorTestid(filho, testid);
        if (achado) return achado;
    }
    return undefined;
}

/** O elemento que carrega o estado pintado e o clique que abre o painel. */
const comandoDe = (container) => acharPorTestid(container, 'sync-status-badge');

/** Dispara os ouvintes de um tipo registrados naquele elemento pelo duplo de `addDomListener`. */
function disparar(el, tipo, evento = {}) {
    const alvo = { stopPropagation() {}, preventDefault() {}, ...evento };
    for (const { tipo: t, fn } of el.__ouvintes ?? []) if (t === tipo) fn(alvo);
}

const { SyncStatusControl } = await import('../../src/js/account/sync-status.control.js');

/**
 * Monta o controle, faz UMA leitura e devolve o que foi pintado.
 * @returns {Promise<{work: string, tone: string, label: string, title: string}>}
 */
async function pintar() {
    const control = new SyncStatusControl();
    const container = control.onAdd({});
    await control._readQueue();
    const comando = comandoDe(container);
    return {
        work: comando.getAttribute('data-work'),
        tone: comando.getAttribute('data-tone'),
        label: acharPorTestid(container, 'sync-status-label')?.textContent,
        title: comando.getAttribute('title'),
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
        degradado: false,
        reparos: 0,
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
        expect(comandoDe(container).getAttribute('data-work')).toBe('verificando');
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

/**
 * Espera o painel ABRIR, pelo estado e nunca pelo tempo.
 *
 * O clique abre por `await import()` do painel, e a primeira resolução de um import dinâmico leva
 * MAIS de uma volta do laço de eventos com a máquina carregada: `assentar()` é uma volta só, então
 * a asserção positiva corria contra ele. Medido em 2026-09-20: 10 de 10 verdes isolado, e vermelho
 * em quatro rodadas da suíte inteira com outros processos vivos, sempre num caso diferente destes.
 * As asserções NEGATIVAS (`toBe(0)`) continuam sobre `assentar()`, e a fraqueza delas é a oposta:
 * sob a mesma carga elas podem passar antes de a abertura indevida acontecer.
 *
 * @param {number} vezes - Quantas aberturas o cenário deve ter registrado
 */
const esperarAberturas = (vezes) => vi.waitFor(() => {
    expect(cenario.aberturas).toBe(vezes);
}, { timeout: 5000, interval: 5 });

/** Monta, faz uma leitura e devolve o controle já pintado (o container é `control._container`). */
async function montado() {
    const Classe = await classeNova();
    const control = new Classe();
    control.onAdd({});
    await control._readQueue();
    await assentar();
    return control;
}

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

/**
 * O CRACHÁ TEM DOIS ALVOS, e o de dentro engolia o clique do de fora (achado de P6).
 *
 * O QUE SE MEDIU, na captura de P4 sem rede: com a rede desligada a soma de recursos privados
 * falha, o aviso "Acervo privado indisponível" nasce, e o clique dirigido ao crachá deixa de abrir
 * o painel de pendências. A causa não é o carregamento do módulo (isso foi A1, e está preso no
 * bloco acima): é ALVO. O aviso era FILHO da área clicável e é o átomo mais largo da tira, então o
 * centro geométrico do crachá cai dentro dele, e quem clica ali aciona o reparo do acervo.
 * `stopPropagation` no filho não conserta isso, porque nada estava borbulhando errado.
 *
 * A ASSERÇÃO ESTRUTURAL É A QUE VALE, e ela é o que node consegue medir: o elemento que carrega
 * `data-abre-pendencias` não contém o botão do aviso. Geometria não se mede aqui; a contenção, sim,
 * e é ela que torna a geometria impossível. A foto sem rede é o outro lado, e mora em
 * `_captura-p8-offline.spec.js` (apagado no commit, como manda o contrato de captura).
 *
 * CONTROLE NEGATIVO, conferido em 2026-09-13 devolvendo o aviso para dentro do comando
 * (`this._command.appendChild(this._notice)`): reprova UM caso, o da contenção, com "expected
 * { tagName: 'button' } to be undefined". Os três casos de clique continuam VERDES com o defeito
 * de pé, e dizer isso em voz alta é o ponto: aqui o clique é entregue ao elemento por nome, e o
 * defeito é de GEOMETRIA (o ponteiro cai no filho mais largo). Quem contar com eles para pegar a
 * regressão vai ler um verde vazio; quem pega é a contenção, e a foto sem rede.
 */
describe('o aviso do acervo tem caixa PRÓPRIA, e o crachá continua abrindo o painel', () => {
    /** Monta com a soma de recursos privados falhada e sem rede, que é o estado do achado. */
    async function comAvisoESemRede() {
        cenario.degradado = true;
        cenario.conexao = 'offline';
        cenario.censo = { pendentes: 1, preparadas: 0, problemas: 0 };
        const control = await montado();
        return { control, container: control._container };
    }

    it('o comando que abre as pendências NÃO contém o botão do aviso', async () => {
        const { container } = await comAvisoESemRede();
        const comando = comandoDe(container);
        const aviso = acharPorTestid(container, 'resource-access-notice');

        // Sem estas duas, a contenção poderia passar por ausência: um aviso que não existisse
        // também não estaria dentro de coisa nenhuma.
        expect(comando.getAttribute('data-abre-pendencias')).toBe('true');
        expect(aviso).toBeDefined();
        expect(aviso.hidden).toBe(false);

        expect(acharPorTestid(comando, 'resource-access-notice')).toBeUndefined();
        // E os dois são irmãos do mesmo container, e não duas superfícies soltas na barra.
        expect(container.children).toContain(comando);
        expect(container.children).toContain(aviso);
    });

    it('com o aviso de pé, o clique no crachá abre o painel', async () => {
        const { container } = await comAvisoESemRede();
        disparar(comandoDe(container), 'click');
        await assentar();

        await esperarAberturas(1);
        // E não dispara o reparo de passagem: os dois assuntos continuam separados.
        expect(cenario.reparos).toBe(0);
    });

    it('o clique no aviso repara o acervo e NÃO abre o painel', async () => {
        const { container } = await comAvisoESemRede();
        disparar(acharPorTestid(container, 'resource-access-notice'), 'click');
        await assentar();

        expect(cenario.reparos).toBe(1);
        expect(cenario.aberturas).toBe(0);
    });

    it('o teclado alcança o mesmo comando, e só nas duas teclas de ativação', async () => {
        const { container } = await comAvisoESemRede();
        const comando = comandoDe(container);
        expect(comando.getAttribute('role')).toBe('button');
        expect(comando.getAttribute('tabindex')).toBe('0');

        disparar(comando, 'keydown', { key: 'Tab' });
        await assentar();
        expect(cenario.aberturas).toBe(0);

        disparar(comando, 'keydown', { key: 'Enter' });
        await assentar();
        await esperarAberturas(1);
    });

    it('sem o aviso, o crachá segue com um alvo só', async () => {
        // CONTROLE DE VÁCUO da separação: a caixa nova não pode aparecer quando não há o que
        // avisar, senão ela é um alvo morto ocupando a barra.
        cenario.censo = { pendentes: 1, preparadas: 0, problemas: 0 };
        const control = await montado();
        const aviso = acharPorTestid(control._container, 'resource-access-notice');
        expect(aviso.hidden).toBe(true);
    });
});

/**
 * O CRACHÁ NO ATLAS LOCAL É INDICADOR, E NÃO COMANDO (pedido do dono, 2026-09-17).
 *
 * O QUE ELE RELATOU, em duas linhas da mesma leva: "o texto do mouseover no
 * sync-status-badge__label está muito grande, deixar conciso" e "no modo local
 * sync-status-badge__label não é para ser clicável e não precisa abrir um modal".
 *
 * O segundo tem razão de produto: no atlas local não existe fila de envio, então o painel de
 * pendências abriria vazio para dizer que não há o que dizer. O portão mora em `_abrirPendencias`,
 * que é onde o clique e a tecla se encontram, e não em cada ouvinte; o atributo
 * `data-abre-pendencias` acompanha porque é dele que o CSS tira o cursor de ponteiro e o anel de
 * foco (`pendencias.css`).
 *
 * O primeiro tem razão de leitura: o `title` carregava a frase inteira, de três linhas, e ninguém
 * lê um parágrafo pairando o ponteiro. O `aria-label` fica com a longa DE PROPÓSITO, porque quem
 * usa leitor de tela não tem o painel como segunda chance barata.
 *
 * CONTROLE POSITIVO em cada caso: o mesmo gesto no atlas REMOTO, que tem de continuar abrindo. Sem
 * ele, um crachá que nunca abrisse o painel passaria aqui inteiro.
 */
describe('no atlas local o crachá não é comando, e o mouseover é curto', () => {
    it('o atlas local não anuncia o painel, e o teclado não o alcança', async () => {
        cenario.remoto = false;
        const { _container: container } = await montado();
        const comando = comandoDe(container);

        expect(comando.getAttribute('data-abre-pendencias')).toBe('false');
        expect(comando.getAttribute('tabindex')).toBe('-1');
        expect(comando.getAttribute('aria-haspopup')).toBe('false');
    });

    it('o clique e a tecla no atlas local não abrem painel nenhum', async () => {
        cenario.remoto = false;
        const { _container: container } = await montado();
        const comando = comandoDe(container);

        disparar(comando, 'click');
        disparar(comando, 'keydown', { key: 'Enter' });
        await assentar();
        expect(cenario.aberturas).toBe(0);
    });

    it('CONTROLE POSITIVO: no atlas remoto o mesmo clique abre', async () => {
        cenario.censo = { pendentes: 1, preparadas: 0, problemas: 0 };
        const { _container: container } = await montado();
        const comando = comandoDe(container);

        expect(comando.getAttribute('data-abre-pendencias')).toBe('true');
        expect(comando.getAttribute('tabindex')).toBe('0');
        disparar(comando, 'click');
        await assentar();
        await esperarAberturas(1);
    });

    it('o mouseover é o resumo, e o leitor de tela continua com a frase inteira', async () => {
        cenario.censo = { pendentes: 3, preparadas: 0, problemas: 0 };
        const { _container: container } = await montado();
        const comando = comandoDe(container);

        const titulo = comando.getAttribute('title');
        const longa = comando.getAttribute('aria-label');
        expect(titulo).toBeTruthy();
        expect(longa).toBeTruthy();
        // A relação é o que importa, e não um comprimento fixo: o resumo é OUTRA frase, mais
        // curta, e a longa continua inteira onde ela serve.
        expect(titulo).not.toBe(longa);
        expect(titulo.length).toBeLessThan(longa.length);
        expect(titulo).not.toContain('\n');
    });

    it('o resumo existe em todos os estados que o crachá pinta', async () => {
        // O `title` cai no `detail` quando não há resumo, o que seria um regresso silencioso para
        // a frase de três linhas em algum estado esquecido.
        const casos = [
            { nome: 'local', arranjo: () => { cenario.remoto = false; } },
            { nome: 'vazio', arranjo: () => {} },
            { nome: 'a caminho', arranjo: () => { cenario.censo = { pendentes: 2, preparadas: 0, problemas: 0 }; } },
            { nome: 'com problema', arranjo: () => { cenario.censo = { pendentes: 0, preparadas: 0, problemas: 1 }; } },
            { nome: 'sem rede', arranjo: () => { cenario.conexao = 'offline'; } },
            { nome: 'pausado', arranjo: () => { cenario.pausado = true; } },
            { nome: 'em quarentena', arranjo: () => { cenario.quarentena = [{ atlasId: 'a1' }]; } },
        ];
        for (const caso of casos) {
            Object.assign(cenario, {
                remoto: true,
                conexao: 'online',
                censo: { pendentes: 0, preparadas: 0, problemas: 0 },
                quarentena: [],
                pausado: false,
                aberturas: 0,
            });
            caso.arranjo();
            const { _container: container } = await montado();
            const comando = comandoDe(container);
            const titulo = comando.getAttribute('title');
            const longa = comando.getAttribute('aria-label');
            expect(titulo, `estado ${caso.nome} sem título`).toBeTruthy();
            expect(titulo.length, `estado ${caso.nome} caiu na frase longa`).toBeLessThan(longa.length);
        }
    });
});
