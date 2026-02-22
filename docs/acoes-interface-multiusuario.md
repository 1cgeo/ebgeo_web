# Ações da Interface - Implicações para Sistema Multiusuário

Este documento lista todas as ações da interface do EBGeo Web e descreve o que será necessário implementar para suportar login (JWT), edição multiusuário em tempo real com WebSockets.

**Princípios de design:**
- **Sem locks** — Nenhuma ação bloqueia outros usuários. Toda resolução de conflito é last-write-wins.
- **Autenticação JWT** — Token refresh + WebSocket autenticado.
- **Awareness opcional** — Presença de cursores/avatares é nice-to-have, não requisito.

---

## Legenda de Complexidade

- 🟢 **Local** — Ação puramente local, sem impacto no servidor (ex: zoom, pan)
- 🟡 **Sync simples** — Necessita sincronização básica (broadcast + last-write-wins)
- 🔴 **Sync complexo** — Operação destrutiva ou que afeta múltiplas entidades
- 🔒 **Auth** — Requer controle de permissão/autenticação

---

## 1. Barra Lateral — Aba Mapas

| # | Ação | Impacto Multiusuário |
|---|------|---------------------|
| 1 | **Abrir** — Em projeto local: carrega .ebgeo. Em projeto do backend: abre tela de carregar projeto do backend | 🟢 Ação local. No caso de projeto local, carrega arquivo .ebgeo localmente. No caso de projeto do backend, navega para a tela de seleção de projetos (troca de contexto, sem impacto nos outros usuários do projeto atual). |
| 2 | **Importar projeto (.ebgeo)** — Adiciona ao projeto atual | 🔴🔒 Merge de dados. Servidor deve resolver IDs duplicados, gerar novos UUIDs se necessário. Broadcast novos mapas/camadas/feições para todos. Permissão de editor mínima. |
| 3 | **Salvar projeto** — Download .ebgeo | 🟢 Ação local de download. Servidor pode registrar log de exportação. Sem impacto nos outros usuários. |
| 4 | **Limpar tudo** — Em projeto do backend: deleta o Atlas inteiro | 🔴🔒 Somente admin/owner. Deleta o Atlas no servidor. Broadcast desconexão para todos os usuários conectados. Remove acessos compartilhados. Todos os clientes devem ser redirecionados para tela de projetos. Exigir confirmação dupla. |
| 5 | **Bloquear/desbloquear mapa** | 🟡🔒 Broadcast `MAP_LOCK_CHANGED` para todos. Permissão de admin ou owner do mapa. Clientes devem desabilitar edição imediatamente ao receber evento. |
| 6 | **Notas do mapa** — Editor rich text | 🟡 Last-write-wins. Ao salvar, broadcast `MAP_MODIFIED` com conteúdo atualizado das notas. Outros clientes atualizam se estiverem visualizando as notas desse mapa. |
| 7 | **Renomear mapa** — Editar nome inline | 🟡 Broadcast `MAP_MODIFIED` com novo nome. Last-write-wins. Outros clientes atualizam label imediatamente. |
| 8 | **Adicionar mapa** | 🟡 Broadcast `MAP_CREATED` com dados do novo mapa. Outros clientes adicionam na lista. UUID gerado no servidor para evitar colisão. |
| 9 | **Deletar mapa** | 🔴🔒 Operação destrutiva. Permissão de admin ou owner do mapa. Broadcast `MAP_DELETED`. Clientes que estão visualizando o mapa deletado devem ser redirecionados. Soft-delete no servidor (recuperável). |
| 10 | **Duplicar mapa** | 🟡 Servidor cria cópia com novos UUIDs. Broadcast `MAP_CREATED` com mapa duplicado. Operação atômica no servidor. |
| 11 | **Reordenar mapas** (drag & drop) | 🟡 Broadcast nova ordem. Last-write-wins. |
| 12 | **Salvar posição do mapa** (centro, zoom, bearing, pitch) | 🟡 Broadcast `MAP_MODIFIED`. Last-write-wins. |
| 13 | **Limpar posição salva** | 🟡 Broadcast `MAP_MODIFIED` removendo posição. Last-write-wins. |
| 14 | **Puxar outros mapas** (combinar mapas) | 🔴🔒 Move feições entre mapas. Servidor executa operação atômica. Broadcast `MAP_MODIFIED` + feições movidas para todos. Permissão de editor em ambos os mapas. |
| 15 | **Trocar mapa ativo** (click no mapa) | 🟢 Ação local de navegação. Awareness opcional: "Usuário X está no Mapa Y". |
| 16 | **Atalhos de mapas recentes** (badges laterais) | 🟢 Ação local de navegação. |

---

## 2. Barra Lateral — Aba Camadas

