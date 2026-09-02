// Path: tests/integration/diag-rotas-de-pilha.test.js
//
// `GET /diag/defeitos/:id` e `GET /diag/defeitos/:id/pilha`, as duas rotas de DEFEITO que
// nasceram em 2026-09-02 com a decisão de que o caso comum é um agente com credencial de
// administrador operando de FORA do host.
//
// A SEGUNDA É A MAIS NECESSÁRIA DAS QUATRO daquele lote, e a razão é material: `npm run diag --
// pilha` precisa dos `.map` da build, que moram no HOST. Quem opera de fora não tem aqueles
// arquivos e não tem como obtê-los, então até esta rota existir a desminificação simplesmente
// não estava disponível para ele — e o campo `stack_bruta` que a alimenta é gravado desde
// sempre, sem consumidor remoto.
//
// O `import` É DINÂMICO porque `EBGEO_MAPAS_DIR` precisa estar no ambiente ANTES da avaliação
// de `config.js`, que é um singleton congelado e que `src/app.js` puxa transitivamente. É o
// mesmo arranjo de `diag-rota-de-resumo.test.js` com `LOG_DIR`, e ele tem uma consequência que
// fica declarada: com a variável FIXA no processo, este arquivo não consegue exercitar o caso
// "o servidor não configurou o diretório". Esse caso, e os outros três desfechos negativos,
// são de `tests/unit/diag-pilha-de-defeito.test.js`, onde o diretório entra por argumento.
//
// O QUE SÓ ESTE ARQUIVO ALCANÇA, portanto: o par de gates, o 404, a validação de `:id` na
// borda, a fiação até `config.mapasDir` e a prova de que a rota devolve o MESMO item que a
// listagem. O par completo está aqui — quem NÃO pode não vê (401/403) e quem PODE vê (200 com
// os quadros resolvidos contra a build semeada); só o negativo passaria idêntico se a rota não
// existisse.
//
// CONTROLE NEGATIVO, conferido revertendo cada peça:
//  - tirar `requireAdmin` de qualquer uma das duas: UM vermelho por rota, o do usuário comum;
//  - tirar `auth`: DOIS por rota;
//  - trocar `ocorrenciasParamsSchema` por um `Joi.string()` nu nos params: o caso do id
//    malformado passa de 422 para 500, porque o `22P02` do driver vira um erro sem relação
//    aparente com o argumento;
//  - devolver 200 em vez de 404 para id inexistente: o caso do 404 fica vermelho, e a rota
//    passaria a dizer que um defeito que não existe existe e está vazio;
//  - trocar `config.mapasDir` por um caminho fixo no controller: o caso dos quadros resolvidos
//    fica vermelho, porque ele compara com a build semeada por ESTE arquivo;
//  - fazer `obterDefeito` usar um mapeador próprio: o caso do espelho com a listagem fica
//    vermelho, que é a propriedade que faz um agente poder comparar as duas respostas.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import supertest from 'supertest';
import { randomUUID } from 'crypto';

/**
 * A fixture de source map, escrita à MÃO, e a mesma de `tests/unit/diag-cli-mapa-de-fonte.test.js`.
 *
 * O `mappings` é uma string literal montada a partir das regras do formato, com as respostas
 * calculadas fora do código testado. Gerá-lo com o nosso codificador passaria verde com as duas
 * metades erradas do mesmo jeito.
 */
const MAPA = {
  version: 3,
  file: 'core-Ab12Cd34.js',
  sources: ['../../src/js/alfa.js', '../../src/js/beta.js'],
  names: ['iniciar', 'parar'],
  mappings: 'AAAAA,UAIE,oBCKIC,oB;IAGND;',
};

const MAPAS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ebgeo-diag-mapas-'));
const RELEASE = `1.0.0+${randomUUID().slice(0, 6)}`;
const OUTRA_RELEASE = `1.0.0+${randomUUID().slice(0, 6)}`;

