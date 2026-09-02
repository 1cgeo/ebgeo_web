-- Path: src/database/migrations/020_uso_de_produto.sql
-- ============================================================================
-- 020: o USO DO PRODUTO, agregado, sem uma linha por pessoa e sem uma linha por gesto
-- ============================================================================
-- O relatório de uso que existia até aqui (`GET /api/v1/uso/resumo`) respondia sobre o que o
-- banco JÁ guardava por outros motivos: contas, atlas, operações de sync e trilha de
-- auditoria. Ele responde "quanto se produziu" e não responde nada sobre o que a pessoa FAZ
-- na tela: quais ferramentas ela abre, se ela chega ao 3D, se o PDF que sai é folha ou
-- mosaico, quanto tempo a sessão dura, quão rápido o mapa aparece, e quantas pessoas bateram
-- na tela de indisponibilidade. Nenhuma dessas perguntas tem resposta em `operations`.
--
-- ─── A DECISÃO QUE MOLDA AS TRÊS TABELAS: CONTADOR, NÃO EVENTO ───
--
-- A forma óbvia (e a que todo produto de analytics de terceiro usa) é uma linha por evento,
-- com sessão, instante e propriedades, e agregação na leitura. Ela NÃO foi escolhida, e o
-- motivo não é economia de disco:
--
--   1. UMA LINHA POR GESTO É UM RASTRO DE COMPORTAMENTO INDIVIDUAL. Com sessão e instante em
--      cada linha, a sequência do que uma pessoa fez naquela tarde é reconstruível por quem
--      tiver `SELECT`, e este é um sistema militar em que a lotação e o posto de cada conta
--      estão a um JOIN de distância. `uso_eventos_dia` é uma CONTAGEM por (dia, página,
--      evento, qualificador): ela responde "quantas vezes a ferramenta X foi ligada ontem" e
--      é INCAPAZ de responder "quem a ligou", porque a informação não existe na linha.
--   2. O VOLUME É DO TAMANHO DO PRODUTO, NÃO DO USO. Doze dos treze eventos têm qualificador
--      FECHADO, então o número de linhas por dia é limitado por (eventos x páginas), que é um
--      número de duas casas. Uma tabela de eventos crus cresceria com o tráfego, na mesma
--      instalação em que `operations` já é a única tabela sem teto natural.
--   3. A ROTA É ANÔNIMA (ver abaixo), e uma rota anônima que escreve uma linha por chamada é
--      exatamente o desenho que o cabeçalho de `014_observabilidade.sql` recusa por extenso:
--      a telemetria virando o segundo incidente.
--
-- `uso_sessoes` é a exceção deliberada e ela É por sessão, porque duração, vitais e "a sessão
-- teve erro" não são somáveis: não existe forma de derivar uma mediana de duração de um
-- contador. Ela guarda a ABA (um UUID cunhado pelo cliente, como o `sessao_id` de
-- `defeito_ocorrencias`) e, quando há credencial, o `user_id`, porque "quantas PESSOAS
-- distintas usaram o produto" é a pergunta que a aba sozinha não responde. Ela é a única
-- tabela desta migração com prazo de validade: a passada de manutenção agrega o dia fechado
-- em `uso_diario` e depois apaga as sessões vencidas, de modo que o rastro por aba existe por
-- `LOG_RETENTION_DAYS` e o número sobrevive para sempre.
--
-- ─── POR QUE A ROTA DE ESCRITA É ANÔNIMA ───
--
-- Pelo mesmo motivo de `POST /diag/erro-cliente`: o app roda deslogado, e o visitante é
-- justamente quem ninguém está olhando. Um `auth` estrito aqui mediria só a metade que já é
-- a mais visível, e a pergunta que motivou a fase inteira ("quantas pessoas viram a tela de
-- indisponibilidade") é sobre gente que, por definição, não conseguiu entrar. A identidade
-- sai de `req.user` (preenchido por `flexibleAuth`) e NUNCA do corpo, que não tem campo para
-- ela; o teto por endereço é `RATE_LIMIT_USO_EVENTOS_MAX`.
--
-- ─── O DIA É O DO SERVIDOR, E ELE É O MESMO DIA DO RESTO DO MÓDULO ───
--
-- `dia` sai de `ultimoSinal::timestamptz::date`, ou seja, o fuso da SESSÃO do Postgres, que é
-- o do servidor. É a mesma escolha, e a mesma frase, de `PRODUCAO_POR_DIA`
-- (`src/modules/uso/uso.queries.js`): quem lê este relatório é o administrador da instalação,
-- e "segunda-feira" para ele é a segunda-feira da máquina, não a de Greenwich. Misturar UTC
-- aqui e local ali faria duas séries da mesma tela discordarem na virada.
--
-- O instante vem do RELÓGIO DO CLIENTE e é preso a uma JANELA do servidor antes de virar linha
-- (`instantesDoLote`, `src/modules/uso/uso.lote.js`), e a janela tem as DUAS pontas. O teto
-- (`agora`) impede uma linha que a poda nunca alcança e um `dia` que nunca fecha. O PISO
-- (`agora` menos `LOG_RETENTION_DAYS`) impede o avesso, e ele é o que importa para as duas
-- tabelas de contagem: elas NÃO são podadas, então um `ultimoSinal` datado de 1970 escreveria
-- aqui uma linha permanente. A primeira versão deste arquivo dizia que o passado se resolvia
-- sozinho porque a poda o alcança, e isso só valia para `uso_sessoes`.
--
-- ─── A ÚNICA DIMENSÃO DE CARDINALIDADE ABERTA, DECLARADA ───
--
-- `uso_eventos_dia` NÃO É PODADA, e a justificativa vale para doze dos treze eventos: com
-- qualificador fechado, o número de linhas por dia é (eventos x páginas x valores), na casa
-- das dezenas, e apagá-las custaria o histórico longo que é justamente o que a tabela existe
-- para ter. O décimo terceiro é `ferramenta.ativada`, cujo qualificador é o id da ferramenta
-- e portanto LIVRE (`FORMA_DE_PROP_LIVRE`), e ali a cardinalidade é limitada por três coisas
-- e nenhuma delas é o produto: o alfabeto e o comprimento da forma, o teto de 50 eventos por
-- lote, e o limitador por endereço. Um chamador adversário pode inflar essa dimensão, e a
-- saída, se isso acontecer, é podar por idade com a retenção que já existe. Fica escrito
-- porque "baixa cardinalidade por construção" é verdade para doze linhas de treze, e a
-- décima terceira é exatamente a que alguém usaria.
--
-- O QUE ELE **NÃO** PODE MAIS FAZER é escolher o `dia`: sem o piso da apara acima, a mesma
-- dimensão livre podia ser multiplicada por uma data arbitrária, e aí o número de linhas
-- deixava de depender do produto e passava a depender só de quantos pares (data, texto) o
-- chamador tivesse paciência de mandar. Com o piso, a única dimensão aberta é o qualificador,
-- e ela vive dentro de uma janela de `LOG_RETENTION_DAYS` dias.
--
-- ─── O AGREGADO DIÁRIO CONVERGE, E A ÚNICA PERDA ESTÁ DECLARADA ───
--
-- `uso_diario` também não é podada, e ela é REESCRITA a cada passada de manutenção enquanto o
-- dia ainda tiver sessão viva (`AGREGAR_DIAS_FECHADOS` usa `DO UPDATE`, não `DO NOTHING`). É
-- isso que faz o lote atrasado, o que descarrega de manhã a fila da véspera, entrar no número
-- do dia dele. A perda que sobra, dita em voz alta: uma sessão que chegue DEPOIS de a poda ter
-- levado as sessões daquele dia não entra mais, porque não há com o que re-agregar. Isso exige
-- um atraso maior que `LOG_RETENTION_DAYS`, que é a mesma janela em que a apara do instante já
-- para de aceitar o lote.
--
-- ─── O CONTADOR SATURA EM VEZ DE ESTOURAR ───
--
-- `contagem` é INTEGER, e o acumulado de uma chave é `contagem + EXCLUDED.contagem`. Sem
-- cuidado isso é um `22003` (integer out of range) alcançável por chamador anônimo em poucos
-- minutos, ou seja, um 500 na rota que existe para medir. O UPSERT soma em `bigint` e prende
-- em `2147483647`: um contador que satura diz "muitíssimas", e um erro do driver não diz nada.
--
-- ─── DDL ───
--
-- Tudo é aditivo (`CREATE TABLE`/`CREATE INDEX`, com `IF NOT EXISTS`), então não há linha
-- nova em `EXCECOES_DESTRUTIVAS` (`tests/unit/migrations-higiene.test.js`). Os CHECK nascem
-- LARGOS, com os treze eventos e as quatro páginas do espelho
-- (`src/modules/uso/eventos-de-uso.js`): a convenção do pacote é que baseline e migração
-- forward-only escrevam o vocabulário inteiro no estado final, para que ninguém precise
-- derrubar um constraint depois. Valor novo entra aqui, no espelho e no Joi, no mesmo commit.
-- ============================================================================

-- ── as CONTAGENS, uma linha por (dia, página, evento, qualificador) ──
--
-- Sem `id` e sem `created_at`: a chave natural É a linha inteira, e um id sintético só
-- abriria a porta para duas linhas com a mesma chave. `prop` é NOT NULL com default `''`
-- porque ele participa da PK, e PK com coluna nula não agrupa nada (NULL nunca é igual a
-- NULL): o "sem qualificador" precisa ser um VALOR, e a string vazia é ele.
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
    'indisponivel.visto'
  )),
  CONSTRAINT uso_eventos_dia_pagina_check CHECK (pagina IN ('mapa', 'atlas', 'admin', 'calibracao'))
);

