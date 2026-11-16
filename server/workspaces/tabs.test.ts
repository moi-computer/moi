import { describe, expect, test } from 'bun:test'

import type { ViewInfo } from '@/lib/types'

import { assembleTabRows, assertNavigableTab } from './tabs'

const views: ViewInfo[] = [
  { id: 'roadmap', status: 'compiled', title: 'Roadmap' },
  { id: 'orders', status: 'compiled', title: '' }
]

describe('assembleTabRows', () => {
  test('lists static tabs then views', () => {
    const rows = assembleTabRows(views)
    expect(rows.map(r => r.id)).toEqual(['overview', 'scratchpad', 'views/roadmap', 'views/orders'])
  })

  test('falls back to the view id when the title is empty', () => {
    const rows = assembleTabRows(views)
    expect(rows.find(r => r.id === 'views/orders')?.title).toBe('orders')
    expect(rows.find(r => r.id === 'views/roadmap')?.title).toBe('Roadmap')
  })

  test('pending views are ordinary navigable rows', () => {
    const pending: ViewInfo = {
      id: 'draft',
      status: 'draft',
      title: 'Draft view',
      requirements: ''
    }
    const rows = assembleTabRows([...views, pending])
    expect(rows.find(row => row.id === 'views/draft')).toMatchObject({
      title: 'Draft view',
      href: 'moi:/views/draft'
    })
  })
})

test('every discovered tab has a portable address', () => {
  const rows = assembleTabRows(views)
  expect(rows.find(row => row.id === 'views/orders')?.href).toBe('moi:/views/orders')
  expect(rows.map(row => row.href)).toEqual([
    'moi:/overview',
    'moi:/scratchpad',
    'moi:/views/roadmap',
    'moi:/views/orders'
  ])
})

describe('assertNavigableTab', () => {
  test('accepts built-in destinations and built views', () => {
    expect(() => assertNavigableTab('overview', views)).not.toThrow()
    expect(() => assertNavigableTab('scratchpad', views)).not.toThrow()
    expect(() => assertNavigableTab('views/orders', views)).not.toThrow()
  })

  test('lists the current addresses when a view is missing', () => {
    expect(() => assertNavigableTab('views/order', views)).toThrow(
      'Unknown destination "moi:/views/order". Valid addresses: moi:/overview, moi:/scratchpad, moi:/views/roadmap, moi:/views/orders'
    )
  })
})
