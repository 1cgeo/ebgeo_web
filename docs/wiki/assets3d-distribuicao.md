# Distribuição de binários 3D (/assets3d)

Rota que serve tilesets e binários 3D como arquivos imutáveis, com dois backends de armazenamento (SQLite e filesystem) que expõem o mesmo contrato HTTP. O contrato está no código; esta página cobre o que ele não conta.

## O regime segue o RECURSO, não a rota

Esta seção dizia "a rota é pública por decisão, não por esquecimento", e dizia junto que a proteção era "quem não conhece a URL não baixa". Era verdade e era o buraco: a URL do modelo viaja no payload aditivo de `/api/v1/resource-access/visible`, e quem a recebe legitimamente pode repassar o caminho. A fase F11 fechou isso sem tirar do anônimo o que ele precisa.

Continua havendo **um caminho só**, e ele decide o regime por requisição a partir de um índice EM MEMÓRIA que mapeia caminho servido para linha de catálogo (`regimeDoCaminho`, `backend/src/modules/nomes/assets3d-regime.js`):

- **modelo público**: 200 sem credencial nenhuma, `public, max-age=31536000, immutable`, ETag e Range exatamente como sempre foram. Vale também para todo caminho que nenhuma linha de catálogo reivindica;
- **modelo privado**: passa por `gateDeAsset3d` (`backend/src/modules/nomes/assets3d-acesso.js`) e volta `private` e imutável, com `Vary`: cacheável no navegador e nunca num cache compartilhado. Quem não o alcança recebe **404**, não 403, porque modelo escondido precisa ser indistinguível de modelo inexistente, que é a mesma escada de `enforceProjectReadable` no 360.

O que autoriza um privado são dois braços, e o cliente manda os dois quando os tem (`descritorDeAsset`, `frontend/src/js/store/sync/assets3d-request.js`): `?atlasId=` diz QUAL empréstimo o chamador quer usar, e `Authorization: Bearer` diz quem ele é. O UUID do atlas **não é senha**, porque o servidor roda `requireAtlasPermission` sobre ele, o mesmo gate do 360 e do payload aditivo. É por esse braço que o visitante ANÔNIMO de um atlas de link público continua vendo o tileset que aquele atlas empresta.

**Nenhuma consulta ao banco por requisição de asset.** É a restrição que dá forma ao desenho: o Cesium abre uma requisição por tile por LOD, e pôr essa explosão no pool de dez conexões a faria competir com o sync, com o socket de colaboração e com o `GET /api/config`, cuja falha impede o boot. Caminho público é resolvido só em memória; caminho privado paga UMA decisão por par (chamador, recurso), memoizada. Medido em `backend/tests/integration/assets3d-privado.test.js` com o contador de pool: 20 requisições públicas e 20 privadas do mesmo chamador custam zero consultas.

**O casamento do índice dobra a SOLETRAÇÃO do caminho**, e a razão é que os dois lados da
decisão não falam a mesma língua: o índice normaliza em posix, e quem serve os bytes no ramo
de filesystem é `path.resolve`, cuja semântica é a do HOST. Em Windows e macOS a pasta em caixa
alta, a mesma em caixa baixa e a mesma escrita com barra invertida endereçam o MESMO arquivo, então
enquanto a comparação era de string crua essas grafias não casavam linha nenhuma, o regime
saía PÚBLICO e o anônimo recebia o tileset privado com um ano de cache compartilhado. Medido
e fechado em `chaveDeCasamento` (`backend/src/modules/nomes/assets3d-regime.js`); o erro só
pode cair para o lado fechado, porque dobrar caixa e barra faz MAIS caminhos casarem uma linha
privada, nunca menos. Repare que a busca por `rel_path` no SQLite continua de igualdade EXATA:
são perguntas diferentes (quem PODE ver contra onde ESTÃO os bytes) e vivem em lugares
diferentes de propósito.

O índice é invalidado por `invalidateAppConfigCache` (`backend/src/modules/config/config.cache.js`), que toda escrita de catálogo e de visibilidade já chamava.

**O que continua aberto, e por quê.** Só o que esta rota não vê: prefixo de catálogo servido por outro processo (a URL canônica `/3d/...` sai do nginx, ou do Vite em desenvolvimento, e nunca chega aqui), e por isso "os bytes privados estão fechados" é afirmação sobre esta rota, não sobre o servidor web. O `fileoverview` de `backend/src/modules/nomes/assets3d-regime.js` nomeia esse limite e os outros dois do índice, para que a cobertura dele não seja lida como completa. E o endereço que o NAVEGADOR busca sozinho (uma imagem, um vídeo, um loader de terceiro) não carrega cabeçalho: para um recurso privado ele depende do braço de empréstimo, isto é, de haver um atlas em foco que o empreste. Fechar esse último caso exigiria cookie de sessão emitido no login, que é o eixo de autenticação e não o desta fase.

Ver [[hardening-borda-api]] e [[sintese-cache-http-imutavel]].

Fora do sync: sem operação, sem fila. Ver [[sintese-modulos-fora-do-sync]].

## Nunca hardcode o prefixo da URL

A regra vale; o mecanismo que esta seção descrevia, não. Ela dizia que a URL final era a junção de `assets3dBaseUrl` com o caminho do catálogo, e o frontend nunca fez essa concatenação: `assets3dBaseUrl` é publicado pelo `/api/config` e **não tem um leitor sequer** em `frontend/src/`. O catálogo guarda a URL de site pronta e o cliente a usa verbatim. Ou seja, hardcodar `/api/v1/assets3d` no cliente continua errado, e quem decide o prefixo é a LINHA DE CATÁLOGO, não uma junção em tempo de execução. Contrato congelado, ver [[config-runtime-urls-relativas]], [[config-dinamico]] e [[sintese-contratos-congelados]].

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

E uma ordem que puxa para o lado contrário, pela razão contrária: o gate de recurso roda **antes** do 304, e não depois. Responder 304 a quem não pode ver o modelo confirma a existência dele e ainda entrega o ETag. O que torna isso pagável é o gate não custar nada no caminho quente: caminho público é uma consulta a um índice em memória, caminho privado é uma decisão memoizada. Medido em série, 60 amostras por caso, o 304 público ficou em 0,47 ms (era 0,64 na mesma máquina antes da mudança, dentro do ruído) e o 304 privado em 0,53 ms.

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
- Nunca `401` aqui, e desde a F11 a frase precisa do sujeito: **modelo PÚBLICO** nunca responde 401 nem 403 por falta de token. Modelo privado que o chamador não alcança responde **404**, que é a escada da casa e não vaza existência. Formato de erro em [[erros-api]].
- Para blobs de usuário, que **são** sincronizados, o caminho é outro: [[imagens-atlas]].
- Ver também [[sintese-decisoes-arquiteturais]].
