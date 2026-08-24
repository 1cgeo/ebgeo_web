# Relatório de UX: o perfil PRODUTOR

Perfil avaliado: conta com papel GLOBAL `producer`. `CONSTITUICAO.md` é a especificação de
referência; as cláusulas que definem o papel (1.1, 1.3, 2.3, 2.4, 2.5, 3.3, 6.4, 9.2) estão todas
vigentes e não são recopiadas aqui, porque duplicar o estatuto é como uma cópia envelhece.

**Auditoria original: 2026-08-23.** 40 achados numerados, mais inventário de ações, lista do que não
mexer e oito perguntas ao dono.

**Revisão: 2026-08-24.** Um lote grande (o que fechou os três críticos do perfil `user`, mais os dois
que o precederam) tocou este perfil de lado. Reescrito para separar o que saiu do que fica, reavaliar
a gravidade e registrar o que a auditoria não viu.

## Como esta revisão foi feita

Cada achado foi reaberto **contra o código da árvore de trabalho**, não contra a lista de commits:
abriu-se o arquivo, procurou-se o símbolo, leu-se o comportamento. A árvore está limpa e o lote está
commitado, então aqui não cabe a ressalva de "trabalho não commitado" do relatório irmão. Apareceram
as três categorias esperadas, e a terceira foi a mais produtiva: resolvido por caminho diferente do
proposto, resolvido pela metade, e **uma afirmação central cujo efeito é verdadeiro e cujo mecanismo
estava errado** (a de que a lotação de-autoriza; seção 2).

Corrige-se também um defeito de FORMA: o documento marcava sete achados como CRÍTICO, o que é o mesmo
que não ter nenhum. Cada um foi reavaliado com o critério do relatório irmão, **crítico é perda
irreversível de trabalho**, e a razão do rebaixamento está escrita em cada um.

## Placar

| | |
|---|---|
| achados conferidos | 40 |
| saíram (resolvidos) | 2 |
| fundidos (dois achados da mesma causa viraram um) | 2 → 1 |
| ficam | 37, dos quais 3 são parciais |
| achados NOVOS | 4 |

Gravidade **depois da reavaliação**: **2 críticos, 6 altos, 14 médios, 15 baixos**. Dos sete CRÍTICOS
originais, cinco foram rebaixados e um saiu resolvido. Os dois que ficam são a mesma coisa por dois
caminhos: **o estúdio de calibração destrói trabalho do operador.**

---

## 1. O que o lote mudou neste perfil

Conhecimento, não achado. Existe para a próxima sessão não reabrir o assunto.

**1.1 A credencial parou de ser apagada em qualquer falha, na quarta página.**
`frontend/src/js/calibration/calibracao-page.js` tinha o mesmo `catch` nu das outras três e ficou
para trás porque o censo era lista escrita à mão. Hoje `restoreSession` usa `classifyRequestFailure`
(`frontend/src/js/utilities/request-failure.js`) e só apaga em `RequestFailure.CREDENTIAL`. O
inventário virou derivado de `git ls-files` mais o predicado de chamar `clearTokens`, com piso e um
caso exigindo aquela página pelo nome
(`frontend/tests/unit/falha-de-requisicao-nao-apaga-credencial.test.js`). A outra metade do achado
sobre aquele arquivo continua aberta (M12).

**1.2 O papel global e o escopo de PRODUÇÃO ficaram visíveis.** `globalRoleBadge`
(`frontend/src/js/ui/role-labels.js`) é consumido pelo menu da conta
(`AccountControl._updateRoleBadge`) e pela barra superior (`buildRoleBadge`,
`frontend/src/js/ui/app-bar.js`), e nos dois a OM produtora aparece como TEXTO ao lado de "Produtor",
não como dica. Antes, a única tela que a nomeava era o formulário de criação do catálogo. Duas
ressalvas ficam como achado: a frase de `GLOBAL_ROLE_DESCRIPTIONS` é só o `title` (B2), e a OM
desativada imprime o UUID cru (M13).

**1.3 A porta para a calibração existe nas três páginas com barra.** `mayCalibrate()`
(`frontend/src/js/ui/app-bar.js`) é `sessionContext.isAdmin() || sessionContext.isProducer()`, o
MESMO par que gateia `frontend/src/js/calibration/calibracao-page.js`, e o menu da conta o repete. Um
gate, três telas, sem terceira cópia.

**1.4 Revogar concessão só aparece para quem o servidor aceitaria.** Ver C5, seção 6.

**1.5 Tornar privado passou a confirmar, com o efeito nomeado.** `frontend/src/js/admin/catalog-tab.js`
usa `visibilityChangeWarning` e `visibilityChangeSummary`
(`frontend/src/js/catalog/visibility-phrases.js`) no `onSave` do formulário e no botão de linha do 360
(`_toggle360Access`). Pergunta **só no sentido destrutivo**, porque `visibilityChangeWarning` devolve
nulo no aditivo, de propósito. Os deletes não ganharam nada (M6), e nasceu um buraco no botão vizinho
(N2).

**1.6 O de-para de auditoria da família de usuários alcança o produtor de raspão.** `ORIGENS`
(`frontend/src/js/admin/audit-phrases.js`) traduz `USER_DEMOTION` e `USER_DELETE`, e a linha em que
essa origem aparece é um `PERMISSION_REVOKE` escrito por `podarPorRaizes`, que **carimba** a OM. O
produtor lê o motivo da queda de uma concessão dele, e continua sem ver o ato que a causou, porque a
família de usuários não carimba OM nenhuma (M10).

**1.7 Trocar papel ou OM produtora de alguém avisa antes, com número real.**
`frontend/src/js/admin/producer-scope-phrases.js` (novo) e `verdictOfChange`, consumidos por
`frontend/src/js/admin/users-tab.js`: o número de antes é `live_grant_count`, carregado na própria
listagem, e o de depois é o que o servidor mediu. **É a tela do ADMINISTRADOR**: o produtor cujas
concessões caem não é avisado, e o espelho não tem teste (N3).

**1.8 O harness aprendeu a criar produtor com escopo, e há uma sessão de navegador como produtor.**
`createVerifiedUser({ role: 'producer', producerOrgSlug })`
(`frontend/tests/e2e-ui/helpers/accounts.js`), usada por
`frontend/tests/e2e-ui/resource-share-criar-grupo.spec.js`, que loga pelo formulário real. Até
2026-08-23 aquela camada só sabia criar `role='user'`.

