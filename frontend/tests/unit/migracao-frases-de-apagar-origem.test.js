// Path: tests/unit/migracao-frases-de-apagar-origem.test.js

/**
 * @fileoverview As frases da tela de recuperação, que desde 2026-09-22 tem DUAS saídas.
 *
 * O ARQUIVO MANTEVE O NOME e trocou de assunto junto com a tela. Ele nasceu para o único ato
 * destrutivo da decisão D8 ("apagar a cópia antiga da versão anterior"); a decisão do dono de
 * 2026-09-22 transformou aquele ato no "Continuar", que apaga o acervo INTEIRO desta origem, e
 * tirou da tela os outros cinco comandos. O que se mede aqui continua sendo o mesmo: a contagem
 * que a confirmação diz, o plural, e a leitura de tabela por chave vinda de fora.
 *
 * O módulo é folha e sem imports, então isto roda em node puro. O comportamento da TELA (que os
 * dois comandos são dois, e em que ordem) mora em
 * `tests/integration/tela-de-recuperacao-duas-saidas.test.js`, que monta o DOM.
 */

import { describe, it, expect } from 'vitest';
import {
    BAIXAR_LABEL, CONTINUAR_CANCELAR_LABEL, CONTINUAR_CONFIRMAR_LABEL, CONTINUAR_LABEL, SAIDAS,
    alteracoesGuardadasEm, apagarBloqueado, apagarConcluido, apagarConfirmacao, baixarFalhou,
    baixouComoCopiaBruta, baixouComoEbgeo, causaDaFalha, motivoSemEbgeo
} from '@js/ui/migration-recovery-phrases.js';

/**
 * Todo `code` que chega à tela hoje: os onze de `MigrationRecoveryError`, o `quota` que a tela
 * deriva do nome do erro e o `api_unavailable` que a tela de servidor fora do ar usa.
 *
 * ESCRITA POR EXTENSO, e não derivada do módulo: uma lista derivada da própria tabela passaria
 * verde com a tabela vazia, que é exatamente a cobertura vazia que a constituição proíbe.
 */
const CODIGOS = Object.freeze([
    'legacy_tab', 'legacy_changes', 'source_changed', 'copy_failed', 'lock_unavailable',
    'migration_failed', 'unknown_version', 'unsupported_version', 'unreadable',
    'ambiguous_registry', 'drop_blocked', 'quota', 'api_unavailable'
]);

describe('cada causa tem a sua frase', () => {
    it('os treze códigos têm frase própria, e nenhuma delas se repete', () => {
        const frases = CODIGOS.map(causaDaFalha);
        for (const frase of frases) {
            expect(typeof frase).toBe('string');
            expect(frase.length).toBeGreaterThan(30);
        }
        expect(new Set(frases).size).toBe(CODIGOS.length);
    });

    it('a causa em que a pessoa não precisa apagar nada diz o que ela pode fazer', () => {
        expect(causaDaFalha('legacy_tab')).toContain('Feche a outra janela');
        // A frase dizia "nada precisa ser apagado" logo antes de SAIDAS oferecer apagar tudo, e se
        // contradizia na mesma tela. Desde 2026-09-23 a janela antiga é ESPERA, sem esta tela; se
        // o código ainda chegar aqui, a frase não pode desmentir o comando ao lado.
        expect(causaDaFalha('legacy_tab')).not.toContain('nada precisa ser apagado');
        expect(causaDaFalha('drop_blocked')).toContain('Outra janela');
        expect(causaDaFalha('quota')).toContain('espaço');
    });

    it('código desconhecido não deixa a tela muda, e a tabela não entrega herdado', () => {
        const generica = causaDaFalha('inventado');
        expect(generica).toContain('Não foi possível abrir o acervo');
        expect(causaDaFalha('toString')).toBe(generica);
        expect(causaDaFalha('constructor')).toBe(generica);
        expect(causaDaFalha(undefined)).toBe(generica);
    });

    it('a frase das saídas nomeia as duas, e nenhuma outra', () => {
        expect(SAIDAS).toContain('baixar');
        expect(SAIDAS).toContain('apaga os dados deste computador');
        // O que a reversão desta decisão devolveria: os comandos que saíram.
        expect(SAIDAS).not.toContain('Tentar novamente');
        expect(SAIDAS).not.toContain('restaurar');
    });

    it('os rótulos dos quatro comandos são distintos e dizem o que fazem', () => {
        const rotulos = [BAIXAR_LABEL, CONTINUAR_LABEL, CONTINUAR_CONFIRMAR_LABEL, CONTINUAR_CANCELAR_LABEL];
        expect(new Set(rotulos).size).toBe(4);
        expect(BAIXAR_LABEL).toContain('Baixar');
        expect(CONTINUAR_CONFIRMAR_LABEL).toContain('Apagar');
        expect(CONTINUAR_CANCELAR_LABEL).toContain('Manter');
    });
});

