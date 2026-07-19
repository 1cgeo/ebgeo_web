-- ============================================================================
-- 006 — catalog_layers.id passa de UUID para TEXT
-- ============================================================================
-- A coluna nasceu UUID com o comentario "layer id comes from the client", mas o
-- cliente e a autoridade sobre esse id e ele NUNCA e um UUID. O CatalogService
-- monta ids literais (frontend/src/js/catalog/catalog.service.js):
--
--     id: 'hillshade'                (:223)
--     id: `analysis-${layer.id}`     (:244)
--     id: `data-${layer.id}`         (:266)
--     id: `3d-${tileset.id}`         (:160)
--     id: `360-${p.id}`              (:192)
--
-- Esse valor vira o id da camada no store e viaja como entityId da operacao de
-- sync, e o handler inbound do cliente indexa mapData.catalogLayers por ele. Com
-- a coluna tipada UUID o INSERT levantava SQLSTATE 22P02 (mapeado para 400 pelo
-- error-handler). Como todo o push roda num unico tx(), o lote INTEIRO abortava,
-- inclusive as feicoes que viajavam junto, e a operacao permanecia na fila do
-- IndexedDB: todo flush seguinte remontava o mesmo lote e falhava igual. Era um
-- poison pill que matava a sincronizacao daquele cliente em definitivo.
--
-- TEXT e o tipo que o contrato do cliente sempre carregou. O mesmo raciocinio ja
-- foi aplicado onde o id tambem vem do cliente: operations.client_id e
-- operations.op_id sao TEXT (003_sync.sql:30,39) e sv360.photos.id e TEXT
-- (005_sv360.sql:35).
--
-- Nota sobre a convencao: as migracoes deste projeto sao declaradamente aditivas
-- (ADD COLUMN / CREATE TABLE / CREATE INDEX). Esta e uma excecao deliberada, e e
-- segura porque UUID -> TEXT e um alargamento: todo valor existente tem
-- representacao textual canonica, o USING e implicito, nenhuma linha e perdida e
-- nenhuma FK aponta para esta coluna. O caminho inverso (TEXT -> UUID) e que
-- seria destrutivo, e por isso nao ha down-migration (forward-only).
--
-- Regressao: tests/integration/sync-catalog-layer.test.js, bloco "real catalog
-- ids (non-UUID) round-trip". Controle negativo: revertendo este ALTER, os dois
-- testes falham com 400 "Malformed value (invalid id or type)".
-- ============================================================================

ALTER TABLE catalog_layers ALTER COLUMN id TYPE TEXT;

-- ============================================================================
-- E a chave primaria passa de (id) para (map_id, id).
-- ============================================================================
-- Consequencia direta do acima, e igualmente carregada. O id do cliente NAO e
-- globalmente unico: ele e uma constante do catalogo. Todo mapa que adicionar
-- "Sombreamento do Relevo" usa o mesmo id 'hillshade'. Com PRIMARY KEY (id), o
-- primeiro mapa a adicionar a camada ficava com a linha e todos os outros caiam
-- no ON CONFLICT (id) DO NOTHING em silencio: a camada sumia do segundo mapa em
-- diante, sem erro, e o push ainda era acked como sucesso.
--
-- Isso nunca apareceu porque toda a suite usava randomUUID() como id de camada,
-- e UUID e globalmente unico por construcao. O escopo real da unicidade sempre
-- foi (map_id, id), que e como as proprias queries de update e delete deste
-- modulo ja filtram (sync.service.js: WHERE id = $2 AND map_id = $3).
-- ============================================================================

ALTER TABLE catalog_layers DROP CONSTRAINT catalog_layers_pkey;
ALTER TABLE catalog_layers ADD CONSTRAINT catalog_layers_pkey PRIMARY KEY (map_id, id);
