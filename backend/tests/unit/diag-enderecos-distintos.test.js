// Path: tests/unit/diag-enderecos-distintos.test.js
//
// OS ENDEREÇOS DISTINTOS, na parte PURA (`src/utils/diag-enderecos.js`), na metade de NOMES
// (`src/modules/diag/enderecos.service.js`, com leitor injetado) e no COMANDO dirigido por
// `spawnSync` com o banco fora do ar. O espelho com a rota e a leitura real de nomes estão em
// `tests/integration/diag-enderecos.test.js`, que precisa do Postgres.
//
// O QUE ESTE ARQUIVO PRENDE, e por que cada item existe:
//   (1) só a linha do `request-logger` conta, reconhecida pela ESTRUTURA: a recusa do limitador e
//       o acesso ao gazetteer também escrevem `ip`, e contá-los inflaria quem os dispara;
//   (2) o denominador é o do PULSO: somando as requisições por endereço e as sem endereço, sai o
//       `total` de `criarResumoDeStatus` sobre as mesmas linhas;
//   (3) o visitante de LINK PÚBLICO é anônimo, nunca conta, e forma desconhecida também;
//   (4) o "agora" é `<=` na borda, e endereço sem instante nunca é "agora";
//   (5) a ordem é a do mais recente, e o corte guarda o topo e CONTA o que cortou;
//   (6) o banco fora não leva a lista junto: o bloco `contas` se declara cego, sem contagem.
//
// CONTROLE NEGATIVO (o que fica vermelho ao voltar cada peça ao óbvio):
//   - contar toda linha com `ip` (tirar `ehLinhaDeRequisicao`): os casos (1) e (2) reprovam;
//   - tratar `public-<uuid>` como conta: o caso (3) reprova com uma conta onde há zero;
//   - trocar `<=` por `<` no `recente`: o caso da borda reprova;
//   - cortar antes de contar (`distintos` depois do `slice`): o caso do corte reprova;
//   - devolver `pedidas`/`achadas` no bloco cego: o caso (6) reprova.

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import {
  criarRelatorioDeEnderecos, relatorioDeEnderecos, idsDeContas, principalDaLinha,
  PrincipalDaLinha, ENDERECO_INDETERMINADO, JANELA_DE_AGORA_MS, MAX_CONTAS_POR_ENDERECO,
  LIMITE_PADRAO_DE_ENDERECOS,
} from '../../src/utils/diag-enderecos.js';
import { criarResumoDeStatus } from '../../src/utils/diag-consulta.js';
import { UNKNOWN_ADDRESS } from '../../src/middleware/request-logger.js';
import { nomearContas, contasCegas } from '../../src/modules/diag/enderecos.service.js';
import { enderecos as enderecosDoServico } from '../../src/modules/diag/diag.service.js';
import { enderecosQuerySchema, erroDeClienteSchema } from '../../src/modules/diag/diag.schemas.js';
import { eventosDeUsoSchema } from '../../src/modules/uso/uso.schemas.js';

const COMANDO = fileURLToPath(new URL('../../scripts/diag.js', import.meta.url));
const MIN = 60_000;
const AGORA = Date.UTC(2026, 8, 22, 15, 0, 0);
const temporarios = [];

after(() => {
  for (const dir of temporarios) fs.rmSync(dir, { recursive: true, force: true });
});

const CONTA_A = '11111111-1111-4111-8111-111111111111';
const CONTA_B = '22222222-2222-4222-8222-222222222222';
const ABA_1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ABA_2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

/** Uma linha do `request-logger`, no shape PLANO que `requestLogPayload` escreve. */
const req = (time, ip, extra = {}) => ({
  level: 30, time, reqId: randomUUID(), ip, method: 'GET', url: '/api/v1/config',
  statusCode: 200, duration: 4, msg: 'request', ...extra,
});

