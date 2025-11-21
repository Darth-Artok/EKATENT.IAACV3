import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Firestore } from 'firebase/firestore';
import { GameState, LogEntry, AppScreen } from '../types';
import * as geminiService from '../services/geminiService';
import { marked } from 'marked';
import { fileToBase64 } from '../utils/file';
import { decode, decodeAudioData } from '../utils/audio';
import LiveConversation from './LiveConversation';
import ChatBot from './ChatBot';

// --- TYPE DECLARATIONS for global libraries ---
declare const cocoSsd: any;
declare const tf: any;

interface GameplayScreenProps {
    placaId: string;
    gameState: GameState;
    setGameState: React.Dispatch<React.SetStateAction<GameState>>;
    iaDialogue: string;
    setIaDialogue: React.Dispatch<React.SetStateAction<string>>;
    log: LogEntry[];
    loading: boolean;
    dbInitializationError: string | null;
    userId: string | null;
    db: Firestore | null;
    appId: string;
    onGetAdvice: () => void;
    setAppState: React.Dispatch<React.SetStateAction<AppScreen>>;
    metaData: string;
    onAddLogEntry: (entry: LogEntry) => void;
}

const ENEMY_ALERT_COOLDOWN = 15000; // 15 seconds
const TARGETING_ALERT_COOLDOWN = 10000; // 10 seconds
// REFACTOR: COMBAT_EXIT_DELAY is no longer a fixed constant.
// Instead we use base values to calculate it dynamically.
const BASE_COMBAT_EXIT_DELAY = 3000; // Base 3 seconds
const ENEMY_DELAY_FACTOR = 500; // +500ms per enemy
const HUD_SCAN_INTERVAL = 3000; // Scan Health/Shield every 3 seconds (More frequent for real-time logic)

