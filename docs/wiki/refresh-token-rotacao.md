# Rotação, Reuso e Revogação de Refresh Tokens

Refresh tokens são de uso único, rotacionados por claim atômico a cada renovação; reapresentar um token já revogado é lido como roubo e revoga toda a família do usuário, exceto dentro de uma janela de graça de 10s, que existe para não confundir rajada honesta com furto.

Implementação em `refresh` (`backend/src/modules/auth/auth.service.js`) e nas queries de claim, lookup e revogação (`backend/src/modules/auth/auth.queries.js`). Ver [[autenticacao-jwt]] e [[jwt-emissor-unico]].

## O que sustenta o desenho

**Access token não tem revogação.** É JWT stateless, nunca consultado no banco. Toda a capacidade de cortar sessão vive no refresh token, que é opaco e com estado no Postgres. Isso não é acidente de implementação: é o eixo que decide o que é possível (ver "o que a revogação não faz", abaixo).

**O banco guarda só o SHA-256** (`generateRefreshToken`, `backend/src/modules/auth/auth.service.js`). Um dump de `refresh_tokens` não devolve tokens usáveis. Sem salt de propósito: a entropia do token (`randomUUID` mais 32 bytes) já torna rainbow table irrelevante, e o hash precisa ser determinístico para servir de chave de lookup.

**Revogação é carimbo `revoked_at`, nunca `DELETE`.** A linha revogada é o que permite distinguir "nunca existiu" de "já foi usado". Essa distinção é o mecanismo inteiro de detecção de reuso.

## Armadilhas

**A linha revogada é dado de segurança, não lixo.** Não existe job de purga (nenhum `DELETE FROM refresh_tokens` no backend). Quem "otimizar" limpando revogados degrada a detecção de reuso para "token nunca existiu" silenciosamente: ainda devolve `401`, mas para de revogar a família. Se a tabela crescer, purgue por `expires_at` bem antigo, nunca por `revoked_at`.

**A query que parece a certa é a errada.** `FIND_REFRESH_TOKEN` (`backend/src/modules/auth/auth.queries.js`) filtra `revoked_at IS NULL`, casa com o índice parcial e está **sem uso** (zero call sites em `backend/src`). O fluxo real usa `CLAIM_REFRESH_TOKEN` e, no ramo em que nada foi reclamado, `FIND_REFRESH_TOKEN_ANY`. Trocar uma pela outra "para usar o índice" compila, passa em teste de caminho feliz e mata a detecção de reuso.

**O índice parcial não cobre o lookup real.** `idx_refresh_tokens_hash` é `WHERE revoked_at IS NULL` (`backend/src/database/migrations/001_core.sql:135`), logo não serve à busca que precisa ver revogados. Quem sustenta essa query é o índice único implícito de `token_hash UNIQUE`. Não remova o `UNIQUE` achando que o índice parcial cobre.

**O que separa refresh concorrente de roubo são 10 segundos, e essa janela é o compromisso.** Dois requests com o mesmo token: um vence o claim atômico, os outros perdem. O perdedor só é lido como roubo se chegar **depois** de `REFRESH_RACE_GRACE_MS` (10s) da rotação; dentro da janela recebe `401` e a família fica intacta. Sem a janela, todo duplo F5, aba dupla ou retry de rede derrubava o usuário de tudo, inclusive o token recém-emitido do vencedor, que é estritamente pior que o problema guardado. O preço está declarado: um atacante que replique **dentro** da janela escapa do alarme. Não ganha nada (perdeu o claim, nenhum token é emitido), mas a família não é proativamente revogada. Fora da janela, que é onde um token roubado é realmente usado, a detecção é a de sempre. As duas defesas do cliente continuam valendo, agora como economia de ruído e não como o que separa a sessão do logout global: `apiClient.refresh()` compartilha um único refresh em voo (`frontend/src/js/store/sync/api-client.js`) e o tab lock (`frontend/src/js/index.js`) impede duas abas lendo o mesmo `localStorage`.

