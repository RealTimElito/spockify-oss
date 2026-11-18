export type {
  ApplyPatchFile,
  ApplyPatchRequest,
  ApplyResult,
  ApplyService,
  ApplyServiceOptions,
  DiffHunk,
  DiffPreview,
  FileDiffPreview,
  HunkId,
} from './types';

export {
  parsePatchText,
  parseFencedFilePatches,
  parseUnifiedDiffText,
  parseBareUnifiedDiff,
  mergePatchFiles,
  normalizeFencePath,
} from './parse';

export {
  buildUnifiedDiff,
  buildFileDiffPreview,
  hunkId,
  parseHunksFromUnifiedDiff,
} from './diff';

export {
  collapseUnifiedDiff,
  collapseUnifiedDiffLines,
} from './collapsedDiff';

export { findChangedLineSpan } from './lineSpan';
export { tryApplyRangedEdit } from './rangedEdit';

export {
  applyHunksToContent,
  listHunkIds,
} from './hunks';

export {
  createApplyService,
  getApplyService,
  registerApplyCommands,
} from './serviceImpl';

export {
  notifyApplySuccess,
  refreshApplyUndoContext,
} from './ux';

export {
  openDiffReviewPanel,
  registerDiffReview,
} from './review/diffReview';
export type { DiffReviewOptions } from './review/diffReview';

export {
  registerInlineFileReview,
  stageInlineFileReview,
  clearInlineFileReview,
  hasInlineReviews,
  listInlineReviewPaths,
} from './review/inlineReview';
