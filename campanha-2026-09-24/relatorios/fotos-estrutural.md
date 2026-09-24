# Fotos anexas: desenho da fase estrutural (fase 2)

Autor: frente rede, 2026-09-24. Fase 1 (compressão) commitada em `c7561c98`, no branch `hunt/fotos` (a partir de `integracao_backend` c777d8c5). Este documento é o desenho da fase 2 e **não foi implementado**: espera o ok do coordenador.

## 1. O problema, medido

As fotos anexas vivem como data URL dentro da entidade: em `properties.images[]` na feição, e em `images[]` no marcador 3D e no marcador 360, sempre com `{ id, name, type, size, data, thumbnail, addedAt }`. Isso tem quatro consequências.

- Toda edição da entidade reenvia o array inteiro, e em dobro. Medido antes da fase 1: foto de câmera de 4,96 MB, guardada com 710 KB, gera um push de 1,43 MB. Depois da fase 1: 228 KB guardados e push de 463 KB.
- Acima de 10 MB por op, a edição nunca sincroniza. Com a fase 1 isso passa a exigir mais ou menos 20 fotos numa única feição, mas continua possível.
- O retrato (snapshot) e o `.ebgeo` carregam todas as fotos inline. Por isso o `app.js` do backend já teve de abrir a exceção de 50 MB para o começo do import atômico (`IMPORT_BEGIN_PATH`).
- Num link de 40 kbps, cada edição de atributo de uma feição com fotos custa o peso das fotos.

## 2. O desenho

**A foto passa a ser um BLOB com id, exatamente como a feição de imagem já é, e a entidade guarda só a referência e a miniatura.**

- **Onde o byte mora:**
  - no cliente, `ebgeo_images` do escopo, sob o id da foto (`storeImage` e `getImage` de `store/settings.operations.js`; `getImage` já cai no servidor por `fetchImageBlob`);
  - no servidor, uma linha na tabela `images`, com escopo de atlas, gravada pela rota bulk que PRESERVA o `localId` (`images.service.js`, `bulkUploadImages`), a mesma que a fila durável usa.
- **Novo formato do item de foto:** `{ id, name, type, size, thumbnail, addedAt, width, height }`.
  - `data` sai.
  - A `thumbnail` (cerca de 2 KB) CONTINUA inline. É ela que garante que a galeria nunca mostra buraco, nem para quem acabou de receber a op nem offline.
- **Como o byte viaja:** pela fila durável de blob que já existe (`store/sync/blob-upload-queue.js`), com os mecanismos que ela já tem:
  - `registrarBlob` antes de gravar a entidade;
  - `enviar()` depois do save e `descartar()` quando o save é recusado;
  - prazo proporcional ao corpo, transferência única por id e reserva de id;
  - retomada no connect, na volta a ONLINE e com a conexão de pé.
- **DIFERENÇA DELIBERADA em relação à feição de imagem: a op da entidade NÃO espera o blob.**
  - Na feição de imagem, a op espera porque, sem os bytes, o mapa do colega desenha o placeholder no lugar da figura (um buraco).
  - Na foto, a entidade já leva a miniatura, e a foto inteira só é pedida quando alguém abre o visualizador.
  - Segurar a op seria trocar um buraco inexistente por retenção de cabeça de fila: toda edição da feição, e todas as seguintes, ficariam esperando a subida da foto num link lento. Medido na ferramenta de imagem: a linha desenhada depois de uma foto de 138 KB esperou a subida inteira.
  - Por isso a foto sobe sozinha e a edição sai em milissegundos.
  - O custo: quem abrir a foto inteira antes de os bytes chegarem ao servidor recebe um aviso curto ("A foto ainda está sendo enviada por quem a anexou. Tente de novo em instantes.") e uma nova tentativa. Nunca aparece uma imagem quebrada.
- **Blob de foto é IMUTÁVEL e nunca é apagado** quando a foto sai de uma feição, quando a feição é excluída ou quando a feição é convertida. Com isso, todo gesto de cópia DENTRO do mesmo atlas pode compartilhar a referência sem copiar byte:
  - conversão de linha/ponto (`linear-conversion.model.js` e `point-conversion.model.js` já fazem `deepClone` de `images`);
  - buffer e voronoi (`processing/algorithms/buffer.algorithm.js` e `voronoi.algorithm.js`);
  - duplicar mapa no servidor;
  - mover ou copiar camada para outro mapa.
  - O órfão que sobra é recolhido por uma coleta por alcançabilidade (fase 2e, opcional).
