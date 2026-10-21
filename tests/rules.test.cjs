/* Run with: node --test tests/rules.test.cjs */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const R = require("../src/rules.js");
const game = () => R.createGame();
function withEnergy(n) {
  const g = game();
  g.players[0].energy = n;
  g.players[1].energy = n;
  return g;
}
test("initial state and eleven unique one-use cards", () => {
  const g = game();
  assert.equal(g.players[0].energy, 1);
  assert.equal(R.START_HP, 3);
  assert.deepEqual(g.players.map(p => p.hp), [3, 3]);
  assert.equal(R.MAX_ENERGY, 7);
  assert.equal(R.CARDS.length, 11);
  assert.equal(new Set(R.CARDS.map(c => c.id)).size, 11);
});
test("attack costs one and cannot be spammed at zero", () => {
  const g = R.resolveTurn(game(), "attack", "charge");
  assert.equal(g.players[0].energy, 0);
  assert.equal(g.players[1].hp, 2);
  assert.equal(R.validMove(g.players[0], "attack"), false);
});
test("basic attack interrupts charge and deals one damage from either seat", () => {
  for (const [attackIndex, moves] of [[0, ["attack", "charge"]], [1, ["charge", "attack"]]]) {
    const starting = game();
    const after = R.resolveTurn(starting, ...moves);
    const charger = 1 - attackIndex;
    assert.equal(after.players[charger].hp, 2);
    assert.equal(after.players[charger].energy, 1, "charge gain must be cancelled");
    assert.equal(after.players[attackIndex].energy, 0, "attack still costs one");
    assert.deepEqual(starting.players.map(p => [p.hp, p.energy]), [[3, 1], [3, 1]],
      "turn resolution must not mutate its input");
    assert.match(after.history[0].messages.join(" "), /チャージが通常攻撃で中断/);
  }
});

test("charge still generates one energy against non-attack moves", () => {
  for (const move of ["charge", "guard", "feint", "read", "counter", "seal"]) {
    const g = withEnergy(4);
    const out = R.resolveTurn(g, move, "charge");
    assert.equal(out.players[1].energy, 5, "charge should succeed against " + move);
  }
});

test("special attacks do not interrupt charge despite causing damage", () => {
  for (const move of ["pierce", "volley", "crush", "final", "allin"]) {
    const g = R.createGame();
    g.players[0].energy = 5; // All In now requires five energy.
    const out = R.resolveTurn(g, move, "charge");
    assert.ok(out.history[0].damages[1] > 0, move + " should damage");
    assert.equal(out.players[1].energy, 2, move + " must not cancel +1 charge");
    assert.equal(out.history[0].messages.some(m => m.includes("通常攻撃で中断")), false);
  }
});

test("charge interruption coexists with energy-drain and ordinary guard rules", () => {
  const stolen = R.resolveTurn(withEnergy(4), "drain", "charge");
  assert.deepEqual(stolen.players.map(p => p.energy), [5, 4]);
  const stopped = R.resolveTurn(withEnergy(4), "attack", "guard");
  assert.deepEqual(stopped.players.map(p => p.hp), [3, 3]);
  assert.equal(stopped.players[0].energy, 3);
  const normal = R.resolveTurn(withEnergy(4), "attack", "read");
  assert.equal(normal.players[1].hp, 2, "read must still fail against a basic attack");
});

test("guard is free and does not grant energy", () => {
  const g = R.resolveTurn(game(), "attack", "guard");
  assert.equal(g.players[1].hp, 3);
  assert.equal(g.players[1].energy, 1);
});
test("charge capped at seven", () => {
  const g = R.resolveTurn(withEnergy(7), "charge", "charge");
  assert.deepEqual(g.players.map(p => p.energy), [7, 7]);
});
test("energy drain steals only a charge: +2 minus cost 1", () => {
  let g = R.resolveTurn(withEnergy(3), "drain", "charge");
  assert.deepEqual(g.players.map(p => p.energy), [4, 3]);
  g = R.resolveTurn(withEnergy(3), "drain", "guard");
  assert.deepEqual(g.players.map(p => p.energy), [2, 3]);
});
test("feint punishes guard but not charge", () => {
  assert.equal(R.resolveTurn(game(), "feint", "guard").players[0].energy, 3);
  assert.equal(R.resolveTurn(game(), "feint", "charge").players[0].energy, 0);
});
test("piercing and crushing bypass guard", () => {
  assert.equal(R.resolveTurn(withEnergy(4), "pierce", "guard").players[1].hp, 2);
  assert.equal(R.resolveTurn(withEnergy(4), "crush", "guard").players[1].hp, 1);
});
test("read stops special attacks, not basic attack", () => {
  assert.equal(R.resolveTurn(withEnergy(5), "read", "allin").players[0].hp, 3);
  assert.equal(R.resolveTurn(withEnergy(4), "read", "attack").players[0].hp, 2);
});
test("counter reflects ordinary attack and nonpiercing specials", () => {
  let g = R.resolveTurn(withEnergy(4), "counter", "volley");
  assert.deepEqual(g.players.map(p => p.hp), [3, 2]);
  g = R.resolveTurn(withEnergy(4), "counter", "pierce");
  assert.deepEqual(g.players.map(p => p.hp), [2, 3]);
});
test("seal stops cost<=3 special, never cost 4", () => {
  let g = R.resolveTurn(withEnergy(7), "seal", "pierce");
  assert.equal(g.players[0].hp, 3);
  assert.ok(g.players[1].used.includes("pierce"));
  g = R.resolveTurn(withEnergy(7), "seal", "final");
  assert.equal(g.players[0].hp, 1);
});
test("seal versus seal cancels both with costs spent", () => {
  const g = R.resolveTurn(withEnergy(7), "seal", "seal");
  assert.equal(g.players[0].energy, 5);
  assert.equal(g.players[1].energy, 5);
});
test("allin blocked by guard, final still chips guard", () => {
  assert.equal(R.resolveTurn(withEnergy(5), "allin", "guard").players[1].hp, 3);
  assert.equal(R.resolveTurn(withEnergy(4), "final", "guard").players[1].hp, 2);
});
test("All In costs five, requires four successful charges from the initial state", () => {
  assert.equal(R.getMove("allin").cost, 5);
  let g = game();
  for (let t = 1; t <= 3; t++) {
    assert.equal(R.validMove(g.players[0], "allin"), false,
      "All In must not unlock after just " + (t - 1) + " charges");
    g = R.resolveTurn(g, "charge", "guard");
  }
  assert.equal(g.players[0].energy, 4);
  assert.equal(R.validMove(g.players[0], "allin"), false);
  g = R.resolveTurn(g, "charge", "guard");
  assert.equal(g.players[0].energy, 5);
  assert.equal(R.validMove(g.players[0], "allin"), true);
  const result = R.resolveTurn(g, "allin", "charge");
  assert.equal(result.winner, 0);
  assert.equal(result.players[1].hp, 0);
  assert.equal(result.players[0].energy, 0);
});

