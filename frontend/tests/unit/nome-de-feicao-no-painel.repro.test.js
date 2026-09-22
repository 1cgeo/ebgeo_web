// Path: tests/unit/nome-de-feicao-no-painel.repro.test.js

/**
 * @fileoverview O NOME DE FEIÇÃO EDITADO NO PAINEL SE PERDIA EM SILÊNCIO, e este arquivo prende as
 * três metades do conserto de 2026-09-22.
 *
 * O AVISO que abriu a investigação (deixado de manhã por outro agente, a partir de
 * `frontend/tests/helpers/main-round-trip.mjs`): "na main o nome de feição não vai ao store no
 * Enter, e um deselect que chega antes de o painel terminar de renderizar perde a edição em
 * silêncio". Lido o caminho vivo, a primeira metade era verdade NOS DOIS ramos, e a segunda tinha
 * o elo certo com o nome errado:
 *
 *  1. ENTER SÓ PREPARAVA. `saveEdit` (`sidebar/components/feature-identification.js`) chamava
 *     `onNameChange`, que chega ao `updateFeaturesProperty` da ferramenta: fonte do MapLibre e
 *     feição em memória, e mais nada. Quem gravava era o "Salvar" do painel, ou o deselect que o
 *     aperta. Bloco 2.
 *  2. O QUE PERDIA A EDIÇÃO ERA A TROCA DE CONTEÚDO, não o deselect. O painel é construído de forma
 *     assíncrona e o conteúdo ANTERIOR fica no DOM, interativo, até a troca; `_showFeatureContent`
 *     salvava esse conteúdo só quando a reconstrução COMEÇAVA. A edição feita nele durante a janela
 *     morria com o nó, e o conteúdo novo não a salvava: o retrato dele (`createInitialPropertiesMap`)
 *     podia já contê-la, e a partir daí a divergência ficava GRUDADA (memória e fonte com o nome
 *     novo, store com o velho, e redigitar o mesmo nome não gravava, porque o campo comparava com a
 *     memória e o painel com o próprio retrato). O deselect entra de outro jeito: chegando com a
 *     construção em voo, ele não a invalidava, e ela terminava REABRINDO o painel para uma feição
 *     já desselecionada. Pela LEITURA do gesto do harness (desenhar, Escape, clicar no ponto,
 *     nomear), é nesse painel reaberto, com a reconstrução seguinte em voo, que a edição caía; a
 *     ordem exata do navegador não foi medida. Bloco 3.
 *  3. O CAMPO ABERTO NUMA DESMONTAGEM PROGRAMÁTICA não recebe blur. Bloco 2, último caso.
 *
 * E UM EFEITO DO PRÓPRIO CONSERTO, preso no bloco 4: salvar o conteúdo que sai também na troca
 * faz o mesmo painel salvar duas vezes seguidas, e em seleção múltipla cada salvamento abre o
 * coletor GLOBAL de lote de desfazer. `doSave` (`tool_manager/helpers/buttons.helpers.js`) passou
 * a encadear os salvamentos de um painel, para o segundo não zerar o lote do primeiro.
 *
 * O que NÃO se prende aqui, e precisa de captura de UI: a ordem real de eventos do navegador
 * (blur no mousedown antes do clique no mapa) e a corrida de duas construções. Aqui a corrida é
 * DETERMINÍSTICA, como a constituição prefere: a construção só termina quando o teste manda.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { makeDocumentStub, makeElement } from '../helpers/dom-double.js';
import {
    UNNAMED_LABEL,
    requestedFeatureName,
    displayedFeatureName,
    nameCommitAction,
    nameCommitOutcome,
} from '../../src/js/sidebar/components/feature-name-commit.model.js';
import {
    NAME_INPUT_SELECTOR,
    PENDING_NAME_COMMIT,
    commitOpenNameFields,
    finishFeaturePanelBuild,
} from '../../src/js/sidebar/panels/feature-panel-flush.js';
import { pendingPropertyEdits } from '../../src/js/tool_manager/helpers/pending-edit.helpers.js';

// Mutable box read at CALL time by the hoisted mock factories below.
const box = vi.hoisted(() => ({
    stored: new Map(),
    writes: [],
    refuse: false,
    currentMap: 'Principal',
    lote: [],
}));

// FULL mock of the barrel: the eight doors the component opens plus the three undo-batch doors of
// `buttons.helpers.js`, which imports the same file as `'../../store'`. The store is a Map of
// structured clones, because IndexedDB hands every reader its own clone and the component must
// not get away with mutating what it read.
vi.mock('@store/index.js', () => ({
    startBatchUndo: () => { box.lote.push('start'); },
    commitBatchUndo: () => { box.lote.push('commit'); },
    discardBatchUndo: () => { box.lote.push('discard'); },
    getLayers: async () => [],
    getFeatureIcon: () => null,
    getFeatureDisplayName: () => 'Ponto',
    getStorageTypeFromSource: () => 'points',
    isCurrentMapLockedSync: () => false,
    getCurrentMapNameSync: () => box.currentMap,
    getFeatureById: async (_type, id) => {
        const f = box.stored.get(id);
        return f ? structuredClone(f) : undefined;
    },
    // The real `updateFeature` returns undefined on EVERY path: a refusal by the guard and a
    // feature that is no longer in the document look exactly like a write from outside.
    updateFeature: async (_type, feature) => {
        box.writes.push(structuredClone(feature));
        if (box.refuse) return;
        if (!box.stored.has(feature.properties.id)) return;
        box.stored.set(feature.properties.id, structuredClone(feature));
    },
}));

vi.mock('@tools/helpers/feature-header.helpers.js', () => ({
    createFeatureOptionsButton: () => makeElement('button'),
}));

const { createFeatureIdentification } = await import('../../src/js/sidebar/components/feature-identification.js');
const { createModernButtons } = await import('../../src/js/tool_manager/helpers/buttons.helpers.js');

const ID = 'f0a1b2c3-0000-4000-8000-000000000001';
/** The store does not have the feature at all. */
const SEM_REGISTRO = Symbol('sem registro');
/**
 * The feature has no `nome` key. A sentinel and not `undefined`, because a default parameter
 * applies to `undefined` and the "unnamed" case would silently mount a named feature.
 */
