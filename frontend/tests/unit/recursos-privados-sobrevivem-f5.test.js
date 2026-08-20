import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// A SOMA DOS RECURSOS PRIVADOS PRECISA SOBREVIVER AO F5.
//
// `syncEngine.login()` chama `refreshVisibleResources` no GESTO de entrar, e só
// ali. Um recarregamento não passa por `login()`: ele restaura a sessão por
// `restoreSessionFromStorage` (`index.js`), e enquanto essa função não somava, o
// catálogo de quem tem papel global ou concessão perdia TODO o privado a cada F5,
// voltando só depois de um logout seguido de login. O sumiço não deixa erro nenhum
// e o usuário o lê como "tiraram meu acesso".
//
// POR QUE UM TESTE ESTRUTURAL, e não um de comportamento: o defeito mora no BOOT
// de `index.js`, que só existe dentro de um navegador (MapLibre, IndexedDB, quatro
// fases de inicialização). A camada hermética não o alcança e a de contrato não
// abre navegador; o comportamento em si foi verificado por captura do Playwright.
// O que este arquivo prende é a única coisa que se pode prender aqui de graça: que
// a chamada não SAIA de novo numa refatoração do caminho de restauração.

const INDEX = fileURLToPath(new URL('../../src/js/index.js', import.meta.url));

/** O corpo de uma função de nível superior, do `async function X` até a chave que o fecha. */
function corpoDaFuncao(fonte, nome) {
    const inicio = fonte.indexOf(`async function ${nome}(`);
    if (inicio < 0) return null;
    // As funções de `index.js` são de nível superior, então a primeira linha que
    // começa com `}` na coluna zero fecha esta e nenhuma outra.
    const fim = fonte.indexOf('\n}', inicio);
    return fim < 0 ? fonte.slice(inicio) : fonte.slice(inicio, fim + 2);
}

describe('o boot re-soma os recursos privados ao restaurar a sessão', () => {
    const fonte = readFileSync(INDEX, 'utf8');

    it('`index.js` importa `refreshVisibleResources`', () => {
        expect(fonte).toContain("import { refreshVisibleResources } from '@store/sync/resource-access.service.js'");
    });

    it('e `restoreSessionFromStorage` a CHAMA', () => {
        const corpo = corpoDaFuncao(fonte, 'restoreSessionFromStorage');
        // A guarda do próprio guarda: se a função for renomeada, este teste precisa
        // falhar dizendo isso, e não passar verde por não ter achado nada que medir.
        expect(corpo, 'a função `restoreSessionFromStorage` sumiu de index.js — o guarda perdeu o alvo').not.toBeNull();
        expect(corpo).toContain('refreshVisibleResources(');
    });

    it('o extrator realmente recorta (controle: não devolve o arquivo inteiro)', () => {
        // Sem isto, um extrator quebrado que devolvesse a fonte toda faria o caso
        // acima passar verde por conter a chamada em QUALQUER lugar do arquivo.
        const corpo = corpoDaFuncao(fonte, 'restoreSessionFromStorage');
        expect(corpo.length).toBeLessThan(fonte.length / 2);
        expect(corpo).not.toContain('async function initApp(');
    });
});
