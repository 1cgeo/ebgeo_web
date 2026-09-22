// Path: tests/unit/configs-do-playwright-coletam-o-guarda.test.js
//
// CENSO: todo config do Playwright COLETA o guarda do "verde por pulo".
//
// `tests/e2e-ui/_backend-required.spec.js` é o único spec da camada de navegador sem gate: os
// outros são `state.skip ? test.describe.skip : test.describe` (ou herdam o mesmo gate do fixture
// `collabTest`), de modo que sem Postgres a rodada inteira pula e fecha VERDE tendo dirigido zero.
// O guarda reprova nessa condição. Só que ele reprova na rodada em que é COLETADO, e a coleta é
// decidida pelo `testMatch` de CADA config, não pela existência do arquivo.
//
// POR QUE ESTE ARQUIVO EXISTE, e é uma fresta exata: `guarda-de-e2e-nao-pula.test.js` afirma que
// os dois arquivos de guarda EXISTEM e que não se gateiam, e nunca pergunta se algum config os
// recolhe. Enquanto houve um config só, as duas perguntas eram a mesma; hoje são SEIS, e cinco
// deles trocam o `testMatch` do base. MEDIDO em 2026-09-22, com `npx playwright test --config=<c>
// --list`: `playwright.config.js` e `playwright.tablet.config.js` traziam o guarda, e os quatro
// configs de cenário traziam ZERO. O de tablet só o tem porque alguém lembrou, à mão, em
// 2026-09-21; lembrar é o que este censo substitui.
//
// O QUE O VERDE DAQUI NÃO PROVA, e a honestidade custa pouco:
//   - o falso verde NÃO estava alcançável em três dos quatro cenários, porque cada `*.scenario.js`
//     carrega um `test.beforeAll` escrito à mão que assere `readState().skip === false`. MEDIDO em
//     2026-09-22, com Postgres fora (`DB_PORT=1`): `playwright.atlas-safety.config.js` já saía com
//     código 1 ("1 failed, 2 did not run"). O que o guarda acrescenta é MECÂNICO no lugar de
//     manual, e a diferença tem um beneficiário: `release-production.scenario.js` é a única cena
//     SEM essa asserção, e o que a protege hoje é o `globalSetup` próprio dela
//     (`tests/e2e-ui/release-production-setup.js`) derrubar a rodada em vez de gravar `skip: true`.
//     Um `catch` acrescentado ali abriria o falso verde sem nada ficar vermelho.
//   - o opt-out deliberado `EBGEO_E2E_ALLOW_SKIP=1` continua legítimo e sem cobrança.
//   - este censo lê `testMatch`/`testIgnore`; ele NÃO verifica que o `globalSetup` daquele config
//     escreve o MESMO arquivo de estado que `readState()` lê. Os dois `globalSetup` do repositório
//     importam `STATE_FILE` de `tests/e2e-ui/constants.js`, o que se confere lendo, não daqui.
//
// A LEITURA É DO CONFIG RESOLVIDO, não do texto. Importar o módulo entrega o objeto DEPOIS do
// spread do base, e isso é o que permite cobrar as duas metades: `testMatch` precisa casar o
// guarda e `testIgnore` não pode casá-lo. A metade do `testIgnore` não é teórica — é literalmente
// o que o config de tablet teve de sobrescrever para não ignorar as próprias specs, e nela
// `testIgnore` vence `testMatch`.

import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

/** O caminho do guarda como o Playwright o vê ao casar padrão (separador POSIX). */
const GUARDA = 'tests/e2e-ui/_backend-required.spec.js';

/**
 * O inventário DECLARADO. Ele não existe para escolher quem é cobrado (a regra vale para todos),
 * e sim para que um config NOVO seja uma decisão: ele reprova aqui até alguém escrever o que é.
 * `exigeAcervo` marca os dois que LANÇAM na importação sem `EBGEO_MIGRATION_DATA_DIR`, o que é
 * deliberado (nenhuma rodada normal pode depender do acervo externo de alguém).
 */
