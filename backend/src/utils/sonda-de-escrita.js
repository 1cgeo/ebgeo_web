// Path: src/utils/sonda-de-escrita.js
/**
 * @fileoverview A SONDA DE ESCRITA do boot: cada diretório que este processo ESCREVE é criado
 * se faltar, recebe um arquivo de teste e o apaga, ANTES de o servidor escutar a porta. Se um
 * falhar, o boot recusa subir com UMA mensagem que lista todos.
 *
 * O INCIDENTE QUE A MOTIVOU (stack de teste, 2026-09-22). A imagem roda como `ebgeo`, uid 1001,
 * e faz `chown` de `/app/data` na construção (`Dockerfile`). O compose de lá monta
 * `./data:/app/data`, e o diretório do HOST pertencia a 1000:1000, criado por uma versão
 * anterior: o bind mount MASCARA o chown da imagem. O processo subiu, o healthcheck ficou verde
 * (ele pergunta pelo banco), o log em arquivo se desligou na primeira linha (EACCES) e todo
 * envio de imagem respondeu 500 (EACCES no mkdir do diretório do atlas). Ninguém soube até
 * alguém ler o `docker logs`.
 *
 * CRIAR NÃO É ESCREVER, e é por isso que esta sonda existe em vez de bastar o que já havia. O
 * `mkdirSync(..., { recursive: true })` que o log faz ao nascer devolve sucesso sobre um
 * diretório que JÁ EXISTE sem perguntar nada sobre escrita, então o "fala alto ao nascer" de
 * `log-diario.js` passou calado exatamente no caso do incidente. Só escrever prova escrita, e
 * só apagar prova que o arquivo novo não vira resíduo (a ingestão do 360 renomeia e apaga
 * dentro do mesmo diretório).
 *
 * O QUE ENTRA: os diretórios que o SERVIDOR escreve em runtime, e só enquanto a função que os
 * escreve estiver ligada. Hoje a única função desligável por configuração é o log em arquivo
 * (`LOG_TO_FILE=off`, e sempre desligado em teste), e o gate aqui é o MESMO de
 * `montarDestinos` (`utils/logger.js`): sondar o diretório de uma função desligada recusaria
 * subir por causa de algo que o processo nunca vai tocar.
 *
 * O QUE FICA DE FORA, e cada ausência é decisão:
 *  - `MODELS_3D_DIR`, `ASSETS_3D_DIR` e `ASSETS_3D_SQLITE`: o servidor só LÊ. Quem escreve é o
 *    roteiro de importação, rodado à parte, e montar esses volumes `:ro` é configuração
 *    legítima e até recomendada (o `fileoverview` de `models3d.build.js` escolhe o modo de
 *    journal justamente para que o arquivo abra num volume só leitura). Sondá-los recusaria o
 *    deploy correto.
 *  - `SONDA_DIR`: quem escreve é a sonda de disponibilidade, de FORA do processo; aqui ele é lido.
 *  - `EBGEO_MAPAS_DIR`: quem escreve é o deploy; aqui ele é lido.
 *
 * O QUE ELA NÃO ALCANÇA, declarado em vez de escondido: subdiretório ou arquivo que JÁ EXISTE
 * com outro dono. A pasta de um atlas criada pela versão anterior (`<IMAGES_DIR>/<atlasId>`) e
 * o arquivo do dia do log continuam recusando escrita mesmo com o diretório de cima liberado, e
 * a sonda não os percorre, porque varrer um acervo inteiro no boot custa tempo proporcional ao
 * acervo e acusaria diretório alheio que o processo nunca escreve (o `lost+found` na raiz de um
 * volume, por exemplo). É por isso que o conserto que a mensagem propõe é `chown -R`, e não um
 * `chown` do diretório de cima. O que escapa por aí cai na resistência de runtime: o log se
 * desliga com rastro (ver `estadoDoLogEmArquivo`, em `utils/logger.js`) e o envio de imagem
 * responde erro.
 *
 * DISCO CHEIO TAMBÉM RECUSA, e o preço está escrito: um volume sem espaço nem para o arquivo de
 * teste quebra toda escrita de toda função, e o laço de reinício do container passa a repetir a
 * causa em voz alta em vez de subir um servidor que só lê. Ver a decisão de 2026-09-22 em
 * `docs/decisions/decisions-2026.md`.
 *
 * PURA ONDE DÁ. O `fs` e a identidade do processo são injetáveis, e o módulo não importa
 * `config.js` (recebe a configuração por parâmetro): é o que o torna exercível em node sem
 * `DATABASE_URL`, sem disco de verdade e sem ser root. `src/index.js` não é importável por
 * teste (avaliá-lo sobe o servidor), então a decisão inteira mora aqui e o boot só a chama.
 */

