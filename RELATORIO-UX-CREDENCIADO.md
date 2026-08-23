# Relatório de UX: o perfil CREDENCIADO

Auditoria de interface e experiência do papel global `credenciado`, feita contra o código do branch
`integracao_backend` em 2026-08-23. Fonte normativa: [`CONSTITUICAO.md`](CONSTITUICAO.md). Toda afirmação
abaixo foi conferida no código; onde a prosa da wiki e o código divergiram, vale o código, e a divergência
está anotada.

---

## 1. O que o credenciado É

### 1.1 Segundo o estatuto

As cláusulas que definem este perfil, com o estado que o próprio documento declara (e que
`frontend/tests/unit/constituicao-estado-das-clausulas.test.js` cobra: só 1.5, 9.3, 10.1 e 10.7 não são
vigentes):

| cláusula | o que diz | estado |
|---|---|---|
| 1.1 | quatro papéis globais que NÃO formam escada; gate "diferente de usuário comum" promove o credenciado em silêncio | vigente |
| 1.3 | só o administrador promove alguém a credenciado; o papel é lido do banco a cada requisição | vigente |
| 2.6 | o credenciado **lê todo recurso privado**, sem precisar de concessão | vigente |
| 3.1 / 3.2 | concessão é a UMA pessoa OU a UM grupo, nunca aos dois; dois níveis, `ver` e `ver e compartilhar` | vigente |
| 3.3 | **origina** concessão quem tem papel global de dado (administrador ou credenciado) ou quem produz o recurso | vigente |
| 3.4 | toda concessão expira; teto e padrão de um ano; nenhuma vive mais que a de quem concedeu | vigente |
| 3.5 / 3.6 / 3.7 | revogar derruba a cadeia derivada; caminhos independentes são preservados; descendente com concedente vivo é repai-ado | vigente |
| 3.8 | apagar grupo ou tirar alguém de grupo poda pela mesma regra | vigente |
| 4.1 / 4.2 | qualquer logado cria grupo; quem cria é o dono, e só ele administra | vigente |
| 4.6 | **o credenciado não tem poder especial sobre grupo**; supera por escrito a decisão de 2026-08-19 | vigente |
| 4.7 / 5.8 | sair de grupo e sair de atlas são direito de quem entrou; o dono é a exceção | vigente |
| 8.5 | a autoridade morre com quem a exercia; rebaixar poda o que a pessoa concedeu de raiz | vigente |
| 9.1 / 9.2 | a trilha é do administrador e, recortada por OM, do produtor. **O credenciado não tem trilha** | vigente / em obra (9.3) |
| 10.1 | os bytes do tile privado não passam por gate, e o gêmeo: **o acervo privado não desenha para quem tem direito** | **pendente** |

### 1.2 Segundo o código

O eixo é definido em `frontend/src/js/store/sync/session-context.js`:

- `GlobalRole` traz os quatro valores; o JSDoc diz por extenso que não é escada;
- `hasGlobalDataAccess()` é `_globalRole === ADMIN || _globalRole === CREDENCIADO`. É o **único** predicado
  nominal do credenciado no cliente inteiro, e tem **um consumidor só**: `canShareResource`
  (`frontend/src/js/store/sync/resource-access.service.js`);
- `isAdmin()`, `isProducer()` e `canProduceFor()` são todos nominais e todos falsos para ele.

A porta de administração é decidida por `adminAudience` (`frontend/src/js/admin/admin-audience.js`), que
devolve `{ label: 'Grupos', tabIds: ['groups'] }` para ele. Os seis consumidores dessa função (menu de conta
no mapa, barra de `atlas.html`, montagem de `admin.html`, o gate de página, e as duas dicas dos modais de
compartilhamento) leem a mesma definição, então o rótulo não diverge por tela.

O gate de `calibracao.html` (`frontend/src/js/calibration/calibracao-page.js`, `initCalibracaoPage`) é
`isAdmin() || isProducer()`, e os dois espelhos de menu (`account.control.js`
`_updateCalibrationVisibility`, `ui/app-bar.js` `mayCalibrate`) escondem a entrada. O credenciado não vê a
porta que não pode abrir.

**Varredura de promoção silenciosa: negativa.** Não existe em `frontend/src/js/` nenhum `role !== 'user'`,
nenhum `.includes(role)` sobre papel global e nenhuma comparação por ordem no eixo global. A única escada do
repositório é `PERMISSION_ORDER` (`frontend/src/js/projects/permission-levels.js`), que é o eixo POR ATLAS e
que exclui `producer` e `credenciado` de `ROLE_TO_PERMISSION` de propósito. A classe de defeito que este
perfil mais teme não está presente hoje.

### 1.3 Onde estatuto, doc e código divergem

**D1. "Concede e revoga" não é o que o servidor faz.** [`CLAUDE.md`](CLAUDE.md) diz que o credenciado
"concede/revoga no eixo de RECURSO", e `docs/wiki/acesso-a-recurso-privado.md` registra o contrário e mais
exato: "o credenciado saiu do ramo curinga porque ler todo recurso privado não é autoridade sobre a concessão
de terceiros". O código confirma a wiki: `requireGrantRevoker` (`backend/src/middleware/resource-access.js`)
libera por `linha.administra === true || linha.concedeu === true`, e `administra` é a consulta
`GRANT_REVOKER_ACTOR`, cujo predicado é `u.role = 'admin'`. Ou seja: **o credenciado revoga só o que ele
mesmo concedeu.** A constituição não fala de quem revoga (3.5 descreve o efeito, não o sujeito), então não há
conflito com ela; há conflito com a frase de `CLAUDE.md` e, sobretudo, com a interface (achado CRÍTICO 1).

