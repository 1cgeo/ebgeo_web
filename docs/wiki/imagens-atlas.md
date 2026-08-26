# Imagens do atlas (REST + referência por imageId)

Bytes de imagem viajam por REST e ficam fora do log de operações; só a referência (uma string id) sincroniza dentro da feição. Toda a assimetria e as armadilhas de convergência saem daí.

## Por que os bytes não passam pelo sync

O canal de operações ([[envelope-operacao]], [[canal-collab-websocket]]) transporta JSON pequeno, ordenado e idempotente. Blob de até 10 MB dentro dele inflaria a fila outbound ([[fila-operacoes-outbound]]), a tabela de operações ([[tabela-operations]]) e todo replay de [[snapshot-e-pull-incremental]]. A separação de planos é deliberada:

- **Bytes**: REST, sem versionamento, sem LWW, sem histórico.
- **Referência**: property de feição comum, sujeita a [[modelo-conflito-lww]].

Consequência que orienta o resto da página: **uma imagem nunca conflita; conflita a feição que aponta para ela**. E receber a operação não traz os bytes. Ver [[sintese-rest-vs-sync]] e [[sintese-modulos-fora-do-sync]]. Segurança, allowlist, magic bytes, limites e o shape exato do lote estão em [[upload-imagens-seguranca]] (não duplique aqui).

## Contrato congelado: o id do blob é o id da feição

A referência mora em `properties.id`, e **não existe uma property `imageId` na feição**: o frontend grava em `properties.id` (`frontend/src/js/draw_tools/image_tool/add_image_control.js`) e o renderer lê de lá (`frontend/src/js/layers/layer_setup.js`). O nome `imageId` existe só como variável local nesses módulos, o que torna o engano fácil e persistente: quem consumir a feição no servidor procurando por essa property não acha nada.

Para feição `image`, `imageId === properties.id === id do registro no backend`. Não é acidente: é o que permite o import preservar ids sem fase de rewrite (adiante). Quebrar essa igualdade quebra o caminho de "salvar atlas local no servidor" inteiro.

Segundo consumidor, com o mesmo modelo: ícones customizados de ponto, referenciados como `markerSymbol: "custom:<imageId>"` (`frontend/src/js/import_export/local-atlas-to-server.js`). Metadados vão em `atlas.settings.customIcons` ([[atlas-settings]]), blobs vão pelo endpoint de imagens (`addCustomIcon`, `frontend/src/js/store/customIcons.operations.js`).

## O que faz o peer convergir (e onde ele não converge)

A convergência visual não vem da operação, vem de um fallback local-primeiro em cada leitura: blob local, se ausente `fetchImageBlob` no backend, cacheia (`getImage` em `frontend/src/js/store/settings.operations.js` para fotos, `getCustomIconBlob` em `frontend/src/js/store/customIcons.operations.js` para ícones).

O gateway `frontend/src/js/store/sync/image-sync.js` é um seam fino sobre o `apiClient` que **não importa o grafo do store** (evita ciclo de import) e recebe o atlas conectado por injeção do sync-engine. Duas propriedades intencionais:

- **Best-effort**: upload e fetch engolem erro e retornam `null`. Rede caída degrada para "sem imagem", nunca lança.
- **Offline vira id local**: sem atlas conectado, o upload retorna `null` e o chamador gera um UUID local. A feição funciona, o blob existe só naquele navegador. Ver [[dominio-local-vs-remoto]] e [[modos-operacao]].

**Armadilha.** Feição de imagem criada offline e sincronizada depois carrega um id que não existe no servidor: o peer chama `fetchImageBlob`, toma 404 e não mostra nada. Só o caminho de salvar o atlas local no servidor reconcilia isso.

**Armadilha oposta, e mais sutil.** Símbolo militar, medida de coordenação e declinação também são renderizados como imagem, mas com PNG gerado no cliente que **nunca é enviado**. Buscar esses ids no backend 404a e vira ícone de erro. Por isso `frontend/src/js/layers/layer_setup.js` consulta `getImageRegenerator(feature.properties.source)` e **reconstrói a partir das props** em vez de buscar. Se você criar um novo tipo de feição com imagem derivada de props, registre o regenerador em `frontend/src/js/layers/image-regen-registry.js`, senão o peer vê erro no lugar do símbolo.

## Por que o import sobe as imagens DEPOIS

**Não há fase de rewrite de id pós-import.** O backend preserva o id escolhido pelo cliente (`INSERT_IMAGE_WITH_ID`, `backend/src/modules/images/images.queries.js`) e o orquestrador importa o atlas ANTES de subir os blobs (`saveLocalAtlasToServer`, `frontend/src/js/import_export/save-local-atlas.service.js`) exatamente para dispensá-la. Procurar por essa fase para "consertar" um id divergente é procurar código que nunca existiu.

