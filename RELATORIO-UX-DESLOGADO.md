# Relatório de UX: o visitante deslogado

Perfil avaliado: o **visitante anônimo**, incluindo o visitante de link público de atlas. É o perfil
do primeiro acesso e o único que chega por um link em vez de por uma escolha. `CONSTITUICAO.md` é a
especificação de referência.

**Auditoria original: 2026-08-23.** 27 achados numerados, mais um inventário de 39 ações, um mapa de
cláusulas, uma lista do que não deve ser mexido e sete perguntas ao dono.

**Revisão: 2026-08-24.** Um lote grande entrou depois da auditoria (o commit de topo é 76dbe93d) e
tocou este perfil em quatro pontos. Este documento foi reescrito para separar o que saiu do que fica.

**Baixa contra `59e9600c`, 2026-08-24.** A revisão acima foi escrita em `11150029`; o commit
seguinte fechou 23 achados do perfil de usuário comum e passou por esta superfície. Cada achado foi
reaberto contra o código de `59e9600c`. **SETE saíram**, e quatro deles são achados NOVOS desta
revisão, fechados antes de serem lidos. O critério de alcance é mecânico e está dito na nota de
método: um achado cujos arquivos o commit não tocou não pode ter sido resolvido por ele.

## Como esta revisão foi feita

Cada um dos 27 achados foi reaberto **contra o código**, não contra a lista de commits. Onde este
documento diz RESOLVIDO, o arquivo foi aberto e o símbolo, procurado; onde diz INTACTO, a varredura
foi refeita. Ler a lista de commits e concluir "feito" é chancelar a saída de quem fez.

A árvore de trabalho está limpa, então tudo o que se afirma aqui é sobre código commitado, e não
sobre trabalho pendente que possa evaporar.

A conferência achou as três categorias esperadas. A terceira, a dos parciais, rendeu um caso só, mas
ele é exemplar: o achado hoje numerado A4 foi atendido pela metade e por um caminho **diferente**
do proposto, e a metade atendida é justamente a que menos importa para este perfil.

## Placar

| | |
|---|---|
| achados conferidos | 27 |
| saíram (resolvidos) | 3 |
| ficam | 24, dos quais 1 é parcial |
| achados NOVOS | 4 |
| **baixa contra `59e9600c`: saíram** | **7** (M2, M3, M5, N1, N2, N3, N4) |
| **em vigor hoje** | **21** |

Gravidade dos que ficam, **reordenada por gravidade real** e não pela numeração antiga: 4 altos, 10
médios, 10 baixos. **Depois da baixa contra `59e9600c`: 4 altos, 7 médios, 10 baixos**, e nenhum dos
quatro NOVOS de pé. A numeração NÃO foi refeita, de propósito: renumerar quebra remissão, e este
conjunto de relatórios já pagou esse preço uma vez. O único CRÍTICO original saiu, e não sobrou nenhum: **a interface não oferece mais
ao anônimo nenhuma ação que o servidor recuse com erro genérico.**

Duas gravidades foram rebaixadas por mérito, e o motivo está escrito no achado: o antigo A6
(descoberta da metade colaborativa) e os antigos M5 e M10.

---

## 1. O que o lote entregou a este perfil, e as duas perguntas que ele respondeu

Isto não é achado, é conhecimento. Existe para que a próxima sessão não reabra a discussão.

**1.1 O link público morto passou a falar (era o achado A3 da auditoria original).** O ramo de
falha de `openPublicAtlasFromUrl` (`frontend/src/js/index.js`) foi partido em dois. O primeiro cobre a
resolução do link e fala por FAIXA DE STATUS, via `classifyRequestFailure` e
`publicLinkFailureNotice` (`frontend/src/js/deep-link/public-link-phrases.js`); o segundo cobre a
falha local depois de o link já ter resolvido (namespace, wipe, socket, mapa inicial) e diz que o
problema é neste computador, mandando recarregar.

**A divergência frente ao que o achado propunha, e ela está certa.** O A3 pedia frases separadas para
401/403 e para 404. O código as COLAPSA byte a byte, e o `fileoverview` do módulo explica: a rota é
anônima, o servidor responde 404 para os quatro desfechos (revogado, expirado, digitado errado, atlas
excluído) e a cláusula 5.6 trata isso como decisão anti-enumeração. Uma frase própria para o 403
reconstruiria no cliente, um degrau acima, o oráculo que o servidor fecha. O 429 **não** colapsa,
porque fala de quem pede e não do atlas. A frase nomeia as possibilidades sem afirmar qual, que é a
forma de ser útil sem confirmar existência.

**O parâmetro sai da URL só quando o servidor recusou o link** (`shouldForgetPublicLink` e
`forgetPublicAtlasUrl`), e não nas faixas transitórias, onde o F5 é a tentativa natural de quem
acabou de ler "tente novamente". O custo está escrito e foi comprado de olhos abertos: quem quisesse
devolver o link a quem o enviou perde o texto da barra de endereços. Preso por
`frontend/tests/unit/link-publico-morto-fala.test.js`, com controle negativo nas duas direções.

**1.2 A classificação de falha de pedido virou módulo folha.**
`frontend/src/js/utilities/request-failure.js` (`RequestFailure`, `requestStatus`,
`classifyRequestFailure`, `isCredentialFailure`), zero imports por contrato, porque duas das páginas
que o consomem bootam sem a store. Ele fecha o defeito da credencial apagada por 502 (que é do perfil
logado) e é a fonte de que o item 1.1 deriva as faixas. A regra é "o status decide, nunca o mero fato
de falhar", e ela falha FECHADA no sentido que preserva a credencial.

**1.3 Recuperação de senha existe, nas duas vias (era a pergunta P1).** O dono escolheu as duas
saídas em vez de uma. `backend/src/modules/auth/auth.routes.js` ganhou `POST /auth/forgot-password` e
`POST /auth/reset-password`, montadas sob `canDeliverAccountMail()`; e o caminho do administrador
está escrito na tela em TODA implantação: `LoginModal._createForm` tem botão incondicional "Esqueci
minha senha", e o painel sempre mostra `ADMIN_RECOVERY_TEXT`, acrescentando o formulário de e-mail só
quando `emailRecoveryEnabled` lê a bandeira que o servidor publica pelo MESMO predicado.

