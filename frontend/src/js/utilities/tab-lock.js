// Path: js/utilities/tab-lock.js

/**
 * @fileoverview Multi-tab arbitration: WHICH TAB MAY HOLD WHICH ATLAS.
 *
 * The previous version of this module was a WhatsApp-style "one tab, period" lock, and it
 * never defended what its name promised: the overlay was a div that swallowed clicks while,
 * behind it, the WebSocket stayed connected, `sync-flush` kept draining every 1.5 s, presence
 * kept the tab in the roster and the api-client kept rotating tokens. It also blocked the
 * second tab regardless of atlas, and only `index.js` ever called it, so Map plus
 * Administracao was already two tabs sharing one session by accident of wiring.
 *
 * ===========================================================================
 * OWNER'S RULE (the decision this protocol exists to enforce)
 * ===========================================================================
 * TWO TABS COLLIDE WHEN, AND ONLY WHEN, THEY HOLD THE SAME ATLAS. Local or remote makes no
 * difference to the rule: two tabs in one atlas fight, two tabs in two atlases do not.
 *
 * The reason is storage, not session, and the rule is uniform because the storage now is.
 * Every atlas, LOCAL or REMOTE, owns its own namespaced set of IndexedDB databases
 * (`store/atlas-namespace.js` Decision 1, `remoteScope` = `ebgeo_maps__remote-<atlasId>`).
 * Two tabs in the same atlas are two writers of one set of databases; two tabs in different
 * atlases share nothing but the outbound queue, which is append-only and per operation.
 *
 * THIS BLOCK USED TO SAY "ONE REMOTE ATLAS AT A TIME", and the reason it gave was true at
 * the time: every server atlas shared ONE scratch namespace, so any two remote tabs were
 * the same ten databases and had to be arbitrated even when they named different atlases.
 * That scratch is gone, and with it the reason. What survived the change is the invariant
 * it protected, "remote data does not survive logout", now carried by a registry and a
 * derived wipe (`store/remote-atlas.api.js`) instead of by a single nameable target.
 *
 * ===========================================================================
 * 1. THE KEY
 * ===========================================================================
 * A tab announces a KEY, which is what it holds, never where it came from:
 *
 *   { kind: 'none'   , atlasId: null }   page holds no atlas
 *   { kind: 'local'  , atlasId: <local slot id>, adoptedFrom: <atlas UUID>|null }
 *   { kind: 'remote' , atlasId: <atlas UUID> }
 *
 * THE KEY IS THE ATLAS ID, NEVER THE URL, and under the uniform rule the id is decisive on
 * BOTH sides: `remoteAtlasKey` therefore demands a real id and throws without one, exactly
 * like `localAtlasKey`. A key that names no atlas can only be `none`.
 *
 * The consequence lands on `?atlasPublico=`, where the parameter is a link TOKEN and the
 * UUID exists only after the server answers. Two ways out were available, and the one NOT
 * taken is worth naming: claiming early under a provisional id would be wrong twice over,
 * because two tabs opening two different public links would collide on the placeholder
 * (a false collision) while two tabs opening the same atlas by different routes would not
 * (a missed one), and the later re-stamp would push the tab to the BACK of the total order,
 * handing away a claim it already held. So the claim is DEFERRED instead: resolving the
 * token is a read (`getPublicAtlas`), it destroys nothing, and the claim is taken with the
 * real UUID before the first destructive step. See `index.js openPublicAtlasFromUrl`.
 *
 * The pages without a map (`projetos.html`, `admin.html`, `calibracao.html`) hold no atlas.
 * They join the channel with `kind: 'none'`, are visible to everyone, and NEVER collide.
 * Blocking Map plus Administracao would break a deliberate flow: people open the admin panel
 * in a second tab on purpose.
 *
 * ===========================================================================
 * 2. THE COLLISION PREDICATE (`keysCollide`)
 * ===========================================================================
 * WHAT IS ARBITRATED IS AN ADDRESS: the set of databases a tab writes to. So the predicate
 * computes one (`claimAddress`) and compares it, instead of comparing the pair (kind, id):
 *
 *   none, or a key with no id : NO address, therefore collides with nobody
 *   remote X                  : `remote:X`
 *   local  L                  : `local:L`  — unless it was ADOPTED, see below
 *   any other kind            : `<kind>:<id>`
 *
 *   none    x anything : never collides
 *   local   x local    : collides only when the atlas ids are equal
 *   remote  x remote   : collides only when the atlas ids are equal
 *   remote  x local    : never collides (different namespaces, no shared database)
 *
 * It FAILS CLOSED on a kind it does not know, which a per-kind switch could not do: a peer
 * whose `kind` is corrupted or comes from a future deploy still collides with an identical
 * claim, because two claims naming the same address collide whatever they call themselves.
 *
 * THE ADOPTED SLOT IS THE ONE PLACE WHERE KIND AND ADDRESS DISAGREE, and it is why the local
 * key carries `adoptedFrom`. `adoptRemoteAtlasAsLocal` (`store/local-atlas.api.js`) rescues
 * unsynced work at logout by moving the CLAIM from the remote registry to the local one and
 * ZERO bytes between databases: the rescued slot KEEPS the `remote-<atlasId>` suffix. So a
 * local slot and a server atlas can be literally the same ten databases, and a predicate on
 * (kind, id) answers "no collision" for the one pair that shares a disk — the rescue tab would
 * sit there while another tab opened that server atlas and wiped, on its way in, the work the
 * rescue existed to save. `currentAtlasLockKey` (`account/open-atlas.service.js`) therefore
 * fills `adoptedFrom` from the active scope's suffix (`remoteAtlasIdFromDbSuffix`), and such a
 * slot claims the address `remote:<atlasId>` while keeping `kind: 'local'`, which is what the
 * overlay wording and the user both need it to be.
 *
 * THE REMOTE x REMOTE HOLD IS GONE (it made every pair of server atlases collide). It was not
 * the owner's rule, it was the safe reading of a period in which `openRemoteAtlas` did not
 * activate any namespace, so two server atlases were one set of databases and letting the
 * second tab in meant letting it wipe the first tab's live map. The wiring landed first
 * (`activateRemoteAtlas` in `openRemoteAtlas` and in the public-link path, the rescue in
 * `AccountControl._handleLogout`, `activateBootAtlasScope` at boot) and the hold came out
 * afterwards, as its own change: `tests/integration/namespace-remoto-fiacao.test.js` is what
 * says two server atlases really are two blocks of databases.
 *
 * ===========================================================================
 * 3. MESSAGES
 * ===========================================================================
 * Every message carries the sender's identity and its full claim, because a receiver must be
 * able to decide the whole question from any single message. The old channel posted `{type}`
 * with no sender and no atlas, which is why it could only answer "is anyone there".
 *
 *   { v, type, tabId, key: {kind, atlasId}, claimedAt, target? }
 *
 *   HELLO     a tab joins or changes its key, and asks everyone to state theirs.
 *   STATE     a statement of the sender's current claim. Sent as a reply to HELLO, on every
 *             key change, and as the heartbeat. It is the only message a peer needs.
 *   RELEASE   the sender is leaving (pagehide) or has dropped its key. Peers forget it.
 *   TAKEOVER  the sender asks every holder of a colliding key to yield ("Usar aqui").
 *   YIELD     `target`ed ack: "I have already stopped, the claim is yours".
 *   TEARDOWN  the sender is about to DESTROY a set of database addresses. It carries
 *             `addresses` (a list of `dbSuffix`), never a key. See section 8.
 *   TEARDOWN_ACK  `target`ed ack: "I read it, and here is whether I stopped" (`frozen`).
 *
 * `v` (protocol version) makes tabs from two different deploys mutually INVISIBLE rather than
 * mutually confused: an old tab speaking the old `{type:'PING'}` dialect is ignored here, and
 * ignores this. That is the honest failure mode for a hot deploy, and it is bounded, because
 * a reload of either tab ends it.
 *
 * TEARDOWN DID BUMP IT (2 -> 3), and the reason is that invisibility is here the SAFE reading,
 * which is the opposite of the adoption case below. An old tab cannot understand the notice, so
 * it never freezes and never releases its mount lock; the destroyer then finds the namespace
 * mounted and SPARES it, which is exactly the behaviour of the deploy that tab came from. Keeping
 * the old version would buy nothing (it would still not freeze) and would cost the destroyer a
 * full ack timeout waiting for a tab that cannot answer.
 *
 * WHICH IS EXACTLY WHY `adoptedFrom` DID NOT BUMP IT. Invisibility is the honest answer only
 * when the two dialects cannot be read at all; here the field is ADDITIVE, and an old tab's
 * key parses as a local key with no adoption. Bumping would make every claim of an old tab
 * unreadable, so two tabs in the SAME atlas would both proceed — trading a corner case for
 * the collision this module exists to catch. What the old tab does instead is over-block (it
 * still collides remote x remote) and miss the adopted-slot pair, both bounded by a reload.
 *
 * ===========================================================================
 * 4. THE WINDOW HOLE, AND WHY THERE IS NO WINDOW ANY MORE
 * ===========================================================================
 * The old lock had a deterministic hole of its own: during its 1.5 s probe a tab did not
 * answer PING (`isActive` was still false and the permanent handler was only installed when
 * the timeout fired), so two tabs whose probes overlapped both ended up active. And since
 * `initTabLock` ran after `await createControls`, the offset needed to hit it was the offset
 * of BOOT, not 1.5 s of wall clock. A longer window cannot fix that, because the thing that
 * varies is boot time.
 *
 * So the resolution does not use a window at all. It is a TOTAL ORDER over claims, computed
 * identically by every tab from data every tab broadcasts:
 *
 *     compareClaims(a, b)  =  by claimedAt, then by tabId
 *     shouldBlock(self, peers) = some live peer collides with me AND precedes me
 *
 * Two consequences that make the hole impossible by construction:
 *
 *   a) THE HANDLER IS INSTALLED BEFORE THE FIRST MESSAGE IS POSTED, and a tab answers HELLO
 *      unconditionally, including while it is still settling. There is no state in which a
 *      tab is silent.
 *   b) BOTH TABS COMPUTE THE SAME ANSWER FROM THE SAME DATA, so it does not matter who
 *      replies first, or whether the replies cross. Exactly one of the two sides satisfies
 *      "precedes", so exactly one blocks. Delivery order is irrelevant; this is what the
 *      deterministic test pins down, with two announcements buffered and released together.
 *
 * Ordering by `claimedAt` first (the instant the tab adopted its CURRENT key), and only then
 * by `tabId`, is what makes the ordinary case read as "the incumbent wins": a tab that opens
 * later claims later. `tabId` alone would be arbitrary, and it is kept only as the tiebreak
 * for the simultaneous case, where it is a fixed-width base36 birth stamp plus a random
 * suffix, hence comparable, stable and total. Both tabs share one wall clock (same browser,
 * same machine), so `claimedAt` is comparable across them.
 *
 * `acquire()` still waits a short SETTLE window before answering, but the window is a
 * courtesy, not the safety mechanism: it lets the answer arrive before the caller acts. If a
 * peer shows up after it, the order still evicts the correct tab.
 *
 * ===========================================================================
 * 5. WHERE THE CALLER MUST ASK (this is the one that destroys data if ignored)
 * ===========================================================================
 * EVERY `clearAllDataStore()` IS A WIPE OF SOMEBODY'S LIVE DATABASES, so every one of them
 * is preceded by an awaited `acquire()`. That is why `acquire()` exists as an awaitable
 * pre-flight returning `{granted}` rather than as a boolean read of a flag.
 *
 * There are four such wipes, and the three that are not the obvious one were the expensive
 * part. `openRemoteAtlas` and `AccountControl.saveLocalToServer` wipe on the way INTO a
 * server atlas. The other two are at BOOT (`index.js`, `enterLocalMapOnBoot` and
 * `openAtlasChooserOnBoot`), and they are the worst case: `ebgeo_local_intent` lives in
 * sessionStorage, which is INHERITED when a tab is duplicated, so the duplicate boots with
 * the intent, reads a remote origin, and wipes the namespace the original tab is using. A
 * boot is also where a flag read cannot work, because at that instant the lock has not yet
 * heard from anybody: only an AWAITED acquire (settle included) can answer. Both go through
 * `clearMountedAtlasIfGranted` (`account/open-atlas.service.js`).
 *
 * A read of `blocked` right after `initTabLock()` is always `false` and means nothing.
 *
 * ===========================================================================
 * 6. LIFECYCLE OF THE KEY (it changes LIVE, so this is an N-time protocol)
 * ===========================================================================
 * The atlas changes without a reload in four flows: login with a pending link, "Salvar no
 * servidor" (a local atlas becomes a new remote one), logout (remote becomes local while the
 * tab stays on the map), and a session lost to a 401. A two-time "check once at boot"
 * protocol cannot express any of them.
 *
 *   ANNOUNCE  `acquire(key)` or `setKey(key)`: stamps a fresh `claimedAt`, broadcasts HELLO,
 *             re-evaluates.
 *   CHANGE    the same call, again, any number of times. The integration should drive it from
 *             `CONNECTION_STATE_CHANGED` plus `SESSION_CHANGED`, reading `syncEngine.atlasId`
 *             as the source of truth, which is the pair `deep-link/atlas-url-sync.js` already
 *             uses. Using a different signal or a different source is how the URL and the
 *             lock end up disagreeing.
 *   RETRACT   `release()`: a 403/404 reverts to local, and a tab that announced a UUID it
 *             cannot open must drop the key. Retraction is a first-class move, not a special
 *             case of unload.
 *   LEAVE     `pagehide`/`beforeunload` post RELEASE and close the channel.
 *   DEATH     a tab that dies without saying anything (crash, kill, sleep) is detected by
 *             ABSENCE: every tab heartbeats a STATE every HEARTBEAT_MS, and a peer unheard of
 *             for PEER_TTL_MS is dropped from the registry, which re-runs the predicate and
 *             releases whoever was waiting on it. The old lock had no heartbeat and no exit
 *             message, so closing the owner tab left the other one blocked forever.
 *
 * ===========================================================================
 * 7. WHAT HAPPENS TO THE LOSER
 * ===========================================================================
 * BLOCKING MUST ACTUALLY STOP THE TAB. The overlay is the visible half; the load-bearing half
 * is `onBlocked`, which stops the sync for real: `stopAutoFlush()` plus
 * `syncEngine.disconnect()`. A purely visual overlay leaves the loser writing to the very
 * scratch the winner is using.
 *
 * That effect CANNOT live in this file, because this module must not import the store (the
 * three pages without a map use it, and a lock that can reach `clearAllDataStore` is one edit
 * away from erasing what it exists to protect). So the effect lives on the sync side, in
 * `store/sync/tab-lock-sync-brake.js`, and is attached here through `setEffects` /
 * `setTabLockEffects` — a page-level call, not an import. `setEffects` is late-safe: a tab that
 * is ALREADY blocked when the brake is installed runs the stop right then, because a lock that
 * only stopped tabs that lost AFTER boot would leave the boot-time loser flushing.
 *
 * AND IT MUST NOT ERASE ANYTHING. The outbound queue is GLOBAL, not per atlas, so blocking
 * with `clearAllDataStore()` would discard unsynced operations belonging to BOTH tabs. Stop
 * the flush and disconnect, wipe nothing. This module never touches storage; it has no
 * import from `@store` at all, which is also what keeps it usable from the three pages that
 * must not drag the store in.
 *
 * "USAR AQUI" IS A REAL HANDOFF, NOT A LOCAL UNBLOCK. The loser posts TAKEOVER and stays
 * blocked. Every tab holding a colliding key runs its own `onBlocked` (stop, disconnect),
 * AWAITS it, and only then retracts its key and acks with YIELD. Awaiting means awaiting the
 * stop that is ACTUALLY running: a tab whose own `onBlocked` is still in flight (it lost the
 * order a moment earlier) waits for THAT promise instead of yielding on the strength of a
 * `blocked` flag that is set before the stop finishes, and never starts a second stop. The
 * requester unblocks when
 * the predicate says it may, that is when no live colliding peer precedes it any more, which
 * is evidence that the other side already stopped, not an assumption that it will. If nobody
 * yields within TAKEOVER_TIMEOUT_MS the requester STAYS blocked and reports failure; the
 * frozen-holder case is then covered by the TTL sweep, which is also evidence.
 *
 * ===========================================================================
 * 8. THE UNMOUNT NOTICE (`announceTeardown`), AND WHY IT IS NOT ADDRESSED BY COLLISION
 * ===========================================================================
 * Everything above arbitrates who MAY hold an atlas. This section is the other half, and it
 * arrived later: a tab that is about to DESTROY databases telling whoever is writing to them.
 *
 * The case is the logout sweep. One tab logs out, the purge is derived from the registry and
 * covers every remote namespace on the machine, including the one a SIBLING tab has mounted. The
 * mount lock (`store/atlas-namespace.js`, Decision 5) already protects that sibling's data: the
 * sweep asks for an exclusive lock, is refused, and reports the atlas as `spared`. What it did
 * NOT do was tell the sibling anything, so the sibling kept writing into a namespace already
 * condemned, and when the 24 h reprieve expired the forced destruction landed with no warning.
 * Worse, a write arriving after the emptying RECREATES those databases, now outside the registry,
 * which is residue no later sweep can find.
 *
 * THE NOTICE IS INFORMATION, NEVER A HANDOVER, and conflating the two cost a data loss. The first
 * version of the receiver's effect released the MOUNT LOCK as part of freezing, on the reading that
 * a tab which stopped but kept the lock would only postpone the destruction to the reprieve. But
 * the lock is not bookkeeping about WHEN: it is the arbitration itself, the one thing between the
 * sibling's databases (its unsynced outbound queue included, since the queue is per atlas) and the
 * sweep. So obeying the notice was what destroyed the tab the notice exists to protect. The
 * receiver stops writing and KEEPS the lock; the sender then finds the namespace mounted and spares
 * it, exactly as it would have without the notice. The rationale, the measurements and the residue
 * this chooses to accept are in `store/sync/tab-lock-sync-brake.js`.
 *
 * THE NOTICE IS ADDRESSED BY A SET OF ADDRESSES, NEVER BY `keysCollide`, and this is the one
 * design decision here that is easy to get wrong in a way that works today and stops working
 * exactly when it matters. `_handleTakeover` returns early when the keys do not collide; the pair
 * this notice must reach is a tab logging OUT (whose key is local, or none) and a tab holding a
 * SERVER atlas, which do not collide, and now that the remote x remote hold is out (section 2)
 * two tabs in two different server atlases do not collide either. Routing the notice through the
 * collision predicate would therefore make it work in the demo and go silent in production. So
 * TEARDOWN carries `addresses` (`dbSuffix` strings), it is delivered to EVERY live peer, and each
 * receiver decides for itself by comparing against the address it has MOUNTED, which is a fact of
 * the store and not of the key.
 *
 * WHICH IS ALSO WHY THE MATCH IS NOT MADE HERE. This module must not import the store (section 7),
 * and the mounted address lives there. The receiver's decision is therefore an EFFECT, installed
 * with the other two through `setEffects({onTeardown})` by `store/sync/tab-lock-sync-brake.js`. It
 * answers a boolean, "I hold one of those and I have stopped", and this module does the protocol
 * around it: deliver, await, ack, and only then act on the ack.
 *
 * ORDER, AND WHY THE ACK IS EVIDENCE. The receiver's freeze is AWAITED before the ack is posted,
 * exactly as a YIELD awaits the stop it announces. The emitter waits for one ack per live peer (or
 * for a timeout) before it empties anything, so "the sibling stopped writing" is something it was
 * told, not something it hopes. A peer that never answers costs the timeout and nothing else: the
 * destruction that follows is still gated by the exclusive mount lock, so silence degrades to
 * TODAY's behaviour (spare), never to a wipe under a live writer.
 *
 * A FROZEN TAB DOES NOT COME BACK. It retracts its key (it no longer holds that atlas, so keeping
 * the claim would lock everyone else out of an atlas nobody has), shows an overlay that offers a
 * reload, and is pinned out of `_leaveBlocked` forever: the session behind that atlas is over, so
 * an `onResumed` that reconnected would be a reconnect nobody is entitled to. Only a reload clears
 * it, and the overlay says what a reload costs, because the reload is what finally lets the next
 * logged-out sweep take the namespace this tab is holding open.
 *
 * ===========================================================================
 * 9. DEGRADED PATH (no BroadcastChannel)
 * ===========================================================================
 * The old module turned the lock OFF, entirely and silently, when `BroadcastChannel` was
 * missing. That is the worst of the three options: the failure is invisible and it fails
 * open on the one invariant the lock exists to protect.
 *
 * The protocol here is transport agnostic (`post` / `setReceiver` / `close`), so the fallback
 * is a real one: a `localStorage` bus, where a post writes a JSON envelope to one key and
 * peers read it from the `storage` event, which fires in every OTHER same-origin tab and not
 * in the writer, giving the same no-self-echo semantics as BroadcastChannel. Every same-origin
 * browser that lacks BroadcastChannel has localStorage, so in practice the lock keeps working.
 * It is best effort in one respect worth stating: two posts in the same tick are two separate
 * writes and two separate events, and a peer that is busy still gets them in order, but a
 * storage quota error would drop a message. A dropped message costs at most one heartbeat.
 *
 * When BOTH transports are missing (a hardened embedder, a non-browser host), the lock
 * degrades to OFF, and says so: a single `console.warn` plus `degraded: true` on the public
 * status, so a caller can badge it. Off and audible, never off and quiet.
 *
 * ===========================================================================
 * 10. PUBLIC API (other agents wire this; nothing here integrates itself)
 * ===========================================================================
 * Pure, for callers and tests: `TabLockKeyKind`, `noneKey`, `localAtlasKey`, `remoteAtlasKey`,
 * `keysCollide`, `compareClaims`, `findBlockingPeer`.
 *
 * Instance: `createTabLock(deps)` returns `{ tabId, key, blocked, frozen, degraded, transportKind,
 * peers(), acquire(key, opts), setKey(key), release(), requestTakeover(), announceTeardown(addrs),
 * pulse(), setEffects(handlers), subscribe(fn), destroy() }`.
 *
 * Singleton, for the pages: `initTabLock(options)`, `getTabLock()`, `acquireTabLock(key)`,
 * `setTabLockKey(key)`, `setTabLockEffects(handlers)`, `releaseTabLock()`, `isTabLockBlocked()`,
 * `isTabLockFrozen()`, `announceTabLockTeardown(addresses)`, `onTabLockChange(fn)`,
 * `destroyTabLock()`.
 *
 * WHO CALLS WHAT (this paragraph claimed the opposite for one phase: it said no page called
 * `acquire` yet, while `index.js` and `open-atlas.service.js` already did):
 *
 *   - `index.js` boots the singleton with the key from `currentAtlasLockKey()`, then installs
 *     the EFFECTS through `installTabLockSyncBrake` (`store/sync/tab-lock-sync-brake.js`),
 *     which is what turns a block into a real stop, an unblock into a real reconnect, and an
 *     unmount notice into a real freeze.
 *   - `store/store.js` announces the notice, with the addresses read from the remote registry,
 *     BEFORE the sweep empties or destroys anything. It is bound to the sweep
 *     (`discardRemoteAtlasNamespaces`) and not to the logout, because the logged-out BOOT GUARD
 *     runs that same sweep and used to warn nobody; on that path there is no singleton yet, which
 *     is what `announceTabLockTeardown` builds a throwaway participant for.
 *   - `open-atlas.service.js` owns every claim of an atlas: `claimRemoteAtlas` before an
 *     open, `clearMountedAtlasIfGranted` before a boot wipe, `syncAtlasLockKey` on the live
 *     changes, `retractAtlasClaim` on a claim it cannot honour.
 *   - the three pages without a map call `initTabLock({ key: noneKey(), overlayHost: null })`
 *     and nothing else.
 *
 * ===========================================================================
 * 11. WHAT THIS PROTOCOL DOES NOT DO (known, open, and written down here on purpose)
 * ===========================================================================
 * Everything above describes what the lock arbitrates. It arbitrates less than a first reading
 * suggests, and a doc that only lists the guarantees is the kind that misleads an agent twice
 * over. The six open holes are enumerated in `frontend/tests/TESTING-BACKLOG.md`, section
 * "Furos abertos do tab-lock", each with its reproduction in
 * `frontend/tests/unit/tab-lock-refutacao.test.js` as an `it.todo`. The four that change how you
 * should read the sections above:
 *
 *   - `acquire()` GRANTS BY ABSENCE OF PROOF. Section 4 says the total order removes the timing
 *     window, and it does — for the STATE. It does not remove it for an effect that already ran:
 *     two tabs whose settle windows overlap both get `{granted: true}`, and `granted` is what
 *     authorises `clearAllDataStore()` (section 5). One lost message does the same.
 *   - THERE IS NO FENCING. Section 6 (DEATH) explains the TTL sweep as if eviction were final.
 *     The evicted tab is never told: a tab merely FROZEN (busy main thread, not dead) stops
 *     pulsing, is expired, and on waking re-announces its old `claimedAt`, precedes again, and
 *     resumes without its `onBlocked` ever having run.
 *   - `pagehide` DOES NOT CHECK `persisted`, so entering the bfcache posts RELEASE and coming
 *     back does not re-announce until the next heartbeat.
 *   - A TAB THAT YIELDED NEVER RE-ADOPTS. Section 7 presents "Usar aqui" as a clean handoff; it
 *     is one for the requester. `_evaluate` only leaves the blocked state when `!this._yielded`,
 *     so a tab holding `_yieldedKey` stays blocked forever if the winner closes, and a single
 *     TAKEOVER strands EVERY tab holding the colliding key, not just the one that asked.
 */

