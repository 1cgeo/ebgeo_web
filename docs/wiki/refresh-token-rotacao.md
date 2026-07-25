# Rotação, Reuso e Revogação de Refresh Tokens

Refresh tokens são de uso único e rotacionados a cada renovação; reapresentar um token já revogado é lido como roubo e revoga toda a família do usuário.

Implementação em `backend/src/modules/auth/auth.service.js:127-178` (rotação) e `backend/src/modules/auth/auth.queries.js:42-54` (lookup e revogação). Ver [[autenticacao-jwt]] e [[jwt-emissor-unico]].

## O que sustenta o desenho

**Access token não tem revogação.** É JWT stateless, nunca consultado no banco. Toda a capacidade de cortar sessão vive no refresh token, que é opaco e com estado no Postgres. Isso não é acidente de implementação: é o eixo que decide o que é possível (ver "o que a revogação não faz", abaixo).

**O banco guarda só o SHA-256** (`backend/src/modules/auth/auth.service.js:59`). Um dump de `refresh_tokens` não devolve tokens usáveis. Sem salt de propósito: a entropia do token (`randomUUID` + 32 bytes, `backend/src/modules/auth/auth.service.js:58`) já torna rainbow table irrelevante, e o hash precisa ser determinístico para servir de chave de lookup.

**Revogação é carimbo `revoked_at`, nunca `DELETE`.** A linha revogada é o que permite distinguir "nunca existiu" de "já foi usado". Essa distinção é o mecanismo inteiro de detecção de reuso.

## Armadilhas

**A linha revogada é dado de segurança, não lixo.** Não existe job de purga (nenhum `DELETE FROM refresh_tokens` no backend). Quem "otimizar" limpando revogados degrada a detecção de reuso para "token nunca existiu" silenciosamente: ainda devolve `401`, mas para de revogar a família. Se a tabela crescer, purgue por `expires_at` bem antigo, nunca por `revoked_at`.

**A query que parece a certa é a errada.** `FIND_REFRESH_TOKEN` (`backend/src/modules/auth/auth.queries.js:35-39`) filtra `revoked_at IS NULL`, casa com o índice parcial e está **sem uso**. O fluxo real usa `FIND_REFRESH_TOKEN_ANY`. Trocar uma pela outra "para usar o índice" compila, passa em teste de caminho feliz e mata a detecção de reuso.

**O índice parcial não cobre o lookup real.** `idx_refresh_tokens_hash` é `WHERE revoked_at IS NULL` (`backend/src/database/migrations/001_core.sql:135`), logo não serve à busca que precisa ver revogados. Quem sustenta essa query é o índice único implícito de `token_hash UNIQUE`. Não remova o `UNIQUE` achando que o índice parcial cobre.

**Refresh concorrente é indistinguível de roubo.** Dois requests com o mesmo token: o primeiro rotaciona, o segundo cai na detecção e derruba todos os dispositivos do usuário. Duas defesas no cliente, ambas frágeis se removidas: `apiClient.refresh()` compartilha um único refresh em voo (`frontend/src/js/store/sync/api-client.js:286-312`) e o tab lock (`index.js:126`) impede duas abas lendo o mesmo `localStorage`.

**Rotação não é transacional.** Revogar o antigo (`backend/src/modules/auth/auth.service.js:154`) e inserir o novo (`backend/src/modules/auth/auth.service.js:175`) são duas `query` soltas, embora o helper `tx` esteja importado e usado em outros pontos do mesmo arquivo (`backend/src/modules/auth/auth.service.js:284`). Falha entre as duas deixa o usuário sem refresh válido: é fail-safe (força login), não fail-open, mas explica sessões que morrem sem motivo aparente depois de um blip no banco.

**Expiração não revoga.** Se o token está expirado, o backend retorna `401` antes de revogar qualquer coisa (`backend/src/modules/auth/auth.service.js:149-151`) e a família fica intacta. Só o reuso de revogado escala para a família.

**OM inativa devolve `403`, não `401`** (`backend/src/modules/auth/auth.service.js:165-167`). Cliente que só trata `401` como "sessão perdida" trata isso como erro genérico e trava. Ver [[organizacoes-om]].

