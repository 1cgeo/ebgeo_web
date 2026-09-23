-- O AMBIENTE DO NAVEGADOR na telemetria (pedido do dono, 2026-09-23): em qual navegador, sistema
-- e máquina cada defeito aconteceu, e a distribuição de navegadores e sistemas entre as sessões.
--
-- Migração incremental, aditiva e idempotente: as bases estão congeladas desde 2026-09-22.
-- O vocabulário dos três CHECK abaixo é espelho de `backend/src/modules/uso/ambiente-do-navegador.js`
-- e de `frontend/src/js/session/ambiente-do-navegador.js`; valor novo entra nos três no mesmo commit.

-- 1. A OCORRÊNCIA guarda o ambiente em que ela aconteceu (navegador, sistema, tela, idioma, fuso,
-- núcleos, memória, WebGL, armazenamento). Forma fechada pelo Joi da rota anônima. Fica só na
-- ocorrência (no máximo vinte por defeito, podada com o defeito), nunca na linha agregada.
ALTER TABLE defeito_ocorrencias ADD COLUMN IF NOT EXISTS ambiente JSONB;

COMMENT ON COLUMN defeito_ocorrencias.ambiente IS
  'Ambiente do navegador naquele avistamento (familia e versao do navegador e do sistema, tela, '
  'idioma, fuso, nucleos, memoria, WebGL, armazenamento). Forma fechada por Joi na borda; NULL = '
  'o relato nao declarou (cliente anterior, ou defeito do servidor).';

-- 2. O DEFEITO guarda o CONJUNTO de famílias de navegador que já o relataram, desde o primeiro
-- relato. É o que responde "isto só acontece no Firefox?" na lista, sem abrir a gaveta.
ALTER TABLE defeitos ADD COLUMN IF NOT EXISTS navegadores TEXT[] NOT NULL DEFAULT '{}';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'defeitos_navegadores_check') THEN
    ALTER TABLE defeitos ADD CONSTRAINT defeitos_navegadores_check CHECK (
      navegadores <@ ARRAY['chrome', 'firefox', 'edge', 'safari', 'opera', 'outro']::text[]
    );
  END IF;
END $$;

COMMENT ON COLUMN defeitos.navegadores IS
  'Familias de navegador que ja relataram esta assinatura, acumuladas pelo UPSERT (uniao, nunca '
  'substituicao). Vazio = nenhum relato declarou (anterior ao campo, ou defeito do servidor).';

-- 3. A SESSÃO DE USO ganha a versão principal do navegador e a família do sistema. As duas são
-- dimensão de agrupamento, por isso versão PRINCIPAL e família, nunca o user-agent cru.
ALTER TABLE uso_sessoes ADD COLUMN IF NOT EXISTS navegador_versao INTEGER;
ALTER TABLE uso_sessoes ADD COLUMN IF NOT EXISTS so TEXT;

-- A coluna `navegador` já existia sem CHECK, e o Joi aceitava qualquer texto até 40 caracteres.
-- O cliente sempre mandou a família em minúsculas; o que vier diferente de uma rodada anterior é
-- normalizado antes de o CHECK fechar a coluna, senão a migração falharia num banco com dado.
UPDATE uso_sessoes
   SET navegador = CASE
         WHEN lower(navegador) IN ('chrome', 'firefox', 'edge', 'safari', 'opera', 'outro') THEN lower(navegador)
         ELSE 'outro'
       END
 WHERE navegador IS NOT NULL
   AND navegador NOT IN ('chrome', 'firefox', 'edge', 'safari', 'opera', 'outro');

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uso_sessoes_navegador_check') THEN
    ALTER TABLE uso_sessoes ADD CONSTRAINT uso_sessoes_navegador_check CHECK (
      navegador IS NULL OR navegador IN ('chrome', 'firefox', 'edge', 'safari', 'opera', 'outro')
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uso_sessoes_so_check') THEN
    ALTER TABLE uso_sessoes ADD CONSTRAINT uso_sessoes_so_check CHECK (
      so IS NULL OR so IN ('windows', 'macos', 'linux', 'chromeos', 'android', 'ios', 'outro')
    );
  END IF;
END $$;
