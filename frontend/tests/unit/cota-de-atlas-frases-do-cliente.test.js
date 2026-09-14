// Path: tests/unit/cota-de-atlas-frases-do-cliente.test.js

/**
 * @fileoverview O QUE A TELA DIZ QUANDO O SERVIDOR RECUSA POR COTA (decisão D12 de 14/09/2026),
 * e o achado de cliente que a decisão descobriu.
 *
 * O ACHADO: de três caminhos que criam atlas de servidor, DOIS já mostravam a frase do servidor
 * (`showError(error?.message ...)`, em `_duplicate` de `atlas-drive.js` e em
 * `importProjectFromFile` de `projects-page.js`) e o de CRIAR não mostrava NADA. O `catch` que a
 * engolia está no modal e é deliberado: `CreateAtlasModal._handleCreate` captura sem relatar para
 * manter o diálogo aberto na falha. Enquanto `POST /atlas` só falhava por rede ou por sessão, isso
 * era um defeito pequeno; com a cota, o servidor passou a ter uma frase que nomeia dois números e
 * a ação que libera vaga, e ela não chegava a lugar nenhum.
 *
 * O SEGUNDO ACHADO, no caminho de ENVIAR AO SERVIDOR: ele embrulha o motivo numa moldura por
 * classe de falha, e a classe do 429 é `RATE_LIMITED`, cuja cabeça diz "o servidor pediu para
 * esperar (pedidos demais em sequência)". Para uma recusa de cota isso é falso no conselho, que é
 * a parte que a pessoa age: esperar não libera vaga nenhuma. A distinção é pelo `code`
 * (`QUOTA_EXCEEDED`), nunca pelo status, porque o status 429 é compartilhado com o limitador de
 * taxa, onde a cabeça está certa.
 *
 * O QUE ESTE ARQUIVO PRENDE, então, é a regra "a frase do servidor vence onde o servidor falou", e
 * o par que a torna verificável: a recusa de cota chega INTEIRA, e a falha de rede (onde quem
 * falou foi o navegador, dizendo `Failed to fetch`) NÃO chega.
 */

import { describe, it, expect } from 'vitest';
import { createServerAtlasFailureNotice } from '@js/projects/server-atlas-notices.js';
import { sendFailureNotice, NoticeKind } from '@js/projects/local-atlas-notices.js';

/** O envelope que `ApiError` (`@store/sync/api-client.js`) entrega ao chamador. */
function apiError(message, { status, code } = {}) {
    const err = new Error(message);
    err.status = status;
    err.code = code;
    return err;
}

const FRASE_DA_COTA = 'Você já tem 100 atlas, e o máximo por conta é 100. '
    + 'Mova algum para a lixeira antes de criar outro: o que está na lixeira não ocupa vaga.';

describe('a recusa por cota chega à tela com a frase do servidor', () => {
    it('criar: a frase do 429 passa INTEIRA, com os dois números', () => {
        const frase = createServerAtlasFailureNotice(
            apiError(FRASE_DA_COTA, { status: 429, code: 'QUOTA_EXCEEDED' }),
        );
        expect(frase).toBe(FRASE_DA_COTA);
        expect(frase).toContain('100');
        expect(frase).toMatch(/lixeira/i);
    });

    it('criar: qualquer outra recusa do servidor também passa pela frase DELE', () => {
        // A regra não é "trate a cota": é "o servidor é quem sabe". Um caso só de cota deixaria
        // passar uma implementação que casasse o código e inventasse moldura para o resto.
        const frase = createServerAtlasFailureNotice(
            apiError('Já existe um atlas com este nome.', { status: 409, code: 'CONFLICT' }),
        );
        expect(frase).toBe('Já existe um atlas com este nome.');
    });

    it('criar: sem status nenhum, quem falou foi o navegador, e a frase é NOSSA', () => {
        // O contra-exemplo da regra acima, e o que impede "a frase do servidor vence" de virar
        // "mostre o texto do erro seja ele qual for": `Failed to fetch` já chegou cru à tela deste
        // produto uma vez.
        const frase = createServerAtlasFailureNotice(new Error('Failed to fetch'));
        expect(frase).not.toContain('Failed to fetch');
        expect(frase).toMatch(/conex/i);
    });

    it('criar: nunca silenciosa, nem com entrada que não é erro nenhum', () => {
        for (const entrada of [undefined, null, {}, 'texto solto']) {
            const frase = createServerAtlasFailureNotice(entrada);
            expect(typeof frase).toBe('string');
            expect(frase.trim().length).toBeGreaterThan(0);
        }
    });

    it('enviar ao servidor: a cota NÃO é embrulhada no conselho de esperar', () => {
        const notice = sendFailureNotice(
            apiError(FRASE_DA_COTA, { status: 429, code: 'QUOTA_EXCEEDED' }),
            { name: 'Operação Serra' },
        );
        expect(notice.kind).toBe(NoticeKind.ERROR);
        expect(notice.message).toContain(FRASE_DA_COTA);
        expect(notice.message).not.toMatch(/pedidos demais/i);
    });

    it('enviar ao servidor: o 429 do LIMITADOR continua com o conselho de esperar', () => {
        // O contraste que dá sentido ao caso anterior: o mesmo status, sem o código de cota,
        // continua sendo backoff, e ali a cabeça está certa. Sem este bloco, remover a cabeça
        // inteira passaria verde.
        const notice = sendFailureNotice(
            apiError('Muitas tentativas. Tente novamente mais tarde.', { status: 429 }),
            { name: 'Operação Serra' },
        );
        expect(notice.message).toMatch(/pedidos demais/i);
    });
});
