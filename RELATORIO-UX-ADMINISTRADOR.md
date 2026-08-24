# Relatório de UX: o Administrador do sistema

Perfil avaliado: conta com papel GLOBAL `admin`, o único que atravessa os dois eixos de permissão.
[`CONSTITUICAO.md`](CONSTITUICAO.md) é a especificação de referência.

**Auditoria original: 2026-08-23, 19h28.** 33 achados numerados, mais um inventário de superfícies,
uma lista do que não deve ser mexido e oito perguntas ao dono.

**Revisão: 2026-08-24.** Um lote grande entrou depois da auditoria. Este documento foi reescrito para
separar o que saiu do que fica, corrigir o que a auditoria superdeclarou e registrar o que a
conferência achou de novo.

**Baixa contra `59e9600c`, 2026-08-24: saiu UM, o N3, e o A8 encolheu.** A revisão acima foi escrita
em `11150029`. Doze achados deste relatório citam arquivos que o commit seguinte tocou; os doze foram
reabertos contra o código, e onze continuam de pé, **os dois críticos inclusive**. A observação da
seção "Como esta revisão foi feita" continua valendo e ficou mais forte: **o lote não passa pelo
painel**. Das seis abas, `59e9600c` tocou UMA (`frontend/src/js/admin/users-tab.js`), por um campo, e
`frontend/src/js/admin/personnel-tab.js` continua sem citar `is_active` uma única vez, que é o achado
C1 inteiro.

## Como esta revisão foi feita

Cada achado foi reaberto **contra o código da árvore de trabalho**, não contra a lista de commits.
Duas coisas que só isso revela:

1. **O lote não tocou o painel.** O commit que fechou os três críticos do perfil de usuário comum
   mudou 86 arquivos e, dentro de `frontend/src/js/admin/`, exatamente um:
   `frontend/src/js/admin/admin-page.js`, a casca. Nenhuma das seis abas foi editada.
   `frontend/src/js/admin/config-tab.js` e `frontend/src/js/admin/personnel-tab.js` não são tocados
   desde 2026-08-05, e o `SUBCATS` de hoje é byte a byte o daquela data. É por isso que o placar tem
   UM resolvido e não vários: o trabalho recente foi todo no perfil vizinho.
2. **Conferir também corrige quem confere.** Cinco afirmações da auditoria eram mais largas do que o
   código sustenta (um "único do produto", um "nenhuma lista pagina", uma coluna dada como ausente,
   um "único hard-delete" e um "sem media query"). Viraram achado MENOR, não achado retirado, e a
   superdeclaração ficou anotada: mandar conferir na mão o que já está resolvido custa o mesmo que
   deixar passar o que não está.

## Placar

| | |
|---|---|
| achados conferidos | 33 |
| saíram (resolvidos) | 1 |
| ficam | 32, sendo 1 parcial e 5 com a afirmação corrigida |
| partidos em dois (misturavam metades de gravidades diferentes) | 2, que viram 4 |
| achados NOVOS | 4 |
| **em vigor depois desta revisão** | **38** |
| **baixa contra `59e9600c`: saíram** | **1** (N3), mais o A8 encolhido |
| **em vigor hoje** | **37**, com os 2 críticos intactos |

Gravidade, **reordenada por gravidade real** e não pela numeração antiga: **2 críticos, 10 altos,
19 médios, 7 baixos**. Os dois críticos são os dois atos de desativação, com a mesma raiz: o servidor
mede a destruição e a tela não a diz.

O achado de maior valor continua sendo **C1**, verdadeiro em cada elo: desativar uma OM derruba a API
para todo mundo lotado nela, o próprio administrador incluído, e não há caminho de volta pela
interface.

---

## 1. O que o administrador É, segundo o estatuto e segundo o código

### 1.1 O que o estatuto lhe dá

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

As cláusulas hoje não vigentes, segundo a constante `ABERTAS` de
[`frontend/tests/unit/constituicao-estado-das-clausulas.test.js`](frontend/tests/unit/constituicao-estado-das-clausulas.test.js),
seguem quatro: **1.5**, **9.3**, **10.1** e **10.7**.

**Mudou desde a auditoria, e é o único ponto do estatuto que mudou para este perfil:** a 9.3 passou a
ser vigente **também para a família de USUÁRIOS**. O de-para cobre hoje catálogo, 360 e usuários;
atlas, permissões e grupos seguem com registro próprio. Do lado da tela, `ORIGENS`
(`frontend/src/js/admin/audit-phrases.js`) traduz os quatro carimbos de queda de concessão, e
`USER_DEMOTION` deixou de sair cru na gaveta. O quinto estado, a revogação deliberada, não carimba
origem nenhuma de propósito: ausência já significa "alguém revogou de propósito".

### 1.2 O que o código lhe dá

- **A ponte entre os eixos é só dele.** `toFrontendRole` (`backend/src/utils/roles.js`) decide
  `if (globalRole === 'admin') return 'admin'` antes de olhar a permissão por atlas; no cliente,
  `serverTreatsAsAtlasOwner` (`frontend/src/js/projects/permission-levels.js`) delega a
  `atlasRoleHasAtLeast(role, 'owner')`. Hierarquia, nunca lista fechada. E
  `requireAtlasPermission` (`backend/src/middleware/permissions.js`) carimba
  `req.atlasPermission = 'owner'` antes de consultar share nenhum: não existe "administrador somente
  leitura".
- **O papel é relido do banco a cada pedido.** O middleware `auth` (`backend/src/middleware/auth.js`)
  adota `req.user.role = live.role`, então administrador rebaixado não sobrevive na janela do token.
  Guarde a ORDEM desse bloco: ela é a causa de C1.
- **É o único caminho que escreve `producer_org_id`**, por `updateUserAdminSchema`
  (`backend/src/modules/users/users.schemas.js`), com o par (papel, escopo) bicondicional no banco
  (`users_producer_scope_check`) e espelhado em `resolveProducerScope`.
- **A auto-guarda existe em dois níveis**: `updateUser` recusa com 409 o auto-rebaixamento e a
  auto-desativação por PUT; `deleteUser` recusa a auto-desativação com 403. A tela espelha os dois, e
  `syncProducerField` roda DEPOIS da trava, para que o escopo de produção herde o cadeado.
- **A porta se chama "Administração", e abre `calibracao.html`.** `adminAudience`
  (`frontend/src/js/admin/admin-audience.js`) é a definição única, consumida em quatro sítios; o gate
  da calibração é o mesmo par `isAdmin() || isProducer()` em `mayCalibrate`
  (`frontend/src/js/ui/app-bar.js`) e em `frontend/src/js/account/account.control.js`.

### 1.3 Onde os dois divergem

**São SEIS divergências**, e cada uma vira um achado da seção 3. (A auditoria anunciava cinco e
listava seis: o contador estava errado, não a lista.)

1. A 5.5 dá posse em todo atlas e a listagem não dá nem visibilidade, porque `LIST_USER_ATLAS`
   (`backend/src/modules/atlas/atlas.queries.js`) não tem ramo de administrador enquanto a lixeira
   tem. **A1**
2. A 2.7 diz "configura tudo" e não existe rota para transferir a OM dona de um item de catálogo.
   **A4**
3. A 9.1 diz "toda a trilha" e o CRUD de postos não escreve trilha nenhuma. **M1**
4. A 10.7 chama a rotação de chave de "a única revogação" e a rotação da chave de OUTRA pessoa não
   tem interface. **A3**
5. A 8.5 diz que desativar conta ou OM mata a autoridade; a tela não diz nada disso, e por uma porta
   a autoridade NÃO morre. **C1, C2**
6. O papel que atravessa os dois eixos não é nomeado em tela nenhuma onde ele muda o que a pessoa
   pode fazer: a descrição existe e é boa (`GLOBAL_ROLE_DESCRIPTIONS`,
   `frontend/src/js/ui/role-labels.js`, é a única das quatro que diz "em qualquer atlas"), mas
   `globalRoleBadge` só é desenhado em quatro sítios, nenhum dentro do painel. **M3**

---

## 2. Inventário de superfícies

A parte densa deste documento, e a que não se repete em nenhum dos quatro relatórios irmãos.
Veredito: **OK** (alcançável, rótulo verdadeiro, gates casam), **ATRITO** (funciona, mas confunde ou
custa caro), **QUEBRADO** (a tela mente, o ato não é relatado, ou a capacidade não existe).

### 2.1 Aba Usuários (`frontend/src/js/admin/users-tab.js`)

