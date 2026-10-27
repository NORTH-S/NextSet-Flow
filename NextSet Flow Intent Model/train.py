"""Train a small bilingual intent classifier; never reads the blind test set."""
from __future__ import annotations
import sys
from pathlib import Path
ROOT = Path(__file__).resolve().parent
if (ROOT / ".training-deps").exists():
    sys.path.insert(0, str(ROOT / ".training-deps"))
import argparse
import hashlib
import json
import platform
import time
from collections import Counter
from datetime import datetime, timezone
import numpy as np
import scipy
from scipy.sparse import hstack
import sklearn
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, f1_score
from runtime.classifier import normalize, classify_text
from dataset import augment

SEED = 20261027
LABELS = ["clarify", "full", "legs", "pull", "push", "unsupported", "upper"]

def read_rows(path):
    rows = [json.loads(line) for line in path.read_text(encoding="utf-8-sig").splitlines() if line.strip()]
    for row in rows:
        if row["label"] not in LABELS or row["provenance"] != "assistant-authored-synthetic":
            raise ValueError("Unexpected labels or provenance")
    if len({normalize(row["text"]) for row in rows}) != len(rows):
        raise ValueError(f"Duplicate normalised text in {path.name}")
    return rows

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def export_model(vectorizers, weights, classifier, metadata):
    blocks = []
    for vectorizer, weight in zip(vectorizers, weights):
        blocks.append({"analyzer": vectorizer.analyzer, "ngramRange": list(vectorizer.ngram_range), "weight": weight,
                       "vocabulary": vectorizer.get_feature_names_out().tolist(), "idf": np.round(vectorizer.idf_, 10).tolist()})
    return {"format": "nextset-tfidf-logreg-v1", "version": "1.0.0", "labels": classifier.classes_.tolist(),
            "normalization": "NFKC; lowercase; collapse whitespace; trim", "blocks": blocks,
            "coefficients": np.round(classifier.coef_, 10).tolist(), "intercept": np.round(classifier.intercept_, 10).tolist(),
            "scoreType": "uncalibrated-softmax", "abstention": {"minConfidence": 0.4, "minMargin": 0.1, "minKnownFraction": 0.15}, "metadata": metadata}

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=ROOT / "model")
    args = parser.parse_args()
    if (ROOT / "reports/metrics.json").exists() and args.output.resolve() == (ROOT / "model").resolve():
        raise SystemExit("This evaluated model is frozen. Use --output model-reproduced for reproducibility; use a new holdout for a revised model.")
    began = time.perf_counter()
    seed_file, val_file = ROOT / "data/train_seed.jsonl", ROOT / "data/validation.jsonl"
    seeds, val = read_rows(seed_file), read_rows(val_file)
    train_text = {normalize(row["text"]) for row in seeds}
    if train_text & {normalize(row["text"]) for row in val}:
        raise ValueError("Train/validation text overlap")
    if {r["family"] for r in seeds} & {r["family"] for r in val}:
        raise ValueError("Train/validation family overlap")
    training = augment(seeds)
    if {normalize(r["text"]) for r in training} & {normalize(r["text"]) for r in val}:
        raise ValueError("Augmentation/validation text overlap")
    texts, targets = [normalize(r["text"]) for r in training], [r["label"] for r in training]
    val_texts, val_targets = [normalize(r["text"]) for r in val], [r["label"] for r in val]
    char = TfidfVectorizer(analyzer="char", ngram_range=(2,5), sublinear_tf=True, lowercase=False, max_features=12000)
    word = TfidfVectorizer(analyzer="word", token_pattern=r"[a-z0-9_]{2,}", ngram_range=(1,2), sublinear_tf=True, lowercase=False, max_features=4000)
    train_char, train_word = char.fit_transform(texts), word.fit_transform(texts)
    val_char, val_word = char.transform(val_texts), word.transform(val_texts)
    candidates = []
    best = None
    # This fixed grid and validation set are used before any blind test evaluation.
    for word_weight in [0.0, 0.75]:
        train_x = train_char if not word_weight else hstack([train_char, train_word * word_weight], format="csr")
        val_x = val_char if not word_weight else hstack([val_char, val_word * word_weight], format="csr")
        for c in [1.0, 4.0, 12.0]:
            classifier = LogisticRegression(C=c, solver="lbfgs", max_iter=1500, class_weight="balanced", random_state=SEED)
            classifier.fit(train_x, targets)
            predicted = classifier.predict(val_x)
            metrics = {"C": c, "wordWeight": word_weight, "accuracy": accuracy_score(val_targets, predicted), "macroF1": f1_score(val_targets, predicted, labels=LABELS, average="macro", zero_division=0), "iterations": classifier.n_iter_.tolist()}
            candidates.append(metrics)
            if best is None or (metrics["macroF1"], metrics["accuracy"], -c) > (best["metrics"]["macroF1"], best["metrics"]["accuracy"], -best["metrics"]["C"]):
                best = {"classifier": classifier, "metrics": metrics, "vectors": [char] if not word_weight else [char, word], "weights": [1.0] if not word_weight else [1.0, word_weight], "trainX": train_x, "valX": val_x}
    metadata = {"trainedAtUTC": datetime.now(timezone.utc).isoformat(), "randomSeed": SEED, "seedRows": len(seeds), "trainingRowsAfterAugmentation": len(training), "validationRows": len(val), "trainingProvenance": "Assistant-authored synthetic examples, not real gym-member data", "seedSHA256": sha(seed_file), "validationSHA256": sha(val_file), "selectedHyperparameters": best["metrics"], "blindTestReadDuringTraining": False, "task": "Seven-way workout-focus classification only; no plan, slot extraction, medical judgement or duration prediction", "runtimeDependencies": "None for JSON model inference; standard-library Python or ES module JavaScript", "versions": {"python": platform.python_version(), "scikit-learn": sklearn.__version__, "numpy": np.__version__, "scipy": scipy.__version__}}
    model = export_model(best["vectors"], best["weights"], best["classifier"], metadata)
    # Select an abstention operating point only on validation predictions. The raw
    # softmax is explicitly not a calibrated probability of correctness.
    base = [classify_text(row["text"], model) for row in val]
    policies = []
    for confidence in [0.3,0.4,0.5,0.6,0.7]:
        for margin in [0.05,0.1,0.2,0.3]:
            accepted = [(r,o) for r,o in zip(val,base) if o["topLabel"] not in {"clarify","unsupported"} and o["confidence"] >= confidence and o["margin"] >= margin and o["knownFeatureFraction"] >= 0.15]
            correct = sum(r["label"] == o["topLabel"] for r,o in accepted)
            precision = correct / len(accepted) if accepted else 0.0
            policies.append({"minConfidence": confidence, "minMargin": margin, "minKnownFraction": 0.15, "accepted": len(accepted), "correct": correct, "precision": precision})
    qualified = [p for p in policies if p["accepted"] >= 5 and p["precision"] >= 0.9]
    chosen = max(qualified, key=lambda p:(p["accepted"],p["precision"],p["minConfidence"])) if qualified else max(policies, key=lambda p:(p["precision"],p["accepted"]))
    model["abstention"] = {k:chosen[k] for k in ["minConfidence","minMargin","minKnownFraction"]}
    metadata["validationAbstentionSelection"] = {**chosen, "precisionTarget": 0.9, "targetMet": bool(qualified), "notASafetyGuarantee": True}
    # Verify our portable feature/inference implementation against scikit-learn.
    native = best["classifier"].predict_proba(best["valX"])
    max_error = 0.0
    for row, expected in zip(val,native):
        portable = classify_text(row["text"], model)
        by_label = {r["label"]:r["probability"] for r in portable["candidates"]}
        max_error = max(max_error, max(abs(by_label[label]-float(prob)) for label,prob in zip(model["labels"],expected)))
    if max_error > 1e-7:
        raise AssertionError(f"Portable inference parity failed: {max_error}")
    metadata["maxPortableProbabilityError"] = max_error
    metadata["trainAccuracy"] = accuracy_score(targets,best["classifier"].predict(best["trainX"]))
    metadata["trainingSeconds"] = time.perf_counter()-began
    args.output.mkdir(parents=True,exist_ok=True)
    output = args.output / "model.json"
    output.write_text(json.dumps(model,ensure_ascii=False,separators=(",",":")),encoding="utf-8")
    selection = {"modelSHA256":sha(output),"seedSHA256":sha(seed_file),"validationSHA256":sha(val_file),"candidateGrid":candidates,"chosenPolicy":chosen,"blindTestUntouched":True,"trainClassCounts":dict(Counter(targets)),"validationClassCounts":dict(Counter(val_targets))}
    (args.output / "selection.json").write_text(json.dumps(selection,ensure_ascii=False,indent=2),encoding="utf-8")
    (ROOT / "requirements-training.txt").write_text(f"scikit-learn=={sklearn.__version__}\nnumpy=={np.__version__}\nscipy=={scipy.__version__}\n",encoding="utf-8")
    print(json.dumps({"model":str(output),"bytes":output.stat().st_size,"trainRows":len(training),"seedRows":len(seeds),"validationRows":len(val),"selected":best["metrics"],"policy":chosen,"portableMaxError":max_error,"seconds":metadata["trainingSeconds"]},ensure_ascii=False,indent=2))

if __name__ == "__main__":
    main()
