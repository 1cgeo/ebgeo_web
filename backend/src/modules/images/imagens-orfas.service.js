// Path: src/modules/images/imagens-orfas.service.js
/**
 * @fileoverview THE ORPHAN-IMAGE COLLECTOR of the server (owner's decision of 2026-09-24). No blob of
 * `images` used to leave the disk when the feature, the photo or the atlas stopped citing it, and the
 * disk only grew. This module finds the images nothing cites, keeps a mark of WHEN each one lost its
 * last reference, and deletes, on an explicit order only, the ones past the grace periods.
 *
 * THE GOLDEN RULE IS "WHEN IN DOUBT, DO NOT DELETE". Erring towards more (a blob left behind) is cheap;
 * erring towards less deletes a live photo. Every choice below leans that way:
 *   - a citation is ANY UUID token in the text of a source row, in any atlas (`imagens-orfas.fontes.js`
 *     says why the token and not the field);
 *   - an atlas in the trash keeps every image it has, and soft-deleted rows keep citing for a while;
 *   - the operations applied in the last days are a source too;
 *   - an image is deleted only when it is unreferenced for `DIAS_DE_CARENCIA` CONTINUOUS days (the
 *     mark `images.sem_referencia_desde`, zeroed by the trigger `zerar_marca_de_imagem_citada` on any
 *     write that cites it, before or after) AND was created more than `DIAS_DE_CRIACAO` days ago: the
 *     blob goes up BEFORE the operation that cites it, and an offline client can hold that operation
 *     for days, during which the image is, on the server, indistinguishable from an orphan.
 *
 * THREE MODES, and only one of them deletes:
 *   - SIMULATION (the default) runs in a READ ONLY transaction: "the simulation writes nothing" is a
 *     property of Postgres, not of this code;
 *   - MARK writes the marks (starts or restarts the count) and deletes nothing;
 *   - DELETE marks, then deletes the eligible images atlas by atlas, each in a transaction that takes
 *     the SAME lock as the atlas's operations log (`lockAtlasLog`), with the audit row in the same
 *     transaction and the three conditions repeated in the DELETE itself. The file leaves the disk
 *     only AFTER the commit: a failed commit touched no file, and a failed unlink leaves a file with
 *     no row, which is the cheap side.
 *
 * The CLI (`npm run diag -- orfas`) and the admin routes (`/api/v1/diag/imagens-orfas`) call the same
 * functions, so the two doors cannot give two answers.
 */
import { unlink } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { db, pgp } from '../../database/index.js';
import config from '../../config.js';
import logger from '../../utils/logger.js';
import { createAudit } from '../../utils/audit.js';
import { lockAtlasLog } from '../sync/atlas-log-lock.js';
import {
  DIAS_DE_CARENCIA, DIAS_DE_CRIACAO, DIAS_DE_RETENCAO_DE_EXCLUIDA, DIAS_DA_JANELA_DE_OPERACOES,
  PADRAO_DE_UUID, Vida, FONTES_DE_REFERENCIA, TIPOS_QUE_CITAM, ModoDaColeta, MotivoDeCarencia,
} from './imagens-orfas.fontes.js';

export { ModoDaColeta, MotivoDeCarencia };

/** The audit action of a deletion, one row per atlas and per run. */
export const ACAO_DE_REMOCAO = 'IMAGE_ORPHAN_PURGE';

const MODO_SOMENTE_LEITURA = new pgp.txMode.TransactionMode({ readOnly: true });

const DIA_MS = 24 * 60 * 60 * 1000;

/**
 * The SQL filter of a source's rule of life. The day counts are module constants, never input.
 * @param {string} vida
 * @returns {string}
 */
function filtroDeVida(vida) {
  if (vida === Vida.SEMPRE) return 'TRUE';
  if (vida === Vida.EXCLUIDA_NA_RETENCAO) {
    return `(deleted_at IS NULL OR deleted_at > NOW() - make_interval(days => ${DIAS_DE_RETENCAO_DE_EXCLUIDA}))`;
  }
  if (vida === Vida.JANELA_DE_OPERACOES) {
    return `created_at > NOW() - make_interval(days => ${DIAS_DA_JANELA_DE_OPERACOES})`;
  }
  // Fails CLOSED: an unknown rule of life keeps every row citing.
  return 'TRUE';
}

