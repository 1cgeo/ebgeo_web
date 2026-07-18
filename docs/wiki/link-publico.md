# Link Público e Token de Visitante

Mecanismo de acesso anônimo em que um link opaco gerado por quem tem `manage` permite trocar a URL pública por um JWT de 1 hora com `permission: 'read'` e identidade "Visitante", usável em REST, pull de sync e WebSocket de colaboração.

## O que é o "link" (e o que não é)

O link é um **token opaco aleatório**, não um JWT: `crypto.randomBytes(16).toString('hex')`, 32 caracteres hex (`atlas.service.js:453-455`). Ele é gravado em `atlas.public_link` (coluna `VARCHAR(100) UNIQUE`, com índice parcial `WHERE public_link IS NOT NULL`, `migrations/002_atlas.sql:41,53`) junto com `is_public = true`.

Duas coisas decorrem disso e são fáceis de errar:

- **O link não carrega permissão nenhuma.** Ele é só uma chave de busca. A autoridade real vem do JWT emitido na troca, somado à verificação **ao vivo** de `atlas.is_public`.
- **Ligar/desligar rotaciona o link.** `enablePublicSharing` sempre gera um link novo e sobrescreve o anterior (`atlas.service.js:460-462`), e `disablePublicSharing` grava `is_public = false, public_link = NULL` (`atlas.service.js:474-475`). Um toggle off/on (ou dois cliques em "gerar") **mata todos os links já distribuídos**. Não existe rotação explícita nem múltiplos links por [[atlas-modelo-de-dados]].

Ambas as rotas são `manage` (`sharing.routes.js:16-17`), coerente com o resto de [[compartilhamento-atlas]] e com a escada de [[permissoes-atlas]]. Cada uma emite `sharing_updated` (`public_enabled`/`public_disabled`) para a sala do atlas (`sharing.controller.js:14,20`), então quem já está conectado sabe que a configuração mudou.

## A troca: link opaco → JWT de visitante

`GET /api/v1/atlas/public/:link` é a **única rota de atlas sem `auth`** (`atlas.routes.js:23`). Ela roda atrás do `publicLinkLimiter` (por IP, sem body: 30 requisições/minuto por padrão, `rate-limit.js:39-47` + `config.js:97-98`), parte do desenho descrito em [[hardening-borda-api]].

A busca já embute a autorização: `WHERE a.public_link = $1 AND a.deleted_at IS NULL AND a.is_public = true` (`atlas.queries.js:78-83`). Link errado, atlas na lixeira ou link desativado caem todos no mesmo `NotFoundError` (404), sem distinguir os casos, o que é a resposta certa para um enumerador (ver [[erros-api]]).

Achando o atlas, o serviço assina o token (`atlas.service.js:143-156`):

```
sub:        `public-${crypto.randomUUID()}`   // NÃO é UUID puro, de propósito
atlasId:    <id do atlas>
isPublic:   true
permission: 'read'
nome:       'Visitante'
exp:        iat + 1h
```

Assinado com o mesmo `config.jwt.secret` dos tokens de conta (ver [[jwt-emissor-unico]] e [[autenticacao-jwt]]). Um novo `sub` é sorteado a **cada** chamada: dois GETs no mesmo link produzem dois "visitantes" distintos.

O prefixo `public-` é uma **convenção de tipo de principal**, não decoração. Como `sub` não casa com o regex de UUID:

- `auth.js:80-82` pula a reconciliação com o banco (`getLiveAuthState`) porque não existe linha em `users` para esse `sub`; a comentário no código diz explicitamente que a autoridade vem "do token assinado mais o flag `is_public` do atlas".
- `permissions.js:92` pula a busca em `atlas_shares` pelo mesmo motivo.
- `collab.gateway.js:331-335` e `:444` não criam nem apagam linha em `active_sessions` para visitantes, senão a FK para `users` quebraria.

Quebrar essa convenção (por exemplo, passar a emitir um `sub` UUID no token público) derruba os três lugares de uma vez.

## Como o 'read' é resolvido em cada superfície

O token só diz `permission: 'read'`; quem decide de verdade é o servidor, em três caminhos separados que precisam concordar:

**REST** — `requireAtlasPermission` chama `resolvePermission({ userId, ownerId, share, isPublic })` (`permissions.js:30-48`). Sem dono e sem share, o `isPublic` do **banco** (não do token) devolve `'read'`. Isso vale para `GET /atlas/:id/sync/:version` (gate `read`) e para as imagens do atlas ([[imagens-atlas]]); o push de operações exige `comment` e portanto é barrado antes de qualquer lógica (`sync.routes.js`).

