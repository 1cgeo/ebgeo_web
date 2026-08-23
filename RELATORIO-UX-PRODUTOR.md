# Relatório de UX: o perfil PRODUTOR

Auditoria de interface e experiência do papel global `producer`, feita contra o código do branch
`integracao_backend` em 2026-08-23. Nada foi modificado: este documento só analisa.

Método: li `CONSTITUICAO.md` (estatuto do produto), `CLAUDE.md`, `.claude/rules/architecture.md` e as
páginas de wiki do perfil; depois enumerei ponta a ponta as ações do produtor e conferi cada uma no
CÓDIGO dos dois pacotes, cliente e servidor. Onde o relatório afirma um comportamento, ele foi lido
no arquivo citado, não na prosa que o descreve. Citações são por arquivo e SÍMBOLO.

---

## 1. O que o produtor É

### 1.1 Segundo o estatuto

`CONSTITUICAO.md` define o produtor em nove cláusulas, todas **[vigente]**:

| cláusula | o que dá ao produtor | estado |
|---|---|---|
| 1.1 | é um dos quatro papéis globais, e eles **não formam escada** | vigente |
| 1.3 | só o administrador o promove; o papel é lido do banco a cada requisição | vigente |
| 2.3 | **define a visibilidade** (público/privado) dos recursos que administra | vigente |
| 2.4 | **mantém** o acervo da própria OM: cria, edita, remove, com nome, metadados, miniatura e vídeo de prévia (vídeo em quatro dos cinco tipos, mapa base de fora) | vigente |
| 2.5 | **lê** o público e o que a própria OM produziu; não lê o privado alheio | vigente |
| 3.3 | **origina concessão de raiz** sobre o que produz (pai nulo), desde 2026-08-20 | vigente |
| 4.1, 4.2, 4.6 | sobre grupo não tem nada por papel: é dono dos grupos dele, como qualquer um | vigente |
| 6.4 | o empréstimo do atlas reconhece a produção do dono | vigente |
| 9.2 | lê a trilha de auditoria **dos recursos da própria OM**, com recorte imposto pelo servidor | vigente |

Cláusulas de estado aberto que tocam este perfil: **1.5** (auto-cadastro, pendente pelo relay de
e-mail), **9.3** (de-para da trilha, em obra para atlas, permissões e grupos), **10.1** (bytes do
tile privado sem gate, pendente por decisão do dono) e **10.7** (chave de API sem prazo nem escopo,
pendente por trabalho). As quatro estão declaradas em
`frontend/tests/unit/constituicao-estado-das-clausulas.test.js`.

Limites que o estatuto impõe e que valem repetir: o produtor **não é administrador do sistema**,
`users.organization_id` é **lotação** e não autoriza nada (1.4, 10.5), e recurso institucional (sem
OM dona) não é de produtor nenhum (2.4).

### 1.2 Segundo o código

O servidor implementa o estatuto com fidelidade rara. O eixo inteiro passa por uma pergunta só,
`fn_can_produce_resource`, que despacha por tipo sobre literais fechados, dá `true` para o
administrador, exige `role = 'producer'` mais escopo mais OM produtora ativa, e compara
`owner_org_id` (ou `organization_id`, no 360) com o escopo. Recurso institucional e recurso
inexistente caem no mesmo `false`, que é o que produz o "não encontrado" da cláusula 2.3.

Os gates de rota (`requireCatalogProducer` e `requireResourceMaintainer`, ambos em
`backend/src/middleware/resource-access.js`) são deliberadamente **grossos**: eles só perguntam "esta
pessoa mantém alguma coisa?". Todo o recorte por OM mora no `WHERE` da consulta que muta
(`createCatalogItem`, `updateCatalogItem`, `deleteCatalogItem`, `setCatalogAccessLevel`). É desenho,
não descuido, e fecha a janela entre ler o dono e escrever.

No cliente, o predicado é `sessionContext.canProduceFor(orgId)`
(`frontend/src/js/store/sync/session-context.js`), espelho exato do gate do servidor, e a audiência
da página de administração vem de uma definição pura só, `adminAudience`
(`frontend/src/js/admin/admin-audience.js`), consumida por seis sítios. O produtor recebe a porta
rotulada **"Catálogo"** com as abas `catalog`, `groups`, `audit`.

Varri os dois pacotes atrás das duas classes de erro conhecidas e **não achei nenhuma**: não existe
`role !== 'user'` em gate nenhum (as três ocorrências da string são comentários que explicam por que
ela estaria errada), não existe lista fechada de papéis globais em gate de tela ou de rota, e as
duas únicas comparações literais no cliente (`role === 'producer'` em `globalRoleBadge` e em
`buildRoleBadge`) só decidem se o nome da OM entra num selo.

### 1.3 Onde os dois divergem

Cinco divergências reais, e a primeira é a que mais custa.

**(a) A OM produtora desativada mata a autoridade no servidor e não muda um pixel no cliente.**
`fn_can_produce_resource` recusa quando a OM produtora está inativa (`NOT v_prod_ativa`), e
`AUDIT_READER_ACTOR` (`backend/src/middleware/require-audit-reader.js`) derruba a linha pela mesma
razão. Isso é a cláusula 8.5 funcionando. Mas `sessionContext.isProducer()` só olha
`globalRole === 'producer' && producerOrgId != null`, e nada no payload de sessão diz se aquela OM
está viva. Consequência: a porta "Catálogo" continua abrindo, o botão "Calibração 360" continua
visível, os botões Editar e Excluir continuam desenhados, e **cada escrita volta "não encontrado"**.
A auditoria volta 403. O selo ainda diz "Produtor".

