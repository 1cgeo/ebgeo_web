// Path: tests/unit/atlas-shares-eixo-de-grupo-censo.test.js
//
// O CENSO DOS LEITORES DE `atlas_shares`, e ele existe por uma razão só: sem ele, esta
// onda conserta CINCO sítios e não conserta a CLASSE.
//
// O DEFEITO QUE ELE IMPEDE. Desde 2026-08-21 um share tem como alvo uma PESSOA **ou** um
// GRUPO. Toda consulta que resolva acesso lendo `WHERE user_id = $x` continua compilando,
// continua devolvendo linhas e continua parecendo certa — só deixa de enxergar metade do
// eixo. Ninguém recebe erro; um membro por grupo simplesmente não entra, ou entra e cai no
// próximo heartbeat. É a lista fechada da constituição na forma de SQL.
//
// AS DUAS VARREDURAS, e a independência entre elas é o ponto:
//
//   1. CLASSIFICAÇÃO — toda linha de CÓDIGO (comentário removido) de `src/**/*.js` que
//      mencione `atlas_shares`, `fn_user_atlas_shares` ou `fn_atlas_member_ids` precisa de
//      uma entrada no CENSO, com a CONTAGEM exata. Apagar cópia também reprova: a
//      igualdade é dos dois lados.
//   2. FORMA PROIBIDA — todo trecho que leia `permission` DE `atlas_shares` num SELECT é
//      acusado, esteja ou não no censo. É a única varredura com dente próprio: a
//      classificação pega quem escreve consulta nova sem declarar, e esta pega quem
//      escreve a consulta ERRADA e declara.
//
// O INVENTÁRIO VEM DO GIT com `--cached --others --exclude-standard`, pelo motivo que os
// quatro censos irmãos já pagaram: `git ls-files` puro lista só o rastreado, e o arquivo
// que a fase corrente acabou de escrever é exatamente o que ninguém classificou ainda.
//
// O QUE ELE NÃO PRENDE: comportamento. Que a resolução por grupo funcione é
// `tests/integration/atlas-share-por-grupo.test.js` e `tests/ws/collab-reauthz-grupo.test.js`.
// Verde aqui prova só que ninguém abriu porta nova sem declarar.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** Resolve acesso pela função única. É a classe que se QUER ver. */
const C_FUNCAO = 'resolve-pela-funcao-unica';
/** Escreve na tabela (INSERT/UPDATE/DELETE). Não decide acesso de ninguém. */
const C_ESCRITA = 'escrita';
/** Lê a tabela para outra pergunta que não "quem alcança este atlas". Exige motivo. */
const C_NAO_RESOLVE = 'leitura-que-nao-resolve';
/** PROIBIDA. Nenhuma entrada pode carregá-la depois desta onda. */
const C_RESOLUCAO_DIRETA = 'resolucao-direta';

const fn = (arquivo, trecho, n = 1) => ({ arquivo, trecho, classe: C_FUNCAO, n });
const esc = (arquivo, trecho, n = 1) => ({ arquivo, trecho, classe: C_ESCRITA, n });
const naoResolve = (arquivo, trecho, motivo, n = 1) =>
  ({ arquivo, trecho, classe: C_NAO_RESOLVE, motivo, n });

/**
 * O CENSO. Uma entrada por TRECHO distinto, com quantas vezes ele aparece no arquivo.
 *
 * `trecho` é o começo da linha de código, normalizado (espaços colapsados). Casar por
 * prefixo, e não por igualdade, é o que deixa a linha ser reindentada sem falso vermelho;
 * casar por PREFIXO exige que o começo do statement continue o mesmo, que é a parte que
 * importa.
 */