describe('diag-enderecos — o que conta como requisição', () => {
  it('conta SÓ a linha do request-logger: limitador, gazetteer e errorHandler ficam de fora', () => {
    const r = relatorioDeEnderecos([
      req(AGORA - 3 * MIN, '10.0.0.1'),
      // A recusa do limitador: tem `ip`, não tem `statusCode`.
      { level: 40, time: AGORA - 3 * MIN, reqId: 'x', limiter: 'auth', ip: '10.0.0.1', method: 'POST', url: '/api/v1/auth/login' },
      // O acesso ao gazetteer: tem `ip`, não tem `statusCode`, e REPETE a requisição.
      { level: 30, time: AGORA - 3 * MIN, category: 'nomes_access', ip: '10.0.0.1', path: '/busca', queryKeys: [] },
      // A linha do errorHandler: sem `ip` e sem `statusCode` no topo.
      { level: 50, time: AGORA - 3 * MIN, reqId: 'y', err: { type: 'Error', message: 'x' }, msg: 'request error' },
      // A amostra de saúde: nada de requisição.
      { level: 30, time: AGORA - 3 * MIN, amostra: 'saude', msg: 'amostra' },
    ], { agora: AGORA });

    assert.equal(r.distintos, 1);
    assert.equal(r.requisicoes, 1);
    assert.equal(r.enderecos[0].requisicoes, 1);
    assert.equal(r.semEndereco, 0);
  });

  it('o denominador é o do PULSO: por endereço + sem endereço = total do status', () => {
    const linhas = [
      req(AGORA - 10 * MIN, '10.0.0.1'),
      req(AGORA - 9 * MIN, '10.0.0.1', { statusCode: 401 }),
      req(AGORA - 8 * MIN, '10.0.0.2', { statusCode: 500 }),
      // Linha de requisição anterior ao campo `ip`: conta no pulso, e aqui vai para semEndereco.
      { level: 30, time: AGORA - 7 * MIN, method: 'GET', url: '/x', statusCode: 200, duration: 1 },
      { level: 30, time: AGORA - 6 * MIN, limiter: 'auth', ip: '10.0.0.9' },
    ];
    const r = relatorioDeEnderecos(linhas, { agora: AGORA });
    const status = criarResumoDeStatus();
    for (const l of linhas) status.ver(l);

    const somaPorEndereco = r.enderecos.reduce((s, e) => s + e.requisicoes, 0);
    assert.equal(somaPorEndereco, r.requisicoes);
    assert.equal(r.requisicoes + r.semEndereco, status.resultado().total);
    assert.equal(r.semEndereco, 1);
    // `comErro` é status >= 400, a mesma régua do pulso.
    const um = r.enderecos.find((e) => e.ip === '10.0.0.1');
    assert.equal(um.comErro, 1);
    assert.equal(r.enderecos.find((e) => e.ip === '10.0.0.2').comErro, 1);
  });
});

