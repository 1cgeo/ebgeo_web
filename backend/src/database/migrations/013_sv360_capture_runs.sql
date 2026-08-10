-- Path: src/database/migrations/013_sv360_capture_runs.sql
-- sv360.capture_runs — as FAIXAS DE COLETA de um projeto 360.
--
-- Faixa de coleta = uma SESSÃO DE GRAVAÇÃO: uma corrida contínua do veículo, do
-- momento em que o operador iniciou a captura até parar.
--
-- POR QUE ESTA GRANULARIDADE: é a granularidade em que a calibração é constante,
-- porque é a granularidade em que a montagem da câmera não muda. Medido no
-- projeto `faxinal` da origem (o único com calibração real vinda de quaternion):
-- o desvio de mesh_rotation_y DENTRO da faixa é 0,60 grau, e o desvio das MÉDIAS
-- entre faixas é 8,40 (amplitude 316,4 a 344,0). Por isso "aplicar ao projeto" é
-- grosso demais: um valor único erra cerca de 20 graus nas faixas do outro
-- extremo.
--
-- A FRONTEIRA vem do identificador de sessão que o próprio equipamento gravou no
-- nome do arquivo, NÃO de um corte por intervalo de tempo. As fotos são
-- disparadas por distância (passo mediano 13,5 m), então um veículo parado num
-- semáforo produz um intervalo longo sem deslocamento nenhum, e um corte
-- temporal partiria a faixa ao meio no sinal vermelho.
--
-- `session_key` é namespaced por origem, para não colidir em projeto que mistura
-- os dois padrões de nome (blumenau, santiago, tubarao):
--   'mc:9468'                  de MULTICAPTURA_9468_005109
--   'ts:2026-05-05T16:46:57'   de PIC_20260427_090836_26_05_05_16_46_57_output_5
-- O prefixo é o que evita a colisão: sem ele, os dois padrões produziriam chaves
-- do mesmo formato para sessões diferentes.
--
-- `applied_rotation_*` é REGISTRO do último default aplicado, para a interface
-- poder dizer "faixa calibrada em 337 graus". NÃO é herança: o lote escreve
-- direto em sv360.photos, que continua sendo a única verdade da calibração.
--
-- `calibration_source` diz COMO o ângulo daquela foto foi obtido:
--   'sol'     o Sol foi detectado NESTA foto e entrou no ajuste;
--   'imu'     sem sol utilizável, refinada pela rajada do giroscópio;
--   'manual'  o revisor escreveu o ângulo, por foto, faixa ou projeto;
--   NULL      NÃO houve medida SOBRE esta foto: o ângulo veio do bloco da faixa
--             ou de interpolação entre vizinhas.
-- 'manual' sobrescreve os outros dois, porque mão humana derruba a origem
-- automática. A distinção importa na revisão: foto sem medida própria é a que
-- mais merece o olho, porque nada nela foi conferido contra o mundo.
--
-- A hora de captura vinda do time_img da fonte é o que dá ordem confiável DENTRO
-- da faixa: ordenar pelo número do quadro do nome funciona no corpo da
-- distribuição (passo p50 14,3 m / p90 18,0 m em santana) mas quebra na cauda
-- (p99 de 192 m e saltos de 2,3 km no AMAN). Ela mora em `sv360.photos.capture_date`,
-- que já existe desde 005_sv360.sql. Ver a nota no fim deste arquivo.
--
-- TRADUÇÃO DA ORIGEM (ebgeo_360 src/db/schema.sql, SQLite) para esta casa:
-- `id` e `project_id` viram UUID (aqui sv360.projects.id é UUID), `started_at`
-- vira TIMESTAMPTZ, e a FK do projeto ganha ON DELETE CASCADE
-- como as demais filhas de sv360.projects. As três colunas novas de sv360.photos
-- entram VAZIAS: quem as preenche é a derivação de faixas a partir do
-- original_name, nunca esta migração. Projeto com as colunas nulas continua
-- funcionando, porque "sem faixa" é o modo antigo.

CREATE TABLE sv360.capture_runs (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id         UUID NOT NULL REFERENCES sv360.projects(id) ON DELETE CASCADE,
    session_key        TEXT NOT NULL,
    label              TEXT NOT NULL,
    -- Início da sessão. Só os nomes PIC_ carregam a hora; nos MULTICAPTURA fica
    -- NULL até o time_img da fonte ser importado.
    started_at         TIMESTAMPTZ,
    -- Posição da faixa na lista do projeto, 1..N. Cronológica quando TODAS as
    -- faixas do projeto têm started_at; caso contrário por tamanho decrescente,
    -- porque os ids do MULTICAPTURA (9468, 4809, 0913) não são cronológicos.
    ordinal            INTEGER NOT NULL,
    photo_count        INTEGER NOT NULL DEFAULT 0,
    applied_rotation_y DOUBLE PRECISION,
    applied_rotation_x DOUBLE PRECISION,
    applied_rotation_z DOUBLE PRECISION,
    UNIQUE (project_id, session_key)
);

CREATE INDEX idx_sv360_capture_runs_project ON sv360.capture_runs(project_id, ordinal);

-- A faixa a que a foto pertence, e a posição dela dentro da faixa.
ALTER TABLE sv360.photos ADD COLUMN run_id       UUID REFERENCES sv360.capture_runs(id);
ALTER TABLE sv360.photos ADD COLUMN run_position INTEGER;

-- A hora de captura NÃO ganha coluna nova aqui, de propósito. A origem chama o
-- campo de `captured_at`, mas sv360.photos já tem `capture_date TIMESTAMPTZ`
-- desde 005_sv360.sql, e é o MESMO parâmetro: o instante em que esta foto foi
-- tirada. Duas colunas para uma medida só é defeito, não redundância útil.
--
-- Fica `capture_date`, porque é a que já está fiada de ponta a ponta: o upload
-- administrativo a escreve (INSERT_PHOTO, sv360.admin.queries.js), o manifesto a
-- aceita (sv360.admin.schemas.js) e a leitura a serve como `captureDate`
-- (sv360.service.js). `captured_at` não tinha escritor nem leitor.
--
-- Quem porta o ETL da origem mapeia `photos.captured_at` do index.db para
-- `sv360.photos.capture_date`. A tradução mora no ETL, não no schema.
ALTER TABLE sv360.photos ADD COLUMN calibration_source TEXT;

-- DEPOIS dos ALTER TABLE, nunca antes: as colunas só passam a existir nas linhas
-- acima, e um CREATE INDEX adiantado falharia com coluna inexistente.
CREATE INDEX idx_sv360_photos_run ON sv360.photos(run_id, run_position);