| ação | símbolo | veredito | observação |
|---|---|---|---|
| Listar usuários | `_renderTable` | ATRITO | `GET /users` não pagina; busca local, só nome e usuário |
| Mostrar inativos | `_applyFilter` | OK | o toggle recarrega do servidor, o texto filtra local |
| Criar usuário | `_renderForm(null)` | ATRITO | sem campo de e-mail: nasce sem recuperação própria |
| Editar dados | `_renderForm(user)` | OK | lotação e OM produtora separadas, com `title` em cada |
| Trocar papel global | `ROLE_OPTIONS` | OK | rótulos que dizem o que cada papel É |
| Trocar OM produtora | `syncProducerField` | OK | some fora do papel Produtor; o par viaja coerente |
| Avisar da poda antes | `producerScopeChangeWarning` | OK | melhor fluxo destrutivo do painel |
| Relatar a poda depois | `producerScopeChangeSummary` | OK | usa os números do servidor |
| Redefinir senha | `_renderPasswordForm` | ATRITO | revoga todas as sessões e a tela não diz |
| Desativar | `_deactivate` | **QUEBRADO** | C2 |
| Transferir atlas ao desativar | `_renderTransfer` | ATRITO | a contagem vem no 409 e é descartada |
| Reativar | `_reactivate` | **QUEBRADO** | A3: sem confirmação, e a chave de API volta a valer |
| Aprovar e-mail pendente | `admin-userform-emailverified` | **QUEBRADO** | A8 |
| Corrigir e-mail alheio | (schema aceita, UI não existe) | **QUEBRADO** | A8, metade nova |
| Rotacionar chave de outro | (não existe UI) | **QUEBRADO** | A3 |
| Auto-guarda | `isSelf` | OK | espelha os dois gates, e tranca a porta lateral |

### 2.2 Aba Grupos (`frontend/src/js/admin/groups-tab.js`)

| ação | símbolo | veredito | observação |
|---|---|---|---|
| Listar "Meus grupos" | `_renderTable` | ATRITO | M4: para ele a lista é de TODOS, e o título diz "meus" |
| Listar "de que participo" | `_renderParticipating` | OK | `Promise.allSettled`, cada falha isolada |
| Criar / renomear | `_renderForm` | OK | unicidade decidida pelo servidor |
| Apagar grupo | `_reachForWarning` | OK | relê os números, e diz quando não conseguiu reler |
| Aviso pelos dois eixos | `groupDeletionWarning` | OK | recursos E atlas; ramo de zero não vira susto |
| Relato depois | `groupDeletionSummary` | ATRITO | M7: `grantsReparented` não vem no corpo da rota |
| Ver membros | `groupReach` | OK | a linha de alcance vem do roster recém-lido |
| Adicionar / remover pessoa | `_removeMember` | OK | idempotência respeitada, número do servidor no toast |
| Sair de grupo alheio | `leaveGroupAvailability` | OK | falha FECHADO: sem botão para dono e para indeterminado |

### 2.3 Aba Sistema (`frontend/src/js/admin/config-tab.js`)

| ação | símbolo | veredito | observação |
|---|---|---|---|
| Ler config efetiva e overrides | `_buildForm` | OK | mostra os dois documentos; o avançado é o override cru |
| Salvar só o que mudou | `diffBool` / `diffNum` | **QUEBRADO** | M5: não recarrega depois de salvar |
| Editar override arbitrário | `deepMerge` | ATRITO | o merge nunca remove chave, e o hint diz isso |
| Limpar todos os overrides | `clearBtn` | ATRITO | B3: confirmação sem número de chaves |
| Aviso de recarregar | `notice` | OK | correto de fato: a config é lida no boot |

### 2.4 Aba Catálogo (`frontend/src/js/admin/catalog-tab.js`)

| ação | símbolo | veredito | observação |
|---|---|---|---|
| Legenda dos três eixos | `_build` | OK | texto diferente para administrador e produtor |
| Listar por categoria | `_renderResourceTable` | ATRITO | sem busca, sem ordenação, sem paginação |
| Criar item | `_renderResourceForm` | ATRITO | administrador só cria acervo institucional |
| Editar metadados e JSON | `onSave` | OK | JSON e estilo MapLibre validados antes de gravar |
| OM dona | `readOnlyField` | **QUEBRADO** | A4: o `hint` promete transferência que não existe |
| Público/privado | `visibilityChangeWarning` | OK | pergunta só no sentido destrutivo; erro da 2ª escrita à parte |
| Miniatura | `MAX_THUMBNAIL_DATAURL` | OK | teto de 256 kB, WebP, remoção explícita |
| Vídeo de prévia | `CATEGORIAS_COM_VIDEO` | OK | três no formulário mais o 360 por ação; basemap fora por decisão |
| Forma do 3D | `derivarForma3d` | OK | campo de primeira classe, não linha de JSON |
| Excluir item | `_deleteResource` | **QUEBRADO** | A6 |
| Listar 360 | `_render360Table` | OK | separa Status de Acesso, e diz por que |
| Público/privado 360 | `_toggle360Access` | OK | mesma confirmação assimétrica |
| Vídeo de prévia 360 | `_edit360Video` | OK | `null` é abandono, vazio é remoção, nas duas pontas |
| Excluir 360 | `_delete360` | ATRITO | único hard-delete de RECURSO DE CATÁLOGO, e a confirmação cala |
| Conceder acesso a privado | (não existe no painel) | **QUEBRADO** | A2 |

### 2.5 Aba Pessoal (`frontend/src/js/admin/personnel-tab.js`)

| ação | símbolo | veredito | observação |
|---|---|---|---|
| Listar postos | `SUBCATS` | ATRITO | sem status, sem busca; a coluna "Ordem" EXISTE |
| Criar / editar posto | `_renderForm` | ATRITO | M1: nada entra na trilha; `code` nunca é exposto |
| "Excluir" posto | `_delete` | **QUEBRADO** | A10: é desativação, e a linha continua na tela |
| Listar OMs | `SUBCATS` | ATRITO | idem, e o slug derivado não é mostrado |
| Criar OM | `slugify` | ATRITO | B2: slug imutável, invisível, e citado no 409 |
| Editar OM | `_renderForm` | ATRITO | só manda nome e sigla; `is_active` existe do schema ao SQL |
| "Excluir" OM | `_delete` | **QUEBRADO** | C1 |

### 2.6 Aba Auditoria (`frontend/src/js/admin/audit-tab.js`)

| ação | símbolo | veredito | observação |
|---|---|---|---|
| Ler a trilha | `_render` | OK | 7 dias de padrão, agrupamento por dia, `details` atrás de botão |
| Descobrir o escopo | `_administra` | OK | obedece ao servidor em vez de deduzir da sessão |
| Filtrar por período / ação / tipo | `acoesPorFamilia` | OK | `optgroup` por família |
| Filtrar por alvo exato | `_campo` | ATRITO | M11: só aceita id colado à mão |
| Filtrar por OM do acervo | `buildDomainOptions` | ATRITO | N2: preserva a OM desativada, e a mostra como UUID cru |
| Filtrar por ATOR | (não existe) | **QUEBRADO** | M2 |
| Ler o de-para | `linhasDoDePara` | OK | três regimes; cobre catálogo, 360 e usuários |
| Paginar | `_rodape` | OK | paginação real de servidor, a única do painel |
| Exportar | (não existe) | ATRITO | B6 |
| Aviso do backfill de OM | `_toolbar` | OK | ressalva antes da conclusão, não depois |

### 2.7 Fora do painel

| ação | símbolo | veredito | observação |
|---|---|---|---|
| Entrar na Administração | `adminAudience` | OK | rótulo idêntico nas quatro portas |
| Abrir a Calibração 360 | `mayCalibrate` | ATRITO | N3: é a única página que não resgata trabalho ao sair |
| Editar a própria conta | `showAccountSettingsModal` | ATRITO | um chamador só, e é o MAPA; ele vive em `admin.html` |
| Ver o próprio papel global | `globalRoleBadge` | OK | quatro sítios, nenhum dentro do painel |
| Trocar a própria senha | `validatePasswordForm` | OK | avisa que derruba esta sessão, ANTES do botão |
| Gerar a própria chave de API | `_rotateKey` | OK | melhor tela de segredo do produto |
| Conceder recurso privado | `showResourceShareModal` | ATRITO | A2: os cinco grupos têm porta, todas no mapa |
| Listar / revogar concessões | `listResourceGrants` | ATRITO | um chamador só; o painel não responde "quem enxerga isto" |
| Gerir atlas alheio | `LIST_USER_ATLAS` | **QUEBRADO** | A1 |
| Restaurar atlas alheio | `_trashCard` / `_restore` | **QUEBRADO** | A9 |
| Transferir posse alheia | `ownershipTransferWarning` | OK | resolvido nesta revisão; ver seção 6 |
| Ver o próprio nível em atlas alheio | `cardMenuActions` | ATRITO | M16: o cartão fica mais fechado que o servidor |
| Expurgar o log de operações | (não existe UI) | **QUEBRADO** | A7 |

### 2.8 Onde há gate proativo de tela, e onde não há

