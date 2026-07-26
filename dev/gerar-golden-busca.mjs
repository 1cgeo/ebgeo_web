#!/usr/bin/env node
// Path: dev/gerar-golden-busca.mjs

/**
 * Gera o conjunto dourado de `GET /nomes/busca` (`dev/busca-golden.json`) a partir de
 * um acervo carregado, para calibrar e proteger o ranking de 7 critérios.
 *
 * ## Por que isto existe, e o que ele NÃO é
 *
 * Não é um teste de peso. Peso não se asserta: qualquer valor cravado num assert faz
 * toda tunagem nascer vermelha. O que se asserta é POSIÇÃO, como no `fuzzy-tester` do
 * Pelias: "o esperado tem de estar no top N". Os pesos saem de um relatório, não de
 * uma expectativa.
 *
 * ## A armadilha que motivou o desenho: conjunto dourado vácuo
 *
 * A primeira versão deste conjunto era 300 cidades consultadas pelo nome exato. Recall@1
 * de 100%, e ZERAR CINCO DOS SETE CRITÉRIOS mantinha os 100%. Um conjunto assim passa
 * verde com a fórmula quase toda desligada, ou seja, não prova nada sobre ela. A causa
 * é estrutural: num match exato os cinco critérios de nome disparam JUNTOS, então cada
 * um é testemunha do que os outros quatro já provaram.
 *
 * Daí a regra de projeto: **cada família existe para tensionar um critério específico**,
 * e a ablação (zerar um peso e medir a queda) é o meta-teste que diz se o conjunto está
 * cumprindo isso. Família cujo recall não se mexe quando o critério dela é zerado é
 * família morta, e é para ser reescrita ou removida.
 *
 * ## Verdade objetiva vs política
 *
 * Um caso gerado a partir de uma linha e que espera aquela linha de volta tem verdade
 * CIRCULAR: assume que a linha escolhida é a que o usuário queria. Para nome único isso
 * é inofensivo. Para homônimo é exatamente a pergunta em disputa. Então há dois tipos:
 *
 *   - `espera.alvo = {lon, lat}` — verdade objetiva, uma linha identificada.
 *   - `espera.criterio = {...}`  — POLÍTICA declarada, um predicado sobre quem ocupa o
 *     topo (`max_dist_km`, `tipo_in`, `tipo_peso_min`). Serve para dizer "perto vence"
 *     ou "classe superior vence" SEM fingir que existe uma resposta única.
 *   - `espera.ausente = {...}`   — o `unexpected` do Pelias: o que não pode aparecer.
 *
 * Política é decisão de produto. Está no JSON, em texto, para ser discutida e mudada de
 * propósito, em vez de emergir por acidente de qual linha o gerador sorteou.
 *
 * ## Determinismo
 *
 * Nada de amostragem aleatória: toda seleção é `ORDER BY` estável com `LIMIT`. Rodar
 * duas vezes contra o mesmo acervo dá o mesmo arquivo, e o diff do JSON mostra o que a
 * recarga do acervo mudou.
 *
 * Uso:
 *   node dev/gerar-golden-busca.mjs [--out=dev/busca-golden.json] [--por-familia=60]
 *
 * `DATABASE_URL` sai do ambiente; se ausente, é lido de `backend/.env`.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');
const BACKEND = resolve(REPO, 'backend');

const requireFromBackend = createRequire(pathToFileURL(resolve(BACKEND, 'package.json')));
const pgPromise = requireFromBackend('pg-promise');

const argv = process.argv.slice(2);
const getOpt = (name, fallback) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit === undefined ? fallback : hit.slice(name.length + 3);
};
const OUT = resolve(REPO, getOpt('out', 'dev/busca-golden.json'));
const POR_FAMILIA = Number(getOpt('por-familia', '60'));

function loadBackendEnv() {
  const envPath = resolve(BACKEND, '.env');
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    const [, key, raw] = m;
    if (process.env[key] !== undefined) continue;
    process.env[key] = raw.replace(/^["']|["']$/g, '');
  }
}

// ---------------------------------------------------------------------------
// Deformações de consulta (o usuário digitando)
// ---------------------------------------------------------------------------

const STOPWORDS = new Set(['de', 'da', 'do', 'das', 'dos', 'e']);

/**
 * Primeiros ~65% dos caracteres: quem ainda está digitando.
 *
 * O corte cego caía em cima de preposição e produzia "Córrego do", "Igarapé da":
 * prefixos genéricos que casam milhares de linhas, e cobrar o alvo no top-3 deles
 * mede a sorte do acervo, não o ranking. O corte avança até terminar dentro de uma
 * palavra de conteúdo com pelo menos 3 caracteres. Devolve null quando isso só seria
 * possível consumindo o nome inteiro (aí não é prefixo, é o caso A).
 */
