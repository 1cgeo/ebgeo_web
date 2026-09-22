// Path: tests/unit/vista-da-pessoa-disco.test.js
//
// O REGISTRO DA VISTA LEMBRADA DA PESSOA, NO DISCO (pedido do dono, 2026-09-22: o mapa base e o
// interruptor temporal não sincronizam, mas a preferência da pessoa naquele mapa fica salva neste
// computador).
//
// ESTA FOLHA NÃO DECIDE QUEM LEMBRA NEM QUANDO SE LÊ; isso é `store/vista-da-pessoa.js`, cobrado
// em `tests/integration/vista-da-pessoa-lembrada.test.js`. Aqui se prende o que o formato promete e
// que a integração não enxerga: um dono por registro (duas contas nunca leem a vista uma da outra),
// campo de tipo errado que nunca vira buraco, o teto por recência, e a degradação muda quando o
// `localStorage` falta, lança ou guarda lixo, porque esta leitura roda dentro da ENTRADA no mapa e
// uma exceção ali custaria o mapa, não a preferência.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    MAX_REMEMBERED_MAPS,
    forgetPersonView,
    forgetPersonViews,
    movePersonView,
    personViewStorageKey,
    readPersonView,
    rememberPersonView,
} from '../../src/js/store/vista-da-pessoa-disco.js';

let disco;

beforeEach(() => {
    disco = new Map();
    vi.stubGlobal('localStorage', {
        getItem: (chave) => (disco.has(chave) ? disco.get(chave) : null),
        setItem: (chave, valor) => { disco.set(chave, String(valor)); },
        removeItem: (chave) => { disco.delete(chave); },
    });
});

afterEach(() => {
    vi.unstubAllGlobals();
});

const LOCAL = (mapKey, dbSuffix = 'local-1') => ({ dbSuffix, owner: null, mapKey });
const DE = (owner, mapKey, dbSuffix = 'remote-a') => ({ dbSuffix, owner, mapKey });

describe('a chave e o formato', () => {
    it('uma chave por namespace, com o sufixo do banco depois de dois-pontos', () => {
        expect(personViewStorageKey('local-1')).toBe('ebgeo_vista_da_pessoa:local-1');
        // O slot legado tem sufixo VAZIO, e a chave dele continua distinta de qualquer outra.
        expect(personViewStorageKey('')).toBe('ebgeo_vista_da_pessoa:');
    });

    it('lembra e lê de volta, campo por campo, sem que um campo apague o outro', () => {
        expect(rememberPersonView(LOCAL('m1'), { baseLayer: 'osm' })).toBe(true);
        expect(rememberPersonView(LOCAL('m1'), { temporalEnabled: false })).toBe(true);

        expect(readPersonView(LOCAL('m1'))).toEqual({ baseLayer: 'osm', temporalEnabled: false });
        // O DESLIGADO É LEMBRADO: `false` é uma escolha, não ausência.
        expect(readPersonView(LOCAL('m1')).temporalEnabled).toBe(false);
        expect(readPersonView(LOCAL('m2'))).toEqual({});
    });

    it.each([
        ['base vazia', { baseLayer: '' }],
        ['base nula', { baseLayer: null }],
        ['base numérica', { baseLayer: 42 }],
        ['interruptor em texto', { temporalEnabled: 'true' }],
        ['interruptor nulo', { temporalEnabled: null }],
        ['patch vazio', {}],
        ['patch ausente', undefined],
    ])('campo de tipo errado (%s) não vira buraco: nada é gravado', (_nome, patch) => {
        expect(rememberPersonView(LOCAL('m1'), patch)).toBe(false);
        expect(disco.size).toBe(0);
    });

    it('um campo inválido ao lado de um válido: só o válido entra', () => {
        rememberPersonView(LOCAL('m1'), { baseLayer: 'imagens', temporalEnabled: 'sim' });
        expect(readPersonView(LOCAL('m1'))).toEqual({ baseLayer: 'imagens' });
    });

    it.each([
        ['alvo nulo', null],
        ['sem mapa', { dbSuffix: 'local-1', owner: null, mapKey: '' }],
        ['sem sufixo', { owner: null, mapKey: 'm1' }],
        ['dono vazio', { dbSuffix: 'remote-a', owner: '', mapKey: 'm1' }],
    ])('alvo inválido (%s) não lê nem escreve', (_nome, alvo) => {
        expect(rememberPersonView(alvo, { baseLayer: 'osm' })).toBe(false);
        expect(readPersonView(alvo)).toEqual({});
        expect(forgetPersonView(alvo)).toBe(false);
        expect(disco.size).toBe(0);
    });
});

