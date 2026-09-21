// Path: tests/unit/presenca-temporal-nao-volta.test.js

/**
 * @fileoverview GUARDA ESTRUTURAL da remoção do instante temporal da presença (dono, 2026-09-21).
 *
 * O DEFEITO QUE ELA IMPEDE NÃO É UM BUG, É UMA VOLTA. Até esta data a ponte de presença assinava
 * TEMPORAL_CURSOR_CHANGED, coalescia e mandava `{cursor, label, playing}` ao par; o transporte
 * tinha um método de envio e uma rota de entrada para o quadro; a lista de quem está online
 * desenhava "em D+3". O dono decidiu que o instante de uma pessoa NÃO se propaga: a presença diz
 * se a pessoa está no mapa ou não, e a linha do tempo é visualização de cada um, como já eram o
 * ligar e desligar, a reprodução e a velocidade desde 2026-09-20.
 *
 * POR QUE UM GUARDA ESTRUTURAL, E NÃO SÓ OS CASOS DE COMPORTAMENTO. Os casos de comportamento
 * (`tests/integration/presence-bridge.test.js`, `presence-store.test.js`, `ws-client.test.js`,
 * `online-users-control.test.js`) afirmam a ausência no caminho que eles exercitam. Uma volta
 * PARCIAL, porém, não passa por nenhum deles: reintroduzir só o método de envio no transporte, ou
 * só o campo no roster, não dispara caso nenhum, e a metade religada fica esperando a outra. Uma
 * varredura por SÍMBOLO reprova a primeira linha de qualquer metade.
 *
 * O QUE ELA NÃO ALCANÇA, declarado: ela é por texto, então um envio montado por string dinâmica
 * (`'send' + 'Temporal'`) escapa. Não é o modo pelo qual esta funcionalidade voltaria; o modo
 * provável é alguém copiar o bloco vizinho de `selection` e trocar a palavra.
 *
 * O lado do servidor tem o guarda gêmeo em `backend/tests/unit/presenca-temporal-nao-volta.test.js`.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, '..', '..');

/** A pasta inteira da presença, mais o transporte que carregava o quadro. */
const PASTA_PRESENCA = path.join(RAIZ, 'src', 'js', 'presence');
const WS_CLIENT = path.join(RAIZ, 'src', 'js', 'store', 'sync', 'ws-client.js');

/**
 * Os símbolos da funcionalidade removida. Cada um é a PRIMEIRA linha de uma das metades:
 * o envio, a ingestão no roster, o campo do retrato de entrada, a marca do rótulo na tela e o
 * tipo do quadro no fio.
 */
const SIMBOLOS_PROIBIDOS = Object.freeze([
    'sendTemporal',
    'setTemporal',
    'temporalState',
    'online-user-temporal',
    // O tipo do quadro no fio, em aspas: pega `case 'temporal'`, `type: 'temporal'` e
    // `wsClient.on('temporal', ...)` de uma vez.
    "'temporal'",
]);

/**
 * Comentário fora: a decisão está ESCRITA em comentário em vários destes arquivos, e um guarda
 * que acusasse a própria explicação obrigaria a apagá-la, que é o contrário do que ele quer.
 * @param {string} src
 * @returns {string}
 */
function semComentarios(src) {
    const normalizado = src.replace(/\r\n?/g, '\n');
    const semBloco = normalizado.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
    return semBloco.split('\n').map((linha) => linha.replace(/\/\/.*/, '')).join('\n');
}

/** Os arquivos varridos: todo `.js` de `presence/` mais o `ws-client.js`. */
function arquivosVarridos() {
    const daPresenca = fs.readdirSync(PASTA_PRESENCA)
        .filter((nome) => nome.endsWith('.js'))
        .map((nome) => path.join(PASTA_PRESENCA, nome));
    return [...daPresenca, WS_CLIENT];
}

/**
 * @param {string} arquivo
 * @returns {{ arquivo: string, linha: number, simbolo: string, texto: string }[]}
 */
function acharProibidos(arquivo) {
    const linhas = semComentarios(fs.readFileSync(arquivo, 'utf8')).split('\n');
    const achados = [];
    linhas.forEach((texto, i) => {
        for (const simbolo of SIMBOLOS_PROIBIDOS) {
            if (texto.includes(simbolo)) {
                achados.push({
                    arquivo: path.relative(RAIZ, arquivo).replace(/\\/g, '/'),
                    linha: i + 1,
                    simbolo,
                    texto: texto.trim(),
                });
            }
        }
    });
    return achados;
}

describe('o instante temporal da presença não volta (guarda estrutural)', () => {
    const arquivos = arquivosVarridos();

    it('PISO: a varredura enxerga os arquivos e o código vivo deles', () => {
        // Sem este caso, apagar a pasta, errar o caminho ou fazer `semComentarios` devolver vazio
        // produziria zero achados e um verde que não prova nada. O piso exige que os arquivos
        // existam E que o vizinho VIVO do quadro removido (a seleção, o cursor) esteja lá.
        expect(arquivos.length).toBeGreaterThan(3);
        const corpo = arquivos
            .map((a) => semComentarios(fs.readFileSync(a, 'utf8')))
            .join('\n');
        expect(corpo).toContain('sendSelection');
        expect(corpo).toContain('setSelection');
        expect(corpo).toContain('sendCursor');
        expect(corpo).toContain("'selection'");
    });

    it('nenhum arquivo de presence/ nem o ws-client cita os símbolos removidos', () => {
        const acusados = arquivos.flatMap(acharProibidos);
        expect(
            acusados.map((a) => `${a.arquivo}:${a.linha} (${a.simbolo}) ${a.texto}`),
        ).toEqual([]);
    });

    it('a ponte não assina o evento da linha do tempo', () => {
        // O evento CONTINUA existindo no barramento (3D, 360 e derivação o ouvem). O que não pode
        // existir é uma assinatura dele DENTRO da ponte de presença: era por ali que o instante
        // saía para a rede.
        const ponte = semComentarios(
            fs.readFileSync(path.join(PASTA_PRESENCA, 'presence-bridge.js'), 'utf8'),
        );
        expect(ponte).not.toContain('TEMPORAL_CURSOR_CHANGED');
        // PISO: a ponte continua assinando os vizinhos pelo mesmo mecanismo.
        expect(ponte).toContain('EventTypes.MAP_LOCK_CHANGED');
        expect(ponte).toContain('EventTypes.BRIEFING_EDIT_STARTED');
    });
});
