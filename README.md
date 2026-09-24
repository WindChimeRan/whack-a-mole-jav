# Mole Lab

**Can a local model keep up?** Watch a model play whack-a-mole, tune the pace, then try the same round yourself. The browser shows each choice, hammer strike, score change, escaped mole, and response time. Qwen3.5-0.8B on vLLM-metal is the default model; the DGX Spark Jev-style player is optional.

<p align="center"><img src="docs/qwen-metal-demo.gif" alt="Desktop replay of Qwen playing a live image-input round" width="960"></p>

## Play on Vercel

Open **[mole-lab.vercel.app](https://mole-lab.vercel.app)** in Chrome. **Human** and **Demo** work immediately. To let a model play, run a vLLM-compatible server on the same Mac as your browser, then click **Connect** on the site. Chrome will ask for local network access; the board image or text state goes directly from your browser to your model server. Vercel does not proxy inference.

For the default Qwen image and text player, install [vLLM-metal](https://github.com/vllm-project/vllm-metal#installation) on an Apple Silicon Mac and run:

```sh
VLLM_METAL_MULTIMODAL_MODE=multimodal-native \
VLLM_ENABLE_V1_MULTIPROCESSING=0 \
vllm serve Qwen/Qwen3.5-0.8B \
  --served-model-name qwen35-metal --max-model-len 2048 \
  --max-num-seqs 1 --gpu-memory-utilization 0.35 \
  --host 127.0.0.1 --port 8012
```

Paged attention is enabled by default in vLLM-metal. The site expects `http://127.0.0.1:8012` and model ID `qwen35-metal`, matching that command. Click **Connect**, allow Chrome's prompt, then start the image round.

To use another served model, expand **Change model or server** on the first screen. Enter its base URL and model ID, or choose an ID returned by the server's `/v1/models` endpoint. The URL and model ID are saved in your browser; an optional bearer key is kept only in the current tab. Choose **Text** for text-only models. Image play requires a vision model, and decision requests require a vLLM-compatible `structured_outputs.choice` endpoint. Custom model connections use browser-direct timing.

## Run from source

The local game needs Node.js 24 or newer:

```sh
npm start
```

Open [http://127.0.0.1:4173](http://127.0.0.1:4173). With the default settings, its Node proxy connects to Qwen at `http://127.0.0.1:8012`; changing the model or URL in the page switches that model to browser-direct requests. For proxy configuration, copy `.env.example` to `.env` and set `METAL_BASE_URL`, `METAL_MODEL`, or `METAL_API_KEY`.

**Local Jev** is an optional DGX Spark player in the local app. Set `JEV_BASE_URL` in `.env` to a server accepting `POST /v1/systemone`; image mode uses its `images` extension. `JEV_API_KEY` adds a bearer token when required. The hosted Vercel page keeps Human, Demo, and browser-direct model play.

## Play and compare

| Player | What happens |
| --- | --- |
| **Local model** (default) | The model chooses `h1`–`h9` or `wait`. Image input is selected by default; Text sends occupants and remaining lifetimes. |
| **Human** | Click a hole or press `1`–`9`. Score, escaped moles, empty swings, and spawn-to-click reaction time appear live. |
| **Local Jev** | The optional DGX Spark DiffusionGemma server chooses through the Jev-style API in the local app. |
| **Demo** | A scripted browser player previews the game without inference. |

The default round lasts 30 seconds. A mole appears every 600 ms and stays for 1,100 ms. Brown moles score +1, gold moles +3, and bombs −2. **Load image test preset** restores those settings and seed `42`. Use the same seed and pressure controls to compare scores; the spawn-plan checksum appears beside the live statistics. **Replay round** restarts the selected player with the same settings.

### DGX Spark replay

<p align="center"><img src="docs/dgx-spark-demo.gif" alt="Desktop replay of Local Jev on DGX Spark playing the same seeded image-input round" width="960"></p>

## Timing and results

For browser-direct play, **Model request** is measured in the browser through the local API response. With the local Node proxy, it includes the proxy's request to the model. Jev's **Model decision** is reported by its server. **App prep** includes image capture and request preparation; **Round trip** includes browser transfer. These are different timing boundaries, so compare like with like.

**Empty hits** are split into choices that were already empty in the input and targets that expired before the hit. See the [benchmark notes](docs/benchmarks.md) for single-round scores and the image prompt investigation.

## Credits

The browser game adapts Gerard Bentley's [MIT-licensed Whack-a-Mole](https://github.com/gerardrbentley/typescript-mini-games/tree/f699ae39ef755b156daaa7310091ccaf93a3bbbe/whack-a-mole); its license is preserved in [ORIGINAL_LICENSE.txt](ORIGINAL_LICENSE.txt). The optional Jev API follows [vLLM's structured reads PR](https://github.com/vllm-project/vllm/pull/57250) and the [DGX Spark recipe](https://github.com/mmastrac/djev-spark).
