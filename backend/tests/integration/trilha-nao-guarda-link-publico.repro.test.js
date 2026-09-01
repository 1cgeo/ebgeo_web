// Path: tests/integration/trilha-nao-guarda-link-publico.repro.test.js
// Regressão: a trilha de auditoria guardava o LINK PÚBLICO literal do atlas.
//
// O DEFEITO. `enablePublicSharing` (src/modules/sharing/sharing.service.js) gravava
// `details.publicLink` com o valor cru devolvido por `atlasService.enablePublicSharing`. Esse
// valor são 128 bits de `randomBytes(16)`, e a rota que o consome (`GET /atlas/public/:link`, em
// src/modules/atlas/atlas.routes.js) não monta `auth` nenhum, só o limitador: quem tem a string
// exerce o acesso sem identidade e sem sessão. É capacidade portadora, não identificador.
//
// POR QUE ISSO NÃO SE CONSERTA DEPOIS. A trilha é append-only. Enquanto o atlas seguir publicado
// (o estado normal, e sem prazo) a linha carrega a credencial VIVA, e quem a leu num dump, numa
// réplica ou num backup segue exercendo o acesso DEPOIS de perder a conta, porque a rota não
// pergunta quem é. Despublicar mata aquela cópia e não apaga a string da trilha. A doutrina que fecharia
// isso já existe (`audit-diff.js` põe todo ENDEREÇO no regime de impressão), e não alcançava este
// caso porque este `details` é escrito à mão e nunca passa por aquele motor.
//
// O QUE ESTE ARQUIVO PRENDE, e a ordem é a das três perguntas:
//   1. o link literal NÃO aparece em lugar nenhum da linha (nem em `details`, nem na linha
//      inteira serializada);
//   2. a impressão é ESTÁVEL para a mesma entrada e DIFERENTE para entradas diferentes, que é o
//      que faz a trilha continuar respondendo "o link mudou entre estes dois atos?";
//   3. a impressão não é uma fatia do valor (nem prefixo, nem sufixo, nem substring).
//
// GUARDA DE NÃO-VACUIDADE, obrigatória: os casos abaixo asseriram primeiro que os DOIS links
// EXISTEM e são links de verdade (32 hex, e distintos entre si). Sem ela, um cenário em que
// nenhum link fosse gerado passaria verde provando coisa nenhuma — que é exatamente o modo de
// falha de um teste que procura a ausência de uma string.
//
// CONTROLE NEGATIVO: troque a impressão pelo valor cru em `enablePublicSharing` e os casos 1 e 3
// ficam vermelhos nomeando o link.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, loginUser } from '../helpers/fixtures.js';
import { impressaoDeValor, TAMANHO_IMPRESSAO } from '../../src/utils/audit-diff.js';

