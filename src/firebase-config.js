/* Google Sites school-friends transport.
   BRAWL and Shokoku already use this Realtime Database. Lemon writes ONLY
   to its own root `lemonClashRoomsV1`; do not modify their source or rooms.

   Developer note: Firebase server Rules for this new namespace have NOT yet
   been verified. A public RTDB without Auth cannot enforce player identity;
   use for private friendly games only, and validate permissions before
   treating it as release-ready. No player must enter a Firebase URL.

   Test runners can inject a dedicated Auth+RTDB config before this file runs.
*/
window.LEMON_FIREBASE_CONFIG = window.LEMON_FIREBASE_CONFIG || {
  mode: "shared-rtdb",
  databaseURL: "https://mygame-df915-default-rtdb.firebaseio.com/"
};
