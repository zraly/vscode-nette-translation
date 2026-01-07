import * as vscode from 'vscode';
import { NeonHandler } from '../utils/NeonHandler';
import { Translator } from '../utils/Translator';

export class TranslationPanel {
    public static currentPanel: TranslationPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];

    public static createOrShow(extensionUri: vscode.Uri, key: string) {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        if (TranslationPanel.currentPanel) {
            TranslationPanel.currentPanel._panel.reveal(column);
            TranslationPanel.currentPanel.loadData(key);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'netteTranslation',
            'Edit Translation',
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')]
            }
        );

        TranslationPanel.currentPanel = new TranslationPanel(panel, extensionUri);
        TranslationPanel.currentPanel.loadData(key);
    }

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
        this._panel = panel;
        this._extensionUri = extensionUri;

        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        this._panel.webview.onDidReceiveMessage(
            async message => {
                switch (message.command) {
                    case 'save':
                        await this.saveTranslations(message.translations);
                        vscode.window.showInformationMessage('Translations saved!');
                        this._panel.dispose(); // Close the panel
                        return;
                    case 'translate':
                        console.log('[TranslationPanel] Received translate message:', message);
                        const sourceText = message.text;
                        const sourceLang = message.sourceLang;
                        const targetLangs = message.targetLangs;
                        console.log('[TranslationPanel] Calling handleTranslate with:', sourceText, sourceLang, targetLangs);
                        this.handleTranslate(sourceText, sourceLang, targetLangs);
                        return;
                    case 'close':
                        this._panel.dispose();
                        return;
                }
            },
            null,
            this._disposables
        );
    }

    public async loadData(key: string) {
        console.log('[TranslationPanel] loadData called with key:', key);

        // Load existing translations
        const config = vscode.workspace.getConfiguration('netteTranslations');
        const neonPath = config.get<string>('neonPath') || 'app';
        console.log('[TranslationPanel] neonPath:', neonPath);
        console.log('[TranslationPanel] Workspace folders:', vscode.workspace.workspaceFolders?.map(f => f.uri.path));

        // Construct glob pattern: path + /**/*.neon
        // Ensure we handle relative paths correctly
        const relativePattern = new vscode.RelativePattern(vscode.workspace.workspaceFolders?.[0] || '.', `${neonPath}/**/*.neon`);
        console.log('[TranslationPanel] Searching with pattern:', `${neonPath}/**/*.neon`);

        // Exclude vendor and node_modules
        const allFiles = await vscode.workspace.findFiles(relativePattern, '**/{node_modules,vendor,temp,log}/**');
        console.log('[TranslationPanel] All files found:', allFiles.length, allFiles.map(f => f.path));

        // Filter files by domain (first part of the key)
        // key: "admin.dashboard.title" -> domain: "admin"
        // files: "admin.cs_CZ.neon" (MATCH), "front.cs_CZ.neon" (SKIP)
        const domain = key.split('.')[0];
        console.log('[TranslationPanel] Domain:', domain);

        const files = allFiles.filter(file => {
            const fileName = file.path.split('/').pop() || '';
            // Check if file starts with "domain." or is exactly "domain.neon"
            return fileName.startsWith(`${domain}.`) || fileName === `${domain}.neon`;
        });
        console.log('[TranslationPanel] Filtered files:', files.length, files.map(f => f.path));

        const translations: any[] = [];

        for (const file of files) {
            const keyLoc = await NeonHandler.findKeyDefinition(key, [file]);
            let value = '';
            let lang = 'unknown';

            // Guess lang from filename (e.g. admin.cs.neon -> cs, cs.neon -> cs)
            const basename = file.path.split('/').pop() || '';
            const parts = basename.split('.');
            if (parts.length >= 2 && parts[parts.length - 1] === 'neon') {
                lang = parts[parts.length - 2];
            }

            if (keyLoc) {
                const doc = await vscode.workspace.openTextDocument(file);
                const line = doc.lineAt(keyLoc.range.start.line).text;
                console.log('[TranslationPanel] Extracting from line:', line);

                // Extract value after : or = (handles quoted and unquoted)
                const colonIdx = line.indexOf(':');
                const eqIdx = line.indexOf('=');
                const sepIdx = colonIdx >= 0 ? (eqIdx >= 0 ? Math.min(colonIdx, eqIdx) : colonIdx) : eqIdx;

                if (sepIdx >= 0) {
                    let rawValue = line.substring(sepIdx + 1).trim();
                    // Remove surrounding quotes if present
                    if ((rawValue.startsWith('"') && rawValue.endsWith('"')) ||
                        (rawValue.startsWith("'") && rawValue.endsWith("'"))) {
                        rawValue = rawValue.slice(1, -1);
                    }
                    value = rawValue;
                    console.log('[TranslationPanel] Extracted value:', value);
                }
            }

            translations.push({
                file: file.toString(),
                lang: lang,
                value: value
            });
        }

        // Store for save operation
        this._currentKey = key;
        this._translationsData = translations;

        this._panel.webview.html = this._getWebviewContent(key, translations);
    }

    private _currentKey: string = '';
    private _translationsData: any[] = [];

    private async saveTranslations(translations: { [lang: string]: string }) {
        // translations is {lang: value, ...}
        // We need to map lang back to the file URI using _translationsData
        for (const [lang, value] of Object.entries(translations)) {
            if (value && value.trim()) {
                const match = this._translationsData.find(t => t.lang === lang);
                if (match) {
                    const uri = vscode.Uri.parse(match.file);
                    await NeonHandler.setValue(uri, this._currentKey, value);
                }
            }
        }
    }

    private async autoTranslate(data: { key: string, sourceLang: string, sourceValue: string, targetLangs: string[] }) {
        // This method is no longer used directly, its logic has been moved to handleTranslate
        // and the message handling updated.
    }

    public dispose() {
        TranslationPanel.currentPanel = undefined;
        this._panel.dispose();
        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) {
                x.dispose();
            }
        }
    }

    private async handleTranslate(sourceText: string, sourceLang: string, targetLangs: string[]) {
        console.log('[TranslationPanel] handleTranslate called');
        const config = vscode.workspace.getConfiguration('netteTranslations');
        const apiKey = config.get<string>('apiKey');
        console.log('[TranslationPanel] API Key present:', !!apiKey);

        if (!apiKey) {
            vscode.window.showErrorMessage('API Key for auto-translation is missing. Please check settings.');
            return;
        }

        try {
            console.log('[TranslationPanel] Calling Translator...');
            const translator = new Translator(apiKey);
            const translations = await translator.translate(sourceText, sourceLang, targetLangs);
            console.log('[TranslationPanel] Got translations:', translations);
            this._panel.webview.postMessage({ command: 'translationResult', data: translations });
        } catch (e) {
            console.log('[TranslationPanel] Translation error:', e);
            vscode.window.showErrorMessage('Auto-translation failed.');
        }
    }


    private getNonce() {
        let text = '';
        const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        for (let i = 0; i < 32; i++) {
            text += possible.charAt(Math.floor(Math.random() * possible.length));
        }
        return text;
    }

    private _getWebviewContent(key: string, translations: any[]) {
        const nonce = this.getNonce();

        // Generate HTML for inputs
        // Layout: Grid with 2 columns: [Input (grow)] [Action Button (fixed)]
        const inputsHtml = translations.map(t => {
            const isPopulated = t.value && t.value.trim().length > 0;
            return `
            <div class="field-container" data-lang="${t.lang}">
                <label>${t.lang.toUpperCase()}</label>
                <div class="input-group">
                    <textarea 
                        id="input-${t.lang}" 
                        class="translation-input" 
                        data-lang="${t.lang}"
                        rows="1"
                        placeholder="Empty...">${t.value || ''}</textarea>
                    <button 
                        class="translate-btn" 
                        data-lang="${t.lang}"
                        title="Translate to other languages"
                        ${isPopulated ? '' : 'disabled'}
                    >
                        ✨
                    </button>
                </div>
                <div id="badge-${t.lang}" class="badge hidden">Translated</div>
            </div>
            `;
        }).join('');

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Edit Translation</title>
    <style>
        :root {
            --background: var(--vscode-editor-background);
            --foreground: var(--vscode-editor-foreground);
            --input-bg: var(--vscode-input-background);
            --input-fg: var(--vscode-input-foreground);
            --input-border: var(--vscode-input-border);
            --button-bg: var(--vscode-button-background);
            --button-fg: var(--vscode-button-foreground);
            --button-hover: var(--vscode-button-hoverBackground);
            --focus-border: var(--vscode-focusBorder);
        }
        body {
            background-color: var(--background);
            color: var(--foreground);
            padding: 20px;
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
        }
        h2 {
            margin-bottom: 20px;
            font-weight: 500;
        }
        .header-key {
            font-family: monospace;
            background: var(--input-bg);
            padding: 4px 8px;
            border-radius: 4px;
        }
        .container {
            display: flex;
            flex-direction: column;
            gap: 16px;
            max-width: 800px;
            margin: 0 auto;
        }
        .field-container {
            display: flex;
            flex-direction: column;
            gap: 6px;
            position: relative;
        }
        label {
            font-size: 0.85em;
            opacity: 0.8;
            font-weight: 600;
        }
        .input-group {
            display: flex;
            gap: 8px;
            align-items: flex-start;
        }
        textarea.translation-input {
            flex-grow: 1;
            background: var(--input-bg);
            color: var(--input-fg);
            border: 1px solid var(--input-border);
            padding: 8px;
            border-radius: 2px;
            resize: none;
            min-height: 32px;
            font-family: inherit;
        }
        textarea.translation-input:focus {
            outline: 1px solid var(--focus-border);
            border-color: var(--focus-border);
        }
        button.translate-btn {
            background: transparent;
            border: 1px solid var(--input-border);
            color: var(--foreground);
            cursor: pointer;
            padding: 8px;
            border-radius: 2px;
            display: flex;
            align-items: center;
            justify-content: center;
            width: 36px;
            height: 36px;
            transition: all 0.2s;
        }
        button.translate-btn:hover:not(:disabled) {
            background: var(--button-bg);
            color: var(--button-fg);
            border-color: var(--button-bg);
        }
        button.translate-btn:disabled {
            opacity: 0.3;
            cursor: not-allowed;
            border-color: transparent;
        }
        .actions {
            margin-top: 24px;
            display: flex;
            justify-content: flex-end;
            gap: 12px;
        }
        .btn-primary {
            background: var(--button-bg);
            color: var(--button-fg);
            border: none;
            padding: 8px 16px;
            cursor: pointer;
            border-radius: 2px;
            font-weight: 500;
        }
        .btn-primary:hover {
            background: var(--button-hover);
        }
        .badge {
            position: absolute;
            top: 0;
            right: 0;
            background: #2096f3;
            color: white;
            font-size: 0.7em;
            padding: 2px 6px;
            border-radius: 10px;
            pointer-events: none;
        }
        .hidden { display: none; }
        
        /* Loading Overlay */
        #loader {
            position: fixed;
            top: 0; left: 0; right: 0; bottom: 0;
            background: rgba(0,0,0,0.5);
            display: none; /* Hidden by default */
            justify-content: center;
            align-items: center;
            z-index: 100;
            color: white;
            font-size: 1.2em;
        }
        #loader.visible {
            display: flex;
        }
        .header-container {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 20px;
        }
        .close-btn {
            background: transparent;
            border: 1px solid transparent;
            color: var(--foreground);
            cursor: pointer;
            padding: 8px;
            font-size: 1.2em;
            line-height: 1;
            border-radius: 4px;
        }
        .close-btn:hover {
            background: var(--button-bg);
            color: var(--button-fg);
        }
        .btn-secondary {
            background: transparent;
            color: var(--foreground);
            border: 1px solid var(--input-border);
            padding: 8px 16px;
            cursor: pointer;
            border-radius: 2px;
            font-weight: 500;
        }
        .btn-secondary:hover {
            background: var(--input-bg);
            border-color: var(--focus-border);
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header-container">
            <h2 style="margin:0">Refining Translation: <span class="header-key">${key}</span></h2>
            <button class="close-btn" id="header-close-btn" title="Close">✕</button>
        </div>
        
        ${inputsHtml}

        <div class="actions">
            <button class="btn-secondary" id="cancel-btn">Cancel</button>
            <button class="btn-primary" id="save-btn">Save Changes</button>
        </div>
    </div>
    
    <div id="loader" class="hidden">Translating...</div>

    <script nonce="${nonce}">
        const vscode = acquireVsCodeApi();

        function adjustHeight(el) {
            el.style.height = 'auto';
            el.style.height = (el.scrollHeight) + 'px';
        }

        // Initialize heights
        document.querySelectorAll('textarea').forEach(adjustHeight);

        function updateState(lang) {
            const input = document.getElementById('input-' + lang);
            const btn = input.parentElement.querySelector('.translate-btn');
            if (input.value.trim().length > 0) {
                btn.removeAttribute('disabled');
            } else {
                btn.setAttribute('disabled', 'true');
            }
        }

        function closePanel() {
            vscode.postMessage({ command: 'close' });
        }

        function saveAll() {
            const inputs = document.querySelectorAll('.translation-input');
            const data = {};
            inputs.forEach(input => {
                const lang = input.id.replace('input-', '');
                data[lang] = input.value;
            });
            vscode.postMessage({ command: 'save', translations: data });
        }

        function triggerTranslate(sourceLang) {
            console.log('[Webview] triggerTranslate called with:', sourceLang);
            const sourceText = document.getElementById('input-' + sourceLang).value;
            console.log('[Webview] sourceText:', sourceText);
            if (!sourceText) {
                console.log('[Webview] No source text, returning');
                return;
            }

            // Find target languages (empty fields)
            const inputs = document.querySelectorAll('.translation-input');
            const targetLangs = [];
            
            inputs.forEach(input => {
                const lang = input.id.replace('input-', '');
                if (lang !== sourceLang && (!input.value || input.value.trim() === '')) {
                    targetLangs.push(lang);
                }
            });

            console.log('[Webview] targetLangs:', targetLangs);

            if (targetLangs.length === 0) {
                console.log('[Webview] No target langs, returning');
                return; // Nothing to translate
            }

            // Show loader
            document.getElementById('loader').classList.add('visible');

            console.log('[Webview] Posting message to extension...');
            vscode.postMessage({
                command: 'translate',
                text: sourceText,
                sourceLang: sourceLang,
                targetLangs: targetLangs
            });
        }

        // Handle messages from extension
        window.addEventListener('message', event => {
            const message = event.data;
            if (message.command === 'translationResult') {
                const results = message.data; // [{lang, value}]
                results.forEach(item => {
                    const input = document.getElementById('input-' + item.lang);
                    if (input) {
                        input.value = item.value;
                        adjustHeight(input);
                        updateState(item.lang);
                        
                        // Show badge
                        const badge = document.getElementById('badge-' + item.lang);
                        if (badge) badge.classList.remove('hidden');
                    }
                });
                document.getElementById('loader').classList.remove('visible');
            }
        });

        // Attach event listeners programmatically (CSP-compliant)
        document.getElementById('save-btn').addEventListener('click', saveAll);
        document.getElementById('cancel-btn').addEventListener('click', closePanel);
        document.getElementById('header-close-btn').addEventListener('click', closePanel);

        document.querySelectorAll('.translation-input').forEach(textarea => {
            textarea.addEventListener('input', function() {
                adjustHeight(this);
                updateState(this.dataset.lang);
            });
        });

        document.querySelectorAll('.translate-btn').forEach(btn => {
            btn.addEventListener('click', function() {
                triggerTranslate(this.dataset.lang);
            });
        });
    </script>
</body>
</html>`;
    }
}