const SEM_NOME = Symbol('sem nome');

function temClasse(el, nome) {
    return typeof el?.className === 'string' && el.className.split(' ').includes(nome);
}

function acharNaArvore(raiz, pred) {
    if (!raiz) return null;
    if (pred(raiz)) return raiz;
    for (const filho of raiz.children || []) {
        const achado = acharNaArvore(filho, pred);
        if (achado) return achado;
    }
    return null;
}

function todosNaArvore(raiz, pred, saida = []) {
    if (!raiz) return saida;
    if (pred(raiz)) saida.push(raiz);
    for (const filho of raiz.children || []) todosNaArvore(filho, pred, saida);
    return saida;
}

/** A root that answers the ONE selector the flush asks for, over the DOM double. */
function raizConsultavel(arvore) {
    return {
        querySelectorAll(seletor) {
            expect(seletor).toBe(NAME_INPUT_SELECTOR);
            return todosNaArvore(arvore, (el) => temClasse(el, 'feature-identification-name-input'));
        },
    };
}

/** Calls every listener of `evento`, with the key the keydown handler reads. */
function disparar(el, evento, extra = {}) {
    const evt = { target: el, preventDefault() {}, stopPropagation() {}, ...extra };
    for (const handler of [...(el._listeners.get(evento) || [])]) handler(evt);
}

/** Lets the component's awaited reads and writes run out (they are microtask chains). */
async function assentar() {
    for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
}

/**
 * Mounts the identification section for one point.
 * @param {{memoria?: *, armazenado?: *}} [opcoes] - Name in the panel's copy and in the store
 *   (`SEM_NOME` drops the key; `SEM_REGISTRO` leaves the store without the feature).
 */
