// Path: tests/unit/paginas-sem-mapa-nao-arrastam-a-store.test.js

/**
 * @fileoverview As TRÊS páginas sem mapa medem ~140 kB cada contra ~3,3 MB do mapa, e essa
 * diferença é uma propriedade de IMPORT, não de intenção: um único `from '@store'`, `from '@utils'`
 * ou `from '@modals'` em qualquer arquivo de `src/js/projects/`, `src/js/admin/` ou
 * `src/js/calibration/` traz a store inteira de volta pelo caminho transitivo (`@utils` →
 * `feature_navigation_utils` → `@store`). Nada estoura, nada avisa: a página continua funcionando e
 * passa a baixar a fundação do mapa.
 *
 * Este arquivo guardava só `atlas.html` e passou a guardar as três em 2026-08-17, quando a fase de
 * permissões mexeu nas três ao mesmo tempo (papel global na barra do admin, gate de produção na
 * calibração). Uma guarda que cobre uma das três páginas e é lida como se cobrisse a classe é
 * exatamente "conferir um subconjunto e tratar como o conjunto", que é a lição mais cara do
 * livro-razão; e o irmão desta guarda, `paginas-sem-mapa-no-canal.test.js`, já varria as três,
 * porém só por import DIRETO no módulo de entrada, que não alcança o caminho transitivo.
 *
 * Por que ESTRUTURAL e não comportamental: os módulos de entrada bootam no import e falam com um
 * backend, então não há como carregá-los num teste de node e perguntar o que eles arrastaram. O
 * grafo de imports é a evidência disponível, e é a evidência certa: é exatamente ele que o Rolldown
 * percorre.
 *
 * DUAS PROPRIEDADES QUE ESTE ARQUIVO PROTEGE E UM `grep` NÃO TERIA:
 *
 *   1. O INVENTÁRIO VEM DO `git ls-files`, nunca de uma lista escrita à mão. Arquivo novo em
 *      qualquer das três pastas entra na varredura sozinho, que é o modo de falha desta classe de
 *      teste (a lista escrita à mão envelhece no commit seguinte e o verde passa a ser sobre outra
 *      coisa).
 *   2. A busca é TRANSITIVA. O defeito quase nunca é a página importar o barril: é ela importar um
 *      módulo que importa outro que importa o barril. Um `grep` nos arquivos da pasta não alcança
 *      isso.
 *
 * CONTROLE DE VÁCUO, e ele é o caso mais importante daqui: o MESMO caminhador, apontado para
 * `src/js/index.js` (a página do mapa), tem que ACHAR os três barris e as dependências pesadas. Sem
 * esse par, um caminhador que resolvesse errado (um alias quebrado, uma regex que não casa)
 * reportaria "nenhum proibido" para sempre, verde e cego.
 */

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const FRONT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** Os aliases do `vite.config.js` / `vitest.config.js`, em cópia mínima (só o mapeamento). */
const ALIASES = Object.freeze({
    '@js': 'src/js',
    '@css': 'src/css',
    '@store': 'src/js/store',
    '@state': 'src/js/state',
    '@utils': 'src/js/utilities',
    '@tools': 'src/js/tool_manager',
    '@toolbar': 'src/js/toolbar',
    '@modals': 'src/js/modals',
    '@sidebar': 'src/js/sidebar',
    '@layers': 'src/js/layers',
    '@catalog': 'src/js/catalog',
    '@ui': 'src/js/ui',
    '@events': 'src/js/events',
    '@': 'src'
});

/** Do mais longo para o mais curto: `@` casaria `@store` se viesse antes. */
const ALIAS_KEYS = Object.keys(ALIASES).sort((a, b) => b.length - a.length);

/**
 * Apaga o CONTEÚDO dos comentários preservando a contagem de linhas, para que prosa citando um
 * `from '...'` não vire uma aresta do grafo. Isto não é zelo: sem ele, o texto de um comentário
 * deste próprio repositório entrou na lista de dependências externas na primeira medição.
 * @param {string} texto
 * @returns {string}
 */
