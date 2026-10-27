"""One final evaluation of the frozen, separately authored synthetic test set."""
from __future__ import annotations
import hashlib
import json
import statistics
import time
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from runtime.classifier import load_model, classify_text, normalize, LABEL_NAMES

ROOT = Path(__file__).resolve().parent
EXPECTED_TEST_SHA256 = "46f20728db7f349a95a7d0a4ab37c3a8ccdb4bc8eec809e2c210eefd1de00da4"
SUPPORTED = {"legs", "upper", "full", "push", "pull"}

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def rows(path):
    return [json.loads(line) for line in path.read_text(encoding="utf-8-sig").splitlines() if line.strip()]

def score(gold, predicted, labels):
    matrix = [[sum(a==truth and b==guess for a,b in zip(gold,predicted)) for guess in labels] for truth in labels]
    per_class = {}
    for label in labels:
        tp = sum(a==label and b==label for a,b in zip(gold,predicted))
        fp = sum(a!=label and b==label for a,b in zip(gold,predicted))
        fn = sum(a==label and b!=label for a,b in zip(gold,predicted))
        precision, recall = tp/(tp+fp) if tp+fp else 0, tp/(tp+fn) if tp+fn else 0
        per_class[label] = {"precision":precision,"recall":recall,"f1":2*precision*recall/(precision+recall) if precision+recall else 0,"support":sum(a==label for a in gold)}
    return {"accuracy":sum(a==b for a,b in zip(gold,predicted))/len(gold),"macroF1":statistics.mean(m["f1"] for m in per_class.values()),"perClass":per_class,"confusionMatrix":matrix,"labelOrder":labels}

