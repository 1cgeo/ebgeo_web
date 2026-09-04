// Path: tests/unit/referencias-de-recurso-censo.test.js
//
// O CENSO DAS REFERÊNCIAS A RECURSO DE CATÁLOGO DENTRO DE UM ATLAS.
//
// A PERGUNTA É "ONDE MORA UM ID DE RECURSO", e ela é diferente da de
// `superficies-de-recurso-censo.test.js` (que pergunta "quem LÊ o catálogo"). Aqui o
// assunto é o dado do usuário: quando um atlas SAI do servidor (`.ebgeo`, "Salvar como
// local") ou é COPIADO para outro dono (clone, import), quais campos carregam a identidade
// de um recurso e precisam ser conferidos?
//
// O MODO DE FALHA QUE ISTO PEGA é o do inventário que envelhece: `tilesetId`, `photoName`,
// `modelId` e `photoId` nasceram DEPOIS da poda de definição da camada de catálogo, e
// nenhum deles foi coberto por ela — ninguém percebeu que a lista tinha crescido, porque
// não havia lista. Agora há (`resource-reference.registry.js`), e este arquivo é o que a
// mantém em dia: campo de referência em arquivo novo reprova até ser classificado.
//
// A VARREDURA VEM DO VERSIONAMENTO (`git ls-files -co --exclude-standard src/js`), nunca
// de alvos escritos à mão, e as DUAS bandeiras não são detalhe: `--others` acrescenta o
// arquivo escrito há cinco minutos, que é justamente o que ninguém classificou.
//
// A CHAVE É O PAR (arquivo, campo), como no censo irmão: um mesmo arquivo pode tocar dois
// campos com propósitos diferentes, e contá-lo uma vez faria a classe de um cobrir o outro.
//
// TRÊS COBRANÇAS CRUZADAS, e é a terceira que impede as duas metades de envelhecerem
// separadas: par não classificado reprova; toda entrada PODA nomeia uma superfície que
// EXISTE no registro; e toda superfície podável do registro é nomeada por ao menos uma
// entrada PODA.
//
// O QUE ESTE ARQUIVO NÃO PRENDE: comportamento. Que a poda tire o privado e mantenha o
// público é `poda-de-referencia-privada.test.js`; que ela feche no desconhecido é
// `poda-fecha-no-desconhecido.test.js`; que as duas cópias do registro concordem é
// `referencias-de-recurso-espelho.test.js`.
//
// A CONTAGEM EXATA É COBRADA SÓ ONDE ELA PAGA, e a escolha é medida e declarada: 102 pares
// com `n` exato transformariam qualquer edição de uma linha de UI num vermelho sem
// assunto, e um guarda ruidoso é um guarda que alguém desliga. O `n` é exigido das classes
// PODA e PERSISTE — os arquivos em que a referência é gravada ou retirada, onde apagar uma
// linha É a regressão — e as outras duas classes respondem só pela EXISTÊNCIA da entrada,
// que é o que faz o arquivo novo reprovar.

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    CAMPO_NAO_VARRIDO,
    prunableSurfaceIds,
    serverOnlySurfaceIds,
    REFERENCE_FIELD_NAMES,
} from '../../src/js/catalog/resource-reference.registry.js';

const RAIZ = fileURLToPath(new URL('../../', import.meta.url));

/** O campo é lido ou escrito por um caminho que PODA a referência na saída/cópia. */
const PODA = 'poda-a-referencia';
/** O campo declara uma superfície que SÓ o servidor poda (a família de `atlas.settings`). */
const PODA_SERVIDOR = 'poda-so-no-servidor';
/** O campo viaja para dentro de um documento PERSISTIDO (store, sync, transformação). */
const PERSISTE = 'persiste-a-referencia';
/** O campo só existe em memória: painel, visualizador, presença, busca, link. */
const RUNTIME = 'so-em-runtime';
/** Homônimo de OUTRO documento: a página de calibração, que não é um atlas. */
const OUTRO_DOCUMENTO = 'outro-documento';

