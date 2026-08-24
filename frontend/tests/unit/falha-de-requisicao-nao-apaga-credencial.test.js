// Path: tests/unit/falha-de-requisicao-nao-apaga-credencial.test.js

/**
 * @fileoverview O STATUS DECIDE, NUNCA O MERO FATO DE FALHAR.
 *
 * O defeito medido em 2026-08-23: `restoreSession` em `projects/projects-page.js` e em
 * `admin/admin-page.js` era `catch { apiClient.clearTokens(); return false; }`, byte a byte a
 * mesma forma nos dois, sem classificar o erro. Um 502 do proxy, um pico de latência, um 429 ou
 * uma queda de rede deslogavam em definitivo, e o desfecho é TERMINAL: o produto não tem
 * redefinição de senha por conta própria (a única é `POST /users/:userId/reset-password`, com
 * `requireAdmin`). E este é o caminho PADRÃO: `shouldRouteToProjects` manda todo visitante com
 * sessão numa URL nua para `atlas.html`, cuja primeira ação é essa.
 *
 * A suíte tem TRÊS camadas, e nenhuma delas sozinha prenderia a propriedade:
 *
 *   1. A CLASSIFICAÇÃO, com asserção ABSOLUTA por faixa. Comparar só "não é credencial" deixaria
 *      passar um classificador que devolvesse sempre a mesma classe não-credencial, e é a classe
 *      que escolhe a frase.
 *   2. AS FRASES, exigidas DISTINTAS entre si. Uma frase por faixa que fosse a mesma string
 *      passaria em qualquer teste de presença e apagaria de novo a diferença entre "você saiu" e
 *      "não consegui perguntar quem é você".
 *   3. A ESTRUTURA: os três sítios consomem a MESMA definição, o módulo é folha, e a forma
 *      antiga (o `catch` que apaga sem classificar) não voltou. Sem esta camada, os dois pares de
 *      páginas poderiam reintroduzir a limpeza incondicional com a suíte inteira verde, porque
 *      função pura testada continua pura enquanto ninguém a chama.
 *
 * CONTROLE NEGATIVO (conferido à mão ao escrever, e a razão de cada asserção ser absoluta):
 *   - classificador que devolve sempre CREDENTIAL: reprova em rede, 500, 429 e 404.
 *   - classificador que devolve sempre NETWORK: reprova em 401 e 403.
 *   - `isCredentialFailure` de volta ao `status === 401 || status === 403` literal: continua
 *     verde, e deve mesmo — a semântica não mudou, o que mudou foi quem a consome, e é a
 *     camada 3 que prende isso.
 *   - `sessionRestoreNotice` devolvendo uma constante: reprova na asserção de distinção.
 *   - o `catch { apiClient.clearTokens(); }` reposto em qualquer das duas páginas: reprova na
 *     camada 3, nomeando o arquivo.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    RequestFailure,
    classifyRequestFailure,
    isCredentialFailure,
    requestStatus,
} from '../../src/js/utilities/request-failure.js';
import { sessionRestoreNotice } from '../../src/js/session/session-restore-phrases.js';

const FRONT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** @param {string} rel @returns {string} */
const fonte = (rel) => readFileSync(resolve(FRONT, rel), 'utf8');

/**
 * A varredura mede CÓDIGO, e a distinção não é higiene: os `fileoverview` deste lote CITAM a
 * forma antiga (`catch { apiClient.clearTokens(); }`) para dizer o que ela quebrava, e sem esta
 * limpeza a suíte reprovaria a própria documentação do conserto.
 * @param {string} texto
 * @returns {string}
 */
const semComentarios = (texto) => texto
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

/** @param {string} rel @returns {string} */
const codigo = (rel) => semComentarios(fonte(rel));

/**
 * OS SÍTIOS, DERIVADOS DO VERSIONAMENTO, e não de uma lista escrita aqui.
 *
 * Um sítio é todo arquivo de `src/js` cujo CÓDIGO chame `apiClient.clearTokens()`. Apagar a
 * credencial é o ato perigoso; quem o pratica é quem precisa ter classificado o erro antes.
 *
 * As duas bandeiras do `git ls-files` não são detalhe: `--cached` sozinho enumera só o RASTREADO,
 * e o guarda ficaria cego exatamente onde o trabalho novo aparece, que é o arquivo escrito há
 * cinco minutos e ainda não commitado.
 *
 * O PISO EXISTE PORQUE COBERTURA VAZIA PASSA VERDE: um `git` que falhe, ou um padrão que pare de
 * casar, devolveriam lista vazia e todo `for` abaixo ficaria trivialmente satisfeito.
 * @returns {string[]}
 */
