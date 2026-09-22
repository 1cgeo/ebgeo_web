// Path: tests/unit/rotulo-de-pessoa-uma-regra-so.test.js

/**
 * @fileoverview COMO UMA PESSOA SE CHAMA NESTE PRODUTO É UMA REGRA SÓ, e este arquivo é o que
 * impede a segunda cópia de nascer.
 *
 * O QUE ACONTECEU. A regra (posto abreviado + nome de guerra, com a unidade ao lado) existia em
 * QUATRO cópias, cada uma numa tela que nomeia gente: `participantLabel`
 * (`modals/sharing.modal.core.js`), `accessPersonLabel` (`projects/atlas-drive.js`),
 * `memberDisplayName` (`admin/group-phrases.js`) e um par de linhas soltas dentro do
 * `_renderResults` de cada modal de busca. As quatro escreviam posto mais nome CIVIL. Quando o
 * dono pediu a forma militar, em 2026-09-20, UMA delas foi corrigida — e o produto passou a
 * chamar a mesma pessoa de `Cap Andrade` numa janela e de `Cap Maria Clara de Andrade` na
 * janela ao lado, com a busca oferecendo uma e a lista escrevendo a outra.
 *
 * POR QUE O CENSO E NÃO A LEITURA. A duplicação não deixa rastro: cada cópia está certa
 * sozinha, compila, tem teste próprio e passa. O que fica errado é a RELAÇÃO entre elas, e
 * relação não aparece em revisão de arquivo. O mesmo argumento dos censos de permissão
 * (`permissao-de-atlas-censo.test.js`) e de recurso (`superficies-de-recurso-censo.test.js`).
 *
 * O QUE ELE PRENDE, em duas metades que falham em direções opostas:
 *
 *   1. POSITIVA: cada tela que nomeia pessoa ALCANÇA o compositor único. Reescrever a escada
 *      à mão numa delas tira o import e reprova nomeando o arquivo.
 *   2. NEGATIVA (a que pega a cópia NOVA): nenhum arquivo de `src/js/` fora da folha escreve a
 *      forma da escada — a concatenação de um posto com um nome. O gatilho é MECÂNICO e
 *      estreito de propósito: um template que interpole uma variável de POSTO seguida de uma de
 *      NOME é a assinatura da cópia, e ela não tem nenhum falso positivo nesta árvore.
 *
 * O INVENTÁRIO VEM DO GIT, e não de uma lista escrita à mão, pela razão de sempre: arquivo novo
 * entra na varredura sem ninguém se lembrar dele, o que inclui o arquivo que ainda não foi
 * commitado (`--others`), que é justamente o que mais precisa ser olhado.
 *
 * O QUE ELE NÃO ALCANÇA, declarado: ele não prova que o rótulo desenhado na tela seja o certo
 * (isso é `rotulo-de-pessoa-militar.test.js`, sobre a folha, mais a captura de UI), nem alcança
 * o BACKEND, que tem o seu próprio par de campos por payload.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const FRONT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const NORM = (p) => p.split('\\').join('/');

/** A folha onde a regra mora. Ela é a única autorizada a escrever a escada. */
const FOLHA = 'src/js/utilities/person-label.js';

/**
 * AS TELAS QUE NOMEIAM PESSOA, com o motivo de cada uma estar na lista.
 *
 * A lista é escrita à mão DE PROPÓSITO, ao contrário do inventário da metade negativa: ela é
 * uma afirmação de PRODUTO ("estas telas nomeiam gente e têm de concordar"), e derivá-la de uma
 * varredura a faria encolher sozinha no dia em que alguém tirasse o import — que é exatamente o
 * defeito que ela existe para acusar.
 */
