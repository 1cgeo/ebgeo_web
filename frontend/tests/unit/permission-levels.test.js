// Path: tests/unit/permission-levels.test.js

/**
 * @fileoverview The canonical atlas permission ladder consumed by the Atlas Drive.
 *
 * Regression root cause: `atlas-drive.js` kept its OWN label table with three of the
 * five levels (owner/write/read) and drew the card chip only when the level was a key
 * of that table, so an atlas shared as Gestor (`manage`) or Comentarista (`comment`)
 * showed no badge at all — the CSS for those chips existed and never matched anything.
 * These tests pin the five levels, the ascending order, and the "unknown level must not
 * vanish" fallback.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
    PERMISSION_ORDER,
    PERMISSION_LABELS,
    isKnownPermission,
    permissionRank,
    hasAtLeast,
    getPermissionLabel,
} from '@js/projects/permission-levels.js';

describe('permission-levels — a escada', () => {
    it('tem exatamente os cinco níveis, em ordem crescente', () => {
        expect(PERMISSION_ORDER).toEqual(['read', 'comment', 'write', 'manage', 'owner']);
    });

    it('rende rótulo pt-BR para os cinco níveis', () => {
        const labels = PERMISSION_ORDER.map((level) => getPermissionLabel(level));
        expect(labels).toEqual(['Leitura', 'Comentário', 'Edição', 'Gestão', 'Proprietário']);
        // No level may share a label with another, or two chips would read alike.
        expect(new Set(labels).size).toBe(PERMISSION_ORDER.length);
    });

    it('não tem rótulo órfão nem nível sem rótulo', () => {
        expect(Object.keys(PERMISSION_LABELS).sort()).toEqual([...PERMISSION_ORDER].sort());
    });

    it('rankeia estritamente crescente e trata a ordem como monótona', () => {
        const ranks = PERMISSION_ORDER.map(permissionRank);
        expect(ranks).toEqual([0, 1, 2, 3, 4]);
        for (let i = 1; i < ranks.length; i += 1) {
            expect(ranks[i]).toBeGreaterThan(ranks[i - 1]);
        }
    });
});

describe('permission-levels — o gate por hierarquia', () => {
    it('inclui manage acima de write (o bug da lista fechada)', () => {
        expect(hasAtLeast('manage', 'write')).toBe(true);
        expect(hasAtLeast('owner', 'write')).toBe(true);
        expect(hasAtLeast('write', 'write')).toBe(true);
    });

    it('barra quem está abaixo', () => {
        expect(hasAtLeast('comment', 'write')).toBe(false);
        expect(hasAtLeast('read', 'comment')).toBe(false);
        expect(hasAtLeast('manage', 'owner')).toBe(false);
    });

    it('nível desconhecido ou ausente nunca concede acesso', () => {
        for (const bogus of ['editor', 'superuser', '', null, undefined, 0, {}]) {
            expect(hasAtLeast(bogus, 'read')).toBe(false);
        }
        // A required level that does not exist is a caller bug: fail closed.
        expect(hasAtLeast('owner', 'godmode')).toBe(false);
    });
});

describe('permission-levels — nível desconhecido não some', () => {
    it('devolve o valor cru em vez de undefined', () => {
        expect(getPermissionLabel('editor')).toBe('editor');
        expect(getPermissionLabel('  superuser  ')).toBe('superuser');
        // The whole point: the Drive draws a chip when the label is truthy, so an
        // unrecognized level still shows a badge instead of disappearing.
        expect(getPermissionLabel('editor')).toBeTruthy();
    });

    it('devolve string vazia (nenhum crachá) só quando não há nível algum', () => {
        for (const empty of [null, undefined, '', '   ', 42, {}, []]) {
            expect(getPermissionLabel(empty)).toBe('');
        }
    });

    it('não confunde propriedade herdada de Object com nível', () => {
        // 'constructor'/'toString' are on Object.prototype; a naive `LABELS[level]`
        // lookup would return a function and be reported as a known level.
        expect(isKnownPermission('constructor')).toBe(false);
        expect(isKnownPermission('toString')).toBe(false);
        expect(getPermissionLabel('toString')).toBe('toString');
        expect(permissionRank('constructor')).toBe(-1);
    });

    it('é imutável: ninguém reescreve a escada em runtime', () => {
        expect(Object.isFrozen(PERMISSION_ORDER)).toBe(true);
        expect(Object.isFrozen(PERMISSION_LABELS)).toBe(true);
    });
});

describe('permission-levels — pureza de módulo', () => {
    const SOURCE = readFileSync(
        fileURLToPath(new URL('../../src/js/projects/permission-levels.js', import.meta.url)),
        'utf8',
    );

    it('não importa nada: atlas.html não carrega a store nem o mapa', () => {
        // Any import here (a @utils/@modals barrel above all) drags @store, and with it
        // MapLibre, into a page measured at ~140 kB against the map's ~3,3 MB.
        const imports = SOURCE.match(/^\s*import[\s{'"*]/gm) ?? [];
        expect(imports).toEqual([]);
        expect(SOURCE).not.toMatch(/\bimport\s*\(/);
    });

    it('atlas-drive não mantém uma segunda tabela de rótulos', () => {
        // The defect was a LOCAL three-level table in the Drive; the chip only existed
        // when the level was a key of it. Two tables of the same thing diverge, and the
        // incomplete one is the one that ships the bug. (Text check: the chip lives in
        // DOM code this node environment cannot execute.)
        const drive = readFileSync(
            fileURLToPath(new URL('../../src/js/projects/atlas-drive.js', import.meta.url)),
            'utf8',
        );
        expect(drive).not.toMatch(/const\s+PERMISSION_LABELS\s*=/);
        expect(drive).toMatch(/from\s+'@js\/projects\/permission-levels\.js'/);
        expect(drive).toMatch(/getPermissionLabel\(/);
    });

    it('a busca por import de fato acha um import (controle do matcher)', () => {
        // Without this, a regex that matched nothing would report the module pure
        // even if it imported the whole store.
        const decoy = "import { getEventBus } from '@store/services.js';\nexport const x = 1;\n";
        expect(decoy.match(/^\s*import[\s{'"*]/gm) ?? []).toHaveLength(1);
    });
});
