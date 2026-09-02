// Path: tests/unit/diag-cli-pilha.test.js
//
// A metade de `npm run diag -- pilha` que não toca no banco, hoje em
// `src/modules/diag/pilha.service.js`: ler o texto do rastro, achar a build certa e casar cada
// quadro com o seu `.map`. Ela morava em `scripts/diag/pilha.js` e mudou de casa em 2026-09-02,
// quando `GET /api/v1/diag/defeitos/:id/pilha` passou a chamar as MESMAS funções; o nome deste
// arquivo continua dizendo `cli` porque é o comando que ele dirige, e a rota tem os seus.
//
// O CASO QUE JUSTIFICA O ARQUIVO É A RECUSA. `localizarReleaseDeMapas` casa por IGUALDADE do
// campo `release` de `release.json`, e a tentação de "usar a build mais recente quando não
// achar" é o defeito que este teste existe para impedir: resolver contra outra build NÃO
// falha (os chunks têm nomes parecidos e o `mappings` tem segmentos nas mesmas linhas), ela
// devolve funções e linhas plausíveis e ERRADAS. Um relatório assim custa mais que pilha
// nenhuma, porque manda ler o arquivo errado com confiança.
//
// A SEGUNDA COISA QUE ELE COMPRA É A FRONTEIRA DE CAMINHO. `defeitos.stack_bruta` é texto
// livre que chega pela única rota anônima do servidor, então os endereços dentro dela são
// escolhidos por quem relata, e `path.join` com um `../../..` dentro produzia um candidato
// FORA de `--mapas`: o `fs.existsSync` virava oráculo de existência de arquivo e o
// `JSON.parse` que falha punha o começo do conteúdo na mensagem de erro.
//
// CONTROLE NEGATIVO (conferido revertendo cada um):
//   - tirar o filtro `dentroDaRaiz` de `caminhosDoMapa` e cai o caso da travessia;
//   - trocar `dentroDaRaiz` por um `startsWith` cru sem `path.sep` e cai o caso do vizinho
//     de nome parecido, que é o motivo de a comparação não ser sobre a string nua;
//   - devolver `err.message` do `JSON.parse` e cai o caso do mapa corrompido, que exige que
//     a mensagem NÃO cite o conteúdo lido;
//   - fazer `localizarReleaseDeMapas` devolver a primeira candidata quando não há casamento
//     e cai o caso da release ausente;
//   - tirar o `- 1` de `colunaDeQuadro` e cai o caso da conversão de base, que é invisível na
//     saída (ela devolve o segmento vizinho, com outro nome de função, sem erro nenhum);
//   - trocar `.+?` por `[^:]+` na regex de quadro e cai o caminho com drive do Windows;
//   - colapsar `sem-mapa` e `sem-segmento` num motivo só e cai o caso do mapa corrompido, que
//     passaria a se ler como mapa ausente.

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  analisarPilha, nomeDoArquivo, colunaDeQuadro, caminhosDoMapa, fonteLegivel,
  lerReleaseJson, localizarReleaseDeMapas, resolverQuadros,
} from '../../src/modules/diag/pilha.service.js';
import { resolver } from '../../src/utils/mapa-de-fonte.js';

const temporarios = [];
after(() => {
  for (const dir of temporarios) fs.rmSync(dir, { recursive: true, force: true });
});

function pastaTemporaria() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ebgeo-pilha-'));
  temporarios.push(dir);
  return dir;
}

/** A mesma fixture de `diag-cli-mapa-de-fonte.test.js`, escrita à mão. Ver o cabeçalho de lá. */
const MAPA = {
  version: 3,
  file: 'core-Ab12Cd34.js',
  sources: ['../../src/js/alfa.js', '../../src/js/beta.js'],
  names: ['iniciar', 'parar'],
  mappings: 'AAAAA,UAIE,oBCKIC,oB;IAGND;',
};

