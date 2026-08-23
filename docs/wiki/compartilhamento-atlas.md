# Compartilhamento com Usuários

Concessão de acesso a um atlas gravada em `atlas_shares`, gerida por quem tem `manage`. O alvo é **uma pessoa OU um grupo de acesso**, nunca os dois (`CHECK (num_nonnulls(user_id, group_id) = 1)`, `backend/src/database/migrations/003_atlas.sql`). As rotas e o enum se leem no código; esta página cobre o que ele não conta.

> Até 2026-08-21 a abertura dizia "concessão **nominal**", e a palavra era exata. Deixou de ser: um gate ou uma tela que assuma `user_id` não-nulo ignora a concessão coletiva sem erro nenhum, que é a lista fechada da constituição na forma de SQL.

## `owner` não é uma linha da tabela

O `CHECK` de `atlas_shares` só aceita `read|comment|write|manage`; `owner` é sintetizado de `atlas.owner_id` em `resolvePermission()` (`backend/src/middleware/permissions.js`). Essa ausência é o contrato congelado do qual quase toda armadilha abaixo deriva. Consequência imediata: **remover o dono devolve 404**, porque `DELETE ... RETURNING` não acha linha e vira `NotFoundError('Share')` (`backend/src/modules/sharing/sharing.service.js`).

**Remover o dono é 404, não no-op.** O comentário de `backend/src/modules/sharing/sharing.routes.js` afirmava "a no-op on them" e foi corrigido em 2026-07-25. A diferença importa para quem escreve cliente: no-op se trata como sucesso, 404 não.

Enviar `permission: 'owner'` no corpo é **400 e não 403**, porque quem barra é o Joi (`backend/src/modules/sharing/sharing.schemas.js`), não o gate de permissão. Ver [[permissoes-atlas]], [[atlas-modelo-de-dados]] e [[erros-api]].

## Compartilhar não é privilégio do dono

Todas as rotas exigem `manage`, não `owner`. Um co-Gestor pode conceder até `manage`, ou seja, **criar outros co-Gestores e remover quem o promoveu**. Não há proteção contra auto-rebaixamento nem contra remoção mútua entre gestores; foi aceito assim porque a posse real só muda pela rota de transferência (owner-only), que é o único degrau irreversível. Ver [[atlas-modelo-de-dados]].

O JSDoc de `frontend/src/js/modals/sharing.modal.js` afirmava, em dois lugares, que "the backend also enforces owner-only on every mutation". O gate real é `manage`, e os dois foram corrigidos em 2026-07-25. O custo do engano era concreto: um chamador que confiasse naquele JSDoc esconderia o botão justamente do co-Gestor, que é para quem o compartilhamento existe.

## O eixo de GRUPO (desde 2026-08-21)

**Coluna nova, e não tabela irmã.** O padrão já existia em `resource_grants`, com o mesmo `num_nonnulls`. Uma tabela irmã custaria o oposto: cada leitor de `atlas_shares` que decide acesso ganharia um JOIN e um UNION próprios, e "quem alcança este atlas" passaria a ter duas respostas que precisam concordar. `permission`, `added_by` e `added_at` são idênticos nos dois alvos, então a tabela irmã seria a mesma tabela com outro nome.

**A precedência é o MÁXIMO, e o máximo é a razão de ser da escolha.** `fn_user_atlas_shares` devolve o maior nível entre o share direto e os dos grupos vivos da pessoa (`backend/src/database/migrations/008_acesso_a_recurso.sql`). A propriedade que isso garante: **acrescentar um caminho nunca rebaixa ninguém**, porque máximo é monótono sob inclusão de conjunto, e o caso antigo (só o direto) é o conjunto de um elemento. Quem tem `manage` direto e entra num grupo `read` continua `manage`.

**Uma definição, cinco consumidores.** A mesma função responde ao gate REST (`requireAtlasPermission`), ao gate do WebSocket (`resolvePermission` em `backend/src/modules/collab/collab.gateway.js`, rechamado por `reconcileAuthorization` a cada heartbeat) e às três listagens de `backend/src/modules/atlas/atlas.queries.js`. Sem o ramo no gate do socket a permissão por grupo valeria no handshake e morreria ~30 s depois, que é o pior desfecho possível: a pessoa entra, trabalha e cai sem explicação. `backend/tests/unit/atlas-shares-eixo-de-grupo-censo.test.js` reprova o sexto leitor que resolver acesso por conta própria.

