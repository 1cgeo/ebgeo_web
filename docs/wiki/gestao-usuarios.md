# Gestão de Usuários (ciclo de vida administrativo)

Ciclo de vida de contas em `/api/v1/users` mais o auto-cadastro: as armadilhas estão no contrato de escrita normalizado e na assimetria de status HTTP entre caminhos equivalentes. (A terceira armadilha desta lista era a cobertura parcial de auditoria, fechada em 2026-07-24.)

## O contrato de escrita é FK, a leitura é string

`users.rank_id` e `users.organization_id` (UUID) são o que se grava; `posto_graduacao` e `organizacao_militar` só existem como `LEFT JOIN` de leitura (`backend/src/modules/users/users.queries.js`). A API **devolve** as strings e **rejeita** as strings na escrita: os schemas aceitam apenas UUID (`createUserAdminSchema` e `updateUserAdminSchema`, `backend/src/modules/users/users.schemas.js`).

Armadilha: um cliente que lê o usuário, edita um campo e devolve o mesmo objeto falha na validação, porque os nomes derivados não são campos reconhecidos. Toda UI de admin depende das listas controladas de postos e OMs ([[organizacoes-om]], [[resources-catalogo]]) para resolver nome para UUID antes de submeter.

**A lista de postos tem duas fontes, e só uma serve ao anônimo.** O CRUD vive em `backend/src/modules/ranks/ranks.routes.js`, com leitura sob `auth` e escrita sob `requireAdmin`; o formulário de cadastro roda **antes** de existir token, então ele consome `postos` do `GET /api/config`, que é público de propósito ([[config-dinamico]]). Quem for construir tela nova de perfil precisa escolher a fonte pelo estado da sessão, não pela conveniência: a rota REST 401a para o visitante e o payload do config não tem as colunas administrativas. As duas fontes também filtram diferente, e isso vale igualmente para as OMs: ver [[organizacoes-om]].

Segunda armadilha, no mesmo par de campos: só `rank_id` e `organization_id` podem ser **apagados** pela API. Eles usam o padrão valor mais flag de presença (`UPDATE_USER_PROFILE` e `UPDATE_USER_ADMIN`, em `backend/src/modules/users/users.queries.js`), porque `COALESCE` sozinho não distingue "omitido" de "quero nulo", e o schema os declara `.allow(null, '')`.

Os demais campos são `COALESCE` puro, mas o modo de falha que isso sugere (mandar `null` e receber 200 com o valor antigo, parecendo que gravou) **não é alcançável pela API**, e esta página o afirmou por um tempo. `updateUserAdminSchema` declara os outros campos como `Joi.string()`/`Joi.boolean()` **sem** `.allow(null)` (`backend/src/modules/users/users.schemas.js`), o `validate` roda na borda da rota e devolve o erro Joi antes de qualquer SQL: `PUT /users/:id {"nome": null}` responde **422**, nunca 200. A assimetria real, e a que morde numa UI, é outra: o mesmo gesto de "limpar campo" apaga em dois campos e é recusado em todos os demais.

## Perfil próprio não pode trocar de organização, e a razão mudou

`updateProfileSchema` omite `organization_id` de propósito (`backend/src/modules/users/users.schemas.js`). A justificativa original **caducou e vale registrar por quê**: ela era que trocar de OM comprava os projetos 360 privados da OM alvo. Isso era verdade, e era uma escalação de privilégio alcançável também pelo auto-cadastro, onde a OM é escolhida livremente entre UUIDs que o próprio `/api/config` publica. Fechada em 2026-08-17: `organization_id` virou lotação e exibição, e quem autoriza produção é `producer_org_id`, campo que **só o caminho de admin escreve** e que carrega ação de auditoria própria (`PRODUCER_SCOPE_CHANGE`, separada de `ROLE_CHANGE` porque um produtor pode mudar de OM sem mudar de papel). Ver [[acesso-a-recurso-privado]] e [[jwt-emissor-unico]].

