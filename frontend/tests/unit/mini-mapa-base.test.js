import { describe, it, expect } from 'vitest';
import { idDoMiniMapa, estiloDoMiniMapa, faixaDoMiniMapa } from '../../src/js/street_view_tool/mini-mapa-base.js';

/**
 * O MAPA BASE DO MINI-MAPA DO 360 (decisão do dono, 2026-08-31).
 *
 * Antes o mini-mapa carregava um OSM escrito à mão no cliente, com URL de tile e de glifo
 * próprias, fora do catálogo: num deploy sem saída para a internet o mapa principal vinha do
 * tile server interno e o mini-mapa ficava em branco, sem erro nenhum e sem lugar onde o
 * administrador pudesse consertar. Agora ele escolhe o mapa base, e SÓ o mapa base: a faixa de
 * zoom vem da linha de catálogo dele.
 *
 * A PROPRIEDADE QUE ESTE ARQUIVO GUARDA e que nenhum caso isolado mostra: o estilo e a faixa
 * têm de falar do MESMO mapa base. Resolvê-los por caminhos diferentes (o estilo pelo id
 * pedido, a faixa pelo id efetivo) daria um mini-mapa desenhando uma camada e limitado pela
 * faixa de outra, sem sintoma até alguém tentar afastar.
 */

const ESTILO_LOCAL = { version: 8, sources: {}, layers: [], _local: true };
const ESTILO_PUBLICADO = { version: 8, sources: { a: { type: 'raster', tiles: ['x'] } }, layers: [{ id: 'a' }] };

const APLICACAO = { minZoom: 2, maxZoom: 21 };

const cfg = (over = {}) => ({
    map2d: APLICACAO,
    basemaps: {
        osm: { name: 'OSM', enabled: true, priority: 4, minzoom: 2, maxzoom: 19 },
        bdgex: { name: 'BDGEx', enabled: true, priority: 3, minzoom: 2, maxzoom: 18 },
    },
    basemapStyles: {},
    streetView360: {},
    ...over,
});

describe('o mapa base do mini-mapa', () => {
    it('honra o id configurado, e a faixa é a DELE', () => {
        const c = cfg({ streetView360: { miniMapBasemap: 'bdgex' } });
        expect(idDoMiniMapa(c)).toBe('bdgex');
        expect(faixaDoMiniMapa(c)).toEqual({ minZoom: 2, maxZoom: 18 });
    });

    it('sem configuração, cai no primeiro HABILITADO por prioridade', () => {
        // A mesma ordem do seletor principal: bdgex tem prioridade 3, osm tem 4.
        const c = cfg();
        expect(idDoMiniMapa(c)).toBe('bdgex');
        expect(faixaDoMiniMapa(c)).toEqual({ minZoom: 2, maxZoom: 18 });
    });

    it('id configurado que NÃO resolve cai no fallback, e a faixa segue o fallback', () => {
        // É a propriedade central: um mapa base apagado do catálogo depois de configurado
        // não pode deixar o mini-mapa desenhando um e limitado por outro.
        const c = cfg({ streetView360: { miniMapBasemap: 'apagado-do-catalogo' } });
        expect(idDoMiniMapa(c)).toBe('bdgex');
        expect(estiloDoMiniMapa(c, ESTILO_LOCAL)).not.toBe(ESTILO_LOCAL);
        expect(faixaDoMiniMapa(c)).toEqual({ minZoom: 2, maxZoom: 18 });
    });

    it('mapa base DESABILITADO não é oferecido como fallback', () => {
        const c = cfg({
            basemaps: {
                bdgex: { enabled: false, priority: 3, maxzoom: 18 },
                osm: { enabled: true, priority: 4, minzoom: 2, maxzoom: 19 },
            },
        });
        expect(idDoMiniMapa(c)).toBe('osm');
        expect(faixaDoMiniMapa(c)).toEqual({ minZoom: 2, maxZoom: 19 });
    });

    it('mas um DESABILITADO configurado à mão ainda vale: o gate é o estilo, não a lista', () => {
        // O administrador escolheu explicitamente; o `enabled` governa o SELETOR do usuário,
        // e o mini-mapa não é um item de seletor.
        const c = cfg({
            basemaps: {
                bdgex: { enabled: false, priority: 3, minzoom: 2, maxzoom: 18 },
                osm: { enabled: true, priority: 4, minzoom: 2, maxzoom: 19 },
            },
            streetView360: { miniMapBasemap: 'bdgex' },
        });
        expect(idDoMiniMapa(c)).toBe('bdgex');
    });

    it('CATÁLOGO VAZIO: o estilo local desenha, e a faixa é a da aplicação', () => {
        // `setStyle(undefined)` deixaria o mini-mapa em branco sem erro nenhum, que é pior
        // do que um OSM que talvez não carregue.
        const c = cfg({ basemaps: {}, streetView360: { miniMapBasemap: 'nada' } });
        expect(idDoMiniMapa(c)).toBe(null);
        expect(estiloDoMiniMapa(c, ESTILO_LOCAL)).toBe(ESTILO_LOCAL);
        expect(faixaDoMiniMapa(c)).toEqual({ minZoom: 2, maxZoom: 21 });
    });

    it('um mapa base PRIVADO concedido resolve pelo estilo publicado', () => {
        // Ele não tem estilo embutido no cliente e chega pelo payload aditivo, depois do
        // boot. É o mesmo caminho que o seletor principal já usa.
        const c = cfg({
            basemaps: { 'base-restrita': { enabled: true, priority: 1, minzoom: 4, maxzoom: 16 } },
            basemapStyles: { 'base-restrita': ESTILO_PUBLICADO },
            streetView360: { miniMapBasemap: 'base-restrita' },
        });
        expect(idDoMiniMapa(c)).toBe('base-restrita');
        expect(estiloDoMiniMapa(c, ESTILO_LOCAL)).toBe(ESTILO_PUBLICADO);
        expect(faixaDoMiniMapa(c)).toEqual({ minZoom: 4, maxZoom: 16 });
    });

    it('mapa base SEM faixa declarada herda a da aplicação', () => {
        const c = cfg({
            basemaps: { osm: { enabled: true, priority: 1 } },
            streetView360: { miniMapBasemap: 'osm' },
        });
        expect(faixaDoMiniMapa(c)).toEqual({ minZoom: 2, maxZoom: 21 });
    });

    it('o `minZoom: 11` do mini-mapa SAIU, e isso é a decisão, não um esquecimento', () => {
        // Ficava escrito à mão no controle, para o mini-mapa continuar parecendo um
        // mini-mapa. A faixa passou a ser a do mapa base, então um de piso 2 afasta até 2.
        const c = cfg({ streetView360: { miniMapBasemap: 'osm' } });
        expect(faixaDoMiniMapa(c).minZoom).toBe(2);
    });
});
