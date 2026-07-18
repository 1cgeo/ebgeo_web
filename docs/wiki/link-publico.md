# Link Público e Token de Visitante

Mecanismo de acesso anônimo em que um link opaco gerado por quem tem `manage` permite trocar a URL pública por um JWT de 1 hora com `permission: 'read'` e identidade "Visitante", usável em REST, pull de sync e WebSocket de colaboração.

## O link não é a autoridade

O link é um token opaco aleatório (`backend/src/modules/atlas/atlas.service.js:453-454`), não um JWT: é só chave de busca. A autoridade vem do JWT emitido na troca **somado** à releitura ao vivo de `atlas.is_public`, tanto no REST (`backend/src/middleware/permissions.js:30-48`) quanto no upgrade do socket (`backend/src/modules/collab/collab.gateway.js:52-67`). Nada de permissão viaja no link.

**Ligar/desligar rotaciona o link.** `enablePublicSharing` sempre gera um link novo e sobrescreve o anterior (`backend/src/modules/atlas/atlas.service.js:459-462`). Um toggle off/on, ou dois cliques em "gerar", **mata todos os links já distribuídos**. Não existe rotação explícita nem múltiplos links por [[atlas-modelo-de-dados]]: foi decidido assim para manter uma coluna única (`public_link VARCHAR(100) UNIQUE`, `migrations/002_atlas.sql:41`) em vez de uma tabela de links, ao custo de não poder revogar um destinatário sem revogar todos.

Link errado, atlas na lixeira e link desativado caem no mesmo 404, porque o filtro está dentro do `WHERE` da busca (`backend/src/modules/atlas/atlas.queries.js:78-83`). Indistinguível de propósito, contra enumeração (ver [[erros-api]] e [[hardening-borda-api]]).

## Armadilha central: `is_public` vale para todo mundo

`resolvePermission` devolve `'read'` para *qualquer* principal quando `is_public = true` (`backend/src/middleware/permissions.js:42-44`), não só para portadores do link. Publicar um atlas concede leitura a **todo usuário logado que souber o `atlasId`**, com share ou sem share. O link opaco protege apenas contra quem não conhece o id; ele não é o gate, é a descoberta.

## O prefixo `public-` é contrato congelado

O `sub` do token é `public-<uuid>`, deliberadamente fora do formato UUID puro (`backend/src/modules/atlas/atlas.service.js:143-146`). Três lugares dependem dessa convenção como teste de tipo de principal, e nenhum deles é visível a partir dos outros:

- `backend/src/middleware/auth.js:80-82` pula a reconciliação com o banco (não existe linha em `users` para esse `sub`);
- `backend/src/middleware/permissions.js:92` pula a busca em `atlas_shares`;
- `backend/src/modules/collab/collab.gateway.js:331-335,444` não cria nem apaga linha em `active_sessions`, senão a FK para `users` quebraria.

Emitir um `sub` UUID no token público derruba os três de uma vez, e os dois primeiros falham *silenciosamente* (viram consulta vazia), não com erro. Ver [[jwt-emissor-unico]] e [[autenticacao-jwt]].

No handshake a identidade é sobrescrita por valores fixos (`backend/src/modules/collab/collab.gateway.js:270-275`): visitante não pode herdar `posto`, `role` ou `organization_id` do token, porque nenhum campo desses foi assinado por uma identidade real ([[canal-collab-websocket]]).

## Revogação: imediata no REST, uma batida no socket

Como toda verificação relê `is_public`, o token perde valor na próxima requisição REST, sem esperar o `exp` de 1 hora. Sockets já abertos têm janela: `reconcileAuthorization` roda por heartbeat (~30s, `backend/src/modules/collab/collab.gateway.js:118-143,289`) e fecha com `4003 'access revoked'`. Fechamento limpo, ou seja, o peer sai da presença na hora, sem passar pelo estado `away` ([[presenca-colaborativa]]).

## O que o tier `read` esconde

