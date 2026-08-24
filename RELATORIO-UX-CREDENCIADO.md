# Relatório de UX: o perfil CREDENCIADO

Perfil avaliado: conta com papel GLOBAL `credenciado`, o que lê todo recurso privado do acervo e
concede acesso a ele sem editá-lo. [`CONSTITUICAO.md`](CONSTITUICAO.md) é a especificação de
referência.

**Auditoria original: 2026-08-23.** 18 achados numerados, 4 divergências entre estatuto, documento e
código, um inventário de 39 ações e 7 perguntas ao dono.

**Revisão: 2026-08-24.** Um lote grande entrou desde então (commit 76dbe93d, árvore de trabalho
limpa), e este documento foi reescrito para separar o que saiu do que fica.

**Baixa contra `b0e66b77` (o lote do produtor), 2026-08-24: nenhum achado SAIU, mas DOIS encolheram.**
Dez achados deste relatório citam arquivos que aquele commit tocou, e os dez foram reabertos contra o
código. O A4 perdeu a ponta do campo de prazo e o B1 perdeu a metade da moldura do painel, os dois
por efeito colateral de trabalho feito para outro perfil. Os oito restantes estão intactos, o
crítico C1 inclusive: `refreshVisibleResources` continua best-effort, com o retorno descartado
pelos três chamadores e sem tela que ofereça `retryVisibleResources`.

**A observação da baixa anterior fica REFORÇADA, e ela é o que decide prioridade:** este perfil não
recebe conserto de graça. Em dois lotes seguidos, feitos sobre os perfis vizinhos, ele ganhou duas
metades de achado BAIXO e nada mais.

**Baixa contra `59e9600c`, 2026-08-24: NENHUM achado saiu, e esse é o resultado que importa.** A
revisão acima foi escrita em `11150029`; o commit seguinte fechou 23 achados do perfil de usuário
comum e passou por 85 arquivos. Cinco achados deste relatório citam arquivos que ele tocou, e os
cinco foram reabertos contra o código: os cinco continuam de pé. **Dos quatro perfis, este é o mais
isolado do trabalho recente**, e a razão é estrutural, não acidental: as telas do credenciado são o
modal de compartilhamento, a árvore de concessões e a aba Grupos, e nenhuma das três é tela do
usuário comum. Ele não herda conserto de ninguém.

Os cinco conferidos, e por que cada um continua aberto:

- **C1** `frontend/src/js/store/sync/sync-engine.js` mudou, mas só para `clearLocalEditMarks` no
  fim de atlas e de sessão. `refreshVisibleResources` continua best-effort, o retorno continua
  descartado pelos três chamadores, e nenhuma tela oferece `retryVisibleResources`.
- **A2** `backend/src/utils/mailer.js` mudou, e na direção oposta a este achado: o que ganhou
  correção foi a frase da senha do e-mail de cadastro. Não existe e-mail de concessão.
- **A3** `frontend/src/js/store/sync/api-client.js` mudou em pontos de sessão. Continua sem rota de
  inventário do que este perfil concedeu.
- **B1** `frontend/src/js/account/account.control.js` mudou bastante, e o menu passou a gatear por
  sessão em vez de nome de usuário. O defeito deste achado é outro e continua: o botão nasce com o
  texto "Administração" e só depois `_updateAdminVisibility` o reescreve.
- **B3** é a nota fora de escopo, e as ocorrências que ela anota mudaram de vizinhança sem mudar de
  natureza.

## Como esta revisão foi feita

Cada achado foi reaberto **contra o código**, não contra a lista de commits. Onde este documento diz
RESOLVIDO, o arquivo foi aberto e o símbolo, procurado; onde diz INTACTO, a varredura foi refeita.

A conferência achou as três categorias esperadas, e as duas últimas foram as produtivas: um achado
resolvido pelo caminho exato que a auditoria propôs, um resolvido **pela metade** cuja parte fechada
esconde a parte aberta, e um achado que **estava errado na origem**, por tratar como defeito um
marcador que se declara marcador.

Além disso, esta revisão fecha três defeitos de FORMA do documento anterior: cinco remissões internas
apontavam para números de achado que não existiam, uma migração era citada por número, e um achado era
briga de documento contra documento, não UX.

## Placar

| | |
|---|---|
| itens conferidos | 22 (18 achados numerados + 4 divergências) |
| saíram (resolvidos, ou retirados por estarem errados) | 2 |
| ficam | 17, dos quais 1 é parcial |
| achados NOVOS, nascidos da revisão | 1 |
| **baixa contra `59e9600c`: saíram** | **0** |
| **em vigor hoje** | **18** |

Gravidade dos 18 que ficam (17 antigos + 1 novo), **reordenada por gravidade real** e não pela
numeração antiga: 1 crítico, 5 altos, 9 médios, 3 baixos.

O CRÍTICO original saiu, e outro entrou no lugar por promoção. **A troca é o resumo do relatório:** o
que era a pior falha (a tela oferecia um ato que o servidor recusava) foi fechado, e a pior que sobra
é a que apaga o papel inteiro sem uma linha de aviso.

---

## 1. O que o credenciado É, e onde estatuto, documento e código divergem

Isto não é achado, é conhecimento. Existe para que a próxima sessão não reabra a discussão.

### 1.1 O eixo, no código

O papel é definido em `frontend/src/js/store/sync/session-context.js`. `GlobalRole` traz os quatro
valores e o JSDoc diz por extenso que **não é escada**. `hasGlobalDataAccess()` é o único predicado
nominal do credenciado no cliente inteiro, e tem **um consumidor só**, `canShareResource`
(`frontend/src/js/store/sync/resource-access.service.js`). `isAdmin()`, `isProducer()` e
`canProduceFor()` são todos nominais e todos falsos para ele.

