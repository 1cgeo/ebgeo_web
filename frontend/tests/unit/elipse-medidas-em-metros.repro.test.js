// Path: tests/unit/elipse-medidas-em-metros.repro.test.js

/**
 * @fileoverview REPRO: a elipse guarda os raios em QUILÔMETROS (`turf.ellipse` com
 * `units: 'kilometers'`), e o painel da feição e o botão "Preencher com área" da etiqueta os liam
 * como METROS, como leem o raio do círculo e do setor. Uma elipse de 3,39 km de semi-eixo aparecia
 * como "Semi-eixo maior: 3,39 m" e a área de 21,68 km² como "21,68 m²" (medido em 2026-09-24 no painel
 * de uma elipse desenhada com a ferramenta real, pelo spec de cobertura das abas).
 *
 * A conversão mora em `ellipseMetricsInMeters`, e os dois consumidores passam por ela; o segundo
 * bloco lê os dois como texto e reprova quem voltar a ler `majorRadius` cru.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ellipseMetricsInMeters } from '../../src/js/measurement_tool/measurement-geometry.js';

const ler = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

describe('medidas da elipse em metros', () => {
    it('converte os raios guardados em km para metros e a area para m2', () => {
        const m = ellipseMetricsInMeters({ majorRadius: 3.39, minorRadius: 2.034 });
        expect(m.a).toBeCloseTo(3390, 6);
        expect(m.b).toBeCloseTo(2034, 6);
        expect(m.area).toBeCloseTo(Math.PI * 3390 * 2034, 3);
        // ~21,66 km2: a ordem de grandeza é a que o painel precisa acertar.
        expect(m.area / 1e6).toBeGreaterThan(21);
        expect(m.area / 1e6).toBeLessThan(22);
    });

    it('circulo como caso limite: a = b da o perimetro 2 pi r', () => {
        const m = ellipseMetricsInMeters({ majorRadius: 1, minorRadius: 1 });
        expect(m.perimeter).toBeCloseTo(2 * Math.PI * 1000, 6);
        expect(m.area).toBeCloseTo(Math.PI * 1e6, 3);
    });

    it('raio ausente, nao finito, zero ou negativo nao produz medida', () => {
        for (const props of [undefined, null, {}, { majorRadius: 1 }, { majorRadius: 0, minorRadius: 1 },
            { majorRadius: -1, minorRadius: 1 }, { majorRadius: NaN, minorRadius: 1 },
            { majorRadius: Infinity, minorRadius: 1 }, { majorRadius: '2', minorRadius: 'x' }]) {
            expect(ellipseMetricsInMeters(props), JSON.stringify(props)).toBeNull();
        }
    });

    it('o painel da feicao e o botao da etiqueta passam pela conversao, nunca pelo raio cru', () => {
        const identificacao = ler('../../src/js/sidebar/components/feature-identification.js');
        const painel = ler('../../src/js/draw_tools/ellipse_tool/ellipse_attributes_panel.js');
        for (const [nome, texto] of [['feature-identification.js', identificacao], ['ellipse_attributes_panel.js', painel]]) {
            expect(texto, `${nome} importa a conversao`).toMatch(/ellipseMetricsInMeters/);
            expect(texto, `${nome} le majorRadius cru`).not.toMatch(/properties\??\.majorRadius/);
        }
    });
});
