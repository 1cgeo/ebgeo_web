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
//   4. SÍMBOLO citado entre crases que não existe em nenhum lugar do código.
//      Acrescentado em 2026-07-25, e a razão vale mais que a regra: as classes 1 a 3
//      validam o CAMINHO citado e nunca o que ele contém, então uma citação a uma
//      FUNÇÃO inexistente atravessava tudo em silêncio. Foi assim que
//      `.claude/rules/architecture.md` passou meses afirmando que o boot reconecta o
//      último atlas, citando um `reconnectLastAtlas` com zero ocorrências em `src/`,
//      num arquivo carregado como instrução em TODA sessão de agente. A wiki tinha a
//      contradição registrada e pendente; nada quebrava. Na primeira execução esta
//      regra achou dois desses: aquele e o `needsMigration` de
//      `.claude/rules/common-tasks.md`, cuja função real é `detectMigrationNeeded`.

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

// ---------------------------------------------------------------------------
// Símbolo citado na doc que não existe no código (classe 4)
// ---------------------------------------------------------------------------

/** Arquivos de código indexados. Custo medido: ~0,6 s para 1288 arquivos. */
const FONTES_DE_CODIGO = [
    ...['frontend/src', 'backend/src'].flatMap((d) => coletarPorExtensao(d, ['.js', '.css', '.html', '.sql'])),
    ...['frontend/tests', 'backend/tests'].flatMap((d) => coletarPorExtensao(d, ['.js'])),
    // Sem estas raízes o guarda acusa símbolo que existe: TEST_DB_NAME mora em
    // backend/scripts/ e manualChunks em frontend/vite.config.js. Guarda que aponta
    // para o lugar errado treina o leitor a ignorá-lo, que é como um guarda morre.
    ...['frontend/scripts', 'backend/scripts', 'scripts', 'deploy'].flatMap((d) =>
        coletarPorExtensao(d, ['.js', '.mjs', '.yml', '.yaml', '.sh', '.conf'])
    ),
    ...['frontend/vite.config.js', 'frontend/vitest.config.js', 'frontend/eslint.config.js', 'backend/eslint.config.js'],
].filter((f) => existsSync(join(RAIZ, f)));

function coletarPorExtensao(dir, exts, acc = []) {
    const abs = join(RAIZ, dir);
    if (!existsSync(abs)) return acc;
    for (const nome of readdirSync(abs)) {
        if (['node_modules', 'coverage', 'dist', 'vendors'].includes(nome)) continue;
        const rel = `${dir}/${nome}`;
        if (statSync(join(RAIZ, rel)).isDirectory()) coletarPorExtensao(rel, exts, acc);
        else if (exts.some((e) => nome.endsWith(e))) acc.push(rel);
    }
    return acc;
}

/**
 * COMENTÁRIO NÃO CONTA COMO EXISTÊNCIA, e esta linha é a mais importante do bloco.
 *
 * Sem ela o guarda se auto-satisfaz: escrever "`fooBar` não existe" num comentário
 * de código põe `fooBar` no índice, e o guarda passa a afirmar que ele existe. Não é
 * hipótese. Ao documentar a correção dos dois primeiros achados desta regra no
 * comentário DESTE arquivo, os dois sumiram da lista de pendurados. Comentário é
 * 21% dos tokens do repositório (44285 para 34824 ao removê-los), então o efeito é
 * material, não de borda. É a classe `verificacao-fantasma` do livro-razão na sua
 * forma mais traiçoeira: o verificador abençoando exatamente o que devia acusar.
 */
