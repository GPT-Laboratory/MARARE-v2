/**
 * End-meeting prompt — save document, summary, or discard.
 * File: src/components/meeting/MeetingAction.jsx
 */
import React from "react";
import { useDispatch, useSelector } from "react-redux";
import { setMeetingStatus } from '../../features/mainStates/MainStates_Slice';
import { useRefs } from '../../providers/RefProvider';


const MeetingAction = ({ onEndMeeting, onLeaveMeeting, onClose }) => {
    const {
       
        userId,
        
      } = useRefs();
      const roomId = useSelector((state) => state.MainStates_Slice.roomId);

    return (
      <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-50 z-50">
        <div className="bg-black text-white border border-gray-700 rounded-lg p-6 w-80 shadow-lg">
          <h2 className="text-xl font-bold mb-4 text-center text-white">Meeting Options</h2>
          <p className="text-gray-300 mb-6 text-center">What would you like to do?</p>
          <div className="flex justify-around">
            <button
              onClick={()=>onEndMeeting(roomId, userId)}
              className="bg-red-500 hover:bg-red-600 text-white py-2 px-4 rounded"
            >
              End Meeting
            </button>
            <button
              onClick={()=>onLeaveMeeting(userId)}
              className="bg-blue-500 hover:bg-blue-600 text-white py-2 px-4 rounded"
            >
              Leave Meeting
            </button>
          </div>
          <button
            onClick={onClose}
            className="mt-4 text-gray-400 hover:text-white block mx-auto"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  };
  

export default MeetingAction;