async function montar({ memoria = 'Ponto #3', armazenado = 'Ponto #3' } = {}) {
    const properties = { id: ID, source: 'point', layerId: 'default' };
    if (memoria !== SEM_NOME) properties.nome = memoria;
    const feature = { type: 'Feature', geometry: { type: 'Point', coordinates: [-43.2, -22.9] }, properties };

    if (armazenado !== SEM_REGISTRO) {
        const doStore = structuredClone(feature);
        if (armazenado === SEM_NOME) delete doStore.properties.nome;
        else doStore.properties.nome = armazenado;
        box.stored.set(ID, doStore);
    }

    const renomes = [];
    const container = await createFeatureIdentification({
        feature,
        featureType: 'point',
        selectedFeatures: [feature],
        onNameChange: (nome) => renomes.push(nome),
    });
    const display = acharNaArvore(container, (el) => temClasse(el, 'feature-identification-name'));
    const input = acharNaArvore(container, (el) => temClasse(el, 'feature-identification-name-input'));
    expect(display, 'o painel desenhou o nome').toBeTruthy();
    expect(input, 'o painel desenhou o campo de nome (mapa destravado)').toBeTruthy();
    return { feature, container, display, input, renomes };
}

/** The person's gesture: click the name, type, and (optionally) confirm with a key. */
function digitar(montado, texto, tecla = null) {
    disparar(montado.display, 'click');
    montado.input.value = texto;
    if (tecla) disparar(montado.input, 'keydown', { key: tecla });
}

let documentoOriginal;

beforeEach(() => {
    box.stored.clear();
    box.writes.length = 0;
    box.refuse = false;
    box.currentMap = 'Principal';
    box.lote.length = 0;
    documentoOriginal = globalThis.document;
    const stub = makeDocumentStub();
    // The click handler focuses and selects the input; the double has neither.
    stub.createElement = (tag) => Object.assign(makeElement(tag), { focus() {}, select() {} });
    globalThis.document = stub;
});

afterEach(() => {
    globalThis.document = documentoOriginal;
});

// ============================================================================
// 1. A DECISÃO, pura
// ============================================================================

