import React, { useState } from 'react'
import { useCadAuth } from '../context/AuthContext'
import { Navigation } from './Navigation'
import { SidebarNavigation } from './SidebarNavigation'
import { SystemHealthBanner } from './SystemHealthBanner'

export function AppShell({ currentTab, setCurrentTab, children }: { currentTab: string; setCurrentTab: (tab: string) => void; children: React.ReactNode }) {
  const { claims } = useCadAuth()
  const [navigationOpen, setNavigationOpen] = useState(false)
  return <div className="cad-shell" data-surface="clinical">
    <Navigation onOpenNav={() => setNavigationOpen(true)} />
    <SidebarNavigation role={claims.role} currentTab={currentTab} setCurrentTab={setCurrentTab} open={navigationOpen} onClose={() => setNavigationOpen(false)} />
    <div className="cad-workspace"><SystemHealthBanner /><main className="cad-main" id="main-content">{children}</main><footer className="cad-footer">NutriScore Clinical Workspace · Session actions are audit logged</footer></div>
  </div>
}
