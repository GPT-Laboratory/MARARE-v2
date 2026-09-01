"""REST handlers for MVP + Vision records saved after a meeting (Supabase)."""
from datetime import datetime

from flask import jsonify, request

from python_files.supabase_store import (
    insert_meeting_mvpvision,
    list_mvpvisions_by_project,
    update_meeting_mvpvision as update_meeting_mvpvision_row,
)


def serialize_doc(doc):
    return doc


def save_meeting_mvpvision():
    try:
        data = request.get_json()
        user_id = data.get("userId")

        if not user_id:
            return jsonify({"success": False, "message": "User ID is required"}), 400

        mvpvision_doc = {
            "user_id": user_id,
            "meeting_id": data.get("meetingId"),
            "project_id": data.get("projectId"),
            "project_name": data.get("projectName"),
            "mvp": data.get("mvp", ""),
            "vision": data.get("vision", ""),
            "timestamp": data.get("timestamp", datetime.utcnow().isoformat()),
            "created_at": datetime.utcnow().isoformat(),
            "updated_at": datetime.utcnow().isoformat(),
            "version": data.get("version", 1),
        }

        saved = insert_meeting_mvpvision(mvpvision_doc)
        return jsonify({"success": True, "message": "MVP+Vision saved successfully", "mvpvision": serialize_doc(saved)}), 201

    except Exception as e:
        print(f"Error saving MVP+Vision: {str(e)}")
        return jsonify({"success": False, "message": "Failed to save MVP+Vision", "error": str(e)}), 500


def get_mvpvision_by_project(project_id):
    try:
        user_id = request.args.get("userId")
        if not user_id:
            return jsonify({"success": False, "message": "User ID is required"}), 400

        records = list_mvpvisions_by_project(project_id, user_id)
        return jsonify({"success": True, "mvpvisions": records, "count": len(records)}), 200

    except Exception as e:
        print(f"Error fetching MVP+Vision: {str(e)}")
        return jsonify({"success": False, "message": "Failed to fetch MVP+Vision", "error": str(e)}), 500


def update_meeting_mvpvision(mvpvision_id):
    try:
        data = request.get_json()
        user_id = data.get("userId")
        if not user_id:
            return jsonify({"success": False, "message": "User ID is required"}), 400

        update_data = {
            "mvp": data.get("mvp", ""),
            "vision": data.get("vision", ""),
            "version": data.get("version", 1),
        }

        updated = update_meeting_mvpvision_row(mvpvision_id, user_id, update_data)
        if not updated:
            return jsonify({"success": False, "message": "MVP+Vision not found or unauthorized"}), 404

        return jsonify({"success": True, "message": "MVP+Vision updated successfully", "mvpvision": serialize_doc(updated)}), 200

    except Exception as e:
        print(f"Error updating MVP+Vision: {str(e)}")
        return jsonify({"success": False, "message": "Failed to update MVP+Vision", "error": str(e)}), 500
