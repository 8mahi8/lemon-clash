const { test } = require("node:test");
const assert = require("node:assert/strict");
const { webcrypto } = require("node:crypto");
const R = require("../src/rules.js");
const P = require("../src/online-protocol.js");
const uid = ["host-id", "guest-id"];
const roomId = "002571";
const nonceA = "ab".repeat(32), nonceB = "cd".repeat(32);
async function sampleRoom(a, b) {
  const game = R.createGame();
  const commits = {
    host: await P.makeCommit(roomId, 1, uid[0], a, nonceA, webcrypto.subtle),
    guest: await P.makeCommit(roomId, 1, uid[1], b, nonceB, webcrypto.subtle)
  };
  return { protocol: P.VERSION, hostUid: uid[0], guestUid: uid[1], game,
    round: { ...P.emptyRound(1), commits,
      reveals: { host: { action: a, nonce: nonceA }, guest: { action: b, nonce: nonceB } } } };
}
test("secure unique nonce has 256 bits", () => {
  const a = P.freshNonce(webcrypto), b = P.freshNonce(webcrypto);
  assert.match(a, /^[a-f0-9]{64}$/);
  assert.notEqual(a,b);
});
test("room codes are exactly six digits and preserve leading zeros", () => {
  assert.equal(P.validRoomCode("000001"), true);
  assert.equal(P.validRoomCode("12"), false);
  assert.match(P.generateRoomCode(webcrypto), /^[0-9]{6}$/);
});
test("no reveal before both commitment and both reveals", async () => {
  const room=await sampleRoom("attack","charge");
  delete room.round.reveals.guest;
  assert.equal(await P.resolveCommittedRound(room,roomId,webcrypto.subtle,R),null);
});
test("matching reveals produce identical deterministic results on clients", async () => {
  const room=await sampleRoom("attack","charge");
  const expected=R.resolveTurn(room.game,"attack","charge");
  const results=await Promise.all(Array.from({length:3},()=>P.resolveCommittedRound(room,roomId,webcrypto.subtle,R)));
  results.forEach(r=>assert.deepEqual(r,expected));
  assert.equal(room.game.turn,1,"input must not mutate");
});
test("hash rejects tampering and room, uid or turn replay", async () => {
  const room=await sampleRoom("attack","charge");
  const corrupt=await sampleRoom("attack","charge");
  corrupt.round.reveals.host.action="guard";
  await assert.rejects(P.resolveCommittedRound(corrupt,roomId,webcrypto.subtle,R),/commitment/);
  const changedRoom=await sampleRoom("attack","charge");
  await assert.rejects(P.resolveCommittedRound(changedRoom,"222222",webcrypto.subtle,R),/commitment/);
  const changedUid=await sampleRoom("attack","charge");
  changedUid.hostUid="different";
  await assert.rejects(P.resolveCommittedRound(changedUid,roomId,webcrypto.subtle,R),/commitment/);
  const changedNonce=await sampleRoom("attack","charge");
  changedNonce.round.reveals.guest.nonce="ff".repeat(32);
  await assert.rejects(P.resolveCommittedRound(changedNonce,roomId,webcrypto.subtle,R),/commitment/);
});
test("single-use card state is carried to next turn", async () => {
  const room=await sampleRoom("feint","guard");
  const g=await P.resolveCommittedRound(room,roomId,webcrypto.subtle,R);
  assert.equal(g.players[0].used.includes("feint"),true);
  assert.equal(g.players[0].energy,3);
  assert.equal(P.emptyRound(g.turn).turn,2);
});
test("game-relevant salt and move cannot be read from commitment digest", async () => {
  const hash=await P.makeCommit(roomId,1,uid[0],"judgment",nonceA,webcrypto.subtle);
  assert.equal(hash.includes("judgment"),false);
  assert.equal(hash.length,64);
});
