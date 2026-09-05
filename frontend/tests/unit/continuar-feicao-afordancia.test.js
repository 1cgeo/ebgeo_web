// Path: tests/unit/continuar-feicao-afordancia.test.js

/**
 * @fileoverview QUEM VÊ A ALÇA DE CONTINUAÇÃO, e o que ela é quando aparece.
 *
 * A REGRA QUE ESTE ARQUIVO PRENDE (`.claude/rules/architecture.md` §UI Architecture, decisão do
 * dono de 2026-08-24) tem dois lados, e aqui só um deles produz superfície:
 *
 *   - O POSTO SOME. Continuar é um `UPDATE_FEATURE`; quem não o tem não ganha alça nenhuma. Sem
 *     este arquivo, o defeito que volta é o que a alça de VÉRTICE já tem hoje: um Leitor recebe
 *     o comando, arrasta, e a store recusa em silêncio. `showExtensionHandles` devolvendo
 *     `false` não bastaria como afirmação, porque um `false` sem Marker nenhum e um `false`
 *     depois de dois Markers criados são a mesma linha de log: por isso o dublê de `maplibregl`
 *     CONTA as construções, e a asserção é sobre a contagem.
 *   - O ESTADO NÃO GANHA COMANDO NOVO, e isso é a decisão, não um esquecimento. A alça acompanha
 *     a alça de vértice: quem a liga é `createEditHandles`, que `selectFeature` não chama com o
 *     mapa travado, e feição bloqueada nem se seleciona. Desenhar uma alça de continuação onde a
 *     ferramenta já decidiu não desenhar nada seria inventar a única superfície acionável de uma
 *     tela que o produto escolheu deixar inerte. O que o estado ganha é a RECONSULTA no clique
 *     (o par pode travar o mapa com a alça na tela), e é `startExtending`, nos três controles,
 *     que a faz; aqui se prende o predicado que os três chamam.
 *
 * A FRASE DA RECUSA POR POSTO VEM DE `denialNotice`, keyed pela CAPACIDADE que o gate consultou,
 * nunca pelo papel. É a lição de `store/denial-phrases.js`: a sentença única anterior ("acesso
 * somente leitura") era falsa para todo degrau acima de Visualizador.
 *
 * O QUE ELE NÃO ALCANÇA: MapLibre de verdade, DOM de verdade (o ambiente é node), store de
 * verdade e a fiação nos três controles. A ordem das escritas de `finishExtending` (gate, store,
 * releitura, e só então a fonte) é medida pelo spec de Playwright
 * `browser-continuar-feicao.spec.js`, porque ela só existe contra a store real.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { denialNotice } from '@store/denial-phrases.js';

const FRONT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** O que os dublês de store devolvem em cada caso; reescrito por teste. */
const estado = {
    permissao: { allowed: true },
    permissaoLanca: false,
    mapaTravado: false,
    feicaoTravada: false,
};

vi.mock('@store', () => ({
    isCurrentMapLockedSync: () => estado.mapaTravado,
    isFeatureEffectivelyLocked: () => estado.feicaoTravada,
}));

vi.mock('@store/sync/permission-guard.js', () => ({
    checkPermission: (action) => {
        if (estado.permissaoLanca) throw new Error(`boom em ${action}`);
        return estado.permissao;
    },
}));

/**
 * O duble do MapLibre. Desde 2026-09-05 `line-extension.helpers.js` alcanca a biblioteca
 * pelo PONTO UNICO e nao mais por `globalThis.maplibregl`: o objeto exportado e ESTAVEL e
 * cada `beforeEach` troca a propriedade `Marker` dentro dele.
 */
const dubleDoMapLibre = {};
vi.mock('@js/map/maplibre.js', () => ({ maplibregl: dubleDoMapLibre }));

const {
    extensionDenialReason,
    hideExtensionHandles,
    showExtensionHandles,
} = await import('@tools/helpers/line-extension.helpers.js');

const {
    LOCKED_FEATURE_NOTICE,
    MERGED_ARROW_NOTICE,
} = await import('@tools/helpers/line-extension.model.js');

const A = [-43.2, -22.9];
const B = [-43.1, -22.8];
const C = [-43.0, -22.7];

/** Uma linha selecionável, com o eixo onde o produto o persiste. */
const linha = (extra = {}) => ({
    type: 'Feature',
    properties: { id: 'f-1', source: 'line', baseCoordinates: [A, B, C], ...extra },
    geometry: { type: 'LineString', coordinates: [A, B, C] },
});

