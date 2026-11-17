"""Download public model weights only. Never reads or transmits product content."""
import hashlib
import json
import shutil
import stat
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "data/manual-klook-html/local-translation"
MODELS = (
    ("en_ru", "https://data.argosopentech.com/argospm/v1/translate-en_ru-1_9.argosmodel"),
    ("ru_en", "https://data.argosopentech.com/argospm/v1/translate-ru_en-1_9.argosmodel"),
)

def main():
    ROOT.mkdir(parents=True, exist_ok=True)
    records = []
    for pair, url in MODELS:
        archive = ROOT / (pair + ".argosmodel")
        target = ROOT / pair
        if target.exists():
            raise ValueError("Model target already exists; refusing overwrite: " + pair)
        if not archive.exists() or not zipfile.is_zipfile(archive):
            # Public distribution server supports HTTP Range. Sequential bounded
            # chunks resume a partial local archive without reopening a long stream.
            with urllib.request.urlopen(urllib.request.Request(url, method="HEAD"), timeout=30) as response:
                total = int(response.headers["Content-Length"])
            if not 0 < total <= 512 * 1024 * 1024:
                raise ValueError("Model archive too large")
            offset = archive.stat().st_size if archive.exists() else 0
            if offset > total:
                raise ValueError("Existing partial archive larger than source; refusing overwrite")
            while offset < total:
                end = min(offset + 1024 * 1024, total) - 1
                request = urllib.request.Request(url, headers={"Range": f"bytes={offset}-{end}"})
                with urllib.request.urlopen(request, timeout=30) as response:
                    if response.status != 206 or response.headers.get("Content-Range") != f"bytes {offset}-{end}/{total}":
                        raise ValueError("Unexpected range response; stopped without appending")
                    chunk = response.read(end - offset + 2)
                if len(chunk) != end - offset + 1:
                    raise ValueError("Incomplete model chunk")
                with archive.open("ab") as output:
                    output.write(chunk)
                offset += len(chunk)
                if offset % (16 * 1024 * 1024) == 0 or offset == total:
                    print(f"{pair}: {offset}/{total} bytes", flush=True)
            print(pair + " downloaded", flush=True)
        digest = hashlib.file_digest(archive.open("rb"), "sha256").hexdigest()
        with zipfile.ZipFile(archive) as package:
            if sum(m.file_size for m in package.infolist()) > 2 * 1024 * 1024 * 1024:
                raise ValueError("Expanded model archive too large")
            metadata_files = [n for n in package.namelist() if n.count("/") == 1 and n.endswith("/metadata.json")]
            if len(metadata_files) != 1:
                raise ValueError("Unexpected model layout")
            prefix = metadata_files[0].split("/")[0] + "/"
            metadata = json.loads(package.read(metadata_files[0]))
            if (metadata.get("from_code"), metadata.get("to_code")) != tuple(pair.split("_")):
                raise ValueError("Unexpected model language")
            target.mkdir()
            for member in package.infolist():
                if not member.filename.startswith(prefix):
                    continue
                relative = Path(member.filename[len(prefix):])
                if relative.is_absolute() or ".." in relative.parts or stat.S_ISLNK(member.external_attr >> 16):
                    raise ValueError("Unsafe archive path")
                # Only inert inference data and documentation; no bundled code or auxiliary models.
                if not relative.parts or relative.parts[0] not in ("model", "sentencepiece.model", "metadata.json", "README.md", "LICENSE", "LICENSE.txt"):
                    continue
                destination = target / relative
                if member.is_dir():
                    destination.mkdir(parents=True, exist_ok=True)
                else:
                    destination.parent.mkdir(parents=True, exist_ok=True)
                    with package.open(member) as source, destination.open("xb") as output:
                        shutil.copyfileobj(source, output)
            if not (target / "model/model.bin").is_file() or not (target / "sentencepiece.model").is_file():
                raise ValueError("Missing inference data")
        records.append({"pair": pair, "url": url, "sha256": digest, "archiveBytes": archive.stat().st_size, "metadata": metadata})
        print(pair + " installed locally", flush=True)
    (ROOT / "model-provenance.json").write_text(json.dumps(records, ensure_ascii=False, indent=2), encoding="utf-8")

if __name__ == "__main__":
    main()
