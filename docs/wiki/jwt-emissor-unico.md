# JWT de Emissor Único (claims e aliases congelados)

O mesmo `JWT_SECRET`/HS256 e o mesmo payload servem os três consumidores (web, gazetteer e módulo 360), carregando `sub`/`role`/`organization_id`/`org_role` mais os aliases congelados `org` e `login`.

## O que "emissor único" significa

Existe **um** emissor de access token no ecossistema: `issueAccessToken` em `ebgeo_backend/src/modules/auth/auth.service.js:24-42`. Ele assina com `config.jwt.secret` e `algorithm: 'HS256'`, expiração `config.jwt.accessExpiry` (default `15m`, `src/config.js:40-46`). Web, gazetteer ([[gazetteer-nomes-geograficos]]) e o módulo 360 ([[streetview-360]]) validam o **mesmo** token com o **mesmo** segredo, sem trocar credencial no meio do caminho.

Consequência prática: qualquer campo que um consumidor externo leia vira contrato. Adicionar claim é seguro, renomear ou remover **quebra** um consumidor que você não está compilando.

## Payload emitido (fonte da verdade: o código)

```js
// auth.service.js:25-41
jwt.sign({
  sub: user.id,
  username: user.username,
  nome: user.nome,
  posto: user.posto_graduacao,          // note: `posto`, não `posto_graduacao`
  role: user.role || 'user',            // global: user | admin
  organization_id: user.organization_id ?? null,
  org_role: user.org_role || 'viewer',  // owner | admin | editor | viewer
  org: user.organization_id ?? null,    // ALIAS congelado
  login: user.username,                 // ALIAS congelado
}, config.jwt.secret, { expiresIn: config.jwt.accessExpiry, algorithm: 'HS256' })
```

| Claim | Significado | Armadilha |
|---|---|---|
| `sub` | id do usuário | Pode ser `public-<uuid>` em token de compartilhamento público (não é UUID puro) |
| `username` / `login` | mesmo valor, duplicado | `login` é o nome que o 360 lê |
| `posto` | vem de `posto_graduacao` da linha `users` | O nome do claim **difere** do nome da coluna e do campo da resposta REST |
| `role` | papel global (`user`/`admin`) | Ortogonal ao `org_role` e à permissão por atlas |
| `organization_id` / `org` | tenant (UUID da OM) ou `null` | `org` é o alias lido as-is pelo 360 |
| `org_role` | papel dentro da OM | Vocabulário fixado por CHECK no banco (`001_core.sql:97-98`): `owner`, `admin`, `editor`, `viewer` |

Os quatro papéis org-scoped são validados no schema, não só na aplicação: `org_role VARCHAR(20) NOT NULL DEFAULT 'viewer' CHECK (org_role IN ('owner','admin','editor','viewer'))` (`src/database/migrations/001_core.sql:97-98`).

## Por que existem dois aliases redundantes

`org` e `login` são duplicatas literais de `organization_id` e `username`. Elas existem porque o módulo 360 lê `{sub, org, role, login}` e **não seria alterado** para consumir o token unificado (comentário no próprio código, `auth.service.js:34-35`). É contrato congelado: há teste de integração que falha se alguém renomear ou dropar (`ebgeo_backend/tests/integration/auth-gaps.test.js:173-175`, "frozen alias `org` must equal organization_id"). Ver também [[sintese-contratos-congelados]].

Regra de ouro ao mexer no payload: se você alterar `organization_id` ou `username`, **atualize o alias correspondente na mesma linha de código**. Um alias dessincronizado não quebra nenhum teste do web nem do gazetteer, só o 360, e silenciosamente.

## Assimetria emitir/verificar: os aliases são write-only no backend

O backend **nunca lê** `org` nem `login`. A verificação mapeia apenas os claims canônicos:

```js
// src/middleware/auth.js:31-40
return {
  id: payload.sub,
  username: payload.username,
  nome: payload.nome,
  posto_graduacao: payload.posto,
  role: payload.role || 'user',
  organization_id: payload.organization_id ?? null,
  org_role: payload.org_role || 'viewer',
};
```

