2026-10-31 update: public data and media are maintained separately at https://github.com/greyindex/kotobaflow-resources with the owner-authorized resource scope and third-party notices. The pending entries below record the earlier source inventory; they do not supersede the resource repository notices.

# Third-party notices and release-risk register

This is an inventory for maintenance and release review. It is not legal advice and does not by itself grant permission to redistribute textbook content, generated audio, models, or images. Entries marked `pending` require evidence or a deliberate distribution decision before any public release.

| Component or asset                       | Evidence in this repository                                           | License/source recorded locally                                                                              | Release status                                                |
| ---------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| Cytoscape bundled runtime                | `vendor/cytoscape.min.js`, `index.html`                               | MIT text in `resources/licenses/CYTOSCAPE-MIT.txt`; upstream link: https://github.com/cytoscape/cytoscape.js | recorded; recheck on upgrade                                  |
| Open Book Reader page-turn technique     | `js/core/book-turn.js` (own implementation of the technique)          | MIT, © 2026 Peach Studio; text below; upstream link: https://github.com/kouxing2000/open-book-reader         | recorded                                                      |
| kuromoji.js runtime dependency           | `package.json`, installed package metadata                            | `Apache-2.0`, package version `0.1.2`; upstream link: https://github.com/takuyaa/kuromoji.js                 | recorded for source dependency                                |
| Playwright/ESLint/Prettier tooling       | `package.json` devDependencies                                        | package metadata supplies licenses; tooling is not shipped as runtime content                                | recorded for development only                                 |
| Wikipedia extension readings             | `data/wiki/processed/*`, `docs/wiki_extension_readings.md`            | Each reading retains URL, title, revision id, source and `CC BY-SA` fields                                   | attribution implemented; public redistribution review pending |
| Jitendex/JMdict-derived textbook overlay | `data/textbook/canonical_textbook_vocab/jitendex_overlay/*`           | Local overlay has no complete upstream notice or snapshot URL                                                | pending source/license evidence                               |
| Textbook text and examples               | `data/textbook/*`, `data/grammar_*`                                   | Local project records structure and generation paths only                                                    | pending rights and distribution boundary                      |
| Google Cloud TTS audio                   | Active/archive audio manifests and `resources/RESOURCE_MANIFEST.json` | Provider/model/voice are recorded; service terms and redistribution scope are not copied here                | pending public-release review                                 |
| Qwen reading audio/model                 | Qwen audio manifests; optional `local/tts/qwen`                       | Historical model/checkpoint provenance and license are incomplete; model pack absent in this clone           | pending RES-104                                               |
| Textbook illustrations                   | `image/*.png`                                                         | 77 final images are inventoried; generation prompts/originals/license evidence are incomplete                | pending RES-200/201                                           |
| Project-authored icon/brand files        | `pwa-icon.svg`, `resources/brand/README.md`, `js/icons.js`            | Project-authored where stated; no third-party icon/font package bundled                                      | source recorded; project distribution decision pending        |

Do not place credentials, API keys, account tokens, private model files, or personal progress in this file or in any file under `resources/`.

## Open Book Reader

The 3D page turn in `js/core/book-turn.js` follows the leaf and nested-strip paper curl of Open Book Reader. The code here is written for this project; the notice is kept because the technique and its tuning come from that project.

```text
MIT License

Copyright (c) 2026 Peach Studio

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