| # | Ação | Impacto Multiusuário |
|---|------|---------------------|
| 1 | **Adicionar camada** | 🟡 Broadcast `LAYER_CREATED`. UUID do servidor. Outros clientes adicionam camada na lista. |
| 2 | **Deletar camada** (e todas as feições) | 🔴🔒 Operação destrutiva em cascata. Broadcast `LAYER_DELETED`. Clientes com feições dessa camada selecionadas devem limpar seleção. Soft-delete no servidor. Permissão de editor mínima. |
| 3 | **Renomear camada** (double-click) | 🟡 Broadcast `LAYER_MODIFIED`. Last-write-wins. |
| 4 | **Visibilidade da camada** (toggle olho) | 🟡 Broadcast `LAYER_MODIFIED`. Visibilidade é persistida no mapa. Outros clientes atualizam estado visual da camada. |
| 5 | **Bloquear/desbloquear camada** | 🟡🔒 Broadcast `LAYER_MODIFIED`. Permissão de editor. Clientes desabilitam edição de feições nessa camada. |
| 6 | **Definir camada ativa** (radio button) | 🟢 Preferência local. Cada usuário tem sua própria camada ativa. |
| 7 | **Reordenar camadas** (drag & drop) | 🟡 Broadcast nova ordem de renderização. Last-write-wins. |
| 8 | **Expandir/colapsar camada** | 🟢 Estado local da UI. |
| 9 | **Abrir tabela de atributos** | 🟢 Ação local de visualização. Dados são lidos do estado sincronizado. |
| 10 | **Click em feição na lista** — Selecionar e zoom | 🟢 Ação local (seleção + navegação de câmera). Awareness opcional. |
| 11 | **Visibilidade de feição individual** | 🟡 Broadcast `FEATURE_MODIFIED`. Visibilidade é persistida. Outros clientes atualizam estado visual da feição. |
| 12 | **Bloquear/desbloquear feição** | 🟡🔒 Broadcast `FEATURE_MODIFIED`. Outros clientes desabilitam edição dessa feição específica. |
| 13 | **Multi-seleção — ocultar/mostrar em batch** | 🟡 Broadcast `FEATURE_MODIFIED` para cada feição alterada. Last-write-wins. |
| 14 | **Multi-seleção — bloquear/desbloquear em batch** | 🟡🔒 Broadcast `FEATURE_MODIFIED` para cada feição alterada. Permissão de editor. |
| 15 | **Camadas do catálogo — toggle visibilidade** | 🟡 Broadcast visibilidade da referência de catálogo. Outros clientes atualizam. |
| 16 | **Camadas do catálogo — remover** | 🟡 Broadcast remoção de referência de catálogo. |
| 17 | **Seção Modelos 3D** — expandir/colapsar tileset | 🟢 Estado local da UI. |
| 18 | **Seção Modelos 3D** — abrir no visualizador 3D | 🟢 Navegação local no viewer 3D. |
| 19 | **Seção Modelos 3D** — deletar todas as feições do tileset | 🔴🔒 Operação destrutiva em batch. Broadcast deleção de todos os marcadores, medições, viewsheds e orientação salva do tileset. Soft-delete. Permissão de editor. |
| 20 | **Seção Modelos 3D** — click em feição individual | 🟢 Navegação local (fly to marcador/medição/viewshed). |
| 21 | **Seção Street View 360** — expandir/colapsar foto | 🟢 Estado local da UI. |
| 22 | **Seção Street View 360** — abrir no visualizador 360 | 🟢 Navegação local no viewer 360. |
| 23 | **Seção Street View 360** — deletar todas as feições da foto | 🔴🔒 Operação destrutiva em batch. Broadcast deleção de todos os marcadores e orientação salva da foto. Soft-delete. Permissão de editor. |
| 24 | **Seção Street View 360** — click em feição individual | 🟢 Navegação local (abre foto e seleciona marcador/orientação). |

---

## 3. Barra Lateral — Aba Briefings

| # | Ação | Impacto Multiusuário |
|---|------|---------------------|
| 1 | **Criar briefing** | 🟡 Broadcast `BRIEFING_CREATED`. UUID do servidor. |
| 2 | **Deletar briefing** | 🔴🔒 Broadcast `BRIEFING_DELETED`. Soft-delete. Se outro usuário está editando/apresentando, notificar. |
| 3 | **Abrir editor de briefing** | 🟡 Broadcast `BRIEFING_EDIT_STARTED` com userId (awareness). Sem lock — múltiplos usuários podem editar simultaneamente. |
| 4 | **Apresentar briefing** | 🟢 Ação local de visualização. |
| 5 | **Editar slides** (adicionar, remover, reordenar) | 🟡 Broadcast `BRIEFING_UPDATED` com deltas por slide. Last-write-wins por slide. |
| 6 | **Editar conteúdo do slide** (título, texto rico) | 🟡 Last-write-wins por slide. Broadcast `BRIEFING_UPDATED` com conteúdo atualizado do slide ao salvar. |
| 7 | **Configurar câmera do slide** | 🟡 Broadcast atualização do slide. Last-write-wins. |
| 8 | **Vincular modelo 3D ou foto 360 ao slide** | 🟡 Broadcast atualização do slide. Last-write-wins. |

