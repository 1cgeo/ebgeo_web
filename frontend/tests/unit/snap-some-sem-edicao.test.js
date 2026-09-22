// Path: tests/unit/snap-some-sem-edicao.test.js

/**
 * @fileoverview O SNAP SÓ EXISTE ONDE HÁ DESENHO (decisão do dono, 2026-09-22).
 *
 * O DEFEITO: o interruptor de snap da barra aparecia para o Leitor e para o Comentarista num atlas
 * de servidor. A trava do mapa já o escondia (a passada `_applyMapLockState` percorria os
 * interruptores), mas o POSTO não: `_createToggleButton` nunca lia `requiresEdit`, ao contrário do
 * botão de ação ao lado, então o snap não levava a marca `edit-affordance` que `view-mode.css`
 * esconde. O comentário do atalho G em `keyboard-shortcuts.js` afirmava o contrário ("a barra dele
 * já some pelo papel"), e era falso.
 *
 * O QUE ESTE ARQUIVO PRENDE:
 *   1. a regra, na folha `snapping/snap-availability.js`: os DOIS eixos escondem (inclusive a
 *      trava, que é o desvio deliberado da regra da casa), a forma positiva falha FECHADO, e o
 *      efetivo desliga com Ctrl inclusive, perguntando pela disponibilidade só quando grudaria;
 *   2. o serviço de snap obedecendo a regra sem ESCREVER a preferência da pessoa, e voltando a
 *      grudar quando a condição cai;
 *   3. a fiação: a tabela marca o snap com `requiresEdit`, o interruptor lê a bandeira pelo mesmo
 *      ajudante das ações, a passada da trava a lê também, e `map_sig.js` entrega ao serviço a
 *      conta ÚNICA dos dois eixos.
 *
 * O QUE ELE NÃO ALCANÇA: que o CSS de fato esconda o botão na tela (o censo de somente leitura
 * prende que `view-mode.css` esconde `.edit-affordance`; o pixel é do Playwright), nem que o
 * controlador de modo de visualização reaja a cada evento de sessão (isso é dele e do assinante
 * único de `edicao-indisponivel.js`).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { isSnapAvailable, isSnapEffective } from '../../src/js/snapping/snap-availability.js';
import { TOGGLE_TOOLS, ACTION_TOOLS } from '../../src/js/toolbar/toolbar.constants.js';

/** Lê um arquivo de `src/` pelo caminho relativo ao pacote. */
const fonte = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');

/** Remove comentários, para as asserções estruturais medirem CÓDIGO e não prosa. */
function semComentarios(texto) {
    return texto
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .map((linha) => linha.replace(/(^|[^:])\/\/.*$/, '$1'))
        .join('\n');
}

