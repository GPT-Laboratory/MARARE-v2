/**
 * Notification list/bell for meeting events.
 * File: src/components/meeting/Notifications.jsx
 */
import React, { useContext } from 'react';
// import { Context } from '../ContextAzure';

const Notifications = () => {
  // const { answerCall, call, callAccepted } = useContext(Context);

  return (
    <>
      {call.isReceivingCall && !callAccepted && (
        <div className="flex justify-around items-center p-4 bg-white rounded-md shadow-md">
          <h1 className="text-lg font-semibold text-gray-800 font-sans">
            {call.name} is calling:
          </h1>
          <button
            onClick={answerCall}
            className="bg-blue-500 text-white px-4 py-2 rounded-md hover:bg-blue-600 transition duration-200"
          >
            Answer
          </button>
        </div>
      )}
    </>
  );
};

export default Notifications;
