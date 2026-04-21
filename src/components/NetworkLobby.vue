<template>
  <!--
    NetworkLobby.vue — Écran de lobby multijoueur réseau
    Permet de créer une partie ou d'en rejoindre une avec un code.
    Une fois dans le lobby, affiche les joueurs connectés et attend le démarrage.
  -->
  <div class="min-h-screen flex flex-col items-center justify-center px-4 py-8 gap-8">

    <!-- Titre -->
    <div class="text-center">
      <h1 class="font-display text-5xl md:text-7xl text-gold tracking-tight leading-none mb-3 animate-float">
        No <span class="italic">Thanks!</span>
      </h1>
      <p class="text-felt-light text-sm">Mode multijoueur réseau</p>
    </div>

    <!-- ═══════════════════════════════════════════════════════════════════════ -->
    <!-- Phase : Connexion (avant de rejoindre/créer une partie)               -->
    <!-- ═══════════════════════════════════════════════════════════════════════ -->
    <div v-if="!inRoom" class="panel-gold w-full max-w-md p-6 flex flex-col gap-5">

      <!-- Indicateur de connexion -->
      <div class="flex items-center gap-2 text-xs">
        <div class="w-2 h-2 rounded-full transition-colors"
          :class="connected ? 'bg-green-400 animate-pulse' : 'bg-red-400'" />
        <span class="text-felt-light">
          {{ connected ? 'Connecté au serveur' : connecting ? 'Connexion…' : 'Déconnecté' }}
        </span>
        <span v-if="socketError" class="text-red-400 ml-1">— {{ socketError }}</span>
      </div>

      <!-- URL du serveur (optionnel, utile sur réseau local) -->
      <div>
        <label class="text-xs uppercase tracking-widest text-felt-light block mb-2">
          Serveur (laisser vide pour localhost)
        </label>
        <input
          v-model="serverUrlInput"
          type="text"
          placeholder="http://192.168.1.10:3000"
          class="w-full bg-felt-dark/60 border border-token-gold/20 rounded-lg px-3 py-2 text-sm text-card-bg placeholder-felt-light/50 focus:outline-none focus:border-token-gold/60 font-mono"
          @blur="handleServerUrlChange"
        />
      </div>

      <!-- Nom du joueur -->
      <div>
        <label class="text-xs uppercase tracking-widest text-felt-light block mb-2">
          Votre nom
        </label>
        <input
          v-model="localName"
          type="text"
          placeholder="Votre pseudo"
          maxlength="20"
          class="w-full bg-felt-dark/60 border border-token-gold/20 rounded-lg px-3 py-2 text-sm text-card-bg placeholder-felt-light/50 focus:outline-none focus:border-token-gold/60"
          @keydown.enter="localCode ? handleJoin() : handleCreate()"
        />
      </div>

      <!-- Séparateur -->
      <div class="flex items-center gap-3">
        <div class="h-px flex-1 bg-token-gold/20" />
        <span class="text-xs text-felt-light">ou</span>
        <div class="h-px flex-1 bg-token-gold/20" />
      </div>

      <!-- Deux options : Créer / Rejoindre -->
      <div class="grid grid-cols-2 gap-3">

        <!-- Créer une partie -->
        <button
          class="btn-take flex flex-col items-center py-4 gap-1"
          :disabled="!connected || !localName.trim()"
          @click="handleCreate"
        >
          <span class="text-2xl">🎴</span>
          <span class="text-sm">Créer</span>
        </button>

        <!-- Rejoindre -->
        <div class="flex flex-col gap-2">
          <input
            v-model="localCode"
            type="text"
            placeholder="Code ABCD"
            maxlength="4"
            class="bg-felt-dark/60 border border-token-gold/20 rounded-lg px-3 py-2 text-sm text-card-bg placeholder-felt-light/50 focus:outline-none focus:border-token-gold/60 font-mono text-center tracking-widest uppercase"
            @input="localCode = localCode.toUpperCase()"
            @keydown.enter="handleJoin"
          />
          <button
            class="btn-refuse flex items-center justify-center gap-2 py-3"
            :disabled="!connected || !localName.trim() || localCode.length < 4"
            @click="handleJoin"
          >
            <span>🚪</span>
            <span class="text-sm">Rejoindre</span>
          </button>
        </div>
      </div>

      <!-- Erreur action -->
      <Transition name="error-fade">
        <div v-if="actionError" class="bg-red-900/40 border border-red-500/40 rounded-lg px-3 py-2 text-sm text-red-300">
          {{ actionError.message }}
        </div>
      </Transition>

      <!-- Bouton retour mode solo -->
      <button
        class="text-sm text-felt-light/50 hover:text-felt-light transition-colors underline text-center"
        @click="$emit('back')"
      >
        ← Retour au mode solo
      </button>
    </div>

    <!-- ═══════════════════════════════════════════════════════════════════════ -->
    <!-- Phase : Lobby (en attente du démarrage)                               -->
    <!-- ═══════════════════════════════════════════════════════════════════════ -->
    <div v-else class="w-full max-w-md flex flex-col gap-5">

      <!-- Code de la partie -->
      <div class="panel-gold p-5 text-center flex flex-col gap-2">
        <p class="text-xs uppercase tracking-widest text-felt-light">Code de la partie</p>
        <div
          class="font-display text-4xl text-gold tracking-[0.3em] cursor-pointer select-all"
          @click="copyCode"
          :title="codeCopied ? 'Copié !' : 'Cliquer pour copier'"
        >
          {{ roomCode }}
        </div>
        <p class="text-xs text-felt-light">
          {{ codeCopied ? '✅ Copié !' : 'Partagez ce code pour inviter des joueurs' }}
        </p>
      </div>

      <!-- Liste des joueurs dans le lobby -->
      <div class="panel p-4 flex flex-col gap-3">
        <h3 class="text-xs uppercase tracking-widest text-felt-light">
          Joueurs ({{ players.length }}/7)
        </h3>

        <TransitionGroup name="player-row" tag="div" class="flex flex-col gap-2">
          <div
            v-for="player in players"
            :key="player.name"
            class="flex items-center gap-3 py-1.5 px-2 rounded-lg"
            :class="player.name === myPlayerName ? 'bg-token-gold/10' : ''"
          >
            <div class="token small shrink-0" />
            <span class="flex-1 font-body text-sm text-card-bg">{{ player.name }}</span>
            <span v-if="player.name === hostName" class="text-xs px-1.5 py-0.5 rounded bg-token-gold/20 border border-token-gold/30 text-gold">
              Hôte
            </span>
            <span v-if="player.name === myPlayerName" class="text-xs text-felt-light">(vous)</span>
          </div>
        </TransitionGroup>

        <!-- Indication de slots libres -->
        <p v-if="players.length < 7" class="text-xs text-felt-light italic text-center">
          En attente de joueurs… ({{ 3 - players.length > 0 ? `encore ${3 - players.length} minimum` : 'prêt à démarrer' }})
        </p>
      </div>

      <!-- Notification réseau -->
      <Transition name="notif-fade">
        <div
          v-if="notification"
          class="panel px-3 py-2 text-sm text-center text-felt-light"
          :class="{
            'border-green-500/30': notification.type === 'join' || notification.type === 'reconnect',
            'border-red-500/30':   notification.type === 'disconnect',
            'border-token-gold/30': notification.type === 'new_host',
          }"
        >
          {{ notification.message }}
        </div>
      </Transition>

      <!-- Actions -->
      <div class="flex flex-col gap-3">
        <!-- Démarrer (hôte seulement) -->
        <button
          v-if="isHost"
          class="btn-take flex items-center justify-center gap-2 py-4 text-base"
          :disabled="players.length < 3"
          @click="$emit('start')"
        >
          <span class="text-xl">🎲</span>
          Lancer la partie
          <span v-if="players.length < 3" class="text-xs opacity-70">
            ({{ 3 - players.length }} joueur{{ 3 - players.length > 1 ? 's' : '' }} manquant{{ 3 - players.length > 1 ? 's' : '' }})
          </span>
        </button>

        <!-- Attente (non-hôte) -->
        <div v-else class="panel px-4 py-3 text-center text-felt-light text-sm flex items-center justify-center gap-2">
          <div class="token small animate-pulse opacity-60" />
          En attente que l'hôte lance la partie…
        </div>

        <!-- Quitter -->
        <button
          class="text-sm text-felt-light/50 hover:text-red-400 transition-colors text-center"
          @click="$emit('leave')"
        >
          Quitter la partie
        </button>
      </div>
    </div>

  </div>
