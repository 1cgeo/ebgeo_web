import { describe, it, expect } from 'vitest';
import {
    RETRY_ACTION_LABEL,
    DISMISS_ACTION_LABEL,
    layerDisplayName,
    formatLayerNameList,
    layerLoadFailureNotice,
    layerLoadFailureCauseNotice,
    layerLoadFailureStatusDetail,
    layerRetryStillFailingNotice,
    layerNoticeRegionLabel,
} from '../../src/js/terrain/data-layer-phrases.js';

// AS FRASES DA CAMADA QUE NÃO CARREGOU.
//
// O estado anterior era `catch (error) { console.error(...) }` e nada mais: a camada não pintava
// e a tela não dizia uma palavra.
//
// A OBJEÇÃO QUE ESTE ARQUIVO PRECISA RESPONDER é se a mensagem mascara o defeito que se quer
// consertar. A resposta é não, e ela está inteira na RESTRIÇÃO: a frase óbvia ("você não tem
// acesso") seria mentira ao menos tão frequentemente quanto verdade, porque as cláusulas 10.1 e
// 10.3 do estatuto apontam para lados OPOSTOS. Pela 10.1, o navegador pede o tile privado SEM
// credencial, então quem tem direito não vê a camada; pela 10.3, quem realmente perdeu o acesso
// vê camada QUEBRADA em vez de camada ausente. Some a rede caída e o servidor de tiles fora, e o
// que o cliente sabe é uma coisa só: o pedido não deu certo.
//
// Por isso a DISCRIMINAÇÃO cobrada aqui não é de redação: é que nenhuma frase afirme causa, e que
// a linha de ignorância exista. Uma asserção que só checasse `toContain('camada')` passaria verde
// com "você não tem acesso a esta camada", que é exatamente o texto proibido.
//
// E A CONTAGEM É POR CAMADA, NUNCA POR PEDIDO. Uma camada visível em zoom baixo pede dezenas de
// tiles, e o MapLibre dispara um evento `error` por pedido falho. Toda função daqui recebe NOMES
// DE CAMADA, e é isso que impede a frase "42 falhas" sobre uma camada só.

describe('layerDisplayName — a camada sem nome ainda é uma camada', () => {
    it('devolve o nome quando há nome', () => {
        expect(layerDisplayName('Molduras')).toBe('Molduras');
        expect(layerDisplayName('  Molduras  ')).toBe('Molduras');
    });

    it('o último recurso NÃO é string vazia, senão a lista encurta sem a contagem baixar', () => {
        expect(layerDisplayName(null)).toBe('Camada sem nome');
        expect(layerDisplayName(undefined)).toBe('Camada sem nome');
        expect(layerDisplayName('')).toBe('Camada sem nome');
        expect(layerDisplayName('   ')).toBe('Camada sem nome');
    });
});

describe('formatLayerNameList — a junção em pt-BR', () => {
    it('vazio é vazio, para não existir aviso sobre nada', () => {
        expect(formatLayerNameList([])).toBe('');
        expect(formatLayerNameList(null)).toBe('');
        expect(formatLayerNameList(undefined)).toBe('');
    });

    it('um, dois e três', () => {
        expect(formatLayerNameList(['A'])).toBe('"A"');
        expect(formatLayerNameList(['A', 'B'])).toBe('"A" e "B"');
        expect(formatLayerNameList(['A', 'B', 'C'])).toBe('"A", "B" e "C"');
    });

    it('colapsa duplicata: a mesma camada que falhou duas vezes é UMA camada', () => {
        expect(formatLayerNameList(['A', 'A'])).toBe('"A"');
        expect(formatLayerNameList(['A', 'B', 'A'])).toBe('"A" e "B"');
    });

    it('preserva a ordem em que as camadas falharam', () => {
        expect(formatLayerNameList(['C', 'A'])).toBe('"C" e "A"');
    });
});

describe('layerLoadFailureNotice — o fato, e só o fato', () => {
    it('vazio para lista vazia', () => {
        expect(layerLoadFailureNotice([])).toBe('');
        expect(layerLoadFailureNotice(null)).toBe('');
    });

    it('uma camada', () => {
        expect(layerLoadFailureNotice(['Molduras']))
            .toBe('A camada "Molduras" não pôde ser carregada.');
    });

    it('várias camadas, com a contagem batendo com a lista', () => {
        expect(layerLoadFailureNotice(['A', 'B']))
            .toBe('2 camadas não puderam ser carregadas: "A" e "B".');
        expect(layerLoadFailureNotice(['A', 'B', 'C']))
            .toBe('3 camadas não puderam ser carregadas: "A", "B" e "C".');
    });

    it('a duplicata baixa a contagem junto com a lista, e não só a lista', () => {
        // Se a contagem viesse do array cru e a lista do formatador, esta seria "2 camadas ... A".
        expect(layerLoadFailureNotice(['A', 'A'])).toBe('A camada "A" não pôde ser carregada.');
    });

    it('NÃO afirma causa nenhuma, que é o ponto do módulo inteiro', () => {
        const frase = layerLoadFailureNotice(['A', 'B']);
        expect(frase).not.toMatch(/acesso/i);
        expect(frase).not.toMatch(/permiss/i);
        expect(frase).not.toMatch(/rede/i);
        expect(frase).not.toMatch(/servidor/i);
        expect(frase).not.toMatch(/offline/i);
    });

    it('não diz "vazia" nem "não existe": não responder é diferente de responder nada', () => {
        const frase = layerLoadFailureNotice(['A']);
        expect(frase).not.toMatch(/vazia/i);
        expect(frase).not.toMatch(/não existe/i);
        expect(frase).not.toMatch(/sem feições/i);
    });
});

