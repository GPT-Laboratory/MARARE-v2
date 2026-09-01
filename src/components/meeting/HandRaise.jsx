/**
 * Hand-raise UI synced across peers via Socket.IO.
 * File: src/components/meeting/HandRaise.jsx
 */
import React, { useEffect } from "react";
import { FaHand } from "react-icons/fa6";
import { useRefs } from '../../providers/RefProvider';
import { useAuth } from '../../pages/auth/authcontext';

const HandRaise = ({ userId, socket, meetingId }) => {
  const { isRaised, setIsRaised } = useRefs();
  const {user} = useAuth();
  

  const toggleHand = () => {
    console.log("hand is raised");
    const newState = !isRaised;
    setIsRaised(newState);
    socket.emit("hand_toggle", { userId, raised: newState, meetingId, userName: user?.user_metadata?.full_name});
  };

  return (
    <button
      className={`${
        isRaised ? "bg-blue-600" : "bg-gray-600"
      } hover:opacity-90 text-white p-4 rounded-full w-12 h-12 flex items-center justify-center transition-colors cursor-pointer`}
      onClick={toggleHand}
    >
      <FaHand size={100} />
    </button>
  );
};

export default HandRaise;


