// Path: tests/integration/diag-cli-estado-de-defeito.test.js
//
// `npm run diag -- resolver | ignorar | reabrir` contra o BANCO DE VERDADE, dirigindo
// `scripts/diag.js` por `spawnSync`.
//
// POR QUE INTEGRAÇÃO E NÃO UNIDADE. É o mesmo argumento de `diag-cli-defeitos.test.js`, com
// um agravante: aqui o comando ESCREVE. O que só o banco prova é a junção, e ela tem três
// peças que um duplo de teste esconderia — o CASE de `UPDATE_ESTADO_DE_DEFEITO` (que decide
// o que cada verbo faz com quatro colunas), a linha de trilha dentro da MESMA transação (que
// morreria com 23514 se a ação não estivesse no CHECK, ou seja, se
// `019_defeito_estado_auditado.sql` não tivesse sido aplicada), e a resolução do `--como`
// contra `users`.
//
// O CASO QUE MAIS IMPORTA É O DO ATOR. `audit_trail.actor_id` é NOT NULL e o terminal não tem
// sessão: sem `--como` o ato mais consequente deste módulo ficaria sem autor na trilha. A
// bandeira NÃO é autenticação e não pretende ser (quem tem shell tem `DATABASE_URL`); o que
// ela compra é ATRIBUIÇÃO, e o gate de papel existe para o comando não poder assinar como
// administrador um ato que a rota equivalente recusaria. As duas recusas (conta inexistente e
// conta sem o papel) são asseridas SEPARADAMENTE porque elas mandam fazer coisas opostas.
//
// TODO CASO É RECORTADO POR UMA `pagina` ÚNICA, como no arquivo irmão: a suíte compartilha o
// banco, e contagem relativa não reprova quando o filtro para de filtrar.
//
// CONTROLE NEGATIVO (conferido revertendo cada um):
//  - tirar o gate de papel de `resolverAtorAdministrador`: o caso do produtor passa a
//    ESCREVER, e o caso fica vermelho no estado do defeito;
//  - filtrar `role = 'admin'` dentro do SQL em vez de na função: as duas recusas passam a ter
//    a mesma frase, e o caso que separa as duas mensagens fica vermelho;
//  - tirar o `pgp.end()` do `finally`: todos os casos travam no timeout;
//  - trocar `ESTADO_DO_VERBO[op.comando]` por `op.comando`: o caso de `reabrir` fica vermelho
//    com 23514, porque "reabrir" não é um estado.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createProducerUser, createAdminUser } from '../helpers/fixtures.js';
import { ACAO_DE_ESTADO } from '../../src/modules/diag/defeitos.service.js';

const COMANDO = fileURLToPath(new URL('../../scripts/diag.js', import.meta.url));
const MARCA = randomUUID().slice(0, 8);
const PAGINA = `cliestado-${MARCA}`;

/**
 * Roda o comando num processo filho, COM PRAZO.
 *
 * O `timeout` e a asserção sobre `signal` são os mesmos de `diag-cli-defeitos.test.js`, pelo
 * mesmo motivo medido lá: este comando abre um pool do Postgres, e um pool que não feche
 * prende o filho para sempre — o `spawnSync` bloqueia e leva a rodada INTEIRA junto, sem
 * timeout de caso e sem uma linha que aponte para a causa. `status` vem `null` quando o filho
 * é MORTO, e comparar `null` com um código esperado reprova por um motivo que não é o do caso.
 */
function rodar(args) {
  const r = spawnSync(process.execPath, [COMANDO, ...args], {
    encoding: 'utf8', env: process.env, timeout: 30_000, killSignal: 'SIGKILL',
  });
  assert.equal(r.signal, null, `o comando foi morto por ${r.signal}: pool vazado ou consulta presa`);
  return { codigo: r.status, saida: r.stdout || '', erro: r.stderr || '' };
}