**Varredura de promoção silenciosa: negativa, e reconferida.** Não existe em `frontend/src/js/` nem em
`backend/src/` nenhum `role !== 'user'` de gate: as três ocorrências da string são comentários que
explicam por que ela seria errada (`frontend/src/js/admin/producer-scope-phrases.js`,
`backend/src/modules/users/users.service.js` e a migração de identidade). A única escada do
repositório é `PERMISSION_ORDER` (`frontend/src/js/projects/permission-levels.js`), que é o eixo POR
ATLAS e exclui `producer` e `credenciado` de propósito. A classe de defeito que este perfil mais teme
não está presente.

### 1.2 As cláusulas que o definem

Todas vigentes, salvo a última: 1.1 (quatro papéis que não formam escada), 1.3 (só o administrador
promove), 2.6 (lê todo recurso privado sem concessão), 3.1 a 3.8 (a pessoa OU o grupo, dois níveis,
quem origina, prazo, poda da cadeia, preservação de caminhos independentes), 4.1, 4.2 e 4.6 (grupo é
entidade de usuário, e o credenciado não tem poder especial sobre ele), 4.7 e 5.8 (sair é direito de
quem entrou, o dono é a exceção), 8.5 (a autoridade morre com quem a exercia), 9.1 e 9.2 (a trilha é
do administrador e, recortada, do produtor; ele **não tem trilha**). A cláusula 10.1, sobre os bytes
do tile privado, está **[pendente]** por decisão do dono.

### 1.3 As divergências que sobram

**D1. "Concede e revoga" ainda é mais do que o servidor faz.** [`CLAUDE.md`](CLAUDE.md) diz que o
credenciado "concede/revoga no eixo de RECURSO". O servidor discorda: `requireGrantRevoker`
(`backend/src/middleware/resource-access.js`) libera por administração do sistema (a consulta
`GRANT_REVOKER_ACTOR`, cujo predicado é `u.role = 'admin'`) ou por AUTORIA (`g.granted_by = $2`).
Ou seja, **o credenciado revoga só o que ele mesmo concedeu**. A constituição não conflita (3.5
descreve o efeito, não o sujeito). **O que mudou:** a interface deixou de repetir o exagero, porque o
gate do botão passou a espelhar o servidor. Sobra a frase de `CLAUDE.md` e a lacuna de 3.5, que é a
Pergunta 1.

**D2. Nenhum resíduo do mundo velho de grupos.** A decisão de 2026-08-19, que dava a administração de
grupo ao credenciado por papel, foi superada pela cláusula 4.6, e a supersessão está escrita em três
sítios do cliente (`frontend/src/js/admin/admin-audience.js`, o JSDoc de `hasGlobalDataAccess`, e o
comentário acima de `listAccessGroups` em `frontend/src/js/store/sync/api-client.js`). Nenhum gate,
rótulo ou texto vivo lhe dá poder de papel sobre grupo. O único resíduo é iconográfico (B1).

**D3. O estatuto lhe dá leitura, e a pendência 10.1 tira metade dela na prática.** As duas convivem no
documento; na tela o resultado é um cartão que abre e uma camada que não desenha (A1).

*(A quarta divergência, D4, foi RETIRADA nesta revisão: ver a seção 6.)*

---

## 2. Onde há gate proativo de tela para este perfil, e onde não há

O mapa que organiza os achados que sobraram. A divergência **nunca esteve no vocabulário**: onde há
gate de tela para este perfil ele está certo e é por predicado compartilhado com o servidor. O que
falta é a metade da tela que não decide nada e delega ao servidor, ou que decide certo e não conta o
que decidiu.

| superfície | gate proativo | efeito para o credenciado |
|---|---|---|
| porta de Administração (menu do mapa, barra de `atlas.html`, montagem de `admin.html`) | `adminAudience` | vê só "Grupos"; as demais abas não existem, em vez de darem 403 |
| `calibracao.html` e as duas entradas de menu | `initCalibracaoPage`, espelhado por `_updateCalibrationVisibility` e `mayCalibrate` | a porta que ele não pode abrir não aparece |
| "Compartilhar" no cartão do catálogo e na camada base | `privado && canShareResource(...)` | aparece por papel, correto |
| campo "Acesso (visibilidade)" do catálogo | `canProduceFor` em `_renderResourceForm` | escondido, não desabilitado |
| "Remover acesso" na linha da concessão | `revokeAvailability` **(novo)** | some, e uma nota nomeia a quem pedir |
| "Sair do grupo" | `leaveGroupAvailability` | some para o dono, com nota no lugar |
| atlas, mapas, briefing, comentário, temporal | eixo POR ATLAS, `checkPermission` | entra na escada como conta comum, que é o desenho |
| **selo "Privado" do cartão** | **nenhuma procedência** | um selo para três origens, com `title` falso para ele (M1) |
| **prazo da concessão** | **nenhum campo** | não escolhe, e não renova (A4) |
| **adicionar membro a grupo** | **nenhum aviso e nenhum relato** | concede N recursos em silêncio (A5) |
| **camadas de análise, basemap, 3D e 360** | **nenhuma mensagem de falha** | falha muda, como as camadas de dado falhavam antes do lote (A1) |
| **quem RECEBEU a concessão** | **nenhuma superfície** | não é avisado de que ganhou, nem de que venceu (A2) |

---

## 3. Os achados que ficam

Reordenados por gravidade real. O rótulo original é mantido entre parênteses, para rastreio.

### CRÍTICO

#### C1 (ALTO 3) A soma dos recursos privados falha em silêncio, e leva o papel inteiro junto

**Promovido de ALTO, e a razão é que esta é a única falha do perfil que o torna indistinguível de não
existir.** As demais degradam uma tela; esta apaga o produto.

`refreshVisibleResources` (`frontend/src/js/store/sync/resource-access.service.js`) é best-effort por
desenho: o `catch` devolve `false` sem propagar, e o JSDoc declara que o `false` cobre três casos que
o chamador trata igual. Todos os chamadores descartam o retorno. `frontend/src/js/store/sync/sync-engine.js`
o chama em `login` e na abertura de atlas sem olhar a resposta, e nos dois `.then` de reação a evento
faz `if (!ok) return;`. `frontend/src/js/index.js` idem no boot.