describe('1. o que confirmar o campo de nome pede, decidido contra o STORE', () => {
    it('o texto digitado é aparado; vazio vira o rótulo de sem nome, como sempre foi', () => {
        expect(requestedFeatureName('  Posto Alfa  ', 'Ponto #3')).toBe('Posto Alfa');
        expect(requestedFeatureName('', 'Ponto #3')).toBe(UNNAMED_LABEL);
        expect(requestedFeatureName('   ', 'Ponto #3')).toBe(UNNAMED_LABEL);
        expect(requestedFeatureName(undefined, 'Ponto #3')).toBe(UNNAMED_LABEL);
        // Nome importado numérico não é "sem nome": esvaziar o campo o troca pelo rótulo.
        expect(requestedFeatureName('', 123)).toBe(UNNAMED_LABEL);
    });

    it('abrir e deixar vazio o campo de uma feição SEM nome não pede nada', () => {
        for (const semNome of [undefined, null, '', '   ']) {
            expect(requestedFeatureName('', semNome), `nome atual ${JSON.stringify(semNome)}`).toBeNull();
        }
        // Digitar algo continua pedindo, com ou sem nome antes.
        expect(requestedFeatureName('Novo', undefined)).toBe('Novo');
    });

    it('a exibição mantém o fallback antigo (`nome || rótulo`)', () => {
        expect(displayedFeatureName(undefined)).toBe(UNNAMED_LABEL);
        expect(displayedFeatureName('')).toBe(UNNAMED_LABEL);
        expect(displayedFeatureName(0)).toBe(UNNAMED_LABEL);
        expect(displayedFeatureName('  ')).toBe('  ');
        expect(displayedFeatureName(123)).toBe('123');
        expect(displayedFeatureName('Posto Alfa')).toBe('Posto Alfa');
    });

    it('a ação é decidida contra o registro GUARDADO, e é isso que conserta a divergência grudada', () => {
        const guardado = (nome) => ({ properties: { id: ID, nome } });
        expect(nameCommitAction({ requested: null, stored: guardado('X'), sameMap: true })).toBe('none');
        expect(nameCommitAction({ requested: 'X', stored: guardado('X'), sameMap: true })).toBe('none');
        expect(nameCommitAction({ requested: 'X', stored: guardado('Ponto #3'), sameMap: true })).toBe('write');
        expect(nameCommitAction({ requested: 'X', stored: undefined, sameMap: true })).toBe('missing');
        expect(nameCommitAction({ requested: 'X', stored: null, sameMap: true })).toBe('missing');
        // Mapa trocado vence até a feição existir: o id pode morar no outro mapa.
        expect(nameCommitAction({ requested: 'X', stored: guardado('Ponto #3'), sameMap: false })).toBe('stale');
    });

    it('o resultado vem da RELEITURA, porque a escrita recusada devolve o mesmo que a aceita', () => {
        expect(nameCommitOutcome('X', { properties: { nome: 'X' } }, 'antes')).toEqual({ committed: true, name: 'X' });
        expect(nameCommitOutcome('X', { properties: { nome: 'Ponto #3' } }, 'antes'))
            .toEqual({ committed: false, name: 'Ponto #3' });
        expect(nameCommitOutcome('X', { properties: {} }, 'antes')).toEqual({ committed: false, name: undefined });
        expect(nameCommitOutcome('X', undefined, 'antes')).toEqual({ committed: false, name: 'antes' });
    });
});

// ============================================================================
// 2. O CAMPO, montado contra o dublê
// ============================================================================