const CENSO = [
  // ---- a função única ---------------------------------------------------------------
  // CINCO destas entradas DECIDEM ACESSO (os dois gates e as três listagens de atlas); a
  // sexta, `EFFECTIVE_PERMISSIONS`, decide o que a FRAME de compartilhamento anuncia. A
  // distinção importa: nas cinco primeiras, ler metade do eixo é acesso perdido ou dado a
  // mais; na sexta, é a interface mentindo sobre um nível que o servidor nunca mudou.
  fn('src/middleware/permissions.js', '`SELECT permission FROM fn_user_atlas_shares('),
  fn('src/modules/collab/collab.gateway.js', "'SELECT permission FROM fn_user_atlas_shares("),
  fn('src/modules/atlas/atlas.queries.js', 'LEFT JOIN fn_user_atlas_shares($1::uuid) us ON us.atlas_id = a.id', 3),
  fn('src/modules/atlas/atlas.queries.js', '1 + (SELECT COUNT(*) FROM fn_atlas_member_ids(a.id) mc'),
  fn('src/modules/atlas/atlas.queries.js', 'FROM fn_atlas_member_ids(a.id) ms'),
  fn('src/modules/sharing/sharing.queries.js', 'LEFT JOIN LATERAL (SELECT permission FROM fn_user_atlas_shares(m.uid, $1::uuid)) us ON true'),

  // ---- escrita ---------------------------------------------------------------------
  esc('src/database/seed.js', 'INSERT INTO atlas_shares (atlas_id, user_id, permission, added_by)'),
  esc('src/modules/atlas/atlas.service.js', '`DELETE FROM atlas_shares WHERE atlas_id = $1 AND user_id = $2`,'),
  esc('src/modules/atlas/atlas.service.js', '`INSERT INTO atlas_shares (atlas_id, user_id, permission, added_by)'),
  esc('src/modules/sharing/sharing.queries.js', 'INSERT INTO atlas_shares (atlas_id, user_id, permission, added_by)'),
  esc('src/modules/sharing/sharing.queries.js', 'INSERT INTO atlas_shares (atlas_id, group_id, permission, added_by)'),
  esc('src/modules/sharing/sharing.queries.js', 'UPDATE atlas_shares s', 2),
  esc('src/modules/sharing/sharing.queries.js', 'FROM atlas_shares prev', 2),
  esc('src/modules/sharing/sharing.queries.js', 'DELETE FROM atlas_shares', 2),
  esc('src/modules/users/users.queries.js', 'DELETE FROM atlas_shares WHERE atlas_id = ANY($1::uuid[]) AND user_id = $2'),

  // ---- leitura que NÃO resolve acesso ----------------------------------------------
  naoResolve(
    'src/modules/atlas/atlas.service.js',
    '`SELECT s.user_id FROM atlas_shares s',
    'transferOwnership: pergunta se o alvo tem share DIRETO, porque posse e nominal por '
    + 'construcao (atlas.owner_id e coluna, nao coletivo). Nao decide leitura de ninguem.'
  ),
  naoResolve(
    'src/modules/sharing/sharing.queries.js',
    'LEFT JOIN atlas_shares s ON s.atlas_id = a.id',
    'GET_SHARING_CONFIG: monta a TELA de compartilhamento (quem esta na lista, com que '
    + 'nivel de vinculo). Nao gateia nada: quem gateia a rota e requireAtlasPermission.'
  ),
  naoResolve(
    'src/modules/access-groups/access-groups.queries.js',
    '(SELECT COUNT(*) FROM atlas_shares s',
    'LIST_GROUPS e GET_GROUP_REACH: CONTAM quantos atlas o grupo alcanca, para que o aviso '
    + 'de APAGAR O GRUPO diga o tamanho do estrago. Contagem, nunca resolucao: nenhuma '
    + 'permissao sai daqui, e a linha de quem alcanca continua vindo de fn_user_atlas_shares. '
    + 'Entraram em 2026-08-21 porque o aviso contava so recursos e omitia atlas, isto e, '
    + 'avisava de MENOS sobre um ato irreversivel. O JOIN com atlas mais o deleted_at IS NULL '
    + 'e o irmao do expires_at > NOW() da contagem vizinha: nao prometer perda de acesso a '
    + 'atlas que ja esta na lixeira.',
    2
  ),
];

// ---------------------------------------------------------------------------
// Varreduras
// ---------------------------------------------------------------------------

/** Remove comentário de bloco e de linha PRESERVANDO a numeração de linha. */
function semComentarios(src) {
  const normalizado = src.replace(/\r\n?/g, '\n');
  const semBloco = normalizado.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  return semBloco.split('\n').map((linha) => linha.replace(/\/\/.*/, '')).join('\n');
}

function arquivosDoInventario(pathspec = 'src') {
  return execFileSync(
    'git', ['ls-files', '--cached', '--others', '--exclude-standard', pathspec],
    { cwd: RAIZ, encoding: 'utf8' }
  ).split('\n').map((s) => s.trim()).filter((s) => s.endsWith('.js'));
}

const lerCodigo = (arquivo) => semComentarios(fs.readFileSync(path.join(RAIZ, arquivo), 'utf8'));
const normalizar = (linha) => linha.trim().replace(/\s+/g, ' ');

const MENCAO = /\batlas_shares\b|\bfn_user_atlas_shares\b|\bfn_atlas_member_ids\b/;

/** Varredura 1: toda linha de código que menciona a tabela ou as funções. @returns {Array} */
function mencoes(arquivos) {
  const achadas = [];
  for (const arquivo of arquivos) {
    lerCodigo(arquivo).split('\n').forEach((linha, i) => {
      if (MENCAO.test(linha)) achadas.push({ arquivo, n: i + 1, texto: normalizar(linha) });
    });
  }
  return achadas;
}

