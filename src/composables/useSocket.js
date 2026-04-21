/**
 * useSocket.js — Composable Vue pour la connexion Socket.IO
 *
 * Singleton : une seule connexion partagée dans toute l'app.
 *
 * Stratégie de connexion :
 *  - En production (servi par Express sur :3000) : connexion à l'origin courant
 *  - En développement (Vite sur :5173 + proxy vers :3000) :
 *    Socket.IO se connecte à "/" → Vite proxyie vers localhost:3000
 *  - Si une URL explicite est fournie (réseau local) : on l'utilise directement
 */

import { ref, readonly } from 'vue'
import { io } from 'socket.io-client'

// ─── Singleton ────────────────────────────────────────────────────────────────
let _socket       = null
let _initialized  = false
const connected   = ref(false)
const connecting  = ref(false)
const socketError = ref(null)

/**
 * Retourne (ou crée) la connexion Socket.IO.
 * @param {string|null} serverUrl
 *   - null / undefined → connexion relative "/" (fonctionne avec le proxy Vite et en prod)
 *   - "http://192.168.1.x:3000" → connexion réseau explicite (autre machine)
 */
function getSocket(serverUrl = null) {
  // Réutiliser la connexion existante si déjà connecté à la même URL
  if (_socket?.connected && _initialized) return _socket

  // Détermine l'URL de connexion
  // En prod et en dev avec proxy Vite, undefined = connexion relative = OK
  const url = serverUrl || undefined

  _socket = io(url, {
    reconnection:         true,
    reconnectionAttempts: 10,
    reconnectionDelay:    1000,
    reconnectionDelayMax: 5000,
    timeout:              10000,
    transports:           ['websocket', 'polling'],
  })

  _initialized = true

  _socket.on('connect', () => {
    connected.value   = true
    connecting.value  = false
    socketError.value = null
    console.log('[socket] Connecté —', _socket.id)
  })

  _socket.on('disconnect', (reason) => {
    connected.value = false
    console.log('[socket] Déconnecté :', reason)
  })

  _socket.on('connect_error', (err) => {
    connecting.value  = false
    socketError.value = err.message
    console.error('[socket] Erreur :', err.message)
  })

  _socket.on('reconnect_attempt', () => {
    connecting.value = true
  })

  _socket.on('reconnect', () => {
    connecting.value = false
    console.log('[socket] Reconnecté')
  })

  return _socket
}

/** Ferme proprement la connexion et réinitialise le singleton. */
function destroySocket() {
  _socket?.disconnect()
  _socket       = null
  _initialized  = false
  connected.value   = false
  connecting.value  = false
  socketError.value = null
}

export function useSocket() {
  return {
    getSocket,
    destroySocket,
    connected:   readonly(connected),
    connecting:  readonly(connecting),
    socketError: readonly(socketError),
  }
}
