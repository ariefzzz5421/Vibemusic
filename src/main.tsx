import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './ui/App';
import LandingPage from './ui/LandingPage';
import SplashScreen from './ui/SplashScreen';
import './ui/styles.css';
import './ui/tokens.css';
import './ui/experience.css';

const isPlayer = window.location.pathname.replace(/\/$/, '') === '/player';
document.title = isPlayer ? 'Vibe Player — Your listening room' : 'Vibe Music — Your music. Your room.';
createRoot(document.getElementById('root')!).render(<React.StrictMode><><SplashScreen />{isPlayer ? <App /> : <LandingPage />}</></React.StrictMode>);
