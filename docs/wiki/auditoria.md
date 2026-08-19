# Trilha de Auditoria de Negócio

Evento de domínio persistido em `audit_trail` que pode participar da transação da mutação auditada, com um CHECK fechado de ações cuja cobertura é hoje cobrada por um teste-censo em vez de por leitura.

## Auditoria é transacional, e isso inverte a intuição de log

O terceiro argumento `t` de `createAudit` (`backend/src/utils/audit.js`) faz o INSERT entrar na transação de negócio: se a mutação reverte, o evento reverte junto. Num log operacional isso seria perda de informação; aqui é a garantia desejada, não existe janela em que o banco diga "fulano deletou o usuário" e o usuário continue vivo. Os dois lados estão pinados em `backend/tests/integration/audit-coverage.test.js`, nos casos `audit-cov-01` (rollback) e `audit-cov-02` (commit).

**Esquecer o `t` é a armadilha principal.** Sem ele o helper cai num `dbQuery` autônomo: compila, o teste feliz passa, e só um rollback revela o registro órfão. O código convida ao erro porque o argumento é opcional e a chamada sem ele é indistinguível à leitura.

**`actorId` não tem fallback.** A coluna é `NOT NULL` e o helper repassa o valor cru, então `req.user?.id` indefinido em rota anônima vira violação de NOT NULL, ou seja, 500 na mutação inteira, não só na auditoria. Toda rota que audita precisa estar atrás de autenticação (ver [[auth-flexivel]] e [[autenticacao-jwt]]).

`req` pode ser sintético: `ip` cai para a string `'system'` quando falsy e `user_agent` só é lido se `req.get` existir, então `{ ip }` basta para jobs e seeds.

## Por que `actor_id` não tem FK

Decisão deliberada, comentada na DDL de `audit_trail` (`backend/src/database/migrations/002_auditoria.sql`). As duas alternativas foram rejeitadas pelo mesmo motivo: com `ON DELETE CASCADE` a trilha se apagaria exatamente no caso em que mais importa; com `RESTRICT` o delete de usuário quebraria. Consequência para quem lê a trilha: `actor_id` pode apontar para usuário inexistente, então a UI precisa tolerar join vazio.

É para isso que `target_name` existe: **snapshot do nome no momento do evento, não referência viva**. Renomear a OM depois não reescreve a trilha, e isso é intencional.

## O CHECK não é cobertura, e por isso a cobertura virou teste

**Filtro que por construção nunca casa se lê como "nada aconteceu", não como "nunca foi ligado".** É a razão de esta seção existir, e o caso extremo durou desde o primeiro dia: `LOGIN`, `LOGOUT` e `ATLAS_DELETE` estavam **declaradas** no CHECK desde o primeiro esquema, com zero emissores em `src/`. Uma ação declarada sem emissor lê como "isto é auditado".

As três ganharam emissor em 2026-08-17, junto com catorze ações novas (`backend/src/database/migrations/002_auditoria.sql`), e o que interessa aqui é o que substituiu a leitura à mão: `backend/tests/unit/auditoria-censo.test.js` varre o versionamento, exige que **toda rota de escrita** de todo `*.routes.js` apareça classificada em uma de três classes (auditada, isenta por decisão, buraco conhecido), confere que o arquivo emissor declarado realmente cite a ação declarada, e cobra que **toda ação do CHECK tenha ao menos um emissor**. As duas propriedades que fazem o censo valer alguma coisa: buraco tem **teto** (senão a saída fácil para uma rota nova sem trilha é declará-la buraco e seguir), e ele prova que reprova, apontando a mesma varredura para uma fixture não classificada.

O que ele NÃO prende: o conteúdo da linha. Que a trilha traga o ator, o alvo certo e os detalhes é comportamento, e mora em `backend/tests/integration/auditoria-acoes-novas.test.js`.

**O alvo voltou a ser coluna de primeira classe.** `target_id` era UUID enquanto o id de catálogo é slug, então o alvo viajava dentro de `details` com `target_type = 'SYSTEM'`, e `idx_audit_target` não respondia "tudo que já foi feito com este recurso". O alargamento para TEXT devolveu o alvo às colunas, e 'SYSTEM' voltou a significar sistema. Consequência para quem consulta: o `target_id` é heterogêneo por construção (slug de catálogo, UUID de projeto 360, a chave textual `app_config`), e nenhuma consulta do módulo filtra ou junta por ele.

Duas exclusões deliberadas, para não serem lidas como esquecimento: **calibração de foto 360** fica fora por frequência (a foto já tem `updated_at`, e a auditoria do 360 é no nível do projeto, que é onde o acesso se decide) e **login falho** fica fora por impossibilidade estrutural (`actor_id` é NOT NULL, e uma tentativa recusada não tem ator identificado; o `username` digitado não é identidade).

Quatro `target_type` ficaram declarados sem emissor, e a distinção entre eles é o que vale a pena saber: `GROUP` e `MODEL` nunca tiveram escritor (herança do primeiro CHECK), enquanto `SYSTEM` e `STREETVIEW_MARKER` **tinham e perderam** (o primeiro era o depósito do alvo que não cabia nas colunas, e a revisão do alvo o devolveu a elas; o segundo caiu junto com a tabela de catálogo homônima, apagada em 2026-08-17, ver [[resources-catalogo]]). Removê-los do CHECK seria DDL destrutiva sem ganho, e linha de trilha já gravada pode carregá-los. Os quatro estão nomeados no censo: vocabulário reservado é diferente de vocabulário esquecido, e a única forma de manter a distinção é escrevê-la.

