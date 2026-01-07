import * as vscode from 'vscode';
import { TranslationDefinitionProvider } from './providers/TranslationDefinitionProvider';
import { TranslationPanel } from './panels/TranslationPanel';
import { TranslationCodeLensProvider } from './providers/TranslationCodeLensProvider';

export function activate(context: vscode.ExtensionContext) {
    console.log('Nette Translation Helper is active!');

    const definitionProvider = vscode.languages.registerDefinitionProvider('latte', new TranslationDefinitionProvider());
    context.subscriptions.push(definitionProvider);

    const codeLensProvider = vscode.languages.registerCodeLensProvider('latte', new TranslationCodeLensProvider());
    context.subscriptions.push(codeLensProvider);

    let disposable = vscode.commands.registerCommand('netteTranslations.edit', (keyArg?: string) => {
        // Attempt to get key from cursor if available OR use keyArg
        let key = keyArg || '';

        if (!key) {
            const editor = vscode.window.activeTextEditor;
            if (editor) {
                // ... (logic to find key from cursor if NOT passed)
                const range = editor.document.getWordRangeAtPosition(editor.selection.active, /\{_['"]?[\w\.]+['"]?(?:\|[^}]+)?\}/);
                if (range) {
                    const text = editor.document.getText(range);
                    const match = text.match(/\{_['"]?([\w\.]+)['"]?/);
                    if (match) {
                        key = match[1];
                    }
                }
            }
        }

        if (key) {
            TranslationPanel.createOrShow(context.extensionUri, key);
        } else {
            vscode.window.showInformationMessage('No translation key found to edit.');
        }
    });

    context.subscriptions.push(disposable);
}

export function deactivate() { }