const MOTIVO = Object.freeze({
    [PODA_SERVIDOR]: 'DECLARA uma superfície de referência cujo id nunca chega ao documento do '
        + 'cliente: as seis listas de `atlas.settings` vêm no snapshot, são aplicadas sobre o '
        + '`config` em MEMÓRIA e não são persistidas em store nenhum nem escritas no `.ebgeo`. '
        + 'Quem as poda é o clone/import, com teste próprio no backend. A classe existe porque a '
        + 'alternativa seria omiti-las do registro, que é exatamente o defeito que a onda achou: '
        + 'um inventário que se declara completo e não é.',
    [PODA]: 'Participa da PODA: declara a superfície, decide o veredito ou aplica a retirada. '
        + 'Uma linha que some daqui é uma referência que passa a viajar; por isso a contagem é '
        + 'exata nesta classe.',
    [PERSISTE]: 'GRAVA a referência num documento que sobrevive à sessão (store local, snapshot '
        + 'de sync, payload de envio) ou a transforma no caminho de entrada. É onde uma '
        + 'superfície NOVA nasce, e por isso a contagem também é exata aqui.',
    [RUNTIME]: 'Usa o campo só em memória (painel, visualizador 3D/360, presença, busca, deep '
        + 'link, cliente HTTP). Não cria superfície de persistência, então não é assunto da '
        + 'poda — mas fica censado para que a próxima leitura não precise redescobrir isso.',
    [OUTRO_DOCUMENTO]: 'A página `calibracao.html` tem vocabulário próprio e não monta store '
        + 'nenhum: o `photoId` dela é do estúdio de calibração, não de um documento de atlas. '
        + 'Está no censo para que a colisão de nome fique declarada em vez de descoberta.',
});

/**
 * @typedef {Object} Entrada
 * @property {string} arquivo
 * @property {string} campo
 * @property {number} [n] - Linhas de contato. Exigido em PODA e PERSISTE.
 * @property {string} classe
 * @property {string[]} [superficies] - Ids do registro que este par cobre. Exigido em PODA
 *   e em PODA_SERVIDOR (contra listas DIFERENTES: `prunableSurfaceIds` e `serverOnlySurfaceIds`),
 *   e é uma LISTA porque um campo cobre várias superfícies: `tilesetId` no podador atende os
 *   QUATRO coletores 3D, e uma entrada escalar deixaria três deles sem podador declarado.
 */

