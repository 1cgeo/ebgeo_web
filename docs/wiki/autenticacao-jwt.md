# Autenticação JWT (access + refresh)

Par de tokens do EBGeo: access JWT HS256 stateless (15 min, **irrevogável**) e refresh opaco rotativo (7 dias, revogável). Superfície das rotas em `backend/src/modules/auth/auth.routes.js`, payload em [[jwt-emissor-unico]].

## A assimetria que governa tudo: o access token não é revogável

O access token não tem estado no servidor, só assinatura. Desativar um usuário **não** invalida o JWT que ele já tem. Toda a arquitetura em volta existe para compensar isso:

- o middleware estrito reconcilia o token contra o banco a cada requisição (`middleware/auth.js:84-112`);
- o `role` **global** é sobrescrito pelo valor vivo, para que um admin rebaixado não continue admin durante a janela do token;
- `org_role` e `organization_id` **não** são sobrescritos de propósito (`middleware/auth.js:104-107`): pertencem ao mapeamento do token, e um token legado sem claims de org precisa degradar para `viewer`/`null`.

Consequência que morde: **mudança de papel global vale na hora; mudança de OM ou de papel org-scoped leva até 15 minutos para valer.** Ver [[permissoes-atlas]] e [[sintese-eixos-de-permissao]].

A sessão deslizante do cookie (`middleware/flexible-auth.js:75-105`) tinha um furo pior: reassinar as claims antigas transformava "≤15 min desatualizado" em "para sempre", porque um usuário desativado que mantivesse uma requisição a cada 15 min renovava a sessão indefinidamente. Por isso a renovação **consulta o banco antes** de reemitir. Não reintroduza reemissão cega. Ver [[auth-flexivel]].

Principais de link público (`sub` no formato `public-<uuid>`, que não é UUID puro) são **isentos** da reconciliação: não existe linha em `users` para eles (`middleware/auth.js:80-82`). A autoridade vem do token assinado mais a flag `is_public` do atlas. Ver [[link-publico]].

## Refresh concorrente derruba a sessão

Reapresentar um refresh já revogado é lido como cadeia de rotação comprometida e **revoga a família inteira** do usuário (`backend/src/modules/auth/auth.service.js:142-146`). Por isso o lookup usa `FIND_REFRESH_TOKEN_ANY`, que inclui revogados: sem isso não daria para distinguir "nunca existiu" de "reusado".

Daí a armadilha operacional mais cara do módulo: duas requisições disparando refresh com o mesmo token fazem a segunda cair na detecção de reuso e **derrubar todas as sessões**. O `ApiClient` resolve com um único refresh em voo compartilhado (`frontend/src/js/store/sync/api-client.js`, promessa `_refreshing`). **Qualquer código novo que fale com a API deve passar por esse cliente**, nunca `fetch` direto com o refresh token. Ciclo completo em [[refresh-token-rotacao]].

Duas consequências que geram bug de UI:

- `POST /auth/refresh` **não** devolve `user`, só o par de tokens. Para reler `organization_id`/`org_role` depois de um refresh, chame `GET /auth/me`.
- `refresh` resolve o usuário com `FIND_USER_BY_ID`, que filtra `is_active = true` (`backend/src/modules/auth/auth.queries.js:15-23`). Uma conta desativada recebe aqui `401 Usuário não encontrado`, e **não** o `Conta desativada` do login. Não faça a UI depender dessa mensagem.

## Rate limit: a chave degrada em /auth/refresh

A chave do `authLimiter` é `` `${req.ip}:${username}` `` (`middleware/rate-limit.js:32`), o que funciona bem para `login`. Mas **o corpo do `/auth/refresh` não tem `username`**: a chave degrada para `ip:` e todos os refreshes daquele IP dividem o mesmo balde de 10 por 15 minutos. Atrás de NAT ou proxy corporativo, usuários estrangulam o refresh uns dos outros.

Trate `429` como backoff puro, **nunca** como gatilho de logout ou de novo refresh. Mais em [[hardening-borda-api]].

## Contratos congelados e decisões deliberadas

