// Path: tests/unit/sonda-de-escrita.test.js
//
// `src/utils/sonda-de-escrita.js` é o portão de boot que recusa subir quando um diretório que o
// processo ESCREVE não aceita escrita. O incidente que o motivou (stack de teste, 2026-09-22) foi
// um bind mount de outro dono: o `mkdirSync` recursivo do log devolveu sucesso sobre o diretório
// que já existia, o servidor subiu verde, e o log e o envio de imagem morreram na primeira
// escrita. Este arquivo mede as cinco coisas que o portão promete:
//
//   (1) diretório gravável passa, é criado se faltar e não fica resíduo;
//   (2) diretório que existe e recusa escrita é ACUSADO (o caso do incidente, que criar não pega);
//   (3) diretório inexistente cujo PAI recusa é acusado, com o dono do pai;
//   (4) diretório de função DESLIGADA não é sondado;
//   (5) várias falhas saem numa mensagem SÓ, com processo, dono e conserto.
//
// O `fs` é injetado nos casos de permissão: simular EACCES de verdade exige não ser root no
// POSIX e não funciona no Windows (lá o bit de escrita de diretório não impede criar arquivo).
// Os casos de fs REAL são os que qualquer plataforma reproduz: diretório temporário gravável, e
// um caminho que passa por dentro de um arquivo.
//
// Controle negativo: troque a etapa de escrita de `sondarDiretorio` por um `accessSync` e o caso
// (2) continua verde só se o dublê também mentir, por isso ele assere que `writeFileSync` foi
// CHAMADO; tire o gate `cfg.log.emArquivo && !cfg.isTest` e o caso (4) cai; troque o acumulador
// por um `return` na primeira falha e o caso (5) cai.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  diretoriosQueOProcessoEscreve,
  identidadeDoProcesso,
  mensagemDeDiretoriosSemEscrita,
  PREFIXO_DO_ARQUIVO_DE_TESTE,
  sondarDiretorio,
  sondarDiretoriosDeDados,
  verificarDiretoriosDeDados,
} from '../../src/utils/sonda-de-escrita.js';

/** Um erro de sistema com `code`, como o `fs` do node produz. */
function erroDeSistema(code, mensagem = `${code}: falha simulada`) {
  const err = new Error(mensagem);
  err.code = code;
  return err;
}

/**
 * Um `fs` de mentira. `falhas` mapeia `metodo:caminho` para o código de erro a lançar; `donos`
 * mapeia caminho existente para `{uid, gid}`. O que não está em `donos` não existe.
 */
function fsFalso({ falhas = {}, donos = {} } = {}) {
  const chamadas = [];
  const lancarSe = (metodo, alvo) => {
    const chave = `${metodo}:${alvo}`;
    if (falhas[chave]) throw erroDeSistema(falhas[chave]);
  };
  return {
    chamadas,
    mkdirSync(alvo, opcoes) {
      chamadas.push(['mkdir', alvo, opcoes]);
      lancarSe('mkdir', alvo);
    },
    writeFileSync(alvo, _conteudo, opcoes) {
      chamadas.push(['write', alvo, opcoes]);
      lancarSe('write', path.dirname(alvo));
    },
    unlinkSync(alvo) {
      chamadas.push(['unlink', alvo]);
      lancarSe('unlink', path.dirname(alvo));
    },
    statSync(alvo) {
      if (!Object.hasOwn(donos, alvo)) throw erroDeSistema('ENOENT');
      return donos[alvo];
    },
  };
}

/** Uma configuração com a forma de `config.js`, só nos campos que a sonda lê. */
function configuracao({ emArquivo = true, isTest = false, raiz = path.resolve('/app/data') } = {}) {
  return {
    isTest,
    log: { emArquivo, dir: path.join(raiz, 'logs') },
    images: { dir: path.join(raiz, 'images') },
    catalogVideo: { dir: path.join(raiz, 'catalog-videos') },
    sv360: { dbDir: path.join(raiz, 'sv360'), tmpDir: path.join(raiz, 'sv360-tmp') },
  };
}

const PROCESSO = Object.freeze({ uid: 1001, gid: 1001 });

