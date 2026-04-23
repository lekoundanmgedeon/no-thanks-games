/**
 * server/index.cjs — Serveur Socket.IO "No Thanks!" v2
 * Nouveautés : timer côté serveur, mode spectateur, options de partie
 */

const express    = require('express')
const http       = require('http')
const { Server } = require('socket.io')
const path       = require('path')
const {
  createRoom, addPlayer, setRoomOptions, startGame,
  takeCard, refuseCard,
  handleDisconnect, handleReconnect,
  getPublicState, getFinalRanking, getTimerRemaining,
  // new helpers
  addBot, takeCardByPlayerId, refuseCardByPlayerId,
  MIN_PLAYERS, MAX_PLAYERS,
} = require('./gameLogic.cjs')

const PORT = process.env.PORT || 3000
const app    = express()
const server = http.createServer(app)
const io     = new Server(server, { cors: { origin: '*', methods: ['GET', 'POST'] } })

// Servir le frontend buildé
const distPath = path.join(__dirname, '..', 'dist')
app.use(express.static(distPath))
app.get('*', (req, res) => res.sendFile(path.join(distPath, 'index.html')))

// ─── État global ───────────────────────────────────────────────────────────────
const rooms       = new Map()   // Map<code, GameState>
const socketToRoom = new Map()  // Map<socketId, { roomCode, playerName, isSpectator }>
const roomTimers  = new Map()   // Map<code, intervalId> — timers serveur actifs

// ─── Utilitaires ──────────────────────────────────────────────────────────────

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code
  do { code = Array.from({length:4}, () => chars[Math.floor(Math.random()*chars.length)]).join('') }
  while (rooms.has(code))
  return code
}

/** Diffuse l'état à TOUS (joueurs + spectateurs) dans la room Socket.IO. */
function broadcastState(room) {
  io.to(room.code).emit('game:state', getPublicState(room))
  // Let server schedule bot moves if the new state requires it
  try { scheduleBotIfNeeded(room) } catch (e) {}
}

function sendError(socket, code, message) {
  socket.emit('error:action', { code, message })
}

// ─── Timer serveur ─────────────────────────────────────────────────────────────
/**
 * Démarre un intervalle toutes les secondes pour la room.
 * Chaque seconde : broadcast le temps restant.
 * À 0 : force takeCard pour le joueur courant.
 */
function startRoomTimer(room) {
  stopRoomTimer(room.code) // sécurité : on n'en veut qu'un seul

  const intervalId = setInterval(() => {
    if (room.phase !== 'playing' || !room.timerEnabled) {
      stopRoomTimer(room.code); return
    }

    const remaining = getTimerRemaining(room)

    // Broadcast ticker toutes les secondes à la room
    io.to(room.code).emit('game:timer', { remaining })

    // Temps écoulé → force la prise de carte
    if (remaining <= 0) {
      const player = room.players[room.currentPlayerIndex]
      if (player?.connected) {
        const result = takeCard(room, player.socketId)
        if (result.ok) {
          console.log(`[timer] Temps écoulé — ${player.name} force-take dans ${room.code}`)
          broadcastState(room)
          if (room.phase === 'finished') {
            io.to(room.code).emit('game:finished', { ranking: getFinalRanking(room) })
            stopRoomTimer(room.code)
          } else {
            // Redémarrer le timer pour le prochain joueur
            startRoomTimer(room)
          }
        }
      }
    }
  }, 1000)

  roomTimers.set(room.code, intervalId)
}

function stopRoomTimer(roomCode) {
  const id = roomTimers.get(roomCode)
  if (id) { clearInterval(id); roomTimers.delete(roomCode) }
}

// ─── Nettoyage ─────────────────────────────────────────────────────────────────
function cleanupOldRooms() {
  const THIRTY_MIN = 30 * 60 * 1000
  const now = Date.now()
  for (const [code, room] of rooms) {
    const isEmpty = room.players.filter(p => p.connected).length === 0
    const last = room.lastActivity || room.createdAt || 0
    const isOld   = (now - last) > THIRTY_MIN
    // Only delete rooms that have been inactive for at least 30 minutes
    if (isOld) {
      stopRoomTimer(code)
      rooms.delete(code)
      console.log(`[cleanup] Room ${code} supprimée (inactivité)`)
    }
  }
}
setInterval(cleanupOldRooms, 5 * 60 * 1000)

