# Cobertura: atributos, tabela de atributos, painel de camadas, grupos e aba Mapas

Branch `hunt/cob-camadas` (a partir de `integracao_backend` c777d8c5), worktree `C:\Users\diniz\ebgeo_hunt\troca-atlas`.
Portas: app 4332, backend 3922. Toda rodada com `--retries=0 --workers=1`, Chromium e Firefox.

Escopo ajustado pelo coordenador: visibilidade e bloqueio (feição, camada, grupo, mapa travado) são da
frente `hunt/cob-bloqueio`; aqui a prioridade 1 é atributos e tabela de atributos.

## Estado

- 05:55 início: enumeração do código e das specs existentes.
- 06:30 primeiro balanço (2 defeitos, 2 specs).
- 08:xx tabela com 300 linhas coberta; tabela só de leitura (Leitor, Comentarista, trava chegando) em correção.

## Matriz

Legenda: **coberto por `<spec>`** (spec aberta e conferida), **defeito `<sha>`**, **LACUNA** (sem spec
ainda), **fora** (outra frente).

### Aba Atributos do painel de feição (`user_data/attributes_tab_renderer.js`)

| item | estado |
|---|---|
| criar pelo ✓ e pelo Enter, cancelar por Escape e ✕, estado vazio (local) | coberto por `cobertura-aba-atributos.spec.js` |
| recusa de chave vazia, com caractere proibido, reservada | coberto por `cobertura-aba-atributos.spec.js` |
| editar valor por Enter e blur; Escape não grava | coberto por `cobertura-aba-atributos.spec.js`; **defeito f90611ff** (Escape GRAVAVA, nos dois editores) |
| renomear chave por Enter; Escape não renomeia | coberto por `cobertura-aba-atributos.spec.js`; defeito f90611ff |
| renomear/criar com chave que já existe | **defeito 642b1aff** (renomear apagava o valor da outra chave; criar trocava o valor, em silêncio); coberto por `cobertura-aba-atributos.spec.js` |
| excluir pela lixeira + F5 (local) | coberto por `cobertura-aba-atributos.spec.js` |
| mapa travado: só leitura | coberto por `cobertura-aba-atributos.spec.js` |
| tipos de valor (texto, número, vazio, acento, longo, "007", "1,5") no Postgres, no colega, na aba do colega e no F5 do colega | coberto por `cobertura-atributos-colaboracao.spec.js` (96dff74e) |
| excluir chega ao servidor e ao colega | coberto por `cobertura-atributos-colaboracao.spec.js` |
| edições cruzadas em chaves diferentes da mesma feição | coberto por `cobertura-atributos-colaboracao.spec.js`. OBSERVAÇÃO levada ao dono pelo coordenador: `properties.attributes` é UMA unidade de disputa; a segunda edição vira disputa guardada para revisão (não perda silenciosa). Não mudar. |
| Leitor: sem criar, editar, excluir | coberto por `cobertura-atributos-colaboracao.spec.js` |
| criar/renomear/excluir com o colega com a MESMA feição aberta na aba | **defeito 2f8ee3b8**: a aba aberta ficava velha (só ouvia a mudança LOCAL); agora acompanha e espera o campo aberto fechar; coberto por `cobertura-atributos-aba-aberta-colega.spec.js` |
| atributos atravessando Ctrl+C/Ctrl+V (cópia independente), "Duplicar Seleção", transferir camada (copiar e mover), F5 (local) | coberto por `cobertura-atributos-travessia.spec.js` (1399ef04); servidor: LACUNA |
| atributos em exportar e reimportar `.ebgeo` e KMZ, F5 | coberto por `cobertura-atributos-travessia.spec.js`; **defeito 1399ef04**: o KMZ descartava o atributo de valor vazio (a chave sumia) |

### Tabela de atributos (`attribute_table/`)

