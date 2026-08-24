// Path: tests/unit/fim-de-sessao-resgata-censo.test.js
//
// TODA PÁGINA QUE ENCERRA SESSÃO RESGATA O TRABALHO NÃO ENVIADO ANTES.
//
// A regra nasceu em 2026-08-23 e foi aplicada a TRÊS páginas. A quarta
// (`calibration/calibracao-page.js`) ficou com o `endSession` cru por um mês, e ninguém
// percebeu, porque a lista de alvos era o que alguém tinha lembrado de escrever. É a mesma
// fresta que o censo da credencial fechou no mesmo dia, e pela mesma razão: conferir um
// subconjunto e tratá-lo como o conjunto é a classe mais repetida do livro-razão.
//
// A consequência do buraco não é cosmética: sem o resgate, a fila pendente daquele atlas é
// destruída pela varredura de deslogado do boot seguinte, que apaga o namespace inteiro com
// ela dentro. Trabalho que o usuário fez e não voltou.
//
// ================= O QUE ESTE ARQUIVO PRENDE, E O QUE NÃO ====================
//
// Ele varre `src/js` inteiro por `git ls-files` procurando quem CHAMA `apiClient.logout()`,
// que é o ato de encerrar a sessão, e exige que o mesmo arquivo resgate antes. É varredura
// de texto: mede presença e ORDEM, nunca semântica. Um resgate cujo resultado seja jogado
// fora passa verde aqui.
//
// O `account.control.js` do MAPA está na lista e resgata por outro nome
// (`shouldPreserveLocalWork` + `preserveUnsyncedWorkAsLocal`, o par que ele re-exporta),
// então a asserção aceita qualquer um dos símbolos do módulo de saída.

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const FRONT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** O código de um arquivo de `src/js`, sem comentário de linha nem de bloco. */
function codigo(rel) {
    const bruto = readFileSync(resolve(FRONT, rel), 'utf8');
    return bruto
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^[ \t]*\/\/.*$/gm, '');
}

/**
 * OS SÍTIOS, DERIVADOS DO VERSIONAMENTO. Um sítio é todo arquivo de `src/js` cujo CÓDIGO
 * chame `apiClient.logout()`: encerrar a sessão é o ato que torna a fila pendente
 * inalcançável, e quem o pratica é quem precisa resgatar antes.
 *
 * `--others` não é detalhe: sem ele a varredura fica cega no arquivo escrito há cinco
 * minutos e ainda não commitado, que é justamente onde o trabalho novo aparece.
 * @returns {string[]}
 */
