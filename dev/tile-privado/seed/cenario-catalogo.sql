-- O CATALOGO DE TESTE, no banco de CONFIGURACAO (ebgeo_zero).
--
-- Cada linha aqui existe para exercitar um ramo do gate por recurso decidido em
-- 2026-08-29 (seccao (f) de PENDENCIA-TILE-PRIVADO.md). O que ele precisa distinguir
-- nao e "publico contra privado": sao SETE situacoes, e seis delas so aparecem num
-- acervo com forma real.
--
-- OS IDENTIFICADORES COMECAM COM `t-` (de teste) para que nenhuma linha deste seed se
-- confunda com as duas linhas originais do ebgeo_zero, que ficam intactas.
--
-- AS SETE SITUACOES:
--
--   1. PUBLICA sob o prefixo deste host  -> passa sem credencial nenhuma (decisao 5).
--   2. PRIVADA sob o prefixo             -> decide pelo predicado de recurso.
--   3. PRIVADA de uma OM produtora       -> o ramo `fn_can_produce_resource`, que
--      separa `producer` de `user` e nao aparece em nenhum dos outros casos.
--   4. Com `labelSource`                 -> a SEGUNDA fonte da mesma linha, que a
--      pendencia nomeia como a armadilha de quem escrever "reescreve source.url".
--   5. Apontando para TERCEIRO           -> so pode ser publica (decisao 1). Esta linha
--      nasce publica de proposito, e o guarda que se vai escrever tem de RECUSAR 422
--      qualquer tentativa de torna-la privada.
--   6. Com ERRO DE DIGITACAO no endereco -> o caminho nao casa fonte nenhuma. Hoje ela
--      desenha nada e vaza nada; depois do gate ela e o caso que prova a decisao 4 pelo
--      lado do dado errado.
--   7. COLIDENTE                         -> duas linhas para a MESMA fonte do Martin,
--      uma publica e outra privada. A regra e que a privada vence, e ela precisa de um
--      par no ambiente porque nao se adivinha.
--
-- Mais a ESCALA: quarenta linhas geradas, metade privadas, para que o indice de regime,
-- o memo de decisao e o payload do endpoint aditivo sejam medidos com volume e nao com
-- duas linhas.

-- ---------------------------------------------------------------------------
-- Limpeza idempotente: este seed se aplica a qualquer momento.
-- ---------------------------------------------------------------------------
DELETE FROM data_layers     WHERE id LIKE 't-%';
DELETE FROM analysis_layers WHERE id LIKE 't-%';
DELETE FROM basemaps        WHERE id LIKE 't-%';

-- ---------------------------------------------------------------------------
-- 1 a 4, 7: camadas de dados com forma de dominio
-- ---------------------------------------------------------------------------
INSERT INTO data_layers (id, name, description, access_level, owner_org_id, config) VALUES
-- 1. PUBLICA
('t-hidrografia', 'Hidrografia', 'Situacao 1: publica sob o prefixo deste host', 'public', NULL,
 '{"source": {"url": "http://localhost/tiles/hidrografia", "type": "vector"}, "sourceLayer": "hidrografia", "minzoom": 4, "maxzoom": 18}'::jsonb),
('t-edificacoes', 'Edificacoes', 'Situacao 1', 'public', NULL,
 '{"source": {"url": "http://localhost/tiles/edificacoes", "type": "vector"}, "sourceLayer": "edificacoes", "minzoom": 4, "maxzoom": 18}'::jsonb),
('t-vegetacao', 'Vegetacao', 'Situacao 1', 'public', NULL,
 '{"source": {"url": "http://localhost/tiles/vegetacao", "type": "vector"}, "sourceLayer": "vegetacao", "minzoom": 4, "maxzoom": 18}'::jsonb),

-- 2. PRIVADA sob o prefixo
('t-areas-treinamento', 'Areas de treinamento', 'Situacao 2: privada, o caso central', 'private', NULL,
 '{"source": {"url": "http://localhost/tiles/areas_treinamento", "type": "vector"}, "sourceLayer": "areas_treinamento", "minzoom": 4, "maxzoom": 18}'::jsonb),
('t-pistas-pouso', 'Pistas de pouso', 'Situacao 2', 'private', NULL,
 '{"source": {"url": "http://localhost/tiles/pistas_pouso", "type": "vector"}, "sourceLayer": "pistas_pouso", "minzoom": 4, "maxzoom": 18}'::jsonb),

-- 3. PRIVADA de OM produtora (o owner_org_id e preenchido abaixo, a partir de `marcel`)
('t-limites-om', 'Limites de OM', 'Situacao 3: privada, produzida por uma OM', 'private', NULL,
 '{"source": {"url": "http://localhost/tiles/limites_om", "type": "vector"}, "sourceLayer": "limites_om", "minzoom": 4, "maxzoom": 18}'::jsonb),

-- 4. Com labelSource: DOIS enderecos na mesma linha, independentes
('t-curvas-nivel', 'Curvas de nivel', 'Situacao 4: source + labelSource, privada', 'private', NULL,
 '{"source": {"url": "http://localhost/tiles/curvas_nivel", "type": "vector"}, "labelSource": {"url": "http://localhost/tiles/pontos_cotados", "type": "vector"}, "sourceLayer": "curvas_nivel", "minzoom": 4, "maxzoom": 18}'::jsonb),

