import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

/**
 * En mode "npm run dev" (Vite dev server sur :5173),
 * les requêtes Socket.IO (/socket.io/**) sont proxiées vers
 * le serveur Node sur :3000.
 *
 * En production ("npm run build" + "npm run server"),
 * Express sert directement le frontend buildé — le proxy n'est plus nécessaire.
 */
export default defineConfig({
  plugins: [vue()],

  server: {
    proxy: {
      // Proxy WebSocket et HTTP polling Socket.IO vers le serveur Node
      '/socket.io': {
        target: 'http://localhost:3000',
        ws: true,           // ← indispensable pour les WebSockets
        changeOrigin: true,
      },
    },
  },
})
