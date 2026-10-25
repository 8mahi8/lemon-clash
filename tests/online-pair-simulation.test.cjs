/*
 * Deterministic 2-client simulation using the REAL online application and
 * protocol source but an in-memory fake DOM and fake Firebase SDK.
 *
 * This is NOT a browser test and NOT an RTDB Rules emulator. The real
 * WebKit+Firebase emulator test remains the release gate.
 *
 * Run: node --test tests/online-pair-simulation.test.cjs
 */
"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const root=path.resolve(__dirname,"..");
const sources=["src/rules.js","src/online-protocol.js","src/online-app.js"]
  .map(p=>fs.readFileSync(path.join(root,p),"utf8"));
// Realtime Database snapshots enumerate object fields by key order, which can
// differ from the original JavaScript insertion order. Simulate that on
// EVERY fake wire read/write so our tests catch false history mismatches.
function firebaseOrderedCopy(value) {
  if (value === undefined) return undefined;
  const parsed=JSON.parse(JSON.stringify(value));
  function reorder(node) {
    if (Array.isArray(node)) return node.map(reorder);
    if (!node || typeof node!=="object") return node;
    const sorted={};
    for(const key of Object.keys(node).sort()) sorted[key]=reorder(node[key]);
    return sorted;
  }
  return reorder(parsed);
}
const deepCopy=firebaseOrderedCopy;