A omissão continua certa por uma razão mais fraca e suficiente: a lotação alimenta o gate de liveness (OM desativada barra a conta, ver [[organizacoes-om]]), então auto-mover-se entre tenants é escrita de identidade, não de perfil. `producer_org_id` é recusado ali com muito mais força, porque ele **é** autorização: aceitá-lo no perfil próprio seria auto-cadastro de crachá, o defeito que a fase inteira existe para fechar.

## Ordem de rotas é contrato congelado

`/me` e `/search` são declarados antes de `/:userId` (`backend/src/modules/users/users.routes.js`). Inverter faz `/users/me` cair no handler admin e morrer na validação de UUID. Nada no código sinaliza isso; um refactor que agrupe rotas por guarda quebra o perfil próprio.

## Auto-cadastro: as diferenças que mordem

`POST /auth/register` **não é montada** quando o gate está desligado (`backend/src/modules/auth/auth.routes.js`), então devolve **404**, nunca 403, para não confirmar a existência do endpoint. Corolário: o cliente não deve sondar a rota para descobrir se o cadastro está aberto. A fonte correta é `features.self_registration` em `GET /api/config` (`backend/src/modules/config/config.service.js`, no bloco `features` do payload; ancorado por símbolo porque a citação por linha que morava aqui apontava para dentro de outra função), ver [[config-dinamico]]. Default sem override é `NODE_ENV !== 'production'`, ou seja, produção (rede militar interna) nasce fechada.

Colisão de nome tem tratamento **oposto** nos dois endpoints, por desenho: o admin responde `409` com mensagem específica (`backend/src/modules/users/users.service.js`), porque quem chama já está autenticado e autorizado a saber quem existe; o público **não responde nada sobre isso** (abaixo). Não unifique as duas "por consistência".

**Como o oráculo de e-mail foi fechado (2026-07-25), e por que o desenho é esse.** A rota respondia `409` para conta existente e `201` para nova, então bastava mandar um username aleatório novo com o e-mail alvo e ler o status: qualquer um enumerava quem tem conta. O comentário do serviço afirmava justamente que "o atacante não sabe se um e-mail está cadastrado", propriedade que a mensagem genérica nunca deu, porque quem separava os casos era o **status**. Hoje `register` responde **201 com corpo idêntico** (`{ success: true }`, sem a conta criada) nos dois casos, não escreve nada quando há colisão, e conta a colisão **por e-mail ao dono da caixa** (`sendAccountExistsEmail`, `backend/src/utils/mailer.js`). Três detalhes que parecem excesso e são o que faz a defesa valer:

- o `bcrypt` de custo 12 roda **antes** de saber se o hash será usado. Sem isso o ramo "já existe" responderia em milissegundos contra centenas do ramo que cria, e o relógio devolveria o oráculo que o status fechou (mesma classe do `DUMMY_HASH` do login);
- o e-mail de aviso tem **um texto só** para colisão de e-mail e de username. Dois textos reabririam a enumeração pelo canal de e-mail, onde o rate limit por `${ip}:${username}` não estrangula nada (ver [[hardening-borda-api]]);
- o aviso **não repete o `nome`** enviado no cadastro: nesse ramo ele é texto escolhido por quem tentou o cadastro, endereçado à caixa de outra pessoa.

Consequência para o cliente: resolver a chamada **não** significa que a conta foi criada, e nenhuma tela pode dizer "conta criada" (`frontend/src/js/account/account.control.js`). Consequência aceita: um chamador de API sem e-mail no payload (a UI sempre manda) recebe 201 e nenhum aviso quando o username já existe.

Conta criada por admin não tem e-mail, portanto o portão de verificação nunca dispara e ela loga de imediato. Conta auto-cadastrada **com** e-mail nasce bloqueada com `401 EMAIL_NOT_VERIFIED`. Sem SMTP configurado, o desbloqueio é o admin enviar `email_verified: true` no `PUT /users/:userId` (`backend/src/modules/users/users.schemas.js`), caminho que não aparece em nenhuma tela óbvia.

Também não conte com des-verificar para cortar sessão: o portão `EMAIL_NOT_VERIFIED` é **login-only**, e uma sessão com refresh token vivo continua se renovando ([[refresh-token-rotacao]]).