describe('2. confirmar o campo grava no store, com os guardas normais', () => {
    it('ENTER GRAVA, sem "Salvar" e sem deselect (antes: só a fonte e a memória mudavam)', async () => {
        const m = await montar();
        digitar(m, 'Posto Alfa', 'Enter');

        // Síncrono, antes de qualquer await: todo "Salvar" deste painel já carrega o nome.
        expect(m.feature.properties.nome).toBe('Posto Alfa');
        expect(m.renomes).toEqual(['Posto Alfa']);
        expect(m.display.textContent).toBe('Posto Alfa');

        await assentar();
        expect(box.writes).toHaveLength(1);
        expect(box.writes[0].properties.nome).toBe('Posto Alfa');
        expect(box.stored.get(ID).properties.nome).toBe('Posto Alfa');
        expect(m.display.textContent).toBe('Posto Alfa');
    });

    it('o blur que vem depois do Enter não confirma de novo', async () => {
        const m = await montar();
        digitar(m, 'Posto Alfa', 'Enter');
        disparar(m.input, 'blur');
        await assentar();
        expect(box.writes).toHaveLength(1);
        expect(m.renomes).toEqual(['Posto Alfa']);
    });

    it('blur sozinho também confirma, como sempre confirmou', async () => {
        const m = await montar();
        digitar(m, 'Posto Bravo');
        disparar(m.input, 'blur');
        await assentar();
        expect(box.stored.get(ID).properties.nome).toBe('Posto Bravo');
    });

    it('A DIVERGÊNCIA GRUDADA SE CONSERTA: o mesmo nome da memória grava quando o store não o tem', async () => {
        // O estado que o harness mediu na main: painel com o nome novo, disco com o padrão.
        const m = await montar({ memoria: 'Posto Alfa', armazenado: 'Ponto #3' });
        digitar(m, 'Posto Alfa', 'Enter');
        await assentar();
        expect(box.writes).toHaveLength(1);
        expect(box.stored.get(ID).properties.nome).toBe('Posto Alfa');
        // Nada a preparar: a memória já tinha o nome.
        expect(m.renomes).toEqual([]);
    });

    it('nome igual ao do store não escreve nada', async () => {
        const m = await montar();
        digitar(m, 'Ponto #3', 'Enter');
        await assentar();
        expect(box.writes).toHaveLength(0);
    });

    it('RECUSA (posto ou trava): a tela, a memória e a fonte voltam ao que o store tem', async () => {
        box.refuse = true;
        const m = await montar();
        digitar(m, 'Posto Charlie', 'Enter');
        expect(m.display.textContent).toBe('Posto Charlie');
        await assentar();

        expect(box.writes, 'a escrita foi tentada, e o guarda a recusou').toHaveLength(1);
        expect(box.stored.get(ID).properties.nome).toBe('Ponto #3');
        expect(m.display.textContent).toBe('Ponto #3');
        expect(m.input.value).toBe('Ponto #3');
        expect(m.feature.properties.nome).toBe('Ponto #3');
        expect(m.renomes, 'preparou o novo e depois repintou o guardado').toEqual(['Posto Charlie', 'Ponto #3']);
    });

    it('FEIÇÃO QUE SUMIU do store: nada é escrito, o campo volta, e a fonte não é repintada', async () => {
        const m = await montar({ armazenado: SEM_REGISTRO });
        digitar(m, 'Posto Delta', 'Enter');
        await assentar();
        expect(box.writes).toHaveLength(0);
        expect(m.display.textContent).toBe('Ponto #3');
        expect(m.feature.properties.nome).toBe('Ponto #3');
        expect(m.renomes).toEqual(['Posto Delta']);
    });

    it('MAPA TROCADO entre a montagem e a confirmação: nada é preparado nem escrito', async () => {
        const m = await montar();
        box.currentMap = 'Outro mapa';
        digitar(m, 'Posto Eco', 'Enter');
        await assentar();
        expect(box.writes).toHaveLength(0);
        expect(m.renomes).toEqual([]);
        expect(m.feature.properties.nome).toBe('Ponto #3');
        expect(m.display.textContent).toBe('Ponto #3');
    });

    it('MAPA TROCADO durante a leitura do store: nada é escrito', async () => {
        const m = await montar();
        digitar(m, 'Posto Foxtrot', 'Enter');
        box.currentMap = 'Outro mapa';
        await assentar();
        expect(box.writes).toHaveLength(0);
        expect(m.display.textContent).toBe('Ponto #3');
    });

    it('Escape cancela, e o blur que vem depois não grava', async () => {
        const m = await montar();
        digitar(m, 'Posto Golf', 'Escape');
        disparar(m.input, 'blur');
        await assentar();
        expect(box.writes).toHaveLength(0);
        expect(m.renomes).toEqual([]);
        expect(m.input.value).toBe('Ponto #3');
    });

    it('abrir e sair do campo de uma feição sem nome não grava o rótulo', async () => {
        const m = await montar({ memoria: SEM_NOME, armazenado: SEM_NOME });
        expect('nome' in m.feature.properties, 'controle: a feição montada não tem nome').toBe(false);
        expect(m.display.textContent).toBe(UNNAMED_LABEL);
        digitar(m, '');
        disparar(m.input, 'blur');
        await assentar();
        expect(box.writes).toHaveLength(0);
        expect(m.display.textContent).toBe(UNNAMED_LABEL);
    });

    it('O CAMPO ABERTO NUMA DESMONTAGEM sem blur é confirmado pelo gancho, e um campo fechado o ignora', async () => {
        const m = await montar();
        expect(typeof m.input[PENDING_NAME_COMMIT]).toBe('function');

        // Campo fechado: o gancho é chamado e não faz nada.
        expect(commitOpenNameFields(raizConsultavel(m.container))).toBe(1);
        await assentar();
        expect(box.writes).toHaveLength(0);

        // Campo aberto com texto não confirmado: a desmontagem o confirma.
        digitar(m, 'Posto Hotel');
        expect(commitOpenNameFields(raizConsultavel(m.container))).toBe(1);
        await assentar();
        expect(box.stored.get(ID).properties.nome).toBe('Posto Hotel');
    });
});

