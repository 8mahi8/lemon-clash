const {test}=require("node:test");
const assert=require("node:assert/strict");
const R=require("../src/rules.js");
const ids=["charge","attack","guard",...R.CARDS.map(c=>c.id)];
test("all legal one-turn matchups remain within game bounds",()=>{
 let count=0;
 for(let a=0;a<=R.MAX_ENERGY;a++)for(let b=0;b<=R.MAX_ENERGY;b++){
  const g=R.createGame();g.players[0].energy=a;g.players[1].energy=b;
  for(const x of ids)for(const y of ids){
   if(!R.validMove(g.players[0],x)||!R.validMove(g.players[1],y))continue;
   const next=R.resolveTurn(g,x,y);count++;
   for(const p of next.players){assert.ok(p.hp>=0&&p.hp<=R.START_HP);assert.ok(p.energy>=0&&p.energy<=R.MAX_ENERGY);assert.equal(new Set(p.used).size,p.used.length)}
  }
 }
 assert.ok(count>6000);
});
