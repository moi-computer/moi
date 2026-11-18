import { defineCommand } from 'citty'
import open from 'open'
import { remoteOperations } from '../remote-operations'
import { clearLine, cursorTo } from 'node:readline'
import { currentRemoteWorkspace } from '../../remote/workspace'
import { parseRemoteWorkspaceAddress } from '@/lib/workspace-config'
import pc from '../pc'
import { columns, keyValue } from '../ui'
import { resolveWorkspace, staleSkillNotice } from '../../skills/version'
import { getLayoutPath } from '../../workspaces/layout'
import {
  login as signIn,
  logout as signOut,
  CloudSignInRequired,
  remoteStatus,
  fetchSharedWorkspaces,
  invitations as listInvitations,
  accept as acceptInvitation,
  renameAgent,
  leave as leaveWorkspace
} from '../../remote/client'

// Profile fields are user supplied; they must not control the terminal.
// oxlint-disable-next-line no-control-regex -- Deliberately remove terminal control characters.
const text = (value: string) => Bun.stripANSI(value).replace(/[\u0000-\u001f\u007f-\u009f]/g, '')

async function warnIfSkillStale() {
  try {
    const { root, harness } = await resolveWorkspace(process.cwd())
    if (!harness && !(await Bun.file(getLayoutPath(root)).exists())) return
    const notice = await staleSkillNotice(root)
    if (notice) console.error('\n' + pc.yellow(notice))
  } catch {
    // A skill check must not prevent displaying remote status.
  }
}

async function reportErrors(action: () => Promise<void>): Promise<void> {
  try {
    await action()
  } catch (error) {
    if (
      error instanceof CloudSignInRequired ||
      (error instanceof Error && error.message === 'Not signed in — run moi remote login')
    ) {
      console.error(`${pc.dim('›')} Signed out`)
      console.error(
        pc.dim('› Run ') + pc.cyan('moi remote login') + pc.dim(' to connect to Moi Cloud')
      )
    } else {
      console.error(error instanceof Error ? error.message : 'Cloud request failed')
    }
    process.exitCode = 1
  }
}

function waitingForLogin(): () => void {
  const message = 'Waiting for authentication…'
  if (!process.stderr.isTTY) {
    console.error(message)
    return () => {}
  }
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
  let frame = 0
  const draw = () => {
    cursorTo(process.stderr, 0)
    process.stderr.write(pc.dim(`${frames[frame++ % frames.length]} ${message}`))
  }
  draw()
  const timer = setInterval(draw, 80)
  const stop = () => {
    clearInterval(timer)
    clearLine(process.stderr, 0)
    cursorTo(process.stderr, 0)
    process.removeListener('SIGINT', interrupt)
  }
  const interrupt = () => {
    stop()
    process.exit(130)
  }
  process.once('SIGINT', interrupt)
  return stop
}

const login = defineCommand({
  meta: { name: 'login', description: 'Sign in to Moi Cloud in your browser (for humans only)' },
  args: {
    browser: {
      type: 'boolean',
      default: true,
      description: 'Open the login page (use --no-browser to print its URL only)'
    }
  },
  async run({ args }) {
    await reportErrors(async () => {
      let stopWaiting = () => {}
      try {
        await signIn(async (url, code) => {
          console.log(`\nVisit ${pc.bold(url)}\nCode: ${text(code)}\n`)
          if (args.browser) await open(url).catch(() => {})
          stopWaiting = waitingForLogin()
        })
      } finally {
        stopWaiting()
      }
      const { me } = await remoteStatus()
      const identity = 'email' in me ? me.email : me.name
      console.log(`${pc.green('✓')} Signed in as ${text(identity)}\n`)
    })
  }
})

const logout = defineCommand({
  meta: { name: 'logout', description: 'Sign out of Moi Cloud' },
  args: { yes: { type: 'boolean', description: 'Confirm permanently revoking this agent login' } },
  async run({ args }) {
    await reportErrors(async () => {
      await signOut(args.yes)
      console.log(`${pc.green('✓')} Signed out`)
    })
  }
})

