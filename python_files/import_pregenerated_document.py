"""Import a pre-generated document and map its content into the project template."""

import json
import os
import re
import traceback
from typing import Any, Dict, List, Optional

from flask import jsonify, request
from langchain_core.messages import HumanMessage

from python_files.document_import_shared import (
    MAX_FILE_SIZE,
    MIN_TEXT_CHARS,
    MAX_LLM_DOCUMENT_CHARS,
    allowed_file,
    calculate_section_progress,
    extract_docx_heading_outline,
    extract_text_from_upload,
    generate_import_meeting_id,
    save_or_update_imported_document,
)
from python_files.langraph_agents_hierarchy import get_openai_llm

EMPTY_CONTENT_TOKENS = {"", "no_relevant_content", "n/a", "none", "null"}


def _normalize_section_content(value: Any) -> str:
    if value is None:
        return ""
    text = str(value).strip()
    if text.lower() in EMPTY_CONTENT_TOKENS:
        return ""
    return text


def _build_template_section_specs(
    document_template_data: dict,
    categories: dict,
) -> List[Dict[str, str]]:
    specs = []
    for section in document_template_data.get("sections") or []:
        section_id = section.get("id")
        if not section_id:
            continue
        category_key = section.get("category", "")
        specs.append(
            {
                "id": section_id,
                "title": section.get("title", ""),
                "category": category_key,
                "category_title": (categories.get(category_key) or {}).get(
                    "title", category_key
                ),
                "guidance": section.get("content", "") or section.get("template_content", ""),
            }
        )
    return specs


def _format_outline_hint(outline: List[dict]) -> str:
    if not outline:
        return ""
    lines = ["DETECTED DOCUMENT OUTLINE (from uploaded file structure):"]
    for item in outline[:40]:
        heading = item.get("heading", "")
        preview = (item.get("content") or "")[:400]
        lines.append(f"- {heading}")
        if preview:
            lines.append(f"  {preview}")
    return "\n".join(lines)


def _parse_json_mapping(raw_text: str, expected_ids: List[str]) -> Dict[str, str]:
    text = (raw_text or "").strip()
    if not text:
        return {}

    # Strip markdown code fences if present
    fence_match = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", text)
    if fence_match:
        text = fence_match.group(1).strip()

    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        start = text.find("{")
        end = text.rfind("}")
        if start == -1 or end == -1:
            raise ValueError("Model did not return valid JSON mapping")
        parsed = json.loads(text[start : end + 1])

    if not isinstance(parsed, dict):
        raise ValueError("Model mapping must be a JSON object")

    result = {}
    for section_id in expected_ids:
        result[section_id] = _normalize_section_content(parsed.get(section_id))
    return result


def map_document_to_template(
    full_text: str,
    template_sections: List[Dict[str, str]],
    outline: Optional[List[dict]] = None,
    previous_sections: Optional[Dict[str, str]] = None,
) -> Dict[str, Any]:
    """
    Map extracted document text into template section IDs using a dedicated LLM step.
    """
    if not template_sections:
        return {"success": False, "error": "No template sections provided"}

    expected_ids = [section["id"] for section in template_sections]
    previous_sections = previous_sections or {}

    truncated_text = full_text[:MAX_LLM_DOCUMENT_CHARS]
    was_truncated = len(full_text) > MAX_LLM_DOCUMENT_CHARS

    section_lines = []
    for section in template_sections:
        section_lines.append(
            json.dumps(
                {
                    "id": section["id"],
                    "title": section["title"],
                    "category": section.get("category_title") or section.get("category"),
                    "guidance": section.get("guidance") or "",
                },
                ensure_ascii=False,
            )
        )

    outline_block = _format_outline_hint(outline or [])
    previous_block = ""
    if previous_sections:
        filled = {
            k: v for k, v in previous_sections.items() if str(v or "").strip()
        }
        if filled:
            previous_block = (
                "\nEXISTING DOCUMENT CONTEXT (preserve and merge where the upload adds detail):\n"
                + json.dumps(filled, ensure_ascii=False, indent=2)
            )

    prompt = f"""You are a document migration specialist. Your task is to map an uploaded document into a fixed template structure.

TEMPLATE SECTIONS (map content into these IDs only):
{chr(10).join(section_lines)}

{outline_block}

{previous_block}

UPLOADED DOCUMENT TEXT:
\"\"\"
{truncated_text}
\"\"\"
{"[Note: document text was truncated for processing]" if was_truncated else ""}

INSTRUCTIONS:
1. For each template section, extract the content from the uploaded document that belongs in that section.
2. Match by section title, category meaning, and semantic similarity — headings in the upload do not need to match exactly.
3. Use ONLY content present in the uploaded document. Do not invent or summarize beyond what is written.
4. Assign each paragraph or block to the single best-fit section. Avoid duplicating the same content across sections.
5. Preserve bullet points, numbered lists, and paragraph breaks where possible.
6. If a template section has no matching content in the upload, return an empty string for that section id.
7. If existing document context is provided, merge new extracted content with it without losing prior approved text.

Return ONLY a valid JSON object where keys are template section ids and values are strings:
{{
  "section_id": "extracted content for that section"
}}
"""

    llm = get_openai_llm(temperature=0.1)
    response = llm.invoke([HumanMessage(content=prompt)])
    raw_content = response.content if hasattr(response, "content") else str(response)

    try:
        generated_sections = _parse_json_mapping(raw_content, expected_ids)
    except Exception as exc:
        print(f"Batch mapping failed, falling back to per-section extraction: {exc}")
        generated_sections = _map_sections_individually(
            truncated_text, template_sections, previous_sections
        )

    # Merge with previous sections when building on existing document
    for section_id, prior in previous_sections.items():
        if section_id not in generated_sections:
            generated_sections[section_id] = _normalize_section_content(prior)
        elif not generated_sections[section_id].strip() and str(prior or "").strip():
            generated_sections[section_id] = _normalize_section_content(prior)

    empty_sections = [
        section
        for section in template_sections
        if not generated_sections.get(section["id"], "").strip()
    ]

    return {
        "success": True,
        "generated_sections": generated_sections,
        "undiscussed_topics": [
            {
                "id": section["id"],
                "title": section["title"],
                "category": section.get("category", ""),
            }
            for section in empty_sections
        ],
        "mapped_count": len(expected_ids) - len(empty_sections),
        "total_sections": len(expected_ids),
    }