/** @type {Entrada[]} */
const CENSO = [
    { arquivo: 'src/js/catalog/private-reference-pruner.js', campo: 'tilesetId', n: 3, classe: PODA, superficies: ['cesium3d.cameraPositions', 'cesium3d.markers', 'cesium3d.measurements', 'cesium3d.viewsheds'] },
    { arquivo: 'src/js/catalog/private-reference-pruner.js', campo: 'photoName', n: 1, classe: PODA, superficies: ['sv360.orientations', 'sv360.markers'] },
    { arquivo: 'src/js/catalog/private-reference-pruner.js', campo: 'modelId', n: 4, classe: PODA, superficies: ['briefing.slide.modelId'] },
    { arquivo: 'src/js/catalog/private-reference-pruner.js', campo: 'photoId', n: 4, classe: PODA, superficies: ['briefing.slide.photoId'] },
    { arquivo: 'src/js/catalog/private-reference-pruner.js', campo: 'baseLayer', n: 4, classe: PODA, superficies: ['mapa.baseLayer'] },
    { arquivo: 'src/js/catalog/private-reference-pruner.js', campo: 'catalogLayers', n: 3, classe: PODA, superficies: ['mapa.catalogLayers'] },
    { arquivo: 'src/js/catalog/resource-reference.registry.js', campo: 'tilesetId', n: 4, classe: PODA, superficies: ['cesium3d.cameraPositions', 'cesium3d.markers', 'cesium3d.measurements', 'cesium3d.viewsheds'] },
    { arquivo: 'src/js/catalog/resource-reference.registry.js', campo: 'photoName', n: 2, classe: PODA, superficies: ['sv360.orientations', 'sv360.markers'] },
    { arquivo: 'src/js/catalog/resource-reference.registry.js', campo: 'modelId', n: 3, classe: PODA, superficies: ['briefing.slide.modelId'] },
    { arquivo: 'src/js/catalog/resource-reference.registry.js', campo: 'photoId', n: 3, classe: PODA, superficies: ['briefing.slide.photoId'] },
    { arquivo: 'src/js/catalog/resource-reference.registry.js', campo: 'baseLayer', n: 4, classe: PODA, superficies: ['mapa.baseLayer'] },
    { arquivo: 'src/js/catalog/resource-reference.registry.js', campo: 'default_basemap', n: 4, classe: PODA_SERVIDOR, superficies: ['settings.default_basemap', 'settings.basemaps'] },
    { arquivo: 'src/js/catalog/resource-reference.registry.js', campo: 'available_data_layers', n: 3, classe: PODA_SERVIDOR, superficies: ['settings.available_data_layers'] },
    { arquivo: 'src/js/catalog/resource-reference.registry.js', campo: 'available_analysis_layers', n: 3, classe: PODA_SERVIDOR, superficies: ['settings.available_analysis_layers'] },
    { arquivo: 'src/js/catalog/resource-reference.registry.js', campo: 'available_3d_models', n: 3, classe: PODA_SERVIDOR, superficies: ['settings.available_3d_models'] },
    { arquivo: 'src/js/catalog/resource-reference.registry.js', campo: 'available_360_views', n: 3, classe: PODA_SERVIDOR, superficies: ['settings.available_360_views'] },
    { arquivo: 'src/js/catalog/resource-reference.registry.js', campo: 'catalogLayers', n: 3, classe: PODA, superficies: ['mapa.catalogLayers'] },
    { arquivo: 'src/js/catalog/resource-reference.resolver.js', campo: 'modelId', n: 1, classe: PODA, superficies: ['briefing.slide.modelId'] },
    { arquivo: 'src/js/catalog/resource-reference.resolver.js', campo: 'photoId', n: 1, classe: PODA, superficies: ['briefing.slide.photoId'] },
    { arquivo: 'src/js/catalog/resource-reference.resolver.js', campo: 'baseLayer', n: 1, classe: PODA, superficies: ['mapa.baseLayer'] },
    { arquivo: 'src/js/catalog/resource-reference.resolver.js', campo: 'catalogLayers', n: 1, classe: PODA, superficies: ['mapa.catalogLayers'] },
    // Entrou em 2026-08-24, quando o relato de poda do CLONE passou a ser mostrado ao usuário:
    // `descreverPerdasDoServidor` reusa a MESMA tabela de rótulos do aviso de saída, e o servidor
    // anota esta superfície, que o cliente não tem. É rótulo de tela, não sítio de referência: o
    // id nunca chega ao documento do cliente, que é a definição de `poda-so-no-servidor`.
    { arquivo: 'src/js/catalog/resource-reference.resolver.js', campo: 'default_basemap', n: 1, classe: PODA_SERVIDOR, superficies: ['settings.default_basemap'] },
    { arquivo: 'src/js/3d_models_viewer_tool/add_3d_models_viewer_control.js', campo: 'tilesetId', classe: RUNTIME },
    { arquivo: 'src/js/3d_models_viewer_tool/marker-features.js', campo: 'tilesetId', classe: RUNTIME },
    { arquivo: 'src/js/3d_models_viewer_tool/components/marker-panel-3d.js', campo: 'tilesetId', classe: RUNTIME },
    { arquivo: 'src/js/3d_models_viewer_tool/components/measurement-panel-3d.js', campo: 'tilesetId', classe: RUNTIME },
    { arquivo: 'src/js/3d_models_viewer_tool/components/panel-shared-3d.js', campo: 'tilesetId', classe: RUNTIME },
    { arquivo: 'src/js/3d_models_viewer_tool/components/viewshed-panel-3d.js', campo: 'tilesetId', classe: RUNTIME },
    { arquivo: 'src/js/3d_models_viewer_tool/map_3d.js', campo: 'tilesetId', classe: RUNTIME },
    { arquivo: 'src/js/3d_models_viewer_tool/map_3d.js', campo: 'baseLayer', classe: RUNTIME },
    { arquivo: 'src/js/3d_models_viewer_tool/tools/marker_tool_3d.js', campo: 'tilesetId', classe: RUNTIME },
    { arquivo: 'src/js/3d_models_viewer_tool/tools/measurement_tool_3d.js', campo: 'tilesetId', classe: RUNTIME },
    { arquivo: 'src/js/3d_models_viewer_tool/tools/viewshed_tool_3d.js', campo: 'tilesetId', classe: RUNTIME },
    // HOMÓNIMO DE VOCABULÁRIO, e não um campo: em `uso-phrases.js` `baseLayer` é CHAVE da
    // tabela que traduz o `entityType` do sync para pt-BR na aba Uso ("Camadas de fundo"). Nenhum
    // id de recurso passa por ali, e nada daquele arquivo escreve documento nenhum. Mesma classe e
    // mesma razão de `events/event_types.js` logo abaixo, que também só carrega o NOME.
    { arquivo: 'src/js/admin/uso-phrases.js', campo: 'baseLayer', classe: RUNTIME },
    { arquivo: 'src/js/base-layer-selector/base-layer-selector.control.js', campo: 'baseLayer', classe: RUNTIME },
    { arquivo: 'src/js/baselayers/base-layer.control.js', campo: 'baseLayer', classe: RUNTIME },
    { arquivo: 'src/js/baselayers/base-layer.control.js', campo: 'catalogLayers', classe: RUNTIME },
    { arquivo: 'src/js/briefing/editor/briefing-editor.control.js', campo: 'tilesetId', classe: RUNTIME },
    { arquivo: 'src/js/briefing/editor/briefing-editor.control.js', campo: 'photoName', classe: RUNTIME },
    { arquivo: 'src/js/briefing/editor/briefing-editor.control.js', campo: 'modelId', classe: RUNTIME },
    { arquivo: 'src/js/briefing/editor/briefing-editor.control.js', campo: 'photoId', classe: RUNTIME },
    { arquivo: 'src/js/briefing/presentation/transition.service.js', campo: 'tilesetId', classe: RUNTIME },
    { arquivo: 'src/js/briefing/presentation/transition.service.js', campo: 'modelId', classe: RUNTIME },
    { arquivo: 'src/js/briefing/presentation/transition.service.js', campo: 'photoId', classe: RUNTIME },
    { arquivo: 'src/js/briefing/validation/reference-validator.js', campo: 'modelId', classe: RUNTIME },
    { arquivo: 'src/js/briefing/validation/reference-validator.js', campo: 'photoId', classe: RUNTIME },
    { arquivo: 'src/js/calibration/api.js', campo: 'photoId', classe: OUTRO_DOCUMENTO },
    { arquivo: 'src/js/calibration/app.js', campo: 'photoId', classe: OUTRO_DOCUMENTO },
    { arquivo: 'src/js/calibration/calibration-panel.js', campo: 'photoId', classe: OUTRO_DOCUMENTO },
    { arquivo: 'src/js/calibration/preview-viewer.js', campo: 'photoId', classe: OUTRO_DOCUMENTO },
    { arquivo: 'src/js/calibration/project-map.js', campo: 'photoId', classe: OUTRO_DOCUMENTO },
    { arquivo: 'src/js/calibration/state.js', campo: 'photoId', classe: OUTRO_DOCUMENTO },
    // Entrou com a pirâmide de tiles da panorâmica (integração main/360, 2026-08-21): o
    // visualizador do estúdio pede a foto por uuid para escolher o nível da escada. Mesma
    // classe dos seis vizinhos, e pela mesma razão: `calibracao.html` não monta store e o
    // `photoId` daqui não chega a documento de atlas nenhum.
    { arquivo: 'src/js/calibration/viewer.js', campo: 'photoId', classe: OUTRO_DOCUMENTO },
    { arquivo: 'src/js/catalog/catalog.modal.js', campo: 'photoId', classe: RUNTIME },
    { arquivo: 'src/js/comment_tool/comments-panel.js', campo: 'baseLayer', classe: RUNTIME },
    { arquivo: 'src/js/deep-link/deep-link.js', campo: 'tilesetId', classe: RUNTIME },
    { arquivo: 'src/js/deep-link/deep-link.js', campo: 'photoName', classe: RUNTIME },
    { arquivo: 'src/js/events/event_types.js', campo: 'baseLayer', classe: RUNTIME },
    { arquivo: 'src/js/features_tab/models3d-section.component.js', campo: 'tilesetId', classe: RUNTIME },
    { arquivo: 'src/js/features_tab/streetview360-section.component.js', campo: 'photoName', classe: RUNTIME },
    { arquivo: 'src/js/features_tab/streetview360-section.component.js', campo: 'photoId', classe: RUNTIME },
    { arquivo: 'src/js/import_export/export-import.service.js', campo: 'baseLayer', n: 2, classe: PODA, superficies: ['mapa.baseLayer'] },
    { arquivo: 'src/js/import_export/export-import.service.js', campo: 'catalogLayers', n: 2, classe: PODA, superficies: ['mapa.catalogLayers'] },
    { arquivo: 'src/js/import_export/import-normalize.js', campo: 'catalogLayers', n: 3, classe: PERSISTE },
    { arquivo: 'src/js/import_export/local-atlas-to-server.js', campo: 'tilesetId', n: 1, classe: PERSISTE },
    { arquivo: 'src/js/import_export/local-atlas-to-server.js', campo: 'photoName', n: 1, classe: PERSISTE },
    { arquivo: 'src/js/import_export/local-atlas-to-server.js', campo: 'modelId', n: 1, classe: PERSISTE },
    { arquivo: 'src/js/import_export/local-atlas-to-server.js', campo: 'photoId', n: 1, classe: PERSISTE },
    { arquivo: 'src/js/import_export/local-atlas-to-server.js', campo: 'baseLayer', n: 1, classe: PERSISTE },
    { arquivo: 'src/js/import_export/local-atlas-to-server.js', campo: 'catalogLayers', n: 1, classe: PERSISTE },
    { arquivo: 'src/js/layers/layer_setup.js', campo: 'catalogLayers', classe: RUNTIME },
    { arquivo: 'src/js/modals/atlas-settings.modal.js', campo: 'available_data_layers', n: 2, classe: PERSISTE },
    { arquivo: 'src/js/modals/atlas-settings.modal.js', campo: 'available_analysis_layers', n: 2, classe: PERSISTE },
    { arquivo: 'src/js/modals/atlas-settings.modal.js', campo: 'available_3d_models', n: 2, classe: PERSISTE },
    { arquivo: 'src/js/modals/atlas-settings.modal.js', campo: 'available_360_views', n: 2, classe: PERSISTE },
    { arquivo: 'src/js/presence/presence-bridge.js', campo: 'tilesetId', classe: RUNTIME },
    { arquivo: 'src/js/presence/presence-bridge.js', campo: 'photoName', classe: RUNTIME },
    { arquivo: 'src/js/presence/presence-store.js', campo: 'tilesetId', classe: RUNTIME },
    { arquivo: 'src/js/presence/presence-store.js', campo: 'photoName', classe: RUNTIME },
    // O leitor de namespace de "Enviar ao servidor" na tela de escolha: lê os dois campos do
    // documento de mapa no IndexedDB e os entrega a `buildServerImportPayload`, que é quem poda.
    { arquivo: 'src/js/projects/send-local-to-server.service.js', campo: 'baseLayer', n: 1, classe: PERSISTE },
    { arquivo: 'src/js/projects/send-local-to-server.service.js', campo: 'catalogLayers', n: 1, classe: PERSISTE },
    { arquivo: 'src/js/search/feature-search.control.js', campo: 'tilesetId', classe: RUNTIME },
    { arquivo: 'src/js/search/search-bar.component.js', campo: 'tilesetId', classe: RUNTIME },
    { arquivo: 'src/js/search/search-bar.search-providers.js', campo: 'tilesetId', classe: RUNTIME },
    { arquivo: 'src/js/sidebar/handlers/feature-3d-handlers.js', campo: 'tilesetId', classe: RUNTIME },
    { arquivo: 'src/js/sidebar/handlers/feature-3d-handlers.js', campo: 'photoName', classe: RUNTIME },
    { arquivo: 'src/js/sidebar/sidebar.control.js', campo: 'tilesetId', classe: RUNTIME },
    { arquivo: 'src/js/sidebar/sidebar.control.js', campo: 'photoName', classe: RUNTIME },
    { arquivo: 'src/js/state/state_manager.js', campo: 'baseLayer', classe: RUNTIME },
    { arquivo: 'src/js/store/briefing.operations.js', campo: 'modelId', n: 1, classe: PERSISTE },
    { arquivo: 'src/js/store/briefing.operations.js', campo: 'photoId', n: 1, classe: PERSISTE },
    // 17 e nao 16 desde que `revalidateCatalogLayers` passou a DEVOLVER a lista revalidada: o
    // painel de feicoes lia o documento de mapa inteiro uma segunda vez, com todas as feicoes
    // desenhadas dentro, so para chegar a duas ou tres camadas de catalogo.
    { arquivo: 'src/js/store/catalog.operations.js', campo: 'catalogLayers', n: 17, classe: PERSISTE },
    { arquivo: 'src/js/store/cesium3d.operations.js', campo: 'tilesetId', n: 37, classe: PERSISTE },
    { arquivo: 'src/js/store/map.operations.js', campo: 'baseLayer', n: 4, classe: PERSISTE },
    { arquivo: 'src/js/store/repositories/local.repository.js', campo: 'baseLayer', n: 1, classe: PERSISTE },
    { arquivo: 'src/js/store/repository.js', campo: 'catalogLayers', n: 1, classe: PERSISTE },
    { arquivo: 'src/js/store/repository.utils.js', campo: 'baseLayer', n: 1, classe: PERSISTE },
    { arquivo: 'src/js/store/settings.operations.js', campo: 'catalogLayers', n: 2, classe: PERSISTE },
    { arquivo: 'src/js/store/streetview360.operations.js', campo: 'photoName', n: 25, classe: PERSISTE },
    { arquivo: 'src/js/store/sync/api-client.js', campo: 'photoId', classe: RUNTIME },
    { arquivo: 'src/js/store/sync/atlas-settings.service.js', campo: 'available_data_layers', classe: RUNTIME },
    { arquivo: 'src/js/store/sync/atlas-settings.service.js', campo: 'available_analysis_layers', classe: RUNTIME },
    { arquivo: 'src/js/store/sync/atlas-settings.service.js', campo: 'available_3d_models', classe: RUNTIME },
    { arquivo: 'src/js/store/sync/atlas-settings.service.js', campo: 'available_360_views', classe: RUNTIME },
    { arquivo: 'src/js/store/sync/operation-types.js', campo: 'baseLayer', n: 1, classe: PERSISTE },
    { arquivo: 'src/js/store/sync/remote-operation-handler.js', campo: 'tilesetId', n: 3, classe: PERSISTE },
    { arquivo: 'src/js/store/sync/remote-operation-handler.js', campo: 'photoName', n: 3, classe: PERSISTE },
    { arquivo: 'src/js/store/sync/remote-operation-handler.js', campo: 'baseLayer', n: 6, classe: PERSISTE },
    { arquivo: 'src/js/store/sync/remote-operation-handler.js', campo: 'catalogLayers', n: 5, classe: PERSISTE },
    { arquivo: 'src/js/store/sync/ws-client.js', campo: 'tilesetId', classe: RUNTIME },
    { arquivo: 'src/js/store/sync/ws-client.js', campo: 'photoName', classe: RUNTIME },
    { arquivo: 'src/js/street_view_tool/components/marker-panel-360.js', campo: 'photoName', classe: RUNTIME },
    { arquivo: 'src/js/street_view_tool/navigation/navigator.js', campo: 'photoName', classe: RUNTIME },
    { arquivo: 'src/js/street_view_tool/saved_photos_markers.js', campo: 'photoName', classe: RUNTIME },
    { arquivo: 'src/js/street_view_tool/street_view_viewer.js', campo: 'photoName', classe: RUNTIME },
    { arquivo: 'src/js/street_view_tool/street_view_viewer.js', campo: 'photoId', classe: RUNTIME },
    { arquivo: 'src/js/street_view_tool/streetview-api.service.js', campo: 'photoId', classe: RUNTIME },
    { arquivo: 'src/js/street_view_tool/streetview_markers.js', campo: 'photoName', classe: RUNTIME },
    { arquivo: 'src/js/street_view_tool/tools/marker_tool_360.js', campo: 'photoName', classe: RUNTIME },
    { arquivo: 'src/js/terrain/terrain.control.js', campo: 'catalogLayers', classe: RUNTIME },
    { arquivo: 'src/js/ui/ui-visibility.controller.js', campo: 'baseLayer', classe: RUNTIME },
];

