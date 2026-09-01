// Path: tests/unit/diag-enderecos-agregados.test.js
//
// O campo `ip` existe em toda linha de requisição desde 2026-08-31 (`clientAddress`,
// `middleware/request-logger.js`) e não chegava a lugar nenhum que se lesse. A pergunta que
// ele responde, e que não tinha comando, é "este pico de 401 é UM endereço ou trezentos".
//
// A FORMA É AGREGADA, e o `exemplo` do grupo NÃO serve: ele é a ocorrência mais RECENTE, então
// publicar o endereço dele sobre um grupo de mil lê como "a origem" quando é só o último.
//
// AS TRÊS COISAS QUE ESTE ARQUIVO PRENDE, e a terceira é a que se perde numa reescrita:
//   (1) a contagem (`distintos`), o teto dos `principais` e a ordem determinística deles;
//   (2) que o endereço vem da OUTRA linha da requisição, porque a linha que a fusão mantém
//       (a do `errorHandler`) não carrega `ip` nenhum;
//   (3) que a ASSINATURA não mudou: pôr o endereço nela explodiria a cardinalidade e desfaria
//       o agrupamento, que é a decisão que `diag-consulta.js` inteiro existe para sustentar.
//
// CONTROLE NEGATIVO (conferido revertendo cada peça, com a mensagem observada):
//   - acrescentar o endereço a `assinaturaDeErro`: o caso "duas ocorrências do mesmo defeito de
//     endereços diferentes continuam UMA assinatura" reprova com 2 grupos onde há 1;
//   - trocar a ordem de `principais` por ordem de chegada: o caso do empate reprova, porque a
//     lista sai na ordem de leitura e o corte pelo teto passa a mudar QUEM aparece;
//   - tirar o `slice` do teto: o caso das oito origens reprova com 8 onde o teto é 5;
//   - ler só `reg.ip` do registro fundido, sem cair para a linha de requisição: o caso do par
//     comum reprova com `distintos: 0`, que é o estado em que o campo nasceria inútil;
//   - calar a nota das duas leituras: o caso do endereço único reprova, e com ela o produto
//     volta a não ter nada capaz de acusar `TRUST_PROXY_HOPS` errado.

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { agruparErros, assinaturaDeErro, MAX_ENDERECOS_PRINCIPAIS } from '../../src/utils/diag-consulta.js';

const COMANDO = fileURLToPath(new URL('../../scripts/diag.js', import.meta.url));
const temporarios = [];

after(() => {
  for (const dir of temporarios) fs.rmSync(dir, { recursive: true, force: true });
});

/** Uma linha do `request-logger`: é ela, e só ela, que carrega `ip`. */
const requisicao = (time, ip, extra = {}) => ({
  level: 40, time, reqId: `req-${time}`, ip, method: 'POST', url: '/api/v1/auth/login',
  statusCode: 401, duration: 3, msg: 'request', ...extra,
});

/** A linha do `errorHandler` para a mesma requisição: com `err`, e SEM `ip`. */
const doErrorHandler = (time, extra = {}) => ({
  level: 40, time, reqId: `req-${time}`, method: 'POST', url: '/api/v1/auth/login',
  err: { type: 'UnauthorizedError', message: 'Credenciais inválidas' }, msg: 'Request error', ...extra,
});

