# API Keys de Usuário

Credencial de integração **fora do navegador**, em duas moradas (o slot legado `users.api_key`, uma por conta, e as chaves NOMEADAS de `api_keys`, com prazo, escopo e revogação individual), guardada em claro e resolvida por uma consulta só.

## O que ela deixou de ser, e por que isso importa

Até 2026-08-24 a chave **era o usuário inteiro**: permanente, sem escopo, uma por conta, revogável só por rotação, e imune ao corte de sessão em massa. As três amarras (prazo, escopo, revogação individual) nasceram porque a cláusula 10.7 de [`../../CONSTITUICAO.md`](../../CONSTITUICAO.md) ia fazê-la viajar na URL de **cada tile**, e a frase que resume o risco está lá: uma chave que vaza de um log de tile é uma sessão de administrador sem prazo. Daí a ordem, que não era preferência: as amarras primeiro, o `location` do nginx depois.

O destino mudou depois, sem desfazer as amarras. O gate do tile passou a ser por RECURSO e o transporte no navegador passou a ser o token em cookie, então a chave ficou para integração fora do navegador. Ver [[tile-privado]] e [[auth-flexivel]].

> **Esta página afirmou o mundo anterior até 2026-08-29.** Ela dizia "não expirante", "não tem escopo, rótulo nem expiração, e é uma só por usuário", "não existe rota separada de gerar chave" e "a única forma de invalidar é rotacionar". As quatro deixaram de valer, e a última é a que mais engana, porque a substituta faz o oposto: revogar UMA não derruba as irmãs.

## Duas moradas, uma porta

`FIND_USER_BY_API_KEY` (`backend/src/modules/users/users.queries.js`) é o **único** ponto do sistema em que as duas se encontram, por um `UNION ALL`: a tabela nova de um lado, o slot legado do outro, resolvendo com o escopo `full` que ele sempre teve. Não há risco de linha em dobro porque nenhuma migração copia o valor do slot para a tabela, e a coluna nova é `UNIQUE`.

O slot legado continua existindo porque migração é forward-only e integradores o carregam hoje; o caminho de saída, quando ninguém mais depender dele, é uma migração própria, e está escrito no `fileoverview` de `backend/src/modules/users/api-key-terms.js`. Duas moradas para uma credencial é custo real, declarado.

**A propriedade que decide o desenho: prazo, corte de sessão, conta ativa e OM de lotação ativa moram todos DENTRO daquela consulta**, e nenhum no middleware. Duas razões, e a segunda é a que não se adivinha: um chamador novo da consulta herda as quatro regras sem ter de lembrar de nenhuma, e no destino previsto para a chave (um `location` de nginx) **não existe middleware nosso para conferir coisa alguma**. O que a consulta não cobrar, ninguém cobra.

## Prazo: `NULL` lê-se como VENCIDA

- **Ele morre no PREDICADO, nunca por varredura**, exatamente como o da concessão de recurso ([[acesso-a-recurso-privado]]): um varredor de expiração seria mais um verificador, e verificador quebra calado.
- **O teto de um ano é do BANCO** (`api_keys_expires_at_check`), e o aparo em JS (`clampApiKeyTermDays`, `backend/src/modules/users/api-key-terms.js`) é conveniência de tela: quem pede 500 dias recebe 365, e um INSERT feito à mão numa sessão de psql esbarra no CHECK do mesmo jeito. As duas pontas do CHECK medem a partir de `created_at`, e não de `NOW()`, senão prorrogar uma linha antiga em pequenos saltos daria prazo ilimitado por soma. É o mesmo teto e a mesma âncora da concessão de recurso, de propósito: são as duas credenciais duráveis do sistema, e um teto diferente em cada uma faria "o prazo máximo" ser duas respostas.
- **Do lado do slot legado, coluna de prazo nula NÃO passa.** O `DEFAULT` da migração tornou o nulo inalcançável pelos caminhos que existem, e é justamente por isso que ele precisa falhar fechado: a única forma de aparecer um é alguém escrever a coluna à mão, e aí a leitura correta é "esta linha não declarou prazo", nunca "esta chave é eterna".
- **A rotação RENOVA o prazo** (`ROTATE_API_KEY`). Sem isso o slot legado venceria noventa dias depois da migração que criou a coluna, e a única saída do integrador seria rotacionar para outra chave já vencida: a amarra viraria parede.