**A morte do share é por RESOLUÇÃO, não por escrita.** Apagar o grupo é soft (`access_groups.deleted_at`), e soft nunca dispara o `ON DELETE CASCADE`. Quem para de entregar acesso é `fn_user_group_ids`, a mesma função que decide recurso privado, e que desde a mesma migração também exige DONO VIVO. Consequência declarada: a linha do grupo apagado fica **inerte** em `atlas_shares` para sempre. Ela não concede nada e não aparece em tela nenhuma; quem a olhar direto no banco vai achar que é lixo.

**A amplificação de autoridade, e as duas mitigações que a decisão do dono tornou obrigatórias.** Um share coletivo chega a `manage`, então quem administra a COMPOSIÇÃO do grupo passa a distribuir co-Gestão de um atlas que não é dele, só acrescentando gente, sem linha nova em `atlas_shares` e sem passar por gate nenhum. Por isso, no mesmo commit que abriu `manage`:

1. **só se compartilha com grupo PRÓPRIO** (`assertCanAdministerGroup`, `backend/src/modules/access-groups/access-groups.service.js`), e a recusa é **404**, nunca 403, porque a listagem de grupos é recortada por posse e um 403 contaria que aquele id existe;
2. **a lista de quem tem acesso NOMEIA O DONO do grupo** (`sharingGroupOwnerLabel`, `frontend/src/js/modals/sharing.modal.js`), que é a única superfície onde a delegação fica visível.

**A checagem de posse é no ATO, não contínua.** Perder a posse do grupo depois não revoga o share existente, exatamente como `grantResource` só exige `view_share` no instante da concessão.

**E ela cobra o SENTIDO da mudança, não a rota.** Posse é exigida em toda escrita que AUMENTA o alcance do grupo: o `POST` sempre, e o `PUT` só quando o nível novo é maior que o vigente (`updateGroupShare` compara com `previous_permission`, que o próprio `UPDATE` devolve). Tirar (o `DELETE` e o `PUT` que rebaixa) não cobra nada além de `manage` no atlas, porque tirar acesso nunca pode ser mais difícil que dar; a assimetria tem precedente em `requireGrantRevoker`. Até 2026-08-21 o `PUT` cobrava posse nos dois sentidos, e a regra estava aplicada ao contrário: o gestor do atlas podia APAGAR o vínculo de um grupo alheio e não podia REBAIXÁ-LO, de modo que a única ferramenta que lhe restava era a mais destrutiva. O seletor da tela espelha isso desabilitando só as opções ACIMA da vigente (`groupLevelOptions`, `frontend/src/js/modals/sharing.modal.js`), em vez de travar a linha inteira.

**A frame de compartilhamento carrega a permissão EFETIVA, nunca o nível do vínculo, e isso vale nos DOIS eixos.** `sync-engine.js` aplica `msg.role` cru, então uma frame com o nível do vínculo rebaixaria no cliente quem tem outro caminho maior: a barra de ferramentas some sem motivo e volta no F5, irreproduzível para quem reporta e invisível para quem investiga. No eixo de GRUPO o controller emite **duas** frames por mutação: uma de composição (`group_added`/`group_updated`/`group_removed`, só para `manage` e acima) e uma por membro conectado, com o nível recalculado por `effectiveRolesFor` (`backend/src/modules/sharing/sharing.service.js`). No eixo de PESSOA a frame é uma só, e o nível dela também vem de `effectiveRolesFor` desde 2026-08-21: enquanto vinha de `req.body.permission`, tirar o share direto de quem também alcança por grupo respondia 204 anunciando `user_removed` para alguém que continuava co-Gestor, e o gestor via a pessoa sumir da lista enquanto o servidor seguia entregando `manage`. Hoje, quando sobra caminho, a frame é `user_updated` com o que sobrou. Guarda em `backend/tests/ws/sharing-broadcast-grupo.test.js`, com `backend/tests/ws/sharing-broadcast-updates.test.js` (o eixo de pessoa, dez casos) como discriminação de que nada se moveu no caminho de caminho único.

**`effectiveRolesFor` tem os TRÊS ramos de `resolvePermission`** (dono, share resolvido, atlas público) e deliberadamente NÃO tem o atalho de papel global: `sync-engine.js` ignora toda frame de compartilhamento quando `sessionContext.isAdmin()`, então escrevê-lo seria uma segunda cópia do eixo global dentro de uma consulta que nenhum administrador lê. O ramo público não é decorativo: num atlas publicado todo autenticado lê, então tirar o único share de alguém **não** o remove.

