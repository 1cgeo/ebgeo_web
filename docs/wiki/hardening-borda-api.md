# Hardening de Borda da API

As decisões e armadilhas da borda do backend: rate limiting por IP+username, login sem oráculo de enumeração, allowlist HS256, helmet/CSP/HSTS e boot fail-fast.

Nada aqui muda contratos de dados nem quebra o caminho anônimo. O que muda é a borda: status novos (`429`, `503`), mensagens deliberadamente pobres em informação, e um backend que se recusa a subir mal configurado. Os mecanismos se leem em `backend/src/middleware/rate-limit.js`, no bloco de middlewares globais de `backend/src/app.js` e em `validateEnvVariables` (`backend/src/config.js`); esta página só cobre o que esses arquivos não contam. Upload em [[upload-imagens-seguranca]], rotação de refresh em [[refresh-token-rotacao]], envelope de erro em [[erros-api]] e o quadro completo de status em [[sintese-contrato-erros-http]].

## Rate limiting: a chave composta e o que ela custa

`authLimiter` usa `${req.ip}:${username}` (`backend/src/middleware/rate-limit.js`), não só o IP. É uma escolha de disponibilidade sobre rigor: força-bruta contra uma conta é estrangulada sem que um IP barulhento (NAT de quartel, saída única de rede) trave o login de todo mundo. O preço vem nas armadilhas abaixo, e a lista não se anuncia fechada de propósito: já esteve, e já perdeu itens.

- **A chave só significa alguma coisa se `req.ip` for o cliente.** Quem faz isso é `app.set('trust proxy', config.trustProxy)` (`backend/src/app.js`); sem ele, atrás de nginx, `req.ip` é o proxy e todo limitador por endereço colapsa num balde global. O parâmetro é **número de hops** (`TRUST_PROXY_HOPS`, default 1, `backend/src/config.js`) e errar para cima é a falha oposta e pior: confiar num hop que não existe torna o `X-Forwarded-For` controlado pelo cliente, que passa a forjar uma chave nova por requisição e escapa de todos os tetos. Um hop confiado tem que ser um hop presente, e isso é verificação de deploy (ver [[deploy-backend]]), não de código.
- **A metade de endereço da chave é normalizada, e a normalização só passou a importar depois do `trust proxy`.** `ipKeyGenerator(req.ip, 56)` colapsa o prefixo /56 de um cliente IPv6; sem isso o cliente caminha por endereços dentro da própria alocação e compra um balde novo por requisição, o que é força-bruta de graça. Enquanto todo request chaveava pelo proxy, esse defeito estava mascarado por um pior. A lição: quando um limitador é consertado numa ponta, reconfira a outra, porque a ponta quebrada pode ter estado escondendo a segunda.
- **Lição do `validate: false`:** ele já desligou **todas** as checagens internas do `express-rate-limit`, inclusive as duas cuja única função é gritar quando `req.ip` é o endereço do proxy, e mais uma que recusa exatamente um `keyGenerator` que usa `req.ip` cru sem o helper de IPv6. Ou seja, o detector do problema ficou calado enquanto o problema existia, em dois eixos ao mesmo tempo. Hoje só as barulhentas em teste são desligadas (`backend/src/middleware/rate-limit.js`); não volte a silenciar o grupo inteiro para calar uma.
- **Um limitador por rota, não uma instância compartilhada.** `/auth/refresh`, `/auth/verify-email` e `/auth/resend-verification` não declaram `username`, então sob o `authLimiter` os três geravam a chave `"<ip>:"` e drenavam **um balde só**, com falha nos dois sentidos: sessão honesta negada (uma rajada de e-mail gastava a cota que `/refresh` precisa em regime permanente) e atacante escapando de graça, porque um `username` inventado no corpo comprava um balde novo por requisição (a chave lê `req.body` antes de o Joi remover campo desconhecido). Cada um tem hoje o seu, por endereço (`credentialIpLimiter`, `backend/src/middleware/rate-limit.js`), e `/refresh` só contabiliza falha, porque o custo de um `429` ali é alto: até 2026-08-14 ele derrubava a sessão e apagava trabalho local não drenado, e o cliente agora contém o dano sem que a causa (chave por endereço numa rede atrás de NAT) tenha mudado de lado (ver [[refresh-token-rotacao]]).
- **Em `/register` o `username` é escolhido pelo atacante, então a chave composta não estrangula nada.** A frase "força-bruta contra uma conta é estrangulada" vale para `/login`, onde o alvo **é** o campo que compõe a chave. Em `/register` o alvo é o **e-mail**, que não entra na chave: cada tentativa com um `username` novo estreia um balde novo. Isso já foi metade de um oráculo de e-mail sem estrangulamento: a rota respondia `409` para e-mail cadastrado e `201` caso contrário. A outra metade foi fechada em 2026-07-25 (201 sempre, corpo idêntico, `bcrypt` nos dois ramos, aviso só por e-mail, ver [[gestao-usuarios]]), mas **este balde continua não estrangulando nada**, e é dele que dependem as defesas que sobraram: qualquer resposta que passe a variar com a existência da conta volta a ser enumerável de graça. Vale para o e-mail de aviso também, que por isso tem texto único.
- **A chave depende do body já parseado.** O parser JSON é global e roda antes das rotas (`backend/src/app.js`). Montar qualquer rota de credencial antes dele faz `req.body` ser `undefined` e a chave cair, sem erro, no balde por IP.
- **O limitador vem antes do `validate()`** (`backend/src/modules/auth/auth.routes.js`): body malformado também consome quota. É deliberado nas duas famílias: uma varredura mandaria requisição malformada de graça se o teto só contasse o que passa na validação.

