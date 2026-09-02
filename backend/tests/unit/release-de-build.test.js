// Path: tests/unit/release-de-build.test.js
// O RÓTULO DA BUILD (`EBGEO_RELEASE`), nas duas peças puras que o produzem: `parseRelease`
// (`src/config.js`), que decide o que a env vira, e `baseDoLogger` (`src/utils/logger.js`),
// que decide o que o pino carimba em toda linha.
//
// POR QUE AS DUAS AQUI E NÃO CONTRA O LOGGER REAL. Sob `NODE_ENV=test` o logger sai em
// `level: 'silent'` e o destino de arquivo nem é montado, então uma asserção sobre a saída
// do pino passaria verde com o campo apagado. O par que exercita o logger DE VERDADE é
// `tests/integration/release-no-log-e-no-diag-status.test.js`, que sobe o `src/index.js` real
// num subprocesso e lê o `.jsonl` que ficou em disco.
//
// CONTROLE NEGATIVO (o que fica vermelho ao reverter cada peça):
//  - dar um default a `parseRelease` (a versão do package.json, por exemplo): o caso da env
//    ausente deixa de devolver `undefined`, que é o estado que faz o `base` do pino nem ser
//    passado e o `/diag/status` publicar `null` em vez do valor;
//  - devolver `{ release }` sem `pid`/`hostname` em `baseDoLogger`: os dois casos que exigem
//    os campos do default do pino ficam vermelhos, que é o modo de falha silencioso desta
//    mudança (o hostname é o que separa duas instâncias no mesmo arquivo);
//  - tirar o `slice`: o caso do valor longo deixa de ser cortado e passa a poder exceder o
//    teto de 100 que a coluna `client_errors.release` compartilha com o cliente.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseRelease, TETO_DO_RELEASE } from '../../src/config.js';
import { baseDoLogger } from '../../src/utils/logger.js';

describe('parseRelease — o que a env EBGEO_RELEASE vira', () => {
  it('devolve o valor limpo quando há um', () => {
    assert.equal(parseRelease('c497f12e'), 'c497f12e');
    assert.equal(parseRelease('  c497f12e  '), 'c497f12e', 'espaço em volta não é parte do hash');
    assert.equal(parseRelease('v2.3.1-rc4'), 'v2.3.1-rc4');
  });

  it('AUSENTE é `undefined`, e nunca um default: não há build em desenvolvimento', () => {
    // O `undefined` é o que faz a opção `base` do pino nem ser passada e o `/diag/status`
    // publicar `release: null`. Um default constante entre deploys (a versão do package.json)
    // carimbaria toda linha com um valor que não distingue nada, e ainda faria a ausência
    // de release parecer resolvida — que é a limitação declarada da coluna do cliente.
    const semValor = [undefined, null, '', '   ', '\t\n', 42, {}, [], true];
    assert.equal(semValor.length, 9);
    for (const bruto of semValor) {
      assert.equal(parseRelease(bruto), undefined, `entrada ${JSON.stringify(bruto)}`);
    }
  });

  it('corta no teto em vez de derrubar o boot', () => {
    const gigante = 'x'.repeat(TETO_DO_RELEASE + 50);
    const saida = parseRelease(gigante);
    assert.equal(saida.length, TETO_DO_RELEASE);
    assert.equal(saida, 'x'.repeat(TETO_DO_RELEASE));
    // O teto é o mesmo do Joi do relato de cliente (`erroDeClienteSchema.release`), porque
    // os dois lados terminam na MESMA coluna: um teto maior aqui produziria um valor de
    // servidor que o valor de cliente nunca poderia igualar.
    assert.equal(TETO_DO_RELEASE, 100);
  });

  it('o corte respeita o trim: o espaço não consome teto', () => {
    const saida = parseRelease(`   ${'y'.repeat(TETO_DO_RELEASE)}   `);
    assert.equal(saida.length, TETO_DO_RELEASE);
    assert.equal(saida.startsWith('y'), true);
  });
});

describe('baseDoLogger — o que toda linha de log carrega', () => {
  it('sem release não há `base`: o default do pino (pid, hostname) fica de pé', () => {
    // A distinção é a razão da função existir. `base: undefined` NÃO cai no default do
    // pino: medido nesta versão (pino 8), ele apaga `pid` e `hostname` de toda linha,
    // porque as opções são fundidas por cópia e a chave presente vence. Por isso o
    // chamador OMITE a opção, e é este `undefined` que ele testa.
    const semValor = [undefined, null, '', 0, {}];
    assert.equal(semValor.length, 5);
    for (const release of semValor) {
      assert.equal(baseDoLogger(release), undefined, `entrada ${JSON.stringify(release)}`);
    }
  });

  it('com release, o base traz os TRÊS campos: pid, hostname e release', () => {
    const base = baseDoLogger('c497f12e');
    assert.deepEqual(Object.keys(base).sort(), ['hostname', 'pid', 'release']);
    assert.equal(base.release, 'c497f12e');
    assert.equal(base.pid, process.pid);
    assert.equal(typeof base.hostname, 'string');
    assert.ok(base.hostname.length > 0, 'o hostname é o que separa duas instâncias no arquivo');
  });

  it('não inventa forma: o release entra como veio de `parseRelease`', () => {
    // Nada de normalizar, encurtar ou prefixar aqui: o valor já passou pelo teto e pelo
    // trim em `parseRelease`, e uma segunda regra neste ponto seria a segunda verdade
    // sobre o que "release" significa.
    const bruto = parseRelease('  build-42  ');
    assert.equal(baseDoLogger(bruto).release, 'build-42');
  });
});
