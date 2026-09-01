/**
 * In-meeting text chat via Socket.IO.
 * File: src/components/meeting/RoomChat.jsx
 */
import React, { useEffect, useRef } from "react";
import { CloseOutlined, SendOutlined } from "@ant-design/icons";

const RoomChat = ({
  messages,
  currentMessage,
  setCurrentMessage,
  handleSendMessage,
  onClose,
}) => {
  const messagesEndRef = useRef(null);

  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  const handleKeyPress = (e) => {
    if (e.key === "Enter" && currentMessage.trim() !== "") {
      handleSendMessage();
    }
  };

  return (
    <div className="w-[15vw] h-[85vh] bg-black text-white rounded-2xl shadow-2xl flex flex-col justify-between overflow-hidden relative top-4 right-2 z-[1000] border border-gray-800">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700 bg-black">
        <h2 className="text-md font-semibold text-white">In Call messages</h2>
        <CloseOutlined
          onClick={onClose}
          className="text-gray-400 hover:text-red-500 cursor-pointer"
        />
      </div>

      <div
        className={`px-4 py-2 flex-grow ${
          messages.length >= 7 ? "overflow-y-scroll" : ""
        }`}
      >
        {messages.map((msg, index) => {
          if (!msg.text || msg.text.trim() === "") return null;

          return (
            <div key={index} className="mb-4">
              <p className="text-sm font-medium text-white">
                {msg.sender}{" "}
                <span className="text-xs text-gray-400 ml-2">{msg.time}</span>
              </p>
              <p className="text-sm text-gray-300">{msg.text}</p>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      <div className="flex items-center px-2 py-3 border-t border-gray-700 bg-black">
        <input
          type="text"
          value={currentMessage}
          onChange={(e) => setCurrentMessage(e.target.value)}
          onKeyPress={handleKeyPress}
          placeholder="Send a message"
          className="flex-grow px-4 py-2 text-sm bg-gray-900 text-white placeholder-gray-500 border border-gray-700 rounded-full focus:outline-none focus:ring-2 focus:ring-blue-400"
        />
        <button onClick={handleSendMessage} className="ml-2 text-blue-400">
          <SendOutlined className="text-lg text-blue-400 hover:text-blue-300 cursor-pointer" />
        </button>
      </div>
    </div>
  );
};

export default RoomChat;
