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

## Notes

The browser game is an adaptation of the MIT-licensed [TypeScript Mini Games Whack-a-Mole](https://github.com/gerardrbentley/typescript-mini-games/tree/f699ae39ef755b156daaa7310091ccaf93a3bbbe/whack-a-mole) by Gerard Bentley. Its license is included in [ORIGINAL_LICENSE.txt](./ORIGINAL_LICENSE.txt). This version adds a local API server, model decision loop, pressure controls, multiple targets, and live telemetry.

The API route follows [vLLM PR #57250](https://github.com/vllm-project/vllm/pull/57250) and the [djev-spark recipe](https://github.com/mmastrac/djev-spark), which place the Jev-style structured server on port 8011 in front of plain vLLM. Your plain vLLM API at `10.0.0.33:8000` does not expose `/v1/systemone`.
