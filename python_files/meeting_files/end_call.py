"""
Legacy end-of-call handler — builds a PDF from combined transcripts via OpenAI.

Called from POST /leaveCall. Newer flows save transcripts and documents through
the dedicated meeting_transcript and template_document endpoints instead.
"""


import base64
from io import BytesIO
import os
import time
from flask import jsonify, request
from dotenv import load_dotenv
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.units import inch
import requests
from python_files.base_urls import OPENAI_CHAT_COMPLETIONS_URL


OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")




load_dotenv()


def leave_call():
    data = request.json
    local_transcript = data.get("localTranscript")
    remote_transcript = data.get("remoteTranscript")
    agenda = data.get("agenda")
    meeting_type = data.get("meetingType")
    
    print(f"Meeting Agenda: {agenda}, Meeting Type: {meeting_type}")
    print(f"Local Transcript: {local_transcript}")
    print(f"Remote Transcript: {remote_transcript}")
    
    try:
        combined_transcript = f"""
        Local Participant: {local_transcript}
        Remote Participant: {remote_transcript}
        """
        
        # Paths and Directory Setup
        transcripts_dir = os.path.join(os.path.dirname(__file__), "documents")
        if not os.path.exists(transcripts_dir):
            os.makedirs(transcripts_dir)
        
        timestamp = int(time.time() * 1000)
        pdf_path = os.path.join(transcripts_dir, f"document_{timestamp}.pdf")
        
        # Create PDF using reportlab
        buffer = BytesIO()
        doc = SimpleDocTemplate(buffer, pagesize=letter)
        elements = []
        
        styles = getSampleStyleSheet()
        title_style = ParagraphStyle(
            name='Title',
            parent=styles['Heading1'],
            fontSize=20,
            alignment=TA_CENTER,
            spaceAfter=24
        )
        
        heading_style = ParagraphStyle(
            name='Heading',
            parent=styles['Heading2'],
            fontSize=16,
            spaceAfter=10
        )
        
        subheading_style = ParagraphStyle(
            name='SubHeading',
            parent=styles['Heading3'],
            fontSize=14,
            spaceAfter=8
        )
        
        subsubheading_style = ParagraphStyle(
            name='SubSubHeading',
            parent=styles['Heading4'],
            fontSize=12,
            spaceAfter=6
        )
        
        normal_style = styles['Normal']
        
        if meeting_type == "Business Meeting":
            # Generate MVP Document
            try:
                mvp_response = requests.post(
                    OPENAI_CHAT_COMPLETIONS_URL,
                    json={
                        "model": "gpt-5.4-2026-03-05",
                        "messages": [
                            {
                                "role": "system",
                                "content": f"You are an assistant specialized in generating detailed Minimum Viable Product (MVP) documents. Analyze the provided meeting transcript and extract only the relevant details directly related to the MVP, such as goals, features, requirements, timelines, constraints, and the title of this document must be {agenda}. Ignore any unrelated or unnecessary content."
                            },
                            {
                                "role": "user",
                                "content": f"Here is the meeting transcript: {combined_transcript}. Please generate a detailed Minimum Viable Product (MVP) document based on the relevant information."
                            }
                        ],
                        "temperature": 0.7
                    },
                    headers={
                        "Content-Type": "application/json",
                        "Authorization": f"Bearer {OPENAI_API_KEY}"
                    }
                )
                
                # Debug information
                print(f"MVP API Status Code: {mvp_response.status_code}")
                print(f"MVP API Response: {mvp_response.text[:200]}...")  # Print first 200 chars
                
                mvp_response_json = mvp_response.json()
                
                # Check if the response has the expected structure
                if 'choices' not in mvp_response_json:
                    print(f"Unexpected MVP API response format: {mvp_response_json}")
                    # Handle this error by using a placeholder
                    mvp_document = "## MVP Document\n\nUnable to generate MVP document due to API response error."
                else:
                    mvp_document = mvp_response_json["choices"][0]["message"]["content"]
                
            except Exception as e:
                print(f"Error in MVP API call: {e}")
                mvp_document = "## MVP Document\n\nUnable to generate MVP document due to API error."
            
            # Add MVP to PDF
            elements.append(Paragraph("Minimum Viable Product (MVP) Document", title_style))
            
            for line in mvp_document.split("\n"):
                if line.strip():
                    if line.startswith("## "):
                        elements.append(Paragraph(line.replace("## ", "").strip(), heading_style))
                    elif line.startswith("### "):
                        elements.append(Paragraph(line.replace("### ", "").strip(), subheading_style))
                    elif line.startswith("#### "):
                        elements.append(Paragraph(line.replace("#### ", "").strip(), subsubheading_style))
                    elif line.startswith("- "):
                        elements.append(Paragraph(line.strip(), normal_style))
                        elements.append(Spacer(1, 4))
                    else:
                        elements.append(Paragraph(line.strip(), normal_style))
                        elements.append(Spacer(1, 4))
                        
            # Generate Vision Document
            try:
                vision_response = requests.post(
                    OPENAI_CHAT_COMPLETIONS_URL,
                    json={
                        "model": "gpt-5.4-2026-03-05",
                        "messages": [
                            {
                                "role": "system",
                                "content": f"You are an assistant specialized in generating vision statements. Analyze the provided meeting transcript and create a detailed Vision document focusing on the long-term goals, overarching principles, and the desired impact of the project. The title of this document must be {agenda} Vision."
                            },
                            {
                                "role": "user",
                                "content": f"Here is the meeting transcript: {combined_transcript}. Please generate a Vision document based on the relevant information."
                            }
                        ],
                        "temperature": 0.7
                    },
                    headers={
                        "Content-Type": "application/json",
                        "Authorization": f"Bearer {OPENAI_API_KEY}"
                    }
                )
                
                # Debug information
                print(f"Vision API Status Code: {vision_response.status_code}")
                print(f"Vision API Response: {vision_response.text[:200]}...")  # Print first 200 chars
                
                vision_response_json = vision_response.json()
                
                # Check if the response has the expected structure
                if 'choices' not in vision_response_json:
                    print(f"Unexpected Vision API response format: {vision_response_json}")
                    # Handle this error by using a placeholder
                    vision_document = "## Vision Document\n\nUnable to generate Vision document due to API response error."
                else:
                    vision_document = vision_response_json["choices"][0]["message"]["content"]
                
            except Exception as e:
                print(f"Error in Vision API call: {e}")
                vision_document = "## Vision Document\n\nUnable to generate Vision document due to API error."
            
            # Add Vision to PDF
            elements.append(Paragraph("Vision Document", title_style))
            
            for line in vision_document.split("\n"):
                if line.strip():
                    if line.startswith("## "):
                        elements.append(Paragraph(line.replace("## ", "").strip(), heading_style))
                    elif line.startswith("### "):
                        elements.append(Paragraph(line.replace("### ", "").strip(), subheading_style))
                    elif line.startswith("#### "):
                        elements.append(Paragraph(line.replace("#### ", "").strip(), subsubheading_style))
                    elif line.startswith("- "):
                        elements.append(Paragraph(line.strip(), normal_style))
                        elements.append(Spacer(1, 4))
                    else:
                        elements.append(Paragraph(line.strip(), normal_style))
                        elements.append(Spacer(1, 4))
                        
        else:
            # Generate Scrum Report
            try:
                scrum_response = requests.post(
                    OPENAI_CHAT_COMPLETIONS_URL,
                    json={
                        "model": "gpt-5.4-2026-03-05",
                        "messages": [
                            {
                                "role": "system",
                                "content": f"""
                                You are a highly skilled assistant specializing in summarizing Scrum meetings and generating structured Scrum reports. Your task is to carefully analyze the provided meeting transcript and generate a detailed Scrum report. The report must adhere to the following structured format:

                                Agenda: Summarize the purpose or focus of the meeting {agenda}.
                                Individual Updates: Provide a summary of each participant's work status, including:
                                Completed Tasks: List tasks completed since the last meeting.
                                Ongoing Tasks: Outline current tasks or work in progress.
                                Planned Tasks: Highlight tasks planned for the future.
                                Blockers: Identify challenges or issues mentioned by participants, specifying the individual or team impacted.
                                Decisions: Highlight key decisions made during the meeting.
                                Action Items: Provide a list of tasks or follow-ups assigned to specific team members, clearly indicating responsibility and deadlines where applicable.
                                """
                            },
                            {
                                "role": "user",
                                "content": f"Here is the meeting transcript: {combined_transcript}. Please generate a detailed Scrum report summarizing the discussion, highlighting each participant's work status, and providing an overview of the meeting outcomes."
                            }
                        ],
                        "temperature": 0.7
                    },
                    headers={
                        "Content-Type": "application/json",
                        "Authorization": f"Bearer {OPENAI_API_KEY}"
                    }
                )
                
                # Debug information
                print(f"Scrum API Status Code: {scrum_response.status_code}")
                print(f"Scrum API Response: {scrum_response.text[:200]}...")  # Print first 200 chars
                
                scrum_response_json = scrum_response.json()
                
                # Check if the response has the expected structure
                if 'choices' not in scrum_response_json:
                    print(f"Unexpected Scrum API response format: {scrum_response_json}")
                    # Handle this error by using a placeholder
                    scrum_document = "## Scrum Report\n\nUnable to generate Scrum report due to API response error."
                else:
                    scrum_document = scrum_response_json["choices"][0]["message"]["content"]
                
            except Exception as e:
                print(f"Error in Scrum API call: {e}")
                scrum_document = "## Scrum Report\n\nUnable to generate Scrum report due to API error."
            
            # Add Scrum Report to PDF
            elements.append(Paragraph("Scrum Meeting Report", title_style))
            
            for line in scrum_document.split("\n"):
                if line.strip():
                    if line.startswith("## "):
                        elements.append(Paragraph(line.replace("## ", "").strip(), heading_style))
                    elif line.startswith("### "):
                        elements.append(Paragraph(line.replace("### ", "").strip(), subheading_style))
                    elif line.startswith("#### "):
                        elements.append(Paragraph(line.replace("#### ", "").strip(), subsubheading_style))
                    elif line.startswith("- "):
                        elements.append(Paragraph(line.strip(), normal_style))
                        elements.append(Spacer(1, 4))
                    else:
                        elements.append(Paragraph(line.strip(), normal_style))
                        elements.append(Spacer(1, 4))
        
        # Build the PDF
        doc.build(elements)
        
        # Save the PDF to file
        with open(pdf_path, 'wb') as file:
            file.write(buffer.getvalue())
        
        # Return PDF data
        with open(pdf_path, 'rb') as file:
            pdf_data = base64.b64encode(file.read()).decode('utf-8')
        
        return jsonify({
            "message": "Document generated successfully",
            "pdfContent": pdf_data,
            "fileName": os.path.basename(pdf_path),
            "mvpDocument": mvp_document if meeting_type == "Business Meeting" else None,
            "visionDocument": vision_document if meeting_type == "Business Meeting" else None,
        })
        
    except Exception as e:
        print(f"Error generating documents: {e}")
        return jsonify({"error": f"Failed to generate documents: {str(e)}"}), 500