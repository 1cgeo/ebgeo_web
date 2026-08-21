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

---

## 1. Quem existe

**1.1** Existem quatro papéis globais, e eles **não formam uma escada**: `user` (Usuário), `producer`
(Produtor), `credenciado` (Credenciado) e `admin` (Administrador). Nenhum contém o outro. Comparar papel
global por ordem é erro de leitura, e um gate escrito como "diferente de usuário comum" promove o credenciado
em silêncio. **[vigente]**

**1.2** Além dos quatro, o sistema conhece mais três tipos de principal, e omiti-los de um raciocínio de
autorização é como se erra:

- o **visitante deslogado**, que não é papel, é modo;
- o **visitante de link público**, que tem token próprio, não tem linha na tabela de usuários, e é confinado
  ao atlas que emitiu o link;
- o **principal por chave de API**, revogado por rotação de chave. **[vigente]**

**1.3** Somente o administrador promove alguém a produtor ou a credenciado. O papel é lido do banco a cada
requisição, nunca do token, de modo que um administrador rebaixado não sobrevive à validade do token que já
emitiu. O administrador não pode rebaixar a si mesmo. **[vigente]**

**1.4** **Não existe eixo de papel dentro da organização.** A coluna `org_role` (dono, administrador, editor,
leitor da OM) era resíduo de um desenho anterior, em que ela autorizava a escrita do 360. Foi substituída pelo
escopo de produção concedido pelo administrador, porque a lotação é **auto-declarada** no cadastro e um
crachá dentro de uma organização que a própria pessoa escolheu não autoriza nada. O que sobrou não gateava
nada no servidor e, no cliente, contaminava o papel do eixo por atlas: quem tivesse o crachá de administrador
da OM abria a interface de Administrador de atlas sem ter permissão em atlas nenhum. **Saiu do código
inteiro em 2026-08-20**: coluna, claim do token, consultas, formulário e a semente do papel por atlas na
hidratação da sessão, que hoje começa em Leitor. **[vigente]**

**1.5** O usuário deslogado cria a própria conta. Ela nasce sempre como `user`: papel, escopo de produção e
vínculo institucional não são escolhíveis no cadastro. A organização declarada no cadastro é **lotação** e
**não autoriza nada**. **[pendente]** O endurecimento (e-mail obrigatório, limite por endereço, validação de
inicialização) está feito; a abertura da rota em produção espera o relay de e-mail existir. Enquanto não
existir, a conta é criada pelo administrador.

---

## 2. Recursos

**2.1** Um recurso é de um destes cinco tipos: **mapa base**, **3D**, **360**, **camada de dados** e **camada
de análise**. Cada um é **público ou privado**. **[vigente]**

**2.2** Topônimos (gazetteer) **não** têm eixo público/privado. Não é omissão: o eixo existiu e foi removido
em 2026-08-19. Quem quiser privacidade de topônimo está propondo funcionalidade nova. **[vigente]**

**2.3** O administrador define a visibilidade de qualquer recurso. **O produtor define a visibilidade dos
recursos que administra**, que são os da própria organização. **[em obra]** Hoje só o administrador define.

**2.4** O produtor **mantém** o acervo da própria organização: cria, edita e remove as linhas de catálogo
dela, incluindo nome, metadados, miniatura e vídeo de prévia. Recurso institucional, sem organização dona,
não é de produtor nenhum. **[vigente]**, exceto o vídeo, que hoje existe só para 3D e passa a existir nos
demais tipos. **[em obra]**

**2.5** O produtor **lê** os recursos públicos e os que a própria organização produziu. Ele **não** lê o
acervo privado alheio. **[vigente]**

**2.6** O credenciado **lê todo recurso privado**, sem precisar de concessão. **[vigente]**

**2.7** O administrador lê tudo e configura tudo. **[vigente]**

---

## 3. Compartilhamento de recurso

**3.1** Um recurso é compartilhado com **uma pessoa** ou com **um grupo**, nunca com os dois na mesma
concessão. **[vigente]**

**3.2** Há **dois níveis**: **ver** e **ver e compartilhar**. Quem recebe "ver" acessa e não repassa; quem
recebe "ver e compartilhar" repassa. Vale igual para grupo: quem recebe o nível maior através de um grupo
repassa como se o tivesse recebido nominalmente. **[vigente]**

**3.3** Origina uma concessão quem tem **papel global de dado** (administrador ou credenciado) ou quem
**produz** aquele recurso. Repassa, além desses, **qualquer pessoa que tenha recebido o recurso com permissão
de compartilhar**. **[em obra]** Hoje o produtor não concede: falta-lhe uma concessão de onde pendurar a que
daria, e é isso que a onda de implementação resolve, fazendo o produtor conceder de raiz sobre o acervo da
própria organização.

