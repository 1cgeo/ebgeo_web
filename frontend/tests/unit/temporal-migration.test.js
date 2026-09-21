// Path: tests/unit/temporal-migration.test.js

/**
 * @fileoverview O DEGRAU 2.1 -> 2.2 (Módulo Temporal), EXECUTADO.
 *
 * O DEFEITO QUE ESTE ARQUIVO CONSERTA É DELE MESMO (achado S11 da auditoria de 2026-09-21).
 * A versão anterior declarava, no cabeçalho, que "a migração toca IndexedDB (não testável em
 * node)" e media outra coisa no lugar: quatro casos de `compareVersions`, ou seja, a aritmética
 * de comparar duas strings de versão. `migrateToV2_2` nunca era chamada. Apagar o corpo inteiro
 * daquela função deixava os quatro casos VERDES, que é a definição de cobertura vazia: o verde
 * não estava provando nada sobre o degrau.
 *
 * A premissa também era falsa desde antes de ser escrita: `tests/setup/indexeddb.setup.js` liga
 * `fake-indexeddb` em TODO arquivo da suíte (está no `setupFiles` do `vitest.config.js`), e os
 * vizinhos de migração já rodam a cadeia inteira contra bancos de verdade
 * (`tests/integration/migracao-22-para-23-fixture-real.test.js`).
 *
 * O QUE ESTE ARQUIVO MEDE, e por que cada caso existe:
 *  - o degrau carimba os DOIS marcadores que o detector lê (o registro de atlas e a chave
 *    `schemaVersion` do app settings), e carimba `'2.2'`, NUNCA `ATLAS_SCHEMA_VERSION`: um
 *    degrau que carimbasse a cabeça da cadeia marcaria o banco como totalmente migrado com os
 *    degraus seguintes por rodar, e a cadeia interrompida nunca mais retomaria, sem um erro;
 *  - o degrau é ADITIVO: nenhuma feição é reescrita e nenhuma config temporal é fabricada,
 *    porque os campos novos são opcionais e "ausente" já significa permanente;
 *  - o degrau escreve no ESCOPO QUE RECEBE. Esta é a metade que falha em silêncio: um degrau
 *    ancorado nos nomes fixos pré-namespace migra o banco errado quando o atlas montado é um
 *    slot, e o slot fica para trás sem nada ficar vermelho.
 *
 * O ALCANCE, dito em voz alta: aqui se mede o DEGRAU, chamado diretamente. Quem decide SE ele
 * roda é `detectMigrationNeeded` + `safelyMigrate` (`store/migration/migration.service.js`), e
 * é a integração citada acima que mede isso. Os dois últimos casos deste arquivo continuam
 * sendo sobre a cadeia (a comparação de versões que decide o encadeamento), e estão rotulados
 * como tal para não inflarem a conta do que foi verificado sobre a migração em si.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    countKeys,
    databaseExists,
    readDatabase,
    readKey,
    resetIndexedDB,
    seedDatabase,
} from '../helpers/idb-helpers.js';
import { compareVersions } from '../../src/js/store/repository.utils.js';
import { ATLAS_SCHEMA_VERSION } from '../../src/js/store/atlas/atlas.entity.js';

/** Slot namespaceado usado nos casos de escopo. Fixo para os nomes absolutos serem conhecidos. */
const SLOT_ID = 'cccccccc-3333-4444-8555-666666666666';

/** Nome do mapa semeado, e a chave de config temporal que ele NÃO deve ganhar. */
const MAPA = 'Principal';

/**
 * Importa os módulos frescos (o cache de instâncias de `atlas-namespace.js` é estado de módulo:
 * reusá-lo entre casos deixa um caso respondendo a pergunta do outro).
 * @returns {Promise<{ns: Object, migrateToV2_2: Function}>}
 */
async function carregarDegrau() {
    const ns = await import('@store/atlas-namespace.js');
    const { migrateToV2_2 } = await import('@store/migration/v2.1-to-v2.2.migration.js');
    return { ns, migrateToV2_2 };
}

/**
 * Nomes ABSOLUTOS de banco de um escopo, construídos pelo `resolveDbName` do produto e nunca
 * por concatenação aqui: uma segunda implementação da regra de nomes certificaria a própria
 * divergência.
 * @param {Object} ns - Módulo `atlas-namespace.js` já importado.
 * @param {{kind: string, dbSuffix: string}} scope
 * @returns {{atlas: string, settings: string, maps: string}}
 */
