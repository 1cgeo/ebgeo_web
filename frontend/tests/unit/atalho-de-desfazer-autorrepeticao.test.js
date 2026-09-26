// Path: tests/unit/atalho-de-desfazer-autorrepeticao.test.js
//
// O ATALHO DIZ AO RUNNER QUANDO O PEDIDO É A TECLA SEGURADA (decisão do dono de 2026-09-26).
//
// Desde que desfazer e refazer seguidos esperam a vez (`map/undo-redo.runner.js`), o que separa o
// segundo Ctrl+Z de quem apertou duas vezes do Ctrl+Z SEGURADO é o `KeyboardEvent.repeat`: sem ele
// chegando ao runner, segurar a tecla enfileiraria dezenas de desfazer por segundo, e a pilha
// inteira iria embora num gesto só.
//
// O QUE ESTE VERDE PROVA: que o teclado passa `repeticao` igual ao `repeat` do evento, nas duas
// direções, e que um evento sem a propriedade conta como pedido novo. A regra do que a repetição
// faz na fila é de `tests/unit/desfazer-seguido-espera-a-vez.repro.test.js`.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const runUndoRedo = vi.hoisted(() => vi.fn(async () => true));

vi.mock('@store', () => ({ getStateManager: () => ({}) }));
vi.mock('@modals/index.js', () => ({ showConfirm: vi.fn(async () => false) }));
vi.mock('@utils/toast_service.js', () => ({ showWarning: vi.fn() }));
vi.mock('@js/map/undo-redo.runner.js', () => ({ runUndoRedo }));
vi.mock('@ui/view-mode.controller.js', () => ({ getViewModeController: () => ({ toggleManualView: vi.fn() }) }));
vi.mock('@tools/tool-registry.js', () => ({ ensureControl: vi.fn(async () => null) }));
vi.mock('@store/edicao-indisponivel.js', () => ({ semEdicaoSync: () => false }));

const KeyboardShortcuts = (await import('../../src/js/keyboard/keyboard-shortcuts.js')).default;

function teclado() {
    return new KeyboardShortcuts({
        map: {}, selectionManager: { deselectAllFeatures: vi.fn() }, clipboardManager: {},
        toolManager: { deactivateCurrentTool: vi.fn(), setActiveTool: vi.fn() },
        baseLayerControl: {}, addStreetViewControl: { isOpen: false }, controls: {},
    });
}

/** Um Ctrl+<letra> no canvas do mapa, como o navegador o entrega. */
function ctrl(letra, extra = {}) {
    return {
        key: letra, code: `Key${letra.toUpperCase()}`, ctrlKey: true, shiftKey: false, altKey: false, metaKey: false,
        target: { tagName: 'CANVAS', isContentEditable: false, closest: () => null },
        preventDefault: vi.fn(),
        ...extra,
    };
}

beforeEach(() => runUndoRedo.mockClear());

describe('o atalho passa a autorrepetição ao runner', () => {
    it.each([['z', 'undo'], ['y', 'redo']])('Ctrl+%s segurado chega como repetição (%s)', async (letra, direcao) => {
        await teclado().handleKeyDown(ctrl(letra, { repeat: true }));
        expect(runUndoRedo).toHaveBeenCalledTimes(1);
        expect(runUndoRedo).toHaveBeenCalledWith(direcao, expect.any(Object), { repeticao: true });
    });

    it.each([['z', 'undo'], ['y', 'redo']])('Ctrl+%s apertado de novo é pedido novo (%s)', async (letra, direcao) => {
        await teclado().handleKeyDown(ctrl(letra, { repeat: false }));
        expect(runUndoRedo).toHaveBeenCalledWith(direcao, expect.any(Object), { repeticao: false });
    });

    it('um evento sem `repeat` conta como pedido novo, nunca como repetição', async () => {
        await teclado().handleKeyDown(ctrl('z'));
        expect(runUndoRedo).toHaveBeenCalledWith('undo', expect.any(Object), { repeticao: false });
    });
});
