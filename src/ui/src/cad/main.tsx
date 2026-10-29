// src/ui/src/cad/main.tsx
// Mount entry for Clinic Admin Dashboard (CAD)

import * as React from 'react'
// @ts-ignore
window.React = React
import { createRoot } from 'react-dom/client'
import { CadApp } from './CadApp'
import '../styles/index.css'

const container = document.getElementById('root')
if (container) {
  const root = createRoot(container)
  root.render(<CadApp />)
}

