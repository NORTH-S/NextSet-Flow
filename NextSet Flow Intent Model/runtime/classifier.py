"""Portable inference for our trained classifier. Python standard library only."""
from __future__ import annotations
import json
import math
import re
import unicodedata
from collections import Counter
from pathlib import Path

LABEL_NAMES = {"legs": "腿部", "upper": "上半身", "full": "全身", "push": "推类训练", "pull": "拉类训练", "clarify": "需要澄清", "unsupported": "超出支持范围"}

SPACE_RE = re.compile(r"[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+")

def normalize(text: str) -> str:
    return SPACE_RE.sub(" ", unicodedata.normalize("NFKC", text).lower()).strip(" ")

def tokens(text: str, analyzer: str, low: int, high: int) -> list[str]:
    units = list(text) if analyzer == "char" else re.findall(r"[a-z0-9_]{2,}", text)
    return [("" if analyzer == "char" else " ").join(units[i:i+n])
            for n in range(low, high + 1) for i in range(len(units)-n+1)]

def load_model(path: str | Path) -> dict:
    model = json.loads(Path(path).read_text(encoding="utf-8"))
    if model.get("format") != "nextset-tfidf-logreg-v1":
        raise ValueError("Unsupported model format")
    model["_vocabularies"] = [{term: i for i, term in enumerate(block["vocabulary"])} for block in model["blocks"]]
    return model

def vectorize(text: str, model: dict) -> tuple[dict[int, float], float]:
    clean = normalize(text)
    features, offset = {}, 0
    char_known = char_total = 0
    vocabularies = model.get("_vocabularies") or [{term: i for i, term in enumerate(b["vocabulary"])} for b in model["blocks"]]
    for block, vocabulary in zip(model["blocks"], vocabularies):
        counts = Counter(tokens(clean, block["analyzer"], *block["ngramRange"]))
        if block["analyzer"] == "char":
            char_total = sum(counts.values())
            char_known = sum(count for term, count in counts.items() if term in vocabulary)
        values = {vocabulary[term]: (1 + math.log(count)) * block["idf"][vocabulary[term]] for term, count in counts.items() if term in vocabulary}
        norm = math.sqrt(sum(value * value for value in values.values())) or 1.0
        for index, value in values.items():
            features[offset + index] = value / norm * block["weight"]
        offset += len(vocabulary)
    return features, char_known / char_total if char_total else 0.0

def classify_text(text: str, model: dict) -> dict:
    if not isinstance(text, str) or not normalize(text) or len(text) > 1200:
        return {"label": "clarify", "topLabel": None, "confidence": 0.0, "margin": 0.0, "needsClarification": True,
                "candidates": [], "knownFeatureFraction": 0.0, "reason": "Enter a workout request of 1–1,200 characters.", "source": "trained-local-classifier", "scoreType": "uncalibrated-softmax"}
    features, known = vectorize(text, model)
    logits = [bias + sum(weights[index] * value for index, value in features.items()) for bias, weights in zip(model["intercept"], model["coefficients"])]
    shift = max(logits)
    exponentials = [math.exp(value - shift) for value in logits]
    total = sum(exponentials)
    candidates = sorted([{"label": label, "probability": value / total} for label, value in zip(model["labels"], exponentials)], key=lambda x: -x["probability"])
    best, second = candidates[:2]
    confidence, margin = best["probability"], best["probability"] - second["probability"]
    policy = model["abstention"]
    uncertain = known < policy["minKnownFraction"] or confidence < policy["minConfidence"] or margin < policy["minMargin"]
    label = "clarify" if uncertain else best["label"]
    reason = ("The model is uncertain. Please state one training focus more clearly." if uncertain else
              "Please choose one training focus." if label == "clarify" else
              "This request is outside the supported gym-focus categories; no workout is prescribed." if label == "unsupported" else
              "Classified by the trained local model. This is a focus label, not a full workout plan.")
    return {"label": label, "topLabel": best["label"], "confidence": confidence, "margin": margin,
            "needsClarification": label in {"clarify", "unsupported"}, "candidates": candidates,
            "knownFeatureFraction": known, "reason": reason, "source": "trained-local-classifier", "scoreType": "uncalibrated-softmax"}

if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Classify an English/Chinese gym request with our trained model, offline.")
    parser.add_argument("text", nargs="?")
    parser.add_argument("--model", type=Path, default=Path(__file__).resolve().parents[1] / "model/model.json")
    args = parser.parse_args()
    loaded = load_model(args.model)
    if args.text:
        print(json.dumps(classify_text(args.text, loaded), ensure_ascii=False, indent=2))
    else:
        print("NextSet local classifier. Enter a request; Ctrl+C to leave.")
        while True:
            try:
                query = input("> ").strip()
                if query:
                    print(json.dumps(classify_text(query, loaded), ensure_ascii=False, indent=2))
            except (EOFError, KeyboardInterrupt):
                break
