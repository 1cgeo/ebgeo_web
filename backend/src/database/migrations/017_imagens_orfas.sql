-- A COLETA DE IMAGEM ÓRFÃ (decisão do dono em 2026-09-24): a marca de quando uma linha de
-- `images` ficou sem referência, o gatilho que a zera quando uma referência aparece ou some, e a
-- ação de trilha da remoção. Nada aqui apaga coisa alguma: quem apaga é a coleta
-- (`src/modules/images/imagens-orfas.service.js`), com bandeira explícita e sob a carência.
--
-- Migração incremental. As fontes de referência, a regra de vida de cada uma e as carências moram
-- em `src/modules/images/imagens-orfas.fontes.js`; o censo que exige tabela nova classificada e
-- gatilho em toda tabela-fonte é `tests/integration/imagens-orfas-censo.test.js`.

-- ---------------------------------------------------------------------------------------------
-- A MARCA. Nula = citada, ou ainda não vista sem citação por uma rodada. Preenchida = a primeira
-- rodada que viu a imagem sem citação, desde então sem citação nenhuma. A imagem só pode ser
-- apagada com a marca mais velha que a carência (e o `created_at` também).
-- ---------------------------------------------------------------------------------------------
ALTER TABLE images ADD COLUMN sem_referencia_desde TIMESTAMPTZ;

-- Parcial de propósito: a checagem barata do gatilho ("existe alguma marca?") e o recorte da
-- coleta leem só as marcadas, que são a exceção.
CREATE INDEX idx_images_sem_referencia
    ON images(sem_referencia_desde)
    WHERE sem_referencia_desde IS NOT NULL;

-- ---------------------------------------------------------------------------------------------
-- O GATILHO QUE ZERA A MARCA. A rodada é manual e rara, e só ela não enxergaria uma referência que
-- APARECE e SOME entre duas rodadas: marcada no dia 0, citada do dia 5 ao 15, a rodada do dia 31
-- apagaria uma imagem sem referência havia 16 dias. Toda escrita numa tabela-fonte cujo texto
-- ANTIGO ou NOVO cite uma imagem marcada zera a marca dela, e a contagem recomeça na rodada
-- seguinte. O lado ANTIGO fecha a corrida com a própria rodada: uma marca escrita a partir de um
-- retrato que ainda não via a citação é zerada quando a citação é REMOVIDA.
--
-- O padrão de UUID é o de `PADRAO_DE_UUID` (`src/modules/images/imagens-orfas.fontes.js`), e o
-- censo compara os dois.
--
-- UMA FALHA AQUI NUNCA DERRUBA A ESCRITA DO USUÁRIO: vira WARNING no log do Postgres. O custo de
-- uma falha calada é perder uma zerada, e a janela de operações da coleta é o cinto que a cobre
-- para tudo que chega por sync. A checagem de existência de marca fica FORA do bloco de exceção,
-- para que o caso comum (nenhuma imagem marcada) não pague o subtransação do EXCEPTION.
-- ---------------------------------------------------------------------------------------------
CREATE FUNCTION zerar_marca_de_imagem_citada()
RETURNS TRIGGER AS $$
DECLARE
    texto TEXT := '';
BEGIN
    IF NOT EXISTS (SELECT 1 FROM images WHERE sem_referencia_desde IS NOT NULL) THEN
        RETURN NULL;
    END IF;
    BEGIN
        IF TG_OP IN ('INSERT', 'UPDATE') THEN
            texto := texto || to_jsonb(NEW)::text;
        END IF;
        IF TG_OP IN ('UPDATE', 'DELETE') THEN
            texto := texto || ' ' || to_jsonb(OLD)::text;
        END IF;
        UPDATE images SET sem_referencia_desde = NULL
         WHERE sem_referencia_desde IS NOT NULL
           AND id IN (
               SELECT lower(m[1])::uuid
                 FROM regexp_matches(
                          texto,
                          '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}',
                          'g') AS m
           );
    EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'zerar_marca_de_imagem_citada em %: % (%)', TG_TABLE_NAME, SQLERRM, SQLSTATE;
    END;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Uma por tabela-fonte (a lista de `FONTES_DE_REFERENCIA`). O censo confere que toda fonte tem a
-- sua, e que nenhuma sobra.
CREATE TRIGGER trg_zerar_marca_de_imagem_citada AFTER INSERT OR UPDATE OR DELETE ON features
    FOR EACH ROW EXECUTE FUNCTION zerar_marca_de_imagem_citada();
CREATE TRIGGER trg_zerar_marca_de_imagem_citada AFTER INSERT OR UPDATE OR DELETE ON cesium3d_data
    FOR EACH ROW EXECUTE FUNCTION zerar_marca_de_imagem_citada();
