import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { describe, expect, test } from 'bun:test'

import { DEFAULT_VIEWS_WIDGET } from '@/lib/default-widgets'

import { WidgetFrame } from './widget-frame'

describe('WidgetFrame', () => {
  test('uses the vivid surface for a custom widget', () => {
    const html = renderToStaticMarkup(createElement(WidgetFrame, { widgetId: 'weather' }))
    expect(html).toContain('data-vivid="true"')
  })

  test('uses the normal app surface for a default widget', () => {
    const html = renderToStaticMarkup(
      createElement(WidgetFrame, { widgetId: DEFAULT_VIEWS_WIDGET.id })
    )

    expect(html).not.toContain('data-vivid')
  })
})
