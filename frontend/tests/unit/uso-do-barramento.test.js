// Path: tests/unit/uso-do-barramento.test.js

/**
 * @fileoverview A ESCUTA DE USO NO BARRAMENTO: cinco eventos viram contagem, o resto não deixa
 * rastro, e UM deles tem filtro.
 *
 * O CASO QUE ESTE ARQUIVO EXISTE PARA IMPEDIR é o do interruptor contado nos dois sentidos.
 * `MAP_TEMPORAL_CHANGED` é emitido ao LIGAR e ao DESLIGAR a linha do tempo, e o payload diz qual
 * (`enabled`). Sem o filtro, "temporal ativado" vale o dobro para quem liga e desliga, e o ato de
 * DESLIGAR entra numa métrica que se chama "ativado". CONTROLE NEGATIVO conferido revertendo:
 * tirar o `quando` da entrada deixa este caso vermelho, e só ele.
 *
 * O SEGUNDO CONTROLE NEGATIVO é o campo do payload. Os dois emissores mandam `enabled`, e a
 * configuração temporal guarda `ativo` no store: escrever `ativo` aqui produz um filtro que NUNCA
 * casa, ou seja uma métrica sempre zerada, sem erro em lugar nenhum. O caso emite os dois nomes e
 * exige que só o certo conte.
 *
 * A LISTA DE EVENTOS VEM DO PRÓPRIO MÓDULO (`EVENTOS_DE_USO_OBSERVADOS`), e não escrita à mão
 * aqui: uma lista à mão deixaria o evento novo sem cobertura no dia em que ele entrasse na
 * allowlist. É a mesma forma de `migalhas-do-barramento.test.js`.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { EventTypes } from '@events/event_types.js';
import {
    configurarUso,
    descarregarUso,
    desinstalarUso,
    registrarUso,
} from '@js/session/uso-lote.js';
import { EventoDeUso } from '@js/session/eventos-de-uso.js';
import {
    EVENTOS_DE_USO_OBSERVADOS,
    instalarUsoDoBarramento,
} from '@js/session/uso-do-barramento.js';

/** Um barramento de mentira com a única superfície que a escuta usa. */
function criarBarramento() {
    const ouvintes = new Set();
    return {
        onAny(fn) {
            ouvintes.add(fn);
            return () => ouvintes.delete(fn);
        },
        emitir(evento, payload) {
            for (const fn of [...ouvintes]) fn(evento, payload);
        },
        quantos: () => ouvintes.size,
    };
}

/** Instala o acumulador com transporte espião e devolve os corpos que ele viu. */
function acumuladorEspiao() {
    const corpos = [];
    configurarUso({
        pagina: 'mapa',
        sessaoId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
        enviar: (corpo) => { corpos.push(corpo); return true; },
        alvo: { addEventListener() {}, removeEventListener() {} },
        documento: { addEventListener() {}, removeEventListener() {} },
        intervaloMs: 0,
    });
    return corpos;
}

/** As linhas do último lote, na forma `evento` → contagem. */
function contagens(corpos) {
    descarregarUso();
    const corpo = corpos[corpos.length - 1];
    if (!corpo) return {};
    return Object.fromEntries(corpo.eventos.map((l) => [l.evento, l.contagem]));
}

let barramento;
let soltar;

beforeEach(() => {
    barramento = criarBarramento();
});

afterEach(() => {
    soltar?.();
    soltar = null;
    desinstalarUso();
});

