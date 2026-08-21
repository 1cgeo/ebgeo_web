-- Path: src/database/migrations/011_sv360_piramide.sql
-- A PANORAMICA PASSA A EXISTIR EM PIRAMIDE DE TILES, e o metadado da escada vem para ca.
--
-- POR QUE ESTA MIGRACAO EXISTE. O acervo do ebgeo_360 aposentou `full_webp` e
-- `preview_webp`: 29 projetos tiveram os blobs apagados (64,6 GB liberados) e o que sobrou
-- foram 120,7 GB de tiles. A tabela `images` continua la, so sem as duas colunas de blob,
-- e a rota de imagem daquele lado responde 404 DE PROPOSITO. Este backend so sabia pedir
-- imagem inteira, entao, sem esta fase, todo acervo novo importado para ca chega sem
-- nenhuma fonte de pixel: a foto simplesmente nao pinta, sem erro em lugar nenhum.
--
-- O QUE FICA NO POSTGRES E O QUE NAO FICA. So o METADADO da escada. Os bytes do tile
-- seguem a mesma fronteira que os WebP ja seguiam neste modulo (o cabecalho da 007 diz
-- isso por extenso): SQLite por projeto, agora num segundo arquivo, `{orgId}__{slug}_tiles.db`,
-- lido pelo mesmo `blobPool` em worker. Trazer 120,7 GB de blob para dentro do Postgres
-- seria uma decisao PROPRIA, com custo proprio, e ninguem a tomou.
--
-- `razao` E `max_level` SAO CONTRATO, NAO ADORNO, e esta e a licao mais cara do lado que
-- gerou os tiles: a grade sai de (width, height, tile_size, razao), entao quem reconstruir
-- a escada com outra razao produz outras colunas e outras linhas. O sintoma seria tile
-- faltando, NUNCA um erro. Por isso a escada se GRAVA em vez de se assumir, e por isso o
-- leitor tem de ler `max_level` daqui em vez de recalcula-lo: um descritor calculado pela
-- regra de hoje sobre um banco escrito ontem atingiu 98.854 das 99.035 fotos do acervo.
--
-- DEFAULT 2 e o valor certo para o legado: as piramides que existem hoje foram geradas com
-- a escada classica de metades sucessivas.

-- ============================================================================
-- sv360.photo_pyramids — um registro por foto que tem piramide
-- ============================================================================
-- Espelha `tile_pyramids` do `{slug}_tiles.db` campo a campo, e a fidelidade e o ponto:
-- o descritor servido ao cliente e montado DESTA tabela, sem consultar o SQLite, para que
-- `tiles.json` custe uma consulta de metadado e nao a abertura de um arquivo de blob.
--
-- A PK e `photo_id` porque a relacao e 1-para-1: uma foto tem uma piramide ou nao tem.
-- Regerar substitui (ON CONFLICT DO UPDATE na ingestao), nunca acumula versao — quem
-- precisa saber que a escada mudou le `built_at` e `total_bytes`, que juntos formam a
-- assinatura do ETag do descritor.
--
-- ON DELETE CASCADE: apagada a foto, a escada dela nao tem sentido. O arquivo de tiles e
-- limpo pelo mesmo caminho que ja limpa o `{slug}.db` do projeto.
CREATE TABLE IF NOT EXISTS sv360.photo_pyramids (
    photo_id    TEXT PRIMARY KEY REFERENCES sv360.photos(id) ON DELETE CASCADE,
    tile_size   INTEGER NOT NULL,
    max_level   INTEGER NOT NULL,
    width       INTEGER NOT NULL,
    height      INTEGER NOT NULL,
    quality     INTEGER NOT NULL,
    tile_count  INTEGER NOT NULL,
    total_bytes BIGINT  NOT NULL,
    built_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    razao       REAL NOT NULL DEFAULT 2,

    -- Uma escada degenerada nao existe: sem estes CHECK, um registro com tile_size 0 ou
    -- razao 1 passaria e o cliente entraria num laco de niveis que nunca desce. A origem
    -- nao tem estes CHECK (SQLite), e e justamente por isso que eles entram aqui: este e
    -- o lado que RECEBE dado de fora.
    CONSTRAINT photo_pyramids_tile_size_positivo CHECK (tile_size > 0),
    CONSTRAINT photo_pyramids_dimensoes_positivas CHECK (width > 0 AND height > 0),
    CONSTRAINT photo_pyramids_max_level_nao_negativo CHECK (max_level >= 0),
    CONSTRAINT photo_pyramids_razao_maior_que_um CHECK (razao > 1),
    CONSTRAINT photo_pyramids_contagem_nao_negativa CHECK (tile_count >= 0 AND total_bytes >= 0)
);

-- A pergunta quente do ETL e da conferencia de ingestao e "quais fotos DESTE projeto tem
-- piramide?", e ela chega por project_id, nao por photo_id. Sem este indice a resposta
-- vira varredura da tabela inteira a cada projeto conferido.
CREATE INDEX IF NOT EXISTS idx_photo_pyramids_project
    ON sv360.photo_pyramids (photo_id)
    INCLUDE (max_level, tile_size, total_bytes);

COMMENT ON TABLE sv360.photo_pyramids IS
    'Metadado da piramide de tiles de uma foto 360. Os BYTES ficam em {orgId}__{slug}_tiles.db (SQLite), nunca aqui.';
COMMENT ON COLUMN sv360.photo_pyramids.razao IS
    'Razao entre niveis da escada. Contrato: a grade sai de (width, height, tile_size, razao), e reconstruir com outra razao produz tile faltando sem erro.';
COMMENT ON COLUMN sv360.photo_pyramids.max_level IS
    'Nivel mais fino GRAVADO. Leia daqui; recalcular pela regra de hoje sobre banco escrito ontem ja errou 98.854 de 99.035 fotos na origem.';
