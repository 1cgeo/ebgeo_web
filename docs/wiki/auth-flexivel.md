# Autenticação Flexível (flexibleAuth)

Middleware global que **identifica sem autorizar**: popula `req.user` quando há credencial, deixa a requisição seguir anônima quando não há, e nunca responde erro.

## O contrato congelado: falhar é seguir

Qualquer falha (formato inválido, JWT expirado, assinatura errada, Postgres fora do ar) termina em `next()` sem `req.user`. O `catch` mudo que fecha `flexibleAuth` (`backend/src/middleware/flexible-auth.js`) não é preguiça: é o que impede que um banco indisponível derrube as rotas que não precisam de banco ([[gazetteer-nomes-geograficos]], catálogo público, `/api/config`, [[streetview-360]]). Trocar isso por um `next(err)` "para não engolir erro" quebra o modo anônimo inteiro.

Quem barra é a rota, via `auth`/`requireAdmin` (`backend/src/middleware/auth.js`), com os códigos de [[sintese-contrato-erros-http]] e [[erros-api]]. Ver [[autenticacao-jwt]] e [[sintese-eixos-de-permissao]].

## As três armadilhas de precedência

O código convida ao erro em `flexibleAuth` (`backend/src/middleware/flexible-auth.js`), e nenhuma destas está comentada lá:

- **Só a chave que RESOLVE encerra a decisão.** Até 2026-07-25 o `return next()` do ramo da chave estava *fora* do `if (rows[0])`, e a mera presença de `x-api-key`/`?api_key=` pulava cookie e Bearer: era uma demoção silenciosa de sessão válida disparável por quem conseguisse a vítima a abrir `...?api_key=qualquercoisa`, porque o gatilho mora na query string. Hoje chave malformada ou ausente de `users` cai no ramo seguinte. A precedência que sobrou é estrita e continua valendo: chave **boa** ganha do Bearer bom.
- **Cookie ganha do Bearer**, silenciosamente (`token = req.cookies?.token || extractBearerToken(req)`). Browser com cookie velho e SPA mandando Bearer novo: vale o velho. É a causa provável de "deslogou sozinho" em aba antiga.
- **Chave malformada não toca o banco** (guarda `UUID_RE`). Anti-DoS de borda, ver [[hardening-borda-api]]. Consequência: mudar o formato da API key exige mudar essa regex, senão toda chave nova vira anônima antes de chegar ao Postgres.

`?api_key=` é transporte suportado, e é por isso (e só por isso) que `api_key` está no `SENSITIVE_QUERY_KEYS` de `backend/src/utils/redact-url.js`. Removeu o transporte, remova a entrada; removeu a entrada sem remover o transporte, vazou credencial permanente em texto puro no pino. O invariante para aí, e é mais estreito do que a frase sugere: ele cobre a URL da requisição, não campo de log estruturado (ver [[api-keys]]).

## O buraco de organização no caminho da API key

`FIND_USER_BY_API_KEY` (`backend/src/modules/users/users.queries.js`) exige `u.is_active = true` e **nada sobre a organização**. Já o caminho JWT estrito devolve `403 Organization is inactive` (`backend/src/middleware/auth.js`). Efeito que não aparece em nenhum dos dois arquivos isoladamente: um portador de API key de OM desativada **autentica** no `flexibleAuth` e chega com `req.user` populado em qualquer rota de auth opcional; só é barrado quando encosta numa rota estrita. Rota que lê `req.user` sem exigir `auth` está confiando num vínculo de OM que pode estar morto. Ver [[api-keys]], [[gestao-usuarios]] e [[organizacoes-om]].

## Sliding session: o incidente e o que ficou de fora

O porquê da revalidação viva antes de reassinar está documentado no próprio código (`backend/src/middleware/flexible-auth.js` e o bloco `LIVE_AUTH_STATE` de `backend/src/utils/org-status.js`): reassinar claims antigos transformava a janela de "no máximo 15 min desatualizado" em "para sempre". Leia lá, não aqui.

O que o código **não** diz:

- **Dois claims são adotados do banco sem condição:** o `role` global e o escopo de produção `producer_org_id`, que autoriza escrita de catálogo e de acervo 360 ([[acesso-a-recurso-privado]]). `org_role`/`organization_id` só são reconciliados **quando o token já os carrega**, para preservar o degrade de tokens legados (`org_role || 'viewer'`); adotá-los do banco sempre faria token pré-claims-de-organização virar erro em vez de viewer. Ver [[jwt-emissor-unico]].
- Sessão morta não vira 401 aqui: derruba o cookie, zera `req.user` e **segue anônima**. Então uma rota pública responde 200 (sem identidade) para um usuário recém-desativado, e só a rota estrita dá 401. Trilha de [[auditoria]] via `req.authVia` fica ausente nesse caso, não `'jwt'`.
- Principals de link público nunca deslizam (guarda `UUID_RE.test(payload.sub)` antes da renovação): o `sub` é `public-<uuid>`, não-UUID, e não existe linha em `users` para revalidar. Mesma convenção de isenção em `backend/src/middleware/auth.js` (lá como `PRINCIPAL_UUID_RE`) e em `backend/src/middleware/permissions.js`. Quem mudar o formato do `sub` público para um UUID puro faz esses principals passarem a bater no banco e serem tratados como sessão morta. Ver [[link-publico]] e [[permissoes-atlas]].
- A renovação **não é exclusiva do cookie**. Como o token é resolvido por `cookie || Bearer`, uma chamada que só mandou `Authorization` também recebe `Set-Cookie`, ganhando um cookie que ela não pediu, e que passa a ganhar do Bearer nas requisições seguintes, pela precedência acima.

## Custo

O caminho anônimo/público não paga query nenhuma. O caminho estrito paga exatamente uma leitura joined por requisição (`getLiveAuthState`), que substituiu o lookup só-de-organização, custo inalterado. Consequência menos óbvia: **quem entra por API key também paga essa query** ao atingir rota estrita, porque o `id` é UUID e passa pela reconciliação.

## Integração

- SPA: `Authorization: Bearer`, com [[refresh-token-rotacao]] e [[sessao-boot-e-ciclo-de-vida]]. É o caminho recomendado, e evita a armadilha do cookie velho acima.
- `x-api-key`: máquina-a-máquina apenas. No browser é indefensável: sem `httpOnly`, sem expiração, e a rotação invalida a anterior na mesma transação, sem janela de convivência ([[api-keys]]).
- O WebSocket **não** passa por aqui: o token vai na query da conexão e é validado no gateway ([[canal-collab-websocket]]). Correção de bug de auth feita só neste middleware não alcança o canal collab.

As bordas estão fixadas em `backend/tests/unit/middleware-auth.test.js`.
