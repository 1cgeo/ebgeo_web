// Path: dev/testes-tocados.mjs

/**
 * @fileoverview OS TESTES DO QUE MUDOU, e a suíte inteira só quando a mudança pede.
 *
 * Decisão do dono em 2026-09-24: a suíte da raiz custa cerca de 19 minutos, 16 deles no
 * backend, e rodá-la a cada commit de frontend era pagar 16 minutos por nada. A regra passou a
 * ser (docs/decisions/decisions-2026.md):
 *
 *   - mudou frontend, documentação ou instrução de agente -> `npm run test:frontend` (~1 min,
 *     sem banco; é ali que moram os censos, a integridade da documentação e o guarda dos
 *     scripts da raiz);
 *   - mudou backend -> os testes do backend que miram o que mudou, numa rodada hermética só
 *     (um banco); a suíte inteira do backend quando o alvo passa do teto, quando um arquivo
 *     tocado não é mirado por teste nenhum, ou quando a mudança é de infraestrutura do pacote;
 *   - mudou CONTRATO entre os pacotes, ou código dos dois pacotes -> `npm test` da raiz.
 *
 * COMO UM TESTE DO BACKEND "MIRA" UM ARQUIVO, e por que não é só o grafo de import. O grafo
 * sozinho dizia que 487 dos 635 testes alcançam qualquer serviço (medido em 2026-09-24): o
 * helper `tests/helpers/setup.js` importa `src/app.js`, que monta todas as rotas. Então o grafo
 * é CORTADO nos pontos de composição (`HUBS`), e o que ele passa a achar são os testes que
 * importam o módulo, direta ou transitivamente, sem passar pela aplicação montada. Os testes de
 * integração falam com o módulo por HTTP, e esses entram por AFINIDADE DE NOME: um arquivo de
 * `src/modules/<mod>/` mira os testes cujo nome carrega `<mod>` (ou um dos `APELIDOS`).
 *
 * A decisão é uma função pura (`planejar`), testada em
 * `frontend/tests/unit/testes-tocados.test.js`; o resto deste arquivo só lê o git e roda o que
 * ela manda. O lint continua sendo o outro comando, separado, como sempre.
 *
 * O QUE ELE NÃO SABE, declarado: o grafo só segue import relativo escrito com literal; a
 * afinidade é por nome, então um teste de integração de outro módulo que exercite este por
 * tabela não é mirado; e o contrato é uma lista escrita aqui, não uma propriedade medida. Os
 * três buracos fecham na rodada completa, obrigatória antes de deploy e de levar à main.
 *
 * Uso (da raiz):  npm run test:tocados            -> planeja e roda
 *                 npm run test:tocados -- --plano -> só mostra o plano
 *                 npm run test:tocados -- --desde origin/main
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Caminhos cuja mudança é contrato entre os dois pacotes: pede a suíte da raiz inteira. */
export const CONTRATO = Object.freeze([
    /^frontend\/src\/js\/store\/sync\//,
    /^backend\/src\/modules\/sync\//,
    /^frontend\/src\/js\/config\.js$/,
    /^backend\/src\/modules\/config\//,
    /^backend\/src\/utils\/roles\.js$/,
    /^frontend\/src\/js\/projects\/permission-levels\.js$/,
    /\/(origens-de-erro|estados-de-defeito|eventos-de-uso|ambiente-do-navegador)\.js$/,
    /^backend\/src\/database\/migrations\//,
    /^frontend\/tests\/e2e\//,
]);

/** Pontos de composição: o grafo não atravessa, porque por eles tudo alcança tudo. */
export const HUBS = Object.freeze(['backend/src/app.js', 'backend/src/index.js']);

/** Módulos cujos testes usam outro nome. Cada entrada é uma palavra do nome do arquivo de teste. */
export const APELIDOS = Object.freeze({
    streetview360: ['sv360'],
    'resource-access': ['recurso', 'emprestimo', 'concessao', 'concessoes'],
    'catalog-video': ['video'],
});

/** Acima deste número de arquivos de teste, a suíte inteira do backend sai mais barata. */
export const TETO_DE_ALVOS_DO_BACKEND = 80;

const eCodigoDoFrontend = (p) => /^frontend\/(src|tests)\//.test(p) && !/^frontend\/tests\/e2e-ui\//.test(p);
const eCodigoDoBackend = (p) => /^backend\/(src|tests)\//.test(p);

/**
 * Resolve os imports relativos de um arquivo do backend.
 * @param {string} arquivo - Caminho relativo à raiz, com barras
 * @param {string} fonte - Conteúdo do arquivo
 * @returns {string[]} Caminhos relativos à raiz
 */
