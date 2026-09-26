// Path: tests/unit/figura-de-slide-espelha-o-cliente.test.js
//
// O SENTINELA DA FIGURA DE SLIDE EXISTE NOS DOIS PACOTES, E ELES PRECISAM CONCORDAR.
//
// O cliente escreve `https://figura.ebgeo/<id>` no HTML do slide (`frontend/src/js/briefing/
// figura-de-slide.js`); o servidor o lê para exigir os bytes num import e para reescrever o id num
// clone (`src/utils/figura-de-slide.js`). O backend não importa do frontend em runtime, então há
// duas cópias. Se divergirem, o clone deixa o slide citando a imagem da ORIGEM e o import deixa de
// exigir a figura, e nenhum teste de nenhum dos lados fica vermelho, porque cada um está certo
// consigo mesmo. Cada caso leva também o valor ABSOLUTO esperado: comparar as duas cópias entre si
// passaria feliz se as duas estivessem erradas do mesmo jeito.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as doServidor from '../../src/utils/figura-de-slide.js';
import * as doCliente from '../../../frontend/src/js/briefing/figura-de-slide.js';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const N = '33333333-3333-4333-8333-333333333333';

describe('figura de slide: servidor e cliente leem o mesmo sentinela', () => {
  it('a mesma origem, e é a esperada', () => {
    assert.equal(doServidor.FIGURA_ORIGEM, 'https://figura.ebgeo/');
    assert.equal(doCliente.FIGURA_ORIGEM, doServidor.FIGURA_ORIGEM);
  });

  it('os mesmos ids citados', () => {
    const html = `<p>x</p><img src="${doCliente.srcDaFigura(A)}"><img src="data:image/png;base64,AA"><img src="${doCliente.srcDaFigura(B)}"><img src="${doCliente.srcDaFigura(A)}">`;
    assert.deepEqual(doServidor.idsDeFigurasNoHtml(html), [A, B]);
    assert.deepEqual(doCliente.idsDeFigurasNoHtml(html), doServidor.idsDeFigurasNoHtml(html));
    for (const vazio of [null, undefined, '', '<p>nada</p>', `${doServidor.FIGURA_ORIGEM}../x`]) {
      assert.deepEqual(doServidor.idsDeFigurasNoHtml(vazio), []);
      assert.deepEqual(doCliente.idsDeFigurasNoHtml(vazio), []);
    }
  });

  it('a mesma reescrita, que troca só o id e recusa destino inválido', () => {
    const html = `<img src="${doCliente.srcDaFigura(A)}" width="9"><img src="${doCliente.srcDaFigura(B)}">`;
    const mapa = { [A]: N, [B]: '../fora' };
    const esperado = `<img src="https://figura.ebgeo/${N}" width="9"><img src="https://figura.ebgeo/${B}">`;
    assert.equal(doServidor.reescreverFigurasNoHtml(html, mapa), esperado);
    assert.equal(doCliente.reescreverFigurasNoHtml(html, mapa), esperado);
    assert.equal(doServidor.reescreverFigurasNoHtml(html, new Map([[A, N]])), doCliente.reescreverFigurasNoHtml(html, new Map([[A, N]])));
  });
});
