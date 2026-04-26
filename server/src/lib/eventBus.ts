// Tiny in-process pub/sub used to push events to SSE subscribers.
//
// We intentionally avoid Redis or any external broker — single-process Node
// is enough for the small construction-team scale this app targets. When it
// stops being enough, swap publish() to write to Redis pub/sub and have
// each Node instance subscribe; the call sites stay identical.

type Listener<T> = (payload: T) => void;

class TopicBus<T> {
  private listeners = new Map<string, Set<Listener<T>>>();

  subscribe(topic: string, listener: Listener<T>): () => void {
    let set = this.listeners.get(topic);
    if (!set) {
      set = new Set();
      this.listeners.set(topic, set);
    }
    set.add(listener);
    return () => {
      set!.delete(listener);
      if (set!.size === 0) this.listeners.delete(topic);
    };
  }

  publish(topic: string, payload: T): void {
    const set = this.listeners.get(topic);
    if (!set) return;
    for (const listener of set) {
      try {
        listener(payload);
      } catch (err) {
        // Listener faults are isolated — one bad subscriber can't take the
        // whole topic down. Log and move on.
        console.warn('[eventBus] listener threw', err);
      }
    }
  }
}

export interface MessageEvent {
  type: 'message.created';
  message: {
    id: string;
    fromUserId: string;
    toUserId: string;
    body: string;
    subject?: string | null;
    createdAt: string;
    fromUser: { id: string; name: string; role: string };
  };
}

export interface CommentEvent {
  type: 'comment.created' | 'comment.deleted';
  projectId: string;
  comment?: {
    id: string;
    authorId: string;
    body: string;
    createdAt: string;
    attachments?: unknown;
    author: { id: string; name: string; role: string };
  };
  commentId?: string;
}

export const messageBus = new TopicBus<MessageEvent>();
export const projectCommentBus = new TopicBus<CommentEvent>();