function nomesDe(ns, scope) {
    return {
        atlas: ns.resolveDbName(ns.StoreName.ATLAS, scope),
        settings: ns.resolveDbName(ns.StoreName.SETTINGS, scope),
        maps: ns.resolveDbName(ns.StoreName.MAPS, scope),
    };
}

/** O escopo pré-namespace (sufixo vazio), com os nomes afirmados como os desnudos. */
function escopoLegado(ns) {
    const scope = ns.localScope('legacy-workspace', ns.LEGACY_DB_SUFFIX);
    const nomes = nomesDe(ns, scope);
    // ASSERÇÃO DE INSTRUMENTO: a premissa de todo caso abaixo é "estes são os bancos
    // pré-namespace". Sem esta linha, uma mudança na regra de nomes moveria alvo e asserção
    // juntos e tudo continuaria verde sobre outro banco.
    expect(nomes.atlas).toBe('ebgeo_atlas');
    expect(nomes.settings).toBe('ebgeo_app_settings');
    expect(nomes.maps).toBe('ebgeo_maps');
    return { scope, nomes };
}

/** Um slot local namespaceado, com os nomes afirmados como os SUFIXADOS. */
function escopoDeSlot(ns, slotId = SLOT_ID) {
    const scope = ns.localScope(slotId, slotId);
    const nomes = nomesDe(ns, scope);
    expect(nomes.settings).toBe(`ebgeo_app_settings${ns.NAMESPACE_SEPARATOR}${slotId}`);
    expect(nomes.maps).toBe(`ebgeo_maps${ns.NAMESPACE_SEPARATOR}${slotId}`);
    return { scope, nomes };
}

/** Um registro de atlas plausível, carimbado na versão pedida. */
function registroDeAtlas(schemaVersion, extra = {}) {
    return {
        id: 'a1b2c3d4-0000-4000-8000-000000000001',
        name: 'Meu Atlas',
        schemaVersion,
        mapOrder: [MAPA],
        lastActiveMapId: null,
        settings: { terrainExaggeration: 1.5 },
        ...extra,
    };
}

/** Um mapa com feições SEM nenhum campo temporal (o estado de um repositório 2.1). */
function mapaSemTempo() {
    return {
        [MAPA]: {
            features: {
                points: [
                    { type: 'Feature', geometry: { type: 'Point', coordinates: [-47.9, -15.8] },
                        properties: { id: 'p1', nome: 'Ponto 1', source: 'point' } },
                ],
                lines: [
                    { type: 'Feature', geometry: { type: 'LineString', coordinates: [[-47.9, -15.8], [-47.8, -15.7]] },
                        properties: { id: 'l1', nome: 'Linha 1', source: 'line' } },
                ],
            },
        },
    };
}

/**
 * Semeia um repositório completo num escopo: registro de atlas, carimbo de settings e um mapa.
 * @param {{atlas: string, settings: string, maps: string}} nomes
 * @param {string} versao - Versão de partida dos dois marcadores.
 * @param {Object} ns - Módulo `atlas-namespace.js`.
 * @param {Object} [settingsExtras] - Chaves adicionais do app settings.
 */
async function semear(nomes, versao, ns, settingsExtras = {}) {
    await seedDatabase(nomes.atlas, { [ns.ATLAS_RECORD_KEY]: registroDeAtlas(versao) });
    await seedDatabase(nomes.settings, { schemaVersion: versao, mapOrder: [MAPA], ...settingsExtras });
    await seedDatabase(nomes.maps, mapaSemTempo());
}

beforeEach(async () => {
    vi.resetModules();
    await resetIndexedDB();
});

afterEach(async () => {
    vi.restoreAllMocks();
    await resetIndexedDB();
});

