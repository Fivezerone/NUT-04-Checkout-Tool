import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { useState, useEffect } from 'react'
import { ShoppingBag, AlertTriangle, ArrowRight, ShieldCheck, RefreshCw } from 'lucide-react'
import './styles/index.css'

interface BasketItem {
  id: string
  name: string
  price: number
  grade: 'A' | 'B' | 'C' | 'D' | 'E'
  flags: string[]
  swapCandidate?: {
    name: string
    grade: 'A' | 'B'
    savingLabel?: string
  }
}

export function SidePanelApp() {
  const [loading, setLoading] = useState(false)
  const [retailer, setRetailer] = useState<string>('Supermarket')
  const [basketGrade, setBasketGrade] = useState<'A' | 'B' | 'C' | 'D' | 'E'>('C')
  const [items, setItems] = useState<BasketItem[]>([])

  useEffect(() => {
    // Check current active tab to detect supermarket domain
    if (typeof chrome !== 'undefined' && chrome.tabs?.query) {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const url = tabs[0]?.url || ''
        if (url.includes('carrefour')) {
          setRetailer('Carrefour Kenya')
        } else if (url.includes('naivas')) {
          setRetailer('Naivas Supermarket')
        } else if (url.includes('quickmart')) {
          setRetailer('Quickmart')
        } else {
          setRetailer('Active Supermarket')
        }
      })
    }
  }, [])

  return (
    <div className="@container min-h-screen bg-canvas text-foreground p-4 flex flex-col gap-4 font-sans text-xs">
      {/* Hairline brand header */}
      <div className="h-1 -mx-4 -mt-4 bg-gradient-to-r from-brand-mint via-brand-sun to-brand-coral" />

      {/* Header */}
      <header className="flex items-center justify-between border-b border-border-control/20 pb-3">
        <div>
          <span className="text-[12px] font-semibold text-strong tracking-wide block">
            NutriScore Assistant
          </span>
          <span className="text-[12px] text-muted">{retailer}</span>
        </div>
        <button
          type="button"
          onClick={() => setLoading(true)}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border-control/40 text-strong hover:bg-surface/80 text-[12px] transition-colors"
          aria-label="Refresh basket analysis"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </header>

      {/* Basket Score Card */}
      <section className="bg-surface rounded-2xl border border-border-control/20 p-4 shadow-xs">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-[12px] font-semibold text-strong uppercase tracking-wider text-muted">
              Live Basket Quality
            </h2>
            <p className="text-[14px] font-bold text-strong mt-0.5">
              Grade {basketGrade} Overall
            </p>
          </div>
          <div
            className={`w-12 h-12 rounded-xl flex items-center justify-center font-bold text-lg text-white shadow-xs ${
              basketGrade === 'A'
                ? 'bg-ns-grade-a'
                : basketGrade === 'B'
                ? 'bg-ns-grade-b text-strong'
                : basketGrade === 'C'
                ? 'bg-ns-grade-c'
                : basketGrade === 'D'
                ? 'bg-ns-grade-d text-strong'
                : 'bg-ns-grade-e'
            }`}
          >
            {basketGrade}
          </div>
        </div>
      </section>

      {/* Basket Items List */}
      <section className="flex-1 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h3 className="text-[12px] font-semibold text-strong">
            Items in Basket ({items.length})
          </h3>
          <span className="text-[12px] text-muted">Auto-scanned</span>
        </div>

        {items.length === 0 ? (
          <div className="bg-surface/60 rounded-xl border border-dashed border-border-control/40 p-6 text-center flex flex-col items-center justify-center gap-2">
            <ShoppingBag className="w-8 h-8 text-muted/60" />
            <p className="text-[12px] font-medium text-strong">No basket items detected</p>
            <p className="text-[12px] text-muted max-w-[240px]">
              Add products to your cart on {retailer} to inspect nutrition flags and healthier swap recommendations.
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-2.5">
            {items.map((item) => (
              <li
                key={item.id}
                className="bg-surface rounded-xl border border-border-control/20 p-3 flex flex-col gap-2"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="text-[12px] font-medium text-strong leading-snug">
                    {item.name}
                  </span>
                  <span
                    className={`shrink-0 inline-flex items-center justify-center w-6 h-6 rounded-md font-bold text-[12px] ${
                      item.grade === 'A'
                        ? 'bg-ns-grade-a text-white'
                        : item.grade === 'B'
                        ? 'bg-ns-grade-b text-strong'
                        : item.grade === 'C'
                        ? 'bg-ns-grade-c text-white'
                        : item.grade === 'D'
                        ? 'bg-ns-grade-d text-strong'
                        : 'bg-ns-grade-e text-white'
                    }`}
                  >
                    {item.grade}
                  </span>
                </div>

                {item.flags.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {item.flags.map((flag, idx) => (
                      <span
                        key={idx}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[12px] bg-status-warning-subtle text-status-warning border border-status-warning/20"
                      >
                        <AlertTriangle className="w-3 h-3" />
                        {flag}
                      </span>
                    ))}
                  </div>
                )}

                {item.swapCandidate && (
                  <div className="mt-1 bg-surface-raised rounded-lg p-2.5 border border-border-control/20 flex items-center justify-between gap-2">
                    <div className="flex flex-col">
                      <span className="text-[12px] text-muted font-medium">Recommended Swap</span>
                      <span className="text-[12px] font-semibold text-strong">
                        {item.swapCandidate.name}
                      </span>
                    </div>
                    <span className="inline-flex items-center gap-1 text-[12px] font-bold text-status-success">
                      Grade {item.swapCandidate.grade}
                      <ArrowRight className="w-3.5 h-3.5" />
                    </span>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Safety & Compliance Badge */}
      <footer className="mt-auto pt-3 border-t border-border-control/20 flex items-center justify-between text-muted text-[12px]">
        <div className="flex items-center gap-1.5">
          <ShieldCheck className="w-4 h-4 text-status-success" />
          <span>Local token analysis</span>
        </div>
        <span>Fail-closed safety</span>
      </footer>
    </div>
  )
}

const container = document.getElementById('root')
if (container) {
  const root = createRoot(container)
  root.render(<SidePanelApp />)
}

