# Simplify Tracker - EBGeo Web

Documento para rastrear a execucao do agente `/simplify` em cada arquivo JS e CSS da aplicacao.

**Total de arquivos:** 458 JS + 31 CSS = 489 arquivos

---

## Como executar o /simplify

### Em um arquivo individual

No Claude Code, abra uma conversa e execute:

```
/simplify src/js/<caminho-do-arquivo>.js
```

O agente vai:
1. Ler o arquivo e arquivos relacionados
2. Identificar oportunidades de simplificacao (codigo duplicado, complexidade desnecessaria, padroes inconsistentes)
3. Aplicar correcoes mantendo toda a funcionalidade

### Em um modulo/pasta inteiro

Para simplificar um modulo completo com atencao as conexoes entre arquivos:

```
/simplify src/js/<nome-do-modulo>/
```

### Ordem recomendada de execucao

Executar de baixo para cima na arvore de dependencias:

1. **Fase 1 - Utilitarios e base** (sem dependencias externas ao projeto)
   - `src/js/utilities/` - helpers puros
   - `src/js/events/` - event bus e types
   - `src/js/state/` - state manager
   - `src/css/design-tokens.css` e `src/css/base.css`

2. **Fase 2 - Store (nucleo de dados)**
   - `src/js/store/` - repositorios, transacoes, operacoes
   - `src/js/store/sync/` - infraestrutura de sync
   - `src/js/store/migration/` - migracoes
   - `src/js/store/services/` - servicos internos

3. **Fase 3 - Layers e mapa**
   - `src/js/layers/` - estilos e gerenciamento de camadas
   - `src/js/map/` - map manager e animacoes
   - `src/js/baselayers/` - camadas base
   - `src/js/terrain/` - terreno e hillshade
   - `src/js/grid/` - grid UTM
   - `src/css/map-controls.css`

4. **Fase 4 - Tool manager e helpers**
   - `src/js/tool_manager/helpers/` - blocos de construcao de paineis
   - `src/js/tool_manager/managers/` - gerenciadores de selecao/perfil
   - `src/js/tool_manager/` - base_control, base_geometry, selection, clipboard
   - `src/css/attributes-panel.css`

5. **Fase 5 - Draw tools**
   - `src/js/draw_tools/point_tool/`
   - `src/js/draw_tools/line_tool/`
   - `src/js/draw_tools/polygon_tool/`
   - `src/js/draw_tools/circle_tool/`
   - `src/js/draw_tools/ellipse_tool/`
   - `src/js/draw_tools/rectangle_tool/`
   - `src/js/draw_tools/sector_tool/`
   - `src/js/draw_tools/text_tool/`
   - `src/js/draw_tools/brush_tool/`
   - `src/js/draw_tools/image_tool/`

6. **Fase 6 - Military tools**
   - `src/js/military_tools/military_symbol_tool/`
   - `src/js/military_tools/coordination_measure_tool/`
   - `src/js/military_tools/arrow_tool/`
   - `src/js/military_tools/boundary_tool/`
   - `src/js/military_tools/occupied_front_tool/`

7. **Fase 7 - Analysis tools e measurement**
   - `src/js/analysis_tools/los_tool/`
   - `src/js/analysis_tools/visibility_tool/`
   - `src/js/measurement_tool/`
   - `src/js/azimuth_distance_tool/`
   - `src/css/measurement.css`, `src/css/azimuth-distance.css`

8. **Fase 8 - UI (sidebar, toolbar, modals, search)**
   - `src/js/sidebar/` - sidebar control, tabs, components
   - `src/js/toolbar/` - toolbar control e componentes
   - `src/js/modals/` - modais
   - `src/js/search/` - busca
   - `src/js/features_tab/` - lista de features
   - `src/js/context-menu/`
   - `src/js/attribute_table/`
   - CSS correspondentes (`sidebar.css`, `toolbar-groups.css`, `modals-redesign.css`, etc.)

9. **Fase 9 - Import/Export**
   - `src/js/import_export/` - todos os formatos
   - `src/css/pdf-export.css`, `src/css/csv-import.css`

10. **Fase 10 - Modulos lazy-loaded**
    - `src/js/3d_models_viewer_tool/` - Cesium 3D
    - `src/js/street_view_tool/` - Three.js 360
    - `src/js/briefing/` - Story Map
    - `src/js/catalog/` - catalogo externo
    - `src/js/processing/` - algoritmos geoespaciais
    - CSS: `panels-3d.css`, `panels-360.css`, `briefing/*.css`, `catalog.css`, `processing.css`

11. **Fase 11 - Phone e responsivo**
    - `src/js/phone/`
    - `src/css/phone.css`, `src/css/responsive.css`

12. **Fase 12 - Entry points e config**
    - `src/js/config.js`, `src/js/config.helpers.js`, `src/js/config-loader.js`
    - `src/js/map_sig.js`
    - `src/js/index.js`
    - `src/css/style.css`

### Simplificacao inter-arquivos (conexoes)

Apos simplificar cada modulo individualmente, executar `/simplify` nos pares de modulos que tem forte acoplamento:

```
/simplify Analisar conexoes entre src/js/store/feature.operations.js e src/js/tool_manager/base_control.js
/simplify Analisar conexoes entre src/js/layers/layer.manager.js e src/js/store/layer.operations.js
/simplify Analisar conexoes entre src/js/sidebar/sidebar.control.js e src/js/state/state_manager.js
/simplify Analisar conexoes entre src/js/tool_manager/helpers/ e todos os *_attributes_panel.js
/simplify Analisar conexoes entre src/js/events/event_types.js e todos os subscribers
```

---

## Tabelas de Rastreamento

### Legenda

| Simbolo | Significado |
|---------|-------------|
| -       | Nao executado |
| OK      | Simplificado |
| N/A     | Nao necessita (barrel/index puro) |

---

### CSS (31 arquivos)