Comentários espaciais são retirados do que chega a um `read`, tanto no snapshot (`backend/src/modules/sync/sync.service.js:456-458`) quanto no pull incremental (`backend/src/modules/sync/sync.service.js:797-798`). Isso **não** é regra de "público": vale igualmente para o Visualizador logado ([[sintese-capacidades-por-papel]]). Quem for adicionar um novo tipo de entidade sensível precisa repetir o filtro nos dois pontos, que são independentes. Ver [[comentario-espacial]] e [[snapshot-e-pull-incremental]].

## Custos do boot público (cliente)

O boot por `?atlasPublico=<link>` só dispara se ninguém estiver logado (`index.js:226-228`). Dentro dele, três decisões não óbvias:

- **`clearAllDataStore()` roda sem confirmação** (`index.js:231`). Abrir um link público numa aba que tinha desenho local anônimo **descarta o desenho**. Ver [[dominio-local-vs-remoto]] e [[sessao-boot-e-ciclo-de-vida]].
- **`connectPublic` desliga o log de operações** (`src/js/store/sync/sync-engine.js:227`). Se o visitante enfileirasse ops, elas ficariam órfãs na fila e seriam empurradas para o atlas errado num login posterior ([[fila-operacoes-outbound]]).
- **O token é efêmero em memória e zera o refresh token** (`src/js/store/sync/api-client.js:117-120`), porque a fonte de verdade num F5 é o link na URL, não o storage. Não há caminho especial de WS: o mesmo `wsUrl()` leva o token de visitante ([[client-id-estavel]]).

O overlay de configuração por atlas continua valendo para o visitante (`src/js/store/sync/sync-engine.js:235`), então restrições de 3D/360/basemaps de [[atlas-settings]] se aplicam.

## Lacunas conhecidas

- **Não existe renovação do token.** `setEphemeralToken` não arma timer e nada rechama `getPublicAtlas` depois do boot. O socket aberto sobrevive (a permissão é revalidada contra o banco, não contra o `exp`), mas uma **reconexão** após 1 hora falha com 401 no upgrade (`backend/src/modules/collab/collab.gateway.js:240-244`); a única recuperação é recarregar a página.
- **A UI copia o token cru, não uma URL.** `src/js/modals/sharing.modal.js:542-551` escreve `cfg.publicLink` no clipboard; o usuário precisa montar `…/?atlasPublico=<token>` na mão. É a lacuna mais visível da feature hoje.
- **A resposta vaza mais que o mínimo.** `res.json({ data: atlas })` devolve `SELECT a.*` mais `owner_nome`/`owner_username` (`backend/src/modules/atlas/atlas.controller.js:59-62`, `backend/src/modules/atlas/atlas.queries.js:78-83`), sem projeção e sem auth, atrás apenas do `publicLinkLimiter`. Identidade do dono, `owner_id` e o próprio `public_link` saem para chamador anônimo. Se um dia a projeção for reduzida, o boot só exige de fato `id` e `publicToken`. Consequência para consumidores: o corpo é snake_case do banco com **um** campo camelCase enxertado (`publicToken`, grudado em `backend/src/modules/atlas/atlas.service.js:156`).

## Divergências com o guia

> **Nota histórica.** O guia *07-compartilhamento* (absorvido) descreve a URL pública como caminho (`/atlas/public/abc123xyz`, via `location.pathname`), um `PublicTokenManager` que renova o token 5 minutos antes de expirar, e uma resposta enxuta sem `owner`. Nenhum dos três existe: o front usa query string (`index.js:226`, fixado em `tests/unit/atlas-link.test.js:73-77`), não há renovação, e `backend/src/modules/sharing/sharing.service.js:12-21` devolve o bloco `owner` que o modal consome (`src/js/modals/sharing.modal.js:181`). O caminho `/atlas/public/:link` existe apenas como rota de API (`backend/src/modules/atlas/atlas.routes.js:23`).

## Ver também

[[compartilhamento-atlas]] · [[permissoes-atlas]] · [[api-rest-atlas]] · [[imagens-atlas]] · [[modos-operacao]] · [[sintese-eixos-de-permissao]]
