import { useCallback, useEffect, useState } from 'react';
import VibeLogoMark from './VibeLogoMark';

const keyForHost = () => `vibe:splash:v1:${window.location.hostname}`;

export default function SplashScreen() {
  const [visible, setVisible] = useState(() => {
    try { return window.localStorage.getItem(keyForHost()) !== 'seen'; }
    catch { return false; }
  });
  const [leaving, setLeaving] = useState(false);

  const dismiss = useCallback(() => {
    if (leaving) return;
    try { window.localStorage.setItem(keyForHost(), 'seen'); } catch { /* Continue if storage is unavailable. */ }
    setLeaving(true);
    window.setTimeout(() => setVisible(false), 420);
  }, [leaving]);

  useEffect(() => {
    if (!visible) return;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const timer = window.setTimeout(dismiss, reduceMotion ? 450 : 1650);
    return () => window.clearTimeout(timer);
  }, [dismiss, visible]);

  if (!visible) return null;
  return <div className={`site-splash ${leaving ? 'is-leaving' : ''}`} role="status" aria-label="Opening Vibe Music">
    <div className="splash-core"><span className="splash-logo"><VibeLogoMark size={44}/></span><span className="splash-wordmark">vibe<span>.</span></span><span className="splash-caption">YOUR LISTENING ROOM</span><span className="splash-progress"><i/></span></div>
    <button className="splash-skip" onClick={dismiss}>Skip intro</button>
  </div>;
}