describe('diag-enderecos — por endereço', () => {
  it('primeira, última, abas distintas e contas com contagem', () => {
    const r = relatorioDeEnderecos([
      req(AGORA - 50 * MIN, '10.0.0.1', { userId: CONTA_A, sessaoId: ABA_1 }),
      req(AGORA - 40 * MIN, '10.0.0.1', { userId: CONTA_A, sessaoId: ABA_1 }),
      req(AGORA - 30 * MIN, '10.0.0.1', { userId: CONTA_B, sessaoId: ABA_2 }),
      // Aba com forma inválida NÃO entra (o produtor só grava UUID; esta linha foi forjada).
      req(AGORA - 20 * MIN, '10.0.0.1', { sessaoId: 'lixo' }),
    ], { agora: AGORA });

    const e = r.enderecos[0];
    assert.equal(e.ip, '10.0.0.1');
    assert.equal(e.primeira, AGORA - 50 * MIN);
    assert.equal(e.ultima, AGORA - 20 * MIN);
    assert.equal(e.requisicoes, 4);
    assert.equal(e.sessoes, 2);
    assert.equal(e.contasDistintas, 2);
    assert.deepEqual(e.contas, [
      { userId: CONTA_A, requisicoes: 2, ultima: AGORA - 40 * MIN },
      { userId: CONTA_B, requisicoes: 1, ultima: AGORA - 30 * MIN },
    ]);
    assert.equal(e.anonimas, 1);
    assert.equal(e.deLinkPublico, 0);
  });

  it('o visitante de LINK PÚBLICO é anônimo, e forma desconhecida também', () => {
    assert.equal(principalDaLinha(CONTA_A), PrincipalDaLinha.CONTA);
    assert.equal(principalDaLinha(`public-${CONTA_A}`), PrincipalDaLinha.LINK_PUBLICO);
    assert.equal(principalDaLinha(undefined), PrincipalDaLinha.ANONIMO);
    assert.equal(principalDaLinha(''), PrincipalDaLinha.ANONIMO);
    assert.equal(principalDaLinha('admin'), PrincipalDaLinha.ANONIMO);
    assert.equal(principalDaLinha(42), PrincipalDaLinha.ANONIMO);

    const r = relatorioDeEnderecos([
      req(AGORA - MIN, '10.0.0.5', { userId: `public-${CONTA_A}` }),
      req(AGORA - MIN, '10.0.0.5', { userId: 'nao-e-uuid' }),
      req(AGORA - MIN, '10.0.0.5'),
    ], { agora: AGORA });
    const e = r.enderecos[0];
    assert.equal(e.contasDistintas, 0);
    assert.deepEqual(e.contas, []);
    assert.equal(e.anonimas, 3);
    assert.equal(e.deLinkPublico, 1);
  });

  it('o sentinela do produtor vira `indeterminado`, e é a MESMA string do request-logger', () => {
    assert.equal(ENDERECO_INDETERMINADO, UNKNOWN_ADDRESS);
    const r = relatorioDeEnderecos([req(AGORA - MIN, UNKNOWN_ADDRESS), req(AGORA - MIN, '10.0.0.1')], { agora: AGORA });
    assert.equal(r.enderecos.find((e) => e.ip === UNKNOWN_ADDRESS).indeterminado, true);
    assert.equal(r.enderecos.find((e) => e.ip === '10.0.0.1').indeterminado, false);
  });

  it('o teto de contas por endereço CORTA e CONTA, e a ordem é por volume', () => {
    const linhas = [];
    for (let i = 0; i < MAX_CONTAS_POR_ENDERECO + 5; i += 1) {
      const id = `${String(i).padStart(8, '0')}-0000-4000-8000-000000000000`;
      // A conta i faz i+1 requisições: a de maior índice é a mais ativa.
      for (let k = 0; k <= i; k += 1) linhas.push(req(AGORA - (k + 1) * MIN, '10.9.9.9', { userId: id }));
    }
    const e = relatorioDeEnderecos(linhas, { agora: AGORA }).enderecos[0];
    assert.equal(e.contasDistintas, MAX_CONTAS_POR_ENDERECO + 5);
    assert.equal(e.contas.length, MAX_CONTAS_POR_ENDERECO);
    assert.equal(e.contas[0].requisicoes, MAX_CONTAS_POR_ENDERECO + 5);
    for (let i = 1; i < e.contas.length; i += 1) {
      assert.ok(e.contas[i - 1].requisicoes >= e.contas[i].requisicoes);
    }
  });
});

