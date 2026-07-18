# Imagens do atlas (REST + referência por imageId)

Bytes de imagem viajam por REST e ficam fora do log de operações; só a referência (uma string id) sincroniza dentro da feição. Toda a assimetria e as armadilhas de convergência saem daí.

## Por que os bytes não passam pelo sync

O canal de operações ([[envelope-operacao]], [[canal-collab-websocket]]) transporta JSON pequeno, ordenado e idempotente. Blob de até 10 MB dentro dele inflaria a fila outbound ([[fila-operacoes-outbound]]), a tabela de operações ([[tabela-operations]]) e todo replay de [[snapshot-e-pull-incremental]]. A separação de planos é deliberada:

- **Bytes**: REST, sem versionamento, sem LWW, sem histórico.
- **Referência**: property de feição comum, sujeita a [[modelo-conflito-lww]].

Consequência que orienta o resto da página: **uma imagem nunca conflita; conflita a feição que aponta para ela**. E receber a operação não traz os bytes. Ver [[sintese-rest-vs-sync]] e [[sintese-modulos-fora-do-sync]]. Segurança, allowlist, magic bytes, limites e o shape exato do lote estão em [[upload-imagens-seguranca]] (não duplique aqui).

## Contrato congelado: o id do blob é o id da feição

> **[!CONTRADICAO]** Os guias absorvidos *06-presenca-imagens* (§2.5/Parte 3) e *08-offline-import* (§4.2) dizem que a referência fica em `properties.imageId`. **Não existe `properties.imageId` no código.** O frontend grava em `properties.id` (`frontend/src/js/draw_tools/image_tool/add_image_control.js:355`) e o renderer lê de lá (`frontend/src/js/layers/layer_setup.js:182`). Quem consumir a feição no servidor deve olhar `properties.id`.

Para feição `image`, `imageId === properties.id === id do registro no backend` (`frontend/src/js/draw_tools/image_tool/add_image_control.js:304-308`). Não é acidente: é o que permite o import preservar ids sem fase de rewrite (adiante). Quebrar essa igualdade quebra o caminho de "salvar atlas local no servidor" inteiro.

Segundo consumidor, com o mesmo modelo: ícones customizados de ponto, referenciados como `markerSymbol: "custom:<imageId>"` (`frontend/src/js/import_export/local-atlas-to-server.js:116`). Metadados vão em `atlas.settings.customIcons` ([[atlas-settings]]), blobs vão pelo endpoint de imagens (`frontend/src/js/store/customIcons.operations.js:107-133`).

## O que faz o peer convergir (e onde ele não converge)

A convergência visual não vem da operação, vem de um fallback local-primeiro em cada leitura: blob local, se ausente `fetchImageBlob` no backend, cacheia (`frontend/src/js/store/settings.operations.js:224-235` para fotos, `frontend/src/js/store/customIcons.operations.js:154-164` para ícones).

O gateway `frontend/src/js/store/sync/image-sync.js` é um seam fino sobre o `apiClient` que **não importa o grafo do store** (evita ciclo de import) e recebe o atlas conectado por injeção do sync-engine. Duas propriedades intencionais:

- **Best-effort**: upload e fetch engolem erro e retornam `null` (`frontend/src/js/store/sync/image-sync.js:44-66`). Rede caída degrada para "sem imagem", nunca lança.
- **Offline vira id local**: sem atlas conectado, o upload retorna `null` e o tool gera um UUID local (`frontend/src/js/draw_tools/image_tool/add_image_control.js:305`). A feição funciona, o blob existe só naquele navegador. Ver [[dominio-local-vs-remoto]] e [[modos-operacao]].

**Armadilha.** Feição de imagem criada offline e sincronizada depois carrega um id que não existe no servidor: o peer chama `fetchImageBlob`, toma 404 e não mostra nada. Só o caminho de salvar o atlas local no servidor reconcilia isso.

**Armadilha oposta, e mais sutil.** Símbolo militar, medida de coordenação e declinação também são renderizados como imagem, mas com PNG gerado no cliente que **nunca é enviado**. Buscar esses ids no backend 404a e vira ícone de erro. Por isso `frontend/src/js/layers/layer_setup.js:186-204` consulta `getImageRegenerator(feature.properties.source)` e **reconstrói a partir das props** em vez de buscar. Se você criar um novo tipo de feição com imagem derivada de props, registre o regenerador em `frontend/src/js/layers/image-regen-registry.js`, senão o peer vê erro no lugar do símbolo.

## Por que o import sobe as imagens DEPOIS

> **[!CONTRADICAO]** O guia *08-offline-import* (§4.7 "IDs locais são substituídos por IDs do servidor" e §4.4 "fase 4: enviar UPDATE para atualizar `properties.imageId`") descreve um rewrite pós-import. **Ele não existe no código.** O backend preserva o `localId` como id do servidor (`INSERT_IMAGE_WITH_ID`, `backend/src/modules/images/images.queries.js:12-17`) e o orquestrador importa o atlas ANTES de subir os blobs (`frontend/src/js/import_export/save-local-atlas.service.js:97-105`) exatamente para não precisar de rewrite.

A ordem em `frontend/src/js/import_export/save-local-atlas.service.js` (montar `.ebgeo` em memória, ver [[formato-ebgeo-roundtrip]] → payload de import → `importAtlas`, ver [[atlas-import-offline]] → bulk upload preservando ids) é contrato, não estilo. Inverter as fases exigiria reintroduzir o rewrite de referência que a preservação de PK eliminou.

Armadilhas desse caminho:

- **PK global.** `images` tem PK global, não composta por atlas. Re-salvar o mesmo atlas local uma segunda vez colide em `unique_violation`, tratado como falha **do item**, não da requisição (comentário em `backend/src/modules/images/images.queries.js:9-11`). Na prática é a falha mais comum em produção, e chega como texto cru do driver Postgres.
- **SVG local some silenciosamente.** `collectImageUploads` filtra pela allowlist do servidor e reporta como `skipped` (`frontend/src/js/import_export/save-local-atlas.service.js:51-54`). O ícone SVG continua funcionando para quem salvou e desaparece para os colaboradores, sem erro visível.
- **201 no lote não é sucesso.** O loop é por item; ler só o status esconde `failed[]`. Detalhe do shape em [[upload-imagens-seguranca]] e [[erros-api]].

## Referências penduradas são estado esperado

`DELETE` não verifica feições apontando para a imagem, e apagar a feição não apaga o blob no servidor (`backend/src/modules/images/images.service.js:97-111`). As duas direções produzem órfãos por projeto: o renderer degrada para "sem imagem" porque `getImage` devolve `null`. Não adicione checagem de referência sem antes decidir o que fazer com o caso offline, onde o servidor sequer conhece a feição.

O cache de download é `immutable` porque **o id é imutável**: upload novo gera id novo, nunca sobrescreve bytes ([[sintese-cache-http-imutavel]]). Isso é o que torna o fallback acima seguro para cachear para sempre.

Upload exige permissão `write`, então **Comentarista não faz upload**, só lê ([[permissoes-atlas]]).