import { setupCleanup, addDomListener, trackTimer, cleanup, removeElement } from './event-cleanup.js';

/** Channel/storage-key name shared by every tab of the origin. */
const CHANNEL_NAME = 'ebgeo-tab-lock';

/** Bumped whenever a message shape changes; mismatched versions ignore each other. */
const PROTOCOL_VERSION = 3;

/** How often a tab restates its claim, so peers can notice its absence. */
const HEARTBEAT_MS = 2000;

/** A peer unheard of for this long is considered dead (about three missed heartbeats). */
const PEER_TTL_MS = 7000;

/** How long `acquire()` waits for peers to answer before reporting. Courtesy, not safety. */
const SETTLE_MS = 300;

/** How long "Usar aqui" waits for the holders to actually stop. */
const TAKEOVER_TIMEOUT_MS = 4000;

/**
 * How long an unmount notice waits for every live peer to answer (section 8). Silence is safe
 * (the destruction that follows is still gated by the exclusive mount lock), so this bounds a
 * logout, it does not decide anything.
 */
const TEARDOWN_TIMEOUT_MS = 2000;

/**
 * Polling step of that wait. The loop counts STEPS rather than reading the clock, so an injected
 * clock that does not advance still terminates instead of spinning.
 */
const TEARDOWN_POLL_MS = 25;

