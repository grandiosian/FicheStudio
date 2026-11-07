#!/usr/bin/env python3
"""
Convertit le programme de technologie du cycle 4 (classeur Prog_Acad_Techno_College_5-4-3.xlsx)
en src/data/referentiel.json, avec les codes du BO n°9 du 29/02/2024 (TxCyz).

    python3 tools/referentiel.py chemin/vers/Prog_Acad_Techno_College_5-4-3.xlsx

Thèmes : OST -> T1, SFC -> T2, CCRI -> T3 ; « SFC 31 » -> T2C31.
"""
import html, json, re, sys, zipfile
from pathlib import Path

THEMES = {"OST": "T1", "SFC": "T2", "CCRI": "T3"}

def sheets(path):
    z = zipfile.ZipFile(path)
    ss = z.read("xl/sharedStrings.xml").decode()
    strings = [html.unescape(re.sub(r"<[^>]+>", "", m)) for m in re.findall(r"<si>(.*?)</si>", ss, re.S)]
    names = re.findall(r'<sheet [^>]*name="([^"]+)"', z.read("xl/workbook.xml").decode())
    for i, name in enumerate(names, 1):
        x = z.read(f"xl/worksheets/sheet{i}.xml").decode()
        rows = []
        for body in re.findall(r"<row [^>]*>(.*?)</row>", x, re.S):
            body = re.sub(r"<c [^>]*/>", "", body)  # cellules vides
            cells = []
            for ref, attrs, inner in re.findall(r'<c r="([A-Z]+)\d+"([^>]*)>(.*?)</c>', body, re.S):
                v = re.search(r"<v>(.*?)</v>", inner, re.S)
                t = re.search(r"<t[^>]*>(.*?)</t>", inner, re.S)
                val = strings[int(v.group(1))] if (v and 't="s"' in attrs) else (html.unescape(t.group(1)) if t else (v.group(1) if v else ""))
                if val.strip():
                    cells.append(val.strip())
            if cells:
                rows.append(cells)
        yield name, rows

def items(text):
    """« 1/ Faire… 2/ Repérer… » -> liste d'attendus."""
    parts = re.split(r"(?:^|\s)\d+\s?/\s?", text)
    out = [re.sub(r"\s+", " ", p).replace("- ", "").strip(" \n") for p in parts]
    return [p for p in out if p]

def knowledge(text):
    lines = [re.sub(r"^[*o•]\s*", "", l).strip() for l in text.split("\n")]
    return [l for l in lines if l]

def main(src, dst):
    themes = []
    for name, rows in sheets(src):
        m = re.match(r"Programme C4 - (\w+)", name)
        if not m:
            continue
        abbr = m.group(1)
        t = {"code": THEMES[abbr], "abbr": abbr, "title": rows[0][0].split(" - ", 1)[-1], "competences": []}
        comp = None
        for i, r in enumerate(rows):
            head = re.match(rf"^{abbr}\s?(\d)(\d)?\s*-\s*(.+)$", r[0], re.S) if len(r) == 1 else None
            if not head:
                continue
            g, s, title = head.group(1), head.group(2), re.sub(r"\s+", " ", head.group(3)).strip()
            if not s:
                comp = {"code": f"{t['code']}C{g}", "abbr": f"{abbr} {g}", "title": title, "subs": []}
                t["competences"].append(comp)
                continue
            nxt = rows[i + 1] if i + 1 < len(rows) else []
            # attendus 5e, 4e, 3e puis connaissances ; certaines lignes n'ont pas de 5e
            levels = ["5", "4", "3"] if len(nxt) >= 4 else ["4", "3"]
            sub = {"code": f"{t['code']}C{g}{s}", "abbr": f"{abbr} {g}{s}", "title": title,
                   "niveaux": {lv: items(nxt[k]) for k, lv in enumerate(levels) if k < len(nxt) - 1},
                   "connaissances": knowledge(nxt[-1]) if nxt else []}
            comp["subs"].append(sub)
        themes.append(t)
    data = {"source": "Programme de technologie du cycle 4 — BO n°9 du 29/02/2024", "themes": themes}
    Path(dst).write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    n = sum(len(c["subs"]) for t in themes for c in t["competences"])
    print(f"{len(themes)} thèmes, {sum(len(t['competences']) for t in themes)} compétences, {n} sous-compétences -> {dst}")

if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else str(Path(__file__).resolve().parent.parent / "src/data/referentiel.json"))
