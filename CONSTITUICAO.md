# Constituição do EBGeo: quem pode o quê

Escrita em 2026-08-20, a partir do texto do dono, conferida cláusula a cláusula contra o código por seis
auditorias independentes, e depois decidida por ele onde texto e código divergiam.

**A regra que rege este documento:** onde a constituição e o código divergem, **o texto é a especificação e o
código é que muda**. Foi a decisão do dono, e é o que torna este arquivo uma constituição e não um relatório.

Cada cláusula carrega um estado, e ele é o que impede este documento de mentir:

- **[vigente]** o código já faz isso hoje, e há teste;
- **[em obra]** decidido, com plano escrito e onda de implementação atribuída;
- **[pendente]** decidido, mas parado por dependência externa, com o motivo dito.

Documentação desatualizada engana mais do que documentação ausente, e engana em dobro um agente, que a trata
como verdade. Ao mudar o código, mude o estado da cláusula no mesmo commit.

**E essa regra já falhou uma vez, então ela deixou de ser regra escrita.** Em 2026-08-21 uma auditoria por
seções mediu as 55 cláusulas contra o código e achou que o commit das cinco ondas virara o estado de UMA:
vinte e três diziam "em obra" sobre coisas entregues, e doze carregavam uma frase começando em "Hoje" que
afirmava o oposto do código. Numa especificação isso não é ruído, é instrução: quem lê "não existe X em
lugar nenhum do servidor" vai implementar X uma segunda vez. Daí as duas amarras de hoje, e a segunda é a
que tem dentes:

- **toda cláusula vigente cita, entre crases, o arquivo de teste que a prende.** Apagar ou renomear esse
  teste fica vermelho apontando para a cláusula, porque `frontend/tests/unit/docs-integridade.test.js` valida
  todo caminho citado. É o que transforma "e há teste" de honra em verificação;
- **a lista das cláusulas não-vigentes é declarada em teste**, com o motivo de cada uma, por
  `frontend/tests/unit/constituicao-estado-das-clausulas.test.js`. Fechar uma, abrir uma nova ou mudar a
  natureza de uma exige tocar naquela lista.

Saiba o alcance, para não concluir do verde mais do que ele diz: nada disso verifica que uma cláusula é
VERDADE. O teste citado pode não provar o que a cláusula afirma, e nenhuma varredura sabe disso. O que está
garantido é que a citação existe, que ela aponta para arquivo que existe, e que o que está aberto é curto e
declarado.

---

## 1. Quem existe

**1.1** Existem quatro papéis globais, e eles **não formam uma escada**: `user` (Usuário), `producer`
(Produtor), `credenciado` (Credenciado) e `admin` (Administrador). Nenhum contém o outro. Comparar papel
global por ordem é erro de leitura, e um gate escrito como "diferente de usuário comum" promove o credenciado
em silêncio. **[vigente]** Preso por `backend/tests/unit/papel-global-censo.test.js`, que é censo: sítio
novo não classificado reprova, em vez de passar por omissão.

**1.2** Além dos quatro, o sistema conhece mais três tipos de principal, e omiti-los de um raciocínio de
autorização é como se erra:

- o **visitante deslogado**, que não é papel, é modo;
- o **visitante de link público**, que tem token próprio, não tem linha na tabela de usuários, e é confinado
  ao atlas que emitiu o link;
- o **principal por chave de API**, revogado por rotação de chave. **[vigente]**

Preso em três pedaços, e o terceiro é o mais fraco: o confinamento do visitante de link por
`backend/tests/integration/public-token-atlas-scope.repro.test.js`, a rotação de chave por
`backend/tests/integration/identity.test.js`, e "deslogado não é papel" apenas de lado, pelo CHECK que
`backend/tests/integration/papel-credenciado.test.js` cobra sobre os quatro valores. Ou seja: nada reprovaria
se alguém representasse o deslogado por um pseudo-papel fora da coluna.

**A chave de API NÃO é um principal restrito, e a vizinhança nesta lista sugere o contrário.** O visitante
de link ao lado dela é confinado a um atlas; a chave é **o usuário inteiro**: ela resolve para a linha de
`users` e carrega o **papel global**, administrador inclusive. Ela não tem escopo, não tem prazo, e o corte
de sessão em massa não a alcança, porque aquele corte compara o `iat` de um JWT e a chave não é JWT. As três
propriedades foram medidas em 2026-08-23 e estão registradas como limite conhecido em **10.7**, junto com o
rumo decidido. Preso por `backend/tests/integration/flexible-auth-precedence.test.js`, que mede a precedência
da chave sobre o cookie e o Bearer.

**1.3** Somente o administrador promove alguém a produtor ou a credenciado. O papel é lido do banco a cada
requisição, nunca do token, de modo que um administrador rebaixado não sobrevive à validade do token que já
emitiu. O administrador não pode rebaixar a si mesmo. **[vigente]** São três afirmações e três guardas: o
auto-rebaixamento por `backend/tests/integration/users-admin.test.js`, "só o administrador promove" por
`backend/tests/integration/escopo-de-producao-bicondicional.test.js`, e "o papel vem do banco a cada
requisição" por `backend/tests/integration/auth-live-reconciliation.test.js`.

**1.4** **Não existe eixo de papel dentro da organização.** A coluna `org_role` (dono, administrador, editor,
leitor da OM) era resíduo de um desenho anterior, em que ela autorizava a escrita do 360. Foi substituída pelo
escopo de produção concedido pelo administrador, porque a lotação é **auto-declarada** no cadastro e um
crachá dentro de uma organização que a própria pessoa escolheu não autoriza nada. O que sobrou não gateava
nada no servidor e, no cliente, contaminava o papel do eixo por atlas: quem tivesse o crachá de administrador
da OM abria a interface de Administrador de atlas sem ter permissão em atlas nenhum. **Saiu do código
inteiro em 2026-08-20**: coluna, claim do token, consultas, formulário e a semente do papel por atlas na
hidratação da sessão, que hoje começa em Leitor. **[vigente]** Preso por
`frontend/tests/unit/org-role-nao-promove-em-atlas.repro.test.js`, que guarda o defeito pelo nome, e por
`backend/tests/integration/register-tenant-claim.test.js`, que cobra a ausência do claim no token.

