// DEV SCAFFOLD — Saketh. Adele's real UI replaces this. Safe to delete.
// Ugly on purpose. Reference for calling GET /api/search. Served at /dev-search.html in dev only.

import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { FindClause, Program } from '../lib/dsl/schema'
import type { Category, Listing, SearchResponse } from '../lib/types'

const CATEGORIES: Category[] = [
  'sofa', 'armchair', 'chair', 'table', 'desk', 'bed',
  'shelf', 'storage', 'rug', 'lamp', 'plant', 'decor',
]

type Filters = {
  q: string
  category: string
  price_max: string
  price_min: string
  colour: string
  material: string
  fits_w_mm: string
}

const EMPTY: Filters = { q: '', category: '', price_max: '', price_min: '', colour: '', material: '', fits_w_mm: '' }

// Display-only conversion. Everything on the wire stays integer cents and millimetres.
const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`
const dims = ({ w, d, h }: Listing['dims_mm']) => `${w} × ${d} × ${h} mm`

type CompileResponse = { program: Program; chips: string[]; source: string; ms: number }

// How a find clause maps onto a GET /api/search param. A Program may hold several clauses of one
// kind ("oak and steel"); they are ANDed, so none may be dropped. In these text boxes they are
// comma-separated, and on the wire the param repeats: material=oak&material=steel.
function toFilters(find: FindClause[]): Filters {
  const filters = { ...EMPTY }
  const add = (key: keyof Filters, value: string) => {
    filters[key] = filters[key] ? `${filters[key]}, ${value}` : value
  }
  for (const clause of find) {
    if (clause.k === 'text') add('q', clause.q)
    if (clause.k === 'category') add('category', clause.value)
    if (clause.k === 'price_max') add('price_max', String(clause.cents))
    if (clause.k === 'price_min') add('price_min', String(clause.cents))
    if (clause.k === 'colour') add('colour', clause.hex)
    if (clause.k === 'material') add('material', clause.value)
    if (clause.k === 'fits_w_max') add('fits_w_mm', String(clause.mm))
  }
  return filters
}

function toQueryString(filters: Filters): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(filters)) {
    // q is free text and keeps its commas; every other box may list several values.
    const values = key === 'q' ? [value] : value.split(',')
    for (const item of values) if (item.trim()) params.append(key, item.trim())
  }
  return params.toString()
}

function DevSearch() {
  const [filters, setFilters] = useState<Filters>(EMPTY)
  const [result, setResult] = useState<SearchResponse | null>(null)
  const [error, setError] = useState('')
  const [sentence, setSentence] = useState('a reading chair by the window, under $400, 5 feet from any wall')
  const [compiled, setCompiled] = useState<CompileResponse | null>(null)
  const [compiling, setCompiling] = useState(false)
  const query = toQueryString(filters)

  const compile = () => {
    setCompiling(true)
    fetch('/api/compile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: sentence }),
    })
      .then(async (response) => {
        const body = await response.json()
        if (!response.ok) throw new Error(body.detail ?? `HTTP ${response.status}`)
        setCompiled(body as CompileResponse)
        setFilters(toFilters((body as CompileResponse).program.find))
        setError('')
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setCompiling(false))
  }

  useEffect(() => {
    const controller = new AbortController()
    fetch(`/api/search?${query}`, { signal: controller.signal })
      .then(async (response) => {
        const body = await response.json()
        if (!response.ok) throw new Error(body.detail ?? `HTTP ${response.status}`)
        setResult(body as SearchResponse)
        setError('')
      })
      .catch((err: Error) => {
        if (err.name !== 'AbortError') setError(err.message)
      })
    return () => controller.abort()
  }, [query])

  const field = (key: keyof Filters, placeholder: string) => (
    <input
      placeholder={placeholder}
      value={filters[key]}
      onChange={(event) => setFilters({ ...filters, [key]: event.target.value })}
    />
  )

  return (
    <main style={{ fontFamily: 'monospace', padding: 16, maxWidth: 900 }}>
      <h1>dev · search</h1>
      <form onSubmit={(event) => { event.preventDefault(); compile() }} style={{ display: 'flex', gap: 8 }}>
        <input style={{ flex: 1 }} value={sentence} onChange={(event) => setSentence(event.target.value)} />
        <button disabled={compiling}>{compiling ? 'compiling…' : 'compile'}</button>
      </form>
      {compiled && (
        <>
          <p>
            {compiled.chips.map((chip) => (
              <span key={chip} style={{ border: '1px solid', borderRadius: 12, padding: '2px 8px', marginRight: 6 }}>
                {chip}
              </span>
            ))}
            <br />
            {compiled.source} · {compiled.ms} ms · find[] applied to the filters below; place[] goes to the solver
          </p>
          {/* Dev mode: the only place raw Program syntax is ever shown. */}
          <pre style={{ background: '#eee', padding: 8 }}>{JSON.stringify(compiled.program, null, 2)}</pre>
        </>
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {field('q', 'q (text)')}
        <select value={filters.category} onChange={(event) => setFilters({ ...filters, category: event.target.value })}>
          <option value="">any category</option>
          {CATEGORIES.map((category) => <option key={category}>{category}</option>)}
        </select>
        {field('price_min', 'price_min (cents)')}
        {field('price_max', 'price_max (cents)')}
        {field('colour', 'colour (#rrggbb)')}
        {field('material', 'material')}
        {field('fits_w_mm', 'fits_w_mm')}
        <button onClick={() => setFilters(EMPTY)}>reset</button>
      </div>
      <p>GET /api/search?{query}</p>
      {error && <p style={{ color: 'crimson' }}>error: {error}</p>}
      {result && <p>{result.total} total, showing {result.items.length}</p>}
      {result?.facets?.fits_room !== undefined && (
        <p style={{ fontSize: 20 }}>
          <strong>{result.facets.fits_room}</strong> of {result.facets.fits_room_of} fit a {filters.fits_w_mm} mm gap
        </p>
      )}
      {result?.facets && (
        <p>
          {result.facets.category.map((bucket) => `${bucket.key} ${bucket.count}`).join(' · ')}
          <br />
          {result.facets.price_band.map((bucket) => `${bucket.key}¢ ${bucket.count}`).join(' · ')}
        </p>
      )}
      <ul style={{ listStyle: 'none', padding: 0 }}>
        {result?.items.map((item) => (
          <li key={item.id} style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 8 }}>
            <img src={item.thumb_url} alt="" width={48} height={48} />
            <span>
              <strong>{item.title}</strong> · {item.category} · {dollars(item.price_cents)} · {dims(item.dims_mm)}
              <br />
              {item.id} · {item.materials.join(', ')} · {item.colour_hex.join(' ')}
            </span>
          </li>
        ))}
      </ul>
    </main>
  )
}

createRoot(document.getElementById('root')!).render(<StrictMode><DevSearch /></StrictMode>)
