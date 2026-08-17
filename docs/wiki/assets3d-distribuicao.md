# Distribuição de binários 3D (/assets3d)

Rota pública que serve tilesets e binários 3D como arquivos imutáveis, com dois backends de armazenamento (SQLite e filesystem) que expõem o mesmo contrato HTTP. O contrato está no código; esta página cobre o que ele não conta.

## A rota é pública por decisão, não por esquecimento

O subsistema é partido em descoberta (autenticada, `GET /api/v1/nomes/catalogo3d`, ver [[catalogo-3d]]) e distribuição (pública, `/api/v1/assets3d/*`). A rota de assets é montada antes das autenticadas (`assets3dRoutes`, `backend/src/app.js`) e o router não tem middleware próprio (`backend/src/modules/nomes/assets3d.routes.js`). O único auth no caminho é o `flexibleAuth` global (`backend/src/app.js`), que é não bloqueante.

Consequência congelada: **`/assets3d/*` nunca retorna 401/403 por falta de token.** A proteção é "quem não conhece a URL não baixa", com a descoberta gateada por [[autenticacao-jwt]] e [[zonas-acesso-geografico]]. Isso não é controle de acesso ao binário. Se um modelo for sigiloso, a URL dele é o segredo, e URL não é segredo bom.

Por que assim: o Cesium busca milhares de tiles por sessão, muitos via `<script>`/fetch sem controle fino de header, e revalidação com `immutable` precisa passar por CDN e proxy. Auth por request no tile mataria o cache de borda. Ver [[hardening-borda-api]] e [[sintese-cache-http-imutavel]].

Fora do sync: sem operação, sem fila. Ver [[sintese-modulos-fora-do-sync]].

## Nunca hardcode o prefixo da URL

O catálogo guarda caminho relativo; a URL final é `assets3dBaseUrl + url`, servido pelo `/api/config` (`assets3dBaseUrl`, `backend/src/modules/config/config.service.js`). Hardcodar `/api/v1/assets3d` no cliente quebra qualquer deploy que aponte os assets para um host estático ou CDN. Contrato congelado, ver [[config-runtime-urls-relativas]], [[config-dinamico]] e [[sintese-contratos-congelados]].

## Rodar o import com o servidor no ar corrompe o serviço

O maior risco operacional do módulo, e ele não aparece em nenhum arquivo isoladamente.

O servidor abre a conexão de leitura uma única vez e a mantém em cache para sempre (`_readDb` singleton, `backend/src/modules/nomes/assets3d.store.js`), com `mmap_size` de 256 MB. Cada worker do pool também cacheia a sua, por `dbPath` (`backend/src/utils/sqlite-blob-worker.js`). O `scripts/assets3d-import.js` escreve **no mesmo arquivo, in place**, dentro de **uma única transação** que cobre a árvore inteira.

Não há `journal_mode = WAL` nem `busy_timeout` em lugar nenhum desse caminho (verificado em `backend/src/modules/nomes/assets3d.store.js` e no CLI). Portanto, durante todo o import:

- o banco fica em journal de rollback com lock exclusivo pela duração inteira da transação;
- `getAssetMeta` (`backend/src/modules/nomes/assets3d.store.js`) não tem `try/catch` em volta do `.get()`, então um `SQLITE_BUSY` **sobe como 500**, não cai graciosamente no filesystem;
- no Windows, escrever sobre um arquivo com mmap aberto por várias threads tende a falhar com EBUSY/EPERM.

Compare com o 360, que resolve exatamente isso: `installSwap` (`backend/src/modules/streetview360/sv360.ingest.js`) faz evict do handle em todos os workers, `.bak`, e rename atômico. **O assets3d não chama `evict` nem `closeReadDb` em nenhum ponto fora do teardown.** Regra prática: pare o servidor para importar, ou importe para um arquivo novo e troque com o processo parado. Se um dia o import precisar ser online, o protocolo do 360 é o modelo a copiar. Ver [[ingestao-projetos-360]], [[streetview-360]] e [[deploy-backend]].

## O semáforo, e por que ele libera em `finish` **e** `close`

Só o ramo SQLite tem semáforo (`backend/src/modules/nomes/assets3d.controller.js`), porque ele materializa o Buffer inteiro no heap; o ramo filesystem faz `pipe` e não precisa. A liberação é idempotente e amarrada aos dois eventos (`backend/src/modules/nomes/assets3d.controller.js`) porque o Cesium **aborta requisições o tempo todo** ao trocar de LOD. Só com `finish`, cada abort vazaria um slot e a rota inteira travaria após 8 aborts (default de `ASSETS_3D_MAX_INFLIGHT`). Não simplifique isso para um único listener.

