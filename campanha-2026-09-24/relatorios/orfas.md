# Coleta de imagem ÓRFÃ no servidor (fase 2e das fotos)

Branch `hunt/orfas` (worktree `C:\Users\diniz\ebgeo_hunt\peso`), a partir de `origin/integracao_backend` em `06f9569e`.
Pedido do coordenador em 2026-09-24, aprovado pelo dono. Regra de ouro: **na dúvida, NÃO apaga**. Errar para mais (sobra blob) é barato; errar para menos apaga foto viva.

## 1. O que existe hoje (lido do código, não da prosa)

- `images` (tabela criada em `backend/src/database/migrations/003_atlas.sql`): `id` UUID global, `atlas_id` (FK com `ON DELETE CASCADE`), `storage_path` (arquivo em `config.images.dir/<atlas>/<uuid>.<ext>`), `size_bytes`, `created_at`. **Não tem `deleted_at`**: a única remoção que existe é o `DELETE_IMAGE` físico da rota `DELETE /atlas/:id/images/:imageId`, que nenhum cliente chama. O atlas nunca é apagado de verdade (a lixeira é `atlas.deleted_at`), então o CASCADE nunca dispara. Resultado: nenhum blob sai do disco, e o disco só cresce. É o "limite conhecido" que `docs/wiki/imagens-atlas.md` declara na seção de referências penduradas.
- O cliente sobe blob SÓ pela rota de lote (`POST /images/bulk`), que preserva o id escolhido por ele (`blob-upload-queue.js`, `upload-copied-blobs.js`). A rota única e a de `DELETE` não têm chamador em `frontend/src/`.
- Os dois coletores de referência que já existem, de onde este trabalho parte:
  - servidor, import: `importImageIds` (`backend/src/modules/atlas/import-image-refs.js`): feição `image` (o id da feição É o id do blob), `properties.markerSymbol = 'custom:<id>'`, todo array `images` em qualquer profundidade de `cesium3dData`/`streetview360Data` (item string ou `{id}`), e `atlas.settings.customIcons[].id`;
  - cliente, export: `collectUsedImageIds` (`frontend/src/js/import_export/export-import.service.js`): o id de TODA feição de todo balde, os ícones personalizados, e as fotos POR REFERÊNCIA de feição e de item 3D/360 (`idsDeFotosPorReferencia`, `frontend/src/js/user_data/photo-refs.js`).
  - Diferença entre os dois que importa aqui: o de import não olha `properties.images[]` da FEIÇÃO (as fotos anexas), o de export olha. A fase 2b (fotos por blob, branch `hunt/fotos`) passa a citar foto por `properties.images[].id` na feição e por `images[]` nos marcadores 3D/360. Hoje elas são inline. O coletor trata TODO `id` desses arrays como referência, inline ou não.

## 2. Fontes de referência (desenho)

**A forma de casar é o TOKEN, não o campo.** Uma imagem está citada se o id dela aparece como UUID em QUALQUER texto de qualquer coluna de conteúdo (`jsonb`, `text`, `varchar`, `uuid`, `uuid[]`) de qualquer linha viva das tabelas-fonte, em QUALQUER atlas. Três razões, todas pelo lado conservador:

1. uma superfície nova dentro de um JSON (um `coverImageId` amanhã, a foto por referência da fase 2b, um `<img src=".../images/<id>">` num HTML de nota ou slide) fica coberta sem ninguém lembrar de acrescentá-la: o coletor não sabe "onde" a imagem é citada, só "se";
2. o falso positivo (um UUID que por acaso é o de uma imagem) só faz SOBRAR blob;
3. o casamento é GLOBAL (cruza atlas): o clone de hoje reescreve feição de imagem, ícone e `images[]` do 3D/360, mas NÃO `properties.images[]` das feições (`rewriteFeatureProperties`, `backend/src/modules/atlas/atlas.service.js`), então depois da fase 2b uma feição clonada citaria o blob do atlas de ORIGEM. A leitura escopada por atlas daria 404, mas apagar o blob não é a resposta certa para essa dúvida.

Base64 não carrega hífen, então uma foto inline (data URL) não fabrica UUID por acidente.

As fontes, classificadas pelo censo (seção 6), e o que cada uma cita:

