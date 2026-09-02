// Path: tests/unit/diag-pilha-de-defeito.test.js
//
// `resolverPilhaDeDefeito` (`src/modules/diag/pilha.service.js`): a composição que
// `GET /api/v1/diag/defeitos/:id/pilha` serve, e que o comando não tem (lá o desfecho é um
// código de saída e um texto no terminal).
//
// POR QUE ESTE ARQUIVO É UNITÁRIO E NÃO DE INTEGRAÇÃO. O que se prende aqui são os QUATRO
// desfechos negativos, e um deles é "o servidor não declarou `EBGEO_MAPAS_DIR`". `config.js`
// é um singleton congelado na avaliação do módulo, então uma suíte de integração fixa UM valor
// para a variável no processo inteiro e não consegue exercitar os dois lados dela. Aqui o
// diretório entra por argumento, e é por isso que ele entra por argumento: a decisão de onde
// os mapas moram é do controller, e a de o que fazer sem eles é desta função.
//
// A REGRA QUE OS QUATRO DESFECHOS ENCARNAM é a mesma do `resumo`: nada disto é 500. Uma rota
// de diagnóstico que morre porque o servidor não foi configurado, ou porque o relato não trouxe
// a pilha, diz "o diagnóstico quebrou" quando o que houve foi outra coisa — e as providências
// são diferentes e nem sempre de quem está lendo. Daí o motivo em CÓDIGO, e não uma frase só.
//
// CONTROLE NEGATIVO (conferido revertendo cada um):
//  - colapsar os quatro motivos num `disponivel: false` sem código e caem os quatro casos
//    negativos, que é exatamente a informação que separa uma providência da outra;
//  - fazer a função resolver contra a build mais recente quando a release não bate e cai o caso
//    da recusa, que é a peça central do desenho (ver o cabeçalho de `pilha.service.js`);
//  - publicar o quadro CRU de `resolverQuadros` em vez de `quadroPublico` e cai o caso da
//    allowlist, com o caminho absoluto do host aparecendo na resposta;
//  - tirar o filtro `dentroDaRaiz` de `caminhosDoMapa` e cai o caso da travessia;
//  - trocar a ordem das guardas (conferir o diretório antes dos campos do defeito) e cai o caso
//    da precedência, que existe porque "falta configurar o servidor" sobre um defeito sem pilha
//    crua manda mexer no host por nada.

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolverPilhaDeDefeito, MOTIVO_SEM_PILHA } from '../../src/modules/diag/pilha.service.js';

const temporarios = [];
after(() => {
  for (const dir of temporarios) fs.rmSync(dir, { recursive: true, force: true });
});

function pastaTemporaria() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ebgeo-pilha-rota-'));
  temporarios.push(dir);
  return dir;
}

/**
 * A MESMA fixture de source map de `tests/unit/diag-cli-mapa-de-fonte.test.js`, escrita à mão.
 *
 * O `mappings` é uma STRING LITERAL montada a partir das regras do formato, com as respostas
 * calculadas FORA do código que está sendo testado. Gerá-lo com o nosso próprio codificador
 * seria cobertura vazia da pior espécie: passaria verde com as duas metades erradas do mesmo
 * jeito, que é como um erro de convenção de base sobrevive.
 */
const MAPA = {
  version: 3,
  file: 'core-Ab12Cd34.js',
  sources: ['../../src/js/alfa.js', '../../src/js/beta.js'],
  names: ['iniciar', 'parar'],
  mappings: 'AAAAA,UAIE,oBCKIC,oB;IAGND;',
};

const RELEASE = '1.0.0+ab12cd';

const RASTRO = [
  'TypeError: x is not a function',
  '    at iniciar (https://ebgeo.mil.br/assets/core-Ab12Cd34.js:1:31)',
  '    at https://ebgeo.mil.br/assets/core-Ab12Cd34.js:1:11',
  '    at https://ebgeo.mil.br/assets/vendor-Zz99.js:1:4',
].join('\n');

/** Um diretório de RELEASES, como o deploy escreve: uma pasta por build. */
function releasesCom(...builds) {
  const raiz = pastaTemporaria();
  for (const release of builds) {
    const dir = path.join(raiz, release.replace('+', '_'));
    fs.mkdirSync(path.join(dir, 'assets'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'release.json'), JSON.stringify({ release, version: '1.0.0' }));
    fs.writeFileSync(path.join(dir, 'assets', 'core-Ab12Cd34.js.map'), JSON.stringify(MAPA));
  }
  return raiz;
}

const defeito = (campos = {}) => ({
  id: '11111111-1111-1111-1111-111111111111',
  estado: 'aberto',
  mensagem: 'x is not a function',
  stackBruta: RASTRO,
  primeiraRelease: RELEASE,
  ...campos,
});

