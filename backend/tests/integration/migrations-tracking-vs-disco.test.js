// Path: tests/integration/migrations-tracking-vs-disco.test.js
// Item 102 — `_migrations` versus os arquivos em disco.
//
// O runner casa arquivo com linha de `_migrations` pelo NOME (`runMigrations`).
// Renomear uma migração já aplicada faz o runner tratá-la como nova e re-executar
// o DDL (`CREATE TABLE sv360.projects` → erro, deploy quebrado); REMOVER o arquivo
// deixa a linha órfã sem ninguém notar.
//
// REFUTAÇÃO PARCIAL: o relatório pedia trocar o `assert.ok(n > 0)` de
// low-impact-fixes.test.js:264 — esse teste JÁ FOI REMOVIDO (a própria suíte
// registra a remoção em comentário) e a idempotência já é asserida contra ESTADO em
// config-infra-gaps.test.js ('re-running migrations … changes nothing'). O que
// continua sem cobertura, e é o que este arquivo prende, são os dois sentidos da
// comparação BANCO × DISCO e a estabilidade dos dados semeados PELAS migrações.
//
// A SEGUNDA METADE, de 2026-09-13 (decisão D6): o nome era a ÚNICA chave, então uma
// baseline já aplicada que mudasse de CONTEÚDO era pulada em silêncio, e a coluna nova
// passava a existir no repositório e nunca no banco. Foi o que aconteceu de verdade com
// `004_sync.sql`, que ganhou quatro objetos depois da consolidação. Os casos de checksum
// abaixo prendem os três desfechos: deriva recusada, linha antiga sem checksum adotada, e
// rodada normal gravando o hash de toda baseline.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { runMigrations } from '../../src/database/migrate.js';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../src/database/migrations');
const ARQUIVOS = fs.readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();

/**
 * O checksum ESPERADO, calculado aqui e não importado do migrador.
 *
 * Conferir o hash gravado chamando a mesma função que o gravou é o verificador chancelando
 * a si mesmo: um erro de normalização passaria dos dois lados igual. Esta é a segunda
 * implementação, por caminho independente, e é ela que dá sentido à igualdade.
 *
 * @param {string} sql
 * @returns {string}
 */
const hashEsperado = (sql) =>
  crypto.createHash('sha256').update(sql.replace(/\r\n/g, '\n'), 'utf8').digest('hex');

/**
 * Copia as baselines para um diretório temporário e edita UMA delas.
 *
 * O migrador precisa ver os MESMOS nomes que já estão em `_migrations`, senão o guarda de
 * nome ausente dispara primeiro e o caso mediria o guarda errado. E a edição não pode
 * tocar o repositório, porque o arquivo editado seria lido por toda suíte vizinha.
 *
 * @param {string} arquivo nome do .sql a editar
 * @param {string} sufixo texto acrescentado ao fim do arquivo
 * @returns {string} caminho do diretório temporário
 */
function copiaComEdicao(arquivo, sufixo) {
  const destino = fs.mkdtempSync(path.join(os.tmpdir(), 'ebgeo-migr-'));
  for (const nome of ARQUIVOS) fs.copyFileSync(path.join(DIR, nome), path.join(destino, nome));
  fs.appendFileSync(path.join(destino, arquivo), sufixo);
  return destino;
}

