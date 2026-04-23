<template>
  <div class="min-h-screen flex flex-col items-center justify-center px-4 py-8 gap-8">

    <!-- Titre -->
    <div class="text-center">
      <h1 class="font-display text-5xl md:text-7xl text-gold tracking-tight leading-none mb-3 animate-float"
        v-html="t('setup.title')" />
      <p class="text-felt-light text-sm">{{ t('net.title') }}</p>
    </div>

    <!-- ═══════════════════ AVANT REJOINDRE ═══════════════════ -->
    <div v-if="!inRoom" class="panel-gold w-full max-w-md p-6 flex flex-col gap-5">

      <!-- Sélecteur de langue -->
      <div class="flex items-center justify-between">
        <div class="flex gap-2">
          <button v-for="l in ['fr','en']" :key="l"
            class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-sm font-semibold transition-all"
            :class="lang === l ? 'bg-token-gold text-ink-dark border-token-gold' : 'bg-felt/50 border-token-gold/20 text-felt-light hover:border-token-gold/50 hover:text-gold'"
            @click="setLang(l)">
            <span>{{ l === 'fr' ? '🇫🇷' : '🇬🇧' }}</span>
            <span class="uppercase">{{ l }}</span>
          </button>
        </div>
        <!-- Indicateur connexion -->
        <div class="flex items-center gap-2 text-xs">
          <div class="w-2 h-2 rounded-full" :class="connected ? 'bg-green-400 animate-pulse' : 'bg-red-400'" />
          <span class="text-felt-light">{{ connected ? t('net.connected') : connecting ? t('net.connecting') : t('net.disconnected') }}</span>
        </div>
      </div>

      <!-- URL serveur -->
      <div>
        <label class="text-xs uppercase tracking-widest text-felt-light block mb-2">{{ t('net.server_label') }}</label>
        <input v-model="serverUrlInput" type="text" :placeholder="t('net.server_placeholder')"
          class="w-full bg-felt-dark/60 border border-token-gold/20 rounded-lg px-3 py-2 text-sm text-card-bg placeholder-felt-light/50 focus:outline-none focus:border-token-gold/60 font-mono"
          @blur="handleServerUrlChange" />
      </div>

      <!-- Nom -->
      <div>
        <label class="text-xs uppercase tracking-widest text-felt-light block mb-2">{{ t('net.name_label') }}</label>
        <input v-model="localName" type="text" :placeholder="t('net.name_placeholder')" maxlength="20"
          class="w-full bg-felt-dark/60 border border-token-gold/20 rounded-lg px-3 py-2 text-sm text-card-bg placeholder-felt-light/50 focus:outline-none focus:border-token-gold/60"
          @keydown.enter="localCode ? handleJoin() : handleCreate()" />
      </div>

      <!-- Séparateur -->
      <div class="flex items-center gap-3">
        <div class="h-px flex-1 bg-token-gold/20" />
        <span class="text-xs text-felt-light">{{ t('net.or') }}</span>
        <div class="h-px flex-1 bg-token-gold/20" />
      </div>

      <!-- Créer / Rejoindre -->
      <div class="grid grid-cols-2 gap-3">
        <button class="btn-take flex flex-col items-center py-4 gap-1"
          :disabled="!connected || !localName.trim()" @click="handleCreate">
          <span class="text-2xl">🎴</span>
          <span class="text-sm">{{ t('net.create_btn') }}</span>
        </button>
        <div class="flex flex-col gap-2">
          <input v-model="localCode" type="text" :placeholder="t('net.join_placeholder')" maxlength="4"
            class="bg-felt-dark/60 border border-token-gold/20 rounded-lg px-3 py-2 text-sm text-card-bg placeholder-felt-light/50 focus:outline-none focus:border-token-gold/60 font-mono text-center tracking-widest uppercase"
            @input="localCode = localCode.toUpperCase()" @keydown.enter="handleJoin" />
          <button class="btn-refuse flex items-center justify-center gap-2 py-3"
            :disabled="!connected || !localName.trim() || localCode.length < 4" @click="handleJoin">
            <span>🚪</span><span class="text-sm">{{ t('net.join_btn') }}</span>
          </button>
        </div>
      </div>

      <!-- Mode spectateur -->
      <div class="border-t border-token-gold/15 pt-4">
        <label class="text-xs uppercase tracking-widest text-felt-light block mb-2">{{ t('net.spectate_label') }}</label>
        <div class="flex gap-2">
          <input v-model="spectateCode" type="text" :placeholder="t('net.spectate_placeholder')" maxlength="4"
            class="flex-1 bg-felt-dark/60 border border-blue-400/20 rounded-lg px-3 py-2 text-sm text-card-bg placeholder-felt-light/50 focus:outline-none focus:border-blue-400/50 font-mono text-center tracking-widest uppercase"
            @input="spectateCode = spectateCode.toUpperCase()" @keydown.enter="handleSpectate" />
          <button class="px-4 py-2 rounded-lg border border-blue-400/30 text-blue-300 hover:bg-blue-900/30 transition-all text-sm font-semibold disabled:opacity-40"
            :disabled="!connected || spectateCode.length < 4" @click="handleSpectate">
            {{ t('net.spectate_btn') }}
          </button>
        </div>
      </div>

      <!-- Erreur -->
      <Transition name="error-fade">
        <div v-if="actionError" class="bg-red-900/40 border border-red-500/40 rounded-lg px-3 py-2 text-sm text-red-300">
          {{ actionError.message }}
        </div>
      </Transition>

      <button class="text-sm text-felt-light/50 hover:text-felt-light transition-colors underline text-center" @click="$emit('back')">
        {{ t('net.back_btn') }}
      </button>
    </div>

    <!-- ═══════════════════ LOBBY SALLE ═══════════════════ -->
    <div v-else class="w-full max-w-md flex flex-col gap-5">

      <!-- Code -->
      <div class="panel-gold p-5 text-center flex flex-col gap-2">
        <p class="text-xs uppercase tracking-widest text-felt-light">{{ t('lobby.code_label') }}</p>
        <div class="font-display text-4xl text-gold tracking-[0.3em] cursor-pointer select-all"
          @click="copyCode" :title="codeCopied ? t('lobby.code_copied') : t('lobby.code_hint')">
          {{ roomCode }}
        </div>
        <p class="text-xs text-felt-light">{{ codeCopied ? t('lobby.code_copied') : t('lobby.code_hint') }}</p>
      </div>

      <!-- Options (hôte seulement) -->
      <div v-if="isHost" class="panel p-4 flex flex-col gap-3">
        <h3 class="text-xs uppercase tracking-widest text-felt-light">⚙ Options</h3>
        <div class="flex items-start gap-4 flex-wrap">

          <!-- Langue -->
          <div>
            <label class="text-xs text-felt-light block mb-1.5">{{ t('setup.lang_label') }}</label>
            <div class="flex gap-2">
              <button v-for="l in ['fr','en']" :key="l"
                class="flex items-center gap-1 px-2.5 py-1 rounded-lg border text-xs font-semibold transition-all"
                :class="lang === l ? 'bg-token-gold text-ink-dark border-token-gold' : 'bg-felt/50 border-token-gold/20 text-felt-light hover:border-token-gold/40'"
                @click="setLang(l)">
                {{ l === 'fr' ? '🇫🇷' : '🇬🇧' }} <span class="uppercase">{{ l }}</span>
              </button>
            </div>
          </div>

          <!-- Timer -->
          <div class="flex-1 min-w-[160px]">
            <label class="text-xs text-felt-light block mb-1.5">{{ t('lobby.timer_label') }}</label>
            <div class="flex items-center gap-2 flex-wrap">
              <button class="px-3 py-1.5 rounded-lg border text-xs font-semibold transition-all"
                :class="localTimerEnabled ? 'bg-token-gold text-ink-dark border-token-gold' : 'bg-felt/50 border-token-gold/20 text-felt-light hover:border-token-gold/40'"
                @click="toggleTimer">
                {{ localTimerEnabled ? '⏱' : t('lobby.timer_off') }}
              </button>
              <Transition name="slide-right">
                <div v-if="localTimerEnabled" class="flex items-center gap-1">
                  <button class="w-6 h-6 rounded-lg bg-felt/50 border border-token-gold/20 text-gold hover:border-token-gold/50 text-sm font-bold" @click="decTimer">−</button>
                  <span class="font-mono text-gold text-xs w-10 text-center">{{ localTimerDuration }}{{ t('lobby.timer_unit') }}</span>
                  <button class="w-6 h-6 rounded-lg bg-felt/50 border border-token-gold/20 text-gold hover:border-token-gold/50 text-sm font-bold" @click="incTimer">+</button>
                </div>
              </Transition>
            </div>
            <Transition name="slide-right">
              <div v-if="localTimerEnabled" class="flex gap-1 mt-1.5 flex-wrap">
                <button v-for="s in [15,30,45,60]" :key="s"
                  class="text-xs px-1.5 py-0.5 rounded border transition-all font-mono"
                  :class="localTimerDuration === s ? 'bg-token-gold/20 border-token-gold/60 text-gold' : 'border-token-gold/15 text-felt-light hover:border-token-gold/40'"
                  @click="localTimerDuration = s; emitOptions()">{{ s }}s</button>
              </div>
            </Transition>
          </div>

          <!-- Add Bot (hôte) -->
          <div class="min-w-[120px]">
            <label class="text-xs text-felt-light block mb-1.5">Bots</label>
            <div class="flex items-center gap-2">
              <button class="px-2 py-1 rounded-lg border text-xs font-semibold"
                :class="'bg-felt/50 border-token-gold/20 text-felt-light hover:border-token-gold/40'"
                @click="$emit('add-bot', null)"
                :disabled="players.filter(p => p.isBot).length >= 4 || players.length >= 7">
                ➕ Add Bot
              </button>
              <div class="text-xs text-felt-light">{{ players.filter(p => p.isBot).length }} / 4</div>
            </div>
          </div>

        </div>
      </div>

      <!-- Joueurs -->
      <div class="panel p-4 flex flex-col gap-3">
        <h3 class="text-xs uppercase tracking-widest text-felt-light">{{ t('lobby.players_label') }} ({{ players.length }}/7)</h3>
        <TransitionGroup name="player-row" tag="div" class="flex flex-col gap-2">
          <div v-for="player in players" :key="player.name"
            class="flex items-center gap-3 py-1.5 px-2 rounded-lg"
            :class="player.name === myPlayerName ? 'bg-token-gold/10' : ''">
            <div class="token small shrink-0" />
            <span class="flex-1 font-body text-sm text-card-bg">{{ player.name }}</span>
            <span v-if="player.name === players[0]?.name" class="text-xs px-1.5 py-0.5 rounded bg-token-gold/20 border border-token-gold/30 text-gold">{{ t('lobby.host_badge') }}</span>
            <span v-if="player.name === myPlayerName" class="text-xs text-felt-light">{{ t('lobby.you_badge') }}</span>
          </div>
        </TransitionGroup>
        <p v-if="players.length < 7" class="text-xs text-felt-light italic text-center">
          {{ players.length < 3
            ? `${t('lobby.waiting')} (${3 - players.length} ${t('lobby.missing', 3 - players.length)})`
            : t('lobby.ready') }}
        </p>
      </div>

      <!-- Notification -->
      <Transition name="notif-fade">
        <div v-if="notification" class="panel px-3 py-2 text-sm text-center text-felt-light"
          :class="{ 'border-green-500/30': ['join','reconnect'].includes(notification.type), 'border-red-500/30': notification.type==='disconnect', 'border-token-gold/30': notification.type==='new_host' }">
          {{ notification.message }}
        </div>
      </Transition>

      <!-- Actions -->
      <div class="flex flex-col gap-3">
        <button v-if="isHost"
          class="btn-take flex items-center justify-center gap-2 py-4 text-base"
          :disabled="players.length < 3" @click="$emit('start')">
          <span class="text-xl">🎲</span>
          {{ t('lobby.start_btn') }}
          <span v-if="players.length < 3" class="text-xs opacity-70">
            ({{ 3 - players.length }} {{ t('lobby.missing', 3 - players.length) }})
          </span>
        </button>
        <div v-else class="panel px-4 py-3 text-center text-felt-light text-sm flex items-center justify-center gap-2">
          <div class="token small animate-pulse opacity-60" />
          {{ t('lobby.waiting_host') }}
        </div>
        <button class="text-sm text-felt-light/50 hover:text-red-400 transition-colors text-center" @click="$emit('leave')">
          {{ t('lobby.leave_btn') }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, watch } from 'vue'
