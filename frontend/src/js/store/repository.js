// Path: js/store/repository.js

/**
 * @fileoverview Repository facade - backward compatibility layer.
 *
 * This file exists for backward compatibility during the migration to the
 * new repository pattern. New code should import directly from:
 * - ./repository.utils.js - for utility functions (cleanFeature, compareVersions, etc.)
 * - ./memory-store.js - for runtime memory state
 * - ./repositories/index.js - for data access operations
 *
 * The following functions are still implemented here because they need whole-store
 * access for initialization and bulk operations:
 * - initializeRepository() - initializes the data layer and runs migrations
 * - clearAllAtlasStores() - the single bulk clear of every per-atlas database
 *
 * Which DATABASE those stores are is decided by the namespace factory
 * (`atlas-namespace.js`) at CALL time, never at module load; the accessors below and the
 * ones in `repositories/local.repository.js` share one resolver on purpose.
 */

import { ATLAS_RECORD_KEY, StoreName, listAtlasStores, getActiveScope } from './atlas-namespace.js';
// A FOLHA, nunca a fila de blobs: aquele módulo carrega o cliente HTTP, e este arquivo é alcançado
// pelo repositório inteiro. O que se precisa daqui é só reconhecer uma pendência dentro do banco de
// imagens, que é exatamente o que a folha existe para publicar.
import { limparImagensPoupandoUploads } from './sync/blob-upload-keys.js';
// A folha sem imports, pelo mesmo motivo da linha acima: este arquivo é alcançado pelo repositório.
import { forgetPersonViews } from './vista-da-pessoa-disco.js';
import { ensureAtlasScope, getScopedStore } from './repositories/local.repository.js';
import {
    detectMigrationNeeded,
    assertActiveSlotSupported,
    migrateActiveSlot,
    safelyMigrate
} from './migration/migration.service.js';
import { runLegacyMigrations } from './migration/legacy-backfills.js';
import { ATLAS_SCHEMA_VERSION } from './atlas/atlas.entity.js';
import config from '../config.js';
import { createSyncMetadata } from './sync/sync-metadata.js';
import { DEFAULT_MAP_NAME } from './store.constants.js';

// Re-export from repository.utils.js for backward compatibility
export {
    SCHEMA_VERSION,
    MIN_SCHEMA_VERSION,
    MAX_SCHEMA_VERSION,
    cleanFeature,
    isInternalProperty,
    compareVersions,
    getEmptyMapData,
    getDefaultLayer,
    getEmptyCesium3dData,
    getEmptyStreetview360Data
} from './repository.utils.js';

// Re-export from memory-store.js for backward compatibility
export { memoryStore, resetMemoryStore } from './memory-store.js';

// Import for internal use
import {
    MIN_SCHEMA_VERSION,
    compareVersions,
    getEmptyMapData
} from './repository.utils.js';
import { memoryStore } from './memory-store.js';

// ===== STORE ACCESSORS =====
// Resolved through the namespace factory on every call, never captured at module load:
// a handle taken here at import time is bound to whichever atlas was active when this
// module was first evaluated, and would keep writing there after a switch, silently.
// `getScopedStore` (repositories/local.repository.js) is shared with the repository
// implementation so both halves of this front resolve through ONE code path.

const atlasStore = () => getScopedStore(StoreName.ATLAS);
const mapStore = () => getScopedStore(StoreName.MAPS);
const imageStore = () => getScopedStore(StoreName.IMAGES);
const appStore = () => getScopedStore(StoreName.SETTINGS);
const groupStore = () => getScopedStore(StoreName.GROUPS);
const layerStore = () => getScopedStore(StoreName.LAYERS);

// ===== HELPER FUNCTIONS FOR INITIALIZATION =====

/**
 * Clears all legacy stores and resets schema version.
 */
