// Path: tests/unit/preview-opacidade-camada.test.js
//
// O RETORNO AO VIVO DO CONTROLE DE OPACIDADE DE CAMADA, sem passar pela store.
//
// Arrastar o controle chamava `setLayerOpacity` uma vez por quadro de animação. Cada chamada
// emitia `LAYERS_CHANGED` (que acorda todos os ouvintes, a aba de mapas inclusive, e ela lê um
// documento de mapa por mapa do atlas) e gravava uma operação na fila de sincronização do
// IndexedDB. O retorno ao vivo agora vai direto às propriedades de tinta do MapLibre, e a store
// é escrita UMA vez, no fim do gesto (`change`).
//
// O PIOR CASO QUE A RÉGUA EXISTE PARA REPROVAR: 120 quadros de arrasto, que são dois segundos a
// 60 quadros por segundo. A lista de camadas da store tem de ver ZERO escritas durante o
// arrasto, e a gravação que vem depois não pode repintar o que o preview já pintou.
//
// O QUE MUDA AQUI EM RELAÇÃO À MAIN, e é o motivo de este arquivo não ser cópia: este módulo já
// tinha o ATALHO DE IDENTIDADE (`multiplicadorAplicado`), que PULA a escrita enquanto toda
// opacidade vale 1, e já tinha as propriedades de tinta por TIPO de camada, numa constante
// interna que ele não exporta. Os casos abaixo são escritos contra esse atalho: montar o mapa
// com tudo em 1 não escreve tinta nenhuma, e é justamente por isso que a primeira escrita
// contada é a do preview. O guarda do próprio atalho mora em
// `tests/unit/opacidade-de-camada-nao-escreve-a-toa.test.js`, e este arquivo não o repete.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';

const { camadasDaStore } = vi.hoisted(() => ({ camadasDaStore: { valor: [] } }));

vi.mock('../../src/js/store', () => ({
    getLayers: () => camadasDaStore.valor,
}));

// Três camadas de tipos diferentes bastam: o que se conta aqui é ESCREVEU ou NÃO ESCREVEU, e a
// varredura da lista real já é medida no arquivo vizinho.
vi.mock('../../src/js/layers/layer.constants.js', () => ({
    FEATURE_LAYER_IDS: ['point-layer', 'line-layer', 'polygon-fill-layer'],
}));

const { applyLayerOpacities, previewLayerOpacity, invalidateOpacityCache } =
    await import('../../src/js/layers/layer-opacity-applier.js');

/** Lê um arquivo de `src/` pelo caminho relativo ao pacote. */
const fonte = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');

/**
 * Mapa de mentira que registra toda escrita de tinta.
 * @returns {Object} Mapa falso com o diário `pinturas`
 */
function mapaFalso() {
    const tipos = {
        'point-layer': 'circle',
        'line-layer': 'line',
        'polygon-fill-layer': 'fill',
    };
    return {
        pinturas: [],
        getLayer(id) {
            return tipos[id] ? { id, type: tipos[id] } : null;
        },
        getPaintProperty(_id, prop) {
            if (prop.endsWith('-opacity')) return ['get', 'opacity'];
            return undefined;
        },
        setPaintProperty(id, prop, valor) {
            this.pinturas.push({ id, prop, valor });
        },
    };
}

/** A opacidade que o `match` escrito na tinta atribui a uma camada. */
function opacidadeNoMatch(pintura, layerId) {
    const match = pintura.valor[2];
    return match[match.indexOf(layerId) + 1];
}

