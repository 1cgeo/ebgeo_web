# Grupo de acesso (o beneficiário coletivo de uma concessão)

O coletivo a quem se concede acesso a um recurso privado: quem pode compô-lo, por que listar e administrar têm gates diferentes, e por que apagá-lo revoga sem escrever uma linha de concessão.

Ele é o segundo tipo de beneficiário de [[acesso-a-recurso-privado]], alternativo à pessoa e nunca simultâneo a ela. Nada aqui tem parentesco com os grupos de FEIÇÃO de um mapa, que dividem a palavra e não o conceito.

> **Esta abertura dizia que o grupo não tem parentesco nenhum com o eixo por atlas, e desde 2026-08-21 isso é falso.** Um grupo é hoje um alvo de `atlas_shares` (`num_nonnulls(user_id, group_id) = 1`), com os mesmos quatro níveis concedíveis, `manage` inclusive. Os dois eixos continuam sendo dois (o de RECURSO e o de ATLAS não compartilham uma palavra), mas o grupo passou a ser a ponte entre eles, e é isso que muda o que apagá-lo custa. Ver [[compartilhamento-atlas]] e [[permissoes-atlas]].

## Por que ele existe: a metade que faltava

As duas tabelas, a coluna de beneficiário coletivo em `resource_grants` e o braço de grupo de `fn_granted_resource_ids` nasceram todos com `backend/src/database/migrations/008_acesso_a_recurso.sql`, e até 2026-08-19 nenhuma linha de JavaScript os tocava: uma varredura por `grantee_group_id` em `backend/src/` fora das migrações devolvia zero, e a coluna só se preenchia por SQL direto. Ou seja, o predicado tinha um ramo que nunca devolveu uma linha em produção.

Esse é literalmente o defeito que a 008 removeu do schema `ng`, onde a escrita de permissão por grupo funcionava enquanto a entidade de grupo e a de membros não tinham um escritor sequer. **Mecanismo pela metade parece inteiro no schema, e o schema é onde se audita.** A lição operacional: ao acrescentar um terceiro tipo de beneficiário, é a metade da ESCRITA que decide se ele existe, não a coluna.

## A autoridade é a POSSE, e o grupo é coisa de usuário

Administra grupo o **dono vivo** dele, ou o administrador do sistema. A pergunta tem uma definição só, `fn_can_administer_group` (`backend/src/database/migrations/011_grupo_com_dono_e_producao.sql`), chamada de três lugares que precisam concordar: o gate das cinco rotas de escrita (`requireGroupAuthority`), o recorte da listagem (`LIST_GROUPS`) e o beneficiário coletivo de uma concessão nova (`GET_ADDRESSABLE_LIVE_GROUP`). O literal do papel mora em SQL, e não em JavaScript, pelo motivo de sempre: o token vive até 15 min e `flexibleAuth` não reconcilia.

Qualquer sessão autenticada cria um grupo, e quem cria vira o dono (`access_groups.owner_id`, coluna separada de `created_by`: quem criou é história e quem manda é autoridade, e fundir as duas impediria qualquer transferência sem falsificar o registro de criação).

**Isto SUPERA a decisão de 2026-08-19**, que dizia que administrava grupo quem tinha papel global de DADO (administrador **ou** credenciado) e que era, à época, a primeira escrita do papel `credenciado`. Com o compartilhamento de atlas passando a valer por grupo, aquele desenho abria um encadeamento curto: quem manda em grupo distribui acesso a atlas que não é dele. O credenciado mantém o eixo de RECURSO inteiro (lê todo privado sem concessão, concede de raiz nos dois níveis, revoga o que ele deu) e perde exatamente um item: autoridade sobre grupo alheio. O registro datado das duas decisões está em [`decisions-2026.md`](../decisions/decisions-2026.md).

