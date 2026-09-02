// Path: tests/unit/menu-de-camada-por-estado.test.js
//
// O MENU "mais acoes" DO CABECALHO DA CAMADA, e a mesma assimetria que o menu de mapa
// prende em `tests/unit/map-menu-actions.test.js`. Este e' o irmao dele, um nivel abaixo.
//
// A REGRA, QUE NAO E' UNIFORME DE PROPOSITO:
//   - POSTO esconde o comando. O bloqueio e' permanente enquanto o papel for o que e', e
//     uma linha morta dizendo "exige Editor" transforma o menu num catalogo do que voce
//     nao e'.
//   - ESTADO desenha o comando e recusa o CLIQUE, nomeando o estado. O bloqueio e'
//     reversivel e a pessoa pode ser justamente quem o reverte (destravar o mapa,
//     destravar a camada, criar um segundo mapa), entao a afordancia e' o unico lugar por
//     onde o motivo a alcanca.
//
// O QUE E' PROPRIO DAQUI, e nao existe no menu de mapa: MOVER exige DUAS capacidades,
// `CREATE_FEATURE` (escreve no destino) e `DELETE_FEATURE` (esvazia a origem), enquanto
// COPIAR exige so' a primeira. Oferecer "Mover" a quem cria e nao apaga produziria a falha
// pela METADE, com a camada ja' duplicada no destino e a origem intacta. E as travas da
// ORIGEM (mapa e camada) so' barram o MOVE, porque a copia le' a origem e nao escreve nela.
//
// CONTROLE ABSOLUTO EM TODO BLOCO: sem ele, uma funcao que devolvesse lista vazia sempre
// passaria em quase todos os casos, que e' a cobertura vazia da constituicao.

import { describe, it, expect } from 'vitest';
import {
    LayerMenuAction,
    LAYER_MENU_CAPABILITY,
    layerMenuActions,
    LOCKED_SOURCE_MAP_NOTICE,
    LOCKED_LAYER_NOTICE,
    NO_OTHER_MAP_NOTICE
} from '../../src/js/features_tab/layer-menu-actions.js';

/** O predicado de quem pode tudo. */
const podeTudo = () => true;
/** O de quem nao pode nada (Visualizador num atlas de servidor). */
const naoPodeNada = () => false;
/** Quem cria feicao e NAO apaga: alcanca copiar, nao alcanca mover. */
const soCria = (key) => key === 'CREATE_FEATURE';
/** Quem apaga e NAO cria: nao alcanca nenhum dos dois, porque os dois escrevem no destino. */
const soApaga = (key) => key === 'DELETE_FEATURE';

/** So' os ids, na ordem em que o menu os desenha. */
const ids = (lista) => lista.map((c) => c.id);
/** Os ids que chegam BLOQUEADOS (desenhados, clique recusa). */
const bloqueados = (lista) => lista.filter((c) => c.blocked).map((c) => c.id);
/** A frase de um comando, ou `undefined` se ele nem foi desenhado. */
const frase = (lista, id) => lista.find((c) => c.id === id)?.blocked;

describe('layerMenuActions: o POSTO esconde', () => {
    it('CONTROLE: quem pode tudo recebe os dois, na ordem declarada, sem bloqueio', () => {
        const lista = layerMenuActions({ can: podeTudo });
        expect(ids(lista)).toEqual([LayerMenuAction.MOVE, LayerMenuAction.COPY]);
        expect(bloqueados(lista)).toEqual([]);
    });

    it('quem nao alcanca nada nao recebe comando nenhum', () => {
        expect(layerMenuActions({ can: naoPodeNada })).toEqual([]);
    });

    it('quem CRIA mas nao APAGA perde exatamente Mover, e mantem Copiar', () => {
        // O caso que justifica a lista de capacidades: mover escreve nos DOIS lados.
        const lista = layerMenuActions({ can: soCria });
        expect(ids(lista)).toEqual([LayerMenuAction.COPY]);
    });

    it('quem APAGA mas nao CRIA nao recebe nenhum dos dois', () => {
        // Os dois modos escrevem no destino, entao `CREATE_FEATURE` e' piso dos dois.
        expect(layerMenuActions({ can: soApaga })).toEqual([]);
    });

    it('o comando escondido por posto NAO vem bloqueado, vem ausente', () => {
        // A distincao inteira. Bloqueado, ele ficaria inerte no menu para sempre, sem nada
        // que a pessoa pudesse fazer a respeito daquela tela.
        const lista = layerMenuActions({ can: soCria, sourceLocked: true, hasOtherMaps: false });
        expect(ids(lista)).not.toContain(LayerMenuAction.MOVE);
        expect(frase(lista, LayerMenuAction.MOVE)).toBeUndefined();
    });

    it('o POSTO vence o ESTADO: quem nao alcanca nao ve nem bloqueado', () => {
        const lista = layerMenuActions({
            can: naoPodeNada, sourceLocked: true, layerLocked: true, hasOtherMaps: false
        });
        expect(lista).toEqual([]);
    });

    it('FALHA FECHADA: predicado que lanca esconde o comando', () => {
        const explode = () => { throw new Error('sessao nao hidratada'); };
        expect(layerMenuActions({ can: explode })).toEqual([]);
    });

    it('FALHA FECHADA: predicado que devolve algo que nao e true esconde o comando', () => {
        // `can` devolvendo string nao vazia passaria num teste de veracidade frouxo.
        expect(layerMenuActions({ can: () => 'sim' })).toEqual([]);
    });

    it('a tabela de capacidades declara MOVER com duas e COPIAR com uma', () => {
        // Asserido em igualdade absoluta: e' esta tabela que responde "por que sumiu".
        expect(LAYER_MENU_CAPABILITY[LayerMenuAction.MOVE])
            .toEqual(['CREATE_FEATURE', 'DELETE_FEATURE']);
        expect(LAYER_MENU_CAPABILITY[LayerMenuAction.COPY]).toEqual(['CREATE_FEATURE']);
    });
});

