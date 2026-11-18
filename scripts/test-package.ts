// Run against the exact tarball CI will publish, outside the checkout and with
// only production dependencies. No global installation or real user state.
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, copyFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, delimiter } from 'node:path'
import pkg from '../package.json'
import type { WorkerMessage } from '../server/collab/worker-messages'

const tarball = resolve(process.argv[2] ?? '')
assert.ok(process.argv[2], 'Usage: bun scripts/test-package.ts <tarball>')
assert.ok(Bun.file(tarball).size < 12 * 1024 * 1024, 'Compressed package exceeds the 12 MiB budget')
const root = await mkdtemp(join(tmpdir(), 'moi-package-test-'))
const install = join(root, 'install')
const workspace = join(root, 'workspace')
const moi = join(workspace, '.moi')
await mkdir(install)
await mkdir(join(moi, 'widgets'), { recursive: true })
function freePort(): number {
  const server = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: () => new Response() })
  const port = server.port!
  server.stop(true)
  return port
}
const port = freePort()
const env = {
  ...process.env,
  MOI_DATA_DIR: join(root, 'data'),
  MOI_SECRET_BACKEND: 'file',
  MOI_ENVIRONMENT: 'local',
  MOI_DEMO: '0',
  MOI_DEV: '',
  MOI_SERVER: '',
  OPENCLAW_STATE_DIR: join(root, 'openclaw'),
  OPENCLAW_HOME: join(root, 'openclaw'),
  PORT: String(port),
  MOI_CONTROL_PORT: String(freePort()),
  PATH: join(install, 'node_modules', '.bin') + delimiter + process.env.PATH,
  NO_COLOR: '1'
}
async function command(args: string[], cwd = workspace): Promise<string> {
  const child = Bun.spawn([process.execPath, '--no-install', ...args], {
    cwd,
    env,
    stdout: 'pipe',
    stderr: 'pipe',
    timeout: 90_000
  })
  const [out, err, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited
  ])
  assert.equal(code, 0, `${args.join(' ')}\n${out}\n${err}`)
  return out
}
let server: ReturnType<typeof Bun.spawn> | undefined
let logs = ''
let cloud: ReturnType<typeof Bun.serve> | undefined
try {
  await Bun.write(
    join(install, 'package.json'),
    JSON.stringify({ private: true, dependencies: { 'moi-computer': `file:${tarball}` } })
  )
  console.log((await command(['install', '--production', '--ignore-scripts'], install)).trim())
  const packageRoot = join(install, 'node_modules', 'moi-computer')
  const cli = join(packageRoot, 'bin', 'moi.mjs')
  const run = (...args: string[]) => command([cli, ...args])
  assert.equal(await Bun.file(join(packageRoot, 'server/cli.ts')).exists(), false)
  assert.equal(await Bun.file(join(install, 'node_modules/openclaw/package.json')).exists(), false)
  assert.match(await run('--version'), new RegExp(pkg.version.replaceAll('.', '\\.')))
  assert.match(await run('remote', '--help'), /remote/)
  // The invitation path must work without OpenClaw, a browser, or a local server.
  let agentId = ''
  cloud = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    async fetch(request) {
      const path = new URL(request.url).pathname
      if (path.endsWith('/agents/join')) {
        const body = (await request.json()) as { proof: { agent: string } }
        const claims = JSON.parse(
          Buffer.from(body.proof.agent.split('.')[1]!, 'base64url').toString()
        ) as { sub: string; iss: string }
        agentId = claims.sub
        return Response.json({
          success: true,
          agentId,
          hostId: claims.iss,
          membershipId: 'member',
          remote: { user_id: 'owner', workspace_id: 'shared' }
        })
      }
      assert.match(request.headers.get('authorization') ?? '', /^Bearer /)
      if (path.endsWith('/me'))
        return Response.json({ id: agentId, type: 'agent', name: 'Package test', client: 'other' })
      if (path.endsWith('/workspaces/shared'))
        return Response.json({
          workspaces: [
            { id: 'shared', owner: { id: 'owner', name: 'Owner', email: 'test@example.com' } }
          ]
        })
      return new Response('Not found', { status: 404 })
    }
  })
  await Bun.write(
    join(env.MOI_DATA_DIR, 'config.json'),
    JSON.stringify({ remote: { url: cloud.url.origin } })
  )
  await run(
    'remote',
    'accept',
    `${cloud.url.origin}/agent-invite/test?token=${'A'.repeat(43)}`,
    '--name=Package test',
    '--client=other'
  )
  const linked = join(root, 'linked')
  await run('init', linked, '--remote=owner:shared')
  assert.ok(await Bun.file(join(linked, '.agents/skills/moi-workspace/SKILL.md')).exists())
  assert.match(await command([cli, 'remote'], linked), /shared/)

  // Existing .moi prevents a background workspace install; Tailwind resolves
  // from this fixture's own explicit package tree, as in a real workspace.
  await Bun.write(
    join(moi, 'package.json'),
    JSON.stringify({ private: true, dependencies: { tailwindcss: pkg.dependencies.tailwindcss } })
  )
  await command(['install', '--ignore-scripts'], moi)
  await run('init', workspace, '--harness=codex', '--id=package-smoke')
  assert.ok(await Bun.file(join(workspace, '.agents/skills/moi-workspace/SKILL.md')).exists())
  await Bun.write(
    join(moi, 'widgets/checked.ts'),
    'export default function Widget() { return null }\n'
  )
  assert.match(await run('check', '--only=widgets/checked'), /checks passed/)
  await Bun.write(
    join(moi, 'widgets/hello.server.ts'),
    'export async function add(a: number, b: number) { return a + b }\n'
  )
  await Bun.write(
    join(moi, 'widgets/hello.tsx'),
    `import { resolveUrl } from 'moi'
import { useMe } from 'moi/collab'
import { add } from './hello.server'
export default function Widget() { const me = useMe(); return <button className="p-4 animate-in" onClick={() => add(2, 3)}>{resolveUrl('moi:/files/photo.png')}{me?.name}</button> }
`
  )
  server = Bun.spawn([process.execPath, '--no-install', cli, 'start'], {
    cwd: root,
    env: { ...env, MOI_SERVER: '1' },
    stdout: 'pipe',
    stderr: 'pipe'
  })
  const readLogs = async (stream: ReadableStream<Uint8Array>) => {
    for await (const bytes of stream) logs += new TextDecoder().decode(bytes)
  }
  void readLogs(server.stdout as ReadableStream<Uint8Array>)
  void readLogs(server.stderr as ReadableStream<Uint8Array>)
  const deadline = Date.now() + 15_000
  while (true) {
    const response = await fetch(`http://127.0.0.1:${port}/`).catch(() => undefined)
    if (response?.ok) {
      assert.match(await response.text(), /<!doctype html>/i)
      break
    }
    assert.ok(Date.now() < deadline && server.exitCode === null, logs || 'Server startup timed out')
    await Bun.sleep(50)
  }
  assert.match(await run('bundle', '--force'), /built/)
  const js = await Bun.file(join(moi, '.build/widgets/hello/index.js')).text()
  assert.match(js, /photo\.png/)
  assert.match(await run('call-server-fn', 'widgets/hello/add', '[2,3]'), /5/)
  // Exercises React-free tldraw schemas in the prebuilt server.
  await run('scratch', 'add', 'text', '--text=Package smoke', '--at=0,0', '--id=smoke')
  assert.match(await run('scratch', 'read'), /Package smoke/)
  const image = join(root, 'pixel.svg')
  await Bun.write(
    image,
    '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="red"/></svg>'
  )
  await run('scratch', 'add', 'image', image, '--id=picture')
  await run('ui-components', 'list')
  // The room worker is a separate process, not part of the server bundle.
  const welcomed = Promise.withResolvers<void>()
  const room = Bun.spawn(
    [process.execPath, '--no-install', join(packageRoot, 'runtime/worker.js')],
    {
      cwd: root,
      env: { ...env, MOI_COLLAB_WORKSPACE: workspace, MOI_COLLAB_GENERATION: 'test' },
      stderr: 'inherit',
      timeout: 5000,
      ipc(message: WorkerMessage, child) {
        if (message.type === 'ready')
          child.send({
            type: 'client',
            connectionId: 'one',
            message: {
              type: 'join',
              version: 1,
              profile: { id: 'user', name: 'User', color: '#123456' }
            }
          })
        if (message.type === 'client' && message.message.type === 'welcome') welcomed.resolve()
      },
      onExit() {
        welcomed.reject(new Error('Room worker exited before welcome'))
      }
    }
  )
  try {
    await welcomed.promise
  } finally {
    room.kill()
    await room.exited
  }

  await copyFile(join(import.meta.dir, 'package-gateway-check.ts'), join(root, 'gateway-check.ts'))
  console.log(
    await command(
      [
        join(root, 'gateway-check.ts'),
        join(packageRoot, 'runtime/gateway-client.js'),
        pkg.devDependencies.openclaw
      ],
      root
    )
  )
  console.log(
    'Packed package passed: CLI, skills, types, server, applet build, function worker, Scratchpad, gateway'
  )
} catch (error) {
  console.error(logs)
  throw error
} finally {
  cloud?.stop(true)
  server?.kill('SIGTERM')
  if (server) await server.exited
  await rm(root, { recursive: true, force: true })
}
