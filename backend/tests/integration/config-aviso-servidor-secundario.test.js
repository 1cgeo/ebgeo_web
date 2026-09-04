// Path: tests/integration/config-aviso-servidor-secundario.test.js
//
// O AVISO DE SERVIDOR SECUNDÁRIO NO PAYLOAD DE GET /api/config.
//
// A instância do 1º CGEO (Porto Alegre) é o servidor SECUNDÁRIO do EBGeo; o recomendado é
// `ebgeo.dsg.eb.mil.br`, no 7º CTA em Brasília. O cliente abre, a cada carga, uma tela com a
// recomendação e dois botões, e ele decide isso por `app.avisoServidorSecundario === true`.
//
// NO `main` A CHAVE MORA NO config.js VERSIONADO DO CLIENTE. Neste ramo, `frontend/src/js/
// config.js` é só o FORMATO e não tem fallback estático, então quem hidrata a chave é este
// endpoint, e é por isso que ela é fato de implantação (env) e não padrão de UI
// (`config.static.js`).
//
// O PADRÃO NASCE DESLIGADO desde 2026-09-04 (decisão do chefe, que inverte a da véspera), e o
// bloco do OVERRIDE deste arquivo deixou de ser um detalhe para virar o caminho principal: é
// pelo `PUT /config/admin` da aba Sistema que o aviso é LIGADO, sem reiniciar o processo, e é
// esta a propriedade de que o painel depende. Ela se mede aqui, e não na tela, porque o que
// o painel usa é a fusão mais a invalidação do memo.
//
// O QUE ESTE ARQUIVO ALCANÇA, E O QUE NÃO. Ele mede o payload: as duas chaves existem, têm o
// tipo que o cliente lê, sobrevivem à memoização e cedem ao override do administrador. Ele NÃO
// consegue variar o AMBIENTE, porque `src/config.js` lê `process.env` no corpo do módulo e
// congela o resultado, e o app aqui já bootou. Essa metade é
// `tests/unit/aviso-servidor-secundario.test.js`, que reimporta `config.js` com o ambiente
// trocado, e é lá que moram os casos que discriminam (`'false'` e `'sim'` valem false). O
// último caso deste arquivo pina justamente a fronteira entre as duas: mexer no env com o
// processo de pé NÃO muda o payload.

