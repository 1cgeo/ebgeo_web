// Path: tests/unit/calibracao-saida.test.js

/**
 * @fileoverview O núcleo puro da saída da calibração.
 *
 * O QUE ESTE VERDE ESTARIA PROVANDO SE O CÓDIGO ESTIVESSE ERRADO. O defeito que este módulo
 * existe para impedir é a perda de horas de alinhamento: o botão "← Projetos" chamava
 * `showProjectSelector()`, que começa por `teardownSubsystems()`, sem consultar `isDirty()`. Então
 * o caso que importa é o par (sujo, voluntário) devolver PERGUNTAR, e ele leva asserção absoluta.
 *
 * A SEGUNDA METADE É A DIREÇÃO OPOSTA, e é a que um teste ingênuo esqueceria: perguntar a quem
 * não está mais no teclado (expiração por inatividade) não é cuidado, é um diálogo que ninguém lê
 * enquanto o `replace` já aconteceu. Por isso (sujo, involuntário) tem de devolver AVISAR, e não
 * PERGUNTAR, e por isso o par existe.
 *
 * As frases são asseridas por PROPRIEDADE e não por texto inteiro. O que não pode voltar é a
 * afirmação falsa (nomear `admin` como único papel que calibra); a redação exata é livre, e
 * prendê-la trocaria um teste frágil por outro.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
    CalibrationExit,
    CalibrationExitParam,
    CALIBRATION_LOST_PARAM,
    calibrationExitDecision,
    calibrationExitNotice,
} from '../../src/js/calibration/exit-decision.js';

describe('calibrationExitDecision', () => {
    it('sujo e voluntário PERGUNTA — é o crítico C1, o botão que descartava sem perguntar', () => {
        expect(calibrationExitDecision({ dirty: true, voluntary: true }))
            .toBe(CalibrationExit.PERGUNTAR);
    });

    it('sujo e INVOLUNTÁRIO apenas AVISA, porque não há ninguém para responder', () => {
        expect(calibrationExitDecision({ dirty: true, voluntary: false }))
            .toBe(CalibrationExit.AVISAR);
    });

    it('limpo SEGUE nos dois sentidos, sem diálogo e sem aviso de perda que não houve', () => {
        expect(calibrationExitDecision({ dirty: false, voluntary: true }))
            .toBe(CalibrationExit.SEGUIR);
        expect(calibrationExitDecision({ dirty: false, voluntary: false }))
            .toBe(CalibrationExit.SEGUIR);
    });

    it('falha para o lado de PERGUNTAR quando a vontade é desconhecida', () => {
        // A assimetria é o desenho: perguntar a quem não queria sair custa um clique; não
        // perguntar a quem queria ficar custa o trabalho.
        expect(calibrationExitDecision({ dirty: true })).toBe(CalibrationExit.PERGUNTAR);
    });

    it('sem argumento nenhum SEGUE, em vez de lançar', () => {
        // Chamador que perdeu o estado não pode travar a saída da página.
        expect(calibrationExitDecision()).toBe(CalibrationExit.SEGUIR);
        expect(calibrationExitDecision({})).toBe(CalibrationExit.SEGUIR);
    });

    it('só o booleano verdadeiro conta como sujo, e nada de truthy', () => {
        // `dirty` vem de `isDirty()`, que devolve booleano. Aceitar truthy faria uma string vazia
        // ou um zero mudarem a decisão silenciosamente se a origem mudasse de forma.
        for (const valor of ['sim', 1, {}, []]) {
            expect(calibrationExitDecision({ dirty: valor })).toBe(CalibrationExit.SEGUIR);
        }
    });
});

describe('calibrationExitNotice', () => {
    it('cobre os TRÊS valores declarados, e o censo vem do enum e não de uma lista escrita aqui', () => {
        // Sem isto, um valor novo em `CalibrationExitParam` nasceria sem frase e a tela ficaria
        // muda exatamente no caso novo, que é o menos testado à mão.
        for (const valor of Object.values(CalibrationExitParam)) {
            const aviso = calibrationExitNotice(valor);
            expect(aviso, `sem frase para ${valor}`).not.toBeNull();
            expect(aviso.message.length).toBeGreaterThan(20);
            expect(aviso.tone).toMatch(/^(warning|info|error|success)$/);
        }
    });

    it('a perda de alinhamento nomeia o que se perdeu e não promete recuperação', () => {
        const aviso = calibrationExitNotice(CalibrationExitParam.NAO_SALVA);
        expect(aviso.message).toMatch(/alinhamento/i);
        expect(aviso.tone).toBe('warning');
        // O alinhamento vivia só na memória da outra página: prometer volta seria mentira.
        expect(aviso.message).not.toMatch(/recuper|restaur|desfaz/i);
    });

    it('a recusa por papel NÃO diz que admin é o único que calibra, e não manda recarregar', () => {
        // A frase anterior desta recusa afirmava as duas coisas, e as duas eram falsas desde que
        // o gate da página passou a aceitar `isProducer()`. Recarregar não muda papel.
        const aviso = calibrationExitNotice(CalibrationExitParam.SEM_PAPEL);
        expect(aviso.message).toMatch(/produz|OM/i);
        expect(aviso.message).not.toMatch(/recarregue|recarregar/i);
        expect(aviso.message).not.toMatch(/único|unico/i);
    });

    it('a recusa por falta de sessão convida a entrar, e não culpa o papel', () => {
        const aviso = calibrationExitNotice(CalibrationExitParam.SEM_SESSAO);
        expect(aviso.message).toMatch(/entrar|entre/i);
        expect(aviso.tone).toBe('info');
    });

    it('valor desconhecido, vazio ou ausente devolve nulo', () => {
        // URL montada à mão não pode fazer o mapa lamentar um trabalho que ninguém fez.
        for (const valor of [null, undefined, '', 'qualquer-coisa', 'NAO-SALVA', 0]) {
            expect(calibrationExitNotice(valor)).toBeNull();
        }
    });

    it('o atalho histórico continua apontando para o valor de perda', () => {
        expect(CALIBRATION_LOST_PARAM).toBe(CalibrationExitParam.NAO_SALVA);
    });
});

/**
 * A FIACAO, e nao so o nucleo.
 *
 * Os casos acima passariam inteiros com `onBackToProjects` voltando a chamar
 * `showProjectSelector()` direto: o modulo puro continuaria certo e o critico continuaria aberto.
 * Isto e exatamente a cobertura vazia que a constituicao descreve, e o remedio da casa e a
 * asserção ESTRUTURAL sobre o texto do arquivo (mesmo padrao de
 * `aba-mapas-acoes-por-estado.test.js`).
 *
 * Ancorado na PROPRIEDADE ('o callback nao chama o seletor direto') e nao no nome exato da
 * funcao intermediaria, para nao obrigar o proximo a escrever igual em vez de escrever certo.
 */
