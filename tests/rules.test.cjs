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
  assert.equal(R.resolveTurn(withEnergy(4), "read", "allin").players[0].hp, 3);
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
  assert.equal(R.resolveTurn(withEnergy(4), "allin", "guard").players[1].hp, 3);
  assert.equal(R.resolveTurn(withEnergy(4), "final", "guard").players[1].hp, 2);
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
test("simultaneous judgment is draw and requires seven energy", () => {
  assert.equal(R.validMove(game().players[0], "judgment"), false);
  assert.equal(R.resolveTurn(withEnergy(7), "judgment", "judgment").winner, "draw");
});