**1.5** O usuário deslogado cria a própria conta. Ela nasce sempre como `user`: papel, escopo de produção e
vínculo institucional não são escolhíveis no cadastro. A organização declarada no cadastro é **lotação** e
**não autoriza nada**. **[pendente]** O endurecimento (e-mail obrigatório, limite por endereço, validação de
inicialização) está feito; a abertura da rota em produção espera o relay de e-mail existir. Enquanto não
existir, a conta é criada pelo administrador.

---

## 2. Recursos

**2.1** Um recurso é de um destes cinco tipos: **mapa base**, **3D**, **360**, **camada de dados** e **camada
de análise**. Cada um é **público ou privado**. **[vigente]** Preso por
`backend/tests/integration/basemap-quinto-tipo.test.js`, que mede os dois CHECKs de tipo.

**2.2** Topônimos (gazetteer) **não** têm eixo público/privado. Não é omissão: o eixo existiu e foi removido
em 2026-08-19. Quem quiser privacidade de topônimo está propondo funcionalidade nova. **[vigente]** Preso
por `frontend/tests/e2e/nomes-busca-anon.e2e.test.js`, que exige o anônimo recebendo todo nome semeado.

**2.3** O administrador define a visibilidade de qualquer recurso. **O produtor define a visibilidade dos
recursos que administra**, que são os da própria organização. **[vigente]** desde 2026-08-20: o gate da
rota é `requireResourceMaintainer`, e o `WHERE` da escrita recorta a linha por `fn_can_produce_resource`, de
modo que recurso de outra OM devolve não-encontrado em vez de proibido. Preso por
`backend/tests/integration/produtor-define-visibilidade.test.js`.

**2.4** O produtor **mantém** o acervo da própria organização: cria, edita e remove as linhas de catálogo
dela, incluindo nome, metadados, miniatura e vídeo de prévia. Recurso institucional, sem organização dona,
não é de produtor nenhum. **[vigente]**

**MANTER A LINHA NÃO É INGERIR OS BYTES, e os dois acervos divergem nisso.** Decisão do dono, 2026-08-24: o
360 ganha tela de envio de bundle (a rota `POST /sv360/admin/projects/upload` já existia, já era
autenticada, já aceitava o produtor e já impunha a organização dele, e não tinha porta nenhuma no cliente);
o acervo **3D continua sendo ingerido por operador com shell no servidor**, e esta cláusula passa a dizê-lo
em vez de deixar o buraco não dito. As rotas de escrita 3D que existem são as do CRUD de catálogo: criam a
LINHA que aponta para um modelo, e não fazem o modelo existir. **A consequência que fica registrada e não
foi fechada:** os scripts de `backend/scripts/` que fazem essa ingestão não têm gate algum (nem sessão, nem
papel, nem `fn_can_produce_resource`), e `models3d-adotar.js` escreve a própria linha de catálogo,
contornando `requireCatalogProducer` por inteiro e podendo carimbar qualquer organização dona. Quem tem
shell no servidor já tem o banco, então isto é assimetria de regime e não vazamento de autoridade, mas é
assimetria, e agora está escrita., e o vídeo de prévia vale para **quatro** dos cinco tipos: 3D,
dados, análise e 360. O **mapa base fica de fora**, e não por esquecimento: ele é o único dos cinco que não
vira cartão de catálogo, então não haveria onde ler o valor.

A exclusão passou a ser IMPOSTA PELO SERVIDOR em 2026-08-23, e até então não era: esta linha dizia que "a
exceção está escrita na migração que criou o campo", e não estava em migração nenhuma. O `config` é JSONB
livre nas quatro tabelas de catálogo e o schema de escrita era um só para elas, então `POST
/api/v1/basemaps` com `config.previewVideo` era aceito e gravado; o que segurava a norma era o formulário
do painel, que não oferece o campo. Uma revisão da constituição contra as migrações achou a remissão falsa,
e o conserto foi no código, como manda a regra deste documento. Preso por
`backend/tests/integration/catalogo-basemap-sem-video.test.js`, que mede o par (as outras três aceitam, o
mapa base recusa, com o mesmo corpo), e por `backend/tests/integration/catalogo-video-de-previa.test.js`,
cujo próprio título diz "quatro tipos".

**2.5** O produtor **lê** os recursos públicos e os que a própria organização produziu. Ele **não** lê o
acervo privado alheio. **[vigente]** Preso por `backend/tests/integration/resource-access-funcoes.test.js`,
no ramo de produtor de `fn_can_see_resource`.

**2.6** O credenciado **lê todo recurso privado**, sem precisar de concessão. **[vigente]** Preso por
`backend/tests/integration/papel-credenciado.test.js`.

**2.7** O administrador lê tudo e configura tudo. **[vigente]** para "lê tudo", preso por
`backend/tests/integration/resource-access-funcoes.test.js`. Já **"configura tudo" é um universal sem guarda
universal**: ele é provado rota a rota (`backend/tests/integration/config-admin.test.js`,
`backend/tests/integration/admin-panel-authz.test.js`), e uma superfície de configuração NOVA que não desse
caminho ao administrador não deixaria nada vermelho. O censo que existe classifica gate de privacidade, não
alcance do administrador.

---

## 3. Compartilhamento de recurso

**3.1** Um recurso é compartilhado com **uma pessoa** ou com **um grupo**, nunca com os dois na mesma
concessão. **[vigente]** Preso por `backend/tests/integration/resource-grants-grupo.test.js`, que mede os
três desfechos da borda: os dois juntos, nenhum, e um só.

**3.2** Há **dois níveis**: **ver** e **ver e compartilhar**. Quem recebe "ver" acessa e não repassa; quem
recebe "ver e compartilhar" repassa. Vale igual para grupo: quem recebe o nível maior através de um grupo
repassa como se o tivesse recebido nominalmente. **[vigente]** Preso por
`backend/tests/integration/resource-grants-escalonamento.test.js`, que compara os dois níveis com o MESMO
corpo de requisição.

