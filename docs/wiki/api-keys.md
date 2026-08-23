# API Keys de Usuário

Chave UUID única por usuário para integração máquina-a-máquina, não expirante, rotacionável atomicamente pelo próprio usuário ou por admin, com a chave antiga arquivada e o evento auditado na mesma transação.

## Decisões que o código não explica

**A chave é armazenada em claro, não hasheada.** O lookup de autenticação (`FIND_USER_BY_API_KEY`, `backend/src/modules/users/users.queries.js`) é uma igualdade indexada executada a cada request; hashear obrigaria a varrer a tabela para comparar. A alternativa foi rejeitada por custo por requisição, e o preço é explícito: quem lê o banco lê todas as credenciais M2M em claro, tanto em `users.api_key` quanto no histórico. Acesso ao banco é acesso total.

**A chave não tem escopo, rótulo nem expiração, e é uma só por usuário.** Ela carrega **exatamente** a identidade do dono, portanto todo o poder dele (ver [[permissoes-atlas]] e [[sintese-eixos-de-permissao]]). Não existe chave de permissão reduzida nem múltiplas chaves para separar integrações: se duas integrações compartilham a chave, rotacionar por causa de uma derruba a outra.

## Precedência: a chave é uma TENTATIVA, não uma escolha de mecanismo

`flexibleAuth` (`backend/src/middleware/flexible-auth.js`) tenta a API key antes de tudo, mas a tentativa só encerra a decisão quando ela **resolve** para um usuário: o `return next()` mora **dentro** do `if (rows[0])`, e o `UUID_RE` barra a string malformada antes de qualquer ida ao banco. Chave malformada, chave já rotacionada e chave ausente de `users` caem no ramo seguinte, e o cookie ou o `Authorization: Bearer` do mesmo request continuam valendo.

A precedência que sobra é estrita e vale a pena saber: chave **boa** ganha do Bearer bom, e a identidade que vale é a do dono da chave. Um cliente que mande as duas credenciais no mesmo request não escolhe qual delas responde.

Chave malformada não toca o Postgres, comportamento fixado em `backend/tests/integration/identity.test.js`. As outras armadilhas de precedência do mesmo middleware (cookie ganhando do Bearer, entre elas) estão em [[auth-flexivel]].

## O comportamento que só emerge de dois middlewares

`FIND_USER_BY_API_KEY` filtra apenas `u.is_active = true`; ele **não** consulta `organizations.is_active`. Quem pega a OM desativada é o middleware estrito `auth` (`backend/src/middleware/auth.js`), porque o principal de API key tem `id` UUID real e por isso passa por `getLiveAuthState`, recebendo `401 Account is inactive` / `403 Organization is inactive` e o `role` global reconciliado ao vivo.

Consequência prática, invisível em qualquer arquivo isolado: em **rotas flexíveis** (as que atendem anônimo), uma chave de usuário ativo numa OM desativada continua resolvendo `req.user` normalmente. Ver [[organizacoes-om]].

**Não há sliding session no caminho da API key.** O ramo retorna antes de toda a lógica de expiração/renovação de cookie. A chave é credencial não expirante: sem TTL, sem rotação automática, fora de [[refresh-token-rotacao]] e do ciclo de [[autenticacao-jwt]]. A única forma de invalidar é rotacionar.

## Rotação

`ROTATE_API_KEY` (`backend/src/modules/users/users.queries.js`) é um único statement com CTE, e dois efeitos dele não são óbvios lendo o SQL:

- **É também o endpoint de criação.** O predicado `api_key IS NOT NULL` faz o usuário que nunca teve chave arquivar zero linhas enquanto o `UPDATE` gera a primeira. Não existe rota separada de "gerar chave", e não procure por uma.
- **Não há janela com duas chaves válidas.** A antiga para de autenticar no mesmo instante em que a nova nasce, fixado em `backend/tests/integration/identity.test.js`. Não planeje migração de cliente contando com sobreposição: o corte é instantâneo.

