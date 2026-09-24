---
paths:
  - "frontend/src/js/draw_tools/**"
  - "frontend/src/js/military_tools/**"
  - "frontend/src/js/measurement_tool/**"
  - "frontend/src/js/tool_manager/**"
  - "frontend/src/js/snapping/**"
  - "frontend/src/js/store/feature-type.registry.js"
  - "frontend/src/js/store/store.constants.js"
  - "frontend/tests/unit/registro-tipos-*.test.js"
---

# Ferramentas de desenho e tipos de feição

Ferramenta nova começa pela skill `new-tool`, que tem a receita inteira (inclusive os quatro sítios de `map_sig.js`).

## Registro de tipo de feição

Desde 2026-08-16 um tipo de feição **nasce em um lugar só**: `frontend/src/js/store/feature-type.registry.js`, uma linha por tipo (decisão em [`../../docs/decisions/decisions-2026.md`](../../docs/decisions/decisions-2026.md), com a alternativa recusada por extenso). O `fileoverview` daquele arquivo é a fonte: o que segue é só o que morde quem escreve código sem abri-lo.

- **Não acrescente tipo em `store.constants.js`.** As seis constantes de tipo de lá (`FEATURE_TYPE_ICONS`, `FEATURE_TYPE_MAPPINGS`, `FEATURE_DISPLAY_NAMES`, `UNCOPYABLE_FEATURE_TYPES`, `IMAGE_RESOURCE_FEATURE_TYPES` e o `SOURCE_TYPES` privado) são **derivadas** do registro, com uma passada cada, e mantêm nome, forma e ordem de chave. Nenhum consumidor mudou.

- **Duas propriedades do arquivo são contrato, não estilo:** ele tem **zero imports** (é o que o mantém carregável em node puro sem resolução de alias) e fica **fora dos dois barrels** do store (`store/index.js` e `store/store.js`), porque barrel de store arrasta a store inteira. As duas são asseridas por `frontend/tests/unit/registro-tipos-feicao.test.js`.

- **Rótulo e ícone nulos são um estado legítimo**, não linha pela metade: as duas saídas de processamento (`processed_los`, `processed_visibility`) são desenhadas e nunca nomeadas. Dar rótulo a elas as faz aparecer na aba de feições, na legenda do PDF e na seleção por caixa. As três derivações são independentes de propósito (`label !== null`, `icon !== null`, `selectable`).

- **As listas periféricas NÃO foram migradas**, e essa é a parte que envelhece se não for lida: hoje **dois** arquivos derivam do registro, `store.constants.js` e, desde 2026-09-24, `frontend/src/js/utilities/feature_navigation_utils.js`, migrado pelo bug que a cópia à mão causava (medida de coordenação e símbolo de engenharia centralizavam em zoom 15 em vez de enquadrar como o símbolo militar). **Um campo do registro se preenche lendo o CONTROLE, nunca uma lista**: o `selectionBox` daqueles dois tipos foi escrito copiando a lista errada, e o teste de paridade prendia uma cópia à outra. Os demais estão **censados**, com motivo escrito, em `frontend/tests/unit/registro-tipos-cobertura.test.js`, cujo inventário vem de `git ls-files` e não de alvos escritos à mão. Os que se declaram completos são cobrados como tais, e a lista deles é NOMEADA num caso absoluto daquele arquivo: acrescentar linha ao registro e não tocar em mais nada os deixa vermelhos numa mensagem só. Naquela data `store/repositories/local.repository.js` saiu do censo, porque o documento de mapa vazio dele passou a derivar do de `frontend/src/js/store/repository.utils.js`: uma lista periférica a menos.

- **O censo registra buraco conhecido, e cinco entradas dizem isso em voz alta** (a declinação magnética some da legenda do PDF, em duas entradas, uma na aba e outra no desenho da legenda, e falta também nos ícones do celular; setor E declinação faltam nos rótulos de agrupar por tipo e no chip de ferramenta ativa). Cada um migra no commit do **bug que causa**, com repro próprio, nunca por arrumação.

## Measurement Tools

`measurement_tool/` é a exceção ao padrão de 3 arquivos: as ferramentas de medição são EFÊMERAS (não persistem no store), então não têm `add_*_control` + geometria + painel de atributos. Não use a skill `new-tool` para elas. Distância e área ganham um "Salvar como feição" que é o único caminho até o store.

## Point Label

O que não se deduz lendo as props: a etiqueta de ponto tem correção de zoom (`labelZoomCorrectionEnabled`, `labelCreatedAtZoom`, `labelCalculatedSize`), cujo objetivo é manter o tamanho VISUAL constante enquanto o zoom muda. Mexer em tamanho de etiqueta sem entender isso produz texto que cresce junto com o mapa. A aba "Etiqueta" é montada por `tool_manager/helpers/label-tab.helpers.js`, compartilhada, não copiada por ferramenta.

## Continuar uma feição linear pela ponta

Linha, seta e limite ganharam uma alça clicável no primeiro e no último vértice que reabre a própria ferramenta continuando a MESMA feição (`tool_manager/helpers/line-extension.model.js`, puro, e `line-extension.helpers.js`, impuro). O que não se lê no código:

- **A alça ANDA PRESA à alça de vértice, e isso é a decisão de afordância, não uma economia.** Ela é ligada em `createEditHandles` e recolhida em `clearEditHandles`, nos três controles. O POSTO some, com `checkPermission(GuardAction.UPDATE_FEATURE)` como primeira pergunta de `extensionDenialReason`. O ESTADO não ganha comando novo, e a razão é que os dois estados reversíveis já apagam a alça de VÉRTICE antes: `selectFeature` não chama `createEditHandles` com o mapa travado, e feição bloqueada não se seleciona. Desenhar ali uma alça de continuação com `aria-disabled` seria inventar a única superfície acionável de uma tela que o produto escolheu deixar inerte. O que o estado ganha é a RECONSULTA do mesmo predicado dentro de `startExtending`, porque o par pode travar o mapa com a alça já na tela, e é nesse caminho que a recusa nomeia o estado.

- **A ordem das escritas de `finishExtending` é o INVERSO da dos outros caminhos de edição dos mesmos três arquivos, e a inversão é o ponto.** Eles pintam a fonte do MapLibre e depois gravam; ela gateia, grava, RELÊ por `getFeatureById` e só toca a fonte se o eixo relido casar com o pedido (`storedSpineMatches`). O motivo é que `updateFeature` devolve `undefined` também no SUCESSO, então não há retorno que distinga gravado de recusado, e a recusa por posto ou por trava não lança: pintar antes deixaria na tela uma continuação que nada persistiu, e o `catch` que a republicaria nunca rodaria. Com a releitura no meio, a fonte só mostra o que a store confirmou e o ramo de republicação deixa de existir.
