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
import { ESTADOS_DE_DEFEITO, ESTADOS_MANUAIS, EstadoDeDefeito } from '../../src/modules/diag/estados-de-defeito.js';
import { defeitosQuerySchema, estadoDeDefeitoSchema } from '../../src/modules/diag/diag.schemas.js';

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

describe('ESTADOS_MANUAIS: o que a MÃO pode escrever, e o que só a máquina escreve', () => {
  it('é DERIVADO da lista completa, e não uma segunda cópia', () => {
    // Uma cópia escrita à mão divergiria no dia em que um estado novo nascesse, e divergiria
    // falhando FECHADO: a borda recusaria um valor que o CHECK aceita, e o sintoma seria um
    // 422 sobre um estado legítimo.
    assert.deepEqual(
      ESTADOS_MANUAIS,
      ESTADOS_DE_DEFEITO.filter((e) => e !== EstadoDeDefeito.REGREDIU)
    );
    // E o controle ABSOLUTO ao lado, porque a igualdade acima sozinha passaria verde com as
    // duas listas erradas do mesmo jeito.
    assert.deepEqual([...ESTADOS_MANUAIS], ['aberto', 'resolvido', 'ignorado']);
  });

  it('`regrediu` está FORA, e é o único que está', () => {
    // Ele é a única transição automática do produto (o CASE de `UPSERT_DEFEITO`) e significa
    // um FATO sobre duas releases, não uma opinião. Escrito à mão seria um rótulo sem o fato
    // por trás, e a tela mostraria regressão onde não houve nenhuma.
    assert.equal(ESTADOS_MANUAIS.includes(EstadoDeDefeito.REGREDIU), false);
    assert.equal(ESTADOS_DE_DEFEITO.length - ESTADOS_MANUAIS.length, 1);
  });

  it('é congelado: ninguém acrescenta estado manual em runtime', () => {
    assert.equal(Object.isFrozen(ESTADOS_MANUAIS), true);
  });

  it('o Joi do PATCH aceita os três e recusa `regrediu` nomeando o campo', () => {
    // O TAMANHO PRIMEIRO: laço sobre coleção vazia é zero asserção e verde vazio, que é
    // exatamente o que `ebgeo-tests/no-unasserted-loop-assert` existe para pegar.
    assert.equal(ESTADOS_MANUAIS.length, 3);
    for (const estado of ESTADOS_MANUAIS) {
      const { error, value } = estadoDeDefeitoSchema.validate({ estado });
      assert.equal(error, undefined, `estado ${estado}`);
      assert.equal(value.estado, estado);
    }
    const { error } = estadoDeDefeitoSchema.validate({ estado: EstadoDeDefeito.REGREDIU });
    assert.ok(error, '`regrediu` tem de reprovar na borda de ESCRITA');
    assert.equal(error.details[0].path[0], 'estado');

    // NÃO-VACUIDADE PELO CONTRASTE COM O FILTRO: a MESMA string é aceita pelo schema de
    // LEITURA, o que prova que a recusa é do recorte e não de uma regra genérica.
    assert.equal(defeitosQuerySchema.validate({ estado: EstadoDeDefeito.REGREDIU }).error, undefined);
  });

  it('o corpo do PATCH exige `estado` e limita `commit` a 64', () => {
    assert.ok(estadoDeDefeitoSchema.validate({}).error, 'sem estado não há ato');
    assert.ok(estadoDeDefeitoSchema.validate({ estado: 'aberto', commit: 'x'.repeat(65) }).error);
    // 64 é o comprimento de um SHA-256 em hexadecimal, e o teto ESPELHA o CHECK da coluna
    // (`018_defeitos_e_ocorrencias.sql`): sem ele a recusa viria do banco como 23514, que a
    // borda traduz num erro sem relação aparente com o campo.
    assert.equal(estadoDeDefeitoSchema.validate({ estado: 'aberto', commit: 'x'.repeat(64) }).error, undefined);
    // Vazio e nulo são aceitos: "resolvi e não sei o commit" é o caso comum, e um campo
    // vazio vindo de formulário é a forma que ele toma.
    assert.equal(estadoDeDefeitoSchema.validate({ estado: 'resolvido', commit: '' }).error, undefined);
    assert.equal(estadoDeDefeitoSchema.validate({ estado: 'resolvido', commit: null }).error, undefined);
  });

  it('o corpo é FECHADO: campo desconhecido não vira coluna escrita por engano', () => {
    // `stripUnknown` descarta, e é o que impede um `resolvidoPor` no corpo de chegar ao
    // serviço: o ator sai de `req.user`, sempre.
    const { error, value } = estadoDeDefeitoSchema.validate(
      { estado: 'aberto', resolvidoPor: 'outra-pessoa' },
      { abortEarly: false, stripUnknown: true }
    );
    assert.equal(error, undefined);
    assert.deepEqual(Object.keys(value), ['estado']);
  });
});
