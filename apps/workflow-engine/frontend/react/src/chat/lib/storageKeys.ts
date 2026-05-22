/**
 * Single source of truth for the chat-surface localStorage keys.
 *
 * Both `useChatSession` (writer) and `useChatSessions` (reader fallback)
 * touch these keys. Keeping the literals in one module prevents silent
 * divergence if a future refactor renames one side without the other.
 */

/** Current single in-flight chat session (full message thread). */
export const LS_CURRENT_SESSION_KEY = 'openwop.sample.chat.session';

/** Multi-session index — list of session HEADERS for the History drawer
 *  to render when the BE write-through is in a cold-start / 401 state
 *  and `listChatSessions()` returns empty. */
export const LS_SESSION_INDEX_KEY = 'openwop.sample.chat.sessions-index';

/** Bump when `LocalSessionHeader` shape changes. Older cached entries
 *  with a different version are discarded on read so the drawer never
 *  shows stale data with a wrong shape. */
export const LS_SESSION_INDEX_VERSION = 1;
