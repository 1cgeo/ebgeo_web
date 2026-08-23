# Trilha de Auditoria de Negócio

Evento de domínio persistido em `audit_trail` que pode participar da transação da mutação auditada, com um CHECK fechado de ações cuja cobertura é hoje cobrada por um teste-censo em vez de por leitura.

## Auditoria é transacional, e isso inverte a intuição de log

O terceiro argumento `t` de `createAudit` (`backend/src/utils/audit.js`) faz o INSERT entrar na transação de negócio: se a mutação reverte, o evento reverte junto. Num log operacional isso seria perda de informação; aqui é a garantia desejada, não existe janela em que o banco diga "fulano deletou o usuário" e o usuário continue vivo. Os dois lados estão pinados em `backend/tests/integration/audit-coverage.test.js`, nos casos `audit-cov-01` (rollback) e `audit-cov-02` (commit).

**Esquecer o `t` é a armadilha principal.** Sem ele o helper cai num `dbQuery` autônomo: compila, o teste feliz passa, e só um rollback revela o registro órfão. O código convida ao erro porque o argumento é opcional e a chamada sem ele é indistinguível à leitura.

**`actorId` não tem fallback.** A coluna é `NOT NULL` e o helper repassa o valor cru, então `req.user?.id` indefinido em rota anônima vira violação de NOT NULL, ou seja, 500 na mutação inteira, não só na auditoria. Toda rota que audita precisa estar atrás de autenticação (ver [[auth-flexivel]] e [[autenticacao-jwt]]).

`req` pode ser sintético: `ip` cai para a string `'system'` quando falsy e `user_agent` só é lido se `req.get` existir, então `{ ip }` basta para jobs e seeds.

## Por que `actor_id` não tem FK

Decisão deliberada, comentada na DDL de `audit_trail` (`backend/src/database/migrations/002_auditoria.sql`). As duas alternativas foram rejeitadas pelo mesmo motivo: com `ON DELETE CASCADE` a trilha se apagaria exatamente no caso em que mais importa; com `RESTRICT` o delete de usuário quebraria. Consequência para quem lê a trilha: `actor_id` pode apontar para usuário inexistente, então a UI precisa tolerar join vazio.

É para isso que `target_name` existe: **snapshot do nome no momento do evento, não referência viva**. Renomear a OM depois não reescreve a trilha, e isso é intencional.

## O CHECK não é cobertura, e por isso a cobertura virou teste

**Filtro que por construção nunca casa se lê como "nada aconteceu", não como "nunca foi ligado".** É a razão de esta seção existir, e o caso extremo durou desde o primeiro dia: `LOGIN`, `LOGOUT` e `ATLAS_DELETE` estavam **declaradas** no CHECK desde o primeiro esquema, com zero emissores em `src/`. Uma ação declarada sem emissor lê como "isto é auditado".

As três ganharam emissor em 2026-08-17, junto com catorze ações novas (`backend/src/database/migrations/002_auditoria.sql`), e o que interessa aqui é o que substituiu a leitura à mão: `backend/tests/unit/auditoria-censo.test.js` varre o versionamento, exige que **toda rota de escrita** de todo `*.routes.js` apareça classificada em uma de três classes (auditada, isenta por decisão, buraco conhecido), confere que o arquivo emissor declarado realmente cite a ação declarada, e cobra que **toda ação do CHECK tenha ao menos um emissor**. As duas propriedades que fazem o censo valer alguma coisa: buraco tem **teto** (senão a saída fácil para uma rota nova sem trilha é declará-la buraco e seguir), e ele prova que reprova, apontando a mesma varredura para uma fixture não classificada.

O que ele NÃO prende: o conteúdo da linha. Que a trilha traga o ator, o alvo certo e os detalhes é comportamento, e mora em `backend/tests/integration/auditoria-acoes-novas.test.js`.