Detalhe deliberado de ordem: o 304 e o 416 acontecem **antes** do `acquire`. Revalidação de cache nunca fica na fila atrás de leituras de BLOB. Se alguém mover o `acquire` para o topo do handler "por clareza", a latência de 304 passa a depender da carga.

## Armadilhas de ETag e de chave

**mtime.** O ETag do filesystem é derivado do `fs.stat` (`backend/src/modules/nomes/assets3d.service.js`). Um `rsync` que preserva mtime mantém o ETag; um `cp` sem `-p` muda o mtime e invalida o cache do mundo inteiro sem que um byte tenha mudado. No SQLite isso não ocorre, porque o ETag é sha1 do conteúdo (`backend/src/modules/nomes/assets3d.store.js`). Republicar o mesmo caminho com conteúdo novo funciona nos dois modos.

**Igualdade exata.** O ramo SQLite busca por `rel_path` exato, então traversal é inócuo ali por construção, mas variantes de caminho (`./aman/x.json`, `aman//x.json`, qualquer coisa com `..` colapsável) **erram o índice e caem silenciosamente no filesystem**. Se o asset só existe no store, o resultado é um 404 sem explicação óbvia. As chaves são gravadas em posix pelo CLI, inclusive quando o import roda no Windows.

**A guarda anti-traversal existe só no ramo filesystem** (`backend/src/modules/nomes/assets3d.service.js`). Se alguém trocar a busca exata por prefixo ou `LIKE`, a guarda precisa ser adicionada lá, porque hoje não existe. E como `path.posix.normalize` colapsa os `..` contra a raiz, quase toda tentativa termina dentro da raiz apontando para arquivo inexistente: a resposta é **404, não 403**. O 403 sobrou para o resíduo que ainda escapa após a normalização, e o teste de integração reflete isso aceitando `403 || 404` (`backend/tests/integration/assets3d.test.js`). Não escreva alerta de segurança em cima do 403; ele quase nunca dispara.

## Range: multi-range vira 416, não 200

`parseRange` (`backend/src/modules/nomes/assets3d.controller.js`) casa exatamente um intervalo. Um `bytes=0-9,20-29` não casa e vira **416**, não um 200 com o arquivo inteiro. O RFC permite ignorar um Range que o servidor não entende; aqui a escolha foi rejeitar. Um proxy que reescreva Range em multipart quebra o carregamento do tileset, e desabilitar `Accept-Ranges` em proxy intermediário também: o Cesium depende de Range para fatiar tileset e terrain grandes.

## Divergência plantada no Content-Type

O mapa de extensão para Content-Type existe duas vezes: `CONTENT_TYPES` em `backend/src/modules/nomes/assets3d.service.js` e, copiado, em `backend/scripts/assets3d-import.js`. A duplicação é deliberada (o CLI não carrega o módulo do service), e o que a torna segura é um guarda: `backend/tests/unit/assets3d-content-types.test.js` importa **os dois** mapas e exige igualdade exata, então acrescentar extensão num só reprova em `npm test`.

O que NÃO tem guarda, e é a parte durável desta seção: o ramo SQLite serve o `content_type` **gravado na importação** (`backend/src/modules/nomes/assets3d.store.js`, lido em `backend/src/modules/nomes/assets3d.controller.js`), sem recalcular no request. Um tipo errado que chegue ao banco fica congelado ali até reimportar, e o teste de paridade não alcança dado já gravado. O ramo filesystem recalcula por request e não sofre disso.

> **Esta seção afirmava o contrário e envelheceu.** Ela dizia que `contentTypeForPath` "não tem nenhum chamador em todo o repositório" e que "o helper feito para unificar existe e ninguém usa". As duas deixaram de valer: `resolveAsset` delega para ela no mesmo arquivo, com comentário registrando que ANTES repetia a busca inline, e o teste de paridade acima nasceu junto. O guarda de doc não pega esta classe, porque caminho e símbolo continuam existindo; só a afirmação envelheceu. É o caso que [[wiki-schema]] descreve como lista de furos que vence por trabalho alheio.

## Notas de integração

- O terrain do mapa 3D **não** sai desta rota por padrão: é URL configurável em `map3d.providers.terrain.url`. A infra sabe servir `.terrain`/`layer.json` se um dia se decidir hospedá-lo aqui.
- Nunca `401` aqui. O `401` só aparece na descoberta. Formato de erro em [[erros-api]].
- Para blobs de usuário, que **são** sincronizados, o caminho é outro: [[imagens-atlas]].
- Ver também [[sintese-decisoes-arquiteturais]].
