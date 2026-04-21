<template>
  <div class="relative min-h-screen">

    <!-- Déco flottante -->
    <div class="fixed inset-0 pointer-events-none overflow-hidden" aria-hidden="true">
      <div v-for="i in 8" :key="i" class="absolute token small opacity-10" :style="floatingTokenStyle(i)" />
    </div>

    <Transition name="screen-fade" mode="out-in">

      <!-- ── Choix du mode (Solo / Réseau) ── -->
      <ModeSelect
        v-if="appPhase === 'mode-select'"
        key="mode-select"
        @solo="appPhase = 'solo-setup'"
        @network="handleNetworkMode"
      />

      <!-- ══════════════════════════════════════════════════════════════════ -->
      <!-- MODE SOLO                                                          -->
      <!-- ══════════════════════════════════════════════════════════════════ -->

      <SetupScreen
        v-else-if="appPhase === 'solo-setup'"
        key="solo-setup"
        :has-save="hasSave"
        @start="handleSoloStart"
        @resume="handleSoloResume"
      />

      <GameBoard
        v-else-if="appPhase === 'solo-playing' && soloCurrentCard !== null"
        key="solo-playing"
        :players="soloPlayers"
        :deck="soloDeck"
        :current-card="soloCurrentCard"
        :tokens-on-card="soloTokensOnCard"
        :current-player-index="soloCurrentPlayerIndex"
        :current-player="soloCurrentPlayer"
        :last-action="soloLastAction"
        :card-anim-key="soloCardAnimKey"
        :no-token-shake="soloNoTokenShake"
        :live-scores="soloLiveScores"
        :timer-enabled="timerEnabled"
        :remaining="timerRemaining"
        :progress="timerProgress"
        :urgency="timerUrgency"
        @take="handleSoloTake"
        @refuse="handleSoloRefuse"
        @quit="showQuitDialog = true"
      />

      <ScoreScreen
        v-else-if="appPhase === 'solo-finished'"
        key="solo-finished"
        :ranking="soloRanking"
        @restart="handleSoloRestart"
        @menu="appPhase = 'mode-select'"
      />

      <!-- ══════════════════════════════════════════════════════════════════ -->
      <!-- MODE RÉSEAU                                                        -->
      <!-- ══════════════════════════════════════════════════════════════════ -->

      <NetworkLobby
        v-else-if="appPhase === 'network-lobby'"
        key="network-lobby"
        :connected="netConnected"
        :connecting="netConnecting"
        :socket-error="netSocketError ? String(netSocketError) : null"
        :in-room="!!netRoomCode"
        :room-code="netRoomCode"
        :is-host="netIsHost"
        :my-player-name="netMyPlayerName"
        :players="netGameState?.players ?? []"
        :notification="netNotification"
        :action-error="netActionError"
        @connect="handleNetConnect"
        @create="netCreateRoom"
        @join="netJoinRoom"
        @start="netStartGame"
        @leave="handleNetLeave"
        @back="appPhase = 'mode-select'"
      />

      <NetworkGameBoard
        v-else-if="appPhase === 'network-playing' && netGameState?.currentCard != null"
        key="network-playing"
        :my-player-name="netMyPlayerName"
        :room-code="netRoomCode"
        :is-my-turn="netIsMyTurn"
        :my-player="netMyPlayer"
        :players="netGameState.players"
        :current-card="netGameState.currentCard"
        :tokens-on-card="netGameState.tokensOnCard"
        :deck-size="netGameState.deckSize"
        :cards-remaining="netGameState.cardsRemaining"
        :current-player-name="netGameState.currentPlayerName"
        :last-action="netGameState.lastAction"
        :card-anim-key="netCardAnimKey"
        :no-token-shake="netNoTokenShake"
        :action-error="netActionError"
        :notification="netNotification"
        @take="netPrendreCarte"
        @refuse="netRefuserCarte"
        @leave="handleNetLeave"
      />

      <ScoreScreen
        v-else-if="appPhase === 'network-finished'"
        key="network-finished"
        :ranking="netRanking"
        @restart="appPhase = 'network-lobby'"
        @menu="appPhase = 'mode-select'"
      />

      <!-- Fallback loading -->
      <div v-else key="loading" class="min-h-screen flex items-center justify-center">
        <div class="token large animate-pulse" />
      </div>

    </Transition>

    <!-- Dialogue de sortie (solo) -->
    <Transition name="dialog-fade">
      <div
        v-if="showQuitDialog"
        class="fixed inset-0 flex items-center justify-center z-50 px-4"
        style="background:rgba(0,0,0,0.6);backdrop-filter:blur(4px);"
        @click.self="showQuitDialog = false"
      >
        <div class="panel-gold p-6 max-w-sm w-full flex flex-col gap-4 text-center">
          <p class="font-display text-xl text-gold">{{ t('quit.title') }}</p>
          <p class="text-felt-light text-sm">{{ t('quit.message') }}</p>
          <div class="flex gap-3 justify-center">
            <button class="btn-refuse px-6" @click="doQuit">{{ t('quit.confirm') }}</button>
            <button class="btn-take px-6" @click="showQuitDialog = false">{{ t('quit.cancel') }}</button>
          </div>
        </div>
      </div>
    </Transition>

  </div>