/** Message types of the channel protocol. */
const Msg = Object.freeze({
    HELLO: 'HELLO',
    STATE: 'STATE',
    RELEASE: 'RELEASE',
    TAKEOVER: 'TAKEOVER',
    YIELD: 'YIELD',
    TEARDOWN: 'TEARDOWN',
    TEARDOWN_ACK: 'TEARDOWN_ACK'
});

/** What a tab can be holding. */
export const TabLockKeyKind = Object.freeze({
    NONE: 'none',
    LOCAL: 'local',
    REMOTE: 'remote'
});

/** Static monitor icon for the overlay. No user data ever reaches it. */
const MONITOR_ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" '
    + 'stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">'
    + '<rect x="2" y="3" width="20" height="14" rx="2" ry="2"/>'
    + '<line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>';

const OVERLAY_TEXT = Object.freeze({
    [TabLockKeyKind.REMOTE]: 'Este projeto do servidor já está aberto em outra aba. Um mesmo '
        + 'projeto só pode ser editado em uma aba por vez.',
    [TabLockKeyKind.LOCAL]: 'Este atlas local já está aberto em outra aba. Continue o trabalho '
        + 'por lá, ou traga o controle para cá.'
});

/**
 * Wording of the FROZEN state (section 8): the session behind this tab's atlas ended elsewhere.
 *
 * It used to say the data was being removed and that reloading was how to continue, and both
 * halves became false when the freeze stopped releasing the mount lock: the namespace is SPARED
 * while this tab holds it, and the reload is precisely what hands it to the next sweep. A message
 * that tells someone to press the button that discards their unsent work is worse than no message.
 */
