// Path: tests/unit/miniatura-emprestada-carimba-escopo.repro.test.js
//
// REGRESSÃO: a MINIATURA de um modelo 3D privado emprestado pelo atlas não carregava para o
// colega, enquanto o modelo aparecia e abria (relato do dono, 2026-09-22).
//
// CAUSA-RAIZ, com o elo exato. A miniatura do acervo 3D adotado é um ARQUIVO do mesmo servidor
// (`config.previewThumbnail = '/api/v1/assets3d/<id>.webp'`, que é o que
// `dev/import-catalogo-3d-legado.mjs` grava), e o índice de regime de `/api/v1/assets3d` a indexa
// como CAMPO DE ARQUIVO da linha (`CAMPOS_DE_ARQUIVO`, `backend/src/modules/nomes/assets3d-regime.js`).
// Linha privada, arquivo privado: o gate só libera por papel, concessão ou EMPRÉSTIMO, e o
// empréstimo só chega ao servidor pelo `?atlasId=`. O modelo abre porque o `tileset.json` sai por
// `descritorDeAsset`, que leva o atlas em `queryParameters`. A miniatura saía CRUA em três
// `<img src>`: o cartão do catálogo (`img.src = item.thumbnail`, que serve também a aba de
// restrição do atlas), o popup do marcador 3D (`img.src = previewThumbnail`) e o popup do marcador
// 360 (`${serviceUrl}${p.previewThumbnail}` montado à mão). O navegador a busca sem cabeçalho; o
// cookie diz quem é o colega, e o colega não tem título nenhum além do empréstimo. 404, o
// `onerror` trocava pelo desenho padrão, e nenhum erro aparecia em lugar nenhum. O dono do modelo
// via a miniatura por papel ou concessão, e é por isso que o defeito só existia do lado de quem
// recebeu.
//
// A ARMADILHA DO CONSERTO, que é o segundo caso: a mesma chave `previewThumbnail` também guarda
// DATA URL (o painel de catálogo embute a miniatura assim), e o desenho padrão é `data:` também.
// `escoparUrlDeAsset` carimbava qualquer endereço sem `//`, então aplicado a um data URL ele
// escrevia `?atlasId=` DENTRO dos bytes, e a imagem deixava de decodificar. Carimbar a miniatura
// sem essa guarda trocaria "a emprestada não aparece" por "a embutida não aparece".
//
// O lado do servidor tem repro próprio, contra a rota real:
// `backend/tests/integration/miniatura-3d-emprestada.repro.test.js`.
//
// CONTROLES NEGATIVOS A EXECUTAR (cada um derruba um caso diferente): `enderecoDaMiniatura`
// devolvendo a URL crua derruba o primeiro; tirar `COM_ESQUEMA_RE` de `escoparUrlDeAsset` derruba
// o segundo; restaurar `img.src = item.thumbnail` no cartão, ou a montagem à mão no popup do 360,
// derruba o de fiação.

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { enderecoDaMiniatura } from '@catalog/endereco-da-miniatura.js';
import { DEFAULT_THUMBNAILS } from '@catalog/catalog.constants.js';
import { escoparUrlDeAsset } from '@store/sync/assets3d-request.js';
import { resourceScopeKey, setResourceScope, resetResourceScope } from '@store/sync/resource-scope.js';
import { buildMarkerFeatures } from '@js/3d_models_viewer_tool/marker-features.js';
import { stampAtlasOnUrl } from '@js/street_view_tool/tile-scope.js';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const lerFonte = (rel) => readFileSync(resolve(RAIZ, rel), 'utf8');

const ATLAS = '11111111-2222-3333-4444-555555555555';

/** A linha de catálogo do acervo adotado, na forma em que o payload aditivo a entrega. */
const MODELO_EMPRESTADO = Object.freeze({
    id: '13bib',
    name: '13º BIB',
    url: '/api/v1/assets3d/m/13bib/tileset.json',
    forma3d: 'tiles3d',
    previewThumbnail: '/api/v1/assets3d/13bib.webp',
    locate: { lon: -51.2, lat: -30.0 }
});

/** A miniatura como o painel de catálogo a embute (a forma curta de um WebP qualquer). */
const MINIATURA_EMBUTIDA = 'data:image/webp;base64,UklGRhYAAABXRUJQVlA4IAoAAAAwAQCdASoBAAEAAQAcJaQAA3AA/v3AgAA=';

