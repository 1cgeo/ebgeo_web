// Path: tests/unit/docs-integridade.test.js
//
// A documentação é verificada pelo CI, não pela disciplina de quem escreve.
//
// Por que existe: "atualize os docs" como regra cultural sempre falha; o único
// mecanismo que segura frescor é o que QUEBRA O BUILD. E documentação
// desatualizada é pior que documentação ausente, porque engana ativamente — vale
// em dobro com agentes de IA, que tratam a doc como verdade e propagam o erro
// para o código (um humano desconfia de doc velha; um agente não).
//
// Esta sessão produziu a prova: o antigo `99-pendencias-e-desvios.md` documentava
// a permissão por atlas como `owner/write/read` quando o CHECK do banco tem CINCO
// níveis, e foi exatamente esse modelo mental de 3 níveis que silenciou a seleção
// do co-Gestor no `handleSelection`. Nenhum teste pegava isso.
//
// Cobre três classes de podridão:
//   1. caminho de arquivo citado na doc que não existe mais (renomeado/removido);
//   2. link markdown relativo apontando para arquivo inexistente;
//   3. [[wikilink]] apontando para página de wiki inexistente. O Claude Code não
//      tem resolvedor de wikilink (para o agente é texto literal, que ele resolve
//      por grep), então validar o alvo aqui devolve a propriedade que o formato
//      não dá sozinho: renomear uma página quebra o teste, não o silêncio.

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { Buffer } from 'node:buffer';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** Documentos sob vigilância: os que orientam humano e agente. */
const ALVOS = [
    'CLAUDE.md',
    'README.md',
    'MEMORY.md',
    'livro-razao.md',
    'backend/CLAUDE.md',
    'backend/README.md',
];
const PASTAS = ['docs', '.claude/rules', '.claude/skills'];

/** Coleta recursivamente os .md das pastas vigiadas, ignorando node_modules. */
function coletarMarkdown(dir, acc = []) {
    const abs = join(RAIZ, dir);
    if (!existsSync(abs)) return acc;
    for (const nome of readdirSync(abs)) {
        if (nome === 'node_modules') continue;
        const rel = `${dir}/${nome}`;
        if (statSync(join(RAIZ, rel)).isDirectory()) coletarMarkdown(rel, acc);
        else if (nome.endsWith('.md')) acc.push(rel);
    }
    return acc;
}

const DOCS = [...ALVOS.filter((f) => existsSync(join(RAIZ, f))), ...PASTAS.flatMap((p) => coletarMarkdown(p))];

/**
 * Caminhos de código citados em backticks — `src/js/store/store.js`,
 * `backend/src/config.js`. Exige uma extensão conhecida para não confundir com
 * nomes de conceito, e ignora globs/placeholders (`*`, `<`, `{`).
 */
const RE_CAMINHO = /`((?:src|tests|backend|docs|scripts|deploy|public)\/[A-Za-z0-9._/-]+\.(?:js|cjs|mjs|json|sql|css|md|yml|sh))`/g;

