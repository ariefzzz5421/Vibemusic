import { useRef, useState } from 'react';
import { ArrowDown, ArrowRight, AudioLines, Disc3, Pause, Play, SkipBack, SkipForward } from 'lucide-react';
import { appUrl } from '../lib/navigation';
import catalog from '../data/catalog.json';
import type { Track } from '../lib/types';
import VibeLogoMark from './VibeLogoMark';



export default function LandingPage() {
  const [tracks] = useState<Track[]>(catalog as Track[]);
  const [current, setCurrent] = useState<Track | null>(() => (catalog as Track[])[0] ?? null);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const audio = useRef<HTMLAudioElement>(null);



  const playTrack = (track: Track) => {
    setCurrent(track);
    setPlaying(true);
    const player = audio.current;
    if (!player) return;
    if (player.src !== new URL(track.audio_url, window.location.href).href) player.src = track.audio_url;
    void player.play().catch(() => setPlaying(false));
  };

  const togglePreview = () => {
    const player = audio.current;
    if (!player) return;
    if (playing) player.pause();
    else if (current) playTrack(current);
    else if (tracks[0]) playTrack(tracks[0]);
  };

  const skip = (delta: number) => {
    if (!tracks.length) return;
    const index = tracks.findIndex(track => track.id === current?.id);
    playTrack(tracks[(index + delta + tracks.length) % tracks.length]);
  };

  return <main className="landing-page">
    <header className="landing-nav">
      <a className="landing-brand" href="#top" aria-label="Vibe Music home"><span className="landing-brand-mark"><VibeLogoMark size={24}/></span><span>vibe<span>.</span></span></a>
      <nav aria-label="Main navigation"><a href="#the-room">The idea</a><a href="#your-music">Your music</a></nav>
      <a className="landing-nav-cta" href={appUrl()}>Open your player <ArrowRight size={15}/></a>
    </header>

    <section className="landing-hero" id="top">
      <div className="landing-hero-meta"><span><i/> PERSONAL MUSIC PLAYER</span><span>VOL. 01&nbsp; / &nbsp;STATIC EDITION</span></div>
      <div className="landing-title-wrap"><p className="landing-side-note">For the songs that stayed with you.</p><h1>Your music.<br/><span>Your room.</span></h1></div>
      <div className="turntable-art" aria-hidden="true">
        <div className="turntable-shadow"/><div className="turntable-body"><div className="record"><i className="record-label"><AudioLines size={31}/></i><i className="record-center"/></div><div className="tonearm"><i/><b/></div><div className="turntable-knob"/><div className="turntable-mark">V&nbsp; / &nbsp;01</div></div>
      </div>
      <div className="landing-hero-bottom"><p>A quieter place for the music you already love. Committed to the catalog, ready when you are.</p><a href="#the-room" className="scroll-cue"><span>TAKE A LOOK</span><ArrowDown size={15}/></a></div>
      <span className="hero-index" aria-hidden="true">01 — 03</span>
    </section>

    <section className="landing-intro" id="the-room"><div className="intro-caption"><span>THE IDEA</span><span>01 / A PERSONAL LIBRARY</span></div><div className="intro-copy"><h2>Not another feed.<br/><span>A place to listen.</span></h2><p>Vibe brings the music already on your computer into one calm, considered player. Your player loads a checked-in music catalog. Playlists are saved in this browser only.</p><a className="text-link" href={appUrl()}>Step inside <ArrowRight size={16}/></a></div><div className="intro-mark" aria-hidden="true"><Disc3 size={104} strokeWidth={0.8}/><span>PLAY<br/>WHAT<br/>MATTERS</span></div></section>

    <section className="landing-listen" id="your-music"><div className="listen-heading"><span>02 / A FIRST LISTEN</span><h2>Your collection,<br/>in its own rhythm.</h2><p>Make a playlist from your files, pick a track, and let the next one follow.</p></div><div className="preview-player"><div className="preview-player-top"><span><i/> FROM YOUR MUSIC FOLDER</span><span>{String(Math.max(tracks.length, 0)).padStart(2, '0')} TRACKS</span></div><div className="preview-track"><div className="preview-cover"><AudioLines size={23}/></div><div className="preview-track-copy"><small>NOW PLAYING</small><b>{current?.title || 'Your next favorite'}</b><span>{current?.artist || 'Add a few songs to get started'}</span></div><button className="preview-control" onClick={togglePreview} aria-label={playing ? 'Pause preview' : 'Play preview'} disabled={!tracks.length}>{playing?<Pause size={17} fill="currentColor"/>:<Play size={17} fill="currentColor"/>}</button></div><div className="preview-progress"><i style={{ width: `${position}%` }}/></div><div className="preview-player-bottom"><span>{playing?'PLAYING':'READY WHEN YOU ARE'}</span><div><button aria-label="Previous track" onClick={()=>skip(-1)} disabled={!tracks.length}><SkipBack size={15}/></button><button aria-label="Next track" onClick={()=>skip(1)} disabled={!tracks.length}><SkipForward size={15}/></button></div></div></div></section>

    <section className="landing-final"><p>03 / YOUR LISTENING ROOM</p><h2>Come back to<br/>what you love.</h2><a href={appUrl()} className="final-cta">Open Vibe <ArrowRight size={17}/></a><span className="final-notation" aria-hidden="true">SIDE A<br/>READY</span></section>

    <footer className="landing-footer"><a className="landing-brand" href="#top"><span className="landing-brand-mark"><VibeLogoMark size={22}/></span><span>vibe<span>.</span></span></a><span>Made for your own listening.</span><a href={appUrl()}>Your player <ArrowRight size={14}/></a></footer>
    <audio ref={audio} preload="none" onTimeUpdate={event=>{ const el=event.currentTarget; setPosition(el.duration ? el.currentTime / el.duration * 100 : 0); }} onPlay={()=>setPlaying(true)} onPause={()=>setPlaying(false)} onEnded={()=>skip(1)}/>
  </main>;
}