**O grupo cujo dono foi desativado deixa de conceder.** `fn_user_group_ids` exige `fn_principal_vivo` do dono, e a checagem mora ali, no lugar mais fundo, de propósito: aquela função alimenta a resolução de leitura, o gate de repasse e o eixo de grupo em atlas, e pôr a condição num ramo só deixaria os outros abertos sem erro em lugar nenhum. Um grupo órfão (sem dono, resíduo de linha semeada por SQL direto) não entrega acesso a ninguém e continua administrável pelo administrador, que pode apagá-lo: é falha fechada, e o estado oposto (concede para sempre e ninguém administra) é o que a regra existe para impedir.

## Listar, participar e administrar são perguntas diferentes

São **três** leituras, e cada uma responde uma coisa (`backend/src/modules/access-groups/access-groups.routes.js`):

- **`GET /`** são os grupos que o chamador ADMINISTRA, com as duas contagens. `auth` sozinho, porque o recorte mora na consulta. É ela que alimenta o seletor do modal de compartilhar recurso, e recortá-la é a metade *visível* da regra do coletivo próprio;
- **`GET /participating`** são os grupos de que o chamador PARTICIPA, com o nome do dono e nada mais. Ela existe porque, com a listagem acima recortada, quem foi posto num grupo por outra pessoa deixaria de ver em lugar nenhum um mecanismo que decide o acesso dele a recurso privado, que é regressão de transparência sobre autorização. Ela não devolve roster nem contagens: quem participa vê QUE participa e a quem reclamar;
- **`GET /:groupId/members`** é o roster, e fica do lado FECHADO junto com a escrita, pelo tipo de dado: nome de grupo é vocabulário organizacional; quem está dentro dele é uma lista de pessoas.

**O roster fechado tem UMA travessia declarada, e ela é do eixo de ATLAS.** Desde que o grupo virou alvo de `atlas_shares`, a lista de participantes de um atlas expande os grupos em pessoas (`fn_atlas_member_ids`), então um atlas cujo único share seja um grupo mostra, a qualquer participante, um conjunto que coincide com aquele roster. A travessia foi aceita com o recorte escrito: a lista é do ATLAS, não do grupo: ela não diz de que grupo cada pessoa veio, não revela que grupos existem, e só é servida a quem já compartilha aquele atlas. Não a leia como permissão para afrouxar `GET /:groupId/members`, que continua fechado. Registro em [`../decisions/decisions-2026.md`](../decisions/decisions-2026.md) e detalhe em [[compartilhamento-atlas]].

A outra metade da regra do coletivo próprio é o mesmo predicado dentro do `WHERE` de `GET_ADDRESSABLE_LIVE_GROUP`, e **sem ela restringir a listagem seria só obscuridade**: o id do grupo viaja no corpo do `POST /grants`, e quem o adivinhe (ou o tenha visto antes) continuaria concedendo. A recusa é **404 e nunca 403**, uniforme para "não existe", "está apagado" e "não é seu": com a listagem recortada, um 403 contaria que aquele id existe.

**Conceder a um coletivo é DELEGAR ao dono dele.** Quem administra a composição do grupo pode estender aquele acesso a quem quiser, sem passar por `requireResourceShare` e sem criar linha nova em `resource_grants`. É por isso que a lista "quem tem acesso" (`LIST_GRANTS_FOR_RESOURCE`) nomeia o dono do grupo beneficiário: sem isso, a delegação é a única parte do mecanismo que não aparece em tela nenhuma. A mitigação só ficou completa em 2026-08-21, e vale saber por quê: por um dia o campo saiu do SQL e nenhum cliente o leu, de modo que a linha da concessão coletiva mostrava nome e tamanho do grupo e nada sobre a quem se estava delegando. Quem renderiza hoje é `granteeGroupOwnerLabel` (`frontend/src/js/catalog/grant-tree.js`), e a concessão a PESSOA continua sem rótulo de dono, que é o contraste que faz o rótulo informar. Da trilha do RECURSO continua não se vendo quem entrou no grupo depois, porque `ACCESS_GROUP_MEMBER_ADD` tem o grupo como alvo.

## Apagar o grupo PODA, e a linha do grupo sobrevive

