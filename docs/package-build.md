# Published package

`bun pm pack` runs both `build:client` and `build:package`. The npm tarball
contains a prebuilt browser app, prebuilt Bun executables, and the assets needed
to create workspaces and compile applets. A normal installation still requires
Bun; it does not install the OpenClaw application.

## Source and release layouts

Development runs `server/cli.ts`. The published launcher runs `runtime/cli.js`.
The source launcher takes precedence in a checkout even after packing, so a
stale release bundle cannot replace source changes during development.

[Package paths](../server/package-paths.ts) resolves assets from the package
root and selects source or compiled worker entrypoints. The release compiler
sets `MOI_BUNDLED`; it is not an environment flag. All server chunks stay directly
under `runtime/`, one level below the package root.

The build worker, server-function worker, and collaboration worker are separate
entrypoints. Browser-side applet runtimes are prebuilt under `runtime/applets/`,
with a shared bridge chunk and external React imports. Skills, declarations,
UI component sources, theme CSS, onboarding instructions, and vendored browser
assets remain files. Do not move file reads relative to a source module without
checking the compiled layout too.

## Runtime dependencies

Most libraries are compiled into the release. These packages remain external:

- `sharp`: platform-specific native image processing.
- `bun-plugin-tailwind`: the applet compiler and its native scanner.
- `tailwindcss`: stylesheets used when compiling applets.
- `typescript` and `@types/bun`: compiler and declaration files for `moi check`.
- `devalue`: also resolved as an input when compiling applet imports.

The Claude Agent SDK's JavaScript is bundled. Moi supplies the user's installed
Claude executable explicitly; the SDK's optional native CLI distributions are
not installed with Moi. Workspace dependencies are still installed separately
when initializing a local workspace.

## OpenClaw

OpenClaw is pinned as a development dependency. The build follows
`GatewayClient` through the supported `openclaw/plugin-sdk/gateway-runtime`
re-export to its implementation, then bundles that implementation unchanged.
This avoids the public barrel's unrelated provider imports. We keep the
upstream authentication, identity persistence, protocol, and reconnect code.

The internal filename changes between releases. The build discovers it from
the public export and fails if that export no longer has the expected shape.
Every OpenClaw upgrade needs the package tests and a real-gateway compatibility
check. Its version is compiled into the client rather than discovered from a
runtime OpenClaw installation. Users still run their own OpenClaw gateway.

The build writes third-party licenses and notices to
`runtime/third-party-notices.txt`. Keep the generated notices with the artifact.

## Verification

Run `bun scripts/test-package.ts /absolute/path/to/moi-computer.tgz` after packing.
CI and release verification run this against the exact artifact they retain.
It installs only production dependencies outside the checkout, disables Bun's
automatic dependency installation for commands, and checks the CLI, mock Cloud
invitation flow, skills, typechecking, server startup, applet compilation,
function and collaboration workers, native image handling, and mock OpenClaw
handshake/events/reconnection. All workspace and authentication state is temporary.

The compressed artifact has a size budget to catch accidental inclusion of
source trees, native agent distributions, or unrelated SDKs. Update the budget
only after examining why the package grew. The mock gateway cannot establish
real gateway compatibility or exercise every TLS/proxy configuration.
