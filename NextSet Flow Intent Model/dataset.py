"""Training-only context augmentation; never add or change a focus label."""
from runtime.classifier import normalize

def augment(seeds):
    rows = []
    for row in seeds:
        rows.append(dict(row))
        variants = ([f"I have 25 minutes. {row['text']}", f"{row['text']} Please minimise queueing."] if row["language"] == "en" else
                    [f"我今天有半小时。{row['text']}", f"{row['text']} 尽量少排队。"] if row["language"] == "zh" else
                    [f"30 minutes available. {row['text']}", f"{row['text']}，尽量用器械。"])
        for i,text in enumerate(variants):
            rows.append({**row,"id":f"{row['id']}-aug{i+1}","text":text,"augmentation":"time-or-queue-context"})
    unique = {}
    for row in rows:
        key=normalize(row["text"])
        if key in unique and unique[key]["label"] != row["label"]:
            raise ValueError("Conflicting augmentation")
        unique[key]=row
    return list(unique.values())