const CONFIGS = new Map([
    ['frontend/playwright.config.js', { papel: 'a rodada normal (test:e2e:ui); o testMatch catch-all já traz o guarda' }],
    ['frontend/playwright.tablet.config.js', { papel: 'a camada de toque (test:e2e:tablet)' }],
    ['frontend/playwright.atlas-safety.config.js', { papel: 'cenário: segurança do dado de atlas (test:e2e:atlas)' }],
    ['frontend/playwright.migration-data.config.js', { papel: 'cenário: acervo externo de migração (test:e2e:migracao)', exigeAcervo: true }],
    ['frontend/playwright.release-checks.config.js', { papel: 'cenário: interrupção no meio de gestos de release' }],
    ['frontend/playwright.release-production.config.js', { papel: 'cenário: pacote de produção sobre HTTPS', exigeAcervo: true }],
]);

/**
 * Glob -> RegExp no recorte que estes configs usam (`**\/`, `*` e literais). Não há biblioteca de
 * glob DECLARADA neste pacote (`picomatch`/`minimatch` existem em `node_modules` como extraneous,
 * trazidas por dependência de dependência), e depender de uma delas é depender de algo que um
 * `npm install` alheio pode levar embora. Por ser verificador escrito em casa, ele tem par de
 * controle abaixo; e a sua resposta foi conferida por um caminho INDEPENDENTE, que é a coleta real
 * do Playwright: em 2026-09-22 o `--list` dos seis configs concordou com este censo, caso a caso.
 */
function paraRegExp(padrao) {
    // As duas marcas são da área de uso privado do Unicode (nenhum glob as contém) e existem para
    // tirar `**` do caminho antes de `*` ser traduzido; caractere de controle aqui é o que o
    // `no-control-regex` do ESLint recusa, com razão.
    const GLOBSTAR_BARRA = '';
    const GLOBSTAR = '';
    const corpo = padrao
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*\*\//g, GLOBSTAR_BARRA)
        .replace(/\*\*/g, GLOBSTAR)
        .replace(/\*/g, '[^/]*')
        .replaceAll(GLOBSTAR_BARRA, '(?:[^/]*/)*')
        .replaceAll(GLOBSTAR, '.*');
    return new RegExp(`^${corpo}$`);
}

const casa = (padrao, caminho) => paraRegExp(padrao).test(caminho);

/** `testMatch`/`testIgnore` aceitam string, RegExp ou array; aqui vira sempre lista de strings. */
function padroes(valor) {
    if (valor === undefined || valor === null) return [];
    return (Array.isArray(valor) ? valor : [valor]).map(String);
}

/** Os configs versionados OU ainda não commitados: quem nasce entra no censo no mesmo dia. */
function inventario() {
    let saida;
    try {
        saida = execSync('git ls-files --cached --others --exclude-standard "frontend/playwright*.config.js"', {
            cwd: RAIZ,
            encoding: 'utf8',
        });
    } catch (err) {
        throw new Error(`o inventário deste censo vem de "git ls-files" e o comando FALHOU (${err.message}). `
            + 'Sem inventário não há censo: conserte o comando em vez de afrouxar o piso.');
    }
    return [...new Set(saida.split('\n').map((l) => l.trim()).filter(Boolean))].sort();
}

/** Importa o config RESOLVIDO (por file URL, fora do transform do Vite, que é como o Node o lê). */
async function carregar(rel) {
    const mod = await import(/* @vite-ignore */ pathToFileURL(join(RAIZ, rel)).href);
    return mod.default;
}