/**
 * The text-capable columns of a source table, read from the MIGRATED schema, minus the ignored ones.
 * A column added to a source table is scanned without an edit anywhere.
 * @param {Object} t - pg-promise context
 * @param {{tabela: string, colunasIgnoradas?: Object}} fonte
 * @returns {Promise<string[]>}
 */
export async function colunasQueCitam(t, fonte) {
  const linhas = await t.any(
    `SELECT column_name, data_type FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1
      ORDER BY ordinal_position`,
    [fonte.tabela]
  );
  const ignoradas = fonte.colunasIgnoradas || {};
  return linhas
    .filter((l) => TIPOS_QUE_CITAM.includes(l.data_type) && !Object.hasOwn(ignoradas, l.column_name))
    .map((l) => l.column_name);
}

/**
 * Every image id some source cites, and how many images each source cites (a source can cite an
 * image another one cites too).
 *
 * IN MEMORY, AND NOT A TEMPORARY TABLE, because the simulation runs in a READ ONLY transaction and
 * Postgres refuses every CREATE there, temporary tables included. Only ids that ARE images come back
 * (the join with `images`), so the set is at most the size of that table.
 * @param {Object} t - pg-promise transaction
 * @param {ReadonlyArray<Object>} [fontes] - For the negative control of the tests; production uses all.
 * @returns {Promise<{ids: string[], porFonte: Object<string, number>}>}
 */
export async function coletarImagensCitadas(t, fontes = FONTES_DE_REFERENCIA) {
  const todas = new Set();
  const porFonte = {};
  for (const fonte of fontes) {
    const colunas = await colunasQueCitam(t, fonte);
    if (colunas.length === 0) {
      porFonte[fonte.tabela] = 0;
      continue;
    }
    const texto = colunas.map((c) => `${pgp.as.name(c)}::text`).join(', ');
    const linhas = await t.any(
      `SELECT DISTINCT c.id
         FROM (SELECT lower(x.m[1])::uuid AS id
                 FROM (SELECT regexp_matches(concat_ws(' ', ${texto}), $1, 'g') AS m
                         FROM ${pgp.as.name(fonte.tabela)}
                        WHERE ${filtroDeVida(fonte.vida)}) x) c
         JOIN images i ON i.id = c.id`,
      [PADRAO_DE_UUID]
    );
    porFonte[fonte.tabela] = linhas.length;
    for (const l of linhas) todas.add(l.id);
  }
  return { ids: [...todas], porFonte };
}

/**
 * The images nothing cites, each with the facts the rules need. Cited images are not listed.
 * @param {Object} t - pg-promise transaction
 * @param {string[]} citadas - From `coletarImagensCitadas`
 * @param {string|null} atlasId - Restrict to one atlas (the reference check stays global)
 * @returns {Promise<Object[]>}
 */
async function lerSemCitacao(t, citadas, atlasId) {
  return t.any(
    `SELECT i.id, i.atlas_id, a.name AS atlas_nome, i.filename, i.size_bytes, i.created_at,
            i.sem_referencia_desde, (a.deleted_at IS NOT NULL) AS na_lixeira,
            (i.created_at <= NOW() - make_interval(days => $2)) AS criacao_vencida,
            (i.sem_referencia_desde IS NOT NULL
              AND i.sem_referencia_desde <= NOW() - make_interval(days => $3)) AS marca_vencida,
            NOW() AS agora
       FROM images i
       JOIN atlas a ON a.id = i.atlas_id
       LEFT JOIN unnest($4::uuid[]) AS c(id) ON c.id = i.id
      WHERE c.id IS NULL
        AND ($1::uuid IS NULL OR i.atlas_id = $1::uuid)
      ORDER BY a.name, i.created_at, i.id`,
    [atlasId, DIAS_DE_CRIACAO, DIAS_DE_CARENCIA, citadas]
  );
}

