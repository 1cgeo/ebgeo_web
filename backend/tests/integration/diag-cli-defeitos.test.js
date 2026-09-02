// Path: tests/integration/diag-cli-defeitos.test.js
//
// `npm run diag -- defeitos` e `npm run diag -- pilha` contra o BANCO DE VERDADE, dirigindo
// `scripts/diag.js` por `spawnSync` (o arquivo chama `main()` na avaliação do módulo).
//
// POR QUE INTEGRAÇÃO E NÃO UNIDADE. Estes dois comandos existem para reusar `listarDefeitos`
// e o SQL do módulo `diag`, e é exatamente essa junção que pode quebrar sem ninguém notar:
// um filtro que chega ao driver como `undefined` faz `NOT $6::boolean` avaliar NULL e devolve
// ZERO LINHAS, calado (o cabeçalho de `listarDefeitos` diz isso por extenso). Um duplo de
// teste do serviço passaria verde sobre esse defeito, porque o defeito está no encontro entre
// o argumento e o Postgres, e não na função.
//
// TODO CASO É RECORTADO POR UMA `pagina` ÚNICA, e não pela janela: a suíte inteira compartilha
// o banco, então "os defeitos das últimas 24h" inclui o que outro arquivo escreveu. Filtrar
// pela página que este arquivo inventou é o que torna as contagens ABSOLUTAS, e contagem
// absoluta é a única que reprova quando o filtro para de filtrar.
//
// CONTROLE NEGATIVO (conferido revertendo cada um):
//   - passar `novos: op.novos` como `undefined` em vez de booleano e o caso de `--novos` passa
//     a devolver zero linhas, que é o modo de falha CALADO que o comentário do serviço teme;
//   - fazer `localizarReleaseDeMapas` cair na primeira candidata quando não há casamento e o
//     caso da release trocada passa a sair com 0 e uma pilha PLAUSÍVEL E ERRADA, que é o
//     desfecho que o comando existe para recusar;
//   - tirar o `pgp.end()` do `finally` e os casos travam no timeout em vez de responder;
//   - tirar a validação de uuid da borda e o caso do id malformado troca a frase do comando
//     por um `22P02` do driver.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';

const COMANDO = fileURLToPath(new URL('../../scripts/diag.js', import.meta.url));
const MARCA = randomUUID().slice(0, 8);
const PAGINA = `diagcli-${MARCA}`;
const RELEASE_CERTA = `9.9.9+${MARCA}`;
const RELEASE_OUTRA = `9.9.9+outra${MARCA}`;

/**
 * A MESMA fixture de source map de `tests/unit/diag-cli-mapa-de-fonte.test.js`, escrita à mão.
 * A conta de cada segmento está no cabeçalho de lá; aqui interessa só a resposta: a coluna 30
 * da linha gerada 1 resolve para `../../src/js/beta.js`, linha 10, coluna 6, nome `parar`.
 */
const MAPA = {
  version: 3,
  file: 'core-Ab12Cd34.js',
  sources: ['../../src/js/alfa.js', '../../src/js/beta.js'],
  names: ['iniciar', 'parar'],
  mappings: 'AAAAA,UAIE,oBCKIC,oB;IAGND;',
};

const PILHA_CRUA = [
  'TypeError: x is not a function',
  '    at iniciar (https://ebgeo.mil.br/assets/core-Ab12Cd34.js:1:31)',
  '    at https://ebgeo.mil.br/assets/core-Ab12Cd34.js:1:11',
].join('\n');

const temporarios = [];

/**
 * Roda o comando num processo filho, COM PRAZO.
 *
 * O `timeout` não é zelo: estes dois comandos abrem um pool do Postgres, e um pool que não
 * feche prende o filho para sempre. Sem prazo, o `spawnSync` bloqueia e leva a rodada
 * INTEIRA junto, sem timeout de caso e sem uma linha que aponte para a causa. Aconteceu na
 * primeira versão deste lote: cinco minutos parados, saída vazia, e o sintoma se lia como
 * "o banco está fora".
 *
 * `r.signal` é asserido porque `status` vem `null` quando o filho é MORTO, e um `null`
 * comparado com um código esperado reprova por um motivo que não é o do caso. Falhar
 * nomeando o sinal transforma o travamento em diagnóstico.
 */
