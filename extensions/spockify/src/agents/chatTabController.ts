/**
 * Chat tab ↔ AgentRuntime bridge (concurrent per-tab turns).
 * UI wiring lives in ChatPanelProvider; orchestration in runtime/chatTabAgentHost.
 */

export {
  ChatTabAgentHost,
  getChatTabAgentHost,
  resetChatTabAgentHostForTests,
  shouldDeliverStreamToView,
} from '../runtime/chatTabAgentHost';
export type { ChatTabHostSink, ChatTabTurnInput } from '../runtime/chatTabAgentHost';
