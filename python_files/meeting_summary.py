"""
REST handlers for AI-generated meeting summaries (Supabase).

Summaries are created during or after a meeting and linked to project + meeting ids.
"""

from flask import jsonify, request
from datetime import datetime

from python_files.supabase_store import (
    delete_meeting_summary as delete_meeting_summary_row,
    get_meeting_summary,
    insert_meeting_summary,
    list_meeting_summaries,
    list_summaries_by_project,
    update_meeting_summary as update_meeting_summary_row,
)


def serialize_doc(doc):
    return doc


def save_meeting_summary():
    try:
        data = request.get_json()
        user_id = data.get('userId')

        if not user_id:
            return jsonify({
                'success': False,
                'message': 'User ID is required'
            }), 400

        summary_doc = {
            'user_id': user_id,
            'meeting_id': data.get('meetingId'),
            'project_id': data.get('projectId'),
            'project_name': data.get('projectName'),
            'summary_content': data.get('summaryContent'),
            'timestamp': data.get('timestamp', datetime.utcnow().isoformat()),
            'team_data': data.get('teamData'),
            'created_at': datetime.utcnow().isoformat(),
            'updated_at': datetime.utcnow().isoformat(),
            'version': data.get('version', 1)
        }

        saved = insert_meeting_summary(summary_doc)
        return jsonify({
            'success': True,
            'message': 'Summary saved successfully',
            'summary': serialize_doc(saved)
        }), 201

    except Exception as e:
        print(f"Error saving summary: {str(e)}")
        return jsonify({
            'success': False,
            'message': 'Failed to save summary',
            'error': str(e)
        }), 500


def get_meeting_summaries(meeting_id):
    try:
        user_id = request.args.get('userId')

        if not user_id:
            return jsonify({
                'success': False,
                'message': 'User ID is required'
            }), 400

        summaries = list_meeting_summaries(meeting_id, user_id)
        return jsonify({
            'success': True,
            'summaries': summaries,
            'count': len(summaries)
        }), 200

    except Exception as e:
        print(f"Error fetching summaries: {str(e)}")
        return jsonify({
            'success': False,
            'message': 'Failed to fetch summaries',
            'error': str(e)
        }), 500


def get_summaries_by_project(project_id):
    try:
        user_id = request.args.get('userId')

        if not user_id:
            return jsonify({
                'success': False,
                'message': 'User ID is required'
            }), 400

        summaries = list_summaries_by_project(project_id, user_id)
        return jsonify({
            'success': True,
            'summaries': summaries,
            'count': len(summaries)
        }), 200

    except Exception as e:
        print(f"Error fetching project summaries: {str(e)}")
        return jsonify({
            'success': False,
            'message': 'Failed to fetch project summaries',
            'error': str(e)
        }), 500


def update_meeting_summary(summary_id):
    try:
        data = request.get_json()
        user_id = data.get('userId')

        if not user_id:
            return jsonify({
                'success': False,
                'message': 'User ID is required'
            }), 400

        update_data = {
            'summary_content': data.get('summaryContent'),
            'version': data.get('version', 1)
        }

        updated_summary = update_meeting_summary_row(summary_id, user_id, update_data)
        if not updated_summary:
            return jsonify({
                'success': False,
                'message': 'Summary not found or unauthorized'
            }), 404

        return jsonify({
            'success': True,
            'message': 'Summary updated successfully',
            'summary': serialize_doc(updated_summary)
        }), 200

    except Exception as e:
        print(f"Error updating summary: {str(e)}")
        return jsonify({
            'success': False,
            'message': 'Failed to update summary',
            'error': str(e)
        }), 500


def delete_meeting_summary(summary_id):
    try:
        user_id = request.args.get('userId')

        if not user_id:
            return jsonify({
                'success': False,
                'message': 'User ID is required'
            }), 400

        deleted = delete_meeting_summary_row(summary_id, user_id)
        if not deleted:
            return jsonify({
                'success': False,
                'message': 'Summary not found or unauthorized'
            }), 404

        return jsonify({
            'success': True,
            'message': 'Summary deleted successfully'
        }), 200

    except Exception as e:
        print(f"Error deleting summary: {str(e)}")
        return jsonify({
            'success': False,
            'message': 'Failed to delete summary',
            'error': str(e)
        }), 500


def get_summary(summary_id):
    try:
        user_id = request.args.get('userId')

        if not user_id:
            return jsonify({
                'success': False,
                'message': 'User ID is required'
            }), 400

        summary = get_meeting_summary(summary_id, user_id)
        if not summary:
            return jsonify({
                'success': False,
                'message': 'Summary not found'
            }), 404

        return jsonify({
            'success': True,
            'summary': serialize_doc(summary)
        }), 200

    except Exception as e:
        print(f"Error fetching summary: {str(e)}")
        return jsonify({
            'success': False,
            'message': 'Failed to fetch summary',
            'error': str(e)
        }), 500