- **Entre atlas, a foto recebe id NOVO e os bytes são copiados.** Isso vale para colar num atlas diferente, clonar atlas, `.ebgeo` aditivo e "Enviar ao servidor" com colisão. O id de `images` é chave primária global e a leitura é por (id, atlas_id).
- **Leitura dupla, para sempre:** todo leitor aceita `data` inline (legado: acervo do main, `.ebgeo` antigo, servidor antes da conversão) ou `id` sem `data` (resolvido por `getImage`). É o que torna a transição segura: nenhum passo precisa acontecer atomicamente em todos os lugares.

### O que muda no contrato

- **Envelope de sync e `/api/config`:** não mudam. `properties` de feição e `data` de marcador são campos livres.
- **Semântica de `properties.images[].id`:** passa a ser um id da tabela `images` do atlas. O servidor JÁ lê assim para `images[]` de marcador 3D e 360: `rewriteItemImages` no clone (`backend/src/modules/atlas/atlas.service.js`) e `importImageIds` (`import-image-refs.js`). Para a feição, isso é novo.
- **Leitura de imagem:** a rota que serve a imagem (`GET /atlas/:id/images/:imageId`) passa a servir também foto. Já serve por (id, atlas_id) e com a permissão de leitura do atlas; nada muda nela.
- **Mudança de dado:** a conversão das data URLs que já estão no servidor é migração de dado (fase 2d) e exige decisão.

## 3. Todos os caminhos em que a imagem viaja, e como cada um fica provado

"Imagem" aqui são os DOIS tipos: a feição de imagem (ferramenta de imagem, cujo id é o do blob) e a foto anexa (feição, marcador 3D, marcador 360). A coluna "hoje" diz como o caminho funciona hoje, e "fase 2" o que muda.

