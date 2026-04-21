# 🎴 No Thanks! — Solo + Multijoueur réseau

Implémentation complète du jeu de société **No Thanks!** en Vue 3 + Socket.IO.

---

## 🚀 Installation rapide

```bash
tar -xzf no-thanks-game.tar.gz
cd no-thanks
npm install
```

---

## 🎮 Modes de jeu

### Mode Solo (navigateur uniquement)
```bash
npm run dev         # Développement : http://localhost:5173
```
Jouez localement dans votre navigateur. Supporte les IA et le timer.

---

### Mode Multijoueur réseau

#### 1. Builder le frontend
```bash
npm run build
```

#### 2. Lancer le serveur
```bash
npm run server
# ou pour auto-reload en dev :
npm run dev:server
```

Le serveur démarre sur le port **3000** et affiche :
```
🎴  No Thanks! — Serveur multijoueur
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   Local   : http://localhost:3000
   Réseau  : http://192.168.1.42:3000    ← autres joueurs utilisent cette URL
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

#### 3. Jouer sur réseau local
- **Hôte** : accède à `http://localhost:3000`, crée une partie
- **Autres joueurs** : accèdent à `http://192.168.1.42:3000` (IP affichée dans le terminal), rejoignent avec le code à 4 lettres

---

## 🏗 Architecture

```
no-thanks/
├── server/
│   ├── index.cjs          # Serveur Express + Socket.IO
│   └── gameLogic.cjs      # Logique pure du jeu (source de vérité)
│
├── src/
│   ├── App.vue            # Orchestrateur : solo ↔ réseau
│   ├── components/
│   │   ├── ModeSelect.vue       # Choix solo / réseau
│   │   ├── SetupScreen.vue      # Config partie solo
│   │   ├── GameBoard.vue        # Plateau solo
│   │   ├── CardPile.vue         # Carte centrale
│   │   ├── Controls.vue         # Boutons + timer
│   │   ├── PlayerPanel.vue      # Panneau joueur
│   │   ├── ScoreScreen.vue      # Résultats
│   │   ├── NetworkLobby.vue     # Lobby réseau (créer/rejoindre)
│   │   └── NetworkGameBoard.vue # Plateau réseau
│   │
│   └── composables/
│       ├── useGame.js       # Logique solo (Vue réactive)
│       ├── useNetworkGame.js # Logique réseau (Socket.IO)
│       ├── useSocket.js     # Singleton connexion Socket.IO
│       ├── useTimer.js      # Timer de tour
│       └── useI18n.js       # Traductions FR/EN
```

---

## 🔌 Événements Socket.IO

### Client → Serveur

| Événement     | Payload                          | Description                    |
|---------------|----------------------------------|--------------------------------|
| `room:create` | `{ playerName }`                 | Créer une partie (devient hôte)|
| `room:join`   | `{ roomCode, playerName }`       | Rejoindre avec un code         |
| `room:start`  | *(aucun)*                        | Lancer (hôte seulement)        |
| `game:take`   | *(aucun)*                        | Prendre la carte               |
| `game:refuse` | *(aucun)*                        | Dire No Thanks!                |

### Serveur → Client(s)

| Événement            | Destinataire | Description                        |
|----------------------|--------------|------------------------------------|
| `room:created`       | 1 client     | Confirmation de création           |
| `room:joined`        | 1 client     | Confirmation de rejoindre          |
| `game:state`         | Toute la room| État complet après chaque action   |
| `game:finished`      | Toute la room| Classement final                   |
| `game:notification`  | Toute la room| Infos (join, disconnect, etc.)     |
| `error:action`       | 1 client     | Erreur d'action invalide           |

---

## 🛡 Sécurité anti-triche

- Le **serveur est la seule source de vérité** : le client ne peut pas modifier l'état
- Chaque action vérifie le **socketId** du joueur → impossible de jouer à la place de quelqu'un
- Le serveur **n'expose jamais** les `socketId` aux autres clients ni les cartes retirées
- Les cartes restantes dans la pioche ne sont pas transmises (seulement le nombre)

---

## 🔧 Configuration

| Variable           | Défaut | Description              |
|--------------------|--------|--------------------------|
| `PORT`             | `3000` | Port du serveur          |
| `TOKENS_PER_PLAYER`| `11`   | Jetons par joueur        |
| `CARDS_REMOVED`    | `9`    | Cartes retirées au début |

Modifier `server/gameLogic.cjs` pour changer les règles.

---

## 📱 Accès mobile

Le jeu est responsive. Sur mobile, accédez à l'IP réseau depuis Safari/Chrome.  
Assurez-vous que le pare-feu autorise le port 3000.
