import React, { useState, useEffect } from 'react';
import { marked } from 'marked';

interface EnrollmentScreenProps {
  onEnroll: (id: string) => void;
  iaDialogue: string;
  loading: boolean;
}

const EnrollmentScreen: React.FC<EnrollmentScreenProps> = ({ onEnroll, iaDialogue, loading }) => {
  const [enrollmentInput, setEnrollmentInput] = useState('');
  const [parsedDialogue, setParsedDialogue] = useState('');

  useEffect(() => {
    const parseDialogue = async () => {
      const html = await marked.parse(iaDialogue.replace(/\n/g, '<br/>'));
      setParsedDialogue(html);
    };
    parseDialogue();
  }, [iaDialogue]);

  const handleKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      onEnroll(enrollmentInput);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-900 text-cyan-400 p-4">
      <div className="text-center border-2 border-cyan-700 rounded-lg shadow-lg shadow-cyan-500/20 p-8 bg-gray-800/70 w-full max-w-2xl">
        <div className="h-24 p-4 mb-6 bg-black/50 rounded-md border border-cyan-900 overflow-y-auto text-left">
            <p className="text-white whitespace-pre-wrap" dangerouslySetInnerHTML={{ __html: parsedDialogue }} />
        </div>
        <input
          type="text"
          value={enrollmentInput}
          onChange={(e) => setEnrollmentInput(e.target.value)}
          onKeyPress={handleKeyPress}
          placeholder="INGRESA TU PLACA DE ID"
          className="w-full p-4 bg-gray-900 border-2 border-cyan-500 rounded-md text-center text-xl font-bold tracking-widest placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-cyan-400"
          disabled={loading}
        />
        <button
          onClick={() => onEnroll(enrollmentInput)}
          disabled={loading || !enrollmentInput.trim()}
          className="mt-6 w-full py-3 bg-cyan-600 text-white font-bold text-lg rounded-lg shadow-lg hover:bg-cyan-500 transition-colors duration-300 disabled:bg-gray-600 disabled:cursor-not-allowed"
        >
          {loading ? 'REGISTRANDO...' : 'CONFIRMAR IDENTIDAD'}
        </button>
      </div>
    </div>
  );
};

export default EnrollmentScreen;