describe('diag-enderecos — "agora", ordem e corte', () => {
  it('o "agora" é `<=` na borda, e sem instante nunca é agora', () => {
    const r = relatorioDeEnderecos([
      req(AGORA - JANELA_DE_AGORA_MS, '10.0.0.1'),
      req(AGORA - JANELA_DE_AGORA_MS - 1, '10.0.0.2'),
      req(AGORA + 3000, '10.0.0.3'),
      { level: 30, ip: '10.0.0.4', method: 'GET', url: '/x', statusCode: 200, duration: 1 },
    ], { agora: AGORA });
    const por = Object.fromEntries(r.enderecos.map((e) => [e.ip, e]));
    assert.equal(por['10.0.0.1'].recente, true);
    assert.equal(por['10.0.0.2'].recente, false);
    // Relógio do escritor alguns segundos à frente do leitor: continua "agora".
    assert.equal(por['10.0.0.3'].recente, true);
    assert.equal(por['10.0.0.4'].recente, false);
    assert.equal(por['10.0.0.4'].ultima, null);
    assert.equal(r.recentes, 2);
    assert.equal(r.recenteMs, JANELA_DE_AGORA_MS);
  });

  it('a ordem é a do mais recente, sem instante no fim, desempate por volume e endereço', () => {
    const r = relatorioDeEnderecos([
      { level: 30, ip: '10.0.0.9', method: 'GET', url: '/x', statusCode: 200, duration: 1 },
      req(AGORA - 30 * MIN, '10.0.0.3'),
      req(AGORA - 10 * MIN, '10.0.0.2'),
      req(AGORA - 10 * MIN, '10.0.0.1'),
      req(AGORA - 20 * MIN, '10.0.0.1'),
      req(AGORA - 10 * MIN, '10.0.0.4'),
    ], { agora: AGORA });
    assert.deepEqual(r.enderecos.map((e) => e.ip), ['10.0.0.1', '10.0.0.2', '10.0.0.4', '10.0.0.3', '10.0.0.9']);
  });

  it('o resultado não depende da ordem das linhas', () => {
    const linhas = [
      req(AGORA - 40 * MIN, '10.0.0.1', { userId: CONTA_A, sessaoId: ABA_1 }),
      req(AGORA - 30 * MIN, '10.0.0.2', { userId: CONTA_B }),
      req(AGORA - 20 * MIN, '10.0.0.1', { userId: CONTA_B, sessaoId: ABA_2 }),
      req(AGORA - 2 * MIN, '10.0.0.3'),
    ];
    assert.deepEqual(
      relatorioDeEnderecos([...linhas].reverse(), { agora: AGORA }),
      relatorioDeEnderecos(linhas, { agora: AGORA }),
    );
  });

  it('o corte guarda os MAIS RECENTES e as contagens são de antes dele', () => {
    const linhas = [];
    for (let i = 0; i < 10; i += 1) linhas.push(req(AGORA - (i + 1) * MIN, `10.0.1.${i}`));
    const r = relatorioDeEnderecos(linhas, { agora: AGORA, limite: 3 });
    assert.equal(r.distintos, 10);
    assert.equal(r.recentes, 5);
    assert.equal(r.limite, 3);
    assert.deepEqual(r.enderecos.map((e) => e.ip), ['10.0.1.0', '10.0.1.1', '10.0.1.2']);
    // Sem limite válido, publica todos e diz que não cortou.
    const todos = relatorioDeEnderecos(linhas, { agora: AGORA, limite: 0 });
    assert.equal(todos.limite, null);
    assert.equal(todos.enderecos.length, 10);
  });

  it('janela vazia é zero de tudo, e lista vazia', () => {
    const r = criarRelatorioDeEnderecos({ agora: AGORA }).resultado({ limite: 5 });
    assert.deepEqual(
      { distintos: r.distintos, recentes: r.recentes, requisicoes: r.requisicoes, semEndereco: r.semEndereco, enderecos: r.enderecos },
      { distintos: 0, recentes: 0, requisicoes: 0, semEndereco: 0, enderecos: [] },
    );
  });

  it('`idsDeContas` só cita as contas dos endereços PUBLICADOS, sem repetição', () => {
    const r = relatorioDeEnderecos([
      req(AGORA - MIN, '10.0.0.1', { userId: CONTA_A }),
      req(AGORA - 2 * MIN, '10.0.0.2', { userId: CONTA_A }),
      req(AGORA - 60 * MIN, '10.0.0.3', { userId: CONTA_B }),
    ], { agora: AGORA, limite: 2 });
    assert.deepEqual(idsDeContas(r), [CONTA_A]);
    assert.deepEqual(idsDeContas({ enderecos: [{ contas: [{ userId: 'nao-uuid' }] }] }), []);
    assert.deepEqual(idsDeContas(null), []);
  });

  it('as duas portas cortam no MESMO padrão: o Joi da rota lê a constante', () => {
    const { value } = enderecosQuerySchema.validate({});
    assert.equal(value.limite, LIMITE_PADRAO_DE_ENDERECOS);
    assert.equal(value.desde, '24h');
    assert.ok(enderecosQuerySchema.validate({ desde: '8d' }).error, 'o teto de 7 dias vale aqui também');
    assert.ok(enderecosQuerySchema.validate({ limite: 501 }).error);
  });
});