const TEARDOWN_OVERLAY = Object.freeze({
    title: 'Este projeto foi encerrado em outra aba',
    message: 'Outra aba saiu da conta, então este projeto do servidor não pode mais ser editado '
        + 'aqui: esta aba parou de gravar. O que ainda não foi enviado continua guardado neste '
        + 'computador enquanto esta aba ficar aberta. Entre novamente e abra o projeto para '
        + 'enviá-lo; recarregar esta aba antes disso descarta esse trabalho.',
    button: 'Recarregar'
});

/** Wording of the ordinary blocked state. */
const BLOCKED_OVERLAY = Object.freeze({
    title: 'EBGeo está aberto em outra aba',
    button: 'Usar aqui'
});

/**
 * @typedef {Object} TabLockKey
 * @property {string} kind - A `TabLockKeyKind` value.
 * @property {string|null} atlasId - Atlas id, decisive for `local` AND for `remote`. Null only
 *   on the `none` key, which never collides.
 * @property {string|null} [adoptedFrom] - LOCAL keys only: the server atlas whose databases
 *   this slot occupies after `adoptRemoteAtlasAsLocal` (fileoverview, 2). It moves the ADDRESS
 *   of the claim without moving its kind.
 */

/**
 * @typedef {Object} TabLockClaim
 * @property {string} tabId - Comparable per-tab id.
 * @property {TabLockKey} key - What the tab holds.
 * @property {number} claimedAt - Epoch ms when the tab adopted this key.
 */

const NONE_KEY = Object.freeze({ kind: TabLockKeyKind.NONE, atlasId: null });

/**
 * The key of a page that holds no atlas (the three pages without a map, or a map tab before
 * it knows which atlas it is in).
 * @returns {TabLockKey}
 */
export function noneKey() {
    return NONE_KEY;
}

/**
 * The key of a LOCAL atlas slot. The id is decisive: two tabs in two different local atlases
 * do not collide.
 *
 * `adoptedFrom` is the exception that the ADDRESS rule needs (fileoverview, 2): a slot rescued
 * by `adoptRemoteAtlasAsLocal` keeps the `remote-<atlasId>` databases of the server atlas it
 * came from, so it must collide with a tab opening THAT atlas even though its kind is local.
 * The field is omitted when there is no adoption, so an ordinary local key stays the plain
 * `{kind, atlasId}` pair every caller compares against.
 *
 * @param {string} atlasId - Local atlas slot id (registry entry id).
 * @param {{adoptedFrom?: string|null}} [options] - `adoptedFrom`: server atlas id whose
 *   namespace this slot occupies, from `remoteAtlasIdFromDbSuffix(scope.dbSuffix)`.
 * @returns {TabLockKey}
 */
export function localAtlasKey(atlasId, { adoptedFrom = null } = {}) {
    if (typeof atlasId !== 'string' || atlasId.length === 0) {
        throw new Error('localAtlasKey: atlasId must be a non-empty string');
    }
    if (adoptedFrom !== null && (typeof adoptedFrom !== 'string' || adoptedFrom.length === 0)) {
        throw new Error('localAtlasKey: adoptedFrom must be a non-empty string or null');
    }
    return adoptedFrom === null
        ? Object.freeze({ kind: TabLockKeyKind.LOCAL, atlasId })
        : Object.freeze({ kind: TabLockKeyKind.LOCAL, atlasId, adoptedFrom });
}

/**
 * The key of a REMOTE (server) atlas. The id is DECISIVE, exactly as it is for a local slot:
 * each server atlas owns its own databases, so two tabs in two different server atlases share
 * nothing and must not block each other.
 *
 * It throws without an id rather than defaulting to a nameless remote claim. A nameless claim
 * used to be the normal case (all remotes collided, so the UUID was decoration); under the
 * uniform rule it would be a claim on nothing, silently colliding with nobody. The caller that
 * has no UUID yet (a public link token) must resolve it first, which costs one read and no
 * data (fileoverview, 1).
 * @param {string} atlasId - Atlas UUID.
 * @returns {TabLockKey}
 */
export function remoteAtlasKey(atlasId) {
    if (typeof atlasId !== 'string' || atlasId.length === 0) {
        throw new Error('remoteAtlasKey: atlasId must be a non-empty string');
    }
    return Object.freeze({ kind: TabLockKeyKind.REMOTE, atlasId });
}

/**
 * The set of databases a claim names, as a comparable string, or null when it names none.
 *
 * Kinds are part of the address because `local:x` and `remote:x` ARE different namespaces
 * (`localScope` vs `remoteScope`), so the same id under two kinds is two different sets of
 * databases. The single exception is the adopted slot, which is the one case where a local slot
 * and a server atlas are the same databases (fileoverview, 2).
 *
 * @param {TabLockKey|null|undefined} key
 * @returns {string|null} Address, or null for a claim over nothing.
 */
function claimAddress(key) {
    if (!key || key.kind === TabLockKeyKind.NONE) return null;

    if (key.kind === TabLockKeyKind.LOCAL && typeof key.adoptedFrom === 'string'
        && key.adoptedFrom.length > 0) {
        return `${TabLockKeyKind.REMOTE}:${key.adoptedFrom}`;
    }

    // A claim that names no atlas names no databases. This is also the last defence of the
    // pages without a map, whose key is `none` on both counts.
    const atlasId = key.atlasId ?? null;
    if (atlasId === null) return null;

    // The kind is interpolated raw, never switched on: a corrupted or future-deploy kind still
    // produces an address, so two identical claims collide whatever they call themselves.
    return `${key.kind}:${atlasId}`;
}

/**
 * The owner's rule as a predicate: SAME ADDRESS. See the fileoverview, section 2.
 * @param {TabLockKey|null|undefined} a
 * @param {TabLockKey|null|undefined} b
 * @returns {boolean} True when the two keys cannot be held at the same time.
 */
export function keysCollide(a, b) {
    // THE REMOTE x REMOTE HOLD LIVED HERE, AND IT IS OUT (2026-08-15). It made every pair of
    // server atlases collide, which was never the owner's rule: it was the safe reading of four
    // holes that only two remote tabs could reach. Each was closed by name before this line was
    // deleted, and each has its own guard, so the removal is not a promise:
    //
    //   - `saveLocalToServer` did not activate a namespace. It calls `activateRemoteAtlas`
    //     between the claim and the wipe now (`account/account.control.js`), and the LIST of
    //     legal mounters plus the ORDER inside a server-atlas entry is asserted structurally by
    //     `tests/unit/portao-de-montagem.test.js`;
    //   - the logout of ONE tab deregistered the LIVE namespace of the other. The sweep now asks
    //     for the exclusive mount lock, reports the refusal as `spared` and keeps the registry
    //     entry (`store/remote-atlas.api.js`, `SPARE_GRACE_MS`), and the sibling is TOLD by the
    //     unmount notice of section 8 instead of being left to find out;
    //   - the public-link path wiped the namespace it had just registered, because the sweep
    //     hung off `clearAllDataStore`. It is called BY NAME now, from the two places that mean
    //     "the session is over" (`store/store.js discardRemoteAtlasNamespaces`);
    //   - the outbound queue was GLOBAL. It is `perAtlas: true` (`atlas-namespace.js`), so atlas
    //     X writes into `ebgeo__<suffix of X>` and cannot drain or empty the queue of atlas Y,
    //     and every operation also carries the address of the scope it was born in.
    //
    // What is left is the uniform rule, and it is what the address comparison below says on its
    // own: same atlas collides, different atlases do not, local and remote alike.
    const addressA = claimAddress(a);
    return addressA !== null && addressA === claimAddress(b);
}

/**
 * Total order over claims: older claim first, tab id as the tiebreak. Every tab computes it
 * over the same broadcast data, which is what removes the timing window (fileoverview, 4).
 * @param {TabLockClaim} a
 * @param {TabLockClaim} b
 * @returns {number} Negative when `a` precedes `b`, positive when it follows, 0 when equal.
 */
export function compareClaims(a, b) {
    if (a.claimedAt !== b.claimedAt) return a.claimedAt < b.claimedAt ? -1 : 1;
    if (a.tabId === b.tabId) return 0;
    return a.tabId < b.tabId ? -1 : 1;
}

/**
 * The peer that blocks `self`, if any: the earliest live claim that both collides with `self`
 * and precedes it.
 * @param {TabLockClaim} self
 * @param {TabLockClaim[]} peers - Live peers only (expired ones must be filtered out first).
 * @returns {TabLockClaim|null}
 */
