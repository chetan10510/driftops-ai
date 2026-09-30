from pathlib import Path
from shutil import copy2, copytree, rmtree


root = Path(__file__).resolve().parents[1]
dist = root / "dist"
if dist.exists():
    rmtree(dist)
(dist / "client").mkdir(parents=True)
(dist / "server").mkdir(parents=True)
for name in ("index.html", "styles.css", "app.js", "favicon.svg"):
    copy2(root / "frontend" / name, dist / "client" / name)
copytree(root / "frontend" / "assets", dist / "client" / "assets")
copy2(root / "worker" / "index.js", dist / "server" / "index.js")
(dist / ".openai").mkdir(parents=True)
copy2(root / ".openai" / "hosting.json", dist / ".openai" / "hosting.json")
print(f"Built {dist}")
