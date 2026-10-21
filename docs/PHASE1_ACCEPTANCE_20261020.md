# LEMON CLASH — Phase 1 (online stability and UI) — 2026-10-20

## Baseline and ownership

- The **Google Sites page used at school is the published truth**. Changes applied there through Gemini do NOT automatically enter GitHub or Drive.
- The user confirmed that the school HTML works in online 1v1 and two-player rematches, and changed starting HP to **3** directly in Google Sites.
- The dev branch `dev/ipad-hand-ui` includes HP3 + rematch, but is a **candidate**, not an automatic change to the user's published page.
- Game balance is **user-owned**. No card energy costs, damage, or other balancing changed in this Phase 1 pass.
- Existing BRAWL/Shokoku repos, Firebase rules/data, the school's published Google Site and `main` were **not edited**.

## Fixes completed in dev branch

1. Failed action-commit transactions now restore the Confirm button, allowing a safe retry. Successful commits keep the selection locked while waiting for the opponent.
2. Late asynchronous room-creation and joining operations use session-epoch guards. Old network responses cannot take over a new room's UI.
3. When a room listener is attached, the session epoch advances; room entry now releases busy controls against the **adopted** epoch. This prevents a stuck Confirm button upon first joining.
4. Leaving while room joining is pending restores the room create/join buttons.
5. Existing Gemini double-vote rematch is preserved. Missing winner/action result UI was restored, and the display's turn cursor resets when a new match begins.

## Checks done

- **11/11** two-client in-memory simulated communication tests: normal 5-turn HP3 match, third-party rejection, leave/rejoin, lost room, tampered state, ultimate move, commit/reveal restoration, stale callbacks, failed commit and retry, late room lookup, and **three consecutive matches with two rematches**.
- **18/18** rules/card matchup tests from the prior HP3 pass; no balance rule changed.
- One current full Google Sites-style HTML code was generated from the dev source; **4** inline scripts compile, with no external game JS or nested iframe dependency.
- Two actual **Chromium** embedded HTML clients were exercised with a shared **mocked** RTDB and mock digest, completing **2 five-turn matches with rematch**. This verifies browser UI/event wiring, not Firebase production permissions or WebKit.

## Release decision

- **Phase 1 development checks complete, awaiting iPad acceptance on the exact newly generated candidate.**
- **Do not swap the existing successful school build automatically.** Export an appropriately labeled complete Google Sites paste-code TXT to Google Drive. The user may choose when to paste it.
- The real Firebase rules are not audited, and the shared-RTDB local identifier is not authentication. Keep this for private friends-only use, not a public hardened release.
- For school/Gemini hotfixes, obtain the changed Google Sites HTML and port only the confirmed changes into GitHub dev before building a new TXT.

## Next after school confirmation

Phase 2 technical priorities are optional visual polish and stability monitoring. Any balance proposals must go to the user for decision; do not change HP3 or card statistics independently.