Falhada a soma na PRIMEIRA carga, `_privados` fica vazio e assim permanece (`indexarPayload` só roda
no ramo de sucesso, de modo que uma soma anterior boa sobrevive a uma falha posterior; o que não
sobrevive é a que nunca aconteceu). A consequência para este perfil é total: `isPrivateResource`
devolve `false` para tudo, então nenhum cartão mostra "Privado"; o botão "Compartilhar" exige
`privado && ...` em `createCatalogCard` (`frontend/src/js/catalog/components/catalog-card.js`), então
ele some mesmo com `canShareResource` continuando verdadeiro por papel; e o catálogo fica **idêntico
ao de um visitante anônimo**. Sem uma linha na tela.

`retryVisibleResources` existe no mesmo arquivo, escrito exatamente para isto, e o único chamador é
`frontend/src/js/catalog/resource-reference.resolver.js`, no caminho da poda de saída. Nenhuma tela o
oferece.

**Detalhe que a correção precisa levar em conta.** `retryVisibleResources` começa por
`if (_escopo !== undefined) return true;`, e `_escopo` só é escrito no sucesso. Depois de uma soma bem
sucedida, uma soma POSTERIOR que falhe (troca de atlas, por exemplo) deixa o escopo antigo de pé e a
retentativa responde "está tudo bem" sem pedir nada. Uma ação "Tentar de novo" ligada a ela precisa
ou de um caminho que ignore esse curto-circuito, ou de um sinal separado de "a última soma falhou".

**Arquivo e símbolo.** `frontend/src/js/store/sync/resource-access.service.js` ·
`refreshVisibleResources`, `retryVisibleResources`, `indexarPayload`;
`frontend/src/js/store/sync/sync-engine.js`; `frontend/src/js/index.js`.

**Correção.** Um aviso não modal e não bloqueante quando a soma falha para uma sessão autenticada
("Não foi possível carregar o acervo privado desta conta"), com ação de nova tentativa, no eixo do
avatar ou na luz de conexão, que é onde a pessoa já procura estado de sessão. O `false` já distingue o
caso; basta ele chegar à tela.

### ALTO

#### A1 (ALTO 2, PARCIAL) O acervo privado pode não desenhar, e agora só metade das superfícies fala

**Metade resolvida, e é a metade que esconde a outra.** O lote construiu o mecanismo inteiro para as
camadas de DADO: `frontend/src/js/terrain/data-layer-phrases.js` (novo, zero imports, testável em
node) e um painel dentro do container do mapa, montado por `DataLayersManager._ensureNotice`. A falha
chega por `_watchMapErrors`, que assina `error` e `sourcedata` do MapLibre (a falha assíncrona de
tile, que nenhum `try/catch` daquele arquivo pegava) e **retira a acusação** quando a camada volta a
desenhar; a rajada é agregada por camada, e `_layerIdFromSourceId` dobra `config.source` e
`config.labelSource` sobre a mesma camada para não acusar duas vezes. A frase não afirma causa
(`layerLoadFailureCauseNotice` enumera rede, servidor e restrição de acesso, com o acesso por último)
e `layerLoadFailureStatusDetail` imprime o código HTTP sem interpretá-lo.

**O que continua aberto, e é o escopo declarado em [`PENDENCIA-TILE-PRIVADO.md`](PENDENCIA-TILE-PRIVADO.md):**
o `config.source` de `analysis_layers` e o `config.style` de `basemaps`. Varredura: fora de
`frontend/src/js/terrain/`, nenhum arquivo de `frontend/src/js/` importa
`frontend/src/js/terrain/data-layer-phrases.js` nem qualquer das frases dele. Não há fiação
equivalente para tileset 3D, para o 360 nem para o basemap. Para este perfil isso importa mais que
para os outros: a camada base privada tem selo próprio e botão de compartilhar, e é justamente uma das
superfícies sem aviso.

**Cobertura, para não superdeclarar.** `frontend/tests/unit/data-layer-phrases.test.js` importa só as
funções puras. O desenho do painel, a agregação por camada e a retirada da acusação por `sourcedata`
não têm teste.

**Correção.** O mecanismo já existe e é reusável: estender a assinatura de `error` do MapLibre às
sources de análise e ao basemap, e reusar as mesmas frases. A cláusula 10.1 não precisa fechar antes.

#### A2 (NOVO) Ninguém avisa quem RECEBEU o acesso, nem quando ele vence

Este perfil foi auditado inteiro do lado de QUEM CONCEDE. Do outro lado não há tela nenhuma, e o
próprio código diz o que isso custa.

**Do lado de quem recebe, o produto é mudo nos dois eventos.** Não há notificação de concessão
recebida: `backend/src/utils/mailer.js` exporta cinco remetentes, todos de ciclo de conta
(`sendVerificationEmail`, `sendEmailChangeVerification`, `sendEmailInUseNotice`,
`sendPasswordResetEmail`, `sendAccountExistsEmail`), e nenhum de acesso a recurso; e
`backend/src/modules/resource-access/` não tem caminho de notificação. Não há rota de listagem por
beneficiário, então quem recebeu não consegue nem perguntar o que tem.

**E o vencimento é pior, porque a defesa existe e não alcança quem precisa dela.** O `fileoverview` de
`expiryLabel` (`frontend/src/js/catalog/resource-share.modal.js`) diz por extenso que a morte mora no
predicado, que no dia seguinte o recurso simplesmente não vem mais, sem evento e sem aviso, e que
mostrar o prazo na linha é "a única coisa que separa isso de o recurso sumiu do meu catálogo". Só que
essa linha vive dentro do modal de concessão, e o modal só abre por um botão gateado por
`privado && canShareResource(...)`. **Quem recebeu com nível `view` nunca vê aquele chip.** Para essa
pessoa o recurso aparece um dia, some outro, e nada em lugar nenhum explica qualquer dos dois.

**A assimetria com o eixo de ATLAS é o argumento mais curto.** O mesmo lote criou
`frontend/src/js/projects/shared-atlas-badge.js` justamente porque "nada dizia a uma pessoa que um
atlas tinha sido compartilhado com ela", e o `fileoverview` registra a decisão do dono entre selo e
e-mail. O eixo de RECURSO tem exatamente o mesmo buraco e não ganhou nada.

