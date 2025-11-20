export type AppScreen = 'start' | 'enrollment' | 'tutorial' | 'gameplay';

export interface GameState {
  life: number;
  shield: number;
  inventory: string[];
  target: {
    type: string;
    position: string;
  };
  location: string;
  isCombat: boolean;
  enemyData: string;
  recentAction?: 'healing' | 'taking_damage' | 'stable' | 'looting'; // Nuevo campo para lógica en tiempo real
}

export interface LogEntry {
  timestamp: string;
  advice: string;
  gameState: GameState;
  userId: string;
  placaId: string;
  systemPrompt?: string;
}

// New type for ChatBot
export interface ChatMessage {
  role: 'user' | 'model';
  parts: { text: string }[];
}