---

## 2. O modelo, e a única coisa dele que muda o entendimento

O eixo de produção passa por uma pergunta só, `fn_can_produce_resource`: despacha por tipo sobre
cinco literais fechados, dá verdadeiro para o administrador, exige `role = 'producer'` mais escopo
mais **OM produtora ativa**, e compara a OM dona com o escopo. Recurso institucional (sem OM dona) e
recurso inexistente caem no mesmo falso, que é o que produz o "não encontrado" da cláusula 2.3. Os
gates de rota (`requireCatalogProducer` para o CRUD do catálogo, `requireResourceMaintainer` só para
a rota de visibilidade, ambos em `backend/src/middleware/resource-access.js`) são deliberadamente
GROSSOS: perguntam apenas "esta pessoa mantém alguma coisa?", e todo o recorte por OM mora no `WHERE`
da escrita, o que fecha a janela entre ler o dono e escrever.

**A LOTAÇÃO DE-AUTORIZA, MESMO NÃO AUTORIZANDO**, e continua verdadeira.
`fn_can_produce_resource` seleciona o usuário com
`LEFT JOIN organizations o ON o.id = u.organization_id` e exige `COALESCE(o.is_active, true) = true`.
A coluna é `users.organization_id`, que é **lotação**, e o estatuto diz em 1.4 e 10.5 que ela não
autoriza nada. Desativar a OM onde um produtor está apenas LOTADO devolve falso para todo recurso da
OM que ele MANTÉM, e o predicado roda antes do ramo do administrador, então morde o administrador
também. O comentário do arquivo defende a escolha como liveness e não autorização ("conta desativada
não age"), o que é defensável; colide com 1.4 e 10.5 assim mesmo, e vira pergunta ao dono.

**O MECANISMO DESCRITO NA AUDITORIA ESTAVA ERRADO, e a correção deixa o achado mais forte.** Ela
dizia que `fn_can_produce_resource`, `fn_has_global_data_access` e `fn_is_global_admin` herdavam o
termo de `fn_principal_vivo`. **Nenhuma das três o chama**: as três escrevem o par de linhas INLINE,
e `fn_principal_vivo` é uma quarta cópia, extraída depois e para o ramo de CONCESSÃO, que nunca
checava vivacidade. Quem procurar a chamada não a encontra. Com as cópias em JavaScript
(`CATALOG_PRODUCER_ACTOR` e `GRANT_REVOKER_ACTOR` em `backend/src/middleware/resource-access.js`,
`AUDIT_READER_ACTOR` em `backend/src/middleware/require-audit-reader.js`), o mesmo predicado está
escrito **sete vezes**, no eixo em que a constituição pede definição única.

**A consequência é 404, não 403, e o cliente não tem como saber.** O payload de sessão
(`FIND_USER_BY_ID` de `backend/src/modules/auth/auth.queries.js`, que é o que `GET /auth/me` usa, e
não o homônimo de `backend/src/modules/users/users.queries.js`) carrega `role` e um
`producer_org_id` cru, e **não faz junção nenhuma com a organização produtora**: sem nome, sem
`is_active`. Ver A2.

---

## 3. Onde há gate de tela, e onde não há

O mapa que organiza quase todos os achados. A divergência com o estatuto quase nunca está no
VOCABULÁRIO (não há `role !== 'user'` em gate nenhum dos dois pacotes, nem lista fechada de papel
global); está na COBERTURA e no RÓTULO.

| superfície | gate proativo | efeito para quem não alcança |
|---|---|---|
| porta "Catálogo" e as três abas | `adminAudience` (`frontend/src/js/admin/admin-audience.js`) | rótulo e abas por audiência, administrador testado primeiro |
| "Calibração 360" nas três barras | `mayCalibrate()` | some, e casa com o gate da página |
| página `calibracao.html` | `isAdmin()` ou `isProducer()` | redireciona ao mapa, **mudo** (M12) |
| editar/excluir item de catálogo | `sessionContext.canProduceFor(orgId)` | vira texto "Mantido por outra OM", correto |
| "Compartilhar" no cartão do mapa | `canShareResource` (por `shareable`, nunca por papel) | some, correto |
| revogar concessão, por linha | `revokeAvailability` (`frontend/src/js/catalog/grant-tree.js`) **(novo)** | vira texto dizendo quem pode revogar |
| **editar basemap legado com `previewVideo`** | **nenhum** | o botão abre e a gravação 422 (A3) |
| **abrir projeto 360 de outra OM** | **nenhum** | calibra e descobre no salvamento (C2) |
| **eixo Status nas quatro categorias** | **não existe eixo** | a legenda promete e não há controle (M1) |
| **enviar bundle 360** | **não existe tela** | capacidade real do servidor, sem porta (M5) |
| **ingerir modelo ou cena 3D** | **não existe rota** | só linha de comando no servidor (N1) |

---

## 4. Os achados que ficam

Reordenados por gravidade real. A numeração original fica entre parênteses.

### CRÍTICO

Os dois são o mesmo estrago por dois caminhos: **trabalho de calibração que o operador faz e nunca
consegue gravar.** É a única perda irreversível deste perfil, e mora numa página só.

#### C1 (C4) "← Projetos" descarta calibração não salva sem perguntar

`onBackToProjects: () => showProjectSelector()` (`frontend/src/js/calibration/app.js`), e
`showProjectSelector` começa por `teardownSubsystems()`. Não consulta `isDirty()`
(`frontend/src/js/calibration/state.js`). O botão vive em
`frontend/src/js/calibration/calibration-panel.js` e é o mais natural para quem terminou uma foto.
**Os outros três caminhos guardam**, o que torna a lacuna acidental: `navigateToPhoto` abre
`showDirtyDialog`, o `beforeunload` bloqueia o fechamento da aba, e `handleMarkReviewedAndNext` salva
antes. Irmão: o `startIdleWatch` de `frontend/src/js/calibration/calibracao-page.js` também não
pergunta nada.

**Correção.** Passar o mesmo `showDirtyDialog` que `navigateToPhoto` já usa.

#### C2 (C1) O estúdio lista projetos que o produtor não pode gravar, e nada os distingue

`fetchProjects` (`frontend/src/js/calibration/api.js`) lê por `GET /sv360/projects`, o eixo de
LEITURA. O produtor não entra em `fn_has_global_data_access`, então recebe os projetos da OM dele
mais **todo projeto público e habilitado de qualquer outra OM**. `publicProjectView`
(`backend/src/modules/streetview360/sv360.service.js`) só entrega `organization_id` ao administrador,
e o cartão de `showProjectSelector` não desenha OM nem `status` (o `status` chega no payload e a tela
não o usa). O operador abre projeto alheio, calibra (as leituras funcionam), e descobre no primeiro
salvamento.

**Por que crítico e não alto:** alinhar dezenas de fotos é trabalho de horas, e ele não pode ser
gravado em lugar nenhum. Não é um clique errado, é uma sessão inteira perdida.

**A superfície certa já existe e o produtor já a consome noutra aba:** `LIST_PROJECTS_ADMIN`
(`backend/src/modules/streetview360/sv360.admin.queries.js`) já é recortada por
`fn_can_produce_resource` e devolve `organization_id`, `status` e `access_level`.

**Correção.** Trocar a fonte da lista. Se o mural indiferenciado for desejado, `publicProjectView`
precisa entregar a OM também ao produtor, e o cartão precisa de selo de OM alheia mais o `status`.

### ALTO

#### A1 (C2 + C3) A recusa de escrita da calibração não chega, e quando chega mente

**Dois achados fundidos, porque são uma causa só:** o 403 do servidor não vira informação.

`handleSave` (`frontend/src/js/calibration/app.js`) usa `Promise.allSettled` e nunca inspeciona os
rejeitados, então a `CalibrationAuthError` vira rejeição anônima e o operador lê um toast genérico
dizendo que N de N alterações falharam e mandando tentar de novo. O diálogo bloqueante aparece uma
vez só, por trava de módulo; depois disso só resta o toast, e o motivo real fica no `console.error`.

E quando o diálogo aparece, afirma três coisas falsas: `MSG_403`
(`frontend/src/js/calibration/api.js`) diz que a conta não tem o papel de admin; `showRoleLostDialog`
(`frontend/src/js/calibration/app.js`) diz que ela não tem MAIS o papel admin, "que é o único que
calibra", e manda recarregar. O produtor não perdeu papel nenhum, `admin` não é o único que calibra
desde que o gate da própria página aceita `isProducer()`, e recarregar não muda nada. A mensagem
manda pedir a um administrador um papel que ele já tem. Nenhum teste prende essas strings.

**Correção.** Inspecionar os rejeitados do `allSettled`; nomear a causa real, que é a OM dona do
projeto; separar o caso de papel realmente perdido.

#### A2 (C7) A OM produtora desativada derruba tudo no servidor e não muda nada na tela

`fn_can_produce_resource` recusa quando a OM produtora está inativa, e `AUDIT_READER_ACTOR` derruba a
linha pelo mesmo termo. No cliente, `sessionContext.isProducer()` é
`globalRole === 'producer' && producerOrgId != null`, e `canProduceFor` deriva dele: nenhum dos dois
sabe se aquela OM está viva, e o payload de sessão não carrega o dado (seção 2). Resultado: a porta
"Catálogo" abre, `mayCalibrate()` mantém a calibração visível, Editar e Excluir continuam desenhados,
cada escrita volta **404** (o `WHERE` não casa, zero linhas viram "não encontrado") e a auditoria
volta 403. O selo ainda diz "Produtor", **com o UUID cru ao lado**: `config.organizacoesMilitares` é
servido por `listOrganizacoesMilitares` (`backend/src/modules/config/config.service.js`) com
`WHERE is_active = true`, a OM desativada some da lista, e `orgLabel`
(`frontend/src/js/admin/org-options.js`) cai no id bruto, que é o que as duas barras imprimem.

**Por que ALTO e não crítico:** não há perda de dado, e reativar a OM desfaz tudo. É o pior padrão de
recusa que existe (painel funcional negando tudo com a mensagem menos informativa possível), não uma
destruição.

**Correção.** O payload de sessão devolver a vivacidade da OM produtora, ou simplesmente `null` no
`producer_org_id` quando ela estiver inativa (o que já resolveria pelo `isProducer()`), mais uma
tarja dizendo o que houve e a quem recorrer.

#### A3 (C6) Um basemap gravado com `previewVideo` no `config` fica ineditável

`_renderResourceForm` (`frontend/src/js/admin/catalog-tab.js`) pré-preenche o textarea avançado com o
`config` inteiro; `CATEGORIAS_COM_VIDEO` não inclui `basemap`, então o campo de vídeo não é montado e
o `onSave` nunca remove a chave. `configSchemaSemPreviewVideo`
(`backend/src/modules/catalog/catalog.schemas.js`) responde 422 em qualquer edição, mesmo uma que só
mude o nome. Não há poda no servidor nem migração: o campo era aceito até 2026-08-23, quando o schema
de escrita era um só para as quatro tabelas.

**Por que ALTO e não crítico:** o alcance é o das linhas legadas, não do produto. Ainda assim o
produtor não conserta pela interface, e nada na tela sugere apagar a chave à mão do JSON.

**Correção.** No ramo de basemap, remover `previewVideo` antes de serializar, com uma linha dizendo
que o campo foi descartado por não valer para mapa base.

#### A4 (A5) `calibracao.html` é a página do produtor, e é a única sem identidade e sem saída

`frontend/src/js/calibration/calibracao-page.js` não monta `createAppBar`, e `calibracao.html` não
tem cabeçalho: zero ocorrências de barra, selo de papel, nome de OM ou "Minha conta" em toda a pasta
`frontend/src/js/calibration/`.

**Correção de redação frente ao original:** o botão "← Projetos" EXISTE. O que ele não faz é sair da
calibração, porque volta ao seletor interno. As únicas navegações para fora são o `onLeave` do
diálogo de papel perdido e o `endSession`, que é fim de sessão involuntário. Não há gesto de voltar
ao mapa nem aos atlas.

**Correção.** Montar a mesma barra de `atlas.html` e `admin.html`, o que resolve identidade e saída de
uma vez.

#### A5 (A2) O produtor privatiza numa página e concede noutra, e o chip do mapa pode nunca nascer

`frontend/src/js/admin/catalog-tab.js` não abre `showResourceShareModal` em lugar nenhum: os dois
chamadores em todo `frontend/src/` são `frontend/src/js/catalog/catalog.modal.js` e
`frontend/src/js/base-layer-selector/base-layer-selector.control.js`, ambos dentro do mapa.

**A metade que agrava é a segunda:** o chip "Catálogo" do mapa é decidido uma vez no boot por `init()`
(`frontend/src/js/sidebar/components/chips.component.js`), a partir de `CatalogService.hasItems()`, e
o componente só assina `UI_LAYOUT_CHANGED`. Numa instalação de catálogo público vazio, o produtor que
entra depois do boot fica **sem chip e sem porta nenhuma** até recarregar.

**Correção.** Reavaliar o chip em `SESSION_CHANGED`, e, melhor, dar à aba "Catálogo" um botão de
compartilhar por linha. O impedimento técnico do segundo é real (o modal arrasta o motor de sync para
uma página que boota sem a store) e é a pergunta 5 da seção 8.

#### A6 (A7) "Minha conta" só é alcançável do mapa, e SEIS comentários dizem o contrário

`showAccountSettingsModal` tem um chamador só em `frontend/src/`,
`AccountControl._handleOpenAccountSettings`. `createAppBar` não oferece a entrada. Para o produtor,
cuja casa é `admin.html` e `calibracao.html`, trocar a senha ou gerar a chave de API exige abrir o
mapa e esperar o bundle.

**A afirmação falsa está em mais lugares do que o original dizia**, e foram contados um a um: o
`@fileoverview` de `frontend/src/js/modals/account-settings.model.js`; um comentário de import e o
docblock de `rankOptions` em `frontend/src/js/modals/account-settings.modal.js`; e um comentário em
cada um dos três CSS de página (`frontend/src/css/style.css`,
`frontend/src/css/projects-page.css`, `frontend/src/css/admin-page.css`). Seis afirmações de
alcançabilidade inexistente, em arquivos que agentes leem como verdade.

**Correção.** Uma ação em `createAppBar` gateada por `sessionContext.isAuthenticated()`, com o mesmo
`import()` dinâmico; ou corrigir os seis, se a ausência for deliberada.

### MÉDIO

#### M1 (A3) A legenda da aba promete um eixo "Status" que não existe

O texto do não-administrador em `_build` (`frontend/src/js/admin/catalog-tab.js`) diz que Acesso,
Status (Ativo/Inativo) e os metadados são dele. Não há coluna nem botão de status nas quatro
categorias de `resources`: os schemas de escrita não aceitam `active`, a listagem filtra por
`active = true`, e `deleteCatalogItem` é o único que escreve a coluna. O único caminho para "Inativo"
é Excluir, e o de volta é recriar com o mesmo id, que o produtor não descobre mais porque a linha
sumiu da listagem. Só o 360 tem o eixo de verdade.

#### M2 (A1) Não há como escolher o prazo de uma concessão

`_handleGrant` e `_handleGrantGroup` (`frontend/src/js/catalog/resource-share.modal.js`) montam o
payload sem `expiresAt`. Varredura em `frontend/src/`: **zero produtores do valor**, só a assinatura
no JSDoc do cliente HTTP. O servidor aceita e honra com `LEAST(...)`
(`backend/src/modules/resource-access/resource-access.queries.js`). A cláusula 3.4 fala em teto E
padrão; a interface entrega só o padrão de um ano.

#### M3 (A4) Não há como rebaixar o nível de uma concessão, e a tela não diz isso

O nível é um `<span>` estático em `_renderGrantItem`; o `<select>` vale só para a PRÓXIMA concessão.
No servidor não há `PATCH` de grant: as rotas de
`backend/src/modules/resource-access/resource-access.routes.js` são listar visíveis, mudar
visibilidade, listar concessões, conceder e revogar. Passar alguém de "ver e compartilhar" para "ver"
exige revogar, o que poda toda a subárvore (cláusula 3.5), e conceder de novo. `revocationWarning`
(`frontend/src/js/catalog/grant-tree.js`) nomeia a cascata e nada diz sobre rebaixamento.

#### M4 (A6) Sem projeto 360, a calibração é uma tela morta

`showProjectSelector` monta a grade sem ramo de lista vazia, então rende um contêiner vazio sob a
instrução para selecionar um projeto. Nada aponta o caminho de ingestão. A explicação existe, mas na
outra página: `_render360List` (`frontend/src/js/admin/catalog-tab.js`) diz que o envio do bundle é
feito fora do painel.

#### M5 O regime de escopo muda entre sub-abas, sem busca e sem aviso

3D, dados, análise e basemap vêm de `listCatalog` (acervo público inteiro mais o privado dele, a
maioria das linhas com "Mantido por outra OM" no lugar dos botões); 360 vem de `LIST_PROJECTS_ADMIN`
(só a OM dele). "Nenhum item nesta categoria" significa coisas diferentes nas duas.
`_renderResourceList` monta a tabela inteira: sem busca, sem filtro "só os meus", sem ordenação, sem
paginação. E o subtítulo fixo da aba fala em recursos globais, que é a descrição do administrador
(era o M4 original, absorvido aqui). **Junte a capacidade sem porta:**
`POST /sv360/admin/projects/upload` (`backend/src/modules/streetview360/sv360.routes.js`) aceita
produtor por `requireUploadCapability` e força a OM dele em `resolveUploadOrgId`, com zero
ocorrências no cliente. Capacidade real, sem tela, mas honestamente declarada na nota.

#### M6 A confirmação de excluir item de catálogo é a mais fraca do painel

`_deleteResource` chama `showConfirm` **sem `message`**: não diz que é irreversível pela interface,
nem quantos atlas referenciam o recurso, nem que concessões caem. `_delete360` tem a mesma forma.
Compare com `groupDeletionWarning` (`frontend/src/js/admin/group-phrases.js`), que nomeia pessoas,
recursos e atlas antes do clique. O relato depois não traz número. **O lote confirmou a privatização
e não tocou nos dois deletes.**

#### M7 A privatização confirmada pode não acontecer, em silêncio

Em `onSave` a ordem é confirmar, gravar o item, e só então chamar a visibilidade. Se a primeira
escrita falha, a função retorna com a mensagem de falha ao salvar e a privatização recém-confirmada
não roda. Falha fechado, que é a direção certa, e a mensagem não diz que os dois atos eram um.
**Agravante lido nesta revisão:** o cancelamento reverte o `<select>` e o erro de gravação não, então
a tela fica exibindo `private` sobre um servidor que continua público. A assimetria incomoda porque o
erro da chamada de visibilidade tem mensagem dedicada para não ser confundido, e o caso inverso não
tem cuidado nenhum.

#### M8 Mudar só a visibilidade exige reescrever o item inteiro

No 360 é botão de linha (`_toggle360Access`); nos quatro tipos de catálogo o `<select>` está dentro
do formulário de edição, cujo `onSave` reescreve nome, descrição, ordem, `config` inteiro, miniatura
e o campo de vídeo.

#### M9 A aba "Auditoria" nunca diz que a trilha é recortada à OM

O subtítulo de `_esqueleto` (`frontend/src/js/admin/audit-tab.js`) é um literal fora de qualquer
ramo. O servidor manda `escopoOrgId` na resposta exatamente para isso (`listAudit`,
`backend/src/modules/audit/audit.service.js`, cujo comentário já admite que o campo não tem leitor),
e a única ocorrência do nome em `frontend/src/` é uma linha de JSDoc no cliente HTTP. O produtor
nunca sabe de qual OM é o recorte.

#### M10 (M3) Metade dos filtros de auditoria é estruturalmente vazia para o produtor

`target_org_id` só é carimbado por catálogo, acesso a recurso e 360. Varredura refeita:
`backend/src/modules/users/users.service.js` escreve dez linhas de trilha (`USER_CREATE`,
`ROLE_CHANGE`, `PRODUCER_SCOPE_CHANGE`, `USER_UPDATE`, `USER_DELETE` e as demais) e **não passa OM em
nenhuma**; idem organizações, config, grupos e sharing (atlas passa nulo de propósito, com o motivo
escrito: atlas não tem OM dona). Dos dez tipos de alvo, cinco nunca devolvem linha. O caso mais
desconcertante continua: **ele administra grupos na aba ao lado e os atos dele sobre grupos não
aparecem na trilha dele.**

#### M11 (M9) O logout apaga o catálogo privado sem confirmar e sem avisar

`SyncEngine.logoutAndDisconnect` (`frontend/src/js/store/sync/sync-engine.js`) chama
`clearVisibleResources()` duas vezes, descartando a soma aditiva de `refreshVisibleResources`,
inclusive os recursos que o produtor enxerga **por produção**. `AccountControl._handleLogoutGesture`
dispara direto no clique. Os únicos avisos daquele caminho são sobre trabalho não sincronizado. Pode
ser decisão (é reversível: basta entrar de novo), e é a pergunta 8.

#### M12 (PARCIAL, do M10 original) O gate da calibração recusa em silêncio e perde o parâmetro

**A metade da credencial saiu** (item 1.1). **Fica a outra:** `initCalibracaoPage`
(`frontend/src/js/calibration/calibracao-page.js`) faz `window.location.replace(MAP_URL)` sem
`?sessao=`, então não explica nada, não oferece login, e perde um eventual `?photo=` que trouxe o
operador até ali. É o mesmo desfecho para quem não tem o papel e para quem está deslogado.

#### M13 (PARCIAL, do M11 original) A OM produtora imprime UUID cru quando desativada

**A metade "a OM não aparece" saiu** (item 1.2). **Fica a divergência de queda, e ela alcança mais
telas do que antes:** `orgLabel` cai no id bruto, e agora são as DUAS barras que o chamam com
`orgLabel(orgId, '')`. `organizationName` (`frontend/src/js/modals/account-settings.modal.js`) cai em
string vazia e o chamador escreve que a OM está fora da lista de ativas. A tela que menos aparece
acerta, e as duas que aparecem sempre erram. É exatamente o caso do A2.

#### M14 (M15) O produtor não distingue, no mapa, o que é da OM dele

`createCatalogCard` (`frontend/src/js/catalog/components/catalog-card.js`) desenha o selo "Privado" e
nada sobre OM dona, e o rodapé oferece abrir, prever e compartilhar, sem atalho para editar no
painel. Ele reencontra o item pelo nome, do outro lado do aplicativo. A ausência do dado tem razão
declarada no arquivo (o documento de `/api/config` é público), o que faz do achado uma questão de
navegação, não de payload.

### BAIXO

- **B1 (M2/M4)** Duas notas de auditoria escritas para o administrador: o `_toolbar` de
  `frontend/src/js/admin/audit-tab.js` acrescenta **incondicionalmente** a ressalva sobre "a OM de
  cada linha", enquanto o filtro de OM e a coluna de OM são ambos gateados por `this._administra`. O
  produtor lê um aviso sobre uma coluna que a tela dele não tem.
- **B2** O produtor perde a identidade em dois regimes. Abaixo de 900px,
  `frontend/src/css/app-bar.css` esconde `.app-bar__username` **e** `.app-bar__role` juntos, então em
  `atlas.html` e `admin.html` somem o nome e o selo. E a frase de `GLOBAL_ROLE_DESCRIPTIONS` é só o
  atributo `title` nas duas barras, invisível no toque: em tela pequena com dedo, ele não vê quem é
  nem lê o que o papel significa.
- **B3 (M12)** `_renderDenied` (`frontend/src/js/catalog/resource-share.modal.js`) afirma causa
  única, dizendo que a pessoa recebeu o recurso apenas para ver. É falso para o produtor cujo escopo
  mudou entre o desenho do cartão e o clique, e para quem abriu recurso de outra OM: nenhum dos dois
  recebeu coisa alguma.
- **B4 (M13)** O recorte "só os seus grupos" só é dito nos estados marginais
  (`groupPickerEmptyNotice` e `groupPickerExhaustedNotice`,
  `frontend/src/js/admin/group-phrases.js`). No estado normal o `<select>` não diz nada. Compare com
  `_renderGroupPicker` (`frontend/src/js/modals/sharing.modal.core.js`), que carrega a frase no
  estado normal, sob o seletor cheio.
- **B5 (B1)** Ícones e subtítulo de administrador para o produtor: `AdminPanel._buildHeader`
  (`frontend/src/js/admin/admin-panel.js`) usa escudo e subtítulo fixos, e
  `frontend/src/js/account/account.control.js` monta o botão com o ícone de administração e depois
  troca **só o nó de texto** para "Catálogo".
- **B6 (B3)** A nota acima da tabela 360 fala em status e exclusão para uma tabela que hoje tem
  QUATRO ações de linha: ativar/desativar, público/privado, vídeo e excluir. Duas não são anunciadas.
- **B7 (B4, PARCIAL: metade estava errada na origem)** Nem "Auditoria" nem "Catálogo" oferecem
  "Tentar de novo" na falha de rede. **Mas a comparação do original era falsa:** `emptyState`
  (`frontend/src/js/admin/admin-dom.js`) recebe mensagem e dica e **não tem botão nenhum**, e
  `frontend/src/js/admin/groups-tab.js` falha igual às outras duas, usando `emptyState` só para
  resultado VAZIO. O padrão a copiar são os dois modais, com retentativa escrita à mão:
  `frontend/src/js/catalog/resource-share.modal.js` e `frontend/src/js/modals/sharing.modal.core.js`.
- **B8 (B5)** Na calibração os erros chegam crus e em inglês, o toast de falha dura os mesmos 3
  segundos do de sucesso, e o cartão de erro de `showProjectSelector` faz `innerHTML` com a mensagem
  do erro sem escapar, enquanto o nome do projeto na linha acima É escapado. Não é XSS explorável
  hoje, e é a assimetria que a regra de lint da casa existe para evitar (ela não pega porque o léxico
  dela é `nome` e `descricao`).
- **B9 (B6)** Ramo morto: o texto "Mantido por outra OM" em `_render360Table` é inalcançável, porque
  `LIST_PROJECTS_ADMIN` já filtrou por produção. A cópia gêmea em `_renderResourceTable` É
  alcançável, porque a listagem de `resources` filtra por acesso. Dois ramos idênticos, um vivo e um
  morto.
- **B10 (B7)** A lista de concessões não mostra a data de criação, embora `created_at` chegue no
  payload e seja o critério de ordenação da consulta.
- **B11 (B8, PARCIAL)** **A primeira metade saiu:** o censo da credencial virou derivado. **Fica a
  segunda:** o guarda das hidratações de sessão em `frontend/tests/unit/session-context.test.js` é
  lista literal de cinco caminhos com asserção de tamanho cinco, não censo por `git ls-files`. Um
  sexto sítio nasce sem reprovar nada, e é a divergência que `sessionUserInfoFromMe` existe para
  impedir: a mesma fragilidade que a suíte irmã acabou de pagar.
- **B12 (B9)** `frontend/src/js/admin/catalog-tab.js` é a única das três abas do produtor fora da
  convenção de `@utils/event-cleanup.js`: `setupCleanup` aparece em
  `frontend/src/js/admin/audit-tab.js` e `frontend/src/js/admin/groups-tab.js` e não nela, cujo
  `mount` só devolve uma função que apaga uma bandeira. É a aba em que ele passa mais tempo.
- **B13 (B10)** O cartão do seletor renderiza `p.location`, nulo por contrato (`publicProjectView`
  documenta que a coluna não existe), então a linha nunca aparece.
- **B14 (B11)** Os atos em lote da calibração usam `window.confirm` nativo. **Correção de contagem:
  são QUATRO, não três**, três em `frontend/src/js/calibration/calibration-panel.js` (lote de faixa,
  lote de projeto, reset de revisões) e o quarto em `frontend/src/js/calibration/app.js` (remover
  conexão manual). O obstáculo de arquitetura não se aplica:
  `frontend/src/js/modals/confirm.modal.js` importa só `@utils/event-cleanup.js`.

---

## 5. Achados NOVOS

#### N1 (ALTO) A ingestão do acervo 3D não tem rota nenhuma, e a irmã 360 tem

**É o buraco de escopo que espelha o M5, e é o maior dos dois.** A auditoria encontrou que o envio de
bundle 360 não tem tela e passou reto pela ingestão do acervo 3D, que não tem sequer servidor.

`backend/src/modules/nomes/assets3d.routes.js` é o roteador inteiro do acervo, e tem **uma linha**:
um `GET` com `gateDeAsset3d`. O módulo `backend/src/modules/models3d/` não tem arquivo de rotas nem
controlador, e seus únicos importadores em `backend/src/` são o cache de config e o controlador de
leitura. As rotas de escrita 3D que existem são as do CRUD de catálogo (`tilesets`), cujo corpo tem
cinco chaves e nenhum arquivo: criam a LINHA que aponta para um modelo, e não fazem o modelo existir.

O caminho real é linha de comando no servidor: `models3d:importar`, `models3d:importar-glb`,
`models3d:importar-cena`, `models3d:adotar` e os demais scripts de `backend/scripts/`, mais
`backend/scripts/assets3d-import.js`. **Eles não têm gate algum**: nem sessão, nem papel, nem
`fn_can_produce_resource`. `backend/scripts/models3d-adotar.js` escreve a própria linha de catálogo,
então esse caminho contorna `requireCatalogProducer` por inteiro e pode carimbar qualquer OM dona.

O contraste dá a medida: o 360 tem `POST /sv360/admin/projects/upload`, autenticada, com
`requireUploadCapability` aceitando o produtor e a posse por OM imposta depois em
`resolveUploadOrgId`. **Os dois acervos que a mesma cláusula entrega ao produtor são ingeridos por
regimes inteiramente diferentes.**

**Ressalva, para não superdeclarar:** a cláusula 2.4 fala em manter "as linhas de catálogo", então o
estatuto não promete ingestão. O achado não é violação de cláusula: é que a manutenção do acervo 3D
pelo produtor é NOMINAL, porque ele edita metadado de um conteúdo que só um operador com shell no
servidor põe lá, apaga ou substitui. Ver `docs/wiki/acervo-3d-convertido.md` e
`docs/wiki/ingestao-projetos-360.md`.

#### N2 (MÉDIO) Desativar um projeto 360 esconde-o de todo mundo e não confirma nada

O lote deu confirmação à privatização e deixou o botão vizinho sem nenhuma. `_toggle360`
(`frontend/src/js/admin/catalog-tab.js`) chama a rota de status e mostra o sucesso, sem
`showConfirm`. O comentário do próprio arquivo diz que `disabled` oculta o projeto de todo mundo fora
da OM dona, ou seja, é escrita mais destrutiva que a privatização, que pergunta com um parágrafo. A
inconsistência que o docblock de `_toggle360Access` diz ter consertado passou a viver um botão ao
lado.

#### N3 (MÉDIO) O aviso que protege as concessões do produtor é espelho sem teste, e o produtor não é avisado

`verdictOfChange` (`frontend/src/js/admin/producer-scope-phrases.js`) reimplementa a decisão de
`fundamentoDeRaizPerdido` (`backend/src/modules/users/users.service.js`) para saber se pede
confirmação. O próprio `@fileoverview` declara que não há teste ligando os dois lados e explica por
quê (o precedente da casa importa os dois arquivos no mesmo processo, e aqui o lado do servidor puxa
banco e bcrypt). Se o servidor mudar o predicado, o administrador volta a destruir as concessões de
um produtor com um toast dizendo que o usuário foi atualizado, que é o defeito que a fatia existiu
para fechar. `frontend/tests/unit/escopo-de-producao-frases.test.js` cobre as frases, não o par.

**A segunda metade é de perfil:** quem é avisado é o ADMINISTRADOR que edita. O produtor cujas
concessões caem não recebe nada, nem antes nem depois, e a trilha dele não mostra o ato que as
derrubou (M10). Ele descobre pelo beneficiário reclamando.

#### N4 (BAIXO) O gate de revogar lê o papel do token, e o servidor lê do banco

`revokeAvailability` (`frontend/src/js/catalog/grant-tree.js`) decide por
`grant.granted_by === userId` ou `sessionContext.isAdmin()`, este vindo do JWT. O servidor
(`GRANT_REVOKER_ACTOR`) resolve o papel no banco e exige **também** conta e OM de lotação ativas. Um
administrador rebaixado com token ainda válido continua vendo o botão e continua levando 403. A
janela é a do access token, e o próprio arquivo declara que não é fronteira de segurança: higiene,
não risco.

---

## 6. Achados que SAÍRAM

Não se apaga o registro: quem ler daqui a três meses precisa saber que aquilo já foi olhado.

- **C5 (era crítico) "Remover acesso" era desenhado em toda linha e o servidor recusava a maioria
  delas.** Resolvido pelo caminho proposto: `_renderGrantItem`
  (`frontend/src/js/catalog/resource-share.modal.js`) consulta `revokeAvailability`
  (`frontend/src/js/catalog/grant-tree.js`), que aprova só o administrador ou quem concedeu,
  exatamente os dois ramos de `GRANT_REVOKER_ACTOR`, com o concedente nulo falhando FECHADO dos dois
  lados; no lugar do botão entra `revokeBlockedNotice`, dizendo a quem pedir. *(Residual em N4.)*
- **M14 (era médio) O e-mail da conta era invisível e imutável.** Resolvido, e além do pedido:
  `FIND_USER_BY_ID` (`backend/src/modules/users/users.queries.js`) projeta `email` e
  `email_verified`, nasceu `PUT /users/me/email` exigindo a senha atual, e a tela mostra os dois por
  `emailPresentation`. *(O que sobra, o campo de e-mail no painel, é do relatório do administrador.)*

---

## 7. O que está BOM e não deve ser mexido

Não é cortesia: são decisões que uma "simplificação" futura desfaria. Os dez itens foram
reconferidos contra o código nesta revisão; dois mudaram e estão anotados.

1. **`adminAudience` como definição única da porta.** Pura, com **zero imports** (contrato declarado
   no cabeçalho), administrador testado PRIMEIRO com o motivo escrito (um admin que também produza
   cairia no ramo do produtor e perderia três abas), rótulo que nomeia o que a pessoa RECEBE
   ("Catálogo") e nunca a página, e abas recortadas no cliente para não baterem num gate já na
   montagem. Cinco consumidores em `frontend/src/` e dois em testes. Conferido: **nenhuma chamada de
   rede feita na montagem das três abas do produtor exige administrador.**
2. **O produtor entra em `canShareResource` pelo `shareable`, não por papel.**
   `frontend/src/js/store/sync/resource-access.service.js` continua com três linhas e sem ramo de
   produtor: o servidor passou a mandar os ids produzidos dentro de `shareable`, alimentado por
   `fn_produced_private_resource_ids`, e o índice existente os absorveu. O cliente segue sem saber de
   qual OM é cada item, que é a resposta certa para uma pergunta que o servidor responde melhor.
3. **O carimbo de `owner_org_id` nunca vem do corpo.** `createCatalogItem` o força a partir do escopo
   do chamador, lido do BANCO pelo middleware, e o schema de criação tem cinco chaves onde a coluna
   nem cabe. A metade sutil, lida agora: o ramo de **ressurreição** deixa `owner_org_id` fora do
   `SET`, senão ressuscitar um item como administrador (escopo nulo) viraria transferência silenciosa
   para o acervo institucional.
4. **Os avisos de retirada de acesso.** `visibilityChangeWarning`
   (`frontend/src/js/catalog/visibility-phrases.js`) devolve nulo no sentido aditivo, para não
   treinar o operador a confirmar sem ler; `visibilityChangeSummary` relata o EFEITO e não o sucesso
   da chamada; e a ausência de número é justificada por medição no cabeçalho. Idem `revocationWarning`
   e `frontend/src/js/catalog/grant-tree.js`, que nomeiam a cascata ANTES do clique e corrigem o
   número DEPOIS. **Reforçado desde a auditoria:** a contagem de dependentes é a travessia que já
   leva o resgate em conta, não o fecho ingênuo.
5. **A aba "Grupos" inteira.** Sem um único ramo por papel (o recorte é do servidor),
   `Promise.allSettled` para as duas listagens falharem independentemente, contagens relidas para não
   citar número velho, degradação declarada, e o dono recebendo nota explicativa em vez de um botão
   que levaria 409. **Correção frente ao original:** ela NÃO é melhor que as irmãs na falha de rede
   (B7).
6. **"Minha conta" na parte da chave de API e da senha.** O aviso de que a chave carrega exatamente
   as permissões da pessoa, sem prazo e sem escopo reduzido, cumpre a cláusula 10.7 no texto; a chave
   é revelada uma vez, com confirmação destrutiva ao rotacionar, guarda ao fechar sem copiar, e o
   estado de copiado só vira verdadeiro numa escrita de clipboard bem-sucedida. O aviso de senha diz
   "inclusive esta", que é a verdade medida contra a revogação de todos os tokens.
7. **`frontend/src/js/ui/role-labels.js`.** Zero imports (contrato, para as três páginas sem mapa),
   papel desconhecido aparece cru com uma frase que admite o desconhecimento em vez de virar
   "Usuário", e a descrição do produtor nomeia o eixo em que ele age. **Mudou para melhor, e o item
   precisa ser reescrito:** a comparação com o rótulo da aba de usuários era um espelho, e ele foi
   APOSENTADO porque aquele mapa passou a ser DERIVADO desta fonte;
   `frontend/tests/unit/papel-global-rotulos.test.js` assere a derivação e que nenhum rótulo literal
   reapareceu na aba. Divergir deixou de ser alcançável, que é melhor que ser detectável.
8. **A separação lotação / OM produtora na tela.** Nenhuma barra lê a lotação para autorizar; a única
   tela que mostra as duas as separa por rótulo, por origem e por uma nota que diz quem muda o quê.
   Depois de a coluna de papel por OM ter saído do código, é isso que impede a confusão de voltar.
   *(O que ainda mistura os dois é o SQL, e é achado: seção 2.)*
9. **A aba "Auditoria" obedecer ao servidor.** A bandeira de administração nasce falsa para não
   piscar a coluna de OM, os parâmetros apagam a OM pedida por quem não administra, e a tela lê a
   bandeira da RESPOSTA em vez de deduzir o papel da sessão. Do lado do servidor, `listAudit` levanta
   em vez de listar tudo quando o escopo falta, que é falhar fechado.
10. **A escada de erro do 360.** `enforceProjectWritable`
    (`backend/src/modules/streetview360/sv360.write.service.js`) responde 404 quando o projeto nem é
    legível e 403 quando é legível e não gravável; e o `loadWritableProject` DAQUELE arquivo (há um
    homônimo em `backend/src/modules/streetview360/sv360.admin.service.js`, que não recebe atlas
    nenhum) passa atlas nulo de propósito, para que empréstimo de atlas amplie leitura e nunca
    escrita. `rebuildPhotoShape` carrega a mesma decisão pelo mesmo motivo, escrito.

Do inventário original continua valendo, sem precisar de item próprio: no MAPA o produtor é um
usuário comum, o eixo por atlas é gateado por hierarquia (`permissionRank` e `hasAtLeast`,
`frontend/src/js/projects/permission-levels.js`) e nunca por lista fechada, o recurso privado da OM
dele aparece no catálogo do mapa pela soma aditiva de `refreshVisibleResources`, e o empréstimo ao
atlas resolve porque a produção entrou como termo próprio na disjunção de `fn_granted_resource_ids`
(cláusula 6.4).

---

## 8. Perguntas em aberto que só o dono decide

As oito da auditoria continuam sem resposta, e nasceu uma nona.

1. **A lotação deve de-autorizar?** (seção 2) Se "não deve", o termo sai de **quatro sítios em SQL e
   três em JavaScript**, porque foi escrito sete vezes em vez de uma. Se "deve", a constituição
   merece uma frase dizendo que a lotação não autoriza mas revoga.
2. **A calibração deve mostrar o acervo do Exército inteiro ou só a OM do produtor?** A correção do
   C2 muda conforme a resposta.
3. **O produtor deve poder conceder por menos de um ano?** Ou entra um campo de data, ou a cláusula
   3.4 merece dizer que o prazo é fixo (M2).
4. **O eixo Status deve existir para as quatro categorias, como no 360?** Ou o eixo nasce, ou a
   legenda muda (M1).
5. **A aba "Catálogo" deve ganhar o botão de compartilhar?** (A5) A saída provável é um modal enxuto
   para a página de administração, e isso é trabalho, não ajuste.
6. **Os atos do produtor sobre grupos devem aparecer na trilha dele?** (M10) A cláusula 9.2 fala em
   recursos produzidos, então o comportamento é literal; a experiência é a de um filtro que existe
   para provar lista vazia.
7. **"Minha conta" deve estar nas páginas sem mapa?** (A6) Ou a entrada nasce em `createAppBar`, ou
   os seis comentários são corrigidos.
8. **O logout deve confirmar?** (M11) **Nota nova:** para o perfil `user` o dono já decidiu que a
   saída não pergunta nada, e a razão dele (o sincronismo ocorre sempre, logo não há vontade a
   respeitar) NÃO se aplica aqui, porque o que se perde não é fila e sim visibilidade de catálogo.
9. **O produtor deve poder INGERIR o acervo 3D que mantém, ou a manutenção dele é de metadado por
   desenho?** (N1) A resposta decide se nasce uma rota de ingestão 3D com o gate que o 360 já tem, ou
   se a cláusula 2.4 ganha uma frase dizendo que os bytes são trabalho de operador de servidor.

---

## Nota de método

Nenhum arquivo de código foi modificado, nenhum commit foi feito, e o único arquivo escrito foi este.
As afirmações do servidor foram conferidas nos módulos de catálogo, acesso a recurso, auditoria, 360,
3D, usuários e autenticação de `backend/src/`, mais os predicados SQL e os scripts de
`backend/scripts/`; as do cliente, lendo os arquivos citados. Onde se afirma ausência (por exemplo,
"zero ocorrências do envio de bundle em `frontend/src/`"), a afirmação vem de varredura sobre a pasta
inteira.

Duas ressalvas de alcance, para não superdeclarar:

- **Este arquivo não está sob nenhum guarda.** `frontend/tests/unit/docs-integridade.test.js` varre
  `docs/`, `.claude/` e uma lista de alvos escrita à mão, e a raiz do repositório fica de fora.
  Caminho e símbolo citados aqui não são verificados por teste nenhum: que estivessem todos certos na
  conferência de hoje é resultado de leitura mais uma checagem replicada à mão, não propriedade
  mecânica. Se o conteúdo for adotado, o destino é a wiki.
- **Nada aqui foi verificado por captura de tela.** Todos os vereditos são de leitura de código. Os
  achados que dependem de aparência (o UUID cru no selo, a grade vazia da calibração, a tarja que
  falta) são deduções corretas do código, não observações do produto rodando, e nenhuma spec de
  Playwright cobre qualquer achado desta lista.
