// Path: tests/unit/criacao-recusa-na-entrada.test.js
//
// AS SUPERFÍCIES DE CRIAÇÃO PEDEM DADOS ANTES DE DESCOBRIR QUE NÃO PODEM.
//
// O defeito, medido em 2026-08-23: `checkPermission` e `GuardAction` devolviam ZERO
// ocorrências em `src/js/briefing/`, `src/js/layers/`, `src/js/3d_models_viewer_tool/` e
// `src/js/street_view_tool/`. Na prática:
//
//   - "Novo mapa" gerava o nome sugerido e abria o prompt; a recusa vinha de `addMap`.
//   - "Importar" abria o seletor de arquivos; a recusa vinha depois de escolher o `.ebgeo`.
//   - "CRIAR BRIEFING" batizava o briefing; a recusa vinha de `createBriefing`.
//   - As ferramentas de marcador 3D e 360 punham o cursor em cruz e deixavam a pessoa
//     mirar e clicar na cena; a recusa vinha de `addMarker3D` / `addMarker360`.
//
// Em todos, o gesto inteiro era gasto para chegar a um "não". O modelo de como fazer certo
// já existia no mesmo produto (`CommentOverlay.togglePlacement`, que recusa a ENTRADA no
// modo e nomeia o motivo real entre três possíveis).
//
// ================= O QUE ESTE ARQUIVO PRENDE, E O QUE ELE NÃO ALCANÇA =========
//
// Ele prende UMA propriedade por sítio: o ponto de entrada consulta `checkPermission` com a
// chave certa ANTES de chamar a operação de store que iria recusar. É varredura de texto,
// então o que ele mede é a PRESENÇA e a ORDEM das duas chamadas, nunca a semântica: um gate
// escrito com a chave certa dentro de um `if (false)` passa verde aqui.
//
// O que ele deliberadamente NÃO faz é varrer as quatro pastas atrás de "todo escritor tem
// gate". Essa varredura precisaria saber quais funções escrevem, e a lista viveria aqui,
// desatualizada, dando a impressão de cobertura que não existe. A lista abaixo é de sítios
// CONHECIDOS, com o nome do defeito ao lado, e cresce quando alguém achar o próximo.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/** Lê um arquivo de `src/` pelo caminho relativo ao pacote. */
const fonte = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');

/**
 * OS SÍTIOS, com a chave de capacidade e a operação de store que recusava depois.
 *
 * `entrada` é a assinatura do ponto de entrada, e é o que amarra o caso ao lugar certo: sem
 * ela, o teste passaria se o `checkPermission` estivesse em qualquer outro método do arquivo.
 */
const SITIOS = Object.freeze([
    {
        nome: 'Novo mapa',
        arquivo: 'src/js/sidebar/tabs/maps.tab.js',
        entrada: 'async _handleNewMap()',
        chave: 'CREATE_MAP',
        operacaoQueRecusavaDepois: 'showPrompt'
    },
    {
        nome: 'Importar para o atlas',
        arquivo: 'src/js/sidebar/tabs/maps.tab.js',
        entrada: '_handleImportAdditive()',
        chave: 'IMPORT_DATA',
        operacaoQueRecusavaDepois: 'fileInput'
    },
    {
        nome: 'Criar briefing',
        arquivo: 'src/js/sidebar/tabs/briefings.tab.js',
        entrada: 'async _handleCreateBriefing()',
        chave: 'CREATE_BRIEFING',
        operacaoQueRecusavaDepois: 'createBriefing('
    },
    {
        nome: 'Marcador 3D',
        arquivo: 'src/js/3d_models_viewer_tool/map_3d.js',
        entrada: "case 'add-marker-3d':",
        chave: 'CREATE_MARKER_3D',
        operacaoQueRecusavaDepois: 'activateMarkerTool('
    },
    {
        nome: 'Marcador 360',
        arquivo: 'src/js/street_view_tool/tools/marker_tool_360.js',
        entrada: 'export function activateMarkerTool(',
        chave: 'CREATE_MARKER_360',
        operacaoQueRecusavaDepois: 'isActive = true'
    }
]);