function sitiosQueApagamCredencial() {
    const saida = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '*.js'],
        { cwd: resolve(FRONT, 'src/js'), encoding: 'utf8' });
    const achados = saida.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
        .map((rel) => `src/js/${rel.replace(/\\/g, '/')}`)
        .filter((rel) => /apiClient\.clearTokens\s*\(/.test(codigo(rel)))
        .sort();
    if (achados.length < 4) {
        throw new Error(
            `a varredura achou ${achados.length} sítios de clearTokens e esperava ao menos 4: `
            + 'o git falhou, ou o padrão parou de casar. Um censo vazio passa verde sem verificar nada.',
        );
    }
    return achados;
}
/** Um erro no formato do `ApiError` de `store/sync/api-client.js`. */
const apiError = (status) => Object.assign(new Error(`HTTP ${status}`), { status });

describe('requestStatus', () => {
    it('lê as duas formas de status que circulam no cliente', () => {
        expect(requestStatus({ status: 404 })).toBe(404);
        expect(requestStatus({ statusCode: 503 })).toBe(503);
    });

    it('aceita o status que chegou como string, que um `===` numérico perderia calado', () => {
        expect(requestStatus({ status: '401' })).toBe(401);
    });

    it('trata ausência de resposta como ausência de status', () => {
        expect(requestStatus(new Error('Failed to fetch'))).toBeNull();
        expect(requestStatus(undefined)).toBeNull();
        expect(requestStatus(null)).toBeNull();
        expect(requestStatus({})).toBeNull();
        // `res.status === 0` de resposta opaca é ausência de resposta, não um código.
        expect(requestStatus({ status: 0 })).toBeNull();
        expect(requestStatus({ status: NaN })).toBeNull();
        expect(requestStatus({ status: Infinity })).toBeNull();
        expect(requestStatus({ status: 'abacaxi' })).toBeNull();
    });
});

describe('classifyRequestFailure: a faixa, em asserção absoluta', () => {
    it('401 e 403 são a credencial respondendo por si mesma', () => {
        expect(classifyRequestFailure(apiError(401))).toBe(RequestFailure.CREDENTIAL);
        expect(classifyRequestFailure(apiError(403))).toBe(RequestFailure.CREDENTIAL);
    });

    it('404 e 410 são o alvo ausente, e NÃO são credencial', () => {
        expect(classifyRequestFailure(apiError(404))).toBe(RequestFailure.MISSING);
        expect(classifyRequestFailure(apiError(410))).toBe(RequestFailure.MISSING);
    });

    it('429 é o servidor dizendo "agora não"', () => {
        expect(classifyRequestFailure(apiError(429))).toBe(RequestFailure.RATE_LIMITED);
    });

    it('toda a faixa 5xx é falha do servidor, bordas incluídas', () => {
        for (const status of [500, 502, 503, 504, 599]) {
            expect(classifyRequestFailure(apiError(status))).toBe(RequestFailure.SERVER);
        }
    });

    it('sem status nenhum é rede: o `TypeError` do fetch e o `AbortError` do deadline de boot', () => {
        expect(classifyRequestFailure(new TypeError('Failed to fetch')))
            .toBe(RequestFailure.NETWORK);
        expect(classifyRequestFailure(Object.assign(new Error('aborted'), { name: 'AbortError' })))
            .toBe(RequestFailure.NETWORK);
        expect(classifyRequestFailure(undefined)).toBe(RequestFailure.NETWORK);
    });

    it('um status que ninguém previu é UNKNOWN, e não credencial', () => {
        for (const status of [400, 402, 418, 422, 451, 600]) {
            expect(classifyRequestFailure(apiError(status))).toBe(RequestFailure.UNKNOWN);
        }
    });
});

describe('isCredentialFailure: quem pode apagar a credencial', () => {
    it('só 401 e 403', () => {
        expect(isCredentialFailure(apiError(401))).toBe(true);
        expect(isCredentialFailure(apiError(403))).toBe(true);
    });

    it('nenhuma das falhas transitórias apaga token', () => {
        // A lista é o defeito inteiro: cada um destes deslogava em definitivo.
        for (const error of [
            apiError(500), apiError(502), apiError(503), apiError(429),
            apiError(404), apiError(418),
            new TypeError('Failed to fetch'),
            Object.assign(new Error('aborted'), { name: 'AbortError' }),
        ]) {
            expect(isCredentialFailure(error)).toBe(false);
        }
    });
});