import { useI18n } from '../composables/useI18n.js'

const { t, lang, setLang } = useI18n()

const props = defineProps({
  connected:    { type: Boolean, default: false },
  connecting:   { type: Boolean, default: false },
  socketError:  { type: String,  default: null },
  inRoom:       { type: Boolean, default: false },
  roomCode:     { type: String,  default: null },
  isHost:       { type: Boolean, default: false },
  myPlayerName: { type: String,  default: '' },
  players:      { type: Array,   default: () => [] },
  notification: { type: Object,  default: null },
  actionError:  { type: Object,  default: null },
})

const emit = defineEmits(['connect','create','join','spectate','start','leave','back','options'])

const localName       = ref('')
const localCode       = ref('')
const spectateCode    = ref('')
const serverUrlInput  = ref('')
const codeCopied      = ref(false)

// Options timer (hôte)
const localTimerEnabled  = ref(false)
const localTimerDuration = ref(30)

function toggleTimer() {
  localTimerEnabled.value = !localTimerEnabled.value
  emitOptions()
}
function incTimer() { if (localTimerDuration.value < 120) { localTimerDuration.value += 5; emitOptions() } }
function decTimer() { if (localTimerDuration.value > 10)  { localTimerDuration.value -= 5; emitOptions() } }
function emitOptions() {
  emit('options', { timerEnabled: localTimerEnabled.value, timerDuration: localTimerDuration.value })
}

