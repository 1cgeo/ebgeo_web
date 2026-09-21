// Path: tests/unit/link-publico-url-base.test.js
//
// O ENDEREÇO DO LINK PÚBLICO (dono, 2026-09-20): a base configurada mais `?atlasPublico=<token>`.
//
// A tela de compartilhamento mostrava e copiava o TOKEN cru, que não é endereço de nada. O
// servidor passou a compor o endereço sobre `app.urlBaseLinkPublico`, e este arquivo prende a
// composição, que é pura. A fiação (o payload de `GET /sharing`, a resposta de publicar e o
// override do administrador) mora em `tests/integration/link-publico-url-base.test.js`, e o parse
// do env em `tests/unit/config-defaults.test.js`.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { composePublicUrl, PUBLIC_LINK_PARAM } from '../../src/modules/sharing/public-url.js';

const TOKEN = 'a3f1c29b7e5d4086a3f1c29b7e5d4086';

describe('composePublicUrl', () => {
  it('a forma pedida: a base padrão, uma barra e o parâmetro que o boot do mapa consome', () => {
    assert.equal(PUBLIC_LINK_PARAM, 'atlasPublico');
    assert.equal(
      composePublicUrl('https://ebgeo.dsg.eb.mil.br', TOKEN),
      `https://ebgeo.dsg.eb.mil.br/?atlasPublico=${TOKEN}`
    );
  });

  it('a barra final da base não dobra, e o CAMINHO da base é preservado', () => {
    const esperado = `https://host.exemplo/ebgeo/?atlasPublico=${TOKEN}`;
    for (const base of ['https://host.exemplo/ebgeo', 'https://host.exemplo/ebgeo/', 'https://host.exemplo/ebgeo///']) {
      assert.equal(composePublicUrl(base, TOKEN), esperado, base);
    }
    assert.equal(composePublicUrl('https://host.exemplo/', TOKEN), `https://host.exemplo/?atlasPublico=${TOKEN}`);
  });

  it('query e fragmento da base são descartados: a base é onde o app mora, não um estado dele', () => {
    assert.equal(
      composePublicUrl('https://host.exemplo/app?atlas=outro#view=3d', TOKEN),
      `https://host.exemplo/app/?atlasPublico=${TOKEN}`
    );
  });

  it('porta e http de rede interna passam: a base é fato de implantação', () => {
    assert.equal(composePublicUrl('http://10.0.0.5:8080', TOKEN), `http://10.0.0.5:8080/?atlasPublico=${TOKEN}`);
  });

  it('espaço em volta é aparado, e o token é codificado', () => {
    assert.equal(composePublicUrl('  https://host.exemplo  ', ` ${TOKEN} `), `https://host.exemplo/?atlasPublico=${TOKEN}`);
    assert.equal(composePublicUrl('https://host.exemplo', 'a b&c'), 'https://host.exemplo/?atlasPublico=a%20b%26c');
  });

  it('o resultado é uma URL que analisa, e o parâmetro volta igual', () => {
    const url = new URL(composePublicUrl('https://host.exemplo/ebgeo/', TOKEN));
    assert.equal(url.searchParams.get('atlasPublico'), TOKEN);
    assert.equal(url.pathname, '/ebgeo/');
  });

  for (const base of [undefined, null, '', '   ', 42, {}, 'ebgeo.dsg.eb.mil.br', '/relativa', 'ftp://host.exemplo', 'javascript:alert(1)']) {
    it(`base ${JSON.stringify(base)}: NULO, e o chamador cai no token em vez de montar link que não abre`, () => {
      assert.equal(composePublicUrl(base, TOKEN), null);
    });
  }

  for (const token of [undefined, null, '', '   ', 42]) {
    it(`token ${JSON.stringify(token)}: NULO, porque atlas sem link não tem endereço`, () => {
      assert.equal(composePublicUrl('https://ebgeo.dsg.eb.mil.br', token), null);
    });
  }
});
