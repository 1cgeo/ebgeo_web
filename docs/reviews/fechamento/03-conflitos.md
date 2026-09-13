# Conflitos de todas as entidades e resolução persistente

Status: pendente; o passo 1 (os quatro buracos de túmulo) fechou em 2026-09-13, e o que ficou está listado abaixo. Prioridade: bloqueia lançamento. Depende de [persistência](02-persistencia.md) e [compatibilidade](01-compatibilidade.md).

## Lacuna

O tratamento de base/revisão está implementado para feições v2 em `backend/src/modules/sync/feature-conflicts.js`. Não há garantia equivalente para todas as entidades colaborativas. A fila possui resultados duráveis e consulta de problemas em `frontend/src/js/store/sync/operation-queue.js`, mas ainda falta a interface que permita ao usuário resolver esses casos de forma persistente.

Revisar também `backend/src/modules/sync/sync.service.js`, `backend/src/modules/sync/sync-receipts.js`, `frontend/src/js/store/sync/remote-operation-handler.js` e `frontend/src/js/store/sync/legacy-queue.js`.

### O que FECHOU em 2026-09-13 (passo 1 do bloco B5)

Os quatro buracos de túmulo, que eram a metade do F8 capaz de apagar ou ressuscitar dado no servidor por gesto comum. Dois commits, os dois só de backend:

1. **A forma array de `catalog_layer`** fazia `deleted_at = NULL` sem cláusula nenhuma no `DO UPDATE`, então uma op ressuscitava toda camada de catálogo apagada cujo id ela nomeasse, com a definição velha do remetente, e o cliente recebia ack de sucesso. O ramo de conflito passou a ter a política de UPDATE que a forma por camada já praticava (`WHERE catalog_layers.deleted_at IS NULL`, sem `deleted_at = NULL`). Guarda: `backend/tests/integration/catalogo-array-nao-ressuscita.repro.test.js`.
2. **`map`, `cesium3d` e `streetview360` recusam update sobre linha excluída**, com motivo, pelo canal de conflito e com o mesmo vocabulário da feição (`RAZAO_EXCLUIDO_NO_SERVIDOR` e irmãs, exportadas de `feature-conflicts.js`). Quem recusa é `tombstoneConflict`, que lê a linha sob a trava de escrita do atlas antes do insert no log; `buildUpdateQuery` ganhou `deleted_at IS NULL` como segunda linha. O create sobre linha existente de 3D e 360 também virou recusa nomeada, no lugar da frase genérica de integridade. Guarda: `backend/tests/integration/update-sobre-tumulo-recusado.repro.test.js`.

Medido revertendo a guarda: um mapa excluído e renomeado por op antiga voltava com o nome novo e `version` 2 para 3, com o túmulo intacto e ack `applied`; a linha 3D idem. Ou seja, a escrita caía e ninguém era avisado.

Duas decisões que a implementação teve de tomar e que quem continuar precisa conhecer:

- **O create de `map` sobre túmulo continua RESSUSCITANDO, de propósito.** É o caminho do desfazer: o Ctrl+Z de uma exclusão reenvia um create com o mesmo id, e `layer`, `group`, `map`, `briefing` e `slide` compartilham esse contrato, cada um asserido em `backend/tests/integration/sync-service-coverage.test.js`. Só 3D e 360 entram na recusa de create, porque eles nunca tiveram esse contrato (o create deles era `ON CONFLICT (id) DO NOTHING`), então nomear a recusa ali não tira capacidade nenhuma.
- **Linha que NÃO EXISTE continua sendo acked como aplicada** num update. Distinguir "nunca existiu" de "existiu e foi-se" exige a revisão durável por entidade do passo 2: o log de operações é expurgável, então ausência não prova nada, e recusar por ausência hoje transformaria todo par create/update fora de ordem numa recusa permanente. O comportamento de hoje está medido no último caso daquele arquivo, para que uma mudança futura apareça.

### O que segue PENDENTE

- **Base observada e revisão por ENTIDADE** (passo 2 do B5): o gate literal por alvo continua lá, e sem base nenhuma dessas entidades detecta "esta escrita é mais velha que o servidor". A forma array de `catalog_layer` continua escrevendo a linha VIVA com o que carrega, porque a tabela não tem versão-base; o replay literal é barrado pelo recibo, o fora de ordem não.
- **O filtro de `deleted_at` no update de `group`, `layer`, `briefing` e `slide`**, que ainda gravam num túmulo. Eles entram junto com a leitura da linha corrente do passo 2, em vez de ganharem quatro guardas especiais agora.
- **Conteúdo do recibo** (passo 3): versão de entidade e operação canônica para toda entidade. Hoje o conflito das três entidades guardadas devolve `serverData: null`, porque elas não têm serializador canônico.
- **Cliente** (passo 4) e **painel de resolução** (passo 5), inteiros.

## Correção

1. Definir a unidade de disputa por entidade: campos independentes, geometria inteira, ordem, hierarquia, membros, slides e referências. Não fundir arrays genericamente.
2. Expandir revisões, bases observadas e tombstones para mapas, camadas, grupos, comentários, slides, catálogo, 3D/360 e configurações compartilhadas. Incluir aliases de metadados aceitos pelo backend. Autorização e detecção de conflito não podem depender da retenção do log de replay.
3. Distinguir aplicado, recusado, conflito e dependência bloqueada. Uma exclusão confirmada não pode ser revertida por edição antiga. Conservar o conteúdo da tentativa e sua identidade.
4. Entregar painel com item, motivo e dependentes, conteúdo local e estado atual permitido. Aceitar servidor remove a tentativa por decisão explícita; reaplicar uma escolha cria nova operação, com nova base observada. Conciliação de geometria requer comparação visual.
5. Incluir filas antigas sem recibo inequívoco. F5, outra aba ou fechamento do toast não podem apagar a pendência. Acesso revogado impede buscar ou mostrar novos dados do servidor.

## Aceite

Dois e três clientes editando campos distintos, o mesmo campo, geometria, ordem e membros; edição versus exclusão; nova edição remota durante resolução; permissão revogada. Repetir após F5 e entre abas. Comparar servidor, fila e projeção. Nenhuma sobrescrita silenciosa e nenhum retry reaproveitando ID com conteúdo diferente. Remover temporariamente o guarda deve tornar a regressão vermelha. Pendências só desaparecem por confirmação comprovada ou decisão autorizada.
