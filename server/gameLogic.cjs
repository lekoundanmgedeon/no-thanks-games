/**
 * gameLogic.cjs — Logique pure du jeu "No Thanks!" (côté serveur)
 * v2 : ajout du timer côté serveur (géré par le serveur, pas le client)
 */

const CARD_MIN          = 3
const CARD_MAX          = 35
const CARDS_REMOVED     = 9
const TOKENS_PER_PLAYER = 11
const MIN_PLAYERS       = 3
const MAX_PLAYERS       = 7

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

function calcScore(cards, tokens) {
  if (cards.length === 0) return -tokens
  const sorted = [...cards].sort((a, b) => a - b)
  let total = 0, prev = null
  for (const c of sorted) {
    if (prev === null || c !== prev + 1) total += c
    prev = c
  }
  return total - tokens
}

function getSequences(cards) {
  if (!cards.length) return []
  const sorted = [...cards].sort((a, b) => a - b)
  const seqs = []
  let current = [sorted[0]]
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === sorted[i - 1] + 1) current.push(sorted[i])
    else { seqs.push(current); current = [sorted[i]] }
  }
  seqs.push(current)
  return seqs
}

function createRoom(roomCode, hostSocketId) {
  return {
    code:               roomCode,
    phase:              'lobby',
    host:               hostSocketId,
    players:            [],
    deck:               [],
    currentCard:        null,
    tokensOnCard:       0,
    currentPlayerIndex: 0,
    lastAction:         null,
    removedCards:       [],
    // housekeeping
    createdAt:          Date.now(),
    lastActivity:       Date.now(),
    disconnectedPlayers: [],
    // ── Options de partie ──
    timerEnabled:       false,   // timer activé ?
    timerDuration:      30,      // secondes par tour
    // ── État interne du timer (géré par le serveur) ──
    _timerRemaining:    0,       // secondes restantes (calculé à la demande)
    _timerStartedAt:    null,    // Date.now() quand le tour a commencé
    createdAt:          Date.now(),
    startedAt:          null,
    finishedAt:         null,
  }
}

function addPlayer(room, socketId, name) {
  if (room.phase !== 'lobby') return { ok: false, error: 'game_already_started' }
  if (room.players.length >= MAX_PLAYERS) return { ok: false, error: 'room_full' }
  const nameTaken = room.players.some(p => p.name.toLowerCase() === name.trim().toLowerCase())
  if (nameTaken) return { ok: false, error: 'name_taken' }
  room.players.push({
    socketId, id: room.players.length,
    name: name.trim() || `Joueur ${room.players.length + 1}`,
    cards: [], tokens: 0, connected: true,
  })
  room.lastActivity = Date.now()
  return { ok: true }
}

/** Configure les options de partie (hôte seulement, en lobby) */
function setRoomOptions(room, socketId, options) {
  if (room.host !== socketId) return { ok: false, error: 'not_host' }
  if (room.phase !== 'lobby') return { ok: false, error: 'wrong_phase' }
  if (typeof options.timerEnabled  === 'boolean') room.timerEnabled  = options.timerEnabled
  if (typeof options.timerDuration === 'number')  room.timerDuration = Math.min(120, Math.max(10, options.timerDuration))
  return { ok: true }
}

function startGame(room, requestingSocketId) {
  if (room.host !== requestingSocketId) return { ok: false, error: 'not_host' }
  if (room.phase !== 'lobby')           return { ok: false, error: 'wrong_phase' }
  if (room.players.length < MIN_PLAYERS) return { ok: false, error: 'not_enough_players' }

  room.players.forEach(p => { p.tokens = TOKENS_PER_PLAYER })
  const allCards = Array.from({ length: CARD_MAX - CARD_MIN + 1 }, (_, i) => i + CARD_MIN)
  shuffle(allCards)
  room.removedCards = allCards.splice(0, CARDS_REMOVED)
  shuffle(allCards)
  shuffle(room.players)
  room.players.forEach((p, i) => { p.id = i })
  room.deck               = allCards
  room.currentCard        = room.deck.shift()
  room.tokensOnCard       = 0
  room.currentPlayerIndex = 0
  room.lastAction         = null
  room.phase              = 'playing'
  room.startedAt          = Date.now()
  _resetTurnTimer(room)
  room.lastActivity = Date.now()
  return { ok: true }
}

