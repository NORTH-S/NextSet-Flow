"""Package an offline, double-clickable model preview without any API/server."""
from pathlib import Path
import json
import re

ROOT = Path(__file__).resolve().parent

def main():
    html = (ROOT / "preview/index.html").read_text(encoding="utf-8")
    css = (ROOT / "preview/styles.css").read_text(encoding="utf-8")
    app = (ROOT / "preview/app.js").read_text(encoding="utf-8")
    runtime = re.sub(r"^export ", "", (ROOT / "runtime/classifier.js").read_text(encoding="utf-8"), flags=re.M)
    model = json.loads((ROOT / "model/model.json").read_text(encoding="utf-8"))
    load_start = app.index("try {\n  if (globalThis.location?.protocol === 'file:')")
    app = app[:load_start] + """try {
  model = __NEXTSET_MODEL__;
  classifyText = __NEXTSET_RUNTIME__.classifyText;
  $('#model-status').innerHTML = '<i></i>Model ready · offline';
  setBusy(false);
} catch {
  $('#input-message').textContent = 'The bundled model could not load. Please review the model files.';
}
updateCount();
"""
    javascript = "(() => {\nconst __NEXTSET_RUNTIME__ = (() => {\n"+runtime+"\nreturn {classifyText};\n})();\nconst __NEXTSET_MODEL__ = "+json.dumps(model,ensure_ascii=False,separators=(",",":"))+";\n"+app+"\n})();"
    javascript = re.sub(r"</script", r"<\\/script", javascript, flags=re.I)
    output = re.sub(r'<link rel="stylesheet" href="\./styles\.css">', lambda _:"<style>\n"+css+"\n</style>", html)
    output = output.replace('<script type="module" src="./app.js"></script>',"<script>\n"+javascript+"\n</script>")
    if output == html or 'src="./app.js"' in output or 'href="./styles.css"' in output:
        raise ValueError("Preview shell changed; refusing an incomplete bundle")
    if "fetch(" in javascript or "import(" in javascript:
        raise ValueError("Offline preview must not fetch a model or call any API")
    target = ROOT / "Try NextSet Classifier.html"
    target.write_text(output,encoding="utf-8")
    print(json.dumps({"offlinePreview":str(target),"bytes":target.stat().st_size},ensure_ascii=False))

if __name__ == "__main__": main()