function semComentarios(texto) {
    return texto
        .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
        .replace(/(^|[^:])\/\/[^\n]*/g, (m, antes) => antes + ' '.repeat(m.length - antes.length));
}

const NORM = (p) => p.replace(/\\/g, '/');

/**
 * Resolve um especificador como o bundler resolve: alias, relativo, ou pacote externo.
 * @param {string} spec
 * @param {string} arquivo - Arquivo que fez o import (para o caso relativo).
 * @returns {{file?: string, bare?: string, missing?: string}}
 */
function resolverEspecificador(spec, arquivo) {
    let base = null;
    if (spec.startsWith('.')) {
        base = resolve(dirname(arquivo), spec);
    } else {
        for (const alias of ALIAS_KEYS) {
            if (spec === alias || spec.startsWith(`${alias}/`)) {
                base = resolve(FRONT, ALIASES[alias], spec.slice(alias.length).replace(/^\//, ''));
                break;
            }
        }
    }
    if (base === null) return { bare: spec };
    for (const candidato of [base, `${base}.js`, join(base, 'index.js')]) {
        if (existsSync(candidato) && statSync(candidato).isFile()) return { file: NORM(candidato) };
    }
    return { missing: spec };
}

/**
 * O `[^;'"]*?` do meio (a lista de nomes importados) NÃO pode ser `[\s\S]*?`, e isto foi medido, não
 * suposto: com `[\s\S]` a expansão preguiçosa atravessa a linha atrás do próximo ` from `, então um
 * import de EFEITO COLATERAL (`import '@utils';`, sem lista de nomes) era engolido pelo import
 * seguinte e não virava aresta do grafo. O controle negativo desta guarda — injetar `import
 * '@utils';` numa página sem mapa — passava VERDE por causa disso. Um `[^;'"]` continua atravessando
 * quebra de linha (lista de nomes em várias linhas resolve normalmente), mas para na primeira aspa,
 * que é onde o import de efeito colateral termina.
 */
const RE_ESTATICO = /(?:^|[\s;}])(?:import|export)\s+(?:[^;'"]*?\s+from\s+)?['"]([^'"]+)['"]/g;
const RE_DINAMICO = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

/**
 * Percorre o grafo de imports a partir de um conjunto de raízes.
 * @param {string[]} raizes - Caminhos absolutos.
 * @param {{seguirDinamicos?: boolean}} [options]
 * @returns {{arquivos: Set<string>, externos: Set<string>, naoResolvidos: string[],
 *   pai: Map<string, string>}}
 */
function percorrer(raizes, { seguirDinamicos = true } = {}) {
    const arquivos = new Set();
    const externos = new Set();
    const naoResolvidos = [];
    const pai = new Map();
    const fila = raizes.map(NORM);

    while (fila.length > 0) {
        const arquivo = fila.pop();
        if (arquivos.has(arquivo)) continue;
        arquivos.add(arquivo);
        if (!arquivo.endsWith('.js')) continue;

        const codigo = semComentarios(readFileSync(arquivo, 'utf8'));
        const regexes = seguirDinamicos ? [RE_ESTATICO, RE_DINAMICO] : [RE_ESTATICO];
        for (const regex of regexes) {
            regex.lastIndex = 0;
            let achado;
            while ((achado = regex.exec(codigo)) !== null) {
                const alvo = resolverEspecificador(achado[1], arquivo);
                if (alvo.file) {
                    if (!pai.has(alvo.file)) pai.set(alvo.file, arquivo);
                    fila.push(alvo.file);
                } else if (alvo.bare) {
                    externos.add(alvo.bare);
                } else {
                    naoResolvidos.push(`${arquivo} → ${achado[1]}`);
                }
            }
        }
    }
    return { arquivos, externos, naoResolvidos, pai };
}

/** Caminho de import da raiz até `alvo`, para a mensagem de falha dizer POR ONDE ele entrou. */
function caminhoAte(alvo, pai) {
    const cadeia = [alvo];
    let atual = alvo;
    while (pai.has(atual) && cadeia.length < 30) {
        atual = pai.get(atual);
        cadeia.push(atual);
    }
    return cadeia.reverse().map((p) => p.replace(`${NORM(FRONT)}/`, '')).join('\n  → ');
}

/** Os quatro módulos que a página do mapa carrega e esta não pode carregar. */
const PROIBIDOS = Object.freeze({
    'o barril @store (store/index.js)': /\/src\/js\/store\/index\.js$/,
    'a fachada da store (store/store.js)': /\/src\/js\/store\/store\.js$/,
    'o barril @utils (utilities/index.js)': /\/src\/js\/utilities\/index\.js$/,
    'o barril @modals (modals/index.js)': /\/src\/js\/modals\/index\.js$/
});

/**
 * Raízes: TODO arquivo `.js` que o git enxerga na pasta.
 *
 * `--others --exclude-standard` junto do `--cached` é deliberado: o arquivo que mais precisa desta
 * varredura é o que acabou de ser escrito e ainda não foi commitado. Um inventário só de arquivos
 * versionados deixaria o autor da próxima página fora da guarda exatamente enquanto ele a escreve.
 * @param {string} pasta - Relativa à raiz do pacote.
 * @returns {string[]} Caminhos absolutos normalizados.
 */
function raizesDe(pasta) {
    return execFileSync(
        'git',
        ['ls-files', '--cached', '--others', '--exclude-standard', pasta],
        { cwd: FRONT, encoding: 'utf8' }
    )
        .split('\n')
        .map((linha) => linha.trim())
        .filter((linha) => linha.endsWith('.js'))
        .map((rel) => NORM(resolve(FRONT, rel)));
}

/**
 * As três páginas sem mapa, cada uma com os pisos e as âncoras MEDIDOS, não estimados.
 *
 * `ancoras` são arquivos que o caminhador TEM de alcançar: elas são o controle de que os aliases
 * resolveram de verdade naquela página. Sem elas, um alias quebrado devolveria "nenhum barril
 * encontrado" e o verde seria sobre um grafo vazio.
 *
 * `externos` é lista FECHADA: "não contém tal pacote" aceitaria em silêncio um quilo de dependência
 * nova, e dependência a mais numa destas páginas é decisão, não efeito colateral.
 */
const PAGINAS = Object.freeze([
    {
        pagina: 'atlas.html',
        pasta: 'src/js/projects',
        entradas: ['projects-page.js', 'atlas-drive.js'],
        minRaizes: 4,
        minArquivos: 20,
        ancoras: [
            'src/js/store/local-atlas.api.js',
            'src/js/store/atlas-namespace.js',
            'src/js/utilities/tab-lock.js'
        ],
        externos: ['jszip', 'localforage']
    },
    {
        pagina: 'admin.html',
        pasta: 'src/js/admin',
        entradas: ['admin-page.js', 'catalog-tab.js', 'users-tab.js'],
        minRaizes: 5,
        minArquivos: 15,
        ancoras: [
            'src/js/store/sync/api-client.js',
            'src/js/store/sync/session-context.js',
            'src/js/utilities/tab-lock.js'
        ],
        externos: ['localforage']
    },
    {
        pagina: 'calibracao.html',
        pasta: 'src/js/calibration',
        entradas: ['calibracao-page.js', 'app.js'],
        minRaizes: 8,
        minArquivos: 15,
        ancoras: [
            'src/js/store/sync/api-client.js',
            'src/js/store/sync/session-context.js',
            'src/js/utilities/tab-lock.js',
            // O PONTO ÚNICO do MapLibre, âncora desde 2026-09-04: sem ela, um dia em que o
            // `calibracao-page.js` perdesse esse import a lista de `externos` abaixo voltaria a
            // ser só `localforage` e este arquivo daria VERDE sobre uma página cujo mapa de
            // projeto quebra em `new maplibregl.Map` com um `undefined`.
            'src/js/map/maplibre.js'
        ],
        // OS TRÊS DO MAPLIBRE ENTRARAM EM 2026-09-04, e a lista fechada fez o trabalho dela: ela
        // reprovou a mudança antes de eu editá-la. É decisão, não efeito colateral (decisão do
        // dono, mesma data): a 6.x não publica bundle UMD, então o `<script>` de
        // `public/vendors/maplibre-gl.js` que esta página carregava deixou de existir e a
        // biblioteca passa pelo grafo, pelo ponto único `src/js/map/maplibre.js`.
        //
        // SÃO TRÊS ESPECIFICADORES E NÃO UM, e cada um é uma coisa diferente: o módulo, a folha de
        // estilo do pacote (que substitui a cópia apagada em `public/vendors/maplibre-gl.css`) e a
        // URL do worker por `?worker&url`, sem a qual o Vite resolve o worker dentro de
        // `node_modules/.vite/deps` e o mapa sobe SEM TILE NENHUM, calado.
        //
        // O que NÃO mudou, e é o assunto deste arquivo: a página continua sem alcançar um só
        // barril (`@store`, `@utils`, `@modals`) nem uma ferramenta do mapa. Biblioteca de
        // renderização não é a aplicação.
        externos: [
            'localforage',
            'maplibre-gl',
            'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url',
            'maplibre-gl/dist/maplibre-gl.css'
        ]
    }
]);

describe('a lista acima cobre TODA página sem mapa, e o inventário dela vem do disco', () => {
    // Sem este bloco, uma quinta página HTML nasceria fora da guarda e nada ficaria vermelho: a
    // varredura continuaria completa sobre as três pastas que ela conhece, que é a forma silenciosa
    // desta classe de teste envelhecer. (`calibracao-pagina.test.js` também conta as entradas do
    // Vite, e por outro motivo: lá o assunto é a página entrar no build.)
    const HTMLS = readdirSync(FRONT).filter((f) => f.endsWith('.html'));

    it('cada página HTML ou é o mapa, ou tem uma pasta vigiada aqui', () => {
        expect(HTMLS.sort()).toEqual(['admin.html', 'atlas.html', 'calibracao.html', 'index.html']);

        const vigiadas = PAGINAS.map((p) => p.pasta);
        for (const html of HTMLS) {
            const modulo = readFileSync(join(FRONT, html), 'utf8')
                .match(/<script\s+type="module"\s+src="\/(src\/js\/[^"]+)"/);
            expect(modulo, `${html} não declara um módulo de entrada`).not.toBeNull();

            if (html === 'index.html') {
                // O mapa é o controle: ele é a única página que PODE arrastar a store.
                expect(modulo[1]).toBe('src/js/index.js');
                continue;
            }
            const pasta = modulo[1].split('/').slice(0, -1).join('/');
            expect(vigiadas, `${html} entra por ${pasta}, que não está vigiada`).toContain(pasta);
        }
    });

    it('e cada pasta vigiada é a de uma página que existe', () => {
        // O outro sentido da mesma igualdade: pasta vigiada que não é entrada de página nenhuma é
        // varredura sobre código morto, e ela dá o mesmo verde.
        expect(PAGINAS).toHaveLength(HTMLS.length - 1);
    });
});

describe.each(PAGINAS)('$pagina ($pasta): o grafo de imports não alcança a store do mapa',
    ({ pasta, entradas, minRaizes, minArquivos, ancoras, externos }) => {
        const raizes = raizesDe(pasta);
        const grafo = percorrer(raizes);

        it('o inventário vem do git, e nenhum arquivo some da varredura', () => {
            // Cobertura vazia é o modo de falha desta classe: um `git ls-files` que devolvesse nada
            // deixaria todos os casos abaixo verdes sem verificar arquivo nenhum.
            expect(raizes.length).toBeGreaterThanOrEqual(minRaizes);
            const nomes = raizes.map((p) => p.split('/').pop());
            for (const entrada of entradas) expect(nomes, `faltou ${entrada}`).toContain(entrada);
            for (const raiz of raizes) expect(existsSync(raiz), `${raiz} não existe`).toBe(true);
        });

        it('o caminhador resolveu TUDO (um alias quebrado esconderia o proibido)', () => {
            // Um especificador não resolvido é um ramo do grafo que não foi percorrido, e um ramo
            // não percorrido é exatamente onde um barril passaria despercebido.
            expect(grafo.naoResolvidos).toEqual([]);
            // E ele de fato entrou na store pelos ARQUIVOS permitidos, que é o que prova que o
            // alias `@store` resolve: sem esta linha, um alias quebrado devolveria "nenhum
            // proibido".
            const alcancados = [...grafo.arquivos].map((p) => p.replace(`${NORM(FRONT)}/`, ''));
            for (const ancora of ancoras) expect(alcancados, `não alcançou ${ancora}`).toContain(ancora);
            expect(grafo.arquivos.size).toBeGreaterThan(minArquivos);
        });

        for (const [rotulo, padrao] of Object.entries(PROIBIDOS)) {
            it(`não alcança ${rotulo}`, () => {
                const achados = [...grafo.arquivos].filter((f) => padrao.test(f));
                const detalhe = achados.map((f) => caminhoAte(f, grafo.pai)).join('\n\n');
                expect(achados, `entrou por:\n  ${detalhe}`).toEqual([]);
            });
        }

        it('as dependências externas são exatamente as declaradas aqui', () => {
            expect([...grafo.externos].sort()).toEqual([...externos].sort());
        });
    });

describe('atlas.html: a dependência pesada é sob demanda', () => {
    const raizes = raizesDe('src/js/projects');

    it('o JSZip só entra por `import()` dinâmico', () => {
        // O JSZip (~100 kB) só entra pela ENTRADA da página por `import()` dinâmico ("Importar
        // .ebgeo"): no grafo ansioso do entry ele não existe. É por isso que o caminho deslogado
        // usa `ebgeo-filename.js`, que não importa nada — tirar a extensão de um nome de arquivo
        // não pode custar um descompactador.
        const entry = NORM(resolve(FRONT, 'src/js/projects/projects-page.js'));
        expect(raizes).toContain(entry);
        const ansioso = percorrer([entry], { seguirDinamicos: false });
        expect([...ansioso.externos].sort()).toEqual(['localforage']);
        // Controle: seguindo o dinâmico, a MESMA raiz alcança o JSZip. Sem esta linha, um
        // caminhador que ignorasse `import()` por acidente deixaria o caso acima verde.
        expect([...percorrer([entry]).externos].sort()).toEqual(['jszip', 'localforage']);
    });
});

describe('CONTROLE DE VÁCUO: o mesmo caminhador, apontado para a página do MAPA', () => {
    // Sem este bloco, todos os verdes acima seriam indistinguíveis de um caminhador que não
    // caminha. A página do mapa importa os três barris e o MapLibre de propósito, então ela é o
    // controle positivo do instrumento.
    const grafoDoMapa = percorrer([NORM(resolve(FRONT, 'src/js/index.js'))]);

    it('acha os três barris, as dependências pesadas e um grafo uma ordem de grandeza maior', () => {
        for (const [rotulo, padrao] of Object.entries(PROIBIDOS)) {
            const achou = [...grafoDoMapa.arquivos].some((f) => padrao.test(f));
            expect(achou, `o caminhador NÃO achou ${rotulo} na página do mapa`).toBe(true);
        }
        // O MapLibre NÃO aparece aqui, e não é falha do instrumento: ele vem por `<script>` de
        // vendor (`window.maplibregl`), então as únicas menções a `maplibre-gl` no código-fonte
        // são tipos de JSDoc, que o limpador de comentários apaga. As pesadas que de fato viajam
        // pelo grafo são estas.
        for (const pacote of ['quill', 'jspdf', 'dompurify']) {
            expect([...grafoDoMapa.externos], `faltou ${pacote}`).toContain(pacote);
        }
        expect(grafoDoMapa.arquivos.size).toBeGreaterThan(400);
    });
});