/**
 * Varredura 2: A FORMA PROIBIDA — ler `permission` DE `atlas_shares` num SELECT.
 *
 * Roda sobre o texto INTEIRO (sem comentários), não linha a linha, porque a forma se
 * escreve com quebra no meio tão facilmente quanto numa linha só. A janela de 200
 * caracteres entre `SELECT` e a tabela é larga o bastante para a projeção mais longa deste
 * repositório e estreita o bastante para não colar dois statements distintos.
 *
 * `FROM` **OU** `JOIN`, desde 2026-08-21, e o alargamento fecha o buraco que mais importa:
 * a forma que esta onda REMOVEU de `atlas.queries.js` era um `LEFT JOIN atlas_shares s ...
 * AND s.user_id = $1`, e a versão anterior desta regex — só `FROM` — não a via. A varredura
 * se anunciava como "a única com dente próprio" enquanto era cega para a forma exata que
 * alguém reintroduziria ao consertar um cartão que não aparece.
 *
 * O ALARGAMENTO NÃO PRECISOU DE EXCEÇÃO NENHUMA, e o motivo é a janela, não a sorte:
 * `GET_SHARING_CONFIG` (a única leitura legítima de `permission` por JOIN nesta árvore)
 * tem mais de 200 caracteres entre o `SELECT` e a primeira menção a `permission`, por causa
 * dos dois `json_agg`. Medido em 2026-08-21: com `JOIN` na alternância, `src/` continua com
 * ZERO acusações. Saiba o preço disso, que é o mesmo cego pelo outro lado: uma resolução
 * nova escrita com projeção longa também escapa. A classificação da varredura 1 é quem a
 * pega — e é por isso que as duas varreduras existem.
 */
const FORMA_PROIBIDA = /SELECT[\s\S]{0,200}?\bpermission\b[\s\S]{0,200}?(?:FROM|JOIN)\s+atlas_shares\b/gi;

function resolucoesDiretas(arquivos) {
  const achadas = [];
  for (const arquivo of arquivos) {
    const codigo = lerCodigo(arquivo);
    for (const m of codigo.matchAll(FORMA_PROIBIDA)) {
      achadas.push(`${arquivo}: ${normalizar(m[0]).slice(0, 120)}`);
    }
  }
  return achadas;
}

/** Menções que nenhuma entrada do censo cobre. */
function naoClassificadas(achadas, censo) {
  return achadas
    .filter((a) => !censo.some((e) => e.arquivo === a.arquivo && a.texto.startsWith(normalizar(e.trecho))))
    .map((a) => `${a.arquivo}:${a.n} ${a.texto}`);
}

// ---------------------------------------------------------------------------

