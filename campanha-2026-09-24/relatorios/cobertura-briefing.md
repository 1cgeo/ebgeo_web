# Cobertura: BRIEFINGS E PROCESSAMENTOS

Branch `hunt/cob-briefing` (worktree collab-briefing), a partir de `integracao_backend` c777d8c5. Início 05:55.

Legenda: **L** = atlas local, **S** = atlas de servidor com colega (2 navegadores), **F5** = sobrevive ao recarregar. "UI" = gesto real; "transp." = spec que só dirige o transporte (não conta como cobertura de tela).

## 1. Briefings: comandos enumerados do código

Fontes: `sidebar/tabs/briefings.tab.js` (lista), `briefing/editor/briefing-editor.control.js` (editor), `briefing/presentation/briefing-presenter.control.js` + `briefing/components/presentation-text-panel.js` (apresentação), `briefing/services/keyboard-service-briefing.js` (teclado), `briefing/export/briefing-pdf-export.js` (PDF).

| # | Comando (onde) | L | S (colega) | F5 | Cobertura existente / estado |
|---|---|---|---|---|---|
| B1 | CRIAR BRIEFING (aba) | UI | UI | UI | browser-collab-briefing-temporal "briefing create → update → delete" (UI, S) |
| B2 | Renomear briefing (campo do editor) | — | UI | — | idem; briefing-editor-copia-velha (S) |
| B3 | Excluir briefing (cartão, confirmar) | — | UI | — | idem |
| B4 | Adicionar slide (+) | — | UI | — | browser-collab-briefing-temporal "slide add/update/remove" (S) |
| B5 | Título do slide | — | UI | — | idem; briefing-editor-campo-com-foco (S) |
| B6 | Excluir slide (lixeira, confirmar) | — | UI | — | idem; briefing-editor-titulo-apos-excluir |
| B7 | Reordenar slides (arrastar alça) | UI | UI | UI | **coberto por briefing-editor-cobertura** (53d4eda5); **DEFEITO 85e35d36** slide_order congelado no servidor (F5 voltava a ordem velha) |
| B8 | Importar slides de outro briefing (botão) | — | UI | — | **coberto por briefing-editor-cobertura**; **DEFEITO 85e35d36** cópias iam para o briefing de ORIGEM no servidor |
| B9 | Duplicar slide / duplicar briefing | não existe no código | | | (não há comando) |
| B10 | Mapa do slide (select) | — | UI | — | **coberto por briefing-editor-cobertura** (apresentar troca o mapa corrente) |
| B11 | Salvar Posição (vista 2D) | parcial | parcial | LACUNA | briefing-link-e-figura (captura sem conferir valor) |
| B12 | Salvar posição no 3D / 360 (vista 3D/360) | LACUNA | LACUNA | — | exige modelo/foto semeados |
| B13 | "Usar orientação salva" (360) | — | transp. | — | browser-briefing-advanced §22.9 |
| B14 | Estado temporal do slide (cursor + "Controle temporal ligado") | — | UI | UI | **coberto por briefing-vista-do-slide-cobertura** (caef9f04); **DEFEITO 0dd03c9b** a edição não chegava ao servidor |
| B15 | Mapa base do slide | — | UI | UI | **coberto por briefing-vista-do-slide-cobertura**; **DEFEITO 0dd03c9b** idem |
| B16 | Controles visíveis na apresentação (caixas) | UI | — | — | briefing-controles-do-slide (L) |
| B17 | Texto rico: cada formato da barra Quill | — | UI | UI | **coberto por briefing-texto-rico-formatos** (+ lista marcadores, link, colagem nos specs próprios); **DEFEITO 5b99b9f9** alinhamento/recuo sumiam na apresentação |
| B18 | Importar nota do mapa (botão) | — | UI | UI | **coberto por briefing-vista-do-slide-cobertura** (conteúdo no servidor, colega, F5 e apresentação) |
| B19 | Salvar (botão do cabeçalho) / Fechar editor | UI | — | parcial | briefing-texto-sobrevive-ao-f5 (Chromium/Firefox) |
| B20 | APRESENTAR (clique no cartão) | UI | UI | UI | **coberto por briefing-apresentacao-cobertura** (colega apresenta, e depois do F5) |
| B21 | Navegar: Próximo/Anterior/Primeiro/Último (botões) | — | UI | UI | **coberto** (briefing-apresentacao-cobertura) |
| B22 | Navegar: teclado (→/D, ←/A, Home, End) | — | UI | UI | **coberto** |
| B23 | Ir para slide (contador → lista) | — | UI | UI | **coberto** |
| B24 | Restaurar posição (botão) | — | UI | UI | **coberto** |
| B25 | Tela cheia (botão / F) | fora | | | headless recusa requestFullscreen (declarado no spec) |
| B26 | Sair (botão / Escape) | UI | UI | UI | **coberto** (Escape e botão) |
| B27 | Exportar PDF (cartão) | LACUNA | LACUNA | — | |
| B28 | Aviso ao apresentar sem slides / sem posição | UI | — | — | **coberto por briefing-editor-cobertura** (atlas local); **DEFEITO d630236e** a recusa deixava a barra lateral recolhida e a lista sumia |