---

## 4. Barra Lateral — Aba Processamento

| # | Ação | Impacto Multiusuário |
|---|------|---------------------|
| 1 | **Selecionar algoritmo** (Buffer, Voronoi) | 🟢 Ação local de UI. |
| 2 | **Configurar parâmetros** | 🟢 Ação local de UI. |
| 3 | **Executar algoritmo** | 🟡 Resultado (novas feições) deve ser persistido via servidor. Broadcast `LAYER_CREATED` + `FEATURE_CREATED` para a camada de resultado. |
| 4 | **Selecionar camada/feições de entrada** | 🟢 Ação local. |
| 5 | **Definir nome da camada de saída** | 🟢 Ação local. |

---

## 5. Barra Lateral — Aba Importar

| # | Ação | Impacto Multiusuário |
|---|------|---------------------|
| 1 | **Importar GeoJSON** | 🟡🔒 Feições importadas são persistidas no servidor. Broadcast `LAYER_CREATED` + `FEATURE_CREATED` em batch. Permissão de editor. |
| 2 | **Importar Shapefile (.zip)** | 🟡🔒 Mesmo padrão. |
| 3 | **Importar KML/KMZ** | 🟡🔒 Mesmo padrão. |
| 4 | **Importar GPX** | 🟡🔒 Mesmo padrão. |
| 5 | **Importar CSV** (com painel de configuração) | 🟡🔒 Mesmo padrão. Configuração de colunas é local, resultado é sincronizado. |
| 6 | **Drag & drop de arquivos** | 🟡🔒 Mesmo que importação normal, apenas via interface diferente. |
| 7 | **Drag & drop de imagem** — cria feição de imagem | 🟡🔒 Upload da imagem para servidor + `FEATURE_CREATED`. |

---

## 6. Barra Lateral — Aba Exportar

| # | Ação | Impacto Multiusuário |
|---|------|---------------------|
| 1 | **Exportar PDF** (com configuração de escala/orientação) | 🟢 Ação local de download. Desabilitado nos modos 3D e 360. |
| 2 | **Exportar Imagem** (screenshot PNG) | 🟢 Ação local. |
| 3 | **Selecionar escala do PDF** | 🟢 Configuração local. |
| 4 | **Selecionar orientação** (paisagem/retrato) | 🟢 Configuração local. |
| 5 | **Selecionar qualidade DPI** (150 rascunho / 200 normal / 300 alta) | 🟢 Configuração local. |
| 6 | **Elementos cartográficos** — toggle título, legenda, barra de escala, seta norte | 🟢 Configuração local. Composição via Canvas 2D antes do GDAL. |
| 7 | **Grades** — toggle grade Lat/Long e grade UTM no PDF | 🟢 Configuração local. |
| 8 | **Preview da área de exportação no mapa** | 🟢 Visual local. |

---

## 7. Toolbar — Ferramentas de Desenho

| # | Ação | Impacto Multiusuário |
|---|------|---------------------|
| 1 | **Ativar ferramenta** (Ponto, Linha, Polígono, Retângulo, Círculo, Elipse, Setor, Texto, Imagem, Pincel) | 🟢 Estado local do tool manager. Awareness opcional. |
| 2 | **Desenhar geometria** (clicks/drag no mapa) | 🟡 Durante o desenho: estado local. Ao completar: `FEATURE_CREATED` via servidor com broadcast para todos. |
| 3 | **Cancelar desenho** (Escape) | 🟢 Ação local. Descarta geometria parcial. |
| 4 | **Configurar estilo** (cor, largura, opacidade) no painel | 🟢 Configuração local que será aplicada à feição ao salvar. |
| 5 | **Azimute e Distância** — adicionar/remover pernas | 🟢 Estado local do painel durante construção. Ao criar/salvar a feição: `FEATURE_CREATED`/`FEATURE_MODIFIED` via servidor. |
| 6 | **Azimute e Distância** — configurar referência (magnético/verdadeiro/quadrícula) | 🟢 Configuração local do painel. |
| 7 | **Azimute e Distância** — definir ponto de referência | 🟢 Estado local do painel durante construção. Faz parte dos dados da feição, sincronizado ao criar/salvar. |

