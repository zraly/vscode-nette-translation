import OpenAI from 'openai';
import * as vscode from 'vscode';

export class Translator {
    private openai: OpenAI | undefined;

    constructor(apiKey: string) {
        if (!apiKey || apiKey.trim() === '') {
            throw new Error('API key is empty or invalid');
        }
        this.openai = new OpenAI({
            apiKey: apiKey,
        });
    }

    public async translate(text: string, sourceLang: string, targetLangs: string[]): Promise<{ lang: string, value: string }[]> {
        if (!this.openai) {
            throw new Error('OpenAI client not initialized');
        }

        if (!text || text.trim() === '') {
            throw new Error('Source text is empty');
        }

        if (!targetLangs || targetLangs.length === 0) {
            throw new Error('No target languages specified');
        }

        const config = vscode.workspace.getConfiguration('netteTranslations');
        const model = config.get<string>('model') || 'gpt-5-mini';

        const prompt = `Translate the following text "${text}" from "${sourceLang}" to the following languages: ${targetLangs.join(', ')}. 
        Return ONLY a JSON object where keys are language codes and values are translations. Example: {"cs": "Ahoj", "de": "Hallo"}`;

        console.log('[Translator] Calling OpenAI API with model:', model);
        console.log('[Translator] Prompt:', prompt);

        try {
            const completion = await this.openai.chat.completions.create({
                messages: [{ role: 'user', content: prompt }],
                model: model,
                response_format: { type: "json_object" }
            });

            console.log('[Translator] API response received');

            const content = completion.choices[0]?.message?.content;
            if (!content) {
                throw new Error('API returned empty response');
            }

            console.log('[Translator] Response content:', content);

            let json: Record<string, string>;
            try {
                json = JSON.parse(content);
            } catch (parseError) {
                console.error('[Translator] JSON parse error:', parseError);
                throw new Error('Failed to parse API response as JSON: ' + content.substring(0, 100));
            }

            if (typeof json !== 'object' || json === null) {
                throw new Error('API response is not a valid object');
            }

            const results = Object.keys(json).map(lang => ({
                lang: lang,
                value: json[lang]
            }));

            console.log('[Translator] Parsed results:', results);
            return results;

        } catch (error: any) {
            console.error('[Translator] Translation error:', error);

            // Provide more specific error messages based on error type
            let errorMessage = 'Translation failed';

            if (error?.status === 401 || error?.code === 'invalid_api_key') {
                errorMessage = 'Invalid API key. Please check your OpenAI API key in settings.';
            } else if (error?.status === 429) {
                errorMessage = 'Rate limit exceeded. Please wait and try again.';
            } else if (error?.status === 404 || error?.code === 'model_not_found') {
                errorMessage = `Model "${model}" not found. Please check model name in settings.`;
            } else if (error?.code === 'ENOTFOUND' || error?.code === 'ECONNREFUSED') {
                errorMessage = 'Network error. Please check your internet connection.';
            } else if (error?.message) {
                errorMessage = error.message;
            }

            throw new Error(errorMessage);
        }
    }
}
