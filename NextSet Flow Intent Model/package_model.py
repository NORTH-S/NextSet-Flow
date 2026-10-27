"""Create an auditable source/model bundle, excluding installation and QA files."""
from pathlib import Path
from datetime import datetime, timezone
import hashlib
import json
import zipfile

ROOT = Path(__file__).resolve().parent
EXCLUDE = {".training-deps", "__pycache__", ".git", "qa"}

def selected_files():
    return sorted(path for path in ROOT.rglob("*") if path.is_file() and not any(part in EXCLUDE for part in path.relative_to(ROOT).parts) and not path.name.startswith(".env") and path.name != "MANIFEST.json")

def main():
    files = selected_files()
    manifest={"createdAtUTC":datetime.now(timezone.utc).isoformat(),"version":"1.0.0","files":{p.relative_to(ROOT).as_posix():{"sha256":hashlib.sha256(p.read_bytes()).hexdigest(),"bytes":p.stat().st_size} for p in files},"excludes":sorted(EXCLUDE)}
    (ROOT / "MANIFEST.json").write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding="utf-8")
    archive=ROOT.parent / "NextSet Flow Intent Model.zip"
    with zipfile.ZipFile(archive,"w",zipfile.ZIP_DEFLATED,compresslevel=9) as output:
        for path in files+[ROOT / "MANIFEST.json"]:
            output.write(path,Path(ROOT.name) / path.relative_to(ROOT))
    print(json.dumps({"archive":str(archive),"bytes":archive.stat().st_size,"files":len(files)+1},ensure_ascii=False))

if __name__ == "__main__": main()
