/**
 * Back-compat shim — prefer importing from `./rules` (WS-CLONE-H).
 */
export {
  loadProjectRules,
  getEffectiveRules,
  buildAtContext,
  parseMentions,
  resolveWebSection,
  captureEditorContext,
  editorAttachFlagsFromSnapshot,
  resolveEditorAttachFlags,
  type EditorContextSnapshot,
  writeUserRules,
  getMemories,
  addMemory,
  formatMemoriesForPrompt,
  registerRulesCommands,
} from './rules/index';