def main():
    report_path = ROOT / "reports/metrics.json"
    if report_path.exists():
        raise SystemExit("Final test already evaluated. Preserve the report; use a new independently collected test set for a revised model.")
    model_path, test_path = ROOT / "model/model.json", ROOT / "data/test_blind.jsonl"
    selection = json.loads((ROOT / "model/selection.json").read_text(encoding="utf-8"))
    if digest(model_path) != selection["modelSHA256"]:
        raise ValueError("Selected model changed after validation selection")
    if digest(test_path) != EXPECTED_TEST_SHA256:
        raise ValueError("Frozen test set changed")
    model = load_model(model_path)
    if digest(ROOT / "data/train_seed.jsonl") != selection["seedSHA256"] or digest(ROOT / "data/validation.jsonl") != selection["validationSHA256"]:
        raise ValueError("Training or validation inputs changed")
    test = rows(test_path)
    training, validation = rows(ROOT / "data/train_seed.jsonl"), rows(ROOT / "data/validation.jsonl")
    from dataset import augment
    prior = {normalize(r["text"]) for r in augment(training)+validation}
    overlap = [r["id"] for r in test if normalize(r["text"]) in prior]
    if overlap or len({normalize(r["text"]) for r in test}) != len(test):
        raise ValueError(f"Exact normalized overlap/duplicates: {overlap}")
    if {r["family"] for r in test} & {r["family"] for r in training+validation}:
        raise ValueError("Family overlap")
    predictions, latencies = [], []
    for row in test:
        began = time.perf_counter()
        output = classify_text(row["text"],model)
        latencies.append((time.perf_counter()-began)*1000)
        predictions.append({**row,"prediction":output})
    gold = [r["label"] for r in test]
    raw = [r["prediction"]["topLabel"] for r in predictions]
    decided = [r["prediction"]["label"] for r in predictions]
    actionable = [r for r in predictions if r["prediction"]["label"] in SUPPORTED]
    correct_actions = sum(r["label"] == r["prediction"]["label"] for r in actionable)
    supported_count = sum(label in SUPPORTED for label in gold)
    metrics = {"evaluatedAtUTC":datetime.now(timezone.utc).isoformat(),"testSHA256":digest(test_path),"modelSHA256":digest(model_path),
               "dataType":"Independently assistant-authored synthetic requests; not real users", "testCount":len(test),
               "raw":score(gold,raw,model["labels"]),"withAbstention":score(gold,decided,model["labels"]),
               "actionable":{"count":len(actionable),"coverageAll":len(actionable)/len(test),"supportedRequestCoverage":sum(r["label"] in SUPPORTED for r in actionable)/supported_count,"correct":correct_actions,"precision":correct_actions/len(actionable) if actionable else None,"wronglyAcceptedUnsupported":sum(r["label"]=="unsupported" for r in actionable),"wronglyAcceptedClarify":sum(r["label"]=="clarify" for r in actionable)},
               "language":{language:{"count":sum(r["language"]==language for r in predictions),"rawAccuracy":statistics.mean(r["label"]==r["prediction"]["topLabel"] for r in predictions if r["language"]==language)} for language in sorted({r["language"] for r in test})},
               "majorityBaselineAccuracy":max(Counter(gold).values())/len(gold),"latencyMs":{"median":statistics.median(latencies),"p95":sorted(latencies)[min(len(latencies)-1,int(len(latencies)*.95))],"environment":"Python standard-library CPU inference on this machine; excludes loading/download and is not a browser benchmark"},
               "modelBytes":model_path.stat().st_size,"leakageAudit":{"exactNormalizedOverlap":0,"familyOverlap":0,"testUsedForModelSelection":False,"nearDuplicateSemanticOverlapNotGuaranteedAbsent":True},
               "caveats":["Small synthetic sample; no production/general-user accuracy claim", "Softmax confidence is uncalibrated", "Abstention is not a medical or security safety guarantee", "No retraining or threshold tuning after this test; further improvement requires a new holdout"]}
    report_path.parent.mkdir(parents=True,exist_ok=True)
    report_path.write_text(json.dumps(metrics,ensure_ascii=False,indent=2),encoding="utf-8")
    (ROOT / "reports/test_predictions.jsonl").write_text("\n".join(json.dumps(r,ensure_ascii=False) for r in predictions)+"\n",encoding="utf-8")
    def pct(x): return f"{x*100:.1f}%" if x is not None else "N/A"
    lines = ["# NextSet 小型分类模型：独立测试报告", "", "这是完成训练后的第一轮独立合成测试。模型和阈值在读取此测试集之前已冻结。", "", "**全部数据由助手编写，不是真实用户数据。以下结果不能当作真实健身房用户的准确率。**", "", "| 指标 | 结果 |", "| --- | --- |",
             f"| 测试请求 | {len(test)} 条，7 类，每类 15 条 |",f"| 原始七分类准确率 | {pct(metrics['raw']['accuracy'])} |",f"| 原始 macro F1 | {metrics['raw']['macroF1']:.3f} |",f"| 多数类基线准确率 | {pct(metrics['majorityBaselineAccuracy'])} |",f"| 加入追问后的七类标签准确率 | {pct(metrics['withAbstention']['accuracy'])} |",f"| 直接给出训练类别的请求 | {len(actionable)}/{len(test)}（{pct(metrics['actionable']['coverageAll'])}） |",f"| 这些直接分类中正确的比例 | {correct_actions}/{len(actionable)}（{pct(metrics['actionable']['precision'])}） |",f"| 把超出范围请求误接受为训练类别 | {metrics['actionable']['wronglyAcceptedUnsupported']} 条 |",f"| 把应澄清请求误接受为训练类别 | {metrics['actionable']['wronglyAcceptedClarify']} 条 |",f"| 模型文件大小 | {metrics['modelBytes']/1024/1024:.2f} MiB |",f"| 本机 Python 推理中位耗时 | {metrics['latencyMs']['median']:.2f} ms，不含加载 |", "", "追问策略会减少直接输出的数量。不能只报告被接受请求的正确率而省略覆盖率；两者必须同时说明。分数是未校准的 softmax 值，不是某次判断正确的真实概率。", "", "## 按语言的原始准确率", "", "| 语言 | 数量 | 准确率 |", "| --- | --- | --- |"]
    for lang,m in metrics["language"].items(): lines.append(f"| {lang} | {m['count']} | {pct(m['rawAccuracy'])} |")
    lines += ["", "## 按类别的原始表现", "", "| 类别 | Precision | Recall | F1 | 数量 |", "| --- | --- | --- | --- | --- |"]
    for label,m in metrics["raw"]["perClass"].items(): lines.append(f"| {LABEL_NAMES[label]} ({label}) | {m['precision']:.3f} | {m['recall']:.3f} | {m['f1']:.3f} | {m['support']} |")
    lines += ["", "## 原始混淆矩阵", "", "行是真实标签，列是模型预测；完整顺序如下。", "", "| 真实 / 预测 | "+" | ".join(model["labels"])+" |", "| --- | "+" | ".join(["---"]*len(model["labels"]))+" |"]
    for label,row in zip(model["labels"],metrics["raw"]["confusionMatrix"]): lines.append("| "+label+" | "+" | ".join(map(str,row))+" |")
    mistakes = [r for r in predictions if r["label"] != r["prediction"]["topLabel"]]
    lines += ["", "## 错误示例与后续工作", "", "下面展示第一批错误，而不是挑选成功示例。完整逐条结果在 test_predictions.jsonl。", "", "| 请求 | 真实类别 | 原始预测 | 最终输出 |", "| --- | --- | --- | --- |"]
    for r in mistakes[:12]: lines.append(f"| {r['text'].replace('|','/')} | {r['label']} | {r['prediction']['topLabel']} | {r['prediction']['label']} |")
    lines += ["", "此版本保留当前结果，没有根据最终测试反向修改训练数据或阈值。后续应收集真实且经同意的中英文请求，独立标注否定、修正、医学限制和未支持需求，并另建新的测试集后改进模型。当前模型只做需求类别判断，不提取完整时间/器械限制，不开训练处方，也不预测器械使用时长。", "", "## 复现与证据", "", f"- 模型 SHA-256：`{metrics['modelSHA256']}`", f"- 冻结测试 SHA-256：`{metrics['testSHA256']}`", "- 训练选择记录：model/selection.json；所有参数选择仅使用 validation.jsonl。", "- 原始指标：reports/metrics.json；逐条预测：reports/test_predictions.jsonl。", "- 推理速度是本机 CPU 的 Python 实测，不代表浏览器或手机的速度。", ""]
    (ROOT / "reports/Evaluation.md").write_text("\n".join(lines),encoding="utf-8")
    print(json.dumps({"testCount":len(test),"rawAccuracy":metrics["raw"]["accuracy"],"macroF1":metrics["raw"]["macroF1"],"actionable":metrics["actionable"],"modelBytes":metrics["modelBytes"],"report":str(ROOT / "reports/Evaluation.md")},ensure_ascii=False,indent=2))

if __name__ == "__main__": main()
