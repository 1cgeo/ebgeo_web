// Path: tests/unit/visita-publica-pinta-o-mapa-ativo.test.js
//
// A VISITA PÚBLICA ABRIA SEM FEIÇÃO NENHUMA, POR CORRIDA (dono, 2026-09-21).
//
// O SINTOMA, nas palavras dele: o site abre no `Principal`, depois aparecem os mapas e o `Mapa 1`
// vira o ativo, mas as feições não carregam; trocar de mapa as mostra, e uma edição de outro
// usuário também.
//
// A CAUSA. `activateAtlasInitialMap` troca o mapa corrente e NÃO pinta nada. O caminho de abertura
// pela conta (`openRemoteAtlas`) sempre soube disso e termina com um `switchMap` explícito. O
// caminho do visitante monta o namespace por conta própria, não passa por `openRemoteAtlas`, e não
// tinha essa linha: quem pintava era a PRIMEIRA pintura do boot, quando ela acontecia DEPOIS da
// chegada do retrato. Com o retrato chegando depois, o boot pintava o `Principal` vazio e nada
// repintava.
//
// MEDIDO, em série, contra a base de desenvolvimento, num atlas de dois mapas cujo mapa ativo tem
// cinco feições, contando feição renderizada de fonte GeoJSON nove segundos depois de cada carga:
//
//   sem a linha   2 cargas com feição em 6
//   com a linha   8 cargas com feição em 8
//
// Com UM mapa só a corrida quase sempre era ganha, e foi por isso que a reprodução do dia anterior,
// num navegador limpo, mostrou as feições e quase encerrou a investigação.
//
// O QUE ESTE ARQUIVO PRENDE é a ORDEM, nos DOIS caminhos, lendo o texto: a propriedade é uma linha,
// e uma linha some numa reescrita sem nada ficar vermelho. A taxa acima é de navegador e não se
// reproduz em `node`.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ler = (rel) => readFileSync(new URL(`../../src/js/${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

const FRONT = fileURLToPath(new URL('../..', import.meta.url));

const ATIVA = 'await activateAtlasInitialMap(';
const PINTA = "await getControl('BaseLayerControl')?.switchMap?.(false);";

describe('quem ativa o mapa inicial de um atlas de servidor também o pinta', () => {
    it('o caminho do VISITANTE: ativa, pinta e só então anuncia a visita', () => {
        const fonte = ler('index.js');
        const inicio = fonte.indexOf('async function openPublicAtlasFromUrl(');
        expect(inicio).toBeGreaterThan(-1);
        const corpo = fonte.slice(inicio, fonte.indexOf('\n}\n', inicio));

        // O ramo da VISITA é o que vem depois do token efêmero; o da conta delega a `openAtlasFromUrl`.
        const visita = corpo.slice(corpo.indexOf('apiClient.setEphemeralToken(atlas.publicToken)'));
        const ativa = visita.indexOf(ATIVA);
        const pinta = visita.indexOf(PINTA);
        expect(ativa).toBeGreaterThan(-1);
        expect(pinta, 'a visita ativa o mapa e não o pinta').toBeGreaterThan(ativa);
        expect(visita.indexOf('Visita pública ao atlas')).toBeGreaterThan(pinta);
        // Dentro do `try`: uma pintura que lance cai no aviso de falha local, e não num boot mudo.
        expect(pinta).toBeLessThan(visita.indexOf('} catch (error) {'));
    });

    it('PISO: o caminho da CONTA, de onde a linha foi copiada, continua com ela', () => {
        const fonte = ler('account/open-atlas.service.js');
        const ativa = fonte.indexOf(ATIVA);
        expect(ativa).toBeGreaterThan(-1);
        expect(fonte.indexOf(PINTA, ativa)).toBeGreaterThan(ativa);
    });

    it('CENSO: todo chamador de fora da store ativa E pinta, e chamador novo reprova até entrar na lista', () => {
        const rastreados = execFileSync('git', ['ls-files', 'src/js'], { cwd: FRONT, encoding: 'utf8' })
            .split('\n').filter((f) => f.endsWith('.js') && !f.startsWith('src/js/store/'));
        expect(rastreados.length, 'inventário vazio: o censo não estaria medindo nada').toBeGreaterThan(100);

        const chamadores = rastreados.filter((f) => ler(f.replace(/^src\/js\//, '')).includes(ATIVA));
        expect(chamadores.sort()).toEqual([
            'src/js/account/account.control.js',   // "Salvar no servidor": sobe o atlas local e o abre
            'src/js/account/open-atlas.service.js', // a abertura pela conta
            'src/js/index.js',                      // a visita pública
        ]);

        for (const arquivo of chamadores) {
            const fonte = ler(arquivo.replace(/^src\/js\//, ''));
            let de = 0;
            for (;;) {
                const ativa = fonte.indexOf(ATIVA, de);
                if (ativa === -1) break;
                const pinta = fonte.indexOf(PINTA, ativa);
                expect(pinta, `${arquivo}: ativação sem pintura depois dela`).toBeGreaterThan(ativa);
                // PERTO: a pintura de OUTRA função, mil linhas abaixo, não conta como a desta.
                expect(fonte.slice(ativa, pinta).split('\n').length, `${arquivo}: pintura longe demais da ativação`)
                    .toBeLessThan(25);
                de = ativa + ATIVA.length;
            }
        }
    });
});
