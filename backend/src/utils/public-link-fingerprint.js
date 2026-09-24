// Path: src/utils/public-link-fingerprint.js
//
// THE PUBLIC-LINK VISITOR TOKEN NAMES THE LINK IT CAME FROM, by fingerprint.
//
// The visitor token (`getAtlasByPublicLink`, one hour) used to carry only the atlas, and every door
// that honours it asked only whether the atlas was PUBLIC. Unpublishing killed it, since the atlas
// stopped being public; but republishing mints a NEW link, and the owner who unpublishes because
// the link leaked and then republishes for the right people handed read access back to every token
// issued by the leaked link in the last hour. The token now carries this fingerprint (`pl`) and the
// doors compare it with the atlas's CURRENT link: `requireAtlasPermission` (every HTTP door, the
// 360 and 3D asset reads included) and the collaboration gateway (handshake and reconciliation).
//
// A fingerprint and not the link itself: the token is a bearer credential the visitor holds, and
// the link is the secret that mints new ones. Sixteen hex chars of SHA-256 identify a link among
// the few an atlas ever has without putting the secret in a JWT anyone can decode.
import { createHash } from 'node:crypto';

/**
 * @param {string|null|undefined} link - The atlas's public link.
 * @returns {string|null} The fingerprint, or null when there is no link.
 */
export function publicLinkFingerprint(link) {
  if (typeof link !== 'string' || link.length === 0) return null;
  return createHash('sha256').update(link).digest('hex').slice(0, 16);
}
