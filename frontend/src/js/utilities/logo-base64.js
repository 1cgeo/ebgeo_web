// Path: js/utilities/logo-base64.js
/**
 * EBGeo logo reference.
 *
 * This module used to inline the logo as a `data:image/webp;base64,...` string. That put
 * 31,7 kB (24,3 kB gzip) inside the EAGER `core` chunk of every page that reaches it —
 * 10,2% of the chunk — for exactly the same 24.244 bytes that `index.html` ALREADY fetches
 * via `<link rel="preload" href="/images/logo_ebgeo.webp" as="image">`. The pixels traveled
 * twice on every boot.
 *
 * The original rationale for inlining was "avoid mixed-content / insecure-connection errors
 * in HTTP environments". That rationale does not apply to a ROOT-RELATIVE url: it inherits
 * the page's own scheme and host, so it can never be mixed content, and it is same-origin,
 * so it does not taint a canvas (the PDF/briefing exporters draw this image into one).
 */

/**
 * Root-relative URL of the EBGeo logo (WebP, 24.244 bytes), served from `public/images/`.
 *
 * @deprecated The NAME is kept only for call-site stability — the value is no longer Base64.
 *   Renaming it to `EBGEO_LOGO_URL` requires touching `briefing/components/presentation-text-panel.js`,
 *   which is outside this change. Do the rename in a follow-up commit.
 * @type {string}
 */
export const EBGEO_LOGO_BASE64 = '/images/logo_ebgeo.webp';

/** @type {HTMLImageElement|null} */
let _cachedLogoImage = null;

/**
 * Returns the EBGeo logo as an HTMLImageElement.
 * The image is cached after the first load, so the fetch/decode happens only once; the
 * asset is normally already in the HTTP cache because index.html preloads it.
 * @returns {Promise<HTMLImageElement>}
 */
export function loadLogoImage() {
    if (_cachedLogoImage) return Promise.resolve(_cachedLogoImage);

    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => { _cachedLogoImage = img; resolve(img); };
        img.onerror = reject;
        img.src = EBGEO_LOGO_BASE64;
    });
}
