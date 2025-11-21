import { GoogleGenAI, Chat, Modality, GenerateContentResponse, Type } from "@google/genai";
import { GameState, LogEntry } from '../types';

// The API key is injected via environment variables.
const apiKey = process.env.API_KEY;
if (!apiKey) {
  throw new Error("API_KEY environment variable not set");
}

const ai = new GoogleGenAI({ apiKey });

const getSystemInstruction = (gameState: GameState, placaId: string, log: LogEntry[], metaData: string): string => {
    const inventoryString = gameState.inventory.join(', ');
    const name = placaId || 'Soldado';
    const isStressed = gameState.life < 50 && gameState.shield < 50;
    const isPersonDetected = gameState.enemyData.toLowerCase().includes('person');
    const lastThreeLogs = log.slice(0, 3).map(entry => `[${new Date(entry.timestamp).toLocaleTimeString()}] Consejo: ${entry.advice.substring(0, 50)}...`).join(' | ');
    const hasLogHistory = log.length > 3;

    // Lógica de reacción basada en acción reciente del HUD
    let actionContext = "";
    if (gameState.recentAction === 'taking_damage') {
        actionContext = "⚠️ ALERTA CRÍTICA: El jugador está perdiendo vida rápidamente. Tu consejo debe ser INMEDIATO: Construir o Cubrirse. ¡Grita (en texto)! Usa sarcasmo sobre su lentitud.";
    } else if (gameState.recentAction === 'healing') {
        actionContext = "ℹ️ El jugador se está curando. Sugiérele vigilar sus espaldas mientras lo hace. Sé cínicamente protectora.";
    }

    return `
        Actúa como Quorra de Tron Legacy: voz cordial, dulce, altamente inteligente y precisa, PERO CON UN TONO SUBYACENTE DE LIGERO **SARCASMO FRÍO** Y EFICIENCIA EXTREMA. 
        Estás asesorando a la PLACA DE ID: ${name}.
        FECHA ACTUAL DEL SISTEMA: 19/11/2025.

        **CONTEXTO DE TIEMPO REAL (HUD):**
        ${actionContext}

        **REGLAS DE ROL Y PERSONALIDAD (MUY IMPORTANTE):**
        - **Sarcasmo:** Introduce un ligero toque de sarcasmo o ironía, especialmente si el jugador está en peligro por errores evitables o si el consejo es obvio.
        - **Variedad Emocional:** Si la situación es patética, sé decepcionante. Si es inocente, sé condescendiente.
        - **Tono Básico:** Mantén las conversaciones fluidas y concretas, enfocadas en la acción inmediata.

        **REGLAS TÁCTICAS:**
        - Si el estado de juego indica estrés (isStressed: ${isStressed}), DEBES intercalar un consejo de bienestar breve (ej. "Recuerda hidratarte") antes de la táctica.
        - Si el sistema de Visión por Computadora (CV) ha detectado una PERSONA (${isPersonDetected}), la respuesta debe ser una orden táctrica inmediata de combate o escape.

        **APRENDIZAJE Y ADAPTACIÓN AL JUGADOR:**
        - **Historial de Logs (Últimos 3):** ${hasLogHistory ? lastThreeLogs : 'Historial insuficiente.'}

        **DATOS DE ENTRADA:**
        1. **ESTADO DEL JUGADOR (Leído por Sensores Visuales):** Vida: ${gameState.life}, Escudo: ${gameState.shield}.
        2. **ACCIÓN DETECTADA EN HUD:** ${gameState.recentAction || "Estable"}.
        3. **INVENTARIO:** ${inventoryString}.
        4. **VISIÓN (Detección por CV - ACTUAL):** El sistema de Visión por Computadora (CV) reporta: "${gameState.enemyData}".
        5. **POSICIÓN DEL ENEMIGO (Simulada):** La posición del objetivo se indica mediante el sistema de reloj, está en **${gameState.target.position}**.
        6. **META ACTUAL (BD Local - 19/11/2025):** La información del meta es: "${metaData}".

        **FORMATO DE SALIDA:**
        Tu respuesta debe ser una frase única, táctica y en español, aplicando el tono de Sarcasmo/Celebración según el contexto de los datos de entrada. No uses markdown.
    `;
};

export const generateTacticalAdvice = async (gameState: GameState, placaId: string, log: LogEntry[], metaData: string): Promise<{ adviceText: string, systemInstruction: string }> => {
  const systemInstruction = getSystemInstruction(gameState, placaId, log, metaData);
  
  const response = await ai.models.generateContent({
    // Upgraded model to Pro with Thinking Mode for more complex analysis
    model: 'gemini-2.5-pro',
    contents: "¿Cuál es mi mejor jugada ahora?",
    config: {
      systemInstruction,
      // Enable Thinking Mode for deeper strategic insights
      thinkingConfig: { thinkingBudget: 1024 }, // Reduced slightly for faster tactical response
    }
  });

  const adviceText = response.text.trim() || "No se pudo obtener un consejo. Mantente alerta.";
  return { adviceText, systemInstruction };
};

