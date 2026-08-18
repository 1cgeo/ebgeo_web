// Path: tests/unit/assets3d-regime-indice.test.js
//
// A INVERSÃO CAMINHO -> RECURSO, medida sem banco (fase F11, parte B).
//
// O eixo inteiro do `/assets3d` depende de UMA função pura: dada a linha de catálogo,
// quais caminhos servidos pertencem a ela. Nada no armazenamento registra isso — a
// tabela do SQLite é `assets(rel_path, data, …)` e o disco é uma árvore de arquivos —,
// então a ligação existe só como STRING, e num sentido só. Este arquivo mede a derivação
// e os quatro buracos que ela tem POR DECISÃO, para que nenhum deles passe por coberto.
//
// Por que unidade e não integração: o gate de HTTP (o arquivo irmão em `integration/`)
// prova que o par nega e libera, e provaria o mesmo com um índice que casasse por
// acidente. O que decide se ele casa por construção é isto aqui.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { _internos } from '../../src/modules/nomes/assets3d-regime.js';

const { montarIndice, relDaUrl, acharEntrada } = _internos;

/** Uma linha de catálogo como o SELECT do índice a devolve. */
function linha(id, accessLevel, config, tipo = 'tileset') {
  return { tipo, id, access_level: accessLevel, config };
}

/**
 * O regime de um caminho contra um índice já montado.
 *
 * Chama O CASADOR DO CÓDIGO, e não uma cópia dele. Este arquivo trazia o laço reescrito, e a
 * cópia é o arranjo em que o verificador e o verificado divergem na mesma edição: quando o
 * casamento passou a dobrar caixa e barra invertida, uma cópia comparando string crua ficaria
 * verde sobre um casador que não casa mais nada.
 */
function regime(indice, rel) {
  return acharEntrada(indice, rel);
}

