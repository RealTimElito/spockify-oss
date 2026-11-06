/**
 * Flatten AgentMessage[] into OpenAI-shaped chat messages (IDE API wire).
 */
import type { AgentMessage } from './types';

/** OpenAI chat.completions message wire shape (subset). */
export type ApiChatMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content:
    | string
    | Array<
        | { type: 'text'; text: string }
        | { type: 'image_url'; image_url: { url: string; detail?: string } }
      >;
  name?: string;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
};

function toOpenAiToolCalls(
  calls: NonNullable<AgentMessage['toolCalls']>,
): NonNullable<ApiChatMessage['tool_calls']> {
  return calls.map((c) => ({
    id: c.id,
    type: 'function' as const,
    function: {
      name: c.name,
      arguments: JSON.stringify(c.arguments ?? {}),
    },
  }));
}

export function flattenAgentMessagesForApi(
  messages: AgentMessage[],
): ApiChatMessage[] {
  const out: ApiChatMessage[] = [];
  for (const m of messages) {
    if (m.role === 'tool') {
      const toolText =
        typeof m.content === 'string'
          ? m.content
          : m.content
              .filter(
                (p): p is { type: 'text'; text: string } => p.type === 'text',
              )
              .map((p) => p.text)
              .join('\n');
      // Prefer native OpenAI tool role when id present; else user-wrapped (OSS).
      if (m.toolCallId) {
        out.push({
          role: 'tool',
          content: toolText,
          name: m.name,
          tool_call_id: m.toolCallId,
        });
      } else {
        out.push({
          role: 'user',
          content: `Tool result (${m.name || 'tool'}):\n${toolText}`,
        });
      }
    } else if (m.role === 'assistant') {
      const row: ApiChatMessage = {
        role: 'assistant',
        content:
          typeof m.content === 'string'
            ? m.content
            : m.content
                .filter(
                  (p): p is { type: 'text'; text: string } => p.type === 'text',
                )
                .map((p) => p.text)
                .join('\n'),
      };
      if (m.toolCalls?.length) {
        row.tool_calls = toOpenAiToolCalls(m.toolCalls);
      }
      out.push(row);
    } else {
      out.push({ role: m.role, content: m.content });
    }
  }
  return out;
}
