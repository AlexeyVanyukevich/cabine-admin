import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { App } from './App'
import './styles.css'

const client = new QueryClient({
  defaultOptions: {
    queries: {
      // Always refetched, never served from an in-memory cache without asking: the owner is
      // deciding whether a guest fits while looking at this. What may be shown when the server
      // cannot be reached is the IndexedDB cache, and only under a stamp saying how old it is —
      // see `offline/useOffline.ts`.
      staleTime: 0,
      refetchOnWindowFocus: true,
      retry: false,
    },
  },
})

const root = document.getElementById('root')
if (root === null) throw new Error('No #root in the document')

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={client}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
)