describe('2b. o gancho de confirmação, isolado', () => {
    it('só chama quem tem o gancho: os campos dos painéis 3D e 360 reusam a classe sem ele', () => {
        const chamadas = [];
        const comGancho = { [PENDING_NAME_COMMIT]: () => chamadas.push('2d') };
        const semGancho = {};
        const raiz = { querySelectorAll: () => [semGancho, comGancho, null] };
        expect(commitOpenNameFields(raiz)).toBe(1);
        expect(chamadas).toEqual(['2d']);
    });

    it('raiz ausente ou sem consulta não é erro (o painel pode ainda não ter conteúdo)', () => {
        expect(commitOpenNameFields(null)).toBe(0);
        expect(commitOpenNameFields(undefined)).toBe(0);
        expect(commitOpenNameFields({})).toBe(0);
    });
});

// ============================================================================
// 3. A TROCA DE CONTEÚDO, com a corrida tornada determinística
// ============================================================================

describe('3. a construção assíncrona do painel contra o conteúdo que ela substitui', () => {
    function construcaoControlada() {
        let resolver;
        const promessa = new Promise((r) => { resolver = r; });
        return { build: () => promessa, terminar: (valor) => resolver(valor) };
    }

    it('A CAUSA: o retrato do conteúdo novo, tirado depois da edição, não vê edição nenhuma', () => {
        // O conteúdo que sai e o que entra editam a MESMA cópia da feição. Se a edição cai antes
        // do retrato do novo, o "Salvar" do novo não tem diferença a gravar, e o do velho, que a
        // teria, já rodou no início da reconstrução.
        const copia = { id: ID, nome: 'Ponto #3', fillColor: '#ff0000' };
        const retratoDoVelho = structuredClone(copia);
        copia.nome = 'Posto Alfa';                     // editado no conteúdo que ainda está na tela
        const retratoDoNovo = structuredClone(copia);  // `createInitialPropertiesMap` do novo
        expect(pendingPropertyEdits(copia, retratoDoNovo), 'o novo não tem nada a gravar').toEqual({});
        expect(pendingPropertyEdits(copia, retratoDoVelho), 'só o velho sabe da edição').toEqual({ nome: 'Posto Alfa' });
    });

    it('a edição feita no conteúdo que SAI durante a construção é salva ANTES da troca', async () => {
        const ordem = [];
        const { build, terminar } = construcaoControlada();
        let editadoNoVelho = false;

        const pronto = finishFeaturePanelBuild({
            build,
            isCurrent: () => true,
            flushOutgoing: () => ordem.push(editadoNoVelho ? 'salva o velho COM a edição' : 'salva o velho'),
            show: (r) => ordem.push(`mostra ${r}`),
            discard: () => ordem.push('descarta'),
        });

        editadoNoVelho = true; // a pessoa edita o painel que continua na tela
        terminar('novo');
        await expect(pronto).resolves.toBe(true);
        expect(ordem).toEqual(['salva o velho COM a edição', 'mostra novo']);
    });

    it('UM FECHAMENTO DURANTE A CONSTRUÇÃO a descarta: o painel não reabre para quem já saiu', async () => {
        const ordem = [];
        const { build, terminar } = construcaoControlada();
        let versao = 1;
        const minha = versao;

        const pronto = finishFeaturePanelBuild({
            build,
            isCurrent: () => minha === versao,
            flushOutgoing: () => ordem.push('salva o velho'),
            show: () => ordem.push('mostra'),
            discard: (r) => ordem.push(`descarta ${r}`),
        });

        versao += 1; // `_onFeaturePanelClosed` (deselect, Escape) ou a barra lateral abrindo
        terminar('zumbi');
        await expect(pronto).resolves.toBe(false);
        expect(ordem, 'nada toca a tela, e o que foi construído é liberado').toEqual(['descarta zumbi']);
    });

    it('construção sem conteúdo (seleção vazia) ainda troca a tela, como antes', async () => {
        const mostrados = [];
        const mostrou = await finishFeaturePanelBuild({
            build: async () => null,
            isCurrent: () => true,
            flushOutgoing: () => {},
            show: (r) => mostrados.push(r),
        });
        expect(mostrou).toBe(true);
        expect(mostrados).toEqual([null]);
    });

    it('falha da construção propaga e não toca a tela', async () => {
        const ordem = [];
        await expect(finishFeaturePanelBuild({
            build: async () => { throw new Error('quebrou'); },
            isCurrent: () => true,
            flushOutgoing: () => ordem.push('salva'),
            show: () => ordem.push('mostra'),
        })).rejects.toThrow('quebrou');
        expect(ordem).toEqual([]);
    });
});

