# Mole Lab

Watch a local model play whack-a-mole. **Local Jev** remains the default player; **Qwen Metal** is an optional Qwen3.5-0.8B experiment. The browser shows every decision, hammer strike, score change, missed mole, and response time as the round runs.

![Local Jev playing a live image-input round](docs/local-jev-demo.gif)

The default round uses **image input**: a mole appears every 600 ms and stays for 1,100 ms. Start and replay are at the top of the page. Switch to text input to compare the same seeded spawn plan.

## Quick start

Requires Node.js 24 or newer. For the default Local Jev player, run a Jev-style decision server that accepts `POST /v1/systemone`; image mode uses that endpoint's `images` extension. The game itself needs no package installation.

```sh
cp .env.example .env
# Set JEV_BASE_URL in .env to your decision server.
npm start
```

Open [http://127.0.0.1:4173](http://127.0.0.1:4173). The game server listens on loopback and forwards model requests to `JEV_BASE_URL`. Its default is `http://127.0.0.1:8011`; `JEV_API_KEY` adds an optional bearer token, and `PORT` changes the game server port. **Demo bot** lets you preview the UI without a model server.

### Optional Qwen3.5-0.8B on vLLM-metal

Run Qwen separately on a Mac with vLLM-metal, then set the optional backend in `.env`:

```sh
VLLM_METAL_MULTIMODAL_MODE=multimodal-native \
VLLM_METAL_USE_PAGED_ATTENTION=1 \
VLLM_ENABLE_V1_MULTIPROCESSING=0 \
vllm serve Qwen/Qwen3.5-0.8B \
  --served-model-name qwen35-metal --max-model-len 2048 \
  --max-num-seqs 1 --gpu-memory-utilization 0.35 \
  --host 127.0.0.1 --port 8012
```

```sh
METAL_BASE_URL=http://127.0.0.1:8012
METAL_MODEL=qwen35-metal
```

Start or restart `npm start`, then choose **Qwen Metal** and **Text** or **Image** on the first screen. This path uses `POST /v1/chat/completions` with vLLM's `structured_outputs.choice`, constrained to the same ten action labels as Local Jev (`h1`–`h9` or `wait`). It does not use Jev's `/v1/systemone` question format or provide Jev's confidence and probability fields. If the Qwen server is on another host, use that host in `METAL_BASE_URL`. `METAL_API_KEY` is available for servers requiring a bearer token. The optional button is disabled until `METAL_BASE_URL` is configured. Both input paths were smoke tested on vLLM-metal 0.29.0; action quality is experimental.

## How it works

Each decision is a bounded choice among holes `1`–`9` and `wait`:

- **Image input** sends the exact 600×450 canvas shown in the arena. The text accompanying it explains the scoring rules and hole numbering, but does not reveal mole locations.
- **Text input** sends the nine occupants and their remaining lifetimes as structured state.

Moles score +1, gold moles +3, and bombs −2. The board keeps moving while a request is in flight, so a correct choice can arrive too late. The top action becomes **Replay round** after the clock ends. A fixed seed and the displayed spawn-plan checksum make paired text/image rounds reproducible.

The timing panel keeps three costs separate. For Jev, **Model decision** is the structured server's reported `diagnostics.timing.total_ms`. For Qwen Metal, **Metal request** is measured at the local proxy and includes inference. **App prep** includes state or image capture and JSON preparation; **Round trip** also includes browser transfer. Neither model figure is a pure GPU kernel measurement.

See [benchmark notes](docs/benchmarks.md) for matched text/image results and the image deadline sweep. The **Load image test preset** button restores the 600 ms / 1,100 ms profile with seed `42`.

## Credits

The browser game adapts Gerard Bentley's [MIT-licensed Whack-a-Mole](https://github.com/gerardrbentley/typescript-mini-games/tree/f699ae39ef755b156daaa7310091ccaf93a3bbbe/whack-a-mole); its license is preserved in [ORIGINAL_LICENSE.txt](ORIGINAL_LICENSE.txt). The local decision API follows [vLLM's structured reads PR](https://github.com/vllm-project/vllm/pull/57250) and the [DGX Spark recipe](https://github.com/mmastrac/djev-spark). Here, “Local Jev” refers to a locally served DiffusionGemma model using that Jev-style API.