| # | Arquivo | Simplificado |
|---|---------|:------------:|
| 1 | `src/css/active-tool-chip.css` | OK |
| 2 | `src/css/attribute-table.css` | OK |
| 3 | `src/css/attributes-panel.css` | OK |
| 4 | `src/css/azimuth-distance.css` | OK |
| 5 | `src/css/base-layer-selector.css` | OK |
| 6 | `src/css/base.css` | OK |
| 7 | `src/css/bottom-controls.css` | OK |
| 8 | `src/css/briefing/briefing-editor.css` | OK |
| 9 | `src/css/briefing/briefing-pdf-export.css` | OK |
| 10 | `src/css/briefing/briefing-presentation.css` | OK |
| 11 | `src/css/catalog.css` | OK |
| 12 | `src/css/chips.css` | OK |
| 13 | `src/css/coordinates.css` | OK |
| 14 | `src/css/csv-import.css` | OK |
| 15 | `src/css/design-tokens.css` | OK |
| 16 | `src/css/feature-user-data.css` | OK |
| 17 | `src/css/features-tab.css` | OK |
| 18 | `src/css/map-controls.css` | OK |
| 19 | `src/css/measurement.css` | OK |
| 20 | `src/css/modals-redesign.css` | OK |
| 21 | `src/css/panels-2d.css` | OK |
| 22 | `src/css/panels-360.css` | OK |
| 23 | `src/css/panels-3d.css` | OK |
| 24 | `src/css/pdf-export.css` | OK |
| 25 | `src/css/phone.css` | OK |
| 26 | `src/css/processing.css` | OK |
| 27 | `src/css/responsive.css` | OK |
| 28 | `src/css/search-bar.css` | OK |
| 29 | `src/css/sidebar.css` | OK |
| 30 | `src/css/style.css` | OK |
| 31 | `src/css/toolbar-groups.css` | OK |

---

### JS - Utilities (20 arquivos)

| # | Arquivo | Simplificado |
|---|---------|:------------:|
| 1 | `src/js/utilities/coordinate_converter.js` | OK |
| 2 | `src/js/utilities/debounced-persist.js` | OK |
| 3 | `src/js/utilities/deep-utils.js` | OK |
| 4 | `src/js/utilities/event-cleanup.js` | OK |
| 5 | `src/js/utilities/feature_navigation_utils.js` | OK |
| 6 | `src/js/utilities/geomagnetic/index.js` | N/A |
| 7 | `src/js/utilities/geomagnetic/wmm_calculator.js` | OK |
| 8 | `src/js/utilities/geometry-utils.js` | OK |
| 9 | `src/js/utilities/html-escape.js` | OK |
| 10 | `src/js/utilities/id_utils.js` | OK |
| 11 | `src/js/utilities/image_utils.js` | OK |
| 12 | `src/js/utilities/index.js` | N/A |
| 13 | `src/js/utilities/logo-base64.js` | OK |
| 14 | `src/js/utilities/lru-cache.js` | OK |
| 15 | `src/js/utilities/maplibre-preload.js` | OK |
| 16 | `src/js/utilities/pointer-utils.js` | OK |
| 17 | `src/js/utilities/quill-helpers.js` | OK |
| 18 | `src/js/utilities/streetview360-state.js` | OK |
| 19 | `src/js/utilities/toast_service.js` | OK |
| 20 | `src/js/utilities/uuid.js` | OK |
| 21 | `src/js/utilities/viewer3d-state.js` | OK |

---

### JS - Events (4 arquivos)

| # | Arquivo | Simplificado |
|---|---------|:------------:|
| 1 | `src/js/events/event_bus.js` | OK |
| 2 | `src/js/events/event_emitter.js` | OK |
| 3 | `src/js/events/event_types.js` | OK |
| 4 | `src/js/events/index.js` | N/A |

---

### JS - State (2 arquivos)

| # | Arquivo | Simplificado |
|---|---------|:------------:|
| 1 | `src/js/state/index.js` | N/A |
| 2 | `src/js/state/state_manager.js` | OK |

---

### JS - Store (40 arquivos)

| # | Arquivo | Simplificado |
|---|---------|:------------:|
| 1 | `src/js/store/index.js` | N/A |
| 2 | `src/js/store/store.js` | OK |
| 3 | `src/js/store/store.constants.js` | OK |
| 4 | `src/js/store/store.types.js` | OK |
| 5 | `src/js/store/store-errors.js` | OK |
| 6 | `src/js/store/store-error-listener.js` | OK |
| 7 | `src/js/store/store-state-manager.js` | OK |
| 8 | `src/js/store/store-transaction.js` | OK |
| 9 | `src/js/store/services.js` | OK |
| 10 | `src/js/store/memory-store.js` | OK |
| 11 | `src/js/store/repository.js` | OK |
| 12 | `src/js/store/repository.utils.js` | OK |
| 13 | `src/js/store/control.registry.js` | OK |
| 14 | `src/js/store/feature.operations.js` | OK |
| 15 | `src/js/store/layer.operations.js` | OK |
| 16 | `src/js/store/group.operations.js` | OK |
| 17 | `src/js/store/map.operations.js` | OK |
| 18 | `src/js/store/briefing.operations.js` | OK |
| 19 | `src/js/store/catalog.operations.js` | OK |
| 20 | `src/js/store/cesium3d.operations.js` | OK |
| 21 | `src/js/store/streetview360.operations.js` | OK |
| 22 | `src/js/store/settings.operations.js` | OK |
| 23 | `src/js/store/undo-redo-messages.js` | OK |
| 24 | `src/js/store/atlas/atlas.entity.js` | OK |
| 25 | `src/js/store/atlas/index.js` | N/A |
| 26 | `src/js/store/repositories/index.js` | N/A |
| 27 | `src/js/store/repositories/local.repository.js` | OK |
| 28 | `src/js/store/repositories/repository.interface.js` | OK |
| 29 | `src/js/store/services/index.js` | N/A |
| 30 | `src/js/store/services/map-resolver.service.js` | OK |
| 31 | `src/js/store/migration/index.js` | N/A |
| 32 | `src/js/store/migration/migration.service.js` | OK |
| 33 | `src/js/store/migration/v1-to-v2.migration.js` | OK |
| 34 | `src/js/store/sync/index.js` | N/A |
| 35 | `src/js/store/sync/connection-state.js` | OK |
| 36 | `src/js/store/sync/event-bridges.js` | OK |
| 37 | `src/js/store/sync/operation-dispatcher.js` | OK |
| 38 | `src/js/store/sync/operation-factory.js` | OK |
| 39 | `src/js/store/sync/operation-queue.js` | OK |
| 40 | `src/js/store/sync/operation-types.js` | OK |
| 41 | `src/js/store/sync/permission-guard.js` | OK |
| 42 | `src/js/store/sync/remote-operation-handler.js` | OK |
| 43 | `src/js/store/sync/session-context.js` | OK |
| 44 | `src/js/store/sync/sync-gateway.js` | OK |
| 45 | `src/js/store/sync/sync-metadata.js` | OK |
| 46 | `src/js/store/sync/sync-scheduler.js` | OK |

---

### JS - Layers (11 arquivos)

