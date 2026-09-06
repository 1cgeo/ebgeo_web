// Path: tests/unit/registro-tipos-cobertura.test.js
//
// THE CENSUS OF THE CLOSED LISTS, AND THE ONE THING THAT TURNS RED WHEN A TYPE IS BORN.
//
// A feature type is born in `src/js/store/feature-type.registry.js`. It then has to be
// learned, one by one, by every other file that writes out a list of feature types. That
// learning is what used to happen weeks late and in silence: the sector tool landed on
// 2026-02-08 and three of those lists only heard about it eight to thirteen days later,
// with the tool's own commit looking complete the whole time.
//
// HOW THIS FILE WORKS, IN TWO TIERS.
//
//   THE SWEEP. The inventory comes from VERSIONING (`git ls-files` under `src/js/`), never
//   from a hand-written list of targets: "checking a subset and treating it as the whole" is
//   the most repeated entry of `docs/livro-razao.md`. Every versioned `.js` file that
//   mentions five or more distinct names of the type vocabulary (either spelling) must
//   appear in the census below. A file that appears in neither is a list nobody declared.
//
//   THE CENSUS. One entry per file, each with a written reason, and each in exactly one of
//   three states: DERIVA (it imports the registry), COMPLETA (it promises to carry every
//   type, and this file checks that it does), or SUBSET (a deliberate partial list, or a
//   known hole, with the reason saying which).
//
// THE COMPLETA TIER IS WHAT GIVES THIS GUARD ITS POSITIVE CONTROL. Add a row to the
// registry and touch nothing else: the nine COMPLETA files go red AT ONCE, each naming the
// type it never heard of. Before this file existed, that same change passed the whole
// `npm test` green.
//
// WHAT COMPLETA CHECKS, AND WHAT IT DOES NOT. It checks PRESENCE of each required name
// anywhere in the file's text. That is deliberate: an anchored extractor per file would be
// nine regexes to maintain and nine ways to break quietly, and this repository has already
// paid for extractors that stopped extracting and reported "the lists diverged". The price
// is that a name mentioned only in a comment counts as present. That is a false GREEN in a
// shape nobody produces by accident (nobody writes a type into a comment of a file whose
// list omits it), and the failure it must never miss (a type no one in that file has ever
// heard of) is caught.
//
// SUBSET DOES NOT MEAN INNOCENT. Five of the SUBSET entries below record a list that
// looks like a hole rather than a decision, and say so. This file does not fix them: a
// peripheral list migrates in the commit of the BUG it causes, with its own repro, never
// as tidying. What this file guarantees is that the hole is written down instead of being
// discovered by a user.
//
// ACCEPTED FRAGILITIES. (a) The inventory needs `git`; if the command fails, the floor case
// says so in those words, because an environment failure read as a regression costs more
// than the guard saves. (b) A type spelled with a character outside `[a-z_]` disappears
// from the vocabulary. (c) A file that builds its list by concatenation instead of literals
// leaves the sweep, which is the direction a migration goes anyway. (d) `git ls-files` reads
// the INDEX, not the working tree, so a file that exists on disk but has not been `git add`ed
// is invisible to the sweep and is never asked for a census entry. Since the run that counts
// is the one BEFORE the commit, a NEW closed list is outside the census in exactly the
// session that writes it: this guard behaves differently before and after `git add`, and it
// has already happened once, to the registry file itself (see ARQUIVO_DO_REGISTRO below).
// Any list born in a session deserves one run against the COMMITTED tree.

import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { FEATURE_TYPE_REGISTRY } from '@store/feature-type.registry.js';

// Kept as BOTH: the URL is the only join that stays correct on Windows, and `execSync`
// needs a real path for its cwd.
const URL_JS = new URL('../../src/js/', import.meta.url);
const DIR_JS = fileURLToPath(URL_JS);

/** Minimum distinct vocabulary names in one file for it to count as "writes out a list". */
const LIMIAR = 5;

// ============================================================================
// O CENSO
// ============================================================================