describe('migração do Módulo Temporal (2.1 -> 2.2), executada de verdade', () => {
    it('carimba os DOIS marcadores que o detector lê, e o dado do usuário atravessa intacto', async () => {
        const { ns, migrateToV2_2 } = await carregarDegrau();
        const { scope, nomes } = escopoLegado(ns);
        await semear(nomes, '2.1', ns);

        // ASSERÇÃO POSITIVA DO ANTES: sem ela, "terminou em 2.2" seria indistinguível de um
        // repositório que já estava lá, e o dado "sobreviveu" de um dado que nunca existiu.
        expect(await readKey(nomes.settings, 'schemaVersion')).toBe('2.1');
        expect((await readKey(nomes.atlas, ns.ATLAS_RECORD_KEY)).schemaVersion).toBe('2.1');
        const mapasAntes = await readDatabase(nomes.maps);
        expect(mapasAntes[MAPA].features.points).toHaveLength(1);

        const resultado = await migrateToV2_2(scope);

        expect(resultado).toEqual({ success: true });
        expect(await readKey(nomes.settings, 'schemaVersion')).toBe('2.2');
        expect((await readKey(nomes.atlas, ns.ATLAS_RECORD_KEY)).schemaVersion).toBe('2.2');
        // O registro de atlas é REESCRITO pelo degrau: tudo o que não é a versão tem de voltar
        // igual, senão o carimbo custa o nome e a ordem dos mapas do usuário.
        expect(await readKey(nomes.atlas, ns.ATLAS_RECORD_KEY))
            .toEqual(registroDeAtlas('2.2'));
        // E o degrau é ADITIVO: nenhuma feição é reescrita (os campos temporais são opcionais e
        // ausente já significa permanente), então os mapas voltam byte a byte.
        expect(await readDatabase(nomes.maps)).toEqual(mapasAntes);
    });

    it('carimba 2.2, NUNCA a cabeça da cadeia (o carimbo adiantado quebra a cadeia em silêncio)', async () => {
        const { ns, migrateToV2_2 } = await carregarDegrau();
        const { scope, nomes } = escopoLegado(ns);
        await semear(nomes, '2.1', ns);

        await migrateToV2_2(scope);

        // Hoje `ATLAS_SCHEMA_VERSION` vale '3.0', então esta igualdade JÁ é a acusação: um degrau
        // que carimbasse a constante marcaria o repositório como totalmente migrado com o degrau
        // 2.2 -> 3.0 por rodar, e `detectMigrationNeeded` responderia "nada a fazer" para sempre.
        expect(await readKey(nomes.settings, 'schemaVersion')).toBe('2.2');
        expect((await readKey(nomes.atlas, ns.ATLAS_RECORD_KEY)).schemaVersion).toBe('2.2');
        // A relação que torna a linha acima uma afirmação sobre a CADEIA e não sobre um literal.
        expect(compareVersions('2.2', ATLAS_SCHEMA_VERSION)).toBeLessThanOrEqual(0);
    });

    it('não fabrica config temporal para mapa nenhum (o degrau não faz backfill)', async () => {
        const { ns, migrateToV2_2 } = await carregarDegrau();
        const { scope, nomes } = escopoLegado(ns);
        await semear(nomes, '2.1', ns);

        const chavesAntes = await countKeys(nomes.settings);
        expect(chavesAntes).toBe(2); // schemaVersion + mapOrder

        await migrateToV2_2(scope);

        // O app settings é onde a config temporal moraria (`temporal_<mapa>`), e o degrau não
        // pode inventar nenhuma: um mapa sem config tem de continuar sem config, porque o padrão
        // é justamente "sem linha do tempo".
        const settings = await readDatabase(nomes.settings);
        expect(Object.keys(settings).filter((k) => k.startsWith('temporal_'))).toEqual([]);
        expect(await countKeys(nomes.settings)).toBe(chavesAntes);
        expect(settings.mapOrder).toEqual([MAPA]);
    });

    it('preserva uma config temporal que já exista (o degrau não a reescreve)', async () => {
        const { ns, migrateToV2_2 } = await carregarDegrau();
        const { scope, nomes } = escopoLegado(ns);
        const config = { ativo: true, unidade: 'HORA', inicio: 1700000000000, fim: 1700086400000, modo: 'absoluto', origem: null };
        await semear(nomes, '2.1', ns, { [`temporal_${MAPA}`]: config });

        await migrateToV2_2(scope);

        expect(await readKey(nomes.settings, `temporal_${MAPA}`)).toEqual(config);
        expect(await readKey(nomes.settings, 'schemaVersion')).toBe('2.2');
    });

    it('BORDA, repositório vazio: nada é fabricado, e o carimbo de settings sai assim mesmo', async () => {
        const { ns, migrateToV2_2 } = await carregarDegrau();
        const { scope, nomes } = escopoLegado(ns);

        expect(await databaseExists(nomes.atlas)).toBe(false);

        const resultado = await migrateToV2_2(scope);

        expect(resultado).toEqual({ success: true });
        // NENHUM registro de atlas é inventado: o degrau só carimba o que encontra. (O banco em
        // si passa a existir, porque ler uma chave já o cria; a afirmação que vale é sobre o
        // REGISTRO, não sobre o arquivo.)
        expect(await readKey(nomes.atlas, ns.ATLAS_RECORD_KEY)).toBeNull();
        // E o carimbo de settings sai do mesmo jeito, que é o que faz a cadeia continuar
        // encadeando num repositório recém-criado em vez de tentar o mesmo degrau para sempre.
        expect(await readKey(nomes.settings, 'schemaVersion')).toBe('2.2');
    });

    it('BORDA, já migrado: rodar de novo é inofensivo e não mexe em byte nenhum', async () => {
        const { ns, migrateToV2_2 } = await carregarDegrau();
        const { scope, nomes } = escopoLegado(ns);
        await semear(nomes, '2.1', ns);

        await migrateToV2_2(scope);
        const depoisDaPrimeira = {
            atlas: await readDatabase(nomes.atlas),
            settings: await readDatabase(nomes.settings),
            maps: await readDatabase(nomes.maps),
        };

        await migrateToV2_2(scope);

        expect(await readDatabase(nomes.atlas)).toEqual(depoisDaPrimeira.atlas);
        expect(await readDatabase(nomes.settings)).toEqual(depoisDaPrimeira.settings);
        expect(await readDatabase(nomes.maps)).toEqual(depoisDaPrimeira.maps);
    });

    it('escreve no ESCOPO QUE RECEBE: o slot montado anda e os bancos pré-namespace ficam onde estão', async () => {
        const { ns, migrateToV2_2 } = await carregarDegrau();
        const legado = escopoLegado(ns);
        const slot = escopoDeSlot(ns);
        await semear(legado.nomes, '2.1', ns);
        await semear(slot.nomes, '2.1', ns);

        // Os dois partem da MESMA versão de propósito: é o que impede o caso de passar por
        // acidente quando o alvo errado já estivesse adiantado.
        expect(await readKey(legado.nomes.settings, 'schemaVersion')).toBe('2.1');
        expect(await readKey(slot.nomes.settings, 'schemaVersion')).toBe('2.1');

        await migrateToV2_2(slot.scope);

        expect(await readKey(slot.nomes.settings, 'schemaVersion')).toBe('2.2');
        expect((await readKey(slot.nomes.atlas, ns.ATLAS_RECORD_KEY)).schemaVersion).toBe('2.2');
        // A METADE QUE FALHA CALADA: um degrau ancorado nos nomes fixos migraria daqui, e o slot
        // montado ficaria para trás com o produto inteiro achando que a cadeia correu.
        expect(await readKey(legado.nomes.settings, 'schemaVersion')).toBe('2.1');
        expect((await readKey(legado.nomes.atlas, ns.ATLAS_RECORD_KEY)).schemaVersion).toBe('2.1');
    });

    it('sem argumento, o alvo são os bancos pré-namespace (o padrão é o upgrade da INSTALAÇÃO)', async () => {
        const { ns, migrateToV2_2 } = await carregarDegrau();
        const legado = escopoLegado(ns);
        const slot = escopoDeSlot(ns);
        await semear(legado.nomes, '2.1', ns);
        await semear(slot.nomes, '2.1', ns);

        await migrateToV2_2();

        expect(await readKey(legado.nomes.settings, 'schemaVersion')).toBe('2.2');
        expect(await readKey(slot.nomes.settings, 'schemaVersion')).toBe('2.1');
    });
});

