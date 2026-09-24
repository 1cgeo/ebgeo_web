# Cobertura: ferramentas de desenho e geometria

Branch `hunt/cob-desenho` (a partir de `integracao_backend` em `c777d8c5`). Worktree `C:\Users\diniz\ebgeo_hunt\collab-ferramentas`.
Início: 2026-09-24 05:52. Levantamento dos specs existentes: 06:10 (três varreduras que ABRIRAM cada spec).

## Inventário (do código: `frontend/src/js/tool_manager/tool-registry.js` e `toolbar/toolbar.constants.js`)

| ferramenta | `data-tool-id` | grupo | balde | gesto | alças de edição (código) |
|---|---|---|---|---|---|
| Ponto | point | draw | points | clique | — (arrasto = mover) |
| Linha | line | draw | lines | cliques + direito | vértice, ponto médio, remover (dir.), continuar pela ponta |
| Polígono | polygon | draw | polygons | cliques + direito | vértice, ponto médio, remover |
| Retângulo | rectangle | draw | rectangles | dois cliques (diagonal) | width-resize, height-resize, rotation |
| Círculo | circle | draw | circles | dois cliques | radius |
| Elipse | ellipse | draw | ellipses | dois cliques | horizontal/vertical-resize, rotation |
| Texto | text | draw | texts | clique | rotation |
| Imagem | image | draw | images | arquivo + clique | — (tamanho/rotação só no painel) |
| Pincel | brush | draw | brushes | arraste | — |
| Setor | sector | draw | setores | dois cliques | radius (raio+azimute), aperture |
| Azimute e Distância | azimuthDistance | draw | points/lines/polygons (por modo) | painel de pernas | — |
| Seta | arrow | military | arrows | cliques + direito | vértice, continuar pela ponta; combinar/separar |
| Linha de Limite | boundary | military | boundarys | cliques + direito | vértice, continuar pela ponta; cortar |
| Frente Ocupada | occupiedFront | military | occupied_fronts | dois cliques | vértice |
| Linha de Coordenação | coordinationLine | military | coordination_lines | cliques + direito | vértice, continuar pela ponta |

Etapas: 1 desenhar; 2 editar forma; 3 mover; 4 rotacionar/redimensionar; 5 estilo (cada campo); 6 nome/descrição/atributos;
7 duplicar/colar/colar aqui; 8 excluir; 9 desfazer/refazer; 10 colega vê (atlas de servidor, ferramenta real);
11 F5 nos dois; 12 atlas local.

## Legenda dos specs EXISTENTES (arquivo › caso), conferidos abrindo o spec

- **DP** `drawing-persistence.spec.js` › `${tool}: a real drawing is stored, displayed and preserved after reload` (local, ferramenta real, reload de UM cliente; 13 das 15 ferramentas, sem imagem e azimute).
- **DS/DMS/DLR/DF** `drawing-delayed-save`, `drawing-delayed-map-switch`, `drawing-delayed-layer-removal`, `drawing-*-duplicate-finish` (local, bordas do desenho).
- **AT** `browser-collab-all-types.spec.js` (servidor, 2 navegadores, mas a feição nasce por `store.addFeature`, não pela ferramenta; só ponto/polígono/símbolo pela barra).
- **SEL** `browser-collab-selection-tools.spec.js` (seleção remota; feição criada por op de store).
- **C1..C27, L1..L8, A1..A4**: códigos da varredura de ponto/linha/polígono (lista completa no fim).
- **CL1..CL4** `browser-collab-conversao-linear.spec.js`; **CD** `corte-da-divisa-pelo-menu.spec.js` (local); **CMB** §14.10/14.11 (API).
- **IMG**: `figura-aparece-na-hora-em-link-lento`, `imagem-reencodada-gif-bmp`, `browser-collab-colar-imagem`, `browser-collab-imagem-retomada`.
- **AZ**: `drawing-delayed-azimuth`, `drawing-duplicate-azimuth` (local).

## Specs NOVOS desta campanha

Todos rodados em série com `--retries=0`, dois usuários (A dono, B editor) num atlas de servidor salvo o CL, e cada passo
afirmado no Postgres e no store de B; cada caso fecha com F5 nos dois e A, B e o servidor iguais campo a campo.

- **CE** `cobertura-desenho-estilo.spec.js` › `estilo de <tool>: ...` (`333e52eb`, ampliado depois). Cada controle da aba
  Estilo, RELENDO a aba a cada volta (o controle que só aparece depois de outro mudar, como as sub-opções da hachura, também
  entra), com os tipos deslizante, alternância, seleção, cor, tracejado, alinhamento, hachura, numérico, texto e seletor de
  marcador. 110 campos nas 13 ferramentas. Reprova campo cujo Salvar não grava nada.