/**
 * @typedef {Object} EntradaDoCenso
 * @property {string} arquivo - Path relative to `src/js/`
 * @property {boolean} [deriva] - Imports the registry (checked textually)
 * @property {'tipo'|'armazenamento'} [completa] - Promises to carry every name, in this spelling
 * @property {'todos'|'selecionaveis'} [universo] - Which rows it promises (default 'todos')
 * @property {string} motivo - Why this file holds a list of types
 */

/** @type {EntradaDoCenso[]} */
const CENSO = [
    // ---------- DERIVA ----------
    {
        arquivo: 'store/store.constants.js', deriva: true,
        motivo: 'The six type constants of the store are derived from the registry, one pass each. This is the only file in the repository that derives today.',
    },

    // ---------- COMPLETA ----------
    {
        arquivo: 'store/repository.utils.js', completa: 'armazenamento', universo: 'todos',
        motivo: 'getEmptyMapData: the empty shape of a map, one bucket per type. A missing bucket makes the feature unreachable after a reload. Carries a 21st bucket, `coordenadas`, which is not a feature type.',
    },
    {
        arquivo: 'store/repositories/local.repository.js', completa: 'armazenamento', universo: 'todos',
        motivo: 'A second getEmptyMapData, the one the local repository actually returns. The pair has to agree, and nothing but this makes it.',
    },
    {
        arquivo: 'layers/layer.constants.js', completa: 'armazenamento', universo: 'todos',
        motivo: 'FEATURE_SOURCES and FEATURE_LAYER_IDS: the live MapLibre sources. A type missing here is drawn from a source nobody updates, which is how Reagendar left the magnetic declination a frame behind until a reload.',
    },
    {
        arquivo: 'features_tab/features_tab.constants.js', completa: 'armazenamento', universo: 'selecionaveis',
        motivo: 'The feature tab lists the user-facing buckets and their pt-BR names. Excludes the processing outputs on purpose: they are drawn, never listed.',
    },
    {
        arquivo: 'import_export/local-atlas-to-server.js', completa: 'tipo', universo: 'todos',
        motivo: 'VALID_FEATURE_TYPES, the client-side gate of the atlas import. A type missing here is dropped BEFORE the network and counted in droppedFeatures, which no interface renders. Also tied to the three backend copies by tipos-feicao-paridade-pacotes.test.js.',
    },
    {
        arquivo: 'import_export/kmz/kmz-feature-types.js', completa: 'tipo', universo: 'selecionaveis',
        motivo: 'Classifies each type into the KML shape it exports as. An unknown type falls through to plain linework, losing fill, label and symbol without an error. The processing outputs are explicitly skipped upstream.',
    },
    {
        arquivo: 'tool_manager/tool-registry.js', completa: 'tipo', universo: 'selecionaveis',
        motivo: 'O CATALOGO das ferramentas do mapa, e o herdeiro dos QUATRO lugares soltos que map_sig.js mantinha em sincronia por nada (SELECTION_CONTROLS, CONTROL_REGISTRY e os DOIS literais `controls:`, o do teclado e o da barra). Uma linha aqui carrega tipo de UI, tipo de feicao, fontes, alca de edicao e o `import()` do modulo. Uma ferramenta que nao entre aqui nao tem botao, nao tem atalho, nao e selecionavel e nao carrega.',
    },
    {
        arquivo: 'map_sig.js',
        motivo: 'SUBSET POR MIGRACAO, nao buraco: a lista completa mudou-se para tool_manager/tool-registry.js na onda de carga tardia de 2026-08-25. O que sobrou aqui sao as SEIS ferramentas de desenho que continuam ansiosas porque o boot as chama de forma sincrona (applyZoomCorrections em layers/styles/*.js, restoreMeasurements em layer_setup.js, DEFAULT_PROPERTIES em import.control.js). Quando esses tres arquivos entrarem na onda, esta entrada sai do censo sozinha.',
    },
    {
        arquivo: 'sidebar/components/feature-identification.js', completa: 'tipo', universo: 'selecionaveis',
        motivo: 'FEATURE_TYPE_CONFIG: the header of the feature panel, per type. A missing type opens a panel with no name and no icon.',
    },
    {
        arquivo: 'tool_manager/helpers/feature-header.helpers.js', completa: 'tipo', universo: 'selecionaveis',
        motivo: 'The feature dropdown: type name, style fingerprint keys, and select-all-of-this-type. A missing type quietly loses its entry in "select all of the same type".',
    },

    // ---------- SUBSET: buraco conhecido, escrito para nao ser descoberto pelo usuario ----------
    {
        arquivo: 'import_export/pdf-export.tab.js',
        motivo: 'KNOWN HOLE, not a decision: _collectFeatureStats omits the magnetic declination, and a second omission downstream cancels it so the feature never reaches the legend at all. Migrates in the commit of that bug, with its own repro.',
    },
    {
        arquivo: 'import_export/pdf-cartographic-elements.js',
        motivo: 'SUSPECTED HOLE: the legend drawing knows 17 of the 18 user-facing types, missing the magnetic declination. Same defect as the tab above, one file downstream.',
    },
    {
        arquivo: 'sidebar/components/group-type-selector.js',
        motivo: 'SUSPECTED HOLE: the pt-BR plural labels for "group by type" know 16 of the 18, missing the sector and the magnetic declination, so grouping by those shows a raw storage key.',
    },
    {
        arquivo: 'toolbar/components/active-tool-chip.js',
        motivo: 'SUSPECTED HOLE: TOOL_NAMES misses the sector and the magnetic declination, so the active-tool chip falls back to a generic name for two real tools.',
    },
    {
        arquivo: 'phone/phone-icons.constants.js',
        motivo: 'SUSPECTED HOLE for one type: the two phone icon sets cover 15, and the magnetic declination falls back to the generic dot. The two analysis inputs are absent by design (the phone has no analysis panel).',
    },

    // ---------- SUBSET: recorte deliberado ----------
    {
        arquivo: 'processing/processing.constants.js',
        motivo: 'SUPPORTED_GEOMETRY_TYPES is a list of GEOMETRIES, not of storage keys, and its absences are semantic: what turf can process. Deliberately outside the registry.',
    },
    {
        arquivo: 'toolbar/toolbar.constants.js',
        motivo: 'Toolbar buttons are keyed by TOOL id, which is a fourth vocabulary (the tool, not the feature). The military tools are grouped under their own ids, so the overlap with type names is partial by construction.',
    },
    {
        arquivo: 'utilities/feature_navigation_utils.js',
        motivo: 'SELECTION_BOX_TYPES: the four types whose zoom-to reads properties.selectionBox instead of the geometry. Pinned against the registry field `selectionBox` by registro-tipos-feicao.test.js without being migrated.',
    },
    {
        arquivo: 'temporal/temporal.constants.js',
        motivo: 'TRAJECTORY_FEATURE_TYPES: three types carry a trajectory, and that is a product decision (validity window for everyone, trajectory for three). A complete list here would be wrong.',
    },
    {
        arquivo: 'sidebar/components/feature-location-section.js',
        motivo: 'The types that have an editable point coordinate. A polygon has no single coordinate to edit, so the subset is the meaning.',
    },
    {
        arquivo: 'sidebar/components/feature-tabs.js',
        motivo: 'Three subsets, one per optional tab (azimuths, coordinates, analysis parameters). Each one is a statement about that tab, not about the type list.',
    },
    {
        arquivo: 'import_export/kmz/kmz-export.service.js',
        motivo: 'Names the two analysis inputs it skips and the two irregular buckets it has to spell out. The classification itself lives in kmz-feature-types.js, which is COMPLETA above.',
    },
    {
        arquivo: 'import_export/import.control.js',
        motivo: 'Import maps GeoJSON geometry (Point/LineString/Polygon) onto the three buckets it can produce. It never produces the other seventeen.',
    },
    {
        arquivo: 'store/feature.operations.js',
        motivo: 'Names the handful of types whose write needs special handling (image resources, automatic DTG re-derivation, processing outputs). The generic path covers the rest.',
    },
    {
        arquivo: 'features_tab/feature-organizer.service.js',
        motivo: 'Buckets appear only as sample values in documentation and defaults; the real list arrives as an argument from features_tab.constants.js, which is COMPLETA above.',
    },
    {
        arquivo: 'layers/styles/shape.layers.js',
        motivo: 'Style module for the geometric shapes only. Each style module owns its own family, and the split between them is the z-order of layer_setup.js, which is ordered by hand on purpose.',
    },
    {
        arquivo: 'layers/styles/content.layers.js',
        motivo: 'Style module for text, image and arrow layers. Same family split as shape.layers.js.',
    },
    {
        arquivo: 'layers/styles/tactical.layers.js',
        motivo: 'Style module for the tactical and analysis families. This is where the FOUR analysis sources are created side by side: the two inputs the operator draws and the two processed outputs.',
    },
    {
        arquivo: 'phone/phone-layout.js',
        motivo: 'Names the buckets whose phone behaviour differs (mirrored sources, move preview). The rest is generic.',
    },
    {
        arquivo: 'utilities/id_utils.js',
        motivo: 'Generates default names and resolves image resources; the type names appear as prefixes and sample values, not as a list to keep complete.',
    },
    {
        arquivo: 'azimuth_distance_tool/add_azimuth_distance_control.js',
        motivo: 'A tool that OUTPUTS three types (point, line, polygon) and carries its own singular/plural map for them. It never outputs the others.',
    },
    {
        arquivo: 'processing/algorithms/algorithm.interface.js',
        motivo: 'The type names appear in the JSDoc example of supportedGeometryTypes. Documentation, not a list.',
    },
    {
        arquivo: 'import_export/export-utils.js',
        motivo: 'ZOOM_INVARIANT_SOURCES: the sources whose pixel sizes are rescaled for the export zoom. It is a list of SOURCES, not of types, and it only carries the ones that store a `createdAtZoom` and a base size; a type that has no zoom anchor has nothing to correct. It crossed the sweep threshold when the boundary joined it (its three entries are `boundarys` plus two hyphenated derived sources the vocabulary regex cannot see). A type missing here exports at the size it was authored at, which is visible in the PDF and not silent.',
    },
    {
        arquivo: 'tool_manager/helpers/hit-test.model.js',
        motivo: 'AREA_FEATURE_TYPES and POINT_FEATURE_TYPES: the two hit CLASSES a click ranks by (point > line > area). Deliberately not complete, and it must not become so: `hitClassOf` falls through to LINE, which is the right default for the thin things (line, brush, boundary, occupied_front, los), so a type born without an entry is hit-tested as thin, not dropped. The two lists are the exceptions to that default, and only a type that is a large target (area) or a single screen point (point) belongs in one. Nothing here is a gate: a wrong class costs a disambiguation menu, never a lost feature.',
    },
    {
        arquivo: 'admin/uso-phrases.js',
        motivo: 'FERRAMENTA_LABEL: the pt-BR names of the MAP TOOLS, keyed by the `tipoDeUi` of `tool_manager/tool-registry.js`, for the "mais usados" table of the Uso tab. It is a list of TOOL ids and not of feature types, and 14 of the 24 keys coincide with the vocabulary only because a tool is usually named after what it draws — which is exactly why it is declared here instead of being discovered later. A feature type born WITHOUT a tool needs no entry here; a TOOL born without one shows up on screen with its raw id, which is ugly and honest, the same degradation `ENTIDADE_LABEL` chose in the same file. Nothing here is a gate: this table decides display, never behaviour.',
    },
];

