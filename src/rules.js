/* LEMON CLASH rules v0.1 — deterministic, dependency-free */
(function (root) {
  "use strict";
  const MAX_ENERGY = 10;
  const START_HP = 3;
  const CARDS = Object.freeze([
    { id: "feint", name: "フェイント", cost: 1, icon: "🎭", type: "utility", description: "相手が通常防御ならエネルギー+3" },
    { id: "drain", name: "エネルギー泥棒", cost: 1, icon: "🌀", type: "utility", description: "相手のチャージを無効にし、自分のエネルギー+2" },
    { id: "read", name: "見切り", cost: 1, icon: "👁️", type: "defense", description: "相手の特殊攻撃カードを無効化" },
    { id: "pierce", name: "貫通攻撃", cost: 2, icon: "🗡️", type: "attack", description: "通常防御を貫通して1ダメージ" },
    { id: "counter", name: "カウンター", cost: 2, icon: "🪞", type: "defense", description: "通常攻撃・連撃・オールインを防いで1ダメージ反射" },
    { id: "seal", name: "封印", cost: 2, icon: "🔒", type: "control", description: "終局宣告以外の特殊カードをすべて無効化" },
    { id: "volley", name: "連撃", cost: 3, icon: "⚔️", type: "attack", description: "2ダメージ。通常防御には防がれる" },
    { id: "crush", name: "粉砕", cost: 3, icon: "💥", type: "attack", description: "通常防御に2ダメージ、それ以外には1ダメージ" },
    { id: "final", name: "終焉の一撃", cost: 4, icon: "☄️", type: "attack", description: "2ダメージ。通常防御でも1ダメージ" },
    { id: "allin", name: "オールイン", cost: 5, icon: "🔥", type: "attack", description: "3ダメージ。通常防御には防がれる" },
    { id: "judgment", name: "終局宣告", cost: 10, icon: "👑", type: "ultimate", description: "使用が成立した時点で勝利。防御・見切り・封印・カウンター無効" }
  ]);
  const LOOKUP = Object.fromEntries(CARDS.map(function (card) { return [card.id, card]; }));
  const BASIC = Object.freeze({
    charge: { id: "charge", name: "チャージ", cost: 0, icon: "⚡", description: "エネルギー+1。通常攻撃を受けると獲得失敗" },
    attack: { id: "attack", name: "通常攻撃", cost: 1, icon: "⚔️", description: "1ダメージ。相手のチャージを中断。通常防御で防げる" },
    guard: { id: "guard", name: "通常防御", cost: 0, icon: "🛡️", description: "通常攻撃と一部の特殊攻撃を防ぐ" }
  });

  function createPlayer() {
    return { hp: START_HP, energy: 1, used: [] };
  }
  function createGame() {
    return { turn: 1, players: [createPlayer(), createPlayer()], winner: null, history: [] };
  }
  function getMove(id) { return BASIC[id] || LOOKUP[id] || null; }
  function isCard(id) { return !!LOOKUP[id]; }
  function validMove(player, id) {
    const move = getMove(id);
    return !!move && player.hp > 0 && player.energy >= move.cost &&
      (!isCard(id) || !player.used.includes(id));
  }
  function availableMoves(player) {
    return Object.keys(BASIC).concat(CARDS.map(function (c) { return c.id; }))
      .filter(function (id) { return validMove(player, id); });
  }
  function clampEnergy(v) { return Math.max(0, Math.min(MAX_ENERGY, v)); }

  function resolveTurn(game, moveA, moveB) {
    if (game.winner !== null) throw new Error("試合終了後に行動できません");
    const ids = [moveA, moveB];
    const players = game.players.map(function (p) {
      return { hp: p.hp, energy: p.energy, used: p.used.slice() };
    });
    ids.forEach(function (id, i) {
      if (!validMove(players[i], id)) throw new Error("使用できない行動: " + id);
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
    const gain = [0, 0];
    for (let i = 0; i < 2; i++) {
      if (cancelled[i]) continue;
      if (ids[i] === "drain" && ids[1 - i] === "charge") {
        cancelled[1 - i] = true;
        gain[i] += 2;
        log.push("P" + (i + 1) + "がチャージを奪った！");
      } else if (ids[i] === "feint" && ids[1 - i] === "guard") {
        gain[i] += 3;
        log.push("P" + (i + 1) + "のフェイント成功！");
      }
    }
    ids.forEach(function (id, i) {
      if (id === "charge" && !cancelled[i]) gain[i]++;
    });
    const incoming = [0, 0];
    const damage = { attack: 1, pierce: 1, volley: 2, crush: 1, final: 2, allin: 3 };
    for (let i = 0; i < 2; i++) {
      const target = 1 - i;
      const id = ids[i];
      if (cancelled[i] || damage[id] === undefined) continue;
      let amount = damage[id];
      const response = cancelled[target] ? "" : ids[target];
      if (response === "guard") {
        if (id === "attack" || id === "volley" || id === "allin") amount = 0;
        if (id === "crush") amount = 2;
        if (id === "final") amount = 1;
      }
      if (response === "read" && isCard(id)) amount = 0;
      if (response === "counter" && (id === "attack" || id === "volley" || id === "allin")) {
        amount = 0;
        incoming[i] += 1;
        log.push("P" + (target + 1) + "のカウンター成功！");
      }
      // A landed BASIC attack interrupts the opponent's charge this turn.
      // Other special attacks do not interrupt charging, even when damaging.
      if (id === "attack" && response === "charge" && amount > 0) {
        gain[target] = 0;
        log.push("P" + (target + 1) + "のチャージが通常攻撃で中断！");
      }
      incoming[target] += amount;
    }
    // 終局宣告は発動した時点で勝敗が確定する。
    // 同じターンの攻撃で使用者のHPが0になったように表示しない。
    // 終局宣告同士の同時発動は現行仕様どおり引き分け。
    const judgmentA = ids[0] === "judgment";
    const judgmentB = ids[1] === "judgment";
    if (judgmentA !== judgmentB) {
      const declaring = judgmentA ? 0 : 1;
      incoming[declaring] = 0;
      log.push("P" + (declaring + 1) + "の終局宣告が成立！ 即時勝利");
    }
    players.forEach(function (p, i) {
      p.energy = clampEnergy(p.energy + gain[i]);
      p.hp = Math.max(0, p.hp - incoming[i]);
    });
    let winner = null;
    if (judgmentA && judgmentB) winner = "draw";
    else if (judgmentA) winner = 0;
    else if (judgmentB) winner = 1;
    else if (players[0].hp === 0 && players[1].hp === 0) winner = "draw";
    else if (players[0].hp === 0) winner = 1;
    else if (players[1].hp === 0) winner = 0;
    if (incoming[0] || incoming[1]) {
      log.push("ダメージ：P1 -" + incoming[0] + " / P2 -" + incoming[1]);
    } else {
      log.push("このターンはダメージなし");
    }
    return {
      turn: game.turn + 1,
      players: players,
      winner: winner,
      history: game.history.concat([{ turn: game.turn, moves: ids, damages: incoming, messages: log }])
    };
  }
  const api = { MAX_ENERGY, START_HP, CARDS, BASIC, createGame, getMove, isCard, validMove, availableMoves, resolveTurn };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.LemonRules = api;
})(typeof window !== "undefined" ? window : undefined);
