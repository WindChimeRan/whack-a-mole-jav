export const defaultJevModel = 'jev-latest';

export function makeJevRequest({ mode = 'text', holes, image, score, samples = 1 }) {
  const validImage = typeof image === 'string'
    && image.length <= 1_400_000
    && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(image);
  const validBoard = Array.isArray(holes)
    && holes.length === 9
    && holes.every((hole) => hole === null || (
      typeof hole === 'object'
      && ['mole', 'gold', 'bomb'].includes(hole.kind)
      && Number.isFinite(hole.msLeft)
      && hole.msLeft >= 0
      && hole.msLeft <= 10_000
    ));
  if (!['text', 'image'].includes(mode)
    || !Number.isFinite(score)
    || ![1, 4, 'auto'].includes(samples)
    || (mode === 'text' && !validBoard)
    || (mode === 'image' && !validImage)) {
    throw new Error('Invalid game state');
  }
  const criteria = Object.fromEntries(
    Array.from({ length: 9 }, (_, i) => [`h${i + 1}`, `Whack hole ${i + 1} (row-major board position).`]),
  );
  criteria.wait = 'Do not whack a hole right now.';

  return {
    model: defaultJevModel,
    samples,
    ...(mode === 'image' ? { images: [image] } : {}),
    state: mode === 'image' ? {
      game: 'Whack-a-mole',
      score,
      layout: 'The attached image is the current 3 by 3 board. Hole numbers 01 to 09 are printed next to their holes in row-major order: 01 top-left, 05 center, 09 bottom-right.',
      rules: 'Brown mole +1; gold mole +3; dark gray bomb with orange fuse -2. Dark empty holes score 0. A target may disappear before your action arrives. Judge visible occupants from the image.',
    } : {
      game: 'Whack-a-mole',
      score,
      rules: 'A mole is +1, a gold mole is +3, and a bomb is -2. Empty holes give 0. A target can disappear before the action arrives. Prefer valuable targets that are about to expire.',
      holes: holes.map((hole, i) => ({
        position: i + 1,
        occupant: hole?.kind || 'empty',
        milliseconds_remaining: hole?.msLeft || 0,
      })),
    },
    questions: {
      action: {
        type: 'choice',
        instructions: mode === 'image'
          ? 'Look at the attached board image. Choose one numbered hole containing a visible brown or gold mole. Prefer gold. Avoid gray bombs and empty dark holes. If no mole is visible, wait.'
          : 'Choose the single best action right now to maximize score. Avoid bombs and empty holes. If no positive target is visible, wait.',
        criteria,
      },
    },
  };
}

export function parseJevDecision(result, fallbackModel = defaultJevModel) {
  const answer = result?.answers?.action;
  if (answer?.type !== 'choice' || !/^(h[1-9]|wait)$/.test(answer.choice)) {
    throw new Error('Decision server returned an unexpected choice response.');
  }
  return {
    choice: answer.choice,
    confidence: answer.confidence,
    probabilities: answer.probabilities,
    model: result.model || fallbackModel,
    inputTokens: result.usage?.input_tokens ?? null,
    modelMs: Number.isFinite(result.diagnostics?.timing?.total_ms)
      ? Math.round(result.diagnostics.timing.total_ms)
      : null,
  };
}
