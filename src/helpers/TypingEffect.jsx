/**
 * Animated typewriter effect for agent messages.
 * File: src/helpers/TypingEffect.jsx
 */
import React, { useState, useEffect } from 'react';

const TypingEffect = ({ 
  text = '', 
  speed = 30, 
  onComplete = () => {},
  startTyping = false,
  className = ''
}) => {
  const [displayedText, setDisplayedText] = useState('');
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isTyping, setIsTyping] = useState(false);

  useEffect(() => {
    // Reset when new text comes in
    if (text && startTyping) {
      setDisplayedText('');
      setCurrentIndex(0);
      setIsTyping(true);
    }
  }, [text, startTyping]);

  useEffect(() => {
    if (!isTyping || !text) return;

    if (currentIndex < text.length) {
      const timer = setTimeout(() => {
        setDisplayedText(text.slice(0, currentIndex + 1));
        setCurrentIndex(currentIndex + 1);
      }, speed);

      return () => clearTimeout(timer);
    } else {
      // Typing completed
      setIsTyping(false);
      onComplete();
    }
  }, [currentIndex, text, speed, isTyping, onComplete]);

  return (
    <div className={className}>
      {displayedText}
      {isTyping && (
        <span className="animate-pulse ml-1 text-gray-400">|</span>
      )}
    </div>
  );
};

export default TypingEffect;