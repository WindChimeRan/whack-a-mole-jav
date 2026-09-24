# Mole Lab

**Can a local model keep up?** Watch Qwen3.5-0.8B play whack-a-mole through vLLM-metal, then try the same round yourself. The browser shows each choice, hammer strike, score change, escaped mole, and response time. Qwen Metal is the default player; the DGX Spark Jev-style server is optional.

<p align="center"><img src="docs/qwen-metal-demo.gif" alt="Desktop replay of Qwen Metal playing the image-input round" width="960"></p>

## Run it

The game needs Node.js 24 or newer. Qwen Metal play needs an Apple Silicon Mac running [vLLM-metal](https://github.com/vllm-project/vllm-metal#installation). The Human and Demo players work without a model server.

Start Qwen3.5-0.8B on the Mac:

```sh
VLLM_METAL_MULTIMODAL_MODE=multimodal-native \
VLLM_METAL_USE_PAGED_ATTENTION=1 \
VLLM_ENABLE_V1_MULTIPROCESSING=0 \
vllm serve Qwen/Qwen3.5-0.8B \
  --served-model-name qwen35-metal --max-model-len 2048 \
  --max-num-seqs 1 --gpu-memory-utilization 0.35 \
  --host 127.0.0.1 --port 8012
```

In this repository, run `npm start` and open [http://127.0.0.1:4173](http://127.0.0.1:4173). The game server connects to Qwen at `http://127.0.0.1:8012` by default. For another address or served model name, copy `.env.example` to `.env` and set `METAL_BASE_URL` or `METAL_MODEL`. `METAL_API_KEY` adds a bearer token when required.

### Play from a Vercel site

`vercel.json` builds a static site with `npm run build`. Chrome is the supported browser for the hosted local-model path. On the hosted page, **Connect** asks Chrome to reach vLLM-metal at `http://127.0.0.1:8012` on the visitor's own Mac. Run the Qwen command above on that Mac, allow Chrome's local network prompt, then start the round. The board image and text state go straight from the browser to the local model; Vercel does not proxy inference. Human and Demo work without a model. Local Jev remains available through the local `npm start` game server.

## Play and compare

Choose a player and input on the first screen:

| Player | What happens |
| --- | --- |
| **Qwen Metal** (default) | Qwen chooses one of `h1`–`h9` or `wait` through vLLM's constrained chat output. Image input is selected by default; text input sends occupants and remaining lifetimes. |
| **Human** | Click a hole or press `1`–`9`. The score, missed moles, empty swings, and spawn-to-click reaction time appear live. No model server is needed. |
| **Local Jev** | An optional DGX Spark DiffusionGemma server chooses through the Jev-style `/v1/systemone` API. |
| **Demo** | A scripted browser player previews the game without inference. |

The default round lasts 30 seconds. A mole appears every 600 ms and stays for 1,100 ms. Brown moles score +1, gold moles +3, and bombs −2. **Load image test preset** restores those settings and seed `42`. Use the same seed and pressure controls to compare Human, Qwen, and Local Jev scores; the spawn-plan checksum is shown beside the live statistics. **Replay round** restarts the selected player with the same settings.

For the optional DGX Spark player, set `JEV_BASE_URL` in `.env` to a server that accepts `POST /v1/systemone`. Image mode uses that endpoint's `images` extension. `JEV_API_KEY` adds a bearer token when required. The game also checks `http://127.0.0.1:8011` when no Jev address is set.

### DGX Spark replay

<p align="center"><img src="docs/dgx-spark-demo.gif" alt="Desktop replay of Local Jev on DGX Spark playing the same seeded image-input round" width="960"></p>

## Timing and results

Qwen's **Metal request** time is measured at the local game proxy and includes inference. Jev's **Model decision** time comes from the server's `diagnostics.timing.total_ms`. **App prep** includes image capture and request preparation; **Round trip** also includes browser transfer. These numbers measure different boundaries, so use round trip when comparing the visible delay.

See the [benchmark notes](docs/benchmarks.md) for single-round text and image scores on seed `42`. Qwen and Jev use the same ten actions, but Qwen's constrained chat output does not provide Jev's confidence or probability fields.

## Credits

The browser game adapts Gerard Bentley's [MIT-licensed Whack-a-Mole](https://github.com/gerardrbentley/typescript-mini-games/tree/f699ae39ef755b156daaa7310091ccaf93a3bbbe/whack-a-mole); its license is preserved in [ORIGINAL_LICENSE.txt](ORIGINAL_LICENSE.txt). The optional Jev API follows [vLLM's structured reads PR](https://github.com/vllm-project/vllm/pull/57250) and the [DGX Spark recipe](https://github.com/mmastrac/djev-spark).