class Element {
  constructor(tag="div"){
    this.tag=tag;this.children=[];this.attrs={};this.listeners={};
    this.className="";this.textContent="";this.value="";this.disabled=false;this.scrollLeft=0;this.style={};
    this.classes=new Set();
    this.classList={
      toggle:(name,force)=>{
        if(force===undefined)force=!this.classes.has(name);
        if(force)this.classes.add(name);else this.classes.delete(name);
      },
      contains:name=>this.classes.has(name)
    };
  }
  replaceChildren(...children){this.children=children;this.textContent="";}
  append(...children){this.children.push(...children);}
  setAttribute(name,value){this.attrs[name]=value;}
  addEventListener(type,handler){this.listeners[type]=handler;}
  click(){
    assert.equal(this.disabled,false,"disabled control was clicked");
    return this.listeners.click?.();
  }
}
class Document {
  constructor(){this.elements=new Map();this.head=new Element("head");}
  getElementById(id){
    if(!this.elements.has(id)){
      const element=new Element();
      if(["battle","onlineLobby","roundResult","onlineWait","handoff"].includes(id))element.classList.toggle("hidden",true);
      this.elements.set(id,element);
    }
    return this.elements.get(id);
  }
  createElement(tag){return new Element(tag);}
  querySelector(){return null;}
}
class InMemoryRealtimeDatabase {
  constructor(){this.data={};this.listeners=[];this.failures=[];this.rejectNextTransaction=null;this.deferReadPath=null;this.resumeDeferredRead=null;}
  get(path){
    let value=this.data;
    for(const part of path.split("/").filter(Boolean)){
      if(value===null||value===undefined)return null;
      value=value[part];
    }
    return value===undefined?null:value;
  }
  put(path,value){
    const parts=path.split("/").filter(Boolean);
    let obj=this.data;
    for(const part of parts.slice(0,-1)){obj[part]??={};obj=obj[part];}
    obj[parts[parts.length-1]]=deepCopy(value);
  }
  permit(uid,path,isWrite,value,old){
    const parts=path.split("/").filter(Boolean);
    if(parts[0]!=="lemonClashRoomsV1"||!parts[1])return false;
    const room=this.get(parts.slice(0,2).join("/"));
    if(!isWrite){
      return !room||room.hostUid===uid||room.guestUid===uid||
        (!room.guestUid&&room.createdAt>Date.now()-7200000);
    }
    if(parts.length===2)return !room&&value?.hostUid===uid;
    if(!room)return false;
    if(parts.length===3&&parts[2]==="chatMessages"){
      if(uid!==room.hostUid&&uid!==room.guestUid)return false;
      if(!Array.isArray(value)||value.length<1||value.length>20)return false;
      const previous=Array.isArray(old)?old:[];
      if(JSON.stringify(value.slice(0,-1))!==JSON.stringify(previous.slice(-19)))return false;
      const newest=value[value.length-1],seat=uid===room.hostUid?"host":"guest";
      return newest?.seat===seat&&typeof newest.text==="string"&&
        newest.text.length>0&&newest.text.length<=120&&
        Number.isFinite(newest.at);
    }
    if(parts.length===4&&parts[2]==="rematch"){
      const seat=parts[3];
      const owner=seat==="host"?room.hostUid:room.guestUid;
      const states=room.states||{};
      const latest=states[Math.max(...Object.keys(states).map(Number))];
      return owner===uid && value===true && !old && latest && latest.winner!==null;
    }
    if(parts.length===3&&parts[2]==="guestUid"){
      return !room.guestUid&&value===uid&&room.hostUid!==uid;
    }
    if(parts.length===5&&parts[2]==="rounds"){
      const seat=parts[4],other=seat==="host"?"guest":"host";
      const owner=seat==="host"?room.hostUid:room.guestUid;
      if(owner!==uid)return false;
      if(!old)return typeof value?.hash==="string"&&value.hash.length===64&&!value.reveal;
      return old.hash===value?.hash&&!old.reveal&&!!value.reveal&&
        !!room.rounds?.[parts[3]]?.[other]?.hash;
    }
    if(parts.length===4&&parts[2]==="states"){
      return !old&&(uid===room.hostUid||uid===room.guestUid)&&
        value?.turn===Number(parts[3]);
    }
    return false;
  }
  notify(path){
    for(const listener of this.listeners){
      if(path===listener.path||path.startsWith(listener.path+"/")){
        const snapshot=deepCopy(this.get(listener.path));
        Promise.resolve().then(()=>listener.callback({val:()=>snapshot}))
          .catch(error=>this.failures.push(error.message));
      }
    }
  }
  ref(uid,path){return new FakeRef(this,uid,path);}
}
class FakeRef {
  constructor(db,uid,path){this.db=db;this.uid=uid;this.path=path;}
  child(path){return new FakeRef(this.db,this.uid,this.path+"/"+path);}
  async transaction(updater){
    if(this.db.rejectNextTransaction===this.path){
      this.db.rejectNextTransaction=null;
      throw new Error("Simulated one-time transaction failure");
    }
    const old=deepCopy(this.db.get(this.path)),next=updater(old);
    if(next===undefined)return {committed:false};
    if(!this.db.permit(this.uid,this.path,true,next,old)){
      throw new Error("PERMISSION_DENIED "+this.path);
    }
    this.db.put(this.path,next);this.db.notify(this.path);
    return {committed:true};
  }
  async set(next){
    const old=deepCopy(this.db.get(this.path));
    if(!this.db.permit(this.uid,this.path,true,next,old))
      throw new Error("PERMISSION_DENIED "+this.path);
    this.db.put(this.path,next);this.db.notify(this.path);
  }
  async update(patch){
    const room=this.db.get(this.path);
    if(!room || room.hostUid!==this.uid || !room.rematch?.host || !room.rematch?.guest)
      throw new Error("PERMISSION_DENIED rematch reset");
    if(Object.keys(patch).sort().join(",")!=="rematch,rounds,states")
      throw new Error("Unexpected room mutation");
    for(const [key,value] of Object.entries(patch))
      this.db.put(this.path+"/"+key,value);
    this.db.notify(this.path);
  }
  async once(){
    if(this.db.deferReadPath===this.path){
      this.db.deferReadPath=null;
      await new Promise(resolve=>{this.db.resumeDeferredRead=resolve});
    }
    if(!this.db.permit(this.uid,this.path,false)){
      throw new Error("PERMISSION_DENIED read "+this.path);
    }
    return {val:()=>deepCopy(this.db.get(this.path))};
  }
  on(event,callback){
    if(!this.db.permit(this.uid,this.path,false)){
      throw new Error("PERMISSION_DENIED listen "+this.path);
    }
    this.db.listeners.push({path:this.path,callback});
    Promise.resolve().then(()=>callback({val:()=>deepCopy(this.db.get(this.path))}))
      .catch(error=>this.db.failures.push(error.message));
  }
  off(event,callback){
    this.db.listeners=this.db.listeners.filter(
      x=>x.path!==this.path||x.callback!==callback);
  }
}
let randomCounter=1;
const fakeCrypto={
  getRandomValues(array){
    for(let i=0;i<array.length;i++)array[i]=(randomCounter++*9719)>>>0;
    return array;
  },
  subtle:{
    async digest(algorithm,bytes){
      assert.equal(algorithm,"SHA-256");
      // Deterministic mock digest, NOT cryptographic. Crypto tests are separate.
      let hash=2166136261;
      for(const byte of bytes)hash=Math.imul(hash^byte,16777619)>>>0;
      const result=new Uint8Array(32);
      for(let i=0;i<32;i++){
        hash=Math.imul(hash^i,16777619)>>>0;
        result[i]=hash&255;
      }
      return result.buffer;
    }
  }
};
function client(db,uid){
  const document=new Document(),storage=new Map();
  const auth={
    currentUser:{uid},
    async signInAnonymously(){return {user:{uid}};},
    useEmulator(){}
  };
  const database={
    // Match the actual shared-RTDB client identifier, not the simulated Auth UID.
    ref:path=>db.ref(
      window.LEMON_FIREBASE_CONFIG.mode==="shared-rtdb" ?
        window.localStorage.getItem("lemon-clash-player-id-v1") : uid,path),
    useEmulator(){}
  };
  const app={auth:()=>auth,database:()=>database};
  const firebase={
    apps:[],auth:()=>auth,database:()=>database,
    initializeApp(){firebase.apps.push(app);return app;},
    app:()=>app
  };
  const localStorage={
    getItem:key=>storage.get("persist:"+key)||null,
    setItem:(key,val)=>storage.set("persist:"+key,val)
  };
  const window={
    firebase,crypto:fakeCrypto,localStorage,
    location:{hostname:"simulated.test",protocol:"https:"},
    LEMON_FIREBASE_CONFIG:{
      mode:"shared-rtdb",databaseURL:"https://simulated.firebaseio.com"
    }
  };
  const sessionStorage={
    setItem:(key,val)=>storage.set(key,val),
    getItem:key=>storage.get(key)||null,
    removeItem:key=>storage.delete(key)
  };
  for(const text of sources){
    new Function("window","document","sessionStorage","TextEncoder",text)(
      window,document,sessionStorage,TextEncoder);
  }
  const el=id=>document.getElementById(id);
  return {
    uid,window,el,click:id=>el(id).click(),
    card:name=>{
      const button=[...el("basics").children,...el("cards").children].find(
        element=>element.attrs["aria-label"]?.startsWith(name));
      assert.ok(button,"missing basic action "+name);
      return button.click();
    },
    advance:()=>{
      const button=el("roundResult").children[0]?.children[3];
      assert.ok(button,"missing next turn button");
      return button.click();
    },
    visible:id=>!el(id).classList.contains("hidden")
  };
}
async function waitUntil(predicate,description){
  for(let attempt=0;attempt<12000;attempt++){
    if(predicate())return;
    await Promise.resolve();
  }
  throw new Error("Timed out: "+description);
}
test("independent simulated clients complete a 5-turn HP3 match, reject strangers and rejoin",async()=>{
  const db=new InMemoryRealtimeDatabase();
  const host=client(db,"sim-host"),guest=client(db,"sim-guest"),stranger=client(db,"sim-other");
  await host.click("onlineHost");
  await waitUntil(()=>/^[0-9]{6}$/.test(host.el("lobbyCode").textContent),"room creation");
  const code=host.el("lobbyCode").textContent;
  guest.el("roomInput").value=code;
  await guest.click("onlineJoin");
  await waitUntil(()=>host.visible("battle")&&guest.visible("battle"),"room join");
  stranger.el("roomInput").value=code;
  await stranger.click("onlineJoin");
  assert.match(stranger.el("onlineError").textContent,/部屋参加失敗/);
  assert.equal(stranger.visible("battle"),false);
  for(let turn=1;turn<=5;turn++){
    if(turn>1){host.advance();guest.advance();}
    const hostAction=turn===1||turn%2===1?"通常攻撃":"チャージ";
    const guestAction=turn===5?"通常攻撃":"チャージ";
    host.card(hostAction);guest.card(guestAction);
    await host.click("confirm");
    if(turn===1){
      const commitment=db.get("lemonClashRoomsV1/"+code+"/rounds/1/host");
      assert.match(commitment.hash,/^[a-f0-9]{64}$/);
      assert.equal(commitment.reveal,undefined,"host must not reveal before guest commit");
    }
    await guest.click("confirm");
    await waitUntil(()=>host.visible("roundResult")&&guest.visible("roundResult"),
      "round "+turn);
    if(turn===2){
      await guest.click("quit");
      guest.el("roomInput").value=code;
      await guest.click("onlineJoin");
      await waitUntil(()=>guest.visible("battle")&&guest.visible("roundResult"),"guest returns");
      assert.match(guest.el("myName").textContent,/2P/);
      await host.click("quit");
      host.el("roomInput").value=code;
      await host.click("onlineJoin");
      await waitUntil(()=>host.visible("battle")&&host.visible("roundResult"),"host returns");
      assert.match(host.el("myName").textContent,/1P/);
    }
  }
  assert.match(host.el("roundResult").children[0].children[0].textContent,/勝利/);
  assert.match(guest.el("roundResult").children[0].children[0].textContent,/敗北/);
  const final=db.get("lemonClashRoomsV1/"+code+"/states/6");
  assert.equal(final.winner,0);
  assert.deepEqual(final.players.map(player=>player.hp),[2,0]);
  assert.deepEqual(db.failures,[]);
});


