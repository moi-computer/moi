import { expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('remote rejects the removed path option before running commands', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'moi-removed-path-'))
  try {
    for (const args of [
      ['--path', directory],
      ['read', 'notes.txt', `--path=${directory}`],
      ['write', 'notes.txt', 'content', '--path', directory],
      ['patch', 'notes.txt', '--path', directory],
      ['exec', 'touch should-not-exist', '--path', directory],
      ['file-upload', 'source', 'destination', '--path', directory],
      ['file-download', 'source', 'destination', '--path', directory],
      ['leave', '--path', directory]
    ]) {
      const child = Bun.spawn(
        [process.execPath, join(import.meta.dir, '../../cli.ts'), 'remote', ...args],
        {
          cwd: directory,
          env: { ...Bun.env, MOI_DATA_DIR: directory, NO_COLOR: '1' },
          stdout: 'pipe',
          stderr: 'pipe'
        }
      )
      const [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()])
      expect(code).toBe(1)
      expect(stderr).toContain('Unknown option --path')
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('remote after logout gives a concise sign-in message without a stack trace', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'moi-remote-cli-'))
  try {
    await Bun.write(
      join(directory, 'config.json'),
      JSON.stringify({ remote: { url: 'http://localhost:8787/cloud' } })
    )
    const logout = Bun.spawn(['bun', join(import.meta.dir, '../../cli.ts'), 'remote', 'logout'], {
      env: { ...Bun.env, MOI_DATA_DIR: directory, NO_COLOR: '1' },
      stdout: 'pipe',
      stderr: 'pipe'
    })
    expect(await logout.exited).toBe(0)
    expect((await new Response(logout.stdout).text()).trim()).toBe('✓ Signed out')
    expect(await new Response(logout.stderr).text()).toBe('')
    const process = Bun.spawn(['bun', join(import.meta.dir, '../../cli.ts'), 'remote'], {
      env: { ...Bun.env, MOI_DATA_DIR: directory },
      stdout: 'pipe',
      stderr: 'pipe'
    })
    const [code, stdout, stderr] = await Promise.all([
      process.exited,
      new Response(process.stdout).text(),
      new Response(process.stderr).text()
    ])
    expect(code).toBe(1)
    expect(stdout).toBe('')
    expect(stderr.trim()).toBe('› Signed out\n› Run moi remote login to connect to Moi Cloud')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('profile names cannot inject terminal commands', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'moi-remote-terminal-'))
  const server = Bun.serve({
    port: 0,
    fetch(request) {
      return Response.json(
        new URL(request.url).pathname.endsWith('/me')
          ? { id: 'u1', name: '\x1b[31mHello\x1b[0m\nWorld', email: 'test@example.com' }
          : { workspaces: [] }
      )
    }
  })
  try {
    const url = server.url.origin + '/cloud'
    await Bun.write(join(directory, 'config.json'), JSON.stringify({ remote: { url } }))
    const jwt = `e30.${Buffer.from(JSON.stringify({ exp: Date.now() / 1000 + 3600 })).toString('base64url')}.signature`
    await Bun.write(
      join(directory, 'remote-auth.json'),
      JSON.stringify({ accessToken: jwt, refreshToken: 'unused', url, clientId: 'moi-cli' })
    )
    const child = Bun.spawn([process.execPath, join(import.meta.dir, '../../cli.ts'), 'remote'], {
      cwd: directory,
      env: { ...Bun.env, MOI_DATA_DIR: directory, NO_COLOR: '1' },
      stdout: 'pipe',
      stderr: 'pipe'
    })
    const output = await new Response(child.stdout).text()
    expect(await child.exited).toBe(0)
    expect(output).toContain('HelloWorld <test@example.com>')
    expect(output).not.toContain('\x1b')
    expect(await new Response(child.stderr).text()).toBe('')
  } finally {
    server.stop(true)
    await rm(directory, { recursive: true, force: true })
  }
})

