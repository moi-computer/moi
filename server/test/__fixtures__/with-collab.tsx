import { addChatAttachment } from 'moi'
import { useWorkspaceMembers } from 'moi/collab'

export default function CollaborationFixture() {
  const users = useWorkspaceMembers()
  return (
    <button
      onClick={() =>
        addChatAttachment({
          type: 'text',
          label: 'People',
          text: users.map(user => user.name?.trim() || user.email?.trim() || user.id).join(', ')
        })
      }
    >
      Share people
    </button>
  )
}