**3.3** Origina uma concessão quem tem **papel global de dado** (administrador ou credenciado) ou quem
**produz** aquele recurso. Repassa, além desses, **qualquer pessoa que tenha recebido o recurso com permissão
de compartilhar**. **[vigente]** desde 2026-08-20. A premissa que atrasava isto (o produtor precisaria de
uma concessão de onde pendurar) foi abandonada: produção virou **raiz**, igual ao papel global, e a
concessão do produtor nasce com pai nulo. Preso por
`backend/tests/integration/produtor-concede-de-raiz.test.js`.

**3.4** Toda concessão **expira**. O teto e o padrão são de um ano, e nenhuma concessão vive mais que a de
quem a concedeu. Expirada e revogada são estados distintos. **[vigente]** Preso por
`backend/tests/integration/resource-grants-prazo.test.js`, que mede o teto de dois anos recusado, a concessão
que nasceria morta recusada, e 364 dias aceitos.

**3.5** Revogar derruba **a cadeia que deriva daquela concessão**. Se você compartilhou com A e A compartilhou
com B, tirar de A tira de B. **[vigente]** Preso por
`backend/tests/integration/resource-grants-poda.test.js`, cuja discriminação é o ramo irmão ficando de pé.

**E quem revoga é o AUTOR da concessão, ou a administração do sistema, e mais ninguém.** Esta cláusula
descrevia o efeito e calava sobre o sujeito, e a lacuna deixou `CLAUDE.md` prometer que o credenciado
"concede/revoga" quando o servidor sempre o limitou ao que ele mesmo originou. A frase entra em
2026-08-24, sem mudança de comportamento: o gate é `requireGrantRevoker`
(`backend/src/middleware/resource-access.js`), e a forma dele é a que importa preservar. O ramo largo
pergunta por UM papel, o que administra o sistema; o ramo estreito não pergunta por papel nenhum,
pergunta por autoria. Um papel novo entra por `granted_by` sem que ninguém edite aquele arquivo, o que
é o oposto da lista fechada que a doutrina proíbe. Ter `view_share` no recurso NÃO basta: revogar a
concessão de outra pessoa derrubaria uma subárvore que não é sua, e a poda é justamente a operação
cujo alcance passa longe da linha que se aponta. O cliente já espelha isso em função pura
(`revokeAvailability`, `frontend/src/js/catalog/grant-tree.js`), presa por
`frontend/tests/unit/revogar-concessao-quem-pode.test.js`.

**3.6** **Caminhos independentes são preservados.** Se B recebeu de A **e** de C, ou por um grupo, tirar A não
tira B. **[vigente]** Preso por `backend/tests/integration/resource-grants-poda.test.js`.

**3.7** E a preservação alcança os descendentes: **se B não caiu, o que B concedeu não cai**. Ao podar, um
descendente cujo concedente ainda tenha permissão de compartilhar viva é repai-ado nesse outro caminho, em
vez de revogado. **[vigente]** `parent_grant_id` continua sendo **um pai só** (é coluna única, e isso não
mudou), mas deixou de implicar queda: o repai TROCA a aresta em vez de derrubar o nó, e o prazo do pai novo
é teto, nunca elástico. Preso por `backend/tests/integration/resource-grants-alcancabilidade.test.js`, que
leva o controle negativo da disjunção dos três UPDATE, porque o Postgres não levanta erro quando duas CTEs
modificadoras tocam a mesma linha: ele dá resultado imprevisível.

**3.8** Apagar um grupo, ou remover alguém de um grupo, **poda a cadeia** que derivava daquele acesso, com a
mesma regra de preservação de 3.6 e 3.7. **[vigente]** nos dois atos, pelo mesmo motor de poda, e é o
contrário do que esta linha afirmou por um tempo: a cadeia é justamente o que a poda alcança. Preso por
`backend/tests/integration/access-groups-exclusao-cascata.test.js`.

E os **dois atos convergem** desde 2026-08-21. Havia uma divergência estrutural: o membro com autoridade
PRÓPRIA sobre o mesmo recurso mantinha o repasse ao se apagar o grupo (lá ele é descendente da concessão
coletiva, logo resgatável) e o perdia ao ser retirado do grupo (lá ele é a ÂNCORA da poda, e âncora nunca se
resgatava). O dono decidiu por MANTER, que é o que a 3.7 já mandava. A regra da âncora **não** foi removida,
porque ela existe para a revogação DELIBERADA: os chamadores é que passaram a se separar em dois grupos, e
sair de um grupo é remoção de CAMINHO, não revogação de uma concessão que alguém escolheu derrubar.

---

## 4. Grupos

**4.1** **Qualquer usuário logado cria grupo.** Grupo serve a recurso e a atlas, e compartilhar atlas é
direito de qualquer um. **[vigente]** O único middleware da rota de criação é o de sessão: os quatro papéis
globais percorrem o ciclo inteiro no próprio grupo, e o anônimo não. Preso por
`backend/tests/integration/access-groups-crud.test.js`.

**4.2** Quem cria é o **dono**. Somente ele adiciona e remove pessoas, renomeia, e apaga o grupo. O
administrador é exceção universal. **[vigente]** A autoridade mora em `owner_id`, uma coluna NOVA, e não em
`created_by`, que segue sendo história e não poder: fundir as duas impediria transferir a posse sem
falsificar o registro de criação. Cinco rotas são fechadas pelo mesmo predicado, e a recusa é
não-encontrado, nunca proibido. Preso por `backend/tests/integration/access-groups-crud.test.js`, que trata
as cinco rotas como censo e mede o dono contra o estranho, o credenciado e o produtor.

**4.3** Apagar o grupo **remove os membros e remove as concessões vinculadas a ele**, antes de apagar.
**[vigente]** A ordem é contrato: ler o alcance, podar as concessões, esvaziar a composição, e só então
apagar. A composição é apagada **fisicamente**; as concessões são revogadas e a linha do grupo sobrevive, as
duas por auditoria: hard delete destruiria a resposta a "por que Fulano perdeu acesso". Preso por
`backend/tests/integration/access-groups-exclusao-cascata.test.js`.