**Transferir a posse continua exigindo share DIRETO.** Posse é nominal por construção (`atlas.owner_id` é uma coluna, não um coletivo), e transferi-la a quem só alcança o atlas por grupo trocaria uma autoridade revogável por uma irrevogável. A mensagem de recusa ("O novo dono precisa ser um membro ativo do atlas.") vai soar errada para essa pessoa, porque ela **é** membro: se incomodar, o conserto é a frase, não a regra.

**O cartão de "Seus atlas" conta PESSOAS, não linhas.** `fn_atlas_member_ids` expande o grupo em gente e deduplica; sem isso, um coletivo de quarenta contaria como um membro só e as quarenta não apareceriam na lista onde elas próprias deveriam estar. O dono é excluído explicitamente da contagem, porque agora ele pode estar num grupo compartilhado do próprio atlas.

**E ela carrega o MESMO par de predicados da resolução** (grupo vivo E dono vivo). Enquanto filtrava só `deleted_at IS NULL`, ela discordava de `fn_user_atlas_shares` exatamente no caso que o dono vivo existe para fechar: com o dono do grupo desativado, o cartão contava e NOMEAVA (com `nome` e `posto_graduacao`) pessoas que o gate já recusava com 404, e `GET /atlas/overview` é `auth`-only, servido a qualquer participante, inclusive Leitor. Duas portas para o mesmo fato, uma fechada e a outra aberta, e a aberta era a que divulgava nome de quem não é membro. Guarda em `backend/tests/integration/atlas-share-por-grupo.test.js`, que mede a lista e a resolução na mesma rodada.

**O que o cartão mostra atravessa a decisão D6, e a travessia é deliberada.** D6 fecha o **roster do grupo** (quem está dentro dele só é visível a quem o administra). A lista de participantes do ATLAS é outra pergunta, e a resposta dela sempre foi aberta a quem participa: ela não diz de que grupo cada pessoa veio, não diz que grupos existem, e só é servida a quem já compartilha aquele atlas. O caso-limite honesto é o atlas cujo ÚNICO share é um grupo, onde as duas listas coincidem. A alternativa, que seria não expandir, faria o próprio membro não se ver na lista de participantes do atlas de que participa, o que é pior. Registrado em [`../decisions/decisions-2026.md`](../decisions/decisions-2026.md).

## Armadilhas de comportamento

**`POST /users` é upsert, não create.** `ON CONFLICT (atlas_id, user_id) DO UPDATE SET permission` (`backend/src/modules/sharing/sharing.queries.js`). Reenviar o `POST` para quem já é membro **altera** a permissão e ainda responde 201. Não existe 409, então um duplo clique pode rebaixar silenciosamente um editor para leitor. O modal se protege no cliente (`frontend/src/js/modals/sharing.modal.js`); o servidor não. Não confie nessa guarda ao escrever outro cliente.

**`added_by` e `added_at` descrevem a concessão original, nunca a atual.** O upsert só atualiza `permission` (`ON CONFLICT ... DO UPDATE SET permission`, `backend/src/modules/sharing/sharing.queries.js`), o `PUT` também não os toca, e a tabela não tem `updated_at` (`backend/src/database/migrations/003_atlas.sql`). Depois que um co-Gestor promove ou rebaixa alguém concedido por outro, o `addedBy` que o `GET` devolve aponta para a pessoa errada. Quem mudou o nível existe, mas só no log de auditoria (`PERMISSION_GRANT` / `PERMISSION_REVOKE` / `SHARING_CHANGE`, emitidos em `backend/src/modules/sharing/sharing.service.js`), nunca na linha da tabela. Não construa tela de governança sobre `addedBy`; ver [[auditoria]].

**`POST` valida o usuário, `PUT` não.** `addUserShare` checa `is_active = true` antes de inserir (`backend/src/modules/sharing/sharing.service.js`); `updateUserShare` opera direto na tabela. Desativar um usuário não apaga os shares dele, apenas impede novas concessões.

**`manage` fica acima de `write`.** Um gate escrito como `permission === 'write' || permission === 'owner'` exclui o co-Gestor sem erro visível. Sempre compare por nível (`PERMISSION_LEVELS`, `backend/src/middleware/permissions.js`). Ver [[permissoes-atlas]].