**O alvo voltou a ser coluna de primeira classe.** `target_id` era UUID enquanto o id de catálogo é slug, então o alvo viajava dentro de `details` com `target_type = 'SYSTEM'`, e `idx_audit_target` não respondia "tudo que já foi feito com este recurso". O alargamento para TEXT devolveu o alvo às colunas, e 'SYSTEM' voltou a significar sistema. Consequência para quem consulta: o `target_id` é heterogêneo por construção (slug de catálogo, UUID de projeto 360, a chave textual `app_config`), e nenhuma consulta do módulo filtra ou junta por ele.

Duas exclusões deliberadas, para não serem lidas como esquecimento: **calibração de foto 360** fica fora por frequência (a foto já tem `updated_at`, e a auditoria do 360 é no nível do projeto, que é onde o acesso se decide) e **login falho** fica fora por impossibilidade estrutural (`actor_id` é NOT NULL, e uma tentativa recusada não tem ator identificado; o `username` digitado não é identidade).

Quatro `target_type` ficaram declarados sem emissor, e a distinção entre eles é o que vale a pena saber: `GROUP` e `MODEL` nunca tiveram escritor (herança do primeiro CHECK), enquanto `SYSTEM` e `STREETVIEW_MARKER` **tinham e perderam** (o primeiro era o depósito do alvo que não cabia nas colunas, e a revisão do alvo o devolveu a elas; o segundo caiu junto com a tabela de catálogo homônima, apagada em 2026-08-17, ver [[resources-catalogo]]). Removê-los do CHECK seria DDL destrutiva sem ganho, e linha de trilha já gravada pode carregá-los. Os quatro estão nomeados no censo: vocabulário reservado é diferente de vocabulário esquecido, e a única forma de manter a distinção é escrevê-la.

`GROUP` segue sem emissor **por decisão, e não por inércia**: quando o grupo de acesso ganhou trilha, ele declarou o alvo `ACCESS_GROUP` em vez de reusar aquele valor, que pertence ao grupo de FEIÇÃO de um mapa. Reusar faria as duas histórias caírem no mesmo balde de `idx_audit_target`, e "o que já foi feito com este grupo" passaria a ter duas respostas misturadas ([[grupo-de-acesso]]).

O custo do CHECK fechado: ação nova exige migração de schema, não só código, e foi exatamente o que as catorze ações de 2026-08-17 custaram. Em troca, typo em `action` falha na hora em vez de virar lixo silencioso.

**O vocabulário deixou de morar num arquivo só, e quem lê por nome de arquivo passa a mentir nas duas direções.** A consolidação de 2026-08-19 fez os dois CHECK nascerem inline na baseline de auditoria, e o arquivo seguinte já os alargou, porque forward-only proíbe editar uma migração que algum banco já aplicou: alargar é derrubar e repor o constraint num arquivo novo. O censo passou a varrer as migrações em ordem decrescente e a valer-se da **última** declaração, que é o que o banco faz. Enquanto ele lia a baseline por nome, o efeito seria simultaneamente reprovar rota nova cuja ação foi declarada depois e parar de cobrar emissor para as ações novas, isto é, a própria classe de defeito que o censo existe para impedir, entrando pela porta do guarda.

### Armadilha: auditoria de organização não é atômica

As três ações de OM auditam **depois** do serviço retornar, no controller e fora de qualquer transação (`backend/src/modules/organizations/organizations.controller.js`), ao contrário de todo o ciclo de vida de usuário e da rotação de API key, que passam `t`. Se o INSERT de auditoria falhar, a OM já foi criada, alterada ou desativada e o cliente ainda recebe 500: estado divergente entre operação e trilha.

`organizations` é o único módulo que audita fora de uma transação **que existe**, e é isso que o torna a exceção perigosa de copiar: o padrão do repositório é auditar dentro do `tx` do service. O catálogo audita no controller pelo motivo oposto e legítimo (cada escrita é uma query só, não há transação a que aderir, e o controller é o único ponto que tem `req` e a tabela ao mesmo tempo), então ele não é precedente. Ao auditar algo novo em [[organizacoes-om]], mova a chamada para dentro do service, como faz [[gestao-usuarios]].

