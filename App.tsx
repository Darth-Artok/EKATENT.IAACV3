import React, { useState, useEffect } from 'react';
import { initializeApp, FirebaseApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged, Auth } from 'firebase/auth';
import { getFirestore, doc, setDoc, Firestore } from 'firebase/firestore';
import { AppScreen, GameState, LogEntry } from './types';
import StartScreen from './components/StartScreen';
import EnrollmentScreen from './components/EnrollmentScreen';
import TutorialScreen from './components/TutorialScreen';
import GameplayScreen from './components/GameplayScreen';
import * as geminiService from './services/geminiService';
import { marked } from 'marked';

// --- CONFIGURATION ---
const appId = 'fortnite-iaac-app';

// Placeholder Firebase config. In a real app, this would come from environment variables.
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_AUTH_DOMAIN",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_STORAGE_BUCKET",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId: "YOUR_APP_ID"
};

const App: React.FC = () => {
    const [appState, setAppState] = useState<AppScreen>('start');
    const [placaId, setPlacaId] = useState<string>('');
    const [log, setLog] = useState<LogEntry[]>([]);
    const [loading, setLoading] = useState<boolean>(false);
    const [iaDialogue, setIaDialogue] = useState<string>("Esperando activación...");
    const [tutorialText, setTutorialText] = useState<string>('');
    const [metaData, setMetaData] = useState<string>("Cargando Meta...");

    const [db, setDb] = useState<Firestore | null>(null);
    const [auth, setAuth] = useState<Auth | null>(null);
    const [userId, setUserId] = useState<string | null>(null);
    const [dbInitializationError, setDbInitializationError] = useState<string | null>(null);

    const [gameState, setGameState] = useState<GameState>({
        life: 100,
        shield: 50,
        inventory: ["Escopeta", "Rifle de Asalto", "Mini Escudos (3)", "Botiquín", "Pico"],
        target: { type: "Enemigo", position: "11:30" },
        location: "Pisos Picados",
        isCombat: false,
        enemyData: "Campo visual despejado o sin objetos reconocidos."
    });

    // --- Firebase Initialization ---
    useEffect(() => {
        // Prevent initialization with placeholder credentials
        if (firebaseConfig.apiKey === "YOUR_API_KEY" || !firebaseConfig.projectId) {
            setDbInitializationError("Configuración de Firebase no válida. La funcionalidad de guardado está deshabilitada.");
            return;
        }
        
        try {
            const app: FirebaseApp = initializeApp(firebaseConfig);
            const firestoreDb: Firestore = getFirestore(app);
            const firebaseAuth: Auth = getAuth(app);
            setDb(firestoreDb);
            setAuth(firebaseAuth);

            signInAnonymously(firebaseAuth).catch(error => {
                console.error("Anonymous sign-in failed:", error);
                setDbInitializationError(`Fallo de autenticación: ${error.code}. Revisa la configuración.`);
            });

            const unsubscribe = onAuthStateChanged(firebaseAuth, (user) => {
                if (user) {
                    setUserId(user.uid);
                } else {
                    setUserId(null);
                }
            });

            return () => unsubscribe();
        } catch (error: any) {
            console.error("Fatal Firebase initialization error:", error);
            if (error.message.includes("Missing or insufficient permissions")) {
                setDbInitializationError("Error de permisos en Firebase. Revisa las reglas de seguridad.");
            } else {
                setDbInitializationError("Error de conexión: El servicio de Firebase no está disponible.");
            }
        }
    }, []);

    const handleActivate = async () => {
        setLoading(true);
        setIaDialogue("Activando protocolos de bienvenida...");
        try {
            const welcomeMessage = await geminiService.fetchInitialMessage();
            setIaDialogue(welcomeMessage);
            setAppState('enrollment');
        } catch (error) {
            console.error("Error fetching welcome message:", error);
            setIaDialogue("Error al iniciar el diálogo. Ingresa tu PLACA DE ID para continuar.");
            setAppState('enrollment');
        } finally {
            setLoading(false);
        }
    };

    const handleEnrollment = async (id: string) => {
        if (!id.trim()) {
            setIaDialogue("Placa de ID requerida. Por favor, ingrésala.");
            return;
        }
        setLoading(true);
        setPlacaId(id);
        setIaDialogue(`PLACA DE ID '${id}' registrada. Generando tutorial...`);
        try {
            const tutorial = await geminiService.fetchTutorial(id);
            setTutorialText(tutorial);
            setAppState('tutorial');
        } catch (error) {
            console.error("Error fetching tutorial:", error);
            setTutorialText("No se pudo cargar el tutorial. Puedes empezar a jugar directamente.");
            setAppState('tutorial');
        } finally {
            setLoading(false);
        }
    };

    const handleStartGameplay = () => {
        setAppState('gameplay');
        setIaDialogue("Sistema táctico activado. Buena suerte.");
        geminiService.fetchGameMeta()
            .then(async meta => {
                // Fix: `marked.parse` can return a promise, so we must await it.
                 const parsedMeta = await marked.parse(meta);
                 setMetaData(parsedMeta);
            })
            .catch(err => {
                console.error("Failed to fetch game meta:", err);
                setMetaData("No se pudo obtener el meta actual.");
            });
    };

    // Centralized function to add log entries to state and Firestore
    const handleAddLogEntry = async (newLogEntry: LogEntry) => {
        // Update local state immediately for UI responsiveness
        setLog(prevLog => [newLogEntry, ...prevLog].slice(0, 10));

        // Save to Firestore
        if (userId && db) {
            try {
                const logDocRef = doc(db, 'artifacts', appId, 'users', userId, 'iaac_logs', newLogEntry.timestamp);
                await setDoc(logDocRef, newLogEntry);
            } catch (error) {
                console.error("Error saving log entry to Firestore:", error);
            }
        }
    };

    const generateTacticalAdvice = async () => {
        if (!userId || !db) {
            const errorMsg = "El sistema IA/Base de datos no está listo o hay un error de conexión.";
            setIaDialogue(errorMsg);
            return;
        }
        setLoading(true);
        try {
            const { adviceText, systemInstruction } = await geminiService.generateTacticalAdvice(gameState, placaId, log, metaData);
            const parsedHtml = await marked.parse(adviceText);
            setIaDialogue(parsedHtml);

            const newLogEntry: LogEntry = {
                timestamp: new Date().toISOString(),
                advice: adviceText,
                gameState: { ...gameState },
                userId: userId,
                placaId: placaId,
                systemPrompt: systemInstruction.substring(0, 1500) + '...',
            };
            
            await handleAddLogEntry(newLogEntry);

        } catch (error) {
            console.error("Error generating tactical advice:", error);
            setIaDialogue("Error de la IA: Fallo de conexión o la respuesta fue bloqueada.");
        } finally {
            setLoading(false);
        }
    };

    const renderScreen = () => {
        switch (appState) {
            case 'start':
                return <StartScreen onActivate={handleActivate} loading={loading} />;
            case 'enrollment':
                return <EnrollmentScreen onEnroll={handleEnrollment} iaDialogue={iaDialogue} loading={loading} />;
            case 'tutorial':
                return <TutorialScreen onContinue={handleStartGameplay} tutorialText={tutorialText} loading={loading} />;
            case 'gameplay':
                return (
                    <GameplayScreen
                        placaId={placaId}
                        gameState={gameState}
                        setGameState={setGameState}
                        iaDialogue={iaDialogue}
                        setIaDialogue={setIaDialogue}
                        log={log}
                        loading={loading}
                        dbInitializationError={dbInitializationError}
                        userId={userId}
                        db={db}
                        appId={appId}
                        onGetAdvice={generateTacticalAdvice}
                        metaData={metaData}
                        setAppState={setAppState}
                        onAddLogEntry={handleAddLogEntry}
                    />
                );
            default:
                return <StartScreen onActivate={handleActivate} loading={loading} />;
        }
    };

    return <div className="bg-gray-900 min-h-screen text-white font-mono">{renderScreen()}</div>;
};

export default App;