| superfície | gate proativo | efeito |
|---|---|---|
| abas do painel | `adminAudience` | recorte por papel global, correto |
| `calibracao.html` | `isAdmin() \|\| isProducer()` | correto, e o mesmo par em três sítios |
| campos de auto-edição | `isSelf` | espelha 409 e 403 do servidor |
| menu do cartão em `atlas.html` | `cardMenuActions` | por hierarquia, mas alimentado pelo posto CRU (M16) |
| botão "Tornar dono" | `serverTreatsAsAtlasOwner` | por hierarquia; inerte fora do mapa (M17) |
| botão de compartilhar recurso | `canShareResource` | correto, e só existe no mapa (A2) |
| **desativar OM** | **nenhum** | derruba a própria sessão (C1) |
| **"Excluir" em Pessoal** | **nenhum** | anuncia sucesso e nada muda na tela (A10) |
| **lixeira do sistema** | **nenhum** | restaura atlas alheio sem dizer de quem é (A9) |
| **expurgo do log de sync** | só no servidor | nenhuma tela chega lá (A7) |

---

## 3. Os achados que ficam

Reordenados por gravidade real. O número original vai entre parênteses.

### CRÍTICO

#### C1 (C1) "Excluir" uma OM expulsa da API todo mundo lotado nela, o administrador incluído, e não há volta pela interface

**Intacto, e a conferência o agravou em três pontos.**

**O que acontece hoje.** Cada linha de OM tem um botão vermelho "Excluir", com a confirmação genérica
`Excluir "<nome>" da lista?`. `PersonnelTab._delete` chama `apiClient.deleteOrganization`, que bate em
`DEACTIVATE_ORGANIZATION` (`backend/src/modules/organizations/organizations.queries.js`), um
`UPDATE organizations SET is_active = false`. O controller responde 204 e a tela mostra "Item
excluído.".

A partir daí, `LIVE_AUTH_STATE` (`backend/src/utils/org-status.js`) faz o join pela **lotação**
(`users.organization_id`) e devolve `org_is_active: false` para toda aquela gente. No middleware
`auth` (`backend/src/middleware/auth.js`) a ordem é: conta inativa (401), **OM inativa (403
"Organization is inactive")**, corte de sessão, e só então `req.user.role = live.role`. O gate de OM
precede até a ADOÇÃO do papel, e `requireAdmin` nunca roda.

**Os três agravantes que a auditoria não tinha.**

1. **Não é só 403 nas rotas: o login também cai.** `backend/src/modules/auth/auth.service.js` chama
   `orgIsActive` no login E no refresh, lançando "Organização inativa", preso por
   `backend/tests/integration/auth-org-gate.test.js`. Ele não perde só a sessão viva: não consegue
   reautenticar. O socket fecha pelo mesmo predicado, em `reconcileAuthorization`
   (`backend/src/modules/collab/collab.gateway.js`).
2. **A cascata NÃO é uniforme, e o buraco aponta para o outro lado.** `FIND_USER_BY_API_KEY`
   (`backend/src/modules/users/users.queries.js`) filtra `u.is_active` e **não** filtra a OM, e o
   ramo de chave de `flexibleAuth` (`backend/src/middleware/flexible-auth.js`) devolve `next()` sem
   consultar organização nenhuma. Numa rota só-flexível a chave continua valendo com a OM
   desativada. A 8.5 diz que desativar a OM mata a autoridade; por esta porta ela não mata.
3. **Não existe auto-guarda, e o padrão está na aba vizinha.** Nem
   `backend/src/modules/organizations/organizations.controller.js` nem o serviço leem
   `req.user.organization_id` para recusar ou sequer avisar, enquanto
   `frontend/src/js/admin/users-tab.js` tem "Mostrar inativos", selo Ativo/Inativo e botão
   "Reativar". A assimetria é do código, não do estatuto.

**E não há volta.** `updateOrganizationSchema` aceita `is_active`, `UPDATE_ORGANIZATION` o aplica por
`COALESCE`, o JSDoc do cliente o documenta, e a tela envia só nome e sigla: a string `is_active` não
aparece uma vez em `frontend/src/js/admin/personnel-tab.js`. A saída documentada é SQL no banco. Some-se
a cascata silenciosa da 8.5, por predicado: `fn_can_produce_resource` fecha a escrita de quem produzia
por aquela OM e `fn_principal_vivo` esconde as concessões originadas por ela, sem contagem nem aviso.

**Correção.** (a) Rótulo "Desativar" e toast "Organização desativada.". (b) Guarda dura espelhando a
de usuário, no cliente por `title` e no servidor por 409, porque a interface não é fronteira.
(c) Confirmação com os três números consultáveis: quantos estão lotados, quantos a têm como OM
produtora, quantos itens de catálogo ela mantém. (d) Coluna Status e botão Reativar, que a rota já
aceita. O buraco da chave de API é decisão do dono (seção 7).

#### C2 (C2) Desativar um usuário é o ato mais destrutivo do painel, é o que menos avisa e menos relata, e a reativação não desfaz o que ele destruiu

**Intacto, e a conferência achou a metade irreversível que faltava.**

**O que acontece hoje.** `UsersTab._deactivate` mostra uma linha (`Desativar o usuário "fulano"? Ele
não poderá mais entrar.`) e, no sucesso, `Usuário desativado.`. O valor devolvido pela chamada **não
é sequer atribuído a uma variável**, nas duas saídas (`_deactivate` e `_renderTransfer`).

O que o servidor executa em `deleteUser` (`backend/src/modules/users/users.service.js`), numa
transação só: transfere os atlas, apaga os shares do novo dono, faz o soft-delete, revoga toda a
família de refresh, carimba o corte de sessão, e chama `podarConcessoesDeQuemFoiDesativado` (origem
`USER_DELETE`), que revoga toda concessão originada por aquela pessoa com a subárvore. A resposta
carrega `atlasTransferred`, `grantsRevoked` e `grantsReparented`.

**O agravante novo: reativar não devolve nada disso.** `reactivateUser` é uma consulta mais uma linha
de trilha. As concessões podadas continuam com `revoked_at` gravado, as sessões continuam mortas, e a
única coisa que a reativação ressuscita sozinha é a chave de API (ver A3), justamente a que ninguém
pediu de volta. A destruição é irreversível pela interface e a tela a anuncia com três palavras.

**A contradição está dentro do mesmo arquivo.** A troca de papel, que poda MENOS, tem o fluxo
exemplar: `verdictOfChange` decide se pergunta, `producerScopeChangeWarning` avisa com
`live_grant_count`, `producerScopeChangeConfirmLabel` muda o rótulo do botão conforme a contagem, e
`producerScopeChangeSummary` relata os números. A desativação, superconjunto daquilo, não tem nada
disso: uma varredura pelos nomes dos campos da resposta em `frontend/src/` devolve só
`frontend/src/js/admin/audit-phrases.js`, ou seja, os números só são legíveis depois, na Auditoria.

**Correção.** Um irmão de `frontend/src/js/admin/producer-scope-phrases.js` para a desativação, com a
mesma forma: aviso antes com `user.live_grant_count` (que a listagem **já traz**, por
`LIVE_GRANTS_BY_GRANTER_AGG`), mais a frase da cascata que não tem número, mais a menção aos grupos
de que a pessoa é dona; toast depois compondo os três números; e uma frase em `_reactivate` dizendo o
que a reativação NÃO devolve. Nenhuma rota nova: os dados já viajam nos dois sentidos.

### ALTO

#### A1 (A1) Ele tem posse em todo atlas, não consegue LISTAR nenhum atlas alheio, e lista a lixeira inteira

Intacto. `listUserAtlas` não recebe sequer um parâmetro `isAdmin`, e o controller o chama liso.
`LIST_ALL_DELETED_ATLAS` não tem predicado de dono nenhum, e `RESTORE_ATLAS_ADMIN` larga o escopo de
`RESTORE_ATLAS`. A 5.5 é vigente e `requireAtlasPermission` a implementa, mas **não há como nomear** o
atlas: a posse universal só se exerce por link colado, o que na prática significa pedir a URL ao
dono. `listAtlasOverview` e `listAtlasPresence` também são por usuário. O comentário acima de
`LIST_ALL_DELETED_ATLAS` aponta `LIST_USER_ATLAS` como o erro a não repetir, e `LIST_USER_ATLAS`
nunca foi mudada.

**Correção.** Não transformar a lista padrão em lista de tudo, o que empurraria a tela cotidiana dele
para dentro do acervo alheio, e sim um recorte explícito na linha do que a lixeira já faz: consulta
separada sob um controle nomeado, com o dono na linha, e `isAdmin` descendo por `listUserAtlas` como
já desce por `listDeletedUserAtlas`.

#### A2 (A2) Privatizar um recurso está no painel e conceder acesso a ele não está em lugar nenhum do painel

