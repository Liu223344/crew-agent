import React from 'react'
import ReactDOM from 'react-dom/client'
import '@xyflow/react/dist/style.css'
import App from './App'
import { createBrowserApi } from './browser-api'
import './styles.css'

const runtimeWindow = window as unknown as { bossy?: Window['bossy'] }
if (!runtimeWindow.bossy) runtimeWindow.bossy = createBrowserApi()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