A resposta `{ apiKey }` é a **única** vez que a chave nova aparece. Não há rota de leitura, e nenhuma query do módulo `users` (perfil, listagem admin, busca) seleciona `api_key`. Perdeu, rotaciona de novo.

`API_KEY_ROTATE` está na lista fechada do CHECK de `audit_trail` (`backend/src/database/migrations/002_auditoria.sql`): é **contrato congelado**, adicionar ou renomear ação de auditoria exige migração. Ver [[auditoria]].

Sobre erros da rota admin ([[erros-api]], [[sintese-contrato-erros-http]]): o `404` para UUID bem formado sem usuário correspondente é intencional (`rotateApiKey`, `backend/src/modules/users/users.service.js`), e não uma lacuna de validação.

## Armadilhas

- **`created_at` no histórico é sempre `NULL`.** A CTE insere literalmente `NULL::timestamptz` (`backend/src/modules/users/users.queries.js`), porque `users` não guarda quando a chave atual foi emitida. Não escreva relatório de "vida útil da chave" nessa coluna: só `revoked_at` é confiável, e a data de emissão de uma chave só é inferível como o `revoked_at` da anterior.
- **Desativar usuário não revoga a chave.** `SOFT_DELETE_USER`/`REACTIVATE_USER` só mexem em `is_active`; a chave continua na linha e volta a autenticar assim que o usuário é reativado. Se a desativação foi por comprometimento, **rotacione explicitamente** além de desativar. Ver [[gestao-usuarios]].
- **A chave na query string vaza fora do alcance do backend.** O backend redige `api_key` dos próprios logs (`SENSITIVE_QUERY_KEYS`, `backend/src/utils/redact-url.js`), mas isso não alcança nginx, CDN, histórico de shell ou `Referer`. Prefira sempre o header; a query existe só para clientes que não conseguem setar headers. Ver [[hardening-borda-api]].
- **A redação delimita menos do que o "nunca em texto puro" sugere.** Ela cobre credencial que viaja na **URL da requisição**, reescrevendo `req.url` antes do log, e nada mais. Campo de log estruturado passa inteiro, e o sistema usa isso de propósito: fora de produção o mailer grava o link de verificação, com o token dentro, num campo do próprio log ([[autenticacao-jwt]]). Quem lê "nenhuma credencial em texto puro no pino" e conclui que log de ambiente de desenvolvimento é inócuo conclui errado.
- **Chave não é para browser.** Não expira e não tem proteção própria contra CSRF (não sendo cookie, ao menos não é auto-enviada). Na SPA use `Authorization: Bearer`.
- **`mapDbUser` descarta campos que a query traz.** `FIND_USER_BY_API_KEY` seleciona `organizacao_militar` e `rank_id`, mas `mapDbUser` (`backend/src/middleware/flexible-auth.js`) não os copia para `req.user`. Um handler que dependa desses campos funciona no caminho JWT e quebra no caminho API key.
- **Nenhum rate limit na rotação.** As rotas levam só `auth`/`requireAdmin`. Rotação em loop é barata para o cliente e cresce `api_key_history` sem teto.

## Histórico

- **2026-08-23.** A seção de precedência acima descrevia o BUG como comportamento vigente, e por isso contradizia [[auth-flexivel]], que já registrava o estado certo. Reescrita por supersessão temporal. O que ela dizia: até 2026-07-25 o `return next()` do ramo da chave ficava **fora** do `if (rows[0])`, então a mera PRESENÇA de `x-api-key` ou `?api_key=` pulava cookie e Bearer, e chave rotacionada ou malformada deixava a requisição anônima mesmo com um Bearer válido no mesmo request (rota estrita respondendo `401`). Como o gatilho morava também na query string, bastava conseguir que a vítima abrisse `...?api_key=qualquercoisa` para demovê-la da própria sessão. O comentário de `flexibleAuth` documenta a correção no ponto onde ela vive.