---

## 8. Toolbar — Ferramentas Militares

| # | Ação | Impacto Multiusuário |
|---|------|---------------------|
| 1 | **Símbolo Militar** — selecionar SIDC na hierarquia | 🟢 Configuração local do painel. |
| 2 | **Símbolo Militar** — posicionar no mapa | 🟡 `FEATURE_CREATED` via servidor ao completar. |
| 3 | **Medida de Coordenação** — desenhar gráfico tático | 🟡 `FEATURE_CREATED` via servidor ao completar. |
| 4 | **Seta** — desenhar seta | 🟡 `FEATURE_CREATED` via servidor ao completar. |
| 5 | **Linha de Limite** — desenhar fronteira | 🟡 `FEATURE_CREATED` via servidor ao completar. |
| 6 | **Frente Ocupada** — desenhar frente | 🟡 `FEATURE_CREATED` via servidor ao completar. |

---

## 9. Toolbar — Ferramentas de Análise

| # | Ação | Impacto Multiusuário |
|---|------|---------------------|
| 1 | **Linha de Visada (LOS)** — definir observador e alvo | 🟡 Resultado da análise é uma feição. `FEATURE_CREATED` via servidor. |
| 2 | **Análise de Visibilidade (Viewshed)** — configurar parâmetros | 🟡 Resultado é camada de análise. Broadcast para todos. |

---

## 10. Toolbar — Utilitários

| # | Ação | Impacto Multiusuário |
|---|------|---------------------|
| 1 | **Medir Distância (J)** — medição efêmera no mapa | 🟢 Medição local, não persistida. Opção "Salvar como feição" gera `FEATURE_CREATED` 🟡. |
| 2 | **Medir Área (H)** — medição efêmera no mapa | 🟢 Medição local, não persistida. Opção "Salvar como feição" gera `FEATURE_CREATED` 🟡. |
| 3 | **Medir Ângulo (X)** — medição efêmera de 3 pontos | 🟢 Medição local, não persistida. Sem opção de salvar. |
| 4 | **Informações da Carta (N)** — click em tile vetorial | 🟢 Consulta local de dados do tile. Sem edição. |
| 5 | **Seleção por Retângulo (Q)** — selecionar feições | 🟢 Seleção local. |
| 6 | **Toggle Snap (G)** — ativar/desativar snapping | 🟢 Preferência local de desenho. |

---

## 11. Controles Inferiores

| # | Ação | Impacto Multiusuário |
|---|------|---------------------|
| 1 | **Zoom in (+)** | 🟢 Navegação local. |
| 2 | **Zoom out (-)** | 🟢 Navegação local. |
| 3 | **Tela cheia** | 🟢 UI local. |
| 4 | **Minha localização** (geolocalização) | 🟢 Navegação local. |
| 5 | **Resetar norte** | 🟢 Navegação local. |
| 6 | **Toggle Modelos 3D** | 🟢 Modo de visualização local. |
| 7 | **Toggle Imagens 360°** | 🟢 Modo de visualização local. |
| 8 | **Toggle Terreno** | 🟢 Preferência local de visualização. |

---

## 12. Barra de Busca

| # | Ação | Impacto Multiusuário |
|---|------|---------------------|
| 1 | **Buscar por coordenadas** (DD, DMS, MGRS, UTM) | 🟢 Navegação local. |
| 2 | **Buscar feições locais** por nome | 🟢 Consulta no estado sincronizado. |
| 3 | **Buscar modelos 3D** por nome | 🟢 Consulta local. |
| 4 | **Buscar marcadores 360** | 🟢 Consulta local. |
| 5 | **Buscar lugares** (geocoding API externo) | 🟢 Consulta a API externa, navegação local. |
| 6 | **Voar para resultado** (fly to) | 🟢 Navegação local. |
| 7 | **Criar feição a partir de resultado** | 🟡 `FEATURE_CREATED` via servidor. |

---

## 13. Seletor de Camada Base

| # | Ação | Impacto Multiusuário |
|---|------|---------------------|
| 1 | **Abrir/fechar seletor** | 🟢 UI local. |
| 2 | **Selecionar camada base** | 🟡 Camada base é propriedade persistida do mapa. Broadcast `MAP_MODIFIED`. Last-write-wins. Outros clientes no mesmo mapa atualizam a camada base. |

---

## 14. Menu de Contexto (Right-click / Long-press)