### A rota anônima também tem balde, e por que ele é folgado

`GET /nomes/busca` é a única rota anônima por decisão de produto (é a busca do caminho sem login, ver [[gazetteer-nomes-geograficos]]), o que a torna a única superfície do backend em que custo de CPU é gasto sem credencial nenhuma. Por isso ela tem limitador **próprio**, `gazetteerLimiter`, e não reaproveita o do link público (`backend/src/middleware/rate-limit.js`): dividir balde faria uma funcionalidade esgotar a cota da outra.

O teto é alto de propósito (300/min por endereço, `RATE_LIMIT_GAZETTEER_MAX` em `backend/src/config.js`) e isso é o ponto: ele não protege contra uso intenso, protege contra **varredura sequencial do gazetteer**, que precisa de milhares. O dimensionamento assume o debounce de 300 ms do cliente e um escritório inteiro atrás de um egress compartilhado. Se o custo por requisição subir (o pré-filtro trigram e o `LIMIT 500` são o que o segura hoje, ver [[ranking-busca-toponimos]]), é o teto que precisa descer, não o contrário.

Em teste o limitador é pulado por padrão (`skip`, `backend/src/middleware/rate-limit.js`), porque o store em memória acumularia ao longo da suíte inteira (o app é importado uma vez). Exercitá-lo exige `RATE_LIMIT_FORCE=1` **e** chave isolada.

### `GET /api/config`: o teto mais folgado do projeto, e por quê

A frase acima ("a única superfície em que custo de CPU é gasto sem credencial") descrevia a busca como caso único e nunca foi bem isso: `GET /api/config` também é anônima, e era a mais cara do conjunto — oito consultas por requisição, sem cache e sem teto. Desde 2026-07-25 ela tem os dois: memoização invalidada na escrita (ver [[config-dinamico]]) e o `configLimiter`, com store próprio, junto dos outros quatro em `backend/src/middleware/rate-limit.js`.

O teto (600/min por endereço, `RATE_LIMIT_CONFIG_MAX`) é o mais alto do projeto **de propósito**, e a assimetria com o gazetteer é a lição: errar o teto para baixo numa rota comum degrada uma funcionalidade, aqui **apaga o produto**, porque o boot é fail-fast neste endpoint e não tem fallback. Três fatos dimensionam o número: o cliente legítimo chama isto **uma vez por boot**; em falha ele **retenta 3 vezes** (`frontend/src/js/index.js`), então o incidente que justificaria o limitador é o mesmo que triplica a demanda honesta; e uma OM inteira atrás de um egress NAT divide um endereço. Medido no E2E de browser, a suíte inteira (85 specs, boots reais em série) fica na casa de algumas dezenas de requisições por minuto — duas ordens de grandeza abaixo do teto.

O que de fato tirou a alavanca de DoS foi a memoização, não este número: com ela uma rajada custa zero consultas em vez de oito por requisição. O limitador cobre o resíduo (banda, serialização) e a primeira requisição de cache frio.

O `configLimiter` está no módulo, e não junto dos outros quatro em `backend/src/middleware/rate-limit.js`, por uma razão temporária de coordenação de trabalho — o `handler`, o `skip` e o `validate` são **cópias**, não variantes. Se você mexer no envelope do 429 ou na convenção de `skip`, mexa nos dois lugares até que a mudança seja desfeita.

No cliente: `429` não é `401`. Não dispare logout nem refresh, só backoff. O header `RateLimit-Reset` está disponível para countdown.

O handler do 429 escreve o envelope à mão (`handler`, `backend/src/middleware/rate-limit.js`) e **não passa pelo `errorHandler` central**. Consequência dupla: não espere dele log enriquecido nem `details`, e se o formato do envelope mudar em `backend/src/middleware/error-handler.js` este ponto precisa ser atualizado manualmente, senão a borda passa a responder dois formatos.

