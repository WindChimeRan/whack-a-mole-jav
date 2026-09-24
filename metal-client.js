export const metalChoices = [...Array.from({ length: 9 }, (_, index) => `h${index + 1}`), 'wait'];
export const metalImagePrompt = 'Pick a visible brown or gold mole. Prefer gold. Do not hit a gray bomb with an orange fuse or an empty hole. Reply with only h1 through h9 for the number nearest the mole face, or wait if no mole is visible.';

export function createMetalRequest(input, metalModel) {
  const occupied = input.mode === 'text' ? input.holes.flatMap((hole, index) => hole
    ? [`Hole ${index + 1}: ${hole.kind === 'gold' ? 'gold mole' : hole.kind === 'mole' ? 'brown mole' : 'bomb'} (${Math.round(hole.msLeft)} ms left).`]
    : []) : [];
  const userContent = input.mode === 'image'
    ? [
      { type: 'text', text: metalImagePrompt },
      { type: 'image_url', image_url: { url: input.image } },
    ]
    : `${occupied.length ? `${occupied.join(' ')} Other holes: empty.` : 'All holes are empty.'} Pick a brown or gold mole. Prefer gold. Do not hit a bomb or empty hole. Reply with only h1 through h9, or wait if no mole is present.`;
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
