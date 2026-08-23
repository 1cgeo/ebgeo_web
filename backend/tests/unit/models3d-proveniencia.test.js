// Path: tests/unit/models3d-proveniencia.test.js
// AS TRES COLUNAS DE PROVENIENCIA TINHAM LEITOR E NAO TINHAM ESCRITOR, e nasciam NULL
// em todo modelo do acervo ate 2026-08-23.
//
// A baseline `009_a3d.sql` descreve `source` em detalhe ("sai de `asset.generator` do glTF de
// ORIGEM, nunca do nome da pasta"), `linhaDeProducao` le as tres do cabecalho, e o
// `UPSERT_MODEL_3D` as grava com COALESCE para nao apagar na readocao. A cadeia inteira
// existia do meio para a frente. O importador CALCULAVA o motor (`leGerador`, do JSON cru
// do glTF), usava para escolher o teto de textura, imprimia no log, e nao gravava.
//
// O QUE ESTE ARQUIVO PRENDE: a conversao do generator nas duas colunas, e a decisao que
// a governa. `source` guarda a string INTEIRA porque a coluna E o generator, e um parser
// que partisse nome e versao teria de adivinhar onde o nome termina; `sourceVersion` e
// refinamento, nunca particao. Os casos abaixo sao generators REAIS de motor de
// fotogrametria, e o de `glTF-Transform` esta ali de proposito: e o valor que a migracao
// avisa que aparece quando se le pelo caminho errado.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { separaGerador } from '../../src/modules/models3d/models3d.header.js';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Os dois caminhos de importação, e as únicas coisas que escrevem a tabela `meta`. */
const IMPORTADORES = ['scripts/models3d-importar.js', 'scripts/models3d-importar-glb.js'];

describe('separaGerador', () => {
  it('guarda o generator INTEIRO em `source`, e extrai a versao', () => {
    assert.deepEqual(separaGerador('RealityCapture 1.2.1'), {
      source: 'RealityCapture 1.2.1', sourceVersion: '1.2.1',
    });
    assert.deepEqual(separaGerador('glTF-Transform v4.0.5'), {
      source: 'glTF-Transform v4.0.5', sourceVersion: '4.0.5',
    });
  });

  it('nao perde o sufixo que vem DEPOIS da versao', () => {
    // "build 16268" nao cabe em `sourceVersion` e nao pode ser descartado: e por isso
    // que `source` guarda tudo. Um parser que partisse a string jogaria fora este dado.
    assert.deepEqual(separaGerador('Agisoft Metashape 2.0.2 build 16268'), {
      source: 'Agisoft Metashape 2.0.2 build 16268', sourceVersion: '2.0.2',
    });
  });

  it('motor sem versao mantem `source` e deixa a versao nula', () => {
    // Discriminacao: sem este caso, uma implementacao que copiasse o generator nas DUAS
    // colunas passaria em tudo acima.
    assert.deepEqual(separaGerador('COLMAP'), { source: 'COLMAP', sourceVersion: null });
    assert.deepEqual(separaGerador('Cesium ion'), { source: 'Cesium ion', sourceVersion: null });
  });

  it('a primeira versao ganha, e nao a ultima', () => {
    // Discriminacao contra um `findLast`: aqui as duas casam o padrao de versao, e a que
    // significa a versao do motor e a primeira.
    assert.equal(separaGerador('Motor 3.1 patch 7').sourceVersion, '3.1');
  });

  it('ausencia vira nulo nas duas, nunca string vazia', () => {
    // String vazia numa coluna de proveniencia mente pior que NULL: ela diz que alguem
    // gravou alguma coisa.
    for (const vazio of [null, undefined, '', '   ', 42, {}]) {
      assert.deepEqual(separaGerador(vazio), { source: null, sourceVersion: null }, String(vazio));
    }
  });

  it('apara o espaco da origem', () => {
    assert.deepEqual(separaGerador('  Cesium ion  '), { source: 'Cesium ion', sourceVersion: null });
  });
});

// SAIBA O ALCANCE DESTE BLOCO, que é estreito de propósito. Ele ancora em `meta.run('X'`,
// que é sintaticamente inequívoco, e NÃO tenta descobrir os leitores por varredura: a
// primeira versão tentou, e acusou `rotHeading`/`rotPitch`/`rotRoll` de órfãs quando
// `configDeCatalogo` as lê por acesso com colchete (`meta[campo]`, dentro de um laço).
// Uma regra que produz falso positivo é uma regra que alguém desliga, então esta mede só
// o que consegue medir sem errar: a chave saiu do importador.
//
// O que ele NÃO pega, e continua sendo cobrado por leitura: coluna nova em `a3d.models`
// cujo leitor nasça sem escritor (foi assim que as três de proveniência ficaram nulas), e
// escritor que grave a chave com valor errado.
describe('o cabeçalho grava o que o registro de produção lê', () => {
  const fonte = IMPORTADORES.map((f) => readFileSync(join(RAIZ, f), 'utf-8')).join('\n');
  const escritas = new Set([...fonte.matchAll(/meta\.run\('([^']+)'/g)].map((m) => m[1]));

  it('discriminação: a extração ENXERGA as chaves', () => {
    // Sem este caso, um regex que parasse de casar deixaria todo o resto passar vazio.
    assert.ok(escritas.size >= 15, `esperava o cabeçalho inteiro, vi ${escritas.size}`);
    assert.ok(escritas.has('buildToken'), 'o token de geração é a chave mais antiga daqui');
  });

  it('as TRÊS de proveniência têm escritor', () => {
    // É a regressão exata: `linhaDeProducao` lê as três, `UPSERT_MODEL_3D` as grava com
    // COALESCE, e até 2026-08-23 nenhum importador as escrevia.
    for (const chave of ['source', 'sourceVersion', 'capturedAt']) {
      assert.ok(escritas.has(chave), `\`${chave}\` perdeu o escritor no importador`);
    }
  });
});
