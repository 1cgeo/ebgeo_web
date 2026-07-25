# Síntese: os três eixos ortogonais de permissão

Por que existem três eixos de autorização (`role` global, `org_role` da OM, `permission` por atlas), o que cada um realmente decide, e as armadilhas de assumir que um implica o outro.

Um `role: user` com `org_role: viewer` pode ser `owner` de um atlas; um `org_role: admin` não ganha nada num atlas alheio. A ortogonalidade é real e é a fonte de quase todo erro de gate nesta base. Hierarquia e matriz do eixo por atlas ficam em [[permissoes-atlas]] e [[sintese-capacidades-por-papel]]; esta página trata só do cruzamento entre eixos.

## Eixo global: o admin não tem meio-termo

`requireAtlasPermission` curto-circuita para `req.atlasPermission = 'owner'` quando `req.user.role === 'admin'`, sem consultar `atlas_shares` (`backend/src/middleware/permissions.js:82-87`), e o handshake do WebSocket repete a mesma decisão (`backend/src/modules/collab/collab.gateway.js:83`). **Não existe "admin somente leitura"**: o admin global deleta atlas alheio e destrava mapa alheio pelo mesmo caminho do dono (`backend/src/modules/sync/sync.service.js:644-651`). Toda UI administrativa deve assumir escrita total, não há nível intermediário para desenhar.

A escolha do 401 vs 403 em `backend/src/middleware/require-admin.js:10-16` é deliberada (credencial ausente não é o mesmo que autorização negada). Ver [[sintese-contrato-erros-http]].

**Armadilha: a reconciliação com o banco é parcial e assimétrica.** Na rota estrita, `auth` sobrescreve `req.user.role` com o valor vivo do banco (`backend/src/middleware/auth.js:108`) para que um admin rebaixado perca o poder na hora, e não nos até 15 minutos de validade do access token. Mas `org_role` e `organization_id` **não** são reconciliados, por decisão explícita (`backend/src/middleware/auth.js:104-107`). Consequência: mudança de OM ou de papel org-scoped só vale no próximo token. Quem depurar "revoguei e continua escrevendo no 360" está vendo isso, não um bug de cache. Ver [[autenticacao-jwt]] e [[refresh-token-rotacao]].

## Eixo org_role: quase não gateia nada

O claim é emitido no login e degrada para `viewer` em tokens legados (`backend/src/middleware/auth.js:39`), o que dá a impressão de ser um eixo de escrita geral. **Não é.** O único consumidor de autorização em todo o backend é o módulo 360: `canWriteProject` (`backend/src/modules/streetview360/sv360.write.service.js:32-37`) e o gate replicado em `backend/src/modules/streetview360/sv360.routes.js:269`. Nenhuma rota de atlas, mapa, sync, imagem ou sharing lê `org_role`. Ver [[streetview-360]] e [[organizacoes-om]].

> **Nota histórica.** O guia *12-multiorg-identidade-auditoria* (absorvido) descrevia `org_role` como "capacidade de escrita dentro da OM", sugerindo um gate geral. O código contradiz: só o 360.

**Armadilha crítica: a OM não isola atlas.** A tabela `atlas` **não tem coluna `organization_id`**; ele só existe em `users` (`backend/src/database/migrations/001_core.sql:96`) e em `sv360.projects` (`backend/src/database/migrations/005_sv360.sql:16`). Logo, nenhuma listagem de atlas filtra por org, e um usuário de outra OM que receba um share tem acesso pleno ao nível compartilhado. Não desenhe telas, relatórios ou políticas assumindo tenancy de atlas por OM: não existe, e adicioná-la depois é migração de dados, não flag.

## O que atravessa arquivos e não aparece em nenhum

**A permissão do WebSocket não é imutável pela sessão.** O handshake congela `ws.permission`, mas `reconcileAuthorization` a re-resolve **a cada heartbeat** (`backend/src/modules/collab/collab.gateway.js:118-141`, disparado em `:160`): share revogado, atlas despublicado ou org desativada fecham o socket com 4003; um rebaixamento apenas rebaixa `ws.permission` e a próxima escrita é rejeitada. A janela de staleness é um heartbeat (~30s), não a vida do token. Ver [[canal-collab-websocket]].

**O `sub` não-UUID é um sinal semântico, não um detalhe de formato.** Token público carrega `sub` no formato `public-<uuid>` e isso é lido como bandeira em dois arquivos independentes: `backend/src/middleware/permissions.js:92` pula a consulta de shares, `backend/src/middleware/auth.js:80` pula a reconciliação com o banco (não há linha em `users` para reconciliar). **Contrato congelado:** trocar o formato do `sub` público por um UUID puro faz o visitante bater numa reconciliação impossível e quebra os dois caminhos de uma vez. Ver [[link-publico]].

**O frontend colapsa os três eixos num vocabulário só** (`UserRole`, alimentado pelo `role` do `connected`), mas guarda o bit de admin global separado em `_globalRole` (`frontend/src/js/store/sync/session-context.js:154-163`), preservado entre re-sets de papel por atlas. Não recompute "é admin" a partir do papel por atlas: `toFrontendRole` já achatou os dois em `admin` e a informação de origem se perde.

## Regras práticas para não errar

- Nunca derive capacidade de edição de atlas de `org_role`. Use `req.atlasPermission` no backend ou o `permission` do `connected` no cliente.
- Nunca assuma isolamento de atlas por OM.
- Rota nova de atlas: gateie no nível **mais baixo** que a operação exige e ponha o gate fino na service (padrão `assertOperationAllowed`, `backend/src/modules/sync/sync.service.js:633-653`), não na rota. É por isso que push de sync é gateado em `comment` e não em `write`.
- O gate de papel do cliente só vale para atlas remoto conectado (`frontend/src/js/store/sync/permission-guard.js:71`); o workspace local é sempre editável. Ver [[dominio-local-vs-remoto]] e [[modos-operacao]].
- A auditoria grava só um subconjunto das ações do CHECK; não conte com `PERMISSION_GRANT`/`SHARING_CHANGE` em todo fluxo. Ver [[auditoria]].
- Credencial chega por `x-api-key`, cookie `token` ou Bearer, e o middleware global **nunca bloqueia**: quem barra é a rota. Ver [[auth-flexivel]], [[api-keys]] e [[hardening-borda-api]].

## Páginas comparadas

[[permissoes-atlas]], [[sintese-capacidades-por-papel]], [[organizacoes-om]], [[autenticacao-jwt]], [[link-publico]], [[canal-collab-websocket]], [[erros-api]].
