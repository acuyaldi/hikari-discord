# Spec: Trivia Category Updates

## Goal
Modify the Discord bot's trivia functionality to update the core themes:
1. Remove "History" (Sejarah) from the trivia system instructions and the local fallback database.
2. Refocus the "Geography" (Geografi) category to strictly target capital city names (national and international).
3. Introduce a new "Basic Mathematics" (Matematika) category consisting of easy/simple math questions.

## Details of Changes

### 1. src/commands/trivia.ts
Update the system instruction prompt array `TRIVIA_SYSTEM_INSTRUCTION`:
- Remove: `- History: Indonesian national heroes, ancient kingdoms (Majapahit, Sriwijaya, etc.), crucial world war events.`
- Update: `- Geography: National & international capital city names (e.g., capitals of countries or provinces).`
- Add: `- Basic Mathematics: Simple and easy basic math questions suitable for trivia (e.g., addition, subtraction, multiplication, division of small integers, basic shapes properties).`

### 2. trivia_questions.json
Clean up and align fallback questions with the updated category guidelines:
- Delete any items with `"kategori": "Sejarah"`.
- Modify existing `"Geografi"` questions to focus exclusively on capital cities.
- Add new, simple `"Matematika"` questions.
- Re-index/update IDs sequentially if necessary, or preserve IDs as integers.

## Verification
- Run tests:
  `GEMINI_API_KEY=mock-key OPENAI_API_KEY=mock-key GROQ_API_KEY=mock-key node --test -r ts-node/register tests/triviaCommand.test.ts`
- Ensure all 12 tests pass successfully.
