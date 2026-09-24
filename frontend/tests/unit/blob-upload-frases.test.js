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
    avisoDeFiguraRecusada,
    avisoDeFotoRecusada,
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

    it('a falta de PERMISSÃO não se lê como problema da figura', () => {
        // As duas são definitivas e é só nisso que se parecem: uma se resolve pedindo acesso, a
        // outra trocando o arquivo. Enquanto 403 caía em RECUSA, a frase mandava mexer na figura.
        const permissao = fraseDeFalhaDeBlob({ causa: CausaDeFalha.PERMISSAO });
        expect(permissao).toMatch(/permissão/i);
        expect(permissao).toMatch(/apenas para você/i);
        expect(permissao).not.toMatch(/retomado/i);
        expect(permissao).not.toBe(fraseDeFalhaDeBlob({ causa: CausaDeFalha.RECUSA }));
        // E ela também cita o servidor quando ele disse algo.
        expect(fraseDeFalhaDeBlob({ causa: CausaDeFalha.PERMISSAO, motivo: 'read-only share' }))
            .toContain('read-only share');
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
        expect(FALHA_SEM_BYTES).toMatch(/não está mais neste computador/);
        // "bytes" é vocabulário de quem escreveu o código, não de quem lê o aviso.
        expect(FALHA_SEM_BYTES).not.toMatch(/bytes/i);
    });
});