async function clearLegacyStores() {
    // EM PARALELO, pela mesma razao de `clearAllAtlasStores` logo abaixo: sao cinco bancos
    // IndexedDB distintos, sem dependencia nenhuma entre si, e o laco com `await` dentro
    // pagava cinco idas ao disco EM FILA por uma ordem que ninguem pediu. No boot de uma
    // instalacao NOVA (o caso medido: `schemaVersion` nulo) esta funcao e o trecho mais caro
    // de `initializeRepository`, porque cada `clear()` tambem CRIA o banco: tres deles
    // (imagens, grupos, camadas) o boot nao toca por mais nada. Medido em A/B pareado, com o
    // banco vazio: 8,0 ms em serie contra 3,5 ms em paralelo (mediana de 5 boots de cada,
    // alternados na mesma sessao).
    //
    // `allSettled` E NAO `all`: com `all` a primeira rejeicao devolve o controle e as outras
    // quatro limpezas seguem sem observador, o que transforma um erro em rejeicoes nao
    // tratadas e num apagamento parcial silencioso. Com `allSettled` todas sao aguardadas e
    // so entao a primeira falha e relancada, para que `checkAndCleanLegacyData` continue
    // vendo como falha o que falhou.
    const resultados = await Promise.allSettled([
        mapStore().clear(),
        imageStore().clear(),
        appStore().clear(),
        groupStore().clear(),
        layerStore().clear()
    ]);
    const falha = resultados.find((resultado) => resultado.status === 'rejected');
    if (falha) throw falha.reason;

    // After clearing, the store is EMPTY — a brand-new repository. It will be rebuilt at the current
    // schema (getEmptyMapData produces v2.2), so stamp it at the CURRENT version, NOT the legacy 1.7.
    // This is the fresh-install (null version) and too-old-to-migrate (data discarded) path; either
    // way there is nothing to migrate, so the Atlas migration chain must be skipped. Pre-existing
    // repos at a still-supported older version are NOT cleared here and DO migrate (runLegacyMigrations
    // + detectMigrationNeeded), honoring "migrate old repos per their version; create new ones current".
    await appStore().setItem('schemaVersion', ATLAS_SCHEMA_VERSION);
}

/**
 * How much the active scope holds, in the databases `clearLegacyStores` would empty.
 *
 * BY KEYS, and only of those four: the question is whether there is something to LOSE, not what
 * it is. A read that throws answers "there is data", because "I could not tell" must never be
 * the reason a repository is destroyed; in that case the count comes back null, so the caller
 * says "unknown" out loud instead of printing a zero nobody measured.
 *
 * @returns {Promise<{temDado: boolean, chaves: number|null}>} `chaves` is the total number of
 *   keys across maps, images, groups and layers, or null when the scope could not be measured.
 */
async function medirEscopo() {
    try {
        const contagens = await Promise.all([
            mapStore().keys(),
            imageStore().keys(),
            groupStore().keys(),
            layerStore().keys()
        ]);
        const chaves = contagens.reduce((total, lista) => total + lista.length, 0);
        return { temDado: chaves > 0, chaves };
    } catch (error) {
        console.error('Boot do atlas: nao foi possivel medir o escopo; nada sera apagado', error);
        return { temDado: true, chaves: null };
    }
}

/**
 * Whether the scope's OWN atlas record declares the CURRENT schema.
 *
 * It is the second marker every scope carries (`effectiveVersion`, `migration.service.js`, reasons
 * with the same pair), and it is what separates the one population that reaches the settings
 * marker absent WITH data and is not a mystery: an atlas whose data came from the server. The
 * snapshot staging writes the atlas record (born by `createAtlas`, so at the current schema) into
 * a fresh generation and, until 2026-09-22, never the settings marker; the entry wipe that used to
 * stamp it (`clearAllDataStore`) left the opening path on 2026-09-19. Result: every F5 on a server
 * atlas (and on a slot rescued from one, which is the same databases) printed "ESCOPO PRESERVADO"
 * as an error (13 occurrences in 5 signatures on release 1c3c19c9), and nothing ever stamped it.
 *
 * A read that throws answers false, which sends the caller down the preservation path it would
 * have taken anyway: a failure here must never be the reason anything is written.
 *
 * @returns {Promise<boolean>}
 */
async function registroDeclaraEsquemaCorrente() {
    try {
        const registro = await atlasStore().getItem(ATLAS_RECORD_KEY);
        return registro?.schemaVersion === ATLAS_SCHEMA_VERSION;
    } catch {
        return false;
    }
}

