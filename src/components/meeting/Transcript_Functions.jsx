/**
 * Shared transcript formatting and socket handlers.
 * File: src/components/meeting/Transcript_Functions.jsx
 */
\n
// import {handleRecognition} from '../../components/meeting/VideoPlayer.jsx'

import axios from "axios";
import { APP_URLS } from '../../config/baseUrls.js';





const azureConfig = {
  key: import.meta.env.VITE_KEY,
  region: import.meta.env.VITE_REGION,
};


let isProcessing = false;
let processingTimeout = null;

let currentRecognizer = null;


const cleanupRecognizer = () => {
  return new Promise((resolve, reject) => {
    if (currentRecognizer) {
      try {
        // First check if the recognizer is actively running
        if (currentRecognizer.recognizing) {
          currentRecognizer.stopContinuousRecognitionAsync(
            () => {
              try {
                currentRecognizer.close();
                currentRecognizer = null;
                console.log("Previous recognition session cleaned up");
                resolve();
              } catch (closeError) {
                console.warn("Error while closing recognizer:", closeError);
                currentRecognizer = null;
                resolve();
              }
            },
            (err) => {
              console.error("Error stopping previous recognition:", err);
              // Still try to clean up even if stopping fails
              try {
                currentRecognizer.close();
              } catch (closeError) {
                console.warn(
                  "Error while closing recognizer after stop failure:",
                  closeError
                );
              }
              currentRecognizer = null;
              resolve(); // Resolve anyway to continue with new recognition
            }
          );
        } else {
          // If not actively recognizing, just close and cleanup
          try {
            currentRecognizer.close();
          } catch (closeError) {
            console.warn(
              "Error while closing inactive recognizer:",
              closeError
            );
          }
          currentRecognizer = null;
          resolve();
        }
      } catch (error) {
        console.warn("Error during cleanup:", error);
        currentRecognizer = null;
        resolve(); // Resolve anyway to allow new recognition to start
      }
    } else {
      resolve();
    }
  });
};

export const startAzureSTT = async (audioStream, type, recognizers) => {
  try {
    console.log("Initializing Azure Speech-to-Text...");

    // First, cleanup any existing recognizer
    await cleanupRecognizer();

    // Create audio configuration from the stream
    const audioConfig =
      window.SpeechSDK.AudioConfig.fromStreamInput(audioStream);

    // Ensure that Azure Speech SDK key and region are available
    const speechConfig = window.SpeechSDK.SpeechConfig.fromSubscription(
      azureConfig.key,
      azureConfig.region
    );

    speechConfig.speechRecognitionLanguage = "en-US";

    // Check if speechConfig is valid
    if (!speechConfig) {
      throw new Error("Invalid Azure Speech Configuration");
    }

    // Create new recognizer
    currentRecognizer = new window.SpeechSDK.SpeechRecognizer(
      speechConfig,
      audioConfig
    );

//     recognizers.current[type] = currentRecognizer;

    // Start recognition
    await new Promise((resolve, reject) => {
      currentRecognizer.startContinuousRecognitionAsync(
        () => {
          console.log("Continuous Recognition Started for", type);
          resolve();
        },
        (err) => {
          console.error(`Error starting recognition for ${type}:`, err);
          reject(err);
        }
      );
    });

    // Set up recognition event handler
    currentRecognizer.recognized = (s, e) => {
      if (e.result.text) {
        console.log(`Recognized (${type}):`, e.result.text);
        // console.log(jointPeers);

        // Check if type matches userId in jointPeers
        const isMatchingType = jointPeers.current.some(
          (peer) => peer.userId === `agent-${type}`
        );

        const includesAgent001 = e.result.text.toLowerCase().includes("agent");

        if (includesAgent001) {
          handleRecognition(
            e.result.text,
            currentRecognizer,
            audioStream,
            type
          );
          console.log("working this time");
        }

        // handleRecognition(e.result.text, currentRecognizer, audioStream, type);
      }
    };
  } catch (error) {
    console.error("Error while starting Azure STT:", error);
    // Cleanup on error
    await cleanupRecognizer();
  }
};

const stopAzureSTT = (recognizer) => {
  if (recognizer) {
    recognizer.stopContinuousRecognitionAsync(
      () => console.log("Recognition stopped"),
      (err) => console.error("Error stopping recognition:", err)
    );
  }
};