| Caminho | Hoje (feição de imagem / foto anexa) | Fase 2 (foto anexa) | Prova |
|---|---|---|---|
| Anexar na galeria | foto inline | blob + pendência antes do save, `enviar()` depois, miniatura inline | e2e: op em KB, colega vê miniatura na hora e foto inteira depois; recusa nomeia a foto e vira pendência |
| Ver no painel / visualizador / baixar | `img.src = data` | `thumbnail` na grade; visualizador e download por `getImage(id)` (local, depois servidor), com aviso se ainda não chegou | e2e no colega e offline |
| Copiar e colar no mesmo atlas | blob copiado com id novo (`uploadCopiedBlobsIfRemote`) / foto inline copiada | referência compartilhada, sem cópia | e2e: colar e excluir o original, a foto da cópia continua abrindo |
| Colar em OUTRO atlas | id novo e blob novo / inline | id novo por foto, bytes copiados do escopo de origem (a área de transferência guarda os blobs das fotos) e envio pela fila | e2e cruzando atlas local e de servidor |
| Duplicar seleção, "Colar Aqui" | como colar | como colar | mesmo spec |
| Mover ou copiar camada para outro mapa | `layer-transfer.operations.js` copia o blob da feição de imagem | referência compartilhada (mesmo atlas) | e2e mover e copiar |
| Conversão linha/ponto, buffer, voronoi | inline copiado | referência compartilhada | unitário dos modelos de conversão, mais um e2e |
| Excluir feição / remover foto | `removeImage` do blob da feição de imagem | blob da foto NÃO é apagado | unitário: remover foto numa das cópias não apaga o blob |
| Duplicar mapa (rota do servidor) | `duplicateMap` copia só blobs de feição de imagem | referência compartilhada (mesmo atlas), sem cópia de linha | backend: duplicata abre a foto, e excluir o mapa original não a quebra |
| Clonar atlas (servidor) | `withPreparedImageCopies` copia todas as `images` do atlas; `rewriteItemImages` reescreve marcador | as fotos estão em `images`, então são copiadas; `rewriteFeatureProperties` passa a reescrever `properties.images[].id` | backend: clone com foto de feição e de marcador; o clone abre as duas e o original continua abrindo |
| Exportar `.ebgeo` | blobs de feição de imagem em `images/`; fotos inline no JSON | `collectUsedImageIds` inclui as fotos de feição e de marcador; JSON só com referência | e2e: exportar e reimportar (substituindo e aditivo), a foto abre |
| Importar `.ebgeo` antigo (inline) | inline | converte na importação: extrai `data` para blob e deixa referência | e2e com arquivo do main |
| Importar `.ebgeo` aditivo | `prepare-additive-scope.js` remapeia ids de `images[]` de marcador | acrescenta as fotos de feição a `required`, e o id da foto recebe um id novo | unitário do remapeamento, mais um e2e |
| KMZ | `collectPhotos` (`kmz-assets.js`) lê `image.data` | lê o blob por `getImage(id)`, assíncrono | e2e: KMZ tem `photos/...` com os bytes |
| PDF | foto anexa não vai ao PDF; feição de imagem vai pelo mapa | nada muda | conferido no código: `pdf-export.tab.js` só desenha o mapa |
| "Enviar ao servidor" (atlas local) | `local-atlas-to-server.js` sobe os blobs locais preservando o id | as fotos entram na lista de blobs a subir; a referência não muda (a rota bulk preserva o id) | e2e: enviar atlas local com fotos, e o colega abre |
| Import atômico (`atomic-server-import.js`, `import-attempt.service.js`) | `importImageIds` exige as imagens de marcador | inclui as fotos de feição | backend: o import sem a foto recusa ("Ainda faltam imagens"); com a foto, publica |
| Resgate (sair com fila) | o namespace vira local com os mesmos bancos | nada muda (os bytes estão em `ebgeo_images`, poupados como o resto) | e2e de resgate com foto pendente |
| Offline | inline | blob local e pendência; sobe na volta | e2e: anexar offline, F5 offline, voltar, o colega abre |
| Link lento | foto no corpo de toda edição | edição com a miniatura só; foto sozinha pela fila (prazo proporcional) | e2e com CDP a 40 kbps: a edição chega em segundos |
| F5 no meio da subida | não se aplica (inline) | retomada no connect sob o mesmo id | e2e (modelo: `figura-aparece-na-hora-em-link-lento`) |
| Visitante de link público | lê o inline | `getImage` por link público com o carimbo de atlas (como a feição de imagem) | e2e na visita pública |
| Marcadores 3D e 360 | `processImageFile` → inline em `images[]` | igual à feição (os três pontos de escrita são `user_data_manager.addImage`, `cesium3d.operations.js` e `streetview360.operations.js`) | e2e nos painéis 3D, 360 e primeira pessoa |

## 4. Conversão das data URLs que já existem

1. **Atlas locais e acervo do main.**
   - Degrau de migração local, com `ATLAS_SCHEMA_VERSION` subindo, na forma de `common-tasks.md` §Adding a Schema Migration: percorre feições e marcadores de cada mapa, grava `data` como blob sob o id da foto e reescreve o item sem `data`.
   - É idempotente: blob primeiro, documento depois, e um item sem `data` é pulado.
   - Roda por slot, no escopo, com o portão de migração existente.
   - Prova: fixture do acervo do main (frente migracao) e um caso de queda no meio.
2. **`.ebgeo` antigo:** convertido na importação (tabela acima).
3. **Servidor.**
   - Tarefa de migração no backend: extrai `data:image/...;base64` de `features.properties->images` e de `cesium3d_data` / `streetview360_data`, grava arquivo e linha em `images` (escopo do atlas), reescreve o JSON sem `data`, sobe `version` e registra uma operação marcador estrutural para o cliente pedir retrato.
   - **É migração de dado, e peço decisão.**
   - Alternativa sem migração: a leitura dupla sozinha. Nesse caso o dado antigo continua inline até a próxima edição da foto, e o peso do retrato só cai com o tempo.

## 5. Fases propostas, cada uma com prova

- **2a. Leitura dupla** (nenhuma escrita muda).
  - Todos os leitores aceitam item sem `data`: galeria, visualizador, download, painéis 3D, 360 e primeira pessoa, KMZ, exportação `.ebgeo`, `collectUsedImageIds`.
  - Prova: e2e com uma foto semeada só como referência mais blob, visível em cada superfície e no colega; unitários de cada coletor.