/**
 * Writes the settings marker the atlas record already vouches for, and says so ONCE.
 *
 * WHY THIS IS NOT A WEAKER GUARD. The guard exists because an absent marker over data cannot tell
 * "installation older than the marker" from "marker lost", and destroying on a guess cost a whole
 * workspace. Here there is no guess: the record of the same scope says the data is at the current
 * schema, which is exactly the version the legacy chain has nothing to do for, and nothing is
 * erased on either branch. A scope with data and NO such record keeps the loud preservation path.
 * The same repair already exists for isolated copies (`prepareIsolatedScope`, `prepare-scope.js`).
 *
 * `console.info` and not `error`: it is the expected state of scopes born before the snapshot
 * stamped its generation, and an error here is a telemetry defect per boot. After the write the
 * next boot reads a trustworthy marker and says nothing.
 *
 * @returns {Promise<boolean>} True when the marker was written (the caller may trust it); false
 *   when the write failed, in which case nothing else is written in this boot either.
 */
async function repararCarimboPeloRegistro() {
    try {
        await appStore().setItem('schemaVersion', ATLAS_SCHEMA_VERSION);
    } catch (error) {
        // Aviso e não erro: o dado está intacto e o próximo boot tenta de novo. Um escopo de
        // servidor cuja cerca de escrita fechou (saída da conta em outra aba) cai aqui.
        console.warn(
            'Boot do atlas: carimbo de esquema ausente e o registro declara '
            + `${ATLAS_SCHEMA_VERSION}; o reparo do carimbo falhou, NADA foi apagado`, error
        );
        return false;
    }
    console.info(
        `Boot do atlas: carimbo de esquema reposto em ${ATLAS_SCHEMA_VERSION} a partir do registro `
        + 'de atlas do mesmo escopo; nada foi apagado'
    );
    return true;
}

/**
 * Checks and cleans incompatible legacy data.
 *
 * A READ THAT FAILS IS NOT A VERDICT ABOUT THE DATA, and treating it as one is what this
 * function used to do: the `catch` of `getItem('schemaVersion')` called `clearLegacyStores()`,
 * so any transient IndexedDB error (an `InvalidStateError` after another tab's `versionchange`,
 * an `UnknownError` from disk, a quota failure) emptied five databases and stamped the current
 * version over the remains. Measured over a 14-map / 149-image workspace of the other product
 * line: every map and every blob gone, no line on screen, and the atlas record left describing
 * an acervo that no longer exists.
 *
 * AND ABSENCE OF THE MARKER IS NOT PROOF OF AGE EITHER. A missing `schemaVersion` means two
 * indistinguishable things (an installation older than the marker, which is empty, and a scope
 * whose marker was lost, which may be full), and the destructive reading was applied to both.
 * The question that separates them is about CONTENT, and it is cheap: `medirEscopo`. One case is
 * settled BEFORE that question: when the scope's own atlas record declares the current schema, the
 * marker is merely missing, and it is written back (`repararCarimboPeloRegistro`).
 *
 * WHAT HAPPENS TO A SCOPE TOO OLD TO MIGRATE THAT NEVERTHELESS HOLDS DATA (a stamp below
 * `MIN_SCHEMA_VERSION`): it is PRESERVED, the boot reports the refusal naming the stamp and the
 * number of keys it is refusing to destroy, the legacy chain does not run over it, and the boot
 * goes on. Not destroying comes before migrating: that population is from before 2026 and is
 * nearly nil, while the cost of being wrong is somebody's whole workspace. The user is left with
 * an app that opens on data an old chain will not touch, which is recoverable; the previous
 * behaviour was not.
 *
 * @returns {Promise<boolean>} Whether the marker read is TRUSTWORTHY, i.e. whether the caller
 *   may reason with what it finds in `schemaVersion` afterwards. False means "I do not know",
 *   and the legacy chain is skipped for this boot rather than run on a guess.
 */