**(b) O estúdio de calibração pergunta ao servidor a coisa errada.** `fetchProjects`
(`frontend/src/js/calibration/api.js`) lista por `GET /sv360/projects`, que é o eixo de **leitura**:
o produtor recebe tudo da OM dele mais **todo projeto público de todas as outras OMs**. O eixo de
escrita é `canWriteProject` (`backend/src/modules/streetview360/sv360.write.service.js`), por OM. E
`publicProjectView` (`backend/src/modules/streetview360/sv360.service.js`) só entrega
`organization_id` quando `user?.role === 'admin'`, então a tela nem poderia marcar o que é dela. O
resultado é a definição de "cliente oferece o que o servidor recusa".

**(c) A cláusula 3.4 fala em teto E padrão de um ano; a interface só implementa o padrão.** Nenhum
controle de prazo existe em `ResourceShareModal`, e `expiresAt` (aceito por
`apiClient.grantResource`) nunca é preenchido por nada em `frontend/src/js/`.

**(d) A cláusula 2.4 fala em "cria, edita e remove"; a legenda da aba promete um quarto eixo que não
existe.** O texto de `_build` em `frontend/src/js/admin/catalog-tab.js` diz ao produtor que o
**Status (Ativo/Inativo)** é dele, e não há controle de status para as quatro categorias de
`resources`: o único caminho para "Inativo" é "Excluir".

**(e) A lotação de-autoriza, mesmo não autorizando.** `fn_principal_vivo`, e por extensão
`fn_can_produce_resource`, `fn_has_global_data_access` e `fn_is_global_admin`, exigem
`COALESCE(o.is_active, true) = true` sobre a organização de **lotação**. Desativar a OM onde um
produtor está lotado mata a produção dele na OM que ele mantém. É defensável como leitura literal de
8.5 ("desativar uma conta ou a organização dela"), e colide com 1.4 e 10.5, que dizem que a lotação é
auto-declarada e não autoriza nada. Fica como pergunta ao dono, na seção 5.

---

## 2. Inventário de ações

Veredito por linha. "OK" significa alcançável, rotulada com verdade, com gate de cliente casando com
o do servidor e com estados distintos.

### 2.1 Entrar, ver-se, navegar

| # | ação | onde começa | o que a UI promete | o que o servidor faz | veredito |
|---|---|---|---|---|---|
| 1 | entrar | modal de login no mapa (`frontend/src/js/modals/login.modal.js`) | usuário e senha | `POST /auth/login` devolve papel e `producer_org_id` do banco | OK |
| 2 | manter a sessão no F5 | os quatro `restoreSession` (index, projects-page, admin-page, calibracao-page) | sessão sobrevive | `GET /auth/me` relê papel e escopo do Postgres | OK |
| 3 | ver o próprio papel | selo no menu do avatar (`AccountControl._updateRoleBadge`) e na barra (`buildRoleBadge`, `frontend/src/js/ui/app-bar.js`) | "Produtor" mais a frase de `GLOBAL_ROLE_DESCRIPTIONS` | nada | OK no mapa, `atlas.html` e `admin.html`; **ausente em `calibracao.html`** |
| 4 | ver a própria OM produtora | mesmos selos, mais a linha "OM de produção" em "Minha conta" | nome da OM | nada | **falha quando a OM saiu da lista ativa**: os dois selos imprimem o UUID cru (`orgLabel`), só "Minha conta" trata o caso |
| 5 | distinguir lotação de OM produtora | "Minha conta" (`_renderProfileSection`) | duas linhas separadas, com nota | duas colunas distintas | OK, exemplar |
| 6 | abrir a própria página | item "Catálogo" no menu do avatar, na barra de `atlas.html` e no gate de `admin.html` | painel de três abas | `requireAdmin` nunca é tocado na montagem | OK |
| 7 | abrir a calibração | item "Calibração 360" nas três telas com barra | estúdio | rotas de escrita por OM | alcançável; ver 8 e 9 |
| 8 | ser recusado na calibração | `initCalibracaoPage` | nada: `window.location.replace` mudo | nada | **beco**: perde `?photo=`, não explica, não oferece login |
| 9 | sair da calibração | botão "← Projetos" e o navegador | volta ao seletor interno | nada | **sem saída** para o mapa ou `atlas.html`, salvo o diálogo de papel perdido |

### 2.2 Catálogo (os cinco tipos)

| # | ação | onde começa | o que a UI promete | o que o servidor faz | veredito |
|---|---|---|---|---|---|
| 10 | listar o catálogo | aba "Catálogo", cinco sub-abas (`CATEGORIES`) | "Recursos globais" | 3D/dados/análise/basemap: público de todos mais o privado dele. 360: só a OM dele (`LIST_PROJECTS_ADMIN`) | **rótulo mente** e o regime de escopo muda entre sub-abas sem aviso |
| 11 | criar item | botão "Novo item" | OM dona carimbada pelo servidor, campo só de leitura | `createCatalogItem` força `owner_org_id` do escopo, nunca do corpo | OK, exemplar |
| 12 | editar item | botão Editar por linha, gateado por `canProduceFor` | edita o que ele mantém | `UPDATE ... AND fn_can_produce_resource(...)`, 404 fora da OM | OK, salvo o caso 13 |
| 13 | editar um basemap antigo com `previewVideo` | mesmo botão | edição comum | 422 `any.unknown`, porque `configSchemaSemPreviewVideo` recusa | **CRÍTICO**: o item fica ineditável pelo painel |
| 14 | apagar item | botão Excluir | `showConfirm` sem `message` | soft-delete com o mesmo gate | **confirmação mais fraca do painel**, e o relato depois não traz número |
| 15 | marcar público/privado | `<select>` "Acesso (visibilidade)" dentro do formulário de edição | dica que lista quem continua vendo | `PATCH /resource-access/:type/:id/visibility` sob `requireResourceMaintainer` | OK no gate e no aviso; ver 16 e 17 |
| 16 | mudar só a visibilidade | mesmo `<select>` | mudança pontual | reescreve nome, descrição, ordem, config e miniatura junto | atrito: no 360 é botão de linha, nos outros quatro não |
| 17 | privatizar quando a gravação de metadados falha | mesmo caminho | confirmou a privatização | a segunda chamada nunca acontece | **falha fechado e silenciosa**: o operador sai achando que privatizou |
| 18 | miniatura e vídeo de prévia | campos do formulário | vídeo em 3D, dados e análise; não em basemap | `configSchemaSemPreviewVideo` recusa no basemap | OK, e o cliente já não oferece o campo |
| 19 | ativar/desativar item | **não existe** para as quatro categorias | a legenda diz que o Status é dele | o servidor não expõe rota | **rótulo mente** |
| 20 | achar um item na lista | não existe busca, filtro nem paginação | tabela inteira | lista completa | atrito grande, porque a maioria das linhas é de outras OMs |
| 21 | 360: ativar/desativar, público/privado, vídeo, excluir | `_render360Table` | quatro ações | `backend/src/modules/streetview360/sv360.admin.service.js` por OM | OK; a nota acima da tabela ainda diz "(status/exclusão)" |
| 22 | 360: enviar bundle | **não existe UI** | a nota diz que é fora do painel | `POST /sv360/admin/projects/upload` **aceita produtor** e força a OM dele | capacidade real sem porta, mas honestamente declarada |

