// Path: tests/unit/instrucoes-do-agente-teto.test.js
//
// O que o Claude Code carrega em TODA sessão tem teto, e toda regra com escopo carrega de verdade.
//
// Por que existe: em 2026-09-24 o Claude Code passou a avisar que as instruções somavam 226,6k
// caracteres, acima do limite de 150k que ele recomenda (`CLAUDE.md` mais as três regras de
// `.claude/rules/`, todas sem `paths:`). O guarda que havia media o `CLAUDE.md` em LINHAS (145 de
// 200) enquanto uma linha chegava a 1931 caracteres, e as regras não tinham teto nenhum: a
// `architecture.md` foi de 14,6k para 129k em dois meses, porque cada correção acrescentava um
// parágrafo sobre o erro anterior. É a classe `verificacao-fantasma` do livro-razão: a checagem
// existia e não media o que importa. O custo não é só de contexto: todo subagente carrega o
// mesmo preâmbulo, e regra que se contradiz com outra (havia três contradições vivas) deixa o
// agente escolher uma ao acaso.
//
// O que este arquivo prende:
//   1. o NÚCLEO (o que carrega sempre) é exatamente `CLAUDE.md`, `architecture.md` e
//      `testing.md`, e soma no máximo TETO_NUCLEO caracteres. Regra nova sem `paths:` reprova:
//      regra de área nasce com escopo, e aumentar o núcleo é decisão, não reflexo;
//   2. cada regra com escopo fica abaixo de TETO_POR_REGRA, senão o arquivo com escopo vira o
//      próximo depósito;
//   3. cabeçalho que não parseia REPROVA. O Claude Code ignora em silêncio um frontmatter
//      inválido e carrega a regra como se não tivesse `paths:`, ou seja, ela volta ao núcleo sem
//      aparecer em lugar nenhum;
//   4. todo padrão de `paths:` casa pelo menos um arquivo versionado. Padrão que não casa nada é
//      regra que nunca carrega, e ela passaria verde nos três itens acima.
//
// O que ele NÃO prende: que o padrão seja o CERTO para o assunto (um padrão largo demais passa), e
// que a regra carregue ANTES de ser necessária. A regra com escopo só entra quando um arquivo que
// casa é LIDO (busca por grep não dispara) e sai do contexto na compactação; o que precisa valer
// antes de abrir qualquer arquivo tem de morar no núcleo.

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const REGRAS = '.claude/rules';

// Menos da metade do aviso do Claude Code (150k), porque o que carrega sempre carrega também em
// cada subagente. Medido em 2026-09-24, depois da divisão: cerca de 54k.
const TETO_NUCLEO = 60_000;
// O maior arquivo com escopo, no mesmo dia, era o de sync, com cerca de 30k.
const TETO_POR_REGRA = 40_000;

// O núcleo declarado. `CLAUDE.local.md` fica de fora de propósito: é pessoal, não versionado, e o
// teto é do repositório.
const NUCLEO_ESPERADO = ['CLAUDE.md', `${REGRAS}/architecture.md`, `${REGRAS}/testing.md`];

function ler(rel) {
    return readFileSync(join(RAIZ, rel), 'utf8').replace(/\r\n/g, '\n');
}

function coletarRegras(dir = REGRAS, acc = []) {
    for (const nome of readdirSync(join(RAIZ, dir))) {
        const rel = `${dir}/${nome}`;
        if (statSync(join(RAIZ, rel)).isDirectory()) coletarRegras(rel, acc);
        else if (nome.endsWith('.md')) acc.push(rel);
    }
    return acc;
}

/**
 * Lê o cabeçalho de uma regra. Devolve `{ paths: null }` quando não há cabeçalho, `{ paths: [...] }`
 * quando há, e `{ erro }` quando há um cabeçalho que este leitor não reconhece.
 *
 * O leitor é ESTRITO de propósito: aceita só a forma que a casa escreve (`paths:` seguido de itens
 * `  - "padrão"`). Uma forma que o Claude Code talvez aceite e este leitor não é um vermelho
 * barato; o inverso, um cabeçalho que este leitor aceita e o Claude Code descarta, devolveria a
 * regra ao núcleo sem nada acusar.
 */
function lerCabecalho(texto) {
    if (!texto.startsWith('---\n')) return { paths: null };
    const fim = texto.indexOf('\n---\n', 3);
    if (fim === -1) return { erro: 'cabeçalho aberto e nunca fechado' };
    const linhas = texto.slice(4, fim).split('\n');
    if (linhas[0] !== 'paths:') return { erro: `primeira linha do cabeçalho deveria ser "paths:", é "${linhas[0]}"` };
    const paths = [];
    for (const linha of linhas.slice(1)) {
        const m = /^ {2}- "([^"]+)"$/.exec(linha);
        if (!m) return { erro: `linha de cabeçalho fora da forma \`  - "padrão"\`: "${linha}"` };
        paths.push(m[1]);
    }
    if (paths.length === 0) return { erro: '`paths:` sem nenhum padrão' };
    return { paths };
}

/** Padrão de glob (só `**` e `*`, que é o que a casa usa) para expressão regular. */
function globParaRegex(glob) {
    let re = '';
    for (let i = 0; i < glob.length; i++) {
        const c = glob[i];
        if (c === '*' && glob[i + 1] === '*') {
            if (glob[i + 2] === '/') {
                re += '(?:.*/)?';
                i += 2;
            } else {
                re += '.*';
                i += 1;
            }
        } else if (c === '*') {
            re += '[^/]*';
        } else {
            re += c.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
        }
    }
    return new RegExp(`^${re}$`);
}

