// Source uses the pinned SDK. The release build replaces its broad public
// barrel with the same GatewayClient implementation and its dependencies.
import { GatewayClient as Client, type GatewayClientOptions } from '@openclaw/gateway-client'
import pkg from '../../../package.json'
import { deviceAuthHost } from './device-auth'

export class GatewayClient extends Client {
  constructor(options: GatewayClientOptions) {
    super({
      clientVersion: pkg.devDependencies['@openclaw/gateway-client'],
      ...options,
      hostDeps: { ...deviceAuthHost(options.env), ...options.hostDeps }
    })
  }
}