test("All In is not faster than three basic attacks against an undefended player", () => {
  const allin = ["charge", "charge", "charge", "charge", "allin"];
  const basics = ["attack", "charge", "attack", "charge", "attack"];
  for (const sequence of [allin, basics]) {
    let g = game();
    sequence.forEach((action, t) => {
      g = R.resolveTurn(g, action, "guard"); // guard consumes neither HP nor energy
      if (t < 4) assert.equal(g.winner, null, "no premature KO");
    });
    // Normal guard defends both, so this is only an action legality check.
    assert.equal(g.winner, null);
  }
  // Opponent plays an otherwise harmless non-defensive move instead.
  for (const sequence of [allin, basics]) {
    let g = game();
    for (const action of sequence) {
      g = R.resolveTurn(g, action, "read");
    }
    assert.equal(g.winner, 0, "both baseline strategies win on turn five");
  }
});

test("early basic attacks delay All In preparation by interrupting charges", () => {
  let g = game();
  const other = ["attack", "charge", "attack", "charge"];
  for (const action of other) {
    g = R.resolveTurn(g, "charge", action);
  }
  assert.equal(g.players[0].hp, 1);
  assert.equal(g.players[0].energy, 3,
    "only two charges succeeded and the initial energy is one");
  assert.equal(R.validMove(g.players[0], "allin"), false);
});

test("All In remains one-use and loses against defensive counters", () => {
  for (const [counter, hpAttacker] of [["guard",3],["read",3],["counter",2]]) {
    const g = withEnergy(5);
    const result = R.resolveTurn(g, "allin", counter);
    assert.equal(result.players[1].hp, 3);
    assert.equal(result.players[0].hp, hpAttacker);
    assert.equal(result.players[0].energy, 0);
    assert.ok(result.players[0].used.includes("allin"));
    assert.equal(R.validMove(result.players[0], "allin"), false);
  }
});

test("cards are permanently consumed even if failed", () => {
  let g = R.resolveTurn(withEnergy(7), "allin", "guard");
  assert.equal(R.validMove(g.players[0], "allin"), false);
  assert.throws(() => R.resolveTurn(g, "allin", "charge"));
});
test("simultaneous lethal attack is a draw", () => {
  let g = game();
  g.players[0].hp = g.players[1].hp = 1;
  g = R.resolveTurn(g, "attack", "attack");
  assert.equal(g.winner, "draw");
  assert.throws(() => R.resolveTurn(g, "charge", "charge"));
});
test("invalid moves never mutate state", () => {
  const g = game();
  const snapshot = JSON.stringify(g);
  assert.throws(() => R.resolveTurn(g, "allin", "charge"));
  assert.equal(JSON.stringify(g), snapshot);
});

test("judgment wins regardless of opponent action", () => {
  for (const id of ["guard", "read", "seal", "counter", "allin", "attack"]) {
    const g = withEnergy(7);
    assert.equal(R.resolveTurn(g, "judgment", id).winner, 0);
  }
});
test("judgment wins even if a simultaneous attack would otherwise be lethal", () => {
  for (const counterMove of ["attack", "pierce", "volley", "crush", "final", "allin"]) {
    // Test BOTH seats; HP 1 ensures every unblocked attack is lethal.
    for (const declaring of [0, 1]) {
      const g = withEnergy(7);
      g.players[0].hp = g.players[1].hp = 1;
      const a = declaring === 0 ? "judgment" : counterMove;
      const b = declaring === 1 ? "judgment" : counterMove;
      const result = R.resolveTurn(g, a, b);
      assert.equal(result.winner, declaring, "judgment must win against " + counterMove);
      assert.equal(result.players[declaring].hp, 1, "the declaring player must not die");
      assert.match(result.history[0].messages.join(" "), /終局宣告が成立/);
    }
  }
});
test("simultaneous judgment is draw and requires seven energy", () => {
  assert.equal(R.validMove(game().players[0], "judgment"), false);
  assert.equal(R.resolveTurn(withEnergy(7), "judgment", "judgment").winner, "draw");
});
