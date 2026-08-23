// Path: tests/unit/dono-de-atlas-espelha-servidor.test.js

/**
 * @fileoverview "QUEM O SERVIDOR TRATA COMO DONO DESTE ATLAS", e o defeito é uma divergência
 * REAL entre cliente e servidor, não uma questão de estilo.
 *
 * A CAUSA RAIZ. `_renderMemberItem` (`src/js/modals/sharing.modal.js`) gateava o botão
 * "Tornar dono" por `sessionContext.role === 'owner'`. O servidor concede `owner` ao
 * administrador GLOBAL dentro de `requireAtlasPermission` (`backend/src/middleware/
 * permissions.js`, o ramo `req.user?.role === 'admin'`), e `POST /atlas/:atlasId/transfer` é
 * gateado exatamente em `requireAtlasPermission('owner')`. Ou seja, a rota ACEITAVA a
 * transferência que a tela não oferecia. O vizinho `account.control.js` respondia a MESMA
 * pergunta com `owner || admin` em `_updateDeleteAtlasVisibility`: duas listas fechadas para um
 * gate de servidor só, divergentes, que é a forma que a constituição proíbe.
 *
 * POR QUE ELE IMPORTA O BACKEND. `toFrontendRole` (`backend/src/utils/roles.js`) é o ÚNICO
 * ponto em que os dois eixos se encostam, e é ele que dobra o `admin` global para dentro da
 * escada por atlas antes de o papel chegar ao `sessionContext`. Comparar o predicado do cliente
 * com uma reimplementação da regra escrita aqui não provaria nada: a asserção que tem dentes é
 * contra a função de verdade, no mesmo processo, sobre o produto cartesiano inteiro. É a forma
 * de `sync-trace-espelha-backend.test.js`, incluindo a parte que mais importa, a asserção
 * ABSOLUTA em cada bloco: comparar duas cópias só uma com a outra deixa passar duas cópias
 * erradas do mesmo jeito.
 *
 * ALCANCE: ele cobre o PREDICADO. Que a tela chame o predicado no lugar certo é verificado por
 * leitura textual no fim deste arquivo, e o botão desenhado só se vê por captura do Playwright,
 * que fica fora do `npm test`.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { serverTreatsAsAtlasOwner } from '@js/projects/permission-levels.js';
import { UserRole, GlobalRole } from '@store/sync/session-context.js';
import { toFrontendRole } from '../../../backend/src/utils/roles.js';

/** Os cinco valores do contrato do servidor (`permission`), mais a ausência de relação. */
const PERMISSOES_DO_SERVIDOR = ['read', 'comment', 'write', 'manage', 'owner', null];

describe('serverTreatsAsAtlasOwner — os seis papéis do eixo POR ATLAS', () => {
    it('PISO: os dois vocabulários foram de fato carregados', () => {
        // Sem isto, um import que resolvesse para objeto vazio reportaria verde comparando
        // conjuntos vazios, que é a cobertura vazia que a constituição manda caçar.
        expect(Object.values(UserRole).sort())
            .toEqual(['admin', 'commenter', 'editor', 'manager', 'owner', 'viewer']);
        expect(Object.values(GlobalRole).sort())
            .toEqual(['admin', 'credenciado', 'producer', 'user']);
        expect(typeof toFrontendRole).toBe('function');
    });

    it('responde TRUE para exatamente dois dos seis, em asserção absoluta', () => {
        const donos = Object.values(UserRole).filter((r) => serverTreatsAsAtlasOwner(r)).sort();
        expect(donos).toEqual(['admin', 'owner']);
    });

    it('o `owner` do atlas é dono, e o `admin` GLOBAL dobrado na escada também', () => {
        expect(serverTreatsAsAtlasOwner(UserRole.OWNER)).toBe(true);
        // O caso do defeito: o gate antigo (`role === 'owner'`) respondia false aqui e escondia
        // um botão que `POST /atlas/:atlasId/transfer` teria obedecido.
        expect(serverTreatsAsAtlasOwner(UserRole.ADMIN)).toBe(true);
    });

    it('o co-Gestor NÃO é dono, e essa é a metade que o gate antigo acertava', () => {
        // `manage` compartilha e configura o atlas; passar a POSSE adiante é outra coisa, e o
        // servidor a recusa com 403 em `requireAtlasPermission('owner')`.
        expect(serverTreatsAsAtlasOwner(UserRole.MANAGER)).toBe(false);
        expect(serverTreatsAsAtlasOwner(UserRole.EDITOR)).toBe(false);
        expect(serverTreatsAsAtlasOwner(UserRole.COMMENTER)).toBe(false);
        expect(serverTreatsAsAtlasOwner(UserRole.VIEWER)).toBe(false);
    });
});

