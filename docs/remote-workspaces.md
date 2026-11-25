# Remote workspaces

When Alice shares a workspace with Bob, it stays **local** to Alice. Bob opens the same workspace as a **remote workspace** because its files live on Alice’s machine. Both are working in one shared workspace.

## Config

On Bob’s machine, the linked folder contains a **remote workspace reference** in `.moi/.workspace.json`. It identifies Alice and her workspace.

```json
{
  "version": 2,
  "remote": { "user_id": "alice", "workspace_id": "team-board" }
}
```

New local and remote configs use version 2. Remote configs contain only `version` and `remote`.

Shared content and configuration stay on the owner's machine. Personal tabs and chat state
stay on your Moi installation. See [storage ownership](../server/README.md#storage-ownership)
for the full storage map.

## Chat and agent

Each member chats with their own agent on their own machine. The reference's entry in
`DATA_DIR/workspaces.json` stores it as `harness`, as for a local workspace, and workspace settings
change it. Registration accepts an optional `harness` (`claude-code` or `codex`).

The member’s agent runs in the linked folder and reaches the owner’s
files through the CLI ([Remote operations](remote-cli.md#remote-operations)).

A view under construction is kept in the visitor's state; its source and build live on the owner.
After a successful `moi bundle`, the visitor's CLI asks the local server to clear the views the
owner now lists as compiled.

Owner build events do not reach visitors; `moi refresh` re-reads the owner's widget and view lists.

## Routing

Accepting an invitation in Moi opens the workspace with the chosen agent. An external link uses
`/workspace/{ownerId}:{workspaceId}`. Moi checks access, opens or creates the local reference with
`POST /api/workspaces`, and redirects to `/workspace/{localId}`, preserving the path and query.
On first open, a member who hasn’t picked an agent yet chooses one. A 404 shows the access-denied screen. Temporary failures offer **Try again**.

Registered workspaces use their local ID. Their info response provides `apiBase`, `isRemote`, and the visitor's `harness`; the loader fetches owner content when needed and exposes the prefix through context:

- local: `/api/workspaces/{localId}`
- remote: `/api/workspaces/{user_id}:{workspace_id}`

The browser calls the remote prefix directly with its Batiok session. Batiok checks access and forwards to the owner's ordinary API; the visitor's Moi is not in the path. Applet RPC and file URLs follow the address the module was loaded from. For a remote reference, the visitor's own API serves only the reference and the visitor's own routes: `sessions`, `state`, `harness`, `skills`, `env`, `mcp`, `uploads`, `preview`, and pending-view writes. It answers 404 for shared content and rejects shared layout writes.

Standalone Moi lists local workspaces. Requests for remote workspaces, invitations, and collaboration run only in Cloud mode.

`moi init [directory] --remote ownerId:workspaceId` installs the reference and skill. CLI commands use that config and the saved Cloud login. See [Remote operations](remote-cli.md#remote-operations) for where commands run.

## Remote workspaces and collaboration

Home and the sidebar use the workspace list from the Moi server.
They reuse the workspace info query for names, icons, and themes. Each owner loads independently
and wakes when needed; failed requests fall back to the registered name or workspace ID.
When sync removes an open workspace from the list, the browser shows the access-denied screen.

Shared updates and presence use one `${apiBase}/events` WebSocket. Cloud publishes the member list under the owner's address
(`ownerId:workspaceId`); see [Cloud](cloud.md#methods-the-cloud-calls). Membership changes use
`/cloud${apiBase}/members/:membershipId` and `/cloud${apiBase}/invitations`. The host and
accepted human members can manage membership.

Scratchpad documents and assets stay on the owner. Saves replace the full document;
workspace events refresh open canvases after saves and reconnects.

## Leaving and deleting

Both **Leave workspace** and **Delete workspace** call `DELETE /api/workspaces/{localId}`.

- When a **member leaves**, Moi asks Cloud to remove their membership. On success, Moi stops the local agent, cleans up the reference, and returns the member home. A failed request keeps the reference for retry.
- When a **cloud owner deletes**, Moi clears memberships and invitations in Cloud, then moves the workspace to trash. The owner has 30 days to restore it with `POST /api/workspaces/trash/{id}/restore` and must invite members again. Moi purges expired workspaces on startup and daily.
- **Standalone Moi** unregisters the workspace and keeps its folder and chats.

Cloud Moi syncs memberships on startup, hourly, and on first open when a reference is missing.
An open tab also relays Batiok’s `remote-workspaces:updated` event over `/api/events` to trigger sync.
It creates missing references and cleans up revoked ones after a successful membership check.
Cleanup removes the workspace’s `.moi/` directory, personal workspace state, and stored secrets.
Leaving a remote workspace and permanent deletion both remove the local `moi-workspace` skill and its Claude link. Moi removes their parent folders and the workspace folder only when empty. Other skills, files, and agent chat logs stored elsewhere stay on disk.

## Local mock workspace

With Moi running in Cloud mode and Batiok on `8787`, run from the Moi repo:

```sh
bun scripts/mock-remote-workspace.ts
```

Open [localhost:9898](http://localhost:9898).

Each start resets invitations and unregisters the mock. Reload the mock page after restarting.

Moi defaults to `13337` (override with `MOCK_VISITOR_ORIGIN`). Pass its `MOI_DATA_DIR` if customized.

Coverage: [mock workspace flow](../scripts/mock-remote-workspace.test.ts), [owner API boundaries](../server/api/remote-workspace.test.ts), [CLI requests](../server/cli/remote-control.test.ts), and [visual states](../tests/visual/workspace.visual.ts).

The mock checks membership before forwarding content or opening collaboration connections. Pending invitations and removed members get a 404. Existing connections are not revoked mid-session.
