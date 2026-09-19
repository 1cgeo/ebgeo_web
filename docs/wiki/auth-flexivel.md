# Autenticação Flexível (flexibleAuth)

Middleware global que **identifica sem autorizar**: popula `req.user` quando há credencial, deixa a requisição seguir anônima quando não há, e nunca responde erro. Desde 2026-08-29 ele registra também **por onde** a credencial entrou, e essa marca é insumo de autorização lá adiante, no `auth` estrito.

## O contrato congelado: falhar é seguir

Qualquer falha (formato inválido, JWT expirado, assinatura errada, Postgres fora do ar) termina em `next()` sem `req.user`. O `catch` mudo que fecha `flexibleAuth` (`backend/src/middleware/flexible-auth.js`) não é preguiça: é o que impede que um banco indisponível derrube as rotas que não precisam de banco ([[gazetteer-nomes-geograficos]], catálogo público, `/api/config`, [[streetview-360]]). Trocar isso por um `next(err)` "para não engolir erro" quebra o modo anônimo inteiro.

Quem barra é a rota, via `auth`/`requireAdmin` (`backend/src/middleware/auth.js`), com os códigos de [[sintese-contrato-erros-http]] e [[erros-api]]. Ver [[autenticacao-jwt]] e [[sintese-eixos-de-permissao]].

## As três armadilhas de precedência

O código convida ao erro em `flexibleAuth` (`backend/src/middleware/flexible-auth.js`), e nenhuma destas está comentada lá:

- **Só a chave que RESOLVE encerra a decisão.** Até 2026-07-25 o `return next()` do ramo da chave estava *fora* do `if (rows[0])`, e a mera presença de `x-api-key`/`?api_key=` pulava cookie e Bearer: era uma demoção silenciosa de sessão válida disparável por quem conseguisse a vítima a abrir `...?api_key=qualquercoisa`, porque o gatilho mora na query string. Hoje toda chave que não resolve cai no ramo seguinte, e desde as amarras de 2026-08-24 são mais casos: malformada, ausente das duas moradas, vencida, revogada, de conta desativada, de OM desativada ou anterior a um corte de sessão ([[api-keys]]). A precedência que sobrou é estrita e continua valendo: chave **boa** ganha do Bearer bom.
- **Bearer explícito precede o cookie**, desde 2026-09-19. Antes, um cabeçalho de outra conta herdava a identidade do cookie, inclusive para escrever. Agora um Bearer inválido segue anônimo, sem herdar a conta ambiente; um Bearer válido funciona mesmo com cookie inválido. `req.authVia` identifica o transporte escolhido. Regressões em `backend/tests/integration/sharing-privacy-edge-cases.test.js` e `backend/tests/integration/flexible-auth-precedence.test.js`.
- **Chave malformada não toca o banco** (guarda `UUID_RE`). Anti-DoS de borda, ver [[hardening-borda-api]]. Consequência: mudar o formato da API key exige mudar essa regex, senão toda chave nova vira anônima antes de chegar ao Postgres.

`?api_key=` é transporte suportado, e é por isso (e só por isso) que `api_key` está no `SENSITIVE_QUERY_KEYS` de `backend/src/utils/redact-url.js`. Removeu o transporte, remova a entrada; removeu a entrada sem remover o transporte, vazou credencial permanente em texto puro no pino. O invariante para aí, e é mais estreito do que a frase sugere: ele cobre a URL da requisição, não campo de log estruturado (ver [[api-keys]]). O texto de SQL tem mecanismo PRÓPRIO desde 2026-08-31 (`elidirSql`), porque o pg-promise interpola os valores no texto antes de qualquer log, e nenhum dos dois alcança o campo do outro.

## O cookie de sessão: por que ele existe, e por que ele não escreve

**Ele existe porque há pedido que o navegador faz e que não aceita cabeçalho nenhum:** o tile do MapLibre, o `img.src` de uma cena 3D, o `<video src>` de uma prévia. Sem cookie, a única credencial que os alcança é a chave de API na URL, que é portadora, aparece no log de acesso do nginx e no `Referer` de tudo o que a página carregar depois. O cookie carrega o **MESMO** JWT do corpo da resposta: não há credencial nova, e o que muda é a porta por onde ela entra. Ver [[tile-privado]].

**Ele tem TRÊS emissores desde 2026-08-29, e antes tinha um só.** `porCookieDeSessao` (`backend/src/modules/auth/auth.controller.js`) o põe no login e no refresh, e a renovação deslizante continua repondo-o perto da expiração. Enquanto o terceiro era o único, o cookie parecia acidente de borda, e era justo por isso que ninguém precisava perguntar o que ele autoriza.