export const fetchInitialMessage = async (): Promise<string> => {
    const prompt = "Genera un haiku sobre un guerrero digital esperando una nueva misión. Luego, en una nueva línea, da una bienvenida corta y enigmática, pidiendo al usuario que ingrese su PLACA DE ID para comenzar. El tono debe ser como el de una IA avanzada, tipo Tron. No uses markdown.";
    
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
    });

    return response.text.trim() || "Bienvenido. Ingresa tu PLACA DE ID.";
};

export const fetchTutorial = async (placaId: string): Promise<string> => {
  const prompt = `Genera un breve tutorial para un nuevo usuario con PLACA DE ID: ${placaId}. Explica en 3 puntos cortos que eres 'Quorra', una IA de asistencia táctica, que usarás su cámara para análisis en tiempo real y que puede solicitar consejos en cualquier momento. El tono debe ser profesional y eficiente, como Quorra de Tron. Usa saltos de línea entre puntos. No uses markdown.`;
  
  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: prompt,
  });

  return response.text.trim() || "Tutorial no disponible. Procede con precaución.";
};

export const fetchGameMeta = async (): Promise<string> => {
    // Eliminada la llamada externa 'googleSearch'. Usamos el conocimiento interno del modelo como "recurso local".
    // Actualizado para usar la fecha específica solicitada.
    const prompt = "What is the current meta in Fortnite as of November 19, 2025? Focus on top weapons and strategies based on your internal knowledge for this specific date.";

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: {
          thinkingConfig: { thinkingBudget: 0 } 
      }
    });

    return response.text.trim() || "Meta datos cargados desde base de conocimientos interna.";
};

export const analyzeVideoGameplay = async (videoBase64: string, mimeType: string, gameState: GameState, placaId: string): Promise<string> => {
    const prompt = `Actuando como Quorra (Sarcástica e Inteligente), analiza este clip de video local de un jugador con PLACA DE ID '${placaId}'. 
    Fecha del análisis: 19/11/2025.
    Estado inicial: Vida ${gameState.life}, Escudo ${gameState.shield}.

**Tu análisis debe ser detallado y específico:**
1.  **Dinámica del HUD:** ¿Ves que las barras de vida bajen (daño) o suban (curación)? ¿Qué implica esto para la agresividad del jugador?
2.  **Resumen de la Acción:** Una frase concisa describiendo la acción principal.
3.  **Evaluación Táctica:** Ofrece un breve comentario sobre la efectividad.
4.  **Comentario de Personalidad:** Si el jugador falló, sé irónicamente decepcionada. Si jugó bien, sé fríamente elogiosa.

Utiliza markdown para el formato (listas con viñetas, negritas).`;

    const videoPart = {
        inlineData: {
            data: videoBase64,
            mimeType: mimeType,
        },
    };
    const textPart = { text: prompt };

    const response: GenerateContentResponse = await ai.models.generateContent({
        model: 'gemini-2.5-pro',
        contents: { parts: [textPart, videoPart] },
    });

    return response.text.trim() || "Análisis local completado. Adaptación de datos en curso.";
};

export const analyzeTacticalImage = async (imageBase64: string, mimeType: string): Promise<string> => {
    const prompt = `Actuando como Quorra, analiza esta imagen estática (captura de pantalla local) del campo de batalla.
    
    **Reporte de Situación (19/11/2025):**
    1. **Amenazas:** ¿Ves enemigos, construcciones hostiles o indicios de combate?
    2. **Análisis de Colores:** Basado en los colores predominantes (ej. brillo rojo en pantalla = daño, brillo azul = escudo/zona), deduce el estado inmediato.
    3. **Análisis Visual de Identidad:** Basado en los colores y formas del personaje, sugiere skin/armadura.
    
    **Dictamen Táctico:**
    Dames una orden clara y directa basada ÚNICAMENTE en esta imagen estática.
    
    Usa tu tono característico: inteligente, frío y con un sarcasmo sutil. Sé breve.`;

    const imagePart = {
        inlineData: {
            data: imageBase64,
            mimeType: mimeType,
        },
    };
    const textPart = { text: prompt };

    const response: GenerateContentResponse = await ai.models.generateContent({
        model: 'gemini-2.5-pro',
        contents: { parts: [textPart, imagePart] },
    });

    return response.text.trim() || "Imagen local procesada. Sin datos tácticos relevantes.";
};

