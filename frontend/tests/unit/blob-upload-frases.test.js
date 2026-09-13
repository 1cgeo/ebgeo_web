// Path: tests/unit/blob-upload-frases.test.js
//
// A FRASE DE UMA FIGURA QUE NÃO SUBIU, que é a metade decidível em node do achado A3: o painel de
// pendências mostrava `Failed to fetch`, cru e em inglês, como motivo de uma figura pendente numa
// tela inteiramente em pt-BR.
//
// O QUE ESTE VERDE PROVA: que cada causa vira uma frase em pt-BR, que a recusa do SERVIDOR carrega
// o motivo dele (é a única coisa que diz à pessoa o que mudar na figura) e que a falha de REDE não
// carrega, porque ali a mensagem é do transporte e repeti-la só move o mesmo enigma uma linha
// abaixo. O que ele NÃO prova é que a fila escolheu a causa certa: isso é de
// `tests/integration/blob-upload-queue.test.js`, que exercita as três produtoras de veredicto.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
    CausaDeFalha,
    FALHA_SEM_BYTES,
    causaDeErroLancado,
    fraseDeFalhaDeBlob,
    mensagemCrua,
} from '@store/sync/blob-upload-phrases.js';

const ARQUIVO = fileURLToPath(
    new URL('../../src/js/store/sync/blob-upload-phrases.js', import.meta.url),
);

/** A mensagem que o navegador escreve e que a tela mostrava. */
const CRUA = 'Failed to fetch';

describe('a causa vira frase em pt-BR', () => {
    it('CONTROLE DE VÁCUO: toda causa tem frase, e nenhuma sai vazia ou sem ponto final', () => {
        // Sem este caso, uma causa nova cairia no ramo padrão sem nada ficar vermelho, e o padrão
        // fala de rede: uma recusa definitiva prometeria retomada sozinha.
        for (const causa of Object.values(CausaDeFalha)) {
            const frase = fraseDeFalhaDeBlob({ causa });
            expect(frase, causa).toBeTruthy();
            expect(frase.endsWith('.'), causa).toBe(true);
        }
    });

    it('falha de REDE não repete a mensagem do transporte, e diz o que acontece a seguir', () => {
        const frase = fraseDeFalhaDeBlob({ causa: CausaDeFalha.REDE, motivo: CRUA });
        expect(frase).not.toContain(CRUA);
        expect(frase).toMatch(/retomado sozinho/i);
        expect(frase).toMatch(/conexão/i);
    });

    it('silêncio sobre um id é transitório, e não se lê como recusa', () => {
        const frase = fraseDeFalhaDeBlob({ causa: CausaDeFalha.SEM_RESPOSTA });
        expect(frase).toMatch(/não respondeu/i);
        expect(frase).not.toMatch(/recusou/i);
        expect(frase).toMatch(/retomado/i);
    });

    it('a RECUSA do servidor carrega o motivo DELE, que é o que diz o que mudar', () => {
        const frase = fraseDeFalhaDeBlob({
            causa: CausaDeFalha.RECUSA, motivo: 'Invalid file type: image/gif',
        });
        expect(frase).toContain('Invalid file type: image/gif');
        expect(frase).toMatch(/reenviar não muda/i);
        // E a figura não some: dizer só "recusada" deixaria a pessoa sem saber onde ela está.
        expect(frase).toMatch(/continua neste computador/i);
    });

    it('recusa SEM motivo declarado não deixa aspas vazias na tela', () => {
        for (const motivo of [null, undefined, '', '   ']) {
            const frase = fraseDeFalhaDeBlob({ causa: CausaDeFalha.RECUSA, motivo });
            expect(frase, String(motivo)).not.toContain('«');
            expect(frase, String(motivo)).not.toMatch(/O servidor disse/);
        }
    });

    it('o problema do ARQUIVO distingue tamanho de formato', () => {
        const grande = fraseDeFalhaDeBlob({ causa: CausaDeFalha.ARQUIVO, status: 413 });
        const formato = fraseDeFalhaDeBlob({ causa: CausaDeFalha.ARQUIVO, status: 415 });
        expect(grande).toMatch(/grande demais/i);
        expect(formato).toMatch(/formato/i);
        expect(grande).not.toBe(formato);
        // Sem status (recusa local, antes de a rede ser tocada) cai no formato, que é o caso que
        // `buildImageUploads` de fato pega.
        expect(fraseDeFalhaDeBlob({ causa: CausaDeFalha.ARQUIVO })).toBe(formato);
    });

    it('sem bytes é a única frase que também se escreve fora daqui, e é a mesma', () => {
        expect(fraseDeFalhaDeBlob({ causa: CausaDeFalha.SEM_BYTES })).toBe(FALHA_SEM_BYTES);
        expect(FALHA_SEM_BYTES).toMatch(/não estão mais neste computador/);
    });
});

describe('a causa de um erro LANÇADO', () => {
    it('sem status é rede, e status de recusa separa arquivo de política', () => {
        expect(causaDeErroLancado({ status: null, definitiva: false })).toBe(CausaDeFalha.REDE);
        expect(causaDeErroLancado({ status: 500, definitiva: false })).toBe(CausaDeFalha.REDE);
        expect(causaDeErroLancado({ status: 413, definitiva: true })).toBe(CausaDeFalha.ARQUIVO);
        expect(causaDeErroLancado({ status: 415, definitiva: true })).toBe(CausaDeFalha.ARQUIVO);
        expect(causaDeErroLancado({ status: 403, definitiva: true })).toBe(CausaDeFalha.RECUSA);
        expect(causaDeErroLancado({ status: 422, definitiva: true })).toBe(CausaDeFalha.RECUSA);
    });
});

describe('a mensagem crua é guardada, nunca desenhada', () => {
    it('apara o que dá para aproveitar e devolve nulo para o resto', () => {
        expect(mensagemCrua('  Failed to fetch  ')).toBe(CRUA);
        expect(mensagemCrua('')).toBeNull();
        expect(mensagemCrua('   ')).toBeNull();
        expect(mensagemCrua(undefined)).toBeNull();
        expect(mensagemCrua(null)).toBeNull();
        expect(mensagemCrua(42)).toBeNull();
        expect(mensagemCrua({ message: CRUA })).toBeNull();
    });
});

describe('a propriedade estrutural que a função pura não prova', () => {
    it('o módulo é FOLHA: zero imports, porque a fila é alcançada pelo despachante', () => {
        expect(/^\s*import\s/m.test(readFileSync(ARQUIVO, 'utf8'))).toBe(false);
    });
});
