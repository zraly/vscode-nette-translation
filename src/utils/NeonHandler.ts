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
                const keyPart = match[1];
                const keyIndent = text.search(/\S/);
                const indentUnit = this.detectIndentUnit(document);
                
                // Check if value contains newlines - use triple quotes for multiline
                if (value.includes('\n')) {
                    // Delete old value (might be multiline)
                    const endLine = this.findValueEnd(document, lineIndex);
                    const rangeToReplace = new vscode.Range(
                        line.range.start,
                        document.lineAt(endLine).range.end
                    );
                    const multilineValue = this.formatMultilineValue(value, keyIndent, indentUnit);
                    edit.replace(fileUri, rangeToReplace, keyPart + multilineValue);
                } else {
                    // Single line - use simple quoted format
                    // But we still need to handle if old value was multiline
                    const endLine = this.findValueEnd(document, lineIndex);
                    const rangeToReplace = new vscode.Range(
                        line.range.start,
                        document.lineAt(endLine).range.end
                    );
                    const newValue = `"${this.escapeNeonValue(value)}"`;
                    edit.replace(fileUri, rangeToReplace, keyPart + newValue);
                }
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
                        if (value.includes('\n')) {
                            const valueIndent = indentLevel * indentUnit.length;
                            content += `\n${indent}${part}: ${this.formatMultilineValue(value, valueIndent, indentUnit)}`;
                        } else {
                            content += `\n${indent}${part}: "${this.escapeNeonValue(value)}"`;
                        }
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
                        if (value.includes('\n')) {
                            const valueIndent = i * indentUnit.length;
                            content += `${indent}${part}: ${this.formatMultilineValue(value, valueIndent, indentUnit)}`;
                        } else {
                            content += `${indent}${part}: "${this.escapeNeonValue(value)}"`;
                        }
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

    /**
     * Checks if a key exists in the given NEON file.
     * Used for duplicate validation before rename.
     */
    public static async keyExists(fileUri: vscode.Uri, key: string): Promise<boolean> {
        const document = await vscode.workspace.openTextDocument(fileUri);

        // Determine domain from filename to strip it from key
        const fileName = fileUri.path.split('/').pop() || '';
        const domain = fileName.split('.')[0];

        let targetKey = key;
        if (key.startsWith(domain + '.')) {
            targetKey = key.substring(domain.length + 1);
        }

        const keyParts = targetKey.split('.');
        const lineIndex = this.findKeyLine(document, keyParts, true);

        return lineIndex !== -1;
    }

    /**
     * Renames a key in the given NEON file.
     * Finds the line with oldKey and replaces the key portion with newKey.
     */
    public static async renameKey(fileUri: vscode.Uri, oldKey: string, newKey: string): Promise<void> {
        const document = await vscode.workspace.openTextDocument(fileUri);

        // Determine domain from filename to strip it from keys
        const fileName = fileUri.path.split('/').pop() || '';
        const domain = fileName.split('.')[0];

        let targetOldKey = oldKey;
        if (oldKey.startsWith(domain + '.')) {
            targetOldKey = oldKey.substring(domain.length + 1);
        }

        let targetNewKey = newKey;
        if (newKey.startsWith(domain + '.')) {
            targetNewKey = newKey.substring(domain.length + 1);
        }

        const oldKeyParts = targetOldKey.split('.');
        const newKeyParts = targetNewKey.split('.');

        // Find the line with the old key
        const lineIndex = this.findKeyLine(document, oldKeyParts, true);

        if (lineIndex === -1) {
            console.log(`NeonHandler.renameKey: Key '${oldKey}' not found in ${fileUri.path}`);
            return;
        }

        const line = document.lineAt(lineIndex);
        const text = line.text;

        // The leaf key is the last part of the key path
        const oldLeafKey = oldKeyParts[oldKeyParts.length - 1];
        const newLeafKey = newKeyParts[newKeyParts.length - 1];

        // Replace only the leaf key in the line
        // Regex to match the key at the start of the line (after optional whitespace and quotes)
        const keyRegex = new RegExp(`^(\\s*)(['"]?)${this.escapeRegex(oldLeafKey)}\\2(\\s*[:=])`);
        const match = text.match(keyRegex);

        if (!match) {
            console.log(`NeonHandler.renameKey: Could not match key pattern in line: ${text}`);
            return;
        }

        const newText = text.replace(keyRegex, `$1$2${newLeafKey}$2$3`);

        const edit = new vscode.WorkspaceEdit();
        edit.replace(fileUri, line.range, newText);

        await vscode.workspace.applyEdit(edit);
        await document.save();
    }

    /**
     * Escapes special regex characters in a string.
     */
    private static escapeRegex(str: string): string {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    /**
     * Escapes special characters in a NEON string value (for single-line strings).
     * Handles tabs, backslashes, and quotes. Newlines should use multiline format.
     */
    private static escapeNeonValue(value: string): string {
        return value
            .replace(/\\/g, '\\\\')  // Escape backslashes first
            .replace(/"/g, '\\"')    // Escape double quotes
            .replace(/\t/g, '\\t');  // Escape tabs
    }

    /**
     * Formats a multiline value using triple-quote NEON syntax.
     */
    private static formatMultilineValue(value: string, keyIndent: number, indentUnit: string): string {
        const contentIndent = indentUnit.repeat(Math.floor(keyIndent / indentUnit.length) + 1);
        const lines = value.split('\n');
        
        // Format: '''\n  line1\n  line2\n'''
        let result = "'''\n";
        for (const line of lines) {
            result += contentIndent + line + '\n';
        }
        result += contentIndent.slice(0, -indentUnit.length) + "'''"; // Closing quotes at key indent level
        
        return result;
    }

    /**
     * Finds the end line of a value (handles multiline strings).
     */
    private static findValueEnd(document: vscode.TextDocument, startLine: number): number {
        const lines = document.getText().split('\n');
        const firstLine = lines[startLine];
        
        // Check if value starts with triple quotes
        if (firstLine.includes("'''") || firstLine.includes('"""')) {
            const delimiter = firstLine.includes("'''") ? "'''" : '"""';
            // Count occurrences on first line
            const count = (firstLine.match(new RegExp(delimiter.replace(/'/g, "\\'"), 'g')) || []).length;
            
            if (count >= 2) {
                // Both opening and closing on same line
                return startLine;
            }
            
            // Find closing delimiter
            for (let i = startLine + 1; i < lines.length; i++) {
                if (lines[i].includes(delimiter)) {
                    return i;
                }
            }
        }
        
        return startLine;
    }
}

