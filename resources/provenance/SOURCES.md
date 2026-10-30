# Source register

This file records what can be established from the current checkout. Unknown historical details remain explicitly marked instead of being inferred from generated output.

| Resource family                           | Current evidence                                                                                                                 | Provenance state                                                                                                 |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Main vocabulary and taxonomy              | `data/taxonomy_annotations_gemini_3_flash_enriched.json`; entry-level source labels and indexes are retained                     | source/model/prompt history incomplete; see RES-100                                                              |
| Grammar index/details/lessons             | `data/grammar_index.json`, `data/grammar_details.json`, `data/grammar_lessons.json`                                              | current canonical files present; generation history incomplete; see RES-101                                      |
| Textbook bundles and textbook grammar     | `data/textbook/canonical_books/*`, `canonical_textbook_grammar/*`; bundle metadata records manual workflow paths                 | source rights and full generation recipe require confirmation; see RES-301/303                                   |
| Textbook vocab v3/v4 and Jitendex overlay | canonical vocab files and overlay metadata                                                                                       | index linkage is validated; upstream Jitendex/JMdict snapshot/license evidence is incomplete                     |
| Textbook/Wiki text chunks                 | `data/textbook/textbook_text_*`, `data/wiki/processed/*`; Wiki records retain URL, `lastrevid`, source and license               | Wiki per-reading attribution is available; textbook/public-use review remains pending                            |
| Wikipedia extension readings              | `reading.wiki.url`, `title`, `lastrevid`, `license`, `source` in processed data                                                  | traceable per page; UI displays source link and license                                                          |
| Active/archive audio                      | `manifest.jsonl` inside each audio directory; provider/model/voice, synthesis text and target paths are retained where available | files and targets are validated; complete generation recipe/history is incomplete; see RES-103/104               |
| Textbook illustrations                    | `image/XinBian1..4/*.png`, `image-generation.jsonl`                                                                              | final files, course mapping, dimensions and hashes are present; original/prompt/license evidence remains pending |
| Brand and local dependencies              | `pwa-icon.svg`, `resources/brand/README.md`, `vendor/cytoscape.min.js`, `package.json`                                           | local source/license notes recorded; upgrade checks remain required                                              |

The resource audit and checksum manifests intentionally use repository-relative paths and exclude `data/user_progress.json`, credentials and runtime logs.

## 古典拓展阅读（CLASSICS-01，2026-10-21 公开接入）

来源快照由 `C:\code\JapaneseClassics/catalog.json` 及其语料、音频 SHA-256 标识；本批目录哈希见[公开接入证据](../../docs/evidence/classics-public-2026-10-21/README.md)。以下许可为来源库的标记，不作为额外权利审定结论；作品索引保留具体版本、来源 URL、试译状态及质量说明。

- 《竹取物语》國民文庫本、古谷知新校订：[维基文库固定版本](https://ja.wikisource.org/w/index.php?oldid=161009)，来源标记公有领域。
- 《伊势物语》群書類從巻第三百七、朱雀院塗籠御本：[维基文库固定版本](https://ja.wikisource.org/w/index.php?oldid=138441)，来源标记公有领域。
- 《源氏物语》1942 年校異源氏物語 TEI：[来源项目](https://kouigenjimonogatari.github.io/)，来源标记 CC0-1.0。
- 《平家物语》1922 年有朋堂本：[NDL PID 964450](https://dl.ndl.go.jp/pid/964450)，来源标记 PDM。
- 《太平记》国民文库系转录：[维基文库](https://ja.wikisource.org/wiki/太平記)，来源标记公有领域。
- 《御伽草子》1891 年前后编：[NDL PID 992891](https://lab.ndl.go.jp/dl/book/992891)、PID 992892，来源标记 PDM。

现代日语和中文为 AI 试译初稿；《平家物语》《御伽草子》的古文来自未校对 OCR。两部有声作品朗读现代日语，完整 MP3 在 R2，正文 JSON 在 Pages，原始来源回执和生成资料留在本机。
