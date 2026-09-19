// DEV SCAFFOLD — Saketh. Adele's real UI replaces this. Safe to delete.
// Ugly on purpose. Reference for calling GET /api/search. Served at /dev-search.html in dev only.

import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
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

function toQueryString(filters: Filters): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(filters)) if (value.trim()) params.set(key, value.trim())
  return params.toString()
}

function DevSearch() {
  const [filters, setFilters] = useState<Filters>(EMPTY)
  const [result, setResult] = useState<SearchResponse | null>(null)
  const [error, setError] = useState('')
  const query = toQueryString(filters)

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
        <p style={{ fontSize: 20 }}><strong>{result.facets.fits_room}</strong> fit a {filters.fits_w_mm} mm gap</p>
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
