// Path: src/config.js
import { createHmac } from 'node:crypto';
// FOLHA DE ZERO IMPORTS, e é isso que a torna importável daqui sem risco de ciclo: este
// arquivo é avaliado antes de quase tudo, e qualquer módulo que leia `config` de volta
// fecharia um laço na avaliação. Ver o `fileoverview` de `query-lenta.js`.
import { parseLimiteDeQueryLenta } from './utils/query-lenta.js';

function required(key) {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env var: ${key}`);
  return val;
}

function optional(key, fallback) {
  return process.env[key] || fallback;
}

/**
 * An optional env var that names a BASE URL, with trailing slashes stripped.
 *
 * Every consumer of these values concatenates a path that already starts with
 * `/` (`${serviceUrl}/photos/...`, `${base}/tiles/{z}/{x}/{y}.pbf`), so a base
 * typed with a trailing slash yields `//`. Some servers serve that and some
 * answer 404, so the bug only surfaces after deploy, on whichever route the
 * operator did not open while testing. Stripping once here beats guarding at
 * every call site. Same reasoning as `normalizeBase` in the frontend's
 * `first_person_3d_tool/scene-config.service.js`.
 * @param {string} key - env var name
 * @param {string} fallback - value used when the var is absent or empty
 * @returns {string} base without trailing slashes
 */
function optionalBase(key, fallback) {
  return String(optional(key, fallback)).replace(/\/+$/, '');
}

/** Inteiro opcional: ausente/ilegível → undefined (o consumidor decide o default). */
function optionalInt(key) {
  const raw = process.env[key];
  if (raw === undefined || raw === '') return undefined;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : undefined;
}

const nodeEnv = optional('NODE_ENV', 'development');

/**
 * O teto do identificador de build. Ver `parseRelease`.
 *
 * 100 é o MESMO teto que `erroDeClienteSchema` (`src/modules/diag/diag.schemas.js`) impõe
 * ao `release` que o navegador relata, e a coincidência é o ponto: os dois lados da
 * telemetria acabam na mesma coluna `defeitos.release`, então um teto maior aqui
 * produziria um valor de servidor que o valor de cliente nunca poderia igualar.
 */
export const TETO_DO_RELEASE = 100;

/**
 * O identificador da BUILD implantada (`EBGEO_RELEASE`), ou `undefined`.
 *
 * AUSENTE É UM ESTADO LEGÍTIMO, e é o de todo desenvolvimento: quem roda `npm run dev` não
 * tem imagem, não tem build e não tem hash de deploy. Por isso não há default. Um default
 * (a versão do `package.json`, por exemplo) seria a pior das opções: ele é CONSTANTE entre
 * deploys, então carimbaria toda linha de log com um valor que não distingue nada e ainda
 * faria a ausência de release parecer resolvida.
 *
 * O CORTE É SILENCIOSO, e é escolha: este valor não decide comportamento nenhum, só rotula
 * evidência, e derrubar o boot do servidor por causa de um rótulo longo demais trocaria uma
 * etiqueta truncada por uma indisponibilidade.
 *
 * @param {unknown} bruto - o valor cru da variável de ambiente.
 * @returns {string|undefined} o valor limpo, ou `undefined` quando não há nenhum.
 */
export function parseRelease(bruto) {
  if (typeof bruto !== 'string') return undefined;
  const limpo = bruto.trim();
  return limpo === '' ? undefined : limpo.slice(0, TETO_DO_RELEASE);
}

/**
 * Resolves whether self-registration (`POST /auth/register`) is enabled.
 * Pure helper (testable in isolation). Default: disabled in production,
 * enabled in development/test so the existing suite and local dev keep working.
 * @param {string} env - NODE_ENV value
 * @param {string|undefined} override - ALLOW_SELF_REGISTRATION env value
 * @returns {boolean}
 */
export function resolveAllowSelfRegistration(env, override) {
  if (override === 'true') return true;
  if (override === 'false') return false;
  return env !== 'production';
}

/**
 * A rotulagem de domínio da chave de impressão da trilha de auditoria.
 *
 * Ela é literal e versionada porque é o que impede a chave derivada de ser a mesma
 * coisa que o segredo de sessão: quem obtiver uma nunca obtém a outra por dedução.
 * Trocar esta string invalida toda impressão já gravada (as antigas param de casar
 * com as novas), então ela só muda com um `/v2` deliberado e registrado.
 */
export const AUDIT_FINGERPRINT_DOMAIN = 'ebgeo/audit-fingerprint/v1';

/**
 * Deriva a chave de IMPRESSÃO da trilha a partir do segredo de JWT.
 *
 * POR QUE DERIVAR E NÃO PEDIR UMA ENV NOVA: uma env a mais é um passo de implantação
 * a mais, e o modo de falha dela é degradar em silêncio — um deploy sem a variável
 * subiria com chave vazia e toda impressão passaria a ser a impressão do vazio, sem
 * erro em lugar nenhum. Derivar de um segredo que o boot já EXIGE (`required`) faz
 * "chave ausente" ser um estado que não existe.
 *
 * POR QUE NÃO USAR O SEGREDO CRU: separação de domínio. A trilha é lida por qualquer
 * administrador e por qualquer produtor; a impressão que ela carrega não pode ser um
 * artefato calculável com a mesma chave que assina sessão.
 * @param {string} segredo - `config.jwt.secret`.
 * @returns {Buffer} 32 bytes.
 */
export function derivarChaveDeImpressao(segredo) {
  return createHmac('sha256', segredo).update(AUDIT_FINGERPRINT_DOMAIN).digest();
}

const config = Object.freeze({
  port: parseInt(optional('PORT', '3000'), 10),
  nodeEnv,
  logLevel: optional('LOG_LEVEL', 'info'),

  /**
   * QUAL BUILD ESTÁ NO AR (`EBGEO_RELEASE`), ou `undefined`. Ver `parseRelease`.
   *
   * Ele é carimbado pela construção da IMAGEM (`ARG EBGEO_RELEASE` no `Dockerfile`) e vale
   * o hash do commit implantado. Sem ele, "isto foi corrigido no deploy seguinte" é uma
   * pergunta que o log não responde: duas linhas idênticas de dois deploys diferentes são
   * indistinguíveis, e a primeira coisa que se quer saber diante de um erro que voltou é se
   * ele voltou na MESMA build.
   */
  release: parseRelease(process.env.EBGEO_RELEASE),

  /**
   * O log em ARQUIVO (`src/utils/log-diario.js`), que é o que faz a evidência sobreviver à
   * sessão. `LOG_TO_FILE=off` desliga, e é a única forma: o caminho vazio cai no default,
   * pela armadilha do `optional()` documentada acima.
   *
   * O diretório default fica sob `./data`, como todo o resto dos dados desta aplicação, e
   * por isso ele já está dentro do volume que o compose monta: um log que morre com o
   * container não teria resolvido o problema que motivou este destino.
   */
  log: Object.freeze({
    dir: optional('LOG_DIR', './data/logs'),
    retencaoDias: optionalInt('LOG_RETENTION_DAYS') ?? 30,
    emArquivo: optional('LOG_TO_FILE', 'on') !== 'off',
  }),

  /**
   * ONDE MORAM OS `.map` DAS BUILDS PUBLICADAS (`EBGEO_MAPAS_DIR`), ou `undefined`.
   *
   * É o diretório de RELEASES que o deploy escreve: uma pasta por build, cada uma com o seu
   * `release.json` e os `assets/*.map`. Ele serve UM caminho só,
   * `GET /api/v1/diag/defeitos/:id/pilha`, que desminifica a pilha crua de um defeito do lado
   * do SERVIDOR, para o agente com credencial de administrador que opera de FORA do host e
   * portanto não tem os mapas na máquina dele (o gêmeo é `npm run diag -- pilha --mapas`, que
   * recebe o diretório de quem digitou).
   *
   * SEM DEFAULT, E É DECISÃO. Um caminho embutido faria a rota procurar mapas num diretório
   * que a instalação nunca declarou e responder "nenhuma build declara esta release", que
   * manda investigar a BUILD quando o que falta é configuração. Ausente, ela responde 200
   * dizendo que a desminificação não está disponível neste servidor, e nomeia a variável.
   *
   * ELE NÃO DERRUBA O BOOT quando aponta para lugar nenhum, ao contrário do que `LOG_DIR`
   * merece: um diretório de mapas ausente degrada um caminho de diagnóstico e o anuncia,
   * enquanto um log sem destino apaga a única evidência que sobrevive ao terminal.
   */
  mapasDir: process.env.EBGEO_MAPAS_DIR || undefined,

  db: Object.freeze({
    connectionString: required('DATABASE_URL'),
    poolMin: parseInt(optional('DATABASE_POOL_MIN', '2'), 10),
    poolMax: parseInt(optional('DATABASE_POOL_MAX', '10'), 10),

    /**
     * O LIMITE ACIMA DO QUAL UMA QUERY VIRA LINHA DE LOG (`SLOW_QUERY_MS`, default 500 ms,
     * piso 1). A regra de leitura, o piso e o porquê de ausência e lixo caírem no default
     * em vez de derrubarem o boot estão em `src/utils/query-lenta.js`; o hook que a
     * consome é o `receive` de `src/database/index.js`.
     *
     * `optional()` NÃO SERVE AQUI, e a razão é a armadilha dele: `process.env[key] ||
     * fallback` trata `'0'` como ausente, e `0` é justamente o valor que alguém escreve
     * querendo "acuse tudo". Com o parser dedicado, `0` é aparado para o piso, que é uma
     * resposta, em vez de virar 500 em silêncio, que é outra pergunta.
     */
    slowQueryMs: parseLimiteDeQueryLenta(process.env.SLOW_QUERY_MS),
  }),

  jwt: Object.freeze({
    secret: required('JWT_SECRET'),
    accessExpiry: optional('JWT_ACCESS_EXPIRY', '15m'),
    refreshExpiry: optional('JWT_REFRESH_EXPIRY', '7d'),
    // Algorithm allowlist for jwt.verify — never accept `none`/asymmetric forgery.
    algorithms: ['HS256'],
  }),

  health: Object.freeze({
    // Deadline the readiness probe (`GET /api/v1/health`) applies to its own DB
    // round-trip. Nothing else in the stack has a timeout (see the note in
    // app.js), so this is what turns "the DB is unreachable" into a 503 instead of
    // a hung request. Short by design: a readiness answer that arrives late is
    // already useless to an orchestrator.
    dbTimeoutMs: parseInt(optional('HEALTH_DB_TIMEOUT_MS', '2000'), 10),

    /**
     * A AMOSTRA PERIÓDICA (`src/utils/amostra-de-saude.js`), que é a metade que PERGUNTA
     * sozinha: o `/health` acima só responde a quem chama, e aqui não há orquestrador
     * chamando. Ligada por env do mesmo jeito que o log em arquivo (`off` exato desliga;
     * vazio cai no default), e nunca em teste, o que quem decide é `deveAmostrar`.
     *
     * O INTERVALO DEFAULT É 5 MINUTOS, e o número é um câmbio entre três coisas:
     *  - CUSTO: cada amostra tira uma conexão do pool de dez (`DATABASE_POOL_MAX`) por um
     *    `SELECT 1`. A 300 s isso é ruído ao lado de um único boot do app, que faz dezenas
     *    de consultas; a alguns segundos ele passaria a competir com o sync no mesmo pool,
     *    ou seja, o observador viraria parte da carga observada.
     *  - RESOLUÇÃO: 288 pontos por dia. Como é o BURACO na série que revela a queda (o
     *    amostrador não testemunha a própria morte), duas amostras faltando já localizam a
     *    indisponibilidade numa janela de dez minutos, que é a precisão com que se reage
     *    numa instalação sem plantão nem alarme.
     *  - VOLUME: 288 linhas por dia no `.jsonl`, ao lado das milhares de linhas de
     *    requisição do mesmo arquivo. Uma amostra a cada segundo enterraria no relatório
     *    justamente o que ele existe para achar.
     *
     * O PRAZO DA SONDA é PRÓPRIO e MAIOR que o do `/health` de propósito: aquele responde a
     * um orquestrador, para quem resposta atrasada já não serve; esta escreve história, e
     * distinguir "lento" de "morto" é parte do que ela registra. Ele tem de continuar bem
     * abaixo do intervalo, senão duas sondas se sobrepõem no pool.
     */
    amostra: Object.freeze({
      ativa: optional('HEALTH_SAMPLE', 'on') !== 'off',
      intervaloMs: parseInt(optional('HEALTH_SAMPLE_INTERVAL_MS', '300000'), 10),
      dbTimeoutMs: parseInt(optional('HEALTH_SAMPLE_DB_TIMEOUT_MS', '5000'), 10),
    }),
  }),

  cors: Object.freeze({
    // O default é a origem do FRONTEND (Vite em :3000), não a do backend. Estava
    // `:8080` — a porta do próprio backend —, o que liberava uma origem que nunca
    // faz requisição cross-origin e bloqueava a que faz. Em dev o browser fala com
    // o Vite, que faz proxy de /api, então na prática é same-origin; isso só
    // aparece quando o front é servido de outra origem (o caso do E2E, que já
    // passa CORS_ORIGIN explícito).
    origin: optional('CORS_ORIGIN', 'http://localhost:3000'),
  }),

  images: Object.freeze({
    dir: optional('IMAGES_DIR', './data/images'),
    maxSizeMb: parseInt(optional('MAX_IMAGE_SIZE_MB', '10'), 10),
    // Bounded body limit for POST /images/bulk (base64 batch, up to 50 images).
    // Larger than the global JSON limit so the per-image limit is actually
    // reachable in a batch; still capped to bound the authenticated memory blast.
    // "Authenticated" is now enforced rather than assumed: app.js only selects this
    // parser for the anchored bulk route AND when flexibleAuth has already attached
    // a verified `req.user` — before that, any anonymous POST to a path merely
    // ENDING in /images/bulk got the enlarged limit.
    maxBulkUploadMb: parseInt(optional('MAX_BULK_UPLOAD_MB', '50'), 10),
  }),

  // Vídeo de prévia de recurso de catálogo HOSPEDADO (a thumbnail é embutida no config como
  // data URL; o vídeo é grande demais para isso, então vive em disco e é servido por rota
  // própria). O nome do arquivo carrega um token não-adivinhável, e a URL só chega a quem vê o
  // recurso (config público, ou payload aditivo do privado), então servir é público-por-URL.
  catalogVideo: Object.freeze({
    dir: optional('CATALOG_VIDEO_DIR', './data/catalog-videos'),
    baseUrl: optionalBase('CATALOG_VIDEO_BASE_URL', '/api/v1/catalog-videos'),
    maxSizeMb: parseInt(optional('CATALOG_VIDEO_MAX_SIZE_MB', '50'), 10),
  }),

  assets3d: Object.freeze({
    dir: optional('ASSETS_3D_DIR', './data/assets3d'),
    baseUrl: optionalBase('ASSETS_3D_BASE_URL', '/api/v1/assets3d'),
    // SQLite BLOB store (served first; filesystem `dir` is the fallback).
    sqlitePath: optional('ASSETS_3D_SQLITE', './data/assets3d.sqlite'),
    maxInflight: parseInt(optional('ASSETS_3D_MAX_INFLIGHT', '8'), 10),
  }),

  // ONE .3dtiles PER MODEL, served under the `m/` prefix of the assets3d route.
  // The format is the Cesium 3d-tiles-tools one (`media(key, content)`), so a file
  // written by the importer opens with `npx 3d-tiles-tools convert` and vice versa.
  //
  // WHY A SECOND STORE RATHER THAN MORE ROWS IN assets3d.sqlite: the converted acquis
  // is 21,4 GB over 74 models. In one flat file, replacing a single model rewrites the
  // one file every other model is served from, and there is no per-model eviction to
  // bound open handles. Per model, a re-import swaps ONE file (the `deposito.js` dance)
  // and the LRU below bounds how many stay open — which on Windows is what lets the
  // swap happen at all, since an open handle blocks the rename.
  models3d: Object.freeze({
    dbDir: optional('MODELS_3D_DIR', './data/models3d'),
    // Open connections kept across the worker pool. 12 is the ebgeo_3d number,
    // measured against a 512 MB container; the product with the SQLite cache is what
    // has to fit.
    maxOpen: parseInt(optional('MODELS_3D_MAX_OPEN', '12'), 10),
  }),

  sv360: Object.freeze({
    // Directory holding the per-project {slug}.db SQLite stores (WebP BLOBs).
    dbDir: optional('SV360_DB_DIR', './data/sv360'),
    // Caps in-heap BLOB buffers served concurrently (mirrors assets3d).
    maxInflight: parseInt(optional('SV360_MAX_INFLIGHT', '8'), 10),
    // Multer streams the uploaded images.db (multi-GB) here BEFORE the atomic swap.
    // MUST be on the same volume as dbDir so the .tmp→dest rename stays atomic.
    tmpDir: optional('SV360_TMP_DIR', './data/sv360-tmp'),
    // Hard cap for the multipart upload (the images.db can be large). Default 2
    // GiB (the original 360 bodyLimit); configurable via SV360_MAX_UPLOAD_BYTES.
    // FIX-4: a tighter default bounds the authenticated disk-fill blast radius.
    maxUploadBytes: parseInt(optional('SV360_MAX_UPLOAD_BYTES', String(2 * 1024 * 1024 * 1024)), 10),
  }),

  ws: Object.freeze({
    heartbeatIntervalMs: parseInt(optional('WS_HEARTBEAT_INTERVAL_MS', '30000'), 10),
    heartbeatTimeoutMs: parseInt(optional('WS_HEARTBEAT_TIMEOUT_MS', '5000'), 10),
    // Fase 8 (Tarefa 2): on an abnormal close (network drop / heartbeat
    // terminate) the user is marked `away` for this grace window instead of
    // being removed; a reconnect with the same clientId cancels removal.
    awayGraceMs: parseInt(optional('WS_AWAY_GRACE_MS', '120000'), 10),
    // AGRUPAMENTO DE CURSOR. A sala e por atlas e sem subcanal, entao cada quadro de cursor era
    // retransmitido a todos os pares: `S x f x 12,5 x (S-1)` escritas em socket por segundo. A
    // bancada mediu a sala de 200 pedindo 246.302 quadros/s e o servidor entregando 46.436, e a
    // de 400 pedindo 971.086 e entregando os mesmos 46 mil. Agrupando por sala a cada 100 ms com
    // a ULTIMA posicao de cada um, a de 400 passa a pedir cerca de 4.000, um decimo do teto.
    // Zero DESLIGA e volta ao relay imediato, que e como se compara antes e depois.
    // LIGADO POR PADRAO, com 100 ms, que e o valor medido.
    //
    // O GANHO, na bancada E9 contra a linha de base de 2026-08-27:
    //     sala de 100:  ack 3.844 ms -> 17 ms, CPU 84,8% -> 22,2%
    //     sala de 200:  ack 84.961 ms -> 34 ms, CPU 87% -> 44,3%, 147 sockets derrubados -> ZERO
    // O limite operacional de sala sai de cinquenta para duzentos, e a de 100 fica indistinguivel
    // da de 50.
    //
    // ISTO E CONTRATO NO FIO, e a compatibilidade nao e retroativa: o frame passa de `cursor` (um
    // por quadro, sem o remetente) para `cursors` (um lote por sala, COM o remetente, que o cliente
    // descarta pelo clientId). Cliente antigo contra servidor novo simplesmente PARA DE VER CURSOR,
    // sem erro nenhum, que e o modo de falha mais silencioso que existe. Os dois pacotes sao
    // versionados juntos neste repositorio, e a decisao de 2026-08-28 registra isso.
    //
    // Zero DESLIGA e volta ao relay imediato, com teste proprio para que "desligado" nao possa
    // estar silenciosamente ligado. E a valvula para reverter sem novo deploy de codigo.
    cursorBatchMs: parseInt(optional('WS_CURSOR_BATCH_MS', '100'), 10),
  }),

  // How many reverse proxies sit in front of the app, for Express `trust proxy`.
  //
  // This is NOT cosmetic: with it unset, `req.ip` is the proxy's address for every
  // request, so every IP-keyed rate limiter collapses into a single global bucket.
  // The documented deployment puts nginx in front (docs/wiki/deploy-backend.md,
  // "NGINX: quatro itens nao negociaveis"), hence the default of 1 hop.
  //
  // Set it to 0 when the app is exposed directly. Trusting a hop that does not
  // exist is the opposite failure: X-Forwarded-For becomes client-controlled, and
  // an attacker can then forge a fresh key per request and skip the limits
  // entirely. One hop trusted must mean one hop present.
  trustProxy: parseInt(optional('TRUST_PROXY_HOPS', '1'), 10),

  rateLimit: Object.freeze({
    // Credential routes (login/refresh/register): strict.
    authWindowMs: parseInt(optional('RATE_LIMIT_AUTH_WINDOW_MS', '900000'), 10), // 15 min
    authMax: parseInt(optional('RATE_LIMIT_AUTH_MAX', '10'), 10),
    // Public link route: looser, by IP only.
    publicWindowMs: parseInt(optional('RATE_LIMIT_PUBLIC_WINDOW_MS', '60000'), 10), // 1 min
    publicMax: parseInt(optional('RATE_LIMIT_PUBLIC_MAX', '30'), 10),
    // Busca do gazetteer: ANÔNIMA de propósito (é a busca do caminho sem login),
    // então o custo por requisição é o que decide se ela vira vetor de DoS. O teto
    // é folgado por escolha: o cliente faz debounce de 300 ms
    // (`frontend/src/js/search/feature-search.control.js:71`), então um humano
    // digitando não passa de alguns por segundo em rajada, e um escritório inteiro
    // atrás de um egress compartilhado ainda cabe. O que ele corta é a varredura
    // sequencial do gazetteer, que precisa de milhares.
    gazetteerWindowMs: parseInt(optional('RATE_LIMIT_GAZETTEER_WINDOW_MS', '60000'), 10), // 1 min
    gazetteerMax: parseInt(optional('RATE_LIMIT_GAZETTEER_MAX', '300'), 10),
    // GET /api/config: anônima, e a única cuja indisponibilidade IMPEDE o boot do app
    // (fail-fast, sem fallback estático). O teto é o mais folgado do conjunto de
    // propósito, porque errar para baixo aqui não degrada uma funcionalidade, apaga o
    // produto: o cliente legítimo chama isto UMA vez por boot, mas em falha ele
    // retenta 3 vezes com 1 s de intervalo (frontend/src/js/index.js), então o mesmo
    // incidente que justifica o limitador é o que TRIPLICA a demanda legítima; e uma
    // OM inteira atrás de um egress NAT compartilha um endereço. 600/min = 10 rps por
    // endereço, ordens de grandeza acima de qualquer sala de aula abrindo o app junto
    // e ainda assim um teto, que é o que faltava. O que segura o custo por requisição
    // é a memoização (config.cache.js), não este número.
    configWindowMs: parseInt(optional('RATE_LIMIT_CONFIG_WINDOW_MS', '60000'), 10), // 1 min
    configMax: parseInt(optional('RATE_LIMIT_CONFIG_MAX', '600'), 10),
    // POST /auth/register, keyed by ADDRESS. Separate from the auth knobs above on
    // purpose: `authLimiter` keys by `${ip}:${username}`, and on a registration route
    // the username is chosen by the caller and never exists yet, so every request buys
    // a fresh bucket. This is the only ceiling that actually bounds mass account
    // creation (and the e-mail amplification that comes with it).
    //
    // Reusing authWindowMs/authMax (10 per 15 min) would be wrong in the OTHER
    // direction: the documented deployment is a whole OM behind an egress NAT, so a
    // rollout day with a class signing up together would hit the ceiling and the
    // symptom would read as "EBGeo won't let anyone register". One hour and 20 cuts
    // bulk creation without reaching human use. The knob exists because 20 is a
    // calibrated guess, not a measurement.
    registerWindowMs: parseInt(optional('RATE_LIMIT_REGISTER_WINDOW_MS', '3600000'), 10), // 1 h
    registerMax: parseInt(optional('RATE_LIMIT_REGISTER_MAX', '20'), 10),
  }),

  // Memoização em processo do payload de GET /api/config (src/modules/config/config.cache.js).
  // A invalidação é feita NA ESCRITA (catálogo, ranks, organizações e overrides de admin), que
  // é o que preserva a propagação imediata prometida pelo `Cache-Control: no-cache` da rota;
  // este TTL é só a rede de segurança para uma escrita que ninguém ligou ao invalidador (um
  // UPDATE manual no banco). 0 desliga a memoização inteira.
  configCache: Object.freeze({
    ttlMs: parseInt(optional('CONFIG_CACHE_TTL_MS', '30000'), 10), // 30 s
  }),

  // POR QUANTO TEMPO UM ÍNDICE DE REGIME VENCIDO AINDA PODE DIZER "ISTO É PÚBLICO".
  //
  // `tile-regime.js` e `assets3d-regime.js` mantêm em memória o regime de acesso do
  // catálogo e, quando a reconstrução falha, caem para o último índice bom e seguem
  // servindo. A queda é deliberada (fechar derrubaria o acervo público inteiro por uma
  // piscada de banco) e desde 2026-09-01 ela deixa uma linha de transição
  // (`src/modules/nomes/regime-vencido.js`). O que faltava era LIMITE: sem teto, um recurso
  // recém-marcado privado segue sendo servido como público, e com `immutable`, enquanto o
  // banco estiver fora, por tempo indeterminado.
  //
  // CINCO MINUTOS, e o número sai de duas medidas do próprio sistema: o TTL do índice é de
  // 60 s e uma piscada de deploy dura segundos, então o padrão dá cinco vezes a folga do
  // ciclo normal de reconstrução. Muito abaixo disso, o teto transforma manutenção rotineira
  // de banco em falha de mapa; acima, a janela que ele existe para fechar volta a ser longa.
  //
  // 0 É VÁLIDO e é o regime mais estrito: nenhuma afirmação pública sai de índice vencido,
  // nem por um milissegundo.
  regimeIndex: Object.freeze({
    staleMaxMs: parseInt(optional('REGIME_STALE_MAX_MS', '300000'), 10), // 5 min
  }),

  security: Object.freeze({
    allowSelfRegistration: resolveAllowSelfRegistration(nodeEnv, process.env.ALLOW_SELF_REGISTRATION),
    // There is no "verification mode" knob. There used to be one, read at its own
    // definition and nowhere else in src/ — a name promising to choose the account
    // activation regime while choosing nothing. It was removed when e-mail became
    // mandatory on self-registration: a no-op switch is worse than an absent one,
    // because it invites the next reader to set it and expect an approval flow that
    // does not exist. Self-registration confirms by e-mail link, period.
    verificationTtlHours: parseInt(optional('AUTH_VERIFICATION_TTL_HOURS', '48'), 10),
    // O PRAZO DO LINK DE REDEFINIÇÃO DE SENHA, e ele é MUITO mais curto que o de
    // confirmação de conta de propósito: o token de confirmação só ativa um endereço
    // que a pessoa já declarou, enquanto o de redefinição TROCA o único fator de
    // autenticação da casa. Minutos, não horas, e a unidade é minuto para que
    // encurtá-lo não exija fração. Vale só onde as rotas existem, que é onde há relay
    // (ver a montagem condicional em `src/modules/auth/auth.routes.js`).
    passwordResetTtlMinutes: parseInt(optional('AUTH_PASSWORD_RESET_TTL_MINUTES', '60'), 10),
    // A chave de IMPRESSÃO do de-para da trilha (`utils/audit-diff.js`). Derivada, não
    // configurada: ver `derivarChaveDeImpressao` acima. Ela NUNCA sai em resposta
    // nenhuma — se sair, a impressão vira oráculo de adivinhação para quem lê a trilha.
    auditFingerprintKey: derivarChaveDeImpressao(required('JWT_SECRET')),
  }),

  // Outbound e-mail (verification links). When SMTP is not configured (no host) the mailer
  // is a no-op that LOGS the link — the default in dev/test and in closed networks without
  // a relay. appBaseUrl builds the `?verify=<token>` link. It does NOT "fall back to the
  // request origin", which is what this comment said until 2026-07-25: `resolveVerificationBase`
  // (utils/mailer.js:50-60) honours a client-supplied origin ONLY when it equals cors.origin,
  // and otherwise returns '' — an unset appBaseUrl yields a RELATIVE link, not an attacker's
  // host. Proof lives in tests/unit/mailer-verification-link.test.js:64-96.
  mail: Object.freeze({
    host: optional('SMTP_HOST', ''),
    port: parseInt(optional('SMTP_PORT', '587'), 10),
    user: optional('SMTP_USER', ''),
    pass: optional('SMTP_PASS', ''),
    from: optional('MAIL_FROM', 'no-reply@ebgeo.local'),
    appBaseUrl: optional('APP_BASE_URL', ''),
  }),

  // Runtime app config (served by GET /api/v1/config). Service URLs and tile
  // sources are injected by deployment env so the frontend never needs a rebuild
  // to point at internal DGEO servers. Defaults are public DEV-only placeholders.
  appConfig: Object.freeze({
    tileServerUrl: optional('TILE_SERVER_URL', ''),
    terrainUrl: optional('TERRAIN_URL', 'https://demotiles.maplibre.org/terrain-tiles/tiles.json'),
    hillshadeUrl: optional('HILLSHADE_URL', 'https://demotiles.maplibre.org/terrain-tiles/tiles.json'),
    // Só se aplicam quando a URL é um TEMPLATE `{z}/{x}/{y}` (fonte por tiles);
    // numa URL TileJSON o próprio manifesto declara os zooms.
    terrainMinzoom: optionalInt('TERRAIN_MINZOOM'),
    terrainMaxzoom: optionalInt('TERRAIN_MAXZOOM'),
    hillshadeMinzoom: optionalInt('HILLSHADE_MINZOOM'),
    hillshadeMaxzoom: optionalInt('HILLSHADE_MAXZOOM'),
    map3dImageryUrl: optional('MAP3D_IMAGERY_URL', 'https://a.tile.openstreetmap.org/{z}/{x}/{y}.png'),
    // Sem default: o terreno do Cesium é um serviço de DEPLOY (em produção,
    // relativo — ex.: `/cms/terrain-cesium/`). O default anterior era
    // `http://localhost/terrain/tilesets/terrain` — absoluto, sem porta e
    // inexistente —, e como `terrain.enabled` era fixo em true, toda instalação
    // sem essa env pedia ao Cesium um CesiumTerrainProvider inalcançável. Vazio
    // faz o config.service publicar `enabled: false` (elipsoide plano), que é o
    // comportamento correto de quem não tem terreno.
    map3dTerrainUrl: optional('MAP3D_TERRAIN_URL', ''),
    // Fase 9: the 360 is ABSORBED into this backend (no external :8081 upstream).
    // serviceUrl is the in-backend mount; previewThumbnail (relative) concatenates
    // with it. The frontend now consumes a server-rendered VECTOR source: the MVT
    // tiles at `${serviceUrl}/tiles/{z}/{x}/{y}.pbf` (PostGIS ST_AsMVT), carrying
    // the 'fotos' (points) and 'fotos_linha' (per-project trajectory lines) layers.
    // GeoJSON-as-source and PMTiles are DISCONTINUED. The {z}/{x}/{y} are MapLibre
    // placeholders (literals), NOT env. Only the service base is deploy-configured.
    // Default RELATIVO (mesmo padrão de ASSETS_3D_BASE_URL): o sv360 é um módulo
    // DESTE backend, montado em /api/v1/sv360 — não um serviço externo. O default
    // anterior era absoluto (`http://localhost:3000/api/v1/sv360`) e só funcionava
    // por acidente, porque :3000 é o Vite e ele faz proxy de /api para cá; num
    // deploy real, ou era configurado à mão ou o browser chamava o próprio host.
    // A env var permanece para o caso de o 360 ser servido de outra origem.
    sv360ServiceUrl: optionalBase('SV360_SERVICE_URL', '/api/v1/sv360'),
    // Basemap tile/style URLs (substitutable by internal servers in production):
    osmTileUrl: optional('OSM_TILE_URL', 'https://a.tile.openstreetmap.org/{z}/{x}/{y}.png'),
    glyphsUrl: optional('MAPLIBRE_GLYPHS_URL', 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf'),
    imagensTileUrl: optional('IMAGENS_TILE_URL', 'https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}'),
    ortoimagemTileUrl: optional('ORTOIMAGEM_TILE_URL', 'https://bdgex.eb.mil.br/mapcache?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&FORMAT=image%2Fpng&TRANSPARENT=true&LAYERS=ortoimagem_mercator&TILED=true&WIDTH=256&HEIGHT=256&SRS=EPSG%3A3857&STYLES=&BBOX={bbox-epsg-3857}'),
    bdgexWmsUrl: optional('BDGEX_WMS_URL', 'https://bdgex.eb.mil.br/mapcache?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&FORMAT=image%2Fpng&TRANSPARENT=true&LAYERS=ctmmultiescalas_mercator&TILED=true&WIDTH=256&HEIGHT=256&SRS=EPSG%3A3857&STYLES=&BBOX={bbox-epsg-3857}'),
  }),

  get isDev() { return this.nodeEnv === 'development'; },
  get isProd() { return this.nodeEnv === 'production'; },
  get isTest() { return this.nodeEnv === 'test'; },
});

// Integer env vars that are `parseInt`-ed into config, with the range each must
// fall in. Bounds are sanity limits, not policy: they exist to catch typos and
// pathological values (0 workers, a 1ms heartbeat) before the server accepts a
// connection. See the loop in validateEnvVariables for why silent NaN is unsafe.
// Exported so a test can cross-check it against the integer call sites in this
// same file: the table is maintained BY HAND, and a knob that enters config.js
// without an entry brings the silent-NaN trap back whole. That drift is not
// hypothetical — TRUST_PROXY_HOPS and the two gazetteer limiter knobs below were
// read here and absent from this table. See tests/unit/config-env-rules.test.js.
export const NUMERIC_ENV_RULES = Object.freeze({
  // Retenção do log em arquivo, em dias, HOJE inclusive. Piso 1 (zero apagaria o arquivo
  // que está sendo escrito) e teto de dez anos, que é absurdo o bastante para só pegar
  // erro de digitação sem impedir uma política de retenção longa.
  LOG_RETENTION_DAYS: { min: 1, max: 3650 },
  DATABASE_POOL_MIN: { min: 0, max: 1000 },
  DATABASE_POOL_MAX: { min: 1, max: 1000 },
  MAX_IMAGE_SIZE_MB: { min: 1, max: 1024 },
  MAX_BULK_UPLOAD_MB: { min: 1, max: 4096 },
  // Vídeo de prévia hospedado: teto por arquivo. Piso 1 MB, teto 2 GB (o vídeo é prévia curta;
  // acima disso o upload passa a exigir outro regime de streaming).
  CATALOG_VIDEO_MAX_SIZE_MB: { min: 1, max: 2048 },
  ASSETS_3D_MAX_INFLIGHT: { min: 1, max: 1024 },
  // Teto de conexões abertas no pool de leitura, por modelo. O piso é 1 (com zero nenhum
  // modelo abriria) e o teto é 256 porque o produto com o cache do SQLite é o que tem de
  // caber no contêiner: 12 x 8 MB são os 96 MB medidos no serviço de origem.
  MODELS_3D_MAX_OPEN: { min: 1, max: 256 },
  SV360_MAX_INFLIGHT: { min: 1, max: 1024 },
  SV360_MAX_UPLOAD_BYTES: { min: 1 },
  SQLITE_BLOB_WORKERS: { min: 1, max: 64 },
  WS_HEARTBEAT_INTERVAL_MS: { min: 1000, max: 3600000 },
  WS_HEARTBEAT_TIMEOUT_MS: { min: 100, max: 3600000 },
  WS_AWAY_GRACE_MS: { min: 0, max: 86400000 },
  WS_CURSOR_BATCH_MS: { min: 0, max: 5000 },
  RATE_LIMIT_AUTH_WINDOW_MS: { min: 1000 },
  RATE_LIMIT_AUTH_MAX: { min: 1 },
  RATE_LIMIT_PUBLIC_WINDOW_MS: { min: 1000 },
  RATE_LIMIT_PUBLIC_MAX: { min: 1 },
  RATE_LIMIT_GAZETTEER_WINDOW_MS: { min: 1000 },
  RATE_LIMIT_GAZETTEER_MAX: { min: 1 },
  RATE_LIMIT_CONFIG_WINDOW_MS: { min: 1000 },
  RATE_LIMIT_CONFIG_MAX: { min: 1 },
  RATE_LIMIT_REGISTER_WINDOW_MS: { min: 1000 },
  RATE_LIMIT_REGISTER_MAX: { min: 1 },
  // 0 é VÁLIDO e significa "sem memoização" (o desligamento explícito do cache do
  // /config). É a única entrada desta tabela cujo piso é zero, e é o que permite
  // desligar a memoização por env sem editar código.
  CONFIG_CACHE_TTL_MS: { min: 0 },
  // Teto do regime vencido dos índices de catálogo (ver `regimeIndex` acima). 0 é VÁLIDO e
  // é o regime mais estrito (nenhuma afirmação pública sai de índice vencido); o teto de um
  // dia é o ponto em que "resiliência" deixa de se distinguir da janela aberta que o knob
  // existe para fechar. A faixa entra na tabela no MESMO commit que o knob, de propósito:
  // sem ela `REGIME_STALE_MAX_MS=abc` vira NaN, e `idade >= NaN` é SEMPRE falso, ou seja, um
  // teto que nunca fecha, e o gate voltaria a servir estado velho para sempre com a aparência
  // de estar configurado. É o estrago do `setInterval(NaN)` registrado acima, agora na
  // direção do acesso, que é a pior das duas.
  REGIME_STALE_MAX_MS: { min: 0, max: 86400000 },
  // Hop count for Express `trust proxy`. NaN here is the worst of the set: a
  // numeric `trust proxy` is compared as `i < val`, and `i < NaN` is always
  // false, so the app silently trusts NO hop — req.ip becomes the proxy's
  // address for every request and every IP-keyed rate limiter collapses into one
  // global bucket (the failure the comment on `trustProxy` above describes). The
  // ceiling is a sanity bound: more than ten reverse proxies is a typo.
  TRUST_PROXY_HOPS: { min: 0, max: 10 },
  AUTH_VERIFICATION_TTL_HOURS: { min: 1, max: 8760 },
  // Teto de um dia: um link de redefinição que vale mais que isso é uma senha
  // paralela. Piso de cinco minutos porque abaixo disso o próprio atraso de entrega
  // do relay come o prazo inteiro.
  AUTH_PASSWORD_RESET_TTL_MINUTES: { min: 5, max: 1440 },
  HEALTH_DB_TIMEOUT_MS: { min: 100, max: 60000 },
  // Intervalo da amostra periódica de saúde. Piso de 10 s porque abaixo disso o
  // amostrador deixa de ser observador e vira carga no mesmo pool de dez conexões
  // que serve o sync (e enche o `.jsonl` com a própria série). Teto de um dia
  // porque uma amostra menos frequente que isso não forma série nenhuma: é o
  // buraco entre amostras que revela a queda, e com um ponto por dia o buraco não
  // distingue "caiu" de "ainda não amostrou". NaN aqui é o estrago clássico da
  // tabela, `setInterval(NaN)` ≈ a cada 1 ms, agora com uma ida ao banco junto.
  HEALTH_SAMPLE_INTERVAL_MS: { min: 10000, max: 86400000 },
  // Prazo próprio da sonda ao banco dentro da amostra. Mesma faixa do knob do
  // /health: abaixo de 100 ms toda sonda expiraria por latência normal, e acima de
  // 60 s ela deixaria de expirar antes do intervalo default.
  HEALTH_SAMPLE_DB_TIMEOUT_MS: { min: 100, max: 60000 },
  SMTP_PORT: { min: 1, max: 65535 },
});

/**
 * Fail-fast validation of environment variables at boot, grouped by context.
 * Accumulates the errors it reaches (does not stop at the first) and throws once
 * with a readable summary. Call this in `src/index.js` BEFORE starting the server.
 * NOT called from `app.js` (imported by the test suite via supertest).
 *
 * This JSDoc said "Accumulates ALL errors" until 2026-07-25 and that was FALSE for
 * the two variables that matter most. `DATABASE_URL` and `JWT_SECRET` are read by
 * `required()` at MODULE EVALUATION (see `config.db.connectionString` and
 * `config.jwt.secret` above), and `index.js` imports `app.js`, which imports this
 * module, before it can call this function. So a missing one throws
 * `Missing required env var: X` on its own, in English, and the accumulator never
 * runs: whoever forgets three variables discovers them one restart at a time. The
 * two branches below for those names are therefore unreachable from a real boot and
 * only fire when the function is called directly (tests).
 *
 * What the accumulator really governs is everything read with `optional()`: PORT,
 * CORS_ORIGIN, the `NUMERIC_ENV_RULES` table, the token-lifetime grammar, and the
 * production-only conditionals (the 32-char minimum for the secret, which is
 * checked only once the secret exists). Rationale and consequences in
 * `docs/wiki/hardening-borda-api.md`.
 * @throws {Error} if any rule fails.
 */
export function validateEnvVariables() {
  const errors = [];
  // Read NODE_ENV at call time (not the import-time const) so boot-time env
  // overrides and tests exercise the production branch deterministically.
  const isProd = (process.env.NODE_ENV || 'development') === 'production';

  // Database
  if (!process.env.DATABASE_URL) errors.push('DATABASE_URL é obrigatório');

  // Authentication / Security
  const secret = process.env.JWT_SECRET || '';
  if (!secret) errors.push('JWT_SECRET é obrigatório');
  else if (isProd && secret.length < 32) {
    errors.push('JWT_SECRET deve ter >= 32 caracteres em produção');
  }

  // Server
  const port = parseInt(process.env.PORT || '3000', 10);
  if (Number.isNaN(port) || port < 1 || port > 65535) {
    errors.push('PORT deve estar entre 1 e 65535');
  }

  // CORS
  if (isProd && !process.env.CORS_ORIGIN) {
    // In production CORS_ORIGIN MUST be set explicitly — the localhost default is
    // a dev-only placeholder and must never be relied on for a deployed origin.
    errors.push('CORS_ORIGIN é obrigatório em produção');
  }
  if (process.env.CORS_ORIGIN) {
    // Parseability is NOT the property that matters — being a canonical ORIGIN is.
    // `new URL()` happily accepts a trailing slash ('https://host/'), a path, an
    // explicit default port ('https://host:443') and even a comma-separated list
    // ('https://a,https://b' parses as the single hostname 'a,https'). None of
    // those is what a browser sends in the `Origin` header, and app.js passes the
    // raw value to `cors()` as a STRING — a mode in which the package compares
    // nothing and echoes the configured value verbatim into
    // Access-Control-Allow-Origin. The browser then finds it different from its own
    // origin and blocks the response: the backend answers 200 and looks perfectly
    // healthy while the frontend, whose boot is fail-fast on GET /api/config, dies
    // on "EBGeo indisponível". Comparing against `.origin` rejects all of those
    // shapes at boot, which is the only place the mistake is cheap.
    const raw = process.env.CORS_ORIGIN;
    let parsed = null;
    try {
      parsed = new URL(raw);
    } catch {
      errors.push('CORS_ORIGIN deve ser uma URL válida');
    }
    if (parsed && raw !== parsed.origin) {
      errors.push(
        'CORS_ORIGIN deve ser uma ORIGEM canônica (esquema://host[:porta]), sem caminho, '
        + `sem barra final, sem espaços e sem lista — recebido: "${raw}", esperado: "${parsed.origin}"`
      );
    }
  }

  // Self-registration needs a delivery channel, and only in production.
  //
  // With e-mail mandatory on `POST /auth/register`, an account is born pending and is
  // activated ONLY by the `?verify=` link. If there is no relay, `deliver()` degrades to
  // a `logger.error` — so the door keeps creating accounts nobody can ever activate, and
  // it does it quietly. That is the "check that does not check" class, so the boot
  // refuses instead. APP_BASE_URL rides along because `resolveVerificationBase`
  // (utils/mailer.js) only honours a client-supplied origin when it equals cors.origin;
  // unset, the link comes out RELATIVE, which is useless inside an e-mail (and
  // `resend-verification` has no client origin at all).
  //
  // Conditional on self-registration being ON, so a closed installation that never
  // needed a relay still boots. Read at call time, exactly like `isProd` above.
  const selfRegistration = resolveAllowSelfRegistration(
    process.env.NODE_ENV || 'development',
    process.env.ALLOW_SELF_REGISTRATION
  );
  if (isProd && selfRegistration) {
    if (!process.env.SMTP_HOST) {
      errors.push(
        'SMTP_HOST é obrigatório em produção com auto-cadastro ligado: sem relay nenhuma conta '
        + 'nova pode ser confirmada'
      );
    }
    if (!process.env.APP_BASE_URL) {
      errors.push(
        'APP_BASE_URL é obrigatório em produção com auto-cadastro ligado: sem ele o link de '
        + 'confirmação sai relativo'
      );
    }
  }

  // Numeric knobs (P7).
  //
  // Every one of these is read with `parseInt`, which fails SILENTLY: a typo
  // yields NaN and the value flows on to produce badly-broken behaviour rather
  // than an error. The observed cases:
  //   MAX_BULK_UPLOAD_MB=abc      → express.json({ limit: 'NaNmb' }) → NO body limit
  //   WS_HEARTBEAT_INTERVAL_MS=abc → setInterval(NaN) ≈ every 1ms → query storm
  //   DATABASE_POOL_MAX=abc        → invalid pool size
  // Only SET variables are checked — the built-in defaults are known-good.
  for (const [name, { min, max }] of Object.entries(NUMERIC_ENV_RULES)) {
    const raw = process.env[name];
    if (raw === undefined || raw === '') continue;
    // parseInt('12abc') === 12, so the raw string must be fully numeric.
    if (!/^\d+$/.test(raw.trim())) {
      errors.push(`${name} deve ser um inteiro (recebido: "${raw}")`);
      continue;
    }
    const value = parseInt(raw, 10);
    if (value < min || (max !== undefined && value > max)) {
      const range = max !== undefined ? `entre ${min} e ${max}` : `>= ${min}`;
      errors.push(`${name} deve ser ${range} (recebido: ${value})`);
    }
  }

  // Token lifetimes. `parseDuration` (auth.service) returns 0 for anything it
  // cannot parse — and a 0ms refresh expiry means EVERY refresh token is already
  // expired when written, i.e. nobody can stay logged in. '1w' is the classic
  // trap: a natural-looking value that the `[smhd]` grammar does not accept.
  for (const name of ['JWT_ACCESS_EXPIRY', 'JWT_REFRESH_EXPIRY']) {
    const raw = process.env[name];
    if (raw === undefined || raw === '') continue;
    if (!/^\d+[smhd]$/.test(raw.trim())) {
      errors.push(`${name} deve ser um número seguido de s|m|h|d (ex.: 15m, 7d) — recebido: "${raw}"`);
    } else if (parseInt(raw, 10) <= 0) {
      errors.push(`${name} deve ser maior que zero (recebido: "${raw}")`);
    }
  }

  if (errors.length > 0) {
    throw new Error('Configuração inválida:\n  - ' + errors.join('\n  - '));
  }
}

export default config;
