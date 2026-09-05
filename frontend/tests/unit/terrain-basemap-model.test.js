// Path: tests/unit/terrain-basemap-model.test.js

/**
 * @fileoverview A DECISAO de qual base o terreno prefere, sozinha, sem mapa e sem DOM.
 *
 * O mecanismo existe porque a base raster custa de metade a um terco do quadro da
 * vetorial com o terreno ligado (`docs/wiki/desempenho-do-mapa-2d.md`, que aponta o
 * relatorio com os numeros por causa), e cobra por isso uma cobertura menor: fora do
 * recorte gerado, o mapa fica BRANCO. Toda a regra abaixo protege duas coisas que uma
 * troca automatica quebra facil:
 *
 *   - a ESCOLHA do usuario, que nao pode ser desfeita as costas dele;
 *   - a TELA, que nao pode ficar branca porque a base preferida nao cobre a vista.
 *
 * Os piores casos vem primeiro, porque foram eles que reprovaram o esboco: a chave
 * nula que mesmo assim mexia na base, a preferida desabilitada, o centro fora do
 * recorte, e o segundo "ligar" que esquecia a base original e nunca mais voltava.
 *
 * AQUI A LISTA DE DISPONIVEIS E MAIS LARGA QUE NA `main`, e isso e do contrato deste
 * pacote: uma base pode existir sem estar entre os cinco modulos embutidos, porque o
 * servidor publica estilo por id (`config.basemapStyles`), inclusive para acervo
 * privado que so chega depois do login. Quem monta a lista e
 * `BaseLayerControl.availableBasemaps`; este arquivo so a recebe pronta.
 */

import { describe, it, expect } from 'vitest';
import {
    TERRAIN_BASEMAP_ACTION,
    isCenterInsideBounds,
    decideTerrainBasemap,
} from '../../src/js/terrain/terrain-basemap.model.js';

/** Bases habilitadas na config E com estilo resolvivel, na ordem do seletor. */
const DISPONIVEIS = ['carta-topografica', 'carta-ortoimagem', 'bdgex'];

/** Recorte sul, o mesmo do `map2d.bounds` servido: [oeste, sul, leste, norte]. */
const RECORTE_SUL = [-58.1, -33.4, -48.7, -27.1];

/** Centro dentro do recorte sul (Passo Fundo, mais ou menos). */
const CENTRO_DENTRO = { lng: -52.4, lat: -28.3 };
/** Centro fora do recorte sul (Rio de Janeiro). */
const CENTRO_FORA = { lng: -43.2, lat: -22.9 };

/** O estado de partida: terreno desligado, nada lembrado, preferida configurada. */
function ligar(extra = {}) {
    return decideTerrainBasemap({
        terrainOn: true,
        preferred: 'carta-ortoimagem',
        current: 'carta-topografica',
        remembered: null,
        userSwitchedSince: false,
        bounds: null,
        center: CENTRO_DENTRO,
        available: DISPONIVEIS,
        ...extra,
    });
}

/** O desligar simetrico: terreno ja trocou a base e lembrou a antiga. */
function desligar(extra = {}) {
    return decideTerrainBasemap({
        terrainOn: false,
        preferred: 'carta-ortoimagem',
        current: 'carta-ortoimagem',
        remembered: 'carta-topografica',
        userSwitchedSince: false,
        bounds: null,
        center: CENTRO_DENTRO,
        available: DISPONIVEIS,
        ...extra,
    });
}

// ============================================================================
// isCenterInsideBounds - o recorte que impede a tela branca
// ============================================================================

