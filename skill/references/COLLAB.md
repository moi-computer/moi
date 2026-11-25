# Collab

Use `moi/collab` in views and widgets to display workspace members and share cursors, focus, selections, and custom presence. Import the API directly. Moi provides the workspace directory, React context, and socket connection. See `.moi/collab.d.ts` for the full API.

## Members

A workspace member is a person or agent with access. Moi manages profiles and workspace membership. Store only identity IDs in fields such as `authorId` or `assigneeIds`, then resolve the current profile for display. Keep applet-specific roles and preferences in applet storage, keyed by identity ID.

All four hooks below return member profiles with the original identity ID. Presence entries use that same ID in `identityId`. A `MemberProfile`’s `type` is `'user'` for a person and `'agent'` for an agent. For agents, the cloud supplies `ownerId` when the inviter is known. A member’s `status` tracks tab visibility. A visible tab on another workspace page still counts as active, even while the person is idle.

- `active` means at least one tab is visible in this workspace.
- `away` means connected with no visible tab in this workspace.
- `offline` means there are no live connections in this workspace.

### Hooks

Use `useMe()` for the current identity's profile. Use `useMember(id)` to look up an author or assignee by identity ID, even while the member is offline. Both return `undefined` when the profile is unavailable.

Use `useWorkspaceMembers()` for a directory or assignee picker. It includes yourself and offline members. Filter by status with the hook's `status` option, or by identity type in your applet:

```tsx
const agents = useWorkspaceMembers().filter(member => member.type === 'agent')
```

Use `usePeers()` for other connected members on the current page. Each identity appears once across tabs. Set `scope: 'workspace'` to include other pages. The peer filter accepts `status: 'active'` or `status: 'away'`.

### Components

#### `Profile` and `ProfileAvatar`

`Profile` shows an avatar and name, with optional secondary `description` text. `ProfileAvatar` shows
only the avatar. Pass an identity ID; both handle missing names and unknown members.

`Profile` and `ProfileAvatar` hide the status badge by default; pass `showStatusBadge` to show it
for active members.

#### `ProfileAvatarGroup`

Show several members together. IDs are deduplicated; `max` limits the visible avatars and
remaining members appear as an overflow count.

## Presence

Presence describes temporary activity: pointer positions, focused fields, selected items,
or custom state. It is removed when its publishing component unmounts, the applet becomes
inactive, or the browser tab is hidden.

Save durable application content through your applet's `.server.ts` functions and storage.
Presence does not persist it. With live presence disabled, member lookups remain available
and applet content still renders.

Presence is scoped to the current page and applet. Matching IDs or channels in another
view or widget do not share activity.

Add presence where knowing what someone is working on helps people coordinate. Choose the
smallest meaningful target: a field, document block, task row, or selected card. Several
controls can share a target when they belong to one activity. Keep static content and
routine navigation free of presence indicators unless activity there matters to others.
Presence communicates activity; it does not lock records or prevent conflicting edits.

### Hooks

#### `usePresence` and `usePublishPresence`

Use these hooks when activity needs a custom value or display, such as an editing summary,
an active tool, or a drag preview. Publish near the interaction and read the channel wherever
that information is useful in the applet. `usePublishPresence(channel, value)` publishes a
value and replaces it when it changes. Values must be JSON and no larger than 4 KiB.

`usePresence<T>(channel)` reads other connections' `{ connectionId, identityId, value }` entries.
Reading never publishes presence. One member can have multiple entries, including another tab
of your own identity. Resolve each `identityId` with `Profile` or `useMember`.

```tsx
import { usePresence, usePublishPresence, Profile } from 'moi/collab'

type TaskPresenceProps = { taskId: string }

// Mount this component only while the viewer is editing the task.
function EditingPresence({ taskId }: TaskPresenceProps) {
  usePublishPresence('editing', { taskId })
  return null
}

function TaskEditors({ taskId }: TaskPresenceProps) {
  const editors = usePresence<{ taskId: string }>('editing')
  return editors
    .filter(entry => entry.value.taskId === taskId)
    .map(entry => <Profile key={entry.connectionId} id={entry.identityId} />)
}
```

Channel names are local to the applet. Include record IDs in your values when activity belongs
to a particular record. Unmount the publishing component to stop publishing;
`false` and `null` are valid custom values, not removal signals.

### Components

#### `Cursors`

Use `Cursors` for spatial work where seeing someone point or move helps, such as a board,
canvas, or arrangement of cards. For ordinary forms and lists, presence at the active field
or row is often enough.

Wrap the shared surface once, keeping local menus and navigation outside the cursor area.
It can contain many `PresenceFrame` or `PresenceAvatars` targets: cursors show movement,
while those targets show where someone is focused or present. Give separate cursor areas
distinct `id` values. A single area can omit `id`, which defaults to `"default"`.

