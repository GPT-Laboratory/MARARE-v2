"""Import multiple files (documents, transcripts, images) and synthesize one template document."""

import json
import os
import traceback
from typing import Any, Dict, List, Optional

from flask import jsonify, request

from python_files.document_import_shared import (
    MAX_MULTI_SOURCE_FILES,
    MAX_MULTI_SOURCE_TOTAL_SIZE,
    MIN_TEXT_CHARS,
    allowed_multi_source_file,
    build_combined_source_text,
    calculate_section_progress,
    extract_all_sources,
    generate_import_meeting_id,
    save_or_update_imported_document,
)
from python_files.import_pregenerated_document import (
    _build_template_section_specs,
    map_document_to_template,
)


def synthesize_sources_to_template(
    sources: List[dict],
    template_sections: List[Dict[str, str]],
    previous_sections: Optional[Dict[str, str]] = None,
) -> Dict[str, Any]:
    """
    Combine multiple extracted sources and map into template sections.
    Reuses map_document_to_template with labeled multi-source context.
    """
    if not sources:
        return {"success": False, "error": "No sources to process"}
    if not template_sections:
        return {"success": False, "error": "No template sections provided"}

    combined_text = build_combined_source_text(sources)
    if len(combined_text.strip()) < MIN_TEXT_CHARS:
        return {
            "success": False,
            "error": (
                f"Could not extract enough text from the uploaded files "
                f"(minimum {MIN_TEXT_CHARS} characters required)"
            ),
        }

    source_summary = ", ".join(
        f"{s['filename']} ({s['type']}, {s.get('char_count', 0)} chars)"
        for s in sources
    )

    enriched_text = (
        f"MULTI-SOURCE IMPORT — {len(sources)} file(s): {source_summary}\n\n"
        "Use ALL sources below together. Images may contain slides, screenshots, or notes. "
        "Documents may be transcripts or finished reports. Assign each fact to the best template section only.\n\n"
        f"{combined_text}"
    )

    return map_document_to_template(
        enriched_text,
        template_sections,
        outline=None,
        previous_sections=previous_sections,
    )


def import_multi_source_document():
    """Accept multiple files, extract content, synthesize template document, and persist."""
    try:
        uploaded_files = request.files.getlist("files")
        if not uploaded_files:
            single = request.files.get("file")
            uploaded_files = [single] if single and single.filename else []

        user_id = request.form.get("userId")
        project_id = request.form.get("projectId")
        project_name = request.form.get("projectName", "")
        use_previous_document = (
            request.form.get("usePreviousDocument", "true").lower() == "true"
        )
        existing_document_id = request.form.get("existingDocumentId") or None

        template_raw = request.form.get("documentTemplate", "{}")
        previous_raw = request.form.get("previousSections", "{}")

        try:
            document_template_data = json.loads(template_raw) if template_raw else {}
            previous_sections = json.loads(previous_raw) if previous_raw else {}
        except json.JSONDecodeError:
            return jsonify({"success": False, "message": "Invalid template JSON"}), 400

        if not user_id:
            return jsonify({"success": False, "message": "User ID is required"}), 400
        if not project_id:
            return jsonify({"success": False, "message": "Project ID is required"}), 400
        if not uploaded_files:
            return jsonify({"success": False, "message": "No files provided"}), 400
        if len(uploaded_files) > MAX_MULTI_SOURCE_FILES:
            return jsonify(
                {
                    "success": False,
                    "message": f"Maximum {MAX_MULTI_SOURCE_FILES} files allowed per upload",
                }
            ), 400

        total_size = 0
        for uploaded_file in uploaded_files:
            if not uploaded_file or not uploaded_file.filename:
                continue
            if not allowed_multi_source_file(uploaded_file.filename):
                return jsonify(
                    {
                        "success": False,
                        "message": (
                            f"Unsupported file: {uploaded_file.filename}. "
                            "Allowed: txt, pdf, docx, jpg, png, webp, gif"
                        ),
                    }
                ), 400
            uploaded_file.seek(0, os.SEEK_END)
            total_size += uploaded_file.tell()
            uploaded_file.seek(0)

        if total_size > MAX_MULTI_SOURCE_TOTAL_SIZE:
            return jsonify(
                {
                    "success": False,
                    "message": "Total upload size exceeds the 30 MB limit",
                }
            ), 400

        template_sections_raw = document_template_data.get("sections") or []
        if not template_sections_raw:
            return jsonify(
                {
                    "success": False,
                    "message": "This project has no document template configured",
                }
            ), 400

        if not use_previous_document:
            previous_sections = {}

        sources = extract_all_sources(uploaded_files)
        categories = document_template_data.get("categories") or {}
        section_specs = _build_template_section_specs(document_template_data, categories)

        mapping_result = synthesize_sources_to_template(
            sources,
            section_specs,
            previous_sections=previous_sections if use_previous_document else {},
        )

        if not mapping_result.get("success"):
            return jsonify(
                {
                    "success": False,
                    "message": mapping_result.get("error", "Document synthesis failed"),
                }
            ), 500

        generated_sections = mapping_result.get("generated_sections", {})
        progress = calculate_section_progress(generated_sections, template_sections_raw)
        meeting_id = generate_import_meeting_id("multi-import")

        saved_document = save_or_update_imported_document(
            user_id=user_id,
            meeting_id=meeting_id,
            project_id=project_id,
            project_name=project_name,
            document_template_data=document_template_data,
            generated_sections=generated_sections,
            undiscussed_topics=mapping_result.get("undiscussed_topics", []),
            meeting_phase="imported",
            progress=progress,
            use_previous_document=use_previous_document,
            existing_document_id=existing_document_id,
            source="multi_source_import",
        )

        total_chars = sum(s.get("char_count", 0) for s in sources)

        return jsonify(
            {
                "success": True,
                "message": "Document generated from multiple sources successfully",
                "document": saved_document,
                "fileCount": len(sources),
                "totalExtractedChars": total_chars,
                "mappedSections": mapping_result.get("mapped_count", 0),
                "totalSections": mapping_result.get("total_sections", 0),
                "sources": [
                    {"filename": s["filename"], "type": s["type"], "charCount": s["char_count"]}
                    for s in sources
                ],
                "meetingId": meeting_id,
            }
        ), 201

    except Exception as exc:
        print(f"Error importing multi-source document: {exc}")
        traceback.print_exc()
        return jsonify(
            {
                "success": False,
                "message": "Failed to import multi-source files",
                "error": str(exc),
            }
        ), 500