</template>

<script setup>
import { ref, watch, onUnmounted, onMounted } from 'vue'

// ── Composants ──
import ModeSelect        from './components/ModeSelect.vue'
import SetupScreen       from './components/SetupScreen.vue'
import GameBoard         from './components/GameBoard.vue'
import ScoreScreen       from './components/ScoreScreen.vue'
import NetworkLobby      from './components/NetworkLobby.vue'
import NetworkGameBoard  from './components/NetworkGameBoard.vue'

// ── Composables ──
import { useGame }        from './composables/useGame.js'
import { useTimer }       from './composables/useTimer.js'
import { useI18n }        from './composables/useI18n.js'
import { useNetworkGame } from './composables/useNetworkGame.js'

const { t } = useI18n()

// ─── Phase globale de l'application ───────────────────────────────────────────
// 'mode-select' | 'solo-setup' | 'solo-playing' | 'solo-finished'
// | 'network-lobby' | 'network-playing' | 'network-finished'
const appPhase = ref('mode-select')

// ─── MODE SOLO ────────────────────────────────────────────────────────────────
const {
  phase: soloPhase,
  players: soloPlayers, deck: soloDeck,
  currentCard: soloCurrentCard, tokensOnCard: soloTokensOnCard,
  currentPlayerIndex: soloCurrentPlayerIndex,
  currentPlayer: soloCurrentPlayer,
  lastAction: soloLastAction, cardAnimKey: soloCardAnimKey,
  noTokenShake: soloNoTokenShake,
  ranking: soloRanking, liveScores: soloLiveScores,
  initGame, prendreCarte: soloPrendreCarte, refuserCarte: soloRefuserCarte,
  resetGame, loadFromStorage,
} = useGame()

const { timerEnabled, remaining: timerRemaining, progress: timerProgress,
        urgency: timerUrgency, startTimer, stopTimer, configure } = useTimer()

const hasSave = ref(false)
const showQuitDialog = ref(false)

onMounted(() => {
  try { hasSave.value = !!localStorage.getItem('no-thanks-save') } catch {}
})

watch(soloPhase, v => {
  if (v === 'playing')  appPhase.value = 'solo-playing'
  if (v === 'finished') appPhase.value = 'solo-finished'
})

watch(soloCurrentPlayerIndex, () => {
  if (soloPhase.value !== 'playing') return
  if (soloCurrentPlayer.value?.isAI) { stopTimer(); return }
  startTimer(() => soloPrendreCarte())
})

watch(soloCurrentCard, v => {
  if (v !== null && soloPhase.value === 'playing' && !soloCurrentPlayer.value?.isAI)
    startTimer(() => soloPrendreCarte())
}, { once: false })

watch(soloPhase, v => { if (v !== 'playing') stopTimer() })
onUnmounted(() => stopTimer())

