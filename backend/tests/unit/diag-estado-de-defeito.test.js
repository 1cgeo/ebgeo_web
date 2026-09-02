// Path: tests/unit/diag-estado-de-defeito.test.js
// O CICLO DE VIDA DO DEFEITO VIVE DUAS VEZES, e este arquivo é o que impede as duas de
// divergirem: `ESTADOS_DE_DEFEITO` (`src/modules/diag/estados-de-defeito.js`), de onde o Joi
// da borda deriva o filtro, e o CHECK `defeitos_estado_check`, escrito em
// `src/database/migrations/018_defeitos_e_ocorrencias.sql`.
//
// É o gêmeo de `diag-origem-de-erro.test.js`, e existe pelo mesmo argumento: as duas cópias
// recusam em momentos diferentes e nenhuma cobre a outra. O Joi recusa `?estado=zumbi` na
// borda com 422 nomeando o campo; o CHECK recusa no banco mesmo quando a escrita vem por
// outro caminho, e o caminho que mais importa aqui NÃO é uma rota: é o `CASE` do
// `UPSERT_DEFEITO`, que escreve `'regrediu'` sem passar por Joi nenhum. Um `CASE` com um
// valor fora do vocabulário produziria 23514 dentro do UPSERT, ou seja, o caminho que existe
// para registrar falhas produzindo a sua.
//
// CONTROLE NEGATIVO (o que fica vermelho ao reverter cada peça):
//  - acrescentar um valor só no JS ou só no SQL: o caso da igualdade fica vermelho, e a
//    mensagem nomeia qual lado tem o valor a mais;
//  - trocar a ordem de um dos lados: idem, porque a comparação é por LISTA e não por
//    conjunto (a ordem é a do ciclo de vida, e é o que faz as duas se lerem lado a lado);
//  - importar qualquer coisa em `estados-de-defeito.js`: o caso do módulo folha fica
//    vermelho, e o preço real seria arrastar `config.js` (que exige DATABASE_URL e
//    JWT_SECRET) para dentro de uma lista de quatro strings;
//  - tirar o `'aberto'` do DEFAULT da coluna: o caso do default fica vermelho, e sem ele a
//    migração seria aditiva só na aparência (toda linha existente ficaria em estado nulo,
//    fora do CHECK e invisível a qualquer filtro por estado).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESTADOS_DE_DEFEITO, EstadoDeDefeito } from '../../src/modules/diag/estados-de-defeito.js';
import { defeitosQuerySchema } from '../../src/modules/diag/diag.schemas.js';

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MIGRACAO = path.join(RAIZ, 'src/database/migrations/018_defeitos_e_ocorrencias.sql');
const MODULO = path.join(RAIZ, 'src/modules/diag/estados-de-defeito.js');

/**
 * Os valores do CHECK, lidos do texto da migração.
 *
 * O recorte começa no nome do constraint e termina no `);` do bloco, para que nenhum outro
 * literal do arquivo (um COMMENT, ou o CASE citado em prosa) entre na lista por acidente.
 */
function valoresDoCheck() {
  const sql = fs.readFileSync(MIGRACAO, 'utf8');
  const bloco = sql.match(/defeitos_estado_check\s+CHECK\s*\(([\s\S]*?)\n\s*\);/);
  assert.ok(bloco, 'o CHECK nomeado precisa existir no arquivo da migração');
  const literais = bloco[1].match(/'[^']+'/g);
  assert.ok(literais, 'o CHECK precisa enumerar valores; sem isto a comparação seria vazia');
  return literais.map((l) => l.slice(1, -1));
}

describe('Estado do defeito — o JS e o CHECK dizem a MESMA coisa', () => {
  it('as duas listas são iguais, na mesma ordem', () => {
    const doCheck = valoresDoCheck();
    // Guarda de não-vacuidade ANTES da comparação: duas listas vazias seriam iguais, e o
    // verde não estaria provando nada.
    assert.equal(doCheck.length, 4, `o CHECK precisa ter quatro valores, tem ${doCheck.length}`);
    assert.equal(ESTADOS_DE_DEFEITO.length, 4);
    assert.deepEqual([...ESTADOS_DE_DEFEITO], doCheck);
  });

  it('a lista é exatamente a esperada, escrita à mão (controle absoluto)', () => {
    // Sem este caso, o anterior compara duas cópias UMA COM A OUTRA e passaria verde com as
    // duas erradas do mesmo jeito — que é como um espelho falha.
    assert.deepEqual([...ESTADOS_DE_DEFEITO], ['aberto', 'resolvido', 'ignorado', 'regrediu']);
    assert.equal(new Set(ESTADOS_DE_DEFEITO).size, ESTADOS_DE_DEFEITO.length, 'sem repetido');
  });

  it('`EstadoDeDefeito` cobre a lista inteira e nada além dela', () => {
    const valores = Object.values(EstadoDeDefeito);
    assert.equal(valores.length, ESTADOS_DE_DEFEITO.length);
    assert.deepEqual(valores.sort(), [...ESTADOS_DE_DEFEITO].sort());
    assert.equal(EstadoDeDefeito.REGREDIU, 'regrediu');
  });

  it('as duas exportações são congeladas: ninguém acrescenta estado em runtime', () => {
    assert.equal(Object.isFrozen(ESTADOS_DE_DEFEITO), true);
    assert.equal(Object.isFrozen(EstadoDeDefeito), true);
  });

  it('o módulo é FOLHA: zero imports', () => {
    const fonte = fs.readFileSync(MODULO, 'utf8');
    const imports = fonte.match(/^\s*import\s/gm);
    assert.equal(imports, null, `estados-de-defeito.js precisa continuar sem imports: ${imports}`);
    assert.match(fonte, /export const ESTADOS_DE_DEFEITO/, 'guarda: o arquivo lido é o certo');
  });

  it('a coluna NASCE em `aberto`, e é isso que torna a migração aditiva de verdade', () => {
    // Sem o DEFAULT, `estado` seria NOT NULL sobre uma tabela com linhas (o que nem aplicaria)
    // ou NULL-ável (o que deixaria toda linha anterior fora do CHECK e invisível ao filtro).
    const sql = fs.readFileSync(MIGRACAO, 'utf8');
    assert.match(sql, /ADD COLUMN IF NOT EXISTS estado\s+TEXT NOT NULL DEFAULT 'aberto'/);
    assert.equal(EstadoDeDefeito.ABERTO, 'aberto');
  });
});

describe('O Joi do filtro deriva a lista, e recusa o que está fora dela', () => {
  it('aceita cada um dos quatro', () => {
    assert.equal(ESTADOS_DE_DEFEITO.length, 4);
    for (const estado of ESTADOS_DE_DEFEITO) {
      const { error, value } = defeitosQuerySchema.validate({ estado });
      assert.equal(error, undefined, `estado ${estado}`);
      assert.equal(value.estado, estado);
    }
  });

  it('recusa o estado desconhecido, nomeando o campo', () => {
    const { error } = defeitosQuerySchema.validate({ estado: 'zumbi' });
    assert.ok(error, 'estado fora do vocabulário precisa reprovar na borda');
    assert.equal(error.details[0].path[0], 'estado');
  });

  it('estado AUSENTE é válido e NÃO ganha default: a rota não escolhe recorte por ninguém', () => {
    const { error, value } = defeitosQuerySchema.validate({});
    assert.equal(error, undefined);
    assert.equal(Object.hasOwn(value, 'estado'), false);
    // Os dois que TÊM default, porque a ausência deles não tem tradução no SQL.
    assert.equal(value.novos, false);
    assert.equal(value.limite, 50);
  });
});
