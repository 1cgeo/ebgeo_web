-- 008_sessions_valid_from.sql
--
-- Gives mass revocation an effect the LIVE auth path can see (bugs-backend #35).
--
-- THE PROBLEM. `REVOKE_ALL_USER_TOKENS` stamps `refresh_tokens.revoked_at`, and
-- nothing on the request path ever reads that table: the strict `auth` middleware and
-- the sliding renewal in `flexible-auth.js` both reconcile through `getLiveAuthState`,
-- which looks only at `users.is_active` / `role` / `organization`. So revoking the
-- family ends the ability to ROTATE and nothing else. Worse, the sliding renewal
-- re-issues the access token whenever it is <5 min from expiring, so a holder who
-- makes one request every <15 min renews FOREVER without ever calling /auth/refresh.
-- The event the system classifies as session theft did not end the stolen session.
--
-- THE MARKER. `sessions_valid_from` is a per-user cut-off: every access token issued
-- before it is refused. It is written by the same statement that revokes the refresh
-- family, so the two can never drift apart (see REVOKE_ALL_USER_TOKENS in both
-- auth.queries.js and users.queries.js), and it is read by `getLiveAuthState`, which
-- is already on every strict request, every sliding renewal and every WS handshake —
-- no extra query.
--
-- NULLABLE, NO DEFAULT, ON PURPOSE. NULL means "nothing was ever cut", and that is
-- what every existing row gets. A DEFAULT NOW() would backdate a cut-off onto every
-- account in the database at migration time and invalidate every live session at
-- once; a NOT NULL would force one. The read side treats NULL as "no marker, token
-- passes" (utils/org-status.js `tokenPredatesSessionCut`) — NULL must never mean
-- "everything is invalid". Additive column, forward-only, no backfill.
--
-- RESOLUTION. A JWT `iat` has SECOND resolution; this column has microsecond. The
-- reader truncates the marker to whole seconds before comparing (same units), and the
-- second they share is ambiguous — `iat` cannot say whether the token came before or
-- after the cut inside it. That second is REFUSED (`iat <= floor(cut)`): fail closed,
-- because the over-rejection is a 401 the client already recovers from and the
-- under-rejection is a silent hole. Full justification in utils/org-status.js
-- (`tokenPredatesSessionCut`).

ALTER TABLE users ADD COLUMN IF NOT EXISTS sessions_valid_from TIMESTAMPTZ;

COMMENT ON COLUMN users.sessions_valid_from IS
  'Session cut-off: an access token whose JWT iat predates this instant is refused. '
  'NULL = never cut. Written together with the refresh-family revocation.';