| item | estado |
|---|---|
| abrir, contagem, ordenar por Nome, busca por nome, chip de tipo (3 pontos) | coberto por `attribute-table.spec.js` (pré-existente) |
| F5 com célula aberta e valor mudado | coberto por `tabela-de-atributos-sobrevive-ao-f5.repro.spec.js` (pré-existente na base) |
| 300 linhas vindas de arquivo (5c5005c4): abrir (tempo registrado: 1,5 s Chromium, 0,6 s Firefox), colunas importadas, `id` reservado em `id_importado`, "000" intacto | coberto por `cobertura-tabela-centenas.spec.js` |
| ordenar por atributo numérico (natural), decrescente, terceiro clique | coberto por `cobertura-tabela-centenas.spec.js` |
| buscar por valor com acento, contagem filtrada | coberto por `cobertura-tabela-centenas.spec.js` |
| editar célula de atributo e de Descrição, lidas da store | coberto por `cobertura-tabela-centenas.spec.js` |
| caixa da linha seleciona no mapa; "Apenas selecionadas" | coberto por `cobertura-tabela-centenas.spec.js` |
| CSV (BOM, cabeçalho, uma linha por feição filtrada) | coberto por `cobertura-tabela-centenas.spec.js` |
| ordenação guardada volta depois do F5 | coberto por `cobertura-tabela-centenas.spec.js` |
| Leitor, Comentarista e mapa travado sem botão de tabela | **defeito 79e3b746**: `.map-locked` escondia o botão para os dois eixos; agora a tabela abre só de leitura, com CSV; coberto por `tabela-de-atributos-somente-leitura.repro.spec.js` (3/3 Chromium, 3/3 Firefox) |
| trava chegando com a tabela aberta (célula aberta, "Adicionar atributo", "Remover atributo") | **defeito 79e3b746**: fecha a célula sem gravar e avisa; destravar devolve a edição; coberto pelo mesmo repro |
| adicionar coluna (e recusas), preencher, F5; remover coluna pelo menu com confirmação (cancelar e confirmar), F5 | coberto por `cobertura-tabela-colunas.spec.js`; **defeito 64fcf32d**: remover coluna de 300 feições levava 23 s com 301 redesenhos (agora ~3,5 s, 1 redesenho) |
| Tab entre células (Nome→Descrição, atributo→atributo) | **defeito 7bc4a762**: o redesenho da gravação fechava a célula que o Tab abriu; coberto por `tabela-de-atributos-celula-aberta-no-redesenho.repro.spec.js` |
| Shift+Tab, blur | LACUNA (blur coberto por `cobertura-tabela-centenas.spec.js` indiretamente) |
| selecionar todas, zoom da linha | coberto por `cobertura-tabela-colunas.spec.js` |
| hover (destaque no mapa) | LACUNA |
| redimensionar coluna e painel, minimizar | LACUNA |
| tabela aberta com o colega editando outra feição (redesenho com célula aberta) | **defeito 7bc4a762**: Chromium gravava o valor pela metade no servidor, Firefox perdia calado; coberto pelo mesmo repro (2/2 nos dois navegadores) |
| tabela depois de import com várias camadas | LACUNA |

### Painel de camadas, grupos e aba Mapas