/** Uma build no disco: `release.json` na raiz e um `.map` sob `assets/`. */
function buildCom(release, { mapa = MAPA, semMapa = false, mapaPodre = false } = {}) {
  const dir = pastaTemporaria();
  fs.writeFileSync(
    path.join(dir, 'release.json'),
    JSON.stringify({ release, version: '1.0.0', hash: release.split('+')[1] ?? null, builtAt: '2026-09-01T00:00:00.000Z' })
  );
  if (!semMapa) {
    fs.mkdirSync(path.join(dir, 'assets'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'assets', 'core-Ab12Cd34.js.map'),
      mapaPodre ? '<html>404</html>' : JSON.stringify(mapa)
    );
  }
  return dir;
}

describe('pilha: analisarPilha', () => {
  it('lê as três formas de quadro que os motores escrevem', async () => {
    const quadros = analisarPilha([
      'TypeError: x is not a function',
      '    at iniciar (https://ebgeo.mil.br/assets/core-Ab12Cd34.js:1:31)',
      '    at https://ebgeo.mil.br/assets/core-Ab12Cd34.js:2:5',
      'parar@https://ebgeo.mil.br/assets/core-Ab12Cd34.js:1:11',
    ].join('\n'));

    assert.equal(quadros.length, 4);
    // A primeira linha é a MENSAGEM, não um quadro, e ela sobrevive crua: é o que identifica
    // o erro quando nenhum quadro resolve.
    assert.deepEqual(quadros[0], {
      bruta: 'TypeError: x is not a function', url: null, arquivo: null, linha: null, coluna: null, funcao: null,
    });
    assert.equal(quadros[1].url, 'https://ebgeo.mil.br/assets/core-Ab12Cd34.js');
    assert.equal(quadros[1].arquivo, 'core-Ab12Cd34.js');
    assert.equal(quadros[1].linha, 1);
    assert.equal(quadros[1].coluna, 31);
    assert.equal(quadros[1].funcao, 'iniciar');
    assert.equal(quadros[2].funcao, null);
    assert.equal(quadros[2].linha, 2);
    assert.equal(quadros[3].funcao, 'parar');
    assert.equal(quadros[3].coluna, 11);
  });

  it('um caminho com DRIVE do Windows não é cortado no dois-pontos', async () => {
    const [quadro] = analisarPilha('    at algo (C:\\build\\dist\\assets\\core-Ab12Cd34.js:1:31)');
    assert.equal(quadro.url, 'C:\\build\\dist\\assets\\core-Ab12Cd34.js');
    assert.equal(quadro.arquivo, 'core-Ab12Cd34.js');
    assert.equal(quadro.linha, 1);
  });

  it('texto vazio ou nulo devolve uma lista de UM item, e não estoura', async () => {
    // O comando só chega aqui com `stack_bruta` não nula, mas uma pilha de uma linha só é o
    // que um relato pobre traz, e ela precisa sair do outro lado como linha crua.
    assert.equal(analisarPilha('').length, 1);
    assert.equal(analisarPilha(null).length, 1);
    assert.equal(analisarPilha(undefined)[0].url, null);
  });
});

