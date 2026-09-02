// Path: tests/unit/diag-latencia-por-release.test.js
//
// `resumirLatencia` agrupado por BUILD: `npm run diag -- lento --por-release`.
//
// A PERGUNTA QUE SÓ ESTA FORMA RESPONDE é a que um deploy levanta: "isto ficou mais lento
// depois de subir?". Sem o agrupamento, as duas builds caem na mesma linha e o p95 delas se
// mistura, ESCONDENDO a regressão em proporção ao tempo que a build antiga dominou a janela.
// Esconde mais justamente na janela larga, que é a que se olha depois de um deploy ruim.
//
// O CASO QUE MAIS IMPORTA É O DA LINHA SEM `release`, e ele não é hipotético: o carimbo de
// build (`EBGEO_RELEASE`, no `base` do pino) só existe desde o lote A, então num arquivo que
// atravesse aquela data a MAIORIA das linhas não tem o campo. Descartá-las faria a comparação
// entre duas builds ser feita ignorando a mais antiga das duas, sem dizer que ignorou.
//
// CONTROLE NEGATIVO (conferido revertendo cada um):
//  - filtrar as linhas sem `release` em vez de agrupá-las: o caso do grupo nulo fica
//    vermelho, e a soma dos `n` deixa de bater com o total de linhas;
//  - usar espaço como separador de chave: o caso da colisão fica vermelho;
//  - tirar o desempate por rota e por release da ordenação: o caso do determinismo fica
//    vermelho quando duas builds da mesma rota empatam em p95, que é o comum.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resumirLatencia, ROTULO_SEM_RELEASE } from '../../src/utils/diag-consulta.js';

/** Uma linha de requisição como o `request-logger` a escreve. */
const req = (url, duration, release, method = 'GET') => ({
  method, url, duration, ...(release === undefined ? {} : { release }),
});

const REGISTROS = [
  // A mesma rota, duas builds: a v2 ficou visivelmente mais lenta.
  req('/api/config', 10, 'v1'),
  req('/api/config', 12, 'v1'),
  req('/api/config', 14, 'v1'),
  req('/api/config', 200, 'v2'),
  req('/api/config', 210, 'v2'),
  // E as linhas anteriores ao carimbo de build.
  req('/api/config', 11, undefined),
  req('/api/config', 13, undefined),
  // Outra rota, numa build só.
  req('/api/v1/atlas', 80, 'v2'),
];