// ============================================================================
// A VARREDURA
// ============================================================================

/** Remove comentário de bloco e de linha (o `\r` do CRLF entra na normalização). */
function semComentarios(src) {
    const normalizado = src.replace(/\r\n?/g, '\n');
    const semBloco = normalizado.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
    return semBloco.split('\n').map((linha) => linha.replace(/\/\/.*/, '')).join('\n');
}

const lerCodigo = (arquivo) => semComentarios(readFileSync(path.join(RAIZ, arquivo), 'utf8'));

/** Rastreado MAIS não rastreado não ignorado. @param {string} [pathspec] @returns {string[]} */
function arquivosDoInventario(pathspec = 'src/js') {
    return execFileSync(
        'git',
        ['ls-files', '--cached', '--others', '--exclude-standard', pathspec],
        { cwd: RAIZ, encoding: 'utf8' }
    ).split('\n').map((s) => s.trim()).filter((s) => s.endsWith('.js'));
}

/**
 * Todo par (arquivo, campo) do inventário.
 * @param {string[]} arquivos
 * @returns {Map<string, {arquivo: string, campo: string, n: number, linhas: number[]}>}
 */
function contatos(arquivos) {
    const achados = new Map();
    for (const arquivo of arquivos) {
        const linhas = lerCodigo(arquivo).split('\n');
        for (const campo of REFERENCE_FIELD_NAMES) {
            const re = new RegExp(String.raw`\b` + campo + String.raw`\b`);
            const marcadas = [];
            linhas.forEach((linha, i) => { if (re.test(linha)) marcadas.push(i + 1); });
            if (marcadas.length === 0) continue;
            achados.set(`${arquivo}\t${campo}`, {
                arquivo, campo, n: marcadas.length, linhas: marcadas,
            });
        }
    }
    return achados;
}

