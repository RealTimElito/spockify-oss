/**
 * Proposed terminal APIs. The IDE product enables them for spockify.spockify.
 * The published VSIX does not declare enabledApiProposals; callers must check.
 */

declare module 'vscode' {
  export interface Terminal {
    readonly selection?: string | undefined;
  }

  export interface TerminalDataWriteEvent {
    readonly terminal: Terminal;
    readonly data: string;
  }

  namespace window {
    export const onDidWriteTerminalData: Event<TerminalDataWriteEvent>;
  }
}
