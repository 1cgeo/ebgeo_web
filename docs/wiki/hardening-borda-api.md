# Hardening de Borda da API

As decisões e armadilhas da borda do backend: rate limiting por IP+username, login sem oráculo de enumeração, allowlist HS256, helmet/CSP/HSTS e boot fail-fast.

Nada aqui muda contratos de dados nem quebra o caminho anônimo. O que muda é a borda: status novos (`429`, `503`), mensagens deliberadamente pobres em informação, e um backend que se recusa a subir mal configurado. Os mecanismos se leem em `backend/src/middleware/rate-limit.js`, no bloco de middlewares globais de `backend/src/app.js` e em `validateEnvVariables` (`backend/src/config.js`); esta página só cobre o que esses arquivos não contam. Upload em [[upload-imagens-seguranca]], rotação de refresh em [[refresh-token-rotacao]], envelope de erro em [[erros-api]] e o quadro completo de status em [[sintese-contrato-erros-http]].

## Rate limiting: a chave composta e o que ela custa

`authLimiter` usa `${req.ip}:${username}` (`backend/src/middleware/rate-limit.js`), não só o IP. É uma escolha de disponibilidade sobre rigor: força-bruta contra uma conta é estrangulada sem que um IP barulhento (NAT de quartel, saída única de rede) trave o login de todo mundo. O preço vem nas armadilhas abaixo, e a lista não se anuncia fechada de propósito: já esteve, e já perdeu itens.

- **A chave só significa alguma coisa se `req.ip` for o cliente.** Quem faz isso é `app.set('trust proxy', config.trustProxy)` (`backend/src/app.js`); sem ele, atrás de nginx, `req.ip` é o proxy e todo limitador por endereço colapsa num balde global. O parâmetro é **número de hops** (`TRUST_PROXY_HOPS`, default 1) e errar para cima é a falha oposta e pior: confiar num hop que não existe torna o `X-Forwarded-For` controlado pelo cliente, que passa a forjar uma chave nova por requisição e escapa de todos os tetos. Um hop confiado tem que ser um hop presente, e isso é verificação de deploy (ver [[deploy-backend]]), não de código.
- **A metade de endereço da chave é normalizada, e a normalização só passou a importar depois do `trust proxy`.** `ipKeyGenerator(req.ip, 56)` colapsa o prefixo /56 de um cliente IPv6; sem isso o cliente caminha por endereços dentro da própria alocação e compra um balde novo por requisição, o que é força-bruta de graça. Enquanto todo request chaveava pelo proxy, esse defeito estava mascarado por um pior. A lição: quando um limitador é consertado numa ponta, reconfira a outra, porque a ponta quebrada pode ter estado escondendo a segunda.
- **Lição do `validate: false`:** ele já desligou **todas** as checagens internas do `express-rate-limit`, inclusive as duas cuja única função é gritar quando `req.ip` é o endereço do proxy, e mais uma que recusa exatamente um `keyGenerator` que usa `req.ip` cru sem o helper de IPv6. Ou seja, o detector do problema ficou calado enquanto o problema existia, em dois eixos ao mesmo tempo. Hoje só as barulhentas em teste são desligadas; não volte a silenciar o grupo inteiro para calar uma.
- **Um limitador por rota, não uma instância compartilhada.** `/auth/refresh`, `/auth/verify-email` e `/auth/resend-verification` não declaram `username`, então sob o `authLimiter` os três geravam a chave `"<ip>:"` e drenavam **um balde só**, com falha nos dois sentidos: sessão honesta negada (uma rajada de e-mail gastava a cota que `/refresh` precisa em regime permanente) e atacante escapando de graça, porque um `username` inventado no corpo comprava um balde novo por requisição (a chave lê `req.body` antes de o Joi remover campo desconhecido). Cada um tem hoje o seu, por endereço (`credentialIpLimiter`), e `/refresh` só contabiliza falha (`refreshLimiter`), porque o custo de um `429` ali é alto: até 2026-08-14 ele derrubava a sessão e apagava trabalho local não drenado, e o cliente agora contém o dano sem que a causa (chave por endereço numa rede atrás de NAT) tenha mudado de lado (ver [[refresh-token-rotacao]] e [[erros-api]]).
- **Em `/register` o `username` é escolhido pelo atacante, então a chave composta não estrangula nada, e por isso a rota carrega DOIS limitadores.** A frase "força-bruta contra uma conta é estrangulada" vale para `/login`, onde o alvo **é** o campo que compõe a chave. Em `/register` o alvo é o **e-mail**, que não entra na chave: cada tentativa com um `username` novo estreia um balde novo, e o `authLimiter` sozinho deixava passar criação de conta em massa e a amplificação de e-mail do ramo de colisão (`sendAccountExistsEmail` vai para um endereço escolhido pelo chamador). Quem estrangula isso é `registerLimiter`, por ENDEREÇO, montado **antes** do `authLimiter` e com janela e teto próprios (`RATE_LIMIT_REGISTER_*`, uma hora e 20, dimensionados para uma OM inteira atrás de um egress NAT), com store próprio como todo limitador deste arquivo. O `authLimiter` fica porque continua estrangulando a repetição contra um nome específico. O que **nenhum dos dois** protege é a outra metade, fechada em 2026-07-25 por desenho de resposta e não por teto (201 sempre, corpo idêntico, `bcrypt` nos dois ramos, aviso só por e-mail, ver [[gestao-usuarios]]): qualquer resposta que passe a variar com a existência da conta volta a ser enumerável, agora dentro do teto em vez de de graça. Vale para o e-mail de aviso também, que por isso tem texto único.
- **A chave depende do body já parseado.** O parser JSON é global e roda antes das rotas (`backend/src/app.js`). Montar qualquer rota de credencial antes dele faz `req.body` ser `undefined` e a chave cair, sem erro, no balde por IP.
- **O limitador vem antes do `validate()`** (`backend/src/modules/auth/auth.routes.js`, e igualmente em `backend/src/modules/nomes/nomes.routes.js`): body ou query malformados também consomem quota. É deliberado: uma varredura mandaria requisição malformada de graça se o teto só contasse o que passa na validação.

