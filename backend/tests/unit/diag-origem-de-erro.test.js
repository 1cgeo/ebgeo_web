// Path: tests/unit/diag-origem-de-erro.test.js
// O VOCABULÁRIO DE ORIGEM VIVE DUAS VEZES, e este arquivo é o que impede as duas de
// divergirem: `ORIGENS_DE_ERRO` (`src/modules/diag/origens-de-erro.js`), de onde o Joi da
// borda deriva a lista, e o CHECK `defeitos_origem_check`, alargado para onze valores em
// `src/database/migrations/018_defeitos_e_ocorrencias.sql` (ele nasceu com dez em
// `017_erro_cliente_identidade.sql`, sob o nome antigo da tabela).
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
//    dentro de uma lista de onze strings.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ORIGENS_DE_ERRO,
  ORIGENS_DO_CLIENTE,
  OrigemDeErro,
} from '../../src/modules/diag/origens-de-erro.js';
import { erroDeClienteSchema } from '../../src/modules/diag/diag.schemas.js';

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MIGRACAO = path.join(RAIZ, 'src/database/migrations/018_defeitos_e_ocorrencias.sql');
const MODULO = path.join(RAIZ, 'src/modules/diag/origens-de-erro.js');

/**
 * Os valores do CHECK, lidos do texto da migração.
 *
 * O recorte começa no nome do constraint e termina no `);` do bloco, para que nenhum outro
 * literal do arquivo (um COMMENT, por exemplo) entre na lista por acidente.
 */
function valoresDoCheck(nome = 'defeitos_origem_check') {
  const sql = fs.readFileSync(MIGRACAO, 'utf8');
  // O fecho aceita indentação porque o `ADD CONSTRAINT` mora dentro de um bloco `DO $$ ... $$`
  // (idempotência: o Postgres não tem `ADD CONSTRAINT IF NOT EXISTS`), e ali a linha do `);`
  // não começa na coluna zero.
  // O nome do constraint aparece TRÊS vezes no arquivo (na lista de renomeações, no
  // `DROP CONSTRAINT IF EXISTS` e no `ADD CONSTRAINT`), e só a última é seguida de `CHECK`.
  // É o `\s+CHECK` que faz o recorte cair na definição, e não numa das outras duas.
  const bloco = sql.match(new RegExp(`${nome}\\s+CHECK\\s*\\(([\\s\\S]*?)\\n\\s*\\)`));
  assert.ok(bloco, `o CHECK ${nome} precisa existir no arquivo da migração`);
  const literais = bloco[1].match(/'[^']+'/g);
  assert.ok(literais, 'o CHECK precisa enumerar valores; sem isto a comparação seria vazia');
  return literais.map((l) => l.slice(1, -1));
}

