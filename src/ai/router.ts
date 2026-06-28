import { TaskType } from '../services/ai/types';

export function classifyTask(prompt: string): TaskType {
  const p = prompt.toLowerCase();

  if (
    p.includes('berita') ||
    p.includes('hari ini') ||
    p.includes('siapa') ||
    p.includes('terbaru')
  ) {
    return TaskType.SEARCH;
  }

  if (
    p.includes('code') ||
    p.includes('error') ||
    p.includes('bug') ||
    p.includes('hitung') ||
    p.includes('analisis')
  ) {
    return TaskType.CODING;
  }

  return TaskType.GENERAL;
}
