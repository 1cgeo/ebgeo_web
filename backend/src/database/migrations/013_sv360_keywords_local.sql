-- ============================================================================
-- 013 — sv360.projects ganha `keywords` e `location`
-- ============================================================================
-- O projeto 360 é recurso de catálogo como o 3D, e o cartão do catálogo do cliente já LÊ
-- `keywords`, `location`, `captureDate` e `center` de um projeto 360 (`_getPanoramic360` em
-- `frontend/src/js/catalog/catalog.service.js`). `capture_date`, `center_lat` e `center_long` já
-- eram colunas; faltavam `keywords` (palavras-chave, para a busca do catálogo) e `location` (o
-- "local", cidade/estado). Aditivas e NULL-áveis: projeto antigo continua sem elas, que é o mesmo
-- estado de quem nunca as escreveu.
--
-- `keywords` é ARRAY de texto porque o cartão itera sobre ela (`item.keywords.some(...)`), o mesmo
-- formato do `keywords` do 3D no catálogo.
ALTER TABLE sv360.projects ADD COLUMN IF NOT EXISTS keywords TEXT[];
ALTER TABLE sv360.projects ADD COLUMN IF NOT EXISTS location TEXT;

COMMENT ON COLUMN sv360.projects.keywords IS
  'Palavras-chave do projeto 360, para a busca do catálogo. Paralelo do keywords do 3D. NULL = nenhuma.';
COMMENT ON COLUMN sv360.projects.location IS
  'Local do projeto 360 (cidade, estado), exibido no cartão do catálogo. NULL = sem local.';