**Emitir o cookie no login abriria as rotas de escrita a CSRF, e a amarra que impede isso mora no `auth` estrito** (`backend/src/middleware/auth.js`), não aqui: o estrito **reusa** o `req.user` que este middleware populou, então um cookie permanente autorizaria escrita sem que nenhuma linha de código de rota mudasse. Cinco pontos que não se deduzem lendo o gate:

- **`sameSite` não substitui a amarra.** Em produção o cookie é `strict`, mas fora dela é `lax`, e `lax` deixa passar navegação de topo. Concretamente: cinco rotas de escrita aceitam `multipart/form-data`, que é Content-Type CORS-simples e portanto postável por formulário cross-site **sem preflight**. São exatamente as que uma defesa baseada só em preflight não alcança.
- **A prova que autoriza a escrita é a PRESENÇA do cabeçalho, não a ausência do cookie.** Um formulário de outro site não consegue pôr `Authorization` (isso exigiria preflight, que o CORS recusa), então um Bearer no pedido é prova de que ele saiu de código que TEM o token. Daí a condição olhar `req.temBearer`.
- **Teste as duas credenciais juntas.** O navegador pode carregar cookie e Bearer simultaneamente, inclusive de contas diferentes. A prioridade antiga do cookie escondia esse caso; desde 2026-09-19 o Bearer explícito decide a identidade. Testar cada credencial isoladamente não detecta uma troca silenciosa de conta.
- **A recusa vale só nos métodos que ESCREVEM, e a lista é de métodos SEGUROS** (GET/HEAD/OPTIONS), para que um verbo novo caia no ramo restritivo por construção. Ler por cookie continua valendo de propósito: uma leitura disparada de outro site até sai com o cookie, mas o CORS impede o atacante de ler a resposta. A primeira versão recusava toda rota estrita e deixou onze casos vermelhos, entre eles `GET /auth/me` por cookie, que funcionava desde antes.
- **401 e não 403**, ao contrário da recusa por escopo de chave: a credencial não é aceitável nesta rota em forma nenhuma, e o cliente precisa reapresentar o token no cabeçalho. Um 403 diria "você não pode" onde o certo é "assim não".

**Apagar o cookie exige os MESMOS atributos da emissão, menos `maxAge`** (`clearCookieOptions`, `backend/src/utils/environment.js`). O navegador casa o cookie a apagar por nome, domínio, caminho e as flags que os compõem: limpar com atributos diferentes não apaga nada, ele guarda dois cookies e expira o que não estava em uso, e o sintoma é uma sessão que sobrevive ao logout sem que nada acuse. São dois os pontos de limpeza, o logout ([[autenticacao-jwt]]) e o ramo de sessão morta aqui.

## A OM de lotação viaja DENTRO da consulta da chave

`FIND_USER_BY_API_KEY` (`backend/src/modules/users/users.queries.js`) carrega o termo de organização no próprio SQL, e não há checagem dela no middleware **de propósito**: o `JOIN` com `organizations` já existia na consulta, então o termo é de graça, e um chamador novo daquela consulta herda a regra sem ter de lembrar dela. É a mesma direção de falha do predicado de recurso privado, que vive em função SQL pelo mesmo motivo.

> Até 2026-08-29 esta página afirmava o contrário, que a consulta exigia só `u.is_active` e nada sobre a organização, e descrevia como buraco vivo o portador de chave de OM desativada que autenticava em rota só-flexível. Aquilo deixou de valer em 2026-08-24, e a assimetria sobreviveu tanto tempo porque o caminho onde ela era visível (rota só-flexível) não é o caminho onde a suíte olhava (rota estrita, onde a reconciliação viva já respondia 403). Ver [[api-keys]], [[gestao-usuarios]] e [[organizacoes-om]].

## Sliding session: o incidente e o que ficou de fora

O porquê da revalidação viva antes de reassinar está documentado no próprio código (`backend/src/middleware/flexible-auth.js` e o bloco `LIVE_AUTH_STATE` de `backend/src/utils/org-status.js`): reassinar claims antigos transformava a janela de "no máximo 15 min desatualizado" em "para sempre". Leia lá, não aqui.

O que o código **não** diz:

