"""
HTTP handlers for meeting transcripts and unified meeting history.

Endpoints (registered in api.py):
  - save / fetch transcripts in Supabase
  - list meeting history from Supabase, Notion, or Google Drive
  - delete a meeting and its related data
"""

from flask import jsonify, request

from python_files.supabase_store import (
    build_project_meeting_history,
    delete_project_meeting_data,
    get_meeting_transcript,
    insert_meeting_transcript,
)


def save_meeting_transcript():
    try:
        data = request.get_json() or {}
        user_id = data.get("userId")

        if not user_id:
            return jsonify({"success": False, "message": "User ID is required"}), 400

        meeting_id = data.get("meetingId")
        project_id = data.get("projectId")

        if not meeting_id or not project_id:
            return jsonify({"success": False, "message": "meetingId and projectId are required"}), 400

        entries = data.get("entries") or []
        if not isinstance(entries, list):
            entries = []

        transcript_doc = {
            "user_id": user_id,
            "meeting_id": meeting_id,
            "project_id": project_id,
            "project_name": data.get("projectName"),
            "based_on_meeting_id": data.get("basedOnMeetingId"),
            "entries": entries,
            "full_text": data.get("fullText"),
            "meeting_agenda": data.get("meetingAgenda") or data.get("meeting_agenda"),
        }

        saved = insert_meeting_transcript(transcript_doc)
        return jsonify({
            "success": True,
            "message": "Meeting transcript saved successfully",
            "transcript": saved,
        }), 201

    except Exception as e:
        print(f"Error saving meeting transcript: {str(e)}")
        return jsonify({
            "success": False,
            "message": "Failed to save meeting transcript",
            "error": str(e),
        }), 500


def get_meeting_transcript_by_id(meeting_id):
    try:
        user_id = request.args.get("userId")
        if not user_id:
            return jsonify({"success": False, "message": "User ID is required"}), 400

        transcript = get_meeting_transcript(meeting_id, user_id)
        if not transcript:
            return jsonify({"success": False, "message": "Transcript not found"}), 404

        return jsonify({"success": True, "transcript": transcript}), 200

    except Exception as e:
        print(f"Error fetching meeting transcript: {str(e)}")
        return jsonify({
            "success": False,
            "message": "Failed to fetch meeting transcript",
            "error": str(e),
        }), 500


def get_project_meeting_history(project_id):
    try:
        user_id = request.args.get("userId")
        if not user_id:
            return jsonify({"success": False, "message": "User ID is required"}), 400

        summary_param = request.args.get("summary", "true")
        summary = str(summary_param).lower() not in {"0", "false", "no"}
        meetings = build_project_meeting_history(project_id, user_id, summary=summary)
        return jsonify({"success": True, "meetings": meetings, "summary": summary, "storageSource": "supabase"}), 200

    except Exception as e:
        print(f"Error fetching project meeting history: {str(e)}")
        return jsonify({
            "success": False,
            "message": "Failed to fetch meeting history",
            "error": str(e),
        }), 500


def get_project_notion_meeting_history(project_id):
    try:
        user_id = request.args.get("userId")
        if not user_id:
            return jsonify({"success": False, "message": "User ID is required"}), 400

        project_name = request.args.get("projectName") or request.args.get("project_name") or ""
        if not project_name:
            from python_files.supabase_store import get_project

            project = get_project(project_id, user_id=user_id) or {}
            project_name = str(project.get("project_name") or "").strip()

        from python_files.unified_meeting_history import build_notion_project_meeting_history

        meetings = build_notion_project_meeting_history(
            project_id,
            user_id,
            project_name=project_name,
        )
        return jsonify({"success": True, "meetings": meetings, "storageSource": "notion"}), 200

    except Exception as e:
        print(f"Error fetching Notion meeting history: {str(e)}")
        return jsonify({
            "success": False,
            "message": "Failed to fetch Notion meeting history",
            "error": str(e),
        }), 500


def get_project_google_drive_meeting_history(project_id):
    try:
        user_id = request.args.get("userId")
        if not user_id:
            return jsonify({"success": False, "message": "User ID is required"}), 400

        project_name = request.args.get("projectName") or request.args.get("project_name") or ""
        if not project_name:
            from python_files.supabase_store import get_project

            project = get_project(project_id, user_id=user_id) or {}
            project_name = str(project.get("project_name") or "").strip()

        if not project_name:
            return jsonify({"success": True, "meetings": [], "storageSource": "google_drive"}), 200

        from python_files.unified_meeting_history import build_google_drive_project_meeting_history

        meetings = build_google_drive_project_meeting_history(
            project_id,
            user_id,
            project_name=project_name,
        )
        return jsonify({"success": True, "meetings": meetings, "storageSource": "google_drive"}), 200

    except Exception as e:
        print(f"Error fetching Google Drive meeting history: {str(e)}")
        return jsonify({
            "success": False,
            "message": "Failed to fetch Google Drive meeting history",
            "error": str(e),
        }), 500


def delete_project_meeting(project_id, meeting_id):
    try:
        user_id = request.args.get("userId")
        if not user_id:
            return jsonify({"success": False, "message": "User ID is required"}), 400

        document_id = request.args.get("documentId")
        is_import = str(request.args.get("isImport", "false")).lower() in {"1", "true", "yes"}

        counts = delete_project_meeting_data(
            project_id,
            user_id,
            meeting_id,
            document_id=document_id,
            is_import=is_import,
        )
        return jsonify({
            "success": True,
            "message": "Meeting deleted successfully",
            "deleted": counts,
        }), 200

    except Exception as e:
        print(f"Error deleting project meeting: {str(e)}")
        status_code = 404 if "not found" in str(e).lower() else 500
        return jsonify({
            "success": False,
            "message": str(e) or "Failed to delete meeting",
            "error": str(e),
        }), status_code
