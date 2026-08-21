// Path: tests/unit/auditoria-om-do-alvo-censo.test.js
//
// TODO EMISSOR DE TRILHA CUJO ALVO É UM RECURSO CARIMBA A OM DONA.
//
// O modo de falha que este arquivo existe para impedir é o mais silencioso da onda de
// auditoria por OM: um emissor novo (ou um antigo que alguém edite) grava a linha SEM
// `targetOrgId`, ela nasce com a coluna nula, e o produtor daquela OM simplesmente não vê
// aquele evento na tela. Nada fica vermelho, ninguém recebe erro, e o sintoma — "a
// auditoria não mostrou a exclusão do meu tileset" — aparece meses depois, longe da causa.
//
// É a mesma forma do buraco que o censo de auditoria já cobre um nível acima: lá, rota de
// escrita SEM trilha; aqui, trilha com metade do endereço.
//
// DUAS VARREDURAS INDEPENDENTES, e a independência é o ponto:
//
//   1. **A CHAMADA.** Cada `createAudit(` é extraído por BALANCEAMENTO DE PARÊNTESES (não
//      por linha, não por regex guloso): se o texto da chamada nomeia um alvo de RECURSO,
//      ele precisa conter `targetOrgId`. Pega o emissor escrito inline.
//   2. **O RESOLVEDOR.** Cada CHAMADA de `assertAuditTargetTypeOfResource(` /
//      `assertAuditTargetTypeOf(` precisa ter `targetOrgId` no CORPO DA FUNÇÃO em que ela
//      mora. Pega os dois casos que a primeira varredura NÃO pega: o alvo montado num
//      objeto à parte e espalhado na chamada com `...alvo` (a forma da poda) e o alvo
//      guardado numa constante local e usado dentro de um laço (a forma da purga).
//
// O INVENTÁRIO VEM DO VERSIONAMENTO (`git ls-files -co --exclude-standard`), como nos
// outros censos, e pela mesma razão: o emissor escrito há cinco minutos é o que ninguém
// classificou, e com `git ls-files` puro ele ficaria fora até alguém dar `git add`.
//
// O QUE ELE NÃO PRENDE, declarado para não ser lido como mais do que é: que a OM carimbada
// seja a CERTA. Isso é comportamento e mora em `tests/integration/auditoria-por-om.test.js`
// (o recorte), `auditoria-epoca-da-om.test.js` (a OM da época) e
// `auditoria-sv360-delete-tem-om.test.js` (a OM que só a escrita conhece). Um censo verde
// com aqueles ausentes prova só que ninguém deixou de carimbar.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * Os `target_type` que designam um RECURSO de catálogo ou 360 — os únicos que têm OM dona.
 * `USER`, `ATLAS`, `ORG`, `CONFIG` e `ACCESS_GROUP` ficam de fora de propósito: eles não
 * pertencem a OM nenhuma, e carimbar a lotação do ator ali poluiria o filtro por OM com
 * atos que nada têm a ver com o acervo dela.
 *
 * O QUE SE PERDE COM `ATLAS` DE FORA, DECLARADO EM VOZ ALTA porque é um buraco de produto
 * e não um detalhe de implementação: o EMPRÉSTIMO de recurso para atlas
 * (`attachAtlasResource`/`detachAtlasResource`, em `resource-access.service.js`) emite
 * `SHARING_CHANGE` com `targetType: 'ATLAS'` e sem OM, porque o alvo do ato é o atlas.
 * Consequência medida: quando alguém anexa o tileset privado da OM-A ao atlas dele — e o
 * recurso da OM-A passa a emprestar acesso a terceiros —, essa linha cai FORA do recorte
 * do produtor da OM-A, que é justamente quem a investigaria. O dado não se perde
 * (`details` carrega `resourceType`/`resourceId`), mas o filtro por OM não o alcança e a
 * coluna fica em travessão. Fechar isso é carimbar as duas linhas com a OM do recurso
 * EMPRESTADO, o que exige antes decidir se o eixo de OM da trilha responde "o que
 * aconteceu com este atlas" ou "o que aconteceu com o acervo desta OM": hoje ele responde
 * a primeira, e as duas respostas não cabem numa coluna só.
 */
const ALVOS_DE_RECURSO = [
  'BASEMAP', 'DATA_LAYER', 'ANALYSIS_LAYER', 'TILESET', 'SV360_PROJECT',
];

/** Os dois resolvedores que traduzem tipo de recurso em `target_type`. */
const RESOLVEDORES = ['assertAuditTargetTypeOfResource(', 'assertAuditTargetTypeOf('];