### 2.3 Compartilhar recurso

| # | ação | onde começa | o que a UI promete | o que o servidor faz | veredito |
|---|---|---|---|---|---|
| 23 | abrir o compartilhamento | cartão do catálogo no MAPA (`createCatalogCard`) e seletor de camada base | só em recurso privado e só para quem repassa | `requireResourceShare` | gate casa; **a porta não existe na aba "Catálogo"**, que é onde ele privatiza |
| 24 | descobrir que pode compartilhar | `canShareResource` | botão aparece | o produtor entra pelo `shareable`, alimentado por `fn_produced_private_resource_ids` | OK, e o desenho é elegante: nenhuma linha nova no cliente |
| 25 | conceder a uma pessoa | busca com debounce no modal | dois níveis, padrão "Ver" | `grantResource` com `raiz = producesResource` | OK |
| 26 | conceder a um grupo | `<select>` no modal | só grupos próprios | `GET_ADDRESSABLE_LIVE_GROUP` via `fn_can_administer_group` | OK, mas o recorte por posse só é dito nos estados vazio e esgotado |
| 27 | escolher o prazo | **não existe controle** | frase dizendo que vence em até um ano | teto e padrão de um ano no `INSERT_GRANT` | **a metade "teto" da cláusula 3.4 é inalcançável** |
| 28 | criar grupo no ponto de uso | botão no próprio modal | grupo nasce vazio, e a dica diz isso | `POST /access-groups` só com sessão | OK, exemplar |
| 29 | ver quem tem acesso | lista do modal | quem, nível, validade, quem concedeu, quantos dependem | `LIST_GRANTS_FOR_RESOURCE` | OK, exemplar |
| 30 | revogar | botão em **toda** linha | diálogo destrutivo com a cascata nomeada | `requireGrantRevoker`: só quem concedeu, ou admin | **CRÍTICO**: o cliente oferece e o servidor recusa com 403 depois da confirmação |
| 31 | rebaixar um nível | **não existe** | nada | não há rota `PATCH` de grant | só revogar (com poda) e reconceder, e a tela não avisa |

### 2.4 Grupos, auditoria, conta

| # | ação | onde começa | o que a UI promete | o que o servidor faz | veredito |
|---|---|---|---|---|---|
| 32 | criar, renomear, apagar grupo | aba "Grupos" | os grupos dele | `fn_can_administer_group`, posse | OK, exemplar (avisos nomeiam pessoas, recursos e atlas) |
| 33 | adicionar e remover membro | mesma aba | três estados distintos de busca | idem | OK |
| 34 | sair de um grupo | mesma aba, seção "Grupos de que participo" | dono recebe nota em vez de botão | rota própria sem `requireGroupAuthority` | OK |
| 35 | ler a trilha da OM | aba "Auditoria" | "O que foi feito no servidor" | recorte imposto em `listAudit`, `targetOrgId` do cliente ignorado | gate OK; **o rótulo mente**: a trilha é só da OM dele |
| 36 | filtrar a trilha | mesma aba | dez tipos de alvo e cinco famílias de ação | `target_org_id` só é carimbado em catálogo, acesso a recurso e 360 | metade dos filtros nunca devolve linha; os atos dele sobre **grupos** não entram na própria trilha |
| 37 | editar nome e posto | "Minha conta" | dois campos | `updateProfileSchema` aceita exatamente dois | OK, e a nota diz quem muda o resto |
| 38 | ver o próprio e-mail | **não existe** | nada | `FIND_USER_BY_ID` não o seleciona | buraco silencioso |
| 39 | trocar a senha | "Minha conta" | avisa antes que derruba todas as sessões, esta inclusive | `REVOKE_ALL_USER_TOKENS` | OK, exemplar |
| 40 | gerar chave de API | "Minha conta" | uma vez só, com confirmação, e diz que a chave carrega as permissões inteiras, sem prazo nem escopo | `POST /users/me/api-key/rotate` | OK, exemplar, e cumpre 10.7 por escrito |
| 41 | alcançar "Minha conta" | **só do mapa** | dois `fileoverview` dizem que também de `atlas.html` e `admin.html` | nada | **falso hoje** |
| 42 | sair | "Sair", em qualquer das quatro telas | nada | logout revoga o refresh | **sem confirmação e sem aviso** de que o catálogo privado somado desaparece |

### 2.5 Usar o mapa como qualquer pessoa

