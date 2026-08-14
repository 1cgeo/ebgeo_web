# COBERTURA — auditoria do frontend

Uma linha por arquivo versionado do pacote `frontend/`. Nenhuma fase se declara
concluida enquanto houver `pendente` nesta tabela.

O inventario e **derivado de `git ls-files`**, e nao de uma lista de diretorios
escrita a mao. A primeira versao desta auditoria enumerou os diretorios e omitiu
`tests/e2e/` (55 arquivos) e `tests/store/` (19) sem que nada acusasse: um
inventario enumerado erra por AUSENCIA silenciosa, um inventario derivado erra
por exclusao explicita, que aparece na tabela abaixo. A licao esta no
[livro-razao](livro-razao.md).

Caminhos relativos a `frontend/`.

## Excluidos, e por que

| criterio | arquivos | motivo |
|---|---:|---|
| — | 2561 | atlas de glifo de fonte, dado de renderizacao |
| — | 405 | biblioteca de terceiros, nao editavel neste repositorio |
| — | 68 | imagem de interface |
| — | 41 | video e imagem do tutorial, sem codigo |
| — | 11 | panoramicas e metadados de amostra, dado e nao codigo |
| — | 5 | biblioteca de terceiros embutida (Three.js), nao editavel |
| — | 3 | tutorial do usuario, avaliado como um todo e nao arquivo a arquivo |
| — | 2 | modelo e video 3D |
| — | 1 | manifesto resolvido, gerado |

## Arquivos

