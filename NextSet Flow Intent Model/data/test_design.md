# Frozen independent synthetic test design

Created on 27 October 2026 for the standalone NextSet Flow intent classifier.

The file `test_blind.jsonl` contains 105 assistant-authored synthetic requests: 15 examples for each of seven labels, with five English, five Chinese and five mixed-language requests per label. It contains no collected user, gym-member or clinical data.

**Frozen test-file SHA-256:** `46f20728db7f349a95a7d0a4ab37c3a8ccdb4bc8eec809e2c210eefd1de00da4`.

The freeze check verified valid JSON rows, the exact six-field schema, unique IDs and texts, seven labels with 15 rows each, and the 5/5/5 language balance in every label. It did not run inference or inspect any development file.

## Independence and intended use

The test author was assigned only this test file and this design note. They did not inspect training seeds, validation data, model source, training output or model evaluation results. No model was run by the test author. Examples were written from the agreed label definitions and task scope, rather than generated as paraphrases of training rows.

Freeze this file before final evaluation. Its recorded SHA-256 fingerprint establishes the exact bytes tested. The test may be read by the final evaluation script, but must not be used to choose hyperparameters, thresholds, rules, training examples or successive model versions. If it informs later development, it becomes development data; a new independent test is then required for a fresh final claim. Record any accidental exposure or procedure deviation honestly.

This is an independent authoring procedure within the same assistant workflow, not an external, real-user, preregistered or statistically representative benchmark. Shared task definitions, common language and synthetic authorship may still make test examples easier or different from real deployment requests. Do not describe the set as proof of general natural-language understanding, clinical safety or real gym outcomes.

## Label policy

| Label | Meaning |
| --- | --- |
| `legs` | Clear lower-body or leg training focus, including an explicit correction to that focus. |
| `upper` | General upper-body training, or chest/back alone without an explicit push/pull split. |
| `full` | Clear whole-body training or a stated aim to cover upper and lower body together. |
| `push` | An explicit push day/pushing session, or the chest-shoulder-triceps grouping. |
| `pull` | An explicit pull day/pulling session, or the back-biceps grouping. |
| `clarify` | Missing training focus, unresolved alternatives, contradictory exclusive requirements or negation leaving no clear supported focus. |
| `unsupported` | Medical tailoring/rehabilitation, unsupported activity-only requests, nutrition-only tasks or requests to bypass the classifier/reveal secrets. |

An explicit present-tense correction determines the target rather than the mere occurrence of another label word. Time windows and equipment/queue preferences do not determine the focus class. Medical requests remain unsupported even when a normal workout focus is also present. General upper-body requests explicitly declining to split push/pull remain `upper`. Requests choosing a specific part of a push-pull-legs routine belong to that chosen part. Secret-request examples test out-of-scope classification; they do not contain actual credentials.

## Coverage and reporting

Supported classes include plain phrasing, anatomical descriptions, negation, corrections, scheduling context and equipment preferences. The abstention-related labels cover time-only requests, unresolved choices, conflicting requirements, medical tailoring and out-of-scope requests.

Report raw seven-class predictions and the deployed policy's final action separately. A confidence threshold may turn supported or unsupported predictions into a clarification; this must not be counted as a correct raw class prediction. Report the confusion matrix, per-label precision/recall/F1, overall accuracy, macro-F1, abstention/coverage and any false acceptance of `unsupported`/`clarify` inputs. Break results down by language, while acknowledging that each language group has only 35 examples.

Do not promise an accuracy or safety result before the frozen evaluation is run. Any confidence intervals or percentages must be accompanied by their denominator and the synthetic-data limitation. A useful next step is a consented, independently labelled real-request study with requests not used in development.
