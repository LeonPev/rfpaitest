"""
IDF Procurement AI — Flask server
Session persistence, project management, MD/PDF export, feedback analytics.
"""

import os, uuid, json, tempfile, traceback, time
from pathlib import Path
from datetime import datetime

from flask import Flask, request, jsonify, Response, send_from_directory, stream_with_context
from flask_cors import CORS
from dotenv import load_dotenv

import agents as ag

load_dotenv()

BASE_DIR   = Path(__file__).parent.parent
STATIC_DIR = Path(__file__).parent / "static"
DATA_DIR   = BASE_DIR / "data"
PROJECTS_DIR = DATA_DIR / "projects"
FEEDBACK_DIR = DATA_DIR / "feedback"
GENERATED_DIR = DATA_DIR / "generated"

# Ensure directories exist
PROJECTS_DIR.mkdir(parents=True, exist_ok=True)
FEEDBACK_DIR.mkdir(parents=True, exist_ok=True)
GENERATED_DIR.mkdir(parents=True, exist_ok=True)

app = Flask(__name__, static_folder=str(STATIC_DIR))
CORS(app)

SESSIONS: dict = {}   # session_id → live session data


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _save_project(project: dict):
    """Persist project to JSON file."""
    pid = project["id"]
    path = PROJECTS_DIR / f"{pid}.json"
    project["updated_at"] = datetime.now().isoformat()
    with open(path, "w", encoding="utf-8") as f:
        json.dump(project, f, ensure_ascii=False, indent=2)


def _load_project(pid: str) -> dict | None:
    path = PROJECTS_DIR / f"{pid}.json"
    if not path.exists():
        return None
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def _load_all_projects() -> list:
    projects = []
    for p in PROJECTS_DIR.glob("*.json"):
        try:
            with open(p, "r", encoding="utf-8") as f:
                projects.append(json.load(f))
        except Exception:
            continue
    projects.sort(key=lambda x: x.get("updated_at", ""), reverse=True)
    return projects


def _save_feedback(feedback: dict):
    """Append feedback event to analytics log."""
    log_path = FEEDBACK_DIR / "feedback_log.jsonl"
    feedback["timestamp"] = datetime.now().isoformat()
    with open(log_path, "a", encoding="utf-8") as f:
        f.write(json.dumps(feedback, ensure_ascii=False) + "\n")


