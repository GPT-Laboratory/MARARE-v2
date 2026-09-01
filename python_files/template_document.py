"""
REST handlers for generated meeting documents (Supabase).

Each saved document belongs to a user, project, and meeting. These endpoints
are called from the frontend when a meeting ends or when editing a document.
"""

import os
import re
from flask import request, jsonify
from datetime import datetime

from python_files.supabase_store import (
    delete_generated_document as delete_generated_document_row,
    get_generated_document,
    insert_generated_document,
    list_generated_documents_by_meeting,
    list_generated_documents_by_project,
    list_generated_documents_by_user,
    update_generated_document as update_generated_document_row,
)


UUID_PATTERN = re.compile(
    r'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
    re.IGNORECASE,
)
EXTERNAL_DOCUMENT_ID_PREFIXES = ('google-drive-', 'notion-')


def _is_supabase_document_id(value):
    if value is None:
        return False
    text = str(value).strip()
    if not text:
        return False
    if any(text.startswith(prefix) for prefix in EXTERNAL_DOCUMENT_ID_PREFIXES):
        return False
    return bool(UUID_PATTERN.match(text))


def serialize_doc(doc):
    return doc


def save_generated_document():
    try:
        data = request.get_json()
        user_id = data.get('userId')

        if not user_id:
            return jsonify({
                'success': False,
                'message': 'User ID is required'
            }), 400

        initial_version = data.get('version', 1)
        version_created_at = data.get('versionCreatedAt', datetime.utcnow().isoformat())
        version_history = data.get('versionHistory') or data.get('version_history')
        if not version_history:
            version_history = [{'version': initial_version, 'createdAt': version_created_at}]
        document = {
            'user_id': user_id,
            'meeting_id': data.get('meetingId'),
            'project_id': data.get('projectId'),
            'project_name': data.get('projectName'),
            'template': data.get('template'),
            'generated_sections': data.get('generatedSections'),
            'undiscussed_topics': data.get('undiscussedTopics', []),
            'meeting_phase': data.get('meetingPhase'),
            'progress': data.get('progress', 0),
            'timestamp': data.get('timestamp', datetime.utcnow().isoformat()),
            'team_data': data.get('teamData'),
            'created_at': datetime.utcnow().isoformat(),
            'updated_at': datetime.utcnow().isoformat(),
            'version': initial_version,
            'version_created_at': version_created_at,
            'version_history': version_history,
        }
        if data.get('basedOnMeetingId'):
            document['based_on_meeting_id'] = data.get('basedOnMeetingId')
        based_on_document_id = data.get('basedOnDocumentId')
        if _is_supabase_document_id(based_on_document_id):
            document['based_on_document_id'] = based_on_document_id
        agenda = (data.get('meetingAgenda') or data.get('meeting_agenda') or '').strip()
        if agenda:
            document['meeting_agenda'] = agenda

        saved = insert_generated_document(document)
        return jsonify({
            'success': True,
            'message': 'Document saved successfully',
            'document': serialize_doc(saved)
        }), 201

    except Exception as e:
        print(f"Error saving document: {str(e)}")
        return jsonify({
            'success': False,
            'message': 'Failed to save document',
            'error': str(e)
        }), 500


def get_generated_documents(meeting_id):
    try:
        user_id = request.args.get('userId')

        if not user_id:
            return jsonify({
                'success': False,
                'message': 'User ID is required'
            }), 400

        documents = list_generated_documents_by_meeting(meeting_id, user_id)
        return jsonify({
            'success': True,
            'documents': documents,
            'count': len(documents)
        }), 200

    except Exception as e:
        print(f"Error fetching documents: {str(e)}")
        return jsonify({
            'success': False,
            'message': 'Failed to fetch documents',
            'error': str(e)
        }), 500


