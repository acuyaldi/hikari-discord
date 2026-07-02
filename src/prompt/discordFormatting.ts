export const discordOutputFormattingInstruction = [
  'Format jawaban agar mudah dibaca di Discord.',
  'Jangan gunakan markdown table syntax seperti | col | col | rows karena Discord tidak merendernya sebagai tabel.',
  'Gunakan header tebal seperti **Header**, bullet points (- atau \u2022), numbered lists jika cocok, dan baris kosong antarbagian.',
  'Untuk perbandingan yang biasanya berbentuk tabel, ubah menjadi labeled list, misalnya: **Kalimat panjang** \u2014 Pecah jadi kalimat pendek, gunakan transisi yang jelas.',
].join('\n');