const GameplayScreen: React.FC<GameplayScreenProps> = ({
    placaId,
    gameState,
    setGameState,
    iaDialogue,
    setIaDialogue,
    loading,
    dbInitializationError,
    userId,
    db,
    onGetAdvice,
    setAppState,
    metaData,
    appId,
    onAddLogEntry,
}) => {
    const [isMenuOpen, setIsMenuOpen] = useState(false);
    const [uploadedVideoFile, setUploadedVideoFile] = useState<File | null>(null);
    const [uploadedImageFile, setUploadedImageFile] = useState<File | null>(null);
    const [isProcessingFeedback, setIsProcessingFeedback] = useState(false);
    const [isProcessingImage, setIsProcessingImage] = useState(false);
    const [feedbackStatus, setFeedbackStatus] = useState<string | null>(null);
    const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');
    const [videoSource, setVideoSource] = useState<'camera' | 'screen' | 'file'>('camera');
    const [localVideoUrl, setLocalVideoUrl] = useState<string | null>(null);
    const [detectionFps, setDetectionFps] = useState<number>(10);
    const [isDefeated, setIsDefeated] = useState(false);
    const [parsedIaDialogue, setParsedIaDialogue] = useState('');

    const videoRef = useRef<HTMLVideoElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const modelRef = useRef<any>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const [cvStatus, setCvStatus] = useState("Inicializando Visión...");
    const ttsAudioContextRef = useRef<AudioContext | null>(null);
    const isDefeatedRef = useRef(isDefeated);
    const lastDetectionTimeRef = useRef(0);
    const detectionFpsRef = useRef(detectionFps);

    // Previous state reference to calculate trends (damage/healing)
    const prevGameStateRef = useRef<GameState>(gameState);

    // New state for proactive alerts and scene description
    const [alertMessage, setAlertMessage] = useState<string | null>(null);
    const [isMultiEnemyAlert, setIsMultiEnemyAlert] = useState(false);
    const [detectedEnemyCount, setDetectedEnemyCount] = useState(0);
    const [isTargetingEnemy, setIsTargetingEnemy] = useState(false);
    
    // Refs for alert cooldowns
    const lastEnemyAlertTimeRef = useRef(0);
    const lastTargetingAlertTimeRef = useRef(0);
    const lastEnemySeenTimeRef = useRef(0);

    // Update ref whenever isDefeated state changes
    useEffect(() => {
        isDefeatedRef.current = isDefeated;
    }, [isDefeated]);

    // Update FPS ref when state changes
    useEffect(() => {
        detectionFpsRef.current = detectionFps;
    }, [detectionFps]);

    // Effect to check for defeat condition
    useEffect(() => {
        if (gameState.life <= 0 && !isDefeated) {
            setIsDefeated(true);
            setIaDialogue("Has sido eliminado. Mejor suerte la próxima vez, recluta.");
            
            // REFACTOR: Force Combat State reset on defeat to ensure consistent state
            setGameState(prev => ({
                ...prev,
                isCombat: false
            }));
        }
    }, [gameState.life, isDefeated, setIaDialogue, setGameState]);

    // --- AI HUD OBSERVATION & REAL-TIME LOGIC ---
    useEffect(() => {
        if (isDefeated) return;

        const scanHud = async () => {
            if (!videoRef.current || videoRef.current.paused || videoRef.current.ended) return;

            // Create a temporary canvas to snapshot the frame
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = videoRef.current.videoWidth;
            tempCanvas.height = videoRef.current.videoHeight;
            const ctx = tempCanvas.getContext('2d');
            if (!ctx) return;

            ctx.drawImage(videoRef.current, 0, 0, tempCanvas.width, tempCanvas.height);
            
            // Convert to base64 locally
            const base64 = tempCanvas.toDataURL('image/jpeg', 0.5).split(',')[1];
            
            if (base64) {
                // Send to local AI service
                const hudData = await geminiService.scanGameplayHud(base64);
                
                setGameState(prevState => {
                    const prevLife = prevGameStateRef.current.life;
                    let currentAction: 'healing' | 'taking_damage' | 'stable' | 'looting' = 'stable';

                    // Logic to detect real-time action based on HUD changes or visual context
                    if (hudData.context === 'taking_damage') {
                         currentAction = 'taking_damage';
                    } else if (hudData.context === 'healing') {
                         currentAction = 'healing';
                    } else {
                        // Fallback to numeric delta if visual context isn't specific
                        // Compare against PREVIOUS state ref, not just prevState arg
                        if (hudData.life < prevLife) {
                             currentAction = 'taking_damage';
                        } else if (hudData.life > prevLife) {
                             currentAction = 'healing';
                        }
                    }

                    const newState = {
                        ...prevState,
                        life: hudData.life,
                        shield: hudData.shield,
                        recentAction: currentAction
                    };
                    
                    // Update the ref for the next interval comparison
                    prevGameStateRef.current = newState;

                    return newState;
                });
            }
        };

        const intervalId = setInterval(scanHud, HUD_SCAN_INTERVAL);
        return () => clearInterval(intervalId);
    }, [isDefeated, videoSource]);


    // --- Text-to-Speech (TTS) Effect ---
    useEffect(() => {
        const playTts = async () => {
            if (!iaDialogue || iaDialogue.toLowerCase().includes('error')) return;
            
            if (!ttsAudioContextRef.current) {
                try {
                    ttsAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
                } catch (e) {
                    console.error("Could not create audio context for TTS", e);
                    return;
                }
            }
            
            const audioCtx = ttsAudioContextRef.current;
            if (audioCtx.state === 'suspended') audioCtx.resume();

            const plainText = new DOMParser().parseFromString(iaDialogue, 'text/html').body.textContent || "";
            if (plainText.trim()) return;

            const audioBase64 = await geminiService.textToSpeech(plainText);
            
            if (audioBase64 && audioCtx) {
                const audioBuffer = await decodeAudioData(decode(audioBase64), audioCtx, 24000, 1);
                const source = audioCtx.createBufferSource();
                source.buffer = audioBuffer;
                source.connect(audioCtx.destination);
                source.start();
            }
        };

        playTts();
    }, [iaDialogue]);

    useEffect(() => {
        const parseDialogue = async () => {
            const html = await marked.parse(iaDialogue.replace(/\n/g, '<br/>'));
            setParsedIaDialogue(html);
        };
        parseDialogue();
    }, [iaDialogue]);


    const handleGameplayUploadAndFeedback = async (videoFile: File | null) => {
        if (!videoFile || !userId || !db) {
            setFeedbackStatus("Error: Archivo no seleccionado o servicio de DB no disponible.");
            return;
        }

        setIsProcessingFeedback(true);
        setFeedbackStatus("Iniciando análisis...");

        try {
            setFeedbackStatus("Procesando video local...");
            const videoBase64 = await fileToBase64(videoFile);

            setFeedbackStatus("Obteniendo análisis de Gemini Pro...");
            const analysisResult = await geminiService.analyzeVideoGameplay(videoBase64, videoFile.type, gameState, placaId);
            
            const parsedHtml = await marked.parse(analysisResult);
            setIaDialogue(parsedHtml);
            setFeedbackStatus(`Análisis completado.`);
            setIsMenuOpen(false);

            const newLogEntry: LogEntry = {
                timestamp: new Date().toISOString(),
                advice: analysisResult,
                gameState: { ...gameState },
                userId: userId,
                placaId: placaId,
                systemPrompt: "VIDEO GAMEPLAY ANALYSIS",
            };
            
            // Use centralized logging function to update state and Firestore
            onAddLogEntry(newLogEntry);

        } catch (error: any) {
            console.error("Error en la retroalimentación de CV:", error);
            const errorMsg = `ERROR: Fallo el análisis de video. ${error.message || 'El modelo no pudo procesar el archivo.'}`;
            setFeedbackStatus(errorMsg);
            setIaDialogue(errorMsg);
        } finally {
            setIsProcessingFeedback(false);
            setUploadedVideoFile(null);
        }
    };

    const handleImageUploadAndAnalysis = async (imageFile: File | null) => {
        if (!imageFile || !userId || !db) {
             setIaDialogue("Error: Sistema no listo o archivo faltante.");
             return;
        }

        setIsProcessingImage(true);
        setIaDialogue("Procesando captura visual...");

        try {
            const imageBase64 = await fileToBase64(imageFile);
            const analysisResult = await geminiService.analyzeTacticalImage(imageBase64, imageFile.type);
            
            const parsedHtml = await marked.parse(analysisResult);
            setIaDialogue(parsedHtml);
            setIsMenuOpen(false); 
            setUploadedImageFile(null);

            const newLogEntry: LogEntry = {
                timestamp: new Date().toISOString(),
                advice: analysisResult,
                gameState: { ...gameState },
                userId: userId,
                placaId: placaId,
                systemPrompt: "IMAGE TACTICAL ANALYSIS",
            };
            
            // Use centralized logging function to update state and Firestore
            onAddLogEntry(newLogEntry);

        } catch (error: any) {
            console.error("Error en análisis de imagen:", error);
            setIaDialogue("Error: Mis sensores no pudieron procesar esa imagen.");
        } finally {
            setIsProcessingImage(false);
        }
    };
    
    const handleNewEnemySpotted = useCallback(async (enemyCount: number) => {
        const now = Date.now();
        if (now - lastEnemyAlertTimeRef.current < ENEMY_ALERT_COOLDOWN) return;
        lastEnemyAlertTimeRef.current = now;

        const alertText = await geminiService.generateEnemySpottedAlert(enemyCount);
        setAlertMessage(alertText);
        setIsMultiEnemyAlert(enemyCount > 1);
        setIaDialogue(alertText);
    }, [setIaDialogue]);

    const handlePlayerIsTargeting = useCallback(async () => {
        const now = Date.now();
        if (now - lastTargetingAlertTimeRef.current < TARGETING_ALERT_COOLDOWN) return;
        lastTargetingAlertTimeRef.current = now;

        const targetingText = await geminiService.generateTargetingComment();
        setIaDialogue(targetingText);
    }, [setIaDialogue]);

    const handleIdleChat = useCallback(async () => {
        setIsMenuOpen(false);
        setIaDialogue("Generando tema de conversación...");
        const chatText = await geminiService.fetchIdleChatter();
        setIaDialogue(chatText);
    }, [setIaDialogue]);
    
    const drawHUD = useCallback((context: CanvasRenderingContext2D, enemyCount: number) => {
        const { canvas } = context;
        const barWidth = 250;
        const barHeight = 22;
        const padding = 20;
        const bottomY = canvas.height - padding;
        const glowColor = '#08d9d6'; // Tron cyan

        context.save();
        context.shadowColor = glowColor;
        context.shadowBlur = 15;
        context.font = "bold 16px 'Orbitron', sans-serif";
        
        // --- Health & Shield Bars (Bottom Left) ---
        const drawBar = (label: string, value: number, y: number, color: string) => {
            context.strokeStyle = glowColor;
            context.lineWidth = 2;
            context.strokeRect(padding, y, barWidth, barHeight);
            
            context.fillStyle = 'rgba(0, 20, 20, 0.5)';
            context.fillRect(padding + 1, y + 1, barWidth - 2, barHeight - 2);
            
            const fillWidth = barWidth * (value / 100);
            context.fillStyle = color;
            context.fillRect(padding, y, fillWidth, barHeight);
            
            context.fillStyle = '#fff';
            context.textAlign = 'left';
            context.fillText(label, padding + 10, y + barHeight - 5);
            
            context.textAlign = 'right';
            context.fillText(`${value}`, padding + barWidth - 10, y + barHeight - 5);
        };

        const healthY = bottomY - barHeight;
        const shieldY = healthY - barHeight - 8;
        
        drawBar('ESCUDO', gameState.shield, shieldY, '#38bdf8');
        drawBar('VIDA', gameState.life, healthY, '#4ade80');
        
        // Label indicating AI control and Current Action
        context.fillStyle = '#08d9d6';
        context.font = "10px sans-serif";
        context.textAlign = 'left';
        
        let statusText = "ESTADO MONITOREADO POR IA";
        if (gameState.recentAction === 'taking_damage') statusText = "⚠️ DAÑO CRÍTICO DETECTADO";
        if (gameState.recentAction === 'healing') statusText = "➕ REGENERANDO SISTEMAS";
        
        context.fillText(statusText, padding, shieldY - 5);

        // --- Enemy Counter (Top Right) ---
        if (enemyCount > 0) {
            context.textAlign = 'right';
            context.fillStyle = '#f87171'; 
            context.shadowColor = '#f87171';
            context.shadowBlur = 10;
            context.font = "bold 24px 'Orbitron', sans-serif";
            context.fillText(`ENEMIGOS: ${enemyCount}`, canvas.width - padding, padding + 24);
        }
        
        context.restore();

    }, [gameState.life, gameState.shield, gameState.recentAction]);

    const processPredictions = useCallback((predictions: any[], context: CanvasRenderingContext2D) => {
        const canvas = context.canvas;
        const centerX = canvas.width / 2;
        const centerY = canvas.height / 2;
        const targetingZone = {
            x: centerX - canvas.width * 0.15,
            y