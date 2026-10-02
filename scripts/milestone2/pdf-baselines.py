"""Read actual PDF text origins; word bounding boxes do not establish baselines."""
import json
import sys
import pymupdf

with pymupdf.open(sys.argv[1]) as document:
    result = []
    for block in document[0].get_text("rawdict")["blocks"]:
        for line in block.get("lines", []):
            spans = line["spans"]
            if not spans or line["dir"] != (1.0, 0.0):
                continue
            text = "".join(char["c"] for span in spans for char in span["chars"])
            if text.strip():
                result.append({"text": text, "x": spans[0]["origin"][0], "baseline": spans[0]["origin"][1]})
    print(json.dumps(result))