**A rotação é atômica, e quem a torna atômica é a cláusula `WHERE`, não uma transação.** `CLAIM_REFRESH_TOKEN` revoga e devolve na mesma `UPDATE`, guardada por `token_hash = $1 AND revoked_at IS NULL AND expires_at > NOW()` com `RETURNING`: exatamente um chamador concorrente consegue transicionar a linha, logo um token nunca rende duas famílias. Quem "simplificar" isso de volta para ler-checar-escrever (`FIND_REFRESH_TOKEN_ANY`, inspeciona `revoked_at`, depois revoga) reintroduz o defeito sem quebrar nenhum teste de caminho feliz, porque as três idas ao banco deixam todos os concorrentes verem a linha ainda não revogada e passarem juntos pela checagem de reuso. Medido em `backend/tests/integration/auth-refresh-race.test.js`: com o código anterior, 11 de 12 corridas produziam mais de uma família válida; com o atual, 0 de 12.

**O que continua fora de transação é o par claim + insert.** O claim e o `INSERT_REFRESH_TOKEN` do token novo são duas `query` soltas, embora o helper `tx` esteja importado e usado em outros pontos do mesmo arquivo (`verifyEmail`). Falha entre as duas deixa o usuário sem refresh válido: é fail-safe (força login), não fail-open, mas explica sessões que morrem sem motivo aparente depois de um blip no banco.

**O portão de e-mail é exclusivo do login.** `login` recusa conta com e-mail não confirmado (`EMAIL_NOT_VERIFIED`), mas `refresh` resolve o usuário por `FIND_USER_BY_ID` (`backend/src/modules/auth/auth.queries.js`), query que **não** seleciona `email` nem `email_verified` e só filtra `is_active`. Uma sessão que já tem refresh token continua se renovando indefinidamente depois que um admin põe `email_verified: false`: des-verificar bloqueia o próximo login, não a sessão viva. Se corte imediato for requisito, revogue os refresh tokens junto. A assimetria não é visível em nenhum dos dois arquivos sozinho, porque quem carrega a omissão é a query. Ver [[gestao-usuarios]].

**Expiração é julgada antes do reuso, e não revoga.** Token expirado devolve `401` sem tocar na família: apresentar um token que já não vale não é evidência de roubo, e tratá-lo como tal transformaria todo retomar-depois-de-expirar em logout global. Só o reuso de revogado **fora** da janela de graça escala para a família.

**OM inativa devolve `403`, não `401`.** Cliente que só trata `401` como "sessão perdida" trata isso como erro genérico e trava. Ver [[organizacoes-om]].

**`429` no refresh não é mais o balde do login, e ainda é por endereço.** `/auth/refresh` tem limitador próprio, `refreshLimiter` (`backend/src/middleware/rate-limit.js`), construído com `skipSuccessfulRequests`: só refresh que **falha** consome cota. Isso fecha as duas falhas opostas do balde único anterior, em que `/refresh`, `/verify-email` e `/resend-verification` colapsavam na chave `"<ip>:"` por não declararem `username`: uma rajada de reenvio de e-mail gastava a cota que o refresh precisa em regime permanente, e um `username` inventado no corpo comprava um balde novo por requisição (a chave lê `req.body` antes de o Joi remover campo desconhecido). O que **permanece** é a granularidade: a chave é o endereço, e numa OM atrás de NAT toda a rede divide um balde. É exatamente por isso que só a falha conta, porque o cliente transforma **qualquer** erro de refresh em logout definitivo. Trate `429` como backoff, nunca como logout. Ver [[hardening-borda-api]] e [[erros-api]].

## O que a revogação em massa NÃO faz

