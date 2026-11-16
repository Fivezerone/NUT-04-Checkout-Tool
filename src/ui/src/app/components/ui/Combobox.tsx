import * as React from 'react'
import { Check, ChevronsUpDown, Search } from 'lucide-react'

export interface ComboboxOption {
  value: string
  label: string
  description?: string
}

export interface ComboboxProps {
  options: ComboboxOption[]
  value?: string
  onChange: (value: string) => void
  placeholder?: string
  searchPlaceholder?: string
  label?: string
  className?: string
  disabled?: boolean
}

export function Combobox({
  options,
  value,
  onChange,
  placeholder = 'Select option...',
  searchPlaceholder = 'Search...',
  label,
  className = '',
  disabled = false,
}: ComboboxProps) {
  const [isOpen, setIsOpen] = React.useState(false)
  const [search, setSearch] = React.useState('')
  const [activeIndex, setActiveIndex] = React.useState(-1)
  const containerRef = React.useRef<HTMLDivElement>(null)
  const inputRef = React.useRef<HTMLInputElement>(null)

  const selectedOption = options.find((o) => o.value === value)

  const filteredOptions = React.useMemo(() => {
    if (!search.trim()) return options
    const query = search.toLowerCase()
    return options.filter(
      (o) => o.label.toLowerCase().includes(query) || o.description?.toLowerCase().includes(query),
    )
  }, [options, search])

  // Click outside listener
  React.useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false)
        setSearch('')
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return

    if (!isOpen) {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        setIsOpen(true)
        setActiveIndex(0)
      }
      return
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setActiveIndex((prev) => (prev < filteredOptions.length - 1 ? prev + 1 : 0))
        break
      case 'ArrowUp':
        e.preventDefault()
        setActiveIndex((prev) => (prev > 0 ? prev - 1 : filteredOptions.length - 1))
        break
      case 'Enter':
        e.preventDefault()
        if (activeIndex >= 0 && activeIndex < filteredOptions.length) {
          onChange(filteredOptions[activeIndex].value)
          setIsOpen(false)
          setSearch('')
        }
        break
      case 'Escape':
        e.preventDefault()
        setIsOpen(false)
        setSearch('')
        break
    }
  }

  return (
    <div ref={containerRef} className={`relative flex flex-col gap-1 text-left ${className}`} onKeyDown={handleKeyDown}>
      {label && <label className="text-[12px] font-medium text-strong">{label}</label>}

      {/* Trigger Button */}
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        onClick={() => {
          if (!disabled) {
            setIsOpen((prev) => !prev)
            if (!isOpen) {
              setTimeout(() => inputRef.current?.focus(), 50)
            }
          }
        }}
        className="w-full h-10 px-3 py-2 bg-surface text-foreground text-[12px] rounded-xl border border-border-control outline-none focus-visible:ring-2 focus-visible:ring-focus flex items-center justify-between gap-2 disabled:opacity-50 disabled:bg-surface-raised cursor-pointer transition-colors"
      >
        <span className={selectedOption ? 'text-strong font-medium' : 'text-muted'}>
          {selectedOption ? selectedOption.label : placeholder}
        </span>
        <ChevronsUpDown className="w-4 h-4 text-muted shrink-0" />
      </button>

      {/* Dropdown Popover */}
      {isOpen && (
        <div className="absolute top-[calc(100%+4px)] left-0 w-full z-50 bg-surface rounded-xl border border-border-control shadow-md py-1 max-h-60 flex flex-col overflow-hidden">
          {/* Search Input */}
          <div className="px-2 pb-1.5 border-b border-border-control/20 flex items-center gap-2">
            <Search className="w-3.5 h-3.5 text-muted shrink-0" />
            <input
              ref={inputRef}
              type="text"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value)
                setActiveIndex(0)
              }}
              placeholder={searchPlaceholder}
              className="w-full bg-transparent text-[12px] text-foreground placeholder:text-muted outline-none py-1"
            />
          </div>

          {/* Options List */}
          <div role="listbox" className="overflow-y-auto max-h-48 py-1">
            {filteredOptions.length === 0 ? (
              <div className="px-3 py-2 text-[12px] text-muted text-center">No options found</div>
            ) : (
              filteredOptions.map((opt, idx) => {
                const isSelected = opt.value === value
                const isActive = idx === activeIndex
                return (
                  <div
                    key={opt.value}
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => {
                      onChange(opt.value)
                      setIsOpen(false)
                      setSearch('')
                    }}
                    onMouseEnter={() => setActiveIndex(idx)}
                    className={`px-3 py-2 text-[12px] flex items-center justify-between cursor-pointer transition-colors ${
                      isActive ? 'bg-surface-raised text-strong' : 'text-foreground'
                    }`}
                  >
                    <div className="flex flex-col">
                      <span className={isSelected ? 'font-semibold text-strong' : ''}>{opt.label}</span>
                      {opt.description && (
                        <span className="text-[12px] text-muted">{opt.description}</span>
                      )}
                    </div>
                    {isSelected && <Check className="w-4 h-4 text-brand-mint shrink-0 ml-2" />}
                  </div>
                )
              })
            )}
          </div>
        </div>
      )}
    </div>
  )
}

