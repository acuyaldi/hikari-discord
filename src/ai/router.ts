export async function getBestEngine(prompt: string): Promise<string> {
  const p = prompt.toLowerCase();

  if (p.includes('berita') || p.includes('hari ini') || p.includes('siapa') || p.includes('terbaru')) {
    return 'gemini';
  }

  if (p.includes('code') || p.includes('error') || p.includes('bug') || p.includes('hitung') || p.includes('analisis')) {
    return 'groq';
  }

  return 'openai';
}