**A parte que este perfil paga, e que o texto assume:** `requestPasswordReset` responde igual haja ou
não conta resetável, e `FIND_RESETTABLE_USER_BY_EMAIL` só encontra endereço **confirmado**, de
propósito (mandar credencial para endereço não provado entrega a conta a quem digitou). O
`CODE_REQUESTED_TEXT` sobrevive aos dois desfechos sem enumerar os três motivos de nada chegar, e
termina mandando usar o caminho do administrador. É a saída certa dada a restrição, e é por isso que
o beco sem saída do antigo A1 acabou.

**1.4 O botão "Compartilhar" some para quem não gere, e o visitante de link público é o primeiro que
ele deixa (era a pergunta P7, e resolve o C1).** `visibleAtlasActions`
(`frontend/src/js/sidebar/tabs/atlas-actions.js`) filtra por `atlasRoleHasAtLeast(role, 'manage')`.
Hierarquia, nunca lista fechada, e posto desconhecido falha FECHADO. A porta somente-leitura que
nasceu no lugar dele, `participants`, exige `authenticated`, então o visitante público não a recebe:
`GET /atlas/overview` não nomeia atlas, e o token efêmero é confinado por `confineVisitorPrincipal`
(`backend/src/middleware/auth.js`), de modo que oferecê-la trocaria um beco por outro.

**A divergência que importa:** a tabela `ACTIONS_BY_STATE` continua decidindo pelo STORE, e o
visitante público continua caindo em `AtlasTabState.REMOTE`, como antes. O que mudou não foi o estado
e sim o filtro que roda depois dele. A consequência é que os outros itens da linha REMOTE seguem
saindo sem gate nenhum, e um deles é o achado M5 abaixo.

**1.5 Nasceu uma mensagem de camada inacessível que não afirma causa.**
`frontend/src/js/terrain/data-layer-phrases.js` (zero imports, node-testável) e um painel dentro do
container do mapa, montado por `DataLayersManager._ensureNotice` e alimentado por
`DataLayersManager._watchMapErrors`, que assina o evento de erro do MapLibre.
`layerLoadFailureCauseNotice` enumera rede, servidor e restrição de acesso, com o acesso
deliberadamente por ÚLTIMO, e `layerLoadFailureStatusDetail` imprime o código HTTP observado sem
interpretá-lo. É a mitigação que o achado A4 pedia, e ela cobre uma superfície só: ver o parcial.

### As perguntas ao dono que continuam abertas

P1 e P7 foram respondidas acima. As outras cinco continuam valendo, em uma linha cada:

- **P2. Sem backend, o anônimo deve alcançar os atlas locais?** Hoje não alcança em nenhuma das duas
  páginas, por consequência direta do fail-fast, que é decisão declarada. Independente da resposta, a
  correção de texto do A1 vale.
- **P3. O visitante de link público deve poder sair da visita, e como se chama isso?** A saída existe
  (o botão "Abrir" leva a `atlas.html`) e não se anuncia como saída.
- **P4. Prioridade da cláusula 10.1 diante deste perfil**, que é o que menos tem via de diagnóstico.
- **P5. Quanto do convite ao servidor deve aparecer no mapa?** Há tensão real: o mapa é o produto de
  quem não entrou, e encher a tela de convite contradiz isso. A pergunta é a dose.
- **P6. O teto de dez atlas locais deve ganhar voz antes da recusa, ou simplesmente subir?**

---

## 2. Onde há gate proativo de tela para este perfil, e onde não há

Este é o mapa que organiza quase todos os achados que sobraram. Ele substitui o inventário de 39
ações da auditoria original, em que a maioria das linhas dizia OK. **A divergência com o estatuto
nunca esteve no VOCABULÁRIO, e sim na COBERTURA:** onde há gate ele está certo; o problema é a metade
da tela que não tem gate nenhum e delega ao guarda do store, que responde com uma frase única.

| superfície | gate proativo | efeito para o visitante deslogado |
|---|---|---|
| barras de desenho, militar e análise | `getViewModeController` mais `is-view-only` | somem no link público, correto |
| "Compartilhar" na aba Mapas | `visibleAtlasActions` **(novo)** | some para o visitante público, correto |
| "Participantes" na aba Mapas | `visibleAtlasActions` **(novo)** | não é oferecido a quem não tem conta, correto |
| "Enviar ao servidor" | `ACTIONS_BY_STATE[LOCAL_ANON]` mais `AccountControl._updateSaveToServerVisibility` | some sem sessão, correto (e é o que torna a frase do M6 impossível de cumprir) |
| comentário espacial | `CommentOverlay._canComment` | botão some; a recusa nomeia três motivos distintos |
| clonar atlas público | ausência no cliente, `requireAccountPrincipal` no servidor | não oferecido, correto (cláusula 8.3) |
| Administração e Calibração | `adminAudience`, `mayCalibrate` | escondidas, correto |
| "Criar conta" no mapa | `config.features.self_registration` em `AccountControl._handleLogin` | só onde a rota está montada, correto |
| **"Criar conta" em `atlas.html`** | **nenhum** | não existe nem onde o auto-cadastro está ligado (M2) |
| **"Importar" no link público** | **nenhum** | escolhe arquivo e a importação morre op a op (A5) |
| **"Excluir" do único atlas local** | **nenhum** | encena confirmação destrutiva para uma recusa já sabida (M5) |
| **camadas de dado, 3D, 360** | **nenhum** para acesso | o recurso emprestado aparece e não desenha (A4) |

O lote fechou a linha do "Compartilhar" e abriu a de "Participantes". Não tocou nas quatro últimas.

---

## 3. Os achados que ficam

Reordenados por gravidade real. O número original é mantido entre parênteses, para rastreio.

### ALTO

#### A1 (antigo A2) Sem backend, o trabalho puramente local fica inalcançável, e a tela não diz que ele está a salvo

**Promovido ao topo dos que sobram**, porque é o único que leva alguém a acreditar que perdeu dados.