**Por que é ALTO e não médio.** É o único achado deste relatório que descreve o efeito do papel sobre
terceiros, e ele fecha em falso o ciclo inteiro: o credenciado concede com prazo, acredita ter
informado alguém, e ninguém foi informado de nada.

**Arquivo e símbolo.** `frontend/src/js/catalog/resource-share.modal.js` · `expiryLabel`;
`frontend/src/js/catalog/components/catalog-card.js` · `createCatalogCard`;
`frontend/src/js/projects/shared-atlas-badge.js` (o precedente);
`backend/src/modules/resource-access/resource-access.routes.js` (sem rota por beneficiário).

**Correção.** Fecha junto com A3, e pela mesma rota: uma listagem por beneficiário responde "o que eu
recebi, de quem e até quando", e uma listagem por concedente responde "o que eu dei". Enquanto a rota
não existe, o barato é o selo do cartão dizer o prazo quando ele for conhecido.

#### A3 (ALTO 4) Não existe inventário do que ele concedeu

Intacto. A única superfície de concessão é o modal de UM recurso: para revogar algo, o credenciado
precisa LEMBRAR qual recurso concedeu, achá-lo no catálogo, abrir o modal e procurar a linha.
`backend/src/modules/resource-access/resource-access.routes.js` tem `GET /:type/:id/grants`,
`POST /:type/:id/grants` e `DELETE /grants/:grantId`, e nada por ator.
`frontend/src/js/store/sync/api-client.js` tem `grantResource` e `revokeResourceGrant`, e nenhum
"listar as minhas". E ele não tem a aba de Auditoria: `adminAudience` lhe dá só `groups`, o que é
decisão registrada.

**Por que continua alto.** O papel é definido por conceder, e o produto não tem a tela do meio. Some a
revisão periódica, que é a higiene natural de quem distribui acesso com prazo, e some a resposta a
"por que Fulano vê isto?" pelo lado de quem concedeu.

**Correção.** Uma segunda aba na página que ele já abre ("Grupos" viraria "Acesso", com "Grupos" e
"Concessões"), sobre uma rota nova de listagem por `granted_by`, com recurso, beneficiário, nível e
vencimento. Como efeito colateral, a tela onde ele revoga passa a ser, por construção, a das
concessões que ele pode revogar, o que é a mesma propriedade que o gate de botão hoje só simula.

#### A4 (ALTO 6, PARCIAL desde `b0e66b77`) Não dá para escolher o prazo, e o próprio texto manda renovar de um jeito impossível

**A PRIMEIRA PONTA SAIU, e as outras duas ficam.** O campo de prazo existe: `_renderAddSection`
ganhou um seletor (7, 30, 90, 180 dias e um ano, que continua o padrão), e os dois caminhos de
concessão passaram a mandar `expiresAt`. Isso veio pelo lote do PRODUTOR, não por este relatório,
e cumpre a metade da cláusula 3.4 que falava em teto E padrão.

**A ponta que importa para este perfil continua exatamente como estava, e a chegada do seletor a
deixou mais visível:** o parágrafo ao lado segue mandando conceder de novo antes da data, e conceder
de novo é impossível pelos dois lados. Agora há uma tela que oferece escolher um prazo curto e, no
parágrafo seguinte, instrui a fazer algo que o servidor recusa com 409. **Correção:** o botão de
estender na linha da concessão viva, abaixo.

Texto original das três pontas. O parágrafo fixo de `_renderAddSection`
(`frontend/src/js/catalog/resource-share.modal.js`) manda conceder de novo antes da data. Só que não
há campo de prazo (varredura por `expiresAt` no arquivo inteiro: zero, embora `apiClient.grantResource`
aceite o corpo que quiserem lhe dar), e conceder de novo é impossível pelos dois lados: `alreadyGranted`
(`frontend/src/js/catalog/grant-tree.js`) tira da busca e do seletor de grupo quem já tem concessão
viva, e o servidor devolve 409 na segunda concessão do mesmo par. Renovar exige revogar antes, e
revogar poda a subárvore, que não volta.

**Correção.** Um botão de estender na linha da concessão viva, empurrando `expires_at` pelo teto do
pai (o `LEAST` de três tetos do `INSERT` já sabe fazer o clamp, então a regra existe do lado do
servidor), e o parágrafo passando a apontar para ele. Escolher prazo mais curto no ato é independente,
e é decisão de produto (Pergunta 2).

#### A5 (ALTO 7) Adicionar alguém a um grupo é o ato que concede, e é o único do ciclo que não avisa nem relata

Intacto, e a simetria continua invertida. Na aba Grupos, apagar o grupo e remover um membro têm
confirmação com o alcance (`groupDeletionWarning`, `memberRemovalWarning`) e toast com o número do
SERVIDOR (`groupDeletionSummary`, `memberRemovalSummary`); `_removeMember`
(`frontend/src/js/admin/groups-tab.js`) foi reconferido linha a linha e faz as duas coisas. `_addMember`,
no mesmo arquivo, diz apenas que a pessoa entrou no grupo (ou que já estava, quando o servidor
responde idempotente). A tabela mostra uma coluna "Recursos" com a CONTAGEM de recursos privados que o
grupo alcança, e o texto de sucesso não a menciona.

Do ponto de vista do eixo de acesso, pôr alguém num grupo que já recebeu sete recursos privados é
conceder sete acessos de uma vez, sem passar pelo gate de repasse e sem linha nova em
`resource_grants`. É exatamente a delegação que `granteeGroupOwnerLabel` existe para tornar visível do
outro lado da tela.

**Correção.** O toast de sucesso relata o alcance, com o `grant_count` e o `atlas_share_count` que a
listagem já traz. Sem confirmação prévia, porque adicionar é reversível e confirmar tudo treina a
ignorar; o relato depois basta.

### MÉDIO

#### M1 (MÉDIO 1) A UI não distingue POR QUE ele vê um recurso