describe('diag — endereços agregados por grupo de erro', () => {
  it('conta os DISTINTOS e soma as ocorrências de cada um', () => {
    const grupos = agruparErros([
      requisicao(1, '203.0.113.7'),
      requisicao(2, '203.0.113.7'),
      requisicao(3, '198.51.100.4'),
    ]);
    assert.equal(grupos.length, 1);
    assert.equal(grupos[0].total, 3);
    assert.equal(grupos[0].enderecos.distintos, 2);
    assert.deepEqual(grupos[0].enderecos.principais, [
      { ip: '203.0.113.7', total: 2 },
      { ip: '198.51.100.4', total: 1 },
    ]);
  });

  it('o endereço vem da linha de REQUISIÇÃO, porque a linha rica que a fusão mantém não o tem', () => {
    // É o formato real de uma requisição falha: duas linhas, e só a segunda tem `ip`. A fusão
    // fica com a PRIMEIRA (a que tem tipo e pilha), então ler apenas `reg.ip` do registro
    // fundido devolveria zero endereço em todo grupo de erro de rota, que é a esmagadora
    // maioria deles.
    const par = { reqId: 'req-do-par' };
    const grupos = agruparErros([doErrorHandler(10, par), requisicao(11, '203.0.113.7', par)]);
    assert.equal(grupos.length, 1, 'as duas linhas são UMA ocorrência');
    assert.equal(grupos[0].total, 1);
    assert.equal(grupos[0].exemplo.ip, undefined, 'o exemplo continua sendo a linha rica, sem ip');
    assert.deepEqual(grupos[0].enderecos, { distintos: 1, principais: [{ ip: '203.0.113.7', total: 1 }] });
  });

  it('o teto corta os principais e a contagem de distintos continua INTEIRA', () => {
    // Oito origens, contagens decrescentes e distintas, para que o corte seja inequívoco.
    const registros = [];
    let t = 1;
    for (let i = 0; i < 8; i += 1) {
      for (let n = 0; n < 8 - i; n += 1) {
        registros.push(requisicao(t, `203.0.113.${i}`));
        t += 1;
      }
    }
    const [g] = agruparErros(registros);
    assert.equal(MAX_ENDERECOS_PRINCIPAIS, 5, 'o teto é 5; se ele mudar, este caso e a saída do comando mudam junto');
    assert.equal(g.enderecos.distintos, 8, 'a contagem NÃO é cortada: é ela que responde "um ou trezentos"');
    assert.equal(g.enderecos.principais.length, MAX_ENDERECOS_PRINCIPAIS);
    assert.deepEqual(g.enderecos.principais.map((e) => e.ip), [
      '203.0.113.0', '203.0.113.1', '203.0.113.2', '203.0.113.3', '203.0.113.4',
    ]);
    assert.deepEqual(g.enderecos.principais.map((e) => e.total), [8, 7, 6, 5, 4]);
  });

  it('empate na contagem: a ordem é a do ENDEREÇO, e não a de chegada', () => {
    // Chegam em ordem decrescente, de propósito: com desempate por ordem de chegada a saída
    // sairia ao contrário, e o corte pelo teto passaria a mudar QUEM aparece entre execuções.
    const grupos = agruparErros([
      requisicao(1, '203.0.113.30'),
      requisicao(2, '203.0.113.20'),
      requisicao(3, '203.0.113.10'),
    ]);
    assert.deepEqual(grupos[0].enderecos.principais.map((e) => e.ip), [
      '203.0.113.10', '203.0.113.20', '203.0.113.30',
    ]);
  });

  it('a mesma entrada em outra ordem devolve os MESMOS principais', () => {
    const base = [
      requisicao(1, '198.51.100.4'), requisicao(2, '203.0.113.7'), requisicao(3, '203.0.113.7'),
      requisicao(4, '10.0.0.9'), requisicao(5, '10.0.0.9'), requisicao(6, '192.0.2.1'),
    ];
    const direto = agruparErros(base)[0].enderecos;
    const invertido = agruparErros([...base].reverse())[0].enderecos;
    // Números de controle ABSOLUTOS, e não só a igualdade entre os dois: duas saídas erradas
    // do mesmo jeito passariam numa comparação que só olha uma contra a outra.
    assert.deepEqual(direto, {
      distintos: 4,
      principais: [
        { ip: '10.0.0.9', total: 2 },
        { ip: '203.0.113.7', total: 2 },
        { ip: '192.0.2.1', total: 1 },
        { ip: '198.51.100.4', total: 1 },
      ],
    });
    assert.deepEqual(invertido, direto);
  });

  it('linha sem endereço nenhum: distintos ZERO, e nada é inventado', () => {
    const [g] = agruparErros([{ time: 1, level: 50, msg: 'sweep do WS falhou' }]);
    assert.deepEqual(g.enderecos, { distintos: 0, principais: [] });
  });

  it("'unknown' é um endereço como outro qualquer, e ausência não é 'unknown'", () => {
    // `UNKNOWN_ADDRESS` é resposta do produtor ("olhei o socket e não havia"), enquanto campo
    // ausente é linha velha ou linha fora do ciclo HTTP. Colapsar os dois esconderia o único
    // valor deste campo que nunca pode vir de um chamador.
    const [g] = agruparErros([
      requisicao(1, 'unknown'),
      requisicao(2, 'unknown'),
      requisicao(3, undefined),
      requisicao(4, '   '),
    ]);
    assert.equal(g.total, 4);
    assert.deepEqual(g.enderecos, { distintos: 1, principais: [{ ip: 'unknown', total: 2 }] });
  });
});

describe('diag — o endereço NÃO entra na assinatura', () => {
  it('duas ocorrências do mesmo defeito, de endereços diferentes, são UMA assinatura', () => {
    const grupos = agruparErros([requisicao(1, '203.0.113.7'), requisicao(2, '198.51.100.4')]);
    assert.equal(grupos.length, 1, 'endereço na assinatura explodiria a cardinalidade e desfaria o agrupamento');
    assert.equal(grupos[0].total, 2);
  });

  it('a assinatura é a MESMA de antes, texto por texto', () => {
    // Não-regressão explícita: as strings abaixo são as que a versão anterior produzia para
    // estas mesmas entradas. Um campo novo dentro do grupo não pode mexer na chave dele.
    assert.equal(
      assinaturaDeErro(requisicao(1, '203.0.113.7')),
      'POST /api/v1/auth/login | request [401]'
    );
    assert.equal(
      assinaturaDeErro(doErrorHandler(1)),
      'POST /api/v1/auth/login | UnauthorizedError | Credenciais inválidas'
    );
    assert.equal(
      assinaturaDeErro({ time: 1, level: 50, msg: 'sweep do WS falhou' }),
      'sweep do WS falhou'
    );
    // E a assinatura do FUNDIDO, que é a que o relatório mostra na esmagadora maioria dos
    // casos, continua carregando o status da linha de requisição entre colchetes.
    const par = { reqId: 'req-do-par' };
    const [g] = agruparErros([doErrorHandler(10, par), requisicao(11, '203.0.113.7', par)]);
    assert.equal(g.assinatura, 'POST /api/v1/auth/login | UnauthorizedError | Credenciais inválidas [401]');
  });
});

