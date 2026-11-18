import { expect, mock, test } from 'bun:test'
import { parseHTML } from 'linkedom'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { WidgetCanvas } from './widget-canvas'

test('displaying and updating a saved widget layout never reports a user move', async () => {
  const { window, document } = parseHTML('<html><body><div id="root"></div></body></html>')
  const globals = {
    window,
    document,
    HTMLElement: window.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
    getComputedStyle: () => ({ width: '640px' })
  }
  const descriptors = new Map(
    Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)])
  )
  for (const [key, value] of Object.entries(globals))
    Object.defineProperty(globalThis, key, { configurable: true, value })
  const root = createRoot(document.getElementById('root')!)
  const onMove = mock(() => {})
  try {
    for (const x of [0, 2]) {
      await act(async () =>
        root.render(
          <WidgetCanvas
            items={[{ id: 'counter', x, y: 3, w: 1, h: 1 }]}
            header={null}
            renderItem={() => 'My counter'}
            onMove={onMove}
          />
        )
      )
      expect(document.body.textContent).toContain('My counter')
      expect(onMove).not.toHaveBeenCalled()
    }
  } finally {
    await act(async () => root.unmount())
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    }
  }
})
