// Path: tests/unit/maplibre-construtores-regua.test.js

/**
 * @fileoverview A CARGA DO MAPLIBRE É UMA SÓ, E TODO CONSTRUTOR DE MAPA DECLARA O MESMO
 * `zoomLevelsToOverscale`. As duas propriedades são estáticas, valem para arquivos que nenhum
 * teste de comportamento carrega junto, e por isso a régua é uma varredura de fonte.
 *
 * O QUE ELA GUARDA, e por que cada metade existe.
 *
 * (a) UM PONTO DE CARGA. Até 2026-09-04 o MapLibre era um `<script>` global de
 *     `public/vendors/maplibre-gl.js` (bundle UMD 5.18) em DUAS páginas, `index.html` e
 *     `calibracao.html`. A 6.x não publica UMD: o pacote só distribui ES modules, então a
 *     biblioteca entra pelo npm e `src/js/map/maplibre.js` é o único arquivo do repositório que a
 *     importa. Três coisas quebram em silêncio se alguém desfizer isso, e nenhuma delas dá erro
 *     de página:
 *       - `import maplibregl from 'maplibre-gl'` devolve `undefined`, porque o bundle da 6.x
 *         exporta 85 nomes e nenhum `default`;
 *       - sem `setWorkerUrl` com `?worker&url`, o Vite resolve o worker dentro de
 *         `node_modules/.vite/deps`, onde o arquivo não existe, e o mapa SOBE SEM TILE NENHUM;
 *       - sem `window.maplibregl`, param a bancada de `frontend/bench/` e os `page.evaluate`
 *         dos specs de Playwright, que alcançam a biblioteca de FORA do bundle. A APLICAÇÃO
 *         deixou de depender dele em 2026-09-05: os vinte arquivos de `src/js/` que liam o
 *         global passaram a importar o ponto único, e quem voltar ao global é reprovado pela
 *         regra `ebgeo/no-maplibre-global` (bloco (c) abaixo).
 *
 * (b) `zoomLevelsToOverscale: undefined` EM TODO CONSTRUTOR. A 6.x tirou a opção do estado
 *     experimental e passou a valer 4 por padrão, o que FATIA os tiles em vez de sobre-escalar
 *     acima de `maxzoom - 4`, mudando a renderização e o resultado de `queryRenderedFeatures`.
 *     A 5.18 lia a opção pelo nome `experimentalZoomLevelsToOverscale`, que este app nunca passou,
 *     e o `tileManager` caía em `maxzoom: this._source.maxzoom`, ou seja, sempre sobre-escalava. Passar
 *     `undefined` reproduz o comportamento antigo, e a CHAVE PRECISA APARECER no literal: o
 *     construtor funde por espalhamento (`{...defaultOptions, ...options}`) e chave ausente
 *     recebe o 4 do padrão.
 *
 *     A LISTA É SEM EXCEÇÃO, de propósito, e o caso do `calibration/minimap.js` é o que a testa:
 *     o estilo dele é raster escrito no próprio arquivo, e `zoomLevelsToOverscale` só alcança
 *     fonte VETORIAL. A chave está lá mesmo assim, porque uma exceção teria de ser reavaliada no
 *     dia em que aquele estilo virasse vetorial, e ninguém reavalia o que não reprova.
 *
 * CONTROLE DO VARREDOR no último bloco: sem ele, um extrator que parasse de casar deixaria os
 * casos acima verdes varrendo lista vazia, que é como esta classe de teste morre.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const FRONT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const PONTO_UNICO = 'src/js/map/maplibre.js';

/** Os `.js` de `src/js/` que o git enxerga, incluindo o ainda não commitado. */
function fontes() {
    return execFileSync(
        'git',
        ['ls-files', '--cached', '--others', '--exclude-standard', 'src/js'],
        { cwd: FRONT, encoding: 'utf8' }
    )
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.endsWith('.js'));
}

/** Apaga o CONTEÚDO dos comentários, para que a prosa que CITA um import não vire uma aresta. */
function semComentarios(texto) {
    return texto
        .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
        .replace(/(^|[^:])\/\/[^\n]*/g, (m, antes) => antes + ' '.repeat(m.length - antes.length));
}

/**
 * O literal de opções de cada `new maplibregl.Map({...})`, por casamento de CHAVES.
 *
 * Não é regex sobre o corpo, e a razão é a mesma que o `zoom-pass-events.test.js` já registra:
 * uma regex pararia na primeira `}` de um objeto aninhado, e o estilo inline de
 * `calibration/minimap.js` tem três níveis deles. Aqui um literal cortado cedo esconderia a
 * chave que vem depois, e a régua aprovaria por corte.
 * @param {string} codigo - Fonte já sem comentários.
 * @returns {string[]} Um literal por construtor achado.
 */
function literaisDeConstrutor(codigo) {
    const literais = [];
    const marca = 'new maplibregl.Map({';
    let de = codigo.indexOf(marca);
    while (de !== -1) {
        let i = de + marca.length;
        let nivel = 1;
        while (i < codigo.length && nivel > 0) {
            if (codigo[i] === '{') nivel += 1;
            else if (codigo[i] === '}') nivel -= 1;
            i += 1;
        }
        literais.push(codigo.slice(de + marca.length, i - 1));
        de = codigo.indexOf(marca, i);
    }
    return literais;
}