/**
 * O fim da funcao que contem o resolvedor: a primeira linha de fechamento na coluna zero.
 *
 * A JANELA DE N LINHAS FOI TENTADA E MEDIDA COMO ERRADA, nas duas direcoes. Com 8 linhas
 * ela acusava `purgeResourceLinks`, cujo carimbo mora dez linhas abaixo do resolvedor
 * (entre eles ficam a leitura da OM e as duas purgas), e afrouxa-la ate caber deixaria o
 * carimbo de um emissor VIZINHO satisfazer a exigencia de outro. O corpo da funcao e a
 * unidade certa: e ela que o autor edita.
 *
 * O TERMINADOR `linhas[fim] !== '}'` ESTAVA ERRADO, e a revisao adversarial mediu onde:
 * `catalog.controller.js` exporta `asyncHandler(async (req, res) => { ... });`, e NENHUMA
 * linha dele e exatamente `}` — o fechamento e `});`. Nos tres sitios daquele arquivo a
 * extracao ia ate o EOF, e ali "o corpo da funcao" virava "o resto do arquivo": o carimbo
 * de um emissor VIZINHO satisfazia a exigencia do outro, que e exatamente o afrouxamento
 * que o paragrafo acima recusa. Medido: um emissor novo sem carimbo, na forma de
 * espalhamento, passava nas DUAS varreduras. O regex cobre as tres formas de fechamento
 * na coluna zero (`}`, `});`, `};`), e o par com `assertFimReal` abaixo transforma a
 * proxima forma nao prevista em vermelho, em vez de silencio.
 * @param {string[]} linhas
 * @param {number} inicio
 * @returns {{corpo: string, fim: number}}
 */
const FECHAMENTO_NA_COLUNA_ZERO = /^\}[)\s]*;?\s*$/;
function corpoAPartirDe(linhas, inicio) {
  let fim = inicio + 1;
  while (fim < linhas.length && !FECHAMENTO_NA_COLUNA_ZERO.test(linhas[fim])) fim += 1;
  return { corpo: linhas.slice(inicio, fim).join('\n'), fim };
}

/** @returns {string[]} Caminhos `.js` de `src/`, relativos a `backend/`. */
function arquivosDeSrc() {
  const saida = execFileSync(
    'git', ['ls-files', '--cached', '--others', '--exclude-standard', '*.js'],
    { cwd: path.join(RAIZ, 'src'), encoding: 'utf8' },
  );
  return saida.split('\n').map((l) => l.trim().replace(/\\/g, '/')).filter(Boolean)
    .map((rel) => `src/${rel}`);
}

/** @param {string} rel @returns {string} */
function fonte(rel) {
  return fs.readFileSync(path.join(RAIZ, rel), 'utf8');
}

/**
 * Extrai o TEXTO de cada chamada `createAudit(...)`, balanceando parênteses.
 *
 * Regex não serve aqui: a chamada tem objetos aninhados, ternários e chamadas dentro
 * (`assertAuditTargetTypeOfResource(t)`), então um `\(([^)]*)\)` corta na primeira
 * parêntese fechada e um guloso engole o arquivo inteiro. A direção do erro do
 * balanceamento é PERDER uma chamada malformada, nunca inventar uma.
 * @param {string} codigo
 * @returns {string[]}
 */
function chamadasDeAudit(codigo) {
  const chamadas = [];
  const marca = 'createAudit(';
  let i = codigo.indexOf(marca);
  while (i !== -1) {
    let profundidade = 0;
    let j = i + marca.length - 1;
    for (; j < codigo.length; j += 1) {
      if (codigo[j] === '(') profundidade += 1;
      else if (codigo[j] === ')') {
        profundidade -= 1;
        if (profundidade === 0) break;
      }
    }
    if (profundidade === 0) chamadas.push(codigo.slice(i, j + 1));
    i = codigo.indexOf(marca, i + marca.length);
  }
  return chamadas;
}

/** Remove comentário (a varredura mede CÓDIGO; prosa que cita o campo não é carimbo). */
const semComentarios = (texto) => texto
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

/**
 * A chamada aponta para um alvo de RECURSO?
 * @param {string} texto
 * @returns {boolean}
 */
function miraRecurso(texto) {
  if (RESOLVEDORES.some((r) => texto.includes(r))) return true;
  return ALVOS_DE_RECURSO.some((a) => texto.includes(`targetType: '${a}'`));
}

