// Path: tests/unit/portao-de-montagem.test.js
//
// O PORTÃO DE MONTAGEM DE ATLAS (E3).
//
// Montar um atlas é apontar os dez bancos por atlas para um namespace. Quem monta decide
// onde TODA escrita subsequente cai, então um chamador novo que monte errado não produz
// erro: produz dado no banco de outro atlas, ou fora de qualquer registro, e o defeito
// aparece num logout muito depois. Foi assim com `saveLocalToServer`, que marcava a origem
// REMOTE, limpava e conectava sem nunca ativar o namespace: o snapshot do servidor caía em
// `ebgeo_maps` e a próxima carga anônima o montava como o atlas local do usuário.
//
// A revisão humana não pega isso, e a razão é a ponte: `ensureAtlasScope`
// (`store/repositories/local.repository.js`) ativa o slot legado quando NÃO há escopo ativo,
// para que uma instalação pré-namespace continue funcionando. O efeito colateral é que um
// "esqueci de ativar" não explode, ele cai silenciosamente no banco legado. Um chamador novo
// e errado parece funcionar em toda leitura casual.
//
// ===========================================================================
// O QUE ESTE ARQUIVO PRENDE, E O QUE ELE NÃO PRENDE
// ===========================================================================
// Prende: a LISTA de quem pode montar, e a ORDEM dentro das entradas em atlas de servidor.
// Não prende: que a montagem esteja CERTA. Uma varredura de fonte não sabe se
// `activateRemoteAtlas(x)` recebeu o id certo. A prova de comportamento é
// `tests/unit/multiaba-invariantes.test.js`, que dirige os caminhos e lê o nome do banco.
// As duas metades são necessárias: sozinha, esta aqui é satisfeita por um chamador que
// chama tudo na ordem certa com o argumento errado.

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'js');

/**
 * Strips line and block comments, so a mention in prose never counts as a call.
 *
 * The naive version of this guard matched its own explanatory comments, which is a defect
 * this repository has already paid for twice. It is exercised by a fixture below rather
 * than trusted, because a stripper that silently returned its input would make every
 * "nobody calls this" assertion vacuously true.
 * @param {string} source
 * @returns {string}
 */
function stripComments(source) {
    return source
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split(/\r?\n/)
        .map(line => line.replace(/(^|[^:])\/\/.*$/, '$1'))
        .join('\n');
}

/** @returns {Array<{rel: string, full: string}>} Every `.js` under `src/js`. */
function listJsFiles(dir = SRC, prefix = '') {
    const out = [];
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) out.push(...listJsFiles(full, `${prefix}${entry}/`));
        else if (entry.endsWith('.js')) out.push({ rel: `${prefix}${entry}`, full });
    }
    return out;
}

/** @returns {string[]} Files whose CODE (never a comment) calls `name(`. */
function callersOf(name) {
    const pattern = new RegExp(`(^|[^\\w.])${name}\\s*\\(`, 'm');
    return listJsFiles()
        .filter(({ full }) => pattern.test(stripComments(readFileSync(full, 'utf8'))))
        .map(({ rel }) => rel)
        .sort();
}

const read = rel => readFileSync(join(SRC, rel), 'utf8');

