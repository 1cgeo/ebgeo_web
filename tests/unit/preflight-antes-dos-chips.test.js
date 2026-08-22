/**
 * A ORDEM dentro de `createControls`, guardada por leitura do fonte.
 *
 * POR QUE UM TESTE DE FONTE, e não de comportamento. `createControls` monta a
 * aplicação inteira: MapLibre, dezenas de controles, o gerenciador de estado.
 * Exercitá-la num teste exigiria dublar tudo isso, e o dublê é que passaria a
 * ser testado. O que precisa ser guardado aqui é uma ORDEM entre três pontos do
 * arquivo, e ela se lê.
 *
 * O DEFEITO QUE ISTO TRAVA, visto na tela pelo chefe em 2026-08-22: com o
 * preflight depois do `ChipsComponent`, o `CatalogService.hasItems()` roda com
 * `config.tilesets` ainda vazio, e o chip "Catálogo" NÃO É CRIADO. Some da
 * barra inteira, sem um erro no console. Antes de o catálogo 3D vir do serviço
 * isso não aparecia, porque os modelos estavam escritos à mão no config.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const fonte = readFileSync(
    fileURLToPath(new URL('../../src/js/map_sig.js', import.meta.url)),
    'utf-8'
);

/** Posição da primeira ocorrência, ou -1. */
function onde(marca) {
    return fonte.indexOf(marca);
}

describe('ordem em createControls', () => {
    const preflight360 = onde('// ===== STREET VIEW 360 PREFLIGHT =====');
    const preflight3d = onde('// ===== MODELOS 3D PREFLIGHT =====');
    const chips = onde('new ChipsComponent(');

    it('os dois preflights existem, e os chips também', () => {
        expect(preflight360, 'preflight do 360 sumiu').toBeGreaterThan(-1);
        expect(preflight3d, 'preflight dos modelos 3D sumiu').toBeGreaterThan(-1);
        expect(chips, 'ChipsComponent sumiu').toBeGreaterThan(-1);
    });

    it('o preflight dos MODELOS 3D vem antes do ChipsComponent', () => {
        expect(preflight3d).toBeLessThan(chips);
    });

    it('o preflight do 360 vem antes do ChipsComponent', () => {
        // Mesma razão: o catálogo lê as duas fontes, e o chip só nasce se
        // houver ao menos um item.
        expect(preflight360).toBeLessThan(chips);
    });

    it('os dois preflights vêm antes dos controles que os consomem', () => {
        const controle360 = onde("map.addControl(addStreetViewControl,");
        const controle3d = onde("map.addControl(add3DModelsViewerControl,");
        expect(controle360, 'controle do 360 sumiu').toBeGreaterThan(-1);
        expect(controle3d, 'controle dos modelos sumiu').toBeGreaterThan(-1);
        expect(preflight360).toBeLessThan(controle360);
        expect(preflight3d).toBeLessThan(controle3d);
    });
});

describe('o preflight 3D tem a MESMA forma do 360', () => {
    // Decisão do chefe em 2026-08-22: "vamos acertar para ficar igual ao do
    // 360". Os dois desligam a feature em três casos, e o teste guarda os três,
    // porque o meio-termo (desligar só num deles) não tem sintoma visível.
    const bloco3d = fonte.slice(
        onde('// ===== MODELOS 3D PREFLIGHT ====='),
        onde('// ===== TOOL CONTROLS =====')
    );

    it('cai sem serviceUrl', () => {
        expect(bloco3d).toMatch(/if \(!config\.models3d\?\.serviceUrl\)\s*\{\s*config\.features\.map_3d = false;/);
    });

    it('cai quando o preflight devolve falso', () => {
        expect(bloco3d).toMatch(/if \(!\(await preflightModelos3d\(\)\)\)\s*\{\s*config\.features\.map_3d = false;/);
    });

    it('cai quando o preflight estoura', () => {
        expect(bloco3d).toMatch(/catch\s*\{\s*config\.features\.map_3d = false;/);
    });

    it('so entra se a feature estiver ligada, como o 360', () => {
        expect(bloco3d).toContain('if (config.features.map_3d) {');
    });
});