/** Elemento de DOM mínimo: só o que `buildHandleElement` e os ouvintes tocam. */
function makeElement(tagName) {
    const el = {
        tagName,
        type: '',
        className: '',
        title: '',
        innerHTML: '',
        dataset: {},
        attributes: {},
        listeners: {},
        setAttribute(name, value) { el.attributes[name] = value; },
        getAttribute(name) { return el.attributes[name]; },
        addEventListener(type, handler) {
            (el.listeners[type] = el.listeners[type] || []).push(handler);
        },
        removeEventListener(type, handler) {
            const bucket = el.listeners[type];
            if (!bucket) return;
            const i = bucket.indexOf(handler);
            if (i >= 0) bucket.splice(i, 1);
        },
        /** Entrega um evento sintético a quem estiver ouvindo aquele tipo. */
        dispatch(type, event) {
            for (const handler of (el.listeners[type] || []).slice()) handler(event);
        },
        /** Quantos ouvintes restam ao todo, para medir a limpeza. */
        countListeners() {
            return Object.values(el.listeners).reduce((n, b) => n + b.length, 0);
        },
    };
    return el;
}

/** Um evento sintético que anota se a propagação foi parada e o default impedido. */
function makeEvent() {
    return {
        parou: false,
        impediu: false,
        stopPropagation() { this.parou = true; },
        preventDefault() { this.impediu = true; },
    };
}

/** Cada `new maplibregl.Marker(...)` construído nesta rodada. */
let marcadores = [];

/** Um mapa qualquer: o helper só o usa como chave e como alvo do `addTo`. */
const makeMap = () => ({ id: Symbol('map') });

/** Chamadas de `requestAnimationFrame` pendentes, para drená-las à mão. */
let quadros = [];

let originalDocument;
let originalRaf;

beforeEach(() => {
    estado.permissao = { allowed: true };
    estado.permissaoLanca = false;
    estado.mapaTravado = false;
    estado.feicaoTravada = false;
    marcadores = [];
    quadros = [];

    originalDocument = globalThis.document;
    originalRaf = globalThis.requestAnimationFrame;

    globalThis.document = { createElement: makeElement };
    globalThis.requestAnimationFrame = (cb) => { quadros.push(cb); return quadros.length; };
    dubleDoMapLibre.Marker = class {
        constructor(options) {
            this.options = options;
            this.lngLat = null;
            this.mapa = null;
            this.removido = false;
            marcadores.push(this);
        }
        setLngLat(lngLat) { this.lngLat = lngLat; return this; }
        addTo(map) { this.mapa = map; return this; }
        remove() { this.removido = true; return this; }
    };
});

afterEach(() => {
    globalThis.document = originalDocument;
    delete dubleDoMapLibre.Marker;
    globalThis.requestAnimationFrame = originalRaf;
});

/** Um controle de mentira, que só precisa expor `startExtending`. */
const makeControl = () => {
    const chamadas = [];
    return { chamadas, startExtending: (feature, end) => chamadas.push([feature, end]) };
};

// ============================================================================================
// O POSTO SOME
// ============================================================================================

describe('posto: sem UPDATE_FEATURE a alça NÃO NASCE', () => {
    it('nenhum Marker é construído, e a resposta é `false`', () => {
        estado.permissao = { allowed: false, required: 'canEdit' };
        const map = makeMap();

        expect(showExtensionHandles(map, linha(), makeControl())).toBe(false);
        // A contagem é a afirmação: `false` depois de dois Markers criados seria o mesmo `false`.
        expect(marcadores).toHaveLength(0);
    });

    it('a razão é a de `denialNotice`, keyed pela CAPACIDADE que o gate consultou', () => {
        estado.permissao = { allowed: false, required: 'canEdit' };
        expect(extensionDenialReason(linha())).toBe(denialNotice('canEdit'));

        // Uma capacidade que este build não conhece cai na frase genérica, e não numa afirmação
        // específica que pode ser falsa para quem a lê.
        estado.permissao = { allowed: false, required: 'canInventarAmanha' };
        expect(extensionDenialReason(linha())).toBe(denialNotice('canInventarAmanha'));
    });

    it('a permissão é a PRIMEIRA pergunta: ela vence até um mapa travado', () => {
        // A ordem importa porque decide QUAL frase a pessoa lê. Quem não tem o posto não deve
        // ser mandado destravar um mapa que continuaria recusando a escrita.
        estado.permissao = { allowed: false, required: 'canEdit' };
        estado.mapaTravado = true;
        expect(extensionDenialReason(linha())).toBe(denialNotice('canEdit'));
    });

    it('FALHA FECHADA: um `checkPermission` que lança esconde a alça', () => {
        estado.permissaoLanca = true;
        const map = makeMap();
        expect(extensionDenialReason(linha())).toBe(denialNotice(null));
        expect(showExtensionHandles(map, linha(), makeControl())).toBe(false);
        expect(marcadores).toHaveLength(0);
    });

    it('um `allowed` que não seja `true` também esconde: nada de truthy por acidente', () => {
        estado.permissao = { allowed: 'sim' };
        expect(extensionDenialReason(linha())).toBe(denialNotice(undefined));
        expect(showExtensionHandles(makeMap(), linha(), makeControl())).toBe(false);
        expect(marcadores).toHaveLength(0);
    });
});