**Auditoria bloqueante é a regra, e o best-effort é exceção nomeada.** `createAuditBestEffort` existe para três sítios do caminho de credencial (login, logout e o auto-cadastro): ali uma falha de escrita da trilha não pode virar 500, porque derrubaria a entrada de todo mundo, e no auto-cadastro reabriria pela exceção o oráculo de existência de conta que o 201 uniforme fecha ([[gestao-usuarios]]). Fora deles, uma trilha que falha derruba a mutação, e é assim que se quer.

## O eixo de organização, e por que ele é gravado e não resolvido

A trilha carrega `target_org_id`: a OM **dona do recurso alvo**, gravada por quem emite o evento. Ela não é a OM do ator e não é a lotação dele. Nulo tem dois significados que o dado não distingue: alvo sem OM dona (conta, atlas, configuração) e acervo **institucional**, e o filtro por OM não alcança nenhum dos dois, o que é o comportamento certo.

**A pergunta que o desenho teve de responder: quando um recurso troca de OM, a história antiga acompanha? Não.** A coluna guarda quem respondia pelo recurso **na época do ato**, do mesmo jeito que `target_name` guarda o nome de então. Resolver a OM na leitura, por junta com `owner_org_id`, faria transferir a linha amanhã reescrever o passado: o produtor que mantinha o recurso perderia de vista o que ele próprio fez, e o produtor novo herdaria uma história que não é dele. A medição está em `backend/tests/integration/auditoria-epoca-da-om.test.js`, e o controle negativo dela é literal: trocar a coluna por uma junta inverte os dois números.

**O argumento decisivo, porém, é outro, e ele não é de opinião.** O hard-delete de projeto 360 é o único do sistema, e a linha de `SV360_DELETE` nasce **depois** do DELETE, dentro da mesma transação. Uma junta na leitura (ou um gatilho, pelo mesmo motivo) devolveria nulo exatamente para o evento que mais importa auditar. O emissor tem a OM em mãos; a leitura, depois do commit, não tem mais de onde tirá-la. Medido em `backend/tests/integration/auditoria-sv360-delete-tem-om.test.js`, com a ausência do projeto asserida no mesmo caso.

**O BACKFILL NÃO EXISTE MAIS, e é bom saber por quê.** Enquanto a coluna nasceu por `ALTER TABLE`, a mesma migração retroalimentava a história anterior atribuindo cada linha à OM **atual** do recurso, que é a aproximação que o desenho recusa daqui para a frente, aceita ali por uma razão só: sem ela o produtor abriria a tela e veria lista vazia, indistinguível de "nada aconteceu". Com o schema consolidado em baselines, `target_org_id` nasce com a tabela (`backend/src/database/migrations/002_auditoria.sql`) e num banco novo não há história para aproximar: toda linha é gravada pelo emissor, no ato. A ressalva na aba continua valendo para instalação que tenha rodado o backfill, e some junto com ela.

## Leitura: o gate tem dois ramos desde 2026-08-21

O gate deixou de ser `requireAdmin` e passou a ser `requireAuditReader` (`backend/src/middleware/require-audit-reader.js`), com dois ramos e um recorte:

- **administrador global**: a trilha inteira, e pode estreitar por `targetOrgId`;
- **produtor**: a trilha da OM dele (o escopo `users.producer_org_id`), e nada além dela.

**O recorte não é parâmetro do cliente.** Ele é resolvido no banco pelo middleware, deixado em `req.auditScope`, e imposto na primeira linha de `listAudit` (`backend/src/modules/audit/audit.service.js`): quem não administra tem o `targetOrgId` da query **ignorado**, nunca obedecido. É por morar no serviço, e não no controller, que o caso que o prova monta uma query hostil à mão, sem HTTP.