describe('diag — o comando NOMEIA as duas leituras de um endereço só', () => {
  /** Escreve um log com as linhas dadas, no arquivo do dia de cada uma. */
  function logCom(registros) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ebgeo-ip-'));
    temporarios.push(dir);
    for (const reg of registros) {
      const d = new Date(reg.time);
      const nome = `ebgeo-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.jsonl`;
      fs.appendFileSync(path.join(dir, nome), `${JSON.stringify(reg)}\n`);
    }
    return dir;
  }

  const rodar = (dir) => spawnSync(process.execPath, [COMANDO, 'erros', '--dir', dir, '--desde', '1h'], { encoding: 'utf8' });

  it('um endereço só sobre muitas ocorrências, e a janela inteira também: as DUAS leituras saem', () => {
    const agora = Date.now();
    const linhas = [];
    for (let i = 0; i < 12; i += 1) linhas.push(requisicao(agora - (i + 1) * 1000, '203.0.113.7'));
    const r = rodar(logCom(linhas));

    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /1 endereço só, em 12 das 12 ocorrência\(s\): 203\.0\.113\.7/);
    assert.match(r.stdout, /Na janela inteira: 1 endereço\(s\) distinto\(s\) em 12 linha\(s\) com endereço\./);
    assert.match(r.stdout, /UM ENDEREÇO SÓ NUM GRUPO TEM DUAS LEITURAS/);
    assert.match(r.stdout, /TRUST_PROXY_HOPS/);
    assert.match(r.stdout, /a janela INTEIRA tem um endereço \(203\.0\.113\.7\)/);
    assert.match(r.stdout, /INDÍCIO, não veredito/);
  });

  it('um endereço no grupo mas muitos na janela: a nota sai e ABSOLVE o instrumento', () => {
    const agora = Date.now();
    const linhas = [];
    for (let i = 0; i < 6; i += 1) linhas.push(requisicao(agora - (i + 1) * 1000, '203.0.113.7'));
    // Trânsito saudável, de outros endereços: é ele que mostra que o campo não é constante.
    for (let i = 0; i < 20; i += 1) {
      linhas.push({
        level: 30, time: agora - (i + 30) * 1000, reqId: `ok-${i}`, ip: `198.51.100.${i}`,
        method: 'GET', url: '/api/v1/config', statusCode: 200, duration: 4, msg: 'request',
      });
    }
    const r = rodar(logCom(linhas));

    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Na janela inteira: 21 endereço\(s\) distinto\(s\) em 26 linha\(s\) com endereço\./);
    assert.match(r.stdout, /UM ENDEREÇO SÓ NUM GRUPO TEM DUAS LEITURAS/);
    assert.match(r.stdout, /a janela tem 21 endereços distintos, então o campo NÃO é constante/);
    assert.doesNotMatch(r.stdout, /a janela INTEIRA tem um endereço/);
  });

  it('vários endereços no grupo: a lista sai alinhada e a nota da ambiguidade NÃO sai', () => {
    const agora = Date.now();
    const linhas = [];
    for (let i = 0; i < 9; i += 1) linhas.push(requisicao(agora - (i + 1) * 1000, `203.0.113.${i % 3}`));
    const r = rodar(logCom(linhas));

    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /3 endereço\(s\) distinto\(s\):/);
    assert.match(r.stdout, / {5}3x {2}203\.0\.113\.0/);
    assert.doesNotMatch(r.stdout, /UM ENDEREÇO SÓ NUM GRUPO/);
  });

  it('janela sem endereço nenhum: o comando diz isso, em vez de calar', () => {
    // É o estado da maioria dos logs enquanto o campo for novo, e um relatório mudo aqui se lê
    // como "não há origem a investigar".
    const agora = Date.now();
    const r = rodar(logCom([
      { level: 50, time: agora - 1000, msg: 'sweep do WS falhou' },
      { level: 50, time: agora - 2000, msg: 'sweep do WS falhou' },
    ]));

    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Nenhuma linha desta janela registra endereço/);
    assert.match(r.stdout, /campo `ip` nasceu em 2026-08-31/);
    assert.doesNotMatch(r.stdout, /Na janela inteira:/);
  });
});