describe('a trilha guarda a impressão do link público, nunca o link (repro)', () => {
  let app, db, owner, ownerTok, atlas;
  let link1, link2, linhas;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    const rid = randomUUID().slice(0, 8);
    owner = await createUser(db, { username: `linkaud_${rid}` });
    ownerTok = await loginUser(app, owner.username, owner.password);
    atlas = await createAtlas(db, owner.id, { name: 'Atlas Publicado' });

    const publicar = async () => {
      const res = await supertest(app)
        .post(`/api/v1/atlas/${atlas.id}/sharing/public`)
        .set('Authorization', `Bearer ${ownerTok}`)
        .expect(200);
      return res.body.data.publicLink ?? res.body.data.public_link ?? null;
    };

    link1 = await publicar();
    link2 = await publicar();

    const { rows } = await db.query(
      `SELECT action, actor_id, target_type, target_id, details, created_at
         FROM audit_trail
        WHERE target_id = $1 AND action = 'SHARING_CHANGE'
        ORDER BY created_at ASC, id ASC`,
      [atlas.id]
    );
    linhas = rows.filter((r) => r.details?.isPublic === true);
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  it('NÃO-VACUIDADE: as duas publicações geraram links de verdade, e eles são diferentes', () => {
    // Sem este caso, todo o resto do arquivo poderia passar num cenário em que nenhum link foi
    // gerado: procurar por uma string ausente é trivialmente verde quando ela nunca existiu.
    assert.match(link1 ?? '', /^[0-9a-f]{32}$/, 'a primeira publicação devolveu um link');
    assert.match(link2 ?? '', /^[0-9a-f]{32}$/, 'a segunda também');
    assert.notEqual(link1, link2, 'republicar gera link novo — é essa mudança que a trilha registra');
    assert.equal(linhas.length, 2, 'e as duas publicações deixaram uma linha de trilha cada');
  });

  it('o link literal não aparece em nenhuma linha da trilha', () => {
    assert.equal(linhas.length, 2, 'há duas linhas a varrer — laço vazio não prova ausência');
    for (const linha of linhas) {
      const inteira = JSON.stringify(linha);
      assert.ok(!inteira.includes(link1), 'a linha inteira não carrega o primeiro link');
      assert.ok(!inteira.includes(link2), 'nem o segundo');
      assert.equal(linha.details.publicLink, undefined, 'a chave do valor cru não existe mais');
    }
  });

  it('o que ficou no lugar é a impressão, e ela é a impressão DAQUELE link', () => {
    const [primeira, segunda] = linhas;
    const hex = new RegExp(`^[0-9a-f]{${TAMANHO_IMPRESSAO}}$`);

    assert.match(primeira.details.publicLinkImpressao, hex);
    assert.match(segunda.details.publicLinkImpressao, hex);
    // ESTÁVEL: a mesma entrada dá a mesma impressão, e é isso que amarra a linha ao link que a
    // produziu. Recalcular aqui prova a determinação sem que a trilha guarde o valor.
    assert.equal(primeira.details.publicLinkImpressao, impressaoDeValor(link1));
    assert.equal(segunda.details.publicLinkImpressao, impressaoDeValor(link2));
  });

  it('a linha continua respondendo "mudou ou não mudou"', () => {
    const [primeira, segunda] = linhas;
    // A pergunta que a trilha responde não é "qual era o link", é "ele é o mesmo dos outros
    // atos?". Entradas diferentes, impressões diferentes.
    assert.notEqual(
      primeira.details.publicLinkImpressao, segunda.details.publicLinkImpressao,
      'links distintos deixam impressões distintas'
    );
    // E o outro lado da mesma propriedade: recalcular a impressão do MESMO link duas vezes dá o
    // mesmo resultado, então duas linhas com a mesma impressão significam "não mudou".
    assert.equal(impressaoDeValor(link1), impressaoDeValor(link1));
  });

  it('a impressão não é uma fatia do link', () => {
    for (const [linha, link] of [[linhas[0], link1], [linhas[1], link2]]) {
      const imp = linha.details.publicLinkImpressao;
      assert.ok(imp.length < link.length, 'ela é mais curta que o link');
      assert.ok(!link.includes(imp), 'e não é substring dele: nada do valor viaja');
      assert.ok(!imp.includes(link.slice(0, TAMANHO_IMPRESSAO)), 'nem o prefixo do link');
    }
  });

  it('despublicar continua sem gravar link nenhum', async () => {
    await supertest(app)
      .delete(`/api/v1/atlas/${atlas.id}/sharing/public`)
      .set('Authorization', `Bearer ${ownerTok}`)
      .expect(204);

    const { rows } = await db.query(
      `SELECT details FROM audit_trail
        WHERE target_id = $1 AND action = 'SHARING_CHANGE'
        ORDER BY created_at DESC, id DESC LIMIT 1`,
      [atlas.id]
    );
    assert.equal(rows[0].details.isPublic, false, 'a retirada é registrada');
    const inteira = JSON.stringify(rows[0]);
    assert.ok(!inteira.includes(link1) && !inteira.includes(link2), 'e sem o link que caiu');
  });
});