test("online mirrored turns keep HP and energy in sync after charge interruption",async()=>{
  const db=new InMemoryRealtimeDatabase();
  const host=client(db,"charge-block-host"),guest=client(db,"charge-block-guest");
  await host.click("onlineHost");
  await waitUntil(()=>host.visible("onlineLobby"),"interrupt lobby");
  const code=host.el("lobbyCode").textContent;
  guest.el("roomInput").value=code;
  await guest.click("onlineJoin");
  await waitUntil(()=>host.visible("battle")&&guest.visible("battle"),"interrupt join");
  host.card("通常攻撃");guest.card("チャージ");
  await host.click("confirm");await guest.click("confirm");
  await waitUntil(()=>host.visible("roundResult")&&guest.visible("roundResult"),"interrupt first reveal");
  let state=db.get("lemonClashRoomsV1/"+code+"/states/2");
  assert.deepEqual(state.players.map(p=>[p.hp,p.energy]),[[3,0],[2,1]]);
  assert.match(state.history[0].messages.join(" "),/P2のチャージが通常攻撃で中断/);
  assert.match(host.el("opEn").textContent,/1\/10/);
  assert.match(guest.el("myEn").textContent,/1\/10/);
  host.advance();guest.advance();
  host.card("チャージ");guest.card("通常攻撃");
  await host.click("confirm");await guest.click("confirm");
  await waitUntil(()=>host.visible("roundResult")&&guest.visible("roundResult"),"interrupt reverse reveal");
  state=db.get("lemonClashRoomsV1/"+code+"/states/3");
  assert.deepEqual(state.players.map(p=>[p.hp,p.energy]),[[2,0],[2,0]]);
  assert.match(state.history[1].messages.join(" "),/P1のチャージが通常攻撃で中断/);
  assert.match(host.el("myEn").textContent,/0\/10/);
  assert.match(guest.el("opEn").textContent,/0\/10/);
  assert.deepEqual(db.failures,[]);
});

test("Phase 3 result cards show both actions and damage from each player's perspective",async()=>{
  const db=new InMemoryRealtimeDatabase();
  const host=client(db,"view-host"),guest=client(db,"view-guest");
  await host.click("onlineHost");
  await waitUntil(()=>/^[0-9]{6}$/.test(host.el("lobbyCode").textContent),"UI room code");
  const code=host.el("lobbyCode").textContent;
  guest.el("roomInput").value=code;
  await guest.click("onlineJoin");
  await waitUntil(()=>host.visible("battle")&&guest.visible("battle"),"UI pair");
  host.card("通常攻撃");
  guest.card("チャージ");
  await host.click("confirm");
  await guest.click("confirm");
  await waitUntil(()=>host.visible("roundResult")&&guest.visible("roundResult"),"UI reveal");
  const h=host.el("roundResult").children[0];
  const g=guest.el("roundResult").children[0];
  assert.match(h.className,/result-turn/);
  assert.match(h.className,/result-enter/);
  assert.match(host.el("msg").textContent,/TURN 1 · 行動公開/);
  assert.match(guest.el("msg").textContent,/TURN 1 · 行動公開/);
  assert.equal(h.children[1].children.length,2);
  assert.equal(g.children[1].children.length,2);
  const hOwn=h.children[1].children[0].children;
  const hRival=h.children[1].children[1].children;
  assert.match(hOwn[0].textContent,/YOU/);
  assert.equal(hOwn[2].textContent,"通常攻撃");
  assert.equal(hOwn[3].textContent,"⚡1 · 被ダメージ 0");
  assert.match(hRival[0].textContent,/RIVAL/);
  assert.equal(hRival[2].textContent,"チャージ");
  assert.equal(hRival[3].textContent,"⚡0 · 被ダメージ -1");
  assert.match(g.children[1].children[0].children[0].textContent,/RIVAL/);
  assert.match(g.children[1].children[1].children[0].textContent,/YOU/);
  assert.equal(g.children[3].textContent,"次のターンへ");
  assert.equal(host.el("myFighter").classList.contains("critical"),false);
  // Repeated Firebase snapshots must not replay the entrance animation.
  db.notify("lemonClashRoomsV1/"+code);
  await waitUntil(()=>
    !host.el("roundResult").children[0].className.includes("result-enter"),
    "result animation is not replayed");
  assert.deepEqual(db.failures,[]);
});