describe('pilha: nomes, colunas e caminhos', () => {
  it('o nome do arquivo ignora query e fragmento', async () => {
    assert.equal(nomeDoArquivo('https://h/assets/core-Ab12.js?t=17000'), 'core-Ab12.js');
    assert.equal(nomeDoArquivo('https://h/assets/core-Ab12.js#x'), 'core-Ab12.js');
    assert.equal(nomeDoArquivo('C:\\d\\core-Ab12.js'), 'core-Ab12.js');
    assert.equal(nomeDoArquivo(''), null);
    assert.equal(nomeDoArquivo(null), null);
  });

  it('a coluna do rastro (1-based) vira a do source map (0-based), com piso em zero', async () => {
    // O erro por um é invisível: ele devolve o segmento vizinho, ou seja, outro nome de
    // função, sem levantar nada.
    assert.equal(colunaDeQuadro(1), 0);
    assert.equal(colunaDeQuadro(31), 30);
    assert.equal(colunaDeQuadro(0), 0);
  });

  it('os dois candidatos de `.map`: o caminho do endereço e depois `assets/<nome>`', async () => {
    const candidatos = caminhosDoMapa('https://ebgeo.mil.br/assets/core-Ab12.js', '/r/1');
    assert.equal(candidatos.length, 1);
    assert.equal(candidatos[0], path.join('/r/1', 'assets', 'core-Ab12.js.map'));

    // Com `base` diferente de `/` o pathname carrega um prefixo que o disco não tem, e é aí
    // que o segundo candidato salva.
    const comPrefixo = caminhosDoMapa('https://ebgeo.mil.br/cms/assets/core-Ab12.js', '/r/1');
    assert.equal(comPrefixo.length, 2);
    assert.equal(comPrefixo[0], path.join('/r/1', 'cms', 'assets', 'core-Ab12.js.map'));
    assert.equal(comPrefixo[1], path.join('/r/1', 'assets', 'core-Ab12.js.map'));
  });

  it('candidato que SAI da release por `..` no endereço é descartado', async () => {
    // Medido antes da guarda: `path.join('/r/1', 'assets/../../../../etc/passwd.map')`
    // resolve para `/etc/passwd.map`, fora de `--mapas`. O endereço vem de uma pilha escrita
    // por quem relata o erro, então isto é entrada de atacante, não caso de borda.
    const candidatos = caminhosDoMapa('https://h/assets/../../../../etc/passwd', '/r/1');
    assert.equal(candidatos.length, 1);
    // O que sobra é o candidato por NOME DE ARQUIVO, que é contido por construção.
    assert.equal(candidatos[0], path.join('/r/1', 'assets', 'passwd.map'));
    for (const c of candidatos) {
      assert.ok(
        path.resolve(c).startsWith(path.resolve('/r/1') + path.sep),
        `candidato fora da release: ${c}`
      );
    }

    // Uma travessia que também escape do segundo candidato não deixa candidato nenhum, e
    // isso é o desfecho certo: o quadro sai como `sem-mapa`, nunca lendo fora da release.
    assert.deepEqual(caminhosDoMapa('https://h/../fora.js', '/r/1/assets'), [
      path.join('/r/1/assets', 'assets', 'fora.js.map'),
    ]);
  });

  it('a fronteira é de CAMINHO, não `startsWith` de string: `/r/10` não é `/r/1`', async () => {
    // Sem o `path.sep` na comparação, uma release em `/r/1` aceitaria caminhos de `/r/10` e
    // `/r/1-antigo`. É o mesmo argumento (e o mesmo modo de falha) de `credencialDeTile` no
    // cliente, que compara origem MAIS fronteira de caminho.
    const candidatos = caminhosDoMapa('https://h/../10/assets/core-Ab12.js', '/r/1');
    // O tamanho vem ANTES do laço: lista vazia daria zero asserções e verde vazio, que é o
    // que a regra `no-unasserted-loop-assert` do pacote existe para impedir.
    assert.equal(candidatos.length, 1);
    for (const c of candidatos) {
      assert.equal(path.resolve(c).startsWith(path.resolve('/r/1') + path.sep), true, c);
    }
    assert.equal(candidatos[0], path.join('/r/1', 'assets', 'core-Ab12.js.map'));
  });

  it('a fonte legível tira os pontos e prefixa o pacote, mantendo o resto', async () => {
    assert.equal(fonteLegivel('../../src/js/store/services.js'), 'frontend/src/js/store/services.js');
    assert.equal(fonteLegivel('./src/css/style.css'), 'frontend/src/css/style.css');
    // O que não começa em `src/` sai como está: um módulo de `node_modules` não é do frontend
    // e prefixá-lo mandaria procurar um arquivo que não existe naquele caminho.
    assert.equal(fonteLegivel('../../node_modules/maplibre-gl/dist/x.js'), 'node_modules/maplibre-gl/dist/x.js');
    assert.equal(fonteLegivel(''), '');
  });
});

