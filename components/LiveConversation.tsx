import React, { useState, useRef, useCallback, useEffect } from 'react';
// FIX: Remove non-existent `LiveSession` type from import. The session object from `ai.live.connect` is not an exported type in the SDK.
import { GoogleGenAI, LiveServerMessage, Modality, Blob as GenaiBlob } from "@google/genai";
import { encode, decode, decodeAudioData } from '../utils/audio';

// The API key is injected via environment variables.
const apiKey = process.env.API_KEY;

const FRAME_RATE = 2; // fps
const JPEG_QUALITY = 0.6;
const MAX_RETRIES = 3;

const blobToBase64 = (blob: Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
            const result = reader.result as string;
            // Remove the data URI prefix (e.g., "data:image/jpeg;base64,")
            resolve(result.split(',')[1]);
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
};

interface LiveConversationProps {
    videoRef: React.RefObject<HTMLVideoElement>;
}

const LiveConversation: React.FC<LiveConversationProps> = ({ videoRef }) => {
    const [isLive, setIsLive] = useState(false);
    const [status, setStatus] = useState('Inactivo');
    const [inputTranscription, setInputTranscription] = useState('');
    const [outputTranscription, setOutputTranscription] = useState('');

    // FIX: Use `any` for the session type as `LiveSession` is not an exported type from the SDK.
    const sessionPromiseRef = useRef<Promise<any> | null>(null);
    const inputAudioContextRef = useRef<AudioContext | null>(null);
    const outputAudioContextRef = useRef<AudioContext | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
    const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
    
    const frameIntervalRef = useRef<number | null>(null);
    const retryTimeoutRef = useRef<number | null>(null);
    const retryAttemptRef = useRef(0);
    const lastInputTranscriptionRef = useRef('');

    // --- FIX: Add a ref to track active session state to prevent race conditions in callbacks ---
    const isSessionActiveRef = useRef(false);
    useEffect(() => {
        isSessionActiveRef.current = isLive;
    }, [isLive]);

    const nextStartTimeRef = useRef(0);
    const sourcesRef = useRef(new Set<AudioBufferSourceNode>());

    const stopLiveSession = useCallback(() => {
        setIsLive(false);

        if (retryTimeoutRef.current) clearTimeout(retryTimeoutRef.current);
        if (frameIntervalRef.current) clearInterval(frameIntervalRef.current);
        retryTimeoutRef.current = null;
        frameIntervalRef.current = null;

        sessionPromiseRef.current?.then(session => session.close()).catch(e => console.error("Error closing session:", e));
        sessionPromiseRef.current = null;

        streamRef.current?.getTracks().forEach(track => track.stop());
        streamRef.current = null;

        if (scriptProcessorRef.current) scriptProcessorRef.current.disconnect();
        if (sourceRef.current) sourceRef.current.disconnect();
        scriptProcessorRef.current = null;
        sourceRef.current = null;
        
        inputAudioContextRef.current?.close().catch(console.error);
        outputAudioContextRef.current?.close().catch(console.error);
        inputAudioContextRef.current = null;
        outputAudioContextRef.current = null;
    }, []);

    const connectToGemini = useCallback(() => {
        if (!apiKey) {
            setStatus("Error: API Key no configurada.");
            setIsLive(false);
            return;
        }
        const ai = new GoogleGenAI({ apiKey });
        const systemInstruction = `Eres Quorra, una IA de asistencia táctica para Fortnite. Estás en una sesión de voz EN VIVO con el jugador. Recibirás un flujo de audio del jugador y un flujo de imágenes del campo de batalla (a ${FRAME_RATE} FPS). Tu objetivo es proporcionar consejos tácticos concisos y en tiempo real basados en lo que ves y oyes. Analiza las imágenes para identificar enemigos, posiciones, construcciones y oportunidades. Si el usuario dice 'contacto', responde inmediatamente pidiendo detalles tácticos. Mantén tu personalidad: eficiente, inteligente y con un toque de sarcasmo sutil. Responde con audio.`;

        sessionPromiseRef.current = ai.live.connect({
            model: 'gemini-2.5-flash-native-audio-preview-09-2025',
            callbacks: {
                onopen: () => {
                    setStatus('Conectado. Habla ahora.');
                    retryAttemptRef.current = 0; // Reset on successful connection
                    const inputCtx = inputAudioContextRef.current;

                    // Start streaming audio and video
                    if (sourceRef.current && scriptProcessorRef.current && inputCtx) {
                        sourceRef.current.connect(scriptProcessorRef.current);
                        scriptProcessorRef.current.connect(inputCtx.destination);
                    }
                    
                    const tempCanvas = document.createElement('canvas');
                    const tempCtx = tempCanvas.getContext('2d');
                    if (frameIntervalRef.current) clearInterval(frameIntervalRef.current);
                    frameIntervalRef.current = window.setInterval(() => {
                        const video = videoRef.current;
                        if (video && tempCtx && video.readyState >= 2 && video.videoWidth > 0) {
                            tempCanvas.width = video.videoWidth;
                            tempCanvas.height = video.videoHeight;
                            tempCtx.drawImage(video, 0, 0, video.videoWidth, video.videoHeight);
                            tempCanvas.toBlob(
                                async (blob) => {
                                    if (blob && isSessionActiveRef.current) { // Check if still active before sending
                                        const base64Data = await blobToBase64(blob);
                                        const imageBlob: GenaiBlob = { data: base64Data, mimeType: 'image/jpeg' };
                                        sessionPromiseRef.current?.then((session) => session.sendRealtimeInput({ media: imageBlob }));
                                    }
                                }, 'image/jpeg', JPEG_QUALITY);
                        }
                    }, 1000 / FRAME_RATE);
                },
                onmessage: async (message: LiveServerMessage) => {
                    if (message.serverContent?.inputTranscription) {
                        const newText = message.serverContent.inputTranscription.text;
                        const fullText = lastInputTranscriptionRef.current + newText;
                        setInputTranscription(fullText);
                        // Keyword detection
                        if (fullText.toLowerCase().includes('contact')) {
                            sessionPromiseRef.current?.then((session) => {
                                session.sendRealtimeInput({ text: "USER SAID 'CONTACT'. PROVIDE IMMEDIATE TACTICAL RESPONSE." });
                            });
                            lastInputTranscriptionRef.current = ''; // Reset after trigger to avoid loop
                        }
                    }
                    if (message.serverContent?.outputTranscription) setOutputTranscription(prev => prev + message.serverContent.outputTranscription.text);
                    if (message.serverContent?.turnComplete) {
                        lastInputTranscriptionRef.current = '';
                        setInputTranscription('');
                        setOutputTranscription('');
                    }
                    const base64Audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
                    const outputCtx = outputAudioContextRef.current;
                    if (base64Audio && outputCtx) {
                        nextStartTimeRef.current = Math.max(nextStartTimeRef.current, outputCtx.currentTime);
                        const audioBuffer = await decodeAudioData(decode(base64Audio), outputCtx, 24000, 1);
                        const source = outputCtx.createBufferSource();
                        source.buffer = audioBuffer;
                        source.connect(outputCtx.destination);
                        source.addEventListener('ended', () => { sourcesRef.current.delete(source); });
                        source.start(nextStartTimeRef.current);
                        nextStartTimeRef.current += audioBuffer.duration;
                        sourcesRef.current.add(source);
                    }
                    if (message.serverContent?.interrupted) {
                        for (const source of sourcesRef.current.values()) source.stop();
                        sourcesRef.current.clear();
                        nextStartTimeRef.current = 0;
                    }
                },
                onerror: (e: any) => {
                    console.error('Live session error:', e);
                    // --- FIX: Perform a more robust cleanup before deciding to retry ---
                    if (scriptProcessorRef.current) scriptProcessorRef.current.disconnect();
                    if (sourceRef.current) sourceRef.current.disconnect();
                    if (frameIntervalRef.current) {
                        clearInterval(frameIntervalRef.current);
                        frameIntervalRef.current = null;
                    }

                    const errorMessage = e?.message || (e instanceof CloseEvent ? `Connection closed: ${e.code} ${e.reason}` : 'Unknown live session error');
                    
                    const isRetryable = (
                        errorMessage.includes('Network error') ||
                        (e instanceof CloseEvent && e.code === 1006) // Abnormal closure
                    );

                    const shouldRetry = isRetryable && retryAttemptRef.current < MAX_RETRIES;

                    if (shouldRetry) {
                        retryAttemptRef.current += 1;
                        const delay = Math.pow(2, retryAttemptRef.current) * 1000;
                        setStatus(`Error de red. Reintentando (${retryAttemptRef.current}/${MAX_RETRIES})...`);
                        if (retryTimeoutRef.current) clearTimeout(retryTimeoutRef.current);
                        retryTimeoutRef.current = window.setTimeout(() => {
                            // --- FIX: Use ref to check current state and prevent retrying a stopped session ---
                            if (isSessionActiveRef.current) {
                                setStatus('Reconectando...');
                                connectToGemini();
                            }
                        }, delay);
                    } else {
                        if (errorMessage.includes('API key not valid')) {
                            setStatus('Error: La clave de API no es válida.');
                        } else {
                             setStatus(`Error de conexión irrecuperable. Revisa la consola.`);
                        }
                        stopLiveSession();
                    }
                },
                onclose: () => {
                     // Only set status if it was an unexpected close
                    if (isSessionActiveRef.current) {
                       setStatus('Conexión cerrada inesperadamente.');
                    }
                },
            },
            config: {
                responseModalities: [Modality.AUDIO],
                inputAudioTranscription: {},
                outputAudioTranscription: {},
                speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } } },
                systemInstruction,
            },
        });
        
        sessionPromiseRef.current.catch(err => {
            console.error("Initial connection failed:", err);
            // --- FIX: Provide a clearer error message for initial connection failures ---
            setStatus(`Fallo de conexión inicial: ${err.message || 'Error de red'}`);
            stopLiveSession();
        });

    }, [videoRef, stopLiveSession]); 
    
    useEffect(() => () => stopLiveSession(), [stopLiveSession]);

    const startLiveSession = async () => {
        setIsLive(true);
        setStatus('Inicializando...');
        setInputTranscription('');
        lastInputTranscriptionRef.current = '';
        setOutputTranscription('');
        retryAttemptRef.current = 0;
        
        try {
            inputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
            outputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
            streamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true });

            // Guard clause to prevent crash if component unmounts or is toggled quickly
            if (!inputAudioContextRef.current || !streamRef.current) {
                throw new Error("Audio context or stream invalidated during startup.");
            }
            
            const inputCtx = inputAudioContextRef.current;
            sourceRef.current = inputCtx.createMediaStreamSource(streamRef.current);
            scriptProcessorRef.current = inputCtx.createScriptProcessor(4096, 1, 1);
            
            scriptProcessorRef.current.onaudioprocess = (audioProcessingEvent) => {
                const inputData = audioProcessingEvent.inputBuffer.getChannelData(0);
                const pcmBlob: GenaiBlob = {
                    data: encode(new Uint8Array(new Int16Array(inputData.map(x => x * 32768)).buffer)),
                    mimeType: 'audio/pcm;rate=16000',
                };
                sessionPromiseRef.current?.then((session) => {
                    session.sendRealtimeInput({ media: pcmBlob });
                });
            };
            
            connectToGemini();

        } catch (error: any) {
            console.error('Failed to start live session:', error);
            if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') setStatus('Permiso de micrófono denegado.');
            else setStatus('Error al iniciar el micrófono.');
            stopLiveSession();
        }
    };

    const handleToggleLive = () => {
        if (isLive) {
            setStatus('Inactivo');
            stopLiveSession();
        } else {
            startLiveSession();
        }
    };

    return (
        <div className="bg-gray-800 p-4 rounded-xl shadow-xl border border-gray-700 mt-6">
            <h2 className="text-xl font-bold mb-3 text-cyan-300">Quorra Live Chat</h2>
            <div className="flex flex-col gap-4">
                <button
                    onClick={handleToggleLive}
                    className={`w-full py-2 font-bold text-md rounded-lg shadow-lg transition-all duration-300 ${
                        isLive ? 'bg-red-600 hover:bg-red-500' : 'bg-green-600 hover:bg-green-500'
                    }`}
                >
                    {isLive ? 'DETENER CHAT DE VOZ' : 'INICIAR CHAT DE VOZ'}
                </button>
                <div className="bg-gray-900 p-3 rounded-lg border border-cyan-800 min-h-[80px]">
                    <p className={`text-sm font-semibold ${status.includes('Error') || status.includes('denegado') || status.includes('Fallo') ? 'text-red-400' : 'text-cyan-400'}`}>Estado: {status}</p>
                    <p className="text-xs text-gray-400 mt-1 truncate">TÚ: {inputTranscription}</p>
                    <p className="text-sm text-white mt-1">QUORRA: {outputTranscription}</p>
                </div>
            </div>
        </div>
    );
};

export default LiveConversation;