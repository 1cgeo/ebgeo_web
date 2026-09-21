import { describe, it, expect } from 'vitest';
import { planLateLegacyChanges } from '@store/migration/late-legacy-plan.js';

/**
 * A regra da junção de alterações tardias, em tabela. Inventários sintéticos: `[store, key, hash]`.
 * Cada caso de conflito é o PIOR CASO da cláusula dele, e o caso que absorve é o controle de que
 * a régua também passa quando deve.
 */

const base = [
    ['atlas', 'current_atlas', 'a0'],
    ['maps', 'Principal', 'p0'],
    ['maps', 'Segundo', 's0'],
    ['settings', 'color_usage_Principal', 'c0'],
    ['settings', 'lastActiveMap', 'l0'],
    ['images', 'img-1', 'i0'],
];
const maps = [{ key: 'Principal', id: 'Principal', name: 'Principal' }, { key: 'Segundo', id: 'uuid-2', name: 'Segundo' }];

/** Inventário com substituições: `{ 'maps/Principal': 'p1' }` muda, `null` remove, chave nova acrescenta. */
function com(inventory, changes) {
    const rows = new Map(inventory.map(([s, k, h]) => [`${s}/${k}`, [s, k, h]]));
    for (const [id, hash] of Object.entries(changes)) {
        const [s, ...rest] = id.split('/');
        if (hash === null) rows.delete(id);
        else rows.set(id, [s, rest.join('/'), hash]);
    }
    return [...rows.values()];
}

/**
 * Monta a entrada com as duas bases iguais (o estado logo depois da transição) e a origem crua
 * espelhando a migrada: onde a migrada muda, a crua muda também, salvo quando o caso diz o contrário.
 */
function entrada({ legado = {}, destino = {}, cruaIgual = [] } = {}) {
    const rawChanges = Object.fromEntries(Object.entries(legado)
        .filter(([id]) => !cruaIgual.includes(id))
        .map(([id, hash]) => [id, hash === null ? null : `raw-${hash}`]));
    const rawBase = base.map(([s, k, h]) => [s, k, `raw-${h}`]);
    return {
        migratedBase: base, staged: com(base, legado),
        destinationBase: base, destination: com(base, destino),
        rawBase, rawNow: com(rawBase, rawChanges), maps
    };
}

describe('planLateLegacyChanges', () => {
    it('nada mudou na forma migrada: nada a fazer', () => {
        expect(planLateLegacyChanges(entrada()).outcome).toBe('nothing');
    });

    it('destino intocado: absorve as escritas e as remoções da origem', () => {
        const plan = planLateLegacyChanges(entrada({ legado: {
            'maps/Principal': 'p1', 'settings/gridStyle_Principal': 'g1', 'settings/color_usage_Principal': null
        } }));
        expect(plan.outcome).toBe('absorb');
        expect(plan.writes).toEqual([['maps', 'Principal'], ['settings', 'gridStyle_Principal']]);
        expect(plan.deletes).toEqual([['settings', 'color_usage_Principal']]);
    });

    it('mapas diferentes nos dois lados: absorve só o que é da origem', () => {
        const plan = planLateLegacyChanges(entrada({ legado: { 'maps/Principal': 'p1' }, destino: { 'maps/Segundo': 's9' } }));
        expect(plan).toMatchObject({ outcome: 'absorb', writes: [['maps', 'Principal']], deletes: [] });
    });

    it('mesmo registro nos dois lados: conflito', () => {
        expect(planLateLegacyChanges(entrada({ legado: { 'settings/lastActiveMap': 'l1' }, destino: { 'settings/lastActiveMap': 'l9' } })))
            .toMatchObject({ outcome: 'conflict', reason: 'same_unit' });
    });

    it('registros diferentes do MESMO mapa: conflito', () => {
        expect(planLateLegacyChanges(entrada({ legado: { 'maps/Principal': 'p1' }, destino: { 'settings/color_usage_Principal': 'c9' } })))
            .toMatchObject({ outcome: 'conflict', reason: 'same_unit' });
    });

    it('o mesmo mapa por id de um lado e por chave do outro: conflito', () => {
        expect(planLateLegacyChanges(entrada({ legado: { 'maps/Segundo': 's1' }, destino: { 'settings/color_usage_uuid-2': 'c9' } })))
            .toMatchObject({ outcome: 'conflict', reason: 'same_unit' });
    });

    it('registros fora de mapa e diferentes: absorve', () => {
        expect(planLateLegacyChanges(entrada({ legado: { 'settings/mapBadgeColors': 'b1' }, destino: { 'settings/lastActiveMap': 'l9' } })).outcome)
            .toBe('absorb');
    });

    it('mapa apagado na origem: conflito, mesmo com o destino intocado', () => {
        expect(planLateLegacyChanges(entrada({ legado: { 'maps/Segundo': null } })))
            .toMatchObject({ outcome: 'conflict', reason: 'map_removed' });
    });

    it('imagem apagada na origem: absorve com o destino intocado, conflita com o destino editado', () => {
        expect(planLateLegacyChanges(entrada({ legado: { 'images/img-1': null } })).outcome).toBe('absorb');
        expect(planLateLegacyChanges(entrada({ legado: { 'images/img-1': null }, destino: { 'maps/Segundo': 's9' } })))
            .toMatchObject({ outcome: 'conflict', reason: 'image_removed' });
    });

    it('registro que a origem não mudou e saiu diferente da migração: conflito, nunca escrita', () => {
        expect(planLateLegacyChanges(entrada({ legado: { 'maps/Principal': 'p1', 'atlas/current_atlas': 'a1' }, cruaIgual: ['atlas/current_atlas'] })))
            .toMatchObject({ outcome: 'conflict', reason: 'unstable_migration', writes: [], deletes: [] });
    });

    it('registro que só a migração cria (sem par na origem) pode mudar sem acusar instabilidade', () => {
        const input = entrada({ legado: { 'maps/Principal': 'p1' } });
        input.migratedBase = [...input.migratedBase, ['layers', 'layers_Principal', 'y0']];
        input.destinationBase = [...input.destinationBase, ['layers', 'layers_Principal', 'y0']];
        input.destination = [...input.destination, ['layers', 'layers_Principal', 'y0']];
        input.staged = [...input.staged, ['layers', 'layers_Principal', 'y1']];
        expect(planLateLegacyChanges(input)).toMatchObject({
            outcome: 'absorb', writes: [['maps', 'Principal'], ['layers', 'layers_Principal']]
        });
    });

    it('as duas bases são lidas cada uma do seu lado', () => {
        // Depois de uma junção com edição da versão nova no Segundo, a base do destino tem s9 e a
        // da origem migrada tem s0. A origem que volta com s0 no Segundo NÃO mudou o Segundo.
        const input = entrada({ legado: { 'maps/Principal': 'p1' } });
        input.destinationBase = com(base, { 'maps/Segundo': 's9' });
        input.destination = com(base, { 'maps/Segundo': 's9' });
        expect(planLateLegacyChanges(input)).toMatchObject({ outcome: 'absorb', writes: [['maps', 'Principal']] });
    });
});
