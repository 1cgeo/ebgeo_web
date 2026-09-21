// Path: tests/unit/leitor-nao-ganha-alca-nem-arrasta.test.js
//
// QUEM NÃO PODE EDITAR NÃO GANHA ALÇA NEM ARRASTA, COMO NO MAPA TRAVADO (dono, 2026-09-20).
//
// MEDIDO numa visita pública: o visitante clicava num polígono e recebia as alças de vértice;
// arrastava, o mapa PINTAVA o movimento, o store recusava a escrita ("Seu nível neste atlas não
// permite editar") e a tela ficava mostrando uma geometria que não existe em lugar nenhum, até a
// próxima op remota repintar a fonte. O dono a descreveu pelas duas pontas: "está permitindo o
// visitante dar drag e editar" e "o mapa some as feições".
//
// A trava do mapa já deixava a superfície INERTE (sem alça, sem arrasto). O papel que não edita
// passou a usar o mesmo corte, por um predicado só.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';

const h = vi.hoisted(() => ({ travado: false, permitido: true, perguntas: [] }));

vi.mock('@store/map.operations.js', () => ({ isCurrentMapLockedSync: () => h.travado }));
vi.mock('@store/sync/permission-guard.js', () => ({
    GuardAction: { UPDATE_FEATURE: 'edit' },
    checkPermission: (acao) => { h.perguntas.push(acao); return { allowed: h.permitido }; },
}));

const { isEditSurfaceInert } = await import('../../src/js/tool_manager/edit-surface.js');

const ler = (rel) => readFileSync(new URL(`../../src/js/${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

describe('isEditSurfaceInert', () => {
    beforeEach(() => { h.travado = false; h.permitido = true; h.perguntas = []; });

    it('mapa destravado e nível que edita: a superfície responde', () => {
        expect(isEditSurfaceInert()).toBe(false);
    });

    it('mapa TRAVADO: inerte, e nem pergunta pelo papel', () => {
        h.travado = true;
        expect(isEditSurfaceInert()).toBe(true);
        expect(h.perguntas).toEqual([]);
    });

    it('nível que NÃO edita (leitor, comentarista, visitante): inerte, igual ao cadeado', () => {
        h.permitido = false;
        expect(isEditSurfaceInert()).toBe(true);
    });

    it('a pergunta é por CAPACIDADE, pelo guard, e nunca por nome de papel', () => {
        isEditSurfaceInert();
        expect(h.perguntas).toEqual(['edit']);
        const fonte = ler('tool_manager/edit-surface.js').replace(/\/\*[\s\S]*?\*\//g, '');
        expect(fonte).not.toMatch(/['"](viewer|commenter|editor|manager|owner|read|comment|write|manage)['"]/);
        expect(fonte).not.toContain('isVisitor');
    });
});

describe('a fiação', () => {
    it('os TRÊS caminhos de seleção entregam a feição pelo mesmo método, que levanta o sinal', () => {
        const fonte = ler('tool_manager/selection_manager.js');
        expect(fonte.match(/this\._notifySelected\(control, /g)).toHaveLength(3);
        // Nenhuma entrega direta sobrou fora do método único.
        expect(fonte.match(/control\.onFeatureSelected\(/g)).toHaveLength(1);
        const inicio = fonte.indexOf('    _notifySelected(control, feature) {');
        expect(inicio).toBeGreaterThan(-1);
        const corpo = fonte.slice(inicio, fonte.indexOf('\n    }\n', inicio));
        expect(corpo).toContain('const inert = isEditSurfaceInert();');
        expect(corpo).toContain('if (inert) control._mapLocked = true;');
        // SÍNCRONO: um await entre levantar e baixar devolveria o controle com o sinal já baixado.
        expect(corpo).not.toContain('await');
        expect(corpo).toContain('finally');
    });

    it('o arrasto recusa pelo MESMO predicado, antes de qualquer outra coisa', () => {
        const fonte = ler('tool_manager/move_handler.js');
        const inicio = fonte.indexOf('    _startDrag(e) {');
        expect(inicio).toBeGreaterThan(-1);
        const corpo = fonte.slice(inicio, fonte.indexOf('\n    }\n', inicio));
        const recusa = corpo.indexOf('if (isEditSurfaceInert()) return;');
        expect(recusa).toBeGreaterThan(-1);
        expect(recusa).toBeLessThan(corpo.indexOf('getAllSelectedFeatures'));
    });

    it('PISO: os controles ainda leem o sinal que o gerente levanta', () => {
        const controles = [
            'draw_tools/polygon_tool/add_polygon_control.js',
            'draw_tools/line_tool/add_line_control.js',
            'military_tools/arrow_tool/add_arrow_control.js',
        ];
        for (const rel of controles) {
            expect(ler(rel), rel).toContain('if (this._mapLocked) return;');
        }
    });
});