**4.4** O usuário vê **os grupos que administra**, com a lista de membros. O administrador vê todos.
**[vigente]** O recorte mora na CONSULTA, não no middleware, e é por isso que a rota é só de sessão. Preso
por `backend/tests/integration/access-groups-crud.test.js`.

**4.5** O usuário vê também **os grupos de que participa**, com o nome e o **dono** de cada um, e **não** vê
os membros deles. Um mecanismo que decide o acesso da pessoa a recursos privados não pode ser invisível para
ela. **[vigente]** A projeção é exatamente nome e dono: roster, contagens e descrição ficam de fora, e a
discriminação inclui o próprio dono (ser dono não é participar). Preso por
`backend/tests/integration/access-groups-crud.test.js`.

**4.6** O credenciado **não** tem poder especial sobre grupo. Ele é dono dos grupos dele, como qualquer um.
**[vigente]**, e por ausência estrutural: o predicado de administração de grupo tem dois ramos só, posse viva
e administrador do sistema. Preso por `backend/tests/integration/access-groups-crud.test.js`, em que o
credenciado é controle negativo nas cinco rotas e passa no ciclo do grupo DELE, por posse e não por papel.
Isto supera por escrito, e não apaga, a decisão de 2026-08-19 que fazia da administração de
grupo a única escrita do papel.

**4.7** Participar de um grupo é ato de duas vontades, e **sair é direito de quem entrou**. Qualquer
membro se remove sozinho, sem depender de quem administra. **[vigente]** desde 2026-08-23. O dono é a
exceção, e por necessidade estrutural, não por hierarquia: o predicado de administração exige dono VIVO,
então um grupo abandonado pelo dono ficaria sem ninguém que o administre. A recusa nomeia a saída que
EXISTE, apagar o grupo, e só ela: a primeira redação desta cláusula também oferecia transferir a posse,
e isso era falso, porque não há rota de transferência de grupo. A regra de que uma negativa sem saída é
só um muro foi o que produziu o erro, aqui e na frase de tela: ao procurar uma saída para oferecer, os
dois textos inventaram a que faltava. Saída inexistente é pior que muro. Sair derruba o que o GRUPO dava e preserva o que a pessoa
tinha por autoridade própria, que é a mesma regra da remoção por terceiro, no mesmo código. Preso por
`backend/tests/integration/sair-do-grupo.test.js`, cujo controle negativo é a concessão de caminho
próprio que sobrevive.

---

## 5. Atlas

**5.1** Um atlas é compartilhado com **pessoas** e com **grupos**. **[vigente]** desde 2026-08-21. O eixo de
grupo existe em coluna, CHECK de alvo único, unicidade, índice, nas funções que resolvem acesso e nas rotas;
esta linha afirmou o contrário ("em lugar nenhum do servidor") depois de o eixo existir, que é o tipo de
negação absoluta capaz de fazer a próxima sessão reimplementar o que já está lá. Preso por
`backend/tests/integration/atlas-share-por-grupo.test.js`.

**5.2** São **cinco níveis**, e eles **formam uma escada**: leitura < comentário < edição < gestão < dono.
Todo gate é por hierarquia. Lista fechada de níveis é proibida: ela exclui a gestão em silêncio, e isso já
causou bug real duas vezes, nos dois pacotes. **[vigente]** Preso por
`backend/tests/integration/permission-hierarchy-matrix.test.js`, que percorre os 25 pares de (nível resolvido,
nível exigido) em vez de amostrar.

**5.3** O compartilhamento por grupo alcança os **quatro níveis concedíveis**, gestão inclusive. Dono não é
concedível por caminho nenhum. Duas salvaguardas são parte da regra, não detalhe de implementação: só se
compartilha atlas com **grupo próprio**, e a lista de quem tem acesso **nomeia o dono do grupo**, para que o
gestor veja de quem é a composição que está aceitando. **[vigente]** nas três partes, e as duas
salvaguardas têm teste próprio. Uma assimetria deliberada: **subir** o nível de um grupo exige posse do
grupo, **rebaixar** e **remover** não: tirar acesso nunca precisa da mesma autoridade que dá. Preso por
`backend/tests/integration/sharing-grupo-rotas.test.js` e, do lado da tela,
`frontend/tests/unit/sharing-modal-grupos.test.js`.

**5.4** Um atlas pode ter **link público**, e ele é **somente leitura**, imposta no servidor e não na
interface. O visitante do link é anônimo e confinado àquele atlas. O link é revogável. **[vigente]** Preso
por `backend/tests/integration/public-token-atlas-scope.repro.test.js`.

**5.5** O administrador global tem **posse** em todo atlas. É o quinto caminho de acesso, ao lado de dono,
compartilhamento nominal, grupo e link público. **[vigente]** Preso por
`backend/tests/integration/sharing-gaps.test.js`.

**5.6** Quem não tem relação nenhuma com um atlas recebe "não encontrado", não "proibido". É decisão
anti-enumeração: "proibido" fica reservado a quem tem acesso insuficiente. **[vigente]** Preso por
`backend/tests/integration/atlas-404-vs-403-escada.test.js`, cuja asserção é que o estranho fica
indistinguível de atlas inexistente.

**5.7** Todo participante de um atlas vê **quem mais participa e com que nível**, e não só quem
administra. **[vigente]** desde 2026-08-23. A regra anterior era o silêncio, e ele não protegia nada: o
Leitor já via os NOMES no cartão do atlas, e o que lhe faltava era justamente o dado que evita o pedido
errado à pessoa errada. O que continua reservado é o CAMINHO: o payload não diz por qual porta cada um
entrou, porque dizer "por grupo" entregaria adesão a coletivo alheio, e é pela mesma razão que o grupo
não é nomeado como participante. Dentro do MAPA a leitura tem porta própria desde
2026-08-23, e ela NÃO é o botão de compartilhar: quem alcança `manage` vê "Compartilhar", quem não
alcança vê "Participantes", e as duas nunca aparecem juntas. A fonte também é outra, por
necessidade: `GET /atlas/:atlasId/sharing` exige `manage` nos quatro verbos, então um modo de
leitura que o chamasse tomaria 403 de exatamente quem ele serve. Preso por
`backend/tests/integration/overview-nivel-do-participante.test.js` no servidor e por
`frontend/tests/unit/sharing-modal-somente-leitura.test.js` no cliente.