| # | Arquivo | Simplificado |
|---|---------|:------------:|
| 1 | `src/js/layers/index.js` | N/A |
| 2 | `src/js/layers/layer.constants.js` | OK |
| 3 | `src/js/layers/layer.manager.js` | OK |
| 4 | `src/js/layers/layer_setup.js` | OK |
| 5 | `src/js/layers/visibility-filter.js` | OK |
| 6 | `src/js/layers/styles/index.js` | N/A |
| 7 | `src/js/layers/styles/auxiliary.layers.js` | OK |
| 8 | `src/js/layers/styles/content.layers.js` | OK |
| 9 | `src/js/layers/styles/line.layers.js` | OK |
| 10 | `src/js/layers/styles/point.layers.js` | OK |
| 11 | `src/js/layers/styles/polygon.layers.js` | OK |
| 12 | `src/js/layers/styles/shape.layers.js` | OK |
| 13 | `src/js/layers/styles/symbol.layers.js` | OK |
| 14 | `src/js/layers/styles/tactical.layers.js` | OK |

---

### JS - Map (4 arquivos)

| # | Arquivo | Simplificado |
|---|---------|:------------:|
| 1 | `src/js/map/index.js` | N/A |
| 2 | `src/js/map/animation.service.js` | OK |
| 3 | `src/js/map/drag-rotate.handler.js` | OK |
| 4 | `src/js/map/map.manager.js` | OK |

---

### JS - Baselayers (6 arquivos)

| # | Arquivo | Simplificado |
|---|---------|:------------:|
| 1 | `src/js/baselayers/index.js` | N/A |
| 2 | `src/js/baselayers/base-layer.control.js` | OK |
| 3 | `src/js/baselayers/bdgex_layer.js` | OK |
| 4 | `src/js/baselayers/carta_ortoimagem.js` | OK |
| 5 | `src/js/baselayers/carta_topografica.js` | OK |
| 6 | `src/js/baselayers/imagens_layer.js` | OK |
| 7 | `src/js/baselayers/osm_layer.js` | OK |

---

### JS - Terrain (4 arquivos)

| # | Arquivo | Simplificado |
|---|---------|:------------:|
| 1 | `src/js/terrain/index.js` | N/A |
| 2 | `src/js/terrain/analysis-layers.manager.js` | OK |
| 3 | `src/js/terrain/data-layers.manager.js` | OK |
| 4 | `src/js/terrain/terrain.control.js` | OK |

---

### JS - Grid (3 arquivos)

| # | Arquivo | Simplificado |
|---|---------|:------------:|
| 1 | `src/js/grid/index.js` | N/A |
| 2 | `src/js/grid/grid-layers.config.js` | OK |
| 3 | `src/js/grid/grid.control.js` | OK |

---

### JS - Tool Manager (22 arquivos)

| # | Arquivo | Simplificado |
|---|---------|:------------:|
| 1 | `src/js/tool_manager/index.js` | N/A |
| 2 | `src/js/tool_manager/base_control.js` | - |
| 3 | `src/js/tool_manager/base_geometry.js` | - |
| 4 | `src/js/tool_manager/clipboard_manager.js` | - |
| 5 | `src/js/tool_manager/group_manager.js` | - |
| 6 | `src/js/tool_manager/hatch_config_modal.js` | - |
| 7 | `src/js/tool_manager/hatch_pattern_generator.js` | - |
| 8 | `src/js/tool_manager/move_handler.js` | - |
| 9 | `src/js/tool_manager/selection_manager.js` | - |
| 10 | `src/js/tool_manager/tabbed_attribute_panel.js` | - |
| 11 | `src/js/tool_manager/tool_manager.js` | - |
| 12 | `src/js/tool_manager/ui_manager.js` | - |
| 13 | `src/js/tool_manager/helpers/index.js` | N/A |
| 14 | `src/js/tool_manager/helpers/base-attributes-panel.js` | - |
| 15 | `src/js/tool_manager/helpers/buttons.helpers.js` | - |
| 16 | `src/js/tool_manager/helpers/color-picker.helpers.js` | - |
| 17 | `src/js/tool_manager/helpers/common-config.helpers.js` | - |
| 18 | `src/js/tool_manager/helpers/coordinate-editor.helpers.js` | - |
| 19 | `src/js/tool_manager/helpers/feature-header.helpers.js` | - |
| 20 | `src/js/tool_manager/helpers/form-controls.helpers.js` | - |
| 21 | `src/js/tool_manager/helpers/hatch-control.helpers.js` | - |
| 22 | `src/js/tool_manager/helpers/line-style.helpers.js` | - |
| 23 | `src/js/tool_manager/helpers/section-divider.helpers.js` | - |
| 24 | `src/js/tool_manager/helpers/slider.helpers.js` | - |
| 25 | `src/js/tool_manager/helpers/text-alignment.helpers.js` | - |
| 26 | `src/js/tool_manager/managers/index.js` | N/A |
| 27 | `src/js/tool_manager/managers/profile-panel.manager.js` | - |
| 28 | `src/js/tool_manager/managers/selection-highlight.manager.js` | - |

---

### JS - Draw Tools (39 arquivos)

