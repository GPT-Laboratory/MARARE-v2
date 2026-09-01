/**
 * Full-screen spinner for long-running operations.
 * File: src/components/meeting/FullPageLoader.jsx
 */
// import React from "react";

// const FullPageLoader = ({ isLoading }) => {
//   if (!isLoading) return null;
//   console.log("Rendering FullPageLoader...");
  

//   return (
//     <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
//       <div className="text-center flex flex-col justify-center items-center align-middle">
//         <div className="w-16 h-16 border-4 border-t-transparent border-white rounded-full animate-spin"></div>
//         <p className="mt-4 text-white text-lg">Meeting Documents are generating, please wait...</p>
//       </div>
//     </div>
//   );
// };

// export default FullPageLoader;



























import React from "react";
import { Avatar } from "antd";

const FullPageLoader = ({ isLoading }) => {
  if (!isLoading) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
      <div className="flex items-center justify-center space-x-8">
        
        {/* Left Agent */}
        <div className="text-center">
          <Avatar 
            size={80} 
            className="bg-blue-500 mb-4 animate-pulse"
            style={{ fontSize: '32px' }}
          >
            🤖
          </Avatar>
          <p className="text-white text-sm font-medium">Research Agent</p>
        </div>

        {/* Center - Data Flow */}
        <div className="flex flex-col items-center">
          {/* Data packets flowing right */}
          <div className="flex space-x-2 mb-2">
            <div className="w-3 h-3 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '0s' }}></div>
            <div className="w-3 h-3 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
            <div className="w-3 h-3 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '0.4s' }}></div>
          </div>
          
          {/* Arrow */}
          <div className="text-white text-2xl animate-pulse">→</div>
          
          {/* Data packets flowing left */}
          <div className="flex space-x-2 mt-2">
            <div className="w-3 h-3 bg-green-400 rounded-full animate-bounce" style={{ animationDelay: '0.6s' }}></div>
            <div className="w-3 h-3 bg-green-400 rounded-full animate-bounce" style={{ animationDelay: '0.8s' }}></div>
            <div className="w-3 h-3 bg-green-400 rounded-full animate-bounce" style={{ animationDelay: '1s' }}></div>
          </div>
        </div>

        {/* Right Agent */}
        <div className="text-center">
          <Avatar 
            size={80} 
            className="bg-green-500 mb-4 animate-pulse"
            style={{ fontSize: '32px' }}
          >
            📝
          </Avatar>
          <p className="text-white text-sm font-medium">Content Agent</p>
        </div>
      </div>
      
      <div className="absolute bottom-20 left-1/2 transform -translate-x-1/2">
        <p className="text-white text-lg text-center">Meeting Documents are generating, please wait...</p>
      </div>
    </div>
  );
};

export default FullPageLoader;