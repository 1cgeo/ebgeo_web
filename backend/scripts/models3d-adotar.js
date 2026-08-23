#!/usr/bin/env node
// Path: scripts/models3d-adotar.js
// REGISTRA UM `.3dtiles` QUE JÁ ESTÁ EM DISCO: a linha de catálogo em `tilesets` (o que o
// cliente vê) e a linha de produção em `a3d.models` (qual arquivo serve, com que token).
// É o herdeiro de `scripts/adotar.js` do repositório `ebgeo_3d`, com o catálogo trocado de
// SQLite para Postgres.
//
// POR QUE ELE EXISTE, e o caso é real. Em 2026-08-22 o importador do `ebgeo_3d` deixou de
// passar uma coluna nova ao upsert: os passos 1 a 6 tinham passado, o arquivo estava no
// disco com o tamanho certo, a saída dizia "publicado", e o modelo não existia para o
// serviço. Quatro modelos, 40 minutos de conversão. Reconverter para consertar um INSERT é
// jogar esse tempo fora, e o cabeçalho `meta` de cada arquivo guarda tudo que o registro
// precisa.
//
// O QUE ELE NÃO FAZ: não converte, não troca arquivo, não mede nada que o arquivo não
// contenha, e não instala bytes. Cabeçalho incompleto é RECUSADO, nunca completado por
// adivinhação. Ponha o `.3dtiles` sob MODELS_3D_DIR primeiro; uma linha que aponta para
// bytes ausentes dá um pino que aparece e um clique que 404.
//
// POR QUE ISTO É SCRIPT E NÃO MIGRAÇÃO: a regra de `005_catalogo.sql` é que o catálogo é
// ponto de CONFIGURAÇÃO, nunca lugar de conteúdo semeado. Uma migração roda em todo
// ambiente, e prometeria gigabytes que a instalação nova não tem.
//
// Uso (pelo atalho do npm, que é o que passa o `.env`):
//   npm run models3d:adotar -- --dry-run
//   npm run models3d:adotar -- --id ponte_quatis
//   npm run models3d:adotar -- --id silo_oreste --access-level private --org <uuid>
import { readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import config from '../src/config.js';
import { query, tx, pgp } from '../src/database/index.js';
import { invalidateAppConfigCache } from '../src/modules/config/config.cache.js';
import {
  UPSERT_MODEL_3D,
  UPSERT_TILESET_3D,
  CATALOG_ROW_EXISTS,
} from '../src/modules/models3d/models3d.queries.js';
import {
  lerCabecalho,
  validarCabecalho,
  linhaDeProducao,
  configDeCatalogo,
} from '../src/modules/models3d/models3d.header.js';

/** As formas que um `.3dtiles` pode declarar. `indoor` não sai daqui: cena não é tileset. */
const FORMAS_ACEITAS = Object.freeze(['tiles3d', 'glb', 'pointcloud']);

/**
 * Registra um arquivo. Exportado para o teste, que é onde a ordem das duas escritas é
 * cobrada: a linha de produção tem FK para o catálogo, então o catálogo vem primeiro.
 *
 * @param {string} dbFilename - nome do arquivo em MODELS_3D_DIR
 * @param {Object} [opts]
 * @param {boolean} [opts.dryRun=false]
 * @param {string} [opts.accessLevel] - 'public' | 'private'
 * @param {string} [opts.orgId] - OM produtora (uuid), quando houver
 * @param {string} [opts.forma3d] - default derivado do modelType do cabeçalho
 * @returns {Promise<{acao: string, id: string, motivo?: string}>}
 */
export async function adotarModelo(dbFilename, opts = {}) {
  const caminho = join(config.models3d.dbDir, dbFilename);
  const idPeloNome = dbFilename.replace(/\.3dtiles$/, '');

  let cabecalho;
  try {
    cabecalho = lerCabecalho(caminho);
  } catch (err) {
    return { acao: 'recusado', id: idPeloNome, motivo: `cabeçalho ilegível (${err.message})` };
  }

  const veredito = validarCabecalho(cabecalho, idPeloNome);
  if (!veredito.ok) return { acao: 'recusado', id: idPeloNome, motivo: veredito.motivo };

  const { meta } = cabecalho;
  const bytes = statSync(caminho).size;
  const forma = opts.forma3d || (meta.modelType === 'glb' ? 'glb' : 'tiles3d');
  if (!FORMAS_ACEITAS.includes(forma)) {
    return { acao: 'recusado', id: idPeloNome, motivo: `forma3d inválida: ${forma}` };
  }

  const payload = {
    id: meta.id,
    name: meta.name || meta.id,
    // A COLUNA `description` é o que a listagem do Painel do Administrador mostra;
    // `listTilesets()` devolve `{ id, name, ...config }` e DESCARTA a coluna, então o
    // mesmo texto precisa viver dentro do `config` para chegar ao cliente.
    description: meta.description || null,
    config: configDeCatalogo(cabecalho, { baseUrl: config.assets3d.baseUrl, forma3d: forma }),
    sort_order: 0,
  };

  if (opts.dryRun) return { acao: 'dry-run', id: meta.id, payload };

  const existente = await query(CATALOG_ROW_EXISTS, [meta.id]);
  const jaHavia = existente.rows.length > 0;

  // AS DUAS ESCRITAS SÃO UMA SÓ, e não é zelo: `a3d.models` tem FK para `tilesets`, então
  // a ordem é obrigatória, e sem transação a falha da segunda deixa uma linha de catálogo
  // apontando para bytes que o serviço não sabe servir. Medido: aconteceu na primeira
  // execução deste roteiro contra um banco sem a migração, e o catálogo ficou com um
  // modelo que respondia 404 no clique.
  await tx(async (t) => {
    await t.none(UPSERT_TILESET_3D, {
      id: payload.id,
      name: payload.name,
      description: payload.description,
      config: JSON.stringify(payload.config),
      // `published = '0'` só sai de uma importação PARCIAL (`--limite`), e ela não pode
      // nascer visível: o modelo abriria em tela com buracos, sem erro nenhum.
      ativo: meta.published !== '0',
    });
    await t.one(UPSERT_MODEL_3D, linhaDeProducao(cabecalho, dbFilename, bytes));
  });

  // OS DOIS EIXOS DE ACESSO NÃO PASSAM PELO SERVIÇO, e não é esquecimento: `createCatalogItem`
  // deriva `owner_org_id` do ATOR (o produtor autenticado), e um script de linha de comando
  // não tem ator. Marcá-los aqui é o mesmo ato que um administrador faz na tela, e por isso
  // só acontece quando pedido — omitir as opções PRESERVA o que já estava na linha, em vez de
  // rebaixar um modelo privado a público numa readoção.
  if (opts.accessLevel || opts.orgId) {
    await query(
      `UPDATE tilesets
          SET access_level = COALESCE($2, access_level),
              owner_org_id = COALESCE($3::uuid, owner_org_id),
              updated_at = NOW()
        WHERE id = $1`,
      [meta.id, opts.accessLevel ?? null, opts.orgId ?? null],
    );
    invalidateAppConfigCache();
  }

  // O índice em memória do serviço lê as duas tabelas, e nenhuma destas escritas passou
  // pelo serviço de catálogo, que é quem normalmente invalida.
  invalidateAppConfigCache();

  return { acao: jaHavia ? 'atualizado' : 'criado', id: meta.id };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const argv = process.argv.slice(2);
  const valor = (nome) => {
    const i = argv.indexOf(nome);
    return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null;
  };
  const opts = {
    dryRun: argv.includes('--dry-run'),
    accessLevel: valor('--access-level'),
    orgId: valor('--org'),
    forma3d: valor('--forma'),
  };
  const somenteId = valor('--id');

  if (opts.accessLevel && !['public', 'private'].includes(opts.accessLevel)) {
    console.error('--access-level aceita "public" ou "private"');
    process.exit(1);
  }

  if (!existsSync(config.models3d.dbDir)) {
    console.error(`ERRO: ${config.models3d.dbDir} não existe. Instale os .3dtiles primeiro.`);
    process.exit(2);
  }

  const arquivos = readdirSync(config.models3d.dbDir)
    .filter((f) => f.endsWith('.3dtiles'))
    .filter((f) => !f.startsWith('_'))
    .filter((f) => !somenteId || f === `${somenteId}.3dtiles`);

  console.log(`${arquivos.length} arquivo(s) em ${config.models3d.dbDir}\n`);

  const recusados = [];
  let feitos = 0;

  const rodar = async () => {
    for (const arquivo of arquivos) {
      const r = await adotarModelo(arquivo, opts);
      if (r.acao === 'recusado') {
        recusados.push(`${r.id}: ${r.motivo}`);
        continue;
      }
      if (r.acao === 'dry-run') {
        console.log(`${r.id}\n${JSON.stringify(r.payload, null, 2)}\n`);
        continue;
      }
      feitos += 1;
      console.log(`${r.id}: ${r.acao}`);
    }
  };

  rodar()
    .then(async () => {
      // `pgp.end()` devolve undefined em algumas versões, então nada de encadear nele.
      await Promise.resolve(pgp.end());
      if (recusados.length) {
        console.log(`\nRECUSADOS (${recusados.length}):`);
        for (const r of recusados) console.log(`  ${r}`);
      }
      console.log(opts.dryRun ? '\ndry-run: nada gravado' : `\n${feitos} modelo(s) registrados`);
      process.exit(recusados.length ? 3 : 0);
    })
    .catch(async (err) => {
      await Promise.resolve(pgp.end()).catch(() => {});
      console.error('models3d-adotar falhou:', err?.message || err);
      process.exit(1);
    });
}
