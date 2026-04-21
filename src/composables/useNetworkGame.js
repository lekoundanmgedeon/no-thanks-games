/**
 * useNetworkGame.js — Logique de jeu réseau (multijoueur via Socket.IO)
 *
 * Le CLIENT ne modifie JAMAIS l'état directement.
 * Il émet une intention → le serveur valide → broadcast → l'UI se met à jour.
 *
 * Connexion :
 *  - Même machine (dev ou prod) : url = null → connexion relative "/"
 *  - Autre machine sur le réseau : url = "http://192.168.x.x:3000"
 */

import { ref, computed, readonly } from 'vue'
import { useSocket } from './useSocket.js'

// ─── État singleton (partagé entre composants) ────────────────────────────────
const phase        = ref('lobby')
const roomCode     = ref(null)
const isHost       = ref(false)
const myPlayerName = ref(null)
const gameState    = ref(null)
const notification = ref(null)
const actionError  = ref(null)
const cardAnimKey  = ref(0)
const noTokenShake = ref(false)

let _listenersRegistered = false

export function useNetworkGame() {
  const { getSocket, destroySocket, connected, connecting, socketError } = useSocket()

  // ─── Connexion ─────────────────────────────────────────────────────────────

  /**
   * Initialise la connexion Socket.IO.
   * @param {string|null} url
   *   null = connexion relative (même machine, fonctionne en dev + prod)
   *   "http://192.168.x.x:3000" = réseau local explicite
   */
  function connect(url = null) {
    const socket = getSocket(url)
    _registerListeners(socket)
    return socket
  }

  // ─── Listeners Socket.IO ───────────────────────────────────────────────────

  function _registerListeners(socket) {
    if (_listenersRegistered) return
    _listenersRegistered = true

    // État complet reçu après chaque action
    socket.on('game:state', (state) => {
      const prevCard = gameState.value?.currentCard
      gameState.value = state
      if (state.currentCard !== prevCard) cardAnimKey.value++
      if (state.phase === 'playing')  phase.value = 'playing'
      if (state.phase === 'finished') phase.value = 'finished'
    })

    // Fin de partie
    socket.on('game:finished', ({ ranking }) => {
      phase.value = 'finished'
      if (gameState.value) gameState.value.ranking = ranking
    })

    // Notifications (join, disconnect, new_host…)
    socket.on('game:notification', (notif) => {
      notification.value = notif
      setTimeout(() => { notification.value = null }, 4000)
    })

    // Erreur d'action (ex: "pas ton tour", "plus de jetons")
    socket.on('error:action', ({ code, message }) => {
      actionError.value = { code, message }
      if (code === 'no_tokens') {
        noTokenShake.value = true
        setTimeout(() => { noTokenShake.value = false }, 500)
      }
      setTimeout(() => { actionError.value = null }, 3000)
      console.warn('[net] Erreur:', code, '-', message)
    })

    // Partie créée → je suis l'hôte
    socket.on('room:created', ({ roomCode: code, isHost: host, state }) => {
      roomCode.value  = code
      isHost.value    = host
      gameState.value = state
      phase.value     = 'lobby'
    })

    // Partie rejointe
    socket.on('room:joined', ({ roomCode: code, isHost: host, state, reconnected }) => {
      roomCode.value  = code
      isHost.value    = host
      gameState.value = state
      phase.value     = 'lobby'
      if (reconnected) console.log('[net] Reconnexion réussie')
    })
  }

  // ─── Actions ───────────────────────────────────────────────────────────────

  function createRoom(playerName) {
    myPlayerName.value = playerName.trim()
    getSocket().emit('room:create', { playerName: myPlayerName.value })
  }

  function joinRoom(code, playerName) {
    myPlayerName.value = playerName.trim()
    getSocket().emit('room:join', {
      roomCode:   code.trim().toUpperCase(),
      playerName: myPlayerName.value,
    })
  }

  function startGame() {
    getSocket().emit('room:start')
  }

  function prendreCarte() {
    getSocket().emit('game:take')
  }

  function refuserCarte() {
    getSocket().emit('game:refuse')
  }

  function leaveRoom() {
    destroySocket()
    _reset()
  }

  function _reset() {
    phase.value        = 'lobby'
    roomCode.value     = null
    isHost.value       = false
    gameState.value    = null
    notification.value = null
    actionError.value  = null
    _listenersRegistered = false
  }

  // ─── Computed ──────────────────────────────────────────────────────────────

  const myPlayer = computed(() =>
    gameState.value?.players?.find(p => p.name === myPlayerName.value) ?? null
  )

  const isMyTurn = computed(() =>
    gameState.value?.currentPlayerName === myPlayerName.value
  )

  const currentPlayer = computed(() => {
    if (!gameState.value) return null
    return gameState.value.players?.[gameState.value.currentPlayerIndex] ?? null
  })

  const liveScores = computed(() =>
    gameState.value?.players?.map(p => ({
      id: p.id, name: p.name, score: p.score, sequences: p.sequences,
    })) ?? []
  )

  const ranking = computed(() => {
    if (phase.value !== 'finished') return []
    return (
      gameState.value?.ranking ??
      [...(gameState.value?.players ?? [])].sort((a, b) => a.score - b.score)
    )
  })

  // ─── Exposition ────────────────────────────────────────────────────────────
  return {
    connect, connected, connecting, socketError,
    phase:         readonly(phase),
    roomCode:      readonly(roomCode),
    isHost:        readonly(isHost),
    myPlayerName:  readonly(myPlayerName),
    gameState:     readonly(gameState),
    myPlayer, isMyTurn, currentPlayer, liveScores, ranking,
    cardAnimKey:   readonly(cardAnimKey),
    noTokenShake:  readonly(noTokenShake),
    notification:  readonly(notification),
    actionError:   readonly(actionError),
    createRoom, joinRoom, startGame,
    prendreCarte, refuserCarte, leaveRoom,
  }
}
