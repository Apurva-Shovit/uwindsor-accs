import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    watch: {
      // `cap sync` copies the built app into android/, and a gradle build writes
      // reports there. Both are downstream of src/, so watching them just makes
      // the dev server reload itself during a live-reload install.
      ignored: ['**/android/**'],
    },
  },
})