describe('sonda de escrita: um diretório (fs real)', () => {
  let raiz;
  before(() => { raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'ebgeo-sonda-')); });
  after(() => { fs.rmSync(raiz, { recursive: true, force: true }); });

  it('(1) diretório gravável passa, é CRIADO se faltar, e não deixa resíduo', () => {
    const alvo = path.join(raiz, 'nao-existia', 'imagens');
    assert.equal(fs.existsSync(alvo), false, 'premissa: o diretório não existe antes da sonda');

    assert.equal(sondarDiretorio(alvo), null);

    assert.equal(fs.statSync(alvo).isDirectory(), true, 'a sonda cria o que falta, como o app criaria');
    assert.deepEqual(fs.readdirSync(alvo), [], 'o arquivo de teste não pode ficar para trás');
  });

  it('um caminho que passa por dentro de um ARQUIVO é acusado na criação, com o código do sistema', () => {
    // O único modo de recusa que toda plataforma reproduz sem root e sem ACL: no POSIX e no
    // Windows o `mkdir` sob um arquivo regular devolve ENOTDIR (medido nas duas).
    const arquivo = path.join(raiz, 'sou-um-arquivo');
    fs.writeFileSync(arquivo, 'x');

    const falha = sondarDiretorio(path.join(arquivo, 'imagens'));

    assert.equal(falha.etapa, 'criar');
    assert.equal(falha.codigo, 'ENOTDIR');
    assert.match(falha.mensagem, /ENOTDIR/);
  });
});

describe('sonda de escrita: um diretório (fs injetado)', () => {
  const DIR = path.resolve('/app/data/logs');

  it('(2) diretório que EXISTE e recusa escrita é acusado na escrita: criar não prova nada', () => {
    const f = fsFalso({ falhas: { [`write:${DIR}`]: 'EACCES' } });

    const falha = sondarDiretorio(DIR, { fs: f, nomeDoTeste: 'teste' });

    assert.equal(falha.etapa, 'escrever');
    assert.equal(falha.codigo, 'EACCES');
    // O `mkdir` passou (é o que fazia o log calar), e a sonda ESCREVEU mesmo assim. Sem esta
    // asserção, um dublê que falhasse em outra etapa passaria por este caso.
    assert.deepEqual(f.chamadas.map(([m]) => m), ['mkdir', 'write']);
    assert.deepEqual(f.chamadas[0][2], { recursive: true });
    assert.deepEqual(f.chamadas[1][2], { flag: 'wx' }, '`wx`: a sonda nunca trunca arquivo de ninguém');
  });

  it('apagar que falha é acusado, e o resíduo é nomeado', () => {
    const f = fsFalso({ falhas: { [`unlink:${DIR}`]: 'EPERM' } });

    const falha = sondarDiretorio(DIR, { fs: f, nomeDoTeste: 'teste' });

    assert.equal(falha.etapa, 'apagar');
    assert.equal(falha.codigo, 'EPERM');
    assert.equal(falha.residuo, path.join(DIR, 'teste'));
  });

  it('o nome do arquivo de teste não casa com arquivo de ninguém', () => {
    const f = fsFalso();
    assert.equal(sondarDiretorio(DIR, { fs: f }), null);
    const escrito = path.basename(f.chamadas[1][1]);
    assert.ok(escrito.startsWith(PREFIXO_DO_ARQUIVO_DE_TESTE));
    // Não pode parecer o arquivo do dia do log (que a poda apaga) nem o `.tmp`/`.bak`/`.db` do 360.
    assert.doesNotMatch(escrito, /\.(jsonl|tmp|bak|db)$/);
  });
});