export function findBlockingPeer(self, peers) {
    let blocker = null;
    for (const peer of peers) {
        if (!keysCollide(self.key, peer.key)) continue;
        if (compareClaims(peer, self) >= 0) continue;
        if (!blocker || compareClaims(peer, blocker) < 0) blocker = peer;
    }
    return blocker;
}

/**
 * @param {string[]|*} addresses - Whatever a caller passed.
 * @returns {string[]} De-duplicated `dbSuffix` strings, safe to broadcast.
 */
function normalizeTeardownAddresses(addresses) {
    return [...new Set(
        (Array.isArray(addresses) ? addresses : [])
            .filter(address => typeof address === 'string')
    )];
}

/**
 * @param {string[]} list - Addresses the notice is about.
 * @param {boolean} degraded - Whether the announcer had no transport.
 * @returns {{addresses: string[], peers: number, acked: number, frozen: number,
 *   timedOut: boolean, degraded: boolean}} A report saying nothing happened.
 */
function emptyTeardownReport(list, degraded) {
    return { addresses: list, peers: 0, acked: 0, frozen: 0, timedOut: false, degraded };
}

/**
 * Builds a comparable, practically unique tab id: a fixed-width base36 birth stamp (so a
 * plain string compare orders by age) plus a random suffix (so two tabs born in the same
 * millisecond still get a total order).
 * @param {number} birth - Epoch ms.
 * @returns {string}
 */