describe('instalarUsoDoBarramento — a allowlist', () => {
    it('a allowlist tem os cinco eventos, e a lista vem do módulo', () => {
        expect([...EVENTOS_DE_USO_OBSERVADOS]).toEqual([
            EventTypes.VIEWER_3D_OPENED,
            EventTypes.STREETVIEW_360_OPENED,
            EventTypes.FIRST_PERSON_OPENED,
            EventTypes.BRIEFING_PRESENT_STARTED,
            EventTypes.MAP_TEMPORAL_CHANGED,
        ]);
        expect(Object.isFrozen(EVENTOS_DE_USO_OBSERVADOS)).toBe(true);
    });

    it('os QUATRO sem filtro viram contagem, um a um', () => {
        const corpos = acumuladorEspiao();
        soltar = instalarUsoDoBarramento(barramento);
        barramento.emitir(EventTypes.VIEWER_3D_OPENED, { tilesetId: 'x' });
        barramento.emitir(EventTypes.STREETVIEW_360_OPENED, { photoName: 'y' });
        barramento.emitir(EventTypes.FIRST_PERSON_OPENED, { sceneId: 'z' });
        barramento.emitir(EventTypes.BRIEFING_PRESENT_STARTED, { briefingId: 'b' });
        expect(contagens(corpos)).toEqual({
            [EventoDeUso.VISUALIZADOR3D_ABERTO]: 1,
            [EventoDeUso.VISUALIZADOR360_ABERTO]: 1,
            [EventoDeUso.PRIMEIRA_PESSOA_ABERTO]: 1,
            [EventoDeUso.BRIEFING_APRESENTADO]: 1,
        });
    });

    it('evento FORA da allowlist não deixa contagem nenhuma', () => {
        const corpos = acumuladorEspiao();
        soltar = instalarUsoDoBarramento(barramento);
        // Os quentes chegam aqui o tempo todo e saem numa falta de chave.
        barramento.emitir(EventTypes.TEMPORAL_CURSOR_CHANGED, { t: 1 });
        barramento.emitir(EventTypes.VIEWER_3D_CLOSED, {});
        barramento.emitir(EventTypes.STREETVIEW_360_CLOSED, {});
        barramento.emitir(EventTypes.BRIEFING_PRESENT_ENDED, {});
        barramento.emitir('toString', {});
        expect(contagens(corpos)).toEqual({});
    });

    it('NENHUM campo do payload viaja: a contagem é do gesto, nunca do conteúdo', () => {
        const corpos = acumuladorEspiao();
        soltar = instalarUsoDoBarramento(barramento);
        barramento.emitir(EventTypes.VIEWER_3D_OPENED, {
            tilesetId: 'modelo-do-Cel-Fulano',
            properties: { nome: 'Cel Fulano' },
            userId: 'u-1',
        });
        descarregarUso();
        const bruto = JSON.stringify(corpos[corpos.length - 1]);
        expect(bruto).not.toContain('Fulano');
        expect(bruto).not.toContain('u-1');
        expect(bruto).not.toContain('modelo-do');
        // E a linha continua sem `prop`: o evento não aceita nenhuma.
        expect(corpos[corpos.length - 1].eventos).toEqual([
            { evento: EventoDeUso.VISUALIZADOR3D_ABERTO, contagem: 1 },
        ]);
    });
});