describe('pilha: localizarReleaseDeMapas', () => {
  it('aceita `--mapas` apontando DIRETO para a build', async () => {
    const dir = buildCom('1.0.0+ab12cd');
    const achado = await localizarReleaseDeMapas(dir, '1.0.0+ab12cd');
    assert.equal(achado.diretorio, dir);
    assert.equal(achado.candidatas.length, 1);
    assert.equal(achado.candidatas[0].release, '1.0.0+ab12cd');
  });

  it('acha UM NÍVEL abaixo, entre várias builds, e lista todas como candidatas', async () => {
    const raiz = pastaTemporaria();
    for (const [nome, release] of [['r1', '1.0.0+aaaaaa'], ['r2', '1.0.0+bbbbbb'], ['r3', '1.0.0+cccccc']]) {
      const dir = path.join(raiz, nome);
      fs.mkdirSync(path.join(dir, 'assets'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'release.json'), JSON.stringify({ release }));
    }
    // Um vizinho sem `release.json`, que a varredura precisa pular sem morrer.
    fs.mkdirSync(path.join(raiz, 'logs'), { recursive: true });

    const achado = await localizarReleaseDeMapas(raiz, '1.0.0+bbbbbb');
    assert.equal(achado.diretorio, path.join(raiz, 'r2'));
    assert.equal(achado.candidatas.length, 3);
    assert.deepEqual(achado.candidatas.map((c) => c.release).sort(), ['1.0.0+aaaaaa', '1.0.0+bbbbbb', '1.0.0+cccccc']);
  });

  it('RECUSA quando nenhuma build declara a release, e nomeia as que há', async () => {
    // É a peça central do comando. Devolver a mais recente aqui produziria uma pilha
    // plausível e errada, que é o desfecho que este arquivo existe para tornar impossível.
    const raiz = pastaTemporaria();
    for (const [nome, release] of [['r1', '1.0.0+aaaaaa'], ['r2', '1.0.0+bbbbbb']]) {
      const dir = path.join(raiz, nome);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'release.json'), JSON.stringify({ release }));
    }
    const achado = await localizarReleaseDeMapas(raiz, '1.0.0+zzzzzz');
    assert.equal(achado.diretorio, null);
    assert.equal(achado.candidatas.length, 2);
  });

  it('diretório inexistente devolve recusa vazia, e não uma exceção', async () => {
    const achado = await localizarReleaseDeMapas(path.join(pastaTemporaria(), 'nao-existe'), '1.0.0+aaaaaa');
    assert.equal(achado.diretorio, null);
    assert.equal(achado.candidatas.length, 0);
  });

  it('`release.json` sem o campo `release`, ou ilegível, não vira candidata', async () => {
    const raiz = pastaTemporaria();
    fs.writeFileSync(path.join(raiz, 'release.json'), '{"version":"1.0.0"}');
    assert.equal(await lerReleaseJson(raiz), null);
    fs.writeFileSync(path.join(raiz, 'release.json'), 'nao e json');
    assert.equal(await lerReleaseJson(raiz), null);
    assert.equal((await localizarReleaseDeMapas(raiz, '1.0.0+aaaaaa')).candidatas.length, 0);
  });
});

