-- 019_images_mime_allowlist
-- Align the images.mime_type CHECK with the application allowlist.
-- The app layer (multer fileFilter + service ALLOWED_MIME_TYPES + magic-byte
-- validation) rejects SVG to avoid stored-XSS, but the original 002 CHECK still
-- accepted 'image/svg+xml'. No row can carry SVG (the app blocked it before any
-- INSERT), so tightening the constraint is safe and forward-only.

ALTER TABLE images DROP CONSTRAINT IF EXISTS images_mime_type_check;

ALTER TABLE images ADD CONSTRAINT images_mime_type_check
  CHECK (mime_type IN ('image/png', 'image/jpeg', 'image/webp'));