Enumerados; quase nada é clicado pela interface nas specs existentes (renomear, opacidade, reordenar,
excluir com confirmação, catálogo; "Adicionar ao Grupo", "Combinar Grupos", "Desagrupar"; "Puxar outros
mapas", limpar posição salva, renomear por menu, duplicar e excluir local, "Limpar tudo"). Achados de
leitura a provar: handlers do catálogo seguem a intenção e não o resultado; grade sem gate de interface.
Notas do mapa: "Editar" para Leitor/Comentarista e trava chegando com o painel aberto, **defeito PROVADO**
(repro `notas-do-mapa-somente-leitura.repro.spec.js`, 3/3 vermelhos no Chromium), correção ainda não escrita.
Visibilidade e bloqueio: **fora** (`hunt/cob-bloqueio`).

### Linha de base

18 specs existentes da área, Chromium: 45 verdes, 1 vermelho pré-existente:
`base-layer-selector.spec.js` "the key left of 1 cycles basemaps..." (`savedBase` `carta-ortoimagem`
contra `getCurrentBaseLayer` `carta-topografica`), não investigado (fora do escopo; mapa base).

## Specs novos e defeitos

- f90611ff (integrado a168850d) `fix(attributes)`: Escape na aba Atributos gravava o que devia descartar.
- 642b1aff (integrado 4a17e1d3) `fix(attributes)`: renomear/criar com chave existente é recusado.
- 96dff74e (integrado 3c977788) `test(attributes)`: atributos entre dois usuários.
- `cobertura-aba-atributos.spec.js` (no commit do 642b1aff).
- 5c5005c4 `test(attribute-table)`: `cobertura-tabela-centenas.spec.js`, 1/1 Chromium e 1/1 Firefox.
- 64fcf32d `fix(attribute-table)`: remover coluna não redesenha a tabela por feição (23 s para ~3,5 s em 300). Controle negativo feito.
- 2f8ee3b8 `fix(attributes)`: a aba Atributos aberta acompanha a mudança do colega, esperando o campo aberto. Controle negativo feito (dois).
- 1399ef04 `fix(kmz)`: atributo de valor vazio sobrevive ao KMZ de ida e volta (o caso unitário que fixava o descarte, portado do main sem motivo escrito, passou a fixar a regra nova; vetável). Controle negativo feito.
- 7bc4a762 `fix(attribute-table)`: a célula aberta sobrevive ao redesenho (colega editando, Tab). Controle negativo feito.
- 79e3b746 `fix(attribute-table)`: tabela só de leitura para quem não edita; trava chegando fecha a célula e avisa. Controle negativo feito (dois eixos).

## Balanços parciais

- 06:30: dois defeitos na aba Atributos corrigidos com repro e controle negativo; spec de colaboração.
- tarde: 1399ef04 (KMZ perdia atributo vazio), 2f8ee3b8 (aba aberta velha com o colega), 64fcf32d (remover coluna 23 s); travessia de atributos coberta no local.
- ~11:00: tabela com 300 linhas (5c5005c4); dois defeitos da tabela corrigidos (79e3b746 só leitura, 7bc4a762 célula aberta no redesenho), cada um com repro, controle negativo e Chromium+Firefox.

## PRÓXIMO PASSO (exato, para retomar)

Worktree `C:\Users\diniz\ebgeo_hunt\troca-atlas`, branch `hunt/cob-camadas`, HEAD 64fcf32d. PAUSADO a pedido
do coordenador (limite de agentes).

Não commitado (um arquivo novo, sem correção ainda):
`frontend/tests/e2e-ui/notas-do-mapa-somente-leitura.repro.spec.js`. É o repro do defeito das NOTAS DO
MAPA: o painel decide "Editar" só pela trava (`_handleShowCurrentMapNotes`, em
`frontend/src/js/sidebar/tabs/maps.tab.js`), então Leitor e Comentarista recebem "Editar" (a store recusa
o "Salvar", porque `setMapNotes` pergunta `UPDATE_MAP`), e a trava que chega com o painel aberto deixa o
botão lá. MEDIDO no Chromium, sem correção: 3/3 vermelhos, nos pontos certos ("Editar" desenhado para
Leitor e para Comentarista; "a trava chegou e o Editar continuou").

Correção planejada (não escrita):
1. Em `frontend/src/js/sidebar/panels/notes-panel.js`, exportar um ajudante que decida o somente leitura
   das notas de UM mapa: posto por `edicaoIndisponivelSync('UPDATE_MAP')` (motivo 'permissao') e trava
   pelo DISCO, `isMapLocked(mapName)` (regra da casa: ajuste de mapa pergunta pela trava ao disco).
2. Em `frontend/src/js/sidebar/sidebar.control.js`, `_onMapNotesRequested` calcula o somente leitura por
   esse ajudante em vez de confiar no `readOnly` do evento, e assina `assinarEdicaoIndisponivel` para
   redesenhar o painel de notas mostrado (só em modo de leitura, nunca no meio de uma edição, como
   `_onMapNotesChanged` já faz) quando a resposta muda.
3. `_handleShowCurrentMapNotes` passa a emitir só o `mapName`. (`_handleShowMapNotes` não tem chamador.)

Próximos comandos, de dentro de `frontend/`:
- `EBGEO_UI_E2E_APP_PORT=4332 EBGEO_UI_E2E_BACKEND_PORT=3922 npx playwright test tests/e2e-ui/notas-do-mapa-somente-leitura.repro.spec.js --project=chromium --retries=0 --workers=1`
  e o mesmo com `--project=firefox`; controle negativo (tirar a assinatura, tirar o posto); specs vizinhos
  de notas (`grep -l map-notes tests/e2e-ui`); `npm run lint`; `EBGEO_SEM_PESO_CONSTRUIDO=1 npx vitest run`;
  commit `fix(notes)` por caminho com o índice vazio.

Depois:
1. Painel de camadas pela interface: renomear (duplo clique), opacidade, reordenar por arrasto, excluir
   com confirmação, catálogo (adicionar, estilo). Achado de leitura a provar: handlers do catálogo seguem
   a intenção e não o resultado.
2. Grupos pela interface: "Adicionar ao Grupo", "Combinar Grupos", "Desagrupar".
3. Aba Mapas pela interface: "Puxar outros mapas", limpar posição salva, renomear por menu, duplicar e
   excluir local, "Limpar tudo".
4. Tabela: medir a rajada de ops REMOTAS (colega removendo coluna de 300 feições) redesenhando a tabela do
   par uma vez por op, antes de corrigir.
