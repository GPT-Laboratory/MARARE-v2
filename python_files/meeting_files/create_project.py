"""
REST handlers for project CRUD (Supabase).

Projects hold the document template, MVP/Vision template, and belong to a user.
Routes: GET /projects, POST /create-project, PUT/DELETE by project id.
"""

# API to create a new project
from datetime import datetime

from dotenv import load_dotenv
from flask import jsonify, request

from python_files.supabase_store import (
    delete_project as delete_project_row,
    delete_project_related_data,
    get_project,
    insert_project,
    list_connected_mcp_providers_by_project,
    list_projects,
    update_project as update_project_row,
)

load_dotenv()


# def fetch_projects():
#     print("Fetching projects...")
#     try:
#         user_id = request.args.get("user_id")
#         if not user_id:
#             return jsonify({"detail": "User ID is required"}), 400

#         projects = list_projects(user_id)
#         print(f"Fetching projects for user_id: {user_id}")
#         return jsonify([project_serializer(p) for p in projects])
#     except Exception as e:
#         return jsonify({"detail": f"Error fetching projects: {str(e)}"}), 500



def fetch_projects():
    print("Fetching projects...")
    try:
        user_id = request.args.get("user_id")
        if not user_id:
            return jsonify({"detail": "User ID is required"}), 400

        projects = list_projects(user_id)
        connected_by_project = list_connected_mcp_providers_by_project(user_id)

        print(f"Fetching projects for user_id: {user_id}")
        return jsonify([
            project_serializer(
                p,
                connected_by_project.get(str(p.get("_id") or p.get("id")), []),
            )
            for p in projects
        ])
    except Exception as e:
        return jsonify({"detail": f"Error fetching projects: {str(e)}"}), 500

def creating_project():
    data = request.get_json()
    project_name = data.get("project_name")
    user_id = data.get("user_id")
    template_document = data.get("template_document")
    mvpVisiontemplate = data.get("mvpVisiontemplate")

    if not project_name:
        return jsonify({"detail": "Project name is required"}), 400

    created_at = datetime.now().isoformat()
    new_project = {
        "name": project_name,
        "user_id": user_id,
        "created_at": created_at,
        "template_document": {
            "categories": template_document.get("categories", {}),
            "sections": template_document.get("sections", []),
            "updated_at": datetime.now().isoformat(),
        },
        "mvpVisiontemplate": mvpVisiontemplate,
    }
    saved = insert_project(new_project)
    project_id = saved.get("_id") or saved.get("id")
    print(f"Creating project with ID: {project_id}")

    return jsonify({
        "message": "Project created successfully",
        "project_id": project_id,
    })


def delete_project(project_id):
    print(f"Deleting project with ID: {project_id}")
    try:
        existing_project = get_project(project_id)
        if not existing_project:
            return jsonify({"detail": "Project not found"}), 404

        related_counts = delete_project_related_data(project_id)
        project_deleted = delete_project_row(project_id)

        return jsonify({
            "message": "Project and all related data deleted",
            "project_deleted": 1 if project_deleted else 0,
            **related_counts,
            "gridfs_files_deleted": 0,
        })

    except Exception as e:
        return jsonify({"detail": f"Error deleting project and related data: {str(e)}"        }), 500


def update_project(project_id):
    data = request.get_json()
    new_name = data.get("project_name")
    template_document = data.get("template_document")
    user_id = data.get("user_id")
    mvpVisiontemplate = data.get("mvpVisiontemplate")

    print(f"Updating project with ID: {project_id}")

    if not new_name:
        return jsonify({"detail": "New project name is required"}), 400

    update_data = {}
    if new_name:
        update_data["name"] = new_name
    if template_document:
        update_data["template_document"] = {
            "categories": template_document.get("categories", {}),
            "sections": template_document.get("sections", []),
            "updated_at": datetime.now().isoformat(),
        }
    if mvpVisiontemplate:
        update_data["mvp_vision_template"] = mvpVisiontemplate

    try:
        updated = update_project_row(project_id, user_id, update_data)
        if not updated:
            return jsonify({"detail": "Project not found"}), 404

        return jsonify({
            "message": "Project name updated successfully",
        })

    except Exception as e:
        print(f"Error updating project: {e}")
        return jsonify({"detail": "Invalid Project ID or server error"}), 500


# def project_serializer(project):
#     created_at = project.get("created_at")
#     if isinstance(created_at, str):
#         created_at_display = created_at[:19].replace("T", " ")
#     else:
#         created_at_display = created_at.strftime("%Y-%m-%d %H:%M:%S") if created_at else None

#     return {
#         "id": str(project.get("_id") or project.get("id")),
#         "project_name": project.get("name"),
#         "created_at": created_at_display,
#         "template_document": project.get("template_document"),
#         "mvpVisiontemplate": project.get("mvp_vision_template") or project.get("mvpVisiontemplate"),
#     }


def project_serializer(project, connected_providers=None):
    created_at = project.get("created_at")
    if isinstance(created_at, str):
        created_at_display = created_at[:19].replace("T", " ")
    else:
        created_at_display = created_at.strftime("%Y-%m-%d %H:%M:%S") if created_at else None

    connected_providers = connected_providers or []

    return {
        "id": str(project.get("_id") or project.get("id")),
        "project_name": project.get("name"),
        "created_at": created_at_display,
        "template_document": project.get("template_document"),
        "mvpVisiontemplate": project.get("mvp_vision_template") or project.get("mvpVisiontemplate"),
        "mcpConnected": len(connected_providers) > 0,
        "connectedProviders": connected_providers,
    }