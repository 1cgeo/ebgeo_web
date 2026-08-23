# Relatório de UI/UX: o Administrador do sistema

Avaliação de um perfil só, o papel global `admin`, feita contra o CÓDIGO do branch `integracao_backend`
em 2026-08-23. Prosa de documentação não foi aceita como evidência: onde a wiki e o código divergiram,
o que está escrito aqui é o que o código faz, e a divergência está anotada.

Método: leitura integral de `frontend/src/js/admin/` (seis abas mais a casca), das superfícies de
administração fora do painel (`frontend/src/js/account/account.control.js`, `frontend/src/js/ui/app-bar.js`,
`frontend/src/js/catalog/resource-share.modal.js`, `frontend/src/js/modals/account-settings.modal.js`), e
das rotas, consultas e middlewares correspondentes em `backend/src/`.

---

## 1. O que o administrador É, segundo o estatuto e segundo o código

### 1.1 O que o estatuto lhe dá

[`CONSTITUICAO.md`](CONSTITUICAO.md) atribui ao papel `admin` estas capacidades, com o estado que cada
cláusula declara:

| cláusula | o que dá ao administrador | estado |
|---|---|---|
| 1.1 | é um dos quatro papéis globais, que não formam escada | vigente |
| 1.3 | é o único que promove a produtor ou credenciado; não se rebaixa | vigente |
| 2.3 / 2.7 | define a visibilidade de qualquer recurso; lê tudo e "configura tudo" | vigente, com a ressalva escrita na própria 2.7 |
| 3.3 | origina concessão de raiz sobre recurso privado | vigente |
| 4.2 | é exceção universal na autoridade sobre grupo | vigente |
| 5.5 | tem **posse em todo atlas** | vigente |
| 8.5 | desativar conta ou OM mata a autoridade que ela sustentava | vigente |
| 9.1 | acessa **toda** a trilha e todas as configurações | vigente |
| 10.6 | o desbloqueio de conta pendente "passa a ser ato de administrador" | limite conhecido |
| 10.7 | a chave de API é o usuário inteiro, sem escopo e sem prazo | pendente |

As cláusulas hoje **não vigentes**, segundo o censo de
[`frontend/tests/unit/constituicao-estado-das-clausulas.test.js`](frontend/tests/unit/constituicao-estado-das-clausulas.test.js)
(constante `ABERTAS`), são quatro: **1.5** (pendente, auto-cadastro esperando o relay de e-mail), **9.3**
(em obra, o de-para não cobre as famílias de atlas, permissões e grupos), **10.1** (pendente por decisão,
os bytes do tile privado) e **10.7** (pendente por trabalho, as três amarras da chave de API).

A própria 2.7 declara o buraco de verificação que este relatório encontrou várias vezes: *"configura tudo"
é um universal sem guarda universal*, provado rota a rota. É exatamente onde as ausências se acumulam.

### 1.2 O que o código lhe dá

Confirmado por leitura:

- **A ponte entre os eixos existe e é só dele.** `toFrontendRole` (`backend/src/utils/roles.js`) tem como
  primeira decisão `if (globalRole === 'admin') return 'admin'`, sem olhar a permissão por atlas.
  `producer` e `credenciado` caem na escada como conta comum. No cliente, o predicado que lê isso é
  `serverTreatsAsAtlasOwner` (`frontend/src/js/projects/permission-levels.js`), que delega a
  `atlasRoleHasAtLeast(role, 'owner')`, ou seja, hierarquia e não lista fechada.
- **`requireAtlasPermission` (`backend/src/middleware/permissions.js`) carimba `req.atlasPermission = 'owner'`
  para o administrador antes de consultar share nenhum.** Não existe "administrador somente leitura".
- **É o único caminho que escreve `producer_org_id`**, pelo `updateUserAdminSchema`
  (`backend/src/modules/users/users.schemas.js`), e o par (papel, escopo) é bicondicional no banco
  (`users_producer_scope_check`), espelhado em `resolveProducerScope`
  (`backend/src/modules/users/users.service.js`).
- **A auto-guarda existe, e em dois níveis diferentes**: `updateUser` recusa com **409** o auto-rebaixamento
  e a auto-desativação por PUT; `deleteUser` recusa a auto-desativação com **403**. A tela espelha os dois
  em `UsersTab._renderForm` (`role.disabled` e `active.disabled` quando `isSelf`) e em `_renderTable`
  (botão "Desativar" desabilitado com `title`).
- **A edição destrutiva do painel é o par papel/OM produtora.** `fundamentoDeRaizPerdido` +
  `podarPorRaizes` (`backend/src/modules/users/users.service.js`, origem `USER_DEMOTION`) revogam toda
  concessão viva daquela pessoa com a subárvore, na mesma transação do UPDATE, e o PUT devolve
  `grantsAffected`/`grantsReparented`. A tela consome os dois corretamente.
- **A porta se chama "Administração" e o recorte de abas é o completo.** `adminAudience`
  (`frontend/src/js/admin/admin-audience.js`) devolve `ABAS_DO_ADMINISTRADOR` com seis ids, e é a mesma
  definição consumida por `admin-page.js`, `admin/index.js`, `account.control.js` e `projects-page.js`.
- **Abre `calibracao.html`.** `mayCalibrate()` (`frontend/src/js/ui/app-bar.js`) e
  `_updateCalibrationVisibility` (`frontend/src/js/account/account.control.js`) usam o mesmo par
  `isAdmin() || isProducer()` do gate da própria página.

### 1.3 Onde os dois divergem

Cinco divergências, todas verificadas no código, e são elas que sustentam a seção 3:

1. **Cláusula 5.5 dá posse em todo atlas; a listagem não dá nem visibilidade.** `LIST_USER_ATLAS`
   (`backend/src/modules/atlas/atlas.queries.js`) filtra por `a.owner_id = $1 OR us.atlas_id IS NOT NULL`
   e **não tem ramo de administrador**, enquanto `listDeletedUserAtlas` e `restoreAtlas`
   (`backend/src/modules/atlas/atlas.service.js`) recebem `isAdmin` e alternam para
   `LIST_ALL_DELETED_ATLAS` e `RESTORE_ATLAS_ADMIN`. Ou seja: o administrador enumera **a lixeira inteira
   do sistema** e **não enumera os atlas vivos**.
2. **Cláusula 2.7 diz "configura tudo"; não existe rota para transferir a OM dona de um item de catálogo.**
   `updateCatalogItem` mantém `owner_org_id` fora do `SET` (`CAMPOS_EDITAVEIS`), e `createCatalogItem`
   carimba `owner_org_id` do `req.catalogActor`, que para o administrador é nulo. O formulário afirma o
   contrário em texto (ver achado A4).
3. **Cláusula 9.1 diz "toda a trilha"; o módulo de postos não escreve trilha nenhuma.**
   `backend/src/modules/ranks/ranks.controller.js` e `ranks.service.js` não importam `createAudit`
   (contagem zero em ambos).
4. **Cláusula 10.7 chama a rotação de chave de "a única revogação"; a rotação da chave de OUTRA pessoa não
   tem interface.** `apiClient.rotateUserApiKey` (`frontend/src/js/store/sync/api-client.js`) tem **zero**
   chamadores em `frontend/src/`.
5. **Cláusula 8.5 diz que desativar uma conta ou a OM dela mata a autoridade; a tela que faz as duas coisas
   não diz nada disso.** Detalhe nos achados C1 e C2.
6. **O papel que atravessa os dois eixos não é nomeado em tela nenhuma onde ele muda o que a pessoa pode
   fazer.** A descrição existe e é boa (`GLOBAL_ROLE_DESCRIPTIONS.admin`, em
   `frontend/src/js/ui/role-labels.js`, é a única das quatro que diz "em qualquer atlas"), mas o selo só
   aparece na barra superior das páginas sem mapa, no menu de conta do mapa e em "Minha conta". Detalhe no
   achado A9.

---

## 2. Inventário de ações

Veredito: **OK** (alcançável, rótulo verdadeiro, gates casam), **ATRITO** (funciona, mas confunde ou custa
caro), **QUEBRADO** (a tela mente, o ato não é relatado, ou a capacidade não existe).

### 2.1 Aba Usuários (`frontend/src/js/admin/users-tab.js`)