**D2. Nenhum resíduo do mundo velho de grupos.** A decisão de 2026-08-19, que dava a administração de grupo
ao credenciado como privilégio de papel, foi superada e a supersessão está escrita em três sítios do cliente
(`admin/admin-audience.js`, `session-context.js` no JSDoc de `hasGlobalDataAccess`, e o comentário acima de
`listAccessGroups` em `store/sync/api-client.js`). Nenhum gate, rótulo ou texto vivo lhe dá poder de papel
sobre grupo. O único resíduo é iconográfico: o `SHIELD_ICON` de `frontend/src/js/admin/admin-panel.js`
(achado BAIXO 1).

**D3. O estatuto lhe dá leitura, e a pendência 10.1 tira metade dela na prática.** 2.6 diz que ele lê todo
recurso privado; 10.1 diz que o navegador pede o tile anonimamente e que o acervo privado "não desenha para
quem tem direito". As duas convivem no documento, mas na tela o resultado é um cartão que abre e uma camada
que não aparece (achado ALTO 2).

**D4. Um teste do backend ainda chama de buraco o que a constituição decidiu.**
`backend/tests/integration/papel-credenciado.test.js` rotula a concessão de raiz do credenciado como
"BURACO CONHECIDO, o credenciado ainda CONCEDE de raiz, e isso é escrita", e assere `parent_grant_id ===
null` sob esse rótulo. A cláusula 3.3, vigente desde 2026-08-20, diz o contrário: origina concessão quem tem
papel global de dado, e a concessão dele nasce com pai nulo por decisão. O comportamento está certo, o
rótulo é do mundo anterior. Não muda nada na tela, mas é o tipo de frase que faz a próxima sessão ir
"consertar" o que é o desenho. O predicado `fn_can_grant_resource` citado ali não existe em lugar nenhum do
repositório.

---

## 2. Inventário de ações, ponta a ponta

Veredito: OK (alcançável, rótulo verdadeiro, gate casado), ATRITO (funciona mal), ou o número do achado.

