/**
 * OpenAI-style chat content (string or multimodal parts) + attachment helpers.
 */

export type ChatTextPart = { type: 'text'; text: string };
export type ChatImageUrlPart = {
  type: 'image_url';
  image_url: { url: string; detail?: string };
};
export type ChatContentPart = ChatTextPart | ChatImageUrlPart;
export type ChatContent = string | ChatContentPart[];

/** Composer → host attachment payload (paste / paperclip). */
export interface ChatAttachmentPayload {
  id: string;
  name: string;
  mimeType: string;
  kind: 'image' | 'file';
  /** data: URL for images (vision). */
  dataUrl?: string;
  /** UTF-8 text for text-like files. */
  textContent?: string;
  size: number;
}

export const MAX_CHAT_ATTACHMENTS = 8;
/** Soft cap per attachment (~4 MiB) to keep webview postMessage sane. */
export const MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024;

export function isChatContentParts(
  content: ChatContent | undefined,
): content is ChatContentPart[] {
  return Array.isArray(content);
}

/** Flatten text parts (or string) for titles, previews, and non-vision fallbacks. */
export function textFromContent(content: unknown): string {
  if (content == null) return '';
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter(
      (p): p is ChatTextPart =>
        !!p &&
        typeof p === 'object' &&
        (p as ChatTextPart).type === 'text' &&
        typeof (p as ChatTextPart).text === 'string',
    )
    .map((p) => p.text)
    .join('\n');
}

export function contentHasImages(content: ChatContent | undefined): boolean {
  if (!isChatContentParts(content)) return false;
  return content.some((p) => p?.type === 'image_url');
}

/**
 * Build user message content: text (+ non-image file bodies) and image_url parts.
 * Returns a plain string when there are no images (backward compatible).
 */
export function buildUserContentFromAttachments(
  text: string,
  attachments?: ChatAttachmentPayload[],
): ChatContent {
  const atts = (attachments ?? []).filter(Boolean);
  if (!atts.length) return text;

  const textBits: string[] = [];
  if (text.trim()) textBits.push(text);

  const imageParts: ChatImageUrlPart[] = [];
  for (const a of atts) {
    if (a.kind === 'image' && a.dataUrl) {
      imageParts.push({
        type: 'image_url',
        image_url: { url: a.dataUrl },
      });
      continue;
    }
    if (a.textContent != null && a.textContent !== '') {
      textBits.push(
        `[Attached file: ${a.name}]\n\`\`\`\n${a.textContent}\n\`\`\``,
      );
    } else {
      const mime = a.mimeType || 'application/octet-stream';
      textBits.push(
        `[Attached file: ${a.name} (${mime}, ${a.size} bytes)]`,
      );
    }
  }

  const combined = textBits.join('\n\n');
  if (!imageParts.length) {
    return combined || text;
  }

  const parts: ChatContentPart[] = [];
  if (combined) parts.push({ type: 'text', text: combined });
  parts.push(...imageParts);
  return parts;
}

export function isImageMime(mime: string | undefined): boolean {
  return !!mime && /^image\//i.test(mime);
}

export function looksLikeTextMime(mime: string | undefined, name: string): boolean {
  if (mime) {
    if (/^text\//i.test(mime)) return true;
    if (
      /^(application\/(json|xml|javascript|typescript|x-yaml|yaml|toml|sql|csv|x-sh|x-httpd-php)|image\/svg\+xml)/i.test(
        mime,
      )
    ) {
      return true;
    }
  }
  return /\.(txt|md|markdown|json|js|ts|tsx|jsx|css|html|htm|xml|yml|yaml|toml|py|rs|go|java|c|h|cpp|hpp|cs|rb|php|sh|bash|zsh|sql|csv|svg|env|gitignore|dockerfile|makefile)$/i.test(
    name,
  );
}
