# NextSet Flow — technical validation v4 addendum

**Date: 27 October 2026.** This addendum records integration of the separately trained local classifier. It supersedes v3's description of an active OpenAI endpoint, API billing dependency and a separate rule-parser fallback. Earlier documents remain historical evidence for those versions.

## What changed

The public demo at [the same Site URL](https://nextset-flow-demo.lilacghost32768.chatgpt.site) now bundles a small trained classifier and runs inference on the visitor's device. It needs no model API key, billing activation or external model call. A first website visit still needs to download the application/model assets; the rebuilt self-contained HTML embeds them and can run without a server or network.

The existing gym floor plan, entrance, equipment status, aisle routes, session timeline and global simulation are retained. Synthetic events for another member's overrun, the protagonist's extra rest and an occupied next station continue to drive actual scheduler transitions and updated forecasts.

## Model identity and frozen evidence

| Property | Value |
| --- | --- |
| Task | Seven-way workout-focus classification only |
| Labels | `legs`, `upper`, `full`, `push`, `pull`, `clarify`, `unsupported` |
| Model | Character 2–5 gram TF-IDF and multi-class logistic regression |
| Source data | 350 assistant-authored synthetic seed requests; 1,050 rows after training-only context augmentation |
| Validation | 98 separately authored synthetic requests used for model and threshold selection |
| Final test | 105 independently authored, pre-frozen synthetic requests; no use for model/threshold selection |
| Raw final accuracy | 76/105, **72.4%** |
| Raw macro F1 | 0.722 |
| Final directly accepted focus labels | 42/105, **40.0% coverage**; 36/42 correct, **85.7% precision** |
| Model file | 1,424,885 bytes, approximately 1.36 MiB |
| Model SHA-256 | `2cc05f9ab7a3a71c398facfcc2ff473fb98052d1daef2e5c0d1e497d2e536df9` |
| Confidence policy | Minimum raw score 0.5, margin 0.05, known-feature fraction 0.15 |

This integration copies the frozen model/runtime with hash verification; it does not retrain the model, tune against the final test or lower the thresholds. The provenance is available in the demo's `dist/local-model-info.json` and the standalone model project's selection, evaluation and reproducibility files.

All data is invented assistant-authored text. Exact normalised text/family identifiers do not overlap, but authoring style, vocabulary and semantic templates may still share bias. These figures do not establish accuracy for real members. Scores are uncalibrated softmax values, not calibrated probabilities of correctness. The accepted-sample precision must be reported with its coverage and must not replace overall accuracy. The final test included one unsupported request incorrectly accepted as a focus, so the classifier is not a reliable medical/security gate.

## Integration behavior

1. `extractWorkoutDetails` applies bounded text/length, time-window, experience and explicit medical checks, then extracts time, exclusions and queue/machine preferences with rules. These fields were not learned by this classifier.
2. `classifyText` runs the bundled trained model to obtain the focus and uncertainty result. The adapter does not silently substitute the old keyword focus parser.
3. An accepted supported label becomes a strictly validated intent with source `trained-local-classifier`.
4. An uncertain/clarify result asks the user to choose a focus. A choice is rechecked against the unchanged request and guards, and recorded as `user-confirmed-local-classifier`. The screen explicitly attributes the focus to the user.
5. `unsupported` results are blocked. A focus selection cannot bypass medical, invalid-time or unsupported-experience checks. This is still a limited prototype control rather than comprehensive medical screening.
6. The deterministic allocation/forecast code creates the session and responds to changing equipment states. The model has no authority to invent exercise relationships, station occupancy, reservations or physiological advice.

The opening screen remains an example leg plan. Its clear default request, “I want to train legs for 30 minutes.”, is recognised by the frozen model, permitting the default global simulation to start in one click. More detailed example buttons and changed requests may require explicit focus confirmation at the unchanged threshold. Such a confirmation must not be presented as a successful model recognition.

## Server and credential boundary

The Worker and local server no longer import the old provider backend, call an external model or read local model credentials. The hosted build contains the local model and runtime, not the old provider request path or credential-handling code.

- `GET /api/health`: `{configured: true, provider: 'trained-local-classifier', callsExternalApi: false}`.
- `/api/plan`: HTTP 410, `local_model_in_browser`, for every method. It does not parse a workout or forward a provider request.
- Other `/api/` paths: 404. Hidden files, generated server output, traversal paths and inherited object properties are not served as assets.

The original working project retained unused v3 provider source, but that code, diagnostic scripts and private environment files are omitted from this portable GitHub export. The current application requires no hosted runtime model secret. The separately hosted live demo retains its public audience and no-login visitor access; its hosting identity is not included in the repository.

## Automated checks and reproducibility

Run from `NextSet Flow Demo`:

```powershell
node --test tests/*.test.mjs
node build-offline.mjs
node build-worker.mjs
```

| Area | Checks |
| --- | --- |
| Model provenance | Source-model hash and runtime sync; unchanged learned weights and uncertainty policy |
| Local adapter | Real learned focus, rule-extracted fields, explicit confirmation source, guarded invalid requests, no API dependency |
| UI handlers | Local-model planning, focus confirmation and stale-text handling, honest labels, simulation, map/timeline state and reset |
| Scheduling/playback | Existing state, conflict, feasibility, active-user preservation, availability provenance, forecasting and synthetic disruption checks |
| Server/build | Health metadata, retired planning route, no provider calls even with a dummy environment key, asset/method/path protections and exclusion of provider code from the build |
| Offline artifact | Bundled module/model behavior without server/API access; not a browser layout test |

The final combined release check passed all 78 tests: 17 UI/offline, 7 server, 16 engine, 13 intent, 11 local-model adapter and 14 forecast/simulation tests. The server checks include an actual ephemeral local HTTP server serving the learned model asset, rejecting private/generated paths and returning 410 for the retired endpoint. The owned test server is stopped afterwards. The Worker build also passed, embedding 11 frontend/model assets with no provider request or credential-handling path.

The standalone model previously passed six Python/JavaScript parity/boundary checks across 20 independent probes plus two offline-artifact checks. Its training was reproduced with the same features, weights, biases and uncertainty policy; metadata timestamps cause full-file hashes to differ between retraining runs. That evidence is distinct from the demo's integration checks and from classification accuracy.

The Worker build retains the supported default-export `fetch(request, env, ctx)` contract and embeds the frontend/model assets. Rebuild after final frontend changes and publish the exact source/build pair through the Sites workflow.

## Verification limits and next steps

No browser visual/responsive inspection was completed because of the existing saved browser access-denial policy. DOM-harness and source checks do not establish animation smoothness, map legibility, browser-specific accessibility or phone performance.

The classifier's limited generalisation and synthetic evaluation remain the main model limitation. Collect consented real member requests, obtain independent labels, and evaluate a new untouched holdout before further model improvement. Test whether users understand uncertainty confirmation and source attribution. Do not tune this frozen candidate against its final test and reuse that test as unbiased evidence.

There is still no live sensor feed, shared occupancy database or trained usage-duration predictor. Trainer review, real equipment-state/release-time measurement, fairness/scalability tests and comparisons against a fixed-order baseline remain necessary. This version does not establish real-gym waiting reduction, clinical safety, retention, conversion or willingness to pay.
