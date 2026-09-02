// Path: tests/unit/citacao-de-migracao.test.js
// Toda citação a uma migração, em qualquer .js do backend, é RESOLVÍVEL: ou nomeia um
// arquivo que EXISTE (`NNN_nome.sql`), ou não é uma citação por número.
//
// POR QUE ESTE GUARDA EXISTE, e por que ele nasceu junto com a consolidação de
// 2026-08-19 (F15). Citação de migração em comentário de código é a única classe de
// referência a caminho que este repositório NÃO vigiava: `docs-integridade.test.js`
// cobra caminho e wikilink dentro de `docs/`, e nada olhava para `backend/src/**` e
// `backend/tests/**`. O resultado era previsível e foi MEDIDO no HEAD anterior:
// `sv360.merge.js` citava uma `012_organizations.sql` que nunca existiu neste
// repositório — resíduo do PRIMEIRO esmagamento de migrações, sobrevivendo há meses
// sem nada ficar vermelho.
//
// A consolidação renomeou todos os arquivos, o que multiplicaria essa classe de
// podridão por quarenta se ninguém a cobrasse. Uma citação errada não quebra nada em
// runtime; ela quebra a leitura, que é o que o comentário existe para servir, e engana
// em dobro um agente, que trata prosa de código como verdade.
//
// A SEGUNDA METADE, escrita no mesmo dia depois de a primeira ter deixado o buraco
// aberto POR ESCRITO. A versão original deste arquivo só reconhecia o formato
// `NNN_nome.sql` e declarava, no próprio cabeçalho, que a citação por NÚMERO SOLTO
// continuava sem guarda nenhum. Ela continuou mesmo: uma varredura logo depois achou 57
// números soltos em 31 arquivos, quase todos apontando para a numeração MORTA, e o pior
// caso era o mais barato de acreditar — `collab.gateway.js` citava a migração de número
// oito para `users.sessions_valid_from`, e o arquivo que hoje leva esse número existe e
// trata de outro assunto, então quem confiasse no número abriria o arquivo errado e
// concluiria que a prosa é que estava errada. Esta é a SEGUNDA vez que estas citações
// apodrecem (houve um esmagamento antes deste), e a regra da casa para correção que
// recorre é mudar a abordagem, não re-anotar: por isso o número solto passa a REPROVAR.
//
// COMO CITAR, em ordem de preferência: (1) o SÍMBOLO — nome de função, coluna,
// constraint ou índice —, que é estável e tem guarda em `docs-integridade`; (2) o NOME
// DO ARQUIVO vigente, que este teste cobra; (3) prosa sem número, quando a frase é
// histórica (o histórico mora no git).
//
// O QUE ELE NÃO PEGA, dito em voz alta, porque censo que não declara o próprio teto
// vira licença para acreditar nele:
//
//   - Ele lê COMENTÁRIO, não código. Número de migração dentro de string literal
//     escapa: título de `describe`, mensagem de `assert`, nome montado em runtime.
//     Um teste que precise nomear uma migração que NÃO existe mais monta o nome em
//     runtime justamente por isso.
//   - Ele reconhece o número no formato zero-padded de três dígitos. Citação por nome
//     de tabela ("a migração do gazetteer"), por data ou por fase (`F15`) passa, e passa
//     de propósito: nenhuma delas aponta para um arquivo.
//   - Em notação de FAIXA ele vê o PRIMEIRO número e não o segundo, porque o lookbehind
//     recusa dígito colado a ponto — que é o mesmo mecanismo que impede `10.352.008
//     bytes` e uma tolerância de grau decimal de virarem achado. Uma faixa em comentário
//     reprova, mas a mensagem cita só a ponta de baixo.
//   - Ele não confere se a citação por nome de arquivo diz a VERDADE sobre o conteúdo
//     daquele arquivo, só que o arquivo existe.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DIR_MIGRACOES = path.join(RAIZ, 'src/database/migrations');

