# Nette Translations for VS Code

Improving the developer experience for Nette Framework localization. This extension helps you manage translations in Latte templates and NEON files seamlessly.

## Features

- **Go to Definition**: Cmd+Click (or Ctrl+Click) on translation keys in `{_...}` macros to jump directly to the definition in your `.neon` files.
- **CodeLens**: Quickly access the "Edit Translation" interface right from your Latte templates.
- **Translation Editor**: A dedicated panel to view and edit translations for all configured languages side-by-side.
- **Context Awareness**: Supports `{translator}` tags to correctly resolve namespaced keys.

## Configuration

This extension works out of the box for standard Nette directory structures, but can be customized in `.vscode/settings.json`:

```json
{
  "netteTranslations.neonPath": "app/Lang",     // Path to your NEON files (default: "app")
  "netteTranslations.languages": ["cs", "en"],  // Languages to manage
  "netteTranslations.defaultLanguage": "en"     // Default language for definition lookup
}
```

## Requirements

- VS Code 1.80.0 or higher.
- Nette Framework project with translations stored in `.neon` files.

## Extension Settings

*   `netteTranslations.neonPath`: Relative path to a folder containing your translation files or the `app` directory.
*   `netteTranslations.languages`: Array of language codes (e.g., `['cs', 'en', 'de']`).
*   `netteTranslations.defaultLanguage`: The language to prioritize when resolving definitions.

## Known Issues

- Complex translation parameter logic in methods other than the standard `{_}` macro might not be detected.

## Release Notes

### 0.0.1

- Initial release with Go-to-Definition, CodeLens, and basic editor support.
