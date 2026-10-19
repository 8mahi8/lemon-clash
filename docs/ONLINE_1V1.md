# LEMON CLASH — 1vs1 online development (isolated environment)

This is a non-production test implementation. Do not change BRAWL/Shokoku/Firebase production projects or published Google Sites.

## Setup required before two-device testing

1. Create a separate Firebase test project, register a Web app and enable Anonymous Authentication.
2. Create a dedicated Realtime Database in test mode, but replace permissive defaults with firebase/lemon-clash-lab.rules.json. Never deploy these lab-only rules to an existing production database.
3. Set the public Web configuration object in src/firebase-config.js (apiKey, authDomain, databaseURL, projectId, appId). Firebase Web apiKey is not a secret; access control is enforced by Auth + Rules.
4. Host creates a 6-digit room code, guest enters the code, and each side commits an SHA-256 hash of its secret move before either side reveals.
5. Verify two real WebKit clients in an isolated Firebase emulator before any school iPad / Google Sites release.

## Fair play / resilience

- Dedicated namespace: lemonClashRoomsV1. No writes to BRAWL or Shokoku.
- Commit SHA-256 hashes a 32-byte random nonce plus room ID, turn number, authenticated user UID and action.
- Action and nonce are revealed only after both commitments. The digest is verified before both peers resolve the same game state.
- Each player has an owned room/rounds/turn/seat path; separate state snapshots by turn prevent duplicate application.
- Store unrevealed nonce in sessionStorage when possible. On reload, Safari iframe privacy policies might prevent restoration. An unrecoverable pending reveal requires a new match; do not fabricate an action.
- Anonymous-auth authorization and a 6-digit room ID are not sufficient defenses against determined hostile users, brute-force joins or cost exhaustion.

## Release checklist (not yet satisfied)

- Rules emulator: cross-user write denial, stale room, simultaneous guests, replay/forgery prevention.
- Two WebKit clients: host/join, commit, reveal, consistent next state, reconnect, collision cases.
- School Safari + Google Sites full HTML embed: auth, SDK loading, controls, UI, latency, network blocks.
- Cost/storage maintenance: stale room cleanup, rate limits, Firebase quotas.
- No merge into main before actual test results and user-ready verification.
