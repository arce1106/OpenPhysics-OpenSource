"""CLI pipeline: parse docx → extract fragments → (future: AI extract → import)."""
import argparse
import json
import sys
from pathlib import Path


def main():
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
    from app.services.doc_parser import DocParser, DocParserError
    ap = argparse.ArgumentParser(description="Extract question fragments from Word docs")
    ap.add_argument("docs", nargs="+", help="Word document paths")
    ap.add_argument("--output", "-o", default="fragments.json", help="Output JSON file")
    ap.add_argument("--image-dir", default="/tmp/docx_imgs", help="Image extraction directory")
    args = ap.parse_args()

    parser = DocParser(image_output_dir=Path(args.image_dir))
    all_fragments = []

    for doc_path in args.docs:
        path = Path(doc_path)
        if not path.exists():
            print(f"SKIP: {path} not found")
            continue
        print(f"Parsing: {path.name}...")
        try:
            fragments = parser.parse(path)
        except DocParserError as e:
            print(f"  ERROR: {e}")
            continue
        print(f"  → {len(fragments)} question fragments")
        all_fragments.extend(fragments)

    # Serialize
    output = [{
        "source_doc": f.source_doc,
        "fragment_index": f.fragment_index,
        "raw_text": f.raw_text,
        "image_paths": [str(p) for p in f.image_paths],
        "section_hint": f.section_hint,
        "question_type_hint": f.question_type_hint,
    } for f in all_fragments]

    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print(f"\nDone: {len(all_fragments)} fragments → {args.output}")


if __name__ == "__main__":
    main()
