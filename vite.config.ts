import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: { port: 5317, proxy: { '/api': `http://localhost:${process.env.API_PORT || 5318}` } },
  preview: { port: 5317, proxy: { '/api': `http://localhost:${process.env.API_PORT || 5318}` } },
})
