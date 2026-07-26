#!/usr/bin/env node
// Path: dev/tune-busca.mjs

/**
 * Avalia e calibra o ranking de `GET /nomes/busca` contra `dev/busca-golden.json`.
 *
 * ## A ideia que torna a calibração viável
 *
 * O caro de avaliar uma configuração de pesos (varredura de trigramas, `ST_Distance`,
 * `DISTINCT ON`) **não depende dos pesos**. Toda a geração de candidatos é
 * peso-independente: o operador `%`, o corte de 500 por `sim DESC, dist ASC` e a
 * escolha do representante do cluster por `dist ASC` não olham peso nenhum. Então a
 * matriz de atributos é EXATA, não uma aproximação, e pode ser materializada uma vez:
 *
 *   1. por caso, os candidatos com os 7 valores crus dos critérios  (uma vez, ~30 s)
 *   2. pontuar um vetor de pesos vira produto escalar               (milissegundos)
 *
 * Sem isso, uma configuração custa ~30 s e explorar o espaço é inviável; com isso,
 * milhares de configurações cabem em segundos.
 *
 * ## O que é assert e o que é relatório
 *
 * Peso NUNCA vira assert: qualquer valor cravado faz toda tunagem nascer vermelha. O
 * contrato que a suíte deve prender é POSIÇÃO (`espera.topo`), no modelo do
 * `fuzzy-tester` do Pelias. Este script produz o relatório que informa a decisão de
 * peso; quem congela comportamento é o teste de integração.
 *
 * Uso:
 *   node dev/tune-busca.mjs                 # avalia os pesos vigentes, por família
 *   node dev/tune-busca.mjs --ablacao       # zera um critério por vez e mede a queda
 *   node dev/tune-busca.mjs --buscar        # procura pesos melhores (amostra + descida)
 *   node dev/tune-busca.mjs --refazer-cache # remonta a matriz de atributos
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
const hasFlag = (n) => argv.includes(`--${n}`);
const getOpt = (n, d) => {
  const h = argv.find((a) => a.startsWith(`--${n}=`));
  return h === undefined ? d : h.slice(n.length + 3);
};

const GOLDEN = resolve(REPO, getOpt('golden', 'dev/busca-golden.json'));
const CACHE = resolve(REPO, getOpt('cache', 'dev/.busca-atributos.json'));
const AMOSTRAS = Number(getOpt('amostras', '4000'));

/** Ordem canônica dos pesos. Espelha `nomes.queries.js`. */
const CRITERIOS = ['exato', 'prefixo', 'contem', 'trigrama', 'comprimento', 'tipo', 'distancia'];
/** Os pesos VIGENTES em produção (`backend/src/modules/nomes/nomes.queries.js`). */
const PESOS_ATUAIS = { exato: 0.20, prefixo: 0.10, contem: 0.15, trigrama: 0.10, comprimento: 0.15, tipo: 0.10, distancia: 0.20 };

