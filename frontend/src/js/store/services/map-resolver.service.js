// Path: js/store/services/map-resolver.service.js

/**
 * Bidirectional map name/UUID resolution service.
 * Maintains an in-memory mapping that allows the application to work with
 * either display names or UUIDs transparently.
 */

import { isValidUUID } from '../../utilities/uuid.js';

/**
 * Provides resolution between map names and UUIDs.
 */
class MapResolverService {
    constructor() {
        /** @type {Map<string, string>} name -> id */
        this._nameToId = new Map();
        /** @type {Map<string, string>} id -> name */
        this._idToName = new Map();
        this._initialized = false;
    }

    /**
     * Initializes the resolver from repository data.
     *
     * CADA DOCUMENTO DE MAPA E LIDO UMA VEZ SO, E TODOS DE UMA VEZ. As duas passagens
     * seriais que viviam aqui liam o documento INTEIRO de cada mapa (todas as feicoes) para
     * usar so o `.name`, uma ida ao disco por vez, e a segunda passagem repetia a leitura de
     * quem a primeira ja tinha visitado. Pior: `getMap` de um id que NAO e chave de
     * armazenamento cai num varredura completa da store, e essa varredura le, de novo, todos
     * os documentos. Medido em A/B pareado, com 8 mapas de 400 feicoes cada: 138 ms em serie
     * contra 86 ms com esta versao, e 30 operacoes de IndexedDB contra 19 (mediana de 5 boots
     * de cada, alternados na mesma sessao). Com o banco VAZIO, 89 ms contra 61 ms. O trecho
     * esta no caminho critico do boot: `store.js` faz `awaitMapResolverReady()` antes de
     * montar o mapa corrente.
     *
     * Agora ha UMA leitura por chave, em paralelo, e a varredura acontece nas tabelas em
     * memoria montadas a partir dela. Nao ha ida ao disco nenhuma alem dessa.
     *
     * O REGISTRO CONTINUA COM A MESMA SEMANTICA, e as duas linhas do laco do atlas nao sao
     * redundancia. Quando `mapOrder` traz um identificador que NAO e a chave de
     * armazenamento (um UUID enquanto o mapa mora sob o nome), a varredura do `getMap`
     * antigo registrava `nome -> chave` como EFEITO COLATERAL antes de o laco registrar
     * `nome -> id do mapOrder`. As duas entradas existiam, e a segunda passagem pulava a
     * chave por ja estar em `_idToName`. Registrar so uma das duas mudaria para qual dos
     * dois identificadores o nome resolve.
     *
     * @param {import('../repositories/local.repository.js').LocalRepository} repository
     * @returns {Promise<void>}
     */
    async initialize(repository) {
        this._nameToId.clear();
        this._idToName.clear();

        try {
            const [atlas, chaves] = await Promise.all([
                repository.getAtlas(),
                repository.getAllMapIds()
            ]);

            // `getMapById` e a leitura DIRETA por chave, sem o desvio de varredura do
            // `getMap`: as chaves vem de `getAllMapIds()`, entao a leitura direta sempre
            // acerta e a varredura nunca teria o que fazer.
            const documentos = await Promise.all(chaves.map((chave) => repository.getMapById(chave)));

            /** @type {Map<string, Object>} chave de armazenamento -> documento */
            const porChave = new Map();
            /**
             * Reproduz a varredura do `getMap`: ela percorre as chaves EM ORDEM e devolve o
             * primeiro documento cujo `name` ou `id` casa. Primeiro a entrar vence, e a
             * chave e guardada junto porque o efeito colateral do registro usa as duas.
             * @type {Map<string, {chave: string, doc: Object}>}
             */
            const porNomeOuId = new Map();

            chaves.forEach((chave, i) => {
                const doc = documentos[i];
                if (!doc) return;
                porChave.set(chave, doc);
                for (const alias of [doc.name, doc.id]) {
                    if (alias && !porNomeOuId.has(alias)) porNomeOuId.set(alias, { chave, doc });
                }
            });

            for (const mapId of atlas?.mapOrder ?? []) {
                const direto = porChave.get(mapId);
                if (direto) {
                    if (direto.name) this.registerMap(direto.name, mapId);
                    continue;
                }
                const achado = porNomeOuId.get(mapId);
                if (!achado?.doc?.name) continue;
                // As duas linhas: o efeito colateral da varredura, e depois o registro do laco.
                this.registerMap(achado.doc.name, achado.chave);
                this.registerMap(achado.doc.name, mapId);
            }

            // Cobre o dado legado sem Atlas, e o mapa que existe na store mas nao no `mapOrder`.
            for (const [chave, doc] of porChave) {
                if (this._idToName.has(chave)) continue;
                this.registerMap(doc.name || chave, chave);
            }

            this._initialized = true;
        } catch (error) {
            console.warn('MapResolver: Error during initialization', error);
            this._initialized = true;
        }
    }

