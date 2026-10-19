/* LEMON CLASH offline UI v0.1. No Firebase or network calls. */
(function () {
  "use strict";
  const R = window.LemonRules;
  if (!R) throw new Error("rules.js が読み込まれていません");
  const $ = id => document.getElementById(id);
  let game = null;
  let mode = "bot";
  let acting = 0;
  let selected = null;
  let firstMove = null;
  let inResults = false;
  const BASIC_ORDER = ["charge", "attack", "guard"];

  function start(which) {
    mode = which;
    game = R.createGame();
    acting = 0;
    selected = null;
    firstMove = null;
    inResults = false;
    resetCardDetail();
    $("home").classList.add("hidden");
    $("battle").classList.remove("hidden");
    $("roundResult").classList.add("hidden");
    $("pickArea").classList.remove("hidden");
    $("handoff").classList.add("hidden");
    render();
  }

  function resetCardDetail() {
    const detail = $("cardDetail");
    detail.replaceChildren();
    const title = document.createElement("strong");
    title.textContent = "カードを選ぼう";
    const description = document.createElement("p");
    description.textContent = "カードをタップすると持ち上がり、ここに能力が表示されます。";
    detail.append(title, description);
    $("selectedDetail").textContent = "行動を選択してください";
  }

  function status() {
    const self = game.players[acting];
    const foe = game.players[1 - acting];
    $("myName").textContent = "PLAYER " + (acting + 1) + "（選択中）";
    $("opName").textContent = mode === "bot" ? "BOT" : "PLAYER " + (2 - acting);
    $("myHp").textContent = "♥ " + self.hp;
    $("myEn").textContent = "⚡ " + self.energy;
    $("opHp").textContent = "♥ " + foe.hp;
    $("opEn").textContent = "⚡ " + foe.energy + "/7";
    $("myHp").textContent += "/5";
    $("opHp").textContent += "/5";
    $("myEn").textContent += "/7";
    for (const [id, value] of [["myMeter", self.energy], ["opMeter", foe.energy]]) {
      const meter = $(id); meter.replaceChildren();
      for (let n = 0; n < 7; n++) { const seg = document.createElement("i"); if (n < value) seg.className = "on"; meter.append(seg); }
    }
  }

  function moveButton(id, player) {
    const move = R.getMove(id);
    const used = R.isCard(id) && player.used.includes(id);
    const canPlay = R.validMove(player, id);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "move cost" + move.cost + (selected === id ? " selected" : "");
    btn.disabled = used;
    if (!canPlay && !used) btn.classList.add("unaffordable");
    btn.setAttribute("aria-pressed", selected === id ? "true" : "false");
    btn.setAttribute("aria-label", move.name + " 消費" + move.cost + (used ? " 使用済み" : ""));
    const badge = document.createElement("span");
    badge.className = "cost";
    badge.textContent = "⚡ " + move.cost;
    const icon = document.createElement("span");
    icon.className = "symbol";
    icon.textContent = used ? "✓" : move.icon;
    const name = document.createElement("span");
    name.className = "movename";
    name.textContent = move.name;
    const desc = document.createElement("span");
    desc.className = "effect";
    desc.textContent = used ? "使用済み" : move.description;
    btn.append(badge, icon, name, desc);
    btn.addEventListener("click", () => {
      if (!canPlay) {
        $("selectedDetail").textContent = "エネルギーが足りません（必要 ⚡" + move.cost + "）";
        $("confirm").disabled = true;
        selected = null;
      } else selected = id;
      renderMoves();
      $("selectedDetail").textContent = move.name + "： " + move.description;
      $("cardDetail").replaceChildren();
      const title = document.createElement("strong"); title.textContent = move.icon + " " + move.name + " · ⚡" + move.cost;
      const detail = document.createElement("p"); detail.textContent = move.description + (R.isCard(id) ? "（使い切り）" : "（何度でも使用可能）");
      $("cardDetail").append(title, detail);
      $("confirm").disabled = !canPlay;
    });
    return btn;
  }

  function renderMoves() {
    const player = game.players[acting];
    const basics = $("basics");
    const cards = $("cards");
    const cardScroll = cards.scrollLeft;
    basics.replaceChildren(...BASIC_ORDER.map(id => moveButton(id, player)));
    cards.replaceChildren(...R.CARDS.map(card => moveButton(card.id, player)));
    cards.scrollLeft = cardScroll;
    $("confirm").disabled = !selected || !R.validMove(player, selected);
    if (!selected) $("selectedDetail").textContent = "行動を選択してください";
  }

  function renderLog() {
    const box = $("logList");
    box.replaceChildren();
    const turns = game.history.slice().reverse().slice(0, 12);
    if (!turns.length) {
      box.textContent = "まだ対戦履歴はありません。";
      return;
    }
    turns.forEach(t => {
      const row = document.createElement("div");
      row.className = "logrow";
      const strong = document.createElement("strong");
      strong.textContent = "TURN " + t.turn + "　";
      row.append(strong, document.createTextNode(t.messages.join(" / ")));
      box.append(row);
    });
  }

  function render() {
    if (!game) return;
    status();
    $("msg").textContent = "TURN " + game.turn + " · PLAYER " + (acting + 1) + " の行動を選ぼう";
    $("pickArea").classList.toggle("hidden", inResults);
    $("roundResult").classList.toggle("hidden", !inResults);
    if (!inResults) renderMoves();
    renderLog();
  }

  function botMove() {
    const player = game.players[1];
    const enemy = game.players[0];
    const moves = R.availableMoves(player);
    const weights = {
      charge: 20, attack: 20, guard: 15,
      feint: 7, drain: 9, read: 7, pierce: 10, counter: 11,
      seal: 8, volley: 7, crush: 11, final: 7, allin: 7, judgment: 100
    };
    if (player.energy === 0) { weights.charge = 90; weights.guard = 10; }
    if (player.energy >= R.MAX_ENERGY) weights.charge = 0;
    if (enemy.energy === 0) {
      weights.guard = 2;
      weights.attack = 24;
      weights.drain = 19;
    }
    if (enemy.energy >= 3) {
      weights.read = 16;
      weights.counter = 18;
      weights.guard = 12;
      weights.judgment = 30;
    }
    if (player.energy === 7 && moves.includes("judgment")) return "judgment";
    if (enemy.hp === 1) {
      weights.pierce = 25;
      weights.crush = 16;
      weights.final = 19;
      weights.attack = 18;
    }
    let total = 0;
    for (const id of moves) total += weights[id] || 1;
    let draw = Math.random() * total;
    for (const id of moves) {
      draw -= weights[id] || 1;
      if (draw <= 0) return id;
    }
    return moves[0];
  }

  function commit() {
    if (!game || inResults || !selected || !R.validMove(game.players[acting], selected)) return;
    const move = selected;
    selected = null;
    if (mode === "local" && acting === 0) {
      firstMove = move;
      resetCardDetail(); // 直前の選択情報を次の人に見せない
      $("handoffTitle").textContent = "PLAYER 2 に端末を渡そう";
      $("handoffBody").textContent = "PLAYER 1 の選択は確定したよ。PLAYER 2 は見ないで選択してね。";
      $("handoffProceed").textContent = "PLAYER 2 の選択へ";
      $("handoff").classList.remove("hidden");
      return;
    }
    const a = mode === "bot" ? move : firstMove;
    const b = mode === "bot" ? botMove() : move;
    try {
      game = R.resolveTurn(game, a, b);
      firstMove = null;
      acting = 0;
      inResults = true;
      showResults();
    } catch (e) {
      $("msg").textContent = "行動を解決できませんでした: " + e.message;
    }
  }

  function showResults() {
    render();
    const t = game.history[game.history.length - 1];
    $("msg").textContent = "TURN " + t.turn + " · 同時公開！";
    const container = $("roundResult");
    container.replaceChildren();
    const reveal = document.createElement("div");
    reveal.className = "turnReveal";
    for (let i = 0; i < 2; i++) {
      const mv = R.getMove(t.moves[i]);
      const box = document.createElement("div");
      box.className = "revealPiece";
      const icon = document.createElement("div");
      icon.className = "big"; icon.textContent = mv.icon;
      const label = document.createElement("b");
      label.textContent = (i === 1 && mode === "bot" ? "BOT" : "PLAYER " + (i + 1)) + "：" + mv.name;
      const detail = document.createElement("small");
      detail.textContent = "消費 ⚡" + mv.cost;
      box.append(icon, label, detail);
      reveal.append(box);
    }
    container.append(reveal);
    const result = document.createElement("div");
    result.className = "result";
    const headline = document.createElement("h2");
    const summary = document.createElement("p");
    summary.textContent = t.messages.slice(2).join(" / ") || t.messages.join(" / ");
    const button = document.createElement("button");
    button.className = "btn";
    if (game.winner === null) {
      headline.textContent = "次の一手を読め。";
      button.textContent = "次のターンへ";
      button.addEventListener("click", () => {
        inResults = false;
        acting = 0;
        selected = null;
        resetCardDetail();
        render();
      });
    } else {
      headline.textContent = game.winner === "draw" ? "引き分け！" :
        (game.winner === 1 && mode === "bot" ? "BOTの勝利！" : "PLAYER " + (game.winner + 1) + " の勝利！");
      button.textContent = "再戦する";
      button.addEventListener("click", () => start(mode));
    }
    result.append(headline, summary, button);
    container.append(result);
  }

  $("botStart").addEventListener("click", () => start("bot"));
  $("localStart").addEventListener("click", () => start("local"));
  $("confirm").addEventListener("click", commit);
  $("handoffProceed").addEventListener("click", () => {
    acting = 1;
    selected = null;
    $("handoff").classList.add("hidden");
    render();
  });
  $("quit").addEventListener("click", () => {
    game = null; firstMove = null; selected = null;
    $("handoff").classList.add("hidden");
    $("battle").classList.add("hidden");
    $("home").classList.remove("hidden");
  });
})();