/** Formato de nome de migração desta casa (o mesmo que `migrations-higiene` cobra). */
const CITACAO = /\b(\d{3}_[a-z0-9_-]+\.sql)\b/g;

/**
 * Número solto de migração em prosa.
 *
 * O lookbehind e o lookahead são o que separa "citação" de "aritmética", e cada caractere
 * dos dois conjuntos foi comprado por um falso positivo real desta base:
 *
 *   - antes:  ponto e vírgula-decimal (contagem de bytes com separador de milhar,
 *     tolerância em grau escrita à brasileira), hífen e barra (nome de arquivo de foto,
 *     caminho), `#` (literal de cor), e caractere de palavra (o próprio `NNN_nome.sql`,
 *     que é removido antes mas cairia aqui pelo underscore);
 *   - depois: caractere de palavra, hífen, e ponto ou vírgula SEGUIDOS DE DÍGITO. O ponto
 *     final de frase NÃO desqualifica, e essa é a diferença que importa: "migração 008."
 *     no fim de um parágrafo é exatamente a forma que escaparia de um lookahead ingênuo.
 */
const NUMERO_SOLTO = /(?<![-.,#\w/])0\d{2}(?![\w-]|[.,]\d)/g;

/**
 * Nomes citados por engano que NÃO são referência a arquivo: fixtures que fabricam um
 * nome inexistente de propósito. Cada uma precisa de motivo escrito.
 */
const NAO_SAO_CITACAO = new Map([
  ['999_fantasma.sql',
   'tests/integration/migrations-tracking-vs-disco.test.js fabrica este nome como CONTROLE '
   + 'NEGATIVO: ele existe para NÃO existir em disco, e é assim que aquele teste prova que a '
   + 'comparação banco × disco enxerga uma linha órfã.'],
  ['099_alarga.sql',
   'tests/unit/auditoria-censo.test.js fabrica este nome numa FIXTURE SINTÉTICA de duas '
   + 'declarações do CHECK de `action`, para exercitar a regra "a mais recente vence" sem '
   + 'depender de o repositório ter duas migrações que a declarem. Enquanto essa regra era '
   + 'exercitada contando arquivos, consolidar o schema reprovava o guarda — o piso premiava '
   + 'quem reintroduzisse um degrau.'],
]);

/**
 * Números soltos que ficam, com o motivo ao lado. Cada entrada é `{arquivo, numero,
 * motivo}`.
 *
 * PREFIRA ZERO. Uma entrada aqui é uma referência que ninguém mais consegue seguir, e o
 * teste abaixo casa a contagem de achados com o tamanho desta lista — uma isenção que
 * deixou de ser necessária reprova, do mesmo jeito que uma que falta.
 */
const EXCECOES_DE_NUMERO = [];

const arquivosVersionados = () =>
  // `-c` (cached) e `-o --exclude-standard` (others, sem os ignorados): o arquivo escrito
  // há cinco minutos e ainda não adicionado é justamente o que ninguém revisou, e um
  // `git ls-files` nu o deixaria de fora da varredura.
  execFileSync('git', ['ls-files', '-co', '--exclude-standard', 'src', 'tests', 'scripts'],
    { cwd: RAIZ, encoding: 'utf8' })
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.endsWith('.js'))
    // ESTE arquivo se EXCLUI, e a exclusão é obrigatória e não comodidade: ele carrega
    // DE PROPÓSITO uma citação quebrada e vários números soltos como amostra, para provar
    // que os padrões os enxergam (os controles negativos lá embaixo). Sem a exclusão o
    // varredor se acusa, e o jeito de calar isso seria tirar as amostras, que é justamente
    // o que dá valor ao guarda.
    .filter((s) => !s.endsWith('citacao-de-migracao.test.js'))
    // O ARQUIVO QUE O `-c` LISTA E O DISCO NÃO TEM, e ele existe de verdade: `ls-files -c`
    // enumera o ÍNDICE, então um arquivo RASTREADO que foi apagado na árvore de trabalho e
    // ainda não teve a remoção adicionada continua na lista, e o `readFileSync` de baixo morre
    // com ENOENT. O caso vive na janela entre apagar e commitar, e o sintoma é o pior possível
    // para um censo: os QUATRO casos deste arquivo caem de uma vez, todos com a mesma exceção,
    // apontando para um arquivo que ninguém está mexendo. Aconteceu na mudança de casa de
    // `scripts/diag/` para `src/` em 2026-09-02.
    //
    // PULAR ERRA PARA O LADO ESTRITO, que é o único lado em que pular é seguro: o inventário
    // fica MENOR, então citação quebrada em arquivo que existe continua sendo acusada, e o
    // piso de 20 citações e o de 100 arquivos continuam cobrando que a varredura alcance o
    // pacote. É o mesmo argumento (e o mesmo trade) do `ENOENT` tolerado por
    // `frontend/tests/unit/docs-integridade.test.js`.
    .filter((s) => fs.existsSync(path.join(RAIZ, s)));

/**
 * O texto de COMENTÁRIO de um arquivo .js, linha a linha.
 *
 * São três fontes, e a terceira não é obviedade: além das duas formas de comentário do
 * JavaScript, uma linha cujo conteúdo começa por dois hifens é comentário SQL dentro de
 * template literal, e é onde mora boa parte da prosa deste backend (`nomes.queries.js`
 * citava a numeração morta exatamente ali, invisível para qualquer extração que só
 * conhecesse JavaScript). O caminhador rastreia aspas para não confundir uma URL dentro
 * de string com início de comentário, que é o falso positivo clássico desta extração.
 *
 * @param {string} texto
 * @returns {{n: number, t: string}[]}
 */
function linhasDeComentario(texto) {
  const saida = [];
  let emBloco = false;
  texto.split('\n').forEach((linha, i) => {
    const n = i + 1;
    const empurra = (t) => { if (t.trim()) saida.push({ n, t }); };

    if (!emBloco && /^\s*--/.test(linha)) { empurra(linha); return; }

    let j = 0;
    let aspas = null;
    while (j < linha.length) {
      const c = linha[j];
      const d = linha[j + 1];
      if (emBloco) {
        const fim = linha.indexOf('*/', j);
        if (fim === -1) { empurra(linha.slice(j)); return; }
        empurra(linha.slice(j, fim));
        emBloco = false;
        j = fim + 2;
        continue;
      }
      if (aspas) {
        if (c === '\\') { j += 2; continue; }
        if (c === aspas) aspas = null;
        j++;
        continue;
      }
      if (c === '\'' || c === '"' || c === '`') { aspas = c; j++; continue; }
      if (c === '/' && d === '/') { empurra(linha.slice(j)); return; }
      if (c === '/' && d === '*') { emBloco = true; j += 2; continue; }
      j++;
    }
  });
  return saida;
}

/**
 * Os números soltos de migração no COMENTÁRIO de um arquivo .js.
 *
 * A citação por nome de arquivo é removida ANTES de procurar o número, senão
 * `008_acesso_a_recurso.sql` se acusaria pelo próprio prefixo — e essa é exatamente a
 * distinção que este guarda existe para fazer.
 *
 * @param {string} texto
 * @returns {{n: number, numero: string, t: string}[]}
 */
function numerosSoltos(texto) {
  const achados = [];
  for (const { n, t } of linhasDeComentario(texto)) {
    const semNomes = t.replace(CITACAO, ' ');
    for (const m of semNomes.matchAll(NUMERO_SOLTO)) {
      achados.push({ n, numero: m[0], t: t.trim() });
    }
  }
  return achados;
}

describe('Citação de migração em .js aponta para arquivo que existe', () => {
  const migracoes = new Set(
    fs.readdirSync(DIR_MIGRACOES).filter((f) => f.endsWith('.sql'))
  );

  it('guarda: há migrações em disco e arquivos .js para varrer', () => {
    assert.ok(migracoes.size >= 5, `esperava >= 5 migrações, achei ${migracoes.size}`);
    const arquivos = arquivosVersionados();
    assert.ok(arquivos.length >= 100, `esperava >= 100 arquivos .js, achei ${arquivos.length}`);
  });

  it('toda citação resolve (ou está declarada como não-citação)', () => {
    const achadas = [];
    for (const rel of arquivosVersionados()) {
      const texto = fs.readFileSync(path.join(RAIZ, rel), 'utf8');
      for (const linha of texto.split('\n').map((t, i) => ({ n: i + 1, t }))) {
        for (const m of linha.t.matchAll(CITACAO)) {
          achadas.push({ arquivo: rel, n: linha.n, nome: m[1] });
        }
      }
    }

    // DISCRIMINAÇÃO: sem um piso, "nenhuma citação quebrada" é o que se mede quando a
    // regex parou de casar. As citações são muitas e não vão a zero por acidente.
    assert.ok(
      achadas.length >= 20,
      `esperava >= 20 citações de migração para inspecionar, achei ${achadas.length}`
    );

    const quebradas = achadas
      .filter((a) => !migracoes.has(a.nome) && !NAO_SAO_CITACAO.has(a.nome))
      .map((a) => `${a.arquivo}:${a.n} cita ${a.nome}, que não existe em src/database/migrations/`);
    assert.deepEqual(quebradas, [], 'citação de migração apontando para arquivo inexistente');
  });

  it('toda declaração de não-citação ainda é usada (declaração morta também apodrece)', () => {
    const citados = new Set();
    for (const rel of arquivosVersionados()) {
      const texto = fs.readFileSync(path.join(RAIZ, rel), 'utf8');
      for (const m of texto.matchAll(CITACAO)) citados.add(m[1]);
    }
    assert.ok(citados.size >= 5, `esperava >= 5 nomes distintos citados, achei ${citados.size}`);

    const orfas = [...NAO_SAO_CITACAO.keys()].filter((nome) => !citados.has(nome));
    assert.deepEqual(orfas, [], 'entrada em NAO_SAO_CITACAO que ninguém mais cita');

    // E o inverso: uma declaração que passou a existir como arquivo de verdade é uma
    // isenção que deixou de fazer sentido e vira ruído na próxima leitura.
    const virouArquivo = [...NAO_SAO_CITACAO.keys()].filter((nome) => migracoes.has(nome));
    assert.deepEqual(virouArquivo, [], 'nome declarado como não-citação existe como migração');
  });

  it('controle negativo: o padrão PEGA um nome inexistente injetado', () => {
    // A varredura acima é um verificador, e verificador quebra calado. Aqui o padrão
    // roda contra texto que contém uma citação sabidamente quebrada, e precisa vê-la.
    const AMOSTRA = '// Deterministic default org id, semeado em `012_organizations.sql:27`.';
    const casadas = [...AMOSTRA.matchAll(CITACAO)].map((m) => m[1]);
    assert.deepEqual(casadas, ['012_organizations.sql'],
      'o padrão precisa reconhecer a citação COM sufixo de linha, que é a forma mais comum');
    assert.equal(migracoes.has('012_organizations.sql'), false,
      'e precisa concluir que ela não resolve — este era o resíduo real do primeiro esmagamento');

    // E não pode casar o que não é citação de migração.
    const INOFENSIVAS = ["readFileSync('schema.sql')", '// ver o item 19'];
    const falsos = INOFENSIVAS.filter((l) => [...l.matchAll(CITACAO)].length > 0);
    assert.deepEqual(falsos, [], 'o padrão está casando texto que não é nome de migração');
  });
});

describe('Número solto de migração em comentário reprova', () => {
  it('piso: a extração de comentário alcança os arquivos e enxerga prosa', () => {
    const arquivos = arquivosVersionados();
    assert.ok(arquivos.length >= 100, `esperava >= 100 arquivos .js, achei ${arquivos.length}`);

    // O piso que discrimina de verdade não é o de ARQUIVOS, é o de COMENTÁRIO EXTRAÍDO:
    // uma extração que devolvesse vazio passaria a varredura inteira em verde, e a
    // contagem de arquivos continuaria bonita. Este backend é prosa densa, então os dois
    // pisos abaixo têm folga enorme contra o valor real e só disparam se a extração
    // quebrar de vez.
    let linhas = 0;
    let comArquivo = 0;
    for (const rel of arquivos) {
      const n = linhasDeComentario(fs.readFileSync(path.join(RAIZ, rel), 'utf8')).length;
      linhas += n;
      if (n > 0) comArquivo++;
    }
    assert.ok(linhas >= 3000, `esperava >= 3000 linhas de comentário, achei ${linhas}`);
    assert.ok(comArquivo >= arquivos.length * 0.8,
      `esperava comentário em >= 80% dos arquivos, achei ${comArquivo}/${arquivos.length}`);
  });

  it('nenhum número solto de migração sobrou em comentário', () => {
    const achados = [];
    for (const rel of arquivosVersionados()) {
      const texto = fs.readFileSync(path.join(RAIZ, rel), 'utf8');
      for (const a of numerosSoltos(texto)) achados.push({ arquivo: rel, ...a });
    }

    const naoIsentos = achados.filter(
      (a) => !EXCECOES_DE_NUMERO.some((e) => e.arquivo === a.arquivo && e.numero === a.numero)
    );
    assert.deepEqual(
      naoIsentos.map((a) => `${a.arquivo}:${a.n} cita "${a.numero}" solto — ${a.t}`),
      [],
      'cite o SÍMBOLO (função, coluna, constraint) ou o NOME DO ARQUIVO; número solto '
      + 'aponta para uma numeração que já morreu duas vezes'
    );

    // A contagem casa com a lista, no padrão de `EXCECOES_DESTRUTIVAS`: uma isenção que
    // deixou de ser necessária é ruído e reprova junto com a que falta.
    assert.equal(achados.length, EXCECOES_DE_NUMERO.length,
      `achados ${achados.length} × isenções ${EXCECOES_DE_NUMERO.length}`);
  });

  it('controle negativo: a varredura PEGA cada forma de número solto', () => {
    // Com `EXCECOES_DE_NUMERO` vazia o caso acima é `0 === 0`, que é a "cobertura vazia
    // passa verde" da constituição. Este caso roda a MESMA função (`numerosSoltos`, com a
    // MESMA extração de comentário) contra texto que contém as formas proibidas, uma por
    // linha, e exige que ela veja todas — a única maneira de distinguir "não há nada" de
    // "a regex parou de casar".
    const PODRE = [
      '// Isto veio da migração 020, que alargou a coluna.',
      '/* The cut-off column arrived in migration 008. */',
      '/**',
      ' * `basemap` entrou na 021 e é o quinto tipo.',
      ' */',
      'const x = 1; // desde a 017 o predicado mora no SQL',
      '  -- índice ocioso desde a migração 004 (comentário SQL em template literal)',
    ];
    const achados = numerosSoltos(PODRE.join('\n'));
    assert.deepEqual(achados.map((a) => a.numero), ['020', '008', '021', '017', '004'],
      'a varredura precisa ver as CINCO formas: prosa pt, prosa en, jsdoc, fim de linha e SQL');

    // E o oposto, que é metade do valor: as formas inofensivas não podem virar achado,
    // senão a regra vira ruído e alguém a desliga.
    const LIMPO = [
      '// z0 sai com 10.352.008 bytes, dos quais 289.009 gzipped',
      '// tolerância de 0.001 grau, medida contra foto-001.jpg',
      '// meio grau equirretangular vale 0,047 do total, com vírgula decimal',
      '// o DDL vive em `008_acesso_a_recurso.sql`, ao lado de `005_catalogo.sql`',
      '// a cor de fundo é #000 e a borda #fff',
      'const NOME = [\'001\', \'core.sql\'].join(\'_\');',
      'const url = \'http://exemplo/003/x\';',
    ];
    assert.deepEqual(numerosSoltos(LIMPO.join('\n')), [],
      'falso positivo: a varredura está acusando texto que não é citação de migração');
  });
});
