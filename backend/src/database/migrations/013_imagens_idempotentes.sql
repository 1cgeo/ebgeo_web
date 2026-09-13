-- Deduplicacao de upload de imagem: identidade de TENTATIVA e identidade de CONTEUDO.
--
-- O problema que as duas colunas fecham e o mesmo visto de dois lados. Uma resposta perdida
-- depois de a gravacao ter acontecido nao deixa rastro no cliente, entao a retentativa e
-- indistinguivel de um envio novo: na rota unica ela criava uma SEGUNDA linha e um SEGUNDO
-- arquivo em disco, e na rota bulk (que preserva o id local como chave primaria) ela colidia na
-- PK e voltava como `failed` um upload que ja estava gravado.
--
-- `attempt_key` e a identidade da TENTATIVA, cunhada pelo cliente antes do primeiro byte sair.
-- Unica por atlas e so quando presente: o cliente antigo, a rota bulk e o clone de atlas seguem
-- gravando NULL, e varios NULL nao colidem num indice parcial.
--
-- `content_hash` e a identidade do CONTEUDO (sha256 hex dos bytes). O indice dela NAO e unico, e
-- isso e desenho: colar uma figura cunha um id NOVO para os MESMOS bytes de proposito, e um
-- unique aqui recusaria a colagem. Ela serve a duas leituras: reusar a linha existente na rota
-- unica quando nao houve chave de tentativa, e decidir, na colisao de PK da bulk, se o id que
-- colidiu guarda o MESMO conteudo (retentativa, aceitavel) ou outro (recusa com motivo).

ALTER TABLE images ADD COLUMN IF NOT EXISTS content_hash VARCHAR(64);
ALTER TABLE images ADD COLUMN IF NOT EXISTS attempt_key UUID;

-- Hex minusculo de 64 caracteres, para que um hash truncado ou em caixa alta nao passe a valer
-- como identidade de conteudo (dois hashes do mesmo blob em caixas diferentes nao se encontram).
-- Guardado por pg_constraint para que reaplicar o arquivo num banco que ja o recebeu nao aborte:
-- o migrador aplica cada arquivo uma vez, mas um banco de desenvolvimento recriado a meio caminho
-- nao tem essa garantia.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'images_content_hash_format'
    ) THEN
        ALTER TABLE images ADD CONSTRAINT images_content_hash_format
            CHECK (content_hash IS NULL OR content_hash ~ '^[0-9a-f]{64}$');
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_images_atlas_content_hash
    ON images(atlas_id, content_hash)
    WHERE content_hash IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_images_atlas_attempt_key
    ON images(atlas_id, attempt_key)
    WHERE attempt_key IS NOT NULL;
