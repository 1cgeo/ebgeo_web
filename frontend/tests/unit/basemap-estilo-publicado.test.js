import { describe, it, expect } from 'vitest';
import { resolveBasemapStyle, firstStyledBasemap } from '../../src/js/baselayers/basemap-style.js';

/**
 * O SELETOR DE CAMADA BASE PRECISA DESENHAR O QUE OFERECE (F9, item 2).
 *
 * Com o basemap virando o quinto tipo de recurso, uma camada base PRIVADA passa a chegar ao
 * cliente pelo payload aditivo — por papel global, concessão pessoal ou empréstimo do atlas — e
 * entra em `config.basemaps` com o estilo MapLibre em `config.basemapStyles`. O controle, porém,
 * só conhecia os cinco estilos embutidos nesta pasta, e a tabela deles era montada UMA vez, no
 * construtor: a camada concedida aparecia no seletor e o clique caía silenciosamente noutra.
 *
 * Honrar o filtro de acesso não é só listar o item certo; é o item funcionar quando é oferecido.
 */

const BUILTIN = {
    'carta-topografica': { version: 8, sources: { a: { type: 'raster', tiles: ['x'] } }, layers: [{ id: 'a' }] },
    osm: { version: 8, sources: { b: { type: 'raster', tiles: ['y'] } }, layers: [{ id: 'b' }] },
};

// A camada carrega `type` e aponta a fonte que o estilo declara. Sem isso ela nao e um
// estilo valido, so parecia: o validador nao cobrava o contrato da camada ate 2026-09-11.
const PUBLICADO_VALIDO = { version: 8, sources: { c: { type: 'raster', tiles: ['z'] } }, layers: [{ id: 'c', type: 'raster', source: 'c' }] };

describe('estilo de uma camada base', () => {
    it('o estilo PUBLICADO ganha do embutido, inclusive nos ids que o cliente já traz', () => {
        // A ORDEM SE INVERTEU EM 2026-09-16, e o caso está no cabeçalho do módulo: os cinco
        // módulos embutidos desta linha são ESBOÇOS (o `carta_topografica.js` são 18 linhas de
        // OSM cru), então o embutido vencendo fazia a tela desenhar OSM por baixo da carta DSG
        // que o administrador tinha publicado, sem erro nenhum. O receio que a ordem antiga
        // protegia ("repontar as cinco camadas de todo deploy") continua endereçado pelo caso
        // seguinte e pelo do malformado: sem publicação utilizável, o embutido segue valendo.
        const publicados = { 'carta-topografica': PUBLICADO_VALIDO };
        expect(resolveBasemapStyle('carta-topografica', BUILTIN, publicados)).toBe(PUBLICADO_VALIDO);
    });

    it('e sem publicação nenhuma, o embutido continua valendo', () => {
        // O outro lado da inversão: o deploy que não publica estilo para um id embutido não pode
        // ficar sem camada.
        expect(resolveBasemapStyle('carta-topografica', BUILTIN, {})).toBe(BUILTIN['carta-topografica']);
        expect(resolveBasemapStyle('osm', BUILTIN, undefined)).toBe(BUILTIN.osm);
    });

    it('o id que o cliente NÃO conhece resolve pelo estilo publicado', () => {
        // É este o caso da camada base concedida: id que não existe em STYLE_MAP.
        expect(resolveBasemapStyle('base-restrita', BUILTIN, { 'base-restrita': PUBLICADO_VALIDO }))
            .toBe(PUBLICADO_VALIDO);
    });

    it('estilo publicado MALFORMADO conta como ausente', () => {
        // `setStyle()` num objeto quebrado deixa o mapa em branco, que é pior do que cair
        // numa camada que desenha. A checagem é a mesma que o editor do admin roda ao salvar.
        for (const ruim of [null, undefined, 42, [], {}, { version: 7, sources: {}, layers: [] }, { version: 8 }]) {
            expect(resolveBasemapStyle('base-restrita', BUILTIN, { 'base-restrita': ruim })).toBeNull();
        }
    });

    it('URL de estilo é aceita, e string vazia não', () => {
        expect(resolveBasemapStyle('remota', BUILTIN, { remota: 'https://exemplo/estilo.json' }))
            .toBe('https://exemplo/estilo.json');
        expect(resolveBasemapStyle('remota', BUILTIN, { remota: '   ' })).toBeNull();
    });

    it('sem estilo em lugar nenhum, é null (e não undefined nem o primeiro embutido)', () => {
        expect(resolveBasemapStyle('orfa', BUILTIN, {})).toBeNull();
        expect(resolveBasemapStyle('orfa', BUILTIN, undefined)).toBeNull();
        expect(resolveBasemapStyle('', BUILTIN, undefined)).toBeNull();
        expect(resolveBasemapStyle(null, BUILTIN, undefined)).toBeNull();
    });

    it('o fallback anda na ordem OFERECIDA e pula o que não desenha', () => {
        // A ordem é a das camadas habilitadas por prioridade, não a do mapa de embutidos:
        // o alvo do fallback tem de ser um item que o seletor também mostra como escolhido.
        expect(firstStyledBasemap(['orfa', 'base-restrita', 'osm'], BUILTIN, { 'base-restrita': PUBLICADO_VALIDO }))
            .toBe('base-restrita');
        expect(firstStyledBasemap(['orfa', 'osm'], BUILTIN, {})).toBe('osm');
    });

    it('nenhum id utilizável devolve null, para o chamador não trocar o estilo por nada', () => {
        expect(firstStyledBasemap(['orfa'], BUILTIN, {})).toBeNull();
        expect(firstStyledBasemap([], BUILTIN, {})).toBeNull();
        expect(firstStyledBasemap(undefined, BUILTIN, {})).toBeNull();
    });
});
