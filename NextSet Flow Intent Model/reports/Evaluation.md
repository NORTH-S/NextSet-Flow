# NextSet 小型分类模型：独立测试报告

这是完成训练后的第一轮独立合成测试。模型和阈值在读取此测试集之前已冻结。

**全部数据由助手编写，不是真实用户数据。以下结果不能当作真实健身房用户的准确率。**

| 指标 | 结果 |
| --- | --- |
| 测试请求 | 105 条，7 类，每类 15 条 |
| 原始七分类准确率 | 72.4% |
| 原始 macro F1 | 0.722 |
| 多数类基线准确率 | 14.3% |
| 加入追问后的七类标签准确率 | 58.1% |
| 直接给出训练类别的请求 | 42/105（40.0%） |
| 这些直接分类中正确的比例 | 36/42（85.7%） |
| 把超出范围请求误接受为训练类别 | 1 条 |
| 把应澄清请求误接受为训练类别 | 0 条 |
| 模型文件大小 | 1.36 MiB |
| 本机 Python 推理中位耗时 | 0.20 ms，不含加载 |

追问策略会减少直接输出的数量。不能只报告被接受请求的正确率而省略覆盖率；两者必须同时说明。分数是未校准的 softmax 值，不是某次判断正确的真实概率。

## 按语言的原始准确率

| 语言 | 数量 | 准确率 |
| --- | --- | --- |
| en | 35 | 77.1% |
| mixed | 35 | 68.6% |
| zh | 35 | 71.4% |

## 按类别的原始表现

| 类别 | Precision | Recall | F1 | 数量 |
| --- | --- | --- | --- | --- |
| 需要澄清 (clarify) | 0.600 | 0.600 | 0.600 | 15 |
| 全身 (full) | 0.929 | 0.867 | 0.897 | 15 |
| 腿部 (legs) | 0.714 | 0.667 | 0.690 | 15 |
| 拉类训练 (pull) | 0.833 | 0.667 | 0.741 | 15 |
| 推类训练 (push) | 0.722 | 0.867 | 0.788 | 15 |
| 超出支持范围 (unsupported) | 0.722 | 0.867 | 0.788 | 15 |
| 上半身 (upper) | 0.571 | 0.533 | 0.552 | 15 |

## 原始混淆矩阵

行是真实标签，列是模型预测；完整顺序如下。

| 真实 / 预测 | clarify | full | legs | pull | push | unsupported | upper |
| --- | --- | --- | --- | --- | --- | --- | --- |
| clarify | 9 | 0 | 0 | 1 | 1 | 3 | 1 |
| full | 1 | 13 | 0 | 0 | 0 | 0 | 1 |
| legs | 0 | 1 | 10 | 0 | 1 | 0 | 3 |
| pull | 1 | 0 | 0 | 10 | 3 | 1 | 0 |
| push | 0 | 0 | 1 | 1 | 13 | 0 | 0 |
| unsupported | 1 | 0 | 0 | 0 | 0 | 13 | 1 |
| upper | 3 | 0 | 3 | 0 | 0 | 1 | 8 |

## 错误示例与后续工作

下面展示第一批错误，而不是挑选成功示例。完整逐条结果在 test_predictions.jsonl。

| 请求 | 真实类别 | 原始预测 | 最终输出 |
| --- | --- | --- | --- |
| I was going to train my shoulders, but change that to a lower-body workout. | legs | upper | clarify |
| No upper-body work this time. I want to focus on my lower half using machines. | legs | upper | clarify |
| 我今天不练肩背，只想练下半身，最多半个小时。 | legs | full | clarify |
| Not an upper-body session today；我要的是臀腿训练。 | legs | upper | upper |
| 原本写了 push day，改一下，今天确定练 legs。 | legs | push | push |
| Leave my legs out of today's plan and work the upper half of my body. | upper | legs | clarify |
| Back training is my only goal this afternoon, mostly on seated equipment. | upper | unsupported | clarify |
| Change the lower-body plan to upper body; use the same thirty-minute window. | upper | clarify | clarify |
| 今天上半身整体练一下，不单独分推日或者拉日。 | upper | clarify | clarify |
| 想练胸，二十五分钟结束，别给我安排其他部位。 | upper | clarify | clarify |
| Upper body 为主，今天不要 lower body。 | upper | legs | clarify |
| Not legs after all，我最后决定做上肢训练。 | upper | legs | clarify |

此版本保留当前结果，没有根据最终测试反向修改训练数据或阈值。后续应收集真实且经同意的中英文请求，独立标注否定、修正、医学限制和未支持需求，并另建新的测试集后改进模型。当前模型只做需求类别判断，不提取完整时间/器械限制，不开训练处方，也不预测器械使用时长。

## 复现与证据

- 模型 SHA-256：`2cc05f9ab7a3a71c398facfcc2ff473fb98052d1daef2e5c0d1e497d2e536df9`
- 冻结测试 SHA-256：`46f20728db7f349a95a7d0a4ab37c3a8ccdb4bc8eec809e2c210eefd1de00da4`
- 训练选择记录：model/selection.json；所有参数选择仅使用 validation.jsonl。
- 原始指标：reports/metrics.json；逐条预测：reports/test_predictions.jsonl。
- 推理速度是本机 CPU 的 Python 实测，不代表浏览器或手机的速度。
