// Path: js/layers/feature-images.js

/**
 * @fileoverview Resolves which MapLibre images a feature collection needs.
 *
 * The symbol layers declare `icon-image: [get, id]`, so an image-backed feature
 * renders only if an image named after its own `properties.id` is registered on
 * the map. Two paths register them: the boot path (layer_setup.setImages) and
 * the paste path (ClipboardManager.loadPastedImages). Each used to keep its own
 * hand-written list of buckets, and the paste one was written before
 * coordination measures and magnetic declinations existed, so those pasted
 * invisible. Both now read the single derived list below.
 *
 * Pure and dependency-light on purpose (its only import is a leaf constants
 * module), so it stays testable in plain node.
 */

import { IMAGE_RESOURCE_STORAGE_TYPES } from '@js/store/store.constants.js';

/**
 * Collects the image ids required by every image-backed feature in a collection.
 * @param {Object<string, Array<Object>>} [featuresByStorageType] - Feature
 *   collection keyed by storage type (e.g. `coordination_measures`). Missing or
 *   non-array buckets are skipped.
 * @returns {string[]} Unique `properties.id` values, in bucket order.
 */
export function collectImageResourceIds(featuresByStorageType) {
    if (!featuresByStorageType) return [];

    const imageIds = new Set();

    for (const storageType of IMAGE_RESOURCE_STORAGE_TYPES) {
        const features = featuresByStorageType[storageType];
        if (!Array.isArray(features)) continue;

        for (const feature of features) {
            const imageId = feature?.properties?.id;
            if (imageId) imageIds.add(imageId);
        }
    }

    return [...imageIds];
}

/**
 * Collects the pixel ratio each image-backed feature was rasterized at.
 *
 * Quem rasteriza acima do tamanho logico (a medida de coordenacao, para o simbolo nao
 * borrar quando o `icon-size` cresce com o zoom) grava a razao na feicao. Feicao antiga,
 * salva antes disso, nao tem a chave: ela vale 1, que e o comportamento de sempre, e por
 * isso projeto ja salvo continua do mesmo tamanho.
 *
 * @param {Object<string, Array<Object>>} [featuresByStorageType] - Feature collection
 *   keyed by storage type. Missing or non-array buckets are skipped.
 * @returns {Map<string, number>} Image id to pixel ratio, only for ids above 1
 */
export function collectImageResourceRatios(featuresByStorageType) {
    const razoes = new Map();

    if (!featuresByStorageType) return razoes;

    for (const storageType of IMAGE_RESOURCE_STORAGE_TYPES) {
        const features = featuresByStorageType[storageType];
        if (!Array.isArray(features)) continue;

        for (const feature of features) {
            const imageId = feature?.properties?.id;
            const razao = Number(feature?.properties?.pixelRatio);

            if (imageId && Number.isFinite(razao) && razao > 1) {
                razoes.set(imageId, razao);
            }
        }
    }

    return razoes;
}