describe('o removedor de comentários funciona (senão todo `not.toMatch` abaixo é vazio)', () => {
    it('apaga a menção em comentário e preserva a chamada real', () => {
        const fixture = [
            '// activateScope(localScope("comentada"));',
            '/* activateScope(remoteScope("em bloco")); */',
            'const url = "http://exemplo";      // não é comentário: a barra dupla do protocolo',
            'activateScope(localScope("real"));'
        ].join('\n');

        const limpo = stripComments(fixture);

        expect(limpo).toContain('activateScope(localScope("real"))');
        expect(limpo).not.toContain('comentada');
        expect(limpo).not.toContain('em bloco');
        // A URL sobrevive: um stripper que cortasse em toda `//` mutilaria código real.
        expect(limpo).toContain('http://exemplo');
        // E o total de chamadas restantes é UM, não "pelo menos uma".
        expect(limpo.match(/activateScope\s*\(/g)).toHaveLength(1);
    });
});

describe('quem pode MONTAR um escopo de atlas', () => {
    // Os quatro donos legítimos, e por que cada um.
    const DONOS = {
        'store/local-atlas.api.js': 'dono do escopo LOCAL (registro, ponteiro, troca, exclusão)',
        'store/remote-atlas.api.js': 'dono do escopo REMOTO (registra ANTES de apontar)',
        'store/repositories/local.repository.js': 'a ponte: ativa o slot legado quando não há escopo',
        'store/migration/v2.2-to-v2.3.migration.js': 'restaura o escopo anterior ao fim da migração'
    };

    it('a lista de chamadores de `activateScope` é EXATAMENTE a dos donos', () => {
        const chamadores = callersOf('activateScope')
            // A fábrica o define e o documenta; definir não é montar.
            .filter(rel => rel !== 'store/atlas-namespace.js');

        // Controle de cobertura vazia: uma varredura quebrada devolve [] e passaria em
        // qualquer comparação que só proibisse extras.
        expect(chamadores.length).toBeGreaterThan(0);

        // ESTRITA NOS DOIS SENTIDOS. Sobrar é um chamador novo que ninguém revisou; FALTAR é
        // uma entrada desta allowlist que virou letra morta, e uma allowlist que envelhece
        // sozinha deixa de ser um portão e vira uma lista de desculpas.
        expect(chamadores).toEqual(Object.keys(DONOS).sort());
    });

    // A QUINTA ENTRADA EM ATLAS, e a razão de ela ser vigiada por nome próprio.
    //
    // `activateScope` continua com os mesmos quatro donos acima, então uma entrada nova que passe
    // por `local-atlas.api.js` NÃO aparece naquela lista: o portão de cima ficaria calado. Montar
    // um slot local POR CIMA de um atlas de servidor montado é justamente o que o import de
    // `.ebgeo` passou a fazer (P4), e é uma decisão, não um efeito colateral de mover o ponteiro:
    // `setCurrentLocalAtlas` se recusa a fazê-lo de propósito, e `mountLocalAtlas` existe para
    // quem diz que quer. Um segundo chamador aqui é uma entrada em atlas que ninguém revisou.
    it('`mountLocalAtlas` tem UM chamador fora do módulo que o define', () => {
        const chamadores = callersOf('mountLocalAtlas')
            .filter(rel => rel !== 'store/local-atlas.api.js');

        // Cobertura vazia: uma varredura quebrada devolve [] e passaria no `toEqual` abaixo se ele
        // fosse comparado contra uma lista vazia por acidente.
        expect(chamadores.length).toBeGreaterThan(0);
        expect(chamadores).toEqual(['account/open-atlas.service.js']);
    });

    // DOIS chamadores, e o segundo entrou de propósito em 2026-08-16, quando "Seus atlas"
    // (`projetos.html`) passou a ser a UI dos atlas locais nomeados.
    //
    // POR QUE ELE NÃO PODE PASSAR PELO DONO ANTIGO: `account/open-atlas.service.js` importa a store
    // inteira, e a página de projetos existe para não carregá-la (~140 kB contra ~3,3 MB do mapa).
    // Chamar `switchToNewLocalAtlas` de lá arrastaria o mapa de volta pelo caminho transitivo.
    //
    // POR QUE ISSO É SEGURO, e é a pergunta que este portão faz: criar um slot NÃO monta nada.
    // `createLocalAtlas` escreve o registro e semeia o registro do slot por escopo EXPLÍCITO
    // (`getStoreFor(..., scope)`), sem `activateScope`, então nenhuma escrita subsequente muda de
    // endereço por causa dele. O passo que MONTA continua com um dono só (`mountLocalAtlas`, no
    // caso acima), e a tela troca de atlas por `setCurrentLocalAtlas`, que se recusa a montar por
    // cima de um atlas de servidor vivo. O que ele gasta é o teto de 10, e o teto degrada para
    // recusa nomeada, nunca para exceção nem para perda.
    //
    // A entrada é `projects/projects-page.js` e não `projects/atlas-drive.js` de propósito: o
    // componente de UI recebe tudo por callback, então a página é o ÚNICO arquivo dali que fala com
    // o registro local, e é esse o arquivo que se revisa quando esta lista mudar.
    it('`createLocalAtlas` idem: criar um slot é o passo que gasta o teto de 10', () => {
        const chamadores = callersOf('createLocalAtlas')
            .filter(rel => rel !== 'store/local-atlas.api.js');

        expect(chamadores.length).toBeGreaterThan(0);
        expect(chamadores).toEqual(['account/open-atlas.service.js', 'projects/projects-page.js']);
    });

    it('`markStoreRemote` só é chamado onde um namespace remoto foi ativado antes', () => {
        const chamadores = callersOf('markStoreRemote')
            .filter(rel => rel !== 'store/store-origin.js' && rel !== 'store/store.js');

        expect(chamadores.length).toBeGreaterThan(0);

        // Declarar a origem REMOTE sem ter montado o namespace é exatamente o defeito do
        // `saveLocalToServer`: a origem dizia servidor e o escopo continuava local.
        for (const rel of chamadores) {
            const codigo = stripComments(read(rel));
            expect(codigo, `${rel} marca REMOTE sem nunca ativar um namespace remoto`)
                .toMatch(/(^|[^\w.])activateRemoteAtlas\s*\(/m);
        }
    });

    // O PONTEIRO DE MONTAGEM POR ABA (Decisão 6 de `atlas-namespace.js`) é a resposta durável a
    // "que atlas esta aba monta", e o boot seguinte a obedece. Quem pode ESCREVÊ-LA é portanto a
    // mesma pergunta que este arquivo inteiro vigia, um nível abaixo: um chamador que declare uma
    // montagem que não aconteceu manda o próximo boot para um namespace que esta aba nunca abriu.
    //
    // O escritor e o apagador não são exportados, então a varredura aqui é o CONTROLE dessa
    // decisão: se algum deles voltar a ser exportado e ganhar um chamador, este caso reprova.
    it('só a fábrica escreve ou apaga o ponteiro de montagem desta aba', () => {
        for (const nome of ['writeTabMountPointer', 'clearTabMountPointer']) {
            // Controle de cobertura vazia: a varredura acha o módulo que os define, senão o
            // `toEqual` abaixo passaria por a busca estar quebrada.
            expect(callersOf(nome), `${nome} sumiu do código`).toEqual(['store/atlas-namespace.js']);
        }
    });

    it('esquecer um atlas de SERVIDOR é dito por um lugar só, e é onde a origem vira LOCAL', () => {
        const chamadores = callersOf('forgetRemoteTabMount')
            .filter(rel => rel !== 'store/atlas-namespace.js');

        expect(chamadores.length).toBeGreaterThan(0);
        expect(chamadores).toEqual(['store/store-origin.js']);
    });

    it('a decisão de boot lê o SNAPSHOT, e os dois leitores são os do boot', () => {
        // `bootTabMountPointer` responde "onde esta aba estava quando a página carregou", que é a
        // única versão da pergunta que um boot pode fazer: a ponte do repositório monta o escopo
        // legado ANTES de o boot decidir, então o ponteiro vivo já foi sobrescrito. Um consumidor
        // novo aqui é código que passou a decidir montagem, e isso se revisa.
        const chamadores = callersOf('bootTabMountPointer')
            .filter(rel => rel !== 'store/atlas-namespace.js');

        expect(chamadores.length).toBeGreaterThan(0);
        expect(chamadores).toEqual(['store/local-atlas.api.js', 'store/store-origin.js']);
    });
});

describe('a ordem dentro de cada entrada em atlas de servidor', () => {
    /**
     * Index of a marker inside a function body, asserted to EXIST before being compared.
     *
     * `indexOf` returns -1 when absent, and -1 compares as "earliest", so an ordering
     * assertion over a marker that vanished passes while proving nothing. Every marker is
     * therefore asserted individually first.
     * @param {string} corpo
     * @param {string} marco
     * @param {string} rotulo
     * @returns {number}
     */
    function posicaoDe(corpo, marco, rotulo) {
        const i = corpo.indexOf(marco);
        expect(i, `marco ausente (${rotulo}): ${marco}`).toBeGreaterThan(-1);
        return i;
    }

    /** @returns {string} The body of a named function, from its declaration onward. */
    function corpoDe(rel, declaracao, ate = null) {
        const fonte = stripComments(read(rel));
        const inicio = fonte.indexOf(declaracao);
        expect(inicio, `função não encontrada: ${declaracao} em ${rel}`).toBeGreaterThan(-1);
        const fim = ate ? fonte.indexOf(ate, inicio) : -1;
        return fim > inicio ? fonte.slice(inicio, fim) : fonte.slice(inicio);
    }

    it('openRemoteAtlas: ativa o namespace ANTES do wipe, e marca REMOTE depois', () => {
        const corpo = corpoDe('account/open-atlas.service.js', 'export async function openRemoteAtlas');

        const ativa = posicaoDe(corpo, 'activateRemoteAtlas(atlasId)', 'ativação');
        const limpa = posicaoDe(corpo, 'clearAllDataStore(', 'wipe');
        const marca = posicaoDe(corpo, 'markStoreRemote(atlasId)', 'marcação');

        // O wipe esvazia o escopo ATIVO. Ativar depois dele significa esvaziar o atlas errado,
        // e sob um namespace por atlas o atlas errado pode ser o dado vivo de outra aba.
        expect(ativa).toBeLessThan(limpa);
        expect(limpa).toBeLessThan(marca);
    });

    it('saveLocalToServer: idem, e este é o caminho que não tinha a ativação', () => {
        const corpo = corpoDe('account/account.control.js', 'async saveLocalToServer()');

        const ativa = posicaoDe(corpo, 'activateRemoteAtlas(result.atlasId)', 'ativação');
        const limpa = posicaoDe(corpo, 'clearAllDataStore(', 'wipe');
        const marca = posicaoDe(corpo, 'markStoreRemote(result.atlasId)', 'marcação');

        expect(ativa).toBeLessThan(limpa);
        expect(limpa).toBeLessThan(marca);
    });

    it('switchToNewLocalAtlas: cria, monta, e SÓ ENTÃO esvazia e declara LOCAL', () => {
        // A entrada em atlas LOCAL obedece a mesma ordem das três de servidor, pela mesma razão: o
        // wipe esvazia o escopo ATIVO, então esvaziar antes de montar cairia sobre o namespace do
        // atlas de servidor que esta aba está DEIXANDO, que é dado vivo de outra aba quando as duas
        // seguram o mesmo atlas. E `createLocalAtlas` vem antes de tudo porque é o único passo
        // recusável (o teto de 10): recusar depois de desconectar cobraria o projeto do servidor
        // por um erro que não é do usuário.
        //
        // Esta função é a ÚLTIMA do arquivo de propósito, e o recorte até o fim do arquivo depende
        // disso: `clearAllDataStore(` e `markStoreLocal()` também aparecem em `openRemoteAtlas`.
        const corpo = corpoDe('account/open-atlas.service.js', 'export async function switchToNewLocalAtlas');

        const cria = posicaoDe(corpo, 'createLocalAtlas(name)', 'criação');
        const monta = posicaoDe(corpo, 'mountLocalAtlas(created.atlas.id)', 'montagem');
        const limpa = posicaoDe(corpo, 'clearAllDataStore(', 'wipe');
        const marca = posicaoDe(corpo, 'markStoreLocal()', 'marcação');

        expect(cria).toBeLessThan(monta);
        expect(monta).toBeLessThan(limpa);
        expect(limpa).toBeLessThan(marca);

        // Controle do RECORTE: se a função deixar de ser a última, o corpo passa a conter o de
        // `openRemoteAtlas` e as três comparações acima medem a ordem da função errada.
        expect(corpo).not.toMatch(/(^|[^\w.])markStoreRemote\s*\(/m);
    });

    it('openPublicAtlasFromUrl: idem, com o claim antes de tudo', () => {
        const corpo = corpoDe('index.js', 'async function openPublicAtlasFromUrl', 'function isCredentialFailure');

        // O marco é a chamada, NÃO a forma dela: `acquireTabLock` ganhou um segundo argumento (a
        // testemunha do lock de montagem) e a chamada passou a ocupar três linhas. Um marco que
        // exige o par de parênteses fechando junto silencia sozinho no dia em que um argumento
        // aparece, que é a mesma fragilidade que o `ATAQUE 0` de `tab-lock-refutacao.test.js`
        // trata: aqui ele não silenciou, ficou VERMELHO, porque a asserção é de ORDEM e o marco
        // ausente é detectado por `posicaoDe`.
        const reivindica = posicaoDe(corpo, 'acquireTabLock(remoteAtlasKey(atlas.id)', 'claim');
        const ativa = posicaoDe(corpo, 'activateRemoteAtlas(atlas.id)', 'ativação');
        const limpa = posicaoDe(corpo, 'clearAllDataStore(', 'wipe');

        // O claim primeiro: o wipe destrói bancos, e uma aba só pode destruir os que reivindicou.
        expect(reivindica).toBeLessThan(ativa);
        expect(ativa).toBeLessThan(limpa);
    });
});

describe('o wipe não decide sozinho o que destruir nem o que declarar (E1)', () => {
    it('`clearAllDataStore` não consulta a sessão', () => {
        const corpo = stripComments(read('store/store.js'));
        const inicio = corpo.indexOf('export async function clearAllDataStore');
        expect(inicio).toBeGreaterThan(-1);
        const fn = corpo.slice(inicio, corpo.indexOf('\n}', inicio));

        // Controle positivo do recorte: a função foi mesmo lida, e é a certa. Sem os parênteses
        // VAZIOS: `unmountCurrentAtlas` ganhou argumento (`{ clearQueue }`), e um controle
        // positivo que exige a forma sem argumento reprova por uma mudança que não é a que ele
        // vigia, o que faz o caso mentir sobre QUAL propriedade quebrou.
        expect(fn).toMatch(/unmountCurrentAtlas\(/);
        // Ler a sessão aqui é o que transformava todo wipe anônimo num logout.
        expect(fn).not.toMatch(/isAuthenticated/);
        expect(fn).not.toMatch(/discardRemoteAtlasNamespaces/);
    });

    it('a varredura é chamada por nome, e só onde a sessão acabou', () => {
        const chamadores = callersOf('discardRemoteAtlasNamespaces')
            .filter(rel => rel !== 'store/store.js');

        // Um chamador novo aqui é um caminho que passou a apagar todo atlas de servidor da
        // máquina. Há exatamente um fora do módulo que a define: o logout.
        expect(chamadores).toEqual(['account/account.control.js']);
    });
});