describe('sonda de escrita: os diretórios de dados', () => {
  it('(3) diretório inexistente com PAI sem permissão: acusa a criação e publica o dono do PAI', () => {
    const cfg = configuracao();
    const pai = path.resolve('/app/data');
    const f = fsFalso({
      falhas: { [`mkdir:${cfg.images.dir}`]: 'EACCES' },
      donos: { [pai]: { uid: 1000, gid: 1000 } },
    });

    const falhas = sondarDiretoriosDeDados(
      [{ caminho: cfg.images.dir, variavel: 'IMAGES_DIR', funcao: 'imagens dos atlas' }],
      { fs: f, identidade: PROCESSO }
    );

    assert.equal(falhas.length, 1);
    assert.equal(falhas[0].etapa, 'criar');
    assert.deepEqual(falhas[0].dono, { caminho: pai, uid: 1000, gid: 1000 },
      'quem recusou o mkdir foi o pai, e é o dono DELE que o operador precisa corrigir');

    const mensagem = mensagemDeDiretoriosSemEscrita(falhas, PROCESSO);
    assert.ok(mensagem.includes(`dono atual de ${pai}: 1000:1000`), mensagem);
  });

  it('(4) diretório de função DESLIGADA não entra, e o gate é o mesmo do destino de arquivo', () => {
    const variaveis = (cfg) => diretoriosQueOProcessoEscreve(cfg).map((a) => a.variavel);
    const SEMPRE = ['IMAGES_DIR', 'CATALOG_VIDEO_DIR', 'SV360_DB_DIR', 'SV360_TMP_DIR'];

    assert.deepEqual(variaveis(configuracao()), ['LOG_DIR', ...SEMPRE]);
    assert.deepEqual(variaveis(configuracao({ emArquivo: false })), SEMPRE, 'LOG_TO_FILE=off');
    assert.deepEqual(variaveis(configuracao({ isTest: true })), SEMPRE, 'em teste o log nunca escreve arquivo');
  });

  it('(4) e o diretório desligado não é TOCADO, nem mesmo com um mkdir', () => {
    const cfg = configuracao({ emArquivo: false });
    const f = fsFalso({ falhas: { [`mkdir:${cfg.log.dir}`]: 'EACCES' } });

    assert.equal(verificarDiretoriosDeDados(cfg, { fs: f, identidade: PROCESSO }), null);
    assert.ok(f.chamadas.length > 0, 'premissa: a sonda rodou sobre os outros diretórios');
    assert.equal(f.chamadas.some(([, alvo]) => alvo.startsWith(cfg.log.dir)), false);
  });

  it('os diretórios SÓ DE LEITURA ficam de fora: `:ro` neles é montagem legítima', () => {
    const cfg = {
      ...configuracao(),
      models3d: { dbDir: '/ro/models3d' },
      assets3d: { dir: '/ro/assets3d', sqlitePath: '/ro/assets3d.sqlite' },
      sondaDir: '/ro/sonda',
      mapasDir: '/ro/mapas',
    };
    const caminhos = diretoriosQueOProcessoEscreve(cfg).map((a) => a.caminho);
    assert.equal(caminhos.length, 5);
    assert.equal(caminhos.some((c) => c.startsWith('/ro')), false);
  });

  it('duas variáveis no MESMO caminho: sondado uma vez, e a mensagem nomeia as duas', () => {
    const mesmo = path.resolve('/app/data/sv360');
    const f = fsFalso({ falhas: { [`write:${mesmo}`]: 'EACCES' } });

    const falhas = sondarDiretoriosDeDados([
      { caminho: mesmo, variavel: 'SV360_DB_DIR', funcao: 'bancos dos projetos 360' },
      { caminho: mesmo, variavel: 'SV360_TMP_DIR', funcao: 'envio temporário do 360' },
    ], { fs: f, identidade: null });

    assert.equal(falhas.length, 1);
    assert.deepEqual(falhas[0].variaveis, ['SV360_DB_DIR', 'SV360_TMP_DIR']);
    assert.equal(f.chamadas.filter(([m]) => m === 'mkdir').length, 1);
  });

  it('(5) várias falhas saem numa mensagem SÓ, com processo, dono, códigos e um conserto por família', () => {
    const cfg = configuracao();
    const f = fsFalso({
      falhas: {
        [`write:${cfg.log.dir}`]: 'EACCES',
        [`mkdir:${cfg.images.dir}`]: 'EACCES',
        [`write:${cfg.sv360.tmpDir}`]: 'EROFS',
      },
      donos: {
        [cfg.log.dir]: { uid: 1000, gid: 1000 },
        [path.resolve('/app/data')]: { uid: 1000, gid: 1000 },
        [cfg.sv360.tmpDir]: { uid: 1001, gid: 1001 },
      },
    });

    const mensagem = verificarDiretoriosDeDados(cfg, { fs: f, identidade: PROCESSO });

    assert.equal(typeof mensagem, 'string');
    assert.match(mensagem, /NÃO vai subir/);
    assert.match(mensagem, /uid 1001, gid 1001/);
    for (const [caminho, variavel] of [
      [cfg.log.dir, 'LOG_DIR'], [cfg.images.dir, 'IMAGES_DIR'], [cfg.sv360.tmpDir, 'SV360_TMP_DIR'],
    ]) {
      assert.ok(mensagem.includes(`${caminho} (${variavel}`), `${variavel} precisa aparecer com o caminho`);
    }
    // Os que passaram NÃO aparecem: uma lista que acusasse tudo seria tão inútil quanto nenhuma.
    assert.equal(mensagem.includes(cfg.catalogVideo.dir), false);
    assert.match(mensagem, /EACCES ao escrever o arquivo de teste; dono atual: 1000:1000/);
    assert.match(mensagem, /EACCES ao criar o diretório/);
    assert.match(mensagem, /EROFS ao escrever/);
    // UM conserto por família: duas falhas de permissão, uma linha de chown.
    assert.equal(mensagem.match(/chown -R 1001:1001 <origem no host>/g).length, 1);
    assert.match(mensagem, /":ro"/);
  });

  it('sem uid/gid (Windows): nem dono inventado, nem uid no conserto', () => {
    const cfg = configuracao();
    const f = fsFalso({
      falhas: { [`write:${cfg.images.dir}`]: 'EACCES' },
      donos: { [cfg.images.dir]: { uid: 0, gid: 0 } },
    });

    const mensagem = verificarDiretoriosDeDados(cfg, { fs: f, identidade: null });

    assert.doesNotMatch(mensagem, /dono atual/, 'o `stat` do Windows devolve 0:0, que não é dono nenhum');
    assert.match(mensagem, /chown -R <uid>:<gid>/);
  });

  it('código sem dica própria leva a mensagem crua do sistema junto', () => {
    const cfg = configuracao();
    const f = fsFalso({ falhas: { [`write:${cfg.images.dir}`]: 'EIO' } });

    const mensagem = verificarDiretoriosDeDados(cfg, { fs: f, identidade: PROCESSO });

    assert.match(mensagem, /EIO: falha simulada/);
  });

  it('tudo gravável: nenhuma mensagem', () => {
    assert.equal(verificarDiretoriosDeDados(configuracao(), { fs: fsFalso(), identidade: PROCESSO }), null);
  });

  it('identidadeDoProcesso: null onde uid/gid não existem', () => {
    assert.equal(identidadeDoProcesso({}), null);
    assert.deepEqual(identidadeDoProcesso({ getuid: () => 1001, getgid: () => 1002 }), { uid: 1001, gid: 1002 });
  });
});