test("Phase 3 one-HP warning appears on both perspectives and clears after defeat",async()=>{
  const db=new InMemoryRealtimeDatabase();
  const host=client(db,"critical-host"),guest=client(db,"critical-guest");
  await host.click("onlineHost");
  await waitUntil(()=>host.visible("onlineLobby"),"warning room");
  const code=host.el("lobbyCode").textContent;
  guest.el("roomInput").value=code;
  await guest.click("onlineJoin");
  await waitUntil(()=>host.visible("battle")&&guest.visible("battle"),"warning join");
  for(let turn=1;turn<=5;turn++){
    if(turn>1){host.advance();guest.advance();}
    host.card(turn%2===1?"通常攻撃":"チャージ");
    guest.card("チャージ");
    await host.click("confirm");await guest.click("confirm");
    await waitUntil(()=>host.visible("roundResult")&&guest.visible("roundResult"),"warning turn "+turn);
    if(turn===3){
      assert.match(guest.el("myHp").textContent,/1\/3/);
      assert.equal(guest.el("myFighter").classList.contains("critical"),true);
      assert.equal(host.el("opFighter").classList.contains("critical"),true);
    }
  }
  assert.equal(guest.el("myFighter").classList.contains("critical"),false);
  assert.equal(host.el("opFighter").classList.contains("critical"),false);
  assert.match(host.el("roundResult").children[0].className,/result-win/);
  assert.match(guest.el("roundResult").children[0].className,/result-lose/);
  assert.match(host.el("msg").textContent,/MATCH END · 勝利/);
  assert.match(guest.el("msg").textContent,/MATCH END · 敗北/);
  assert.deepEqual(db.failures,[]);
});

test("room deletion clears both connected clients and returns to lobby",async()=>{
  const db=new InMemoryRealtimeDatabase();
  const host=client(db,"deleted-host"),guest=client(db,"deleted-guest");
  await host.click("onlineHost");
  await waitUntil(()=>/^[0-9]{6}$/.test(host.el("lobbyCode").textContent),"deleted-room code");
  const code=host.el("lobbyCode").textContent;
  guest.el("roomInput").value=code;
  await guest.click("onlineJoin");
  await waitUntil(()=>host.visible("battle")&&guest.visible("battle"),"deleted-room join");
  const path="lemonClashRoomsV1/"+code;
  db.put(path,null);
  db.notify(path);
  await waitUntil(()=>host.visible("home")&&guest.visible("home"),"deleted-room recovery");
  assert.match(host.el("onlineError").textContent,/なくなりました/);
  assert.match(guest.el("onlineError").textContent,/なくなりました/);
  assert.equal(host.visible("battle"),false);
  assert.equal(guest.visible("battle"),false);
  assert.deepEqual(db.failures,[]);
});


test("Firebase key reordering cannot cause a false round mismatch, but data tampering is rejected",async()=>{
  const db=new InMemoryRealtimeDatabase();
  const host=client(db,"order-host"),guest=client(db,"order-guest");
  await host.click("onlineHost");
  await waitUntil(()=>host.visible("onlineLobby"),"key-order lobby");
  const code=host.el("lobbyCode").textContent;
  guest.el("roomInput").value=code;
  await guest.click("onlineJoin");
  await waitUntil(()=>host.visible("battle")&&guest.visible("battle"),"key-order joining");
  host.card("通常攻撃");
  guest.card("チャージ");
  await host.click("confirm");await guest.click("confirm");
  await waitUntil(()=>host.visible("roundResult")&&guest.visible("roundResult"),
    "round must survive Firebase key sorting");
  const saved=db.get("lemonClashRoomsV1/"+code+"/states/2");
  assert.deepEqual(Object.keys(saved.history[0]),["damages","messages","moves","turn"],
    "fake Firebase reorders stored history keys like its snapshot converter");
  assert.equal(saved.winner,null);
  assert.deepEqual(saved.players.map(p=>p.hp),[3,2]);

  // Make a real change to a published result. A fresh client must NOT accept it.
  await guest.click("quit");
  const wrong=deepCopy(saved);
  wrong.history[0].messages[0]="FAKE ACTION!";
  db.put("lemonClashRoomsV1/"+code+"/states/2",wrong);
  guest.el("roomInput").value=code;
  await guest.click("onlineJoin");
  await waitUntil(()=>/両端末のターン結果が一致していません/.test(
    guest.el("onlineError").textContent),"tampered result is still rejected");
  assert.deepEqual(db.failures,[]);
});

test("rejects a tampered initial match before either player can play",async()=>{
  const db=new InMemoryRealtimeDatabase();
  const host=client(db,"forged-host"),guest=client(db,"forged-guest");
  await host.click("onlineHost");
  await waitUntil(()=>/^[0-9]{6}$/.test(host.el("lobbyCode").textContent),"tampered-room code");
  const code=host.el("lobbyCode").textContent;
  const roomPath="lemonClashRoomsV1/"+code;
  const room=deepCopy(db.get(roomPath));
  room.states["1"].players[0].hp=99;
  db.put(roomPath,room);
  guest.el("roomInput").value=code;
  await guest.click("onlineJoin");
  await waitUntil(()=>/開始時のゲーム状態が正しくありません/.test(guest.el("onlineError").textContent),
    "reject forged starting HP");
  assert.equal(guest.visible("battle"),false);
  assert.deepEqual(db.failures,[]);
});