function semComentarios(texto, arquivo) {
    let t = texto.replace(/\/\*[\s\S]*?\*\//g, ' ');
    // `//` só quando não vem colado num `:`, para poupar http:// dentro de string.
    t = t.replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    if (arquivo.endsWith('.sql')) t = t.replace(/--[^\n]*/g, ' ');
    return t;
}

/**
 * Identificador citado sozinho entre crases. Restrito a camelCase com maiúscula
 * interna (`reconnectLastAtlas`) ou SCREAMING_SNAKE (`ATLAS_SCHEMA_VERSION`): essas
 * formas são quase sempre símbolo de código, ao contrário de `atlas` ou `owner`, que
 * são palavras de prosa. Precisão medida em 1272 citações: 14 pendurados, todos
 * legítimos e listados abaixo.
 */
const RE_SIMBOLO = /`([a-z][A-Za-z0-9]*[A-Z][A-Za-z0-9]*|[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)`/g;

/**
 * Símbolos que a doc cita DE PROPÓSITO sem que existam. Cada entrada carrega o
 * motivo, e a lista é útil por si: é o registro dos nomes que as pessoas acreditam
 * existir. Acrescentar uma entrada tem que ser uma decisão, não um reflexo.
 */
const SIMBOLO_INEXISTENTE_DE_PROPOSITO = new Map([
    ['reconnectLastAtlas', 'nome que quatro fontes usavam para um boot que nunca existiu; ver sessao-boot-e-ciclo-de-vida'],
    ['needsMigration', 'nome errado da função real detectMigrationNeeded; a regra cita os dois para quem procurar pelo errado achar'],
    ['migrateToV21', 'contra-exemplo deliberado: o nome real leva underscore (migrateToV2_1)'],
    ['pendingOperations', 'object store de um guia absorvido; a doc diz explicitamente que não existe'],
    ['pendingSince', 'campo do mesmo guia absorvido, idem'],
    ['isOwner', 'gate sugerido por guia absorvido e errado; a página existe para dizer que não se gateia assim'],
    ['hasMore', 'campo de paginação que a busca de usuários NÃO tem, e é esse o ponto do parágrafo'],
    ['COOKIE_SECRET', 'env var que deploy-backend.md registra como inexistente (configurá-la é no-op)'],
    ['USE_HTTPS', 'idem'],
    ['terminationGracePeriodSeconds', 'chave de manifesto do orquestrador, externa a este repositório'],
    ['SQLITE_BUSY', 'código de erro do SQLite, externo'],
    ['formatProject', 'formatador do serviço 360 LEGADO (1cgeo/ebgeo_360), externo a este repositório: é dele que /sv360/projects herda o shape público, e nomeá-lo é o ponto do parágrafo'],
    ['UPPER_SNAKE', 'marcador de convenção de nomenclatura, não um símbolo'],
    ['WIDGET_CREATED', 'evento ilustrativo do exemplo da skill store-op'],
    ['logXxxOperation', 'família de funções (logFeatureOperation, logMapOperation, ...), o Xxx é curinga'],
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

    it('todo símbolo citado entre crases existe em algum lugar do código', () => {
        // As outras regras validam o CAMINHO citado e nunca o que ele contém, então
        // uma citação a uma FUNÇÃO inexistente atravessava tudo em silêncio. Esta
        // fecha isso. O índice é de tokens, não de definições: a pergunta que ela
        // responde é "esse nome aparece em algum código?", que é fraca de propósito.
        // Fraca e suficiente: os dois achados reais na primeira execução eram nomes
        // que não apareciam em lugar NENHUM, e ambos moravam em arquivo de regra
        // carregado como instrução em toda sessão de agente.
        const tokens = new Set();
        for (const f of FONTES_DE_CODIGO) {
            const texto = semComentarios(readFileSync(join(RAIZ, f), 'utf8'), f);
            for (const m of texto.matchAll(/[A-Za-z_$][A-Za-z0-9_$]*/g)) tokens.add(m[0]);
        }
        for (const p of ['package.json', 'frontend/package.json', 'backend/package.json']) {
            if (!existsSync(join(RAIZ, p))) continue;
            for (const m of readFileSync(join(RAIZ, p), 'utf8').matchAll(/[A-Za-z_$][A-Za-z0-9_$-]*/g)) tokens.add(m[0]);
        }
        expect(tokens.size, 'índice de símbolos vazio: a coleta quebrou e o teste passaria vazio').toBeGreaterThan(10000);

        const pendurados = [];
        for (const doc of DOCS) {
            const texto = readFileSync(join(RAIZ, doc), 'utf8');
            for (const m of texto.matchAll(RE_SIMBOLO)) {
                const simbolo = m[1];
                if (tokens.has(simbolo) || SIMBOLO_INEXISTENTE_DE_PROPOSITO.has(simbolo)) continue;
                pendurados.push(`${doc} → \`${simbolo}\``);
            }
        }
        expect(
            pendurados,
            'símbolos citados na doc que não existem no código. Corrija o nome, ou, se a doc'
                + ' cita o nome JUSTAMENTE para dizer que ele não existe, declare-o em'
                + ` SIMBOLO_INEXISTENTE_DE_PROPOSITO com o motivo:\n${[...new Set(pendurados)].join('\n')}`
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