O mesmo mapeamento aparece em `src/middleware/flexible-auth.js:30-40` (`mapPayload`). Ou seja: os aliases são carga útil de saída para o 360. Se alguém "limpar" o payload achando que são mortos, os testes do backend passam e o 360 quebra em produção. Ver [[auth-flexivel]].

## Degradação graciosa de tokens legados

Tokens emitidos antes dos claims de organização continuam válidos. O fallback é feito no mapeamento, não na assinatura:

- `organization_id` ausente → `null` (`auth.js:38`)
- `org_role` ausente → `'viewer'` (`auth.js:39`)

E o fallback é **do token, não do banco**: mesmo que a linha `users` diga `org_role = 'owner'`, um token legado remintado pela sessão deslizante sai com `org_role: 'viewer'` e `organization_id: null` (teste `auth-gaps.test.js:184-212`). Isso é deliberado, um token sem claim de org não pode ganhar autoridade de org por reflexo do banco.

## O que o backend reconcilia ao vivo (e o que não reconcilia)

O claim `role` do JWT pode ficar até 15 minutos obsoleto. Por isso, na rota estrita, `auth` consulta `getLiveAuthState` e **sobrescreve `req.user.role` com o valor vivo do banco** (`src/middleware/auth.js:84-108`); usuário inativo vira `401 Account is inactive`, organização inativa vira `403 Organization is inactive`.

Deliberadamente **não** reconciliados: `org_role` e `organization_id` (comentário em `auth.js:103-107`). Um usuário movido de OM ou promovido dentro da OM continua com os valores antigos por até uma janela de token. Se seu recurso precisa reagir na hora a mudança de OM, não confie no claim, consulte o banco. Ver [[organizacoes-om]], [[gestao-usuarios]] e [[permissao-vs-papel]].

A mesma reconciliação roda antes da renovação deslizante do cookie (`flexible-auth.js:77-102`), justamente porque re-assinar claims antigos a cada 15 minutos transformava "obsoleto por 15min" em "obsoleto para sempre".

## Três eixos de autorização, não um

| Eixo | Valores | Onde vive |
|---|---|---|
| `role` (global) | `user`, `admin` | Claim + reconciliação viva; gate de `requireAdmin` |
| `org_role` (OM) | `owner`, `admin`, `editor`, `viewer` | Claim, sem reconciliação viva |
| Permissão por atlas | `owner`, `write`, `read` | Resolvida à parte, por atlas ([[permissoes-atlas]], [[compartilhamento-atlas]]) |

Nada no JWT decide permissão de atlas. O `permission` do canal colaborativo é resolvido contra o banco no handshake ([[canal-collab-websocket]], [[websocket-collab]]). Síntese dos eixos em [[sintese-eixos-de-permissao]] e [[sintese-capacidades-por-papel]].

## O token público de compartilhamento é outro animal

`atlas.service.js:142-153` assina um token separado para acesso público ao WebSocket:

```js
jwt.sign({ sub: `public-${crypto.randomUUID()}`, atlasId, isPublic: true,
           permission: 'read', nome: 'Visitante' }, config.jwt.secret, { expiresIn: '1h' })
```

Diferenças que importam:

- **Não tem** `organization_id`, `org_role`, `org` nem `login`.
- O `sub` é propositalmente **não-UUID**, e essa convenção é o gate: `auth.js:80-82` e `flexible-auth.js:77` pulam a reconciliação viva e a renovação deslizante para esses principais (não existe linha em `users` para reconciliar).
- No gateway colaborativo, o principal público é forçado a `username: 'visitante'`, `role: 'user'`, `organization_id: null` (`collab.gateway.js:270-275`) e `permission: 'read'` só se o atlas ainda for público (`collab.gateway.js:53-66`).

Se você criar outro tipo de principal sintético, mantenha o `sub` fora do formato UUID, senão ele entra no caminho de reconciliação e toma `401` por falta de linha em `users`. Ver [[link-publico]].

## Hardening ligado ao token