| ação | símbolo | veredito | observação |
|---|---|---|---|
| Listar usuários | `UsersTab._renderList` / `_renderTable` | ATRITO | `GET /users` não pagina; a busca é local e só cobre nome e usuário |
| Buscar / mostrar inativos | `_applyFilter`, checkbox `admin-users-include-inactive` | OK | o toggle recarrega do servidor, o texto filtra local |
| Criar usuário | `_renderForm(null)` + `apiClient.createUser` | ATRITO | não há campo de e-mail (o schema não o aceita), então a conta nasce sem endereço e sem recuperação própria |
| Editar dados | `_renderForm(user)` | OK | duas colunas separadas para lotação e OM produtora, com `title` explicando cada uma |
| Trocar papel global | `selectField('Papel', ROLE_OPTIONS)` | OK | quatro opções, sem `optgroup`, rótulos que dizem o que cada papel É |
| Trocar OM produtora | `syncProducerField` + `producerOm` | OK | o campo some fora do papel Produtor; o par viaja coerente (`producer_org_id: null` no rebaixamento) |
| Avisar da poda antes de salvar | `verdictOfChange` + `producerScopeChangeWarning` | OK | melhor fluxo destrutivo do painel inteiro |
| Relatar a poda depois | `producerScopeChangeSummary` | OK | usa `grantsAffected`/`grantsReparented` do servidor |
| Redefinir senha | `_renderPasswordForm` | OK | confirmação de senha, e o servidor corta as sessões |
| Desativar | `_deactivate` | **QUEBRADO** | achado C2: confirmação omite a cascata inteira, toast descarta os três números do servidor |
| Transferir atlas ao desativar | `_renderTransfer` | ATRITO | a contagem de atlas vem no 409 e é descartada; a tela diz "um ou mais atlas" |
| Reativar | `_reactivate` | ATRITO | sem confirmação e sem aviso de que a chave de API volta a valer; não ressuscita concessão nenhuma |
| Aprovar e-mail pendente | checkbox `admin-userform-emailverified` | ATRITO | achado A8: não é ação de linha e o endereço não é exibido |
| Rotacionar chave de API de outro | (não existe UI) | **QUEBRADO** | achado A3 |
| Auto-guarda | `isSelf` + `deBtn.disabled` | OK | espelha os dois gates do servidor |

### 2.2 Aba Grupos (`frontend/src/js/admin/groups-tab.js`)

| ação | símbolo | veredito | observação |
|---|---|---|---|
| Listar "Meus grupos" | `_renderTable` | ATRITO | achado M1: para o administrador a lista é de TODOS, e o título continua "Meus grupos" |
| Listar "Grupos de que participo" | `_renderParticipating` | OK | as duas chamadas por `Promise.allSettled`, cada falha isolada |
| Criar / renomear | `_renderForm` | OK | unicidade decidida pelo servidor, sem corrida no cliente |
| Apagar grupo | `_delete` + `_reachForWarning` | OK | relê os números antes de avisar, e diz quando não conseguiu reler |
| Aviso pelos dois eixos | `groupDeletionWarning` / `reachPhrase` | OK | recursos E atlas; ramo de zero não vira susto |
| Relato depois | `groupDeletionSummary` | ATRITO | achado M4: `grantsReparented` não vem no corpo da rota |
| Ver membros | `_renderMembers` + `groupReach` | OK | a linha de alcance é reescrita a partir do roster recém-lido |
| Adicionar pessoa | `_addMember` | OK | idempotência do servidor respeitada (`added === false`) |
| Remover pessoa | `_removeMember` + `memberRemovalWarning` | OK | número do servidor no toast |
| Sair de grupo alheio | `_leave` + `leaveGroupAvailability` | OK | o botão não aparece para o dono, porque o servidor responde 409 |

### 2.3 Aba Sistema (`frontend/src/js/admin/config-tab.js`)

| ação | símbolo | veredito | observação |
|---|---|---|---|
| Ler config efetiva e overrides | `ConfigTab._render` / `_buildForm` | OK | mostra os dois documentos, e o avançado é o override cru |
| Salvar só o que mudou | `onSave` + `diffBool` / `diffNum` | **QUEBRADO** | achado M2: não recarrega depois de salvar, então desfazer no mesmo ciclo não faz nada e a tela diz que salvou |
| Editar override arbitrário | `advInput` + `deepMerge` | ATRITO | o merge nunca remove chave; a única remoção é limpar tudo, e o hint diz isso |
| Limpar todos os overrides | `clearBtn` | ATRITO | confirmação sem número de chaves nem lista do que será perdido |
| Aviso de recarregar | `notice` | OK | config é lida no boot, e a tela diz isso |

### 2.4 Aba Catálogo (`frontend/src/js/admin/catalog-tab.js`)

| ação | símbolo | veredito | observação |
|---|---|---|---|
| Legenda dos três eixos | `_build` (`legenda`) | OK | texto diferente para administrador e produtor |
| Listar por categoria | `_renderResourceList` / `_renderResourceTable` | ATRITO | sem busca, sem ordenação, sem paginação |
| Criar item | `_renderResourceForm(cat, null)` | ATRITO | administrador só cria acervo institucional; não há como criar para uma OM |
| Editar metadados e JSON | `onSave` | OK | JSON validado, estilo MapLibre validado antes de gravar |
| OM dona | `readOnlyField('OM dona')` | **QUEBRADO** | achado A4: o `hint` promete uma transferência que não existe em rota nenhuma |
| Público/privado | `accessInput` + `setResourceVisibility` | OK | pergunta só no sentido destrutivo, e a segunda escrita relata erro à parte |
| Miniatura | `THUMB_KEY` + `compressImage` | OK | teto de 256 kB, WebP, remoção explícita |
| Vídeo de prévia | `CATEGORIAS_COM_VIDEO` | OK | quatro tipos; basemap fora por decisão registrada |
| Forma do 3D | `forma3dInput` + `derivarForma3d` | OK | campo de primeira classe, não linha de JSON |
| Excluir item | `_deleteResource` | **QUEBRADO** | achado A6: sem checagem de referência, sem número, sem reativação |
| Listar 360 | `_render360List` / `_render360Table` | OK | separa Status de Acesso, e diz por que |
| Ativar/desativar 360 | `_toggle360` | OK | |
| Público/privado 360 | `_toggle360Access` | OK | mesma confirmação assimétrica dos outros quatro tipos |
| Vídeo de prévia 360 | `_edit360Video` | OK | `null` do prompt é abandono, string vazia é remoção |
| Excluir 360 | `_delete360` | ATRITO | é o **único hard-delete do sistema** e a confirmação não diz isso |
| Conceder acesso a recurso privado | (não existe no painel) | **QUEBRADO** | achado A2 |

### 2.5 Aba Pessoal (`frontend/src/js/admin/personnel-tab.js`)

| ação | símbolo | veredito | observação |
|---|---|---|---|
| Listar postos | `SUBCATS[0].list` | ATRITO | sem coluna de status, sem busca |
| Criar / editar posto | `_renderForm` | ATRITO | nenhuma escrita de posto entra na trilha de auditoria |
| "Excluir" posto | `_delete` → `apiClient.deleteRank` | **QUEBRADO** | achado C3: é desativação, e a linha continua na tela |
| Listar OMs | `SUBCATS[1].list` | ATRITO | idem, e o slug derivado não é mostrado |
| Criar OM | `create` + `slugify` | ATRITO | o slug é imutável e o administrador nunca o vê antes de gravar |
| Editar OM | `update` | ATRITO | só manda `{nome, sigla}`; `is_active` é aceito pelo schema e a tela nunca o envia |
| "Excluir" OM | `_delete` → `apiClient.deleteOrganization` | **QUEBRADO** | achado C1: expulsa da API todo mundo lotado nela, o autor do clique incluído |

### 2.6 Aba Auditoria (`frontend/src/js/admin/audit-tab.js`)

| ação | símbolo | veredito | observação |
|---|---|---|---|
| Ler a trilha | `AuditTab._render` | OK | padrão de 7 dias, uma frase por linha, agrupamento por dia |
| Descobrir o escopo | `resposta.administra` | OK | a tela obedece ao servidor em vez de deduzir da sessão |
| Filtrar por período | `PERIODOS` | OK | |
| Filtrar por ação | `acoesPorFamilia` | OK | com `optgroup` por família |
| Filtrar por tipo de alvo | `TIPOS_DE_ALVO` | OK | |
| Filtrar por alvo exato | `_campo('admin-audit-alvo')` | ATRITO | achado M8: só aceita id colado à mão |
| Filtrar por OM do acervo | `buildDomainOptions` | OK | preserva a OM desativada, rotulada "(atual)" |
| Filtrar por ATOR | (não existe) | **QUEBRADO** | achado A7 |
| Ler o de-para | `_detalhes` + `linhasDoDePara` | OK | três regimes ditos por extenso |
| Paginar | `_rodape` | OK | |
| Exportar | (não existe) | ATRITO | achado B6 |
| Aviso do backfill de OM | `nota` | OK | ressalva antes da conclusão, não depois |

