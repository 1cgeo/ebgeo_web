-- ============================================================================
-- 014 — observabilidade: o erro do NAVEGADOR ganha tabela (`client_errors`)
-- ============================================================================
-- O incidente de 2026-08-30 tinha DUAS metades e o servidor só guardava uma. A metade do
-- backend virou o `.jsonl` diário (`src/utils/log-diario.js`); a do navegador continuava
-- existindo apenas no console de quem estava com a tela aberta, e foi por isso que a
-- evidência chegou como dezenove linhas coladas à mão numa conversa. Erro de cliente que
-- não sai do cliente não é registro, é testemunho.
--
-- POR QUE TABELA, e não mais uma linha no arquivo. O arquivo é sequencial e ótimo para
-- "o que aconteceu às 16h54"; esta pergunta é a oposta ("quais defeitos os navegadores
-- estão vendo, e quantas vezes"), que é agrupamento e ordenação. E há a razão de
-- robustez ao contrário da do arquivo: aqui o dado chega pela REDE, de um cliente que
-- pode estar em qualquer estado, então ele precisa de um teto de tamanho e de uma chave
-- de deduplicação, coisas que um append-only não tem.
--
-- A DECISÃO QUE MOLDA A TABELA É `UNIQUE (assinatura)`: a escrita é UPSERT e o que cresce
-- é `ocorrencias`, não a contagem de linhas. O defeito que originou tudo isto disparou
-- dezenove vezes em segundos, e um laço de render pode disparar milhares: inserir uma
-- linha por ocorrência transformaria a telemetria no segundo incidente, e o primeiro
-- sintoma seria o disco do Postgres. É a mesma decisão do agrupamento por assinatura em
-- `src/utils/diag-consulta.js`, tomada aqui na ESCRITA em vez da leitura.
--
-- A ASSINATURA VEM DO CLIENTE e NÃO AUTORIZA NADA. Ela é só a chave de agrupamento; quem
-- decide quem lê esta tabela é `requireAdmin`, e `user_id` vem do principal autenticado,
-- nunca do corpo. O teto de tamanho dela é imposto por Joi na borda (300 caracteres) e o
-- motivo é estrutural, não estético: uma chave única em btree recusa valores acima de
-- ~2.700 bytes, e sem o teto o modo de falha seria um 500 no caminho que existe para
-- registrar falhas.
--
-- `atlas_id` FICA SEM FK, DE PROPÓSITO. O atlas pode ser LOCAL (só existe no IndexedDB
-- daquele navegador, e nunca teve linha aqui) ou pode ter sido apagado depois do erro.
-- Uma FK faria a telemetria recusar exatamente os casos mais interessantes — o trabalho
-- offline e o que quebrou pouco antes de sumir.
--
-- `user_id` É `ON DELETE SET NULL`, e a assimetria com o resto da casa é deliberada. A
-- convenção "FK sem ON DELETE, reatribua antes do hard-delete" existe para DADO DE
-- TRABALHO (atlas, imagem, share), que não pode perder dono. Isto é telemetria: o erro
-- continua verdadeiro sem o autor, e uma FK bloqueante faria a exclusão de uma conta
-- falhar com 23503 por causa de um registro de diagnóstico, o que ninguém esperaria e
-- ninguém saberia desfazer.
CREATE TABLE IF NOT EXISTS client_errors (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assinatura   TEXT NOT NULL,
  mensagem     TEXT NOT NULL,
  stack        TEXT,
  url          TEXT,
  pagina       TEXT,
  user_agent   TEXT,
  release      TEXT,
  user_id      UUID REFERENCES users(id) ON DELETE SET NULL,
  atlas_id     UUID,
  ocorrencias  INT NOT NULL DEFAULT 1,
  primeira_em  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ultima_em    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT client_errors_assinatura_key UNIQUE (assinatura)
);

-- A listagem é sempre "os mais recentes primeiro, dentro de uma janela": é este índice
-- que a serve, e é o único acesso que a tabela tem.
CREATE INDEX IF NOT EXISTS idx_client_errors_ultima_em ON client_errors (ultima_em DESC);

COMMENT ON TABLE client_errors IS
  'Erro capturado no NAVEGADOR, agrupado por assinatura. Uma linha por defeito, não por ocorrência.';
COMMENT ON COLUMN client_errors.assinatura IS
  'Chave de agrupamento, cunhada pelo cliente. Agrupa e NADA MAIS: nunca serve de gate.';
COMMENT ON COLUMN client_errors.ocorrencias IS
  'Quantas vezes a assinatura chegou. Incrementada pelo UPSERT; é o que substitui N linhas.';
COMMENT ON COLUMN client_errors.atlas_id IS
  'Atlas em foco quando o erro ocorreu. SEM FK: o atlas pode ser local ou já ter sido apagado.';
COMMENT ON COLUMN client_errors.release IS
  'Versão do bundle que produziu o erro, para separar defeito vivo de defeito já corrigido.';