describe('resolverPilhaDeDefeito: o desfecho POSITIVO', () => {
  it('resolve os quadros contra a build que declara a release', async () => {
    const mapasDir = releasesCom('1.0.0+ff90aa', RELEASE, '1.0.0+7c31de');
    const r = await resolverPilhaDeDefeito({ defeito: defeito(), mapasDir });

    assert.equal(r.disponivel, true);
    assert.equal(r.release, RELEASE);
    assert.equal(r.quadros.length, 4);

    // A primeira linha é a MENSAGEM do erro, não um quadro, e ela sobrevive CRUA em `original`:
    // é o que identifica o erro quando nenhum quadro resolve.
    assert.equal(r.quadros[0].original, 'TypeError: x is not a function');
    assert.equal(r.quadros[0].motivo, 'sem-quadro');
    assert.equal(r.quadros[0].fonte, null);

    // A COLUNA É 0-BASED na saída, como o `--json` do comando e como o próprio formato: o
    // rastro diz 31 (1-based), o mapa responde 6. Um erro de um aqui não levanta nada, devolve
    // o segmento vizinho e com ele OUTRO nome de função, que é o pior desfecho possível.
    assert.equal(r.quadros[1].fonte, 'frontend/src/js/beta.js');
    assert.equal(r.quadros[1].linha, 10);
    assert.equal(r.quadros[1].coluna, 6);
    assert.equal(r.quadros[1].nome, 'parar');
    assert.equal('motivo' in r.quadros[1], false, 'quadro resolvido não carrega motivo');

    assert.equal(r.quadros[2].fonte, 'frontend/src/js/alfa.js');
    assert.equal(r.quadros[2].linha, 5);
    assert.equal(r.quadros[2].nome, null);

    // O chunk sem `.map` publicado: nomeado, e não colapsado com os outros dois motivos.
    assert.equal(r.quadros[3].motivo, 'sem-mapa');
    assert.equal(r.quadros[3].fonte, null);
  });

  it('o quadro publicado é uma ALLOWLIST: nada do sistema de arquivos do host atravessa', async () => {
    // `resolverQuadros` produz `mapa` (caminho ABSOLUTO no host), `erroDoMapa` e `fonteBruta`
    // (o `sources` relativo ao `dist/assets/` da máquina que compilou). Nenhum dos três ajuda
    // quem está do outro lado da rede, e o primeiro é topologia do servidor saindo por uma
    // resposta cuja entrada veio de uma rota ANÔNIMA.
    const mapasDir = releasesCom(RELEASE);
    const r = await resolverPilhaDeDefeito({ defeito: defeito(), mapasDir });

    // A contagem ANTES do laço: coleção vazia daria zero asserções e verde vazio, que é
    // exatamente o modo de falha que este arquivo existe para não ter.
    assert.equal(r.quadros.length, 4);
    for (const q of r.quadros) {
      assert.deepEqual(
        Object.keys(q).filter((k) => !['original', 'fonte', 'linha', 'coluna', 'nome', 'motivo'].includes(k)),
        [], `campo não previsto no quadro publicado: ${JSON.stringify(q)}`
      );
    }
    const serializado = JSON.stringify(r);
    assert.equal(serializado.includes(mapasDir.replace(/\\/g, '\\\\')), false, 'o caminho do host vazou');
    assert.equal(serializado.includes('fonteBruta'), false);
  });
});

describe('resolverPilhaDeDefeito: os QUATRO desfechos negativos', () => {
  it('sem `EBGEO_MAPAS_DIR` (ou com ele apontando para lugar nenhum), o motivo NOMEIA a variável', async () => {
    // O motivo nomeia a VARIÁVEL e nunca o caminho configurado: quem lê é um administrador do
    // outro lado da rede, e o que ele precisa saber é o que configurar, não a topologia do host.
    for (const mapasDir of [undefined, null, '', path.join(os.tmpdir(), `nao-existe-${Date.now()}`)]) {
      const r = await resolverPilhaDeDefeito({ defeito: defeito(), mapasDir });
      assert.equal(r.disponivel, false, `mapasDir=${JSON.stringify(mapasDir)} deveria ser indisponível`);
      assert.equal(r.motivo, MOTIVO_SEM_PILHA.SEM_DIRETORIO);
      assert.match(r.explicacao, /EBGEO_MAPAS_DIR/);
      assert.equal(r.release, RELEASE, 'a release pedida continua no payload');
    }
  });

  it('defeito sem pilha crua diz isso, e NÃO reclama da configuração do servidor', async () => {
    // A ORDEM DAS GUARDAS é o assunto deste caso: com o diretório conferido primeiro, um
    // defeito sem pilha crua responderia "falta configurar EBGEO_MAPAS_DIR", mandando mexer no
    // host por nada. Ele continua sem pilha crua com os mapas todos no lugar.
    const r = await resolverPilhaDeDefeito({ defeito: defeito({ stackBruta: null }), mapasDir: undefined });
    assert.equal(r.disponivel, false);
    assert.equal(r.motivo, MOTIVO_SEM_PILHA.SEM_PILHA_BRUTA);
    assert.match(r.explicacao, /PRIMEIRO avistamento/);
  });

  it('defeito sem a release do primeiro avistamento diz isso, e não "release null"', async () => {
    // Cair na recusa genérica produziria a frase sobre uma build chamada `null`, que manda o
    // operador procurar o que não existe; e passar `null` à busca casaria com qualquer
    // `release.json` que também não declarasse a sua, ou seja, resolveria contra uma build
    // ARBITRÁRIA, que é exatamente o que esta peça existe para não fazer.
    const mapasDir = releasesCom(RELEASE);
    const r = await resolverPilhaDeDefeito({ defeito: defeito({ primeiraRelease: null }), mapasDir });
    assert.equal(r.disponivel, false);
    assert.equal(r.motivo, MOTIVO_SEM_PILHA.SEM_RELEASE);
    assert.equal(r.release, null);
  });

  it('RECUSA quando nenhuma build declara a release, e não resolve contra a vizinha', async () => {
    // A peça central do desenho, e não o caso de erro: contra outra build a resolução NÃO
    // falha. Os chunks têm os mesmos nomes e o `mappings` tem segmentos nas mesmas linhas, e a
    // saída é uma lista de funções e linhas do repositório com cara de resposta. Uma pilha
    // plausível e errada custa mais que pilha nenhuma.
    const mapasDir = releasesCom('1.0.0+ff90aa', '1.0.0+7c31de');
    const r = await resolverPilhaDeDefeito({ defeito: defeito(), mapasDir });
    assert.equal(r.disponivel, false);
    assert.equal(r.motivo, MOTIVO_SEM_PILHA.RELEASE_NAO_ENCONTRADA);
    assert.equal(r.release, RELEASE);
    assert.equal('quadros' in r, false, 'nenhum quadro pode sair de uma recusa');
    // As candidatas do host NÃO viajam: do outro lado da rede não existe caminho digitado para
    // estar errado, e enumerar o disco do servidor é a metade daquela mensagem que é topologia.
    assert.equal(JSON.stringify(r).includes('ff90aa'), false);
  });
});