/** Counts of the table (or of one atlas), for the summary. */
async function lerTotais(t, citadas, atlasId) {
  return t.one(
    `SELECT COUNT(*)::int AS total,
            COUNT(c.id)::int AS citadas,
            COALESCE(SUM(i.size_bytes), 0)::bigint AS bytes
       FROM images i
       LEFT JOIN unnest($2::uuid[]) AS c(id) ON c.id = i.id
      WHERE ($1::uuid IS NULL OR i.atlas_id = $1::uuid)`,
    [atlasId, citadas]
  );
}

/**
 * Writes the marks: NULL for a cited image or one in the trash, NOW() for an uncited one without a
 * mark. A mark already set is kept: it says since when the image is unreferenced.
 * @param {Object} t - pg-promise transaction
 * @param {string[]} citadas - From `coletarImagensCitadas`
 * @returns {Promise<{postas: number, zeradas: number}>}
 */
async function escreverMarcas(t, citadas) {
  const zeradas = await t.result(
    `UPDATE images i SET sem_referencia_desde = NULL
      WHERE i.sem_referencia_desde IS NOT NULL
        AND (i.id IN (SELECT unnest($1::uuid[]))
             OR EXISTS (SELECT 1 FROM atlas a WHERE a.id = i.atlas_id AND a.deleted_at IS NOT NULL))`,
    [citadas]
  );
  const postas = await t.result(
    `UPDATE images i SET sem_referencia_desde = NOW()
      WHERE i.sem_referencia_desde IS NULL
        AND i.id NOT IN (SELECT unnest($1::uuid[]))
        AND NOT EXISTS (SELECT 1 FROM atlas a WHERE a.id = i.atlas_id AND a.deleted_at IS NOT NULL)`,
    [citadas]
  );
  return { postas: postas.rowCount, zeradas: zeradas.rowCount };
}

/** Whole days left until a timestamp is `dias` old (0 when it already is). */
function diasQueFaltam(desde, dias, agora) {
  if (!desde) return dias;
  const falta = new Date(desde).getTime() + dias * DIA_MS - new Date(agora).getTime();
  return falta <= 0 ? 0 : Math.ceil(falta / DIA_MS);
}

/**
 * Splits the uncited images into eligible and in grace, with the reason and the days left.
 * An image in the trash is neither: it is reported apart and never touched.
 * @param {Object[]} linhas - From `lerSemCitacao`
 * @param {boolean} marcasEscritas - Whether this run wrote the marks (a mark-less image just got one)
 */
function classificar(linhas, marcasEscritas) {
  const elegiveis = [];
  const emCarencia = [];
  const naLixeira = [];
  for (const l of linhas) {
    const item = {
      id: l.id,
      atlasId: l.atlas_id,
      atlasNome: l.atlas_nome,
      filename: l.filename,
      bytes: Number(l.size_bytes ?? 0),
      criadaEm: l.created_at,
      semReferenciaDesde: l.sem_referencia_desde,
    };
    if (l.na_lixeira) {
      naLixeira.push(item);
      continue;
    }
    if (l.criacao_vencida && l.marca_vencida) {
      elegiveis.push(item);
      continue;
    }
    const semMarca = !l.sem_referencia_desde;
    const motivo = semMarca
      ? MotivoDeCarencia.SEM_MARCA
      : (!l.marca_vencida ? MotivoDeCarencia.MARCA_RECENTE : MotivoDeCarencia.JOVEM);
    const faltamDias = Math.max(
      diasQueFaltam(l.created_at, DIAS_DE_CRIACAO, l.agora),
      // A mark-less image starts counting at the next run that writes marks (this one, when it did).
      semMarca && !marcasEscritas ? DIAS_DE_CARENCIA : diasQueFaltam(l.sem_referencia_desde ?? l.agora, DIAS_DE_CARENCIA, l.agora)
    );
    emCarencia.push({ ...item, motivo, faltamDias });
  }
  return { elegiveis, emCarencia, naLixeira };
}