test("online judgment takes priority over a same-turn attack after nine charge rounds",async()=>{
  const db=new InMemoryRealtimeDatabase();
  const host=client(db,"ultimate-host"),guest=client(db,"ultimate-guest");
  await host.click("onlineHost");
  await waitUntil(()=>/^[0-9]{6}$/.test(host.el("lobbyCode").textContent),"ultimate-room code");
  const code=host.el("lobbyCode").textContent;
  guest.el("roomInput").value=code;
  await guest.click("onlineJoin");
  await waitUntil(()=>host.visible("battle")&&guest.visible("battle"),"ultimate-room joined");
  for(let turn=1;turn<=9;turn++){
    if(turn>1){host.advance();guest.advance();}
    host.card("チャージ");guest.card("チャージ");
    await host.click("confirm");await guest.click("confirm");
    await waitUntil(()=>host.visible("roundResult")&&guest.visible("roundResult"),"charge "+turn);
  }
  assert.match(host.el("myEn").textContent,/10\/10/);
  assert.match(guest.el("opEn").textContent,/10\/10/,
    "both players must display the new energy cap");
  assert.equal(host.el("myMeter").children.length,10,
    "the player meter must have ten energy segments");
  assert.equal(guest.el("opMeter").children.length,10,
    "the rival meter must have ten energy segments");
  assert.equal(host.visible("opWarning"),true,
    "a fully charged opponent must display the ultimate warning");
  assert.equal(guest.visible("opWarning"),true,
    "warning must agree on both endpoints");
  host.advance();guest.advance();
  host.card("終局宣告");
  await host.click("confirm");
  const hostEntry=db.get("lemonClashRoomsV1/"+code+"/rounds/10/host");
  assert.equal(hostEntry.reveal,undefined,"ultimate choice must remain secret before both commits");
  guest.card("通常攻撃");
  await guest.click("confirm");
  await waitUntil(()=>host.visible("roundResult")&&guest.visible("roundResult"),"ultimate reveal");
  const final=db.get("lemonClashRoomsV1/"+code+"/states/11");
  assert.equal(final.winner,0);
  assert.deepEqual(final.players.map(p=>p.hp),[3,3], "judgment bearer takes no damage");
  assert.match(final.history[final.history.length-1].messages.join(" "),/終局宣告が成立/);
  assert.equal(final.players[0].used.includes("judgment"),true);
  assert.match(host.el("roundResult").children[0].children[0].textContent,/勝利/);
  assert.match(guest.el("roundResult").children[0].children[0].textContent,/敗北/);
  assert.deepEqual(db.failures,[]);
});


test("simultaneous lethal attack starts hidden-commit sudden death; ties repeat; win and rematch work",async()=>{
  const db=new InMemoryRealtimeDatabase();
  const host=client(db,"draw-host"),guest=client(db,"draw-guest");
  await host.click("onlineHost");
  await waitUntil(()=>host.visible("onlineLobby"),"draw lobby");
  const code=host.el("lobbyCode").textContent;
  guest.el("roomInput").value=code;
  await guest.click("onlineJoin");
  await waitUntil(()=>host.visible("battle")&&guest.visible("battle"),"draw joined");
  for(let turn=1;turn<=5;turn++){
    if(turn>1){host.advance();guest.advance();}
    const move=turn%2===1?"通常攻撃":"チャージ";
    host.card(move);guest.card(move);
    await host.click("confirm");await guest.click("confirm");
    await waitUntil(()=>host.visible("roundResult")&&guest.visible("roundResult"),
      "draw turn "+turn);
  }
  const sudden=db.get("lemonClashRoomsV1/"+code+"/states/6");
  assert.equal(sudden.winner,null);
  assert.equal(sudden.suddenDeath,true);
  assert.deepEqual(sudden.players.map(p=>p.hp),[0,0]);
  assert.match(host.el("roundResult").children[0].children[0].textContent,/SUDDEN DEATH/);
  assert.match(guest.el("roundResult").children[0].children[0].textContent,/SUDDEN DEATH/);
  host.advance();guest.advance();
  await waitUntil(()=>host.visible("pickArea")&&guest.visible("pickArea"),"sudden choice");
  assert.equal(host.el("basics").children.length,3);
  assert.equal(guest.el("basics").children.length,3);
  assert.equal(host.el("cards").children.length,0);
  assert.equal(host.el("specialHeading").classList.contains("hidden"),true);
  assert.match(host.el("msg").textContent,/SUDDEN DEATH/);
  host.card("攻撃");
  await host.click("confirm");
  assert.equal(db.get("lemonClashRoomsV1/"+code+"/rounds/6/host").reveal,undefined,
    "sudden choice remains secret until BOTH players commit");
  guest.card("攻撃");
  await guest.click("confirm");
  await waitUntil(()=>host.visible("roundResult")&&guest.visible("roundResult"),
    "sudden tie repeat");
  const tied=db.get("lemonClashRoomsV1/"+code+"/states/7");
  assert.equal(tied.winner,null);
  assert.equal(tied.suddenDeath,true);
  assert.deepEqual(tied.players,sudden.players,"tie costs no resources");
  assert.match(host.el("roundResult").children[0].children[0].textContent,/同じ手/);
  host.advance();guest.advance();
  host.card("防御");guest.card("攻撃");
  await host.click("confirm");await guest.click("confirm");
  await waitUntil(()=>host.visible("roundResult")&&guest.visible("roundResult"),
    "sudden guard beats attack");
  const decided=db.get("lemonClashRoomsV1/"+code+"/states/8");
  assert.equal(decided.winner,0);
  assert.equal(decided.suddenDeath,true);
  assert.deepEqual(decided.players,tied.players,"winner chosen without HP restoration");
  assert.match(host.el("roundResult").children[0].children[0].textContent,/勝利/);
  assert.match(guest.el("roundResult").children[0].children[0].textContent,/敗北/);
  await host.el("roundResult").children[0].children[3].click();
  await guest.el("roundResult").children[0].children[3].click();
  await waitUntil(()=>host.visible("pickArea")&&guest.visible("pickArea"),"sudden rematch");
  const restarted=db.get("lemonClashRoomsV1/"+code+"/states/1");
  assert.deepEqual(restarted.players.map(p=>p.hp),[3,3]);
  assert.equal(restarted.suddenDeath,false);
  assert.deepEqual(db.failures,[]);
});