function prefixo(nome) {
  for (let corte = Math.max(4, Math.round(nome.length * 0.65)); corte < nome.length; corte++) {
    const p = nome.slice(0, corte).trimEnd();
    const ultimo = p.split(/\s+/).slice(-1)[0] || '';
    if (ultimo.length >= 3 && !STOPWORDS.has(ultimo.toLowerCase())) return p;
  }
  return null;
}

/**
 * Troca duas letras adjacentes no miolo. É o erro de digitação mais comum em teclado,
 * e o que mais castiga trigrama: inverte DOIS trigramas de uma vez.
 *
 * Nunca atravessa espaço. A primeira versão trocava por posição cega e produzia
 * "Minitéri oPúblico", que não é erro de digitação: é outra tokenização, e mediria
 * uma coisa diferente da que a família se propõe a medir.
 */
function transposicao(nome) {
  const meio = Math.floor(nome.length / 2);
  for (let d = 0; d < nome.length; d++) {
    for (const i of [meio + d, meio - d]) {
      if (i < 0 || i + 1 >= nome.length) continue;
      if (nome[i] === ' ' || nome[i + 1] === ' ') continue;
      return nome.slice(0, i) + nome[i + 1] + nome[i] + nome.slice(i + 2);
    }
  }
  return nome;
}

/** Come uma letra do miolo, nunca um espaço (pelo mesmo motivo). */
function omissao(nome) {
  const meio = Math.floor(nome.length / 2);
  for (let d = 0; d < nome.length; d++) {
    for (const i of [meio + d, meio - d]) {
      if (i < 0 || i >= nome.length || nome[i] === ' ') continue;
      return nome.slice(0, i) + nome.slice(i + 1);
    }
  }
  return nome;
}

/** Remove as preposições, que o usuário quase nunca digita. */
const semStopwords = (nome) =>
  nome.split(/\s+/).filter((p) => !STOPWORDS.has(p.toLowerCase())).join(' ');

/** A última palavra do nome, quando há mais de uma. */
const ultimaPalavra = (nome) => nome.split(/\s+/).slice(-1)[0];

// ---------------------------------------------------------------------------
// Consultas ao acervo
// ---------------------------------------------------------------------------

/**
 * Nomes que ocorrem UMA vez no acervo: verdade objetiva, sem ambiguidade de qual linha
 * é a certa. Duas decisões de amostragem que a primeira versão errou:
 *
 * 1. `ORDER BY md5(nome)`, não `ORDER BY nome`. Alfabético pega a cabeça do alfabeto e
 *    devolveu "A Nordestina Confecções", "A Oca Sarita", "Abáçar Bumburúcema": todas as
 *    famílias derivadas herdavam as MESMAS 60 linhas esquisitas. `md5` espalha e é
 *    determinístico, que é o que se quer (não `random()`, que quebraria o diff do JSON).
 * 2. Estratificado por CLASSE de feição. Nome único é, por definição, o raro, e o raro
 *    do acervo é estabelecimento comercial. Sem estrato, o conjunto inteiro mediria a
 *    busca por lojas, não por topônimo, que é o que um operador procura.
 *
 * `nome = btrim(nome)` corta as linhas com espaço à esquerda (existem, e viravam
 * consultas com espaço inicial que não representam digitação nenhuma).
 */