/** Groups items by atlas, with counts and bytes. */
function porAtlas(itens) {
  const grupos = new Map();
  for (const item of itens) {
    const g = grupos.get(item.atlasId) ?? { atlasId: item.atlasId, atlasNome: item.atlasNome, quantidade: 0, bytes: 0, imagens: [] };
    g.quantidade += 1;
    g.bytes += item.bytes;
    g.imagens.push(item);
    grupos.set(item.atlasId, g);
  }
  return [...grupos.values()];
}

const somaDeBytes = (itens) => itens.reduce((s, i) => s + i.bytes, 0);

/** The rules the run applied, in the report so a reader never has to guess them. */
function regras() {
  return {
    diasDeCarencia: DIAS_DE_CARENCIA,
    diasDeCriacao: DIAS_DE_CRIACAO,
    diasDeRetencaoDeExcluida: DIAS_DE_RETENCAO_DE_EXCLUIDA,
    diasDaJanelaDeOperacoes: DIAS_DA_JANELA_DE_OPERACOES,
    fontes: FONTES_DE_REFERENCIA.map((f) => f.tabela),
  };
}

/**
 * The census of the run: references, marks (when the mode writes them) and the classification.
 * @param {Object} t - pg-promise transaction
 * @param {{atlasId: string|null, escrever: boolean, fontes?: ReadonlyArray<Object>}} opcoes
 */
async function levantar(t, { atlasId, escrever, fontes }) {
  const { ids: citadas, porFonte: citacoesPorFonte } = await coletarImagensCitadas(t, fontes);
  const marcas = escrever ? await escreverMarcas(t, citadas) : null;
  const totais = await lerTotais(t, citadas, atlasId);
  const linhas = await lerSemCitacao(t, citadas, atlasId);
  const { elegiveis, emCarencia, naLixeira } = classificar(linhas, escrever);
  return {
    regras: regras(),
    imagens: {
      total: totais.total,
      citadas: totais.citadas,
      semCitacao: linhas.length,
      naLixeira: naLixeira.length,
      bytes: Number(totais.bytes),
    },
    citacoesPorFonte,
    marcas,
    elegiveis: { quantidade: elegiveis.length, bytes: somaDeBytes(elegiveis), porAtlas: porAtlas(elegiveis) },
    emCarencia: { quantidade: emCarencia.length, bytes: somaDeBytes(emCarencia), itens: emCarencia },
  };
}

/**
 * The SIMULATION: what a deletion would remove NOW, in a READ ONLY transaction. Writes nothing, not
 * even the marks: an image without a mark is reported as such, with the full grace ahead of it.
 * @param {{atlasId?: string|null, fontes?: ReadonlyArray<Object>}} [opcoes]
 */
export async function simularColetaDeOrfas({ atlasId = null, fontes } = {}) {
  const relatorio = await db.tx({ mode: MODO_SOMENTE_LEITURA }, (t) => levantar(t, { atlasId, escrever: false, fontes }));
  return { modo: ModoDaColeta.SIMULACAO, ...relatorio };
}

/**
 * MARK: writes the marks and deletes nothing. The marks are global (they describe the image, not the
 * run), so `atlasId` only narrows the report.
 * @param {{atlasId?: string|null}} [opcoes]
 */
export async function marcarOrfas({ atlasId = null, fontes } = {}) {
  const relatorio = await db.tx((t) => levantar(t, { atlasId, escrever: true, fontes }));
  return { modo: ModoDaColeta.MARCAR, ...relatorio };
}

/**
 * Whether a stored path is inside the images directory. The collector never unlinks outside it,
 * whatever a row says.
 */
function dentroDoDiretorioDeImagens(caminho) {
  const raiz = resolve(config.images.dir) + sep;
  return typeof caminho === 'string' && resolve(caminho).startsWith(raiz);
}