### 2.7 Fora do painel

| ação | símbolo | veredito | observação |
|---|---|---|---|
| Entrar na Administração | `adminAudience` consumido nos quatro sítios | OK | rótulo idêntico nas quatro portas |
| Abrir a Calibração 360 | `mayCalibrate` (`ui/app-bar.js`), `_updateCalibrationVisibility` (`account.control.js`) | OK | alcançável do mapa, do seletor de atlas e do próprio painel |
| Editar a própria conta | `showAccountSettingsModal` (`modals/account-settings.modal.js`) | OK | os campos que o servidor recusa são só de leitura, com a nota de quem os muda |
| Ver o próprio papel global | `globalRoleBadge` (`ui/role-labels.js`) | OK | |
| Trocar a própria senha | `validatePasswordForm` | OK | avisa que derruba esta sessão também, ANTES do botão |
| Gerar a própria chave de API | `_rotateKey` + `API_KEY_ONE_TIME_WARNING` | OK | melhor tela de segredo do produto |
| Conceder recurso privado | `showResourceShareModal` (`catalog/resource-share.modal.js`), gateado por `canShareResource` | ATRITO | os cinco tipos têm porta, mas só a partir do mapa (cartão do catálogo e seletor de camada base) |
| Listar / revogar concessões de um recurso | `listResourceGrants` | ATRITO | mesma porta, mesma limitação; não há resposta no painel para "quem enxerga isto" |
| Gerir atlas alheio | `LIST_USER_ATLAS` sem ramo de admin; `cardMenuActions` | **QUEBRADO** | achado A1 |
| Restaurar atlas alheio da lixeira | `AtlasDrive._trashCard` / `_restore`; `listDeletedUserAtlas(userId, isAdmin)` | **QUEBRADO** | achado A9: funciona, sem dizer de quem é o atlas e sem confirmação |
| Compartilhar atlas alheio | `SharingModal` (`modals/sharing.modal.core.js`) | **QUEBRADO** | achados A10 e M14: o administrador não aparece na própria lista, e a transferência de posse descreve um efeito sobre ele que recai sobre outra pessoa |
| Ver o próprio nível num atlas alheio | `LIST_USER_ATLAS` (`user_permission`) | ATRITO | achado M13: chega sem o dobramento, e o cartão fica mais fechado que o servidor |

---

## 3. Achados, por gravidade

### CRÍTICO

---

#### C1. "Excluir" uma OM desativa a organização, expulsa da API todo mundo lotado nela (o próprio administrador incluído) e não há caminho de volta pela interface

**O que acontece hoje.** Na aba Pessoal, cada linha de Organização Militar tem um botão vermelho "Excluir".
A confirmação é `Excluir "<nome>" da lista?`. O clique chama `apiClient.deleteOrganization`, que bate em
`DEACTIVATE_ORGANIZATION` (`backend/src/modules/organizations/organizations.queries.js`), um
`UPDATE organizations SET is_active = false`. O controller responde 204 vazio. A tela mostra "Item
excluído.".

A partir do instante seguinte, `getLiveAuthState` (`backend/src/utils/org-status.js`) devolve
`org_is_active: false` para todo usuário cujo `organization_id` seja aquela OM, e o middleware `auth`
(`backend/src/middleware/auth.js`) responde **403 "Organization is inactive"** antes de qualquer checagem
de papel. `requireAdmin` nunca é alcançado.

**Por que é ruim.** Três coisas se somam e nenhuma é visível na tela:

- O gate de OM precede o gate de papel, então **um administrador lotado naquela OM se expulsa a si mesmo**.
  Numa instalação com uma OM só, ou com a OM padrão, o clique derruba a API para todo mundo.
- Existe auto-guarda para o usuário (409 e 403 em `updateUser` e `deleteUser`) e **não existe nenhuma**
  para a organização. A assimetria é do código, não do estatuto.
- **Não há volta pela interface.** `updateOrganizationSchema` aceita `is_active`, mas `SUBCATS[1].update`
  em `personnel-tab.js` só envia `{ nome, sigla }`, e não existe botão "Reativar". A saída documentada é
  SQL direto no banco.

E a cascata da cláusula 8.5 acontece por predicado, silenciosa: `fn_can_produce_resource` fecha a escrita
de quem produzia por aquela OM, e `fn_principal_vivo` esconde as concessões originadas por ela. Nada disso
é contado, avisado ou relatado.

**Arquivos e símbolos.** `frontend/src/js/admin/personnel-tab.js`: `SUBCATS` (entrada `om`, campos `remove`
e `update`), `PersonnelTab._delete`. `backend/src/modules/organizations/organizations.queries.js`:
`DEACTIVATE_ORGANIZATION`, `UPDATE_ORGANIZATION`. `backend/src/utils/org-status.js`: `getLiveAuthState`,
`orgIsActive`. `backend/src/middleware/auth.js` (o ramo `if (!live.orgIsActive)`).

**Correção proposta.**
1. Trocar o rótulo para **"Desativar"** e o toast para "Organização desativada.", porque é o que o servidor
   faz.
