"""
Import a meeting transcript file and generate a structured project document.

Upload (.txt / .pdf / .docx) is parsed, sent through the document LangGraph
agent, and saved as a generated_document in Supabase.
"""

import json
import os
import traceback

from flask import jsonify, request

from python_files.document_context_orchestrator import (
    process_document_transcripts_with_orchestrator,
)
from python_files.document_import_shared import (
    MAX_FILE_SIZE,
    MIN_TEXT_CHARS,
    allowed_file,
    calculate_section_progress,
    extract_text_from_upload,
    generate_import_meeting_id,
    save_or_update_imported_document,
)
from python_files.meeting_document_memory import (
    hydrate_hierarchy_runtime,
    upsert_document_template_context,
)


def _build_transcripts_payload(transcript_text: str) -> dict:
    return {
        "localUser": transcript_text,
        "remoteUser": "",
        "remoteUsers": {},
        "agentUser": "",
    }


def import_transcript_and_generate_document():
    """
    Accept a transcript file (txt, pdf, docx), extract text, generate document
    sections via the same agent pipeline used in live meetings, and persist.
    """
    try:
        uploaded_file = request.files.get("file")
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
        if not uploaded_file or not uploaded_file.filename:
            return jsonify({"success": False, "message": "No file provided"}), 400
        if not allowed_file(uploaded_file.filename):
            return jsonify(
                {
                    "success": False,
                    "message": "Only .txt, .pdf, and .docx files are supported",
                }
            ), 400

        uploaded_file.seek(0, os.SEEK_END)
        file_size = uploaded_file.tell()
        uploaded_file.seek(0)
        if file_size > MAX_FILE_SIZE:
            return jsonify(
                {"success": False, "message": "File exceeds the 15 MB size limit"}
            ), 400

        sections = document_template_data.get("sections") or []
        if not sections:
            return jsonify(
                {
                    "success": False,
                    "message": "This project has no document template configured",
                }
            ), 400

        transcript_text = extract_text_from_upload(uploaded_file)
        if len(transcript_text) < MIN_TEXT_CHARS:
            return jsonify(
                {
                    "success": False,
                    "message": (
                        f"Could not extract enough text from the file "
                        f"(minimum {MIN_TEXT_CHARS} characters required)"
                    ),
                }
            ), 400

        meeting_id = generate_import_meeting_id("import")
        transcripts = _build_transcripts_payload(transcript_text)

        if not use_previous_document:
            previous_sections = {}

        upsert_document_template_context(
            meeting_id,
            document_template_data,
            previous_sections=previous_sections,
            metadata={"source": "transcript_import", "project_id": project_id},
        )
        hydrate_hierarchy_runtime(meeting_id)

        result = process_document_transcripts_with_orchestrator(
            meeting_id,
            transcripts,
            document_template=document_template_data,
            previous_sections=previous_sections,
        )

        if not result.get("success"):
            return jsonify(
                {
                    "success": False,
                    "message": result.get("error", "Document generation failed"),
                }
            ), 500

        generated_sections = result.get("generated_sections", {})
        saved_document = save_or_update_imported_document(
            user_id=user_id,
            meeting_id=meeting_id,
            project_id=project_id,
            project_name=project_name,
            document_template_data=document_template_data,
            generated_sections=generated_sections,
            undiscussed_topics=result.get("undiscussed_topics", []),
            meeting_phase=result.get("meeting_phase", "ended"),
            progress=result.get("discussion_progress")
            or calculate_section_progress(generated_sections, sections),
            use_previous_document=use_previous_document,
            existing_document_id=existing_document_id,
            source="transcript_import",
        )

        return jsonify(
            {
                "success": True,
                "message": "Document generated successfully from imported transcript",
                "document": saved_document,
                "transcriptLength": len(transcript_text),
                "meetingId": meeting_id,
            }
        ), 201

    except Exception as exc:
        print(f"Error importing transcript: {exc}")
        traceback.print_exc()
        return jsonify(
            {
                "success": False,
                "message": "Failed to import transcript and generate document",
                "error": str(exc),
            }
        ), 500
