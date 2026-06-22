# PDF Supervisor Adapter

Status: phase-1 external worker adapter

The Product & Design OS can reuse the separate `SirRadek/pdf-supervisor`
repository as a local document reader worker. The adapter does not copy that
repository, install dependencies, mutate GitHub, or make `pdf-supervisor` a new
Autopilot source of truth.

## Why External

`pdf-supervisor` is a Python document conversion project. It has a reusable
`document_supervisor` package and a CLI:

```powershell
python -m document_supervisor.cli --source C:\path\input.pdf --out C:\path\output
```

Keeping it external preserves repository boundaries:

- Autopilot owns Product & Design OS routing, reports, and governance.
- `pdf-supervisor` owns PDF/OCR/document conversion implementation.
- The adapter only invokes the local worker and reads reviewable artifacts.

## Configuration

Set the worker root with either an argument or environment variable:

```powershell
$env:PDOS_PDF_SUPERVISOR_ROOT = "C:\path\pdf-supervisor"
npm.cmd run pdos:reader:document -- --check-only
```

Optional Python override:

```powershell
$env:PDOS_DOCUMENT_READER_PYTHON = "python"
```

## Runtime Check

```powershell
npm.cmd run pdos:reader:document -- --check-only --supervisor-root C:\path\pdf-supervisor
```

The check verifies:

- Python availability
- `document_supervisor` module and CLI files
- `requirements-commercial.txt`
- core Python dependencies: `pypdfium2`, `pdfplumber`, `Pillow`, `ftfy`
- optional Tesseract availability

Tesseract is optional for native-text documents, but OCR pages must be treated
as uncertain when Tesseract is unavailable.

## Local Worker Setup

The default local setup keeps the private worker outside tracked Autopilot
source:

```powershell
gh repo clone SirRadek/pdf-supervisor .codex-run\workers\pdf-supervisor
py -3.11 -m venv .codex-run\venvs\pdf-supervisor
.codex-run\venvs\pdf-supervisor\Scripts\python.exe -m pip install -r .codex-run\workers\pdf-supervisor\requirements-commercial.txt
```

Then run the adapter with explicit local paths:

```powershell
npm.cmd run pdos:reader:document -- `
  --check-only `
  --supervisor-root .codex-run\workers\pdf-supervisor `
  --python .codex-run\venvs\pdf-supervisor\Scripts\python.exe
```

The `.codex-run/` worker and venv are local ignored artifacts. Do not commit or
copy the `pdf-supervisor` repository into Autopilot source.

## Conversion

```powershell
npm.cmd run pdos:reader:document -- `
  --source C:\path\file.pdf `
  --output-dir output/document-reader/example `
  --supervisor-root C:\path\pdf-supervisor
```

Expected artifacts:

- `document.clean.md`
- `document.raw.md`
- `validation.report.json`
- `hybrid.routing.json`
- `backcheck.report.json`
- `semantic.review.json`

These artifacts are evidence, not automatic truth. Product & Design OS must
keep uncertain extraction results marked and reviewable.

## Boundaries

Do not use by default:

- cloud/Gemini supervisor passes
- paid services
- PyMuPDF/MuPDF or Ghostscript paths
- OCRmyPDF compatibility profile
- `launcher_ui.py`, benchmark scripts, or legacy pipeline entrypoints

The first approved lane is the commercial-safe local core described by
`pdf-supervisor` itself.