test('human CLI login, status, workspaces, invitations, acceptance and logout', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'moi-human-commands-'))
  let accepted = false,
    revoked = false,
    sharedReads = 0
  const server = Bun.serve({
    port: 0,
    async fetch(request): Promise<Response> {
      const path = new URL(request.url).pathname
      if (path.endsWith('/device/code')) {
        const form = await request.formData()
        expect(String(form.get('scope'))).toContain('workspaces:access')
        return Response.json({
          device_code: 'device',
          user_code: 'ABCD',
          verification_uri_complete: server.url.origin + '/cloud/device?user_code=ABCD',
          expires_in: 30,
          interval: 1
        })
      }
      if (path.endsWith('/oauth2/token'))
        return Response.json({
          access_token: `e30.${Buffer.from(JSON.stringify({ exp: Date.now() / 1000 + 3600 })).toString('base64url')}.sig`,
          refresh_token: 'refresh'
        })
      if (path.endsWith('/oauth2/revoke')) {
        revoked = true
        return Response.json({})
      }
      expect(request.headers.get('authorization')).toStartWith('Bearer ')
      if (path.endsWith('/me'))
        return Response.json({ id: 'human', name: 'Alex', email: 'alex@example.com' })
      if (path.endsWith('/workspaces/shared')) {
        sharedReads++
        return Response.json({
          workspaces: accepted
            ? [{ id: 'board', owner: { id: 'owner', name: 'Owner', email: 'owner@example.com' } }]
            : []
        })
      }
      if (path.endsWith('/workspaces/invitations'))
        return Response.json({
          invitations: accepted
            ? []
            : [
                {
                  id: 'invite',
                  workspaceId: 'board',
                  workspaceName: 'Board',
                  inviter: { id: 'owner', name: 'Owner', email: 'owner@example.com' },
                  expiresAt: new Date(Date.now() + 60000).toISOString()
                }
              ]
        })
      if (path.endsWith('/invitations/invite/accept')) {
        accepted = true
        return Response.json({
          success: true,
          remote: { user_id: 'owner', workspace_id: 'board' },
          membershipId: 'member'
        })
      }
      return new Response(null, { status: 404 })
    }
  })
  try {
    await Bun.write(
      join(directory, 'config.json'),
      JSON.stringify({ remote: { url: server.url.origin + '/cloud' } })
    )
    let lastStderr = ''
    async function cli(args: string[]) {
      const child = Bun.spawn(
        [process.execPath, join(import.meta.dir, '../../cli.ts'), 'remote', ...args],
        {
          cwd: directory,
          env: { ...Bun.env, MOI_DATA_DIR: directory, NO_COLOR: '1' },
          stdout: 'pipe',
          stderr: 'pipe'
        }
      )
      const [code, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text()
      ])
      lastStderr = stderr
      expect(code).toBe(0)
      expect(stderr).not.toContain('error:')
      return stdout
    }
    expect(await cli(['login', '--no-browser'])).toContain('Signed in as alex@example.com')
    expect((await cli([])).trim()).toBe(
      'Signed in as Alex <alex@example.com>\n\nThis folder is not linked to a remote workspace\n\nHelp and full command list: moi remote --help'
    )
    expect(lastStderr).not.toContain('Moi skill outdated')
    await Bun.write(
      join(directory, '.moi/.workspace.json'),
      JSON.stringify({ version: 1, widgetGrid: [] })
    )
    expect((await cli([])).trim()).toBe(
      'Signed in as Alex <alex@example.com>\n\nThis folder is not linked to a remote workspace\n\nHelp and full command list: moi remote --help'
    )
    expect(JSON.parse(await cli(['--json'])).me.id).toBe('human')
    expect(JSON.parse(await cli(['invitations', '--json']))).toHaveLength(1)
    const pendingWorkspaces = await cli(['workspaces'])
    expect(pendingWorkspaces).toContain('No shared workspaces yet')
    expect(pendingWorkspaces).toContain('Board')
    expect(pendingWorkspaces).toContain('owner@example.com')
    expect(pendingWorkspaces).toContain('moi remote accept <invitation-id>')
    expect(pendingWorkspaces).not.toContain('moi remote accept invite')
    const pendingJson = JSON.parse(await cli(['workspaces', '--json']))
    expect(pendingJson.workspaces).toEqual([])
    expect(pendingJson.invitations).toHaveLength(1)
    const beforeAcceptance = sharedReads
    expect(JSON.parse(await cli(['accept', 'invite', '--json'])).remote).toEqual({
      user_id: 'owner',
      workspace_id: 'board'
    })
    expect(await cli(['accept', 'invite'])).toContain(
      'moi init ./workspace-folder --remote owner:board'
    )
    expect(accepted).toBe(true)
    expect(sharedReads).toBe(beforeAcceptance)
    const joinedWorkspaces = await cli(['workspaces'])
    expect(joinedWorkspaces).toContain('owner:board')
    expect(joinedWorkspaces).toContain('moi init --remote <remote-id>')
    expect(joinedWorkspaces).not.toContain('moi init ./workspace-folder --remote owner:board')
    expect(joinedWorkspaces).toContain('No pending invitations')
    expect(joinedWorkspaces).not.toContain('moi remote accept')
    const joinedJson = JSON.parse(await cli(['workspaces', '--json']))
    expect(joinedJson.workspaces).toHaveLength(1)
    expect(joinedJson.invitations).toEqual([])
    await Bun.write(
      join(directory, '.moi/.workspace.json'),
      JSON.stringify({
        version: 2,
        remote: { user_id: 'owner', workspace_id: 'board' }
      })
    )
    const linkedHome = await cli([])
    expect(linkedHome).toContain('Current workspace is linked to: board by owner@example.com')
    expect(linkedHome).toContain('Remote ID: owner:board')
    expect(linkedHome).toContain('moi remote read <remote-path>')
    expect(linkedHome).toContain('moi remote exec "command"')
    expect(linkedHome).not.toContain('Available shared workspaces')
    expect(linkedHome).not.toContain('Pending invitations')
    await Bun.write(
      join(directory, '.agents/skills/moi-workspace/SKILL.md'),
      '<moi-skill version="0.1.0" />'
    )
    expect(await cli([])).not.toContain('Moi skill outdated')
    expect(lastStderr).toContain('Moi skill outdated')
    expect(lastStderr).toContain('moi skill update')
    expect(JSON.parse(await cli(['--json'])).currentWorkspace.workspace_id).toBe('board')
    expect(lastStderr).toContain('Moi skill outdated')
    await cli(['logout'])
    expect(revoked).toBe(true)
    expect(await Bun.file(join(directory, 'remote-auth.json')).exists()).toBe(false)
  } finally {
    server.stop(true)
    await rm(directory, { recursive: true, force: true })
  }
})