// ============================================================================
// A VARREDURA
// ============================================================================

const TIPOS = FEATURE_TYPE_REGISTRY.map(r => r.type);
const ARMAZENS = FEATURE_TYPE_REGISTRY.map(r => r.storage);
const VOCABULARIO = new Set([...TIPOS, ...ARMAZENS]);

/**
 * Distinct vocabulary names a source text mentions, as quoted literals or as bare object
 * keys (`point: 'points'`).
 * @param {string} fonte
 * @returns {Set<string>}
 */
function nomesCitados(fonte) {
    const achados = new Set();
    for (const m of fonte.matchAll(/['"`]([a-z_]+)['"`]/g)) if (VOCABULARIO.has(m[1])) achados.add(m[1]);
    for (const m of fonte.matchAll(/^\s*([a-z_]+)\s*:/gm)) if (VOCABULARIO.has(m[1])) achados.add(m[1]);
    return achados;
}

/**
 * Versioned `.js` files under `src/js/`, relative to it. Derived from git on purpose: a
 * hand-written list of targets is the failure mode this whole file exists to avoid.
 * @returns {string[]}
 */
function arquivosVersionados() {
    const saida = execSync('git ls-files', { cwd: DIR_JS, encoding: 'utf8' });
    return saida.split('\n').map(s => s.trim()).filter(f => f.endsWith('.js'));
}

let erroDoInventario = null;
let inventario = [];
try {
    inventario = arquivosVersionados();
} catch (e) {
    erroDoInventario = e;
}

const fontePorArquivo = new Map(
    inventario.map(rel => [rel, readFileSync(new URL(rel, URL_JS), 'utf8')])
);

/**
 * The registry itself, which is the SOURCE of the vocabulary and never a consumer of it.
 *
 * It has to be excluded by name, and the reason it was not excluded from the start is worth
 * keeping: the inventory comes from `git ls-files`, so while the registry was a new,
 * UNTRACKED file the sweep could not see it, and the census passed. It became an "orphan
 * file with a list of types" at the exact moment it was committed — the guard behaves
 * differently before and after `git add`, and verifying only the pre-commit tree hides that.
 * Any guard fed by `git ls-files` deserves one run against the COMMITTED tree.
 */
const ARQUIVO_DO_REGISTRO = 'store/feature-type.registry.js';

/** Files that write out a list of types: `LIMIAR` or more distinct vocabulary names. */
const VARRIDOS = inventario
    .filter(rel => rel !== ARQUIVO_DO_REGISTRO)
    .filter(rel => nomesCitados(fontePorArquivo.get(rel)).size >= LIMIAR);

const porArquivo = new Map(CENSO.map(e => [e.arquivo, e]));

/** The names a COMPLETA entry promises to carry, in its declared spelling. */
function exigidos(entrada) {
    const linhas = entrada.universo === 'selecionaveis'
        ? FEATURE_TYPE_REGISTRY.filter(r => r.selectable)
        : FEATURE_TYPE_REGISTRY;
    return linhas.map(r => (entrada.completa === 'tipo' ? r.type : r.storage));
}

// ============================================================================
// OS CASOS
// ============================================================================

describe('cobertura do registro: piso', () => {
    it('FLOOR: o inventario veio do git e tem centenas de arquivos', () => {
        // An environment failure read as a regression costs more than this guard saves, so it
        // says which one it is, in those words.
        expect(erroDoInventario, 'FALHA DE AMBIENTE, nao regressao: `git ls-files` nao rodou em src/js/. '
            + 'Este guarda deriva o inventario do versionamento e nao tem outra fonte.').toBeNull();
        expect(inventario.length, 'o inventario veio vazio').toBeGreaterThan(500);
    });

    it('FLOOR: a varredura achou as listas, e achou as duas mais inequivocas', () => {
        // Without this, a broken vocabulary would empty VARRIDOS and every property below
        // would pass over nothing, reporting perfect coverage of zero files.
        expect(VOCABULARIO.size, 'o vocabulario veio vazio').toBeGreaterThanOrEqual(20);
        expect(VARRIDOS.length, 'a varredura nao achou lista nenhuma').toBeGreaterThanOrEqual(20);
        // Two files that exist to BE a list of types, so a sweep that misses them is broken.
        // Deliberately NOT `store.constants.js`: it derives, so its literals are gone, and it
        // now trips the sweep only through the names quoted in its own comments.
        expect(VARRIDOS, 'layer.constants.js saiu da varredura').toContain('layers/layer.constants.js');
        expect(VARRIDOS, 'features_tab.constants.js saiu da varredura').toContain('features_tab/features_tab.constants.js');
    });
});

describe('cobertura do registro: censo completo e vivo', () => {
    it('todo arquivo varrido esta no censo', () => {
        const orfaos = VARRIDOS.filter(rel => !porArquivo.has(rel));
        // The message has to teach the fix, because whoever reads it is adding a tool.
        expect(orfaos, 'arquivo com lista de tipos fora do censo. Derive-o do registro '
            + '(`store/feature-type.registry.js`) ou acrescente uma entrada em CENSO com o motivo escrito. '
            + 'Se a lista precisa carregar TODOS os tipos, declare `completa`.').toEqual([]);
    });

    it('toda entrada do censo ainda corresponde a um arquivo varrido', () => {
        // Anti-tapete: an entry for a file that was deleted or renamed is an allowlist growing
        // quietly, which is how allowlists stop meaning anything.
        //
        // DERIVA entries are exempt, and the exemption is the point rather than a loophole:
        // migrating a list DELETES its literals, so a file that derives correctly falls out of
        // the sweep. Demanding it stay swept would punish exactly the outcome this registry
        // exists to produce. What still holds those entries honest is the DERIVA case below,
        // which requires the file to import the registry for real.
        const mortas = CENSO.filter(e => !e.deriva).map(e => e.arquivo).filter(rel => !VARRIDOS.includes(rel));
        expect(mortas, 'entrada morta no censo. Tres causas, nesta ordem de probabilidade: '
            + 'o arquivo foi renomeado ou apagado; ele deixou de escrever tipos; ou uma LINHA SAIU DO '
            + 'REGISTRO, o que encolhe o vocabulario e derruba do limiar os arquivos que citavam poucos '
            + 'nomes. Se varios casos ficaram vermelhos de uma vez, e a terceira.').toEqual([]);
    });

    it('toda entrada DERIVA aponta para um arquivo que existe', () => {
        // The half the exemption above gives up: a deriving entry could name a file that was
        // deleted, and nothing else here would notice.
        const inexistentes = CENSO.filter(e => e.deriva).map(e => e.arquivo).filter(rel => !fontePorArquivo.has(rel));
        expect(inexistentes, 'entrada DERIVA apontando para arquivo que nao existe').toEqual([]);
    });

    it('toda entrada tem motivo escrito, e o motivo diz alguma coisa', () => {
        const vazias = CENSO.filter(e => typeof e.motivo !== 'string' || e.motivo.trim().length < 40)
            .map(e => e.arquivo);
        expect(vazias, 'motivo ausente ou curto demais para significar algo').toEqual([]);
    });

    it('nenhum arquivo aparece duas vezes no censo', () => {
        expect(porArquivo.size).toBe(CENSO.length);
    });
});

describe('cobertura do registro: os tres estados', () => {
    it('quem se declara DERIVA importa mesmo o registro', () => {
        const derivam = CENSO.filter(e => e.deriva);
        expect(derivam.length, 'ninguem deriva: o registro nao tem consumidor').toBeGreaterThanOrEqual(1);
        for (const e of derivam) {
            expect(fontePorArquivo.get(e.arquivo), `${e.arquivo} se declara DERIVA e nao importa o registro`)
                .toContain('feature-type.registry');
        }
    });

    it('quem se declara COMPLETA carrega TODOS os nomes que promete', () => {
        const completas = CENSO.filter(e => e.completa);
        // Floor before the property: if this list ever empties, the positive control below
        // would keep passing while measuring nothing.
        expect(completas.length, 'nenhuma lista COMPLETA: o controle positivo mediria vazio').toBeGreaterThanOrEqual(9);

        const faltas = [];
        for (const e of completas) {
            const citados = nomesCitados(fontePorArquivo.get(e.arquivo));
            for (const nome of exigidos(e)) {
                if (!citados.has(nome)) faltas.push(`${e.arquivo} nunca ouviu falar de '${nome}'`);
            }
        }
        expect(faltas, 'lista que promete completude e nao entrega. Acrescente o tipo la, '
            + 'ou rebaixe a entrada para SUBSET com o motivo escrito.').toEqual([]);
    });

    it('ninguem se declara COMPLETA e DERIVA ao mesmo tempo', () => {
        // Not a contradiction in principle, but today it would mean a file both imports the
        // registry and writes the list out again, which is the duplication being removed.
        expect(CENSO.filter(e => e.deriva && e.completa).map(e => e.arquivo)).toEqual([]);
    });

    it('ABSOLUTE: as nove listas que prometem completude, nomeadas', () => {
        // Absolute alongside the derived: if someone quietly demotes an entry to SUBSET, the
        // property above goes on passing and only this case notices.
        //
        // A TROCA DE 2026-08-25 passou por AQUI, e e por isso que este caso existe: a lista
        // completa saiu de `map_sig.js` e entrou em `tool_manager/tool-registry.js`, na onda de
        // carga tardia das ferramentas. Uma migracao legitima parece exatamente com um
        // rebaixamento silencioso enquanto ninguem escreve os dois lados na mesma linha.
        expect(CENSO.filter(e => e.completa).map(e => e.arquivo).sort()).toEqual([
            'features_tab/features_tab.constants.js',
            'import_export/kmz/kmz-feature-types.js',
            'import_export/local-atlas-to-server.js',
            'layers/layer.constants.js',
            'sidebar/components/feature-identification.js',
            'store/repositories/local.repository.js',
            'store/repository.utils.js',
            'tool_manager/helpers/feature-header.helpers.js',
            'tool_manager/tool-registry.js',
        ]);
    });
});

describe('cobertura do registro: controle positivo dos mecanismos', () => {
    // Everything above is born green over correct code. These cases drive the SAME two
    // mechanisms over synthetic text, on every run, so "the guard can see" never becomes a
    // claim from a session nobody can reproduce.

    it('o contador enxerga cinco nomes, e nao enxerga quatro', () => {
        const cinco = "const X = ['point', 'line', 'polygon', 'circle', 'ellipse'];";
        const quatro = "const X = ['point', 'line', 'polygon', 'circle'];";
        expect(nomesCitados(cinco).size).toBe(5);
        expect(nomesCitados(quatro).size).toBe(4);
        expect(nomesCitados(cinco).size >= LIMIAR).toBe(true);
        expect(nomesCitados(quatro).size >= LIMIAR).toBe(false);
    });

    it('o contador le chave de objeto sem aspas, que e a forma da metade das listas', () => {
        const objeto = 'const M = {\n  point: 1,\n  line: 2,\n  setores: 3,\n};';
        expect([...nomesCitados(objeto)].sort()).toEqual(['line', 'point', 'setores']);
    });

    it('o contador NAO conta palavra que so parece do vocabulario', () => {
        const ruido = "const X = ['pointer', 'outline', 'imagem', 'lineWidth'];";
        expect(nomesCitados(ruido).size).toBe(0);
    });

    it('a checagem de COMPLETA acusa o tipo que falta, e nomeia o arquivo', () => {
        // This is the positive control the whole file turns on: a row exists in the registry
        // and a COMPLETA list never heard of it.
        const entrada = { arquivo: 'sintetico.js', completa: 'tipo', universo: 'todos', motivo: 'x' };
        const semSetor = TIPOS.filter(t => t !== 'sector').map(t => `'${t}'`).join(', ');
        const citados = nomesCitados(`const X = [${semSetor}];`);
        const faltas = exigidos(entrada).filter(n => !citados.has(n));
        expect(faltas).toEqual(['sector']);
    });

    it('a checagem de COMPLETA distingue as duas grafias', () => {
        // A file that spells everything in the singular does NOT satisfy an entry declared in
        // storage spelling, which is the whole reason the spelling is declared per file.
        const emTipo = { arquivo: 'x.js', completa: 'tipo', universo: 'todos', motivo: 'x' };
        const emArmazem = { arquivo: 'x.js', completa: 'armazenamento', universo: 'todos', motivo: 'x' };
        const citados = nomesCitados(`const X = [${TIPOS.map(t => `'${t}'`).join(', ')}];`);
        expect(exigidos(emTipo).filter(n => !citados.has(n))).toEqual([]);
        // `los` and `visibility` spell the same both ways, so they are the two that survive.
        expect(exigidos(emArmazem).filter(n => !citados.has(n))).toContain('setores');
        expect(exigidos(emArmazem).filter(n => !citados.has(n))).not.toContain('los');
    });

    it('o universo `selecionaveis` exclui as duas saidas de processamento, e so elas', () => {
        const entrada = { arquivo: 'x.js', completa: 'tipo', universo: 'selecionaveis', motivo: 'x' };
        const fora = TIPOS.filter(t => !exigidos(entrada).includes(t));
        expect(fora).toEqual(['processed_los', 'processed_visibility']);
    });
});
