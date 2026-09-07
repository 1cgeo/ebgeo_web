// Path: tests/unit/import-recusado-nao-gasta-vaga.test.js

/**
 * @fileoverview Um `.ebgeo` que o produto RECUSA não pode custar um dos dez atlas locais.
 *
 * O QUE MOTIVOU. "Abrir arquivo .ebgeo" em `atlas.html` deixa os bytes no banco global e navega; o
 * boot do mapa consome. Nesse consumo o atlas local era criado ANTES de alguém olhar o arquivo, e
 * só depois o importador o abria e decidia. Um arquivo escrito por uma versão mais nova do produto
 * (o portão de versão o recusa) ou um arquivo corrompido terminava assim: uma mensagem de erro, um
 * atlas local NOVO e VAZIO com o nome do arquivo na lista da pessoa, ela montada dentro dele, e uma
 * das dez vagas gasta por um import que não aconteceu. Dez tentativas travam a criação de atlas.
 *
 * O CONSERTO É DE ORDEM, e é por isso que este arquivo mede uma ORDEM: parsear e passar pelo portão
 * ANTES de criar. `deep-link/pending-import.js` já dizia, no próprio cabeçalho, que a criação é o
 * último passo "porque é o único que consome uma das dez vagas"; faltava-lhe a etapa que decide.
 *
 * O INSTRUMENTO É REAL DOS DOIS LADOS, e sem isso o teste não valeria:
 *   - o PORTÃO é o de verdade (`import_export/ebgeo-file-gate.js`), lendo arquivos `.ebgeo` de
 *     verdade (ZIP mascarado por XOR 0xAA atrás do cabeçalho `EBGXOR`), montados aqui com o mesmo
 *     JSZip que o exportador usa;
 *   - o CRIADOR é `createLocalAtlas` de verdade, sobre `fake-indexeddb`, e a contagem sai de
 *     `listLocalAtlases()` antes e depois. Um dublê contaria o que ele mesmo foi mandado contar.
 *
 * POR QUE `createLocalAtlas` E NÃO `switchToNewLocalAtlas`: em produção o boot injeta a segunda,
 * que arrasta o mapa inteiro (motor de sync, controles) e não sobe em node. Mas é a PRIMEIRA linha
 * dela que gasta a vaga (`const created = await createLocalAtlas(name)`, e a recusa do teto é
 * devolvida como está), então é exatamente ela o passo que este arquivo tem de vigiar.
 *
 * O CONTROLE POSITIVO é o arquivo BOM: sem ele, um consumidor que recusasse tudo passaria em todos
 * os casos negativos e nenhum import funcionaria.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import JSZip from 'jszip';

import { ATLAS_SCHEMA_VERSION } from '@store/atlas/atlas.entity.js';
import { compareVersions } from '@store/repository.utils.js';

/** Versão acima de QUALQUER teto que esta linha do produto tenha tido. */
const ACIMA_DO_TETO = '3.1';

/**
 * Um `.ebgeo` de verdade: ZIP com `data.json`, mascarado como o exportador mascara.
 * @param {Object} documento - O conteúdo de `data.json`.
 * @returns {Promise<ArrayBuffer>}
 */
async function ebgeo(documento) {
    const zip = new JSZip();
    zip.file('data.json', JSON.stringify(documento));
    const bytes = await zip.generateAsync({ type: 'uint8array' });
    const cabecalho = new TextEncoder().encode('EBGXOR');
    const saida = new Uint8Array(cabecalho.length + bytes.length);
    saida.set(cabecalho, 0);
    saida.set(bytes.map((b) => b ^ 0xAA), cabecalho.length);
    return saida.buffer;
}

/** O documento mínimo que o portão aceita, na versão corrente do esquema. */
function documentoBom() {
    return { version: ATLAS_SCHEMA_VERSION, maps: {}, mapOrder: [], currentMap: null };
}

let avisos;
let importados;
/** Os módulos REAIS, recarregados por caso: ver o `beforeEach`. */
let ns;
let api;
let consumidor;

/** O importador de mentira: conta as chamadas, e nunca é alcançado num caminho recusado. */
function importador() {
    return {
        processFileDirectly: vi.fn(async (file) => { importados.push(file.name); }),
    };
}

/**
 * Roda o consumo com o CRIADOR e o PORTÃO reais.
 * @param {ArrayBuffer} data - Os bytes da entrega.
 * @param {Object} [service] - O importador.
 * @returns {Promise<boolean>}
 */
async function consumir(data, service = importador()) {
    await ns.savePendingImport({ name: 'Operação Alfa', data });
    return consumidor({
        hasDeepLink: false,
        getImporter: () => service,
        // O CRIADOR DE VERDADE. É ele que gasta a vaga, e é a primeira linha do que o boot injeta
        // em produção (`switchToNewLocalAtlas`).
        createAtlas: (name) => api.createLocalAtlas(name),
        notify: (message, level) => avisos.push({ message, level }),
    });
}

/** @returns {number} Quantos atlas locais existem AGORA, pela API de verdade. */
function quantos() {
    return api.listLocalAtlases().length;
}