Intacto no diagnóstico. **A estimativa de custo da auditoria estava desatualizada e foi refeita nesta
revisão, com medição.**

**O que acontece hoje.** A aba Catálogo marca um item como Privado e avisa corretamente do efeito. A
concessão mora em `showResourceShareModal` (`frontend/src/js/catalog/resource-share.modal.js`),
aberto por exatamente dois sítios, ambos do mapa: `CatalogModal._handleShare`, alimentado pelo botão
que `createCatalogCard` (`frontend/src/js/catalog/components/catalog-card.js`) instala, e
`BaseLayerSelectorControl` (`frontend/src/js/base-layer-selector/base-layer-selector.control.js`).
`apiClient.listResourceGrants` tem UM chamador, aquele modal.

**Nenhum tipo concedível fica órfão**, e vale dizer para não exagerar o achado: quatro grupos saem por
`RESOURCE_ACCESS_BY_CATALOG_TYPE` (`frontend/src/js/catalog/catalog.constants.js`) e o quinto, o
basemap, tem porta no seletor de camada base porque não tem cartão. O problema não é cobertura, é
**localização**: privatiza no painel, sai do painel, entra no mapa, acha o item de novo, e só então
compartilha. Pior, "quem enxerga isto hoje" não tem resposta na tela onde a privacidade foi decidida.

**A cirurgia equivalente JÁ FOI FEITA no modal irmão, e o custo aqui é uma linha.** O modal de
compartilhamento de atlas foi partido em `frontend/src/js/modals/sharing.modal.core.js` (REST mais
DOM, que cabe em `atlas.html`) e `frontend/src/js/modals/sharing.modal.js` (a metade viva, com
presença injetada), preso por `frontend/tests/unit/compartilhar-sem-a-store.test.js`, que caminha o
grafo de imports estático E dinâmico, prende sete módulos proibidos, ancora em seis obrigatórios,
mede piso e teto, e traz controle negativo na metade pesada. Medindo
`frontend/src/js/catalog/resource-share.modal.js` com o mesmo caminhador: ele alcança **178 módulos**
e cinco dos sete proibidos, e **todo caminho proibido passa por UMA aresta**, `syncEngine`, com **um
único uso no arquivo** (`refreshVisibleResources(syncEngine.atlasId ?? null)`). Cortada essa aresta, o
grafo cai para **22 módulos** e zero proibidos, na mesma ordem dos 16 do modal irmão.

**Correção.** (a) Barata e imediata: uma coluna somente de leitura na tabela de catálogo com a
contagem de concessões vivas do item, no feitio de `live_grant_count`, que responde "quem enxerga
isto" sem carregar modal nenhum. (b) O botão "Compartilhar" no painel, injetando o id do atlas em vez
de ler `syncEngine.atlasId` (a mesma forma que `presence` e `readOnly` já têm no modal irmão), e
clonando o guarda estrutural com piso e teto próprios.

#### A3 (A3) A única revogação de uma chave de API comprometida de outra pessoa não tem interface, e a reativação ressuscita a chave

Intacto. A 10.7 declara que a chave resolve para a linha inteira de `users`, carrega o papel global,
não tem escopo nem prazo, e que **a única revogação é rotacioná-la**. A rota existe e é de
administrador; o cliente já a expõe em `apiClient.rotateUserApiKey`
(`frontend/src/js/store/sync/api-client.js`); **zero chamadores em `frontend/src/`**, e
`frontend/src/js/admin/` não tem uma ocorrência de chave de API. A rotação da PRÓPRIA chave, por
contraste, está ligada em `frontend/src/js/modals/account-settings.modal.js`: só a metade
administrativa ficou morta, e é justamente a que serve para quem não consegue mais entrar.

Some-se: `SOFT_DELETE_USER` só mexe em `is_active`, e `FIND_USER_BY_API_KEY` filtra por `is_active`.
Desativar SUSPENDE a chave; reativar a RESSUSCITA, com o mesmo valor secreto, e `UsersTab._reactivate`
é um `try` de duas linhas, sem confirmação. De tudo que a desativação derrubou, a única coisa que a
reativação devolve sozinha é exatamente a que ninguém quer de volta.

**Correção.** Ação "Chave de API" na linha do usuário, com confirmação que diga o que a 10.7 diz e, no
sucesso, a revelação de uso único que a tela de conta já implementa. Mais uma frase em `_reactivate`
avisando que a chave anterior volta a valer.

#### A4 (A4) O formulário de catálogo afirma que transferir um recurso entre OMs é ato de administrador, e não existe rota nenhuma que faça isso

Intacto, com o texto conferido palavra a palavra. O `hint` da edição diz: *"A OM dona é definida na
criação e não muda por esta tela. Transferir um recurso entre OMs é ato de administrador, fora do
painel."*

Do outro lado, `CAMPOS_EDITAVEIS` é `['name', 'description', 'config', 'sort_order']`;
`updateCatalogItem` (`backend/src/modules/catalog/catalog.service.js`) escreve esses quatro mais
`updated_at`, e `owner_org_id` aparece só no `RETURNING`; `createCatalogItem` carimba a coluna a
partir de `req.catalogActor`, nunca do corpo, e a UPDATE de ressurreição a exclui de propósito. Uma
varredura por escrita de `owner_org_id` em `backend/src/` não acha rota nenhuma. Se um produtor criou
o item na OM errada, ou se a OM foi desativada, o item fica encalhado.

**Por que continua alto.** É a forma mais cara de texto errado: uma afirmação confiante que manda o
leitor procurar em outro lugar um caminho que não existe, e o leitor típico é um agente ou um
administrador novo. As duas saídas honestas estão na seção 7; o meio-termo atual não pode continuar.

#### A5 (A5) Atlas na lixeira não contam na desativação, então a conta cai sem uma pergunta e os atlas ficam com dono morto

Intacto, conferido nas duas consultas: `COUNT_USER_ATLAS` e `TRANSFER_ATLAS_OWNERSHIP`
(`backend/src/modules/users/users.queries.js`) filtram os dois por `deleted_at IS NULL`, e
`deleteUser` só entra no ramo de conflito quando a contagem é maior que zero. Uma conta cujos atlas
estejam todos na lixeira devolve zero: o 409 não dispara, a tela de transferência não aparece, e os
atlas ficam com `owner_id` apontando para uma conta que o middleware `auth` passou a recusar.

Pelas cláusulas 6.2 e 8.5, um atlas cujo dono perdeu acesso deixa de emprestar os recursos privados
dele. Restaurar aquele atlas depois devolve um atlas mutilado, e nada no caminho avisou. É o estado
órfão que o próprio 409 existe para impedir, alcançado pela porta da lixeira.

**Correção.** Contar também os apagados, num número separado, e dizê-lo na confirmação de C2: "Esta
pessoa é dona de N atlas ativos e M na lixeira. Os da lixeira não são transferidos." Levar os
apagados junto é uma linha no `WHERE`, mas é decisão de produto (seção 7).

#### A6 (A6) Excluir um item de catálogo não consulta referência nenhuma, não relata nada e não tem volta pela interface

Intacto. `CatalogTab._deleteResource` pergunta `Excluir "<nome>" do catálogo?` como TÍTULO, sem corpo
de mensagem. `deleteCatalogItem` é um `UPDATE ... SET active = false` e o controller responde 204 sem
corpo. Nada consulta `atlas_resources`, `catalog_layers` ou o registro de referências
(`backend/src/modules/atlas/resource-reference.registry.js`). `purgeResourceLinks`
(`backend/src/modules/resource-access/resource-access.service.js`) tem UM chamador de produção, e é o
hard-delete do 360.

Segundo [`.claude/rules/architecture.md`](.claude/rules/architecture.md), um id de recurso vive em
várias superfícies de `atlas.settings`, e **cinco delas são allowlist**, onde a lista vazia significa
"sem restrição". Um item removido deixa referências penduradas em briefings, camadas e configurações
de atlas, e o administrador não recebe nem um número. Não existe rota de reativação: o desfazer é
recriar o item com o mesmo id, o que `createCatalogItem` aceita e ressuscita a linha, mas nada na
tela diz isso.

**Correção da AFIRMAÇÃO, junto com a do achado.** A auditoria chamou `_delete360` de "o único
hard-delete do sistema", e isso é largo demais: `DELETE_IMAGE`
(`backend/src/modules/images/images.queries.js`) apaga linha e arquivo de uma entidade de atlas, e o
expurgo do log de operações (A7) apaga linhas de `operations`. A forma verdadeira é "o único
hard-delete de RECURSO DE CATÁLOGO". Quanto ao achado: antes de confirmar, a contagem de atlas que
referenciam o id, pelo mesmo registro que já enumera as superfícies; no sucesso, um toast com o verbo
certo ("desativado") mencionando que recriar com o mesmo id restaura.