test("HP1 player still reaches judgment despite two charge interruptions and wins against lethal attack",async()=>{
  const db=new InMemoryRealtimeDatabase();
  const host=client(db,"lethal-judgment-host"),guest=client(db,"lethal-judgment-guest");
  await host.click("onlineHost");
  await waitUntil(()=>host.visible("onlineLobby"),"lethal judgment lobby");
  const code=host.el("lobbyCode").textContent;
  guest.el("roomInput").value=code;
  await guest.click("onlineJoin");
  await waitUntil(()=>host.visible("battle")&&guest.visible("battle"),"lethal judgment joined");
  // Two interrupted charges postpone the ten-energy ultimate by two extra turns.
  for(let turn=1;turn<=11;turn++){
    if(turn>1){host.advance();guest.advance();}
    host.card("チャージ");
    guest.card(turn===1||turn===3?"通常攻撃":"チャージ");
    await host.click("confirm");await guest.click("confirm");
    await waitUntil(()=>host.visible("roundResult")&&guest.visible("roundResult"),
      "lethal judgment setup "+turn);
  }
  assert.match(host.el("myHp").textContent,/1\/3/);
  assert.match(host.el("myEn").textContent,/10\/10/);
  host.advance();guest.advance();
  host.card("終局宣告");guest.card("通常攻撃");
  await host.click("confirm");await guest.click("confirm");
  await waitUntil(()=>host.visible("roundResult")&&guest.visible("roundResult"),
    "lethal judgment result");
  const final=db.get("lemonClashRoomsV1/"+code+"/states/13");
  assert.equal(final.winner,0);
  assert.deepEqual(final.players.map(p=>p.hp),[1,3],
    "judgment must protect the declarer's remaining HP");
  assert.match(host.el("roundResult").children[0].children[0].textContent,/勝利/);
  assert.match(guest.el("roundResult").children[0].children[0].textContent,/敗北/);
  assert.match(host.el("roundResult").children[0].className,/result-win/);
  assert.match(guest.el("roundResult").children[0].className,/result-lose/);
  assert.match(host.el("msg").textContent,/MATCH END · 勝利/);
  assert.match(guest.el("msg").textContent,/MATCH END · 敗北/);
  assert.deepEqual(db.failures,[]);
});

test("a player may leave after committing and rejoin before opponent reveals",async()=>{
  const db=new InMemoryRealtimeDatabase();
  const host=client(db,"reveal-host"),guest=client(db,"reveal-guest");
  await host.click("onlineHost");
  await waitUntil(()=>/^[0-9]{6}$/.test(host.el("lobbyCode").textContent),"reveal-room code");
  const code=host.el("lobbyCode").textContent;
  guest.el("roomInput").value=code;
  await guest.click("onlineJoin");
  await waitUntil(()=>host.visible("battle")&&guest.visible("battle"),"reveal-room joined");
  host.card("通常攻撃");
  await host.click("confirm");
  const previous=db.get("lemonClashRoomsV1/"+code+"/rounds/1/host");
  assert.match(previous.hash,/^[a-f0-9]{64}$/);
  assert.equal(previous.reveal,undefined);
  await host.click("quit");
  host.el("roomInput").value=code;
  await host.click("onlineJoin");
  await waitUntil(()=>host.visible("battle")&&host.visible("onlineWait"),"host rejoin pending reveal");
  guest.card("チャージ");
  await guest.click("confirm");
  await waitUntil(()=>host.visible("roundResult")&&guest.visible("roundResult"),
    "both reveal after returning host");
  const after=db.get("lemonClashRoomsV1/"+code+"/rounds/1/host");
  assert.ok(after.reveal,"restored secret must be revealed after guest commit");
  assert.equal(db.get("lemonClashRoomsV1/"+code+"/states/2").players[1].hp,2);
  assert.deepEqual(db.failures,[]);
});


test("delayed listener from an exited room cannot move a new room into battle",async()=>{
  const db=new InMemoryRealtimeDatabase();
  const host=client(db,"stale-host"),guest=client(db,"stale-guest");
  await host.click("onlineHost");
  await waitUntil(()=>/^[0-9]{6}$/.test(host.el("lobbyCode").textContent),"first room");
  const first=host.el("lobbyCode").textContent;
  guest.el("roomInput").value=first;
  await guest.click("onlineJoin");
  await waitUntil(()=>host.visible("battle"),"first battle");
  const callback=db.listeners.find(item=>
    item.path==="lemonClashRoomsV1/"+first).callback;
  const staleRoom=deepCopy(db.get("lemonClashRoomsV1/"+first));
  await host.click("quit");
  await host.click("onlineHost");
  await waitUntil(()=>host.visible("onlineLobby"),"second lobby");
  const second=host.el("lobbyCode").textContent;
  assert.notEqual(first,second);
  callback({val:()=>staleRoom}); // already queued by Firebase before unsubscribe
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(host.visible("battle"),false);
  assert.equal(host.el("lobbyCode").textContent,second);
  assert.deepEqual(db.failures,[]);
});

test("a delayed hash from a previous room cannot submit into the next room",async()=>{
  const db=new InMemoryRealtimeDatabase();
  const host=client(db,"slow-hash-host");
  await host.click("onlineHost");
  await waitUntil(()=>host.visible("onlineLobby"),"slow hash first lobby");
  const first=host.el("lobbyCode").textContent;
  // Add a guest so that the host can select a move.
  const guest=client(db,"slow-hash-guest");
  guest.el("roomInput").value=first;
  await guest.click("onlineJoin");
  await waitUntil(()=>host.visible("battle"),"slow hash joined");
  const subtle=host.window.crypto.subtle;
  const original=subtle.digest;
  let release=null;
  try{
    subtle.digest=(...args)=>new Promise(resolve=>{
      release=()=>resolve(original(...args));
    });
    host.card("通常攻撃");
    const submission=host.click("confirm");
    await waitUntil(()=>typeof release==="function","slow digest reached");
    await host.click("quit");
    await host.click("onlineHost");
    await waitUntil(()=>host.visible("onlineLobby"),"new lobby after slow digest");
    const second=host.el("lobbyCode").textContent;
    release();
    await submission;
    assert.equal(db.get("lemonClashRoomsV1/"+first+"/rounds/1/host"),null);
    assert.equal(db.get("lemonClashRoomsV1/"+second+"/rounds/1/host"),null);
    assert.equal(host.el("lobbyCode").textContent,second);
    assert.equal(host.visible("battle"),false);
    assert.deepEqual(db.failures,[]);
  }finally{
    subtle.digest=original;
  }
});


