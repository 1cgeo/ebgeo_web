// Path: js/catalog/components/catalog-card.js

/**
 * @fileoverview Individual catalog card component.
 *
 * O EIXO PRIVADO NÃO VEM DO ITEM, e é o que surpreende quem lê este arquivo: um
 * item de `config` não carrega `access_level`, porque `/api/config` é o documento
 * PÚBLICO e igual para todo chamador. O que o cartão sabe é que aquele id chegou
 * pelo payload aditivo (`GET /resource-access/visible`), que devolve só o privado
 * visível — daí `isPrivateResource`, que é uma consulta ao que o servidor entregou,
 * nunca uma leitura de propriedade.
 *
 * O SELO COBRE TRÊS ORIGENS DE ACESSO, e desde 2026-08-24 ele as distingue: papel global,
 * concessão pessoal e empréstimo do atlas em foco. A frase única de antes ("só quem recebeu
 * acesso enxerga este item") era falsa justamente para o CREDENCIADO, que enxerga o acervo
 * privado inteiro por PAPEL, sem ter recebido nada. Quem dá o texto é
 * `js/catalog/access-origin-phrases.js`; quem dá o dado é `resourceAccessOrigin`, e `null`
 * (servidor antigo, soma que falhou) degrada para o selo genérico e verdadeiro.
 */

import { escapeHtml } from '@utils/html-escape.js';
import {
    CATALOG_ITEM_TYPES,
    CATALOG_TYPE_CONFIG,
    DEFAULT_THUMBNAILS,
    CATALOG_UI_ICONS,
    FORMA_3D_ICONS,
    FORMA_3D_LABELS,
    RESOURCE_ACCESS_BY_CATALOG_TYPE
} from '../catalog.constants.js';
import { formatCatalogDate } from '../catalog.service.js';
import {
    canShareResource,
    isPrivateResource,
    resourceAccessOrigin
} from '@store/sync/resource-access.service.js';
import { accessExpiryPhrase, classifyAccess, privateBadgePhrase } from '../access-origin-phrases.js';
// Import ESTÁTICO, e a escolha é medida e não preguiça: `vite.config.js` manda TODO
// `src/js/catalog/` para o grupo `core`, então um `import()` daqui não adiaria carga
// nenhuma — ele só acrescentaria uma promessa entre o clique e a janela abrir, e um
// comentário afirmando um ganho que não existe. O modal é DOM puro, sem dependência
// pesada; o vídeo em si é que é lazy, pelo `preload="none"` do elemento.
import { abrirPreviaDeVideo } from './preview-video.modal.js';

/** Icons used in catalog card */
const { CALENDAR, MAP_PIN, CHEVRON_RIGHT, LOCK, SHARE, PLAY } = CATALOG_UI_ICONS;

/**
 * O par (grupo, tipo) do eixo de acesso e o id CRU deste item, ou null quando o
 * item não é uma linha de catálogo (sombreamento).
 * @param {CatalogItem} item
 * @returns {{grupo: string, tipo: string, id: string}|null}
 */
export function resourceAccessRefOf(item) {
    const mapa = RESOURCE_ACCESS_BY_CATALOG_TYPE[item?.type];
    const id = item?.originalData?.id;
    if (!mapa || id == null) return null;
    return { ...mapa, id: String(id) };
}

/**
 * A procedência do acesso a este item, canonizada, ou `null`.
 *
 * TRÊS RAZÕES DIFERENTES CAEM NO MESMO `null`, e o cartão trata as três igual de propósito:
 * o item não é privado, o servidor não manda procedência (build mais velho que este cliente),
 * ou a soma de recursos falhou. Nenhuma delas autoriza afirmar uma origem.
 * @param {{grupo: string, id: string}|null} acesso
 * @returns {'papel'|'concessao'|'emprestimo'|null}
 */
function origemDoAcesso(acesso) {
    if (!acesso) return null;
    return resourceAccessOrigin(acesso.grupo, acesso.id) ?? null;
}