test('invalid or unauthenticated acceptance leaves credentials untouched', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'moi-accept-signed-out-'))
  const { createRemoteClient } = await import('../../remote/client')
  const url = 'http://localhost:8787/cloud'
  try {
    await Bun.write(join(directory, 'config.json'), JSON.stringify({ remote: { url } }))
    const client = createRemoteClient(directory)
    for (const invite of ['invitation', `${url}/invite/id?token=${'A'.repeat(43)}`]) {
      await expect(client.accept(invite, 'Agent', 'other')).rejects.toThrow('remote login')
    }
    await expect(client.accept(`${url}/agent-invite/id?token=${'A'.repeat(43)}`)).rejects.toThrow(
      '--name and --client'
    )
    for (const invalid of ['Grok Bot', 'openclaw', 'unknown', ''])
      await expect(
        client.accept(`${url}/agent-invite/id?token=${'A'.repeat(43)}`, 'Agent', invalid)
      ).rejects.toThrow('Invalid client')
    expect(await Bun.file(join(directory, 'remote-auth.json')).exists()).toBe(false)
    expect(await Bun.file(join(directory, 'remote-agent-pending.json')).exists()).toBe(false)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('remote file commands identify an existing local workspace', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'moi-local-remote-error-'))
  try {
    await Bun.write(
      join(directory, '.moi/.workspace.json'),
      JSON.stringify({ version: 2, name: 'My local workspace', widgetGrid: [] })
    )
    const child = Bun.spawn(
      [process.execPath, join(import.meta.dir, '../../cli.ts'), 'remote', 'read', 'image.png'],
      {
        cwd: directory,
        env: { ...Bun.env, MOI_DATA_DIR: directory, NO_COLOR: '1' },
        stdout: 'pipe',
        stderr: 'pipe'
      }
    )
    const stderr = await new Response(child.stderr).text()
    expect(await child.exited).toBe(1)
    expect(stderr).toContain(
      'This folder is not linked to a remote workspace\nIt is an existing local workspace: My local workspace'
    )
    expect(stderr).not.toContain('moi init')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