def _load_feedback_log() -> list:
    log_path = FEEDBACK_DIR / "feedback_log.jsonl"
    if not log_path.exists():
        return []
    entries = []
    with open(log_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                try:
                    entries.append(json.loads(line))
                except Exception:
                    continue
    return entries


# ─── Static / Data ───────────────────────────────────────────────────────────

@app.route("/")
def index():
    return send_from_directory(str(STATIC_DIR), "index.html")

@app.route("/<path:filename>")
def static_files(filename):
    if filename.startswith("data/"):
        rel    = filename[len("data/"):]
        target = DATA_DIR / rel
        return send_from_directory(str(target.parent), target.name)
    return send_from_directory(str(STATIC_DIR), filename)


# ─── Doc discovery ───────────────────────────────────────────────────────────

@app.route("/api/docs")
def api_docs():
    return jsonify(ag.list_sow_docs())

@app.route("/api/suggest", methods=["POST"])
def api_suggest():
    body  = request.json or {}
    query = body.get("query", "")
    return jsonify(ag.suggest_docs(query))


# ─── Initial analysis (dynamic first message) ───────────────────────────────

@app.route("/api/initial-analysis")
def api_initial_analysis():
    """Generate dynamic initial analysis for dashboard/chat."""
    user_name = request.args.get("user", "דנה")
    result = ag.generate_initial_analysis(user_name)
    return jsonify(result)


# ─── Chat ────────────────────────────────────────────────────────────────────

@app.route("/api/chat", methods=["POST"])
def api_chat():
    body           = request.json or {}
    message        = body.get("message", "").strip()
    history        = body.get("history", [])
    selected_files = body.get("selected_files", [])

    if not message:
        return jsonify({"error": "Empty message"}), 400

    available_docs = ag.list_sow_docs()

    try:
        result = ag.chat_recommend(message, history, available_docs, selected_files)
        return jsonify(result)
    except Exception as e:
        return jsonify({
            "message": f"שגיאה: {str(e)[:200]}",
            "recommended_files": [],
            "suggested_actions": [],
            "proposed_prompt": None,
            "ready_to_generate": False,
        })


# ─── Project management ─────────────────────────────────────────────────────

@app.route("/api/projects")
def api_projects():
    """List all projects."""
    return jsonify(_load_all_projects())


@app.route("/api/projects", methods=["POST"])
def api_create_project():
    """Create a new project."""
    body = request.json or {}
    project = {
        "id": str(uuid.uuid4()),
        "name": body.get("name", "פרויקט חדש"),
        "status": "wip",  # pending, wip, completed
        "created_at": datetime.now().isoformat(),
        "updated_at": datetime.now().isoformat(),
        "file_paths": body.get("file_paths", []),
        "context": body.get("context", ""),
        "sub_type": body.get("sub_type", "כללי"),
        "result": None,
        "chat_history": body.get("chat_history", []),
        "feedback": [],
        "generated_file": None,
    }
    _save_project(project)
    return jsonify(project)


@app.route("/api/projects/<pid>")
def api_get_project(pid):
    project = _load_project(pid)
    if not project:
        return jsonify({"error": "Project not found"}), 404
    return jsonify(project)


@app.route("/api/projects/<pid>", methods=["PUT"])
def api_update_project(pid):
    project = _load_project(pid)
    if not project:
        return jsonify({"error": "Project not found"}), 404
    body = request.json or {}
    for key in ["name", "status", "result", "chat_history", "context", "file_paths"]:
        if key in body:
            project[key] = body[key]
    _save_project(project)
    return jsonify(project)


@app.route("/api/projects/<pid>", methods=["DELETE"])
def api_delete_project(pid):
    path = PROJECTS_DIR / f"{pid}.json"
    if path.exists():
        path.unlink()
    return jsonify({"ok": True})


# ─── Session / pipeline ─────────────────────────────────────────────────────

@app.route("/api/start", methods=["POST"])
def api_start():
    session_id = str(uuid.uuid4())
    temp_dir   = tempfile.mkdtemp()
    file_paths = []

    if request.is_json:
        body       = request.get_json()
        file_paths = body.get("file_paths", [])
        context    = body.get("context", "")
        sub_type   = body.get("sub_type", "כללי")
        project_id = body.get("project_id")
    else:
        raw_paths = request.form.get("file_paths", "")
        if raw_paths:
            try:
                file_paths = json.loads(raw_paths)
            except Exception:
                file_paths = [p.strip() for p in raw_paths.split(",") if p.strip()]
        for f in request.files.getlist("files"):
            safe = f.filename.replace("/", "_").replace("\\", "_")
            dest = os.path.join(temp_dir, safe)
            f.save(dest)
            file_paths.append(dest)
        context    = request.form.get("context", "")
        sub_type   = request.form.get("sub_type", "כללי")
        project_id = request.form.get("project_id")

    if not file_paths:
        return jsonify({"error": "No files selected"}), 400

    SESSIONS[session_id] = {
        "file_paths": file_paths,
        "context":    context,
        "sub_type":   sub_type,
        "result":     None,
        "temp_dir":   temp_dir,
        "project_id": project_id,
    }
    return jsonify({"session_id": session_id})


@app.route("/api/stream/<session_id>")
def api_stream(session_id):
    if session_id not in SESSIONS:
        return jsonify({"error": "Session not found"}), 404

    session = SESSIONS[session_id]

    def generate():
        try:
            for event in ag.run_pipeline(
                session["file_paths"],
                session["context"],
                session["sub_type"],
            ):
                yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
                if event.get("type") == "complete":
                    session["result"] = event["result"]
                    # Auto-save to project if linked
                    pid = session.get("project_id")
                    if pid:
                        project = _load_project(pid)
                        if project:
                            project["result"] = event["result"]
                            project["status"] = "wip"
                            _save_project(project)
        except Exception as e:
            err_event = {"type": "error", "msg": str(e)}
            yield f"data: {json.dumps(err_event, ensure_ascii=False)}\n\n"
            traceback.print_exc()

    return Response(
        stream_with_context(generate()),
        mimetype="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.route("/api/session/<session_id>")
def api_session(session_id):
    session = SESSIONS.get(session_id)
    if not session:
        return jsonify({"error": "Session not found"}), 404
    return jsonify({"result": session.get("result"), "ready": session.get("result") is not None})


# ─── Feedback ────────────────────────────────────────────────────────────────

@app.route("/api/feedback", methods=["POST"])
def api_feedback():
    data       = request.json or {}
    session_id = data.get("session_id")
    item_id    = data.get("id")
    action     = data.get("action")
    text       = data.get("text", "")
    project_id = data.get("project_id")

    # Save feedback event for analytics
    _save_feedback({
        "session_id": session_id,
        "project_id": project_id,
        "item_id": item_id,
        "action": action,
        "text": text,
        "type": "section_feedback",
    })

    session = SESSIONS.get(session_id)
    if not session or not session.get("result"):
        return jsonify({"error": "Session not ready"}), 404

    result = session["result"]
    for doc in result.get("documents", []):
        for s in doc.get("sections", []) + doc.get("qa_items", []):
            if s.get("id") == item_id:
                s["status"] = action
                if text:
                    if action == "edit":
                        s["updated"] = text
                    s["feedback_note"] = text
                # Auto-save to project
                pid = session.get("project_id") or project_id
                if pid:
                    project = _load_project(pid)
                    if project:
                        project["result"] = result
                        _save_project(project)
                return jsonify({"ok": True})

    return jsonify({"error": "Item not found"}), 404


@app.route("/api/accept-all", methods=["POST"])
def api_accept_all():
    data       = request.json or {}
    session_id = data.get("session_id")
    project_id = data.get("project_id")
    session    = SESSIONS.get(session_id)
    if not session or not session.get("result"):
        return jsonify({"error": "Session not ready"}), 404

    result = session["result"]
    count = 0
    for doc in result.get("documents", []):
        for s in doc.get("sections", []) + doc.get("qa_items", []):
            if s.get("status") == "pending":
                s["status"] = "accept"
                count += 1

    # Save feedback event
    _save_feedback({
        "session_id": session_id,
        "project_id": project_id,
        "action": "accept_all",
        "count": count,
        "type": "batch_action",
    })

    # Auto-save to project
    pid = session.get("project_id") or project_id
    if pid:
        project = _load_project(pid)
        if project:
            project["result"] = result
            project["status"] = "completed"
            _save_project(project)

    return jsonify({"ok": True, "count": count})


# ─── Export ──────────────────────────────────────────────────────────────────

@app.route("/api/export-markdown/<session_id>")
def api_export_md(session_id):
    """Export as Markdown matching IDF SOW template."""
    session = SESSIONS.get(session_id)
    result = None
    if session and session.get("result"):
        result = session["result"]
    else:
        project = _load_project(session_id)
        if project and project.get("result"):
            result = project["result"]

    if not result:
        return jsonify({"error": "Not ready"}), 404

    md = ag.generate_markdown_output(result)

    # Save to generated dir
    timestamp = datetime.now().strftime('%Y%m%d_%H%M')
    safe_name = f"SOW_{session_id[:8]}_{timestamp}.md"
    try:
        gen_path = GENERATED_DIR / safe_name
        with open(gen_path, "w", encoding="utf-8") as f:
            f.write(md)
    except Exception:
        pass  # Non-critical: saving copy to disk

    return jsonify({"content": md, "filename": safe_name})


@app.route("/api/export/pdf/<session_id>")
def api_export_pdf(session_id):
    """Export as styled HTML designed for PDF printing, matching IDF SOW template."""
    session = SESSIONS.get(session_id)
    result = None
    if session and session.get("result"):
        result = session["result"]
    else:
        project = _load_project(session_id)
        if project and project.get("result"):
            result = project["result"]

    if not result:
        return jsonify({"error": "Not ready"}), 404

    # Generate MD first
    md = ag.generate_markdown_output(result)
    html = _build_idf_pdf_html(result, md)

    return Response(
        html, mimetype="text/html; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="SOW_IDF_2026.html"'},
    )


@app.route("/api/export/<session_id>")
def api_export(session_id):
    """Legacy HTML export."""
    session = SESSIONS.get(session_id)
    if not session or not session.get("result"):
        return jsonify({"error": "Not ready"}), 404
    html = _build_export_html(session["result"])
    return Response(
        html, mimetype="text/html",
        headers={"Content-Disposition": 'attachment; filename="SOW_updated_2026.html"'},
    )


def _build_idf_pdf_html(result: dict, md_content: str) -> str:
    """Build IDF-styled HTML for PDF export from markdown content."""
    title = result.get("tender_title", "SOW מעודכן")

    # Convert markdown to HTML sections
    sections_html = ""
    lines = md_content.split("\n")
    in_blockquote = False
    current_section = []

    for line in lines:
        if line.startswith("# "):
            continue  # skip title, handled separately
        elif line.startswith("## ") and not line.startswith("## גרסה"):
            # Flush current section
            if current_section:
                sections_html += "</div>\n"
            sec_title = line[3:].strip()
            sections_html += f'<div class="section"><h2>{sec_title}</h2>\n'
            current_section = [sec_title]
        elif line.startswith("> **[P1"):
            sections_html += f'<div class="priority p1">{line[2:]}</div>\n'
        elif line.startswith("> **[P2"):
            sections_html += f'<div class="priority p2">{line[2:]}</div>\n'
        elif line.startswith("> *"):
            sections_html += f'<div class="priority-reason">{line[2:]}</div>\n'
        elif line.startswith("### "):
            sections_html += f'<h3>{line[4:]}</h3>\n'
        elif line.startswith("- "):
            sections_html += f'<li>{line[2:]}</li>\n'
        elif line.startswith("---"):
            if current_section:
                sections_html += "</div>\n"
                current_section = []
        elif line.strip():
            sections_html += f'<p>{line}</p>\n'

    if current_section:
        sections_html += "</div>\n"

    return f"""<!DOCTYPE html>
<html dir="rtl" lang="he">
<head>
<meta charset="UTF-8">
<title>{title}</title>
<style>
  @page {{
    size: A4;
    margin: 2cm 2.5cm;
  }}
  @media print {{
    body {{ margin: 0; }}
    .section {{ break-inside: avoid; }}
    .no-print {{ display: none; }}
  }}
  body {{
    font-family: "David", "Arial Hebrew", Arial, "Helvetica Neue", sans-serif;
    direction: rtl; text-align: right;
    max-width: 800px; margin: 0 auto; padding: 2rem;
    background: white; color: #1a1a1a; line-height: 1.8;
    font-size: 12pt;
  }}
  .cover {{
    border-bottom: 3px double #1e3a5f;
    padding-bottom: 1.5rem;
    margin-bottom: 2rem;
    text-align: center;
  }}
  .cover h1 {{
    color: #1e3a5f;
    font-size: 18pt;
    margin: 0 0 .3rem;
    font-weight: 700;
  }}
  .cover .sub {{
    color: #1e3a5f;
    font-size: 11pt;
    font-weight: 600;
  }}
  .cover .meta {{
    color: #64748b;
    font-size: 9pt;
    margin-top: .5rem;
  }}
  .cover .logo {{
    font-size: 10pt;
    color: #1e3a5f;
    font-weight: 700;
    margin-bottom: 1rem;
    letter-spacing: .05em;
  }}
  .disclaimer {{
    background: #f8f9fa;
    border: 1px solid #dee2e6;
    border-radius: 4px;
    padding: .75rem 1rem;
    font-size: 9pt;
    color: #495057;
    margin-bottom: 2rem;
  }}
  .section {{
    margin: 1.5rem 0;
    padding-bottom: 1rem;
    border-bottom: 1px solid #e9ecef;
  }}
  h2 {{
    color: #1e3a5f;
    font-size: 14pt;
    font-weight: 700;
    margin: 0 0 .5rem;
    border-right: 4px solid #1e3a5f;
    padding-right: .75rem;
  }}
  h3 {{
    color: #2c3e50;
    font-size: 12pt;
    font-weight: 600;
    margin: .75rem 0 .3rem;
  }}
  p {{
    color: #334155;
    font-size: 11pt;
    margin: .3rem 0;
  }}
  li {{
    color: #334155;
    font-size: 11pt;
    margin: .2rem 0;
    padding-right: .5rem;
  }}
  .priority {{
    border-radius: 4px;
    padding: .4rem .75rem;
    font-size: 9pt;
    font-weight: 700;
    margin: .5rem 0;
  }}
  .p1 {{
    background: #fff3cd;
    border-right: 4px solid #dc3545;
    color: #856404;
  }}
  .p2 {{
    background: #d1ecf1;
    border-right: 4px solid #17a2b8;
    color: #0c5460;
  }}
  .priority-reason {{
    font-size: 9pt;
    color: #6c757d;
    font-style: italic;
    margin: .2rem 0 .5rem;
    padding-right: 1rem;
  }}
  footer {{
    text-align: center;
    color: #94a3b8;
    font-size: 8pt;
    margin-top: 3rem;
    padding-top: 1rem;
    border-top: 2px solid #1e3a5f;
  }}
  .btn-print {{
    display: inline-block;
    background: #1e3a5f;
    color: white;
    padding: .6rem 2rem;
    border: none;
    border-radius: 6px;
    font-size: 11pt;
    cursor: pointer;
    margin: 1rem auto;
    font-family: inherit;
  }}
  .btn-print:hover {{ background: #2c5282; }}
</style>
</head>
<body>
<div class="cover">
  <div class="logo">מדינת ישראל — משרד הביטחון</div>
  <h1>{title}</h1>
  <div class="sub">מסמך תכולת עבודה (SOW) — גרסה משופרת</div>
  <div class="meta">הופק ע"י מערכת AI לרכש חכם — {datetime.now().strftime('%d/%m/%Y')}</div>
</div>

<div class="disclaimer">
מסמך זה וכל נספחיו הינו בבעלות בלעדית של משרד הביטחון.
חל איסור להעבירו לצד שלישי ללא אישור בכתב ומראש של משרד הביטחון.
</div>

<div class="no-print" style="text-align:center">
  <button class="btn-print" onclick="window.print()">הדפס / שמור PDF</button>
</div>

{sections_html}

<footer>
מסמך זה הופק אוטומטית ע"י מערכת AI לרכש חכם — מרץ 2026<br>
מיועד לעיון לפני אישור סופי ע"י הגורמים המוסמכים
</footer>
</body>
</html>"""


def _build_export_html(result):
    title    = result.get("tender_title", "SOW מעודכן")
    sections = []
    for doc in result.get("documents", []):
        if doc.get("type") == "sow":
            sections = doc.get("sections", [])
            break

    accepted = [s for s in sections if s.get("status") != "reject"]

    change_labels = {
        "added":     ("חדש",      "#dcfce7", "#16a34a"),
        "modified":  ("עודכן",    "#fef9c3", "#ca8a04"),
        "unchanged": ("ללא שינוי","#f1f5f9", "#64748b"),
    }

    rows = []
    for s in accepted:
        ct    = s.get("change_type", "unchanged")
        label, bg, col = change_labels.get(ct, ("", "#fff", "#333"))
        text  = s.get("updated") or s.get("original") or ""
        rows.append(f"""
  <div class="section">
    <div class="sec-header">
      <span class="sec-num">{s.get('number','')}</span>
      <span class="sec-title">{s.get('title','')}</span>
      <span class="badge" style="background:{bg};color:{col}">{label}</span>
    </div>
    <div class="sec-body">{text.replace(chr(10), '<br>')}</div>
    {"<div class='reason'>" + s.get('change_reason','') + "</div>" if s.get('change_reason') else ""}
  </div>""")

    return f"""<!DOCTYPE html>
<html dir="rtl" lang="he">
<head>
<meta charset="UTF-8">
<title>{title}</title>
<style>
  @media print {{ body {{ margin: 1cm; }} .section {{ break-inside: avoid; }} }}
  body {{
    font-family: "David", "Arial Hebrew", Arial, sans-serif;
    direction: rtl; text-align: right;
    max-width: 900px; margin: 0 auto; padding: 2.5rem;
    background: #f8fafc; color: #1e293b; line-height: 1.7;
  }}
  .cover {{ border-bottom: 3px solid #1e3a5f; padding-bottom: 1.5rem; margin-bottom: 2rem; }}
  .cover h1 {{ color: #1e3a5f; font-size: 1.6rem; margin: 0 0 .4rem; }}
  .cover .meta {{ color: #64748b; font-size: .9rem; }}
  .section {{ background: white; border-radius: 8px; padding: 1.5rem; margin: 1rem 0;
    box-shadow: 0 1px 3px rgba(0,0,0,.06); border: 1px solid #e2e8f0; }}
  .sec-header {{ display: flex; align-items: baseline; gap: .6rem; margin-bottom: .75rem; flex-wrap: wrap; }}
  .sec-num {{ font-weight: 700; color: #1e3a5f; min-width: 2rem; }}
  .sec-title {{ font-weight: 700; font-size: 1.05rem; color: #1e293b; flex: 1; }}
  .badge {{ font-size: .72rem; font-weight: 700; padding: .15rem .55rem; border-radius: 20px; }}
  .sec-body {{ color: #334155; font-size: .95rem; }}
  .reason {{ margin-top: .75rem; padding-right: .75rem; border-right: 3px solid #e2e8f0;
    color: #64748b; font-size: .85rem; }}
  footer {{ text-align: center; color: #94a3b8; font-size: .8rem;
    margin-top: 3rem; padding-top: 1rem; border-top: 1px solid #e2e8f0; }}
</style>
</head>
<body>
<div class="cover">
  <h1>{title}</h1>
  <div class="meta">הופק אוטומטית ע"י מערכת AI לרכש חכם | {len(accepted)} סעיפים מאושרים</div>
</div>
{"".join(rows)}
<footer>מסמך זה הופק אוטומטית ומיועד לעיון לפני אישור סופי | מרץ 2026</footer>
</body>
</html>"""


# ─── Analytics ───────────────────────────────────────────────────────────────

@app.route("/api/analytics")
def api_analytics():
    """Return analytics dashboard data."""
    projects = _load_all_projects()
    feedback = _load_feedback_log()

    total_projects = len(projects)
    completed = sum(1 for p in projects if p.get("status") == "completed")
    wip = sum(1 for p in projects if p.get("status") == "wip")
    pending = sum(1 for p in projects if p.get("status") == "pending")

    total_feedback = len(feedback)
    accepts = sum(1 for f in feedback if f.get("action") in ("accept", "accept_all"))
    rejects = sum(1 for f in feedback if f.get("action") == "reject")
    edits   = sum(1 for f in feedback if f.get("action") == "edit")

    # Cost estimation (rough: ~$0.01 per Gemini Flash call)
    api_calls = total_feedback + total_projects * 3  # ~3 calls per project
    estimated_cost = round(api_calls * 0.01, 2)

    # Adoption rate: accepted / (accepted + rejected)
    adoption_rate = round(accepts / max(accepts + rejects, 1) * 100)

    return jsonify({
        "projects": {
            "total": total_projects,
            "completed": completed,
            "wip": wip,
            "pending": pending,
        },
        "feedback": {
            "total": total_feedback,
            "accepts": accepts,
            "rejects": rejects,
            "edits": edits,
            "adoption_rate": adoption_rate,
        },
        "costs": {
            "api_calls": api_calls,
            "estimated_cost_usd": estimated_cost,
        },
        "recent_projects": projects[:10],
    })


# ─── Save session to project ────────────────────────────────────────────────

@app.route("/api/save-session", methods=["POST"])
def api_save_session():
    """Save current session as a project (for abort recovery)."""
    body       = request.json or {}
    session_id = body.get("session_id")
    name       = body.get("name", "פרויקט ללא שם")

    session = SESSIONS.get(session_id)
    project = {
        "id": session_id or str(uuid.uuid4()),
        "name": name,
        "status": "wip" if session and session.get("result") else "pending",
        "created_at": datetime.now().isoformat(),
        "updated_at": datetime.now().isoformat(),
        "file_paths": session.get("file_paths", []) if session else body.get("file_paths", []),
        "context": session.get("context", "") if session else body.get("context", ""),
        "sub_type": session.get("sub_type", "כללי") if session else body.get("sub_type", "כללי"),
        "result": session.get("result") if session else None,
        "chat_history": body.get("chat_history", []),
        "feedback": [],
        "generated_file": None,
    }
    _save_project(project)
    return jsonify(project)


if __name__ == "__main__":
    print("=" * 55)
    print("  IDF SOW Generator — Production")
    print("  http://localhost:5001")
    print("=" * 55)
    app.run(port=5001, debug=True, use_reloader=False, threaded=True)