Intacto nas duas páginas que o anônimo usa. Em `initApp` (`frontend/src/js/index.js`), três
tentativas de aplicar a configuração de runtime e, falhando, `showUnavailableScreen()` seguido de
`return` antes de `initServices()`. Em `initProjectsPage`
(`frontend/src/js/projects/projects-page.js`), a mesma coisa antes de `loadLocalAtlases`. **A DESCRIÇÃO ENVELHECEU EM `59e9600c`, e o achado não.** Este parágrafo dizia que
`frontend/src/js/ui/unavailable-screen.js` exporta **um** símbolo com uma mensagem literal única.
Hoje ele exporta também `BlockingCause` e as palavras moram em
`frontend/src/js/ui/blocking-screen-phrases.js`, módulo puro e testado, com DUAS causas
(`SERVER_UNREACHABLE` e `APP_ERROR`) e queda conservadora na desconhecida. **O achado continua
inteiro:** o texto de `SERVER_UNREACHABLE` foi preservado palavra por palavra, de propósito, e é
exatamente ele que não diz que os atlas deste navegador estão a salvo. O que mudou é o preço da
correção, que passou de reescrever a tela para acrescentar uma frase a uma tabela pura.

**Por que é o pior dos que sobram.** Uma pessoa com dez atlas locais, para quem o produto anunciou
"Nada aqui vai para o servidor", lê "EBGeo indisponível" e conclui razoavelmente que perdeu tudo. A
frase não distingue "o servidor caiu" de "seus dados sumiram". O fail-fast é decisão declarada e não
está em discussão; o que está é o que a tela deixa de dizer. O docblock de `initProjectsPage` afirma
que a metade local é o produto inteiro para um visitante sem conta, e essa afirmação é falsa em toda
queda de rede.

**Correção.** Uma segunda frase incondicional na mensagem: os atlas guardados neste navegador não
foram afetados e voltam quando a conexão voltar. Custa nada e remove o pior da leitura. A pergunta P2
trata de ir além.

#### A2 (antigo A4) A visita pública não tem nenhum sinal persistente: nem "somente leitura", nem qual atlas é

Intacto, e agravado de leve pelo próprio lote. O único anúncio continua sendo um toast no fim de
`openPublicAtlasFromUrl`, dizendo que a visualização é pública e somente leitura, e ele é
transitório. Depois disso o que resta é a AUSÊNCIA das barras, por `is-view-only`.

**A varredura foi refeita e o resultado é o mesmo:** `sessionContext.isVisitor()`
(`frontend/src/js/store/sync/session-context.js`) continua **sem um único consumidor de interface**;
os dois usos em `frontend/src/js/` estão ambos em `frontend/src/js/store/sync/tab-lock-sync-brake.js`.
E os três controles que poderiam identificar o atlas seguem escondidos por `isAuthenticated()`, que é
falso para o visitante: `frontend/src/js/account/atlas-name.control.js`,
`frontend/src/js/account/sync-status.control.js` e
`frontend/src/js/presence/online-users.control.js`.

**O agravante novo:** com "Compartilhar" fora e "Participantes" negado ao visitante, a aba Mapas ficou
com menos coisa ainda para dizer quem é o dono daquilo que está na tela. O cabeçalho da aba mostra o
nome do atlas, mas depende de a pessoa abrir a barra lateral.

**Por que continua ALTO.** Cinco segundos depois do toast, o visitante não tem como saber que está
vendo documento de outra pessoa, em modo restrito, nem qual. Ausência de barra de ferramentas é
indistinguível de "está carregando" e de defeito.

**Correção.** Dar a `isVisitor()` o consumidor que falta: faixa persistente e discreta (a família
visual do `DEGRADED_NOTICE` do tab-lock, que já é banner e não overlay), com o nome do atlas, a
palavra "somente leitura" e uma saída explícita. Alternativa barata: trocar o gate de
`AtlasNameControl` de `isAuthenticated()` para a existência de atlas conectado, com o selo de nível
ao lado, por `getPermissionLabel` (`frontend/src/js/projects/permission-levels.js`).

#### A3 (antigo A5) O mapa não diz ao anônimo onde o trabalho dele mora

Intacto. No mapa, a única afirmação sobre a natureza local do trabalho continua sendo o atributo
`title` de um `<span>`, escrito por `MapsTab._refreshAtlasHeader`
(`frontend/src/js/sidebar/tabs/maps.tab.js`); o texto visível é a palavra "Local". Nenhuma frase
sobre o trabalho não estar em servidor nenhum, ou sobre limpar os dados do navegador destruí-lo.

A cópia honesta existe, é boa e mora toda em `atlas.html`: "Atlas guardados neste navegador. Nada
aqui vai para o servidor nem é visto por outras pessoas." (`LocalAtlasSection._build`, em
`frontend/src/js/projects/atlas-drive.js`).

**Por que continua ALTO.** `title` não existe em toque, não existe para leitor de tela em vários
contextos e não existe para quem não passa o mouse exatamente ali. O anônimo que entra pela URL nua,
desenha uma tarde inteira e fecha o navegador nunca leu que aquilo não está guardado em lugar nenhum.
É a condição para a perda de trabalho, mesmo que nenhum caminho de código a cause.

**Correção.** Levar a frase que já existe para o cabeçalho da aba Mapas quando o estado for
`AtlasTabState.LOCAL_ANON`, como texto visível, com a ação que fecha o argumento: use Exportar para
levar uma cópia.

#### A4 (antigo A7, PARCIAL) O recurso privado emprestado ao visitante público aparece e não desenha

**Este é o único parcial do relatório, e o que foi entregue é a metade que menos serve a este
perfil.**

A mitigação de interface existe e é boa (decisão 1.5): a camada que falha ao carregar passa a ter
estado nomeado, com uma frase que não afirma causa. **O que falta:**

1. **A cobertura é de uma superfície só.** Só `frontend/src/js/terrain/data-layers.manager.js`
   importa as frases; a varredura por `frontend/src/js/terrain/data-layer-phrases.js` em
   `frontend/src/js/` devolve o próprio
   módulo e o gerente de camadas de dado, e nada em `frontend/src/js/3d_models_viewer_tool/` nem em
   `frontend/src/js/street_view_tool/`. Ou seja, tileset 3D, orientação 360 e basemap continuam
   falhando em silêncio, e são justamente os recursos mais visuais de um atlas compartilhado por
   link.
2. **A causa continua de pé.** A cláusula 10.1 segue `[pendente]` por decisão do dono, com a apuração
   em [`PENDENCIA-TILE-PRIVADO.md`](PENDENCIA-TILE-PRIVADO.md). A mitigação conserta a mentira, não o
   acesso.