```tsx
import { Cursors } from 'moi/collab'
;<Cursors id="board">{children}</Cursors>
```

#### `PresenceFrame` and `PresenceAvatars`

Both components show other members at a target and support the same automatic and
controlled modes below. Choose the appearance that fits the target's shape and how much
attention the activity needs.

Use `PresenceFrame` for a compact target whose boundaries should stand out, such as a form
field, a small group of controls, or a selected card. It draws an outline and shows member
names above it. A frame around a very wide or tall block can dominate the screen; keep the
target to the specific field or block being worked on.

Use `PresenceAvatars` for a quieter cue beside short content, such as a document line, list
row, compact field, or low-height block. It reserves a left gutter for avatars and works
well with wide rows because it marks one spot along the edge. For tall content, split it
into meaningful targets so the avatar stays close to the activity.

Both components accept `align` to position their presence indicators. For `PresenceFrame`,
it aligns the name badge above the frame: `"start"` (left) or `"end"` (right, default).
For `PresenceAvatars`, it aligns avatars vertically in the left gutter: `"start"` (top),
`"center"` (default), or `"end"` (bottom).

Use the same `id` across clients for the same activity. Give separate activities distinct IDs.
Each component publishes your own presence and displays other connections, including another
tab of your own identity. Multiple connections for one member display once at each target.

##### Automatic focus

Without `present`, the component automatically publishes your presence while a descendant
has focus. Children can be any React content, including lists and fragments. All children
share one target; moving focus between them keeps it active. The nearest automatic wrapper
owns focus when wrappers are nested.

```tsx
import { PresenceFrame, PresenceAvatars } from 'moi/collab'
import { Input } from '../ui/input'
import { Textarea } from '../ui/textarea'
;<>
  <PresenceFrame id="title" align="start">
    <label htmlFor="title">Title</label>
    <Input id="title" />
  </PresenceFrame>
  <PresenceAvatars id="notes">
    <Textarea aria-label="Notes" />
  </PresenceAvatars>
</>
```

##### Controlled presence

Pass `present` when application state determines presence, such as selecting an item or editing
a record. `true` publishes your presence; `false` clears it. Focus tracking is disabled, and
other members still appear when your own value is false.

```tsx
<>
  <PresenceFrame id={`selection/${task.id}`} present={selected}>
    <TaskCard onClick={() => setSelected(value => !value)} />
  </PresenceFrame>
  <PresenceAvatars id={`editing/${task.id}`} present={editing}>
    <TaskEditor />
  </PresenceAvatars>
</>
```

Controlled presence lasts while `present` is true, subject to the cleanup described above.
Each mounted component owns its publication; clearing one leaves other publications intact.

#### `PresenceGroup`

An optional wrapper for related presence targets. It has two jobs:

- Prefix descendant target IDs so repeated fields can use the same names.
- Let automatic `PresenceAvatars` glide between targets in a shared animation scope.

It adds no DOM element and does not publish presence itself. Frames and avatars work
without it.

##### Scope repeated fields

Wrap each record in a group so its fields belong to that record.

```tsx
import { PresenceGroup, PresenceFrame } from 'moi/collab'
import { Input } from '../ui/input'
;<PresenceGroup id={task.id}>
  <PresenceFrame id="title">
    <Input aria-label="Task title" defaultValue={task.title} />
  </PresenceFrame>
  <PresenceFrame id="assignee">
    <AssigneePicker />
  </PresenceFrame>
</PresenceGroup>
```

For task `42`, these targets become `42/title` and `42/assignee`. Groups can nest: adding
an outer group `tasks` gives `tasks/42/title`. Use stable record IDs and field names;
IDs must be nonblank and unique within their group. When a dialog switches records,
change its group ID.

##### Move avatars between targets

Put the targets in one common group. When another connection moves focus between them,
its avatar glides from the previous target to the next.

```tsx
import { PresenceGroup, PresenceAvatars } from 'moi/collab'
import { Input } from '../ui/input'
;<PresenceGroup id="tasks">
  {tasks.map(task => (
    <PresenceAvatars key={task.id} id={task.id}>
      <Input aria-label={task.title} defaultValue={task.title} />
    </PresenceAvatars>
  ))}
</PresenceGroup>
```

Use record IDs for both React `key` and presence `id`. A nested group creates its own
animation scope, so avatars glide between targets within that group. Separate row groups
will not animate movement across rows. Without a group, avatars animate their appearance
at each target. Movement respects the user's reduced-motion preference.

Controlled avatars do not glide between targets: a member can be present at several at once.
`PresenceFrame` does not share movement between targets.

Group IDs apply to `PresenceFrame` and `PresenceAvatars`. Cursor area IDs and custom
hook channels are independent of groups.
