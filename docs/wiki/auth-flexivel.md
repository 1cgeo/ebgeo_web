# Autenticação Flexível (flexibleAuth)

Middleware global que **identifica sem autorizar**: popula `req.user` quando há credencial, deixa a requisição seguir anônima quando não há, e nunca responde erro.

## O contrato congelado: falhar é seguir

Qualquer falha (formato inválido, JWT expirado, assinatura errada, Postgres fora do ar) termina em `next()` sem `req.user`. O `catch` mudo em `backend/src/middleware/flexible-auth.js:105-107` não é preguiça: é o que impede que um banco indisponível derrube as rotas que não precisam de banco ([[gazetteer-nomes-geograficos]], catálogo público, `/api/config`, [[streetview-360]]). Trocar isso por um `next(err)` "para não engolir erro" quebra o modo anônimo inteiro.

Quem barra é a rota, via `auth`/`requireAdmin` (`src/middleware/auth.js:55`), com os códigos de [[sintese-contrato-erros-http]] e [[erros-api]]. Ver [[autenticacao-jwt]] e [[sintese-eixos-de-permissao]].

## As três armadilhas de precedência

O código convida ao erro em `backend/src/middleware/flexible-auth.js:42-57`, e nenhuma destas está comentada lá:

- **API key presente encerra a decisão, mesmo falhando.** O `return next()` da linha 53 está *fora* do `if (rows[0])`. Chave malformada, ou válida mas de usuário inativo, resulta em anônimo, **sem** tentar cookie ou Bearer. Cliente que manda `x-api-key` errada junto de um Bearer bom é tratado como anônimo. Não é bug, é precedência estrita, mas quebra quem presume fallback.
- **Cookie ganha do Bearer**, silenciosamente (`token = req.cookies?.token || extractBearerToken(req)`, linha 56). Browser com cookie velho e SPA mandando Bearer novo: vale o velho. É a causa provável de "deslogou sozinho" em aba antiga.
- **Chave malformada não toca o banco** (guarda `UUID_RE`, linha 46). Anti-DoS de borda, ver [[hardening-borda-api]]. Consequência: mudar o formato da API key exige mudar essa regex, senão toda chave nova vira anônima antes de chegar ao Postgres.

`?api_key=` é transporte suportado, e é por isso (e só por isso) que `api_key` está na lista de redação de log em `src/utils/redact-url.js:6`. Removeu o transporte, remova a entrada; removeu a entrada sem remover o transporte, vazou credencial permanente em texto puro no pino.

## O buraco de organização no caminho da API key

`FIND_USER_BY_API_KEY` (`src/modules/users/users.queries.js:199-206`) exige `u.is_active = true` e **nada sobre a organização**. Já o caminho JWT estrito devolve `403 Organization is inactive` (`backend/src/middleware/auth.js:97-99`). Efeito que não aparece em nenhum dos dois arquivos isoladamente: um portador de API key de OM desativada **autentica** no `flexibleAuth` e chega com `req.user` populado em qualquer rota de auth opcional; só é barrado quando encosta numa rota estrita. Rota que lê `req.user` sem exigir `auth` está confiando num vínculo de OM que pode estar morto. Ver [[api-keys]], [[gestao-usuarios]] e [[organizacoes-om]].

## Sliding session: o incidente e o que ficou de fora

O porquê da revalidação viva antes de reassinar está documentado no próprio código (`backend/src/middleware/flexible-auth.js:69-76` e `src/utils/org-status.js:23-30`): reassinar claims antigos transformava a janela de "no máximo 15 min desatualizado" em "para sempre". Leia lá, não aqui.

O que o código **não** diz:

- Só o `role` global é adotado do banco. `org_role`/`organization_id` seguem vindo do token **de propósito**, para preservar o degrade de tokens legados (`org_role || 'viewer'`). Alternativa rejeitada: adotar tudo do banco, o que faria token pré-claims-de-organização virar erro em vez de viewer. Ver [[jwt-emissor-unico]].
- Sessão morta não vira 401 aqui: derruba o cookie, zera `req.user` e **segue anônima**. Então uma rota pública responde 200 (sem identidade) para um usuário recém-desativado, e só a rota estrita dá 401. Trilha de [[auditoria]] via `req.authVia` fica ausente nesse caso, não `'jwt'`.
- Principals de link público nunca deslizam (guarda `UUID_RE.test(payload.sub)`, linha 77): o `sub` é `public-<uuid>`, não-UUID, e não existe linha em `users` para revalidar. Mesma convenção de isenção em `backend/src/middleware/auth.js:80-82` e em `backend/src/middleware/permissions.js`. Quem mudar o formato do `sub` público para um UUID puro faz esses principals passarem a bater no banco e serem tratados como sessão morta. Ver [[link-publico]] e [[permissoes-atlas]].

> **Nota histórica.** o guia *12-multiorg-identidade-auditoria* (absorvido, Parte 3) diz que a renovação ocorre quando o JWT **do cookie** está perto de expirar. O código resolve `token = cookie || Bearer` (`backend/src/middleware/flexible-auth.js:56`) e renova igualmente para o token vindo do header, gravando `Set-Cookie` numa chamada que não usava cookie nenhum. O guia também ignora a revalidação viva e o `clearCookie` de sessão morta.

## Custo

O caminho anônimo/público não paga query nenhuma. O caminho estrito paga exatamente uma leitura joined por requisição (`getLiveAuthState`), que substituiu o lookup só-de-organização, custo inalterado. Consequência menos óbvia: **quem entra por API key também paga essa query** ao atingir rota estrita, porque o `id` é UUID e passa pela reconciliação.

## Integração

- SPA: `Authorization: Bearer`, com [[refresh-token-rotacao]] e [[sessao-boot-e-ciclo-de-vida]]. É o caminho recomendado, e evita a armadilha do cookie velho acima.
- `x-api-key`: máquina-a-máquina apenas. No browser é indefensável: sem `httpOnly`, sem expiração, e a rotação invalida a anterior na mesma transação, sem janela de convivência ([[api-keys]]).
- O WebSocket **não** passa por aqui: o token vai na query da conexão e é validado no gateway ([[canal-collab-websocket]]). Correção de bug de auth feita só neste middleware não alcança o canal collab.

## Fontes

Guia *12-multiorg-identidade-auditoria* (absorvido), Partes 3 e 4. Código: `ebgeo_backend/src/middleware/flexible-auth.js`, `middleware/auth.js`, `utils/org-status.js`, `utils/environment.js`, `modules/users/users.queries.js`, `utils/redact-url.js`; bordas testadas em `tests/unit/middleware-auth.test.js`.
