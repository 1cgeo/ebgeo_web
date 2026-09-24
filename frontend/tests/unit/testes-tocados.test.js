// Path: tests/unit/testes-tocados.test.js

/**
 * O PLANO DE `npm run test:tocados` (`dev/testes-tocados.mjs`): o que roda para cada mudança.
 *
 * Decisão do dono em 2026-09-24: a suíte do pacote tocado a cada commit, e a suíte inteira da raiz
 * quando a mudança cruza os pacotes (e antes de deploy e de levar à main, que é regra escrita, não
 * código). O script é o que faz a regra não depender de lembrança, e este arquivo é o que impede o
 * script de encolher em silêncio: uma regra que deixasse de mandar a raiz rodar para uma mudança
 * de contrato reportaria verde em 1 minuto sobre uma mudança que só a raiz mede.
 *
 * E o inverso também é defeito, e foi o primeiro que apareceu: um alvo que degenera em "a suíte
 * inteira do backend" para qualquer mudança devolve os 16 minutos que a decisão existe para tirar.
 * O piso sobre o grafo REAL, no fim, é o que pega isso.
 */

import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    planejar, testesPorArquivo, testesPorAfinidade, importsRelativos, padraoDoBackend,
    CONTRATO, HUBS, TETO_DE_ALVOS_DO_BACKEND,
} from '../../../dev/testes-tocados.mjs';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const semAlcance = new Map();

describe('o plano de test:tocados', () => {
    it('só frontend: a suíte do frontend, e nada mais', () => {
        const p = planejar(['frontend/src/css/base.css', 'frontend/src/js/ui/app-bar.js'], semAlcance);
        expect(p).toMatchObject({ raiz: false, frontend: true, backend: null });
    });

    it('documentação e instrução de agente também vão para o frontend, que é onde moram os guardas delas', () => {
        const p = planejar(['docs/livro-razao.md', '.claude/rules/testing.md', 'CLAUDE.md', 'dev/README.md'], semAlcance);
        expect(p).toMatchObject({ raiz: false, frontend: true, backend: null });
    });

    it.each([
        'frontend/src/js/store/sync/operation-factory.js',
        'backend/src/modules/sync/sync.service.js',
        'frontend/src/js/config.js',
        'backend/src/modules/config/config.controller.js',
        'backend/src/utils/roles.js',
        'frontend/src/js/projects/permission-levels.js',
        'backend/src/modules/uso/eventos-de-uso.js',
        'frontend/src/js/session/origens-de-erro.js',
        'backend/src/database/migrations/001_base.sql',
        'frontend/tests/e2e/atributos-por-chave.e2e.test.js',
    ])('contrato entre os pacotes pede a raiz inteira: %s', (arquivo) => {
        const p = planejar([arquivo], semAlcance);
        expect(p.raiz).toBe(true);
        expect(p.motivos.join(' ')).toContain('contrato');
    });

    it('código dos dois pacotes no mesmo conjunto pede a raiz inteira', () => {
        const p = planejar(['frontend/src/js/ui/app-bar.js', 'backend/src/modules/uso/uso.service.js'], semAlcance);
        expect(p.raiz).toBe(true);
    });

    it('configuração local do Vite não conta como código do frontend para "cruzar os pacotes"', () => {
        // O `vite.config.js` pode ficar modificado localmente por semanas (apontamento para
        // produção). Contá-lo como código faria toda mudança de backend pedir 19 minutos.
        const alcance = new Map([['backend/src/modules/uso/uso.service.js', new Set(['backend/tests/unit/uso.test.js'])]]);
        const p = planejar(['frontend/vite.config.js', 'backend/src/modules/uso/uso.service.js'], alcance);
        expect(p).toMatchObject({ raiz: false, frontend: true, backend: ['backend/tests/unit/uso.test.js'] });
    });

    it('backend: os testes que alcançam, os de afinidade de nome e o próprio teste que mudou', () => {
        const alcance = new Map([['backend/src/modules/uso/uso.service.js', new Set(['backend/tests/unit/b.test.js'])]]);
        const todos = ['backend/tests/integration/uso-lote.test.js', 'backend/tests/integration/usuarios.test.js'];
        const p = planejar(['backend/src/modules/uso/uso.service.js', 'backend/tests/unit/c.test.js'], alcance, todos);
        expect(p.backend).toEqual(['backend/tests/integration/uso-lote.test.js', 'backend/tests/unit/b.test.js', 'backend/tests/unit/c.test.js']);
        expect(p.frontend).toBe(false);
    });

    it('arquivo do backend que nenhum teste mira pede a suíte inteira do backend, nomeando-o', () => {
        const p = planejar(['backend/src/utils/orfao.js'], semAlcance);
        expect(p.backend).toBe('tudo');
        expect(p.motivos.join(' ')).toContain('backend/src/utils/orfao.js');
    });

    it.each(['backend/package.json', 'backend/scripts/run-tests.js', 'backend/.c8rc.json', ...HUBS])(
        'infraestrutura ou ponto de composição do backend pede a suíte inteira do backend: %s', (arquivo) => {
            expect(planejar([arquivo], semAlcance).backend).toBe('tudo');
        },
    );

    it('alvo acima do teto vira a suíte inteira do backend', () => {
        const muitos = new Set(Array.from({ length: TETO_DE_ALVOS_DO_BACKEND + 1 }, (_, i) => `backend/tests/unit/t${i}.test.js`));
        const p = planejar(['backend/src/utils/comum.js'], new Map([['backend/src/utils/comum.js', muitos]]));
        expect(p.backend).toBe('tudo');
    });

    it('nada mudou: nada a rodar', () => {
        expect(planejar([], semAlcance)).toMatchObject({ raiz: false, frontend: false, backend: null });
    });
});

