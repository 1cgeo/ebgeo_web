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

// Raiz do MONOREPO, tres niveis acima (frontend/tests/unit/ -> frontend/ -> raiz),
// nao a raiz do pacote: a doc vigiada (docs/, CLAUDE.md, .claude/) e do monorepo.
// Quando o pacote web virou frontend/ em 2026-07-18 isto apontava para frontend/,
// e a lista de documentos silenciosamente zerou. O teste "lista os documentos
// vigiados" existe exatamente para isso e foi ele que acusou.
const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

/** Documentos sob vigilância: os que orientam humano e agente. */
const ALVOS = [
    'CLAUDE.md',
    'README.md',
    'MEMORY.md',
    'livro-razao.md',
    'backend/CLAUDE.md',
    'backend/README.md',
];
// `.claude/agents` entrou depois: a auditoria de 2026-07-18 achou erro real em
// arquivo de agente (e no extinto launch.json) justamente por estarem fora desta
// lista. Cobertura que para na borda de um diretório é cobertura que não cobre.
const PASTAS = ['docs', '.claude/rules', '.claude/skills', '.claude/agents'];

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
 * Caminhos de código citados em backticks: `frontend/src/js/store/store.js`,
 * `backend/src/config.js:290-292`. Exige uma extensão conhecida para não
 * confundir com nomes de conceito, e ignora globs/placeholders (`*`, `<`, `{`).
 *
 * O sufixo `:linha` é OPCIONAL e capturado à parte, de propósito. Sem ele a
 * regex exigia a crase logo após a extensão, então toda citação no formato
 * `arquivo:linha` escapava da checagem: 1116 citações não verificadas contra
 * 210 verificadas, e `arquivo:linha` é justamente o formato que o
 * `docs/wiki/wiki-schema.md` manda usar. O teste passava verde medindo a
 * minoria. Só o caminho é validado; o número da linha não dá para verificar
 * aqui, e fingir que dá seria o mesmo erro de novo.
 *
 * O PREFIXO não é uma lista fechada, e essa é a segunda lição do mesmo arquivo.
 * A versão anterior aceitava só `frontend|backend|src|tests|docs|scripts|deploy|public`,
 * então as 53 citações que ainda usavam os prefixos pré-monorepo `ebgeo_backend/`
 * e `ebgeo_web/` não casavam, não eram coletadas e não eram verificadas — o mesmo
 * defeito estrutural do sufixo, agora no começo da string. `docs/wiki/ack-idempotencia.md`
 * chegou a ter as duas formas na MESMA linha, com metade guardada. Lista fechada
 * silencia o que não conhece, então aqui a regra é inversa: colete QUALQUER token
 * com cara de caminho e extensão conhecida, e deixe a existência do arquivo ser a
 * asserção. Prefixo desconhecido passa a falhar em vez de escapar, e a próxima
 * renomeação de pasta acusa em vez de silenciar.
 */
const RE_CAMINHO =
    /`([A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)+\.(?:js|cjs|mjs|json|sql|css|md|yml|sh))(?::\d+(?:[\s,-]*\d+)*)?`/g;

/** Links markdown relativos: [texto](caminho.md) ou (./x.js), sem URL nem âncora pura. */
const RE_LINK = /\]\((\.{0,2}\/?[A-Za-z0-9._/-]+\.(?:md|js|sql|json|sh|yml))(?:#[^)]*)?\)/g;

/**
 * Links markdown para DIRETÓRIO: `[guias](backend/docs/implementado/)`. A regex de
 * arquivo acima exige extensão conhecida, então link para pasta nunca era checado —
 * e o único link markdown morto de todo o corpus vigiado era exatamente desse tipo,
 * apontando para um diretório de guias que a wiki absorveu e que deixou de existir.
 * Mesma classe do prefixo e do sufixo: o que a regra não casa, ela abençoa.
 */
const RE_LINK_DIR = /\]\((\.{0,2}\/?(?:[A-Za-z0-9._-]+\/)+)\)/g;

/** Wikilinks: [[slug]] — não resolvem no Claude Code. */
const RE_WIKILINK = /\[\[([^\]]+)\]\]/g;

/** Caminhos que existem como referência histórica/externa e não devem falhar. */
const ISENTOS = new Set([
    'src/js/store/sync/diag/trace-core.js', // citado como caminho conceitual em prosa de arquitetura
    // Variante ILUSTRATIVA de path traversal em `docs/wiki/assets3d-distribuicao.md`,
    // ao lado de `aman//x.json`: é a string de entrada que o exemplo discute, não um
    // arquivo. Só aparece porque a coleta passou a ser ampla — e é o único
    // falso-positivo que a inversão produziu em 65 páginas.
    './aman/x.json',
]);

/**
 * Raízes contra as quais uma citação pode resolver, além do próprio diretório do
 * documento que cita.
 *
 * Isto é o par necessário da coleta ampla: agora que a regex junta QUALQUER token
 * com cara de caminho, ela também junta citação legitimamente relativa a um módulo
 * — a constituição manda o comentário da linha 1 ser relativo ao `src/` do pacote
 * (`js/draw_tools/...`), e as skills citam `store/store-errors.js` no mesmo dialeto.
 * Sem estas raízes, inverter a regex trocaria um falso-negativo por uma enxurrada
 * de falso-positivo, e um teste que grita demais é desligado, o que dá no mesmo.
 *
 * A propriedade que importa continua de pé: caminho que não existe sob NENHUMA
 * raiz real falha. É por isso que `ebgeo_backend/...` e `ebgeo_web/...`, os
 * prefixos do layout pré-monorepo, são pegos.
 */
const RAIZES_DE_RESOLUCAO = ['', 'backend', 'frontend', 'backend/src', 'frontend/src', 'frontend/src/js'];

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
                const resolve = RAIZES_DE_RESOLUCAO.some((r) => existsSync(join(RAIZ, r, alvo)))
                    || existsSync(join(dirname(join(RAIZ, doc)), alvo));
                if (resolve) continue;
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
            for (const m of texto.matchAll(RE_LINK_DIR)) {
                const alvo = resolve(base, m[1]);
                if (!existsSync(alvo)) quebrados.push(`${doc} → ${m[1]} (diretório)`);
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
