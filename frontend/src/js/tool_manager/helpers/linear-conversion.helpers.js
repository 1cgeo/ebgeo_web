// Path: js/tool_manager/helpers/linear-conversion.helpers.js

/**
 * @fileoverview A EXECUÇÃO da conversão entre linha, seta e limite: a decisão mora em
 * `linear-conversion.model.js` (puro, node-testável) e aqui fica o que toca store, mapa e
 * tela. Um caminho só para os SEIS sentidos, no lugar das duas conversões escritas à mão que
 * saíam de linha e mais nada.
 *
 * ================= A ORDEM É CONTRATO, E CADA PASSO PAGA UM DEFEITO ===========
 *
 *   1. GATE ANTES DE QUALQUER TRABALHO. Posto pelas DUAS capacidades e estado pelo cadeado.
 *      Antes, o gate não existia: `addFeature` devolvia `undefined` para um Leitor ou para
 *      um mapa travado e o código seguia, escrevendo nas fontes e reselecionando uma feição
 *      que a store nunca aceitou. No F5 a antiga voltava e a nova sumia.
 *   2. CRIA PRIMEIRO, APAGA DEPOIS. Uma falha de persistência no meio não pode perder a
 *      feição de origem; ela pode, no máximo, deixar as duas vivas, que é o desfecho que a
 *      pessoa vê e desfaz.
 *   3. `if (!created) return false`. É a leitura do retorno que faltava. `addFeature` recusa
 *      em SILÊNCIO (a frase quem diz é `store-error-listener.js`, pelo evento que a store
 *      emite), e ignorar esse `undefined` é o que produzia o fantasma em dobro.
 *   4. LIMPA O ARTEFATO DA ORIGEM. Uma linha com medição carrega uma etiqueta que só o
 *      controle dela sabe apagar, e um limite carrega círculos e rótulos chaveados por
 *      `parent` em duas fontes derivadas. `removeFeature` cru não alcança nenhum dos dois, e
 *      o que sobra na tela é uma etiqueta ou um par de círculos sem dono, para sempre.
 *   5. LOTE DE DESFAZER COM DUAS SAÍDAS. `commitBatchUndo` no sucesso e `discardBatchUndo`
 *      no fracasso: fechar o lote no `finally` sem distinguir gravava meia conversão como
 *      um passo de desfazer, e um Ctrl+Z sobre ela ressuscitava a metade errada.
 *
 * ================= O QUE ELE NÃO CONSERTA, DECLARADO =========================
 *
 * O GRUPO. `removeFeature` chama `removeFeatureFromAllGroups`, e a store não tem operação
 * que acrescente uma feição a um grupo EXISTENTE, então a feição nova não volta para o grupo
 * da antiga. A perda é dita ao usuário no mesmo toast do sucesso, em vez de descoberta
 * depois; recolocá-la exigiria uma operação de sync nova, que é outra mudança.
 *
 * O DESFAZER NÃO REPINTA AS FONTES. É pré-existente e vale para as conversões de ponto
 * também: o lote restaura a store, e o desenho só volta na próxima releitura das fontes.
 */

import {
    addFeature,
    removeFeature,
    startBatchUndo,
    commitBatchUndo,
    discardBatchUndo,
    isCurrentMapLockedSync,
    isFeatureEffectivelyLocked,
    getStorageTypeFromSource,
    getCurrentMapNameSync,
    getFeatureGroup,
    getEventBus,
} from '@store';
import { checkPermission } from '@store/sync/permission-guard.js';
import { denialNotice } from '@store/denial-phrases.js';
import { IDUtils, showSuccess, showWarning } from '@utils';
import { EventTypes } from '@events';
import { getGeoJsonDispatcher } from '@layers/geojson-dispatcher.js';
import { ensureControl, controlKeyForFeatureType } from '../tool-registry.js';
import {
    LINEAR_SOURCES,
    LINEAR_CONVERSION_CAPABILITIES,
    LOCKED_FEATURE_NOTICE,
    LOCKED_MAP_NOTICE,
    MERGED_ARROW_NOTICE,
    SHORT_SPINE_NOTICE,
    buildConvertedProperties,
    describeConversionLoss,
    isMergedArrow,
    resolveSpineCoordinates,
} from './linear-conversion.model.js';

