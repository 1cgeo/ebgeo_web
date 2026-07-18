# API Keys de Usuário

Chave UUID única por usuário para integração máquina-a-máquina, não expirante, rotacionável atomicamente pelo próprio usuário ou por admin, com a chave antiga arquivada e o evento auditado na mesma transação.

## Decisões que o código não explica

**A chave é armazenada em claro, não hasheada.** O lookup de autenticação (`FIND_USER_BY_API_KEY`, `backend/src/modules/users/users.queries.js:203-206`) é uma igualdade indexada executada a cada request; hashear obrigaria a varrer a tabela para comparar. A alternativa foi rejeitada por custo por requisição, e o preço é explícito: quem lê o banco lê todas as credenciais M2M em claro, tanto em `users.api_key` quanto no histórico. Acesso ao banco é acesso total.

**A chave não tem escopo, rótulo nem expiração, e é uma só por usuário.** Ela carrega **exatamente** a identidade do dono, portanto todo o poder dele (ver [[permissoes-atlas]] e [[sintese-eixos-de-permissao]]). Não existe chave de permissão reduzida nem múltiplas chaves para separar integrações: se duas integrações compartilham a chave, rotacionar por causa de uma derruba a outra.

## Precedência: a armadilha número um

`backend/src/middleware/flexible-auth.js:44-54` faz curto-circuito duro: se `x-api-key` (ou `?api_key=`) está presente, a função retorna `next()` **sempre**, e cookie e `Authorization: Bearer` nunca chegam a ser lidos.

O código convida ao erro porque o ramo parece um simples "tenta a API key primeiro". Não é: uma chave já rotacionada, ou uma string que não é UUID, deixa a requisição **anônima** mesmo com um Bearer válido no mesmo request, e as rotas estritas respondem `401`. Sintoma clássico: um cliente que guarda a chave antiga num interceptor global passa a receber 401 em tudo depois da rotação, e o Bearer "que estava lá" não salva. Chave malformada nem consulta o banco (`UUID_RE` barra antes) e é tratada como anônimo, comportamento fixado em `tests/integration/identity.test.js:79-80`. Ver [[auth-flexivel]].

## O comportamento que só emerge de dois middlewares

`FIND_USER_BY_API_KEY` filtra apenas `u.is_active = true`; ele **não** consulta `organizations.is_active`. Quem pega a OM desativada é o middleware estrito `auth` (`backend/src/middleware/auth.js:80-98`), porque o principal de API key tem `id` UUID real e por isso passa por `getLiveAuthState`, recebendo `401 Account is inactive` / `403 Organization is inactive` e o `role` global reconciliado ao vivo.

Consequência prática, invisível em qualquer arquivo isolado: em **rotas flexíveis** (as que atendem anônimo), uma chave de usuário ativo numa OM desativada continua resolvendo `req.user` normalmente. Ver [[organizacoes-om]].

**Não há sliding session no caminho da API key.** O ramo retorna antes de toda a lógica de expiração/renovação de cookie. A chave é credencial não expirante: sem TTL, sem rotação automática, fora de [[refresh-token-rotacao]] e do ciclo de [[autenticacao-jwt]]. A única forma de invalidar é rotacionar.

## Rotação

`ROTATE_API_KEY` (`backend/src/modules/users/users.queries.js:186-197`) é um único statement com CTE, e dois efeitos dele não são óbvios lendo o SQL:

- **É também o endpoint de criação.** O predicado `api_key IS NOT NULL` faz o usuário que nunca teve chave arquivar zero linhas enquanto o `UPDATE` gera a primeira. Não existe rota separada de "gerar chave", e não procure por uma.
- **Não há janela com duas chaves válidas.** A antiga para de autenticar no mesmo instante em que a nova nasce, fixado em `tests/integration/identity.test.js:69-70`. Não planeje migração de cliente contando com sobreposição: o corte é instantâneo.

A resposta `{ apiKey }` é a **única** vez que a chave nova aparece. Não há rota de leitura, e nenhuma query do módulo `users` (perfil, listagem admin, busca) seleciona `api_key`. Perdeu, rotaciona de novo.

`API_KEY_ROTATE` está na lista fechada do CHECK de `audit_trail` (`backend/src/database/migrations/001_core.sql:174`): é **contrato congelado**, adicionar ou renomear ação de auditoria exige migração. Ver [[auditoria]].

Sobre erros da rota admin ([[erros-api]], [[sintese-contrato-erros-http]]): o `404` para UUID bem formado sem usuário correspondente existe e é intencional (`backend/src/modules/users/users.service.js:264`), embora o guia 12 liste apenas 403 e 422 para essa rota.

## Armadilhas

- **`created_at` no histórico é sempre `NULL`.** A CTE insere literalmente `NULL::timestamptz` (`backend/src/modules/users/users.queries.js:190`), porque `users` não guarda quando a chave atual foi emitida. Não escreva relatório de "vida útil da chave" nessa coluna: só `revoked_at` é confiável, e a data de emissão de uma chave só é inferível como o `revoked_at` da anterior.
- **Desativar usuário não revoga a chave.** `SOFT_DELETE_USER`/`REACTIVATE_USER` só mexem em `is_active`; a chave continua na linha e volta a autenticar assim que o usuário é reativado. Se a desativação foi por comprometimento, **rotacione explicitamente** além de desativar. Ver [[gestao-usuarios]].
- **A chave na query string vaza fora do alcance do backend.** O backend redige `api_key` dos próprios logs (`backend/src/utils/redact-url.js:6`), mas isso não alcança nginx, CDN, histórico de shell ou `Referer`. Prefira sempre o header; a query existe só para clientes que não conseguem setar headers. Ver [[hardening-borda-api]].
- **Chave não é para browser.** Não expira e não tem proteção própria contra CSRF (não sendo cookie, ao menos não é auto-enviada). Na SPA use `Authorization: Bearer`.
- **`mapDbUser` descarta campos que a query traz.** `FIND_USER_BY_API_KEY` seleciona `organizacao_militar` e `rank_id`, mas `mapDbUser` (`backend/src/middleware/flexible-auth.js:18-28`) não os copia para `req.user`. Um handler que dependa desses campos funciona no caminho JWT e quebra no caminho API key.
- **Nenhum rate limit na rotação.** As rotas levam só `auth`/`requireAdmin`. Rotação em loop é barata para o cliente e cresce `api_key_history` sem teto.

## Fontes

- guia *12-multiorg-identidade-auditoria* (absorvido): Parte 3 (precedência do `flexibleAuth`, sliding session, chave inválida = anônimo) e Parte 4 (contrato dos dois endpoints de rotação, resposta irrecuperável, auditoria, histórico).
- guia *09-admin* (absorvido): posicionamento das duas rotas de rotação no inventário administrativo.
- Código do `ebgeo_backend` (manda sobre a prosa): `src/middleware/{flexible-auth,auth,error-handler}.js`, `src/modules/users/{users.queries,users.service,users.controller,users.routes}.js`, `src/database/migrations/001_core.sql`, `src/utils/redact-url.js`, `tests/integration/identity.test.js`.
