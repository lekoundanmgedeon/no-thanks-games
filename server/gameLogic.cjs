/**
 * gameLogic.js — Logique pure du jeu "No Thanks!" (côté serveur)
 *
 * Aucune dépendance Vue, aucun Socket.
 * Ce module est la source de vérité : toute action passe ici.
 * Le client ne fait que DEMANDER une action — le serveur valide et applique.
 */

// ─── Constantes ────────────────────────────────────────────────────────────────
const CARD_MIN        = 3
const CARD_MAX        = 35
const CARDS_REMOVED   = 9
const TOKENS_PER_PLAYER = 11
const MIN_PLAYERS     = 3
const MAX_PLAYERS     = 7

// ─── Utilitaires ───────────────────────────────────────────────────────────────

/** Fisher-Yates shuffle (mélange en place). */
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

/**
 * Calcule le score d'un joueur.
 * Seule la plus petite carte de chaque séquence consécutive compte.
 */
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

/** Retourne les séquences consécutives d'un joueur (pour affichage). */
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

// ─── État d'une partie ─────────────────────────────────────────────────────────

/**
 * Crée un nouvel état de jeu propre.
 * @param {string} roomCode - Code de la salle
 * @param {string} hostSocketId - Socket ID du créateur
 * @returns {GameState}
 */
function createRoom(roomCode, hostSocketId) {
  return {
    code:               roomCode,       // Code de la salle (ex: "ABCD")
    phase:              'lobby',        // 'lobby' | 'playing' | 'finished'
    host:               hostSocketId,   // Socket ID du joueur hôte
    players:            [],             // Liste des joueurs dans l'ordre de jeu
    deck:               [],             // Cartes restantes dans la pioche
    currentCard:        null,           // Carte visible actuellement
    tokensOnCard:       0,              // Jetons posés sur la carte courante
    currentPlayerIndex: 0,              // Index du joueur dont c'est le tour
    lastAction:         null,           // Dernière action jouée (pour l'UI)
    removedCards:       [],             // Cartes retirées (invisibles)
    createdAt:          Date.now(),
    startedAt:          null,
    finishedAt:         null,
  }
}

/**
 * Ajoute un joueur au lobby d'une partie.
 * Retourne { ok, error } selon la validité de l'opération.
 */
function addPlayer(room, socketId, name) {
  if (room.phase !== 'lobby') return { ok: false, error: 'game_already_started' }
  if (room.players.length >= MAX_PLAYERS) return { ok: false, error: 'room_full' }

  // Vérifie que le nom n'est pas déjà pris (insensible à la casse)
  const nameTaken = room.players.some(
    p => p.name.toLowerCase() === name.trim().toLowerCase()
  )
  if (nameTaken) return { ok: false, error: 'name_taken' }

  room.players.push({
    socketId,             // Identifiant réseau (pour valider les actions)
    id:       room.players.length,  // Index stable dans la partie
    name:     name.trim() || `Joueur ${room.players.length + 1}`,
    cards:    [],         // Cartes récupérées
    tokens:   0,          // Jetons restants (assignés au démarrage)
    connected: true,      // Permet de gérer les déconnexions
  })

  return { ok: true }
}

/**
 * Démarre la partie depuis le lobby.
 * Retourne { ok, error }.
 */
function startGame(room, requestingSocketId) {
  // Seul l'hôte peut démarrer
  if (room.host !== requestingSocketId) return { ok: false, error: 'not_host' }
  if (room.phase !== 'lobby')           return { ok: false, error: 'wrong_phase' }
  if (room.players.length < MIN_PLAYERS) return { ok: false, error: 'not_enough_players' }

  // 1. Assigner les jetons
  room.players.forEach(p => { p.tokens = TOKENS_PER_PLAYER })

  // 2. Préparer et mélanger les cartes
  const allCards = Array.from({ length: CARD_MAX - CARD_MIN + 1 }, (_, i) => i + CARD_MIN)
  shuffle(allCards)

  // 3. Retirer 9 cartes aléatoires (non visibles)
  room.removedCards = allCards.splice(0, CARDS_REMOVED)
  shuffle(allCards)

  // 4. Mélanger l'ordre des joueurs
  shuffle(room.players)
  room.players.forEach((p, i) => { p.id = i }) // Réindexer après mélange

  // 5. Initialiser la pioche et la première carte
  room.deck        = allCards
  room.currentCard = room.deck.shift()
  room.tokensOnCard = 0
  room.currentPlayerIndex = 0
  room.lastAction  = null
  room.phase       = 'playing'
  room.startedAt   = Date.now()

  return { ok: true }
}

/**
 * Action : Prendre la carte.
 * Validation stricte côté serveur — le client ne peut pas tricher.
 * Retourne { ok, error, action }
 */
function takeCard(room, socketId) {
  // ── Validation ──
  const validation = _validateAction(room, socketId)
  if (!validation.ok) return validation

  const player = room.players[room.currentPlayerIndex]

  // Appliquer l'action
  player.cards.push(room.currentCard)
  player.tokens += room.tokensOnCard

  const action = {
    type:       'take',
    playerName: player.name,
    playerId:   player.id,
    card:       room.currentCard,
    tokens:     room.tokensOnCard,
  }
  room.lastAction = action

  // Passer à la carte suivante
  _nextCard(room)

  // Passer au joueur suivant (même si fin de partie)
  if (room.phase === 'playing') _nextPlayer(room)

  return { ok: true, action }
}