describe('pilha: resolverQuadros', () => {
  const RASTRO = [
    'TypeError: x is not a function',
    '    at iniciar (https://ebgeo.mil.br/assets/core-Ab12Cd34.js:1:31)',
    '    at https://ebgeo.mil.br/assets/core-Ab12Cd34.js:1:11',
    '    at https://ebgeo.mil.br/assets/vendor-Zz99.js:1:4',
  ].join('\n');

  it('resolve os quadros do chunk mapeado e nomeia os três motivos de não resolver', async () => {
    const dir = buildCom('1.0.0+ab12cd');
    const quadros = await resolverQuadros(analisarPilha(RASTRO), dir, resolver);
    assert.equal(quadros.length, 4);

    // A mensagem do topo: não é quadro nenhum.
    assert.equal(quadros[0].resolvido, false);
    assert.equal(quadros[0].motivo, 'sem-quadro');

    // Coluna 31 do rastro é a 30 do mapa, que cai no terceiro segmento (que começa em 30).
    assert.equal(quadros[1].resolvido, true);
    assert.equal(quadros[1].fonte, 'frontend/src/js/beta.js');
    assert.equal(quadros[1].fonteBruta, '../../src/js/beta.js');
    assert.equal(quadros[1].linhaOriginal, 10);
    assert.equal(quadros[1].colunaOriginal, 6);
    assert.equal(quadros[1].nome, 'parar');

    // Coluna 11 do rastro é a 10 do mapa: o segundo segmento, que não tem nome.
    assert.equal(quadros[2].resolvido, true);
    assert.equal(quadros[2].fonte, 'frontend/src/js/alfa.js');
    assert.equal(quadros[2].linhaOriginal, 5);
    assert.equal(quadros[2].nome, null);

    // O chunk sem `.map` publicado.
    assert.equal(quadros[3].resolvido, false);
    assert.equal(quadros[3].motivo, 'sem-mapa');
  });

  it('mapa CORROMPIDO diz `sem-mapa` COM o motivo, e SEM citar o conteúdo do arquivo', async () => {
    // Sem o motivo, um `.map` que virou página de 404 no proxy se lê como `.map` ausente, e o
    // operador vai procurar build sem sourcemap em vez de olhar o servidor de arquivos. Mas a
    // mensagem nativa do `JSON.parse` CITA o começo do arquivo (`Unexpected token '<',
    // "<html>404..."`), e essa saída acaba colada em relatório: o caminho basta.
    const dir = buildCom('1.0.0+ab12cd', { mapaPodre: true });
    const quadros = await resolverQuadros(analisarPilha(RASTRO), dir, resolver);
    assert.equal(quadros[1].resolvido, false);
    assert.equal(quadros[1].motivo, 'sem-mapa');
    assert.equal(quadros[1].erroDoMapa, 'não é um source map válido (JSON ilegível)');
    assert.equal(quadros[1].erroDoMapa.includes('html'), false);
    assert.equal(quadros[1].erroDoMapa.includes('404'), false);
    // E o caminho vai junto, que é o que o operador precisa para decidir abrir o arquivo.
    assert.equal(quadros[1].mapa, path.join(dir, 'assets', 'core-Ab12Cd34.js.map'));
  });

  it('posição fora de qualquer segmento é `sem-segmento`, e NÃO cai no vizinho', async () => {
    const dir = buildCom('1.0.0+ab12cd');
    // Coluna 1 do rastro vira 0 do mapa, e a linha gerada 2 só tem segmento a partir da
    // coluna 4: colapsar isto em `sem-mapa` mandaria procurar o arquivo errado, e "aproveitar"
    // o segmento seguinte inventaria uma origem.
    const [quadro] = await resolverQuadros(
      analisarPilha('    at x (https://ebgeo.mil.br/assets/core-Ab12Cd34.js:2:1)'), dir, resolver
    );
    assert.equal(quadro.resolvido, false);
    assert.equal(quadro.motivo, 'sem-segmento');
    assert.equal(typeof quadro.mapa, 'string');
  });

  it('a linha CRUA sobrevive em todos os quadros, resolvidos ou não', async () => {
    // É a evidência de onde a resposta veio: sem ela um mapeamento deslocado é
    // indistinguível de um certo.
    const dir = buildCom('1.0.0+ab12cd');
    const quadros = await resolverQuadros(analisarPilha(RASTRO), dir, resolver);
    assert.equal(quadros.length, 4);
    for (const q of quadros) {
      assert.equal(typeof q.bruta, 'string');
      assert.notEqual(q.bruta, '');
    }
  });
});
