// Path: tests/unit/item-de-grupo-le-a-resposta-da-store.test.js

/**
 * O ITEM DE GRUPO LÊ A RESPOSTA DA STORE ANTES DE PINTAR O ESTADO NOVO.
 *
 * Defeito (anterior a 2026-09-21, achado pelo inventário de escritores de grupo): o olho e o
 * cadeado do grupo na aba de feições (`src/js/features_tab/group-item.component.js`) chamavam
 * `updateGroupProperty`, DESCARTAVAM o retorno, propagavam `visivel`/`bloqueado` para a fonte do
 * MapLibre feição a feição e atualizavam a linha da árvore. A recusa da store não lança: a fachada
 * devolve `false` por papel e por mapa travado, e o funil devolve `undefined` para o mapa que o
 * atlas de servidor não tem mais. A tela mostrava o grupo oculto ou bloqueado enquanto a store
 * guardava o estado antigo, e o aviso de recusa aparecia ao lado de um estado que ele desmentia.
 *
 * O comportamento das duas recusas está preso nos testes da store; aqui fica a FORMA da tela, por
 * leitura do texto, porque o componente monta DOM e não roda em node. É a mesma família de
 * `visualizador-le-a-resposta-da-store.test.js` e do editor de notas.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ARQUIVO = path.resolve(path.dirname(fileURLToPath(import.meta.url)),
    '../../src/js/features_tab/group-item.component.js');
const CODIGO = readFileSync(ARQUIVO, 'utf8').replace(/\r\n/g, '\n');

function corpoDe(nome) {
    const inicio = CODIGO.indexOf(`export async function ${nome}(`);
    expect(inicio, `${nome} saiu do componente: reconfira este guarda`).toBeGreaterThan(-1);
    const resto = CODIGO.slice(inicio + 1);
    const fim = resto.search(/\nexport (async )?function /);
    return resto.slice(0, fim === -1 ? undefined : fim);
}

// O efeito no MAPA de cada gesto. O do olho deixou de ser um remendo de `visivel` na fonte em
// 2026-09-24 (grupo oculto só sumia na sessão de quem ocultou): ele reaplica o filtro de desenho a
// partir dos grupos guardados, e é essa chamada que a recusa tem de preceder.
const GESTOS = [
    { funcao: 'toggleGroupVisibility', propriedade: 'visible', mapa: 'reapplyGroupVisibility(', efeito: 'updateVisualState(' },
    { funcao: 'toggleGroupLock', propriedade: 'locked', mapa: 'propagatePropertyToSource(', efeito: 'updateLockState(' },
];

describe('o olho e o cadeado do grupo leem a resposta da store', () => {
    it('PISO: os dois gestos existem e ainda chamam a store', () => {
        expect(GESTOS).toHaveLength(2);
        for (const g of GESTOS) {
            expect(corpoDe(g.funcao)).toMatch(new RegExp(`updateGroupProperty\\(groupId, '${g.propriedade}',`));
        }
    });

    for (const g of GESTOS) {
        it(`${g.funcao}: a recusa sai ANTES de propagar para o mapa e ANTES de pintar a linha`, () => {
            const corpo = corpoDe(g.funcao);
            const leitura = corpo.search(/if \(!updated\) return;/);
            const propaga = corpo.indexOf(g.mapa);
            const efeito = corpo.indexOf(g.efeito);
            expect(leitura, 'a resposta da store deixou de ser lida').toBeGreaterThan(-1);
            expect(propaga).toBeGreaterThan(-1);
            expect(efeito).toBeGreaterThan(-1);
            expect(leitura).toBeLessThan(propaga);
            expect(leitura).toBeLessThan(efeito);
        });

        it(`${g.funcao}: o retorno não é descartado (a forma exata do defeito)`, () => {
            expect(corpoDe(g.funcao)).not.toMatch(/\n\s*await updateGroupProperty\(/);
        });
    }
});