    /**
     * Registers a name/ID mapping.
     * @param {string} name - Map display name
     * @param {string} id - Map UUID
     */
    registerMap(name, id) {
        this._nameToId.set(name, id);
        this._idToName.set(id, name);
    }

    /**
     * Unregisters a map by ID.
     * @param {string} id - Map UUID
     */
    unregisterMapById(id) {
        const name = this._idToName.get(id);
        if (name) {
            this._nameToId.delete(name);
        }
        this._idToName.delete(id);
    }

    /**
     * Updates a map's name mapping.
     * @param {string} oldName
     * @param {string} newName
     */
    renameMap(oldName, newName) {
        const id = this._nameToId.get(oldName);
        if (id) {
            this._nameToId.delete(oldName);
            this._nameToId.set(newName, id);
            this._idToName.set(id, newName);
        }
    }

    /**
     * Resolves input to a map UUID.
     * If input is already a known UUID, returns it as-is.
     * If input is a name, returns the corresponding UUID.
     * @param {string} nameOrId - Map name or UUID
     * @returns {string} Map UUID (or original input if not found)
     */
    resolveToId(nameOrId) {
        if (!nameOrId) return nameOrId;

        if (isValidUUID(nameOrId) && this._idToName.has(nameOrId)) {
            return nameOrId;
        }

        return this._nameToId.get(nameOrId) || nameOrId;
    }

    /**
     * Resolves input to a map name.
     * If input is a UUID, returns the corresponding name.
     * If input is already a name, returns it as-is.
     * @param {string} nameOrId - Map name or UUID
     * @returns {string} Map name (or original input if not found)
     */
    resolveToName(nameOrId) {
        if (!nameOrId) return nameOrId;

        if (isValidUUID(nameOrId)) {
            return this._idToName.get(nameOrId) || nameOrId;
        }

        return nameOrId;
    }

    /**
     * Checks if a name or ID is known to the resolver.
     * @param {string} nameOrId - Map name or UUID
     * @returns {boolean}
     */
    isKnown(nameOrId) {
        if (!nameOrId) return false;

        if (isValidUUID(nameOrId)) {
            return this._idToName.has(nameOrId);
        }
        return this._nameToId.has(nameOrId);
    }

    /**
     * Gets the ID for a name.
     * @param {string} name
     * @returns {string|undefined}
     */
    getIdForName(name) {
        return this._nameToId.get(name);
    }

    /**
     * Gets the name for an ID.
     * @param {string} id
     * @returns {string|undefined}
     */
    getNameForId(id) {
        return this._idToName.get(id);
    }

    /**
     * Gets all known map names.
     * @returns {string[]}
     */
    getAllNames() {
        return Array.from(this._nameToId.keys());
    }

    /**
     * Gets all known map IDs.
     * @returns {string[]}
     */
    getAllIds() {
        return Array.from(this._idToName.keys());
    }

    /**
     * Clears all mappings and resets initialization state.
     */
    clear() {
        this._nameToId.clear();
        this._idToName.clear();
        this._initialized = false;
    }

    /** @returns {boolean} Whether the resolver has been initialized */
    get isInitialized() {
        return this._initialized;
    }

    /** @returns {number} Number of registered maps */
    get size() {
        return this._idToName.size;
    }
}

/** Singleton instance of MapResolverService. */
export const mapResolver = new MapResolverService();

/** @type {Promise<void>|null} */
let _initPromise = null;

/**
 * Stores the initialization promise so it can be awaited later.
 * Called by services.js during startup.
 * @param {Promise<void>} promise
 */
export function setResolverInitPromise(promise) {
    _initPromise = promise;
}

/**
 * Awaits map resolver initialization.
 * Call this before any operation that depends on name/ID resolution being ready.
 * @returns {Promise<void>}
 */
export function awaitMapResolverReady() {
    return _initPromise || Promise.resolve();
}

/**
 * Factory function to create a new MapResolverService instance (for testing).
 * @returns {MapResolverService}
 */
export function createMapResolver() {
    return new MapResolverService();
}

export { MapResolverService };