function takeCard(room, socketId) {
  const validation = _validateAction(room, socketId)
  if (!validation.ok) return validation

  const player = room.players[room.currentPlayerIndex]
  player.cards.push(room.currentCard)
  player.tokens += room.tokensOnCard

  const action = {
    type: 'take', playerName: player.name,
    playerId: player.id, card: room.currentCard, tokens: room.tokensOnCard,
  }
  room.lastAction = action
  _nextCard(room)
  if (room.phase === 'playing') {
    _nextPlayer(room)
    _resetTurnTimer(room)
  }
  room.lastActivity = Date.now()
  return { ok: true, action }
}

function refuseCard(room, socketId) {
  const validation = _validateAction(room, socketId)
  if (!validation.ok) return validation

  const player = room.players[room.currentPlayerIndex]
  if (player.tokens <= 0) return { ok: false, error: 'no_tokens' }

  player.tokens--
  room.tokensOnCard++
  room.lastAction = {
    type: 'refuse', playerName: player.name,
    playerId: player.id, card: room.currentCard,
  }
  _nextPlayer(room)
  _resetTurnTimer(room)
  room.lastActivity = Date.now()
  return { ok: true }
}

function _validateAction(room, socketId) {
  if (room.phase !== 'playing')         return { ok: false, error: 'wrong_phase' }
  const player = room.players[room.currentPlayerIndex]
  if (!player)                           return { ok: false, error: 'no_current_player' }
  if (player.socketId !== socketId)      return { ok: false, error: 'not_your_turn' }
  if (!player.connected)                 return { ok: false, error: 'player_disconnected' }
  return { ok: true }
}

function _nextCard(room) {
  if (room.deck.length === 0) {
    room.currentCard = null; room.tokensOnCard = 0
    room.phase = 'finished'; room.finishedAt = Date.now()
    room.lastActivity = Date.now()
  } else {
    room.currentCard = room.deck.shift(); room.tokensOnCard = 0
  }
}

function _nextPlayer(room) {
  room.currentPlayerIndex = (room.currentPlayerIndex + 1) % room.players.length
}

/** Réinitialise l'horodatage du tour (pour le timer serveur). */
function _resetTurnTimer(room) {
  room._timerStartedAt = room.timerEnabled ? Date.now() : null
}

/**
 * Retourne les secondes restantes pour le tour courant.
 * Calculé à partir de _timerStartedAt pour éviter de stocker un intervalle.
 */
function getTimerRemaining(room) {
  if (!room.timerEnabled || !room._timerStartedAt) return null
  const elapsed = Math.floor((Date.now() - room._timerStartedAt) / 1000)
  return Math.max(0, room.timerDuration - elapsed)
}

function handleDisconnect(room, socketId) {
  const idx = room.players.findIndex(p => p.socketId === socketId)
  if (idx === -1) return { removed: false }
  if (room.phase === 'lobby') {
    room.players.splice(idx, 1)
    if (room.host === socketId && room.players.length > 0) room.host = room.players[0].socketId
  } else {
    // Mark player disconnected and pause the game so they can reconnect
    room.players[idx].connected = false
    if (!Array.isArray(room.disconnectedPlayers)) room.disconnectedPlayers = []
    if (!room.disconnectedPlayers.includes(room.players[idx].id)) room.disconnectedPlayers.push(room.players[idx].id)
    if (room.phase === 'playing') {
      room.phase = 'paused'
      _resetTurnTimer(room)
    }
  }
  room.lastActivity = Date.now()
  return {
    removed: true,
    isEmpty: room.players.filter(p => p.connected).length === 0,
    isHost:  room.host === socketId,
    newHostId: room.host,
  }
}