## 2. Processamentos: algoritmos enumerados do código

Fonte: `processing/algorithms/index.js` registra `buffer`, `convex-hull`, `voronoi`. Tipos aceitos (os três): `SUPPORTED_GEOMETRY_TYPES` = point, line, polygon, circle, rectangle, ellipse, text, image, military_symbol, engineering_symbol, coordination_measure, brush, arrow, boundary, occupied_front, coordination_line. Parâmetros comuns (panel-builder): camada de origem, "Apenas feições selecionadas", "Nome da nova camada". Próprios: buffer "Distância (metros)"; voronoi "Desenhar Retângulo" (área de recorte) e "Apenas pontos".

| # | Item | Resultado conferido | S (colega) | F5 | Desfazer | Cobertura existente |
|---|---|---|---|---|---|---|
| P1 | Painéis dos 3 (abrir, parâmetros) | — | — | — | — | processing-tab-local (L, sem executar) |
| P2 | Envoltória convexa sobre pontos | anel com vértices | UI | — | — | browser-collab-processing |
| P3 | Envoltória sobre linha + polígono | contém todos os vértices | UI | F5 do colega | — | **coberto por processamento-cobertura** "Envoltoria" |
| P4 | Buffer em ponto (raio) | raio 750,0 m | UI | F5 | — | **coberto** "Buffer: ponto, linha e poligono" |
| P5 | Buffer em linha e polígono | contém os vértices | UI | F5 | — | idem |
| P5b | Os 16 tipos declarados nos 3 algoritmos | 16/1/16 | — | — | — | **coberto** "16 tipos" (entrada semeada pela store, exceção declarada) |
| P6 | "Apenas feições selecionadas" | 1 de 3 | — | — | — | **coberto** |
| P7 | Nome da nova camada | camada com o nome, no servidor | UI | F5 | — | **coberto** |
| P8 | Voronoi: pontos + retângulo | 3 zonas, 1 por ponto, no retângulo | UI | — | — | **coberto** "Voronoi" |
| P9 | Voronoi "Apenas pontos" | linha fora | — | — | — | **coberto** |
| P10 | Desfazer processamento | tira as feições (autor, colega, servidor) | UI | — | UI | **coberto** "desfazer"; a camada de saída VAZIA fica (anotado, decisão de produto) |
| P11 | Canto do retângulo sobre feição | painel fica | — | — | — | **DEFEITO 23550db4** (voronoi-retangulo-sobre-feicao.repro.spec.js) |
| P12 | Mapa travado / Leitor recusa processar | EM OBRA | — | — | — | 3 defeitos medidos (ver PRÓXIMO PASSO); conserto e spec NÃO commitados |

## Estado

- 05:55 matriz inicial.
- 06:25 processamentos: a5cdd19a (cobertura, 6 casos) e defeito 23550db4.
- 06:40 apresentação 41efb34f (cobertura), formatos Quill + defeito 5b99b9f9.
- 06:55 defeito 85e35d36 (backend: pai do slide pelo envelope; slide_order derivado dos slides).
- 08:05 editor: 53d4eda5 (cobertura, 4 casos: reordenar, importar slides, mapa do slide, ciclo inteiro em atlas local) e defeito d630236e (apresentação recusada devolve a lista). Controle negativo de d630236e: vermelho na asserção nomeada (cartão ausente) depois que a transição da barra assenta. Nota de instrumento: `toBeVisible`/`toBeInViewport` logo depois do aviso passam com o conserto REVERTIDO, porque o painel ainda está a meio caminho do recolher; o spec espera `getAnimations()` do painel zerar antes de ler. Vitest do frontend: uma rodada cheia deu 1 vermelho em docs-integridade (símbolo entre crases) sob carga de outras sessões; sozinho 10/10 e a rodada cheia seguinte 901/901: flake de carga, não defeito.

