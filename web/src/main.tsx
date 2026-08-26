import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { App } from './App'
import './styles.css'

const client = new QueryClient({
  defaultOptions: {
    queries: {
      // The calendar must never show a stale picture of who is free: the owner is deciding
      // whether a guest fits while looking at it.
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
