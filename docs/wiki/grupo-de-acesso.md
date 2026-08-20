# Grupo de acesso (o beneficiário coletivo de uma concessão)

O coletivo a quem se concede acesso a um recurso privado: quem pode compô-lo, por que listar e administrar têm gates diferentes, e por que apagá-lo revoga sem escrever uma linha de concessão.

Ele é o segundo tipo de beneficiário de [[acesso-a-recurso-privado]], alternativo à pessoa e nunca simultâneo a ela. Nada aqui tem parentesco com o eixo por atlas de [[permissoes-atlas]], nem com os grupos de FEIÇÃO de um mapa, que dividem a palavra e não o conceito.

## Por que ele existe: a metade que faltava

As duas tabelas, a coluna de beneficiário coletivo em `resource_grants` e o braço de grupo de `fn_granted_resource_ids` nasceram todos com `backend/src/database/migrations/008_acesso_a_recurso.sql`, e até 2026-08-19 nenhuma linha de JavaScript os tocava: uma varredura por `grantee_group_id` em `backend/src/` fora das migrações devolvia zero, e a coluna só se preenchia por SQL direto. Ou seja, o predicado tinha um ramo que nunca devolveu uma linha em produção.

Esse é literalmente o defeito que a 008 removeu do schema `ng`, onde a escrita de permissão por grupo funcionava enquanto a entidade de grupo e a de membros não tinham um escritor sequer. **Mecanismo pela metade parece inteiro no schema, e o schema é onde se audita.** A lição operacional: ao acrescentar um terceiro tipo de beneficiário, é a metade da ESCRITA que decide se ele existe, não a coluna.

## A autoridade é o papel global de DADO, e não só o administrador

Administra grupo quem passa por `requireGlobalDataAccess` (`backend/src/middleware/resource-access.js`), isto é, administrador **ou** credenciado, resolvido no banco por `fn_has_global_data_access` e nunca por comparação de papel em JavaScript.

Esta é a **primeira escrita que o papel `credenciado` ganha**: até aqui a definição dele era "lê todo recurso privado e não escreve nada". O argumento que sustenta a exceção, e que precisa ser relido antes de estendê-la a qualquer outra coisa: ele já enxerga todo recurso privado, então compor um grupo não lhe abre alcance nenhum sobre dado; o que um grupo muda é a quem **ele** repassa, e repassar continua passando por `requireResourceShare`. A alternativa recusada foi `requireAdmin`, e o registro datado com as consequências está em [`decisions-2026.md`](../decisions/decisions-2026.md).

Ele continua não sendo administrador do sistema: usuários, organizações, catálogo e configuração seguem fora do alcance dele.

## Listar e administrar são perguntas diferentes, e por isso os gates divergem

A listagem de grupos é `auth` sozinho; as outras seis rotas do módulo levam o gate de papel global (`backend/src/modules/access-groups/access-groups.routes.js`). A assimetria quebra o produto nos dois sentidos se for desfeita:

- **fechar a listagem** tiraria do seletor de compartilhar todo mundo que não é administrador nem credenciado. Quem tem `view_share` num recurso concede a um grupo, e quem autoriza isso é `requireResourceShare`, que não pergunta papel global nenhum: sem poder listar, ele não tem como escolher um grupo, e o ramo de grupo do predicado volta a ser inalcançável pela interface, que é o defeito que este módulo existe para fechar;
- **abrir a escrita** para além do papel global deixaria qualquer pessoa com `view_share` num recurso qualquer criar grupos e pôr gente dentro, o que é autoridade sobre a composição de quem vê o quê no sistema inteiro.

**A lista de MEMBROS fica do lado fechado**, junto com a escrita, e o critério é o tipo de dado: nome de grupo é vocabulário organizacional e serve ao seletor; quem está dentro dele é roster de pessoas, e o seletor não precisa dele, porque a contagem que `LIST_GROUPS` devolve já basta para a tela dizer quantas pessoas o grupo tem. As duas rotas de leitura estão classificadas com essa justificativa no censo de superfícies (`backend/tests/unit/superficies-de-recurso-censo.test.js`).

## Apagar o grupo revoga, e nenhuma concessão é reescrita

A exclusão é soft, e `fn_user_group_ids` exige grupo vivo. Então **"apagado" e "não concede mais" são o MESMO fato**, não dois que precisam concordar, e não existe uma segunda escrita em `resource_grants` que possa ficar para trás. É a mesma leitura que faz o prazo de uma concessão morrer dentro do predicado em vez de num sweeper.

Podar as concessões junto foi recusado pela razão que faz a revogação ser soft em todo este eixo: apagar linha apaga a resposta de "por que o grupo X tinha acesso ao recurso Y". O que a exclusão precisa levar para a trilha é o **alcance**, lido antes do ato: sem a contagem de concessões e de membros, a linha de auditoria diria "apagou um grupo" quando o que aconteceu foi "tirou o acesso de N pessoas a M recursos" (ver [[auditoria]]).

## As três consultas que precisam concordar

