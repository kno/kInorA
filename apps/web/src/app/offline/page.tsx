import React from 'react';

export default function OfflinePage() {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100vh',
      backgroundColor: '#09090c',
      color: '#ffffff',
      fontFamily: 'sans-serif',
      textAlign: 'center',
      padding: '20px'
    }}>
      <h1 style={{ fontSize: '3rem', marginBottom: '1rem' }}>You're Offline</h1>
      <p style={{ fontSize: '1.2rem', marginBottom: '2rem', maxWidth: '400px' }}>
        It looks like you're currently disconnected from the internet. Please check your connection and try again.
      </p>
      <div style={{ border: '1px solid #ffffff', padding: '20px', borderRadius: '18px' }}>
        <p>Your data will be synced once you're back online.</p>
      </div>
    </div>
  );
}