| # | Arquivo | Simplificado |
|---|---------|:------------:|
| 1 | `src/js/draw_tools/index.js` | N/A |
| 2 | `src/js/draw_tools/drawing-touch-helpers.js` | - |
| **Point** | | |
| 3 | `src/js/draw_tools/point_tool/index.js` | N/A |
| 4 | `src/js/draw_tools/point_tool/add_point_control.js` | - |
| 5 | `src/js/draw_tools/point_tool/add_point_geometry.js` | - |
| 6 | `src/js/draw_tools/point_tool/point_attributes_panel.js` | - |
| **Line** | | |
| 7 | `src/js/draw_tools/line_tool/index.js` | N/A |
| 8 | `src/js/draw_tools/line_tool/add_line_control.js` | - |
| 9 | `src/js/draw_tools/line_tool/add_line_geometry.js` | - |
| 10 | `src/js/draw_tools/line_tool/line_attributes_panel.js` | - |
| 11 | `src/js/draw_tools/line_tool/line_measurement.js` | - |
| 12 | `src/js/draw_tools/line_tool/line_profile.js` | - |
| 13 | `src/js/draw_tools/line_tool/line-split.js` | - |
| **Polygon** | | |
| 14 | `src/js/draw_tools/polygon_tool/index.js` | N/A |
| 15 | `src/js/draw_tools/polygon_tool/add_polygon_control.js` | - |
| 16 | `src/js/draw_tools/polygon_tool/add_polygon_geometry.js` | - |
| 17 | `src/js/draw_tools/polygon_tool/polygon_attributes_panel.js` | - |
| **Circle** | | |
| 18 | `src/js/draw_tools/circle_tool/index.js` | N/A |
| 19 | `src/js/draw_tools/circle_tool/add_circle_control.js` | - |
| 20 | `src/js/draw_tools/circle_tool/add_circle_geometry.js` | - |
| 21 | `src/js/draw_tools/circle_tool/circle_attributes_panel.js` | - |
| **Ellipse** | | |
| 22 | `src/js/draw_tools/ellipse_tool/index.js` | N/A |
| 23 | `src/js/draw_tools/ellipse_tool/add_ellipse_control.js` | - |
| 24 | `src/js/draw_tools/ellipse_tool/add_ellipse_geometry.js` | - |
| 25 | `src/js/draw_tools/ellipse_tool/ellipse_attributes_panel.js` | - |
| **Rectangle** | | |
| 26 | `src/js/draw_tools/rectangle_tool/index.js` | N/A |
| 27 | `src/js/draw_tools/rectangle_tool/add_rectangle_control.js` | - |
| 28 | `src/js/draw_tools/rectangle_tool/add_rectangle_geometry.js` | - |
| 29 | `src/js/draw_tools/rectangle_tool/rectangle_attributes_panel.js` | - |
| **Sector** | | |
| 30 | `src/js/draw_tools/sector_tool/index.js` | N/A |
| 31 | `src/js/draw_tools/sector_tool/add_sector_control.js` | - |
| 32 | `src/js/draw_tools/sector_tool/add_sector_geometry.js` | - |
| 33 | `src/js/draw_tools/sector_tool/sector_attributes_panel.js` | - |
| **Text** | | |
| 34 | `src/js/draw_tools/text_tool/index.js` | N/A |
| 35 | `src/js/draw_tools/text_tool/add_text_control.js` | - |
| 36 | `src/js/draw_tools/text_tool/add_text_geometry.js` | - |
| 37 | `src/js/draw_tools/text_tool/text_attributes_panel.js` | - |
| **Brush** | | |
| 38 | `src/js/draw_tools/brush_tool/index.js` | N/A |
| 39 | `src/js/draw_tools/brush_tool/add_brush_control.js` | - |
| 40 | `src/js/draw_tools/brush_tool/add_brush_geometry.js` | - |
| 41 | `src/js/draw_tools/brush_tool/brush_attributes_panel.js` | - |
| **Image** | | |
| 42 | `src/js/draw_tools/image_tool/index.js` | N/A |
| 43 | `src/js/draw_tools/image_tool/add_image_control.js` | - |
| 44 | `src/js/draw_tools/image_tool/add_image_geometry.js` | - |
| 45 | `src/js/draw_tools/image_tool/image_attributes_panel.js` | - |

---

### JS - Military Tools (35 arquivos)

| # | Arquivo | Simplificado |
|---|---------|:------------:|
| 1 | `src/js/military_tools/index.js` | N/A |
| **Military Symbol** | | |
| 2 | `src/js/military_tools/military_symbol_tool/index.js` | N/A |
| 3 | `src/js/military_tools/military_symbol_tool/add_military_symbol_control.js` | - |
| 4 | `src/js/military_tools/military_symbol_tool/add_military_symbol_geometry.js` | - |
| 5 | `src/js/military_tools/military_symbol_tool/military_symbol_generator.js` | - |
| 6 | `src/js/military_tools/military_symbol_tool/military_constants.js` | - |
| 7 | `src/js/military_tools/military_symbol_tool/text_modifiers_catalog.js` | - |
| 8 | `src/js/military_tools/military_symbol_tool/brazilian_extension_catalog.js` | - |
| 9 | `src/js/military_tools/military_symbol_tool/brazilian_sidc_extension.js` | - |
| 10 | `src/js/military_tools/military_symbol_tool/brazilian_svg_postprocessing.js` | - |
| 11 | `src/js/military_tools/military_symbol_tool/attributes/index.js` | N/A |
| 12 | `src/js/military_tools/military_symbol_tool/attributes/military_symbol_attributes_panel.js` | - |
| 13 | `src/js/military_tools/military_symbol_tool/attributes/symbol-form.section.js` | - |
| 14 | `src/js/military_tools/military_symbol_tool/attributes/symbol-gallery.section.js` | - |
| 15 | `src/js/military_tools/military_symbol_tool/attributes/symbol-selector.modal.js` | - |
| 16 | `src/js/military_tools/military_symbol_tool/attributes/text-modifiers.section.js` | - |
| 17 | `src/js/military_tools/military_symbol_tool/attributes/engagement-bar.section.js` | - |
| 18 | `src/js/military_tools/military_symbol_tool/attributes/ui-components.helpers.js` | - |
| **Data catalogos** | | |
| 19 | `src/js/military_tools/military_symbol_tool/data/aeronaves.js` | - |
| 20 | `src/js/military_tools/military_symbol_tool/data/atividades_eventos.js` | - |
| 21 | `src/js/military_tools/military_symbol_tool/data/equipamentos_viaturas.js` | - |
| 22 | `src/js/military_tools/military_symbol_tool/data/espaciais.js` | - |
| 23 | `src/js/military_tools/military_symbol_tool/data/guerra_minas.js` | - |
| 24 | `src/js/military_tools/military_symbol_tool/data/individuos_desembarcados.js` | - |
| 25 | `src/js/military_tools/military_symbol_tool/data/instalacoes.js` | - |
| 26 | `src/js/military_tools/military_symbol_tool/data/maritimos_superficie.js` | - |
| 27 | `src/js/military_tools/military_symbol_tool/data/misseis.js` | - |
| 28 | `src/js/military_tools/military_symbol_tool/data/submarinos.js` | - |
| 29 | `src/js/military_tools/military_symbol_tool/data/unidades.js` | - |
| **Coordination Measure** | | |
| 30 | `src/js/military_tools/coordination_measure_tool/index.js` | N/A |
| 31 | `src/js/military_tools/coordination_measure_tool/add_coordination_measure_control.js` | - |
| 32 | `src/js/military_tools/coordination_measure_tool/add_coordination_measure_geometry.js` | - |
| 33 | `src/js/military_tools/coordination_measure_tool/coordination_measure_constants.js` | - |
| 34 | `src/js/military_tools/coordination_measure_tool/coordination_measure_generator.js` | - |
| 35 | `src/js/military_tools/coordination_measure_tool/coordination_points_catalog.js` | - |
| 36 | `src/js/military_tools/coordination_measure_tool/attributes/index.js` | N/A |
| 37 | `src/js/military_tools/coordination_measure_tool/attributes/coordination_measure_attributes_panel.js` | - |
| 38 | `src/js/military_tools/coordination_measure_tool/attributes/color-control.section.js` | - |
| 39 | `src/js/military_tools/coordination_measure_tool/attributes/point-selector.modal.js` | - |
| 40 | `src/js/military_tools/coordination_measure_tool/attributes/text-modifiers.section.js` | - |
| 41 | `src/js/military_tools/coordination_measure_tool/attributes/ui-components.helpers.js` | - |
| **Arrow** | | |
| 42 | `src/js/military_tools/arrow_tool/index.js` | N/A |
| 43 | `src/js/military_tools/arrow_tool/add_arrow_control.js` | - |
| 44 | `src/js/military_tools/arrow_tool/add_arrow_geometry.js` | - |
| 45 | `src/js/military_tools/arrow_tool/arrow_attributes_panel.js` | - |
| 46 | `src/js/military_tools/arrow_tool/arrow-merge.js` | - |
| **Boundary** | | |
| 47 | `src/js/military_tools/boundary_tool/index.js` | N/A |
| 48 | `src/js/military_tools/boundary_tool/add_boundary_control.js` | - |
| 49 | `src/js/military_tools/boundary_tool/add_boundary_geometry.js` | - |
| 50 | `src/js/military_tools/boundary_tool/boundary_attributes_panel.js` | - |
| **Occupied Front** | | |
| 51 | `src/js/military_tools/occupied_front_tool/index.js` | N/A |
| 52 | `src/js/military_tools/occupied_front_tool/add_occupied_front_control.js` | - |
| 53 | `src/js/military_tools/occupied_front_tool/add_occupied_front_geometry.js` | - |
| 54 | `src/js/military_tools/occupied_front_tool/occupied_front_attributes_panel.js` | - |