describe('sessionRestoreNotice: a frase por faixa', () => {
    const FAIXAS = [
        RequestFailure.CREDENTIAL,
        RequestFailure.NETWORK,
        RequestFailure.SERVER,
        RequestFailure.RATE_LIMITED,
        RequestFailure.MISSING,
        RequestFailure.UNKNOWN,
    ];

    it('toda faixa produz uma frase em pt-BR com tom conhecido', () => {
        for (const faixa of FAIXAS) {
            const notice = sessionRestoreNotice(faixa);
            expect(typeof notice.message).toBe('string');
            expect(notice.message.length).toBeGreaterThan(20);
            expect(['warning', 'error']).toContain(notice.tone);
        }
    });

    it('só a credencial manda entrar de novo', () => {
        expect(sessionRestoreNotice(RequestFailure.CREDENTIAL).message)
            .toBe('Sua sessão terminou. Entre novamente para ver os atlas do servidor.');
        for (const faixa of [RequestFailure.NETWORK, RequestFailure.SERVER,
            RequestFailure.RATE_LIMITED, RequestFailure.MISSING, RequestFailure.UNKNOWN]) {
            expect(sessionRestoreNotice(faixa).message).not.toMatch(/Entre novamente/);
        }
    });

    it('toda faixa que NÃO é credencial afirma que a conta continua ativa', () => {
        // É a única coisa que a tela sabe e o usuário não. Sem ela, "houve uma falha" ainda deixa
        // a pessoa achando que precisa digitar a senha, que é o gesto que ela pode não conseguir.
        for (const faixa of [RequestFailure.NETWORK, RequestFailure.SERVER,
            RequestFailure.RATE_LIMITED, RequestFailure.MISSING, RequestFailure.UNKNOWN]) {
            expect(sessionRestoreNotice(faixa).message).toMatch(/Sua conta continua ativa/);
        }
    });

    it('o 429 é o único que manda ESPERAR antes de recarregar', () => {
        expect(sessionRestoreNotice(RequestFailure.RATE_LIMITED).message)
            .toMatch(/espere um instante/i);
        expect(sessionRestoreNotice(RequestFailure.NETWORK).message)
            .not.toMatch(/espere um instante/i);
    });

    it('a faixa desconhecida tem frase própria e não vira exceção nem string vazia', () => {
        const desconhecida = sessionRestoreNotice('faixa-que-nao-existe');
        expect(desconhecida.message).toBe(sessionRestoreNotice(RequestFailure.UNKNOWN).message);
        expect(desconhecida.message).not.toBe('');
    });

    it('a credencial, a rede, o servidor e o 429 dizem coisas DIFERENTES', () => {
        // O controle negativo da frase: uma constante devolvida para todas passaria em qualquer
        // asserção de presença acima, e apagaria a distinção que a suíte inteira existe para
        // preservar.
        const frases = [
            RequestFailure.CREDENTIAL,
            RequestFailure.NETWORK,
            RequestFailure.SERVER,
            RequestFailure.RATE_LIMITED,
        ].map((faixa) => sessionRestoreNotice(faixa).message);
        expect(new Set(frases).size).toBe(4);
    });
});