#### A7 (NOVO) O expurgo do log de operações é destrutivo, é de administrador, não escreve trilha e não tem tela nenhuma

**Achado novo desta revisão, nascido de enumerar as rotas de administrador e cruzá-las com o
cliente.** As rotas gateadas por `requireAdmin` são dezenove, em cinco módulos. Três não têm chamador
nenhum no cliente; a auditoria reportava duas (A3 e B4). A terceira é esta, e não aparecia uma vez no
documento.

**O que existe.** `backend/src/modules/sync/sync.routes.js` monta, sob `/atlas/:atlasId/sync`, duas
rotas de administrador: `getCleanupStats` e `cleanupOperations`. A segunda chama
`cleanupOldOperations` (`backend/src/modules/sync/sync.service.js`), que executa
`DELETE_OLD_OPERATIONS` e depois `UPDATE_ATLAS_MIN_VERSION`: apagamento de verdade, não soft-delete.

**Três coisas que se somam.**

1. **Zero superfície no cliente.** Não existe método em `frontend/src/js/store/sync/api-client.js`
   para nenhuma das duas, e a string `sync/admin` não aparece em `frontend/src/`. Ele não consegue
   nem LER quantas operações um atlas acumulou, que é a pergunta anterior a qualquer expurgo.
2. **Zero trilha, e isso já está reconhecido por escrito.** `createAudit` tem contagem zero no
   controller e no serviço de sync, e o censo `backend/tests/unit/auditoria-censo.test.js` classifica
   a rota de expurgo como buraco conhecido, com o motivo mais forte da lista: ela "apaga justamente o
   log que serve de trilha para todo o conteúdo de atlas" e é "a lacuna mais incômoda desta lista,
   porque destrói a trilha alternativa que isenta cinco outras rotas aqui". O censo tem TETO de
   quatro buracos, e ele aperta a cada um fechado.
3. **O parâmetro perigoso já mordeu uma vez.** O comentário de `cleanupOperations` registra que pedir
   "preserve tudo a partir da versão zero" caía como falsy e virava um expurgo de sete dias, com 200
   e sem sinal. Foi consertado; sobrou uma rota destrutiva sem tela e sem rastro.

**Por que é ALTO.** É a mesma classe de A3, com o efeito invertido: lá falta o instrumento de defesa,
aqui falta o freio de um instrumento de destruição. E a 9.1 diz "toda a trilha" enquanto a rota que
APAGA trilha não escreve nenhuma.

**Correção.** Decidir primeiro se a rota deve ter tela. Se sim: leitura das estatísticas antes de
tudo, confirmação com a contagem que elas devolvem, e uma ação nova no vocabulário do CHECK de
`action`. Se não: fechar a rota, porque buraco sem beneficiário é dívida pura.

#### A8 (A8, PARCIAL) Aprovar uma conta pendente é o desbloqueio da cláusula 10.6, está escondido, e é feito às cegas

**A única metade que o lote mexeu, e ele mexeu do lado errado do fio.**

**Resolvido:** `updateUserAdminSchema` (`backend/src/modules/users/users.schemas.js`) passou a
aceitar `email`, com comentário datado citando a 10.6, e `resolveAdminEmail`
(`backend/src/modules/users/users.service.js`) implementa a regra que o Joi não expressa: endereço
diferente derruba a confirmação, salvo se o mesmo pedido disser o contrário. `updateUser` confere
unicidade por `CHECK_EMAIL_EXISTS_EXCLUDING` e responde 409 com o motivo; `UPDATE_USER_ADMIN` ganhou
o par valor/bandeira.

**BAIXA contra `59e9600c`: a metade do payload FECHOU.** O formulário de edição ganhou o campo
"E-mail" (só na edição, porque `POST /users` não tem o campo e a conta que ele cria entra logando
na hora) e o payload só o envia quando o valor MUDOU, senão salvar o posto derrubaria a confirmação
de uma conta que ninguém quis mexer. O administrador já consegue ler e corrigir o endereço que
aprova, que era o núcleo do achado.

**Fica a metade da LISTAGEM, e ela é menor:** o selo "Pendente" continua sem o endereço no `title`,
não há coluna de e-mail, e aprovar continua exigindo Editar, rolar até o fim e marcar uma caixa, sem
ação de linha. O texto original da parte aberta segue abaixo, para registro.

**Texto original.** O payload de
`frontend/src/js/admin/users-tab.js` é nome, usuário, posto, lotação, papel e OM produtora, mais
`is_active` e `email_verified` quando cabem, e `email` nunca é enviado; o cabeçalho da tabela é
`['Usuário', 'Papel', 'Lotação', 'OM produtora', 'Status', '']`, e `u.email` é lido uma vez, como
predicado, só para pendurar o selo "Pendente", de modo que o endereço nunca chega ao DOM, nem em
coluna nem em `title`. O administrador aprova um endereço que não consegue ler, que é literalmente o
que o achado apontava. E não há ação de linha: aprovar exige Editar, rolar até o fim e marcar uma
caixa que só é montada quando a conta já tem endereço.

**Correção.** Um campo de texto e uma linha no payload fecham as duas primeiras metades de uma vez.
Mais um botão "Aprovar" na linha pendente, com o endereço na confirmação, e o endereço no `title` do
selo.

#### A9 (A9, PARTIDO) A lixeira do sistema não diz de quem é o atlas, e restaura o alheio com um clique, sem confirmação

**Partido em dois:** este, sobre a lixeira, é ALTO porque é ato sobre trabalho alheio; a metade sobre
o papel não ser nomeado em tela nenhuma virou M3, porque é modelo mental e não ato.

**O que acontece hoje.** `AtlasDrive._trashCard` (`frontend/src/js/projects/atlas-drive.js`) desenha
miniatura, nome, uma linha de tempo e o botão Restaurar. Não toca no nome do dono, embora
`LIST_ALL_DELETED_ATLAS` o traga e o comentário do próprio SQL diga que ele existe para "tornar o
atlas de outro usuário identificável na lista". `AtlasDrive._restore` chama a API direto, sem
confirmação, e mostra "Atlas restaurado.". Ele abre a aba Lixeira, vê a lixeira do sistema inteiro
com cartões indistinguíveis dos dele, e restaura qualquer um com um clique.

**A correção que a auditoria propunha estava ERRADA, e a conferência a refez.** A proposta era reusar
`AtlasDrive._subtitle` no cartão da lixeira. Ele decide a autoria assim:

```js
const author = project?.user_permission === 'owner' ? 'Você' : (project?.owner_nome ?? '').trim();
```

Nos cartões VIVOS isso funciona, porque `LIST_USER_ATLAS` projeta `user_permission` por linha
(`CASE WHEN a.owner_id = $1 THEN 'owner' ELSE us.permission END`) e um atlas compartilhado sai com o
posto real e o dono real. Nas duas consultas de LIXEIRA, porém, `user_permission` é o literal
`'owner'` para TODA linha, em `LIST_DELETED_USER_ATLAS` e em `LIST_ALL_DELETED_ATLAS`. Reusar
`_subtitle` ali faria **todo cartão da lixeira dizer "por Você"**, inclusive os atlas de terceiros
desativados: a mesma classe de defeito que a bifurcação de "Tornar dono" acabou de fechar do outro
lado.

**Correção certa.** Ler o nome do dono diretamente no cartão da lixeira, ou comparar `owner_id` com
`sessionContext.userId`, e não `user_permission`. Mais uma confirmação em `_restore` quando o atlas
não é do observador. (Alternativa de fundo: parar de projetar o literal nas duas consultas de
lixeira, o que conserta a fonte e não o consumidor.)

#### A10 (C3) "Excluir" nas duas listas de Pessoal anuncia sucesso e a linha continua na tela, idêntica

**Rebaixado de CRÍTICO para ALTO.** A justificativa é de gravidade real: sozinho, este achado não
destrói nada, não é irreversível e não vaza acesso. O pior que ele faz é convencer o operador de que
o clique não pegou. O peso sistêmico que a auditoria lhe atribuía é de C1, e mantê-lo em crítico
contava a mesma consequência duas vezes.

**Intacto.** `DEACTIVATE_RANK` e `DEACTIVATE_ORGANIZATION` são os dois `SET is_active = false`;
`LIST_RANKS` e `LIST_ORGANIZATIONS` não filtram `is_active`; `PersonnelTab._renderTable` monta as
células só a partir de `SUBCATS`, e nenhuma das duas entradas inclui status. O toast é "Item
excluído.". A conclusão natural é que a exclusão falhou, então o operador clica de novo, e sob C1
isso significa repetir um ato de alcance sistêmico achando que nenhum deles pegou.

