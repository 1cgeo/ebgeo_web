// Path: src/modules/streetview360/sv360.pyramid.js
/**
 * @module streetview360/sv360.pyramid
 * @description O ÚNICO caminho por onde a pirâmide sai do `{slug}_tiles.db` da origem
 * e entra em `sv360.photo_pyramids`.
 *
 * POR QUE ESTE ARQUIVO NASCEU. A tabela do Postgres existia, a query de UPSERT existia
 * e a ingestão LIA a pirâmide do SQLite para conferir cobertura — e jogava a leitura
 * fora. Resultado: `sv360.photo_pyramids` não tinha UM escritor, `GET
 * /photos/:uuid/tiles.json` respondia 404 para toda foto, e o cliente, que trata 404
 * como "esta foto tem blob", caía no `image?quality=full` que a origem apagou em
 * 2026-08-20. O acervo inteiro chegava sem pintar, e nenhuma suíte ficava vermelha
 * porque as duas pontas eram medidas com fixture escrito à mão.
 *
 * SÃO DUAS TABELAS COM NOMES QUASE IGUAIS, e trocá-las é o erro barato:
 *   - `tile_pyramids` (SQLite, dentro do `{slug}_tiles.db`) é o registro DA ORIGEM;
 *   - `sv360.photo_pyramids` (Postgres) é o que este servidor serve.
 * Este módulo é a ponte, e ela é de mão única.
 *
 * A LEITURA É TOLERANTE POR MEDIÇÃO, NÃO POR GENEROSIDADE. O esquema da origem
 * variou ao longo do acervo: há `{slug}_tiles.db` com dez colunas em `tile_pyramids`
 * e há com nove (sem `razao`). Cinco colunas são EXIGIDAS, porque sem elas não há
 * escada nenhuma (`photo_id`, `tile_size`, `max_level`, `width`, `height`); as
 * outras têm origem declarada, e nenhuma delas decide a grade:
 *   - `razao` ausente vale `RAZAO_PADRAO`, que é ao mesmo tempo o default da coluna
 *     no Postgres e o fallback de `escadaGravada`, então descritor e grade concordam;
 *   - `tile_count`/`total_bytes` ausentes são CONTADOS da tabela `tiles` do próprio
 *     arquivo, e só caem para zero se nem ela existir;
 *   - `built_at` e `quality` são cosméticos (assinatura de ETag e rótulo), e o
 *     default aqui é explícito para não violar o NOT NULL da coluna.
 * Nenhuma tolerância alcança `tile_size`/`width`/`height`/`max_level`: eles saem
 * CRUS, para que `validatePyramidCoverage` possa reprovar a escada degenerada antes
 * de qualquer escrita, e para que o CHECK do banco continue sendo a última guarda.
 */

import { existsSync } from 'node:fs';
import Database from 'better-sqlite3';
import { AppError, BadRequestError } from '../../utils/errors.js';
import { RAZAO_PADRAO } from './sv360.escada.js';
import { UPSERT_PHOTO_PYRAMID } from './sv360.pyramid.queries.js';

/** Qualidade WebP assumida quando a origem não a gravou. É rótulo, não contrato. */
const QUALIDADE_PADRAO = 80;

/**
 * As colunas de `tile_pyramids` sem as quais NÃO existe escada.
 *
 * `photo_id` fica de fora da lista de projeção porque é a chave da busca; as quatro
 * restantes são exatamente as que `escadaGravada` consome (com `razao`, que tem
 * default). Faltando qualquer uma, o arquivo é recusado com o nome da coluna: uma
 * mensagem genérica manda o operador procurar corrupção num arquivo perfeito.
 * @constant {string[]}
 */
const COLUNAS_EXIGIDAS = ['photo_id', 'tile_size', 'max_level', 'width', 'height'];

/** As que entram quando existem, cada uma com fallback documentado no cabeçalho. */
const COLUNAS_OPCIONAIS = ['quality', 'tile_count', 'total_bytes', 'built_at', 'razao'];

/**
 * Converte o `built_at` da origem num `Date`, aceitando as três formas que um SQLite
 * sem tipagem forte entrega.
 *
 * NUNCA LANÇA, e isso é decisão: `built_at` é a assinatura do ETag do descritor, e
 * derrubar a ingestão de um acervo de 120 GB por causa de um carimbo de data ilegível
 * troca um defeito cosmético por um bloqueio. O que ele não pode fazer é mandar a
 * string crua para uma coluna TIMESTAMPTZ, porque um epoch gravado como texto
 * levanta `22P02` e o erro chega ao operador sem relação aparente com o assunto.
 * @param {*} valor - o que veio da coluna
 * @returns {Date} o instante da gravação, ou agora quando não há um legível
 */
