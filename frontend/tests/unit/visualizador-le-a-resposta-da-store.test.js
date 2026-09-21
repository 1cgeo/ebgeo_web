// Path: tests/unit/visualizador-le-a-resposta-da-store.test.js

/**
 * QUEM ANUNCIA SUCESSO LEU A RESPOSTA DA STORE: os dois visualizadores (3D e 360).
 *
 * Defeito (achado colateral de 2026-09-21, na frente que fechou o mapa fantasma): "salvar posição
 * da câmera" (`3d_models_viewer_tool/map_3d.js`) e "salvar orientação"
 * (`street_view_tool/street_view_viewer.js`) chamavam a store, DESCARTAVAM o retorno e anunciavam
 * sucesso. A recusa da store não lança (papel, mapa travado e, desde aquela data, mapa que o atlas
 * de servidor não tem mais), então uma recusa punha na tela o aviso de sucesso AO LADO do aviso de
 * recusa.
 *
 * A causa tinha duas metades, e o teste prende as duas:
 *   1. as duas operações devolviam `undefined` no sucesso E na recusa, então não havia resposta a
 *      ler (presa por comportamento em `tests/store/cesium3d-operations.test.js` e
 *      `tests/store/streetview360-operations.test.js`, que exigem `true` e `false`);
 *   2. a tela não lia resposta nenhuma (presa aqui, por leitura do texto, porque os dois arquivos
 *      arrastam o Cesium e o motor 360 e não montam em node).
 *
 * É a mesma família que `ajuste-de-mapa-pergunta-pela-trava.test.js` vigia para o editor de notas;
 * aquele censo não alcança estas duas pastas.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** Reads a source file and returns the body of `nome`, from its declaration to the next top-level one. */
function corpoDe(arquivo, nome) {
    const texto = readFileSync(path.join(RAIZ, arquivo), 'utf8').replace(/\r\n/g, '\n');
    const inicio = texto.search(new RegExp(`async function ${nome}\\(`));
    expect(inicio, `${nome} saiu de ${arquivo}: reconfira este guarda`).toBeGreaterThan(-1);
    const resto = texto.slice(inicio + 1);
    const fim = resto.search(/\n(export )?(async )?function /);
    return resto.slice(0, fim === -1 ? undefined : fim);
}

const SITIOS = [
    {
        arquivo: 'src/js/3d_models_viewer_tool/map_3d.js',
        funcao: 'saveCurrentCameraPosition',
        chamada: /const saved = await saveCameraPosition\(/,
        efeito: 'updateCameraButtonState(true)',
    },
    {
        arquivo: 'src/js/street_view_tool/street_view_viewer.js',
        funcao: 'handleSaveOrientation',
        chamada: /const saved = await saveOrientation\(/,
        efeito: "showSuccess('Orientação salva')",
    },
];

describe('os dois visualizadores leem a resposta da store antes de anunciar', () => {
    it('PISO: os dois sítios existem e ainda chamam a store', () => {
        expect(SITIOS).toHaveLength(2);
        for (const s of SITIOS) expect(corpoDe(s.arquivo, s.funcao)).toMatch(s.chamada);
    });

    for (const s of SITIOS) {
        it(`${s.funcao}: a recusa sai ANTES do efeito de sucesso`, () => {
            const corpo = corpoDe(s.arquivo, s.funcao);
            const leitura = corpo.search(/if \(saved !== true\) return/);
            const efeito = corpo.indexOf(s.efeito);
            expect(leitura, 'a resposta da store deixou de ser lida').toBeGreaterThan(-1);
            expect(efeito, 'o efeito de sucesso saiu do lugar: reconfira este guarda').toBeGreaterThan(-1);
            expect(leitura).toBeLessThan(efeito);
        });

        it(`${s.funcao}: o retorno não é descartado (a forma exata do defeito)`, () => {
            const corpo = corpoDe(s.arquivo, s.funcao);
            // The defect was a bare `await saveX(...)` statement: the value thrown away.
            expect(corpo).not.toMatch(/\n\s*await save(CameraPosition|Orientation)\(/);
        });
    }
});
