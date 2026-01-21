import React from 'react';

function Notification({ message, type, onClose }) {
  const icons = {
    success: '✅',
    error: '❌',
    info: 'ℹ️',
    warning: '⚠️'
  };

  return (
    <div className={`notification ${type}`}>
      <span>{icons[type] || icons.info}</span>
      <span>{message}</span>
      <button className="notification-close" onClick={onClose}>
        ✕
      </button>
    </div>
  );
}

export default Notification;