O custo do CHECK fechado: ação nova exige migração de schema, não só código, e foi exatamente o que as catorze ações de 2026-08-17 custaram. Em troca, typo em `action` falha na hora em vez de virar lixo silencioso.

### Armadilha: auditoria de organização não é atômica

As três ações de OM auditam **depois** do serviço retornar, no controller e fora de qualquer transação (`backend/src/modules/organizations/organizations.controller.js`), ao contrário de todo o ciclo de vida de usuário e da rotação de API key, que passam `t`. Se o INSERT de auditoria falhar, a OM já foi criada, alterada ou desativada e o cliente ainda recebe 500: estado divergente entre operação e trilha.

`organizations` é o único módulo que audita fora de uma transação **que existe**, e é isso que o torna a exceção perigosa de copiar: o padrão do repositório é auditar dentro do `tx` do service. O catálogo audita no controller pelo motivo oposto e legítimo (cada escrita é uma query só, não há transação a que aderir, e o controller é o único ponto que tem `req` e a tabela ao mesmo tempo), então ele não é precedente. Ao auditar algo novo em [[organizacoes-om]], mova a chamada para dentro do service, como faz [[gestao-usuarios]].

**Auditoria bloqueante é a regra, e o best-effort é exceção nomeada.** `createAuditBestEffort` existe para três sítios do caminho de credencial (login, logout e o auto-cadastro): ali uma falha de escrita da trilha não pode virar 500, porque derrubaria a entrada de todo mundo, e no auto-cadastro reabriria pela exceção o oráculo de existência de conta que o 201 uniforme fecha ([[gestao-usuarios]]). Fora deles, uma trilha que falha derruba a mutação, e é assim que se quer.

## Leitura: armadilhas de integração de `GET /api/v1/audit`

O gate é o `role` **global**, não o `org_role` nem permissão por atlas: um `owner` de OM que não seja admin global não lê a trilha (ver [[sintese-eixos-de-permissao]] e [[permissoes-atlas]]). E é o papel **vivo**, não a claim, porque `auth` sobrescreve `req.user.role` antes de `requireAdmin` rodar. Ausência de credencial dá 401, não 403 (`requireAdmin`, `backend/src/middleware/require-admin.js`); erro de Joi dá 422 (ver [[erros-api]] e [[sintese-contrato-erros-http]]).

Quatro pegadinhas para quem for construir a tela:

- **Envelope duplamente aninhado.** O controller faz `res.json({ data: result })` sobre um `result` que já é `{ total, page, limit, data }` (`backend/src/modules/audit/audit.controller.js`, `backend/src/modules/audit/audit.service.js`). Os eventos ficam em `response.data.data`. É o erro de integração mais provável nesta rota.
- **Paginação 1-based** (`backend/src/modules/audit/audit.service.js`). Tabela de UI 0-based precisa somar 1.
- **Filtros são igualdade exata**, via `($1::text IS NULL OR action = $1)` (`backend/src/modules/audit/audit.queries.js`). Não há busca parcial nem case-insensitive: `action=org_create` não retorna nada, e `action=all` filtra por uma ação literal chamada `all` devolvendo lista vazia sem erro. Para "todos", **omita o param**. Params desconhecidos são descartados em silêncio pelo `stripUnknown` (`backend/src/middleware/validate.js`), então um filtro com nome errado parece funcionar e traz tudo.
- **Linhas saem em snake_case**, sem camelização, ao contrário de outras superfícies do cliente (ver [[api-rest-atlas]]).

O filtro por `targetId` nasceu junto com o alargamento, e é o que paga a migração: sem ele "tudo que já foi feito com este recurso" continuaria não sendo respondível, apesar do índice `(target_type, target_id)`. Continua **não** havendo filtro por intervalo de datas. `total` e as linhas vêm de duas queries em `Promise.all` sem transação (`backend/src/modules/audit/audit.service.js`): sob escrita concorrente podem discordar por uma linha, irrelevante para tela de admin, relevante se alguém usar isso para reconciliação exata.

## Estado no frontend

O cliente web **não consome a rota**: não há referência a `/api/v1/audit` em `frontend/src/`. A tela de auditoria do painel de admin ainda é checklist, não código.

Auditoria é REST puro e admin-only: não gera nem consome operações de colaboração, então nada disso passa por [[modelo-conflito-lww]] ou [[envelope-operacao]]. Para o que o admin faz sobre o sync em si, ver [[sync-admin-operacoes]] e [[hardening-borda-api]].

## Histórico

- **2026-07-25.** A seção "O CHECK não é cobertura" descrevia seis chamadas contra 15 ações e nomeava `SHARING_CHANGE` e `PERMISSION_REVOKE` como nunca emitidas. Superado pela cobertura de `users` e `sharing`.
- **2026-08-17.** A página inteira girava em torno de "três ações continuam sem emissor" (`LOGIN`, `LOGOUT`, `ATLAS_DELETE`) e de alvos sem call site. Superado em 2026-08-17: as três ganharam emissor, catorze ações novas entraram (catálogo, `config_settings`, ciclo de vida do atlas, 360 no nível do projeto, escopo de produção, purga de concessões), `target_id` virou TEXT, e a cobertura passou a ser cobrada por censo em vez de por leitura. Esta é a forma de conteúdo que o [[wiki-schema]] adverte: lista de furos abertos escrita no presente vence por trabalho alheio, e vira lista de mentiras no dia em que a fase seguinte fecha os itens.