// ============================================================================================
// O ESTADO: recusa, sem superfície nova
// ============================================================================================

describe('estado: mapa travado, feição bloqueada, camada ou grupo travado', () => {
    it('mapa travado NÃO desenha, e a frase nomeia o cadeado do mapa', () => {
        estado.mapaTravado = true;
        const map = makeMap();

        expect(showExtensionHandles(map, linha(), makeControl())).toBe(false);
        expect(marcadores).toHaveLength(0);
        expect(extensionDenialReason(linha())).toMatch(/mapa está bloqueado/i);
    });

    it('feição com o próprio cadeado NÃO desenha, com a frase do modelo', () => {
        expect(showExtensionHandles(makeMap(), linha({ bloqueado: true }), makeControl())).toBe(false);
        expect(marcadores).toHaveLength(0);
        expect(extensionDenialReason(linha({ bloqueado: true }))).toBe(LOCKED_FEATURE_NOTICE);
    });

    it('camada ou grupo travado NÃO desenha, e a frase é OUTRA, porque o cadeado é outro', () => {
        estado.feicaoTravada = true;
        expect(showExtensionHandles(makeMap(), linha(), makeControl())).toBe(false);
        expect(marcadores).toHaveLength(0);
        const frase = extensionDenialReason(linha());
        expect(frase).toMatch(/camada ou o grupo/i);
        expect(frase).not.toBe(LOCKED_FEATURE_NOTICE);
    });

    it('seta COMBINADA não ganha alça, porque reescrever o eixo dela não muda a tela', () => {
        const seta = linha({ source: 'arrow', isMerged: true, branches: [[A, B], [B, C]] });
        expect(showExtensionHandles(makeMap(), seta, makeControl())).toBe(false);
        expect(extensionDenialReason(seta)).toBe(MERGED_ARROW_NOTICE);
    });

    it('mas a separação INTERROMPIDA (`isMerged` sem ramos) GANHA alça: ali continuar funciona', () => {
        // O par negativo do caso acima, e é ele que impede a recusa de virar "toda seta com a
        // chave ligada". Uma separação interrompida desenha por `baseCoordinates` e não tem
        // "Separar Setas" para limpar a chave: sumir com a alça ali seria tirar a única saída.
        const meioSeparada = linha({ source: 'arrow', isMerged: true });
        expect(extensionDenialReason(meioSeparada)).toBeNull();
        expect(showExtensionHandles(makeMap(), meioSeparada, makeControl())).toBe(true);
        expect(marcadores).toHaveLength(2);
    });

    it('sem `startExtending` no controle, nada é desenhado: o comando não teria destino', () => {
        expect(showExtensionHandles(makeMap(), linha(), {})).toBe(false);
        expect(marcadores).toHaveLength(0);
    });
});

// ============================================================================================
// O CAMINHO LIVRE
// ============================================================================================