/**
 * Action : Refuser la carte ("No Thanks!").
 * Le joueur pose un jeton sur la carte et passe la main.
 */
function refuseCard(room, socketId) {
  // ── Validation ──
  const validation = _validateAction(room, socketId)
  if (!validation.ok) return validation

  const player = room.players[room.currentPlayerIndex]

  // Sans jeton, impossible de refuser
  if (player.tokens <= 0) return { ok: false, error: 'no_tokens' }

  player.tokens--
  room.tokensOnCard++

  room.lastAction = {
    type:       'refuse',
    playerName: player.name,
    playerId:   player.id,
    card:       room.currentCard,
  }

  _nextPlayer(room)
  return { ok: true }
}

// ─── Helpers internes ──────────────────────────────────────────────────────────

/**
 * Valide qu'une action est légale :
 * - La partie doit être en cours
 * - C'est bien le tour du joueur qui fait la demande
 * - Le joueur doit être connecté
 */
function _validateAction(room, socketId) {
  if (room.phase !== 'playing')
    return { ok: false, error: 'wrong_phase' }

  const player = room.players[room.currentPlayerIndex]
  if (!player)
    return { ok: false, error: 'no_current_player' }

  // Anti-triche : on vérifie le socketId, pas juste l'index
  if (player.socketId !== socketId)
    return { ok: false, error: 'not_your_turn' }

  if (!player.connected)
    return { ok: false, error: 'player_disconnected' }

  return { ok: true }
}

/** Avance à la prochaine carte de la pioche, ou termine la partie. */
function _nextCard(room) {
  if (room.deck.length === 0) {
    room.currentCard  = null
    room.tokensOnCard = 0
    room.phase        = 'finished'
    room.finishedAt   = Date.now()
  } else {
    room.currentCard  = room.deck.shift()
    room.tokensOnCard = 0
  }
}

/** Passe au joueur suivant (ordre circulaire). */
function _nextPlayer(room) {
  room.currentPlayerIndex =
    (room.currentPlayerIndex + 1) % room.players.length
}

// ─── Vues publiques de l'état ──────────────────────────────────────────────────

/**
 * Construit la vue complète de l'état envoyée à TOUS les clients.
 * On n'expose JAMAIS les cartes retirées ni les socketIds.
 */
function getPublicState(room) {
  return {
    code:               room.code,
    phase:              room.phase,
    players:            room.players.map(p => ({
      id:        p.id,
      name:      p.name,
      cards:     p.cards,
      tokens:    p.tokens,
      connected: p.connected,
      score:     calcScore(p.cards, p.tokens),
      sequences: getSequences(p.cards),
      isCurrentPlayer: p.id === room.players[room.currentPlayerIndex]?.id,
    })),
    currentCard:        room.currentCard,
    tokensOnCard:       room.tokensOnCard,
    currentPlayerIndex: room.currentPlayerIndex,
    currentPlayerName:  room.players[room.currentPlayerIndex]?.name ?? null,
    lastAction:         room.lastAction,
    deckSize:           room.deck.length,   // Taille de la pioche (pas son contenu)
    cardsRemaining:     room.deck.length + (room.currentCard !== null ? 1 : 0),
  }
}

/**
 * Construit le classement final (seulement quand phase === 'finished').
 */
function getFinalRanking(room) {
  return [...room.players]
    .map(p => ({
      id:        p.id,
      name:      p.name,
      cards:     p.cards,
      tokens:    p.tokens,
      score:     calcScore(p.cards, p.tokens),
      sequences: getSequences(p.cards),
    }))
    .sort((a, b) => a.score - b.score)
}

/**
 * Gère la déconnexion d'un joueur.
 * - En lobby : le retire de la liste
 * - En jeu : le marque disconnected, saute son tour si c'est le sien
 * Retourne { removed: bool } pour que le serveur sache si la room est vide.
 */
function handleDisconnect(room, socketId) {
  const idx = room.players.findIndex(p => p.socketId === socketId)
  if (idx === -1) return { removed: false }

  if (room.phase === 'lobby') {
    // En lobby, on peut simplement retirer le joueur
    room.players.splice(idx, 1)
    // Si c'était l'hôte, transférer au prochain joueur
    if (room.host === socketId && room.players.length > 0) {
      room.host = room.players[0].socketId
    }
  } else {
    // En jeu, on marque le joueur comme déconnecté
    room.players[idx].connected = false

    // Si c'était son tour, on passe au suivant
    if (room.currentPlayerIndex === idx && room.phase === 'playing') {
      _nextPlayer(room)
    }
  }

  return {
    removed:   true,
    isEmpty:   room.players.filter(p => p.connected).length === 0,
    isHost:    room.host === socketId,
    newHostId: room.host,
  }
}

/**
 * Gère la reconnexion d'un joueur (même nom dans la même partie).
 * Met à jour son socketId.
 */
function handleReconnect(room, oldSocketId, newSocketId) {
  const player = room.players.find(p => p.socketId === oldSocketId)
  if (!player) return { ok: false }
  player.socketId  = newSocketId
  player.connected = true
  return { ok: true, player }
}

// ─── Exports ───────────────────────────────────────────────────────────────────
module.exports = {
  createRoom,
  addPlayer,
  startGame,
  takeCard,
  refuseCard,
  handleDisconnect,
  handleReconnect,
  getPublicState,
  getFinalRanking,
  calcScore,
  getSequences,
  MIN_PLAYERS,
  MAX_PLAYERS,
}
