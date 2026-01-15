# Changelog

All notable changes to this project will be documented in this file.

## [1.0.0] - 2026-01-15

### Fixed
- Fixed translation key insertion to properly nest new keys under existing parent keys
  - When adding a new key like `bar` in translator scope `foo`, it now correctly inserts under the existing `foo:` section
  - Previously, new keys were appended at the end of the file in flat format (`foo.bar: "value"`)
  - New logic detects existing parent keys and proper indentation style (tabs or spaces)
- Fixed handling of multiline strings (`"""` or `'''`) when inserting new keys
  - New keys are now correctly inserted after multiline value blocks

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
