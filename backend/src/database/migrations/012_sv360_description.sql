-- ============================================================================
-- 012 — sv360.projects ganha `description`
-- ============================================================================
-- O projeto 360 passou a ser editado como os outros recursos de catálogo (3D em
-- diante): um formulário com id, nome, DESCRIÇÃO, OM dona, visibilidade, thumbnail e
-- vídeo. As tabelas de catálogo guardam a descrição numa coluna própria; o 360 não a
-- tinha, então o formulário não teria onde gravá-la. Aditiva e NULL-ável: projeto
-- antigo continua sem descrição, que é o mesmo estado de quem nunca a escreveu.
ALTER TABLE sv360.projects ADD COLUMN IF NOT EXISTS description TEXT;

COMMENT ON COLUMN sv360.projects.description IS
  'Descrição livre do projeto 360, editável no painel (paralelo do 3D). NULL = sem descrição.';
