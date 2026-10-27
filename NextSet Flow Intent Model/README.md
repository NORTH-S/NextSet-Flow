# NextSet Flow：独立小型需求分类模型

这是实际训练完成的监督学习模型，使用 **TF-IDF 字符特征 + 多类逻辑回归**，没有调用任何大模型 API，也没有下载预训练模型权重。模型参数来自本项目的训练数据。

它只判断训练需求属于哪一类：腿部 `legs`、上半身 `upper`、全身 `full`、推类 `push`、拉类 `pull`、需要澄清 `clarify`、超出范围 `unsupported`。**本轮没有训练时间/器械偏好提取、完整计划生成、动作安全判断或器械使用时间预测。**

## 直接试用

双击本文件夹中的 **Try NextSet Classifier.html**。模型和推理代码已内嵌，打开后可以断网使用，不需要 API Key、ChatGPT 登录或本地服务器。

输入中文、英文或中英混合请求，点击 **Classify my request**。界面显示最终类别、前三个模型分数，以及不确定时的追问。分数没有经过概率校准，不等同于“这个判断有多少概率正确”。

需要查看模块版网页时，可在本文件夹运行：

```powershell
python -m http.server 4180 --bind 127.0.0.1
```

浏览器打开 `http://127.0.0.1:4180/preview/`；使用完 Ctrl+C 停止。本次没有完成浏览器视觉检查，运行时行为使用独立测试验证。

## 使用模型

Python 推理只需要标准库：

```powershell
python runtime/classifier.py "今天想练腿，时间大概半小时。"
```

若 `python` 不在 PATH，可用已安装解释器的完整路径运行同一命令；macOS/Linux 通常使用 `python3`。运行跨语言测试时也可通过 `NEXTSET_PYTHON` 指定解释器。

JavaScript 使用 `runtime/classifier.js` 中的 `classifyText(text, model)`，其中 `model` 为解析后的 `model/model.json`。输出包含 `label`、`topLabel`、`confidence`、`margin`、`candidates`、`needsClarification`、`reason` 和明确的 `source: trained-local-classifier`。

## 数据与实际表现

- 350 条助手编写的训练种子语句，每类 50 条；仅在训练集增加时间/排队上下文后为 1,050 条。增强样本不是新的独立用户。
- 98 条验证语句用于选择超参数和追问阈值。
- 105 条由另一位贡献者独立编写、提前冻结的最终合成测试；训练和参数选择没有使用它们。
- 全部数据均为合成文本，没有真实用户记录、健身房测量或人工专家评审，因此不能宣称真实用户准确率。

**实际测试结果和错误样例见 `reports/Evaluation.md`。** 原始逐条预测在 `reports/test_predictions.jsonl`，可审查是否错误理解否定、修正或超出范围的请求。模型会犯错；`unsupported` 是有限拒绝类别，不能作为医疗或安全过滤器。

此文件夹保留可独立审查的冻结模型；同一模型现已集成到相邻 `NextSet Flow Demo` 的实时调度页面。集成仅增加规则字段提取、确认流程和调度连接，没有重新训练或降低模型阈值。

## 复现训练与检查

训练需要 Python 与 `requirements-training.txt` 中的依赖，推理和离线 HTML 不需要这些依赖。已安装的依赖目录不包含在仓库中；复现训练前请安装列出的依赖。

```powershell
python -m pip install -r requirements-training.txt
python train.py --output model-reproduced
node --test tests/*.test.mjs
```

固定随机种子和相同依赖版本用于复现权重与预测。已复现出完全相同的特征、权重、偏置和追问策略，证据在 `reports/reproducibility.json`。时间戳和耗时写入元数据，因此整个文件的 SHA 不要求逐字节相同。已经评估过的 `model/` 被训练脚本保护，避免在看过最终测试后覆盖原版本。

`evaluate.py` 对最终测试只允许首次运行。其后若根据错误修改数据或模型，应另收集新的未使用测试集。原始模型、测试哈希和验证阶段的全部六个候选结果均保存在 `model/selection.json` 与测试报告中。

修改网页或模型后可运行 `python build_preview.py` 重新生成离线试用文件。

## 主要文件

| 文件 | 用途 |
| --- | --- |
| `model/model.json` | 训练得到的特征、权重、偏置和追问策略 |
| `model/selection.json` | 参数选择、输入数据哈希与训练记录 |
| `runtime/classifier.py`、`runtime/classifier.js` | 不依赖机器学习库的推理实现 |
| `train.py`、`dataset.py` | 可复现的训练及训练集增强 |
| `data/*.jsonl` | 可审查的训练、验证和最终测试文本 |
| `reports/Evaluation.md` | 实际准确率、覆盖率、混淆矩阵与错误 |
| `Try NextSet Classifier.html` | 双击即用的独立离线试用界面 |

方法参考：[TF-IDF](https://scikit-learn.org/stable/modules/generated/sklearn.feature_extraction.text.TfidfVectorizer.html)、[逻辑回归](https://scikit-learn.org/stable/modules/generated/sklearn.linear_model.LogisticRegression.html)。