describe('todo config do Playwright coleta o guarda de "o e2e não pulou"', () => {
    it('CONTROLE do casador de glob: ele casa e, principalmente, ele RECUSA', () => {
        // Sem este par, um `casa()` que devolvesse `true` sempre faria a metade do `testMatch`
        // passar por vacuidade, e um que devolvesse `false` sempre faria a metade do `testIgnore`
        // passar do mesmo jeito. As duas direções precisam ser medidas.
        expect(casa('**/_backend-required.spec.js', GUARDA)).toBe(true);
        expect(casa('**/_backend-required.spec.js', '_backend-required.spec.js')).toBe(true);
        expect(casa('**/*.spec.js', GUARDA)).toBe(true);
        expect(casa('**/*.tablet.spec.js', GUARDA)).toBe(false);
        expect(casa('**/atlas-data-safety.scenario.js', GUARDA)).toBe(false);
        expect(casa('**/*.spec.js', 'tests/e2e-ui/atlas-data-safety.scenario.js')).toBe(false);
        // O ponto é LITERAL: sem escapá-lo, `a.spec.js` casaria `axspec.js` e o censo passaria a
        // aceitar arquivo que não existe.
        expect(casa('**/a.spec.js', 'tests/e2e-ui/axspec.js')).toBe(false);
        // `*` não atravessa separador.
        expect(casa('*.spec.js', GUARDA)).toBe(false);
    });

    it('o guarda existe: os padrões abaixo não estão casando um arquivo fantasma', () => {
        expect(existsSync(join(RAIZ, 'frontend', GUARDA))).toBe(true);
    });

    it('o inventário do git bate EXATAMENTE com o declarado; config novo reprova até ser classificado', () => {
        const achados = inventario();
        // Piso de vácuo: um `git ls-files` que devolvesse vazio deixaria o `it` seguinte verde sem
        // ter olhado um único config.
        expect(achados.length).toBeGreaterThanOrEqual(6);
        expect(achados).toEqual([...CONFIGS.keys()].sort());
        for (const [rel, { papel }] of CONFIGS) {
            expect(typeof papel, `${rel} entrou no censo sem dizer o que é`).toBe('string');
            expect(papel.length).toBeGreaterThan(10);
        }
    });

    it('cada config casa o guarda no testMatch e NÃO o exclui no testIgnore', async () => {
        // Os dois configs de acervo lançam na importação sem esta variável, de propósito. Apontá-la
        // para um diretório qualquer é leitura pura: nada aqui abre o acervo.
        const anterior = process.env.EBGEO_MIGRATION_DATA_DIR;
        process.env.EBGEO_MIGRATION_DATA_DIR = anterior || RAIZ;
        try {
            const semGuarda = [];
            const excluindo = [];
            for (const rel of CONFIGS.keys()) {
                const config = await carregar(rel);
                const recolhe = padroes(config.testMatch).some((p) => casa(p, GUARDA));
                const ignora = padroes(config.testIgnore).some((p) => casa(p, GUARDA));
                if (!recolhe) semGuarda.push(rel);
                if (ignora) excluindo.push(rel);
            }
            expect(
                semGuarda,
                'config do Playwright que NÃO coleta tests/e2e-ui/_backend-required.spec.js: '
                + `${semGuarda.join(', ')}. Sem ele, a rodada daquele config fecha VERDE quando o `
                + 'backend não sobe e todos os specs pulam. Acrescente "**/_backend-required.spec.js" '
                + 'ao array de testMatch (modelo: playwright.tablet.config.js).',
            ).toEqual([]);
            expect(
                excluindo,
                `config cujo testIgnore engole o guarda: ${excluindo.join(', ')}. `
                + 'testIgnore VENCE testMatch, então recolher e ignorar é o mesmo que não recolher.',
            ).toEqual([]);
        } finally {
            if (anterior === undefined) delete process.env.EBGEO_MIGRATION_DATA_DIR;
            else process.env.EBGEO_MIGRATION_DATA_DIR = anterior;
        }
    });

    it('DISCRIMINAÇÃO: o testMatch de um cenário continua estreito, logo o caso acima não é vacuidade', async () => {
        // Se os `testMatch` recolhessem tudo, "coleta o guarda" seria verdadeiro por construção em
        // qualquer mundo. Os dois pisos abaixo medem que os configs derivados continuam recortando:
        // o de cenário não recolhe spec de navegador nem a camada de toque.
        const cenario = await carregar('frontend/playwright.atlas-safety.config.js');
        const alvos = padroes(cenario.testMatch);
        expect(alvos.length).toBe(2);
        expect(alvos.some((p) => casa(p, 'tests/e2e-ui/toque-no-mapa.tablet.spec.js'))).toBe(false);
        expect(alvos.some((p) => casa(p, 'tests/e2e-ui/browser-collab-mega.spec.js'))).toBe(false);
        expect(alvos.some((p) => casa(p, 'tests/e2e-ui/atlas-data-safety.scenario.js'))).toBe(true);

        // E o base continua com o catch-all, que é o motivo de ele nunca ter precisado da entrada
        // literal. Se um dia ele trocar por uma lista, este caso avisa antes de o guarda sumir.
        const base = await carregar('frontend/playwright.config.js');
        expect(padroes(base.testMatch)).toEqual(['**/*.spec.js']);
    });
});
