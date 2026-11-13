import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './ui/App';
import LandingPage from './ui/LandingPage';
import SplashScreen from './ui/SplashScreen';
import './ui/styles.css';
import './ui/tokens.css';
import './ui/experience.css';

const isAppHost = window.location.hostname.startsWith('app.');
document.title = isAppHost ? 'Vibe Player — Your listening room' : 'Vibe Music — Your music. Your room.';
createRoot(document.getElementById('root')!).render(<React.StrictMode><><SplashScreen />{isAppHost ? <App /> : <LandingPage />}</></React.StrictMode>);