**5.8** Sair de um atlas compartilhado é **direito de quem foi convidado**, e não pedido a quem
administra. **[vigente]** desde 2026-08-23, pela mesma razão da 4.7 e com a mesma exceção: o dono não
sai, porque o atlas ficaria órfão, e a recusa nomeia transferir a posse ou mandar à lixeira. A resposta
diz o nível EFETIVO depois do ato, e não um sim ou não, porque um grupo vivo ou o link público podem
manter o acesso por outro caminho. Atlas inexistente e "não participo" respondem igual, para a rota não
virar oráculo de existência. Preso por `backend/tests/integration/sair-do-atlas.test.js`.

---

## 6. O empréstimo de recurso pelo atlas

**6.1** Os recursos que aparecem num atlas são os que **o dono do atlas** pode ver. Se o dono anexa ao atlas
um recurso privado a que tem acesso, **todos que acessam o atlas acessam aquele recurso enquanto usam aquele
atlas**, e só ali. **[vigente]** Preso por `backend/tests/integration/atlas-emprestimo-recurso.test.js`,
cuja discriminação é o mesmo recurso NÃO aparecendo fora do atlas nem sob o atlas errado.

**6.2** O empréstimo é recalculado a partir do dono **a cada leitura**. Não é congelado no momento do
compartilhamento. Portanto: trocar o dono, ou o dono perder o acesso ao recurso, **derruba o empréstimo para
todos**, sem varredura e sem atraso. **[vigente]** Preso por
`backend/tests/integration/atlas-emprestimo-revogacao.test.js`.

**6.3** O empréstimo alcança **inclusive o visitante do link público**. É a consequência aceita da regra 6.1:
quem publica um atlas que empresta um recurso privado está publicando aquele recurso naquele contexto. O que
a torna defensável é que a cadeia começa em alguém com autoridade de repasse. **[vigente]** Preso por
`backend/tests/integration/resource-access-visitante-publico.test.js`.

**6.4** O empréstimo reconhece também o **produtor** como dono capaz de emprestar o acervo da própria
organização. **[vigente]** desde 2026-08-21: a produção do dono do atlas entrou como termo próprio na
disjunção do empréstimo. E ela é reavaliada a cada leitura como as outras, então perder a produção (ou a OM
produtora ser desativada) derruba o empréstimo sem varredura. Preso por
`backend/tests/integration/emprestimo-do-produtor-resolve.test.js`.

**6.5** O empréstimo **não viaja em cópia**: nem no clone, nem no arquivo, nem na versão local. **[vigente]**
Preso por `backend/tests/integration/clone-poda-por-destinatario.test.js`, no caso em que B alcança o recurso
SÓ pelo empréstimo da origem e ele não viaja.

---

## 7. Atlas local e atlas remoto

**7.1** O usuário deslogado tem **vários atlas locais**. **[vigente]** Preso por
`frontend/tests/unit/local-atlas-api.test.js`, que mede o décimo aceito e o décimo primeiro recusado com erro
nomeado.

**7.2** O usuário logado **envia um atlas local ao servidor**, tornando-o remoto. **[vigente]** Preso por
`frontend/tests/e2e/local-atlas-import.e2e.test.js`.

**7.3** E **salva um atlas remoto como local**. **[vigente]** Existe comando de um passo, e ele **não** é um
round-trip de `.ebgeo`: é cópia banco a banco mais a poda de saída, então a aba não troca de atlas nem
recarrega. Preso por `frontend/tests/integration/salvar-remoto-como-local.test.js` e, do lado da tela, por
`frontend/tests/unit/aba-mapas-acoes-por-estado.test.js`, que exige o comando na grade de ações e
só na linha do atlas de servidor.

**7.4** Locais e remotos podem ser **duplicados e apagados**. Duplicar um atlas remoto é **clonar para si**:
a cópia nasce em posse de quem clonou. Apagar um remoto vai para a lixeira e é restaurável. **[vigente]**
São quatro afirmações e quatro guardas, porque uma citação só deixaria três quartos sem endereço: duplicar
local por `frontend/tests/unit/copia-de-atlas-local.test.js`, apagar local por
`frontend/tests/unit/local-atlas-api.test.js`, clonar remoto por
`backend/tests/integration/clone-visitante-publico.test.js`, e a lixeira restaurável por
`backend/tests/integration/atlas-restore-integrity.test.js`, que cobra o CONTEÚDO de volta e não só a linha.

**7.5** **Somente atlas remotos** se compartilham pelo sistema. Atlas local se compartilha por arquivo
`.ebgeo`. **[vigente]** Preso por `frontend/tests/unit/aba-mapas-acoes-por-estado.test.js`, do lado do cliente
(no servidor a regra é verdadeira por construção: atlas local não tem linha), e a segunda metade de lado por
`frontend/tests/unit/poda-de-saida-fiacao.test.js`.

---

## 8. A fronteira de saída

Esta é a regra que separa o que o servidor consegue impor do que ele não consegue.

**8.1** **Sair do servidor apaga o privado.** Ao exportar um `.ebgeo` ou salvar um atlas como local, a cópia
perde **todo recurso privado**, incondicionalmente, nos cinco tipos: 360, 3D, mapa base, dados e análise.
Vale inclusive quando quem exporta é o dono, e inclusive para o `.ebgeo` de um atlas que já era local. Fora
do servidor não existe ponto de imposição: um arquivo circula por e-mail e pendrive, e um banco local não tem
predicado. **[vigente]** desde 2026-08-21, e a regra é **keep-list**: sobrevive só o que resolve para
público, e o desconhecido sai junto com o privado (falha fechado). Esta linha afirmou "não há filtragem
nenhuma" depois de a poda existir, o que convidava a próxima sessão a escrever um SEGUNDO caminho de saída,
que é exatamente o que o teste estrutural de fiação foi escrito para impedir. Preso por
`frontend/tests/unit/poda-de-referencia-privada.test.js` e `frontend/tests/unit/poda-de-saida-fiacao.test.js`,
com a falha-fechada medida à parte em `frontend/tests/unit/poda-fecha-no-desconhecido.test.js`.