const ARQUIVOS = fontes();
const COM_CONSTRUTOR = ARQUIVOS
    .map((rel) => ({ rel, literais: literaisDeConstrutor(semComentarios(readFileSync(join(FRONT, rel), 'utf8'))) }))
    .filter((a) => a.literais.length > 0);

describe('(a) o MapLibre entra por um ponto único', () => {
    it('um só arquivo de `src/js/` importa o pacote, e é `map/maplibre.js`', () => {
        const importadores = ARQUIVOS.filter((rel) => {
            const codigo = semComentarios(readFileSync(join(FRONT, rel), 'utf8'));
            return /(?:^|[\s;}])(?:import|export)\s+(?:[^;'"]*?\s+from\s+)?['"]maplibre-gl(?:\/[^'"]*)?['"]/
                .test(codigo);
        });
        expect(importadores).toEqual([PONTO_UNICO]);
    });

    it('o ponto único usa NAMESPACE, publica o global e chama `setWorkerUrl`', () => {
        const texto = readFileSync(join(FRONT, PONTO_UNICO), 'utf8');
        const codigo = semComentarios(texto);

        // Namespace, nunca default: a 6.x não tem `export default`, e o default silencioso é
        // `undefined`, que só aparece no primeiro `new maplibregl.Map`.
        expect(codigo).toMatch(/import\s+\*\s+as\s+maplibregl\s+from\s+'maplibre-gl'/);
        expect(codigo, 'import default de `maplibre-gl` devolve undefined na 6.x')
            .not.toMatch(/import\s+maplibregl\s+from\s+'maplibre-gl'/);

        // O worker, sem o qual o mapa sobe sem tile e sem erro.
        expect(codigo).toMatch(/from\s+'maplibre-gl\/dist\/maplibre-gl-worker\.mjs\?worker&url'/);
        expect(codigo).toContain('maplibregl.setWorkerUrl(workerUrl)');

        // O CSS, que substitui a cópia apagada de `public/vendors/maplibre-gl.css`.
        expect(codigo).toContain("import 'maplibre-gl/dist/maplibre-gl.css'");

        // O global, para os arquivos que ainda leem `maplibregl.` sem importar nada.
        expect(codigo).toContain('window.maplibregl = maplibregl');
    });

    it('os DOIS entries de página com mapa importam o ponto único PRIMEIRO', () => {
        // Um import mais abaixo funcionaria por acidente (o ESM avalia dependências antes do corpo
        // do importador), mas a ordem entre irmãos é a textual, e basta um irmão que toque
        // `maplibregl` no corpo do módulo para o acidente virar erro.
        const entradas = [
            ['src/js/index.js', './map/maplibre.js'],
            ['src/js/calibration/calibracao-page.js', '@js/map/maplibre.js'],
        ];
        for (const [entrada, especificador] of entradas) {
            const codigo = semComentarios(readFileSync(join(FRONT, entrada), 'utf8'));
            const imports = [...codigo.matchAll(/^import\s+(?:[^;'"]*?\s+from\s+)?'([^']+)'/gm)]
                .map((m) => m[1]);
            expect(imports[0], `${entrada}: o primeiro import não é o ponto único`)
                .toBe(especificador);
        }
    });

    it('nenhuma página nem módulo volta a apontar `public/vendors/maplibre-gl`', () => {
        for (const arquivo of ['index.html', 'calibracao.html', 'atlas.html', 'admin.html']) {
            expect(readFileSync(join(FRONT, arquivo), 'utf8'), `${arquivo} cita o vendor apagado`)
                .not.toContain('/vendors/maplibre-gl');
        }
        for (const copia of ['public/vendors/maplibre-gl.js', 'public/vendors/maplibre-gl.css']) {
            expect(existsSync(join(FRONT, copia)), `${copia} voltou a existir`).toBe(false);
        }
    });
});

describe('(b) todo construtor de mapa declara `zoomLevelsToOverscale`', () => {
    it('a varredura achou os construtores que este repositório tem', () => {
        // Piso de vácuo E o inventário nomeado: um extrator quebrado devolveria zero e todo o
        // resto passaria; um arquivo NOVO com mapa aparece aqui como falha, que é o momento certo
        // de decidir sobre ele em vez de deixá-lo entrar calado.
        const nomes = COM_CONSTRUTOR.map((a) => a.rel).sort();
        expect(nomes).toEqual([
            'src/js/calibration/minimap.js',
            'src/js/calibration/project-map.js',
            'src/js/import_export/garmin-kmz-export.js',
            'src/js/import_export/pdf-export.tab.js',
            'src/js/import_export/pdf-mosaic-export.js',
            'src/js/import_export/screenshot.control.js',
            'src/js/map_sig.js',
            'src/js/street_view_tool/add_street_view_control.js',
        ]);
        const total = COM_CONSTRUTOR.reduce((a, x) => a + x.literais.length, 0);
        expect(total, 'nove construtores: `screenshot.control.js` tem dois').toBe(9);
    });

    it.each(COM_CONSTRUTOR)('$rel', ({ rel, literais }) => {
        literais.forEach((literal, i) => {
            expect(
                literal,
                `${rel}, construtor ${i + 1}: sem \`zoomLevelsToOverscale\` o padrão novo (4) `
                + 'fatia os tiles e muda `queryRenderedFeatures`'
            ).toMatch(/zoomLevelsToOverscale\s*:\s*undefined/);
        });
    });
});

describe('(c) a régua que proíbe o global está LIGADA no lint', () => {
    /**
     * A regra `ebgeo/no-maplibre-global` tem controle negativo próprio (`eslint-rules/probe.js`,
     * que roda antes do `eslint` em `npm run lint:js`): lá se prova que ela DISPARA e que a
     * exceção do ponto único não é larga demais. O que aquele probe NÃO alcança é se ela está
     * ligada para `src/**` neste repositório: uma linha apagada do `eslint.config.js` deixaria o
     * probe verde, o lint mudo, e a proibição existiria só na prosa.
     *
     * A pergunta se faz ao PRÓPRIO ESLint (`calculateConfigForFile`), e não por regex no arquivo
     * de configuração: é a configuração efetiva de um arquivo real de `src/js/`, com a cascata de
     * blocos já resolvida, que é o caminho independente daquele que a produziu.
     */
    it('o ESLint aplica `ebgeo/no-maplibre-global` como erro num arquivo real de `src/js/`', async () => {
        const { ESLint } = await import('eslint');
        const eslint = new ESLint({ cwd: FRONT });
        const config = await eslint.calculateConfigForFile(join(FRONT, 'src/js/map_sig.js'));

        const severidade = config.rules['ebgeo/no-maplibre-global'];
        expect(severidade, 'a regra não está ligada para `src/**` no eslint.config.js')
            .toBeDefined();
        // `calculateConfigForFile` devolve a severidade NORMALIZADA (2), nunca a string
        // `'error'` que o arquivo de configuração escreve. Medido, não suposto: a primeira
        // versão deste caso comparava com `'error'` e reprovou a configuração certa.
        expect(Array.isArray(severidade) ? severidade[0] : severidade).toBe(2);

        // Controle do instrumento: a mesma leitura devolve as outras regras da casa. Sem esta
        // linha, um `calculateConfigForFile` que devolvesse configuração vazia por outro motivo
        // (cwd errado, arquivo ignorado) deixaria o caso acima falhando pela razão errada, ou o
        // próximo passando por acidente.
        expect(Object.keys(config.rules)).toEqual(
            expect.arrayContaining(['ebgeo/require-path-comment', 'ebgeo/no-json-clone'])
        );
    });

    it('e o ponto único é o único arquivo de `src/js/` que pode nomear o global', async () => {
        // O outro lado: a exceção existe, é por CAMINHO, e vale para este repositório e não só
        // para a árvore de fixture. Sem ela o próprio arquivo que publica o global seria
        // reprovado, e a saída seria desligar a regra.
        const { ESLint } = await import('eslint');
        const eslint = new ESLint({ cwd: FRONT });
        const [res] = await eslint.lintFiles([join(FRONT, PONTO_UNICO)]);
        const doGlobal = res.messages.filter((m) => m.ruleId === 'ebgeo/no-maplibre-global');
        expect(doGlobal, `${PONTO_UNICO} foi reprovado pela própria regra`).toEqual([]);
        // E ele NOMEIA o global, senão o verde acima seria sobre um arquivo que não o toca.
        expect(readFileSync(join(FRONT, PONTO_UNICO), 'utf8')).toContain('window.maplibregl');
    });
});

describe('CONTROLE DO VARREDOR', () => {
    it('conta construtores, atravessa objeto aninhado e sabe recusar', () => {
        const amostra = 'const a = new maplibregl.Map({ style: { sources: { osm: { tiles: [] } } },'
            + ' zoomLevelsToOverscale: undefined });'
            + ' const b = new maplibregl.Map({ container: c });'
            + ' const d = new maplibregl.Marker({ zoomLevelsToOverscale: undefined });';
        const achados = literaisDeConstrutor(amostra);
        expect(achados).toHaveLength(2);
        // O primeiro: a chave vem DEPOIS de três níveis de objeto aninhado, e uma regex que
        // parasse na primeira `}` a perderia.
        expect(achados[0]).toMatch(/zoomLevelsToOverscale\s*:\s*undefined/);
        // O segundo REPROVA, que é o estado anterior a 2026-09-04 em nove arquivos.
        expect(achados[1]).not.toMatch(/zoomLevelsToOverscale/);
        // E o `Marker` não é `Map`: a régua não cobra a chave de quem não a tem.
        expect(achados.join('|')).not.toContain('Marker');
    });

    it('a lista de fontes não está vazia (o inventário vem do git)', () => {
        expect(ARQUIVOS.length).toBeGreaterThan(300);
        expect(ARQUIVOS).toContain(PONTO_UNICO);
    });
});
