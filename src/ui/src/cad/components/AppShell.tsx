import React, { useState, useEffect } from 'react'
import { useCadAuth } from '../context/AuthContext'
import { Navigation } from './Navigation'
import { SidebarNavigation } from './SidebarNavigation'
import { SystemHealthBanner } from './SystemHealthBanner'
import { ChevronRight } from 'lucide-react'
import { getCadNavigationIds } from '../navigation'
import { CommandPaletteModal } from './CommandPaletteModal'

export const TAB_LABELS: Record<string, string> = {
  overview: 'Overview',
  targets: 'Clinical Targets',
  modes: 'Health Modes',
  consent: 'Linking & Consent',
  users: 'Staff & Licences',
  audit: 'Audit Trail',
  billing: 'Billing & Plan',
  settings: 'Tenant Settings',
  platform: 'Platform Tenants',
}

export function AppShell({
  currentTab,
  setCurrentTab,
  children,
}: {
  currentTab: string
  setCurrentTab: (tab: string) => void
  children: React.ReactNode
}) {
  const { claims } = useCadAuth()
  const [navigationOpen, setNavigationOpen] = useState(false)
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')

  // Global Ctrl+K / Cmd+K listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setCommandPaletteOpen((prev) => !prev)
      } else if (e.key === 'Escape') {
        setCommandPaletteOpen(false)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  const allowedTabs = claims.role ? getCadNavigationIds(claims.role) : []

  const filteredCommandItems = allowedTabs.filter((tabId) => {
    const label = TAB_LABELS[tabId] || tabId
    return label.toLowerCase().includes(searchQuery.toLowerCase())
  })

  return (
    <div className="cad-shell min-h-screen bg-canvas text-foreground flex flex-col font-sans text-xs" data-surface="clinical">
      <Navigation
        onOpenNav={() => setNavigationOpen(true)}
        onOpenCommandPalette={() => setCommandPaletteOpen(true)}
      />

      <div className="flex flex-1 min-h-0">
        <SidebarNavigation
          role={claims.role || 'patient'}
          currentTab={currentTab}
          setCurrentTab={setCurrentTab}
          open={navigationOpen}
          onClose={() => setNavigationOpen(false)}
        />

        <div className="cad-workspace flex-1 flex flex-col min-w-0 p-4 sm:p-6 overflow-y-auto">
          {/* Breadcrumbs */}
          <nav aria-label="Breadcrumb" className="mb-3 flex items-center gap-1.5 text-[12px] text-muted">
            <span className="hover:text-strong cursor-pointer" onClick={() => setCurrentTab('overview')}>
              Clinical Portal
            </span>
            <ChevronRight size={13} className="shrink-0" />
            <span className="font-semibold text-strong">{TAB_LABELS[currentTab] || currentTab}</span>
          </nav>

          <SystemHealthBanner />

          <main className="cad-main flex-1 min-w-0" id="main-content">
            {children}
          </main>

          <footer className="cad-footer mt-8 pt-4 border-t border-border-control/20 text-center text-[12px] text-muted">
            NutriScore Clinical Workspace &middot; Session actions are audit logged with immutable SHA-256 chaining.
          </footer>
        </div>
      </div>

      {/* Command Palette Modal */}
      <CommandPaletteModal
        isOpen={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
        currentTab={currentTab}
        onSelectTab={(tabId) => {
          setCurrentTab(tabId)
          setSearchQuery('')
        }}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        filteredItems={filteredCommandItems}
      />
    </div>
  )
}
