import dot from '@/client/assets/agents/dot.png'
import duet from '@/client/assets/agents/duet.png'
import grokBot from '@/client/assets/agents/grok-bot.png'
import instinct from '@/client/assets/agents/instinct.png'
import muse from '@/client/assets/agents/muse.png'
import { agentClientPattern } from '@/lib/ids'

const icons = new Map(Object.entries({ dot, duet, 'grok-bot': grokBot, instinct, muse }))

export function agentIcon(client?: string) {
  return client ? icons.get(client) : undefined
}

export function agentClientLabel(client?: string) {
  if (!client || client === 'unknown' || !agentClientPattern.test(client)) return 'Other'
  return client
    .split('-')
    .map(word => word[0].toUpperCase() + word.slice(1))
    .join(' ')
}