| fonte | colunas varridas | o que costuma estar ali | vida |
|---|---|---|---|
| `features` | `id`, `properties` (e as demais de texto) | feição de imagem (`id` = blob), fotos da feição (`properties.images[].id`, inline ou não), ícone personalizado (`markerSymbol = custom:<id>`) | viva ou excluída há menos de 30 dias |
| `cesium3d_data` | `data` e as de texto | marcador, medida e viewshed 3D com `images[]` em qualquer profundidade | idem |
| `streetview360_data` | `data` e as de texto | marcador 360 com `images[]` | idem |
| `atlas` | `settings` e as de texto | `settings.customIcons[].id` | SEMPRE, inclusive na lixeira |
| `briefings` | `description`, `settings` | figura de briefing | viva ou excluída há menos de 30 dias |
| `slides` | `content` (HTML), `title` e as de texto/json | figura de slide (HTML com URL ou id) | idem |
| `maps` | `notes_description` (HTML) e as de texto/json | figura em nota de mapa | idem |
| `comments` | `data` | anexo de comentário, se um dia existir | idem |
| `layers`, `groups` | `style` | ícone de estilo, se um dia existir | idem |
| `catalog_layers` | `data` | idem | idem |
| `operations` | `data`, `changes` | QUALQUER citação feita por op aplicada nos últimos 30 dias | janela de 30 dias pela data da op |

Fora, com o motivo escrito no censo: `group_features` e `sync_entity_fields` (citam a FEIÇÃO pelo id, e sobrevivem a ela: manteriam o blob de uma feição de imagem excluída para sempre, e a própria feição já é a fonte), `sync_receipts` (recibo), `audit_trail` e `defeitos`/`defeito_ocorrencias` (história, não referência viva), `atlas_import_attempts`/`atlas_import_images` (ver "import em curso"), `atlas_covers` (bytes próprios), catálogo, 360, 3D, uso, contas, OM, postos, config e tabelas do sistema.

**Proteções que não são fonte de texto:**

- **Atlas na lixeira**: toda imagem de atlas com `deleted_at` fica intocada (nem marcada, e a marca que tinha é zerada). Restaurar traz o atlas inteiro de volta, e a lixeira não tem prazo nem purga neste produto.
- **Linha excluída dentro da retenção**: feição, marcador, slide etc. excluídos há menos de 30 dias ainda citam. No servidor a lápide é final (`RAZAO_CRIACAO_NAO_RESTAURA`, `tombstoneConflict` em `backend/src/modules/sync/sync.service.js` recusa criar por cima de lápide), então isto é cinto, não necessidade; ele cobre o par que ainda desenha a feição do retrato anterior e o desfazer que ainda não chegou.
- **Carência de criação**: nenhuma imagem com menos de 30 dias de vida é apagada.
- **Carência de órfã (30 dias CONTÍNUOS)**: seção 3.

**Clone e import em curso:**

- O IMPORT em curso não toca `images`: os bytes moram em `atlas_import_images`, com prazo, e só na publicação viram linhas de `images`, na MESMA transação das feições que as citam (`backend/src/modules/atlas/import-attempt.service.js`). A linha publicada nasce com `created_at` de agora, dentro da carência de criação.
- O CLONE em curso copia ARQUIVOS antes de publicar (`withPreparedImageCopies`) e só então insere as linhas, também na mesma transação das feições. O coletor apaga só linha que existe, com o arquivo que ELA nomeia, então arquivo preparado sem linha nunca é alcançado. O clone relê as imagens da origem dentro da transação de publicação e recusa (409, "tente novamente") se elas mudaram, então uma coleta concorrente na ORIGEM não produz cópia quebrada: produz uma recusa que se repete.

**Por que uma imagem pode existir ANTES da op que a cita.** Não há op de sync para bytes: o blob sobe pela rota de lote, e a op da feição fica PREPARADA no cliente até o servidor confirmar os bytes (`blobUploadPending`, `frontend/src/js/store/sync/operation-dispatcher.js`). Ou seja, a ordem normal no servidor é linha de `images` primeiro, op da feição depois. Normalmente são segundos. Mas a op só sai quando a fila anda, e uma fila de cliente offline segura a op por dias: um notebook que subiu a figura e perdeu a rede antes do flush, ou um visitante que fechou a aba com a op preparada e só volta na semana seguinte. Durante esse tempo a imagem é, no servidor, indistinguível de uma órfã. É isso que a carência de criação e a de órfã compram: a op tem 30 dias para chegar. Depois disso a regra aceita o risco residual (seção 7).