describe('MAP_TEMPORAL_CHANGED — o interruptor, e só um dos dois sentidos', () => {
    it('conta ao LIGAR e não conta ao DESLIGAR', () => {
        const corpos = acumuladorEspiao();
        soltar = instalarUsoDoBarramento(barramento);
        barramento.emitir(EventTypes.MAP_TEMPORAL_CHANGED, { mapName: 'M', enabled: true });
        barramento.emitir(EventTypes.MAP_TEMPORAL_CHANGED, { mapName: 'M', enabled: false });
        barramento.emitir(EventTypes.MAP_TEMPORAL_CHANGED, { mapName: 'M', enabled: true });
        expect(contagens(corpos)).toEqual({ [EventoDeUso.TEMPORAL_ATIVADO]: 2 });
    });

    it('o campo é `enabled`, e NÃO `ativo`: o nome do store não casa aqui', () => {
        const corpos = acumuladorEspiao();
        soltar = instalarUsoDoBarramento(barramento);
        // `ativo` é como a CONFIGURAÇÃO chama o campo; o EVENTO anuncia `enabled`. Um filtro
        // escrito sobre o nome errado produz uma métrica sempre zerada, sem erro nenhum.
        barramento.emitir(EventTypes.MAP_TEMPORAL_CHANGED, { mapName: 'M', ativo: true });
        expect(contagens(corpos)).toEqual({});
        barramento.emitir(EventTypes.MAP_TEMPORAL_CHANGED, { mapName: 'M', enabled: true });
        expect(contagens(corpos)).toEqual({ [EventoDeUso.TEMPORAL_ATIVADO]: 1 });
    });

    it('o ECO REMOTO não conta, e é ele que faria a métrica medir a equipe', () => {
        // O `remote-operation-handler.js` emite este evento a CADA op de entrada que carregue a
        // configuração temporal, sem detecção de mudança: um colega que liga a linha do tempo
        // UMA vez produz uma emissão em cada aba do atlas. Sem o segundo termo do filtro, o
        // número cresce com o tamanho da equipe sem ninguém ter ligado nada a mais.
        const corpos = acumuladorEspiao();
        soltar = instalarUsoDoBarramento(barramento);
        barramento.emitir(EventTypes.MAP_TEMPORAL_CHANGED, {
            mapName: 'M', enabled: true, remoto: true,
        });
        barramento.emitir(EventTypes.MAP_TEMPORAL_CHANGED, {
            mapName: 'M', enabled: false, remoto: true,
        });
        expect(contagens(corpos)).toEqual({});
        // E o gesto LOCAL, que é o mesmo evento SEM o carimbo, continua contando.
        barramento.emitir(EventTypes.MAP_TEMPORAL_CHANGED, { mapName: 'M', enabled: true });
        expect(contagens(corpos)).toEqual({ [EventoDeUso.TEMPORAL_ATIVADO]: 1 });
    });

    it('o carimbo de procedência existe no emissor remoto, e só nele', () => {
        // AMARRAÇÃO ENTRE OS DOIS ARQUIVOS: o filtro acima é inútil se o emissor parar de
        // carimbar, e nada além desta asserção liga os dois. A leitura é da FONTE porque o
        // manipulador de op remota arrasta a store inteira e não se importa em node.
        const remoto = readFileSync(new URL(
            '../../src/js/store/sync/remote-operation-handler.js', import.meta.url,
        ), 'utf8');
        expect(remoto).toMatch(/MAP_TEMPORAL_CHANGED,\s*{[^}]*remoto:\s*true/);
        const local = readFileSync(new URL(
            '../../src/js/store/temporal.operations.js', import.meta.url,
        ), 'utf8');
        expect(local).toMatch(/MAP_TEMPORAL_CHANGED/);
        expect(local, 'o emissor LOCAL não pode se carimbar como remoto').not.toMatch(
            /MAP_TEMPORAL_CHANGED,\s*{[^}]*remoto/,
        );
    });

    it('payload ausente ou hostil não conta e não lança', () => {
        const corpos = acumuladorEspiao();
        soltar = instalarUsoDoBarramento(barramento);
        expect(() => {
            barramento.emitir(EventTypes.MAP_TEMPORAL_CHANGED, undefined);
            barramento.emitir(EventTypes.MAP_TEMPORAL_CHANGED, { enabled: 'sim' });
            barramento.emitir(EventTypes.MAP_TEMPORAL_CHANGED, { enabled: 1 });
        }).not.toThrow();
        expect(contagens(corpos)).toEqual({});
    });
});

describe('instalarUsoDoBarramento — a fiação', () => {
    it('é IDEMPOTENTE: a segunda chamada não dobra a contagem', () => {
        const corpos = acumuladorEspiao();
        soltar = instalarUsoDoBarramento(barramento);
        instalarUsoDoBarramento(barramento);
        expect(barramento.quantos()).toBe(1);
        barramento.emitir(EventTypes.VIEWER_3D_OPENED, {});
        expect(contagens(corpos)).toEqual({ [EventoDeUso.VISUALIZADOR3D_ABERTO]: 1 });
    });

    it('um barramento sem `onAny` devolve um desfazedor inerte, sem lançar', () => {
        expect(() => instalarUsoDoBarramento(null)()).not.toThrow();
        expect(() => instalarUsoDoBarramento({})()).not.toThrow();
    });

    it('a escuta NUNCA quebra a entrega de evento, mesmo sem acumulador instalado', () => {
        // Ela observa, não participa: sem `configurarUso`, `registrarUso` é inerte e conta.
        soltar = instalarUsoDoBarramento(barramento);
        expect(() => barramento.emitir(EventTypes.VIEWER_3D_OPENED, {})).not.toThrow();
        expect(registrarUso(EventoDeUso.PAGINA_VISTA)).toBe(false);
    });
});
