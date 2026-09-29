import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // In development, API calls go to the Node server (npm run server).
  server: { proxy: { '/api': 'http://localhost:8787' } },
})