3. **A cobertura do que foi feito é de frases puras.** `frontend/tests/unit/data-layer-phrases.test.js`
   prende o texto; o desenho do painel e a agregação por camada não têm teste.

**Por que continua ALTO.** Entre todos os perfis, o visitante de link público é o único que não tem
via de diagnóstico nenhuma: sem conta, sem suporte, e com uma única pessoa a quem perguntar.

### MÉDIO

#### M1 (antigo A6) O anônimo não descobre pelo mapa que existem conta, atlas de servidor e colaboração

**Rebaixado de ALTO.** É perda de descoberta e de crescimento, não erro de comportamento nem risco de
dado, e a pergunta P5 registra que a dose é decisão de produto, não defeito a corrigir.

Intacto no que afirma. No mapa, o único sinal de que existe outro mundo é o botão "Entrar" do
`AccountControl` (`frontend/src/js/account/account.control.js`), com o texto "Entrar" e nenhum
`title`. O texto que explica a proposta existe e é bom, em `createServerInvite`
(`frontend/src/js/projects/atlas-drive.js`).

**Uma correção de fato nesta revisão:** o relatório dizia que o visitante precisa "rolar abaixo da
grade de cartões" para achar o convite. A leitura de `initProjectsPage` mostra que o convite é o
SEGUNDO e último bloco do corpo, logo abaixo da seção local; para um visitante novo a seção local tem
um cartão só. O atrito é menor do que o texto original sugeria, e o que continua verdadeiro é o
caminho até a página: abrir a barra lateral, achar a aba Mapas e reconhecer "Abrir" como navegação.

#### M2 (antigo M7) [RESOLVIDO em `59e9600c`] Não há "Criar conta" em `atlas.html`, mesmo onde o auto-cadastro está ligado

`openLoginDialog` (`frontend/src/js/projects/projects-page.js`) passa `onRegister`, gateado por
`config.features.self_registration`, e `openSignupDialog` espelha `AccountControl._handleRegister`.
O comentário no ponto diz por que a bandeira é obrigatória e não cortesia: `POST /auth/register` só
é montada com `ALLOW_SELF_REGISTRATION`, então oferecer o botão sem consultá-la seria um beco de 404.

**A correção proposta aqui NÃO foi seguida, e a divergência está certa.** Este achado pedia um helper
compartilhado para o par (ler a bandeira, montar `onRegister`); o que existe são duas leituras da
mesma bandeira, uma por página. Extrair o helper obrigaria as duas páginas a compartilhar um módulo
a mais, e `atlas.html` boota sem a store: o que evita a divergência aqui é o teste, não o helper.

#### M3 (antigo M9) [RESOLVIDO em `59e9600c`] A confirmação de e-mail funde os desfechos numa frase só, e ela chuta

`handleEmailVerificationFromUrl` (`frontend/src/js/index.js`) passou a ler o CÓDIGO no ramo de falha
e o PROPÓSITO no de sucesso, e a frase sai de `emailVerificationNotice`
(`frontend/src/js/session/email-verification-phrases.js`, módulo folha sem imports). Do lado do
servidor, `verifyEmail` (`backend/src/modules/auth/auth.service.js`) deixou de colapsar quatro
recusas em `BAD_REQUEST`: `EMAIL_TOKEN_INVALID`, `EMAIL_TOKEN_EXPIRED`, `EMAIL_TAKEN` e
`ACCOUNT_INACTIVE`. O espelho é cobrado por `frontend/tests/unit/email-verification-phrases.test.js`,
que lê os códigos do arquivo do backend em vez de os recopiar.

**Divergência frente ao proposto, e ela é a metade que importa:** este achado mandava "propagar a
mensagem do servidor com um fallback". O que foi feito é o contrário, e de propósito: a mensagem do
servidor NÃO é propagada, o código é traduzido no cliente. Propagar texto de servidor para a tela é o
que faz "HTTP 502" aparecer embaixo de um campo de formulário.

#### M4 (antigo M1) "Abrir" é a única porta para "Seus atlas", e o rótulo não diz isso

Intacto. A grade de ações declara `{ id: 'open', label: 'Abrir', title: 'Escolher outro atlas' }`, e
`MapsTab._handleOpenProject` delega a `AccountControl.openProjectPicker`, que **não** é gateada por
sessão. A porta funciona para o anônimo, o que é bom. O problema é o rótulo: "Abrir" fica ao lado de
"Importar", que é um seletor de arquivo, e o docblock do próprio handler registra que aquele botão
ERA um seletor de `.ebgeo`. As palavras "Seus atlas" nunca aparecem no mapa para quem não tem sessão.
Some-se que o nome do atlas no cabeçalho é um `<input>` de renomear, inerte ao clique, e o lugar mais
natural de clicar não leva a lugar nenhum. **Correção:** rotular como "Seus atlas" e manter o `title`
atual como explicação.

#### M5 (antigo M3) [RESOLVIDO em `59e9600c`] "Importar" é oferecido ao visitante de link público e recusado operação a operação

As duas metades fecharam, e por duas linhas de defesa. `visibleAtlasActions`
(`frontend/src/js/sidebar/tabs/atlas-actions.js`) passou a filtrar `import` por
`can('IMPORT_DATA')`, então o botão some para quem não escreve; e `MapsTab._handleImportAdditive`
recusa na ENTRADA, com `denialNotice(perm.required)`, ANTES de montar o seletor de arquivo. O
comentário no ponto explica por que a segunda linha existe apesar da primeira: o DOM velho e o
rebaixamento que cai entre o repintar e o clique.

`GuardAction.IMPORT_DATA` deixou de ter zero consumidores, que era o achado estrutural por trás. A
posição do gate (antes do gesto caro, não depois) é presa por
`frontend/tests/unit/criacao-recusa-na-entrada.test.js`.

#### M6 (antigo M6) A recusa do comentário manda o anônimo fazer o que a interface não lhe oferece

Intacto. `CommentOverlay.togglePlacement` (`frontend/src/js/comment_tool/comment-overlay.js`) escolhe
entre três frases e o comentário do código explica corretamente por que três. A frase do caso local é
"Comentários existem só em atlas do servidor. Envie este atlas ao servidor para comentar." Para o
anônimo, enviar ao servidor é justamente a ação escondida: `save-server` não está na linha
`LOCAL_ANON` e `AccountControl._updateSaveToServerVisibility` exige sessão. O ramo que diria para
entrar na conta só é alcançado quando já se está num atlas de servidor. **Correção:** um quarto ramo,
ou uma condicional na frase existente.

