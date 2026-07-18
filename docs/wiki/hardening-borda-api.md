# Hardening de Borda da API

As decisões e armadilhas da borda do backend: rate limiting por IP+username, login sem oráculo de enumeração, allowlist HS256, helmet/CSP/HSTS e boot fail-fast.

Nada aqui muda contratos de dados nem quebra o caminho anônimo. O que muda é a borda: status novos (`429`, `503`), mensagens deliberadamente pobres em informação, e um backend que se recusa a subir mal configurado. Os mecanismos se leem em `backend/src/middleware/rate-limit.js`, `backend/src/app.js:37-49` e `backend/src/config.js:184-261`; esta página só cobre o que esses arquivos não contam. Upload em [[upload-imagens-seguranca]], rotação de refresh em [[refresh-token-rotacao]], envelope de erro em [[erros-api]] e o quadro completo de status em [[sintese-contrato-erros-http]].

## Rate limiting: a chave composta e o que ela custa

`authLimiter` usa `${req.ip}:${username}` (`backend/src/middleware/rate-limit.js:32`), não só o IP. É uma escolha de disponibilidade sobre rigor: força-bruta contra uma conta é estrangulada sem que um IP barulhento (NAT de quartel, saída única de rede) trave o login de todo mundo. O preço vem em quatro armadilhas.

- **Não existe `app.set('trust proxy', ...)` em `src/`.** Atrás de nginx, `req.ip` vira o IP do proxy e a chave composta degenera para "um balde por username, global". Pior: `validate: false` (`backend/src/middleware/rate-limit.js:30`) desliga as validações internas do `express-rate-limit`, **inclusive o aviso de trust proxy mal configurado**. Os dois arquivos juntos produzem um DoS acidental silencioso contra os próprios usuários. Nenhum dos dois, lido isolado, denuncia o problema.
- **Rotas sem `username` no body compartilham o balde `"<ip>:"`.** `/auth/refresh`, `/auth/verify-email` e `/auth/resend-verification` (`backend/src/modules/auth/auth.routes.js:18-21`) não carregam `username`, então as três somadas têm 10 requisições por 15 minutos por IP. Com rotação de refresh e várias abas abertas isso é atingível, e é o motivo real de serializar refresh numa fila única no cliente (ver [[refresh-token-rotacao]]).
- **A chave depende do body já parseado.** O parser JSON é global e roda antes das rotas (`backend/src/app.js:61-66`). Montar qualquer rota de credencial antes dele faz `req.body` ser `undefined` e a chave cair, sem erro, no balde por IP.
- **O limitador vem antes do `validate()`** (`backend/src/modules/auth/auth.routes.js:20`): body malformado também consome quota.

Em teste o limitador é pulado por padrão (`backend/src/middleware/rate-limit.js:18`), porque o store em memória acumularia ao longo da suíte inteira (o app é importado uma vez). Exercitá-lo exige `RATE_LIMIT_FORCE=1` **e** chave isolada.

No cliente: `429` não é `401`. Não dispare logout nem refresh, só backoff. O header `RateLimit-Reset` está disponível para countdown.

O handler do 429 escreve o envelope à mão (`backend/src/middleware/rate-limit.js:5-12`) e **não passa pelo `errorHandler` central**. Consequência dupla: não espere dele log enriquecido nem `details`, e se o formato do envelope mudar em `backend/src/middleware/error-handler.js` este ponto precisa ser atualizado manualmente, senão a borda passa a responder dois formatos.

## Login: o que é indistinguível por decisão

`DUMMY_HASH` (`backend/src/modules/auth/auth.service.js:19`) existe para que `bcrypt.compare` **sempre** rode (`backend/src/modules/auth/auth.service.js:73-74`). Sem isso, "usuário inexistente" responderia em microssegundos contra ~100 ms de 12 rounds, entregando um oráculo de enumeração de contas.

Usuário inexistente e senha errada lançam o mesmo erro com o mesmo texto (`backend/src/modules/auth/auth.service.js:78`). **Não tente distinguir os dois na UI**, o backend não fornece esse sinal de propósito. Os demais desfechos (conta desativada, e-mail não confirmado, organização inativa) **são** distinguíveis, e `EMAIL_NOT_VERIFIED` tem `code` próprio justamente para a UI oferecer "reenviar confirmação" (ver [[gestao-usuarios]] e [[organizacoes-om]]).

**Nunca faça match por string de mensagem, use o `code`.** As mensagens são em português e já mudaram uma vez: o guia absorvido *11-seguranca-hardening* ainda documenta `Invalid credentials` / `Account is deactivated` / `Invalid refresh token`, enquanto o código emite `Usuário ou senha inválidos` (`backend/src/modules/auth/auth.service.js:78`) e `Sessão inválida. Entre novamente.` (`backend/src/modules/auth/auth.service.js:135`).

## JWT: a allowlist é por chamada, não global

`config.jwt.algorithms = ['HS256']` (`config.js:45`) precisa ser passado explicitamente em cada `jwt.verify`, e hoje é, nos três verificadores que existem: `middleware/auth.js:30`, `middleware/flexible-auth.js:61` (ver [[auth-flexivel]]) e `modules/collab/collab.gateway.js:241` (ver [[canal-collab-websocket]]).

