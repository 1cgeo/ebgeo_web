// Path: tests/unit/link-publico-morto-fala.test.js

/**
 * @fileoverview O LINK PÚBLICO QUE NÃO ABRE PASSA A DIZER O QUE ACONTECEU, sem virar oráculo de
 * existência.
 *
 * O defeito medido em 2026-08-23: o `catch` de `openPublicAtlasFromUrl` (`js/index.js`) era
 * `console.warn` mais `retractAtlasClaim()` mais `return false`. A cadeia de boot seguia e o
 * visitante caía num mapa local genérico, sem uma palavra, e o F5 repetia o silêncio. Isto é o
 * funil de aquisição inteiro do produto: alguém compartilha um mapa, a outra pessoa clica.
 *
 * A TENSÃO QUE ESTA SUÍTE MEDE tem dois lados que se contradizem se qualquer um for escrito
 * sozinho:
 *
 *   - dizer o BASTANTE: as faixas transitórias (rede, 5xx, 429) não podem receber a frase de
 *     link morto, senão alguém joga fora um link bom por causa de um piscar de rede;
 *   - dizer o de MENOS: link revogado, link expirado, link errado e atlas excluído são
 *     indistinguíveis DE PROPÓSITO. O servidor responde 404 para os quatro
 *     (`getAtlasByPublicLink` lança `NotFoundError`), e a cláusula 5.6 da constituição trata
 *     "não encontrado" contra "proibido" como decisão anti-enumeração. Uma frase por caso
 *     reconstruiria no cliente o canal que o servidor fecha.
 *
 * CONTROLE NEGATIVO (cada asserção foi escrita contra uma implementação errada concreta):
 *   - frase única para todas as faixas: reprova na distinção entre morto e transitório.
 *   - frase PRÓPRIA para o 403 (a tentação natural de quem classifica por status): reprova na
 *     asserção de igualdade byte a byte entre MISSING e CREDENTIAL.
 *   - frase que nomeia o desfecho ("o atlas foi excluído", "este atlas não existe"): reprova na
 *     asserção de vocabulário proibido.
 *   - `shouldForgetPublicLink` devolvendo sempre true: reprova nas quatro faixas transitórias.
 *   - `shouldForgetPublicLink` devolvendo sempre false: reprova em MISSING.
 *   - o `catch` único de volta em `index.js`: reprova na camada estrutural, que exige o ramo de
 *     falha do link falando e o ramo local NÃO falando do link.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RequestFailure } from '../../src/js/utilities/request-failure.js';
import {
    publicLinkFailureNotice,
    shouldForgetPublicLink,
} from '../../src/js/deep-link/public-link-phrases.js';

const FRONT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const INDEX = readFileSync(resolve(FRONT, 'src/js/index.js'), 'utf8');

const TRANSITORIAS = [
    RequestFailure.NETWORK,
    RequestFailure.SERVER,
    RequestFailure.RATE_LIMITED,
    RequestFailure.UNKNOWN,
];

describe('publicLinkFailureNotice: a frase por faixa', () => {
    it('toda faixa produz frase em pt-BR e tom conhecido', () => {
        for (const faixa of [...TRANSITORIAS, RequestFailure.MISSING, RequestFailure.CREDENTIAL]) {
            const notice = publicLinkFailureNotice(faixa);
            expect(typeof notice.message, faixa).toBe('string');
            expect(notice.message.length, faixa).toBeGreaterThan(20);
            expect(['warning', 'error'], faixa).toContain(notice.tone);
        }
    });

    it('a recusa do servidor é um beco sem saída, e diz para pedir outro link', () => {
        const notice = publicLinkFailureNotice(RequestFailure.MISSING);
        expect(notice.tone).toBe('error');
        expect(notice.message).toMatch(/Peça um link novo/);
        expect(notice.message).toMatch(/revogado/);
        expect(notice.message).toMatch(/expirado/);
    });

    it('nenhuma faixa transitória manda pedir outro link, e nenhuma é "error"', () => {
        // O controle negativo do lado caro: mandar pedir link novo por causa de um 503 faz a
        // pessoa jogar fora um link que funciona.
        for (const faixa of TRANSITORIAS) {
            const notice = publicLinkFailureNotice(faixa);
            expect(notice.message, faixa).not.toMatch(/Peça um link novo/);
            expect(notice.tone, faixa).toBe('warning');
        }
    });

    it('o 5xx diz explicitamente que o link pode estar correto', () => {
        expect(publicLinkFailureNotice(RequestFailure.SERVER).message)
            .toMatch(/link pode estar correto/);
    });

    it('o 429 fala de quem PEDE, não do atlas', () => {
        const message = publicLinkFailureNotice(RequestFailure.RATE_LIMITED).message;
        expect(message).toMatch(/deste computador/);
        expect(message).toMatch(/Espere um instante/);
    });

    it('a faixa desconhecida tem frase própria e NÃO declara o link morto', () => {
        const notice = publicLinkFailureNotice(RequestFailure.UNKNOWN);
        expect(notice.message).not.toBe(publicLinkFailureNotice(RequestFailure.MISSING).message);
        expect(notice.message).toMatch(/Tente novamente/);
        // Uma faixa que a função nunca viu cai no mesmo lugar, em vez de estourar.
        expect(publicLinkFailureNotice('faixa-que-nao-existe').message).toBe(notice.message);
        expect(publicLinkFailureNotice(undefined).message).toBe(notice.message);
    });

    it('as três frases transitórias distintas não são a mesma string', () => {
        const frases = [RequestFailure.NETWORK, RequestFailure.SERVER, RequestFailure.RATE_LIMITED]
            .map((faixa) => publicLinkFailureNotice(faixa).message);
        expect(new Set(frases).size).toBe(3);
    });
});

describe('anti-enumeração (cláusula 5.6): o link recusado não conta qual dos casos foi', () => {
    it('404 e 403 produzem a MESMA frase, byte a byte', () => {
        // Se o 401/403 ganhasse frase própria, quem varresse links saberia distinguir um token
        // que já existiu de um que nunca existiu — que é o oráculo que o servidor fecha ao
        // responder 404 para os dois.
        expect(publicLinkFailureNotice(RequestFailure.CREDENTIAL))
            .toEqual(publicLinkFailureNotice(RequestFailure.MISSING));
    });

    it('a frase não afirma nem existência nem inexistência do atlas', () => {
        const message = publicLinkFailureNotice(RequestFailure.MISSING).message;
        // "foi excluído" afirma que existiu; "não existe" mente no caso revogado. As duas
        // afirmam mais do que o servidor disse.
        for (const proibido of [/excluíd/i, /não existe/i, /removid/i, /privado/i, /sem acesso/i]) {
            expect(message, String(proibido)).not.toMatch(proibido);
        }
    });

    it('a frase nomeia as possibilidades sem escolher uma', () => {
        // "pode ter sido X, ter Y ou estar Z" é a forma de ser útil sem confirmar nada.
        expect(publicLinkFailureNotice(RequestFailure.MISSING).message).toMatch(/pode ter sido/);
    });
});

describe('shouldForgetPublicLink: quando o `?atlasPublico=` sai da URL', () => {
    it('sai só quando o próprio servidor recusou o link', () => {
        expect(shouldForgetPublicLink(RequestFailure.MISSING)).toBe(true);
        expect(shouldForgetPublicLink(RequestFailure.CREDENTIAL)).toBe(true);
    });

    it('fica em toda faixa transitória, porque o link pode estar bom', () => {
        // `buildAtlasSearch` preserva `atlasPublico` por contrato, e esta é a exceção estreita.
        // Alargá-la destruiria um link válido por causa de um piscar de rede, que é a mesma
        // direção de erro do defeito da credencial.
        for (const faixa of TRANSITORIAS) {
            expect(shouldForgetPublicLink(faixa), faixa).toBe(false);
        }
        expect(shouldForgetPublicLink(undefined)).toBe(false);
    });

    it('concorda com a frase: quem manda pedir outro link é quem sai da URL', () => {
        // As duas decisões saem do mesmo predicado de propósito. Separadas, uma frase de beco sem
        // saída conviveria com uma URL que o F5 volta a tentar, e o usuário leria a contradição
        // como tela quebrada.
        for (const faixa of [...TRANSITORIAS, RequestFailure.MISSING, RequestFailure.CREDENTIAL]) {
            const mandaPedirOutro = /Peça um link novo/.test(publicLinkFailureNotice(faixa).message);
            expect(shouldForgetPublicLink(faixa), faixa).toBe(mandaPedirOutro);
        }
    });
});

describe('estrutura: o ramo de falha de `index.js` deixou de ser mudo', () => {
    it('o boot consome as duas decisões deste módulo', () => {
        expect(INDEX).toMatch(/from\s+'\.\/deep-link\/public-link-phrases\.js'/);
        expect(INDEX).toMatch(/publicLinkFailureNotice\(/);
        expect(INDEX).toMatch(/shouldForgetPublicLink\(/);
    });

    it('a falha do link vira toast, e não só um `console.warn`', () => {
        // O defeito era exatamente um `console.warn` sozinho. O ramo tem de terminar em fala.
        const ramo = INDEX.slice(
            INDEX.indexOf('[boot] public atlas link refused'),
            INDEX.indexOf('async function restoreSessionFromStorage'),
        );
        expect(ramo.length).toBeGreaterThan(0);
        expect(ramo).toMatch(/showToast\(notice\.message, notice\.tone\)/);
    });

    it('o `?atlasPublico=` só é removido atrás do predicado', () => {
        expect(INDEX).toMatch(/if \(shouldForgetPublicLink\(kind\)\) forgetPublicAtlasUrl\(\)/);
        // Uma única remoção, e ela está dentro de `forgetPublicAtlasUrl`.
        const remocoes = INDEX.match(/params\.delete\('atlasPublico'\)/g) || [];
        expect(remocoes.length).toBe(1);
    });

    it('a falha LOCAL, depois de o link resolver, não fala do link', () => {
        // O link já foi aceito pelo servidor nesse ponto: culpar o link ali mandaria o visitante
        // pedir um substituto que falharia exatamente igual.
        const ramoLocal = INDEX.slice(INDEX.indexOf('[boot] public atlas open failed'));
        const frase = ramoLocal.slice(0, ramoLocal.indexOf('return false;'));
        expect(frase).toMatch(/neste computador/);
        expect(frase).not.toMatch(/Peça um link novo/);
    });
});