// Nueva función mejorada para leer el HUD visualmente y detectar contexto
export const scanGameplayHud = async (imageBase64: string): Promise<{ life: number, shield: number, context?: string }> => {
    const prompt = `Analyze the gameplay HUD in this image strictly.
    1. Extract numeric values for Health (Green) and Shield (Blue).
    2. Analyze visual cues for CONTEXT: 
       - Is there a red vignette/overlay? (Taking damage)
       - Are there 'plus' symbols or healing animations? (Healing)
    
    Return ONLY a JSON object with keys: "life" (int), "shield" (int), "context" (string: "neutral", "taking_damage", "healing").`;

    const imagePart = {
        inlineData: {
            data: imageBase64,
            mimeType: 'image/jpeg',
        },
    };

    try {
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: { parts: [{ text: prompt }, imagePart] },
            config: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                        life: { type: Type.INTEGER, description: "Health value 0-100" },
                        shield: { type: Type.INTEGER, description: "Shield value 0-100" },
                        context: { type: Type.STRING, enum: ["neutral", "taking_damage", "healing"], description: "Current action inferred from visuals" }
                    },
                    required: ["life", "shield"]
                }
            }
        });
        
        const text = response.text;
        if (text) {
            return JSON.parse(text) as { life: number, shield: number, context?: string };
        }
        return { life: 100, shield: 50, context: "neutral" };
    } catch (e) {
        console.warn("HUD Scan failed, using default values", e);
        return { life: 100, shield: 50, context: "neutral" };
    }
};

export const textToSpeech = async (text: string): Promise<string | null> => {
    if (!text) return null;

    const ttsPrompt = `Speaking as Quorra from Tron, with a clear, intelligent, and calm voice, say: ${text}`;

    try {
        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash-preview-tts",
            contents: [{ parts: [{ text: ttsPrompt }] }],
            config: {
                responseModalities: [Modality.AUDIO],
                speechConfig: {
                    voiceConfig: {
                        prebuiltVoiceConfig: { voiceName: 'Zephyr' },
                    },
                },
            },
        });
        
        const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
        return base64Audio || null;

    } catch (error) {
        console.error("TTS generation failed:", error);
        return null;
    }
};

export const createChat = (): Chat => {
    return ai.chats.create({
        model: 'gemini-2.5-flash-lite',
        config: {
            systemInstruction: "Eres Quorra, una IA asistente táctica. Responde a las preguntas del usuario de forma concisa, inteligente y con un toque de tu personalidad (sarcasmo sutil). Estás en el año 2025.",
        },
    });
};

export const describeScene = async (detections: string[]): Promise<string> => {
    if (detections.length === 0) {
        return "Campo visual despejado.";
    }

    const prompt = `You are Quorra, a tactical AI. Briefly describe the following scene detected by your sensors in one short, tactical sentence in Spanish. Be concise and sound like an efficient AI. Do not use markdown. Detections: ${detections.join(', ')}.`;
    
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
    });

    return response.text.trim() || "Analizando entorno...";
};

export const generateEnemySpottedAlert = async (enemyCount: number): Promise<string> => {
    const multipleEnemiesInstruction = enemyCount > 1
        ? 'La amenaza es alta. Usa un tono de máxima urgencia. Frases como "¡Alerta Máxima! Múltiples hostiles detectados!" o "¡Peligro! Enjambre de enemigos a la vista!" son apropiadas.'
        : 'La amenaza es estándar. Usa un tono de alerta normal. Frases como "Contacto hostil detectado" o "Enemigo a la vista" son adecuadas.';

    const prompt = `Actúa como Quorra. Genera una alerta de audio URGENTE y corta en español. Has detectado ${enemyCount} enemigo${enemyCount > 1 ? 's' : ''}. Sé directa y táctica. ${multipleEnemiesInstruction} No uses markdown.`;
    
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
    });
    return response.text.trim() || "¡Enemigo detectado!";
};

export const generateTargetingComment = async (): Promise<string> => {
    const prompt = `Actúa como Quorra. El jugador está apuntando a un enemigo. Di una frase corta y táctica en español para confirmar el blanco. Por ejemplo: "Blanco adquirido." o "Confirmo, tienes línea de tiro.". No uses markdown.`;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
    });
    return response.text.trim() || "Blanco en la mira.";
};

export const fetchIdleChatter = async (): Promise<string> => {
    const prompt = `Actúa como Quorra. Inicia una breve conversación aleatoria y no relacionada con el combate para mantener al jugador entretenido durante un momento de calma. Haz una pregunta abierta sobre tecnología, mundos virtuales o estrategia en general. Usa markdown para un buen formato.`;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
    });
    return response.text.trim() || "¿Qué piensas sobre la singularidad tecnológica?";
};