/**
 * DELETE: marks, then deletes the eligible images, atlas by atlas.
 *
 * Per atlas, one transaction: the atlas's log lock FIRST (a push to that atlas waits, and its
 * trigger then finds the row gone), the DELETE repeating the three conditions (a mark zeroed by the
 * trigger after the census takes the image out right there), and the audit row. Files after commit.
 *
 * @param {{atorId: string, req?: Object|null, atlasId?: string|null, fontes?: ReadonlyArray<Object>}} opcoes
 */
export async function apagarOrfas({ atorId, req = null, atlasId = null, fontes } = {}) {
  if (!atorId) throw new Error('apagarOrfas: atorId is required (audit_trail.actor_id is NOT NULL)');
  const relatorio = await db.tx((t) => levantar(t, { atlasId, escrever: true, fontes }));

  const apagadasPorAtlas = [];
  const arquivosNaoRemovidos = [];
  for (const grupo of relatorio.elegiveis.porAtlas) {
    const ids = grupo.imagens.map((i) => i.id);
    const linhas = await db.tx(async (t) => {
      await lockAtlasLog(t, grupo.atlasId);
      const apagadas = await t.any(
        `DELETE FROM images i
          WHERE i.atlas_id = $1
            AND i.id = ANY($2::uuid[])
            AND i.sem_referencia_desde IS NOT NULL
            AND i.sem_referencia_desde <= NOW() - make_interval(days => $3)
            AND i.created_at <= NOW() - make_interval(days => $4)
            AND NOT EXISTS (SELECT 1 FROM atlas a WHERE a.id = i.atlas_id AND a.deleted_at IS NOT NULL)
          RETURNING i.id, i.filename, i.size_bytes, i.storage_path`,
        [grupo.atlasId, ids, DIAS_DE_CARENCIA, DIAS_DE_CRIACAO]
      );
      if (apagadas.length > 0) {
        await createAudit(req, {
          action: ACAO_DE_REMOCAO,
          actorId: atorId,
          targetType: 'ATLAS',
          targetId: grupo.atlasId,
          targetName: String(grupo.atlasNome ?? '').slice(0, 255),
          details: {
            quantidade: apagadas.length,
            bytes: apagadas.reduce((s, a) => s + Number(a.size_bytes ?? 0), 0),
            carenciaDias: DIAS_DE_CARENCIA,
            imagens: apagadas.map((a) => ({ id: a.id, filename: a.filename, bytes: Number(a.size_bytes ?? 0) })),
          },
        }, t);
      }
      return apagadas;
    });

    for (const linha of linhas) {
      if (!dentroDoDiretorioDeImagens(linha.storage_path)) {
        arquivosNaoRemovidos.push({ id: linha.id, caminho: linha.storage_path, motivo: 'fora-do-diretorio' });
        continue;
      }
      try {
        await unlink(linha.storage_path);
      } catch (err) {
        if (err.code === 'ENOENT') continue;
        logger.warn({ err, id: linha.id, caminho: linha.storage_path }, 'Orphan image: row deleted, file kept');
        arquivosNaoRemovidos.push({ id: linha.id, caminho: linha.storage_path, motivo: err.code || 'erro' });
      }
    }
    if (linhas.length > 0) {
      apagadasPorAtlas.push({
        atlasId: grupo.atlasId,
        atlasNome: grupo.atlasNome,
        quantidade: linhas.length,
        bytes: linhas.reduce((s, a) => s + Number(a.size_bytes ?? 0), 0),
        imagens: linhas.map((a) => ({ id: a.id, filename: a.filename, bytes: Number(a.size_bytes ?? 0) })),
      });
    }
  }

  return {
    modo: ModoDaColeta.APAGAR,
    ...relatorio,
    apagadas: {
      quantidade: apagadasPorAtlas.reduce((s, g) => s + g.quantidade, 0),
      bytes: apagadasPorAtlas.reduce((s, g) => s + g.bytes, 0),
      porAtlas: apagadasPorAtlas,
      arquivosNaoRemovidos,
    },
  };
}
