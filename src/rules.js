/* LEMON CLASH rules v0.1 — deterministic, dependency-free */
(function (root) {
  "use strict";
  const MAX_ENERGY = 10;
  const START_HP = 3;
  const CARDS = Object.freeze([
    {"id":"feint","name":"フェイント","cost":1,"icon":"🎭","type":"utility","description":"相手が通常防御ならエネルギー+3。封印で防がれる"},
    {"id":"drain","name":"エネルギー泥棒","cost":1,"icon":"🌀","type":"utility","description":"相手のチャージを中断し、自分のエネルギー+2。封印で防がれる"},
    {"id":"read","name":"見切り","cost":1,"icon":"👁️","type":"defense","description":"特殊攻撃のダメージを防ぐ。封印で無効化される"},
    {"id":"burn","name":"生命燃焼","cost":1,"icon":"🔥","type":"utility","description":"自分のHPを1消費し、エネルギー+3。HP1では使用不可。封印で防がれる"},
    {"id":"pierce","name":"貫通攻撃","cost":2,"icon":"🗡️","type":"attack","description":"通常防御を貫通して1ダメージ。見切り・封印で防がれる"},
    {"id":"counter","name":"カウンター","cost":2,"icon":"🪞","type":"defense","description":"通常攻撃・連撃・オールイン・生命吸収・チャージ狩りのダメージを全反射。封印で無効"},
    {"id":"seal","name":"封印","cost":2,"icon":"🔒","type":"control","description":"終局宣告以外の特殊カードを無効化。成功するとエネルギー+1"},
    {"id":"chargehunter","name":"チャージ狩り","cost":2,"icon":"🎯","type":"attack","description":"1ダメージ。チャージ相手には中断＋エネルギー-1。通常防御・見切り・封印で防がれる"},
    {"id":"volley","name":"連撃","cost":3,"icon":"⚔️","type":"attack","description":"2ダメージ。通常防御・見切り・封印で防がれる"},
    {"id":"crush","name":"粉砕","cost":3,"icon":"💥","type":"attack","description":"通常防御なら2ダメージ。それ以外は効果なし。見切り・封印で防がれる"},
    {"id":"lifedrain","name":"生命吸収","cost":3,"icon":"🩸","type":"attack","description":"1ダメージ。命中時、自分のHPを1回復。通常防御・見切り・封印・カウンターで防がれる"},
    {"id":"final","name":"終焉の一撃","cost":4,"icon":"☄️","type":"attack","description":"2ダメージ。通常防御でも1ダメージ。チャージ中断。見切り・封印で防がれる"},
    {"id":"armor","name":"装甲展開","cost":4,"icon":"🛡️","type":"defense","description":"永続シールド2を獲得。発動ターンからダメージを防ぐ。封印で無効化"},
    {"id":"allin","name":"オールイン","cost":5,"icon":"🔥","type":"attack","description":"3ダメージ。通常防御・見切り・封印で防がれる"},
    {"id":"judgment","name":"終局宣告","cost":10,"icon":"👑","type":"ultimate","description":"発動時に勝利。防御・見切り・封印・シールドを無視する"}
  ]);
  const LOOKUP = Object.fromEntries(CARDS.map(function (card) { return [card.id, card]; }));
  // Sudden death is a separate zero-resource 3-way mind game.
  // Attack beats Break, Break beats Guard, Guard beats Attack.
  const SUDDEN = Object.freeze({
    sd_attack: { id: "sd_attack", name: "攻撃", cost: 0, icon: "⚔️", description: "崩しに勝つ。防御に負ける" },
    sd_guard: { id: "sd_guard", name: "防御", cost: 0, icon: "🛡️", description: "攻撃に勝つ。崩しに負ける" },
    sd_break: { id: "sd_break", name: "崩し", cost: 0, icon: "💥", description: "防御に勝つ。攻撃に負ける" }
  });
  const SD_WIN = Object.freeze({ sd_attack: "sd_break", sd_guard: "sd_attack", sd_break: "sd_guard" });
  const BASIC = Object.freeze({
    charge: { id: "charge", name: "チャージ", cost: 0, icon: "⚡", description: "エネルギー+1。通常攻撃・エネルギー泥棒・チャージ狩り・終焉の一撃で中断される" },
    attack: { id: "attack", name: "通常攻撃", cost: 1, icon: "⚔️", description: "1ダメージ。相手のチャージを中断。通常防御で防げる" },
    guard: { id: "guard", name: "通常防御", cost: 0, icon: "🛡️", description: "通常攻撃・連撃・オールイン・生命吸収・チャージ狩りを防ぐ。貫通攻撃・粉砕は防げない" }
  });

  function createPlayer() {
    return { hp: START_HP, shield: 0, energy: 1, used: [] };
  }
  function createGame() {
    return { turn: 1, players: [createPlayer(), createPlayer()], winner: null, suddenDeath: false, history: [] };
  }
  function getMove(id) { return BASIC[id] || LOOKUP[id] || SUDDEN[id] || null; }
  function isCard(id) { return !!LOOKUP[id]; }
  function validMove(player, id, suddenDeath) {
    if (suddenDeath) return !!SUDDEN[id];
    const move = BASIC[id] || LOOKUP[id];
    return !!move && player.hp > 0 && player.energy >= move.cost &&
      (id !== "burn" || player.hp > 1) &&
      (!isCard(id) || !player.used.includes(id));
  }
  function availableMoves(player, suddenDeath) {
    if (suddenDeath) return Object.keys(SUDDEN);
    return Object.keys(BASIC).concat(CARDS.map(function (c) { return c.id; }))
      .filter(function (id) { return validMove(player, id); });
  }
  function clampEnergy(v) { return Math.max(0, Math.min(MAX_ENERGY, v)); }

  function resolveTurn(game, moveA, moveB) {
    if (game.winner !== null) throw new Error("試合終了後に行動できません");
    const ids = [moveA, moveB];
    if (game.suddenDeath) {
      if (!SUDDEN[moveA] || !SUDDEN[moveB]) throw new Error("サドンデスでは3択だけ選べます");
      const winner = moveA === moveB ? null : (SD_WIN[moveA] === moveB ? 0 : 1);
      const messages = ["P1：" + SUDDEN[moveA].name, "P2：" + SUDDEN[moveB].name,
        winner === null ? "同じ手！ サドンデス続行！" : "SUDDEN DEATH 決着！"];
      return {
        turn: game.turn + 1,
        players: game.players.map(function (p) { return { hp: p.hp, shield: p.shield || 0, energy: p.energy, used: p.used.slice() }; }),
        winner: winner, suddenDeath: true,
        history: game.history.concat([{ turn: game.turn, moves: ids, damages: [0, 0], messages: messages }])
      };
    }
    const players = game.players.map(function (p) {
      return { hp: p.hp, shield: p.shield || 0, energy: p.energy, used: p.used.slice() };
    });
    ids.forEach(function (id, i) {
      if (!validMove(players[i], id, false)) throw new Error("使用できない行動: " + id);
    });
    const log = [];
    ids.forEach(function (id, i) {
      const move = getMove(id);
      players[i].energy -= move.cost;
      if (isCard(id)) players[i].used.push(id);
      log.push("P" + (i + 1) + "：" + move.name);
    });
    // All costs and single-use cards are spent on declaration, even when countered.
    const cancelled = [false, false];
    for (let i = 0; i < 2; i++) {
      const other = 1 - i;
      if (ids[i] === "seal" && isCard(ids[other]) && ids[other] !== "judgment") {
        cancelled[other] = true;
      }
    }
    if (cancelled[0] || cancelled[1]) log.push("封印によって特殊カードが無効化！");
    const gain = [0, 0], energyLoss = [0, 0];
    // Seal versus seal cancels both cards, so neither earns a refund.
    for (let i = 0; i < 2; i++) {
      const other = 1 - i;
      if (cancelled[i]) continue;
      if (ids[i] === "seal" && isCard(ids[other]) && ids[other] !== "judgment") {
        gain[i] += 1;
        log.push("P" + (i + 1) + "の封印成功！ エネルギー+1");
      } else if (ids[i] === "drain" && ids[other] === "charge") {
        cancelled[other] = true;
        gain[i] += 2;
        log.push("P" + (i + 1) + "がチャージを奪った！");
      } else if (ids[i] === "feint" && ids[other] === "guard") {
        gain[i] += 3;
        log.push("P" + (i + 1) + "のフェイント成功！");
      } else if (ids[i] === "burn") {
        gain[i] += 3;
        log.push("P" + (i + 1) + "がHPを1消費してエネルギー+3！");
      }
    }
    ids.forEach(function (id, i) {
      if (id === "charge" && !cancelled[i]) gain[i]++;
    });
    const incoming = [0, 0], lifeHit = [false, false];
    const damage = { attack: 1, pierce: 1, volley: 2, crush: 0,
      final: 2, allin: 3, lifedrain: 1, chargehunter: 1 };
    const reflectable = new Set(["attack", "volley", "allin", "lifedrain", "chargehunter"]);
    for (let i = 0; i < 2; i++) {
      const target = 1 - i, id = ids[i];
      if (cancelled[i] || damage[id] === undefined) continue;
      let amount = damage[id];
      const response = cancelled[target] ? "" : ids[target];
      if (id === "crush" && response === "guard") amount = 2;
      if (response === "guard") {
        if (id === "attack" || id === "volley" || id === "allin" ||
            id === "lifedrain" || id === "chargehunter") amount = 0;
        if (id === "final") amount = 1;
      }
      if (response === "read" && isCard(id)) amount = 0;
      if (response === "counter" && reflectable.has(id)) {
        const reflected = amount;
        amount = 0;
        incoming[i] += reflected; // Reflect damage only, never side effects.
        log.push("P" + (target + 1) + "のカウンター成功！ " + reflected + "ダメージ反射");
      }
      if (amount > 0 && response === "charge") {
        if (id === "attack" || id === "final" || id === "chargehunter") {
          gain[target] = 0;
          log.push("P" + (target + 1) + "のチャージが中断！");
        }
        if (id === "chargehunter") {
          energyLoss[target]++;
          log.push("P" + (target + 1) + "のエネルギー-1");
        }
      }
      if (id === "lifedrain" && amount > 0) lifeHit[i] = true;
      incoming[target] += amount;
    }
    const judgmentA = ids[0] === "judgment", judgmentB = ids[1] === "judgment";
    if (judgmentA !== judgmentB) {
      const declaring = judgmentA ? 0 : 1;
      incoming[declaring] = 0;
      log.push("P" + (declaring + 1) + "の終局宣告が成立！ 即時勝利");
    }
    // New armor is active this turn. Self-harm bypasses it. Lifedrain heals
    // on any landed hit (including shields), before simultaneous incoming damage.
    players.forEach(function (p, i) {
      if (ids[i] === "armor" && !cancelled[i]) {
        p.shield += 2;
        log.push("P" + (i + 1) + "がシールド2を展開！");
      }
      if (ids[i] === "burn" && !cancelled[i]) p.hp -= 1;
      if (lifeHit[i]) {
        p.hp = Math.min(START_HP, p.hp + 1);
        log.push("P" + (i + 1) + "がHPを1回復！");
      }
    });
    const absorbed = [0, 0];
    players.forEach(function (p, i) {
      p.energy = clampEnergy(p.energy + gain[i] - energyLoss[i]);
      absorbed[i] = Math.min(p.shield, incoming[i]);
      p.shield -= absorbed[i];
      p.hp = Math.max(0, p.hp - (incoming[i] - absorbed[i]));
    });
    if (absorbed[0] || absorbed[1]) {
      log.push("シールド吸収：P1 " + absorbed[0] + " / P2 " + absorbed[1]);
    }
    let winner = null;
    if (judgmentA && judgmentB) winner = "draw";
    else if (judgmentA) winner = 0;
    else if (judgmentB) winner = 1;
    else if (players[0].hp === 0 && players[1].hp === 0) winner = "draw";
    else if (players[0].hp === 0) winner = 1;
    else if (players[1].hp === 0) winner = 0;
    const suddenDeath = winner === "draw";
    if (suddenDeath) {
      winner = null;
      log.push("SUDDEN DEATH！ 攻撃・防御・崩しの3択で決着！");
    }
    if (incoming[0] || incoming[1]) {
      log.push("ダメージ：P1 -" + incoming[0] + " / P2 -" + incoming[1]);
    } else {
      log.push("このターンはダメージなし");
    }
    return {
      turn: game.turn + 1,
      players: players,
      winner: winner, suddenDeath: suddenDeath,
      history: game.history.concat([{ turn: game.turn, moves: ids, damages: incoming, messages: log }])
    };
  }
  const api = { MAX_ENERGY, START_HP, CARDS, BASIC, SUDDEN, createGame, getMove, isCard, validMove, availableMoves, resolveTurn };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.LemonRules = api;
})(typeof window !== "undefined" ? window : undefined);
