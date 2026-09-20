// Path: tests/unit/cadastro-sob-demanda.test.js

/**
 * @fileoverview As duas decisões de `modals/signup-launcher.js` que não são fiação.
 *
 * O cadastro deixou de viajar no boot do mapa e de `atlas.html` em 2026-09-20: ele é tela de uma
 * visita só, e passou a ser buscado no clique de "Criar conta". Trocar um import estático por um
 * `import()` não precisaria de teste nenhum; o que precisa é o que a troca CRIA, que é um gesto
 * capaz de falhar. Duas coisas decidem esse desfecho, e as duas são puras:
 *
 *   1. O MEMO, e sobretudo o ESQUECIMENTO dele. Uma promessa rejeitada guardada para sempre é um
 *      botão que responde "não" pelo resto da sessão a quem voltou a ter rede e clicou de novo,
 *      que é exatamente o caso para o qual a nova tentativa existe.
 *   2. A FRASE, cujas duas metades chegam ao MESMO ato (recarregar) por caminhos diferentes, e é a
 *      CONDIÇÃO que muda. Mandar recarregar quem está sem rede o joga num boot que é fail-fast em
 *      `GET /api/config`, ou seja, troca a tela que ele tem pela de indisponibilidade; online, a
 *      causa que sobra é o build trocado sob uma sessão aberta, e aí o recarregamento é imediato.
 *
 * POR QUE A FRASE NÃO OFERECE "clique de novo", que era a primeira versão dela: o navegador guarda
 * o módulo que falhou como falho no MAPA DE MÓDULOS da página, então todo `import()` seguinte do
 * MESMO especificador é recusado sem tocar na rede. Medido em Chromium em 2026-09-20, com o pedido
 * interceptado uma vez e depois liberado: o segundo clique gerou ZERO pedidos e o mesmo
 * `TypeError`, enquanto o mesmo arquivo sob outra query (`?tentativa=2`) carregou normalmente.
 * A prova em navegador é `tests/e2e-ui/cadastro-sob-demanda.spec.js`.
 *
 * ESTE ARQUIVO NÃO CARREGA O MODAL, e é por isso que ele roda em node: `signup-launcher.js` tem
 * ZERO imports estáticos, e o único `import()` dele mora dentro de uma closure que nenhum caso
 * daqui dispara. `memoizarCarga` é exercitada com carregadores falsos, que é o que permite medir o
 * esquecimento sem uma rede.
 */

import { describe, it, expect } from 'vitest';
import {
    cadastroIndisponivelTexto,
    memoizarCarga,
} from '../../src/js/modals/signup-launcher.js';

describe('memoizarCarga', () => {
    it('duas chamadas concorrentes dividem UMA carga', async () => {
        // Este é o outro lado da proteção contra clique duplo: o sinalizador do modal impede um
        // segundo `showSignupModal`, e o memo impede um segundo download.
        let chamadas = 0;
        const carregar = memoizarCarga(async () => { chamadas += 1; return { ok: true }; });
        const [a, b] = await Promise.all([carregar(), carregar()]);
        expect(chamadas).toBe(1);
        expect(a).toBe(b);
        expect(a).toEqual({ ok: true });
    });

    it('a carga que deu certo fica, e não se repete no clique seguinte', async () => {
        let chamadas = 0;
        const carregar = memoizarCarga(async () => { chamadas += 1; return chamadas; });
        expect(await carregar()).toBe(1);
        expect(await carregar()).toBe(1);
        expect(chamadas).toBe(1);
    });

    it('a carga que FALHOU é esquecida, e a próxima tentativa tenta de verdade', async () => {
        // O caso que dá nome ao arquivo. Sem o esquecimento, a segunda linha abaixo receberia a
        // MESMA rejeição sem tocar na rede, e o botão ficaria morto até um F5.
        let chamadas = 0;
        const carregar = memoizarCarga(async () => {
            chamadas += 1;
            if (chamadas === 1) throw new Error('chunk 404');
            return 'chegou';
        });
        await expect(carregar()).rejects.toThrow('chunk 404');
        expect(await carregar()).toBe('chegou');
        expect(chamadas).toBe(2);
    });

    it('o carregador que lança SINCRONAMENTE também é esquecido', async () => {
        // Borda: `import()` não lança síncrono, mas `Promise.resolve().then(...)` é o que garante
        // isso. Trocado por `carregar()` direto, esta exceção escaparia ANTES de o memo ser
        // escrito, e o caso seguinte (a repetição) continuaria verde por acidente.
        let chamadas = 0;
        const carregar = memoizarCarga(() => {
            chamadas += 1;
            throw new Error('explodiu antes da promessa');
        });
        await expect(carregar()).rejects.toThrow('explodiu antes da promessa');
        await expect(carregar()).rejects.toThrow('explodiu antes da promessa');
        expect(chamadas).toBe(2);
    });

    it('a rejeição de uma carga não deixa rejeição não tratada para a seguinte', async () => {
        // Controle do formato: quem chama duas vezes seguidas depois de uma falha precisa receber
        // DUAS rejeições próprias, e não uma promessa já morta compartilhada.
        const carregar = memoizarCarga(async () => { throw new Error('sem rede'); });
        const primeira = carregar().catch((e) => e.message);
        const segunda = carregar().catch((e) => e.message);
        expect(await primeira).toBe('sem rede');
        expect(await segunda).toBe('sem rede');
    });
});