CREATE TRIGGER trg_zerar_marca_de_imagem_citada AFTER INSERT OR UPDATE OR DELETE ON streetview360_data
    FOR EACH ROW EXECUTE FUNCTION zerar_marca_de_imagem_citada();
CREATE TRIGGER trg_zerar_marca_de_imagem_citada AFTER INSERT OR UPDATE OR DELETE ON atlas
    FOR EACH ROW EXECUTE FUNCTION zerar_marca_de_imagem_citada();
CREATE TRIGGER trg_zerar_marca_de_imagem_citada AFTER INSERT OR UPDATE OR DELETE ON maps
    FOR EACH ROW EXECUTE FUNCTION zerar_marca_de_imagem_citada();
CREATE TRIGGER trg_zerar_marca_de_imagem_citada AFTER INSERT OR UPDATE OR DELETE ON briefings
    FOR EACH ROW EXECUTE FUNCTION zerar_marca_de_imagem_citada();
CREATE TRIGGER trg_zerar_marca_de_imagem_citada AFTER INSERT OR UPDATE OR DELETE ON slides
    FOR EACH ROW EXECUTE FUNCTION zerar_marca_de_imagem_citada();
CREATE TRIGGER trg_zerar_marca_de_imagem_citada AFTER INSERT OR UPDATE OR DELETE ON comments
    FOR EACH ROW EXECUTE FUNCTION zerar_marca_de_imagem_citada();
CREATE TRIGGER trg_zerar_marca_de_imagem_citada AFTER INSERT OR UPDATE OR DELETE ON layers
    FOR EACH ROW EXECUTE FUNCTION zerar_marca_de_imagem_citada();
CREATE TRIGGER trg_zerar_marca_de_imagem_citada AFTER INSERT OR UPDATE OR DELETE ON groups
    FOR EACH ROW EXECUTE FUNCTION zerar_marca_de_imagem_citada();
CREATE TRIGGER trg_zerar_marca_de_imagem_citada AFTER INSERT OR UPDATE OR DELETE ON catalog_layers
    FOR EACH ROW EXECUTE FUNCTION zerar_marca_de_imagem_citada();
CREATE TRIGGER trg_zerar_marca_de_imagem_citada AFTER INSERT OR UPDATE OR DELETE ON operations
    FOR EACH ROW EXECUTE FUNCTION zerar_marca_de_imagem_citada();

-- ---------------------------------------------------------------------------------------------
-- A TRILHA DA REMOÇÃO. `IMAGE_ORPHAN_PURGE`, uma linha por atlas e por rodada, com alvo o ATLAS e,
-- em `details`, os ids, os nomes e os bytes. O CHECK é REDECLARADO INTEIRO (a armadilha de sempre:
-- um valor esquecido aqui faria o banco recusar uma ação que o código já emite), e ele só ALARGA:
-- toda ação aceita antes continua aceita, e nenhuma linha existente é tocada. O censo de auditoria
-- e o de rótulos da aba lêem o CHECK da migração mais recente que o declara.
-- ---------------------------------------------------------------------------------------------
ALTER TABLE audit_trail DROP CONSTRAINT IF EXISTS audit_trail_action_check;
ALTER TABLE audit_trail ADD CONSTRAINT audit_trail_action_check CHECK (action IN (
                  'LOGIN','LOGOUT','USER_CREATE','USER_UPDATE','USER_DELETE',
                  'PASSWORD_RESET','API_KEY_ROTATE','ROLE_CHANGE',
                  'ORG_CREATE','ORG_UPDATE','ORG_DELETE',
                  'ATLAS_DELETE','SHARING_CHANGE','PERMISSION_GRANT','PERMISSION_REVOKE',
                  'ATLAS_CREATE','ATLAS_RESTORE','ATLAS_TRANSFER',
                  'CATALOG_CREATE','CATALOG_UPDATE','CATALOG_DELETE',
                  'CONFIG_UPDATE','CONFIG_CLEAR',
                  'PRODUCER_SCOPE_CHANGE',
                  'SV360_INGEST','SV360_DELETE','SV360_STATUS_CHANGE',
                  'PERMISSION_PURGE',
                  'USER_REACTIVATE',
                  'ACCESS_GROUP_CREATE','ACCESS_GROUP_UPDATE','ACCESS_GROUP_DELETE',
                  'ACCESS_GROUP_MEMBER_ADD','ACCESS_GROUP_MEMBER_REMOVE',
                  'PERMISSION_REPARENT',
                  'RANK_CREATE','RANK_UPDATE','RANK_DELETE',
                  'API_KEY_CREATE','API_KEY_REVOKE',
      'DEFEITO_ESTADO',
      'IMAGE_ORPHAN_PURGE'
));