| # | caminho | linhas | status | data |
|---:|---|---:|---|---|
| 1 | `.gitignore` | 37 | lido | 2026-08-14 |
| 2 | `admin.html` | 67 | sem alteracao | 2026-08-14 |
| 3 | `calibracao.html` | 99 | sem alteracao | 2026-08-14 |
| 4 | `eslint.config.js` | 153 | lido (4 achados) | 2026-08-14 |
| 5 | `index.html` | 555 | lido (5 achados) | 2026-08-14 |
| 6 | `knip.json` | 20 | lido (1 achado) | 2026-08-14 |
| 7 | `package.json` | 60 | lido (2 achados) | 2026-08-14 |
| 8 | `playwright.config.js` | 65 | sem alteracao | 2026-08-14 |
| 9 | `projetos.html` | 67 | sem alteracao | 2026-08-14 |
| 10 | `src/css/account.css` | 714 | lido (1 achado) | 2026-08-14 |
| 11 | `src/css/active-tool-chip.css` | 163 | lido (1 achado) | 2026-08-14 |
| 12 | `src/css/admin-page.css` | 27 | lido (1 achado) | 2026-08-14 |
| 13 | `src/css/admin.css` | 616 | lido (1 achado) | 2026-08-14 |
| 14 | `src/css/app-bar.css` | 148 | sem alteracao | 2026-08-14 |
| 15 | `src/css/atlas-drive.css` | 364 | lido (1 achado) | 2026-08-14 |
| 16 | `src/css/attribute-table.css` | 605 | lido (2 achados) | 2026-08-14 |
| 17 | `src/css/attributes-panel.css` | 2206 | lido (4 achados) | 2026-08-14 |
| 18 | `src/css/azimuth-distance.css` | 835 | lido (2 achados) | 2026-08-14 |
| 19 | `src/css/base-layer-selector.css` | 246 | sem alteracao | 2026-08-14 |
| 20 | `src/css/base.css` | 103 | sem alteracao | 2026-08-14 |
| 21 | `src/css/bottom-controls.css` | 284 | lido (1 achado) | 2026-08-14 |
| 22 | `src/css/briefing/briefing-editor.css` | 857 | sem alteracao | 2026-08-14 |
| 23 | `src/css/briefing/briefing-pdf-export.css` | 46 | sem alteracao | 2026-08-14 |
| 24 | `src/css/briefing/briefing-presentation.css` | 362 | lido (1 achado) | 2026-08-14 |
| 25 | `src/css/calibracao.css` | 1443 | lido (3 achados) | 2026-08-14 |
| 26 | `src/css/catalog.css` | 823 | sem alteracao | 2026-08-14 |
| 27 | `src/css/chips.css` | 151 | lido (1 achado) | 2026-08-14 |
| 28 | `src/css/comment.css` | 539 | sem alteracao | 2026-08-14 |
| 29 | `src/css/context-menu.css` | 180 | lido (1 achado) | 2026-08-14 |
| 30 | `src/css/coordinates.css` | 391 | lido (1 achado) | 2026-08-14 |
| 31 | `src/css/csv-import.css` | 194 | lido (2 achados) | 2026-08-14 |
| 32 | `src/css/design-tokens.css` | 227 | sem alteracao | 2026-08-14 |
| 33 | `src/css/feature-user-data.css` | 831 | lido (2 achados) | 2026-08-14 |
| 34 | `src/css/features-tab.css` | 1265 | lido (5 achados) | 2026-08-14 |
| 35 | `src/css/idle-timeout.css` | 81 | sem alteracao | 2026-08-14 |
| 36 | `src/css/import-export.css` | 129 | sem alteracao | 2026-08-14 |
| 37 | `src/css/locking.css` | 121 | sem alteracao | 2026-08-14 |
| 38 | `src/css/map-controls.css` | 540 | sem alteracao | 2026-08-14 |
| 39 | `src/css/measurement.css` | 116 | sem alteracao | 2026-08-14 |
| 40 | `src/css/modals-redesign.css` | 2544 | lido (8 achados) | 2026-08-14 |
| 41 | `src/css/panels-2d.css` | 668 | lido (4 achados) | 2026-08-14 |
| 42 | `src/css/panels-360.css` | 629 | lido (1 achado) | 2026-08-14 |
| 43 | `src/css/panels-3d.css` | 878 | lido (5 achados) | 2026-08-14 |
| 44 | `src/css/pdf-export.css` | 401 | lido (1 achado) | 2026-08-14 |
| 45 | `src/css/phone.css` | 1404 | lido (4 achados) | 2026-08-14 |
| 46 | `src/css/presence.css` | 284 | sem alteracao | 2026-08-14 |
| 47 | `src/css/processing.css` | 343 | lido (1 achado) | 2026-08-14 |
| 48 | `src/css/projects-page.css` | 28 | sem alteracao | 2026-08-14 |
| 49 | `src/css/responsive.css` | 671 | lido (4 achados) | 2026-08-14 |
| 50 | `src/css/search-bar.css` | 695 | lido (3 achados) | 2026-08-14 |
| 51 | `src/css/sharing.css` | 771 | lido (1 achado) | 2026-08-14 |
| 52 | `src/css/sidebar.css` | 5429 | lido (11 achados) | 2026-08-14 |
| 53 | `src/css/style.css` | 71 | sem alteracao | 2026-08-14 |
| 54 | `src/css/tab-lock.css` | 95 | lido (1 achado) | 2026-08-14 |
| 55 | `src/css/temporal.css` | 684 | sem alteracao | 2026-08-14 |
| 56 | `src/css/toast.css` | 105 | sem alteracao | 2026-08-14 |
| 57 | `src/css/toolbar-groups.css` | 320 | sem alteracao | 2026-08-14 |
| 58 | `src/css/unavailable.css` | 67 | sem alteracao | 2026-08-14 |
| 59 | `src/css/view-mode.css` | 35 | lido (1 achado) | 2026-08-14 |
| 60 | `src/js/3d_models_viewer_tool/add_3d_models_viewer_control.js` | 925 | lido (2 achados) | 2026-08-14 |
| 61 | `src/js/3d_models_viewer_tool/components/marker-panel-3d.js` | 857 | lido (2 achados) | 2026-08-14 |
| 62 | `src/js/3d_models_viewer_tool/components/measurement-panel-3d.js` | 571 | sem alteracao | 2026-08-14 |
| 63 | `src/js/3d_models_viewer_tool/components/panel-shared-3d.js` | 329 | lido (2 achados) | 2026-08-14 |
| 64 | `src/js/3d_models_viewer_tool/components/viewshed-panel-3d.js` | 466 | lido (1 achado) | 2026-08-14 |
| 65 | `src/js/3d_models_viewer_tool/index.js` | 18 | sem alteracao | 2026-08-14 |
| 66 | `src/js/3d_models_viewer_tool/map_3d.js` | 1392 | lido (4 achados) | 2026-08-14 |
| 67 | `src/js/3d_models_viewer_tool/services/cesium-color.js` | 24 | sem alteracao | 2026-08-14 |
| 68 | `src/js/3d_models_viewer_tool/services/cesium-compat.js` | 159 | sem alteracao | 2026-08-14 |
| 69 | `src/js/3d_models_viewer_tool/services/index.js` | 16 | sem alteracao | 2026-08-14 |
| 70 | `src/js/3d_models_viewer_tool/services/keyboard-service-3d.js` | 254 | sem alteracao | 2026-08-14 |
| 71 | `src/js/3d_models_viewer_tool/tools/index.js` | 15 | sem alteracao | 2026-08-14 |
| 72 | `src/js/3d_models_viewer_tool/tools/marker_tool_3d.js` | 921 | lido (2 achados) | 2026-08-14 |
| 73 | `src/js/3d_models_viewer_tool/tools/measurement_tool_3d.js` | 1194 | lido (1 achado) | 2026-08-14 |
| 74 | `src/js/3d_models_viewer_tool/tools/mouse_coordinates_3d.js` | 188 | lido (1 achado) | 2026-08-14 |
| 75 | `src/js/3d_models_viewer_tool/tools/screenshot_tool.js` | 379 | lido (2 achados) | 2026-08-14 |
| 76 | `src/js/3d_models_viewer_tool/tools/viewshed.js` | 42 | lido (1 achado) | 2026-08-14 |
| 77 | `src/js/3d_models_viewer_tool/tools/viewshed_tool_3d.js` | 928 | lido (2 achados) | 2026-08-14 |
| 78 | `src/js/account/account.control.js` | 960 | lido (3 achados) | 2026-08-14 |
| 79 | `src/js/account/atlas-name.control.js` | 118 | sem alteracao | 2026-08-14 |
| 80 | `src/js/account/index.js` | 13 | sem alteracao | 2026-08-14 |
| 81 | `src/js/account/open-atlas.service.js` | 130 | sem alteracao | 2026-08-14 |
| 82 | `src/js/account/sync-status.control.js` | 115 | sem alteracao | 2026-08-14 |
| 83 | `src/js/admin/admin-dom.js` | 95 | sem alteracao | 2026-08-14 |
| 84 | `src/js/admin/admin-page.js` | 142 | lido (1 achado) | 2026-08-14 |
| 85 | `src/js/admin/admin-panel.js` | 184 | lido (1 achado) | 2026-08-14 |
| 86 | `src/js/admin/catalog-tab.js` | 660 | lido (2 achados) | 2026-08-14 |
| 87 | `src/js/admin/config-tab.js` | 343 | lido (2 achados) | 2026-08-14 |
| 88 | `src/js/admin/index.js` | 36 | sem alteracao | 2026-08-14 |
| 89 | `src/js/admin/personnel-tab.js` | 327 | sem alteracao | 2026-08-14 |
| 90 | `src/js/admin/users-tab.js` | 684 | lido (4 achados) | 2026-08-14 |
| 91 | `src/js/analysis_tools/index.js` | 11 | sem alteracao | 2026-08-14 |
| 92 | `src/js/analysis_tools/los_tool/add_los_control.js` | 968 | lido (3 achados) | 2026-08-14 |
| 93 | `src/js/analysis_tools/los_tool/add_los_geometry.js` | 470 | lido (2 achados) | 2026-08-14 |
| 94 | `src/js/analysis_tools/los_tool/index.js` | 4 | sem alteracao | 2026-08-14 |
| 95 | `src/js/analysis_tools/los_tool/los_attributes_panel.js` | 359 | sem alteracao | 2026-08-14 |
| 96 | `src/js/analysis_tools/visibility_tool/add_visibility_control.js` | 1226 | lido (4 achados) | 2026-08-14 |
| 97 | `src/js/analysis_tools/visibility_tool/add_visibility_geometry.js` | 782 | lido (3 achados) | 2026-08-14 |
| 98 | `src/js/analysis_tools/visibility_tool/index.js` | 4 | sem alteracao | 2026-08-14 |
| 99 | `src/js/analysis_tools/visibility_tool/visibility_attributes_panel.js` | 152 | sem alteracao | 2026-08-14 |
| 100 | `src/js/attribute_table/attribute-table.constants.js` | 155 | sem alteracao | 2026-08-14 |
| 101 | `src/js/attribute_table/attribute-table.control.js` | 1018 | lido (2 achados) | 2026-08-14 |
| 102 | `src/js/attribute_table/components/column-context-menu.js` | 109 | sem alteracao | 2026-08-14 |
| 103 | `src/js/attribute_table/components/index.js` | 32 | sem alteracao | 2026-08-14 |
| 104 | `src/js/attribute_table/components/table-filters.js` | 270 | lido (1 achado) | 2026-08-14 |
| 105 | `src/js/attribute_table/components/table-panel.js` | 296 | lido (1 achado) | 2026-08-14 |
| 106 | `src/js/attribute_table/components/table-renderer.js` | 595 | lido (4 achados) | 2026-08-14 |
| 107 | `src/js/attribute_table/index.js` | 9 | sem alteracao | 2026-08-14 |
| 108 | `src/js/attribute_table/services/index.js` | 8 | sem alteracao | 2026-08-14 |
| 109 | `src/js/attribute_table/services/table-config.service.js` | 222 | lido (1 achado) | 2026-08-14 |
| 110 | `src/js/attribute_table/services/table-data.service.js` | 229 | sem alteracao | 2026-08-14 |
| 111 | `src/js/azimuth_distance_tool/add_azimuth_distance_control.js` | 859 | lido (1 achado) | 2026-08-14 |
| 112 | `src/js/azimuth_distance_tool/azimuth_distance_attributes_panel.js` | 286 | lido (2 achados) | 2026-08-14 |
| 113 | `src/js/azimuth_distance_tool/azimuth_distance_constants.js` | 251 | sem alteracao | 2026-08-14 |
| 114 | `src/js/azimuth_distance_tool/azimuth_distance_geometry.js` | 669 | sem alteracao | 2026-08-14 |
| 115 | `src/js/azimuth_distance_tool/azimuth_distance_panel.js` | 1001 | lido (2 achados) | 2026-08-14 |
| 116 | `src/js/azimuth_distance_tool/components/compass-rose.component.js` | 227 | sem alteracao | 2026-08-14 |
| 117 | `src/js/azimuth_distance_tool/components/geometry-preview.component.js` | 179 | lido (1 achado) | 2026-08-14 |
| 118 | `src/js/azimuth_distance_tool/components/index.js` | 10 | sem alteracao | 2026-08-14 |
| 119 | `src/js/azimuth_distance_tool/components/leg-row.component.js` | 320 | lido (1 achado) | 2026-08-14 |
| 120 | `src/js/azimuth_distance_tool/components/reference-point.component.js` | 171 | sem alteracao | 2026-08-14 |
| 121 | `src/js/azimuth_distance_tool/index.js` | 68 | sem alteracao | 2026-08-14 |
| 122 | `src/js/base-layer-selector/base-layer-selector.constants.js` | 71 | lido (1 achado) | 2026-08-14 |
| 123 | `src/js/base-layer-selector/base-layer-selector.control.js` | 475 | lido (2 achados) | 2026-08-14 |
| 124 | `src/js/base-layer-selector/index.js` | 12 | sem alteracao | 2026-08-14 |
| 125 | `src/js/baselayers/base-layer.control.js` | 355 | lido (3 achados) | 2026-08-14 |
| 126 | `src/js/baselayers/bdgex_layer.js` | 21 | sem alteracao | 2026-08-14 |
| 127 | `src/js/baselayers/carta_ortoimagem.js` | 3 | lido (1 achado) | 2026-08-14 |
| 128 | `src/js/baselayers/carta_topografica.js` | 18 | sem alteracao | 2026-08-14 |
| 129 | `src/js/baselayers/imagens_layer.js` | 26 | sem alteracao | 2026-08-14 |
| 130 | `src/js/baselayers/index.js` | 13 | sem alteracao | 2026-08-14 |
| 131 | `src/js/baselayers/osm_layer.js` | 22 | sem alteracao | 2026-08-14 |
| 132 | `src/js/bottom-controls/bottom-controls.constants.js` | 91 | sem alteracao | 2026-08-14 |
| 133 | `src/js/bottom-controls/bottom-controls.control.js` | 522 | sem alteracao | 2026-08-14 |
| 134 | `src/js/bottom-controls/components/feature-toggle.js` | 116 | sem alteracao | 2026-08-14 |
| 135 | `src/js/bottom-controls/components/nav-button.js` | 103 | sem alteracao | 2026-08-14 |
| 136 | `src/js/bottom-controls/index.js` | 10 | sem alteracao | 2026-08-14 |
| 137 | `src/js/briefing/components/presentation-controls.js` | 421 | lido (1 achado) | 2026-08-14 |
| 138 | `src/js/briefing/components/presentation-text-panel.js` | 541 | lido (1 achado) | 2026-08-14 |
| 139 | `src/js/briefing/editor/briefing-editor.control.js` | 1788 | lido (4 achados) | 2026-08-14 |
| 140 | `src/js/briefing/export/briefing-pdf-export.js` | 260 | lido (2 achados) | 2026-08-14 |
| 141 | `src/js/briefing/export/pdf-page-composer.js` | 442 | lido (1 achado) | 2026-08-14 |
| 142 | `src/js/briefing/export/slide-capture.service.js` | 112 | sem alteracao | 2026-08-14 |
| 143 | `src/js/briefing/index.js` | 17 | sem alteracao | 2026-08-14 |
| 144 | `src/js/briefing/presentation/briefing-presenter.control.js` | 719 | lido (4 achados) | 2026-08-14 |
| 145 | `src/js/briefing/presentation/tile-preloader.js` | 58 | sem alteracao | 2026-08-14 |
| 146 | `src/js/briefing/presentation/transition.service.js` | 926 | lido (5 achados) | 2026-08-14 |
| 147 | `src/js/briefing/services/keyboard-service-briefing.js` | 183 | lido (1 achado) | 2026-08-14 |
| 148 | `src/js/briefing/validation/reference-validator.js` | 443 | lido (1 achado) | 2026-08-14 |
| 149 | `src/js/calibration/api.js` | 473 | lido (1 achado) | 2026-08-14 |
| 150 | `src/js/calibration/app.js` | 1359 | lido (5 achados) | 2026-08-14 |
| 151 | `src/js/calibration/calibracao-page.js` | 149 | sem alteracao | 2026-08-14 |
| 152 | `src/js/calibration/calibration-panel.js` | 1561 | lido (5 achados) | 2026-08-14 |
| 153 | `src/js/calibration/constants.js` | 166 | sem alteracao | 2026-08-14 |
| 154 | `src/js/calibration/descricao.js` | 57 | sem alteracao | 2026-08-14 |
| 155 | `src/js/calibration/hit-tester.js` | 95 | sem alteracao | 2026-08-14 |
| 156 | `src/js/calibration/minimap.js` | 507 | lido (1 achado) | 2026-08-14 |
| 157 | `src/js/calibration/navigator.js` | 736 | lido (2 achados) | 2026-08-14 |
| 158 | `src/js/calibration/preview-viewer.js` | 995 | lido (1 achado) | 2026-08-14 |
| 159 | `src/js/calibration/project-map.js` | 629 | lido (2 achados) | 2026-08-14 |
| 160 | `src/js/calibration/projector.js` | 355 | sem alteracao | 2026-08-14 |
| 161 | `src/js/calibration/renderer.js` | 700 | sem alteracao | 2026-08-14 |
| 162 | `src/js/calibration/state.js` | 615 | lido (1 achado) | 2026-08-14 |
| 163 | `src/js/calibration/viewer.js` | 582 | sem alteracao | 2026-08-14 |
| 164 | `src/js/catalog/catalog.constants.js` | 179 | sem alteracao | 2026-08-14 |
| 165 | `src/js/catalog/catalog.modal.js` | 353 | sem alteracao | 2026-08-14 |
| 166 | `src/js/catalog/catalog.service.js` | 328 | lido (2 achados) | 2026-08-14 |
| 167 | `src/js/catalog/components/catalog-card.js` | 150 | sem alteracao | 2026-08-14 |
| 168 | `src/js/catalog/components/catalog-filters.js` | 76 | lido (1 achado) | 2026-08-14 |
| 169 | `src/js/catalog/components/catalog-grid.js` | 46 | sem alteracao | 2026-08-14 |
| 170 | `src/js/catalog/components/catalog-header.js` | 44 | lido (1 achado) | 2026-08-14 |
| 171 | `src/js/catalog/components/index.js` | 10 | sem alteracao | 2026-08-14 |
| 172 | `src/js/catalog/index.js` | 31 | sem alteracao | 2026-08-14 |
| 173 | `src/js/comment_tool/comment-overlay.js` | 610 | lido (1 achado) | 2026-08-14 |
| 174 | `src/js/comment_tool/comments-panel.js` | 322 | sem alteracao | 2026-08-14 |
| 175 | `src/js/comment_tool/index.js` | 8 | sem alteracao | 2026-08-14 |
| 176 | `src/js/config-loader.js` | 28 | sem alteracao | 2026-08-14 |
| 177 | `src/js/config.helpers.js` | 174 | sem alteracao | 2026-08-14 |
| 178 | `src/js/config.js` | 65 | sem alteracao | 2026-08-14 |
| 179 | `src/js/context-menu/context-menu.control.js` | 908 | lido (3 achados) | 2026-08-14 |
| 180 | `src/js/context-menu/index.js` | 8 | sem alteracao | 2026-08-14 |
| 181 | `src/js/coordinates/index.js` | 8 | sem alteracao | 2026-08-14 |
| 182 | `src/js/coordinates/mouse-coordinates.control.js` | 614 | lido (3 achados) | 2026-08-14 |
| 183 | `src/js/deep-link/atlas-link.js` | 112 | sem alteracao | 2026-08-14 |
| 184 | `src/js/deep-link/atlas-url-sync.js` | 55 | sem alteracao | 2026-08-14 |
| 185 | `src/js/deep-link/deep-link.js` | 344 | lido (1 achado) | 2026-08-14 |
| 186 | `src/js/deep-link/local-intent.js` | 38 | sem alteracao | 2026-08-14 |
| 187 | `src/js/draw_tools/brush_tool/add_brush_control.js` | 650 | lido (3 achados) | 2026-08-14 |
| 188 | `src/js/draw_tools/brush_tool/add_brush_geometry.js` | 269 | lido (1 achado) | 2026-08-14 |
| 189 | `src/js/draw_tools/brush_tool/brush_attributes_panel.js` | 90 | sem alteracao | 2026-08-14 |
| 190 | `src/js/draw_tools/brush_tool/index.js` | 4 | sem alteracao | 2026-08-14 |
| 191 | `src/js/draw_tools/circle_tool/add_circle_control.js` | 839 | lido (2 achados) | 2026-08-14 |
| 192 | `src/js/draw_tools/circle_tool/add_circle_geometry.js` | 232 | sem alteracao | 2026-08-14 |
| 193 | `src/js/draw_tools/circle_tool/circle_attributes_panel.js` | 121 | sem alteracao | 2026-08-14 |
| 194 | `src/js/draw_tools/circle_tool/index.js` | 4 | sem alteracao | 2026-08-14 |
| 195 | `src/js/draw_tools/drawing-touch-helpers.js` | 175 | lido (2 achados) | 2026-08-14 |
| 196 | `src/js/draw_tools/ellipse_tool/add_ellipse_control.js` | 1055 | lido (2 achados) | 2026-08-14 |
| 197 | `src/js/draw_tools/ellipse_tool/add_ellipse_geometry.js` | 419 | lido (1 achado) | 2026-08-14 |
| 198 | `src/js/draw_tools/ellipse_tool/ellipse_attributes_panel.js` | 129 | sem alteracao | 2026-08-14 |
| 199 | `src/js/draw_tools/ellipse_tool/index.js` | 4 | sem alteracao | 2026-08-14 |
| 200 | `src/js/draw_tools/image_tool/add_image_control.js` | 762 | lido (5 achados) | 2026-08-14 |
| 201 | `src/js/draw_tools/image_tool/add_image_geometry.js` | 242 | lido (1 achado) | 2026-08-14 |
| 202 | `src/js/draw_tools/image_tool/image_attributes_panel.js` | 106 | sem alteracao | 2026-08-14 |
| 203 | `src/js/draw_tools/image_tool/index.js` | 4 | sem alteracao | 2026-08-14 |
| 204 | `src/js/draw_tools/index.js` | 51 | sem alteracao | 2026-08-14 |
| 205 | `src/js/draw_tools/line_tool/add_line_control.js` | 1354 | lido (5 achados) | 2026-08-14 |
| 206 | `src/js/draw_tools/line_tool/add_line_geometry.js` | 380 | sem alteracao | 2026-08-14 |
| 207 | `src/js/draw_tools/line_tool/index.js` | 36 | lido (1 achado) | 2026-08-14 |
| 208 | `src/js/draw_tools/line_tool/line-split.js` | 284 | lido (1 achado) | 2026-08-14 |
| 209 | `src/js/draw_tools/line_tool/line_attributes_panel.js` | 109 | sem alteracao | 2026-08-14 |
| 210 | `src/js/draw_tools/line_tool/line_measurement.js` | 143 | sem alteracao | 2026-08-14 |
| 211 | `src/js/draw_tools/line_tool/line_profile.js` | 173 | lido (1 achado) | 2026-08-14 |
| 212 | `src/js/draw_tools/point_tool/add_point_control.js` | 803 | lido (1 achado) | 2026-08-14 |
| 213 | `src/js/draw_tools/point_tool/add_point_geometry.js` | 221 | sem alteracao | 2026-08-14 |
| 214 | `src/js/draw_tools/point_tool/index.js` | 4 | sem alteracao | 2026-08-14 |
| 215 | `src/js/draw_tools/point_tool/point-custom-icons.js` | 185 | sem alteracao | 2026-08-14 |
| 216 | `src/js/draw_tools/point_tool/point-marker-symbols.js` | 422 | sem alteracao | 2026-08-14 |
| 217 | `src/js/draw_tools/point_tool/point_attributes_panel.js` | 417 | lido (1 achado) | 2026-08-14 |
| 218 | `src/js/draw_tools/polygon_tool/add_polygon_control.js` | 1183 | lido (2 achados) | 2026-08-14 |
| 219 | `src/js/draw_tools/polygon_tool/add_polygon_geometry.js` | 545 | lido (1 achado) | 2026-08-14 |
| 220 | `src/js/draw_tools/polygon_tool/index.js` | 4 | sem alteracao | 2026-08-14 |
| 221 | `src/js/draw_tools/polygon_tool/polygon_attributes_panel.js` | 136 | sem alteracao | 2026-08-14 |
| 222 | `src/js/draw_tools/rectangle_tool/add_rectangle_control.js` | 1248 | lido (3 achados) | 2026-08-14 |
| 223 | `src/js/draw_tools/rectangle_tool/add_rectangle_geometry.js` | 819 | lido (2 achados) | 2026-08-14 |
| 224 | `src/js/draw_tools/rectangle_tool/index.js` | 4 | sem alteracao | 2026-08-14 |
| 225 | `src/js/draw_tools/rectangle_tool/rectangle_attributes_panel.js` | 155 | lido (1 achado) | 2026-08-14 |
| 226 | `src/js/draw_tools/sector_tool/add_sector_control.js` | 957 | lido (1 achado) | 2026-08-14 |
| 227 | `src/js/draw_tools/sector_tool/add_sector_geometry.js` | 296 | lido (1 achado) | 2026-08-14 |
| 228 | `src/js/draw_tools/sector_tool/index.js` | 5 | sem alteracao | 2026-08-14 |
| 229 | `src/js/draw_tools/sector_tool/sector_attributes_panel.js` | 165 | sem alteracao | 2026-08-14 |
| 230 | `src/js/draw_tools/text_tool/add_text_control.js` | 1128 | lido (3 achados) | 2026-08-14 |
| 231 | `src/js/draw_tools/text_tool/add_text_geometry.js` | 367 | lido (1 achado) | 2026-08-14 |
| 232 | `src/js/draw_tools/text_tool/index.js` | 4 | sem alteracao | 2026-08-14 |
| 233 | `src/js/draw_tools/text_tool/text_attributes_panel.js` | 301 | lido (2 achados) | 2026-08-14 |
| 234 | `src/js/events/event_bus.js` | 32 | sem alteracao | 2026-08-14 |
| 235 | `src/js/events/event_emitter.js` | 265 | lido (2 achados) | 2026-08-14 |
| 236 | `src/js/events/event_types.js` | 244 | sem alteracao | 2026-08-14 |
| 237 | `src/js/events/index.js` | 9 | sem alteracao | 2026-08-14 |
| 238 | `src/js/features_tab/analysis-layers.component.js` | 101 | lido (1 achado) | 2026-08-14 |
| 239 | `src/js/features_tab/catalog-layers.component.js` | 767 | lido (3 achados) | 2026-08-14 |
| 240 | `src/js/features_tab/collapse-state.manager.js` | 168 | sem alteracao | 2026-08-14 |
| 241 | `src/js/features_tab/feature-item.component.js` | 281 | lido (1 achado) | 2026-08-14 |
| 242 | `src/js/features_tab/feature-organizer.service.js` | 197 | lido (3 achados) | 2026-08-14 |
| 243 | `src/js/features_tab/features_tab.constants.js` | 70 | lido (2 achados) | 2026-08-14 |
| 244 | `src/js/features_tab/features_tab.icons.js` | 81 | sem alteracao | 2026-08-14 |
| 245 | `src/js/features_tab/features_tab.js` | 1127 | lido (2 achados) | 2026-08-14 |
| 246 | `src/js/features_tab/group-item.component.js` | 466 | lido (1 achado) | 2026-08-14 |
| 247 | `src/js/features_tab/index.js` | 76 | lido (1 achado) | 2026-08-14 |
| 248 | `src/js/features_tab/layer-container.builder.js` | 208 | sem alteracao | 2026-08-14 |
| 249 | `src/js/features_tab/layer-list.component.js` | 485 | lido (2 achados) | 2026-08-14 |
| 250 | `src/js/features_tab/layer-style-panel.component.js` | 637 | sem alteracao | 2026-08-14 |
| 251 | `src/js/features_tab/models3d-section.component.js` | 706 | lido (3 achados) | 2026-08-14 |
| 252 | `src/js/features_tab/sortable.handler.js` | 121 | sem alteracao | 2026-08-14 |
| 253 | `src/js/features_tab/streetview360-section.component.js` | 612 | lido (2 achados) | 2026-08-14 |
| 254 | `src/js/grid/grid-layers.config.js` | 179 | sem alteracao | 2026-08-14 |
| 255 | `src/js/grid/grid.control.js` | 154 | lido (1 achado) | 2026-08-14 |
| 256 | `src/js/grid/index.js` | 9 | sem alteracao | 2026-08-14 |
| 257 | `src/js/import_export/atlas-image-upload.js` | 77 | sem alteracao | 2026-08-14 |
| 258 | `src/js/import_export/csv/csv-config-panel.js` | 522 | lido (1 achado) | 2026-08-14 |
| 259 | `src/js/import_export/csv/csv-coordinate-converter.js` | 340 | sem alteracao | 2026-08-14 |
| 260 | `src/js/import_export/csv/csv-parser.js` | 227 | sem alteracao | 2026-08-14 |
| 261 | `src/js/import_export/csv/csv-to-geojson.js` | 123 | sem alteracao | 2026-08-14 |
| 262 | `src/js/import_export/csv/index.js` | 11 | sem alteracao | 2026-08-14 |
| 263 | `src/js/import_export/drag-drop.handler.js` | 328 | lido (3 achados) | 2026-08-14 |
| 264 | `src/js/import_export/export-import.service.js` | 1075 | lido (5 achados) | 2026-08-14 |
| 265 | `src/js/import_export/export-utils.js` | 224 | sem alteracao | 2026-08-14 |
| 266 | `src/js/import_export/garmin-kmz-export.js` | 717 | lido (1 achado) | 2026-08-14 |
| 267 | `src/js/import_export/import.control.js` | 827 | lido (3 achados) | 2026-08-14 |
| 268 | `src/js/import_export/index.js` | 14 | sem alteracao | 2026-08-14 |
| 269 | `src/js/import_export/kmz/index.js` | 8 | sem alteracao | 2026-08-14 |
| 270 | `src/js/import_export/kmz/kml-balloon.js` | 221 | sem alteracao | 2026-08-14 |
| 271 | `src/js/import_export/kmz/kml-document.js` | 194 | sem alteracao | 2026-08-14 |
| 272 | `src/js/import_export/kmz/kml-geometry.js` | 475 | sem alteracao | 2026-08-14 |
| 273 | `src/js/import_export/kmz/kml-style.js` | 304 | lido (1 achado) | 2026-08-14 |
| 274 | `src/js/import_export/kmz/kmz-assets.js` | 265 | sem alteracao | 2026-08-14 |
| 275 | `src/js/import_export/kmz/kmz-export.service.js` | 234 | lido (1 achado) | 2026-08-14 |
| 276 | `src/js/import_export/kmz/kmz-feature-mapper.js` | 427 | sem alteracao | 2026-08-14 |
| 277 | `src/js/import_export/kmz/kmz-feature-types.js` | 63 | sem alteracao | 2026-08-14 |
| 278 | `src/js/import_export/local-atlas-to-server.js` | 373 | lido (1 achado) | 2026-08-14 |
| 279 | `src/js/import_export/pdf-cartographic-elements.js` | 1400 | lido (1 achado) | 2026-08-14 |
| 280 | `src/js/import_export/pdf-export.constants.js` | 72 | sem alteracao | 2026-08-14 |
| 281 | `src/js/import_export/pdf-export.tab.js` | 1330 | lido (2 achados) | 2026-08-14 |
| 282 | `src/js/import_export/pdf-mosaic-export.js` | 340 | lido (1 achado) | 2026-08-14 |
| 283 | `src/js/import_export/pdf-mosaic-geometry.js` | 231 | lido (1 achado) | 2026-08-14 |
| 284 | `src/js/import_export/pdf-mosaic-pages.js` | 429 | sem alteracao | 2026-08-14 |
| 285 | `src/js/import_export/qan/index.js` | 3 | sem alteracao | 2026-08-14 |
| 286 | `src/js/import_export/qan/qan-export.js` | 126 | sem alteracao | 2026-08-14 |
| 287 | `src/js/import_export/save-local-atlas.service.js` | 74 | lido (1 achado) | 2026-08-14 |
| 288 | `src/js/import_export/screenshot.control.js` | 416 | lido (4 achados) | 2026-08-14 |
| 289 | `src/js/index.js` | 438 | lido (1 achado) | 2026-08-14 |
| 290 | `src/js/keyboard/index.js` | 8 | sem alteracao | 2026-08-14 |
| 291 | `src/js/keyboard/keyboard-shortcuts.js` | 387 | sem alteracao | 2026-08-14 |
| 292 | `src/js/layers/image-regen-registry.js` | 43 | sem alteracao | 2026-08-14 |
| 293 | `src/js/layers/index.js` | 30 | sem alteracao | 2026-08-14 |
| 294 | `src/js/layers/layer-opacity-applier.js` | 126 | sem alteracao | 2026-08-14 |
| 295 | `src/js/layers/layer-style/layer-style.schema.js` | 88 | sem alteracao | 2026-08-14 |
| 296 | `src/js/layers/layer-style/style-expression.model.js` | 413 | sem alteracao | 2026-08-14 |
| 297 | `src/js/layers/layer.constants.js` | 102 | sem alteracao | 2026-08-14 |
| 298 | `src/js/layers/layer.manager.js` | 570 | lido (3 achados) | 2026-08-14 |
| 299 | `src/js/layers/layer_setup.js` | 536 | lido (3 achados) | 2026-08-14 |
| 300 | `src/js/layers/remote-feature-render.js` | 60 | lido (1 achado) | 2026-08-14 |
| 301 | `src/js/layers/styles/auxiliary.layers.js` | 97 | sem alteracao | 2026-08-14 |
| 302 | `src/js/layers/styles/content.layers.js` | 284 | lido (2 achados) | 2026-08-14 |
| 303 | `src/js/layers/styles/index.js` | 14 | sem alteracao | 2026-08-14 |
| 304 | `src/js/layers/styles/layer.helpers.js` | 85 | sem alteracao | 2026-08-14 |
| 305 | `src/js/layers/styles/line.layers.js` | 128 | sem alteracao | 2026-08-14 |
| 306 | `src/js/layers/styles/point.layers.js` | 111 | sem alteracao | 2026-08-14 |
| 307 | `src/js/layers/styles/polygon.layers.js` | 180 | lido (1 achado) | 2026-08-14 |
| 308 | `src/js/layers/styles/shape.layers.js` | 225 | sem alteracao | 2026-08-14 |
| 309 | `src/js/layers/styles/symbol.layers.js` | 107 | sem alteracao | 2026-08-14 |
| 310 | `src/js/layers/styles/tactical.layers.js` | 314 | sem alteracao | 2026-08-14 |
| 311 | `src/js/layers/visibility-filter.js` | 183 | sem alteracao | 2026-08-14 |
| 312 | `src/js/locking/index.js` | 13 | sem alteracao | 2026-08-14 |
| 313 | `src/js/locking/locked-banner.control.js` | 108 | sem alteracao | 2026-08-14 |
| 314 | `src/js/locking/map-lock.controller.js` | 183 | lido (2 achados) | 2026-08-14 |
| 315 | `src/js/map/animation.service.js` | 294 | sem alteracao | 2026-08-14 |
| 316 | `src/js/map/drag-rotate.handler.js` | 128 | sem alteracao | 2026-08-14 |
| 317 | `src/js/map/index.js` | 25 | sem alteracao | 2026-08-14 |
| 318 | `src/js/map/map.manager.js` | 460 | lido (1 achado) | 2026-08-14 |
| 319 | `src/js/map_sig.js` | 885 | lido (2 achados) | 2026-08-14 |
| 320 | `src/js/measurement_tool/index.js` | 10 | sem alteracao | 2026-08-14 |
| 321 | `src/js/measurement_tool/measurement-angle.control.js` | 261 | sem alteracao | 2026-08-14 |
| 322 | `src/js/measurement_tool/measurement-area.control.js` | 319 | sem alteracao | 2026-08-14 |
| 323 | `src/js/measurement_tool/measurement-distance.control.js` | 297 | sem alteracao | 2026-08-14 |
| 324 | `src/js/measurement_tool/measurement-geometry.js` | 188 | sem alteracao | 2026-08-14 |
| 325 | `src/js/measurement_tool/measurement-labels.js` | 269 | sem alteracao | 2026-08-14 |
| 326 | `src/js/measurement_tool/measurement-results-panel.js` | 238 | lido (3 achados) | 2026-08-14 |
| 327 | `src/js/measurement_tool/measurement.constants.js` | 65 | sem alteracao | 2026-08-14 |
| 328 | `src/js/military_tools/arrow_tool/add_arrow_control.js` | 1170 | lido (6 achados) | 2026-08-14 |
| 329 | `src/js/military_tools/arrow_tool/add_arrow_geometry.js` | 843 | lido (2 achados) | 2026-08-14 |
| 330 | `src/js/military_tools/arrow_tool/arrow-merge.js` | 279 | lido (1 achado) | 2026-08-14 |
| 331 | `src/js/military_tools/arrow_tool/arrow_attributes_panel.js` | 217 | sem alteracao | 2026-08-14 |
| 332 | `src/js/military_tools/arrow_tool/index.js` | 5 | sem alteracao | 2026-08-14 |
| 333 | `src/js/military_tools/boundary_tool/add_boundary_control.js` | 1259 | lido (4 achados) | 2026-08-14 |
| 334 | `src/js/military_tools/boundary_tool/add_boundary_geometry.js` | 934 | lido (2 achados) | 2026-08-14 |
| 335 | `src/js/military_tools/boundary_tool/boundary_attributes_panel.js` | 291 | sem alteracao | 2026-08-14 |
| 336 | `src/js/military_tools/boundary_tool/index.js` | 4 | sem alteracao | 2026-08-14 |
| 337 | `src/js/military_tools/coordination_measure_tool/add_coordination_measure_control.js` | 1211 | lido (4 achados) | 2026-08-14 |
| 338 | `src/js/military_tools/coordination_measure_tool/add_coordination_measure_geometry.js` | 229 | lido (1 achado) | 2026-08-14 |
| 339 | `src/js/military_tools/coordination_measure_tool/attributes/color-control.section.js` | 72 | sem alteracao | 2026-08-14 |
| 340 | `src/js/military_tools/coordination_measure_tool/attributes/coordination_measure_attributes_panel.js` | 136 | sem alteracao | 2026-08-14 |
| 341 | `src/js/military_tools/coordination_measure_tool/attributes/index.js` | 22 | sem alteracao | 2026-08-14 |
| 342 | `src/js/military_tools/coordination_measure_tool/attributes/point-selector.modal.js` | 470 | lido (4 achados) | 2026-08-14 |
| 343 | `src/js/military_tools/coordination_measure_tool/attributes/text-modifiers.section.js` | 143 | lido (1 achado) | 2026-08-14 |
| 344 | `src/js/military_tools/coordination_measure_tool/attributes/ui-components.helpers.js` | 489 | lido (4 achados) | 2026-08-14 |
| 345 | `src/js/military_tools/coordination_measure_tool/coordination_measure_constants.js` | 199 | lido (1 achado) | 2026-08-14 |
| 346 | `src/js/military_tools/coordination_measure_tool/coordination_measure_generator.js` | 486 | lido (2 achados) | 2026-08-14 |
| 347 | `src/js/military_tools/coordination_measure_tool/coordination_points_catalog.js` | 853 | lido (1 achado) | 2026-08-14 |
| 348 | `src/js/military_tools/coordination_measure_tool/index.js` | 6 | sem alteracao | 2026-08-14 |
| 349 | `src/js/military_tools/declination_tool/add_declination_control.js` | 718 | lido (1 achado) | 2026-08-14 |
| 350 | `src/js/military_tools/declination_tool/add_declination_geometry.js` | 82 | sem alteracao | 2026-08-14 |
| 351 | `src/js/military_tools/declination_tool/declination_attributes_panel.js` | 113 | sem alteracao | 2026-08-14 |
| 352 | `src/js/military_tools/declination_tool/declination_svg_generator.js` | 174 | sem alteracao | 2026-08-14 |
| 353 | `src/js/military_tools/declination_tool/index.js` | 5 | sem alteracao | 2026-08-14 |
| 354 | `src/js/military_tools/index.js` | 35 | sem alteracao | 2026-08-14 |
| 355 | `src/js/military_tools/military_symbol_tool/add_military_symbol_control.js` | 1162 | lido (11 achados) | 2026-08-14 |
| 356 | `src/js/military_tools/military_symbol_tool/add_military_symbol_geometry.js` | 220 | lido (1 achado) | 2026-08-14 |
| 357 | `src/js/military_tools/military_symbol_tool/attributes/engagement-bar.section.js` | 160 | sem alteracao | 2026-08-14 |
| 358 | `src/js/military_tools/military_symbol_tool/attributes/index.js` | 21 | sem alteracao | 2026-08-14 |
| 359 | `src/js/military_tools/military_symbol_tool/attributes/military_symbol_attributes_panel.js` | 135 | sem alteracao | 2026-08-14 |
| 360 | `src/js/military_tools/military_symbol_tool/attributes/symbol-form.section.js` | 468 | lido (7 achados) | 2026-08-14 |
| 361 | `src/js/military_tools/military_symbol_tool/attributes/symbol-gallery.section.js` | 78 | lido (2 achados) | 2026-08-14 |
| 362 | `src/js/military_tools/military_symbol_tool/attributes/symbol-selector.modal.js` | 637 | lido (5 achados) | 2026-08-14 |
| 363 | `src/js/military_tools/military_symbol_tool/attributes/text-modifiers.section.js` | 104 | lido (1 achado) | 2026-08-14 |
| 364 | `src/js/military_tools/military_symbol_tool/attributes/ui-components.helpers.js` | 569 | lido (5 achados) | 2026-08-14 |
| 365 | `src/js/military_tools/military_symbol_tool/brazilian_extension_catalog.js` | 1455 | lido (5 achados) | 2026-08-14 |
| 366 | `src/js/military_tools/military_symbol_tool/brazilian_sidc_extension.js` | 147 | sem alteracao | 2026-08-14 |
| 367 | `src/js/military_tools/military_symbol_tool/brazilian_svg_postprocessing.js` | 374 | lido (3 achados) | 2026-08-14 |
| 368 | `src/js/military_tools/military_symbol_tool/data/aeronaves.js` | 322 | lido (1 achado) | 2026-08-14 |
| 369 | `src/js/military_tools/military_symbol_tool/data/atividades_eventos.js` | 313 | lido (1 achado) | 2026-08-14 |
| 370 | `src/js/military_tools/military_symbol_tool/data/equipamentos_viaturas.js` | 634 | sem alteracao | 2026-08-14 |
| 371 | `src/js/military_tools/military_symbol_tool/data/espaciais.js` | 162 | sem alteracao | 2026-08-14 |
| 372 | `src/js/military_tools/military_symbol_tool/data/guerra_minas.js` | 285 | sem alteracao | 2026-08-14 |
| 373 | `src/js/military_tools/military_symbol_tool/data/individuos_desembarcados.js` | 242 | sem alteracao | 2026-08-14 |
| 374 | `src/js/military_tools/military_symbol_tool/data/instalacoes.js` | 471 | lido (2 achados) | 2026-08-14 |
| 375 | `src/js/military_tools/military_symbol_tool/data/maritimos_superficie.js` | 662 | lido (1 achado) | 2026-08-14 |
| 376 | `src/js/military_tools/military_symbol_tool/data/misseis.js` | 97 | sem alteracao | 2026-08-14 |
| 377 | `src/js/military_tools/military_symbol_tool/data/submarinos.js` | 242 | sem alteracao | 2026-08-14 |
| 378 | `src/js/military_tools/military_symbol_tool/data/unidades.js` | 1302 | lido (2 achados) | 2026-08-14 |
| 379 | `src/js/military_tools/military_symbol_tool/index.js` | 6 | lido (1 achado) | 2026-08-14 |
| 380 | `src/js/military_tools/military_symbol_tool/military_constants.js` | 350 | lido (2 achados) | 2026-08-14 |
| 381 | `src/js/military_tools/military_symbol_tool/military_symbol_generator.js` | 379 | lido (2 achados) | 2026-08-14 |
| 382 | `src/js/military_tools/military_symbol_tool/text_modifiers_catalog.js` | 577 | lido (3 achados) | 2026-08-14 |
| 383 | `src/js/military_tools/occupied_front_tool/add_occupied_front_control.js` | 830 | lido (6 achados) | 2026-08-14 |
| 384 | `src/js/military_tools/occupied_front_tool/add_occupied_front_geometry.js` | 411 | lido (2 achados) | 2026-08-14 |
| 385 | `src/js/military_tools/occupied_front_tool/index.js` | 4 | sem alteracao | 2026-08-14 |
| 386 | `src/js/military_tools/occupied_front_tool/occupied_front_attributes_panel.js` | 76 | sem alteracao | 2026-08-14 |
| 387 | `src/js/military_tools/svg-to-png.js` | 113 | sem alteracao | 2026-08-14 |
| 388 | `src/js/modals/atlas-settings.modal.js` | 396 | lido (1 achado) | 2026-08-14 |
| 389 | `src/js/modals/batch-points.modal.js` | 264 | lido (2 achados) | 2026-08-14 |
| 390 | `src/js/modals/combine-maps.modal.js` | 304 | lido (1 achado) | 2026-08-14 |
| 391 | `src/js/modals/confirm.modal.js` | 304 | lido (1 achado) | 2026-08-14 |
| 392 | `src/js/modals/coordinate-edit.modal.js` | 304 | lido (2 achados) | 2026-08-14 |
| 393 | `src/js/modals/create-atlas.modal.js` | 453 | lido (1 achado) | 2026-08-14 |
| 394 | `src/js/modals/export.modal.js` | 315 | lido (1 achado) | 2026-08-14 |
| 395 | `src/js/modals/import-slides.modal.js` | 296 | sem alteracao | 2026-08-14 |
| 396 | `src/js/modals/index.js` | 17 | sem alteracao | 2026-08-14 |
| 397 | `src/js/modals/info.modal.js` | 239 | lido (2 achados) | 2026-08-14 |
| 398 | `src/js/modals/login.modal.js` | 306 | sem alteracao | 2026-08-14 |
| 399 | `src/js/modals/modal.base.js` | 253 | lido (2 achados) | 2026-08-14 |
| 400 | `src/js/modals/prompt.modal.js` | 229 | lido (2 achados) | 2026-08-14 |
| 401 | `src/js/modals/settings.modal.js` | 280 | lido (3 achados) | 2026-08-14 |
| 402 | `src/js/modals/sharing.modal.js` | 787 | lido (4 achados) | 2026-08-14 |
| 403 | `src/js/modals/shortcuts.modal.js` | 190 | lido (1 achado) | 2026-08-14 |
| 404 | `src/js/modals/signup.modal.js` | 414 | lido (1 achado) | 2026-08-14 |
| 405 | `src/js/mode/application-mode.manager.js` | 376 | lido (3 achados) | 2026-08-14 |
| 406 | `src/js/mode/index.js` | 15 | lido (1 achado) | 2026-08-14 |
| 407 | `src/js/phone/index.js` | 7 | sem alteracao | 2026-08-14 |
| 408 | `src/js/phone/phone-baselayer-modal.js` | 232 | lido (1 achado) | 2026-08-14 |
| 409 | `src/js/phone/phone-bottom-sheet.js` | 887 | lido (2 achados) | 2026-08-14 |
| 410 | `src/js/phone/phone-drawer.js` | 697 | lido (1 achado) | 2026-08-14 |
| 411 | `src/js/phone/phone-fabs.js` | 203 | sem alteracao | 2026-08-14 |
| 412 | `src/js/phone/phone-feature-editor.js` | 534 | sem alteracao | 2026-08-14 |
| 413 | `src/js/phone/phone-icons.constants.js` | 85 | sem alteracao | 2026-08-14 |
| 414 | `src/js/phone/phone-layout.js` | 1192 | lido (8 achados) | 2026-08-14 |
| 415 | `src/js/phone/phone-move-actions.js` | 109 | sem alteracao | 2026-08-14 |
| 416 | `src/js/phone/phone-search-overlay.js` | 456 | lido (2 achados) | 2026-08-14 |
| 417 | `src/js/presence/index.js` | 17 | sem alteracao | 2026-08-14 |
| 418 | `src/js/presence/online-users.control.js` | 389 | sem alteracao | 2026-08-14 |
| 419 | `src/js/presence/presence-bridge.js` | 456 | sem alteracao | 2026-08-14 |
| 420 | `src/js/presence/presence-colors.js` | 71 | sem alteracao | 2026-08-14 |
| 421 | `src/js/presence/presence-store.js` | 555 | sem alteracao | 2026-08-14 |
| 422 | `src/js/presence/remote-cursors.layer.js` | 253 | sem alteracao | 2026-08-14 |
| 423 | `src/js/presence/remote-selections.layer.js` | 311 | lido (1 achado) | 2026-08-14 |
| 424 | `src/js/processing/algorithms/algorithm.interface.js` | 39 | sem alteracao | 2026-08-14 |
| 425 | `src/js/processing/algorithms/buffer.algorithm.js` | 228 | sem alteracao | 2026-08-14 |
| 426 | `src/js/processing/algorithms/convex-hull.algorithm.js` | 183 | sem alteracao | 2026-08-14 |
| 427 | `src/js/processing/algorithms/index.js` | 11 | sem alteracao | 2026-08-14 |
| 428 | `src/js/processing/algorithms/panel-builder.js` | 235 | lido (1 achado) | 2026-08-14 |
| 429 | `src/js/processing/algorithms/voronoi.algorithm.js` | 458 | sem alteracao | 2026-08-14 |
| 430 | `src/js/processing/index.js` | 31 | sem alteracao | 2026-08-14 |
| 431 | `src/js/processing/processing-panel.js` | 138 | lido (1 achado) | 2026-08-14 |
| 432 | `src/js/processing/processing-runner.js` | 168 | sem alteracao | 2026-08-14 |
| 433 | `src/js/processing/processing.constants.js` | 143 | sem alteracao | 2026-08-14 |
| 434 | `src/js/processing/processing.tab.js` | 187 | lido (2 achados) | 2026-08-14 |
| 435 | `src/js/projects/atlas-drive.js` | 608 | lido (2 achados) | 2026-08-14 |
| 436 | `src/js/projects/import-ebgeo.service.js` | 109 | sem alteracao | 2026-08-14 |
| 437 | `src/js/projects/permission-levels.js` | 79 | criado nesta auditoria | 2026-08-14 |
| 438 | `src/js/projects/projects-page.js` | 271 | lido (1 achado) | 2026-08-14 |
| 439 | `src/js/search/feature-search.control.js` | 342 | lido (1 achado) | 2026-08-14 |
| 440 | `src/js/search/gazetteer-url.js` | 26 | sem alteracao | 2026-08-14 |
| 441 | `src/js/search/index.js` | 9 | sem alteracao | 2026-08-14 |
| 442 | `src/js/search/search-bar.component.js` | 837 | lido (4 achados) | 2026-08-14 |
| 443 | `src/js/search/search-bar.icons.js` | 55 | sem alteracao | 2026-08-14 |
| 444 | `src/js/search/search-bar.search-providers.js` | 304 | sem alteracao | 2026-08-14 |
| 445 | `src/js/search/search-bar.sidepanel-content.js` | 292 | sem alteracao | 2026-08-14 |
| 446 | `src/js/selection_tools/index.js` | 8 | sem alteracao | 2026-08-14 |
| 447 | `src/js/selection_tools/rectangle_selection_control.js` | 251 | lido (1 achado) | 2026-08-14 |
| 448 | `src/js/session/idle-timeout.controller.js` | 64 | sem alteracao | 2026-08-14 |
| 449 | `src/js/session/idle-timer.js` | 88 | sem alteracao | 2026-08-14 |
| 450 | `src/js/session/idle-watch.js` | 170 | sem alteracao | 2026-08-14 |
| 451 | `src/js/sidebar/components/chips.component.js` | 326 | sem alteracao | 2026-08-14 |
| 452 | `src/js/sidebar/components/feature-identification.js` | 613 | sem alteracao | 2026-08-14 |
| 453 | `src/js/sidebar/components/feature-location-section.js` | 330 | sem alteracao | 2026-08-14 |
| 454 | `src/js/sidebar/components/feature-panel.js` | 271 | lido (1 achado) | 2026-08-14 |
| 455 | `src/js/sidebar/components/feature-photo-gallery.js` | 379 | lido (2 achados) | 2026-08-14 |
| 456 | `src/js/sidebar/components/feature-tabs.js` | 252 | lido (2 achados) | 2026-08-14 |
| 457 | `src/js/sidebar/components/group-type-selector.js` | 141 | sem alteracao | 2026-08-14 |
| 458 | `src/js/sidebar/components/multi-selection-actions.js` | 144 | lido (1 achado) | 2026-08-14 |
| 459 | `src/js/sidebar/components/sidebar-collapsed.js` | 267 | lido (1 achado) | 2026-08-14 |
| 460 | `src/js/sidebar/components/sidebar-panel.js` | 196 | lido (1 achado) | 2026-08-14 |
| 461 | `src/js/sidebar/handlers/feature-3d-handlers.js` | 399 | sem alteracao | 2026-08-14 |
| 462 | `src/js/sidebar/handlers/index.js` | 22 | sem alteracao | 2026-08-14 |
| 463 | `src/js/sidebar/index.js` | 21 | sem alteracao | 2026-08-14 |
| 464 | `src/js/sidebar/panels/feature-panel-content.js` | 1007 | lido (3 achados) | 2026-08-14 |
| 465 | `src/js/sidebar/panels/index.js` | 28 | lido (1 achado) | 2026-08-14 |
| 466 | `src/js/sidebar/panels/notes-panel.js` | 345 | lido (1 achado) | 2026-08-14 |
| 467 | `src/js/sidebar/panels/vector-info-panel.js` | 142 | sem alteracao | 2026-08-14 |
| 468 | `src/js/sidebar/sidebar.constants.js` | 85 | sem alteracao | 2026-08-14 |
| 469 | `src/js/sidebar/sidebar.control.js` | 1325 | lido (3 achados) | 2026-08-14 |
| 470 | `src/js/sidebar/tabs/briefings.tab.js` | 470 | lido (2 achados) | 2026-08-14 |
| 471 | `src/js/sidebar/tabs/export.tab.js` | 1001 | lido (2 achados) | 2026-08-14 |
| 472 | `src/js/sidebar/tabs/import.tab.js` | 458 | lido (2 achados) | 2026-08-14 |
| 473 | `src/js/sidebar/tabs/kmz-export.section.js` | 240 | lido (1 achado) | 2026-08-14 |
| 474 | `src/js/sidebar/tabs/layers.tab.js` | 172 | lido (1 achado) | 2026-08-14 |
| 475 | `src/js/sidebar/tabs/maps.tab.js` | 1370 | lido (4 achados) | 2026-08-14 |
| 476 | `src/js/sidebar/tabs/remote-map-redirect.js` | 33 | sem alteracao | 2026-08-14 |
| 477 | `src/js/snapping/index.js` | 15 | sem alteracao | 2026-08-14 |
| 478 | `src/js/snapping/snapping.constants.js` | 90 | sem alteracao | 2026-08-14 |
| 479 | `src/js/snapping/snapping.service.js` | 439 | sem alteracao | 2026-08-14 |
| 480 | `src/js/state/index.js` | 12 | sem alteracao | 2026-08-14 |
| 481 | `src/js/state/state_manager.js` | 1101 | lido (4 achados) | 2026-08-14 |
| 482 | `src/js/store/atlas/atlas.entity.js` | 159 | lido (2 achados) | 2026-08-14 |
| 483 | `src/js/store/atlas/index.js` | 17 | sem alteracao | 2026-08-14 |
| 484 | `src/js/store/briefing.operations.js` | 464 | lido (1 achado) | 2026-08-14 |
| 485 | `src/js/store/catalog.operations.js` | 338 | lido (2 achados) | 2026-08-14 |
| 486 | `src/js/store/cesium3d.operations.js` | 1218 | lido (3 achados) | 2026-08-14 |
| 487 | `src/js/store/comment.operations.js` | 224 | sem alteracao | 2026-08-14 |
| 488 | `src/js/store/control.registry.js` | 36 | sem alteracao | 2026-08-14 |
| 489 | `src/js/store/customIcons.operations.js` | 198 | lido (2 achados) | 2026-08-14 |
| 490 | `src/js/store/feature.operations.js` | 1124 | sem alteracao | 2026-08-14 |
| 491 | `src/js/store/group.operations.js` | 179 | lido (1 achado) | 2026-08-14 |
| 492 | `src/js/store/index.js` | 76 | sem alteracao | 2026-08-14 |
| 493 | `src/js/store/layer.operations.js` | 292 | sem alteracao | 2026-08-14 |
| 494 | `src/js/store/map-badge-colors.js` | 49 | sem alteracao | 2026-08-14 |
| 495 | `src/js/store/map.operations.js` | 892 | lido (2 achados) | 2026-08-14 |
| 496 | `src/js/store/memory-store.js` | 78 | sem alteracao | 2026-08-14 |
| 497 | `src/js/store/migration/index.js` | 31 | lido (1 achado) | 2026-08-14 |
| 498 | `src/js/store/migration/migration.service.js` | 125 | sem alteracao | 2026-08-14 |
| 499 | `src/js/store/migration/v1-to-v2.migration.js` | 279 | lido (1 achado) | 2026-08-14 |
| 500 | `src/js/store/migration/v2-to-v2.1.migration.js` | 77 | sem alteracao | 2026-08-14 |
| 501 | `src/js/store/migration/v2.1-to-v2.2.migration.js` | 41 | sem alteracao | 2026-08-14 |
| 502 | `src/js/store/repositories/index.js` | 500 | lido (2 achados) | 2026-08-14 |
| 503 | `src/js/store/repositories/local.repository.js` | 774 | lido (1 achado) | 2026-08-14 |
| 504 | `src/js/store/repositories/repository.interface.js` | 212 | lido (1 achado) | 2026-08-14 |
| 505 | `src/js/store/repository.js` | 433 | sem alteracao | 2026-08-14 |
| 506 | `src/js/store/repository.utils.js` | 175 | sem alteracao | 2026-08-14 |
| 507 | `src/js/store/services.js` | 146 | lido (1 achado) | 2026-08-14 |
| 508 | `src/js/store/services/index.js` | 13 | lido (1 achado) | 2026-08-14 |
| 509 | `src/js/store/services/map-resolver.service.js` | 231 | sem alteracao | 2026-08-14 |
| 510 | `src/js/store/settings.operations.js` | 255 | lido (1 achado) | 2026-08-14 |
| 511 | `src/js/store/store-error-listener.js` | 74 | sem alteracao | 2026-08-14 |
| 512 | `src/js/store/store-errors.js` | 53 | lido (1 achado) | 2026-08-14 |
| 513 | `src/js/store/store-origin.js` | 98 | sem alteracao | 2026-08-14 |
| 514 | `src/js/store/store-state-manager.js` | 829 | lido (1 achado) | 2026-08-14 |
| 515 | `src/js/store/store-transaction.js` | 136 | sem alteracao | 2026-08-14 |
| 516 | `src/js/store/store.constants.js` | 215 | sem alteracao | 2026-08-14 |
| 517 | `src/js/store/store.js` | 579 | sem alteracao | 2026-08-14 |
| 518 | `src/js/store/store.types.js` | 186 | lido (1 achado) | 2026-08-14 |
| 519 | `src/js/store/streetview360.operations.js` | 723 | lido (3 achados) | 2026-08-14 |
| 520 | `src/js/store/sync/api-client.js` | 1435 | lido (3 achados) | 2026-08-14 |
| 521 | `src/js/store/sync/atlas-settings.service.js` | 201 | sem alteracao | 2026-08-14 |
| 522 | `src/js/store/sync/connection-state.js` | 135 | sem alteracao | 2026-08-14 |
| 523 | `src/js/store/sync/diag/bus-tap.js` | 127 | sem alteracao | 2026-08-14 |
| 524 | `src/js/store/sync/diag/trace-core.js` | 190 | sem alteracao | 2026-08-14 |
| 525 | `src/js/store/sync/diag/trace-stages.js` | 68 | lido (1 achado) | 2026-08-14 |
| 526 | `src/js/store/sync/event-bridges.js` | 39 | sem alteracao | 2026-08-14 |
| 527 | `src/js/store/sync/image-sync.js` | 107 | sem alteracao | 2026-08-14 |
| 528 | `src/js/store/sync/index.js` | 191 | sem alteracao | 2026-08-14 |
| 529 | `src/js/store/sync/operation-dispatcher.js` | 367 | sem alteracao | 2026-08-14 |
| 530 | `src/js/store/sync/operation-factory.js` | 192 | lido (1 achado) | 2026-08-14 |
| 531 | `src/js/store/sync/operation-queue.js` | 409 | lido (2 achados) | 2026-08-14 |
| 532 | `src/js/store/sync/operation-types.js` | 63 | sem alteracao | 2026-08-14 |
| 533 | `src/js/store/sync/permission-guard.js` | 110 | sem alteracao | 2026-08-14 |
| 534 | `src/js/store/sync/remote-operation-handler.js` | 1267 | lido (2 achados) | 2026-08-14 |
| 535 | `src/js/store/sync/runtime-config.js` | 73 | sem alteracao | 2026-08-14 |
| 536 | `src/js/store/sync/session-context.js` | 372 | sem alteracao | 2026-08-14 |
| 537 | `src/js/store/sync/sync-engine.js` | 644 | lido (1 achado) | 2026-08-14 |
| 538 | `src/js/store/sync/sync-flush.js` | 235 | sem alteracao | 2026-08-14 |
| 539 | `src/js/store/sync/sync-gateway.js` | 89 | sem alteracao | 2026-08-14 |
| 540 | `src/js/store/sync/sync-metadata.js` | 199 | sem alteracao | 2026-08-14 |
| 541 | `src/js/store/sync/sync-scheduler.js` | 26 | lido (1 achado) | 2026-08-14 |
| 542 | `src/js/store/sync/ws-client.js` | 590 | lido (2 achados) | 2026-08-14 |
| 543 | `src/js/store/temporal.operations.js` | 125 | lido (1 achado) | 2026-08-14 |
| 544 | `src/js/store/undo-redo-messages.js` | 92 | sem alteracao | 2026-08-14 |
| 545 | `src/js/street_view_tool/add_street_view_control.js` | 748 | lido (3 achados) | 2026-08-14 |
| 546 | `src/js/street_view_tool/components/compass-360.js` | 276 | lido (1 achado) | 2026-08-14 |
| 547 | `src/js/street_view_tool/components/floor-selector-360.js` | 196 | lido (1 achado) | 2026-08-14 |
| 548 | `src/js/street_view_tool/components/marker-panel-360.js` | 898 | lido (6 achados) | 2026-08-14 |
| 549 | `src/js/street_view_tool/components/streetview-sidebar.js` | 353 | lido (1 achado) | 2026-08-14 |
| 550 | `src/js/street_view_tool/index.js` | 24 | sem alteracao | 2026-08-14 |
| 551 | `src/js/street_view_tool/navigation/constants.js` | 201 | sem alteracao | 2026-08-14 |
| 552 | `src/js/street_view_tool/navigation/hit-tester.js` | 89 | sem alteracao | 2026-08-14 |
| 553 | `src/js/street_view_tool/navigation/index.js` | 12 | sem alteracao | 2026-08-14 |
| 554 | `src/js/street_view_tool/navigation/minimap-sync.js` | 117 | sem alteracao | 2026-08-14 |
| 555 | `src/js/street_view_tool/navigation/navigator.js` | 921 | lido (4 achados) | 2026-08-14 |
| 556 | `src/js/street_view_tool/navigation/projector.js` | 359 | sem alteracao | 2026-08-14 |
| 557 | `src/js/street_view_tool/navigation/renderer.js` | 710 | lido (1 achado) | 2026-08-14 |
| 558 | `src/js/street_view_tool/saved_photos_markers.js` | 440 | lido (3 achados) | 2026-08-14 |
| 559 | `src/js/street_view_tool/services/keyboard_service_360.js` | 239 | lido (2 achados) | 2026-08-14 |
| 560 | `src/js/street_view_tool/street-view-mini-map-style.js` | 22 | sem alteracao | 2026-08-14 |
| 561 | `src/js/street_view_tool/street_view_viewer.js` | 2147 | lido (3 achados) | 2026-08-14 |
| 562 | `src/js/street_view_tool/streetview-api.service.js` | 320 | lido (1 achado) | 2026-08-14 |
| 563 | `src/js/street_view_tool/streetview_markers.js` | 667 | sem alteracao | 2026-08-14 |
| 564 | `src/js/street_view_tool/tools/marker_tool_360.js` | 173 | lido (2 achados) | 2026-08-14 |
| 565 | `src/js/street_view_tool/tools/screenshot_tool_360.js` | 113 | sem alteracao | 2026-08-14 |
| 566 | `src/js/temporal/index.js` | 23 | sem alteracao | 2026-08-14 |
| 567 | `src/js/temporal/temporal-attributes-section.js` | 705 | lido (2 achados) | 2026-08-14 |
| 568 | `src/js/temporal/temporal-controller.js` | 422 | sem alteracao | 2026-08-14 |
| 569 | `src/js/temporal/temporal-derivation.service.js` | 255 | sem alteracao | 2026-08-14 |
| 570 | `src/js/temporal/temporal-import.js` | 130 | sem alteracao | 2026-08-14 |
| 571 | `src/js/temporal/temporal-model.js` | 277 | sem alteracao | 2026-08-14 |
| 572 | `src/js/temporal/temporal-render.service.js` | 438 | lido (3 achados) | 2026-08-14 |
| 573 | `src/js/temporal/temporal-settings.modal.js` | 472 | lido (2 achados) | 2026-08-14 |
| 574 | `src/js/temporal/temporal-timeline-bar.js` | 345 | lido (3 achados) | 2026-08-14 |
| 575 | `src/js/temporal/temporal.constants.js` | 99 | sem alteracao | 2026-08-14 |
| 576 | `src/js/temporal/temporal.utils.js` | 325 | sem alteracao | 2026-08-14 |
| 577 | `src/js/temporal/trajectory-anchor.js` | 74 | sem alteracao | 2026-08-14 |
| 578 | `src/js/temporal/trajectory-tool/trajectory-edit-control.js` | 803 | sem alteracao | 2026-08-14 |
| 579 | `src/js/temporal/trajectory-tool/trajectory-edit-geometry.js` | 123 | sem alteracao | 2026-08-14 |
| 580 | `src/js/terrain/analysis-layers.manager.js` | 287 | sem alteracao | 2026-08-14 |
| 581 | `src/js/terrain/data-layers.manager.js` | 523 | sem alteracao | 2026-08-14 |
| 582 | `src/js/terrain/index.js` | 10 | sem alteracao | 2026-08-14 |
| 583 | `src/js/terrain/terrain.control.js` | 218 | lido (1 achado) | 2026-08-14 |
| 584 | `src/js/tool_manager/base_control.js` | 467 | lido (1 achado) | 2026-08-14 |
| 585 | `src/js/tool_manager/base_geometry.js` | 102 | sem alteracao | 2026-08-14 |
| 586 | `src/js/tool_manager/clipboard_manager.js` | 534 | lido (2 achados) | 2026-08-14 |
| 587 | `src/js/tool_manager/group_manager.js` | 605 | lido (2 achados) | 2026-08-14 |
| 588 | `src/js/tool_manager/hatch_config_modal.js` | 119 | lido (1 achado) | 2026-08-14 |
| 589 | `src/js/tool_manager/hatch_pattern_generator.js` | 201 | sem alteracao | 2026-08-14 |
| 590 | `src/js/tool_manager/helpers/base-attributes-panel.js` | 74 | sem alteracao | 2026-08-14 |
| 591 | `src/js/tool_manager/helpers/buttons.helpers.js` | 111 | sem alteracao | 2026-08-14 |
| 592 | `src/js/tool_manager/helpers/color-picker.helpers.js` | 487 | lido (1 achado) | 2026-08-14 |
| 593 | `src/js/tool_manager/helpers/common-config.helpers.js` | 67 | sem alteracao | 2026-08-14 |
| 594 | `src/js/tool_manager/helpers/coordinate-editor.helpers.js` | 80 | lido (1 achado) | 2026-08-14 |
| 595 | `src/js/tool_manager/helpers/feature-header.helpers.js` | 1518 | lido (2 achados) | 2026-08-14 |
| 596 | `src/js/tool_manager/helpers/form-controls.helpers.js` | 308 | lido (1 achado) | 2026-08-14 |
| 597 | `src/js/tool_manager/helpers/hatch-control.helpers.js` | 234 | lido (1 achado) | 2026-08-14 |
| 598 | `src/js/tool_manager/helpers/index.js` | 116 | lido (1 achado) | 2026-08-14 |
| 599 | `src/js/tool_manager/helpers/label-tab.helpers.js` | 447 | lido (1 achado) | 2026-08-14 |
| 600 | `src/js/tool_manager/helpers/line-style.helpers.js` | 126 | sem alteracao | 2026-08-14 |
| 601 | `src/js/tool_manager/helpers/marker-symbol-picker.helpers.js` | 172 | lido (1 achado) | 2026-08-14 |
| 602 | `src/js/tool_manager/helpers/observations-editor.helpers.js` | 107 | sem alteracao | 2026-08-14 |
| 603 | `src/js/tool_manager/helpers/section-divider.helpers.js` | 32 | sem alteracao | 2026-08-14 |
| 604 | `src/js/tool_manager/helpers/slider.helpers.js` | 293 | lido (2 achados) | 2026-08-14 |
| 605 | `src/js/tool_manager/helpers/text-alignment.helpers.js` | 105 | sem alteracao | 2026-08-14 |
| 606 | `src/js/tool_manager/helpers/zoom-correction.helpers.js` | 89 | sem alteracao | 2026-08-14 |
| 607 | `src/js/tool_manager/index.js` | 34 | sem alteracao | 2026-08-14 |
| 608 | `src/js/tool_manager/managers/index.js` | 15 | sem alteracao | 2026-08-14 |
| 609 | `src/js/tool_manager/managers/profile-panel.manager.js` | 615 | lido (2 achados) | 2026-08-14 |
| 610 | `src/js/tool_manager/managers/selection-highlight.manager.js` | 508 | lido (3 achados) | 2026-08-14 |
| 611 | `src/js/tool_manager/move_handler.js` | 735 | lido (2 achados) | 2026-08-14 |
| 612 | `src/js/tool_manager/selection_manager.js` | 1048 | lido (3 achados) | 2026-08-14 |
| 613 | `src/js/tool_manager/tabbed_attribute_panel.js` | 218 | lido (2 achados) | 2026-08-14 |
| 614 | `src/js/tool_manager/tool_manager.js` | 227 | lido (1 achado) | 2026-08-14 |
| 615 | `src/js/tool_manager/ui_manager.js` | 681 | lido (2 achados) | 2026-08-14 |
| 616 | `src/js/toolbar/components/active-tool-chip.js` | 300 | lido (1 achado) | 2026-08-14 |
| 617 | `src/js/toolbar/components/tool-button.js` | 136 | sem alteracao | 2026-08-14 |
| 618 | `src/js/toolbar/components/toolbar-group.js` | 418 | lido (2 achados) | 2026-08-14 |
| 619 | `src/js/toolbar/index.js` | 11 | sem alteracao | 2026-08-14 |
| 620 | `src/js/toolbar/toolbar.constants.js` | 193 | lido (1 achado) | 2026-08-14 |
| 621 | `src/js/toolbar/toolbar.control.js` | 268 | lido (1 achado) | 2026-08-14 |
| 622 | `src/js/ui/app-bar.js` | 143 | sem alteracao | 2026-08-14 |
| 623 | `src/js/ui/index.js` | 16 | sem alteracao | 2026-08-14 |
| 624 | `src/js/ui/loading-screen-3d.js` | 72 | sem alteracao | 2026-08-14 |
| 625 | `src/js/ui/loading-screen.js` | 24 | sem alteracao | 2026-08-14 |
| 626 | `src/js/ui/ui-visibility.controller.js` | 491 | lido (3 achados) | 2026-08-14 |
| 627 | `src/js/ui/unavailable-screen.js` | 58 | sem alteracao | 2026-08-14 |
| 628 | `src/js/ui/view-mode.controller.js` | 86 | sem alteracao | 2026-08-14 |
| 629 | `src/js/user_data/attributes_tab_renderer.js` | 420 | lido (1 achado) | 2026-08-14 |
| 630 | `src/js/user_data/images_tab_renderer.js` | 207 | lido (2 achados) | 2026-08-14 |
| 631 | `src/js/user_data/index.js` | 9 | sem alteracao | 2026-08-14 |
| 632 | `src/js/user_data/user_data_manager.js` | 604 | lido (3 achados) | 2026-08-14 |
| 633 | `src/js/utilities/angle-format.js` | 23 | sem alteracao | 2026-08-14 |
| 634 | `src/js/utilities/coordinate_converter.js` | 542 | lido (2 achados) | 2026-08-14 |
| 635 | `src/js/utilities/csv-escape.js` | 33 | criado nesta auditoria | 2026-08-14 |
| 636 | `src/js/utilities/data-captura.js` | 43 | sem alteracao | 2026-08-14 |
| 637 | `src/js/utilities/debounced-persist.js` | 181 | lido (1 achado) | 2026-08-14 |
| 638 | `src/js/utilities/deep-utils.js` | 186 | sem alteracao | 2026-08-14 |
| 639 | `src/js/utilities/event-cleanup.js` | 192 | sem alteracao | 2026-08-14 |
| 640 | `src/js/utilities/feature_navigation_utils.js` | 186 | sem alteracao | 2026-08-14 |
| 641 | `src/js/utilities/geomagnetic/index.js` | 7 | sem alteracao | 2026-08-14 |
| 642 | `src/js/utilities/geomagnetic/meridian_convergence.js` | 54 | sem alteracao | 2026-08-14 |
| 643 | `src/js/utilities/geomagnetic/wmm_calculator.js` | 119 | sem alteracao | 2026-08-14 |
| 644 | `src/js/utilities/geometry-utils.js` | 270 | sem alteracao | 2026-08-14 |
| 645 | `src/js/utilities/html-escape.js` | 62 | sem alteracao | 2026-08-14 |
| 646 | `src/js/utilities/id_utils.js` | 213 | sem alteracao | 2026-08-14 |
| 647 | `src/js/utilities/image_utils.js` | 162 | lido (1 achado) | 2026-08-14 |
| 648 | `src/js/utilities/index.js` | 97 | sem alteracao | 2026-08-14 |
| 649 | `src/js/utilities/logo-base64.js` | 45 | lido (1 achado) | 2026-08-14 |
| 650 | `src/js/utilities/lru-cache.js` | 196 | lido (1 achado) | 2026-08-14 |
| 651 | `src/js/utilities/map-image-loader.js` | 57 | sem alteracao | 2026-08-14 |
| 652 | `src/js/utilities/maplibre-preload.js` | 539 | lido (2 achados) | 2026-08-14 |
| 653 | `src/js/utilities/maplibre-style-validate.js` | 46 | sem alteracao | 2026-08-14 |
| 654 | `src/js/utilities/pointer-utils.js` | 311 | lido (1 achado) | 2026-08-14 |
| 655 | `src/js/utilities/quill-helpers.js` | 236 | lido (3 achados) | 2026-08-14 |
| 656 | `src/js/utilities/streetview360-state.js` | 13 | sem alteracao | 2026-08-14 |
| 657 | `src/js/utilities/tab-lock.js` | 144 | lido (2 achados) | 2026-08-14 |
| 658 | `src/js/utilities/toast_service.js` | 232 | lido (2 achados) | 2026-08-14 |
| 659 | `src/js/utilities/uuid.js` | 47 | sem alteracao | 2026-08-14 |
| 660 | `src/js/utilities/viewer3d-state.js` | 13 | sem alteracao | 2026-08-14 |
| 661 | `src/js/vector_info/index.js` | 8 | sem alteracao | 2026-08-14 |
| 662 | `src/js/vector_info/vector-info.control.js` | 236 | lido (3 achados) | 2026-08-14 |
| 663 | `stylelint.config.js` | 67 | sem alteracao | 2026-08-14 |
| 664 | `tests/TESTING-BACKLOG.md` | 396 | lido (1 achado) | 2026-08-14 |
| 665 | `tests/TESTING.md` | 151 | lido (4 achados) | 2026-08-14 |
| 666 | `tests/e2e-ui/README.md` | 189 | lido (2 achados) | 2026-08-14 |
| 667 | `tests/e2e-ui/_backend-required.spec.js` | 25 | sem alteracao | 2026-08-14 |
| 668 | `tests/e2e-ui/_capture-comments.mjs` | 112 | lido (1 achado) | 2026-08-14 |
| 669 | `tests/e2e-ui/attribute-table.spec.js` | 218 | lido (1 achado) | 2026-08-14 |
| 670 | `tests/e2e-ui/backend.js` | 164 | sem alteracao | 2026-08-14 |
| 671 | `tests/e2e-ui/base-layer-selector.spec.js` | 91 | sem alteracao | 2026-08-14 |
| 672 | `tests/e2e-ui/bottom-controls.spec.js` | 64 | sem alteracao | 2026-08-14 |
| 673 | `tests/e2e-ui/browser-admin-catalog.spec.js` | 183 | sem alteracao | 2026-08-14 |
| 674 | `tests/e2e-ui/browser-admin-config.spec.js` | 86 | sem alteracao | 2026-08-14 |
| 675 | `tests/e2e-ui/browser-admin-users.spec.js` | 126 | sem alteracao | 2026-08-14 |
| 676 | `tests/e2e-ui/browser-analysis-tools.spec.js` | 217 | sem alteracao | 2026-08-14 |
| 677 | `tests/e2e-ui/browser-atlas-config-layers.spec.js` | 64 | sem alteracao | 2026-08-14 |
| 678 | `tests/e2e-ui/browser-atlas-drive.spec.js` | 110 | sem alteracao | 2026-08-14 |
| 679 | `tests/e2e-ui/browser-atlas-url.spec.js` | 115 | lido (1 achado) | 2026-08-14 |
| 680 | `tests/e2e-ui/browser-auth-config.spec.js` | 196 | sem alteracao | 2026-08-14 |
| 681 | `tests/e2e-ui/browser-authz-ui.spec.js` | 187 | sem alteracao | 2026-08-14 |
| 682 | `tests/e2e-ui/browser-briefing-advanced.spec.js` | 452 | lido (1 achado) | 2026-08-14 |
| 683 | `tests/e2e-ui/browser-briefing-slides.spec.js` | 172 | sem alteracao | 2026-08-14 |
| 684 | `tests/e2e-ui/browser-cascade-atomicity.spec.js` | 259 | sem alteracao | 2026-08-14 |
| 685 | `tests/e2e-ui/browser-catalog-layer.spec.js` | 299 | sem alteracao | 2026-08-14 |
| 686 | `tests/e2e-ui/browser-cesium3d-crud.spec.js` | 416 | sem alteracao | 2026-08-14 |
| 687 | `tests/e2e-ui/browser-cesium3d.spec.js` | 326 | lido (1 achado) | 2026-08-14 |
| 688 | `tests/e2e-ui/browser-collab-3d-360.spec.js` | 91 | sem alteracao | 2026-08-14 |
| 689 | `tests/e2e-ui/browser-collab-all-types.spec.js` | 134 | sem alteracao | 2026-08-14 |
| 690 | `tests/e2e-ui/browser-collab-briefing-temporal.spec.js` | 212 | lido (1 achado) | 2026-08-14 |
| 691 | `tests/e2e-ui/browser-collab-crdt-conflict.spec.js` | 352 | sem alteracao | 2026-08-14 |
| 692 | `tests/e2e-ui/browser-collab-feature-mutations.spec.js` | 113 | sem alteracao | 2026-08-14 |
| 693 | `tests/e2e-ui/browser-collab-full-chain.spec.js` | 103 | sem alteracao | 2026-08-14 |
| 694 | `tests/e2e-ui/browser-collab-ledger.spec.js` | 58 | sem alteracao | 2026-08-14 |
| 695 | `tests/e2e-ui/browser-collab-lock.spec.js` | 71 | sem alteracao | 2026-08-14 |
| 696 | `tests/e2e-ui/browser-collab-map-order.spec.js` | 84 | sem alteracao | 2026-08-14 |
| 697 | `tests/e2e-ui/browser-collab-maps-layers.spec.js` | 186 | sem alteracao | 2026-08-14 |
| 698 | `tests/e2e-ui/browser-collab-mega.spec.js` | 464 | lido (1 achado) | 2026-08-14 |
| 699 | `tests/e2e-ui/browser-collab-multimap-isolation.spec.js` | 121 | sem alteracao | 2026-08-14 |
| 700 | `tests/e2e-ui/browser-collab-native-render.spec.js` | 71 | sem alteracao | 2026-08-14 |
| 701 | `tests/e2e-ui/browser-collab-permissions.spec.js` | 271 | lido (1 achado) | 2026-08-14 |
| 702 | `tests/e2e-ui/browser-collab-point-icon-update.spec.js` | 109 | sem alteracao | 2026-08-14 |
| 703 | `tests/e2e-ui/browser-collab-processing.spec.js` | 81 | sem alteracao | 2026-08-14 |
| 704 | `tests/e2e-ui/browser-collab-reconnect.spec.js` | 81 | sem alteracao | 2026-08-14 |
| 705 | `tests/e2e-ui/browser-collab-roundtrip-edit.spec.js` | 71 | sem alteracao | 2026-08-14 |
| 706 | `tests/e2e-ui/browser-collab-scale.spec.js` | 36 | sem alteracao | 2026-08-14 |
| 707 | `tests/e2e-ui/browser-collab-selection-drag.repro.spec.js` | 76 | sem alteracao | 2026-08-14 |
| 708 | `tests/e2e-ui/browser-collab-selection.spec.js` | 98 | sem alteracao | 2026-08-14 |
| 709 | `tests/e2e-ui/browser-collab-shared-atlas.spec.js` | 101 | sem alteracao | 2026-08-14 |
| 710 | `tests/e2e-ui/browser-collab-symbol-snapshot-regen.spec.js` | 73 | sem alteracao | 2026-08-14 |
| 711 | `tests/e2e-ui/browser-collab-three-client-flow.spec.js` | 246 | lido (2 achados) | 2026-08-14 |
| 712 | `tests/e2e-ui/browser-context-duplicate-combine-split.spec.js` | 342 | lido (2 achados) | 2026-08-14 |
| 713 | `tests/e2e-ui/browser-context-move.spec.js` | 224 | sem alteracao | 2026-08-14 |
| 714 | `tests/e2e-ui/browser-delete-atlas.spec.js` | 54 | sem alteracao | 2026-08-14 |
| 715 | `tests/e2e-ui/browser-duplicate-combine.spec.js` | 295 | sem alteracao | 2026-08-14 |
| 716 | `tests/e2e-ui/browser-f5-reconnect-map.repro.spec.js` | 70 | sem alteracao | 2026-08-14 |
| 717 | `tests/e2e-ui/browser-feature-attributes.spec.js` | 294 | lido (1 achado) | 2026-08-14 |
| 718 | `tests/e2e-ui/browser-feature-crud.spec.js` | 212 | lido (1 achado) | 2026-08-14 |
| 719 | `tests/e2e-ui/browser-feature-panel-edits.spec.js` | 317 | lido (1 achado) | 2026-08-14 |
| 720 | `tests/e2e-ui/browser-feature-types.spec.js` | 198 | sem alteracao | 2026-08-14 |
| 721 | `tests/e2e-ui/browser-feature-visibility-lock.spec.js` | 238 | sem alteracao | 2026-08-14 |
| 722 | `tests/e2e-ui/browser-grid-style.spec.js` | 142 | sem alteracao | 2026-08-14 |
| 723 | `tests/e2e-ui/browser-group-lifecycle.spec.js` | 236 | sem alteracao | 2026-08-14 |
| 724 | `tests/e2e-ui/browser-group-ops.spec.js` | 226 | sem alteracao | 2026-08-14 |
| 725 | `tests/e2e-ui/browser-idempotency-lww.spec.js` | 145 | sem alteracao | 2026-08-14 |
| 726 | `tests/e2e-ui/browser-idle-timeout.spec.js` | 84 | sem alteracao | 2026-08-14 |
| 727 | `tests/e2e-ui/browser-import-batch.spec.js` | 295 | sem alteracao | 2026-08-14 |
| 728 | `tests/e2e-ui/browser-layer-ops.spec.js` | 258 | sem alteracao | 2026-08-14 |
| 729 | `tests/e2e-ui/browser-lock-authz.spec.js` | 235 | sem alteracao | 2026-08-14 |
| 730 | `tests/e2e-ui/browser-logout-clears-map.repro.spec.js` | 85 | sem alteracao | 2026-08-14 |
| 731 | `tests/e2e-ui/browser-map-dup-snapshot.repro.spec.js` | 104 | sem alteracao | 2026-08-14 |
| 732 | `tests/e2e-ui/browser-map-lifecycle.spec.js` | 379 | lido (1 achado) | 2026-08-14 |
| 733 | `tests/e2e-ui/browser-map-subentities.spec.js` | 196 | sem alteracao | 2026-08-14 |
| 734 | `tests/e2e-ui/browser-military-tools.spec.js` | 252 | sem alteracao | 2026-08-14 |
| 735 | `tests/e2e-ui/browser-p11-roundtrip.spec.js` | 182 | lido (2 achados) | 2026-08-14 |
| 736 | `tests/e2e-ui/browser-p8-undo-local.spec.js` | 65 | sem alteracao | 2026-08-14 |
| 737 | `tests/e2e-ui/browser-public-lifecycle.spec.js` | 160 | sem alteracao | 2026-08-14 |
| 738 | `tests/e2e-ui/browser-reconnect-replay.spec.js` | 255 | lido (1 achado) | 2026-08-14 |
| 739 | `tests/e2e-ui/browser-save-local-to-server.spec.js` | 118 | sem alteracao | 2026-08-14 |
| 740 | `tests/e2e-ui/browser-settings-24-8.spec.js` | 84 | sem alteracao | 2026-08-14 |
| 741 | `tests/e2e-ui/browser-sharing-lifecycle.spec.js` | 202 | sem alteracao | 2026-08-14 |
| 742 | `tests/e2e-ui/browser-sharing-presence.spec.js` | 38 | sem alteracao | 2026-08-14 |
| 743 | `tests/e2e-ui/browser-sharing-public.spec.js` | 281 | sem alteracao | 2026-08-14 |
| 744 | `tests/e2e-ui/browser-signup.spec.js` | 112 | lido (1 achado) | 2026-08-14 |
| 745 | `tests/e2e-ui/browser-streetview360-crud.spec.js` | 360 | sem alteracao | 2026-08-14 |
| 746 | `tests/e2e-ui/browser-streetview360.spec.js` | 155 | lido (1 achado) | 2026-08-14 |
| 747 | `tests/e2e-ui/browser-temporal-advanced.spec.js` | 419 | sem alteracao | 2026-08-14 |
| 748 | `tests/e2e-ui/browser-temporal.spec.js` | 210 | sem alteracao | 2026-08-14 |
| 749 | `tests/e2e-ui/browser-two-client-broadcast.spec.js` | 211 | lido (1 achado) | 2026-08-14 |
| 750 | `tests/e2e-ui/browser-unavailable.spec.js` | 28 | sem alteracao | 2026-08-14 |
| 751 | `tests/e2e-ui/browser-undo-redo.spec.js` | 189 | sem alteracao | 2026-08-14 |
| 752 | `tests/e2e-ui/browser-view-mode.spec.js` | 92 | sem alteracao | 2026-08-14 |
| 753 | `tests/e2e-ui/catalog-modal.spec.js` | 157 | sem alteracao | 2026-08-14 |
| 754 | `tests/e2e-ui/constants.js` | 39 | sem alteracao | 2026-08-14 |
| 755 | `tests/e2e-ui/context-menu-local.spec.js` | 117 | sem alteracao | 2026-08-14 |
| 756 | `tests/e2e-ui/coordinate-display.spec.js` | 110 | sem alteracao | 2026-08-14 |
| 757 | `tests/e2e-ui/deep-link.spec.js` | 87 | sem alteracao | 2026-08-14 |
| 758 | `tests/e2e-ui/export-config.spec.js` | 164 | sem alteracao | 2026-08-14 |
| 759 | `tests/e2e-ui/global-setup.js` | 25 | sem alteracao | 2026-08-14 |
| 760 | `tests/e2e-ui/global-teardown.js` | 28 | sem alteracao | 2026-08-14 |
| 761 | `tests/e2e-ui/helpers/collab-helpers.js` | 505 | lido (4 achados) | 2026-08-14 |
| 762 | `tests/e2e-ui/helpers/collab.fixtures.js` | 194 | sem alteracao | 2026-08-14 |
| 763 | `tests/e2e-ui/helpers/db.js` | 86 | sem alteracao | 2026-08-14 |
| 764 | `tests/e2e-ui/helpers/full-chain.js` | 316 | lido (1 achado) | 2026-08-14 |
| 765 | `tests/e2e-ui/helpers/idb.js` | 89 | lido (1 achado) | 2026-08-14 |
| 766 | `tests/e2e-ui/helpers/ledger.js` | 244 | lido (1 achado) | 2026-08-14 |
| 767 | `tests/e2e-ui/helpers/trace-helpers.js` | 160 | lido (1 achado) | 2026-08-14 |
| 768 | `tests/e2e-ui/integration.spec.js` | 109 | lido (2 achados) | 2026-08-14 |
| 769 | `tests/e2e-ui/keyboard-shortcuts.spec.js` | 139 | sem alteracao | 2026-08-14 |
| 770 | `tests/e2e-ui/layers-tab-local.spec.js` | 265 | lido (1 achado) | 2026-08-14 |
| 771 | `tests/e2e-ui/lock.spec.js` | 192 | lido (2 achados) | 2026-08-14 |
| 772 | `tests/e2e-ui/login-flow.spec.js` | 83 | sem alteracao | 2026-08-14 |
| 773 | `tests/e2e-ui/map-gestures.spec.js` | 118 | lido (1 achado) | 2026-08-14 |
| 774 | `tests/e2e-ui/maps-tab-navigation.spec.js` | 180 | sem alteracao | 2026-08-14 |
| 775 | `tests/e2e-ui/mobile-layout.spec.js` | 169 | sem alteracao | 2026-08-14 |
| 776 | `tests/e2e-ui/presence-live-cursors.spec.js` | 171 | lido (1 achado) | 2026-08-14 |
| 777 | `tests/e2e-ui/presence.spec.js` | 308 | lido (1 achado) | 2026-08-14 |
| 778 | `tests/e2e-ui/processing-tab-local.spec.js` | 181 | sem alteracao | 2026-08-14 |
| 779 | `tests/e2e-ui/search-bar.spec.js` | 77 | sem alteracao | 2026-08-14 |
| 780 | `tests/e2e-ui/smoke.spec.js` | 28 | sem alteracao | 2026-08-14 |
| 781 | `tests/e2e-ui/state.js` | 20 | sem alteracao | 2026-08-14 |
| 782 | `tests/e2e-ui/static-modals.spec.js` | 127 | lido (1 achado) | 2026-08-14 |
| 783 | `tests/e2e-ui/temporal-local.spec.js` | 140 | sem alteracao | 2026-08-14 |
| 784 | `tests/e2e-ui/toolbar-drawing-tools.spec.js` | 90 | sem alteracao | 2026-08-14 |
| 785 | `tests/e2e-ui/utilities-measure.spec.js` | 162 | sem alteracao | 2026-08-14 |
| 786 | `tests/e2e-ui/viewer-360-open.spec.js` | 217 | sem alteracao | 2026-08-14 |
| 787 | `tests/e2e-ui/viewer-3d-open.spec.js` | 153 | sem alteracao | 2026-08-14 |
| 788 | `tests/e2e/_backend-required.e2e.test.js` | 27 | sem alteracao | 2026-08-14 |
| 789 | `tests/e2e/_smoke.e2e.test.js` | 26 | sem alteracao | 2026-08-14 |
| 790 | `tests/e2e/atlas-snapshot.e2e.test.js` | 98 | sem alteracao | 2026-08-14 |
| 791 | `tests/e2e/attribute-custom.e2e.test.js` | 142 | sem alteracao | 2026-08-14 |
| 792 | `tests/e2e/auth-session.e2e.test.js` | 107 | sem alteracao | 2026-08-14 |
| 793 | `tests/e2e/authz-map-delete.e2e.test.js` | 147 | sem alteracao | 2026-08-14 |
| 794 | `tests/e2e/authz-map-lock.e2e.test.js` | 141 | lido (1 achado) | 2026-08-14 |
| 795 | `tests/e2e/base-layer-grid.e2e.test.js` | 99 | sem alteracao | 2026-08-14 |
| 796 | `tests/e2e/batch-atomicity.e2e.test.js` | 136 | sem alteracao | 2026-08-14 |
| 797 | `tests/e2e/briefing-full.e2e.test.js` | 144 | sem alteracao | 2026-08-14 |
| 798 | `tests/e2e/briefing-slide.e2e.test.js` | 158 | sem alteracao | 2026-08-14 |
| 799 | `tests/e2e/bulk-image-preserve-id.e2e.test.js` | 50 | sem alteracao | 2026-08-14 |
| 800 | `tests/e2e/catalog-layer.e2e.test.js` | 163 | lido (1 achado) | 2026-08-14 |
| 801 | `tests/e2e/cesium3d.e2e.test.js` | 154 | sem alteracao | 2026-08-14 |
| 802 | `tests/e2e/combine-maps.e2e.test.js` | 157 | sem alteracao | 2026-08-14 |
| 803 | `tests/e2e/concurrent-update-converge.e2e.test.js` | 104 | sem alteracao | 2026-08-14 |
| 804 | `tests/e2e/config-contract.e2e.test.js` | 129 | sem alteracao | 2026-08-14 |
| 805 | `tests/e2e/cross-atlas-idor.e2e.test.js` | 105 | sem alteracao | 2026-08-14 |
| 806 | `tests/e2e/duplicate-map.e2e.test.js` | 130 | lido (1 achado) | 2026-08-14 |
| 807 | `tests/e2e/feature-crud.e2e.test.js` | 160 | sem alteracao | 2026-08-14 |
| 808 | `tests/e2e/feature-geojson-shape.e2e.test.js` | 100 | lido (1 achado) | 2026-08-14 |
| 809 | `tests/e2e/feature-move-layer.e2e.test.js` | 164 | sem alteracao | 2026-08-14 |
| 810 | `tests/e2e/feature-types-all.e2e.test.js` | 177 | sem alteracao | 2026-08-14 |
| 811 | `tests/e2e/global-setup.js` | 245 | lido (1 achado) | 2026-08-14 |
| 812 | `tests/e2e/group-combine-ungroup.e2e.test.js` | 193 | sem alteracao | 2026-08-14 |
| 813 | `tests/e2e/group-ops.e2e.test.js` | 220 | lido (1 achado) | 2026-08-14 |
| 814 | `tests/e2e/helpers/harness.js` | 162 | lido (1 achado) | 2026-08-14 |
| 815 | `tests/e2e/idempotency.e2e.test.js` | 102 | sem alteracao | 2026-08-14 |
| 816 | `tests/e2e/images-feature-reference.e2e.test.js` | 91 | sem alteracao | 2026-08-14 |
| 817 | `tests/e2e/import-geojson-batch.e2e.test.js` | 175 | sem alteracao | 2026-08-14 |
| 818 | `tests/e2e/lamport-echo.e2e.test.js` | 83 | sem alteracao | 2026-08-14 |
| 819 | `tests/e2e/layer-cascade.e2e.test.js` | 123 | sem alteracao | 2026-08-14 |
| 820 | `tests/e2e/layer-ops.e2e.test.js` | 192 | sem alteracao | 2026-08-14 |
| 821 | `tests/e2e/ledger-trace.e2e.test.js` | 95 | sem alteracao | 2026-08-14 |
| 822 | `tests/e2e/local-atlas-import.e2e.test.js` | 134 | sem alteracao | 2026-08-14 |
| 823 | `tests/e2e/lock-enforcement.e2e.test.js` | 206 | sem alteracao | 2026-08-14 |
| 824 | `tests/e2e/lww-arrival.e2e.test.js` | 127 | sem alteracao | 2026-08-14 |
| 825 | `tests/e2e/map-lifecycle.e2e.test.js` | 112 | lido (1 achado) | 2026-08-14 |
| 826 | `tests/e2e/map-order-sync.e2e.test.js` | 81 | sem alteracao | 2026-08-14 |
| 827 | `tests/e2e/map-subentities.e2e.test.js` | 139 | sem alteracao | 2026-08-14 |
| 828 | `tests/e2e/military-and-analysis.e2e.test.js` | 233 | sem alteracao | 2026-08-14 |
| 829 | `tests/e2e/nomes-busca-anon.e2e.test.js` | 55 | lido (1 achado) | 2026-08-14 |
| 830 | `tests/e2e/offline-then-flush.e2e.test.js` | 160 | sem alteracao | 2026-08-14 |
| 831 | `tests/e2e/permissions-viewer.e2e.test.js` | 96 | sem alteracao | 2026-08-14 |
| 832 | `tests/e2e/presence-cursor-selection.e2e.test.js` | 162 | lido (1 achado) | 2026-08-14 |
| 833 | `tests/e2e/public-read.e2e.test.js` | 130 | sem alteracao | 2026-08-14 |
| 834 | `tests/e2e/reconnect-replay.e2e.test.js` | 142 | sem alteracao | 2026-08-14 |
| 835 | `tests/e2e/setup-storage.js` | 57 | sem alteracao | 2026-08-14 |
| 836 | `tests/e2e/sharing-write.e2e.test.js` | 139 | sem alteracao | 2026-08-14 |
| 837 | `tests/e2e/snapshot-fidelity.e2e.test.js` | 236 | sem alteracao | 2026-08-14 |
| 838 | `tests/e2e/streetview360-annot.e2e.test.js` | 132 | lido (1 achado) | 2026-08-14 |
| 839 | `tests/e2e/temporal-feature.e2e.test.js` | 180 | sem alteracao | 2026-08-14 |
| 840 | `tests/e2e/temporal-mapconfig.e2e.test.js` | 127 | lido (1 achado) | 2026-08-14 |
| 841 | `tests/e2e/two-client-broadcast.e2e.test.js` | 136 | sem alteracao | 2026-08-14 |
| 842 | `tests/e2e/undo-redo.e2e.test.js` | 185 | lido (1 achado) | 2026-08-14 |
| 843 | `tests/helpers/real-fixtures.js` | 140 | sem alteracao | 2026-08-14 |
| 844 | `tests/helpers/test-utils.js` | 202 | lido (2 achados) | 2026-08-14 |
| 845 | `tests/integration/api-client.test.js` | 438 | lido (1 achado) | 2026-08-14 |
| 846 | `tests/integration/customIcons.operations.test.js` | 82 | sem alteracao | 2026-08-14 |
| 847 | `tests/integration/event-bus.test.js` | 263 | lido (1 achado) | 2026-08-14 |
| 848 | `tests/integration/event-error-lifecycle.test.js` | 363 | sem alteracao | 2026-08-14 |
| 849 | `tests/integration/image-sync.test.js` | 74 | sem alteracao | 2026-08-14 |
| 850 | `tests/integration/import-phantom-map.repro.test.js` | 240 | lido (1 achado) | 2026-08-14 |
| 851 | `tests/integration/lamport-clock-ordering.test.js` | 300 | lido (1 achado) | 2026-08-14 |
| 852 | `tests/integration/local-repository-real-shape.test.js` | 240 | sem alteracao | 2026-08-14 |
| 853 | `tests/integration/map-lock.test.js` | 378 | sem alteracao | 2026-08-14 |
| 854 | `tests/integration/offline-regression.test.js` | 423 | lido (5 achados) | 2026-08-14 |
| 855 | `tests/integration/online-users-control.test.js` | 284 | sem alteracao | 2026-08-14 |
| 856 | `tests/integration/operation-dispatcher.test.js` | 220 | lido (1 achado) | 2026-08-14 |
| 857 | `tests/integration/operation-logging-active.test.js` | 247 | lido (1 achado) | 2026-08-14 |
| 858 | `tests/integration/operation-queue-lifecycle.test.js` | 473 | lido (3 achados) | 2026-08-14 |
| 859 | `tests/integration/permission-guarded-operations.test.js` | 228 | lido (2 achados) | 2026-08-14 |
| 860 | `tests/integration/presence-awareness-no-mock-seam.test.js` | 272 | sem alteracao | 2026-08-14 |
| 861 | `tests/integration/presence-bridge.test.js` | 456 | sem alteracao | 2026-08-14 |
| 862 | `tests/integration/presence-store.test.js` | 564 | sem alteracao | 2026-08-14 |
| 863 | `tests/integration/queue-poison-invariant.test.js` | 163 | sem alteracao | 2026-08-14 |
| 864 | `tests/integration/remote-app-state-setting.test.js` | 111 | sem alteracao | 2026-08-14 |
| 865 | `tests/integration/remote-cursors-layer.test.js` | 289 | sem alteracao | 2026-08-14 |
| 866 | `tests/integration/remote-map-op.test.js` | 74 | sem alteracao | 2026-08-14 |
| 867 | `tests/integration/remote-operation-handler.test.js` | 1321 | sem alteracao | 2026-08-14 |
| 868 | `tests/integration/remote-setting-op.test.js` | 55 | sem alteracao | 2026-08-14 |
| 869 | `tests/integration/rename-map-manager-guard.repro.test.js` | 104 | criado nesta auditoria | 2026-08-14 |
| 870 | `tests/integration/repository-active-map.test.js` | 284 | sem alteracao | 2026-08-14 |
| 871 | `tests/integration/repository-contract.test.js` | 360 | lido (1 achado) | 2026-08-14 |
| 872 | `tests/integration/runtime-config.test.js` | 123 | lido (1 achado) | 2026-08-14 |
| 873 | `tests/integration/settings-image-fallback.test.js` | 68 | lido (1 achado) | 2026-08-14 |
| 874 | `tests/integration/settings-operations-real.test.js` | 248 | lido (1 achado) | 2026-08-14 |
| 875 | `tests/integration/store-transaction.test.js` | 392 | sem alteracao | 2026-08-14 |
| 876 | `tests/integration/sv360-admin-org-scope.repro.test.js` | 91 | criado nesta auditoria | 2026-08-14 |
| 877 | `tests/integration/sync-app-state-emit.test.js` | 111 | lido (1 achado) | 2026-08-14 |
| 878 | `tests/integration/sync-engine.test.js` | 810 | lido (4 achados) | 2026-08-14 |
| 879 | `tests/integration/sync-flush.test.js` | 248 | sem alteracao | 2026-08-14 |
| 880 | `tests/integration/sync-metadata-lifecycle.test.js` | 376 | lido (3 achados) | 2026-08-14 |
| 881 | `tests/integration/sync-nonuuid-mapid-guard.repro.test.js` | 74 | sem alteracao | 2026-08-14 |
| 882 | `tests/integration/sync-scheduler.test.js` | 153 | lido (1 achado) | 2026-08-14 |
| 883 | `tests/integration/temporal-operations-real.test.js` | 246 | sem alteracao | 2026-08-14 |
| 884 | `tests/integration/temporal-sync-op.test.js` | 158 | lido (2 achados) | 2026-08-14 |
| 885 | `tests/integration/undo-redo-sync.test.js` | 234 | lido (2 achados) | 2026-08-14 |
| 886 | `tests/integration/ws-client.test.js` | 393 | lido (1 achado) | 2026-08-14 |
| 887 | `tests/store/briefing-operations.test.js` | 875 | lido (2 achados) | 2026-08-14 |
| 888 | `tests/store/catalog-operations.test.js` | 750 | lido (1 achado) | 2026-08-14 |
| 889 | `tests/store/cesium3d-operations.test.js` | 1206 | lido (3 achados) | 2026-08-14 |
| 890 | `tests/store/comment-operations.test.js` | 141 | lido (2 achados) | 2026-08-14 |
| 891 | `tests/store/cross-map-transfer.test.js` | 634 | lido (1 achado) | 2026-08-14 |
| 892 | `tests/store/feature-operations.test.js` | 1118 | lido (1 achado) | 2026-08-14 |
| 893 | `tests/store/group-manager-sync-mapid.test.js` | 99 | sem alteracao | 2026-08-14 |
| 894 | `tests/store/group-operations.test.js` | 255 | sem alteracao | 2026-08-14 |
| 895 | `tests/store/layer-operations.test.js` | 463 | lido (1 achado) | 2026-08-14 |
| 896 | `tests/store/map-duplication.test.js` | 258 | lido (1 achado) | 2026-08-14 |
| 897 | `tests/store/map-operations.test.js` | 952 | lido (4 achados) | 2026-08-14 |
| 898 | `tests/store/map-resolver.test.js` | 255 | lido (1 achado) | 2026-08-14 |
| 899 | `tests/store/move-features-layer.test.js` | 390 | sem alteracao | 2026-08-14 |
| 900 | `tests/store/move-features-map.test.js` | 626 | lido (2 achados) | 2026-08-14 |
| 901 | `tests/store/peer-map-name-resolution.repro.test.js` | 68 | sem alteracao | 2026-08-14 |
| 902 | `tests/store/rename-map-refusal-signal.repro.test.js` | 167 | criado nesta auditoria | 2026-08-14 |
| 903 | `tests/store/store-origin.test.js` | 58 | lido (1 achado) | 2026-08-14 |
| 904 | `tests/store/store-schema-migration.test.js` | 718 | lido (2 achados) | 2026-08-14 |
| 905 | `tests/store/streetview360-operations.test.js` | 1109 | lido (5 achados) | 2026-08-14 |
| 906 | `tests/store/undo-redo.test.js` | 764 | lido (4 achados) | 2026-08-14 |
| 907 | `tests/unit/api-client-error-contract.test.js` | 221 | criado nesta auditoria | 2026-08-14 |
| 908 | `tests/unit/atlas-drive-permission-chips.test.js` | 49 | criado nesta auditoria | 2026-08-14 |
| 909 | `tests/unit/atlas-link.test.js` | 97 | lido (1 achado) | 2026-08-14 |
| 910 | `tests/unit/atlas-settings-overlay.test.js` | 112 | sem alteracao | 2026-08-14 |
| 911 | `tests/unit/auth-persistence.test.js` | 79 | lido (1 achado) | 2026-08-14 |
| 912 | `tests/unit/azimuth-distance-geometry.test.js` | 228 | sem alteracao | 2026-08-14 |
| 913 | `tests/unit/azimuth-distance-panel-style.test.js` | 129 | criado nesta auditoria | 2026-08-14 |
| 914 | `tests/unit/baselayer-style-uniqueness.repro.test.js` | 83 | sem alteracao | 2026-08-14 |
| 915 | `tests/unit/bottom-controls-terrain-gate.test.js` | 58 | sem alteracao | 2026-08-14 |
| 916 | `tests/unit/boundary-geometry.test.js` | 281 | sem alteracao | 2026-08-14 |
| 917 | `tests/unit/brazilian-sidc.test.js` | 110 | sem alteracao | 2026-08-14 |
| 918 | `tests/unit/briefing-transition-destroy.test.js` | 143 | criado nesta auditoria | 2026-08-14 |
| 919 | `tests/unit/calibracao-api.test.js` | 252 | sem alteracao | 2026-08-14 |
| 920 | `tests/unit/calibracao-descricao-alvo.test.js` | 467 | sem alteracao | 2026-08-14 |
| 921 | `tests/unit/calibracao-escape-e-repeticao.test.js` | 174 | criado nesta auditoria | 2026-08-14 |
| 922 | `tests/unit/calibracao-espelha-marcador-andar.test.js` | 369 | sem alteracao | 2026-08-14 |
| 923 | `tests/unit/calibracao-pagina.test.js` | 271 | sem alteracao | 2026-08-14 |
| 924 | `tests/unit/catalog-sort.test.js` | 83 | sem alteracao | 2026-08-14 |
| 925 | `tests/unit/circle-geometry.test.js` | 333 | lido (1 achado) | 2026-08-14 |
| 926 | `tests/unit/circle-line-style-tracking.test.js` | 73 | criado nesta auditoria | 2026-08-14 |
| 927 | `tests/unit/connection-state.test.js` | 172 | sem alteracao | 2026-08-14 |
| 928 | `tests/unit/coordinate-converter.test.js` | 138 | sem alteracao | 2026-08-14 |
| 929 | `tests/unit/coordination-points-options.test.js` | 78 | criado nesta auditoria | 2026-08-14 |
| 930 | `tests/unit/csv-escape.test.js` | 89 | criado nesta auditoria | 2026-08-14 |
| 931 | `tests/unit/csv-import.test.js` | 701 | sem alteracao | 2026-08-14 |
| 932 | `tests/unit/custom-point-icons.test.js` | 97 | sem alteracao | 2026-08-14 |
| 933 | `tests/unit/declination-svg-generator.test.js` | 33 | sem alteracao | 2026-08-14 |
| 934 | `tests/unit/deep-link-wait-for.test.js` | 95 | sem alteracao | 2026-08-14 |
| 935 | `tests/unit/deep-utils.test.js` | 243 | sem alteracao | 2026-08-14 |
| 936 | `tests/unit/docs-integridade.test.js` | 362 | lido (1 achado) | 2026-08-14 |
| 937 | `tests/unit/ellipse-geometry.test.js` | 375 | sem alteracao | 2026-08-14 |
| 938 | `tests/unit/ellipse-line-style-tracking.test.js` | 75 | criado nesta auditoria | 2026-08-14 |
| 939 | `tests/unit/event-bridges.test.js` | 174 | lido (1 achado) | 2026-08-14 |
| 940 | `tests/unit/event-emitter-onany.test.js` | 62 | sem alteracao | 2026-08-14 |
| 941 | `tests/unit/export-import-service.test.js` | 183 | sem alteracao | 2026-08-14 |
| 942 | `tests/unit/feature-organizer.test.js` | 135 | criado nesta auditoria | 2026-08-14 |
| 943 | `tests/unit/floor-selector-360.test.js` | 70 | sem alteracao | 2026-08-14 |
| 944 | `tests/unit/geometry-utils.test.js` | 327 | sem alteracao | 2026-08-14 |
| 945 | `tests/unit/html-escape.test.js` | 96 | criado nesta auditoria | 2026-08-14 |
| 946 | `tests/unit/idle-timer.test.js` | 99 | sem alteracao | 2026-08-14 |
| 947 | `tests/unit/image-utils.test.js` | 55 | sem alteracao | 2026-08-14 |
| 948 | `tests/unit/image-zoom-correction-dirty.test.js` | 109 | criado nesta auditoria | 2026-08-14 |
| 949 | `tests/unit/import-ebgeo-name.test.js` | 44 | sem alteracao | 2026-08-14 |
| 950 | `tests/unit/import-progress-overlay.test.js` | 158 | criado nesta auditoria | 2026-08-14 |
| 951 | `tests/unit/kml-balloon.test.js` | 257 | lido (1 achado) | 2026-08-14 |
| 952 | `tests/unit/kml-document.test.js` | 192 | sem alteracao | 2026-08-14 |
| 953 | `tests/unit/kml-geometry.test.js` | 404 | sem alteracao | 2026-08-14 |
| 954 | `tests/unit/kml-style.test.js` | 255 | sem alteracao | 2026-08-14 |
| 955 | `tests/unit/kmz-feature-types.repro.test.js` | 109 | sem alteracao | 2026-08-14 |
| 956 | `tests/unit/knip-conhece-as-paginas.test.js` | 92 | criado nesta auditoria | 2026-08-14 |
| 957 | `tests/unit/ledger-chain-invariants.test.js` | 69 | sem alteracao | 2026-08-14 |
| 958 | `tests/unit/ledger-reduce.test.js` | 100 | sem alteracao | 2026-08-14 |
| 959 | `tests/unit/line-geometry.test.js` | 511 | sem alteracao | 2026-08-14 |
| 960 | `tests/unit/local-atlas-to-server.test.js` | 204 | sem alteracao | 2026-08-14 |
| 961 | `tests/unit/local-intent.test.js` | 79 | sem alteracao | 2026-08-14 |
| 962 | `tests/unit/lru-cache.test.js` | 214 | sem alteracao | 2026-08-14 |
| 963 | `tests/unit/map-badge-colors.test.js` | 49 | lido (1 achado) | 2026-08-14 |
| 964 | `tests/unit/maplibre-style-validate.test.js` | 81 | sem alteracao | 2026-08-14 |
| 965 | `tests/unit/measurement-geometry.test.js` | 339 | sem alteracao | 2026-08-14 |
| 966 | `tests/unit/meridian-convergence.test.js` | 78 | sem alteracao | 2026-08-14 |
| 967 | `tests/unit/military-symbol-generator.test.js` | 366 | sem alteracao | 2026-08-14 |
| 968 | `tests/unit/military-symbol-tracked-props.test.js` | 207 | criado nesta auditoria | 2026-08-14 |
| 969 | `tests/unit/operation-traceid.test.js` | 53 | sem alteracao | 2026-08-14 |
| 970 | `tests/unit/pdf-mosaic-geometry.test.js` | 325 | sem alteracao | 2026-08-14 |
| 971 | `tests/unit/permission-guard.test.js` | 306 | lido (2 achados) | 2026-08-14 |
| 972 | `tests/unit/permission-levels.test.js` | 137 | criado nesta auditoria | 2026-08-14 |
| 973 | `tests/unit/phone-bottom-sheet-coords.test.js` | 78 | criado nesta auditoria | 2026-08-14 |
| 974 | `tests/unit/phone-feature-type-normalization.test.js` | 86 | criado nesta auditoria | 2026-08-14 |
| 975 | `tests/unit/point-image-signature.test.js` | 63 | sem alteracao | 2026-08-14 |
| 976 | `tests/unit/polygon-geometry.test.js` | 421 | sem alteracao | 2026-08-14 |
| 977 | `tests/unit/profile-panel-lazy-gate.test.js` | 97 | criado nesta auditoria | 2026-08-14 |
| 978 | `tests/unit/rectangle-line-style-tracking.test.js` | 84 | criado nesta auditoria | 2026-08-14 |
| 979 | `tests/unit/rede-transitoria-nao-apaga-trabalho.repro.test.js` | 253 | criado nesta auditoria | 2026-08-14 |
| 980 | `tests/unit/remote-feature-render.test.js` | 120 | sem alteracao | 2026-08-14 |
| 981 | `tests/unit/remote-map-redirect.test.js` | 37 | sem alteracao | 2026-08-14 |
| 982 | `tests/unit/save-local-atlas.test.js` | 45 | sem alteracao | 2026-08-14 |
| 983 | `tests/unit/screenshot-capture-timeout.test.js` | 205 | criado nesta auditoria | 2026-08-14 |
| 984 | `tests/unit/scripts-da-raiz.test.js` | 128 | sem alteracao | 2026-08-14 |
| 985 | `tests/unit/sector-geometry.test.js` | 132 | sem alteracao | 2026-08-14 |
| 986 | `tests/unit/sector-has-feature-changed.test.js` | 152 | criado nesta auditoria | 2026-08-14 |
| 987 | `tests/unit/session-context.test.js` | 355 | sem alteracao | 2026-08-14 |
| 988 | `tests/unit/seta-andar.test.js` | 203 | sem alteracao | 2026-08-14 |
| 989 | `tests/unit/single-shot-tools-guard.test.js` | 110 | criado nesta auditoria | 2026-08-14 |
| 990 | `tests/unit/state-manager.test.js` | 897 | lido (2 achados) | 2026-08-14 |
| 991 | `tests/unit/streetview-absolute-tiles.test.js` | 77 | sem alteracao | 2026-08-14 |
| 992 | `tests/unit/streetview-direction-layout-cache.test.js` | 135 | criado nesta auditoria | 2026-08-14 |
| 993 | `tests/unit/streetview-edge-arrow-turn.test.js` | 125 | lido (1 achado) | 2026-08-14 |
| 994 | `tests/unit/streetview-horizon-marker.test.js` | 676 | lido (1 achado) | 2026-08-14 |
| 995 | `tests/unit/streetview-minimap-sync-race.test.js` | 104 | sem alteracao | 2026-08-14 |
| 996 | `tests/unit/streetview-nearest-photo.test.js` | 218 | sem alteracao | 2026-08-14 |
| 997 | `tests/unit/streetview-photo-id.repro.test.js` | 64 | sem alteracao | 2026-08-14 |
| 998 | `tests/unit/streetview-photo-route.test.js` | 88 | lido (1 achado) | 2026-08-14 |
| 999 | `tests/unit/streetview-projects-adapter.test.js` | 40 | sem alteracao | 2026-08-14 |
| 1000 | `tests/unit/style-expression.test.js` | 271 | sem alteracao | 2026-08-14 |
| 1001 | `tests/unit/sync-metadata.test.js` | 318 | lido (1 achado) | 2026-08-14 |
| 1002 | `tests/unit/syncledger-sonda-render.test.js` | 156 | criado nesta auditoria | 2026-08-14 |
| 1003 | `tests/unit/temporal-import.test.js` | 153 | sem alteracao | 2026-08-14 |
| 1004 | `tests/unit/temporal-migration.test.js` | 33 | sem alteracao | 2026-08-14 |
| 1005 | `tests/unit/temporal-model.test.js` | 448 | lido (1 achado) | 2026-08-14 |
| 1006 | `tests/unit/temporal-render-retained-source.test.js` | 210 | criado nesta auditoria | 2026-08-14 |
| 1007 | `tests/unit/temporal-utils.test.js` | 325 | sem alteracao | 2026-08-14 |
| 1008 | `tests/unit/text-background-source-patch.test.js` | 135 | criado nesta auditoria | 2026-08-14 |
| 1009 | `tests/unit/text-control-has-changed.test.js` | 95 | criado nesta auditoria | 2026-08-14 |
| 1010 | `tests/unit/text-modifiers-catalog.test.js` | 86 | criado nesta auditoria | 2026-08-14 |
| 1011 | `tests/unit/trace-core.test.js` | 69 | sem alteracao | 2026-08-14 |
| 1012 | `tests/unit/trajectory-anchor.test.js` | 89 | lido (1 achado) | 2026-08-14 |
| 1013 | `tests/unit/trajectory-edit-geometry.test.js` | 137 | sem alteracao | 2026-08-14 |
| 1014 | `tests/unit/uuid.test.js` | 129 | sem alteracao | 2026-08-14 |
| 1015 | `tests/unit/visibility-recalc-serialization.test.js` | 207 | criado nesta auditoria | 2026-08-14 |
| 1016 | `tests/unit/visibility-temporal-filter.test.js` | 66 | sem alteracao | 2026-08-14 |
| 1017 | `tests/unit/zoom-correction-helpers.test.js` | 343 | sem alteracao | 2026-08-14 |
| 1018 | `vite.config.js` | 455 | lido (5 achados) | 2026-08-14 |
| 1019 | `vitest.config.js` | 43 | lido (2 achados) | 2026-08-14 |
| 1020 | `vitest.e2e.config.js` | 48 | sem alteracao | 2026-08-14 |

Total: 1020 arquivos, 297671 linhas. Pendentes: 0.