## Escopo: uma tabela de alcance, não um `if`

`API_KEY_SCOPE_REACH` é o inventário, uma linha por escopo e uma coluna por superfície restrita, e `apiKeyReaches` é o predicado. Escrever a comparação por igualdade espalhada pelos gates seria a lista fechada que a constituição proíbe nos dois eixos de permissão, com o agravante de que aqui ela falharia **aberto**: o escopo que alguém inventar depois deste build cairia no `else`. O predicado falha fechado nos dois eixos, escopo desconhecido e superfície desconhecida.

- **Nenhum escopo alcança administração**, e isso é dado, não um `return false` escondido no gate. `requireAdmin` (`backend/src/middleware/require-admin.js`) recusa **toda** chave, inclusive a de um administrador, e a recusa vem **antes** da checagem de papel: com ela depois, a mensagem para o administrador com chave seria a de papel insuficiente, que é falsa e manda procurar o problema no lugar errado.
- **O `auth` estrito recusa a chave de escopo `tiles`**, com `403` e não `401`: a credencial é válida e o principal está vivo, e um 401 mandaria o cliente derrubar a sessão e tentar de novo, que é o laço errado.
- **O escopo padrão da emissão é o de tile** (`API_KEY_SCOPE_DEFAULT`): o alcance largo precisa ser pedido.
- **O gate do tile LÊ o mesmo vocabulário em vez de escrever uma segunda tabela** (`scopeReachesTile`, `backend/src/modules/auth/tile-access.js`), e a checagem fica dentro do ramo de chave de propósito: aplicá-la ao JWT compararia um vocabulário de chave com uma sessão que não tem escopo nenhum, e o `undefined` resultante recusaria toda sessão de usuário. Falha fechada, e ainda assim errada.

**A consulta autentica, ela não autoriza.** O escopo é devolvido em `req.user`, não imposto, porque a superfície que a requisição alcança é coisa que só a rota sabe. Ver [[auth-flexivel]].

## Revogação individual, e o corte que derruba todas

`REVOKE_API_KEY` marca uma linha, e as irmãs continuam de pé. Três propriedades que o SQL não explica:

- **O `user_id` viaja no `WHERE`**, e não só nos gates da rota: sem ele, quem conhecesse o id de uma linha revogaria a chave alheia pela rota de auto-serviço, que é o gate de posse mais barato de esquecer. Zero linhas viram 404, sem distinguir "não existe" de "não é sua", que seria um oráculo.
- **Revogar é idempotente na direção segura.** O `revoked_at IS NULL` do UPDATE faz a segunda chamada devolver 404 em vez de reescrever a hora, o que apagaria QUANDO a chave caiu, que é o dado de que a investigação precisa.
- **A listagem inclui as mortas e nunca o segredo** (`LIST_API_KEYS`). Quem investiga um vazamento precisa ver que a chave existiu e quando caiu; uma lista só de vivas responde "essa chave nunca existiu" a quem procura a que vazou. O slot legado **não** aparece ali: ele não tem linha, e inventar uma sintética daria à rota de revogação um id que ela não sabe apagar.

**O administrador REVOGA e não EMITE**, e a assimetria é decisão (`revokeUserApiKey`, `backend/src/modules/users/users.controller.js`): desligar a chave alheia é contenção de incidente, ligar uma é personificação, porque seria uma credencial que o titular nunca viu e que carrega o nome dele.

**O teto de chaves vivas** (`API_KEY_LIVE_LIMIT`) conta pelo MESMO predicado da autenticação, não revogada **e** não vencida. Contar só as não revogadas trancaria fora de emitir quem acumulou dez chaves vencidas, que é recusar por um motivo ilegível na tela.

**O corte de sessão em massa alcança a chave desde 2026-08-24**, comparado com o NASCIMENTO dela (uma chave não tem `iat` para comparar, e era por isso que ela escapava). Isso é tensão declarada, e a cláusula 10.7 a registra para que ninguém a "conserte" depois: a revogação individual existe justamente para que desligar uma credencial não derrube as outras integrações da pessoa, e o corte derruba todas de uma vez. O que separa os dois casos é o GATILHO. Rotação de rotina é higiene e não deve custar as irmãs; troca de senha, reset por administrador, redefinição por e-mail, desativação e detecção de reuso são eventos de SEGURANÇA, em que a suposição correta é a de que a identidade inteira está comprometida ([[autenticacao-jwt]]).

