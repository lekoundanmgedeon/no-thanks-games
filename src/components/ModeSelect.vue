<template>
  <!-- Écran de choix du mode de jeu : Solo local ou Multijoueur réseau -->
  <div class="min-h-screen flex flex-col items-center justify-center px-4 gap-10">

    <div class="text-center">
      <h1 class="font-display text-6xl md:text-8xl text-gold tracking-tight leading-none mb-4 animate-float">
        No <span class="italic">Thanks!</span>
      </h1>
      <p class="text-felt-light text-sm font-body">Choisissez un mode de jeu</p>
    </div>

    <div class="grid grid-cols-1 md:grid-cols-2 gap-5 w-full max-w-xl">

      <!-- Mode Solo / Local -->
      <button
        class="panel-gold p-6 flex flex-col items-center gap-4 text-left rounded-2xl border-2 border-transparent hover:border-token-gold/50 transition-all duration-200 hover:scale-[1.02] group"
        @click="$emit('solo')"
      >
        <span class="text-5xl group-hover:animate-float">🎴</span>
        <div>
          <p class="font-display text-xl text-gold mb-1">Solo / Local</p>
          <p class="text-felt-light text-sm">
            Jouez à plusieurs sur le même écran ou contre des IA. Pas de réseau requis.
          </p>
        </div>
        <div class="flex flex-wrap gap-1.5 self-start">
          <span class="sequence-badge">1–7 joueurs</span>
          <span class="sequence-badge">IA disponible</span>
          <span class="sequence-badge">Hors-ligne</span>
        </div>
      </button>

      <!-- Mode Réseau -->
      <button
        class="panel-gold p-6 flex flex-col items-center gap-4 text-left rounded-2xl border-2 border-transparent hover:border-blue-400/50 transition-all duration-200 hover:scale-[1.02] group"
        @click="$emit('network')"
      >
        <span class="text-5xl group-hover:animate-float">🌐</span>
        <div>
          <p class="font-display text-xl text-blue-300 mb-1">Multijoueur réseau</p>
          <p class="text-felt-light text-sm">
            Chaque joueur sur son propre appareil. Connectez-vous via Wi-Fi local ou internet.
          </p>
        </div>
        <div class="flex flex-wrap gap-1.5 self-start">
          <span class="text-xs px-1.5 py-0.5 rounded bg-blue-900/40 border border-blue-400/20 text-blue-300">3–7 joueurs</span>
          <span class="text-xs px-1.5 py-0.5 rounded bg-blue-900/40 border border-blue-400/20 text-blue-300">Temps réel</span>
          <span class="text-xs px-1.5 py-0.5 rounded bg-blue-900/40 border border-blue-400/20 text-blue-300">Code de partie</span>
        </div>
      </button>

    </div>

    <p class="text-felt-light/30 text-xs font-mono">No Thanks! — Thorsten Gimmler (2004)</p>
  </div>
</template>

<script setup>
defineEmits(['solo', 'network'])
</script>