## Login: o que é indistinguível por decisão

`DUMMY_HASH` (`backend/src/modules/auth/auth.service.js`) existe para que `bcrypt.compare` **sempre** rode. Sem isso, "usuário inexistente" responderia em microssegundos contra ~100 ms de 12 rounds, entregando um oráculo de enumeração de contas.

Usuário inexistente e senha errada lançam o mesmo erro com o mesmo texto. **Não tente distinguir os dois na UI**, o backend não fornece esse sinal de propósito. Os demais desfechos (conta desativada, e-mail não confirmado, organização inativa) **são** distinguíveis, e `EMAIL_NOT_VERIFIED` tem `code` próprio justamente para a UI oferecer "reenviar confirmação" (ver [[gestao-usuarios]] e [[organizacoes-om]]).

**Nunca faça match por string de mensagem, use o `code`.** As mensagens são em português e já mudaram uma vez: o guia absorvido *11-seguranca-hardening* ainda documenta `Invalid credentials` / `Account is deactivated` / `Invalid refresh token`, enquanto o código emite `Usuário ou senha inválidos` e `Sessão inválida. Entre novamente.` (`backend/src/modules/auth/auth.service.js`).

## JWT: a allowlist é por chamada, não global

`config.jwt.algorithms = ['HS256']` (`backend/src/config.js`) precisa ser passado explicitamente em cada `jwt.verify`, e hoje é, nos três verificadores que existem: `verifyAndMapUser` (`backend/src/middleware/auth.js`), o mapeamento de payload de `backend/src/middleware/flexible-auth.js` (ver [[auth-flexivel]]) e o handshake de `backend/src/modules/collab/collab.gateway.js` (ver [[canal-collab-websocket]]).

Sem o parâmetro, `jsonwebtoken` aceita o `alg` declarado **no próprio token**: `alg: none` e confusão HS/RS. Como a defesa é opt-in por call site e não uma configuração global, **qualquer verificador novo que apareça no código é uma regressão silenciosa até repetir `{ algorithms: config.jwt.algorithms }`**. É o risco mais provável desta página. A emissão é pinada no mesmo par (`issueAccessToken`, `backend/src/modules/auth/auth.service.js`), e o emissor é único (ver [[jwt-emissor-unico]] e [[autenticacao-jwt]]).

## `validate()` prende o pacote ao Express 4

`backend/src/middleware/validate.js` reatribui a fonte já validada de volta ao request (`req[source] = value`), e uma das três fontes é `query`. Em Express 4 (a versão instalada) isso funciona. Em Express 5 `req.query` vira getter sem setter no protótipo, e como o pacote é ESM (portanto strict mode) a atribuição lança `TypeError` em runtime, não no build.

O alcance não é marginal e é o que justifica o parágrafo: quebraria de uma vez **toda** rota que valida query, incluindo `GET /api/v1/audit`, `GET /api/v1/users`, `DELETE /users/:userId` e `GET /nomes/busca`, que é contrato congelado do frontend ([[gazetteer-nomes-geograficos]]). As 29 linhas do arquivo não dão nenhum sinal de acoplamento à versão do framework, e o sintoma apareceria como falha em massa sem relação aparente com um bump de dependência. A saída barata é mutar no lugar para a fonte `query` em vez de reatribuir, o que remove a armadilha e dispensa esta seção.

## helmet e CSP: entenda o escopo

O helmet é o primeiro middleware global (`backend/src/app.js`), e a ordem importa porque precisa envolver inclusive as respostas de erro.

Esta CSP protege as **respostas da API** (JSON), não a página do frontend, que tem servidor e CSP próprios. O ganho prático é `frame-ancestors 'none'` e o fato de uma resposta hostil nunca conseguir carregar script. Não a confunda com a política do app.

- **HSTS só em produção** (`backend/src/app.js`). Ligá-lo em dev sobre `http://localhost` envenenaria o cache HSTS do navegador do desenvolvedor, com efeito persistente sobre todos os projetos locais.
- **`Cross-Origin-Resource-Policy: cross-origin`** (`backend/src/app.js`) não é frouxidão: sem ele os assets servidos pelo backend (imagens de atlas, tiles 3D, ver [[assets3d-distribuicao]]) quebram quando consumidos de outra origem.
- O default de CORS é `http://localhost:3000` (`CORS_ORIGIN` em `backend/src/config.js`), a origem do Vite, e **não** `http://localhost:8080`, que era o default antigo e estava errado por liberar a origem do próprio backend, que nunca faz requisição cross-origin. Ainda assim é placeholder de dev, e por isso `CORS_ORIGIN` é obrigatório em produção no fail-fast. Ver [[deploy-backend]], que é dono do assunto.

## Health check: não é o boot do frontend

