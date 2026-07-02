const MAX_SHUFFLE_ATTEMPTS = 20;

function formatLetters(letters: string[]): string {
  return letters.map((letter) => letter.toUpperCase()).join('-');
}

function shuffleLetters(letters: string[]): string[] {
  const shuffled = [...letters];

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex]!, shuffled[index]!];
  }

  return shuffled;
}

export function scrambleWord(word: string): string {
  const originalLetters = word.trim().split('');
  const originalFormatted = formatLetters(originalLetters);

  if (new Set(originalLetters.map((letter) => letter.toLowerCase())).size <= 1) {
    return originalFormatted;
  }

  for (let attempt = 1; attempt <= MAX_SHUFFLE_ATTEMPTS; attempt += 1) {
    const formatted = formatLetters(shuffleLetters(originalLetters));

    if (formatted !== originalFormatted) {
      return formatted;
    }
  }

  const rotated = [...originalLetters.slice(1), originalLetters[0]!];
  return formatLetters(rotated);
}
