# /sow-analysis — SOW Document Intelligence Pipeline

A complete skill for analyzing, rating, improving, and researching procurement Statement of Work (SOW) documents, with optional vendor research and website generation.

---

## What This Skill Does

Given a folder of SOW documents (any mix of `.docx`, `.md`, `.pdf`), this skill:

1. **Converts & reads** all documents, detecting encoding issues
2. **Web-researches** relevant standards (ISO, EN, MIL-STD, national procurement law) per category
3. **Scores & rates** each document 1–5 across 12 analytical dimensions
4. **Creates improved versions** of all documents with annotated changes (P1/P2/P3)
5. **Researches vendors** per procurement category
6. **Produces structured outputs**: analysis CSV, vendor CSV, fixed docs, optional website

---

## Invocation

```
/sow-analysis
```

Optionally add arguments:
```
/sow-analysis path=data/SOW categories=medical,food,furniture output=website
```

---

## Input

Point to a directory containing SOW files. Supported formats:
- `.md` (preferred — already converted)
- `.docx` (will be read via python-docx if available)
- `.pdf` (will be read page by page)
- `.msg` / `.xlsx` — flagged as unreadable, noted in output

The skill auto-detects:
- **Category** from filename and content keywords
- **Date** from filename patterns and content
- **Encoding issues** (corrupted UTF-8 Hebrew)
- **Document completeness** (skeleton vs. full SOW)

---

## Phase 1 — Web Research

For each document's procurement category, search for:

| Target | Search Terms |
|--------|-------------|
| Israeli law | "חוק חובת מכרזים", "כללי מינהל רכש", "תקנות רכש ממשלתי ישראל" |
| MOD/IDF specific | "DOPP Israel procurement", "משרד הביטחון SOW תבנית" |
| International military | "NATO STANAG procurement", "US DoD SOW MIL-HDBK-245E", "UK MOD commercial contracts" |
| Domain standards | Per category (see table below) |
| Competition law | "EU WTO GPA government procurement", "חוק חובת מכרזים תחרות" |

**Domain standards by category:**

| Category | Key Standards |
|----------|--------------|
| ציוד רפואי / מכשור כירורגי | ISO 13485, EU MDR 2017/745, FDA QMSR 2026, GDP/GMP |
| מזון (פרי/ירק/כריכים) | ISO 22000, HACCP (Codex), EU 1169/2011 (allergens), MRL EC 396/2005 |
| חומרי ניקוי | ISO 9001, BPR EU 528/2012, REACH EC 1907/2006 |
| ריהוט / כסאות | EN 16139:2013, EN 12520, EN 1022, EN 1728 |
| כלי מטבח | EN 12983-1:1999, EN 631-1:1993, REACH |
| חומרי גומי/ספוגים | MIL-STD (with equivalency), BS EN 13501-1 (fire resistance) |
| חומרי הדברה | ISO 14001, EPA registration, ADR transport |
| כללי | ISO 20400 (sustainable procurement), CIPS standards |

**For each source found: record URL + key actionable tip.**

---

## Phase 2 — Document Scoring (1–5)

Score each readable document on a 1–5 scale:

| Score | Label | Criteria |
|-------|-------|----------|
| 5 | מעולה | Complete, professional, all 12 dimensions addressed, multi-revision maturity, legal safeguards, KPIs |
| 4 | טוב | Solid foundation, minor gaps (missing KPIs, no recall clause, no price indexing) |
| 3 | בינוני | Moderate quality: significant encoding issues OR 30–50% of required sections missing |
| 2 | גרוע | Major gaps: only financial terms, or severe encoding corruption making it unusable |
| 1 | גרוע מאוד | Skeleton only: title + outline, no substantive content |
| — | לא קריא | Binary format (MSG, XLSX) or fully unreadable — cannot be scored |

### 12 Analysis Dimensions

For each document, evaluate all 12 dimensions separated by ` | `:

```
ציות ורגולציה: [legal/regulatory compliance assessment]
סיכון פיננסי: [financial risks — price indexing, penalty mechanisms]
סיכון משפטי: [legal exposure — enforceability, dispute resolution]
ישימות ספקים: [vendor market — how many can realistically bid?]
שיטות עבודה מומלצות SOW: [SOW best practices — structure, KPIs, SLA]
מומחיות תחומית: [domain expertise assessment — correct standards?]
לוגיקה כללית: [internal consistency and clarity]
תחרותיות: [competition promotion — LOTs, equivalency clauses]
צבא/ביטחון: [military/security context — emergency protocols, classification]
המלצות עסקיות: [business recommendations]
המלצות טכניות: [technical recommendations]
סיכום ושלבים הבאים: [summary and next steps]
```

### Recommendations Structure (P1/P2/P3)

```
P1 (קריטי): [1–3 must-fix items — blocking issues] |
P2 (חשוב): [2–4 important improvements] |
P3 (מומלץ): [2–4 nice-to-have enhancements]
```

---

## Phase 3 — Fixed Documents

Create an improved `.md` version of each document in a `fixed/` subdirectory.

### Approach by Score

| Score | Approach |
|-------|----------|
| 5 | Enrich with all 12 dimensions; add competition & vendor clauses; P2/P3 only |
| 4 | Add missing sections (emergency detail, legal safeguards, LOTs); P1 + P2 + P3 |
| 3 | Major restructuring: fix encoding, fill missing sections; mostly P1 items |
| 2 | Full rewrite using gold-standard structure; all content is P1 |
| 1 | Complete new document from scratch using category-appropriate template |

### Change Annotation Format

Mark every change with a priority blockquote:

```markdown
> **[P1 — שינוי קריטי]** הוספת סעיף recall מפורש
> *סיבה: מסמך מקורי חסר מנגנון לפינוי מוצרים פגומים — סיכון בטיחותי וחוזי קריטי.*

[new or modified content here]

> **[P2 — שיפור חשוב]** הוספת טבלת KPI מדידה
> *סיבה: ביצועי ספק לא ניתנים לאכיפה ללא ציוני יעד מספריים.*
```

### Gold-Standard SOW Structure (use as template)

```markdown
## 1. כללי — מטרת ההתקשרות
## 2. מסמכים ישימים + תקנים (ציין תקנים EN/ISO ספציפיים)
## 3. הגדרות (כל מונח משפטי/תפעולי)
## 4. LOTs — פיצול לעידוד תחרות (אם רלוונטי)
## 5. חבילת השירות:
   - 5.1 זמני אספקה (שגרה / תיעדוף / דחוף / חירום)
   - 5.2 סכום מינימום לאספקה
   - 5.3 עיצומים על איחורים (טבלה: ימים → %)
## 6. מאפיינים טכניים ותקנים
## 7. הבטחת איכות (אישור דגמים, KPI מספרי, ביקורות)
## 8. Recall / הוצאה מהשוב (חובה לציוד בטיחות-קריטי)
## 9. שרשרת קירור / אחסון מיוחד (אם רלוונטי)
## 10. קטלוג דיגיטלי (מרקט / Punchout)
## 11. אנשי קשר ושעות פעילות
## 12. ביטחון מידע + עיצום על דליפה
## 13. מצב חירום / שעת חירום / מלחמה
## 14. פיקוח, עיצומים ויישוב סכסוכים
## 15. נספחים (רשימת פריטים, מלאי חירום, טבלת SLA/עיצומים)
```

---

## Phase 4 — Vendor Research

For each procurement category, find 3–5 relevant vendors (Israeli preferred, international if relevant).

### Vendor Research CSV Columns

```
קטגוריית רכש | שם ספק | מדינה/מיקום | אתר |
ישימות עם SOW (1-5) | נימוק ישימות | מחסומים עיקריים |
המלצות להתאמת ה-SOW
```

### Vendor Feasibility Scale

| Score | Meaning |
|-------|---------|
| 5 | Can fully comply with SOW as-is; proven track record |
| 4 | Can comply with minor adjustments; some gaps in documentation |
| 3 | Partial compliance; significant barriers but addressable |
| 2 | Major gaps; SOW rewrite needed before they could bid |
| 1 | Fundamental mismatch; cannot realistically participate |

**Key questions per vendor:**
- Does the vendor have ISO/EN certification matching SOW requirements?
- Can they meet geographic coverage + emergency response times?
- Are there security clearance barriers for defense work?
- Does the SOW inadvertently lock out competitors (restrictive MIL-STD without equivalency)?

---

## Output Files

