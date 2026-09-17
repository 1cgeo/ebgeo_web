// Path: tests/unit/streetview-chave-da-foto.test.js
/**
 * @fileoverview O PONTO CRIADO NA PRIMEIRA FOTO SOME, E A CAUSA É A CHAVE.
 *
 * O DEFEITO, medido em 2026-09-17 contra o ambiente real (relato do dono: "na primeira vez que
 * entra na foto e cria um ponto ele não aparece, tem que sair e entrar de novo"; e depois, a pista
 * que fechou o caso: "é somente na primeira foto que eu entro, se eu navegar não dá problema").
 *
 * A rota de metadado aceita a foto pelas DUAS formas, e as consultas são literalmente duas
 * (`WHERE p.id = $1` e `WHERE p.original_name = $1`, sv360.queries.js). Os dois caminhos de
 * abertura usam formas diferentes:
 *
 *   - o pino do mapa       -> `openViewer360WithPhoto(photo[PHOTO_PROPERTY])`, e PHOTO_PROPERTY
 *                             é `'id'`, o UUID do tile (add_street_view_control.js);
 *   - a seta de navegação  -> `navigateToTarget(target.img)`, e `img` é o `original_name`.
 *
 * `loadPhoto` guardava o ARGUMENTO em `streetViewState.currentPhotoName`. Só que a ESCRITA do
 * marcador nasce com `cameraConfig.img` (o navegador emite `photoName: this.cameraConfig?.img`), e
 * toda LEITURA passa por `currentPhotoName`. Abrindo pelo mapa, a escrita ia para o nome e a
 * leitura perguntava pelo UUID: o ponto gravava no documento e nunca era desenhado.
 *
 * A MEDIDA, mesma foto e mesma sessão, sonda de tela:
 *   aberta por UUID -> marcador no disco, `navigator.pois` em 0, overlay parado em 4771 pixels;
 *   aberta por nome -> `navigator.pois` em 1, overlay em 6829 pixels.
 *
 * O CONSERTO é guardar a chave que o SERVIDOR devolveu (`data.camera.img`), e não a que veio no
 * argumento, e ler por ela nos três sítios que dependem dela dentro de `loadPhoto`.
 *
 * POR QUE TESTE DE FONTE. `street_view_viewer.js` não carrega em node (quer WebGL), o que já é a
 * razão declarada em `foto360-com-buracos-acusa.test.js` para prender a fiação dele por leitura do
 * arquivo. Vale o que teste de fonte vale, e por isso cada caso abaixo traz o CONTROLE: a mesma
 * régua rodando contra o texto de ANTES, que ela precisa reprovar.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const VIEWER = readFileSync(
    fileURLToPath(new URL('../../src/js/street_view_tool/street_view_viewer.js', import.meta.url)),
    'utf8',
);
const CONTROLE = readFileSync(
    fileURLToPath(new URL('../../src/js/street_view_tool/add_street_view_control.js', import.meta.url)),
    'utf8',
);

/** O corpo de `loadPhoto`, do cabeçalho até a função seguinte. */
function corpoDeLoadPhoto(fonte) {
    const inicio = fonte.indexOf('async function loadPhoto(');
    expect(inicio, 'loadPhoto não encontrada').toBeGreaterThan(-1);
    const fim = fonte.indexOf('\n/**', inicio);
    return fonte.slice(inicio, fim > inicio ? fim : fonte.length);
}

/** A régua: a chave vem do servidor, e as leituras usam ela. */
function reguaDaChave(corpo) {
    const atribui = /currentPhotoName\s*=\s*(chaveDaFoto|data\.camera\?\.img)/.test(corpo);
    const derivaDoServidor = /const chaveDaFoto\s*=\s*data\.camera\?\.img\s*\?\?\s*photoName/.test(corpo);
    const guardaDeCorrida = /currentPhotoName\s*!==\s*chaveDaFoto/.test(corpo);
    const orientacao = /getOrientation\(chaveDaFoto\)/.test(corpo);
    const evento = /currentPhoto:\s*chaveDaFoto/.test(corpo);
    return { atribui, derivaDoServidor, guardaDeCorrida, orientacao, evento };
}

