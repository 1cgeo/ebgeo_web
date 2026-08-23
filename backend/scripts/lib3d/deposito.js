// Path: scripts/lib3d/deposito.js
/**
 * @module scripts/lib3d/deposito
 * @description A troca do arquivo publicado, compartilhada pelos importadores.
 *
 * ESTA FUNÇÃO NÃO SE DUPLICA. Ela carrega a armadilha do Windows: com o serviço no ar, o
 * `rename` por cima do `.3dtiles` publicado falha com EBUSY, porque quem segura o arquivo
 * é OUTRO PROCESSO e nada que este aqui feche o solta. A saída é preservar o `.parcial` e
 * mandar promover depois de parar o serviço. Uma segunda cópia disto é uma segunda chance
 * de esquecer o caso, e o sintoma seria uma corrida de horas jogada fora.
 *
 * A DIFERENÇA PARA A VERSÃO DO `ebgeo_3d`: lá o fecho era `closeModelDb`, que fechava a
 * conexão do próprio processo. Aqui as conexões de leitura vivem no pool de workers, e
 * quem as solta é `blobPool.withEvicted`, que ainda SEGURA a janela: uma leitura que
 * chegasse entre o evict e o rename faria um worker reabrir o arquivo debaixo da troca.
 */

import { existsSync, unlinkSync, renameSync, statSync } from 'node:fs';
import { blobPool } from '../../src/utils/sqlite-blob-pool.js';
import { fecharImportacao } from '../../src/modules/models3d/models3d.import.service.js';

/**
 * Troca o arquivo publicado pelo `.parcial` recém-convertido.
 *
 * Em caso de bloqueio no Windows, fecha a importação como falha, deixa o `.parcial` no
 * lugar e SAI com código 6, apontando o `--promover`.
 *
 * @param {object} ctx
 * @param {string} ctx.temporario
 * @param {string} ctx.destino
 * @param {string} ctx.dbFilename
 * @param {number} ctx.importId
 * @param {object} ctx.conv - totais da conversão, para o registro de falha
 * @param {(s:string)=>void} ctx.log
 * @param {string} [ctx.roteiro] - qual roteiro sugerir no --promover
 * @returns {Promise<number>} bytes do arquivo publicado
 */
export async function trocaArquivo({
  temporario,
  destino,
  dbFilename,
  importId,
  conv,
  log,
  roteiro = 'scripts/models3d-importar.js',
}) {
  try {
    await blobPool.withEvicted(destino, () => {
      for (const f of [destino, `${destino}-wal`, `${destino}-shm`]) {
        if (existsSync(f)) unlinkSync(f);
      }
      renameSync(temporario, destino);
    });
  } catch (err) {
    if (!['EBUSY', 'EPERM', 'EACCES'].includes(err.code)) throw err;
    console.error(`\n=== PARADO no passo 6: o arquivo publicado está em uso (${err.code}) ===`);
    console.error('A conversão terminou e passou na conferência. Nada se perdeu.');
    console.error('No Windows o serviço no ar segura o arquivo, e ele é outro processo.');
    console.error('\nPare o serviço e rode:');
    console.error(`  node ${roteiro} --promover --id ${dbFilename.replace(/\.3dtiles$/, '')}`);
    await fecharImportacao({
      id: importId,
      status: 'falhou',
      tilesIn: conv?.tentados ?? null,
      tilesOut: conv?.convertidos ?? null,
      textures: conv?.texturas ?? null,
      failures: conv?.falhasTextura ?? null,
      seconds: conv?.segundos ?? null,
      ratio: null,
      notes: `troca do arquivo bloqueada (${err.code}); .parcial pronto para --promover`,
    });
    process.exit(6);
  }
  log(`  ${dbFilename} publicado`);
  return statSync(destino).size;
}