Apagar o grupo continua sendo soft, e agora **revoga**: as concessões feitas ao coletivo e toda a subárvore que os membros alimentaram a partir delas, pela rotina única `podarPorRaizes` (`backend/src/modules/resource-access/resource-access.service.js`). Tirar alguém do grupo poda o que **ele** repassou através dele, seguindo a aresta `parent_grant_id`.

A versão anterior desta página dizia que a exclusão revogava **sem escrever uma linha** em `resource_grants`, e o argumento estava certo pela metade: `fn_user_group_ids` exige grupo vivo, então marcar a data corta o acesso DOS MEMBROS no mesmo instante. O que ele não via é o que os membros repassaram, isto é, linhas que apontam para terceiros que nunca estiveram no grupo, que o predicado não alcança, e que sobreviviam penduradas numa concessão viva cuja justificativa já não existia. Acesso órfão que nenhuma tela mostra como órfão.

O que se preserva não mudou, e é o que faz a revogação continuar soft: a linha do grupo fica na tabela com o nome legível, e a concessão fica revogada com `revoked_by`. As duas juntas respondem "por que o grupo X tinha acesso ao recurso Y". O que some de verdade é o **roster** (`access_group_members` não tem soft-delete), e por isso ele é copiado para os detalhes do `ACCESS_GROUP_DELETE` antes do commit, junto com o alcance: sem a contagem, a linha de auditoria diria "apagou um grupo" quando o que aconteceu foi "tirou o acesso de N pessoas a M recursos" (ver [[auditoria]]).

O roster gravado na trilha vem do `RETURNING` do PRÓPRIO esvaziamento, e não de uma leitura anterior. Enquanto vinha de `LIST_MEMBERS`, ele perdia o membro DESATIVADO, porque aquela consulta junta `users` com `is_active = true` de propósito (ela alimenta a tela, e listar um desativado prometeria um acesso que o predicado não entrega). O resultado era a mesma linha de auditoria trazendo `memberCount: 2` ao lado de `membros` com um nome só, e a pessoa desativada tendo a linha de composição apagada sem ficar registrada em lugar nenhum: o oposto exato do que a preservação do roster existe para garantir.

Uma consequência a aceitar de olhos abertos: o dono passa a revogar concessões que ele não concedeu (as que um administrador deu AO grupo dele, e as que os membros repassaram a partir dele). É mais largo do que `requireGrantRevoker` permite em geral, e é o que a cadeia de autoridade implica. Daí o campo de origem nos detalhes de cada `PERMISSION_REVOKE` da poda.

**E desde 2026-08-21 apagar o grupo derruba TAMBÉM o acesso a ATLAS que ele dava**, pelo mesmo mecanismo e sem escrita nenhuma: `fn_user_atlas_shares` consulta `fn_user_group_ids`, que exige grupo vivo. O socket de colaboração de um membro cai no primeiro heartbeat (~30 s) com `4003`, e a linha continua fisicamente em `atlas_shares` (o soft-delete não dispara o `ON DELETE CASCADE`), inerte. Ver [[compartilhamento-atlas]].

**BURACO CONHECIDO, e ele é de AVISO, não de mecanismo.** A frase de confirmação de apagar grupo (`groupDeletionWarning`, `frontend/src/js/admin/group-phrases.js`) conta só recursos, porque `LIST_GROUPS` só devolve `grant_count`: ela diz "derruba as concessões dele a 3 recursos" e cala sobre os atlas cujo acesso morre no mesmo ato. O toast pós-ato tem a mesma lacuna (`groupDeletionSummary` lê `grantsAffected`, que conta a poda de concessões). O conserto é uma subconsulta de `atlas_shares` em `LIST_GROUPS` e em `GET_GROUP_REACH`, mais um ramo na frase; a direção do erro é avisar de MENOS sobre um ato destrutivo, que é a direção ruim.

## As três consultas que precisam concordar

O braço de grupo não é uma consulta só, e a fase que o acrescentou teve de tocar três lugares no mesmo commit. Errar uma delas produz falha silenciosa, nunca erro:

