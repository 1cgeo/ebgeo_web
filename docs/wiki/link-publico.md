# Link Público e Token de Visitante

Mecanismo de acesso anônimo em que um link opaco gerado por quem tem `manage` permite trocar a URL pública por um JWT de 1 hora com `permission: 'read'` e identidade "Visitante", usável em REST, pull de sync e WebSocket de colaboração.

## O link expõe mais que o atlas, e desde 2026-08-29 quem publica é avisado

O empréstimo que o atlas faz de um recurso privado **alcança o visitante do link** (cláusula 6.3 da [`CONSTITUICAO.md`](../../CONSTITUICAO.md)). Isso vale para camada de dados, análise, basemap, modelo 3D e projeto 360, e vale **mesmo com o visitante deslogado**.

**A regra foi reexaminada e MANTIDA**, e o caminho até a manutenção é o que a torna defensável. A proposta era restringi-la a quem tem conta, e ela caiu por um argumento do dono: o auto-cadastro é aberto, então "estar logado" não é barreira nenhuma, e quem quisesse o recurso criaria uma conta. O eixo que separa de verdade não é autenticação, é **nomeação**: um share nominal significa que alguém com autoridade escolheu aquela pessoa, e o link público é o único caminho em que ninguém decidiu quem entra. O dono decidiu que a nomeação continua não sendo exigida aqui.

**O que faltava não era o predicado, era o consentimento** (cláusula 6.6): um empréstimo é invisível para quem publica. Ao abrir o modal de compartilhamento, a seção do link nomeia os recursos privados que o atlas empresta, e o aviso aparece **antes** do link e **independe de ele estar ligado**, porque quem vai ligá-lo é justamente quem ainda não sabe o que está prestes a expor. As frases moram em `frontend/src/js/modals/link-publico-phrases.js`, e a lista vem de `GET /api/v1/atlas/:atlasId/resources`, que devolve `name` e `access_level` por item.

Duas consequências que não se adivinham. O aviso **não** conta, nomeia: "3 recursos privados" não permite decidir nada. E um empréstimo **órfão** (a linha de catálogo sumiu) não entra nele, porque não expõe byte nenhum; contá-lo encheria o aviso de fantasmas e treinaria o dono a ignorá-lo.

**O que o visitante NÃO alcança**, e é limite de plataforma e não decisão: a foto de item de uma cena 3D de primeira pessoa emprestada. Ela vira `img.src`, que só o cookie de sessão alcança, e o visitante não tem cookie (o token dele é efêmero e mora só em memória, por contrato do cliente). Um cookie para ele seria pior: cookie é por navegador e não por aba, e sobrescreveria a sessão de quem estivesse logado noutra aba. Ver [[tile-privado]] para os três transportes de credencial.

## O link não é a autoridade

O link é um token opaco aleatório (`generatePublicLink`, `backend/src/modules/atlas/atlas.service.js`), não um JWT: é só chave de busca. A autoridade vem do JWT emitido na troca **somado** à releitura ao vivo de `atlas.is_public`, tanto no REST (`backend/src/middleware/permissions.js`) quanto no upgrade do socket (`backend/src/modules/collab/collab.gateway.js`). Nada de permissão viaja no link.

**Ligar/desligar rotaciona o link.** `enablePublicSharing` sempre gera um link novo e sobrescreve o anterior. Um toggle off/on, ou dois cliques em "gerar", **mata todos os links já distribuídos**. Não existe rotação explícita nem múltiplos links por [[atlas-modelo-de-dados]]: foi decidido assim para manter uma coluna única (`public_link VARCHAR(100) UNIQUE`, `backend/src/database/migrations/003_atlas.sql`) em vez de uma tabela de links, ao custo de não poder revogar um destinatário sem revogar todos.

Link errado, atlas na lixeira e link desativado caem no mesmo 404, porque o filtro está dentro do `WHERE` da busca (`backend/src/modules/atlas/atlas.queries.js`). Indistinguível de propósito, contra enumeração (ver [[erros-api]] e [[hardening-borda-api]]).

## Armadilha central: `is_public` vale para todo mundo

`resolvePermission` devolve `'read'` para *qualquer* principal quando `is_public = true` (`backend/src/middleware/permissions.js`), não só para portadores do link. Publicar um atlas concede leitura a **todo usuário logado que souber o `atlasId`**, com share ou sem share. O link opaco protege apenas contra quem não conhece o id; ele não é o gate, é a descoberta.

## O visitante é confinado pelo claim, e isento pelo `sub`

São dois marcadores no mesmo token, com papéis diferentes, e confundi-los é o erro fácil aqui:

- **`isPublic` confina.** O token é escopado ao atlas que o emitiu, e a checagem vem **antes** de qualquer isenção (`backend/src/middleware/auth.js`, com o par em `backend/src/middleware/permissions.js`). Sem esse confinamento, um único link público dava leitura em **todo** atlas público, porque o ramo `isPublic` de `resolvePermission` não olha qual atlas emitiu o token.
- **O `sub` no formato `public-<uuid>` isenta.** Deliberadamente fora do formato UUID puro, ele é o que faz pular a reconciliação com o banco (não existe linha em `users` para esse `sub`) e a busca em `atlas_shares`. Emitir um `sub` UUID no token público derruba as duas de uma vez, e ambas falham *silenciosamente* (viram consulta vazia), não com erro. Ver [[jwt-emissor-unico]] e [[autenticacao-jwt]].