**A consequência que atravessa três arquivos, e contradiz o que esta página dizia:** desativar uma conta **pela rota administrativa** carimba o corte, porque `deleteUser` (`backend/src/modules/users/users.service.js`) chama `REVOKE_ALL_USER_TOKENS` logo depois do `SOFT_DELETE_USER`, e `REACTIVATE_USER` não limpa aquele carimbo. Então as chaves que existiam antes **não voltam** com a reativação: elas ficam do lado errado do corte para sempre, e o caminho é emitir outra. A leitura que engana é a do teste de amarras, que afirma que a chave "volta a autenticar na reativação": ele está certo sobre o que mede, porque escreve `is_active` direto no banco e por isso nunca passa pelo carimbo. Ver [[gestao-usuarios]].

## Rotação do slot legado

`ROTATE_API_KEY` é um único statement com CTE, e três efeitos dele não são óbvios lendo o SQL:

- **É também o endpoint de criação** daquele slot. O predicado `api_key IS NOT NULL` faz o usuário que nunca teve chave arquivar zero linhas enquanto o `UPDATE` gera a primeira. Emitir uma chave **nomeada** é outra rota e outra tabela, não uma variação desta.
- **Não há janela com duas chaves válidas.** A antiga para de autenticar no mesmo instante em que a nova nasce, fixado em `backend/tests/integration/identity.test.js`. Não planeje migração de cliente contando com sobreposição: o corte é instantâneo, e é exatamente o defeito que a revogação individual resolve para quem migrar para o modelo novo.
- **O nascimento volta para agora**, junto com o prazo, porque a chave é OUTRA. Herdar o nascimento da anterior faria uma chave recém-emitida nascer do lado errado de um corte de sessão antigo.

A resposta é a **única** vez que a chave nova aparece, e isso vale para as duas moradas: não há rota de leitura, nenhuma query do módulo `users` seleciona a coluna do segredo, e `LIST_API_KEYS` a omite de propósito. Perdeu, emite outra.

Sobre erros da rota admin ([[erros-api]], [[sintese-contrato-erros-http]]): o `404` para UUID bem formado sem usuário correspondente é intencional (`rotateApiKey`, `backend/src/modules/users/users.service.js`), e não uma lacuna de validação.

## Precedência: a chave é uma TENTATIVA, não uma escolha de mecanismo

`flexibleAuth` (`backend/src/middleware/flexible-auth.js`) tenta a API key antes de tudo, mas a tentativa só encerra a decisão quando ela **resolve** para um usuário: o `return next()` mora **dentro** do `if (rows[0])`, e o `UUID_RE` barra a string malformada antes de qualquer ida ao banco. Chave malformada, vencida, revogada, de conta desativada, de OM desativada ou ausente das duas moradas cai no ramo seguinte, e o cookie ou o `Authorization: Bearer` do mesmo request continuam valendo.

A precedência que sobra é estrita: chave **boa** ganha do Bearer bom, e a identidade que vale é a do dono da chave. Um cliente que mande as duas credenciais no mesmo request não escolhe qual delas responde. Chave malformada não toca o Postgres, comportamento fixado em `backend/tests/integration/identity.test.js`; as outras armadilhas de precedência do mesmo middleware estão em [[auth-flexivel]].

## Decisões que o código não explica

**A chave é armazenada em claro, não hasheada.** O lookup de autenticação é uma igualdade indexada executada a cada request; hashear obrigaria a varrer a tabela para comparar. A alternativa foi rejeitada por custo por requisição, e o preço é explícito: quem lê o banco lê todas as credenciais em claro, nas duas moradas e no histórico. Acesso ao banco é acesso total.

**O formato continua sendo UUID**, e não um segredo mais longo, porque `flexibleAuth` testa a FORMA antes de ir ao banco: essa peneira é o que impede que qualquer `?api_key=` de passante vire uma consulta. Trocar o formato custaria a peneira e o caminho de migração das chaves vivas ao mesmo tempo, e obrigaria a mudar aquela regex, senão toda chave nova viraria anônima antes de chegar ao Postgres.

