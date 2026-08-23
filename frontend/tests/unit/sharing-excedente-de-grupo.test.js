// Path: tests/unit/sharing-excedente-de-grupo.test.js
// O SELO QUE IMPEDE A TELA DE MENTIR: quando um grupo do atlas dá àquela pessoa mais do que
// o compartilhamento nominal, o modal mostra o nível EFETIVO ao lado do `<select>`, que
// continua editando a LINHA.
//
// O acesso resolve pelo maior nível entre os dois caminhos (`fn_user_atlas_shares`, no
// servidor). Antes de 2026-08-23 a tela exibia só a linha, então rebaixar alguém para
// leitura mostrava "Leitura" e não rebaixava nada.

import { describe, it, expect } from 'vitest';
import { excedenteDeGrupo } from '@modals/sharing.modal.js';

describe('excedenteDeGrupo', () => {
    it('mostra o nível efetivo quando o grupo dá MAIS que a linha', () => {
        expect(excedenteDeGrupo({ permission: 'read', effectivePermission: 'write' }))
            .toEqual({ label: 'Edição' });
        expect(excedenteDeGrupo({ permission: 'comment', effectivePermission: 'manage' }))
            .toEqual({ label: 'Gestão' });
    });

    it('não mostra nada quando os dois coincidem', () => {
        for (const nivel of ['read', 'comment', 'write', 'manage']) {
            expect(excedenteDeGrupo({ permission: nivel, effectivePermission: nivel })).toBeNull();
        }
    });

    it('não mostra nada quando a LINHA é maior, que é o caso normal', () => {
        // O efetivo nunca é menor que a linha (o servidor resolve pelo máximo), mas um
        // payload assim não pode virar selo: ele diria à tela que a pessoa tem menos do
        // que o select mostra, e o select é a linha.
        expect(excedenteDeGrupo({ permission: 'manage', effectivePermission: 'read' })).toBeNull();
    });

    it('degrada para nada quando o payload é velho ou quebrado', () => {
        // Um cliente novo contra um servidor antigo não recebe `effectivePermission`. O
        // certo ali é não desenhar selo nenhum, e nunca inventar um.
        expect(excedenteDeGrupo({ permission: 'read' })).toBeNull();
        expect(excedenteDeGrupo({ effectivePermission: 'write' })).toBeNull();
        expect(excedenteDeGrupo({ permission: 'read', effectivePermission: 'inventado' })).toBeNull();
        expect(excedenteDeGrupo({})).toBeNull();
        expect(excedenteDeGrupo(null)).toBeNull();
    });

    it('`owner` não vira selo, porque não é nível concedível', () => {
        // Dono não se concede por caminho nenhum (cláusula 5.3), e o seletor do modal tem
        // quatro níveis. Um `owner` que chegasse aqui não pode desenhar rótulo.
        expect(excedenteDeGrupo({ permission: 'read', effectivePermission: 'owner' })).toBeNull();
    });
});
