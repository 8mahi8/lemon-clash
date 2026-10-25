/* V2 gameplay invariants: Node built-in tests, no external dependencies. */
"use strict";
const {test} = require("node:test");
const assert = require("node:assert/strict");
const R = require("../src/rules.js");

function play(a,b,options={}) {
  const before = R.createGame();
  before.players.forEach((p,i) => {
    p.energy = options.energy ?? 10;
    p.hp = (options.hp && options.hp[i]) ?? 3;
    p.shield = (options.shield && options.shield[i]) ?? 0;
  });
  const snapshot = JSON.stringify(before);
  const after = R.resolveTurn(before,a,b);
  assert.equal(JSON.stringify(before), snapshot, "must not mutate input");
  return after;
}
const hp = result => result.players.map(p=>p.hp);
const energy = result => result.players.map(p=>p.energy);
const shield = result => result.players.map(p=>p.shield);

test("V2 cards, unique IDs, costs, effective descriptions and burn gate",()=>{
  assert.equal(R.CARDS.length,15);
  assert.equal(new Set(R.CARDS.map(c=>c.id)).size,15);
  for(const [id,cost] of [["lifedrain",3],["chargehunter",2],["burn",1],["armor",4]]) {
    assert.equal(R.getMove(id).cost,cost);
    assert.ok(R.getMove(id).description);
  }
  assert.match(R.getMove("pierce").description,/見切り・封印で防がれる/);
  assert.doesNotMatch(R.getMove("pierce").description,/カウンター/);
  assert.doesNotMatch(R.getMove("lifedrain").description,/シールドに当たっても回復/);
  const p = R.createGame().players[0];
  p.hp=1; p.energy=5; assert.equal(R.validMove(p,"burn"),false);
  p.hp=2; assert.equal(R.validMove(p,"burn"),true);
});
test("crush exclusively punishes guard and still loses to seal/read",()=>{
  assert.deepEqual(hp(play("crush","guard")),[3,1]);
  for(const x of ["charge","attack","counter","pierce","armor","read","seal"]) {
    assert.equal(play("crush",x).players[1].hp,3,"crush versus "+x);
  }
  assert.deepEqual(hp(play("guard","crush")),[1,3]);
});
test("pierce guard penetration and read/seal defense preserved",()=>{
  assert.deepEqual(hp(play("pierce","guard")),[3,2]);
  assert.deepEqual(hp(play("pierce","read")),[3,3]);
  assert.deepEqual(hp(play("pierce","seal")),[3,3]);
  assert.deepEqual(hp(play("pierce","counter")),[3,2]);
});
test("seal success refunds one, fails against basics/judgment, mirror gains nothing",()=>{
  assert.deepEqual(energy(play("seal","final")),[9,6]);
  assert.deepEqual(energy(play("seal","charge")),[8,10]);
  assert.deepEqual(energy(play("seal","seal")),[8,8]);
  assert.equal(play("seal","judgment").winner,1);
});
test("counter reflects ONLY attack damage from allowed moves",()=>{
  for(const [card,dmg] of [["attack",1],["volley",2],["allin",3],["lifedrain",1],["chargehunter",1]]) {
    const out=play(card,"counter");
    assert.equal(out.players[0].hp,3-dmg,card);
    assert.equal(out.players[1].hp,3,card);
  }
  for(const card of ["pierce","final"]) {
    const out=play(card,"counter");
    assert.equal(out.players[0].hp,3);
    assert.ok(out.players[1].hp<3);
  }
  assert.deepEqual(hp(play("crush","counter")),[3,3]);
});
test("new charge hunter deals 1 normally and penalizes only charge",()=>{
  assert.deepEqual(hp(play("chargehunter","attack")),[2,2]);
  const ch=play("chargehunter","charge",{energy:5});
  assert.deepEqual(hp(ch),[3,2]);
  assert.deepEqual(energy(ch),[3,4]);
  assert.equal(play("chargehunter","charge",{energy:2}).players[1].energy,1);
  assert.deepEqual(hp(play("chargehunter","guard")),[3,3]);
  assert.deepEqual(hp(play("chargehunter","read")),[3,3]);
  assert.deepEqual(hp(play("chargehunter","seal")),[3,3]);
});
test("final now cancels charge but other special attacks do not",()=>{
  assert.deepEqual(energy(play("final","charge",{energy:4})),[0,4]);
  assert.deepEqual(hp(play("final","guard")),[3,2]);
  for(const special of ["volley","pierce","lifedrain"]) {
    assert.equal(play(special,"charge",{energy:5}).players[1].energy,6,special);
  }
});
test("burn gains three after paying one and loses direct HP even through shield",()=>{
  let out=play("burn","guard",{energy:1,shield:[2,0]});
  assert.deepEqual(energy(out),[3,1]);
  assert.deepEqual(hp(out),[2,3]);
  assert.deepEqual(shield(out),[2,0]);
  out=play("burn","attack",{energy:1,hp:[2,3]});
  assert.equal(out.players[0].hp,0);
  assert.equal(out.winner,1);
  out=play("burn","seal",{energy:5,hp:[2,3]});
  assert.deepEqual(hp(out),[2,3],"seal negates self-harm");
  assert.deepEqual(energy(out),[4,4]);
});
test("armor gives 2 persistent shield, absorbs damage same turn with spillover",()=>{
  let out=play("armor","allin");
  assert.deepEqual(hp(out),[2,3]);
  assert.deepEqual(shield(out),[0,0]);
  out=play("armor","attack");
  assert.deepEqual(hp(out),[3,3]);
  assert.deepEqual(shield(out),[1,0]);
  out=R.resolveTurn(out,"charge","attack");
  assert.deepEqual(hp(out),[3,3]);
  assert.deepEqual(shield(out),[0,0]);
  out=play("armor","seal");
  assert.deepEqual(shield(out),[0,0]);
  assert.equal(play("armor","judgment").winner,1);
});
test("lifedrain heals before simultaneous attacks, capped at 3",()=>{
  let out=play("lifedrain","attack",{hp:[1,1]});
  assert.deepEqual(hp(out),[1,0]);
  assert.equal(out.winner,0);
  out=play("lifedrain","guard",{hp:[2,3]});
  assert.deepEqual(hp(out),[2,3]);
  out=play("lifedrain","counter",{hp:[2,3]});
  assert.deepEqual(hp(out),[1,3]);
  out=play("lifedrain","armor",{hp:[2,3]});
  assert.deepEqual(hp(out),[3,3],"shield hit heals life");
  assert.deepEqual(shield(out),[0,1],"shield absorbs hit");
  out=play("lifedrain","charge");
  assert.equal(out.players[0].hp,3,"maxHP capped");
});
test("armor + lifedrain + burn interact on subsequent turns",()=>{
  let g=R.createGame();
  g.players.forEach(p=>{p.energy=10;});
  g=R.resolveTurn(g,"armor","guard");
  assert.deepEqual(shield(g),[2,0]);
  g=R.resolveTurn(g,"burn","attack");
  assert.deepEqual(hp(g),[2,3],"self-harm only");
  assert.deepEqual(shield(g),[1,0],"enemy attack consumes shield");
  g=R.resolveTurn(g,"lifedrain","charge");
  assert.deepEqual(hp(g),[3,2]);
});
test("all 18 legal actions symmetric by player seat; bounded state and cost",()=>{
  const moves=["charge","attack","guard",...R.CARDS.map(c=>c.id)];
  let count=0;
  for(const a of moves)for(const b of moves){
    const x=play(a,b),y=play(b,a);
    for(let i=0;i<2;i++){
      const p=x.players[i],q=y.players[1-i];
      assert.equal(p.hp,q.hp,a+"/"+b+" HP seat symmetry");
      assert.equal(p.shield,q.shield,a+"/"+b+" shield symmetry");
      assert.equal(p.energy,q.energy,a+"/"+b+" energy symmetry");
      assert.deepEqual(p.used,q.used,a+"/"+b+" used symmetry");
      assert.ok(p.hp>=0&&p.hp<=3);
      assert.ok(p.shield>=0&&p.shield<=2);
      assert.ok(p.energy>=0&&p.energy<=10);
    }
    assert.deepEqual(x.history.at(-1).damages,y.history.at(-1).damages.slice().reverse());
    count++;
  }
  assert.equal(count,18*18);
});
