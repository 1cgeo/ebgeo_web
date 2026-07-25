# Gestão de Usuários (ciclo de vida administrativo)

Ciclo de vida de contas em `/api/v1/users` mais o auto-cadastro: as armadilhas estão no contrato de escrita normalizado e na assimetria de status HTTP entre caminhos equivalentes. (A terceira armadilha desta lista era a cobertura parcial de auditoria, fechada em 2026-07-24.)

## O contrato de escrita é FK, a leitura é string

`users.rank_id` e `users.organization_id` (UUID) são o que se grava; `posto_graduacao` e `organizacao_militar` só existem como `LEFT JOIN` de leitura (`backend/src/modules/users/users.queries.js:3-6`). A API **devolve** as strings e **rejeita** as strings na escrita: os schemas aceitam apenas UUID (`backend/src/modules/users/users.schemas.js:41-42` e `:49-50`).

Armadilha: um cliente que lê o usuário, edita um campo e devolve o mesmo objeto falha na validação, porque os nomes derivados não são campos reconhecidos. Toda UI de admin depende das listas controladas de postos e OMs ([[organizacoes-om]], [[resources-catalogo]]) para resolver nome para UUID antes de submeter.

Segunda armadilha, no mesmo par de campos: só `rank_id` e `organization_id` podem ser **apagados**. Eles usam o padrão valor + flag de presença (`backend/src/modules/users/users.queries.js:23-30`), porque `COALESCE` sozinho não distingue "omitido" de "quero nulo". Os demais campos são `COALESCE` puro (`backend/src/modules/users/users.queries.js:126-132`), então mandar `null` neles é no-op silencioso, não erro: a resposta 200 volta com o valor antigo e parece que a gravação funcionou.

## Perfil próprio não pode trocar de organização

`updateProfileSchema` omite `organization_id` de propósito (`backend/src/modules/users/users.schemas.js:4-15`). Não é esquecimento: com auto-serviço de tenant, o próximo refresh emitiria um token com a claim da org alvo e o usuário passaria os portões org-scoped (projetos privados de sv360, login, WS). Movimentação de tenant é ação de admin. Ver [[jwt-emissor-unico]].

## Ordem de rotas é contrato congelado

`/me` e `/search` são declarados antes de `/:userId` (`backend/src/modules/users/users.routes.js:12-16` vs `:21`). Inverter faz `/users/me` cair no handler admin e morrer na validação de UUID. Nada no código sinaliza isso; um refactor que agrupe rotas por guarda quebra o perfil próprio.

## Auto-cadastro: as diferenças que mordem

`POST /auth/register` **não é montada** quando o gate está desligado (`backend/src/modules/auth/auth.routes.js:14-16`), então devolve **404**, nunca 403, para não confirmar a existência do endpoint. Corolário: o cliente não deve sondar a rota para descobrir se o cadastro está aberto. A fonte correta é `features.self_registration` em `GET /api/config` (`backend/src/modules/config/config.service.js:144`), ver [[config-dinamico]]. Default sem override é `NODE_ENV !== 'production'`, ou seja, produção (rede militar interna) nasce fechada.

Colisão de nome tem **duas mensagens diferentes por desenho**: o endpoint público responde a colisão de username ou de e-mail com a mesma frase genérica, para não virar oráculo de existência (`backend/src/modules/auth/auth.service.js:210-224`); o endpoint admin responde com mensagem específica (`backend/src/modules/users/users.service.js:112-115`). Não unifique as duas "por consistência", a genérica é a defesa.

Conta criada por admin não tem e-mail, portanto o portão de verificação nunca dispara e ela loga de imediato. Conta auto-cadastrada **com** e-mail nasce bloqueada com `401 EMAIL_NOT_VERIFIED`. Quando não há SMTP configurado, o desbloqueio oficial é o admin enviar `email_verified: true` no `PUT /users/:userId` (`backend/src/modules/users/users.schemas.js:53-55`), caminho que não aparece em nenhuma tela óbvia.

O envio do e-mail é best-effort de propósito (`backend/src/modules/auth/auth.service.js:243-252`): a linha já foi commitada, e um 500 deixaria uma conta pendente que o usuário não consegue nem recriar nem usar.

Ainda: o auto-cadastro força `role: 'user'` e cai na organização default via `COALESCE` no SQL; o caminho admin **não** tem default de organização, então admin que omite o campo cria usuário sem OM.

## Desativação: o que ela não faz