No handshake a identidade é sobrescrita por valores fixos (`backend/src/modules/collab/collab.gateway.js`): visitante não pode herdar `posto`, `role` ou `organization_id` do token, porque nenhum campo desses foi assinado por uma identidade real ([[canal-collab-websocket]]).

## Revogação: imediata no REST, uma batida no socket

Como toda verificação relê `is_public`, o token perde valor na próxima requisição REST, sem esperar o `exp` de 1 hora. Sockets já abertos têm janela: `reconcileAuthorization` roda por heartbeat (~30 s) e fecha com `4003 'access revoked'`. Fechamento limpo, ou seja, o peer sai da presença na hora, sem passar pelo estado `away` ([[presenca-colaborativa]]).

## O que o tier `read` esconde

Comentários espaciais são retirados do que chega a um `read`, tanto no snapshot quanto no pull incremental (`backend/src/modules/sync/sync.service.js`, em dois pontos independentes). Isso **não** é regra de "público": vale igualmente para o Visualizador logado ([[sintese-capacidades-por-papel]]). Quem for adicionar um novo tipo de entidade sensível precisa repetir o filtro nos dois pontos. Ver [[comentario-espacial]] e [[snapshot-e-pull-incremental]].

## Custos do boot público (cliente)

O boot por `?atlasPublico=<link>` só dispara se ninguém estiver logado (`openPublicAtlasFromUrl`, `frontend/src/js/index.js`). Dentro dele, três decisões não óbvias:

- **O wipe roda sem confirmação, e desde o namespace por atlas ele não cai mais sobre o desenho local.** `activateRemoteAtlas` vem ANTES do `clearAllDataStore`, então o que se esvazia é o namespace `remote-<id>` da própria visita; o trabalho anônimo fica no slot local e volta a aparecer quando a visita termina. Antes disso o visitante perdia o desenho, e por um segundo motivo já corrigido: a varredura de namespaces remotos pendurava dentro do wipe sob "ninguém autenticado", e destruía o namespace que a visita acabara de registrar, jogando o snapshot público no banco local ([[namespace-por-atlas]]). Ver também [[dominio-local-vs-remoto]] e [[sessao-boot-e-ciclo-de-vida]].
- **`connectPublic` desliga o log de operações.** Se o visitante enfileirasse ops, elas ficariam órfãs na fila e seriam empurradas para o atlas errado num login posterior ([[fila-operacoes-outbound]]).
- **O token é efêmero em memória e zera o refresh token** (`setEphemeralToken`, `frontend/src/js/store/sync/api-client.js`), porque a fonte de verdade num F5 é o link na URL, não o storage. Não há caminho especial de WS: o mesmo `wsUrl()` leva o token de visitante ([[client-id-estavel]]).

O overlay de configuração por atlas continua valendo para o visitante, então restrições de 3D/360/basemaps de [[atlas-settings]] se aplicam.

## Propriedades permanentes do desenho

- **A sessão de visitante tem teto de uma hora, e não há renovação.** `setEphemeralToken` não arma timer e nada rechama `getPublicAtlas` depois do boot. O socket já aberto sobrevive ao `exp`, porque a permissão é revalidada contra o banco e não contra o token; o que morre é a **reconexão**, que volta 401 no upgrade. A recuperação é recarregar a página, e é a mesma recuperação para qualquer perda de contexto do visitante, já que a fonte de verdade dele é a URL.
- **O que se copia é o TOKEN, não uma URL.** O modal escreve o `publicLink` cru no clipboard (`frontend/src/js/modals/sharing.modal.js`), e é o usuário que monta `…/?atlasPublico=<token>`. Quem for automatizar a distribuição do link precisa montar a URL do seu lado; não existe forma canônica vinda do servidor.
- **A resposta pública é a linha do banco, não uma projeção.** A rota devolve `SELECT a.*` mais `owner_nome`/`owner_username` (`FIND_ATLAS_BY_PUBLIC_LINK`, `backend/src/modules/atlas/atlas.queries.js`), sem auth e atrás apenas do `publicLinkLimiter`, então identidade do dono, `owner_id` e o próprio `public_link` chegam a chamador anônimo. O boot consome de fato só `id` e `publicToken`: qualquer estreitamento da projeção é compatível com o cliente, e qualquer coluna nova em `atlas` sai por aqui sozinha. Para consumidores, o corpo é snake_case do banco com **um** campo camelCase enxertado (`publicToken`).
- **O endereço do usuário é query string, e o da API é path.** O front lê `?atlasPublico=` (fixado em `frontend/tests/unit/atlas-link.test.js`); `/atlas/public/:link` é endpoint de API e nada mais. Desenhar a URL do usuário em cima dela produz um link que não abre nada.

## Ver também

[[compartilhamento-atlas]] · [[permissoes-atlas]] · [[api-rest-atlas]] · [[imagens-atlas]] · [[modos-operacao]] · [[sintese-eixos-de-permissao]]
