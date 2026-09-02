// Path: tests/unit/origens-de-erro.test.js

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
    OrigemDeErro,
    ORIGENS_DE_ERRO,
    ORIGENS_DO_CLIENTE,
    ORIGEM_POR_SUPERFICIE,
    origemDeSuperficie,
    origemDoCliente,
    origemValida,
} from '@js/session/origens-de-erro.js';
import { MODEL_3D_SURFACE } from '@js/3d_models_viewer_tool/model3d-failure.js';
import { PHOTO_360_SURFACE } from '@js/street_view_tool/photo360-failure.js';

// O VOCABULÁRIO DE ORIGEM, e as duas coisas que ele precisa garantir: que os dez valores sejam
// dez (um duplicado funde duas portas num filtro só, calado), e que a tabela de superfície case
// com as chaves que os dois visualizadores de fato registram.
//
// ESTE ARQUIVO É O GUARDA DA STRING REPETIDA. `ORIGEM_POR_SUPERFICIE` escreve `modelo3d` e
// `foto360` à mão, porque o módulo é folha de zero imports por contrato (ele é lido pelas quatro
// páginas) e porque a chave da superfície pertence a quem desenha a superfície. Ele importa OS
// DOIS LADOS e os compara: renomear qualquer das duas chaves fica vermelho aqui.

describe('o vocabulário: onze valores, e onze distintos', () => {
    it('a lista tem os onze, na ordem em que foram declarados', () => {
        // A ORDEM É CONTRATO com o outro pacote e com o CHECK da coluna: valor novo entra no FIM,
        // nunca no meio, senão os três espelhos passam a discordar sem que nenhum fique vermelho
        // por conjunto.
        expect(ORIGENS_DE_ERRO).toEqual([
            'boot', 'nao-tratado', 'rejeicao', 'console', 'store', 'ws', 'maplibre', 'cesium',
            'sv360', 'indisponivel', 'servidor',
        ]);
    });

    it('nenhum valor se repete (duplicata fundiria duas portas num filtro só)', () => {
        expect(new Set(ORIGENS_DE_ERRO).size).toBe(ORIGENS_DE_ERRO.length);
    });

    it('a lista e o enum dizem a mesma coisa', () => {
        expect([...ORIGENS_DE_ERRO].sort()).toEqual(Object.values(OrigemDeErro).sort());
    });

    it('as três estruturas são congeladas', () => {
        expect(Object.isFrozen(OrigemDeErro)).toBe(true);
        expect(Object.isFrozen(ORIGENS_DE_ERRO)).toBe(true);
        expect(Object.isFrozen(ORIGEM_POR_SUPERFICIE)).toBe(true);
    });

    it('`origemValida` aceita as dez e recusa o resto', () => {
        for (const origem of ORIGENS_DE_ERRO) expect(origemValida(origem)).toBe(true);
        for (const ruim of ['BOOT', 'inventada', '', null, undefined, 42, {}, ['boot']]) {
            expect(origemValida(ruim)).toBe(false);
        }
    });

    it('herança de protótipo não é origem válida', () => {
        expect(origemValida('toString')).toBe(false);
        expect(origemValida('constructor')).toBe(false);
    });
});

describe('a tabela de superfície casa com quem registra a superfície', () => {
    it('o modelo 3D é `cesium`, pela chave que o próprio módulo registra', () => {
        expect(origemDeSuperficie(MODEL_3D_SURFACE)).toBe(OrigemDeErro.CESIUM);
    });

    it('a foto 360 é `sv360`, pela chave que o próprio módulo registra', () => {
        expect(origemDeSuperficie(PHOTO_360_SURFACE)).toBe(OrigemDeErro.SV360);
    });

    it('a tabela não tem entrada além dessas duas', () => {
        // Uma terceira entrada sem dono é uma etiqueta que ninguém emite; uma superfície nova
        // entra aqui junto com o teste que a prende.
        expect(Object.keys(ORIGEM_POR_SUPERFICIE).sort())
            .toEqual([PHOTO_360_SURFACE, MODEL_3D_SURFACE].sort());
    });

    it('toda superfície do próprio mapa cai em `maplibre`', () => {
        for (const kind of ['basemap', 'dataLayer', 'analysisLayer', 'inventada']) {
            expect(origemDeSuperficie(kind)).toBe(OrigemDeErro.MAPLIBRE);
        }
    });

    it('herança de protótipo NÃO vira origem (a chave vem de quem registrou)', () => {
        expect(origemDeSuperficie('toString')).toBe(OrigemDeErro.MAPLIBRE);
        expect(origemDeSuperficie('constructor')).toBe(OrigemDeErro.MAPLIBRE);
    });

    it('entrada estranha não lança', () => {
        for (const ruim of [null, undefined, 42, {}, []]) {
            expect(origemDeSuperficie(ruim)).toBe(OrigemDeErro.MAPLIBRE);
        }
    });
});

