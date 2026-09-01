/**
 * Live caption/transcript display during meetings.
 * File: src/components/meeting/MeetingTranscript.jsx
 */
const MeetingTranscript = ({ localTranscript, remoteTranscript }) => {
  return (
    <div className="fixed left-4 bottom-24 w-80 bg-black text-white rounded-lg shadow-lg p-4 max-h-[60vh] overflow-y-auto border border-gray-800">
      <h3 className="text-lg font-semibold mb-4 text-white">Live Transcript</h3>

      <div className="space-y-4">
        <div className="space-y-2">
          <h4 className="font-medium text-blue-400">You:</h4>
          {localTranscript.map((text, index) => (
            <p
              key={`local-${index}`}
              className="text-sm text-gray-200 bg-gray-900 p-2 rounded border border-gray-800"
            >
              {text}
            </p>
          ))}
        </div>

        {Object.entries(remoteTranscript).map(([userId, texts]) => (
          <div key={userId} className="space-y-2">
            <h4 className="font-medium text-green-400">
              Peer ${userId.slice(0, 4)}
            </h4>
            {texts.map((text, index) => (
              <p
                key={`remote-${userId}-${index}`}
                className="text-sm text-gray-200 bg-gray-900 p-2 rounded border border-gray-800"
              >
                {text}
              </p>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
};

export default MeetingTranscript;