#### M7 (antigo M11) Em `atlas.html`, falha ao ler o registro local é indistinguível de "você não tem nada"

Intacto. `initProjectsPage` captura a falha de `loadLocalAtlases`, mostra um toast transitório e
segue com uma lista vazia. `LocalAtlasSection._render` (`frontend/src/js/projects/atlas-drive.js`)
foi lido inteiro: ele limpa a grade, desenha um cartão por atlas, acrescenta a peça de criação e
atualiza o contador. Não há ramo de estado vazio nem de erro.

Passados os segundos do toast, a tela afirma sem ressalva que a pessoa não tem nada, e a convida a
criar um atlas por cima de um registro que a página acabou de não conseguir ler. O estado honesto de
um visitante novo **nunca** é a grade vazia (`bootstrapEntry`, em
`frontend/src/js/store/local-atlas.api.js`, garante um cartão), então a grade vazia é literalmente o
estado de falha. **Correção:** um ramo de erro em `_render`, com frase própria e botão de tentar de
novo, no lugar da peça de criação.

#### M8 (antigo M2) O aviso de poda da exportação afirma "restritos" para um perfil que não tem restrição nenhuma

Intacto. `ExportImportService.handleExport`
(`frontend/src/js/import_export/export-import.service.js`) mostra um `showConfirm` intitulado "Este
arquivo sai sem os recursos restritos". Para o anônimo, `isPrivateResource` nunca devolve verdadeiro,
porque `refreshVisibleResources` jamais rodou; o que de fato é podado é tudo que
`construirResolverDeSaida` (`frontend/src/js/catalog/resource-reference.resolver.js`) classifica como
desconhecido, e ali o 360 responde desconhecido sempre, por decisão registrada.

Ou seja: o visitante que nunca tocou em nada restrito recebe um aviso de perda por restrição,
listando as orientações 360 e os slides com foto. O relatório de poda carrega o veredito por
referência, e `descreverPerdas` não o usa: ele agrupa por superfície e conta, sem separar as duas
naturezas. **Correção:** separar as duas listas no texto, com a segunda dita como é (o 360 não viaja
em `.ebgeo`), o que melhora o aviso para todos os outros perfis também.

#### M9 (antigo M8) O cadastro exige a Organização Militar sem dizer que ela é lotação e não autoriza nada

Intacto. `SignupModal._createForm` (`frontend/src/js/modals/signup.modal.js`) monta "Organização
Militar" como campo obrigatório, com o placeholder de seleção e nenhuma nota. A cláusula 1.5 diz que
a organização declarada é lotação e não autoriza nada, e a 10.5 registra que ela é auto-declarada e
que ninguém a verifica. **Correção:** uma linha de ajuda sob o campo, no vocabulário do estatuto.

#### M10 (antigo M4) Excluir o único atlas local encena uma confirmação destrutiva para uma recusa já conhecida

Intacto. `LocalAtlasSection._openMenu` acrescenta "Excluir" incondicionalmente, sem consultar o
tamanho da lista; o `showConfirm` de `deleteLocalAtlasFromPage` mostra o texto vermelho irreversível;
e só depois `deleteLocalAtlas` (`frontend/src/js/store/local-atlas.api.js`) devolve o desfecho de
último atlas por `LocalAtlasError`, com a mensagem certa. A recusa é boa; o caminho até ela é que
assusta sem motivo, e o visitante de primeira viagem tem exatamente um atlas. **Correção:** omitir ou
desabilitar o item quando houver um só, com o motivo no `title`.

### BAIXO

#### B1 (antigo M10) Entrar numa conta não diz nada sobre o trabalho local que ficou para trás

**Rebaixado de MÉDIO.** O desfecho de dados é o CORRETO: `syncEngine.login` não toca no store e
`AccountControl.openProjectPicker` apenas navega. Nada é apagado. E a leitura de `initProjectsPage`
mostra que a seção "Neste computador" é o PRIMEIRO bloco do corpo, acima da grade do servidor, então
o atlas está à vista, não escondido. O que sobra é nicety: o visitante que desenhou uma tarde inteira
e entrou numa conta chega numa tela de seleção sem confirmação explícita de que aquilo continua ali.

#### B2 (antigo M5) O teto de dez atlas locais só se anuncia depois de o usuário digitar o nome

**Rebaixado de MÉDIO, e metade dele é recusa deliberada.** O comentário de
`LocalAtlasSection._createTile` diz por extenso que a peça NÃO é desabilitada no teto, porque a
recusa carrega uma mensagem que explica o que fazer e um botão morto não explica nada. Esse
argumento é bom e não deve ser desfeito. O contador (`N de 10`) existe e é desenhado a cada
`_render`. O que sobra é o contador não ter voz: nenhum `title`, nenhuma mudança de rótulo perto do
teto. Ver a pergunta P6.

#### B3 Crases literais em texto de usuário

Intacto: o `showConfirm` de `handleExport`
(`frontend/src/js/import_export/export-import.service.js`) contém a palavra `.ebgeo` entre crases na
mensagem, e `ConfirmModal` renderiza a mensagem como texto puro, então as crases aparecem na tela.
Convenção de código vazando para a interface.

#### B4 A confirmação de exclusão de atlas local fala de servidor a quem não tem conta

Intacto: o texto de `deleteLocalAtlasFromPage` (`frontend/src/js/projects/projects-page.js`) fala em
trabalho ainda não enviado ao servidor, o que para o anônimo descreve um caminho que ele nunca teve.

#### B5 "Configurações" do atlas promete compartilhamento num atlas local

Intacto: o rodapé do painel de aparência (`frontend/src/js/modals/atlas-settings.modal.js`) diz que a
escolha vale para este atlas, neste computador, e para quem o compartilha; a segunda metade não
significa nada para o perfil.

#### B6 O parâmetro de aviso é ecoado sem checar sessão

Intacto: `explainArrivalFromUrl` (`frontend/src/js/projects/projects-page.js`) traduz o código de
atlas excluído por outro para uma frase sobre o proprietário, para qualquer visitante que chegue com
o parâmetro. Só alcançável por URL montada à mão; custo de correção é uma condição.

