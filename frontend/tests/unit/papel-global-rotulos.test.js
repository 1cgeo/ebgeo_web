// Path: tests/unit/papel-global-rotulos.test.js

/**
 * @fileoverview OS QUATRO PAPÉIS DO EIXO GLOBAL têm nome e explicação, num lugar só.
 *
 * O DEFEITO QUE ISTO FECHA: os rótulos pt-BR viviam em `admin/users-tab.js` (`ROLE_CHIP`), dentro
 * de uma aba que só o administrador abre. Serviam para ver o papel dos OUTROS, e ninguém, em
 * nenhuma das quatro páginas, descobria o próprio. `ui/role-labels.js` passa a ser a fonte única,
 * e esta suíte prende as três propriedades que a leitura do módulo não prova sozinha.
 *
 * AS ASSERÇÕES ESTRUTURAIS SÃO O PONTO, não higiene. A função pura ficaria verde para sempre
 * enquanto um quinto papel global nascesse sem rótulo (a tela mostraria o valor cru, ou pior, um
 * `undefined`), e ficaria verde também se os rótulos daqui divergissem dos da aba de
 * administração, que é o estado em que duas telas chamam a mesma pessoa por dois nomes. Por isso
 * o inventário de papéis é LIDO DO ENUM (`GlobalRole`, em `store/sync/session-context.js`) e os
 * rótulos são COMPARADOS com os da aba, em vez de escritos à mão nas duas pontas.
 *
 * O EIXO GLOBAL NÃO É UMA ESCADA, e nada aqui o ordena: são quatro trabalhos distintos. A ordem é
 * do eixo POR ATLAS, que tem implementação própria (`projects/permission-levels.js`).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    GLOBAL_ROLE_LABELS,
    GLOBAL_ROLE_DESCRIPTIONS,
    getGlobalRoleLabel,
    getGlobalRoleDescription,
    globalRoleBadge,
    isKnownGlobalRole,
} from '../../src/js/ui/role-labels.js';

const FRONT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** @param {string} rel @returns {string} */
function fonte(rel) {
    return readFileSync(resolve(FRONT, rel), 'utf8');
}

/**
 * Os papéis do eixo global lidos DO ENUM que o resto do app consome, e não de uma lista escrita
 * aqui: uma cópia à mão é exatamente o que deixaria o quinto papel passar em silêncio.
 * @returns {string[]}
 */
function papeisDoEnum() {
    const src = fonte('src/js/store/sync/session-context.js');
    const bloco = src.match(/export const GlobalRole = Object\.freeze\(\{([\s\S]*?)\}\);/);
    if (!bloco) throw new Error('GlobalRole não foi encontrado em session-context.js');
    return [...bloco[1].matchAll(/:\s*'([^']+)'/g)].map((m) => m[1]);
}

/** @returns {string} O texto da aba de administração, onde os rótulos eram gêmeos destes. */
function fonteDaAbaDeUsuarios() {
    return fonte('src/js/admin/users-tab.js');
}

const PAPEIS = papeisDoEnum();

