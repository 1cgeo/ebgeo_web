-- Aggregated product usage, session snapshots, ephemeral presence and batch deduplication.
-- Raw sessions expire; daily counts survive without individual activity histories.
CREATE TABLE IF NOT EXISTS uso_eventos_dia (
  dia      DATE    NOT NULL,
  pagina   TEXT    NOT NULL,
  evento   TEXT    NOT NULL,
  prop     TEXT    NOT NULL DEFAULT '',
  contagem INTEGER NOT NULL,
  PRIMARY KEY (dia, pagina, evento, prop),
  CONSTRAINT uso_eventos_dia_evento_check CHECK (evento IN (
    'pagina.vista',
    'atlas.aberto',
    'ferramenta.ativada',
    'medicao.aberta',
    'visualizador3d.aberto',
    'visualizador360.aberto',
    'primeira-pessoa.aberto',
    'briefing.apresentado',
    'temporal.ativado',
    'pdf.exportado',
    'ebgeo.exportado',
    'ebgeo.importado',
    'indisponivel.visto',
    'migracao.resultado', 'sync.resultado', 'logout.descarte',
    'preferencia.base', 'preferencia.camada', 'recurso.aberto'
  )),
  CONSTRAINT uso_eventos_dia_pagina_check CHECK (pagina IN ('mapa', 'atlas', 'admin', 'calibracao'))
);

CREATE TABLE IF NOT EXISTS uso_sessoes (
  sessao_id         UUID PRIMARY KEY,
  dia               DATE NOT NULL,
  user_id           UUID REFERENCES users(id) ON DELETE SET NULL,
  pagina_inicial    TEXT NOT NULL,
  release           TEXT,
  navegador         TEXT,
  inicio            TIMESTAMPTZ NOT NULL,
  ultimo_sinal      TIMESTAMPTZ NOT NULL,
  eventos           INTEGER NOT NULL DEFAULT 0,
  erros             INTEGER NOT NULL DEFAULT 0,
  lcp_ms            INTEGER,
  inp_ms            INTEGER,
  cls               NUMERIC(6,3),
  tempo_ate_mapa_ms INTEGER,
  CONSTRAINT uso_sessoes_pagina_check CHECK (pagina_inicial IN ('mapa', 'atlas', 'admin', 'calibracao'))
);

CREATE INDEX IF NOT EXISTS idx_uso_sessoes_dia ON uso_sessoes(dia);
CREATE INDEX IF NOT EXISTS idx_uso_sessoes_release ON uso_sessoes(release);

CREATE TABLE IF NOT EXISTS uso_diario (
  dia                   DATE    NOT NULL,
  pagina                TEXT    NOT NULL,
  sessoes               INTEGER NOT NULL,
  sessoes_autenticadas  INTEGER NOT NULL,
  usuarios_distintos    INTEGER NOT NULL,
  sessoes_com_erro      INTEGER NOT NULL,
  duracao_mediana_s     INTEGER,
  lcp_p75_ms            INTEGER,
  inp_p75_ms            INTEGER,
  cls_p75               NUMERIC(6,3),
  tempo_ate_mapa_p75_ms INTEGER,
  PRIMARY KEY (dia, pagina),
  CONSTRAINT uso_diario_pagina_check CHECK (pagina IN ('mapa', 'atlas', 'admin', 'calibracao'))
);

-- Presence is ephemeral and separate from historical usage sessions.
CREATE TABLE IF NOT EXISTS uso_presenca (
  navegador_id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  visto_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  pendentes INTEGER,
  idade_pendente_ms BIGINT,
  falhas_coleta INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_uso_presenca_visto ON uso_presenca(visto_em);

-- Idempotency for acknowledged usage batches, bounded by retention maintenance.
CREATE TABLE IF NOT EXISTS uso_lotes (
  id UUID PRIMARY KEY,
  recebido_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_uso_lotes_recebido ON uso_lotes(recebido_em);