export function importsRelativos(arquivo, fonte) {
    const saida = [];
    const re = /(?:from\s+|import\s*\(\s*)['"](\.{1,2}\/[^'"]+)['"]/g;
    let m;
    while ((m = re.exec(fonte))) saida.push(posix.normalize(posix.join(posix.dirname(arquivo), m[1])));
    return saida;
}

/**
 * Os testes do backend que alcançam cada arquivo pelo grafo de import, sem atravessar os HUBS.
 * @param {Map<string, string>} fontes - Todo arquivo `.js` de `backend/src` e `backend/tests`
 * @param {readonly string[]} [hubs]
 * @returns {Map<string, Set<string>>} arquivo -> testes que o alcançam
 */
export function testesPorArquivo(fontes, hubs = HUBS) {
    const arestas = new Map([...fontes].map(([arq, fonte]) => [arq, hubs.includes(arq) ? [] : importsRelativos(arq, fonte)]));
    const alcancam = new Map();
    for (const teste of [...fontes.keys()].filter((a) => a.endsWith('.test.js'))) {
        const vistos = new Set();
        const pilha = [teste];
        while (pilha.length) {
            const atual = pilha.pop();
            if (vistos.has(atual)) continue;
            vistos.add(atual);
            for (const prox of arestas.get(atual) ?? []) if (fontes.has(prox)) pilha.push(prox);
        }
        for (const arq of vistos) {
            if (!alcancam.has(arq)) alcancam.set(arq, new Set());
            alcancam.get(arq).add(teste);
        }
    }
    return alcancam;
}

/**
 * Os testes cujo NOME carrega o módulo (ou um apelido dele) como sequência de palavras.
 * @param {string} modulo - Pasta de `backend/src/modules/`
 * @param {string[]} testes - Caminhos dos arquivos de teste
 * @returns {string[]}
 */
export function testesPorAfinidade(modulo, testes) {
    const nomes = [modulo, ...(APELIDOS[modulo] ?? [])];
    return testes.filter((t) => {
        const base = `-${posix.basename(t).replace(/\.test\.js$/, '').replace(/[._]/g, '-')}-`;
        return nomes.some((n) => base.includes(`-${n}-`));
    });
}

/**
 * O plano: o que rodar para um conjunto de arquivos tocados.
 * @param {string[]} tocados - Caminhos relativos à raiz, com barras
 * @param {Map<string, Set<string>>} alcance - Saída de `testesPorArquivo`
 * @param {string[]} [testesDoBackend] - Todos os arquivos de teste do backend (para a afinidade)
 * @returns {{raiz: boolean, frontend: boolean, backend: null|'tudo'|string[], motivos: string[]}}
 */
export function planejar(tocados, alcance, testesDoBackend = []) {
    const motivos = [];
    const plano = { raiz: false, frontend: false, backend: null, motivos };
    if (tocados.length === 0) {
        motivos.push('nada mudou');
        return plano;
    }
    const contrato = tocados.filter((p) => CONTRATO.some((re) => re.test(p)));
    const cruza = tocados.some(eCodigoDoFrontend) && tocados.some(eCodigoDoBackend);
    if (contrato.length || cruza) {
        plano.raiz = true;
        if (contrato.length) motivos.push(`contrato entre os pacotes: ${contrato.join(', ')}`);
        if (cruza) motivos.push('código dos dois pacotes no mesmo conjunto');
        return plano;
    }
    const doBackend = tocados.filter((p) => p.startsWith('backend/'));
    const doResto = tocados.filter((p) => !p.startsWith('backend/'));
    if (doResto.length) {
        plano.frontend = true;
        motivos.push(`frontend, documentação ou instrução: ${doResto.length} arquivo(s)`);
    }
    if (!doBackend.length) return plano;

    const infra = doBackend.filter((p) => !eCodigoDoBackend(p) || !p.endsWith('.js') || HUBS.includes(p));
    if (infra.length) {
        plano.backend = 'tudo';
        motivos.push(`infraestrutura ou composição do backend: ${infra.join(', ')}`);
        return plano;
    }
    const alvos = new Set();
    const orfaos = [];
    for (const p of doBackend) {
        if (p.endsWith('.test.js')) { alvos.add(p); continue; }
        const modulo = p.match(/^backend\/src\/modules\/([^/]+)\//)?.[1];
        const mirados = new Set([...(alcance.get(p) ?? []), ...(modulo ? testesPorAfinidade(modulo, testesDoBackend) : [])]);
        if (mirados.size === 0) orfaos.push(p);
        for (const t of mirados) alvos.add(t);
    }
    if (orfaos.length) {
        plano.backend = 'tudo';
        motivos.push(`nenhum teste mira: ${orfaos.join(', ')}`);
    } else if (alvos.size > TETO_DE_ALVOS_DO_BACKEND) {
        plano.backend = 'tudo';
        motivos.push(`${alvos.size} testes do backend miram o que mudou (teto ${TETO_DE_ALVOS_DO_BACKEND})`);
    } else {
        plano.backend = [...alvos].sort();
        motivos.push(`backend: ${alvos.size} arquivo(s) de teste miram o que mudou`);
    }
    return plano;
}

/**
 * O padrão único que o runner do backend recebe: um arquivo, ou um glob com chaves.
 * @param {string[]} alvos - Caminhos relativos à raiz (`backend/tests/...`)
 * @returns {string}
 */
export function padraoDoBackend(alvos) {
    const rel = alvos.map((a) => a.replace(/^backend\//, ''));
    return rel.length === 1 ? rel[0] : `{${rel.join(',')}}`;
}

// --------------------------------------------------------------------------------------------
// O resto lê o git e roda o plano. Nada abaixo é chamado por quem importa este arquivo.
// --------------------------------------------------------------------------------------------

function git(...args) {
    return execFileSync('git', args, { cwd: RAIZ, encoding: 'utf8' }).split(/\r?\n/).filter(Boolean);
}

function arquivosTocados(desde) {
    const tocados = new Set([...git('diff', '--name-only', 'HEAD'), ...git('ls-files', '--others', '--exclude-standard')]);
    let base = desde;
    if (!base) {
        try { base = git('rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}')[0]; } catch { base = null; }
    }
    if (base) for (const p of git('diff', '--name-only', `${base}...HEAD`)) tocados.add(p);
    // A deleted file stays in the set: removing code is a change its tests must see.
    return [...tocados].sort();
}

function fontesDoBackend() {
    const fontes = new Map();
    for (const p of git('ls-files', 'backend/src', 'backend/tests')) {
        if (p.endsWith('.js')) fontes.set(p, readFileSync(join(RAIZ, p), 'utf8'));
    }
    return fontes;
}

/** Runs one step. npm goes through the shell (Windows needs it for npm.cmd); node never does. */
function rodar({ rotulo, comando, args, cwd, shell }) {
    console.log(`\n> ${rotulo}`);
    const r = spawnSync(comando, args, { cwd, stdio: 'inherit', shell });
    return r.status ?? 1;
}

function principal(argv) {
    const soPlano = argv.includes('--plano');
    const i = argv.indexOf('--desde');
    const desde = i >= 0 ? argv[i + 1] : null;
    const tocados = arquivosTocados(desde);
    const fontes = fontesDoBackend();
    const testes = [...fontes.keys()].filter((p) => p.endsWith('.test.js'));
    const plano = planejar(tocados, testesPorArquivo(fontes), testes);

    console.log(`Arquivos tocados: ${tocados.length}`);
    for (const m of plano.motivos) console.log(`  - ${m}`);
    const npm = (args) => ({ rotulo: `npm ${args.join(' ')}`, comando: 'npm', args, cwd: RAIZ, shell: process.platform === 'win32' });
    const passos = [];
    if (plano.raiz) passos.push(npm(['test']));
    if (plano.frontend) passos.push(npm(['run', 'test:frontend']));
    if (plano.backend === 'tudo') passos.push(npm(['run', 'test:backend']));
    else if (Array.isArray(plano.backend)) {
        // Straight to node, not through npm: the brace glob carries commas, and cmd.exe splits
        // a batch file's arguments on them.
        const padrao = padraoDoBackend(plano.backend);
        passos.push({
            rotulo: `backend: node scripts/run-tests.js (${plano.backend.length} arquivo(s))`,
            comando: process.execPath, args: ['scripts/run-tests.js', padrao], cwd: join(RAIZ, 'backend'), shell: false,
        });
    }
    console.log(`Plano: ${passos.length ? passos.map((p) => p.rotulo).join(' ; ') : 'nada a rodar'}`);
    if (soPlano) return 0;

    let pior = 0;
    for (const passo of passos) {
        const status = rodar(passo);
        if (status !== 0) { pior = status; break; }
    }
    console.log(`\nTESTES_TOCADOS_EXIT=${pior}`);
    return pior;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    process.exitCode = principal(process.argv.slice(2));
}