| # | ação | veredito |
|---|---|---|
| 43 | atlas, mapas, camadas, feições, briefing, comentários | OK. O produtor é um usuário comum aqui, e o eixo por atlas é gateado por hierarquia (`permissionRank`, `hasAtLeast` em `frontend/src/js/projects/permission-levels.js`), nunca por lista fechada |
| 44 | ver recurso privado da própria OM no catálogo do mapa | OK: `refreshVisibleResources` soma o payload aditivo, e o selo "Privado" aparece no cartão |
| 45 | saber quais itens do catálogo do mapa são da OM dele | **não existe sinal nenhum**, e não há atalho para editá-los |
| 46 | emprestar ao atlas um recurso da própria OM | OK, e o braço de produção em `fn_granted_resource_ids` faz o empréstimo resolver (cláusula 6.4) |

---

## 3. Achados, por gravidade

### CRÍTICO

**C1. O estúdio de calibração lista projetos que o produtor não pode escrever, e não há como
distingui-los.**
Hoje: `fetchProjects` (`frontend/src/js/calibration/api.js`) chama `GET /sv360/projects`, o eixo de
LEITURA. O produtor recebe os projetos da OM dele mais todo projeto público de qualquer OM.
`publicProjectView` (`backend/src/modules/streetview360/sv360.service.js`) só entrega
`organization_id` para `role === 'admin'`, e o cartão de `showProjectSelector`
(`frontend/src/js/calibration/app.js`) não desenha OM nem `status`. O produtor abre um projeto
alheio, calibra (as leituras são `flexibleAuth` e funcionam), e descobre no primeiro salvamento.
Por que é ruim: é trabalho perdido, não apenas um clique errado. O operador pode alinhar dezenas de
fotos antes de tentar gravar.
Correção: trocar a fonte da lista para `GET /sv360/admin/projects`, que já vem recortada por
`fn_can_produce_resource` em `LIST_PROJECTS_ADMIN` e que o produtor já consome na aba "Catálogo". Se
o mural indiferenciado for desejado, então `publicProjectView` precisa entregar `organization_id`
também ao produtor, e o cartão precisa de um selo "outra OM" mais o `status`.

