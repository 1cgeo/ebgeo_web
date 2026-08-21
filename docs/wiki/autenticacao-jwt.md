# Autenticação JWT (access + refresh)

Par de tokens do EBGeo: access JWT HS256 stateless (15 min, sem revogação **por token**) e refresh opaco rotativo (7 dias, revogável). Superfície das rotas em `backend/src/modules/auth/auth.routes.js`, payload em [[jwt-emissor-unico]].

## A assimetria que governa tudo: o access token não se revoga sozinho

O access token não tem estado no servidor, só assinatura, e não carrega `jti` nem versão: **não há o que invalidar dentro dele**. Desativar um usuário não altera o JWT que ele já tem. Toda a arquitetura em volta existe para compensar isso, sempre da mesma forma: a decisão não sai do token, sai de uma leitura viva do banco:

- o middleware estrito reconcilia o token contra o banco a cada requisição (`auth`, `backend/src/middleware/auth.js`, via `getLiveAuthState`);
- o `role` **global** é sobrescrito pelo valor vivo, para que um admin rebaixado não continue admin durante a janela do token;
- o escopo de produção `producer_org_id` é sobrescrito **incondicionalmente**, porque é ele que autoriza escrever catálogo e acervo 360, e função se tira por ato de administração, não por relógio ([[acesso-a-recurso-privado]]);
- `org_role` e `organization_id` **não** são sobrescritos na rota estrita, de propósito: pertencem ao mapeamento do token, e um token legado sem claims de org precisa degradar para `viewer`/`null`. Eles não autorizam nada, então a janela continua aceitável;
- desde 2026-07-25 essa mesma leitura traz `users.sessions_valid_from`, um corte por CONTA (não por token): a revogação em massa carimba a hora, e todo token com `iat` anterior a ela é recusado. É o que dá efeito real a "trocar a senha derruba as outras sessões" e a "reuso de refresh detectado encerra a sessão roubada", porque antes disso as duas frases eram falsas. Mecanismo, fronteira de um segundo e limites em [[refresh-token-rotacao]].

Consequência que morde: **papel global e escopo de produção valem na hora; lotação e `org_role` levam até 15 minutos para valer, e não decidem nada enquanto isso.** Ver [[permissoes-atlas]] e [[sintese-eixos-de-permissao]].

A sessão deslizante do cookie (`backend/src/middleware/flexible-auth.js`) tinha um furo pior: reassinar as claims antigas transformava "≤15 min desatualizado" em "para sempre", porque um usuário desativado que mantivesse uma requisição a cada 15 min renovava a sessão indefinidamente. Por isso a renovação **consulta o banco antes** de reemitir. Não reintroduza reemissão cega. O mesmo furo existia para sessão revogada, e por muito mais tempo: até 2026-07-25 só desativação de conta ou de OM interrompia a renovação, então um token roubado se reemitia para sempre **depois** de a detecção de reuso ter disparado. Hoje o corte de sessão também a interrompe, e derruba o cookie. Ver [[auth-flexivel]].

Principais de link público (`sub` no formato `public-<uuid>`, que não é UUID puro) são **isentos** da reconciliação: não existe linha em `users` para eles (guarda `PRINCIPAL_UUID_RE`, `backend/src/middleware/auth.js`). A autoridade vem do token assinado mais a flag `is_public` do atlas. Desde 2026-07-24 a isenção vem **depois** de `confineVisitorPrincipal`, que confina o visitante ao atlas que emitiu o token: a ordem importa, porque a claim é o marcador do tipo de principal, e antes disso um token que se declarava público escapava dos dois. Ver [[link-publico]].

## Reuso de refresh derruba a sessão inteira

Reapresentar um refresh já revogado é lido como cadeia de rotação comprometida e **revoga a família inteira** do usuário (`refresh`, `backend/src/modules/auth/auth.service.js`). Por isso o lookup usa `FIND_REFRESH_TOKEN_ANY`, que inclui revogados: sem isso não daria para distinguir "nunca existiu" de "reusado".