const convertTextToSpeech = async (text, audioStream, type) => {
      try {
        console.log("Starting Text-to-Speech Conversion for:", text);
    
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const mediaStreamDestination = audioContext.createMediaStreamDestination();
    
        const response = await fetch(
          APP_URLS.elevenlabs.textToSpeech(import.meta.env.VITE_ELEVENLABS_VOICE_ID),
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "xi-api-key": import.meta.env.VITE_ELEVENLABS_API_KEY,
            },
            body: JSON.stringify({
              text,
              model_id: "eleven_multilingual_v2",
              voice_settings: {
                stability: 0.5,
                similarity_boost: 0.5,
              },
            }),
          }
        );
    
        if (!response.ok) {
          throw new Error("Failed to convert text to speech with ElevenLabs");
        }
    
        const audioBlob = await response.blob();
        const audioUrl = URL.createObjectURL(audioBlob);
        const audioElement = new Audio(audioUrl);
        audioElement.crossOrigin = "anonymous";
    
        await new Promise((resolve) => {
          audioElement.onloadedmetadata = resolve;
        });
    
        const source = audioContext.createMediaElementSource(audioElement);
        const gainNode = audioContext.createGain();
        gainNode.gain.value = 1.0;
    
        source.connect(gainNode);
        gainNode.connect(mediaStreamDestination);
        gainNode.connect(audioContext.destination);
    
        const broadcastAudioToPeers = async () => {
          for (const peer of jointPeers.current || []) {
            if (!peer?.pc) {
              console.warn(`Invalid peer: ${peer?.userId || "unknown"}`);
              continue;
            }
    
            try {
              const audioTrack = mediaStreamDestination.stream.getAudioTracks()[0].clone();
    
              // Check if an audio sender already exists
              const existingAudioSender = peer.pc.getSenders().find((s) => s.track?.kind === "audio");
    
              if (existingAudioSender) {
                console.log(`Replacing audio track for peer: ${peer.userId}`);
                await existingAudioSender.replaceTrack(audioTrack);
              } else {
                console.log(`Adding new audio track for peer: ${peer.userId}`);
                peer.pc.addTrack(audioTrack, mediaStreamDestination.stream);
              }
            } catch (error) {
              console.error(`Error broadcasting to peer ${peer.userId}:`, error);
            }
          }
        };
    
        await broadcastAudioToPeers();
        await audioElement.play();
    
        console.log("Audio playback started locally and broadcasting to peers");
    
        return new Promise((resolve, reject) => {
          audioElement.onended = async () => {
            console.log("Audio playback ended. Cleaning up resources...");
    
            setTimeout(async () => {
              try {
                for (const peer of jointPeers.current || []) {
                  const audioTrack = mediaStreamDestination.stream.getAudioTracks()[0];
                  const sender = peer.pc.getSenders().find((s) => s.track === audioTrack);
    
                  if (sender) {
                    peer.pc.removeTrack(sender);
                  }
                }
    
                URL.revokeObjectURL(audioUrl);
                await audioContext.close();
    
                if (processingTimeout) {
                  clearTimeout(processingTimeout);
                }
    
                processingTimeout = setTimeout(() => {
                  console.log("Starting Azure STT after delay...");
                  isProcessing = false;
                  startAzureSTT(audioStream, type);
                }, 200);
    
                resolve();
              } catch (cleanupError) {
                console.error("Error during cleanup:", cleanupError);
                reject(cleanupError);
              }
            }, 1000);
          };
    
          audioElement.onerror = (error) => {
            console.error("Error playing audio:", error);
            reject(error);
          };
        });
      } catch (error) {
        console.error("Error in convertTextToSpeech:", error);
        throw error;
      }
    };
  

  
    // Add this function to handle the recognition event
    const handleRecognition = (text, recognizer, audioStream, type) => {
      // If already processing, return early
      if (isProcessing) {
        console.log("Already processing a request, skipping...");
        return;
      }
  
      // Clear any existing timeout
      if (processingTimeout) {
        clearTimeout(processingTimeout);
      }
  
      // Set a new timeout to process the recognition
      processingTimeout = setTimeout(async () => {
        const response = await sendToOpenAI(text, recognizer);
        if (response) {
          convertTextToSpeech(response, audioStream, type);
        }
      }, 100); // Wait 0.1 second before processing to avoid multiple calls
    };

    const sendToOpenAI = async (text, recognizer) => {
      // If already processing, return early
      if (isProcessing) {
        console.log("Already processing a request, skipping...");
        return;
      }
  
      isProcessing = true;
      stopAzureSTT(recognizer);
  
      try {
        const response = await axios.post(
          APP_URLS.openai.chatCompletions,
          {
            model: "gpt-5.4-2026-03-05",
            messages: [
              { role: "system", content: "You are an assistant." },
              { role: "user", content: text },
            ],
            max_tokens: 50,
          },
          {
            headers: {
              Authorization: `Bearer ${import.meta.env.VITE_OPENAI_API_KEY}`,
              "Content-Type": "application/json",
            },
          }
        );
  
        console.log(
          "openai generated response : ",
          response.data.choices[0].message.content
        );
        return response.data.choices[0].message.content;
      } catch (error) {
        console.error("Error sending text to OpenAI:", error);
        throw error;
      } finally {
        // Reset the processing flag after a delay
        setTimeout(() => {
          isProcessing = false;
        }, 5000); // 5 second cooldown
      }
    };


   