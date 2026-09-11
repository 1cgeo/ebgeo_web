// Path: tests/unit/phone-move-respeita-canmove.test.js

/**
 * O caminho de mover do TELEFONE pergunta à ferramenta, como o do desktop.
 *
 * Ele nascia sem a pergunta, e era o último que ainda movia uma Linha de Visada ou
 * um viewshed depois de 2026-09-11, quando as duas passaram a recusar o arraste
 * (`canMove` falso) porque transladar a geometria sem reler o terreno debaixo dela
 * mostra o resultado antigo na posição nova. Meio aplicado é pior que qualquer um
 * dos dois estados inteiros.
 *
 * O CONTROLE NEGATIVO é a metade que importa: uma ferramenta que ainda move tem de
 * continuar movendo, senão o conserto teria desligado o recurso inteiro.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const registro = vi.hoisted(() => ({ controles: {}, avisos: [] }));

vi.mock('@tools/tool-registry.js', () => ({
    controlKeyForFeatureType: (tipo) => (tipo ? `${tipo}Control` : null),
    ensureControl: async (chave) => registro.controles[chave] ?? null,
}));

vi.mock('@utils', async (importOriginal) => ({
    ...(await importOriginal()),
    showToast: (msg, tipo) => registro.avisos.push([msg, tipo]),
}));

const { PhoneLayout } = await import('../../src/js/phone/phone-layout.js');

/** Instância crua, sem montar nada: só o método sob prova é exercitado. */
function leiaute() {
    return Object.create(PhoneLayout.prototype);
}

function feicao(source, extras = {}) {
    return { properties: { id: 'f1', source, ...extras } };
}

beforeEach(() => {
    registro.controles = {};
    registro.avisos = [];
});

describe('o telefone pergunta à ferramenta antes de mover', () => {
    it('recusa a Linha de Visada, e diz o que fazer no lugar', async () => {
        registro.controles.losControl = { canMove: () => false };

        await expect(leiaute()._podeMover(feicao('los'))).resolves.toBe(false);
        expect(registro.avisos).toHaveLength(1);
        expect(registro.avisos[0][0]).toMatch(/arraste os nós/i);
    });

    it('recusa o viewshed pelo mesmo caminho', async () => {
        registro.controles.visibilityControl = { canMove: () => false };

        await expect(leiaute()._podeMover(feicao('visibility'))).resolves.toBe(false);
    });

    it('CONTROLE NEGATIVO: a ferramenta que move continua movendo', async () => {
        registro.controles.pointControl = { canMove: () => true };

        await expect(leiaute()._podeMover(feicao('point'))).resolves.toBe(true);
        expect(registro.avisos).toHaveLength(0);
    });

    it('feição bloqueada recebe a mensagem do bloqueio, e não a dos nós', async () => {
        registro.controles.lineControl = { canMove: (f) => !f.properties.bloqueado };

        await expect(leiaute()._podeMover(feicao('line', { bloqueado: true }))).resolves.toBe(false);
        expect(registro.avisos[0][0]).toMatch(/bloqueada/i);
    });

    it('a pergunta leva a FEIÇÃO, porque canMove decide por feição e não por tipo', async () => {
        const vistas = [];
        registro.controles.lineControl = { canMove: (f) => { vistas.push(f); return true; } };
        const f = feicao('line');

        await leiaute()._podeMover(f);

        expect(vistas).toEqual([f]);
    });
});

describe('o que NÃO pode virar recusa silenciosa', () => {
    it('tipo sem ferramenta registrada segue movendo', async () => {
        await expect(leiaute()._podeMover(feicao('tipo-que-nao-existe'))).resolves.toBe(true);
    });

    it('ferramenta que não responde canMove segue movendo', async () => {
        registro.controles.textControl = {};

        await expect(leiaute()._podeMover(feicao('text'))).resolves.toBe(true);
    });

    it('falha ao resolver o controle NÃO bloqueia o movimento', async () => {
        // Um erro de carga do módulo não é um veredito sobre a feição, e negar por
        // dúvida tiraria do usuário um recurso que a ferramenta permite.
        const { ensureControl } = await import('@tools/tool-registry.js');
        vi.mocked(ensureControl);
        registro.controles.polygonControl = undefined;
        const erro = vi.spyOn(console, 'error').mockImplementation(() => {});

        await expect(leiaute()._podeMover(feicao('polygon'))).resolves.toBe(true);

        erro.mockRestore();
    });

    it('feição sem source não trava o caminho', async () => {
        await expect(leiaute()._podeMover({ properties: {} })).resolves.toBe(true);
        await expect(leiaute()._podeMover(null)).resolves.toBe(true);
    });
});

describe('a FIAÇÃO: o caminho de mover de fato chama a pergunta', () => {
    /**
     * Os testes acima provam o predicado, e não que alguém o consulta. Sem esta
     * guarda, apagar a chamada dentro de `_startMoveSession` deixaria a suíte verde
     * com o telefone movendo tudo de novo, que é o defeito que este arquivo existe
     * para impedir.
     */
    let fonte;

    beforeEach(async () => {
        const url = new URL('../../src/js/phone/phone-layout.js', import.meta.url);
        fonte = await (await import('node:fs/promises')).readFile(url, 'utf8');
    });

    it('_startMoveSession consulta _podeMover', () => {
        const corpo = fonte.slice(fonte.indexOf('async _startMoveSession('));
        const ateOProximoMetodo = corpo.slice(0, corpo.indexOf('\n    async ', 10));

        expect(ateOProximoMetodo).toMatch(/await this\._podeMover\(/);
    });

    it('e consulta ANTES de abrir a sessão, senão a recusa chegaria tarde', () => {
        const corpo = fonte.slice(fonte.indexOf('async _startMoveSession('));
        const pergunta = corpo.indexOf('await this._podeMover(');
        const sessao = corpo.indexOf('this._moveSession = {');

        expect(pergunta).toBeGreaterThan(-1);
        expect(sessao).toBeGreaterThan(-1);
        expect(pergunta).toBeLessThan(sessao);
    });
});