def get_documents_by_project(project_id):
    try:
        user_id = request.args.get('userId')

        if not user_id:
            return jsonify({
                'success': False,
                'message': 'User ID is required'
            }), 400

        documents = list_generated_documents_by_project(project_id, user_id)
        return jsonify({
            'documents': documents,
        }), 200

    except Exception as e:
        print(f"Error fetching project documents: {str(e)}")
        return jsonify({
            'success': False,
            'message': 'Failed to fetch project documents',
            'error': str(e)
        }), 500


def get_document_by_id(document_id):
    try:
        user_id = request.args.get('userId')

        if not user_id:
            return jsonify({
                'success': False,
                'message': 'User ID is required'
            }), 400

        document = get_generated_document(document_id, user_id)
        if not document:
            return jsonify({
                'success': False,
                'message': 'Document not found'
            }), 404

        return jsonify({
            'success': True,
            'document': serialize_doc(document)
        }), 200

    except Exception as e:
        print(f"Error fetching document: {str(e)}")
        return jsonify({
            'success': False,
            'message': 'Failed to fetch document',
            'error': str(e)
        }), 500


def update_generated_document(document_id):
    try:
        if not _is_supabase_document_id(document_id):
            return jsonify({
                'success': False,
                'message': 'Invalid Supabase document id',
                'error': 'External document ids cannot be updated in Supabase.',
            }), 400

        data = request.get_json()
        user_id = data.get('userId')

        if not user_id:
            return jsonify({
                'success': False,
                'message': 'User ID is required'
            }), 400

        update_data = {
            'generated_sections': data.get('generatedSections'),
            'undiscussed_topics': data.get('undiscussedTopics'),
            'meeting_phase': data.get('meetingPhase'),
            'progress': data.get('progress'),
            'team_data': data.get('teamData'),
            'template': data.get('template'),
            'project_name': data.get('projectName'),
            'version': data.get('version'),
            'version_created_at': data.get('versionCreatedAt'),
        }
        if data.get('meetingId') is not None:
            update_data['meeting_id'] = data.get('meetingId')
        update_data = {k: v for k, v in update_data.items() if v is not None}

        append_history = None
        new_version = data.get('version')
        new_version_at = data.get('versionCreatedAt')
        if new_version is not None and new_version_at is not None:
            append_history = {
                'version': new_version,
                'createdAt': new_version_at,
            }

        updated_doc = update_generated_document_row(
            document_id,
            user_id,
            update_data,
            append_version_history=append_history,
        )

        if not updated_doc:
            return jsonify({
                'success': False,
                'message': 'Document not found'
            }), 404

        return jsonify({
            'success': True,
            'message': 'Document updated successfully',
            'document': serialize_doc(updated_doc)
        }), 200

    except Exception as e:
        print(f"Error updating document: {str(e)}")
        return jsonify({
            'success': False,
            'message': 'Failed to update document',
            'error': str(e)
        }), 500


def delete_generated_document(document_id):
    try:
        user_id = request.args.get('userId') or request.get_json().get('userId')

        if not user_id:
            return jsonify({
                'success': False,
                'message': 'User ID is required'
            }), 400

        deleted = delete_generated_document_row(document_id, user_id)
        if not deleted:
            return jsonify({
                'success': False,
                'message': 'Document not found or already deleted'
            }), 404

        return jsonify({
            'success': True,
            'message': 'Document deleted successfully'
        }), 200

    except Exception as e:
        print(f"Error deleting document: {str(e)}")
        return jsonify({
            'success': False,
            'message': 'Failed to delete document',
            'error': str(e)
        }), 500


def get_all_user_documents(user_id):
    try:
        documents = list_generated_documents_by_user(user_id)
        return jsonify({
            'success': True,
            'documents': documents,
            'count': len(documents)
        }), 200

    except Exception as e:
        print(f"Error fetching user documents: {str(e)}")
        return jsonify({
            'success': False,
            'message': 'Failed to fetch user documents',
            'error': str(e)
        }), 500
