import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { AttachmentChip } from './attachment-chip'

test('renders a text attachment from a newer server with the default icon', () => {
  const attachment = JSON.parse('{"label":"Report","icon":"calendar"}')
  expect(renderToStaticMarkup(<AttachmentChip {...attachment} />)).toBe(
    renderToStaticMarkup(<AttachmentChip label="Report" />)
  )
})