const Q_UNICOS = `
  WITH bons AS (
    SELECT n.nome, n.tipo, n.municipio, n.estado, n.tipo_peso,
           ST_X(n.geom) AS lon, ST_Y(n.geom) AS lat,
           CASE
             WHEN n.tipo = 'Cidade'                                        THEN 'urbano'
             WHEN n.tipo ~ '(Vila|Povoado|Lugarejo|Núcleo|Nome local)'      THEN 'rural'
             WHEN n.tipo ~ '^(Rio|Lago|Represa|Arroio|Canal|Cachoeira|Laguna)' THEN 'hidrografia'
             WHEN n.tipo ~ '^(Serra|Morro|Pico|Ponta|Praia|Ilha)'           THEN 'relevo'
             WHEN n.tipo_peso <= 0.1                                        THEN 'piso'
             ELSE 'infra'
           END AS classe
      FROM ng.nomes_geograficos n
      JOIN (SELECT nome FROM ng.nomes_geograficos
             GROUP BY nome HAVING count(*) = 1) u ON u.nome = n.nome
     WHERE n.nome = btrim(n.nome)
       AND length(n.nome) BETWEEN 6 AND 28
       AND n.nome !~ '[0-9]'
       AND n.tipo IS NOT NULL
  ),
  espalhado AS (
    SELECT *, row_number() OVER (PARTITION BY classe ORDER BY md5(nome)) AS rn FROM bons
  )
  SELECT nome, tipo, municipio, estado, tipo_peso, lon, lat, classe
    FROM espalhado
   WHERE rn <= $1 AND ($2::text IS NULL OR classe = $2)
   ORDER BY classe, rn`;

/** Nomes muito repetidos: o critério de nome empata em todos, sobra tipo e distância. */
const Q_HOMONIMOS = `
  WITH repetidos AS (
    SELECT nome FROM ng.nomes_geograficos
     GROUP BY nome HAVING count(DISTINCT cluster_id) >= 5
  )
  -- DISTINCT ON (nome): sem ele a familia repetia a MESMA consulta dezenas de vezes
  -- (um caso por ocorrencia do nome), e 60 casos viravam meia duzia de nomes.
  SELECT DISTINCT ON (n.nome)
         n.nome, n.tipo, n.municipio, n.estado, n.tipo_peso,
         ST_X(n.geom) AS lon, ST_Y(n.geom) AS lat,
         (SELECT count(*)::int FROM ng.nomes_geograficos m WHERE m.nome = n.nome) AS ocorrencias
    FROM ng.nomes_geograficos n
    JOIN repetidos r ON r.nome = n.nome
   WHERE ($1::text IS NULL OR n.tipo = $1)
     AND length(n.nome) >= 5
     -- Sem isto a familia enche de codigo: o acervo tem linhas cujo nome e
     -- "13036162" ou "3568627", identificadores de origem e nao toponimo.
     -- Consulta-los mede a busca sobre lixo, e eles sao repetidos (logo, homonimos),
     -- entao caiam aqui com prioridade. (Sem crase neste comentario: a query e um
     -- template literal de JS, e uma crase aqui quebra o modulo inteiro.)
     AND n.nome !~ '[0-9]' AND n.nome = btrim(n.nome)
   ORDER BY n.nome, md5(n.nome || COALESCE(n.tipo,''))
   LIMIT $2`;

/**
 * Colisão de substring: um nome CURTO que é prefixo próprio de outro nome, e as duas
 * ocorrências estão LONGE uma da outra. É o caso que expõe a soma de casamento com
 * importância: o degrau de nome vale 0.20 e o critério de distância inteiro oscila
 * 0.20, então o "Serra" exato do outro lado do país empata ou ganha do "Serra Grande"
 * ao lado. Foi o primeiro defeito medido nesta busca, e é o caso mais valioso do
 * conjunto: nenhuma outra família consegue distingui-lo.
 */
const Q_COLISAO = `
  WITH curtos AS (
    -- O nome curto precisa ser DISTINTIVO. Sem o teto de ocorrências a consulta saía
    -- "Fazenda" e "Igreja", substantivos genéricos que aparecem às centenas: o caso
    -- vira "buscar uma palavra comum", que é outra coisa, e todas as 60 linhas caíam
    -- em meia dúzia de palavras repetidas.
    SELECT n.nome, n.tipo, n.municipio, n.estado,
           ST_X(n.geom) AS lon, ST_Y(n.geom) AS lat
      FROM ng.nomes_geograficos n
      JOIN (SELECT nome FROM ng.nomes_geograficos
             GROUP BY nome HAVING count(*) = 1) u ON u.nome = n.nome
     WHERE length(n.nome) BETWEEN 6 AND 12
       AND n.nome = btrim(n.nome) AND n.nome !~ '[0-9]'
  )
  SELECT DISTINCT ON (c.nome)
         c.nome AS curto, c.lon AS curto_lon, c.lat AS curto_lat, c.tipo AS curto_tipo,
         l.nome AS longo, l.tipo AS longo_tipo, l.municipio AS longo_municipio,
         ST_X(l.geom) AS longo_lon, ST_Y(l.geom) AS longo_lat,
         ST_Distance(ST_SetSRID(ST_MakePoint(c.lon,c.lat),4674)::geography,
                     l.geom::geography) / 1000.0 AS km
    FROM curtos c
    JOIN ng.nomes_geograficos l
      ON l.nome <> c.nome AND l.nome ILIKE c.nome || ' %'
   WHERE ST_Distance(ST_SetSRID(ST_MakePoint(c.lon,c.lat),4674)::geography,
                     l.geom::geography) > 300000
   ORDER BY c.nome, md5(c.nome || l.nome)
   LIMIT $1`;