- **CC** `cobertura-desenho-ciclo.spec.js` (`ee88389d`): nome, descrição, atributo, mover pelo corpo, Ctrl+C/V, excluir,
  desfazer, refazer, F5 nos dois. 13/13.
- **CL** `cobertura-desenho-local.spec.js` (`ee88389d`): o mesmo ciclo num atlas local anônimo. 13/13.
- **CF** `cobertura-desenho-forma.spec.js` › `forma de <tool>: cada alca edita, ...`: os tipos de alça descobertos no DOM (fonte
  `alcaDeEdicao` do registro), um arraste de cada; ponto médio insere vértice, botão direito remove; continuar pela ponta
  (linha, seta, limite, linha de coordenação). 11/11 (as 11 ferramentas com alça). Tabela medida:
  line: ponto médio 3→4, vértice, remover 4→3, ponta 3→4; polygon: ponto médio, vértice, remover; rectangle: largura, altura,
  rotação; circle: raio; ellipse: eixo horizontal, eixo vertical, rotação; text: rotação; sector: raio, abertura; arrow:
  cabeça, largura, ponto médio, vértice, remover, ponta; boundary: ponto médio, tamanho, símbolo, vértice, remover, ponta;
  occupiedFront: p1, p2, p3; coordinationLine: ponto médio, vértice, remover, ponta.
- **CA** `cobertura-desenho-abas.spec.js` › `abas de <tool>: cada campo fora da aba padrao ...`: as abas que a Estilo padrão não
  abre, descobertas no DOM: Etiqueta (ponto e as quatro formas com área), Caixa de Fundo (texto), Azimutes (observação por
  perna, linha e polígono) e Coordenadas (retângulo e seta, só leitura). 63 linhas de tabela, 13/13. O instrumento NOMEIA o
  que não sabe exercitar; sobra, declarado: os botões NM/NV e "Copiar coordenada" (lentes e área de transferência, não
  propriedade), o ✕ de remover uma repetição de escalão do limite e os botões "Preencher com coordenadas" / "Preencher com
  área" (este último exercitado só na elipse, pelo repro do defeito abaixo).
- **CM** `cobertura-desenho-menu.spec.js` › `menu de <tool>: copiar, colar aqui e duplicar selecao ...`: pelo botão direito,
  "Copiar Feição" sobre o corpo e "Colar Aqui (1)" num ponto vazio; com a original selecionada, "Duplicar Seleção". F5 nos dois
  com as três feições iguais ao servidor.
- **Censo** `tests/unit/cobertura-desenho-lista.test.js`: a lista `FERRAMENTAS` acompanha a barra, e balde e fonte de alça
  batem com `tool-registry.js`.
- Vermelhos do INSTRUMENTO, cada um medido e consertado no spec com o motivo escrito ao lado: o painel cobria a pega da linha
  (`trazerParaAreaLivre`); colar seleciona a cópia e esconde a árvore (Escape antes de `deleteFeatureUI`); o `handleId` de
  linha, polígono e seta traz índice (`vertex-0`), então o tipo tira o índice; a Etiqueta só desenha os campos com "Mostrar
  Etiqueta" ligado (a aba é relida a cada volta); o Salvar mora na aba Estilo (a observação por perna salva de lá); com o
  painel aberto a árvore pode estar desmontada e "Camadas" a FECHA (Escape antes); a sub-aba mora dentro da Estilo e o
  painel reabre na última aba de fora (abre a Estilo antes); o formato de coordenadas e o NM/NV são lentes de exibição; e o
  texto é camada de símbolo, cujo índice de colisão só volta no quadro seguinte ao deslocamento (espera o mapa ocioso).
- Auditoria estática da classe do `333e52eb` (propriedade escrita pelo painel e ausente de `hasFeatureChanged`) nas 18
  pastas de ferramenta: nenhuma outra ocorrência nesta área.

## Matriz (estado em 09:20)

Legenda: ✅ coberto (spec e caso nomeados); ◐ parcial (dito o que falta); ✗ LACUNA; n/a (a ferramenta não tem a etapa).
Códigos novos: **CE** estilo, **CC** ciclo com o par, **CL** ciclo local, **CF** forma pelas alças, **CA** abas fora da padrão,
**CM** menu de contexto. Cada código cobre a ferramenta pelo caso `<etapa> de <id>` do spec.

- Colunas 10 (o par vê) e 11 (F5 nos dois) valem em TODO spec de servidor novo (CE, CC, CF, CA, CM): cada passo é afirmado
  no Postgres e no store de B, e o F5 dos dois fecha cada caso.