// ============================================================================
// 4. O SALVAMENTO REPETIDO DO MESMO PAINEL, que a troca passou a pedir
// ============================================================================

describe('4. dois salvamentos do mesmo painel não se sobrepõem', () => {
    it('o segundo só começa depois de o primeiro fechar o lote de desfazer', async () => {
        // Seleção MÚLTIPLA, que é a que abre o coletor de lote GLOBAL: um segundo
        // `startBatchUndo` no meio do primeiro salvamento zeraria o que ele já coletou.
        const ordem = [];
        let liberarPrimeiro = null;
        let chamadas = 0;
        const control = {
            saveFeatures: async () => {
                chamadas += 1;
                const n = chamadas;
                ordem.push(`salva ${n} começa`);
                if (n === 1) await new Promise((r) => { liberarPrimeiro = r; });
                ordem.push(`salva ${n} termina`);
            },
            discardChangeFeatures: async () => {},
        };
        const botoes = createModernButtons({
            selectedFeatures: [{ properties: { id: 'a' } }, { properties: { id: 'b' } }],
            control,
            selectionManager: { deselectAllFeatures() {} },
            initialPropertiesMap: new Map(),
        });
        const salvar = acharNaArvore(botoes, (el) => temClasse(el, 'attr-modern-btn-save'));
        expect(typeof salvar?._saveOnly).toBe('function');

        // O início da reconstrução e a troca, um logo atrás do outro.
        const primeiro = salvar._saveOnly();
        const segundo = salvar._saveOnly();
        await assentar();
        expect(ordem, 'o segundo espera o primeiro').toEqual(['salva 1 começa']);
        expect(box.lote).toEqual(['start']);

        liberarPrimeiro();
        await Promise.all([primeiro, segundo]);
        expect(ordem).toEqual(['salva 1 começa', 'salva 1 termina', 'salva 2 começa', 'salva 2 termina']);
        expect(box.lote, 'dois lotes inteiros, nenhum aberto por cima do outro')
            .toEqual(['start', 'commit', 'start', 'commit']);
    });

    it('um salvamento que falha não tranca os seguintes', async () => {
        let chamadas = 0;
        const control = {
            saveFeatures: async () => {
                chamadas += 1;
                if (chamadas === 1) throw new Error('IndexedDB recusou');
            },
            discardChangeFeatures: async () => {},
        };
        const erro = vi.spyOn(console, 'error').mockImplementation(() => {});
        try {
            const botoes = createModernButtons({
                selectedFeatures: [{ properties: { id: 'a' } }, { properties: { id: 'b' } }],
                control,
                selectionManager: { deselectAllFeatures() {} },
                initialPropertiesMap: new Map(),
            });
            const salvar = acharNaArvore(botoes, (el) => temClasse(el, 'attr-modern-btn-save'));
            await salvar._saveOnly();
            await salvar._saveOnly();
            expect(chamadas).toBe(2);
            expect(box.lote).toEqual(['start', 'discard', 'start', 'commit']);
        } finally {
            erro.mockRestore();
        }
    });
});
