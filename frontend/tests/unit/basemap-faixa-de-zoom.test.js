import { describe, it, expect } from 'vitest';
import { faixaDeZoom, aplicarFaixaDeZoom } from '../../src/js/baselayers/basemap-zoom.js';

/**
 * A FAIXA DE ZOOM POR MAPA BASE (decisão do dono, 2026-08-31).
 *
 * O zoom passou a ter um nível configurável só, e é o mapa base: a aplicação é fixa em [2, 21]
 * e o atlas não tem zoom nenhum. O que este arquivo prova não é que a faixa "funciona" no caso
 * fácil, e sim que ela reprova o PIOR CASO que ela existe para pegar: a ordem de escrita das
 * duas propriedades do MapLibre, que levanta exceção quando aplicada na ordem ingênua.
 *
 * O MAPA FALSO IMPÕE AS GUARDAS REAIS, copiadas do bundle em uso
 * (`public/vendors/maplibre-gl.js`, `Map.setMinZoom` e `Map.setMaxZoom`), inclusive o clamp da
 * câmera. Um duplo permissivo aprovaria a implementação errada, que é o defeito que esta
 * suíte existe para não ter.
 */
function mapaFalso({ minZoom = 2, maxZoom = 21, zoom = 10 } = {}) {
    const m = {
        minZoom, maxZoom, zoom, escritas: [],
        getMinZoom: () => m.minZoom,
        getMaxZoom: () => m.maxZoom,
        // `if ((e = e == null ? -2 : e) >= -2 && e <= this.transform.maxZoom)`, senão LEVANTA.
        setMinZoom(e) {
            const v = e == null ? -2 : e;
            if (!(v >= -2 && v <= m.maxZoom)) {
                throw new Error('minZoom must be between -2 and the current maxZoom, inclusive');
            }
            m.minZoom = v;
            m.zoom = Math.max(m.zoom, v);
            m.escritas.push(['min', v]);
        },
        // `if ((e = e == null ? 22 : e) >= this.transform.minZoom)`, senão LEVANTA.
        setMaxZoom(e) {
            const v = e == null ? 22 : e;
            if (!(v >= m.minZoom)) {
                throw new Error('maxZoom must be greater than the current minZoom');
            }
            m.maxZoom = v;
            m.zoom = Math.min(m.zoom, v);
            m.escritas.push(['max', v]);
        },
    };
    return m;
}

const APLICACAO = { minZoom: 2, maxZoom: 21 };

describe('faixaDeZoom: a omissão é valor, não lacuna', () => {
    it('mapa base sem as chaves vale a faixa inteira da aplicação', () => {
        expect(faixaDeZoom({ name: 'OSM' }, APLICACAO)).toEqual({ piso: 2, teto: 21 });
        expect(faixaDeZoom(undefined, APLICACAO)).toEqual({ piso: 2, teto: 21 });
        expect(faixaDeZoom(null, APLICACAO)).toEqual({ piso: 2, teto: 21 });
    });

    it('as chaves declaradas ganham, e uma só também vale', () => {
        expect(faixaDeZoom({ minzoom: 5, maxzoom: 14 }, APLICACAO)).toEqual({ piso: 5, teto: 14 });
        expect(faixaDeZoom({ maxzoom: 14 }, APLICACAO)).toEqual({ piso: 2, teto: 14 });
        expect(faixaDeZoom({ minzoom: 5 }, APLICACAO)).toEqual({ piso: 5, teto: 21 });
    });

    it('`null` de payload antigo cai no padrão, e não vira o -2 do MapLibre', () => {
        // O `??` que estaria aqui numa escrita ingênua deixaria `null` passar, e o MapLibre
        // traduz `setMinZoom(null)` em piso -2, FORA da faixa fixa da aplicação.
        expect(faixaDeZoom({ minzoom: null, maxzoom: null }, APLICACAO)).toEqual({ piso: 2, teto: 21 });
    });

    it('valor não numérico cai no padrão', () => {
        expect(faixaDeZoom({ minzoom: 'quinze', maxzoom: NaN }, APLICACAO)).toEqual({ piso: 2, teto: 21 });
    });
});

