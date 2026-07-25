# Distribuição de binários 3D (/assets3d)

Rota pública que serve tilesets e binários 3D como arquivos imutáveis, com dois backends de armazenamento (SQLite e filesystem) que expõem o mesmo contrato HTTP. O contrato está no código; esta página cobre o que ele não conta.

## A rota é pública por decisão, não por esquecimento

O subsistema é partido em descoberta (autenticada, `GET /api/v1/nomes/catalogo3d`, ver [[catalogo-3d]]) e distribuição (pública, `/api/v1/assets3d/*`). A rota de assets é montada antes das autenticadas (`assets3dRoutes`, `backend/src/app.js`) e o router não tem middleware próprio (`backend/src/modules/nomes/assets3d.routes.js:8`). O único auth no caminho é o `flexibleAuth` global (`backend/src/app.js:65`), que é não bloqueante.

Consequência congelada: **`/assets3d/*` nunca retorna 401/403 por falta de token.** A proteção é "quem não conhece a URL não baixa", com a descoberta gateada por [[autenticacao-jwt]] e [[zonas-acesso-geografico]]. Isso não é controle de acesso ao binário. Se um modelo for sigiloso, a URL dele é o segredo, e URL não é segredo bom.

Por que assim: o Cesium busca milhares de tiles por sessão, muitos via `<script>`/fetch sem controle fino de header, e revalidação com `immutable` precisa passar por CDN e proxy. Auth por request no tile mataria o cache de borda. Ver [[hardening-borda-api]] e [[sintese-cache-http-imutavel]].

Fora do sync: sem operação, sem fila. Ver [[sintese-modulos-fora-do-sync]].

## Nunca hardcode o prefixo da URL

O catálogo guarda caminho relativo; a URL final é `assets3dBaseUrl + url`, servido pelo `/api/config` (`assets3dBaseUrl`, `backend/src/modules/config/config.service.js`). Hardcodar `/api/v1/assets3d` no cliente quebra qualquer deploy que aponte os assets para um host estático ou CDN. Contrato congelado, ver [[config-runtime-urls-relativas]], [[config-dinamico]] e [[sintese-contratos-congelados]].

## Rodar o import com o servidor no ar corrompe o serviço

O maior risco operacional do módulo, e ele não aparece em nenhum arquivo isoladamente.

O servidor abre a conexão de leitura uma única vez e a mantém em cache para sempre (`_readDb` singleton, `backend/src/modules/nomes/assets3d.store.js:16-29`), com `mmap_size` de 256 MB. Cada worker do pool também cacheia a sua, por `dbPath` (`backend/src/utils/sqlite-blob-worker.js:8-19`). O `scripts/assets3d-import.js` escreve **no mesmo arquivo, in place**, dentro de **uma única transação** que cobre a árvore inteira.

Não há `journal_mode = WAL` nem `busy_timeout` em lugar nenhum desse caminho (verificado em `backend/src/modules/nomes/assets3d.store.js` e no CLI). Portanto, durante todo o import:

- o banco fica em journal de rollback com lock exclusivo pela duração inteira da transação;
- `getAssetMeta` (`backend/src/modules/nomes/assets3d.store.js:32-38`) não tem `try/catch` em volta do `.get()`, então um `SQLITE_BUSY` **sobe como 500**, não cai graciosamente no filesystem;
- no Windows, escrever sobre um arquivo com mmap aberto por várias threads tende a falhar com EBUSY/EPERM.

Compare com o 360, que resolve exatamente isso: `installSwap` (`backend/src/modules/streetview360/sv360.ingest.js`) faz evict do handle em todos os workers, `.bak`, e rename atômico. **O assets3d não chama `evict` nem `closeReadDb` em nenhum ponto fora do teardown.** Regra prática: pare o servidor para importar, ou importe para um arquivo novo e troque com o processo parado. Se um dia o import precisar ser online, o protocolo do 360 é o modelo a copiar. Ver [[ingestao-projetos-360]], [[streetview-360]] e [[deploy-backend]].

## O semáforo, e por que ele libera em `finish` **e** `close`