/** A frase de quando a ferramenta de destino não carregou. @type {string} */
const TOOL_UNAVAILABLE_NOTICE = 'A ferramenta de destino não está disponível agora.';

/** A frase de quando a geometria do destino recusa o eixo (vértices perto demais). @type {string} */
const INVALID_SPINE_NOTICE = 'O eixo desta feição é curto demais para o tipo de destino.';

/** A frase de uma falha inesperada no meio da travessia. @type {string} */
const CONVERSION_FAILED_NOTICE = 'Não foi possível converter a feição.';

/**
 * O `checkPermission` das DUAS capacidades, com a frase da que recusou.
 *
 * A frase vem de `denialNotice(perm.required)`, keyed pela CAPACIDADE que o gate consultou e
 * não pelo papel: um Editor recusado no DELETE precisa ler que apagar exige outro nível, e
 * não que ele "não pode editar este projeto", que é demonstravelmente falso porque ele
 * acabou de editar.
 *
 * @returns {{allowed: boolean, notice: string|null}} Veredito e a frase da recusa
 */
function checkConversionPermission() {
    for (const key of LINEAR_CONVERSION_CAPABILITIES) {
        // A CHAVE, nunca o valor: `checkPermission` resolve `GuardAction[action]` por dentro,
        // e é a chave que ele devolve em `action` para diagnóstico. Passar o valor funciona
        // por acaso (o `|| action` do fallback) e perde a metade legível do relato.
        const perm = checkPermission(key);
        if (!perm.allowed) return { allowed: false, notice: denialNotice(perm.required) };
    }
    return { allowed: true, notice: null };
}

/**
 * A instância do controle de um tipo de feição, carregando a ferramenta se preciso.
 *
 * `selectionManager.controls.get(...)` sozinho NÃO basta neste branch: seta e limite são
 * ferramentas TARDIAS (`tool-registry.js`), e converter é justamente o gesto que alcança um
 * tipo sem nunca ter clicado no botão dele na barra. Sem esta carga, converter para seta num
 * mapa recém-aberto simplesmente não fazia nada.
 *
 * @param {string} featureType - `properties.source` do tipo desejado
 * @returns {Promise<Object|null>} A instância, ou null
 */
async function loadControlFor(featureType) {
    const controlKey = controlKeyForFeatureType(featureType);
    if (!controlKey) return null;
    try {
        return await ensureControl(controlKey);
    } catch (error) {
        console.error(`Failed to load the control for '${featureType}':`, error);
        return null;
    }
}

/**
 * A geometria do destino para este eixo e estas propriedades.
 *
 * As TRÊS assinaturas divergem, e a divergência é do produto, não deste arquivo: a linha
 * recebe só as coordenadas, a seta recebe eixo mais propriedades, e o limite lê o eixo de
 * DENTRO das propriedades e ainda quer o zoom (é o zoom que decide o tamanho desenhado do
 * escalão). Concentrá-las aqui é o que deixa o resto do arquivo sem um `if` por tipo.
 *
 * @param {Object} control - Controle do tipo de destino
 * @param {string} target - Tipo de destino
 * @param {Array<Array<number>>} spine - Eixo
 * @param {Object} properties - Propriedades já montadas
 * @param {number} currentZoom - Zoom corrente
 * @returns {Object|null} Geometria GeoJSON, ou null
 */
function generateTargetGeometry(control, target, spine, properties, currentZoom) {
    if (target === 'boundary') return control.geometry.generate(properties, currentZoom);
    if (target === 'arrow') return control.geometry.generate(spine, properties);
    return control.geometry.generate(spine);
}

