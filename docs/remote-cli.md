# Moi Cloud CLI

`moi remote login` opens the browser for human sign-in; `--no-browser` prints the link.
`moi remote [--json]` shows your account, workspaces shared with you, and this folder's remote target.
Use `moi status` for local workspaces.

Human credentials live in `remote-auth.json` in Moi's data directory, with owner-only permissions
on macOS and Linux. Access tokens refresh automatically. `remote logout` revokes the refresh token
and deletes credentials; if Cloud is unreachable, it keeps them for retry. Existing access tokens
may remain valid for up to one hour. Cloud-managed credentials cannot be replaced or logged out.

## Which login a command uses

A remote command picks its login in this order:

1. The login saved in the caller's own data directory.
2. Otherwise, the Moi server running on this machine sends the request with its login. The caller never sees a credential.
3. Otherwise, the caller is signed out.

Step 2 is how the agent works on a [managed machine](config.md#managed-machines), where its OS user cannot open Moi's data directory. A caller that sets `MOI_DATA_DIR` to a directory it can open always stops at step 1 or 3, so a standalone bot never borrows another user's login.

`login`, `logout`, `accept`, `leave`, and `rename-agent` always use the caller's own data directory: the server never signs in, or changes the account, on a caller's behalf.

The server lends its login only for requests listed in `server/remote/routes.ts`, and only for workspaces linked on this machine. The CLI checks the same list before sending with its own login. Callers build their paths from that same table, so a request has to be added there before the CLI can make it.

## Invitations and workspace setup

A new agent accepts an agent invitation URL with a name and client. Use a separate `MOI_DATA_DIR` if this installation already has a human login.

```sh
moi remote accept "<agent-invite-url>" --name "Lawyer" --client grok-bot
# Use the address printed by accept
moi init ./project --remote <ownerId>:<workspaceId> --json
```

Later `accept` calls reuse the saved identity. `--name` and `--client` apply only to creation;
rename an agent with `moi remote rename-agent "Legal assistant"`. Client ids can be up to 25 characters long. Use lowercase letters or digits with single hyphens between words, such as `dot` or `grok-bot`.

`accept` suggests an init command with a new folder. Remote initialization prints the installed skill path, tells the agent to read it, and points to `moi remote` for commands. Without `--web`, it finishes without opening a browser or contacting the local server.

With `--json`, `accept` returns `remote: { user_id, workspace_id }`
matching the config, plus `success` and `membershipId`. First agent acceptance also returns
`agentId` and `hostId`.

```sh
moi remote workspaces                  # Remote workspaces, invitations, and acceptance help
moi remote invitations --json
moi remote accept "<invitation-id-or-url>"
moi remote leave                        # Current folder's remote workspace
moi remote leave <ownerId>:<workspaceId> # Explicit workspace
(cd ./project && moi remote leave)      # Another folder's remote workspace
```

`moi remote workspaces --json` returns `workspaces` and `invitations` arrays without formatted help.

`moi remote` shows your signed-in identity. From a linked local folder it also shows the remote
workspace address and a command cheatsheet; local workspaces and unlinked folders show your identity and a help hint.
Use `moi remote workspaces` to list remote workspaces and pending invitations.

`moi init [directory]` creates a local workspace at version 2. With `--remote`, it writes the
version 2 remote reference, installs the skill, and registers the folder without downloading
files. The directory defaults to the current folder. Repeat initialization is safe for the same
target; conflicting configs and duplicate registrations at other paths are rejected.

Remote initialization supports `--json` or `--web` separately. `--web` starts the local UI;
otherwise no local server is needed. `--harness` and `--id` are local-only.

`moi remote leave` ends your membership. The next successful Cloud sync cleans up the local reference. See [Leaving and deleting](remote-workspaces.md#leaving-and-deleting) for which files Moi keeps.

## Agent credentials

Agent keys and IDs live in `remote-auth.json`, with owner-only permissions. Requests use fresh,
short-lived signatures. First acceptance saves keys in `remote-agent-pending.json` before sending;
if the response is lost, retry the same invitation to reuse the identity, name, and client.

`moi remote logout --yes` revokes the agent login and deletes its keys permanently. Leaving all
workspaces keeps the identity available for future invitations.

## Remote operations

Run these from the member’s linked local folder. Paths in the remote workspace resolve on the owner’s machine.

```sh
moi remote read notes.txt
moi remote write notes.txt "Hello"
cat notes.txt | moi remote write notes.txt
moi remote patch notes.txt --patch-file ./change.diff
moi remote file-upload ./photo.png assets/photo.png
moi remote file-download assets/photo.png ./download.png
moi remote exec 'pwd; ls -la'
```

Ordinary workspace commands keep their usual arguments and output:

| Commands                                                                    | Runs on                           | Through                                                |
| --------------------------------------------------------------------------- | --------------------------------- | ------------------------------------------------------ |
| `remote read`, `write`, `patch`, `file-upload`, `file-download`, `exec`     | owner                             | operations API                                         |
| `bundle`, `check`, `theme`, `call-server-fn`, `debug logs`, `ui-components` | owner                             | operations API, returns `{ exitCode, stdout, stderr }` |
| `config`, `tabs`, `scratch` reads and edits                                 | owner                             | ordinary workspace API                                 |
| `refresh`, `navigate`, `scratch view`, `views create`, `views set`          | visitor's running Moi and browser | local control server                                   |

For a caller with its own login, only the last row needs a local Moi server. `views` commands edit a view under construction, which is the visitor's: see [Chat and agent](remote-workspaces.md#chat-and-agent). Skills, environment, start, stop, and install commands stay local.

File paths are relative to the remote workspace root. Paths that name a file on your machine stay local: upload sources, download destinations, `--patch-file`, `config icon` and `scratch add image` inputs, and `scratch read-image` / `scratch view --out` outputs. `patch` accepts an exact unified diff; a conflict leaves the file unchanged. File access rejects traversal and symlinks.

`exec` runs with the host's Moi permissions in the workspace directory, which is not an operating-system sandbox. It streams stdout and stderr and returns the remote exit code; `--json` emits newline-delimited `stdout`, `stderr`, and final `exit` events. Ctrl-C sends a signed cancellation for that execution and kills its process group; only the same caller in the same workspace can cancel it. An interrupted connection is not retried, because the command may already have changed files.

Owner-executed workspace commands finish before returning, with up to 8 MiB per output stream; use `exec` for long streamed output. Human uploads stream through Cloud. Agent uploads are limited to 16 MiB because Agent Auth signs the exact request bytes.

The Cloud route is `/cloud/api/workspaces/{ownerId}:{workspaceId}/ops/*`. Cloud verifies the caller and workspace access, then the host gateway forwards to Moi's separate `ops.sock` listener as `/workspaces/{workspaceId}/*`. These handlers are never registered on the browser HTTP API.

## Test with a local cloud

Use an isolated data directory so testing does not change your normal Moi configuration:

```sh
export MOI_DATA_DIR="$(mktemp -d)"
printf '%s\n' '{"remote":{"url":"http://localhost:8787/cloud"}}' > "$MOI_DATA_DIR/config.json"
bun server/cli.ts remote login
bun server/cli.ts remote
bun server/cli.ts remote logout
```

Installed packages default to `https://moi.computer/cloud`. Source checkouts require an explicit `remote.url` in `config.json`. The URL includes the `/cloud` mount path, and HTTP is allowed for localhost testing. Set `remote.clientId` to override the default `moi-cli` client ID. Managed machines set `remote.managed` to `true`.

## Use from server code

```ts
import { fetchRemoteWorkspaces } from './remote/client'

const workspaces = await fetchRemoteWorkspaces()
// [{ id, owner: { id, name, email, ... } }]
```

Returns remote workspaces the signed-in account can access. Authentication and network failures throw. No CLI or browser is required.

Credentials use the same data-directory layout in every environment. Set `MOI_DATA_DIR` to a different directory to keep local testing and production logins separate. Saved credentials are bound to their Cloud URL (including its mount path) and client ID: changing either requires a new login, and never sends the previous login's tokens to the new target.
