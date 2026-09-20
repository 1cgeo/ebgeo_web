// Path: tests/unit/email-de-recuperacao-cita-a-tela.test.js
//
// O E-MAIL DE RECUPERAÇÃO MANDA CLICAR EM BOTÕES, e os botões moram noutro pacote.
//
// CAUSA RAIZ. A tela de recuperação passou a ter DOIS passos em 2026-09-20 (pedir o código,
// redefinir), e o e-mail continuou dizendo "clique em Esqueci minha senha e cole o código". Quem
// abre a mensagem com o diálogo já fechado cai no passo que PEDE um código, sem campo nenhum para
// colar o que acabou de receber. A saída é o link "Já tenho um código", que o texto não nomeava.
//
// O que este arquivo prende é a CITAÇÃO: todo rótulo que o e-mail põe entre aspas tem de existir,
// com a mesma grafia, no diálogo de login do frontend. Renomear um botão lá sem tocar aqui reprova.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { sendPasswordResetEmail } from '../../src/utils/mailer.js';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const DIALOGO = readFileSync(join(RAIZ, 'frontend/src/js/modals/login.modal.js'), 'utf8');

/** Envia por um transporte que só guarda a mensagem. */
async function textoDoEmail(params) {
  let capturada = null;
  const transport = { sendMail: async (mensagem) => { capturada = mensagem; return {}; } };
  const resultado = await sendPasswordResetEmail(params, { exposeLink: false, transport });
  assert.equal(resultado.sent, true, 'a mensagem passou pelo transporte');
  assert.ok(capturada, 'o transporte recebeu a mensagem');
  return capturada.text;
}

describe('o e-mail de recuperação cita a tela como ela é', () => {
  it('nomeia os DOIS caminhos: a tela ainda aberta e a tela já fechada', async () => {
    const texto = await textoDoEmail({
      to: 'alvo@exemplo.mil.br', token: 'c0d1g0', nome: 'Cap Silva', minutes: 30,
      appLink: 'https://ebgeo.exemplo.mil.br/',
    });
    assert.match(texto, /Se a tela de recuperação ainda estiver aberta, cole o código nela/);
    assert.match(texto, /Se você já a fechou: abra o EBGeo em https:\/\/ebgeo\.exemplo\.mil\.br\//);
    assert.match(texto, /"Já tenho um código"/);
    assert.ok(texto.includes('c0d1g0'), 'o código continua no corpo');
  });

  it('todo rótulo entre aspas existe, com a mesma grafia, no diálogo de login', async () => {
    const texto = await textoDoEmail({ to: 'a@b.mil.br', token: 't', minutes: 30 });
    const citados = [...texto.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    // Contagem absoluta: um laço sobre lista vazia não verificaria nada.
    assert.deepEqual(citados, ['Entrar', 'Esqueci minha senha', 'Já tenho um código']);
    for (const rotulo of citados) {
      assert.ok(DIALOGO.includes(`'${rotulo}'`), `o diálogo de login não escreve mais "${rotulo}"`);
    }
  });

  it('sem link do app a frase continua gramatical', async () => {
    const texto = await textoDoEmail({ to: 'a@b.mil.br', token: 't', minutes: 30 });
    assert.match(texto, /Se você já a fechou: abra o EBGeo, clique em "Entrar"/);
  });

  it('não fala mais em "sessões abertas": a frase é a mesma que a tela usa', async () => {
    const texto = await textoDoEmail({ to: 'a@b.mil.br', token: 't', minutes: 30 });
    assert.match(texto, /você sai de todos os dispositivos e entra de novo com a senha nova/);
  });
});