describe('Origem do erro de cliente — o JS e o CHECK dizem a MESMA coisa', () => {
  it('as duas listas são iguais, na mesma ordem', () => {
    const doCheck = valoresDoCheck();
    // Guarda de não-vacuidade ANTES da comparação: duas listas vazias seriam iguais, e o
    // verde não estaria provando nada.
    assert.equal(doCheck.length, 11, `o CHECK precisa ter onze valores, tem ${doCheck.length}`);
    assert.equal(ORIGENS_DE_ERRO.length, 11);
    assert.deepEqual([...ORIGENS_DE_ERRO], doCheck);
  });

  it('a OCORRÊNCIA carrega a MESMA lista, e ela é o segundo lugar onde ela vive', () => {
    // `defeito_ocorrencias.origem` tem CHECK próprio, no MESMO arquivo, e o Postgres não
    // permite compartilhar a expressão entre duas tabelas. Duas listas literais lado a lado
    // divergem na próxima origem nova, e a divergência seria SILENCIOSA: o defeito entraria e
    // a ocorrência dele seria recusada com 23514 dentro da mesma transação, que o serviço
    // trata como falha e descarta. O teste compara as duas, valor a valor e na ordem.
    const doDefeito = valoresDoCheck('defeitos_origem_check');
    const daOcorrencia = valoresDoCheck('defeito_ocorrencias_origem_check');
    assert.equal(daOcorrencia.length, 11, `esperava onze, achei ${daOcorrencia.length}`);
    assert.deepEqual(daOcorrencia, doDefeito);
  });

  it('a lista é exatamente a esperada, escrita à mão (controle absoluto)', () => {
    // Sem este caso, o anterior compara duas cópias UMA COM A OUTRA e passaria verde com as
    // duas erradas do mesmo jeito — que é como um espelho falha.
    assert.deepEqual([...ORIGENS_DE_ERRO], [
      'boot', 'nao-tratado', 'rejeicao', 'console', 'store',
      'ws', 'maplibre', 'cesium', 'sv360', 'indisponivel', 'servidor',
    ]);
    assert.equal(new Set(ORIGENS_DE_ERRO).size, ORIGENS_DE_ERRO.length, 'sem repetido');
  });

  it('`OrigemDeErro` cobre a lista inteira e nada além dela', () => {
    const valores = Object.values(OrigemDeErro);
    assert.equal(valores.length, ORIGENS_DE_ERRO.length);
    assert.deepEqual(valores.sort(), [...ORIGENS_DE_ERRO].sort());
    assert.equal(OrigemDeErro.NAO_TRATADO, 'nao-tratado', 'a chave é ASCII, o valor é o do banco');
    assert.equal(OrigemDeErro.INDISPONIVEL, 'indisponivel');
    // O décimo primeiro é o que NÃO vem de navegador nenhum, e ele fica por último de
    // propósito: os dez primeiros são a ordem do ciclo de vida do cliente, e enfiá-lo no
    // meio embaralharia a única coisa que a ordem desta lista significa.
    assert.equal(OrigemDeErro.SERVIDOR, 'servidor');
    assert.equal(ORIGENS_DE_ERRO[ORIGENS_DE_ERRO.length - 1], 'servidor');
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

  it('aceita cada uma das DEZ do cliente', () => {
    assert.equal(ORIGENS_DO_CLIENTE.length, 10);
    for (const origem of ORIGENS_DO_CLIENTE) {
      const { error, value } = erroDeClienteSchema.validate(corpo({ origem }));
      assert.equal(error, undefined, `origem ${origem}`);
      assert.equal(value.origem, origem);
    }
  });

  it('RECUSA `servidor` vindo do corpo: a rota é anônima, e procedência não se declara', () => {
    // O CHECK do banco ACEITA `servidor` (é a mesma coluna que o agregador de 5xx escreve),
    // então sem este recorte na borda qualquer visitante carimbaria um relato como se fosse
    // o servidor falando, e o filtro `origem=servidor` da tela deixaria de significar
    // procedência. Não é escalação de privilégio: a coluna não autoriza nada. É
    // falsificação, e numa tela de diagnóstico ela custa a confiança no recorte inteiro.
    const { error } = erroDeClienteSchema.validate(corpo({ origem: 'servidor' }));
    assert.ok(error, '`servidor` não pode entrar pela rota anônima');
    assert.equal(error.details[0].path[0], 'origem');
  });

  it('a lista do cliente é a do CHECK menos `servidor`, e nada mais', () => {
    // Comparação por DIFERENÇA e não por literal escrito à mão: o que precisa continuar
    // valendo é a RELAÇÃO entre as duas listas, e uma origem nova tem de entrar nas duas de
    // graça. Um literal aqui envelheceria falhando ABERTO, deixando a origem nova fora da
    // borda do cliente sem nada ficar vermelho.
    const aMenos = ORIGENS_DE_ERRO.filter((o) => !ORIGENS_DO_CLIENTE.includes(o));
    assert.deepEqual(aMenos, ['servidor']);
    assert.equal(ORIGENS_DO_CLIENTE.length, ORIGENS_DE_ERRO.length - 1);
    assert.equal(Object.isFrozen(ORIGENS_DO_CLIENTE), true);
    // E a ORDEM é preservada: a lista do cliente é uma SUBSEQUÊNCIA da completa, não um
    // conjunto. Afirmar isso por POSIÇÃO (`slice(0, 10)`) prenderia o teste ao lugar em que
    // `'servidor'` está hoje, e passaria a reprovar no dia em que uma origem de navegador
    // nova entrasse depois dele, que é uma mudança legítima. Índices estritamente crescentes
    // dizem a propriedade que importa sem dizer onde ela está.
    const posicoes = ORIGENS_DO_CLIENTE.map((o) => ORIGENS_DE_ERRO.indexOf(o));
    assert.equal(posicoes.includes(-1), false, 'toda origem do cliente está na lista completa');
    assert.deepEqual(posicoes, [...posicoes].sort((a, b) => a - b), 'a ordem relativa mudou');
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