def _map_sections_individually(
    full_text: str,
    template_sections: List[Dict[str, str]],
    previous_sections: Dict[str, str],
) -> Dict[str, str]:
    llm = get_openai_llm(temperature=0.1)
    results = {}

    for section in template_sections:
        section_id = section["id"]
        prior = _normalize_section_content(previous_sections.get(section_id))
        prompt = f"""Extract content for ONE template section from the uploaded document.

SECTION:
- id: {section_id}
- title: {section['title']}
- category: {section.get('category_title') or section.get('category')}
- guidance: {section.get('guidance') or 'None'}

EXISTING CONTENT (merge if relevant):
{prior or 'None'}

UPLOADED DOCUMENT:
\"\"\"
{full_text[:60000]}
\"\"\"

Rules: use only upload text, no invention, no duplication across sections, empty string if nothing matches.
Return ONLY the extracted section content as plain text (no JSON, no markdown fences).
"""
        response = llm.invoke([HumanMessage(content=prompt)])
        content = response.content if hasattr(response, "content") else str(response)
        results[section_id] = _normalize_section_content(content)

    return results


def import_pregenerated_document():
    """
    Accept a finished document (txt, pdf, docx), extract text, map into template
    sections, and persist as a generated document.
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

        template_sections_raw = document_template_data.get("sections") or []
        if not template_sections_raw:
            return jsonify(
                {
                    "success": False,
                    "message": "This project has no document template configured",
                }
            ), 400

        outline = extract_docx_heading_outline(uploaded_file)
        uploaded_file.seek(0)
        document_text = extract_text_from_upload(uploaded_file)

        if len(document_text) < MIN_TEXT_CHARS:
            return jsonify(
                {
                    "success": False,
                    "message": (
                        f"Could not extract enough text from the file "
                        f"(minimum {MIN_TEXT_CHARS} characters required)"
                    ),
                }
            ), 400

        if not use_previous_document:
            previous_sections = {}

        categories = document_template_data.get("categories") or {}
        section_specs = _build_template_section_specs(document_template_data, categories)

        mapping_result = map_document_to_template(
            document_text,
            section_specs,
            outline=outline,
            previous_sections=previous_sections if use_previous_document else {},
        )

        if not mapping_result.get("success"):
            return jsonify(
                {
                    "success": False,
                    "message": mapping_result.get("error", "Document mapping failed"),
                }
            ), 500

        generated_sections = mapping_result.get("generated_sections", {})
        progress = calculate_section_progress(generated_sections, template_sections_raw)
        meeting_id = generate_import_meeting_id("doc-import")

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
            source="pregenerated_document_import",
        )

        return jsonify(
            {
                "success": True,
                "message": "Document imported and mapped to your template successfully",
                "document": saved_document,
                "documentLength": len(document_text),
                "mappedSections": mapping_result.get("mapped_count", 0),
                "totalSections": mapping_result.get("total_sections", 0),
                "meetingId": meeting_id,
            }
        ), 201

    except Exception as exc:
        print(f"Error importing pre-generated document: {exc}")
        traceback.print_exc()
        return jsonify(
            {
                "success": False,
                "message": "Failed to import pre-generated document",
                "error": str(exc),
            }
        ), 500