describe('FIAÇÃO: o boot sonda ANTES de escutar, e liga o desligamento do log a um defeito', () => {
  // `src/index.js` não é importável aqui (avaliá-lo sobe servidor HTTP, WebSocket e pool), então
  // a asserção é sobre o FONTE, como a do medidor de disco em `amostra-de-saude.test.js`. A
  // prova de comportamento é o subprocesso de `tests/integration/boot-fail-fast.test.js`.
  const fonte = fs.readFileSync(new URL('../../src/index.js', import.meta.url), 'utf8');

  it('a sonda roda antes de `createServer`, junto da validação de ambiente', () => {
    const sonda = fonte.indexOf('verificarDiretoriosDeDados(config)');
    const servidor = fonte.indexOf('createServer(app)');
    assert.ok(sonda > 0, 'o boot precisa chamar a sonda');
    assert.ok(servidor > 0, 'piso: o boot ainda cria o servidor');
    assert.ok(sonda < servidor, 'sondar depois de criar o servidor não é recusar subir');
    assert.ok(fonte.indexOf('validateEnvVariables()') < servidor);
  });

  it('o desligamento do log em runtime vira defeito de servidor', () => {
    assert.match(fonte, /aoDesligarLogEmArquivo\(\(estado\) => \{\s*anotarDefeitoDeServidor\(defeitoDoLogDesligado\(estado\)\)/);
  });
});