| # | ação | onde (arquivo · símbolo) | veredito |
|---|---|---|---|
| 1 | Entrar (login) | `account/account.control.js` · modal de login | OK |
| 2 | Descobrir o que o papel lhe dá | `ui/role-labels.js` · `globalRoleBadge` + `GLOBAL_ROLE_DESCRIPTIONS`; espelhos em `account.control.js` · `_updateRoleBadge`, `ui/app-bar.js` · `buildRoleBadge`, `modals/account-settings.modal.js` · `_buildIdentitySection` | OK. O selo "Credenciado" com a frase "Enxerga todo recurso privado do acervo e pode conceder acesso a ele, sem editá-lo" existe nas quatro superfícies |
| 3 | Saber POR QUE enxerga um recurso | `catalog/components/catalog-card.js` · `createCatalogCard` (selo "Privado") | MÉDIO 1. Selo único para três origens; o `title` diz "só quem recebeu acesso enxerga este item", e ele não recebeu nada |
| 4 | Achar recurso privado no catálogo | `catalog/catalog.modal.js` · `_applyFilters`, `components/catalog-filters.js` | MÉDIO 2. Filtro só por TIPO. Ele vê o acervo privado inteiro do sistema e não tem como isolá-lo, nem por OM |
| 5 | Achar camada base privada | `base-layer-selector/base-layer-selector.control.js` · `_createLayerOption` | OK (selo próprio, mesma razão escrita no código) |
| 6 | Achar 360 e 3D privados | mesmos cartões do catálogo | OK, com a ressalva do item 3 |
| 7 | Buscar (barra de busca) | `search/search-bar.search-providers.js` | ATRITO no 360. O provedor lê `getCachedProjects() ?? fetchProjects()` e não marca privacidade no resultado, então o projeto privado aparece na busca sem o selo que o cartão tem. Topônimo não tem eixo de acesso (cláusula 2.2), e a consulta `BUSCA` de `backend/src/modules/nomes/nomes.queries.js` de fato não tem predicado nenhum: aqui está certo |
| 8 | Abrir o recurso privado no mapa | `terrain/data-layers.manager.js` · `addDataLayer` / `setupDataLayers` | ALTO 2. Falha de tile cai em `console.error`; a tela não diz nada |
| 9 | Alcançar a tela de conceder | `catalog/components/catalog-card.js` · `createCatalogCard` (`privado && canShareResource(...)`) e `base-layer-selector.control.js` · `_createShareButton` | OK. `canShareResource` espelha `requireResourceShare` e inclui o credenciado por papel |
| 10 | Conceder a uma PESSOA | `catalog/resource-share.modal.js` · `_renderAddSection`, `_handleGrant` | OK |
| 11 | Conceder a um GRUPO | idem · `_renderGroupRow`, `_handleGrantGroup` | OK. Lista só grupos próprios, igual ao `WHERE` do servidor (`GET_ADDRESSABLE_LIVE_GROUP` chama `fn_can_administer_group`) |
| 12 | Escolher o nível | idem · `GRANT_LEVELS` (`catalog/catalog.constants.js`) | OK. Padrão `view`, com texto explicando o que `view_share` delega |
| 13 | Escolher o PRAZO | não existe: `_handleGrant`/`_handleGrantGroup` nunca mandam `expiresAt` | ALTO 6 |
| 14 | Entender que a concessão VENCE | idem · parágrafo fixo de `_renderAddSection` + chip `expira em` de `_renderGrantItem` | OK, e é dos melhores textos do produto |
| 15 | RENOVAR antes de vencer | bloqueado: `alreadyGranted` filtra quem já tem concessão viva da busca, e o servidor devolve 409 na segunda concessão do mesmo par | ALTO 6. O próprio texto do modal manda fazer isto |
| 16 | Ver quem já tem acesso | idem · `_renderGrantsSection`, `_renderGrantItem` | Bom no que mostra (pessoa/grupo, dono do grupo, origem, prazo, chip de concedente morto); MÉDIO 7 no que omite |
| 17 | Distinguir acesso por PAPEL de acesso por CONCESSÃO | frase de apoio de `_renderGrantsSection` ("Administradores, credenciados e produtores da OM dona enxergam este recurso por papel, sem concessão, e não aparecem nesta lista") | Parcial. Falta o empréstimo por atlas e o visitante de link público (MÉDIO 7); falta inteiro no CATÁLOGO (item 3) |
| 18 | Entender a CASCATA antes de revogar | idem · chip `+N dependente(s)`; `catalog/grant-tree.js` · `fallenGrants`, `revocationWarning` | OK, e superestima de propósito |
| 19 | **Revogar** | idem · `_renderGrantItem` (botão em toda linha), `_handleRevoke` | **CRÍTICO 1**. O botão aparece em concessões que ele não originou; o servidor recusa |
| 20 | Saber o que caiu depois de revogar | idem · `_handleRevoke` (usa `revoked`, `reparented`, `trimmed` do servidor) | OK |
| 21 | Achar as concessões que ELE fez | não existe (nenhum método em `store/sync/api-client.js`, nenhuma rota, nenhuma aba de auditoria para ele) | ALTO 3 |
| 22 | Criar grupo | `admin/groups-tab.js` · `_renderForm`; atalho em `resource-share.modal.js` · `_renderGroupCreate` | OK |
| 23 | Renomear / descrever grupo | `groups-tab.js` · `_renderForm` | OK |
| 24 | Adicionar membro | `groups-tab.js` · `_buildMemberSearch`, `_addMember` | ALTO 5. É o ato que CONCEDE, e é o único do ciclo sem aviso e sem relato |
| 25 | Remover membro | `groups-tab.js` · `_removeMember` + `admin/group-phrases.js` · `memberRemovalWarning` | OK no texto; MÉDIO 6 na frescura da contagem |
| 26 | Apagar grupo | `groups-tab.js` · `_delete` + `groupDeletionWarning` / `groupDeletionSummary`, com `_reachForWarning` relendo antes | OK |
| 27 | Transferir posse de grupo | não existe (nem UI nem rota), mas é oferecido por escrito | ALTO 4 |
| 28 | Ver grupos de que participa | `groups-tab.js` · `_renderParticipating` + `participatingReachUnknownNotice` | OK |
| 29 | Sair de um grupo | `groups-tab.js` · `_leave`, gateado por `leaveGroupAvailability` | OK; BAIXO 4 e 5 nas bordas |
| 30 | Chegar à página "Grupos" | `account.control.js` · `_updateAdminVisibility`; `projects/projects-page.js` · `adminEntryLabel` | OK no rótulo; BAIXO 1 no ícone e na nav rail de um item |
| 31 | Abrir atlas, mapas, camadas, feições | caminho comum, sem gate de papel global | OK |
| 32 | Briefing, comentários, temporal | eixo POR ATLAS, `checkPermission` | OK. Ele entra na escada como conta comum, o que é o desenho |
| 33 | Compartilhar um ATLAS (pessoa/grupo) | `modals/sharing.modal.core.js` | OK, e nada ali lhe dá privilégio |
| 34 | Sair de um atlas | `projects/atlas-drive.js` · ação `leave`, `describeLeaveOutcome` | OK |
| 35 | Exportar `.ebgeo` / salvar como local | `catalog/private-reference-pruner.js`, aviso por `aviso-de-perda-de-recursos` | OK. A poda é keep-list e ele é avisado do que perdeu |
| 36 | Gerir a própria conta | `modals/account-settings.modal.js` | OK, e mostra o papel com a frase |
| 37 | Abrir `calibracao.html` | `calibration/calibracao-page.js` · `initCalibracaoPage` | OK: negado, e a entrada nem aparece |
| 38 | Abrir Catálogo / Usuários / Config / Auditoria | `admin/admin-audience.js` · `adminAudience` | OK: as abas não existem para ele, em vez de darem 403 na montagem |
| 39 | Marcar recurso público/privado | `admin/catalog-tab.js` · `_renderResourceForm` (campo gateado por `canProduceFor`) | OK: escondido, não desabilitado. É o eixo de produção, não o dele |

---

## 3. Achados, por gravidade

### CRÍTICO 1. O botão "Remover acesso" aparece em concessões que o credenciado não pode revogar

**O que acontece hoje.** `_renderGrantItem` (`frontend/src/js/catalog/resource-share.modal.js`) desenha o
botão `data-action="revoke"` em **toda** linha da lista "Quem tem acesso", sem consultar quem originou a
concessão. A lista vem de `LIST_GRANTS_FOR_RESOURCE`
(`backend/src/modules/resource-access/resource-access.queries.js`), que **não filtra por ator**: o credenciado
vê as concessões feitas pelo administrador, pelo produtor da OM dona, por outros credenciados e por qualquer
beneficiário com `view_share`. O servidor recusa todas elas: `requireGrantRevoker`
(`backend/src/middleware/resource-access.js`) só passa com `linha.administra` (que a consulta
`GRANT_REVOKER_ACTOR` define como `u.role = 'admin'`) ou `linha.concedeu` (`g.granted_by = $2`).