- Coluna 6 (nome, descrição e atributo): ✅ CC para as 13 ferramentas de `FERRAMENTAS`.
- Coluna 3 (mover pelo corpo): ✅ CC e CL para as 13.
- Colunas 8 (excluir) e 9 (desfazer/refazer): ✅ CC e CL para as 13 (exclusão da cópia colada; desfazer a devolve, refazer a
  tira de novo). Desfazer de EDIÇÃO (estilo, forma) não está coberto por spec desta campanha: ◐.
- Coluna 7: Ctrl+C / Ctrl+V ✅ CC e CL para as 13; "Colar Aqui" e "Duplicar Seleção" pelo menu: CM (em obra).

| ferramenta | 1 desenhar | 2 forma (alças) | 4 rot/redim | 5 estilo | 5b outras abas | 7 menu | 12 local |
|---|---|---|---|---|---|---|---|
| point | ✅ DP, CE | n/a (sem alça) | n/a | ✅ CE | CA (Etiqueta) em obra | CM em obra | ✅ CL, DP |
| line | ✅ DP, C1, CE | ✅ CF: ponto médio insere, vértice move, botão direito remove, ponta continua | n/a | ✅ CE | CA (Azimutes/observações) | CM | ✅ CL |
| polygon | ✅ DP, C5 | ✅ CF: inserir, mover, remover | n/a | ✅ CE | CA (Etiqueta, Azimutes) | CM | ✅ CL |
| rectangle | ✅ DP | ✅ CF | ✅ CF (largura, altura, rotação) | ✅ CE | CA (Etiqueta, Coordenadas) | CM | ✅ CL |
| circle | ✅ DP | ✅ CF | ✅ CF (raio) | ✅ CE | CA (Etiqueta) | CM | ✅ CL |
| ellipse | ✅ DP | ✅ CF | ✅ CF (eixos, rotação) | ✅ CE | CA (Etiqueta) | CM | ✅ CL |
| text | ✅ DP | n/a | ✅ CF (rotação) | ✅ CE | CA (Caixa de Fundo) | CM | ✅ CL |
| brush | ✅ DP | n/a (sem alça) | n/a | ✅ CE (defeito 333e52eb) | — | CM | ✅ CL |
| sector | ✅ DP | ✅ CF | ✅ CF (raio/azimute, abertura) | ✅ CE | CA (Etiqueta) | CM | ✅ CL |
| arrow | ✅ DP | ✅ CF: inserir, mover, remover, ponta; largura e cabeça | ✅ CF (largura, cabeça) | ✅ CE (+ Largura numérica na rodada nova) | CA (Coordenadas) | CM | ✅ CL |
| boundary | ✅ DP | ✅ CF: inserir, mover, remover, ponta; tamanho e símbolo | ✅ CF | ✅ CE (defeito 333e52eb; rótulos de texto na rodada nova) | — | CM | ✅ CL |
| occupiedFront | ✅ DP | ✅ CF (p1, p2, p3) | n/a | ✅ CE | — | CM | ✅ CL |
| coordinationLine | ✅ DP | ✅ CF: inserir, mover, remover, ponta | n/a | ✅ CE | — | CM | ✅ CL |
| image | ✅ IMG | n/a | n/a (painel) | ✗ fora de `FERRAMENTAS` | — | ◐ API | ✅ IMG |
| azimuthDistance | ✅ AZ (local) | n/a | n/a | ✗ | — | ✗ | ◐ AZ |

A matriz antiga (06:15, antes dos specs novos) foi substituída por esta; as lacunas que ela listava por ferramenta nas colunas
3, 6, 7 (Ctrl+V), 8 e 9 estão fechadas pelos códigos acima.

## Defeitos

- **`333e52eb` fix(tools): brush zoom correction and boundary opacity are saved on their own.** Mudar só a "Correção de Zoom"
  do pincel, ou só a "Opacidade" da linha de limite, e clicar Salvar não gravava nada (a escolha se perdia, ou pegava carona na
  gravação seguinte). Causa: `hasFeatureChanged` de cada controle é lista escrita à mão e não nomeava `zoomCorrectionEnabled`
  (pincel) e `opacity` (limite). Prova: CE vermelho antes, 13/13 verde depois. Classe: 18 controles têm `hasFeatureChanged`
  manual; o CE cobre a aba Estilo de todos, mas NÃO as abas Etiqueta (`label`), Caixa de Fundo do texto (`background`),
  observações por perna (aba Azimutes de linha/polígono) nem textareas (rótulos do limite).

