/**
 * Meeting controls — mic, camera, screen share, leave.
 * File: src/components/meeting/BottomBar.jsx
 */
import React, { useRef, useState, useEffect } from "react";
import '../../styles/meeting/MessageNotification.css';
import {
  FaVideo,
  FaVideoSlash,
  FaMicrophone,
  FaMicrophoneSlash,
  FaPhoneSlash,
  FaClosedCaptioning,
  FaComments,
  FaDesktop,
  FaEllipsisV,
  FaTimes,
  FaHandPaper,
  FaSmile,
  FaCog,
  FaFileAlt
} from "react-icons/fa";

import {
  AudioOutlined,
  AudioMutedOutlined,
  VideoCameraOutlined,
  VideoCameraFilled,
  PhoneOutlined,
  DesktopOutlined,
  MessageOutlined,
  UserOutlined,
  SettingOutlined,
  MoreOutlined
} from "@ant-design/icons";
import { useSelector } from "react-redux";
import { useRefs } from '../../providers/RefProvider';
import ReactionComponent from "./ReactionComponent";
import HandRaise from "./HandRaise";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import RealtimeMvpVisionDisplay from '../../components/meeting/RealtimeMvpVisionDisplay';
import { Sparkle } from "lucide-react";
import Template from '../../pages/templates/Template';
const BottomBar = ({
  enableVideo,
  toggleVideo,
  enableAudio,
  toggleAudio,
  enableCaptions,
  toggleCaptions,
  enableChat,
  toggleChat,
  leaveRoom,
  hasUnreadMessages,
  messages,
  socket,
  userId1,
  meetingId,
  toggleBar,
  toggleBarState,
  isPopupOpen,
  setIsPopupOpen,
  mvpVisionRef,
}) => {
  const { userId } = useRefs();
  const { isScreenSharing, setIsScreenSharing } = useRefs();

  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const menuRef = useRef(null);
  const { id } = useParams()
  const agent = useSelector((state) => state.MainStates_Slice.agent);


  // Close mobile menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setIsMobileMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const screenShare = () => {
    setIsScreenSharing(!isScreenSharing);
  };

  const handleMobileMenuToggle = () => {
    setIsMobileMenuOpen(!isMobileMenuOpen);
  };

  const closeMobileMenu = () => {
    setIsMobileMenuOpen(false);
  };

  // Mobile menu items (secondary controls)
  const mobileMenuItems = [
    // {
    //   id: 'captions',
    //   label: 'Captions',
    //   icon: <span className="text-sm font-bold">CC</span>,
    //   onClick: () => {
    //     toggleCaptions();
    //     closeMobileMenu();
    //   },
    //   isActive: enableCaptions,
    //   activeColor: `bg-blue-600 `

    // },

    ...(agent
      ? [
        {
          id: 'captions',
          label: 'Captions',
          icon: <span className="text-sm font-bold">CC</span>,
          onClick: () => {
            toggleCaptions();
            closeMobileMenu();
          }, 
          isActive: enableCaptions,
          activeColor: 'bg-blue-600',
        },
      ]
      : []),
    {
      id: 'screenshare',
      label: 'Share screen',
      icon: <DesktopOutlined style={{ fontSize: "18px" }} />,
      onClick: () => {
        screenShare();
        closeMobileMenu();
      },
      isActive: isScreenSharing,
      activeColor: 'bg-blue-600'
    },
    // {
    //   id: 'reactions',
    //   label: 'Reactions',
    //   icon: <FaSmile size={16} />,
    //   onClick: () => {
    //     closeMobileMenu();
    //     // Handle reactions - you might want to show reactions popup
    //   },
    //   isActive: false
    // },
    {
      id: 'raise-hand',
      label: 'Raise hand',
      icon: <FaHandPaper size={16} />,
      onClick: () => {
        closeMobileMenu();
        // Handle hand raise
      },
      isActive: false
    },
    {
      id: 'Add Connectors',
      label: 'Add Connectors',
      icon: <FaCog size={16} />,
      onClick: () => {
        setIsPopupOpen(!isPopupOpen);
        closeMobileMenu();
      },
      isActive: isPopupOpen
    },
  
    
    

  ];
  return (
    <div className="fixed bottom-0 left-0 right-0 w-full p-2 sm:p-3 md:p-4 z-50 bg-black text-white border-t border-gray-800">
      {/* Mobile Layout */}
      <div className="md:hidden relative">
        {/* Main Controls Bar */}
        <div className="flex justify-center items-center space-x-1.5 xs:space-x-2 sm:space-x-3 px-1">
          {/* Audio Toggle */}
          <button
            onClick={toggleAudio}
            className={`${enableAudio
                ? "bg-gray-700 hover:bg-gray-600"
                : "bg-red-600 hover:bg-red-700"
              } text-white p-2.5 xs:p-3 rounded-full min-w-[48px] min-h-[48px] xs:w-12 xs:h-12 sm:w-14 sm:h-14 flex items-center justify-center flex-shrink-0 transition-all duration-200 shadow-lg`}
          >
            {enableAudio ? (
              <FaMicrophone className="w-4 h-4 xs:w-5 xs:h-5" />
            ) : (
              <FaMicrophoneSlash className="w-4 h-4 xs:w-5 xs:h-5" />
            )}
          </button>

          {/* Video Toggle */}
          <button
            onClick={toggleVideo}
            className={`${enableVideo
                ? "bg-gray-700 hover:bg-gray-600"
                : "bg-red-600 hover:bg-red-700"
              } text-white p-2.5 xs:p-3 rounded-full min-w-[48px] min-h-[48px] xs:w-12 xs:h-12 sm:w-14 sm:h-14 flex items-center justify-center flex-shrink-0 transition-all duration-200 shadow-lg`}
          >
            {enableVideo ? (
              <FaVideo className="w-4 h-4 xs:w-5 xs:h-5" />
            ) : (
              <FaVideoSlash className="w-4 h-4 xs:w-5 xs:h-5" />
            )}
          </button>

          {/* Leave Room */}
          <button
            onClick={() => leaveRoom(userId)}
            className="bg-red-600 hover:bg-red-700 text-white p-2.5 xs:p-3 rounded-full min-w-[48px] min-h-[48px] xs:w-12 xs:h-12 sm:w-14 sm:h-14 flex items-center justify-center flex-shrink-0 transition-all duration-200 shadow-lg"
          >
            <PhoneOutlined className="text-lg xs:text-xl" />
          </button>

          {/* Chat Button - In main controls */}
          <button
            onClick={toggleChat}
            className={`${enableChat
                ? "bg-blue-600 hover:bg-blue-700"
                : "bg-gray-700 hover:bg-gray-600"
              } text-white p-2.5 xs:p-3 cursor-pointer rounded-full min-w-[48px] min-h-[48px] xs:w-12 xs:h-12 sm:w-14 sm:h-14 flex items-center justify-center flex-shrink-0 transition-all duration-200 shadow-lg relative`}
          >
            <MessageOutlined className="text-lg xs:text-xl" />
            {hasUnreadMessages && !enableChat && (
              <div className="absolute -top-1 -right-1 xs:-top-2 xs:-right-2 h-4 w-4 xs:h-6 xs:w-6 flex items-center justify-center text-white bg-red-500 rounded-full text-xs font-semibold">
                {messages.length > 99 ? '99+' : messages.length}
              </div>
            )}
          </button>

          {/* RealtimeMvpVisionDisplay with responsive sizing */}
          <div className="flex-shrink-0">
            <RealtimeMvpVisionDisplay ref={mvpVisionRef}  meetingId={id} />
            {/* <Template/> */}
          </div>

          {/* More Options (3 dots) */}
          <button
            onClick={handleMobileMenuToggle}
            className={`${isMobileMenuOpen
                ? "bg-blue-600 hover:bg-blue-700"
                : "bg-gray-700 hover:bg-gray-600"
              } text-white p-2.5 xs:p-3 cursor-pointer rounded-full min-w-[48px] min-h-[48px] xs:w-12 xs:h-12 sm:w-14 sm:h-14 flex items-center justify-center flex-shrink-0 transition-all duration-200 shadow-lg`}
          >
            <FaEllipsisV className="w-4 h-4 xs:w-5 xs:h-5" />
          </button>
        </div>

        {/* Mobile Popup Menu */}
        {isMobileMenuOpen && (
          <div
            ref={menuRef}
            className={`absolute bottom-full right-2 xs:right-4 mb-2 bg-gray-900 rounded-lg shadow-2xl border border-gray-700 min-w-[200px] xs:min-w-[240px] overflow-hidden z-60 transform transition-all duration-300 ease-out ${isMobileMenuOpen ? 'opacity-100 scale-100 translate-y-0' : 'opacity-0 scale-95 translate-y-2'
              }`}
          >
            {/* Menu Header */}
            <div className="px-3 xs:px-4 py-2.5 xs:py-3 border-b border-gray-700 flex items-center justify-between">
              <span className="text-white text-sm font-medium">More options</span>
              <button
                onClick={closeMobileMenu}
                className="text-gray-400 hover:text-white p-1 cursor-pointer"
              >
                <FaTimes size={14} />
              </button>
            </div>

            {/* Menu Items */}
            <div className="py-1 xs:py-2">
              {mobileMenuItems.map((item, index) => (
                <button
                  key={item.id}
                  onClick={item.onClick}
                  className={`w-full px-3 xs:px-4 py-2.5 xs:py-3 text-left cursor-pointer flex items-center space-x-2.5 xs:space-x-3 hover:bg-gray-800 transition-colors duration-200 ${item.isActive ? 'bg-gray-800' : ''
                    }`}
                >
                  <div className={`w-7 h-7 xs:w-8 xs:h-8 rounded-full flex items-center justify-center text-white flex-shrink-0 ${item.isActive && item.activeColor
                      ? item.activeColor
                      : 'bg-gray-700'
                    }`}>
                    {item.icon}
                  </div>
                  <span className="text-white text-sm font-medium truncate">{item.label}</span>
                  {item.isActive && (
                    <div className="ml-auto w-2 h-2 bg-blue-500 rounded-full flex-shrink-0"></div>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Backdrop for mobile menu - Removed completely since background should remain visible */}
      </div>

      {/* Desktop Layout - Original Enhanced */}
      <div className="hidden md:flex justify-center space-x-4 md:space-x-6">
        {/* Audio Toggle */}
        <button
          onClick={toggleAudio}
          className={`${enableAudio
              ? "bg-gray-700 hover:bg-gray-600"
              : "bg-red-600 hover:bg-red-700"
            } text-white p-3 rounded-full w-14 h-14 flex items-center justify-center transition-all duration-200 cursor-pointer shadow-lg`}
        >
          {enableAudio ? (
            <FaMicrophone size={22} />
          ) : (
            <FaMicrophoneSlash size={22} />
          )}
        </button>

        {/* Video Toggle */}
        <button
          onClick={toggleVideo}
          className={`${enableVideo
              ? "bg-gray-700 hover:bg-gray-600"
              : "bg-red-600 hover:bg-red-700"
            } text-white p-3 rounded-full w-14 h-14 flex items-center justify-center transition-all duration-200 cursor-pointer shadow-lg`}
        >
          {enableVideo ? <FaVideo size={22} /> : <FaVideoSlash size={22} />}
        </button>
        <RealtimeMvpVisionDisplay meetingId={id} />
        {/* <Template/> */}

        {/* Captions Toggle */}
       {agent && (
  <div className="relative group">
    <button
      onClick={toggleCaptions}
      className={`${
        enableCaptions
          ? "bg-blue-600 hover:bg-blue-700"
          : "bg-gray-700 hover:bg-gray-600"
      } text-white p-3 rounded-full w-14 h-14 flex items-center justify-center transition-all duration-200 cursor-pointer shadow-lg`}
    >
      <svg
        width="32"
        height="32"
        viewBox="0 0 64 64"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* Outer ring */}
        <circle
          cx="32"
          cy="32"
          r="26"
          stroke="#EF4444"
          strokeWidth="4"
          opacity="0.8"
        />

        {/* Inner recording dot */}
        <circle cx="32" cy="32" r="14" fill="#EF4444" />
      </svg>
    </button>

    {/* Hover Tooltip */}
    <div className="
      absolute bottom-full mb-2 left-1/2 -translate-x-1/2
      px-3 py-1 rounded-md bg-black text-white text-xs
      opacity-0 scale-95
      group-hover:opacity-100 group-hover:scale-100
      transition-all duration-200
      pointer-events-none
      whitespace-nowrap
    ">
      must enable this for meeting results
    </div>
  </div>
)}


        {/* Screen Share Toggle */}
        <button
          onClick={screenShare}
          className={`${isScreenSharing
              ? "bg-blue-600 hover:bg-blue-700"
              : "bg-gray-700 hover:bg-gray-600"
            } text-white p-3 rounded-full w-14 h-14 flex items-center justify-center transition-all duration-200 cursor-pointer shadow-lg`}
        >
          <DesktopOutlined style={{ fontSize: "26px" }} />
        </button>

        {/* Leave Room */}
        <button
          onClick={() => leaveRoom(userId)}
          className="bg-red-600 hover:bg-red-700 text-white p-3 rounded-full w-14 h-14 flex items-center justify-center transition-all duration-200 cursor-pointer shadow-lg"
        >
          <PhoneOutlined

          />
        </button>

        {/* Reactions component */}
        {/* <ReactionComponent socket={socket} userId={userId1} /> */}

        {/* HandRaise */}
        <HandRaise socket={socket} userId={userId1} meetingId={meetingId} />

        {/* Chat Toggle */}
        <button
          onClick={toggleChat}
          className={`${enableChat
              ? "bg-blue-600 hover:bg-blue-700"
              : "bg-gray-700 hover:bg-gray-600"
            } text-white p-3 rounded-full w-14 h-14 flex items-center justify-center transition-all duration-200 absolute right-4 md:right-8 bottom-4 cursor-pointer shadow-lg`}
        >
          <MessageOutlined style={{ fontSize: "26px" }} />
          {hasUnreadMessages && !enableChat && (
            <div className="absolute -top-2 -right-2 h-6 w-6 flex items-center justify-center text-white bg-red-500 rounded-full text-xs font-semibold">
              {messages.length > 99 ? '99+' : messages.length}
            </div>
          )}
        </button>

        {/* Settings Button */}
        <button
          onClick={() => setIsPopupOpen(!isPopupOpen)}
          className={`absolute bg-gray-700 hover:bg-gray-600 text-white p-3 rounded-full w-14 h-14 flex items-center justify-center transition-all duration-200 cursor-pointer z-30 left-4 md:left-8 bottom-4 shadow-lg ${isPopupOpen ? "opacity-75" : ""
            }`}
        >
          <SettingOutlined style={{ fontSize: "26px" }} />
        </button>

      </div>
    </div>
  );
};

export default BottomBar;