| # | Ação | Impacto Multiusuário |
|---|------|---------------------|
| 1 | **Copiar coordenadas** | 🟢 Clipboard local. |
| 2 | **Orientar para norte** | 🟢 Navegação local. |
| 3 | **Criar grupo** (2+ feições selecionadas) | 🟡 `GROUP_CREATED` via servidor. Broadcast para todos. |
| 4 | **Combinar grupos / Adicionar ao grupo** | 🟡 `GROUP_MODIFIED` via servidor. Broadcast. |
| 5 | **Desagrupar** | 🟡 `GROUP_DELETED` via servidor (feições voltam a ser soltas). Broadcast. |
| 6 | **Mover para camada** (submenu) | 🟡🔒 Muda associação feição→camada. Servidor valida permissões. Broadcast `FEATURE_MODIFIED`. Last-write-wins. |
| 7 | **Mover para mapa** (submenu) | 🟡🔒 Move feições entre mapas. Servidor valida permissões em ambos. Broadcast em ambos os mapas. Last-write-wins. |

---

## 15. Interação Direta com o Mapa

| # | Ação | Impacto Multiusuário |
|---|------|---------------------|
| 1 | **Pan** (arrastar mapa) | 🟢 Navegação local. |
| 2 | **Zoom** (scroll wheel / pinch) | 🟢 Navegação local. |
| 3 | **Rotação** (Ctrl+drag / dois dedos) | 🟢 Navegação local. |
| 4 | **Inclinação (pitch)** (right-click drag / dois dedos) | 🟢 Navegação local. |
| 5 | **Selecionar feição** (click) | 🟢 Seleção local. Awareness opcional. |
| 6 | **Multi-seleção** (Shift+click) | 🟢 Seleção local. |
| 7 | **Multi-seleção touch** (dois dedos tap) | 🟢 Seleção local. |
| 8 | **Desselecionar tudo** (click em área vazia / Escape) | 🟢 Ação local. |
| 9 | **Mover feição** (drag de feição selecionada) | 🟡 Sem lock. Broadcast `FEATURE_MODIFIED` ao soltar (mouseup/touchend). Last-write-wins. Se dois usuários movem a mesma feição, a última posição salva prevalece. |
| 10 | **Editar vértices** (vertex editing) | 🟡 Sem lock. Broadcast `FEATURE_MODIFIED` ao confirmar edição. Last-write-wins para geometria inteira. |
| 11 | **Popup de sobreposição** (feições empilhadas) | 🟢 UI local para disambiguação. |
| 12 | **Drag & drop de arquivo no mapa** | 🟡🔒 Mesmo que importação (ver seção 5). |

---

## 16. Atalhos de Teclado — Operações Globais

| # | Ação | Impacto Multiusuário |
|---|------|---------------------|
| 1 | **Ctrl+Z — Desfazer** | 🟡 Undo por usuário — cada usuário desfaz apenas suas próprias ações. Pilha de undo local. Servidor reaplica operação inversa e faz broadcast. |
| 2 | **Ctrl+Y — Refazer** | 🟡 Redo por usuário. Pilha de redo local. Servidor reaplica e broadcast. |
| 3 | **Ctrl+C — Copiar feições** | 🟢 Clipboard local. |
| 4 | **Ctrl+V — Colar feições** | 🟡 Cria novas feições. `FEATURE_CREATED` via servidor para cada feição colada. Broadcast. |
| 5 | **Delete / Backspace — Deletar seleção** | 🔴🔒 `FEATURE_DELETED` via servidor. Broadcast. Soft-delete para recuperação. Confirmação antes. |
| 6 | **Escape — Desativar ferramenta / Desselecionar** | 🟢 Ação local. |

---

## 17. Painel de Feição (Sidebar Direita)