describe('enderecos.service — os nomes das contas', () => {
  it('sem conta nenhuma, NÃO vai ao banco, e diz que não havia o que nomear', async () => {
    let chamadas = 0;
    const r = await nomearContas([], { lerContas: async () => { chamadas += 1; return []; } });
    assert.equal(chamadas, 0);
    assert.deepEqual(r, { disponivel: true, pedidas: 0, achadas: 0, naoEncontradas: 0, porId: {} });
  });

  it('pede cada id UMA vez, só UUID, e conta a conta que não voltou', async () => {
    let pedidos = null;
    const r = await nomearContas([CONTA_A, CONTA_A, 'lixo', CONTA_B], {
      lerContas: async (ids) => {
        pedidos = ids;
        return [{ id: CONTA_A, username: 'fulano', nome: '  ', is_active: false }];
      },
    });
    assert.deepEqual(pedidos, [CONTA_A, CONTA_B]);
    assert.equal(r.disponivel, true);
    assert.equal(r.pedidas, 2);
    assert.equal(r.achadas, 1);
    assert.equal(r.naoEncontradas, 1);
    assert.deepEqual(r.porId, { [CONTA_A]: { username: 'fulano', nome: null, ativo: false } });
  });

  it('o banco fora vira bloco CEGO com o motivo, e NENHUMA contagem ao lado', async () => {
    const r = await nomearContas([CONTA_A], {
      lerContas: async () => { throw new Error('connect ECONNREFUSED 127.0.0.1:5432'); },
    });
    assert.deepEqual(Object.keys(r).sort(), ['disponivel', 'motivo']);
    assert.equal(r.disponivel, false);
    assert.match(r.motivo, /ECONNREFUSED/);
  });

  it('rejeição que não é Error ainda produz motivo legível, com teto', () => {
    assert.match(contasCegas('texto solto').motivo, /texto solto/);
    assert.doesNotMatch(contasCegas(undefined).motivo, /^$/);
    assert.ok(contasCegas(new Error('x'.repeat(5000))).motivo.length < 400);
  });
});

describe('diag.service — `enderecos` sobre o disco', () => {
  it('diretório ausente é resposta bem-formada e CEGA, não erro', async () => {
    const r = await enderecosDoServico({
      diretorio: path.join(os.tmpdir(), `ebgeo-nao-existe-${randomUUID()}`), desde: '24h', limite: 10,
    });
    assert.equal(r.janela.diretorioAusente, true);
    assert.equal(r.janela.arquivos, 0);
    assert.equal(r.distintos, 0);
    assert.deepEqual(r.enderecos, []);
  });
});

describe('o endereço NÃO entra em relato de erro, migalha nem lote de uso', () => {
  // A DECISÃO DE 2026-09-22 DIZ QUE ELE FICA SÓ NO LOG, e isto é o que a prende: as duas portas
  // anônimas de relato e de uso não declaram campo de endereço (o `stripUnknown` da borda o
  // descartaria em silêncio, e o `unknown(false)` da migalha o recusa), e as tabelas que elas
  // alimentam não têm coluna para ele. Um campo `ip` acrescentado a qualquer uma reprova aqui. O
  // pulso de presença fica de fora deste caso: ele não é relato, migalha nem lote de uso.
  const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const CAMPO_DE_ENDERECO = /^(ip|ips|endereco|address|remoteAddress|xForwardedFor)$/i;

  /** Todas as chaves declaradas num schema Joi, em qualquer profundidade. */
  function chavesDe(descricao, saida = []) {
    for (const [nome, filho] of Object.entries(descricao?.keys ?? {})) {
      saida.push(nome);
      chavesDe(filho, saida);
    }
    for (const item of descricao?.items ?? []) chavesDe(item, saida);
    return saida;
  }

  it('os schemas das rotas anônimas de telemetria não declaram endereço', () => {
    for (const [nome, schema] of [
      ['erroDeClienteSchema', erroDeClienteSchema],
      ['eventosDeUsoSchema', eventosDeUsoSchema],
    ]) {
      const chaves = chavesDe(schema.describe());
      assert.ok(chaves.length > 3, `${nome}: a varredura não achou chaves, e passaria vazia`);
      assert.deepEqual(chaves.filter((c) => CAMPO_DE_ENDERECO.test(c)), [], `${nome} declara endereço`);
    }
    // E a migalha RECUSA a chave, em vez de descartá-la: é o `unknown(false)` do item.
    const { error } = erroDeClienteSchema.validate(
      { assinatura: 'x', mensagem: 'y', migalhas: [{ t: 1, tipo: 'rede', texto: 'z', ip: '10.0.0.1' }] },
      { stripUnknown: true },
    );
    assert.ok(error, 'um endereço dentro de uma migalha precisa ser recusado');
  });

  it('as tabelas de defeito e de uso não têm coluna de endereço', () => {
    for (const arquivo of ['010_observabilidade.sql', '011_uso_e_presenca.sql']) {
      const sql = fs.readFileSync(path.join(RAIZ, 'src/database/migrations', arquivo), 'utf8')
        .replace(/--[^\n]*/g, '');
      assert.ok(sql.includes('CREATE TABLE'), `${arquivo}: a leitura não achou tabela nenhuma`);
      assert.doesNotMatch(sql, /^\s*(ip|endereco|address)\s+\w+/im, `${arquivo} ganhou uma coluna de endereço`);
    }
  });
});

