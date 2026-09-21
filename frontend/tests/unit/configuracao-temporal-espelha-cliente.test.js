// Path: tests/unit/configuracao-temporal-espelha-cliente.test.js
//
// O DEFEITO (S6 da auditoria de 2026-09-21): o servidor gravava em `maps.temporal_config` qualquer
// coisa que o cliente mandasse, e retransmitia a todos os pares. `unidade: 'banana'`, `ativo: 'sim'`,
// `modo: {}` e uma janela terminando antes de começar entravam inteiros.
//
// A CAUSA: o contrato do módulo temporal sempre morou SÓ no cliente
// (`frontend/src/js/temporal/temporal.constants.js`). A única regra do servidor que nomeava a coluna
// (`GRID_AND_TEMPORAL`, em `backend/src/modules/sync/free-field.schemas.js`) casa as chaves
// `temporal_config`/`temporalConfig`, e o cliente nunca manda nenhuma das duas: a op `mapTemporal`
// leva os SEIS campos SOLTOS, e `normalizeMapChanges` os remonta depois. Regra que não casa com nada
// reporta sucesso sem conferir nada, que é a cobertura vazia da constituição.
//
// O CONSERTO tem duas metades, e é a segunda que este arquivo prende: o vocabulário virou um módulo
// folha do servidor (`backend/src/modules/sync/temporal-config.js`), ESPELHO deste cliente, e um
// espelho só vale enquanto alguém compara os dois lados no MESMO processo. É o molde de
// `slide-controls.js` + `controles-do-slide.test.js`.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import fc from 'fast-check';
import {
    TEMPORAL_UNIT_KEYS,
    TEMPORAL_MODES,
    DEFAULT_TEMPORAL_CONFIG,
    DEFAULT_TEMPORAL_UNIT,
} from '../../src/js/temporal/temporal.constants.js';
import {
    TEMPORAL_UNIT_KEYS as UNIDADES_DO_SERVIDOR,
    TEMPORAL_MODE_VALUES as MODOS_DO_SERVIDOR,
    DEFAULT_TEMPORAL_CONFIG as PADRAO_DO_SERVIDOR,
    TEMPORAL_CONFIG_KEYS,
    TEMPORAL_EPOCH_LIMIT_MS,
    normalizeTemporalConfig,
} from '../../../backend/src/modules/sync/temporal-config.js';

