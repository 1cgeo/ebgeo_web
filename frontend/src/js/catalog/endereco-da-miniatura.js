// Path: js/catalog/endereco-da-miniatura.js

/**
 * @fileoverview THE ADDRESS THE BROWSER FETCHES for the miniature of a catalog item, with the
 * scope stamp of the atlas in focus. Sibling of `enderecoDaPrevia`
 * (`catalog/components/preview-video.modal.js`), for the same reason.
 *
 * THE DEFECT IT CLOSES (owner's report, 2026-09-22): a PRIVATE 3D model lent by the atlas showed
 * up and opened for the colleague, and its miniature did not load. The model opens because the
 * viewer builds the `tileset.json` request through `descritorDeAsset`, which carries the atlas
 * in `queryParameters`. The miniature is an `<img src>`: the BROWSER fetches it on its own, with
 * no header at all, and the session cookie that travels with it only says WHO is asking. The
 * colleague holds no role and no grant over the model, only the loan, and the loan reaches the
 * server only if `?atlasId=` is in the URL. Without it the per-path gate of `/api/v1/assets3d`
 * (the miniature is a FILE field of the regime index, `backend/src/modules/nomes/assets3d-regime.js`)
 * answered 404, the card's `onerror` swapped in the default drawing, and nobody saw an error.
 * Whoever owns the model saw the miniature through role or grant, which is why the defect only
 * showed on the receiving side.
 *
 * THREE SHAPES OF MINIATURE ARRIVE HERE, and only one gets the stamp:
 *
 *   - a file on THIS server (`/api/v1/assets3d/<id>.webp`, which is what the adopted 3D acquis
 *     writes, or the `preview/thumbnail.jpg` of an indoor scene): gets `?atlasId=`;
 *   - a data URL embedded by the admin panel (`data:image/webp;base64,...`) and the default
 *     drawing (`DEFAULT_THUMBNAILS`, also `data:`): untouched, because a query written onto a
 *     data URL lands INSIDE the bytes and the image stops decoding;
 *   - an address on another origin: untouched, because the loan is a claim about THIS server.
 *
 * `escoparUrlDeAsset` decides all three, not a second recipe written here: a second hand-made
 * `?atlasId=` is the shape this defect takes to come back. The 360 miniature, which arrives
 * already stamped by `sv360ReadUrl`, passes through without gaining a second parameter, because
 * the recipe is idempotent.
 *
 * THE SCOPE IS READ ON EVERY CALL, at the moment the `<img>` is built, and never frozen in the
 * item: the card and the 3D marker popup are drawn long after the catalog was read.
 *
 * A leaf with ONE import, which is what keeps it verifiable in node (the frontend test
 * environment has no DOM, and the card and the popup are pure DOM).
 */

import { escoparUrlDeAsset } from '@store/sync/assets3d-request.js';

/**
 * The miniature of a catalog item, ready for `img.src`.
 *
 * @param {string} url - The item's miniature (a file, a data URL or the default drawing).
 * @returns {string} The same URL, stamped when it is a file on this server and an atlas is in focus.
 */
export function enderecoDaMiniatura(url) {
    return escoparUrlDeAsset(url);
}