function normalizarInstante(valor) {
  if (valor instanceof Date && !Number.isNaN(valor.getTime())) return valor;
  if (typeof valor === 'number' && Number.isFinite(valor)) {
    // Epoch em SEGUNDOS abaixo de 1e12 (o ano 33658 em segundos), em ms acima.
    return new Date(valor < 1e12 ? valor * 1000 : valor);
  }
  if (typeof valor === 'string' && valor.trim()) {
    const d = new Date(valor);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return new Date();
}

/**
 * Conta os tiles de cada foto direto da tabela `tiles`, quando `tile_pyramids` não
 * traz os agregados.
 *
 * UMA VARREDURA SÓ, agrupada, e não uma consulta por foto: `length(webp)` no SQLite
 * sai do cabeçalho do registro, então o custo é o do índice, mas mil `.get()` num
 * arquivo de dezenas de GB pagam mil descidas de B-tree por nada.
 * @param {Database} tdb - o `{slug}_tiles.db` aberto readonly
 * @returns {Map<string, {tileCount:number, totalBytes:number}>|null} null sem `tiles`
 */
function contarTiles(tdb) {
  const tem = tdb
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='tiles'")
    .get();
  if (!tem) return null;
  const mapa = new Map();
  const linhas = tdb
    .prepare('SELECT photo_id, count(*) AS n, sum(length(webp)) AS b FROM tiles GROUP BY photo_id')
    .all();
  for (const l of linhas) {
    mapa.set(String(l.photo_id), {
      tileCount: Number(l.n) || 0,
      totalBytes: Number(l.b) || 0,
    });
  }
  return mapa;
}

/**
 * Lê do `{slug}_tiles.db` a pirâmide de cada foto pedida.
 *
 * Devolve um mapa POR FOTO ENCONTRADA, e o silêncio é resposta legítima: um acervo
 * misto (blob para umas fotos, pirâmide para outras) é estado normal, e quem exige
 * cobertura total é `validatePyramidCoverage`, com a mensagem que nomeia a foto.
 *
 * @param {string|null} tilesDbPath - caminho do `{slug}_tiles.db`, ou null/ausente
 * @param {string[]} photoIds - as fotos vivas do manifesto
 * @returns {Map<string, Object>} photoId -> descritor pronto para `gravarPiramides`
 * @throws {BadRequestError} 400 quando o arquivo existe e não serve. A enumeração que
 *   esta linha carregava (não é SQLite, não tem `tile_pyramids`, faltam colunas) era
 *   só a metade previsível: o mesmo 400 sai de tudo o que impede ABRIR ou LER o
 *   arquivo (`EBUSY`, `EACCES`, `SQLITE_CANTOPEN_ISDIR`, `EMFILE`, disco cheio, I/O),
 *   e é por isso que o original viaja em `cause`. O texto do cliente é único de
 *   propósito; quem separa os desfechos é a linha de log.
 */
export function lerPiramides(tilesDbPath, photoIds) {
  const piramides = new Map();
  if (!tilesDbPath || !existsSync(tilesDbPath) || !photoIds?.length) return piramides;

  let tdb;
  try {
    tdb = new Database(tilesDbPath, { readonly: true, fileMustExist: true });
  } catch (err) {
    // A CAUSA VAI JUNTO, e este é o sítio em que ela mais paga: o que falha ao ABRIR
    // quase nunca é o formato. `EBUSY` (outro processo segurando o arquivo), `EACCES`
    // (permissão), `EMFILE` e disco cheio chegam todos aqui, e traduzi-los sem a causa
    // manda o operador procurar corrupção num arquivo perfeito. A mensagem do cliente
    // NÃO muda: a causa viaja em `cause`, que só o log lê. Ver o contrato no topo de
    // `src/utils/errors.js`.
    throw new BadRequestError('tiles.db is not a valid SQLite file', { cause: err });
  }
  try {
    // O construtor NÃO pega arquivo que não é SQLite: `sqlite3_open()` não lê o
    // cabeçalho, e o SQLITE_NOTADB só aparece no PRIMEIRO statement. Por isso a
    // tradução para 400 mora no catch de baixo, e não ali em cima sozinha.
    const tabela = tdb
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='tile_pyramids'")
      .get();
    if (!tabela) throw new BadRequestError('tiles.db has no `tile_pyramids` table');

    const colunas = new Set(
      tdb.prepare('PRAGMA table_info(tile_pyramids)').all().map((c) => c.name)
    );
    for (const nome of COLUNAS_EXIGIDAS) {
      if (!colunas.has(nome)) {
        throw new BadRequestError(`tiles.db: \`tile_pyramids\` has no \`${nome}\` column`);
      }
    }

    const presentes = [
      ...COLUNAS_EXIGIDAS.filter((c) => c !== 'photo_id'),
      ...COLUNAS_OPCIONAIS.filter((c) => colunas.has(c)),
    ];
    // Nomes de coluna vêm de uma allowlist deste arquivo, nunca do input: o único
    // valor do chamador que entra na consulta é o `photo_id`, e ele é parametrizado.
    const stmt = tdb.prepare(
      `SELECT ${presentes.join(', ')} FROM tile_pyramids WHERE photo_id = ?`
    );

    // Os agregados só se contam quando a origem não os gravou: varrer a tabela de
    // tiles de um projeto inteiro para reencontrar um número que já está na linha
    // seria pagar I/O por informação que se tem.
    const contados = colunas.has('tile_count') && colunas.has('total_bytes')
      ? null
      : contarTiles(tdb);

    for (const id of photoIds) {
      const linha = stmt.get(id);
      if (!linha) continue;
      const agregado = contados?.get(String(id)) ?? null;
      const razao = Number(linha.razao);
      const quality = Number(linha.quality);
      piramides.set(id, {
        photoId: id,
        // CRUS de propósito: quem reprova escada degenerada é a validação de PASSO 0,
        // e o CHECK da coluna é a última guarda. Normalizar aqui apagaria as duas.
        tileSize: linha.tile_size,
        maxLevel: linha.max_level,
        width: linha.width,
        height: linha.height,
        quality: Number.isFinite(quality) && quality > 0 ? quality : QUALIDADE_PADRAO,
        tileCount: Math.max(0, Number(linha.tile_count ?? agregado?.tileCount ?? 0) || 0),
        totalBytes: Math.max(0, Number(linha.total_bytes ?? agregado?.totalBytes ?? 0) || 0),
        builtAt: normalizarInstante(linha.built_at),
        // O mesmo fallback de `escadaGravada`: descritor e grade da rota do tile
        // precisam sair da MESMA razão, senão o cliente pede tile que não existe.
        razao: Number.isFinite(razao) && razao > 1 ? razao : RAZAO_PADRAO,
      });
    }
  } catch (err) {
    if (err instanceof AppError) throw err;
    // Idem: aqui cai o `SQLITE_NOTADB` do primeiro statement (que é o caso que a
    // mensagem descreve), mas cai também I/O de leitura, arquivo truncado no meio e
    // `SQLITE_CORRUPT` de página, e os quatro são desfechos diferentes com o mesmo
    // texto. `cause` é a única coisa que os separa depois do fato.
    throw new BadRequestError('tiles.db is not a valid SQLite file', { cause: err });
  } finally {
    try {
      tdb.close();
    } catch {
      // fechar já fechado não é erro
    }
  }
  return piramides;
}

/**
 * Grava as pirâmides lidas, NA MESMA TRANSAÇÃO do merge do projeto.
 *
 * A ORDEM É OBRIGATÓRIA: `mergeProject` purga e reinsere `sv360.photos`, e
 * `photo_pyramids.photo_id` é FK com `ON DELETE CASCADE`. Chamar isto ANTES do merge
 * escreve linhas que o purge apaga em seguida, sem erro nenhum.
 *
 * @param {Object} t - o handle de transação (pg-promise) do merge
 * @param {Map<string, Object>|Iterable<Object>} piramides - saída de `lerPiramides`
 * @returns {Promise<number>} quantas linhas foram gravadas
 */
export async function gravarPiramides(t, piramides) {
  const lista = piramides instanceof Map ? [...piramides.values()] : [...(piramides ?? [])];
  for (const p of lista) {
    await t.none(UPSERT_PHOTO_PYRAMID, [
      p.photoId,
      p.tileSize,
      p.maxLevel,
      p.width,
      p.height,
      p.quality,
      p.tileCount,
      p.totalBytes,
      p.builtAt,
      p.razao,
    ]);
  }
  return lista.length;
}