**3.4** Toda concessão **expira**. O teto e o padrão são de um ano, e nenhuma concessão vive mais que a de
quem a concedeu. Expirada e revogada são estados distintos. **[vigente]**

**3.5** Revogar derruba **a cadeia que deriva daquela concessão**. Se você compartilhou com A e A compartilhou
com B, tirar de A tira de B. **[vigente]**

**3.6** **Caminhos independentes são preservados.** Se B recebeu de A **e** de C, ou por um grupo, tirar A não
tira B. **[vigente]**

**3.7** E a preservação alcança os descendentes: **se B não caiu, o que B concedeu não cai**. Ao podar, um
descendente cujo concedente ainda tenha permissão de compartilhar viva é repai-ado nesse outro caminho, em
vez de revogado. **[em obra]** Hoje ele cai, porque cada concessão pendura em um pai só.

**3.8** Apagar um grupo, ou remover alguém de um grupo, **poda a cadeia** que derivava daquele acesso, com a
mesma regra de preservação de 3.6 e 3.7. **[em obra]** Hoje o acesso direto morre e a cadeia abaixo dele
sobrevive.

---

## 4. Grupos

**4.1** **Qualquer usuário logado cria grupo.** Grupo serve a recurso e a atlas, e compartilhar atlas é
direito de qualquer um. **[em obra]** Hoje exige papel global.

**4.2** Quem cria é o **dono**. Somente ele adiciona e remove pessoas, renomeia, e apaga o grupo. O
administrador é exceção universal. **[em obra]** Hoje `created_by` é decorativo e qualquer credenciado manda
em qualquer grupo.

**4.3** Apagar o grupo **remove os membros e remove as concessões vinculadas a ele**, antes de apagar.
**[em obra]** Hoje é exclusão lógica: o acesso cai pelo predicado, mas nada é removido.

**4.4** O usuário vê **os grupos que administra**, com a lista de membros. O administrador vê todos.
**[em obra]** Hoje todo logado vê todos os grupos vivos do sistema.

**4.5** O usuário vê também **os grupos de que participa**, com o nome e o **dono** de cada um, e **não** vê
os membros deles. Um mecanismo que decide o acesso da pessoa a recursos privados não pode ser invisível para
ela. **[em obra]**

**4.6** O credenciado **não** tem poder especial sobre grupo. Ele é dono dos grupos dele, como qualquer um.
**[em obra]** Isto supera por escrito, e não apaga, a decisão de 2026-08-19 que fazia da administração de
grupo a única escrita do papel.

---

## 5. Atlas

**5.1** Um atlas é compartilhado com **pessoas** e com **grupos**. **[em obra]** Hoje só com pessoas: não
existe eixo de grupo em atlas em lugar nenhum do servidor.

**5.2** São **cinco níveis**, e eles **formam uma escada**: leitura < comentário < edição < gestão < dono.
Todo gate é por hierarquia. Lista fechada de níveis é proibida: ela exclui a gestão em silêncio, e isso já
causou bug real duas vezes, nos dois pacotes. **[vigente]**

**5.3** O compartilhamento por grupo alcança os **quatro níveis concedíveis**, gestão inclusive. Dono não é
concedível por caminho nenhum. Duas salvaguardas são parte da regra, não detalhe de implementação: só se
compartilha atlas com **grupo próprio**, e a lista de quem tem acesso **nomeia o dono do grupo**, para que o
gestor veja de quem é a composição que está aceitando. **[em obra]**

**5.4** Um atlas pode ter **link público**, e ele é **somente leitura**, imposta no servidor e não na
interface. O visitante do link é anônimo e confinado àquele atlas. O link é revogável. **[vigente]**

**5.5** O administrador global tem **posse** em todo atlas. É o quinto caminho de acesso, ao lado de dono,
compartilhamento nominal, grupo e link público. **[vigente]**

**5.6** Quem não tem relação nenhuma com um atlas recebe "não encontrado", não "proibido". É decisão
anti-enumeração: "proibido" fica reservado a quem tem acesso insuficiente. **[vigente]**

---

## 6. O empréstimo de recurso pelo atlas

**6.1** Os recursos que aparecem num atlas são os que **o dono do atlas** pode ver. Se o dono anexa ao atlas
um recurso privado a que tem acesso, **todos que acessam o atlas acessam aquele recurso enquanto usam aquele
atlas**, e só ali. **[vigente]**

**6.2** O empréstimo é recalculado a partir do dono **a cada leitura**. Não é congelado no momento do
compartilhamento. Portanto: trocar o dono, ou o dono perder o acesso ao recurso, **derruba o empréstimo para
todos**, sem varredura e sem atraso. **[vigente]**