- **2b. Escrita nova** nos três pontos de anexar.
  - Prova: e2e de anexar, colega, offline, F5, link lento e recusa; controle negativo com o anexar antigo (op com a foto inteira).
- **2c. Caminhos de cópia e fronteira.**
  - Colar entre atlas, `.ebgeo` aditivo, clone de atlas (backend), import atômico, "Enviar ao servidor".
  - Prova: um spec por caminho. A frente cob-imagens já tem esse inventário e pode ser dona dos specs.
- **2d. Conversão.** Degrau local (prova com o acervo do main). Tarefa do servidor só com decisão.
- **2e (opcional). Coleta de blob órfão** por alcançabilidade, no servidor e no cliente.

## 6. Arquivos que a fase 2 vai tocar (para coordenar com a frente cob-imagens)

**Frontend**
- `frontend/src/js/user_data/user_data_manager.js` (`addImage`, `getImages`, `downloadImage`, `removeImage`)
- `frontend/src/js/store/cesium3d.operations.js` (a escrita da foto do marcador 3D, `addImage:${collectionKey}` / `removeImage:${collectionKey}`)
- `frontend/src/js/store/streetview360.operations.js` (`addMarker360Image`, a remoção)
- `frontend/src/js/utilities/image_utils.js` (a fase 1 já mexeu; a fase 2 acrescenta a separação entre blob e miniatura)
- `frontend/src/js/store/sync/image-sync.js` e `frontend/src/js/store/sync/blob-upload-queue.js` (a pendência passa a saber a entidade dona da foto, para o texto do aviso; a op não espera)
- `frontend/src/js/sidebar/components/feature-photo-gallery.js` (`openImageViewer` e a grade)
- `frontend/src/js/3d_models_viewer_tool/components/panel-shared-3d.js`, `frontend/src/js/street_view_tool/components/marker-panel-360.js`, `frontend/src/js/first_person_3d_tool/components/marker-panel-fp.js`
- `frontend/src/js/import_export/kmz/kmz-assets.js` (`collectPhotos`)
- `frontend/src/js/import_export/export-import.service.js` (`collectUsedImageIds`, carga de `images/`)
- `frontend/src/js/import_export/prepare-additive-scope.js`
- `frontend/src/js/projects/import-ebgeo.service.js`
- `frontend/src/js/import_export/local-atlas-to-server.js` e `frontend/src/js/import_export/atomic-server-import.js`
- `frontend/src/js/tool_manager/clipboard_manager.js` (colar entre atlas) e `frontend/src/js/store/upload-copied-blobs.js`
- `frontend/src/js/store/layer-transfer.operations.js` (só para não apagar blob de foto)
- `frontend/src/js/store/feature.operations.js` (`imageCleanups` não pode apagar foto)
- `frontend/src/js/store/migration/` (degrau novo) e `frontend/src/js/store/atlas/atlas.entity.js` (`ATLAS_SCHEMA_VERSION`)

**Backend**
- `backend/src/modules/atlas/atlas.service.js` (`rewriteFeatureProperties` reescreve `properties.images[].id`; `duplicateMap` não muda, e confirmo que não apaga)
- `backend/src/modules/atlas/import-image-refs.js` (`importImageIds` inclui as fotos de feição)
- `backend/src/modules/atlas/import-attempt.service.js` (só se o limite de imagens do import mudar)
- tarefa de migração nova, só com decisão

**Não toca:** envelope de sync, `/api/config`, rotas de imagem (a rota bulk e a leitura servem como estão), ferramenta de imagem (`add_image_control.js`, que é o modelo e já está pronta).

## 7. Decisões que peço

1. Aprovar o desenho: a foto como blob, a miniatura inline, e a op que NÃO espera o blob (seção 2).
2. Aprovar que o blob de foto nunca é apagado ao remover a foto ou a feição (órfão recolhido depois, fase 2e).
3. Conversão no servidor: migração de dado (2d) ou só leitura dupla.
4. Ordem das fases e quem é dono dos specs de caminho (eu ou a frente cob-imagens).

## 8. Fase 2e: coleta do blob órfão (SÓ DESENHO, 2026-09-24; apagar é decisão do dono)

### 8.1 O que existe hoje (lido no código em d58e37a3)