</template>

<script setup>
import { ref, computed } from 'vue'

const props = defineProps({
  connected:     { type: Boolean, default: false },
  connecting:    { type: Boolean, default: false },
  socketError:   { type: String,  default: null },
  inRoom:        { type: Boolean, default: false },
  roomCode:      { type: String,  default: null },
  isHost:        { type: Boolean, default: false },
  myPlayerName:  { type: String,  default: '' },
  players:       { type: Array,   default: () => [] },
  notification:  { type: Object,  default: null },
  actionError:   { type: Object,  default: null },
})

const emit = defineEmits(['connect', 'create', 'join', 'start', 'leave', 'back'])

const localName       = ref('')
const localCode       = ref('')
const serverUrlInput  = ref('')
const codeCopied      = ref(false)

// L'hôte est le premier joueur (ou celui marqué hôte)
const hostName = computed(() => props.players[0]?.name ?? null)

function handleServerUrlChange() {
  if (serverUrlInput.value.trim()) {
    emit('connect', serverUrlInput.value.trim())
  }
}

function handleCreate() {
  if (!localName.value.trim()) return
  emit('create', localName.value.trim())
}

function handleJoin() {
  if (!localName.value.trim() || localCode.value.length < 4) return
  emit('join', localCode.value.trim(), localName.value.trim())
}

async function copyCode() {
  try {
    await navigator.clipboard.writeText(props.roomCode)
    codeCopied.value = true
    setTimeout(() => { codeCopied.value = false }, 2000)
  } catch {}
}
</script>

<style scoped>
.player-row-enter-active, .player-row-leave-active { transition: all 0.25s ease; }
.player-row-enter-from, .player-row-leave-to { opacity: 0; transform: translateX(-10px); }

.error-fade-enter-active, .error-fade-leave-active { transition: all 0.3s ease; }
.error-fade-enter-from, .error-fade-leave-to { opacity: 0; transform: translateY(-4px); }

.notif-fade-enter-active, .notif-fade-leave-active { transition: opacity 0.3s; }
.notif-fade-enter-from, .notif-fade-leave-to { opacity: 0; }
</style>