### As duas rotas anônimas, e por que os tetos delas são folgados

`GET /nomes/busca` e `GET /api/config` são as superfícies em que custo de CPU é gasto sem credencial nenhuma. Cada uma tem limitador **próprio** (`gazetteerLimiter`, `configLimiter`), e não reaproveita o do link público: dividir balde faria uma funcionalidade esgotar a cota da outra.

O teto do gazetteer é alto de propósito (300/min por endereço) e isso é o ponto: ele não protege contra uso intenso, protege contra **varredura sequencial do gazetteer**, que precisa de milhares. O dimensionamento assume o debounce de 300 ms do cliente e um escritório inteiro atrás de um egress compartilhado. Se o custo por requisição subir (o pré-filtro trigram e o `LIMIT 500` são o que o segura hoje, ver [[ranking-busca-toponimos]]), é o teto que precisa descer, não o contrário.

O teto do config (600/min) é o mais alto do projeto, e a assimetria é a lição: errar o teto para baixo numa rota comum degrada uma funcionalidade, aqui **apaga o produto**, porque o boot é fail-fast neste endpoint e não tem fallback. Três fatos dimensionam o número: o cliente legítimo chama isto **uma vez por boot**; em falha ele **retenta 3 vezes** (`frontend/src/js/index.js`), então o incidente que justificaria o limitador é o mesmo que triplica a demanda honesta; e uma OM inteira atrás de um egress NAT divide um endereço. O que de fato tirou a alavanca de DoS foi a memoização invalidada na escrita (ver [[config-dinamico]]), não este número: com ela uma rajada custa zero consultas em vez de oito por requisição. O limitador cobre o resíduo.

Em teste os limitadores são pulados por padrão (`skip`), porque o store em memória acumularia ao longo da suíte inteira (o app é importado uma vez). Exercitá-los exige `RATE_LIMIT_FORCE=1` **e** chave isolada.

No cliente: `429` não é `401`. Não dispare logout nem refresh, só backoff. O header `RateLimit-Reset` está disponível para countdown.

O handler do 429 escreve o envelope à mão e **não passa pelo `errorHandler` central**. Consequência dupla: não espere dele log enriquecido nem `details`, e se o formato do envelope mudar em `backend/src/middleware/error-handler.js` este ponto precisa ser atualizado manualmente, senão a borda passa a responder dois formatos.

## Login: o que é indistinguível por decisão

`DUMMY_HASH` (`backend/src/modules/auth/auth.service.js`) existe para que `bcrypt.compare` **sempre** rode. Sem isso, "usuário inexistente" responderia em microssegundos contra ~100 ms de 12 rounds, entregando um oráculo de enumeração de contas.

