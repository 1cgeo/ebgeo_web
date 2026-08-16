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
 *             `addresses` (a list of `dbSuffix`) plus a `reason`, never a key. See section 8.
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
 * AND AN AWAITED `acquire()` WAS STILL NOT ENOUGH, which is the correction this section carries.
 * The settle answers by ABSENCE: nobody objected, therefore nobody is there. Three ordinary things
 * produce that silence with a peer very much alive — two settles that overlap (both tabs are
 * granted, and the total order then blocks one AFTER its wipe has run), a peer whose main thread is
 * busy for longer than the settle (200 ms of render or import against a 300 ms window is a coin
 * toss, and boot makes it worse), and a single dropped message on the localStorage bus. The total
 * order repairs the STATE in all three; it cannot repair databases that are already empty.
 *
 * So `acquire()` takes a WITNESS, and a destructive caller must pass one. The witness answers from
 * a fact of the browser rather than from the channel: the store takes a SHARED Web Lock on every
 * namespace it MOUNTS (`store/atlas-namespace.js`, Decision 5), a Web Lock is released by the
 * DEATH of the client and never by its silence, and `otherClientHoldsLock` counts the holds that
 * are not this client's. A frozen tab, a throttled tab and a tab whose message was dropped are all
 * indistinguishable from a dead one on the channel, and all three still hold the lock.
 *
 * WHY NOT REPLACE THE SETTLE WITH IT, which is the tempting simplification. The two answer
 * different questions and each is blind where the other sees. The lock says "somebody has these
 * databases open" but not WHO, so it cannot name a blocker, cannot order two claims, cannot drive
 * the overlay or "Usar aqui", and cannot distinguish this tab from another when this tab is one of
 * the holders (which it always is for the wipe of the atlas it has mounted — hence `selfHolds`).
 * The channel says exactly who and in what order, and lies by silence. Keeping both, with a
 * refusal from either one refusing the grant, is what makes the grant mean something; and where
 * the browser cannot answer at all (plain HTTP has no `navigator.locks`) the settle is still
 * there, degraded but not absent.
 *
 * THE ALTERNATIVE NOT TAKEN was a REVERSIBLE wipe (snapshot the ten databases, wipe, restore if
 * the claim turns out to be contested). It is strictly stronger: it needs no evidence at all,
 * because it survives being wrong. It was rejected on cost, and the cost is not the code — it is
 * copying an image blob store on every boot of every tab, to insure against a race, in a module
 * whose whole design is to make that race not happen. If the witness is ever found insufficient,
 * that is the next move, not a longer settle.
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
 *   LEAVE     `pagehide`/`beforeunload` post RELEASE and close the channel — UNLESS `persisted`
 *             says the page is going into the BFCACHE, which is not a departure at all, see the
 *             fence below.
 *   DEATH     a tab that dies without saying anything (crash, kill, sleep) is detected by
 *             ABSENCE: every tab heartbeats a STATE every HEARTBEAT_MS, and a peer unheard of
 *             for PEER_TTL_MS is dropped from the registry, which re-runs the predicate and
 *             releases whoever was waiting on it. The old lock had no heartbeat and no exit
 *             message, so closing the owner tab left the other one blocked forever.
 *
 * THE FENCE: ABSENCE IS NOT DEATH, AND EVICTION IS NOT FINAL BY ITSELF. This paragraph used to
 * read DEATH as if the TTL sweep settled the matter. It does not, because the thing being expired
 * is usually not dead: a suspended OS, a sleeping machine, a page in the bfcache and a main thread
 * busy past the TTL all look exactly like a crash from the outside, and all of them come BACK,
 * holding the `claimedAt` they had before. The old claim precedes again, wins the total order
 * again, and the tab resumes writing over databases the peer already took and wiped, without its
 * own `onBlocked` ever having run. Neither side can fix that alone, so both do their half:
 *
 *   the EVICTOR remembers the claim it expired (`_evictedClaims`) and denies THAT claim its
 *   standing once, so one stale re-announcement cannot push out the tab that legitimately took
 *   over. The denial is consumed on first use, because an eviction can be wrong (dropped
 *   messages, a peer that never left) and a permanent veto would leave two tabs each believing it
 *   owns the atlas, with nothing left to correct it;
 *
 *   the EVICTED tab measures its own absence — the protocol did not run for longer than the TTL
 *   (`_fenceAfterSilence`) — and re-enters the order as a NEWCOMER, with a fresh stamp and a
 *   HELLO. From there the ordinary path does the rest: the peer that took over now precedes it,
 *   so it blocks, stops for real and gets the ordinary overlay with the ordinary way back.
 *
 * The bfcache is the same silence in a different shape, which is why it needs no separate rule:
 * `pagehide` with `persisted` posts nothing (a cached page is coming back, and handing its atlas
 * away is exactly wrong), and `pageshow` with `persisted` speaks at once instead of waiting for
 * the next heartbeat, letting the same fence decide whether the claim survived the stay.
 *
 * WHAT NEITHER HALF COVERS: if the evictor is gone by the time the frozen tab wakes, nobody
 * arbitrates and the tab resumes over databases wiped by a tab that no longer exists. That one
 * needs a monotonic epoch PERSISTED per atlas, which is a store concern, and this module reaches
 * no store (section 7).
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
 * AND IT IS A HANDOFF FOR THE TAB THAT YIELDS TOO, which took a second pass to become true. The
 * request reaches every tab holding a colliding key, which is the right address (only one of them
 * is unblocked, but sending only to that one would let a THIRD tab win the order the moment the
 * winner steps aside, so "Usar aqui" would hand the atlas to a tab nobody clicked). What was
 * missing was the way back: a tab that yielded kept `_yieldedKey` and stayed out of the order for
 * good, so the winner closing left it blocked for ever, in front of an overlay naming a tab that
 * no longer existed, and a tab that was never addressed paid the same price for somebody else's
 * click. It now RE-ADOPTS the surrendered key as soon as no standing peer collides with it
 * (`_reclaimYieldedKey`), with a fresh stamp, so it comes back as a newcomer and the ordinary
 * order decides between two tabs that come back together.
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
 * TWO THINGS DESTROY A NAMESPACE, AND THE NOTICE CARRIES WHICH (`reason`). One is the logout
 * sweep described above; the other is a user deleting a named LOCAL atlas on `projetos.html`
 * (`store/local-atlas.api.js deleteLocalAtlas`). The protocol is the same for both, and so is the
 * effect: the receiver stops and KEEPS its mount lock. What differs is the only thing the receiver
 * shows a human, the overlay, and it was WRONG for the second case — "outra aba saiu da conta" and
 * "projeto do servidor" are both false for a local atlas somebody deleted. The field is ADDITIVE,
 * so it does NOT bump the protocol version, for the reason `adoptedFrom` did not: a tab from an
 * older deploy reads a notice with no reason as the session-ended case, which is that deploy's only
 * case, whereas invisibility would cost it the freeze entirely.
 *
 * WHAT THE NOTICE BUYS ON THE LOCAL PATH IS DIFFERENT, and saying so is the point of writing it
 * down. On the remote path the mount lock is what SPARES the sibling's databases, and the notice
 * merely tells it. A local deletion is not gated by that lock (`deleteLocalAtlas` drops the
 * databases, and nothing ever retries a local drop, so sparing there would mean abandoning them
 * outside the registry forever) — so what the notice buys is that the sibling STOPS BEFORE the
 * drop lands. Without it the sibling's next write RECREATES those databases, now named by no
 * registry, which is exactly the residue this whole design exists to prevent.
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
 * degrades to OFF, and says so THREE ways: a `console.warn`, `degraded: true` on the public
 * status, and a banner the user actually sees (`_syncDegradedNotice`). Off and audible, never
 * off and quiet.
 *
 * THE BANNER IS NOT OPTIONAL DECORATION, and this paragraph used to end at "so a caller can
 * badge it", an invitation that no caller ever accepted, which left the only user-visible
 * signal in the developer console. It matters more since the remote x remote hold was removed:
 * this is now the ONLY mechanism separating two tabs in the SAME atlas, so a silent degraded
 * mode is a user with two tabs writing to the same databases and no way to know.
 *
 * It appears only while the tab HOLDS AN ATLAS (a `none` key collides with nobody, so the three
 * pages without a map stay clean), it is dismissible and does not come back once dismissed
 * (nothing here can fix a browser with neither transport, so repeating is nagging), and it is a
 * banner rather than the overlay because the lock fails OPEN here: taking the app away would
 * turn a missing browser feature into an outage.
 *
 * ===========================================================================
 * 10. PUBLIC API (other agents wire this; nothing here integrates itself)
 * ===========================================================================
 * Pure, for callers and tests: `TabLockKeyKind`, `TeardownReason`, `noneKey`, `localAtlasKey`,
 * `remoteAtlasKey`,
 * `keysCollide`, `compareClaims`, `findBlockingPeer`, `otherClientHoldsLock` (the witness
 * primitive of section 5; the caller supplies the LockManager and the lock name, so this module
 * still knows nothing about databases).
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
 * over. The open holes are enumerated in `frontend/tests/TESTING-BACKLOG.md`, section
 * "Furos abertos do tab-lock", each with its reproduction in
 * `frontend/tests/unit/tab-lock-refutacao.test.js` as an `it.todo`. The ones that change how you
 * should read the sections above:
 *
 *   - THE WITNESS IS ONLY AS GOOD AS THE CALLER THAT PASSES ONE. `acquire()` no longer grants on
 *     silence alone (section 5), but a caller that omits the `witness` gets the old answer, and
 *     a runtime with no `navigator.locks` (plain HTTP) has no fact to read. Adding a fifth wipe
 *     without a witness reopens the hole in that one path, silently.
 *   - THE FENCE HAS NO EPOCH, so it reaches exactly as far as the peers do. Section 6 describes
 *     the two halves that close the ordinary case (the evictor denies the stale claim once, the
 *     woken tab re-enters as a newcomer). Both need somebody to still be there: a tab that was
 *     evicted and comes back after the EVICTOR has closed finds an empty channel, is granted its
 *     claim, and writes over databases the evictor wiped. Only a monotonic epoch persisted per
 *     atlas answers that, and this module reaches no store.
 *   - THE BFCACHE PROOF IS A NODE PROOF. `pagehide`/`pageshow` now read `persisted` and the
 *     restored tab re-announces at once, but the Playwright runner starts Chromium with the
 *     bfcache DISABLED (measured by case B0 of
 *     `frontend/tests/e2e-ui/browser-multi-tab-teardown-queue.spec.js`), so what is measured is
 *     the handler, with the events dispatched by hand, not the browser window it exists for.
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

