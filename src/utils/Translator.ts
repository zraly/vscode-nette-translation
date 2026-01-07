import OpenAI from 'openai';
import * as vscode from 'vscode';

export class Translator {
    private openai: OpenAI | undefined;

    constructor(apiKey: string) {
        this.openai = new OpenAI({
            apiKey: apiKey,
        });
    }

    public async translate(text: string, sourceLang: string, targetLangs: string[]): Promise<{ lang: string, value: string }[]> {
        if (!this.openai) {
            throw new Error('OpenAI client not initialized');
        }

        const config = vscode.workspace.getConfiguration('netteTranslations');
        const model = config.get<string>('model') || 'gpt-5-mini';

        const prompt = `Translate the following text "${text}" from "${sourceLang}" to the following languages: ${targetLangs.join(', ')}. 
        Return ONLY a JSON object where keys are language codes and values are translations. Example: {"cs": "Ahoj", "de": "Hallo"}`;

        try {
            const completion = await this.openai.chat.completions.create({
                messages: [{ role: 'user', content: prompt }],
                model: model,
                response_format: { type: "json_object" }
            });

            const content = completion.choices[0].message.content;
            if (!content) {
                return [];
            }

            const json = JSON.parse(content);
            return Object.keys(json).map(lang => ({
                lang: lang,
                value: json[lang]
            }));

        } catch (error) {
            console.error('Translation error:', error);
            vscode.window.showErrorMessage('Translation failed: ' + (error as any).message);
            return [];
        }
    }
}