describe('estrutura: UMA definição, e o inventário vem do VERSIONAMENTO', () => {
    // A LISTA ESCRITA À MÃO ERA A FRESTA, e ela cobrou em 2026-08-23, no mesmo dia em que nasceu.
    // Três páginas foram corrigidas e uma QUARTA (`src/js/calibration/calibracao-page.js`) ficou
    // com o `catch` nu por semanas depois, porque ninguém a acrescentou aqui. Conferir um
    // subconjunto e tratá-lo como o conjunto é a classe mais repetida do livro-razão, e uma
    // allowlist de alvos é a forma dela que se disfarça de rigor.
    //
    // O inventário passa a ser DERIVADO: todo arquivo de `src/js` que chame `apiClient.clearTokens`
    // é um sítio, ache-o quem achar. Página nova que apague credencial entra sozinha e reprova até
    // ser corrigida, que é o oposto de escapar sozinha.
    const CONSUMIDORES = sitiosQueApagamCredencial();

    it('o módulo de classificação é FOLHA (zero imports)', () => {
        // É o que o mantém carregável por `atlas.html` e `admin.html`, que bootam sem a store:
        // qualquer import aqui é arrastado para as duas por caminho transitivo.
        expect(codigo('src/js/utilities/request-failure.js')).not.toMatch(/^\s*import\s/m);
    });

    it('os três sítios importam a definição compartilhada', () => {
        for (const rel of CONSUMIDORES) {
            expect(fonte(rel), rel).toMatch(/from\s+'@utils\/request-failure\.js'/);
        }
    });

    it('nenhum deles redeclara a própria cópia do predicado', () => {
        // A cópia local em `index.js` é de onde a definição saiu; renascer ali (ou nas páginas) é
        // como as duas metades voltam a divergir.
        for (const rel of CONSUMIDORES) {
            expect(codigo(rel), rel).not.toMatch(/function\s+isCredentialFailure\s*\(/);
            expect(codigo(rel), rel).not.toMatch(/function\s+classifyRequestFailure\s*\(/);
        }
    });

    it('nenhuma página apaga token num catch que não classificou o erro', () => {
        // A forma exata do defeito: `catch { apiClient.clearTokens(); ... }`. Um `clearTokens`
        // ainda é legítimo nas páginas, desde que precedido de uma decisão.
        const FORMA_ANTIGA = /catch\s*(?:\([^)]*\))?\s*\{\s*apiClient\.clearTokens\(\)/;
        for (const rel of CONSUMIDORES) {
            expect(codigo(rel), rel).not.toMatch(FORMA_ANTIGA);
        }
    });

    it('todo sítio só apaga token depois de classificar a faixa', () => {
        // A ASSERÇÃO MEDE A PROPRIEDADE, NÃO A ESCRITA. A primeira versão exigia uma forma
        // sintática exata (`kind === RequestFailure.CREDENTIAL) apiClient.clearTokens()`), que
        // casava as duas páginas escritas juntas e reprovava as outras duas por usarem chaves ou
        // outro nome de variável. Um guarda que cobra estilo obriga o próximo a escrever igual em
        // vez de escrever certo, e o custo aparece quando alguém o afrouxa para caber.
        //
        // O que precisa valer é: a faixa de credencial é CONSULTADA no arquivo, e nenhuma chamada
        // de `clearTokens` sobra fora de um ramo que a consultou. A forma antiga (o `catch` nu) já
        // é proibida pelo caso acima, e as duas asserções juntas fecham o cerco.
        // SÃO DUAS FORMAS SANCIONADAS, e as duas saem do MESMO módulo folha: o predicado direto
        // (`isCredentialFailure`) e a comparação com a faixa (`RequestFailure.CREDENTIAL`). O
        // `index.js` usa a primeira e as páginas usam a segunda, e nenhuma das duas é melhor: o
        // que importa é que a decisão passou pela definição única. Exigir uma só faria o guarda
        // cobrar dialeto.
        const CONSULTOU_A_FAIXA = /isCredentialFailure\s*\(|RequestFailure\.CREDENTIAL/;
        for (const rel of CONSUMIDORES) {
            const texto = codigo(rel);
            expect(texto, `${rel}: apaga credencial sem consultar a faixa`)
                .toMatch(CONSULTOU_A_FAIXA);
            const chamadas = texto.match(/apiClient\.clearTokens\s*\(/g) || [];
            expect(chamadas.length, `${rel}: mais de uma chamada exige conferência à mão`)
                .toBeLessThanOrEqual(1);
        }
    });

    it('a quarta página está no inventário, e ela é a razão de ele ser derivado', () => {
        // CONTROLE DE VÁCUO com nome próprio. `calibration/calibracao-page.js` ficou com o `catch`
        // nu depois de as outras três serem corrigidas, porque a lista era escrita à mão e ninguém
        // a acrescentou. Se ela sumir daqui, ou o arquivo deixou de apagar credencial (bom, e então
        // esta linha sai com o motivo), ou a varredura parou de achar (ruim, e é o que este caso
        // existe para dizer em voz alta).
        expect(CONSUMIDORES).toContain('src/js/calibration/calibracao-page.js');
        expect(CONSUMIDORES).toContain('src/js/index.js');
        expect(CONSUMIDORES).toContain('src/js/projects/projects-page.js');
        expect(CONSUMIDORES).toContain('src/js/admin/admin-page.js');
    });
});