**8.2** **Ficar no servidor preserva o predicado.** No clone, a poda é **por destinatário**: a cópia perde o
que o clonador não pode ver, e mantém o que ele legitimamente vê por papel, produção ou concessão própria.
**[vigente]**, e vale também para o import, não só para o clone: nos dois quem decide é o SQL, com o
predicado avaliado para o DESTINATÁRIO. A consequência que surpreende: um recurso privado a que o clonador
tem concessão própria SOBREVIVE ao clone e NÃO sobrevive ao `.ebgeo`. Preso por
`backend/tests/integration/clone-poda-por-destinatario.test.js` e
`backend/tests/integration/import-poda-referencia-privada.test.js`.

**8.3** O portador de um link público **logado** pode clonar o atlas para si, e pode exportar e salvar como
local. O visitante **anônimo** pode exportar e salvar como local, porque são operações de cliente, e **não**
pode clonar no servidor, porque um atlas precisa de um dono que exista. **[vigente]** O anônimo leva recusa
por **gate explícito**, e a ordem dos middlewares é contrato: atlas inexistente responde não-encontrado ANTES
de a rota revelar que a ação exige conta. Preso por
`backend/tests/integration/clone-visitante-publico.test.js`.

**8.4** Quem exporta ou salva como local **é avisado do que perdeu**. **[vigente]** O aviso conta por
superfície, rotula em termos do que a pessoa vê (uma camada, um marcador, um slide) e nomeia no máximo
três; id cru nunca aparece, porque no 360 ele é o nome do arquivo da foto e nos demais não informa quem
lê. Preso por `frontend/tests/unit/aviso-de-perda-de-recursos.test.js`, que mede o texto e exige, nos
DOIS chamadores, que a confirmação exista e que o "Cancelar" aborte antes do trabalho irreversível.

**8.5** **A autoridade morre com quem a exercia.** Desativar uma conta (ou a organização dela) tira dela
todos os acessos, e alcança o que ela sustentava:

- os atlas de que ela é dona deixam de emprestar os recursos que ela deixou de ver (isto e o caso geral de
  6.2: perder acesso a um recurso derruba o empréstimo dele em todo atlas de que a pessoa é dona);
- os grupos de que ela é dona deixam de entregar acesso, porque o grupo é o veículo da autoridade do dono,
  como o atlas é;
- as concessões que ela originou caem, com a preservação de 3.6 e 3.7: quem tiver outro caminho vivo é
  repai-ado, não derrubado.

**[vigente]** nos três, desde 2026-08-21. O grupo passou a perguntar pela vida do dono no lugar FUNDO (a
função que resolve os grupos da pessoa), o que fecha leitura, repasse e o eixo de grupo em atlas de uma vez;
a concessão de raiz ganhou os dois lados, o predicado que a esconde na leitura seguinte e a poda que alcança
os descendentes. Preso por `backend/tests/integration/access-groups-dono.test.js` e
`backend/tests/integration/resource-grants-alcancabilidade.test.js`.

**E ela alcança o REBAIXAMENTO desde 2026-08-21**, que é o irmão do ato acima: lá a autoridade morre com a
CONTA, aqui com o crachá. Perder o papel global de dado, ou perder (ou trocar) o escopo de produção, poda
tudo o que a pessoa concedeu de raiz, na mesma transação em que o papel muda. A forma escolhida foi a
SIMPLES, e o que ela cobra está dito: poda-se **toda** raiz daquela pessoa, sem distinguir sob qual
autoridade cada uma nasceu, porque o schema não registra isso. Registrar custaria uma coluna nova que
deixaria todo o passado como desconhecido, e portanto não podado, que é justamente a metade que importa. O
preço aceito é derrubar também o que ela poderia manter pelo papel que sobrou: numa revogação, a direção
certa de falha é a fechada. A preservação de 3.6 e 3.7 continua valendo, então quem tem outro caminho vivo é
repai-ado. **[vigente]**, preso por `backend/tests/integration/produtor-concede-de-raiz.test.js`, cujo caso
de caracterização da lacuna foi INVERTIDO em vez de apagado: ele mede o rebaixamento pela ROTA (que é onde o
gancho vive) e mantém um caso por SQL cru, para separar o predicado, que não mudou, deste gancho, que é quem
derruba.

A propagação é por predicado, na leitura seguinte, sem varredura e sem processo de fundo. Quem for desativar
uma conta que concedeu muito deve reconceder antes, porque não há transferência automática de autoridade.

---

## 9. Auditoria

**9.1** O administrador acessa **toda** a trilha e todas as configurações do sistema e dos recursos.
**[vigente]** nos dois: existe aba de Auditoria, com agrupamento por dia, uma frase por linha e o de-para
atrás de botão. Preso por `frontend/tests/unit/admin-audiencia.test.js` e
`frontend/tests/unit/auditoria-rotulos.test.js`.

**9.2** O produtor acessa a trilha **dos recursos produzidos pela própria organização**. O recorte é imposto
pelo servidor e nunca é parâmetro do cliente. **[vigente]** A trilha ganhou coluna de organização no alvo,
com índice e backfill, e o recorte é imposto no serviço: pedir a OM alheia pela URL não alarga nada, e escopo
ausente LEVANTA em vez de listar tudo. Preso por `backend/tests/integration/auditoria-por-om.test.js` e
`backend/tests/integration/auditoria-gate.test.js`.

