<template>
  <!--
    NetworkGameBoard.vue — Plateau de jeu multijoueur réseau.
    Identique à GameBoard.vue mais adapté au flux réseau :
    - Les boutons n'appellent plus useGame directement
    - Ils émettent des événements → App → socket.emit(...)
    - Les boutons sont désactivés quand ce n'est pas notre tour
    - Un bandeau indique clairement "Votre tour" ou "Tour de X"
  -->
  <div class="min-h-screen flex flex-col items-center px-4 py-6 gap-6">

    <!-- En-tête -->
    <header class="w-full max-w-5xl flex items-center justify-between">
      <div class="flex items-center gap-3">
        <h1 class="font-display text-2xl md:text-3xl text-gold tracking-tight">
          No <span class="italic">Thanks!</span>
        </h1>
        <!-- Badge réseau -->
        <span class="text-xs px-2 py-0.5 rounded-full bg-blue-900/40 border border-blue-400/20 text-blue-300 font-body">
          🌐 Réseau — {{ roomCode }}
        </span>
      </div>
      <div class="flex items-center gap-4 text-sm text-felt-light font-body">
        <span class="font-mono">{{ cardsRemaining }} carte{{ cardsRemaining !== 1 ? 's' : '' }} restante{{ cardsRemaining !== 1 ? 's' : '' }}</span>
        <button
          class="text-xs px-3 py-1 rounded-lg border border-red-500/30 text-red-400/70 hover:text-red-400 hover:border-red-500/60 transition-colors"
          @click="$emit('leave')"
        >Quitter</button>
      </div>
    </header>

    <!-- Bandeau "Votre tour" ou "Tour de X" -->
    <Transition name="banner-fade">
      <div
        class="w-full max-w-5xl rounded-xl px-4 py-2.5 text-center text-sm font-semibold"
        :class="isMyTurn
          ? 'bg-token-gold/20 border border-token-gold/50 text-gold'
          : 'panel border text-felt-light'"
      >
        <span v-if="isMyTurn">✨ C'est votre tour !</span>
        <span v-else>
          Tour de <span class="text-gold">{{ currentPlayerName }}</span>…
        </span>
      </div>
    </Transition>

    <!-- Corps principal -->
    <main class="w-full max-w-5xl flex flex-col lg:flex-row gap-6 flex-1">

      <!-- Colonne centrale -->
      <div class="flex flex-col items-center gap-8 flex-1">

        <!-- Toast dernière action -->
        <Transition name="action-toast">
          <div
            v-if="lastAction"
            :key="lastAction.type + lastAction.card"
            class="panel-gold px-4 py-2 text-sm text-center"
            :class="lastAction.type === 'take' ? 'border-green-500/40' : 'border-red-500/40'"
          >
            <span class="font-semibold" :class="lastAction.type === 'take' ? 'text-green-400' : 'text-red-400'">
              {{ lastAction.playerName }}
            </span>
            <span class="text-felt-light mx-1">
              {{ lastAction.type === 'take' ? t('game.action_took') : t('game.action_refused') }}
            </span>
            <span class="text-gold font-mono">{{ lastAction.card }}</span>
            <span v-if="lastAction.type === 'take' && lastAction.tokens > 0" class="text-gold ml-1">
              (+{{ lastAction.tokens }} {{ t('game.tokens_gained') }})
            </span>
          </div>
        </Transition>

        <!-- Carte centrale -->
        <div class="panel-gold p-8 flex flex-col items-center gap-6">
          <CardPile
            :card="currentCard"
            :tokens-on-card="tokensOnCard"
            :deck-size="deckSize"
            :anim-key="cardAnimKey"
          />
        </div>

        <!-- Séparateur -->
        <div class="w-full flex items-center gap-3">
          <div class="h-px flex-1 bg-gradient-to-r from-transparent via-token-gold/30 to-transparent" />
          <div class="token small opacity-60" />
          <div class="h-px flex-1 bg-gradient-to-r from-transparent via-token-gold/30 to-transparent" />
        </div>

        <!-- Contrôles -->
        <div class="flex flex-col items-center gap-4">

          <!-- Infos joueur actif -->
          <div class="flex items-center gap-3 mb-1">
            <div class="w-3 h-3 rounded-full animate-pulse-gold"
              :class="isMyTurn ? 'bg-token-gold' : 'bg-blue-400'" />
            <span class="font-display text-lg text-gold">{{ currentPlayerName }}</span>
            <span class="text-felt-light font-body text-sm">
              — {{ isMyTurn ? 'votre tour' : 'en train de jouer' }}
            </span>
          </div>

          <!-- Mes jetons -->
          <div v-if="myPlayer" class="flex items-center gap-2">
            <div class="token medium" />
            <span class="font-mono text-gold text-base">
              {{ myPlayer.tokens }} {{ t('controls.tokens', myPlayer.tokens) }}
            </span>
            <span v-if="myPlayer.tokens === 0 && isMyTurn" class="text-red-400 text-xs ml-1">
              {{ t('controls.must_take') }}
            </span>
          </div>

          <!-- Erreur d'action -->
          <Transition name="error-fade">
            <div v-if="actionError" class="text-red-400 text-sm text-center bg-red-900/20 border border-red-500/30 rounded-lg px-4 py-2">
              {{ actionError.message }}
            </div>
          </Transition>

          <!-- Boutons -->
          <div class="flex gap-4" :class="{ 'animate-shake': noTokenShake }">
            <button
              class="btn-take flex items-center gap-2"
              :disabled="!isMyTurn"
              @click="$emit('take')"
              title="Prendre la carte"
            >
              <span class="text-lg">✋</span>
              <span>{{ t('controls.take_btn') }}</span>
            </button>

            <button
              class="btn-refuse flex items-center gap-2"
              :disabled="!isMyTurn || (myPlayer && myPlayer.tokens === 0)"
              @click="$emit('refuse')"
              title="No Thanks!"
            >
              <span class="text-lg">🚫</span>
              <span>{{ t('controls.refuse_btn') }}</span>
            </button>
          </div>

          <!-- Message d'attente quand pas mon tour -->
          <p v-if="!isMyTurn" class="text-felt-light/60 text-xs italic">
            Attendez votre tour…
          </p>
        </div>

      </div>

      <!-- Colonne droite : joueurs -->
      <aside class="w-full lg:w-72 xl:w-80 flex flex-col gap-3">
        <h2 class="text-xs uppercase tracking-widest text-felt-light font-body mb-1 px-1">
          {{ t('game.players_title') }}
        </h2>

        <div
          v-for="player in players"
          :key="player.id"
          class="panel p-3 transition-all duration-300 relative overflow-hidden"
          :class="{
            'player-active border-2': player.isCurrentPlayer,
            'border border-transparent': !player.isCurrentPlayer,
            'opacity-60': !player.connected,
          }"
        >
          <div v-if="player.isCurrentPlayer" class="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-transparent via-token-gold to-transparent" />

          <!-- En-tête joueur -->
          <div class="flex items-center justify-between mb-2">
            <div class="flex items-center gap-2 min-w-0">
              <div class="w-2 h-2 rounded-full shrink-0"
                :class="player.connected ? (player.isCurrentPlayer ? 'bg-token-gold animate-pulse-gold' : 'bg-green-500/60') : 'bg-red-500/60'" />
              <span class="font-display font-bold truncate text-sm"
                :class="player.isCurrentPlayer ? 'text-gold' : 'text-card-bg'">
                {{ player.name }}
              </span>
              <!-- Badge "vous" -->
              <span v-if="player.name === myPlayerName" class="text-xs text-felt-light shrink-0">(vous)</span>
              <!-- Badge déconnecté -->
              <span v-if="!player.connected" class="text-xs text-red-400 shrink-0">⚠ déco</span>
            </div>
            <div class="flex items-center gap-1 shrink-0">
              <div class="token small" />
              <span class="font-mono text-xs" :class="player.tokens === 0 ? 'text-red-400' : 'text-gold'">
                {{ player.tokens }}
              </span>
            </div>
          </div>

          <!-- Score -->
          <div class="text-xs text-felt-light font-mono mb-2 flex items-center gap-1">
            <span>{{ t('player.score') }}</span>
            <span :class="player.score < 0 ? 'text-green-400' : 'text-card-bg'">{{ player.score }}</span>
          </div>

          <!-- Cartes -->
          <div v-if="player.cards.length > 0" class="flex flex-wrap gap-1.5">
            <template v-for="(seq, si) in player.sequences" :key="si">
              <div class="flex items-center gap-0.5 px-1.5 py-1 rounded-lg"
                :class="seq.length > 1 ? 'bg-token-gold/10 border border-token-gold/20' : ''">
                <div
                  v-for="(c, ci) in seq" :key="c"
                  class="playing-card small"
                  :class="[smallCardColor(c), ci > 0 ? '-ml-2' : '']"
                  :style="{ zIndex: ci }"
                >{{ c }}</div>
                <span v-if="seq.length > 1" class="sequence-badge ml-1">+{{ seq.length - 1 }}</span>
              </div>
            </template>
          </div>
          <div v-else class="text-felt-light text-xs italic">{{ t('player.no_cards') }}</div>
        </div>

        <!-- Notification réseau -->
        <Transition name="notif-fade">
          <div v-if="notification" class="panel px-3 py-2 text-xs text-felt-light text-center border border-blue-400/20">
            {{ notification.message }}
          </div>
        </Transition>

        <!-- Légende -->
        <div class="panel px-3 py-2 text-xs text-felt-light flex items-start gap-2 mt-1">
          <span class="text-token-gold">ℹ</span>
          <span>{{ t('game.seq_hint') }}</span>
        </div>
      </aside>

    </main>
  </div>