/** Os pares sem entrada no censo, no formato de mensagem de erro. */
function naoClassificados(achados) {
    return [...achados.values()]
        .filter((a) => !CENSO.some((e) => e.arquivo === a.arquivo && e.campo === a.campo))
        .map((a) => `${a.arquivo}:${a.linhas.slice(0, 5).join(',')} (${a.campo})`);
}

describe('Censo das referências a recurso de catálogo dentro do atlas', () => {
    it('piso: o inventário vem do git e alcança os donos das superfícies', () => {
        let arquivos;
        try {
            arquivos = arquivosDoInventario();
        } catch (err) {
            throw new Error(
                `o inventário deste censo vem de \`git ls-files\` e o comando FALHOU (${err.message}). `
                + 'Isto é falha de ambiente, não regressão de código: rode dentro do repositório.'
            );
        }
        expect(arquivos.length).toBeGreaterThanOrEqual(300);

        // Os cinco documentos que a poda atravessa PRECISAM estar na varredura: sem este
        // piso, um `git ls-files` que devolvesse zero deixaria o censo verde sem ter olhado
        // arquivo nenhum, que é a cobertura vazia da constituição.
        for (const alvo of [
            'src/js/store/cesium3d.operations.js',
            'src/js/store/streetview360.operations.js',
            'src/js/store/briefing.operations.js',
            'src/js/store/map.operations.js',
            'src/js/store/catalog.operations.js',
        ]) {
            expect(arquivos, `o inventário precisa alcançar ${alvo}`).toContain(alvo);
        }

        const achados = contatos(arquivos);
        expect(achados.size).toBeGreaterThanOrEqual(80);
    });

    it('todo par (arquivo, campo) está no censo, com classe', () => {
        expect(naoClassificados(contatos(arquivosDoInventario()))).toEqual([]);
    });

    it('a contagem bate onde ela é cobrada (PODA e PERSISTE)', () => {
        const achados = contatos(arquivosDoInventario());
        const comN = CENSO.filter((e) => e.n !== undefined);
        expect(comN.length).toBeGreaterThanOrEqual(30);

        const divergentes = comN
            .map((e) => ({ ...e, vistos: achados.get(`${e.arquivo}\t${e.campo}`)?.n ?? 0 }))
            .filter((e) => e.vistos !== e.n)
            .map((e) => `${e.arquivo} (${e.campo}) esperava ${e.n}, achei ${e.vistos}`);
        expect(divergentes).toEqual([]);

        const chaves = CENSO.map((e) => `${e.arquivo}\t${e.campo}`);
        expect(new Set(chaves).size).toBe(chaves.length);
    });

    it('toda entrada PODA nomeia uma superfície que EXISTE no registro', () => {
        // Sem isto, "poda" seria carimbo: bastaria escrever a palavra ao lado de um arquivo
        // novo para ele passar coberto.
        const podadores = CENSO.filter((e) => e.classe === PODA);
        expect(podadores.length).toBeGreaterThanOrEqual(15);

        const orfas = podadores
            .flatMap((e) => (e.superficies ?? []).map((sid) => ({ ...e, sid })))
            .filter((e) => !prunableSurfaceIds().includes(e.sid))
            .map((e) => `${e.arquivo} (${e.campo}) -> ${e.sid}`);
        expect(podadores.every((e) => Array.isArray(e.superficies) && e.superficies.length > 0)).toBe(true);
        expect(orfas).toEqual([]);
    });

    it('toda entrada PODA_SERVIDOR nomeia uma superfície SÓ-SERVIDOR, e nunca uma podável aqui', () => {
        // AS DUAS LISTAS SÃO DISJUNTAS de propósito, e esta é a linha que impede a classe nova
        // de virar rota de fuga: marcar `PODA_SERVIDOR` numa superfície que o CLIENTE poda
        // dispensaria o podador do cliente sem ninguém perceber.
        const doServidor = CENSO.filter((e) => e.classe === PODA_SERVIDOR);
        expect(doServidor.length).toBeGreaterThanOrEqual(5);

        const nomeadas = doServidor.flatMap((e) => e.superficies ?? []);
        expect(doServidor.every((e) => Array.isArray(e.superficies) && e.superficies.length > 0)).toBe(true);
        expect(nomeadas.filter((sid) => !serverOnlySurfaceIds().includes(sid))).toEqual([]);
        expect(nomeadas.filter((sid) => prunableSurfaceIds().includes(sid))).toEqual([]);

        // A DIREÇÃO INVERSA, como no par de cima: superfície só-servidor acrescentada ao
        // registro e esquecida aqui ficaria declarada e sem dono.
        expect(serverOnlySurfaceIds().filter((sid) => !nomeadas.includes(sid))).toEqual([]);

        // ABSOLUTO: as seis, por extenso. Sem isto, apagar as seis do registro deixaria os
        // dois filtros acima vazios e verdes.
        expect(serverOnlySurfaceIds()).toEqual([
            'settings.basemaps',
            'settings.default_basemap',
            'settings.available_data_layers',
            'settings.available_analysis_layers',
            'settings.available_3d_models',
            'settings.available_360_views',
        ]);
    });

    it('toda superfície podável do registro é nomeada por alguma entrada PODA', () => {
        // A DIREÇÃO INVERSA, e é ela que impede o registro e o censo de envelhecerem
        // separados: uma superfície acrescentada ao registro e esquecida na poda ficaria
        // declarada e não implementada, com as duas suítes verdes.
        const nomeadas = new Set(CENSO.filter((e) => e.classe === PODA).flatMap((e) => e.superficies));
        const semPodador = prunableSurfaceIds().filter((id) => !nomeadas.has(id));
        expect(semPodador).toEqual([]);
    });

    it('o campo DELIBERADAMENTE não varrido continua fora da varredura, e é só um', () => {
        // `basemaps` é nome de superfície E nome do subsistema inteiro: a palavra crua
        // aparece em 17 arquivos de `src/js`, e varrê-la produziria dezenas de entradas cuja
        // classe é sempre a mesma e cuja contagem muda a cada edição de interface. Um guarda
        // ruidoso é um guarda que alguém desliga, então a exclusão é decisão — e uma decisão
        // sem asserção é um comentário que a próxima pessoa apaga.
        expect(CAMPO_NAO_VARRIDO).toEqual(['basemaps']);
        for (const campo of CAMPO_NAO_VARRIDO) {
            expect(REFERENCE_FIELD_NAMES, `${campo} está declarado como NÃO varrido`)
                .not.toContain(campo);
        }
        // DISCRIMINAÇÃO: a lista de exclusão não pode crescer para engolir a varredura. Os
        // cinco campos da família de settings que SÃO varridos continuam lá.
        for (const campo of ['default_basemap', 'available_data_layers',
            'available_analysis_layers', 'available_3d_models', 'available_360_views']) {
            expect(REFERENCE_FIELD_NAMES).toContain(campo);
        }
    });

    it('toda entrada tem classe válida e motivo escrito', () => {
        const classes = [PODA, PODA_SERVIDOR, PERSISTE, RUNTIME, OUTRO_DOCUMENTO];
        const ruins = CENSO
            .filter((e) => !classes.includes(e.classe) || (MOTIVO[e.classe] ?? '').length < 60)
            .map((e) => `${e.arquivo} (${e.campo})`);
        expect(ruins).toEqual([]);
    });

    it('a varredura REPROVA um arquivo NOVO, ainda não rastreado, com campo de referência', () => {
        // A CADEIA INTEIRA, e não só "o inventário vê": o arquivo nasce fora do índice do
        // git, é varrido e é ACUSADO pela MESMA função dos casos acima. Sem este controle,
        // "o censo pega arquivo novo" seria uma afirmação do guarda sobre o guarda.
        const dir = 'tests/fixtures/censo-referencias';
        const relativo = `${dir}/tmp-nao-rastreado.js`;
        const abs = path.join(RAIZ, relativo);
        mkdirSync(path.join(RAIZ, dir), { recursive: true });
        writeFileSync(abs, [
            `// Path: ${relativo}`,
            '// Temporário: criado e apagado pelo controle negativo deste censo.',
            'export const alvo = (item) => item.tilesetId;',
            '',
        ].join('\n'));

        try {
            const soRastreados = execFileSync('git', ['ls-files', dir], { cwd: RAIZ, encoding: 'utf8' });
            expect(soRastreados).not.toContain('tmp-nao-rastreado');

            const inventario = arquivosDoInventario(dir);
            expect(inventario, 'o inventário precisa enxergar o arquivo NÃO RASTREADO').toContain(relativo);

            const acusados = naoClassificados(contatos(inventario));
            expect(acusados.some((a) => a.includes('tmp-nao-rastreado'))).toBe(true);

            // DISCRIMINAÇÃO: a mesma função, sobre o código REAL, não acusa ninguém.
            expect(naoClassificados(contatos(arquivosDoInventario()))).toEqual([]);
        } finally {
            // O DIRETÓRIO INTEIRO, e não só o arquivo: remover apenas o arquivo deixava uma
            // pasta vazia na árvore a cada rodada, e lixo de teste em árvore versionada vira
            // ruído no `git status` de quem for revisar o próximo commit.
            rmSync(path.join(RAIZ, dir), { recursive: true, force: true });
        }
    });
});
