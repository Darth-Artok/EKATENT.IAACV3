import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Chat, GenerateContentResponse, GoogleGenAI, LiveServerMessage, Blob as GenaiBlob } from '@google/genai';
import { marked } from 'marked';
import { createChat } from '../services/geminiService';
import { ChatMessage } from '../types';
import { encode } from '../utils/audio';
import type { Firestore } from 'firebase/firestore';
import { doc, setDoc } from 'firebase/firestore';


// The API key is injected via environment variables.
const apiKey = process.env.API_KEY;

const MarkdownRenderer: React.FC<{ text: string, className: string }> = ({ text, className }) => {
    const [html, setHtml] = useState('');

    useEffect(() => {
        const parse = async () => {
            const parsedHtml = await marked.parse(text);
            setHtml(parsedHtml);
        };
        parse();
    }, [text]);

    return <div className={className} dangerouslySetInnerHTML={{ __html: html }} />;
};

interface ChatBotProps {
  userId: string | null;
  db: Firestore | null;
}

const ChatBot: React.FC<ChatBotProps> = ({ userId, db }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [input, setInput] = useState('');
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [loading, setLoading] = useState(false);
    const chatSessionRef = useRef<Chat | null>(null);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    
    // --- STT States and Refs ---
    const [isRecording, setIsRecording] = useState(false);
    const sttSessionPromiseRef = useRef<Promise<any> | null>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
    const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
    const accumulatedTranscriptionRef = useRef('');

    useEffect(() => {
        if (isOpen && !chatSessionRef.current) {
            chatSessionRef.current = createChat();
            setMessages([{ role: 'model', parts: [{ text: "Hola, soy Quorra. ¿En qué puedo ayudarte?" }] }]);
        }
    }, [isOpen]);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    useEffect(scrollToBottom, [messages]);
    
    const saveChatHistory = async (chatMessages: ChatMessage[]) => {
        if (!userId || !db || chatMessages.length < 2) { // Need at least one user and one model message
            return;
        }

        try {
            const timestamp = new Date().toISOString();
            const sessionIdentifier = `session_${new Date().getTime()}`;
            const chatDocRef = doc(db, 'users', userId, 'chat_history', sessionIdentifier);
            
            await setDoc(chatDocRef, {
                messages: chatMessages,
                createdAt: timestamp,
                summary: `Chat session with ${chatMessages.length} messages.`
            });
            console.log("Chat history saved successfully to Firestore.");
        } catch (error) {
            console.error("Failed to save chat history:", error);
        }
    };

    const handleSend = async () => {
        if (!input.trim() || !chatSessionRef.current || loading) return;

        const userMessage: ChatMessage = { role: 'user', parts: [{ text: input }] };
        setMessages(prev => [...prev, userMessage]);
        const currentInput = input;
        setInput('');
        setLoading(true);

        try {
            const stream = await chatSessionRef.current.sendMessageStream({ message: currentInput });
            let modelResponse = '';
            setMessages(prev => [...prev, { role: 'model', parts: [{ text: '' }] }]);

            for await (const chunk of stream) {
                modelResponse += chunk.text;
                setMessages(prev => {
                    const newMessages = [...prev];
                    newMessages[newMessages.length - 1].parts[0].text = modelResponse;
                    return newMessages;
                });
            }
            
            // Use callback form to get the most recent state
            setMessages(currentMessages => {
                saveChatHistory(currentMessages);
                return currentMessages;
            });

        } catch (error) {
            console.error("Chat error:", error);
            setMessages(prev => [...prev, { role: 'model', parts: [{ text: "Lo siento, tuve un problema para procesar tu solicitud." }] }]);
        } finally {
            setLoading(false);
        }
    };
    
    // --- STT Logic ---
    const stopRecording = useCallback(() => {
        setIsRecording(false);
        sttSessionPromiseRef.current?.then(session => session.close()).catch(console.error);
        sttSessionPromiseRef.current = null;

        streamRef.current?.getTracks().forEach(track => track.stop());
        streamRef.current = null;

        if (scriptProcessorRef.current) scriptProcessorRef.current.disconnect();
        if (sourceRef.current) sourceRef.current.disconnect();
        scriptProcessorRef.current = null;
        sourceRef.current = null;
        
        audioContextRef.current?.close().catch(console.error);
        audioContextRef.current = null;
    }, []);

    useEffect(() => () => stopRecording(), [stopRecording]);

    const handleToggleRecording = async () => {
        if (isRecording) {
            stopRecording();
            return;
        }

        setIsRecording(true);
        accumulatedTranscriptionRef.current = '';
        setInput('');

        try {
            if (!apiKey) throw new Error("API_KEY environment variable not set");
            const ai = new GoogleGenAI({ apiKey });

            audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
            streamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true });

            if (!audioContextRef.current || !streamRef.current) return;
            
            const audioCtx = audioContextRef.current;
            sourceRef.current = audioCtx.createMediaStreamSource(streamRef.current);
            scriptProcessorRef.current = audioCtx.createScriptProcessor(4096, 1, 1);

            scriptProcessorRef.current.onaudioprocess = (event) => {
                const inputData = event.inputBuffer.getChannelData(0);
                const pcmBlob: GenaiBlob = {
                    data: encode(new Uint8Array(new Int16Array(inputData.map(x => x * 32768)).buffer)),
                    mimeType: 'audio/pcm;rate=16000',
                };
                sttSessionPromiseRef.current?.then((session) => {
                    session.sendRealtimeInput({ media: pcmBlob });
                });
            };
            
            sourceRef.current.connect(scriptProcessorRef.current);
            scriptProcessorRef.current.connect(audioCtx.destination);

            sttSessionPromiseRef.current = ai.live.connect({
                model: 'gemini-2.5-flash-native-audio-preview-09-2025',
                callbacks: {
                    onopen: () => console.log('STT session opened for chatbot.'),
                    onmessage: (message: LiveServerMessage) => {
                        if (message.serverContent?.inputTranscription) {
                            const newText = message.serverContent.inputTranscription.text;
                            accumulatedTranscriptionRef.current += newText;
                            setInput(accumulatedTranscriptionRef.current);
                        }
                    },
                    onerror: (e: ErrorEvent) => {
                        console.error('STT session error:', e);
                        stopRecording();
                    },
                    onclose: () => console.log('STT session closed for chatbot.'),
                },
                config: {
                    inputAudioTranscription: {},
                }
            });

        } catch (error) {
            console.error("Failed to start recording:", error);
            alert("No se pudo iniciar el micrófono. Revisa los permisos en tu navegador.");
            stopRecording();
        }
    };


    if (!isOpen) {
        return (
            <button
                onClick={() => setIsOpen(true)}
                className="fixed bottom-6 right-6 z-50 w-16 h-16 bg-cyan-600 rounded-full text-white flex items-center justify-center shadow-lg shadow-cyan-500/30 hover:bg-cyan-500 transition-all transform hover:scale-110"
                aria-label="Open Chat"
            >
                <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"></path></svg>
            </button>
        );
    }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="w-full max-w-lg h-[80vh] bg-gray-900 border-2 border-cyan-600 rounded-xl shadow-2xl shadow-cyan-500/20 flex flex-col">
                <header className="p-4 border-b-2 border-cyan-800 flex justify-between items-center">
                    <h2 className="text-xl font-bold text-cyan-400">Chat con Quorra</h2>
                    <button onClick={() => setIsOpen(false)} className="text-gray-400 hover:text-white">&times;</button>
                </header>
                <main className="flex-1 p-4 overflow-y-auto space-y-4">
                    {messages.map((msg, index) => (
                        <div key={index} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                            <MarkdownRenderer
                                text={msg.parts[0].text}
                                className={`max-w-[80%] p-3 rounded-lg ${
                                    msg.role === 'user' ? 'bg-cyan-700 text-white' : 'bg-gray-800 text-gray-200'
                                } prose prose-invert prose-p:my-0`}
                            />
                        </div>
                    ))}
                    {loading && <div className="flex justify-start"><div className="bg-gray-800 p-3 rounded-lg text-gray-400 animate-pulse">...</div></div>}
                    <div ref={messagesEndRef} />
                </main>
                <footer className="p-4 border-t-2 border-cyan-800">
                    <div className="flex gap-2">
                        <input
                            type="text"
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            onKeyPress={(e) => e.key === 'Enter' && handleSend()}
                            placeholder={isRecording ? "Escuchando..." : "Pregúntale a Quorra..."}
                            className="flex-1 p-2 bg-gray-800 border border-cyan-700 rounded-lg focus:outline-none focus:ring-1 focus:ring-cyan-500 text-white"
                            disabled={loading || isRecording}
                        />
                        <button 
                          onClick={handleToggleRecording} 
                          disabled={loading} 
                          className={`px-4 py-2 rounded-lg transition-colors ${isRecording ? 'bg-red-600 hover:bg-red-500' : 'bg-gray-600 hover:bg-gray-500'} disabled:bg-gray-700`}
                          aria-label={isRecording ? "Stop recording" : "Start recording"}
                        >
                           <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                             <path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                           </svg>
                        </button>
                        <button onClick={handleSend} disabled={loading || !input.trim()} className="px-4 py-2 bg-cyan-600 rounded-lg hover:bg-cyan-500 disabled:bg-gray-600">Enviar</button>
                    </div>
                </footer>
            </div>
        </div>
    );
};

export default ChatBot;