| # | Ação | Impacto Multiusuário |
|---|------|---------------------|
| 1 | **Editar nome (Nome)** | 🟡 Broadcast `FEATURE_MODIFIED` ao blur/save. Last-write-wins. |
| 2 | **Editar descrição** (rich text Quill.js) | 🟡 Last-write-wins. Broadcast `FEATURE_MODIFIED` ao salvar. Sem edição colaborativa em tempo real. |
| 3 | **Alterar cor de preenchimento** | 🟡 Broadcast `FEATURE_MODIFIED`. Last-write-wins. |
| 4 | **Alterar cor de traço** | 🟡 Broadcast `FEATURE_MODIFIED`. Last-write-wins. |
| 5 | **Alterar opacidade** | 🟡 Broadcast `FEATURE_MODIFIED`. Last-write-wins. |
| 6 | **Alterar largura/tamanho** | 🟡 Broadcast `FEATURE_MODIFIED`. Last-write-wins. |
| 7 | **Toggle visibilidade da feição** | 🟡 Broadcast `FEATURE_MODIFIED`. Visibilidade é persistida. |
| 8 | **Bloquear/desbloquear feição** | 🟡🔒 Broadcast `FEATURE_MODIFIED`. Permissão de editor. |
| 9 | **Configurar padrão hachura** (polígonos) | 🟡 Broadcast `FEATURE_MODIFIED`. Last-write-wins. |
| 10 | **Editar coordenadas** (modal) | 🟡 Sem lock. Broadcast `FEATURE_MODIFIED` ao salvar. Last-write-wins para geometria inteira. |
| 11 | **Adicionar atributo customizado** | 🟡 Broadcast `FEATURE_MODIFIED`. Last-write-wins. |
| 12 | **Editar valor de atributo** | 🟡 Broadcast `FEATURE_MODIFIED`. Last-write-wins por chave de atributo. |
| 13 | **Deletar atributo** | 🟡 Broadcast `FEATURE_MODIFIED`. Last-write-wins. |
| 14 | **Adicionar foto** | 🟡 Upload de imagem para servidor. Broadcast `FEATURE_MODIFIED` com referência à foto. |
| 15 | **Deletar foto** | 🟡 Broadcast `FEATURE_MODIFIED`. Soft-delete da imagem no servidor. |
| 16 | **Reordenar fotos** (drag & drop) | 🟡 Broadcast `FEATURE_MODIFIED`. Last-write-wins para ordem. |
| 17 | **Deletar feição** (ícone lixeira) | 🔴🔒 Mesmo que Delete por teclado. |
| 18 | **Fechar painel** (X) — salva automaticamente | 🟡 Trigger de save das alterações pendentes. |

---

## 18. Tabela de Atributos

| # | Ação | Impacto Multiusuário |
|---|------|---------------------|
| 1 | **Abrir tabela de atributos** | 🟢 Visualização local dos dados sincronizados. |
| 2 | **Ordenar coluna** (asc/desc) | 🟢 Ação local de visualização. |
| 3 | **Filtrar coluna** | 🟢 Ação local de visualização. |
| 4 | **Buscar na tabela** | 🟢 Ação local. |
| 5 | **Editar célula inline** | 🟡 Broadcast `FEATURE_MODIFIED`. Last-write-wins por campo. |
| 6 | **Adicionar coluna de atributo** | 🟡 Adiciona campo a todas as feições da camada. Broadcast em batch. |
| 7 | **Deletar coluna** | 🔴🔒 Remove campo de todas as feições. Operação destrutiva em batch. Confirmação + permissão. |
| 8 | **Selecionar linhas** (checkbox) | 🟢 Seleção local. |
| 9 | **Zoom para feição** | 🟢 Navegação local. |
| 10 | **Deletar feição pela tabela** | 🔴🔒 Mesmo que Delete normal. |
| 11 | **Exportar para CSV** | 🟢 Download local. |
| 12 | **Minimizar / Maximizar / Fechar painel** | 🟢 UI local. |
| 13 | **Redimensionar painel** (drag handle) | 🟢 UI local. |

---

## 19. Catálogo de Camadas Externas

| # | Ação | Impacto Multiusuário |
|---|------|---------------------|
| 1 | **Abrir modal do catálogo** | 🟢 UI local. |
| 2 | **Buscar camadas** | 🟢 Consulta local/servidor. |
| 3 | **Filtrar por tipo** (WMS, Vector Tile, etc.) | 🟢 UI local. |
| 4 | **Adicionar camada ao mapa** | 🟡 Broadcast referência de catálogo adicionada. Outros clientes carregam a mesma camada externa. |

---

## 20. Viewer 3D (Cesium)

| # | Ação | Impacto Multiusuário |
|---|------|---------------------|
| 1 | **Abrir/fechar viewer 3D** | 🟢 Modo de visualização local. |
| 2 | **Navegar na cena 3D** (pan, zoom, rotate) | 🟢 Navegação local. |
| 3 | **Adicionar marcador 3D** | 🟡 Broadcast `MARKERS_3D_CHANGED`. |
| 4 | **Editar marcador 3D** (nome, descrição) | 🟡 Broadcast `MARKERS_3D_CHANGED`. Last-write-wins. |
| 5 | **Deletar marcador 3D** (Delete key) | 🟡🔒 Broadcast `MARKERS_3D_CHANGED`. |
| 6 | **Medir distância 3D** | 🟡 Broadcast `MEASUREMENTS_3D_CHANGED`. |
| 7 | **Medir área 3D** | 🟡 Broadcast `MEASUREMENTS_3D_CHANGED`. |
| 8 | **Deletar medição 3D** | 🟡 Broadcast `MEASUREMENTS_3D_CHANGED`. |
| 9 | **Análise de visibilidade 3D (Viewshed)** | 🟡 Broadcast `VIEWSHEDS_3D_CHANGED`. |
| 10 | **Configurar viewshed** (altura, raio, ângulos) | 🟡 Broadcast parâmetros atualizados. Last-write-wins. |
| 11 | **Deletar viewshed** | 🟡 Broadcast `VIEWSHEDS_3D_CHANGED`. |
| 12 | **Salvar câmera 3D** | 🟡 Broadcast `CAMERA_3D_SAVED`. |
| 13 | **Screenshot 3D** | 🟢 Download local. |