describe('a miniatura de um item emprestado carrega o escopo do atlas', () => {
    beforeEach(() => {
        resetResourceScope();
    });

    it('o modelo 3D emprestado: o descritor do pino é CRU, e o endereço que o `<img>` busca é carimbado', () => {
        setResourceScope(resourceScopeKey('colega', ATLAS));

        // PISO — o caminho de dados real do popup, em node: a linha vira pino, e o pino carrega a
        // miniatura como veio da linha. É este valor que ia direto para `img.src`.
        const [pino] = buildMarkerFeatures([MODELO_EMPRESTADO]);
        expect(pino, 'sem pino o caso inteiro mediria nada').toBeTruthy();
        expect(pino.properties.previewThumbnail).toBe('/api/v1/assets3d/13bib.webp');

        // O CONSERTO — o endereço que o navegador busca leva o empréstimo. Sem ele o gate por
        // caminho responde 404 a quem só tem o empréstimo, e o `onerror` esconde o 404.
        expect(enderecoDaMiniatura(pino.properties.previewThumbnail))
            .toBe(`/api/v1/assets3d/13bib.webp?atlasId=${ATLAS}`);

        // DISCRIMINAÇÃO — sem atlas em foco o endereço é o de sempre, caractere por caractere: o
        // modelo público, que é a maioria, não ganha parâmetro nenhum.
        resetResourceScope();
        expect(enderecoDaMiniatura('/api/v1/assets3d/13bib.webp')).toBe('/api/v1/assets3d/13bib.webp');
        setResourceScope(resourceScopeKey('colega', null));
        expect(enderecoDaMiniatura('/api/v1/assets3d/13bib.webp')).toBe('/api/v1/assets3d/13bib.webp');
    });

    it('DATA URL e desenho padrão saem INTACTOS com atlas em foco: a query entraria nos bytes', () => {
        setResourceScope(resourceScopeKey('colega', ATLAS));

        // A miniatura embutida pelo painel.
        expect(enderecoDaMiniatura(MINIATURA_EMBUTIDA)).toBe(MINIATURA_EMBUTIDA);
        // A guarda mora na RECEITA, não na miniatura: toda superfície que passa por
        // `escoparUrlDeAsset` fica protegida, e é isto que o controle negativo derruba.
        expect(escoparUrlDeAsset(MINIATURA_EMBUTIDA)).toBe(MINIATURA_EMBUTIDA);
        expect(escoparUrlDeAsset('blob:http://localhost:3000/5f0c2d1e')).toBe('blob:http://localhost:3000/5f0c2d1e');

        // O desenho padrão de TODO tipo é `data:`, e é ele que o cartão desenha quando o item não
        // tem miniatura. Carimbá-lo quebraria o cartão de todo item sem imagem.
        const padroes = Object.values(DEFAULT_THUMBNAILS);
        expect(padroes.length, 'sem desenho padrão a iteração seria vácua').toBeGreaterThanOrEqual(5);
        for (const padrao of padroes) {
            expect(padrao.startsWith('data:')).toBe(true);
            expect(enderecoDaMiniatura(padrao)).toBe(padrao);
        }

        // CONTROLE DO INSTRUMENTO — no MESMO escopo, um arquivo do servidor É carimbado. Sem esta
        // linha, os "intactos" acima passariam idênticos com a receita desligada.
        expect(enderecoDaMiniatura('/api/v1/assets3d/13bib.webp')).toContain(`atlasId=${ATLAS}`);
    });

    it('outra origem sai intacta, e a miniatura do 360 já carimbada não ganha um segundo parâmetro', () => {
        setResourceScope(resourceScopeKey('colega', ATLAS));

        for (const url of ['https://midia.om.example.mil.br/x.webp', '//midia.om.example.mil.br/x.webp']) {
            expect(enderecoDaMiniatura(url)).toBe(url);
        }

        // O 360 chega ao cartão pronto, por `sv360ReadUrl`, que escreve pela mesma folha
        // (`stampAtlasOnUrl`). Passar pelo cartão não pode duplicar o carimbo.
        const do360 = stampAtlasOnUrl('/api/v1/sv360/thumbnails/praca.webp', ATLAS);
        expect(do360).toBe(`/api/v1/sv360/thumbnails/praca.webp?atlasId=${ATLAS}`);
        expect(enderecoDaMiniatura(do360)).toBe(do360);

        // E a cena indoor, que já sai carimbada de `resolveSceneAssets`: idempotente também.
        const daCena = `/api/v1/assets3d/cenas/museu/preview/thumbnail.jpg?atlasId=${ATLAS}`;
        expect(enderecoDaMiniatura(daCena)).toBe(daCena);
    });

    it('as TRÊS superfícies de miniatura usam a receita, e a forma crua não volta (leitura de fonte)', () => {
        // LEITURA DE FONTE É MAIS FRACA DO QUE PARECE: prova que a decisão está escrita, não que
        // ela roda. O que roda está nos casos acima; este prende que as telas a chamam.
        const cartao = lerFonte('src/js/catalog/components/catalog-card.js');
        expect(cartao).toContain('img.src = enderecoDaMiniatura(item.thumbnail);');
        expect(cartao).not.toMatch(/img\.src\s*=\s*item\.thumbnail\s*;/);
        expect(cartao).toMatch(/import \{ enderecoDaMiniatura \} from '@catalog\/endereco-da-miniatura\.js'/);

        const popup3d = lerFonte('src/js/3d_models_viewer_tool/add_3d_models_viewer_control.js');
        expect(popup3d).toContain('img.src = enderecoDaMiniatura(previewThumbnail);');
        expect(popup3d).not.toMatch(/img\.src\s*=\s*previewThumbnail\s*;/);
        expect(popup3d).toMatch(/import \{ enderecoDaMiniatura \} from '@js\/catalog\/endereco-da-miniatura\.js'/);

        // O popup do 360: a montagem à mão (`serviceUrl` + caminho) era o mesmo elo, para o
        // projeto emprestado. As DUAS construções do descritor passam pela receita do módulo.
        const popup360 = lerFonte('src/js/street_view_tool/streetview_markers.js');
        expect(popup360).not.toMatch(/\$\{serviceUrl\}\$\{[^}]*previewThumbnail\}/);
        expect([...popup360.matchAll(/sv360ReadUrl\((?:p|project)\.previewThumbnail\)/g)]).toHaveLength(2);
    });
});