const TELAS = Object.freeze([
    ['src/js/modals/sharing.modal.core.js', 'compartilhar atlas: dono, participante e busca'],
    ['src/js/catalog/resource-share.modal.core.js', 'conceder recurso: busca de pessoas'],
    // A ENTRADA DO MAPA (`resource-share.modal.js`) é só a fiação da re-soma desde 2026-09-22:
    // quem nomeia gente é o núcleo, e é ele que a lista cobra.,
    ['src/js/catalog/grant-tree.js', 'conceder recurso: a linha, o aria-label e o diálogo'],
    ['src/js/modals/create-atlas.modal.js', 'criar atlas: busca e lista de convidados'],
    ['src/js/projects/atlas-drive.js', 'o rodapé de quem tem acesso, no cartão do atlas'],
    ['src/js/admin/groups-tab.js', 'membros de um grupo de acesso, e a busca que os põe lá'],
    ['src/js/admin/users-tab.js', 'a tabela de contas (forma militar como SECUNDÁRIA)'],
]);

/** O texto de um arquivo do pacote. */
const fonte = (rel) => readFileSync(join(FRONT, rel), 'utf8');

/**
 * Apaga o CONTEÚDO dos comentários preservando as quebras de linha, para que a prosa que
 * EXPLICA a escada (inclusive a deste arquivo e a dos `fileoverview` citados) não seja lida
 * como código que a escreve. É o mesmo tratamento dos três caminhadores de grafo.
 * @param {string} texto
 * @returns {string}
 */
function semComentarios(texto) {
    return texto
        .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
        .replace(/(^|[^:])\/\/[^\n]*/g, (m, p) => p + m.slice(p.length).replace(/[^\n]/g, ' '));
}

/**
 * A ASSINATURA DA CÓPIA: um template que cola uma variável cujo nome fala de POSTO na frente de
 * uma que fala de NOME. É a forma que as quatro cópias tinham, letra por letra:
 * `${posto} ${nome}`, `${posto} ${base}`, `${p.posto_graduacao} ${p.nome}`.
 *
 * O GATILHO É ESTREITO DE PROPÓSITO. Com `--max-warnings 0` e um censo, a regra ruidosa é a
 * regra que alguém desliga: ela cobra a CONCATENAÇÃO, que é o ato, e não a mera menção de
 * `posto_graduacao`, que toda tela que mostra uma coluna de posto faz legitimamente.
 *
 * O LADO DIREITO N\u00c3O PODE EXIGIR A PALAVRA "nome", e isso foi MEDIDO pelo controle abaixo: a
 * c\u00f3pia real de `memberDisplayName` escrevia `${posto} ${base}`, com o nome guardado numa
 * vari\u00e1vel chamada `base`, de modo que um gatilho que cobrasse `nome|name|guerra` \u00e0 direita
 * deixaria passar justamente a c\u00f3pia que motivou este arquivo. Quem discrimina \u00e9 o lado
 * ESQUERDO (\u00e9 um posto) mais a ADJAC\u00caNCIA: s\u00f3 espa\u00e7o entre as duas interpola\u00e7\u00f5es. Com qualquer
 * separador no meio (`${posto} \u00b7 ${om}`) o gatilho n\u00e3o casa, que \u00e9 o que separa a escada de uma
 * linha que apenas mostra o posto ao lado de outro campo.
 */
const ESCADA = /\$\{[^}]*(?:posto|rank|graduacao|gradua\u00e7\u00e3o)[^}]*\}[ \t]+\$\{[^}]*\}/i;

