// Path: tests/unit/derrubar-conexao-so-de-cliente.test.js
//
// TODO `pg_terminate_backend` DESTE REPOSITÓRIO DERRUBA SÓ CONEXÃO DE CLIENTE.
//
// Seis arquivos criam e destroem banco (o runner do backend, os dois helpers de banco,
// a sonda de banco pré-consolidação e os dois harness de e2e), e todos os seis abrem a
// mesma janela: entre a decisão de derrubar e o `DROP DATABASE`, o autovacuum pode estar
// ligado ao banco alvo. Um papel comum NÃO pode sinalizar um worker de autovacuum, e o
// Postgres responde 42501 (`pg_signal_autovacuum_worker`) em vez de ignorar a linha.
//
// O efeito não é um teste vermelho, é a PERNA INTEIRA vermelha no SETUP, com uma
// mensagem que não nomeia nem a suíte nem a mudança sob teste. Medido nesta máquina
// antes do filtro: 4 vermelhos em 10 execuções de um arquivo só, e os dois `npm test`
// completos daquela sessão morreram assim. É a forma mais cara de verificação fantasma
// que a constituição descreve, invertida: não um verde que não verifica, um VERMELHO
// que não é do código.
//
// E derrubar aquele worker nem é necessário: o `DROP DATABASE` sinaliza os workers de
// autovacuum do banco alvo por conta própria. Quem ele não limpa sozinho é a conexão de
// CLIENTE, que é exatamente o que sobra depois do filtro.
//
// POR QUE ESTRUTURAL E POR QUE VARRENDO O VERSIONAMENTO. A correção é uma linha, e uma
// linha repetida em dez lugares é uma linha que vai faltar no décimo primeiro. O
// inventário vem de `git ls-files` e não de uma lista escrita à mão, pela mesma razão do
// censo de tipos de feição: alvo escrito à mão envelhece calado, e o arquivo novo é
// justamente o que a lista não conhece.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import { join, resolve } from 'path';

const RAIZ = resolve(import.meta.dirname, '../../..');
const CHAMADA = 'pg_terminate_backend';
const FILTRO = "backend_type = 'client backend'";

/**
 * O trecho de SQL que envolve UMA chamada, do nome da função até o fim plausível do
 * comando. 500 caracteres é folgado para qualquer uma das formas usadas aqui (uma
 * linha só, template de três linhas, concatenação) e curto o bastante para não
 * alcançar o comando seguinte.
 * @param {string} fonte
 * @param {number} indice - Onde a chamada começa.
 * @returns {string}
 */
function trechoDaChamada(fonte, indice) {
  return fonte.slice(indice, indice + 500);
}

/**
 * Toda chamada versionada, com o arquivo e o trecho ao redor.
 * @returns {Array<{ arquivo: string, trecho: string }>}
 */
function chamadasVersionadas() {
  const arquivos = execSync('git ls-files "*.js"', { cwd: RAIZ, encoding: 'utf-8' })
    .split('\n')
    .filter((linha) => linha.length > 0 && !linha.includes('node_modules'));
  const achados = [];
  for (const arquivo of arquivos) {
    const fonte = readFileSync(join(RAIZ, arquivo), 'utf-8');
    // O próprio nome da constante aparece neste arquivo de teste; ele se exclui.
    if (arquivo.endsWith('derrubar-conexao-so-de-cliente.test.js')) continue;
    let de = fonte.indexOf(CHAMADA);
    while (de !== -1) {
      achados.push({ arquivo, trecho: trechoDaChamada(fonte, de) });
      de = fonte.indexOf(CHAMADA, de + CHAMADA.length);
    }
  }
  return achados;
}

describe('derrubar conexão: só a de cliente', () => {
  it('toda chamada versionada de pg_terminate_backend filtra por backend_type', () => {
    const achados = chamadasVersionadas();

    // PISO. Sem ele, uma varredura que deixasse de casar qualquer coisa (git ls-files
    // mudando de forma, o nome da função mudando) passaria verde sobre lista vazia,
    // que é a cobertura vazia nomeada na constituição. O número é um MÍNIMO de
    // propósito: harness novo pode acrescentar chamada, e acrescentar não pode
    // reprovar aqui; o que reprova é acrescentar SEM o filtro, logo abaixo.
    assert.ok(
      achados.length >= 10,
      `esperava ao menos 10 chamadas versionadas, achei ${achados.length}: a varredura quebrou`
    );

    const semFiltro = achados.filter((a) => !a.trecho.includes(FILTRO));
    assert.deepEqual(
      semFiltro.map((a) => a.arquivo),
      [],
      'estas chamadas derrubariam um worker de autovacuum e levam 42501 no lugar do resultado'
    );
  });

  it('a varredura alcança os DOIS pacotes, não só aquele em que este teste mora', () => {
    // DISCRIMINAÇÃO de alcance. O `cwd` da varredura é a raiz do monorepo, e é fácil
    // "consertar" este arquivo apontando-o para `backend/` — aí ele fica verde e deixa
    // de ver os dois harness de e2e, que são metade das ocorrências.
    const pacotes = new Set(chamadasVersionadas().map((a) => a.arquivo.split('/')[0]));
    assert.ok(pacotes.has('backend'), `varredura sem backend: ${[...pacotes]}`);
    assert.ok(pacotes.has('frontend'), `varredura sem frontend: ${[...pacotes]}`);
  });

  it('CONTROLE NEGATIVO: o predicado ACUSA uma chamada sem o filtro', () => {
    // Sem esta metade, "nenhuma chamada sem filtro" também é o que se mede quando o
    // predicado casa qualquer coisa. A amostra é a forma exata que estava no runner
    // antes da correção.
    const amostra = `SELECT pg_terminate_backend(pg_stat_activity.pid)
      FROM pg_stat_activity
      WHERE pg_stat_activity.datname = $1
        AND pid <> pg_backend_pid()`;
    assert.equal(amostra.includes(FILTRO), false, 'a amostra ruim seria aprovada');

    const corrigida = amostra.replace('pg_backend_pid()', `pg_backend_pid() AND ${FILTRO}`);
    assert.equal(corrigida.includes(FILTRO), true, 'a amostra boa seria reprovada');
  });
});