describe('censo · os leitores de atlas_shares e o eixo de GRUPO', () => {
  const arquivos = arquivosDoInventario();
  const achadas = mencoes(arquivos);

  it('piso: o inventário e a varredura acham o que deveriam achar', () => {
    // Sem este caso, TODOS os outros passariam comparando vazio com vazio — que é o
    // verde que este repositório mais pagou.
    assert.ok(arquivos.length > 100, `inventário raso demais: ${arquivos.length} arquivos`);
    // 22 é MEDIDO em 2026-08-21, não estimado. O piso é `>=` porque acrescentar consulta é
    // legítimo; o que a próxima pessoa paga por acrescentá-la é a entrada no censo, cobrada
    // pelos dois casos abaixo.
    assert.ok(achadas.length >= 22, `varredura rasa demais: ${achadas.length} menções`);
    const porArquivo = new Set(achadas.map((a) => a.arquivo));
    assert.ok(porArquivo.size >= 6, `esperava ao menos 6 arquivos com menção, achei ${porArquivo.size}`);
    // Os dois consumidores que decidem acesso em TODA requisição precisam estar na lista.
    assert.ok(porArquivo.has('src/middleware/permissions.js'));
    assert.ok(porArquivo.has('src/modules/collab/collab.gateway.js'));
  });

  it('toda menção a atlas_shares em src/ está classificada', () => {
    assert.deepEqual(naoClassificadas(achadas, CENSO), []);
  });

  it('a contagem de cada entrada bate EXATAMENTE (apagar cópia também reprova)', () => {
    const divergentes = [];
    for (const e of CENSO) {
      const alvo = normalizar(e.trecho);
      const n = achadas.filter((a) => a.arquivo === e.arquivo && a.texto.startsWith(alvo)).length;
      if (n !== e.n) divergentes.push(`${e.arquivo} « ${e.trecho.slice(0, 60)} » declarado ${e.n}, achado ${n}`);
    }
    assert.deepEqual(divergentes, []);

    // A SOMA FECHA DOS DOIS LADOS. Sem esta linha, duas entradas com contagem trocada entre
    // si (uma a mais aqui, uma a menos ali) passariam, e uma linha coberta por DUAS entradas
    // seria contada duas vezes sem ninguém notar.
    const somaDeclarada = CENSO.reduce((acc, e) => acc + e.n, 0);
    assert.equal(somaDeclarada, achadas.length, 'o censo declara exatamente as menções que existem');
  });

  it('NENHUMA entrada resolve acesso por conta própria', () => {
    const proibidas = CENSO.filter((e) => e.classe === C_RESOLUCAO_DIRETA);
    assert.deepEqual(
      proibidas.map((e) => e.arquivo), [],
      'depois desta onda, resolver acesso é chamar `fn_user_atlas_shares` — a precedência '
      + 'entre share direto e share por grupo tem UMA definição, e ela é SQL'
    );
    // E a árvore REAL concorda: nenhuma forma proibida em `src/`.
    assert.deepEqual(resolucoesDiretas(arquivos), []);
  });

  it('toda leitura declarada como NÃO-RESOLVE traz motivo escrito', () => {
    const curtos = CENSO
      .filter((e) => e.classe === C_NAO_RESOLVE)
      .filter((e) => typeof e.motivo !== 'string' || e.motivo.length < 60)
      .map((e) => `${e.arquivo} « ${e.trecho.slice(0, 40)} »`);
    assert.deepEqual(curtos, [], 'motivo com menos de 60 caracteres é rótulo, não justificativa');
    // PISO da própria regra: existe ao menos uma leitura assim, senão o caso é vazio.
    assert.ok(CENSO.some((e) => e.classe === C_NAO_RESOLVE));
  });

  // -------------------------------------------------------------------------
  it('CONTROLE NEGATIVO: uma consulta que resolve à mão é ACUSADA pelas duas varreduras', () => {
    const fixture = 'tests/fixtures/censo-atlas-shares/exemplo-resolve-direto.queries.js';
    assert.ok(fs.existsSync(path.join(RAIZ, fixture)), 'a fixture do controle precisa existir');

    // A MESMA função dos casos acima, apontada para a fixture.
    const daFixture = mencoes([fixture]);
    assert.ok(
      daFixture.length >= 2,
      'a varredura precisa ENXERGAR as consultas da fixture; se ela deixar de casar, os outros '
      + 'casos passam verdes sem verificar nada'
    );
    assert.equal(
      naoClassificadas(daFixture, CENSO).length, daFixture.length,
      'nenhuma delas está no censo, então TODAS têm de ser acusadas'
    );

    // E a varredura da forma proibida acusa as TRÊS escritas — a de uma linha, a quebrada
    // em três e a que resolve por `JOIN`, que é como ela apareceria de verdade num arquivo
    // de queries e é a que a regex só-`FROM` deixava passar.
    const proibidas = resolucoesDiretas([fixture]);
    assert.equal(proibidas.length, 3, `esperava 3 formas proibidas, achei: ${proibidas.join(' | ')}`);
    assert.ok(
      proibidas.some((p) => p.includes('LEFT JOIN atlas_shares')),
      'a forma por JOIN precisa ser acusada NOMINALMENTE, senão o alargamento da regex não '
      + 'está medido e a exceção de tela seria a única coisa que ele produziu'
    );

    // DISCRIMINAÇÃO: a árvore real NÃO é acusada pela mesma função. Sem esta metade, um
    // regex que casasse tudo passaria no caso acima e reprovaria o produto inteiro.
    assert.deepEqual(resolucoesDiretas(arquivos), []);
  });

  it('CONTROLE NEGATIVO: o inventário ENXERGA arquivo NOVO ainda não rastreado', () => {
    // O cego que `git ls-files` puro abre fica no pior lugar possível: a consulta escrita
    // há cinco minutos é a que ninguém classificou. Ela nasce aqui e morre no `finally`.
    const dir = 'tests/fixtures/censo-atlas-shares';
    const relativo = `${dir}/tmp-nao-rastreado.queries.js`;
    const abs = path.join(RAIZ, relativo);
    fs.writeFileSync(abs, [
      `// Path: ${relativo}`,
      '// Temporário: criado e apagado pelo controle negativo deste censo.',
      'export const TMP = `SELECT permission FROM atlas_shares WHERE atlas_id = $1 AND user_id = $2`;',
      '',
    ].join('\n'));

    try {
      const soRastreados = execFileSync('git', ['ls-files', dir], { cwd: RAIZ, encoding: 'utf8' });
      assert.ok(!soRastreados.includes('tmp-nao-rastreado'), 'a fixture temporária não pode estar rastreada');

      const inventario = arquivosDoInventario(dir);
      assert.ok(inventario.includes(relativo), 'o inventário precisa enxergar o arquivo NÃO rastreado');

      assert.equal(resolucoesDiretas([relativo]).length, 1, 'e a varredura precisa acusá-lo');
      assert.equal(naoClassificadas(mencoes([relativo]), CENSO).length, 1);
    } finally {
      fs.rmSync(abs, { force: true });
    }
  });
});