- **Allowlist de algoritmo**: toda verificação passa `{ algorithms: config.jwt.algorithms }` = `['HS256']` (`config.js:44-45`), tanto no REST (`auth.js:30`, `flexible-auth.js:61`) quanto no upgrade do WebSocket (`collab.gateway.js:241`). Token `alg: none` ou assimétrico forjado cai em `401 Invalid token`; expirado tem mensagem própria, `401 Token expired` (`auth.js:42-45`). Ver [[erros-api]].
- **Segredo**: `JWT_SECRET` é obrigatório na inicialização e, em produção, precisa ter no mínimo 32 caracteres (`config.js:194-197`). Ver [[hardening-borda-api]].
- **Acesso curto, refresh rotacionado**: o access token não é revogável, a revogação real está no refresh token ([[refresh-token-rotacao]]). Desativar um usuário só corta o acesso na hora por causa da reconciliação viva descrita acima.
- **Precedência de credencial**: `x-api-key` > cookie `token` > `Authorization: Bearer` (`flexible-auth.js:44-56`). Uma API key com formato não-UUID é tratada como anônima, sem ida ao banco ([[api-keys]], [[auth-flexivel]]).

## Como cada consumidor usa o payload

- **Web (`ebgeo_web`)**: não decodifica o JWT. `session-context.js` monta a identidade a partir do objeto `user` da resposta de login/`/auth/me`, não dos claims. Não há `atob`/`jwtDecode` no cliente de sync nem em `account/`. O token é opaco para o frontend, ele só o repassa no header e na query do WebSocket ([[autenticacao-jwt]], [[sessao-boot-e-ciclo-de-vida]]).
- **Gazetteer / zonas**: usam `req.user?.id`, isto é, o `sub` mapeado, para filtrar resultados por zona de acesso (`src/modules/nomes/nomes.controller.js:9-20`, `src/middleware/nomes-access-log.js:14`). Não leem `org` diretamente. Ver [[zonas-acesso-geografico]] e [[ranking-busca-toponimos]].
- **360**: lê `{sub, org, role, login}` as-is, daí os aliases.

## Armadilhas resumidas

1. Renomear `org`/`login` ou remover um deles quebra o 360 sem quebrar teste algum do web. Só `auth-gaps.test.js` protege isso.
2. `posto` (claim) ≠ `posto_graduacao` (coluna e resposta REST). Ao construir um objeto para `issueAccessToken`, passe `posto_graduacao`, é isso que a função lê (`auth.service.js:30`). O `mapPayload` da sessão deslizante entrega exatamente essa forma, por isso o re-mint preserva o campo.
3. `POST /auth/refresh` devolve só `{ accessToken, refreshToken }`, sem objeto `user` (`auth.service.js:176`). Para ler claims de org após refresh, decodifique o access token ou chame `GET /auth/me`.
4. `org_role` no token pode estar obsoleto; `role` não (é reconciliado). Não trate os dois com o mesmo nível de confiança.
5. O token de link público não tem claims de org. Código que assume `payload.organization_id` presente precisa do guard `!isPublicUser`, como em `collab.gateway.js:252`.

## Fontes

- `docs/guias/12-multiorg-identidade-auditoria.md`: Parte 2 (payload do emissor único, tabela de claims, contrato congelado dos aliases, dois eixos de papel, degradação de tokens legados) e Parte 3 (ordem de precedência da auth flexível, sessão deslizante).
- `docs/guias/01-autenticacao.md`: shape do payload, TTLs (access 15 min / refresh 7 dias), resposta de login com `organization_id`/`org_role`, justificativa dos aliases para o 360.
- `docs/guias/11-seguranca-hardening.md`: allowlist HS256 no REST e no handshake WS, mensagens `Invalid token` vs `Token expired`, requisito de `JWT_SECRET` ≥ 32 caracteres em produção.
- Código (`ebgeo_backend`): `src/modules/auth/auth.service.js`, `src/middleware/auth.js`, `src/middleware/flexible-auth.js`, `src/utils/org-status.js`, `src/modules/atlas/atlas.service.js`, `src/modules/collab/collab.gateway.js`, `src/config.js`, `src/database/migrations/001_core.sql`, `tests/integration/auth-gaps.test.js`.
- Código (`ebgeo_web`): `src/js/store/sync/session-context.js`, `src/js/store/sync/api-client.js` (confirmam que o frontend não decodifica o JWT).
