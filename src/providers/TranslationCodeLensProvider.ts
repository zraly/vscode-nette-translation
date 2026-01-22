import * as vscode from 'vscode';

export class TranslationCodeLensProvider implements vscode.CodeLensProvider {

    /**
     * Extract parameter names from Latte translation array syntax
     * e.g. "['ip' => $domain->dnsRecordA, 'name' => $user]" => ['ip', 'name']
     */
    private extractParams(paramsString: string): string[] {
        const params: string[] = [];
        // Match 'paramName' => or "paramName" => patterns
        const paramRegex = /['"](\w+)['"]\s*=>/g;
        let paramMatch;
        while ((paramMatch = paramRegex.exec(paramsString)) !== null) {
            params.push(paramMatch[1]);
        }
        return params;
    }

    public provideCodeLenses(document: vscode.TextDocument, token: vscode.CancellationToken): vscode.CodeLens[] | Thenable<vscode.CodeLens[]> {
        const codeLenses: vscode.CodeLens[] = [];
        const text = document.getText();

        // Match {_key} or {_//key} (absolute) or {_'key'} or {_"key"} with optional parameters and filters
        // Examples:
        //   {_key}
        //   {_'key'}
        //   {_key, ['param' => $value]}
        //   {_key, ['param' => $value]|filter}
        //   {_//absoluteKey}
        const regex = /\{_\/{0,2}['\"]?([\w\.]+)['\"]?(?:,\s*(\[[^\]]*\]))?(?:\|[^}]+)?\}/g;

        let match;
        while ((match = regex.exec(text)) !== null) {
            const startPos = document.positionAt(match.index);
            const endPos = document.positionAt(match.index + match[0].length);
            const range = new vscode.Range(startPos, endPos);

            // Check if this is an absolute key (starts with //)
            const fullMatch = match[0];
            const isAbsolute = fullMatch.includes('{_//');
            
            // Extract parameters if present
            const paramsString = match[2] || '';
            const params = this.extractParams(paramsString);

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
                title: params.length > 0 ? `Edit Translation (${params.map(p => '%' + p + '%').join(', ')})` : 'Edit Translation',
                tooltip: params.length > 0 ? `Edit translation with params: ${params.join(', ')}` : 'Edit this translation key',
                command: 'netteTranslations.edit',
                arguments: [fullKey, params]
            };

            codeLenses.push(new vscode.CodeLens(range, command));
        }

        return codeLenses;
    }
}
