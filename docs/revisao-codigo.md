# Revisao de Codigo - src/js

| Arquivo | Verificado | Corrigido | Descricao do Problema | Risco de Inserir Bugs |
|---------|------------|-----------|----------------------|----------------------|
| map_sig.js | Sim | Nao | createControls() e uma god-function (~400 linhas). MoveHandler (L247), DragDropHandler (L278), DragRotateHandler (L275), ClipboardManager (L287), FeaturesTab (L337), PDFExportTab (L338), FeatureSearchControl (L244) sao instanciados sem inclusao no destroyables — potencial listener leak no beforeunload cleanup. Variavel _snappingService com prefixo _ e exportada no retorno (convencao inconsistente). | Baixo - listeners sao limpos pelo browser no unload, mas refactor de destroyables seria ideal |
| config.js | Sim | Nao | Maioria dos comentarios em portugues (deveria ser ingles). Objeto config exportado sem Object.freeze() — mutavel por qualquer modulo. Grandes blocos de codigo comentado como documentacao inline (L66-83, L96-221) deveriam ser docs separados. Falta @fileoverview JSDoc. | Baixo - e arquivo de configuracao, risco de mutacao acidental e baixo na pratica |
| config.helpers.js | Sim | Nao | initConfigHelpers() (L149-158) faz monkey-patching do objeto config anexando funcoes em runtime. validateBasemapsConfig() (L37) muta config.basemaps diretamente apesar do nome sugerir apenas validacao (efeito colateral). | Baixo - pattern intencional para backward compat, mas acopla helpers ao config object |
| url_router.js | Sim | Nao | L230 muta streetViewControl.isOpen diretamente (deveria usar setter/store). L149 referencia config.features.street_view_mock que nao existe em config.js (possivelmente dead code). Varios console.info em producao (L181, L189, L205, L220). Falta @fileoverview. | Baixo - funcionalidade de deep linking funciona corretamente, riscos sao menores |
| 3d_models_viewer_tool/add_3d_models_viewer_control.js | Sim | Nao | L10-12 usa window._markerClickConsumed como flag global mutavel (anti-pattern). L31-32 _VIDEO_POPUP_WIDTH/_HEIGHT nunca usados (dead code). L136-144 usa getEventBus().on() direto ao inves de subscribe() do event-cleanup. L546/L589 setTimeout sem trackTimer(). L837 addEventListener sem cleanup em onRemove(). L809/L824/L862/L880-881 inline styles ao inves de classList. L704/L710 textos UI em portugues hardcoded. L928 map.once('moveend') sem tracking. Falta @fileoverview. | Medio - listener leaks e dead code, flag global pode causar race conditions |
| 3d_models_viewer_tool/components/marker-panel-3d.js | Sim | Nao | L62-64 JSON.parse/stringify ao inves de deepClone(). L1159-1306 ~150 linhas de CSS injetado em JS (deveria ser CSS file). L434/L981/L988/L991 usa alert() ao inves de showToast(). L1080 localStorage.setItem direto (nao usa repository pattern, nao e websocket-ready). Muitos textos UI em portugues hardcoded. L320/L1026/L1150 setTimeout sem trackTimer(). L1136 document.execCommand('copy') depreciado. L457 no-op cleanup push. Inline styles em L713-714, L878, L901. | Medio - CSS em JS e a maior questao; alert() e UX ruim; localStorage bypassa store |
| 3d_models_viewer_tool/components/measurement-panel-3d.js | Sim | Nao | Mesmos problemas do marker-panel: JSON.parse/stringify em L52 (usar deepClone), CSS em JS L655-706, alert() L439, textos PT hardcoded, setTimeout sem trackTimer L306, no-op cleanup L461. Grande violacao DRY: openImageViewer, createDescriptionSection2D, buildPhotoGallerySection, createAddImageCard duplicados com marker-panel e viewshed-panel. | Medio - duplicacao e o maior risco de inconsistencia |
| 3d_models_viewer_tool/components/viewshed-panel-3d.js | Sim | Nao | Mesmos problemas dos outros paineis: JSON.parse/stringify L51, CSS em JS L759-885, alert() L542, textos PT, setTimeout sem trackTimer L291/L417, no-op cleanup L564. heightDebounceTimer (L391/L417) sem cleanup no destroy. DRY: openImageViewer, createDescriptionSection2D, etc duplicados nos 3 paineis. | Medio - debounce timer leak; duplicacao significativa |
| 3d_models_viewer_tool/map_3d.js | Sim | Nao | Strings PT em TOOL_NAMES_3D (L500-504) e showSuccess (L976-977, L991-992). Dead code: _scratchRectangle, _lon, _lat nao usados em initCesiumEventHandlers (L707-713). setTimeout sem cleanup tracking L597-601, L923. | Baixo |
| 3d_models_viewer_tool/services/keyboard-service-3d.js | Sim | Nao | Strings PT em dialogos de confirmacao (L202-233). document.addEventListener em L90, L152 sem tracking via subscribe()/addDomListener(). | Medio |
| 3d_models_viewer_tool/tools/marker_tool_3d.js | Sim | Nao | Event listener em viewer.canvas (L244) sem cleanup tracking. Propriedade customizada viewer._markerSelectionHandler (L474-518) bypassa framework patterns. Sem subscribe() wrapper do event-cleanup. | Medio |
| 3d_models_viewer_tool/tools/measurement_tool_3d.js | Sim | Nao | Sem subscribe() wrapper do event-cleanup para listeners. Multiplos console.warn em catch blocks (L186, L522, L546, L894, L1189). Sem escapeHtml para labels de medicao potencialmente do usuario. | Medio |
| 3d_models_viewer_tool/tools/mouse_coordinates_3d.js | Sim | Nao | CSS-in-JS massivo (L27-144 inline styles). Listeners diretos em L80-82, L97-99, L127-133, L149, L152 sem subscribe(). Strings PT L68, L87. innerHTML em L67, L86, L259-260 sem escapeHtml. | Alto |
| 3d_models_viewer_tool/tools/screenshot_tool.js | Sim | Nao | String PT em alert L345. Multiplos setTimeout sem cleanup tracking (L99, L124, L126, L163, L284, L320, L333). alert() em L29, L345 ao inves de showToast. Comentario PT L237. | Alto |
| 3d_models_viewer_tool/tools/viewshed_tool_3d.js | Sim | Nao | Sem subscribe() wrapper para selectionHandler (L507-538). Operacoes async em selecao sem error boundaries. Manipulacao de propriedade customizada no viewer. | Medio |
| analysis_tools/los_tool/add_los_control.js | Sim | Nao | CSS em JS em L903-919 (inline styles para label de medicao). Listeners em L428, L432, L927 sem subscribe(). Strings PT ao longo do arquivo (L119, L333, etc). | Medio |
| analysis_tools/los_tool/los_attributes_panel.js | Sim | Nao | CSS em JS em L63-73, L79, L85-93. Strings PT ao longo do arquivo (L95, L119, L176). innerHTML em L119 com dados do usuario sem escapeHtml (risco XSS). | Alto |
| analysis_tools/visibility_tool/add_visibility_control.js | Sim | Nao | CSS em JS massivo em L769-843 (modal de progresso inteiro com inline styles). Listeners em L351, L354, L872, L927-928 sem subscribe(). Strings PT (L794, L803, L849). | Alto |
| analysis_tools/visibility_tool/add_visibility_geometry.js | Sim | Nao | JSON.parse em L72 ao inves de usar deepClone utility. Sem outros problemas significativos. | Baixo |
| analysis_tools/visibility_tool/visibility_attributes_panel.js | Sim | Nao | CSS em JS em L49. Strings PT ao longo do arquivo (L50, L76). Import nao utilizado _createModernButtons em L5 (dead code). | Medio |
| attribute_table/components/column-context-menu.js | Sim | Nao | Listeners handleClickOutside e handleEscape no document (L71-90) podem leakar se menu for destruido programaticamente sem trigger dos handlers. | Medio |
| attribute_table/components/table-filters.js | Sim | Nao | debounceTimer em module scope (L88) pode leakar entre multiplas instancias de createSearchInput. Strings PT em L38, L211. | Medio |
| attribute_table/components/table-panel.js | Sim | Nao | Strings PT em L214, L216 (feicoes, de). Sem outros problemas significativos. | Baixo |
| attribute_table/components/table-renderer.js | Sim | Nao | Listeners re-attached via addEventListener (L434, L462) sem cleanup quando celulas sao destruidas. String PT L528. | Medio |
| azimuth_distance_tool/add_azimuth_distance_control.js | Sim | Nao | CSS em JS para marker (L156-178 inline styles). Strings PT hardcoded (L224, L496). Listeners nao usam event-cleanup utility. | Medio |
| azimuth_distance_tool/azimuth_distance_attributes_panel.js | Sim | Nao | CSS-in-JS extenso (L198-206, L256-264). Strings PT (L104, L109, L115). DOM listeners sem cleanup tracking. | Medio |
| azimuth_distance_tool/azimuth_distance_panel.js | Sim | Nao | CSS-in-JS extensivo ao longo do arquivo (L156-165, L198-204, L393-408, L559-598). Usa event-cleanup corretamente (L38-39). Muitas strings PT (L224, L296, L832). | Alto |
| azimuth_distance_tool/components/compass-rose.component.js | Sim | Nao | SVG construido via string concatenation com styling inline (L56-172). Strings PT no SVG (L108 NM, L113 NV, L121 Decl). | Medio |
| azimuth_distance_tool/components/geometry-preview.component.js | Sim | Nao | SVG via string concatenation com inline styling (L45-50, L102-107). Labels PT no SVG (L79, L123). Aceitavel para componente SVG. | Baixo |
| azimuth_distance_tool/components/leg-row.component.js | Sim | Nao | CSS-in-JS extensivo (L50-60, L74-87, L102-113, L164-179, L262-277). Listeners diretos sem event-cleanup (L116, L181, L215, L280, L394). Strings PT (L98, L199, L261, L392). | Alto |
| azimuth_distance_tool/components/reference-point.component.js | Sim | Nao | Inline styles extensivos (L34-44, L79-83, L102-115). Listeners diretos sem cleanup (L47, L53, L123, L165, L188). Strings PT (L89, L141). | Alto |
| briefing/editor/briefing-editor.control.js | Sim | Nao | Listener leak em L208/L425: document.addEventListener('mousemove') sem event-cleanup. Inconsistencia slide.modelId vs slide.tilesetId (L229, L458+) pode causar falha silenciosa. | Medio |
| briefing/presentation/transition.service.js | Sim | Nao | Dead code: referencias a slide.modelId (L229/259/309/348/418) que nao existe no schema (deveria ser tilesetId). Inconsistencia pode causar falha silenciosa nas transicoes. | Medio |
| briefing/services/keyboard-service-briefing.js | Sim | Nao | Listener leak: boundHandler adicionado em L76 sem tracking via event-cleanup. Se deactivate() nao for chamado, listener vaza. | Medio |
| catalog/catalog.modal.js | Sim | Nao | Import nao usado isCurrentMapLockedSync (L19). CSS inline extenso (L213-247, L392-406) deveria ser CSS file. Event emissions (L284, L302, L329) usam string literals ao inves de EventTypes. | Medio |
| catalog/catalog.service.js | Sim | Nao | Date parsing (L51-54) pode falhar silenciosamente sem validacao. Normalizacao de texto (L125-130) duplica utility existente. | Baixo |
| catalog/components/catalog-card.js | Sim | Nao | innerHTML com icon SVG de config (L47, L78, L85) sem sanitizacao - risco XSS se config for comprometida. | Alto |
| catalog/components/catalog-filters.js | Sim | Nao | innerHTML para icons sem sanitizacao (L41). Inline CSS via style.setProperty (L39) ao inves de CSS class. | Medio |
| catalog/components/catalog-grid.js | Sim | Nao | innerHTML para empty state icon (L25) sem sanitizacao. Problema menor. | Baixo |
| catalog/components/catalog-header.js | Sim | Nao | innerHTML para search icon (L24) sem sanitizacao. Debounce timer (L31-36) sem cleanup no destroy. | Medio |
| context-menu/context-menu.control.js | Sim | Nao | CSS inline massivo ao longo do arquivo (L113-124, L213-233, etc). HTML de submenu duplicado (L219-221, L375-377). Catch vazio em L329. innerHTML sem escapeHtml para user data em L426. | Medio |
| coordinates/mouse-coordinates.control.js | Sim | Nao | innerHTML para SVG icons (L273, L278, L288) sem sanitizacao. CSS inline extenso (L246-253). Multiplos timers throttle/debounce (L31, L45, L47, L49) com logica de cleanup complexa. | Medio |
| draw_tools/brush_tool/add_brush_control.js | Sim | Nao | Strings PT hardcoded (nomes de tool, mensagens). Sem problemas graves de listener leak ou CSS-in-JS. | Baixo |
| draw_tools/brush_tool/brush_attributes_panel.js | Sim | Nao | Strings PT hardcoded. Sem outros problemas significativos. | Baixo |
| draw_tools/circle_tool/add_circle_control.js | Sim | Nao | Strings PT hardcoded. alert() ao inves de showToast(). | Baixo |
| draw_tools/circle_tool/circle_attributes_panel.js | Sim | Nao | Strings PT hardcoded. Variavel possivelmente nao usada. | Baixo |
| draw_tools/ellipse_tool/add_ellipse_control.js | Sim | Nao | Strings PT hardcoded. alert() ao inves de showToast(). | Baixo |
| draw_tools/ellipse_tool/ellipse_attributes_panel.js | Sim | Nao | Strings PT hardcoded. | Baixo |
| draw_tools/image_tool/add_image_control.js | Sim | Nao | Strings PT hardcoded. Variavel possivelmente nao usada. | Baixo |
| draw_tools/image_tool/image_attributes_panel.js | Sim | Nao | Strings PT hardcoded. | Baixo |
| draw_tools/line_tool/add_line_control.js | Sim | Nao | CSS-in-JS para tooltips e labels de medicao. alert() ao inves de showToast(). Strings PT hardcoded. | Medio |
| draw_tools/line_tool/line_attributes_panel.js | Sim | Nao | CSS-in-JS para estilos de painel. Strings PT hardcoded. | Medio |
| draw_tools/line_tool/line_profile.js | Sim | Nao | CSS-in-JS extenso para graficos Chart.js. Strings PT. | Medio |
| draw_tools/point_tool/add_point_control.js | Sim | Nao | Strings PT hardcoded. | Baixo |
| draw_tools/point_tool/point_attributes_panel.js | Sim | Nao | Strings PT hardcoded. | Baixo |
| draw_tools/polygon_tool/add_polygon_control.js | Sim | Nao | CSS-in-JS para tooltips e labels. alert() ao inves de showToast(). Strings PT. | Medio |
| draw_tools/polygon_tool/polygon_attributes_panel.js | Sim | Nao | CSS-in-JS para estilos. Strings PT hardcoded. | Medio |
| draw_tools/rectangle_tool/add_rectangle_control.js | Sim | Nao | Strings PT hardcoded. | Baixo |
| draw_tools/rectangle_tool/rectangle_attributes_panel.js | Sim | Nao | Strings PT hardcoded. | Baixo |
| draw_tools/text_tool/add_text_control.js | Sim | Nao | Strings PT hardcoded. Arquivo grande. | Baixo |
| draw_tools/text_tool/text_attributes_panel.js | Sim | Nao | Strings PT hardcoded. CSS-in-JS para estilos de painel. Arquivo grande. | Medio |
| features_tab/analysis-layers.component.js | Sim | Nao | Strings PT hardcoded. innerHTML sem escapeHtml para labels. | Medio |
| features_tab/catalog-layers.component.js | Sim | Nao | Strings PT hardcoded. innerHTML sem escapeHtml para layer names. | Medio |
| features_tab/feature-item.component.js | Sim | Nao | innerHTML com nome de feature sem escapeHtml (risco XSS). Strings PT. | Alto |
| features_tab/features_tab.js | Sim | Nao | alert() ao inves de showToast() para confirmacoes. Strings PT hardcoded ao longo do arquivo. setTimeout com magic numbers sem comentario. | Medio |
| features_tab/features_tab.styles.js | Sim | Nao | CSS-in-JS massivo - arquivo inteiro e estilos injetados via JS. Deveria ser arquivo CSS separado. | Alto |
| features_tab/group-item.component.js | Sim | Nao | innerHTML com nome de grupo sem escapeHtml. Strings PT. | Alto |
| features_tab/layer-container.builder.js | Sim | Nao | innerHTML com nome de layer sem escapeHtml. Strings PT. | Alto |
| features_tab/layer-list.component.js | Sim | Nao | Strings PT hardcoded. event-cleanup usado parcialmente. | Medio |
| features_tab/models3d-section.component.js | Sim | Nao | Strings PT hardcoded. innerHTML sem escapeHtml para nomes de modelo. | Medio |
| features_tab/streetview360-section.component.js | Sim | Nao | Strings PT hardcoded. innerHTML sem escapeHtml. | Medio |
| grid/grid.control.js | Sim | Nao | Strings PT hardcoded. CSS-in-JS para estilos do grid. | Medio |
| grid/grid-layers.config.js | Sim | Nao | URLs hardcoded com IP:PORT (ex: localhost:8080). Deveria usar config. | Alto |
| import_export/drag-drop.handler.js | Sim | Nao | Inline styles em createImportModeModal e showDropOverlay - devem ser CSS. Strings PT em showError/showWarning. | Baixo |
| import_export/export-import.service.js | Sim | Nao | alert() usado ao inves de showToast(). Strings PT em mensagens. Falta captura de retorno do eventBus.emit. | Medio |
| import_export/import.control.js | Sim | Nao | alert() ao inves de showToast(). Inline styles em _showProgressIndicator. Strings PT em mensagens. | Medio |
| import_export/pdf-export.tab.js | Sim | Nao | Inline styles massivos em showExportModal e createUI. alert() usado. Strings PT. Comentario PT. | Alto |
| import_export/screenshot.control.js | Sim | Nao | alert() usado em multiplos locais ao inves de showToast(). Strings PT em mensagens. | Medio |
| keyboard/keyboard-shortcuts.js | Sim | Nao | addEventListener sem cleanup via subscribe() de event-cleanup.js. Cleanup manual em disable(). | Baixo |
| layers/layer_setup.js | Sim | Nao | setTimeout sem trackTimer(). Comentario PT. console.log em producao. | Baixo |
| layers/styles/content.layers.js | Sim | Nao | Sobrescreve setData do source para adicionar listener - pattern arriscado que pode causar memory leak. | Medio |
| map/animation.service.js | Sim | Nao | addEventListener sem cleanup - listeners removidos manualmente mas vulneravel a race conditions. | Medio |
| map/drag-rotate.handler.js | Sim | Nao | Comentarios PT. addEventListener sem usar subscribe(), cleanup manual em disable(). | Baixo |
| military_tools/arrow_tool/add_arrow_control.js | Sim | Nao | alert() ao inves de showToast(). CSS inline extensivo. Strings PT. addEventListener sem subscribe(). | Medio |
| military_tools/arrow_tool/arrow_attributes_panel.js | Sim | Nao | Strings PT nos labels. CSS inline. | Baixo |
| military_tools/boundary_tool/add_boundary_control.js | Sim | Nao | CSS inline extensivo. Strings PT. addEventListener sem subscribe(). | Medio |
| military_tools/boundary_tool/boundary_attributes_panel.js | Sim | Nao | Strings PT nos labels. CSS inline. | Baixo |
| military_tools/coordination_measure_tool/add_coordination_measure_control.js | Sim | Nao | alert() ao inves de showToast(). Strings PT. addEventListener sem subscribe(). | Medio |
| military_tools/coordination_measure_tool/attributes/color-control.section.js | Sim | Nao | CSS inline. Strings PT nos labels. | Baixo |
| military_tools/coordination_measure_tool/attributes/coordination_measure_attributes_panel.js | Sim | Nao | Strings PT nos labels. CSS inline. | Baixo |
| military_tools/coordination_measure_tool/attributes/point-selector.modal.js | Sim | Nao | Strings PT. addEventListener sem subscribe(). | Baixo |
| military_tools/coordination_measure_tool/attributes/text-modifiers.section.js | Sim | Nao | CSS inline. Strings PT. | Baixo |
| military_tools/coordination_measure_tool/attributes/ui-components.helpers.js | Sim | Nao | CSS inline extensivo. Strings PT. addEventListener sem subscribe() em document. | Medio |
| military_tools/coordination_measure_tool/coordination_measure_constants.js | Sim | Nao | Strings PT em todas as constantes (aceitavel para dados de config militar). | Baixo |
| military_tools/coordination_measure_tool/coordination_points_catalog.js | Sim | Nao | Strings PT no catalogo (aceitavel para dados de config militar). | Baixo |
| military_tools/military_symbol_tool/add_military_symbol_control.js | Sim | Nao | alert() ao inves de showToast(). Comentarios e strings em PT. | Medio |
| military_tools/military_symbol_tool/attributes/engagement-bar.section.js | Sim | Nao | Strings PT hardcoded (labels, placeholders). | Baixo |
| military_tools/military_symbol_tool/attributes/military_symbol_attributes_panel.js | Sim | Nao | Strings PT hardcoded nos labels de UI. | Baixo |
| military_tools/military_symbol_tool/attributes/symbol-form.section.js | Sim | Nao | Strings PT nos labels, placeholders e mensagens. | Baixo |
| military_tools/military_symbol_tool/attributes/symbol-gallery.section.js | Sim | Nao | Strings PT hardcoded. | Baixo |
| military_tools/military_symbol_tool/attributes/symbol-selector.modal.js | Sim | Nao | setTimeout sem trackTimer(). Strings PT. Listener de document sem cleanup adequado. | Medio |
| military_tools/military_symbol_tool/attributes/text-modifiers.section.js | Sim | Nao | Strings PT hardcoded nos labels. | Baixo |
| military_tools/military_symbol_tool/attributes/ui-components.helpers.js | Sim | Nao | Event listener de document sem cleanup. Strings PT. CSS inline extensivo. | Medio |
| military_tools/military_symbol_tool/military_constants.js | Sim | Nao | Strings PT nos labels (aceitavel para config militar brasileira). | Baixo |
| military_tools/military_symbol_tool/text_modifiers_catalog.js | Sim | Nao | Strings PT nos labels e placeholders (aceitavel para catalogo militar). | Baixo |
| military_tools/occupied_front_tool/add_occupied_front_control.js | Sim | Nao | alert() ao inves de showToast(). Strings PT. addEventListener sem subscribe(). | Medio |
| military_tools/occupied_front_tool/occupied_front_attributes_panel.js | Sim | Nao | Strings PT nos labels. CSS inline. | Baixo |
| modals/confirm.modal.js | Sim | Nao | setTimeout sem trackTimer na animacao de fechamento. | Baixo |
| modals/info.modal.js | Sim | Nao | setTimeout sem trackTimer em feedback de copia. | Baixo |
| modals/prompt.modal.js | Sim | Nao | setTimeout sem trackTimer na animacao de fechamento. | Baixo |
| search/feature-search.control.js | Sim | Nao | addEventListener sem cleanup. alert() em vez de showToast. Debounce manual sem trackTimer. | Medio |
| search/search-bar.component.js | Sim | Nao | setTimeout sem trackTimer. Debounce manual sem trackTimer. escapeHtml inline em vez de utility. | Medio |
| search/search-bar.sidepanel-content.js | Sim | Nao | setTimeout sem trackTimer. escapeHtml inline em vez de utility. | Baixo |
| selection_tools/rectangle_selection_control.js | Sim | Nao | addEventListener sem cleanup. Mutacao direta de DOM/cursor sem state manager. | Medio |
| sidebar/components/feature-identification.js | Sim | Nao | Listeners sem cleanup. setTimeout nao rastreado com trackTimer. | Medio |
| sidebar/components/feature-location-section.js | Sim | Nao | JSON.parse em vez de deepClone. setTimeout nao rastreado. | Medio |
| sidebar/components/feature-panel.js | Sim | Nao | setTimeout nao rastreado com trackTimer. Listener leak potencial. | Medio |
| sidebar/components/feature-photo-gallery.js | Sim | Nao | alert() em vez de showToast(). Listeners nao rastreados em multiplos locais. | Alto |
| sidebar/components/feature-tabs.js | Sim | Nao | Listener sem cleanup em tab buttons. Sem unsubscribe guardado. | Medio |
| sidebar/components/group-type-selector.js | Sim | Nao | Listeners sem cleanup adequado. | Baixo |
| sidebar/components/sidebar-panel.js | Sim | Nao | setTimeout nao rastreado com trackTimer. | Baixo |
| sidebar/panels/feature-panel-content.js | Sim | Nao | Listener sem cleanup via addDomListener. | Medio |
| sidebar/panels/notes-panel.js | Sim | Nao | Listeners sem cleanup adequado em multiplos locais. | Medio |
| sidebar/panels/vector-info-panel.js | Sim | Nao | CSS inline extenso (deveria estar em arquivo CSS). | Baixo |
| sidebar/sidebar.control.js | Sim | Nao | setTimeout sem trackTimer. Listener leak potencial. | Medio |
| sidebar/tabs/briefings.tab.js | Sim | Nao | Listener direto no card sem addDomListener. | Medio |
| sidebar/tabs/maps.tab.js | Sim | Nao | setTimeout sem trackTimer. Listener direto no document. | Medio |
| snapping/snapping.service.js | Sim | Nao | Event listeners sem cleanup garantido. destroy() limpa listeners mas se nao chamado = leak. | Medio |
| state/state_manager.js | Sim | Nao | setTimeout sem trackTimer (throttle mouse). subscribe() retorna unsubscribe sem trackCleanup. | Medio |
| store/briefing.operations.js | Sim | Nao | JSON.parse(JSON.stringify()) em vez de deepClone. Strings PT hardcoded. | Medio |
| store/catalog.operations.js | Sim | Nao | Object.assign() mutacao direta. Leitura direta de config nao preparada para WebSocket. | Medio |
| store/cesium3d.operations.js | Sim | Nao | localStorage.getItem/setItem direto. Math.random() para IDs em vez de generateUUID(). Sem deepClone para old state. | Alto |
| store/feature.operations.js | Sim | Nao | JSON.parse(JSON.stringify()) em vez de deepClone (3x). JSON.stringify para comparacao de igualdade em vez de deepEqual. Strings PT nos console.warn. | Medio |
| store/map.operations.js | Sim | Nao | console.warn com strings PT. memoryStore.lockedMaps.has() depende de estado em memoria nao preparado para WebSocket. | Medio |
| store/memory-store.js | Sim | Nao | Mutacao direta de estado sem sincronizacao. Nao preparado para WebSocket (estado local apenas). | Alto |
| store/store-state-manager.js | Sim | Nao | Mutacao de estado em memoria. Sem problemas graves mas nao preparado para WebSocket. | Medio |
| store/streetview360.operations.js | Sim | Nao | Padrao similar a cesium3d - possivel localStorage direto e JSON.parse/stringify em vez de deepClone. | Medio |
| store/undo-redo-messages.js | Sim | Nao | Todas as strings em PT hardcoded (esperado para arquivo de i18n pt-BR). | Baixo |
| street_view_tool/add_street_view_control.js | Sim | Nao | alert() em loadPoint (substituir por showToast). setTimeout para _markerClickConsumed pode causar leak. | Medio |
| street_view_tool/components/marker-panel-360.js | Sim | Nao | alert() na validacao de arquivo. JSON.parse/stringify em vez de deepClone. setTimeout sem trackTimer. | Medio |
| street_view_tool/navigation/navigator.js | Sim | Nao | addEventListener sem cleanup tracking. document.dispatchEvent custom event sem namespace. Import dinamico pode falhar silenciosamente. | Medio |
| street_view_tool/saved_photos_markers.js | Sim | Nao | setTimeout para _markerClickConsumed pode causar leak. Cleanup via off() correto. | Baixo |
| street_view_tool/street_view_viewer.js | Sim | Nao | Muitos addEventListener sem trackTimer. textureCache e metadataCache LRU bons mas nao usa deepClone. | Alto |
| street_view_tool/streetview_markers.js | Sim | Nao | setTimeout para _markerClickConsumed pode causar leak. Listeners gerenciados via on/off. | Baixo |
| tool_manager/base_control.js | Sim | Nao | JSON.parse/stringify usado para deepClone em vez de utility deepClone. | Baixo |
| tool_manager/base_geometry.js | Sim | Nao | JSON.parse usado para normalizeCoordinates sem tratamento adequado. | Baixo |
| tool_manager/clipboard_manager.js | Sim | Nao | JSON.parse para normalizacao de coordenadas. setTimeout sem trackTimer. | Medio |
| tool_manager/group_manager.js | Sim | Nao | setTimeout sem trackTimer para salvar grupos. | Medio |
| tool_manager/hatch_config_modal.js | Sim | Nao | CSS inline em JS. Strings PT. | Baixo |
| tool_manager/helpers/color-picker.helpers.js | Sim | Nao | setTimeout sem trackTimer. Cleanup listener manual sem framework. | Medio |
| tool_manager/helpers/feature-header.helpers.js | Sim | Nao | JSON.parse usado em multiplos locais. addEventListener sem cleanup consistente. | Medio |
| tool_manager/helpers/slider.helpers.js | Sim | Nao | setTimeout sem trackTimer (debounce). | Baixo |
| tool_manager/move_handler.js | Sim | Nao | setTimeout sem trackTimer. addEventListener sem cleanup via framework. | Medio |
| tool_manager/selection_manager.js | Sim | Nao | setTimeout sem trackTimer. document.addEventListener cleanup manual. | Medio |
| tool_manager/tabbed_attribute_panel.js | Sim | Nao | CSS inline em JS. addEventListener sem cleanup. | Baixo |
| toolbar/components/active-tool-chip.js | Sim | Nao | setTimeout sem trackTimer. | Baixo |
| ui/loading-screen.js | Sim | Nao | setTimeout sem trackTimer. Potencial listener leak. | Baixo |
| user_data/attributes_tab_renderer.js | Sim | Nao | setTimeout sem trackTimer. Listeners inline sem cleanup. | Medio |
| user_data/images_tab_renderer.js | Sim | Nao | alert() usado. escapeHtml local em vez do importado. | Medio |
| utilities/feature_navigation_utils.js | Sim | Nao | setTimeout sem trackTimer. | Baixo |
| utilities/id_utils.js | Sim | Nao | JSON.parse/stringify usado em vez de deepClone. | Medio |
| utilities/pointer-utils.js | Sim | Nao | setTimeout sem trackTimer. Cleanup retornado mas sem rastreamento. | Baixo |
| utilities/toast_service.js | Sim | Nao | setTimeout sem trackTimer. Listeners inline. | Medio |
| vector_info/vector-info.control.js | Sim | Nao | Listeners adicionados no _createContextMenuElement sem cleanup. | Medio |