**9.3** A trilha registra **o que mudou, e não apenas que mudou**. O de-para é seletivo: campos que carregam
endereço de serviço, segredo ou conteúdo binário são elididos, e a lista do que fica de fora é escrita.
**[vigente]** para catálogo, 360 e USUÁRIOS: são três regimes (valor literal, impressão criptográfica e
nome-só como piso para o desconhecido), com teto de tamanho que degrada tudo para nome-só e DIZ que
degradou, mais uma lista escrita do que não chega à trilha nem como nome (credencial, carimbo de hora que
muda em toda gravação, nome derivado por junção). Preso por `backend/tests/unit/audit-diff.test.js` e
`backend/tests/integration/auditoria-usuarios-de-para.test.js`. Na família de usuários o papel global e a OM
produtora entram literais, porque são os dois fundamentos de concessão de raiz e mudá-los derruba acervo
alheio; nome, login e e-mail entram por impressão, que responde "voltou ao que era" sem gravar dado pessoal
para sempre. A gaveta da trilha traduz o motivo da queda de uma concessão em português e mostra como
CÓDIGO, nunca como frase, o que ninguém traduziu (`frontend/tests/unit/auditoria-rotulos.test.js`).
As famílias de ATLAS, PERMISSÕES e GRUPOS continuam com registro próprio, sem de-para. **[em obra]** para
essas três.

---

## 10. O que esta constituição sabe que não entrega

Uma constituição que só lista intenções é propaganda. Estes são os limites conhecidos, e cada um está
registrado onde se conserta.

**10.1** **Os bytes do tile privado não passam por gate.** O endereço do tile de uma camada privada é servido
diretamente pelo servidor web, fora do alcance do predicado: marcar um recurso como privado esconde a URL, e
não move byte nenhum. O gêmeo do defeito é que o acervo privado hoje **não desenha para quem tem direito**,
porque o navegador pede o tile sem credencial. Apuração completa, quatro opções comparadas e recomendação em
[`PENDENCIA-TILE-PRIVADO.md`](PENDENCIA-TILE-PRIVADO.md). **[pendente]** por decisão do dono.

**10.2** **O grafo de concessões é um grafo, não uma árvore**, e isso é deliberado (cláusula 3.6). Quem
espera que revogar de um concedente corte todo mundo vai se surpreender: quem tem dois caminhos mantém o
acesso por um deles.

**10.3** **A revogação não é empurrada em tempo real** para todo mundo. Quem perde acesso descobre no próximo
carregamento. Não é vazamento (o servidor recusa os bytes na hora), mas a tela pode mostrar camada quebrada
em vez de camada ausente até lá.

**10.4** **A desativação de uma conta propaga por predicado, não por varredura**, e isso significa que ela
é imediata na leitura seguinte, mas não deixa rastro de "quando" na trilha. Quem quiser saber a data em que
um acesso caiu por desativação precisa cruzar a trilha de desativação da conta, não a de revogação.

**10.5** **A lotação continua auto-declarada.** Qualquer pessoa escolhe qualquer organização ativa ao se
cadastrar, e nada verifica isso. É por essa razão que a lotação não autoriza nada e que o eixo de papel
dentro da organização foi removido (cláusula 1.4). Um dia em que a lotação passe a ser verificada, a decisão
de 1.4 pode ser revisitada; enquanto não for, qualquer autorização apoiada em organização declarada é
autorização que o próprio interessado se concede.

**A lotação NÃO AUTORIZA, mas REVOGA, e as duas coisas são verdadeiras ao mesmo tempo.** Decisão do dono,
2026-08-24, tomada depois de a auditoria do perfil produtor apontar a contradição aparente:
`fn_can_produce_resource` seleciona o usuário com `LEFT JOIN organizations o ON o.id = u.organization_id` e
exige `COALESCE(o.is_active, true) = true`, isto é, desativar a OM onde alguém está apenas LOTADO devolve
falso para todo recurso que essa pessoa MANTÉM por outra OM, e o termo roda antes do ramo do administrador,
então morde o administrador também. Isso não contradiz 1.4 nem esta cláusula: o termo é de **vivacidade**,
não de autoridade (conta de organização morta não age), e a direção de falha numa autorização é a fechada.
O que faltava era estar escrito, porque quem lia 1.4 concluía, com razão, que a coluna não podia ter efeito
nenhum. **O comportamento fica; o predicado continua escrito SETE vezes** (quatro em SQL, três em
JavaScript: `CATALOG_PRODUCER_ACTOR`, `GRANT_REVOKER_ACTOR` e `AUDIT_READER_ACTOR`), e unificá-lo foi
recusado na mesma decisão por ser refatoração de sete gates vivos sem defeito que a motive.

**10.6** **Uma conta pendente cativa o nome de usuário e o endereço de e-mail para sempre.** Quem se cadastra
e nunca confirma o e-mail deixa aquele par reservado indefinidamente, e a razão é uma só: as consultas de
unicidade não perguntam pela vivacidade. (Esta cláusula dizia também que os dois índices únicos são totais,
e isso é FALSO para o e-mail desde a baseline de identidade: `idx_users_email_lower` é parcial, com
`WHERE email IS NOT NULL`. A parcialidade não muda nada aqui, porque ela só dispensa a conta SEM endereço,
que é a administrativa; o cativeiro vem do predicado, não do índice.) A assimetria é a parte que surpreende:
o TOKEN de verificação caduca em 48 horas, e a conta que ele deveria ativar não caduca nunca. Decidido em
2026-08-21 **deixar como está**, e o desbloqueio passa a ser ato de administrador. Não é buraco esquecido: é
custo aceito, e a alternativa (expirar cadastro não confirmado) fica registrada como a saída, se um dia o
volume justificar.

**O custo aceito continua o mesmo depois de 2026-08-23, e o que mudou foi o ATO DE ADMINISTRADOR, que
até então não existia de verdade.** O administrador só sabia marcar `email_verified`, isto é, APROVAR o
endereço digitado errado; `updateUserAdminSchema` não aceitava `email`. Agora aceita, e trocar o endereço
derruba a confirmação salvo se o mesmo pedido disser o contrário (`resolveAdminEmail`), de modo que corrigir
um cadastro não é o mesmo que declará-lo provado. O titular também passou a ver e a trocar o próprio
endereço (`requestEmailChange`), o que remove a maior parte dos casos antes que virem trabalho de
administração, mas **não** alcança o cativeiro: quem está pendente não entra, logo não chega a essa tela.

