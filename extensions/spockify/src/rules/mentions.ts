/**
 * Parse @file / @selection / @codebase / @folder mentions from chat text.
 */

export type MentionKind =
  | 'file'
  | 'selection'
  | 'codebase'
  | 'folder'
  | 'web'
  | 'docs'
  | 'terminal';

export interface ParsedMentions {
  kinds: Set<MentionKind>;
  /** Workspace-relative paths from @file path or bare @path/to/file. */
  filePaths: string[];
  /** Folder prefixes from @folder path. */
  folderPaths: string[];
  /** User text with @tokens stripped — better retrieval query. */
  cleanQuery: string;
}

const FILE_MENTION =
  /@(?:file\s+)?((?:[\w.-]+\/)+[\w.-]+\.[a-zA-Z0-9]+|[\w.-]+\.[a-zA-Z0-9]+)/g;
const FOLDER_MENTION = /@folder\s+([\w./-]+)/gi;
const WEB_MENTION = /@web(?:\s+([^\n@]+))?/gi;
const DOCS_MENTION = /@docs(?:\s+([^\n@]+))?/gi;
const KIND_TOKEN = /@(file|selection|codebase|folder|web|docs|terminal)\b/gi;

export function parseMentions(text: string): ParsedMentions {
  const kinds = new Set<MentionKind>();
  const filePaths: string[] = [];
  const folderPaths: string[] = [];
  let webQuery = '';
  let docsQuery = '';

  let m: RegExpExecArray | null;
  const webRe = new RegExp(WEB_MENTION.source, 'gi');
  while ((m = webRe.exec(text)) !== null) {
    kinds.add('web');
    const tail = (m[1] || '').trim();
    if (tail) webQuery = tail;
  }
  const docsRe = new RegExp(DOCS_MENTION.source, 'gi');
  while ((m = docsRe.exec(text)) !== null) {
    kinds.add('docs');
    const tail = (m[1] || '').trim();
    if (tail) docsQuery = tail;
  }

  const folderRe = new RegExp(FOLDER_MENTION.source, 'gi');
  while ((m = folderRe.exec(text)) !== null) {
    kinds.add('folder');
    folderPaths.push(m[1].replace(/^\.\//, '').replace(/\/$/, ''));
  }

  const fileRe = new RegExp(FILE_MENTION.source, 'g');
  while ((m = fileRe.exec(text)) !== null) {
    kinds.add('file');
    const p = m[1].replace(/^\.\//, '');
    if (!filePaths.includes(p)) filePaths.push(p);
  }

  const kindRe = new RegExp(KIND_TOKEN.source, 'gi');
  while ((m = kindRe.exec(text)) !== null) {
    const k = m[1].toLowerCase() as MentionKind;
    kinds.add(k);
  }

  let cleanQuery = text
    .replace(FOLDER_MENTION, ' ')
    .replace(FILE_MENTION, ' ')
    .replace(WEB_MENTION, ' ')
    .replace(DOCS_MENTION, ' ')
    .replace(KIND_TOKEN, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleanQuery) cleanQuery = text.trim();
  if (webQuery && !cleanQuery) cleanQuery = webQuery;
  if (docsQuery && kinds.has('docs')) {
    cleanQuery = docsQuery || cleanQuery;
  }

  return { kinds, filePaths, folderPaths, cleanQuery };
}