/** O corpo de um método de classe, do nome até o próximo método no mesmo recuo. */
function corpoDoMetodo(texto, nome) {
    const inicio = texto.indexOf(`    ${nome}(`);
    expect(inicio, `método ${nome} não achado`).toBeGreaterThan(-1);
    const resto = texto.slice(inicio + 1);
    const proximo = resto.search(/\n {4}[_a-zA-Z]\w*\s*(\(|=)/);
    return proximo === -1 ? resto : resto.slice(0, proximo);
}

// ============================================================================
// 1. A regra
// ============================================================================

describe('1. a regra da folha: quando o snap existe', () => {
    it('livre para editar: disponível', () => {
        expect(isSnapAvailable({ bloqueado: false, motivo: null, required: null })).toBe(true);
    });

    it('POSTO (Leitor, Comentarista): indisponível', () => {
        expect(isSnapAvailable({ bloqueado: true, motivo: 'permissao', required: 'canEdit' })).toBe(false);
    });

    it('ESTADO (mapa travado): indisponível também, e este é o desvio DECIDIDO da regra da casa', () => {
        // Com a trava o comando por estado costuma ser desenhado e recusar o clique. O snap não:
        // ele modifica o desenho, e com o mapa travado não há desenho. Quem "consertar" isto para
        // desenhar-e-recusar derruba este caso, e o caso está certo (decisions-2026, 2026-09-22).
        expect(isSnapAvailable({ bloqueado: true, motivo: 'map_locked', required: null })).toBe(false);
    });

    it('BORDA: resposta ausente ou malformada falha FECHADO', () => {
        for (const resposta of [undefined, null, {}, { bloqueado: undefined }, { bloqueado: 'false' }, { bloqueado: 0 }]) {
            expect(isSnapAvailable(resposta), JSON.stringify(resposta)).toBe(false);
        }
    });
});

describe('1b. o efetivo: XOR com o Ctrl, e só enquanto disponível', () => {
    const sempre = () => true;
    const nunca = () => false;

    it('disponível: a tabela-verdade do XOR fica como era', () => {
        expect(isSnapEffective({ preferred: true, ctrlHeld: false, isAvailable: sempre })).toBe(true);
        expect(isSnapEffective({ preferred: true, ctrlHeld: true, isAvailable: sempre })).toBe(false);
        expect(isSnapEffective({ preferred: false, ctrlHeld: false, isAvailable: sempre })).toBe(false);
        expect(isSnapEffective({ preferred: false, ctrlHeld: true, isAvailable: sempre })).toBe(true);
    });

    it('indisponível: nenhum dos quatro combos gruda, o Ctrl temporário inclusive', () => {
        for (const preferred of [true, false]) {
            for (const ctrlHeld of [true, false]) {
                expect(isSnapEffective({ preferred, ctrlHeld, isAvailable: nunca })).toBe(false);
            }
        }
    });

    it('a disponibilidade só é PERGUNTADA quando o XOR grudaria (caminho quente do mousemove)', () => {
        let perguntas = 0;
        const contar = () => { perguntas++; return true; };
        isSnapEffective({ preferred: false, ctrlHeld: false, isAvailable: contar });
        isSnapEffective({ preferred: true, ctrlHeld: true, isAvailable: contar });
        expect(perguntas).toBe(0);
        isSnapEffective({ preferred: true, ctrlHeld: false, isAvailable: contar });
        expect(perguntas).toBe(1);
    });

    it('sem regra dada, conta como disponível (suítes em node, página sem store)', () => {
        expect(isSnapEffective({ preferred: true, ctrlHeld: false })).toBe(true);
        expect(isSnapEffective({ preferred: true, ctrlHeld: false, isAvailable: null })).toBe(true);
    });

    it('BORDA: a regra que devolve algo que não é `true` não libera', () => {
        for (const valor of [undefined, null, 1, 'true', {}]) {
            expect(isSnapEffective({ preferred: true, ctrlHeld: false, isAvailable: () => valor })).toBe(false);
        }
    });
});

// ============================================================================
// 2. O serviço
// ============================================================================

describe('2. o serviço obedece a regra e não escreve a preferência', () => {
    let listeners;
    let service = null;

    beforeEach(() => {
        listeners = { doc: [], win: [] };
        globalThis.document = {
            addEventListener: (t, h) => listeners.doc.push([t, h]),
            removeEventListener: (t, h) => {
                const i = listeners.doc.findIndex(([lt, lh]) => lt === t && lh === h);
                if (i >= 0) listeners.doc.splice(i, 1);
            },
        };
        globalThis.window = {
            addEventListener: (t, h) => listeners.win.push([t, h]),
            removeEventListener: (t, h) => {
                const i = listeners.win.findIndex(([lt, lh]) => lt === t && lh === h);
                if (i >= 0) listeners.win.splice(i, 1);
            },
        };
    });

    afterEach(() => {
        // Singleton por construção: devolva-o, ou o próximo `new` reusa este.
        service?.destroy();
        service = null;
        delete globalThis.document;
        delete globalThis.window;
    });

    /** Gerente de estado SÓ DE LEITURA: um `set` aqui seria a preferência sendo apagada. */
    function estado(preferencia) {
        return {
            leituras: [],
            getUnsafe(chave) {
                this.leituras.push(chave);
                return chave === 'ui.snapping.enabled' ? preferencia : undefined;
            },
            set() { throw new Error('o snap nao pode escrever a preferencia da pessoa'); },
        };
    }

    const mapa = () => ({
        project: ([lng, lat]) => ({ x: lng, y: lat }),
        getLayer: (id) => (id === 'line-layer' ? { id } : undefined),
        queryRenderedFeatures: () => [{ geometry: { type: 'LineString', coordinates: [[0, 0], [100, 0]] }, properties: {} }],
        getSource: () => undefined,
    });

    const pressionaCtrl = (held) => {
        const tipo = held ? 'keydown' : 'keyup';
        for (const [t, h] of listeners.doc) if (t === tipo) h({ key: 'Control' });
    };

    it('preferência LIGADA e snap indisponível: não gruda, e devolve o ponto intocado', async () => {
        const { SnappingService } = await import('../../src/js/snapping/snapping.service.js');
        service = new SnappingService({ stateManager: estado(true), isAvailable: () => false });
        expect(service.resolve(mapa(), { x: 3, y: 0 }, { lng: 3, lat: 0 }))
            .toEqual({ lng: 3, lat: 0, snapped: false, snapType: null });
        // A preferência continua a mesma: o botão, quando voltar, mostra o que a pessoa deixou.
        expect(service.isEnabled()).toBe(true);
    });

    it('o Ctrl com a preferência DESLIGADA também não gruda enquanto indisponível', async () => {
        const { SnappingService } = await import('../../src/js/snapping/snapping.service.js');
        service = new SnappingService({ stateManager: estado(false), isAvailable: () => false });
        pressionaCtrl(true);
        expect(service.resolve(mapa(), { x: 3, y: 0 }, { lng: 3, lat: 0 }).snapped).toBe(false);
    });

    it('a condição cai: volta a grudar com a MESMA preferência, sem segundo clique', async () => {
        const { SnappingService } = await import('../../src/js/snapping/snapping.service.js');
        let pode = false;
        service = new SnappingService({ stateManager: estado(true), isAvailable: () => pode });
        expect(service.resolve(mapa(), { x: 3, y: 0 }, { lng: 3, lat: 0 }).snapped).toBe(false);
        pode = true;
        expect(service.resolve(mapa(), { x: 3, y: 0 }, { lng: 3, lat: 0 }).snapped).toBe(true);
    });

    it('CONTROLE: sem regra injetada, o serviço gruda como sempre grudou', async () => {
        const { SnappingService } = await import('../../src/js/snapping/snapping.service.js');
        service = new SnappingService({ stateManager: estado(true) });
        expect(service.resolve(mapa(), { x: 3, y: 0 }, { lng: 3, lat: 0 }).snapped).toBe(true);
    });

    it('indisponível, o mapa nem chega a ser consultado', async () => {
        const { SnappingService } = await import('../../src/js/snapping/snapping.service.js');
        service = new SnappingService({ stateManager: estado(true), isAvailable: () => false });
        let consultas = 0;
        const m = { ...mapa(), queryRenderedFeatures: () => { consultas++; return []; } };
        service.resolve(m, { x: 3, y: 0 }, { lng: 3, lat: 0 });
        expect(consultas).toBe(0);
    });
});

// ============================================================================
// 3. A fiação
// ============================================================================

describe('3. a fiação: tabela, barra e serviço leem a mesma regra', () => {
    it('o snap é o único interruptor, e a tabela o marca como modificador de edição', () => {
        // Lista FECHADA de propósito: um interruptor novo reprova aqui até alguém decidir se ele
        // modifica edição (`requiresEdit`) ou é pura vista, que sobrevive à trava e ao papel.
        expect(TOGGLE_TOOLS.map((t) => t.id), 'interruptor novo: classifique `requiresEdit`').toEqual(['snapping']);
        const snap = TOGGLE_TOOLS.find((t) => t.id === 'snapping');
        expect(snap).toBeDefined();
        expect(snap.statePath).toBe('ui.snapping.enabled');
        expect(snap.requiresEdit).toBe(true);
    });

    it('CONTROLE da tabela: compartilhar a vista continua sem a bandeira (é leitura)', () => {
        expect(ACTION_TOOLS.find((t) => t.id === 'share-view')?.requiresEdit).toBeUndefined();
        expect(ACTION_TOOLS.find((t) => t.id === 'undo')?.requiresEdit).toBe(true);
    });

    const barra = semComentarios(fonte('src/js/toolbar/toolbar.control.js'));

    it('o ajudante único transforma a bandeira na marca que `view-mode.css` esconde', () => {
        expect(barra).toMatch(/function standaloneButtonClass\(toolConfig\) \{\s*return toolConfig\.requiresEdit\s*\?\s*'toolbar-standalone-btn edit-affordance'\s*:\s*'toolbar-standalone-btn';/);
    });

    it('o interruptor E a ação usam o ajudante, e nenhum escreve a classe à mão', () => {
        for (const metodo of ['_createToggleButton', '_createActionButton']) {
            const corpo = corpoDoMetodo(barra, metodo);
            expect(corpo, metodo).toContain('button.className = standaloneButtonClass(toolConfig);');
            expect(corpo, metodo).not.toMatch(/button\.className = 'toolbar-standalone-btn'/);
        }
    });

    it('a passada da trava esconde os interruptores pela bandeira, não todos às cegas', () => {
        const corpo = corpoDoMetodo(barra, '_applyMapLockState');
        const trecho = corpo.slice(corpo.indexOf('TOGGLE_TOOLS.forEach'));
        expect(trecho).toMatch(/TOGGLE_TOOLS\.forEach\(toolConfig => \{\s*if \(!toolConfig\.requiresEdit\) return;/);
    });

    it('o serviço recebe a conta ÚNICA dos dois eixos, e não uma conta refeita', () => {
        const mapa = semComentarios(fonte('src/js/map_sig.js'));
        expect(mapa).toContain("import { edicaoIndisponivelSync } from '@store/edicao-indisponivel.js';");
        expect(mapa).toMatch(/new SnappingService\(\{\s*stateManager: getStateManager\(\),\s*isAvailable: \(\) => isSnapAvailable\(edicaoIndisponivelSync\(\)\),\s*\}\)/);
    });

    it('o atalho G não liga o snap escondido: a pergunta vem antes de escrever o estado', () => {
        const teclado = semComentarios(fonte('src/js/keyboard/keyboard-shortcuts.js'));
        const g = teclado.indexOf("if (key === 'g') {");
        expect(g).toBeGreaterThan(-1);
        const resto = teclado.slice(g);
        const fim = resto.search(/return;\r?\n {8}\}/);
        expect(fim).toBeGreaterThan(-1);
        const bloco = resto.slice(0, fim);
        const pergunta = bloco.indexOf('if (semEdicaoSync()) return;');
        const escrita = bloco.indexOf("sm.set('ui.snapping.enabled'");
        expect(pergunta).toBeGreaterThan(-1);
        expect(escrita).toBeGreaterThan(-1);
        expect(pergunta).toBeLessThan(escrita);
    });
});