Intacto. O selo "Privado" do cartão (`frontend/src/js/catalog/components/catalog-card.js` ·
`createCatalogCard`) e o do seletor de camada base
(`frontend/src/js/base-layer-selector/base-layer-selector.control.js` · `_createLayerOption`) cobrem
TRÊS origens: papel global, concessão pessoal e empréstimo do atlas em foco. O próprio código sabe
disso e o escreve em `lendingScopeNote` (`frontend/src/js/catalog/visibility-phrases.js`): só a
terceira some sozinha quando a pessoa troca de atlas.

O `title` do selo continua sendo, literalmente, "Recurso privado: só quem recebeu acesso enxerga este
item", frase **falsa para o único perfil que vê tudo sem ter recebido nada**.

O payload não carrega procedência: `listVisiblePrivateResources`
(`backend/src/modules/resource-access/resource-access.service.js`) devolve os grupos de ids mais
`shareable`, e o cliente indexa dois conjuntos em `indexarPayload`.

**Correção.** No mínimo, um `title` verdadeiro nos três casos. Idealmente, o servidor devolvendo a
origem por id e o selo virando três (por papel, concedido a você, emprestado por este atlas), sendo o
terceiro o único que some ao trocar de atlas.

#### M2 (ALTO 5) "Transfira a posse" é oferecida por escrito e não existe em lugar nenhum

**Rebaixado de ALTO, e a justificativa é o que ele NÃO causa:** nenhum dado se perde, nenhum acesso
vaza, e a recusa em si está certa. O que sobra é um beco: a pessoa procura um botão que não existe.

Intacto no código. `groupOwnerCannotLeaveNotice` (`frontend/src/js/admin/group-phrases.js`) manda
apagar o grupo **ou transferir a posse dele**. Não há UI de transferência em
`frontend/src/js/admin/groups-tab.js`, e não há rota:
`backend/src/modules/access-groups/access-groups.routes.js` expõe listagem, participação, criação,
atualização, exclusão, membros e as duas saídas de membro, e `updateGroupSchema`
(`backend/src/modules/access-groups/access-groups.schemas.js`) aceita só nome e descrição. Compare com
atlas, que tem "Tornar dono" em `frontend/src/js/modals/sharing.modal.core.js`.

**O agravante que o rebaixamento não apaga, e que é novo nesta revisão:** a promessa deixou de ser só
de um texto de tela. A cláusula 4.7, **[vigente]** desde 2026-08-23, também diz que o dono "recebe
recusa que nomeia os dois caminhos, apagar ou transferir a posse". O estatuto agora promete o que o
código não tem, e nenhum guarda pega isso: `frontend/tests/unit/constituicao-estado-das-clausulas.test.js`
verifica o ESTADO declarado da cláusula, nunca se ela é verdade.

**Por que ainda é ruim.** Uma recusa que nomeia dois caminhos e entrega um manda a pessoa procurar um
botão inexistente, e o caminho que sobra é destrutivo (apagar o grupo poda as concessões dele), então
a recusa empurra para o ato irreversível.

**Correção.** Duas saídas, e a escolha é do dono. Implementar a transferência (a coluna `owner_id` já
existe e a autoridade já mora nela), ou trocar o texto por "Apague o grupo" enquanto ela não existir. A
segunda é de uma linha, fecha a mentira hoje, e exige mexer também na cláusula 4.7.

#### M3 (MÉDIO 7) A lista "quem tem acesso" subconta o alcance, e a frase de apoio para na metade

Intacto, texto conferido palavra a palavra. A frase de `_renderGrantsSection`
(`frontend/src/js/catalog/resource-share.modal.js`) nomeia três origens que não aparecem na lista:
administradores, credenciados e produtores da OM dona. Faltam duas, e são as que mudam a decisão de
quem concede:

- **o empréstimo por atlas.** `LIST_GRANTS_FOR_RESOURCE`
  (`backend/src/modules/resource-access/resource-access.queries.js`) lê só `resource_grants`, enquanto
  `fn_granted_resource_ids` entrega o recurso a quem abre um atlas cujo dono o enxerga. Ninguém desses
  aparece na lista;
- **o visitante anônimo de link público**, que herda o empréstimo pela cláusula 6.3.

Ou seja: a tela pode dizer que três pessoas têm acesso enquanto um atlas público empresta o recurso
para qualquer um com o link. Quem revoga a única linha da lista acha que fechou o acesso e não fechou.

O texto certo existe em outro lugar do produto (`lendingScopeNote` e `lendingRemovalWarning`,
`frontend/src/js/catalog/visibility-phrases.js`), mas mora na aba de configuração do atlas, que é a
tela de quem empresta, não a de quem concede. O servidor sabe resolver a contagem:
`atlasesLendingResource` (`backend/src/modules/resource-access/resource-access.service.js`) já existe,
usado para acordar as salas na revogação.

#### M4 (MÉDIO 2) As telas dele são as mais cheias do produto, e não há como filtrar

Intacto. O catálogo filtra só por TIPO (`frontend/src/js/catalog/catalog.modal.js` · `_applyFilters`,
`_computeFilterCounts`, e `frontend/src/js/catalog/components/catalog-filters.js`). O credenciado
enxerga o acervo privado inteiro do sistema, de todas as OMs, somado ao público. Não há filtro por
privacidade, por OM dona nem por produtor, e o cartão nem mostra a OM. Correção: um filtro de privado
contra público, que é barato porque o dado já está em `isPrivateResource`, e um por origem se M1 for
feito.

#### M5 (MÉDIO 3) Na busca de pessoas do modal, "ninguém encontrado" e "a rede caiu" são a mesma tela em branco

Intacto, e conferido nas duas pontas. `_renderResultsInto`
(`frontend/src/js/catalog/resource-share.modal.js`) faz
`container.innerHTML = results.length ? this._renderResults(results) : ''`, o que torna o ramo
"Nenhum usuário encontrado" de `_renderResults` **inalcançável**: o painel é revelado com string
vazia. E o `catch` de `_runSearch` chama exatamente o mesmo par (`_renderResultsInto([])` seguido de
`_setResultsHidden(false)`). Resultado: uma caixa branca para as duas causas. Correção: renderizar o
vazio (o texto já existe) e um estado de erro distinto, como o que a listagem de grupos tem em
`groupsLoadFailureNotice`.

