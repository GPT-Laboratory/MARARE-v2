/**
 * Emoji reactions broadcast to other participants.
 * File: src/components/meeting/ReactionComponent.jsx
 */
// ReactionComponent.jsx
import React, { useState, useEffect } from "react";
import '../../styles/meeting/ReactionComponent.css';
import { FaSurprise } from "react-icons/fa";

const ReactionComponent = ({ socket, userId }) => {
  const [latestReaction, setLatestReaction] = useState(null);
  const [showPicker, setShowPicker] = useState(false);
  console.log("user id in the reaction", userId);

  //   // Better debugging - inspect if socket is valid
  //   useEffect(() => {
  //     console.log("Socket connection status:", socket?.connected);
  //     console.log("Current user:", currentUser);
  //   }, [socket, currentUser]);

  // Handle receiving reactions
  useEffect(() => {
    if (!socket) {
      console.warn("Socket not available for reaction listener");
      return;
    }

    const handleReaction = (reactionData) => {
      console.log("Received reaction:", reactionData);
      // Set only the latest reaction
      setLatestReaction(reactionData);

      // Auto-remove reaction after animation duration
      setTimeout(() => {
        setLatestReaction((prev) =>
          prev && prev.timestamp === reactionData.timestamp ? null : prev
        );
      }, 3000);
    };

    socket.on("receive-reaction", handleReaction);
    

    return () => {
      socket.off("receive-reaction", handleReaction);
    };
  }, [socket]);

  // Send reaction
  const sendReaction = (reaction) => {
    // Proper object logging and validation
    // console.log("Socket available:", !!socket);
    // console.log("Current user:", currentUser);

    if (!socket) {
      console.error("Cannot send reaction: Socket or user not available");
      return;
    }

    const reactionData = {
      userId,
      reaction,
      timestamp: Date.now(),
    };

    console.log("Sending reaction data:", reactionData);

    try {
      socket.emit("send-reaction", reactionData);
      // Set only the latest reaction
      setLatestReaction(reactionData);
      setShowPicker(false);

      // Auto-remove reaction after animation duration
      setTimeout(() => {
        setLatestReaction((prev) =>
          prev && prev.timestamp === reactionData.timestamp ? null : prev
        );
      }, 3000);
    } catch (error) {
      console.error("Error sending reaction:", error);
    }
  };

  // Reaction bubble component
  const ReactionBubble = ({ reaction, userId }) => {
    return (
      <>
        <div className="reaction-bubble">{reaction}<div style={{ color: "white", fontSize: "10px" }}>{userId.slice(0,4)}</div></div>
        
        
      </>
    );
  };

  return (
    <div className="reaction-component">
      {/* Reactions display - only showing latest reaction */}
      <div className="reactions-container">
        {latestReaction && (
          <ReactionBubble
            key={`${latestReaction.userId}-${latestReaction.timestamp}`}
            reaction={latestReaction.reaction}
            userId={latestReaction.userId}
          />
        )}
      </div>

      {/* Reaction picker toggle */}
      <button
        className="bg-gray-600 reaction-toggle-btn hover:opacity-90 text-white p-4 rounded-full w-12 h-12 flex items-center justify-center transition-colors cursor-pointer"
        onClick={() => setShowPicker(!showPicker)}
        aria-label="Toggle reactions"
      >
        <FaSurprise size={30} />
      </button>

      {/* Reaction picker */}
      {showPicker && (
        <div className="reaction-picker">
          {["👍", "👎", "❤️", "😂", "😮", "👏", "🔥", "🤔"].map((emoji) => (
            <button
              key={emoji}
              onClick={() => sendReaction(emoji)}
              className="reaction-btn"
              aria-label={`React with ${emoji}`}
            >
              {emoji}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default ReactionComponent;