describe('role-labels — os quatro papéis, com nome e com explicação', () => {
    it('cada papel tem o rótulo pt-BR esperado', () => {
        expect(getGlobalRoleLabel('user')).toBe('Usuário');
        expect(getGlobalRoleLabel('producer')).toBe('Produtor');
        expect(getGlobalRoleLabel('credenciado')).toBe('Credenciado');
        expect(getGlobalRoleLabel('admin')).toBe('Administrador');
    });

    it('cada papel tem UMA frase própria dizendo o que ele pode', () => {
        // O rótulo sozinho não ensina nada, que é o defeito medido: a frase é a entrega.
        const frases = PAPEIS.map((papel) => getGlobalRoleDescription(papel));
        for (const [i, frase] of frases.entries()) {
            expect(frase, PAPEIS[i]).toMatch(/\S/);
            expect(frase.endsWith('.'), `${PAPEIS[i]}: a descrição é uma frase`).toBe(true);
        }
        // Quatro frases DIFERENTES: uma cópia colada em dois papéis descreveria um deles errado.
        expect(new Set(frases).size).toBe(PAPEIS.length);
    });

    it('a frase de cada papel nomeia o que aquele papel faz de diferente', () => {
        // Números de controle absolutos: comparar as frases entre si deixaria passar quatro frases
        // igualmente erradas.
        expect(getGlobalRoleDescription('producer')).toMatch(/OM/);
        expect(getGlobalRoleDescription('credenciado')).toMatch(/privado/);
        expect(getGlobalRoleDescription('admin')).toMatch(/[Aa]dministra/);
    });

    it('isKnownGlobalRole discrimina, e não é um `true` constante', () => {
        for (const papel of PAPEIS) expect(isKnownGlobalRole(papel), papel).toBe(true);
        expect(isKnownGlobalRole('auditor')).toBe(false);
        expect(isKnownGlobalRole('')).toBe(false);
        expect(isKnownGlobalRole(null)).toBe(false);
        expect(isKnownGlobalRole(undefined)).toBe(false);
        expect(isKnownGlobalRole(7)).toBe(false);
        // Herdado do prototype não conta como papel (`Object.hasOwn`, não `in`).
        expect(isKnownGlobalRole('toString')).toBe(false);
    });
});

describe('role-labels — o papel DESCONHECIDO não some da tela nem a quebra', () => {
    it('o valor cru vira o rótulo, em vez de sumir ou virar "Usuário"', () => {
        expect(getGlobalRoleLabel('auditor')).toBe('auditor');
        expect(getGlobalRoleLabel('  auditor  ')).toBe('auditor');
        // A degradação silenciosa que isto impede: cair no papel mais fraco conhecido.
        expect(getGlobalRoleLabel('auditor')).not.toBe(GLOBAL_ROLE_LABELS.user);
    });

    it('a frase do desconhecido DIZ que é desconhecido, e o nomeia', () => {
        const frase = getGlobalRoleDescription('auditor');
        expect(frase).toContain('auditor');
        expect(frase).toMatch(/não sabe descrevê-lo/);
        // E não empresta a frase de nenhum papel conhecido.
        expect(Object.values(GLOBAL_ROLE_DESCRIPTIONS)).not.toContain(frase);
    });

    it('sem papel nenhum não há selo: o anônimo não vira "Visitante"', () => {
        for (const vazio of [null, undefined, '', '   ', 42, {}]) {
            expect(getGlobalRoleLabel(vazio)).toBe('');
            expect(getGlobalRoleDescription(vazio)).toBe('');
            expect(globalRoleBadge(vazio)).toBeNull();
        }
    });
});

describe('globalRoleBadge — a palavra mais o title que a explica', () => {
    it('devolve rótulo e explicação para cada papel', () => {
        for (const papel of PAPEIS) {
            const selo = globalRoleBadge(papel);
            expect(selo, papel).not.toBeNull();
            expect(selo.label).toBe(GLOBAL_ROLE_LABELS[papel]);
            expect(selo.title).toBe(GLOBAL_ROLE_DESCRIPTIONS[papel]);
        }
    });

    it('a OM entra na explicação do PRODUTOR, que é a fronteira em que ele age', () => {
        const selo = globalRoleBadge('producer', { orgName: '1º CGEO' });
        expect(selo.label).toBe('Produtor');
        expect(selo.title).toContain('OM: 1º CGEO.');
    });

    it('a OM NÃO contamina os outros papéis nem aparece vazia', () => {
        // Um administrador não produz por uma OM: carimbar a dele no selo seria dizer que ele age
        // dentro de uma fronteira que ele não tem.
        expect(globalRoleBadge('admin', { orgName: '1º CGEO' }).title)
            .toBe(GLOBAL_ROLE_DESCRIPTIONS.admin);
        expect(globalRoleBadge('producer', { orgName: '   ' }).title)
            .toBe(GLOBAL_ROLE_DESCRIPTIONS.producer);
        expect(globalRoleBadge('producer').title).toBe(GLOBAL_ROLE_DESCRIPTIONS.producer);
        expect(globalRoleBadge('producer', { orgName: null }).title)
            .toBe(GLOBAL_ROLE_DESCRIPTIONS.producer);
    });

    it('o desconhecido também ganha selo, com o aviso dentro', () => {
        const selo = globalRoleBadge('auditor');
        expect(selo.label).toBe('auditor');
        expect(selo.title).toMatch(/não sabe descrevê-lo/);
    });
});