const jsonArg = { type: 'boolean' as const, description: 'Print JSON' }
const rename = defineCommand({
  meta: {
    name: 'rename-agent',
    description: 'Change your agent name across workspaces (for agents only)'
  },
  args: { name: { type: 'positional', required: true }, json: jsonArg },
  async run({ args }) {
    await reportErrors(async () => {
      const result = await renameAgent(args.name)
      console.log(args.json ? JSON.stringify(result) : `Agent renamed to ${text(result.name)}`)
    })
  }
})
const invitations = defineCommand({
  meta: { name: 'invitations', description: 'List pending workspace invitations' },
  args: { json: jsonArg },
  async run({ args }) {
    await reportErrors(async () => {
      const result = await listInvitations()
      if (args.json) console.log(JSON.stringify(result))
      else if (!result.length) console.log('No pending invitations')
      else
        for (const invitation of result)
          console.log(
            `${text(invitation.id)}  ${text(invitation.workspaceName)} — ${text(invitation.inviter.name)}`
          )
    })
  }
})
const workspaces = defineCommand({
  meta: { name: 'workspaces', description: 'List shared workspaces and pending invitations' },
  args: { json: jsonArg },
  async run({ args }) {
    await reportErrors(async () => {
      const [available, pending] = await Promise.all([fetchSharedWorkspaces(), listInvitations()])
      if (args.json) {
        console.log(JSON.stringify({ workspaces: available, invitations: pending }, null, 2))
        return
      }
      console.log('\n' + pc.bold('Available shared workspaces') + '\n')
      if (available.length) {
        console.log(
          columns(
            ['Workspace', 'Shared by', 'Remote ID'].map(label => pc.dim(label)),
            available.map(workspace => [
              text(workspace.id),
              text(workspace.owner.email),
              text(`${workspace.owner.id}:${workspace.id}`)
            ])
          )
        )
        console.log(
          '\n' + pc.dim('To link from a new folder: ') + pc.cyan('moi init --remote <remote-id>')
        )
      } else console.log('  No shared workspaces yet')
      console.log('\n' + pc.bold('Pending invitations') + '\n')
      if (pending.length) {
        console.log(
          columns(
            ['Workspace', 'Invited by', 'Invitation ID'].map(label => pc.dim(label)),
            pending.map(invitation => [
              text(invitation.workspaceName),
              text(invitation.inviter.email),
              text(invitation.id)
            ])
          )
        )
        console.log('\n' + pc.dim('To accept: ') + pc.cyan('moi remote accept <invitation-id>'))
      } else console.log('  No pending invitations')
      console.log('\nHelp and full command list: ' + pc.cyan('moi remote workspaces --help') + '\n')
    })
  }
})
const accept = defineCommand({
  meta: { name: 'accept', description: 'Accept a workspace invitation as a human or agent' },
  args: {
    invite: { type: 'positional', required: true },
    name: { type: 'string', description: 'Your agent display name, shown to workspace members' },
    client: {
      type: 'string',
      description: 'The app you run in, as a lowercase id such as dot or grok-bot'
    },
    json: jsonArg
  },
  async run({ args }) {
    await reportErrors(async () => {
      const result = await acceptInvitation(args.invite, args.name, args.client)
      console.log(
        args.json
          ? JSON.stringify(result)
          : `Invitation accepted\n\nCreate a local linked folder (choose an unused folder name):\nmoi init ./workspace-folder --remote ${result.remote.user_id}:${result.remote.workspace_id}`
      )
    })
  }
})
const leave = defineCommand({
  meta: { name: 'leave', description: 'Leave a shared workspace; keep local files' },
  args: {
    workspace: {
      type: 'positional',
      required: false,
      description: 'ownerId:workspaceId (defaults to current folder)'
    },
    json: jsonArg
  },
  async run({ args }) {
    await reportErrors(async () => {
      const target =
        args.workspace !== undefined
          ? parseRemoteWorkspaceAddress(args.workspace)
          : await currentRemoteWorkspace()
      if (!target)
        throw new Error(
          'No remote workspace here — run from a linked workspace folder or provide ownerId:workspaceId'
        )
      const result = await leaveWorkspace(target.user_id, target.workspace_id)
      console.log(args.json ? JSON.stringify(result) : 'Left the workspace; local files kept')
    })
  }
})
const remoteSubCommands = {
  ...remoteOperations(reportErrors),
  login,
  logout,
  'rename-agent': rename,
  workspaces,
  invitations,
  accept,
  leave
}