/**
 * O eixo passa na validação do DESTINO?
 *
 * As distâncias mínimas entre vértices divergem por tipo (1 m na linha, 5 m no limite, 10 m
 * na seta), então um eixo perfeitamente válido como linha pode ser recusado como seta. Quem
 * decide é a geometria de destino, nunca uma cópia da regra aqui.
 *
 * @param {Object} control - Controle do tipo de destino
 * @param {string} target - Tipo de destino
 * @param {Array<Array<number>>} spine - Eixo
 * @param {Object} properties - Propriedades já montadas
 * @returns {boolean} True quando o destino aceita o eixo
 */
function validateForTarget(control, target, spine, properties) {
    try {
        if (typeof control.geometry?.validate !== 'function') return true;
        if (target === 'arrow') return control.geometry.validate(spine, properties) !== false;
        return control.geometry.validate(spine) !== false;
    } catch (error) {
        console.warn(`Target geometry validation threw for '${target}':`, error);
        return false;
    }
}

/**
 * Apaga a feição de ORIGEM junto com os artefatos que só ela tinha.
 *
 * O limite sai pelo `deleteFeatures` do próprio controle, e não por um `removeFeature` cru,
 * porque é ele que roda dentro da fila serial do controle e é a única coisa que sabe filtrar
 * por `parent` as duas fontes derivadas. Filtrar aqui competiria com aquela fila: uma passada
 * de zoom em voo leria a coleção antes do filtro e a escreveria de volta depois.
 *
 * @param {Object} config - Contexto da remoção
 * @param {Object|null} config.control - Controle da origem, se carregado
 * @param {string} config.source - Tipo de origem
 * @param {Object} config.feature - Feição de origem
 * @param {Object} config.map - Instância do MapLibre
 * @returns {Promise<void>} Resolve quando store e fontes estão limpas
 */
async function removeSourceFeature({ control, source, feature, map }) {
    const featureId = feature.properties.id;

    if (source === 'boundary' && typeof control?.deleteFeatures === 'function') {
        await control.deleteFeatures([feature]);
        return;
    }

    if (source === 'line' && typeof control?.removeFeatureMeasurement === 'function') {
        control.removeFeatureMeasurement(featureId);
    }

    const storage = getStorageTypeFromSource(source);
    await removeFeature(storage, featureId);

    const dispatcher = getGeoJsonDispatcher(map, storage);
    dispatcher.remove(featureId);
    await dispatcher.flush();
}

/**
 * CONVERTE UMA FEIÇÃO LINEAR EM OUTRA, em qualquer dos seis sentidos.
 *
 * @param {Object} feature - Feição de origem (linha, seta ou limite)
 * @param {string} target - Tipo de destino
 * @param {Object} selectionManager - SelectionManager (dono do mapa e dos controles)
 * @param {Object} uiManager - UIManager, para repintar painel e realce
 * @returns {Promise<boolean>} True quando a travessia terminou inteira
 */
