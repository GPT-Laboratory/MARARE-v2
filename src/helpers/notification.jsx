/**
 * Plays sound and shows snackbar for meeting events.
 * File: src/helpers/notification.jsx
 */
import React from 'react';
import notifi from "./notification.mp3"; // Import the audio file

export const playNotificationSound = () => {
  try {
    console.log("Attempting to play notification sound");
    const audio = new Audio(notifi); // Use the imported audio file directly
    audio.volume = 0.5; // Adjust volume (0.1 to 1.0)
    audio.play(); // Play the sound
    // Handle autoplay restrictions
    const playPromise = audio.play();
    
    if (playPromise !== undefined) {
      playPromise
        .then(() => console.log("Notification sound played successfully"))
        .catch(error => console.error("Audio play failed:", error));
    }
  } catch (error) {
    console.error("Error initializing audio:", error);
  }
};