O **credenciado leva 403**, e a distinção é o ponto: ler todo recurso privado (o que ele faz) e ler o registro de atos sobre contas, atlas, configuração e permissões são poderes diferentes. Escrever o gate com `fn_has_global_data_access` o promoveria em silêncio, que é a confusão que a fase F9 já pagou uma vez em `requireGrantRevoker`. Os quatro ramos estão em `backend/tests/integration/auditoria-gate.test.js`.

**A liveness tem TRÊS termos, não dois**, e espelha `fn_can_produce_resource`: conta ativa, OM de **lotação** ativa e OM **produtora** ativa. As três colunas são independentes, e `users.organization_id` (lotação) e `users.producer_org_id` (produção) podem apontar para organizações diferentes. O terceiro termo entrou depois de uma revisão adversarial medi-lo ausente: com só os dois primeiros, desativar a OM produtora tirava do produtor o direito de manter o acervo (`fn_can_produce_resource` passava a `false`) e deixava a leitura da trilha daquela OM aberta, ou seja, um kill-switch que fechava a escrita e não a leitura. O termo carrega o disjunto `role = 'admin'`, sem o qual o administrador (que não tem OM produtora) seria derrubado pelo próprio predicado.

Três medições que contrariam a intuição e estão escritas nos casos:

- desativar a **conta** dá 401, porque a reconciliação ao vivo do `auth` roda antes do gate;
- desativar a **OM de lotação** de um produtor dá 403;
- desativar a **OM de lotação de um administrador** dá 403 em `GET /audit` **e também** em `GET /users`. Uma revisão previu divergência aqui (que `requireAdmin`, decidindo pelo JWT, manteria o administrador de pé) e a medição a desmentiu: quem derruba é o `auth`, não o gate, porque `utils/org-status.js` já barra membro de OM desativada antes de qualquer autorização. O termo de lotação no gate continua valendo como segunda linha de defesa, e é ele que mantém o espelho fiel quando o middleware é chamado sozinho.

O efeito de produto é o mesmo em todos: quem foi suspenso não lê a trilha. Os casos ficam em `backend/tests/integration/auditoria-gate.test.js`, com a fixture usando **duas OM distintas** para lotação e produção. Com a mesma OM nos dois papéis, o 403 não dizia qual termo o havia produzido, e foi assim que o terceiro passou despercebido.

O papel é **vivo**, resolvido no banco e nunca lido do JWT, pela mesma razão de `fn_has_global_data_access`: o token vive até 15 min e `flexibleAuth` não reconcilia. Ausência de credencial dá 401, não 403; erro de Joi dá 422 (ver [[erros-api]] e [[sintese-contrato-erros-http]]), e o gate roda **antes** do `validate`, para que o 403 de papel não compita com o 422 de query.

A resposta passou a **variar por chamador**, então o controller marca escopo de cache (`marcarEscopoJson`): sem `Cache-Control`, um cache compartilhado pode guardar por heurística e repor a trilha do administrador para o produtor, e a isenção do RFC 9111 para `Authorization` não cobre a requisição autenticada por cookie. O cabeçalho é **asserido**, com a discriminação de uma rota vizinha que não o marca: a rota está fora do censo de regime de cache (aquela lista é bicondicional com as superfícies que servem recurso), então sem o caso a justificativa seria prosa que nada checa, e apagar a linha do controller deixaria a suíte inteira verde.

## Leitura: armadilhas de integração de `GET /api/v1/audit`

Quatro pegadinhas para quem for construir a tela:

