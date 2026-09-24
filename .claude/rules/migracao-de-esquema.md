---
paths:
  - "frontend/src/js/store/migration/**"
  - "frontend/src/js/store/atlas/atlas.entity.js"
---

# Adicionar uma migração de esquema

1. Criar `store/migration/v<from>-to-v<to>.migration.js`. Repare no nome real da
   função exportada: `migrateToV2_1`, `migrateToV2_2`, `migrateToV3_0`, com
   **underscore**, não `migrateToV21`. São QUATRO degraus: `v1-to-v2`, `v2-to-v2.1`,
   `v2.1-to-v2.2` e
   [`frontend/src/js/store/migration/v2.x-to-v3.0.migration.js`](../../frontend/src/js/store/migration/v2.x-to-v3.0.migration.js),
   este último com nome de origem CURINGA porque ele aceita qualquer repositório abaixo
   de 3.0. É ele que cria o registro de atlas locais e adota os bancos sem sufixo como
   slot #1; ver [atlas-namespace-e-tab-lock.md](atlas-namespace-e-tab-lock.md).
2. Em `migration.service.js`, importar e adicionar a chamada condicional dentro de
   `safelyMigrate()`. O encadeamento é por número de versão, não por registry.
3. **A migração recebe o ESCOPO como argumento**, e ignorar isso re-ancora o degrau
   nos nomes de banco pré-namespace, que podem não ser os do atlas montado. São dois
   alvos e dois trabalhos diferentes: `safelyMigrate(scope)` com o default
   `legacyScope()` é o upgrade da INSTALAÇÃO, e `migrateActiveSlot()` é o upgrade de
   UM SLOT namespaced. Ele sai cedo, com `reason` nomeado, antes mesmo de perguntar ao
   detector, em quatro casos e não três: sem escopo ativo (`'no-scope'`), escopo remoto
   (`'remote'`), escopo legado (`'pre-namespace'`) e slot virgem (`'empty'`). Os quatro
   degraus antigos já recebem o escopo; um novo que abra `localforage.createInstance`
   por nome fixo migra o banco errado em silêncio, e é isso que
   `frontend/tests/unit/repository-namespace.test.js` reprova. O guarda está FECHADO:
   `atlas-namespace.js` é o único chamador autorizado, a allowlist que abria exceção para
   estas quatro migrações saiu quando elas passaram a receber o escopo, e a varredura cobre
   `src/js` inteiro, não só o store. Exceção nova se escreve lá, com o motivo, na hora.
4. **Subir `ATLAS_SCHEMA_VERSION` (`frontend/src/js/store/atlas/atlas.entity.js`)**, hoje
   `'3.0'`. Este é o passo que falta com mais facilidade e falha em silêncio:
   `detectMigrationNeeded()` compara a versão do repositório com essa constante e devolve
   `needed: false` se ela não subiu, então `safelyMigrate()` nunca é chamado. A
   migração nova simplesmente não roda, sem erro. (Não existe `needsMigration`:
   quem procurar por esse nome não acha nada e conclui que o guarda não existe.)
5. Roda sozinha no próximo startup, pelos dois caminhos de `initializeRepository`.