describe('isCenterInsideBounds', () => {
    it('sem recorte declarado, qualquer centro esta dentro', () => {
        expect(isCenterInsideBounds(null, CENTRO_FORA)).toBe(true);
        expect(isCenterInsideBounds(undefined, CENTRO_FORA)).toBe(true);
        expect(isCenterInsideBounds(null, null)).toBe(true);
    });

    it('aceita o centro dentro e recusa o de fora', () => {
        expect(isCenterInsideBounds(RECORTE_SUL, CENTRO_DENTRO)).toBe(true);
        expect(isCenterInsideBounds(RECORTE_SUL, CENTRO_FORA)).toBe(false);
    });

    it('inclui a borda, que e onde o recorte ainda cobre', () => {
        expect(isCenterInsideBounds(RECORTE_SUL, { lng: -58.1, lat: -33.4 })).toBe(true);
        expect(isCenterInsideBounds(RECORTE_SUL, { lng: -48.7, lat: -27.1 })).toBe(true);
        expect(isCenterInsideBounds(RECORTE_SUL, { lng: -58.100001, lat: -30 })).toBe(false);
        expect(isCenterInsideBounds(RECORTE_SUL, { lng: -52, lat: -27.099999 })).toBe(false);
    });

    it('aceita o centro como par [lng, lat], que e como a config escreve coordenada', () => {
        expect(isCenterInsideBounds(RECORTE_SUL, [-52.4, -28.3])).toBe(true);
        expect(isCenterInsideBounds(RECORTE_SUL, [-43.2, -22.9])).toBe(false);
    });

    it('desenrola a longitude que o MapLibre acumula ao girar o globo', () => {
        // map.getCenter().lng nao volta para [-180,180): duas voltas para leste
        // devolvem -52.4 + 720. Sem desenrolar, o recorte recusaria a propria casa.
        expect(isCenterInsideBounds(RECORTE_SUL, { lng: -52.4 + 360, lat: -28.3 })).toBe(true);
        expect(isCenterInsideBounds(RECORTE_SUL, { lng: -52.4 + 720, lat: -28.3 })).toBe(true);
        expect(isCenterInsideBounds(RECORTE_SUL, { lng: -52.4 - 360, lat: -28.3 })).toBe(true);
        expect(isCenterInsideBounds(RECORTE_SUL, { lng: -43.2 + 360, lat: -22.9 })).toBe(false);
    });

    it('recusa o centro ausente ou nao numerico quando ha recorte', () => {
        // Fecha para o lado seguro: sem saber onde a camera esta, trocar de base
        // pode entregar uma tela branca.
        expect(isCenterInsideBounds(RECORTE_SUL, null)).toBe(false);
        expect(isCenterInsideBounds(RECORTE_SUL, {})).toBe(false);
        expect(isCenterInsideBounds(RECORTE_SUL, { lng: NaN, lat: -28.3 })).toBe(false);
        expect(isCenterInsideBounds(RECORTE_SUL, { lng: -52.4, lat: Infinity })).toBe(false);
    });

    it('recusa recorte malformado em vez de deixar passar', () => {
        expect(isCenterInsideBounds([-58.1, -33.4, -48.7], CENTRO_DENTRO)).toBe(false);
        expect(isCenterInsideBounds([-58.1, -33.4, -48.7, NaN], CENTRO_DENTRO)).toBe(false);
        expect(isCenterInsideBounds('-58,-33,-48,-27', CENTRO_DENTRO)).toBe(false);
        expect(isCenterInsideBounds([-58.1, -27.1, -48.7, -33.4], CENTRO_DENTRO)).toBe(false); // sul > norte
        expect(isCenterInsideBounds([-200, -33.4, -48.7, -27.1], CENTRO_DENTRO)).toBe(false); // fora de [-180,180]
        expect(isCenterInsideBounds([-58.1, -100, -48.7, -27.1], CENTRO_DENTRO)).toBe(false); // fora de [-90,90]
    });

    it('NAO trata caixa que cruza o antimeridiano, e a recusa inteira', () => {
        // Nada no repositorio trata antimeridiano (zero ocorrencias em frontend/src/),
        // e um tratamento inventado aqui seria a unica regra da casa a fazer isso. Uma
        // caixa com oeste > leste desliga a troca: e o lado seguro, e o unico acervo em
        // jogo e o do sul do Brasil.
        const cruzando = [170, -20, -170, 20];
        expect(isCenterInsideBounds(cruzando, { lng: 175, lat: 0 })).toBe(false);
        expect(isCenterInsideBounds(cruzando, { lng: -175, lat: 0 })).toBe(false);
        expect(isCenterInsideBounds(cruzando, { lng: 0, lat: 0 })).toBe(false);
    });
});

// ============================================================================
// decideTerrainBasemap - LIGAR
// ============================================================================