- **Envelope duplamente aninhado.** O controller faz `res.json({ data: result })` sobre um `result` que já é `{ total, page, limit, data }` (`backend/src/modules/audit/audit.controller.js`, `backend/src/modules/audit/audit.service.js`). Os eventos ficam em `response.data.data`. É o erro de integração mais provável nesta rota, e desde 2026-08-21 é o que a spec de contrato `frontend/tests/e2e/audit-trail.e2e.test.js` mede contra o backend real, junto da forma de uma linha.
- **String vazia não é "sem filtro"** na borda: `listAuditSchema` usa `Joi.string()`, que a recusa (`"action" is not allowed to be empty`). A aba nasce com quatro filtros em string vazia, então o descarte de valor vazio em `apiClient.listAudit` é o que separa a aba abrir de a aba responder 422 em toda montagem, para as duas audiências. Pinado por `frontend/tests/unit/audit-client-params.test.js` e pela spec de contrato acima.
- **Paginação 1-based** (`backend/src/modules/audit/audit.service.js`). Tabela de UI 0-based precisa somar 1.
- **Filtros são igualdade exata**, via `($1::text IS NULL OR action = $1)` (`backend/src/modules/audit/audit.queries.js`). Não há busca parcial nem case-insensitive: `action=org_create` não retorna nada, e `action=all` filtra por uma ação literal chamada `all` devolvendo lista vazia sem erro. Para "todos", **omita o param**. Params desconhecidos são descartados em silêncio pelo `stripUnknown` (`backend/src/middleware/validate.js`), então um filtro com nome errado parece funcionar e traz tudo.
- **Linhas saem em snake_case**, sem camelização, ao contrário de outras superfícies do cliente (ver [[api-rest-atlas]]).

O filtro por `targetId` nasceu junto com o alargamento, e é o que paga a migração: sem ele "tudo que já foi feito com este recurso" continuaria não sendo respondível, apesar do índice `(target_type, target_id)`. O filtro por **período** passou a existir em 2026-08-21 (`from` e `to`), e ele é **meio-aberto**: `created_at >= from` e `created_at < to`, para que a linha nascida na virada do dia não caia nos dois lados. `total` e as linhas vêm de duas queries em `Promise.all` sem transação (`backend/src/modules/audit/audit.service.js`): sob escrita concorrente podem discordar por uma linha, irrelevante para tela de admin, relevante se alguém usar isso para reconciliação exata.

## O `details` carrega um de-para SELETIVO, e o que ele não carrega é o ponto

Até 2026-08-21 `CATALOG_UPDATE` gravava só os NOMES dos campos tocados (`details.fields`), e a regra era escrita: `details` nunca carrega valor. O motivo continua válido e é o que governa o desenho novo: `config` guarda URL de serviço (às vezes com credencial na query string) e as miniaturas são data URL de até 256 kB; a trilha é lida por qualquer administrador e, desde o eixo de OM, por qualquer produtor da OM dona; e **a trilha não se edita**, então o que entra ali entra para sempre.

Só que "o nome do campo" não responde a pergunta que a investigação faz. "Fulano alterou `config`" não distingue trocar a opacidade de apontar a camada para outro servidor, e não responde de jeito nenhum à pergunta mais frequente: *mudou e depois voltou ao que era?*

A resolução é um de-para de **três regimes**, por lista fechada de caminhos, em `backend/src/utils/audit-diff.js`. Ele nasceu para catálogo e 360 e passou a valer também para a família de **usuários** em 2026-08-23 (cláusula 9.3), pelas MESMAS listas e pelo mesmo motor: as listas são globais, não por família, e o preço dessa escolha é que os nomes de campo competem num espaço único (hoje sem colisão, porque a linha de catálogo tem `name` e a de conta tem `nome`).

| regime | o que entra na linha | quem entra |
|---|---|---|
| VALOR | o valor antigo e o novo, literais | `name`, `description`, `sort_order`, e os campos pequenos e não-endereçáveis de `config` (forma do 3D, zoom, opacidade, deslocamento de altura, data de captura, local) |
| IMPRESSÃO | um HMAC truncado de cada lado, mais o tamanho em bytes | tudo que é ENDEREÇO ou MÍDIA: as URLs de serviço, o estilo, as miniaturas, o vídeo de prévia e as estruturas de tamanho livre |
| NOME-SÓ | só o nome do campo | qualquer chave que ninguém classificou |