import nodeFs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

/**
 * O prefixo do arquivo de teste. Ponto na frente e SEM extensão, de propósito: ele não casa com
 * o padrão do log diário (`<prefixo>-AAAA-MM-DD.jsonl`), nem com o `.tmp`/`.bak` da ingestão do
 * 360, nem com o `.db` que a leitura do 360 lista, então um resíduo (apagar falhou) nunca é
 * confundido com dado de ninguém.
 */
export const PREFIXO_DO_ARQUIVO_DE_TESTE = '.ebgeo-sonda-de-escrita-';

/**
 * Os diretórios que este processo ESCREVE, com a variável que os configura e a função que
 * quebraria sem eles. Ver o `fileoverview` para o que fica de fora e por quê.
 *
 * @param {Object} cfg - a configuração (`config.js`), ou um objeto com a mesma forma
 * @returns {{caminho: string, variavel: string, funcao: string}[]}
 */
export function diretoriosQueOProcessoEscreve(cfg) {
  const alvos = [];
  // O MESMO gate do destino de arquivo em `montarDestinos` (`utils/logger.js`), e não um
  // parecido: se os dois divergirem, ou se sonda o que não será escrito, ou se deixa de sondar
  // o que será.
  if (cfg.log.emArquivo && !cfg.isTest) {
    alvos.push({ caminho: cfg.log.dir, variavel: 'LOG_DIR', funcao: 'log em arquivo' });
  }
  alvos.push(
    { caminho: cfg.images.dir, variavel: 'IMAGES_DIR', funcao: 'imagens dos atlas' },
    { caminho: cfg.catalogVideo.dir, variavel: 'CATALOG_VIDEO_DIR', funcao: 'vídeos de prévia do catálogo' },
    { caminho: cfg.sv360.dbDir, variavel: 'SV360_DB_DIR', funcao: 'bancos dos projetos 360' },
    { caminho: cfg.sv360.tmpDir, variavel: 'SV360_TMP_DIR', funcao: 'envio temporário do 360' },
  );
  return alvos;
}

/**
 * Quem é este processo, em uid/gid, ou `null` onde a pergunta não existe (Windows).
 * @param {NodeJS.Process} [proc]
 * @returns {{uid: number, gid: number}|null}
 */
export function identidadeDoProcesso(proc = process) {
  if (typeof proc.getuid !== 'function' || typeof proc.getgid !== 'function') return null;
  return { uid: proc.getuid(), gid: proc.getgid() };
}

/** Um nome de arquivo de teste que duas sondas simultâneas nunca compartilham. */
function nomeDoArquivoDeTeste() {
  return `${PREFIXO_DO_ARQUIVO_DE_TESTE}${process.pid}-${randomBytes(6).toString('hex')}`;
}

/** A falha de uma etapa, sem lançar: quem chama acumula. */
function falhaDe(etapa, err, residuo = null) {
  return {
    etapa,
    codigo: err && typeof err.code === 'string' ? err.code : null,
    mensagem: String(err && err.message ? err.message : err),
    residuo,
  };
}

/**
 * Sonda UM diretório: cria se faltar, escreve um arquivo de teste e o apaga. NUNCA LANÇA.
 *
 * `wx` NA ESCRITA, e não `w`: o nome é aleatório, mas se por azar ele já existir a sonda não
 * trunca arquivo de ninguém, ela falha e diz.
 *
 * @param {string} caminho - absoluto de preferência; relativo resolve contra o cwd
 * @param {Object} [opts]
 * @param {Object} [opts.fs] - `fs` injetável (teste)
 * @param {string} [opts.nomeDoTeste] - nome do arquivo de teste (teste)
 * @returns {null|{etapa: 'criar'|'escrever'|'apagar', codigo: string|null, mensagem: string,
 *   residuo: string|null}} `null` quando o diretório aceita escrita
 */
export function sondarDiretorio(caminho, { fs = nodeFs, nomeDoTeste = nomeDoArquivoDeTeste() } = {}) {
  try {
    fs.mkdirSync(caminho, { recursive: true });
  } catch (err) {
    return falhaDe('criar', err);
  }
  const arquivo = path.join(caminho, nomeDoTeste);
  try {
    fs.writeFileSync(arquivo, 'ok\n', { flag: 'wx' });
  } catch (err) {
    return falhaDe('escrever', err);
  }
  try {
    fs.unlinkSync(arquivo);
  } catch (err) {
    return falhaDe('apagar', err, arquivo);
  }
  return null;
}