/**
 * O experimento limpo da doutrina: mesmo NOME ocorrendo como Cidade e como feição
 * menor, as duas dentro do raio, com a MENOR mais perto do centro.
 *
 * Por que esta família precisou existir. Medido nas famílias G e I: em G, 60 de 60
 * casos tinham UMA ÚNICA classe de feição dentro do raio, então a metade "maior
 * importância" da doutrina não decidia nada e a família media só proximidade (o alvo
 * da política era o mais próximo em 100% dos casos). Em I a discordância era 26%.
 * Sem esta família, "importância vence proximidade" não é testado por ninguém, e a
 * calibração poderia zerar o peso de tipo sem nenhum caso reclamar.
 *
 * Aqui as duas metades se OPÕEM por construção: o nome empata em tudo (é o mesmo
 * nome), a feição menor está mais perto, e a doutrina manda a Cidade ganhar.
 */
const Q_IMPORTANCIA = `
  SELECT DISTINCT ON (c.nome)
         c.nome,
         ST_X(c.geom) AS cidade_lon, ST_Y(c.geom) AS cidade_lat,
         ST_X(o.geom) AS outro_lon,  ST_Y(o.geom) AS outro_lat,
         o.tipo AS outro_tipo,
         ST_Distance(c.geom::geography, o.geom::geography)/1000.0 AS km_entre
    FROM ng.nomes_geograficos c
    JOIN ng.nomes_geograficos o
      ON o.nome = c.nome AND o.tipo IS DISTINCT FROM 'Cidade'
   WHERE c.tipo = 'Cidade'
     AND length(c.nome) >= 5
     AND ST_DWithin(c.geom::geography, o.geom::geography, 45000)
     AND ST_Distance(c.geom::geography, o.geom::geography) > 8000
   ORDER BY c.nome, md5(c.nome || o.tipo)
   LIMIT $1`;

// ---------------------------------------------------------------------------
// Montagem dos casos
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// A política de desempate, e por que ela é aplicada AQUI e não na avaliação
// ---------------------------------------------------------------------------

/**
 * Doutrina declarada: **vence a feição de MAIOR IMPORTÂNCIA mais PRÓXIMA do local.**
 * Buscando "Altamira" com o mapa em cima de "Altamira do Paraná", vence Altamira do
 * Paraná, porque é cidade.
 *
 * Ordem grosseira de proeminência. Não é invenção: é a hierarquia EDGV que o próprio
 * acervo já usa em `tipo_peso`, colapsada em quatro degraus. Grosseira de propósito,
 * pelo motivo abaixo.
 */
const CLASSE_RANK = { urbano: 4, rural: 3, natural: 2, infra: 1, piso: 0 };

