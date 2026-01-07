import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export class NeonHandler {

    /**
     * Finds the location of a key in a NEON file.
     * Supports dot notation: section.key
     */
    public static async findKeyDefinition(key: string, files: vscode.Uri[]): Promise<vscode.Location | null> {
        console.log(`NeonHandler: Looking for key ${key} in ${files.length} files`);

        // 1. Try Strict Match
        for (const file of files) {
            const document = await vscode.workspace.openTextDocument(file);

            // Strip domain prefix if it matches the filename
            // e.g., key "admin.contacts.title" in file "admin.en_US.neon" -> search for "contacts.title"
            const fileName = file.path.split('/').pop() || '';
            const domain = fileName.split('.')[0];
            let searchKey = key;
            if (key.startsWith(domain + '.')) {
                searchKey = key.substring(domain.length + 1);
                console.log(`NeonHandler: Stripped domain '${domain}' from key, searching for: ${searchKey}`);
            }

            const keyParts = searchKey.split('.');
            const line = this.findKeyLine(document, keyParts, true);
            if (line !== -1) {
                console.log(`NeonHandler: Found strict match in ${file.path} at line ${line}`);
                return new vscode.Location(file, new vscode.Position(line, 0));
            }
        }

        console.log('NeonHandler: Key not found in any file');
        return null;
    }

    private static findLeafKeyLine(document: vscode.TextDocument, leafKey: string): number {
        const lines = document.getText().split('\n');
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            // Match key at start of line (ignoring indentation which is already trimmed)
            // Support quotes
            const match = line.match(/^(['"]?)([\w\.-]+)\1\s*[:=]/);
            if (match) {
                if (match[2] === leafKey) {
                    return i;
                }
            }
        }
        return -1;
    }

    private static findKeyLine(document: vscode.TextDocument, keyParts: string[], strict: boolean): number {
        const lines = document.getText().split('\n');
        const keyStack: { key: string, indent: number }[] = [];

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line.trim();

            if (!trimmed || trimmed.startsWith('#')) {
                continue;
            }

            const indent = line.search(/\S/);
            const content = trimmed;

            // Extract key from line (basic assumption: key: value)
            // Matches "key:" or "key: value" or "'key': value"
            const match = content.match(/^(['"]?)([\w\.-]+)\1\s*[:=]/);
            if (!match) {
                // Log strictly interesting lines that we missed
                if (content.includes(':') || content.includes('=')) {
                    console.log(`NeonHandler: Line skipped (regex mismatch): ${content}`);
                }
                continue;
            }

            const currentKey = match[2]; // match[2] is the key capture group

            // Adjust stack based on indentation
            while (keyStack.length > 0 && keyStack[keyStack.length - 1].indent >= indent) {
                keyStack.pop();
            }

            keyStack.push({ key: currentKey, indent });

            // Check if current stack matches defined keyParts
            if (this.matchesStack(keyStack, keyParts)) {
                return i;
            }
        }

        return -1;
    }

    private static matchesStack(stack: { key: string, indent: number }[], keyParts: string[]): boolean {
        // This is a simplified check. It assumes the stack represents the exact path.
        // In reality, the stack contains every nested level we are currently "in".
        // We only care if the *relevant* parts of the stack match our key parts.

        // However, a simple equivalence check of the stack keys vs keyParts is a good heuristic 
        // if the file structure mirrors the key structure exactly.

        if (stack.length !== keyParts.length) {
            return false;
        }

        for (let i = 0; i < stack.length; i++) {
            if (stack[i].key !== keyParts[i]) {
                return false;
            }
        }
        return true;
    }

    public static async setValue(fileUri: vscode.Uri, key: string, value: string): Promise<void> {
        const document = await vscode.workspace.openTextDocument(fileUri);

        // Determine domain from filename to strip it from key
        // e.g. "admin.cs_CZ.neon" -> domain "admin"
        const fileName = fileUri.path.split('/').pop() || '';
        const domain = fileName.split('.')[0];

        let targetKey = key;
        if (key.startsWith(domain + '.')) {
            targetKey = key.substring(domain.length + 1);
        }

        const keyParts = targetKey.split('.');
        // setValue should strictly update the correct key if possible
        const lineIndex = this.findKeyLine(document, keyParts, true);

        const edit = new vscode.WorkspaceEdit();

        if (lineIndex !== -1) {
            // Update existing line
            const line = document.lineAt(lineIndex);
            // Regex to find value part: key: value OR key=value
            // Preserve indentation and key
            const text = line.text;
            const match = text.match(/^([\s\w\.-]+[:=]\s*)(.*)$/);
            if (match) {
                // match[1] is "  key: "
                // Replace match[2] with new quote value
                // Handle standard quoting for neon if needed (simple quotes for now)
                const newValue = `"${value}"`;
                const newText = match[1] + newValue;
                edit.replace(fileUri, line.range, newText);
            }
        } else {

            // Simplest valid NEON for Nette: "one.two.three: value" is valid if Nette is configured well? 
            // Actually Nette NEON usually prefers proper nesting. 
            // BUT writing "a.b: c" at top level is valid in NEON and results in array('a' => array('b' => 'c')).
            // So we can perform a safe hack: append "full.key: 'value'" to the end.

            const position = new vscode.Position(document.lineCount, 0);
            const content = `\n${key}: "${value}"`;
            edit.insert(fileUri, position, content);
        }

        await vscode.workspace.applyEdit(edit);
        await document.save();
    }

    private static isKeyMatch(lineContent: string, key: string): boolean {
        // Matches "key:" or "key =" or "key:"
        // Also handles headers [key] if that was a thing (config files), but mostly translation files are hashes.
        return lineContent.startsWith(key + ':') || lineContent.startsWith(key + '=') || lineContent === key;
    }
}
