import * as vscode from 'vscode';
import { NeonHandler } from '../utils/NeonHandler';

export class TranslationDefinitionProvider implements vscode.DefinitionProvider {

    public async provideDefinition(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ): Promise<vscode.Definition | undefined> {
        console.log('TDP: provideDefinition called');

        // Regex to match {_key} or {_//key} (absolute) or {_'key'} or {_"key"}
        const range = document.getWordRangeAtPosition(position, /\{_\/{0,2}['\"]?[\w\.]+['\"]?(?:\|[^}]+)?\}/);
        if (!range) {
            console.log('TDP: No range matched');
            return undefined;
        }

        const text = document.getText(range);
        console.log(`TDP: matched text: ${text}`);

        // Extract key from {_key} or {_//key} or {_'key'}
        // Capture group 1: optional // (absolute marker)
        // Capture group 2: the key itself
        const match = text.match(/\{_(\/\/)?['\"]?([\w\.]+)['\"]?/);
        if (!match) {
            console.log('TDP: No key match in parsing');
            return undefined;
        }

        const isAbsolute = !!match[1]; // true if // was present
        let key = match[2];
        console.log(`TDP: extracted raw key: ${key}, isAbsolute: ${isAbsolute}`);

        // Check for surrounding {translator} macro (only if NOT absolute)
        let namespace = '';
        if (!isAbsolute) {
            let openTranslators = 0;

            for (let i = position.line; i >= 0; i--) {
                const lineText = document.lineAt(i).text;

                const closeMatches = lineText.match(/\{\/translator\}/g);
                if (closeMatches) {
                    openTranslators -= closeMatches.length;
                }

                // Fixed: Allow optional trailing space before }
                const openMatch = lineText.match(/\{translator\s+(['\"]?)([\w\.]+)\1\s*\}/);
                if (openMatch) {
                    openTranslators += 1;

                    if (openTranslators > 0) {
                        namespace = openMatch[2];
                        console.log(`TDP: Found translator namespace: ${namespace}`);
                        break;
                    }
                }
            }

            if (namespace) {
                key = `${namespace}.${key}`;
                console.log(`TDP: Full resolved key: ${key}`);
            }
        } else {
            console.log(`TDP: Absolute key, skipping namespace lookup`);
        }

        // Find NEON files
        const config = vscode.workspace.getConfiguration('netteTranslations');
        const neonPath = config.get<string>('neonPath') || 'app';
        const relativePattern = new vscode.RelativePattern(vscode.workspace.workspaceFolders?.[0] || '.', `${neonPath}/**/*.neon`);

        const allFiles = await vscode.workspace.findFiles(relativePattern, '**/{node_modules,vendor,temp,log}/**');

        // Filter files by domain
        const domain = key.split('.')[0];
        let files = allFiles.filter(file => {
            const fileName = file.path.split('/').pop() || '';
            return fileName.startsWith(`${domain}.`) || fileName === `${domain}.neon`;
        });

        // Prioritize default language
        const defaultLang = config.get<string>('defaultLanguage');
        if (defaultLang) {
            files = files.sort((a, b) => {
                const aName = a.path.split('/').pop() || '';
                const bName = b.path.split('/').pop() || '';
                const aHasLang = aName.includes(defaultLang);
                const bHasLang = bName.includes(defaultLang);
                if (aHasLang && !bHasLang) return -1;
                if (!aHasLang && bHasLang) return 1;
                return 0;
            });
        }

        console.log(`TDP: Found ${files.length} relevant neon files for domain '${domain}' in ${neonPath}`);
        files.forEach(f => console.log(`TDP: File: ${f.path}`));

        // Prioritize lang files
        const sortedFiles = files.sort((a, b) => {
            const aScore = a.path.includes('lang') ? 1 : 0;
            const bScore = b.path.includes('lang') ? 1 : 0;
            return bScore - aScore;
        });

        const location = await NeonHandler.findKeyDefinition(key, sortedFiles);
        if (location) {
            console.log(`TDP: Found location: ${location.uri.path}:${location.range.start.line}`);
        } else {
            console.log('TDP: Location not found via NeonHandler');
        }
        return location || undefined;
    }
}