describe('F11 — o índice de regime do /assets3d', () => {
  it('a ÁRVORE de um tileset é a PASTA do tileset.json, e ela alcança os filhos', () => {
    const indice = montarIndice([
      linha('mod-priv', 'private', { url: '/api/v1/assets3d/3d/PRIV/tileset.json' }),
    ]);

    // O positivo: a raiz e todo descendente pertencem à linha.
    for (const caminho of ['3d/PRIV/tileset.json', '3d/PRIV/0/0.b3dm', '3d/PRIV']) {
      const r = regime(indice, caminho);
      assert.ok(r, `esperava casar ${caminho}`);
      assert.equal(r.privado, true);
      assert.equal(r.resourceId, 'mod-priv');
      assert.equal(r.tipo, 'tileset');
    }

    // O negativo do MESMO par, e ele é o que impede "casa tudo" de passar por verde:
    // o irmão de nome parecido NÃO é descendente.
    assert.equal(regime(indice, '3d/PRIVADO/x.b3dm'), null);
    assert.equal(regime(indice, '3d/OUTRO/tileset.json'), null);
  });

  it('o CASAMENTO MAIS LONGO vence, nos dois sentidos', () => {
    const indice = montarIndice([
      linha('externo', 'private', { url: '/3d/A/tileset.json' }),
      linha('interno', 'public', { url: '/3d/A/sub/tileset.json' }),
    ]);
    assert.equal(regime(indice, '3d/A/0.b3dm').privado, true, 'a árvore de fora continua privada');
    assert.equal(regime(indice, '3d/A/sub/0.b3dm').privado, false, 'o público aninhado continua público');

    // E o inverso, que é o que importa para não vazar: um público por fora não abre o
    // privado que mora dentro dele.
    const invertido = montarIndice([
      linha('externo', 'public', { url: '/3d/B/tileset.json' }),
      linha('interno', 'private', { url: '/3d/B/sub/tileset.json' }),
    ]);
    assert.equal(regime(invertido, '3d/B/0.b3dm').privado, false);
    assert.equal(regime(invertido, '3d/B/sub/0.b3dm').privado, true);
  });

  it('empate entre duas linhas resolve para PRIVADO (erro de catálogo se lê pelo lado fechado)', () => {
    const indice = montarIndice([
      linha('pub', 'public', { url: '/3d/MESMO/tileset.json' }),
      linha('priv', 'private', { url: '/3d/MESMO/tileset.json' }),
    ]);
    assert.equal(regime(indice, '3d/MESMO/0.b3dm').privado, true);
  });

  it('o PREVIEW é casado por ARQUIVO, porque ele mora fora da pasta do modelo', () => {
    // O seed do PCL punha o preview num diretório COMPARTILHADO (`/3d/videos/`). Regra de
    // pasta ali erraria dos dois lados: sem entrada nenhuma o preview do modelo privado
    // sai aberto; com entrada de PASTA o diretório inteiro fecharia, escondendo o preview
    // dos modelos públicos que dividem a pasta.
    const indice = montarIndice([
      linha('priv', 'private', {
        url: '/3d/PRIV/tileset.json',
        previewVideo: '/3d/videos/priv.webm',
        previewThumbnail: '/3d/videos/priv.jpg',
      }),
    ]);
    assert.equal(regime(indice, '3d/videos/priv.webm').privado, true);
    assert.equal(regime(indice, '3d/videos/priv.jpg').privado, true);
    // O vizinho na MESMA pasta não é arrastado junto.
    assert.equal(regime(indice, '3d/videos/publico.webm'), null);
  });

  it('a cena de PRIMEIRA PESSOA declara a pasta, não um arquivo raiz', () => {
    const indice = montarIndice([
      linha('cena', 'private', { basePath: '/api/v1/assets3d/primeira-pessoa/museu-1cgeo' }),
    ]);
    // Os sete endereços que `scene-config.service.js` deriva do basePath caem todos dentro.
    for (const f of ['cena.sog', 'voxel/voxel-meta.json', 'voxel/voxel.bin', 'marcadores.json']) {
      assert.equal(regime(indice, `primeira-pessoa/museu-1cgeo/${f}`).privado, true, f);
    }
    assert.equal(regime(indice, 'primeira-pessoa/outra-cena/cena.sog'), null);
  });

  it('as VARIANTES de caminho não escapam do índice', () => {
    // A armadilha está documentada na wiki do assets3d: `./x`, `//x` e um `..` colapsável
    // erram o índice de igualdade exata do SQLite e AINDA são servidos pelo ramo de
    // filesystem. Normalizar depois do teste de prefixo devolveria o buraco pela variante.
    const indice = montarIndice([linha('priv', 'private', { url: '/3d/PRIV/tileset.json' })]);
    for (const variante of [
      './3d/PRIV/0.b3dm',
      '3d//PRIV/0.b3dm',
      '3d/PRIV/./0.b3dm',
      '3d/OUTRO/../PRIV/0.b3dm',
      '3d/PRIV/0.b3dm?v=2',
      '3d%2FPRIV/0.b3dm',
    ]) {
      const r = regime(indice, variante);
      assert.ok(r && r.privado, `a variante ${variante} escapou do índice`);
    }
  });

  it('a SOLETRAÇÃO do host não escapa do índice: caixa e barra invertida', () => {
    // Medido, e é o furo que este par fecha: com casamento por string crua,
    // `PROBEPRIV/tileset.json` e a mesma pasta com barra invertida não casavam linha nenhuma,
    // o regime saía PÚBLICO e o ramo de filesystem servia os bytes assim mesmo, porque
    // `path.resolve` usa a semântica do HOST (Windows e macOS ignoram caixa; Windows aceita a
    // barra invertida como separador). O anônimo levava o tileset privado com
    // `public, immutable`.
    const indice = montarIndice([linha('priv', 'private', { url: '/3d/Priv/tileset.json' })]);

    for (const variante of [
      '3D/PRIV/0.b3dm',
      '3d/priv/0.b3dm',
      '3d\\Priv\\0.b3dm',
      '3d/Priv\\sub/0.b3dm',
      '3D%5CPRIV/tileset.json',
    ]) {
      const r = regime(indice, variante);
      assert.ok(r && r.privado, `a variante ${variante} escapou do índice`);
    }

    // O negativo do mesmo par: dobrar a caixa NÃO pode virar "casa tudo". O vizinho de nome
    // parecido continua fora, soletrado em qualquer caixa.
    assert.equal(regime(indice, '3d/PrivOutro/0.b3dm'), null);
    assert.equal(regime(indice, '3D/PRIVOUTRO/0.b3dm'), null);
  });

  it('o casamento por ARQUIVO também dobra a soletração, e sem arrastar o vizinho', () => {
    const indice = montarIndice([
      linha('priv', 'private', { url: '/3d/M/tileset.json', previewVideo: '/3d/videos/Priv.webm' }),
    ]);
    assert.equal(regime(indice, '3d/VIDEOS/PRIV.webm').privado, true);
    assert.equal(regime(indice, '3d/videos/priv.webm').privado, true);
    assert.equal(regime(indice, '3d/videos/priv.webm.bak'), null, 'prefixo de arquivo não é pasta');
    assert.equal(regime(indice, '3d/videos/publico.webm'), null);
  });

  it('URL de OUTRA ORIGEM não entra no índice', () => {
    // Camada de dados apontando para um WMS de terceiro. Se `https://x/y` virasse o
    // prefixo `https:/x/y`, o índice ganharia uma entrada que só casa por acidente.
    const indice = montarIndice([
      linha('externa', 'private', { url: 'https://exemplo.mil.br/tiles/{z}/{x}/{y}.png' }, 'data_layer'),
      linha('protocolo-relativo', 'private', { url: '//cdn.exemplo/3d/x/tileset.json' }),
    ]);
    assert.deepEqual(indice, []);
    assert.equal(relDaUrl('https://exemplo.mil.br/a/b'), null);
    assert.equal(relDaUrl('//cdn/a/b'), null);
  });

  it('caminho na RAIZ da árvore é descartado, e o descarte vale nos dois sentidos', () => {
    // Um prefixo vazio casaria a rota inteira: privado na raiz derrubaria todo modelo
    // público, público na raiz sombrearia todo prefixo privado abaixo dele.
    const privadoNaRaiz = montarIndice([linha('raiz', 'private', { url: '/tileset.json' })]);
    assert.deepEqual(privadoNaRaiz, [], 'privado na raiz não pode fechar a rota inteira');

    const publicoNaRaiz = montarIndice([
      linha('raiz', 'public', { url: '/api/v1/assets3d/tileset.json' }),
      linha('priv', 'private', { url: '/3d/PRIV/tileset.json' }),
    ]);
    assert.equal(regime(publicoNaRaiz, '3d/PRIV/0.b3dm').privado, true);
  });

  it('linha SEM caminho nenhum não produz entrada, e config nulo não derruba a montagem', () => {
    assert.deepEqual(montarIndice([linha('vazia', 'private', {})]), []);
    assert.deepEqual(montarIndice([linha('nula', 'private', null)]), []);
    assert.deepEqual(montarIndice([linha('lixo', 'private', { url: 42, basePath: '   ' })]), []);
  });

  it('o índice guarda o tipo de PRODUÇÃO da tabela, que é o vocabulário do predicado', () => {
    const indice = montarIndice([
      linha('t', 'private', { url: '/3d/T/tileset.json' }, 'tileset'),
      linha('a', 'private', { url: '/camadas/A/tileset.json' }, 'analysis_layer'),
    ]);
    assert.equal(regime(indice, '3d/T/0.b3dm').tipo, 'tileset');
    assert.equal(regime(indice, 'camadas/A/x.json').tipo, 'analysis_layer');
  });
});
