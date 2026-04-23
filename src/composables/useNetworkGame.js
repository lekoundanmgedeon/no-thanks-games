/**
 * useNetworkGame.js — Logique réseau v2
 * Nouveautés : timer serveur, mode spectateur, options de partie
 */
import { ref, computed, readonly } from 'vue'
import { useSocket } from './useSocket.js'

// ─── État singleton ───────────────────────────────────────────────────────────
const phase        = ref('lobby')
const roomCode     = ref(null)
const isHost       = ref(false)
const isSpectator  = ref(false)
const myPlayerName = ref(null)
const gameState    = ref(null)
const notification = ref(null)
const actionError  = ref(null)
const cardAnimKey  = ref(0)
const noTokenShake = ref(false)

// Timer (reçu du serveur via game:timer)
const timerRemaining = ref(null)
const timerDuration  = ref(30)
const timerEnabled   = ref(false)

let _listenersRegistered = false

export function useNetworkGame() {
  const { getSocket, destroySocket, connected, connecting, socketError } = useSocket()

  function connect(url = null) {
    const socket = getSocket(url)
    _registerListeners(socket)
    return socket
  }

  function _registerListeners(socket) {
    if (_listenersRegistered) return
    _listenersRegistered = true

    // État complet après chaque action
    socket.on('game:state', (state) => {
      const prevCard = gameState.value?.currentCard
      gameState.value = state
      if (state.currentCard !== prevCard) cardAnimKey.value++
      // Accept known phases and passthrough unknown ones (e.g. 'paused')
      if (typeof state.phase === 'string') phase.value = state.phase
      // Synchroniser les options de timer
      if (typeof state.timerEnabled  === 'boolean') timerEnabled.value  = state.timerEnabled
      if (typeof state.timerDuration === 'number')  timerDuration.value = state.timerDuration
      if (state.timerRemaining !== undefined)        timerRemaining.value = state.timerRemaining
    })

    // Ticker timer toutes les secondes (plus précis qu'un polling)
    socket.on('game:timer', ({ remaining }) => {
      timerRemaining.value = remaining
    })

    socket.on('game:finished', ({ ranking }) => {
      phase.value = 'finished'
      if (gameState.value) gameState.value.ranking = ranking
    })

    socket.on('game:notification', (notif) => {
      notification.value = notif
      setTimeout(() => { notification.value = null }, 4000)
    })

    socket.on('error:action', ({ code, message }) => {
      actionError.value = { code, message }
      if (code === 'no_tokens') {
        noTokenShake.value = true
        setTimeout(() => { noTokenShake.value = false }, 500)
      }
      setTimeout(() => { actionError.value = null }, 3000)
    })

    socket.on('room:created', ({ roomCode: code, isHost: host, state }) => {
      roomCode.value  = code
      isHost.value    = host
      isSpectator.value = false
      gameState.value = state
      phase.value     = 'lobby'
    })

    socket.on('room:joined', ({ roomCode: code, isHost: host, state }) => {
      roomCode.value  = code
      isHost.value    = host
      isSpectator.value = false
      gameState.value = state
      phase.value     = 'lobby'
    })

    // Confirmation du mode spectateur
    socket.on('room:spectating', ({ roomCode: code, state, ranking }) => {
      roomCode.value    = code
      isSpectator.value = true
      isHost.value      = false
      gameState.value   = state
      phase.value       = state?.phase ?? 'lobby'
      if (ranking && gameState.value) gameState.value.ranking = ranking
      if (state?.timerEnabled) timerEnabled.value = state.timerEnabled
    })
  }

  // ─── Actions ────────────────────────────────────────────────────────────────

  function createRoom(playerName) {
    myPlayerName.value = playerName.trim()
    getSocket().emit('room:create', { playerName: myPlayerName.value })
  }

  function joinRoom(code, playerName) {
    myPlayerName.value = playerName.trim()
    getSocket().emit('room:join', { roomCode: code.trim().toUpperCase(), playerName: myPlayerName.value })
  }

  /** Rejoindre en mode spectateur (sans nom de joueur). */
  function spectateRoom(code) {
    getSocket().emit('room:spectate', { roomCode: code.trim().toUpperCase() })
  }

  /** Envoyer les options de partie (hôte seulement). */
  function setOptions(options) {
    getSocket().emit('room:options', options)
  }

  function addBot(name) { getSocket().emit('room:addBot', { name }) }

  function startGame()     { getSocket().emit('room:start') }
  function prendreCarte()  { getSocket().emit('game:take') }
  function refuserCarte()  { getSocket().emit('game:refuse') }

  function leaveRoom() {
    destroySocket()
    _reset()
  }

  function _reset() {
    phase.value          = 'lobby'
    roomCode.value       = null
    isHost.value         = false
    isSpectator.value    = false
    gameState.value      = null
    notification.value   = null
    actionError.value    = null
    timerRemaining.value = null
    _listenersRegistered = false
  }

  // ─── Computed ───────────────────────────────────────────────────────────────

  const myPlayer = computed(() =>
    gameState.value?.players?.find(p => p.name === myPlayerName.value) ?? null
  )
  const isMyTurn = computed(() =>
    !isSpectator.value && gameState.value?.currentPlayerName === myPlayerName.value
  )
  const currentPlayer = computed(() => {
    if (!gameState.value) return null
    return gameState.value.players?.[gameState.value.currentPlayerIndex] ?? null
  })
  const liveScores = computed(() =>
    gameState.value?.players?.map(p => ({ id: p.id, name: p.name, score: p.score, sequences: p.sequences })) ?? []
  )
  const ranking = computed(() => {
    if (phase.value !== 'finished') return []
    return gameState.value?.ranking
      ?? [...(gameState.value?.players ?? [])].sort((a, b) => a.score - b.score)
  })

  // Timer computed
  const timerProgress = computed(() => {
    if (!timerEnabled.value || timerRemaining.value === null || timerDuration.value === 0) return 1
    return Math.max(0, timerRemaining.value / timerDuration.value)
  })
  const timerUrgency = computed(() => {
    const p = timerProgress.value
    if (p > 0.5) return 'safe'
    if (p > 0.25) return 'warn'
    return 'danger'
  })

  return {
    connect, connected, connecting, socketError,
    phase:           readonly(phase),
    roomCode:        readonly(roomCode),
    isHost:          readonly(isHost),
    isSpectator:     readonly(isSpectator),
    myPlayerName:    readonly(myPlayerName),
    gameState:       readonly(gameState),
    myPlayer, isMyTurn, currentPlayer, liveScores, ranking,
    cardAnimKey:     readonly(cardAnimKey),
    noTokenShake:    readonly(noTokenShake),
    notification:    readonly(notification),
    actionError:     readonly(actionError),
    // Timer
    timerEnabled:    readonly(timerEnabled),
    timerDuration:   readonly(timerDuration),
    timerRemaining:  readonly(timerRemaining),
    timerProgress,
    timerUrgency,
    // Actions
    createRoom, joinRoom, spectateRoom, setOptions, addBot,
    startGame, prendreCarte, refuserCarte, leaveRoom,
  }
}
