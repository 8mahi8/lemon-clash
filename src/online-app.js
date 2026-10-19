/* LEMON CLASH online 1v1 lab. HTTPS + separate Firebase Auth/RTDB required.
   This file deliberately does NOT connect to BRAWL/Shokoku production.
   Never exposes an uncommitted action to the other client's Firebase path. */
(function () {
  "use strict";
  const R = window.LemonRules, P = window.LemonOnlineProtocol;
  if (!R || !P) throw new Error("Game rules / online protocol missing");
  const $ = id => document.getElementById(id);
  const ROOM_ROOT = "lemonClashRoomsV1";
  const LIB = "https://www.gstatic.com/firebasejs/10.8.0/";
  const BASIC = ["charge", "attack", "guard"];
  let firebaseApp = null, auth = null, database = null, uid = null;
  let roomRef = null, roomCode = "", seat = null;
  let game = null, selected = null, preview = null;
  let viewedTurn = 0, showRound = false, roomData = null;
  let secret = null, processing = false, queued = null, hasQueued = false, busy = false;
  let listener = null, listeningError = null;
  let pendingWrites = Object.create(null);

  function setText(id, value) { $(id).textContent = value; }
  function visible(id, yes) { $(id).classList.toggle("hidden", !yes); }
  function error(message) {
    setText("onlineError", message);
    setText("lobbyStatus", message);
    setText("msg", message);
  }
  function safeStorageKey(turn) {
    return "lemon-clash-secret-v1:" + roomCode + ":" + uid + ":" + turn;
  }
  function saveSecret(turn, action, nonce, hash) {
    const value = { turn, action, nonce, hash };
    secret = value;
    try { sessionStorage.setItem(safeStorageKey(turn), JSON.stringify(value)); } catch (e) {}
  }
  function restoreSecret(turn) {
    if (secret && secret.turn === turn) return secret;
    let stored = null;
    try { stored = sessionStorage.getItem(safeStorageKey(turn)); } catch (e) {}
    if (!stored) return null;
    try {
      const parsed = JSON.parse(stored);
      if (parsed && parsed.turn === turn && R.getMove(parsed.action) &&
          /^[a-f0-9]{64}$/.test(parsed.hash) && /^[a-f0-9]{64}$/.test(parsed.nonce)) {
        secret = parsed;
        return secret;
      }
    } catch (e) {}
    return null;
  }
  function clearSecret(turn) {
    secret = null;
    try { sessionStorage.removeItem(safeStorageKey(turn)); } catch (e) {}
  }

  function readGame(value) {
    if (!value || !Array.isArray(value.players) || value.players.length !== 2) {
      throw new Error("同期中のゲーム状態が不正です");
    }
    return {
      turn: value.turn,
      winner: value.winner === undefined ? null : value.winner,
      history: Array.isArray(value.history) ? value.history : [],
      players: value.players.map(p => ({
        hp: p.hp, energy: p.energy, used: Array.isArray(p.used) ? p.used : []
      }))
    };
  }
  function latestGame(room) {
    if (!room.states) throw new Error("ゲーム状態が見つかりません");
    const turns = Object.keys(room.states).map(Number).filter(Number.isSafeInteger);
    if (!turns.length) throw new Error("ゲーム状態が空です");
    const turn = Math.max(...turns);
    const current = readGame(room.states[String(turn)]);
    if (current.turn !== turn) throw new Error("ゲームのターン番号が一致しません");
    return current;
  }
  async function verifyPublishedState(room, latest) {
    // A client does not blindly accept a peer's reported score/energy.
    if (latest.turn === 1) return;
    const previous = room.states && room.states[String(latest.turn - 1)];
    const entries = room.rounds && room.rounds[String(latest.turn - 1)];
    if (!previous || !entries || !entries.host || !entries.guest ||
        !entries.host.reveal || !entries.guest.reveal) {
      throw new Error("未検証のターン結果が送信されました");
    }
    const earlier = readGame(previous);
    const expected = await P.resolveCommittedRound({
      hostUid: room.hostUid,
      guestUid: room.guestUid,
      game: earlier,
      round: {
        turn: earlier.turn,
        commits: { host: entries.host.hash, guest: entries.guest.hash },
        reveals: { host: entries.host.reveal, guest: entries.guest.reveal }
      }
    }, roomCode, window.crypto.subtle, R);
    if (!expected || expected.turn !== latest.turn || expected.winner !== latest.winner) {
      throw new Error("両端末のターン結果が一致していません");
    }
    for (let i = 0; i < 2; i++) {
      const a = expected.players[i], b = latest.players[i];
      if (a.hp !== b.hp || a.energy !== b.energy ||
          JSON.stringify(a.used) !== JSON.stringify(b.used)) {
        throw new Error("HP・エネルギー・使用済みカードが同期していません");
      }
    }
  }

  function resetSelection() {
    selected = null;
    preview = null;
    const info = $("cardDetail");
    info.replaceChildren();
    const heading = document.createElement("strong");
    heading.textContent = "カードを選ぼう";
    const detail = document.createElement("p");
    detail.textContent = "カードを選択すると、ここに能力が表示されます。";
    info.append(heading, detail);
    setText("selectedDetail", "行動を選択してください");
  }
  function displayStatus() {
    if (!game) return;
    const selfIndex = seat === "host" ? 0 : 1;
    const self = game.players[selfIndex], other = game.players[1 - selfIndex];
    setText("myName", "YOU · " + (selfIndex + 1) + "P");
    setText("opName", "RIVAL · " + (2 - selfIndex) + "P");
    setText("myHp", "♥ " + self.hp + "/5");
    setText("opHp", "♥ " + other.hp + "/5");
    setText("myEn", "⚡ " + self.energy + "/7");
    setText("opEn", "⚡ " + other.energy + "/7");
    $("opMeter").classList.toggle("danger", other.energy === 7);
    visible("opWarning", other.energy === 7 && game.winner === null);
    for (const [id, n] of [["myMeter", self.energy], ["opMeter", other.energy]]) {
      const meter = $(id);
      meter.replaceChildren();
      for (let i = 0; i < 7; i++) {
        const bar = document.createElement("i");
        if (i < n) bar.className = "on";
        meter.append(bar);
      }
    }
  }
  function createMove(id, player) {
    const move = R.getMove(id);
    const used = R.isCard(id) && player.used.includes(id);
    const valid = R.validMove(player, id);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "move cost" + move.cost + (preview === id ? " selected" : "") +
      (!valid && !used ? " unaffordable" : "");
    button.disabled = used;
    button.setAttribute("aria-pressed", String(preview === id));
    button.setAttribute("aria-label", move.name + " 消費" + move.cost + (used ? " 使用済み" : ""));
    for (const [css, text] of [
      ["cost", "⚡ " + move.cost],
      ["symbol", used ? "✓" : move.icon],
      ["movename", move.name],
      ["effect", used ? "使用済み" : move.description]
    ]) {
      const elem = document.createElement("span");
      elem.className = css;
      elem.textContent = text;
      button.append(elem);
    }
    button.addEventListener("click", () => {
      preview = id;
      selected = valid ? id : null;
      const title = document.createElement("strong");
      title.textContent = move.icon + " " + move.name + " · ⚡" + move.cost;
      const desc = document.createElement("p");
      desc.textContent = move.description + (R.isCard(id) ? "（使い切り）" : "");
      $("cardDetail").replaceChildren(title, desc);
      setText("selectedDetail", valid ? "確定すると取り消せません。" :
        "必要なエネルギーが足りません（⚡" + move.cost + "）");
      drawHand();
    });
    return button;
  }
  function drawHand() {
    if (!game || !seat) return;
    const self = game.players[seat === "host" ? 0 : 1];
    const cards = $("cards"), scroll = cards.scrollLeft;
    $("basics").replaceChildren(...BASIC.map(id => createMove(id, self)));
    cards.replaceChildren(...R.CARDS.map(card => createMove(card.id, self)));
    cards.scrollLeft = scroll;
    $("confirm").disabled = !selected || !R.validMove(self, selected) || busy;
  }
  function drawLog() {
    const elem = $("logList");
    elem.replaceChildren();
    const history = game.history.slice(-10).reverse();
    if (!history.length) { elem.textContent = "まだ対戦履歴はありません。"; return; }
    for (const entry of history) {
      const row = document.createElement("div");
      row.className = "logrow";
      row.textContent = "TURN " + entry.turn + "　" + (entry.messages || []).join(" / ");
      elem.append(row);
    }
  }
  function showLastTurn() {
    const elem = $("roundResult");
    elem.replaceChildren();
    const last = game.history[game.history.length - 1];
    const wrap = document.createElement("div");
    wrap.className = "result";
    const heading = document.createElement("h2");
    if (game.winner === "draw") heading.textContent = "引き分け！";
    else if (game.winner !== null) heading.textContent =
      game.winner === (seat === "host" ? 0 : 1) ? "勝利！" : "敗北…";
    else heading.textContent = "同時公開！";
    const actions = document.createElement("p");
    actions.textContent = last ? "P1：" + R.getMove(last.moves[0]).name +
      " ／ P2：" + R.getMove(last.moves[1]).name : "対戦開始";
    const details = document.createElement("p");
    details.textContent = last ? last.messages.slice(2).join(" / ") : "";
    const advance = document.createElement("button");
    advance.className = "btn";
    advance.textContent = game.winner !== null ? "タイトルに戻る" : "次のターンへ";
    advance.addEventListener("click", () => {
      if (game.winner !== null) return leave();
      viewedTurn = game.turn;
      showRound = false;
      resetSelection();
      redraw();
    });
    wrap.append(heading, actions, details, advance);
    elem.append(wrap);
  }
  function redraw() {
    if (!game || !seat) return;
    visible("home", false);
    visible("onlineLobby", false);
    visible("battle", true);
    displayStatus();
    drawLog();
    if (game.winner !== null || showRound) {
      visible("pickArea", false);
      visible("onlineWait", false);
      visible("roundResult", true);
      showLastTurn();
      return;
    }
    visible("roundResult", false);
    const ownEntry = roomData && roomData.rounds &&
      roomData.rounds[String(game.turn)] && roomData.rounds[String(game.turn)][seat];
    const isWaiting = !!(ownEntry && ownEntry.hash);
    visible("pickArea", !isWaiting);
    visible("onlineWait", isWaiting);
    if (isWaiting) {
      const other = seat === "host" ? "guest" : "host";
      const opponent = roomData.rounds[String(game.turn)] &&
        roomData.rounds[String(game.turn)][other];
      setText("onlineWait", opponent && opponent.hash ?
        "両者が確定！ 行動を同時公開しています…" : "行動を確定しました。相手の選択を待っています…");
    } else drawHand();
    setText("msg", "TURN " + game.turn + " · " + (isWaiting ?
      "確定待機中" : "相手の行動を読んで選択しよう"));
  }
  function showWaitingRoom() {
    visible("home", false);
    visible("battle", false);
    visible("onlineLobby", true);
    setText("lobbyCode", roomCode);
    setText("lobbyStatus", "友達の参加を待っています（ルーム " + roomCode + "）");
  }
  function turnPendingPath(turn) { return "rounds/" + turn + "/" + seat; }
  async function transaction(ref, updater) {
    const result = await ref.transaction(updater, undefined, false);
    return result.committed;
  }
  async function submit() {
    if (!game || game.winner !== null || !seat || !selected || busy || !roomRef) return;
    const own = game.players[seat === "host" ? 0 : 1];
    if (!R.validMove(own, selected)) return;
    const turn = game.turn, action = selected;
    const nonce = P.freshNonce(window.crypto);
    busy = true;
    $("confirm").disabled = true;
    try {
      const hash = await P.makeCommit(roomCode, turn, uid, action, nonce, window.crypto.subtle);
      // Never send action or nonce to the database until both players have committed.
      saveSecret(turn, action, nonce, hash);
      const ref = roomRef.child(turnPendingPath(turn));
      const ok = await transaction(ref, current => current === null ? { hash } : undefined);
      if (!ok) throw new Error("このターンはすでに行動確定済みです");
      selected = null;
      preview = null;
      setText("msg", "行動確定。相手を待っています…");
    } catch (e) {
      error("確定に失敗しました: " + (e.message || String(e)));
    } finally {
      busy = false;
    }
  }
  async function synchronize(room) {
    if (!room) {
      leave();
      error("対戦ルームがなくなりました。新しい部屋を作成してください");
      return;
    }
    if (room.protocol !== P.VERSION) throw new Error("対戦プロトコルのバージョンが異なります");
    if (room.hostUid !== uid && room.guestUid !== uid) {
      throw new Error("このルームの参加権限がありません");
    }
    roomData = room;
    if (!room.guestUid) { showWaitingRoom(); return; }
    const incoming = latestGame(room);
    if (!game || incoming.turn !== game.turn) {
      await verifyPublishedState(room, incoming);
      if (game && incoming.turn > game.turn) clearSecret(game.turn);
      game = incoming;
      selected = null;
      preview = null;
      resetSelection();
      showRound = game.turn > viewedTurn && game.turn > 1;
      if (game.turn === 1 && viewedTurn === 0) viewedTurn = 1;
    } else game = incoming;
    redraw();
    if (game.winner !== null) return;
    const turn = game.turn;
    const entries = room.rounds && room.rounds[String(turn)] || {};
    const me = entries[seat] || null;
    const otherSeat = seat === "host" ? "guest" : "host";
    const them = entries[otherSeat] || null;
    // Automatically reveal only after BOTH hashed commitments have been stored.
    if (me && me.hash && them && them.hash && !me.reveal) {
      const pending = restoreSecret(turn);
      if (!pending) {
        setText("onlineWait", "確定済みの秘密情報が失われました。新しい部屋を作り直してください。");
        return;
      }
      const hash = await P.makeCommit(roomCode, turn, uid, pending.action, pending.nonce,
        window.crypto.subtle);
      if (hash !== me.hash) throw new Error("保存された選択とコミットが一致しません");
      const key = "reveal:" + turn;
      if (!pendingWrites[key]) {
        pendingWrites[key] = true;
        try {
          await transaction(roomRef.child(turnPendingPath(turn)), current => {
            if (!current || !current.hash || current.hash !== pending.hash || current.reveal) return;
            return { hash: current.hash, reveal: { action: pending.action, nonce: pending.nonce } };
          });
        } finally { pendingWrites[key] = false; }
      }
    }
    if (me && me.reveal && them && them.reveal && !room.states[String(turn + 1)]) {
      const phase = {
        turn, commits: {
          host: entries.host.hash, guest: entries.guest.hash
        }, reveals: {
          host: entries.host.reveal, guest: entries.guest.reveal
        }
      };
      const resolved = await P.resolveCommittedRound({
        hostUid: room.hostUid, guestUid: room.guestUid, game,
        round: phase
      }, roomCode, window.crypto.subtle, R);
      if (resolved) {
        const key = "resolve:" + turn;
        if (!pendingWrites[key]) {
          pendingWrites[key] = true;
          try {
            await transaction(roomRef.child("states/" + (turn + 1)),
              current => current === null ? resolved : undefined);
          } finally { pendingWrites[key] = false; }
        }
      }
    }
  }
  async function processQueue() {
    if (processing) return;
    processing = true;
    try {
      while (hasQueued) {
        const data = queued;
        hasQueued = false;
        queued = null;
        await synchronize(data);
      }
    } catch (e) {
      error("通信データを処理できません: " + (e.message || String(e)));
    } finally {
      processing = false;
      if (hasQueued) processQueue();
    }
  }
  function observe(ref) {
    if (roomRef && listener) roomRef.off("value", listener);
    roomRef = ref;
    listener = snapshot => { queued = snapshot.val(); hasQueued = true; processQueue(); };
    listeningError = e => error("Firebaseの読み取り権限または通信に問題があります: " + e.message);
    ref.on("value", listener, listeningError);
  }
  function leave() {
    if (roomRef && listener) roomRef.off("value", listener);
    roomRef = null; listener = null; roomCode = ""; seat = null; secret = null;
    roomData = null; game = null; selected = null; preview = null;
    viewedTurn = 0; showRound = false; busy = false; processing = false; queued = null; hasQueued = false;
    pendingWrites = Object.create(null);
    visible("home", true);
    visible("onlineLobby", false);
    visible("battle", false);
    resetSelection();
    setText("onlineError", "別の対戦をするには、新しい部屋を作成または参加してね。");
  }
  async function loadSDK(name) {
    if (document.querySelector('script[data-firebase-sdk="' + name + '"]')) return;
    await new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = LIB + name;
      script.dataset.firebaseSdk = name;
      script.onload = resolve;
      script.onerror = () => {
        script.remove();
        reject(new Error("Firebase SDKを読み込めません（学校ネットワーク制限の可能性）"));
      };
      document.head.append(script);
    });
  }
  async function initializeFirebase() {
    const config = window.LEMON_FIREBASE_CONFIG;
    if (!config || !["apiKey", "authDomain", "databaseURL", "projectId", "appId"].every(k =>
      typeof config[k] === "string" && config[k])) {
      throw new Error("専用Firebaseテスト環境が未設定です。src/firebase-config.js を設定してください");
    }
    if (!/^https:\/\/[a-z0-9.-]+\.(?:firebaseio\.com|firebasedatabase\.app)\/?$/i.test(config.databaseURL)) {
      throw new Error("専用Firebase RTDBのURLが不正です");
    }
    if (!window.crypto || !window.crypto.subtle) {
      throw new Error("HTTPSなどの安全なコンテキストで開いてください");
    }
    if (!window.firebase || !window.firebase.auth || !window.firebase.database) {
      await loadSDK("firebase-app-compat.js");
      await loadSDK("firebase-auth-compat.js");
      await loadSDK("firebase-database-compat.js");
    }
    firebaseApp = window.firebase.apps.length ? window.firebase.app() :
      window.firebase.initializeApp(config);
    auth = firebaseApp.auth();
    database = firebaseApp.database();
    // Never point published GitHub Pages / Google Sites at a local emulator.
    if (window.__LEMON_EMULATOR_ONLY__ === true && config.projectId === "demo-lemon-clash" &&
        (window.location.hostname === "127.0.0.1" || window.location.protocol === "about:")) {
      auth.useEmulator("http://127.0.0.1:9099");
      database.useEmulator("127.0.0.1", 9000);
    }
    const session = auth.currentUser || (await auth.signInAnonymously()).user;
    if (!session || !session.uid) throw new Error("匿名ログインに失敗しました");
    uid = session.uid;
  }
  async function makeRoom() {
    if (busy) return;
    busy = true;
    $("onlineHost").disabled = $("onlineJoin").disabled = true;
    setText("onlineError", "Firebaseへ接続しています…");
    try {
      await initializeFirebase();
      for (let i = 0; i < 8; i++) {
        const code = P.generateRoomCode(window.crypto);
        const ref = database.ref(ROOM_ROOT + "/" + code);
        const initial = {
          protocol: P.VERSION,
          createdAt: Date.now(),
          hostUid: uid,
          states: { 1: R.createGame() }
        };
        const ok = await transaction(ref, current => current === null ? initial : undefined);
        if (!ok) continue;
        roomCode = code;
        seat = "host";
        viewedTurn = 1;
        showWaitingRoom();
        observe(ref);
        return;
      }
      throw new Error("ルームを作れませんでした。しばらく待って再試行してください");
    } catch (e) {
      error("部屋作成失敗: " + (e.message || String(e)));
    } finally {
      busy = false;
      $("onlineHost").disabled = $("onlineJoin").disabled = false;
    }
  }
  async function joinRoom() {
    if (busy) return;
    const code = $("roomInput").value.replace(/\s+/g, "");
    if (!P.validRoomCode(code)) {
      error("部屋コードは6桁の数字で入力してください");
      return;
    }
    busy = true;
    $("onlineHost").disabled = $("onlineJoin").disabled = true;
    setText("onlineError", "部屋に参加しています…");
    try {
      await initializeFirebase();
      const ref = database.ref(ROOM_ROOT + "/" + code);
      const snapshot = await ref.once("value");
      const current = snapshot.val();
      if (!current || current.protocol !== P.VERSION) throw new Error("この部屋は見つかりません");
      const returningHost = current.hostUid === uid;
      if (!returningHost && current.guestUid && current.guestUid !== uid) {
        throw new Error("この部屋は満員です");
      }
      if (Date.now() - current.createdAt > 7200000) throw new Error("この部屋の有効期限が切れています");
      if (!returningHost && !current.guestUid) {
        const ok = await transaction(ref.child("guestUid"),
          data => data === null ? uid : undefined);
        if (!ok) throw new Error("別の人が先に入室しました");
      }
      roomCode = code;
      seat = returningHost ? "host" : "guest";
      viewedTurn = 1;
      showWaitingRoom();
      observe(ref);
    } catch (e) {
      error("部屋参加失敗: " + (e.message || String(e)));
    } finally {
      busy = false;
      $("onlineHost").disabled = $("onlineJoin").disabled = false;
    }
  }
  $("onlineHost").addEventListener("click", makeRoom);
  $("onlineJoin").addEventListener("click", joinRoom);
  $("roomInput").addEventListener("keydown", event => {
    if (event.key === "Enter") joinRoom();
  });
  $("confirm").addEventListener("click", submit);
  $("onlineLobbyExit").addEventListener("click", leave);
  $("quit").addEventListener("click", leave);
  resetSelection();
})();