**Nuance que a auditoria não tinha:** o efeito É real, só invisível NESTA tela. `deactivateRank` e
`deactivateOrganization` chamam `invalidateAppConfigCache`, e `listPostos` e
`listOrganizacoesMilitares` (`backend/src/modules/config/config.service.js`) filtram
`is_active = true`. O item some dos `<select>` de cadastro e continua na tabela do administrador,
idêntico: as duas telas discordam sobre o mesmo fato.

**Correção.** Coluna Status com o par de selos da aba Usuários, rótulo "Desativar"/"Reativar"
conforme a linha, toast com o verbo certo, e filtro "Mostrar inativos". Nenhuma rota nova: os dois
PUT já aceitam `is_active`, do schema ao SQL.

### MÉDIO

**M1 (A7, PARTIDO) O CRUD de postos não escreve trilha nenhuma.**
`backend/src/modules/ranks/ranks.controller.js` e o serviço ao lado têm contagem zero de
`createAudit`, enquanto o módulo de organizações emite `ORG_CREATE`, `ORG_UPDATE` e `ORG_DELETE`. A
lista controlada de postos alimenta os `<select>` de cadastro de toda a base, e uma renumeração de
hierarquia militar não deixa rastro. **Fica em MÉDIO e não em ALTO por uma razão que a auditoria não
tinha:** as três rotas estão DECLARADAS como buraco conhecido em
`backend/tests/unit/auditoria-censo.test.js`, com motivo escrito e dentro de um teto que aperta. Não
é esquecimento silencioso, é dívida registrada, e fechá-la exige vocabulário novo no CHECK de
`action`.

**M2 (A7, PARTIDO) A trilha não responde "o que fulano fez".** `GET /audit` aceita `actorId`
(`listAuditSchema`, `backend/src/modules/audit/audit.schemas.js`) e o serviço o repassa como filtro; o
estado de filtros de `AuditTab.mount` não o tem. A ausência é declarada em comentário, com o motivo
(resolver nome em UUID exigiria busca de usuários, e a aba serve também ao produtor). O motivo não se
sustenta para o administrador: ele **já tem** um filtro que só ele vê, o de OM do acervo, gateado por
`_administra`, e o mesmo gate serviria a um campo de ator com a busca debounced que Usuários e Grupos
já usam.

**M3 (A9, PARTIDO) Nada na interface diz que ele está alcançando algo POR SER administrador.** Fora de
`frontend/src/js/admin/`, não existe rótulo, selo ou aviso dizendo a alguém que ele alcança um atlas,
um recurso ou um grupo por causa do papel global. As duas únicas menções em texto visível o citam na
TERCEIRA pessoa, em `frontend/src/js/catalog/visibility-phrases.js` e em
`frontend/src/js/catalog/resource-share.modal.js`. *Correção*: um selo discreto do tipo "por
administração" nas linhas alcançadas por papel global e não por posse ou share; o predicado já existe
(`sessionContext.isAdmin()`) e o vocabulário também (`GLOBAL_ROLE_LABELS`).

**M4 (M1) A aba Grupos chama de "Meus grupos" a lista de todos os grupos do sistema.** `LIST_GROUPS`
filtra por `fn_can_administer_group`, cujo corpo termina no ramo curinga `fn_is_global_admin`, então o
administrador recebe todo grupo vivo, sem filtro e sem paginador. A coluna "Dono" existe justamente
porque ele vê grupo alheio, e o comentário do código diz isso, mas o título não. *Correção*: título
condicional a `sessionContext.isAdmin()` mais um campo de busca.

**M5 (M2) A aba Sistema não recarrega depois de salvar.** `ConfigTab._render` lê a config uma vez e a
entrega a `_buildForm`; `onSave` fecha sobre esse valor e nunca o relê, e no sucesso não chama
`this._render()`, enquanto `clearBtn` chama. Depois de salvar um valor, digitar o original no mesmo
ciclo não produz entrada no payload: ou sai "Nenhuma alteração a salvar.", ou sai "Configurações
salvas." com o override anterior intacto. *Correção*: chamar `this._render()` no sucesso.

**M6 (M3) Criar ou editar OM ou posto não atualiza os seletores das outras abas até um F5.**
`orgLabel` e `buildDomainOptions` (`frontend/src/js/admin/org-options.js`) leem
`config.organizacoesMilitares` e `config.postos`, hidratados uma vez por `applyRuntimeConfig`
(`frontend/src/js/store/sync/runtime-config.js`), cujos chamadores são **exatamente quatro**, um por
entry de página. O servidor invalida o memo a cada escrita, então o descompasso é do singleton do
cliente. O fluxo que quebra é o óbvio: criar a OM em Pessoal, ir a Usuários promover alguém a Produtor
dela, e não achá-la no `<select>`.

**M7 (M4) A exclusão de grupo não pode dizer quantas concessões foram preservadas, e a de usuário
pode.** `deleteGroup` e `removeMember` (`backend/src/modules/access-groups/access-groups.service.js`)
devolvem `grantsAffected` e `atlasShares`; `grantsReparented` existe nos dois e só dentro do `details`
da trilha. Como `producerScopeChangeSummary` diz "Mantidas por outro caminho: N", o administrador
aprende a esperar esse número e não o recebe onde ele mais assusta.

**M8 (M5) Falha de carregamento é beco sem saída nas seis abas.** O padrão é sempre o mesmo: um
parágrafo "Falha ao carregar…", um toast e nenhum botão (Grupos tem três ocorrências, Catálogo duas).
Em Auditoria e Catálogo a barra de filtros sobrevive, o que ajuda sem ser re-tentativa; em Sistema e
Pessoal não sobra nada acionável. **A auditoria dizia que o modal de recurso era "o único lugar do
produto" que faz isso direito, e isso está errado**: há afordância de re-tentativa também em
`frontend/src/js/modals/sharing.modal.core.js`, `frontend/src/js/modals/account-settings.modal.js`,
`frontend/src/js/ui/unavailable-screen.js` (que a própria página do admin usa no boot) e em
`RETRY_ACTION_LABEL` (`frontend/src/js/terrain/data-layer-phrases.js`). O padrão existe em cinco
lugares e não chegou a nenhuma aba.

**M9 (M6) Só uma lista do painel tem busca sobre si mesma, e só uma pagina.** Auditoria tem paginação
real de servidor, e Usuários tem busca local sobre o array já baixado. Grupos, Catálogo e Pessoal não
têm nem uma coisa nem outra; as buscas de Grupos e da transferência de Usuários são seletores de
pessoas, não filtros de lista. (A auditoria abria dizendo "nenhuma lista pagina" e fechava dizendo
que Auditoria pagina: a frase contradizia a própria alínea seguinte.)

**M10 (M7) Quatro campos chegam na listagem de usuários e não têm leitor.** `LIST_ALL_USERS` e
`LIST_ACTIVE_USERS` selecionam e-mail, confirmação, data de criação e último acesso, e a tabela não
mostra nenhum, salvo o predicado do selo pendente. O último acesso responde "esta conta ainda é
usada", que é a pergunta anterior a qualquer limpeza de base.

**M11 (M8) O alvo de uma linha de auditoria não é clicável.** `_linha` põe o id do alvo só no `title`
da frase, com a justificativa correta (slug e UUID poluem a linha). Mas o filtro "Alvo (id exato)"
existe logo acima, e a única forma de usá-lo é passar o mouse, ler um UUID e digitá-lo. *Correção*:
clique na frase que preenche o filtro; o estado e o campo já existem.

**M12 (M9) `frontend/src/css/admin.css` não tem uma única media query.** Conferido: **1019 linhas,
zero `@media`**, num produto que mantém um chunk `phone-ui` para o mapa. **Ressalva que estreita o
achado:** o manifesto `frontend/src/css/admin-page.css` traz também
`frontend/src/css/modals-redesign.css` (oito media queries) e
`frontend/src/css/account-settings.css` (duas), e `frontend/src/css/app-bar.css` tem duas. Os modais
e a barra respondem; o corpo do painel, uma grade fixa de trilho lateral mais tabelas largas, não.

**M13 (M10) "Manter como está" na privatização não cancela o salvamento.** Recusar a confirmação roda
só a devolução do `<select>` ao valor de partida e segue para o payload: nome, descrição, ordem,
miniatura, vídeo, forma 3D e JSON são gravados normalmente. A escolha é deliberada e está justificada
em comentário (abortar tudo descartaria em silêncio a edição do resto), mas o par de rótulos não
transmite isso. *Correção*: "Salvar sem tornar privado" no botão de recuo.

**M14 (M11) Desativar uma OM não é auditado dentro da transação, e `ORG_DELETE` não grava
`targetName`.** As três chamadas de `createAudit` em
`backend/src/modules/organizations/organizations.controller.js` passam dois argumentos, sem a
transação, e o serviço nem a abre, embora a assinatura suporte o terceiro argumento
(`backend/src/utils/audit.js`) e o resto do sistema o use. E `ORG_DELETE` guarda só o UUID: a linha é
escrita DEPOIS do UPDATE e o controller não lê a org antes, então a trilha do ato de C1 não diz nem
qual OM caiu.

