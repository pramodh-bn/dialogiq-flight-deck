"""The sole DB-node to provider-message conversion; no sibling context."""

from sqlalchemy.orm import Session

from models import ConversationNode


def ancestor_chain(
    db: Session, session_id: int, head_id: int | None
) -> list[ConversationNode]:
    chain = []
    seen = set()
    while head_id is not None:
        if head_id in seen:
            raise ValueError("Conversation ancestry contains a cycle.")
        seen.add(head_id)
        node = db.get(ConversationNode, head_id)
        if node is None or node.session_id != session_id:
            raise ValueError("Conversation ancestry is invalid.")
        chain.append(node)
        head_id = node.parent_id
    return list(reversed(chain))


def build_history(
    db: Session, session_id: int, head_id: int | None, opening: str
) -> list[dict[str, str]]:
    history = [{"role": "assistant", "content": opening}]
    for node in ancestor_chain(db, session_id, head_id):
        history.append({"role": "user", "content": node.user_text or ""})
        history.append({"role": "assistant", "content": node.character_text or ""})
    return history