#### M6 (MÉDIO 4) As telas de recusa do modal falam com o beneficiário errado, e o 404 não tem ramo

Intacto. `_renderDenied` mostra "Você recebeu este recurso apenas para ver". Para o credenciado a
frase é falsa em todas as palavras: ele não recebeu nada. E o 404 (recurso apagado por outra sessão)
cai no `_renderError` genérico, com um "Tentar novamente" que nunca vai resolver. Correção: mensagem
por status, e sem nova tentativa no 404.

#### M7 (MÉDIO 5) Na aba Grupos, carregando e falha são visualmente idênticos, e não há nova tentativa

Intacto. `_renderList`, `_renderParticipating` e `_renderMembers`
(`frontend/src/js/admin/groups-tab.js`) usam o mesmo `<p class="admin-users__status">` para
"Carregando grupos…" e para "Falha ao carregar os grupos.": mesma classe, mesmo cinza, sem
`role="alert"`, sem botão. A única recuperação é recarregar a página. A frase certa existe, em
`groupsLoadFailureNotice` (`frontend/src/js/admin/group-phrases.js`), e quem a usa é o modal de
recurso, não a aba. Correção: importá-la ali e acrescentar a nova tentativa.

Do mesmo lote: nenhum `catch` da aba re-renderiza a lista, então um 404 de linha morta (grupo apagado
noutra sessão) deixa a tela mostrando a linha com botões que vão falhar de novo.

#### M8 (MÉDIO 6) O aviso de remoção de membro cita um alcance velho sem dizer que é velho

Intacto. `_reachForWarning` (`frontend/src/js/admin/groups-tab.js`) relê a listagem de gestão antes de
apagar um grupo, e acrescenta a nota de números defasados quando a releitura falha. `_removeMember`
não faz nada disso: o grupo vem do fechamento de `_renderTable`, e `grant_count` e `atlas_share_count`
são a foto do momento em que a aba montou (só `member_count` é atualizado, em `_renderMembers`). Os
dois atos são igualmente irreversíveis. Correção: chamar `_reachForWarning` também em `_removeMember`.

#### M9 (MÉDIO 8) O toast de revogação afirma um fim que os bytes do 3D ainda não têm

Intacto. `_handleRevoke` (`frontend/src/js/catalog/resource-share.modal.js`) declara o acesso removido
assim que a rota volta. Para o 3D, os bytes continuam saindo por até 30 segundos:
`backend/src/modules/nomes/assets3d-acesso.js` memoiza a decisão de acesso por `TTL_MS`, e
`gateDeAsset3d` serve do memo. Some-se a isso a cláusula 10.3, que registra que a revogação não é
empurrada em tempo real para quem não está numa sala que empresta. O texto não precisa virar tratado;
basta não afirmar uma instantaneidade que o sistema não entrega.

### BAIXO

#### B1 (BAIXO 1, PARCIAL desde `b0e66b77`) O escudo diz "administração" onde o rótulo foi escrito para não dizer

**A METADE DA MOLDURA SAIU:** `AdminPanel._buildHeader` deixou de usar escudo e subtítulo fixos, e
os dois passaram a seguir o rótulo de `adminAudience`; e `_updateAdminVisibility` passou a trocar o
ÍCONE junto com o texto, em vez de só o nó de texto. **Ficam as outras duas:** o botão ainda nasce
com `ICON_ADMIN` e a palavra "Administração" antes de a função rodar, e a página continua montando
uma barra de navegação vertical com um item só.

Texto original. `SHIELD_ICON` (`frontend/src/js/admin/admin-panel.js`, usado incondicionalmente em
`_buildHeader`) aparece ao lado do título "Grupos". `mountAdminPage`
(`frontend/src/js/admin/index.js`) usa "Administração" como fallback do rótulo, e
`frontend/src/js/account/account.control.js` cria o botão com o texto "Administração" antes de
`_updateAdminVisibility` reescrevê-lo, então o rótulo errado existe no DOM por um instante. Somado a
isso, a página monta uma barra de navegação vertical com um item só. Todo o cuidado do `fileoverview`
de `frontend/src/js/admin/admin-audience.js` é desfeito pela moldura.

#### B2 (BAIXO 2) Bordas da aba Grupos

Três, todas em `frontend/src/js/admin/groups-tab.js`, e as três reconferidas:

1. `leaveGroupAvailability` tem três desfechos e `_renderParticipating` desenha dois. No ramo
   `LEAVE_AVAILABILITY.INDETERMINADO` (sessão não lida) a div de ações fica **vazia**: o ramo `DONO`
   recebeu a nota que o `fileoverview` de `group-phrases.js` chama de padrão da casa, e este não.
2. A recusa ao dono só existe em `title`. O texto visível é "Você é o dono", e a explicação (os dois
   caminhos, um dos quais é o M2) é invisível no toque.
3. A coluna "Dono" de `_renderTable` é redundante para quem não é administrador, e o comentário do
   próprio código admite que ela existe para o administrador.

#### B3 (BAIXO 3) Fora do alcance deste perfil, mas anotado

`frontend/src/js/admin/users-tab.js` monta o chip de papel com um fallback literal para "Usuário", o
que contradiz a política escrita em `frontend/src/js/ui/role-labels.js`, cujo `fileoverview` chama
exatamente isso de "a despromoção silenciosa". Um quinto papel emitido pelo servidor apareceria como
"Usuário" na tabela do administrador. O credenciado não abre essa aba; fica registrado porque é o
mesmo eixo, e pertence ao relatório do administrador.

---

## 4. O que está BOM e não deve ser mexido

Esta seção não é cortesia. Cada item é uma decisão que custou caro e que uma "simplificação" futura
desfaria. Os 13 itens originais foram reconferidos contra o código nesta revisão; **dois citavam
símbolo que não existe** e estão corrigidos abaixo, e um item novo entrou.