| File | Description |
|------|-------------|
| `sow_analysis.csv` | 15-column table, one row per document |
| `vendor_research.csv` | Vendor feasibility table |
| `vendor_research.md` | Human-readable vendor report |
| `fixed/[filename].md` | Improved document version (×N) |
| `website/` | Optional static website (see below) |

### sow_analysis.csv — 15 Columns

```
שם הקובץ | תיקייה | פורמטים קיימים | קטגוריית רכש | תאריך |
ניתן לקריאה | בעיות קידוד | ציון | דירוג | נימוק |
ניתוח מפורט ומה צריך תיקון | ממצאי מחקר חיצוני |
ישימות ספקים | המלצות מדורגות | קישור לגרסה משופרת
```

---

## Phase 5 — Website (Optional)

If `output=website` is requested, generate a static dashboard:

```
[output_dir]/
  website/
    index.html    — RTL Hebrew SPA
    style.css     — Score-based color coding, professional design
    app.js        — Chart.js + marked.js, filters, modal viewer
    data.js       — All analysis data as JS constants
  start_server.py — Python HTTP server (port 8080)
  create_gdocs.py — Convert fixed docs → DOCX → Google Drive
  gdoc_links.json — Populated after create_gdocs.py runs
```

**Website features:**
- Score distribution chart (Chart.js horizontal bar)
- Document grid with filter by score / category / search
- Click card → modal: 5 tabs (ניתוח | מחקר | ספקים | המלצות | מסמך משופר)
- Inline markdown rendering of fixed documents (marked.js via HTTP server)
- Google Doc links (populated after `create_gdocs.py` runs)

---

## Key Design Decisions

### LOT Splitting
Wide-scope SOWs should be split into LOTs to increase competition:
- Each LOT covers a coherent product group (e.g., פלסטיק | מתכת | אחסון)
- Vendors can bid on one, several, or all LOTs
- This is required by WTO GPA principles (Israel is a signatory)

### Equivalency Clauses
Whenever a specific standard (MIL-STD, proprietary spec) is required, add:
> "או שקילות ביצועית מוכחת לפי שיקול דעת המשרד"

This prevents vendor lock-in and is required by Israeli Mandatory Tenders Law (חוק חובת מכרזים 1993).

### Price Indexing
For multi-year contracts, always include:
- Annual CPI adjustment (מדד המחירים לצרכן) or commodity-specific index
- Review date: January 1 each year
- Cap on single-year adjustment (e.g., max 5%)

### Emergency Protocols (Tiers)
All defense/government SOWs should define at least 3 tiers:

| Tier | Hebrew | Response Time |
|------|--------|--------------|
| Routine | שגרה | 15–25 business days |
| Priority | תיעדוף | 5–10 business days |
| Emergency | דחוף | 24–72 hours |
| War/Crisis | שעת חירום | 2–24 hours |

---

## Quality Checklist (before finalizing any fixed doc)

- [ ] Every section from the gold-standard structure is present
- [ ] At least one EN/ISO standard cited per technical category
- [ ] KPI table with measurable targets (%, days, units)
- [ ] Penalty/עיצום table with graduated tiers
- [ ] Recall/withdrawal clause for safety-critical items
- [ ] Emergency supply protocol defined (all 3 tiers)
- [ ] LOT structure or documented rationale for single-lot
- [ ] Price indexing mechanism
- [ ] Dispute resolution clause (בוררות / בית משפט)
- [ ] Information security clause with financial penalty
- [ ] Every P1 change in the fixed doc has a `> **[P1 —` blockquote

---

## Example Usage

```
/sow-analysis

Analyze all SOW documents in data/SOW/.
For each document:
  1. Detect category from filename/content
  2. Search web for domain standards (use the Phase 1 search strategy above)
  3. Score using the 12-dimension framework
  4. Create fixed version in data/SOW/fixed/
  5. Research 3-5 vendors per category

Output:
  - data/SOW/sow_analysis.csv (15 columns)
  - data/SOW/vendor_research.csv + vendor_research.md
  - data/SOW/fixed/[*.md]  (14 improved documents)
  - data/SOW/website/       (static dashboard)
```

---

*Developed during MOD SOW analysis project, March 2026. Tested on 14 Hebrew procurement documents across 9 categories.*