/**
 * A classe de acesso de um item do catálogo, para o filtro e para o contador da grade.
 *
 * MORA AQUI, e não no modal, porque é aqui que vive a tradução (item do catálogo) → (grupo, id)
 * do eixo de acesso. Duas traduções da mesma coisa divergem, e divergir entre o que a lista
 * mostra e o que o contador conta é o defeito específico que o contador deveria evitar.
 * @param {CatalogItem} item
 * @returns {'publico'|'papel'|'concessao'|'emprestimo'|'privado'}
 */
export function accessClassOfItem(item) {
    const acesso = resourceAccessRefOf(item);
    const privado = !!acesso && isPrivateResource(acesso.grupo, acesso.id);
    return classifyAccess({ privado, origem: privado ? origemDoAcesso(acesso) : null });
}

/**
 * O prazo do acesso a este item, quando o payload o carrega.
 *
 * LÊ O QUE JÁ CHEGOU, e nunca pergunta ao servidor: o cartão é desenhado em lote (dezenas por
 * abertura da grade), e uma chamada por cartão seria uma tempestade de pedidos para enfeitar
 * uma etiqueta. Enquanto o dado não chegar, isto é `null` em todo item e o chip simplesmente
 * não existe, que é o estado de hoje.
 *
 * O DADO AINDA NÃO EXISTE NO PAYLOAD, e a leitura abaixo é o ponto de pouso, não uma promessa
 * de que ele já pousou. Medido em 2026-08-24 contra o servidor deste repositório: o payload
 * aditivo mantém as colunas de procedência FORA do item, num mapa irmão (`origins`), e a
 * projeção do 360 virou lista explícita de campos — ou seja, uma coluna nova NÃO atravessa
 * sozinha até `originalData` em nenhum dos cinco grupos. O prazo tem de viajar como `origins`
 * viaja (um mapa `{grupo: {id: ISO}}`), com um leitor irmão de `resourceAccessOrigin` no
 * serviço de acesso; quando ele existir, esta função é a ÚNICA linha a trocar, e o resto do
 * caminho (frase, chip, estilo, teste) já está de pé.
 * @param {CatalogItem} item
 * @returns {*}
 */
function prazoDoAcesso(item) {
    return item?.originalData?.access_expires_at ?? item?.originalData?.accessExpiresAt ?? null;
}

/**
 * Creates an individual catalog card.
 * @param {Object} options
 * @param {CatalogItem} options.item - Catalog item
 * @param {Function} options.onClick - Click callback
 * @param {Function} [options.onShare] - Abre o modal de compartilhar deste recurso.
 * @returns {HTMLElement}
 */