describe('layerMenuActions: o ESTADO desenha e recusa o clique', () => {
    it('mapa de origem travado bloqueia SO o mover, nomeando o mapa', () => {
        const lista = layerMenuActions({ can: podeTudo, sourceLocked: true });
        expect(ids(lista)).toEqual([LayerMenuAction.MOVE, LayerMenuAction.COPY]);
        expect(bloqueados(lista)).toEqual([LayerMenuAction.MOVE]);
        expect(frase(lista, LayerMenuAction.MOVE)).toBe(LOCKED_SOURCE_MAP_NOTICE);
        expect(frase(lista, LayerMenuAction.COPY)).toBeNull();
    });

    it('camada travada bloqueia SO o mover, com frase PROPRIA', () => {
        const lista = layerMenuActions({ can: podeTudo, layerLocked: true });
        expect(bloqueados(lista)).toEqual([LayerMenuAction.MOVE]);
        expect(frase(lista, LayerMenuAction.MOVE)).toBe(LOCKED_LAYER_NOTICE);
        // Duas travas diferentes, duas frases diferentes: a pessoa destrava coisas
        // distintas em telas distintas.
        expect(LOCKED_LAYER_NOTICE).not.toBe(LOCKED_SOURCE_MAP_NOTICE);
    });

    it('mapa E camada travados: o mapa ganha, porque e o que se destrava primeiro', () => {
        const lista = layerMenuActions({ can: podeTudo, sourceLocked: true, layerLocked: true });
        expect(frase(lista, LayerMenuAction.MOVE)).toBe(LOCKED_SOURCE_MAP_NOTICE);
    });

    it('COPIAR atravessa as duas travas de origem: ele le a origem e escreve em outro lugar', () => {
        const lista = layerMenuActions({ can: podeTudo, sourceLocked: true, layerLocked: true });
        expect(frase(lista, LayerMenuAction.COPY)).toBeNull();
    });

    it('atlas de um mapa so bloqueia os DOIS, desenhados, com a frase do estado', () => {
        // Escondidos, os comandos piscariam no menu conforme mapas nascem e morrem, sem
        // que motivo nenhum fosse dado.
        const lista = layerMenuActions({ can: podeTudo, hasOtherMaps: false });
        expect(ids(lista)).toEqual([LayerMenuAction.MOVE, LayerMenuAction.COPY]);
        expect(bloqueados(lista)).toEqual([LayerMenuAction.MOVE, LayerMenuAction.COPY]);
        expect(frase(lista, LayerMenuAction.COPY)).toBe(NO_OTHER_MAP_NOTICE);
    });

    it('sem outro mapa E com a origem travada, os DOIS falam do mapa que falta', () => {
        // A PRECEDENCIA E' O CASO. As duas frases de trava terminam em "ou copie-a", conselho
        // que so' vale se copiar for possivel; num atlas de um mapa so' nao e'. Falar da trava
        // ali mandaria a pessoa fazer exatamente o que a linha de baixo recusa.
        const lista = layerMenuActions({ can: podeTudo, sourceLocked: true, hasOtherMaps: false });
        expect(frase(lista, LayerMenuAction.MOVE)).toBe(NO_OTHER_MAP_NOTICE);
        expect(frase(lista, LayerMenuAction.COPY)).toBe(NO_OTHER_MAP_NOTICE);
    });

    it('a camada travada tambem cede a vez ao mapa que falta', () => {
        const lista = layerMenuActions({ can: podeTudo, layerLocked: true, hasOtherMaps: false });
        expect(frase(lista, LayerMenuAction.MOVE)).toBe(NO_OTHER_MAP_NOTICE);
    });

    it('CONTROLE: HAVENDO outro mapa, a trava volta a ser a frase do mover', () => {
        // Sem este par, a precedencia acima passaria com um modelo que so' soubesse dizer
        // "nao ha outro mapa".
        const lista = layerMenuActions({ can: podeTudo, sourceLocked: true, hasOtherMaps: true });
        expect(frase(lista, LayerMenuAction.MOVE)).toBe(LOCKED_SOURCE_MAP_NOTICE);
        expect(frase(lista, LayerMenuAction.COPY)).toBeNull();
    });

    it('o padrao sem argumento nenhum falha fechado', () => {
        // `can` ausente vira `can(...)` lancando TypeError, que a guarda captura.
        expect(layerMenuActions()).toEqual([]);
    });

    it('devolve um array NOVO a cada chamada', () => {
        const a = layerMenuActions({ can: podeTudo });
        const b = layerMenuActions({ can: podeTudo });
        expect(a).not.toBe(b);
        a[0].blocked = 'contaminado';
        expect(layerMenuActions({ can: podeTudo })[0].blocked).toBeNull();
    });
});