É soft-delete com transferência obrigatória de atlas, tudo em uma transação (`backend/src/modules/users/users.service.js:219-248`). Os limites que surpreendem:

- A transferência é **tudo ou nada por usuário**: `UPDATE atlas SET owner_id` para todos de uma vez (`backend/src/modules/users/users.queries.js:170-175`). Não existe transferir atlas a atlas por aqui.
- Só atlas **de propriedade** viajam. Compartilhamentos em que o usuário era editor ou visualizador continuam apontando para uma conta inativa, ver [[permissoes-atlas]].
- O ciclo de vida é auditado inteiro desde 2026-07-24 (`759c6c6`): `USER_CREATE`, `USER_UPDATE`, `ROLE_CHANGE`, `PASSWORD_RESET` e `USER_DELETE`, todos dentro da **mesma transação** da escrita (`backend/src/modules/users/users.service.js:150,238,247,286,369`), ou seja, ou a conta muda e há linha de trilha, ou nenhuma das duas coisas. Ver [[auditoria]].
  - O detalhe que não se adivinha: `ROLE_CHANGE` é emitido **à parte** de `USER_UPDATE`, não como campo dele, porque "quem promoveu esse usuário a admin" é a pergunta que se faz em revisão e ela precisa casar por `action`, não por varredura de `details`.
  - Até essa data a linha acima dizia que `USER_DELETE` era a única auditada, e estava certa: `USER_CREATE` já era aceito pelo CHECK de `audit_trail.action` desde a migração `001` e não tinha emissor nenhum. Filtro que por construção nunca casa se lê como "nada aconteceu", não como "nunca foi ligado", que é a forma mais silenciosa de lacuna.
- Assimetria de status a tratar no cliente: auto-desativação via `DELETE` é **403** (`backend/src/modules/users/users.service.js:211`), via `PUT` é **409** (`backend/src/modules/users/users.service.js:142-149`). Caminhos distintos, mesma intenção do usuário.

## Efeito imediato, e o que não é reconciliado

Desativar e rebaixar valem na hora, apesar dos 15 minutos do access token, porque o middleware reconcilia com o banco a cada requisição e **sobrescreve** `req.user.role` pelo papel vivo (`middleware/auth.js:84-108`). Logo `requireAdmin` nunca honra claim de admin já rebaixado.

O que **não** é reconciliado, e por isso continua limitado à janela do token: `org_role` e `organization_id`. Também não confunda linha ausente com revogação, o sistema só faz soft-delete, linha sumida é anomalia. Principais de link público (`sub` no formato `public-<uuid>`) saem antes da reconciliação por não terem linha em `users`, ver [[link-publico]] e [[autenticacao-jwt]].

## Senha e limites de busca

Troca e reset revogam **todos** os refresh tokens. Consequência para a UI: depois de qualquer um dos dois, as outras abas e dispositivos caem no próximo refresh. Trate esse 401 como "faça login de novo", não como falha inesperada. Ver [[refresh-token-rotacao]].

`GET /users/search` tem **LIMIT 20 fixo e sem paginação** (`backend/src/modules/users/users.queries.js:48-63`), e é ela que alimenta o seletor de destinatários do [[compartilhamento-atlas]]. É o motivo de buscas curtas parecerem "cortar" resultados em organizações grandes. `GET /users` (admin) também não pagina, traz tudo.

`GET /users/me` filtra `is_active = true` (`backend/src/modules/users/users.queries.js:14`), então conta desativada receberia 404 no próprio perfil, embora o middleware já a barre com 401 antes.

## Nunca ramifique por `message`

As mensagens de erro estão em português e mudaram ao longo do tempo; os `code` (`UNAUTHORIZED`, `FORBIDDEN`, `CONFLICT`, `NOT_FOUND`) são o contrato estável. Ver [[erros-api]] e [[sintese-contrato-erros-http]].

## Fronteiras

Gestão de usuários é **REST puro**: nada aqui viaja como operação de sync, não existe tipo de entidade de usuário no envelope colaborativo ([[sintese-rest-vs-sync]], [[tipos-entidade-sync]]). O papel global `admin` decidido aqui é ortogonal ao papel por atlas ([[sintese-eixos-de-permissao]], [[sintese-capacidades-por-papel]]). Rotação de chave em [[api-keys]]; rate limit das rotas de credencial em [[hardening-borda-api]]; operações administrativas sobre a tabela de operações em [[sync-admin-operacoes]].
