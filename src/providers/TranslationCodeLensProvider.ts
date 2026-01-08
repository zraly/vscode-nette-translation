import * as vscode from 'vscode';

export class TranslationCodeLensProvider implements vscode.CodeLensProvider {

    public provideCodeLenses(document: vscode.TextDocument, token: vscode.CancellationToken): vscode.CodeLens[] | Thenable<vscode.CodeLens[]> {
        const codeLenses: vscode.CodeLens[] = [];
        const text = document.getText();

        // Match {_key} or {_//key} (absolute) or {_'key'} or {_"key"}
        const regex = /\{_\/{0,2}['\"]?([\w\.]+)['\"]?(?:\|[^}]+)?\}/g;

        let match;
        while ((match = regex.exec(text)) !== null) {
            const startPos = document.positionAt(match.index);
            const endPos = document.positionAt(match.index + match[0].length);
            const range = new vscode.Range(startPos, endPos);

            // Check if this is an absolute key (starts with //)
            const fullMatch = match[0];
            const isAbsolute = fullMatch.includes('{_//');

            let key = match[1];

            // Find namespace from {translator namespace} macro (only if NOT absolute)
            // Note: {snippet} macro breaks the translator context, so we must track snippet boundaries
            let namespace = '';
            if (!isAbsolute) {
                let openTranslators = 0;
                let openSnippets = 0;
                const limitLine = startPos.line;

                for (let i = limitLine; i >= 0; i--) {
                    const lineText = document.lineAt(i).text;

                    // Check for closing snippet tags - these mean we're exiting a snippet scope going backwards
                    const closeSnippetMatches = lineText.match(/\{\/snippet\}/g);
                    if (closeSnippetMatches) openSnippets -= closeSnippetMatches.length;

                    // Check for opening snippet tags {snippet ...} or n:snippet="..."
                    // If we hit an opening snippet tag while openSnippets > 0, we're inside a snippet
                    const openSnippetMatch = lineText.match(/\{snippet\s+\w+\s*\}/);
                    const nSnippetMatch = lineText.match(/n:snippet=/);
                    if (openSnippetMatch || nSnippetMatch) {
                        openSnippets += 1;
                        if (openSnippets > 0) {
                            // We're inside a snippet scope - translator context is broken
                            // Stop searching, namespace stays empty
                            break;
                        }
                    }

                    // Check for closing translator tags
                    const closeMatches = lineText.match(/\{\/translator\}/g);
                    if (closeMatches) openTranslators -= closeMatches.length;

                    // Check for opening translator tags (allow optional trailing space)
                    const openMatch = lineText.match(/\{translator\s+(['"]?)([\w\.]+)\1\s*\}/);
                    if (openMatch) {
                        openTranslators += 1;
                        if (openTranslators > 0) {
                            namespace = openMatch[2];
                            break;
                        }
                    }
                }
            }

            const fullKey = namespace ? `${namespace}.${key}` : key;

            const command: vscode.Command = {
                title: 'Edit Translation',
                tooltip: 'Edit this translation key',
                command: 'netteTranslations.edit',
                arguments: [fullKey]
            };

            codeLenses.push(new vscode.CodeLens(range, command));
        }

        return codeLenses;
    }
}