As duas listas fechadas são `CAMPOS_COM_VALOR` e `CAMPOS_COM_IMPRESSAO`, e a coluna "quem entra" acima é **ilustração, não inventário**: esta tabela nasceu enumerando os doze caminhos do regime IMPRESSÃO e já divergiu do código na primeira revisão (faltava `config.labelSource`). Enumeração em prosa não tem guarda: `docs-integridade` valida caminho e símbolo, nunca a completude de uma lista.

Cinco propriedades que não se deduzem lendo a tabela:

- **O default é o regime nome-só**, que é exatamente a garantia antiga preservada como piso. Uma chave nova em `config` entra por ali, calada e fechada, sem que ninguém precise lembrar daquele arquivo. A direção do erro é deliberada: classificar de menos custa informação, classificar de mais custa um vazamento permanente.
- **A impressão é chaveada (HMAC), não um hash nu.** Um digest sem chave transformaria a trilha em oráculo de confirmação: quem a lê testaria um palpite de URL contra o valor gravado. A chave é derivada do segredo de JWT com separação de domínio (`derivarChaveDeImpressao`, `backend/src/config.js`) em vez de vir de uma env nova, porque env ausente degrada em silêncio (o deploy subiria com chave vazia e toda impressão viraria a impressão do vazio). A contrapartida: essa chave **não pode sair em resposta nenhuma**, e nenhum endpoint pode aceitar um valor do chamador e devolver a impressão dele.
- **Um campo do regime VALOR cai para IMPRESSÃO quando o valor é grande demais** (acima de 200 caracteres). "Campo pequeno" é uma expectativa, não uma garantia: `description` é `Joi.string()` sem teto.
- **Há um teto duro de 4 kB, e ele degrada a linha INTEIRA para nome-só**, marcando `truncado: true`. Meia degradação seria uma linha que mente por omissão sem dizer que omitiu, e a tela mostra o aviso por extenso.
- **O regime IMPRESSÃO divulga o COMPRIMENTO exato do valor de cada lado**, e é o único metadado que ele deixa escapar. Não é um byte do valor, mas é um oráculo de tamanho sobre uma URL que pode carregar `?api_key=`, gravado para sempre. Fica porque responde "encolheu ou cresceu?" sem carregar conteúdo, e está escrito aqui e no cabeçalho de `backend/src/utils/audit-diff.js` porque a frase "sem carregar um único byte do valor" é literal e não é a história inteira.

`details.fields` **continua presente na LINHA**: o de-para é aditivo, nunca substituto, porque `backend/tests/integration/auditoria-acoes-novas.test.js` já o lia e trocar a forma quebraria um verde que verifica algo real. Na TELA ele é outra história: numa linha com de-para ele é o mesmo conjunto dito duas vezes, então a gaveta o esconde, e numa linha antiga, sem de-para, ele é a única informação de campo que existe e sobrevive. A decisão é `chavesJaDitasPeloDePara` (`frontend/src/js/admin/audit-phrases.js`), no módulo puro e não no construtor de DOM, para ter guarda em node.

O guarda é `backend/tests/unit/audit-diff.test.js`, e o caso que vale a pena conhecer é o controle: uma edição planta uma URL com credencial e uma miniatura embutida, e a asserção procura a substring do segredo no **JSON inteiro** da linha de trilha, não no campo onde se esperaria encontrá-la. A metade de integração é `backend/tests/integration/catalogo-video-de-previa.test.js`.

### O que a família de USUÁRIOS acrescentou

Três coisas que não se deduzem da tabela acima, porque a família de conta levanta perguntas que a de catálogo não levantava.