- **Servidor.** Nada apaga linha de `images` fora da rota `DELETE /atlas/:id/images/:imageId`, e nenhum cliente a chama (`apiClient.deleteImage` não tem chamador). Feição, mapa e atlas são soft-delete, e a cláusula 7.4 da `CONSTITUICAO.md` exige a lixeira restaurável COM conteúdo. Hoje o acervo de imagens só cresce, inclusive o da feição de imagem excluída.
- **Cliente.** `removeImage` só é chamado para o raster da feição de imagem e dos símbolos regeneráveis (exclusão pela ferramenta, `deleteLayerFeatures`, desfazer de `transferLayerToMap`) e para a foto preparada cujo save foi recusado. O blob de foto nunca é apagado (decisão 2 do dono).
- **Blob compartilhado.** A mesma foto (mesmo id) pode ser citada por várias feições do mesmo atlas: cópia de feição, mapa duplicado no servidor, conversão linha/ponto. O clone copia TODAS as linhas de `images` da origem, citadas ou não, sob ids novos.

### 8.2 A regra: o que conta como referência

Um id de `images` do atlas X está VIVO se aparece em QUALQUER uma destas fontes. A lista é a união, e cada item existe porque, sem ele, a coleta apagaria foto viva:

1. **Toda linha do atlas, viva OU excluída.** Isso vale para `features` (o id da feição de imagem, `properties.images`, `markerSymbol` com prefixo `custom:`), `cesium3d_data`, `streetview360_data` (todo array `images`, em qualquer profundidade), `atlas.settings.customIcons` e mapas na lixeira. Nenhum filtro por `deleted_at`: a lixeira do atlas (7.4), a feição excluída restaurável (a intenção de restaurar do sync) e o mapa excluído trazem as referências de volta.
2. **O log de operações ainda retido (`operations.data` e `changes`) do atlas.** É por ele que um cliente atrasado recebe a cauda (`pullSync` por cursor). Uma op antiga que cita a foto ainda pode ser aplicada por um par que estava offline, e o documento dele passaria a citá-la.
3. **A preparação de importação não publicada** (`atlas_import_images` e o payload de `atlas_import_attempts`) não cita `images` até o commit, então fica fora. Isso está certo, mas precisa de caso próprio no censo.

O que o servidor NÃO enxerga, e por isso a retenção e o reparo existem:

4. **A fila de outro cliente ainda não enviada.** O diário de saída é append-only e nunca é purgado. Um cliente pode subir o blob (a fila durável confirma o blob antes da op) e ficar semanas offline com a op que o cita. Para o servidor, esse blob não tem referência.
5. **O desfazer e a área de cópia de uma sessão aberta.** Remover a foto e desfazer religa a referência. A cópia de feição feita antes da remoção e colada depois também religa.
6. **O "manter a minha" de um conflito.** O painel de problemas reenvia a versão do cliente, que pode citar uma foto que o colega removeu.
7. **A geração anterior do retrato no cliente** (o sufixo de geração; o banco de imagens é compartilhado pelas gerações). Ela é o recuo se o pull falhar, e ainda pode citar a foto que a geração ativa já não cita.

E o que NÃO precisa entrar, com o porquê:

- **`.ebgeo` e KMZ exportados.** Eles carregam os BYTES da foto por referência (`collectUsedImageIds` e `collectPhotos` leem o blob), então não dependem do servidor. Reimportados, o import em atlas local preserva os bytes do arquivo, e o import no servidor cunha ids novos e sobe os bytes do arquivo. Prova: e2e que exporta, apaga a linha no servidor e reimporta, com a foto abrindo.
- **Clone.** O clone copia as linhas de `images` da origem no instante da cópia e confere de novo dentro da transação (`withPreparedImageCopies`: se a origem mudou, `ConflictError`, e a cópia é refeita). Uma coleta concorrente na origem cai nessa conferência, não num clone quebrado. Depois do clone, cada atlas coleta o seu. O custo é o clone levar junto as órfãs da origem, que é desperdício e não perda.

### 8.3 Retenção: da ÚLTIMA vez que a linha foi vista sem referência, nunca da criação

