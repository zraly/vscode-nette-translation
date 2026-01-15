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
            // Try to find the deepest existing parent key and insert nested under it
            const insertPosition = this.findInsertPosition(document, keyParts);

            if (insertPosition) {
                // Found a parent key - insert nested under it
                const { lineIndex: parentLine, depth, parentIndent } = insertPosition;
                const remainingParts = keyParts.slice(depth);

                // Determine indentation - use parent's indent + one level (typically 4 spaces or 1 tab)
                // Detect indentation style from the file
                const indentUnit = this.detectIndentUnit(document);

                // Build the nested structure for remaining parts
                let content = '';
                // Calculate parent's actual indent level from character position
                // e.g., if parentIndent is 0 and indentUnit is '\t', parent is at level 0
                // if parentIndent is 4 and indentUnit is '    ' (4 spaces), parent is at level 1
                const parentIndentLevel = indentUnit.length > 0 ? Math.floor(parentIndent / indentUnit.length) : 0;

                for (let i = 0; i < remainingParts.length; i++) {
                    const part = remainingParts[i];
                    // Child should be at parent level + 1, plus any intermediate nesting
                    const indentLevel = parentIndentLevel + 1 + i;
                    const indent = indentUnit.repeat(indentLevel);

                    if (i === remainingParts.length - 1) {
                        // Last part - add the value
                        content += `\n${indent}${part}: "${value}"`;
                    } else {
                        // Intermediate part - just the key
                        content += `\n${indent}${part}:`;
                    }
                }

                // Find the end of the parent section to insert after all its children
                const insertLine = this.findSectionEnd(document, parentLine, parentIndent);
                const position = new vscode.Position(insertLine, document.lineAt(insertLine).text.length);
                edit.insert(fileUri, position, content);
            } else {
                // No parent found - append at end with proper nesting from root
                let content = '\n';
                const indentUnit = this.detectIndentUnit(document);

                for (let i = 0; i < keyParts.length; i++) {
                    const part = keyParts[i];
                    // First level has no indent, subsequent levels get one indent unit per level
                    const indent = i === 0 ? '' : indentUnit.repeat(i);

                    if (i === keyParts.length - 1) {
                        content += `${indent}${part}: "${value}"`;
                    } else {
                        content += `${indent}${part}:\n`;
                    }
                }

                const position = new vscode.Position(document.lineCount, 0);
                edit.insert(fileUri, position, content);
            }
        }

        await vscode.workspace.applyEdit(edit);
        await document.save();
    }


    /**
     * Finds the deepest existing parent key in the document for the given key parts.
     * Returns the line index, depth (how many parts matched), and the parent's indentation.
     */
    private static findInsertPosition(document: vscode.TextDocument, keyParts: string[]): { lineIndex: number, depth: number, parentIndent: number } | null {
        const lines = document.getText().split('\n');
        const keyStack: { key: string, indent: number, line: number }[] = [];
        let bestMatch: { lineIndex: number, depth: number, parentIndent: number } | null = null;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line.trim();

            if (!trimmed || trimmed.startsWith('#')) {
                continue;
            }

            const indent = line.search(/\S/);
            const match = trimmed.match(/^(['"]?)([\w\.-]+)\1\s*[:=]/);
            if (!match) {
                continue;
            }

            const currentKey = match[2];

            // Adjust stack based on indentation
            while (keyStack.length > 0 && keyStack[keyStack.length - 1].indent >= indent) {
                keyStack.pop();
            }

            keyStack.push({ key: currentKey, indent, line: i });

            // Check how many parts of keyParts match the current stack
            let matchDepth = 0;
            for (let j = 0; j < Math.min(keyStack.length, keyParts.length); j++) {
                if (keyStack[j].key === keyParts[j]) {
                    matchDepth = j + 1;
                } else {
                    break;
                }
            }

            // If we found a deeper match than before, update bestMatch
            if (matchDepth > 0 && matchDepth < keyParts.length) {
                if (!bestMatch || matchDepth > bestMatch.depth) {
                    bestMatch = {
                        lineIndex: keyStack[matchDepth - 1].line,
                        depth: matchDepth,
                        parentIndent: keyStack[matchDepth - 1].indent
                    };
                }
            }
        }

        return bestMatch;
    }

    /**
     * Detects the indentation unit used in the document (spaces or tabs).
     * Returns the indentation string (e.g., "    " for 4 spaces or "\t" for tab).
     */
    private static detectIndentUnit(document: vscode.TextDocument): string {
        const lines = document.getText().split('\n');

        for (const line of lines) {
            const match = line.match(/^(\s+)\S/);
            if (match) {
                const whitespace = match[1];
                if (whitespace.includes('\t')) {
                    return '\t';
                }
                // Return the first indentation we find (could be 2, 4, etc. spaces)
                return whitespace;
            }
        }

        // Default to 4 spaces if no indentation found
        return '    ';
    }

    /**
     * Finds the last line of a section (where children of a parent key end).
     * Returns the line index where new content should be inserted after.
     * Properly handles multiline strings (""" or ''').
     */
    private static findSectionEnd(document: vscode.TextDocument, parentLine: number, parentIndent: number): number {
        const lines = document.getText().split('\n');
        let lastChildLine = parentLine;
        let inMultilineString = false;
        let multilineDelimiter = '';

        for (let i = parentLine + 1; i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line.trim();

            // Handle multiline string start/end
            if (inMultilineString) {
                // Check if this line ends the multiline string
                if (trimmed === multilineDelimiter || trimmed.endsWith(multilineDelimiter)) {
                    inMultilineString = false;
                    multilineDelimiter = '';
                }
                // Still inside multiline string, update lastChildLine and continue
                lastChildLine = i;
                continue;
            }

            // Check if a multiline string starts on this line
            // Multiline strings: key: """ or key: '''
            if (trimmed.endsWith('"""') || trimmed.endsWith("'''")) {
                const delimiter = trimmed.endsWith('"""') ? '"""' : "'''";
                // Check if it's both start and end on same line (unlikely but possible)
                const count = (trimmed.match(new RegExp(delimiter.replace(/'/g, "\\'"), 'g')) || []).length;
                if (count === 1) {
                    // Only one delimiter - multiline string starts
                    inMultilineString = true;
                    multilineDelimiter = delimiter;
                }
                lastChildLine = i;
                continue;
            }

            // Skip empty lines and comments
            if (!trimmed || trimmed.startsWith('#')) {
                continue;
            }

            const indent = line.search(/\S/);

            // If we find a line with same or less indentation, we've left the section
            if (indent <= parentIndent) {
                break;
            }

            // This line is a child of the parent
            lastChildLine = i;
        }

        return lastChildLine;
    }

    private static isKeyMatch(lineContent: string, key: string): boolean {
        // Matches "key:" or "key =" or "key:"
        // Also handles headers [key] if that was a thing (config files), but mostly translation files are hashes.
        return lineContent.startsWith(key + ':') || lineContent.startsWith(key + '=') || lineContent === key;
    }
}
