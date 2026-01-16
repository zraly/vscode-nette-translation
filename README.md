# Nette Translations for VS Code

Improving the developer experience for Nette Framework localization. This extension helps you manage translations in Latte templates and NEON files.

## Features

- **Go to Definition**: Cmd/Ctrl+Click on `{_...}` keys to jump to the NEON definition
- **CodeLens**: Quick "Edit Translation" link above each translation key
- **Translation Editor**: Edit all language variants side-by-side, rename keys
- **AI Translation**: Auto-generate missing translations using OpenAI
- **Context Awareness**: Supports `{translator}` blocks for namespaced keys

## Configuration

Add to `.vscode/settings.json`:

```json
{
  "netteTranslations.neonPath": "app/Lang",
  "netteTranslations.languages": ["cs", "en"],
  "netteTranslations.defaultLanguage": "cs",
  "netteTranslations.apiKey": "sk-...",
  "netteTranslations.model": "gpt-4o"
}
```

| Setting | Description | Default |
|---------|-------------|---------|
| `neonPath` | Path to translation files | `app` |
| `languages` | Language codes to manage | `["cs", "en"]` |
| `defaultLanguage` | Language for Go to Definition | `en` |
| `apiKey` | OpenAI API key (optional) | – |
| `model` | OpenAI model | `gpt-5-mini` |

## Requirements

- VS Code 1.80.0+
- Nette project with `.neon` translation files

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for release history.