describe('a confirmação de apagar nomeia o tamanho', () => {
    it('diz o número, o plural e que não há como desfazer', () => {
        expect(apagarConfirmacao({ registros: 198, atlas: 2 })).toContain('198 registros');
        expect(apagarConfirmacao({ registros: 198, atlas: 2 })).toContain('2 atlas');
        expect(apagarConfirmacao({ registros: 198, atlas: 2 })).toContain('não há como desfazer');
        expect(apagarConfirmacao({ registros: 1, atlas: 1 })).toContain('1 registro,');
        expect(apagarConfirmacao({ registros: 1, atlas: 1 })).not.toContain('1 registros');
        expect(apagarConfirmacao({ registros: 5, atlas: 1 })).toContain('1 atlas');
    });

    it('zero registro é frase própria, não "0 registros"', () => {
        const frase = apagarConfirmacao({ registros: 0, atlas: 0 });
        expect(frase).not.toContain('0 registros');
        expect(frase).toContain('Não há registros');
    });

    it('contagem que não é número não vira texto de contagem', () => {
        for (const invalida of [null, undefined, NaN, Infinity, -3]) {
            const frase = apagarConfirmacao({ registros: invalida, atlas: invalida });
            expect(frase).not.toMatch(/null|undefined|NaN|Infinity|-3/);
            expect(frase).toContain('não há como desfazer');
        }
        expect(apagarConfirmacao()).toContain('não há como desfazer');
    });

    it('o aviso do fim repete o MESMO número que a confirmação disse', () => {
        expect(apagarConcluido({ registros: 198 })).toContain('198 registros');
        expect(apagarConcluido({ registros: 1 })).toContain('1 registro');
        expect(apagarConcluido({ registros: 0 })).not.toContain('0 registros');
        expect(apagarConcluido()).toContain('saíram deste computador');
    });

    it('a recusa por outra janela diz que NADA foi apagado e nomeia a saída', () => {
        expect(apagarBloqueado(3)).toContain('3 bancos de dados');
        expect(apagarBloqueado(1)).toContain('1 banco de dados');
        expect(apagarBloqueado(1)).not.toContain('1 bancos');
        for (const bloqueados of [3, 1, 0, null, NaN]) {
            const frase = apagarBloqueado(bloqueados);
            expect(frase).toContain('nada foi apagado');
            expect(frase).toContain('Feche as outras janelas');
            expect(frase).not.toMatch(/null|undefined|NaN/);
        }
    });
});

describe('o download diz QUAL arquivo entregou', () => {
    it('o `.ebgeo` diz que a própria pessoa reabre', () => {
        const frase = baixouComoEbgeo('ebgeo-2026-09-22.ebgeo');
        expect(frase).toContain('ebgeo-2026-09-22.ebgeo');
        expect(frase).toContain('Importar atlas');
    });

    it('a cópia bruta diz o motivo do outro não ter dado, e que ela NÃO é auto-serviço', () => {
        const frase = baixouComoCopiaBruta('ebgeo-recuperacao-2026-09-22.zip', 'varios_acervos');
        expect(frase).toContain('ebgeo-recuperacao-2026-09-22.zip');
        expect(frase).toContain('mais de um atlas');
        expect(frase).toContain('equipe do EBGeo');
    });

    it('cada motivo é uma oração própria, e o desconhecido cai na genérica', () => {
        expect(motivoSemEbgeo('varios_acervos')).not.toBe(motivoSemEbgeo('sem_acervo'));
        expect(motivoSemEbgeo('inventado')).toBe(motivoSemEbgeo('leitura_falhou'));
        expect(motivoSemEbgeo('toString')).toBe(motivoSemEbgeo('leitura_falhou'));
    });

    it('quando nenhum dos dois sai, a frase carrega a mensagem para a pessoa repassar', () => {
        expect(baixarFalhou('QuotaExceededError')).toContain('QuotaExceededError');
    });
});

describe('o resgate automático fala, e nomeia o atlas', () => {
    it('a frase carrega o nome do atlas criado e onde procurá-lo', () => {
        const frase = alteracoesGuardadasEm('Recuperado — alterações da versão antiga');
        expect(frase).toContain('Recuperado — alterações da versão antiga');
        expect(frase).toContain('Seus atlas');
    });

    it('no mapa, que abre o atlas desde 2026-09-23, a frase diz que ele está aberto', () => {
        const frase = alteracoesGuardadasEm('Recuperado — alterações da versão antiga', { aberto: true });
        expect(frase).toContain('Recuperado — alterações da versão antiga');
        expect(frase).toContain('aberto agora');
        expect(frase).not.toContain('Seus atlas');
    });
});