---

### JS - Analysis Tools (9 arquivos)

| # | Arquivo | Simplificado |
|---|---------|:------------:|
| 1 | `src/js/analysis_tools/index.js` | N/A |
| **LOS** | | |
| 2 | `src/js/analysis_tools/los_tool/index.js` | N/A |
| 3 | `src/js/analysis_tools/los_tool/add_los_control.js` | - |
| 4 | `src/js/analysis_tools/los_tool/add_los_geometry.js` | - |
| 5 | `src/js/analysis_tools/los_tool/los_attributes_panel.js` | - |
| **Visibility** | | |
| 6 | `src/js/analysis_tools/visibility_tool/index.js` | N/A |
| 7 | `src/js/analysis_tools/visibility_tool/add_visibility_control.js` | - |
| 8 | `src/js/analysis_tools/visibility_tool/add_visibility_geometry.js` | - |
| 9 | `src/js/analysis_tools/visibility_tool/visibility_attributes_panel.js` | - |

---

### JS - Measurement Tool (7 arquivos)

| # | Arquivo | Simplificado |
|---|---------|:------------:|
| 1 | `src/js/measurement_tool/index.js` | N/A |
| 2 | `src/js/measurement_tool/measurement.constants.js` | - |
| 3 | `src/js/measurement_tool/measurement-angle.control.js` | - |
| 4 | `src/js/measurement_tool/measurement-area.control.js` | - |
| 5 | `src/js/measurement_tool/measurement-distance.control.js` | - |
| 6 | `src/js/measurement_tool/measurement-geometry.js` | - |
| 7 | `src/js/measurement_tool/measurement-labels.js` | - |
| 8 | `src/js/measurement_tool/measurement-results-panel.js` | - |

---

### JS - Azimuth Distance Tool (11 arquivos)

| # | Arquivo | Simplificado |
|---|---------|:------------:|
| 1 | `src/js/azimuth_distance_tool/index.js` | N/A |
| 2 | `src/js/azimuth_distance_tool/add_azimuth_distance_control.js` | - |
| 3 | `src/js/azimuth_distance_tool/azimuth_distance_attributes_panel.js` | - |
| 4 | `src/js/azimuth_distance_tool/azimuth_distance_constants.js` | - |
| 5 | `src/js/azimuth_distance_tool/azimuth_distance_geometry.js` | - |
| 6 | `src/js/azimuth_distance_tool/azimuth_distance_panel.js` | - |
| 7 | `src/js/azimuth_distance_tool/components/index.js` | N/A |
| 8 | `src/js/azimuth_distance_tool/components/compass-rose.component.js` | - |
| 9 | `src/js/azimuth_distance_tool/components/geometry-preview.component.js` | - |
| 10 | `src/js/azimuth_distance_tool/components/leg-row.component.js` | - |
| 11 | `src/js/azimuth_distance_tool/components/reference-point.component.js` | - |

---

### JS - Sidebar (22 arquivos)

| # | Arquivo | Simplificado |
|---|---------|:------------:|
| 1 | `src/js/sidebar/index.js` | N/A |
| 2 | `src/js/sidebar/sidebar.constants.js` | - |
| 3 | `src/js/sidebar/sidebar.control.js` | - |
| **Components** | | |
| 4 | `src/js/sidebar/components/chips.component.js` | - |
| 5 | `src/js/sidebar/components/feature-identification.js` | - |
| 6 | `src/js/sidebar/components/feature-location-section.js` | - |
| 7 | `src/js/sidebar/components/feature-panel.js` | - |
| 8 | `src/js/sidebar/components/feature-photo-gallery.js` | - |
| 9 | `src/js/sidebar/components/feature-tabs.js` | - |
| 10 | `src/js/sidebar/components/group-type-selector.js` | - |
| 11 | `src/js/sidebar/components/multi-selection-actions.js` | - |
| 12 | `src/js/sidebar/components/sidebar-collapsed.js` | - |
| 13 | `src/js/sidebar/components/sidebar-panel.js` | - |
| **Handlers** | | |
| 14 | `src/js/sidebar/handlers/index.js` | N/A |
| 15 | `src/js/sidebar/handlers/feature-3d-handlers.js` | - |
| **Panels** | | |
| 16 | `src/js/sidebar/panels/index.js` | N/A |
| 17 | `src/js/sidebar/panels/feature-panel-content.js` | - |
| 18 | `src/js/sidebar/panels/notes-panel.js` | - |
| 19 | `src/js/sidebar/panels/vector-info-panel.js` | - |
| **Tabs** | | |
| 20 | `src/js/sidebar/tabs/briefings.tab.js` | - |
| 21 | `src/js/sidebar/tabs/export.tab.js` | - |
| 22 | `src/js/sidebar/tabs/import.tab.js` | - |
| 23 | `src/js/sidebar/tabs/layers.tab.js` | - |
| 24 | `src/js/sidebar/tabs/maps.tab.js` | - |

---

### JS - Toolbar (6 arquivos)