function rodar(args) {
  const r = spawnSync(process.execPath, [COMANDO, ...args], {
    encoding: 'utf8', env: process.env, timeout: 30_000, killSignal: 'SIGKILL',
  });
  assert.equal(r.signal, null, `o comando foi morto por ${r.signal}: pool vazado ou consulta presa`);
  return { codigo: r.status, saida: r.stdout || '', erro: r.stderr || '' };
}

function documento(args) {
  const r = rodar([...args, '--json']);
  return { ...r, doc: JSON.parse(r.saida) };
}

/** Uma build no disco, com `release.json` na raiz e o `.map` sob `assets/`. */
function buildCom(release) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ebgeo-build-'));
  temporarios.push(dir);
  fs.writeFileSync(path.join(dir, 'release.json'), JSON.stringify({ release, version: '9.9.9' }));
  fs.mkdirSync(path.join(dir, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'assets', 'core-Ab12Cd34.js.map'), JSON.stringify(MAPA));
  return dir;
}

describe('diag CLI: defeitos e pilha contra o banco', () => {
  let db;
  let idAberto;
  let idResolvido;
  let idAntigo;
  let idSemRelease;

  /** Escreve um defeito direto no banco, com controle sobre as colunas que a rota deriva. */
  async function inserirDefeito({
    nome, estado = 'aberto', origem = 'store', stackBruta = null, diasDeIdade = 0,
    release = RELEASE_CERTA,
  }) {
    const { rows } = await db.query(
      `INSERT INTO defeitos
         (assinatura, mensagem, pagina, url, release, origem, stack_bruta, ocorrencias,
          primeira_release, ultima_release, estado, primeira_em, ultima_em)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $5, $5, $9,
               NOW() - ($10::int * INTERVAL '1 day'), NOW())
       RETURNING id`,
      [
        `TypeError | ${nome} | ${MARCA}`,
        `mensagem de ${nome}`,
        PAGINA,
        'https://ebgeo.mil.br/index.html',
        release,
        origem,
        stackBruta,
        7,
        estado,
        diasDeIdade,
      ]
    );
    return rows[0].id;
  }

  before(async () => {
    const env = await setupTestEnv();
    db = env.db;

    idAberto = await inserirDefeito({ nome: 'aberto', stackBruta: PILHA_CRUA });
    idResolvido = await inserirDefeito({ nome: 'resolvido', estado: 'resolvido', origem: 'maplibre' });
    // Nascido há dez dias e ainda ocorrendo: é o defeito CRÔNICO, que a janela alcança por
    // `ultima_em` e o `--novos` precisa excluir.
    idAntigo = await inserirDefeito({ nome: 'antigo', diasDeIdade: 10 });
    // `release` é opcional no relato do cliente, então `primeira_release` nula é uma linha
    // real da tabela, e não um caso construído: ela tem pilha crua e não tem contra o que
    // lê-la.
    idSemRelease = await inserirDefeito({ nome: 'sem-release', release: null, stackBruta: PILHA_CRUA });

    await db.query(
      `INSERT INTO defeito_ocorrencias
         (defeito_id, em, release, sessao_id, pagina, url, origem, migalhas, req_id, rota, status_code)
       VALUES ($1, NOW(), $2, $3, $4, $5, 'store', $6, $7, 'POST /atlas/:id/sync', 400)`,
      [
        idAberto,
        RELEASE_CERTA,
        randomUUID(),
        PAGINA,
        'https://ebgeo.mil.br/index.html',
        JSON.stringify([
          { t: 1_788_000_000_000, tipo: 'navegacao', texto: 'abriu o atlas' },
          { t: 1_788_000_000_450, tipo: 'clique', texto: 'botão salvar' },
        ]),
        `req-${MARCA}`,
      ]
    );
  });

  after(async () => {
    await db.query('DELETE FROM defeitos WHERE pagina = $1', [PAGINA]);
    for (const dir of temporarios) fs.rmSync(dir, { recursive: true, force: true });
    await teardownTestEnv(db);
  });

  it('lista os defeitos da janela, com o total de ANTES do corte', () => {
    const { codigo, doc } = documento(['defeitos', '--pagina', PAGINA, '--desde', '30d']);
    assert.equal(codigo, 0);
    assert.equal(doc.comando, 'defeitos');
    assert.equal(doc.totalDefeitos, 4);
    assert.equal(doc.itens.length, 4);
    assert.deepEqual(doc.filtros.pagina, PAGINA);
    // As colunas do lote B saem inteiras, e não só as da listagem transitória.
    const aberto = doc.itens.find((d) => d.id === idAberto);
    assert.equal(aberto.estado, 'aberto');
    assert.equal(aberto.origem, 'store');
    assert.equal(aberto.ocorrencias, 7);
    assert.equal(aberto.primeiraRelease, RELEASE_CERTA);
    assert.equal(aberto.ultimaRelease, RELEASE_CERTA);
    assert.equal(typeof aberto.primeiraEm, 'number');
  });

  it('`--limite` corta a lista e o total continua sendo o de antes do corte', () => {
    const { doc } = documento(['defeitos', '--pagina', PAGINA, '--desde', '30d', '--limite', '1']);
    assert.equal(doc.itens.length, 1);
    assert.equal(doc.totalDefeitos, 4);
    assert.equal(doc.filtros.limite, 1);
  });

  it('`--estado` e `--origem` estreitam de verdade', () => {
    const porEstado = documento(['defeitos', '--pagina', PAGINA, '--desde', '30d', '--estado', 'resolvido']).doc;
    assert.equal(porEstado.itens.length, 1);
    assert.equal(porEstado.itens[0].id, idResolvido);

    const porOrigem = documento(['defeitos', '--pagina', PAGINA, '--desde', '30d', '--origem', 'maplibre']).doc;
    assert.equal(porOrigem.itens.length, 1);
    assert.equal(porOrigem.itens[0].id, idResolvido);

    // TRÊS e não quatro: o defeito de `primeira_release` nula não tem `release` para casar,
    // e o filtro é igualdade. É o desfecho certo, e a asserção absoluta é o que prova que o
    // filtro filtra em vez de deixar passar tudo.
    const porRelease = documento(['defeitos', '--pagina', PAGINA, '--desde', '30d', '--release', RELEASE_CERTA]).doc;
    assert.equal(porRelease.itens.length, 3);
  });

  it('`--novos` exclui o CRÔNICO, e a janela sozinha o inclui', () => {
    // É o caso que o `novos === true` do serviço protege: chegando `undefined` ao driver, o
    // `NOT $6::boolean` avalia NULL e a lista sai VAZIA sem erro nenhum.
    const semNovos = documento(['defeitos', '--pagina', PAGINA, '--desde', '2d']).doc;
    assert.equal(semNovos.totalDefeitos, 4);
    assert.ok(semNovos.itens.some((d) => d.id === idAntigo), 'a janela por `ultima_em` perdeu o crônico');

    const comNovos = documento(['defeitos', '--pagina', PAGINA, '--desde', '2d', '--novos']).doc;
    assert.equal(comNovos.filtros.novos, true);
    assert.equal(comNovos.totalDefeitos, 3);
    assert.equal(comNovos.itens.some((d) => d.id === idAntigo), false);
  });

  it('a saída HUMANA da lista tem a tabela, o total e o ponteiro para o detalhe', () => {
    const { codigo, saida } = rodar(['defeitos', '--pagina', PAGINA, '--desde', '30d']);
    assert.equal(codigo, 0);
    assert.match(saida, /4 defeito\(s\) na janela/);
    assert.match(saida, /estado\s+ocorr/);
    assert.match(saida, /aberto/);
    // O id sai CURTO na tabela: ele serve ao olho, e `--id` exige o uuid inteiro.
    assert.match(saida, new RegExp(idAberto.slice(0, 8)));
    assert.match(saida, /defeitos --id <uuid>/);
  });

  it('`--id` traz o defeito com as ocorrências e as migalhas', () => {
    const { codigo, doc } = documento(['defeitos', '--id', idAberto]);
    assert.equal(codigo, 0);
    // Sem janela: a pergunta é sobre UMA linha achada por id, e uma janela inventada de 24h
    // se leria como recorte que não existe.
    assert.equal(doc.janela, null);
    assert.equal(doc.defeito.id, idAberto);
    assert.equal(doc.defeito.stackBruta, PILHA_CRUA);
    assert.equal(doc.ocorrencias.length, 1);
    assert.equal(doc.ocorrencias[0].rota, 'POST /atlas/:id/sync');
    assert.equal(doc.ocorrencias[0].statusCode, 400);
    assert.equal(doc.ocorrencias[0].reqId, `req-${MARCA}`);
    assert.equal(doc.ocorrencias[0].migalhas.length, 2);
    assert.equal(doc.ocorrencias[0].migalhas[1].texto, 'botão salvar');
  });

  it('o MESMO defeito tem o mesmo shape pela lista e por `--id`', () => {
    // A DUPLICAÇÃO QUE MOTIVOU ESTE CASO ACABOU: `SELECT_DEFEITO_POR_ID` mudou de casa para
    // `src/modules/diag/defeitos.queries.js` e o mapeamento passou a ser UM
    // (`itemDeDefeitoCompleto`, servindo `listarDefeitos` e `obterDefeito`). O caso FICA, e
    // é mais forte agora do que era como remendo: ele afirma a propriedade de SAÍDA que o
    // agente usa (os dois comandos descrevem o mesmo defeito do mesmo jeito) sem depender de
    // como ela é obtida por dentro, então ele sobrevive à próxima reorganização e continua
    // pegando o caso real: coluna nova em `LIST_DEFEITOS` que não entre em
    // `SELECT_DEFEITO_POR_ID` aparece como campo faltando, e não como `undefined` numa tela.
    const daLista = documento(['defeitos', '--pagina', PAGINA, '--desde', '30d']).doc
      .itens.find((d) => d.id === idAberto);
    const doId = documento(['defeitos', '--id', idAberto]).doc.defeito;
    assert.equal(typeof daLista, 'object');
    assert.notEqual(daLista, null);
    assert.deepEqual(Object.keys(doId).sort(), Object.keys(daLista).sort());
    // E o conteúdo também: mesmo id, mesmo shape e mesmos valores é o que faz um agente
    // poder trocar um pelo outro sem reler a documentação.
    assert.deepEqual(doId, daLista);
  });

  it('a saída HUMANA do detalhe põe as migalhas em linha do tempo com horário local', () => {
    const { codigo, saida } = rodar(['defeitos', '--id', idAberto]);
    assert.equal(codigo, 0);
    assert.match(saida, /migalhas:/);
    assert.match(saida, /abriu o atlas/);
    assert.match(saida, /botão salvar/);
    // Horário local com milissegundos: duas migalhas do mesmo gesto caem no mesmo segundo, e
    // a ordem é a informação.
    assert.match(saida, /\d{2}\/\d{2}\/\d{4}, \d{2}:\d{2}:\d{2}\.\d{3}/);
    assert.match(saida, /pilha crua/);
  });

  it('id inexistente e id malformado saem com 1 e frase do comando, não erro de driver', () => {
    const inexistente = rodar(['defeitos', '--id', randomUUID()]);
    assert.equal(inexistente.codigo, 1);
    assert.match(inexistente.erro, /Nenhum defeito com id/);

    // Sem a validação na borda isto viraria um `22P02` sobre sintaxe de entrada para uuid,
    // sem relação aparente com o argumento digitado.
    const malformado = rodar(['defeitos', '--id', 'nao-e-uuid']);
    assert.equal(malformado.codigo, 1);
    assert.match(malformado.erro, /--id não é um uuid/);
    assert.equal(malformado.erro.includes('22P02'), false);
  });

  it('pilha: desminifica contra a build que declara a release do PRIMEIRO avistamento', () => {
    const dir = buildCom(RELEASE_CERTA);
    const { codigo, doc } = documento(['pilha', '--id', idAberto, '--mapas', dir]);
    assert.equal(codigo, 0);
    assert.equal(doc.release, RELEASE_CERTA);
    assert.equal(doc.diretorio, dir);
    assert.equal(doc.quadros.length, 3);
    assert.equal(doc.quadros[0].motivo, 'sem-quadro');
    assert.equal(doc.quadros[1].resolvido, true);
    assert.equal(doc.quadros[1].fonte, 'frontend/src/js/beta.js');
    assert.equal(doc.quadros[1].linhaOriginal, 10);
    assert.equal(doc.quadros[1].colunaOriginal, 6);
    assert.equal(doc.quadros[1].nome, 'parar');
    assert.equal(doc.quadros[2].fonte, 'frontend/src/js/alfa.js');
    assert.equal(doc.quadros[2].linhaOriginal, 5);
  });

  it('pilha humana imprime o quadro original E o cru embaixo dele', () => {
    // O cru é a evidência de onde a resposta veio: sem ele um mapeamento deslocado é
    // indistinguível de um certo, e esta saída é do tipo que se copia para um relatório.
    const dir = buildCom(RELEASE_CERTA);
    const { codigo, saida } = rodar(['pilha', '--id', idAberto, '--mapas', dir]);
    assert.equal(codigo, 0);
    // A COLUNA HUMANA É 1-BASED (`colunaOriginal` é 6 no `--json`, e sai 7 aqui): a linha já
    // sai 1-based, e imprimir a coluna crua ao lado dela daria uma referência com dois
    // sistemas de contagem, que um editor abre na coluna errada.
    assert.match(saida, /frontend\/src\/js\/beta\.js:10:7 \(parar\)/);
    assert.match(saida, /core-Ab12Cd34\.js:1:31/);
  });

  it('pilha RECUSA quando nenhuma build declara a release: código 2 e a pilha crua', () => {
    // A peça central. Os arquivos de outra build têm os mesmos nomes e o `mappings` tem
    // segmentos nas mesmas linhas, então resolver ali NÃO falha: devolve funções e linhas
    // plausíveis e ERRADAS.
    const dir = buildCom(RELEASE_OUTRA);
    const humano = rodar(['pilha', '--id', idAberto, '--mapas', dir]);
    assert.equal(humano.codigo, 2);
    assert.match(humano.erro, /NENHUMA BUILD SOB/);
    assert.match(humano.erro, /plausíveis e ERRADAS/);
    assert.match(humano.erro, new RegExp(RELEASE_OUTRA.replace('+', '\\+')));
    assert.match(humano.saida, /TypeError: x is not a function/);

    const json = documento(['pilha', '--id', idAberto, '--mapas', dir]);
    assert.equal(json.codigo, 2);
    assert.equal(json.doc.diretorio, null);
    assert.equal(json.doc.recusa.motivo, 'release-nao-encontrada');
    assert.equal(json.doc.candidatas.length, 1);
    assert.equal(json.doc.candidatas[0].release, RELEASE_OUTRA);
    assert.equal(json.doc.stackBruta, PILHA_CRUA);
  });

  it('pilha sobre defeito SEM pilha crua diz isso, em vez de resolver nada', () => {
    const dir = buildCom(RELEASE_CERTA);
    const r = rodar(['pilha', '--id', idResolvido, '--mapas', dir]);
    assert.equal(r.codigo, 1);
    assert.match(r.erro, /não tem pilha crua/);
    assert.equal(r.saida, '');
  });

  it('pilha sobre defeito com `primeira_release` NULA nomeia essa condição, e sai com 1', () => {
    // `release` é opcional no relato, então esta linha existe de verdade. Sem ramo próprio
    // ela caía na recusa genérica e a frase dizia DECLARA A RELEASE "null", mandando o
    // operador procurar uma build chamada null; e a busca com `null` casaria com qualquer
    // `release.json` que também não declarasse a sua, resolvendo contra build arbitrária.
    // O código é 1 e não 2: o 2 significa "a build não está aqui", e aqui falta o DADO.
    const dir = buildCom(RELEASE_CERTA);
    const r = rodar(['pilha', '--id', idSemRelease, '--mapas', dir]);
    assert.equal(r.codigo, 1);
    assert.match(r.erro, /não tem release do primeiro avistamento/);
    assert.equal(r.erro.includes('null"'), false, 'ainda anuncia uma build chamada null');
    assert.equal(r.saida, '');
  });
});