function loadBackendEnv() {
  const p = resolve(BACKEND, '.env');
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

// ---------------------------------------------------------------------------
// Matriz de atributos
// ---------------------------------------------------------------------------

/**
 * Réplica fiel do pipeline de candidatos do BUSCA, devolvendo os critérios CRUS em vez
 * do score. Sem `LIMIT 5` (precisamos da posição, não do top-5) e sem o filtro de
 * acesso (o acervo de calibração é todo público). `zoom` não entra porque o frontend
 * não o envia: `decay_dist` fixo em 50 km e `zoom_factor` 0 é a configuração real.
 */
const Q_ATRIBUTOS = `
WITH q AS (SELECT ng.f_unaccent($1) AS term),
candidatos AS (
  SELECT n.nome, n.tipo, n.municipio, n.estado, n.geom, n.tipo_peso, n.cluster_id,
    ng.f_unaccent(n.nome) AS nome_clean,
    similarity(ng.f_unaccent(n.nome), q.term) AS sim,
    ST_Distance(n.geom::geography, ST_SetSRID(ST_MakePoint($3, $2), 4674)::geography) AS dist
  FROM ng.nomes_geograficos n, q
  WHERE ng.f_unaccent(n.nome) % ng.f_unaccent($1)
  ORDER BY sim DESC, dist ASC
  LIMIT 500
),
dedup AS (
  SELECT DISTINCT ON (nome, tipo, cluster_id)
    nome, tipo, municipio, estado, sim, dist, tipo_peso, nome_clean, geom
  FROM candidatos ORDER BY nome, tipo, cluster_id, dist ASC
)
SELECT d.nome, d.tipo, d.municipio, d.estado,
  ST_X(d.geom) AS lon, ST_Y(d.geom) AS lat,
  round((d.dist/1000)::numeric, 3) AS km,
  (CASE WHEN lower(d.nome_clean) = lower(q.term)              THEN 1 ELSE 0 END)::float8 AS exato,
  (CASE WHEN lower(d.nome_clean) LIKE lower(q.term)||'%'      THEN 1 ELSE 0 END)::float8 AS prefixo,
  (CASE WHEN lower(d.nome_clean) LIKE '%'||lower(q.term)||'%' THEN 1 ELSE 0 END)::float8 AS contem,
  d.sim::float8 AS trigrama,
  (1.0 - abs(length(q.term) - length(d.nome_clean))::float
        / GREATEST(length(q.term), length(d.nome_clean), 1))::float8 AS comprimento,
  COALESCE(d.tipo_peso, 0.1)::float8 AS tipo_prior,
  (1.0 / (1.0 + d.dist / 50000.0))::float8 AS distancia
FROM dedup d, q`;

async function montarMatriz(casos) {
  loadBackendEnv();
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL ausente (ambiente ou backend/.env)');
  const pgp = pgPromise();
  const db = pgp(process.env.DATABASE_URL);
  const matriz = {};
  try {
    // O limiar de 0.25 vem do service, não do default 0.3 da extensão. Sem fixá-lo aqui
    // a matriz teria MENOS candidatos que a busca real e a calibração mediria outra coisa.
    await db.none('SET pg_trgm.similarity_threshold = 0.25');
    let i = 0;
    for (const c of casos) {
      const linhas = await db.any(Q_ATRIBUTOS, [c.q, c.lat, c.lon]);
      matriz[c.id] = linhas.map((r) => ({
        nome: r.nome, tipo: r.tipo, municipio: r.municipio, estado: r.estado,
        lon: Number(r.lon), lat: Number(r.lat), km: Number(r.km),
        f: [r.exato, r.prefixo, r.contem, r.trigrama, r.comprimento, r.tipo_prior, r.distancia].map(Number),
      }));
      if (++i % 50 === 0) process.stdout.write(`\r  ${i}/${casos.length} casos`);
    }
    process.stdout.write(`\r  ${casos.length}/${casos.length} casos\n`);
  } finally {
    await pgp.end();
  }
  return matriz;
}

// ---------------------------------------------------------------------------
// Avaliação
// ---------------------------------------------------------------------------

const vetor = (pesos) => CRITERIOS.map((k) => pesos[k]);

/**
 * MODELOS de ordenação. O `soma` é o de produção; os outros dois existem porque o
 * conjunto dourado mostrou que a soma NÃO consegue servir às duas metades da doutrina
 * ao mesmo tempo: o peso de distância que derruba o casamento exato distante (família
 * I) também derruba a Cidade mais distante (família L). Não é falta de calibração, é
 * a forma da função.
 *
 * - `soma`    produto escalar dos 7 critérios. O de hoje.
 * - `produto` casamento MULTIPLICA a importância: casamento ruim não é resgatável por
 *             prior nenhum, que é o que a soma permite.
 * - `lexico`  a doutrina ao pé da letra: agrupa por FAIXA de casamento, e dentro da
 *             faixa ordena por importância e depois por proximidade. "A feição de
 *             maior importância mais próxima, entre as que casam."
 *
 * Nos três, os candidatos são os mesmos: a geração é peso-independente e o modelo só
 * decide a ordem.
 */
const MODELO = getOpt('modelo', 'soma');
const FAIXA = Number(getOpt('faixa', '0.15'));
const ALFA = Number(getOpt('alfa', '0.5'));
/** `gauss`: platô em km (dentro dele a distância não penaliza), escala em km e
 *  expoente da proeminência (0 = ignora tipo, 1 = tipo linear, >1 = tipo domina). */
const PLATO = Number(getOpt('plato', '25'));
const ESCALA = Number(getOpt('escala', '150'));
const GAMA = Number(getOpt('gama', '1'));
/** `google`: degrau de CATEGORIA. `tipo_peso >= TIER` vem antes, independente da
 *  distância. 1.0 = só Cidade; 0.9 = Cidade + aglomerados; 0.85 = + hidrografia. */
const TIER = Number(getOpt('tier', '1.0'));

function ordenar(cands, w) {
  const decorado = cands.map((c, i) => ({ c, i }));
  if (MODELO === 'soma') {
    for (const d of decorado) {
      const f = d.c.f;
      d.s = w[0]*f[0] + w[1]*f[1] + w[2]*f[2] + w[3]*f[3] + w[4]*f[4] + w[5]*f[5] + w[6]*f[6];
    }
    return decorado.sort((a, b) => (b.s - a.s) || (a.i - b.i)).map((x) => x.c);
  }
  if (MODELO === 'produto') {
    // casamento = similaridade contínua de trigramas (f[3]); prior = tipo e distância.
    for (const d of decorado) {
      const f = d.c.f;
      d.s = f[3] * (ALFA * f[5] + (1 - ALFA) * f[6]);
    }
    return decorado.sort((a, b) => (b.s - a.s) || (a.i - b.i)).map((x) => x.c);
  }
  if (MODELO === 'lexico' || MODELO === 'lexico-contem') {
    for (const d of decorado) {
      const f = d.c.f;
      // `lexico-contem`: quando o NOME CONTÉM a consulta, o casamento é PLENO.
      //
      // Digitar "Altamira" com o mapa em cima de "Altamira do Paraná" não é erro de
      // digitação: é um prefixo legítimo. A similaridade de trigramas, porém, pune a
      // diferença de comprimento (1.00 contra ~0.53) e joga os dois em faixas
      // diferentes, onde a importância nunca chega a votar. Tratar containment como
      // casamento pleno põe os dois na MESMA faixa e deixa a doutrina decidir, que é
      // exatamente o que ela existe para fazer.
      const casamento = MODELO === 'lexico-contem' && f[2] === 1 ? 1.0 : f[3];
      d.faixa = Math.floor(casamento / FAIXA); // faixa de qualidade de casamento
      d.prior = f[5];                          // importância
      d.perto = f[6];                          // proximidade (já decaída)
    }
    return decorado
      .sort((a, b) => (b.faixa - a.faixa) || (b.prior - a.prior) || (b.perto - a.perto) || (a.i - b.i))
      .map((x) => x.c);
  }
  if (MODELO === 'gauss') {
    // O padrão canônico da indústria, medido aqui em vez de assumido.
    //
    // Google descreve resultado local como relevância x distância x PROEMINÊNCIA, e diz
    // explicitamente que um resultado mais distante pode vencer um mais perto. A forma
    // que o Elasticsearch (e portanto o Pelias) usa para isso é MULTIPLICATIVA:
    // `function_score` com decaimento `gauss` sobre a distância e `field_value_factor`
    // sobre a popularidade, combinados por `score_mode: multiply`.
    //
    // Duas coisas que a soma não tem e que estão aqui:
    //   1. MULTIPLICAÇÃO: casamento ruim não é resgatável por prior nenhum, e vice-versa.
    //   2. PLATÔ (`offset` do gauss): dentro de N km a distância NÃO penaliza nada, então
    //      ela para de discriminar entre coisas todas próximas e quem decide é o prior.
    //      É a tradução literal de "primeiro os muito importantes, depois a combinação".
    const sigma2 = -(ESCALA * ESCALA) / (2 * Math.log(0.5)); // decay=0.5 na escala
    for (const d of decorado) {
      const f = d.c.f;
      const casamento = f[2] === 1 ? 1.0 : f[3];
      const excedente = Math.max(0, d.c.km - PLATO);
      const decay = Math.exp(-(excedente * excedente) / (2 * sigma2));
      d.s = casamento * Math.pow(f[5], GAMA) * decay;
    }
    return decorado.sort((a, b) => (b.s - a.s) || (a.i - b.i)).map((x) => x.c);
  }
  if (MODELO === 'google') {
    // A tríade do Google (relevância, distância, proeminência) com a proeminência
    // tratada como CATEGORIA, não como entidade: não existe ranking entre cidades,
    // existe o degrau "isto é cidade".
    //
    // Três chaves, nesta ordem:
    //   1. RELEVÂNCIA, em faixa. Containment conta como casamento pleno (digitar
    //      "Altamira" com o mapa em Altamira do Paraná é prefixo legítimo, não erro),
    //      senão os dois caem em faixas diferentes e a categoria nunca chega a votar.
    //   2. CATEGORIA. Acima do degrau (`--tier`), vem primeiro, independente da
    //      distância. É o "cidade é muito importante" em uma linha.
    //   3. COMBINAÇÃO de importância e distância, gaussiana com platô, para ordenar
    //      dentro do degrau e para tudo abaixo dele.
    //
    // A chave 2 é o que a soma NÃO consegue expressar: numa soma, distância suficiente
    // sempre compra a diferença de categoria, porque as duas moram na mesma unidade.
    const sigma2 = -(ESCALA * ESCALA) / (2 * Math.log(0.5));
    for (const d of decorado) {
      const f = d.c.f;
      const casamento = f[2] === 1 ? 1.0 : f[3];
      d.faixa = Math.floor(casamento / FAIXA);
      d.tier = f[5] >= TIER ? 1 : 0;
      const excedente = Math.max(0, d.c.km - PLATO);
      d.s = Math.pow(f[5], GAMA) * Math.exp(-(excedente * excedente) / (2 * sigma2));
    }
    // 4a chave, DESEMPATE: precisão do nome (trigrama cru). Com "contém = casamento
    // pleno", "Serra" e "Serra do Mar" no mesmo ponto e mesmo tipo ficam idênticos nas
    // três primeiras chaves, e a ordem entre eles passa a ser o que o plano devolver.
    // O trigrama cru distingue os dois sem tocar em nada acima dele.
    return decorado
      .sort((a, b) => (b.faixa - a.faixa) || (b.tier - a.tier) || (b.s - a.s)
                   || (b.c.f[3] - a.c.f[3]) || (a.i - b.i))
      .map((x) => x.c);
  }
  throw new Error(`modelo desconhecido: ${MODELO} (soma | produto | lexico | lexico-contem | gauss | google)`);
}

/** Um candidato satisfaz a expectativa do caso? */
function satisfaz(cand, espera) {
  if (espera.alvo) {
    return Math.abs(cand.lon - espera.alvo.lon) < 1e-6 && Math.abs(cand.lat - espera.alvo.lat) < 1e-6;
  }
  const cr = espera.criterio || {};
  if (cr.max_dist_km !== undefined && !(cand.km <= cr.max_dist_km)) return false;
  if (cr.tipo_in && !cr.tipo_in.includes(cand.tipo)) return false;
  if (cr.tipo_peso_min !== undefined && !(cand.f[5] >= cr.tipo_peso_min)) return false;
  return cr.max_dist_km !== undefined || cr.tipo_in !== undefined || cr.tipo_peso_min !== undefined;
}

/**
 * Avalia um caso. Devolve `{ passou, rr }`.
 * `rr` é o recíproco da posição do primeiro candidato que satisfaz, e é o que se
 * otimiza: ele enxerga a diferença entre "caiu para a 2a posição" e "sumiu", que a
 * taxa de aprovação sozinha não vê.
 */
function avaliarCaso(caso, cands, w) {
  const e = caso.espera;
  if (e.vazio) return { passou: cands.length === 0, rr: cands.length === 0 ? 1 : 0 };

  const ordenados = ordenar(cands, w);
  if (e.ausente) {
    const re = e.ausente.tipo_regex ? new RegExp(e.ausente.tipo_regex) : null;
    const violou = ordenados.slice(0, 5).some((c) => re && re.test(c.tipo || ''));
    return { passou: !violou, rr: violou ? 0 : 1 };
  }

  const pos = ordenados.findIndex((c) => satisfaz(c, e)) + 1; // 0 => não achou
  return { passou: pos >= 1 && pos <= (e.topo ?? 5), rr: pos >= 1 ? 1 / pos : 0 };
}

function avaliar(casos, matriz, pesos, filtro = () => true) {
  const w = vetor(pesos);
  const porFamilia = {};
  let passou = 0, somaRR = 0, n = 0;
  for (const caso of casos) {
    if (!filtro(caso)) continue;
    const r = avaliarCaso(caso, matriz[caso.id] || [], w);
    const f = (porFamilia[caso.familia] ??= { n: 0, passou: 0, rr: 0 });
    f.n++; f.passou += r.passou ? 1 : 0; f.rr += r.rr;
    n++; passou += r.passou ? 1 : 0; somaRR += r.rr;
  }
  return { n, taxa: n ? (100 * passou) / n : 0, mrr: n ? somaRR / n : 0, porFamilia };
}

// ---------------------------------------------------------------------------
// Busca no simplex
// ---------------------------------------------------------------------------

/** PRNG semeado: a exploração precisa ser reprodutível para o resultado ser discutível. */
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Ponto uniforme no simplex (Dirichlet(1,…,1)) via exponenciais normalizadas. */
function sortearPesos(rnd) {
  const e = CRITERIOS.map(() => -Math.log(1 - rnd()));
  const s = e.reduce((a, b) => a + b, 0);
  return Object.fromEntries(CRITERIOS.map((k, i) => [k, e[i] / s]));
}

const normalizar = (p) => {
  const s = CRITERIOS.reduce((a, k) => a + Math.max(0, p[k]), 0) || 1;
  return Object.fromEntries(CRITERIOS.map((k) => [k, Math.max(0, p[k]) / s]));
};

const fmt = (p) => CRITERIOS.map((k) => `${k}=${p[k].toFixed(3)}`).join(' ');

// ---------------------------------------------------------------------------

async function main() {
  const doc = JSON.parse(readFileSync(GOLDEN, 'utf8'));
  const casos = doc.casos;

  let matriz;
  if (!hasFlag('refazer-cache') && existsSync(CACHE)) {
    const c = JSON.parse(readFileSync(CACHE, 'utf8'));
    matriz = c.total === casos.length ? c.matriz : null;
    if (!matriz) console.log('cache desatualizado (mudou o conjunto), remontando...');
  }
  if (!matriz) {
    console.log(`montando a matriz de atributos para ${casos.length} casos...`);
    matriz = await montarMatriz(casos);
    writeFileSync(CACHE, JSON.stringify({ total: casos.length, matriz }), 'utf8');
  }

  const candMedios = Math.round(
    Object.values(matriz).reduce((a, v) => a + v.length, 0) / Math.max(1, Object.keys(matriz).length)
  );
  console.log(`${casos.length} casos, ${candMedios} candidatos por caso em média\n`);

  // --pesos=exato=0,trigrama=0.37,... compara uma configuração candidata com a vigente,
  // família a família. Ganho agregado pode esconder regressão local, e é a tabela por
  // família que autoriza (ou não) promover um vetor achado pela busca.
  const spec = getOpt('pesos', '');
  const candidato = spec
    ? normalizar(Object.fromEntries(CRITERIOS.map((k) => {
        const hit = spec.split(',').map((p) => p.split('=')).find(([n]) => n.trim() === k);
        return [k, hit ? Number(hit[1]) : 0];
      })))
    : null;

  const base = avaliar(casos, matriz, PESOS_ATUAIS);
  const cand = candidato ? avaliar(casos, matriz, candidato) : null;
  console.log(`PESOS VIGENTES  aprovação ${base.taxa.toFixed(1)}%   MRR ${base.mrr.toFixed(4)}`);
  if (cand) console.log(`PESOS CANDIDATOS aprovação ${cand.taxa.toFixed(1)}%   MRR ${cand.mrr.toFixed(4)}   (${fmt(candidato)})`);
  console.log(`  família                      n   aprov%    MRR${cand ? '     cand%   candMRR      Δ' : ''}`);
  for (const [f, v] of Object.entries(base.porFamilia).sort()) {
    const a = (100 * v.passou) / v.n;
    let linha = `  ${f.padEnd(26)} ${String(v.n).padStart(3)}  ${a.toFixed(1).padStart(6)}  ${(v.rr / v.n).toFixed(4)}`;
    if (cand) {
      const c = cand.porFamilia[f];
      const ac = (100 * c.passou) / c.n;
      linha += `  ${ac.toFixed(1).padStart(6)}   ${(c.rr / c.n).toFixed(4)}  ${(ac - a >= 0 ? '+' : '') + (ac - a).toFixed(1).padStart(5)}`;
    }
    console.log(linha);
  }

  if (hasFlag('ablacao')) {
    console.log('\nABLAÇÃO (zera um critério, redistribui nada: mede o critério, não a escala)');
    console.log('  critério       peso   aprov%    Δ      MRR      Δ');
    for (const k of CRITERIOS) {
      const p = { ...PESOS_ATUAIS, [k]: 0 };
      const r = avaliar(casos, matriz, p);
      const d1 = r.taxa - base.taxa, d2 = r.mrr - base.mrr;
      console.log(`  ${k.padEnd(13)} ${PESOS_ATUAIS[k].toFixed(2)}  ${r.taxa.toFixed(1).padStart(6)} ${(d1>=0?'+':'')+d1.toFixed(1).padStart(5)}  ${r.mrr.toFixed(4)} ${(d2>=0?'+':'')+d2.toFixed(4)}`);
    }
    console.log('  Critério com Δ ~0 não está sendo exercido pelo conjunto: ou é redundante,');
    console.log('  ou falta família que o tensione. É meta-teste do conjunto, não só do algoritmo.');
  }

  if (hasFlag('buscar')) {
    // Holdout por hash do id: peso que só ajuda no treino é ruído, e com 7 parâmetros
    // e ~550 casos o overfit é modesto mas real.
    const hash = (s) => { let h = 0; for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) | 0; return Math.abs(h); };
    const treino = (c) => hash(c.id) % 10 < 7;
    const teste = (c) => !treino(c);

    const rnd = mulberry32(20260726);
    let melhor = PESOS_ATUAIS, melhorMRR = avaliar(casos, matriz, PESOS_ATUAIS, treino).mrr;
    console.log(`\nBUSCA NO SIMPLEX (${AMOSTRAS} amostras + descida por coordenadas, treino=70%)`);
    for (let i = 0; i < AMOSTRAS; i++) {
      const p = sortearPesos(rnd);
      const m = avaliar(casos, matriz, p, treino).mrr;
      if (m > melhorMRR) { melhorMRR = m; melhor = p; }
    }
    for (const passo of [0.08, 0.04, 0.02, 0.01]) {
      let mudou = true;
      while (mudou) {
        mudou = false;
        for (const k of CRITERIOS) {
          for (const s of [+passo, -passo]) {
            const p = normalizar({ ...melhor, [k]: melhor[k] + s });
            const m = avaliar(casos, matriz, p, treino).mrr;
            if (m > melhorMRR + 1e-9) { melhorMRR = m; melhor = p; mudou = true; }
          }
        }
      }
    }
    const aTreino = avaliar(casos, matriz, PESOS_ATUAIS, treino);
    const aTeste = avaliar(casos, matriz, PESOS_ATUAIS, teste);
    const bTreino = avaliar(casos, matriz, melhor, treino);
    const bTeste = avaliar(casos, matriz, melhor, teste);
    console.log(`  vigente   treino ${aTreino.taxa.toFixed(1)}%/${aTreino.mrr.toFixed(4)}   teste ${aTeste.taxa.toFixed(1)}%/${aTeste.mrr.toFixed(4)}`);
    console.log(`  achado    treino ${bTreino.taxa.toFixed(1)}%/${bTreino.mrr.toFixed(4)}   teste ${bTeste.taxa.toFixed(1)}%/${bTeste.mrr.toFixed(4)}`);
    console.log(`  pesos     ${fmt(melhor)}`);
    console.log('  Ganho que aparece no treino e some no teste é ruído: não promova.');
  }
}

main().catch((e) => { console.error(`\nfalhou: ${e.message}`); process.exit(1); });