- A varredura grava na linha de `images` a data da primeira passada que a achou sem referência, e APAGA essa data quando a acha referenciada de novo.
- Apaga só quando as duas condições valem ao mesmo tempo: a marca tem mais de N dias e a criação também. Proponho N = 90 dias (o dono disse no mínimo 30), configurável, porque o risco 4 (cliente offline com a op na fila) é medido em semanas numa rede militar.
- Contar da criação foi recusado: a foto antiga removida ontem seria apagada hoje, e o desfazer (risco 5) e o "manter a minha" (risco 6) religariam uma referência para o nada.
- Isso é **migração** (uma coluna e um índice parcial). Peço decisão. A alternativa sem coluna (uma tabela lateral) também é migração.

### 8.4 Reparo, porque retenção nenhuma cobre o cliente que volta depois de N dias

- **Lápide.** A coleta grava atlas, id da imagem, hash do conteúdo e data numa tabela de lápides antes de apagar o arquivo.
- **Detecção.** Uma op aplicada que cite id com lápide é registrada no diagnóstico (`npm run diag`). A resposta pede o blob de volta pelo recibo, e o cliente que ainda tem os bytes no armazém local sobe de novo pela rota bulk, sob o MESMO id. A PK está livre depois da coleta, e a fila durável já sabe fazer isso.
- **O lado do cliente é o que torna o reparo possível.** O armazém local NUNCA apaga blob citado por op do próprio diário ou por pendência da fila durável.

### 8.5 O cliente

- **Atlas de servidor.** O armazém é cache, e perder um blob só custa baixar de novo. Mesmo assim, só se apaga o que não é citado por:
  - nenhum documento das DUAS gerações retidas (lidas do repositório, nunca da memória, que só tem o mapa corrente);
  - nenhuma op do diário, inclusive as de problema e as de quarentena;
  - nenhuma pendência da fila durável.
- **Atlas local.** O armazém é a ÚNICA cópia. Contam a mesma lista, mais o raster regenerável (chave = id da feição de símbolo, medida ou declinação) e o registro de ícones próprios. O slot resgatado é um atlas local com esses mesmos bancos.
- **Marca.** A marca de "sem referência desde" mora num registro do próprio banco de imagens do escopo, porque tem de morrer com o namespace.
- **Quando.** Na abertura do atlas, adiado para o ocioso, no máximo uma vez por dia. Nunca durante a sessão: desfazer e área de cópia (risco 5) só existem em memória.

### 8.6 Como entra em produção sem apagar nada primeiro

1. **Release A: só marca e conta.** A coleta grava a marca e publica no `npm run diag` quantas linhas e quantos bytes seriam apagados, por atlas. Não apaga nada.
2. **O dono lê a contagem**, confere amostras à mão (a foto marcada está mesmo sem feição, mapa ou lixeira que a cite) e decide.
3. **Release B: apaga**, primeiro com um teto por passada (linhas e bytes), e grava a lápide antes do arquivo.

### 8.7 Provas propostas

**Backend** (relógio injetado):
- Foto citada só por feição EXCLUÍDA, só por mapa excluído ou só por atlas na lixeira nunca é marcada.
- Foto removida é marcada, não é apagada antes de N e é apagada depois.
- Religar a referência limpa a marca.
- Duas feições com a mesma foto: remover de uma não marca.
- Op na cauda do log que cita a foto segura a linha.
- Clone concorrente com a coleta cai no `ConflictError` e refaz.
- Censo das superfícies que citam imagem, espelho de `importImageIds` e de `idsDeFotosPorReferencia`, varrido por `git ls-files` como os censos de recurso.

**Cliente** (fake-indexeddb):
- Op no diário, pendência na fila e geração anterior protegem o blob.
- Atlas local nunca perde foto citada.

**E2E:**
- Remover e desfazer abre a foto.
- Cliente offline por mais de N dias (relógio) volta, a op cita a lápide e o blob sobe de novo sob o mesmo id.
- Exportar `.ebgeo`, apagar a linha, reimportar: a foto abre.

### 8.8 Decisões que peço ao dono

1. Migração: a coluna da marca e a tabela de lápides.
2. N = 90 dias, configurável (o mínimo dado foi 30).
3. O release A só marca e conta; apagar vem depois de ele ler a contagem.
4. A feição excluída e a lixeira seguram o blob para sempre (7.4), ou seja, a coleta só libera foto removida, ícone removido e raster substituído.
5. O reparo por lápide (o servidor pede o blob de volta pelo recibo) entra junto com o release B.