-- 5. TERCEIRO: so pode ser publica (decisao 1). O guarda tem de recusar torna-la privada.
('t-terceiro-publico', 'Camada de terceiro', 'Situacao 5: servidor alheio, so pode ser publica', 'public', NULL,
 '{"source": {"url": "https://tiles.exemplo.gov.br/dados/malha", "type": "vector"}, "sourceLayer": "malha", "minzoom": 4, "maxzoom": 14}'::jsonb),

-- 6. ERRO DE DIGITACAO: o endereco nao casa fonte nenhuma do Martin
('t-digitacao-errada', 'Heliportos (endereco errado)', 'Situacao 6: privada com endereco que nao existe', 'private', NULL,
 '{"source": {"url": "http://localhost/tiles/helipotros", "type": "vector"}, "sourceLayer": "heliportos", "minzoom": 4, "maxzoom": 18}'::jsonb),

-- 7. COLISAO: duas linhas para a MESMA fonte, uma publica e uma privada
('t-dutos-publico', 'Dutos (linha publica)', 'Situacao 7: colide com t-dutos-privado', 'public', NULL,
 '{"source": {"url": "http://localhost/tiles/dutos", "type": "vector"}, "sourceLayer": "dutos", "minzoom": 4, "maxzoom": 18}'::jsonb),
('t-dutos-privado', 'Dutos (linha privada)', 'Situacao 7: a privada tem de vencer', 'private', NULL,
 '{"source": {"url": "http://localhost/tiles/dutos", "type": "vector"}, "sourceLayer": "dutos", "minzoom": 4, "maxzoom": 18}'::jsonb);

-- A OM produtora vem do usuario `marcel`, que e o `producer` do banco copiado.
UPDATE data_layers
   SET owner_org_id = (SELECT producer_org_id FROM users WHERE username = 'marcel')
 WHERE id = 't-limites-om';

-- ---------------------------------------------------------------------------
-- A ESCALA: quarenta camadas, metade privadas
-- ---------------------------------------------------------------------------
INSERT INTO data_layers (id, name, description, access_level, config)
SELECT
    't-camada-' || lpad(i::text, 2, '0'),
    'Camada de escala ' || i::text,
    'Gerada para dar volume ao indice, ao memo e ao payload aditivo',
    CASE WHEN i % 2 = 0 THEN 'private' ELSE 'public' END,
    jsonb_build_object(
        'source', jsonb_build_object(
            'url', 'http://localhost/tiles/camada_' || lpad(i::text, 2, '0'),
            'type', 'vector'),
        'sourceLayer', 'camada_' || lpad(i::text, 2, '0'),
        'minzoom', 4, 'maxzoom', 18)
FROM generate_series(1, 40) AS i;

-- ---------------------------------------------------------------------------
-- ANALISE: raster, servido pelo mesmo prefixo, com o par publico/privado
-- ---------------------------------------------------------------------------
-- O raster NAO vem do Martin (ele serve vetor): vem de arquivos que o nginx publica sob
-- o mesmo prefixo `/tiles/`. Isso e proposital, e reproduz o que a producao faz: o
-- prefixo e um so, e atras dele ha mais de um servidor. Um gate que so soubesse falar
-- com o Martin deixaria a analise de fora.
INSERT INTO analysis_layers (id, name, description, access_level, config) VALUES
('t-declividade-publica', 'Declividade (publica)', 'Raster publico sob o prefixo', 'public',
 '{"source": {"url": "http://localhost/tiles/dem/{z}/{x}/{y}.png", "type": "raster-dem"}, "bounds": [-45, -23, -44, -22], "paint": {"raster-opacity": 0.7}}'::jsonb),
('t-relevo-restrito', 'Relevo restrito', 'Raster PRIVADO sob o prefixo', 'private',
 '{"source": {"url": "http://localhost/tiles/dem-restrito/{z}/{x}/{y}.png", "type": "raster-dem"}, "bounds": [-45, -23, -44, -22], "paint": {"raster-opacity": 0.7}}'::jsonb);

-- ---------------------------------------------------------------------------
-- BASEMAP: o endereco mora DENTRO do estilo, e ele e o campo mais trabalhoso
-- ---------------------------------------------------------------------------
-- `config.style` carrega N fontes, cada uma com `url` OU `tiles[]`. O indice tem de
-- descer no estilo em vez de ler um campo, e por isso ha um exemplar de cada forma.
INSERT INTO basemaps (id, name, description, access_level, config) VALUES
('t-carta-restrita', 'Carta restrita', 'Basemap PRIVADO, fonte por tiles[]', 'private',
 '{"enabled": true, "priority": 10, "style": {"version": 8, "sources": {"carta": {"type": "raster", "tiles": ["http://localhost/tiles/carta-restrita/{z}/{x}/{y}.png"], "tileSize": 256}}, "layers": [{"id": "carta", "type": "raster", "source": "carta"}]}}'::jsonb),
('t-mosaico-publico', 'Mosaico publico', 'Basemap publico, fonte por url (TileJSON)', 'public',
 '{"enabled": true, "priority": 11, "style": {"version": 8, "sources": {"mosaico": {"type": "vector", "url": "http://localhost/tiles/municipios"}}, "layers": []}}'::jsonb);

-- ---------------------------------------------------------------------------
-- O que ficou de pe, para o log da subida dizer em voz alta
-- ---------------------------------------------------------------------------
SELECT 'data_layers'     AS tabela, access_level, count(*) FROM data_layers     GROUP BY 1,2
UNION ALL
SELECT 'analysis_layers', access_level, count(*) FROM analysis_layers GROUP BY 1,2
UNION ALL
SELECT 'basemaps',        access_level, count(*) FROM basemaps        GROUP BY 1,2
ORDER BY 1, 2;
