-- Path: src/database/migrations/006_controlled_lists.sql
-- Admin-managed personnel domains, stored in the generic `resources` table:
--   * 'posto'               — military ranks (posto/graduação)
--   * 'organizacao_militar' — military organizations (OM)
-- Widens the resources.category CHECK to admit both, then seeds the canonical
-- Brazilian Army rank list (from dominio.tipo_posto_grad; nome_abrev kept in
-- config.abrev, code -> sort_order) plus a starter set of OMs that admins curate
-- from the panel. The signup form reads these from the public GET /api/v1/config.

ALTER TABLE resources DROP CONSTRAINT IF EXISTS resources_category_check;
ALTER TABLE resources ADD CONSTRAINT resources_category_check
  CHECK (category IN (
    'basemap', 'analysis_layer', 'data_layer', 'tileset', 'streetview_marker',
    'posto', 'organizacao_militar'
  ));

-- Postos / graduações (sort_order = code in dominio.tipo_posto_grad).
INSERT INTO resources (id, category, name, config, sort_order) VALUES
  ('posto-civ',    'posto', 'Civil',                  '{"abrev":"Civ"}',     1),
  ('posto-mot',    'posto', 'Mão de Obra Temporária', '{"abrev":"MOT"}',     2),
  ('posto-sdev',   'posto', 'Soldado EV',             '{"abrev":"Sd EV"}',   3),
  ('posto-sdep',   'posto', 'Soldado EP',             '{"abrev":"Sd EP"}',   4),
  ('posto-cb',     'posto', 'Cabo',                   '{"abrev":"Cb"}',      5),
  ('posto-3sgt',   'posto', 'Terceiro Sargento',      '{"abrev":"3º Sgt"}',  6),
  ('posto-2sgt',   'posto', 'Segundo Sargento',       '{"abrev":"2º Sgt"}',  7),
  ('posto-1sgt',   'posto', 'Primeiro Sargento',      '{"abrev":"1º Sgt"}',  8),
  ('posto-st',     'posto', 'Subtenente',             '{"abrev":"ST"}',      9),
  ('posto-asp',    'posto', 'Aspirante',              '{"abrev":"Asp"}',    10),
  ('posto-2ten',   'posto', 'Segundo Tenente',        '{"abrev":"2º Ten"}', 11),
  ('posto-1ten',   'posto', 'Primeiro Tenente',       '{"abrev":"1º Ten"}', 12),
  ('posto-cap',    'posto', 'Capitão',                '{"abrev":"Cap"}',    13),
  ('posto-maj',    'posto', 'Major',                  '{"abrev":"Maj"}',    14),
  ('posto-tc',     'posto', 'Tenente Coronel',        '{"abrev":"TC"}',     15),
  ('posto-cel',    'posto', 'Coronel',                '{"abrev":"Cel"}',    16),
  ('posto-genbda', 'posto', 'General de Brigada',     '{"abrev":"Gen Bda"}',17),
  ('posto-gendiv', 'posto', 'General de Divisão',     '{"abrev":"Gen Div"}',18),
  ('posto-genex',  'posto', 'General de Exército',    '{"abrev":"Gen Ex"}', 19)
ON CONFLICT (id) DO NOTHING;

-- Organizações militares (starter set; admins add/edit from the panel).
INSERT INTO resources (id, category, name, sort_order) VALUES
  ('om-dsg',   'organizacao_militar', 'Diretoria de Serviço Geográfico (DSG)',                       1),
  ('om-cigex', 'organizacao_militar', 'Centro de Imagens e Informações Geográficas do Exército (CIGEx)', 2),
  ('om-1cgeo', 'organizacao_militar', '1º Centro de Geoinformação (1º CGEO)',                        3),
  ('om-2cgeo', 'organizacao_militar', '2º Centro de Geoinformação (2º CGEO)',                        4),
  ('om-3cgeo', 'organizacao_militar', '3º Centro de Geoinformação (3º CGEO)',                        5),
  ('om-4cgeo', 'organizacao_militar', '4º Centro de Geoinformação (4º CGEO)',                        6),
  ('om-5cgeo', 'organizacao_militar', '5º Centro de Geoinformação (5º CGEO)',                        7)
ON CONFLICT (id) DO NOTHING;
