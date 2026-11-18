# Generated media

Audio and video can't be read, so claimkeeper tracks **what they were made from**. Keep every source as a file in the project.

| Media | Register as a mention | Record as an output |
|---|---|---|
| SVG with text | kind `svg`, anchor = the label text (you can open the SVG to look at it) | only if exported from a source: inputs = the source |
| ElevenLabs voiceover | the script file's claim sentences (kind `text`) | `output action=record path=public/vo.mp3 inputs=[script.txt] meta={tool:"elevenlabs", voice, model}` |
| Remotion render | text in the composition / props / captions (kind `text`) | `output action=record path=out/promo.mp4 inputs=[Promo.tsx, props.json, out:vo, public/hero.svg]` |
| Raster image | kind `image` (fingerprint) | inputs = prompt file or source |

Rules:
- Save the TTS script, image prompt and captions to files before generating, so they can be inputs.
- Record right after generating or regenerating. Re-recording the same path updates it.
- An input change marks the output `needs_regen`, and it chains: script → audio → video.
- A meaning change marks outputs `stale` unless their inputs were reconfirmed for the new meaning.
- **Never regenerate without the user's yes** (costs credits and render time). Say what is out of date and why, ask, then regenerate and record. If they decline: `output action=ack note="..."`.
- Meta must not contain keys or tokens (they are dropped anyway).
