import React from 'react';
import { MapPin, Clock, Info } from 'lucide-react';
import SanghaLogo from './SanghaLogo';

const Hero: React.FC = () => {
  return (
    <div className="relative bg-sangha-navy text-white overflow-hidden">
      {/* Background Abstract Lotus Pattern */}
      <div className="absolute top-0 left-0 w-full h-full overflow-hidden opacity-10 pointer-events-none">
        <div className="absolute -right-20 -top-40 w-96 h-96 border-[40px] border-sangha-gold rounded-full blur-3xl"></div>
        <div className="absolute -left-20 bottom-0 w-64 h-64 bg-sangha-gold rounded-full blur-[100px]"></div>
      </div>

      <div className="container mx-auto px-4 py-16 md:py-20 relative z-10">
        <div className="flex flex-col md:flex-row items-center justify-between gap-8 md:gap-12">
          
          {/* Text Content */}
          <div className="flex-1 text-center md:text-left relative z-20 order-2 md:order-1">
            <div className="inline-block mb-4 px-3 py-1 border border-sangha-gold text-sangha-gold rounded-full text-xs tracking-widest uppercase">
              All Are Welcome
            </div>
            <h1 className="font-serif text-4xl md:text-6xl font-bold mb-6 leading-tight">
              Gather. Meditate. <br/>
              <span className="text-sangha-gold">Learn. Connect.</span>
            </h1>
            <p className="text-blue-100 text-lg md:text-xl mb-8 max-w-xl mx-auto md:mx-0 font-light">
              Join the Eau Claire Buddhist Sangha for weekly meditation practice, dharma talks, and open discussion in a supportive community.
            </p>

            <div className="flex flex-col sm:flex-row gap-4 justify-center md:justify-start">
              <div className="bg-white/10 backdrop-blur-sm p-4 rounded-lg flex items-start gap-3 border border-white/10 hover:bg-white/15 transition-colors">
                <Clock className="text-sangha-gold shrink-0 mt-1" size={20} />
                <div className="text-left">
                  <div className="font-bold">Tuesdays</div>
                  <div className="text-sm text-gray-300">7:00 PM – 8:30 PM</div>
                </div>
              </div>
              <div className="bg-white/10 backdrop-blur-sm p-4 rounded-lg flex items-start gap-3 border border-white/10 hover:bg-white/15 transition-colors">
                <MapPin className="text-sangha-gold shrink-0 mt-1" size={20} />
                <div className="text-left">
                  <div className="font-bold">Unity of Eau Claire</div>
                  <div className="text-sm text-gray-300">1808 Folsom Street</div>
                </div>
              </div>
            </div>
            
            <div className="mt-6 flex items-center justify-center md:justify-start gap-2 text-sm text-sangha-gold/80 italic">
              <Info size={14} />
              <span>Meditation instruction available at 6:45 PM</span>
            </div>
          </div>

          {/* Visual Element - Logo */}
          <div className="flex-1 flex justify-center order-1 md:order-2 mb-8 md:mb-0">
             <div className="relative w-80 h-80 md:w-[500px] md:h-[500px] flex items-center justify-center">
                {/* Soft Radial Glow Background (Spotlight) */}
                <div 
                  className="absolute inset-0 rounded-full"
                  style={{ 
                    background: 'radial-gradient(closest-side, rgba(255,255,255,0.95) 20%, rgba(255,255,255,0.1) 60%, transparent 100%)',
                    filter: 'blur(20px)'
                  }}
                ></div>
                
                {/* Large Logo */}
                <div className="relative z-10 w-full h-full flex items-center justify-center p-4 md:p-8">
                  <SanghaLogo className="w-full h-full object-contain drop-shadow-lg" />
                </div>
             </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Hero;