- **Aliases `org` e `login` no payload** existem só para o módulo 360 consumir o token de emissor único sem alteração (`backend/src/modules/auth/auth.service.js:34-37`). São contrato congelado ([[sintese-contratos-congelados]]).
- **Allowlist `['HS256']`** aplicada nos três pontos de verificação: REST estrito, auth flexível e handshake do WebSocket (`backend/src/config.js:53`). Token com `alg: none` ou assimétrico é rejeitado. Adicionar um algoritmo aqui vale para os três.
- **`posto_graduacao` e `organizacao_militar` são derivados por `LEFT JOIN`**, não colunas. O claim JWT chama-se `posto`, a resposta REST chama-se `posto_graduacao`: nomes **diferentes** para o mesmo dado. O frontend monta a identidade a partir do objeto `user` da resposta, não das claims (`frontend/src/js/store/sync/session-context.js`); não há decode de JWT no cliente.
- **Texto livre legado e FK coexistem** durante a transição: a leitura devolve strings (`organizacao_militar`), mas os corpos de escrita exigem UUID (`organization_id`). Ler um, escrever o outro é o padrão ([[gestao-usuarios]]).
- **Tokens persistem os dois em `localStorage`** sob a chave `ebgeo_auth`, degradando para memória só quando `localStorage` não existe. É deliberado (a sessão precisa sobreviver ao F5), mas quem auditar segurança deve saber que o access token está no disco do navegador.
- O handler `auth-lost` é conectado **depois do boot**, de propósito: um token expirado na inicialização cai silenciosamente no caminho anônimo em vez de abrir modal de sessão perdida. Ver [[sessao-boot-e-ciclo-de-vida]].

## Não-oráculos: onde o silêncio é intencional

Vários caminhos parecem descuidados e são deliberados. Não os "conserte" adicionando mensagens específicas:

- bcrypt **sempre** executa no login, contra o hash real ou contra `DUMMY_HASH` (`backend/src/modules/auth/auth.service.js:19,73-74`), removendo o oráculo de timing;
- usuário inexistente e senha errada devolvem `401` com a **mesma** mensagem;
- conflito de username e conflito de e-mail no registro devolvem a **mesma** mensagem genérica (`backend/src/modules/auth/auth.service.js:213-224`);
- `resend-verification` sempre resolve com sucesso, exista o e-mail ou não;
- `POST /auth/register` só é **montada** quando `ALLOW_SELF_REGISTRATION` está ligada (`backend/src/modules/auth/auth.routes.js:14-16`); desligada, cai no `404` genérico, sem vazar que o endpoint existe. Não assuma que a rota existe.

Contas **sem** e-mail (criadas por admin, legadas, máquina) pulam a porta de confirmação inteira (`backend/src/modules/auth/auth.service.js:87-89`), porque o gate só dispara quando `email IS NOT NULL`.

## Registro e verificação: dois cuidados de concorrência

O envio do e-mail é **best-effort**: a linha do usuário já foi commitada, e uma falha de e-mail não pode gerar `500`, o que deixaria uma conta órfã, impossível de re-registrar e de logar (`backend/src/modules/auth/auth.service.js:243-253`). Em caso de falha a conta fica pendente e o usuário reenvia.

`verifyEmail` consome o token dentro de uma transação, com a exclusão mútua na **própria cláusula `WHERE consumed_at IS NULL`** (`backend/src/modules/auth/auth.service.js:284-297`). A sequência ler-checar-escrever anterior permitia duas requisições concorrentes consumirem o mesmo token. Token expirado lança **dentro** da transação de propósito, para que a transação reverta o claim e o token não seja queimado silenciosamente.

## O link de verificação: quem escolhe o host, e quem vê o token

O host do link sai de `APP_BASE_URL`, e o `Origin` da requisição só é aceito quando é **exatamente** o `CORS_ORIGIN` do deployment (`backend/src/utils/mailer.js:50-60`). A alternativa rejeitada era confiar no `origin` verbatim: ele vem de `req.headers.origin` (`backend/src/modules/auth/auth.controller.js:29-31`), e `POST /auth/resend-verification` é montada sem `auth` e aceita qualquer e-mail no corpo (`backend/src/modules/auth/auth.routes.js:29`). Um anônimo fazia o servidor enviar à vítima uma mensagem **genuína**, com o `MAIL_FROM` real e o token real não consumido, apontando para o host dele. Era o default de fábrica até 2026-07-19, porque `APP_BASE_URL` é `optional(..., '')` (`backend/src/config.js:168`) enquanto `CORS_ORIGIN` é exigido em produção (`backend/src/config.js:273-277`).