// A build no disco, no formato que o deploy escreve: uma pasta por release, com `release.json`
// na raiz e os `.map` sob `assets/`. Escrita ANTES do import de `config.js`, como a variável.
{
  const dir = path.join(MAPAS_DIR, 'build-atual');
  fs.mkdirSync(path.join(dir, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'release.json'), JSON.stringify({ release: RELEASE, version: '1.0.0' }));
  fs.writeFileSync(path.join(dir, 'assets', 'core-Ab12Cd34.js.map'), JSON.stringify(MAPA));
}
process.env.EBGEO_MAPAS_DIR = MAPAS_DIR;

const { setupTestEnv, teardownTestEnv } = await import('../helpers/setup.js');
const { createUser, createAdminUser, loginUser } = await import('../helpers/fixtures.js');

const RASTRO = [
  'TypeError: x is not a function',
  '    at iniciar (https://ebgeo.mil.br/assets/core-Ab12Cd34.js:1:31)',
  '    at https://ebgeo.mil.br/assets/core-Ab12Cd34.js:1:11',
  '    at https://ebgeo.mil.br/assets/vendor-Zz99.js:1:4',
].join('\n');

describe('GET /diag/defeitos/:id e /diag/defeitos/:id/pilha', () => {
  let app, db, comum, comumToken, admin, adminToken;
  const MARCA = randomUUID().slice(0, 8);
  const assinaturas = [];
  const ids = {};

  const pedir = (rota, token = adminToken) => supertest(app)
    .get(`/api/v1/diag${rota}`)
    .set('Authorization', `Bearer ${token}`);

  /** Semeia direto no banco: aqui o assunto é a LEITURA, não o caminho de escrita. */
  async function semear(nome, { stackBruta = RASTRO, release = RELEASE } = {}) {
    const assinatura = `TypeError | ${nome} | ${MARCA}`;
    assinaturas.push(assinatura);
    const { rows } = await db.query(
      `INSERT INTO defeitos
         (assinatura, mensagem, estado, origem, release, pagina, ocorrencias,
          stack_bruta, primeira_release, ultima_release)
       VALUES ($1, $2, 'aberto', 'nao-tratado', $3, $4, 3, $5, $3, $3)
       RETURNING id`,
      [assinatura, `mensagem de ${nome}`, release, `p-${MARCA}`, stackBruta]
    );
    ids[nome] = rows[0].id;
    return rows[0].id;
  }

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    comum = await createUser(db, { username: `pl_usr_${randomUUID().slice(0, 6)}` });
    admin = await createAdminUser(db, { username: `pl_adm_${randomUUID().slice(0, 6)}` });
    comumToken = await loginUser(app, comum.username, comum.password);
    adminToken = await loginUser(app, admin.username, admin.password);

    await semear('resolvivel');
    await semear('outra-build', { release: OUTRA_RELEASE });
    await semear('sem-pilha', { stackBruta: null });
  });

  after(async () => {
    await db.query('DELETE FROM defeitos WHERE assinatura = ANY($1::text[])', [assinaturas]);
    await teardownTestEnv(db);
    fs.rmSync(MAPAS_DIR, { recursive: true, force: true });
  });

  // ───────────────────────────────── os gates ─────────────────────────────────

  it('anônimo leva 401 e usuário comum leva 403, nas DUAS rotas', async () => {
    for (const rota of [`/defeitos/${ids.resolvivel}`, `/defeitos/${ids.resolvivel}/pilha`]) {
      await supertest(app).get(`/api/v1/diag${rota}`).expect(401);
      await pedir(rota, comumToken).expect(403);
    }
  });

  // ────────────────────────── UM defeito, pelo id ──────────────────────────

  it('devolve o MESMO item que a listagem, pelo mesmo mapeador', async () => {
    // É a propriedade que faz um agente poder comparar as duas respostas para se orientar: um
    // campo que só um dos dois preenchesse apareceria como ausente numa tela e com valor na
    // outra, o que se lê como dado faltando no banco.
    const lista = await pedir(`/defeitos?pagina=p-${MARCA}&desde=1d`).expect(200);
    const daLista = lista.body.data.itens.find((i) => i.id === ids.resolvivel);
    assert.ok(daLista, 'a listagem precisa trazer o defeito semeado, senão a comparação é vazia');

    const { body } = await pedir(`/defeitos/${ids.resolvivel}`).expect(200);
    assert.deepEqual(body.data, daLista);
    assert.equal(body.data.stackBruta, RASTRO);
    assert.equal(body.data.primeiraRelease, RELEASE);
    assert.equal(body.data.ocorrencias, 3);
  });

  it('id inexistente é 404, e id malformado é 422 na BORDA', async () => {
    // 404 e não lista vazia: a pergunta é "me dê ESTE defeito", e um 200 com corpo vazio diria
    // que ele existe e não tem conteúdo. E o 422 do id malformado é a razão do `guid()` no Joi:
    // sem ele, o texto que não é UUID levanta `22P02` no driver e chega como um erro sem
    // relação aparente com o argumento.
    const ausente = await pedir(`/defeitos/${randomUUID()}`).expect(404);
    assert.match(JSON.stringify(ausente.body), /poda por idade/);
    await pedir('/defeitos/nao-e-uuid').expect(422);
    await pedir(`/defeitos/${randomUUID()}/pilha`).expect(404);
    await pedir('/defeitos/nao-e-uuid/pilha').expect(422);
  });

  // ───────────────────────────── a pilha, resolvida ─────────────────────────────

  it('desminifica contra a build que declara a release do PRIMEIRO avistamento', async () => {
    const { body } = await pedir(`/defeitos/${ids.resolvivel}/pilha`).expect(200);
    const r = body.data;

    assert.equal(r.disponivel, true);
    assert.equal(r.release, RELEASE);
    assert.equal(r.quadros.length, 4);

    // A mensagem do topo não é quadro nenhum, e sobrevive crua.
    assert.equal(r.quadros[0].original, 'TypeError: x is not a function');
    assert.equal(r.quadros[0].motivo, 'sem-quadro');

    // A COLUNA SAI 0-BASED, como o `--json` do comando: o rastro diz 31 (1-based) e o mapa
    // responde 6. Um erro de um aqui devolveria o segmento vizinho, com OUTRO nome de função,
    // sem levantar nada.
    assert.equal(r.quadros[1].fonte, 'frontend/src/js/beta.js');
    assert.equal(r.quadros[1].linha, 10);
    assert.equal(r.quadros[1].coluna, 6);
    assert.equal(r.quadros[1].nome, 'parar');

    assert.equal(r.quadros[2].fonte, 'frontend/src/js/alfa.js');
    assert.equal(r.quadros[2].linha, 5);
    assert.equal(r.quadros[3].motivo, 'sem-mapa');

    // Nenhum caminho do host atravessa: `quadroPublico` é allowlist, e a entrada desta rota
    // (`stack_bruta`) veio da única rota anônima do servidor.
    assert.equal(JSON.stringify(r).includes(MAPAS_DIR.replace(/\\/g, '\\\\')), false);
  });

  it('RECUSA a build que não é a que produziu a pilha, e o motivo NOMEIA a release', async () => {
    // A peça central, e não o caso de erro: contra outra build a resolução não falha, devolve
    // funções e linhas plausíveis e ERRADAS, que custa mais que pilha nenhuma. E é 200, não
    // erro: a rota respondeu, o que não deu foi a resolução.
    const { body } = await pedir(`/defeitos/${ids['outra-build']}/pilha`).expect(200);
    assert.equal(body.data.disponivel, false);
    assert.equal(body.data.motivo, 'release-nao-encontrada');
    assert.equal(body.data.release, OUTRA_RELEASE);
    assert.equal('quadros' in body.data, false);
    // As builds que existem no disco do host NÃO viajam: o comando as lista porque lá existe um
    // caminho digitado que pode estar errado; aqui não existe, e enumerá-las seria topologia.
    assert.equal(JSON.stringify(body.data).includes(RELEASE), false);
  });

  it('defeito sem pilha crua responde 200 dizendo POR QUE, e não 404 nem 500', async () => {
    const { body } = await pedir(`/defeitos/${ids['sem-pilha']}/pilha`).expect(200);
    assert.equal(body.data.disponivel, false);
    assert.equal(body.data.motivo, 'sem-pilha-bruta');
    assert.match(body.data.explicacao, /PRIMEIRO avistamento/);
  });
});