**Uma chave nomeada carrega a identidade do dono, menos administração.** Ela não é uma permissão reduzida por recurso: o recorte que existe é o de SUPERFÍCIE (a tabela de alcance), e quem decide o que ela vê dentro do acervo continua sendo o predicado SQL de recurso privado ([[acesso-a-recurso-privado]], [[sintese-eixos-de-permissao]]).

## Armadilhas

- **`created_at` no histórico de rotação é sempre `NULL`.** A CTE insere literalmente `NULL::timestamptz`. A razão que esta página dava (que `users` não guardaria quando a chave foi emitida) deixou de valer em 2026-08-24, porque a coluna de nascimento existe hoje; ela existe para o CORTE DE SESSÃO e não para relatório, e a linha de histórico continua nascendo sem data de emissão. Só a hora da revogação é confiável ali, e a emissão de uma chave só é inferível como a revogação da anterior.
- **`mapDbUser` descarta campos que a query traz.** `FIND_USER_BY_API_KEY` seleciona `organizacao_militar` e `rank_id`, mas `mapDbUser` (`backend/src/middleware/flexible-auth.js`) não os copia para `req.user`. Um handler que dependa desses campos funciona no caminho JWT e quebra no caminho da chave.
- **A chave na query string vaza fora do alcance do backend.** O backend redige `api_key` dos próprios logs (`SENSITIVE_QUERY_KEYS`, `backend/src/utils/redact-url.js`), mas isso não alcança nginx, CDN, histórico de shell ou `Referer`. Prefira sempre o header; a query existe só para clientes que não conseguem setar headers. Ver [[hardening-borda-api]].
- **A redação delimita menos do que o "nunca em texto puro" sugere.** Ela cobre credencial que viaja na **URL da requisição**, reescrevendo `req.url` antes do log, e nada mais. Campo de log estruturado passa inteiro, e o sistema usa isso de propósito: fora de produção o mailer grava o link de verificação, com o token dentro, num campo do próprio log ([[autenticacao-jwt]]).
- **Nenhum rate limit na emissão nem na rotação.** As rotas levam só `auth`/`requireAdmin` e validação. O teto de dez vivas limita `api_keys`, e não `api_key_history`: rotação em loop continua barata para o cliente e cresce o histórico sem teto.
- **Chave não é para navegador, e desde 2026-08-29 isso é decisão registrada e não conselho.** O transporte de leitura do navegador é o cookie de sessão, que carrega o mesmo JWT, é `httpOnly` e vence com o token; a escrita continua pelo cabeçalho. Ver [[tile-privado]] e [[auth-flexivel]].

## Trilha

São **três** ações na lista fechada do CHECK de `audit_trail` (`backend/src/database/migrations/002_auditoria.sql`): a rotação do slot legado, mais a emissão e a revogação das nomeadas. É **contrato congelado**, e ação nova exige migração ([[auditoria]]).

O segredo **não** entra em `details` em nenhuma das três: `details` é JSONB lido por administrador e pelo produtor da OM, e gravar a chave ali seria distribuí-la para quem investiga. O que entra é o id da linha, o rótulo, o escopo e o prazo.

## Histórico

- **2026-08-29.** Reescrita por supersessão temporal: a página descrevia a chave anterior às três amarras (2026-08-24) e ao cookie de sessão (2026-08-29). O que ela afirmava e deixou de valer está citado na primeira seção, mais a seção "O comportamento que só emerge de dois middlewares", que descrevia como vigente o buraco da OM desativada, fechado em 2026-08-24 quando o termo de organização entrou em `FIND_USER_BY_API_KEY`, e a armadilha que dizia que a chave volta a autenticar na reativação da conta.
- **2026-08-23.** A seção de precedência descrevia o BUG como comportamento vigente, e por isso contradizia [[auth-flexivel]], que já registrava o estado certo. O que ela dizia: até 2026-07-25 o `return next()` do ramo da chave ficava **fora** do `if (rows[0])`, então a mera PRESENÇA de `x-api-key` ou `?api_key=` pulava cookie e Bearer, e chave rotacionada ou malformada deixava a requisição anônima mesmo com um Bearer válido no mesmo request. Como o gatilho morava também na query string, bastava conseguir que a vítima abrisse `...?api_key=qualquercoisa` para demovê-la da própria sessão. O comentário de `flexibleAuth` documenta a correção no ponto onde ela vive.