Usuário inexistente e senha errada lançam o mesmo erro com o mesmo texto. **Não tente distinguir os dois na UI**, o backend não fornece esse sinal de propósito. Os demais desfechos (conta desativada, e-mail não confirmado, organização inativa) **são** distinguíveis, e `EMAIL_NOT_VERIFIED` tem `code` próprio justamente para a UI oferecer "reenviar confirmação" (ver [[gestao-usuarios]] e [[organizacoes-om]]).

**Nunca faça match por string de mensagem, use o `code`.** As mensagens são em português e já mudaram pelo menos uma vez.

## JWT: a allowlist é por chamada, não global

`config.jwt.algorithms = ['HS256']` (`backend/src/config.js`) precisa ser passado explicitamente em cada `jwt.verify`, e hoje é, nos três verificadores que existem: `verifyAndMapUser` (`backend/src/middleware/auth.js`), o `mapPayload` de `backend/src/middleware/flexible-auth.js` (ver [[auth-flexivel]]) e o handshake de `backend/src/modules/collab/collab.gateway.js` (ver [[canal-collab-websocket]]).

Sem o parâmetro, `jsonwebtoken` aceita o `alg` declarado **no próprio token**: `alg: none` e confusão HS/RS. Como a defesa é opt-in por call site e não uma configuração global, **qualquer verificador novo que apareça no código é uma regressão silenciosa até repetir `{ algorithms: config.jwt.algorithms }`**. É o risco mais provável desta página. A emissão é pinada no mesmo par (`issueAccessToken`, `backend/src/modules/auth/auth.service.js`), e o emissor é único (ver [[jwt-emissor-unico]] e [[autenticacao-jwt]]).

## `validate()` prende o pacote ao Express 4

`backend/src/middleware/validate.js` reatribui a fonte já validada de volta ao request (`req[source] = value`), e uma das três fontes é `query`. Em Express 4 (a versão instalada, `^4.21.0`) isso funciona. Em Express 5 `req.query` vira getter sem setter no protótipo, e como o pacote é ESM (portanto strict mode) a atribuição lança `TypeError` em runtime, não no build.

O alcance não é marginal e é o que justifica o parágrafo: quebraria de uma vez **toda** rota que valida query, incluindo `GET /api/v1/audit`, `GET /api/v1/users`, `DELETE /users/:userId` e `GET /nomes/busca`, que é contrato congelado do frontend ([[gazetteer-nomes-geograficos]]). As 29 linhas do arquivo não dão nenhum sinal de acoplamento à versão do framework, e o sintoma apareceria como falha em massa sem relação aparente com um bump de dependência. A saída barata é mutar no lugar para a fonte `query` em vez de reatribuir, o que remove a armadilha e dispensa esta seção.

## helmet e CSP: entenda o escopo

O helmet é o primeiro middleware global (`backend/src/app.js`), e a ordem importa porque precisa envolver inclusive as respostas de erro.

Esta CSP protege as **respostas da API** (JSON), não a página do frontend, que tem servidor e CSP próprios. O ganho prático é `frame-ancestors 'none'` e o fato de uma resposta hostil nunca conseguir carregar script. Não a confunda com a política do app.

- **HSTS só em produção.** Ligá-lo em dev sobre `http://localhost` envenenaria o cache HSTS do navegador do desenvolvedor, com efeito persistente sobre todos os projetos locais.
- **`Cross-Origin-Resource-Policy: cross-origin`** não é frouxidão: sem ele os assets servidos pelo backend (imagens de atlas, tiles 3D, ver [[assets3d-distribuicao]]) quebram quando consumidos de outra origem.
- O default de CORS é `http://localhost:3000` (`CORS_ORIGIN`), a origem do Vite, e **não** `http://localhost:8080`, que era o default antigo e estava errado por liberar a origem do próprio backend, que nunca faz requisição cross-origin. Ainda assim é placeholder de dev, e por isso `CORS_ORIGIN` é obrigatório em produção no fail-fast. Ver [[deploy-backend]], que é dono do assunto.

## Health check: não é o boot do frontend

`GET /api/v1/health` (`backend/src/app.js`) é readiness de verdade, toca o banco. Serve para orquestração e monitoramento, e **cada chamada dispara uma query**, então polling agressivo é custo direto no Postgres.

O frontend não o chama em lugar nenhum, e não deveria: a decisão de boot é `GET /api/config`, com fail-fast (ver [[config-runtime-urls-relativas]] e [[config-dinamico]]). Não existe modo offline para o qual cair quando há backend configurado; a distinção local/remoto é outro eixo (ver [[dominio-local-vs-remoto]]).

## Boot fail-fast: por que acumular erros