-- ── as SESSÕES, uma linha por aba, com prazo de validade ──
--
-- `user_id` é `ON DELETE SET NULL` e não `CASCADE`, e a diferença decide o que acontece com o
-- número quando uma conta some: com `CASCADE`, apagar um usuário reescreveria o passado (a
-- sessão dele deixaria de ter existido e o total do dia mudaria); com `SET NULL`, a sessão
-- continua contada e apenas deixa de ser atribuível, que é a verdade. É a mesma escolha, pelo
-- mesmo motivo, de `defeitos.user_id`.
--
-- `pagina_inicial` é NOT NULL, ao contrário do que uma leitura apressada do contrato sugere:
-- o Joi da borda exige `pagina`, e a coluna é a dimensão de agrupamento de `uso_diario`, cuja
-- PK é (dia, pagina). Deixá-la nula criaria linhas que a agregação teria de descartar em
-- silêncio, que é a forma de o total encolher sem nada ficar vermelho.
--
-- As QUATRO medidas de desempenho são nulas por natureza: `lcp_ms` e `tempo_ate_mapa_ms` só
-- existem na página que carrega mapa, `inp_ms` só existe depois da primeira interação, e
-- `cls` é NUMERIC(6,3) porque é uma fração acumulada com três casas e um `real` traria erro
-- de arredondamento a um número que é comparado com limiares publicados.
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