---

## 21. Street View 360

| # | Ação | Impacto Multiusuário |
|---|------|---------------------|
| 1 | **Abrir/fechar viewer 360** | 🟢 Modo local. |
| 2 | **Navegar entre fotos** (click minimap / setas) | 🟢 Navegação local. |
| 3 | **Adicionar marcador 360** | 🟡 Broadcast `MARKERS_360_CHANGED`. |
| 4 | **Editar marcador 360** | 🟡 Broadcast `MARKERS_360_CHANGED`. Last-write-wins. |
| 5 | **Deletar marcador 360** | 🟡 Broadcast `MARKERS_360_CHANGED`. |
| 6 | **Salvar orientação** (direção de visualização) | 🟡 Broadcast `ORIENTATION_360_SAVED`. |
| 7 | **Limpar orientação** | 🟡 Broadcast `ORIENTATION_360_CLEARED`. |
| 8 | **Screenshot 360** | 🟢 Download local. |

---

## 22. Editor de Briefing (Modo Tela Cheia)

| # | Ação | Impacto Multiusuário |
|---|------|---------------------|
| 1 | **Adicionar slide** | 🟡 Broadcast `BRIEFING_UPDATED`. Last-write-wins por slide. |
| 2 | **Remover slide** | 🟡 Broadcast `BRIEFING_UPDATED`. Last-write-wins. |
| 3 | **Duplicar slide** | 🟡 Broadcast `BRIEFING_UPDATED`. |
| 4 | **Reordenar slides** (drag & drop) | 🟡 Broadcast nova ordem. Last-write-wins. |
| 5 | **Editar título do slide** | 🟡 Broadcast `BRIEFING_UPDATED`. Last-write-wins por slide. |
| 6 | **Editar conteúdo do slide** (rich text) | 🟡 Broadcast `BRIEFING_UPDATED`. Last-write-wins por slide. |
| 7 | **Salvar posição de câmera do slide** | 🟡 Broadcast atualização. Last-write-wins por slide. |
| 8 | **Selecionar camada base para slide** | 🟡 Broadcast atualização. Last-write-wins por slide. |
| 9 | **Toggle terreno no slide** | 🟡 Broadcast atualização. Last-write-wins por slide. |
| 10 | **Vincular modelo 3D** | 🟡 Broadcast atualização. Last-write-wins por slide. |
| 11 | **Vincular foto 360** | 🟡 Broadcast atualização. Last-write-wins por slide. |
| 12 | **Preview apresentação** | 🟢 Visualização local. |
| 13 | **Sair do editor** | 🟡 Broadcast `BRIEFING_EDIT_ENDED` (awareness). |

---

## 23. Apresentação de Briefing

| # | Ação | Impacto Multiusuário |
|---|------|---------------------|
| 1 | **Avançar slide** (→, Space, Page Down) | 🟢 Navegação local. |
| 2 | **Voltar slide** (←, Page Up) | 🟢 Navegação local. |
| 3 | **Primeiro slide** (Home) | 🟢 Navegação local. |
| 4 | **Último slide** (End) | 🟢 Navegação local. |
| 5 | **Sair da apresentação** (Escape) | 🟢 Ação local. |
| 6 | **Tela cheia** (F) | 🟢 UI local. |

---

## 24. Modais

| # | Ação | Impacto Multiusuário |
|---|------|---------------------|
| 1 | **Modal de atalhos** — Visualizar atalhos | 🟢 Informação estática. |
| 2 | **Modal de informações** — Ver versão/créditos | 🟢 Informação estática. |
| 3 | **Modal de combinação de mapas** — Selecionar e confirmar | 🔴🔒 Execução é a mesma de "Puxar outros mapas" (seção 1 item 14). |
| 4 | **Modal de edição de coordenadas** — Editar e salvar | 🟡 Mesmo que edição de coordenadas (seção 17 item 10). |
| 5 | **Modal de exportação** — Configurar e exportar | 🟢 Download local. |
| 6 | **Modal de confirmação** — Confirmar ação destrutiva | 🟢 UI local (a ação confirmada tem seu próprio impacto). |
| 7 | **Modal de prompt** — Inserir texto (renomear, etc.) | 🟢 UI local (o resultado tem seu próprio impacto). |

---

## 25. Display de Coordenadas (Canto Inferior Esquerdo)

