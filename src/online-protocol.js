/* LEMON CLASH — fair simultaneous online turn protocol, shared by browser and Node.
   Requires secure-context Web Crypto (HTTPS) or explicitly supplied digest implementation.
   No Firebase imports and no side effects. */
(function (root) {
  "use strict";
  const VERSION = 3; // RC8: new cards and persistent shields; never join RC6/RC7 rooms
  const ALPHABET = "0123456789abcdef";
  function assertText(value, field, max = 128) {
    if (typeof value !== "string" || !value || value.length > max) {
      throw new Error("Invalid " + field);
    }
  }
  function assertTurn(turn) {
    if (!Number.isSafeInteger(turn) || turn < 1) throw new Error("Invalid turn");
  }
  function freshNonce(secureCrypto) {
    if (!secureCrypto || typeof secureCrypto.getRandomValues !== "function") {
      throw new Error("Secure random generator required");
    }
    const bytes = new Uint8Array(32);
    secureCrypto.getRandomValues(bytes);
    return Array.from(bytes, n => ALPHABET[n >>> 4] + ALPHABET[n & 15]).join("");
  }
  function validateNonce(nonce) {
    if (typeof nonce !== "string" || !/^[a-f0-9]{64}$/.test(nonce)) {
      throw new Error("Invalid nonce");
    }
  }
  function commitmentMessage(roomId, turn, uid, action, nonce) {
    assertText(roomId, "room ID", 32);
    assertTurn(turn);
    assertText(uid, "player UID", 128);
    assertText(action, "action", 32);
    validateNonce(nonce);
    return JSON.stringify(["lemon-clash-turn-v1", roomId, turn, uid, action, nonce]);
  }
  async function makeCommit(roomId, turn, uid, action, nonce, digest) {
    if (!digest || typeof digest.digest !== "function" || typeof TextEncoder === "undefined") {
      throw new Error("SHA-256 digest implementation required");
    }
    const bytes = new TextEncoder().encode(commitmentMessage(roomId, turn, uid, action, nonce));
    const hash = new Uint8Array(await digest.digest("SHA-256", bytes));
    return Array.from(hash, n => ALPHABET[n >>> 4] + ALPHABET[n & 15]).join("");
  }
  async function validateReveal(roomId, turn, uid, reveal, expected, digest, rules) {
    if (!reveal || typeof reveal !== "object") throw new Error("Missing reveal");
    if (typeof expected !== "string" || !/^[a-f0-9]{64}$/.test(expected)) {
      throw new Error("Missing or invalid commitment");
    }
    if (!rules.getMove(reveal.action)) throw new Error("Unknown revealed action");
    const actual = await makeCommit(roomId, turn, uid, reveal.action, reveal.nonce, digest);
    if (actual !== expected) throw new Error("Reveal does not match commitment");
    return reveal.action;
  }
  async function resolveCommittedRound(room, roomId, digest, rules) {
    if (!room || !room.round || !room.game) return null;
    const phase = room.round;
    if (phase.turn !== room.game.turn) throw new Error("Out-of-sync round");
    const ids = ["host", "guest"];
    if (!ids.every(seat => phase.commits && phase.commits[seat] &&
        phase.reveals && phase.reveals[seat])) return null;
    const actions = await Promise.all(ids.map((seat, i) =>
      validateReveal(roomId, phase.turn, seat === "host" ? room.hostUid : room.guestUid,
        phase.reveals[seat], phase.commits[seat], digest, rules)));
    return rules.resolveTurn(room.game, actions[0], actions[1]);
  }
  function emptyRound(turn) {
    assertTurn(turn);
    return { turn, commits: { host: null, guest: null }, reveals: { host: null, guest: null } };
  }
  function validRoomCode(code) { return typeof code === "string" && /^[0-9]{6}$/.test(code); }
  function generateRoomCode(secureCrypto) {
    if (!secureCrypto || typeof secureCrypto.getRandomValues !== "function") throw new Error("Secure random required");
    const buffer = new Uint32Array(1);
    secureCrypto.getRandomValues(buffer);
    return String(buffer[0] % 1000000).padStart(6, "0");
  }
  const api = { VERSION, freshNonce, makeCommit, validateReveal, resolveCommittedRound,
    emptyRound, validRoomCode, generateRoomCode };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.LemonOnlineProtocol = api;
})(typeof window !== "undefined" ? window : undefined);
