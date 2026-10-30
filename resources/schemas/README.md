# Resource schemas

`resource-contracts.schema.json` is the versioned contract catalog for the canonical JSON families. It intentionally allows forward-compatible extra fields; semantic checks that JSON Schema cannot express cheaply—such as unique ids, cross-file references, PNG dimensions and audio targets—run in `tools/resource_audit.js`.

Human textbook review candidates live in `resources/quality/textbook_text_gold_candidates.v1.json`. Their workflow contract is documented beside the file and enforced semantically by `tools/resource_audit.js`: pending candidates are not approved truth, and approved entries require a traceable reference plus review metadata.

| Contract                                                | Current files                                                                                                                  |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `vocabularyEntry`                                       | `data/taxonomy_annotations_gemini_3_flash_enriched.json`, `data/textbook/canonical_textbook_vocab/textbook_vocab_full.v3.json` |
| `grammarIndexEntry` / `grammarDetail` / `grammarLesson` | `data/grammar_index.json`, `data/grammar_details.json`, `data/grammar_lessons.json`                                            |
| `textbookBundle`                                        | `data/textbook/canonical_books/XinBian1.bundle.json` through `XinBian4.bundle.json`                                            |
| `textbookV4Entry` / `jitendexEntry`                     | `data/textbook/canonical_textbook_vocab/textbook_vocab_full.v4.enrichment.json`, `jitendex_textbook_vocab_overlay.json`        |
| `textbookSentence`                                      | `data/textbook/textbook_text_tokens.v1.json`, `textbook_text_chunks.v2.json`                                                   |
| `wikiReading`                                           | `data/wiki/processed/textbook_wiki_reading_chunks.v1.json`, `textbook_wiki_reading_candidates.v1.json`                         |
| `audioManifestEntry`                                    | `manifest.jsonl` files inside active/archive audio packs                                                                       |
| `userProgress`                                          | local `data/user_progress.json` only; excluded from Git and resource checksums                                                 |

Schema contracts are documentation and tooling input, not an invitation to commit personal progress or credentials. A new data version should add a new contract or explicitly document its migration.
