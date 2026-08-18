import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import './index.css'
import App from './App.tsx'
import { restoreSession } from './lib/session'
import { notifyAppReady } from './lib/liveUpdate'

const queryClient = new QueryClient()

// Rendering waits on restoreSession so the Android app can rehydrate its token
// from SharedPreferences before AuthContext reads it. On the web this resolves
// immediately and nothing changes.
restoreSession().finally(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </StrictMode>,
  )
  // Confirms to the OTA updater that this bundle booted. Must happen after the
  // render call, and must happen at all: an unconfirmed bundle is rolled back
  // automatically, which would make every update look like it never arrived.
  // See src/lib/liveUpdate.ts.
  void notifyAppReady()
})