Sem o parâmetro, `jsonwebtoken` aceita o `alg` declarado **no próprio token**: `alg: none` e confusão HS/RS. Como a defesa é opt-in por call site e não uma configuração global, **qualquer verificador novo que apareça no código é uma regressão silenciosa até repetir `{ algorithms: config.jwt.algorithms }`**. É o risco mais provável desta página. A emissão é pinada no mesmo par (`backend/src/modules/auth/auth.service.js:40`), e o emissor é único (ver [[jwt-emissor-unico]] e [[autenticacao-jwt]]).

## helmet e CSP: entenda o escopo

O helmet é o primeiro middleware global (`backend/src/app.js:37`), e a ordem importa porque precisa envolver inclusive as respostas de erro.

Esta CSP protege as **respostas da API** (JSON), não a página do frontend, que tem servidor e CSP próprios. O ganho prático é `frame-ancestors 'none'` e o fato de uma resposta hostil nunca conseguir carregar script. Não a confunda com a política do app.

- **HSTS só em produção** (`backend/src/app.js:46`). Ligá-lo em dev sobre `http://localhost` envenenaria o cache HSTS do navegador do desenvolvedor, com efeito persistente sobre todos os projetos locais.
- **`Cross-Origin-Resource-Policy: cross-origin`** (`backend/src/app.js:47`) não é frouxidão: sem ele os assets servidos pelo backend (imagens de atlas, tiles 3D, ver [[assets3d-distribuicao]]) quebram quando consumidos de outra origem.
- O default de CORS é `http://localhost:8080` (`config.js:49`), placeholder de dev, e por isso `CORS_ORIGIN` é obrigatório em produção no fail-fast.

## Health check: não é o boot do frontend

`GET /api/v1/health` (`backend/src/app.js:78-87`) é readiness de verdade, toca o banco. Serve para orquestração e monitoramento, e **cada chamada dispara uma query**, então polling agressivo é custo direto no Postgres.

O frontend não o chama em lugar nenhum, e não deveria: a decisão de boot é `GET /api/config`, com fail-fast (ver [[config-runtime-urls-relativas]] e [[config-dinamico]]). Não existe modo offline para o qual cair quando há backend configurado; a distinção local/remoto é outro eixo (ver [[dominio-local-vs-remoto]]).

## Boot fail-fast: por que acumular erros

`validateEnvVariables()` roda antes de `createServer` (`index.js:11`). Acumula **todos** os erros e aborta com a lista completa em vez de parar no primeiro (`config.js:258-260`): um deploy mal configurado custa um ciclo de correção, não cinco.

O alvo real são os `parseInt` que falham em silêncio (`config.js:220-242`). O comentário no código nomeia os casos observados, e vale repetir o pior: `MAX_BULK_UPLOAD_MB=abc` produz `express.json({ limit: 'NaNmb' })`, que é **nenhum limite de body**. Um typo desliga uma defesa em vez de derrubar o servidor. Mesma família em `JWT_REFRESH_EXPIRY`: a gramática aceita só `[smhd]`, e `1w` (natural, plausível) vira `parseDuration` = 0, ou seja, todo refresh token nasce expirado e ninguém consegue permanecer logado (`config.js:244-256`).

Detalhe sutil e deliberado: `isProd` aqui é lido de `process.env.NODE_ENV` **no momento da chamada** (`config.js:188`), não da constante de import time usada pelo resto do `config` (`config.js:13`). É o que permite a testes e overrides de boot exercitar o ramo de produção de forma determinística, mas significa que os dois podem divergir se alguém mexer em `NODE_ENV` depois do import.

Ver [[deploy-backend]] para o conjunto completo de variáveis.

## Self-registration: 404 é a resposta certa

`POST /auth/register` só é **montada** se `config.security.allowSelfRegistration` (`backend/src/modules/auth/auth.routes.js:14-16`). Como a rota não existe (em vez de existir e bloquear), a chamada cai no 404 genérico (`backend/src/app.js:122-124`). **Isso é intencional: `403` confirmaria a existência do endpoint.**

Duas consequências:

- O frontend não pode assumir que o cadastro existe. Derive da configuração de deploy, ou trate `404` escondendo a tela.
- A decisão é tomada no **import** de `backend/src/modules/auth/auth.routes.js`, a partir de um `config` congelado (`config.js:102`). Mudar `ALLOW_SELF_REGISTRATION` exige restart; não há como alternar em runtime.

`/auth/verify-email` e `/auth/resend-verification` continuam sempre montadas, porque contas com e-mail podem existir mesmo com auto-cadastro desligado (criadas por admin, ver [[gestao-usuarios]]).

## Relacionados

[[erros-api]], [[sintese-contrato-erros-http]], [[autenticacao-jwt]], [[jwt-emissor-unico]], [[refresh-token-rotacao]], [[auth-flexivel]], [[api-keys]], [[upload-imagens-seguranca]], [[permissoes-atlas]], [[link-publico]], [[deploy-backend]], [[auditoria]], [[sintese-eixos-de-permissao]]

## Fontes

- guia *11-seguranca-hardening* (absorvido): estrutura dos mecanismos de borda; mensagens em inglês já superadas pelo código.
- `ebgeo_backend`: `backend/src/middleware/rate-limit.js`, `backend/src/config.js`, `backend/src/app.js`, `backend/src/index.js`, `src/modules/auth/{auth.service.js,auth.routes.js}`, `src/middleware/{auth.js,flexible-auth.js,error-handler.js}`, `backend/src/modules/collab/collab.gateway.js`.