function sitiosQueEncerramSessao() {
    const saida = execFileSync(
        'git',
        ['ls-files', '--cached', '--others', '--exclude-standard', '*.js'],
        { cwd: resolve(FRONT, 'src/js'), encoding: 'utf8' }
    );
    const achados = saida.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
        .map((rel) => `src/js/${rel.replace(/\\/g, '/')}`)
        .filter((rel) => /apiClient\.logout\s*\(/.test(codigo(rel)))
        .sort();
    // PISO: cobertura vazia passa verde. Um `git` que falhe, ou um padrão que pare de casar,
    // devolveriam lista vazia e todo `for` abaixo ficaria trivialmente satisfeito.
    if (achados.length < 3) {
        throw new Error(
            `a varredura achou ${achados.length} sítios de logout e esperava ao menos 3: `
            + 'o git falhou, ou o padrão parou de casar.'
        );
    }
    return achados;
}

/** Qualquer uma das portas do módulo de saída conta como resgate. */
const RESGATA = /preserveUnsyncedWorkOnLostSession\s*\(|preserveUnsyncedWorkAsLocal\s*\(|shouldPreserveLocalWork\s*\(/;

/**
 * OS SÍTIOS QUE NÃO SÃO POLÍTICA, com o motivo escrito, um por linha.
 *
 * A primeira versão deste arquivo varria `apiClient.logout()` e exigia resgate de TODO chamador,
 * e a varredura pegou o MOTOR de sync — corretamente, porque ele de fato chama. O erro era a
 * exigência: `sync-engine.js` é o mecanismo por onde a saída passa, não o lugar onde se decide o
 * que fazer com trabalho pendente. Quem decide são as páginas, e todas elas resgatam ANTES de
 * chamar o motor.
 *
 * A alternativa seria estreitar a varredura para `src/js/*-page.js` e afins, e ela é pior: o
 * ponto do censo é achar o sítio que ninguém lembrou de classificar, e um filtro por nome de
 * arquivo devolve o buraco que a lista escrita à mão tinha.
 * @type {Object<string, string>}
 */
const NAO_SAO_POLITICA = Object.freeze({
    'src/js/store/sync/sync-engine.js':
        'O MOTOR. `logoutAndDisconnect` é o mecanismo que as páginas chamam DEPOIS de resgatar; '
        + 'resgatar aqui dentro duplicaria a decisão e a faria rodar duas vezes.',
});

describe('fim de sessão: o resgate vem antes, em TODA página que encerra', () => {
    const SITIOS = sitiosQueEncerramSessao();
    const POLITICA = SITIOS.filter((rel) => !(rel in NAO_SAO_POLITICA));

    it('todo sítio novo é POLÍTICA até alguém dizer o contrário, com motivo', () => {
        // A direção importa: um arquivo novo que chame `logout` entra na lista de política e
        // reprova até ser corrigido OU classificado. O oposto (entrar isento por padrão) é
        // exatamente a fresta que deixou a quarta página passar um mês.
        expect(POLITICA.length, 'nenhum sítio de política sobrou: a varredura quebrou')
            .toBeGreaterThanOrEqual(3);
        // E a lista de isenções não pode conter arquivo que a varredura nem acha mais.
        for (const rel of Object.keys(NAO_SAO_POLITICA)) {
            expect(SITIOS, `isenção órfã: ${rel}`).toContain(rel);
        }
    });

    it('todo sítio de política resgata o trabalho não enviado', () => {
        const semResgate = POLITICA.filter((rel) => !RESGATA.test(codigo(rel)));
        expect(semResgate, `encerram sessão sem resgatar: ${semResgate.join(', ')}`).toEqual([]);
    });

    it('e o resgate vem ANTES do logout, não depois', () => {
        // A ordem é a propriedade inteira: resgatar depois de a sessão cair é resgatar sem
        // credencial para consultar o servidor.
        for (const rel of POLITICA) {
            const texto = codigo(rel);
            const ondeResgate = texto.search(RESGATA);
            const ondeLogout = texto.search(/apiClient\.logout\s*\(/);
            expect(ondeResgate, `${rel}: não resgata`).toBeGreaterThan(-1);
            expect(ondeResgate, `${rel}: resgata DEPOIS do logout`).toBeLessThan(ondeLogout);
        }
    });

    it('a QUARTA página está no inventário, e ela é a razão de ele ser derivado', () => {
        // CONTROLE DE VÁCUO com nome próprio, no mesmo espírito do censo da credencial. Se ela
        // sumir daqui, ou o arquivo deixou de encerrar sessão (bom, e então esta linha sai com o
        // motivo), ou a varredura parou de achar (ruim, e é o que este caso existe para dizer).
        expect(SITIOS).toContain('src/js/calibration/calibracao-page.js');
        expect(SITIOS).toContain('src/js/projects/projects-page.js');
        expect(SITIOS).toContain('src/js/admin/admin-page.js');
    });

    it('CONTROLE: a varredura lê CÓDIGO e não PROSA', () => {
        // Os comentários destes arquivos citam `apiClient.logout()` por extenso ao explicar a
        // regra. Uma varredura ingênua ficaria verde para sempre por causa deles.
        const comProsa = 'src/js/admin/admin-page.js';
        const bruto = readFileSync(resolve(FRONT, comProsa), 'utf8');
        expect(bruto).toContain('logout()');
        // E o removedor não pode ter comido o código junto.
        expect(codigo(comProsa)).toMatch(/apiClient\.logout\s*\(/);
    });
});