#### B7 A confirmação de e-mail só é consumida depois de boa parte do boot do mapa

Intacto, com uma nota de precisão: `handleEmailVerificationFromUrl` roda DEPOIS de `createControls`
ser aguardado e do controlador de modo de visão, e ANTES de `bootRendered`. Ou seja, quem clica no
link de confirmação espera os controles do MapLibre carregarem antes de ler uma frase, mas não o
render inicial completo. A auditoria original dizia "depois do `bootRendered`", e isso está errado.

#### B8 O `.ebgeo` não aparece nas abas chamadas Importar e Exportar

Intacto: `IMPORT_FORMATS` (`frontend/src/js/sidebar/tabs/import.tab.js`) lista GeoJSON, Shapefile,
KML/KMZ, GPX e CSV, e a aba de exportar oferece PDF, Garmin, KMZ e imagem. O formato próprio do
produto só existe na aba Mapas e no arrastar-e-soltar.

#### B9 O catálogo vazio nunca diz que entrar o aumenta

Intacto: `createCatalogGrid` (`frontend/src/js/catalog/components/catalog-grid.js`) mostra a mesma
frase de nada encontrado para todos os casos. Não mostrar recurso privado é correto por sigilo; não
mencionar que existe outro catálogo é a mesma perda de descoberta do M1.

#### B10 Um JSDoc contradiz o código na direção que faz alguém "consertar" o certo

Intacto, e vale reafirmar porque é o tipo de erro que se propaga: o bloco de `acquireTabLock`
(`frontend/src/js/utilities/tab-lock.js`) afirma que a abertura de link público em `index.js` é a que
ainda pede sem testemunha. `openPublicAtlasFromUrl` passa `witness: remoteMountWitness(atlas.id)`, e
o comentário no ponto da chamada explica por extenso que aquele era o quarto sítio destrutivo e foi
ligado. A afirmação do JSDoc é falsa, e a seção de furos abertos do mesmo arquivo a repete como se
fosse um buraco vivo.

---

## 4. Achados NOVOS

**OS QUATRO SAÍRAM na baixa contra `59e9600c`, e nenhum foi lido antes de ser fechado.** Eles
nasceram desta revisão, escrita em `11150029`, e o commit seguinte atacou exatamente esta superfície
(a fronteira entre cadastro, confirmação de e-mail e login) a partir do relatório do perfil vizinho.
É o caso mais limpo do conjunto para a tese de que os cinco perfis compartilham telas: quatro
achados deste perfil foram resolvidos por um trabalho que não olhava para ele.

O texto original de cada um fica abaixo, com a baixa em seguida, porque o registro do que foi olhado
não se apaga.

Quatro coisas que não constam da auditoria original. Duas nasceram do lote e duas estavam na tela
desde antes e escaparam, todas na fronteira entre o cadastro e a recuperação, que é a superfície onde
este perfil mais depende de texto.

**N1. O mailer escolhe a frase da senha por um predicado diferente do que monta a rota, e o
comentário nomeia o predicado errado.** `sendAccountExistsEmail` (`backend/src/utils/mailer.js`)
decide entre "use Esqueci minha senha" e "peça ao administrador" lendo `isSmtpConfigured`, enquanto
`backend/src/modules/auth/auth.routes.js` monta as rotas de recuperação por `canDeliverAccountMail`;
o comentário logo acima da escolha atribui `isSmtpConfigured` justamente a `auth.routes.js`, o que é
falso. Fora de produção os dois discordam: a rota existe, a tela oferece o formulário, e a mensagem
que chega ao candidato diz que este servidor não tem redefinição automática. Nasceu do lote.

**BAIXA: RESOLVIDO em `59e9600c`.** `sendAccountExistsEmail` (`backend/src/utils/mailer.js`) deriva a
linha da senha de `canDeliverAccountMail()`, o mesmo predicado que monta as rotas, e o comentário
logo acima foi corrigido para nomeá-lo. O comentário novo registra a lição, que é a parte que
sobrevive: uma frase derivada do predicado ERRADO mente igual a uma frase fixa, e o defeito foi
cometido de novo ao consertar o anterior.

**N2. O mesmo e-mail manda usar uma opção que a tela de cadastro não tem.**
`sendAccountExistsEmail` instrui a usar a opção de reenviar a confirmação na tela de cadastro, e
`SignupModal._createForm` não a tem: `apiClient.resendVerification` tem **um único chamador** em todo
`frontend/src/`, dentro do diálogo pós-cadastro de `AccountControl._handleRegister`. Fechou o
diálogo, acabou o reenvio. E a recuperação nova não cobre este caso de propósito, porque só alcança
endereço confirmado. Estava na tela desde antes; o lote reescreveu as linhas vizinhas e deixou esta.

**BAIXA: RESOLVIDO em `59e9600c`.** `apiClient.resendVerification` deixou de ter um chamador só.
Ele tem três: o diálogo pós-cadastro do mapa, o de `atlas.html` e, o que fecha este achado,
`LoginModal._resendVerification`, ao lado do erro de login. A rota passou a aceitar usuário OU e-mail
(`.xor`, `backend/src/modules/auth/auth.schemas.js`), que era a condição para o reenvio existir numa
tela que só tem o usuário digitado.

**N3. Teclar Enter para dispensar o aviso pós-cadastro REENVIA o e-mail.**
`AccountControl._handleRegister` chama `showConfirm` com um parágrafo de três frases no lugar do
TÍTULO e com o botão afirmativo valendo "Reenviar e-mail" e o negativo valendo "Entendi". Em
`ConfirmModal` o primeiro argumento vira o `<h3>`, então o parágrafo é renderizado como cabeçalho; e
o ouvinte de teclado liga `Enter` ao ramo afirmativo sempre que não houver `choices`, isto é, ao
reenvio. Uma ação de rede disparada pela tecla que todo mundo usa para dispensar um diálogo.

A segunda metade é da mesma família: `SignupModal._handleSubmit` aguarda o callback e só então fecha,
de modo que o formulário de cadastro, **com a senha digitada**, permanece montado atrás do diálogo, e
ao dispensá-lo a pessoa fica olhando o mapa anônimo sem próximo passo. **Correção:** fechar o
cadastro antes de anunciar e inverter os dois botões, ou usar `showChoice`, cujo `Enter` é inerte de
propósito.