describe('role-labels — as propriedades estruturais que a função pura não prova', () => {
    it('TODO papel do enum GlobalRole tem rótulo E frase', () => {
        // O controle de vácuo, e só ele: uma varredura que não achasse o enum deixaria o laço
        // vazio verde. Não é `toBe(4)` de propósito — um quinto papel tem de reprovar pela
        // asserção ABAIXO, que o nomeia e diz o que falta, e não por uma contagem que só diz que
        // o número mudou.
        expect(PAPEIS.length, 'o enum GlobalRole não foi lido').toBeGreaterThanOrEqual(4);
        for (const papel of PAPEIS) {
            expect(Object.hasOwn(GLOBAL_ROLE_LABELS, papel),
                `o papel global "${papel}" existe no enum e não tem rótulo em ui/role-labels.js`)
                .toBe(true);
            expect(Object.hasOwn(GLOBAL_ROLE_DESCRIPTIONS, papel),
                `o papel global "${papel}" existe no enum e não tem descrição em ui/role-labels.js`)
                .toBe(true);
        }
        // E o inverso: rótulo para papel que não existe é entrada morta que ninguém poda.
        expect(Object.keys(GLOBAL_ROLE_LABELS).sort()).toEqual([...PAPEIS].sort());
        expect(Object.keys(GLOBAL_ROLE_DESCRIPTIONS).sort()).toEqual([...PAPEIS].sort());
    });

    it('a aba de administração DERIVA daqui, em vez de repetir os rótulos', () => {
        // Este caso já foi um espelho: lia os quatro literais de `ROLE_CHIP` e os comparava com os
        // daqui. O espelho prendia a divergência e PRESERVAVA a duplicação, que é o defeito de
        // origem. Com `ROLE_CHIP` derivado de `GLOBAL_ROLE_LABELS`, divergir deixou de ser
        // alcançável, e o que resta a cobrar é a derivação em si: o dia em que alguém reescrever
        // os rótulos à mão naquela aba, o vermelho aparece aqui e não numa tela.
        const src = fonteDaAbaDeUsuarios();
        expect(src, 'a aba de usuários não importa mais a fonte única dos rótulos')
            .toMatch(/import\s*\{[^}]*GLOBAL_ROLE_LABELS[^}]*\}\s*from\s*'@ui\/role-labels\.js'/);
        expect(src, 'ROLE_CHIP voltou a ser um literal escrito à mão')
            .toMatch(/const ROLE_CHIP = Object\.freeze\(/);

        // Controle negativo do próprio caso: uma varredura que casasse zero rótulos passaria verde
        // sem provar nada, então o inventário é lido do enum e cobrado por contagem.
        const rotulosLiterais = [...src.matchAll(/rotulo:\s*'([^']+)'/g)].map((m) => m[1]);
        expect(rotulosLiterais, 'rótulo literal de papel reapareceu na aba').toHaveLength(0);
        expect(PAPEIS).toHaveLength(4);
        for (const papel of PAPEIS) {
            expect(GLOBAL_ROLE_LABELS[papel], `"${papel}" perdeu o rótulo`).toMatch(/\S/);
        }
    });

    it('o módulo é FOLHA: zero imports, senão as páginas sem mapa arrastam a store', () => {
        const src = fonte('src/js/ui/role-labels.js');
        expect(src).not.toMatch(/^\s*import\s/m);
        expect(src).not.toMatch(/\brequire\s*\(/);
    });

    it('os mapas são congelados: um consumidor não reescreve o rótulo do próximo', () => {
        expect(Object.isFrozen(GLOBAL_ROLE_LABELS)).toBe(true);
        expect(Object.isFrozen(GLOBAL_ROLE_DESCRIPTIONS)).toBe(true);
    });
});