**A troca de e-mail NÃO acrescenta um cativeiro novo, e essa é a propriedade que a mantém compatível com
esta cláusula.** O endereço pretendido mora no token (`email_verification_tokens`, coluna `new_email`) e
nunca na conta, então enquanto o convite está de pé o endereço segue livre para qualquer outra pessoa: a
unicidade é conferida no pedido e DE NOVO no resgate, nunca segurada no meio. Um token que caduca sem ser
aberto não deixa nada reservado.

**10.7** **A chave de API ganhou as três amarras em 2026-08-24, e o ENDPOINT que o nginx vai consultar; o `location` continua por fazer.**
Até aquela data ela era o usuário inteiro: resolvia para a linha de `users`, carregava o papel global,
`FIND_USER_BY_API_KEY` filtrava apenas `is_active`, e não havia coluna de validade nem de escopo. Hoje as
três existem, e cada uma no lugar em que este sistema já põe as suas. **Prazo:** morre no PREDICADO daquela
mesma consulta, nunca por varredura, com teto de um ano imposto por `api_keys_expires_at_check` (o mesmo da
concessão, 3.4). **Escopo:** `API_KEY_SCOPE_REACH` é uma tabela de alcance por superfície, e nenhuma linha
dela alcança administração, de modo que `requireAdmin` recusa TODA chave, inclusive a de um administrador, e
o `auth` estrito recusa a chave de escopo `tiles`. **Revogação:** `api_keys` guarda uma linha por chave viva,
e revogar uma não derruba as irmãs; a chave também passou a cair no corte de sessão em massa, comparado com
o NASCIMENTO da chave, já que ela não tem `iat`. **Essa última parte é DECISÃO DO DONO, confirmada em
2026-08-24 quando ela foi levantada como possível excesso: a chave NÃO sobrevive a uma troca de senha.**
A tensão é real e fica registrada para que ninguém a "conserte" depois: a terceira amarra existe
justamente para que revogar uma credencial não derrube as outras integrações da pessoa, e o corte em
massa derruba todas de uma vez. O que separa os dois casos é o GATILHO: rotação de rotina é higiene e
não deve custar as irmãs; troca de senha, reset por administrador, desativação e detecção de reuso são
eventos de SEGURANÇA, em que a suposição correta é a de que a identidade inteira está comprometida. Provas em `backend/tests/integration/chave-de-api-tres-amarras.test.js`
e `backend/tests/unit/chave-de-api-alcance-e-prazo.test.js`.

**O ENDPOINT DE `auth_request` EXISTE DESDE 2026-08-24, e o que ele responde é DECISÃO DO DONO da mesma
data: SIM ou NÃO SIMPLES.** `GET /api/v1/auth/tile-access` (`backend/src/modules/auth/tile-access.js`) é
rota só-`flexibleAuth`, porque o `auth` estrito recusa a chave de escopo `tiles`, que é exatamente a que o
tile carrega; responde 200 ou 401 **sem corpo** (o `auth_request` descarta o corpo e só olha o status, e um
payload aqui seria banda gasta por TILE) e lê `?api_key=` da query, que é o único lugar em que o MapLibre
consegue carregar credencial. Sem trilha de auditoria, por decisão declarada na rota: `audit_trail.action`
não tem ação de LEITURA para gravar, e seria uma linha por tile. **O que ele COMPRA:** os bytes do tile
saem de "abertos para a internet inteira" para "exigem uma chave viva de escopo `tiles`", que é um
estreitamento real. **O que ele NÃO COMPRA, e a frase precisa ficar sem eufemismo:** privacidade POR
RECURSO. Ele valida a CREDENCIAL e nunca a CAMADA, `fn_can_see_resource` não entra na história, e um
usuário comum com chave viva alcança o tile de uma camada que o catálogo não lhe mostra. O que muda é o
tamanho do público, não quem dentro dele vê o quê. Provas em
`backend/tests/integration/tile-access-auth-request.test.js` e
`backend/tests/unit/tile-access-predicado.test.js`; a alternativa recusada (o endpoint receber o caminho e
consultar o predicado) está escrita, com o motivo, no passo 2 de
[`PENDENCIA-TILE-PRIVADO.md`](PENDENCIA-TILE-PRIVADO.md), onde ela deixou de ser decisão pendente e passou
a ser limitação declarada.

**O que continua aberto, e é por isso que a cláusula não está vigente.** O slot antigo (`users.api_key`, uma
chave por conta) não foi apagado, porque migração é forward-only e integradores o carregam: ele ganhou prazo
e corte de sessão, resolve com o escopo mais largo e continua sem revogação individual, que é a amarra que
só o modelo novo entrega. A chave segue guardada em claro, como sempre esteve. E o `location` do nginx, que
é o ponto da decisão, não existe: o endpoint que ele consultaria já existe, mas um endpoint que ninguém
consulta não fecha byte nenhum. Falta também distribuir a chave ao cliente (não há `transformRequest` no
frontend, e o visitante anônimo e o de link público não têm chave nenhuma), sem o que ligar o `location`
fecharia o vazamento e apagaria a camada da tela de quem tem direito.

O rumo está decidido, e é o que torna isto urgente em vez de acadêmico: **a chave passa a ser a credencial
que o nginx valida** para as rotas servidas pelo Martin, que hoje são públicas e ficam fora do alcance de
qualquer predicado deste servidor (é o defeito da 10.1). Autorizar no nginx é a boa prática para aquele
servidor de tiles, e a chave é o que o navegador consegue carregar num pedido de tile. Isso muda o peso do
que falta: uma credencial permanente que hoje só um integrador usa passaria a viajar na URL de cada tile.

**As três amarras vieram primeiro, e essa ordem não era preferência:** ligar o `location` antes delas
trocaria um vazamento de bytes por uma sessão de administrador sem prazo. A apuração, com a opção comparada
às outras quatro, está em [`PENDENCIA-TILE-PRIVADO.md`](PENDENCIA-TILE-PRIVADO.md).
**[em obra]**: as amarras e o endpoint de `auth_request` estão de pé, falta o `location` do nginx (que não
tem teste neste repositório e vira sonda com data, rodada à mão no deploy), a distribuição da chave ao
cliente e a aposentadoria do slot antigo.