2. Guarda dura, espelhando a de usuário: se `org.id === sessionContext.organizationId`, o botão fica
   desabilitado com `title` explicando ("Você está lotado nesta OM: desativá-la tiraria o seu próprio
   acesso"). E o mesmo gate no servidor, com 409, porque a interface não é fronteira.
3. Confirmação com número real: quantos usuários estão lotados nela, quantos a têm como OM produtora e
   quantos itens de catálogo ela mantém. Os três números já são consultáveis; hoje nenhum é pedido.
4. Coluna **Status** na tabela e botão **Reativar** (`PUT /organizations/:id` com `is_active: true`), que a
   rota já aceita.

---

#### C2. Desativar um usuário é o ato mais destrutivo do painel, e é o que menos avisa e menos relata

**O que acontece hoje.** `UsersTab._deactivate` mostra uma confirmação de uma linha:

> Desativar o usuário "fulano"? Ele não poderá mais entrar.

E, no sucesso, um toast de três palavras: `Usuário desativado.`

O que o servidor de fato executa, em `deleteUser` (`backend/src/modules/users/users.service.js`), numa
transação só: transfere os atlas, apaga os shares do novo dono, faz o soft-delete, revoga toda a família de
refresh e carimba o corte de sessão, e chama `podarConcessoesDeQuemFoiDesativado` (origem `USER_DELETE`),
que revoga toda concessão originada por aquela pessoa com a subárvore. A resposta é
`{ success, atlasTransferred, grantsRevoked, grantsReparented }`.

**Por que é ruim.**

- **Os três números que o servidor mediu são jogados fora.** `_deactivate` ignora o corpo da resposta por
  completo. O administrador acaba de derrubar N concessões e a tela não conta.
- **A confirmação omite a cascata inteira.** Nada sobre concessões, nada sobre os grupos de que a pessoa é
  dona (que param de entregar acesso, cláusula 8.5), nada sobre os atlas dela pararem de emprestar recurso
  privado (cláusula 6.2). "Ele não poderá mais entrar" descreve a menor das consequências.
- **A contradição está dentro do mesmo arquivo.** A troca de papel, que poda menos, tem um fluxo exemplar:
  `verdictOfChange` decide se pergunta, `producerScopeChangeWarning` avisa com `live_grant_count`,
  `producerScopeChangeConfirmLabel` muda o rótulo do botão conforme a contagem, e
  `producerScopeChangeSummary` relata `grantsAffected` e `grantsReparented`. A desativação, que é o
  superconjunto daquilo, não tem nada disso. O padrão certo já está escrito e testado a vinte linhas de
  distância.
- **Também não há transferência de autoridade.** O estatuto prescreve "quem for desativar uma conta que
  concedeu muito deve reconceder antes", e nenhuma tela diz isso no momento em que importa.

**Arquivos e símbolos.** `frontend/src/js/admin/users-tab.js`: `UsersTab._deactivate`, `_renderTransfer`.
`frontend/src/js/admin/producer-scope-phrases.js`: `producerScopeChangeWarning`,
`producerScopeChangeSummary` (o modelo a copiar). `backend/src/modules/users/users.service.js`:
`deleteUser`, `podarConcessoesDeQuemFoiDesativado`.

**Correção proposta.** Um irmão de `producer-scope-phrases.js` para a desativação, com a mesma forma:
aviso antes com `user.live_grant_count` (que a listagem **já traz**, por `LIVE_GRANTS_BY_GRANTER_AGG`), mais
a frase da cascata que não tem número, mais a menção aos grupos de que a pessoa é dona; e toast depois
compondo `atlasTransferred`, `grantsRevoked` e `grantsReparented`. Nenhuma rota nova é necessária: os dados
já viajam nos dois sentidos.

---

#### C3. "Excluir" nas duas listas de Pessoal anuncia sucesso e a linha continua na tela, idêntica

**O que acontece hoje.** Tanto `deleteRank` quanto `deleteOrganization` são desativações
(`DEACTIVATE_RANK` e `DEACTIVATE_ORGANIZATION`, ambas `SET is_active = false`), e as listagens que a aba
consome, `LIST_RANKS` e `LIST_ORGANIZATIONS`, **não filtram `is_active`**. `PersonnelTab._renderTable`
tampouco renderiza esse campo (`SUBCATS[*].cells` devolve `[nome, nome_abrev, sort_order]` e
`[nome, sigla]`).

A sequência que o administrador vê: clica em "Excluir", confirma, recebe "Item excluído." e **a linha
continua exatamente onde estava, sem nenhuma marca**. A conclusão natural é que a exclusão falhou, então
ele clica de novo. E de novo.

**Por que é ruim.** É a classe "verificação fantasma" na direção do usuário: uma confirmação de sucesso
desmentida pela própria tela um frame depois. O verbo está errado (é desativação), o relato está errado
(nada foi excluído) e o estado resultante é invisível. Some-se a isto que a desativação de OM tem a
consequência de C1: o administrador pode repetir um ato de alcance sistêmico achando que nenhum deles pegou.

**Arquivos e símbolos.** `frontend/src/js/admin/personnel-tab.js`: `PersonnelTab._delete`,
`PersonnelTab._renderTable`, `SUBCATS`. `backend/src/modules/ranks/ranks.queries.js`: `LIST_RANKS`,
`DEACTIVATE_RANK`. `backend/src/modules/organizations/organizations.queries.js`: `LIST_ORGANIZATIONS`,
`DEACTIVATE_ORGANIZATION`.

**Correção proposta.** Coluna **Status** com o mesmo par de selos da aba Usuários
(`admin-users__badge--active` / `--inactive`), rótulo **"Desativar"** / **"Reativar"** conforme a linha,
toast "Item desativado." / "Item reativado.", e um filtro "Mostrar inativos" espelhando o que a aba Usuários
já faz. Nenhuma rota nova: `PUT` de posto e de OM já aceitam `is_active`.

---

### ALTO

---

#### A1. O administrador tem posse em todo atlas e não consegue LISTAR nenhum atlas alheio, embora liste a lixeira inteira

**O que acontece hoje.** `LIST_USER_ATLAS` (`backend/src/modules/atlas/atlas.queries.js`) devolve só o que
o chamador possui ou recebeu por share, sem ramo de administrador. `listUserAtlas`
(`backend/src/modules/atlas/atlas.service.js`) não recebe sequer um parâmetro `isAdmin`. Já
`listDeletedUserAtlas(userId, isAdmin)` e `restoreAtlas(atlasId, userId, isAdmin)`, no mesmo arquivo,
recebem e alternam para `LIST_ALL_DELETED_ATLAS`, que traz `owner_nome`/`owner_username` justamente para
tornar o atlas alheio identificável.

**Por que é ruim.** A cláusula 5.5 é vigente e `requireAtlasPermission` a implementa: o administrador entra
em qualquer atlas cujo id ele consiga nomear, com nível `owner`. Só que **não há como nomear**. A posse
universal só se exerce por link colado, o que na prática significa pedir a URL ao dono. É o inverso do que a
cláusula existe para permitir (assumir um atlas cujo dono sumiu). E a inversão é gritante: o administrador
enumera todos os atlas **apagados** do sistema e nenhum dos **vivos**.

**Arquivos e símbolos.** `backend/src/modules/atlas/atlas.queries.js`: `LIST_USER_ATLAS`,
`LIST_ALL_DELETED_ATLAS`. `backend/src/modules/atlas/atlas.service.js`: `listUserAtlas`,
`listDeletedUserAtlas`, `restoreAtlas`.

**Correção proposta.** Não transformar a lista padrão do administrador na lista de tudo: isso empurraria a
tela cotidiana dele para dentro do acervo alheio. A forma que respeita o desenho é um recorte explícito, na
linha do que a lixeira já faz: uma consulta `LIST_ALL_ATLAS` acionada por um controle nomeado ("Todos os
atlas do sistema"), com `owner_nome` na linha e um selo visual de "de outra pessoa", e o parâmetro `isAdmin`
descendo por `listUserAtlas` do mesmo jeito que já desce por `listDeletedUserAtlas`.

---

#### A2. Privatizar um recurso está no painel e conceder acesso a ele não está em lugar nenhum do painel

**O que acontece hoje.** A aba Catálogo marca um item como Privado (`accessInput` +
`apiClient.setResourceVisibility`) e avisa corretamente do efeito. A concessão, que é o contrapeso disso,
mora em `ResourceShareModal` (`frontend/src/js/catalog/resource-share.modal.js`), que é aberto por
exatamente dois sítios, ambos do mapa: `createCatalogCard` (`catalog/components/catalog-card.js`, que sobe
para `CatalogModal._handleShare`) e `base-layer-selector/base-layer-selector.control.js`. Verifiquei por
grep: `apiClient.listResourceGrants` tem um único chamador em `frontend/src/`, que é aquele modal.

**Nenhum tipo concedível fica órfão**, e isso é importante para não exagerar o achado: os quatro tipos com
cartão saem por `RESOURCE_ACCESS_BY_CATALOG_TYPE` (`catalog/catalog.constants.js`) e o quinto, o basemap,
tem a porta no seletor de camada base exatamente porque não tem cartão. O problema não é cobertura, é
**localização**.

**Por que é ruim.** O gesto natural é "tornar privado e dar acesso a quem precisa", e ele atravessa duas
páginas: privatiza no painel, sai do painel, entra no mapa, abre o catálogo, acha o item de novo, e só
então compartilha. Pior, **a lista de quem tem acesso a um recurso privado não é consultável do painel**,
então a pergunta "quem enxerga isto hoje" não tem resposta na tela onde a privacidade foi decidida. Numa
auditoria de acesso, é a primeira pergunta.

Existe uma razão técnica registrada: `admin.html` boota sem a store e o modal arrastaria o motor de sync
pelo caminho transitivo. É uma restrição real, mas é restrição de import, não de produto, e o próprio
`resource-share.modal.js` já importa `admin-audience.js` e `group-phrases.js` **por arquivo** exatamente
para não arrastar barrel.

**Arquivos e símbolos.** `frontend/src/js/admin/catalog-tab.js`: `_renderResourceTable` (onde falta o botão),
`_render360Table`. `frontend/src/js/catalog/resource-share.modal.js`: `showResourceShareModal`.
`frontend/src/js/store/sync/api-client.js`: `listResourceGrants`, `revokeResourceGrant`.

**Correção proposta.** Duas metades, e a primeira é barata: uma coluna somente de leitura na tabela de
catálogo com a contagem de concessões vivas do item (uma agregação, do mesmo feitio de `live_grant_count` na
listagem de usuários), que responde "quem enxerga isto" sem carregar modal nenhum. A segunda é o botão
"Compartilhar" abrindo o modal por `import()` dinâmico, se e quando as dependências dele forem podadas até
caberem numa página sem store.

---

#### A3. A única revogação de uma chave de API comprometida de outra pessoa não tem interface

**O que acontece hoje.** A cláusula 10.7 declara que a chave de API resolve para a linha inteira de `users`,
carrega o papel global (administrador incluído), não tem escopo nem prazo, e que **a única revogação é
rotacioná-la**. A rota existe e é de administrador: `POST /users/:userId/api-key/rotate`. O cliente já a
expõe: `apiClient.rotateUserApiKey`. **Zero chamadores em `frontend/src/`** (verificado por grep).

Some-se: `SOFT_DELETE_USER` só mexe em `is_active`, e `FIND_USER_BY_API_KEY` filtra por `is_active`. Então
desativar a conta neutraliza a chave, e **reativar a conta ressuscita a mesma chave**, sem que nada na tela
de reativação (`UsersTab._reactivate`, que nem confirmação tem) mencione isso.

**Por que é ruim.** É exatamente o defeito que o `fileoverview` de
`frontend/src/js/modals/account-settings.modal.js` diz ter nascido para consertar, no caso da própria
conta: rota montada, gateada, auditada, e alcançada por nada. Sobrou a metade administrativa. Diante de uma
chave vazada, o administrador só tem o instrumento errado, a desativação da conta inteira, e ela é
reversível de um jeito que devolve o problema.

**Arquivos e símbolos.** `frontend/src/js/store/sync/api-client.js`: `rotateUserApiKey` (sem chamador),
`getUser` (idem). `frontend/src/js/admin/users-tab.js`: `_renderTable` (onde falta a ação), `_reactivate`.
`backend/src/modules/users/users.service.js`: `rotateApiKey`.

**Correção proposta.** Ação "Chave de API" na linha do usuário, abrindo uma confirmação que diga o que a
cláusula 10.7 diz (a chave é a conta inteira, invalida na hora, sem janela de sobreposição) e, no sucesso,
revelando a chave nova pelo mesmo bloco de segredo de uso único que `account-settings.modal.js` já
implementa. E uma frase em `_reactivate` avisando que a chave anterior volta a valer.

---

#### A4. O formulário de catálogo afirma que transferir um recurso entre OMs é ato de administrador, e não existe rota nenhuma que faça isso

**O que acontece hoje.** O `hint` do campo "OM dona", na edição, diz literalmente: *"A OM dona é definida na
criação e não muda por esta tela. Transferir um recurso entre OMs é ato de administrador, fora do painel."*

`updateCatalogItem` (`backend/src/modules/catalog/catalog.service.js`) mantém `owner_org_id` fora de
`CAMPOS_EDITAVEIS` e fora do `SET`; `createCatalogItem` carimba `owner_org_id` a partir de
`req.catalogActor.producerOrgId`, **nunca do corpo**. Um grep por `owner_org_id =` em `backend/src/` só
acha ocorrências dentro da migração que criou a coluna. Não existe rota nenhuma.

Na criação, o mesmo campo diz ao administrador: *"Para que uma OM o mantenha, quem cria é o produtor dela."*
Ou seja, o administrador de fato não consegue criar acervo em nome de uma OM, nem corrigir uma OM dona
errada. Se um produtor criou o item na OM errada, ou se uma OM foi desativada, o item fica encalhado.

**Por que é ruim.** É a forma mais cara de texto errado: uma afirmação confiante que manda o leitor procurar
em outro lugar um caminho que não existe. O leitor típico aqui é um agente ou um administrador novo, e os
dois vão gastar tempo caçando "o painel externo".

**Arquivos e símbolos.** `frontend/src/js/admin/catalog-tab.js`: `_renderResourceForm` (bloco `ownerField` +
`hintParagraph`). `backend/src/modules/catalog/catalog.service.js`: `createCatalogItem`,
`updateCatalogItem`, `CAMPOS_EDITAVEIS`.

**Correção proposta.** Decisão do dono entre duas saídas honestas: (a) implementar a transferência, como
campo editável só para administrador em `updateCatalogItem`, com trilha própria, o que é o que a cláusula
2.7 sugere; ou (b) corrigir o texto para dizer a verdade ("Hoje não há como transferir um recurso entre
OMs"). O que não pode continuar é o meio-termo atual.

---

#### A5. Atlas na lixeira não contam na desativação, então a conta é desativada sem uma pergunta e os atlas ficam com dono morto

**O que acontece hoje.** `COUNT_USER_ATLAS` e `TRANSFER_ATLAS_OWNERSHIP`
(`backend/src/modules/users/users.queries.js`) filtram os dois por `deleted_at IS NULL`. Uma conta cujos
atlas estejam todos na lixeira devolve contagem **zero**, então o 409 não dispara, a tela de transferência
não aparece, e a desativação passa direto. Os atlas continuam com `owner_id` apontando para a conta morta.

**Por que é ruim.** Pela cláusula 6.2 e pela 8.5, um atlas cujo dono perdeu acesso deixa de emprestar os
recursos privados dele. Restaurar aquele atlas depois (o administrador consegue, por `restoreAtlas` com
`isAdmin`) devolve um atlas mutilado, e nada no caminho avisou que isso ia acontecer. É perda de acesso sem
aviso, na definição exata.

**Arquivos e símbolos.** `backend/src/modules/users/users.queries.js`: `COUNT_USER_ATLAS`,
`TRANSFER_ATLAS_OWNERSHIP`. `frontend/src/js/admin/users-tab.js`: `_deactivate`, `_renderTransfer`.

**Correção proposta.** Contar também os apagados, num número separado, e dizê-lo na confirmação de C2:
"Esta pessoa é dona de N atlas ativos e M na lixeira. Os da lixeira não são transferidos." Se o dono quiser
que também sejam, é uma linha no `WHERE` de `TRANSFER_ATLAS_OWNERSHIP`, mas essa é decisão de produto (ver
seção 5).

---

#### A6. Excluir um item de catálogo não consulta referência nenhuma, não relata nada e não tem volta pela interface

**O que acontece hoje.** `CatalogTab._deleteResource` pergunta `Excluir "<nome>" do catálogo?` e nada mais.
`deleteCatalogItem` é um `UPDATE ... SET active = false` com o gate no `WHERE`, e o controller responde
**204 sem corpo**. Nenhuma consulta é feita a `atlas_resources`, a `catalog_layers` ou ao registro de
referências (`backend/src/modules/atlas/resource-reference.registry.js`), que é justamente o inventário de
onde um id de catálogo mora dentro de um atlas. O único caminho que purga vínculos é `purgeResourceLinks`, e
ele só é chamado pelo hard-delete do 360.

**Por que é ruim.** Segundo `.claude/rules/architecture.md`, um id de recurso vive em várias superfícies de
`atlas.settings`, e **cinco delas são allowlist**, onde a lista vazia significa "sem restrição". Um item
removido do catálogo deixa referências penduradas em briefings, em camadas e em configurações de atlas, e
o administrador não recebe nem um número. Some-se que não existe rota de reativação: o desfazer é recriar o
item com o mesmo id (o que `createCatalogItem` aceita, ressuscitando a linha), mas nada na tela diz isso.

**Arquivos e símbolos.** `frontend/src/js/admin/catalog-tab.js`: `_deleteResource`, `_delete360`.
`backend/src/modules/catalog/catalog.service.js`: `deleteCatalogItem`.
`backend/src/modules/resource-access/resource-access.service.js`: `purgeResourceLinks` (o que existe e não é
chamado aqui).

**Correção proposta.** Antes de confirmar, uma leitura da contagem de atlas que referenciam o id, pelo mesmo
registro que já enumera as superfícies, e a confirmação citando o número. No sucesso, um toast que diga
"desativado" (o verbo certo) e mencione que recriar com o mesmo id restaura. Para o 360, a confirmação
precisa dizer que aquele é o único apagamento definitivo do sistema.

---

#### A7. A trilha não responde "o que fulano fez", e as escritas de posto não entram na trilha

**O que acontece hoje.** Duas coisas distintas, na mesma cláusula 9.1.

A rota `GET /audit` aceita `actorId` (está em `listAuditSchema`), e a aba **não oferece o filtro**. A
ausência é declarada no comentário de `AuditTab.mount`, com o motivo: resolver nome em UUID exigiria
`/users/search`, e a aba serve também ao produtor. O caminho que sobra é filtrar por ação e ler a coluna
do ator com o olho.

E o módulo de postos não audita nada: `backend/src/modules/ranks/ranks.controller.js` e
`ranks.service.js` não importam `createAudit` (contagem zero em ambos), enquanto o de organizações audita
`ORG_CREATE`/`UPDATE`/`DELETE`.

**Por que é ruim.** "Quem fez isto" é a primeira pergunta de qualquer investigação, e é a única que a tela
não deixa fazer. O motivo declarado não se sustenta para o administrador: ele **já tem** um filtro que só
ele vê (a OM do acervo, gateado por `this._administra`), e o mesmo gate serviria a um campo de ator com
busca por nome. Quanto aos postos, a lista controlada alimenta os `<select>` de cadastro de toda a base, e
uma renumeração de hierarquia militar não deixa rastro nenhum.

**Arquivos e símbolos.** `frontend/src/js/admin/audit-tab.js`: `AuditTab.mount` (o `_filtros` sem `actorId`),
`_toolbar` (o ramo `if (this._administra)`). `backend/src/modules/audit/audit.schemas.js`:
`listAuditSchema`. `backend/src/modules/ranks/ranks.controller.js`.

**Correção proposta.** Filtro de ator com a mesma busca debounced que a aba Usuários e a aba Grupos já
usam (`apiClient.searchUsers`), atrás do mesmo `this._administra` que já gateia o filtro de OM. E
`createAudit` nas três escritas de posto, com as ações no mesmo vocabulário das de organização.

---

#### A8. Aprovar uma conta pendente é o desbloqueio oficial da cláusula 10.6, está escondido dentro do formulário, e o administrador não vê o endereço que está aprovando

**O que acontece hoje.** A listagem mostra um selo "Pendente" ao lado do status quando
`u.email && u.email_verified === false`. Para aprovar, é preciso clicar em "Editar", rolar até o fim do
formulário e marcar a caixa "E-mail verificado (aprovar acesso)", que só é montada quando `user.email`
existe. Não há ação de linha.

E o endereço nunca aparece: `LIST_ALL_USERS` seleciona `u.email`, o dado chega no cliente, e
`_renderTable` não o exibe em coluna nem em `title`. Nem os schemas de administrador aceitam `email` na
criação ou na edição (só `email_verified`), então o administrador também não pode corrigi-lo.

**Por que é ruim.** A cláusula 10.6 diz, por escrito, que uma conta pendente cativa nome de usuário e
e-mail para sempre e que **o desbloqueio passa a ser ato de administrador**. O ato existe, mas é o mais
escondido do painel, e é feito às cegas: o administrador aprova um endereço que não consegue ler. Se o
endereço estiver errado (que é a causa mais comum de conta encalhada), não há como corrigi-lo, e o par
fica cativo indefinidamente, exatamente como a cláusula descreve.

**Arquivos e símbolos.** `frontend/src/js/admin/users-tab.js`: `_renderTable` (o selo pendente),
`_renderForm` (o `emailVerified`). `backend/src/modules/users/users.queries.js`: `LIST_ALL_USERS`.
`backend/src/modules/users/users.schemas.js`: `updateUserAdminSchema`.

**Correção proposta.** Botão "Aprovar" na linha pendente, com o endereço na confirmação
(`Aprovar o acesso de @fulano (endereco@dominio)?`); e o endereço exibido no `title` do selo em todos os
casos. Corrigir o e-mail é decisão do dono (seção 5), porque abre a porta a trocar o identificador de
recuperação de uma conta alheia.

---

---

#### A9. Nada na interface diz ao administrador que ele está alcançando algo POR SER administrador, e a lixeira do sistema é o caso extremo

**O que acontece hoje.** Fiz a varredura: fora de `frontend/src/js/admin/`, não existe em tela nenhuma um
rótulo, selo ou aviso dizendo a alguém que ele alcança um atlas, um recurso ou um grupo por causa do papel
global. As duas únicas menções ao administrador em texto visível o citam na TERCEIRA pessoa
(`visibility-phrases.js`: *"Continuam vendo: administradores, credenciados..."*; `resource-share.modal.js`:
*"Administradores, credenciados e produtores da OM dona enxergam este recurso por papel, sem concessão, e
não aparecem nesta lista."*). O selo de papel global (`globalRoleBadge`, `ui/role-labels.js`) aparece na
barra superior de `atlas.html` e de `admin.html`, no menu de conta do mapa e em "Minha conta", e não
acompanha o administrador até as telas onde o papel muda o que ele pode fazer.

O caso extremo é a **lixeira**. `listDeletedUserAtlas(userId, isAdmin)` alterna para
`LIST_ALL_DELETED_ATLAS`, cujo comentário no próprio SQL diz que `owner_nome`/`owner_username` existem para
"tornar o atlas de outro usuário identificável na lista". `AtlasDrive._trashCard` **não desenha nenhum dos
dois** (nem usa `AtlasDrive._subtitle`, que é quem escreve `por Você` / `por <fulano>` nos cartões vivos).
Resultado: o administrador abre a aba Lixeira e vê a lixeira do sistema inteiro, com cartões
indistinguíveis dos dele, e restaura qualquer um deles com um clique. `AtlasDrive._restore` chama a API
direto, sem confirmação, e mostra "Atlas restaurado.".

**Por que é ruim.** Restaurar o atlas apagado de outra pessoa é um ato sobre o trabalho alheio, e ele
acontece com menos cerimônia do que apagar um grupo vazio. Mais grave que o clique acidental é o modelo
mental: o administrador não distingue, em nenhum momento, o que é dele do que é de outros, e é justamente
esse papel que precisa da distinção, porque é o único cujas telas misturam as duas coisas.

**Arquivos e símbolos.** `frontend/src/js/projects/atlas-drive.js`: `AtlasDrive._trashCard`,
`AtlasDrive._restore`, `AtlasDrive._subtitle`. `backend/src/modules/atlas/atlas.queries.js`:
`LIST_ALL_DELETED_ATLAS`. `frontend/src/js/ui/role-labels.js`: `globalRoleBadge`,
`GLOBAL_ROLE_DESCRIPTIONS`.

**Correção proposta.** Três passos, do mais barato ao mais caro: (a) `_trashCard` passa a escrever o dono,
reusando `_subtitle`; (b) confirmação em `_restore` quando o atlas não é do observador, nomeando o dono;
(c) um selo discreto, do tipo "por administração", nas linhas que o observador alcança por papel global e
não por posse ou share. O predicado já existe (`sessionContext.isAdmin()`), e o vocabulário também
(`GLOBAL_ROLE_LABELS`).

---

#### A10. A confirmação de "Tornar dono" diz ao administrador que ele deixará de ser dono, num atlas de que ele nunca foi dono

**O que acontece hoje.** `SharingModal` (`frontend/src/js/modals/sharing.modal.core.js`) monta a pergunta da
transferência de posse como:

> Tornar <fulano> o novo dono do atlas? Você deixará de ser o dono e passará a Gestor.

O botão que a dispara é desenhado por `SharingModal._renderMemberItem`, gateado por
`serverTreatsAsAtlasOwner(sessionContext.role)`, e o administrador global passa nesse gate em qualquer atlas
porque `toFrontendRole` o dobra para `admin`, que `toAtlasPermission` mapeia para `owner`. Só que ele não é
o `owner` do payload: `SharingModal._renderMembersSection` desenha `_renderOwnerItem(this._owner)` com o
dono REAL, e o administrador **não tem linha nenhuma na tela**.

**Por que é ruim.** A frase afirma dois fatos falsos ao administrador (que ele é o dono, e que ele passará a
Gestor) e omite o único fato verdadeiro e irreversível: que ele está **transferindo a posse de outra
pessoa**, e que o dono atual vai descobrir depois. É a definição de "UI que promete o que o servidor não
faz", invertida: a UI descreve um efeito sobre quem clica quando o efeito é sobre um terceiro.

**Arquivos e símbolos.** `frontend/src/js/modals/sharing.modal.core.js`: `SharingModal`,
`_renderMemberItem`, `_renderMembersSection`, `_renderOwnerItem`.
`frontend/src/js/projects/permission-levels.js`: `serverTreatsAsAtlasOwner`, `toAtlasPermission`.

**Correção proposta.** Bifurcar a frase pelo mesmo predicado que já decide o botão: quando o observador é o
`owner` do payload, a frase atual está certa; quando ele chega por papel global, a frase precisa nomear o
dono atual ("<dono> deixará de ser dono e passará a Gestor") e dizer que o ato é de administração. E, no
mesmo passo, mostrar uma linha "você" na lista, dizendo por que ele está ali.

### MÉDIO

**M1. A aba Grupos chama de "Meus grupos" a lista de todos os grupos do sistema.** Para o administrador,
`LIST_GROUPS` devolve todos, pelo ramo curinga de `fn_can_administer_group`, e o cabeçalho
(`sectionHeader('Meus grupos', ...)` em `GroupsTab._renderList`) continua dizendo "meus". A coluna "Dono"
existe justamente porque ele vê grupo alheio, e o comentário do código diz isso, mas o título não. Some-se
que não há busca nem paginação numa lista que, para esse papel, é a lista inteira da instalação.
*Correção*: título condicional a `sessionContext.isAdmin()` ("Todos os grupos") mais um campo de busca.

**M2. A aba Sistema não recarrega depois de salvar, então desfazer uma edição no mesmo ciclo não faz nada e
a tela diz que salvou.** `ConfigTab.onSave` faz o diff contra `eff`, que foi lido uma vez em `_render` e
nunca mais. Depois de salvar `app.title = 'B'`, digitar o valor original 'A' produz `titleVal === eff.app.title`,
nenhuma entrada no payload e, conforme o textarea avançado esteja vazio ou não, ou "Nenhuma alteração a
salvar." ou "Configurações salvas." com o override 'B' intacto. Repare que `clearBtn` chama `this._render()`
e `onSave` não. *Correção*: chamar `this._render()` no sucesso, como o botão de limpar já faz.

**M3. Criar ou editar uma OM ou um posto não atualiza os seletores das outras abas até um F5.**
`orgLabel` e `buildDomainOptions` (`frontend/src/js/admin/org-options.js`) leem
`config.organizacoesMilitares` e `config.postos`, que são hidratados uma única vez por
`applyRuntimeConfig`, chamado só no boot de cada página (verificado por grep: os quatro chamadores são os
quatro entries). O servidor invalida o memo do `/api/config` a cada escrita, mas o singleton do cliente já
está montado. O fluxo que quebra é o óbvio: criar a OM em Pessoal, ir a Usuários promover alguém a Produtor
dela, e não encontrá-la no `<select>`. *Correção*: rechamar `applyRuntimeConfig` depois de uma escrita de
Pessoal, ou exibir o mesmo aviso de "recarregue para aplicar" que a aba Sistema já usa.

**M4. A exclusão de grupo não pode dizer quantas concessões foram preservadas, e a de usuário pode.**
`groupDeletionSummary` compõe `grantsAffected` e `atlasShares`, e `grantsReparented` não vem no corpo de
`DELETE /access-groups/:id` (o `return` do service não o inclui; o número existe, mas só no `details` da
trilha). O mesmo vale para `memberRemovalSummary`. Como `producerScopeChangeSummary` diz "Mantidas por
outro caminho: N", o administrador aprende a esperar esse número e não o recebe onde ele mais assusta.
*Correção*: incluir `grantsReparented` no objeto de retorno das duas rotas de grupo, e compor a frase.

**M5. Falha de carregamento é beco sem saída em todas as seis abas.** O padrão é sempre o mesmo: um
parágrafo "Falha ao carregar X." mais um toast, e nenhum botão. Para tentar de novo é preciso trocar de aba
e voltar (ou, em Sistema e Auditoria, recarregar a página). O único lugar do produto que faz isso direito é
`resource-share.modal.js`, que tem um `resource-share-groups-retry`. *Correção*: um botão "Tentar de novo"
no mesmo bloco, chamando o método de render que falhou.

**M6. Nenhuma lista do painel pagina, e só duas têm busca.** `GET /users` não pagina (traz tudo);
`GET /users/search` tem LIMIT 20 fixo; as listas de grupos, catálogo (por categoria), 360 e pessoal não têm
nem busca nem ordenação nem paginação. Só Usuários (filtro local) e Auditoria (paginação real) escapam.
*Correção*: começar pela busca local, que é barata e resolve a maior parte, e deixar paginação real para as
listas que o servidor já sabe paginar.

**M7. Dois campos úteis chegam na listagem de usuários e não têm leitor.** `LIST_ALL_USERS` seleciona
`u.email` e `u.last_login_at`, e `_renderTable` não mostra nenhum dos dois. `last_login_at` é o dado que
responde "esta conta ainda é usada", que é a pergunta anterior a qualquer limpeza de base. É o mesmo defeito
que a aba Grupos fechou em 2026-08-23 quando passou a ler `added_by`. *Correção*: coluna "Último acesso" e
o e-mail no `title` do selo de status.

**M8. O alvo de uma linha de auditoria não é clicável.** `_linha` põe o `target_id` só no `title` da frase,
com a justificativa correta (slug e UUID poluem a linha). Mas o filtro "Alvo (id exato)" existe logo acima,
e a única forma de usá-lo é passar o mouse, ler um UUID e digitá-lo. *Correção*: clique na frase que preenche
`this._filtros.targetId` e re-renderiza; o estado e o campo já existem.

**M9. `admin.css` (1019 linhas) não tem uma única media query.** Só `app-bar.css` tem duas. O painel é uma
grade fixa de trilho lateral mais tabelas largas, num produto que mantém um chunk `phone-ui` para o mapa.
Num tablet em retrato o trilho e a tabela disputam a mesma largura sem nada que os reorganize. *Correção*:
uma quebra que colapse o trilho em barra horizontal e transforme as tabelas em cartões abaixo de, digamos,
900px. Se a decisão for que o painel é desktop-only, isso merece estar escrito.

**M10. "Manter como está" na privatização não cancela o salvamento, e o rótulo sugere que sim.** Em
`_renderResourceForm`, recusar a confirmação apenas devolve o `<select>` ao valor anterior; nome, descrição
e JSON são gravados normalmente. A escolha é deliberada e está justificada em comentário (abortar tudo
descartaria em silêncio a edição do resto), mas o par de rótulos "Tornar privado" / "Manter como está" não
transmite isso. *Correção*: "Salvar sem tornar privado" no botão de recuo.

**M11. Desativar uma OM não é auditado dentro da transação, e `ORG_DELETE` não grava `targetName`.** Os três
`createAudit` de `backend/src/modules/organizations/organizations.controller.js` são chamados sem o terceiro
argumento (a transação), ao contrário de todo o resto do sistema. Se o INSERT da trilha falhar, a OM já
mudou e a resposta é 500: operação e trilha divergem. E `ORG_DELETE` guarda só o UUID, então a trilha do ato
de C1 não diz nem o nome da organização derrubada. *Correção*: transacionar, e preencher `targetName`.

**M12. A poda por desativação e por rebaixamento não acorda ninguém ao vivo.** Só a revogação por
`DELETE /grants/:grantId` chama `avisarAtlasQueEmprestam`. Quem perdeu acesso por `USER_DELETE`,
`USER_DEMOTION` ou exclusão de grupo descobre no próximo carregamento, e enquanto isso a camada continua
desenhada com a URL antiga. Isto é limite conhecido (cláusula 10.3), mas nenhuma tela de administração o
menciona no momento em que o administrador poda. *Correção*: uma frase no toast de C2 e do grupo, dizendo
que os afetados que estiverem com o app aberto só verão o efeito no próximo carregamento.

**M13. Num atlas alheio compartilhado com ele, o cliente é MAIS fechado que o servidor.**
`LIST_USER_ATLAS` projeta `user_permission` como `CASE WHEN a.owner_id = $1 THEN 'owner' ELSE us.permission END`,
**sem o dobramento de `toFrontendRole`**. Um administrador que tenha um share de `read` num atlas de outra
pessoa recebe o chip "Leitura", e `cardMenuActions` (`frontend/src/js/projects/atlas-drive.js`) esconde
`rename`, `cover`, `access` e `trash`, embora `requireAtlasPermission` fosse resolvê-lo como `owner`. É a
direção segura do erro, e ainda assim é uma tela que nega o que o servidor concede. *Correção*: aplicar o
mesmo dobramento na projeção, ou o predicado de `serverTreatsAsAtlasOwner` sobre o papel global no cliente.

**M14. "Tornar dono" nunca aparece quando o modal de compartilhamento é aberto de `atlas.html`.** O botão lê
`sessionContext.role`, e `sessionUserInfoFromMe` (`frontend/src/js/store/sync/session-context.js`) fixa
`role: UserRole.VIEWER`: o papel por atlas só chega no payload `connected` do WebSocket, que a página do
seletor não abre. Então nem o dono real nem o administrador transferem posse a partir dali; é preciso entrar
no mapa. Isso não é específico do administrador, mas ele é quem mais opera pela página de atlas. *Correção*:
resolver o papel por atlas a partir do `user_permission` que a listagem já traz, quando não há sessão de
colaboração.

### BAIXO

**B1.** Catálogo e Pessoal usam `<p class="admin-users__status">` cru onde Usuários, Grupos e Auditoria usam
`emptyState()` de `admin-dom.js`, então o estado vazio dessas duas abas não tem a dica de "o que fazer
agora" que as outras quatro têm.

**B2.** `slugify` deriva o slug da OM sem mostrá-lo, e o slug é imutável por contrato. Vale exibi-lo, em
campo somente de leitura, antes de gravar.

**B3.** A confirmação de "Limpar todos os overrides" não diz quantas chaves serão perdidas, embora o
documento inteiro esteja carregado no textarea ao lado.

**B4.** `apiClient.getUser` não tem chamador; a tela de edição opera sempre sobre a linha da listagem, que
pode ter envelhecido (é o mesmo problema que `_reachForWarning` resolveu na aba Grupos).

**B5.** A tabela de postos não expõe `code`, embora a coluna exista, e não tem coluna de ordem visualmente
ligada ao `sort_order` que o formulário pré-preenche com `count + 1`.

**B6.** A aba Auditoria não exporta. Uma trilha que se lê para escrever relatório acaba sendo copiada à mão;
um CSV do recorte atual resolveria, e o `title` da hora já existe justamente "para citar num relatório".

---

## 4. O que está BOM e não deve ser mexido

1. **`admin-audience.js` como definição única das quatro audiências.** Uma função pura, zero imports,
   consumida pelo gate da página, pelo montador de abas, pela barra do mapa e pelo seletor de atlas. O
   rótulo nomeia o que a pessoa recebe, nunca a página, e é por isso que o produtor não lê "Administração"
   numa tela de três abas. O título provisório do boot é "Painel" pela mesma razão. Não reintroduza uma
   quinta cópia dessa tabela.

2. **O fluxo destrutivo de papel e OM produtora, em `producer-scope-phrases.js`.** É o padrão de referência
   do produto inteiro: veredito puro que decide SE pergunta, aviso antes com o número que a listagem já
   sabe, rótulo do botão que muda com a contagem (para não fazer ameaça falsa quando não há nada a revogar),
   e toast depois com o número que o servidor mediu. O `fileoverview` ainda declara a própria fragilidade
   (o espelho de `fundamentoDeRaizPerdido` não tem teste ligando os dois lados). Os achados C2, A6 e M4
   pedem exatamente que este padrão seja copiado, não que seja mudado.

3. **A aba Grupos inteira.** As duas seções respondem perguntas diferentes e a segunda existe porque um
   mecanismo que decide o acesso da pessoa não pode ser invisível para ela. `_reachForWarning` relê os
   números antes de avisar e **diz** quando não conseguiu reler. As duas chamadas vão por
   `Promise.allSettled` para que uma rede ruim não apague a outra seção. `leaveGroupAvailability` não
   oferece ao dono o botão que o servidor recusaria.

4. **A aba Auditoria.** O padrão de 7 dias, o agrupamento por dia, a frase por linha e o `details` atrás de
   botão são o que separa aquela tela de um log. A tela obedece ao `administra` do servidor em vez de
   deduzir o papel da sessão, e nasce fechada para não piscar a coluna de OM para um produtor. O aviso do
   backfill fica ANTES da lista, porque ressalva que chega depois da conclusão chega tarde. E ação sem
   tradução mostra o próprio código em vez de "Desconhecido".

5. **A separação dos três eixos na aba Catálogo**, com a legenda na tela (`_build`) e não só no código:
   Acesso diz quem vê, Status diz se aparece, OM dona diz quem mantém. A distinção "privado não é inativo"
   é a que mais gera chamado, e ela está escrita onde o usuário olha. O campo de OM dona é um `<output>`
   e não um `<input disabled>`, com a razão certa comentada.

6. **A tela "Minha conta"** (`modals/account-settings.modal.js`). Os três fatos sobre os quais ela foi
   construída foram medidos contra o servidor, não presumidos; os campos que o servidor recusa em silêncio
   aparecem somente-leitura com a nota de quem os muda; o aviso de que trocar a senha derruba esta sessão
   vem ANTES do botão; e o bloco da chave de API é o melhor tratamento de segredo do produto (revelação
   única, confirmação ao fechar sem copiar, e a tela nunca afirma se existe chave, porque nenhuma rota sabe).

7. **A auto-guarda, em ambos os lados.** O servidor recusa (409 no PUT, 403 no DELETE) e a tela desabilita
   e explica. O comentário em `_renderForm` registra por que o campo do formulário também precisa travar:
   sem isso, o botão desabilitado da lista é contornado pela porta ao lado.

8. **`ResourceShareModal` (`frontend/src/js/catalog/resource-share.modal.js`), apesar de estar no lugar
   errado (A2).** Ele é o irmão certo de `sharing.modal.core.js` e não a mesma tela, porque a resposta ali é
   uma árvore e não uma lista plana: cada linha diz de quem a pessoa recebeu, a revogação **conta e nomeia**
   quem cai junto (`grant-tree.js`), o beneficiário coletivo tem selo próprio em vez de emprestar as cores
   de presença de uma pessoa, o prazo de vencimento aparece na linha (porque a morte de uma concessão mora
   no predicado e não gera evento nenhum), e a falha de carregamento dos grupos tem botão de tentar de novo,
   que é o único do produto. Ele também diz, por escrito, que administradores e credenciados enxergam por
   papel e por isso não aparecem na lista.

9. **`visibility-phrases.js` não inventa número.** O `fileoverview` enumera as três respostas do servidor
   que poderiam dar uma contagem e por que nenhuma serve, e o módulo fica sem número em vez de fabricar um.
   É o oposto exato do defeito de C2 e A6, e é a razão certa para não citar número: não ter o número, e não
   não ter pensado nele.

10. **Os imports por arquivo em toda a pasta `admin/`.** `admin.html` boota sem a store, e cada arquivo que
   podia arrastá-la de volta pelo barrel tem um comentário explicando por que não o faz. É o que mantém a
   página barata, e é frágil de um jeito que só a disciplina segura.

---

## 5. Perguntas em aberto, que só o dono decide

1. **O administrador deve enumerar os atlas vivos do sistema (A1)?** A cláusula 5.5 dá posse e o código dá
   acesso por id, mas listar tudo é uma decisão de produto com custo de privacidade. As três saídas são:
   listar sob um controle explícito, listar só por busca (digite o nome e receba os que casam), ou aceitar
   que a posse universal se exerça apenas por URL conhecida e escrever isso na cláusula.

2. **Transferir um recurso de catálogo entre OMs deve existir (A4)?** Se sim, é escrita nova e trilha nova.
   Se não, o texto do formulário precisa parar de prometê-la.

3. **A transferência de atlas na desativação deve alcançar a lixeira (A5)?** Levar os apagados junto é uma
   linha de SQL, mas muda o significado de "transferi os atlas dele": o novo dono herdaria coisas que o
   antigo já tinha decidido descartar.

4. **O administrador pode corrigir o e-mail de uma conta alheia (A8)?** É o que destrava o caso da cláusula
   10.6, e é também trocar o identificador de recuperação de outra pessoa. Hoje nem o schema aceita.

5. **A desativação de uma OM merece o mesmo tratamento de "primeiro reconceda" que o estatuto prescreve
   para a desativação de conta (C1)?** A cascata é a mesma família, mas hoje ela é por predicado e
   reversível, enquanto a de conta é por poda e definitiva. Se a resposta for sim, o botão precisa de mais
   do que um rótulo novo.

6. **O painel é desktop-only (M9)?** Se for, vale declarar, e a ausência de media query deixa de ser
   omissão e passa a ser decisão.

7. **O filtro por ator na auditoria (A7) deve ser só do administrador, ou também do produtor dentro da OM
   dele?** O gate `administra` já existe para separar os dois; a pergunta é se o produtor tem o direito de
   perguntar "quem da minha OM mexeu nisto".

8. **O administrador deve poder mandar à lixeira e restaurar atlas alheio pela interface (A1, A9)?** O
   servidor já aceita as duas coisas (`requireAtlasPermission('owner')` curto-circuita, e `restoreAtlas`
   tem ramo `isAdmin`), e o cliente hoje oferece uma e esconde a outra, sem que essa assimetria pareça
   decidida. Se as duas devem existir, elas precisam do selo e da confirmação de A9; se nenhuma deve, o
   ramo `isAdmin` de `restoreAtlas` está sobrando.

---

*Nenhum arquivo de código foi modificado na produção deste relatório.*