</template>

<script setup>
import CardPile from './CardPile.vue'
import { useI18n } from '../composables/useI18n.js'

const { t } = useI18n()

defineProps({
  // Identité
  myPlayerName:       { type: String,  default: '' },
  roomCode:           { type: String,  default: '' },
  isMyTurn:           { type: Boolean, default: false },
  myPlayer:           { type: Object,  default: null },

  // État de jeu
  players:            { type: Array,   default: () => [] },
  currentCard:        { type: Number,  default: null },
  tokensOnCard:       { type: Number,  default: 0 },
  deckSize:           { type: Number,  default: 0 },
  cardsRemaining:     { type: Number,  default: 0 },
  currentPlayerName:  { type: String,  default: '' },
  lastAction:         { type: Object,  default: null },
  cardAnimKey:        { type: Number,  default: 0 },

  // UI
  noTokenShake:       { type: Boolean, default: false },
  actionError:        { type: Object,  default: null },
  notification:       { type: Object,  default: null },
})

defineEmits(['take', 'refuse', 'leave'])

function smallCardColor(n) {
  if (n <= 10) return 'card-small-low'
  if (n <= 20) return 'card-small-mid'
  if (n <= 28) return 'card-small-high'
  return 'card-small-top'
}
</script>

<style scoped>
.action-toast-enter-active, .action-toast-leave-active { transition: all 0.3s ease; }
.action-toast-enter-from { opacity: 0; transform: translateY(-8px) scale(0.97); }
.action-toast-leave-to   { opacity: 0; transform: translateY(-4px); }

.banner-fade-enter-active, .banner-fade-leave-active { transition: all 0.4s ease; }
.banner-fade-enter-from, .banner-fade-leave-to { opacity: 0; }

.error-fade-enter-active, .error-fade-leave-active { transition: all 0.3s ease; }
.error-fade-enter-from, .error-fade-leave-to { opacity: 0; transform: translateY(-4px); }

.notif-fade-enter-active, .notif-fade-leave-active { transition: opacity 0.3s; }
.notif-fade-enter-from, .notif-fade-leave-to { opacity: 0; }

.card-small-low  { background:#fefae8; border-color:#d4a020; color:#1a0e00; }
.card-small-mid  { background:#fdf6e3; border-color:#c9a84c; color:#1a0e00; }
.card-small-high { background:#ede6f5; border-color:#9b7ac4; color:#2a1060; }
.card-small-top  { background:#e0e8f4; border-color:#5a7ab0; color:#0a2050; }
</style>
