// Path: tests/unit/colar-simbolo-por-feicao.repro.test.js
// REPRO (metade pura): a lista de buckets que carregam imagem por feição era escrita À MÃO,
// em DOIS lugares, e os dois divergiram.
//
// ================= A CAUSA RAIZ ==============================================
//
// Símbolo militar, medida de coordenação e declinação magnética (mais a feição de imagem)
// desenham um raster registrado no MapLibre sob o `properties.id` DA FEIÇÃO: o estilo resolve
// por `'icon-image': ['get', 'id']` (`src/js/layers/styles/symbol.layers.js`). Id novo, como
// o que toda colagem cunha, exige registro novo, e não existe fallback: a feição some.
//
// Dois caminhos varrem uma coleção por tipo de armazenamento e precisam fazer esse registro:
// colar (`src/js/tool_manager/clipboard_manager.js`) e a montagem do mapa
// (`src/js/layers/layer_setup.js`). Cada um escrevia a própria lista de plurais, e a de colar
// tinha só `images` e `military_symbols` — anterior aos outros dois tipos. Colar uma medida de
// coordenação ou uma declinação duplicava o blob sob o id novo e não registrava nada no mapa.
// Só o F5 desenhava, porque a OUTRA lista, à mão, estava completa.
//
// A lista agora é derivada: `IMAGE_RESOURCE_STORAGE_TYPES` (a visão plural de
// `IMAGE_RESOURCE_FEATURE_TYPES`) e `collectImageResourceFeatures`. Este arquivo prende as
// duas metades puras. A metade viva, dentro do `ClipboardManager`, é o irmão em
// `tests/integration/colar-simbolo-por-feicao.repro.test.js`.
//
// O QUE ELE NÃO ALCANÇA: que o registro chegue ao MapLibre de verdade sem recarregar. Isso é
// `tests/e2e-ui/colar-registra-imagem-por-feicao.spec.js`.

import { describe, it, expect } from 'vitest';
import {
    IMAGE_RESOURCE_FEATURE_TYPES,
    IMAGE_RESOURCE_STORAGE_TYPES,
    getStorageTypeFromSource,
} from '@store/store.constants.js';
import {
    collectImageResourceFeatures,
    collectImageResourceIds,
} from '@layers/feature-images.js';

/** A feature as both sweeps receive it. */
const feicao = (id, source) => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [0, 0] },
    properties: { id, source, nome: id },
});

// ============================================================================
// A CONSTANTE DERIVADA
// ============================================================================

describe('IMAGE_RESOURCE_STORAGE_TYPES', () => {
    it('é a visão PLURAL de IMAGE_RESOURCE_FEATURE_TYPES, tipo a tipo', () => {
        // A invariante inteira: quem nascer no registro com blob entra aqui sem ninguém
        // escrever nada. Uma lista à mão seria uma aposta de grafia por linha nova.
        const esperado = [];
        for (const tipo of IMAGE_RESOURCE_FEATURE_TYPES) {
            esperado.push(getStorageTypeFromSource(tipo));
        }
        expect([...IMAGE_RESOURCE_STORAGE_TYPES]).toEqual(esperado);
    });

    it('PISO: não veio vazia, e tem um plural por tipo singular', () => {
        // Sem este caso, um registro quebrado esvaziaria a constante e toda propriedade acima
        // passaria sobre nada.
        expect(IMAGE_RESOURCE_FEATURE_TYPES.length).toBeGreaterThanOrEqual(4);
        expect(IMAGE_RESOURCE_STORAGE_TYPES).toHaveLength(IMAGE_RESOURCE_FEATURE_TYPES.length);
    });

    it('carrega os DOIS plurais que a lista de colar não tinha', () => {
        expect(IMAGE_RESOURCE_STORAGE_TYPES).toContain('coordination_measures');
        expect(IMAGE_RESOURCE_STORAGE_TYPES).toContain('magnetic_declinations');
    });

    it('e continua carregando os dois que ela tinha', () => {
        expect(IMAGE_RESOURCE_STORAGE_TYPES).toContain('images');
        expect(IMAGE_RESOURCE_STORAGE_TYPES).toContain('military_symbols');
    });

    it('CONTROLE NEGATIVO: quem não tem blob fica de fora, plural irregular inclusive', () => {
        // `boundarys`, com o `y`, é a razão de a lista ser derivada e não escrita: ela é o
        // plural que ninguém acerta de memória. E o limite não carrega imagem nenhuma, então
        // uma varredura que devolvesse tudo reprovaria aqui.
        expect(IMAGE_RESOURCE_STORAGE_TYPES).not.toContain('boundarys');
        expect(IMAGE_RESOURCE_STORAGE_TYPES).not.toContain('points');
        expect(IMAGE_RESOURCE_STORAGE_TYPES).not.toContain('texts');
    });

    it('é congelada: ninguém acrescenta um bucket em runtime', () => {
        expect(Object.isFrozen(IMAGE_RESOURCE_STORAGE_TYPES)).toBe(true);
    });
});