describe('o contrato de folha, e o espelho do backend', () => {
    /** @returns {string} A fonte do módulo. */
    function fonte(relativo) {
        return readFileSync(fileURLToPath(new URL(relativo, import.meta.url)), 'utf8');
    }

    // AS TRÊS FOLHAS DA TELEMETRIA, juntas, porque o contrato é o mesmo e a razão também: elas
    // são carregadas pelas QUATRO páginas, três das quais bootam sem a store, e um import a mais
    // em qualquer uma é peso em todas. `sessao-id.js` tem ainda um segundo motivo, escrito no
    // `fileoverview` dele: ele é lido dentro do capturador de erro, onde nada pode lançar.
    const FOLHAS = [
        'src/js/session/origens-de-erro.js',
        'src/js/session/sessao-id.js',
        'src/js/session/fila-de-relatos.js',
    ];

    it.each(FOLHAS)('%s tem ZERO IMPORTS', (relativo) => {
        const texto = fonte(`../../${relativo}`);
        // A guarda do próprio guarda: um caminho errado leria vazio e passaria verde.
        expect(texto.length, `${relativo} veio vazio: o caminho não resolve`).toBeGreaterThan(500);
        expect(texto).not.toMatch(/^\s*import\s/m);
        expect(texto).not.toMatch(/\bfrom\s+['"]/);
    });

    it('as dez são as MESMAS dez do backend, na mesma ordem', () => {
        // Ele lê a FONTE do outro pacote em vez de importá-la (o backend não é dependência do
        // frontend), como `sync-trace-espelha-backend.test.js`. O alcance é o VOCABULÁRIO: uma
        // origem emitida no lugar errado passa verde aqui.
        const ESPELHO = '../../../backend/src/modules/diag/origens-de-erro.js';
        const texto = fonte(ESPELHO);
        const inicio = texto.indexOf('ORIGENS_DE_ERRO');
        expect(inicio, 'o `ORIGENS_DE_ERRO` sumiu do backend — este espelho perdeu o alvo')
            .toBeGreaterThan(-1);
        const bloco = texto.slice(inicio, texto.indexOf(']', inicio));
        const doServidor = [...bloco.matchAll(/'([a-z0-9-]+)'/g)].map((m) => m[1]);
        expect(doServidor.length, 'nenhuma origem encontrada: o recorte não casou')
            .toBeGreaterThan(0);
        expect(doServidor).toEqual([...ORIGENS_DE_ERRO]);
    });
});

describe('`servidor` é do BACKEND, e este cliente nunca a manda', () => {
    // A DÉCIMA PRIMEIRA ORIGEM entrou no vocabulário porque o servidor passou a registrar na MESMA
    // tabela os defeitos que ele mesmo vê, e o vocabulário precisa ser UM (um segundo enum "quase
    // igual" diverge do primeiro no primeiro dia). O que ela NÃO é: uma porta deste cliente.
    // Mandá-la daqui seria o navegador se passando por servidor num relatório que ninguém confere.

    it('ela é a ÚLTIMA do vocabulário (a ordem é contrato com o CHECK da coluna)', () => {
        expect(ORIGENS_DE_ERRO[ORIGENS_DE_ERRO.length - 1]).toBe(OrigemDeErro.SERVIDOR);
    });

    it('`ORIGENS_DO_CLIENTE` é o vocabulário MENOS ela, e é derivada (nunca uma segunda lista)', () => {
        expect(ORIGENS_DO_CLIENTE).toEqual(
            ORIGENS_DE_ERRO.filter((origem) => origem !== 'servidor'),
        );
        expect(ORIGENS_DO_CLIENTE).toHaveLength(ORIGENS_DE_ERRO.length - 1);
        expect(ORIGENS_DO_CLIENTE).not.toContain('servidor');
        expect(Object.isFrozen(ORIGENS_DO_CLIENTE)).toBe(true);
    });

    it('`origemValida` a ACEITA e `origemDoCliente` a RECUSA: são perguntas diferentes', () => {
        expect(origemValida(OrigemDeErro.SERVIDOR)).toBe(true);
        expect(origemDoCliente(OrigemDeErro.SERVIDOR)).toBe(false);
    });

    it('`origemDoCliente` aceita as outras dez e recusa o resto', () => {
        for (const origem of ORIGENS_DO_CLIENTE) expect(origemDoCliente(origem)).toBe(true);
        for (const ruim of ['SERVIDOR', 'inventada', '', null, undefined, 42, {}, 'toString']) {
            expect(origemDoCliente(ruim)).toBe(false);
        }
    });

    it('NADA em `src/js/` passa `servidor` como origem de um relato', () => {
        // Estrutural, e por varredura de `git ls-files` em vez de alvos escritos à mão: um sítio
        // novo que a escrevesse nasceria coberto. O que se procura é a origem sendo PASSADA
        // (`origem: 'servidor'`, `origem: OrigemDeErro.SERVIDOR`), nunca a declaração dela.
        const raiz = fileURLToPath(new URL('../../', import.meta.url));
        const arquivos = execSync('git ls-files -- src/js', { cwd: raiz, encoding: 'utf8' })
            .split(/\r?\n/)
            .map((linha) => linha.trim())
            .filter((linha) => linha.endsWith('.js'));
        // A guarda do próprio guarda: uma varredura vazia passaria verde sem ter lido nada.
        expect(arquivos.length, 'a varredura não achou arquivo nenhum').toBeGreaterThan(300);

        const culpados = [];
        for (const relativo of arquivos) {
            if (relativo.endsWith('session/origens-de-erro.js')) continue;   // é a declaração
            const texto = readFileSync(fileURLToPath(new URL(`../../${relativo}`, import.meta.url)), 'utf8');
            if (/origem\s*:\s*(?:'servidor'|"servidor"|OrigemDeErro\.SERVIDOR)/.test(texto)) {
                culpados.push(relativo);
            }
        }
        expect(culpados, 'o cliente não pode se passar por servidor').toEqual([]);
    });
});