A armadilha operacional daí é hoje mais estreita do que já foi: a rotação é um claim atômico com janela de graça de 10s, então a rajada honesta (duplo F5, duas abas, retry) recebe `401` e nada mais. Só o reuso **fora** da janela derruba todas as sessões. Isso não dispensa serializar: o `ApiClient` compartilha um único refresh em voo (`frontend/src/js/store/sync/api-client.js`, promessa `_refreshing`), e **qualquer código novo que fale com a API deve passar por esse cliente**, nunca `fetch` direto com o refresh token. Ciclo completo, e o preço da janela, em [[refresh-token-rotacao]].

Duas consequências que geram bug de UI:

- `POST /auth/refresh` **não** devolve `user`, só o par de tokens. Para reler `organization_id`/`org_role` depois de um refresh, chame `GET /auth/me`.
- `refresh` resolve o usuário com `FIND_USER_BY_ID`, que filtra `is_active = true` (`backend/src/modules/auth/auth.queries.js`). Uma conta desativada recebe aqui `401 Usuário não encontrado`, e **não** o `Conta desativada` do login. Não faça a UI depender dessa mensagem. A mesma query **não** traz `email_verified`, e a consequência disso está em [[refresh-token-rotacao]].

## Rate limit: cada rota de credencial tem o seu balde

A chave do `authLimiter` é `` `${req.ip}:${username}` ``, e ela só significa alguma coisa nas duas rotas cujo schema declara `username`: `/login` e `/register`. As outras três (`/refresh`, `/verify-email`, `/resend-verification`) têm limitador próprio por endereço (`credentialIpLimiter`, `backend/src/middleware/rate-limit.js`), e o de `/refresh` só contabiliza falha.

**`/register` tem DOIS**, e a contagem importa: ali o `username` é escolhido por quem chama e ainda não existe, então cada tentativa com um nome novo compra um balde novo e o `authLimiter` não limita nada que valha. Quem limita é `registerLimiter`, por endereço, montado **antes** dele, com janela e teto próprios (`RATE_LIMIT_REGISTER_*`). O `authLimiter` fica porque ainda estrangula a repetição contra um nome específico. Ver [[hardening-borda-api]].

Trate `429` como backoff puro, **nunca** como gatilho de logout ou de novo refresh, e note por que isso é mais que etiqueta: o cliente converte **qualquer** erro de refresh em logout definitivo, então um 429 mal tratado vira sessão perdida. Mais em [[hardening-borda-api]] e [[refresh-token-rotacao]].

## Contratos congelados e decisões deliberadas

- **Aliases `org` e `login` no payload** existem só para o módulo 360 consumir o token de emissor único sem alteração (`issueAccessToken`, `backend/src/modules/auth/auth.service.js`). São contrato congelado ([[sintese-contratos-congelados]]).
- **Allowlist `['HS256']`** aplicada nos três pontos de verificação: REST estrito, auth flexível e handshake do WebSocket (`config.jwt.algorithms`, `backend/src/config.js`). Token com `alg: none` ou assimétrico é rejeitado. Adicionar um algoritmo aqui vale para os três.
- **`posto_graduacao` e `organizacao_militar` são derivados por `LEFT JOIN`**, não colunas. O claim JWT chama-se `posto`, a resposta REST chama-se `posto_graduacao`: nomes **diferentes** para o mesmo dado. O frontend monta a identidade a partir do objeto `user` da resposta, não das claims (`frontend/src/js/store/sync/session-context.js`); não há decode de JWT no cliente.
- **Texto livre legado e FK coexistem** durante a transição: a leitura devolve strings (`organizacao_militar`), mas os corpos de escrita exigem UUID (`organization_id`). Ler um, escrever o outro é o padrão ([[gestao-usuarios]]).
- **Tokens persistem os dois em `localStorage`** sob a chave `ebgeo_auth`, degradando para memória só quando `localStorage` não existe. É deliberado (a sessão precisa sobreviver ao F5), mas quem auditar segurança deve saber que o access token está no disco do navegador.
- O handler `auth-lost` é conectado **depois do boot**, de propósito: um token expirado na inicialização cai silenciosamente no caminho anônimo em vez de abrir modal de sessão perdida. Ver [[sessao-boot-e-ciclo-de-vida]].

## Não-oráculos: onde o silêncio é intencional

Vários caminhos parecem descuidados e são deliberados. Não os "conserte" adicionando mensagens específicas:

- bcrypt **sempre** executa no login, contra o hash real ou contra `DUMMY_HASH` (`backend/src/modules/auth/auth.service.js`), removendo o oráculo de timing;
- usuário inexistente e senha errada devolvem `401` com a **mesma** mensagem;
- `POST /auth/register` responde **201 com o mesmo corpo** (`{ success: true }`) tenha criado a conta ou encontrado username/e-mail já em uso (`register`, `backend/src/modules/auth/auth.service.js`). Três peças sustentam isso e caem juntas: o status, o corpo (a conta criada **não** é devolvida) e o **tempo** (o `bcrypt` de custo 12 roda antes de saber se será usado, como o `DUMMY_HASH` do login). Quem precisa saber que a conta já existe é avisado **por e-mail** (`sendAccountExistsEmail`), nunca pela resposta. Até 2026-07-25 a rota respondia `409` para conta existente, e o comentário do código afirmava a propriedade que o status desmentia; ver [[gestao-usuarios]];
- `resend-verification` sempre resolve com sucesso, exista o e-mail ou não;
- `POST /auth/register` só é **montada** quando `ALLOW_SELF_REGISTRATION` está ligada (`backend/src/modules/auth/auth.routes.js`); desligada, cai no `404` genérico, sem vazar que o endpoint existe. Não assuma que a rota existe.

Contas **sem** e-mail (criadas por admin, legadas, máquina) pulam a porta de confirmação inteira (`login`, `backend/src/modules/auth/auth.service.js`), porque o gate só dispara quando `email IS NOT NULL`.

## Registro e verificação: dois cuidados de concorrência

O envio do e-mail é **best-effort**: a linha do usuário já foi commitada, e uma falha de e-mail não pode gerar `500`, o que deixaria uma conta órfã, impossível de re-registrar e de logar (`register`, `backend/src/modules/auth/auth.service.js`). Em caso de falha a conta fica pendente e o usuário reenvia.

`verifyEmail` consome o token dentro de uma transação, com a exclusão mútua na **própria cláusula `WHERE consumed_at IS NULL`** (`backend/src/modules/auth/auth.service.js`). A sequência ler-checar-escrever anterior permitia duas requisições concorrentes consumirem o mesmo token. Token expirado lança **dentro** da transação de propósito, para que a transação reverta o claim e o token não seja queimado silenciosamente.

## O link de verificação: quem escolhe o host, e quem vê o token

O host do link sai de `APP_BASE_URL`, e o `Origin` da requisição só é aceito quando é **exatamente** o `CORS_ORIGIN` do deployment (`resolveVerificationBase`, `backend/src/utils/mailer.js`). A alternativa rejeitada era confiar no `origin` verbatim: ele vem de `req.headers.origin` (`backend/src/modules/auth/auth.controller.js`), e `POST /auth/resend-verification` é montada sem `auth` e aceita qualquer e-mail no corpo (`backend/src/modules/auth/auth.routes.js`). Um anônimo fazia o servidor enviar à vítima uma mensagem **genuína**, com o `MAIL_FROM` real e o token real não consumido, apontando para o host dele. Era o default de fábrica até 2026-07-19, porque `APP_BASE_URL` é opcional mesmo em produção, ao contrário de `CORS_ORIGIN`, que o `validateEnvVariables` exige lá (`backend/src/config.js`).

**A armadilha que ficou no lugar dessa:** quando nada é confiável a base resolve para `''` e o link vira `/?verify=<token>`, uma URL relativa dentro de um e-mail. A mensagem sai, `sent: true`, nada registra erro. E o fallback compara `${req.protocol}://${req.get('host')}` com o `CORS_ORIGIN`, então basta o `X-Forwarded-Proto` do nginx não chegar ao Express (`TRUST_PROXY_HOPS`) para todo link de ativação virar inútil em silêncio. **Defina `APP_BASE_URL` em produção**: ela não está em `backend/.env.example` e nada no boot a exige, ao contrário do `CORS_ORIGIN`. Ver [[deploy-backend]].