function makeTabId(birth) {
    const stamp = Math.max(0, Math.floor(birth)).toString(36).padStart(10, '0');
    const rand = (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID().slice(0, 8)
        : Math.random().toString(36).slice(2, 10).padStart(8, '0');
    return `${stamp}-${rand}`;
}

/**
 * @typedef {Object} TabLockTransport
 * @property {string} kind - Transport name, for diagnostics.
 * @property {(message: Object) => void} post - Broadcast to the other tabs (never to self).
 * @property {(receiver: (message: Object) => void) => void} setReceiver - Install the handler.
 * @property {() => void} close - Release the underlying resource.
 */

/**
 * BroadcastChannel transport (the normal path).
 * @param {string} name
 * @returns {TabLockTransport|null} Null when the API is missing.
 */
function createBroadcastTransport(name) {
    if (typeof BroadcastChannel === 'undefined') return null;
    const channel = new BroadcastChannel(name);
    return {
        kind: 'broadcast-channel',
        post: (message) => channel.postMessage(message),
        setReceiver: (receiver) => {
            channel.onmessage = (event) => receiver(event.data);
        },
        close: () => {
            channel.onmessage = null;
            channel.close();
        }
    };
}

/**
 * localStorage transport (the degraded path, fileoverview 9). The `storage` event fires in
 * every other same-origin tab and not in the writer, which is the same no-self-echo semantics
 * BroadcastChannel has.
 * @param {string} name
 * @returns {TabLockTransport|null} Null when there is no window/localStorage.
 */
function createStorageTransport(name) {
    if (typeof window === 'undefined' || !window.localStorage || !window.addEventListener) {
        return null;
    }
    const busKey = `${name}:bus`;
    let receiver = null;
    let seq = 0;

    const onStorage = (event) => {
        if (event.key !== busKey || !event.newValue || !receiver) return;
        try {
            const envelope = JSON.parse(event.newValue);
            receiver(envelope?.payload);
        } catch {
            // A malformed envelope is one lost message, never a thrown boot.
        }
    };

    window.addEventListener('storage', onStorage);
    return {
        kind: 'local-storage',
        post: (message) => {
            try {
                seq += 1;
                window.localStorage.setItem(busKey, JSON.stringify({ n: seq, payload: message }));
            } catch {
                // Quota or private mode: one dropped message costs at most one heartbeat.
            }
        },
        setReceiver: (fn) => {
            receiver = fn;
        },
        close: () => {
            receiver = null;
            window.removeEventListener('storage', onStorage);
        }
    };
}

/**
 * Picks the best available transport.
 * @param {string} name
 * @returns {TabLockTransport|null} Null when the lock has to run degraded.
 */
function defaultCreateTransport(name) {
    return createBroadcastTransport(name) ?? createStorageTransport(name);
}

/**
 * One tab's participation in the protocol. Owns no storage and imports nothing from `@store`,
 * so the pages without a map can use it.
 */
class TabLock {
    /**
     * @param {Object} [options]
     * @param {TabLockKey} [options.key] - Initial key (defaults to holding nothing).
     * @param {() => (void|Promise<void>)} [options.onBlocked] - Wire it to `stopAutoFlush()` +
     *   `syncEngine.disconnect()`. It MUST NOT clear any store (fileoverview, 7).
     * @param {() => (void|Promise<void>)} [options.onResumed] - Called when this tab regains
     *   the claim (peer died, peer yielded, key changed to a free one).
     * @param {((addresses: string[]) => (boolean|Promise<boolean>))} [options.onTeardown] - Wire
     *   it to `applyTeardownFreeze` (`store/sync/tab-lock-sync-brake.js`). It answers whether
     *   this tab held one of those database addresses AND has stopped writing (section 8).
     * @param {HTMLElement|null} [options.overlayHost] - Where the blocking overlay is mounted;
     *   null disables the overlay (headless/tests).
     * @param {(name: string) => (TabLockTransport|null)} [options.createTransport]
     * @param {string} [options.channelName]
     * @param {() => number} [options.now] - Injectable clock.
     * @param {number} [options.heartbeatMs]
     * @param {number} [options.peerTtlMs]
     * @param {number} [options.settleMs]
     * @param {number} [options.takeoverTimeoutMs]
     * @param {boolean} [options.autoPulse] - False keeps the timer off (tests drive `pulse()`).
     */
    constructor({
        key = noneKey(),
        onBlocked = null,
        onResumed = null,
        onTeardown = null,
        overlayHost = (typeof document !== 'undefined' ? document.body : null),
        createTransport = defaultCreateTransport,
        channelName = CHANNEL_NAME,
        now = () => Date.now(),
        heartbeatMs = HEARTBEAT_MS,
        peerTtlMs = PEER_TTL_MS,
        settleMs = SETTLE_MS,
        takeoverTimeoutMs = TAKEOVER_TIMEOUT_MS,
        teardownTimeoutMs = TEARDOWN_TIMEOUT_MS,
        autoPulse = true
    } = {}) {
        setupCleanup(this);

        this._now = now;
        this._birth = now();
        this._tabId = makeTabId(this._birth);
        this._key = key;
        this._claimedAt = this._birth;
        this._onBlocked = onBlocked;
        this._onResumed = onResumed;
        this._onTeardown = onTeardown;
        this._overlayHost = overlayHost;
        this._heartbeatMs = heartbeatMs;
        this._peerTtlMs = peerTtlMs;
        this._settleMs = settleMs;
        this._takeoverTimeoutMs = takeoverTimeoutMs;
        this._teardownTimeoutMs = teardownTimeoutMs;

        /** @type {Map<string, TabLockClaim & {lastSeen: number}>} */
        this._peers = new Map();
        this._blocked = false;
        this._blocker = null;
        this._listeners = new Set();
        this._overlay = null;
        this._destroyed = false;
        this._yielded = false;
        this._yieldedKey = null;
        this._message = null;
        this._title = null;
        this._button = null;
        /** True once an unmount notice froze this tab. Only a reload clears it (section 8). */
        this._frozen = false;
        /** @type {Map<string, boolean>|null} Acks of the notice in flight, by peer tab id. */
        this._teardownAcks = null;
        /** @type {Promise<void>|null} The stop currently running, or the one that already ran. */
        this._blockingPromise = null;

        this._transport = createTransport(channelName);
        this._degraded = !this._transport;
        if (this._degraded) {
            console.warn(
                '[tab-lock] No BroadcastChannel and no localStorage: multi-tab arbitration is '
                + 'OFF in this tab. Two tabs may end up in the same atlas.'
            );
            return;
        }

        // Installed BEFORE anything is posted: a tab is never silent (fileoverview, 4a).
        this._transport.setReceiver((message) => this._onMessage(message));

        if (typeof window !== 'undefined' && window.addEventListener) {
            const leave = () => this._postLeave();
            addDomListener(this, window, 'pagehide', leave);
            addDomListener(this, window, 'beforeunload', leave);
        }

        if (autoPulse && heartbeatMs > 0) {
            const timer = setInterval(() => this.pulse(), heartbeatMs);
            trackTimer(this, timer, 'interval');
        }

        this._post(Msg.HELLO);
    }

    /** @returns {string} This tab's comparable id. */
    get tabId() {
        return this._tabId;
    }

    /** @returns {TabLockKey} The key this tab currently claims. */
    get key() {
        return this._key;
    }

    /** @returns {boolean} True when this tab lost and has been stopped. */
    get blocked() {
        return this._blocked;
    }

    /**
     * @returns {boolean} True when an unmount notice stopped this tab for good: the databases it
     * was writing to are being destroyed elsewhere, and only a reload brings it back.
     */
    get frozen() {
        return this._frozen;
    }

    /** @returns {boolean} True when no transport exists and the lock is OFF. */
    get degraded() {
        return this._degraded;
    }

    /** @returns {string} Transport in use, or 'none' when degraded. */
    get transportKind() {
        return this._transport?.kind ?? 'none';
    }

    /** @returns {TabLockClaim|null} The peer that is blocking this tab, if any. */
    get blocker() {
        return this._blocker;
    }

    /**
     * Snapshot of the live peers (expired ones excluded).
     * @returns {TabLockClaim[]}
     */
    peers() {
        return this._livePeers().map(({ tabId, key, claimedAt }) => ({ tabId, key, claimedAt }));
    }

    /**
     * Claims a key and reports whether this tab may proceed. CALL THIS BEFORE ANY DESTRUCTIVE
     * STEP, notably before `clearAllDataStore()` in the remote-open flow (fileoverview, 5).
     * @param {TabLockKey} key
     * @param {{settleMs?: number}} [options]
     * @returns {Promise<{granted: boolean, blockedBy: TabLockClaim|null, degraded: boolean}>}
     */
    async acquire(key, { settleMs = this._settleMs } = {}) {
        this.setKey(key);
        if (this._degraded || this._destroyed) {
            return { granted: !this._blocked, blockedBy: null, degraded: this._degraded };
        }
        await this._wait(settleMs);
        if (this._destroyed) return { granted: false, blockedBy: null, degraded: false };
        this._evaluate();
        return { granted: !this._blocked, blockedBy: this._blocker, degraded: false };
    }

    /**
     * Adopts a key and announces it. Stamps a fresh `claimedAt`, so a tab that switches atlas
     * enters the order as a newcomer against whoever already held that atlas.
     * @param {TabLockKey} key
     * @returns {boolean} True when this tab is blocked right after the change.
     */
    setKey(key) {
        if (this._destroyed) return this._blocked;
        this._key = key ?? noneKey();
        this._claimedAt = this._now();
        this._yielded = false;
        this._post(Msg.HELLO);
        this._evaluate();
        return this._blocked;
    }

    /**
     * Retracts the key (403/404, logout of a dead atlas, or any revert to holding nothing).
     * Peers drop this claim and re-evaluate, which can unblock one of them.
     * @returns {void}
     */
    release() {
        if (this._destroyed) return;
        this._key = noneKey();
        this._claimedAt = this._now();
        this._post(Msg.RELEASE);
        this._evaluate();
    }

    /**
     * "Usar aqui": asks the holders to yield, and waits for evidence that they stopped.
     * Resolves false when nobody yielded in time, in which case this tab STAYS blocked.
     * @returns {Promise<boolean>}
     */
    async requestTakeover() {
        if (this._degraded || this._destroyed) return true;
        // There is nothing to take over from a destruction: the databases this tab would take the
        // claim to are being deleted, and a granted claim would only let it recreate them.
        if (this._frozen) return false;
        if (!this._blocked) return true;

        if (this._yielded) {
            // This tab had handed the claim away; re-adopt it before asking for it back.
            this._key = this._yieldedKey ?? this._key;
            this._claimedAt = this._now();
            this._yielded = false;
        }
        this._post(Msg.TAKEOVER);

        const deadline = this._now() + this._takeoverTimeoutMs;
        while (this._now() < deadline) {
            this._evaluate();
            if (!this._blocked) return true;
            await this._wait(50);
            if (this._destroyed) return false;
        }
        this._evaluate();
        return !this._blocked;
    }

    /**
     * ANNOUNCES THAT THESE DATABASE ADDRESSES ARE ABOUT TO BE DESTROYED, and waits for the tabs
     * writing to them to stop. Call it BEFORE emptying or deleting anything (section 8).
     *
     * The notice goes to EVERY live peer and carries no key: it is addressed by ADDRESS, and each
     * receiver matches it against what it has MOUNTED. Routing it through `keysCollide` would
     * silence it for exactly the pair it exists for (a tab logging out next to a tab holding a
     * server atlas, which do not collide).
     *
     * Silence is safe by construction: a peer that cannot or will not answer keeps its mount lock,
     * so the destruction that follows is refused for that namespace and it is spared, which is the
     * behaviour of the deploy that had no notice at all.
     *
     * @param {string[]} addresses - `dbSuffix` values about to be destroyed.
     * @param {{timeoutMs?: number}} [options]
     * @returns {Promise<{addresses: string[], peers: number, acked: number, frozen: number,
     *   timedOut: boolean, degraded: boolean}>} `frozen` counts the peers that reported they held
     *   one of the addresses and stopped.
     */
    async announceTeardown(addresses, { timeoutMs = this._teardownTimeoutMs } = {}) {
        const list = normalizeTeardownAddresses(addresses);
        const report = emptyTeardownReport(list, this._degraded);
        if (this._degraded || this._destroyed || list.length === 0) return report;

        const pending = new Set(this._livePeers().map(peer => peer.tabId));
        report.peers = pending.size;
        const acks = new Map();
        this._teardownAcks = acks;
        this._post(Msg.TEARDOWN, null, { addresses: list });

        // Counting STEPS instead of reading the clock: `_now` is injectable and a frozen clock
        // must still let this return.
        for (let waited = 0; pending.size > 0 && waited < timeoutMs; waited += TEARDOWN_POLL_MS) {
            await this._wait(TEARDOWN_POLL_MS);
            if (this._destroyed) break;
            const live = new Set(this._livePeers().map(peer => peer.tabId));
            for (const tabId of [...pending]) {
                // A peer that answered is done; one that died meanwhile cannot answer, and its
                // mount lock died with it, so waiting for it would only delay the destruction.
                if (acks.has(tabId) || !live.has(tabId)) pending.delete(tabId);
            }
        }

        if (this._teardownAcks === acks) this._teardownAcks = null;
        report.acked = acks.size;
        report.frozen = [...acks.values()].filter(Boolean).length;
        report.timedOut = pending.size > 0;
        return report;
    }

    /**
     * One protocol tick: restate the claim, expire silent peers, re-evaluate. Called by the
     * heartbeat timer, and by tests with an injected clock.
     * @returns {void}
     */
    pulse() {
        if (this._degraded || this._destroyed) return;
        this._post(Msg.STATE);
        this._evaluate();
    }

    /**
     * Installs (or replaces) the effect handlers after construction. This is the seam that lets
     * the sync brake (`store/sync/tab-lock-sync-brake.js`) do the stopping without this module
     * importing the store.
     *
     * LATE-SAFE ON PURPOSE: when the tab is already blocked and no stop has run for that block
     * (it was blocked before any handler existed), the stop runs now. The returned promise is
     * that stop, so a caller can await the tab actually being stopped.
     * @param {Object} [handlers]
     * @param {(() => (void|Promise<void>))|null} [handlers.onBlocked] - Stop the sync. It MUST
     *   NOT clear any store (fileoverview, 7). Undefined leaves the current handler in place.
     * @param {(() => (void|Promise<void>))|null} [handlers.onResumed] - Restore what was stopped.
     * @param {((addresses: string[]) => (boolean|Promise<boolean>))|null} [handlers.onTeardown] -
     *   Answer an unmount notice (section 8). It is NOT late-safe like `onBlocked`, and does not
     *   need to be: a notice that arrived before this handler existed was acked with `frozen:
     *   false`, so the sender left that namespace mounted and spared it.
     * @returns {Promise<void>} Resolves once any catch-up stop has finished.
     */
    setEffects({ onBlocked, onResumed, onTeardown } = {}) {
        if (this._destroyed) return Promise.resolve();
        if (onBlocked !== undefined) this._onBlocked = onBlocked;
        if (onResumed !== undefined) this._onResumed = onResumed;
        if (onTeardown !== undefined) this._onTeardown = onTeardown;
        if (this._blocked && this._onBlocked && !this._blockingPromise) {
            this._blockingPromise = this._runBlockedEffect();
        }
        return this._blockingPromise ?? Promise.resolve();
    }

    /**
     * Subscribes to state changes.
     * @param {(status: {blocked: boolean, key: TabLockKey, blocker: TabLockClaim|null,
     *   degraded: boolean}) => void} listener
     * @returns {() => void} Unsubscribe.
     */
    subscribe(listener) {
        this._listeners.add(listener);
        return () => this._listeners.delete(listener);
    }

    /**
     * Full teardown: announce the departure, drop listeners, timers, overlay and channel.
     * @returns {void}
     */
    destroy() {
        if (this._destroyed) return;
        this._postLeave();
        this._destroyed = true;
        cleanup(this);
        this._transport?.close();
        this._transport = null;
        this._listeners.clear();
        this._peers.clear();
        this._teardownAcks = null;
        removeElement(this._overlay);
        this._overlay = null;
    }

    // ------------------------------------------------------------------ protocol

    /**
     * @param {string} type - A `Msg` value.
     * @param {string|null} [target] - Recipient tab id, for targeted acks.
     * @param {Object|null} [extra] - Fields of the specific message type (`addresses`, `frozen`).
     * @returns {void}
     */
    _post(type, target = null, extra = null) {
        if (!this._transport) return;
        this._transport.post({
            // The wire key carries `adoptedFrom` ALWAYS, unlike the in-memory key, which omits
            // it when there is none: a message is read by code, a key is also compared by hand.
            v: PROTOCOL_VERSION,
            type,
            tabId: this._tabId,
            key: {
                kind: this._key.kind,
                atlasId: this._key.atlasId ?? null,
                adoptedFrom: this._key.adoptedFrom ?? null
            },
            claimedAt: this._claimedAt,
            target,
            ...(extra ?? {})
        });
    }

    /** Announces the departure without tearing anything down yet. @returns {void} */
    _postLeave() {
        this._post(Msg.RELEASE);
    }

    /**
     * @param {Object} message
     * @returns {void}
     */
    _onMessage(message) {
        if (this._destroyed) return;
        if (!message || message.v !== PROTOCOL_VERSION) return;
        if (message.tabId === this._tabId) return;

        switch (message.type) {
        case Msg.HELLO:
            this._rememberPeer(message);
            // Answered unconditionally, including while this tab is still settling. This is
            // the half of the fix that closes the old probe window.
            this._post(Msg.STATE, message.tabId);
            this._evaluate();
            break;

        case Msg.STATE:
        case Msg.YIELD:
            this._rememberPeer(message);
            this._evaluate();
            break;

        case Msg.RELEASE:
            this._peers.delete(message.tabId);
            this._evaluate();
            break;

        case Msg.TAKEOVER:
            this._rememberPeer(message);
            this._handleTakeover(message);
            break;

        case Msg.TEARDOWN:
            // NO `keysCollide` GATE, and no early return: the notice is addressed by the set of
            // ADDRESSES it carries, and the pair it exists for does not collide (section 8).
            this._rememberPeer(message);
            this._handleTeardown(message);
            break;

        case Msg.TEARDOWN_ACK:
            // Not remembered as a peer: the sender retracts its key right after acking, and
            // re-adding it here would resurrect a claim it has already dropped.
            if (message.target === this._tabId) {
                this._teardownAcks?.set(message.tabId, message.frozen === true);
            }
            break;

        default:
            break;
        }
    }

    /**
     * @param {Object} message
     * @returns {void}
     */
    _rememberPeer(message) {
        const key = message.key ?? NONE_KEY;
        this._peers.set(message.tabId, {
            tabId: message.tabId,
            // `adoptedFrom` is absent in a message from an older deploy, and reads as "no
            // adoption", which is that deploy's own behaviour (fileoverview, 3).
            key: { kind: key.kind, atlasId: key.atlasId ?? null, adoptedFrom: key.adoptedFrom ?? null },
            claimedAt: message.claimedAt,
            lastSeen: this._now()
        });
    }

    /**
     * A takeover request from a peer whose key collides with this tab's: stop for real, THEN
     * retract, so the requester's unblock is evidence and not an assumption.
     * @param {Object} message
     * @returns {Promise<void>}
     */
    async _handleTakeover(message) {
        if (!keysCollide(this._key, message.key)) return;
        const surrendered = this._key;
        // Unconditional, including when this tab is already blocked: `_enterBlocked` then adds no
        // second stop and simply awaits the one in flight. Yielding on the `blocked` flag alone
        // acked a stop that had only STARTED, which is the assumption the handoff exists to avoid.
        await this._enterBlocked({
            tabId: message.tabId,
            key: message.key,
            claimedAt: message.claimedAt
        });
        this._yielded = true;
        this._yieldedKey = surrendered;
        this._key = noneKey();
        this._claimedAt = this._now();
        this._post(Msg.YIELD, message.tabId);
        this._renderOverlay(surrendered);
    }

    /**
     * An unmount notice: some tab is about to destroy the databases named in `addresses`. Ask the
     * effect whether THIS tab was writing to one of them, wait for it to stop, and only then ack.
     *
     * The ack is posted whatever the answer, including when there is no handler at all (the three
     * pages without a map), because the sender waits for one ack per live peer and silence would
     * cost it the whole timeout for nothing.
     *
     * @param {Object} message
     * @returns {Promise<void>}
     */
    async _handleTeardown(message) {
        const addresses = (Array.isArray(message.addresses) ? message.addresses : [])
            .filter(address => typeof address === 'string');

        let frozen = false;
        if (addresses.length > 0 && this._onTeardown && !this._frozen) {
            try {
                frozen = (await this._onTeardown(addresses)) === true;
            } catch (error) {
                // A freeze that throws must not ack as if it had stopped: `frozen` stays false,
                // the sender finds the namespace still mounted, and spares it.
                console.error('[tab-lock] onTeardown failed:', error);
                frozen = false;
            }
        }
        if (this._destroyed) return;

        this._post(Msg.TEARDOWN_ACK, message.tabId, { frozen });
        if (frozen) this._enterFrozen(message);
    }

    /**
     * Pins this tab out of service after its databases were reported doomed: it retracts the key
     * (it holds no atlas any more, and keeping the claim would lock every other tab out of an
     * atlas nobody has), shows the frozen overlay, and never leaves the blocked state again.
     * @param {Object} message - The notice that caused it, for the blocker record.
     * @returns {void}
     */
    _enterFrozen(message) {
        const surrendered = this._key;
        this._frozen = true;
        this._blocked = true;
        this._blocker = {
            tabId: message.tabId,
            key: message.key ?? NONE_KEY,
            claimedAt: message.claimedAt
        };
        this._key = noneKey();
        this._claimedAt = this._now();
        this._post(Msg.RELEASE);
        this._renderOverlay(surrendered);
        this._emit();
    }

    /**
     * @returns {Array<TabLockClaim & {lastSeen: number}>} Peers heard from recently. Expiring
     * here (and not on a timer) is what makes a tab that died without a RELEASE recoverable.
     */
    _livePeers() {
        const cutoff = this._now() - this._peerTtlMs;
        const live = [];
        for (const [tabId, peer] of this._peers) {
            if (peer.lastSeen < cutoff) {
                this._peers.delete(tabId);
                continue;
            }
            live.push(peer);
        }
        return live;
    }

    /** Runs the predicate and moves this tab into or out of the blocked state. @returns {void} */
    _evaluate() {
        if (this._degraded || this._destroyed) return;
        const self = { tabId: this._tabId, key: this._key, claimedAt: this._claimedAt };
        const blocker = findBlockingPeer(self, this._livePeers());

        if (blocker && !this._blocked) {
            this._enterBlocked(blocker);
            return;
        }
        // A FROZEN TAB NEVER LEAVES, and this guard is load-bearing rather than defensive: the
        // freeze retracts the key, and `syncEngine.disconnect()` inside the brake fires the very
        // key-change listener that calls back in here. Without it the tab would find no blocker,
        // resume, and reconnect to an atlas whose databases are being deleted.
        if (!blocker && this._blocked && !this._yielded && !this._frozen) {
            this._leaveBlocked();
        }
    }

    /**
     * @param {TabLockClaim} blocker
     * @returns {Promise<void>} Resolves once `onBlocked` has finished, which is what a yield
     * awaits before retracting. Re-entrant: a tab that is already blocked keeps its blocker and
     * its single running stop, so the sync is never stopped twice and never acked early.
     */
    async _enterBlocked(blocker) {
        if (this._blocked) {
            await this._blockingPromise;
            return;
        }
        this._blocked = true;
        this._blocker = blocker;
        this._renderOverlay(this._key);
        this._emit();
        this._blockingPromise = this._onBlocked ? this._runBlockedEffect() : null;
        await this._blockingPromise;
    }

    /**
     * Runs the stop handler, swallowing its failure: a brake that throws must not leave the tab
     * half-blocked, and must not reject the promise a yield is awaiting.
     * @returns {Promise<void>}
     */
    async _runBlockedEffect() {
        try {
            await this._onBlocked?.();
        } catch (error) {
            console.error('[tab-lock] onBlocked failed:', error);
        }
    }

    /** @returns {void} */
    _leaveBlocked() {
        this._blocked = false;
        this._blocker = null;
        this._blockingPromise = null;
        this._hideOverlay();
        this._emit();
        try {
            const result = this._onResumed?.();
            if (result && typeof result.catch === 'function') {
                result.catch((error) => console.error('[tab-lock] onResumed failed:', error));
            }
        } catch (error) {
            console.error('[tab-lock] onResumed failed:', error);
        }
    }

    /** @returns {void} */
    _emit() {
        const status = {
            blocked: this._blocked,
            key: this._key,
            blocker: this._blocker,
            degraded: this._degraded
        };
        for (const listener of this._listeners) {
            try {
                listener(status);
            } catch (error) {
                console.error('[tab-lock] listener failed:', error);
            }
        }
    }

    /**
     * @param {number} ms
     * @returns {Promise<void>}
     */
    _wait(ms) {
        return new Promise((resolve) => {
            const timer = setTimeout(resolve, ms);
            trackTimer(this, timer, 'timeout');
        });
    }

    // ------------------------------------------------------------------ overlay

    /**
     * Builds (once) and shows the blocking overlay. Text is set with `textContent`; the only
     * markup is the static icon.
     *
     * TWO STATES, ONE OVERLAY. Blocked means "another tab has this atlas", and the way out is the
     * handoff. Frozen means "the databases of this tab are being destroyed", and there is no
     * handoff out of that: the only honest offer is a reload.
     * @param {TabLockKey} key - Key whose kind decides the wording of the blocked state.
     * @returns {void}
     */
    _renderOverlay(key) {
        if (!this._overlayHost) return;
        if (!this._overlay) this._overlay = this._buildOverlay();
        this._title.textContent = this._frozen ? TEARDOWN_OVERLAY.title : BLOCKED_OVERLAY.title;
        this._message.textContent = this._frozen
            ? TEARDOWN_OVERLAY.message
            : (OVERLAY_TEXT[key?.kind] ?? OVERLAY_TEXT[TabLockKeyKind.REMOTE]);
        this._button.textContent = this._frozen ? TEARDOWN_OVERLAY.button : BLOCKED_OVERLAY.button;
        this._button.disabled = false;
        this._overlay.classList.add('tab-lock-overlay--visible');
    }

    /** @returns {void} */
    _hideOverlay() {
        this._overlay?.classList.remove('tab-lock-overlay--visible');
    }

    /** @returns {HTMLElement} */
    _buildOverlay() {
        const doc = this._overlayHost.ownerDocument;
        const el = doc.createElement('div');
        el.className = 'tab-lock-overlay';

        const card = doc.createElement('div');
        card.className = 'tab-lock-overlay__card';

        const icon = doc.createElement('div');
        icon.className = 'tab-lock-overlay__icon';
        icon.innerHTML = MONITOR_ICON;

        const title = doc.createElement('h2');
        title.className = 'tab-lock-overlay__title';
        title.textContent = BLOCKED_OVERLAY.title;

        const message = doc.createElement('p');
        message.className = 'tab-lock-overlay__message';

        const button = doc.createElement('button');
        button.className = 'tab-lock-overlay__button';
        button.type = 'button';
        button.textContent = BLOCKED_OVERLAY.button;
        addDomListener(this, button, 'click', () => {
            // The handler branches instead of being replaced: the listener is registered once,
            // through the cleanup registry, and swapping it would leak the previous one.
            if (this._frozen) {
                button.disabled = true;
                globalThis.location?.reload?.();
                return;
            }
            button.disabled = true;
            this.requestTakeover().finally(() => {
                button.disabled = false;
            });
        });

        card.append(icon, title, message, button);
        el.appendChild(card);
        this._overlayHost.appendChild(el);
        this._title = title;
        this._message = message;
        this._button = button;
        return el;
    }
}

/**
 * Creates an independent tab-lock participant. Used directly by tests (two instances on one
 * fake transport); pages use the singleton below.
 * @param {Object} [options] - See the `TabLock` constructor.
 * @returns {TabLock}
 */
export function createTabLock(options = {}) {
    return new TabLock(options);
}

/** @type {TabLock|null} */
let _instance = null;

/**
 * Initializes the page's tab lock. Idempotent (HMR safe).
 * @param {Object} [options] - See the `TabLock` constructor. With no key the tab holds
 *   nothing and never blocks anybody, which is the state of every page until the integration
 *   passes a real key.
 * @returns {TabLock}
 */
export function initTabLock(options = {}) {
    if (!_instance) _instance = new TabLock(options);
    return _instance;
}

/** @returns {TabLock|null} The page's tab lock, or null before `initTabLock`. */
export function getTabLock() {
    return _instance;
}

/**
 * Claims a key on the page's lock and reports whether this tab may proceed.
 * @param {TabLockKey} key
 * @param {{settleMs?: number}} [options]
 * @returns {Promise<{granted: boolean, blockedBy: TabLockClaim|null, degraded: boolean}>}
 */
export function acquireTabLock(key, options = {}) {
    if (!_instance) initTabLock();
    return _instance.acquire(key, options);
}

/**
 * Announces a live key change (login, save-to-server, logout, lost session).
 * @param {TabLockKey} key
 * @returns {boolean} True when this tab is blocked right after the change.
 */
export function setTabLockKey(key) {
    if (!_instance) initTabLock();
    return _instance.setKey(key);
}

/**
 * Attaches the effect handlers to the page's lock. The sync brake calls this
 * (`installTabLockSyncBrake` in `store/sync/tab-lock-sync-brake.js`), which is how blocking gets
 * to stop the sync without this module importing the store.
 * @param {{onBlocked?: (() => (void|Promise<void>))|null,
 *   onResumed?: (() => (void|Promise<void>))|null}} [handlers]
 * @returns {Promise<void>} Resolves once a catch-up stop (tab already blocked) has finished.
 */
export function setTabLockEffects(handlers = {}) {
    if (!_instance) initTabLock();
    return _instance.setEffects(handlers);
}

/**
 * Announces that these database addresses are about to be destroyed, and waits for the tabs
 * writing to them to stop (section 8). Every path that means "the session is over" calls it
 * BEFORE it empties or destroys anything; both of them reach it through
 * `store/store.js discardRemoteAtlasNamespaces`.
 *
 * IT DOES NOT BECOME THE PAGE'S LOCK, and it used to answer `degraded: true` and warn nobody when
 * there was none. That silence had a real victim: the logged-out BOOT GUARD runs the same
 * destructive sweep as the logout, and it runs INSIDE the store boot, which `index.js` finishes
 * before it calls `initTabLock`. So the one caller that most needed the notice was structurally
 * incapable of sending it, and a one-line "just announce here too" fix would have been a call that
 * returns a report and posts nothing.
 *
 * What it does instead is join the channel as a THROWAWAY participant: `none` key (it holds no
 * atlas, so it collides with nobody and blocks nobody), no overlay, no heartbeat, destroyed in the
 * `finally`. It is never stored in `_instance`, because the page that owns the real configuration
 * has not spoken yet and inheriting the defaults here would mount an overlay on `document.body`
 * behind its back.
 *
 * IT HAS TO LET THE PEERS ANSWER FIRST, and it does that in TURNS OF THE EVENT LOOP, never with a
 * timer. `announceTeardown` waits for one ack per peer it KNOWS ABOUT, and a participant born a
 * microsecond ago knows about nobody, so with no pause at all it would post the notice, count zero
 * peers and return: the same silence in a louder shape. A `setTimeout` pause was the obvious fix
 * and the wrong one, because this runs inside a logout and inside a boot, both of which are driven
 * by harnesses that freeze the clock, and a settle that waits on a frozen timer does not delay the
 * sweep, it hangs it. A BroadcastChannel delivery IS a task, so turns are also the honest unit.
 *
 * WHAT THAT BUYS AND WHAT IT DOES NOT. In one process (and for a responsive peer, which also has
 * the whole of the caller's registry reads to answer in) the round trip lands inside a handful of
 * turns. A peer too busy to answer in that window is simply not waited for: it still RECEIVES the
 * notice and freezes a moment later, and the destruction it might have raced is still gated by its
 * mount lock, which spares the namespace. Silence degrading to "spared" is the same safe direction
 * the whole protocol is built on (section 8).
 *
 * @param {string[]} addresses - `dbSuffix` values about to be destroyed.
 * @param {{timeoutMs?: number}} [options]
 * @returns {Promise<{addresses: string[], peers: number, acked: number, frozen: number,
 *   timedOut: boolean, degraded: boolean}>}
 */
export function announceTabLockTeardown(addresses, options = {}) {
    if (_instance) return _instance.announceTeardown(addresses, options);
    return announceTeardownWithoutPage(addresses, options);
}

/**
 * One turn of the event loop, without a timer (see {@link announceTabLockTeardown}).
 * @returns {Promise<void>}
 */
function nextTurn() {
    return new Promise(resolve => {
        const channel = new MessageChannel();
        channel.port1.onmessage = () => {
            channel.port1.close();
            resolve();
        };
        channel.port2.postMessage(0);
    });
}

/**
 * How many turns the throwaway announcer gives the peers to state their claim. Generous because a
 * turn costs microseconds when nobody answers, and the loop stops at the first peer anyway.
 */
const PEER_DISCOVERY_TURNS = 20;

/**
 * The throwaway announcer described in {@link announceTabLockTeardown}.
 * @param {string[]} addresses - `dbSuffix` values about to be destroyed.
 * @param {{timeoutMs?: number}} [options]
 * @returns {Promise<{addresses: string[], peers: number, acked: number, frozen: number,
 *   timedOut: boolean, degraded: boolean}>}
 */
async function announceTeardownWithoutPage(addresses, { timeoutMs } = {}) {
    const list = normalizeTeardownAddresses(addresses);
    // Nothing to say, so nothing is built: this is the ordinary case (no server namespace has
    // ever been registered on this machine) and it must cost neither a channel nor a turn.
    if (list.length === 0) return emptyTeardownReport(list, false);

    // The constructor posts the HELLO, so the peers are already answering while this waits.
    const announcer = new TabLock({ key: noneKey(), overlayHost: null, autoPulse: false });
    try {
        if (announcer.degraded) return emptyTeardownReport(list, true);
        for (let turn = 0; turn < PEER_DISCOVERY_TURNS && announcer.peers().length === 0; turn++) {
            await nextTurn();
        }
        return await announcer.announceTeardown(
            list,
            timeoutMs === undefined ? {} : { timeoutMs }
        );
    } finally {
        announcer.destroy();
    }
}

/** Retracts the key (403/404, or any revert to holding nothing). @returns {void} */
export function releaseTabLock() {
    _instance?.release();
}

/** @returns {boolean} True when this tab lost the arbitration. */
export function isTabLockBlocked() {
    return _instance?.blocked ?? false;
}

/** @returns {boolean} True when an unmount notice stopped this tab for good (section 8). */
export function isTabLockFrozen() {
    return _instance?.frozen ?? false;
}

/**
 * @param {(status: {blocked: boolean, key: TabLockKey, blocker: TabLockClaim|null,
 *   degraded: boolean}) => void} listener
 * @returns {() => void} Unsubscribe.
 */
export function onTabLockChange(listener) {
    if (!_instance) initTabLock();
    return _instance.subscribe(listener);
}

/** Tears the page's lock down (tests, teardown). @returns {void} */
export function destroyTabLock() {
    _instance?.destroy();
    _instance = null;
}