O envio do e-mail é best-effort de propósito: a linha do usuário já foi commitada, e um 500 deixaria uma conta pendente que o usuário não consegue nem recriar nem usar.

Duas propriedades de `backend/src/utils/mailer.js` que o chamador não revela. **Sem `SMTP_HOST` o envio é um no-op e o cadastro devolve 201 igual**: "não chegou o e-mail" é indistinguível de "não há SMTP" pelo lado do cliente, porque `register` descarta o `{ sent }` de retorno. Fora de produção esse no-op **loga o link**, e essa linha de log é o canal de entrega de fato em dev; em produção ela vira `logger.error` sem o link (`exposeLink = !config.isProd`), então lá não existe plano B pelo log e o desbloqueio é o caminho de admin acima. E **o host do link não vem do request**: `origin` é controlado pelo cliente e `POST /auth/resend-verification` é anônimo com e-mail arbitrário no corpo, de modo que confiar nele deixava um atacante fazer o servidor enviar uma mensagem genuína, com token real, apontando para host dele. Não "conserte" a base do link lendo `req.headers.origin`. Detalhe completo, inclusive a armadilha do link relativo que sai com `sent: true`, em [[autenticacao-jwt]].

Ainda: o auto-cadastro força `role: 'user'` e cai na organização default via `COALESCE` no SQL; o caminho admin **não** tem default de organização, então admin que omite o campo cria usuário sem OM.

## Desativação: o que ela não faz

É soft-delete com transferência obrigatória de atlas, tudo em uma transação (`deleteUser`, `backend/src/modules/users/users.service.js`). Os limites que surpreendem:

- A transferência é **tudo ou nada por usuário**: `TRANSFER_ATLAS_OWNERSHIP` faz `UPDATE atlas SET owner_id` para todos de uma vez. Não existe transferir atlas a atlas por aqui.
- Só atlas **de propriedade** viajam. Compartilhamentos em que o usuário era editor ou visualizador continuam apontando para uma conta inativa, ver [[permissoes-atlas]].
- **Atlas na lixeira não entram na conta nem na transferência.** Tanto `COUNT_USER_ATLAS` quanto `TRANSFER_ATLAS_OWNERSHIP` filtram `deleted_at IS NULL`. Duas consequências que só aparecem cruzando o módulo `users` com o `atlas`: um usuário cujos atlas estão todos na lixeira passa com contagem zero e é desativado sem que ninguém peça `?transferTo`; e os atlas na lixeira permanecem com o `owner_id` da conta inativa. Até 2026-07-25 isso os deixava **presos para sempre**: `RESTORE_ATLAS` é escopado a `owner_id = $2`, a lixeira filtrava pelo mesmo `owner_id`, e a única recuperação era reativar exatamente a conta que se quis fechar. O dono do produto decidiu abrir a saída pelo lado do admin, não pelo da desativação: um admin global lista **toda** a lixeira e restaura qualquer atlas dela (ramo explícito no serviço, ver [[api-rest-atlas]]), e depois transfere a posse normalmente. As duas queries de desativação seguem como estão, então a contagem zero acima continua valendo e continua sendo o que cria o caso.
- O ciclo de vida é auditado inteiro desde 2026-07-24 (`759c6c6`): `USER_CREATE`, `USER_UPDATE`, `ROLE_CHANGE`, `PASSWORD_RESET` e `USER_DELETE`, todos dentro da **mesma transação** da escrita (`backend/src/modules/users/users.service.js`), ou seja, ou a conta muda e há linha de trilha, ou nenhuma das duas coisas. Ver [[auditoria]].
  - O detalhe que não se adivinha: `ROLE_CHANGE` é emitido **à parte** de `USER_UPDATE`, não como campo dele, porque "quem promoveu esse usuário a admin" é a pergunta que se faz em revisão e ela precisa casar por `action`, não por varredura de `details`.
  - Até essa data a linha acima dizia que `USER_DELETE` era a única auditada, e estava certa: `USER_CREATE` já era aceito pelo CHECK de `audit_trail.action` desde a migração `001` e não tinha emissor nenhum. Filtro que por construção nunca casa se lê como "nada aconteceu", não como "nunca foi ligado", que é a forma mais silenciosa de lacuna.
