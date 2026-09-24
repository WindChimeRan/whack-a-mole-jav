export const metalChoices = [...Array.from({ length: 9 }, (_, index) => `h${index + 1}`), 'wait'];

export function createMetalRequest(input, metalModel) {
  const occupied = input.mode === 'text' ? input.holes.flatMap((hole, index) => hole
    ? [`Hole ${index + 1}: ${hole.kind === 'gold' ? 'gold mole' : hole.kind === 'mole' ? 'brown mole' : 'bomb'} (${Math.round(hole.msLeft)} ms left).`]
    : []) : [];
  const userContent = input.mode === 'image'
    ? [
      { type: 'text', text: 'Reply with the number printed closest to a visible brown or gold mole face, as h1 through h9. If the board has no visible mole face, reply wait.' },
      { type: 'image_url', image_url: { url: input.image } },
    ]
    : `${occupied.length ? `${occupied.join(' ')} Other holes: empty.` : 'All holes are empty.'} Which numbered hole contains a brown or gold mole? Prefer gold. Reply with just the number, or wait if none.`;
  return {
    model: metalModel,
    temperature: 0,
    max_tokens: 16,
    structured_outputs: { choice: metalChoices },
    messages: [{ role: 'user', content: userContent }],
  };
}

export function parseMetalChoice(raw) {
  if (typeof raw !== 'string') return null;
  const answer = raw.trim().replace(/^[`"']+|[`"'.!]+$/g, '').toLowerCase();
  if (/^(h[1-9]|wait)$/.test(answer)) return answer;
  const number = answer.match(/^(?:hole\s*#?\s*)?0?([1-9])$/);
  return number ? `h${number[1]}` : null;
}
