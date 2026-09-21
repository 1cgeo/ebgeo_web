// Path: tests/unit/recusa-de-mapa-inexistente-fala.test.js
//
// A FRASE DE `map_missing`, E O SEGUNDO VOCABULÁRIO QUE ELA REVELOU (D2, 2026-09-21).
//
// ================= POR QUE UMA FRASE, E NÃO SÓ A RECUSA =====================
//
// `mapa-inexistente.js` recusa a escrita de gesto num mapa que o atlas não tem mais (um par o
// apagou, ou o nome corrente desta aba ficou para trás de um rename remoto). Recusar em SILÊNCIO
// seria o defeito com outro nome: antes, o gesto era aceito e jogado fora sem aviso; depois, seria
// recusado e jogado fora sem aviso. A pessoa continuaria desenhando numa tela que não guarda nada.
//
// ================= O QUE ESTE ARQUIVO PRENDE ================================
//
// Não a redação, e sim três propriedades:
//
//   1. `map_missing` tem frase PRÓPRIA, que nomeia o estado e diz a saída (a pessoa não pode fazer
//      nada sobre a causa, então a frase tem de apontar o próximo passo);
//   2. OS DOIS VOCABULÁRIOS NÃO SE MISTURAM. O `reason` de `STORE_OPERATION_BLOCKED` carrega ora
//      uma CAPACIDADE (`canEdit`, vinda de `checkPermission().required`), ora um ESTADO
//      (`map_locked`, `map_missing`). `stateDenialNotice` responde `null` para capacidade, e é
//      esse `null` que faz o listener cair em `denialNotice`. Uma tabela só faria
//      `denialNotice('map_missing')` responder a frase genérica de PAPEL, que manda a pessoa pedir
//      um nível que ela já tem;
//   3. a frase CHEGA À TELA pelo listener global, e ela não é engolida pelo debounce de uma recusa
//      de outra espécie que tenha acontecido no mesmo instante.
//
// A propriedade 3 é a que o teste de tabela sozinho não daria: até esta data o listener tinha um
// balde de debounce por ESPÉCIE (`lock`/`denied`/`explicit`), de modo que duas recusas de estado
// diferentes dentro de 3 s mostravam só a primeira. Com `map_missing` isso deixaria a pessoa com
// "Mapa bloqueado" na tela enquanto o problema era outro.

import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';

// `session-context.js` importa `getClientId` daqui, e o módulo real arrasta o namespace de atlas
// inteiro. O dublê é o mesmo que os outros repros de recusa usam.
vi.mock('../../src/js/store/sync/operation-factory.js', () => ({
    getClientId: vi.fn(() => 'mock-client-id-123')
}));

const toasts = vi.hoisted(() => ({ mostrados: [] }));

vi.mock('../../src/js/utilities/toast_service.js', () => ({
    showInChannel: (canal, texto, tom, opts) => {
        toasts.mostrados.push({ canal, texto, tom, opts });
    }
}));

vi.mock('../../src/js/presence/presence-store.js', () => ({
    presenceStore: { getUsers: () => [] }
}));

import {
    denialNotice,
    phrasedCapabilities,
    phrasedStates,
    stateDenialNotice,
    UNKNOWN_DENIAL_TEXT
} from '../../src/js/store/denial-phrases.js';
import { MAP_MISSING_REASON } from '../../src/js/store/mapa-inexistente.js';
import { PermissionAction, sessionContext, UserRole } from '../../src/js/store/sync/session-context.js';
import { registerStoreErrorListeners } from '../../src/js/store/store-error-listener.js';
import { StoreErrorEvents } from '../../src/js/store/store-errors.js';

// ============================================================================
// 1. A tabela de ESTADO
// ============================================================================

