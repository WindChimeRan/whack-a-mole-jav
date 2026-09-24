# Mole Lab

Watch your local DiffusionGemma model play whack-a-mole through a Jev-style decision API. Switch between text state and image input to stress both paths. The board shows the model's moves with a hammer swing, hit or miss marker, score, escaped moles, stale decisions, and response times. You can change mole frequency, lifetime, noise draws, and the maximum number visible while a round is running.

## Run

Requires Node.js 20 or newer. There are no package dependencies.

```sh
npm start
```

Open <http://127.0.0.1:4173>. The app binds to `127.0.0.1` and connects to your DGX Spark's structured server at `http://10.0.0.33:8011` by default. Set `JEV_BASE_URL` to use a different address. If you later protect that structured server with a bearer token, set `JEV_API_KEY` on the local app server.

Select **DiffusionGemma** to send live requests. The request uses `jev-latest` for compatibility; the structured server returns the actual model name (`dgemma`). **Demo bot** makes no model requests.

## What the model receives

The local app calls `POST http://10.0.0.33:8011/v1/systemone`. **Text state** sends the exact occupant and remaining lifetime of each hole. **Board image** draws a 600×450 canvas that is visible in the arena and sends those same pixels through the API's `images` field. The image request describes the rules and hole numbering, but contains no text list of occupants. Each request asks a `choice` question with ten possible actions: holes 1 through 9, or `wait`. Moles score +1, gold moles +3, and bombs −2. One request is in flight at a time. The board continues to advance while the request runs, so a choice may be stale by the time it arrives.

The telemetry separates three timings: **DGX decision** comes from the structured server's `diagnostics.timing.total_ms`; **App prep** covers the browser's state snapshot, board drawing, PNG encoding when used, and JSON preparation; **Round trip** covers the browser request through the local proxy and LAN to the DGX server and back. DGX decision is a server-side decision time, not a pure GPU kernel timing. The chart plots DGX decision times. **Noise draws / decision** controls the recipe's `samples` parameter: 1 is fastest, `auto` repeats uncertain reads, and 4 always averages four reads.

The game checks spawns and expirations every 10 ms while refreshing the visible clock and image life bars every 100 ms. It checks expiry again as a model response arrives, before scoring the action. The image board caches its static background and draws only active occupants for each frame. Select the input mode before starting a round, so each round's metrics belong to one mode.

For a paired text/image comparison, keep mole frequency, lifetime, visible limit, round length, noise draws, and **round seed** the same. The seed produces the same planned hole and occupant sequence independently of the model's actions. The telemetry shows accepted/planned spawns and a plan checksum; compare both after each round. With 250 ms spawns, 350 ms lifetime, and a limit of three visible, planned spawns do not compete for the same hole in adjacent events.

### Matched stress run — September 23, 2026

Both arms used seed `42`, one noise draw, 250 ms between spawns, 350 ms mole lifetime, at most three visible, and a 30-second round. Each received **119/119** planned spawns with checksum `2da46b37`. The plan contained 88 regular moles, 17 gold moles, and 14 bombs; an error-free player could score 139 points.

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

This is one round per arm. In image mode the average browser round trip exceeded the 350 ms lifetime, so the score gap under this pressure mostly measures whether an action can arrive in time. It does not isolate visual recognition accuracy.

### Image-mode boundary sweep — September 23, 2026

These are single 30-second image rounds with seed `42`, one noise draw, and at most three visible moles. The two 600 ms-spawn rows had the **same 50/50 spawn plan** and checksum `436c1b95`; only mole lifetime changed. The two 1,000 ms-spawn rows had the **same 30/30 spawn plan** and checksum `6ffa19eb`. The **Image boundary preset** button loads the 600 / 1,100 ms profile.

| Spawn / stay | Score / possible | Hits | Escaped | Stale | Hit rate | DGX decision | Round trip |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 250 / 350 ms | 8 / 139 | 6 | 98 | 53 | 6% | 341 ms | 397 ms |
| 600 / 700 ms | 18 / 50 | 20 | 21 | 30 | 49% | 297 ms | 351 ms |
| 600 / 1,100 ms | 28 / 50 | 30 | 10 | 19 | 75% | 293 ms | 340 ms |
| 1,000 / 1,500 ms | 13 / 28 | 19 | 5 | 8 | 79% | 203 ms | 296 ms |
| 1,000 / 1,900 ms | 13 / 28 | 19 | 5 | 10 | 79% | 230 ms | 304 ms |

On the identical 600 ms spawn plan, the observed score rose from 18 to 28 when the lifetime increased from 700 to 1,100 ms. On the identical 1,000 ms spawn plan, extending the lifetime from 1,500 to 1,900 ms left the score at 13. That plan had only two gold moles, so a score of 13 despite 19 positive hits implies at least three bomb hits. The remaining limit includes action selection or changes in the scene while the request is in flight; these runs do not isolate visual recognition accuracy. The scores are single-run observations, and the 1,000 ms rows have a different spawn plan, so their raw scores are not directly comparable with the 600 ms rows.

## Notes

The browser game is an adaptation of the MIT-licensed [TypeScript Mini Games Whack-a-Mole](https://github.com/gerardrbentley/typescript-mini-games/tree/f699ae39ef755b156daaa7310091ccaf93a3bbbe/whack-a-mole) by Gerard Bentley. Its license is included in [ORIGINAL_LICENSE.txt](./ORIGINAL_LICENSE.txt). This version adds a local API server, model decision loop, pressure controls, multiple targets, and live telemetry.

The API route follows [vLLM PR #57250](https://github.com/vllm-project/vllm/pull/57250) and the [djev-spark recipe](https://github.com/mmastrac/djev-spark), which place the Jev-style structured server on port 8011 in front of plain vLLM. Your plain vLLM API at `10.0.0.33:8000` does not expose `/v1/systemone`.