1. **`adminAudience` como definição única da porta.** Função pura, sem imports, com a decisão do
   credenciado escrita no `fileoverview`. **Reconferido:** são SEIS chamadores
   (`frontend/src/js/account/account.control.js`, `frontend/src/js/admin/admin-page.js`,
   `frontend/src/js/admin/index.js`, `frontend/src/js/catalog/resource-share.modal.js`,
   `frontend/src/js/modals/sharing.modal.core.js`, `frontend/src/js/projects/projects-page.js`), e é
   por isso que o rótulo não diverge por tela. Recortar as abas no cliente em vez de deixar o servidor
   responder 403 na montagem é a decisão certa.
2. **O selo de papel com a frase.** `globalRoleBadge`, `GLOBAL_ROLE_DESCRIPTIONS` e
   `getGlobalRoleDescription` (`frontend/src/js/ui/role-labels.js`, zero imports por contrato),
   replicados no menu de conta do mapa (`_updateRoleBadge`), na barra de `atlas.html` e `admin.html`
   (`buildRoleBadge`) e em "Minha conta". A frase do credenciado é exata e é a única coisa no produto
   que lhe ensina o papel. **Correção de símbolo:** a leitura em "Minha conta" está em
   `_renderProfileSection` (`frontend/src/js/modals/account-settings.modal.js`), e o símbolo
   _buildIdentitySection que a versão anterior citava **não existe**. O tratamento do papel
   desconhecido (mostrar o valor cru e dizer que não sabe descrevê-lo) é o padrão certo, e
   `frontend/tests/unit/papel-global-rotulos.test.js` compara as duas fontes de rótulo.
3. **O texto do prazo.** O parágrafo de `_renderAddSection` e o chip de vencimento, cujo `title` diz
   que depois da data o acesso deixa de valer sozinho, sem aviso. É a única defesa contra um sumiço
   que não emite evento nenhum, e o `fileoverview` de `expiryLabel` diz exatamente por quê. *(O que
   falta não é o texto: é ele alcançar quem recebeu, que é o A2.)*
4. **O relato da cascata, dos dois lados do clique.** O chip de dependentes na linha, o
   `revocationWarning` que conta e NOMEIA até três, e o toast pós-ato que usa o número do SERVIDOR e
   inclui as MANTIDAS (`reparented` e `trimmed`) para que a poda parcial não pareça incompleta. O
   `fileoverview` de `fallenGrants` declara a direção do erro (superestimar) e por quê. É o melhor
   tratamento de ato destrutivo do produto.
5. **A frase que diz quem NÃO aparece na lista.** Resolve, num lugar, a dúvida estrutural de uma lista
   necessariamente parcial. *(Ela está certa no que diz; o M3 é sobre o que ela ainda não diz.)*
6. **`granteeGroupOwnerLabel`.** Nomear o dono do grupo beneficiário torna visível a única
   transferência de autoridade do sistema que não gera linha em `resource_grants`. O raciocínio está
   no `fileoverview`, e a consulta do servidor o repete.
7. **Criar grupo sem sair do fluxo de concessão** (`_renderGroupCreate`, um campo só), com
   `newGroupEmptyHint` avisando que grupo novo nasce vazio.
8. **A separação "Meus grupos" e "Grupos de que participo"**, com `participatingReachUnknownNotice`
   dizendo que a ausência do número não significa zero. É honestidade sobre o que a tela não sabe.
9. **O eixo de recurso e o eixo de grupo separados no cliente**, com `hasGlobalDataAccess` tendo um
   consumidor só e o JSDoc dizendo qual, para que a próxima varredura não o pode como morto.
   **Reconferido:** a varredura por `hasGlobalDataAccess` em `frontend/src/js/` devolve quatro
   ocorrências, das quais uma é a definição, duas são comentário e uma é a chamada.
10. **Esconder em vez de desabilitar.** O campo "Acesso (visibilidade)" de
    `frontend/src/js/admin/catalog-tab.js` (gateado por `canProduceFor`, que o próprio comentário
    declara espelho exato do servidor) e o botão "Compartilhar" do cartão seguem a mesma doutrina, e
    ela está escrita.
11. **`calibracao.html` e as duas entradas de menu que a espelham.** O credenciado não vê a porta que
    não pode abrir, e o espelho é por chamada da mesma função, não por cópia do predicado.
12. **`canShareResource` cobre o buraco que o payload deixa, e o código diz por quê.**
    `LIST_SHAREABLE_OF_ACTOR` (`backend/src/modules/resource-access/resource-access.queries.js`) lê só
    `resource_grants` de nível `view_share` e a produção, então `shareable` chega **vazio** para o
    credenciado, que mesmo assim pode conceder tudo. Quem soma o papel é o cliente, por
    `hasGlobalDataAccess()`. Uma UI que decidisse o botão só por `shareable` deixaria o credenciado com
    a capacidade e sem porta. **Correção de símbolo:** quem monta o payload é
    `listVisiblePrivateResources`, e não o listVisibleResources que a versão anterior citava, que
    **não existe**.
13. **A ausência da classe de promoção silenciosa, e agora com rede nos dois eixos.** No eixo GLOBAL,
    `backend/tests/unit/papel-global-censo.test.js` reprova sítio não classificado. **Mudou para
    melhor desde a auditoria:** o eixo POR ATLAS, que a constituição declarava sem censo nenhum,
    ganhou um nos DOIS pacotes (`frontend/tests/unit/permissao-de-atlas-censo.test.js` e
    `backend/tests/unit/permissao-de-atlas-censo.test.js`). Isso importa para este perfil porque é o
    eixo em que ele entra como conta comum, e é onde uma lista fechada o excluiria por engano.
