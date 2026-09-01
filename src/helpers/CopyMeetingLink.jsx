/**
 * Copy-to-clipboard button for sharing meeting URL.
 * File: src/helpers/CopyMeetingLink.jsx
 */
// import React, { useState } from "react";
// import { Button, message } from "antd";
// import { CopyOutlined, CloseOutlined } from "@ant-design/icons";


// const CopyMeetingLink = ({ meetingLink, onClose }) => {
//   const [copied, setCopied] = useState(false);

//   const handleCopy = () => {
//     navigator.clipboard.writeText(meetingLink).then(() => {
//       setCopied(true);
//       message.success("Meeting link copied!");
//       setTimeout(() => setCopied(false), 2000);
//     });
//   };

//   return (
//     <div className="fixed bottom-20 left-4 z-[9999] w-[90%] md:w-[30%] ">
//       <div className="relative bg-white shadow-xl rounded-2xl p-6 flex flex-col sm:flex-row sm:items-center gap-6 border border-gray-200 transition-all">
        
//         {/* Close Button */}
//         <button
//           onClick={onClose}
//           className="absolute cursor-pointer top-3 right-3 text-gray-800 hover:text-red-500 transition-colors"
//         >
//           <CloseOutlined className="text-sm" />
//         </button>

//         {/* Meeting Link */}
//         <div className="flex-1 overflow-hidden mt-4 ">
//           <p className="text-base font-semibold text-gray-800 truncate">
//             {meetingLink}
//           </p>
//         </div>

//         {/* Copy Button */}
//         <Button
//           type={copied ? "default" : "primary"}
//           size="medium"
//           icon={<CopyOutlined />}
//           onClick={handleCopy}
//           className={`rounded-lg px-6 text-sm py-1  font-medium md:mt-4 ${
//             copied ? "bg-green-500 text-white hover:bg-green-600" : ""
//           }`}
//         >
//           {copied ? "Copied" : "Copy"}
//         </Button>
//       </div>
//     </div>
//   );
// };

// export default CopyMeetingLink;











import React, { useState } from "react";
import { Button, message } from "antd";
import { CopyOutlined, CloseOutlined } from "@ant-design/icons";
import { useTheme } from "../context/ThemeContext.jsx";

const CopyMeetingLink = ({ meetingLink, onClose }) => {
  const [copied, setCopied] = useState(false);
  const { isDarkMode } = useTheme();

  const handleCopy = () => {
    navigator.clipboard.writeText(meetingLink).then(() => {
      setCopied(true);
      message.success("Meeting link copied!");
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="fixed bottom-20 left-4 z-[9999] w-[90%] md:w-[30%]">
      <div
        className={`relative shadow-xl rounded-2xl p-6 flex flex-col gap-4 border transition-all ${
          isDarkMode
            ? "bg-gray-900 border-gray-700"
            : "bg-white border-gray-200"
        }`}
      >
        
        {/* Close Button */}
        <button
          onClick={onClose}
          className={`absolute cursor-pointer top-3 right-3 transition-colors ${
            isDarkMode ? "text-gray-200 hover:text-red-400" : "text-gray-800 hover:text-red-500"
          }`}
        >
          <CloseOutlined className="text-sm" />
        </button>

        {/* Heading & Sub-text */}
        <div>
          <h2 className={`text-lg font-bold ${isDarkMode ? "text-gray-100" : "text-gray-900"}`}>
            Your meeting is ready
          </h2>
          <p className={`text-sm ${isDarkMode ? "text-gray-400" : "text-gray-600"}`}>
            Share this link with others
          </p>
        </div>

        {/* Meeting Link */}
        <div className="flex-1 overflow-hidden">
          <p
            className={`text-base p-2 rounded truncate border ${
              isDarkMode
                ? "bg-gray-800 border-gray-700 text-gray-100"
                : "bg-gray-200 border-gray-200 text-gray-800"
            }`}
          >
            {meetingLink}
          </p>
        </div>

        {/* Copy Button */}
        <Button
          type={copied ? "default" : "primary"}
          size="middle"
          icon={<CopyOutlined />}
          onClick={handleCopy}
          className={`rounded-lg px-6 text-sm py-1 font-medium ${
            copied ? "bg-green-500 text-white hover:bg-green-600" : ""
          }`}
        >
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
    </div>
  );
};

export default CopyMeetingLink;
