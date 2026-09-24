# Benchmark notes

These are single-round observations from September 23, 2026 on a local DiffusionGemma Jev-style server. They are useful for reproducing behavior and locating latency boundaries, not statistical accuracy estimates.

## Optional Qwen3.5-0.8B on vLLM-metal

On September 24, 2026, both paths ran against Qwen3.5-0.8B on vLLM-metal 0.29.0 on a Mac with `structured_outputs.choice` constrained to `h1`–`h9` or `wait`. Both rounds used the default 600 ms spawn interval, 1,100 ms stay, seed `42`, at most three visible moles, and a 30-second clock. Each produced the same 50/50 spawn plan (`436c1b95`), with 50 possible points. The game sent complete board pixels for image mode and occupied holes with remaining lifetimes for text mode.

| Metric | Qwen text | Qwen image |
| --- | ---: | ---: |
| Score | **34** | **30** |
| Hits | 42 | 36 |
| Escaped | 0 | 6 |
| Stale choices | 0 | 50 |
| Local proxy request, average | 60 ms | 93 ms |
| App preparation, average | <0.1 ms | 2.9 ms |
| Browser round trip, average | 63 ms | 96 ms |
| Decisions sent | 100 | 93 |

The Qwen route uses `POST /v1/chat/completions` with a server-enforced choice list, so its request timing is measured at the local game proxy and includes inference; it is not the Jev endpoint's server-side timing. The choice list matches Jev's actions, but Qwen does not use Jev's `/v1/systemone` question semantics or return confidence and probabilities. These are one-round observations, not an accuracy estimate. Qwen sometimes selected bombs or empty holes, and the small model was sensitive to prompt wording. The shorter prompts used in these rounds were checked on known mole and bomb frames before replaying the game.

## Matched text versus image stress run

Both arms used seed `42`, one noise draw, 250 ms between spawns, 350 ms mole lifetime, at most three visible, and a 30-second round. Each received **119/119** planned spawns with checksum `2da46b37`. The plan contained 88 regular moles, 17 gold moles, and 14 bombs; the maximum possible score was 139.

| Metric | Text state | Board image |
| --- | ---: | ---: |
| Score | **131** | **8** |
| Hits | 97 | 6 |
| Escaped | 7 | 98 |
| Stale choices | 7 | 53 |
| DGX decision time, average | 123 ms | 341 ms |
| App preparation, average | <0.1 ms | 3.2 ms |
| Browser round trip, average | 149 ms | 397 ms |
| Decisions sent | 133 | 63 |

The image arm's average round trip exceeded the 350 ms mole lifetime. That result chiefly tests whether a vision action can arrive before the target disappears; it does not isolate visual recognition accuracy.

## Image deadline sweep

All rounds used image input, seed `42`, one noise draw, a 30-second clock, and a limit of three visible moles. The two 600 ms-spawn rows share the 50/50 spawn plan and checksum `436c1b95`. The two 1,000 ms-spawn rows share the 30/30 plan and checksum `6ffa19eb`.

| Spawn / stay | Score / possible | Hits | Escaped | Stale | Hit rate | DGX decision | Round trip |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 250 / 350 ms | 8 / 139 | 6 | 98 | 53 | 6% | 341 ms | 397 ms |
| 600 / 700 ms | 18 / 50 | 20 | 21 | 30 | 49% | 297 ms | 351 ms |
| **600 / 1,100 ms** | **28 / 50** | **30** | **10** | **19** | **75%** | **293 ms** | **340 ms** |
| 1,000 / 1,500 ms | 13 / 28 | 19 | 5 | 8 | 79% | 203 ms | 296 ms |
| 1,000 / 1,900 ms | 13 / 28 | 19 | 5 | 10 | 79% | 230 ms | 304 ms |

On the identical 600 ms spawn plan, the observed score rose from 18 to 28 when lifetime increased from 700 to 1,100 ms. On the identical 1,000 ms spawn plan, extending lifetime from 1,500 to 1,900 ms left the score at 13. That plan had only two gold moles, so a score of 13 despite 19 positive hits implies at least three bomb hits. The remaining limit includes action selection or changes in the scene while a request is in flight; these runs do not isolate visual recognition accuracy. The scores are single-run observations, and raw scores across different spawn plans are not directly comparable.
