// Path: tests/unit/desfazer-seguido-espera-a-vez.repro.test.js
//
// DESFAZER E REFAZER SEGUIDOS ESPERAM A VEZ (decisão do dono de 2026-09-26).
//
// CAUSA RAIZ: `runUndoRedo` guardava a reentrância com uma bandeira de módulo e DESCARTAVA em
// silêncio o pedido que chegasse com outro em curso. O desenho queria impedir o botão e o atalho
// de desfazerem dois passos juntos, mas o que ele descartava era também o segundo Ctrl+Z de quem
// aperta duas vezes: a janela era de 3 a 5 ms num mapa pequeno e cresce com o redesenho do mapa
// base num mapa pesado, e a pessoa via um passo desfeito onde pediu dois.
//
// O QUE ESTE VERDE PROVA: que o segundo pedido roda, e só depois de o primeiro terminar (o
// redesenho incluído); que a AUTORREPETIÇÃO do teclado, que é a mesma tecla segurada e não um
// segundo pedido, continua filtrada enquanto houver pedido na fila; que o gate de escrita é
// perguntado na VEZ de cada pedido, não na chegada; e que um pedido que falha não trava a fila.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const estado = vi.hoisted(() => ({ semEdicao: false, chamadas: [], abertos: [] }));

/** Cada chamada da store fica pendente até o teste soltá-la, para medir a ordem. */
function chamadaPendente(nome) {
    return vi.fn(() => new Promise((resolve, reject) => {
        estado.chamadas.push(nome);
        estado.abertos.push({ nome, resolve, reject });
    }));
}

vi.mock('@store', () => ({
    undoLastAction: chamadaPendente('undo'),
    redoLastAction: chamadaPendente('redo'),
}));
vi.mock('@store/edicao-indisponivel.js', () => ({ semEdicaoSync: () => estado.semEdicao }));
vi.mock('@utils/toast_service.js', () => ({ showInChannel: vi.fn() }));
vi.mock('@store/undo-redo-messages.js', () => ({ describeUndoRedoAction: () => 'feito' }));

const { runUndoRedo } = await import('@js/map/undo-redo.runner.js');

/** Deixa as promessas encadeadas andarem. */
const assentar = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Solta a chamada aberta mais antiga com o valor dado, esperando-a abrir (a fila a abre depois). */
async function soltar(valor = { type: 'x' }) {
    for (let i = 0; i < 20 && estado.abertos.length === 0; i += 1) await assentar();
    const aberta = estado.abertos.shift();
    if (!aberta) throw new Error('nenhuma chamada aberta');
    aberta.resolve(valor);
    await assentar();
}

function deps() {
    return {
        selectionManager: { deselectAllFeatures: vi.fn() },
        baseLayerControl: { switchMap: vi.fn(async () => { estado.chamadas.push('redesenho'); }) },
    };
}

beforeEach(async () => {
    // Esvazia qualquer resto de um caso anterior antes de zerar o registro.
    while (estado.abertos.length) await soltar(null);
    estado.semEdicao = false;
    estado.chamadas.length = 0;
});

describe('o segundo pedido espera a vez', () => {
    it('REPRO: dois Ctrl+Z seguidos desfazem dois passos, o segundo depois do redesenho do primeiro', async () => {
        const primeiro = runUndoRedo('undo', deps());
        const segundo = runUndoRedo('undo', deps());
        await assentar();
        expect(estado.chamadas, 'o segundo não começa com o primeiro em curso').toEqual(['undo']);

        await soltar();
        expect(await primeiro).toBe(true);
        expect(estado.chamadas).toEqual(['undo', 'redesenho', 'undo']);

        await soltar();
        expect(await segundo, 'o segundo pedido não foi descartado').toBe(true);
        expect(estado.chamadas).toEqual(['undo', 'redesenho', 'undo', 'redesenho']);
    });

    it('o botão e o atalho, um depois do outro, também esperam a vez e não se descartam', async () => {
        const peloAtalho = runUndoRedo('undo', deps());
        const peloBotao = runUndoRedo('redo', deps());
        await soltar();
        await soltar();
        expect([await peloAtalho, await peloBotao]).toEqual([true, true]);
        expect(estado.chamadas.filter((c) => c !== 'redesenho')).toEqual(['undo', 'redo']);
    });

    it('a autorrepetição da tecla segurada é filtrada enquanto há pedido na fila', async () => {
        const primeiro = runUndoRedo('undo', deps());
        const repeticao = runUndoRedo('undo', deps(), { repeticao: true });
        expect(await repeticao, 'a repetição com a fila ocupada não entra').toBe(false);
        await soltar();
        await primeiro;
        expect(estado.chamadas.filter((c) => c === 'undo')).toHaveLength(1);
    });

    it('a autorrepetição com a fila vazia roda, como antes', async () => {
        const repeticao = runUndoRedo('undo', deps(), { repeticao: true });
        await soltar();
        expect(await repeticao).toBe(true);
    });

    it('o gate de escrita é perguntado na VEZ do pedido: a trava que chega na espera o recusa', async () => {
        const primeiro = runUndoRedo('undo', deps());
        const segundo = runUndoRedo('undo', deps());
        await assentar();
        expect(estado.chamadas, 'o primeiro já está em curso quando a trava chega').toEqual(['undo']);
        estado.semEdicao = true;
        await soltar();
        await primeiro;
        expect(await segundo).toBe(false);
        expect(estado.chamadas.filter((c) => c === 'undo')).toHaveLength(1);
    });

    it('um pedido que falha não trava a fila', async () => {
        const primeiro = runUndoRedo('undo', deps());
        const segundo = runUndoRedo('undo', deps());
        await assentar();
        estado.abertos.shift().reject(new Error('falhou'));
        await expect(primeiro).rejects.toThrow('falhou');
        await assentar();
        await soltar();
        expect(await segundo).toBe(true);
    });

    it('sem edição na chegada, nada entra na fila', async () => {
        estado.semEdicao = true;
        expect(await runUndoRedo('undo', deps())).toBe(false);
        expect(estado.chamadas).toEqual([]);
    });
});