- Assimetria de status a tratar no cliente: auto-desativação via `DELETE` é **403**, via `PUT` é **409** (`backend/src/modules/users/users.service.js`). Caminhos distintos, mesma intenção do usuário.

## Efeito imediato, e o que não é reconciliado

Desativar e rebaixar valem na hora, apesar dos 15 minutos do access token, porque o middleware `auth` reconcilia com o banco a cada requisição (`getLiveAuthState`) e **sobrescreve** `req.user.role` pelo papel vivo (`backend/src/middleware/auth.js`). Logo `requireAdmin` nunca honra claim de admin já rebaixado.

**São dois mecanismos, não um, e o segundo não é HTTP.** O sweep de heartbeat do canal colaborativo chama `reconcileAuthorization` (`backend/src/modules/collab/collab.gateway.js`), que consulta o mesmo `getLiveAuthState` e fecha o socket com código `4003` quando a conta ou a organização estão inativas, além de adotar o papel global vivo antes de reresolver a permissão do atlas. Sem isso um socket **já aberto** sobrevivia indefinidamente à desativação, porque `deleteUser` revoga refresh token e o handshake nunca é refeito. A janela aqui é a do sweep (~30s), não a do token. Ver [[canal-collab-websocket]] e [[presenca-colaborativa]].

**São dois os campos reconciliados**, não um: o papel global e o escopo de produção `producer_org_id`, este último incondicionalmente e nos dois middlewares, porque é ele que autoriza escrever catálogo e acervo 360 ([[acesso-a-recurso-privado]]). O que **não** é reconciliado na rota estrita, e por isso continua limitado à janela do token: `org_role` e `organization_id`, que desde 2026-08-17 não autorizam nada. Também não confunda linha ausente com revogação, o sistema só faz soft-delete, linha sumida é anomalia. Principais de link público (`sub` no formato `public-<uuid>`) saem antes da reconciliação por não terem linha em `users`, ver [[link-publico]] e [[autenticacao-jwt]].

## Senha e limites de busca

Troca e reset revogam **todos** os refresh tokens. Consequência para a UI: depois de qualquer um dos dois, as outras abas e dispositivos caem no próximo refresh. Trate esse 401 como "faça login de novo", não como falha inesperada. Ver [[refresh-token-rotacao]].

`GET /users/search` tem **LIMIT 20 fixo e sem paginação** (`SEARCH_USERS`, `backend/src/modules/users/users.queries.js`), e é ela que alimenta o seletor de destinatários do [[compartilhamento-atlas]]. É o motivo de buscas curtas parecerem "cortar" resultados em organizações grandes. `GET /users` (admin) também não pagina, traz tudo.

`GET /users/me` filtra `is_active = true` (`FIND_USER_BY_ID`, `backend/src/modules/users/users.queries.js`), então conta desativada receberia 404 no próprio perfil, embora o middleware já a barre com 401 antes.

## Nunca ramifique por `message`

As mensagens de erro estão em português e mudaram ao longo do tempo; os `code` (`UNAUTHORIZED`, `FORBIDDEN`, `CONFLICT`, `NOT_FOUND`) são o contrato estável. Ver [[erros-api]] e [[sintese-contrato-erros-http]].

## Fronteiras

Gestão de usuários é **REST puro**: nada aqui viaja como operação de sync, não existe tipo de entidade de usuário no envelope colaborativo ([[sintese-rest-vs-sync]], [[tipos-entidade-sync]]). O papel global `admin` decidido aqui é ortogonal ao papel por atlas ([[sintese-eixos-de-permissao]], [[sintese-capacidades-por-papel]]). Rotação de chave em [[api-keys]]; rate limit das rotas de credencial em [[hardening-borda-api]]; operações administrativas sobre a tabela de operações em [[sync-admin-operacoes]].
