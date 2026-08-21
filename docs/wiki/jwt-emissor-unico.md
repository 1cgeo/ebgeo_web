# JWT de Emissor Único (claims e aliases congelados)

Um único token HS256 (`issueAccessToken`, `backend/src/modules/auth/auth.service.js`) serve web, gazetteer e módulo 360 com o mesmo segredo, o que transforma cada campo do payload em contrato com um consumidor que você não compila.

## Os aliases `org` e `login` são contrato congelado

São duplicatas literais de `organization_id` e `username`. Existem porque a alternativa foi rejeitada: alterar o módulo 360 ([[streetview-360]]), que lê `{sub, org, role, login}` as-is. Ver [[sintese-contratos-congelados]].

Ao mexer em `organization_id` ou `username`, atualize o alias na mesma edição. Só `backend/tests/integration/auth-gaps.test.js` protege isso; nenhum teste do web ou do gazetteer ([[gazetteer-nomes-geograficos]]) quebra se o alias dessincronizar, e o 360 falha em silêncio.

## Os aliases são write-only, e é isso que convida ao erro

O backend nunca lê `org` nem `login`: a verificação mapeia só os claims canônicos (`verifyAndMapUser` em `backend/src/middleware/auth.js`, e o `mapPayload` gêmeo em `backend/src/middleware/flexible-auth.js`). Quem abrir o middleware vai concluir que os dois claims são código morto. Removê-los deixa a suíte do backend inteira verde e derruba o 360 em produção. Ver [[auth-flexivel]].

## `posto` não tem coluna, tem JOIN

O claim `posto` lê `user.posto_graduacao`, mas `posto_graduacao` **não existe na tabela `users`**: é `r.nome AS posto_graduacao` vindo de um `LEFT JOIN ranks` (`backend/src/modules/auth/auth.queries.js`).

Consequência: qualquer query nova que alimente `issueAccessToken` sem repetir o JOIN emite `posto: undefined`, e `jwt.sign` **omite** claims `undefined` em vez de gravar `null`. O 360 recebe um token sem o campo, não com o campo vazio. A renovação deslizante só preserva o campo porque `mapPayload` faz o caminho de volta (`posto` → `posto_graduacao`) antes do re-mint.

## São DOIS claims reconciliados ao vivo, não um

Na rota estrita, `auth` sobrescreve `req.user.role` **e** `req.user.producer_org_id` com o valor do banco (`getLiveAuthState`); a mesma consulta roda antes da renovação do cookie em `flexible-auth.js`, porque re-assinar claims antigos a cada 15 minutos transformava "obsoleto por 15 min" em "obsoleto para sempre".

**O escopo de produção é adotado incondicionalmente**, e a assimetria com as claims de organização é o ponto: produzir é função, não favor, então revogar precisa valer na hora, e não existe token legado a preservar (a claim é nova, e ausente significa "não produz", que é o que o banco diz de quem não tem escopo). Sem isso um produtor rebaixado seguiria escrevendo catálogo e acervo 360 pela janela inteira do token, nos dois caminhos.

`organization_id` continua de fora, e hoje isso custa menos: ele não autoriza mais nada ([[acesso-a-recurso-privado]]), é lotação e exibição. A reconciliação que existe para ele em `flexible-auth.js` é **condicional a o token já carregar a claim**, e essa condição é a regra inteira: claim ausente degrada para `null` (um token que nunca teve OM não pode ganhá-la por reflexo do banco), claim presente reconcilia. Confundir as duas é o que fez "nunca reconcilie" parecer a única forma de honrar a primeira. A condição cobria DUAS claims até 2026-08-20; o eixo `org_role` saiu do código inteiro e o disjunto dele foi podado no mesmo commit, porque um legado que trouxesse só a claim morta entraria no ramo e promoveria a lotação do banco. Ver [[organizacoes-om]], [[gestao-usuarios]].

Corolário: não trate `role` e `organization_id` com o mesmo nível de confiança, apesar de virem do mesmo token.

## Linha ausente não é revogação

Tanto `backend/src/middleware/auth.js` quanto `backend/src/middleware/flexible-auth.js` só interrompem a sessão com `is_active = false` explícito; linha inexistente passa. É intencional (usuários só sofrem soft-delete), mas inverte a intuição de "não achei, então nego".

## Token legado degrada a partir do token, nunca do banco

Um token sem a claim de organização é remintado como `organization_id: null` mesmo que a linha em `users` tenha uma OM (`backend/tests/integration/auth-gaps.test.js`). O fallback mora no mapeamento, não na assinatura. A regra: um token que nunca teve autoridade de OM não pode ganhá-la por reflexo do banco.

## Principal sintético: dois marcadores, e eles fazem coisas diferentes

O token de link público ([[link-publico]]) não carrega claim algum de organização, e nele convivem **dois** marcadores que é fácil confundir por serem o mesmo tipo de principal:

- **O claim `isPublic` marca o TIPO** e é checado **primeiro**, para confinar o visitante ao atlas que emitiu o token (`confineVisitorPrincipal` em `backend/src/middleware/auth.js`, e o par em `backend/src/middleware/permissions.js`). Confinamento vem antes de isenção: um token que se declara público fica preso ao seu atlas seja qual for o formato do `sub`.
- **O `sub` fora do formato UUID (`public-<uuid>`) governa a ISENÇÃO** de reconciliação viva (`backend/src/middleware/auth.js`), da renovação deslizante (`backend/src/middleware/flexible-auth.js`) e da busca em `atlas_shares` (`backend/src/middleware/permissions.js`), porque não há linha em `users` para reconciliar.

Se você criar outro tipo de principal sintético, mantenha o `sub` fora do formato UUID. Um `sub` UUID sem linha correspondente entra no caminho de reconciliação, e as isenções falham *em silêncio* (viram consulta vazia), não com erro. Ver [[autenticacao-jwt]] e [[canal-collab-websocket]].

## Fronteiras que o JWT não decide

Nada no token decide permissão de atlas: ela é resolvida contra o banco no handshake do WebSocket ([[canal-collab-websocket]], [[permissoes-atlas]], [[compartilhamento-atlas]]). São quatro eixos independentes, sintetizados em [[sintese-eixos-de-permissao]] e [[sintese-capacidades-por-papel]].

O frontend também não decide nada com o token: ele nunca decodifica o JWT, montando a identidade a partir do objeto `user` da resposta REST. O token é opaco no cliente ([[autenticacao-jwt]], [[sessao-boot-e-ciclo-de-vida]]).

## Outras armadilhas

- `POST /auth/refresh` devolve só `{ accessToken, refreshToken }`, sem objeto `user`. Para ler claims de organização depois do refresh, use `GET /auth/me`.
- O access token não é revogável; a revogação real vive no refresh token ([[refresh-token-rotacao]]). Desativar um usuário corta o acesso na hora apenas por causa da reconciliação viva acima.
- Uma `x-api-key` fora do formato UUID é tratada como anônima, sem ida ao banco (`backend/src/middleware/flexible-auth.js`), então uma chave malformada falha como "não autenticado" e não como "chave inválida" ([[api-keys]], [[erros-api]]).
- A allowlist `['HS256']` precisa estar em toda verificação, inclusive no upgrade do WebSocket (`backend/src/modules/collab/collab.gateway.js`); é o que barra `alg: none`. Ver [[hardening-borda-api]].