export async function convertLinearFeature(feature, target, selectionManager, uiManager) {
    const map = selectionManager?.map;
    const source = feature?.properties?.source;

    if (!map || !LINEAR_SOURCES.includes(source) || !LINEAR_SOURCES.includes(target) || source === target) {
        return false;
    }

    // POSTO. A recusa fala aqui, com a frase da capacidade que o gate consultou.
    const perm = checkConversionPermission();
    if (!perm.allowed) {
        showWarning(perm.notice);
        return false;
    }

    // ESTADO. As quatro recusas reversíveis, cada uma nomeando o próprio estado.
    if (isCurrentMapLockedSync()) {
        showWarning(LOCKED_MAP_NOTICE);
        return false;
    }
    if (isFeatureEffectivelyLocked(feature)) {
        showWarning(LOCKED_FEATURE_NOTICE);
        return false;
    }
    if (isMergedArrow(feature.properties)) {
        showWarning(MERGED_ARROW_NOTICE);
        return false;
    }

    const spine = resolveSpineCoordinates(feature);
    if (!spine) {
        showWarning(SHORT_SPINE_NOTICE);
        return false;
    }

    const targetControl = await loadControlFor(target);
    if (!targetControl?.geometry) {
        showWarning(TOOL_UNAVAILABLE_NOTICE);
        return false;
    }
    // A origem é carregada TAMBÉM, e não por simetria: é dela que vem a limpeza do artefato,
    // e uma feição pode estar na tela sem que a ferramenta que a desenha tenha sido tocada
    // nesta sessão (recarregar a página traz as feições, não os controles tardios).
    const sourceControl = await loadControlFor(source);

    const currentZoom = map.getZoom();
    const { id: featureId, geoJsonId } = IDUtils.generateFeatureIds();
    const featureName = await IDUtils.generateFeatureName(target, map);

    const defaults = targetControl.constructor?.DEFAULT_PROPERTIES || {};
    const properties = buildConvertedProperties({
        feature,
        target,
        defaults,
        id: featureId,
        nome: featureName,
        currentZoom,
        adaptiveWidth: typeof targetControl.calculateWidthForZoom === 'function'
            ? targetControl.calculateWidthForZoom(currentZoom)
            : undefined,
        adaptiveSymbolSize: typeof targetControl.calculateSymbolSizeForZoom === 'function'
            ? targetControl.calculateSymbolSizeForZoom(currentZoom)
            : undefined,
    });

    if (!properties) {
        showWarning(SHORT_SPINE_NOTICE);
        return false;
    }

    if (!validateForTarget(targetControl, target, spine, properties)) {
        showWarning(INVALID_SPINE_NOTICE);
        return false;
    }

    const geometry = generateTargetGeometry(targetControl, target, spine, properties, currentZoom);
    if (!geometry || !geometry.coordinates) {
        showWarning(INVALID_SPINE_NOTICE);
        return false;
    }

    const converted = { type: 'Feature', id: geoJsonId, properties, geometry };

    // Lido ANTES da remoção, que é o que apaga a filiação: depois, a resposta é sempre nula
    // e o aviso nunca sairia.
    let inGroup = false;
    try {
        inGroup = Boolean(getFeatureGroup(source, feature.properties.id));
    } catch (error) {
        console.warn('Could not read the group of the source feature:', error);
    }

    selectionManager.deselectAllFeatures();

    const targetStorage = getStorageTypeFromSource(target);
    const targetDispatcher = getGeoJsonDispatcher(map, targetStorage);

    let ok = false;
    startBatchUndo();
    try {
        const created = await addFeature(targetStorage, converted);
        // A ÚNICA LEITURA QUE IMPORTA: `undefined` significa recusado, e a store já mostrou
        // (ou vai mostrar) a frase. Seguir daqui é escrever nas fontes um trabalho que a
        // persistência não aceitou.
        if (!created) return false;

        targetDispatcher.add(converted);

        if (target === 'boundary' && typeof targetControl.updateDependentFeatures === 'function') {
            // Os círculos e os rótulos são derivados e vivem em fontes próprias. A falha aqui
            // não pode desfazer a conversão: ela custa a decoração, não a feição.
            try {
                await targetControl.updateDependentFeatures(converted);
            } catch (error) {
                console.error('Failed to build the dependent features of the new boundary:', error);
            }
        }

        await removeSourceFeature({ control: sourceControl, source, feature, map });
        await targetDispatcher.flush();
        ok = true;
    } catch (error) {
        console.error(`Error converting '${source}' to '${target}':`, error);
        showWarning(CONVERSION_FAILED_NOTICE);
        return false;
    } finally {
        // Duas saídas, e não um `commit` incondicional: um lote parcial gravado como passo de
        // desfazer ressuscita a metade errada no primeiro Ctrl+Z.
        if (ok) commitBatchUndo();
        else discardBatchUndo();
    }

    await selectionManager.toggleFeatureSelection(target, featureId, converted);
    uiManager?.updateSelectionHighlight?.();
    uiManager?.updatePanels?.();

    getEventBus().emit(EventTypes.LAYERS_CHANGED, { mapName: getCurrentMapNameSync() });

    const loss = describeConversionLoss({ source, target, inGroup });
    showSuccess(loss ? `Feição convertida. ${loss}` : 'Feição convertida.');
    return true;
}
