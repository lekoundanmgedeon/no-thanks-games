<template>
  <div class="min-h-screen flex flex-col items-center px-4 py-6 gap-6">

    <!-- En-tête -->
    <header class="w-full max-w-5xl flex items-center justify-between">
      <h1 class="font-display text-2xl md:text-3xl text-gold tracking-tight">
        No <span class="italic">Thanks!</span>
      </h1>
      <div class="flex items-center gap-4 text-sm text-felt-light font-body">
        <span class="font-mono">
          {{ deck.length + 1 }} {{ t('game.cards_left', deck.length + 1) }}
        </span>
        <button
          class="text-xs px-3 py-1 rounded-lg border border-token-gold/30 text-gold/70 hover:text-gold hover:border-token-gold/60 transition-colors"
          @click="$emit('quit')"
        >
          {{ t('game.quit_btn') }}
        </button>
      </div>
    </header>

    <!-- Corps -->
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
            :deck-size="deck.length"
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
        <Controls
          :player-name="currentPlayer.name"
          :player-tokens="currentPlayer.jetons"
          :is-a-i="currentPlayer.isAI"
          :disabled="currentPlayer.isAI"
          :shake="noTokenShake"
          :timer-enabled="timerEnabled"
          :remaining="remaining"
          :progress="progress"
          :urgency="urgency"
          @take="$emit('take')"
          @refuse="$emit('refuse')"
        />
      </div>

      <!-- Colonne droite : joueurs -->
      <aside class="w-full lg:w-72 xl:w-80 flex flex-col gap-3">
        <h2 class="text-xs uppercase tracking-widest text-felt-light font-body mb-1 px-1">
          {{ t('game.players_title') }}
        </h2>
        <PlayerPanel
          v-for="(player, i) in players"
          :key="player.id"
          :player="player"
          :is-active="i === currentPlayerIndex"
          :score="liveScores.find(s => s.id === player.id)?.score ?? 0"
          :sequences="liveScores.find(s => s.id === player.id)?.sequences ?? []"
        />
        <div class="panel px-3 py-2 text-xs text-felt-light flex items-start gap-2 mt-1">
          <span class="text-token-gold">ℹ</span>
          <span>{{ t('game.seq_hint') }}</span>
        </div>
      </aside>

    </main>
  </div>
</template>

<script setup>
import CardPile    from './CardPile.vue'
import Controls    from './Controls.vue'
import PlayerPanel from './PlayerPanel.vue'
import { useI18n } from '../composables/useI18n.js'

const { t } = useI18n()

defineProps({
  players:            { type: Array,   required: true },
  deck:               { type: Array,   required: true },
  currentCard:        { type: Number,  required: true },
  tokensOnCard:       { type: Number,  required: true },
  currentPlayerIndex: { type: Number,  required: true },
  currentPlayer:      { type: Object,  required: true },
  lastAction:         { type: Object,  default: null },
  cardAnimKey:        { type: Number,  default: 0 },
  noTokenShake:       { type: Boolean, default: false },
  liveScores:         { type: Array,   default: () => [] },
  // Timer (transmis depuis App via useTimer)
  timerEnabled:       { type: Boolean, default: false },
  remaining:          { type: Number,  default: 0 },
  progress:           { type: Number,  default: 1 },
  urgency:            { type: String,  default: 'safe' },
})

defineEmits(['take', 'refuse', 'quit'])
</script>

<style scoped>
.action-toast-enter-active, .action-toast-leave-active { transition: all 0.3s ease; }
.action-toast-enter-from { opacity: 0; transform: translateY(-8px) scale(0.97); }
.action-toast-leave-to   { opacity: 0; transform: translateY(-4px); }
</style>
