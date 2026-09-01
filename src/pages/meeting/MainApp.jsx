/**
 * Meeting lobby — host configures and starts a session.
 * Route: /create-meeting/:project_name/:id
 */
import { useEffect, useRef, useState } from "react";
import Content from "./Content";
import { useDispatch, useSelector } from "react-redux";
import {
  setAgenda,
  setAgent,
  setAgentName,
  setMeetingType,
  setRoomId,
  setIsAdmin,
  setWantDocumentTemplate,
  setMVPVisionTemplate,
} from '../../features/mainStates/MainStates_Slice';
import { setUsePreviousDocument, setMeetingContinuation, clearMeetingContinuation } from '../../features/ReportSlice';
import { getDocumentsByProject } from '../../features/mainStates/Template_Slice';
import useUnifiedProjectMeetingHistory from '../../hooks/useUnifiedProjectMeetingHistory';
import { resolveMeetingContinuationPayload } from '../../utils/meetingContinuationUtils';
import { resolveSupabaseContinuationDocumentId } from '../../utils/documentStorageRecords';
import { getMeetingDisplayTitle } from '../../utils/meetingHistoryUtils';
import {
  getMeetingListKey,
  getMeetingSourceColor,
  getMeetingSourceLabel,
  getMeetingStorageSource,
} from '../../utils/unifiedMeetingHistory';
import { useRefs } from '../../providers/RefProvider';
import { useLocation, useNavigate, useParams, Link } from "react-router-dom";
import { getSocket } from '../../services/meeting/socketInstance';

import { Breadcrumb, Button, Modal, Radio, Tag } from "antd";
// Modal is used as a JSX component below (not Modal.confirm static method)
import { FileTextOutlined, HomeFilled, CalendarOutlined } from "@ant-design/icons";
import Template from '../../pages/templates/Template';
import { getUserId } from '../../services/auth/GetLoginUserId';