async function checkAndCleanLegacyData() {
    let currentSchemaVersion = null;
    try {
        currentSchemaVersion = await appStore().getItem('schemaVersion');
    } catch (error) {
        console.error(
            'Boot do atlas: nao foi possivel ler o carimbo de esquema; nada sera apagado', error
        );
        return false;
    }

    if (currentSchemaVersion && compareVersions(currentSchemaVersion, MIN_SCHEMA_VERSION) >= 0) {
        return true;
    }

    // A SEGUNDA TESTEMUNHA, antes de medir: o registro de atlas do MESMO escopo. Ver
    // `repararCarimboPeloRegistro`. Só o carimbo AUSENTE entra aqui; um carimbo presente e velho
    // contradiz o registro e continua no caminho de preservação abaixo.
    if (currentSchemaVersion == null && await registroDeclaraEsquemaCorrente()) {
        return await repararCarimboPeloRegistro();
    }

    const escopo = await medirEscopo();
    if (escopo.temDado) {
        console.error(
            'Boot do atlas: ESCOPO PRESERVADO. Carimbo de esquema '
            + `${currentSchemaVersion ?? 'ausente'} (minimo ${MIN_SCHEMA_VERSION}) sobre um escopo com `
            + `${escopo.chaves ?? 'um numero desconhecido de'} chave(s) em mapas, imagens, grupos e `
            + 'camadas: NADA foi apagado, a cadeia legada nao roda neste boot, e o boot segue'
        );
        return false;
    }

    await clearLegacyStores();
    return true;
}

// ===== INITIALIZATION =====

/**
 * GRAVA o mapa padrão em branco no escopo montado e o deixa corrente.
 *
 * POR QUE É UMA FUNÇÃO E NÃO UM BLOCO. Dois caminhos precisam do mesmo mapa em branco:
 * `initializeRepository`, quando o escopo não tem mapa nenhum, e o wipe de `store.js` que
 * NÃO vai reinicializar o repositório (a saída da conta, onde a linha seguinte destrói o
 * namespace que a inicialização acabaria de preparar). Copiar o bloco resolveria o mesmo
 * dia e divergiria no seguinte: a condicional do hillshade é a metade que envelhece, e duas
 * cópias dela produzem dois mapas em branco diferentes conforme o caminho.
 *
 * A INVARIANTE ESTÁ NO `setItem`, não no retorno: quem chama devolve este nome aos ouvintes
 * de `ALL_DATA_CLEARED`, que leem o registro pelo nome. Devolver `DEFAULT_MAP_NAME` sem
 * gravar faria essa leitura achar um registro ausente, e o mapa em branco viraria mapa
 * nenhum.
 *
 * @returns {Promise<string>} O nome do mapa padrão, já gravado no escopo montado.
 */
export async function seedBlankDefaultMap() {
    const newMapData = getEmptyMapData();

    if (config.map2d?.hillshade?.enabled === true) {
        // Reference + per-atlas state, like every other catalog-layer write. Hillshade
        // refers to no catalog resource (its definition is the static `config.map2d`
        // block), so the reference is the bare id and the type; the name is resolved on
        // read by `catalogLayerDisplayName`.
        newMapData.catalogLayers = [{
            id: 'hillshade',
            type: 'hillshade',
            visible: true,
            opacity: 1,
            status: 'active',
            sync: createSyncMetadata(null)
        }];
    }

    await mapStore().setItem(DEFAULT_MAP_NAME, newMapData);
    memoryStore.currentMap = DEFAULT_MAP_NAME;
    return DEFAULT_MAP_NAME;
}

/**
 * Initializes the repository, runs migrations, and returns the last active map.
 * @returns {Promise<string>} Last active map name
 */
