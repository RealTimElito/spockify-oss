export { registerCodebase } from './register';
export {
  getCodebaseProvider,
  tryGetCodebaseProvider,
  WorkspaceCodebaseProvider,
} from './provider';
export {
  shouldAttachCodebase,
  isAgentFamilyMode,
} from './attachPolicy';
export { retrieveCodebaseHitsForQuery } from './retrieveForChat';
export type { RetrievedCodebaseHit } from './retrieveForChat';
export {
  absPathToWorkspaceUri,
  createWorkspaceFs,
  relativeUnderFolder,
} from './workspaceFs';
export { normFsPath, relSegmentsUnderRoot } from './pathUtils';
export type {
  CodebaseContextProvider,
  CodebaseHit,
  CodebaseQuery,
} from './types';