describe('aplicarFaixaDeZoom: a ordem de escrita, contra as guardas reais', () => {
    it('O PIOR CASO: teto baixo para piso alto não levanta', () => {
        // É o caso que a ordem ingênua (piso, depois teto) quebra: `setMinZoom(15)` com o teto
        // ainda em 10 é exceção, não clamp. Sem esta ordem, trocar de um mapa base recortado
        // para outro derruba o `switchLayer` inteiro.
        const map = mapaFalso({ minZoom: 2, maxZoom: 10, zoom: 8 });
        expect(() => aplicarFaixaDeZoom(map, { piso: 15, teto: 21 }, 2)).not.toThrow();
        expect([map.getMinZoom(), map.getMaxZoom()]).toEqual([15, 21]);
    });

    it('CONTROLE NEGATIVO: a ordem ingênua LEVANTA no mesmo insumo', () => {
        // Sem este caso, o teste acima passaria também numa implementação ingênua, e a suíte
        // estaria vendo a régua passar em texto bom sem nunca a ver funcionar.
        const map = mapaFalso({ minZoom: 2, maxZoom: 10, zoom: 8 });
        expect(() => { map.setMinZoom(15); map.setMaxZoom(21); })
            .toThrow(/minZoom must be between/);
    });

    it('o caminho inverso, piso alto para teto baixo, também não levanta', () => {
        const map = mapaFalso({ minZoom: 15, maxZoom: 21, zoom: 16 });
        expect(() => aplicarFaixaDeZoom(map, { piso: 2, teto: 10 }, 2)).not.toThrow();
        expect([map.getMinZoom(), map.getMaxZoom()]).toEqual([2, 10]);
    });

    it('a faixa degenerada [2, 2] passa: as duas guardas são inclusivas', () => {
        const map = mapaFalso();
        expect(() => aplicarFaixaDeZoom(map, { piso: 2, teto: 2 }, 2)).not.toThrow();
        expect([map.getMinZoom(), map.getMaxZoom()]).toEqual([2, 2]);
    });

    it('A CÂMERA DESCE quando o novo teto está abaixo do zoom corrente', () => {
        // O comportamento pretendido, e não um efeito colateral: quem estava em z17 num mapa
        // base de teto 14 vê a câmera recuar para 14 ao trocar.
        const map = mapaFalso({ minZoom: 2, maxZoom: 21, zoom: 17 });
        aplicarFaixaDeZoom(map, { piso: 2, teto: 14 }, 2);
        expect(map.zoom).toBe(14);
    });

    it('e NÃO volta sozinha ao trocar de volta para a faixa larga', () => {
        const map = mapaFalso({ minZoom: 2, maxZoom: 21, zoom: 17 });
        aplicarFaixaDeZoom(map, { piso: 2, teto: 14 }, 2);
        aplicarFaixaDeZoom(map, { piso: 2, teto: 21 }, 2);
        expect(map.zoom).toBe(14);
    });

    it('nada muda: nenhuma escrita, e a câmera fica onde está', () => {
        const map = mapaFalso({ minZoom: 5, maxZoom: 14, zoom: 9 });
        expect(aplicarFaixaDeZoom(map, { piso: 5, teto: 14 }, 2)).toBe(false);
        expect(map.escritas).toEqual([]);
    });

    it('o mapa base SEM faixa devolve a câmera à faixa inteira da aplicação', () => {
        const map = mapaFalso({ minZoom: 5, maxZoom: 14, zoom: 9 });
        aplicarFaixaDeZoom(map, faixaDeZoom(undefined, APLICACAO), APLICACAO.minZoom);
        expect([map.getMinZoom(), map.getMaxZoom()]).toEqual([2, 21]);
    });
});
