/**
 * Helper component for agent welcome text animation.
 * File: src/helpers/WelcomeMessage.jsx
 */
export const handleWelcomeAudio = ({ audio }, audioRef) => {
      try {
        const audioBlob = new Blob(
          [
            new Uint8Array(
              atob(audio)
                .split("")
                .map((char) => char.charCodeAt(0))
            ),
          ],
          { type: "audio/mpeg" }
        );
    
        if (audioBlob.size === 0) {
          console.error("Audio blob is empty. Check the base64 data.");
          return;
        }
        // Create an object URL for the audio blob
        const audioUrl = URL.createObjectURL(audioBlob);
        // Create a new Audio object and play
        const audioElement = new Audio(audioUrl);
        audioRef.current = audioElement; // Store the audio object in the ref
    
        // Play the audio
        audioElement
          .play()
          .then(() => {})
          .catch((error) => {
            console.error("Error playing audio:", error);
          });
    
        // Cleanup audio URL after playing
        audioElement.onended = () => {
          URL.revokeObjectURL(audioUrl); // Free up memory
        };
      } catch (error) {
        console.error("Error decoding or playing audio:", error);
      }
    };
    