# LEMON CLASH — 通常攻撃によるチャージ中断 (RC3 / 2026-10-21)

## User-approved balance change

The user agreed: **「通常攻撃がチャージ中の相手に当たったら、チャージによるエネルギー+1を得られない」**.

- Basic `attack` vs `charge` → attack still costs **1** energy and causes **1 HP damage**; defender gains **0** energy from that charge attempt. Energy already held is not drained.
- Applies identically from host or guest perspective.
- `charge` against `guard`, `charge`, ordinary utility cards or special attacks still grants **+1** energy as before (unless the existing `drain` effect blocks it).
- Special attack cards (`pierce`, `volley`, `crush`, `final`, `allin`) **do not** interrupt charge. `drain` continues its original explicit charge cancellation.
- Existing HP3, eleven single-use cards, costs, damage, counters, judgments and draw rules unchanged.
- Both basic move descriptions updated to explain the rule; turn history adds a message `P<n>のチャージが通常攻撃で中断！`.

## Evidence

- **40/40** actual source-level unit and 2-player in-memory simulated tests passed after updating the scenarios affected by interrupted charge. Existing Firebase lexicographic object-key roundtrip simulator remains enabled.
- New rule tests: either seat's charge interrupted; unaffected actions; special attacks don't interrupt; `drain`/guard remain intact; online hosts and guests agree on HP/energy for both attack directions.
- One affected ultimate test now accounts for two interrupted charge turns: energy7 reached after 8 setup turns instead of 6.
- Standalone complete HTML regenerated from current source (4 inline scripts pass JS syntax compilation, no game-specific external script, no nested iframe), and GitHub contents readback matched exactly.
- **No live shared Firebase, school Safari, or Google Sites validation was performed** for RC3; the current RC2 school build must remain untouched until the user elects to test an updated paste version.

## Candidate (NOT published)

`release-candidates/LEMON_CLASH_RC3_通常攻撃チャージ妨害_GoogleSites貼付コード.txt`

Blob SHA `47e47b7d1d7d02b4092ab390bc415be9e395a334`.

If user later wants to update the school Google Sites HTML, compare the **currently published** version first (Gemini edits may not exist in repository). Copy the full candidate HTML into Insert → Embed → Embed code. Reload BOTH player devices to the same version and create a new room; mixing RC2/RC3 clients may cause legitimate round-result discrepancies because the rules differ. Keep the previous functioning school build as rollback.

**No** Google Drive upload, published Google Sites update, prod Firebase data or rules mutation, or `main` merge.
