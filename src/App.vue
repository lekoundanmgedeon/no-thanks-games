<template>
  <div class="relative min-h-screen">

    <!-- Déco flottante -->
    <div class="fixed inset-0 pointer-events-none overflow-hidden" aria-hidden="true">
      <div v-for="i in 8" :key="i" class="absolute token small opacity-10" :style="floatingTokenStyle(i)" />
    </div>

    <Transition name="screen-fade" mode="out-in">

      <!-- ── Choix du mode ── -->
      <ModeSelect
        v-if="appPhase === 'mode-select'"
        key="mode-select"
        @solo="appPhase = 'solo-setup'"
        @network="handleNetworkMode"
      />

      <!-- ── SETUP SOLO ── -->
      <SetupScreen
        v-else-if="appPhase === 'solo-setup'"
        key="solo-setup"
        :has-save="hasSave"
        @start="handleSoloStart"
        @resume="handleSoloResume"
      />

      <!-- ── JEU SOLO ── -->
      <template v-else-if="appPhase === 'solo-playing'" key="solo-playing">

        <!-- Jeu prêt -->
        <GameBoard
          v-if="soloCurrentCard !== null"
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

        <!-- Loader -->
        <div v-else class="min-h-screen flex items-center justify-center">
          <div class="token large animate-pulse" />
        </div>

      </template>

      <!-- ── FIN SOLO ── -->
      <ScoreScreen
        v-else-if="appPhase === 'solo-finished'"
        key="solo-finished"
        :ranking="soloRanking"
        @restart="handleSoloRestart"
        @menu="appPhase = 'mode-select'"
      />

      <!-- ── LOBBY RÉSEAU ── -->
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

      <!-- ── JEU RÉSEAU ── -->
      <template v-else-if="appPhase === 'network-playing'" key="network-playing">

        <NetworkGameBoard
          v-if="netGameState?.currentCard != null"
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

        <!-- Loader réseau -->
        <div v-else class="min-h-screen flex items-center justify-center">
          <div class="token large animate-pulse" />
        </div>

      </template>

      <!-- ── FIN RÉSEAU ── -->
      <ScoreScreen
        v-else-if="appPhase === 'network-finished'"
        key="network-finished"
        :ranking="netRanking"
        @restart="appPhase = 'network-lobby'"
        @menu="appPhase = 'mode-select'"
      />

      <!-- Fallback -->
      <div v-else key="loading" class="min-h-screen flex items-center justify-center">
        <div class="token large animate-pulse" />
      </div>

    </Transition>

    <!-- Dialogue Quit -->
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

import ModeSelect from './components/ModeSelect.vue'
import SetupScreen from './components/SetupScreen.vue'
import GameBoard from './components/GameBoard.vue'
import ScoreScreen from './components/ScoreScreen.vue'
import NetworkLobby from './components/NetworkLobby.vue'
import NetworkGameBoard from './components/NetworkGameBoard.vue'

import { useGame } from './composables/useGame.js'
import { useTimer } from './composables/useTimer.js'
import { useI18n } from './composables/useI18n.js'
import { useNetworkGame } from './composables/useNetworkGame.js'

const { t } = useI18n()
const appPhase = ref('mode-select')

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
  if (v === 'playing') appPhase.value = 'solo-playing'
  if (v === 'finished') appPhase.value = 'solo-finished'
})

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
  if (!soloPlayers.value.length) {
    appPhase.value = 'mode-select'
    return
  }
  const names = soloPlayers.value.map(p => p.name)
  const isAI = soloPlayers.value.map(p => p.isAI)
  initGame(names, isAI)
}

function handleSoloTake() {
  stopTimer()
  soloPrendreCarte()
}

function handleSoloRefuse() {
  stopTimer()
  soloRefuserCarte()
}

function doQuit() {
  showQuitDialog.value = false
  stopTimer()
  resetGame()
  hasSave.value = true
  appPhase.value = 'mode-select'
}

function handleNetworkMode() {
  appPhase.value = 'network-lobby'
}

function handleNetConnect(url) {}
function handleNetLeave() {
  appPhase.value = 'mode-select'
}

function floatingTokenStyle(i) {
  const p = [
    { left: '5%', top: '15%' },
    { left: '88%', top: '8%' },
    { left: '15%', top: '75%' },
    { left: '92%', top: '60%' },
    { left: '45%', top: '5%' },
    { left: '70%', top: '90%' },
    { left: '30%', top: '92%' },
    { left: '58%', top: '50%' },
  ][(i - 1) % 8]

  return {
    left: p.left,
    top: p.top,
    animation: `float 8s ease-in-out infinite`
  }
}
</script>

<style scoped>
.screen-fade-enter-active,.screen-fade-leave-active{transition:opacity .3s ease,transform .3s ease}
.screen-fade-enter-from{opacity:0;transform:translateY(10px)}
.screen-fade-leave-to{opacity:0;transform:translateY(-10px)}
.dialog-fade-enter-active,.dialog-fade-leave-active{transition:opacity .2s ease}
.dialog-fade-enter-from,.dialog-fade-leave-to{opacity:0}
</style>