describe('stateDenialNotice', () => {
    it('`map_missing` nomeia o estado E a saída', () => {
        const frase = stateDenialNotice(MAP_MISSING_REASON);

        expect(frase).toBe('Este mapa não existe mais neste atlas. Escolha outro mapa na aba Mapas.');
        // A SAÍDA é a metade que uma redação descuidada perde: sem ela a pessoa fica sabendo que
        // falhou e não o que fazer a seguir, que é o mesmo que não avisar.
        expect(frase).toMatch(/Escolha outro mapa/);
        // pt-BR de tela: acento correto, ponto final, nada do jargão do guarda.
        expect(frase).toMatch(/não/);
        expect(frase).toMatch(/\.$/);
        expect(frase).not.toMatch(/map_missing|null|undefined|map\b/);
    });

    it('o MOTIVO vem do código, e não de um literal repetido aqui', () => {
        // Sem esta ligação, renomear a constante deixaria a frase apontando para um `reason` que
        // ninguém emite mais, e este arquivo seguiria verde sobre uma tabela morta.
        expect(MAP_MISSING_REASON).toBe('map_missing');
        expect(phrasedStates()).toContain(MAP_MISSING_REASON);
    });

    it('as duas travas continuam com a frase de sempre', () => {
        const trava = 'Mapa bloqueado. Desbloqueie para editar.';
        expect(stateDenialNotice('map_locked')).toBe(trava);
        // `target_map_locked` é a MESMA trava vista do outro lado de uma transferência: duas
        // redações fariam a mesma condição se anunciar de dois jeitos conforme o caminho.
        expect(stateDenialNotice('target_map_locked')).toBe(trava);
    });

    it('toda frase de estado é pt-BR de tela e termina em ponto', () => {
        for (const estado of phrasedStates()) {
            const frase = stateDenialNotice(estado);
            expect(typeof frase, estado).toBe('string');
            expect(frase, estado).toMatch(/\.$/);
            expect(frase, estado).not.toMatch(/can[A-Z]|GuardAction|PermissionAction|_/);
        }
    });

    it('entrada desconhecida, ausente, de outro tipo ou HERDADA devolve null sem lançar', () => {
        // O `null` é o contrato: é por ele que o listener sabe que deve perguntar à tabela de
        // CAPACIDADE. E `Object.hasOwn` é obrigatório porque `reason` vem do payload de mais de
        // vinte sítios de emissão: com `??`, `'toString'` devolveria uma FUNÇÃO.
        const entradas = [undefined, null, '', 0, 42, {}, [], true, 'map_deleted',
            'toString', 'constructor', 'valueOf', 'hasOwnProperty', '__proto__'];
        for (const entrada of entradas) {
            expect(stateDenialNotice(entrada), String(entrada)).toBeNull();
        }
    });
});

// ============================================================================
// 2. Os dois vocabulários não se encostam
// ============================================================================

describe('capacidade e estado são tabelas separadas, e continuam disjuntas', () => {
    it('nenhuma capacidade do guarda tem frase de ESTADO', () => {
        const confundidas = Object.values(PermissionAction)
            .filter((cap) => stateDenialNotice(cap) !== null);
        expect(confundidas, `capacidades respondidas como estado: ${confundidas.join(', ')}`).toEqual([]);
    });

    it('nenhum estado tem frase própria de CAPACIDADE (cairia no genérico de papel)', () => {
        // Este é o caso que explica por que a tabela não pode ser uma só: pelo caminho de
        // capacidade, `map_missing` viraria "Seu nível neste atlas não permite esta ação.", que é
        // falso e manda a pessoa pedir um nível.
        for (const estado of phrasedStates()) {
            expect(denialNotice(estado), estado).toBe(UNKNOWN_DENIAL_TEXT);
        }
    });

    it('CONTROLE DE VÁCUO: as duas tabelas têm conteúdo, e nenhuma chave em comum', () => {
        // Sem isto, os dois casos acima passariam verdes com uma das tabelas VAZIA.
        expect(phrasedStates().length).toBeGreaterThanOrEqual(3);
        expect(phrasedCapabilities().length).toBeGreaterThanOrEqual(6);
        const comuns = phrasedStates().filter((e) => phrasedCapabilities().includes(e));
        expect(comuns).toEqual([]);
    });
});

// ============================================================================
// 3. A frase CHEGA À TELA
// ============================================================================

// O listener faz debounce de 3 s num estado de módulo que sobrevive entre casos. O relógio anda
// 60 s a cada caso para que nenhum toast seja engolido por engano.
const relogioReal = Date.now;
let relogio = relogioReal();
vi.spyOn(Date, 'now').mockImplementation(() => relogio);
afterAll(() => { Date.now = relogioReal; });