describe('a fiacao das saidas da calibracao', () => {
    const ler = (rel) => readFileSync(
        fileURLToPath(new URL(`../../src/js/calibration/${rel}`, import.meta.url)), 'utf8',
    );
    const semComentarios = (src) => src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');

    it('onBackToProjects NAO chama showProjectSelector direto (o critico C1)', () => {
        const app = semComentarios(ler('app.js'));
        expect(app).toMatch(/onBackToProjects:/);
        expect(app).not.toMatch(/onBackToProjects:\s*\(\)\s*=>\s*showProjectSelector\(\)/);
    });

    it('toda saida da PAGINA passa pelo guarda, inclusive o fim de sessao', () => {
        const page = semComentarios(ler('calibracao-page.js'));
        // `endSession` e o unico caminho de saida involuntaria, e ele precisa consultar o guarda
        // ANTES do logout: depois dele nao ha mais como gravar.
        expect(page).toMatch(/guardCalibrationExit/);
        const iGuarda = page.indexOf('guardCalibrationExit(', page.indexOf('async function endSession'));
        const iLogout = page.indexOf('apiClient.logout()');
        expect(iGuarda).toBeGreaterThan(-1);
        expect(iLogout).toBeGreaterThan(-1);
        expect(iGuarda).toBeLessThan(iLogout);
    });

    it("a expiracao por inatividade e declarada INVOLUNTARIA, e 'Sair agora' nao", () => {
        // Trocar os dois faria a tela perguntar a quem ja saiu e calar para quem esta ali.
        const page = semComentarios(ler('calibracao-page.js'));
        expect(page).toMatch(/onExpire:[^\n]*voluntary:\s*false/);
        expect(page).toMatch(/onLeaveNow:[^\n]*voluntary:\s*true/);
    });

    it('nao sobrou window.confirm nativo na pasta da calibracao', () => {
        // Quatro deles existiam, e o obstaculo de arquitetura alegado nao existe:
        // `confirm.modal.js` importa so `@utils/event-cleanup.js`.
        for (const arq of ['app.js', 'calibration-panel.js', 'calibracao-page.js']) {
            expect(ler(arq), arq).not.toMatch(/window\.confirm\(/);
        }
    });
});