describe('serverTreatsAsAtlasOwner — os quatro papéis do eixo GLOBAL', () => {
    it('só `admin` atravessa; `producer` e `credenciado` NÃO', () => {
        // Os quatro valores globais, dados crus ao predicado. O eixo global não é uma escada, e
        // "completar" o curto-circuito com produtor e credenciado é o erro que o `fileoverview`
        // de `backend/src/utils/roles.js` existe para impedir.
        expect(serverTreatsAsAtlasOwner(GlobalRole.ADMIN)).toBe(true);
        expect(serverTreatsAsAtlasOwner(GlobalRole.PRODUCER)).toBe(false);
        expect(serverTreatsAsAtlasOwner(GlobalRole.CREDENCIADO)).toBe(false);
        expect(serverTreatsAsAtlasOwner(GlobalRole.USER)).toBe(false);
    });

    it('ESPELHO: sobre o cartesiano inteiro, a tela concorda com o servidor', () => {
        // A regra do servidor, escrita como ele a executa em `requireAtlasPermission`: o admin
        // global vira `owner` antes de qualquer consulta de share; todos os outros dependem do
        // `owner_id`. Esta é a única linha do arquivo que reafirma a regra, e é contra a função
        // de VERDADE (`toFrontendRole`) que ela é comparada.
        const servidorConcedeOwner = (permission, globalRole) =>
            globalRole === 'admin' || permission === 'owner';

        let pares = 0;
        let comAcesso = 0;
        for (const globalRole of Object.values(GlobalRole)) {
            for (const permission of PERMISSOES_DO_SERVIDOR) {
                const papelNaTela = toFrontendRole(permission, globalRole);
                const esperado = servidorConcedeOwner(permission, globalRole);
                expect(
                    serverTreatsAsAtlasOwner(papelNaTela),
                    `permission=${permission} globalRole=${globalRole} → ${papelNaTela}`,
                ).toBe(esperado);
                pares += 1;
                if (esperado) comAcesso += 1;
            }
        }
        // O laço só prova alguma coisa se tiver rodado, e só discrimina se as DUAS respostas
        // aparecerem: um predicado que devolvesse sempre `true` passaria num laço só de
        // verdadeiros. São 4 papéis globais × 6 permissões, e 9 pares com acesso (os 6 do
        // admin global, mais `owner` para cada um dos outros 3).
        expect(pares).toBe(24);
        expect(comAcesso).toBe(9);
        expect(pares - comAcesso).toBe(15);
    });
});

describe('serverTreatsAsAtlasOwner — entrada suja falha FECHADA', () => {
    it('nada que não seja uma das duas strings concede posse', () => {
        for (const lixo of [null, undefined, '', '  owner  ', 'OWNER', 'Admin', 0, 1, true,
            {}, [], ['owner'], 'superuser', 'manage']) {
            expect(serverTreatsAsAtlasOwner(lixo)).toBe(false);
        }
    });

    it('não confunde propriedade herdada de Object com papel', () => {
        // Um `ROLES[role]` ingênuo devolveria uma função para estes dois e leria como verdadeiro.
        expect(serverTreatsAsAtlasOwner('constructor')).toBe(false);
        expect(serverTreatsAsAtlasOwner('toString')).toBe(false);
    });
});

describe('a tela consome o predicado, e não uma lista fechada própria', () => {
    const SHARING = readFileSync(
        fileURLToPath(new URL('../../src/js/modals/sharing.modal.core.js', import.meta.url)),
        'utf8',
    );

    it('`sharing.modal.js` importa e chama `serverTreatsAsAtlasOwner`', () => {
        expect(SHARING).toMatch(/from\s+'@js\/projects\/permission-levels\.js'/);
        expect(SHARING).toMatch(/serverTreatsAsAtlasOwner\(sessionContext\.role\)/);
    });

    it('e não sobrou a comparação por igualdade que causou o defeito', () => {
        // O texto exato do gate antigo. Comentários deste arquivo citam o papel entre crases,
        // nunca nesta forma, então o casamento aqui só pode vir de código vivo.
        expect(SHARING).not.toMatch(/sessionContext\.role\s*===\s*'owner'/);
    });

    it('a busca acha de fato o padrão proibido (controle do matcher)', () => {
        // Sem este controle, uma regex que não casasse com nada reportaria verde para um
        // arquivo que ainda tivesse a lista fechada dentro.
        const isca = "const t = sessionContext.role === 'owner' ? 1 : 0;";
        expect(isca).toMatch(/sessionContext\.role\s*===\s*'owner'/);
    });
});