- **`ee0eeadc` fix(ellipse): medidas da elipse na unidade certa.** A elipse guarda `majorRadius`/`minorRadius` em
  QUILÔMETROS (`turf.ellipse` com `units: 'kilometers'`), e o painel da feição e o botão "Preencher com área" da Etiqueta os
  liam como METROS, como leem o raio do círculo e do setor. Uma elipse de 3,39 km aparecia como "Semi-eixo maior: 3,39 m",
  "Área: 21,68 m²", "Perímetro: 17,31 m", e o botão escrevia "21.7 m²" na etiqueta de uma área de 21,675 km². Achado pelo CA
  (instantâneo da página). Conserto: `ellipseMetricsInMeters` em `measurement_tool/measurement-geometry.js` (arquivo que os
  dois consumidores já importavam; um módulo novo subia o grafo ansioso do mapa de 23 para 24 em `draw_tools` e o teto de
  peso reprovava). Prova: `tests/e2e-ui/elipse-medidas-no-painel.repro.spec.js` vermelho antes ("3,39 m"), verde depois
  ("3,39 km"); controle negativo do botão (só o painel da elipse revertido): "21.7 m²" contra "21.675 km²". Mais
  `tests/unit/elipse-medidas-em-metros.repro.test.js` (regra pura com bordas e o censo dos dois consumidores).

## PRÓXIMO PASSO (exato, para retomar; estado da PAUSA pedida pelo coordenador)

Worktree `C:Usersdinizebgeo_huntcollab-ferramentas`, branch `hunt/cob-desenho`, HEAD `ee0eeadc`. Commits desta
campanha: `333e52eb` (fix pincel/limite + CE + censo), `ee88389d` (CC + CL), `ee0eeadc` (fix elipse + dois repros).
Portas 4333 e 3923 livres (nenhum processo meu de pé).

NÃO commitados (na worktree, sem stash):
- `frontend/tests/e2e-ui/cobertura-desenho-estilo.spec.js` (M): a aba é relida a cada volta (`proximoCampo`).
- `frontend/tests/e2e-ui/helpers/cobertura-desenho.js` (M): tipos `numerico`, `texto`, `simbolo`, `perna`; `abaEstilo` e
  `mudarCampo` recebem a aba; `controlesDesconhecidos`, `proximoCampo`, `chaveDoCampo`.
- `frontend/tests/e2e-ui/helpers/cobertura-desenho-ciclo.js` (M): `trazerParaAreaLivre` espera o mapa ocioso depois do
  `panBy` (sem isso o texto, camada de símbolo, não é achado pelo menu de contexto).
- Novos: `cobertura-desenho-forma.spec.js`, `helpers/cobertura-desenho-forma.js`, `cobertura-desenho-abas.spec.js`,
  `cobertura-desenho-menu.spec.js`.

O que já foi medido com o estado ATUAL dos arquivos: CA 13/13 e CM 12/13 (o texto reprovou antes do conserto da espera ociosa;
a sonda depois do conserto achou o texto nos 6 pontos), repro da elipse verde. A última rodada completa, depois da espera
ociosa, chegou a 3 vermelhos antes de eu pará-la pela pausa, e NENHUM foi investigado ainda:
1. `forma de text`: "alcas desenhadas que nao editam nada" (a rotação do texto passou em duas rodadas anteriores).
2. `ciclo local de ellipse` e 3. `ciclo local de text`: "refazer: a copia nao saiu" (CL passou 13/13 em `ee88389d`, antes da
   espera ociosa). Suspeita a medir, não a afirmar: a espera nova muda o tempo entre excluir, desfazer e refazer; ou corrida
   real da pilha de desfazer.
Log dessa rodada: `/tmp/cob-final.log` (Git Bash). CE, CC e o resto do CF e do CL daquela rodada tinham passado até ali.

Próximos comandos, de dentro de `frontend/`, sempre em background:
`EBGEO_UI_E2E_APP_PORT=4333 EBGEO_UI_E2E_BACKEND_PORT=3923 npx playwright test cobertura-desenho-local -g "(ellipse|text):" --retries=0 --workers=1 --repeat-each=3`
(para medir a taxa do "refazer"), depois o mesmo para `cobertura-desenho-forma -g "text:"` e `cobertura-desenho-menu -g "text:"`.
Vermelho de produto vira repro + conserto + controle negativo + commit `fix(...)`; do instrumento, ajuste no spec com o
motivo. Com tudo verde: lint e vitest do frontend, e commit `test(cobertura)` com os arquivos acima.

Fora da área e declarado: imagem (refazer e F5 nos dois) e azimute e distância (tudo além do desenho local).

## Legenda completa das varreduras

(ver mensagens das varreduras; transcrita aqui ao fechar a matriz)