| # | Arquivo | Simplificado |
|---|---------|:------------:|
| 1 | `src/js/toolbar/index.js` | N/A |
| 2 | `src/js/toolbar/toolbar.constants.js` | - |
| 3 | `src/js/toolbar/toolbar.control.js` | - |
| 4 | `src/js/toolbar/components/active-tool-chip.js` | - |
| 5 | `src/js/toolbar/components/tool-button.js` | - |
| 6 | `src/js/toolbar/components/toolbar-group.js` | - |

---

### JS - Modals (9 arquivos)

| # | Arquivo | Simplificado |
|---|---------|:------------:|
| 1 | `src/js/modals/index.js` | N/A |
| 2 | `src/js/modals/modal.base.js` | - |
| 3 | `src/js/modals/combine-maps.modal.js` | - |
| 4 | `src/js/modals/confirm.modal.js` | - |
| 5 | `src/js/modals/coordinate-edit.modal.js` | - |
| 6 | `src/js/modals/export.modal.js` | - |
| 7 | `src/js/modals/info.modal.js` | - |
| 8 | `src/js/modals/prompt.modal.js` | - |
| 9 | `src/js/modals/settings.modal.js` | - |
| 10 | `src/js/modals/shortcuts.modal.js` | - |

---

### JS - Search (6 arquivos)

| # | Arquivo | Simplificado |
|---|---------|:------------:|
| 1 | `src/js/search/index.js` | N/A |
| 2 | `src/js/search/feature-search.control.js` | - |
| 3 | `src/js/search/search-bar.component.js` | - |
| 4 | `src/js/search/search-bar.icons.js` | - |
| 5 | `src/js/search/search-bar.search-providers.js` | - |
| 6 | `src/js/search/search-bar.sidepanel-content.js` | - |

---

### JS - Features Tab (12 arquivos)

| # | Arquivo | Simplificado |
|---|---------|:------------:|
| 1 | `src/js/features_tab/index.js` | N/A |
| 2 | `src/js/features_tab/features_tab.js` | - |
| 3 | `src/js/features_tab/features_tab.constants.js` | - |
| 4 | `src/js/features_tab/features_tab.icons.js` | - |
| 5 | `src/js/features_tab/analysis-layers.component.js` | - |
| 6 | `src/js/features_tab/catalog-layers.component.js` | - |
| 7 | `src/js/features_tab/collapse-state.manager.js` | - |
| 8 | `src/js/features_tab/feature-item.component.js` | - |
| 9 | `src/js/features_tab/feature-organizer.service.js` | - |
| 10 | `src/js/features_tab/group-item.component.js` | - |
| 11 | `src/js/features_tab/layer-container.builder.js` | - |
| 12 | `src/js/features_tab/layer-list.component.js` | - |
| 13 | `src/js/features_tab/models3d-section.component.js` | - |
| 14 | `src/js/features_tab/sortable.handler.js` | - |
| 15 | `src/js/features_tab/streetview360-section.component.js` | - |

---

### JS - Attribute Table (9 arquivos)

| # | Arquivo | Simplificado |
|---|---------|:------------:|
| 1 | `src/js/attribute_table/index.js` | N/A |
| 2 | `src/js/attribute_table/attribute-table.constants.js` | - |
| 3 | `src/js/attribute_table/attribute-table.control.js` | - |
| 4 | `src/js/attribute_table/components/index.js` | N/A |
| 5 | `src/js/attribute_table/components/column-context-menu.js` | - |
| 6 | `src/js/attribute_table/components/table-filters.js` | - |
| 7 | `src/js/attribute_table/components/table-panel.js` | - |
| 8 | `src/js/attribute_table/components/table-renderer.js` | - |
| 9 | `src/js/attribute_table/services/index.js` | N/A |
| 10 | `src/js/attribute_table/services/table-config.service.js` | - |
| 11 | `src/js/attribute_table/services/table-data.service.js` | - |

---

### JS - Context Menu (2 arquivos)

| # | Arquivo | Simplificado |
|---|---------|:------------:|
| 1 | `src/js/context-menu/index.js` | N/A |
| 2 | `src/js/context-menu/context-menu.control.js` | - |

---

### JS - Import/Export (12 arquivos)

| # | Arquivo | Simplificado |
|---|---------|:------------:|
| 1 | `src/js/import_export/index.js` | N/A |
| 2 | `src/js/import_export/drag-drop.handler.js` | - |
| 3 | `src/js/import_export/export-import.service.js` | - |
| 4 | `src/js/import_export/export-utils.js` | - |
| 5 | `src/js/import_export/garmin-kmz-export.js` | - |
| 6 | `src/js/import_export/import.control.js` | - |
| 7 | `src/js/import_export/pdf-cartographic-elements.js` | - |
| 8 | `src/js/import_export/pdf-export.tab.js` | - |
| 9 | `src/js/import_export/screenshot.control.js` | - |
| 10 | `src/js/import_export/csv/index.js` | N/A |
| 11 | `src/js/import_export/csv/csv-config-panel.js` | - |
| 12 | `src/js/import_export/csv/csv-coordinate-converter.js` | - |
| 13 | `src/js/import_export/csv/csv-parser.js` | - |
| 14 | `src/js/import_export/csv/csv-to-geojson.js` | - |

---

### JS - 3D Models Viewer (14 arquivos)

| # | Arquivo | Simplificado |
|---|---------|:------------:|
| 1 | `src/js/3d_models_viewer_tool/index.js` | N/A |
| 2 | `src/js/3d_models_viewer_tool/add_3d_models_viewer_control.js` | - |
| 3 | `src/js/3d_models_viewer_tool/map_3d.js` | - |
| 4 | `src/js/3d_models_viewer_tool/components/marker-panel-3d.js` | - |
| 5 | `src/js/3d_models_viewer_tool/components/measurement-panel-3d.js` | - |
| 6 | `src/js/3d_models_viewer_tool/components/viewshed-panel-3d.js` | - |
| 7 | `src/js/3d_models_viewer_tool/services/index.js` | N/A |
| 8 | `src/js/3d_models_viewer_tool/services/cesium-compat.js` | - |
| 9 | `src/js/3d_models_viewer_tool/services/keyboard-service-3d.js` | - |
| 10 | `src/js/3d_models_viewer_tool/tools/index.js` | N/A |
| 11 | `src/js/3d_models_viewer_tool/tools/marker_tool_3d.js` | - |
| 12 | `src/js/3d_models_viewer_tool/tools/measurement_tool_3d.js` | - |
| 13 | `src/js/3d_models_viewer_tool/tools/mouse_coordinates_3d.js` | - |
| 14 | `src/js/3d_models_viewer_tool/tools/screenshot_tool.js` | - |
| 15 | `src/js/3d_models_viewer_tool/tools/viewshed.js` | - |
| 16 | `src/js/3d_models_viewer_tool/tools/viewshed_tool_3d.js` | - |

