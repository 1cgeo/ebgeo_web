# JWT de Emissor Único (claims e aliases congelados)

Um único token HS256 (`issueAccessToken`, `ebgeo_backend/src/modules/auth/auth.service.js:24-42`) serve web, gazetteer e módulo 360 com o mesmo segredo, o que transforma cada campo do payload em contrato com um consumidor que você não compila.

## Os aliases `org` e `login` são contrato congelado

São duplicatas literais de `organization_id` e `username` (`backend/src/modules/auth/auth.service.js:36-37`). Existem porque a alternativa foi rejeitada: alterar o módulo 360 ([[streetview-360]]), que lê `{sub, org, role, login}` as-is. Ver [[sintese-contratos-congelados]].

Ao mexer em `organization_id` ou `username`, atualize o alias na mesma edição. Só `tests/integration/auth-gaps.test.js:173-175` protege isso; nenhum teste do web ou do gazetteer ([[gazetteer-nomes-geograficos]]) quebra se o alias dessincronizar, e o 360 falha em silêncio.

## Os aliases são write-only, e é isso que convida ao erro

O backend nunca lê `org` nem `login`: a verificação mapeia só os claims canônicos (`src/middleware/auth.js:31-40`, e o `mapPayload` gêmeo em `src/middleware/flexible-auth.js:30-40`). Quem abrir o middleware vai concluir que os dois claims são código morto. Removê-los deixa a suíte do backend inteira verde e derruba o 360 em produção. Ver [[auth-flexivel]].

## `posto` não tem coluna, tem JOIN

O claim `posto` lê `user.posto_graduacao` (`backend/src/modules/auth/auth.service.js:30`), mas `posto_graduacao` **não existe na tabela `users`**: é `r.nome AS posto_graduacao` vindo de um `LEFT JOIN ranks` (`src/modules/auth/auth.queries.js:6` e `:16`, `src/modules/users/users.queries.js:200`).

Consequência: qualquer query nova que alimente `issueAccessToken` sem repetir o JOIN emite `posto: undefined`, e `jwt.sign` **omite** claims `undefined` em vez de gravar `null`. O 360 recebe um token sem o campo, não com o campo vazio. A renovação deslizante só preserva o campo porque `mapPayload` faz o caminho de volta (`posto` → `posto_graduacao`) antes do re-mint.

## Só `role` é reconciliado ao vivo, e a omissão é deliberada

Na rota estrita, `auth` sobrescreve `req.user.role` com o valor do banco (`backend/src/middleware/auth.js:84-108`); a mesma consulta roda antes da renovação do cookie (`backend/src/middleware/flexible-auth.js:77-102`), porque re-assinar claims antigos a cada 15 minutos transformava "obsoleto por 15 min" em "obsoleto para sempre".

`org_role` e `organization_id` ficam de fora por decisão explícita (`backend/src/middleware/auth.js:101-107`). Um usuário movido de OM ou promovido dentro dela carrega o valor antigo por até uma janela de token. Se seu recurso precisa reagir na hora a mudança de OM, consulte o banco, não o claim. Ver [[organizacoes-om]], [[gestao-usuarios]].

Corolário: não trate `role` e `org_role` com o mesmo nível de confiança, apesar de virem do mesmo token.

## Linha ausente não é revogação

Tanto `backend/src/middleware/auth.js:91` quanto `backend/src/middleware/flexible-auth.js:82` só interrompem a sessão com `is_active = false` explícito; linha inexistente passa. É intencional (usuários só sofrem soft-delete), mas inverte a intuição de "não achei, então nego".

## Token legado degrada a partir do token, nunca do banco

Um token sem claims de organização é remintado como `org_role: 'viewer'` / `organization_id: null` mesmo que a linha em `users` diga `owner` (`backend/tests/integration/auth-gaps.test.js:184-212`). O fallback mora no mapeamento, não na assinatura. A regra: um token que nunca teve autoridade de OM não pode ganhá-la por reflexo do banco.

## O `sub` não-UUID é o gate dos principais sintéticos

O token de link público ([[link-publico]]) não carrega claim algum de organização, e seu `sub` é `public-<uuid>` de propósito. Esse formato é o gate: `backend/src/middleware/auth.js:80-82` e `backend/src/middleware/flexible-auth.js:77` pulam reconciliação viva e renovação deslizante justamente porque não há linha em `users` para reconciliar.

Se você criar outro tipo de principal sintético, mantenha o `sub` fora do formato UUID. Um `sub` UUID sem linha correspondente entra no caminho de reconciliação. E código que assume `payload.organization_id` presente precisa do guard `!isPublicUser` (`backend/src/modules/collab/collab.gateway.js:252`).

## Fronteiras que o JWT não decide

Nada no token decide permissão de atlas: ela é resolvida contra o banco no handshake do WebSocket ([[canal-collab-websocket]], [[permissoes-atlas]], [[compartilhamento-atlas]]). São três eixos independentes, sintetizados em [[sintese-eixos-de-permissao]] e [[sintese-capacidades-por-papel]].

O frontend também não decide nada com o token: ele nunca decodifica o JWT, montando a identidade a partir do objeto `user` da resposta REST. O token é opaco no cliente ([[autenticacao-jwt]], [[sessao-boot-e-ciclo-de-vida]]).

## Outras armadilhas

- `POST /auth/refresh` devolve só `{ accessToken, refreshToken }`, sem objeto `user` (`backend/src/modules/auth/auth.service.js:177`). Para ler claims de organização depois do refresh, use `GET /auth/me`.
- O access token não é revogável; a revogação real vive no refresh token ([[refresh-token-rotacao]]). Desativar um usuário corta o acesso na hora apenas por causa da reconciliação viva acima.
- Uma `x-api-key` fora do formato UUID é tratada como anônima, sem ida ao banco (`backend/src/middleware/flexible-auth.js:46`), então uma chave malformada falha como "não autenticado" e não como "chave inválida" ([[api-keys]], [[erros-api]]).
- A allowlist `['HS256']` precisa estar em toda verificação, inclusive no upgrade do WebSocket (`backend/src/modules/collab/collab.gateway.js:241`); é o que barra `alg: none`. Ver [[hardening-borda-api]].
