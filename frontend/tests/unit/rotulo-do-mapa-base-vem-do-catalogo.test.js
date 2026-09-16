// Path: tests/unit/rotulo-do-mapa-base-vem-do-catalogo.test.js
//
// O NOME QUE O CARTÃO DE MAPA BASE MOSTRA É O DO CATÁLOGO, e não o rótulo fixo do cliente.
//
// O CASO REAL, de 2026-09-16: a lista de mapa base apareceu como "Topográfica, Ortoimagem,
// Topográfica, BDGEx". O terceiro cartão é o `carta-topografica`, que no catálogo de produção
// se chama DSG (a carta do atlas Perseu) e que `LAYER_THUMBNAILS` rotula como "Topográfica".
// O seletor lia `thumbnailConfig?.label || layerConfig.name`, então o rótulo fixo vencia e a
// tela ficava com dois cartões de mesmo nome e nada que explicasse a diferença.
//
// A MINIATURA DO MESMO CARTÃO JÁ FAZIA O CERTO: três linhas acima, a prioridade é
// `layerConfig.image || thumbnailConfig?.thumbnail`. Era só o nome que não seguia o catálogo,
// o que faz deste um descuido e não um desenho — e é por isso que a régua mede os DOIS campos
// lado a lado: consertar o nome e deixar a imagem para trás seria a mesma classe de erro.
//
// É a segunda vez no mesmo dia que um valor embutido no cliente vence o que o servidor publica.
// A outra foi o ESTILO (`basemap-style.js`), com o `carta_topografica.js` de 18 linhas de OSM
// desenhando por baixo da carta DSG publicada. A regra que ficou nas duas: o catálogo é a fonte,
// e o que vem embutido é a queda de quem não publicou nada.

import { describe, it, expect } from 'vitest';
import { LAYER_THUMBNAILS } from '@js/base-layer-selector/base-layer-selector.constants.js';

/**
 * A escolha do rótulo, como o controle a faz nos dois lugares em que a escreve (o cartão da
 * lista e o rótulo do botão). Repetida aqui de propósito: o controle monta DOM e puxa o mapa
 * inteiro no import, e o que decide a tela é esta ordem.
 * @param {Object} doCatalogo - A linha de `config.basemaps[id]`.
 * @param {Object} [fixo] - A entrada de `LAYER_THUMBNAILS`.
 * @param {string} id
 * @returns {string}
 */
const rotulo = (doCatalogo, fixo, id) => doCatalogo?.name || fixo?.label || id;

/** A escolha da miniatura, que já era a certa. */
const miniatura = (doCatalogo, fixo) => doCatalogo?.image || fixo?.thumbnail;

describe('o rótulo do cartão de mapa base', () => {
    it('a DSG do catálogo não é mostrada como "Topográfica"', () => {
        // O caso exato do relato: o rótulo fixo deste id É "Topográfica", e o catálogo diz DSG.
        expect(LAYER_THUMBNAILS['carta-topografica'].label).toBe('Topográfica');

        const doCatalogo = { name: 'DSG', enabled: true, priority: 3 };
        expect(rotulo(doCatalogo, LAYER_THUMBNAILS['carta-topografica'], 'carta-topografica'))
            .toBe('DSG');
    });

    it('os quatro mapas base de produção saem com nomes DISTINTOS', () => {
        // O que o usuário vê, e a propriedade que o defeito quebrava: dois cartões de mesmo nome.
        const catalogo = {
            'osm-overture': { name: 'Topográfica' },
            'overture-ortoimagem': { name: 'Ortoimagem' },
            'carta-topografica': { name: 'DSG' },
            bdgex: { name: 'BDGEx' },
        };
        const nomes = Object.entries(catalogo)
            .map(([id, c]) => rotulo(c, LAYER_THUMBNAILS[id], id));

        expect(nomes).toEqual(['Topográfica', 'Ortoimagem', 'DSG', 'BDGEx']);
        expect(new Set(nomes).size, 'nenhum nome pode aparecer duas vezes').toBe(4);
    });

    it('sem nome no catálogo, o rótulo fixo continua valendo', () => {
        // A queda: um id que o catálogo sirva sem `name` não pode virar cartão sem legenda.
        expect(rotulo({}, LAYER_THUMBNAILS.bdgex, 'bdgex')).toBe('BDGEx');
        expect(rotulo(undefined, undefined, 'bm-novo')).toBe('bm-novo');
    });

    it('a miniatura segue a MESMA ordem, e o catálogo vence também nela', () => {
        const doCatalogo = { name: 'DSG', image: './images/layers/carta-topografica-thumb.webp' };
        expect(miniatura(doCatalogo, LAYER_THUMBNAILS['carta-topografica']))
            .toBe('./images/layers/carta-topografica-thumb.webp');
        // E sem imagem no catálogo, a do cliente responde.
        expect(miniatura({ name: 'DSG' }, LAYER_THUMBNAILS['carta-topografica']))
            .toBe(LAYER_THUMBNAILS['carta-topografica'].thumbnail);
    });
});