`validateEnvVariables()` roda antes de `createServer` (`backend/src/index.js`) e acumula **todos** os erros que alcança, abortando com a lista completa em vez de parar no primeiro.

**Mas ele não alcança as duas mais importantes.** `DATABASE_URL` e `JWT_SECRET` usam o helper `required()`, que lança na **avaliação do módulo**. Como `index.js` importa `app.js`, que importa `config.js`, o throw acontece antes de a validação sequer rodar: faltando qualquer uma das duas, você recebe a mensagem de UMA variável em inglês, não a lista acumulada em português. O acumulador só governa de fato o que é `optional()`, `CORS_ORIGIN` entre eles, mais as regras condicionais de produção.

O alvo real são os `parseInt` que falham em silêncio, governados pela tabela `NUMERIC_ENV_RULES`. O comentário no código nomeia os casos observados, e vale repetir o pior: `MAX_BULK_UPLOAD_MB=abc` produz `express.json({ limit: 'NaNmb' })`, que é **nenhum limite de body**. Um typo desliga uma defesa em vez de derrubar o servidor. Mesma família em `JWT_REFRESH_EXPIRY`: a gramática aceita só `[smhd]`, e `1w` (natural, plausível) vira duração 0, ou seja, todo refresh token nasce expirado e ninguém consegue permanecer logado.

A tabela é uma lista fechada, com o custo previsível: knob numérico novo que não ganhe entrada nela volta a ter a armadilha do NaN silencioso inteira. Já aconteceu com três, `TRUST_PROXY_HOPS` e os dois do limitador do gazetteer, hoje corrigidos e dentro da tabela. Vale reter o caso do `TRUST_PROXY_HOPS`, porque ele é o pior da família e o comentário da própria linha o explica: um `trust proxy` numérico é comparado como `i < val`, e `i < NaN` é sempre falso, então a app deixa de confiar em hop nenhum, `req.ip` vira o endereço do proxy em toda requisição e todo limitador chaveado por IP colapsa num balde global. Quem acrescentar variável numérica acrescenta a linha, e `backend/tests/unit/config-env-rules.test.js` é o guarda.

Detalhe sutil e deliberado: `isProd` dentro de `validateEnvVariables` é lido de `process.env.NODE_ENV` **no momento da chamada**, não da constante de import time usada pelo resto do `config`. É o que permite a testes e overrides de boot exercitar o ramo de produção de forma determinística, mas significa que os dois podem divergir se alguém mexer em `NODE_ENV` depois do import.

Ver [[deploy-backend]] para o conjunto completo de variáveis.

## Self-registration: 404 é a resposta certa

`POST /auth/register` só é **montada** se `config.security.allowSelfRegistration` (`backend/src/modules/auth/auth.routes.js`). Como a rota não existe (em vez de existir e bloquear), a chamada cai no 404 genérico. **Isso é intencional: `403` confirmaria a existência do endpoint.**

Duas consequências:

- O frontend não pode assumir que o cadastro existe. Derive de `features.self_registration` em `GET /api/config`, ou trate `404` escondendo a tela.
- A decisão é tomada no **import** do router, a partir de um `config` congelado (`resolveAllowSelfRegistration`, `backend/src/config.js`). Mudar `ALLOW_SELF_REGISTRATION` exige restart; não há como alternar em runtime.

`/auth/verify-email` e `/auth/resend-verification` continuam sempre montadas, porque contas com e-mail podem existir mesmo com auto-cadastro desligado (criadas por admin, ver [[gestao-usuarios]]).

**Ligar o auto-cadastro em produção passou a exigir canal de entrega.** `email` é obrigatório em `registerSchema`, logo a conta nasce pendente e o link `?verify=` é a única entrada; sem relay o mailer degrada para `logger.error` e a porta cria contas que ninguém ativa, calada. Por isso `validateEnvVariables` acumula dois erros quando `NODE_ENV=production` **e** o auto-cadastro está ligado: falta de `SMTP_HOST` e falta de `APP_BASE_URL` (sem ela o link sai relativo). A exigência é condicional à flag, senão toda instalação fechada que nunca precisou de relay pararia de bootar. Ver [[deploy-backend]].

## Relacionados

[[erros-api]], [[sintese-contrato-erros-http]], [[autenticacao-jwt]], [[jwt-emissor-unico]], [[refresh-token-rotacao]], [[auth-flexivel]], [[api-keys]], [[upload-imagens-seguranca]], [[permissoes-atlas]], [[link-publico]], [[deploy-backend]], [[auditoria]], [[sintese-eixos-de-permissao]]
