/* Run: node --test tests/chargehunter-energy.test.cjs */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const R = require("../src/rules.js");

test("charge hunter cancels +1 and subtracts one stored energy for both seats", () => {
  for (const hunterSeat of [0, 1]) {
    for (const startingEnergy of [0, 1, 3, 5, 10]) {
      const original = R.createGame();
      original.players[hunterSeat].energy = 3; // hunter can pay its cost 2
      original.players[1 - hunterSeat].energy = startingEnergy;
      const actions = hunterSeat === 0 ?
        ["chargehunter", "charge"] : ["charge", "chargehunter"];
      const out = R.resolveTurn(original, ...actions);
      assert.equal(out.players[1 - hunterSeat].energy, Math.max(0, startingEnergy - 1),
        "target should lose one of its stored energy, not just the new charge");
      assert.equal(out.players[1 - hunterSeat].hp, 2,
        "charge hunter still deals one damage");
      assert.equal(out.players[hunterSeat].energy, 1,
        "charge hunter's own cost is spent");
      assert.match(out.history[0].messages.join(" / "), /エネルギー-1/);
      assert.equal(original.players[1 - hunterSeat].energy, startingEnergy,
        "original state must not be mutated");
    }
  }
});

test("charge hunter still reduces stored energy when existing shield absorbs the hit", () => {
  for (const hunterSeat of [0, 1]) {
    const original = R.createGame();
    original.players[hunterSeat].energy = 3;
    original.players[1 - hunterSeat].energy = 5;
    original.players[1 - hunterSeat].shield = 2;
    const actions = hunterSeat === 0 ?
      ["chargehunter", "charge"] : ["charge", "chargehunter"];
    const out = R.resolveTurn(original, ...actions);
    assert.equal(out.players[1 - hunterSeat].energy, 4);
    assert.equal(out.players[1 - hunterSeat].shield, 1);
    assert.equal(out.players[1 - hunterSeat].hp, 3);
  }
});

test("charge hunter does not reduce energy against normal guard or other actions", () => {
  const original = R.createGame();
  original.players[0].energy = 3;
  original.players[1].energy = 5;
  const out = R.resolveTurn(original, "chargehunter", "guard");
  assert.equal(out.players[1].energy, 5);
  assert.equal(out.players[1].hp, 3);
  assert.equal(out.history[0].messages.some(v => v.includes("エネルギー-1")), false);
});