describe('a CADEIA em volta do degrau (comparação de versões, não o degrau)', () => {
    // Estes dois não alcançam `migrateToV2_2`: nenhuma mudança em `v2.1-to-v2.2.migration.js`
    // os deixa vermelhos, e por isso eles estão separados dos de cima em vez de inflarem a
    // conta do que foi verificado sobre a migração.
    it('todo repositório anterior a 2.2 dispara o degrau, e 2.2 não redispara', async () => {
        const dispara = (v) => compareVersions(v, '2.2') < 0;
        expect(dispara('1.7')).toBe(true);
        expect(dispara('2.0')).toBe(true);
        expect(dispara('2.1')).toBe(true);
        expect(dispara('2.2')).toBe(false);
        expect(dispara(ATLAS_SCHEMA_VERSION)).toBe(false);
    });

    it('o alvo do degrau fica no ou atrás do topo da cadeia, seja ele qual for', () => {
        // Esta linha já dizia `toBe('2.2')` e depois `toBe('2.3')`: as duas grafias fixavam o
        // TOPO da cadeia dentro de um arquivo que guarda o ELO 2.1 -> 2.2, e as duas reprovaram
        // código correto na vez seguinte em que o schema andou. Derivada da constante, ela
        // atravessou de 2.3 para 3.0 sem uma edição.
        expect(compareVersions('2.2', ATLAS_SCHEMA_VERSION)).toBeLessThanOrEqual(0);
    });
});
