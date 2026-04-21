/**
 * server/index.js — Serveur Socket.IO pour "No Thanks!" multijoueur
 *
 * Architecture :
 *  - Express sert le frontend buildé (dist/)
 *  - Socket.IO gère la communication temps réel
 *  - Les parties sont stockées en mémoire (Map rooms)
 *  - Toute la logique de jeu est dans gameLogic.js
 *
 * Lancement : node server/index.js
 * Accès local : http://localhost:3000
 * Accès réseau : http://<IP_LOCALE>:3000
 */

const express    = require('express')
const http       = require('http')
const { Server } = require('socket.io')
const path       = require('path')
const {
  createRoom, addPlayer, startGame,
  takeCard, refuseCard,
  handleDisconnect, handleReconnect,
  getPublicState, getFinalRanking,
  MIN_PLAYERS, MAX_PLAYERS,
} = require('./gameLogic')

// ─── Configuration ─────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000

const app    = express()
const server = http.createServer(app)
const io     = new Server(server, {
  cors: {
    // En développement on accepte toutes les origines
    // En production, restreindre à votre domaine
    origin: '*',
    methods: ['GET', 'POST'],
  },
})

// ─── Servir le frontend ────────────────────────────────────────────────────────
// En production : npm run build dans /src → fichiers dans /dist
const distPath = path.join(__dirname, '..', 'dist')
app.use(express.static(distPath))
app.get('*', (req, res) => {
  res.sendFile(path.join(distPath, 'index.html'))
})

// ─── État global : toutes les parties actives ─────────────────────────────────
/**
 * Map<roomCode, GameState>
 * Toutes les parties vivent ici, en mémoire.
 * Pas de base de données pour cette version.
 */
const rooms = new Map()

/**
 * Map<socketId, { roomCode, playerName }>
 * Permet de retrouver la partie d'un joueur en cas de déconnexion.
 */
const socketToRoom = new Map()

// ─── Utilitaires ──────────────────────────────────────────────────────────────

/** Génère un code de partie de 4 lettres majuscules unique. */
function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // sans I, O, 0, 1 (ambigus)
  let code
  do {
    code = Array.from({ length: 4 }, () =>
      chars[Math.floor(Math.random() * chars.length)]
    ).join('')
  } while (rooms.has(code))
  return code
}

/** Envoie l'état complet de la partie à tous les joueurs de la room. */
function broadcastState(room) {
  const state = getPublicState(room)
  io.to(room.code).emit('game:state', state)
}

/** Envoie un message d'erreur au seul client concerné. */
function sendError(socket, code, message) {
  socket.emit('error:action', { code, message })
}

/** Nettoie les parties terminées ou vides depuis plus de 10 minutes. */
function cleanupOldRooms() {
  const TEN_MIN = 10 * 60 * 1000
  const now = Date.now()
  for (const [code, room] of rooms) {
    const isOld = (now - room.createdAt) > TEN_MIN
    const isEmpty = room.players.filter(p => p.connected).length === 0
    if (isOld || (isEmpty && room.phase !== 'lobby')) {
      rooms.delete(code)
      console.log(`[cleanup] Room ${code} supprimée`)
    }
  }
}
setInterval(cleanupOldRooms, 5 * 60 * 1000) // toutes les 5 minutes

// ─── Gestion des connexions Socket.IO ────────────────────────────────────────