function classeDe(tipo) {
  const t = (tipo || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (/^Cidade/.test(t)) return 'urbano';
  if (/(Vila|Povoado|Lugarejo|Nucleo|Nome local)/.test(t)) return 'rural';
  if (/^(Rio|Lago|Represa|Arroio|Canal|Cachoeira|Laguna|Serra|Morro|Pico|Ponta|Praia|Ilha)/.test(t)) return 'natural';
  if (!t) return 'piso';
  return 'infra';
}

/**
 * ARMADILHA DESARMADA AQUI: se a expectativa fosse avaliada em tempo de execução como
 * "o topo tem de ser o de maior `tipo_peso` por perto", o conjunto passaria a DEFINIR
 * a resposta certa em função do critério que se quer calibrar. O otimizador então
 * "descobriria" que basta maximizar o peso de `tipo`, e teria descoberto apenas a
 * própria pergunta. Tautologia com cara de medição.
 *
 * Duas defesas:
 *   1. A política é aplicada UMA VEZ, na geração, sobre o conjunto de candidatos (que
 *      é peso-independente), e o resultado vira `espera.alvo`: uma COORDENADA fixa,
 *      auditável no JSON. O avaliador não sabe por que aquele ponto é o certo.
 *   2. A ordenação é GROSSEIRA (4 degraus) e vem da doutrina EDGV, não dos números de
 *      `tipo_peso`. Um `tipo_peso` recalibrado não move o alvo.
 *
 * E resta um detector: se o conjunto tivesse virado tautológico, zerar `tipo` na
 * ablação colapsaria tudo. Se não colapsa, o conjunto não está respondendo a si mesmo.
 */
const norm = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function alvoPorPolitica(candidatos, raioKm, consulta) {
  // "Entre as que CASAM" é parte da doutrina, e faltava: aplicada sobre todos os
  // candidatos, a política escolhia feições vizinhas que só se PARECIAM com a
  // consulta. Medido: em 28 de 60 casos da família G o alvo resolvido tinha um nome
  // diferente do consultado. O conjunto estaria cobrando do ranking uma resposta que
  // a própria doutrina não pede.
  //
  // O `raioKm` NÃO limita mais a comparação de classe, e essa correção veio de um
  // desacordo medido. A doutrina é "a feição de maior importância mais próxima", com
  // a importância sendo CATEGÓRICA: cidade é muito importante, e vem primeiro
  // INDEPENDENTE da distância. Com o teto de 60 km, a família cobrava o contrário:
  // em 9 das 20 falhas dela, o primeiro colocado era uma Cidade do mesmo nome logo
  // fora do raio (65 km, 323 km), ou seja, o ranking acertava e a EXPECTATIVA é que
  // estava velha, congelada numa leitura anterior da política.
  //
  // O raio sobrevive só como piso de sanidade: precisa existir ALGUMA coisa por perto
  // para o caso fazer sentido como consulta de mapa. A escolha do alvo é global.
  const q = norm(consulta);
  const casam = candidatos.filter((c) => norm(c.nome).includes(q));
  if (casam.length === 0 || !casam.some((c) => Number(c.km) <= raioKm)) return null;
  casam.sort((a, b) => {
    const d = CLASSE_RANK[classeDe(b.tipo)] - CLASSE_RANK[classeDe(a.tipo)];
    return d !== 0 ? d : Number(a.km) - Number(b.km);
  });
  return casam[0];
}

/**
 * Candidatos que a busca consideraria para (q, centro). Réplica do pipeline do BUSCA
 * até a desduplicação, que é peso-independente: mesmo conjunto para qualquer vetor de
 * pesos, então o alvo escolhido aqui não depende da calibração.
 */
const Q_CANDIDATOS = `
WITH q AS (SELECT ng.f_unaccent($1) AS term),
candidatos AS (
  SELECT n.nome, n.tipo, n.municipio, n.estado, n.geom, n.cluster_id,
    similarity(ng.f_unaccent(n.nome), q.term) AS sim,
    ST_Distance(n.geom::geography, ST_SetSRID(ST_MakePoint($3, $2), 4674)::geography) AS dist
  FROM ng.nomes_geograficos n, q
  WHERE ng.f_unaccent(n.nome) % ng.f_unaccent($1)
  ORDER BY sim DESC, dist ASC
  LIMIT 500
)
SELECT DISTINCT ON (nome, tipo, cluster_id)
  nome, tipo, municipio, estado, ST_X(geom) AS lon, ST_Y(geom) AS lat, dist/1000.0 AS km
FROM candidatos ORDER BY nome, tipo, cluster_id, dist ASC`;

/** Centro do mapa a ~22 km a nordeste do alvo: o usuário está olhando a região dele. */
const perto = (r) => ({ lat: r.lat + 0.15, lon: r.lon + 0.15 });
/** ~330 km: outra região do mesmo estado. */
const medio = (r) => ({ lat: r.lat + 2.0, lon: r.lon + 2.0 });

const casos = [];
let seq = 0;
function add(familia, q, centro, espera, porque, extra = {}) {
  if (!q || q.trim().length < 3) return; // o schema Joi exige 3 caracteres
  casos.push({
    id: `${familia}-${String(++seq).padStart(4, '0')}`,
    familia,
    q,
    lat: Number(centro.lat.toFixed(6)),
    lon: Number(centro.lon.toFixed(6)),
    espera,
    porque,
    ...extra,
  });
}

const alvoDe = (r) => ({ lon: Number(Number(r.lon).toFixed(6)), lat: Number(Number(r.lat).toFixed(6)) });

async function main() {
  loadBackendEnv();
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL não está no ambiente nem em backend/.env.');
    process.exit(1);
  }
  const pgp = pgPromise();
  const db = pgp(process.env.DATABASE_URL);

  try {
    const total = Number((await db.one('SELECT count(*)::int AS n FROM ng.nomes_geograficos')).n);
    if (total === 0) throw new Error('acervo vazio: carregue o gazetteer antes (dev/import-gazetteer.mjs)');

    // ── A: nome exato e único. Verdade objetiva. Piso de sanidade do ranking. ──
    // Estratificado: mesmo número por classe de feição, para o conjunto não virar um
    // teste sobre nome de loja (que é o que "nome único" devolve se deixado solto).
    const porClasse = Math.max(6, Math.round(POR_FAMILIA / 5));
    const todos = await db.any(Q_UNICOS, [porClasse, null]);
    const unicos = todos.filter((r) => r.classe !== 'piso'); // 'piso' tem família própria (J)
    for (const r of unicos) {
      add('A-exato', r.nome, perto(r), { topo: 1, alvo: alvoDe(r) },
        'nome único no acervo, consultado de perto: se isto falhar, nada mais importa',
        { classe: r.classe, tipo: r.tipo });
    }

    // ── B: sem acento. Prende f_unaccent dos DOIS lados do operador `%`. ──
    const acentuados = unicos.filter((r) => /[À-ú]/.test(r.nome));
    for (const r of acentuados) {
      const semAcento = r.nome.normalize('NFD').replace(/[̀-ͯ]/g, '');
      add('B-sem-acento', semAcento, perto(r), { topo: 1, alvo: alvoDe(r) },
        'usuário brasileiro não digita acento; f_unaccent tem de estar nos dois lados');
    }

    // ── C: prefixo. Tensiona o degrau de prefixo e o critério de comprimento. ──
    for (const r of unicos.filter((r) => r.nome.length >= 9)) {
      add('C-prefixo', prefixo(r.nome), perto(r), { topo: 3, alvo: alvoDe(r) },
        'dropdown enquanto digita: o nome completo tem de aparecer com o prefixo');
    }

    // ── D: erro de digitação. Tensiona trigrama e o limiar de 0.25. ──
    for (const r of unicos.filter((r) => r.nome.length >= 8)) {
      add('D-typo-transposicao', transposicao(r.nome), perto(r), { topo: 3, alvo: alvoDe(r) },
        'troca de letras adjacentes: o erro mais comum de teclado, e o que mais castiga trigrama');
      add('D-typo-omissao', omissao(r.nome), perto(r), { topo: 3, alvo: alvoDe(r) },
        'letra comida no meio');
    }

    // ── E: sem preposição. "Sao Francisco Paula" para "São Francisco de Paula". ──
    for (const r of unicos.filter((r) => semStopwords(r.nome) !== r.nome && semStopwords(r.nome).length >= 6)) {
      add('E-sem-preposicao', semStopwords(r.nome), perto(r), { topo: 3, alvo: alvoDe(r) },
        'o usuário omite de/da/do; só trigrama e "contém" sobrevivem a isso');
    }

    // ── F: última palavra de nome composto. Tensiona "contém" isolado. ──
    for (const r of unicos.filter((r) => r.nome.includes(' ') && ultimaPalavra(r.nome).length >= 5)) {
      add('F-palavra-solta', ultimaPalavra(r.nome), perto(r), { topo: 5, alvo: alvoDe(r) },
        'só a última palavra: o degrau exato e o de prefixo NÃO disparam, sobra "contém" e trigrama');
    }

    // ── G: homônimo consultado de perto. POLÍTICA: maior importância mais próxima. ──
    const RAIO_KM = 60;
    const homonimos = await db.any(Q_HOMONIMOS, [null, POR_FAMILIA]);
    for (const r of homonimos) {
      const centro = perto(r);
      const cands = await db.any(Q_CANDIDATOS, [r.nome, centro.lat, centro.lon]);
      const alvo = alvoPorPolitica(cands, RAIO_KM, r.nome);
      if (!alvo) continue; // sem candidato no raio a política não define resposta: caso inválido
      add('G-homonimo-perto', r.nome, centro,
        { topo: 1, alvo: alvoDe(alvo) },
        `"${r.nome}" ocorre ${r.ocorrencias}x e o nome empata em todas. POLÍTICA aplicada: entre ` +
        `os candidatos a até ${RAIO_KM} km, vence a classe mais proeminente e, no empate, o mais perto. ` +
        `Resolveu para "${alvo.nome}" (${alvo.tipo || 'sem tipo'}, ${Number(alvo.km).toFixed(1)} km). ` +
        'NOTA: medido, nesta família há UMA só classe dentro do raio em ~100% dos casos, então ela ' +
        'exercita a metade PROXIMIDADE da doutrina. Quem exercita a metade IMPORTÂNCIA é a família L',
        { ocorrencias: r.ocorrencias, classe_alvo: classeDe(alvo.tipo), tipo_alvo: alvo.tipo });
    }

    // ── L: importância CONTRA proximidade. O experimento limpo da doutrina. ──
    const disputas = await db.any(Q_IMPORTANCIA, [POR_FAMILIA]);
    for (const r of disputas) {
      // Centro a ~2 km da feição MENOR: ela é a mais próxima, e a Cidade fica de 8 a
      // 45 km. Nome idêntico nas duas, então só tipo e distância decidem, e elas
      // apontam para lados opostos.
      const centro = { lat: Number(r.outro_lat) + 0.02, lon: Number(r.outro_lon) + 0.02 };
      add('L-importancia-vs-proximidade', r.nome, centro,
        { topo: 1, alvo: { lon: Number(Number(r.cidade_lon).toFixed(6)), lat: Number(Number(r.cidade_lat).toFixed(6)) } },
        `"${r.nome}" existe como Cidade e como "${r.outro_tipo}", a ${r.km_entre.toFixed(1)} km uma da ` +
        'outra. O centro está em cima da MENOR. O nome empata (é o mesmo nome), a proximidade aponta ' +
        'para a menor e a doutrina aponta para a Cidade: é o único lugar do conjunto onde as duas ' +
        'metades de "maior importância mais próxima" se opõem',
        { classe_alvo: 'urbano', tipo_alvo: 'Cidade', concorrente: r.outro_tipo,
          km_entre: Number(r.km_entre.toFixed(1)) });
    }

    // ── H: homônimo consultado de LONGE. POLÍTICA: a classe superior vence. ──
    // Tensão central da fórmula: prior (tipo) contra proximidade. É aqui que se decide
    // se `tipo_peso` está calibrado, e é o caso que a ablação mostrou ser o mais caro.
    const homonimosCidade = await db.any(Q_HOMONIMOS, ['Cidade', POR_FAMILIA]);
    for (const r of homonimosCidade) {
      add('H-homonimo-longe', r.nome, medio(r),
        { topo: 3, criterio: { tipo_in: ['Cidade'] } },
        `"${r.nome}" existe como Cidade e como feição menor. POLÍTICA: consultado de ~330 km, ` +
        'a Cidade tem de estar no topo 3, senão o prior de tipo não está pagando',
        { ocorrencias: r.ocorrencias });
    }

    // ── I: colisão de substring a longa distância. O caso que expõe a soma. ──
    // É o caso do enunciado da doutrina: buscar "Altamira" com o mapa em cima de
    // "Altamira do Paraná" tem de devolver Altamira do Paraná, porque é cidade.
    const colisoes = await db.any(Q_COLISAO, [POR_FAMILIA]);
    for (const r of colisoes) {
      const centro = { lat: Number(r.longo_lat) + 0.1, lon: Number(r.longo_lon) + 0.1 };
      const cands = await db.any(Q_CANDIDATOS, [r.curto, centro.lat, centro.lon]);
      const alvo = alvoPorPolitica(cands, RAIO_KM, r.curto);
      if (!alvo) continue;
      add('I-colisao-substring', r.curto, centro,
        { topo: 1, alvo: alvoDe(alvo) },
        `"${r.curto}" (casamento EXATO) fica a ${Math.round(r.km)} km, e "${r.longo}" (só prefixo) ` +
        `está ao lado. POLÍTICA aplicada resolveu para "${alvo.nome}" ` +
        `(${alvo.tipo || 'sem tipo'}, ${Number(alvo.km).toFixed(1)} km). O degrau de nome exato vale ` +
        '0.20 e o critério de distância INTEIRO também: é aqui que a soma de casamento com ' +
        'importância se quebra',
        { alternativa: r.longo, km_ate_o_exato: Math.round(r.km),
          classe_alvo: classeDe(alvo.tipo), tipo_alvo: alvo.tipo });
    }

    // ── J: alvo no piso 0.1. O balde indiferenciado de 29% do acervo. ──
    const piso = await db.any(Q_UNICOS, [POR_FAMILIA, 'piso']);
    for (const r of piso) {
      add('J-piso-tipo', r.nome, perto(r), { topo: 1, alvo: alvoDe(r) },
        `tipo "${r.tipo || '(vazio)'}" cai no piso 0.1: um prior que enterra resultado legítimo ` +
        'aparece aqui antes de aparecer no usuário',
        { classe: 'piso', tipo: r.tipo });
    }

    // ── K: negativos. Sem eles o conjunto premia quem devolve tudo. ──
    for (const lixo of ['xqzwrt', 'zzzyyxw', 'qkjhgfd', 'wxyzabcq']) {
      add('K-negativo-sem-resultado', lixo, { lat: -30.03, lon: -51.23 },
        { vazio: true },
        'string sem trigrama em comum com nada: o limiar de 0.25 tem de cortar tudo');
    }
    // REMOVIDO: um caso `ausente` que cobrava "buscar cemitério não pode trazer Rio no
    // top-5", como proxy da regressão da migração 009. Era um MAU PROXY, e o conjunto
    // o denunciou: o acervo tem rios legitimamente chamados "Rio do Cemitério", então o
    // caso reprovava um resultado CORRETO, e reprovava justamente os modelos que
    // ordenam melhor. Um caso de teste que pune a resposta certa é pior que caso
    // nenhum. A regressão da 009 já tem guarda própria e precisa, no nível do peso:
    // backend/tests/integration/nomes-tipo-peso.test.js.

    // ── Escrita ──
    const porFamilia = {};
    for (const c of casos) porFamilia[c.familia] = (porFamilia[c.familia] || 0) + 1;

    const doc = {
      gerado_de: { linhas_no_acervo: total },
      doutrina:
        'Vence a feição de MAIOR IMPORTÂNCIA mais PRÓXIMA do local, e a importância é ' +
        'CATEGÓRICA, não de entidade: cidade é muito importante e vem primeiro ' +
        'INDEPENDENTE da distância, sem que exista ranking entre cidades. Abaixo desse ' +
        'degrau, vale a combinação de proximidade e importância. ' +
        'Nas famílias G e I a regra foi APLICADA na geração sobre o conjunto de ' +
        'candidatos (que é peso-independente) e congelada como `espera.alvo`, uma ' +
        'coordenada: avaliá-la em tempo de execução usando `tipo_peso` tornaria o ' +
        'conjunto tautológico em relação ao critério que se quer calibrar.',
      importancia_classe: CLASSE_RANK,
      raio_politica_km: 60,
      campos: {
        alvo: 'verdade objetiva: exatamente esta coordenada, com tolerância de 1e-6.',
        topo: 'posição máxima aceitável (o `priorityThresh` do Pelias).',
        tipo_in: 'o topo tem de ser de um destes tipos. Declara "classe superior vence".',
        max_dist_km: 'o topo tem de estar a no máximo N km do centro do mapa.',
        ausente: 'nenhum resultado do top-5 pode casar isto (o `unexpected` do Pelias).',
        vazio: 'a busca não pode devolver nada.',
      },
      familias: porFamilia,
      total: casos.length,
      casos,
    };
    writeFileSync(OUT, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');

    console.log(`acervo: ${total} linhas`);
    for (const [f, n] of Object.entries(porFamilia).sort()) console.log(`  ${f.padEnd(26)} ${n}`);
    console.log(`\ntotal ${casos.length} casos → ${OUT}`);
  } finally {
    await pgp.end();
  }
}

main().catch((err) => {
  console.error(`\nfalhou: ${err.message}`);
  process.exit(1);
});
