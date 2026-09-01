/**
 * Catches React render errors in meeting subtree.
 * File: src/components/meeting/ErrorBoundary.jsx
 */
import React from 'react';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    console.error('Error caught by boundary:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="p-4 bg-red-100 text-red-700 rounded-md">
          <h2>Something went wrong.</h2>
          <button
            onClick={() => this.setState({ hasError: false })}
            className="mt-2 bg-red-500 text-white px-4 py-2 rounded"
          >
            Try again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