**WebSocket** — o gateway tem um ramo dedicado (`collab.gateway.js:52-67): se `payload.isPublic`, ele **exige que `payload.atlasId === atlasId` do query string** (um token público de um atlas não abre outro) e reconsulta `is_public` no banco antes de devolver `'read'`. Na conclusão do handshake a identidade é substituída de forma fixa: `username: 'visitante'`, `nome: 'Visitante'`, `posto: null`, `role: 'user'`, `organization_id: null` (`collab.gateway.js:270-275`). Detalhes do canal em [[canal-collab-websocket]] e [[canal-collab-websocket]].

**Handlers do canal** — `permission === 'read'` faz `handleOperation`/`handleOperations` responderem `error/FORBIDDEN` (`collab.handlers.js:114-121,166`) e `handleSelection` retornar em silêncio (`collab.handlers.js:83`). Cursor, `ping` e `temporal` continuam abertos: o visitante **vê e é visto** como presença, mas não emite seleção (ver [[presenca-colaborativa]], onde o gate de seleção está descrito).

## Revogação: imediata no REST, ~30s no socket

Desligar o link não depende do `exp` de 1 hora. Como cada verificação relê `is_public`, um token público já emitido perde valor **na próxima requisição** REST (404/403).

Para sockets já abertos existe uma janela: `reconcileAuthorization` roda a cada batida de heartbeat (`collab.gateway.js:118-143`, intervalo `config.ws.heartbeatIntervalMs`, ~30s, `:289`) e, ao ver `resolvePermission` devolver `null`, fecha com `4003 'access revoked'`. Código de fechamento limpo, ou seja, o peer sai da presença na hora, sem passar pelo estado `away` (ver [[presenca-colaborativa]]).

**Armadilha de modelagem:** `resolvePermission` devolve `'read'` para *qualquer* principal quando `is_public = true` (`permissions.js:42-44`), não só para portadores do link. Publicar um atlas concede leitura a **todo usuário logado que souber o `atlasId`**, mesmo sem share e sem o link. O link opaco protege apenas contra quem não conhece o id.

## O que o visitante realmente recebe

O gate de leitura não é uniforme: **comentários espaciais são retirados** do que chega a um `read`.

- `getAtlasSnapshot` só monta `commentsByMap` quando `permission !== 'read'` (`sync.service.js:454-458`).
- `pullOperations` filtra `entityType === 'comment'` quando `permission === 'read'` (`sync.service.js:797-798`).

Ou seja, o visitante vê mapas, camadas, feições, briefings e as ops delas, mas nunca as discussões (ver [[comentario-espacial]]). Isso vale para o Visualizador logado também; é regra de tier, não de "público". O restante do formato do snapshot está em [[snapshot-e-pull-incremental]].

## O fluxo no cliente

O front resolve o link **por query string**, não por caminho: `?atlasPublico=<link>` em `src/js/index.js:226`. O boot só entra nesse ramo se ninguém estiver logado (`sessionContext.isAuthenticated()` falso, `index.js:228`) e faz, em ordem (`index.js:229-235`):

1. `apiClient.getPublicAtlas(link)` — `{ auth: false }` (`api-client.js:628-630`);
2. `apiClient.setEphemeralToken(atlas.publicToken)` — grava **só em memória** e zera o refresh token (`api-client.js:117-120`); o token público nunca vai para `localStorage`, porque a fonte de verdade em um F5 é o link na URL;
3. `clearAllDataStore()` + `markStoreRemote(atlas.id)` — o store passa a ser remoto (ver [[dominio-local-vs-remoto]]);
4. `syncEngine.connectPublic(atlas.id)`;
5. `activateAtlasInitialMap()` e um toast "Visualização pública, somente leitura".

**Isso apaga o trabalho local do visitante.** `clearAllDataStore()` roda antes de qualquer confirmação nesse caminho; abrir um link público em uma aba que tinha desenho local anônimo descarta o desenho. Contexto do ciclo de boot em [[sessao-boot-e-ciclo-de-vida]].

`connectPublic` (`sync-engine.js:213-237`) difere de `connect` em dois pontos que importam:

- chama `disableOperationLogging()` (`:227`). Um visitante **nunca** enfileira operações; se enfileirasse, elas ficariam órfãs na fila e seriam empurradas para o atlas errado num login posterior (ver [[fila-operacoes-outbound]]);
- chama `sessionContext.setVisitorSession()` (`:232`), que fixa `role = VIEWER`, `userId = null`, `_isVisitor = true` (`session-context.js:264-273`). Como `isAuthenticated()` exige `!_isVisitor` (`session-context.js:197`), o menu de conta não aparece e o `permission-guard` bloqueia edição no store remoto. A distinção papel/permissão está em [[permissoes-atlas]] e [[sintese-capacidades-por-papel]].

O overlay de configuração por atlas continua valendo para o visitante (`sync-engine.js:235`): ele respeita as restrições de 3D/360/basemaps de [[atlas-settings]].

O token vai para o socket pelo mesmo caminho de um usuário normal: `wsUrl()` monta `…/collab?atlasId=&token=<accessToken atual>&clientId=` (`api-client.js:935-940`), e o `clientId` é o id estável de sempre ([[client-id-estavel]]). Não há caminho especial de WS para visitante, apenas um token diferente no mesmo parâmetro.

## Divergências com o guia

> **Nota histórica.** guia *07-compartilhamento* (absorvido) §3.1 e §4.1 descrevem a URL pública como um caminho (`/atlas/public/abc123xyz`, detectado por `location.pathname.startsWith('/atlas/public/')`); o código em `src/js/index.js:226` usa a query string `?atlasPublico=<link>` sobre a raiz do app, e `tests/unit/atlas-link.test.js:73-77` fixa que esse parâmetro é preservado ao limpar a URL. O caminho `/atlas/public/:link` existe apenas como rota **de API** (`atlas.routes.js:23`).

> **Nota histórica.** guia *07-compartilhamento* (absorvido) §4.4 descreve um `PublicTokenManager` que renova o token 5 minutos antes de expirar; não existe renovação implementada. `setEphemeralToken` (`api-client.js:117-120`) apenas grava o token, sem timer, e nada mais chama `getPublicAtlas` depois do boot. Na prática o socket aberto sobrevive (a permissão é revalidada contra o banco, não contra o `exp`), mas uma **reconexão** depois de 1 hora falha com 401 no upgrade (`collab.gateway.js:241-246`); a recuperação real é recarregar a página, que reexecuta a troca link → token.

> **Nota histórica.** guia *07-compartilhamento* (absorvido) §1.2 mostra a resposta de `GET /atlas/:id/sharing` sem o bloco `owner`; `sharing.service.js:12-21` devolve `{ isPublic, publicLink, owner: { userId, username, nome }, shares }`, e o modal consome esse campo (`sharing.modal.js:181`).

Além disso, a UI **copia o token cru, não uma URL**: `sharing.modal.js:180` guarda `cfg.publicLink` e `_handleCopyLink` (`:542-551`) escreve exatamente isso no clipboard. O usuário precisa montar `…/?atlasPublico=<token>` na mão. É a lacuna mais visível dessa feature hoje.

## Ver também

[[compartilhamento-atlas]] · [[permissoes-atlas]] · [[api-rest-atlas]] · [[autenticacao-jwt]] · [[canal-collab-websocket]] · [[modos-operacao]] · [[sintese-eixos-de-permissao]]


## Shape da resposta de `GET /atlas/public/:link`

## Shape da resposta de `GET /atlas/public/:link`

O controller devolve a linha do atlas **sem projeção**: `res.json({ data: atlas })` (`atlas.controller.js:59-62`), sendo `atlas` o resultado de `FIND_ATLAS_BY_PUBLIC_LINK`, que é `SELECT a.*` mais dois campos do dono (`atlas.queries.js:78-83`), com `publicToken` grudado em memória depois da assinatura (`atlas.service.js:157`).

O corpo é, portanto, **snake_case do banco com um campo camelCase enxertado**:

```json
{
  "data": {
    "id": "atlas-uuid",
    "owner_id": "owner-uuid",
    "name": "Operação Alfa",
    "description": "Atlas da operação",
    "settings": { },
    "map_order": ["map-uuid-1", "map-uuid-2"],
    "is_public": true,
    "public_link": "a1b2c3…",
    "version": 12,
    "created_at": "2024-01-15T10:30:00.000Z",
    "updated_at": "2024-01-17T09:00:00.000Z",
    "deleted_at": null,
    "owner_username": "cap.silva",
    "owner_nome": "Capitão Silva",
    "publicToken": "eyJhbGciOiJIUzI1NiIs…"
  }
}
```

| Campo | Origem | Observação |
|---|---|---|
| `id`, `name`, `description`, `settings`, `map_order`, `version` | `a.*` | mesmos campos de [[atlas-modelo-de-dados]] |
| `owner_id`, `created_at`, `updated_at`, `deleted_at` | `a.*` | expostos ao visitante anônimo |
| `public_link` | `a.*` | o próprio link volta na resposta |
| `owner_username`, `owner_nome` | `JOIN users` | identidade do dono exposta sem auth |
| `publicToken` | assinado no service | **único** campo camelCase do corpo |

Duas consequências práticas:

- **Não escreva o consumidor esperando camelCase.** `map_order` e `is_public` chegam em snake_case; só `publicToken` foge do padrão. O boot do cliente lê exatamente `atlas.id` e `atlas.publicToken` (`index.js:229-233`), o resto do objeto passa adiante como veio.
- **A rota vaza mais do que o mínimo.** Nome e username do dono, `owner_id` e o próprio `public_link` saem para um chamador sem autenticação, atrás apenas do `publicLinkLimiter`. Se um dia a projeção for reduzida, `id` e `publicToken` são os dois campos que o boot realmente exige. Ver [[hardening-borda-api]].

> **Nota histórica.** guia *07-compartilhamento* (absorvido) §3.2 mostra a resposta apenas com `id`, `name`, `description`, `settings`, `map_order`, `is_public` e `publicToken`; a query real é `SELECT a.*` mais `owner_nome`/`owner_username` (`atlas.queries.js:78-83`), ou seja, o corpo traz também `owner_id`, `public_link`, `version` e os timestamps.

## Fontes
- guia *07-compartilhamento* (absorvido): contrato das rotas de link público (POST/DELETE `/sharing/public`, `GET /atlas/public/:link`), forma do payload do `publicToken`, tabela de limitações do acesso público e fluxo pretendido no frontend (usado como base, com três divergências marcadas acima).
- `ebgeo_backend/src/modules/atlas/atlas.service.js:133-159,453-482`: geração do link (16 bytes hex), assinatura do JWT de visitante (1h, `sub: public-<uuid>`), ativação/desativação.
- `ebgeo_backend/src/modules/atlas/atlas.queries.js:78-93` e `migrations/002_atlas.sql:41,53`: consulta por link com filtro `is_public`/`deleted_at`, coluna e índice.
- `ebgeo_backend/src/modules/atlas/atlas.routes.js:23` e `middleware/rate-limit.js:39-47` + `config.js:97-98`: única rota sem `auth`, sob limitador por IP.
- `ebgeo_backend/src/modules/sharing/{sharing.routes.js:16-17,sharing.controller.js:12-22,sharing.service.js:12-21}`: gate `manage`, broadcast `sharing_updated`, resposta com `owner`.
- `ebgeo_backend/src/middleware/{permissions.js:30-48,92,auth.js:9,80-82}`: resolução de permissão para principal público e isenção de reconciliação com o banco.
- `ebgeo_backend/src/modules/collab/{collab.gateway.js:52-67,249-276,331-335,118-143,289,444,collab.handlers.js:83,114-121,166}`: validação de `atlasId` no token, identidade "Visitante", ausência de `active_sessions`, revogação por heartbeat (4003) e bloqueio de operações/seleção.
- `ebgeo_backend/src/modules/sync/{sync.service.js:454-458,797-798,sync.routes.js}`: comentários ocultados do tier `read` no snapshot e no pull; push exige `comment`.
- `ebgeo_web/src/js/index.js:220-241`: boot por `?atlasPublico=`, ordem das chamadas e limpeza do store local.
- `ebgeo_web/src/js/store/sync/{api-client.js:112-120,628-630,935-940,sync-engine.js:205-237,session-context.js:197,264-273}`: token efêmero não persistido, `connectPublic` sem logging de operações, sessão de visitante.
- `ebgeo_web/src/js/modals/sharing.modal.js:176-188,294-332,519-551`: toggle do link público e cópia do token cru.
- `ebgeo_web/tests/unit/atlas-link.test.js:55-77` e `tests/e2e-ui/browser-authz-ui.spec.js:9-10`: preservação do parâmetro `atlasPublico` e cobertura e2e do visitante bloqueado para edição.