/**
 * O dono do diretório, ou do ANCESTRAL mais próximo que existe.
 *
 * O ancestral é o que importa quando o diretório nem chegou a ser criado: quem recusou o
 * `mkdir` foi o pai, e é o dono DELE que o operador precisa corrigir.
 *
 * @param {string} caminho - absoluto
 * @param {Object} fs
 * @returns {{caminho: string, uid: number, gid: number}|null}
 */
function donoDe(caminho, fs) {
  let atual = caminho;
  // O teto de voltas é a guarda contra um `dirname` que nunca pare (não deveria existir, mas
  // um laço infinito no boot é a pior forma de recusar subir).
  for (let volta = 0; volta < 256; volta += 1) {
    try {
      const s = fs.statSync(atual);
      return { caminho: atual, uid: s.uid, gid: s.gid };
    } catch {
      const pai = path.dirname(atual);
      if (pai === atual) return null;
      atual = pai;
    }
  }
  return null;
}

/**
 * Junta os alvos que resolvem para o MESMO caminho: um diretório sondado uma vez, com todas as
 * variáveis que apontam para ele (o 360 aceita `SV360_TMP_DIR` igual a `SV360_DB_DIR`, e a
 * mensagem precisa nomear as duas, porque o operador pode ter escrito qualquer uma).
 */
function agruparPorCaminho(alvos) {
  const porCaminho = new Map();
  for (const alvo of alvos) {
    if (typeof alvo.caminho !== 'string' || alvo.caminho === '') continue;
    const absoluto = path.resolve(alvo.caminho);
    const atual = porCaminho.get(absoluto);
    if (atual) {
      atual.variaveis.push(alvo.variavel);
      atual.funcoes.push(alvo.funcao);
    } else {
      porCaminho.set(absoluto, { caminho: absoluto, variaveis: [alvo.variavel], funcoes: [alvo.funcao] });
    }
  }
  return [...porCaminho.values()];
}

/**
 * Sonda TODOS os alvos e devolve TODAS as falhas, nunca só a primeira: o acumulador é o mesmo
 * desenho de `validateEnvVariables`, porque um boot que revela um problema por reinício faz de
 * um deploy mal montado N voltas.
 *
 * @param {{caminho: string, variavel: string, funcao: string}[]} alvos
 * @param {Object} [opts]
 * @param {Object} [opts.fs] - `fs` injetável (teste)
 * @param {{uid: number, gid: number}|null} [opts.identidade] - `null` desliga a leitura de dono
 * @returns {Object[]} uma entrada por diretório que falhou
 */
export function sondarDiretoriosDeDados(alvos, { fs = nodeFs, identidade = identidadeDoProcesso() } = {}) {
  const falhas = [];
  for (const alvo of agruparPorCaminho(alvos)) {
    const falha = sondarDiretorio(alvo.caminho, { fs });
    if (!falha) continue;
    // Dono só onde uid/gid existem: no Windows o `stat` devolve 0 e 0, e publicar isso como
    // "dono atual" mandaria o operador procurar um root que não existe.
    falhas.push({ ...alvo, ...falha, dono: identidade ? donoDe(alvo.caminho, fs) : null });
  }
  return falhas;
}

const ETAPA_LEGIVEL = Object.freeze({
  criar: 'ao criar o diretório',
  escrever: 'ao escrever o arquivo de teste',
  apagar: 'ao apagar o arquivo de teste',
});

/**
 * O conserto provável por código de erro, uma linha por FAMÍLIA (EACCES e EPERM pedem a mesma
 * providência e saem numa linha só).
 */