describe('cadastroIndisponivelTexto', () => {
    const OFFLINE = cadastroIndisponivelTexto(false);
    const ONLINE = cadastroIndisponivelTexto(true);

    it('offline nomeia a rede e CONDICIONA o recarregamento à volta dela', () => {
        // A metade que uma frase única perderia: recarregar sem rede troca a tela que a pessoa tem
        // pela de indisponibilidade, porque o boot do mapa é fail-fast em `GET /api/config`.
        expect(OFFLINE).toContain('Sem conexão');
        expect(OFFLINE).toContain('Quando a rede voltar');
        expect(OFFLINE).toContain('atualize a página');
        expect(OFFLINE.indexOf('Quando a rede voltar'))
            .toBeLessThan(OFFLINE.indexOf('atualize a página'));
    });

    it('online nomeia o build trocado e manda recarregar AGORA', () => {
        expect(ONLINE).toContain('atualizado no servidor');
        expect(ONLINE).toContain('atualize a página');
        expect(ONLINE).not.toContain('Quando a rede voltar');
    });

    it('nenhuma das duas promete que clicar de novo resolve', () => {
        // O mapa de módulos do navegador guarda a falha (ver o `@fileoverview`), então uma frase
        // que mandasse tentar de novo ensinaria a pessoa a confiar num botão que não pode
        // funcionar. Este caso é o que impede a frase de voltar a prometer isso.
        for (const frase of [OFFLINE, ONLINE]) {
            expect(frase.toLowerCase()).not.toContain('tente de novo');
            expect(frase.toLowerCase()).not.toContain('tentar de novo');
            expect(frase.toLowerCase()).not.toContain('clique de novo');
        }
    });

    it('as duas metades são frases DIFERENTES', () => {
        // Controle de vácuo: uma implementação que devolvesse sempre a mesma frase passaria em
        // metade das asserções acima sem decidir nada.
        expect(OFFLINE).not.toBe(ONLINE);
    });

    it('um valor desconhecido cai na frase cujo conselho serve AGORA', () => {
        // `navigator.onLine` ausente é um navegador que não sabe, e não um navegador offline: a
        // degradação escolhida é a frase que manda agir, e não a que manda esperar.
        for (const valor of [undefined, null, 0, '', NaN, 'talvez']) {
            expect(cadastroIndisponivelTexto(valor)).toBe(ONLINE);
        }
    });

    it('as duas são pt-BR de uma linha, sem travessão e sem jargão de chunk', () => {
        for (const frase of [OFFLINE, ONLINE]) {
            expect(frase.endsWith('.')).toBe(true);
            expect(frase).not.toContain('—');
            expect(frase.toLowerCase()).not.toContain('chunk');
            expect(frase.toLowerCase()).not.toContain('import');
            expect(frase.toLowerCase()).not.toContain('módulo');
        }
    });
});
