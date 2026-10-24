/** Session todo list shared by the kernel todowrite tool and the IDE adapter. */
import type { TodoItem } from './types';

const STATUSES = new Set(['pending', 'in_progress', 'completed', 'cancelled']);

function normalizeTodos(raw: unknown): TodoItem[] {
  if (!Array.isArray(raw)) return [];
  const out: TodoItem[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const content = String(rec.content || '').trim();
    if (!content) continue;
    const id = String(rec.id || '').trim() || `t${out.length + 1}`;
    const status = STATUSES.has(String(rec.status))
      ? (String(rec.status) as TodoItem['status'])
      : 'pending';
    out.push({ id, content, status });
  }
  return out;
}

export function applyTodoWrite(
  todos: TodoItem[] | undefined,
  args: Record<string, unknown>,
): { ok: true; todos: TodoItem[] } | { ok: false; error: string } {
  if (!todos) return { ok: false, error: 'session todos not bound' };
  const incoming = normalizeTodos(args.todos);
  const merge = args.merge === true || args.merge === 'true';
  if (merge) {
    for (const item of incoming) {
      const index = todos.findIndex((row) => row.id === item.id);
      if (index >= 0) todos[index] = { ...todos[index]!, ...item };
      else todos.push(item);
    }
  } else {
    todos.splice(0, todos.length, ...incoming);
  }
  return { ok: true, todos };
}