---

### JS - Street View 360 (16 arquivos)

| # | Arquivo | Simplificado |
|---|---------|:------------:|
| 1 | `src/js/street_view_tool/index.js` | N/A |
| 2 | `src/js/street_view_tool/add_street_view_control.js` | - |
| 3 | `src/js/street_view_tool/street_view_viewer.js` | - |
| 4 | `src/js/street_view_tool/streetview-api.service.js` | - |
| 5 | `src/js/street_view_tool/streetview_markers.js` | - |
| 6 | `src/js/street_view_tool/saved_photos_markers.js` | - |
| 7 | `src/js/street_view_tool/street-view-mini-map-style.js` | - |
| 8 | `src/js/street_view_tool/components/marker-panel-360.js` | - |
| 9 | `src/js/street_view_tool/components/streetview-sidebar.js` | - |
| 10 | `src/js/street_view_tool/services/keyboard_service_360.js` | - |
| 11 | `src/js/street_view_tool/tools/marker_tool_360.js` | - |
| 12 | `src/js/street_view_tool/tools/screenshot_tool_360.js` | - |
| 13 | `src/js/street_view_tool/navigation/index.js` | N/A |
| 14 | `src/js/street_view_tool/navigation/constants.js` | - |
| 15 | `src/js/street_view_tool/navigation/hit-tester.js` | - |
| 16 | `src/js/street_view_tool/navigation/minimap-sync.js` | - |
| 17 | `src/js/street_view_tool/navigation/navigator.js` | - |
| 18 | `src/js/street_view_tool/navigation/projector.js` | - |
| 19 | `src/js/street_view_tool/navigation/renderer.js` | - |

---

### JS - Briefing (10 arquivos)

| # | Arquivo | Simplificado |
|---|---------|:------------:|
| 1 | `src/js/briefing/index.js` | N/A |
| 2 | `src/js/briefing/editor/briefing-editor.control.js` | - |
| 3 | `src/js/briefing/presentation/briefing-presenter.control.js` | - |
| 4 | `src/js/briefing/presentation/tile-preloader.js` | - |
| 5 | `src/js/briefing/presentation/transition.service.js` | - |
| 6 | `src/js/briefing/components/presentation-controls.js` | - |
| 7 | `src/js/briefing/components/presentation-text-panel.js` | - |
| 8 | `src/js/briefing/services/keyboard-service-briefing.js` | - |
| 9 | `src/js/briefing/validation/reference-validator.js` | - |
| 10 | `src/js/briefing/export/briefing-pdf-export.js` | - |
| 11 | `src/js/briefing/export/pdf-page-composer.js` | - |
| 12 | `src/js/briefing/export/slide-capture.service.js` | - |

---

### JS - Catalog (8 arquivos)

| # | Arquivo | Simplificado |
|---|---------|:------------:|
| 1 | `src/js/catalog/index.js` | N/A |
| 2 | `src/js/catalog/catalog.constants.js` | - |
| 3 | `src/js/catalog/catalog.modal.js` | - |
| 4 | `src/js/catalog/catalog.service.js` | - |
| 5 | `src/js/catalog/components/index.js` | N/A |
| 6 | `src/js/catalog/components/catalog-card.js` | - |
| 7 | `src/js/catalog/components/catalog-filters.js` | - |
| 8 | `src/js/catalog/components/catalog-grid.js` | - |
| 9 | `src/js/catalog/components/catalog-header.js` | - |

---

### JS - Processing (7 arquivos)

| # | Arquivo | Simplificado |
|---|---------|:------------:|
| 1 | `src/js/processing/index.js` | N/A |
| 2 | `src/js/processing/processing.constants.js` | - |
| 3 | `src/js/processing/processing.tab.js` | - |
| 4 | `src/js/processing/processing-panel.js` | - |
| 5 | `src/js/processing/processing-runner.js` | - |
| 6 | `src/js/processing/algorithms/index.js` | N/A |
| 7 | `src/js/processing/algorithms/algorithm.interface.js` | - |
| 8 | `src/js/processing/algorithms/buffer.algorithm.js` | - |
| 9 | `src/js/processing/algorithms/convex-hull.algorithm.js` | - |
| 10 | `src/js/processing/algorithms/voronoi.algorithm.js` | - |

---

### JS - Phone (8 arquivos)

| # | Arquivo | Simplificado |
|---|---------|:------------:|
| 1 | `src/js/phone/index.js` | N/A |
| 2 | `src/js/phone/phone-baselayer-modal.js` | - |
| 3 | `src/js/phone/phone-bottom-sheet.js` | - |
| 4 | `src/js/phone/phone-drawer.js` | - |
| 5 | `src/js/phone/phone-fabs.js` | - |
| 6 | `src/js/phone/phone-feature-editor.js` | - |
| 7 | `src/js/phone/phone-layout.js` | - |
| 8 | `src/js/phone/phone-move-actions.js` | - |
| 9 | `src/js/phone/phone-search-overlay.js` | - |

---

### JS - Outros modulos menores

| # | Arquivo | Simplificado |
|---|---------|:------------:|
| **Coordinates** | | |
| 1 | `src/js/coordinates/index.js` | N/A |
| 2 | `src/js/coordinates/mouse-coordinates.control.js` | - |
| **Keyboard** | | |
| 3 | `src/js/keyboard/index.js` | N/A |
| 4 | `src/js/keyboard/keyboard-shortcuts.js` | - |
| **Snapping** | | |
| 5 | `src/js/snapping/index.js` | N/A |
| 6 | `src/js/snapping/snapping.constants.js` | - |
| 7 | `src/js/snapping/snapping.service.js` | - |
| **Selection Tools** | | |
| 8 | `src/js/selection_tools/index.js` | N/A |
| 9 | `src/js/selection_tools/rectangle_selection_control.js` | - |
| **Vector Info** | | |
| 10 | `src/js/vector_info/index.js` | N/A |
| 11 | `src/js/vector_info/vector-info.control.js` | - |
| **Base Layer Selector** | | |
| 12 | `src/js/base-layer-selector/index.js` | N/A |
| 13 | `src/js/base-layer-selector/base-layer-selector.constants.js` | - |
| 14 | `src/js/base-layer-selector/base-layer-selector.control.js` | - |
| **Bottom Controls** | | |
| 15 | `src/js/bottom-controls/index.js` | N/A |
| 16 | `src/js/bottom-controls/bottom-controls.constants.js` | - |
| 17 | `src/js/bottom-controls/bottom-controls.control.js` | - |
| 18 | `src/js/bottom-controls/components/feature-toggle.js` | - |
| 19 | `src/js/bottom-controls/components/nav-button.js` | - |
| **UI** | | |
| 20 | `src/js/ui/index.js` | N/A |
| 21 | `src/js/ui/loading-screen-3d.js` | - |
| 22 | `src/js/ui/loading-screen.js` | - |
| 23 | `src/js/ui/ui-visibility.controller.js` | - |
| **User Data** | | |
| 24 | `src/js/user_data/index.js` | N/A |
| 25 | `src/js/user_data/attributes_tab_renderer.js` | - |
| 26 | `src/js/user_data/images_tab_renderer.js` | - |
| 27 | `src/js/user_data/user_data_manager.js` | - |
| **Mode** | | |
| 28 | `src/js/mode/index.js` | N/A |
| 29 | `src/js/mode/application-mode.manager.js` | - |
| **Deep Link** | | |
| 30 | `src/js/deep-link/deep-link.js` | - |