| # | Ação | Impacto Multiusuário |
|---|------|---------------------|
| 1 | **Trocar formato de coordenadas** (DD, DMS, MGRS, UTM) | 🟢 Preferência local. |
| 2 | **Toggle elevação** | 🟢 Preferência local. |

---

## 26. Grade UTM

| # | Ação | Impacto Multiusuário |
|---|------|---------------------|
| 1 | **Ativar grade Lat/Long** | 🟢 Preferência local de visualização. |
| 2 | **Ativar grade UTM** | 🟢 Preferência local de visualização. |
| 3 | **Desligar grade** | 🟢 Preferência local. |

---

# Resumo de Requisitos para Sistema Multiusuário

## Infraestrutura Necessária

### 1. Autenticação (JWT)
- Login com JWT (access token + refresh token)
- Roles: **Owner** (dono do projeto), **Admin** (gerencia usuários), **Editor** (edita dados), **Viewer** (somente leitura)
- Permissões granulares por projeto e mapa
- WebSocket autenticado com JWT (validação na conexão + revalidação periódica)

### 2. WebSocket Server
- Conexão persistente por usuário por projeto
- Canais/salas por projeto (todos recebem eventos do projeto)
- Sub-canais por mapa (para otimizar tráfego — só recebe eventos do mapa ativo)
- Heartbeat/ping para detecção de desconexão
- Reconexão automática com replay de eventos perdidos (usando Lamport clock já implementado)

### 3. Resolução de Conflitos — Tudo Last-Write-Wins

| Tipo de dado | Estratégia |
|---|---|
| Campos atômicos (nome, cor, estilo) | Last-write-wins com timestamp do servidor |
| Geometria (coordenadas) | Last-write-wins — broadcast ao salvar, sem lock |
| Texto rico (notas, descrições, briefing) | Last-write-wins por entidade (mapa, feição, slide) |
| Listas ordenadas (slides, camadas, mapas) | Last-write-wins para ordem inteira |
| Operações destrutivas (delete) | Soft-delete + broadcast |

### 4. Awareness (Presença) — Opcional
- Cursor/avatar de cada usuário no mapa (posição do mouse)
- Lista de usuários online no projeto
- Indicador de mapa ativo de cada usuário
- Indicador de quem está editando um briefing

### 5. Operações Offline
- Queue de operações local (já implementada em `operation-queue.js`)
- Sync ao reconectar (replay da queue com resolução last-write-wins)
- Indicador visual de "offline" / "sincronizando"

---

## Estatísticas

| Categoria | Total de Ações | 🟢 Local | 🟡 Sync Simples | 🔴 Destrutivo |
|---|---|---|---|---|
| Aba Mapas | 16 | 3 | 9 | 4 |
| Aba Camadas | 24 | 9 | 11 | 4 |
| Aba Briefings | 8 | 1 | 6 | 1 |
| Aba Processamento | 5 | 4 | 1 | 0 |
| Aba Importar | 7 | 0 | 7 | 0 |
| Aba Exportar | 8 | 8 | 0 | 0 |
| Toolbar Desenho | 7 | 5 | 2 | 0 |
| Toolbar Militar | 6 | 1 | 5 | 0 |
| Toolbar Análise | 2 | 0 | 2 | 0 |
| Toolbar Utilitários | 6 | 5 | 1 | 0 |
| Controles Inferiores | 8 | 8 | 0 | 0 |
| Busca | 7 | 6 | 1 | 0 |
| Seletor Camada Base | 2 | 1 | 1 | 0 |
| Menu de Contexto | 7 | 2 | 5 | 0 |
| Interação com Mapa | 12 | 9 | 3 | 0 |
| Atalhos Teclado | 6 | 2 | 3 | 1 |
| Painel de Feição | 18 | 0 | 17 | 1 |
| Tabela de Atributos | 13 | 9 | 2 | 2 |
| Catálogo | 4 | 3 | 1 | 0 |
| Viewer 3D | 13 | 3 | 10 | 0 |
| Street View 360 | 8 | 3 | 5 | 0 |
| Editor Briefing | 13 | 2 | 11 | 0 |
| Apresentação Briefing | 6 | 6 | 0 | 0 |
| Modais | 7 | 5 | 1 | 1 |
| Display Coordenadas | 2 | 2 | 0 | 0 |
| Grade UTM | 3 | 3 | 0 | 0 |
| **TOTAL** | **~218** | **~101 (46%)** | **~103 (47%)** | **~14 (7%)** |

**~46% das ações são puramente locais** — sem necessidade de sync.
**~47% precisam de sync simples** — broadcast + last-write-wins, sem locks.
**~7% são operações destrutivas** — soft-delete + permissão + broadcast.

**Nenhuma ação requer lock.** Toda resolução de conflito é last-write-wins com timestamp do servidor.
