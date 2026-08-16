// Path: tests/unit/projetos-nao-arrasta-a-store.test.js

/**
 * @fileoverview `projetos.html` mede ~140 kB contra ~3,3 MB do mapa, e essa diferença é uma
 * propriedade de IMPORT, não de intenção: um único `from '@store'`, `from '@utils'` ou
 * `from '@modals'` em qualquer arquivo de `src/js/projects/` traz a store inteira de volta pelo
 * caminho transitivo (`@utils` → `feature_navigation_utils` → `@store`). Nada estoura, nada
 * avisa: a página continua funcionando e passa a baixar a fundação do mapa.
 *
 * Por que ESTRUTURAL e não comportamental: os módulos de entrada bootam no import e falam com um
 * backend, então não há como carregá-los num teste de node e perguntar o que eles arrastaram. O
 * grafo de imports é a evidência disponível, e é a evidência certa: é exatamente ele que o Rolldown
 * percorre.
 *
 * DUAS PROPRIEDADES QUE ESTE ARQUIVO PROTEGE E UM `grep` NÃO TERIA:
 *
 *   1. O INVENTÁRIO VEM DO `git ls-files`, nunca de uma lista escrita à mão. Arquivo novo em
 *      `projects/` entra na varredura sozinho, que é o modo de falha desta classe de teste (a lista
 *      escrita à mão envelhece no commit seguinte e o verde passa a ser sobre outra coisa).
 *   2. A busca é TRANSITIVA. O defeito quase nunca é a página importar o barril: é ela importar um
 *      módulo que importa outro que importa o barril. Um `grep` nos quatro arquivos da pasta não
 *      alcança isso, e a constituição já pagou por conferir um subconjunto como se fosse o conjunto.
 *
 * CONTROLE DE VÁCUO, e ele é o caso mais importante daqui: o MESMO caminhador, apontado para
 * `src/js/index.js` (a página do mapa), tem que ACHAR os três barris e o `maplibre-gl`. Sem esse
 * par, um caminhador que resolvesse errado (um alias quebrado, uma regex que não casa) reportaria
 * "nenhum proibido" para sempre, verde e cego.
 */

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, statSync } from 'node:fs';
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

const RE_ESTATICO = /(?:^|[\s;}])(?:import|export)\s+(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/g;
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
 * Raízes: TODO arquivo de `src/js/projects/` que o git enxerga.
 *
 * `--others --exclude-standard` junto do `--cached` é deliberado: o arquivo que mais precisa desta
 * varredura é o que acabou de ser escrito e ainda não foi commitado. Um inventário só de arquivos
 * versionados deixaria o autor da próxima página fora da guarda exatamente enquanto ele a escreve.
 */
const RAIZES = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', 'src/js/projects'],
    { cwd: FRONT, encoding: 'utf8' }
)
    .split('\n')
    .map((linha) => linha.trim())
    .filter((linha) => linha.endsWith('.js'))
    .map((rel) => NORM(resolve(FRONT, rel)));

describe('projetos.html: o inventário vem do git, não de uma lista escrita aqui', () => {
    it('acha os arquivos de src/js/projects/ e nenhum deles some da varredura', () => {
        // Cobertura vazia é o modo de falha desta classe: um `git ls-files` que devolvesse nada
        // deixaria todos os casos abaixo verdes sem verificar arquivo nenhum.
        expect(RAIZES.length).toBeGreaterThanOrEqual(4);
        const nomes = RAIZES.map((p) => p.split('/').pop());
        expect(nomes).toContain('projects-page.js');
        expect(nomes).toContain('atlas-drive.js');
        for (const raiz of RAIZES) expect(existsSync(raiz), `${raiz} não existe`).toBe(true);
    });
});

describe('projetos.html: o grafo de imports não alcança a store do mapa', () => {
    const grafo = percorrer(RAIZES);

    it('o caminhador resolveu TUDO (um alias quebrado esconderia o proibido)', () => {
        // Um especificador não resolvido é um ramo do grafo que não foi percorrido, e um ramo não
        // percorrido é exatamente onde um barril passaria despercebido.
        expect(grafo.naoResolvidos).toEqual([]);
        // E ele de fato entrou na store pelos ARQUIVOS permitidos, que é o que prova que o alias
        // `@store` resolve: sem esta linha, um alias quebrado devolveria "nenhum proibido".
        const alcancados = [...grafo.arquivos].map((p) => p.replace(`${NORM(FRONT)}/`, ''));
        expect(alcancados).toContain('src/js/store/local-atlas.api.js');
        expect(alcancados).toContain('src/js/store/atlas-namespace.js');
        expect(alcancados).toContain('src/js/utilities/tab-lock.js');
        expect(grafo.arquivos.size).toBeGreaterThan(20);
    });

    for (const [rotulo, padrao] of Object.entries(PROIBIDOS)) {
        it(`não alcança ${rotulo}`, () => {
            const achados = [...grafo.arquivos].filter((f) => padrao.test(f));
            const detalhe = achados.map((f) => caminhoAte(f, grafo.pai)).join('\n\n');
            expect(achados, `entrou por:\n  ${detalhe}`).toEqual([]);
        });
    }

    it('as dependências externas são exatamente duas, e a pesada é sob demanda', () => {
        // ABSOLUTO de propósito: uma lista "não contém tal pacote" aceitaria em silêncio um quilo
        // de dependência nova. Dependência a mais nesta página é uma decisão, e uma decisão tem que
        // parar aqui.
        expect([...grafo.externos].sort()).toEqual(['jszip', 'localforage']);

        // E o JSZip (~100 kB) só entra pela ENTRADA da página por `import()` dinâmico ("Importar
        // .ebgeo"): no grafo ansioso do entry ele não existe. É por isso que o caminho deslogado
        // usa `ebgeo-filename.js`, que não importa nada — tirar a extensão de um nome de arquivo
        // não pode custar um descompactador.
        const entry = NORM(resolve(FRONT, 'src/js/projects/projects-page.js'));
        expect(RAIZES).toContain(entry);
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