export async function initializeRepository({ strict = false, installation = true } = {}) {
    try {
        ensureAtlasScope();
        await assertActiveSlotSupported();
        const carimboConfiavel = await checkAndCleanLegacyData();

        // A CADEIA LEGADA SÓ RODA SOBRE UM CARIMBO EM QUE SE PODE CONFIAR. Com o carimbo ilegível
        // ou ausente sobre um escopo com dado, `runLegacyMigrations(null)` gravaria
        // `SCHEMA_VERSION`, que é o LEGADO '1.7' e não a versão corrente: é a mesma "entrada 1.7"
        // que a decisão de 2026-09-07 nomeia como a mais cara da outra linha, escrita aqui pelo
        // próprio boot. Quem decide a versão nesse estado é `detectMigrationNeeded`, que lê o
        // registro de atlas (`effectiveVersion`).
        if (carimboConfiavel) {
            const currentSchemaVersion = await appStore().getItem('schemaVersion');
            ensureAtlasScope();
            await runLegacyMigrations(currentSchemaVersion, getActiveScope());
        }

        // ===== TWO MIGRATION TARGETS, AND THEY ARE NOT INTERCHANGEABLE =====
        // First the INSTALLATION upgrade, on the pre-namespace databases: it is what
        // registers local slot #1 and what discards a store whose origin marker says the
        // data belongs to a server atlas. Aiming this pass at the mounted scope instead
        // would point it at an empty namespace on exactly the boot where the residue it
        // has to reach sits in the unsuffixed databases.
        const { needed } = installation ? await detectMigrationNeeded() : { needed: false };
        if (needed) {
            console.log('Running v2.0 migration...');
            const result = await safelyMigrate();
            if (result.success) {
                console.log('v2.0 migration completed successfully');
            } else {
                console.error('v2.0 migration failed:', result.error);
            }
        }

        // Then the MOUNTED slot, which the pass above cannot speak for: with one namespace
        // per atlas, a slot carrying older data used to be compared against slot #1's stamp
        // and skipped, with no error and no log. `migrateActiveSlot` returns without
        // touching storage when the mounted scope is not a namespaced local slot that needs
        // work; the reasons are enumerated in `migration.service.js`.
        await migrateActiveSlot();

        const allMapNames = await mapStore().keys();
        if (allMapNames.length === 0) {
            return await seedBlankDefaultMap();
        }

        const lastActiveMap = await appStore().getItem('lastActiveMap');
        const activeMap = (lastActiveMap && allMapNames.includes(lastActiveMap))
            ? lastActiveMap
            : allMapNames[0];

        memoryStore.currentMap = activeMap;
        return activeMap;
    } catch (error) {
        console.error('Error initializing repository:', error);
        if (strict || error?.name === 'MigrationRecoveryError') throw error;
        return await mapaDeEmergencia();
    }
}

/**
 * Qual mapa o boot abre quando a inicialização falhou no meio.
 *
 * O `catch` devolvia `DEFAULT_MAP_NAME` SEMPRE, e num acervo vindo da outra linha nenhum dos 14
 * mapas se chama assim: uma falha de cota no carimbo do degrau 3.0 deixava o usuário dentro de um
 * mapa que o acervo dele não tem, com o acervo inteiro no disco e nada na tela. O erro é REAL e
 * continua sendo relatado; o que muda é que a entrada passa a ser um mapa que EXISTE.
 *
 * Uma leitura que também falhe cai no mapa padrão, que é o único nome que o repositório sabe
 * semear: aqui a ignorância é o estado, e não um palpite.
 *
 * @returns {Promise<string>} Chave de um mapa existente, ou o mapa padrão.
 */
async function mapaDeEmergencia() {
    try {
        const nomes = await mapStore().keys();
        if (nomes.length > 0) {
            const preferido = await appStore().getItem('lastActiveMap');
            const escolhido = nomes.includes(preferido) ? preferido : nomes[0];
            memoryStore.currentMap = escolhido;
            return escolhido;
        }
    } catch (leitura) {
        console.error('Boot do atlas: nao foi possivel escolher um mapa de entrada:', leitura);
    }
    memoryStore.currentMap = DEFAULT_MAP_NAME;
    return DEFAULT_MAP_NAME;
}

// ===== BULK CLEAR (DERIVED FROM THE STORE LIST, NOT HAND-LISTED) =====

/**
 * EMPTIES every per-atlas database of the atlas currently mounted. One function replaces
 * the two parallel hand-written lists that lived in `store.js` (the wipe on logout and the
 * wipe on "clear everything"), which nothing forced to stay in sync: a side-store added to
 * one list and forgotten in the other left server data behind on exactly one of the paths.
 *
 * The list is now DERIVED, not hand-written: `listAtlasStores()` returns exactly the
 * descriptors marked `perAtlas`, so a database added to the factory is wiped here without
 * anyone remembering this function. The hand-written half that used to sit above (a table
 * of module-level handles keyed by store id, with a throw for the entry someone forgot)
 * disappeared with the lazy accessors: there is nothing left to forget.
 *
 * What it covers, and why it is worth naming: the atlas record (atlas-level settings such
 * as `terrainExaggeration` that a remote atlas writes), the ENTIRE app-settings store
 * (per-map color usage, notes, grid style, temporal config, saved position, base layer,
 * map lock, plus the schema version and the origin marker), and every side-store (groups,
 * layers, 3D, 360, briefings, spatial comments, images).
 *
 * CLEAR IS NOT DELETE. `clear()` empties a database and leaves it standing, which is what
 * unmounting the current atlas means. Destroying a slot's databases is `dropAtlasDatabases`
 * (`atlas-namespace.js`), reached only by deleting a local atlas.
 *
 * ONE DATABASE HAS SOMETHING THE SERVER CANNOT GIVE BACK, and that is the exception below. Every
 * other byte here is re-fetchable from the snapshot the caller pulls next; a blob whose upload is
 * still pending is not, because the server never received it. `preserveBlobUploads` keeps those
 * records and their bytes, and the caller decides it with the SAME answer it gives for the
 * outbound queue (`clearQueue`, `store.js`): the blob is the payload of an operation in that
 * queue, so the two have one lifetime. See `limparImagensPoupandoUploads`.
 *
 * @param {object} [options]
 * @param {boolean} [options.preserveBlobUploads=false] - Whether to keep the pending image
 *   uploads of this scope (and the blobs they name) instead of emptying them with the rest.
 * @returns {Promise<void>}
 */
