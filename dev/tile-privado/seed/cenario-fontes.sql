-- AS FONTES QUE O MARTIN PUBLICA, no banco de DADOS (ebgeo_dados).
--
-- Este arquivo existe para que o gate por recurso possa ser desenvolvido contra um
-- acervo com a FORMA do real, e nao contra duas tabelas de demonstracao. O dono
-- informou que serao centenas de camadas de dados e analise, varias privadas, e a
-- escala muda decisoes: e ela que torna o cache da subrequisicao parte do desenho, e e
-- ela que inverte o default do caminho nao reivindicado (com endereco digitado a mao,
-- um erro de digitacao numa linha privada a publicaria em silencio).
--
-- O QUE CADA GRUPO EXISTE PARA EXERCITAR:
--
--   NOMEADAS: dez fontes com nome de dominio, para que o catalogo de teste tenha
--   linhas legiveis e para que uma falha diga QUAL camada falhou.
--
--   GERADAS (camada_01 .. camada_40): a escala. Quarenta fontes triviais que enchem o
--   indice de regime e o payload do endpoint aditivo. Sem elas o ambiente mede um
--   acervo de brinquedo e conclui que tudo cabe em memoria.
--
--   ORFA: `fonte_orfa` e publicada pelo Martin e NAO tem linha no catalogo. Ela e o
--   sujeito da decisao 4 (caminho nao reivindicado e RECUSADO): hoje ela sai para
--   qualquer um, e depois do gate ela tem de parar de sair. Sem uma fonte assim no
--   ambiente, essa decisao nao teria como ser medida.
--
--   COLIDENTE: `dutos` recebe DUAS linhas de catalogo no seed do catalogo, uma publica
--   e outra privada, para exercitar a regra de colisao (privado vence). Aqui ela e uma
--   fonte so; a colisao mora no catalogo, que e onde ela nasce de verdade.
--
-- A geometria nao e o sujeito: todas caem na mesma janela (-45..-44, -23..-22) para que
-- um z/x/y unico sirva a qualquer uma nas medicoes.

CREATE EXTENSION IF NOT EXISTS postgis;

-- ---------------------------------------------------------------------------
-- Fontes NOMEADAS, com forma de dominio
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    nome text;
    nomes text[] := ARRAY[
        'hidrografia', 'edificacoes', 'vegetacao', 'curvas_nivel', 'pontos_cotados',
        'limites_om', 'areas_treinamento', 'pistas_pouso', 'dutos', 'heliportos',
        'fonte_orfa'
    ];
    i int;
BEGIN
    FOREACH nome IN ARRAY nomes LOOP
        EXECUTE format('DROP TABLE IF EXISTS %I CASCADE', nome);
        EXECUTE format(
            'CREATE TABLE %I (id serial PRIMARY KEY, nome text NOT NULL, geom geometry(Point,4326) NOT NULL)',
            nome);
        FOR i IN 1..25 LOOP
            EXECUTE format(
                'INSERT INTO %I (nome, geom) VALUES ($1, ST_SetSRID(ST_MakePoint($2, $3), 4326))',
                nome)
            USING nome || ' ' || i::text,
                  -45.0 + (i % 5) * 0.2,
                  -23.0 + (i / 5) * 0.2;
        END LOOP;
        EXECUTE format('CREATE INDEX ON %I USING GIST (geom)', nome);
    END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- Fontes GERADAS: a escala
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    nome text;
    i int;
    j int;
BEGIN
    FOR i IN 1..40 LOOP
        nome := 'camada_' || lpad(i::text, 2, '0');
        EXECUTE format('DROP TABLE IF EXISTS %I CASCADE', nome);
        EXECUTE format(
            'CREATE TABLE %I (id serial PRIMARY KEY, nome text NOT NULL, geom geometry(Point,4326) NOT NULL)',
            nome);
        FOR j IN 1..10 LOOP
            EXECUTE format(
                'INSERT INTO %I (nome, geom) VALUES ($1, ST_SetSRID(ST_MakePoint($2, $3), 4326))',
                nome)
            USING nome || ' ' || j::text,
                  -45.0 + (j % 5) * 0.2 + (i % 3) * 0.05,
                  -23.0 + (j / 5) * 0.2 + (i % 3) * 0.05;
        END LOOP;
        EXECUTE format('CREATE INDEX ON %I USING GIST (geom)', nome);
    END LOOP;
END $$;

SELECT count(*) AS fontes_publicadas_pelo_martin
FROM information_schema.tables
WHERE table_schema = 'public' AND table_type = 'BASE TABLE';