- `LIVE_GRANTS_OF_ACTOR` decide se o servidor **aceita** o repasse, e `LIST_SHAREABLE_OF_ACTOR` decide se a interface **oferece** o botão. Com só a primeira, quem recebeu `view_share` através de um grupo tem a permissão e nenhuma porta, o que na tela é indistinguível de não ter a permissão.
- `LIST_GRANTS_FOR_RESOURCE` é a tela "quem tem acesso", e ela juntava o beneficiário em `users` por INNER JOIN. Numa concessão a grupo o beneficiário-pessoa é nulo por CHECK, então **a linha inteira sumia da resposta**: conceder devolveria 201 e a lista continuaria vazia, sem erro em lugar nenhum. Hoje as duas junções de beneficiário são `LEFT`, e a consulta filtra fora o grupo já apagado, porque ele não entrega acesso a ninguém e mantê-lo faria a tela chamada "quem tem acesso" listar quem não tem.

Duas armadilhas de forma no mesmo território, e as duas custam silêncio em vez de erro: os dois beneficiários são **alternativos**, então uma consulta única parametrizada pelas duas colunas compara sempre contra NULL e devolve zero linha (o motivo de `LIVE_GRANT_FROM_ACTOR_TO_GROUP` ser uma consulta separada da irmã de pessoa, e não um `COALESCE`); e o beneficiário-coletivo precisa ser conferido VIVO e ENDEREÇÁVEL antes do `INSERT_GRANT` (`GET_ADDRESSABLE_LIVE_GROUP`), porque a FK aceita um grupo apagado e a concessão nasceria morta, com 201 na resposta e acesso nenhum na prática.

Um caso degenerado é recusado com 409: conceder ao mesmo grupo de onde a própria autoridade veio. Ele é o análogo coletivo de conceder a si mesmo, não é pego pela checagem de duplicata (que compara quem concedeu, e o pai veio de outra pessoa) e não daria a ninguém acesso que o grupo já não tivesse.

## O nome qualifica de propósito

`public.groups` existe desde a primeira baseline e é outra coisa: os grupos de feição dentro de um mapa. Daí a tabela ser `access_groups`, e daí o alvo de auditoria da migração `backend/src/database/migrations/009_grupos_de_acesso.sql` ser `ACCESS_GROUP` e **não** reusar o `GROUP` que já estava no vocabulário. Reusar faria as duas trilhas caírem no mesmo balde do índice de alvo, e "o que já foi feito com este grupo" passaria a ter duas respostas misturadas.

As cinco ações são `ACCESS_GROUP_CREATE`, `ACCESS_GROUP_UPDATE`, `ACCESS_GROUP_DELETE`, `ACCESS_GROUP_MEMBER_ADD` e `ACCESS_GROUP_MEMBER_REMOVE`: cinco e não três porque o ciclo de vida do grupo e a composição dele são perguntas diferentes na investigação, e "desde quando esta pessoa estava no grupo" (a pergunta que explica por que ela viu um recurso) exige uma linha por movimento de membro. **Conceder a um grupo não tem ação própria**: continua emitindo `PERMISSION_GRANT` com o recurso como alvo, porque o fato auditado é o mesmo e separar por tipo de beneficiário partiria a história de um acesso em duas listas que não se cruzam.

## Propriedades permanentes do desenho

