# Remote workspaces

A remote workspace is a registered local folder whose `.moi/.workspace.json` points to an owner's workspace.

## Config

```json
{
  "version": 2,
  "remote": { "user_id": "alice", "workspace_id": "team-board" }
}
```

New local and remote configs use version 2. Remote configs contain only `version` and `remote`.

The owner stores shared content, widgets, theme, name, and icon. Your Moi stores personal tabs,
active tab, chat placement, panel widths, model defaults, and per-chat settings in
`DATA_DIR/workspaces/{localId}/state.json`. All browsers connected to that Moi share this state.
Existing preferences reset to defaults; no migration is needed. Remote chat and settings UI
remain unavailable.

## Routing

An unopened share uses `/workspace/{userId}:{workspaceId}`. It checks access through a fresh owner info request, creates or reuses the local reference, then redirects to `/workspace/{localId}`, preserving the path and query. Accepting in Moi opens this route immediately. Shares accepted in Batiok or the CLI use it when clicked.

Denied access creates no reference. A 404 shows “Workspace not found or you don’t have access” with **Back to home**. Temporary failures offer **Try again**, without repeating acceptance. Workspace info requests do not retry automatically.

Registered workspaces use their local ID. Their info response provides `apiBase` and `isRemote`; the loader fetches owner content when needed and exposes the prefix through context:

- local: `/api/workspaces/{localId}`
- remote: `/api/workspaces/{user_id}:{workspace_id}`

The browser calls the remote prefix directly with its Batiok session. Batiok checks access and forwards to the owner's ordinary API; the visitor's Moi is not in the path. Applet RPC and file URLs follow the address the module was loaded from. For a remote reference, the visitor's own API serves only the reference and personal state. It answers 404 for shared content and rejects shared layout writes. Personal layout uses `/api/workspaces/{localId}/state/layout`.

The standalone Moi UI supports local workspaces only: it hides remote registrations and makes no Cloud discovery, sharing, or collaboration calls.

`moi init [directory] --remote ownerId:workspaceId` installs the reference and skill. CLI commands use that config and the saved Cloud login. See [Remote operations](remote-cli.md#remote-operations) for where commands run.

## Discovery and collaboration

In Cloud mode, home and the sidebar combine registered workspaces with accepted shares.
They reuse the workspace info query for names, icons, and themes. Each owner loads independently
and wakes when needed; failed requests fall back to the registered name or workspace ID.
A registered reference remains listed after Cloud access is removed.

Presence uses `${apiBase}/collab`; membership uses `/cloud${apiBase}/members` and
`/cloud${apiBase}/invitations`. The host and accepted human members can manage membership.
The UI does not offer leaving yet.

Scratchpad documents and assets stay on the owner. Saves replace the full document;
reopen the canvas to see edits made elsewhere.

## Local mock workspace

With Moi running in Cloud mode and Batiok on `8787`, run from the Moi repo:

```sh
bun scripts/mock-remote-workspace.ts
```

Open [localhost:9898](http://localhost:9898). No Batiok environment changes or restart needed.

Each start resets invitations and unregisters the mock. It deletes the generated visitor folder
only if the reference and skill are unchanged and no extra files exist. Owner data and manually
linked folders are preserved. Reload the mock page after restarting.

Moi defaults to `13337` (override with `MOCK_VISITOR_ORIGIN`). Pass its `MOI_DATA_DIR` if customized.

Coverage: [mock workspace flow](../scripts/mock-remote-workspace.test.ts), [owner API boundaries](../server/api/remote-workspace.test.ts), [CLI requests](../server/cli/remote-control.test.ts), and [visual states](../tests/visual/workspace.visual.ts).

The mock checks membership before forwarding content or opening collaboration connections. Pending invitations and removed members get a 404. Existing connections are not revoked mid-session.
