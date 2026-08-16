-- Path: src/database/migrations/016_atlas_cover.sql
-- Capa do atlas: a imagem que substitui as duas letras sobre cor no cartão da tela "Seus atlas".
--
-- TABELA À PARTE, e não coluna em `atlas`, por uma razão medida: `LIST_USER_ATLAS`,
-- `FIND_ATLAS_BY_ID` e o snapshot de sync fazem `SELECT a.*`, e quatro telas do cliente chamam
-- `listAtlas()` (o controle de conta, a aba Mapas, o nome do atlas e esta tela). Uma coluna de
-- imagem viajaria nas quatro por acidente. Aqui a capa só sai quando alguém a pede.
--
-- BYTEA, não a data URI que o cliente manda: o serviço decodifica na borda, confere o número
-- mágico contra o mime declarado (mesma regra do upload de imagem: png/jpeg/webp, SEM svg) e
-- guarda os bytes. Base64 no banco seria 33% maior e guardaria sem conferir.
--
-- Sem soft-delete: "Remover imagem" apaga a linha. A regra de nunca apagar de verdade vale para
-- entidade principal, e capa é atributo de apresentação, recriável em dois cliques.

CREATE TABLE atlas_covers (
    atlas_id    UUID PRIMARY KEY REFERENCES atlas(id) ON DELETE CASCADE,
    mime_type   VARCHAR(20) NOT NULL
                  CHECK (mime_type IN ('image/png', 'image/jpeg', 'image/webp')),
    bytes       BYTEA NOT NULL,
    width       INTEGER,
    height      INTEGER,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by  UUID REFERENCES users(id)
);

COMMENT ON TABLE atlas_covers IS
    'Capa (thumbnail) de um atlas. Uma linha por atlas, no máximo. O cliente reduz a imagem antes '
    'de enviar; o servidor limita o tamanho no schema Joi da rota.';