describe('_migrations × arquivos em disco (item 102)', () => {
  let db;

  before(async () => {
    const env = await setupTestEnv();
    db = env.db;
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  const nomesNoBanco = async () => {
    const { rows } = await db.query('SELECT name FROM _migrations ORDER BY name');
    return rows.map((r) => r.name);
  };

  it('o conjunto do banco é EXATAMENTE o conjunto do disco, nos dois sentidos', async () => {
    assert.ok(ARQUIVOS.length >= 5, `guarda: esperava >= 5 migrações em disco, achei ${ARQUIVOS.length}`);

    const banco = await nomesNoBanco();
    assert.ok(banco.length >= 5, `guarda: esperava >= 5 linhas em _migrations, achei ${banco.length}`);

    const porAplicar = ARQUIVOS.filter((f) => !banco.includes(f));
    assert.deepEqual(porAplicar, [], 'arquivo em disco que nunca foi aplicado');

    const orfas = banco.filter((n) => !ARQUIVOS.includes(n));
    assert.deepEqual(orfas, [], 'linha em _migrations sem arquivo correspondente (renomeada ou removida)');

    // Igualdade de LISTA (e não só de conjuntos): pega também duplicata de nome.
    assert.deepEqual(banco, ARQUIVOS);
  });

  it('controle negativo: um nome fantasma em _migrations quebra a comparação', async () => {
    // Dentro de uma transação revertida — o assert precisa saber discriminar, e o
    // banco não pode ficar sujo para as outras suítes.
    await db.query('BEGIN');
    try {
      await db.query("INSERT INTO _migrations (name) VALUES ('999_fantasma.sql')");
      const banco = await nomesNoBanco();
      const orfas = banco.filter((n) => !ARQUIVOS.includes(n));
      assert.deepEqual(orfas, ['999_fantasma.sql'], 'a comparação precisa VER a linha órfã');
      assert.notDeepEqual(banco, ARQUIVOS, 'e a igualdade de lista precisa falhar');
    } finally {
      await db.query('ROLLBACK');
    }

    // E depois do rollback o estado volta a ser o correto (prova que o controle
    // negativo não deixou resíduo).
    const depois = await nomesNoBanco();
    assert.deepEqual(depois, ARQUIVOS);
  });

  it('re-executar runMigrations não duplica o dado semeado pelas migrações', async () => {
    // `INSERT INTO ranks` (001_identidade_e_credenciais.sql) NÃO tem ON CONFLICT e a tabela não tem
    // UNIQUE em code/nome: se o tracking falhar, duplica em silêncio e o dropdown
    // de posto passa a mostrar 38 itens em vez de 19.
    const contar = async (tabela) => {
      const { rows } = await db.query(`SELECT COUNT(*)::int AS n FROM ${tabela}`);
      assert.equal(rows.length, 1);
      return rows[0].n;
    };

    const ranksAntes = await contar('ranks');
    const basemapsAntes = await contar('basemaps');
    // Guarda de não-vacuidade: prova que o seed rodou, sem prender o valor EXATO.
    // Prendia `=== 19` e isso quebrava na suíte completa, porque `ranks.test.js` cria postos
    // na mesma base compartilhada: o teste passava isolado e reprovava em conjunto, dizendo
    // "ranks duplicou" quando o que houve foi outra suíte inserindo. Contagem absoluta de
    // tabela que outra suíte escreve é acoplamento disfarçado de asserção.
    assert.ok(ranksAntes >= 19, `guarda: esperava >= 19 postos semeados, achei ${ranksAntes}`);
    assert.ok(basemapsAntes >= 5, `guarda: esperava >= 5 basemaps semeados, achei ${basemapsAntes}`);

    await runMigrations(process.env.DATABASE_URL);

    assert.equal(await contar('ranks'), ranksAntes, 'ranks duplicou: o tracking por nome falhou');
    assert.equal(await contar('basemaps'), basemapsAntes, 'basemaps duplicou');
    assert.deepEqual(await nomesNoBanco(), ARQUIVOS, 'e nenhuma linha nova em _migrations');
  });

  it('recusa histórico anterior à consolidação sem alterar tracking ou dados', async () => {
    const original = ARQUIVOS[0];
    const antigo = '001_' + 'identidade.sql';
    const antes = (await db.query('SELECT id, code, nome FROM ranks ORDER BY id')).rows;
    await db.query('UPDATE _migrations SET name = $1 WHERE name = $2', [antigo, original]);
    try {
      const historico = await nomesNoBanco();
      await assert.rejects(runMigrations(process.env.DATABASE_URL), /Histórico de migrações incompatível/);
      assert.deepEqual(await nomesNoBanco(), historico, 'não pode marcar a nova baseline como aplicada');
      assert.deepEqual((await db.query('SELECT id, code, nome FROM ranks ORDER BY id')).rows, antes);
    } finally {
      await db.query('UPDATE _migrations SET name = $1 WHERE name = $2', [original, antigo]);
    }
    // Refusal must release the advisory lock so a corrected history can run again.
    await runMigrations(process.env.DATABASE_URL);
    assert.deepEqual(await nomesNoBanco(), ARQUIVOS);
  });

  const linhasNoBanco = async () => {
    const { rows } = await db.query('SELECT name, checksum FROM _migrations ORDER BY name');
    return rows;
  };

  it('a rodada normal grava o checksum de toda baseline aplicada', async () => {
    const linhas = await linhasNoBanco();
    assert.equal(linhas.length, ARQUIVOS.length, 'guarda: uma linha por arquivo em disco');

    const divergentes = linhas.filter(
      (l) => l.checksum !== hashEsperado(fs.readFileSync(path.join(DIR, l.name), 'utf8'))
    );
    assert.deepEqual(divergentes.map((l) => l.name), [],
      'checksum gravado que não bate com o conteúdo do arquivo');
  });

  it('recusa baseline cujo conteúdo mudou depois de aplicada, nomeando arquivo e hash', async () => {
    const alvo = '004_sync.sql';
    assert.ok(ARQUIVOS.includes(alvo), `guarda: ${alvo} precisa existir em disco`);

    const antes = await linhasNoBanco();
    const gravada = antes.find((l) => l.name === alvo);
    assert.ok(gravada, `guarda: ${alvo} precisa estar aplicada`);
    assert.equal(typeof gravada.checksum, 'string', 'guarda: e precisa ter checksum gravado');

    const dir = copiaComEdicao(alvo, '\nALTER TABLE operations ADD COLUMN drift_de_teste TEXT;\n');
    try {
      const editado = hashEsperado(fs.readFileSync(path.join(dir, alvo), 'utf8'));
      // Discriminação: se a edição não mudasse o hash, o vermelho abaixo viria de outra
      // coisa e este caso estaria medindo o nada.
      assert.notEqual(editado, gravada.checksum, 'a edição precisa MUDAR o hash');

      await assert.rejects(
        runMigrations(process.env.DATABASE_URL, dir),
        (err) => {
          assert.match(err.message, /conteúdo alterado em disco/);
          assert.ok(err.message.includes(alvo), 'a mensagem precisa nomear o arquivo');
          assert.ok(err.message.includes(gravada.checksum), 'e citar o hash gravado');
          assert.ok(err.message.includes(editado), 'e o hash atual');
          return true;
        }
      );

      assert.deepEqual(await linhasNoBanco(), antes,
        '_migrations não pode ser tocada quando a rodada é recusada');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }

    // E a recusa solta o advisory lock: com o disco íntegro a rodada seguinte passa.
    await runMigrations(process.env.DATABASE_URL);
    assert.deepEqual(await linhasNoBanco(), antes);
  });

  it('adota o checksum de linha rastreada antes de esta coluna existir', async () => {
    const alvo = ARQUIVOS[ARQUIVOS.length - 1];
    const esperado = hashEsperado(fs.readFileSync(path.join(DIR, alvo), 'utf8'));

    await db.query('UPDATE _migrations SET checksum = NULL WHERE name = $1', [alvo]);
    const nula = await db.query('SELECT checksum FROM _migrations WHERE name = $1', [alvo]);
    assert.equal(nula.rows.length, 1);
    assert.equal(nula.rows[0].checksum, null, 'guarda: a linha precisa entrar sem checksum');

    await runMigrations(process.env.DATABASE_URL);

    const depois = await db.query('SELECT checksum FROM _migrations WHERE name = $1', [alvo]);
    assert.equal(depois.rows.length, 1);
    assert.equal(depois.rows[0].checksum, esperado,
      'a linha sem checksum recebe o do disco, sem reprovar o banco antigo');
    assert.deepEqual(await nomesNoBanco(), ARQUIVOS, 'e o tracking de nomes não muda');
  });

  it('controle negativo: a comparação por NOME, sozinha, não vê a edição', async () => {
    // Era exatamente este o buraco antes de 2026-09-13: o conjunto de nomes continua
    // idêntico, o migrador pula tudo como "already applied" e a coluna nova existe só no
    // repositório. Sem o checksum, portanto, a edição passa em silêncio.
    const alvo = '004_sync.sql';
    const dir = copiaComEdicao(alvo, '\nALTER TABLE operations ADD COLUMN drift_de_teste TEXT;\n');
    try {
      const nomes = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
      assert.deepEqual(nomes, ARQUIVOS, 'a regra antiga compara ISTO, e não acusa nada');

      const noDisco = hashEsperado(fs.readFileSync(path.join(DIR, alvo), 'utf8'));
      const noTemporario = hashEsperado(fs.readFileSync(path.join(dir, alvo), 'utf8'));
      assert.notEqual(noTemporario, noDisco, 'enquanto o conteúdo mudou de verdade');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
