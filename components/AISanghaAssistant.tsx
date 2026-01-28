import React, { useState } from 'react';
import { askSanghaAssistant } from '../services/geminiService';
import { Sparkles, Send, X } from 'lucide-react';

const AISanghaAssistant: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [response, setResponse] = useState('');
  const [loading, setLoading] = useState(false);

  const handleAsk = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;

    setLoading(true);
    setResponse('');
    
    const answer = await askSanghaAssistant(query);
    setResponse(answer);
    setLoading(false);
  };

  return (
    <div className="fixed bottom-6 right-6 z-40 flex flex-col items-end">
      {isOpen && (
        <div className="mb-4 w-80 md:w-96 bg-white rounded-2xl shadow-2xl border border-sangha-gold/20 overflow-hidden animate-in slide-in-from-bottom-10 fade-in duration-300">
           <div className="bg-sangha-navy text-white p-4 flex justify-between items-center">
             <div className="flex items-center gap-2">
               <Sparkles size={18} className="text-sangha-gold" />
               <span className="font-serif font-bold">Sangha Assistant</span>
             </div>
             <button onClick={() => setIsOpen(false)} className="hover:text-sangha-gold">
               <X size={18} />
             </button>
           </div>
           
           <div className="p-4 min-h-[200px] max-h-[400px] overflow-y-auto bg-sangha-light">
             {response ? (
               <div className="prose prose-sm">
                 <p className="text-gray-800">{response}</p>
               </div>
             ) : (
               <p className="text-gray-400 text-sm italic">
                 Ask me about upcoming events, meditation instruction, or basic Buddhist concepts...
               </p>
             )}
             {loading && (
               <div className="flex justify-center py-4">
                 <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-sangha-navy"></div>
               </div>
             )}
           </div>

           <form onSubmit={handleAsk} className="p-3 bg-white border-t border-gray-100 flex gap-2">
             <input
               type="text"
               value={query}
               onChange={(e) => setQuery(e.target.value)}
               placeholder="Ask a question..."
               className="flex-1 text-sm border-none focus:ring-0 px-2 outline-none"
             />
             <button 
               type="submit" 
               disabled={loading || !query}
               className="bg-sangha-gold text-sangha-navy p-2 rounded-full disabled:opacity-50"
             >
               <Send size={16} />
             </button>
           </form>
        </div>
      )}

      <button 
        onClick={() => setIsOpen(!isOpen)}
        className="bg-sangha-navy hover:bg-blue-900 text-white p-4 rounded-full shadow-xl flex items-center gap-2 transition-transform hover:scale-105 group"
      >
        <Sparkles size={24} className="text-sangha-gold group-hover:animate-pulse" />
        {!isOpen && <span className="font-bold pr-2">Ask AI</span>}
      </button>
    </div>
  );
};

export default AISanghaAssistant;