function dicaPorCodigo(codigo, identidade) {
  const dono = identidade ? `${identidade.uid}:${identidade.gid}` : '<uid>:<gid>';
  switch (codigo) {
    case 'EACCES':
    case 'EPERM':
      return {
        familia: 'permissao',
        texto: 'EACCES/EPERM: o dono do diretório não é o processo. Se o caminho vem de um volume '
          + 'ou bind mount (ex.: ./data:/app/data no compose), o dono que vale é o do HOST, e o chown '
          + 'feito na construção da imagem não alcança o que o mount põe por cima. No host, entregue '
          + `a origem do mount ao processo: chown -R ${dono} <origem no host> `
          + `(ex.: chown -R ${dono} ./data).`,
      };
    case 'EROFS':
      return {
        familia: 'somente-leitura',
        texto: 'EROFS: o sistema de arquivos está montado só leitura (":ro" no compose, ou volume '
          + 'read-only). Tire o ":ro" desse caminho ou aponte a variável para um volume gravável.',
      };
    case 'ENOSPC':
      return {
        familia: 'disco-cheio',
        texto: 'ENOSPC: o volume está cheio, sem espaço nem para o arquivo de teste. Libere espaço '
          + 'nele antes de subir de novo.',
      };
    case 'ENOENT':
      return {
        familia: 'inexistente',
        texto: 'ENOENT: um componente do caminho não existe e não pôde ser criado (link simbólico '
          + 'quebrado, volume que não montou). Confira a variável e o mount.',
      };
    case 'ENOTDIR':
    case 'EEXIST':
      return {
        familia: 'nao-e-diretorio',
        texto: 'ENOTDIR/EEXIST: um componente do caminho existe e é um ARQUIVO, não um diretório. '
          + 'Confira a variável.',
      };
    default:
      return {
        familia: `outro:${codigo ?? 'sem-codigo'}`,
        texto: `${codigo ?? 'Erro sem código'}: confira o caminho, o volume e as permissões; a `
          + 'mensagem original do sistema está na linha do diretório.',
      };
  }
}

/**
 * A mensagem ÚNICA para o operador, em pt-BR, com todas as falhas.
 *
 * O QUE ELA PRECISA DIZER, e cada item já custou uma leitura errada de `docker logs`: QUAL
 * diretório (absoluto, do ponto de vista do processo), por QUAL variável ele foi configurado,
 * QUE função quebraria, QUAL erro e em QUAL etapa, QUEM é o processo e QUEM é o dono, e o
 * CONSERTO provável. O código de erro vai cru porque é o termo que se procura; a mensagem crua
 * do sistema vai junto só quando o código não tem dica própria.
 *
 * @param {Object[]} falhas - de `sondarDiretoriosDeDados`
 * @param {{uid: number, gid: number}|null} identidade
 * @returns {string}
 */
export function mensagemDeDiretoriosSemEscrita(falhas, identidade = null) {
  const linhas = [
    'Diretório(s) de dados sem escrita: o servidor NÃO vai subir, porque seguiria de pé com '
      + 'funções quebradas em silêncio.',
    identidade
      ? `O processo roda como uid ${identidade.uid}, gid ${identidade.gid}, e precisa criar, `
        + 'escrever e apagar arquivo em cada diretório abaixo:'
      : 'O processo precisa criar, escrever e apagar arquivo em cada diretório abaixo:',
  ];

  const dicas = new Map();
  for (const f of falhas) {
    const erro = f.codigo ?? 'erro sem código';
    let linha = `  - ${f.caminho} (${f.variaveis.join(', ')}: ${f.funcoes.join(', ')}): `
      + `${erro} ${ETAPA_LEGIVEL[f.etapa] ?? f.etapa}`;
    if (f.dono) {
      const onde = f.dono.caminho === f.caminho ? '' : ` de ${f.dono.caminho}`;
      linha += `; dono atual${onde}: ${f.dono.uid}:${f.dono.gid}`;
    }
    linhas.push(`${linha}.`);

    const dica = dicaPorCodigo(f.codigo, identidade);
    if (dica.familia.startsWith('outro:')) linhas.push(`      ${f.mensagem}`);
    if (f.residuo) linhas.push(`      o arquivo de teste ficou para trás e pode ser apagado: ${f.residuo}`);
    if (!dicas.has(dica.familia)) dicas.set(dica.familia, dica.texto);
  }

  linhas.push('Conserto provável:');
  for (const texto of dicas.values()) linhas.push(`  - ${texto}`);
  return linhas.join('\n');
}

/**
 * A verificação que o boot chama: `null` quando todo diretório aceita escrita, senão a
 * mensagem única. Ela DEVOLVE em vez de lançar para que `src/index.js` possa juntá-la aos erros
 * de `validateEnvVariables` num lançamento só.
 *
 * @param {Object} cfg - a configuração (`config.js`)
 * @param {Object} [opts]
 * @param {Object} [opts.fs] - `fs` injetável (teste)
 * @param {{uid: number, gid: number}|null} [opts.identidade]
 * @returns {string|null}
 */
export function verificarDiretoriosDeDados(cfg, { fs = nodeFs, identidade = identidadeDoProcesso() } = {}) {
  const falhas = sondarDiretoriosDeDados(diretoriosQueOProcessoEscreve(cfg), { fs, identidade });
  return falhas.length === 0 ? null : mensagemDeDiretoriosSemEscrita(falhas, identidade);
}