describe('diag CLI: o ciclo de vida do defeito contra o banco', () => {
  let db, admin, produtor;

  async function semear(nome, campos = {}) {
    const { estado = 'aberto', resolvidoNaRelease = null } = campos;
    const { rows } = await db.query(
      `INSERT INTO defeitos
         (assinatura, mensagem, pagina, estado, release, primeira_release, ultima_release,
          ocorrencias, resolvido_na_release)
       VALUES ($1, $2, $3, $4, 'v1', 'v1', 'v1', 5, $5)
       RETURNING id`,
      [`TypeError | ${nome} | ${MARCA}`, `mensagem de ${nome}`, PAGINA, estado, resolvidoNaRelease]
    );
    return rows[0].id;
  }

  async function cru(id) {
    const { rows } = await db.query(
      `SELECT estado, resolvido_em, resolvido_por, resolvido_na_release, resolvido_no_commit
         FROM defeitos WHERE id = $1`,
      [id]
    );
    return rows[0];
  }

  before(async () => {
    const env = await setupTestEnv();
    db = env.db;
    admin = await createAdminUser(db, { username: `cli_adm_${randomUUID().slice(0, 6)}` });
    // O PRODUTOR É O CONTRA-EXEMPLO CERTO, e não um `user` comum: o eixo global não é uma
    // escada, e "escreve" é a palavra que faz alguém supor autoridade. Ele MANTÉM o acervo da
    // própria OM e não administra o sistema.
    produtor = await createProducerUser(db, '00000000-0000-0000-0000-000000000001', { username: `cli_prd_${randomUUID().slice(0, 6)}` });
  });

  after(async () => {
    await db.query('DELETE FROM audit_trail WHERE action = $1 AND target_name LIKE $2', [ACAO_DE_ESTADO, `%${MARCA}%`]);
    await db.query('DELETE FROM defeitos WHERE pagina = $1', [PAGINA]);
    await teardownTestEnv(db);
  });

  // ------------------------------------------------------------- os três verbos
  it('`resolver <id> --como <admin> --commit <hash>` escreve as quatro colunas', async () => {
    const id = await semear('resolver');
    const r = rodar(['resolver', id, '--como', admin.username, '--commit', 'abc1234']);
    assert.equal(r.codigo, 0, r.erro);

    const l = await cru(id);
    assert.equal(l.estado, 'resolvido');
    assert.equal(l.resolvido_por, admin.id, 'o ator do `--como`, e não NULL');
    assert.equal(l.resolvido_no_commit, 'abc1234');
    assert.ok(l.resolvido_em instanceof Date);

    // A SAÍDA NOMEIA A TRANSIÇÃO INTEIRA, e não só o estado final: um comando que
    // respondesse apenas "resolvido" seria indistinguível quando o defeito JÁ estava assim.
    assert.match(r.saida, /aberto . resolvido/);
    assert.match(r.saida, new RegExp(admin.username));
    // Em desenvolvimento não há `EBGEO_RELEASE`, e o comando DIZ o que isso custa em vez de
    // deixar o operador descobrir sozinho. O custo é o INVERSO do que a leitura natural
    // sugere, e a frase tem de dizer o FATO: com a coluna nula, a próxima ocorrência que
    // traga release reabre o defeito como `regrediu`. A asserção mira essa metade da frase,
    // e não só o cabeçalho, porque foi justamente o cabeçalho que sobreviveu a uma redação
    // errada.
    assert.match(r.saida, /não anotada/);
    assert.match(r.saida, /SEM RELEASE ANOTADA/);
    assert.match(r.saida, /reabre este defeito como/);
    assert.match(r.saida, /Ocorrência SEM release não move nada/);
    assert.doesNotMatch(r.saida, /resolvido para sempre/, 'a afirmação invertida não pode voltar');
  });

  it('`ignorar` muda o estado e NÃO toca nas colunas de conserto', async () => {
    const id = await semear('ignorar', { estado: 'resolvido', resolvidoNaRelease: 'v9' });
    const r = rodar(['ignorar', id, '--como', admin.username]);
    assert.equal(r.codigo, 0, r.erro);

    const l = await cru(id);
    assert.equal(l.estado, 'ignorado');
    assert.equal(l.resolvido_na_release, 'v9', 'ignorar não desfaz o registro de um conserto anterior');
  });

  it('`reabrir` escreve `aberto` (e não "reabrir") e LIMPA as quatro colunas', async () => {
    // O verbo NÃO é o estado, e este é o único dos três em que os dois diferem. Um
    // `op.comando` usado direto como estado passaria nos outros dois e morreria aqui com
    // 23514 vindo do CHECK.
    const id = await semear('reabrir', { estado: 'resolvido', resolvidoNaRelease: 'v9' });
    const r = rodar(['reabrir', id, '--como', admin.username]);
    assert.equal(r.codigo, 0, r.erro);

    const l = await cru(id);
    assert.equal(l.estado, 'aberto');
    assert.equal(l.resolvido_na_release, null);
    assert.equal(l.resolvido_por, null);
    assert.match(r.saida, /LIMPAS/);
  });

  it('a transição sai NOMEADA quando não muda nada', async () => {
    const id = await semear('repetido', { estado: 'ignorado' });
    const r = rodar(['ignorar', id, '--como', admin.username]);
    assert.equal(r.codigo, 0, r.erro);
    assert.match(r.saida, /já estava assim/, 'repetir o comando não pode parecer um ato novo');
  });

  it('cada ato deixa UMA linha na trilha, com o ator do `--como`', async () => {
    const id = await semear('trilha-cli');
    rodar(['resolver', id, '--como', admin.username]);
    rodar(['reabrir', id, '--como', admin.username]);

    const { rows } = await db.query(
      'SELECT action, actor_id, target_type, target_id, details, ip FROM audit_trail WHERE target_id = $1 ORDER BY created_at',
      [id]
    );
    assert.equal(rows.length, 2, 'dois atos, duas linhas');
    assert.equal(rows[0].action, ACAO_DE_ESTADO);
    assert.equal(rows[0].actor_id, admin.id, 'o ator é uma PESSOA, e não "o sistema"');
    assert.equal(rows[0].target_type, 'SYSTEM');
    assert.equal(rows[0].target_id, id);
    assert.equal(rows[0].details.para, 'resolvido');
    assert.equal(rows[1].details.de, 'resolvido');
    assert.equal(rows[1].details.para, 'aberto');
    // O comando não tem `req`, então `createAudit` degrada o endereço para 'system'. É o
    // desfecho certo e vale asserir: ele DISTINGUE a linha do terminal da linha da rota.
    assert.equal(rows[0].ip, 'system');
  });

  // ------------------------------------------------------------------ as recusas
  it('sem `--como` o comando RECUSA, e explica por que a bandeira existe', async () => {
    const id = await semear('sem-como');
    const r = rodar(['resolver', id]);
    assert.equal(r.codigo, 1);
    assert.match(r.erro, /--como/);
    assert.match(r.erro, /actor_id/, 'a recusa nomeia a razão estrutural, e não só a regra');
    assert.equal((await cru(id)).estado, 'aberto', 'e nada foi escrito');
  });

  it('conta INEXISTENTE e conta SEM O PAPEL têm frases DIFERENTES', async () => {
    // As duas mandam fazer coisas opostas: conferir o que se digitou, ou pedir a outra
    // pessoa. É por isso que o papel não entra no predicado do SQL — filtrado lá, os dois
    // casos voltariam como a mesma lista vazia.
    const id = await semear('duas-recusas');

    const inexistente = rodar(['resolver', id, '--como', `ninguem_${MARCA}`]);
    assert.equal(inexistente.codigo, 1);
    assert.match(inexistente.erro, /Não há conta ATIVA/);

    const semPapel = rodar(['resolver', id, '--como', produtor.username]);
    assert.equal(semPapel.codigo, 1);
    assert.match(semPapel.erro, /NÃO é administrador do sistema/);
    assert.match(semPapel.erro, /não é uma escada/, 'a frase explica o eixo, e não só nega');

    assert.notEqual(inexistente.erro, semPapel.erro, 'as duas recusas não podem colapsar numa só');
    assert.equal((await cru(id)).estado, 'aberto', 'nenhuma das duas escreveu');
  });

  it('conta DESATIVADA não serve como ator', async () => {
    const inativo = await createAdminUser(db, { username: `cli_off_${randomUUID().slice(0, 6)}` });
    await db.query('UPDATE users SET is_active = false WHERE id = $1', [inativo.id]);
    const id = await semear('inativo');
    const r = rodar(['resolver', id, '--como', inativo.username]);
    assert.equal(r.codigo, 1);
    assert.match(r.erro, /Não há conta ATIVA/, 'a rota equivalente a recusaria com 401 antes do gate de papel');
    assert.equal((await cru(id)).estado, 'aberto');
  });

  it('id ausente, malformado e inexistente são recusas distintas, todas sem escrever', async () => {
    const semId = rodar(['resolver', '--como', admin.username]);
    assert.equal(semId.codigo, 1);
    assert.match(semId.erro, /Falta o id/);

    const torto = rodar(['resolver', 'nao-e-uuid', '--como', admin.username]);
    assert.equal(torto.codigo, 1);
    assert.match(torto.erro, /não é um uuid/);

    const sumido = rodar(['resolver', randomUUID(), '--como', admin.username]);
    assert.equal(sumido.codigo, 1);
    assert.match(sumido.erro, /Nenhum defeito com id/);
    assert.match(sumido.erro, /Nada foi alterado/);
  });

  it('`--commit` longo demais RECUSA nomeando o campo, e não cai num 23514 com pilha', async () => {
    // O teto de 64 (o comprimento de um SHA-256 em hexadecimal) era imposto SÓ no Joi da
    // rota. Pelo terminal não havia borda nenhuma: o valor descia até o banco e voltava como
    // 23514 do CHECK, com pilha crua na frente do operador. O aparo mora hoje em
    // `mudarEstadoDoDefeito`, que é o ponto comum às duas bordas.
    const id = await semear('commit-longo');
    const r = rodar(['resolver', id, '--como', admin.username, '--commit', 'x'.repeat(65)]);

    assert.equal(r.codigo, 1);
    assert.match(r.erro, /commit/, 'a frase nomeia o CAMPO, que é o que a pessoa pode corrigir');
    assert.match(r.erro, /64/, 'e o teto, que é o outro metade do que ela precisa saber');
    assert.match(r.erro, /Nada foi alterado/);
    // As DUAS metades do controle: nenhum vazamento do driver, e nenhuma escrita.
    assert.doesNotMatch(r.erro, /23514|at Parser|node_modules/, 'nada de pilha nem de código do driver');
    assert.equal((await cru(id)).estado, 'aberto');

    // NÃO-VACUIDADE: exatamente 64 passa, o que prova que a recusa é do TETO e não do campo.
    const ok = rodar(['resolver', id, '--como', admin.username, '--commit', 'a'.repeat(64)]);
    assert.equal(ok.codigo, 0, ok.erro);
    assert.equal((await cru(id)).resolvido_no_commit, 'a'.repeat(64));
  });

  it('o id POSICIONAL vale só nos verbos: um typo em `defeitos` não vira "não é um uuid"', () => {
    // Enquanto o posicional valia para TODO comando, `diag -- defeitos aberto` (o operador
    // quis `--estado aberto`) respondia "--id não é um uuid", que manda procurar o erro no
    // lugar errado; e o VALOR de uma bandeira desconhecida virava id em silêncio.
    const r = rodar(['defeitos', 'aberto', '--desde', '1h', '--json']);
    assert.equal(r.codigo, 0, r.erro);
    assert.doesNotMatch(r.erro, /não é um uuid/, 'o token solto não pode ser lido como id aqui');
    const doc = JSON.parse(r.saida);
    assert.equal(doc.comando, 'defeitos');
    assert.ok(Array.isArray(doc.itens), 'a listagem responde normalmente, ignorando o token solto');

    // O POSITIVO DO MESMO PAR, sem o qual o caso acima passaria com o posicional removido de
    // vez: nos verbos ele CONTINUA valendo, que é a forma natural de digitá-los.
    const semUuid = rodar(['resolver', 'aberto', '--como', admin.username]);
    assert.equal(semUuid.codigo, 1);
    assert.match(semUuid.erro, /não é um uuid/, 'nos verbos o token solto É o id');
  });

  // ---------------------------------------------------------------------- --json
  it('`--json` devolve UM documento com o defeito, a transição e o ator', async () => {
    const id = await semear('json');
    const r = rodar(['resolver', id, '--como', admin.username, '--commit', 'feed123', '--json']);
    assert.equal(r.codigo, 0, r.erro);

    const doc = JSON.parse(r.saida);
    assert.equal(doc.comando, 'resolver');
    // A janela é `null` porque o comando age sobre UMA linha achada por id: uma janela de
    // 24h ali seria inventada e não filtrou coisa alguma.
    assert.equal(doc.janela, null);
    assert.equal(typeof doc.gerado_em, 'number', 'epoch ms, como toda data desta família');
    assert.deepEqual(doc.transicao, { de: 'aberto', para: 'resolvido' });
    assert.equal(doc.ator.id, admin.id);
    assert.equal(doc.ator.username, admin.username);
    assert.equal(doc.defeito.id, id);
    assert.equal(doc.defeito.estado, 'resolvido');
    assert.equal(doc.defeito.resolvidoNoCommit, 'feed123');
    // O CONTRATO DO --json: UM documento no stdout e NADA MAIS ali.
    assert.equal(r.saida.trim().endsWith('}'), true);
  });

  it('sob `--json`, a recusa NÃO polui o stdout', async () => {
    // Um texto de ajuda ou um aviso no stdout quebraria todo `| jq` exatamente no caso em
    // que o operador errou o comando, que é quando ele mais precisa ler o erro.
    const r = rodar(['resolver', randomUUID(), '--como', admin.username, '--json']);
    assert.equal(r.codigo, 1);
    assert.equal(r.saida.trim(), '');
    assert.ok(r.erro.length > 0);
  });
});