- **O miolo entra LITERAL, e a razão é de autoridade, não de tamanho.** `role` e `producer_org_id` são os dois fundamentos de concessão de RAIZ (`fundamentoDeRaizPerdido`, em `backend/src/modules/users/users.service.js`): mudar qualquer um dos dois derruba, na mesma transação, tudo o que aquela pessoa concedeu. Uma linha que dissesse "o papel mudou" sem dizer de onde para onde não responde a pergunta que essa queda levanta. Junto com eles entram `organization_id`, `rank_id`, `is_active` e `email_verified`, que são escalares fechados.
- **A identidade entra por IMPRESSÃO.** `nome`, `username` e `email` não caem para nome-só (a trilha continua respondendo "renomearam a conta e desfizeram?") e não entram literais, porque a trilha não se edita e o nome civil de uma pessoa gravado para sempre é dado pessoal a mais do que a auditoria exige.
- **Existe uma TERCEIRA lista, e ela é mais forte que o piso**: `CAMPOS_FORA_DO_DEPARA` elide caminhos antes da comparação, então eles não viram valor, nem impressão, nem nome. Ela tem duas metades com razões diferentes: CREDENCIAL (`password_hash`, `api_key`, `sessions_valid_from`, porque nome de campo de credencial numa trilha convida a próxima revisão a pôr o valor) e RUÍDO/DERIVAÇÃO (`updated_at`, que muda em TODA gravação por construção, mais `id`, `created_at`, `last_login_at`, `posto_graduacao` e `organizacao_militar`, que são nomes trazidos por junção a partir de ids já classificados). Coluna NOVA que ninguém classifique continua caindo em nome-só: só o que está nessa lista desaparece.

Duas consequências no emissor. A primeira: `USER_UPDATE` passou a nascer também quando o PUT traz **só** o papel, caso em que `fields` fica vazio; antes disso nenhuma linha nascia (o `ROLE_CHANGE` bastava) e o de-para do campo mais importante da família não teria onde morar. A segunda: **um PUT que não muda nada escreve a linha com o de-para VAZIO**, e isso é escolha, não descuido, porque lista vazia distingue "nada mudou" de "esta linha é antiga e não tem de-para". Guarda: `backend/tests/integration/auditoria-usuarios-de-para.test.js`.

## A aba Auditoria, e o que ela decide para não virar um dump

O cliente passou a consumir a rota em 2026-08-21 (`listAudit`, em `frontend/src/js/store/sync/api-client.js`), e a tela é a aba Auditoria do painel de administração (`frontend/src/js/admin/audit-tab.js`). Ela é oferecida ao administrador e ao **produtor**; o credenciado não a recebe, porque o gate do servidor lhe daria 403 e oferecer a aba seria a pior forma de dizer não.

Quatro decisões governam a tela, e todas respondem ao mesmo risco (uma trilha bruta na tela é um log que ninguém lê):

- o período padrão é de **sete dias**, não "tudo";
- as linhas são agrupadas por **dia**, com cabeçalho pegajoso;
- cada linha é uma **frase** em pt-BR (`frontend/src/js/admin/audit-phrases.js`), não cinco colunas de código em maiúsculas;
- o `details` fica **atrás de um botão**, e dentro dele o de-para vem primeiro, em frases (`linhasDoDePara`), com o regime dito por extenso: uma impressão de doze hexadecimais sem a palavra "impressão" ao lado lê-se como um valor gravado.

A SEGUNDA seção da gaveta (o resto do `details`) deixou de ser chave/valor cru em 2026-08-23, e o defeito que isso fecha era concreto: `origem: USER_DEMOTION` saía em inglês e em maiúsculas num painel em português, exatamente onde o leitor precisava entender por que uma concessão que ninguém revogou aparecia revogada. Quem decide é `linhasDeDetalhe` (`frontend/src/js/admin/audit-phrases.js`), e o vocabulário de `origem` são os quatro carimbos que `podarPorRaizes` recebe; a revogação deliberada não carimba nada, e a ausência já significa "alguém revogou de propósito". A regra do que fica sem verbete é a mesma do resto do arquivo, com uma metade nova: o não traduzido **aparece**, e aparece com a classe de CÓDIGO. Esconder é pior que mostrar; mostrar um enum com cara de frase em português é pior que mostrá-lo como código. A função devolve as duas bandeiras separadas (chave e valor), porque as duas metades podem faltar independentemente.

