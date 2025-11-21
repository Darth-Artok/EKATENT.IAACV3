import React from 'react';

interface StartScreenProps {
  onActivate: () => void;
  loading: boolean;
}

const StartScreen: React.FC<StartScreenProps> = ({ onActivate, loading }) => {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-900 text-cyan-400 p-4">
      <div className="text-center border-4 border-cyan-500 rounded-xl shadow-2xl shadow-cyan-500/20 p-8 md:p-16 bg-gray-800/50 backdrop-blur-sm">
        <h1 className="text-4xl md:text-6xl font-extrabold tracking-widest uppercase">IAAC</h1>
        <p className="mt-2 text-lg md:text-xl text-gray-300">Intelligent Autonomous Assault Coach</p>
        <p className="mt-4 max-w-lg text-gray-400">
          Activa tu asistente táctico personal para Fortnite. Obtén análisis en tiempo real y consejos estratégicos impulsados por Gemini.
        </p>
        <button
          onClick={onActivate}
          disabled={loading}
          className="mt-8 px-10 py-4 bg-cyan-600 text-white font-bold text-lg rounded-lg shadow-lg shadow-cyan-500/30 hover:bg-cyan-500 transition-all duration-300 transform hover:scale-105 disabled:bg-gray-600 disabled:cursor-not-allowed animate-pulse hover:animate-none"
        >
          {loading ? 'INICIANDO...' : 'ACTIVAR QUORRA'}
        </button>
      </div>
    </div>
  );
};

export default StartScreen;