- **A composição é plana.** Não há grupo dentro de grupo, e resolver hierarquia exigiria recursão dentro do predicado, que é chamado de dentro de toda consulta de recurso.
- **O grupo tem autor E dono, em colunas separadas.** `created_by` é história e `owner_id` é autoridade; só o segundo é lido por gate. Esta linha dizia o oposto ("tem autor, e não tem dono... o grupo é vocabulário global do sistema"), e a inversão é a mudança de 2026-08-20. O que continua valendo: o grupo não tem escopo de OM, e a lotação de quem está dentro não restringe nada (ver [[gestao-usuarios]]).
- **A unicidade de nome é POR DONO**, entre os vivos. Global, ela faria o 409 falar de um grupo que o chamador não pode ver: recusa e vazamento na mesma resposta. O índice continua PARCIAL, para que um nome apagado possa voltar.
- **Membro desativado não é membro para o predicado.** A liveness do beneficiário mora em `fn_principal_vivo`, então a linha de composição sobrevive à desativação da conta e não entrega acesso nenhum. Tirar do grupo alguém já desativado continua sendo legítimo.
- **Revogar por exclusão do grupo vale no próximo pedido do payload aditivo** (troca de atlas ou F5), como toda revogação deste eixo: não há push em socket vivo.

## No cliente

O cliente fala com o módulo por `listAccessGroups` e pelos irmãos de escrita (`frontend/src/js/store/sync/api-client.js`), e a divisão de público espelha a do servidor: a listagem alimenta o seletor do modal de compartilhar recurso e traz só os grupos do próprio chamador, e o resto (criar, renomear, apagar, ver e mover membros) é a aba montada por `createGroupsTab`. Nenhuma dessas telas é a fronteira: o servidor recusa a escrita de quem não passa no gate. A aba deixou de ser privilégio de papel global e passou a ser a de todo mundo: os grupos de cada um.

**A aba tem DUAS seções, e a segunda é só leitura.** "Meus grupos" é a de gestão; "Grupos de que participo" (`listAccessGroupsParticipating`) mostra nome e dono, sem roster, sem contagem e sem botão, e some da lista o que a primeira seção já mostrou (o caso é o do administrador, que vê todos os grupos ali em cima). Ela é a metade de transparência de uma listagem recortada por posse: o mecanismo que decide o acesso da pessoa a recurso privado precisa ser visível para ela, e a única pessoa nomeada ali é o dono, que é a quem pedir entrada ou saída. A segunda também não mostra a DESCRIÇÃO do grupo: a consulta a devolvia e a tela a renderizava enquanto os dois blocos de comentário ao lado prometiam "nome do dono e nada mais", e ela saiu dos dois lados em 2026-08-21.

**A entrada para a página é uma decisão só.** O rótulo da porta e as abas de cada audiência vivem em `frontend/src/js/admin/admin-audience.js`, consultado pela própria página, pela barra do mapa e pelo seletor de atlas. Enquanto a regra vivia copiada nos três, a entrada podia aparecer numa tela e faltar na outra, sem nada ficar vermelho.

Duas propriedades que atravessam arquivos:

- **A leitura dos grupos falha em silêncio no modal de compartilhar, de propósito.** Eles são o seletor, não o conteúdo da tela: se a chamada falhar, ou se não houver grupo nenhum cadastrado, a seção de conceder deixa de oferecer a linha de grupo e o resto do modal continua funcionando. Derrubar o modal por causa do seletor tiraria também a concessão a pessoa, que não depende dele.
- **A linha de uma concessão coletiva não tem identidade de pessoa**, e o desenho da lista precisa perguntar (`isGroupGrant`, `frontend/src/js/catalog/grant-tree.js`) em vez de assumir: é a mesma armadilha do INNER JOIN, na camada de desenho.

A confirmação de apagar mostra o alcance antes do clique, e o aviso posterior reporta a contagem que o **servidor** devolveu, não a que a listagem tinha em mão: as duas podem discordar, e a que vale é a do ato.

## Relacionados

- [[acesso-a-recurso-privado]]: o eixo inteiro, com a concessão em árvore, o prazo e o empréstimo por atlas.
- [[auditoria]]: as cinco ações e o alvo próprio.
- [[gestao-usuarios]]: de onde vêm as pessoas que compõem o grupo.
- [[resources-catalogo]]: os recursos sobre os quais a concessão se dá.
- [[sintese-eixos-de-permissao]]: onde este eixo cruza com o papel global e com o eixo por atlas.
- [[modelo-de-dados]]: o achado que mediu meio eixo de permissão como defeito e decidiu a mudança de schema.