**BAIXA: RESOLVIDO em `59e9600c`, pelas DUAS correções que este achado propôs, não por uma.** O
diálogo virou `showChoice` (sem botão afirmativo, `Enter` inerte) e o formulário de cadastro fecha
ANTES do anúncio, nas duas páginas que cadastram. O porquê está escrito no ponto
(`account.control.js`), e não só no commit.

**N4. O código de e-mail não confirmado não é lido no login, e agora custa mais caro.** O servidor
devolve um código próprio ao recusar login por e-mail pendente (`backend/src/modules/auth/auth.service.js`),
e `LoginModal._handleSubmit` só olha a mensagem, então não há botão de reenvio ao lado do erro. Antes
do lote isso era um incômodo; agora é a diferença entre ter e não ter saída, porque a recuperação de
senha nova é fechada a quem não confirmou (decisão 1.3) e o único reenvio é o de uso único do N2.
**Correção:** ler o código do erro no `LoginModal` e oferecer o reenvio ali, que a rota é anônima e
não vaza existência.

**BAIXA: RESOLVIDO em `59e9600c`, pelo caminho exato que o achado propôs.** `LoginModal` lê
`error?.code === 'EMAIL_NOT_VERIFIED'` e desenha a ação de reenvio ao lado do erro. O comentário no
ponto acrescenta o que o achado não dizia e que decide o desenho: o botão é CONDICIONAL ao código, e
não permanente, porque um botão de reenvio sempre visível convidaria qualquer pessoa a sondar
endereços.

---

## 5. O que está BOM e não deve ser mexido

Esta seção não é cortesia. Cada item é uma decisão que custou caro e que uma "simplificação" futura
desfaria. Os doze itens originais foram reconferidos contra o código nesta revisão; três mudaram de
entorno e estão anotados, e dois nasceram no lote.

1. **A separação entre esvaziar o atlas montado e destruir namespaces remotos.** `clearAllDataStore`
   e `discardRemoteAtlasNamespaces` (`frontend/src/js/store/store.js`) documentam por extenso por que
   a varredura deixou de ser efeito colateral de um wipe, e o caso que motivou a mudança é
   exatamente o deste perfil: o visitante de link público destruía o namespace que acabara de
   registrar. Hoje o trabalho local do anônimo não é alcançado por caminho nenhum de sessão.
2. **A ordem de `openPublicAtlasFromUrl`, e ela sobreviveu à reescrita do lote.** Resolver o link,
   reivindicar o tab-lock COM testemunha (`remoteMountWitness`), `activateRemoteAtlas`, e só então
   `clearAllDataStore({ markLocal: false })`. É o que garante que o wipe cai no namespace público e
   nunca no slot local, e cada passo carrega o comentário do defeito que fecha. **O lote partiu o
   `try` em dois sem tocar nesta ordem**, que é o desfecho certo: a resolução é uma leitura e não
   destrói nada, então adiar a reivindicação custa um round trip e nenhum dado.
3. **A frase única para todas as recusas de link, e o 429 fora dela.** Novo, e é o item que mais
   corre risco de ser "consertado" por quem leia o código sem o `fileoverview`: distinguir 403 de 404
   no cliente parece precisão e é a reconstrução do oráculo que a cláusula 5.6 fecha no servidor. O
   teste `frontend/tests/unit/link-publico-morto-fala.test.js` reprova a distinção por igualdade byte
   a byte, com controle negativo escrito contra essa tentação exata.
4. **A URL só perde o link quando o servidor o recusou.** `shouldForgetPublicLink` é a exceção
   estreita ao contrato de `buildAtlasSearch` (`frontend/src/js/deep-link/atlas-link.js`), que
   PRESERVA o parâmetro em todo `clearAtlasUrl` para que um visitante anônimo não perca o link num
   disconnect. Alargar a exceção para as faixas transitórias destruiria um link bom por causa de um
   piscar de rede.
5. **Os textos do tab-lock.** `OVERLAY_TEXT`, `TEARDOWN_OVERLAY`, `TEARDOWN_OVERLAY_LOCAL_DELETED` e
   `DEGRADED_NOTICE` (`frontend/src/js/utilities/tab-lock.js`) são o melhor conjunto de mensagens do
   repositório: cada estado tem texto próprio, cada um diz o que custa a ação oferecida, e o caso
   degradado é banner e não overlay porque o lock falha aberto. Não unifique nada disso. (O JSDoc
   errado do B10 é de outra parte do arquivo e não contamina as frases.)
6. **`store-error-listener.js` nunca vaza o motivo técnico.** O motivo devolvido por
   `checkPermission` é uma frase de desenvolvedor, e `registerStoreErrorListeners` a substitui pela
   frase de usuário ou pela mensagem explícita do bloqueio, com debounce por tipo.
7. **`CommentOverlay.togglePlacement` nomeia o motivo real entre três.** O comentário no código diz
   por quê, e a razão vale como princípio para o resto do produto. O ajuste do M6 é uma quarta frase,
   não uma revisão do desenho.
8. **A cópia da seção local em `atlas.html`,** e o convite que termina dizendo que os atlas deste
   computador continuam funcionando sem conta (`createServerInvite`). É o texto certo; os achados A3
   e M1 pedem que ele apareça em mais lugares, não que mude.
9. **O gate do cadastro pela bandeira do servidor.** `AccountControl._handleLogin` só monta "Criar
   conta" onde a rota está montada, evitando um 404 sem saída. O M2 pede que `atlas.html` faça o
   mesmo, não que este afrouxe. **Mudou de vizinhança sem perder a propriedade:** o painel de
   recuperação de senha adotou o MESMO desenho, gateando o formulário de e-mail por
   `emailRecoveryEnabled` sobre a bandeira que o servidor publica, em vez de tentar e capturar um 404.
10. **A resposta uniforme do cadastro, e agora também a da recuperação.** `register`
    (`backend/src/modules/auth/auth.service.js`) devolve o mesmo 201 nos dois desfechos, com o hash
    computado antes do ramo para fechar o oráculo por tempo; `requestPasswordReset` responde igual
    haja ou não conta resetável, e `CODE_REQUESTED_TEXT` foi escrito para sobreviver aos dois
    desfechos sem enumerar os motivos de nada chegar. **Novo, e é a mesma disciplina estendida.**