---

### JS - Entry Points e Config (4 arquivos)

| # | Arquivo | Simplificado |
|---|---------|:------------:|
| 1 | `src/js/index.js` | - |
| 2 | `src/js/map_sig.js` | - |
| 3 | `src/js/config.js` | - |
| 4 | `src/js/config.helpers.js` | - |
| 5 | `src/js/config-loader.js` | - |

---

## Conexoes inter-modulo para simplificar

Apos completar a simplificacao individual, executar `/simplify` nos seguintes pares/grupos de arquivos fortemente acoplados:

| # | Conexao | Arquivos envolvidos | Simplificado |
|---|---------|--------------------:|:------------:|
| 1 | Store ↔ Layer Manager | `store/layer.operations.js` + `layers/layer.manager.js` | - |
| 2 | Store ↔ Feature CRUD | `store/feature.operations.js` + `tool_manager/base_control.js` | - |
| 3 | Sidebar ↔ State | `sidebar/sidebar.control.js` + `state/state_manager.js` | - |
| 4 | Helpers ↔ Panels | `tool_manager/helpers/*` + todos `*_attributes_panel.js` | - |
| 5 | Events ↔ Subscribers | `events/event_types.js` + todos os arquivos que importam EventTypes | - |
| 6 | Base Control ↔ Tools | `tool_manager/base_control.js` + `tool_manager/base_geometry.js` + todos `add_*_control.js` | - |
| 7 | Layer Styles ↔ Constants | `layers/styles/*.js` + `layers/layer.constants.js` | - |
| 8 | Import/Export ↔ Store | `import_export/export-import.service.js` + `store/` operations | - |
| 9 | Briefing ↔ Store | `briefing/` + `store/briefing.operations.js` | - |
| 10 | 3D ↔ Store | `3d_models_viewer_tool/` + `store/cesium3d.operations.js` | - |
| 11 | 360 ↔ Store | `street_view_tool/` + `store/streetview360.operations.js` | - |
| 12 | Sidebar Tabs ↔ Store | `sidebar/tabs/*.js` + `store/map.operations.js` + `store/layer.operations.js` | - |
| 13 | Selection ↔ Features | `tool_manager/selection_manager.js` + `features_tab/features_tab.js` | - |
| 14 | Toolbar ↔ Tools | `toolbar/toolbar.control.js` + `toolbar/toolbar.constants.js` + all tool controls | - |
| 15 | PDF Export ↔ Cartographic | `import_export/pdf-export.tab.js` + `import_export/pdf-cartographic-elements.js` | - |
| 16 | Measurement tools | `measurement_tool/` (6 arquivos compartilham geometry/labels/panel) | - |
| 17 | Military Symbol System | `military_symbol_tool/` generator + catalogs + attributes | - |
| 18 | Coord Measure System | `coordination_measure_tool/` generator + catalog + attributes | - |
| 19 | Phone ↔ Desktop UI | `phone/*.js` vs equivalentes desktop (sidebar, toolbar, modals) | - |
| 20 | CSS tokens ↔ Components | `design-tokens.css` vs todos os CSS de componentes | - |

---

## Resumo de progresso

| Categoria | Total | Simplificados | Pendentes | N/A |
|-----------|------:|:-------------:|:---------:|:---:|
| CSS | 31 | 31 | 0 | 0 |
| JS - Utilities | 21 | 19 | 0 | 2 |
| JS - Events | 4 | 3 | 0 | 1 |
| JS - State | 2 | 1 | 0 | 1 |
| JS - Store | 46 | 40 | 0 | 6 |
| JS - Layers | 14 | 12 | 0 | 2 |
| JS - Map | 4 | 3 | 0 | 1 |
| JS - Baselayers | 7 | 6 | 0 | 1 |
| JS - Terrain | 4 | 3 | 0 | 1 |
| JS - Grid | 3 | 2 | 0 | 1 |
| JS - Tool Manager | 28 | 0 | 25 | 3 |
| JS - Draw Tools | 45 | 0 | 33 | 12 |
| JS - Military Tools | 54 | 0 | 44 | 10 |
| JS - Analysis Tools | 9 | 0 | 6 | 3 |
| JS - Measurement | 8 | 0 | 7 | 1 |
| JS - Azimuth Distance | 11 | 0 | 9 | 2 |
| JS - Sidebar | 24 | 0 | 21 | 3 |
| JS - Toolbar | 6 | 0 | 5 | 1 |
| JS - Modals | 10 | 0 | 9 | 1 |
| JS - Search | 6 | 0 | 5 | 1 |
| JS - Features Tab | 15 | 0 | 14 | 1 |
| JS - Attribute Table | 11 | 0 | 8 | 3 |
| JS - Context Menu | 2 | 0 | 1 | 1 |
| JS - Import/Export | 14 | 0 | 12 | 2 |
| JS - 3D Viewer | 16 | 0 | 13 | 3 |
| JS - Street View 360 | 19 | 0 | 17 | 2 |
| JS - Briefing | 12 | 0 | 11 | 1 |
| JS - Catalog | 9 | 0 | 7 | 2 |
| JS - Processing | 10 | 0 | 8 | 2 |
| JS - Phone | 9 | 0 | 8 | 1 |
| JS - Outros modulos | 30 | 0 | 17 | 13 |
| JS - Entry points | 5 | 0 | 5 | 0 |
| Conexoes inter-modulo | 20 | 0 | 20 | 0 |
| **TOTAL** | **509** | **120** | **274** | **95** |