/**
 * O TEXTO DE ANTES, reconstruído a partir do de agora. É o pior caso que a régua existe para
 * pegar, e ele roda em todos os casos abaixo.
 */
const ANTES = corpoDeLoadPhoto(VIEWER)
    .replace(/const chaveDaFoto\s*=\s*data\.camera\?\.img\s*\?\?\s*photoName;/, '')
    .replace(/currentPhotoName = chaveDaFoto/, 'currentPhotoName = photoName')
    .replace(/currentPhotoName !== chaveDaFoto/, 'currentPhotoName !== photoName')
    .replace(/getOrientation\(chaveDaFoto\)/, 'getOrientation(photoName)')
    .replace(/currentPhoto: chaveDaFoto/, 'currentPhoto: photoName');

describe('a chave da foto 360 é a que o servidor devolveu', () => {
    const agora = reguaDaChave(corpoDeLoadPhoto(VIEWER));
    const antes = reguaDaChave(ANTES);

    it('CONTROLE: o texto de antes existe e difere do de agora', () => {
        // Sem isto, um `replace` que não casa deixaria o controle idêntico ao código atual, e
        // todos os casos abaixo passariam por vacuidade.
        expect(ANTES).not.toBe(corpoDeLoadPhoto(VIEWER));
        expect(ANTES).toContain('currentPhotoName = photoName');
    });

    it('a chave é derivada de `data.camera.img`, com o argumento só como último recurso', () => {
        expect(agora.derivaDoServidor).toBe(true);
        expect(antes.derivaDoServidor).toBe(false); // a régua REPROVA o de antes
    });

    it('`currentPhotoName` recebe a chave canônica, nunca o argumento cru', () => {
        expect(agora.atribui).toBe(true);
        expect(antes.atribui).toBe(false);
    });

    it('a guarda de corrida compara contra a chave canônica', () => {
        // Se ela continuasse comparando com o argumento, a foto aberta por UUID sairia SEMPRE no
        // `return` e a tela ficaria preta: é o modo de falha que o conserto poderia introduzir.
        expect(agora.guardaDeCorrida).toBe(true);
        expect(antes.guardaDeCorrida).toBe(false);
    });

    it('a orientação salva é lida pela chave canônica', () => {
        // A orientação é GRAVADA sob `currentPhotoName`; lê-la pelo argumento perderia o giro
        // salvo exatamente na foto aberta pelo mapa.
        expect(agora.orientacao).toBe(true);
        expect(antes.orientacao).toBe(false);
    });

    it('o evento de troca de foto anuncia a chave canônica', () => {
        // O escopo da presença no 360 (cursor e seleção dos outros) é o `photoName`, e quem o
        // define para os ouvintes é este evento.
        expect(agora.evento).toBe(true);
        expect(antes.evento).toBe(false);
    });
});

describe('as duas formas que chegam a loadPhoto', () => {
    it('o pino do mapa abre pelo UUID do tile, e é isso que torna a divergência possível', () => {
        expect(CONTROLE).toMatch(/const PHOTO_PROPERTY = 'id'/);
        expect(CONTROLE).toMatch(/openViewer360WithPhoto\(photo\[PHOTO_PROPERTY\]/);
    });

    it('a escrita do marcador continua nascendo com o `original_name` da câmera', () => {
        // O outro lado da igualdade. Se um dia o navegador passar a emitir outra coisa, este caso
        // reprova junto, porque a invariante é a IGUALDADE entre as duas chaves, não cada uma.
        const navigator = readFileSync(
            fileURLToPath(new URL('../../src/js/street_view_tool/navigation/navigator.js', import.meta.url)),
            'utf8',
        );
        expect(navigator).toMatch(/photoName: this\.cameraConfig\?\.img/);
    });
});
