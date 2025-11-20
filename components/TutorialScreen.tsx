import React, { useState, useEffect } from 'react';
import { marked } from 'marked';

interface TutorialScreenProps {
  onContinue: () => void;
  tutorialText: string;
  loading: boolean;
}

const TutorialScreen: React.FC<TutorialScreenProps> = ({ onContinue, tutorialText, loading }) => {
  const [parsedTutorial, setParsedTutorial] = useState('');

  useEffect(() => {
    const parseTutorial = async () => {
      const html = await marked.parse(tutorialText.replace(/\n/g, '<br/>'));
      setParsedTutorial(html);
    };
    parseTutorial();
  }, [tutorialText]);

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-900 text-cyan-400 p-4">
      <div className="text-left border-2 border-cyan-700 rounded-lg shadow-lg shadow-cyan-500/20 p-8 bg-gray-800/70 w-full max-w-2xl">
        <h2 className="text-2xl font-bold text-center mb-6 border-b-2 border-cyan-800 pb-2">PROTOCOLO DE INICIO</h2>
        <div className="mb-8 p-4 bg-black/50 rounded-md border border-cyan-900 min-h-[150px]">
            {loading ? (
                 <p className="text-white text-center animate-pulse">Generando directivas...</p>
            ) : (
                <div className="text-white space-y-2" dangerouslySetInnerHTML={{ __html: parsedTutorial }} />
            )}
        </div>
        <button
          onClick={onContinue}
          disabled={loading}
          className="w-full py-3 bg-cyan-600 text-white font-bold text-lg rounded-lg shadow-lg hover:bg-cyan-500 transition-colors duration-300 disabled:bg-gray-600"
        >
          {loading ? 'ESPERE' : 'INICIAR ANÁLISIS TÁCTICO'}
        </button>
      </div>
    </div>
  );
};

export default TutorialScreen;