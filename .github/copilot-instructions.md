# Copilot Instructions — no-thanks-games

Purpose: give AI coding agents concise, actionable context so they can be productive immediately.

- Big picture
  - Frontend: Vue 3 SPA (Vite + Tailwind). Entry: `src/main.js` → `src/App.vue` (mode switcher).
  - Solo mode: pure client logic in `src/composables/useGame.js` (Vue composable).
  - Network mode: client Socket.IO glue in `src/composables/useSocket.js` + `src/composables/useNetworkGame.js`.
  - Server: Express + Socket.IO (`server/index.cjs`) uses `server/gameLogic.cjs` as the authoritative engine.

- Quick commands (see `package.json`)
  - `npm run dev` — start Vite dev server (frontend; port 5173)
  - `npm run build` — build frontend into `dist/`
  - `npm run server` — run `node server/index.cjs` (serves `dist/` on port 3000)
  - `npm run dev:server` — run server with `--watch`

- Architectural & coding notes
  - The server is the single source of truth. Clients emit intents; server validates and broadcasts sanitized state via `getPublicState(room)`.
  - Do not expose internal server fields (`socketId`, `removedCards`) to the client.
  - Composables are the project's primary pattern for state + side effects. Prefer editing `useGame.js` for solo rules and `useNetworkGame.js` for Socket handling.
  - `useSocket.js` implements a singleton Socket.IO connection — reuse it across components.
  - The repository mixes ESM for the frontend and CommonJS for the server (`.cjs`) — preserve these formats (package.json has `type: "module"`).
  - New: the server supports `room:addBot` (host) to insert AI players (server-side bots). Bots are regular players with `isBot: true` and act automatically when it's their turn. Maximum of 4 bots per game.

- Socket event surface (canonical names)
  - Client → Server: `room:create`, `room:join`, `room:spectate`, `room:start`, `game:take`, `game:refuse`, `room:addBot`
  - Server → Client: `room:created`, `room:joined`, `room:spectating`, `game:state`, `game:timer`, `game:finished`, `game:notification`, `error:action`

- Where to edit for common tasks
  - Change game rules / scoring: `server/gameLogic.cjs` (server) and `src/composables/useGame.js` (solo preview/AI heuristics).
  - Add UI or tweak animations: `src/components/*` and `src/App.vue` for mode wiring.
  - Add or change socket flows: `server/index.cjs` and `src/composables/useNetworkGame.js`.

- Project-specific conventions / gotchas
  - Server-side bots: server exposes helper functions (`addBot`, `takeCardByPlayerId`, `refuseCardByPlayerId`) and a scheduler that auto-plays bots after each state broadcast. Bots use the same simple heuristic as `useGame.js`.
  - Pause-on-disconnect: when a player disconnects during `playing`, the server marks them disconnected and sets `room.phase = 'paused'`. The server will keep the room alive and resume to `playing` when disconnected players reconnect.
  - Room lifecycle: rooms are retained for reconnection and will only be auto-cleaned after 30 minutes of inactivity (`room.lastActivity` used). Do not rely on immediate deletion.

- Debug / test hints
  - To test network mode locally: `npm run build` then `npm run server`. Visit `http://localhost:3000` from multiple browsers or devices on the LAN.
  - The server prints local network IPs on start to simplify multi-device testing.
  - To add bots from UI code: call `addBot(name)` from `useNetworkGame()` (emits `room:addBot`). The server enforces max 4 bots and 7 players total.

If anything here is unclear or you want explicit examples (small patches) for editing a specific file, tell me which area to expand.
