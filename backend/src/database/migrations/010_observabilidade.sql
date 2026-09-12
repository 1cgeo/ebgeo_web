-- Diagnostic defects and bounded occurrence evidence, in their final schema.
CREATE TABLE IF NOT EXISTS defeitos (
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
  sessao_id   UUID,
  stack_bruta TEXT,
  origem      TEXT,
  contexto    JSONB,
  estado               TEXT NOT NULL DEFAULT 'aberto',
  resolvido_em         TIMESTAMPTZ,
  resolvido_por        UUID REFERENCES users(id) ON DELETE SET NULL,
  resolvido_na_release TEXT,
  resolvido_no_commit  TEXT,
  primeira_release     TEXT,
  ultima_release       TEXT,
  CONSTRAINT defeitos_estado_check CHECK (
    estado IN ('aberto', 'resolvido', 'ignorado', 'regrediu')
  ),
  CONSTRAINT defeitos_resolvido_no_commit_check CHECK (
    resolvido_no_commit IS NULL OR length(resolvido_no_commit) <= 64
  ),
  CONSTRAINT defeitos_origem_check CHECK (
    origem IS NULL OR origem IN (
      'boot', 'nao-tratado', 'rejeicao', 'console', 'store',
      'ws', 'maplibre', 'cesium', 'sv360', 'indisponivel', 'servidor'
    )
  ),
  CONSTRAINT defeitos_assinatura_key UNIQUE (assinatura)
);

CREATE INDEX IF NOT EXISTS idx_defeitos_ultima_em ON defeitos (ultima_em DESC);

COMMENT ON TABLE defeitos IS
  'Erro capturado no NAVEGADOR, agrupado por assinatura. Uma linha por defeito, não por ocorrência.';
COMMENT ON COLUMN defeitos.assinatura IS
  'Chave de agrupamento, cunhada pelo cliente. Agrupa e NADA MAIS: nunca serve de gate.';
COMMENT ON COLUMN defeitos.ocorrencias IS
  'Quantas vezes a assinatura chegou. Incrementada pelo UPSERT; é o que substitui N linhas.';
COMMENT ON COLUMN defeitos.atlas_id IS
  'Atlas em foco quando o erro ocorreu. SEM FK: o atlas pode ser local ou já ter sido apagado.';
COMMENT ON COLUMN defeitos.release IS
  'Versão do bundle que produziu o erro, para separar defeito vivo de defeito já corrigido.';

COMMENT ON COLUMN defeitos.sessao_id IS
  'Aba do navegador que produziu o erro (X-EBGeo-Sessao). SEM FK: e identidade do CLIENTE.';
COMMENT ON COLUMN defeitos.stack_bruta IS
  'Pilha ANTES da normalizacao da assinatura: e a que ainda aponta arquivo e linha do bundle.';
COMMENT ON COLUMN defeitos.origem IS
  'Por qual porta o erro entrou no coletor do cliente. Vocabulario fechado, espelhado em '
  'src/modules/diag/origens-de-erro.js. NULL = o relato nao declarou.';
COMMENT ON COLUMN defeitos.contexto IS
  'Estado do app no instante do erro (atlasKind, conexao, causa, camada, status). Forma '
  'fechada por Joi na borda; JSONB porque o conjunto util ainda esta sendo descoberto.';

CREATE TABLE IF NOT EXISTS defeito_ocorrencias (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  defeito_id  UUID NOT NULL REFERENCES defeitos(id) ON DELETE CASCADE,
  em          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  release     TEXT,
  sessao_id   UUID,
  user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  pagina      TEXT,
  url         TEXT,
  user_agent  TEXT,
  origem      TEXT,
  migalhas    JSONB,
  contexto    JSONB,
  req_id      TEXT,
  rota        TEXT,
  status_code INT,
  CONSTRAINT defeito_ocorrencias_origem_check CHECK (
    origem IS NULL OR origem IN (
      'boot', 'nao-tratado', 'rejeicao', 'console', 'store',
      'ws', 'maplibre', 'cesium', 'sv360', 'indisponivel', 'servidor'
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_defeito_ocorrencias_defeito_em
  ON defeito_ocorrencias (defeito_id, em DESC);

COMMENT ON TABLE defeitos IS
  'Defeito agrupado por assinatura, do navegador OU do servidor. Uma linha por defeito, nao por ocorrencia.';
COMMENT ON COLUMN defeitos.estado IS
  'Ciclo de vida: aberto | resolvido | ignorado | regrediu. Vocabulario fechado, espelhado em src/modules/diag/estados-de-defeito.js.';
COMMENT ON COLUMN defeitos.resolvido_na_release IS
  'A build em que o defeito foi dado por resolvido. E ela que decide REGRESSAO: ocorrencia numa release diferente desta reabre como regrediu; na mesma, e bundle velho em cache.';
COMMENT ON COLUMN defeitos.primeira_release IS
  'A build do PRIMEIRO avistamento. Le-se junto com stack_bruta, que tambem fica fixa na primeira.';
COMMENT ON COLUMN defeitos.ultima_release IS
  'A build do avistamento mais recente. Com primeira_release, responde "apareceu na v2 e sumiu na v4".';
COMMENT ON TABLE defeito_ocorrencias IS
  'Evidencias individuais de um defeito, no maximo 20 por defeito (teto imposto pela escrita, ver DELETE_OCORRENCIAS_EXCEDENTES).';
COMMENT ON COLUMN defeito_ocorrencias.migalhas IS
  'O rastro dos ultimos passos antes do erro (breadcrumbs). Forma fechada por Joi na borda: array de ate 30 itens {t, tipo, texto}.';
COMMENT ON COLUMN defeito_ocorrencias.req_id IS
  'O req.id da requisicao que falhou, quando a ocorrencia e de servidor. E a costura com a linha do .jsonl.';
