// Path: tests/unit/papel-por-http-espelha-servidor.test.js

/**
 * @fileoverview O PAPEL LIDO POR HTTP TEM DE SER O MESMO QUE O SOCKET ANUNCIA.
 *
 * Sem tempo real (`store/sync/sem-tempo-real.js`, 2026-09-25) o quadro `connected` não chega, e o
 * papel por atlas vem de `user_permission` em `GET /atlas/:atlasId`, traduzido para o vocabulário do
 * cliente por `atlasRoleForPermission` (`projects/permission-levels.js`). O socket traduz com
 * `toFrontendRole` (`backend/src/utils/roles.js`). Se os dois divergirem, a mesma pessoa recebe um
 * conjunto de botões com socket e outro sem, e ninguém percebe, porque cada lado está certo pela
 * própria regra.
 *
 * POR QUE ELE IMPORTA O BACKEND: comparar com uma reimplementação escrita aqui não provaria nada. A
 * asserção com dentes é contra a função de verdade, no mesmo processo, sobre o produto cartesiano
 * inteiro (a forma de `dono-de-atlas-espelha-servidor.test.js`), mais valores ABSOLUTOS, porque
 * duas cópias erradas do mesmo jeito passariam numa comparação só entre elas.
 *
 * A ÚNICA DIFERENÇA É DELIBERADA E ESTÁ NO ÚLTIMO BLOCO: para uma permissão desconhecida o servidor
 * responde `viewer` (é o fim da escada dele), e o cliente responde `null`, que o motor lê como "não
 * mexa no papel". A rota é gateada por `requireAtlasPermission`, então um `user_permission` fora da
 * escada só chega de um servidor quebrado, e ali o cliente fica na semente fechada em vez de
 * adivinhar.
 */

import { describe, it, expect } from 'vitest';
import { atlasRoleForPermission } from '@js/projects/permission-levels.js';
import { GlobalRole } from '@store/sync/session-context.js';
import { toFrontendRole } from '../../../backend/src/utils/roles.js';

/** Os cinco degraus do servidor, na ordem da escada. */
const DEGRAUS = ['read', 'comment', 'write', 'manage', 'owner'];

/** Os quatro papéis globais, mais a conta sem papel no token. */
const PAPEIS_GLOBAIS = [...Object.values(GlobalRole), undefined];

describe('atlasRoleForPermission espelha toFrontendRole', () => {
    it('sanidade do instrumento: são quatro papéis globais, e o admin está entre eles', () => {
        expect(Object.values(GlobalRole)).toHaveLength(4);
        expect(PAPEIS_GLOBAIS).toContain(GlobalRole.ADMIN);
    });

    it('produto cartesiano inteiro: degrau x papel global', () => {
        for (const degrau of DEGRAUS) {
            for (const global of PAPEIS_GLOBAIS) {
                const doCliente = atlasRoleForPermission(degrau, { globalAdmin: global === GlobalRole.ADMIN });
                expect(doCliente, `${degrau} / ${global}`).toBe(toFrontendRole(degrau, global));
            }
        }
    });

    it('valores absolutos da escada, para uma conta comum', () => {
        expect(atlasRoleForPermission('read')).toBe('viewer');
        expect(atlasRoleForPermission('comment')).toBe('commenter');
        expect(atlasRoleForPermission('write')).toBe('editor');
        expect(atlasRoleForPermission('manage')).toBe('manager');
        expect(atlasRoleForPermission('owner')).toBe('owner');
    });

    it('só o administrador global faz curto-circuito; produtor e credenciado caem na escada', () => {
        expect(atlasRoleForPermission('read', { globalAdmin: true })).toBe('admin');
        expect(toFrontendRole('read', GlobalRole.PRODUCER)).toBe('viewer');
        expect(toFrontendRole('read', GlobalRole.CREDENCIADO)).toBe('viewer');
        expect(atlasRoleForPermission('read', { globalAdmin: false })).toBe('viewer');
    });

    it('permissão desconhecida falha FECHADO: null, com ou sem administrador', () => {
        for (const lixo of [null, undefined, '', 'OWNER', 'admin', 'editor', 'toString', 'constructor', 3, {}]) {
            expect(atlasRoleForPermission(lixo), String(lixo)).toBeNull();
            expect(atlasRoleForPermission(lixo, { globalAdmin: true }), String(lixo)).toBeNull();
        }
    });
});
