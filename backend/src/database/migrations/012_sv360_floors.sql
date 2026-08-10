-- Path: src/database/migrations/012_sv360_floors.sql
-- sv360.project_floors + sv360.photos.floor_label — os ANDARES de um projeto 360.
--
-- POR QUE UMA TABELA, e não uma marca no projeto: o andar é propriedade da FOTO,
-- não do projeto. O Beira-Rio tem 6 andares MAIS duas áreas externas no mesmo
-- levantamento, então um campo único no projeto não descreveria o dado. A tabela
-- guarda a LISTA de andares e a planta de cada um; a foto guarda em que andar
-- ela está (`floor_level`) e como aquele andar se chama na tela (`floor_label`).
--
-- QUEM DECIDE QUE UM PROJETO TEM ANDARES é a EXISTÊNCIA de linhas em
-- sv360.project_floors, nunca o valor de `floor_level`. É a única coisa que a
-- interface consulta para decidir se desenha o seletor de andar, o que deixa
-- todo projeto externo já ingerido sem nenhum efeito colateral.
--
-- SEMÂNTICA DO NÍVEL (decisão do chefe, registrada aqui porque é a régua que
-- todo consumidor tem de aplicar):
--   nível  0  = TÉRREO (o chão: externo, pátio, campo, e todo espaço interno no
--               nível do solo);
--   nível  1  = PRIMEIRO ANDAR INTERNO (o primeiro nível acima do térreo);
--   nível <0  = SUBSOLO (-1 é o primeiro subsolo).
-- O nível é um INTEIRO ORDENÁVEL porque o seletor da interface empilha os
-- andares de cima para baixo; o rótulo é só o que a tela mostra.
--
-- RÓTULO PADRÃO, copiado de `scripts/lib/floors.js:defaultFloorLabel` do
-- repositório de origem (ebgeo_360), para o nível cujo rótulo próprio não está
-- à mão:
--   level === 0  -> 'Térreo'
--   level  <  0  -> `${-level}º subsolo`
--   level  >  0  -> `${level}º andar`
-- A origem também traduz o vocabulário de campo ('área externa' -> 'Externo',
-- 'campo de futebol' -> 'Campo', 'pátio' -> 'Pátio'), por isso `label` é uma
-- coluna e não uma expressão derivada do nível: dois espaços no MESMO nível
-- podem ter nomes diferentes na tela.
--
-- DIVERGÊNCIA CONHECIDA COM A ORIGEM, registrada e NÃO resolvida aqui:
--   aqui  (005_sv360.sql:50) sv360.photos.floor_level INTEGER NOT NULL DEFAULT 0
--   lá    (ebgeo_360 src/db/schema.sql) photos.floor_level INTEGER DEFAULT 1
-- Os dois defaults nomeiam o MESMO andar com números diferentes, e o acervo já
-- carregado por scripts/sv360-import.js pode estar todo num nível só. Esta
-- migração NÃO escreve nenhum UPDATE de backfill: corrigir o dado exige medir o
-- acervo real de produção antes, e é passo separado. A migração é aditiva e
-- forward-only, então nada existente muda de valor.
--
-- `plan_coords` é JSONB por decisão do chefe. A origem guarda TEXT com JSON
-- dentro, porque o SQLite não tem tipo melhor; o Postgres tem, e JSONB valida a
-- forma na escrita. O conteúdo é uma lista de LineStrings,
-- [[[lon,lat],...],...], no mesmo padrão de project_tracks.coords da origem.
-- NULL vale para o nível que existe mas não tem planta desenhada, que é o caso
-- do nível 0 (externo) do Beira-Rio. Não é geometria PostGIS porque o consumo é
-- sempre "devolva a planta inteira deste andar", nunca consulta espacial sobre
-- os vértices.

-- Rótulo do andar DESTA foto. Entra NULO, e só um projeto com andares o
-- preenche: num projeto externo ele fica nulo para sempre, que é o correto,
-- porque não há andar para nomear.
ALTER TABLE sv360.photos ADD COLUMN floor_label TEXT;

CREATE TABLE sv360.project_floors (
    project_id  UUID    NOT NULL REFERENCES sv360.projects(id) ON DELETE CASCADE,
    level       INTEGER NOT NULL,
    label       TEXT    NOT NULL,
    plan_coords JSONB,
    PRIMARY KEY (project_id, level)
);

-- Filtro de andar dentro de um projeto (o seletor da interface, e o recorte por
-- andar da consulta de vizinhança). Sem ele o filtro vira varredura sobre todas
-- as fotos do projeto.
CREATE INDEX idx_sv360_photos_floor ON sv360.photos(project_id, floor_level);
