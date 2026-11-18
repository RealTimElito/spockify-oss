import * as vscode from 'vscode';
import { getCodebaseProvider } from './provider';

export type { CodebaseContextProvider, CodebaseHit, CodebaseQuery } from './types';

export interface RegisterCodebaseOptions {
  output?: vscode.OutputChannel;
}

/**
 * Registers codebase index commands, save debounce, and exposes the provider singleton.
 */
export function registerCodebase(
  context: vscode.ExtensionContext,
  options: RegisterCodebaseOptions = {},
): import('./provider').WorkspaceCodebaseProvider {
  const output =
    options.output ??
    vscode.window.createOutputChannel('Spockify Codebase');
  if (!options.output) {
    context.subscriptions.push(output);
  }

  const provider = getCodebaseProvider(context, output);
  const cfg = () => vscode.workspace.getConfiguration('spockify.codebase');

  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  const scheduleReindex = (doc: vscode.TextDocument): void => {
    if (!cfg().get<boolean>('reindexOnSave', true)) {
      return;
    }
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    const ms = cfg().get<number>('reindexDebounceMs', 1500);
    debounceTimer = setTimeout(() => {
      debounceTimer = undefined;
      void provider.onFileSaved(doc).catch((err) => {
        output.appendLine(`Codebase reindex failed: ${String(err)}`);
      });
    }, ms);
  };

  const startFolderIndex = (folder: vscode.Uri, reason: string): void => {
    if (!cfg().get<boolean>('indexOnStartup', true) && reason === 'startup') {
      return;
    }
    output.appendLine(`Codebase: ${reason} index for ${folder.fsPath}`);
    void provider.ensureIndex(folder).catch((err) => {
      output.appendLine(`Index failed (${reason}): ${String(err)}`);
    });
  };

  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((doc) => {
      scheduleReindex(doc);
    }),
    vscode.workspace.onDidChangeWorkspaceFolders((e) => {
      const folder = vscode.workspace.workspaceFolders?.[0];
      if (folder && (e.added.length || e.removed.length)) {
        startFolderIndex(folder.uri, 'workspace-change');
      }
    }),
    vscode.commands.registerCommand('spockify.codebase.reindex', async () => {
      const folder = vscode.workspace.workspaceFolders?.[0];
      if (!folder) {
        void vscode.window.showWarningMessage('Open a workspace folder to index.');
        return;
      }
      output.show(true);
      try {
        await provider.reindexRoot(folder.uri);
        const st = provider.getStatus();
        void vscode.window.showInformationMessage(
          `Spockify codebase indexed · ${st.chunks ?? 0} chunks · ${st.files ?? 0} files`,
        );
      } catch (err) {
        output.appendLine(`Reindex error: ${String(err)}`);
        void vscode.window.showErrorMessage(`Codebase reindex failed: ${String(err)}`);
      }
    }),
    vscode.commands.registerCommand('spockify.codebase.status', async () => {
      const st = provider.getStatus();
      let remoteHint = '';
      const folder = vscode.workspace.workspaceFolders?.[0];
      if (folder && cfg().get<boolean>('remoteIndexMeta', true)) {
        try {
          const { fingerprintIndex, workspaceKeyFromUri } = await import(
            './remoteMeta'
          );
          const idx = provider.getIndex(folder.uri);
          if (idx) {
            remoteHint = ` · fp=${fingerprintIndex(idx).slice(0, 12)}… · key=${workspaceKeyFromUri(folder.uri).slice(0, 8)}…`;
          }
        } catch {
          /* ignore */
        }
      }
      const progress =
        st.status === 'indexing' && st.filesIndexed != null
          ? ` · indexing ${st.filesIndexed} files${st.progressPath ? ` (${st.progressPath})` : ''}`
          : st.files != null
            ? ` · ${st.files} files`
            : '';
      void vscode.window.showInformationMessage(
        `Codebase index: ${st.status}${st.chunks != null ? ` · ${st.chunks} chunks` : ''}${progress}${st.embedModel ? ` · ${st.embedModel}` : ''}${st.lanceBackend ? ` · lance=${st.lanceBackend}` : ''}${st.lanceAnn && st.lanceAnn !== 'none' ? `/${st.lanceAnn}` : ''}${remoteHint}${st.error ? ` · ${st.error}` : ''}`,
      );
    }),
    vscode.commands.registerCommand('spockify.codebase.configure', async () => {
      const presets = [
        {
          label: 'Balanced (default)',
          description: '60-line chunks · 8 overlap',
          chunkMaxLines: 60,
          chunkOverlapLines: 8,
          searchTopK: 10,
        },
        {
          label: 'Deep index (smaller chunks)',
          description: '40-line chunks · 12 overlap · top 16',
          chunkMaxLines: 40,
          chunkOverlapLines: 12,
          searchTopK: 16,
        },
        {
          label: 'Fast index (larger chunks)',
          description: '100-line chunks · 6 overlap',
          chunkMaxLines: 100,
          chunkOverlapLines: 6,
          searchTopK: 8,
        },
      ];
      const pick = await vscode.window.showQuickPick(
        presets.map((p) => ({
          label: p.label,
          description: p.description,
          preset: p,
        })),
        { title: 'Codebase indexing depth' },
      );
      if (!pick) return;
      const target = vscode.ConfigurationTarget.Workspace;
      const c = vscode.workspace.getConfiguration('spockify.codebase');
      await c.update('chunkMaxLines', pick.preset.chunkMaxLines, target);
      await c.update('chunkOverlapLines', pick.preset.chunkOverlapLines, target);
      await c.update('searchTopK', pick.preset.searchTopK, target);
      const reindex = await vscode.window.showInformationMessage(
        'Indexing preset saved. Reindex workspace now?',
        'Reindex',
        'Later',
      );
      if (reindex === 'Reindex') {
        await vscode.commands.executeCommand('spockify.codebase.reindex');
      }
    }),
    vscode.commands.registerCommand('spockify.codebase.search', async () => {
      const folder = vscode.workspace.workspaceFolders?.[0];
      if (!folder) {
        void vscode.window.showWarningMessage('Open a workspace folder to search.');
        return;
      }
      const query = await vscode.window.showInputBox({
        title: 'Spockify codebase search',
        prompt: 'Query (BM25 / hybrid over indexed chunks)',
        placeHolder: 'e.g. authentication middleware',
      });
      if (!query?.trim()) {
        return;
      }
      output.show(true);
      output.appendLine(`--- search: ${query.trim()} ---`);
      try {
        const k = cfg().get<number>('searchTopK', 10);
        const hits = await provider.search({ query: query.trim(), k });
        if (hits.length === 0) {
          output.appendLine('(no hits — try Spockify: Reindex Codebase)');
        }
        for (const h of hits) {
          output.appendLine(
            `[${h.score.toFixed(3)}] ${h.path}:${h.startLine}-${h.endLine}`,
          );
          const preview = h.text.split('\n').slice(0, 6).join('\n');
          output.appendLine(preview);
          output.appendLine('');
        }
      } catch (err) {
        output.appendLine(`Search error: ${String(err)}`);
      }
    }),
  );

  const folder = vscode.workspace.workspaceFolders?.[0];
  if (folder) {
    startFolderIndex(folder.uri, 'startup');
  }

  return provider;
}