export async function clearAllAtlasStores({ preserveBlobUploads = false } = {}) {
    // `listAtlasStores()` resolves against the ACTIVE scope and throws when there is none,
    // so the scope has to be settled before the set is resolved. O `.map` abaixo é síncrono e
    // roda depois desta linha, então a ordem continua a mesma que o laço tinha.
    ensureAtlasScope();

    // A VISTA LEMBRADA DA PESSOA SAI JUNTO, no mesmo tique em que o escopo é lido: ela descreve os
    // mapas do conteúdo que este wipe troca, e o `Principal` chaveado por NOME que o "Limpar Tudo"
    // recria herdaria a base escolhida para o mapa que acabou de sumir. Mora em `localStorage`, fora
    // da lista abaixo (`store/vista-da-pessoa-disco.js`).
    const escopoDoWipe = getActiveScope();
    if (escopoDoWipe) forgetPersonViews(escopoDoWipe.dbSuffix);

    // EM PARALELO, e a razão é que não há dependência nenhuma entre os dez: são bancos
    // IndexedDB distintos, e o laço com `await` dentro pagava dez idas ao disco em fila por
    // uma ordem que ninguém pediu. Esta função só espera; o tempo dela é latência, não conta.
    //
    // `allSettled` E NÃO `all`, e a diferença importa aqui: com `all` a primeira rejeição
    // devolve o controle a quem chamou e as outras nove limpezas seguem sem observador, o que
    // transforma um erro em nove rejeições não tratadas e num wipe parcial silencioso. Com
    // `allSettled` toda limpeza é aguardada, e só então a primeira falha é relançada, para que
    // o chamador continue vendo um wipe que falhou como falha.
    const resultados = await Promise.allSettled(
        listAtlasStores().map(({ id, store }) => (
            preserveBlobUploads && id === StoreName.IMAGES
                ? limparImagensPoupandoUploads(store)
                : store.clear()
        ))
    );

    const falha = resultados.find(resultado => resultado.status === 'rejected');
    if (falha) throw falha.reason;
}

// ===== APP SETTINGS (needed by store.js for setSchemaVersion) =====

/**
 * Sets an app setting.
 * @param {string} key - Setting key
 * @param {any} value - Setting value
 */
export async function setAppSetting(key, value) {
    await appStore().setItem(key, value);
}

// ===== COLOR USAGE =====
//
// O `getColorUsage` que morava aqui SAIU em 2026-09-01, e o motivo e que ele lia a chave errada.
// Ele montava `color_usage_${mapName}` com o nome CRU, enquanto o escritor
// (`setColorUsageCompat`, em `repositories/index.js`) monta a chave RESOLVIDA, que num mapa
// keyado por UUID e o UUID. Os dois batem neste mesmo store de settings, entao a divergencia era
// so a string, e medida ela custava a secao inteira: gravado sob `color_usage_<uuid>`, lido sob
// `color_usage_<nome>`, o retorno era `{}` e o `colorUsage` sumia do `.ebgeo` e do envio ao
// servidor de todo mapa de atlas sincronizado ou importado.
//
// Nao foi substituido por nada aqui de proposito. O leitor com resolucao e fallback ja existia
// (`getColorUsageCompat`), `store-state-manager.js` ja o usava, e o barril passou a exporta-lo
// sob o mesmo apelido. Deixar o irmao errado de pe, ainda que sem chamador, so daria a alguem o
// que reimportar. Guarda: `frontend/tests/integration/coloruso-le-a-chave-resolvida.test.js`.

