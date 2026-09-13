-- Path: src/database/migrations/014_lote_logico.sql
-- O LOTE LOGICO: a identidade do GESTO que produziu varias operacoes.
--
-- O cliente carimba um `batchId` unico em toda op nascida do mesmo gesto (criar grupo com N
-- membros, combinar grupos, transferir camada, colar), na fabrica `createBatchOperations`. Ate
-- 2026-09-13 esse campo atravessava a validacao pelo `.unknown(true)` do schema de push e morria
-- ali: o servidor abria um savepoint POR OPERACAO, entao um membro recusado deixava o grupo
-- criado e os irmaos aplicados, e a resposta era 200. Aplicacao PARCIAL de um comando composto
-- era o desfecho normal, e nada no banco dizia quais linhas tinham nascido juntas.
--
-- A coluna e o que faz o lote sobreviver ao push: o recibo e o replay incremental passam a
-- carregar a que gesto cada op pertenceu, e uma investigacao consegue perguntar pelo gesto em vez
-- de reconstrui-lo por proximidade de `client_timestamp`.
--
-- NULA DE PROPOSITO, e a nulidade e a compatibilidade: op individual (a esmagadora maioria) nao
-- tem lote, cliente antigo nao carimba nada, e o marcador de exceção REST (merge, duplicacao,
-- clone, importacao) nasce no servidor sem gesto de cliente por tras. `UUID` e nao `TEXT` porque
-- a identidade vem de `generateUUID()` do cliente e o servidor so persiste o que casa com o
-- formato (`asUuidOrNull`, em `sync.service.js`): um carimbo malformado continua AGRUPANDO a
-- aplicacao, que e uma decisao em memoria, e apenas nao e gravado, em vez de derrubar o lote
-- inteiro com um 22P02 no INSERT.
ALTER TABLE operations ADD COLUMN IF NOT EXISTS batch_id UUID;

-- Parcial: quem pergunta pelo lote sempre da um `batch_id`, e a esmagadora maioria das linhas o
-- tem nulo (op individual), entao o indice cheio pagaria pela tabela toda para servir a minoria.
-- Por atlas porque nenhuma leitura de sync cruza atlas.
CREATE INDEX IF NOT EXISTS idx_operations_atlas_batch
    ON operations(atlas_id, batch_id)
    WHERE batch_id IS NOT NULL;
