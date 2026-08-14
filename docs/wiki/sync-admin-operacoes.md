# Administração do Log de Operações de Sync

Duas rotas admin por atlas (`backend/src/modules/sync/sync.routes.js:13-14`) podam a tabela `operations` e elevam `min_version`, trocando histórico de replay por espaço em disco.

## Por que existe e o que custa

A tabela `operations` ([[tabela-operations]]) cresce indefinidamente: todo push de [[envelope-operacao]] vira uma linha durável, e é dela que sai o pull incremental de [[snapshot-e-pull-incremental]]. Sem poda, o histórico de um atlas antigo vira o maior objeto do banco.

**Cleanup é irreversível e desloca custo, não o elimina.** O que some do disco reaparece como banda: todo cliente cujo `sinceVersion` cair abaixo do novo `min_version` passa a receber snapshot completo em vez de replay. Não é otimização gratuita, é uma troca deliberada.

## Armadilhas

**1. O gate é papel global, não papel no atlas.** `requireAdmin` (`backend/src/middleware/require-admin.js`) só olha `req.user.role`; as rotas admin de sync são as únicas do router de atlas que não usam `requireAtlasPermission`. Consequência: o dono de um atlas que não seja admin da plataforma **não** limpa o próprio log, e um admin global limpa qualquer atlas sem ser membro dele. É um eixo de permissão à parte de [[permissoes-atlas]]; ver [[sintese-eixos-de-permissao]].

**2. A ordem das rotas é load-bearing.** `/admin/stats` e `/admin/cleanup` precisam vir antes de `GET /:version`. Se `/:version` capturasse `admin`, o `parseInt` do controller daria `sinceVersion = 0` e um GET malformado devolveria o snapshot inteiro do atlas em vez de 404. Mover essas linhas para baixo abre um vazamento silencioso.

**3. `keepFromVersion: 0` é silenciosamente ignorado.** Zero é falsy no ternário do controller, então o caminho por dias assume com o `keepDays` que o Joi preencheu por default. Inofensivo na prática, porque 0 seria no-op de qualquer forma, mas quem depurar "por que meu corte 0 virou 7 dias" perde tempo aqui.

**4. `keepFromVersion` tem precedência e não tem clamp.** Enviar os dois campos faz `keepDays` ser ignorado no primeiro ramo de `cleanupOldOperations` (`backend/src/modules/sync/sync.service.js`), e nada impede um valor acima da `currentVersion`: o log é esvaziado e `min_version` fica **acima** da versão corrente, condenando todo cliente a snapshot em cada pull até que novas operações elevem `current_version`. Consulte `/admin/stats` antes e escolha entre `oldestOperationVersion` e `currentVersion`.

## Contratos de fronteira

- O delete é `server_version < corte` e o `min_version` recebe exatamente esse mesmo valor (`backend/src/modules/sync/sync.queries.js`). Logo `min_version` é a versão da operação mais antiga **sobrevivente**, não a última apagada.
- Um cliente exatamente em `sinceVersion === minVersion` **ainda recebe incremental**, porque o teste em `pullOperations` (`backend/src/modules/sync/sync.service.js`) é `sinceVersion < minVersion`. Trocar por `<=` transformaria o caso de borda mais comum (cliente em dia com o corte) em snapshot.
- Caminho por dias é auto-limitado: se nenhuma operação for mais nova que o cutoff, `cleanupOldOperations` retorna zerado **sem tocar em `min_version`**. É isso que impede um atlas parado há meses de ser zerado por engano; o caminho por versão não tem essa rede.

## Efeito que atravessa módulos

O cleanup não afeta só o pull REST. `sync_request` no [[canal-collab-websocket]] chama o mesmo `pullOperations` a partir de `handleSyncRequest` (`backend/src/modules/collab/collab.handlers.js`), então um corte agressivo transforma **reconexões por queda de rede** em downloads de snapshot inteiro. O cliente aplica isso via `applyRemoteSnapshot` ([[aplicacao-operacoes-remotas]]), que substitui estado local, e não via merge incremental de [[modelo-conflito-lww]].

Operações locais ainda na [[fila-operacoes-outbound]] não se perdem: sobem depois e recebem versões novas. A garantia de não duplicar continua sendo a de [[idempotencia-e-convergence-guard]], que não depende do histórico podado.

## Operação recomendada

- Prefira `keepDays` (7 a 30) a `keepFromVersion`, pelo motivo do terceiro item de *Contratos de fronteira*.
- Dimensione `keepDays` pela maior janela offline plausível do time. Abaixo dela, todo retorno de campo vira snapshot.
- Rode `/admin/stats` antes e depois. `currentVersion - oldestOperationVersion` é a janela de replay que ainda existe; `oldestOperationVersion - minVersion` mede histórico abaixo do corte.
- Não há agendador embutido: cron externo ([[deploy-backend]]).

## Superfície de UI: nenhuma

Nada em `src/` do cliente web referencia `sync/admin/stats` ou `sync/admin/cleanup` (grep vazio, inclusive em `store/sync/api-client.js`). O "botão de cleanup com confirmação" do guia é item **a implementar**. Hoje isto é HTTP direto ou ferramenta externa; para o que de fato existe no painel, ver [[gestao-usuarios]] e [[auditoria]].
