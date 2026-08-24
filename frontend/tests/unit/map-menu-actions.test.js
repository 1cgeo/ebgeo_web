// Path: tests/unit/map-menu-actions.test.js
//
// O MENU DE CONTEXTO DO MAPA, que até 2026-08-24 não consultava permissão NENHUMA.
//
// Ele era montado a partir de duas leituras (`isMapLocked` e a lista de mapas), então um
// Leitor recebia Salvar posição, Duplicar, Renomear, Puxar outros mapas e Deletar, e um
// Editor recebia Deletar e Puxar outros mapas, que exigem `manage`. É a classe "a UI
// promete o que o servidor recusa", a que congelou a fila de saída duas vezes aqui.
//
// A REGRA QUE ESTE ARQUIVO PRENDE, e ela NÃO é uniforme de propósito:
//   - POSTO esconde o comando (bloqueio permanente enquanto o papel for o que é);
//   - ESTADO desenha o comando e recusa o CLIQUE nomeando o estado (bloqueio reversível,
//     e a pessoa pode ser justamente quem o reverte).
//
// A assimetria É o desenho. Antes, os dois escondiam, e o menu de um Leitor era idêntico
// ao do dono de um mapa TRAVADO: nenhum dos dois aprendia nada, e um deles só precisava
// clicar no cadeado.

import { describe, it, expect } from 'vitest';
import {
    MapMenuAction,
    MAP_MENU_CAPABILITY,
    mapMenuActions,
    LOCKED_MAP_NOTICE,
    LAST_MAP_NOTICE
} from '../../src/js/sidebar/tabs/map-menu-actions.js';

/** O predicado de capacidade de quem pode tudo. */
const podeTudo = () => true;
/** O de quem não pode nada (Visualizador num atlas de servidor). */
const naoPodeNada = () => false;
/** Um Editor: alcança edição e apagar item, não alcança gestão de mapa. */
const editor = (key) => key !== 'DELETE_MAP' && key !== 'COMBINE_MAPS';

/** Só os ids, na ordem em que o menu os desenha. */
const ids = (lista) => lista.map((c) => c.id);
/** Os ids que chegam BLOQUEADOS (desenhados, clique recusa). */
const bloqueados = (lista) => lista.filter((c) => c.blocked).map((c) => c.id);

describe('mapMenuActions: o POSTO esconde', () => {
    it('quem não alcança nada não recebe comando nenhum', () => {
        expect(mapMenuActions({ can: naoPodeNada, isActiveMap: true, hasSavedPosition: true }))
            .toEqual([]);
    });

    it('o EDITOR perde exatamente Puxar outros mapas e Deletar, e mantém o resto', () => {
        // O caso medido no relatório: as duas exigem `manage` e eram oferecidas a ele.
        const lista = mapMenuActions({ can: editor, isActiveMap: true, hasSavedPosition: true });
        expect(ids(lista)).toEqual([
            MapMenuAction.SAVE_POSITION,
            MapMenuAction.CLEAR_POSITION,
            MapMenuAction.DUPLICATE,
            MapMenuAction.RENAME
        ]);
    });

    it('o comando escondido por posto não vem BLOQUEADO, vem ausente', () => {
        // A distinção inteira. Se ele viesse bloqueado, o Editor veria "Deletar" inerte em todo
        // mapa, para sempre, sem nada que pudesse fazer a respeito.
        const lista = mapMenuActions({ can: editor, isActiveMap: true });
        expect(ids(lista)).not.toContain(MapMenuAction.DELETE);
        expect(bloqueados(lista)).toEqual([]);
    });

    it('CONTROLE: quem pode tudo recebe os seis, na ordem declarada', () => {
        // Sem esta asserção absoluta, todos os casos acima passariam com uma função que devolve
        // lista vazia sempre, que é a cobertura vazia da constituição.
        const lista = mapMenuActions({
            can: podeTudo, isActiveMap: true, hasSavedPosition: true
        });
        expect(ids(lista)).toEqual([
            MapMenuAction.SAVE_POSITION,
            MapMenuAction.CLEAR_POSITION,
            MapMenuAction.DUPLICATE,
            MapMenuAction.RENAME,
            MapMenuAction.COMBINE,
            MapMenuAction.DELETE
        ]);
        expect(bloqueados(lista)).toEqual([]);
    });
});