**`429` no refresh atinge todo mundo atrás do mesmo IP.** `/auth/refresh` usa o `authLimiter` do login (`backend/src/modules/auth/auth.routes.js:21`), cuja chave é `${req.ip}:${username}` (`middleware/rate-limit.js:32`). O corpo do refresh não tem `username` (`backend/src/modules/auth/auth.schemas.js:9-11`), então a chave degrada para `"<ip>:"` e todos compartilham um balde único. Numa OM atrás de NAT, ou com proxy sem `trust proxy` correto, isso vira `429` em massa. Trate `429` como backoff, nunca como logout. Ver [[hardening-borda-api]] e [[erros-api]].

## O que a revogação em massa NÃO faz

Não invalida access tokens já emitidos. Depois de trocar senha, resetar senha ou desativar usuário, o access roubado continua válido até `exp` (15 min default) e o socket de colaboração já aberto continua aberto, porque o token só é lido no handshake (`frontend/src/js/store/sync/api-client.js:936-938`) e nunca revalidado. **Corte imediato de sessão não existe hoje**; encurtar `JWT_ACCESS_EXPIRY` é o único ajuste disponível. Ver [[canal-collab-websocket]].

Logout revoga **um token só** (`backend/src/modules/auth/auth.service.js:183-186`): as outras sessões seguem vivas. Ver [[sessao-boot-e-ciclo-de-vida]].

`REVOKE_ALL_USER_TOKENS` tem exatamente quatro chamadores: reuso detectado (`backend/src/modules/auth/auth.service.js:144`), troca de senha pelo próprio usuário (`backend/src/modules/users/users.service.js:67`), reset por admin (`backend/src/modules/users/users.service.js:197`) e desativação (`backend/src/modules/users/users.service.js:239`). Só a desativação é transacional com o resto da operação; os dois casos de senha revogam em query separada logo após o `UPDATE`, então uma falha ali deixa a senha trocada com as sessões antigas vivas. Ver [[gestao-usuarios]] e [[auditoria]].

## Contrato para o cliente

1. Salve sempre o `refreshToken` da resposta, substituindo o anterior. Guardar o antigo não é inútil, é perigoso: reapresentá-lo derruba a sessão inteira.
2. Serialize o refresh (uma fila única por origem de token). Concorrência aqui não é lentidão, é logout global.
3. `429` != `401`: não dispare refresh nem logout.
4. Depois de trocar a senha, espere `401` nas outras sessões.
5. Não reutilize o fluxo de refresh para integrações máquina-a-máquina; para isso existem [[api-keys]].

Detalhe não óbvio do boot: o handler é registrado por `setAuthLostHandler` (`frontend/src/js/store/sync/api-client.js`) **depois** do boot (`frontend/src/js/index.js:132-134`), de propósito, para que expiração detectada durante a inicialização caia em anônimo silenciosamente em vez de abrir modal. Ver [[modos-operacao]] e [[auth-flexivel]]. O fluxo de link público usa `setEphemeralToken()`, que não persiste (`frontend/src/js/store/sync/api-client.js:117-120`); ver [[link-publico]].

## Divergências documentação ↔ código

> **Nota histórica.** Os guias absorvidos documentam mensagens de erro em inglês (`Invalid refresh token`, `Refresh token expired`); o código emite pt-BR (`backend/src/modules/auth/auth.service.js:135`, `145`, `150`). Os `code` e status HTTP continuam corretos: **não faça matching por `message`**.

> **Nota histórica.** O guia *01-autenticacao* prescreve access token em memória ou `sessionStorage` e só o refresh em `localStorage`; `frontend/src/js/store/sync/api-client.js:143-157` persiste **os dois** no mesmo item de `localStorage`. É deliberado (o boot valida via `getMe`), mas amplia a superfície de XSS: quem consegue script na página leva o access token pronto.

Nenhum dos guias absorvidos documenta o gate de OM inativa no refresh nem o balde de rate limit compartilhado por IP.