const REGRAS_NO_DISCO = coletarRegras();
const CABECALHOS = new Map(REGRAS_NO_DISCO.map((rel) => [rel, lerCabecalho(ler(rel))]));
const SEM_ESCOPO = REGRAS_NO_DISCO.filter((rel) => CABECALHOS.get(rel).paths === null);
const COM_ESCOPO = REGRAS_NO_DISCO.filter((rel) => Array.isArray(CABECALHOS.get(rel).paths));
const NUCLEO = [
    'CLAUDE.md',
    ...(existsSync(join(RAIZ, '.claude/CLAUDE.md')) ? ['.claude/CLAUDE.md'] : []),
    ...SEM_ESCOPO,
];

// Inventário do versionamento (inclui o que ainda não foi commitado e não é ignorado): é contra
// ele que um padrão tem de casar alguma coisa.
const INVENTARIO = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
    cwd: RAIZ,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
}).split('\n').map((l) => l.trim()).filter(Boolean);

describe('instruções do agente: teto e escopo', () => {
    it('os instrumentos medem (controle dos dois lados)', () => {
        expect(INVENTARIO.length, 'o inventário do git veio vazio').toBeGreaterThan(1000);
        expect(INVENTARIO).toContain('CLAUDE.md');
        expect(REGRAS_NO_DISCO.length, 'a pasta de regras veio vazia').toBeGreaterThan(3);

        // O conversor de glob: `*` não atravessa `/`, `**/` atravessa zero ou mais pastas.
        expect(globParaRegex('frontend/*.html').test('frontend/index.html')).toBe(true);
        expect(globParaRegex('frontend/*.html').test('frontend/public/x.html')).toBe(false);
        expect(globParaRegex('frontend/src/js/admin/**').test('frontend/src/js/admin/a/b.js')).toBe(true);
        expect(globParaRegex('frontend/src/js/admin/**').test('frontend/src/js/administracao.js')).toBe(false);
        expect(globParaRegex('a/**/b.js').test('a/b.js')).toBe(true);
        expect(globParaRegex('a/**/b.js').test('a/x/y/b.js')).toBe(true);
        expect(globParaRegex('frontend/playwright*.config.js').test('frontend/playwright.tablet.config.js')).toBe(true);
        expect(globParaRegex('x.js').test('xxjs')).toBe(false);

        // O leitor de cabeçalho: sem cabeçalho, válido, e as formas que o Claude Code descartaria.
        expect(lerCabecalho('# regra\n')).toEqual({ paths: null });
        expect(lerCabecalho('---\npaths:\n  - "a/**"\n---\n\n# r\n')).toEqual({ paths: ['a/**'] });
        expect(lerCabecalho('---\npaths: a/**\n---\n').erro).toBeTruthy();
        expect(lerCabecalho('---\npaths:\n\t- "a/**"\n---\n').erro).toBeTruthy();
        expect(lerCabecalho('---\npaths:\n  - "a/**"\n').erro).toBeTruthy();
        expect(lerCabecalho('---\npaths:\n---\n').erro).toBeTruthy();
    });

    it('todo cabeçalho de regra parseia', () => {
        const ruins = [...CABECALHOS].filter(([, c]) => c.erro).map(([rel, c]) => `${rel}: ${c.erro}`);
        expect(
            ruins,
            'cabeçalho que não parseia faz o Claude Code carregar a regra SEM escopo, em silêncio:\n'
                + ruins.join('\n')
        ).toEqual([]);
    });

    it('o núcleo é exatamente o declarado', () => {
        expect(
            [...NUCLEO].sort(),
            'regra sem `paths:` fora do núcleo declarado. Regra de área nasce com `paths:`; mudar o'
                + ' núcleo é decisão, e se faz editando NUCLEO_ESPERADO com o motivo'
        ).toEqual([...NUCLEO_ESPERADO].sort());
    });

    it(`o núcleo soma no máximo ${TETO_NUCLEO} caracteres`, () => {
        const tamanhos = NUCLEO.map((rel) => [rel, ler(rel).length]);
        const total = tamanhos.reduce((s, [, n]) => s + n, 0);
        expect(
            total,
            `o núcleo soma ${total} caracteres (${tamanhos.map(([r, n]) => `${r}: ${n}`).join(', ')}).`
                + ' Mova o que é de uma área para um arquivo com `paths:`, e a história da correção para'
                + ' o livro-razão'
        ).toBeLessThanOrEqual(TETO_NUCLEO);
        // Piso: um núcleo vazio passaria o teto sem medir nada.
        expect(total).toBeGreaterThan(10_000);
    });

    it(`toda regra com escopo fica abaixo de ${TETO_POR_REGRA} caracteres`, () => {
        expect(COM_ESCOPO.length, 'nenhuma regra com escopo: o caso passaria vazio').toBeGreaterThan(5);
        const grandes = COM_ESCOPO
            .map((rel) => [rel, ler(rel).length])
            .filter(([, n]) => n > TETO_POR_REGRA)
            .map(([rel, n]) => `${rel}: ${n}`);
        expect(grandes, `regra com escopo acima do teto; divida por assunto:\n${grandes.join('\n')}`).toEqual([]);
    });

    it('todo padrão de `paths:` casa pelo menos um arquivo versionado', () => {
        const mortos = [];
        let padroes = 0;
        for (const rel of COM_ESCOPO) {
            for (const glob of CABECALHOS.get(rel).paths) {
                padroes++;
                const re = globParaRegex(glob);
                if (!INVENTARIO.some((arq) => re.test(arq))) mortos.push(`${rel} → "${glob}"`);
            }
        }
        expect(padroes, 'nenhum padrão lido: o caso passaria vazio').toBeGreaterThan(COM_ESCOPO.length);
        expect(mortos, `padrão que não casa nada: a regra nunca carrega por ele:\n${mortos.join('\n')}`).toEqual([]);
    });
});