14. **NOVO: o gate de revogação, e o teste que prende a fiação.** `revokeAvailability`,
    `REVOKE_AVAILABILITY` e `revokeBlockedNotice` (`frontend/src/js/catalog/grant-tree.js`) espelham
    `GRANT_REVOKER_ACTOR` em função pura, e o `fileoverview` declara três propriedades que uma revisão
    futura pode desfazer sem perceber: **não é lista fechada de papel** (o ramo largo pergunta por
    administração do sistema e o estreito por AUTORIA, então papel novo entra por `granted_by` sem que
    ninguém edite a função), **`granted_by` nulo FECHA** reproduzindo o `= $2::uuid` do servidor, e
    **`isAdmin` é comparado com `true` estrito**. `frontend/tests/unit/revogar-concessao-quem-pode.test.js`
    cobre o par de nulos que tornaria a concessão da administração revogável por visitante sem sessão,
    e vai além da função pura: lê o texto de `frontend/src/js/catalog/resource-share.modal.js` e exige
    que o botão nasça dentro do ramo permitido, que a nota ocupe o outro, e que a LINHA nunca seja
    filtrada (ver quem tem acesso é o ponto daquela lista).

---

## 5. Perguntas em aberto, que só o dono decide

1. **Quem revoga?** A cláusula 3.5 descreve o efeito e não o sujeito; `CLAUDE.md` diz
   "concede/revoga"; o servidor deixa o credenciado revogar só o que ele originou. **O cliente já
   escolheu um lado** (esconder o botão nas linhas alheias), e a escolha está presa por teste. Falta a
   cláusula 3.5 ganhar a frase que diz quem revoga, e `CLAUDE.md` parar de prometer mais.
2. **Prazo escolhível?** Hoje toda concessão nasce com o padrão do servidor. Um credenciado que
   empresta acervo para um exercício de duas semanas não tem como dizer isso. Vale um campo, ou um par
   de atalhos?
3. **Procedência do acesso.** Fazer o payload de recursos visíveis devolver, por id, se o acesso veio
   de papel, de concessão ou de empréstimo custa uma coluna a mais e resolve M1 e metade do M4. O
   contra-argumento é que o cliente hoje não sabe de qual OM é cada item, e passar a saber alarga o
   que ele precisa manter coerente.
4. **Trilha para o credenciado.** Ele não tem aba de Auditoria (decisão registrada) e não tem
   inventário do que concedeu (A3). São dois buracos que se fecham juntos, e uma rota por ator
   fecharia também o A2 pelo lado de quem recebe. Fica na porta dele ou não fica?
5. **Transferência de posse de grupo:** implementar, ou apagar a promessa? A segunda é uma linha na
   tela **mais uma na cláusula 4.7**, que também a promete.
6. **`adminAudience` decide o credenciado por AUSÊNCIA.** Ela recebe três booleanos e ele chega ao
   ramo final porque os três falharam. O destino é o certo e está documentado, mas o único freio contra
   uma futura linha do tipo "tem papel global, então Administração" é a prosa.
7. **10.1 e este perfil.** Enquanto os bytes do tile não têm gate, o credenciado é quem mais sente. O
   lote pagou o marcador de camada indisponível para as camadas de dado, e ele é útil de qualquer
   forma depois que 10.1 fechar. Estender às três superfícies que sobraram (A1), ou esperar?

---

## 6. Achados que SAÍRAM

Não se apaga o registro: quem ler daqui a três meses precisa saber que aquilo já foi olhado.

- **CRÍTICO 1 (o botão "Remover acesso" em concessões que o credenciado não pode revogar).
  RESOLVIDO, pelo caminho exato que a auditoria propôs**, inclusive o lugar (`grant-tree.js`, onde a
  regra fica testável em node) e a doutrina (esconder, não desabilitar, com uma nota que nomeia a quem
  pedir). Ver o item 14 da seção 4 para o que precisa ser preservado.
- **D4 (um teste do backend chama de buraco o que a constituição decidiu). RETIRADO: o achado estava
  errado na origem.** O caso em `backend/tests/integration/papel-credenciado.test.js` abre com
  "MARCADOR, NÃO ENDOSSO, E JÁ PELA METADE", declara qual metade fechou (revogar deixou de passar pelo
  papel de dado), e diz que existe para ficar VERMELHO no dia em que um predicado próprio nascer,
  devolvendo a decisão à mesa em vez de contradizê-la em silêncio. Isso é exatamente o mecanismo que a
  constituição prescreve para decisão em aberto, e não um rótulo defasado. A objeção de que o
  predicado citado ali não existe também não se sustenta: o comentário o propõe no futuro, não afirma
  que existe. **O que sobra é uma linha de atrito, e ela é de documento contra documento, não de UX:**
  o TÍTULO do caso continua começando por "BURACO CONHECIDO" enquanto a cláusula 3.3 declara a mesma
  conduta vigente. Quem for mexer naquele arquivo pode alinhar o título; nada na tela depende disso.

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
escrito foi este. As afirmações do servidor foram conferidas nos módulos de acesso a recurso, grupos
de acesso, autenticação e catálogo de `backend/src/`; as do cliente, lendo os arquivos citados. Onde
este documento afirma ausência (por exemplo, "nenhum arquivo fora de `frontend/src/js/terrain/` importa
`frontend/src/js/terrain/data-layer-phrases.js`"), a afirmação vem de varredura sobre a árvore inteira.

Três ressalvas de alcance, para não superdeclarar:

- **Este arquivo não está sob nenhum guarda.** `frontend/tests/unit/docs-integridade.test.js` varre
  `docs/`, `.claude/` e uma lista de alvos escrita à mão, e a raiz do repositório não é varrida.
  Caminho e símbolo citados aqui não são verificados por teste nenhum: que estivessem todos certos na
  conferência de hoje é resultado de leitura, não propriedade mecânica. A conferência à mão desta
  revisão achou dois símbolos inexistentes na versão anterior, os dois na seção "o que está bom", que
  é o lugar onde um símbolo morto engana mais, porque a seção existe para dizer o que preservar.
- **Nenhuma afirmação deste documento foi verificada em tela.** A camada que exercita UI é o
  Playwright, e ela ficou fora desta revisão; tudo aqui é leitura de código e de teste.
- **A conferência é uma foto de uma árvore de trabalho LIMPA**, com o lote já em 76dbe93d. Ao
  contrário da revisão irmã do usuário comum, aqui não há trabalho não commitado de que um achado
  resolvido dependa.