- **Dois claims são adotados do banco sem condição:** o `role` global e o escopo de produção `producer_org_id`, que autoriza escrita de catálogo e de acervo 360 ([[acesso-a-recurso-privado]]). `organization_id` só é reconciliado **quando o token já o carrega**, para preservar o degrade de tokens legados; adotá-lo do banco sempre faria token pré-claim-de-organização ganhar uma lotação que ele nunca teve. A condição citava também `org_role` até 2026-08-20, e a poda daquele disjunto foi obrigatória junto com a remoção do eixo: enquanto ele estivesse lá, um legado que trouxesse SÓ a claim morta entraria no ramo e promoveria a lotação. Ver [[jwt-emissor-unico]].
- Sessão morta não vira 401 aqui: derruba o cookie, zera `req.user` e **segue anônima**. Então uma rota pública responde 200 (sem identidade) para um usuário recém-desativado, e só a rota estrita dá 401. `req.authVia` fica **ausente** nesse caso, e não com um dos valores do vocabulário: quem escrever trilha de [[auditoria]] a partir dele precisa tratar o indefinido como "sem identidade", nunca como "origem desconhecida".
- Principals de link público nunca deslizam (guarda `UUID_RE.test(payload.sub)` antes da renovação): o `sub` é `public-<uuid>`, não-UUID, e não existe linha em `users` para revalidar. Mesma convenção de isenção em `backend/src/middleware/auth.js` (lá como `PRINCIPAL_UUID_RE`) e em `backend/src/middleware/permissions.js`. Quem mudar o formato do `sub` público para um UUID puro faz esses principals passarem a bater no banco e serem tratados como sessão morta. Ver [[link-publico]] e [[permissoes-atlas]].
- A renovação **não é exclusiva do cookie**. Uma chamada autenticada por Bearer também pode receber `Set-Cookie` perto da expiração. Esse cookie complementa as leituras que não aceitam cabeçalho; ele não substitui o Bearer explícito em pedidos posteriores.

## Custo

Desde 2026-09-19, leituras só-flexíveis também conferem claims vivas e corte de sessão mesmo longe da renovação. O `auth` estrito reaproveita a leitura feita pelo flexível na mesma requisição. A exceção de desempenho são os assets 3D: fora da janela de renovação, a consulta de identidade entra no memo de autorização privada, com teto de 30 segundos e chave por sessão. Isso evita SQL por fragmento sem voltar a confiar indefinidamente no papel antigo do JWT.

O caminho anônimo/público não paga query nenhuma. O caminho estrito paga exatamente uma leitura joined por requisição (`getLiveAuthState`), que substituiu o lookup só-de-organização, custo inalterado. Consequência menos óbvia: **quem entra por API key também paga essa query** ao atingir rota estrita, porque o `id` é UUID e passa pela reconciliação, e paga ANTES de o gate de escopo poder recusá-lo (a recusa por escopo é a última pergunta do `auth`, depois da conta, da OM e do corte de sessão, porque autorizar antes de saber se o principal está vivo trocaria um 401 informativo por um 403 que manda procurar permissão quando o problema é a conta). O cookie, por ser JWT, não paga nada além do que o Bearer já pagava: o custo medido do transporte está em [[tile-privado]].

## Integração

- SPA: `Authorization: Bearer`, com [[refresh-token-rotacao]] e [[sessao-boot-e-ciclo-de-vida]]. É o caminho recomendado para tudo o que ESCREVE, e é o único: o cookie que a mesma sessão carrega não autoriza escrita.
- Cookie: transporte de LEITURA do navegador, para o que não aceita cabeçalho. Não é uma alternativa ao Bearer, é o complemento dele.
- `x-api-key`: integração **fora** do navegador. Desde 2026-08-24 ela tem prazo, escopo e revogação individual, então "sem expiração" deixou de ser verdade; o que continua sendo é que ela é portadora e, na query string, viaja para dentro de log e `Referer`. No navegador ela foi substituída pelo cookie, e isso é decisão registrada ([[api-keys]], [[tile-privado]]).
- O WebSocket **não** passa por aqui: o token vai na query da conexão e é validado no gateway ([[canal-collab-websocket]]). Correção de bug de auth feita só neste middleware não alcança o canal collab.

As bordas estão fixadas em `backend/tests/unit/middleware-auth.test.js`, e as do cookie em `backend/tests/integration/cookie-de-sessao.test.js`, cujo cabeçalho registra a regra que mantém aquele arquivo honesto: cada caso negativo tem o par positivo ao lado, senão um servidor que recusasse TODA escrita passaria nele inteiro.

## Histórico

- **2026-09-19.** Bearer explícito passou a preceder cookie; a reconciliação viva passou a alcançar leituras só-flexíveis fora da renovação. O memo dos assets 3D mantém o teto próprio de 30 segundos. Provas e limites em `docs/auditoria-compartilhamento-privacidade-2026-09-19.md`.

- **2026-08-29.** O cookie deixou de ser efeito da renovação deslizante e passou a ser emitido no login e no refresh, apagado no logout; `req.authVia` passou a distinguir `'cookie'` de `'bearer'`, nasceu `req.temBearer`, e o `auth` estrito passou a recusar principal de cookie nos métodos que escrevem. A frase desta página sobre o cookie velho ganhar do Bearer foi corrigida no ponto em que era imprecisa: ela vale para a RESOLUÇÃO, e não para a rota estrita com cookie expirado.
- **2026-08-24.** A seção do buraco de organização descrevia como vigente um defeito fechado naquela data. Reescrita por supersessão temporal, com o texto antigo preservado na citação acima.