O caminho completo do erro é pior que um 403 seco. O usuário lê o chip `+3 dependente(s)`, clica, lê o
diálogo destrutivo de `revocationWarning` (`frontend/src/js/catalog/grant-tree.js`), que NOMEIA até três
pessoas que vão perder o acesso, confirma em "Remover acesso", e só então recebe o toast
`Só quem concedeu esta permissão (ou um administrador) pode revogá-la.` Ele foi levado a decidir uma coisa
irreversível para descobrir que não podia decidi-la.

**Por que é ruim.** É a definição de "a UI promete o que o servidor recusa", agravada por um diálogo
destrutivo no meio. E ensina a coisa errada sobre o papel: quem clica conclui que perdeu uma autoridade que
nunca teve, ou que o sistema está quebrado.

**Arquivo e símbolo.** Cliente: `frontend/src/js/catalog/resource-share.modal.js` · `_renderGrantItem`,
`_handleRevoke`. Servidor: `backend/src/middleware/resource-access.js` · `requireGrantRevoker`,
`GRANT_REVOKER_ACTOR`.

**Correção proposta.** A listagem já traz `granted_by`. Gatear o botão por
`sessionContext.isAdmin() || String(grant.granted_by) === String(sessionContext.userId)`, e nas demais linhas
pôr, no lugar do botão, uma nota curta do tipo "só quem concedeu remove" (a linha já mostra de quem veio, por
`grantOriginLabel`). A regra pertence a `grant-tree.js`, que é onde ela fica testável em node, ao lado de
`fallenGrants` e `deadGrantorChip`; o modal só consome. Esconder, e não desabilitar, é a doutrina já escrita
no próprio cartão do catálogo. Repare que a linha `granted_by` nulo (a concessão "pela administração") também
cai fora para ele.

### ALTO 2. O acervo privado pode não desenhar, e a tela não diz nada

**O que acontece hoje.** A cláusula 10.1 declara, como pendência conhecida, que o navegador pede o tile
anonimamente e que "o acervo privado hoje não desenha para quem tem direito". `PENDENCIA-TILE-PRIVADO.md`
mede o escopo: `config.source` e `config.labelSource` de `data_layers`, `config.source` de `analysis_layers`,
`config.style` de `basemaps`. No cliente, o erro morre em `console.error`:
`addDataLayer` e `setupDataLayers` (`frontend/src/js/terrain/data-layers.manager.js`) engolem toda exceção.

**Por que é ruim.** Este é o perfil cuja definição inteira é ler o acervo privado. Ele vê o cartão, vê o selo
"Privado", clica, e o mapa fica igual. Não há mensagem, não há estado de camada quebrada, não há nada a
reportar num chamado além de "não funcionou".

**Arquivo e símbolo.** `frontend/src/js/terrain/data-layers.manager.js` · `addDataLayer`,
`setupDataLayers`, `removeLayer`; cláusula 10.1 e `PENDENCIA-TILE-PRIVADO.md`.

