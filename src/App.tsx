/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { GoogleGenAI, Modality } from "@google/genai";
import { 
  Mic, 
  MicOff, 
  Send, 
  User, 
  Bot, 
  Languages,
  Volume2,
  VolumeX,
  History,
  TrendingUp,
  LogOut,
  AlertCircle,
  MessageSquare,
  BarChart3,
  Settings,
  ChevronRight,
  Sparkles,
  X
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  signInWithPopup, 
  GoogleAuthProvider, 
  onAuthStateChanged, 
  User as FirebaseUser,
  signOut,
  signInWithRedirect,
  getRedirectResult        
} from 'firebase/auth';
import { 
  collection, 
  doc, 
  setDoc, 
  addDoc, 
  query, 
  orderBy, 
  onSnapshot, 
  getDoc,
  serverTimestamp
} from 'firebase/firestore';
import { auth, db } from './firebase';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import ReactMarkdown from 'react-markdown';

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// Utility for tailwind classes
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const SYSTEM_PROMPT = `You are "LingoCoach," an empathetic and expert AI English Speaking Tutor. Your goal is to help the user improve their English fluency, pronunciation, and confidence through natural conversation.

Guidelines:
1. Adaptability: Assess the user's level in the first 2-3 exchanges and adjust your vocabulary and sentence complexity accordingly.
2. Correction Strategy: Do not interrupt the flow. Respond to the user's content first, then provide a "Correction & Improvement" section at the end of your message for 1-2 grammatical errors.
3. Engagement: Always end your turn with an open-ended question to keep the conversation moving.
4. Multilingual Support: If the user is stuck, they may use their native language (Tamil). Translate it for them and encourage them to repeat the phrase in English.
5. Feedback Loop: Periodically suggest "Better ways to say this" to move them from Basic to Intermediate English.

Output Format:
[Response to user]
---
**💡 Fluency Tip:** [Correction or more natural phrasing]`;

interface Message {
  id: string;
  role: 'user' | 'model';
  text: string;
  timestamp: any;
  correction?: string;
}

interface UserProfile {
  uid: string;
  displayName: string;
  level: 'Beginner' | 'Intermediate' | 'Advanced';
  commonMistakes: string[];
  progress: number;
}

export default function App() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isAudioEnabled, setIsAudioEnabled] = useState(true);
  const [activeTab, setActiveTab] = useState<'chat' | 'progress' | 'profile'>('chat');
  const [isVoiceMode, setIsVoiceMode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const scrollRef = useRef<HTMLDivElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);
//from the cld
useEffect(() => {
  getRedirectResult(auth)
    .then((result) => {
      if (result?.user) {
        // do nothing — auth state listener in App.tsx
        // will automatically detect the user and redirect
        console.log('Login success:', result.user.displayName)
      }
    })
    .catch((err) => console.error(err))
}, [])
//Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
      if (firebaseUser) {
        // Fetch or create profile
        const profileRef = doc(db, 'users', firebaseUser.uid);
        try {
          const profileSnap = await getDoc(profileRef);
          
          if (profileSnap.exists()) {
            setProfile(profileSnap.data() as UserProfile);
          } else {
            const newProfile: UserProfile = {
              uid: firebaseUser.uid,
              displayName: firebaseUser.displayName || 'Learner',
              level: 'Beginner',
              commonMistakes: [],
              progress: 0
            };
            await setDoc(profileRef, newProfile);
            setProfile(newProfile);
          }
        } catch (err) {
          handleFirestoreError(err, OperationType.GET, `users/${firebaseUser.uid}`);
        }

        // Subscribe to messages
        const q = query(
          collection(db, 'users', firebaseUser.uid, 'messages'),
          orderBy('timestamp', 'asc')
        );
        const unsubMessages = onSnapshot(q, (snapshot) => {
          const msgs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Message));
          setMessages(msgs);
        }, (err) => {
          handleFirestoreError(err, OperationType.LIST, `users/${firebaseUser.uid}/messages`);
        });
        return () => unsubMessages();
      }
    });
    return () => unsubscribe();
  }, []);


  //fake user cred 

//   useEffect(() => {
//   // Fake user — bypasses Firebase auth entirely
//   const fakeUser = {
//     uid: 'local-user',
//     displayName: 'Learner',
//     email: 'user@app.com',
//     photoURL: null,
//   }