/** Barramento mínimo: o ouvinte só usa `on`, e os casos emitem à mão. */
function criarBarramento() {
    const handlers = new Map();
    return {
        on(tipo, fn) { handlers.set(tipo, fn); },
        emit(tipo, payload) { handlers.get(tipo)?.(payload); }
    };
}

let barramento;

beforeEach(() => {
    relogio += 60_000;
    toasts.mostrados = [];
    // Papel RESOLVIDO: sem isto o ramo `denied` cala pela janela de hidratação e o controle de
    // discriminação abaixo mediria o silêncio errado.
    sessionContext.setSession({ userId: 'u-editor', role: UserRole.EDITOR });
    barramento = criarBarramento();
    registerStoreErrorListeners(barramento);
});

describe('a recusa de mapa inexistente chega ao usuário', () => {
    it('um `addFeature` recusado por `map_missing` mostra a frase do ESTADO', () => {
        barramento.emit(StoreErrorEvents.STORE_OPERATION_BLOCKED, {
            operation: 'addFeature', reason: MAP_MISSING_REASON, mapName: 'Mapa que sumiu'
        });

        expect(toasts.mostrados).toHaveLength(1);
        expect(toasts.mostrados[0].texto).toBe(stateDenialNotice(MAP_MISSING_REASON));
        expect(toasts.mostrados[0].tom).toBe('warning');
    });

    it('O NOME DO MAPA NÃO VAZA PARA A TELA', () => {
        // O payload carrega `mapName` para o diagnóstico; a frase é a mesma para todo mapa. Um
        // texto interpolado com nome de usuário seria dado de usuário numa via que não escapa nada.
        barramento.emit(StoreErrorEvents.STORE_OPERATION_BLOCKED, {
            operation: 'addFeature', reason: MAP_MISSING_REASON, mapName: '<img onerror=x>'
        });

        expect(toasts.mostrados[0].texto).not.toMatch(/img|onerror/);
    });

    it('a trava e o mapa inexistente NÃO se engolem no debounce', () => {
        // A propriedade que o balde por espécie não dava: dentro da mesma janela de 3 s as duas
        // recusas são de ESTADO, e com um balde só a segunda sumia deixando na tela a frase errada.
        barramento.emit(StoreErrorEvents.STORE_OPERATION_BLOCKED, {
            operation: 'addFeature', reason: 'map_locked'
        });
        barramento.emit(StoreErrorEvents.STORE_OPERATION_BLOCKED, {
            operation: 'addFeature', reason: MAP_MISSING_REASON
        });

        expect(toasts.mostrados.map((t) => t.texto)).toEqual([
            stateDenialNotice('map_locked'),
            stateDenialNotice(MAP_MISSING_REASON)
        ]);
    });

    it('DISCRIMINAÇÃO: o debounce continua valendo para a MESMA recusa repetida', () => {
        // Sem esta metade, "não se engolem" poderia ter sido implementado como "não há debounce",
        // e uma rajada de gestos recusados viraria uma pilha de toasts iguais.
        for (let i = 0; i < 5; i++) {
            barramento.emit(StoreErrorEvents.STORE_OPERATION_BLOCKED, {
                operation: 'addFeature', reason: MAP_MISSING_REASON
            });
        }

        expect(toasts.mostrados).toHaveLength(1);
    });

    it('DISCRIMINAÇÃO: a recusa por PAPEL continua sendo respondida pela capacidade', () => {
        // O caminho que o `null` de `stateDenialNotice` preserva.
        barramento.emit(StoreErrorEvents.STORE_OPERATION_BLOCKED, {
            operation: 'removeMap', reason: 'x', required: PermissionAction.DELETE_MAP
        });

        expect(toasts.mostrados).toHaveLength(1);
        expect(toasts.mostrados[0].texto).toBe(denialNotice(PermissionAction.DELETE_MAP));
    });

    it('uma recusa com MENSAGEM PRÓPRIA continua vencendo as duas tabelas', () => {
        barramento.emit(StoreErrorEvents.STORE_OPERATION_BLOCKED, {
            operation: 'x', reason: MAP_MISSING_REASON, message: 'Texto exclusivo desta recusa.'
        });

        expect(toasts.mostrados[0].texto).toBe('Texto exclusivo desta recusa.');
    });
});