describe('layerLoadFailureCauseNotice — a ignorância, dita em voz alta', () => {
    const frase = layerLoadFailureCauseNotice();

    it('declara que o motivo NÃO é conhecido', () => {
        expect(frase).toMatch(/não é conhecido|não sabe/i);
    });

    it('lista os três candidatos SEM escolher um', () => {
        expect(frase).toMatch(/rede/i);
        expect(frase).toMatch(/servidor/i);
        expect(frase).toMatch(/acesso/i);
        // DISCRIMINAÇÃO: "pode ser" é o que separa hipótese de acusação. Sem esta asserção,
        // trocar a frase por "você não tem acesso" ainda casaria com as três de cima.
        expect(frase).toContain('pode ser');
        expect(frase).not.toMatch(/você não tem/i);
    });

    it('põe o acesso por ÚLTIMO, depois dos dois motivos triviais', () => {
        // É a leitura a que a pessoa chega sozinha, e a mais provável de estar errada (10.1).
        expect(frase.indexOf('rede')).toBeLessThan(frase.indexOf('acesso'));
        expect(frase.indexOf('servidor')).toBeLessThan(frase.indexOf('acesso'));
    });

    it('é pt-BR acentuado e sem em-dash', () => {
        expect(frase).not.toContain('—');
        expect(frase).toMatch(/[áàâãéêíóôõúç]/i);
    });
});

describe('layerLoadFailureStatusDetail — só o que foi observado', () => {
    it('nada observado, nada escrito (o caso comum da falha de rede)', () => {
        expect(layerLoadFailureStatusDetail([])).toBe('');
        expect(layerLoadFailureStatusDetail(null)).toBe('');
        expect(layerLoadFailureStatusDetail(undefined)).toBe('');
    });

    it('um código', () => {
        expect(layerLoadFailureStatusDetail([403])).toBe('O servidor respondeu 403.');
    });

    it('vários, em ordem e sem repetir', () => {
        expect(layerLoadFailureStatusDetail([500, 403, 403])).toBe('O servidor respondeu 403, 500.');
        expect(layerLoadFailureStatusDetail(new Set([404, 403]))).toBe('O servidor respondeu 403, 404.');
    });

    it('NÃO interpreta o código: um 403 não vira "sem acesso"', () => {
        const frase = layerLoadFailureStatusDetail([403]);
        expect(frase).not.toMatch(/acesso/i);
        expect(frase).not.toMatch(/proibid/i);
        expect(frase).not.toMatch(/permiss/i);
    });

    it('zero NÃO é resposta: o fetch usa 0 para pedido bloqueado ou abortado', () => {
        expect(layerLoadFailureStatusDetail([0])).toBe('');
        expect(layerLoadFailureStatusDetail([0, 403])).toBe('O servidor respondeu 403.');
    });

    it('recusa tudo que não é código HTTP de verdade', () => {
        expect(layerLoadFailureStatusDetail([NaN, Infinity, null, undefined, 'abc'])).toBe('');
        expect(layerLoadFailureStatusDetail([99])).toBe('');
        expect(layerLoadFailureStatusDetail([600])).toBe('');
        expect(layerLoadFailureStatusDetail([403.5])).toBe('');
        expect(layerLoadFailureStatusDetail([-403])).toBe('');
        // String numérica ainda é o código que chegou pela rede.
        expect(layerLoadFailureStatusDetail(['404'])).toBe('O servidor respondeu 404.');
    });
});

describe('layerRetryStillFailingNotice — a segunda falha não é a primeira', () => {
    it('vazio para lista vazia', () => {
        expect(layerRetryStillFailingNotice([])).toBe('');
        expect(layerRetryStillFailingNotice(null)).toBe('');
    });

    it('nomeia a nova tentativa, no singular e no plural', () => {
        expect(layerRetryStillFailingNotice(['A']))
            .toBe('A camada "A" continua sem carregar após a nova tentativa.');
        expect(layerRetryStillFailingNotice(['A', 'B']))
            .toBe('2 camadas continuam sem carregar após a nova tentativa: "A" e "B".');
    });

    it('é DIFERENTE da primeira frase, senão o botão parece inerte', () => {
        // Repetir a abertura depois do clique não distingue "falhou de novo" de "a tela travou".
        expect(layerRetryStillFailingNotice(['A'])).not.toBe(layerLoadFailureNotice(['A']));
        expect(layerRetryStillFailingNotice(['A', 'B'])).not.toBe(layerLoadFailureNotice(['A', 'B']));
    });

    it('continua sem inventar causa', () => {
        const frase = layerRetryStillFailingNotice(['A']);
        expect(frase).not.toMatch(/acesso/i);
        expect(frase).not.toMatch(/permiss/i);
    });
});

describe('rótulos das ações e da região', () => {
    it('o botão OFERECE tentar de novo, que é o que o produto pede', () => {
        expect(RETRY_ACTION_LABEL).toBe('Tentar de novo');
        expect(DISMISS_ACTION_LABEL).toBe('Dispensar');
        expect(RETRY_ACTION_LABEL).not.toBe(DISMISS_ACTION_LABEL);
    });

    it('a região tem nome para quem lê por leitor de tela', () => {
        expect(layerNoticeRegionLabel()).toBe('Aviso de camada que não carregou');
        expect(layerNoticeRegionLabel()).not.toContain('—');
    });
});