describe('a causa de um erro LANÇADO', () => {
    it('sem status é rede, e o status de recusa separa arquivo, permissão e o resto', () => {
        expect(causaDeErroLancado({ status: null, definitiva: false })).toBe(CausaDeFalha.REDE);
        expect(causaDeErroLancado({ status: 500, definitiva: false })).toBe(CausaDeFalha.REDE);
        expect(causaDeErroLancado({ status: 413, definitiva: true })).toBe(CausaDeFalha.ARQUIVO);
        expect(causaDeErroLancado({ status: 415, definitiva: true })).toBe(CausaDeFalha.ARQUIVO);
        expect(causaDeErroLancado({ status: 403, definitiva: true })).toBe(CausaDeFalha.PERMISSAO);
        expect(causaDeErroLancado({ status: 422, definitiva: true })).toBe(CausaDeFalha.RECUSA);
        expect(causaDeErroLancado({ status: 400, definitiva: true })).toBe(CausaDeFalha.RECUSA);
    });

    it('403 só é permissão quando a recusa é DEFINITIVA, que é o que a fila decide', () => {
        // `RECUSA_DEFINITIVA` (em `blob-upload-queue.js`) é quem carimba `definitiva`, e 401 não
        // está nela: sessão volta. Um 403 transitório, se algum dia houver, continua sendo rede.
        expect(causaDeErroLancado({ status: 403, definitiva: false })).toBe(CausaDeFalha.REDE);
        expect(causaDeErroLancado({ status: 401, definitiva: false })).toBe(CausaDeFalha.REDE);
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

describe('o aviso da figura recusada nomeia a figura e diz o que fazer (2026-09-23)', () => {
    it('nomeia a figura pelo nome da feição, e cai para um rótulo genérico sem ele', () => {
        const comNome = avisoDeFiguraRecusada({ nome: 'Imagem 3', causa: CausaDeFalha.RECUSA });
        expect(comNome.startsWith('A figura "Imagem 3" não foi enviada ao servidor')).toBe(true);
        for (const vazio of [null, undefined, '', '   ', 42]) {
            expect(avisoDeFiguraRecusada({ nome: vazio, causa: CausaDeFalha.RECUSA }).startsWith('Uma figura')).toBe(true);
        }
    });

    it('cada causa diz uma ação diferente, e nenhuma cita código HTTP', () => {
        const frases = [
            avisoDeFiguraRecusada({ causa: CausaDeFalha.ARQUIVO, status: 413 }),
            avisoDeFiguraRecusada({ causa: CausaDeFalha.ARQUIVO, status: 415 }),
            avisoDeFiguraRecusada({ causa: CausaDeFalha.PERMISSAO, status: 403 }),
            avisoDeFiguraRecusada({ causa: CausaDeFalha.SEM_BYTES }),
            avisoDeFiguraRecusada({ causa: CausaDeFalha.RECUSA }),
            avisoDeFiguraRecusada({}),
        ];
        expect(frases[0]).toContain('versão menor');
        expect(frases[1]).toContain('outro formato');
        expect(frases[2]).toContain('gestor');
        expect(frases[3]).toContain('de novo');
        expect(frases[4]).toContain('pendências');
        expect(frases[5]).toContain('pendências');
        for (const f of frases) {
            expect(f).toContain('aparece só para você');
            expect(f).not.toMatch(/\b\d{3}\b/);
        }
    });
});

describe('avisoDeFotoRecusada: a FOTO recusada, pelo nome, com o desfecho do tipo dela', () => {
    it('nomeia a foto, e sem nome diz "Uma foto anexa"', () => {
        expect(avisoDeFotoRecusada({ nome: 'ponte.jpg', causa: CausaDeFalha.RECUSA }))
            .toBe('A foto "ponte.jpg" não foi enviada ao servidor, e os colegas veem só a miniatura. Ela está nas pendências para revisão.');
        for (const vazio of [null, undefined, '', '   ', 42]) {
            expect(avisoDeFotoRecusada({ nome: vazio, causa: CausaDeFalha.RECUSA }).startsWith('Uma foto anexa não foi enviada')).toBe(true);
        }
    });

    it('cada causa de uma foto ANEXADA diz uma ação, e nenhuma fala de figura nem cita código HTTP', () => {
        const frases = [
            avisoDeFotoRecusada({ nome: 'a.jpg', causa: CausaDeFalha.ARQUIVO, status: 413 }),
            avisoDeFotoRecusada({ nome: 'a.jpg', causa: CausaDeFalha.ARQUIVO, status: 415 }),
            avisoDeFotoRecusada({ nome: 'a.jpg', causa: CausaDeFalha.PERMISSAO, status: 403 }),
            avisoDeFotoRecusada({ nome: 'a.jpg', causa: CausaDeFalha.SEM_BYTES }),
            avisoDeFotoRecusada({ nome: 'a.jpg' }),
        ];
        expect(frases[0]).toContain('Anexe uma versão menor.');
        expect(frases[1]).toContain('Anexe a foto em JPEG ou PNG.');
        expect(frases[2]).toBe('A foto "a.jpg" não foi enviada ao servidor: seu acesso a este atlas não permite enviar fotos. Peça ao gestor do atlas.');
        expect(frases[3]).toContain('anexe a foto de novo');
        expect(frases[4]).toContain('pendências');
        expect(new Set(frases).size).toBe(frases.length);
        for (const frase of frases) {
            expect(frase).not.toMatch(/figura|\b[1-5]\d\d\b/);
            expect(frase.endsWith('.')).toBe(true);
        }
    });

    it('a foto CONVERTIDA por uma edição não manda anexar nada: a edição que a levava está nas pendências', () => {
        for (const causa of [CausaDeFalha.ARQUIVO, CausaDeFalha.RECUSA, CausaDeFalha.SEM_BYTES, undefined]) {
            expect(avisoDeFotoRecusada({ nome: 'antiga.jpg', causa, convertida: true }))
                .toBe('A foto "antiga.jpg" não foi enviada ao servidor, e a edição que a levava ficou nas pendências. Abra as pendências para decidir.');
        }
        // Sem permissão a saída é a mesma para as duas: pedir ao gestor.
        expect(avisoDeFotoRecusada({ nome: 'antiga.jpg', causa: CausaDeFalha.PERMISSAO, convertida: true })).toContain('Peça ao gestor do atlas.');
    });
});