O braço de grupo não é uma consulta só, e a fase que o acrescentou teve de tocar três lugares no mesmo commit. Errar uma delas produz falha silenciosa, nunca erro:

- `LIVE_GRANTS_OF_ACTOR` decide se o servidor **aceita** o repasse, e `LIST_SHAREABLE_OF_ACTOR` decide se a interface **oferece** o botão. Com só a primeira, quem recebeu `view_share` através de um grupo tem a permissão e nenhuma porta, o que na tela é indistinguível de não ter a permissão.
- `LIST_GRANTS_FOR_RESOURCE` é a tela "quem tem acesso", e ela juntava o beneficiário em `users` por INNER JOIN. Numa concessão a grupo o beneficiário-pessoa é nulo por CHECK, então **a linha inteira sumia da resposta**: conceder devolveria 201 e a lista continuaria vazia, sem erro em lugar nenhum. Hoje as duas junções de beneficiário são `LEFT`, e a consulta filtra fora o grupo já apagado, porque ele não entrega acesso a ninguém e mantê-lo faria a tela chamada "quem tem acesso" listar quem não tem.

Duas armadilhas de forma no mesmo território, e as duas custam silêncio em vez de erro: os dois beneficiários são **alternativos**, então uma consulta única parametrizada pelas duas colunas compara sempre contra NULL e devolve zero linha (o motivo de `LIVE_GRANT_FROM_ACTOR_TO_GROUP` ser uma consulta separada da irmã de pessoa, e não um `COALESCE`); e o beneficiário-coletivo precisa ser conferido VIVO antes do `INSERT_GRANT` (`GET_LIVE_GROUP`), porque a FK aceita um grupo apagado e a concessão nasceria morta, com 201 na resposta e acesso nenhum na prática.

Um caso degenerado é recusado com 409: conceder ao mesmo grupo de onde a própria autoridade veio. Ele é o análogo coletivo de conceder a si mesmo, não é pego pela checagem de duplicata (que compara quem concedeu, e o pai veio de outra pessoa) e não daria a ninguém acesso que o grupo já não tivesse.

## O nome qualifica de propósito

`public.groups` existe desde a primeira baseline e é outra coisa: os grupos de feição dentro de um mapa. Daí a tabela ser `access_groups`, e daí o alvo de auditoria da migração `backend/src/database/migrations/009_grupos_de_acesso.sql` ser `ACCESS_GROUP` e **não** reusar o `GROUP` que já estava no vocabulário. Reusar faria as duas trilhas caírem no mesmo balde do índice de alvo, e "o que já foi feito com este grupo" passaria a ter duas respostas misturadas.

As cinco ações são `ACCESS_GROUP_CREATE`, `ACCESS_GROUP_UPDATE`, `ACCESS_GROUP_DELETE`, `ACCESS_GROUP_MEMBER_ADD` e `ACCESS_GROUP_MEMBER_REMOVE`: cinco e não três porque o ciclo de vida do grupo e a composição dele são perguntas diferentes na investigação, e "desde quando esta pessoa estava no grupo" (a pergunta que explica por que ela viu um recurso) exige uma linha por movimento de membro. **Conceder a um grupo não tem ação própria**: continua emitindo `PERMISSION_GRANT` com o recurso como alvo, porque o fato auditado é o mesmo e separar por tipo de beneficiário partiria a história de um acesso em duas listas que não se cruzam.

## Propriedades permanentes do desenho

- **A composição é plana.** Não há grupo dentro de grupo, e resolver hierarquia exigiria recursão dentro do predicado, que é chamado de dentro de toda consulta de recurso.
- **O grupo tem autor, e não tem dono.** Quem criou fica registrado e aparece na lista, mas nenhum gate lê esse campo: a autoridade para compor qualquer grupo é a mesma para todos os grupos, porque o grupo é vocabulário global do sistema. Ele também não tem escopo de OM, e a lotação de quem está dentro não restringe nada (ver [[gestao-usuarios]]).
- **Membro desativado não é membro para o predicado.** A liveness do beneficiário mora em `fn_principal_vivo`, então a linha de composição sobrevive à desativação da conta e não entrega acesso nenhum. Tirar do grupo alguém já desativado continua sendo legítimo.
- **Revogar por exclusão do grupo vale no próximo pedido do payload aditivo** (troca de atlas ou F5), como toda revogação deste eixo: não há push em socket vivo.

## No cliente

O cliente fala com o módulo por `listAccessGroups` e pelos irmãos de escrita (`frontend/src/js/store/sync/api-client.js`), e a divisão de público espelha a do servidor: a listagem alimenta o seletor do modal de compartilhar recurso, aberto a qualquer pessoa autenticada, e o resto (criar, renomear, apagar, ver e mover membros) é a aba montada por `createGroupsTab` no Painel do Administrador. Nenhuma dessas telas é a fronteira: o servidor recusa a escrita de quem não passa no gate, e o Painel passa a ter **três públicos** em vez de dois, porque o credenciado alcança essa aba e nenhuma outra.

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
