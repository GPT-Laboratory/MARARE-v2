/**
 * Host panel to approve or reject guest join requests.
 * File: src/components/meeting/AdminApprovalPanel.jsx
 */
// AdminApprovalPanel.jsx
import React, { useState, useEffect } from 'react';
import { playNotificationSound } from '../../helpers/notification.jsx';
import { Users, Check, X, UserPlus, ChevronDown, ChevronUp } from 'lucide-react';

const AdminApprovalPanel = ({ socket, roomId, handlemessage }) => {
  const [pendingRequests, setPendingRequests] = useState([]);
  // console.log("AdminApprovalPanel", socket, roomId);


  useEffect(() => {
    socket.on("join-request", (data) => {
      playNotificationSound();
      handlemessage("New join request received!");
      console.log("Join request received:", data);

      setPendingRequests((prev) => {
        const exists = prev.some(
          (req) => req.userData.s_id === data.userData.s_id
        );

        if (exists) {
          // update userId for the existing entry
          return prev.map((req) =>
            req.userData.s_id === data.userData.s_id
              ? { ...req, userId: data.userId } // update only userId
              : req
          );
        }

        // if not exists, add new request
        return [...prev, data];
      });
    });


    return () => {
      socket.off("join-request");
    };
  }, []);


  const [isExpanded, setIsExpanded] = useState(false);
  const handleApprove = (userId, approve) => {
    socket.emit('approve-join', {
      userId,
      meetingId: roomId,
      approved: approve
    });
    setPendingRequests(prev => prev.filter(req => req.userId !== userId));
  };

  if (pendingRequests.length === 0) return null;


  return (
    <div className="fixed bottom-20 right-4 z-50 w-full max-w-xs sm:max-w-sm">
      {/* Main Panel */}
      <div className="bg-black text-white rounded-xl shadow-xl border border-gray-700 overflow-hidden mx-4 sm:mx-0">
        {/* Collapsible Header */}
        <div
          className="bg-gray-900 px-4 py-3 border-b border-gray-700 cursor-pointer hover:bg-gray-800 transition-all duration-200"
          onClick={() => setIsExpanded(!isExpanded)}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2.5">
              <div className="bg-blue-100 p-1.5 rounded-full">
                <Users className="w-4 h-4 text-blue-600" />
              </div>
              <div>
                <h3 className="font-semibold text-white text-sm">Join Requests</h3>
                <p className="text-xs text-gray-400">
                  {pendingRequests.length} {pendingRequests.length === 1 ? 'person' : 'people'} waiting
                </p>
              </div>
            </div>
            <div className="text-gray-400 transition-transform duration-200" style={{
              transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)'
            }}>
              <ChevronDown className="w-4 h-4" />
            </div>
          </div>
        </div>

        {/* Expandable Content */}
        <div className={`transition-all duration-300 ease-in-out ${isExpanded ? 'max-h-64 opacity-100' : 'max-h-0 opacity-0'
          } overflow-hidden`}>
          <div className="max-h-60 overflow-y-auto">
            {pendingRequests.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-6 px-4">
                <div className="bg-gray-800 p-3 rounded-full mb-3">
                  <UserPlus className="w-6 h-6 text-gray-400" />
                </div>
                <p className="text-gray-300 text-center font-medium text-sm">No pending requests</p>
                <p className="text-gray-500 text-xs text-center mt-1">
                  People requesting to join will appear here
                </p>
              </div>
            ) : (
              <div className="p-3 space-y-2.5">
                {pendingRequests.map((request, index) => (
                  <div
                    key={request.userId}
                    className="group bg-gray-900 hover:bg-gray-800 rounded-lg p-3 transition-all duration-200 border border-gray-700 hover:border-gray-600"
                    style={{
                      animationDelay: `${index * 100}ms`,
                      animation: isExpanded ? 'fadeInUp 0.3s ease-out forwards' : 'none'
                    }}
                  >
                    <div className="flex items-center justify-between">
                      {/* User Info */}
                      <div className="flex items-center space-x-2.5 flex-1 min-w-0">
                        <div className="bg-black w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0">
                          <span className="text-white font-semibold text-xs">
                            {request.userData.name.split(' ').map(n => n[0]).join('').toUpperCase()}
                          </span>
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-white truncate text-sm">
                            {request.userData.name}
                          </p>
                        </div>
                      </div>

                      {/* Action Buttons */}
                      <div className="flex space-x-1.5 ml-2 flex-shrink-0">
                        <button
                          onClick={() => handleApprove(request.userId, false)}
                          className="group/btn cursor-pointer bg-gray-800 hover:bg-red-900/40 border border-gray-600 hover:border-red-500 text-red-400 p-1.5 rounded-full transition-all duration-200 hover:shadow-sm"
                          title="Deny request"
                        >
                          <X className="w-3.5 h-3.5 group-hover/btn:scale-110 transition-transform" />
                        </button>
                        <button
                          onClick={() => handleApprove(request.userId, true)}
                          className="group/btn cursor-pointer bg-green-500 hover:bg-green-600 text-white p-1.5 rounded-full transition-all duration-200 hover:shadow-sm"
                          title="Approve request"
                        >
                          <Check className="w-3.5 h-3.5 group-hover/btn:scale-110 transition-transform" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>


        </div>
      </div>
    </div>
  );
};

// Add custom CSS animation
const styles = `
@keyframes fadeInUp {
  from {
    opacity: 0;
    transform: translateY(20px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
`;

// Inject styles
if (typeof document !== 'undefined') {
  const styleSheet = document.createElement('style');
  styleSheet.textContent = styles;
  document.head.appendChild(styleSheet);
}

export default AdminApprovalPanel;