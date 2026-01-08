# Changelog

All notable changes to this project will be documented in this file.

## [0.0.3] - 2026-01-08

### Fixed
- Fixed translator domain detection when `{snippet}` or `n:snippet` interrupts the `{translator}` block
  - Plugin now correctly recognizes that snippets create a new scope and break translator context
  - Translators defined INSIDE a snippet still work correctly

## [0.0.2] - Previous release

### Added
- Initial features for Nette translation editing
- CodeLens for translation keys
- Go to Definition for translation keys
- Translation panel with AI-powered translations

## [0.0.1] - Initial release

### Added
- Basic extension structure
