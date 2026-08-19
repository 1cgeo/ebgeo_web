// Path: tests/unit/citacao-de-migracao.test.js
// Toda citação a um arquivo de migração, em qualquer .js do backend, aponta para um
// arquivo que EXISTE.
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
// O QUE ELE NÃO PEGA, dito em voz alta: citação por NOME de tabela, por número solto
// ("a 019 fez X") ou por descrição em prosa. O padrão só reconhece o formato
// `NNN_nome.sql`, que é o formato que a convenção de nomes desta casa produz. Citar
// por número solto continua sendo uma forma de escrever uma referência que apodrece
// sem guarda; prefira o nome do arquivo, que este teste cobra, ou o nome do SÍMBOLO,
// que é estável.

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
 * Nomes citados por engano que NÃO são referência a arquivo: fixtures que fabricam um
 * nome inexistente de propósito. Cada uma precisa de motivo escrito.
 */
const NAO_SAO_CITACAO = new Map([
  ['999_fantasma.sql',
   'tests/integration/migrations-tracking-vs-disco.test.js fabrica este nome como CONTROLE '
   + 'NEGATIVO: ele existe para NÃO existir em disco, e é assim que aquele teste prova que a '
   + 'comparação banco × disco enxerga uma linha órfã.'],
]);

const arquivosVersionados = () =>
  execFileSync('git', ['ls-files', 'src', 'tests', 'scripts'], { cwd: RAIZ, encoding: 'utf8' })
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.endsWith('.js'));

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
    const INOFENSIVAS = ['const x = 003;', "readFileSync('schema.sql')", '// ver a fase 019'];
    const falsos = INOFENSIVAS.filter((l) => [...l.matchAll(CITACAO)].length > 0);
    assert.deepEqual(falsos, [], 'o padrão está casando texto que não é nome de migração');
  });
});