`GET /api/v1/health` (`backend/src/app.js`) é readiness de verdade, toca o banco. Serve para orquestração e monitoramento, e **cada chamada dispara uma query**, então polling agressivo é custo direto no Postgres.

O frontend não o chama em lugar nenhum, e não deveria: a decisão de boot é `GET /api/config`, com fail-fast (ver [[config-runtime-urls-relativas]] e [[config-dinamico]]). Não existe modo offline para o qual cair quando há backend configurado; a distinção local/remoto é outro eixo (ver [[dominio-local-vs-remoto]]).

## Boot fail-fast: por que acumular erros

`validateEnvVariables()` roda antes de `createServer` (`backend/src/index.js`) e acumula **todos** os erros que alcança, abortando com a lista completa em vez de parar no primeiro.

**Mas ele não alcança as duas mais importantes.** `DATABASE_URL` e `JWT_SECRET` usam o helper `required()`, que lança na **avaliação do módulo** (`Missing required env var: X`). Como `index.js` importa `app.js`, que importa `config.js`, o throw acontece antes de a validação sequer rodar: faltando qualquer uma das duas, você recebe a mensagem de UMA variável em inglês, não a lista acumulada em português. O acumulador só governa de fato o que é `optional()`, `CORS_ORIGIN` entre eles, mais as regras condicionais de produção, como o mínimo de 32 caracteres do segredo.

O alvo real são os `parseInt` que falham em silêncio, governados pela tabela `NUMERIC_ENV_RULES`. O comentário no código nomeia os casos observados, e vale repetir o pior: `MAX_BULK_UPLOAD_MB=abc` produz `express.json({ limit: 'NaNmb' })`, que é **nenhum limite de body**. Um typo desliga uma defesa em vez de derrubar o servidor. Mesma família em `JWT_REFRESH_EXPIRY`: a gramática aceita só `[smhd]`, e `1w` (natural, plausível) vira `parseDuration` = 0, ou seja, todo refresh token nasce expirado e ninguém consegue permanecer logado.

A tabela é uma lista fechada, com o custo previsível: knob numérico novo que não ganhe entrada nela volta a ter a armadilha do NaN silencioso inteira, e isso já aconteceu (`TRUST_PROXY_HOPS` e os dois knobs do limitador do gazetteer ficaram de fora). Quem acrescentar variável numérica acrescenta a linha, e `backend/tests/unit/config-env-rules.test.js` é o guarda.

Detalhe sutil e deliberado: `isProd` dentro de `validateEnvVariables` é lido de `process.env.NODE_ENV` **no momento da chamada**, não da constante de import time usada pelo resto do `config`. É o que permite a testes e overrides de boot exercitar o ramo de produção de forma determinística, mas significa que os dois podem divergir se alguém mexer em `NODE_ENV` depois do import.

Ver [[deploy-backend]] para o conjunto completo de variáveis.

## Self-registration: 404 é a resposta certa

`POST /auth/register` só é **montada** se `config.security.allowSelfRegistration` (`backend/src/modules/auth/auth.routes.js`). Como a rota não existe (em vez de existir e bloquear), a chamada cai no 404 genérico (`backend/src/app.js`). **Isso é intencional: `403` confirmaria a existência do endpoint.**

Duas consequências:

- O frontend não pode assumir que o cadastro existe. Derive da configuração de deploy, ou trate `404` escondendo a tela.
- A decisão é tomada no **import** de `backend/src/modules/auth/auth.routes.js`, a partir de um `config` congelado (`resolveAllowSelfRegistration`, `backend/src/config.js`). Mudar `ALLOW_SELF_REGISTRATION` exige restart; não há como alternar em runtime.

`/auth/verify-email` e `/auth/resend-verification` continuam sempre montadas, porque contas com e-mail podem existir mesmo com auto-cadastro desligado (criadas por admin, ver [[gestao-usuarios]]).

## Relacionados

[[erros-api]], [[sintese-contrato-erros-http]], [[autenticacao-jwt]], [[jwt-emissor-unico]], [[refresh-token-rotacao]], [[auth-flexivel]], [[api-keys]], [[upload-imagens-seguranca]], [[permissoes-atlas]], [[link-publico]], [[deploy-backend]], [[auditoria]], [[sintese-eixos-de-permissao]]

## Fontes

- guia *11-seguranca-hardening* (absorvido): estrutura dos mecanismos de borda; mensagens em inglês já superadas pelo código.
- `ebgeo_backend`: `backend/src/middleware/rate-limit.js`, `backend/src/modules/config/config.cache.js`, `backend/src/config.js`, `backend/src/app.js`, `backend/src/index.js`, `src/modules/auth/{auth.service.js,auth.routes.js}`, `src/middleware/{auth.js,flexible-auth.js,error-handler.js}`, `backend/src/modules/collab/collab.gateway.js`.