function handleServerUrlChange() {
  if (serverUrlInput.value.trim()) emit('connect', serverUrlInput.value.trim())
}
function handleCreate() {
  if (!localName.value.trim()) return
  emit('create', localName.value.trim())
}
function handleJoin() {
  if (!localName.value.trim() || localCode.value.length < 4) return
  emit('join', localCode.value.trim(), localName.value.trim())
}
function handleSpectate() {
  if (spectateCode.value.length < 4) return
  emit('spectate', spectateCode.value.trim())
}
async function copyCode() {
  try { await navigator.clipboard.writeText(props.roomCode); codeCopied.value = true; setTimeout(() => { codeCopied.value = false }, 2000) } catch {}
}
</script>

<style scoped>
.player-row-enter-active,.player-row-leave-active{transition:all .25s ease}
.player-row-enter-from,.player-row-leave-to{opacity:0;transform:translateX(-10px)}
.error-fade-enter-active,.error-fade-leave-active{transition:all .3s ease}
.error-fade-enter-from,.error-fade-leave-to{opacity:0;transform:translateY(-4px)}
.notif-fade-enter-active,.notif-fade-leave-active{transition:opacity .3s}
.notif-fade-enter-from,.notif-fade-leave-to{opacity:0}
.slide-right-enter-active,.slide-right-leave-active{transition:all .2s ease}
.slide-right-enter-from,.slide-right-leave-to{opacity:0;transform:translateX(-8px)}
</style>
