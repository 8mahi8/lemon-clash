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
  const CHAT_LIMIT = 20, CHAT_LENGTH = 120, CHAT_COOLDOWN_MS = 1500;
  let firebaseApp = null, auth = null, database = null, uid = null;
  let roomRef = null, roomCode = "", seat = null;
  let game = null, selected = null, preview = null;
  let viewedTurn = 0, showRound = false, roomData = null;
  let secret = null, processing = false, queued = null, hasQueued = false, busy = false;
  let listener = null, listeningError = null;
  let sessionEpoch = 0;
  let pendingWrites = Object.create(null);
  // Result motion plays once per revealed turn, not on every Firebase snapshot.
  let lastResultFxKey = "";
  let chatOpen = false, sendingChat = false, lastSentAt = 0, lastChatView = null;

  function setText(id, value) { $(id).textContent = value; }
  function visible(id, yes) { $(id).classList.toggle("hidden", !yes); }
  function error(message) {
    setText("onlineError", message);
    setText("lobbyStatus", message);
    setText("msg", message);
  }
  function toggleChat() {
    chatOpen = !chatOpen;
    visible("chatPanel", chatOpen);
    $("chatToggle").textContent = chatOpen ? "✕ 閉じる" : "💬 チャット";
    $("chatToggle").setAttribute("aria-expanded", String(chatOpen));
    if (chatOpen) $("chatMessages").scrollTop = $("chatMessages").scrollHeight;
  }
  function renderChat(messages) {
    const rows = Array.isArray(messages) ? messages.slice(-CHAT_LIMIT) : [];
    const signature = seat + ":" + JSON.stringify(rows);
    if (signature === lastChatView) return;
    lastChatView = signature;
    const area = $("chatMessages");
    area.replaceChildren();
    if (!rows.length) {
      const hint = document.createElement("p");
      hint.className = "chatHint";
      hint.textContent = "まだメッセージはありません。";
      area.append(hint);
    }
    for (const entry of rows) {
      if (!entry || (entry.seat !== "host" && entry.seat !== "guest") ||
          typeof entry.text !== "string") continue;
      const bubble = document.createElement("div");
      bubble.className = "chatBubble " + (entry.seat === seat ? "mine" : "theirs");
      const sender = document.createElement("strong");
      sender.textContent = entry.seat === seat ? "自分" : "相手";
      const message = document.createElement("span");
      message.textContent = entry.text.slice(0, CHAT_LENGTH);
      bubble.append(sender, message);
      area.append(bubble);
    }
    if (chatOpen) area.scrollTop = area.scrollHeight;
  }
  async function sendChat() {
    if (sendingChat || !roomRef || !seat || !roomData ||
        (roomData.hostUid !== uid && roomData.guestUid !== uid)) return;
    const input = $("chatInput");
    const value = input.value.replace(/[\r\n\t]+/g, " ").trim();
    if (!value) { setText("chatStatus", "メッセージを入力してね"); return; }
    if (value.length > CHAT_LENGTH) {
      setText("chatStatus", "120文字以内で入力してね"); return;
    }
    const timestamp = Date.now();
    if (timestamp - lastSentAt < CHAT_COOLDOWN_MS) {
      setText("chatStatus", "少し間を空けて送信してね"); return;
    }
    const activeRef = roomRef, epoch = sessionEpoch, sendingSeat = seat;
    sendingChat = true;
    $("chatSend").disabled = true;
    setText("chatStatus", "送信中…");
    try {
      const sent = await transaction(activeRef.child("chatMessages"), previous => {
        const list = Array.isArray(previous) ? previous.slice(-CHAT_LIMIT) : [];
        return [...list, { seat: sendingSeat, text: value, at: timestamp }]
          .slice(-CHAT_LIMIT);
      });
      if (epoch !== sessionEpoch || activeRef !== roomRef) return;
      if (!sent) throw new Error("書き込みを確定できませんでした");
      input.value = "";
      lastSentAt = timestamp;
      setText("chatStatus", "");
    } catch (e) {
      if (epoch === sessionEpoch && activeRef === roomRef)
        setText("chatStatus", "送信できません: " + (e.message || String(e)));
    } finally {
      if (epoch === sessionEpoch && activeRef === roomRef) {
        sendingChat = false;
        $("chatSend").disabled = false;
      }
    }
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
      suddenDeath: value.suddenDeath === true,
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
  // Firebase Realtime Database may return object keys in a different order
  // from the insertion order used when resolveTurn builds a history entry.
  // JSON.stringify(a) === JSON.stringify(b) wrongly rejects those equal states.
  // Compare the exact structure and values instead; array order still matters.
  function sameStructuredValue(a, b) {
    if (a === b) return true;
    if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    const keysA = Object.keys(a).sort(), keysB = Object.keys(b).sort();
    if (keysA.length !== keysB.length) return false;
    for (let i = 0; i < keysA.length; i++) {
      if (keysA[i] !== keysB[i] ||
          !sameStructuredValue(a[keysA[i]], b[keysB[i]])) return false;
    }
    return true;
  }
  async function verifyPublishedState(room, latest) {
    // A room creator must not inject a custom starting HP, energy or cards.
    if (latest.turn === 1) {
      const initial = R.createGame();
      if (latest.winner !== initial.winner || latest.suddenDeath !== initial.suddenDeath ||
          JSON.stringify(latest.history) !== JSON.stringify(initial.history) ||
          JSON.stringify(latest.players) !== JSON.stringify(initial.players)) {
        throw new Error("開始時のゲーム状態が正しくありません");
      }
      return;
    }
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
    if (!expected || expected.turn !== latest.turn || expected.winner !== latest.winner ||
        expected.suddenDeath !== latest.suddenDeath ||
        !sameStructuredValue(expected.history, latest.history)) {
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
    heading.textContent = game && game.suddenDeath ? "⚡ SUDDEN DEATH" : "カードを選ぼう";
    const detail = document.createElement("p");
    detail.textContent = game && game.suddenDeath ?
      "攻撃は崩しに、崩しは防御に、防御は攻撃に勝つ。相手と同じ手ならもう一度。" :
      "カードを選択すると、ここに能力が表示されます。";
    info.append(heading, detail);
    setText("selectedDetail", "行動を選択してください");
  }
  function displayStatus() {
    if (!game) return;
    const selfIndex = seat === "host" ? 0 : 1;
    const self = game.players[selfIndex], other = game.players[1 - selfIndex];
    setText("myName", "YOU · " + (selfIndex + 1) + "P");
    setText("opName", "RIVAL · " + (2 - selfIndex) + "P");
    setText("myHp", "♥ " + self.hp + "/" + R.START_HP);
    setText("opHp", "♥ " + other.hp + "/" + R.START_HP);
    setText("myEn", "⚡ " + self.energy + "/" + R.MAX_ENERGY);
    setText("opEn", "⚡ " + other.energy + "/" + R.MAX_ENERGY);
    // Static, low-cost visual indicator. Never changes game logic or HP.
    $("myFighter").classList.toggle("critical", self.hp === 1 && game.winner === null);
    $("opFighter").classList.toggle("critical", other.hp === 1 && game.winner === null);
    $("opMeter").classList.toggle("danger", other.energy >= R.MAX_ENERGY);
    visible("opWarning", other.energy >= R.MAX_ENERGY &&
      !game.suddenDeath && game.winner === null);
    for (const [id, n] of [["myMeter", self.energy], ["opMeter", other.energy]]) {
      const meter = $(id);
      meter.replaceChildren();
      for (let i = 0; i < R.MAX_ENERGY; i++) {
        const bar = document.createElement("i");
        if (i < n) bar.className = "on";
        meter.append(bar);
      }
    }
  }
  function createMove(id, player) {
    const move = R.getMove(id);
    const used = R.isCard(id) && player.used.includes(id);
    const valid = R.validMove(player, id, game.suddenDeath);
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
    const sudden = game.suddenDeath;
    $("basics").replaceChildren(...(sudden ? Object.keys(R.SUDDEN) : BASIC)
      .map(id => createMove(id, self)));
    cards.replaceChildren(...(sudden ? [] : R.CARDS.map(card => createMove(card.id, self))));
    cards.scrollLeft = scroll;
    setText("basicHeading", sudden ? "SUDDEN DEATH · 最後の3択" : "基本アクション");
    visible("specialHeading", !sudden);
    $("confirm").disabled = !selected || !R.validMove(self, selected, sudden) || busy;
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
    const ownIndex = seat === "host" ? 0 : 1;
    const status = game.winner === null ? "turn" :
      game.winner === "draw" ? "draw" : game.winner === ownIndex ? "win" : "lose";
    wrap.className = "result result-" + status;
    const effectKey = roomCode + ":" + game.turn + ":" + game.winner;
    if (lastResultFxKey !== effectKey) {
      wrap.className += " result-enter";
      lastResultFxKey = effectKey;
    }
    const heading = document.createElement("h2");
    if (game.winner === null && game.suddenDeath)
      heading.textContent = last && last.moves[0].startsWith("sd_") ?
        "同じ手！ サドンデス続行！" : "SUDDEN DEATH 突入！";
    else if (game.winner !== null) heading.textContent =
      game.winner === (seat === "host" ? 0 : 1) ? "勝利！" : "敗北…";
    else heading.textContent = "同時公開！";
    // Present both secret actions simultaneously. Each player's view marks
    // their own action so a quick glance is enough during school play.
    const actions = document.createElement("div");
    actions.className = "turnReveal";
    actions.setAttribute("aria-label", "両プレイヤーの公開した行動");
    if (last) {
      for (let i = 0; i < 2; i++) {
        const move = R.getMove(last.moves[i]);
        const piece = document.createElement("div");
        piece.className = "revealPiece " + (i === ownIndex ? "reveal-me" : "reveal-op");
        const who = document.createElement("small");
        who.className = "revealOwner";
        who.textContent = i === ownIndex ? "YOU · " + (i + 1) + "P" :
          "RIVAL · " + (i + 1) + "P";
        const symbol = document.createElement("span");
        symbol.className = "big";
        symbol.textContent = move.icon;
        const name = document.createElement("b");
        name.textContent = move.name;
        const damage = document.createElement("small");
        const taken = last.damages && Number.isFinite(last.damages[i]) ?
          last.damages[i] : 0;
        damage.textContent = "⚡" + move.cost + " · 被ダメージ " + (taken ? "-" + taken : "0");
        piece.append(who, symbol, name, damage);
        actions.append(piece);
      }
    } else {
      actions.textContent = "対戦開始";
    }
    const details = document.createElement("p");
    details.className = "resultInfo";
    details.textContent = last ? last.messages.slice(2).join(" / ") : "";
    wrap.append(heading, actions, details);

    if (game.winner !== null) {
      const myRematch = roomData && roomData.rematch && roomData.rematch[seat];
      const otherSeat = seat === "host" ? "guest" : "host";
      const otherRematch = roomData && roomData.rematch && roomData.rematch[otherSeat];

      const rematchBtn = document.createElement("button");
      rematchBtn.className = "btn";
      rematchBtn.style.marginBottom = "10px";
      rematchBtn.textContent = myRematch ?
        (otherRematch ? "再戦準備中..." : "相手の再戦待ち...") :
        "もう一度対戦する（再戦）";
      rematchBtn.disabled = !!myRematch;
      rematchBtn.addEventListener("click", async () => {
        if (!roomRef || !seat) return;
        const originalRef = roomRef, epoch = sessionEpoch;
        rematchBtn.disabled = true;
        rematchBtn.textContent = "相手の再戦待ち...";
        try {
          await originalRef.child("rematch/" + seat).set(true);
        } catch (e) {
          if (epoch === sessionEpoch && originalRef === roomRef) {
            error("再戦リクエストに失敗しました: " + (e.message || String(e)));
            rematchBtn.disabled = false;
          }
        }
      });
      wrap.append(rematchBtn);

      const titleBtn = document.createElement("button");
      titleBtn.className = "btn secondary small";
      titleBtn.textContent = "タイトルに戻る";
      titleBtn.addEventListener("click", leave);
      wrap.append(titleBtn);
    } else {
      const advance = document.createElement("button");
      advance.className = "btn";
      advance.textContent = game.suddenDeath ? "サドンデスの3択へ" : "次のターンへ";
      advance.addEventListener("click", () => {
        viewedTurn = game.turn;
        showRound = false;
        resetSelection();
        redraw();
      });
      wrap.append(advance);
    }
    elem.append(wrap);
  }
  function redraw() {
    if (!game || !seat) return;
    visible("home", false);
    visible("onlineLobby", false);
    visible("battle", true);
    visible("roomChat", true);
    displayStatus();
    drawLog();
    if (game.winner !== null || showRound) {
      // A revealed turn must not retain the stale "waiting for commit" label.
      const verdict = game.winner === "draw" ? "引き分け" :
        game.winner === (seat === "host" ? 0 : 1) ? "勝利" : "敗北";
      setText("msg", game.winner !== null ?
        "MATCH END · " + verdict :
        (game.suddenDeath ? "SUDDEN DEATH" : "TURN " + (game.turn - 1)) + " · 行動公開");
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
    setText("msg", (game.suddenDeath ? "SUDDEN DEATH" : "TURN " + game.turn) +
      " · " + (isWaiting ? "確定待機中" :
      game.suddenDeath ? "攻撃 ＞ 崩し ＞ 防御 ＞ 攻撃。同時に選択！" :
      "相手の行動を読んで選択しよう"));
  }
  function showWaitingRoom() {
    visible("home", false);
    visible("battle", false);
    visible("onlineLobby", true);
    visible("roomChat", true);
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
    if (!R.validMove(own, selected, game.suddenDeath)) return;
    const turn = game.turn, action = selected;
    const epoch = sessionEpoch, originalRoomRef = roomRef;
    const nonce = P.freshNonce(window.crypto);
    busy = true;
    $("confirm").disabled = true;
    let committed = false;
    try {
      const hash = await P.makeCommit(roomCode, turn, uid, action, nonce, window.crypto.subtle);
      // Ignore a late digest from a match already left or replaced.
      if (epoch !== sessionEpoch || originalRoomRef !== roomRef) return;
      // Never send action or nonce to the database until both players have committed.
      saveSecret(turn, action, nonce, hash);
      const ref = originalRoomRef.child(turnPendingPath(turn));
      const ok = await transaction(ref, current => current === null ? { hash } : undefined);
      if (epoch !== sessionEpoch || originalRoomRef !== roomRef) return;
      if (!ok) throw new Error("このターンはすでに行動確定済みです");
      committed = true;
      selected = null;
      preview = null;
      setText("msg", "行動確定。相手を待っています…");
      visible("pickArea", false);
      visible("onlineWait", true);
      setText("onlineWait", "行動を確定しました。相手の選択を待っています…");
    } catch (e) {
      if (epoch === sessionEpoch) {
        error("確定に失敗しました: " + (e.message || String(e)));
      }
    } finally {
      if (epoch === sessionEpoch && originalRoomRef === roomRef) {
        busy = false;
        // A denied/failed write must not permanently disable "Confirm".
        // Successful commits stay locked until a Firebase room update.
        if (!committed && game && game.winner === null && seat) drawHand();
      }
    }
  }
  async function synchronize(room, epoch) {
    if (epoch !== sessionEpoch || !seat || !roomRef) return;
    if (!room) {
      leave();
      error("対戦ルームがなくなりました。新しい部屋を作成してください");
      return;
    }
    if (room.protocol !== P.VERSION) throw new Error("対戦プロトコルのバージョンが異なります");
    if (room.hostUid !== uid && room.guestUid !== uid) {
      throw new Error("このルームの参加権限がありません");
    }
    // Chat-only snapshots must not rebuild the hand or lose its scroll position.
    // They carry no new turn, commitment or rematch data.
    const chatOnly = !!roomData && room.hostUid === roomData.hostUid &&
      room.guestUid === roomData.guestUid &&
      sameStructuredValue(room.states, roomData.states) &&
      sameStructuredValue(room.rounds, roomData.rounds) &&
      sameStructuredValue(room.rematch, roomData.rematch);
    roomData = room;
    renderChat(room.chatMessages);
    if (chatOnly) return;
    // Gemini school release: both players can opt into another game with
    // their existing 6-digit room. Only the host applies the reset.
    if (room.rematch && room.rematch.host && room.rematch.guest) {
      if (seat === "host") {
        const resetKey = "rematch-reset-exec";
        if (!pendingWrites[resetKey]) {
          pendingWrites[resetKey] = true;
          try {
            await roomRef.update({
              states: { 1: R.createGame() },
              rounds: null,
              rematch: null
            });
          } finally {
            pendingWrites[resetKey] = false;
          }
        }
      }
      return;
    }
    if (!room.guestUid) { showWaitingRoom(); return; }
    const incoming = latestGame(room);
    if (!game || incoming.turn !== game.turn) {
      await verifyPublishedState(room, incoming);
      if (epoch !== sessionEpoch || !roomRef) return;
      if (game && incoming.turn > game.turn) clearSecret(game.turn);
      if (game && incoming.turn < game.turn) {
        // Replayed turn numbers belong to a NEW match. Without resetting
        // viewedTurn, the first few results of a rematch can be hidden.
        clearSecret(game.turn);
        viewedTurn = 1;
        showRound = false;
        lastResultFxKey = "";
        pendingWrites = Object.create(null);
      }
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
      if (epoch !== sessionEpoch || !roomRef) return;
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
      if (epoch !== sessionEpoch || !roomRef) return;
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
    let processingEpoch = sessionEpoch;
    try {
      while (hasQueued) {
        const data = queued;
        hasQueued = false;
        queued = null;
        processingEpoch = data.epoch;
        await synchronize(data.room, data.epoch);
      }
    } catch (e) {
      if (processingEpoch === sessionEpoch) {
        error("通信データを処理できません: " + (e.message || String(e)));
      }
    } finally {
      processing = false;
      if (hasQueued) processQueue();
    }
  }
  function observe(ref) {
    if (roomRef && listener) roomRef.off("value", listener);
    roomRef = ref;
    const epoch = ++sessionEpoch;
    listener = snapshot => {
      if (epoch !== sessionEpoch) return;
      queued = {room: snapshot.val(), epoch};
      hasQueued = true;
      processQueue();
    };
    listeningError = e => {
      if (epoch === sessionEpoch) error("Firebaseの読み取り権限または通信に問題があります: " + e.message);
    };
    ref.on("value", listener, listeningError);
  }
  function leave() {
    if (roomRef && listener) roomRef.off("value", listener);
    sessionEpoch++;
    roomRef = null; listener = null; roomCode = ""; seat = null; secret = null;
    roomData = null; game = null; selected = null; preview = null;
    viewedTurn = 0; showRound = false; busy = false; queued = null; hasQueued = false;
    lastResultFxKey = "";
    chatOpen = false; sendingChat = false; lastSentAt = 0; lastChatView = null;
    $("chatInput").value = "";
    setText("chatStatus", "");
    visible("chatPanel", false);
    visible("roomChat", false);
    $("chatToggle").textContent = "💬 チャット";
    $("chatToggle").setAttribute("aria-expanded", "false");
    pendingWrites = Object.create(null);
    visible("home", true);
    visible("onlineLobby", false);
    visible("battle", false);
    $("onlineHost").disabled = $("onlineJoin").disabled = false;
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
  function localPlayerId() {
    // The shared RTDB used by BRAWL/Shokoku has no Firebase Auth configuration.
    // Generate a separate random local identifier; it is NOT authentication.
    // This is for private friend play only, never a security boundary.
    const key = "lemon-clash-player-id-v1";
    let id = "";
    try { id = window.localStorage.getItem(key) || ""; } catch (e) {}
    if (!/^lc-[a-f0-9]{64}$/.test(id)) {
      id = "lc-" + P.freshNonce(window.crypto);
      try { window.localStorage.setItem(key, id); } catch (e) {}
    }
    return id;
  }
  async function initializeFirebase() {
    const config = window.LEMON_FIREBASE_CONFIG;
    const shared = config && config.mode === "shared-rtdb";
    if (!config || typeof config.databaseURL !== "string" ||
        (!shared && !["apiKey", "authDomain", "projectId", "appId"].every(k =>
          typeof config[k] === "string" && config[k]))) {
      throw new Error("Firebaseの接続設定がありません");
    }
    if (!/^https:\/\/[a-z0-9.-]+\.(?:firebaseio\.com|firebasedatabase\.app)\/?$/i.test(config.databaseURL)) {
      throw new Error("Firebase RTDBのURLが不正です");
    }
    if (!window.crypto || !window.crypto.subtle) {
      throw new Error("HTTPSなどの安全なコンテキストで開いてください");
    }
    if (!window.firebase || !window.firebase.database ||
        (!shared && !window.firebase.auth)) {
      await loadSDK("firebase-app-compat.js");
      if (!shared) await loadSDK("firebase-auth-compat.js");
      await loadSDK("firebase-database-compat.js");
    }
    const appConfig = shared ? { databaseURL: config.databaseURL } : config;
    firebaseApp = window.firebase.apps.length ? window.firebase.app() :
      window.firebase.initializeApp(appConfig);
    database = firebaseApp.database();
    if (shared) {
      // Existing school games use unauthenticated RTDB. Keep Lemon writes
      // under lemonClashRoomsV1 only; do not alter any other game's rooms.
      uid = localPlayerId();
      return;
    }
    auth = firebaseApp.auth();
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
    const startedAt = sessionEpoch;
    let adoptedEpoch = startedAt;
    busy = true;
    $("onlineHost").disabled = $("onlineJoin").disabled = true;
    setText("onlineError", "Firebaseへ接続しています…");
    try {
      await initializeFirebase();
      if (startedAt !== sessionEpoch) return;
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
        if (startedAt !== sessionEpoch) return;
        if (!ok) continue;
        roomCode = code;
        seat = "host";
        viewedTurn = 1;
        showWaitingRoom();
        observe(ref);
        adoptedEpoch = sessionEpoch;
        return;
      }
      throw new Error("ルームを作れませんでした。しばらく待って再試行してください");
    } catch (e) {
      if (startedAt === sessionEpoch) error("部屋作成失敗: " + (e.message || String(e)));
    } finally {
      if (adoptedEpoch === sessionEpoch) {
        busy = false;
        $("onlineHost").disabled = $("onlineJoin").disabled = false;
      }
    }
  }
  async function joinRoom() {
    if (busy) return;
    const code = $("roomInput").value.replace(/\s+/g, "");
    if (!P.validRoomCode(code)) {
      error("部屋コードは6桁の数字で入力してください");
      return;
    }
    const startedAt = sessionEpoch;
    let adoptedEpoch = startedAt;
    busy = true;
    $("onlineHost").disabled = $("onlineJoin").disabled = true;
    setText("onlineError", "部屋に参加しています…");
    try {
      await initializeFirebase();
      if (startedAt !== sessionEpoch) return;
      const ref = database.ref(ROOM_ROOT + "/" + code);
      const snapshot = await ref.once("value");
      if (startedAt !== sessionEpoch) return;
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
        if (startedAt !== sessionEpoch) return;
        if (!ok) throw new Error("別の人が先に入室しました");
      }
      roomCode = code;
      seat = returningHost ? "host" : "guest";
      viewedTurn = 1;
      showWaitingRoom();
      observe(ref);
      adoptedEpoch = sessionEpoch;
    } catch (e) {
      if (startedAt === sessionEpoch) error("部屋参加失敗: " + (e.message || String(e)));
    } finally {
      if (adoptedEpoch === sessionEpoch) {
        busy = false;
        $("onlineHost").disabled = $("onlineJoin").disabled = false;
      }
    }
  }
  $("chatToggle").addEventListener("click", toggleChat);
  $("chatSend").addEventListener("click", sendChat);
  $("chatInput").addEventListener("keydown", event => {
    // IME Enter confirms Japanese conversion; it must not send the message.
    if (event.key === "Enter" && !event.isComposing && event.keyCode !== 229) {
      event.preventDefault();
      sendChat();
    }
  });
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