describe('lento --por-release: a mesma rota vira uma linha por build', () => {
  it('sem a opção, a rota é UMA linha e o `release` sai null', () => {
    const linhas = resumirLatencia(REGISTROS);
    const config = linhas.filter((l) => l.rota === 'GET /api/config');
    assert.equal(config.length, 1, 'sem agrupar por build, é uma linha só');
    assert.equal(config[0].n, 7);
    assert.equal(config[0].release, null, 'o campo sai SEMPRE, para o consumidor do --json não precisar saber o modo');
    // A DEMONSTRAÇÃO DO PROBLEMA: com as duas builds juntas, o p95 desta rota é 210 e
    // ninguém sabe que ele vem só de uma delas.
    assert.equal(config[0].p95, 210);
  });

  it('com a opção, cada build é uma linha, e o contraste aparece', () => {
    const linhas = resumirLatencia(REGISTROS, { porRelease: true });
    const config = linhas.filter((l) => l.rota === 'GET /api/config');
    assert.equal(config.length, 3, 'v1, v2 e o grupo sem release');

    const v1 = config.find((l) => l.release === 'v1');
    const v2 = config.find((l) => l.release === 'v2');
    assert.equal(v1.n, 3);
    assert.equal(v1.p95, 14);
    assert.equal(v2.n, 2);
    assert.equal(v2.p95, 210, 'é ESTE contraste que a opção existe para mostrar');
  });

  it('a linha SEM release não é descartada: ela vira um grupo próprio, com `release: null`', () => {
    const linhas = resumirLatencia(REGISTROS, { porRelease: true });
    const sem = linhas.find((l) => l.rota === 'GET /api/config' && l.release === null);
    assert.ok(sem, 'as linhas anteriores ao carimbo de build precisam sobreviver');
    assert.equal(sem.n, 2);
    // NÃO-VACUIDADE PELA SOMA: se um grupo sumisse, a soma dos `n` deixaria de bater com o
    // número de linhas de entrada, e é isso que prova que nada foi descartado.
    assert.equal(linhas.reduce((s, l) => s + l.n, 0), REGISTROS.length);
  });

  it('o rótulo do grupo nulo é de APRESENTAÇÃO, e o dado continua `null`', () => {
    // A distinção não é cerimônia: `null` é falsificável, e uma string mágica no dado se
    // confundiria com uma build que alguém chamasse assim.
    const linhas = resumirLatencia(REGISTROS, { porRelease: true });
    assert.equal(ROTULO_SEM_RELEASE, '(sem release)');
    assert.equal(linhas.some((l) => l.release === ROTULO_SEM_RELEASE), false);
  });

  it('release vazia ou não-string cai no grupo nulo, e não cria uma build de uma linha só', () => {
    // O campo vem de `JSON.parse` de uma linha de arquivo, que pode ter sido escrita por
    // outro produtor ou editada à mão.
    const linhas = resumirLatencia([
      req('/x', 5, ''), req('/x', 6, null), req('/x', 7, 42), req('/x', 8, undefined),
    ], { porRelease: true });
    assert.equal(linhas.length, 1, 'os quatro casos degenerados são UM grupo');
    assert.equal(linhas[0].release, null);
    assert.equal(linhas[0].n, 4);
  });

  it('a chave composta não colide: rota com espaço e release não se confundem', () => {
    // Com um espaço como separador, `GET /a` + `b c` e `GET /a b` + `c` produziriam a MESMA
    // chave e virariam um grupo só, calado. O byte nulo não é produzido por nenhum dos dois
    // lados.
    const linhas = resumirLatencia([
      { method: 'GET', url: '/a', duration: 10, release: 'b c' },
      { method: 'GET', url: '/a b', duration: 900, release: 'c' },
    ], { porRelease: true });
    assert.equal(linhas.length, 2, 'duas chaves distintas continuam distintas');
  });

  it('a ordem é DETERMINÍSTICA quando duas builds empatam em p95', () => {
    // Empate é o caso comum: a mesma rota rápida em duas builds mede o mesmo. Sem desempate,
    // a ordem passaria a ser a de inserção no Map, ou seja, a ordem em que as linhas caíram
    // no disco, e duas rodadas sobre o mesmo arquivo dariam tabelas diferentes.
    const entrada = [
      req('/z', 50, 'v2'), req('/z', 50, 'v1'), req('/a', 50, 'v2'), req('/a', 50, 'v1'),
    ];
    const uma = resumirLatencia(entrada, { porRelease: true });
    const outra = resumirLatencia([...entrada].reverse(), { porRelease: true });
    assert.deepEqual(
      uma.map((l) => `${l.rota}|${l.release}`),
      outra.map((l) => `${l.rota}|${l.release}`)
    );
    assert.deepEqual(uma.map((l) => `${l.rota}|${l.release}`), [
      'GET /a|v1', 'GET /a|v2', 'GET /z|v1', 'GET /z|v2',
    ]);
  });

  it('a normalização de rota continua valendo dentro de cada build', () => {
    // Sem ela o agrupamento não agrupa nada, e por build seria pior: cada atlas viraria uma
    // linha POR build.
    const linhas = resumirLatencia([
      { method: 'POST', url: '/atlas/11111111-2222-3333-4444-555555555555/sync', duration: 30, release: 'v1' },
      { method: 'POST', url: '/atlas/99999999-8888-7777-6666-555555555555/sync', duration: 40, release: 'v1' },
    ], { porRelease: true });
    assert.equal(linhas.length, 1);
    assert.equal(linhas[0].rota, 'POST /atlas/:id/sync');
    assert.equal(linhas[0].n, 2);
  });
});