describe('um dono por registro', () => {
    it('a vista de uma conta não é lida por outra, nem pelo computador', () => {
        rememberPersonView(DE('u1', 'm1'), { baseLayer: 'osm', temporalEnabled: true });

        expect(readPersonView(DE('u1', 'm1'))).toEqual({ baseLayer: 'osm', temporalEnabled: true });
        expect(readPersonView(DE('u2', 'm1'))).toEqual({});
        expect(readPersonView({ dbSuffix: 'remote-a', owner: null, mapKey: 'm1' })).toEqual({});
    });

    it('a primeira escrita de outra conta SUBSTITUI o registro, e a anterior não volta', () => {
        rememberPersonView(DE('u1', 'm1'), { baseLayer: 'osm' });
        rememberPersonView(DE('u2', 'm2'), { temporalEnabled: true });

        expect(readPersonView(DE('u2', 'm2'))).toEqual({ temporalEnabled: true });
        expect(readPersonView(DE('u1', 'm1'))).toEqual({});
        expect(JSON.parse(disco.get(personViewStorageKey('remote-a'))).owner).toBe('u2');
    });

    it('esquecer em nome de outra conta não mexe em nada', () => {
        rememberPersonView(DE('u1', 'm1'), { baseLayer: 'osm' });
        expect(forgetPersonView(DE('u2', 'm1'))).toBe(false);
        expect(readPersonView(DE('u1', 'm1'))).toEqual({ baseLayer: 'osm' });
    });

    it('namespaces diferentes são registros diferentes, mesmo com a mesma chave de mapa', () => {
        rememberPersonView(LOCAL('Principal', 'local-1'), { baseLayer: 'osm' });
        rememberPersonView(LOCAL('Principal', 'local-2'), { baseLayer: 'imagens' });

        expect(readPersonView(LOCAL('Principal', 'local-1')).baseLayer).toBe('osm');
        expect(readPersonView(LOCAL('Principal', 'local-2')).baseLayer).toBe('imagens');
    });
});

describe('o teto por recência', () => {
    it('guarda os últimos mapas escolhidos, e escolher de novo um antigo o salva do corte', () => {
        rememberPersonView(LOCAL('antigo'), { baseLayer: 'osm' });
        for (let i = 0; i < MAX_REMEMBERED_MAPS - 1; i++) {
            rememberPersonView(LOCAL(`m${i}`), { temporalEnabled: true });
        }
        // Cheio exatamente no teto: nada caiu ainda.
        expect(readPersonView(LOCAL('antigo'))).toEqual({ baseLayer: 'osm' });

        // O antigo é escolhido de novo, vai para o fim, e o próximo mapa novo derruba o m0.
        rememberPersonView(LOCAL('antigo'), { temporalEnabled: false });
        rememberPersonView(LOCAL('novo'), { baseLayer: 'imagens' });

        const registro = JSON.parse(disco.get(personViewStorageKey('local-1')));
        expect(registro.maps).toHaveLength(MAX_REMEMBERED_MAPS);
        expect(readPersonView(LOCAL('m0'))).toEqual({});
        expect(readPersonView(LOCAL('antigo'))).toEqual({ baseLayer: 'osm', temporalEnabled: false });
        expect(registro.maps.at(-1).key).toBe('novo');
    });
});

