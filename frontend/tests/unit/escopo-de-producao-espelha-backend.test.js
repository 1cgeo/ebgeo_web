// Path: tests/unit/escopo-de-producao-espelha-backend.test.js

/**
 * @fileoverview O espelho entre o veredito do CLIENTE e o do SERVIDOR.
 *
 * O PAR QUE ESTE ARQUIVO PRENDE. `verdictOfChange`
 * (`frontend/src/js/admin/producer-scope-phrases.js`) decide se a tela PEDE CONFIRMAÇÃO antes de
 * um PUT que pode derrubar concessões de raiz; `fundamentoDeRaizPerdido`
 * (`backend/src/modules/users/producer-scope-verdict.js`) decide se o servidor de fato PODA. São
 * duas implementações da mesma decisão, e o custo de divergirem é conhecido porque já foi pago: o
 * administrador destruía as concessões de um produtor e lia um toast dizendo "usuário atualizado".
 *
 * ATÉ 2026-08-24 NÃO HAVIA TESTE NENHUM ligando os dois, e os dois cabeçalhos diziam isso por
 * extenso, com um motivo verdadeiro: o espelho é folha e `users.service.js` puxa banco e bcrypt.
 * A conclusão é que era evitável — o que precisava ficar leve era o PREDICADO, não o serviço. Ele
 * foi extraído para um módulo folha, e este teste carrega os DOIS no mesmo processo, que é o mesmo
 * padrão de `sync-trace-espelha-backend.test.js`.
 *
 * O ALCANCE É A TABELA VERDADE, NUNCA A SEMÂNTICA. Um veredito certo consultado no lugar errado
 * (ou não consultado) passa verde aqui. O que este arquivo impede é a DIVERGÊNCIA entre os dois
 * lados, que é a classe de defeito que o par produz.
 */

import { describe, it, expect } from 'vitest';
import { verdictOfChange } from '../../src/js/admin/producer-scope-phrases.js';
import {
    fundamentoDeRaizPerdido,
    PAPEIS_DE_DADO_GLOBAL as PAPEIS_SERVIDOR,
} from '../../../backend/src/modules/users/producer-scope-verdict.js';

/**
 * O MAPEAMENTO ENTRE OS DOIS VOCABULÁRIOS, que é onde mora o contrato de verdade.
 *
 * Os dois lados NÃO usam as mesmas palavras, e isso é decisão e não descuido: o servidor precisa
 * de dois fundamentos (é o que ele grava como origem da poda), e o cliente precisa de TRÊS
 * motivos, porque a frase de confirmação muda entre "você trocou a OM deste produtor" e "você
 * rebaixou este produtor" — o efeito é o mesmo e a explicação não é.
 *
 * Este objeto é a única cópia dessa tradução. Enquanto ela vivia na cabeça de quem leu os dois
 * arquivos, o par se mantinha por leitura, que é exatamente o que ambos os cabeçalhos admitiam.
 */
const FUNDAMENTO_DO_MOTIVO = Object.freeze({
    papel_global: 'acesso_global_de_dado',
    trocou_om: 'escopo_de_producao',
    rebaixou_produtor: 'escopo_de_producao',
});

const PAPEIS = ['user', 'producer', 'credenciado', 'admin'];
const OMS = [null, 'om-a', 'om-b'];

/**
 * A grade de mudanças que exercita todos os ramos dos dois lados.
 *
 * Não é uma lista de casos escolhidos a dedo: é o produto cartesiano dos quatro papéis globais por
 * três estados de OM produtora, dos dois lados da mudança. Casos escolhidos a dedo cobrem o que
 * quem escreve já pensou, e é justamente o ramo não pensado que diverge.
 * @returns {Array<{antes: Object, depois: Object}>}
 */
function todasAsMudancas() {
    const linhas = [];
    for (const rAntes of PAPEIS) {
        for (const omAntes of OMS) {
            for (const rDepois of PAPEIS) {
                for (const omDepois of OMS) {
                    linhas.push({
                        antes: { role: rAntes, producer_org_id: omAntes },
                        depois: { role: rDepois, producer_org_id: omDepois },
                    });
                }
            }
        }
    }
    return linhas;
}

describe('o veredito do cliente espelha o do servidor', () => {
    it('a grade tem os 144 pares esperados (guarda contra a geração esvaziar em silêncio)', () => {
        // Sem esta linha, um erro na montagem faria o laço abaixo iterar sobre lista vazia e
        // reportar sucesso sem comparar nada, que é a cobertura vazia da constituição.
        expect(todasAsMudancas()).toHaveLength(PAPEIS.length * OMS.length * PAPEIS.length * OMS.length);
        expect(todasAsMudancas()).toHaveLength(144);
    });

    it('os dois lados concordam em TODAS as 144 mudanças, sob o mapeamento declarado', () => {
        const divergencias = [];
        for (const { antes, depois } of todasAsMudancas()) {
            const servidor = fundamentoDeRaizPerdido(antes, depois);
            const cliente = verdictOfChange(antes, depois);
            const esperado = FUNDAMENTO_DO_MOTIVO[cliente] ?? null;
            if (esperado !== servidor) {
                divergencias.push({
                    de: `${antes.role}/${antes.producer_org_id}`,
                    para: `${depois.role}/${depois.producer_org_id}`,
                    servidor,
                    cliente,
                });
            }
        }
        expect(divergencias).toEqual([]);
    });

    it('o cliente pergunta EXATAMENTE quando o servidor poda, nem mais nem menos', () => {
        // Esta é a propriedade que o par existe para garantir, dita sem vocabulário nenhum: uma
        // pergunta a menos destrói acesso em silêncio; uma a mais treina a confirmar sem ler.
        const sobrando = [];
        const faltando = [];
        for (const { antes, depois } of todasAsMudancas()) {
            const poda = fundamentoDeRaizPerdido(antes, depois) !== null;
            const pergunta = verdictOfChange(antes, depois) !== null;
            if (pergunta && !poda) sobrando.push({ antes, depois });
            if (poda && !pergunta) faltando.push({ antes, depois });
        }
        expect(faltando).toEqual([]);
        expect(sobrando).toEqual([]);
    });

    it('o vocabulário de papel de dado global é o MESMO conjunto dos dois lados', () => {
        // Absoluto, e não uma comparação entre os dois: comparar só um com o outro passaria verde
        // com os dois errados do mesmo jeito, que é como um par de espelhos apodrece junto.
        expect([...PAPEIS_SERVIDOR].sort()).toEqual(['admin', 'credenciado']);
    });

    it('os três desfechos do servidor são de fato alcançáveis pela grade', () => {
        // Um teste de concordância entre dois lados que nunca saem de `null` concordaria sempre.
        const vistos = new Set(
            todasAsMudancas().map(({ antes, depois }) => fundamentoDeRaizPerdido(antes, depois)),
        );
        expect([...vistos].sort()).toEqual(['acesso_global_de_dado', 'escopo_de_producao', null].sort());
    });
});
