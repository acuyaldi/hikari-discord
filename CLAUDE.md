# Hikari Discord Bot — Refactoring Rules

These rules apply to ALL changes in this project. No exceptions.

## What Must Not Change

- Business logic
- AI prompts (base prompt, deep prompt)
- Slash command names
- Database filename / path
- SQL queries
- Discord responses (reply text, embeds, attachments)
- Feature set (nothing removed)
- Fallback behavior
- Engine selection logic
- Chat memory behavior
- Bot behavior observable from Discord

## What Is Allowed

- Refactoring for improved project structure
- TypeScript strict mode compliance
- Creating new helper files/modules if needed
- Moving code between files without changing behavior

## TypeScript

- Strict mode is enabled (`"strict": true` in tsconfig.json)
- No `any` unless unavoidable and explicitly justified
- Prefer `type` imports where possible