A ordem (montar `.ebgeo` em memória, ver [[formato-ebgeo-roundtrip]] → payload de import → `importAtlas`, ver [[atlas-import-offline]] → bulk upload preservando ids) é contrato, não estilo. Inverter as fases exigiria reintroduzir o rewrite de referência que a preservação de PK eliminou.

Armadilhas desse caminho:

- **PK global escolhida pelo cliente, e o que isso custa.** `images` tem PK global, não composta por atlas, e o lote deixa o **cliente** escolher a PK, que é justamente o que dispensa o rewrite. O `INSERT` **não** tem `ON CONFLICT`: uma colisão levanta `unique_violation`, tratada como falha daquele item, e o blob só é escrito depois do INSERT, então nem arquivo órfão sobra. O efeito cross-atlas existe e é de **negação, não de vazamento**: um id que colida com o de outro atlas faz o item falhar, e o dono do outro atlas não perde nada. Quem importa fica sem aquela imagem. Não confunda com sobrescrita: trocar este `INSERT` por um upsert transformaria a negação em reescrita da linha alheia mantendo o `atlas_id` original, que é pior que vazamento simples, porque a vítima serviria bytes de terceiro como se fossem dela. Provado por mutação em `backend/tests/integration/cross-tenant-negativos.test.js`.
- **SVG local some silenciosamente.** O coletor filtra pela allowlist do servidor (`ALLOWED_IMAGE_MIME`, `frontend/src/js/import_export/atlas-image-upload.js`) e reporta como `skipped`. O ícone SVG continua funcionando para quem salvou e desaparece para os colaboradores, sem erro visível.
- **201 no lote não é sucesso.** O loop é por item; ler só o status esconde `failed[]`. Detalhe do shape em [[upload-imagens-seguranca]] e [[erros-api]].

## Referências penduradas são estado esperado

`DELETE` não verifica feições apontando para a imagem, e apagar a feição não apaga o blob no servidor (`deleteImage`, `backend/src/modules/images/images.service.js`). As duas direções produzem órfãos por projeto: o renderer degrada para "sem imagem" porque `getImage` devolve `null`. Não adicione checagem de referência sem antes decidir o que fazer com o caso offline, onde o servidor sequer conhece a feição.

**E não existe coleta: o órfão fica para sempre e o armazenamento cresce sem teto.** Isso é limite conhecido, não descuido, e o conserto não cabe no cliente: a resolução é LWW por ordem de chegada e o desfazer é local, então apagar o blob junto com a feição faria uma exclusão vinda de um par destruir bytes que outro par ainda referencia, sem caminho de volta para o `Ctrl+Z`. Uma coleta periódica no servidor é decisão de produto porque define **quanto tempo** um órfão sobrevive, e uma varredura mal dimensionada apaga o que ainda importa. Ver [[modelo-conflito-lww]].

**Havia uma terceira fonte de órfão, e essa foi fechada na origem.** Conexão derrubada no meio do upload deixava o blob parcial em disco. A causa não era a rota: `req.pipe(busboy)` registra o handler de erro no destino e não na origem, então o socket morto nunca virava erro no multer, que ficava pendurado e nunca chegava a limpar. Junto com o arquivo vazava um descritor por aborto, medido. Agora o storage `backend/src/middleware/armazenamento-abortavel.js` intercepta `req:close` com `req.complete === false`, fecha o `WriteStream`, apaga o arquivo e devolve o erro ao multer. Vale para `POST /atlas/:atlasId/images` e para o bundle do 360. Provado em `backend/tests/integration/upload-abortado-deixa-blob.repro.test.js`, com controle negativo.

Isso **não** é a coleta. Órfão de referência pendurada continua igual, e o que abortos antigos já deixaram continua em disco. A decisão de produto do parágrafo acima segue em aberto.

O download vai com `private, max-age=31536000, immutable` (`backend/src/modules/images/images.controller.js`), e a justificativa habitual ("o id é imutável, upload novo gera id novo") **não vale aqui**, por um caminho: o `DELETE_IMAGE` é **físico** (`backend/src/modules/images/images.queries.js`) e devolve a PK ao pool de ids disponíveis, então apagar a imagem e re-importar o atlas local com o mesmo id recria a MESMA URL com bytes diferentes, e o navegador não revalida, porque `immutable` é literalmente a instrução de não revalidar dentro do ano. Re-importar **sem** apagar antes não sobrescreve nada: o `INSERT` do lote não é upsert e a colisão falha o item (armadilha acima). Não há teste cobrindo reuso de id depois do delete.

Consequência prática: para trocar os bytes de uma imagem, **troque o id**, não os bytes. E o invariante que autoriza `immutable` nas outras rotas de binário ([[sintese-cache-http-imutavel]]) não se aplica a esta.

Upload exige permissão `write`, então **Comentarista não faz upload**, só lê ([[permissoes-atlas]]).