-- O índice de `dia` serve a agregação (que varre por dia fechado) e o recorte de janela do
-- relatório; o de `release` serve a saúde de release em `GET /diag/status`, que pergunta
-- "quais builds estiveram no ar nesta janela" e agruparia por varredura sem ele.
CREATE INDEX IF NOT EXISTS idx_uso_sessoes_dia ON uso_sessoes(dia);
CREATE INDEX IF NOT EXISTS idx_uso_sessoes_release ON uso_sessoes(release);

-- ── o AGREGADO DIÁRIO, que é o que sobrevive à poda ──
--
-- Uma linha por (dia, página), escrita UMA vez, quando o dia fecha. As quatro contagens são
-- NOT NULL porque sempre existem (um dia com sessões tem pelo menos uma); as cinco medidas
-- são nulas quando `percentile_cont` recebe conjunto vazio, e esse nulo precisa sobreviver
-- até a tela: zero milissegundo de LCP é uma MEDIDA, e nenhuma medida é a ausência dela. É a
-- mesma distinção que `inteiro` e `decimalOuNulo` fazem em `uso.horizonte.js`.
--
-- O QUE ESTA TABELA NÃO CONSEGUE RESPONDER, e é preciso saber antes de ler dela: p75 não se
-- re-agrega a partir de p75, e "pessoas distintas" não se soma entre dias. Quem precisa do
-- número exato da janela lê as SESSÕES, que existem enquanto a retenção as guardar; o que
-- sai daqui para uma janela longa é a MEDIANA DAS MEDIDAS DIÁRIAS, rotulada como tal no
-- payload (`origem`), nunca apresentada como se fosse o percentil da janela.
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