**M15 (M12) A poda por desativação e por rebaixamento não acorda ninguém ao vivo.**
`avisarAtlasQueEmprestam` (`backend/src/modules/resource-access/resource-access.controller.js`) tem
UM chamador, a revogação deliberada. Quem perdeu acesso por `USER_DELETE`, `USER_DEMOTION`,
`ACCESS_GROUP_DELETE` ou `ACCESS_GROUP_MEMBER_REMOVE` descobre no próximo carregamento, e enquanto
isso a camada continua desenhada com a URL antiga. É limite conhecido (cláusula 10.3), documentado no
JSDoc da própria função, mas nenhuma tela de administração o menciona no momento da poda.

**M16 (M13) Num atlas alheio compartilhado com ele, o cliente é MAIS fechado que o servidor.**
`LIST_USER_ATLAS` projeta `user_permission` como o posto CRU do servidor, sem o dobramento de
`toFrontendRole` e sem ramo de administrador, ao contrário de `LIST_ALL_DELETED_ATLAS`, que força
`'owner'`. Um administrador com share de leitura recebe o chip "Leitura", e `cardMenuActions` esconde
renomear, capa, acesso e lixeira, embora `requireAtlasPermission` fosse resolvê-lo como dono.
**Efeito de segunda ordem que a auditoria não tinha:** pelo mesmo motivo ele recebe "Sair do atlas",
que `serverTreatsAsAtlasOwner` existe para esconder de quem o servidor trata como dono, e o servidor
responde 409. Direção segura do erro nas quatro primeiras ações, INSEGURA na quinta.

**M17 (M14) "Tornar dono" nunca aparece quando o modal de compartilhamento é aberto de
`atlas.html`.** O botão lê `sessionContext.role`, e `sessionUserInfoFromMe`
(`frontend/src/js/store/sync/session-context.js`) fixa o papel de visualizador por decisão
documentada; o papel por atlas só é escrito por `frontend/src/js/store/sync/sync-engine.js`, na
elevação ao chegar o snapshot e no payload de conexão do WebSocket, que a página do seletor não abre.
Então nem o dono real nem o administrador transferem posse dali, e ele é quem mais opera por aquela
página. *Correção*: resolver o papel a partir do `user_permission` que a listagem já traz.

### BAIXO

**B1 (B1)** Catálogo e Pessoal montam o estado vazio com um parágrafo cru, onde Usuários, Grupos e
Auditoria usam `emptyState()` (`frontend/src/js/admin/admin-dom.js`), então essas duas abas não têm a
dica de "o que fazer agora" que as outras quatro têm.

**B2 (B2)** `slugify` deriva o slug da OM sem mostrá-lo, e o slug é imutável em três camadas (o
schema não o declara, o UPDATE não o toca, o cliente não o envia). A colisão vira 409 com uma
mensagem que **nomeia um campo que o operador não pode ver nem editar**. Vale exibi-lo, somente
leitura, antes de gravar.

**B3 (B3)** A confirmação de "Limpar todos os overrides" é uma string fixa, sem contagem de chaves,
embora o documento inteiro esteja carregado no textarea ao lado. O servidor até registra o número na
trilha, depois do fato.

**B4 (B4)** `apiClient.getUser` não tem chamador; a tela de edição opera sempre sobre a linha da
listagem, que pode ter envelhecido. É o mesmo problema que `_reachForWarning` resolveu na aba Grupos,
e é a segunda das três rotas de administrador órfãs (a terceira é A7).

**B5 (B5, CORRIGIDO NA ORIGEM)** A tabela de postos não expõe `code`, embora a coluna exista no banco,
seja selecionada por `LIST_RANKS` e escrita por `INSERT_RANK`: um posto criado pela aba nasce sem
código. **A segunda metade do achado original está RETIRADA por estar errada:** a coluna de ordem
EXISTE na tabela, e já existia quando a auditoria foi escrita.

**B6 (B6)** A aba Auditoria não exporta. Uma trilha que se lê para escrever relatório acaba sendo
copiada à mão; um CSV do recorte atual resolveria, e o `title` da hora já existe justamente "para
citar num relatório".

---

## 4. Achados NOVOS

Quatro coisas que não constavam da auditoria. A primeira é grave o bastante para viver na seção 3,
como A7; as três abaixo são menores.

**N1. O expurgo do log de operações: ver A7.** Nasceu de enumerar as dezenove rotas de `requireAdmin`
e cruzá-las com o cliente. Três não têm chamador; a auditoria reportava duas.

**N2 (MÉDIO). O filtro de OM da auditoria preserva a OM desativada e a mostra como UUID cru.**
`buildDomainOptions` (`frontend/src/js/admin/org-options.js`) de fato preserva o id corrente
rotulando "(atual)", que é a decisão certa e é o que a seção 5 elogia. Mas
`frontend/src/js/admin/audit-tab.js` não passa o rótulo, então a opção sai como o UUID seguido de
"(atual)". O filtro continua endereçável e deixou de ser legível, que era metade do ponto.

**N3 (MÉDIO) [RESOLVIDO em `59e9600c`]. `calibracao.html` é a única página que não resgata trabalho ao
encerrar sessão, e ela é gateada por `isAdmin()` ou `isProducer()`.** **BAIXA:** o `endSession` de
`frontend/src/js/calibration/calibracao-page.js` passou a chamar
`preserveUnsyncedWorkOnLostSession()` ANTES do logout e a carimbar o desfecho na URL do mapa
(`?sessao=`, `?trabalho=`, `?pendentes=`), como as outras três. O censo que cobra isso
(`frontend/tests/unit/fim-de-sessao-resgata-censo.test.js`) é derivado de `git ls-files`, não lista
escrita à mão, então a quarta página não pode ficar para trás de novo em silêncio. O texto original
segue abaixo, para registro.

**Texto original.** O lote fechou metade:
`frontend/src/js/calibration/calibracao-page.js` passou a usar `classifyRequestFailure` e só apaga a
credencial em `RequestFailure.CREDENTIAL`, e o guarda que protege isso
(`frontend/tests/unit/falha-de-requisicao-nao-apaga-credencial.test.js`) deixou de ser lista escrita à
mão e passou a varrer por `git ls-files`. A outra metade continua aberta: o `endSession` daquele
arquivo é logout, limpeza de sessão e navegação, sem contar fila, sem
`preserveUnsyncedWorkOnLostSession` e sem carimbar o desfecho, enquanto `frontend/src/js/index.js`,
`frontend/src/js/projects/projects-page.js` e `frontend/src/js/admin/admin-page.js` fazem os três. O
relatório do usuário comum registrou isso como remissão fora do escopo dele; **é escopo deste
documento e do relatório do produtor.**

**N4 (BAIXO). O administrador continua sem linha própria no modal de compartilhamento.** A frase da
transferência foi bifurcada (seção 6), mas a segunda metade da correção proposta não foi feita:
`_renderOwnerItem`, `_renderMemberItem` e `_renderParticipantItem`
(`frontend/src/js/modals/sharing.modal.core.js`) desenham nome e usuário sem marca de "você", e um
administrador sem share não aparece na lista de jeito nenhum. Ele age sobre uma tela em que não
existe, e a frase nova, ao dizer que o acesso dele vem do papel e não da posse, torna a linha
faltante mais visível.

---

## 5. O que está BOM e não deve ser mexido

Cada item é uma decisão que custou caro e que uma "simplificação" futura desfaria. Os dez foram
reconferidos contra o código nesta revisão. Dois mudaram de entorno e um perdeu uma alínea.

1. **`frontend/src/js/admin/admin-audience.js` como definição única das quatro audiências.** Função
   pura, zero imports, consumida em quatro sítios. O rótulo nomeia o que a pessoa recebe, nunca a
   página, e é por isso que o produtor não lê "Administração" numa tela de três abas. Não
   reintroduza uma quinta cópia.

2. **O fluxo destrutivo de papel e OM produtora, em
   `frontend/src/js/admin/producer-scope-phrases.js`.** O padrão de referência do produto: veredito
   puro que decide SE pergunta, aviso antes com o número que a listagem já sabe, rótulo do botão que
   muda com a contagem (para não fazer ameaça falsa quando não há nada a revogar), e toast depois com
   o número que o servidor mediu. C2, A6 e M7 pedem que este padrão seja copiado, não mudado.

3. **A aba Grupos inteira.** As duas seções respondem perguntas diferentes, e a segunda existe porque
   um mecanismo que decide o acesso da pessoa não pode ser invisível para ela. `_reachForWarning`
   relê os números antes de avisar e **diz** quando não conseguiu reler; `_leave` pula a releitura de
   propósito, porque o aviso dele não cita número. As duas chamadas vão por `Promise.allSettled`, e
   `leaveGroupAvailability` falha FECHADO nos dois casos em que o servidor recusaria.

