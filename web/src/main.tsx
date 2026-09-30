import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { useAgent } from './agent/agentStore'
import App from './App'
import * as canvasOps from './canvasOps'
import { useStore } from './store'
import './styles.css'

// dev-only handles for debugging from the console / automated checks
if (import.meta.env.DEV) Object.assign(window, { __taplocal: { useStore, useAgent, canvasOps } })

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