A ação aparece **uma vez por linha**, no chip. O texto ao lado é `alvoDoEvento` (ator e alvo) e não `fraseDoEvento`, que já embute o rótulo da ação: as duas versões da linha foram escritas na mesma onda e ambas ficaram, e a linha saía com "Item de catálogo alterado" duas vezes, uma no chip e outra na frase. `fraseDoEvento` sobrevive no `title`, que é onde ela é útil (ler o evento sem o chip ao lado). O caso que prende isso é **negativo** (o texto do chip não pode aparecer na frase da linha), com o par positivo ao lado, porque uma frase vazia passaria na asserção de ausência sozinha.

Os rótulos de FAMÍLIA (`Acesso`, `Identidade`, `Acervo`, `Atlas`, `Sistema`) são de tela e vêm de `rotuloDeFamilia`; as chaves em minúscula são código (elas viram sufixo de classe CSS) e saíam cruas nos `<optgroup>` do filtro de ação.

**Ação sem tradução mostra o próprio código**, nunca "Desconhecido": um rótulo genérico esconderia uma ação nova sem frase, que é a classe de defeito que este repositório mais paga. Quem cobra a tradução é `frontend/tests/unit/auditoria-rotulos.test.js`, e o inventário dele vem da **migração vigente**, não do mapa que ele testa, nem de uma lista escrita à mão.

O que o produtor **não** vê: a coluna da OM e o filtro dela. Para ele a resposta inteira já é de uma OM só, e o controle seria uma afordância sem efeito. Quem decide isso não é a tela: o servidor devolve `administra` e `escopoOrgId` no mesmo corpo, e a tela obedece.

Auditoria é REST puro e não é entidade colaborativa: não gera nem consome operações de colaboração, então nada disso passa por [[modelo-conflito-lww]] ou [[envelope-operacao]]. Para o que o admin faz sobre o sync em si, ver [[sync-admin-operacoes]] e [[hardening-borda-api]].

## Histórico

- **2026-07-25.** A seção "O CHECK não é cobertura" descrevia seis chamadas contra 15 ações e nomeava `SHARING_CHANGE` e `PERMISSION_REVOKE` como nunca emitidas. Superado pela cobertura de `users` e `sharing`.
- **2026-08-21.** Duas afirmações desta página deixaram de valer no mesmo dia, e as duas eram do tipo que envelhece sem aviso: "o gate é o papel global de administrador" (ele passou a ter dois ramos, e o segundo é o escopo de produção) e "o cliente web não consome a rota" (a aba Auditoria nasceu). A segunda é a mais instrutiva: enquanto a tela era checklist, a página descrevia o estado com precisão; no dia em que alguém a escreveu, a descrição virou o oposto do produto.
- **2026-08-17.** A página inteira girava em torno de "três ações continuam sem emissor" (`LOGIN`, `LOGOUT`, `ATLAS_DELETE`) e de alvos sem call site. Superado em 2026-08-17: as três ganharam emissor, catorze ações novas entraram (catálogo, `config_settings`, ciclo de vida do atlas, 360 no nível do projeto, escopo de produção, purga de concessões), `target_id` virou TEXT, e a cobertura passou a ser cobrada por censo em vez de por leitura. Esta é a forma de conteúdo que o [[wiki-schema]] adverte: lista de furos abertos escrita no presente vence por trabalho alheio, e vira lista de mentiras no dia em que a fase seguinte fecha os itens.