export function createCatalogCard({ item, onClick, mapLocked = false, selectable = false, selected = false, onToggle, onShare }) {
    const typeConfig = CATALOG_TYPE_CONFIG[item.type];
    const acesso = resourceAccessRefOf(item);
    const privado = !!acesso && isPrivateResource(acesso.grupo, acesso.id);
    const selagem = privado ? privateBadgePhrase(origemDoAcesso(acesso)) : null;

    const card = document.createElement('article');
    card.className = 'catalog-card';
    card.dataset.type = item.type;
    card.style.setProperty('--card-accent', typeConfig.color);

    // Thumbnail
    const thumbnailWrapper = document.createElement('div');
    thumbnailWrapper.className = 'catalog-card-thumbnail';

    const img = document.createElement('img');
    img.src = item.thumbnail;
    img.alt = item.name;
    img.loading = 'lazy';
    img.onerror = () => {
        img.src = DEFAULT_THUMBNAILS[item.type];
    };
    thumbnailWrapper.appendChild(img);

    // Type badge. On a 3D item it carries the SHAPE (Tiles 3D / Modelo isolado / Nuvem de
    // pontos / Cena indoor) instead of the coarse section name: three shapes share the type
    // `MODEL_3D`, and until the axis was declared a point cloud was indistinguishable on screen
    // from an ordinary model. `item.forma` is absent on everything that is not 3D, and the
    // section label answers for those.
    const badge = document.createElement('span');
    badge.className = 'catalog-card-badge';
    const badgeIcon = FORMA_3D_ICONS[item.forma] ?? typeConfig.icon;
    const badgeLabel = FORMA_3D_LABELS[item.forma] ?? typeConfig.label;
    badge.innerHTML = `${badgeIcon}<span>${badgeLabel}</span>`;
    thumbnailWrapper.appendChild(badge);

    // Selo de recurso PRIVADO. Ele aparece também na aba "Catálogo" da configuração
    // do atlas (modo `selectable`), de propósito: é lá que o Gestor decide o que
    // restringir, e é lá que ele mais precisa saber que um item não é público.
    //
    // O RÓTULO SÓ MUDA NO CASO VOLÁTIL (empréstimo do atlas), porque só ele deixa de valer
    // quando a pessoa sai daqui; a diferença entre papel e concessão vale a linha do `title`,
    // não a do selo. `data-origem` fica na árvore para o e2e poder afirmar QUAL selo é qual
    // sem depender da redação.
    if (selagem) {
        const selo = document.createElement('span');
        selo.className = 'catalog-card-badge catalog-card-badge--private';
        if (selagem.volatil) selo.classList.add('catalog-card-badge--lent');
        selo.dataset.testid = 'catalog-card-private';
        selo.dataset.origem = selagem.origem ?? 'desconhecida';
        selo.title = selagem.title;
        // `textContent` no rótulo: ele vem do módulo de frases, mas o ícone é SVG estático e
        // a concatenação com `innerHTML` misturaria as duas naturezas num ponto só.
        selo.innerHTML = LOCK;
        const texto = document.createElement('span');
        texto.textContent = selagem.rotulo;
        selo.appendChild(texto);
        thumbnailWrapper.appendChild(selo);
    }

    card.appendChild(thumbnailWrapper);

    // Content
    const content = document.createElement('div');
    content.className = 'catalog-card-content';

    const name = document.createElement('h4');
    name.className = 'catalog-card-name';
    name.textContent = item.name;
    name.title = item.name;
    content.appendChild(name);

    if (item.description) {
        const desc = document.createElement('p');
        desc.className = 'catalog-card-description';
        desc.textContent = item.description;
        desc.title = item.description;
        content.appendChild(desc);
    }

    // Metadata (date and/or local)
    if (item.date || item.local) {
        const meta = document.createElement('div');
        meta.className = 'catalog-card-meta';

        if (item.local) {
            const localSpan = document.createElement('span');
            localSpan.className = 'catalog-card-meta-item';
            localSpan.innerHTML = `${MAP_PIN}<span>${escapeHtml(item.local)}</span>`;
            meta.appendChild(localSpan);
        }

        if (item.date) {
            const dateSpan = document.createElement('span');
            dateSpan.className = 'catalog-card-meta-item';
            dateSpan.innerHTML = `${CALENDAR}<span>${escapeHtml(formatCatalogDate(item.date))}</span>`;
            meta.appendChild(dateSpan);
        }

        content.appendChild(meta);
    }

    // O PRAZO DO ACESSO, quando o servidor o manda.
    //
    // ELE É A METADE QUE FALTAVA DE UM AVISO QUE JÁ EXISTIA. O modal de compartilhar já
    // desenha "expira em <data>", mas ele só abre por um botão gateado por `canShareResource`:
    // quem recebeu com nível `view` (a maioria de quem tem prazo) nunca vê aquele chip. Para
    // essa pessoa o recurso aparecia um dia e sumia noutro, sem evento e sem aviso, porque a
    // morte da concessão mora no predicado do servidor. Aqui o aviso alcança quem RECEBEU.
    const prazo = privado ? accessExpiryPhrase(prazoDoAcesso(item)) : null;
    if (prazo) {
        const chip = document.createElement('p');
        chip.className = `catalog-card-expiry catalog-card-expiry--${prazo.estado}`;
        chip.dataset.testid = 'catalog-card-expiry';
        chip.dataset.estado = prazo.estado;
        chip.title = prazo.title;
        chip.textContent = prazo.rotulo;
        content.appendChild(chip);
    }

    card.appendChild(content);

    // Footer
    const footer = document.createElement('div');
    footer.className = 'catalog-card-footer';

    if (selectable) {
        // Allow/restrict toggle for the atlas-config "Catálogo" tab — no open action, no map-lock.
        card.dataset.catalogId = item.originalData?.id ?? item.id;
        const label = document.createElement('label');
        label.className = 'atlas-config__switch';
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = !!selected;
        const track = document.createElement('span');
        track.className = 'atlas-config__switch-track';
        label.append(input, track);
        input.addEventListener('change', () => onToggle?.(item, input.checked));
        footer.appendChild(label);
        card.appendChild(footer);
        return card;
    }

    const openBtn = document.createElement('button');
    openBtn.className = 'catalog-card-btn';

    // Only block data/analysis/hillshade types when locked; 3D and 360 remain accessible
    const isBlockedByLock = mapLocked &&
        item.type !== CATALOG_ITEM_TYPES.MODEL_3D &&
        item.type !== CATALOG_ITEM_TYPES.PANORAMIC_360;

    if (isBlockedByLock) {
        openBtn.innerHTML = `<span>Mapa Bloqueado</span>`;
        openBtn.disabled = true;
        card.classList.add('catalog-card--locked');
    } else {
        openBtn.innerHTML = `
            <span>Abrir</span>
            ${CHEVRON_RIGHT}
        `;
        openBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            onClick();
        });
    }

    footer.appendChild(openBtn);

    // "PRÉVIA": só quando o item TEM vídeo, e o mapa bloqueado não a esconde (assistir a
    // uma prévia não mexe no mapa, exatamente como compartilhar não mexe).
    //
    // O botão nasce do dado e não do tipo: quem decide é `item.previewVideo`, então os
    // quatro tipos que carregam o campo (3D, camada de dados, camada de análise e 360) o
    // ganham pela mesma linha, e o basemap — que não tem cartão — nunca chega aqui.
    if (item.previewVideo) {
        footer.classList.add('catalog-card-footer--split');
        const previaBtn = document.createElement('button');
        previaBtn.className = 'catalog-card-btn catalog-card-btn--preview';
        previaBtn.dataset.testid = 'catalog-card-preview';
        previaBtn.title = `Ver a prévia de ${item.name}`;
        previaBtn.setAttribute('aria-label', `Ver a prévia de ${item.name}`);
        previaBtn.innerHTML = `${PLAY}<span>Prévia</span>`;
        previaBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            abrirPreviaDeVideo({ url: item.previewVideo, titulo: item.name });
        });
        footer.appendChild(previaBtn);
    }

    // "Compartilhar": só em recurso PRIVADO e só para quem pode repassar
    // (papel global, ou concessão de nível `view_share`). Quem só recebeu `view`
    // não vê o botão — oferecê-lo seria oferecer um formulário que o servidor
    // recusa. O mapa bloqueado NÃO o esconde: compartilhar não mexe no mapa.
    if (privado && acesso && onShare && canShareResource(acesso.grupo, acesso.id)) {
        footer.classList.add('catalog-card-footer--split');
        const shareBtn = document.createElement('button');
        shareBtn.className = 'catalog-card-btn catalog-card-btn--share';
        shareBtn.dataset.testid = 'catalog-card-share';
        shareBtn.title = `Compartilhar ${item.name}`;
        shareBtn.setAttribute('aria-label', `Compartilhar ${item.name}`);
        shareBtn.innerHTML = `${SHARE}<span>Compartilhar</span>`;
        shareBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            onShare(item);
        });
        footer.appendChild(shareBtn);
    }

    card.appendChild(footer);

    // Click on card also opens (only when not blocked by lock)
    if (!isBlockedByLock) {
        card.addEventListener('click', onClick);
    }

    return card;
}