describe('criação: a recusa acontece na ENTRADA, não depois do gesto', () => {
    it('PISO: a lista de sítios não encolheu sem alguém dizer por quê', () => {
        // Cobertura vazia passa verde: um `SITIOS` esvaziado deixaria todo `for` abaixo
        // trivialmente satisfeito, e este arquivo reportaria sucesso sem verificar nada.
        expect(SITIOS.length).toBeGreaterThanOrEqual(5);
    });

    for (const sitio of SITIOS) {
        it(`${sitio.nome}: consulta ${sitio.chave} antes de gastar o gesto`, () => {
            const codigo = fonte(sitio.arquivo);

            const ondeEntra = codigo.indexOf(sitio.entrada);
            expect(ondeEntra, `a entrada \`${sitio.entrada}\` não existe mais`).toBeGreaterThan(-1);

            // A partir da entrada, o gate tem de vir ANTES do gesto caro. Comparar posições é o
            // que separa "o arquivo menciona a chave" de "o caminho consulta a chave": a primeira
            // versão deste teste só procurava a chave no arquivo e passaria com o gate posto
            // depois do prompt, que é exatamente o defeito.
            const depois = codigo.slice(ondeEntra);
            const ondeGate = depois.indexOf(`checkPermission('${sitio.chave}')`);
            const ondeGesto = depois.indexOf(sitio.operacaoQueRecusavaDepois);

            expect(ondeGate, `${sitio.nome} não consulta \`${sitio.chave}\``).toBeGreaterThan(-1);
            expect(ondeGesto, `a âncora \`${sitio.operacaoQueRecusavaDepois}\` sumiu`).toBeGreaterThan(-1);
            expect(ondeGate, `${sitio.nome}: o gate vem DEPOIS do gesto`).toBeLessThan(ondeGesto);
        });

        it(`${sitio.nome}: a recusa nomeia o motivo, em vez de sair calada`, () => {
            // Um `return` mudo é a metade do conserto, e é a metade que deixa a pessoa clicando
            // num botão que não faz nada. A frase vem de `denialNotice`, que é keyed por
            // capacidade e não repete a mentira do "somente leitura".
            const codigo = fonte(sitio.arquivo);
            const depois = codigo.slice(codigo.indexOf(sitio.entrada));
            const ondeGate = depois.indexOf(`checkPermission('${sitio.chave}')`);
            const janela = depois.slice(ondeGate, ondeGate + 400);
            expect(janela, `${sitio.nome} recusa sem dizer por quê`).toMatch(/denialNotice\(/);
        });
    }

    it('CONTROLE: a varredura reprova quando o gate sai', () => {
        // Sem este par, os casos acima passariam idênticos se `indexOf` estivesse devolvendo
        // sempre 0 por algum engano no helper. Aqui a busca é por algo que NÃO está lá.
        const codigo = fonte(SITIOS[0].arquivo);
        expect(codigo.indexOf("checkPermission('NAO_EXISTE_ESTA_CHAVE')")).toBe(-1);
    });
});

describe('criação: as afordâncias de escrita seguem o mesmo regime do modo de leitura', () => {
    it('o botão de criar briefing é escondido por `is-view-only`', () => {
        // `view-mode.controller.js` liga `is-view-only` pela MESMA capacidade que criar briefing
        // exige (`CREATE_BRIEFING` resolve para `canEdit`), então marcar o botão com
        // `edit-affordance` faz o gate proativo alcançá-lo sem mecanismo novo.
        expect(fonte('src/js/sidebar/tabs/briefings.tab.js'))
            .toMatch(/briefings-create-btn edit-affordance/);
        expect(fonte('src/css/view-mode.css')).toMatch(/body\.is-view-only \.edit-affordance/);
    });

    // "Novo mapa" escondido pela capacidade no mesmo repintar da grade de ações é prendido em
    // `aba-mapas-acoes-por-estado.test.js`, que já tem o `corpoDeMetodo` ancorado na DEFINIÇÃO.
    // A primeira versão deste arquivo repetiu a asserção com um `indexOf` do nome cru e casou o
    // sítio de CHAMADA, que aparece antes: a duplicata não só era redundante como estava errada,
    // e é exatamente a armadilha que o cabeçalho daquele arquivo descreve.
});
