import * as React from 'react'
import {
  ChevronDown,
  ChevronRight,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Search,
} from 'lucide-react'
import { Skeleton } from './Skeleton'
import { EmptyState } from './EmptyState'

export type ColumnKind =
  | 'id'
  | 'hash'
  | 'name'
  | 'email'
  | 'status'
  | 'number'
  | 'datetime'
  | 'enum'
  | 'text'
  | 'actions'

export interface DataTableColumn<T> {
  id: string
  header: string
  accessor: (row: T) => any
  cell?: (value: any, row: T) => React.ReactNode
  priority?: 1 | 2 | 3 // 1: high (always), 2: mid, 3: low (expands in details <960px)
  sortable?: boolean
  kind?: ColumnKind
}

export interface DataTableProps<T> {
  columns: DataTableColumn<T>[]
  data: T[]
  keyExtractor: (row: T) => string
  isLoading?: boolean
  emptyTitle?: string
  emptyDescription?: string
  searchable?: boolean
  searchPlaceholder?: string
  searchFilter?: (row: T, query: string) => boolean
  className?: string
  caption?: string
}

export function DataTable<T>({
  columns,
  data,
  keyExtractor,
  isLoading = false,
  emptyTitle = 'No records found',
  emptyDescription = 'There are no items matching this criteria.',
  searchable = false,
  searchPlaceholder = 'Search records...',
  searchFilter,
  className = '',
  caption,
}: DataTableProps<T>) {
  const [search, setSearch] = React.useState('')
  const [sortCol, setSortCol] = React.useState<string | null>(null)
  const [sortDir, setSortDir] = React.useState<'asc' | 'desc'>('asc')
  const [expandedRows, setExpandedRows] = React.useState<Set<string>>(new Set())

  // Priority-3 columns collapsed in container range (640-959px)
  const p3Columns = React.useMemo(() => columns.filter((c) => c.priority === 3), [columns])

  const toggleRow = (id: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleSort = (colId: string) => {
    if (sortCol === colId) {
      if (sortDir === 'asc') setSortDir('desc')
      else {
        setSortCol(null)
        setSortDir('asc')
      }
    } else {
      setSortCol(colId)
      setSortDir('asc')
    }
  }

  // Filtered data
  const filteredData = React.useMemo(() => {
    if (!search.trim()) return data
    if (searchFilter) {
      return data.filter((row) => searchFilter(row, search.toLowerCase()))
    }
    const q = search.toLowerCase()
    return data.filter((row) =>
      columns.some((col) => {
        const val = col.accessor(row)
        return val != null && String(val).toLowerCase().includes(q)
      }),
    )
  }, [data, search, searchFilter, columns])

  // Sorted data
  const sortedData = React.useMemo(() => {
    if (!sortCol) return filteredData
    const col = columns.find((c) => c.id === sortCol)
    if (!col) return filteredData

    return [...filteredData].sort((a, b) => {
      const valA = col.accessor(a)
      const valB = col.accessor(b)
      if (valA == null) return 1
      if (valB == null) return -1
      if (valA < valB) return sortDir === 'asc' ? -1 : 1
      if (valA > valB) return sortDir === 'asc' ? 1 : -1
      return 0
    })
  }, [filteredData, sortCol, sortDir, columns])

  return (
    <div className={`@container flex flex-col gap-3 w-full text-left ${className}`}>
      {/* Top Search Bar */}
      {searchable && (
        <div className="flex items-center gap-2 max-w-sm px-3 py-2 bg-surface rounded-xl border border-border-control focus-within:ring-2 focus-within:ring-focus">
          <Search className="w-4 h-4 text-muted shrink-0" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={searchPlaceholder}
            className="w-full bg-transparent text-[12px] text-foreground placeholder:text-muted outline-none"
          />
        </div>
      )}

      {/* Loading Skeletons */}
      {isLoading ? (
        <div className="flex flex-col gap-2 p-4 bg-surface rounded-2xl border border-border-control/20">
          <Skeleton height={32} className="w-full mb-2" />
          <Skeleton height={24} className="w-full" />
          <Skeleton height={24} className="w-full" />
          <Skeleton height={24} className="w-full" />
        </div>
      ) : sortedData.length === 0 ? (
        <EmptyState title={emptyTitle} description={emptyDescription} />
      ) : (
        <>
          {/* Card View on narrow containers (< 640px) */}
          <div className="flex flex-col gap-3 @[640px]:hidden">
            {sortedData.map((row) => {
              const rowKey = keyExtractor(row)
              return (
                <div
                  key={rowKey}
                  className="bg-surface rounded-2xl border border-border-control/20 p-4 flex flex-col gap-2.5 shadow-xs"
                >
                  {columns.map((col) => {
                    const val = col.accessor(row)
                    const rendered = col.cell ? col.cell(val, row) : String(val ?? '—')
                    return (
                      <div key={col.id} className="flex flex-col gap-0.5">
                        <span className="text-[12px] font-semibold text-muted uppercase tracking-wider">
                          {col.header}
                        </span>
                        <div className="text-[12px] text-foreground break-words leading-relaxed">
                          {rendered}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </div>

          {/* Table View on >= 640px containers */}
          <div
            role="region"
            aria-label={caption || 'Data table'}
            tabIndex={0}
            className="hidden @[640px]:block w-full overflow-x-auto rounded-2xl border border-border-control/20 bg-surface shadow-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-focus"
          >
            <table className="w-full text-[12px] border-collapse">
              {caption && <caption className="sr-only">{caption}</caption>}
              <thead>
                <tr className="border-b border-border-control/20 bg-surface-raised/40">
                  {/* Expand button column for collapsed p3 rows on 640-959px */}
                  {p3Columns.length > 0 && (
                    <th scope="col" className="w-8 p-3 text-center @[960px]:hidden">
                      <span className="sr-only">Expand details</span>
                    </th>
                  )}
                  {columns.map((col) => {
                    const isSorted = sortCol === col.id
                    const ariaSort = isSorted ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined
                    const isP3 = col.priority === 3
                    const isNumericOrAction = col.kind === 'number' || col.kind === 'actions'

                    return (
                      <th
                        key={col.id}
                        scope="col"
                        aria-sort={ariaSort}
                        className={`p-3 font-semibold text-strong select-none ${
                          isNumericOrAction ? 'text-right' : 'text-left'
                        } ${isP3 ? 'hidden @[960px]:table-cell' : ''}`}
                      >
                        {col.sortable ? (
                          <button
                            type="button"
                            onClick={() => handleSort(col.id)}
                            className="inline-flex items-center gap-1.5 hover:text-brand-navy dark:hover:text-white cursor-pointer group outline-none focus-visible:ring-2 focus-visible:ring-focus rounded-md px-1 py-0.5"
                          >
                            <span>{col.header}</span>
                            {isSorted ? (
                              sortDir === 'asc' ? (
                                <ArrowUp className="w-3.5 h-3.5 text-brand-mint shrink-0" />
                              ) : (
                                <ArrowDown className="w-3.5 h-3.5 text-brand-mint shrink-0" />
                              )
                            ) : (
                              <ArrowUpDown className="w-3.5 h-3.5 opacity-40 group-hover:opacity-100 shrink-0" />
                            )}
                          </button>
                        ) : (
                          <span>{col.header}</span>
                        )}
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody className="divide-y divide-border-control/10">
                {sortedData.map((row) => {
                  const rowKey = keyExtractor(row)
                  const isExpanded = expandedRows.has(rowKey)

                  return (
                    <React.Fragment key={rowKey}>
                      <tr className="hover:bg-surface-raised/50 transition-colors">
                        {p3Columns.length > 0 && (
                          <td className="w-8 p-3 text-center @[960px]:hidden">
                            <button
                              type="button"
                              onClick={() => toggleRow(rowKey)}
                              aria-expanded={isExpanded}
                              aria-label={`Toggle row details for ${rowKey}`}
                              className="p-1 rounded-md text-muted hover:text-strong hover:bg-surface-raised transition-colors cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-focus"
                            >
                              {isExpanded ? (
                                <ChevronDown className="w-4 h-4" />
                              ) : (
                                <ChevronRight className="w-4 h-4" />
                              )}
                            </button>
                          </td>
                        )}
                        {columns.map((col) => {
                          const val = col.accessor(row)
                          const rendered = col.cell ? col.cell(val, row) : String(val ?? '—')
                          const isP3 = col.priority === 3
                          const isIdOrHash = col.kind === 'id' || col.kind === 'hash'
                          const isNumber = col.kind === 'number'
                          const isActions = col.kind === 'actions'

                          return (
                            <td
                              key={col.id}
                              className={`p-3 align-top leading-relaxed text-foreground ${
                                isIdOrHash ? 'font-mono [overflow-wrap:anywhere] break-all' : ''
                              } ${isNumber ? 'tabular-nums text-right' : ''} ${
                                isActions ? 'text-right' : ''
                              } ${isP3 ? 'hidden @[960px]:table-cell' : ''}`}
                            >
                              {rendered}
                            </td>
                          )
                        })}
                      </tr>

                      {/* Expandable row details for Priority-3 columns (640-959px) */}
                      {p3Columns.length > 0 && isExpanded && (
                        <tr className="bg-surface-raised/20 @[960px]:hidden">
                          <td colSpan={columns.length + 1} className="p-3 pl-11">
                            <div className="flex flex-col gap-2 py-1">
                              {p3Columns.map((col) => {
                                const val = col.accessor(row)
                                const rendered = col.cell ? col.cell(val, row) : String(val ?? '—')
                                return (
                                  <div key={col.id} className="flex items-start gap-2 text-[12px]">
                                    <span className="font-semibold text-muted min-w-[120px]">
                                      {col.header}:
                                    </span>
                                    <div className="text-foreground break-words">{rendered}</div>
                                  </div>
                                )
                              })}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

