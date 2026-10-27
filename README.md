# NextSet Flow

A gym-floor planning prototype for The Coalition's Enterprise Roll Out project. It combines a small locally trained bilingual focus classifier, rule-based field extraction and a deterministic scheduler that adjusts routes and timings when equipment availability changes.

**[Open the live demo](https://nextset-flow-demo.lilacghost32768.chatgpt.site)**

The current demo runs classification on the visitor's device. It needs no model API key, billing account or ChatGPT login. Gym people, equipment states and usage times are synthetic, and each browser runs its own session.

## Try it locally

Download this repository and double-click **`NextSet Flow Demo/NextSet Flow Demo.html`**. This file embeds the application and model and works without a local server or model API.

For source development, use a recent Node.js version:

```sh
cd "NextSet Flow Demo"
node server.mjs
```

Open `http://127.0.0.1:4178`, then stop the server with Ctrl+C. Enter a workout request, select **Plan my workout**, or use **Run full simulation**. Uncertain requests ask for an explicit focus confirmation before replacing the plan.

## Repository contents

| Folder | Contents |
| --- | --- |
| [NextSet Flow Demo](NextSet%20Flow%20Demo/) | Current web application, frozen browser model, scheduler, simulation and 78 functional tests |
| [NextSet Flow Intent Model](NextSet%20Flow%20Intent%20Model/) | Training code, synthetic datasets, portable inference, model weights, evaluation and standalone classifier preview |
| [NextSet Flow Technical Validation](NextSet%20Flow%20Technical%20Validation/) | Latest English Word validation report, integration evidence and report builder |

The latest editable report is [NextSet Flow Local Model Technical Validation.docx](NextSet%20Flow%20Technical%20Validation/NextSet%20Flow%20Local%20Model%20Technical%20Validation.docx). The [v4 integration evidence](NextSet%20Flow%20Technical%20Validation/Technical%20Validation%20v4.md) can also be read directly on GitHub.

## Model evidence and limits

The classifier uses character TF-IDF and multiclass logistic regression, with seven outputs: legs, upper body, full body, push, pull, clarify and unsupported. It achieved **76/105 (72.4%) raw accuracy on separately authored synthetic requests**. This is not a real-user accuracy claim. Its scores are uncalibrated, and it still misclassifies some requests.

Time, preferences and exclusions are extracted with explicit rules. The model does not generate exercise prescriptions, assess medical suitability or predict equipment-use duration. The scheduler and gym floor use synthetic data, and exercise alternatives need trainer review before real gym use. See the [model evaluation](NextSet%20Flow%20Intent%20Model/reports/Evaluation.md) and [model card](NextSet%20Flow%20Intent%20Model/MODEL_CARD.md) for detail.

## Run checks

No npm package installation is needed for these dependency-free browser and runtime checks:

```sh
cd "NextSet Flow Demo"
node --test tests/*.test.mjs
node build-offline.mjs
node build-worker.mjs
```

The portable Worker build has no retained hosting-project identity. Deploy it using your own account and configuration; the existing live demo is separate from this repository.

The standalone model runtime tests need Python 3 as well as Node.js:

```sh
cd "NextSet Flow Intent Model"
node --test tests/*.test.mjs
```

The tests use `python` on Windows and `python3` elsewhere. Set `NEXTSET_PYTHON` to an explicit interpreter path if required. Training dependencies in `requirements-training.txt` are needed only to reproduce training; portable inference uses the Python standard library or JavaScript.

Secrets, local environment files, installed dependencies, temporary render images, historical paid-model code and hosting identity have been excluded from this export. No licence has been added; this repository does not grant an additional open-source licence.
