/**
 * Proposed VS Code APIs enabled via package.json#enabledApiProposals (Spockify IDE).
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