4. **A aba Auditoria.** O padrão de 7 dias, o agrupamento por dia (com chave de dia LOCAL, não UTC),
   o `details` atrás de botão e a paginação real são o que separa aquela tela de um log. Ela obedece
   ao `administra` do servidor em vez de deduzir o papel da sessão, e nasce fechada para não piscar a
   coluna de OM para um produtor. O aviso do backfill fica ANTES da lista, e ação sem tradução mostra
   o próprio código, com o mesmo fallback para alvo, família, campo e origem. **Alínea que caiu:** a
   preservação da OM desativada está certa em `buildDomainOptions` e chega quebrada na aba (N2).

5. **A separação dos três eixos na aba Catálogo**, com a legenda na tela e não só no código: Acesso
   diz quem vê, Status diz se aparece, OM dona diz quem mantém. A distinção "privado não é inativo" é
   a que mais gera chamado, e está escrita onde o usuário olha. O campo de OM dona é um `<output>` e
   não um `<input disabled>`. A confirmação de privatização só existe no sentido destrutivo, e a
   falha da segunda escrita é relatada à parte, com `return`, em vez de dobrada no erro genérico.

6. **A tela "Minha conta"** (`frontend/src/js/modals/account-settings.modal.js`). Os campos que o
   servidor recusa em silêncio aparecem somente leitura com a nota de quem os muda; o aviso de que
   trocar a senha derruba esta sessão vem ANTES do botão; e o bloco da chave de API é o melhor
   tratamento de segredo do produto (revelação única, confirmação ao fechar sem copiar, e a tela
   nunca afirma se existe chave, porque nenhuma rota sabe). **Mudou para melhor:** ganhou leitura e
   troca do e-mail por rota própria, com a senha atual conferida antes de qualquer ramo. **O que não
   mudou é a porta:** `showAccountSettingsModal` tem UM chamador, e é o mapa (ver 2.7).

7. **A auto-guarda, em ambos os lados.** O servidor recusa (409 no PUT, 403 no DELETE) e a tela
   desabilita e explica. O comentário no formulário registra por que o campo também precisa travar:
   sem isso, o botão desabilitado da lista é contornado pela porta ao lado. E `syncProducerField`
   roda DEPOIS da trava, para que o escopo de produção herde o cadeado.

8. **O modal de concessão de recurso (`frontend/src/js/catalog/resource-share.modal.js`), apesar de
   estar no lugar errado (A2).** É o irmão certo do modal de atlas e não a mesma tela, porque a
   resposta ali é uma árvore e não uma lista plana: cada linha diz de quem a pessoa recebeu, a
   revogação **conta e nomeia** quem cai junto (`revocationWarning`,
   `frontend/src/js/catalog/grant-tree.js`), o beneficiário coletivo tem selo próprio em vez de
   emprestar as cores de presença de uma pessoa, e o prazo de vencimento aparece na linha, porque a
   morte de uma concessão mora no predicado e não gera evento nenhum.

9. **`frontend/src/js/catalog/visibility-phrases.js` não inventa número.** O `fileoverview` enumera as
   três respostas do servidor que poderiam dar uma contagem e por que nenhuma serve, e o módulo fica
   sem número em vez de fabricar um. É o oposto exato do defeito de C2 e A6.

10. **Os imports por arquivo em toda a pasta `admin/`.** `admin.html` boota sem a store, e cada
    arquivo que podia arrastá-la de volta pelo barrel tem um comentário explicando por que não o faz.
    **Ganhou rede parcial:** `frontend/tests/unit/compartilhar-sem-a-store.test.js` caminha o grafo de
    imports do modal de compartilhamento e é o molde para o resto (ver A2).

## 6. Achados que SAÍRAM

- **A10 (alto) A confirmação de "Tornar dono" dizia ao administrador que ele deixaria de ser dono,
  num atlas de que nunca foi dono. RESOLVIDO, pelo caminho proposto.** Nasceu
  `ownershipTransferWarning` (`frontend/src/js/modals/sharing.modal.core.js`), que bifurca pelo MESMO
  predicado que decide o botão: quem é posto de servidor lê "Você deixará de ser o dono e passará a
  Gestor"; quem chega por papel global lê que a posse sai de quem é dono hoje e que o acesso dele não
  muda, porque vem do papel e não da posse; e quem não passa no gate recebe só a pergunta, sem efeito
  prometido. Preso por `frontend/tests/unit/transferencia-de-posse-frase.test.js`, que fixa os dois
  ramos em absoluto, cobre os seis outros papéis e o lixo, registra a coincidência de string entre os
  dois eixos, e traz **controle negativo**: reimplementa a versão incondicional dentro do teste e
  assere que ela reprovaria. *(Residual: a linha "você" na lista de membros continua faltando, N4.)*

- **Metade de B5 RETIRADA por estar errada na origem:** a coluna "Ordem" da tabela de postos existe
  desde antes da auditoria.

---

## 7. Perguntas em aberto, que só o dono decide

As oito da auditoria continuam de pé, porque o lote não passou aqui. A oitava é nova.

1. **Enumerar os atlas vivos do sistema (A1)?** Sob controle explícito, só por busca, ou aceitar que
   a posse universal se exerça por URL conhecida e escrever isso na cláusula.
2. **Transferir um recurso de catálogo entre OMs deve existir (A4)?** Se sim, é escrita nova e trilha
   nova; se não, o texto do formulário precisa parar de prometê-la.
3. **A transferência de atlas na desativação deve alcançar a lixeira (A5)?** Uma linha de SQL, mas
   muda o significado de "transferi os atlas dele".
4. **Corrigir o e-mail de uma conta alheia (A8)?** O schema JÁ aceita; falta decidir se a tela
   oferece.
5. **A desativação de OM merece o "primeiro reconceda" que o estatuto prescreve para conta (C1)?** E
   no mesmo fôlego: a chave de API deve sobreviver à OM desativada, como sobrevive hoje no caminho
   flexível, ou isso é buraco a fechar?
6. **O painel é desktop-only (M12)?** Se for, a ausência de media query deixa de ser omissão e passa
   a ser decisão.
7. **O filtro por ator na auditoria (M2) é só do administrador, ou também do produtor dentro da OM
   dele?** O gate `_administra` já existe para separar os dois.
8. **O expurgo do log de operações (A7) ganha tela, ou a rota é fechada?**

---

## Nota de método

**Como a baixa contra `59e9600c` foi limitada, e por que isso não é conferência de fé.** Os arquivos
que o commit tocou saíram de `git show --name-only`; os caminhos citados em cada achado saíram do
texto deste documento; a interseção foi computada. Um achado cujos arquivos o commit NÃO tocou não
pode ter sido resolvido por ele: isso é propriedade, não leitura. Só os achados da interseção foram
reabertos contra o código, um a um. A interseção erra nos dois sentidos (acusa por citação
incidental, e deixa passar quem descreve o alvo por símbolo em vez de caminho), então ela estreita o
trabalho sem substituí-lo.

Nenhum arquivo de código foi modificado nesta revisão, nenhum commit foi feito, e o único arquivo
escrito foi este. As afirmações do servidor foram conferidas nos módulos de autenticação, usuários,
organizações, postos, catálogo, atlas, grupos de acesso, auditoria, configuração e sync de
`backend/src/`; as do cliente, lendo os arquivos citados. Onde este documento afirma ausência (por
exemplo, "zero `createAudit` em `backend/src/modules/ranks/`"), a afirmação vem de varredura sobre o
alvo inteiro; onde afirma contagem de chamadores, de varredura sobre `frontend/src/`.

Duas ressalvas de alcance, para não superdeclarar:

- **Este arquivo não está sob nenhum guarda.**
  [`frontend/tests/unit/docs-integridade.test.js`](frontend/tests/unit/docs-integridade.test.js)
  varre `docs/`, `.claude/rules/`, `.claude/skills/`, `.claude/agents/` e uma lista de alvos escrita
  à mão; a raiz do repositório não é varrida, e este arquivo não está na lista. Caminho, wikilink e
  símbolo citados aqui não são verificados por teste nenhum: que estivessem certos na conferência de
  hoje é resultado de leitura, não propriedade mecânica. Se o conteúdo for adotado, o destino é a
  wiki, com o recorte que ela exige.
- **A conferência é uma foto da árvore de trabalho**, limpa no momento desta revisão, com o lote já
  commitado. As medições de grafo de imports (178 módulos hoje, 22 depois do corte) foram feitas com
  o caminhador de `frontend/tests/unit/compartilhar-sem-a-store.test.js` e valem para esta árvore.
