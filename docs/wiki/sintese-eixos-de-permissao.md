# Síntese: os eixos ortogonais de permissão

Quais eixos de autorização existem hoje (`role` global de quatro valores, escopo de produção, `permission` por atlas, concessão e empréstimo de recurso), o que cada um realmente decide, e as armadilhas de assumir que um implica o outro.

Um `role: user` pode ser `owner` de um atlas; um produtor não ganha nada num atlas alheio. A ortogonalidade é real e é a fonte de quase todo erro de gate nesta base. Hierarquia e matriz do eixo por atlas ficam em [[permissoes-atlas]] e [[sintese-capacidades-por-papel]]; o eixo de recurso privado tem página própria ([[acesso-a-recurso-privado]]); esta trata só do cruzamento.

**Esta página listou TRÊS eixos e nomeava o `org_role` como um deles.** Desde 2026-08-17 o `org_role` não decide nada, em lugar nenhum do backend, e o eixo de OM que existe é outro: o escopo de PRODUÇÃO (`users.producer_org_id`), que só um administrador escreve. Quem planejar em cima da versão antiga desenha um gate sobre um claim inerte.

## Eixo global: quatro valores que não se contêm

`users.role` tem `user`, `producer`, `credenciado` e `admin`, e **não é escada**: comparar papel global por ordem (`>=`, índice em array) é erro de leitura, não otimização. Só `admin` curto-circuita alguma coisa; produtor e credenciado caem na escada por atlas como qualquer conta comum, que é o desenho. O risco aqui é o INVERSO do que a constituição descreve para o eixo por atlas: não é excluir o nível de cima com lista fechada, é escrever `if (role !== 'user')` num gate de poder e promover os dois em silêncio. Detalhe e o censo que cobra isso em [[acesso-a-recurso-privado]].

Desde 2026-08-19 o `credenciado` deixou de ser papel só de leitura: administrar grupo de acesso é a única escrita dele, e ela não o aproxima de administrador do sistema ([[grupo-de-acesso]]). Quem planejar um gate a partir de "credenciado não escreve" está usando a definição antiga.

## O admin não tem meio-termo

`requireAtlasPermission` curto-circuita para `req.atlasPermission = 'owner'` quando o papel global é `admin`, sem consultar `atlas_shares` (`backend/src/middleware/permissions.js`), e o handshake do WebSocket repete a mesma decisão. **Não existe "admin somente leitura"**: o admin global deleta atlas alheio e destrava mapa alheio pelo mesmo caminho do dono. Toda UI administrativa deve assumir escrita total, não há nível intermediário para desenhar.

A escolha do 401 vs 403 em `backend/src/middleware/require-admin.js` é deliberada (credencial ausente não é o mesmo que autorização negada). Ver [[sintese-contrato-erros-http]].

**Armadilha: a reconciliação com o banco é parcial, e o recorte mudou.** Na rota estrita, `auth` sobrescreve o papel global **e** o escopo de produção com o valor vivo do banco, para que um admin rebaixado ou um produtor sem crachá percam o poder na hora. `org_role` e `organization_id` continuam fora, e hoje isso não custa autorização nenhuma: eles são lotação e exibição.

Esta seção terminava nomeando o sintoma: *"quem depurar 'revoguei e continua escrevendo no 360' está vendo isso"*. Não está mais. Escrever no 360 passou a depender de `producer_org_id`, que é reconciliado a cada requisição no caminho estrito por onde toda escrita do módulo corre, então a revogação vale no pedido seguinte. Ver [[autenticacao-jwt]] e [[refresh-token-rotacao]].

## Eixo de OM: é a PRODUÇÃO, e `org_role` não gateia mais nada

O `org_role` continua sendo emitido no token, continua degradando para `viewer` em token legado e continua sendo lido para exibição, mas **não decide nada em nenhum arquivo do backend**. O único gate que ele já teve era a escrita no 360, e ele saiu inteiro: `canWriteProject` (`backend/src/modules/streetview360/sv360.write.service.js`) compara `producer_org_id` com a OM dona do projeto.

A troca não é de nome, é de origem da autoridade. `organization_id` mais `org_role` diziam "quem se declarou desta OM num formulário anônimo e tem crachá interno escreve o acervo dela"; `producer_org_id` só um administrador concede, é um por pessoa, e vale para todos os tipos daquela OM. Ver [[acesso-a-recurso-privado]], [[streetview-360]] e [[organizacoes-om]].