- 09:40 vista do slide: caef9f04 (cobertura: base e linha do tempo por slide, colega ao vivo e F5, a vista do colega volta ao sair; nota do mapa importada). Defeito **0dd03c9b** (cliente): o slide que volta do servidor (eco da própria op e retrato) guardava as colunas do servidor ao lado dos campos do cliente (`base_layer` junto de `baseLayer`, `map_id` junto de `mapId`...), envelhecidas; a edição seguinte levava as duas grafias e o servidor grava a snake_case. Efeito: depois do primeiro recibo, ou de qualquer F5, trocar mapa base, interruptor temporal, instante, mapa, modelo 3D ou foto 360 de um slide ficava só na tela do autor. Conserto só no cliente (sem mexer no contrato): folha `store/sync/slide-shape.js`, escrita e entrada no formato do cliente. Controle negativo: servidor com os valores do primeiro recibo sem o conserto.
- 09:45 REGRESSÃO MINHA, corrigida: **85e35d36** (envelope vence o `briefing_id` do payload) quebrou o contrato de transporte que `browser-briefing-slides` e `browser-briefing-advanced` §22.8/9/10 fixam (envelope com o id do MAPA). 4 specs vermelhos, que eu não tinha rodado antes daquele commit. **8dbd500f** devolve a regra antiga (payload primeiro, envelope de reserva); a cópia de slide entre briefings continua certa porque desde 0dd03c9b o cliente não manda `briefing_id`. Os 4 specs verdes; o caso de importar do briefing-editor-cobertura verde. Repro do backend com controle negativo (o caso do contrato vermelho com a regra de 85e35d36).
- Teto de peso: `teto-de-peso-da-pagina-do-mapa.test.js` VERMELHO, grafo completo = **802 arquivos** (teto 801). O arquivo a mais é `store/sync/slide-shape.js` (0dd03c9b, folha de zero imports). Não mexi no número, como pedido.
- Vitest do frontend: além do teto, flakes de carga que passam sozinhos (docs-integridade, tab-lock-refutacao 3.5: 3/3 verdes isolados).

## Commits no hunt/cob-briefing (sobre integracao_backend c777d8c5)

23550db4 fix(processing) canto do retângulo sobre feição; a5cdd19a test(processing) cobertura; 5b99b9f9 fix(briefing) alinhamento/recuo na apresentação (+ spec de formatos); 41efb34f test(briefing) apresentação; 85e35d36 fix(sync) pai do slide + slide_order (a metade do pai foi revertida em 8dbd500f); d630236e fix(briefing) apresentação recusada devolve a lista; 53d4eda5 test(briefing) editor; 0dd03c9b fix(briefing) edição de slide depois do primeiro recibo chega ao servidor; 8dbd500f fix(sync) `briefing_id` do payload volta a nomear o pai; caef9f04 test(briefing) vista do slide e nota importada.

## PRÓXIMO PASSO (exato)

Pausado a pedido do coordenador. Worktree `C:/Users/diniz/ebgeo_hunt/collab-briefing`, branch `hunt/cob-briefing`, HEAD **caef9f04**.

Suíte COMPLETA do backend sobre 8dbd500f (c8, banco e diretório de cobertura próprios): **5691/5691 verdes, piso de cobertura OK** (statements 98,36%, branches 90,04%, functions 96,96%). 8dbd500f está verificado dos dois lados.

NÃO commitado (não verificado com o conserto):
- `frontend/src/js/processing/processing-panel.js`: (a) o botão Executar segue a resposta de `edicaoIndisponivelSync('CREATE_FEATURE')` ao vivo por `assinarEdicaoIndisponivel`: POSTO (Leitor) esconde o botão e mostra a frase `denialNotice` num `<p class="processing-panel__posto">`; ESTADO (mapa travado) desenha com `aria-disabled` (nunca `disabled`) e o clique recusa com "Mapa bloqueado. Desbloqueie para editar."; (b) a mensagem de sucesso deixa de escapar o nome da camada duas vezes ("Zona &amp; Norte").
- `frontend/src/css/processing.css`: `[aria-disabled="true"]` no botão e a regra de `.processing-panel__posto`.
- `frontend/tests/e2e-ui/processamento-trava-e-posto.repro.spec.js`: 2 casos, VERMELHOS sem o conserto (medido: `aria-disabled` ausente; Executar visível para o Leitor). Defeitos medidos antes: aberto com o mapa travado, o botão ficava `disabled` para sempre depois de destravar; o Leitor clicava e lia "Falha ao criar camada de saída".

Próximo comando (de dentro de `frontend/`):
`EBGEO_UI_E2E_APP_PORT=4334 EBGEO_UI_E2E_BACKEND_PORT=3924 EBGEO_E2E_PORT=3934 EBGEO_E2E_DB_NAME=ebgeo_e2e_brief TEST_DB_NAME=ebgeo_test_brief npx playwright test processamento-trava-e-posto processamento-cobertura processing-tab-local browser-collab-processing --retries=0 --workers=1`
Depois: controle negativo da linha do escape (reverter só ela: o caso 1 fica vermelho no `toHaveText('... "Zona & Norte"')`); lint e vitest do frontend; DOIS commits: primeiro o escape (arquivo = HEAD + a linha), depois trava/posto + CSS + spec.

Lacunas que ainda faltam: B27 exportar PDF do briefing (download e número de páginas), B12 vista 3D/360 (exige modelo/foto semeados; pode ficar declarado fora). B11 coberto indiretamente (B24). Achado não corrigido: desfazer um processamento deixa a camada de saída VAZIA (decisão de produto). Proposta ao coordenador (contrato, não fiz): o servidor poderia preferir o camelCase quando as duas grafias chegam num slide, protegendo clientes antigos com op na fila; hoje o conserto é só do cliente.