describe('com posto e sem cadeado: DUAS alças, uma em cada ponta', () => {
    it('nascem dois Markers, nas duas extremidades do eixo, acima do vértice', () => {
        const map = makeMap();
        expect(showExtensionHandles(map, linha(), makeControl())).toBe(true);
        expect(extensionDenialReason(linha())).toBeNull();
        expect(marcadores).toHaveLength(2);

        expect(marcadores[0].lngLat).toEqual(A);
        expect(marcadores[1].lngLat).toEqual(C);
        for (const m of marcadores) {
            expect(m.mapa).toBe(map);
            // O deslocamento é o que impede a alça de roubar o arraste do vértice, que ocupa
            // exatamente a mesma coordenada.
            expect(m.options.offset[0]).toBe(0);
            expect(m.options.offset[1]).toBeLessThan(0);
            expect(m.options.anchor).toBe('center');
        }
    });

    it('cada alça é um `<button>` de verdade, nomeado e distinguível por ponta', () => {
        showExtensionHandles(makeMap(), linha(), makeControl());
        const [inicio, fim] = marcadores.map((m) => m.options.element);

        for (const el of [inicio, fim]) {
            expect(el.tagName).toBe('button');
            // `type="button"` porque um botão sem tipo dentro de um formulário submete.
            expect(el.type).toBe('button');
            expect(el.className).toContain('line-extension-handle');
            expect(el.title).toBe('Continuar a partir desta ponta');
            expect(el.getAttribute('aria-label')).toBe('Continuar a partir desta ponta');
            // Ícone SVG estático, sem uma única interpolação de dado de usuário.
            expect(el.innerHTML).toContain('<svg');
            expect(el.innerHTML).not.toContain('${');
        }

        expect(inicio.dataset.end).toBe('start');
        expect(fim.dataset.end).toBe('end');
        expect(inicio.className).toContain('line-extension-handle--start');
        expect(fim.className).toContain('line-extension-handle--end');
    });

    it('NUNCA a propriedade `disabled`: um botão desabilitado não dispara clique', () => {
        showExtensionHandles(makeMap(), linha(), makeControl());
        for (const m of marcadores) {
            expect(m.options.element.disabled).toBeUndefined();
            expect(m.options.element.getAttribute('disabled')).toBeUndefined();
        }
    });

    it('um eixo curto demais não produz alça, mesmo com posto e sem cadeado', () => {
        const curta = linha();
        curta.properties.baseCoordinates = [A];
        curta.geometry = { type: 'Point', coordinates: A };
        expect(showExtensionHandles(makeMap(), curta, makeControl())).toBe(false);
        expect(marcadores).toHaveLength(0);
    });
});

// ============================================================================================
// OS EVENTOS: engolir os quatro, adiar o clique um quadro
// ============================================================================================

describe('os eventos de ponteiro', () => {
    it('os QUATRO são engolidos: sem isso, um toque arrasta a feição e larga um vértice', () => {
        showExtensionHandles(makeMap(), linha(), makeControl());
        const el = marcadores[0].options.element;

        for (const tipo of ['click', 'mousedown', 'pointerdown', 'touchstart']) {
            const evento = makeEvent();
            expect(el.listeners[tipo], `nada ouve '${tipo}'`).toHaveLength(1);
            el.dispatch(tipo, evento);
            expect(evento.parou, `'${tipo}' não parou a propagação`).toBe(true);
        }
    });

    it('só o `click` impede o default, e só ele abre o modo', () => {
        const control = makeControl();
        showExtensionHandles(makeMap(), linha(), control);
        const el = marcadores[0].options.element;

        const arrasto = makeEvent();
        el.dispatch('mousedown', arrasto);
        expect(arrasto.impediu).toBe(false);
        expect(quadros).toHaveLength(0);

        const clique = makeEvent();
        el.dispatch('click', clique);
        expect(clique.impediu).toBe(true);
        expect(quadros).toHaveLength(1);
    });

    it('o clique é ADIADO UM QUADRO: no mesmo tique ele viraria o primeiro vértice', () => {
        // `startExtending` troca a ferramenta ativa, e é a troca que instala o ouvinte de clique
        // do mapa. Chamá-la dentro do handler deixaria este mesmo clique alcançar aquele
        // ouvinte.
        const control = makeControl();
        showExtensionHandles(makeMap(), linha(), control);

        marcadores[1].options.element.dispatch('click', makeEvent());
        expect(control.chamadas, 'chamou no mesmo tique do clique').toHaveLength(0);

        for (const cb of quadros.splice(0)) cb();
        expect(control.chamadas).toHaveLength(1);
        // E a ponta que chega é a do botão clicado, não a outra.
        expect(control.chamadas[0][1]).toBe('end');

        marcadores[0].options.element.dispatch('click', makeEvent());
        for (const cb of quadros.splice(0)) cb();
        expect(control.chamadas[1][1]).toBe('start');
    });
});

// ============================================================================================
// A LIMPEZA
// ============================================================================================

