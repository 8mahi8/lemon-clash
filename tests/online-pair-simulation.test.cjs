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
const deepCopy=value=>value===undefined?undefined:JSON.parse(JSON.stringify(value));

class Element {
  constructor(tag="div"){
    this.tag=tag;this.children=[];this.attrs={};this.listeners={};
    this.className="";this.textContent="";this.value="";this.disabled=false;this.scrollLeft=0;
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
  constructor(){this.data={};this.listeners=[];this.failures=[];}
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
    const old=deepCopy(this.db.get(this.path)),next=updater(old);
    if(next===undefined)return {committed:false};
    if(!this.db.permit(this.uid,this.path,true,next,old)){
      throw new Error("PERMISSION_DENIED "+this.path);
    }
    this.db.put(this.path,next);this.db.notify(this.path);
    return {committed:true};
  }
  async once(){
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
test("independent simulated clients complete nine turns, reject strangers and rejoin",async()=>{
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
  for(let turn=1;turn<=9;turn++){
    if(turn>1){host.advance();guest.advance();}
    const hostAction=turn===1||turn%2===1?"通常攻撃":"チャージ";
    const guestAction=turn===2?"通常攻撃":"チャージ";
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
  const final=db.get("lemonClashRoomsV1/"+code+"/states/10");
  assert.equal(final.winner,0);
  assert.deepEqual(final.players.map(player=>player.hp),[4,0]);
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


test("online ultimate works after six charge rounds and ends the match",async()=>{
  const db=new InMemoryRealtimeDatabase();
  const host=client(db,"ultimate-host"),guest=client(db,"ultimate-guest");
  await host.click("onlineHost");
  await waitUntil(()=>/^[0-9]{6}$/.test(host.el("lobbyCode").textContent),"ultimate-room code");
  const code=host.el("lobbyCode").textContent;
  guest.el("roomInput").value=code;
  await guest.click("onlineJoin");
  await waitUntil(()=>host.visible("battle")&&guest.visible("battle"),"ultimate-room joined");
  for(let turn=1;turn<=6;turn++){
    if(turn>1){host.advance();guest.advance();}
    host.card("チャージ");guest.card("チャージ");
    await host.click("confirm");await guest.click("confirm");
    await waitUntil(()=>host.visible("roundResult")&&guest.visible("roundResult"),"charge "+turn);
  }
  assert.match(host.el("myEn").textContent,/7\/7/);
  host.advance();guest.advance();
  host.card("終局宣告");
  await host.click("confirm");
  const hostEntry=db.get("lemonClashRoomsV1/"+code+"/rounds/7/host");
  assert.equal(hostEntry.reveal,undefined,"ultimate choice must remain secret before both commits");
  guest.card("通常防御");
  await guest.click("confirm");
  await waitUntil(()=>host.visible("roundResult")&&guest.visible("roundResult"),"ultimate reveal");
  const final=db.get("lemonClashRoomsV1/"+code+"/states/8");
  assert.equal(final.winner,0);
  assert.deepEqual(final.players.map(p=>p.hp),[5,5]);
  assert.equal(final.players[0].used.includes("judgment"),true);
  assert.match(host.el("roundResult").children[0].children[0].textContent,/勝利/);
  assert.match(guest.el("roundResult").children[0].children[0].textContent,/敗北/);
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
  assert.equal(db.get("lemonClashRoomsV1/"+code+"/states/2").players[1].hp,4);
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