**6.3** O empréstimo alcança **inclusive o visitante do link público**. É a consequência aceita da regra 6.1:
quem publica um atlas que empresta um recurso privado está publicando aquele recurso naquele contexto. O que
a torna defensável é que a cadeia começa em alguém com autoridade de repasse. **[vigente]**

**6.4** O empréstimo reconhece também o **produtor** como dono capaz de emprestar o acervo da própria
organização. **[em obra]** Hoje ele anexa, passa em todos os gates, e o empréstimo não resolve para ninguém,
em silêncio.

**6.5** O empréstimo **não viaja em cópia**: nem no clone, nem no arquivo, nem na versão local. **[vigente]**

---

## 7. Atlas local e atlas remoto

**7.1** O usuário deslogado tem **vários atlas locais**. **[vigente]**

**7.2** O usuário logado **envia um atlas local ao servidor**, tornando-o remoto. **[vigente]**

**7.3** E **salva um atlas remoto como local**. **[em obra]** Hoje só existe o caminho de dois passos
(exportar arquivo e reabrir) e o resgate automático no logout.

**7.4** Locais e remotos podem ser **duplicados e apagados**. Duplicar um atlas remoto é **clonar para si**:
a cópia nasce em posse de quem clonou. Apagar um remoto vai para a lixeira e é restaurável. **[vigente]**

**7.5** **Somente atlas remotos** se compartilham pelo sistema. Atlas local se compartilha por arquivo
`.ebgeo`. **[vigente]**

---

## 8. A fronteira de saída

Esta é a regra que separa o que o servidor consegue impor do que ele não consegue.

**8.1** **Sair do servidor apaga o privado.** Ao exportar um `.ebgeo` ou salvar um atlas como local, a cópia
perde **todo recurso privado**, incondicionalmente, nos cinco tipos: 360, 3D, mapa base, dados e análise.
Vale inclusive quando quem exporta é o dono, e inclusive para o `.ebgeo` de um atlas que já era local. Fora
do servidor não existe ponto de imposição: um arquivo circula por e-mail e pendrive, e um banco local não tem
predicado. **[em obra]** Hoje não há filtragem nenhuma nesse caminho.

**8.2** **Ficar no servidor preserva o predicado.** No clone, a poda é **por destinatário**: a cópia perde o
que o clonador não pode ver, e mantém o que ele legitimamente vê por papel, produção ou concessão própria.
**[em obra]**

**8.3** O portador de um link público **logado** pode clonar o atlas para si, e pode exportar e salvar como
local. O visitante **anônimo** pode exportar e salvar como local, porque são operações de cliente, e **não**
pode clonar no servidor, porque um atlas precisa de um dono que exista. **[em obra]** Hoje o anônimo é
recusado por erro de tipo, não por gate.

**8.4** Quem exporta ou salva como local **é avisado do que perdeu**. **[em obra]**

**8.5** **A autoridade morre com quem a exercia.** Desativar uma conta (ou a organização dela) tira dela
todos os acessos, e alcança o que ela sustentava:

- os atlas de que ela é dona deixam de emprestar os recursos que ela deixou de ver (isto e o caso geral de
  6.2: perder acesso a um recurso derruba o empréstimo dele em todo atlas de que a pessoa é dona);
- os grupos de que ela é dona deixam de entregar acesso, porque o grupo é o veículo da autoridade do dono,
  como o atlas é;
- as concessões que ela originou caem, com a preservação de 3.6 e 3.7: quem tiver outro caminho vivo é
  repai-ado, não derrubado.

**[vigente]** para os acessos próprios da pessoa e para o empréstimo por atlas. **[em obra]** para grupo e
para concessão de raiz, que hoje sobrevivem ao dono: o grupo porque nada pergunta pela vida dele, e a
concessão de raiz porque não tem pai para morrer, então a desativação não tem por onde propagar.

A propagação é por predicado, na leitura seguinte, sem varredura e sem processo de fundo. Quem for desativar
uma conta que concedeu muito deve reconceder antes, porque não há transferência automática de autoridade.

---

## 9. Auditoria

**9.1** O administrador acessa **toda** a trilha e todas as configurações do sistema e dos recursos.
**[vigente]** no servidor, **[em obra]** na tela: hoje não existe interface de auditoria para ninguém, e o
administrador só alcança a trilha por requisição direta.

**9.2** O produtor acessa a trilha **dos recursos produzidos pela própria organização**. O recorte é imposto
pelo servidor e nunca é parâmetro do cliente. **[em obra]** Hoje a trilha não tem eixo de organização.

**9.3** A trilha registra **o que mudou, e não apenas que mudou**. O de-para é seletivo: campos que carregam
endereço de serviço, segredo ou conteúdo binário são elididos, e a lista do que fica de fora é escrita.
**[em obra]** Hoje ela grava só os nomes dos campos, de modo que trocar a miniatura é indistinguível de
trocar a URL do serviço.

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