describe('decideTerrainBasemap ao ligar o terreno', () => {
    it('troca para a preferida e lembra a base que estava', () => {
        expect(ligar()).toEqual({
            action: TERRAIN_BASEMAP_ACTION.SWITCH,
            to: 'carta-ortoimagem',
            remember: 'carta-topografica',
        });
    });

    it('com a chave nula nao faz nada e nao lembra nada', () => {
        // O padrao servido por GET /api/config. A base raster que compensa nao existe
        // em nenhuma das duas linhas: vive na configuracao de cada implantacao.
        expect(ligar({ preferred: null })).toEqual({ action: TERRAIN_BASEMAP_ACTION.NONE, to: null, remember: null });
        expect(ligar({ preferred: undefined })).toEqual({ action: TERRAIN_BASEMAP_ACTION.NONE, to: null, remember: null });
        expect(ligar({ preferred: '' })).toEqual({ action: TERRAIN_BASEMAP_ACTION.NONE, to: null, remember: null });
    });

    it('nao faz nada quando a preferida nao esta na lista de bases utilizaveis', () => {
        // A lista sao as bases habilitadas na config que resolvem para algum estilo,
        // embutido ou publicado: uma base desabilitada e uma base sem estilo nenhum
        // caem no mesmo buraco. AQUI isso importa mais do que na `main`, porque
        // `applySharedBasemap` passa o id por `getValidBasemapFallback` antes de
        // trocar: sem esta guarda, um id fora do catalogo trocaria a base do usuario
        // para a PRIMEIRA habilitada, calado.
        expect(ligar({ preferred: 'topografica-raster' }).action).toBe(TERRAIN_BASEMAP_ACTION.NONE);
        expect(ligar({ preferred: 'osm' }).action).toBe(TERRAIN_BASEMAP_ACTION.NONE);
        expect(ligar({ available: [] }).action).toBe(TERRAIN_BASEMAP_ACTION.NONE);
        expect(ligar({ available: null }).action).toBe(TERRAIN_BASEMAP_ACTION.NONE);
    });

    it('nao lembra a base quando o mapa ja esta na preferida', () => {
        // Lembrar aqui seria gravar "carta-ortoimagem" e, ao desligar, "restaurar"
        // para ela mesma: uma troca de estilo inteira para nada.
        expect(ligar({ current: 'carta-ortoimagem' })).toEqual({
            action: TERRAIN_BASEMAP_ACTION.NONE,
            to: null,
            remember: null,
        });
    });

    it('nao troca com o centro fora do recorte da preferida', () => {
        expect(ligar({ bounds: RECORTE_SUL, center: CENTRO_FORA }).action).toBe(TERRAIN_BASEMAP_ACTION.NONE);
        expect(ligar({ bounds: RECORTE_SUL, center: null }).action).toBe(TERRAIN_BASEMAP_ACTION.NONE);
    });

    it('troca com o centro dentro do recorte declarado', () => {
        expect(ligar({ bounds: RECORTE_SUL, center: CENTRO_DENTRO })).toEqual({
            action: TERRAIN_BASEMAP_ACTION.SWITCH,
            to: 'carta-ortoimagem',
            remember: 'carta-topografica',
        });
    });

    it('ligar duas vezes e idempotente e NAO perde a base original', () => {
        // O pior caso do esboco: a segunda passagem lembrava "carta-ortoimagem"
        // (a base ja trocada) e o desligar restaurava a preferida sobre ela mesma,
        // deixando o usuario preso na base da implantacao.
        const primeira = ligar();
        const segunda = ligar({ current: primeira.to, remembered: primeira.remember });
        expect(segunda).toEqual({
            action: TERRAIN_BASEMAP_ACTION.NONE,
            to: null,
            remember: 'carta-topografica',
        });
    });

    it('nao troca sem saber em que base o mapa esta', () => {
        expect(ligar({ current: null }).action).toBe(TERRAIN_BASEMAP_ACTION.NONE);
    });
});

// ============================================================================
// decideTerrainBasemap - DESLIGAR
// ============================================================================

describe('decideTerrainBasemap ao desligar o terreno', () => {
    it('restaura a base lembrada e esquece a lembranca', () => {
        expect(desligar()).toEqual({
            action: TERRAIN_BASEMAP_ACTION.RESTORE,
            to: 'carta-topografica',
            remember: null,
        });
    });

    it('nao faz nada quando o usuario trocou de base com o terreno ligado', () => {
        // A escolha do usuario manda. Desfaze-la ao desligar o terreno seria mexer
        // na tela dele por uma decisao que ele mesmo ja revogou.
        expect(desligar({ userSwitchedSince: true, current: 'bdgex' })).toEqual({
            action: TERRAIN_BASEMAP_ACTION.NONE,
            to: null,
            remember: null,
        });
    });

    it('nao faz nada quando nada foi lembrado', () => {
        // O caso da chave nula, e tambem o do terreno que ligou fora do recorte.
        expect(desligar({ remembered: null, current: 'carta-topografica' })).toEqual({
            action: TERRAIN_BASEMAP_ACTION.NONE,
            to: null,
            remember: null,
        });
    });

    it('nao restaura sobre a base em que o mapa ja esta', () => {
        expect(desligar({ current: 'carta-topografica' })).toEqual({
            action: TERRAIN_BASEMAP_ACTION.NONE,
            to: null,
            remember: null,
        });
    });

    it('esquece, em vez de restaurar, uma base que deixou de estar disponivel', () => {
        // O caso vivo AQUI, e nao so teorico: acervo privado sai de `config` no
        // logout, entao a base lembrada pode ter deixado de resolver para estilo
        // enquanto o terreno estava ligado.
        expect(desligar({ available: ['carta-ortoimagem', 'bdgex'] })).toEqual({
            action: TERRAIN_BASEMAP_ACTION.NONE,
            to: null,
            remember: null,
        });
    });

    it('esquece a lembranca em todos os desfechos, para o proximo ciclo nascer limpo', () => {
        expect(desligar().remember).toBe(null);
        expect(desligar({ userSwitchedSince: true }).remember).toBe(null);
        expect(desligar({ current: 'carta-topografica' }).remember).toBe(null);
        expect(desligar({ preferred: null }).remember).toBe(null);
    });
});

// ============================================================================
// Chamada degenerada
// ============================================================================

describe('decideTerrainBasemap sem argumento util', () => {
    it('nao decide nada quando nao recebe nada', () => {
        expect(decideTerrainBasemap()).toEqual({ action: TERRAIN_BASEMAP_ACTION.NONE, to: null, remember: null });
        expect(decideTerrainBasemap({})).toEqual({ action: TERRAIN_BASEMAP_ACTION.NONE, to: null, remember: null });
    });
});