//   // Fake profile — matches your UserProfile type exactly
//   const fakeProfile: UserProfile = {
//     uid: 'local-user',
//     displayName: 'Learner',
//     level: 'Beginner',
//     commonMistakes: [],
//     progress: 0,
//   }

//   setUser(fakeUser as any)
//   setProfile(fakeProfile)
//   setMessages([])   // start with empty messages, or add fake ones below
// }, [])


  // Scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

    const handleLogin = async () => {
 try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (err) {
      setError('Failed to sign in. Please try again.');
    }
    
  };

  const handleLogout = () => signOut(auth);

  const sendMessage = async (text: string, audioData?: string) => {
    if (!user || (!text.trim() && !audioData)) return;

    setIsProcessing(true);
    setError(null);

    const userMessage = {
      userId: user.uid,
      role: 'user' as const,
      text: text,
      timestamp: serverTimestamp()
    };

    try {
      // Save user message
      try {
        await addDoc(collection(db, 'users', user.uid, 'messages'), userMessage);
      } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, `users/${user.uid}/messages`);
      }
      setInputText('');

      // Call Gemini
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
      
      // Add history for context (last 10 messages)
      const history = messages.slice(-10).map(m => ({
        role: m.role,
        parts: [{ text: m.text }]
      }));
      
      const parts: any[] = [{ text: text }];
      if (audioData) {
        parts.push({
          inlineData: {
            mimeType: 'audio/webm',
            data: audioData
          }
        });
      }

      // Step 1: Generate Text Response with the more robust Gemini 3 model
      const textResponse = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [
          ...history,
          { role: 'user', parts }
        ],
        config: {
          systemInstruction: SYSTEM_PROMPT,
        }
      });

      const aiText = textResponse.text || '';

      // Step 2: Generate Audio separately if enabled
      let aiAudio;
      if (isAudioEnabled && aiText) {
        try {
          const audioResponse = await ai.models.generateContent({
            model: "gemini-2.5-flash-preview-tts",
            contents: [{ parts: [{ text: aiText }] }],
            config: {
              responseModalities: [Modality.AUDIO],
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: { voiceName: 'Kore' }
                }
              }
            }
          });
          aiAudio = audioResponse.candidates?.[0]?.content?.parts?.find(p => p.inlineData)?.inlineData?.data;
        } catch (audioErr) {
          console.error("TTS Generation Error:", audioErr);
          // We continue even if audio fails, as the text response is still valuable
        }
      }

      // Save AI message
      try {
        await addDoc(collection(db, 'users', user.uid, 'messages'), {
          userId: user.uid,
          role: 'model',
          text: aiText,
          timestamp: serverTimestamp()
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, `users/${user.uid}/messages`);
      }

      // Play audio if available
      if (aiAudio && isAudioEnabled) {
        try {
          const binaryString = atob(aiAudio);
          const len = binaryString.length;
          const bytes = new Uint8Array(len);
          for (let i = 0; i < len; i++) {
            bytes[i] = binaryString.charCodeAt(i);
          }
          
          const int16Data = new Int16Array(bytes.buffer);
          const float32Data = new Float32Array(int16Data.length);
          for (let i = 0; i < int16Data.length; i++) {
            float32Data[i] = int16Data[i] / 32768.0;
          }
          
          const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
          const buffer = audioCtx.createBuffer(1, float32Data.length, 24000);
          buffer.copyToChannel(float32Data, 0);
          
          const source = audioCtx.createBufferSource();
          source.buffer = buffer;
          source.connect(audioCtx.destination);
          source.start();
        } catch (err) {
          console.error("PCM Playback Error:", err);
        }
      }

      // Update progress/mistakes periodically (simplified logic)
      if (aiText.includes('💡 Fluency Tip:')) {
        const tip = aiText.split('💡 Fluency Tip:')[1].trim();
        if (profile) {
          const updatedMistakes = Array.from(new Set([...profile.commonMistakes, tip])).slice(-5);
          try {
            await setDoc(doc(db, 'users', user.uid), {
              ...profile,
              commonMistakes: updatedMistakes,
              progress: Math.min(100, profile.progress + 1)
            });
          } catch (err) {
            handleFirestoreError(err, OperationType.UPDATE, `users/${user.uid}`);
          }
        }
      }

    } catch (err) {
      console.error(err);
      setError('Something went wrong. Please try again.');
    } finally {
      setIsProcessing(false);
    }
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const reader = new FileReader();
        reader.readAsDataURL(audioBlob);
        reader.onloadend = () => {
          const base64data = (reader.result as string).split(',')[1];
          sendMessage("Voice message", base64data);
        };
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
    } catch (err) {
      setError('Microphone access denied.');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  if (!user) {
    return (
      <div className="fixed inset-0 bg-[#FDFCFB] flex flex-col items-center justify-center p-6 font-sans overflow-hidden">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-md w-full text-center space-y-8"
        >
          <div className="relative inline-block">
            <motion.div 
              animate={{ scale: [1, 1.05, 1] }}
              transition={{ duration: 4, repeat: Infinity }}
              className="w-24 h-24 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4"
            >
              <Languages className="w-12 h-12 text-emerald-600" />
            </motion.div>
            <div className="absolute -bottom-2 -right-2 bg-white p-2 rounded-xl shadow-sm border border-emerald-50">
              <Mic className="w-5 h-5 text-emerald-500" />
            </div>
          </div>
          
          <div className="space-y-2">
            <h1 className="text-4xl font-bold tracking-tight text-stone-900">LingoCoach verions 1 </h1>
            <p className="text-stone-500 text-lg">Your empathetic AI English Speaking Tutor.</p>
          </div>

          <div className="bg-white p-8 rounded-3xl shadow-sm border border-stone-100 space-y-6">
            <div className="space-y-4 text-left">
              <div className="flex items-start gap-3">
                <div className="w-6 h-6 rounded-full bg-emerald-50 flex items-center justify-center mt-1">
                  <div className="w-2 h-2 rounded-full bg-emerald-500" />
                </div>
                <p className="text-stone-600 text-sm">Natural voice conversations with real-time feedback.</p>
              </div>
              <div className="flex items-start gap-3">
                <div className="w-6 h-6 rounded-full bg-emerald-50 flex items-center justify-center mt-1">
                  <div className="w-2 h-2 rounded-full bg-emerald-500" />
                </div>
                <p className="text-stone-600 text-sm">Personalized learning path based on your level.</p>
              </div>
              <div className="flex items-start gap-3">
                <div className="w-6 h-6 rounded-full bg-emerald-50 flex items-center justify-center mt-1">
                  <div className="w-2 h-2 rounded-full bg-emerald-500" />
                </div>
                <p className="text-stone-600 text-sm">Translation bridge for Tamil speakers.</p>
              </div>
            </div>

            <button 
              onClick={handleLogin}
              className="w-full bg-stone-900 text-white py-4 rounded-2xl font-medium hover:bg-stone-800 active:scale-95 transition-all flex items-center justify-center gap-3"
            >
              <User className="w-5 h-5" />
              Get Started with Google
            </button>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-[#FDFCFB] flex flex-col font-sans overflow-hidden select-none">
      {/* Header */}
      <header className="px-6 py-4 border-b border-stone-100 bg-white/80 backdrop-blur-md z-10 flex items-center justify-between safe-top">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-emerald-500 rounded-xl flex items-center justify-center text-white shadow-lg shadow-emerald-100">
            <Bot className="w-6 h-6" />
          </div>
          <div>
            <h2 className="font-bold text-stone-900 text-sm leading-tight">LingoCoach</h2>
            <div className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-[9px] uppercase tracking-wider font-bold text-stone-400">Online</span>
            </div>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          <button 
            onClick={() => setIsAudioEnabled(!isAudioEnabled)}
            className={cn(
              "p-2.5 rounded-xl transition-colors active:scale-90",
              isAudioEnabled ? "bg-emerald-50 text-emerald-600" : "bg-stone-100 text-stone-400"
            )}
          >
            {isAudioEnabled ? <Volume2 className="w-5 h-5" /> : <VolumeX className="w-5 h-5" />}
          </button>
          <div className="w-10 h-10 rounded-full bg-stone-100 flex items-center justify-center overflow-hidden border border-stone-200">
            {user.photoURL ? (
              <img src={user.photoURL} alt="Profile" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
            ) : (
              <User className="w-5 h-5 text-stone-400" />
            )}
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 overflow-hidden relative">
        <AnimatePresence mode="wait">
          {activeTab === 'chat' && (
            <motion.div 
              key="chat"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              className="h-full flex flex-col"
            >
              {/* Messages Area */}
              <div 
                ref={scrollRef}
                className="flex-1 overflow-y-auto px-6 py-4 space-y-6 scroll-smooth pb-32"
              >
                {messages.length === 0 && (
                  <div className="text-center py-20 space-y-4">
                    <div className="w-20 h-20 bg-stone-50 rounded-full flex items-center justify-center mx-auto">
                      <Sparkles className="w-10 h-10 text-emerald-200" />
                    </div>
                    <div className="space-y-1">
                      <p className="text-stone-900 font-bold">Welcome to LingoCoach!</p>
                      <p className="text-stone-400 text-xs px-12 leading-relaxed">Try saying "Hello" or tap the mic to start a voice lesson.</p>
                    </div>
                  </div>
                )}

                {messages.map((msg) => (
                  <motion.div 
                    initial={{ opacity: 0, y: 10, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    key={msg.id} 
                    className={cn(
                      "flex flex-col max-w-[85%]",
                      msg.role === 'user' ? "ml-auto items-end" : "items-start"
                    )}
                  >
                    <div className={cn(
                      "px-4 py-3 rounded-2xl text-sm leading-relaxed shadow-sm",
                      msg.role === 'user' 
                        ? "bg-stone-900 text-white rounded-tr-none" 
                        : "bg-white border border-stone-100 text-stone-800 rounded-tl-none"
                    )}>
                      <div className="prose prose-sm prose-stone max-w-none">
                        <ReactMarkdown>
                          {msg.text}
                        </ReactMarkdown>
                      </div>
                    </div>
                    <span className="text-[9px] text-stone-400 mt-1.5 font-bold px-1 uppercase tracking-tighter">
                      {msg.timestamp?.toDate ? msg.timestamp.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Just now'}
                    </span>
                  </motion.div>
                ))}

                {isProcessing && (
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 bg-emerald-50 rounded-lg flex items-center justify-center">
                      <Bot className="w-5 h-5 text-emerald-500 animate-pulse" />
                    </div>
                    <div className="bg-white border border-stone-100 px-4 py-3 rounded-2xl rounded-tl-none shadow-sm">
                      <div className="flex gap-1">
                        <motion.div animate={{ y: [0, -4, 0] }} transition={{ repeat: Infinity, duration: 0.6 }} className="w-1.5 h-1.5 bg-stone-300 rounded-full" />
                        <motion.div animate={{ y: [0, -4, 0] }} transition={{ repeat: Infinity, duration: 0.6, delay: 0.2 }} className="w-1.5 h-1.5 bg-stone-300 rounded-full" />
                        <motion.div animate={{ y: [0, -4, 0] }} transition={{ repeat: Infinity, duration: 0.6, delay: 0.4 }} className="w-1.5 h-1.5 bg-stone-300 rounded-full" />
                      </div>
                    </div>
                  </div>
                )}

                {error && (
                  <div className="flex items-center gap-2 text-red-500 bg-red-50 px-4 py-2 rounded-xl text-[10px] font-bold mx-auto w-fit uppercase tracking-wider">
                    <AlertCircle className="w-3.5 h-3.5" />
                    {error}
                  </div>
                )}
              </div>

              {/* Input Area (Floating) */}
              <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-[#FDFCFB] via-[#FDFCFB] to-transparent pb-8">
                <div className="bg-white rounded-3xl shadow-xl shadow-stone-200/50 border border-stone-100 p-2 flex items-center gap-2">
                  <button 
                    onClick={() => setIsVoiceMode(true)}
                    className="w-12 h-12 bg-emerald-50 text-emerald-600 rounded-2xl flex items-center justify-center active:scale-90 transition-transform"
                  >
                    <Mic className="w-6 h-6" />
                  </button>
                  <input
                    type="text"
                    value={inputText}
                    onChange={(e) => setInputText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') sendMessage(inputText);
                    }}
                    placeholder="Type a message..."
                    className="flex-1 bg-transparent border-none focus:ring-0 text-sm px-2"
                  />
                  <button
                    onClick={() => sendMessage(inputText)}
                    disabled={!inputText.trim() || isProcessing}
                    className="w-12 h-12 bg-stone-900 text-white rounded-2xl flex items-center justify-center active:scale-90 transition-transform disabled:opacity-30"
                  >
                    <Send className="w-5 h-5" />
                  </button>
                </div>
              </div>
            </motion.div>
          )}

          {activeTab === 'progress' && (
            <motion.div 
              key="progress"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="h-full overflow-y-auto px-6 py-8 space-y-8 pb-24"
            >
              <div className="space-y-2">
                <h3 className="text-2xl font-bold text-stone-900">Your Progress</h3>
                <p className="text-stone-500 text-sm">Keep going! You're doing great.</p>
              </div>

              <div className="bg-white p-6 rounded-3xl border border-stone-100 shadow-sm space-y-6">
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <p className="text-[10px] font-bold text-stone-400 uppercase tracking-widest">Current Level</p>
                    <p className="text-xl font-bold text-stone-900">{profile?.level || 'Beginner'}</p>
                  </div>
                  <div className="w-12 h-12 bg-emerald-100 rounded-2xl flex items-center justify-center">
                    <TrendingUp className="w-6 h-6 text-emerald-600" />
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex justify-between text-xs font-bold text-stone-500">
                    <span>Fluency Score</span>
                    <span>{profile?.progress || 0}%</span>
                  </div>
                  <div className="h-3 bg-stone-100 rounded-full overflow-hidden">
                    <motion.div 
                      initial={{ width: 0 }}
                      animate={{ width: `${profile?.progress || 0}%` }}
                      className="h-full bg-emerald-500 rounded-full"
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-emerald-600" />
                  <h4 className="text-xs font-bold text-stone-400 uppercase tracking-widest">Personalized Tips</h4>
                </div>
                <div className="grid gap-3">
                  {profile?.commonMistakes.length === 0 ? (
                    <div className="p-6 text-center bg-stone-50 rounded-2xl border border-dashed border-stone-200">
                      <p className="text-stone-400 text-xs italic">No tips yet. Start chatting to get feedback!</p>
                    </div>
                  ) : (
                    profile?.commonMistakes.map((mistake, i) => (
                      <div key={i} className="bg-white p-4 rounded-2xl border border-stone-100 shadow-sm flex items-center gap-4">
                        <div className="w-8 h-8 bg-emerald-50 rounded-lg flex items-center justify-center flex-shrink-0">
                          <Sparkles className="w-4 h-4 text-emerald-500" />
                        </div>
                        <p className="text-sm text-stone-700 font-medium leading-snug">{mistake}</p>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </motion.div>
          )}

          {activeTab === 'profile' && (
            <motion.div 
              key="profile"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="h-full px-6 py-8 space-y-8 pb-24"
            >
              <div className="flex flex-col items-center text-center space-y-4">
                <div className="w-24 h-24 rounded-3xl bg-stone-100 overflow-hidden border-4 border-white shadow-xl">
                  {user.photoURL ? (
                    <img src={user.photoURL} alt="Profile" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                  ) : (
                    <User className="w-12 h-12 text-stone-300 m-6" />
                  )}
                </div>
                <div className="space-y-1">
                  <h3 className="text-xl font-bold text-stone-900">{user.displayName}</h3>
                  <p className="text-stone-400 text-sm">{user.email}</p>
                </div>
              </div>

              <div className="bg-white rounded-3xl border border-stone-100 shadow-sm overflow-hidden">
                <button className="w-full px-6 py-4 flex items-center justify-between hover:bg-stone-50 transition-colors border-b border-stone-50">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center text-blue-600">
                      <Settings className="w-5 h-5" />
                    </div>
                    <span className="font-bold text-stone-700 text-sm">App Settings</span>
                  </div>
                  <ChevronRight className="w-5 h-5 text-stone-300" />
                </button>
                <button 
                  onClick={handleLogout}
                  className="w-full px-6 py-4 flex items-center justify-between hover:bg-red-50 transition-colors text-red-500"
                >
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 bg-red-50 rounded-xl flex items-center justify-center">
                      <LogOut className="w-5 h-5" />
                    </div>
                    <span className="font-bold text-sm">Sign Out</span>
                  </div>
                  <ChevronRight className="w-5 h-5 text-red-200" />
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Bottom Navigation */}
      <nav className="bg-white border-t border-stone-100 px-8 py-4 flex items-center justify-between safe-bottom">
        <button 
          onClick={() => setActiveTab('chat')}
          className={cn(
            "flex flex-col items-center gap-1 transition-all active:scale-90",
            activeTab === 'chat' ? "text-emerald-600" : "text-stone-400"
          )}
        >
          <MessageSquare className={cn("w-6 h-6", activeTab === 'chat' && "fill-current")} />
          <span className="text-[10px] font-bold uppercase tracking-tighter">Chat</span>
        </button>
        <button 
          onClick={() => setActiveTab('progress')}
          className={cn(
            "flex flex-col items-center gap-1 transition-all active:scale-90",
            activeTab === 'progress' ? "text-emerald-600" : "text-stone-400"
          )}
        >
          <BarChart3 className={cn("w-6 h-6", activeTab === 'progress' && "fill-current")} />
          <span className="text-[10px] font-bold uppercase tracking-tighter">Stats</span>
        </button>
        <button 
          onClick={() => setActiveTab('profile')}
          className={cn(
            "flex flex-col items-center gap-1 transition-all active:scale-90",
            activeTab === 'profile' ? "text-emerald-600" : "text-stone-400"
          )}
        >
          <User className={cn("w-6 h-6", activeTab === 'profile' && "fill-current")} />
          <span className="text-[10px] font-bold uppercase tracking-tighter">Profile</span>
        </button>
      </nav>

      {/* Immersive Voice Mode Overlay */}
      <AnimatePresence>
        {isVoiceMode && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-stone-900 z-50 flex flex-col items-center justify-center p-8"
          >
            <button 
              onClick={() => setIsVoiceMode(false)}
              className="absolute top-12 right-8 p-3 bg-white/10 text-white rounded-full active:scale-90"
            >
              <X className="w-6 h-6" />
            </button>

            <div className="flex-1 flex flex-col items-center justify-center space-y-12 w-full">
              <div className="relative">
                <motion.div 
                  animate={{ 
                    scale: isRecording ? [1, 1.2, 1] : 1,
                    opacity: isRecording ? [0.5, 1, 0.5] : 0.5
                  }}
                  transition={{ repeat: Infinity, duration: 2 }}
                  className="absolute inset-0 bg-emerald-500 rounded-full blur-3xl"
                />
                <div className="relative w-48 h-48 bg-emerald-500 rounded-full flex items-center justify-center shadow-2xl shadow-emerald-500/50">
                  <Bot className="w-24 h-24 text-white" />
                </div>
              </div>

              <div className="text-center space-y-4">
                <h3 className="text-2xl font-bold text-white">
                  {isRecording ? "Listening..." : isProcessing ? "Thinking..." : "Ready to speak"}
                </h3>
                <p className="text-stone-400 text-sm max-w-xs mx-auto">
                  {isRecording 
                    ? "LingoCoach is listening to your English. Keep speaking!" 
                    : "Tap and hold the button below to start your voice lesson."}
                </p>
              </div>
            </div>

            <div className="w-full pb-12 flex flex-col items-center gap-6">
              <button
                onMouseDown={startRecording}
                onMouseUp={stopRecording}
                onTouchStart={startRecording}
                onTouchEnd={stopRecording}
                className={cn(
                  "w-24 h-24 rounded-full flex items-center justify-center transition-all shadow-2xl",
                  isRecording 
                    ? "bg-red-500 text-white scale-110 shadow-red-500/50" 
                    : "bg-white text-stone-900 hover:scale-105"
                )}
              >
                {isRecording ? <MicOff className="w-10 h-10" /> : <Mic className="w-10 h-10" />}
              </button>
              <p className="text-stone-500 text-[10px] font-bold uppercase tracking-widest">
                Hold to speak
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <audio ref={audioPlayerRef} className="hidden" />
    </div>
  );
}