/** Helper: schedule a bot action if the current player is a bot. */
function scheduleBotIfNeeded(room) {
  if (!room || room.phase !== 'playing') return
  const player = room.players[room.currentPlayerIndex]
  if (!player || !player.isBot) return
  if (room._botTimer) clearTimeout(room._botTimer)
  room._botTimer = setTimeout(() => {
    // Simple heuristic copied from client AI
    const card = room.currentCard
    const tokens = room.tokensOnCard
    const netCost = card - tokens
    const playerObj = room.players[room.currentPlayerIndex]
    const extendsSequence = playerObj.cards.includes(card - 1) || playerObj.cards.includes(card + 1)
    const shouldTake = playerObj.tokens === 0 || netCost <= 5 || (extendsSequence && netCost <= 15) || card <= 10
    if (shouldTake) {
      const r = takeCardByPlayerId(room, playerObj.id)
      if (r.ok) {
        console.log(`[bot] ${playerObj.name} prend ${r.action?.card} dans ${room.code}`)
        broadcastState(room)
        if (room.phase === 'finished') io.to(room.code).emit('game:finished', { ranking: getFinalRanking(room) })
        else if (room.timerEnabled) startRoomTimer(room)
      }
    } else {
      const r = refuseCardByPlayerId(room, playerObj.id)
      if (r.ok) {
        console.log(`[bot] ${playerObj.name} refuse dans ${room.code}`)
        broadcastState(room)
        if (room.timerEnabled) startRoomTimer(room)
      }
    }
    clearTimeout(room._botTimer)
    room._botTimer = null
    // If next player is also a bot, schedule again
    scheduleBotIfNeeded(room)
  }, 900)
}