/** Links markdown relativos: [texto](caminho.md) ou (./x.js), sem URL nem âncora pura. */
const RE_LINK = /\]\((\.{0,2}\/?[A-Za-z0-9._/-]+\.(?:md|js|sql|json|sh|yml))(?:#[^)]*)?\)/g;

/** Wikilinks: [[slug]] — não resolvem no Claude Code. */
const RE_WIKILINK = /\[\[([^\]]+)\]\]/g;

/** Caminhos que existem como referência histórica/externa e não devem falhar. */
const ISENTOS = new Set([
    'src/js/store/sync/diag/trace-core.js', // citado como caminho conceitual em prosa de arquitetura
]);

describe('integridade da documentação', () => {
    it('lista os documentos vigiados (guarda contra a lista esvaziar em silêncio)', () => {
        expect(DOCS.length).toBeGreaterThan(10);
    });

    it('todo caminho de arquivo citado em backticks existe', () => {
        const quebrados = [];
        for (const doc of DOCS) {
            const texto = readFileSync(join(RAIZ, doc), 'utf8');
            for (const m of texto.matchAll(RE_CAMINHO)) {
                const alvo = m[1];
                if (ISENTOS.has(alvo)) continue;
                // Um doc do pacote backend (ou um guia que o descreve) cita
                // caminhos relativos AO PACOTE (`src/index.js` = backend/src/...).
                // Vale se existir na raiz OU sob backend/.
                if (existsSync(join(RAIZ, alvo)) || existsSync(join(RAIZ, 'backend', alvo))) continue;
                quebrados.push(`${doc} → \`${alvo}\``);
            }
        }
        expect(quebrados, `caminhos citados que não existem mais:\n${quebrados.join('\n')}`).toEqual([]);
    });

    it('todo link markdown relativo aponta para um arquivo existente', () => {
        const quebrados = [];
        for (const doc of DOCS) {
            const texto = readFileSync(join(RAIZ, doc), 'utf8');
            const base = dirname(join(RAIZ, doc));
            for (const m of texto.matchAll(RE_LINK)) {
                const alvo = resolve(base, m[1]);
                if (!existsSync(alvo)) quebrados.push(`${doc} → ${m[1]}`);
            }
        }
        expect(quebrados, `links markdown quebrados:\n${quebrados.join('\n')}`).toEqual([]);
    });

    it('todo [[wikilink]] resolve para uma página da wiki', () => {
        // O Claude Code NÃO resolve wikilink nativamente: para o agente é texto
        // literal, que ele acaba resolvendo por grep. Validar o ALVO aqui devolve
        // a propriedade que o formato não dá sozinho — renomear ou remover uma
        // página quebra o teste em vez de deixar um link morto em silêncio.
        const wiki = join(RAIZ, 'docs/wiki');
        if (!existsSync(wiki)) return;
        const paginas = new Set(
            readdirSync(wiki)
                .filter((f) => f.endsWith('.md'))
                .map((f) => f.replace(/\.md$/, ''))
        );
        const quebrados = [];
        for (const doc of DOCS) {
            const texto = readFileSync(join(RAIZ, doc), 'utf8');
            for (const m of texto.matchAll(RE_WIKILINK)) {
                const slug = m[1].split('|')[0].trim();
                if (!paginas.has(slug)) quebrados.push(`${doc} → [[${slug}]]`);
            }
        }
        expect(
            quebrados,
            `wikilinks apontando para páginas inexistentes:\n${quebrados.slice(0, 25).join('\n')}`
        ).toEqual([]);
    });

    it('slug de wikilink é ASCII, sem acento', () => {
        // O slug é nome de arquivo; acento dentro de [[..]] diverge do arquivo
        // real e quebra a resolução por grep que o agente faz.
        const comAcento = [];
        for (const doc of DOCS) {
            const texto = readFileSync(join(RAIZ, doc), 'utf8');
            for (const m of texto.matchAll(RE_WIKILINK)) {
                // Faixa ASCII IMPRIMÍVEL: evita caractere de controle na própria
                // regex (que o eslint barra) e é o que um slug pode conter.
                if (/[^ -~]/.test(m[1])) comAcento.push(`${doc} → [[${m[1]}]]`);
            }
        }
        expect(comAcento, `wikilink com caractere não-ASCII:\n${comAcento.join('\n')}`).toEqual([]);
    });

    it('MEMORY.md cabe no que o Claude Code realmente carrega', () => {
        // Limite duro: 200 linhas OU 25KB, o que vier primeiro; o excedente é
        // DESCARTADO EM SILÊNCIO na próxima carga. Falhar aqui é melhor que
        // perder memória sem aviso.
        const arq = join(RAIZ, 'MEMORY.md');
        if (!existsSync(arq)) return;
        const texto = readFileSync(arq, 'utf8');
        expect(texto.split('\n').length, 'MEMORY.md acima de 200 linhas: o excedente é descartado').toBeLessThanOrEqual(200);
        expect(Buffer.byteLength(texto, 'utf8'), 'MEMORY.md acima de 25KB: o excedente é descartado').toBeLessThanOrEqual(25 * 1024);
    });

    it('CLAUDE.md fica abaixo do teto de 200 linhas recomendado', () => {
        // Arquivo mais longo consome mais contexto E reduz a aderência (doc
        // oficial). O que o agente consegue derivar lendo o código não deve morar
        // aqui; o que fica é armadilha, racional e convenção que diverge do
        // default da ferramenta.
        const texto = readFileSync(join(RAIZ, 'CLAUDE.md'), 'utf8');
        const linhas = texto.split('\n').length;
        expect(linhas, `CLAUDE.md com ${linhas} linhas; alvo <= 200 (mova detalhe para .claude/rules com paths:)`).toBeLessThanOrEqual(200);
    });
});
