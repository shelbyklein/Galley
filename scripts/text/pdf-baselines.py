"""Actual PDF text origins in page points. Bbox centers are not baselines."""
import json,sys
import pymupdf
document=pymupdf.open(sys.argv[1])
page=document[int(sys.argv[2])-1 if len(sys.argv)>2 else 0]
print(json.dumps([{"text":s["text"],"x":s["origin"][0],"y":s["origin"][1],"size":s["size"],"font":s["font"],"bbox":s["bbox"]}
    for block in page.get_text("dict")["blocks"] if "lines" in block
    for line in block["lines"] for s in line["spans"]]))
