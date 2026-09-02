// Path: tests/unit/diag-origem-de-erro.test.js
// O VOCABULÁRIO DE ORIGEM VIVE DUAS VEZES, e este arquivo é o que impede as duas de
// divergirem: `ORIGENS_DE_ERRO` (`src/modules/diag/origens-de-erro.js`), de onde o Joi da
// borda deriva a lista, e o CHECK `client_errors_origem_check`, escrito em
// `src/database/migrations/017_erro_cliente_identidade.sql`.
//
// POR QUE DUAS CÓPIAS, E POR QUE ELAS PRECISAM DE GUARDA. As duas recusam em momentos
// diferentes e nenhuma cobre a outra: o Joi recusa na borda com 422 NOMEANDO o campo, e o
// CHECK recusa no banco mesmo quando a escrita vem por outro caminho (um roteiro, um INSERT
// à mão, um controller futuro que esqueça o schema). Uma cópia sem a outra é uma proteção
// pela metade; duas cópias sem guarda é uma proteção que envelhece. Acrescentar valor ao
// JS e esquecer a migração produz o pior desfecho dos dois: a borda ACEITA e o banco recusa
// com 23514, que a borda traduz num 400 genérico, dentro do caminho que existe para
// registrar falhas.
//
// A LEITURA É DO ARQUIVO EM DISCO, e não do banco, de propósito: assim este caso roda sem
// PostgreSQL e reprova no laço mais apertado. A metade que exercita o CHECK DE VERDADE (um
// INSERT direto com origem desconhecida) está em
// `tests/integration/diag-erro-de-cliente-identidade.test.js`, porque um CHECK escrito no
// arquivo e nunca aplicado seria a mesma cobertura vazia que este arquivo existe para
// evitar.
//
// CONTROLE NEGATIVO (o que fica vermelho ao reverter cada peça):
//  - acrescentar um valor só no JS ou só no SQL: o caso da igualdade fica vermelho, e a
//    mensagem nomeia qual lado tem o valor a mais;
//  - trocar a ordem de um dos lados: idem, porque a comparação é por LISTA e não por
//    conjunto (a ordem é a do ciclo de vida, e é o que faz as duas se lerem lado a lado);
//  - importar qualquer coisa em `origens-de-erro.js`: o caso do módulo folha fica vermelho,
//    e o preço real seria arrastar `config.js` (que exige DATABASE_URL e JWT_SECRET) para
//    dentro de uma lista de dez strings.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ORIGENS_DE_ERRO, OrigemDeErro } from '../../src/modules/diag/origens-de-erro.js';
import { erroDeClienteSchema } from '../../src/modules/diag/diag.schemas.js';

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MIGRACAO = path.join(RAIZ, 'src/database/migrations/017_erro_cliente_identidade.sql');
const MODULO = path.join(RAIZ, 'src/modules/diag/origens-de-erro.js');

/**
 * Os valores do CHECK, lidos do texto da migração.
 *
 * O recorte começa no nome do constraint e termina no `);` do bloco, para que nenhum outro
 * literal do arquivo (um COMMENT, por exemplo) entre na lista por acidente.
 */
function valoresDoCheck() {
  const sql = fs.readFileSync(MIGRACAO, 'utf8');
  // O fecho aceita indentação porque o `ADD CONSTRAINT` mora dentro de um bloco `DO $$ ... $$`
  // (idempotência: o Postgres não tem `ADD CONSTRAINT IF NOT EXISTS`), e ali a linha do `);`
  // não começa na coluna zero.
  const bloco = sql.match(/client_errors_origem_check\s+CHECK\s*\(([\s\S]*?)\n\s*\);/);
  assert.ok(bloco, 'o CHECK nomeado precisa existir no arquivo da migração');
  const literais = bloco[1].match(/'[^']+'/g);
  assert.ok(literais, 'o CHECK precisa enumerar valores; sem isto a comparação seria vazia');
  return literais.map((l) => l.slice(1, -1));
}

