# Intent classifier development data

Prepared on 27 October 2026 for the standalone NextSet Flow intent-classification experiment.

## Provenance and scope

Every row in `train_seed.jsonl` and `validation.jsonl` is **assistant-authored synthetic text**. These are invented workout requests, not collected member requests, real gym records, survey responses, or independently reviewed user annotations. No model API was called to create them. Their purpose is to make an initial supervised-learning experiment reproducible.

The labels describe the requested training focus or the need to decline/clarify. They do not specify exercises, medical suitability, physical capability, equipment availability, time estimates or a workout prescription. Time and preference phrases are included as contextual variation; this classifier's label alone does not extract those fields.

## Files and counts

| Split | Rows | Per class | Language per class | Intended use |
| --- | ---: | ---: | --- | --- |
| Training seed | 350 | 50 | 22 English, 22 Chinese, 6 mixed | Fit model weights; any augmentation must remain training-only |
| Validation | 98 | 14 | 6 English, 6 Chinese, 2 mixed | Select settings/thresholds; not an unbiased final performance estimate |

The seven classes are balanced within each file. IDs and full request strings are unique across the two files. Families are explicitly separated between these development splits. The validation requests were authored as a separate list without copying or reusing a training template. They still share the task's vocabulary and the same authoring process, so this is not evidence of population-level or independent human generalisation.

A separately authored final test set is owned by another contributor. Its contents were not inspected while creating these files. Freeze that test set before model fitting and do not use it to select hyperparameters, thresholds or examples. If final-test errors lead to changes, identify subsequent results as test-informed and obtain a new untouched test set.

## Label policy

| Label | Meaning and examples of scope |
| --- | --- |
| `legs` | Lower-body/leg training; thighs, glutes and hamstrings as the main focus |
| `upper` | General upper-body training, or an isolated chest/back/shoulder/arm request without a narrower push/pull intent |
| `full` | An explicitly whole-body session or a positive request to include both upper and lower body |
| `push` | Explicit push day / upper-body pushing; chest-shoulder-triceps or chest-triceps as a push grouping |
| `pull` | Explicit pull day / upper-body pulling; back-biceps or rows/pulldowns as a pull grouping |
| `clarify` | No usable focus, unresolved alternatives, or incompatible “only” requirements without a final correction |
| `unsupported` | Medical/rehabilitation tailoring, unsupported activity-only requests, nutrition, unrelated tasks, or instructions to expose credentials/change task rules |

When an utterance makes an explicit correction, the final positive choice determines the supported label: “not legs; upper body today” is `upper`. A positive request for both upper and lower body is `full`; unresolved “legs or upper body, I cannot decide” is `clarify`. A medically tailored request remains `unsupported` even if it names a supported body area.

These boundaries are educational product choices. In particular, classifying a plain back request as `upper` while classifying an explicit back-and-biceps split as `pull` should be reviewed with the product team. `unsupported` is a small heterogeneous rejection class, not comprehensive out-of-domain detection. Novel unsafe requests can still be misclassified.

## Row schema

Each UTF-8 JSONL line is an object containing:

```json
{"id":"train-legs-001","text":"Plan a leg workout for thirty minutes.","label":"legs","language":"en","family":"train-legs-en_direct","provenance":"assistant-authored-synthetic"}
```

`language` is `en`, `zh` or `mixed`. `family` identifies an authoring family; it should be retained through augmentation so derivative rows cannot leak across development splits. A family is not a person or data-source identifier. `provenance` is mandatory and must remain visible in derived datasets and reports.

## Validation limits

- Balanced synthetic classes do not represent real-world class frequencies or linguistic diversity.
- English and Chinese development examples cover direct requests, contextual requests, negation, explicit corrections and mixed-language requests. Coverage is finite and should not be mistaken for robust open-ended understanding.
- Confidence scores require validation; high confidence can still be wrong. Low-confidence and unsupported requests should ask for clarification rather than invent a plan.
- Report language-specific results, confusion between `upper`/`push`/`pull`, and failures on negation/corrections separately.
- Real member wording and qualified review are necessary before claiming production accuracy or medical safety. This dataset cannot validate predicted occupancy times or gym-outcome benefits.