describe('mapMenuActions: o ESTADO desenha e recusa o clique', () => {
    it('mapa travado mantém os comandos na tela, com o motivo', () => {
        const lista = mapMenuActions({
            can: podeTudo, locked: true, isActiveMap: true, hasSavedPosition: true
        });
        expect(bloqueados(lista)).toEqual([
            MapMenuAction.SAVE_POSITION,
            MapMenuAction.CLEAR_POSITION,
            MapMenuAction.RENAME,
            MapMenuAction.COMBINE,
            MapMenuAction.DELETE
        ]);
        expect(lista.find((c) => c.id === MapMenuAction.RENAME).blocked).toBe(LOCKED_MAP_NOTICE);
    });

    it('DUPLICAR atravessa o cadeado: ele lê a origem e escreve em outro lugar', () => {
        const lista = mapMenuActions({ can: podeTudo, locked: true });
        expect(lista.find((c) => c.id === MapMenuAction.DUPLICATE).blocked).toBeNull();
    });

    it('o último mapa bloqueia Deletar com frase PRÓPRIA, não com a do cadeado', () => {
        const lista = mapMenuActions({ can: podeTudo, isLastMap: true });
        expect(lista.find((c) => c.id === MapMenuAction.DELETE).blocked).toBe(LAST_MAP_NOTICE);
        expect(LAST_MAP_NOTICE).not.toBe(LOCKED_MAP_NOTICE);
    });

    it('travado E último: o cadeado ganha, porque é o que a pessoa destrava primeiro', () => {
        const lista = mapMenuActions({ can: podeTudo, locked: true, isLastMap: true });
        expect(lista.find((c) => c.id === MapMenuAction.DELETE).blocked).toBe(LOCKED_MAP_NOTICE);
    });

    it('o POSTO vence o ESTADO: quem não alcança não vê nem bloqueado', () => {
        // A ordem das duas regras importa. Se o estado vencesse, um Leitor num mapa travado
        // veria cinco comandos inertes explicando o cadeado, quando o cadeado não é o problema
        // dele.
        const lista = mapMenuActions({ can: editor, locked: true, isLastMap: true });
        expect(ids(lista)).not.toContain(MapMenuAction.DELETE);
        expect(ids(lista)).not.toContain(MapMenuAction.COMBINE);
    });
});

describe('mapMenuActions: o que é ausência de sentido, e não bloqueio', () => {
    it('posição só existe no mapa ATIVO, porque age sobre a câmera na tela', () => {
        const lista = mapMenuActions({ can: podeTudo, isActiveMap: false, hasSavedPosition: true });
        expect(ids(lista)).not.toContain(MapMenuAction.SAVE_POSITION);
        expect(ids(lista)).not.toContain(MapMenuAction.CLEAR_POSITION);
    });

    it('limpar posição só existe quando há posição salva', () => {
        const lista = mapMenuActions({ can: podeTudo, isActiveMap: true, hasSavedPosition: false });
        expect(ids(lista)).toContain(MapMenuAction.SAVE_POSITION);
        expect(ids(lista)).not.toContain(MapMenuAction.CLEAR_POSITION);
    });
});

describe('mapMenuActions: falha FECHADA', () => {
    it('predicado que lança esconde o comando em vez de derrubar o menu', () => {
        const lanca = () => { throw new Error('store não montado'); };
        expect(() => mapMenuActions({ can: lanca, isActiveMap: true })).not.toThrow();
        expect(mapMenuActions({ can: lanca, isActiveMap: true })).toEqual([]);
    });

    it('predicado que devolve valor não-booleano verdadeiro NÃO abre o comando', () => {
        // `checkPermission(k).allowed` pode virar undefined se o guarda mudar de forma. Um
        // `if (can(...))` aceitaria qualquer truthy; a comparação com `true` fecha isso.
        for (const retorno of [undefined, null, 1, 'sim', {}]) {
            expect(mapMenuActions({ can: () => retorno, isActiveMap: true })).toEqual([]);
        }
    });

    it('sem argumento nenhum devolve lista vazia sem lançar', () => {
        expect(mapMenuActions()).toEqual([]);
    });

    it('devolve um array NOVO a cada chamada', () => {
        const a = mapMenuActions({ can: podeTudo });
        const b = mapMenuActions({ can: podeTudo });
        expect(a).not.toBe(b);
        a.push({ id: 'lixo', blocked: null });
        expect(mapMenuActions({ can: podeTudo })).toEqual(b);
    });
});

describe('MAP_MENU_CAPABILITY: a tabela que torna o gate auditável', () => {
    it('todo comando do menu tem capacidade declarada', () => {
        for (const id of Object.values(MapMenuAction)) {
            expect(MAP_MENU_CAPABILITY[id], id).toBeTruthy();
        }
    });

    it('DUPLICAR pede CREATE_MAP: ele escreve um mapa novo, não é leitura', () => {
        // O código antigo o chamava de "read-only operation" e o oferecia ao Leitor.
        expect(MAP_MENU_CAPABILITY[MapMenuAction.DUPLICATE]).toBe('CREATE_MAP');
    });

    it('PUXAR OUTROS MAPAS pede o mesmo degrau que DELETAR, como o servidor', () => {
        // Combinar esvazia os mapas de origem e não registra o que veio de onde; o servidor
        // exige `manage` em POST /maps/:id/merge.
        expect(MAP_MENU_CAPABILITY[MapMenuAction.COMBINE]).toBe('COMBINE_MAPS');
        expect(MAP_MENU_CAPABILITY[MapMenuAction.DELETE]).toBe('DELETE_MAP');
    });
});
