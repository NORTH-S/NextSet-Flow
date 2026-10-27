# NextSet Flow interactive demo — v4

An Enterprise Roll Out prototype for The Coalition. Describe a workout in English or Chinese, see a timed equipment route through a gym floor plan, and watch the remaining plan adapt when equipment availability or rest time changes.

Published demo: [NextSet Flow](https://nextset-flow-demo.lilacghost32768.chatgpt.site). The existing Site remains public; visitors do not need a ChatGPT account. Each browser runs an independent synthetic gym session.

## Local trained model is the default

The demo now runs our small trained classifier in the visitor's browser. It makes no external model API calls and requires no API key, billing activation or paid model account. A fresh website visit downloads the application and model assets; the self-contained `NextSet Flow Demo.html` also works without a server or network.

The learned model recognises one of seven classes: `legs`, `upper`, `full`, `push`, `pull`, `clarify`, or `unsupported`. It is a character TF-IDF / logistic-regression classifier, trained on assistant-authored synthetic examples. Its frozen independent synthetic-test accuracy is **76/105, or 72.4%**. This is an experimental result, not an accuracy claim for real members or arbitrary language.

The model only supplies the training-focus category. Explicit parsing rules extract time, experience, supported exercise exclusions and queue/machine preferences. A deterministic scheduler calculates the current advisory allocation; a separate module forecasts the remaining session. The model does not generate arbitrary workouts, choose physical occupancy, validate exercise safety or predict usage duration.

When the model is uncertain, **Choose your focus to continue** asks the user to select a focus. This is recorded as `user-confirmed-local-classifier` and the screen says **Focus confirmed by you**. An accepted learned classification uses `trained-local-classifier`. The application does not silently replace an uncertain prediction with a keyword-based focus or claim that a user selection was recognised by the model.

Explicit medical restrictions, invalid time windows and unsupported experience levels stop planning before focus confirmation; confirming a focus cannot bypass these checks. A request classified as `unsupported` is also blocked. These bounded checks are not a comprehensive medical or security assessment.

The initial screen contains an example leg session with the clear request “I want to train legs for 30 minutes.” The frozen model recognises this default, so **Run full simulation** starts the default walkthrough in one click. Choosing a longer English/Chinese example or entering another request still invokes the model and may ask for focus confirmation. That is expected behavior at the unchanged threshold.

## What remains available

- English/Chinese requests with a 5–90 minute window, beginner/intermediate experience and supported exclusions/preferences.
- A 12-station floor plan with entrance, relative equipment positions, status, approximate release times and an aisle-based route.
- Current exercise advice and a timed session forecast. Later steps are estimates, not equipment reservations.
- **Run full simulation**: animated arrival, movement, another member's overrun, the protagonist's extra rest, and a later occupied station. Actual scheduler transitions update the displayed route and timing.
- Manual start/finish, extra rest, alternative choices and station-status changes when automatic playback is stopped.

Technical evidence remains outside the member flow in the neighbouring `NextSet Flow Technical Validation` folder. The v4 addendum supersedes the v3 description of API-backed interpretation.

## Run locally

For a presentation without network access, double-click **NextSet Flow Demo.html**. Rebuild it after changes:

```powershell
node build-offline.mjs
```

For the modular local version:

```powershell
node server.mjs
```

Open `http://127.0.0.1:4178`; the server binds to this computer only. Stop it with Ctrl+C. It serves the application/model assets and does not read `.env.local`, `OPENAI_API_KEY`, or any other model credential. Existing private local configuration is not used by the new runtime.

Install a recent Node.js version or invoke your installed Node executable by its full path if `node` is not available on PATH.

## Checks, model sync and deployment build

```powershell
node --test tests/*.test.mjs
node build-offline.mjs
node build-worker.mjs
```

The portable Worker ESM build embeds the top-level frontend/model assets in `dist/server/index.js`. The original hosting identity is excluded from this repository. A deployment owner can supply their own `.openai/hosting.json`, in which case the build also writes `dist/.openai/hosting.json`. Rebuild after changing frontend or Worker source and use your own hosting configuration. This does not change the separately hosted live demo.

The model is copied from the separate `NextSet Flow Intent Model` project with provenance and hash verification:

```powershell
node scripts/sync-local-model.mjs
```

This integration does not retrain the model or lower its uncertainty thresholds. Source model SHA-256: `2cc05f9ab7a3a71c398facfcc2ff473fb98052d1daef2e5c0d1e497d2e536df9`. The bundled `dist/local-model-info.json` records the original model and runtime hashes, test result and policy.

Automated checks cover learned classification, rule-extracted fields, focus confirmation and source attribution, request guards, session transitions, allocation, playback, local assets and retired API behavior. UI tests use a DOM-boundary harness. Browser visual and responsive inspection remains unavailable because of the saved browser access denial; code checks do not establish rendered visual quality.

## Runtime/API compatibility

- `GET /api/health` returns `{configured: true, provider: 'trained-local-classifier', callsExternalApi: false}`.
- `/api/plan` returns HTTP **410** with `local_model_in_browser` for every method. The browser now performs planning locally.
- Other `/api/` paths return 404. The public Worker does not import the old provider backend or handle provider credentials.
- Historical paid-provider source and API diagnostic scripts are not included in this portable export; they are not needed by the current demo.

## Main source files

| File | Responsibility |
| --- | --- |
| `dist/app.js`, `dist/styles.css`, `dist/index.html` | Request composer, explicit focus confirmation, floor map, current action, timeline and simulation |
| `dist/local-planner.js` | Compose learned focus with checked rule-extracted fields |
| `dist/trained-classifier.js`, `dist/trained-model.js` | Portable inference and frozen trained model weights |
| `dist/local-model-info.json`, `scripts/sync-local-model.mjs` | Model provenance and verified source synchronization |
| `dist/intent.js` | Field extraction, guards and strict intent validation; legacy parser retained for compatibility/example initialization |
| `dist/engine.js` | Equipment states, illustrative alternatives, scoring, shared advisory allocation and transitions |
| `dist/planner.js` | Session forecasts, aisle paths and repeatable synthetic playback |
| `worker/index.js`, `build-worker.mjs`, `server.mjs` | Public/local asset delivery and retired-API compatibility routes |
| `build-offline.mjs` | Self-contained HTML with model weights and runtime embedded |
| `tests/*.test.mjs` | Automated software behavior checks |

## Limits and next validation

The current classifier has limited generalisation. Its uncertainty policy may ask even a valid clear-looking request to be confirmed; it can also make confident mistakes. Synthetic training/test data and the small `unsupported` class cannot establish real-user robustness or medical suitability. The classifier's scores are uncalibrated.

All people, equipment states, durations and playback events are synthetic. There is no sensor feed, shared real-gym backend or trained duration predictor. Equipment alternatives need trainer review. The later-session forecast may reorder movements but does not jointly optimise every member's full future session, guarantee availability or physically reserve stations. Predicted releases never prove that a real user has finished.

Next work should collect consented real requests and independent labels, test confirmation comprehension, review exercise relationships with trainers, measure equipment-state reliability, and compare scheduling outcomes with a fixed-order baseline. This integration does not establish reduced waiting, safety, retention or commercial value.