beforeEach(async () => {
    avisos = [];
    importados = [];
    // CADA CASO COMEÇA COM UM SLOT SÓ, e isso exige apagar as duas memórias: o banco global (que
    // guarda o registro) e o `_entries` que o módulo carregou dele. Sem o segundo, um caso herdaria
    // a lista do anterior; sem o primeiro, o teto de dez seria atingido no meio do arquivo e o
    // controle positivo passaria a medir a recusa do teto em vez do caminho feliz.
    const anterior = await import('@store/atlas-namespace.js');
    await anterior.getGlobalStore().clear();
    vi.resetModules();

    ns = await import('@store/atlas-namespace.js');
    api = await import('@store/local-atlas.api.js');
    ({ consumePendingEbgeoImport: consumidor } = await import('@js/deep-link/pending-import.js'));
    await api.initLocalAtlases({ origin: { kind: 'local', atlasId: null } });
    expect(quantos()).toBe(1);
});

describe('a premissa desta régua', () => {
    it('a versão do arquivo ruim está mesmo ACIMA do teto desta build', () => {
        // Se o teto subir acima de 3.1, é esta linha que avisa, em vez de os casos abaixo
        // passarem a medir um arquivo aceitável achando que medem um recusado.
        expect(compareVersions(ACIMA_DO_TETO, ATLAS_SCHEMA_VERSION)).toBeGreaterThan(0);
    });
});

describe('arquivo RECUSADO: nenhum atlas local nasce', () => {
    const RUINS = [
        {
            nome: 'versão acima do teto (o arquivo de uma build mais nova)',
            bytes: () => ebgeo({ version: ACIMA_DO_TETO, maps: {} }),
            trecho: 'muito recente',
        },
        {
            nome: 'arquivo CORROMPIDO (não é zip nenhum)',
            bytes: async () => new TextEncoder().encode('isto nao e um zip').buffer,
            trecho: 'Erro ao carregar o arquivo',
        },
        {
            nome: 'zip SEM data.json',
            bytes: async () => {
                const zip = new JSZip();
                zip.file('leiame.txt', 'nada aqui');
                return (await zip.generateAsync({ type: 'uint8array' })).buffer;
            },
            trecho: 'data.json',
        },
        {
            nome: 'documento SEM versão',
            bytes: () => ebgeo({ maps: {} }),
            trecho: 'sem informação de versão',
        },
        {
            nome: 'versão abaixo do mínimo aceito',
            bytes: () => ebgeo({ version: '1.0', schemaVersion: '2.1', maps: {} }),
            trecho: 'incompatível',
        },
    ];

    it.each(RUINS)('$nome', async ({ bytes, trecho }) => {
        const erro = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const antes = quantos();

        const service = importador();
        const assumiu = await consumir(await bytes(), service);

        const depois = quantos();
        // A AFIRMAÇÃO CENTRAL, e a que não tem erro quando quebra: a lista de atlas locais tem o
        // mesmo tamanho antes e depois.
        expect(depois, 'um atlas local nasceu de um import recusado').toBe(antes);
        // E o importador nem foi chamado: recusar depois de importar seria recusar tarde demais.
        expect(service.processFileDirectly).not.toHaveBeenCalled();
        expect(assumiu).toBe(false);
        // A pessoa ouve o porquê, sempre.
        expect(avisos).toHaveLength(1);
        expect(avisos[0].level).toBe('error');
        expect(avisos[0].message).toContain(trecho);
        erro.mockRestore();
    });

    it('a entrega some do banco global mesmo assim (uma tentativa por arquivo)', async () => {
        const erro = vi.spyOn(console, 'warn').mockImplementation(() => {});
        await consumir(await ebgeo({ version: ACIMA_DO_TETO, maps: {} }));
        expect(await ns.getGlobalStore().getItem('pending_import')).toBeNull();
        erro.mockRestore();
    });

    it('dez recusas seguidas continuam deixando a lista do mesmo tamanho', async () => {
        // O dano que o achado descrevia é CUMULATIVO: repetir dez vezes travava a criação de atlas.
        const erro = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const antes = quantos();
        for (let i = 0; i < 10; i++) {
            await consumir(await ebgeo({ version: ACIMA_DO_TETO, maps: {} }));
        }
        expect(quantos()).toBe(antes);
        erro.mockRestore();
    });
});

describe('CONTROLE POSITIVO: o arquivo BOM cria exatamente um atlas e é importado', () => {
    it('a vaga é gasta uma vez, e o importador recebe o arquivo', async () => {
        const antes = quantos();
        const service = importador();

        const assumiu = await consumir(await ebgeo(documentoBom()), service);

        expect(assumiu).toBe(true);
        expect(quantos()).toBe(antes + 1);
        expect(service.processFileDirectly).toHaveBeenCalledTimes(1);
        expect(importados).toEqual(['Operação Alfa.ebgeo']);
        expect(avisos).toEqual([]);
    });

    it('e o atlas criado leva o nome da entrega', async () => {
        await consumir(await ebgeo(documentoBom()));
        expect(api.listLocalAtlases().some((a) => a.name.startsWith('Operação Alfa'))).toBe(true);
    });
});
