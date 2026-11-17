"""Offline CPU EN<->RU inference. stdin/stdout JSON; no downloader or API client."""
import json
import re
import socket
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "data/manual-klook-html/local-translation"
sys.path.insert(0, str(ROOT / "packages"))
sys.stdin.reconfigure(encoding="utf-8")
sys.stdout.reconfigure(encoding="utf-8")

def no_network(*args, **kwargs):
    raise RuntimeError("Network disabled in local translator")

socket.create_connection = no_network
socket.socket.connect = no_network
socket.socket.connect_ex = no_network
socket.socket.sendto = no_network

def main():
    import ctranslate2
    import sentencepiece
    raw = sys.stdin.read(1000001)
    if len(raw) > 1000000:
        raise ValueError("Request too large")
    tasks = json.loads(raw)
    if not isinstance(tasks, list) or len(tasks) > 20:
        raise ValueError("Expected at most 20 translation tasks")
    models = {}
    result = []
    for task in tasks:
        pair = task.get("from", "") + "_" + task.get("to", "")
        if pair not in ("en_ru", "ru_en") or not re.fullmatch(r"[a-f0-9]{64}", task.get("sourceHash", "")):
            raise ValueError("Invalid task language or hash")
        value = task.get("text")
        if not isinstance(value, str) or not value.strip() or len(value) > 20000:
            raise ValueError("Invalid source text")
        if pair not in models:
            directory = ROOT / pair
            metadata = json.loads((directory / "metadata.json").read_text(encoding="utf-8"))
            if metadata.get("from_code") + "_" + metadata.get("to_code") != pair:
                raise ValueError("Model language mismatch")
            models[pair] = (
                ctranslate2.Translator(str(directory / "model"), device="cpu", compute_type="int8", inter_threads=1, intra_threads=4),
                sentencepiece.SentencePieceProcessor(model_file=str(directory / "sentencepiece.model")),
                metadata.get("target_prefix", ""),
            )
        translator, tokenizer, prefix = models[pair]
        tokens = tokenizer.encode(value, out_type=str)
        segments = []
        start = 0
        while start < len(tokens):
            end = min(start + 192, len(tokens))
            if end < len(tokens):
                while end > start + 128 and not tokens[end].startswith("▁"):
                    end -= 1
            segments.append(tokens[start:end])
            start = end
        outputs = translator.translate_batch(
            segments, target_prefix=[[prefix]] * len(segments) if prefix else None,
            beam_size=2, max_batch_size=16, max_input_length=192,
            max_decoding_length=1024, replace_unknowns=True,
        )
        translated = []
        for output in outputs:
            sentence = tokenizer.decode(output.hypotheses[0])
            if prefix and sentence.startswith(prefix):
                sentence = sentence[len(prefix):]
            translated.append(sentence.strip())
        result.append({"key": task["key"], "sourceHash": task["sourceHash"], "targetText": " ".join(translated)})
    print(json.dumps(result, ensure_ascii=False))

if __name__ == "__main__":
    main()