// ============================================================================
// A VARREDURA
// ============================================================================

describe('collectImageResourceFeatures', () => {
    it('os quatro buckets devolvem os quatro ids, pareados com a feição', () => {
        const colecao = {
            images: [feicao('img-1', 'image')],
            military_symbols: [feicao('sm-1', 'military_symbol')],
            coordination_measures: [feicao('mc-1', 'coordination_measure')],
            magnetic_declinations: [feicao('dm-1', 'magnetic_declination')],
        };

        const pares = collectImageResourceFeatures(colecao);

        expect(pares.map(p => p.imageId).sort()).toEqual(['dm-1', 'img-1', 'mc-1', 'sm-1']);
        // O PAR é o que o caminho do F5 precisa: o regenerador reconstrói pelas propriedades.
        expect(pares.map(p => p.feature.properties.source).sort())
            .toEqual(['coordination_measure', 'image', 'magnetic_declination', 'military_symbol']);
    });

    it('a ordem é a do registro, não a das chaves do objeto', () => {
        // Ordem de inserção invertida de propósito: a varredura itera a constante derivada.
        const pares = collectImageResourceFeatures({
            magnetic_declinations: [feicao('dm-1', 'magnetic_declination')],
            coordination_measures: [feicao('mc-1', 'coordination_measure')],
            military_symbols: [feicao('sm-1', 'military_symbol')],
            images: [feicao('img-1', 'image')],
        });

        const ordemDoRegistro = IMAGE_RESOURCE_STORAGE_TYPES.map(
            b => ({ images: 'img-1', military_symbols: 'sm-1', coordination_measures: 'mc-1', magnetic_declinations: 'dm-1' })[b]
        );
        expect(pares.map(p => p.imageId)).toEqual(ordemDoRegistro);
    });

    it('bucket AUSENTE é ignorado, e os presentes continuam saindo', () => {
        const pares = collectImageResourceFeatures({
            coordination_measures: [feicao('mc-1', 'coordination_measure')],
        });

        expect(pares.map(p => p.imageId)).toEqual(['mc-1']);
    });

    it('bucket `null` e bucket que não é array não explodem', () => {
        // A forma malformada de um import antigo. Um `for...of` sobre isso lançaria dentro do
        // caminho de desenho, que não tem quem pegue.
        const pares = collectImageResourceFeatures({
            images: null,
            military_symbols: undefined,
            coordination_measures: 'nao-e-array',
            magnetic_declinations: [feicao('dm-1', 'magnetic_declination')],
        });

        expect(pares.map(p => p.imageId)).toEqual(['dm-1']);
    });

    it('feição sem `properties.id` sai da lista, em vez de virar um `undefined`', () => {
        const pares = collectImageResourceFeatures({
            military_symbols: [
                { type: 'Feature', properties: { source: 'military_symbol' } },
                { type: 'Feature' },
                null,
                feicao('sm-2', 'military_symbol'),
            ],
        });

        expect(pares.map(p => p.imageId)).toEqual(['sm-2']);
    });

    it('id repetido entra UMA vez, mesmo entre buckets diferentes', () => {
        const pares = collectImageResourceFeatures({
            images: [feicao('repetido', 'image'), feicao('repetido', 'image')],
            military_symbols: [feicao('repetido', 'military_symbol')],
        });

        expect(pares).toHaveLength(1);
        expect(pares[0].imageId).toBe('repetido');
        // O primeiro visto vence, que é a ordem do registro.
        expect(pares[0].feature.properties.source).toBe('image');
    });

    it('entrada `undefined`, `null` e não-objeto devolvem lista vazia', () => {
        expect(collectImageResourceFeatures(undefined)).toEqual([]);
        expect(collectImageResourceFeatures(null)).toEqual([]);
        expect(collectImageResourceFeatures('coleção')).toEqual([]);
        expect(collectImageResourceFeatures(42)).toEqual([]);
    });

    it('coleção sem nenhum bucket de imagem devolve lista vazia', () => {
        expect(collectImageResourceFeatures({
            points: [feicao('pt-1', 'point')],
            boundarys: [feicao('lim-1', 'boundary')],
        })).toEqual([]);
    });
});

describe('collectImageResourceIds', () => {
    it('é a mesma varredura com os objetos descartados', () => {
        const colecao = {
            images: [feicao('img-1', 'image')],
            magnetic_declinations: [feicao('dm-1', 'magnetic_declination')],
        };

        expect(collectImageResourceIds(colecao))
            .toEqual(collectImageResourceFeatures(colecao).map(p => p.imageId));
    });

    it('herda a tolerância da irmã: entrada vazia devolve lista vazia', () => {
        expect(collectImageResourceIds({})).toEqual([]);
        expect(collectImageResourceIds(undefined)).toEqual([]);
    });
});