Não invalida access tokens já emitidos. Depois de trocar senha, resetar senha ou desativar usuário, o access roubado continua válido até `exp` (15 min default) e o socket de colaboração já aberto continua aberto, porque o token só é lido no handshake (`frontend/src/js/store/sync/api-client.js:936-938`) e nunca revalidado. **Corte imediato de sessão não existe hoje**; encurtar `JWT_ACCESS_EXPIRY` é o único ajuste disponível. Ver [[canal-collab-websocket]].

Logout revoga **um token só**: as outras sessões seguem vivas. Ver [[sessao-boot-e-ciclo-de-vida]].

`REVOKE_ALL_USER_TOKENS` tem exatamente quatro chamadores: reuso detectado (`refresh`, em `backend/src/modules/auth/auth.service.js`), troca de senha pelo próprio usuário, reset por admin e desativação (os três em `backend/src/modules/users/users.service.js`). Três deles rodam **dentro** da transação da operação; o único que sobrou como par solto é a troca de senha pelo próprio usuário (`UPDATE_USER_PASSWORD` e depois `REVOKE_ALL_USER_TOKENS`, duas `query`), então uma falha entre as duas deixa a senha nova com as sessões antigas vivas. Ver [[gestao-usuarios]] e [[auditoria]].

## Contrato para o cliente

1. Salve sempre o `refreshToken` da resposta, substituindo o anterior. Guardar o antigo não é inútil, é perigoso: reapresentá-lo derruba a sessão inteira.
2. Serialize o refresh (uma fila única por origem de token). A janela de graça de 10s absorve a rajada honesta, mas ela é margem, não contrato: um cliente que espalhe refreshes por mais que isso volta a colher logout global.
3. `429` != `401`: não dispare refresh nem logout.
4. Depois de trocar a senha, espere `401` nas outras sessões.
5. Não reutilize o fluxo de refresh para integrações máquina-a-máquina; para isso existem [[api-keys]].

Detalhe não óbvio do boot: o handler é registrado por `setAuthLostHandler` (`frontend/src/js/store/sync/api-client.js`) **depois** do boot (`frontend/src/js/index.js:132-134`), de propósito, para que expiração detectada durante a inicialização caia em anônimo silenciosamente em vez de abrir modal. Ver [[modos-operacao]] e [[auth-flexivel]]. O fluxo de link público usa `setEphemeralToken()`, que não persiste (`frontend/src/js/store/sync/api-client.js:117-120`); ver [[link-publico]].

## Divergências documentação ↔ código

> **Nota histórica.** Os guias absorvidos documentam mensagens de erro em inglês (`Invalid refresh token`, `Refresh token expired`); o código emite pt-BR (`backend/src/modules/auth/auth.service.js:135`, `145`, `150`). Os `code` e status HTTP continuam corretos: **não faça matching por `message`**.

> **Nota histórica.** O guia *01-autenticacao* prescreve access token em memória ou `sessionStorage` e só o refresh em `localStorage`; `frontend/src/js/store/sync/api-client.js:143-157` persiste **os dois** no mesmo item de `localStorage`. É deliberado (o boot valida via `getMe`), mas amplia a superfície de XSS: quem consegue script na página leva o access token pronto.

Nenhum dos guias absorvidos documenta o gate de OM inativa no refresh nem o rate limit da rota.

## Histórico

- **2026-07-25.** Duas afirmações desta página deixaram de valer e foram reescritas acima. (a) "Rotação não é transacional", com revogar e inserir como duas `query` soltas: falso desde `1d23ac9`, que trocou o ler-checar-escrever pelo claim atômico `CLAIM_REFRESH_TOKEN` mais a janela de graça de 10s, e por consequência "refresh concorrente é indistinguível de roubo" também deixou de valer, já que a janela existe exatamente para distinguir os dois. (b) "`/auth/refresh` usa o `authLimiter` do login e a chave degrada para `\"<ip>:\"` num balde único compartilhado": falso desde `aec63f8`, que deu a cada rota sem `username` o seu próprio balde por endereço.
