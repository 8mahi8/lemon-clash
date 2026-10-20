# LEMON CLASH — Firebase snapshot key-order false mismatch (2026-10-21)

## User-reported symptom (school Google Sites)
Screenshot at `sites.google.com/view/lemonclash/レモン` showed both at HP3 and energy1, waiting "両者が確定！ 行動を同時公開しています..." and:
`通信データを処理できません: 両端末のターン結果が一致していません`.

## Root cause reproduced in development
`verifyPublishedState()` compared the expected round history to the Firebase-loaded history with raw
`JSON.stringify(expected.history) !== JSON.stringify(latest.history)`.
The resolver appends entries with JS insertion key order `turn, moves, damages, messages`; Firebase-style roundtrip can enumerate the same entry in lexicographic key order `damages, messages, moves, turn`. Both are **identical data** but `JSON.stringify` values differ. The prior in-memory fake Firebase happened to preserve insertion order and so missed this class of false mismatch.

Reproduction: force the fake Firebase to roundtrip objects with sorted keys. Before the fix, the first three existing online two-client tests all timed out **on turn 1**, which matches the reported symptom. This is a verified root-cause *reproduction*, not a claim to have inspected the user's live RTDB room contents or the exact previously edited Gemini code.

## Fix
1. Replace raw string comparison for expected vs loaded `history` with a recursive `sameStructuredValue` comparator. Object key order is ignored, while **array order, every key and every value** must still match.
2. Model Firebase lexicographic object-key roundtrips in `tests/online-pair-simulation.test.cjs`, not just ordered plain JS clones.
3. Add a regression test: normal attack vs charge is accepted even after key reorder; altering even one history message still triggers the mismatch and prevents acceptance.
4. Dev branch `src/online-app.js` updated. Candidate full standalone Google Sites HTML:
`release-candidates/LEMON_CLASH_Phase4_RC2_同期検証修正_GoogleSites貼付コード.txt`
Git blob SHA: `376cae671e6c0ebfec9e302a6160200494887e49`
59,726 UTF-8 bytes. **RC1 is obsolete**; do not use.

## Test evidence
- Previously failing simulated-key-order runs now **35/35 pass** for rules and two-client simulation.
- Fresh candidate contains all four inlined JS scripts; `node --check` passed for each; no nested iframe or external game JS.
- The local TXT was independently reconstructed from RC1 plus the exact `src/online-app.js` fix. Its Git blob SHA matches the GitHub candidate.
- **Not verified on the actual Google Sites page, iPad Safari, or live Firebase**; that still requires user-controlled publication/testing. A headless browser attempt in the current runtime was blocked by administrator navigation policy; do not claim a new RC2 browser acceptance test.

## Safe release steps
The currently published Google Sites HTML may have newer Gemini patches than the GitHub branch. Compare or preserve the current school embed before replacing; do not discard unrelated fixes. For a deliberate RC2 test, paste the **entire RC2 TXT content** into Google Sites -> Embed code (not URL); publish, and reload both devices with the same version and start a new 6-digit room. Both must move from "同時公開" to the turn result without the mismatch error.
Do **not** change main, live Google Sites, Firebase database rules/records, Google Drive or other games without separate authorization. HP3, draw-on-simultaneous-lethal, and card balance unchanged.