describe('como um teste do backend mira um arquivo', () => {
    it('o grafo segue import estático e dinâmico relativos, e ignora pacote do npm', () => {
        const fonte = "import a from '../src/a.js';\nconst b = await import('./b.js');\nimport x from 'pg-promise';";
        expect(importsRelativos('backend/tests/t.test.js', fonte)).toEqual(['backend/src/a.js', 'backend/tests/b.js']);
    });

    it('o alcance é TRANSITIVO: mudar o módulo de baixo acha o teste do módulo de cima', () => {
        const fontes = new Map([
            ['backend/tests/unit/x.test.js', "import { f } from '../../src/x.js';"],
            ['backend/src/x.js', "import { g } from './y.js';"],
            ['backend/src/y.js', 'export const g = 1;'],
        ]);
        expect([...testesPorArquivo(fontes).get('backend/src/y.js')]).toEqual(['backend/tests/unit/x.test.js']);
    });

    it('o grafo NÃO atravessa o ponto de composição: quem só chega pela aplicação montada não mira o serviço', () => {
        const fontes = new Map([
            ['backend/tests/integration/i.test.js', "import { app } from '../helpers/setup.js';"],
            ['backend/tests/helpers/setup.js', "import { app } from '../../src/app.js';"],
            ['backend/src/app.js', "import r from './modules/uso/uso.routes.js';"],
            ['backend/src/modules/uso/uso.routes.js', "import s from './uso.service.js';"],
            ['backend/src/modules/uso/uso.service.js', 'export default 1;'],
        ]);
        const alcance = testesPorArquivo(fontes);
        expect(alcance.get('backend/src/modules/uso/uso.service.js')).toBeUndefined();
        expect([...alcance.get('backend/src/app.js')]).toEqual(['backend/tests/integration/i.test.js']);
    });

    it('afinidade: o módulo como sequência de palavras do nome, inclusive com hífen, e os apelidos', () => {
        const testes = [
            'backend/tests/integration/access-groups-crud.test.js',
            'backend/tests/integration/access-groupsx.test.js',
            'backend/tests/integration/uso-lote.test.js',
            'backend/tests/integration/usuarios.test.js',
            'backend/tests/integration/auditoria-sv360-delete.test.js',
        ];
        expect(testesPorAfinidade('access-groups', testes)).toEqual(['backend/tests/integration/access-groups-crud.test.js']);
        expect(testesPorAfinidade('uso', testes)).toEqual(['backend/tests/integration/uso-lote.test.js']);
        expect(testesPorAfinidade('streetview360', testes)).toEqual(['backend/tests/integration/auditoria-sv360-delete.test.js']);
    });

    it('o padrão do runner: um arquivo sozinho, ou um glob com chaves para vários (um banco só)', () => {
        expect(padraoDoBackend(['backend/tests/unit/a.test.js'])).toBe('tests/unit/a.test.js');
        expect(padraoDoBackend(['backend/tests/unit/a.test.js', 'backend/tests/integration/b.test.js']))
            .toBe('{tests/unit/a.test.js,tests/integration/b.test.js}');
    });

    it('PISO no grafo REAL: um serviço comum sai com ALVO, não com a suíte inteira do backend', () => {
        // Sem o corte no ponto de composição, o helper de setup (que importa `src/app.js`) fazia
        // 487 dos 635 testes "alcançarem" qualquer serviço, e todo alvo virava 16 minutos.
        const arquivos = execSync('git ls-files backend/src backend/tests', { cwd: RAIZ, encoding: 'utf8' })
            .split(/\r?\n/).filter((p) => p.endsWith('.js'));
        expect(arquivos.length).toBeGreaterThan(300);
        const fontes = new Map(arquivos.map((p) => [p, readFileSync(join(RAIZ, p), 'utf8')]));
        const testes = arquivos.filter((p) => p.endsWith('.test.js'));
        const alcance = testesPorArquivo(fontes);
        const plano = planejar(['backend/src/modules/uso/uso.service.js'], alcance, testes);
        expect(Array.isArray(plano.backend), plano.motivos.join('; ')).toBe(true);
        expect(plano.backend.length).toBeGreaterThan(0);
        expect(plano.backend.length).toBeLessThanOrEqual(TETO_DE_ALVOS_DO_BACKEND);
    }, 60_000);

    it('a lista de contrato não esvaziou', () => {
        expect(CONTRATO.length).toBeGreaterThanOrEqual(9);
    });
});