**A armadilha que ficou no lugar dessa:** quando nada é confiável a base resolve para `''` e o link vira `/?verify=<token>`, uma URL relativa dentro de um e-mail. A mensagem sai, `sent: true`, nada registra erro. E o fallback compara `${req.protocol}://${req.get('host')}` com o `CORS_ORIGIN`, então basta o `X-Forwarded-Proto` do nginx não chegar ao Express (`TRUST_PROXY_HOPS`) para todo link de ativação virar inútil em silêncio. **Defina `APP_BASE_URL` em produção**: ela não está em `backend/.env.example` e nada no boot a exige, ao contrário do `CORS_ORIGIN`. Ver [[deploy-backend]].

O token do link é **credencial de fator único**: `verifyEmail` o consome e marca a conta verificada sem pedir mais nada. Por isso o link só é escrito no log **fora** de produção (`exposeLink = !config.isProd`, `backend/src/utils/mailer.js:123,146`). Em dev sem SMTP aquela linha de log **é** o canal de entrega; em produção a mesma situação loga em nível `error`, sem o link, e não existe plano B pelo log: a ativação passa por um admin enviando `email_verified: true` ([[gestao-usuarios]]). Não conte com o `redactUrl` para isso, ele só reescreve `req.url` e `verify` não está no `SENSITIVE_QUERY_KEYS` (`backend/src/utils/redact-url.js:6`).

## Logout não faz o que o nome sugere

`POST /auth/logout` revoga **apenas aquele** refresh token e devolve `204`. Não encerra o socket de colaboração e não invalida o access token: fechar o socket e desmontar a presença é responsabilidade do cliente ([[presenca-colaborativa]]).

Revogação em massa dos refresh tokens acontece só em: detecção de reuso, troca da própria senha, reset por admin e desativação do usuário ([[gestao-usuarios]]).

Um socket já aberto **não** revalida o token depois do handshake (`backend/src/modules/collab/collab.gateway.js:239-264`): a sessão do socket vive até o disconnect. Ver [[canal-collab-websocket]]. O `clientId` da query é chave de presença e idempotência, jamais credencial ([[client-id-estavel]]).

## Armadilhas de status code

- `422 VALIDATION_ERROR`, não `401`: senha de **5 caracteres no login** (o mínimo de 6 do `loginSchema` vale para autenticar, não só para cadastrar) e `token` de verificação fora do formato UUID. Se a UI trata "erro no login" como "credenciais inválidas", a mensagem sai errada.
- `401`, `403` e `429` são coisas distintas: `401` aciona refresh (uma vez) e depois login; `403` de OM inativa **não** se resolve com refresh ([[organizacoes-om]]); `429` é só espera.
- Não use `GET /health` para decidir online/offline no boot; o boot é fail-fast em `GET /api/config` ([[config-runtime-urls-relativas]]).
- Login e logout **não** aparecem hoje na trilha de auditoria, apesar de constarem no CHECK da tabela ([[auditoria]]).

Ver [[erros-api]] e [[sintese-contrato-erros-http]].

> **Nota histórica.** guia *11-seguranca-hardening* (absorvido) §2 e §3.2 documentam as mensagens em inglês (`Invalid credentials`, `Account is deactivated`, `Invalid refresh token`, `Refresh token expired`); o código emite português: `Usuário ou senha inválidos` (`backend/src/modules/auth/auth.service.js:78`), `Conta desativada` (`backend/src/modules/auth/auth.service.js:82`), `Sessão inválida. Entre novamente.` (`backend/src/modules/auth/auth.service.js:135,145`), `Sessão expirada. Entre novamente.` (`backend/src/modules/auth/auth.service.js:150`). Não faça matching por string de mensagem; use o `code` do envelope. As mensagens **em inglês** que existem de fato são as do middleware de JWT: `Token expired` / `Invalid token` (`middleware/auth.js:43,45`) e `Account is inactive` / `Organization is inactive` (`middleware/auth.js:95,98`).

> **Nota histórica.** guia *01-autenticacao* (absorvido) §9 mostra o corpo de `POST /auth/register` com `posto_graduacao` e `organizacao_militar` como texto livre; o schema real aceita `rank_id` e `organization_id` como **UUIDs** (`backend/src/modules/auth/auth.schemas.js:26-29`). O Joi é estrito quanto a campos desconhecidos: enviar o formato do doc é rejeitado.

> **Nota histórica.** guia *01-autenticacao* (absorvido) §3 recomenda access token em memória/`sessionStorage` e apenas o refresh em `localStorage`; o cliente real persiste **os dois** em `localStorage` (ver acima). Escolha deliberada, não descuido.