describe('Origem do erro de cliente — o JS e o CHECK dizem a MESMA coisa', () => {
  it('as duas listas são iguais, na mesma ordem', () => {
    const doCheck = valoresDoCheck();
    // Guarda de não-vacuidade ANTES da comparação: duas listas vazias seriam iguais, e o
    // verde não estaria provando nada.
    assert.equal(doCheck.length, 10, `o CHECK precisa ter dez valores, tem ${doCheck.length}`);
    assert.equal(ORIGENS_DE_ERRO.length, 10);
    assert.deepEqual([...ORIGENS_DE_ERRO], doCheck);
  });

  it('a lista é exatamente a esperada, escrita à mão (controle absoluto)', () => {
    // Sem este caso, o anterior compara duas cópias UMA COM A OUTRA e passaria verde com as
    // duas erradas do mesmo jeito — que é como um espelho falha.
    assert.deepEqual([...ORIGENS_DE_ERRO], [
      'boot', 'nao-tratado', 'rejeicao', 'console', 'store',
      'ws', 'maplibre', 'cesium', 'sv360', 'indisponivel',
    ]);
    assert.equal(new Set(ORIGENS_DE_ERRO).size, ORIGENS_DE_ERRO.length, 'sem repetido');
  });

  it('`OrigemDeErro` cobre a lista inteira e nada além dela', () => {
    const valores = Object.values(OrigemDeErro);
    assert.equal(valores.length, ORIGENS_DE_ERRO.length);
    assert.deepEqual(valores.sort(), [...ORIGENS_DE_ERRO].sort());
    assert.equal(OrigemDeErro.NAO_TRATADO, 'nao-tratado', 'a chave é ASCII, o valor é o do banco');
    assert.equal(OrigemDeErro.INDISPONIVEL, 'indisponivel');
  });

  it('as duas exportações são congeladas: ninguém acrescenta origem em runtime', () => {
    assert.equal(Object.isFrozen(ORIGENS_DE_ERRO), true);
    assert.equal(Object.isFrozen(OrigemDeErro), true);
  });

  it('o módulo é FOLHA: zero imports', () => {
    // Contrato, não estilo: o Joi da borda e estes testes o carregam, e ele precisa
    // continuar carregável sem `DATABASE_URL` e sem `JWT_SECRET`.
    const fonte = fs.readFileSync(MODULO, 'utf8');
    const imports = fonte.match(/^\s*import\s/gm);
    assert.equal(imports, null, `origens-de-erro.js precisa continuar sem imports: ${imports}`);
    assert.match(fonte, /export const ORIGENS_DE_ERRO/, 'guarda: o arquivo lido é o certo');
  });
});

describe('O Joi da borda deriva a lista, e recusa o que está fora dela', () => {
  const corpo = (over) => ({ assinatura: 'a', mensagem: 'm', ...over });

  it('aceita cada um dos dez', () => {
    assert.equal(ORIGENS_DE_ERRO.length, 10);
    for (const origem of ORIGENS_DE_ERRO) {
      const { error, value } = erroDeClienteSchema.validate(corpo({ origem }));
      assert.equal(error, undefined, `origem ${origem}`);
      assert.equal(value.origem, origem);
    }
  });

  it('recusa a origem desconhecida, nomeando o campo', () => {
    const { error } = erroDeClienteSchema.validate(corpo({ origem: 'inventada' }));
    assert.ok(error, 'origem fora do vocabulário precisa reprovar na borda');
    assert.equal(error.details[0].path[0], 'origem');
  });

  it('origem AUSENTE é válida: o relato antigo continua entrando', () => {
    const { error, value } = erroDeClienteSchema.validate(corpo({}));
    assert.equal(error, undefined);
    assert.equal(Object.hasOwn(value, 'origem'), false);
  });
});