/** O nome de arquivo que `diasDaJanela` procura para um instante (dia LOCAL). */
function arquivoDoDia(t) {
  const d = new Date(t);
  return `ebgeo-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.jsonl`;
}

describe('npm run diag -- enderecos, com o BANCO FORA', () => {
  // O DATABASE_URL APONTA PARA UMA PORTA FECHADA: o `config.js` importa (a variável existe), o
  // pool nasce, e a primeira consulta é recusada. É o cenário que a regra do `resumo` descreve, e
  // o que se prova é que a lista de endereços sai inteira e o bloco de nomes se declara cego.
  function rodar(args) {
    const r = spawnSync(process.execPath, [COMANDO, ...args], {
      encoding: 'utf8',
      timeout: 60_000,
      killSignal: 'SIGKILL',
      env: { ...process.env, DATABASE_URL: 'postgresql://ninguem:nada@127.0.0.1:9/inexistente' },
    });
    assert.equal(r.signal, null, `o comando foi morto por ${r.signal} (pool pendurado?)`);
    return r;
  }

  function logComConta() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ebgeo-enderecos-'));
    temporarios.push(dir);
    const agora = Date.now();
    const linhas = [
      req(agora - 2 * MIN, '192.0.2.10', { userId: CONTA_A, sessaoId: ABA_1 }),
      req(agora - 90 * MIN, '192.0.2.20', { statusCode: 401 }),
    ];
    fs.writeFileSync(path.join(dir, arquivoDoDia(agora)), `${linhas.map((l) => JSON.stringify(l)).join('\n')}\n`);
    return dir;
  }

  it('--json: UM documento, a lista inteira, e `contas` cego com o motivo', () => {
    const dir = logComConta();
    const r = rodar(['enderecos', '--dir', dir, '--desde', '24h', '--json']);
    assert.equal(r.status, 0, r.stderr);
    const doc = JSON.parse(r.stdout);
    assert.equal(doc.comando, 'enderecos');
    assert.equal(doc.janela.dir, path.resolve(dir));
    assert.equal(doc.janela.arquivos, 1);
    assert.equal(doc.distintos, 2);
    assert.equal(doc.recentes, 1);
    assert.equal(doc.limite, LIMITE_PADRAO_DE_ENDERECOS);
    assert.deepEqual(doc.enderecos.map((e) => e.ip), ['192.0.2.10', '192.0.2.20']);
    assert.equal(doc.enderecos[0].contas[0].userId, CONTA_A);
    assert.equal(doc.contas.disponivel, false);
    assert.match(doc.contas.motivo, /banco não respondeu/);
    assert.equal('pedidas' in doc.contas, false);
  });

  it('modo humano: os endereços saem, e a cegueira dos nomes é dita', () => {
    const dir = logComConta();
    const r = rodar(['enderecos', '--dir', dir, '--desde', '24h']);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /192\.0\.2\.10/);
    assert.match(r.stdout, /\[agora\]/);
    assert.match(r.stdout, /NOMES DAS CONTAS INDISPONÍVEIS/);
    // Sem nome, a conta sai pelo id curto, e não some.
    assert.match(r.stdout, /11111111…/);
  });

  it('sem conta nenhuma na janela, nem tenta o banco: o bloco diz que não havia o que nomear', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ebgeo-enderecos-'));
    temporarios.push(dir);
    const agora = Date.now();
    fs.writeFileSync(path.join(dir, arquivoDoDia(agora)), `${JSON.stringify(req(agora - MIN, '192.0.2.30'))}\n`);
    const r = rodar(['enderecos', '--dir', dir, '--json']);
    assert.equal(r.status, 0, r.stderr);
    const doc = JSON.parse(r.stdout);
    assert.equal(doc.contas.disponivel, true);
    assert.equal(doc.contas.pedidas, 0);
    assert.equal(doc.enderecos[0].anonimas, 1);
  });
});
