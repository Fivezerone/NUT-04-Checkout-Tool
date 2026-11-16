import React, { useEffect, useRef } from 'react'
import { Search, X } from 'lucide-react'
import { TAB_LABELS } from './AppShell'

interface CommandPaletteModalProps {
  isOpen: boolean
  onClose: () => void
  currentTab: string
  onSelectTab: (tabId: string) => void
  searchQuery: string
  onSearchChange: (q: string) => void
  filteredItems: string[]
}

export const CommandPaletteModal: React.FC<CommandPaletteModalProps> = ({
  isOpen,
  onClose,
  currentTab,
  onSelectTab,
  searchQuery,
  onSearchChange,
  filteredItems,
}) => {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return

    if (isOpen) {
      if (!dialog.open) {
        dialog.showModal()
      }
      setTimeout(() => inputRef.current?.focus(), 50)
    } else {
      if (dialog.open) {
        dialog.close()
      }
    }
  }, [isOpen])

  if (!isOpen) return null

  return (
    <dialog
      ref={dialogRef}
      aria-label="Command Palette"
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
      onClick={(e) => {
        if (e.target === dialogRef.current) {
          onClose()
        }
      }}
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-start justify-center pt-20 p-4 border-0 w-full h-full m-0 max-w-none max-h-none bg-transparent"
    >
      <div
        className="w-full max-w-lg bg-surface rounded-2xl border border-border-control shadow-xl overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-3 border-b border-border-control/20 flex items-center gap-2">
          <Search size={16} className="text-muted shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Jump to clinical view or command..."
            className="w-full bg-transparent text-[14px] text-strong placeholder:text-muted outline-none"
          />
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded text-muted hover:text-strong"
            aria-label="Close command palette"
          >
            <X size={16} />
          </button>
        </div>

        <div className="p-2 max-h-64 overflow-y-auto flex flex-col gap-1">
          <span className="px-2 py-1 text-[12px] font-bold uppercase tracking-wider text-muted">
            Available Views
          </span>
          {filteredItems.length === 0 ? (
            <div className="p-4 text-center text-muted text-[12px]">No matching views</div>
          ) : (
            filteredItems.map((tabId) => (
              <button
                key={tabId}
                type="button"
                onClick={() => {
                  onSelectTab(tabId)
                  onClose()
                }}
                className={`flex items-center justify-between p-2.5 rounded-xl text-[12px] font-medium transition-colors cursor-pointer ${
                  currentTab === tabId
                    ? 'bg-surface-raised font-bold text-strong'
                    : 'text-foreground hover:bg-surface-raised/60'
                }`}
              >
                <span>{TAB_LABELS[tabId] || tabId}</span>
                <span className="text-[12px] font-mono text-muted">Jump →</span>
              </button>
            ))
          )}
        </div>
      </div>
    </dialog>
  )
}