describe('o rótulo militar de uma pessoa é UMA regra, e ela mora numa folha só', () => {
    // PISO CONTRA COBERTURA VAZIA. Sem ele, um caminho errado (folha renomeada, pasta movida)
    // faria as duas metades varrerem o nada e passarem verdes.
    it('PISO: a folha existe e exporta o compositor', () => {
        const texto = fonte(FOLHA);
        expect(texto.length).toBeGreaterThan(0);
        expect(texto).toContain('export function militaryPersonLabel(');
        // E ela continua sem import nenhum, que é o que permite às sete telas alcançá-la —
        // três delas em páginas que bootam SEM a store.
        expect(semComentarios(texto)).not.toMatch(/(?:^|\n)\s*import\s/);
    });

    it('cada tela que nomeia pessoa ALCANÇA o compositor, e nenhuma o reescreve', () => {
        const faltando = [];
        for (const [rel, motivo] of TELAS) {
            const texto = semComentarios(fonte(rel));
            // Direto pela folha, ou pela tradução do prefixo do payload de concessão, que é o
            // mesmo compositor com outro shape de entrada.
            const alcanca = /militaryPersonLabel|granteePersonLabel/.test(texto);
            if (!alcanca) faltando.push(`${rel} (${motivo})`);
        }
        expect(faltando, `estas telas deixaram de usar o compositor único:\n${faltando.join('\n')}`)
            .toEqual([]);
    });

    it('e NENHUM arquivo de src/js fora da folha escreve a escada à mão', () => {
        const inventario = execFileSync(
            'git',
            ['ls-files', '--cached', '--others', '--exclude-standard', 'src/js'],
            { cwd: FRONT, encoding: 'utf8' },
        )
            .split('\n')
            .map((l) => NORM(l.trim()))
            .filter((l) => l.endsWith('.js') && l !== FOLHA);

        // PISO: o inventário do git tem de trazer a árvore inteira, senão "nenhum arquivo
        // viola" é a afirmação vazia de uma lista vazia.
        expect(inventario.length).toBeGreaterThan(400);
        for (const [rel] of TELAS) expect(inventario, `${rel} saiu do inventário`).toContain(rel);

        const violacoes = [];
        for (const rel of inventario) {
            const texto = semComentarios(fonte(rel));
            const linhas = texto.split('\n');
            for (let i = 0; i < linhas.length; i++) {
                if (ESCADA.test(linhas[i])) violacoes.push(`${rel}:${i + 1} → ${linhas[i].trim()}`);
            }
        }
        expect(violacoes, `a escada foi reescrita fora da folha:\n${violacoes.join('\n')}`)
            .toEqual([]);
    });

    // CONTROLE NEGATIVO DO PRÓPRIO GATILHO. Um censo cuja regra não casa com nada reporta
    // sucesso sem verificar nada, e é a forma de falha mais recorrente deste repositório. Estas
    // são as QUATRO cópias reais que existiam antes de 2026-09-20, copiadas letra por letra.
    it('CONTROLE: o gatilho reconhece as quatro cópias que existiam, e poupa o uso legítimo', () => {
        // As amostras são TEMPLATE LITERALS com `\${` escapado, e não strings comuns: a regra
        // `no-template-curly-in-string` acusa `${` dentro de aspas, e ela está certa em geral.
        const pegos = [
            `return \`\${posto} \${nome}\`;`,
            `return posto && nome ? \`\${posto} \${base}\` : base;`,
            `if (nome && posto) return \`\${posto} \${nome}\`;`,
            `const rotulo = \`\${u.posto_graduacao} \${u.nome_guerra}\`;`,
        ];
        for (const linha of pegos) expect(ESCADA.test(linha), linha).toBe(true);

        const poupados = [
            // A coluna de posto de uma tabela: menciona o campo e não cola nada nele.
            "tr.appendChild(cell(member.posto_graduacao || '—'));",
            // O compositor sendo CHAMADO, que é o desfecho desejado.
            'const { label } = militaryPersonLabel(u);',
            // Dois nomes colados (unidade e login) não são a escada: o que a escada faz é
            // prefixar um POSTO.
            `const detail = \`\${unit} · \${handle}\`;`,
            // O posto sozinho numa frase.
            `aria-label="Posto: \${posto}"`,
            // O posto AO LADO de outro campo, com separador: é uma linha de tabela, não a
            // escada. É o que a adjacência exigida pelo gatilho distingue.
            `title = \`\${posto} · \${organizacao}\`;`,
        ];
        for (const linha of poupados) expect(ESCADA.test(linha), linha).toBe(false);
    });
});
