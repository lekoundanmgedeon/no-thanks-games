# 🎴 No Thanks! — Solo + Multiplayer Network

Complete implementation of the board game **No Thanks!** in Vue 3 + Socket.IO.

---

## 🚀 Quick Installation

```bash
tar -xzf no-thanks-game.tar.gz
cd no-thanks
npm install
```

---

## 🎮 Game Modes

### Solo Mode (browser only)

```bash
npm run dev         # Development: http://localhost:5173
```
Play locally in your browser. Supports AI and timer.

---

### Multiplayer Network Mode

#### 1. Build the frontend

```bash
npm run build
```

#### 2. Start the server

```bash
npm run server
# or for auto-reload in dev:
npm run dev:server
```

#### 3. Quick launch (production mode)

```bash
npm run build && npm run server
```

The server starts on port **3000** and displays:

```
🎴  No Thanks! — Multiplayer Server
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   Local   : http://localhost:3000
   Network : http://192.168.1.42:3000    ← other players use this URL
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

#### 3. Play on local network

- **Host**: access `http://localhost:3000`, create a game
- **Other players**: access `http://192.168.1.42:3000` (IP displayed in terminal), join with the 4-letter code

---

## 🏗 Architecture

```
no-thanks/
├── server/
│   ├── index.cjs          # Express Server + Socket.IO
│   └── gameLogic.cjs      # Pure game logic (source of truth)
│
├── src/
│   ├── App.vue            # Orchestrator: solo ↔ network
│   ├── components/
│   │   ├── ModeSelect.vue       # Choose solo / network
│   │   ├── SetupScreen.vue      # Solo game setup
│   │   ├── GameBoard.vue        # Solo board
│   │   ├── CardPile.vue         # Central card
│   │   ├── Controls.vue         # Buttons + timer
│   │   ├── PlayerPanel.vue      # Player panel
│   │   ├── ScoreScreen.vue      # Results
│   │   ├── NetworkLobby.vue     # Network lobby (create/join)
│   │   └── NetworkGameBoard.vue # Network board
│   │
│   └── composables/
│       ├── useGame.js       # Solo logic (Vue reactive)
│       ├── useNetworkGame.js # Network logic (Socket.IO)
│       ├── useSocket.js     # Singleton Socket.IO connection
│       ├── useTimer.js      # Turn timer
│       └── useI18n.js       # Translations FR/EN
```

---

## 🔌 Socket.IO Events

### Client → Server

| Event          | Payload                          | Description                    |
|----------------|----------------------------------|--------------------------------|
| `room:create`  | `{ playerName }`                 | Create a game (becomes host)   |
| `room:join`    | `{ roomCode, playerName }`       | Join with a code               |
| `room:start`   | *(none)*                         | Start (host only)              |
| `game:take`    | *(none)*                         | Take the card                  |
| `game:refuse`  | *(none)*                         | Say No Thanks!                 |

### Server → Client(s)

| Event               | Recipient    | Description                        |
|---------------------|--------------|------------------------------------|
| `room:created`      | 1 client     | Creation confirmation              |
| `room:joined`       | 1 client     | Join confirmation                  |
| `game:state`        | Entire room  | Complete state after each action   |
| `game:finished`     | Entire room  | Final ranking                      |
| `game:notification` | Entire room  | Info (join, disconnect, etc.)      |
| `error:action`      | 1 client     | Invalid action error               |

---

## 🛡 Anti-cheat Security

- The **server is the only source of truth**: the client cannot modify the state
- Each action verifies the player's **socketId** → impossible to play for someone else
- The server **never exposes** `socketId` to other clients or removed cards
- Remaining cards in the deck are not transmitted (only the count)

---

## 🔧 Configuration

| Variable           | Default | Description              |
|--------------------|---------|--------------------------|
| `PORT`             | `3000`  | Server port              |
| `TOKENS_PER_PLAYER`| `11`    | Tokens per player        |
| `CARDS_REMOVED`    | `9`     | Cards removed at start   |

Modify `server/gameLogic.cjs` to change the rules.

---

## 📱 Mobile Access

The game is responsive. On mobile, access the network IP from Safari/Chrome.  
Make sure the firewall allows port 3000.