## 3. A carência: 30 dias contínuos, e a marca

Coluna nova `images.sem_referencia_desde` (timestamptz, nula), por migração própria. Uma imagem só é apagada se:

1. não é citada agora (seção 2), e o atlas dela não está na lixeira;
2. `created_at` tem mais de 30 dias;
3. `sem_referencia_desde` não é nula e tem mais de 30 dias.

**Quem escreve a marca:** a rodada de coleta (modo `marcar` ou `apagar`): imagem citada ou de atlas na lixeira fica com a marca NULA; imagem sem citação e sem marca recebe `NOW()`.

**Quem zera a marca quando uma referência volta, e por que não pode ser só a rodada.** A rodada é manual e rara. Se só ela olhasse, uma referência que APARECE e SOME entre duas rodadas seria invisível: marcada no dia 0, citada do dia 5 ao dia 15, rodada no dia 31 veria "sem citação, marca de 31 dias" e apagaria uma imagem que estava sem referência havia só 16 dias. Por isso existe um gatilho (`zerar_marca_de_imagem_citada`) nas tabelas-fonte: todo INSERT, UPDATE ou DELETE de uma linha cujo texto ANTIGO ou NOVO cite uma imagem marcada zera a marca dela. O lado ANTIGO é o que fecha a corrida com a própria rodada: uma marca escrita a partir de um retrato que ainda não via a citação é zerada no instante em que a citação é REMOVIDA, e a contagem recomeça depois disso.

Custos e travas do gatilho:
- ele só trabalha quando existe alguma imagem marcada (checagem por índice parcial, barata); fora disso é um `EXISTS` por linha escrita;
- ele varre o texto da linha pelo mesmo padrão de UUID do coletor;
- uma falha dele NUNCA derruba a escrita do usuário: vira `WARNING` no log do Postgres. O custo de uma falha calada é só perder uma zerada, e a janela de ops de 30 dias (seção 2) é o cinto que cobre essa perda para tudo que chega por sync.

## 4. Execução

- **Simulação por padrão**, numa transação `READ ONLY` (o Postgres recusa qualquer escrita nela, então "a simulação não escreve" é propriedade do banco, não do código): lista o que seria apagado agora, com contagem e bytes, por atlas; e, à parte, as sem citação ainda em carência (com dias restantes) e as que ainda não têm marca.
- **`marcar`**: escreve as marcas (começa ou reinicia a contagem), não apaga nada.
- **`apagar`**: marca, e apaga as elegíveis. Por atlas, numa transação que toma o MESMO lock do log de operações do atlas (`lockAtlasLog`), então um push concorrente para aquele atlas espera; o `DELETE` repete as três condições (marca antiga, criação antiga, atlas fora da lixeira), então uma marca zerada pelo gatilho depois do levantamento tira a imagem da lista na hora. A linha da trilha (`IMAGE_ORPHAN_PURGE`, alvo o ATLAS, com ids, nomes e bytes) vai na mesma transação. O arquivo sai do disco DEPOIS do commit: se o commit falha, nenhum arquivo foi tocado; se a remoção do arquivo falha, sobra arquivo sem linha (o lado barato).
- **Portas**: `npm run diag -- orfas` (simulação), `npm run diag -- orfas --marcar --como <admin>` e `npm run diag -- orfas --apagar --como <admin>`, com `--json` como os irmãos; e `GET /api/v1/diag/imagens-orfas` (simulação) mais `POST /api/v1/diag/imagens-orfas` com `{ "acao": "marcar" | "apagar" }`, atrás de `requireAdmin` (que recusa toda chave de API, porque a coluna `administracao` é falsa em todo escopo).
- **Nada roda sozinho.** Proposta de agendamento (NÃO implementada): um `--marcar` semanal e um `--apagar` mensal, pelo cron do host, com a saída `--json` guardada. Com rodadas semanais, a imagem órfã sai entre 30 e 37 dias depois de perder a última referência.

## 5. Local (IndexedDB `ebgeo_images`): FORA, e por quê

Não é trivialmente seguro, então fica de fora, como o pedido autoriza:

- o desfazer é LOCAL e em memória (`startBatchUndo` e a pilha do `Ctrl+Z`): uma feição de imagem excluída pode voltar pelo desfazer, e o blob local é a ÚNICA cópia dela num atlas local. Um coletor precisaria ler a pilha de desfazer de todas as abas;
- num atlas de servidor o banco local é cache, mas guarda também a figura com subida PENDENTE (`KEY_PREFIX` da fila durável) e os bytes que ela nomeia; e o retrato por geração (`__generation-<uuid>`) compartilha o banco de imagens entre gerações;
- o blob de um atlas que não está montado não tem leitor vivo para confirmar referência, e a regra pede nunca tocá-lo.
Proposta, se um dia for feito: só em atlas LOCAL montado, sem nenhuma pendência de subida, com a pilha de desfazer vazia, e com a mesma carência por marca.

## 6. Censo

`backend/tests/integration/imagens-orfas-censo.test.js` lê `information_schema.columns` do banco MIGRADO (não uma lista escrita à mão) e exige que toda coluna capaz de guardar um UUID em texto (`jsonb`, `json`, `text`, `varchar`, `uuid`, arrays) de toda tabela esteja classificada: varrida por uma fonte (`FONTES_DE_REFERENCIA`) ou fora com motivo (`TABELAS_QUE_NAO_CITAM`, `COLUNAS_QUE_NAO_CITAM`, em `backend/src/modules/images/imagens-orfas.fontes.js`). Tabela ou coluna nova reprova até ser classificada. Ele também confere que toda tabela-fonte tem o gatilho de zerar marca, e que os dois coletores já existentes (`importImageIds` e `collectUsedImageIds`) só citam lugares que alguma fonte varre.

## 7. Riscos residuais (declarados)

- Uma op segurada offline por MAIS de 30 dias depois de a figura ter subido chega citando um blob que já foi apagado: a feição aparece sem figura (o 404 degrada para "sem imagem"). É o preço escolhido pela carência de 30 dias; a janela pode crescer pela constante.
- Escrita por caminho que NÃO toma o lock do log do atlas (a rota REST de configurações do atlas, ou uma citação vinda de OUTRO atlas) exatamente concorrente com o `DELETE` de uma imagem sem referência há mais de 30 dias: janela de milissegundos sobre um caso já anômalo.
- A limpeza do log de operações (`cleanupOldOperations`) encurta a janela de ops; o gatilho continua valendo.
- Arquivo em disco SEM linha (upload abortado antigo, preparação de import interrompida no meio) não é alcançado: o coletor só apaga o que uma linha nomeia. Proposta: um relatório (só leitura) de arquivos sem linha, como passo seguinte.
- `images` tem PK global e a remoção é física: a URL `immutable` volta a ficar disponível para o mesmo id. Um cliente que reapareça depois de 30 dias e re-suba o MESMO id sobe os MESMOS bytes (os da cópia local dele), então o cache imutável não serve bytes errados nesse caminho.

## 8. Andamento