O token do link é **credencial de fator único**: `verifyEmail` o consome e marca a conta verificada sem pedir mais nada. Por isso o link só é escrito no log **fora** de produção (`exposeLink = !config.isProd`, `sendVerificationEmail` em `backend/src/utils/mailer.js`). Em dev sem SMTP aquela linha de log **é** o canal de entrega; em produção a mesma situação loga em nível `error`, sem o link, e não existe plano B pelo log: a ativação passa por um admin enviando `email_verified: true` ([[gestao-usuarios]]). Não conte com o `redactUrl` para isso: ele delimita um invariante mais estreito do que parece, cobrindo credencial que viaja na **URL da requisição** e nada do que vai em campo de log estruturado, e `verify` sequer está no `SENSITIVE_QUERY_KEYS` (`backend/src/utils/redact-url.js`). Ver [[api-keys]].

## Logout não faz o que o nome sugere

`POST /auth/logout` revoga **apenas aquele** refresh token e devolve `204`. Não encerra o socket de colaboração e não invalida o access token: fechar o socket e desmontar a presença é responsabilidade do cliente ([[presenca-colaborativa]]).

**O `204` é a resposta de todos os desfechos, inclusive os que não revogaram nada**, e isso é decisão, não descuido. Os três erros possíveis (token de outro usuário, token já revogado, token que nunca existiu) são exatamente os fatos que um atacante quer descobrir, e `/auth/logout` não tem limitador nem consome o token que recebe, então um `403`/`404` seria um oráculo ilimitado e não destrutivo de "este refresh token está vivo, e é meu?". A diferença existe no banco e é lá que os testes a afirmam (`backend/tests/integration/auth-logout-revocation.test.js`), nunca pelo status.

Duas condições que a query carrega e o nome não denuncia (`REVOKE_REFRESH_TOKEN`, `backend/src/modules/auth/auth.queries.js`): o dono sai do JWT verificado, **não** do corpo, porque até 2026-07-25 casava só pelo hash e conhecer o refresh token de alguém era credencial suficiente para derrubar a sessão dele; e a revogação é **idempotente**, porque re-carimbar `revoked_at` mantinha o token gasto para sempre dentro da janela de graça de 10s da rotação, onde replay é lido como duplicata e o alarme de reuso nunca dispara ([[refresh-token-rotacao]]). O segundo é o mais traiçoeiro: o alarme de roubo desarmado por um botão que a própria vítima aperta.

Revogação em massa dos refresh tokens acontece só em: detecção de reuso, troca da própria senha, reset por admin e desativação do usuário ([[gestao-usuarios]]).

Um socket já aberto **não** revalida o token depois do handshake: a sessão do socket vive até o disconnect, ou até `reconcileAuthorization` fechá-lo por conta inativa, org inativa ou permissão que deixou de resolver (`backend/src/modules/collab/collab.gateway.js`). O token em si nunca é reconferido. Ver [[canal-collab-websocket]]. O `clientId` da query é chave de presença e idempotência, jamais credencial ([[client-id-estavel]]).

## Armadilhas de status code

- `422 VALIDATION_ERROR`, não `401`: senha de **5 caracteres no login** (o mínimo de 6 do `loginSchema` vale para autenticar, não só para cadastrar) e `token` de verificação fora do formato UUID. Se a UI trata "erro no login" como "credenciais inválidas", a mensagem sai errada.
- `401`, `403` e `429` são coisas distintas: `401` aciona refresh (uma vez) e depois login; `403` de OM inativa **não** se resolve com refresh ([[organizacoes-om]]); `429` é só espera.
- Não use `GET /health` para decidir online/offline no boot; o boot é fail-fast em `GET /api/config` ([[config-runtime-urls-relativas]]).
- Login e logout **aparecem** na trilha desde 2026-08-17, e estão entre as poucas chamadas best-effort dela (`createAuditBestEffort`): uma falha de escrita da trilha não pode derrubar a entrada nem a saída de ninguém. Login **falho** continua fora, por impossibilidade estrutural (`audit_trail.actor_id` é NOT NULL e uma tentativa recusada não tem ator identificado). Ver [[auditoria]].
- **Nunca case por string de mensagem, use o `code` do envelope.** O idioma varia por camada e sem regra: o serviço de auth emite português (`Usuário ou senha inválidos`, `Conta desativada`, `Sessão inválida. Entre novamente.`), o middleware de JWT emite inglês (`Token expired`, `Account is inactive`). Uma UI que casa texto quebra ao atravessar essa fronteira.

Ver [[erros-api]] e [[sintese-contrato-erros-http]].