test("both players vote to rematch; second HP3 match starts clean with results visible",async()=>{
  const db=new InMemoryRealtimeDatabase();
  const host=client(db,"rematch-host"),guest=client(db,"rematch-guest");
  await host.click("onlineHost");
  await waitUntil(()=>/^[0-9]{6}$/.test(host.el("lobbyCode").textContent),"rematch room");
  const code=host.el("lobbyCode").textContent;
  guest.el("roomInput").value=code;
  await guest.click("onlineJoin");
  await waitUntil(()=>host.visible("battle")&&guest.visible("battle"),"rematch join");
  // In five turns: host attacks at 1,3,5, charges at 2,4.
  for(let turn=1;turn<=5;turn++){
    if(turn>1){host.advance();guest.advance()}
    host.card(turn%2===1?"通常攻撃":"チャージ");
    guest.card("チャージ");
    await host.click("confirm");await guest.click("confirm");
    await waitUntil(()=>host.visible("roundResult")&&guest.visible("roundResult"),"rematch match turn "+turn);
  }
  const first=db.get("lemonClashRoomsV1/"+code+"/states/6");
  assert.deepEqual(first.players.map(p=>p.hp),[3,0]);
  assert.equal(first.winner,0);
  // Gemini's result UI missed this title; it must remain visible.
  assert.match(host.el("roundResult").children[0].children[0].textContent,/勝利/);
  assert.match(guest.el("roundResult").children[0].children[0].textContent,/敗北/);
  assert.match(host.el("roundResult").children[0].children[3].textContent,/再戦/);
  await host.el("roundResult").children[0].children[3].click();
  await waitUntil(()=>!!db.get("lemonClashRoomsV1/"+code+"/rematch/host"),"host rematch vote");
  assert.equal(db.get("lemonClashRoomsV1/"+code+"/states/6").winner,0,
    "one rematch vote must not reset a finished match");
  assert.match(host.el("roundResult").children[0].children[3].textContent,/相手の再戦待ち/);
  await guest.el("roundResult").children[0].children[3].click();
  await waitUntil(()=>host.visible("pickArea")&&guest.visible("pickArea")&&
    !host.visible("roundResult")&&!guest.visible("roundResult"),"rematch reset");
  const reset=db.get("lemonClashRoomsV1/"+code);
  assert.equal(reset.states["1"].turn,1);
  assert.deepEqual(reset.states["1"].players.map(p=>p.hp),[3,3]);
  assert.equal(reset.states["6"],undefined);
  assert.equal(reset.rounds,null);
  assert.equal(reset.rematch,null);
  assert.match(host.el("myHp").textContent,/3\/3/);
  assert.match(guest.el("myHp").textContent,/3\/3/);
  // The first result of the rematch must not be hidden by old viewedTurn=6.
  host.card("チャージ");guest.card("通常攻撃");
  await host.click("confirm");await guest.click("confirm");
  await waitUntil(()=>host.visible("roundResult")&&guest.visible("roundResult"),
    "round 1 result after rematch");
  assert.match(host.el("roundResult").children[0].children[0].textContent,/同時公開/);
  assert.match(host.el("roundResult").children[0].className,/result-enter/,
    "first result after a rematch should animate once again");
  assert.equal(db.get("lemonClashRoomsV1/"+code+"/states/2").players[0].hp,2);
  assert.deepEqual(db.failures,[]);
});

test("failed first move commit restores the Confirm button for a safe retry",async()=>{
  const db=new InMemoryRealtimeDatabase();
  const host=client(db,"retry-host"),guest=client(db,"retry-guest");
  await host.click("onlineHost");
  await waitUntil(()=>/^[0-9]{6}$/.test(host.el("lobbyCode").textContent),"retry room");
  const code=host.el("lobbyCode").textContent;
  guest.el("roomInput").value=code;
  await guest.click("onlineJoin");
  await waitUntil(()=>host.visible("battle")&&guest.visible("battle"),"retry join");
  host.card("通常攻撃");
  db.rejectNextTransaction="lemonClashRoomsV1/"+code+"/rounds/1/host";
  await host.click("confirm");
  assert.match(host.el("onlineError").textContent,/確定に失敗/);
  assert.equal(host.el("confirm").disabled,false,"failed commit must be retryable");
  assert.equal(db.get("lemonClashRoomsV1/"+code+"/rounds/1/host"),null);
  await host.click("confirm");
  const committed=db.get("lemonClashRoomsV1/"+code+"/rounds/1/host");
  assert.match(committed.hash,/^[0-9a-f]{64}$/);
  assert.equal(committed.reveal,undefined);
  guest.card("チャージ");
  await guest.click("confirm");
  await waitUntil(()=>host.visible("roundResult")&&guest.visible("roundResult"),"retry resolved");
  assert.equal(db.get("lemonClashRoomsV1/"+code+"/states/2").players[1].hp,2);
  assert.deepEqual(db.failures,[]);
});

test("late room lookup cannot resurrect an abandoned join",async()=>{
  const db=new InMemoryRealtimeDatabase();
  const a=client(db,"join-stale-host"),b=client(db,"join-stale-guest");
  await a.click("onlineHost");
  await waitUntil(()=>a.visible("onlineLobby"),"stale lookup room");
  const firstCode=a.el("lobbyCode").textContent;
  db.deferReadPath="lemonClashRoomsV1/"+firstCode;
  b.el("roomInput").value=firstCode;
  const firstJoin=b.click("onlineJoin");
  await waitUntil(()=>typeof db.resumeDeferredRead==="function","stalled first lookup");
  // The previous UI has been exited. We allow a different room to start.
  b.el("onlineLobbyExit").click();
  await b.click("onlineHost");
  await waitUntil(()=>b.visible("onlineLobby"),"fresh room after exit");
  const nextCode=b.el("lobbyCode").textContent;
  assert.notEqual(nextCode,firstCode);
  db.resumeDeferredRead();
  await firstJoin;
  assert.equal(b.el("lobbyCode").textContent,nextCode);
  assert.equal(b.visible("battle"),false);
  assert.equal(b.visible("onlineLobby"),true);
  assert.equal(db.get("lemonClashRoomsV1/"+firstCode+"/guestUid"),null);
  assert.deepEqual(db.failures,[]);
});

