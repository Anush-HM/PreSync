// Bullets are edited as plain text: one line per bullet, two leading
// spaces per indent level (up to two levels deep).
export function bulletsToText(bullets) {
  return (bullets || []).map((b) => `${'  '.repeat(b.level || 0)}${b.text}`).join('\n');
}

export function textToBullets(text) {
  return text
    .split('\n')
    .map((line) => {
      const indent = line.match(/^ */)[0].length;
      return { text: line.trim().replace(/^[•\-–*]\s+/, ''), level: Math.min(2, Math.floor(indent / 2)) };
    })
    .filter((b) => b.text);
}