describe('Censo da OM do alvo: trilha de recurso carimba a OM dona', () => {
  it('piso: o inventário vem do git e acha emissores de verdade', () => {
    let arquivos;
    try {
      arquivos = arquivosDeSrc();
    } catch (err) {
      assert.fail(
        `o inventário deste censo vem de \`git ls-files\` e o comando FALHOU (${err.message}). `
        + 'Isto é falha de ambiente, não regressão de código: rode dentro do repositório.',
      );
    }
    assert.ok(arquivos.length >= 100, `esperava >= 100 arquivos em src/, achei ${arquivos.length}`);

    const total = arquivos
      .flatMap((rel) => chamadasDeAudit(semComentarios(fonte(rel))))
      .length;
    // Sem este número, um `createAudit(` renomeado deixaria as duas varreduras comparando
    // conjunto vazio com conjunto vazio — verde perfeito sobre nada.
    assert.ok(total >= 25, `esperava >= 25 chamadas de createAudit em src/, achei ${total}`);
  });

  it('VARREDURA 1: toda chamada que mira um RECURSO carimba `targetOrgId`', () => {
    const arquivos = arquivosDeSrc();
    const faltando = [];
    let miram = 0;
    for (const rel of arquivos) {
      for (const chamada of chamadasDeAudit(semComentarios(fonte(rel)))) {
        if (!miraRecurso(chamada)) continue;
        miram += 1;
        if (!chamada.includes('targetOrgId')) {
          const acao = chamada.match(/action: '([A-Z_]+)'/)?.[1] ?? '(ação não literal)';
          faltando.push(`${rel} :: ${acao}`);
        }
      }
    }
    assert.ok(
      miram >= 8,
      `guarda: só ${miram} chamadas miram recurso — o predicado de mira quebrou e o resto seria vácuo`,
    );
    assert.deepEqual(
      faltando, [],
      'emissor de trilha com alvo de RECURSO e sem `targetOrgId`: a linha nasce com a coluna nula '
      + 'e o produtor daquela OM nunca vê o evento, sem erro em lugar nenhum',
    );
  });

  it('VARREDURA 2: todo resolvedor de alvo de recurso tem o carimbo por perto', () => {
    // A porta dos fundos da varredura 1: o alvo montado num objeto à parte e espalhado na
    // chamada (`...alvo`), que é a forma da poda. Ali a chamada NÃO contém `targetType`, e
    // sem esta segunda passada a omissão passaria despercebida.
    const arquivos = arquivosDeSrc();
    const faltando = [];
    const semFechamento = [];
    let achados = 0;
    for (const rel of arquivos) {
      const linhas = semComentarios(fonte(rel)).split('\n');
      for (let i = 0; i < linhas.length; i += 1) {
        if (!RESOLVEDORES.some((r) => linhas[i].includes(r))) continue;
        // A DEFINICAO da funcao nao e um sitio de emissao, e cobrar carimbo dela seria
        // acusar o proprio resolvedor de nao carimbar a si mesmo. A varredura mede
        // CHAMADA, e a assinatura e o unico lugar onde o nome aparece sem ser chamada.
        if (/function\s+assertAuditTargetType/.test(linhas[i])) continue;
        achados += 1;
        const { corpo, fim } = corpoAPartirDe(linhas, i);
        // GUARDA DO GUARDA: extracao que alcanca o EOF nao delimitou funcao nenhuma, e
        // e nesse estado que o carimbo de um emissor vizinho satisfaz outro. Ela e
        // REPROVADA em vez de aceita, porque a direcao segura do erro aqui e o vermelho.
        if (fim >= linhas.length) semFechamento.push(`${rel} :: ${linhas[i].trim()}`);
        if (!corpo.includes('targetOrgId')) faltando.push(`${rel} :: ${linhas[i].trim()}`);
      }
    }
    assert.ok(achados >= 5, `guarda: só ${achados} resolvedores achados; a varredura quebrou`);
    assert.deepEqual(
      semFechamento, [],
      'a extração do corpo alcançou o FIM DO ARQUIVO: `corpoAPartirDe` não reconheceu o '
      + 'fechamento desta função, e sem delimitação a varredura aceita o carimbo do emissor '
      + 'vizinho. Ensine a forma nova ao terminador em vez de afrouxar a exigência',
    );
    assert.deepEqual(
      faltando, [],
      'alvo de recurso resolvido sem `targetOrgId` na mesma vizinhança',
    );
  });

  it('a varredura REPROVA um emissor novo sem carimbo (provado, não afirmado)', () => {
    // Um guarda que afirma sobre si mesmo não é guarda. O texto abaixo é a forma exata de
    // um emissor real, com e sem o campo.
    const semCarimbo = `await createAudit(req, {
      action: 'CATALOG_UPDATE',
      actorId: actor.id,
      targetType: assertAuditTargetTypeOfResource(t),
      targetId: resourceId,
      details: { resourceType: t },
    }, trx);`;
    const comCarimbo = semCarimbo.replace(
      'targetId: resourceId,', 'targetId: resourceId,\n      targetOrgId: ownerOrgId,',
    );

    const extraidas = chamadasDeAudit(semCarimbo);
    assert.equal(extraidas.length, 1, 'o balanceamento precisa extrair a chamada inteira');
    assert.ok(miraRecurso(extraidas[0]), 'a fixture precisa ser reconhecida como mira de recurso');
    assert.ok(!extraidas[0].includes('targetOrgId'), 'a fixture SEM carimbo seria acusada');
    assert.ok(
      chamadasDeAudit(comCarimbo)[0].includes('targetOrgId'),
      'e a fixture COM carimbo passaria — sem esta metade o teste acusaria tudo',
    );

    // E a mira NÃO pode ser larga demais: um emissor de USER (que não tem OM dona) não
    // pode ser cobrado do carimbo, senão o censo empurraria a lotação do ator para dentro
    // da coluna e poluiria o filtro por OM.
    const deConta = `await createAudit(req, {
      action: 'USER_UPDATE', actorId: userId, targetType: 'USER', targetId: userId,
    });`;
    assert.ok(!miraRecurso(chamadasDeAudit(deConta)[0]), 'alvo sem OM dona não é cobrado');
  });

  it('a VARREDURA 2 reprova o emissor por ESPALHAMENTO dentro de `asyncHandler`', () => {
    // A fixture do caso acima exercita só a varredura 1 (a chamada literal). Esta
    // exercita a 2, e na forma exata que a revisão adversarial usou para provar o buraco:
    // um emissor num arquivo cujo export é `asyncHandler(async (req, res) => { ... });`,
    // onde NENHUMA linha é exatamente `}` e a extração antiga ia até o fim do arquivo.
    const cabecalho = [
      'export const remove = (table) => asyncHandler(async (req, res) => {',
      '  const alvo = {',
      '    targetType: assertAuditTargetTypeOf(table),',
      '    targetId: row.id,',
      '    targetOrgId: row.owner_org_id,',
      '  };',
      '  await createAudit(req, { action: \'CATALOG_DELETE\', actorId: req.user.id, ...alvo });',
      '  res.status(204).end();',
      '});',
      '',
    ];
    const semCarimbo = [
      'export const publicar = (table) => asyncHandler(async (req, res) => {',
      '  const alvo = {',
      '    targetType: assertAuditTargetTypeOf(table),',
      '    targetId: row.id,',
      '  };',
      '  await createAudit(req, { action: \'CATALOG_UPDATE\', actorId: req.user.id, ...alvo });',
      '  res.json({ data: row });',
      '});',
    ];

    /** A varredura 2, aplicada a um texto. @returns {{acusados: number, eof: number}} */
    const varrer = (linhas) => {
      let acusados = 0;
      let eof = 0;
      for (let i = 0; i < linhas.length; i += 1) {
        if (!RESOLVEDORES.some((r) => linhas[i].includes(r))) continue;
        const { corpo, fim } = corpoAPartirDe(linhas, i);
        if (fim >= linhas.length) eof += 1;
        if (!corpo.includes('targetOrgId')) acusados += 1;
      }
      return { acusados, eof };
    };

    // O PISO: sozinho, o emissor COM carimbo passa. Sem esta metade, um terminador que
    // acusasse tudo daria o mesmo verde no caso de baixo.
    assert.deepEqual(varrer(cabecalho), { acusados: 0, eof: 0 }, 'o emissor com carimbo passa');

    // E O ATO: o emissor novo SEM carimbo, colado ACIMA de um que carimba, é acusado.
    // A ORDEM É O PONTO, e ela é a que a revisão adversarial usou: com o terminador
    // antigo a extração do PRIMEIRO alcançava o EOF, e o `targetOrgId` do emissor
    // vizinho, dez linhas abaixo, satisfazia a exigência dele.
    const juntos = [...semCarimbo, '', ...cabecalho];
    assert.deepEqual(
      varrer(juntos), { acusados: 1, eof: 0 },
      'emissor por espalhamento sem carimbo precisa ser ACUSADO, e nenhuma extração pode '
      + 'alcançar o fim do arquivo',
    );

    // A prova do terminador antigo, para que a regressão tenha nome: com `!== \'}\'` o
    // mesmo texto dá zero acusados, porque a extração engole o arquivo inteiro.
    const antigo = (linhas, inicio) => {
      let fim = inicio + 1;
      while (fim < linhas.length && linhas[fim] !== '}') fim += 1;
      return linhas.slice(inicio, fim).join('\n');
    };
    let acusadosAntigos = 0;
    for (let i = 0; i < juntos.length; i += 1) {
      if (!RESOLVEDORES.some((r) => juntos[i].includes(r))) continue;
      if (!antigo(juntos, i).includes('targetOrgId')) acusadosAntigos += 1;
    }
    assert.equal(
      acusadosAntigos, 0,
      'controle: o terminador antigo NÃO acusava — é o vácuo que este caso fecha',
    );
  });
});