test("three consecutive HP3 games can play and rematch in the same room",async()=>{
  const db=new InMemoryRealtimeDatabase();
  const host=client(db,"loop-host"),guest=client(db,"loop-guest");
  await host.click("onlineHost");
  await waitUntil(()=>host.visible("onlineLobby"),"loop room");
  const code=host.el("lobbyCode").textContent;
  guest.el("roomInput").value=code;
  await guest.click("onlineJoin");
  await waitUntil(()=>host.visible("battle")&&guest.visible("battle"),"loop join");
  for(let match=1;match<=3;match++){
    assert.match(host.el("myHp").textContent,/3\/3/,"new match HP3");
    assert.match(guest.el("opHp").textContent,/3\/3/,"new match rival HP3");
    for(let turn=1;turn<=5;turn++){
      if(turn>1){host.advance();guest.advance();}
      host.card(turn%2===1?"通常攻撃":"チャージ");
      guest.card("チャージ");
      await host.click("confirm");
      await guest.click("confirm");
      await waitUntil(()=>host.visible("roundResult")&&guest.visible("roundResult"),
        "loop match "+match+" turn "+turn);
    }
    const final=db.get("lemonClashRoomsV1/"+code+"/states/6");
    assert.deepEqual(final.players.map(p=>p.hp),[3,0]);
    assert.equal(final.winner,0);
    if(match===3)break;
    await host.el("roundResult").children[0].children[3].click();
    await guest.el("roundResult").children[0].children[3].click();
    await waitUntil(()=>host.visible("pickArea")&&guest.visible("pickArea"),
      "rematch loop "+match);
    assert.equal(db.get("lemonClashRoomsV1/"+code+"/states/6"),null);
  }
  assert.deepEqual(db.failures,[]);
});

test("room chat reaches both clients, persists across rejoin, and does not interrupt a selected card",async()=>{
  const db=new InMemoryRealtimeDatabase();
  const host=client(db,"chat-host"),guest=client(db,"chat-guest"),outsider=client(db,"chat-other");
  await host.click("onlineHost");
  await waitUntil(()=>/^[0-9]{6}$/.test(host.el("lobbyCode").textContent),"chat room code");
  const code=host.el("lobbyCode").textContent;
  assert.equal(host.visible("roomChat"),true,"room chat available in waiting lobby");
  host.click("chatToggle");
  host.el("chatInput").value="  入室したよ  ";
  await host.click("chatSend");
  await waitUntil(()=>db.get("lemonClashRoomsV1/"+code+"/chatMessages")?.length===1,"host sent");
  assert.equal(db.get("lemonClashRoomsV1/"+code+"/chatMessages")[0].text,"入室したよ");
  guest.el("roomInput").value=code;
  await guest.click("onlineJoin");
  await waitUntil(()=>host.visible("battle")&&guest.visible("battle"),"chat battle joined");
  guest.click("chatToggle");
  await waitUntil(()=>guest.el("chatMessages").children.some(c=>c.children[1]?.textContent==="入室したよ"),
    "guest receives host message");
  guest.card("チャージ");
  const selectedBefore=guest.el("selectedDetail").textContent;
  guest.el("chatInput").value="<img src=x onerror=alert(1)>";
  await guest.click("chatSend");
  await waitUntil(()=>host.el("chatMessages").children.some(c=>c.children[1]?.textContent.includes("<img")),
    "chat synchronizes across clients");
  assert.equal(guest.el("selectedDetail").textContent,selectedBefore,"chat must not alter selected action");
  const roomMessages=db.get("lemonClashRoomsV1/"+code+"/chatMessages");
  assert.equal(roomMessages.length,2);
  assert.equal(roomMessages[1].seat,"guest");
  assert.equal(host.el("chatMessages").children[1].children[1].textContent,
    "<img src=x onerror=alert(1)>","messages are text, never interpreted as HTML");
  // Third-party clients cannot write directly into a full room.
  const strangerUid=outsider.window.localStorage.getItem("lemon-clash-player-id-v1")||
    "stranger-not-in-room";
  assert.equal(db.permit(strangerUid,"lemonClashRoomsV1/"+code+"/chatMessages",true,
    [...roomMessages,{seat:"guest",text:"侵入",at:Date.now()}],roomMessages),false);
  await guest.click("quit");
  assert.equal(guest.visible("roomChat"),false,"chat disappears when leaving");
  guest.el("roomInput").value=code;
  await guest.click("onlineJoin");
  await waitUntil(()=>guest.visible("battle"),"guest rejoined");
  guest.click("chatToggle");
  await waitUntil(()=>guest.el("chatMessages").children.length===2,"chat persists after rejoin");
  assert.deepEqual(db.failures,[]);
});
test("chat rejects overlong and blank messages before Firebase and leaves game actions untouched",async()=>{
  const db=new InMemoryRealtimeDatabase(),a=client(db,"chat-limit-host");
  await a.click("onlineHost");
  await waitUntil(()=>/^[0-9]{6}$/.test(a.el("lobbyCode").textContent),"limit room");
  const root="lemonClashRoomsV1/"+a.el("lobbyCode").textContent;
  a.click("chatToggle");
  a.el("chatInput").value=" ".repeat(8);
  await a.click("chatSend");
  assert.equal(db.get(root+"/chatMessages"),null);
  a.el("chatInput").value="a".repeat(121);
  await a.click("chatSend");
  assert.match(a.el("chatStatus").textContent,/120文字以内/);
  assert.equal(db.get(root+"/chatMessages"),null);
  assert.deepEqual(db.failures,[]);
});