describe('o espelho entre os dois pacotes', () => {
    it('as unidades são exatamente as mesmas, na mesma ordem', () => {
        expect([...UNIDADES_DO_SERVIDOR]).toEqual([...TEMPORAL_UNIT_KEYS]);
        // Asserção ABSOLUTA ao lado da comparação: dois lados errados do mesmo jeito passariam
        // numa comparação que só olha um contra o outro.
        expect([...UNIDADES_DO_SERVIDOR]).toEqual(['MINUTO', 'HORA', 'DIA', 'SEMANA']);
    });

    it('os modos são os VALORES do enum do cliente, não as chaves dele', () => {
        expect([...MODOS_DO_SERVIDOR]).toEqual(Object.values(TEMPORAL_MODES));
        expect([...MODOS_DO_SERVIDOR]).toEqual(['absoluto', 'relativo']);
        // A distinção que morde: a chave é maiúscula (`ABSOLUTO`) e o valor é minúsculo. Guardar a
        // chave no servidor recusaria todo `modo` que o cliente de fato grava.
        expect(Object.keys(TEMPORAL_MODES)).toEqual(['ABSOLUTO', 'RELATIVO']);
    });

    it('o documento padrão é o mesmo, chave por chave e na mesma ordem', () => {
        expect(PADRAO_DO_SERVIDOR).toEqual(DEFAULT_TEMPORAL_CONFIG);
        expect(Object.keys(PADRAO_DO_SERVIDOR)).toEqual(Object.keys(DEFAULT_TEMPORAL_CONFIG));
        expect(PADRAO_DO_SERVIDOR.unidade).toBe(DEFAULT_TEMPORAL_UNIT);
        expect(TEMPORAL_CONFIG_KEYS).toEqual(['ativo', 'unidade', 'inicio', 'fim', 'modo', 'origem']);
    });

    it('o módulo do servidor tem ZERO imports, que é o que o deixa carregável aqui', () => {
        const fonte = readFileSync(
            new URL('../../../backend/src/modules/sync/temporal-config.js', import.meta.url), 'utf8',
        );
        expect(fonte).not.toMatch(/^\s*import\s/m);
        expect(fonte).not.toMatch(/\brequire\(/);
    });
});

describe('normalizeTemporalConfig: campo inválido degrada, op nunca é recusada', () => {
    it('o documento que o cliente de fato escreve atravessa intacto', () => {
        const real = { ativo: true, unidade: 'DIA', inicio: 1700000000000, fim: 1700003600000, modo: 'relativo', origem: 1700000000000 };
        expect(normalizeTemporalConfig(real)).toEqual(real);
        expect(normalizeTemporalConfig({ ...DEFAULT_TEMPORAL_CONFIG })).toEqual(DEFAULT_TEMPORAL_CONFIG);
    });

    it('unidade fora do vocabulário vira o padrão, e a comparação é EXATA', () => {
        expect(normalizeTemporalConfig({ unidade: 'banana' }).unidade).toBe('HORA');
        // Nem caixa baixa nem plural: são as formas que a e2e antiga congelava como contrato.
        expect(normalizeTemporalConfig({ unidade: 'dia' }).unidade).toBe('HORA');
        expect(normalizeTemporalConfig({ unidade: 'horas' }).unidade).toBe('HORA');
        expect(normalizeTemporalConfig({ unidade: 42 }).unidade).toBe('HORA');
        expect(normalizeTemporalConfig({ unidade: null }).unidade).toBe('HORA');
    });

    it('modo fora do vocabulário vira absoluto, objeto inclusive', () => {
        expect(normalizeTemporalConfig({ modo: 'cumulativo' }).modo).toBe('absoluto');
        expect(normalizeTemporalConfig({ modo: {} }).modo).toBe('absoluto');
        expect(normalizeTemporalConfig({ modo: 'relativo' }).modo).toBe('relativo');
    });

    it('`ativo` é booleano estrito: só `true` liga', () => {
        expect(normalizeTemporalConfig({ ativo: 'sim' }).ativo).toBe(false);
        expect(normalizeTemporalConfig({ ativo: 1 }).ativo).toBe(false);
        expect(normalizeTemporalConfig({ ativo: true }).ativo).toBe(true);
        expect(normalizeTemporalConfig({ ativo: false }).ativo).toBe(false);
    });

    it('as três datas são epoch ms ou nulo, e fora do alcance de `Date` viram nulo', () => {
        expect(normalizeTemporalConfig({ inicio: '2026-01-01' }).inicio).toBe(null);
        expect(normalizeTemporalConfig({ origem: 'manual' }).origem).toBe(null);
        expect(normalizeTemporalConfig({ inicio: 0 }).inicio).toBe(0);
        expect(normalizeTemporalConfig({ inicio: -1000 }).inicio).toBe(-1000);
        expect(normalizeTemporalConfig({ inicio: TEMPORAL_EPOCH_LIMIT_MS }).inicio).toBe(TEMPORAL_EPOCH_LIMIT_MS);
        expect(normalizeTemporalConfig({ inicio: TEMPORAL_EPOCH_LIMIT_MS + 1 }).inicio).toBe(null);
        expect(normalizeTemporalConfig({ fim: Number.NaN }).fim).toBe(null);
        expect(normalizeTemporalConfig({ fim: Infinity }).fim).toBe(null);
    });

    it('janela INVERTIDA descarta o FIM e guarda o início', () => {
        // A decisão: uma das duas pontas tem de cair, e `fim: null` significa "limite automático,
        // derivado das feições", que é a leitura mais larga e nunca esconde feição. Guardar o par
        // invertido produz janela VAZIA, com o mapa inteiro filtrado e cara de quebrado.
        expect(normalizeTemporalConfig({ inicio: 2000, fim: 1000 })).toEqual({ inicio: 2000, fim: null });
        // Iguais não é invertido: a janela degenerada é legítima e passa.
        expect(normalizeTemporalConfig({ inicio: 1000, fim: 1000 })).toEqual({ inicio: 1000, fim: 1000 });
        // O fim só cai por causa do par: sozinho ele sobrevive.
        expect(normalizeTemporalConfig({ fim: 1000 })).toEqual({ fim: 1000 });
        // E um início ilegível não pode derrubar um fim legítimo.
        expect(normalizeTemporalConfig({ inicio: 'ontem', fim: 1000 })).toEqual({ inicio: null, fim: 1000 });
    });

    it('chave fora da lista não atravessa, nem pela cadeia de protótipo', () => {
        const saida = normalizeTemporalConfig({ ativo: true, bogus: 'x', name: 'renomear', __proto__: { unidade: 'DIA' } });
        expect(Object.keys(saida)).toEqual(['ativo']);
        expect(saida.unidade).toBe(undefined);
    });

    it('chave AUSENTE continua ausente: a coluna é substituída inteira pelo que a op traz', () => {
        // Preencher o que o cliente não mencionou escreveria um padrão por cima de um valor vivo.
        expect(normalizeTemporalConfig({ ativo: true })).toEqual({ ativo: true });
        expect(normalizeTemporalConfig({})).toEqual({});
    });

    it.each([null, undefined, 'banana', 42, true, [], [1, 2]])(
        '%j vira `{}`, e nunca nulo: a coluna é NOT NULL DEFAULT \'{}\'', (bruto) => {
            expect(normalizeTemporalConfig(bruto)).toEqual({});
        },
    );

    it('PROPRIEDADE: nunca lança, e a saída é sempre um documento gravável', () => {
        fc.assert(fc.property(fc.anything(), (bruto) => {
            const saida = normalizeTemporalConfig(bruto);
            expect(saida !== null && typeof saida === 'object' && !Array.isArray(saida)).toBe(true);
            for (const [chave, valor] of Object.entries(saida)) {
                expect(TEMPORAL_CONFIG_KEYS).toContain(chave);
                if (chave === 'ativo') expect(typeof valor).toBe('boolean');
                else if (chave === 'unidade') expect(TEMPORAL_UNIT_KEYS).toContain(valor);
                else if (chave === 'modo') expect(Object.values(TEMPORAL_MODES)).toContain(valor);
                else expect(valor === null || Number.isFinite(valor)).toBe(true);
            }
            if (typeof saida.inicio === 'number' && typeof saida.fim === 'number') {
                expect(saida.fim).toBeGreaterThanOrEqual(saida.inicio);
            }
        }));
    });

    it('IDEMPOTENTE: normalizar o que já está normalizado não muda nada', () => {
        fc.assert(fc.property(fc.dictionary(fc.string(), fc.anything()), (bruto) => {
            const uma = normalizeTemporalConfig(bruto);
            expect(normalizeTemporalConfig(uma)).toEqual(uma);
        }));
    });

    it('a saída sempre serve de entrada do leitor do cliente, sem campo estranho', () => {
        // `withDefaults` (temporal.operations.js) é `{...DEFAULT, ...(raw || {})}`: o que o servidor
        // guarda entra por cima do padrão, então uma chave desconhecida ali viraria estado do mapa.
        const lido = { ...DEFAULT_TEMPORAL_CONFIG, ...normalizeTemporalConfig({ ativo: 'sim', unidade: 'banana', extra: 1 }) };
        expect(lido).toEqual({ ...DEFAULT_TEMPORAL_CONFIG, ativo: false, unidade: 'HORA' });
    });
});