import { describe, it, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import config from '../../src/config.js';
import { clearConfigOverrides, updateConfigOverrides } from '../../src/modules/config/config.service.js';
import { invalidateAppConfigCache } from '../../src/modules/config/config.cache.js';

const URL_PADRAO = 'https://ebgeo.dsg.eb.mil.br';

describe('GET /api/config, o aviso de servidor secundário', () => {
  let app, db;

  const pegarConfig = async () => (await supertest(app).get('/api/config').expect(200)).body.data;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
  });

  afterEach(async () => {
    await clearConfigOverrides();
    invalidateAppConfigCache();
  });

  after(async () => {
    delete process.env.CONFIG_CACHE_FORCE;
    invalidateAppConfigCache();
    await teardownTestEnv(db);
  });

  it('o bloco `app` traz as duas chaves, com o padrão do checkout', async () => {
    const cfg = await pegarConfig();
    assert.ok(cfg.app, 'o bloco app é de primeiro nível e continua existindo');
    assert.equal(cfg.app.avisoServidorSecundario, false, 'o checkout nasce calado');
    // A URL vem mesmo com o aviso apagado: ela é o destino que o administrador encontra já
    // preenchido quando for ligar a tela pelo painel.
    assert.equal(cfg.app.urlServidorPrincipal, URL_PADRAO);
  });

  it('os tipos são os que o cliente lê: booleano e string', async () => {
    // O cliente decide a tela por `=== true`. Uma string 'true' aqui deixaria o aviso
    // desligado no servidor secundário, sem erro em lugar nenhum, que é o pior desfecho.
    const cfg = await pegarConfig();
    assert.equal(typeof cfg.app.avisoServidorSecundario, 'boolean');
    assert.equal(typeof cfg.app.urlServidorPrincipal, 'string');
    assert.ok(cfg.app.urlServidorPrincipal.startsWith('https://'), 'o botão sai desta origem');
  });

  it('o payload publica o que o AMBIENTE resolveu, e não uma constante do serviço', async () => {
    const cfg = await pegarConfig();
    assert.equal(cfg.app.avisoServidorSecundario, config.appConfig.avisoServidorSecundario);
    assert.equal(cfg.app.urlServidorPrincipal, config.appConfig.urlServidorPrincipal);
  });

  it('as chaves antigas de `app` continuam lá (o bloco foi estendido, não substituído)', async () => {
    // `S.APP` (config.static.js) é espalhado dentro do bloco novo. Sem esta asserção, trocar
    // o objeto inteiro por um literal com as duas chaves passaria verde e derrubaria o título
    // e a URL do tutorial, que a barra superior lê.
    const cfg = await pegarConfig();
    assert.equal(cfg.app.title, 'EBGeo');
    assert.ok('tutorialUrl' in cfg.app, 'tutorialUrl continua no bloco app');
  });

  describe('a memoização', () => {
    // O memo é DESLIGADO sob NODE_ENV=test, salvo CONFIG_CACHE_FORCE=1. Sem a bandeira este
    // bloco mediria o caminho de reconstrução duas vezes e chamaria isso de "sobreviveu ao
    // cache", que é um verde sobre nada.
    before(() => { process.env.CONFIG_CACHE_FORCE = '1'; invalidateAppConfigCache(); });
    after(() => { delete process.env.CONFIG_CACHE_FORCE; invalidateAppConfigCache(); });

    it('a resposta QUENTE carrega as duas chaves, não só a fria', async () => {
      const fria = await pegarConfig();
      const quente = await pegarConfig();
      // A chave é `false` no padrão, então PRESENÇA e valor se afirmam separados: um bloco
      // `app` sem a chave nenhuma leria `undefined`, que não é `false`, e a asserção de valor
      // sozinha não distinguiria "servida desligada" de "não servida".
      assert.ok('avisoServidorSecundario' in fria.app, 'piso: a fria tem a chave');
      assert.equal(fria.app.avisoServidorSecundario, false);
      assert.deepEqual(quente.app, fria.app, 'o bloco app servido do memo é o mesmo documento');
      assert.ok('avisoServidorSecundario' in quente.app, 'e a quente também a tem');
      assert.equal(quente.app.avisoServidorSecundario, false);
      assert.equal(quente.app.urlServidorPrincipal, URL_PADRAO);
    });

    it('o override LIGADO sobrevive ao memo: a segunda resposta não volta ao padrão', async () => {
      // O caminho que o painel usa, medido com a memoização LIGADA, que é como o servidor
      // roda de verdade. A invalidação na escrita é o que faz a primeira leitura seguinte
      // reconstruir; sem ela o administrador ligaria a tela e o mapa continuaria calado até
      // o TTL vencer, sem erro em lugar nenhum.
      await pegarConfig(); // esquenta o memo com o padrão DESLIGADO
      await updateConfigOverrides({ app: { avisoServidorSecundario: true } }, null);
      const primeira = await pegarConfig();
      const segunda = await pegarConfig();
      assert.equal(primeira.app.avisoServidorSecundario, true, 'a escrita derrubou o memo');
      assert.equal(segunda.app.avisoServidorSecundario, true, 'e a quente seguinte não regrediu');
    });
  });

  describe('o override do administrador', () => {
    // ESTE BLOCO É O CAMINHO PRINCIPAL desde 2026-09-04. Com o padrão desligado, quem acende a
    // tela é a aba Sistema do painel, e a única coisa que separa o clique do administrador da
    // tela do usuário é a fusão que se mede aqui.

    it('LIGA o aviso em runtime, sem reiniciar o processo', async () => {
      await updateConfigOverrides({ app: { avisoServidorSecundario: true } }, null);
      const cfg = await pegarConfig();
      assert.equal(cfg.app.avisoServidorSecundario, true);
      assert.equal(cfg.app.urlServidorPrincipal, URL_PADRAO, 'a chave irmã não é derrubada pela fusão');
      assert.equal(cfg.app.title, 'EBGeo', 'nem o resto do bloco');
    });

    it('e desliga de volta, que é como o painel desfaz o que ligou', async () => {
      // Sem este caso, o override provaria só que uma escrita ACENDE. O painel também apaga, e
      // apagar é o gesto de que todo spec de navegador depende: um `true` esquecido no
      // documento de override põe a sobreposição em cima do primeiro clique de quem vier
      // depois.
      await updateConfigOverrides({ app: { avisoServidorSecundario: true } }, null);
      assert.equal((await pegarConfig()).app.avisoServidorSecundario, true, 'piso: acendeu');
      await updateConfigOverrides({ app: { avisoServidorSecundario: false } }, null);
      const cfg = await pegarConfig();
      assert.equal(cfg.app.avisoServidorSecundario, false);
      assert.equal(cfg.app.urlServidorPrincipal, URL_PADRAO, 'e a irmã continua de pé');
    });

    it('troca o destino do botão', async () => {
      await updateConfigOverrides({ app: { urlServidorPrincipal: 'https://outro.exemplo.mil.br' } }, null);
      const cfg = await pegarConfig();
      assert.equal(cfg.app.urlServidorPrincipal, 'https://outro.exemplo.mil.br');
      assert.equal(cfg.app.avisoServidorSecundario, false, 'a chave irmã segue no padrão');
    });

    it('as duas chaves de uma vez, que é o que a aba Sistema envia num salvamento', async () => {
      // O painel manda o DIFF, e quando alguém acende a tela e digita o endereço na mesma
      // visita as duas viajam juntas. Um `deepMerge` que perdesse uma delas passaria nos dois
      // casos acima, porque lá cada uma viaja sozinha.
      await updateConfigOverrides({
        app: { avisoServidorSecundario: true, urlServidorPrincipal: 'https://principal.exemplo.mil.br' },
      }, null);
      const cfg = await pegarConfig();
      assert.equal(cfg.app.avisoServidorSecundario, true);
      assert.equal(cfg.app.urlServidorPrincipal, 'https://principal.exemplo.mil.br');
      assert.equal(cfg.app.title, 'EBGeo', 'e o resto do bloco `app` continua inteiro');
    });
  });

  it('ARMADILHA PINADA: mexer no env com o processo de pé NÃO muda o payload', async () => {
    // `src/config.js` lê `process.env` na avaliação do módulo e congela. Trocar a variável e
    // até derrubar o memo não alcança o valor: o que alcança é REINICIAR o processo. Isso está
    // pinado aqui, e não só escrito em `docs/wiki/deploy-backend.md`, porque é o passo de
    // implantação que falha calado: o operador põe 'true', recarrega a página, não vê tela
    // nenhuma e conclui que a chave não funciona. A saída sem reinício existe e é outra, a aba
    // Sistema do painel, que escreve no documento de override e derruba o memo.
    const salvo = process.env.AVISO_SERVIDOR_SECUNDARIO;
    try {
      // O SENTIDO DO CASO INVERTEU COM O PADRÃO, e é isso que o mantém sendo um teste. Com o
      // padrão ligado, provar a armadilha exigia escrever 'false' e ver o `true` sobreviver;
      // com o padrão desligado, escrever 'false' não afirmaria nada (é o mesmo valor dos dois
      // lados). O valor que discrimina agora é 'true'.
      process.env.AVISO_SERVIDOR_SECUNDARIO = 'true';
      invalidateAppConfigCache();
      const cfg = await pegarConfig();
      assert.equal(
        cfg.app.avisoServidorSecundario, false,
        'a env é lida no boot: sem reiniciar, o payload continua com o valor de quando o processo subiu',
      );
    } finally {
      if (salvo === undefined) delete process.env.AVISO_SERVIDOR_SECUNDARIO;
      else process.env.AVISO_SERVIDOR_SECUNDARIO = salvo;
      invalidateAppConfigCache();
    }
  });
});