**Admin global nunca consulta shares.** `requireAtlasPermission` curto-circuita para `'owner'` quando `req.user.role === 'admin'` (`backend/src/middleware/permissions.js`), antes da consulta a `atlas_shares`; `backend/src/modules/collab/collab.gateway.js` repete o curto-circuito no WebSocket. Um admin não aparece na lista de membros e não é afetado por nenhuma alteração de share. Ver [[gestao-usuarios]].

**Visitante de link público pula a busca de share** porque o `userId` do token não é UUID (`backend/src/middleware/permissions.js`). Ver [[link-publico]].

## Leitura e escrita falam dialetos diferentes

`GET /sharing` devolve camelCase (`shares[]` montado por `json_build_object` em SQL, o resto mapeado em `backend/src/modules/sharing/sharing.service.js`). `POST` e `PUT` devolvem a linha crua da tabela (`RETURNING *`), em snake_case: `atlas_id`, `user_id`, `added_at`.

Por isso **não reaproveite o objeto do `POST` para atualizar a lista em memória**: releia o `GET`, que é o que o modal faz (`frontend/src/js/modals/sharing.modal.js`).

**O `FILTER` do `json_agg` olha para `s.user_id`, e não para `s.id`.** Ele nasceu para devolver `[]` e não `[null]` quando não há shares, e enquanto toda linha tinha pessoa as duas perguntas eram a mesma. Com o alvo coletivo deixaram de ser: cada linha de GRUPO entraria no array de MEMBROS como uma pessoa de `userId`/`username`/`nome` nulos, um defeito que nasceria no instante em que a coluna passou a existir. O agregado irmão `groups` usa `FILTER (WHERE s.group_id IS NOT NULL AND ag.deleted_at IS NULL)`, e o `deleted_at` é o que faz a TELA concordar com a RESOLUÇÃO. Preserve os dois ao mexer na query.

**O payload tem DUAS listas, e o cliente aceita a ausência da segunda.** `partitionSharingConfig` (`frontend/src/js/modals/sharing.modal.js`) devolve `groups: []` quando a chave falta, para que um cliente novo contra um servidor antigo (implantação em duas etapas) não quebre a tela.

## Re-gate ao vivo: cobre promoção, não remoção

Toda mutação faz `broadcastToRoom(..., 'sharing_updated')`. Em `user_added` e `user_updated` o broadcast carrega `role: toFrontendRole(permission)` justamente para o par conectado se re-gatear sem reconectar (`backend/src/modules/sharing/sharing.controller.js`, `backend/src/utils/roles.js`).

**A sala não é a audiência.** Os três frames que NOMEIAM um membro (`user_added`, `user_updated`, `user_removed`) só são entregues a sockets de nível `manage` ou acima, mais os sockets do próprio usuário afetado (`minPermission`/`alsoUserIds` em `backend/src/modules/collab/collab.rooms.js`). É o mesmo dado que `GET /atlas/:id/sharing` gateia em `manage`, e até 2026-07-25 ele ia para a sala inteira: Visualizador, Comentarista, Editor e até o visitante anônimo de link público liam por WebSocket o UUID e o nível de cada membro que o REST lhes negava com 403. A exceção do afetado é o que faz o re-gate acima continuar funcionando para quem está abaixo de `manage`, e é por isso que `{ skipReadOnly: true }` não serve aqui: além de calar o par promovido, ele continuaria entregando a `comment` e a `write`. Os dois frames `public_*` seguem abertos à sala porque não carregam identidade nenhuma.

**A audiência do frame é muito mais larga que o que alguém lê.** O controller emite `sharing_updated` com uma `action` para cada mutação da família, as duas de link público, as três que nomeiam uma pessoa e as três de GRUPO descritas acima (`backend/src/modules/sharing/sharing.controller.js`), e o único consumidor de todo o frontend descarta tudo que não seja `user_added`/`user_updated` **do próprio `userId`** (`frontend/src/js/store/sync/sync-engine.js`). Ou seja, o cliente reage a exatamente uma coisa: a própria promoção. Duas consequências:

