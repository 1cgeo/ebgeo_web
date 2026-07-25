// Path: src/modules/images/images.controller.js
import { asyncHandler } from '../../utils/async-handler.js';
import * as imagesService from './images.service.js';

export const uploadImage = asyncHandler(async (req, res) => {
  const image = await imagesService.uploadImage(req.atlasId, req.file, req.user.id);
  res.status(201).json({ data: image });
});

export const getImage = asyncHandler(async (req, res, next) => {
  const { path, mimeType, filename } = await imagesService.getImageFile(
    req.atlasId,
    req.params.imageId
  );

  // Serve as an attachment (never inline — avoids any rendered-content XSS).
  //
  // `res.attachment` builds the header through the `content-disposition` module
  // (RFC 6266/5987) instead of interpolating the stored name into the value.
  // Two failure modes that raw concatenation had:
  //   - a codepoint above U+00FF (e.g. '地図.png', which POST /images/bulk accepts
  //     verbatim) made Node reject the header value with ERR_INVALID_CHAR, and the
  //     throw inside the async handler turned every download of that image into a
  //     500 for every user with read;
  //   - a quote was not escaped, so `a"; filename="evil.exe` split into TWO
  //     filename parameters and the served name became evil.exe.
  // The encoder emits an ASCII/latin1 fallback plus `filename*=UTF-8''…` and
  // escapes quotes/backslashes. The disposition type stays `attachment`.
  //
  // `filename` is a NOT NULL column, but the encoder throws on a non-string or an
  // empty value, so fall back rather than trade a 500 for a 500.
  res.attachment(typeof filename === 'string' && filename.length > 0 ? filename : 'image');
  // res.attachment also guesses Content-Type from the extension; the stored mime
  // (a CHECK-constrained column) is authoritative, so it is set afterwards.
  res.setHeader('Content-Type', mimeType);
  // Images are immutable once uploaded; cache privately (access-controlled).
  res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');

  // res.sendFile handles ETag, conditional 304, Range/206 and Last-Modified.
  res.sendFile(path, {
    acceptRanges: true,
    lastModified: true,
    etag: true,
    cacheControl: false, // we set Cache-Control above (private)
  }, (err) => {
    if (err) next(err);
  });
});

export const deleteImage = asyncHandler(async (req, res) => {
  await imagesService.deleteImage(req.atlasId, req.params.imageId);
  res.status(204).send();
});

export const listImages = asyncHandler(async (req, res) => {
  const images = await imagesService.listImages(req.atlasId);
  res.json({ data: images });
});

/**
 * Bulk upload images from base64 data.
 * Used for importing images from offline/IndexedDB storage.
 * Returns mapping of localId -> serverId for updating feature references.
 */
export const bulkUploadImages = asyncHandler(async (req, res) => {
  const result = await imagesService.bulkUploadImages(
    req.atlasId,
    req.body.images,
    req.user.id
  );
  res.status(201).json({ data: result });
});