Só o ramo SQLite tem semáforo (`backend/src/modules/nomes/assets3d.controller.js:15`), porque ele materializa o Buffer inteiro no heap; o ramo filesystem faz `pipe` e não precisa. A liberação é idempotente e amarrada aos dois eventos (`backend/src/modules/nomes/assets3d.controller.js:56-63`) porque o Cesium **aborta requisições o tempo todo** ao trocar de LOD. Só com `finish`, cada abort vazaria um slot e a rota inteira travaria após 8 aborts (default de `ASSETS_3D_MAX_INFLIGHT`). Não simplifique isso para um único listener.

Detalhe deliberado de ordem: o 304 e o 416 acontecem **antes** do `acquire` (`:47`, `:50`). Revalidação de cache nunca fica na fila atrás de leituras de BLOB. Se alguém mover o `acquire` para o topo do handler "por clareza", a latência de 304 passa a depender da carga.

## Armadilhas de ETag e de chave

**mtime.** O ETag do filesystem é derivado do `fs.stat` (`backend/src/modules/nomes/assets3d.service.js:42`). Um `rsync` que preserva mtime mantém o ETag; um `cp` sem `-p` muda o mtime e invalida o cache do mundo inteiro sem que um byte tenha mudado. No SQLite isso não ocorre, porque o ETag é sha1 do conteúdo (`backend/src/modules/nomes/assets3d.store.js:69`). Republicar o mesmo caminho com conteúdo novo funciona nos dois modos.

**Igualdade exata.** O ramo SQLite busca por `rel_path` exato, então traversal é inócuo ali por construção, mas variantes de caminho (`./aman/x.json`, `aman//x.json`, qualquer coisa com `..` colapsável) **erram o índice e caem silenciosamente no filesystem**. Se o asset só existe no store, o resultado é um 404 sem explicação óbvia. As chaves são gravadas em posix pelo CLI, inclusive quando o import roda no Windows.

**A guarda anti-traversal existe só no ramo filesystem** (`backend/src/modules/nomes/assets3d.service.js:28-31`). Se alguém trocar a busca exata por prefixo ou `LIKE`, a guarda precisa ser adicionada lá, porque hoje não existe. E como `path.posix.normalize` colapsa os `..` contra a raiz, quase toda tentativa termina dentro da raiz apontando para arquivo inexistente: a resposta é **404, não 403**. O 403 sobrou para o resíduo que ainda escapa após a normalização, e o teste de integração reflete isso aceitando `403 || 404` (`backend/tests/integration/assets3d.test.js:69-70`). Não escreva alerta de segurança em cima do 403; ele quase nunca dispara.

## Range: multi-range vira 416, não 200

`parseRange` (`backend/src/modules/nomes/assets3d.controller.js:18`) casa exatamente `^bytes=(\d*)-(\d*)$`. Um `bytes=0-9,20-29` não casa e vira **416**, não um 200 com o arquivo inteiro. O RFC permite ignorar um Range que o servidor não entende; aqui a escolha foi rejeitar. Um proxy que reescreva Range em multipart quebra o carregamento do tileset, e desabilitar `Accept-Ranges` em proxy intermediário também: o Cesium depende de Range para fatiar tileset e terrain grandes.

O `end` do `Content-Range` é inclusivo. `bytes=0-1023` devolve 1024 bytes.

## Divergência plantada no Content-Type

O mapa de extensão para Content-Type existe duas vezes: `backend/src/modules/nomes/assets3d.service.js:13-20` e, copiado, em `scripts/assets3d-import.js:11-18`. Pior: o service **exporta** `contentTypeForPath` (`:23`) e essa função **não tem nenhum chamador** em todo o repositório. Ou seja, o helper feito para unificar existe e ninguém usa, enquanto o CLI mantém a cópia. Adicionar uma extensão em só um dos dois produz assets importados com o tipo errado, e o ramo SQLite serve o `content_type` gravado na importação, sem recalcular no request: o erro fica congelado no banco até reimportar.

## Notas de integração

- Concatene sempre `assets3dBaseUrl + m.url`.
- O terrain do mapa 3D **não** sai desta rota por padrão: é URL configurável em `map3d.providers.terrain.url`. A infra sabe servir `.terrain`/`layer.json` se um dia se decidir hospedá-lo aqui.
- Nunca `401` aqui. O `401` só aparece na descoberta. Formato de erro em [[erros-api]].
- Para blobs de usuário, que **são** sincronizados, o caminho é outro: [[imagens-atlas]].
- Ver também [[sintese-decisoes-arquiteturais]].