- Quem for removido **continua com a UI de edição**, porque nada no cliente reage ao próprio despejo. A segurança fica com o servidor; a UI é cortesia.
- Publicar ou despublicar não atualiza par nenhum. Como `enablePublicSharing` **rotaciona** o link ([[link-publico]]), um segundo co-Gestor com o modal aberto fica olhando para um link já morto até reabrir o modal.
- As frames de grupo caem no mesmo silêncio: acrescentar, rebaixar ou tirar um grupo não move a UI de ninguém. Quando o acesso morre por inteiro, quem corta é o heartbeat, não o frame.

Quem corta não é o reconnect: `reconcileAuthorization` roda em toda batida de heartbeat (~30s, `backend/src/modules/collab/collab.gateway.js`), rechama a mesma `resolvePermission` e, sem permissão sobrando, fecha o socket com `ws.close(4003, 'access revoked')` (`backend/src/modules/collab/collab.gateway.js`). O caso em que a UI de edição realmente sobrevive é o **atlas público**: ali a resolução cai para `read` em vez de `null`, então o socket é só rebaixado (`backend/src/modules/collab/collab.gateway.js`) e o usuário segue editando na tela até o próximo push tomar 403. Ver [[canal-collab-websocket]] e [[sintese-eixos-de-permissao]].

> Até 2026-07-25 esta seção afirmava o oposto, que a permissão do WS "é resolvida uma vez, na conexão, não a cada frame, então a remoção só morde na próxima sessão". A citação que a sustentava resolvia, e era a resolução do handshake; a conclusão tirada dela é que era falsa, porque a mesma função é rechamada pelo sweep. Quatro páginas irmãs já descreviam o comportamento certo ([[permissoes-atlas]], [[sintese-eixos-de-permissao]], [[link-publico]], [[atlas-modelo-de-dados]]): a lição é que citação verdadeira não valida a frase que a acompanha.

## Busca de usuários: custos escondidos

`GET /api/v1/users/search` exige apenas autenticação, **sem escopo de atlas** (`backend/src/modules/users/users.routes.js`). Três consequências que não se veem na rota:

- É `LIKE '%termo%'` sobre quatro colunas, **sem índice funcional e sem paginação**. Não há offset nem `total`/`hasMore`: o 21º resultado é inalcançável e "20 resultados" é indistinguível de "20 de muitos". Refine o termo, é a única saída.
- É superfície de **enumeração de pessoal** para qualquer usuário logado, inclusive fora da própria OM. Ver [[hardening-borda-api]].
- Casar posto e OM é **intencional**, para achar "Cap" ou "CIGEx" (`backend/src/modules/users/users.queries.js`). Como o `LEFT JOIN` é permissivo, um usuário sem posto ou sem OM volta com esses campos em `null`: renderize com fallback, não assuma string. Ver [[organizacoes-om]].

Ao escolher alguém na busca, o modal concede `read` por decisão explícita: "a permissão padrão abaixa, nunca eleva" (`frontend/src/js/modals/sharing.modal.js`). Preserve isso.

## Efeito na listagem de atlas

`LIST_USER_ATLAS` devolve `user_permission` com o ramo do DONO PRIMEIRO e o share resolvido depois (`backend/src/modules/atlas/atlas.queries.js`), na mesma ordem de `resolvePermission`; a inversão já custou um bug e tem repro próprio (`backend/tests/integration/atlas-list-permission-precedence.repro.test.js`). É esse campo que o seletor de projetos usa. O `LEFT JOIN` é sobre `fn_user_atlas_shares`, e não sobre a tabela: a função já agrega por atlas, o que é o que impede o cartão de aparecer DUAS vezes para quem está em dois grupos que compartilham o mesmo atlas. A lixeira é deliberadamente diferente: `LIST_DELETED_USER_ATLAS` fixa `'owner'` e filtra por `owner_id` (`backend/src/modules/atlas/atlas.queries.js`), ou seja, **um membro compartilhado nunca vê nem restaura um atlas na lixeira**, mesmo com `manage`. Ver [[api-rest-atlas]].

Compartilhamento não altera dados sincronizados: o share só governa o gate. As operações seguem o caminho normal ([[fila-operacoes-outbound]], [[modelo-conflito-lww]]).

## Histórico

- 2026-08-23: a seção do re-gate ao vivo contava **cinco** `action` de `sharing_updated`. As três frames de grupo entraram com o eixo coletivo em 2026-08-21, na mesma página, parágrafos acima, e a contagem não acompanhou. Trocada por propriedade: uma `action` por mutação da família, contra um consumidor que só reage à própria promoção.