function MainApp() {
  const userId = getUserId()
  const roomId = useSelector((state) => state.MainStates_Slice.roomId);
  const agenda = useSelector((state) => state.MainStates_Slice.agenda);
  const agent = useSelector((state) => state.MainStates_Slice.agent);
  const agentName = useSelector((state) => state.MainStates_Slice.agentName);
  const wantDocumentTemplate = useSelector((state) => state.MainStates_Slice.wantDocumentTemplate);
  const mvpVisionTemplate = useSelector((state) => state.MainStates_Slice.mvpVisionTemplate);
  const { project_name, id } = useParams();
  const isAdmin = useSelector((state) => state.MainStates_Slice.isAdmin);
  console.log("project_name and id", project_name, id);

  const textInputRef = useRef(null);
  const socket = getSocket();
  const { setJoinStatus } = useRefs();

  const projects = useSelector((state) => state.main.projects)
  console.log("Projects", projects);

  const project = projects.find((project) => project.id == id);
  const projectName = project?.project_name

  const projectTemplate = projects.find(p => String(p.id) === id);
  console.log("projectTemplate", projectTemplate?.template_document);
  const dispatch = useDispatch();

  // Fetch previous generated documents for this project so we can carry over old section content
  const generatedDocuments = useSelector((state) => state.documents.generatedDocuments);
  const meetingContinuation = useSelector((state) => state.reports?.meetingContinuation);
  const {
    meetingsWithDocuments: projectMeetings,
    loading: loadingMeetings,
    loadingExternal,
    loadingSources,
  } = useUnifiedProjectMeetingHistory(id, {
    enabled: Boolean(id),
    summary: true,
    projectName: projectTemplate?.project_name || project_name,
  });
  const continuationInitializedRef = useRef(false);

  useEffect(() => {
    continuationInitializedRef.current = false;
  }, [id]);

  useEffect(() => {
    if (id) {
      dispatch(getDocumentsByProject(id));
    }
  }, [id, dispatch]);

  // Load prior meeting history so host can continue from a previous document
  useEffect(() => {
    if (loadingMeetings || continuationInitializedRef.current) return;

    if (projectMeetings.length === 0) {
      dispatch(clearMeetingContinuation());
      continuationInitializedRef.current = true;
      return;
    }

    let cancelled = false;
    const initializeContinuation = async () => {
      const latest = projectMeetings[0];
      const { document, transcript } = await resolveMeetingContinuationPayload(
        latest,
        dispatch
      );
      if (cancelled || !document) return;

      dispatch(
        setMeetingContinuation({
          mode: "continue",
          parentMeetingId: latest.meeting_id,
          parentDocumentId: document._id || document.id,
          parentDocument: document,
          parentTranscript: transcript,
          parentStorageSource: getMeetingStorageSource(latest),
        })
      );
      continuationInitializedRef.current = true;
    };

    initializeContinuation();

    return () => {
      cancelled = true;
    };
  }, [dispatch, loadingMeetings, projectMeetings]);



  // Use useEffect to focus the input after it appears
  useEffect(() => {
    if (agent && textInputRef.current) {
      textInputRef.current.focus();
    }
  }, [agent]);

  // const storeSocket = useSelector((state) => state.MainStates_Slice.socket);

  const meetingType = useSelector(
    (state) => state.MainStates_Slice.meetingType
  );
  const { localVideoRef } = useRefs();
  
  const navigate = useNavigate();

  const [joined] = useState(false);
  console.log("localvideoRef", localVideoRef);

  const location = useLocation();
  const from = location.state?.from;


  const handleKeyPress = (e) => {
    if (e.key === "Enter") {
      joinRoom();
    }
  };

  const handleCheckboxChange = (e) => {
    dispatch(setAgent(e.target.checked));
  };

  const usePreviousDocument = useSelector((state) => state.reports?.usePreviousDocument ?? false);
  const [showFreshStartModal, setShowFreshStartModal] = useState(false);

  const applyMeetingContinuation = async (meeting) => {
    const { document, transcript } = await resolveMeetingContinuationPayload(
      meeting,
      dispatch
    );
    if (!document) return;

    dispatch(
      setMeetingContinuation({
        mode: "continue",
        parentMeetingId: meeting.meeting_id,
        parentDocumentId: document._id || document.id,
        parentDocument: document,
        parentTranscript: transcript,
        parentStorageSource: getMeetingStorageSource(meeting),
      })
    );
  };

  const handleContinuationModeChange = (event) => {
    const nextMode = event.target.value;
    if (nextMode === "fresh" && projectMeetings.length > 0) {
      setShowFreshStartModal(true);
      return;
    }
    if (nextMode === "continue" && projectMeetings.length > 0) {
      applyMeetingContinuation(projectMeetings[0]);
    }
  };

  const handleSelectParentMeeting = (meeting) => {
    applyMeetingContinuation(meeting);
  };

  const confirmFreshStart = () => {
    dispatch(clearMeetingContinuation());
    setShowFreshStartModal(false);
  };

  const cancelFreshStart = () => {
    setShowFreshStartModal(false);
  };

  const generateMeetingLink = async () => {
    return new Promise((resolve) => {
      const randomString = (length) => {
        const characters = "abcdefghijklmnopqrstuvwxyz0123456789";
        let result = "";
        for (let i = 0; i < length; i++) {
          result += characters.charAt(
            Math.floor(Math.random() * characters.length)
          );
        }
        return result;
      };

      const part1 = randomString(3); // e.g., "yah"
      const part2 = randomString(5); // e.g., "2adch"
      const meetingLink = `${part1}-${part2}`;
      resolve(meetingLink);
    });
  };


  /** Creates a random meeting slug, emits document template to backend, and opens the room. */
  const joinRoom = async () => {
    console.log("join room function", roomId);
    const meetingId = await generateMeetingLink();

    if (agent && agentName.trim()) {
      const finalAgentName = agentName.startsWith("Agent ")
        ? agentName
        : `Agent ${agentName}`;
      dispatch(setAgentName(finalAgentName));
      console.log("Final Agent Name:", finalAgentName);
    }

    setJoinStatus("approved");
    console.log("Generated Meeting Link:", meetingId);
    dispatch(setIsAdmin(true));
    dispatch(setRoomId(meetingId));
    if (wantDocumentTemplate) {
      let previousSections = {};
      let basedOnMeetingId = null;
      let basedOnDocumentId = null;

      if (
        meetingContinuation?.mode === "continue" &&
        meetingContinuation?.parentDocument
      ) {
        const { document: resolvedParentDoc } = await resolveMeetingContinuationPayload(
          {
            meeting_id: meetingContinuation.parentMeetingId,
            document: meetingContinuation.parentDocument,
            transcript: meetingContinuation.parentTranscript,
            storage_source: meetingContinuation.parentStorageSource,
          },
          dispatch
        );

        if (resolvedParentDoc) {
          previousSections =
            resolvedParentDoc.generated_sections ||
            resolvedParentDoc.generatedSections ||
            {};
          basedOnMeetingId = meetingContinuation.parentMeetingId;
          basedOnDocumentId = resolveSupabaseContinuationDocumentId(
            resolvedParentDoc._id || resolvedParentDoc.id,
          ) || null;
        }
      }

      const document_data = {
        user_id: userId,
        meeting_id: meetingId,
        template_document: {
          categories: projectTemplate?.template_document?.categories,
          sections: projectTemplate?.template_document?.sections,
        },
        previous_sections: previousSections,
        based_on_meeting_id: basedOnMeetingId,
        based_on_document_id: basedOnDocumentId,
      };
      socket.emit("document_template", document_data);
    }

    navigate(`/${id}/${meetingId}`);
  };

  const settingAgentName = (e) => {
    e.preventDefault();
    const inputvalue = e.target.value;
    dispatch(setAgentName(inputvalue));
  };

  const [hasPermissions, setHasPermissions] = useState(false);
  const [permissionStatus, setPermissionStatus] = useState({
    camera: 'prompt',
    microphone: 'prompt'
  });

  // Check permissions on component mount
  useEffect(() => {
    checkPermissions();
  }, []);

  const checkPermissions = async () => {
    try {
      // Check camera permission
      const cameraPermission = await navigator.permissions.query({ name: 'camera' });
      // Check microphone permission
      const microphonePermission = await navigator.permissions.query({ name: 'microphone' });

      const newPermissionStatus = {
        camera: cameraPermission.state,
        microphone: microphonePermission.state
      };

      setPermissionStatus(newPermissionStatus);

      // Update hasPermissions based on both permissions being granted
      const bothGranted = cameraPermission.state === 'granted' &&
        microphonePermission.state === 'granted';
      setHasPermissions(bothGranted);

      // Listen for permission changes
      cameraPermission.onchange = () => {
        checkPermissions();
      };

      microphonePermission.onchange = () => {
        checkPermissions();
      };

    } catch (error) {
      console.error('Error checking permissions:', error);
      alert("Error checking permission")
      // Fallback: try to access media to trigger permission prompt

    }
  };

  const setPermissions = async () => {
    try {
      // Ask for camera + microphone access
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });

      // Update permission status
      setPermissionStatus({
        camera: "granted",
        microphone: "granted",
      });
      setHasPermissions(true);

      // Stop tracks so it doesn't keep camera/mic on
      stream.getTracks().forEach(track => track.stop());
    } catch (err) {
      console.error("Permission denied:", err);

      setPermissionStatus({
        camera: "denied",
        microphone: "denied",
      });
      setHasPermissions(false);
    }
  }

  const getPermissionText = () => {
    if (permissionStatus.camera === 'denied' || permissionStatus.microphone === 'denied') {
      return "Camera and microphone access denied. Please enable permissions in your browser settings.";
    } else if (!hasPermissions) {
      return "Please allow camera and microphone access to join the meeting.";
    }
    return "";
  };
  return (
    <div className="max-w-7xl mx-auto px-6 py-12">

      <div>
        <Breadcrumb
          style={{
            margin: "20px",
            marginLeft: "40px",
          }}
        >
          <Breadcrumb.Item>
            <HomeFilled />
            <Link to="/">Projects List</Link>
          </Breadcrumb.Item>
          <Breadcrumb.Item>
            <Link to={from}>{project_name}</Link>
          </Breadcrumb.Item>
          <Breadcrumb.Item>
            <Link>Create-Meeting</Link>
          </Breadcrumb.Item>
        </Breadcrumb>
      </div>

      {/* Main Content */}
      <div className="flex justify-center items-center  ">
        <div className="w-full max-w-md bg-white rounded-xl shadow-lg border border-gray-300 p-8 ">
          <div className="text-center mb-8">
            <h1 className="text-2xl font-semibold text-gray-800 mb-2">
              Create Meeting
            </h1>
          </div>

          <div className="space-y-6">
            {/* Meeting Type Selector */}
            <div>
              <label className="block text-gray-700 font-medium mb-3">
                Select Meeting Type
              </label>
              <select
                value={meetingType}
                // onChange={(e) => handleMeetingTypeChange(e.target.value)}
                onChange={(e) => dispatch(setMeetingType(e.target.value))}
                className="w-full px-4 py-3 text-gray-700 bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors"
              >
                <option value="Business Meeting">Business Meeting</option>

              </select>
            </div>

            {/* Meeting Agenda Input */}
            <div>
              <label className="block text-gray-700 font-medium mb-3">
                Meeting Agenda
              </label>
              <input
                type="text"
                placeholder="Enter meeting agenda"
                value={agenda}
                // onChange={handleAgendaChange}
                // onKeyPress={handleKeyPress}
                onChange={(e) => dispatch(setAgenda(e.target.value))}
                onKeyPress={handleKeyPress}
                className="w-full px-4 py-3 text-gray-700 bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors"
              />
            </div>

            {/* <div className="flex items-center justify-between">
              <label className="flex items-center cursor-pointer">
                
                <dl className="ml-3 text-gray-700">
                  <dt>Select Document Template</dt>
                  <dd className="flex items-center">
                    <input
                      type="checkbox"
                      
                      checked={wantDocumentTemplate}
                      onChange={(e) => dispatch(setWantDocumentTemplate(e.target.checked))}
                      className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500 focus:ring-2"
                    />
                    <span className="ml-3 text-gray-700">agile document proposal</span>
                  </dd>
                  <dd className="flex items-center">
                    <input
                      type="checkbox"
                     
                      checked={mvpVisionTemplate}
                      onChange={(e) => dispatch(setMVPVisionTemplate(e.target.checked))}
                      className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500 focus:ring-2"
                    />
                    <span className="ml-3 text-gray-700">MVP and Vision Document</span>
                  </dd>
                </dl>
              </label>
              <Link to={`/document-template/${project_name}/${id}`}
                state={{ from: location.pathname }}
              ><Button
                type="primary"
                size="large"
                className="shadow-xl border-0 flex items-center justify-center "
                icon={<FileTextOutlined />}

              >
                  Doc View
                </Button>
              </Link>


            </div> */}

{/* Document Template Section */}
<div className="space-y-3">
  <label className="block text-gray-700 font-medium">
    Select Document Template
  </label>

  {/* Option: None */}
  <label className="flex items-center justify-between p-3 rounded-lg border border-gray-200 cursor-pointer hover:bg-gray-50 transition-colors has-[:checked]:border-blue-500 has-[:checked]:bg-blue-50">
    <div className="flex items-center gap-3">
      <input
        type="radio"
        name="documentTemplate"
        value="none"
        checked={!wantDocumentTemplate && !mvpVisionTemplate}
        onChange={() => {
          dispatch(setWantDocumentTemplate(false));
          dispatch(setMVPVisionTemplate(false));
        }}
        className="w-4 h-4 text-blue-600 border-gray-300 focus:ring-blue-500"
      />
      <span className="text-gray-700 text-sm">No template</span>
    </div>
  </label>

  {/* Option: Agile Document Proposal */}
  <label className="flex items-center justify-between p-3 rounded-lg border border-gray-200 cursor-pointer hover:bg-gray-50 transition-colors has-[:checked]:border-blue-500 has-[:checked]:bg-blue-50">
    <div className="flex items-center gap-3">
      <input
        type="radio"
        name="documentTemplate"
        value="agile"
        checked={wantDocumentTemplate}
        onChange={() => {
          dispatch(setWantDocumentTemplate(true));
          dispatch(setMVPVisionTemplate(false));
        }}
        className="w-4 h-4 text-blue-600 border-gray-300 focus:ring-blue-500"
      />
      <span className="text-gray-700 text-sm">Agile document proposal</span>
    </div>
    <Link
      to={`/document-template/${project_name}/${id}`}
      state={{ from: location.pathname }}
      onClick={(e) => e.stopPropagation()}
      className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 hover:underline ml-2 shrink-0"
    >
      <FileTextOutlined style={{ fontSize: 12 }} />
      View
    </Link>
  </label>

  {/* Option: MVP and Vision Document */}
  <label className="flex items-center justify-between p-3 rounded-lg border border-gray-200 cursor-pointer hover:bg-gray-50 transition-colors has-[:checked]:border-blue-500 has-[:checked]:bg-blue-50">
    <div className="flex items-center gap-3">
      <input
        type="radio"
        name="documentTemplate"
        value="mvp"
        checked={mvpVisionTemplate}
        onChange={() => {
          dispatch(setWantDocumentTemplate(false));
          dispatch(setMVPVisionTemplate(true));
        }}
        className="w-4 h-4 text-blue-600 border-gray-300 focus:ring-blue-500"
      />
      <span className="text-gray-700 text-sm">MVP and Vision document</span>
    </div>
    <Link
      to={`/mvp-template/${project_name}/${id}`}
      state={{ from: location.pathname }}
      onClick={(e) => e.stopPropagation()}
      className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 hover:underline ml-2 shrink-0"
    >
      <FileTextOutlined style={{ fontSize: 12 }} />
      View
    </Link>
  </label>
</div>



            {/* Continue from previous meeting OR start fresh */}
            {(wantDocumentTemplate || mvpVisionTemplate) && projectMeetings.length > 0 && (
              <div className="p-3 rounded-lg border border-gray-200 bg-gray-50 space-y-3">
                <div className="text-sm font-medium text-gray-800">Meeting start</div>
                <Radio.Group
                  value={meetingContinuation?.mode === "continue" ? "continue" : "fresh"}
                  onChange={handleContinuationModeChange}
                  className="flex flex-col gap-2"
                >
                  <Radio value="fresh">Start fresh (empty template)</Radio>
                  <Radio value="continue">Continue from a previous meeting</Radio>
                </Radio.Group>

                {meetingContinuation?.mode === "continue" && (
                  <div className="space-y-2 max-h-48 overflow-y-auto pt-1">
                    {projectMeetings.map((meeting) => {
                      const doc = meeting.document;
                      const docId = doc?._id || doc?.id;
                      const isSelected =
                        meetingContinuation?.mode === "continue" &&
                        meetingContinuation?.parentDocumentId === docId;
                      const hasTranscript =
                        meeting.transcript?.has_transcript ||
                        (meeting.transcript?.entry_count ?? 0) > 0 ||
                        (meeting.transcript?.entries || []).length > 0;
                      const sourceLabel = getMeetingSourceLabel(meeting);
                      const sourceColor = getMeetingSourceColor(meeting);
                      return (
                        <label
                          key={getMeetingListKey(meeting)}
                          className={`flex items-start gap-2 p-2 rounded border cursor-pointer ${
                            isSelected
                              ? "border-blue-500 bg-blue-50"
                              : "border-gray-200 bg-white"
                          }`}
                        >
                          <Radio
                            checked={isSelected}
                            onChange={() => handleSelectParentMeeting(meeting)}
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <div className="text-sm font-medium truncate">
                                {getMeetingDisplayTitle(meeting, projectMeetings)}
                              </div>
                              <Tag color={sourceColor} className="!text-xs !m-0">
                                {sourceLabel}
                              </Tag>
                            </div>
                            <div className="text-xs text-gray-500 flex items-center gap-1 mt-0.5">
                              <CalendarOutlined />
                              {meeting.created_at || doc?.created_at
                                ? new Date(meeting.created_at || doc.created_at).toLocaleString()
                                : "Unknown date"}
                            </div>
                            <div className="mt-1 flex flex-wrap gap-1">
                              <Tag color="geekblue" className="!text-xs !m-0">
                                Document v{doc?.version || 1}
                              </Tag>
                              {hasTranscript && (
                                <Tag color="cyan" className="!text-xs !m-0">
                                  Transcript
                                </Tag>
                              )}
                            </div>
                          </div>
                        </label>
                      );
                    })}
                    {loadingExternal && (
                      <div className="text-xs text-gray-500 px-2 py-1">
                        Loading{" "}
                        {[
                          loadingSources.notion ? "Notion" : null,
                          loadingSources.googleDrive ? "Google Drive" : null,
                        ]
                          .filter(Boolean)
                          .join(" and ") || "external"}{" "}
                        meetings...
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {(wantDocumentTemplate || mvpVisionTemplate) &&
              !loadingMeetings &&
              projectMeetings.length === 0 &&
              (generatedDocuments?.documents?.length > 0) && (
              <div className="p-3 rounded-lg border border-amber-200 bg-amber-50 text-xs text-amber-800">
                Previous documents exist but are not linked to a meeting yet. This meeting will start fresh.
              </div>
            )}

            {/* Add Agent Section */}
            <div className="space-y-4">
              <label className="flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={agent}
                  onChange={handleCheckboxChange}
                  className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500 focus:ring-2"
                />
                <span className="ml-3 text-gray-700">
                  Do you want to add an Agent?
                </span>
              </label>

              {agent && (
                <div className="ml-7">
                  <input
                    ref={textInputRef}
                    type="text"
                    placeholder="Enter agent name"
                    value={agentName}
                    onChange={settingAgentName}
                    onKeyPress={handleKeyPress}
                    className="w-full px-4 py-3 text-gray-700 bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors"
                  />
                </div>
              )}
            </div>

            {/* Create Meeting Button */}
            <button
              onClick={joinRoom}
              disabled={(!agenda.trim() || (agent && !agentName.trim())) && !hasPermissions}
              className={`w-full py-3 px-4 rounded-lg font-semibold text-base transition-all duration-200 flex items-center justify-center space-x-2 ${!agenda.trim() || (agent && !agentName.trim())
                ? "bg-gray-300 text-gray-500 cursor-not-allowed"
                : "bg-blue-600 hover:bg-blue-700 text-white shadow-md hover:shadow-lg transform hover:-translate-y-0.5"
                }
              ${!hasPermissions ? "opacity-50 cursor-not-allowed" : ""}
              `}
            >
              <span>📅</span>
              <span>Create Meeting</span>
            </button>
            {!hasPermissions && (
              <div className="mt-4 text-center">
                <p className="text-yellow-400 text-sm max-w-md">
                  {getPermissionText()}
                </p>
                <button onClick={setPermissions} className="mt-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">
                  Set Permissions
                </button>
                <div className="mt-2 text-xs text-gray-400">
                  <p>Status: Camera - {permissionStatus.camera}, Microphone - {permissionStatus.microphone}</p>
                </div>
              </div>
            )}
          </div>

        </div>
      </div>

      {/* <Template/> */}

      {/* Confirmation modal for unchecking "Use previous meeting document" */}
      <Modal
        open={showFreshStartModal}
        title="Start fresh document?"
        okText="Yes, start fresh"
        cancelText="Keep previous document"
        okButtonProps={{ danger: true }}
        onOk={confirmFreshStart}
        onCancel={cancelFreshStart}
      >
        <p>
          Starting fresh will load an empty template. Your previous meeting documents
          and transcripts will stay in Meeting History — nothing will be deleted or overwritten.
        </p>
      </Modal>
    </div>
  );
}

export default MainApp;
