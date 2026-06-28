import type { MemoryCategory, RetrievedMemory } from './types';

const CATEGORY_LABELS: Record<MemoryCategory, string> = {
  profile:      'User Profile',
  preference:   'Preferences',
  hardware:     'Hardware',
  work:         'Work',
  education:    'Education',
  project:      'Projects',
  hobby:        'Hobbies',
  relationship: 'Relationships',
  other:        'Other',
};

/**
 * Formats a list of retrieved memories into a structured block suitable for
 * injection into the system instruction.
 *
 * Memories are grouped by category. Each group gets a header and a bullet list.
 * Returns an empty string when the input list is empty so callers can use a
 * simple truthiness check before appending.
 *
 * When `tokenBudget` is provided the formatter stops adding bullets as soon as
 * the estimated token count (characters ÷ 4) would exceed the budget, ensuring
 * the injected block never grows unbounded.
 *
 * Example output:
 *   # Hardware
 *
 *   Known facts:
 *   • User owns an RTX 4060 GPU.
 *
 *   # Projects
 *
 *   Known facts:
 *   • User is developing Hikari Discord bot.
 */
export function formatMemoryContext(memories: RetrievedMemory[], tokenBudget?: number): string {
  if (memories.length === 0) return '';

  const charBudget = tokenBudget !== undefined ? tokenBudget * 4 : Infinity;

  const groups = new Map<MemoryCategory, RetrievedMemory[]>();
  for (const mem of memories) {
    const group = groups.get(mem.category) ?? [];
    group.push(mem);
    groups.set(mem.category, group);
  }

  const sections: string[] = [];

  for (const [category, mems] of groups) {
    const label = CATEGORY_LABELS[category];
    const header = `# ${label}\n\nKnown facts:\n`;
    const bullets: string[] = [];

    for (const m of mems) {
      const bullet = `• ${m.text}`;
      const bulletsSoFar = bullets.length > 0 ? bullets.join('\n') + '\n' + bullet : bullet;
      const sectionCandidate = header + bulletsSoFar;
      const outputCandidate = sections.length > 0
        ? sections.join('\n\n') + '\n\n' + sectionCandidate
        : sectionCandidate;
      if (outputCandidate.length > charBudget) break;
      bullets.push(bullet);
    }

    if (bullets.length === 0) continue;

    sections.push(`${header}${bullets.join('\n')}`);
    if (sections.join('\n\n').length >= charBudget) break;
  }

  return sections.join('\n\n');
}