describe('esquecer e mover', () => {
    it('esquecer só a base mantém o interruptor, e esquecer tudo tira a entrada', () => {
        rememberPersonView(LOCAL('m1'), { baseLayer: 'osm', temporalEnabled: true });
        rememberPersonView(LOCAL('m2'), { baseLayer: 'imagens' });

        expect(forgetPersonView(LOCAL('m1'), { baseLayer: true, temporalEnabled: false })).toBe(true);
        expect(readPersonView(LOCAL('m1'))).toEqual({ temporalEnabled: true });

        expect(forgetPersonView(LOCAL('m1'))).toBe(true);
        expect(readPersonView(LOCAL('m1'))).toEqual({});
        expect(readPersonView(LOCAL('m2'))).toEqual({ baseLayer: 'imagens' });
    });

    it('esquecer a ÚLTIMA entrada apaga a chave inteira: registro vazio não fica no disco', () => {
        rememberPersonView(LOCAL('m1'), { baseLayer: 'osm' });
        forgetPersonView(LOCAL('m1'));
        expect(disco.has(personViewStorageKey('local-1'))).toBe(false);
    });

    it('esquecer um mapa que não tem nada lembrado responde falso', () => {
        rememberPersonView(LOCAL('m1'), { baseLayer: 'osm' });
        expect(forgetPersonView(LOCAL('outro'))).toBe(false);
    });

    it('mover leva a entrada para a chave nova e substitui o que houvesse lá', () => {
        rememberPersonView(LOCAL('Velho'), { baseLayer: 'osm', temporalEnabled: true });
        rememberPersonView(LOCAL('Novo'), { baseLayer: 'imagens' });

        expect(movePersonView('local-1', 'Velho', 'Novo')).toBe(true);

        expect(readPersonView(LOCAL('Velho'))).toEqual({});
        expect(readPersonView(LOCAL('Novo'))).toEqual({ baseLayer: 'osm', temporalEnabled: true });
        expect(JSON.parse(disco.get(personViewStorageKey('local-1'))).maps).toHaveLength(1);
    });

    it('mover sem entrada na chave velha não cria nada', () => {
        expect(movePersonView('local-1', 'Velho', 'Novo')).toBe(false);
        expect(movePersonView('local-1', 'Mesmo', 'Mesmo')).toBe(false);
        expect(disco.size).toBe(0);
    });

    it('esquecer o namespace apaga o registro dele e só o dele', () => {
        rememberPersonView(LOCAL('m1', 'local-1'), { baseLayer: 'osm' });
        rememberPersonView(LOCAL('m1', 'local-2'), { baseLayer: 'osm' });

        forgetPersonViews('local-1');

        expect(disco.has(personViewStorageKey('local-1'))).toBe(false);
        expect(readPersonView(LOCAL('m1', 'local-2'))).toEqual({ baseLayer: 'osm' });
    });
});

describe('a degradação é muda, porque esta leitura roda dentro da entrada no mapa', () => {
    it('sem localStorage: lê vazio e não grava, sem lançar', () => {
        vi.stubGlobal('localStorage', undefined);
        expect(readPersonView(LOCAL('m1'))).toEqual({});
        expect(rememberPersonView(LOCAL('m1'), { baseLayer: 'osm' })).toBe(false);
        expect(() => forgetPersonViews('local-1')).not.toThrow();
    });

    it('um localStorage que LANÇA (cota, modo privado) não derruba ninguém', () => {
        vi.stubGlobal('localStorage', {
            getItem: () => { throw new Error('SecurityError'); },
            setItem: () => { throw new Error('QuotaExceededError'); },
            removeItem: () => { throw new Error('SecurityError'); },
        });
        expect(readPersonView(LOCAL('m1'))).toEqual({});
        expect(rememberPersonView(LOCAL('m1'), { baseLayer: 'osm' })).toBe(false);
        expect(forgetPersonView(LOCAL('m1'))).toBe(false);
        expect(() => forgetPersonViews('local-1')).not.toThrow();
    });

    it.each([
        ['JSON quebrado', '{nao e json'],
        ['versão desconhecida', JSON.stringify({ v: 99, owner: null, maps: [] })],
        ['mapas que não são lista', JSON.stringify({ v: 1, owner: null, maps: { m1: {} } })],
        ['entrada sem chave', JSON.stringify({ v: 1, owner: null, maps: [{ baseLayer: 'osm' }] })],
    ])('registro ilegível (%s) lê como ausente, e a próxima escolha o substitui', (_nome, bruto) => {
        disco.set(personViewStorageKey('local-1'), bruto);

        expect(readPersonView(LOCAL('m1'))).toEqual({});
        expect(rememberPersonView(LOCAL('m1'), { baseLayer: 'osm' })).toBe(true);
        expect(readPersonView(LOCAL('m1'))).toEqual({ baseLayer: 'osm' });
    });

    it('um campo de tipo errado DENTRO do disco não sai na leitura', () => {
        disco.set(personViewStorageKey('local-1'), JSON.stringify({
            v: 1, owner: null, maps: [{ key: 'm1', baseLayer: 7, temporalEnabled: 'sim' }],
        }));
        expect(readPersonView(LOCAL('m1'))).toEqual({});
    });
});
