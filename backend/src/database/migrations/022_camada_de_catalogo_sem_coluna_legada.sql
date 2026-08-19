-- 022_camada_de_catalogo_sem_coluna_legada.sql
--
-- A coluna legada `maps.catalog_layers` sai do sistema. Depois desta migração a
-- camada de catálogo de um mapa mora em UM lugar só: a tabela dedicada
-- `catalog_layers`.
--
-- ---------------------------------------------------------------------------
-- POR QUE ELA MORRE, e por que a correção é estrutural e não um filtro
-- ---------------------------------------------------------------------------
--
-- A F11 tirou a desnormalização da camada de catálogo: a linha guarda REFERÊNCIA
-- (id prefixado + `type`) e ESTADO POR ATLAS (`visible`, `status`,
-- `styleOverrides`), e a DEFINIÇÃO (`name`, `config`, `config.source.url`) passou
-- a ser reidratada na leitura, pelo predicado de acesso de quem lê. Essa
-- reidratação mora dentro de `getAtlasSnapshot`, e a coluna legada tem OUTRAS
-- saídas que não passam por lá: `GET /atlas/:id/maps` e `GET /atlas/:id/maps/:id`
-- são `SELECT *` gateadas só em `read`, nível que o visitante de link público
-- tem, e `POST /maps/:id/duplicate` devolve a linha inteira do mapa novo. As três
-- entregavam a cópia crua, URL de recurso privado inclusive.
--
-- Filtrar a resposta das três protegeria as rotas que alguém LEMBROU. A coluna
-- continuaria de pé, servida pela próxima consulta que alguém escrevesse sobre
-- `maps`, e a mesma definição teria TRÊS superfícies de reidratação para manter
-- em acordo. Sem leitor, o dado não precisa de filtro: precisa não existir.
--
-- ---------------------------------------------------------------------------
-- QUE ELA NÃO TEM LEITOR, medido antes de apagar
-- ---------------------------------------------------------------------------
--
-- No frontend: uma única ocorrência de `catalog_layers` em `src/`, e é ESCRITA
-- (`import_export/local-atlas-to-server.js`, a carga de upload de atlas local).
-- `reshapeSnapshotMap` desestrutura `base_layer`/`notes_*`/`grid_style`/
-- `temporal_config`/`locked` e deixa a coluna cair em `...rest`, virando chave
-- inerte do documento; tudo que desenha lê `mapData.catalogLayers` (camelCase).
--
-- No backend: os leitores são internos e nenhum é resposta de rota. `clone`,
-- `duplicate` e `import` funde(m) a coluna com as linhas da tabela para
-- materializar a tabela (`catalogLayerRows`), e é isso que esta migração faz de
-- uma vez para o banco inteiro. O ramo de array de `applyCatalogLayerOp` passa a
-- escrever na tabela; nenhum cliente produz essa forma de op hoje.
--
-- A CHAVE DO PAYLOAD DE IMPORT NÃO MUDA: `POST /atlas/import` continua aceitando
-- `map.catalog_layers` (o schema Joi está intacto) e passa a materializá-la
-- direto na tabela. Nenhum cliente muda.
--
-- ---------------------------------------------------------------------------
-- A MATERIALIZAÇÃO, e por que a tabela vence
-- ---------------------------------------------------------------------------
--
-- `ON CONFLICT DO NOTHING` sobre a PK `(map_id, id)`: quando o mesmo id existe
-- nos dois lugares, a LINHA fica. É a mesma regra que `catalogLayerRows` já
-- aplica ("live rows win over the legacy array"), e a única defensável: a linha
-- carrega version/updated_at/deleted_at e é a que o snapshot vem servindo, então
-- ela é a versão que o usuário está vendo. O conflito alcança também a linha
-- soft-deletada, o que é o desejado: uma camada que o usuário REMOVEU não pode
-- ressuscitar porque a cópia legada nunca foi atualizada.
--
-- Mapas soft-deletados entram na varredura de propósito: a coluna deles some
-- junto, e o `deleted_at` do mapa é reversível enquanto o dado dele existir.
--
-- Entrada sem `id` é descartada: `catalog_layers.id` é NOT NULL e uma entrada sem
-- id não tem endereço nenhum, nem para o cliente (é o que
-- `catalogLayerReferenceId` chama de sem referência).

INSERT INTO catalog_layers (id, map_id, data)
SELECT item->>'id', m.id, item
FROM maps m
CROSS JOIN LATERAL jsonb_array_elements(m.catalog_layers) AS item
WHERE jsonb_typeof(m.catalog_layers) = 'array'
  AND jsonb_typeof(item) = 'object'
  AND item->>'id' IS NOT NULL
ON CONFLICT (map_id, id) DO NOTHING;

ALTER TABLE maps DROP COLUMN catalog_layers;