// ─── Connexions Socket.IO ──────────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log(`[connect] ${socket.id}`)

  // ── CRÉER UNE PARTIE ────────────────────────────────────────────────────────
  socket.on('room:create', ({ playerName } = {}) => {
    if (!playerName?.trim()) return sendError(socket, 'invalid_name', 'Nom requis')
    const code = generateRoomCode()
    const room = createRoom(code, socket.id)
    rooms.set(code, room)
    const result = addPlayer(room, socket.id, playerName)
    if (!result.ok) { rooms.delete(code); return sendError(socket, result.error, 'Impossible de créer') }
    socket.join(code)
    socketToRoom.set(socket.id, { roomCode: code, playerName: playerName.trim(), isSpectator: false })
    console.log(`[room:create] ${code} par ${playerName}`)
    socket.emit('room:created', { roomCode: code, isHost: true, state: getPublicState(room) })
  })

  // ── CONFIGURER LA PARTIE (hôte, avant démarrage) ────────────────────────────
  // Payload : { timerEnabled: bool, timerDuration: number }
  socket.on('room:options', (options = {}) => {
    const meta = socketToRoom.get(socket.id)
    if (!meta) return
    const room = rooms.get(meta.roomCode)
    if (!room) return
    const result = setRoomOptions(room, socket.id, options)
    if (!result.ok) return sendError(socket, result.error, 'Impossible de configurer')
    // Diffuser les nouvelles options à tous (notamment les spectateurs)
    broadcastState(room)
    scheduleBotIfNeeded(room)
  })

  // ── AJOUTER UN BOT (hôte seulement) ──────────────────────────────────────
  socket.on('room:addBot', ({ name } = {}) => {
    const meta = socketToRoom.get(socket.id)
    if (!meta || meta.isSpectator) return sendError(socket, 'not_allowed', 'Action non autorisée')
    const room = rooms.get(meta.roomCode)
    if (!room) return sendError(socket, 'room_not_found', 'Partie introuvable')
    // Only host may add bots from the lobby
    if (room.phase !== 'lobby' && room.phase !== 'paused') return sendError(socket, 'wrong_phase', 'Ajouter un bot uniquement en lobby ou pause')
    const r = addBot(room, name)
    if (!r.ok) return sendError(socket, r.error, 'Impossible d\'ajouter un bot')
    console.log(`[bot] ${meta.roomCode} — bot ajouté: ${name || 'Bot'}`)
    broadcastState(room)
    scheduleBotIfNeeded(room)
  })

  // ── REJOINDRE UNE PARTIE (joueur) ────────────────────────────────────────────
  socket.on('room:join', ({ roomCode, playerName } = {}) => {
    const code = roomCode?.trim().toUpperCase()
    if (!code || !playerName?.trim()) return sendError(socket, 'invalid_payload', 'Code et nom requis')
    const room = rooms.get(code)
    if (!room) return sendError(socket, 'room_not_found', `Aucune partie avec le code ${code}`)

    // Tentative de reconnexion
    const existing = room.players.find(p => p.name.toLowerCase() === playerName.trim().toLowerCase())
    if (existing && !existing.connected) {
      const reconnect = handleReconnect(room, existing.socketId, socket.id)
      if (reconnect.ok) {
        socketToRoom.set(socket.id, { roomCode: code, playerName: playerName.trim(), isSpectator: false })
        socket.join(code)
        socket.emit('room:joined', { roomCode: code, isHost: room.host === socket.id, state: getPublicState(room), reconnected: true })
        broadcastState(room)
        io.to(code).emit('game:notification', { type: 'reconnect', message: `${playerName} s'est reconnecté` })
        return
      }
    }

    const result = addPlayer(room, socket.id, playerName)
    if (!result.ok) {
      const msgs = { game_already_started:'La partie a déjà commencé', room_full:'Partie complète (7 max)', name_taken:'Nom déjà utilisé' }
      return sendError(socket, result.error, msgs[result.error] || 'Impossible de rejoindre')
    }
    socket.join(code)
    socketToRoom.set(socket.id, { roomCode: code, playerName: playerName.trim(), isSpectator: false })
    socket.emit('room:joined', { roomCode: code, isHost: false, state: getPublicState(room) })
    socket.to(code).emit('game:notification', { type: 'join', message: `${playerName.trim()} a rejoint` })
    broadcastState(room)
    scheduleBotIfNeeded(room)
  })

  // ── REJOINDRE EN SPECTATEUR ─────────────────────────────────────────────────
  /**
   * Événement : 'room:spectate'
   * Payload  : { roomCode: string }
   * Le spectateur reçoit l'état complet immédiatement + tous les broadcasts suivants.
   * Il ne peut PAS jouer.
   */
  socket.on('room:spectate', ({ roomCode } = {}) => {
    const code = roomCode?.trim().toUpperCase()
    if (!code) return sendError(socket, 'invalid_payload', 'Code requis')
    const room = rooms.get(code)
    if (!room) return sendError(socket, 'room_not_found', `Aucune partie avec le code ${code}`)

    socket.join(code)
    socketToRoom.set(socket.id, { roomCode: code, playerName: '👁 Spectateur', isSpectator: true })
    console.log(`[spectate] ${socket.id} regarde ${code}`)

    socket.emit('room:spectating', {
      roomCode: code,
      state:    getPublicState(room),
      // Si la partie est déjà terminée, envoyer aussi le classement
      ranking:  room.phase === 'finished' ? getFinalRanking(room) : null,
    })
  })

  // ── DÉMARRER LA PARTIE ──────────────────────────────────────────────────────
  socket.on('room:start', () => {
    const meta = socketToRoom.get(socket.id)
    if (!meta || meta.isSpectator) return sendError(socket, 'not_allowed', 'Action non autorisée')
    const room = rooms.get(meta.roomCode)
    if (!room) return sendError(socket, 'room_not_found', 'Partie introuvable')
    const result = startGame(room, socket.id)
    if (!result.ok) {
      const msgs = { not_host: 'Seul l\'hôte peut démarrer', wrong_phase: 'Phase incorrecte', not_enough_players: `Minimum ${MIN_PLAYERS} joueurs` }
      return sendError(socket, result.error, msgs[result.error] || 'Impossible de démarrer')
    }
    console.log(`[room:start] ${meta.roomCode} — ${room.players.length} joueurs, timer: ${room.timerEnabled ? room.timerDuration+'s' : 'off'}`)
    broadcastState(room)
    scheduleBotIfNeeded(room)
    // Démarrer le timer serveur si activé
    if (room.timerEnabled) startRoomTimer(room)
  })

  // ── PRENDRE LA CARTE ────────────────────────────────────────────────────────
  socket.on('game:take', () => {
    const meta = socketToRoom.get(socket.id)
    if (!meta || meta.isSpectator) return
    const room = rooms.get(meta.roomCode)
    if (!room) return
    const result = takeCard(room, socket.id)
    if (!result.ok) {
      const msgs = { not_your_turn:'Ce n\'est pas votre tour', wrong_phase:'Partie non démarrée', no_tokens:'Plus de jetons' }
      return sendError(socket, result.error, msgs[result.error] || 'Action invalide')
    }
    console.log(`[game:take] ${meta.playerName} prend ${result.action.card} dans ${meta.roomCode}`)
    broadcastState(room)
    scheduleBotIfNeeded(room)
    if (room.phase === 'finished') {
      stopRoomTimer(meta.roomCode)
      io.to(room.code).emit('game:finished', { ranking: getFinalRanking(room) })
    } else if (room.timerEnabled) {
      // Redémarrer le timer pour le nouveau joueur
      startRoomTimer(room)
    }
  })

  // ── REFUSER LA CARTE ────────────────────────────────────────────────────────
  socket.on('game:refuse', () => {
    const meta = socketToRoom.get(socket.id)
    if (!meta || meta.isSpectator) return
    const room = rooms.get(meta.roomCode)
    if (!room) return
    const result = refuseCard(room, socket.id)
    if (!result.ok) {
      const msgs = { not_your_turn:'Ce n\'est pas votre tour', wrong_phase:'Partie non démarrée', no_tokens:'Plus de jetons — vous devez prendre !' }
      return sendError(socket, result.error, msgs[result.error] || 'Action invalide')
    }
    console.log(`[game:refuse] ${meta.playerName} refuse dans ${meta.roomCode}`)
    broadcastState(room)
    scheduleBotIfNeeded(room)
    if (room.timerEnabled) startRoomTimer(room)
  })

  // ── DÉCONNEXION ─────────────────────────────────────────────────────────────
  socket.on('disconnect', (reason) => {
    console.log(`[disconnect] ${socket.id} — ${reason}`)
    const meta = socketToRoom.get(socket.id)
    if (!meta) return
    const room = rooms.get(meta.roomCode)
    socketToRoom.delete(socket.id)
    if (!room) return

    // Les spectateurs se déconnectent silencieusement
    if (meta.isSpectator) return

    const result = handleDisconnect(room, socket.id)
    if (!result.removed) return

    io.to(meta.roomCode).emit('game:notification', { type: 'disconnect', message: `${meta.playerName} s'est déconnecté` })

    if (result.isEmpty) {
      // Do NOT delete empty rooms immediately. mark lastActivity and stop timers.
      stopRoomTimer(meta.roomCode)
      room.lastActivity = Date.now()
      console.log(`[info] Room ${meta.roomCode} is empty — preserved for reconnects`) 
      return
    }
    broadcastState(room)
    scheduleBotIfNeeded(room)
    if (result.isHost) {
      const newHost = room.players.find(p => p.socketId === result.newHostId)
      io.to(meta.roomCode).emit('game:notification', { type: 'new_host', message: `Nouvel hôte : ${newHost?.name}` })
    }
    // Redémarrer le timer si c'était le tour du joueur déconnecté
    if (room.timerEnabled && room.phase === 'playing') startRoomTimer(room)
  })

  socket.on('ping:server', (cb) => {
    if (typeof cb === 'function') cb({ time: Date.now(), rooms: rooms.size })
  })
})

// ─── Lancement ─────────────────────────────────────────────────────────────────
server.listen(PORT, '0.0.0.0', () => {
  const { networkInterfaces } = require('os')
  const localIPs = []
  for (const iface of Object.values(networkInterfaces())) {
    for (const net of iface) {
      if (net.family === 'IPv4' && !net.internal) localIPs.push(net.address)
    }
  }
  console.log('\n🎴  No Thanks! — Serveur multijoueur v2')
  console.log('━'.repeat(45))
  console.log(`   Local   : http://localhost:${PORT}`)
  localIPs.forEach(ip => console.log(`   Réseau  : http://${ip}:${PORT}`))
  console.log(`   Spectat : http://<IP>:${PORT}/#spectate`)
  console.log('━'.repeat(45) + '\n')
})