function handleSoloStart(names, isAIList, options = {}) {
  configure(options.timerEnabled ?? false, options.timerDuration ?? 30)
  initGame(names, Array.isArray(isAIList) ? isAIList : [])
  hasSave.value = false
}
function handleSoloResume() {
  const ok = loadFromStorage()
  if (!ok) hasSave.value = false
}
function handleSoloRestart() {
  if (!soloPlayers.value.length) { appPhase.value = 'mode-select'; return }
  const names = soloPlayers.value.map(p => p.name)
  const isAI  = soloPlayers.value.map(p => p.isAI)
  initGame(names, isAI)
}
function handleSoloTake()   { stopTimer(); soloPrendreCarte() }
function handleSoloRefuse() { stopTimer(); soloRefuserCarte() }
function doQuit() {
  showQuitDialog.value = false
  stopTimer()
  resetGame()
  hasSave.value = true
  appPhase.value = 'mode-select'
}

// ─── MODE RÉSEAU ──────────────────────────────────────────────────────────────
const {
  connect: netConnect,
  connected: netConnected, connecting: netConnecting, socketError: netSocketError,
  phase: netPhase, roomCode: netRoomCode, isHost: netIsHost,
  myPlayerName: netMyPlayerName,
  gameState: netGameState, myPlayer: netMyPlayer, isMyTurn: netIsMyTurn,
  ranking: netRanking,
  cardAnimKey: netCardAnimKey, noTokenShake: netNoTokenShake,
  notification: netNotification, actionError: netActionError,
  createRoom: netCreateRoom, joinRoom: netJoinRoom, startGame: netStartGame,
  prendreCarte: netPrendreCarte, refuserCarte: netRefuserCarte,
  leaveRoom: netLeaveRoom,
} = useNetworkGame()

// Synchroniser la phase réseau avec appPhase
watch(netPhase, v => {
  if (v === 'playing')  appPhase.value = 'network-playing'
  if (v === 'finished') appPhase.value = 'network-finished'
})

// Quand le gameState passe en lobby → revenir au lobby si on était en jeu
watch(netGameState, state => {
  if (!state) return
  if (state.phase === 'playing' && appPhase.value === 'network-lobby')
    appPhase.value = 'network-playing'
})

function handleNetworkMode() {
  appPhase.value = 'network-lobby'
  // null = connexion relative → fonctionne avec proxy Vite en dev ET en prod
  netConnect(null)
}

function handleNetConnect(url) {
  netConnect(url)
}

function handleNetLeave() {
  netLeaveRoom()
  appPhase.value = 'mode-select'
}

// ─── Déco ─────────────────────────────────────────────────────────────────────
function floatingTokenStyle(i) {
  const p = [
    {left:'5%',top:'15%',d:'0s',dur:'7s'},
    {left:'88%',top:'8%',d:'1.2s',dur:'9s'},
    {left:'15%',top:'75%',d:'0.5s',dur:'8s'},
    {left:'92%',top:'60%',d:'2s',dur:'6s'},
    {left:'45%',top:'5%',d:'0.8s',dur:'10s'},
    {left:'70%',top:'90%',d:'1.5s',dur:'7.5s'},
    {left:'30%',top:'92%',d:'3s',dur:'8.5s'},
    {left:'58%',top:'50%',d:'2.5s',dur:'9.5s'},
  ][(i-1)%8]
  return {left:p.left,top:p.top,animation:`float ${p.dur} ease-in-out ${p.d} infinite`}
}
</script>

<style scoped>
.screen-fade-enter-active,.screen-fade-leave-active{transition:opacity .3s ease,transform .3s ease}
.screen-fade-enter-from{opacity:0;transform:translateY(10px)}
.screen-fade-leave-to{opacity:0;transform:translateY(-10px)}
.dialog-fade-enter-active,.dialog-fade-leave-active{transition:opacity .2s ease}
.dialog-fade-enter-from,.dialog-fade-leave-to{opacity:0}
</style>