**C2. A recusa de escrita da calibração diz uma coisa falsa, em três frases.**
Hoje: `MSG_403` (`frontend/src/js/calibration/api.js`) é
`'Voce nao tem o papel de admin: a calibracao nao aceita a sua escrita.'`, e `showRoleLostDialog`
(`frontend/src/js/calibration/app.js`) diz que a conta "não tem mais o papel **admin**, que e o
unico que calibra" e manda "recarregar a pagina".
Por que é ruim: o produtor não perdeu papel nenhum, `admin` não é o único que calibra desde que o
gate aceita `producer`, e recarregar não muda nada. A mensagem manda pedir a um administrador um
papel que ele já tem.
Correção: reescrever as duas para nomear a causa real, que é a OM dona do projeto ("este projeto é
de outra OM: você mantém o acervo de X"), e separar o caso de papel realmente perdido. Nenhum teste
prende essas strings hoje; `frontend/tests/unit/calibracao-pagina.test.js` cobre o predicado e não o
texto.

**C3. No salvamento, o 403 nem chega ao usuário.**
Hoje: `handleSave` (`frontend/src/js/calibration/app.js`) usa `Promise.allSettled`, então a
`CalibrationAuthError` vira uma rejeição anônima e o toast é o genérico
`'Falha ao salvar 1 de 1 alteracao(oes). 0 salva(s). Tente salvar novamente.'`. O diálogo
bloqueante aparece uma vez só (trava `roleLostShown`); depois disso só resta esse toast.
Por que é ruim: manda repetir o que nunca vai funcionar, e o motivo real fica no `console.error`.
Correção: inspecionar os `rejected` do `allSettled` e, achando uma `CalibrationAuthError`, mostrar a
mensagem dela em vez do texto genérico.

**C4. "← Projetos" descarta calibração não salva sem perguntar.**
Hoje: `onBackToProjects: () => showProjectSelector()` (`frontend/src/js/calibration/app.js`) chama
`teardownSubsystems()` direto, sem consultar `isDirty()` (`frontend/src/js/calibration/state.js`).
Os outros três caminhos guardam: `navigateToPhoto` abre `showDirtyDialog`, o `beforeunload` bloqueia
o fechamento da aba, e `handleMarkReviewedAndNext` salva antes.
Por que é ruim: é o único caminho de perda de dado do perfil, e é o botão mais natural para quem
terminou uma foto.
Correção: passar o mesmo `showDirtyDialog` que `navigateToPhoto` já usa.
Nota irmã: `startIdleWatch({ onExpire: () => endSession('inatividade') })` também não pergunta nada.

**C5. O botão "Remover acesso" é desenhado em toda linha, e o servidor recusa a maioria delas.**
Hoje: `_renderGrantItem` (`frontend/src/js/catalog/resource-share.modal.js`) emite
`data-action="revoke"` incondicionalmente. O servidor (`requireGrantRevoker` mais
`GRANT_REVOKER_ACTOR`) só aceita quem concedeu (`granted_by = ator`) ou o administrador global. Um
produtor que abra o recurso da própria OM e tente revogar uma concessão originada por um
administrador ou por outro produtor da mesma OM passa pelo diálogo destrutivo completo, com a
contagem da cascata, confirma, e só então leva 403 num toast.
Por que é ruim: o `@fileoverview` desse mesmo arquivo declara o princípio oposto ("só é oferecido a
quem `canShareResource` aprova, em vez de mostrar um formulário que não grava"), e o dado para
gatear já chega: `LIST_GRANTS_FOR_RESOURCE` traz `granted_by` e o cliente tem
`sessionContext.userId`.
Correção: desenhar o botão só quando `grant.granted_by === sessionContext.userId ||
sessionContext.isAdmin()`, e, nas demais linhas, um texto dizendo quem pode revogar.

**C6. Um basemap gravado antes de 2026-08-23 com `previewVideo` no `config` fica ineditável.**
Hoje: `_renderResourceForm` (`frontend/src/js/admin/catalog-tab.js`) pré-preenche o textarea
"Avançado" com `JSON.stringify(resource?.config ...)` inteiro; `CATEGORIAS_COM_VIDEO` não inclui
`basemap`, então `videoInput` é `null` e o `onSave` não remove a chave. O servidor
(`configSchemaSemPreviewVideo`, `backend/src/modules/catalog/catalog.schemas.js`) responde 422 em
qualquer edição, mesmo uma que só mude o nome.
Por que é ruim: é regressão introduzida pelo endurecimento correto da cláusula 2.4. O produtor não
tem como consertar pela interface, e nada na tela sugere apagar a chave à mão do JSON.
Correção: no ramo de basemap, remover `previewVideo` do objeto antes de serializar para o textarea,
e avisar numa linha que o campo foi descartado por não valer para mapa base.

**C7. A OM produtora desativada derruba tudo no servidor e não muda nada na tela.**
Hoje: `fn_can_produce_resource` recusa por `NOT v_prod_ativa`, e `AUDIT_READER_ACTOR`
(`backend/src/middleware/require-audit-reader.js`) derruba pelo mesmo termo. No cliente,
`sessionContext.isProducer()` e `canProduceFor` não sabem nada disso, então a porta "Catálogo"
abre, `mayCalibrate()` (`frontend/src/js/ui/app-bar.js`) mantém a calibração visível, os botões
Editar e Excluir continuam desenhados, e cada escrita volta "não encontrado" enquanto a auditoria
volta 403. O selo ainda diz "Produtor", com o UUID cru da OM ao lado, porque `orgLabel`
(`frontend/src/js/admin/org-options.js`) cai no id bruto quando a OM saiu de
`config.organizacoesMilitares`.
Por que é ruim: é o pior padrão possível de recusa, um painel que parece funcional e nega tudo com a
mensagem menos informativa que existe.
Correção: fazer `GET /auth/me` devolver a vivacidade da OM produtora (ou simplesmente `null` no
`producer_org_id` quando ela estiver inativa, que já resolveria pelo `isProducer()`), e mostrar uma
tarja na aba dizendo que a OM produtora foi desativada e a quem recorrer.

### ALTO

**A1. Não há como escolher o prazo de uma concessão.**
`ResourceShareModal._handleGrant` e `_handleGrantGroup` (`frontend/src/js/catalog/resource-share.modal.js`)
montam o payload sem `expiresAt`, que `apiClient.grantResource` aceita e o servidor honra com
`LEAST(...)`. A cláusula 3.4 fala em teto **e** padrão; a UI só entrega o padrão de um ano.
Correção: um campo de data opcional, com o teto do servidor como máximo do `<input>`.

**A2. A porta do produtor não tem compartilhamento, e a única porta pode nunca nascer.**
`frontend/src/js/admin/catalog-tab.js` não abre `showResourceShareModal` em lugar nenhum: os dois
pontos de entrada são `frontend/src/js/catalog/catalog.modal.js` e
`frontend/src/js/base-layer-selector/base-layer-selector.control.js`, ambos dentro do mapa. O
produtor privatiza numa página e concede noutra, sem que a primeira diga onde. Pior: o chip
"Catálogo" do mapa é decidido uma vez no boot por `init()`
(`frontend/src/js/sidebar/components/chips.component.js`, via `CatalogService.hasItems()`) e nunca
reavaliado, então numa instalação de catálogo público vazio o produtor que entra depois do boot fica
sem chip e sem porta até recarregar.
Correção: ou reavaliar o chip em `SESSION_CHANGED`, ou (melhor) dar à aba "Catálogo" um botão
"Compartilhar" por linha. O comentário de `frontend/src/js/base-layer-selector/base-layer-selector.control.js` justifica a ausência pelo
peso do modal, que arrasta o motor de sync para uma página que boota sem a store: isso é real e
precisa de um modal enxuto para a página de administração, não de uma exceção ao alias.

**A3. A legenda da aba promete um eixo "Status" que não existe.**
`_build` (`frontend/src/js/admin/catalog-tab.js`) diz ao não-administrador: "Você mantém os recursos
da sua OM: Acesso (Público/Privado), Status (Ativo/Inativo) e os metadados são seus." Não há coluna
nem botão de status nas quatro categorias de `resources`, `createSchema`/`updateSchema` não aceitam
`active`, `listCatalog` filtra `t.active = true` e `deleteCatalogItem` é `SET active = false`. O
único caminho para "Inativo" é "Excluir", e o único caminho de volta é recriar com o mesmo id, id
que o produtor não tem mais como descobrir porque a linha sumiu da listagem.
Correção: ou tirar "Status" da legenda do não-administrador, ou expor o eixo (uma coluna, um botão
Ativar/Desativar e um filtro "mostrar inativos").

**A4. Não há como rebaixar o nível de uma concessão.**
Nenhum seletor por linha em `_renderGrantItem`, e nenhuma rota `PATCH` de grant no backend. Passar
alguém de "Ver e compartilhar" para "Ver" exige revogar, o que poda toda a subárvore que a pessoa
criou (cláusula 3.5), e conceder de novo. A tela não diz isso.
Correção: no mínimo, uma frase no diálogo de revogação explicando que rebaixar não existe. No
ideal, a rota e o seletor.

**A5. `calibracao.html` é a página do produtor e é a única sem identidade e sem saída.**
`frontend/src/js/calibration/calibracao-page.js` não monta `createAppBar`, e `calibracao.html` não
tem cabeçalho. Não há selo de papel, não há nome da OM, não há "Minha conta" e não há botão de volta
para o mapa ou `atlas.html`, salvo o `onLeave` do diálogo de papel perdido.
Correção: montar a mesma barra que `atlas.html` e `admin.html` usam.

**A6. Sem projeto 360, a calibração é uma tela morta.**
`showProjectSelector` monta `projects.map(...).join('')` sem ramo de lista vazia, então rende um
`<div class="project-selector__grid">` vazio sob a instrução "Selecione um projeto para iniciar".
Nada aponta o caminho de ingestão. A explicação existe, mas na outra página: `_render360List`
(`frontend/src/js/admin/catalog-tab.js`) imprime "O envio do bundle 360° é feito fora do painel".
Correção: estado vazio no seletor, com a frase de ingestão e o link para a aba "Catálogo".

**A7. "Minha conta" só existe no mapa, e a documentação do próprio arquivo diz o contrário.**
`showAccountSettingsModal` tem um chamador só, `AccountControl._handleOpenAccountSettings`
(`frontend/src/js/account/account.control.js`). `createAppBar` não oferece a entrada. Os
`fileoverview` de `frontend/src/js/modals/account-settings.modal.js` e de
`frontend/src/js/modals/account-settings.model.js` afirmam que a tela "é alcançável a partir de `atlas.html` e
`admin.html`": a propriedade de import (zero dependências pesadas) é verdadeira, a de alcançabilidade
é falsa hoje. Para trocar a senha ou gerar a chave de API, o produtor precisa entrar no mapa.
Correção: acrescentar a entrada em `createAppBar` e corrigir os dois cabeçalhos, ou corrigir só os
cabeçalhos se a ausência for deliberada.

### MÉDIO

**M1. A aba "Auditoria" nunca diz que a trilha é recortada à OM.** O subtítulo fixo de `_esqueleto`
(`frontend/src/js/admin/audit-tab.js`) é "O que foi feito no servidor: quem, quando, sobre o quê".
O servidor manda `escopoOrgId` na resposta exatamente para isso (`listAudit`,
`backend/src/modules/audit/audit.service.js`) e **nenhum arquivo do frontend o lê**. Correção: usar
`escopoOrgId` no subtítulo do não-administrador.

**M2. A nota do backfill descreve uma coluna que o produtor não tem.** `_toolbar` acrescenta
incondicionalmente "A OM de cada linha é a OM dona do recurso na época do ato", e a coluna de OM só
é desenhada quando `this._administra`. Correção: mover a nota para dentro do mesmo `if`, e dar ao
produtor a ressalva que é dele (o recorte).

**M3. Metade dos filtros de auditoria é estruturalmente vazia para o produtor.** `target_org_id` só
é carimbado por catálogo, acesso a recurso e 360, então dos dez `TIPOS_DE_ALVO` cinco (`USER`,
`ORG`, `ATLAS`, `ACCESS_GROUP`, `CONFIG`) nunca devolvem linha, e três das cinco famílias de
`acoesPorFamilia` são inteiramente inalcançáveis. O caso mais desconcertante: **o produtor
administra grupos na aba ao lado e os atos dele sobre grupos não aparecem na trilha dele**.
Correção: recortar as opções por audiência, ou carimbar `target_org_id` nas famílias que faltam.

**M4. O subtítulo da aba "Catálogo" é o do administrador.** `sectionHeader('Catálogo', { subtitle:
'Recursos globais — 3D, 360, dados, análises e basemaps (metadados)' })`. Para o produtor, essa é a
única linha que descreve o conjunto, e descreve errado o que ele mantém.

**M5. O regime de escopo muda entre sub-abas da mesma aba, sem aviso.** 3D, dados, análise e basemap
vêm de `listCatalog` (acervo público inteiro mais o privado dele, a maioria com "Mantido por outra
OM" no lugar dos botões); 360 vem de `LIST_PROJECTS_ADMIN` (só a OM dele). "Nenhum item nesta
categoria" significa coisas diferentes nas duas. E não há busca, filtro "só os meus", ordenação nem
paginação: `_renderResourceList` monta a tabela inteira.

**M6. A confirmação de excluir item de catálogo é a mais fraca do painel.** `_deleteResource` chama
`showConfirm('Excluir "X" do catálogo?', { destructive: true })` **sem `message`**: não diz que é
irreversível pela interface, não diz quantos atlas referenciam o recurso, não diz que concessões
caem. Compare com `groupDeletionWarning` (`frontend/src/js/admin/group-phrases.js`), que nomeia
pessoas, recursos e atlas antes do clique. O relato depois é `showSuccess('Item excluído.')`, sem
número.

**M7. A privatização confirmada pode não acontecer, em silêncio.** Em `onSave` a ordem é confirmar,
depois `updateResource`, depois `setResourceVisibility`. Se a primeira escrita falhar, a função
retorna com "Falha ao salvar o item" e a privatização que o usuário acabou de confirmar simplesmente
não roda. Falha fechado, que é a direção certa, mas a mensagem não diz que os dois atos eram um.

**M8. Mudar só a visibilidade exige reescrever o item inteiro.** No 360 é botão de linha
(`admin-360-access`); nos quatro tipos de catálogo o `<select>` está dentro do formulário de edição,
cujo `onSave` reescreve nome, descrição, ordem, `config` e miniatura.

**M9. O logout apaga o catálogo privado sem confirmar e sem avisar.**
`SyncEngine.logoutAndDisconnect` chama `clearVisibleResources()`, o que descarta a soma aditiva de
`refreshVisibleResources`, inclusive os recursos que o produtor enxerga **por produção**.
`AccountControl._handleLogout` dispara direto no clique, sem `showConfirm`. O único aviso existente
no logout é sobre trabalho não sincronizado, e só no caminho involuntário
(`handleSessionLost`).

**M10. O gate da calibração recusa em silêncio e uma falha de rede desloga.** `initCalibracaoPage`
(`frontend/src/js/calibration/calibracao-page.js`) faz `window.location.replace(MAP_URL)` sem
`?sessao=`, perdendo um eventual `?photo=`. E `restoreSession()` faz
`catch { apiClient.clearTokens(); return false; }`: qualquer 500 ou timeout do `getMe()` apaga os
tokens e derruba o produtor no mapa deslogado, indistinguível de "você não tem permissão".

**M11. Três resolvedores diferentes para "id de OM vira nome", com quedas divergentes.** `orgLabel`
(`frontend/src/js/admin/org-options.js`) cai no id bruto; `organizationName`
(`frontend/src/js/modals/account-settings.modal.js`) cai em string vazia e o chamador escreve "OM
fora da lista de ativas". A tela que menos importa acerta e as duas que aparecem sempre erram.

**M12. A tela de 403 do modal de compartilhar afirma uma causa única.** `_renderDenied` diz "Você
recebeu este recurso apenas para **ver**", que é falso para um produtor cujo escopo mudou entre o
desenho do cartão e o clique, ou que abriu um recurso de outra OM.

**M13. O recorte "só os seus grupos" só é dito nos estados marginais.** As frases de posse
(`groupPickerEmptyNotice`, `groupPickerExhaustedNotice`, em `frontend/src/js/admin/group-phrases.js`)
aparecem quando não há grupo ou quando todos já receberam. No estado normal o `<select>` diz só
"Escolher um grupo…". Compare com `_renderGroupPicker` (`frontend/src/js/modals/sharing.modal.core.js`),
que no caminho de atlas escreve "Só aparecem aqui os grupos que você administra".

**M14. O e-mail da conta é invisível e imutável, sem uma frase.** `FIND_USER_BY_ID`
(`backend/src/modules/users/users.queries.js`) não o seleciona, `backend/src/modules/users/users.routes.js` não tem rota de
troca para si mesmo, e "Minha conta" não o menciona. É o único campo do registro que some sem
explicação.

**M15. O produtor não distingue, no mapa, o que é da OM dele.** `createCatalogCard`
(`frontend/src/js/catalog/components/catalog-card.js`) desenha o selo "Privado" e nada sobre OM
dona, e não há atalho para editar o item no painel. Ele reencontra o item pelo nome, do outro lado
do aplicativo.

### BAIXO

- **B1.** Ícones e subtítulo de administrador para o produtor: `AdminPanel._buildHeader` usa
  `SHIELD_ICON` e `subtitle: 'Sistema EBGeo'` fixos, e `frontend/src/js/account/account.control.js` monta o botão com
  `ICON_ADMIN` mesmo quando o rótulo é "Catálogo".
- **B2.** Abaixo de 900px, `frontend/src/css/app-bar.css` esconde `.app-bar__username` **e**
  `.app-bar__role`: em `atlas.html` e `admin.html` o produtor deixa de ver quem é e que é Produtor.
- **B3.** A nota acima da tabela 360 diz "(status/exclusão)" para uma tabela com quatro ações,
  incluindo o eixo de acesso.
- **B4.** Nem a aba "Auditoria" nem a "Catálogo" oferecem "Tentar de novo" na falha de rede: as duas
  trocam o texto do `<p class="admin-users__status">` e disparam um toast. A aba "Grupos" e o modal
  de compartilhar usam `emptyState` com dica e botão, e são o padrão a copiar.
- **B5.** Na calibração, os erros chegam à tela crus e em inglês (`Failed to fetch projects (HTTP
  500)`), o toast de falha de gravação dura 3 segundos, e o card de erro de `showProjectSelector` faz
  `innerHTML` com `err.message` sem `escapeHtml`, ao contrário de `p.name` na linha acima. Não é XSS
  explorável hoje, e é a assimetria que `no-unescaped-innerhtml` existe para evitar (a regra não pega
  porque o léxico dela é `nome`/`descricao`).
- **B6.** Ramo morto: o `else` "Mantido por outra OM" de `_render360Table` é inalcançável, porque
  `LIST_PROJECTS_ADMIN` já filtrou.
- **B7.** A lista de concessões não mostra a data de criação, embora `created_at` chegue no payload.
- **B8.** O guarda das hidratações de sessão é uma lista literal de cinco caminhos em
  `frontend/tests/unit/session-context.test.js`, não um censo por `git ls-files`: um sexto sítio de
  hidratação nasce sem reprovar nada, e é justamente a divergência que o helper
  `sessionUserInfoFromMe` existe para impedir.
- **B9.** `frontend/src/js/admin/catalog-tab.js` é a única das três abas do produtor fora da convenção de
  `@utils/event-cleanup.js`: usa `addEventListener` cru e o cleanup do `mount` só faz
  `this._alive = false`.
- **B10.** O cartão do seletor de projetos renderiza `p.location`, que é `null` por contrato
  (`publicProjectView` documenta "no column: always null"), então essa linha nunca aparece.
- **B11.** Os três atos em lote da calibração (`batchUpdateRun`, `batchUpdateProject`,
  `resetProjectReviewed`) usam `window.confirm` nativo, enquanto o resto do aplicativo usa
  `showConfirm`.

---

## 4. O que está BOM e não deve ser mexido

Esta seção não é cortesia: várias das coisas abaixo são exatamente o tipo de decisão que uma sessão
seguinte "simplifica" e quebra.

1. **`adminAudience` como definição única da porta.** Função pura, zero imports, seis consumidores,
   e o administrador testado primeiro para que um admin que também produza não caia no ramo do
   produtor e perca três abas. O rótulo nomeia o que a pessoa **recebe** ("Catálogo"), nunca a
   página, e a lista de abas é recortada no cliente para que `users`, `config` e `personnel` não
   batam num `requireAdmin` já na montagem. Conferi: **nenhuma chamada de rede feita na montagem das
   três abas do produtor exige administrador**.
2. **O produtor entra em `canShareResource` pelo `shareable`, não por papel.**
   `frontend/src/js/store/sync/resource-access.service.js` não ganhou uma linha para isso: o servidor
   passou a mandar os ids produzidos dentro de `shareable` (`LIST_SHAREABLE_OF_ACTOR` mais
   `fn_produced_private_resource_ids`), e o índice que já existia os absorveu. O cliente continua sem
   saber de qual OM é cada item, que é a resposta certa para uma pergunta que o servidor responde
   melhor.
3. **O carimbo de `owner_org_id` nunca vem do corpo.** `createCatalogItem` o força a partir do
   escopo do chamador, e o formulário mostra a OM dona como `<output>` de leitura, com uma dica
   diferente por papel. Um `<select>` ali seria um controle que não grava em lugar nenhum.
4. **Os avisos de retirada de acesso.** `visibilityChangeWarning`
   (`frontend/src/js/catalog/visibility-phrases.js`) devolve `null` no sentido aditivo de propósito,
   para não treinar o operador a clicar em "Confirmar" sem ler; `visibilityChangeSummary` relata o
   efeito e não o sucesso da chamada; e a ausência de número é justificada por medição, endpoint a
   endpoint, no `@fileoverview`. O mesmo vale para `revocationWarning` e `frontend/src/js/catalog/grant-tree.js`, que nomeiam
   a cascata **antes** do clique e corrigem o número **depois**, com a verdade do servidor.
5. **A aba "Grupos" inteira.** Sem um único ramo por papel (o recorte é do servidor), com
   `Promise.allSettled` para as duas listagens falharem independentemente, `_reachForWarning`
   relendo as contagens para não citar número velho, degradação declarada em `countsStale`, e o dono
   recebendo uma nota explicativa em vez de um botão "Sair" que levaria 409.
6. **"Minha conta" na parte da chave de API e da senha.** O aviso de que a chave carrega as
   permissões inteiras, sem prazo e sem escopo reduzido, cita a cláusula 10.7 no comentário e a
   cumpre no texto; a chave é revelada uma vez, com confirmação ao rotacionar, guarda ao fechar sem
   copiar, e `copied` só vira verdadeiro numa escrita de clipboard bem-sucedida. O aviso de senha diz
   "inclusive esta", que é a verdade medida contra `REVOKE_ALL_USER_TOKENS`.
7. **`frontend/src/js/ui/role-labels.js`.** Zero imports (contrato, para as três páginas sem mapa), papel
   desconhecido aparece cru com uma frase que admite o desconhecimento em vez de virar "Usuário", e a
   descrição do produtor nomeia o eixo em que ele age. `frontend/tests/unit/papel-global-rotulos.test.js`
   compara com `ROLE_CHIP` para as duas fontes não divergirem.
8. **A separação lotação / OM produtora.** Nenhuma barra lê `organization_id`; a única tela que
   mostra as duas as separa por rótulo, por origem e por uma nota. Depois de a coluna `org_role` ter
   saído do código inteiro (cláusula 1.4), isso é o que impede a confusão de voltar.
9. **A aba "Auditoria" obedecer ao servidor.** `this._administra` nasce `false` para não piscar a
   coluna de OM, `_params()` apaga `targetOrgId` de quem não administra, e a tela lê `administra` da
   resposta em vez de deduzir o papel da sessão. O estado vazio distingue "nada casou o filtro" de
   "nada aconteceu".
10. **A escada de erro do 360**: `enforceProjectWritable` responde 404 quando o projeto nem é
    legível e 403 quando é legível e não gravável, e `loadWritableProject` passa `atlasId = null` de
    propósito, para que empréstimo de atlas amplie leitura e nunca escrita.

---

## 5. Perguntas em aberto que só o dono decide

1. **A lotação deve de-autorizar?** `fn_principal_vivo` exige `COALESCE(o.is_active, true) = true`
   sobre `users.organization_id`, e `fn_can_produce_resource` herda isso. Desativar a OM onde um
   produtor está **lotado** mata a produção dele na OM que ele **mantém**. É leitura literal de 8.5
   ("desativar uma conta ou a organização dela") e colide com 1.4 e 10.5 ("a lotação não autoriza
   nada"). Se a resposta for "não deve", o termo sai dos quatro predicados; se for "deve", a
   constituição merece uma frase dizendo que a lotação não autoriza mas revoga.
2. **O estúdio de calibração deve mostrar o acervo do Exército inteiro ou só a OM do produtor?** As
   duas leituras são defensáveis (ver o alinhamento vizinho ajuda; poder gravar é outra coisa). A
   correção muda conforme a resposta: trocar a rota da lista, ou entregar `organization_id` ao
   produtor e marcar os cartões.
3. **O produtor deve poder conceder por menos de um ano?** A cláusula 3.4 fala em teto e padrão. Se a
   resposta for sim, entra um campo de data; se for não, a cláusula merece dizer que o prazo é fixo.
4. **O eixo "Status" (Ativo/Inativo) deve existir para as quatro categorias de catálogo, como já
   existe no 360?** Hoje a legenda promete e o produto não entrega. Ou o eixo nasce, ou a legenda
   muda.
5. **A aba "Catálogo" deve ganhar o botão "Compartilhar"?** O impedimento técnico é real (o modal
   arrasta o motor de sync para uma página que boota sem a store), e o custo de mantê-los separados é
   o produtor privatizar num lugar e conceder noutro, sem que nada ligue os dois. A saída provável é
   um modal enxuto para a página de administração, e isso é trabalho, não ajuste.
6. **Os atos do produtor sobre grupos devem aparecer na trilha dele?** Hoje não aparecem, porque
   `target_org_id` não é carimbado na família `ACCESS_GROUP`. A cláusula 9.2 fala em "recursos
   produzidos", então o comportamento atual é literal; a experiência é a de um filtro que existe para
   provar uma lista vazia.
7. **"Minha conta" deve estar nas páginas sem mapa?** Dois `fileoverview` afirmam que já está. Ou a
   entrada nasce em `createAppBar`, ou os dois cabeçalhos são corrigidos.
8. **O logout deve confirmar?** Ele apaga a soma de recursos privados sem uma palavra. Pode ser
   decisão (é reversível: basta entrar de novo), e pode ser buraco.