> **Nota histórica.** O guia *12-multiorg-identidade-auditoria* (absorvido) descrevia `org_role` como "capacidade de escrita dentro da OM", sugerindo um gate geral. Ele nunca teve um gate geral, e desde 2026-08-17 não tem nenhum.

**Armadilha crítica: a OM não isola atlas.** A tabela `atlas` **não tem coluna `organization_id`**; ele só existe em `users` (`backend/src/database/migrations/001_identidade.sql`) e em `sv360.projects` (`backend/src/database/migrations/007_sv360.sql`). Logo, nenhuma listagem de atlas filtra por org, e um usuário de outra OM que receba um share tem acesso pleno ao nível compartilhado. Não desenhe telas, relatórios ou políticas assumindo tenancy de atlas por OM: não existe, e adicioná-la depois é migração de dados, não flag.

## O que atravessa arquivos e não aparece em nenhum

**A permissão do WebSocket não é imutável pela sessão.** O handshake congela `ws.permission`, mas `reconcileAuthorization` a re-resolve **a cada heartbeat** (`backend/src/modules/collab/collab.gateway.js`): share revogado, atlas despublicado ou org desativada fecham o socket com 4003; um rebaixamento apenas rebaixa `ws.permission` e a próxima escrita é rejeitada. A janela de staleness é um heartbeat, não a vida do token. Ver [[canal-collab-websocket]].

**O `sub` não-UUID é um sinal semântico, não um detalhe de formato.** Token público carrega `sub` no formato `public-<uuid>` e isso é lido como bandeira em dois arquivos independentes: `backend/src/middleware/permissions.js` pula a consulta de shares, `backend/src/middleware/auth.js` pula a reconciliação com o banco (não há linha em `users` para reconciliar). **Contrato congelado:** trocar o formato do `sub` público por um UUID puro faz o visitante bater numa reconciliação impossível e quebra os dois caminhos de uma vez. Ver [[link-publico]].

**O frontend colapsa os três eixos num vocabulário só** (`UserRole`, alimentado pelo `role` do `connected`), mas guarda o bit de admin global separado em `_globalRole` (`frontend/src/js/store/sync/session-context.js`), preservado entre re-sets de papel por atlas. Não recompute "é admin" a partir do papel por atlas: `toFrontendRole` já achatou os dois em `admin` e a informação de origem se perde.

## Regras práticas para não errar

- Nunca derive capacidade nenhuma de `org_role` nem de `organization_id`: os dois são rótulo. Edição de atlas sai de `req.atlasPermission` (ou do `permission` do `connected`, no cliente); manutenção de acervo sai do escopo de produção, resolvido no banco.
- Nunca assuma isolamento de atlas por OM.
- Papel global se pergunta por igualdade ao papel que o gate quer, nunca por ordem: os quatro valores não formam escada. O eixo por atlas é o oposto, e ali a lista fechada é que mata.
- Rota nova de atlas: gateie no nível **mais baixo** que a operação exige e ponha o gate fino na service (padrão `assertOperationAllowed`, `backend/src/modules/sync/sync.service.js`), não na rota. É por isso que push de sync é gateado em `comment` e não em `write`.
- O gate de papel do cliente só vale para atlas remoto conectado (`frontend/src/js/store/sync/permission-guard.js`); o workspace local é sempre editável. Ver [[dominio-local-vs-remoto]] e [[modos-operacao]].
- A auditoria alcança hoje quase todo o CHECK, inclusive concessão, revogação e purga de recurso; o que sobrou sem emissor está nomeado em [[auditoria]].
- Credencial chega por `x-api-key`, cookie `token` ou Bearer, e o middleware global **nunca bloqueia**: quem barra é a rota. Ver [[auth-flexivel]], [[api-keys]] e [[hardening-borda-api]].

## Páginas comparadas

[[permissoes-atlas]], [[sintese-capacidades-por-papel]], [[acesso-a-recurso-privado]], [[grupo-de-acesso]], [[organizacoes-om]], [[autenticacao-jwt]], [[link-publico]], [[canal-collab-websocket]], [[erros-api]].
