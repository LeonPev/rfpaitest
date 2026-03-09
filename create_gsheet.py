"""
Creates a Google Sheet from the SOW analysis and vendor research CSVs.
Usage:
  1. Follow SETUP.md for credentials
  2. pip install gspread google-auth google-auth-oauthlib
  3. python create_gsheet.py
"""

import csv
import os
import gspread
from gspread.exceptions import APIError

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
SOW_DIR = os.path.join(BASE_DIR, "data", "SOW")
ANALYSIS_CSV = os.path.join(SOW_DIR, "sow_analysis.csv")
VENDOR_CSV = os.path.join(SOW_DIR, "vendor_research.csv")
CREDENTIALS_FILE = os.path.join(BASE_DIR, "credentials.json")

# Local base path for file:// hyperlinks (Windows)
LOCAL_BASE = "file:///C:/Users/Kimi/Desktop/src/rfpaitest/"


def docx_path(folder: str, filename: str) -> str:
    rel = f"data/SOW/{folder}/{filename}.docx"
    return LOCAL_BASE + rel.replace(" ", "%20")


def fixed_path(filename: str) -> str:
    rel = f"data/SOW/fixed/{filename}.md"
    return LOCAL_BASE + rel.replace(" ", "%20")


def hyperlink(url: str, label: str) -> str:
    return f'=HYPERLINK("{url}","{label}")'


def read_csv(path: str) -> tuple[list[str], list[list[str]]]:
    with open(path, encoding="utf-8-sig") as f:
        reader = csv.reader(f)
        rows = [r for r in reader if any(r)]
    if not rows:
        return [], []
    return rows[0], rows[1:]


def col_idx(headers: list[str], name: str) -> int:
    for i, h in enumerate(headers):
        if h.strip() == name.strip():
            return i
    return -1


def build_overview(headers: list[str], rows: list[list[str]]) -> tuple[list[str], list[list]]:
    cols = ["שם הקובץ", "תיקייה", "קטגוריית רכש", "תאריך", "ניתן לקריאה",
            "ציון", "דירוג", "נימוק", "קישור ל-DOCX מקורי", "קישור לגרסה משופרת"]

    idx = {c: col_idx(headers, c) for c in [
        "שם הקובץ", "תיקייה", "קטגוריית רכש", "תאריך", "ניתן לקריאה",
        "ציון", "דירוג", "נימוק", "קישור לגרסה משופרת"
    ]}

    out = []
    for r in rows:
        def get(c):
            i = idx.get(c, -1)
            return r[i] if i >= 0 and i < len(r) else ""

        name = get("שם הקובץ")
        folder = get("תיקייה")
        improved_rel = get("קישור לגרסה משופרת")

        docx_url = docx_path(folder, name)
        improved_url = LOCAL_BASE + improved_rel.replace(" ", "%20") if improved_rel else ""

        row = [
            name,
            folder,
            get("קטגוריית רכש"),
            get("תאריך"),
            get("ניתן לקריאה"),
            get("ציון"),
            get("דירוג"),
            get("נימוק"),
            hyperlink(docx_url, "פתח DOCX") if name else "",
            hyperlink(improved_url, "גרסה משופרת") if improved_url else "",
        ]
        out.append(row)

    return cols, out


def write_sheet(ws, headers: list, rows: list, freeze_row: bool = True):
    all_rows = [headers] + rows
    ws.update(all_rows, value_input_option="USER_ENTERED")
    if freeze_row:
        ws.freeze(rows=1)
    # Bold header
    ws.format("1:1", {"textFormat": {"bold": True}})


def main():
    print("Reading CSVs...")
    analysis_headers, analysis_rows = read_csv(ANALYSIS_CSV)
    vendor_headers, vendor_rows = read_csv(VENDOR_CSV)

    print("Authenticating with Google...")
    try:
        gc = gspread.oauth(credentials_filename=CREDENTIALS_FILE)
    except FileNotFoundError:
        print(
            f"\n[ERROR] credentials.json not found at: {CREDENTIALS_FILE}\n"
            "Please follow the instructions in GSHEET_SETUP.md to download credentials."
        )
        return

    print("Creating Google Sheet...")
    sh = gc.create("SOW Analysis - RFP AI")

    # ── Tab 1: Overview ───────────────────────────────────────────────────────
    ws1 = sh.sheet1
    ws1.update_title("סקירה כללית")
    ov_headers, ov_rows = build_overview(analysis_headers, analysis_rows)
    write_sheet(ws1, ov_headers, ov_rows)

    # ── Tab 2: Full SOW Analysis ──────────────────────────────────────────────
    ws2 = sh.add_worksheet("ניתוח מפורט", rows=50, cols=len(analysis_headers) + 2)
    write_sheet(ws2, analysis_headers, analysis_rows)

    # ── Tab 3: Vendor Research ────────────────────────────────────────────────
    ws3 = sh.add_worksheet("מחקר ספקים", rows=50, cols=len(vendor_headers) + 2)
    write_sheet(ws3, vendor_headers, vendor_rows)

    # Share publicly viewable (anyone with link can view)
    sh.share(None, perm_type="anyone", role="reader")

    url = f"https://docs.google.com/spreadsheets/d/{sh.id}"
    print(f"\n✅ Done! Google Sheet created:\n{url}\n")
    return url


if __name__ == "__main__":
    main()