describe('hideExtensionHandles', () => {
    it('IDEMPOTENTE: chamar sem alça no ar, e duas vezes seguidas, não lança', () => {
        const map = makeMap();
        expect(() => hideExtensionHandles(map)).not.toThrow();

        showExtensionHandles(map, linha(), makeControl());
        hideExtensionHandles(map);
        expect(() => hideExtensionHandles(map)).not.toThrow();

        // E a segunda passada não remove de novo: os Markers já saíram na primeira.
        expect(marcadores.filter((m) => m.removido)).toHaveLength(2);
    });

    it('tira os Markers E os ouvintes: um handler pendurado seguraria a feição inteira', () => {
        const map = makeMap();
        showExtensionHandles(map, linha(), makeControl());
        const elementos = marcadores.map((m) => m.options.element);
        for (const el of elementos) expect(el.countListeners()).toBe(4);

        hideExtensionHandles(map);

        for (const m of marcadores) expect(m.removido).toBe(true);
        for (const el of elementos) expect(el.countListeners()).toBe(0);
    });

    it('redesenhar RECOLHE as alças antigas antes de criar as novas', () => {
        const map = makeMap();
        showExtensionHandles(map, linha(), makeControl());
        showExtensionHandles(map, linha(), makeControl());

        expect(marcadores).toHaveLength(4);
        expect(marcadores.slice(0, 2).every((m) => m.removido)).toBe(true);
        expect(marcadores.slice(2).some((m) => m.removido)).toBe(false);
    });

    it('cada mapa cuida das PRÓPRIAS alças: dois mapas coexistem sem se derrubar', () => {
        // O mapa principal e o mapa oculto do mosaico de PDF existem ao mesmo tempo; um slot de
        // módulo compartilhado deixaria um deles apagar os botões do outro.
        const mapaA = makeMap();
        const mapaB = makeMap();
        showExtensionHandles(mapaA, linha(), makeControl());
        showExtensionHandles(mapaB, linha(), makeControl());
        expect(marcadores).toHaveLength(4);

        hideExtensionHandles(mapaA);
        expect(marcadores.slice(0, 2).every((m) => m.removido)).toBe(true);
        expect(marcadores.slice(2).every((m) => m.removido)).toBe(false);
    });
});

// ============================================================================================
// A FIAÇÃO DO CSS
// ============================================================================================

describe('o CSS da alça chega ao navegador', () => {
    const MANIFESTO = readFileSync(resolve(FRONT, 'src/css/style.css'), 'utf8');
    const CSS = readFileSync(resolve(FRONT, 'src/css/line-extension.css'), 'utf8');

    it('está no MANIFESTO de `style.css`, que é o único CSS que `index.html` liga', () => {
        // O alvo é o manifesto, e não um import dentro do módulo JS: importar o CSS do JS
        // funciona no Vite e diverge da casa, e é o manifesto que decide se a regra chega ao
        // navegador.
        expect(MANIFESTO).toMatch(/@import url\('\.\/line-extension\.css'\);/);
    });

    it('a classe que o JS escreve é a mesma que o CSS estiliza', () => {
        // As duas metades da mesma afirmação: sem esta, o `@import` acima poderia estar ligando
        // um arquivo que não fala do botão que o helper monta.
        showExtensionHandles(makeMap(), linha(), makeControl());
        const classes = marcadores.map((m) => m.options.element.className);
        expect(classes[0]).toContain('line-extension-handle');
        expect(CSS).toContain('.line-extension-handle');
        expect(CSS).toContain('.line-extension-handle--start');
        expect(CSS).toContain('.line-extension-handle--end');
    });

    it('o alvo CRESCE no toque, onde não existe `:hover` para aumentá-lo', () => {
        expect(CSS).toMatch(/@media \(hover: none\)/);
        expect(CSS).toContain(':focus-visible');
    });

    it('só usa custom properties que `design-tokens.css` define', () => {
        // Um token inexistente não dá erro: a propriedade cai para o valor inicial e o botão
        // aparece transparente, sem sombra e quadrado, o que ninguém lê como defeito de token.
        const TOKENS = readFileSync(resolve(FRONT, 'src/css/design-tokens.css'), 'utf8');
        const usados = [...CSS.matchAll(/var\((--[a-z0-9-]+)\)/g)].map((m) => m[1]);
        expect(usados.length).toBeGreaterThan(0);
        for (const token of new Set(usados)) {
            expect(TOKENS, `${token} não existe em design-tokens.css`).toContain(`${token}:`);
        }
    });
});