describe('resolverPilhaDeDefeito: a entrada é HOSTIL por construção', () => {
  it('quadro que sai do diretório da release resolve como `sem-mapa`, sem tocar o disco fora dali', async () => {
    // `defeitos.stack_bruta` é texto livre que chegou pela ÚNICA rota anônima deste servidor,
    // então os endereços dentro dela são escolhidos por quem relata. Sem a fronteira de caminho,
    // um `../../..` produzia um candidato FORA de `EBGEO_MAPAS_DIR`, e dali saíam dois
    // vazamentos: a leitura vira oráculo de existência de arquivo, e o `JSON.parse` que falha
    // punha o começo do conteúdo na mensagem de erro.
    //
    // A ISCA MORA UM NÍVEL ACIMA DA RELEASE, e a distância é o caso inteiro. A build fica em
    // `<mapasDir>/<pasta>/`, então um `assets/../segredo.js` normaliza para DENTRO da release e
    // o caso passaria VERDE com a cerca REMOVIDA, medindo só a ausência do arquivo — cobertura
    // vazia num teste de guarda de travessia. Com DOIS níveis o candidato cai em
    // `<mapasDir>/segredo.js.map`, que EXISTE e é um source map legítimo, e aí o único motivo
    // de o quadro não resolver é `dentroDaRaiz` ter recusado. Conferido revertendo a cerca (o
    // filtro final de `caminhosDoMapa`): o quadro passa a resolver e este caso fica vermelho.
    const mapasDir = releasesCom(RELEASE);
    const fora = path.join(mapasDir, 'segredo.js.map');
    fs.writeFileSync(fora, JSON.stringify(MAPA));

    const travessia = [
      'TypeError: x',
      '    at https://ebgeo.mil.br/assets/../../../../../../etc/passwd:1:1',
      '    at https://ebgeo.mil.br/assets/../../segredo.js:1:11',
    ].join('\n');
    const r = await resolverPilhaDeDefeito({ defeito: defeito({ stackBruta: travessia }), mapasDir });

    assert.equal(r.disponivel, true);
    assert.equal(r.quadros[1].motivo, 'sem-mapa');
    assert.equal(r.quadros[1].fonte, null);
    // O segundo é o caso que separa a guarda real da aparente: o arquivo EXISTE, e mesmo assim
    // não é lido, porque está fora da pasta da release.
    assert.equal(r.quadros[2].motivo, 'sem-mapa');
    assert.equal(r.quadros[2].fonte, null);
    assert.equal(JSON.stringify(r).includes('passwd'), true, 'a linha CRUA continua saindo, e deve');
    assert.equal(JSON.stringify(r).includes('sources'), false, 'nada do conteúdo lido pode sair');
  });

  it('pilha que não é pilha nenhuma responde 200 com quadros `sem-quadro`, e não explode', async () => {
    const mapasDir = releasesCom(RELEASE);
    const r = await resolverPilhaDeDefeito({
      defeito: defeito({ stackBruta: 'isto nao e uma pilha\nnem isto' }), mapasDir,
    });
    assert.equal(r.disponivel, true);
    assert.deepEqual(r.quadros.map((q) => q.motivo), ['sem-quadro', 'sem-quadro']);
  });
});