export const remote = defineCommand({
  meta: { name: 'remote', description: 'Show your identity and linked workspace commands' },
  args: { json: jsonArg },
  subCommands: remoteSubCommands,
  setup({ rawArgs }) {
    // Citty accepts unknown options. Reject the removed selector before dispatch
    // so an old script cannot silently operate on the current workspace.
    const separator = rawArgs.indexOf('--')
    const options = separator < 0 ? rawArgs : rawArgs.slice(0, separator)
    if (options.some(arg => arg === '--path' || arg.startsWith('--path='))) {
      throw new Error('Unknown option --path — run this command from the workspace folder')
    }
  },
  async run({ args, rawArgs }) {
    // citty also runs the parent after a subcommand; only bare `remote` shows status.
    const sub = rawArgs.find(arg => !arg.startsWith('-'))
    if (sub && Object.hasOwn(remoteSubCommands, sub)) return
    await reportErrors(async () => {
      const status = {
        ...(await remoteStatus()),
        currentWorkspace: await currentRemoteWorkspace()
      }
      if (args.json) {
        console.log(JSON.stringify(status, null, 2))
        await warnIfSkillStale()
        return
      }
      const detail = 'email' in status.me ? status.me.email : status.me.client
      console.log(
        '\nSigned in as ' + pc.bold(text(status.me.name || detail)) + pc.dim(` <${text(detail)}>`)
      )
      const linked = status.currentWorkspace
      if (linked) {
        const workspace = status.workspaces.find(
          item => item.id === linked.workspace_id && item.owner.id === linked.user_id
        )
        console.log(
          '\nCurrent workspace is linked to: ' +
            pc.bold(text(linked.workspace_id)) +
            (workspace ? ' by ' + text(workspace.owner.email) : '')
        )
        console.log('Remote ID: ' + text(`${linked.user_id}:${linked.workspace_id}`))
        console.log(
          '\n' +
            keyValue([
              [pc.cyan('moi remote read <remote-path>'), 'Read a file'],
              [pc.cyan('moi remote write <remote-path> "content"'), 'Write a file'],
              [pc.cyan('moi remote patch <remote-path>'), 'Apply a diff from stdin'],
              [pc.cyan('moi remote exec "command"'), 'Run a command remotely'],
              [pc.cyan('moi remote file-upload <local-path> <remote-path>'), 'Upload a local file'],
              [
                pc.cyan('moi remote file-download <remote-path> <local-path>'),
                'Download a remote file'
              ]
            ])
        )
        console.log(
          '\n' +
            pc.cyan(
              'moi check|bundle|theme|config|tabs|ui-components|call-server-fn|debug|scratch'
            ) +
            '\n' +
            pc.dim('These regular commands work on the remote workspace')
        )
      } else {
        console.log('\nThis folder is not linked to a remote workspace')
      }
      console.log('\n' + pc.dim('Help and full command list: ') + pc.cyan('moi remote --help'))
      if (linked) console.log(pc.dim('Command help:  ') + pc.cyan('moi remote <command> --help'))
      console.log()
      await warnIfSkillStale()
    })
  }
})