io.on('connection', (socket) => {
  console.log(`[connect] ${socket.id}`)

  // ── CRÉER UNE PARTIE ──────────────────────────────────────────────────────
  /**
   * Événement : 'room:create'
   * Payload  : { playerName: string }
   * Réponse  : 'room:created' { roomCode, state } | 'error:action'
   */
  socket.on('room:create', ({ playerName } = {}) => {
    if (!playerName?.trim()) {
      return sendError(socket, 'invalid_name', 'Nom de joueur requis')
    }

    const code = generateRoomCode()
    const room = createRoom(code, socket.id)
    rooms.set(code, room)

    // Ajouter l'hôte comme premier joueur
    const result = addPlayer(room, socket.id, playerName)
    if (!result.ok) {
      rooms.delete(code)
      return sendError(socket, result.error, 'Impossible de créer la partie')
    }

    // Rejoindre la room Socket.IO
    socket.join(code)
    socketToRoom.set(socket.id, { roomCode: code, playerName: playerName.trim() })

    console.log(`[room:create] ${code} par ${playerName} (${socket.id})`)

    socket.emit('room:created', {
      roomCode: code,
      isHost:   true,
      state:    getPublicState(room),
    })
  })

  // ── REJOINDRE UNE PARTIE ─────────────────────────────────────────────────
  /**
   * Événement : 'room:join'
   * Payload  : { roomCode: string, playerName: string }
   * Réponse  : 'room:joined' { state } | 'error:action'
   */
  socket.on('room:join', ({ roomCode, playerName } = {}) => {
    const code = roomCode?.trim().toUpperCase()
    if (!code || !playerName?.trim()) {
      return sendError(socket, 'invalid_payload', 'Code et nom requis')
    }

    const room = rooms.get(code)
    if (!room) {
      return sendError(socket, 'room_not_found', `Aucune partie avec le code ${code}`)
    }

    // Tentative de reconnexion : même nom dans la même partie
    const existingPlayer = room.players.find(
      p => p.name.toLowerCase() === playerName.trim().toLowerCase()
    )
    if (existingPlayer && !existingPlayer.connected) {
      const reconnect = handleReconnect(room, existingPlayer.socketId, socket.id)
      if (reconnect.ok) {
        socketToRoom.set(socket.id, { roomCode: code, playerName: playerName.trim() })
        socket.join(code)

        console.log(`[room:rejoin] ${playerName} reconnecté dans ${code}`)
        socket.emit('room:joined', {
          roomCode: code,
          isHost:   room.host === socket.id,
          state:    getPublicState(room),
          reconnected: true,
        })
        broadcastState(room)
        io.to(code).emit('game:notification', {
          type:    'reconnect',
          message: `${playerName} s'est reconnecté`,
        })
        return
      }
    }

    const result = addPlayer(room, socket.id, playerName)
    if (!result.ok) {
      const messages = {
        game_already_started: 'La partie a déjà commencé',
        room_full:            'La partie est complète (7 joueurs max)',
        name_taken:           'Ce nom est déjà utilisé',
      }
      return sendError(socket, result.error, messages[result.error] || 'Impossible de rejoindre')
    }

    socket.join(code)
    socketToRoom.set(socket.id, { roomCode: code, playerName: playerName.trim() })

    console.log(`[room:join] ${playerName} rejoint ${code}`)

    socket.emit('room:joined', {
      roomCode: code,
      isHost:   false,
      state:    getPublicState(room),
    })

    // Notifier tous les autres joueurs
    socket.to(code).emit('game:notification', {
      type:    'join',
      message: `${playerName.trim()} a rejoint la partie`,
    })
    broadcastState(room)
  })

  // ── DÉMARRER LA PARTIE (hôte seulement) ──────────────────────────────────
  /**
   * Événement : 'room:start'
   * Payload  : {} (pas de payload nécessaire)
   * Réponse  : broadcast 'game:state' à tous | 'error:action'
   */
  socket.on('room:start', () => {
    const meta = socketToRoom.get(socket.id)
    if (!meta) return sendError(socket, 'not_in_room', 'Vous n\'êtes pas dans une partie')

    const room = rooms.get(meta.roomCode)
    if (!room) return sendError(socket, 'room_not_found', 'Partie introuvable')

    const result = startGame(room, socket.id)
    if (!result.ok) {
      const messages = {
        not_host:             'Seul l\'hôte peut démarrer la partie',
        wrong_phase:          'La partie n\'est pas en phase lobby',
        not_enough_players:   `Il faut au moins ${MIN_PLAYERS} joueurs`,
      }
      return sendError(socket, result.error, messages[result.error] || 'Impossible de démarrer')
    }

    console.log(`[room:start] ${meta.roomCode} — ${room.players.length} joueurs`)
    broadcastState(room)
  })

  // ── PRENDRE LA CARTE ──────────────────────────────────────────────────────
  /**
   * Événement : 'game:take'
   * Validation : seul le joueur dont c'est le tour peut jouer
   */
  socket.on('game:take', () => {
    const meta = socketToRoom.get(socket.id)
    if (!meta) return

    const room = rooms.get(meta.roomCode)
    if (!room) return

    const result = takeCard(room, socket.id)
    if (!result.ok) {
      const messages = {
        not_your_turn: 'Ce n\'est pas votre tour',
        wrong_phase:   'La partie n\'est pas en cours',
        no_tokens:     'Vous n\'avez plus de jetons',
      }
      return sendError(socket, result.error, messages[result.error] || 'Action invalide')
    }

    console.log(`[game:take] ${meta.playerName} prend ${result.action.card} dans ${meta.roomCode}`)

    // Diffuser le nouvel état à tous
    broadcastState(room)

    // Si la partie est terminée, envoyer aussi le classement
    if (room.phase === 'finished') {
      io.to(room.code).emit('game:finished', {
        ranking: getFinalRanking(room),
      })
    }
  })

  // ── REFUSER LA CARTE ──────────────────────────────────────────────────────
  /**
   * Événement : 'game:refuse'
   */
  socket.on('game:refuse', () => {
    const meta = socketToRoom.get(socket.id)
    if (!meta) return

    const room = rooms.get(meta.roomCode)
    if (!room) return

    const result = refuseCard(room, socket.id)
    if (!result.ok) {
      const messages = {
        not_your_turn: 'Ce n\'est pas votre tour',
        wrong_phase:   'La partie n\'est pas en cours',
        no_tokens:     'Vous n\'avez plus de jetons — vous devez prendre la carte !',
      }
      return sendError(socket, result.error, messages[result.error] || 'Action invalide')
    }

    console.log(`[game:refuse] ${meta.playerName} refuse dans ${meta.roomCode}`)
    broadcastState(room)
  })

  // ── DÉCONNEXION ───────────────────────────────────────────────────────────
  socket.on('disconnect', (reason) => {
    console.log(`[disconnect] ${socket.id} — ${reason}`)

    const meta = socketToRoom.get(socket.id)
    if (!meta) return

    const room = rooms.get(meta.roomCode)
    if (!room) { socketToRoom.delete(socket.id); return }

    const result = handleDisconnect(room, socket.id)
    socketToRoom.delete(socket.id)

    if (!result.removed) return

    // Notifier les autres joueurs
    io.to(meta.roomCode).emit('game:notification', {
      type:    'disconnect',
      message: `${meta.playerName} s'est déconnecté`,
    })

    // Si la room est vide, la supprimer
    if (result.isEmpty) {
      rooms.delete(meta.roomCode)
      console.log(`[cleanup] Room ${meta.roomCode} vide, supprimée`)
      return
    }

    // Sinon, diffuser l'état mis à jour (avec le joueur marqué déconnecté)
    broadcastState(room)

    // Si l'hôte change, notifier
    if (result.isHost) {
      io.to(meta.roomCode).emit('game:notification', {
        type:    'new_host',
        message: `Nouvel hôte : ${room.players.find(p => p.socketId === result.newHostId)?.name}`,
      })
    }
  })

  // ── PING / STATUT (debug) ─────────────────────────────────────────────────
  socket.on('ping:server', (cb) => {
    if (typeof cb === 'function') cb({ time: Date.now(), rooms: rooms.size })
  })
})

// ─── Lancement du serveur ─────────────────────────────────────────────────────
server.listen(PORT, '0.0.0.0', () => {
  // Afficher l'IP locale pour faciliter la connexion réseau
  const { networkInterfaces } = require('os')
  const nets = networkInterfaces()
  const localIPs = []

  for (const iface of Object.values(nets)) {
    for (const net of iface) {
      if (net.family === 'IPv4' && !net.internal) {
        localIPs.push(net.address)
      }
    }
  }

  console.log('\n🎴  No Thanks! — Serveur multijoueur')
  console.log('━'.repeat(40))
  console.log(`   Local   : http://localhost:${PORT}`)
  localIPs.forEach(ip => {
    console.log(`   Réseau  : http://${ip}:${PORT}`)
  })
  console.log('━'.repeat(40))
  console.log('   Les autres joueurs accèdent via l\'IP réseau.')
  console.log('   Ctrl+C pour arrêter.\n')
})