/**
 * WHY a set of database addresses is about to be destroyed (section 8). It travels in the notice
 * and decides the wording of the frozen overlay, nothing else: the receiver's effect is the same
 * for both, and a receiver that does not recognise the value falls back to the session-ended
 * wording, which is the one an older deploy would have shown anyway.
 */
export const TeardownReason = Object.freeze({
    /** A logout (or the logged-out boot guard) sweeping every server namespace on this machine. */
    SESSION_ENDED: 'session-ended',
    /** The user deleted a named LOCAL atlas on `projetos.html`. */
    LOCAL_ATLAS_DELETED: 'local-atlas-deleted'
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

/**
 * Wording of the OTHER destruction, a named local atlas deleted in "Seus atlas".
 *
 * It says the opposite of the one above about what a reload costs, and correctly: there is no
 * unsent work to preserve here, because the user asked for these very databases to go and the
 * deletion is not waiting on this tab's mount lock. Reusing the session-ended text told the user
 * their session had ended (it had not) and that reloading would discard work (there is none),
 * which is worse than saying nothing.
 */
const TEARDOWN_OVERLAY_LOCAL_DELETED = Object.freeze({
    title: 'Este atlas local foi excluído',
    message: 'Outra aba deste navegador excluiu o atlas que estava aberto aqui, então esta aba '
        + 'parou de gravar: o que ainda aparece na tela já não existe neste computador. Recarregue '
        + 'para continuar em outro atlas.',
    button: 'Recarregar'
});

/** Frozen-overlay wording by `TeardownReason`. An unknown reason falls back to session-ended. */
const TEARDOWN_OVERLAY_BY_REASON = Object.freeze({
    [TeardownReason.SESSION_ENDED]: TEARDOWN_OVERLAY,
    [TeardownReason.LOCAL_ATLAS_DELETED]: TEARDOWN_OVERLAY_LOCAL_DELETED
});

/**
 * Wording of the DEGRADED state (section 9): no transport, so the arbitration is OFF.
 *
 * IT NAMES THE ACTION, because there is nothing this code can do about it. Every other state of
 * this module ends in a button that fixes something ("Usar aqui", "Recarregar"); this one ends in
 * a habit the user has to adopt, so a message that only described the failure ("a arbitragem está
 * desligada") would leave them with a warning and no move. The two halves are deliberate: what
 * stopped working, then the single instruction that replaces it.
 *
 * AND IT IS NOT AN OVERLAY. The lock fails OPEN here on purpose, so the tab keeps working; a
 * modal that swallowed the map would turn a missing browser feature into an outage. A banner is
 * the honest shape: visible, dismissible, and it does not take the app away.
 */
const DEGRADED_NOTICE = Object.freeze({
    title: 'Proteção contra abas duplicadas indisponível',
    message: 'Este navegador não deixa as abas do EBGeo se enxergarem, então nada impede que o '
        + 'mesmo projeto seja aberto duas vezes aqui. Feche as outras abas do EBGeo e trabalhe '
        + 'em uma só: duas abas no mesmo projeto gravam nos mesmos dados, e a última a gravar '
        + 'apaga o trabalho da outra.',
    button: 'Entendi'
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
 * ASKS THE BROWSER, NOT THE CHANNEL: does a live client other than this one hold `lockName`?
 *
 * This is the primitive `acquire()` leans on to stop granting by absence of proof (fileoverview,
 * 5). A Web Lock is a FACT of the user agent: it is released by the DEATH of the client and never
 * by its silence, so a peer that is frozen, throttled, or whose message was dropped still holds
 * it. Nothing here waits on a clock, so nothing here can be outrun by a slow answer.
 *
 * IT COUNTS, IT DOES NOT PROBE. An `exclusive ifAvailable` request answers "is anybody here",
 * which is the wrong question whenever the asker is itself one of the holders — and it always is
 * for the wipe of the atlas this tab has MOUNTED, since mounting takes a SHARED lock on that same
 * name (`store/atlas-namespace.js`, Decision 5). So the caller states how many holds are its own
 * (`selfHolds`) and anything above that is somebody else. The caller can state it because the
 * store keeps at most ONE mount lock per client: 1 for the scope this tab has mounted, 0 for any
 * other address.
 *
 * `pending` is counted with `held`: a shared request that has not been granted yet is still a live
 * client on its way in, and reading it as absence is the failure this function exists to remove.
 *
 * UNKNOWN IS A REAL ANSWER, and it is `null`. Where there is no LockManager (a NON-SECURE context,
 * i.e. plain HTTP) or `query()` refuses, there is no fact to read, and inventing one in either
 * direction is worse than saying so: "occupied" would deadlock every open on a runtime quirk,
 * "free" would be the silence this replaces. The caller falls back to the settle and says so.
 *
 * @param {{query: () => Promise<{held?: Array<{name: string}>, pending?: Array<{name: string}>}>}
 *   |null|undefined} locks - A `LockManager` (`navigator.locks`), or null where there is none.
 * @param {string} lockName - Name of the lock that means "a live client is using these databases".
 * @param {number} [selfHolds] - How many of the holds on that name belong to THIS client.
 * @returns {Promise<boolean|null>} True when another live client holds it, false when none does,
 *   null when this runtime cannot tell.
 */
export async function otherClientHoldsLock(locks, lockName, selfHolds = 0) {
    if (!locks || typeof locks.query !== 'function') return null;
    if (typeof lockName !== 'string' || lockName.length === 0) return null;

    let snapshot;
    try {
        snapshot = await locks.query();
    } catch {
        return null;
    }
    if (!snapshot) return null;

    const entries = [...(snapshot.held ?? []), ...(snapshot.pending ?? [])];
    const holds = entries.filter(entry => entry?.name === lockName).length;
    return holds > Math.max(0, selfHolds);
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
     * @param {((addresses: string[], context: {reason: string}) => (boolean|Promise<boolean>))}
     *   [options.onTeardown] - Wire it to `applyTeardownFreeze`
     *   (`store/sync/tab-lock-sync-brake.js`). It answers whether this tab held one of those
     *   database addresses AND has stopped writing (section 8). `reason` is a `TeardownReason`,
     *   passed for the effect's own diagnostics; the overlay wording is decided here.
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
        /** @type {{title: string, message: string, button: string}|null} Frozen wording, by reason. */
        this._teardownText = null;
        /** @type {Map<string, boolean>|null} Acks of the notice in flight, by peer tab id. */
        this._teardownAcks = null;
        /** @type {Promise<void>|null} The stop currently running, or the one that already ran. */
        this._blockingPromise = null;

        /**
         * @type {Map<string, number>} Claims this tab EXPIRED by TTL, by peer tab id. A tab that
         * was merely FROZEN keeps its old `claimedAt`, so its first message back would precede
         * again and push out the peer that legitimately took the atlas over. The record is what
         * denies that one stale re-announcement its standing (section 6, THE FENCE).
         */
        this._evictedClaims = new Map();
        /**
         * Last instant this tab ran the protocol. A gap wider than the TTL means the tab itself
         * was away, which is the only thing it can observe about its own absence (section 6).
         */
        this._lastTickAt = this._birth;

        /** @type {HTMLElement|null} The degraded-mode banner, built on first showing. */
        this._degradedNotice = null;
        /** True once the user acknowledged the banner. It never comes back (section 9). */
        this._degradedDismissed = false;

        this._transport = createTransport(channelName);
        this._degraded = !this._transport;
        if (this._degraded) {
            console.warn(
                '[tab-lock] No BroadcastChannel and no localStorage: multi-tab arbitration is '
                + 'OFF in this tab. Two tabs may end up in the same atlas.'
            );
            // The console line was the ONLY signal for one phase, and nothing badged it, which
            // made "off and audible" true for a developer and false for the user. The notice is
            // evaluated here as well as on every key change because a tab can boot straight into
            // an atlas: `initTabLock({ key: currentAtlasLockKey() })` never goes through `setKey`.
            this._syncDegradedNotice();
            return;
        }

        // Installed BEFORE anything is posted: a tab is never silent (fileoverview, 4a).
        this._transport.setReceiver((message) => this._onMessage(message));

        if (typeof window !== 'undefined' && window.addEventListener) {
            // `pagehide` FIRES FOR THE BFCACHE TOO, and `persisted` is the whole difference: the
            // page is being FROZEN INTACT, not unloaded, and it can be restored at any moment with
            // its key, its peers and its store exactly as they were. Announcing a departure there
            // hands the atlas away on behalf of a tab that is coming back (section 6, THE FENCE).
            const leave = (event) => {
                if (event?.persisted === true) return;
                this._postLeave();
            };
            addDomListener(this, window, 'pagehide', leave);
            // `beforeunload` carries no `persisted` and does not fire on the way into the cache,
            // so it reads as a real departure, which is what it is.
            addDomListener(this, window, 'beforeunload', leave);
            addDomListener(this, window, 'pageshow', (event) => this._handlePageShow(event));
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
     *
     * THE GRANT IS NO LONGER DECIDED BY SILENCE ALONE. Two independent things must agree:
     *
     *   1. the total order over the claims this tab HEARD (the settle, the peer registry), and
     *   2. the `witness`, which reads a FACT of the browser instead of listening for a message.
     *
     * A refusal from either one refuses the grant, and `deniedBy` says which. The witness is what
     * closes the three faces of "granted by absence of proof": two settles that overlap, a peer
     * whose main thread is busy for longer than the settle, and a single lost message. None of
     * them can silence a Web Lock (see {@link otherClientHoldsLock} and the fileoverview, 5).
     *
     * IT IS INJECTED, NOT IMPORTED, for the reason section 7 gives about `onBlocked`: the fact
     * worth reading is "another live client has these DATABASES mounted", and the databases live
     * in the store, which this module must never reach. `account/open-atlas.service.js` builds the
     * witness from the store's own mount lock and hands it in.
     *
     * WITHOUT A WITNESS THE BEHAVIOUR IS EXACTLY WHAT IT WAS, deliberately: a caller that is not
     * about to destroy anything has nothing to gain from the extra round trip, and the settle
     * remains a courtesy that the total order corrects afterwards.
     *
     * AND IT IS ASKED EVEN WHEN THE TRANSPORT IS MISSING (section 9). Degraded mode has no channel
     * and therefore no roster at all, so the witness is the only arbitration left there; skipping
     * it would throw away the one answer that still works.
     *
     * @param {TabLockKey} key
     * @param {{settleMs?: number, witness?: (() => Promise<boolean|null>)|null}} [options] -
     *   `witness` answers "is another live client using the databases this claim names": true
     *   refuses the grant, false clears it, null (or absent) leaves the decision to the settle.
     * @returns {Promise<{granted: boolean, blockedBy: TabLockClaim|null, degraded: boolean,
     *   deniedBy: string|null}>} `deniedBy` is `'peer'` (the order), `'witness'` (the browser
     *   fact), `'destroyed'`, or null when the claim was granted.
     */
    async acquire(key, { settleMs = this._settleMs, witness = null } = {}) {
        this.setKey(key);
        if (this._destroyed) return this._acquireResult('destroyed');

        if (!this._degraded) {
            await this._wait(settleMs);
            if (this._destroyed) return this._acquireResult('destroyed');
            this._evaluate();
        }
        if (this._blocked) return this._acquireResult('peer');

        // THE SECOND QUESTION, and it is asked HERE rather than by the caller just before the
        // wipe, because here it is still this module's business whether the claim stands. It
        // costs one microtask when there is no witness and one `query()` when there is.
        const occupied = await this._askWitness(witness);
        if (this._destroyed) return this._acquireResult('destroyed');
        // The order may have moved while the witness was answering: re-read it rather than
        // trusting the value captured before the await.
        if (this._blocked) return this._acquireResult('peer');
        return this._acquireResult(occupied === true ? 'witness' : null);
    }

    /**
     * @param {string|null} deniedBy - Why the claim was refused, or null when it was granted.
     * @returns {{granted: boolean, blockedBy: TabLockClaim|null, degraded: boolean,
     *   deniedBy: string|null}}
     */
    _acquireResult(deniedBy) {
        return {
            granted: deniedBy === null,
            blockedBy: deniedBy === 'peer' ? this._blocker : null,
            degraded: this._degraded,
            deniedBy
        };
    }

    /**
     * Asks the injected witness, and normalises everything it can answer into three values.
     *
     * A WITNESS THAT THROWS ANSWERS "UNKNOWN", never "occupied". The witness is evidence of
     * PRESENCE, and a broken reader of that evidence is not presence: treating a failed `query()`
     * as a peer would turn a runtime quirk into an app that can never open a project, which
     * trades a data risk for an outage. Unknown falls back to the settle, which is the behaviour
     * of the deploy that had no witness at all — the same direction section 9 takes when the
     * transport is missing.
     * @param {(() => Promise<boolean|null>)|null|undefined} witness
     * @returns {Promise<boolean|null>} True/false, or null when there is nothing to read.
     */
    async _askWitness(witness) {
        if (typeof witness !== 'function') return null;
        try {
            const answer = await witness();
            return typeof answer === 'boolean' ? answer : null;
        } catch (error) {
            console.error('[tab-lock] witness failed:', error);
            return null;
        }
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
        // The degraded warning is tied to HOLDING AN ATLAS, not to the transport being missing:
        // a tab that holds nothing cannot collide with anybody, so warning it would be noise
        // right where the message has to be believed.
        this._syncDegradedNotice();
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
        // Holding nothing again: the banner goes with the claim it was about.
        this._syncDegradedNotice();
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
     * @param {{timeoutMs?: number, reason?: string}} [options] - `reason` is a `TeardownReason`;
     *   it decides the frozen overlay's wording in the receiver and nothing else.
     * @returns {Promise<{addresses: string[], peers: number, acked: number, frozen: number,
     *   timedOut: boolean, degraded: boolean}>} `frozen` counts the peers that reported they held
     *   one of the addresses and stopped.
     */
    async announceTeardown(addresses, {
        timeoutMs = this._teardownTimeoutMs,
        reason = TeardownReason.SESSION_ENDED
    } = {}) {
        const list = normalizeTeardownAddresses(addresses);
        const report = emptyTeardownReport(list, this._degraded);
        if (this._degraded || this._destroyed || list.length === 0) return report;

        const pending = new Set(this._livePeers().map(peer => peer.tabId));
        report.peers = pending.size;
        const acks = new Map();
        this._teardownAcks = acks;
        this._post(Msg.TEARDOWN, null, { addresses: list, reason });

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
        removeElement(this._degradedNotice);
        this._degradedNotice = null;
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
     * RESTORATION FROM THE BFCACHE, which is the other half of not announcing a departure on the
     * way in. A restored page resumes with everything it had, including a claim it stopped
     * defending the moment its timers were frozen: peers heard nothing from it while it sat in the
     * cache, and after PEER_TTL_MS they were right to expire it and take the atlas.
     *
     * So the tab speaks IMMEDIATELY instead of waiting for the next heartbeat, and the silence
     * fence (see `_fenceAfterSilence`) decides what it may say: a short stay keeps the claim
     * (nothing could have expired it), a stay longer than the TTL re-enters the order as a
     * NEWCOMER. The two cases share one rule because the cache is just a long silence.
     *
     * `persisted` is checked here for the same reason it is checked on the way out: a `pageshow`
     * without it is an ordinary load, whose HELLO the constructor has already posted.
     * @param {PageTransitionEvent|{persisted?: boolean}} [event]
     * @returns {void}
     */
    _handlePageShow(event) {
        if (event?.persisted !== true) return;
        if (this._degraded || this._destroyed) return;
        // The fence re-announces when it moves the claim, so a second HELLO is only posted when
        // it did not: the peers must hear this tab again either way.
        if (!this._fenceAfterSilence(this._now())) this._post(Msg.HELLO);
        this._evaluate();
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
        // THE INTENT IS RECORDED BEFORE THE STOP IS AWAITED, and the RETRACTION only after it.
        // The two used to happen together, on the far side of the await, and the gap between them
        // was a hole with three tabs: while this tab awaited its own stop, the YIELD of ANOTHER
        // holder arrived, `_evaluate` ran with `_yielded` still false and every colliding claim
        // already retracted, found no blocker, and UNBLOCKED the tab in the middle of
        // surrendering — resuming the very sync it was handing away. Marking first closes it,
        // and it costs nothing: `_evaluate` reads `_yielded` only to refuse to unblock, and the
        // re-adoption below is gated on this tab holding NOTHING, which is still false here.
        this._yielded = true;
        this._yieldedKey = surrendered;
        // Unconditional, including when this tab is already blocked: `_enterBlocked` then adds no
        // second stop and simply awaits the one in flight. Yielding on the `blocked` flag alone
        // acked a stop that had only STARTED, which is the assumption the handoff exists to avoid.
        await this._enterBlocked({
            tabId: message.tabId,
            key: message.key,
            claimedAt: message.claimedAt
        });
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
        // An older deploy sends no reason, and reads as the case that deploy had (section 8).
        const reason = typeof message.reason === 'string'
            ? message.reason
            : TeardownReason.SESSION_ENDED;

        let frozen = false;
        if (addresses.length > 0 && this._onTeardown && !this._frozen) {
            try {
                frozen = (await this._onTeardown(addresses, { reason })) === true;
            } catch (error) {
                // A freeze that throws must not ack as if it had stopped: `frozen` stays false,
                // the sender finds the namespace still mounted, and spares it.
                console.error('[tab-lock] onTeardown failed:', error);
                frozen = false;
            }
        }
        if (this._destroyed) return;

        this._post(Msg.TEARDOWN_ACK, message.tabId, { frozen });
        if (frozen) this._enterFrozen(message, reason);
    }

    /**
     * Pins this tab out of service after its databases were reported doomed: it retracts the key
     * (it holds no atlas any more, and keeping the claim would lock every other tab out of an
     * atlas nobody has), shows the frozen overlay, and never leaves the blocked state again.
     * @param {Object} message - The notice that caused it, for the blocker record.
     * @param {string} reason - A `TeardownReason`, which picks the overlay's wording.
     * @returns {void}
     */
    _enterFrozen(message, reason = TeardownReason.SESSION_ENDED) {
        const surrendered = this._key;
        // Resolved HERE and not in the renderer, because the renderer runs again later (a resize,
        // a second render) with no message in hand, and a fallback computed twice is a fallback
        // that can differ between the two.
        this._teardownText = TEARDOWN_OVERLAY_BY_REASON[reason] ?? TEARDOWN_OVERLAY;
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
     *
     * EVERY EXPIRY IS RECORDED, because eviction is the only moment at which this tab knows that
     * a claim it can still be shown has already been overruled here (section 6, THE FENCE).
     */
    _livePeers() {
        const cutoff = this._now() - this._peerTtlMs;
        const live = [];
        for (const [tabId, peer] of this._peers) {
            if (peer.lastSeen < cutoff) {
                this._peers.delete(tabId);
                this._evictedClaims.set(tabId, peer.claimedAt);
                continue;
            }
            live.push(peer);
        }
        return live;
    }

    /**
     * The live peers whose claims still have STANDING in the order.
     *
     * A tab expired by TTL keeps its `claimedAt` (nothing tells it otherwise), so its first
     * message back carries the very claim this tab already overruled, and it would precede again
     * and push out the peer that legitimately took the atlas over. That one stale re-announcement
     * is denied here, which is what keeps a woken tab from evicting the live one for the round
     * trip it takes to notice its own absence (`_fenceAfterSilence`).
     *
     * THE DENIAL IS CONSUMED ON FIRST USE, and that bound is deliberate. A record that outlived
     * its purpose would be a permanent veto over a tab id: if the eviction was WRONG (four
     * dropped messages on the localStorage bus, with the peer alive and unaware), a lasting veto
     * would leave two tabs each believing it owns the atlas, with nothing left to correct it. One
     * denial covers the round trip the fence needs; the next heartbeat of a peer that never left
     * is honoured, and the order repairs itself exactly as it does today.
     * @returns {Array<TabLockClaim & {lastSeen: number}>}
     */
    _standingPeers() {
        const standing = [];
        for (const peer of this._livePeers()) {
            const evictedAt = this._evictedClaims.get(peer.tabId);
            if (evictedAt === undefined) {
                standing.push(peer);
                continue;
            }
            // A re-stamped claim is a NEW claim: the tab noticed its absence and re-entered the
            // order as a newcomer, which is precisely what the record was waiting for.
            this._evictedClaims.delete(peer.tabId);
            if (peer.claimedAt !== evictedAt) standing.push(peer);
        }
        return standing;
    }

    /**
     * THE OTHER HALF OF THE FENCE, and the only thing a tab can observe about its OWN absence:
     * the protocol did not run for longer than the TTL a peer uses to expire it.
     *
     * A tab that is merely FROZEN (the OS suspended it, the machine slept, the page sat in the
     * bfcache) is indistinguishable from a dead one on the channel, so a peer expires it, takes
     * the atlas and wipes on the way in. What used to happen next is the hole: the tab woke up
     * still holding its OLD `claimedAt`, precedes again in the total order, and resumed writing
     * without its own `onBlocked` ever having run. So on waking it re-enters the order as a
     * NEWCOMER: the fresh stamp is what makes the peer that took over precede it, which then
     * blocks it through the ordinary path, with the ordinary overlay and the ordinary way back.
     *
     * IT DROPS THE PEER REGISTRY WITHOUT RECORDING AN EVICTION, and that asymmetry is the point.
     * After a silence of this tab's own, EVERY peer looks expired and none of them is: their
     * records are stale because nothing was HEARD, not because nothing was SAID. Recording those
     * as evictions would arm `_standingPeers` against tabs that never left, which is the one way
     * this fence could produce two writers instead of preventing them.
     *
     * WHAT IT DOES NOT DO: if the peer that evicted this tab is gone by the time it wakes, nobody
     * is left to arbitrate and the tab resumes over databases that were wiped in the meantime.
     * Closing that needs a monotonic epoch PERSISTED per atlas, which is a store concern and this
     * module reaches no store (section 7).
     * @param {number} now - Current instant, from the injected clock.
     * @returns {boolean} True when the claim was re-stamped and re-announced.
     */
    _fenceAfterSilence(now) {
        const lastTick = this._lastTickAt;
        this._lastTickAt = now;
        if (now - lastTick <= this._peerTtlMs) return false;
        this._peers.clear();
        // Nothing to fence: a frozen tab is out for good (section 8), and a claim over no atlas
        // was never in the order.
        if (this._frozen || claimAddress(this._key) === null) return false;
        // A claim younger than the silence was adopted after it (`setKey` stamps before it
        // evaluates), so it was never held across the gap and is already a newcomer's claim.
        if (this._claimedAt > lastTick) return false;
        this._claimedAt = now;
        this._post(Msg.HELLO);
        return true;
    }

    /**
     * Takes the yielded key back when nothing is holding it any more.
     *
     * "Usar aqui" is a real handoff for the REQUESTER (section 7); for the tab that yielded it
     * used to be a one-way door. `_handleTakeover` fires on COLLISION, not on a recipient, so a
     * single takeover retracted the key of every tab holding that atlas, and `_evaluate` would
     * not leave the blocked state while `_yielded`. The winner closing therefore left those tabs
     * blocked for ever, staring at an overlay that named a tab nobody could see.
     *
     * Re-adopting when zero standing peer collides with the surrendered key closes both symptoms
     * at once: the tab that was asked to yield recovers when the winner leaves, and the third tab
     * that was never addressed recovers the same way. The re-adoption stamps a FRESH `claimedAt`,
     * so two tabs coming back together are ordered by the ordinary rule instead of by who yielded
     * first, and neither inherits an incumbency it stopped defending.
     * @param {TabLockClaim[]} peers - Peers with standing, from `_standingPeers`.
     * @returns {void}
     */
    _reclaimYieldedKey(peers) {
        const key = this._yieldedKey;
        if (!key) return;
        for (const peer of peers) {
            if (keysCollide(key, peer.key)) return;
        }
        this._key = key;
        this._claimedAt = this._now();
        this._yielded = false;
        this._yieldedKey = null;
        this._post(Msg.HELLO);
    }

    /** Runs the predicate and moves this tab into or out of the blocked state. @returns {void} */
    _evaluate() {
        if (this._degraded || this._destroyed) return;
        // Both fences run BEFORE the predicate, because both can change what this tab is
        // claiming, and the order must be computed over the claim it will actually defend.
        this._fenceAfterSilence(this._now());
        const peers = this._standingPeers();
        // A FROZEN TAB NEVER RE-ADOPTS: the atlas it yielded is being destroyed, so taking the
        // key back would be a claim over databases on their way out (section 8). And a tab that
        // has only DECIDED to yield (its stop is still running, `_handleTakeover`) still holds the
        // key, so there is nothing to re-adopt and reading `_yielded` alone would cancel a
        // handoff in flight.
        if (this._yielded && !this._frozen && claimAddress(this._key) === null) {
            this._reclaimYieldedKey(peers);
        }

        const self = { tabId: this._tabId, key: this._key, claimedAt: this._claimedAt };
        const blocker = findBlockingPeer(self, peers);

        if (blocker && !this._blocked) {
            this._enterBlocked(blocker);
            return;
        }
        // THE BLOCKER CAN CHANGE WITHOUT THE BLOCK CHANGING, and `_enterBlocked` cannot say so: it
        // returns early when the tab is already blocked, so the record kept pointing at whoever
        // won first. After a takeover that is a tab which has since retracted or closed, and a
        // status that names a peer nobody can see is the overlay lying about why it is there.
        if (blocker && this._blocked && this._blocker?.tabId !== blocker.tabId) {
            this._blocker = blocker;
            this._emit();
        }
        // A FROZEN TAB NEVER LEAVES, and this guard is load-bearing rather than defensive: the
        // freeze retracts the key, and `syncEngine.disconnect()` inside the brake fires the very
        // key-change listener that calls back in here. Without it the tab would find no blocker,
        // resume, and reconnect to an atlas whose databases are being deleted.
        //
        // `_yielded` survives the re-adoption above for the case that is NOT recoverable: a tab
        // that yielded while another still holds the atlas keeps its `none` key, and a `none` key
        // has no blocker, so without this guard it would unblock and resume holding nothing.
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
        const frozenText = this._teardownText ?? TEARDOWN_OVERLAY;
        this._title.textContent = this._frozen ? frozenText.title : BLOCKED_OVERLAY.title;
        this._message.textContent = this._frozen
            ? frozenText.message
            : (OVERLAY_TEXT[key?.kind] ?? OVERLAY_TEXT[TabLockKeyKind.REMOTE]);
        this._button.textContent = this._frozen ? frozenText.button : BLOCKED_OVERLAY.button;
        this._button.disabled = false;
        this._overlay.classList.add('tab-lock-overlay--visible');
    }

    /** @returns {void} */
    _hideOverlay() {
        this._overlay?.classList.remove('tab-lock-overlay--visible');
    }

    // ---------------------------------------------------------- degraded notice (section 9)

    /**
     * Shows or hides the degraded-mode banner, from the two facts that decide it: this tab has no
     * transport, and it is holding an atlas.
     *
     * IT IS DERIVED, never toggled by whoever remembered. Both facts change over the life of the
     * tab (the key does, at least), and a pair of `show()`/`hide()` calls sprinkled through the
     * key lifecycle is the shape that ends with a banner left standing over an atlas the tab no
     * longer holds. One function, called wherever the key moves.
     *
     * A DISMISSAL IS FINAL for this tab. The condition it reports cannot be fixed from here (the
     * browser has neither transport), so re-showing it on the next atlas would be nagging about
     * something the user has already been told and cannot change.
     * @returns {void}
     */
    _syncDegradedNotice() {
        if (!this._overlayHost || this._destroyed) return;
        const shouldShow = this._degraded
            && !this._degradedDismissed
            && this._key?.kind !== TabLockKeyKind.NONE;

        if (!shouldShow) {
            this._degradedNotice?.classList.remove('tab-lock-degraded--visible');
            return;
        }
        if (!this._degradedNotice) this._degradedNotice = this._buildDegradedNotice();
        this._degradedNotice.classList.add('tab-lock-degraded--visible');
    }

    /**
     * Builds the banner once. Every string goes in through `textContent`, and the only markup is
     * the same static icon the overlay uses: no user data reaches this element.
     * @returns {HTMLElement}
     */
    _buildDegradedNotice() {
        const doc = this._overlayHost.ownerDocument;
        const el = doc.createElement('div');
        el.className = 'tab-lock-degraded';
        el.setAttribute('role', 'alert');

        const icon = doc.createElement('div');
        icon.className = 'tab-lock-degraded__icon';
        icon.innerHTML = MONITOR_ICON;

        const text = doc.createElement('div');
        text.className = 'tab-lock-degraded__text';

        const title = doc.createElement('strong');
        title.className = 'tab-lock-degraded__title';
        title.textContent = DEGRADED_NOTICE.title;

        const message = doc.createElement('p');
        message.className = 'tab-lock-degraded__message';
        message.textContent = DEGRADED_NOTICE.message;

        const button = doc.createElement('button');
        button.className = 'tab-lock-degraded__button';
        button.type = 'button';
        button.textContent = DEGRADED_NOTICE.button;
        addDomListener(this, button, 'click', () => {
            this._degradedDismissed = true;
            this._syncDegradedNotice();
        });

        text.append(title, message);
        el.append(icon, text, button);
        this._overlayHost.appendChild(el);
        return el;
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
 *
 * A caller that is about to DESTROY databases must pass `witness` (section 5), or its grant is
 * decided by the settle alone. `account/open-atlas.service.js` builds one for every such caller
 * it owns; the public-link open in `index.js` is the one that still asks without it.
 * @param {TabLockKey} key
 * @param {{settleMs?: number, witness?: (() => Promise<boolean|null>)|null}} [options]
 * @returns {Promise<{granted: boolean, blockedBy: TabLockClaim|null, degraded: boolean,
 *   deniedBy: string|null}>}
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
 * @param {{timeoutMs?: number, reason?: string}} [options] - `reason` is a `TeardownReason`.
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
 * @param {{timeoutMs?: number, reason?: string}} [options] - `reason` is a `TeardownReason`.
 * @returns {Promise<{addresses: string[], peers: number, acked: number, frozen: number,
 *   timedOut: boolean, degraded: boolean}>}
 */
async function announceTeardownWithoutPage(addresses, { timeoutMs, reason } = {}) {
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
        return await announcer.announceTeardown(list, {
            // Omitted rather than passed as undefined: the parameter defaults live in
            // `announceTeardown`, and forwarding `undefined` would work today only because
            // destructuring happens to treat it the same way.
            ...(timeoutMs === undefined ? {} : { timeoutMs }),
            ...(reason === undefined ? {} : { reason })
        });
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