function handleReconnect(room, oldSocketId, newSocketId) {
  const player = room.players.find(p => p.socketId === oldSocketId)
  if (!player) return { ok: false }
  player.socketId = newSocketId; player.connected = true
  // remove from disconnected list
  if (Array.isArray(room.disconnectedPlayers)) {
    const i = room.disconnectedPlayers.indexOf(player.id)
    if (i !== -1) room.disconnectedPlayers.splice(i, 1)
  }
  // resume if nobody else is disconnected
  if (room.phase === 'paused' && (!room.disconnectedPlayers || room.disconnectedPlayers.length === 0)) {
    room.phase = 'playing'
    _resetTurnTimer(room)
  }
  room.lastActivity = Date.now()
  return { ok: true, player }
}

function addBot(room, name) {
  const botCount = room.players.filter(p => p.isBot).length
  if (botCount >= 4) return { ok: false, error: 'bots_full' }
  if (room.players.length >= MAX_PLAYERS) return { ok: false, error: 'room_full' }
  const id = room.players.length
  room.players.push({ socketId: null, id, name: name ? String(name).trim() : `Bot ${id+1}`, cards: [], tokens: 0, connected: true, isBot: true })
  room.lastActivity = Date.now()
  return { ok: true }
}

function takeCardByPlayerId(room, playerId) {
  const player = room.players[room.currentPlayerIndex]
  if (!player || player.id !== playerId) return { ok: false, error: 'not_your_turn' }
  player.cards.push(room.currentCard)
  player.tokens += room.tokensOnCard
  const action = { type: 'take', playerName: player.name, playerId: player.id, card: room.currentCard, tokens: room.tokensOnCard }
  room.lastAction = action
  _nextCard(room)
  if (room.phase === 'playing') { _nextPlayer(room); _resetTurnTimer(room) }
  room.lastActivity = Date.now()
  return { ok: true, action }
}

function refuseCardByPlayerId(room, playerId) {
  const player = room.players[room.currentPlayerIndex]
  if (!player || player.id !== playerId) return { ok: false, error: 'not_your_turn' }
  if (player.tokens <= 0) return { ok: false, error: 'no_tokens' }
  player.tokens--
  room.tokensOnCard++
  room.lastAction = { type: 'refuse', playerName: player.name, playerId: player.id, card: room.currentCard }
  _nextPlayer(room)
  _resetTurnTimer(room)
  room.lastActivity = Date.now()
  return { ok: true }
}

function getPublicState(room) {
  return {
    code:               room.code,
    phase:              room.phase,
    timerEnabled:       room.timerEnabled,
    timerDuration:      room.timerDuration,
    timerRemaining:     getTimerRemaining(room),   // ← inclus dans chaque broadcast
    players: room.players.map(p => ({
      id: p.id, name: p.name, cards: p.cards, tokens: p.tokens,
      connected: p.connected,
      isBot: p.isBot || false,
      score:     calcScore(p.cards, p.tokens),
      sequences: getSequences(p.cards),
      isCurrentPlayer: p.id === room.players[room.currentPlayerIndex]?.id,
    })),
    currentCard:        room.currentCard,
    tokensOnCard:       room.tokensOnCard,
    currentPlayerIndex: room.currentPlayerIndex,
    currentPlayerName:  room.players[room.currentPlayerIndex]?.name ?? null,
    lastAction:         room.lastAction,
    deckSize:           room.deck.length,
    cardsRemaining:     room.deck.length + (room.currentCard !== null ? 1 : 0),
  }
}

function getFinalRanking(room) {
  return [...room.players]
    .map(p => ({
      id: p.id, name: p.name, cards: p.cards, tokens: p.tokens,
      score: calcScore(p.cards, p.tokens), sequences: getSequences(p.cards),
    }))
    .sort((a, b) => a.score - b.score)
}

module.exports = {
  createRoom, addPlayer, setRoomOptions, startGame,
  takeCard, refuseCard,
  handleDisconnect, handleReconnect,
  // bots
  addBot, takeCardByPlayerId, refuseCardByPlayerId,
  getPublicState, getFinalRanking, getTimerRemaining,
  calcScore, getSequences,
  MIN_PLAYERS, MAX_PLAYERS,
}