- [x] desenho (este arquivo)
- [x] migração `017_imagens_orfas.sql` (coluna `images.sem_referencia_desde`, índice parcial, gatilho `zerar_marca_de_imagem_citada` nas 12 fontes, CHECK de auditoria com `IMAGE_ORPHAN_PURGE`), fontes (`imagens-orfas.fontes.js`), serviço (`imagens-orfas.service.js`), CLI (`orfas` em `backend/scripts/diag.js`), rota (`GET`/`POST /api/v1/diag/imagens-orfas`), rótulo da aba Auditoria (`frontend/src/js/admin/audit-phrases.js`)
- [x] testes do backend, verdes com `test:fast`: `imagens-orfas.test.js` (29: 16 fontes com controle negativo embutido, entre atlas, excluída 10/40 dias, op dentro/fora da janela, lixeira, carência 29/31, jovem, sem marca, referência que volta, lado ANTIGO do gatilho, simulação, trilha), `imagens-orfas-portas.test.js` (11: rota e comando), `imagens-orfas-censo.test.js` (6)
- [x] controles negativos manuais: gatilho sem o lado ANTIGO (o caso dele reprova), fonte `slides` retirada (o caso dela reprova), tabela nova e gatilho removido de `slides` (os dois casos do censo reprovam)
- [ ] suíte inteira do backend com `TEST_DB_NAME=ebgeo_test_peso` e piso de cobertura: terminou DEPOIS da pausa (log em `C:\Users\diniz\AppData\Local\Temp\backend-full.log`): 5736 casos, 5726 passam, **10 reprovam**; cobertura 98,36% statements (59919/60914), 90,04% branches, 97% functions. Os vermelhos, NÃO consertados ainda:
  - `tests/unit/saidas-de-conteudo-censo.test.js` (2): as rotas novas `GET`/`POST /imagens-orfas` precisam entrar no censo das saídas de conteúdo;
  - `tests/unit/superficies-de-recurso-censo.test.js` (4): o censo acha menção a tabela de recurso (provavelmente os nomes `sv360.*` e de catálogo em `TABELAS_QUE_NAO_CITAM`) e/ou a rota de leitura nova; classificar a unidade e a rota, ou escrever os nomes de outro jeito;
  - `tests/unit/atlas-shares-eixo-de-grupo-censo.test.js` (2): a menção a `atlas_shares` em `imagens-orfas.fontes.js` precisa entrar no censo, ou sair do texto;
  - o caso de boot gracioso ("boots on a valid config and shuts down gracefully") e o guarda da sonda do lock de push (1 cada): confirmar SOZINHOS antes de tratar como regressão (carga, ou efeito do gatilho novo em `atlas`/`operations`).
- [ ] vitest inteiro do frontend (só `auditoria-rotulos` e `auditoria-filtros-da-aba` rodaram, verdes) e `docs-integridade` (as duas páginas da wiki mudaram)
- [ ] docs: `docs/wiki/imagens-atlas.md` (seção nova) e `docs/wiki/observabilidade.md` (comando e rotas) FEITOS e não verificados; FALTAM a entrada em `docs/decisions/decisions-2026.md` ("decisão do dono em 2026-09-24") e a linha no `docs/decisions/DECISIONS.md`

## PRÓXIMO PASSO (exato, para retomada)

Estado: branch `hunt/orfas`, HEAD `06f9569e` (nenhum commit meu ainda). NADA commitado; tudo na worktree, sem stash:

- modificados: `backend/scripts/diag.js`, `backend/src/modules/diag/diag.controller.js`, `backend/src/modules/diag/diag.routes.js`, `backend/src/modules/diag/diag.schemas.js`, `backend/tests/unit/auditoria-censo.test.js`, `backend/tests/unit/migrations-higiene.test.js`, `docs/wiki/imagens-atlas.md`, `docs/wiki/observabilidade.md`, `frontend/src/js/admin/audit-phrases.js`
- novos: `backend/src/database/migrations/017_imagens_orfas.sql`, `backend/src/modules/images/imagens-orfas.fontes.js`, `backend/src/modules/images/imagens-orfas.service.js`, `backend/tests/integration/imagens-orfas.test.js`, `backend/tests/integration/imagens-orfas-portas.test.js`, `backend/tests/integration/imagens-orfas-censo.test.js`

Na ordem:
0. trazer `4d9177f8` da integração (cherry-pick sobre `hunt/orfas`, sem stash): segundo o coordenador, o vermelho da sonda do lock de push é interferência entre rodadas no mesmo Postgres (o `pg_locks` era contado sem filtrar banco nem atlas) e já está consertado lá; o boot gracioso pode ser da mesma classe;
1. consertar os três censos listados na seção 8 (saídas de conteúdo, superfícies de recurso, `atlas_shares`), rodar SOZINHO o caso de boot gracioso, e só então repetir `cd backend && TEST_DB_NAME=ebgeo_test_peso npm test` (comando separado, sozinho no banco `ebgeo_test_peso`), conferindo o piso de cobertura e o denominador;
2. escrever a entrada em `docs/decisions/decisions-2026.md` e a linha do índice `docs/decisions/DECISIONS.md` (formato das entradas de 2026-09-24 do fim do arquivo);
3. `npm run lint --prefix backend`, `npm run lint --prefix frontend` e `npm test --prefix frontend` (inclui `docs-integridade`), cada um separado;
4. commit por caminho com índice vazio (conferir `git diff --cached --stat` vazio antes), uma mensagem `feat(images): ...` com causa, desenho e provas; avisar o coordenador com o SHA.
