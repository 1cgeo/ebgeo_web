# Finalização de desenho

Concluir um desenho atravessa vários `await` antes da gravação, e tudo o que a ferramenta decide sobre o DESTINO é capturado antes do primeiro deles, nunca lido depois.

## O mundo muda enquanto a ferramenta espera

Entre o clique que conclui e a escrita na store há espera de verdade: o nome gerado por `generateFeatureName`, o bitmap do símbolo militar, a leitura e o redimensionamento do arquivo de imagem, o processamento da visada e da visibilidade. A versão anterior lia mapa, camada e ferramenta ativa DEPOIS dessas esperas, e a auditoria de lançamento (2026-09-22) reproduziu em navegador real, com a espera segurada pelo teste, um defeito por gesto possível no intervalo: trocar de mapa mandava o desenho para o mapa novo; trocar de ferramenta esvaziava a geometria da anterior; excluir a camada gravava a feição com um `layerId` que não existe mais, e ela ficava invisível; travar o mapa deixava na fonte do MapLibre uma feição que a store recusou; concluir duas vezes, ou salvar a medição duas vezes, gravava duas feições sobrepostas.

Nenhum desses caminhos lança erro, e é por isso que eles passaram tanto tempo sem acusação.

## O contrato: `captureFeatureCreation`

`captureFeatureCreation` (`frontend/src/js/tool_manager/helpers/feature-creation-context.js`) roda antes do primeiro `await` e congela o escopo ativo, o ID do mapa (nunca o nome, que o rename de um par muda no meio), a camada ativa, o zoom e a ativação da ferramenta (`_activationId`). Ele separa três perguntas que a versão anterior tratava como uma só, e confundi-las é o erro que uma ferramenta nova vai cometer:

- **Pode gravar?** (`canSave`) Só o ATLAS é condição: trocar de atlas recusa com aviso, porque gravar num escopo que não é mais o ativo é escrever no banco de outro atlas. Trocar de MAPA dentro do mesmo atlas não recusa, e o desenho vai para o mapa original, pelo ID.
- **Pode pintar?** (`isCurrent`) Só se o mapa original ainda é o que está na tela. Fora dele a feição está gravada e a pintura é pulada, porque a fonte do MapLibre é a do mapa corrente.
- **Pode selecionar e desativar?** (`finish`) Só se a MESMA ativação continua de pé e nenhuma paleta foi aberta no intervalo. Uma ativação nova (outro desenho começado, outra ferramenta escolhida) não é desativada e não tem a seleção roubada.

## Gravar, conferir, e só então pintar

A ordem é gravar, reler o resultado de `addFeature` e só então tocar a fonte. `addFeature` devolve `undefined` na recusa por posto, por trava ou por mapa inexistente, e não lança, então a ordem antiga (pintar e depois gravar) deixava na tela um desenho que nada persistiu. É a mesma inversão que a alça de continuação de linha já fazia, pelo mesmo motivo, descrita em [`architecture.md`](../../.claude/rules/architecture.md) na seção "Continuar uma feição linear pela ponta".

## A camada que some no meio

`saveCreatedFeature` confere a camada capturada no instante da gravação. Se ela foi excluída durante a espera (por um par, ou pela própria pessoa), a feição vai para outra camada destravada do mesmo mapa, preferindo a visível, e o aviso nomeia a camada escolhida; sem camada disponível, recusa com aviso. Só mudar a camada ATIVA durante a espera não redireciona nada, porque a capturada continua válida, e o spec de camada cobre os dois casos, excluída e inativa, em oito ferramentas.

A análise de visibilidade tem uma consequência própria: as feições derivadas nascem DEPOIS da gravação do objeto principal, para herdar a camada final dele. Geradas antes, elas guardavam a camada excluída enquanto o principal era recuperado, e o resultado era um objeto visível com a sua análise invisível.

## Conclusão duplicada se guarda por ATIVAÇÃO

Linha, polígono, seta, limite, linha de coordenação e azimute guardam a conclusão pendente em `_pendingCreations`, e as duas medições em `_pendingSaves`, conjuntos chaveados pela ativação. A guarda por ferramenta seria mais simples e impediria começar e concluir o desenho seguinte enquanto o anterior grava; a guarda por ativação recusa só o segundo Enter do MESMO gesto. Nas ferramentas militares a geometria é copiada antes da espera, porque o gesto seguinte reusa `drawPoints` e substituiria o traçado ainda não gravado.

## Armadilhas

- **Nada acusa uma ferramenta nova que chame `addFeature` direto.** Não há censo que cobre o uso do contexto (a única citação dele em teste é a conta de grafo do teto de peso), então a ferramenta nasce com todas as janelas acima abertas e com a suíte verde. A skill `new-tool` manda usar o contexto; o que segura é a leitura.
- **O clique físico na barra lateral não alcança a troca de mapa durante a visibilidade**, porque o modal de progresso bloqueia o ponteiro. Os specs de análise trocam de mapa pela operação real da store e dizem isso no cabeçalho, em vez de fingir um gesto que a pessoa não consegue fazer.
- **As medições são efêmeras** e usam o contexto só para o "Salvar como feição", que é o único caminho delas até a store.

As provas em navegador real, nos dois navegadores, são as `drawing-*.spec.js` e `measurement-*-save.spec.js` de `frontend/tests/e2e-ui/`; por exemplo, `frontend/tests/e2e-ui/drawing-delayed-layer-removal.spec.js` segura o nome, exclui a camada e confere destino e persistência depois de recarregar.

## Ver também

[[diario-write-ahead]] para o que acontece depois que a ferramenta chama a store; [[camada-padrao-remota]] para a camada que nasce no servidor; [[viewshed-3d]] para a outra análise que espera o motor antes de gravar.