**Correção proposta.** Independe de fechar 10.1: assinar `error` da source no MapLibre e marcar a linha da
camada como indisponível na aba de camadas, com o motivo ("o servidor recusou os dados desta camada"). A wiki
já reconhece o mesmo sintoma no caminho da revogação ("o painel diz indisponível, o mapa ainda desenha o que
o servidor já recusa"), o que sugere que metade do mecanismo existe.

### ALTO 3. A soma dos recursos privados falha em silêncio, e leva o papel inteiro junto

**O que acontece hoje.** `refreshVisibleResources`
(`frontend/src/js/store/sync/resource-access.service.js`) é best-effort por desenho: o `catch` devolve
`false` sem propagar. Todos os chamadores descartam o resultado. `sync-engine.js` faz
`await refreshVisibleResources(null)` no `login` e em `_applyAtlasSettingsOverlay` sem olhar o retorno, e nos
handlers de `atlasResources` e de troca de dono faz `.then((ok) => { if (!ok) return; })`. `index.js` idem no
boot.

Falhada a soma, `_privados` fica vazio. Consequência para este perfil, e ela é total: nenhum cartão mostra
"Privado" (`isPrivateResource` devolve `false` para tudo), nenhum botão "Compartilhar" aparece
(`canShareResource` ainda devolveria `true` por papel, mas o botão exige `privado &&`), e o catálogo fica
idêntico ao de um visitante anônimo. O produto some sem uma linha de aviso.

Existe `retryVisibleResources` no mesmo arquivo, escrito exatamente para isso, e o único chamador dele é
`frontend/src/js/catalog/resource-reference.resolver.js`, no caminho da poda de saída. Nenhuma tela o oferece.

**Por que é ruim.** É a falha silenciosa mais cara possível para este papel: indistinguível de "o acervo
privado acabou".

**Arquivo e símbolo.** `frontend/src/js/store/sync/resource-access.service.js` ·
`refreshVisibleResources`, `retryVisibleResources`; `frontend/src/js/store/sync/sync-engine.js` · `login`,
`_applyAtlasSettingsOverlay`, handlers `atlasResources` e `atlasOwner`.

**Correção proposta.** Um aviso não-modal e não-bloqueante quando a soma falha para uma sessão autenticada
("Não foi possível carregar o acervo privado desta conta"), com ação "Tentar de novo" ligada a
`retryVisibleResources()`. Fica no eixo do avatar ou na barra de status de conexão, que é onde o usuário já
procura estado de sessão. O `false` já distingue os três casos que o chamador trata igual; basta um deles
chegar à tela.

### ALTO 4. Não existe inventário do que ele concedeu

**O que acontece hoje.** A única superfície de concessão é o modal de UM recurso. Para revogar algo, o
credenciado precisa lembrar QUAL recurso ele concedeu, achá-lo no catálogo, abrir o modal e procurar a linha.
Não há rota de listagem por concedente (`backend/src/modules/resource-access/resource-access.routes.js` tem
`GET /:type/:id/grants` e nada por ator), não há método no cliente
(`frontend/src/js/store/sync/api-client.js` tem `grantResource` e `revokeResourceGrant`, e nenhum "listar as
minhas"), e ele não tem a aba de Auditoria (`adminAudience` lhe dá só `groups`; o `fileoverview` de
`frontend/src/js/admin/audit-tab.js` diz que é decisão).

**Por que é ruim.** O papel é definido por conceder e revogar, e o produto não tem a tela do meio: "o que eu
já concedi". Some com a possibilidade de revisão periódica, que é a higiene natural de quem distribui acesso
com prazo. Some também a resposta a "por que Fulano vê isto?" pelo lado de quem concedeu.

**Arquivo e símbolo.** `backend/src/modules/resource-access/resource-access.routes.js`;
`frontend/src/js/store/sync/api-client.js` · `grantResource`, `revokeResourceGrant`;
`frontend/src/js/admin/admin-audience.js` · `ABAS_DE_QUEM_ENTROU`.

**Correção proposta.** Uma segunda aba na página que ele já abre ("Grupos" viraria "Acesso", com "Grupos" e
"Concessões"), alimentada por uma rota nova de listagem por `granted_by`, com o recurso, o beneficiário, o
nível e a data de vencimento, e o mesmo botão de revogar. Como efeito colateral, o CRÍTICO 1 fica quase
resolvido: a tela onde ele revoga passa a ser, por construção, a das concessões que ele pode revogar.

### ALTO 5. "Transfira a posse" é oferecida por escrito e não existe em lugar nenhum

**O que acontece hoje.** Quando o dono de um grupo tenta sair, `groupOwnerCannotLeaveNotice()`
(`frontend/src/js/admin/group-phrases.js`) diz: "Apague o grupo, ou transfira a posse dele". Não há UI de
transferência em `frontend/src/js/admin/groups-tab.js`, e não há rota:
`backend/src/modules/access-groups/access-groups.routes.js` expõe `GET /`, `GET /participating`, `POST /`,
`PATCH /:groupId`, `DELETE /:groupId`, `GET|POST /:groupId/members`, `DELETE /:groupId/members/me` e
`DELETE /:groupId/members/:userId`, e o schema de atualização aceita só nome e descrição. Compare com atlas,
que tem transferência de posse.

**Por que é ruim.** Uma recusa que nomeia dois caminhos e entrega um é pior que uma que nomeia um: manda o
usuário procurar um botão que não existe. E o caminho que sobra é destrutivo (apagar o grupo poda as
concessões dele), então a recusa empurra para o ato irreversível.

**Arquivo e símbolo.** `frontend/src/js/admin/group-phrases.js` · `groupOwnerCannotLeaveNotice`;
`frontend/src/js/admin/groups-tab.js` · `_renderParticipating`;
`backend/src/modules/access-groups/access-groups.routes.js`;
`backend/src/modules/access-groups/access-groups.schemas.js` · `updateGroupSchema`.

**Correção proposta.** Duas saídas, e a escolha é do dono do produto. Implementar a transferência (a coluna
`owner_id` já existe e a autoridade já mora nela), ou trocar o texto por "Apague o grupo" enquanto ela não
existir. A segunda é de uma linha e fecha a mentira hoje.

### ALTO 6. Não dá para escolher o prazo, e o próprio texto manda renovar de um jeito impossível

**O que acontece hoje.** O parágrafo fixo de `_renderAddSection`
(`frontend/src/js/catalog/resource-share.modal.js`) diz: "para manter, conceda de novo antes da data". Só que
não há campo de prazo (nem `_handleGrant` nem `_handleGrantGroup` mandam `expiresAt`, embora
`apiClient.grantResource` aceite o campo), e conceder de novo é impossível pelos dois lados: `alreadyGranted`
tira da busca quem já tem concessão viva, e o servidor devolve 409 para a segunda concessão do mesmo
concedente ao mesmo par. Renovar exige revogar antes, e revogar poda a subárvore, que não volta.

**Por que é ruim.** O texto instrui uma ação que a interface bloqueia. E a única saída disponível
(revogar e conceder de novo) é justamente a que derruba tudo o que o beneficiário repassou.

**Arquivo e símbolo.** `frontend/src/js/catalog/resource-share.modal.js` · `_renderAddSection`,
`_handleGrant`, `_handleGrantGroup`, `alreadyGranted` (em `frontend/src/js/catalog/grant-tree.js`);
`frontend/src/js/store/sync/api-client.js` · `grantResource`.

**Correção proposta.** Um botão "Estender" na linha da concessão viva, que empurre `expires_at` para frente
pelo teto do pai (o `LEAST` de três tetos do `INSERT` já sabe fazer o clamp, então a regra existe), e o texto
do parágrafo passando a apontar para esse botão. Escolher prazo mais curto no ato da concessão é
independente, e é decisão de produto (ver Perguntas 2).

### ALTO 7. Adicionar alguém a um grupo é o ato que concede, e é o único do ciclo que não avisa nem relata

**O que acontece hoje.** Na aba Grupos, apagar o grupo e remover um membro têm confirmação com o alcance
(`groupDeletionWarning`, `memberRemovalWarning`) e toast com o número do servidor (`groupDeletionSummary`,
`memberRemovalSummary`). Adicionar não tem nada: `_addMember` (`frontend/src/js/admin/groups-tab.js`) diz
apenas "Fulano entrou no grupo." A tabela de grupos mostra uma coluna "Recursos" com a CONTAGEM de recursos
privados a que o grupo dá acesso, mas nunca quais, e o texto do sucesso não a menciona.

**Por que é ruim.** Do ponto de vista do eixo de acesso, pôr alguém num grupo que já recebeu sete recursos
privados é conceder sete acessos de uma vez, sem passar pelo gate de repasse e sem linha nova em
`resource_grants` (é a delegação que `granteeGroupOwnerLabel` existe para tornar visível do outro lado). A
simetria está invertida: o ato que TIRA acesso é o cuidadoso, e o que DÁ é o mudo.

**Arquivo e símbolo.** `frontend/src/js/admin/groups-tab.js` · `_addMember` (comparar com `_removeMember` e
`_delete`); `frontend/src/js/admin/group-phrases.js` · `memberRemovalWarning`, `groupDeletionWarning`.

**Correção proposta.** O toast de sucesso passa a relatar o alcance, com o `grant_count` e o
`atlas_share_count` que a listagem já traz: "Fulano entrou no grupo e passa a enxergar 7 recursos privados e
2 atlas". Sem confirmação prévia, porque adicionar é reversível e confirmar tudo treina a ignorar; o relato
depois basta.

### MÉDIO 1. A UI não distingue POR QUE ele vê um recurso

O selo "Privado" do cartão (`frontend/src/js/catalog/components/catalog-card.js` · `createCatalogCard`) e o
do seletor de camada base (`frontend/src/js/base-layer-selector/base-layer-selector.control.js` ·
`_createLayerOption`) cobrem TRÊS origens: papel global, concessão pessoal e empréstimo do atlas em foco. O
próprio código sabe disso e escreve por extenso em `lendingScopeNote`
(`frontend/src/js/catalog/visibility-phrases.js`): "só a terceira SOME sozinha quando a pessoa troca de
atlas". Pior, o `title` do selo diz "só quem recebeu acesso enxerga este item", frase que é FALSA para o
único perfil que vê tudo sem ter recebido nada.

O payload de `/resource-access/visible` não carrega procedência: `listVisibleResources`
(`backend/src/modules/resource-access/resource-access.service.js`) devolve os cinco grupos de ids mais
`shareable`, e o cliente indexa dois conjuntos (`_privados`, `_repassaveis`) em
`indexarPayload`.

Correção: no mínimo, trocar o `title` por algo verdadeiro para os três casos ("Recurso privado: não aparece
no catálogo de quem não tem acesso a ele"). Idealmente, o servidor devolver a origem por id e o selo virar
três: "por papel", "concedido a você" e "emprestado por este atlas", sendo o terceiro o único que some ao
trocar de atlas. Isso responde a pergunta que este perfil faz o tempo todo, que é "o meu colega vê isto?".

### MÉDIO 2. As telas dele são as mais cheias do produto, e não há como filtrar

O catálogo filtra só por TIPO (`frontend/src/js/catalog/catalog.modal.js` · `_applyFilters`,
`_computeFilterCounts`, e `components/catalog-filters.js`). O credenciado enxerga o acervo privado inteiro do
sistema, de todas as OMs, somado ao público. Não há filtro por privacidade, por OM dona nem por produtor, e o
cartão nem mostra a OM. Correção: um filtro "Privado / Público" (barato, o dado já está em
`isPrivateResource`), e, se o item 1 acima for feito, um por origem.

### MÉDIO 3. Na busca de pessoas do modal, "ninguém encontrado" e "a rede caiu" são a mesma tela em branco

`_renderResultsInto` (`frontend/src/js/catalog/resource-share.modal.js`) faz
`container.innerHTML = results.length ? this._renderResults(results) : ''`, o que torna o ramo
`'Nenhum usuário encontrado'` de `_renderResults` **inalcançável**: o painel é revelado com string vazia. E
`_runSearch` trata falha de rede com exatamente o mesmo par de chamadas. Resultado: uma caixa branca para as
duas causas. Correção: renderizar o vazio (o texto já existe) e um estado de erro distinto, como o que a
listagem de grupos já tem (`groupsLoadFailureNotice`).

### MÉDIO 4. As telas de recusa do modal falam com o beneficiário errado, e o 404 não tem ramo

`_renderDenied` mostra "Você recebeu este recurso apenas para ver." Para o credenciado essa frase é falsa em
todas as palavras: ele não recebeu nada. E o 404 (recurso apagado por outra sessão) cai no `_renderError`
genérico, com um "Tentar novamente" que nunca vai resolver. Correção: mensagem por status, e sem retry no
404.

### MÉDIO 5. Na aba Grupos, carregando e falha são visualmente idênticos, e não há retry

`_renderList`, `_renderParticipating` e `_renderMembers` (`frontend/src/js/admin/groups-tab.js`) usam o mesmo
`<p class="admin-users__status">` para "Carregando grupos…" e "Falha ao carregar os grupos.": mesma classe,
mesmo cinza, sem `role="alert"`, sem botão de nova tentativa. A única recuperação é recarregar a página.
Ironia útil: a frase certa existe, em `groupsLoadFailureNotice` (`frontend/src/js/admin/group-phrases.js`,
"Isto é falha ao consultar o servidor, não ausência de grupos"), e quem a usa é o modal de recurso, não a
aba. Correção: importá-la ali e acrescentar "Tentar de novo".

Do mesmo lote: nenhum `catch` da aba re-renderiza a lista, então um 404 de linha morta (grupo apagado noutra
sessão) deixa a tela mostrando a linha com botões que vão falhar de novo.

### MÉDIO 6. O aviso de remoção de membro cita um alcance velho sem dizer que é velho

`_reachForWarning` relê `listAccessGroups()` antes de apagar um grupo, e acrescenta `STALE_COUNTS_NOTICE`
quando a releitura falha. `_removeMember` não faz nada disso: o `group` vem do fechamento de `_renderTable`, e
`grant_count`/`atlas_share_count` são a foto do momento em que a aba montou (só `member_count` é atualizado,
em `_renderMembers`). Os dois atos são igualmente irreversíveis. Correção: chamar `_reachForWarning` também
em `_removeMember`.

### MÉDIO 7. A lista "quem tem acesso" subconta o alcance, e a frase de apoio não conta a metade que mais surpreende

A frase de `_renderGrantsSection` nomeia três origens que não aparecem na lista (administradores,
credenciados e produtores da OM dona). Faltam duas, e são as que mudam a decisão de quem concede:

- **o empréstimo por atlas.** `LIST_GRANTS_FOR_RESOURCE` lê só `resource_grants`, e o braço D4 de
  `fn_granted_resource_ids` (`backend/src/database/migrations/008_acesso_a_recurso.sql`) entrega o recurso a
  quem abre um atlas cujo DONO o enxerga. Ninguém desses aparece na lista;
- **o visitante anônimo de link público**, que herda o empréstimo pela cláusula 6.3.

Ou seja: a tela pode dizer "3 pessoas têm acesso" enquanto um atlas público empresta o recurso para qualquer
um com o link. Quem revoga a única linha da lista acha que fechou o acesso e não fechou.

Existe texto certo em outro lugar do produto: `lendingScopeNote` e `lendingRemovalWarning`
(`frontend/src/js/catalog/visibility-phrases.js`) explicam o empréstimo com precisão, mas moram na aba de
configuração do atlas, que é a tela de quem empresta, não a de quem concede. Correção: acrescentar o
empréstimo à frase de apoio da lista, e, se houver dado, uma linha "emprestado por N atlas" (o servidor já
sabe resolver isso: `atlasesLendingResource`, usado para acordar as salas na revogação).

### MÉDIO 8. O toast de revogação afirma um fim que os bytes do 3D ainda não têm

`_handleRevoke` diz "Acesso removido" assim que a rota volta. Para o 3D, os bytes continuam saindo por até 30
segundos: `backend/src/modules/nomes/assets3d-acesso.js` memoiza a decisão de acesso (`TTL_MS`), e
`gateDeAsset3d` serve do memo. Some-se a isso a cláusula 10.3, que registra que a revogação não é empurrada
em tempo real para quem não está numa sala que empresta. O texto não precisa virar um tratado; basta não
afirmar instantaneidade que o sistema não entrega, por exemplo "Acesso removido. Quem estiver com o recurso
aberto pode continuar vendo até recarregar."

### BAIXO 1. O escudo diz "administração" onde o rótulo foi escrito para não dizer

`SHIELD_ICON` (`frontend/src/js/admin/admin-panel.js`, usado incondicionalmente em `_buildHeader`) aparece ao
lado do título "Grupos". `mountAdminPage` (`frontend/src/js/admin/index.js`) usa
`title: label ?? 'Administração'` como fallback, e `account.control.js` cria o botão com o texto
'Administração' antes de `_updateAdminVisibility` reescrevê-lo, então o rótulo errado existe no DOM por um
instante. Somado a isso, a página monta uma nav rail vertical com um item só. Todo o cuidado do
`fileoverview` de `admin-audience.js` ("o rótulo nomeia o que a pessoa recebe, nunca a página") é desfeito
pela moldura.

### BAIXO 2. Bordas da aba Grupos

Três, todas em `frontend/src/js/admin/groups-tab.js`: o ramo `LEAVE_AVAILABILITY.INDETERMINADO` de
`_renderParticipating` renderiza uma div de ações vazia (o ramo `DONO` recebeu o cuidado, este não); a recusa
ao dono (`groupOwnerCannotLeaveNotice`) só existe em `title`, invisível no toque, com "Você é o dono" como
único texto visível; e a coluna "Dono" de `_renderTable` é 100% redundante para quem não é administrador (o
comentário do código admite que ela existe para o administrador).

### BAIXO 3. Fora do alcance deste perfil, mas anotado

`users-tab.js` monta o chip de papel com `ROLE_CHIP[u.role]?.rotulo ?? 'Usuário'`, o que contradiz a política
escrita em `frontend/src/js/ui/role-labels.js` ("falling back to 'Usuário' would be the silent demotion"). Um
quinto papel emitido pelo servidor apareceria como "Usuário" na tabela do administrador. O credenciado não
abre essa aba, então isto não o afeta; fica registrado porque é o mesmo eixo.

---

## 4. O que está BOM e não deve ser mexido

1. **`adminAudience` como definição única da porta.** Uma função pura, sem imports, consumida por seis
   sítios, com a decisão do credenciado escrita no `fileoverview`. Ela é a razão de o rótulo não divergir por
   tela e de as abas serem recortadas no cliente em vez de darem 403 na montagem ("403 na montagem é a pior
   forma de dizer não"). O único reparo que eu faria é de legibilidade, não de comportamento (ver Perguntas
   6).
2. **O selo de papel com a frase.** `globalRoleBadge` e `GLOBAL_ROLE_DESCRIPTIONS`
   (`frontend/src/js/ui/role-labels.js`), replicados no menu de conta do mapa, na barra de `atlas.html` e
   `admin.html`, e em "Minha conta". A frase do credenciado ("Enxerga todo recurso privado do acervo e pode
   conceder acesso a ele, sem editá-lo") é exata e é a única coisa no produto que lhe ensina o papel. O
   tratamento do papel desconhecido (mostrar o valor cru e dizer que não sabe descrevê-lo) é o padrão certo.
3. **O texto do prazo.** O parágrafo de `_renderAddSection` e o chip `expira em DD/MM/AAAA` com o `title`
   "Depois desta data o acesso deixa de valer sozinho, sem aviso". É a única defesa contra um sumiço que não
   emite evento nenhum, e o `fileoverview` de `expiryLabel` diz exatamente por quê.
4. **O relato da cascata, dos dois lados do clique.** O chip `+N dependente(s)` na linha, o
   `revocationWarning` que conta e NOMEIA até três, e o toast pós-ato que usa o número do SERVIDOR e inclui
   as MANTIDAS (`reparented` + `trimmed`) para que a poda parcial não pareça incompleta. É o melhor
   tratamento de ato destrutivo do produto.
5. **A frase que diz quem NÃO aparece na lista.** "Administradores, credenciados e produtores da OM dona
   enxergam este recurso por papel, sem concessão, e não aparecem nesta lista." Resolve, num lugar, a dúvida
   estrutural de uma lista que é necessariamente parcial.
6. **`granteeGroupOwnerLabel`.** Nomear o dono do grupo beneficiário torna visível a única transferência de
   autoridade do sistema que não gera linha em `resource_grants`. O raciocínio está escrito no `fileoverview`
   e vale manter.
7. **Criar grupo sem sair do fluxo de concessão** (`_renderGroupCreate`, um campo só), com
   `newGroupEmptyHint` avisando que grupo novo nasce vazio.
8. **A separação "Meus grupos" / "Grupos de que participo"**, com `participatingReachUnknownNotice` dizendo
   que a ausência do número não significa zero. É honestidade sobre o que a tela não sabe, que é raro.
9. **O eixo de recurso e o eixo de grupo separados no cliente**, com `hasGlobalDataAccess` tendo um consumidor
   só e o JSDoc dizendo qual, para que a próxima varredura não o pode como morto.
10. **Esconder em vez de desabilitar.** O campo "Acesso (visibilidade)" de `catalog-tab.js` e o botão
    "Compartilhar" do cartão seguem a mesma doutrina, e ela está escrita.
11. **`calibracao.html` e as duas entradas de menu que a espelham.** O credenciado não vê a porta que não
    pode abrir, e o espelho é por chamada da mesma função, não por cópia do predicado.
12. **`canShareResource` cobre o buraco que o payload deixa, e o código diz por quê.** `LIST_SHAREABLE_OF_ACTOR`
    (`backend/src/modules/resource-access/resource-access.queries.js`) lê só `resource_grants` de nível
    `view_share` e a produção, então `shareable` chega **vazio** para o credenciado, que mesmo assim pode
    conceder tudo. Quem soma o papel é o cliente, por `hasGlobalDataAccess()`, e o comentário do servidor
    aponta para isso nominalmente. Uma UI que decidisse o botão só por `shareable` deixaria o credenciado com
    a capacidade e sem porta; a que existe acerta. Não fundir os dois.
13. **A ausência da classe de promoção silenciosa.** Não há um `role !== 'user'` no cliente inteiro, e o
    censo `backend/tests/unit/papel-global-censo.test.js` reprova sítio de papel global não classificado no
    servidor. Se algo deve ser preservado por regressão, é isto.

---

## 5. Perguntas em aberto, que só o dono decide

1. **Quem revoga?** A constituição (3.5) descreve o efeito e não o sujeito; `CLAUDE.md` diz "concede/revoga";
   o servidor deixa o credenciado revogar só o que ele originou. As duas saídas para o CRÍTICO 1 são
   opostas: ou a UI passa a esconder o botão nas linhas alheias, ou o servidor devolve o credenciado ao ramo
   curinga (o que a fase F9 tirou de propósito). Recomendo a primeira, e que a cláusula 3.5 ganhe a frase que
   falta, dizendo quem revoga.
2. **Prazo escolhível?** Hoje toda concessão nasce com o padrão do servidor. Um credenciado que empresta
   acervo para um exercício de duas semanas não tem como dizer isso. Vale um campo, ou um par de atalhos (30
   dias / 1 ano)?
3. **Procedência do acesso.** Fazer `/resource-access/visible` devolver, por id, se o acesso veio de papel,
   de concessão ou de empréstimo custa uma coluna a mais no payload e resolve o MÉDIO 1 e metade do MÉDIO 2.
   O contra-argumento é que o cliente hoje não sabe de qual OM é cada item, e passar a saber alarga o que ele
   precisa manter coerente. Vale o custo?
4. **Trilha para o credenciado.** Ele não tem aba de Auditoria (decisão registrada), e também não tem
   inventário do que concedeu (ALTO 4). São dois buracos que se fecham juntos: uma trilha recortada nas
   concessões que ELE originou não é a trilha do sistema, e responderia às duas perguntas. Fica na porta dele
   ou não fica?
5. **Transferência de posse de grupo:** implementar, ou apagar a frase que a promete? A primeira é
   trabalho de rota mais tela; a segunda é uma linha e para de mentir hoje.
6. **`adminAudience` decide o credenciado por AUSÊNCIA.** Ela recebe três booleanos e ele chega ao ramo final
   porque os três falharam. O destino é o certo e está documentado, mas o único freio contra uma futura linha
   do tipo "tem papel global, então Administração" é a prosa. Aceitar `isCredenciado` na assinatura só para
   devolver o mesmo resultado tornaria a decisão legível no código, ao preço de um parâmetro que ninguém usa.
   Vale?
7. **10.1 e este perfil.** Enquanto os bytes do tile não têm gate e o navegador pede sem credencial, o
   credenciado é quem mais sente: o papel dele é ler o privado. Aceitar o silêncio atual, ou pagar agora o
   marcador de "camada indisponível" (ALTO 2), que é útil de qualquer forma depois que 10.1 fechar?
