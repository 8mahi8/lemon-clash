# LEMON CLASH — 1vs1 online development (isolated environment)

This is a non-production test implementation. Do not change BRAWL/Shokoku/Firebase production projects or published Google Sites.

## School release / Google Sites publishing CONTRACT

The user publishes by **copying the ENTIRE HTML source into Google Sites → Insert → Embed → Embed code**. This is NOT an iframe URL and NOT a GitHub Pages URL.

- Run `node tools/build-embed.cjs`.
- Copy all text in `dist/lemon-clash-online-lab-embed.txt` (identical to `.html`) into the Google Sites HTML code input.
- CSS, gameplay rules and application JS must be inline. The HTML must not reference separate game files, GitHub Pages, remote iframe sources, or repository paths.
- Firebase compat SDK fetched from gstatic and real-time Firebase network traffic are still needed; the game is a single HTML file, **not a network-free offline online mode**.
- The Google Sites-generated iframe may have different origin, sandbox, storage and network policy from a direct browser tab. Test the pasted HTML as an iframe `srcdoc` in WebKit, then test in actual Google Sites school iPad. Never claim a URL-based iframe test proves pasted-code support.
- Never switch publishing methods without user approval.

## Player experience and reuse of existing games

The final player workflow must match the existing BRAWL / Shokoku school games:
1. Paste the complete HTML into Google Sites once.
2. Host presses "Create room" and shares the generated code.
3. Guest types the room code and presses "Join".
4. Both play immediately without entering Firebase URLs, credentials, project IDs or setup steps.

Firebase configuration is a developer/build-time concern, never a player-facing requirement. BRAWL and Shokoku use the existing RTDB URL `mygame-df915-default-rtdb.firebaseio.com` and game-specific namespaces; **do not copy that endpoint into Lemon Clash or deploy rules to it without inspecting the current live rules and obtaining explicit authorization**. A separately provisioned Firebase app can still deliver the exact same one-code player experience. Do not claim online is operational until the configuration is deployed and two clients connect successfully.

The game's public HTML distribution remains Google Sites **pasted code**, not a GitHub Pages iframe. Study BRAWL's lobby, room-code flow, school iPad touch behavior and Shokoku's reconnect/error states as design references. Do not modify either source repository.

## Firebase integration status (October 2026)

The user's attempt to connect the Firebase plugin to ChatGPT was unsuccessful and is intentionally **on hold**. Do not ask for reconnection as a prerequisite to continuing game development. The ChatGPT plugin is distinct from the Firebase SDK embedded in the final game.

Continue freely on the development branch with source-level tests, the in-memory two-player simulator (`node --test tests/online-pair-simulation.test.cjs`), and isolated Firebase Auth/RTDB emulators. Do not write to either existing game's production database. The production backend has **not** been connected or approved, and the user should not be asked to paste an unconfigured online build into Google Sites.

The target player experience remains **paste one HTML source once, create a room, enter a room code and play**. No player should enter a Firebase URL or manage Firebase credentials. Before calling the game release-ready, obtain an authorized backend configuration, verify real two-browser network play, and have the user test the exact embedded code on school iPads.

## Test evidence boundaries

- In-memory simulator tests use real rules/protocol/client application code with a mocked DOM/database. This verifies application state logic, **not** browser behavior or actual Firebase Rules enforcement.
- WebKit plus Auth/RTDB emulators is an additional test, authored in `tests/online-emulator-webkit.cjs` and configured in GitHub Actions. It is **not verified as run** until a completed test run/log exists.
- Direct Google Sites embedding on school Safari is a separate final step and cannot be substituted with a GitHub Pages URL.
- GitHub Actions history checked on 2026-10-20 showed only Pages runs on main, no dev-branch two-browser workflow run. Do not claim the emulator test passed until this changes.

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