describe('previewLayerOpacity: retorno por quadro sem passar pela store', () => {
    let map;

    beforeEach(() => {
        invalidateOpacityCache();
        camadasDaStore.valor = [
            { id: 'default', opacity: 1 },
            { id: 'camada-2', opacity: 1 },
        ];
        map = mapaFalso();
        applyLayerOpacities(map);
        map.pinturas = [];
    });

    it('montar o mapa com tudo em 1 não escreve tinta, e mesmo assim o preview o alcança', () => {
        // O atalho de identidade em ação: a passada do `beforeEach` acima registrou o mapa e
        // não escreveu nada. Sem esta afirmação, a contagem de zero pinturas do caso seguinte
        // poderia ser só um mapa que nunca chegou ao módulo.
        const outro = mapaFalso();
        camadasDaStore.valor = [{ id: 'default', opacity: 1 }];
        invalidateOpacityCache();
        applyLayerOpacities(outro);

        expect(outro.pinturas).toEqual([]);
        expect(previewLayerOpacity('default', 0.3)).toBe(true);
        expect(outro.pinturas.length).toBeGreaterThan(0);
    });

    it('aplica a opacidade nova no mapa sem tocar na lista de camadas da store', () => {
        const aplicou = previewLayerOpacity('camada-2', 0.4);

        expect(aplicou).toBe(true);
        expect(map.pinturas.length).toBeGreaterThan(0);
        // A lista da store fica intacta: o preview só reconstruiu a expressão de tinta.
        expect(camadasDaStore.valor.find(l => l.id === 'camada-2').opacity).toBe(1);
        expect(opacidadeNoMatch(map.pinturas[0], 'camada-2')).toBe(0.4);
    });

    it('120 quadros de arrasto não escrevem nada na lista de camadas', () => {
        for (let quadro = 0; quadro < 120; quadro++) {
            previewLayerOpacity('camada-2', 1 - quadro / 200);
        }

        expect(camadasDaStore.valor.find(l => l.id === 'camada-2').opacity).toBe(1);
        expect(map.pinturas.length).toBeGreaterThan(0);
        // O último quadro é o que o olho vê, e é ele que tem de estar na tinta.
        const ultima = map.pinturas[map.pinturas.length - 1];
        expect(opacidadeNoMatch(ultima, 'camada-2')).toBeCloseTo(1 - 119 / 200, 10);
    });

    it('a gravação única no fim do gesto cai no curto-circuito da assinatura', () => {
        previewLayerOpacity('camada-2', 0.4);
        const pintadasNoPreview = map.pinturas.length;

        // Fim do gesto: o `change` escreve na store, que emite LAYERS_CHANGED, que chama
        // `applyLayerOpacities`. A assinatura é a MESMA que o preview já pintou.
        camadasDaStore.valor = [
            { id: 'default', opacity: 1 },
            { id: 'camada-2', opacity: 0.4 },
        ];
        applyLayerOpacities(map);

        expect(map.pinturas.length).toBe(pintadasNoPreview);
    });

    it('um valor diferente do preview repinta, para o preview nunca ficar preso', () => {
        previewLayerOpacity('camada-2', 0.4);
        const pintadasNoPreview = map.pinturas.length;

        // O gesto nunca fechou: a próxima mudança real de camada ganha. E ela leva TODAS as
        // opacidades de volta a 1, que é exatamente onde o atalho de identidade poderia engolir
        // a escrita; a bandeira interna é o que obriga a restauração.
        camadasDaStore.valor = [
            { id: 'default', opacity: 1 },
            { id: 'camada-2', opacity: 1 },
        ];
        applyLayerOpacities(map);

        expect(map.pinturas.length).toBeGreaterThan(pintadasNoPreview);
        const ultima = map.pinturas[map.pinturas.length - 1];
        expect(opacidadeNoMatch(ultima, 'camada-2')).toBe(1);
    });

    it('quadro repetido com o mesmo valor não repinta', () => {
        previewLayerOpacity('camada-2', 0.4);
        const pintadasNoPreview = map.pinturas.length;

        previewLayerOpacity('camada-2', 0.4);

        expect(map.pinturas.length).toBe(pintadasNoPreview);
    });

    it('sem mapa conhecido devolve false, para o chamador cair na store', async () => {
        vi.resetModules();
        const modulo = await import('../../src/js/layers/layer-opacity-applier.js');

        expect(modulo.previewLayerOpacity('camada-2', 0.4)).toBe(false);
    });
});

describe('quem chama o preview: a linha de opacidade da lista de camadas', () => {
    // Um preview que ninguém chama é código morto, e a régua acima passaria verde do mesmo
    // jeito. Isto é varredura de texto, então ela prende a LIGAÇÃO (qual evento vai para onde),
    // nunca a semântica do arrasto, que é do navegador.
    const codigo = fonte('src/js/features_tab/layer-list.component.js');

    it('o `input` coalescido por quadro passa pelo preview, e só cai na store sem mapa', () => {
        const ondeLinha = codigo.indexOf('export function createLayerOpacityRow(');
        expect(ondeLinha).toBeGreaterThan(-1);

        const corpo = codigo.slice(ondeLinha);
        const ondeInput = corpo.indexOf("addEventListener('input'");
        const ondeChange = corpo.indexOf("addEventListener('change'");
        expect(ondeInput).toBeGreaterThan(-1);
        expect(ondeChange).toBeGreaterThan(ondeInput);

        const trechoInput = corpo.slice(ondeInput, ondeChange);
        expect(trechoInput).toMatch(/requestAnimationFrame/);
        expect(trechoInput).toMatch(/previewLayerOpacity\(layer\.id, pendingOpacity\)/);
    });

    it('o `change` do fim do gesto é a ÚNICA gravação na store', () => {
        const ondeLinha = codigo.indexOf('export function createLayerOpacityRow(');
        const corpo = codigo.slice(ondeLinha, codigo.indexOf('\n}', ondeLinha));
        const ondeChange = corpo.indexOf("addEventListener('change'");

        expect(corpo.slice(ondeChange)).toMatch(/setLayerOpacity\(layer\.id, percent \/ 100\)/);
        // Duas gravações no gesto (uma por quadro e outra no fim) desfariam a economia inteira.
        expect(corpo.match(/setLayerOpacity\(/g)).toHaveLength(2);
    });
});