11. **A confirmação da poda de saída.** Contar tudo, nomear no máximo três, nunca mostrar id cru, e
    ter um "Cancelar" que aborta antes do trabalho irreversível. O M8 pede a distinção entre privado e
    desconhecido; o resto está certo.
12. **A exclusão de atlas local relata três desfechos, inclusive o meio-termo.** `deleteNotice`
    (`frontend/src/js/projects/local-atlas-notices.js`) trata banco bloqueado com uma instrução
    executável em vez de um sucesso falso.
13. **`ViewModeController`** usa classe no `body` em vez do sistema de perfis, com o motivo escrito, e
    cai para leitura sem que o usuário precise entender por quê. É o que faz a leitura-somente do
    visitante público chegar à tela sem que a interface precise conhecer o conceito de visitante.
14. **A tabela de ações decide pelo STORE, e a escada decide depois, por fora.** O `fileoverview` de
    `frontend/src/js/sidebar/tabs/atlas-actions.js` insiste que ler a tabela sozinha nunca deve ser
    confundido com ler o gate, e que a linha é um TETO. **Mudou desde a auditoria:** a decisão saiu
    de `maps.tab.js` para um módulo de dois imports, testável em node puro, e o que antes se
    verificava por regex sobre o texto do arquivo agora se verifica por asserção. Não devolva a
    tabela para dentro da aba.

---

## 6. Achados que SAÍRAM

Não se apaga o registro: quem ler daqui a três meses precisa saber que aquilo já foi olhado.

### Na baixa contra `59e9600c` (2026-08-24), SETE

O detalhe de cada um fica no lugar de origem, marcado `[RESOLVIDO em 59e9600c]`. Em resumo:

- **M2** "Criar conta" em `atlas.html`, por bandeira, com o porquê da bandeira escrito.
- **M3** A confirmação de e-mail passou a ler código e propósito; quatro recusas do servidor deixaram
  de colapsar em uma.
- **M5** "Importar" some para quem não escreve e recusa na entrada para quem passar pelo DOM velho.
- **N1** O mailer passou a derivar a frase da senha do predicado que monta a rota.
- **N2** O reenvio da confirmação deixou de ter um chamador de uso único.
- **N3** `Enter` no aviso pós-cadastro deixou de disparar rede.
- **N4** O login lê o código de e-mail não confirmado e oferece o reenvio ali.

**O que a baixa NÃO alcançou, e é a informação mais útil daqui:** os QUATRO altos continuam de pé,
intactos, e nenhum deles depende de decisão do dono. A1 encolheu para uma frase numa tabela pura; A2
continua sem consumidor de interface para `isVisitor()`; A3 continua com a cópia honesta presa em
`atlas.html`; A4 continua com o marcador de camada indisponível numa superfície só.

### Da revisão anterior

- **C1 (crítico) O visitante de link público recebia o botão "Compartilhar", que levava a um beco
  fechado.** Resolvido pela decisão 1.4, por caminho diferente do proposto: em vez do predicado de
  autenticação que o achado sugeria, o filtro é a escada (`atlasRoleHasAtLeast(role, 'manage')`), o
  que fecha de uma vez o visitante público, o Leitor, o Comentarista e o Editor, e não só o anônimo.
  A porta somente-leitura `participants` nasceu no lugar, exigindo conta.
- **A1 (alto) Não existia recuperação de senha em lugar nenhum.** Resolvido pela decisão 1.3, nas
  duas vias, e a via do administrador está escrita na tela em toda implantação, que era o mínimo que
  o achado pedia.
- **A3 (alto) Link público inválido, expirado ou revogado falhava em silêncio absoluto.** Resolvido
  pela decisão 1.1, com uma divergência deliberada e bem argumentada: as quatro situações continuam
  colapsadas numa frase só, por anti-enumeração, e o que se distingue são as faixas transitórias.

---

## Nota de método

Nenhum arquivo de código foi modificado nesta revisão, nenhum commit foi feito, e o único arquivo
escrito foi este. As afirmações do servidor foram conferidas nos módulos de autenticação, atlas e
configuração de `backend/src/`, mais o middleware de sessão; as do cliente, lendo os arquivos citados.
Onde este documento afirma ausência (por exemplo, "zero consumidores de `GuardAction.IMPORT_DATA`", ou
"nenhum consumidor de interface para `isVisitor`"), a afirmação vem de varredura sobre
`frontend/src/js/` inteiro.

**O critério de alcance da baixa contra `59e9600c`, dito por extenso porque é ele que impede a
superdeclaração.** Reabrir 28 achados à mão e declarar 21 intactos seria conferência de fé. O que
foi feito: os arquivos que o commit tocou foram extraídos de `git show --name-only`, os caminhos
citados em cada achado foram extraídos do texto, e a interseção foi computada. Um achado cujos
arquivos o commit NÃO tocou não pode ter sido resolvido por ele, e isso não é leitura, é propriedade.
Os achados da interseção (doze) foram abertos um a um contra o código. **A interseção erra nos dois
sentidos e as duas correções foram feitas na mão:** ela acusa por citação incidental (A2 cita
`session-context.js` só de passagem) e deixa passar o achado que descreve o alvo por símbolo em vez
de caminho, que é como N2 e N3 quase escaparam. Ou seja, ela estreita o trabalho, não o substitui.

Duas ressalvas de alcance, para não superdeclarar:

- **Este arquivo não está sob nenhum guarda.** `frontend/tests/unit/docs-integridade.test.js` varre
  `docs/`, `.claude/` e uma lista de alvos escrita à mão, e a raiz do repositório não é varrida.
  Caminho e símbolo citados aqui não são verificados por teste nenhum: que estivessem todos certos na
  conferência de hoje é resultado de leitura, não propriedade mecânica. Se o conteúdo for adotado, o
  destino é a wiki, com o recorte que ela exige.
- **A revisão é uma leitura de código, não uma medição de tela.** Nenhum achado deste documento foi
  reproduzido no navegador nesta passada. Onde a afirmação é sobre o que aparece (o toast que some, o
  `title` que não existe no toque), ela é a leitura do código que desenha, e a verificação por
  captura do Playwright continua devendo.
